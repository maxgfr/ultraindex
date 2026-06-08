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
  filesByDir: Map<string, string[]>; // dir (posix, "" for root) -> rel files
  tsBaseUrl: string; // posix dir, "" for repo root
  tsPaths: TsPath[];
  goModule?: string;
  goModuleDir: string; // posix dir of go.mod, "" for root
  pyRoots: string[]; // posix dirs that are python import roots ("" allowed)
}

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
  for (const f of scan.files) {
    const dir = f.rel.includes("/") ? posix.dirname(f.rel) : "";
    let list = filesByDir.get(dir);
    if (!list) filesByDir.set(dir, (list = []));
    list.push(f.rel);
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

  return { fileSet, filesByDir, tsBaseUrl, tsPaths, goModule, goModuleDir, pyRoots: [...pyRoots] };
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
  return hit ? { kind: "resolved", target: hit } : { kind: "dangling", reason: "missing-target" };
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
  if (JS_TS.has(ext)) return resolveJs(fromRel, spec, ctx);
  if (PY.has(ext)) return resolvePython(fromRel, spec, ctx);
  if (ext === ".go") return resolveGo(spec, ctx);
  return { kind: "external" };
}
