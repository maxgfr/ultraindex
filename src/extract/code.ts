import type { CodeSymbol, RawRef } from "../types.js";
import { extractSymbols } from "../lang/registry.js";

export interface CodeInfo {
  symbols: CodeSymbol[];
  summary?: string;
  refs: RawRef[]; // import refs (raw specifiers, unresolved)
}

const JS_TS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const PY = new Set([".py", ".pyi"]);

// The leading comment block of a file, turned into one summary line. Handles
// `//`, `#`, and `/* … */` / `""" … """` openers. Stops at the first code line.
function topDocComment(content: string): string | undefined {
  const lines = content.split(/\r?\n/);
  const collected: string[] = [];
  let inBlock: "c" | "py" | null = null;
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const raw = lines[i]!;
    const line = raw.trim();
    if (inBlock === "c") {
      collected.push(line.replace(/^\*+/, "").replace(/\*+\/\s*$/, "").trim());
      if (line.includes("*/")) inBlock = null;
      continue;
    }
    if (inBlock === "py") {
      if (line.includes('"""') || line.includes("'''")) {
        collected.push(line.replace(/['"]{3}.*$/, "").trim());
        inBlock = null;
      } else collected.push(line);
      continue;
    }
    if (line === "" && collected.length === 0) continue; // skip leading blanks
    if (line.startsWith("#!")) continue; // shebang
    if (line.startsWith("//")) {
      collected.push(line.replace(/^\/+/, "").trim());
      continue;
    }
    if (line.startsWith("#")) {
      collected.push(line.replace(/^#+/, "").trim());
      continue;
    }
    if (line.startsWith("/*")) {
      collected.push(line.replace(/^\/\*+/, "").replace(/\*+\/\s*$/, "").trim());
      if (!line.includes("*/")) inBlock = "c";
      continue;
    }
    if (line.startsWith('"""') || line.startsWith("'''")) {
      const rest = line.slice(3);
      if (rest.includes('"""') || rest.includes("'''")) collected.push(rest.replace(/['"]{3}.*$/, "").trim());
      else {
        collected.push(rest.trim());
        inBlock = "py";
      }
      continue;
    }
    break; // first real code line
  }
  const text = collected.join(" ").replace(/\s+/g, " ").trim();
  if (text.length < 8) return undefined;
  // First sentence, capped.
  const sentence = /^(.*?[.!?])(\s|$)/.exec(text);
  return (sentence ? sentence[1]! : text).slice(0, 200);
}

// Extract import specifiers as written (no resolution). Resolution needs
// repo-wide context (tsconfig paths, go.mod, python roots) and happens later.
function extractImports(ext: string, content: string): RawRef[] {
  const specs = new Set<string>();
  const lines = content.split(/\r?\n/);

  if (JS_TS.has(ext)) {
    for (const line of lines) {
      let m: RegExpExecArray | null;
      const from = /(?:^|\s)(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/.exec(line);
      if (from) specs.add(from[1]!);
      const bare = /^\s*import\s*['"]([^'"]+)['"]/.exec(line);
      if (bare) specs.add(bare[1]!);
      const req = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
      while ((m = req.exec(line))) specs.add(m[1]!);
      const dyn = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
      while ((m = dyn.exec(line))) specs.add(m[1]!);
    }
  } else if (PY.has(ext)) {
    for (const line of lines) {
      const from = /^\s*from\s+(\.*[\w.]*)\s+import\b/.exec(line);
      if (from) {
        specs.add(from[1]!);
        continue;
      }
      const imp = /^\s*import\s+(.+)$/.exec(line);
      if (imp) {
        for (const part of imp[1]!.split(",")) {
          const name = part.trim().split(/\s+as\s+/)[0]!.trim();
          if (name && /^[\w.]+$/.test(name)) specs.add(name);
        }
      }
    }
  } else if (ext === ".go") {
    let inBlock = false;
    for (const line of lines) {
      const t = line.trim();
      if (inBlock) {
        if (t === ")") {
          inBlock = false;
          continue;
        }
        const b = /"([^"]+)"/.exec(t);
        if (b) specs.add(b[1]!);
        continue;
      }
      if (/^import\s*\($/.test(t)) {
        inBlock = true;
        continue;
      }
      const single = /^import\s+(?:[\w.]+\s+)?"([^"]+)"/.exec(t);
      if (single) specs.add(single[1]!);
    }
  }

  return [...specs].map((spec) => ({ kind: "import" as const, spec }));
}

export function extractCode(rel: string, ext: string, content: string): CodeInfo {
  return {
    symbols: extractSymbols(rel, ext, content).slice(0, 400),
    summary: topDocComment(content),
    refs: extractImports(ext, content),
  };
}
