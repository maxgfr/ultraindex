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

// One tsconfig/jsconfig's alias scope. In a monorepo each package can declare its
// own baseUrl/paths, so we keep them per-config and resolve an import against the
// NEAREST enclosing config (deepest dir first) rather than a single root config.
interface TsConfigScope {
  dir: string; // the config's own directory (posix, "" = repo root) — scope test
  baseUrl: string; // repo-relative posix dir the `targets` resolve against
  paths: TsPath[];
}

export interface ResolveContext {
  fileSet: Set<string>;
  dirSet: Set<string>; // every directory that has any file beneath it
  filesByDir: Map<string, string[]>; // dir (posix, "" for root) -> rel files
  tsConfigs: TsConfigScope[]; // nearest-enclosing first (deepest dir wins)
  goModule?: string;
  goModuleDir: string; // posix dir of go.mod, "" for root
  pyRoots: string[]; // posix dirs that are python import roots ("" allowed)
  workspacePackages: { name: string; dir: string }[]; // monorepo pkg name -> its dir
  warnings: string[]; // build-time config issues (e.g. an unparseable tsconfig)
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
  // tsconfig.json is JSONC: strip // and /* */ comments and trailing commas. This
  // MUST be string-aware — tsconfig glob values like "**/*.ts" or
  // "./src/styled-system/*" contain `/*`, `*/` and `//` that a naive regex
  // stripper mistakes for comment delimiters and shreds the document (a real
  // failure on Next.js tsconfigs that mix a `…/*` path alias with `**/*.ts`
  // includes). So scan char-by-char and only strip comments OUTSIDE strings.
  let stripped = "";
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inStr) {
      stripped += c;
      if (c === "\\") stripped += text[++i] ?? ""; // keep the escaped char verbatim
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      stripped += c;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      stripped += "\n"; // preserve line structure
    } else if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++; // skip the closing '/'
    } else {
      stripped += c;
    }
  }
  // Drop trailing commas (a `,` right before a `}` or `]`) — also string-aware,
  // so a path glob value that literally contains `,}` or `,]` is left intact.
  let out = "";
  inStr = false;
  for (let i = 0; i < stripped.length; i++) {
    const c = stripped[i]!;
    if (inStr) {
      out += c;
      if (c === "\\") out += stripped[++i] ?? "";
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      continue;
    }
    if (c === ",") {
      let j = i + 1;
      while (j < stripped.length && (stripped[j] === " " || stripped[j] === "\t" || stripped[j] === "\n" || stripped[j] === "\r")) j++;
      if (stripped[j] === "}" || stripped[j] === "]") continue; // trailing comma → drop
    }
    out += c;
  }
  try {
    return JSON.parse(out);
  } catch {
    return undefined;
  }
}

// Resolve a tsconfig `extends` target to an in-repo config path, or undefined for
// a bare package specifier (a node_modules base we don't index) or a missing file.
function resolveExtends(fileSet: Set<string>, fromDir: string, ext: string): string | undefined {
  if (!/^\.\.?\//.test(ext)) return undefined; // bare specifier → external tooling base
  const base = norm(posix.join(fromDir, ext));
  const cands = ext.endsWith(".json") ? [base] : [base + ".json", posix.join(base, "tsconfig.json")];
  for (const c of cands) if (fileSet.has(c)) return c;
  return undefined;
}

interface TsEffective {
  baseUrl?: string; // as written, relative to baseUrlDir
  baseUrlDir: string; // dir of the config that DECLARED baseUrl
  paths?: Record<string, string[]>;
  pathsDir: string; // dir of the config that DECLARED paths
}

// Read a tsconfig/jsconfig and fold in its `extends` chain (in-repo, relative
// bases only), child overriding base — so a monorepo package whose baseUrl/paths
// live in a shared base (the dominant Nx/Turborepo/lerna layout) still
// contributes its aliases. baseUrl and paths are each tracked with the dir of the
// config that DECLARED them (TS resolves them relative to that file). Cycles are
// broken via `seen`; a missing relative base is surfaced as a warning.
function readTsConfig(
  root: string,
  fileSet: Set<string>,
  rel: string,
  warnings: string[],
  seen: Set<string>,
): TsEffective | undefined {
  if (seen.has(rel)) return undefined;
  seen.add(rel);
  const cfg = tolerantJsonParse(readText(join(root, rel))) as
    | { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> }; extends?: string | string[] }
    | undefined;
  if (cfg === undefined) {
    warnings.push(`unparseable ${rel} — its path aliases were ignored`);
    return undefined;
  }
  const dir = rel.includes("/") ? posix.dirname(rel) : "";
  const eff: TsEffective = { baseUrlDir: "", pathsDir: "" };
  const exts = cfg.extends === undefined ? [] : Array.isArray(cfg.extends) ? cfg.extends : [cfg.extends];
  for (const ext of exts) {
    if (typeof ext !== "string") continue;
    const baseRel = resolveExtends(fileSet, dir, ext);
    if (!baseRel) {
      if (/^\.\.?\//.test(ext)) warnings.push(`${rel} extends "${ext}" which is missing — its path aliases were ignored`);
      continue; // bare specifiers (node_modules tooling bases) carry no repo paths
    }
    const inherited = readTsConfig(root, fileSet, baseRel, warnings, seen);
    if (inherited?.baseUrl !== undefined) {
      eff.baseUrl = inherited.baseUrl;
      eff.baseUrlDir = inherited.baseUrlDir;
    }
    if (inherited?.paths) {
      eff.paths = inherited.paths;
      eff.pathsDir = inherited.pathsDir;
    }
  }
  const co = cfg.compilerOptions;
  if (co?.baseUrl !== undefined) {
    eff.baseUrl = co.baseUrl;
    eff.baseUrlDir = dir;
  }
  if (co?.paths) {
    eff.paths = co.paths;
    eff.pathsDir = dir;
  }
  return eff;
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

  // tsconfig/jsconfig path aliases. Collect EVERY config, not just the root one
  // (each monorepo package declares its own baseUrl/paths), and fold in each
  // config's `extends` chain so aliases declared in a shared base config still
  // resolve. An import resolves against the nearest enclosing config. Unparseable
  // or missing configs surface as build warnings rather than vanishing silently.
  const warnings: string[] = [];
  const tsConfigs: TsConfigScope[] = [];
  for (const rel of fileSet) {
    const base = rel.slice(rel.lastIndexOf("/") + 1);
    if (base !== "tsconfig.json" && base !== "jsconfig.json") continue;
    const dir = rel.includes("/") ? posix.dirname(rel) : "";
    const eff = readTsConfig(scan.root, fileSet, rel, warnings, new Set<string>());
    if (!eff?.paths) continue; // no aliases to contribute
    const tsPaths: TsPath[] = [];
    for (const [alias, targets] of Object.entries(eff.paths)) {
      if (!Array.isArray(targets)) continue;
      const star = alias.endsWith("*");
      tsPaths.push({ prefix: star ? alias.slice(0, -1) : alias, star, targets });
    }
    if (!tsPaths.length) continue; // only path-alias configs affect resolution
    // `paths` resolve against baseUrl when set (relative to the config that
    // declared baseUrl), else relative to the config that declared `paths`.
    const baseUrl =
      eff.baseUrl !== undefined
        ? norm(posix.join(eff.baseUrlDir, eff.baseUrl)).replace(/^\.$/, "")
        : eff.pathsDir;
    tsConfigs.push({ dir, baseUrl, paths: tsPaths });
  }
  // Nearest-enclosing first: deepest dir wins; the root ("") is the fallback.
  tsConfigs.sort((a, b) => b.dir.length - a.dir.length);

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

  // Workspace packages: map each in-repo package.json `name` to its directory so
  // bare cross-package imports (`@scope/pkg`) resolve to in-repo source, not
  // "external". Longest name first so `@scope/a-b` wins over `@scope/a`.
  const workspacePackages: { name: string; dir: string }[] = [];
  for (const rel of fileSet) {
    if (rel !== "package.json" && !rel.endsWith("/package.json")) continue;
    // Parse with the same JSONC-tolerant path as tsconfig (some package.json carry
    // comments/trailing commas); a truly unparseable one is surfaced, not silently
    // dropped — losing it erases every cross-package edge for that workspace.
    const pkg = tolerantJsonParse(readText(join(scan.root, rel))) as { name?: string } | undefined;
    if (pkg === undefined) {
      warnings.push(`unparseable ${rel} — skipped for workspace resolution`);
      continue;
    }
    if (typeof pkg.name === "string") workspacePackages.push({ name: pkg.name, dir: rel.includes("/") ? posix.dirname(rel) : "" });
  }
  workspacePackages.sort((a, b) => b.name.length - a.name.length);

  return { fileSet, dirSet, filesByDir, tsConfigs, goModule, goModuleDir, pyRoots: [...pyRoots], workspacePackages, warnings };
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

  // tsconfig path aliases (e.g. "@/x" -> "src/x"), nearest enclosing config first.
  let aliasFallback: Resolution | undefined;
  for (const cfg of ctx.tsConfigs) {
    if (cfg.dir && fromRel !== cfg.dir && !fromRel.startsWith(cfg.dir + "/")) continue; // out of scope
    let matched = false;
    for (const tp of cfg.paths) {
      if (!(tp.star ? spec.startsWith(tp.prefix) : spec === tp.prefix)) continue;
      matched = true;
      const suffix = tp.star ? spec.slice(tp.prefix.length) : "";
      let targetTreeExists = false;
      for (const t of tp.targets) {
        const resolved = tp.star ? t.replace(/\*/, suffix) : t;
        const p = norm(posix.join(cfg.baseUrl, resolved));
        const hit = tryResolve(p);
        if (hit) return { kind: "resolved", target: hit };
        const tdir = p.includes("/") ? posix.dirname(p) : "";
        if (ctx.dirSet.has(tdir) || ctx.fileSet.has(p)) targetTreeExists = true;
      }
      // Prefix matched but nothing resolved. Remember the verdict — a real broken
      // import into an in-repo dir is dangling; an absent target tree (a generated
      // `styled-system/` codegen dir, not committed) is external (no false
      // dangling) — but DON'T return yet: a workspace package may still claim this
      // specifier (an alias prefix like "@app/*" can overlap a workspace pkg name).
      aliasFallback = targetTreeExists ? { kind: "dangling", reason: "alias-unresolved" } : { kind: "external" };
      break;
    }
    if (matched) break; // the nearest matching config wins; stop scanning broader ones
  }

  // Monorepo workspace package: resolve `@scope/pkg`(`/subpath`) to in-repo source.
  for (const pkg of ctx.workspacePackages) {
    if (spec !== pkg.name && !spec.startsWith(pkg.name + "/")) continue;
    const sub = spec.slice(pkg.name.length).replace(/^\//, "");
    const bases = sub
      ? [posix.join(pkg.dir, "src", sub), posix.join(pkg.dir, sub)]
      : [posix.join(pkg.dir, "src", "index"), posix.join(pkg.dir, "index"), posix.join(pkg.dir, "src")];
    for (const b of bases) {
      const hit = tryResolve(norm(b));
      if (hit) return { kind: "resolved", target: hit };
    }
    return { kind: "external" }; // workspace pkg, but compiled-only/unmapped — no false dangling
  }

  // An alias prefix matched but neither it nor a workspace package resolved.
  return aliasFallback ?? { kind: "external" }; // else a bare third-party / built-in
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
