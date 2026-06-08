import { posix } from "node:path";
import { join } from "node:path";
import type { RepoScan } from "./scan.js";
import { readText } from "./walk.js";

// Resolution outcome for a single ref. `external` ⇒ no edge (third-party,
// stdlib, URL, in-page anchor). `dangling` ⇒ an edge that points nowhere real
// (a local target that doesn't exist) — surfaced, never silently dropped.
export type Resolution =
  | { kind: "resolved"; target: string }
  | { kind: "external" }
  | { kind: "dangling"; reason: string };

interface TsPath {
  prefix: string; // text before a trailing "*", or the whole alias if exact
  star: boolean;
  targets: string[]; // path-relative-to-baseUrl, "*" preserved
}

export interface ResolveContext {
  fileSet: Set<string>;
  dirSet: Set<string>; // every directory that has any file beneath it
  filesByDir: Map<string, string[]>; // dir (posix, "" for root) -> rel files
  tsBaseUrl: string; // posix dir, "" for repo root
  tsPaths: TsPath[];
  goModule?: string;
  goModuleDir: string; // posix dir of go.mod, "" for root
  pyRoots: string[]; // posix dirs that are python import roots ("" allowed)
}

// Extensions walk() skips (images, fonts, media, maps). An import of one of these
// is a real asset dependency handled by a bundler — NOT a broken code edge — so
// it resolves as `external`, never dangling.
const ASSET_EXT = new Set([
  ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".icns", ".pdf",
  ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp3", ".mp4", ".mov", ".avi", ".webm",
  ".wav", ".flac", ".ogg", ".map",
]);

const JS_EXT_PROBES = ["", ".ts", ".tsx", ".d.ts", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const JS_INDEX = ["index.ts", "index.tsx", "index.js", "index.jsx", "index.mjs", "index.cjs"];
const JS_TS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const PY = new Set([".py", ".pyi"]);

function norm(p: string): string {
  // posix.normalize keeps ".." that escape the root as a leading "../"; callers
  // treat an escaping path as unresolved.
  return posix.normalize(p).replace(/\/$/, "");
}

function tolerantJsonParse(text: string): unknown {
  // tsconfig.json is JSONC: strip // and /* */ comments and trailing commas.
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const noLine = noBlock.replace(/(^|[^:])\/\/.*$/gm, "$1");
  const noTrailingComma = noLine.replace(/,(\s*[}\]])/g, "$1");
  try {
    return JSON.parse(noTrailingComma);
  } catch {
    return undefined;
  }
}

// Build the repo-wide context resolution needs: the file set, a dir→files index,
// tsconfig path aliases, the go module path, and python roots. Read once.
export function buildResolveContext(scan: RepoScan): ResolveContext {
  const fileSet = new Set(scan.files.map((f) => f.rel));
  const filesByDir = new Map<string, string[]>();
  const dirSet = new Set<string>();
  for (const f of scan.files) {
    const dir = f.rel.includes("/") ? posix.dirname(f.rel) : "";
    let list = filesByDir.get(dir);
    if (!list) filesByDir.set(dir, (list = []));
    list.push(f.rel);
    // Record every ancestor directory so a doc link to a real folder (even one
    // with no README) isn't mistaken for a broken link.
    let d = dir;
    while (d) {
      if (dirSet.has(d)) break;
      dirSet.add(d);
      d = d.includes("/") ? posix.dirname(d) : "";
    }
  }

  // tsconfig.json at the repo root (nearest-to-root only, by design for v1).
  let tsBaseUrl = "";
  const tsPaths: TsPath[] = [];
  if (fileSet.has("tsconfig.json")) {
    const cfg = tolerantJsonParse(readText(join(scan.root, "tsconfig.json"))) as
      | { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } }
      | undefined;
    const co = cfg?.compilerOptions;
    if (co?.baseUrl) tsBaseUrl = norm(co.baseUrl).replace(/^\.$/, "");
    for (const [alias, targets] of Object.entries(co?.paths ?? {})) {
      const star = alias.endsWith("*");
      tsPaths.push({ prefix: star ? alias.slice(0, -1) : alias, star, targets });
    }
  }

  // go.mod nearest the root.
  let goModule: string | undefined;
  let goModuleDir = "";
  const goModRel = [...fileSet].filter((r) => r.endsWith("go.mod")).sort((a, b) => a.length - b.length)[0];
  if (goModRel) {
    const m = /^\s*module\s+(\S+)/m.exec(readText(join(scan.root, goModRel)));
    if (m) {
      goModule = m[1]!;
      goModuleDir = goModRel.includes("/") ? posix.dirname(goModRel) : "";
    }
  }

  // Python roots: dirs containing __init__.py / pyproject.toml / setup.py, plus root.
  const pyRoots = new Set<string>([""]);
  for (const rel of fileSet) {
    const base = rel.split("/").pop()!;
    if (base === "__init__.py" || base === "pyproject.toml" || base === "setup.py") {
      pyRoots.add(rel.includes("/") ? posix.dirname(rel) : "");
    }
  }

  return { fileSet, dirSet, filesByDir, tsBaseUrl, tsPaths, goModule, goModuleDir, pyRoots: [...pyRoots] };
}

function firstExisting(ctx: ResolveContext, candidates: string[]): string | undefined {
  for (const c of candidates) {
    const n = norm(c);
    if (n && !n.startsWith("..") && ctx.fileSet.has(n)) return n;
  }
  return undefined;
}

// Markdown relative link → a real file. Strips anchors/queries; probes .md/.mdx
// and directory README/index. External/anchor targets return `external`.
export function resolveDocLink(fromRel: string, spec: string, ctx: ResolveContext): Resolution {
  let target = spec.split("#")[0]!.split("?")[0]!;
  if (!target) return { kind: "external" }; // pure in-page anchor
  if (target.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(target)) return { kind: "external" };
  const base = fromRel.includes("/") ? posix.dirname(fromRel) : "";
  const p = norm(posix.join(base, target));
  if (p.startsWith("..")) return { kind: "dangling", reason: "escapes-repo-root" };
  const hit = firstExisting(ctx, [
    p, p + ".md", p + ".mdx",
    posix.join(p, "README.md"), posix.join(p, "readme.md"),
    posix.join(p, "index.md"), posix.join(p, "index.mdx"),
  ]);
  if (hit) return { kind: "resolved", target: hit };
  // A link to a real directory (even one without a README/index) is valid — it's
  // just not a file-node edge. Don't cry "broken link".
  if (ctx.dirSet.has(p)) return { kind: "external" };
  return { kind: "dangling", reason: "missing-target" };
}

function resolveJs(fromRel: string, spec: string, ctx: ResolveContext): Resolution {
  const probe = (p: string): string | undefined =>
    firstExisting(ctx, [...JS_EXT_PROBES.map((e) => p + e), ...JS_INDEX.map((i) => posix.join(p, i))]);
  // TS/NodeNext style writes `import "./x.js"` for a source file `x.ts` — so if a
  // direct probe misses, retry with the JS-ish extension stripped.
  const tryResolve = (p: string): string | undefined => {
    const hit = probe(p);
    if (hit) return hit;
    const noJs = p.replace(/\.(js|jsx|mjs|cjs)$/, "");
    return noJs !== p ? probe(noJs) : undefined;
  };

  if (spec.startsWith(".")) {
    const base = fromRel.includes("/") ? posix.dirname(fromRel) : "";
    const p = norm(posix.join(base, spec));
    if (p.startsWith("..")) return { kind: "dangling", reason: "escapes-repo-root" };
    const hit = tryResolve(p);
    return hit ? { kind: "resolved", target: hit } : { kind: "dangling", reason: "missing-module" };
  }

  // tsconfig path aliases (e.g. "@/x" -> "src/x"). Resolve relative to baseUrl.
  for (const tp of ctx.tsPaths) {
    if (tp.star ? spec.startsWith(tp.prefix) : spec === tp.prefix) {
      const suffix = tp.star ? spec.slice(tp.prefix.length) : "";
      for (const t of tp.targets) {
        const resolved = tp.star ? t.replace(/\*/, suffix) : t;
        const p = norm(posix.join(ctx.tsBaseUrl, resolved));
        const hit = tryResolve(p);
        if (hit) return { kind: "resolved", target: hit };
      }
      return { kind: "dangling", reason: "alias-unresolved" };
    }
  }

  return { kind: "external" }; // bare specifier — third-party / built-in
}

function resolvePython(fromRel: string, spec: string, ctx: ResolveContext): Resolution {
  const probeModule = (dir: string, dotted: string): string | undefined => {
    const sub = dotted ? dotted.replace(/\./g, "/") : "";
    const base = norm(posix.join(dir, sub));
    return firstExisting(ctx, [base + ".py", base + ".pyi", posix.join(base, "__init__.py")]);
  };

  if (spec.startsWith(".")) {
    const dots = /^\.+/.exec(spec)![0].length;
    const rest = spec.slice(dots);
    const base = fromRel.includes("/") ? posix.dirname(fromRel) : "";
    // 1 dot = current package (the file's dir); each extra dot goes up one.
    let dir = base;
    for (let i = 1; i < dots; i++) dir = dir.includes("/") ? posix.dirname(dir) : "";
    const hit = rest
      ? probeModule(dir, rest)
      : firstExisting(ctx, [posix.join(norm(dir), "__init__.py")]);
    return hit ? { kind: "resolved", target: hit } : { kind: "dangling", reason: "missing-module" };
  }

  // Absolute import: only an edge if it resolves inside the repo (same-package);
  // otherwise it's a third-party/stdlib import — external, not dangling.
  for (const root of ctx.pyRoots) {
    const hit = probeModule(root, spec);
    if (hit) return { kind: "resolved", target: hit };
  }
  return { kind: "external" };
}

function resolveGo(spec: string, ctx: ResolveContext): Resolution {
  if (!ctx.goModule) return { kind: "external" };
  if (spec !== ctx.goModule && !spec.startsWith(ctx.goModule + "/")) return { kind: "external" };
  const sub = spec.slice(ctx.goModule.length).replace(/^\//, "");
  const dir = norm(posix.join(ctx.goModuleDir, sub)).replace(/^\.$/, "");
  // Go imports a package (directory); resolve to the lexicographically-first
  // .go file in that dir as the representative node.
  const inDir = (ctx.filesByDir.get(dir) ?? []).filter((f) => f.endsWith(".go")).sort();
  return inDir.length
    ? { kind: "resolved", target: inDir[0]! }
    : { kind: "dangling", reason: "missing-package" };
}

// Resolve an import specifier for a file of the given extension.
export function resolveImport(
  fromRel: string,
  ext: string,
  spec: string,
  ctx: ResolveContext,
): Resolution {
  // Asset imports (`import logo from './x.svg'`) target files walk() skips on
  // purpose — a bundler dependency, not a broken code edge.
  const dot = spec.lastIndexOf(".");
  if (dot !== -1 && ASSET_EXT.has(spec.slice(dot).toLowerCase().replace(/[?#].*$/, ""))) {
    return { kind: "external" };
  }
  if (JS_TS.has(ext)) return resolveJs(fromRel, spec, ctx);
  if (PY.has(ext)) return resolvePython(fromRel, spec, ctx);
  if (ext === ".go") return resolveGo(spec, ctx);
  return { kind: "external" };
}
