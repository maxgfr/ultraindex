#!/usr/bin/env node

// src/cli.ts
import { resolve as resolve2, join as join16, dirname as dirname6 } from "path";
import { existsSync as existsSync5 } from "fs";
import { pathToFileURL, fileURLToPath as fileURLToPath2 } from "url";
import { realpathSync as realpathSync2 } from "fs";

// src/types.ts
var VERSION = "4.1.1";
var SCHEMA_VERSION = 3;
var EXTRACTOR_VERSION = 3;

// src/build.ts
import { basename as basename2, relative as relative2, isAbsolute } from "path";

// src/scan.ts
import { basename } from "path";

// src/walk.ts
import { readdirSync, statSync, readFileSync, realpathSync } from "fs";
import { join, relative, sep, extname } from "path";
var IGNORE_DIRS = /* @__PURE__ */ new Set([
  ".git",
  "node_modules",
  ".pnpm",
  "bower_components",
  "vendor",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  ".gradle",
  ".idea",
  ".vscode",
  ".cache",
  "tmp",
  ".ultraindex",
  "Pods",
  "DerivedData",
  ".terraform",
  "elm-stuff",
  ".dart_tool"
]);
var LOCKFILES = /* @__PURE__ */ new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "composer.lock",
  "cargo.lock",
  "poetry.lock",
  "pipfile.lock",
  "gemfile.lock",
  "go.sum",
  "flake.lock",
  "packages.lock.json",
  "podfile.lock",
  "mix.lock"
]);
var BINARY_EXT = /* @__PURE__ */ new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".icns",
  ".svg",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".tgz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  ".jar",
  ".war",
  ".class",
  ".so",
  ".dylib",
  ".dll",
  ".exe",
  ".bin",
  ".o",
  ".a",
  ".wasm",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".webm",
  ".wav",
  ".flac",
  ".ogg",
  ".lock",
  ".min.js",
  ".map"
]);
var DEFAULT_MAX_FILES = 2e4;
function walk(root, opts = {}) {
  const maxFileBytes = opts.maxFileBytes ?? 1024 * 1024;
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  const out2 = [];
  let capped = false;
  const stack = [root];
  const seenDirs = /* @__PURE__ */ new Set();
  while (stack.length) {
    if (out2.length >= maxFiles) {
      capped = true;
      break;
    }
    const dir = stack.pop();
    let real;
    try {
      real = realpathSync(dir);
    } catch {
      continue;
    }
    if (seenDirs.has(real)) continue;
    seenDirs.add(real);
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name2 of entries) {
      const abs = join(dir, name2);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (IGNORE_DIRS.has(name2)) continue;
        stack.push(abs);
        continue;
      }
      if (!st.isFile()) continue;
      if (st.size > maxFileBytes) continue;
      if (LOCKFILES.has(name2.toLowerCase())) continue;
      const ext = extname(name2).toLowerCase();
      if (BINARY_EXT.has(ext)) continue;
      if (name2.endsWith(".min.js") || name2.endsWith(".min.css")) continue;
      out2.push({ rel: relative(root, abs).split(sep).join("/"), abs, size: st.size, ext, mtimeMs: st.mtimeMs });
    }
  }
  return { files: out2, capped };
}
function readText(abs) {
  try {
    const buf = readFileSync(abs);
    if (buf.length >= 2 && buf[0] === 255 && buf[1] === 254) {
      return buf.subarray(2, 2 + (buf.length - 2 & ~1)).toString("utf16le");
    }
    if (buf.length >= 2 && buf[0] === 254 && buf[1] === 255) {
      const swapped = Buffer.from(buf.subarray(2, 2 + (buf.length - 2 & ~1)));
      swapped.swap16();
      return swapped.toString("utf16le");
    }
    if (buf.length >= 3 && buf[0] === 239 && buf[1] === 187 && buf[2] === 191) return buf.subarray(3).toString("utf8");
    if (buf.includes(0)) return "";
    const text = buf.toString("utf8");
    return text.includes("\uFFFD") ? buf.toString("latin1") : text;
  } catch {
    return "";
  }
}

// src/util.ts
import { spawnSync } from "child_process";
function sh(cmd, args2, opts = {}) {
  const res = spawnSync(cmd, args2, {
    cwd: opts.cwd,
    input: opts.input,
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 12e4,
    maxBuffer: 64 * 1024 * 1024,
    env: opts.env ?? process.env
  });
  const missing = !!res.error && res.error.code === "ENOENT";
  return {
    ok: !res.error && res.status === 0,
    status: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? (res.error ? String(res.error.message) : ""),
    missing
  };
}
function slugify(input) {
  return input.toLowerCase().replace(/^https?:\/\//, "").replace(/^git@/, "").replace(/\.git$/, "").replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
}
function clip(s, max) {
  if (s.length <= max) return s;
  return s.slice(0, max) + `
\u2026 [truncated ${s.length - max} chars]`;
}
function clipInline(s, max) {
  const flat = s.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  let cut = flat.slice(0, max).replace(/\s+\S*$/, "");
  if (!cut) cut = flat.slice(0, max);
  if ((cut.match(/`/g)?.length ?? 0) % 2 === 1) cut = cut.replace(/`[^`]*$/, "");
  if (cut.lastIndexOf("[") > cut.lastIndexOf("]")) cut = cut.slice(0, cut.lastIndexOf("["));
  return cut.replace(/\s+$/, "") + "\u2026";
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
var STOPWORDS = /* @__PURE__ */ new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "do",
  "does",
  "did",
  "how",
  "what",
  "why",
  "when",
  "where",
  "which",
  "who",
  "whom",
  "this",
  "that",
  "these",
  "those",
  "of",
  "in",
  "on",
  "to",
  "for",
  "with",
  "and",
  "or",
  "but",
  "if",
  "then",
  "else",
  "than",
  "as",
  "at",
  "by",
  "from",
  "into",
  "about",
  "it",
  "its",
  "i",
  "you",
  "we",
  "they",
  "he",
  "she",
  "there",
  "here",
  "can",
  "could",
  "should",
  "would",
  "will",
  "shall",
  "may",
  "might",
  "must",
  "have",
  "has",
  "had",
  "not",
  "no",
  "yes",
  "so",
  "such",
  "only",
  "any",
  "some",
  "all",
  "get",
  "set",
  "use",
  "used",
  "using",
  "work",
  "works",
  "working",
  "handle",
  "handled",
  "happen",
  "happens",
  "default",
  "value",
  "values",
  "please",
  "explain",
  "tell",
  "me",
  "my",
  "our"
]);
function foldText(s) {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}
function keywords(question) {
  const seen = /* @__PURE__ */ new Set();
  const out2 = [];
  for (const raw of foldText(question).split(/[^A-Za-z0-9_]+/)) {
    if (!raw) continue;
    const lower = raw.toLowerCase();
    if (raw.length < 2) continue;
    if (STOPWORDS.has(lower)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    out2.push(raw);
  }
  return out2;
}
function rrf(lists, keyOf2, k = 60) {
  const score = /* @__PURE__ */ new Map();
  for (const list of lists) {
    list.forEach((item, idx) => {
      const key = keyOf2(item);
      score.set(key, (score.get(key) ?? 0) + 1 / (k + idx + 1));
    });
  }
  return score;
}

// src/git.ts
function headCommit(dir) {
  const res = sh("git", ["-C", dir, "rev-parse", "--short", "HEAD"]);
  return res.ok ? res.stdout.trim() : void 0;
}

// src/hash.ts
import { createHash } from "crypto";
function sha1(s) {
  return createHash("sha1").update(s).digest("hex");
}
function shortHash(s, n = 8) {
  return sha1(s).slice(0, n);
}

// src/lang/common.ts
function scan(rel, content, lang, rules) {
  const out2 = [];
  const lines = content.split(/\r?\n/);
  for (let i2 = 0; i2 < lines.length; i2++) {
    const line = lines[i2];
    if (!line.trim()) continue;
    for (const rule of rules) {
      const m = rule.re.exec(line);
      if (!m) continue;
      const name2 = m.groups?.name ?? m[1];
      if (!name2) continue;
      const exported = typeof rule.exported === "function" ? rule.exported(m, line) : rule.exported ?? false;
      out2.push({
        name: name2,
        kind: rule.kind,
        file: rel,
        line: i2 + 1,
        signature: line.trim().slice(0, 200),
        exported,
        lang
      });
      break;
    }
  }
  return out2;
}
var EXT_LANG = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
  ".rb": "ruby",
  ".rake": "ruby",
  ".java": "java",
  ".rs": "rust",
  ".c": "c",
  ".h": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".php": "php",
  ".swift": "swift",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".scala": "scala",
  ".sc": "scala",
  ".clj": "clojure",
  ".ex": "elixir",
  ".exs": "elixir",
  ".erl": "erlang",
  ".hs": "haskell",
  ".dart": "dart",
  ".lua": "lua",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".ksh": "shell",
  ".fish": "shell",
  ".hh": "cpp",
  ".m": "objective-c",
  ".mm": "objective-c",
  ".sql": "sql",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".proto": "protobuf",
  ".md": "markdown",
  ".mdx": "markdown",
  ".rst": "restructuredtext",
  ".txt": "text",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".ini": "ini",
  ".html": "html",
  ".css": "css",
  ".scss": "scss",
  ".vue": "vue",
  ".svelte": "svelte"
};
function extToLang(ext) {
  return EXT_LANG[ext] ?? "other";
}

// src/lang/js-ts.ts
var RULES = [
  { re: /^\s*export\s+(?:async\s+)?function\s+(?<name>[\w$]+)/, kind: "function", exported: true },
  { re: /^\s*export\s+default\s+(?:async\s+)?function\s+(?<name>[\w$]+)/, kind: "function", exported: true },
  { re: /^\s*export\s+default\s+(?:abstract\s+)?class\s+(?<name>[\w$]+)/, kind: "class", exported: true },
  { re: /^\s*(?:async\s+)?function\s+(?<name>[\w$]+)/, kind: "function", exported: false },
  { re: /^\s*export\s+(?:abstract\s+)?class\s+(?<name>[\w$]+)/, kind: "class", exported: true },
  { re: /^\s*(?:abstract\s+)?class\s+(?<name>[\w$]+)/, kind: "class", exported: false },
  { re: /^\s*export\s+interface\s+(?<name>[\w$]+)/, kind: "interface", exported: true },
  { re: /^\s*interface\s+(?<name>[\w$]+)/, kind: "interface", exported: false },
  { re: /^\s*export\s+type\s+(?<name>[\w$]+)/, kind: "type", exported: true },
  { re: /^\s*type\s+(?<name>[\w$]+)\s*[=<]/, kind: "type", exported: false },
  { re: /^\s*export\s+enum\s+(?<name>[\w$]+)/, kind: "enum", exported: true },
  { re: /^\s*export\s+const\s+enum\s+(?<name>[\w$]+)/, kind: "enum", exported: true },
  // exported const/let bound to an arrow fn or value
  { re: /^\s*export\s+(?:const|let|var)\s+(?<name>[\w$]+)\s*[:=]/, kind: "const", exported: true },
  // top-level const arrow function (not exported)
  { re: /^\s*(?:const|let)\s+(?<name>[\w$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::[^=]+)?=>/, kind: "const", exported: false },
  // `export default Foo;` — a class/const declared above and exported by reference.
  { re: /^\s*export\s+default\s+(?<name>[A-Za-z_$][\w$]*)\s*;?\s*$/, kind: "default", exported: true }
];
var jsTs = {
  lang: "javascript/typescript",
  exts: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
  extract(rel, content) {
    const lang = rel.match(/\.(ts|tsx|mts|cts)$/) ? "typescript" : "javascript";
    return scan(rel, content, lang, RULES);
  }
};

// src/lang/python.ts
var pub = (name2) => !name2.startsWith("_") || name2.startsWith("__");
var RULES2 = [
  { re: /^(?:async\s+)?def\s+(?<name>[\w]+)\s*\(/, kind: "function", exported: (m) => pub(m.groups.name) },
  { re: /^\s+(?:async\s+)?def\s+(?<name>[\w]+)\s*\(/, kind: "method", exported: (m) => pub(m.groups.name) },
  { re: /^class\s+(?<name>[\w]+)/, kind: "class", exported: (m) => pub(m.groups.name) },
  { re: /^\s+class\s+(?<name>[\w]+)/, kind: "class", exported: (m) => pub(m.groups.name) }
];
var python = {
  lang: "python",
  exts: [".py", ".pyi"],
  extract(rel, content) {
    return scan(rel, content, "python", RULES2);
  }
};

// src/lang/go.ts
var upper = (name2) => /^[A-Z]/.test(name2);
var RULES3 = [
  { re: /^func\s+\([^)]*\)\s+(?<name>[\w]+)\s*\(/, kind: "method", exported: (m) => upper(m.groups.name) },
  { re: /^func\s+(?<name>[\w]+)\s*\(/, kind: "function", exported: (m) => upper(m.groups.name) },
  { re: /^type\s+(?<name>[\w]+)\s+struct\b/, kind: "struct", exported: (m) => upper(m.groups.name) },
  { re: /^type\s+(?<name>[\w]+)\s+interface\b/, kind: "interface", exported: (m) => upper(m.groups.name) },
  { re: /^type\s+(?<name>[\w]+)\s+/, kind: "type", exported: (m) => upper(m.groups.name) }
];
var go = {
  lang: "go",
  exts: [".go"],
  extract(rel, content) {
    return scan(rel, content, "go", RULES3);
  }
};

// src/lang/ruby.ts
var RULES4 = [
  { re: /^\s*def\s+(?:self\.)?(?<name>[\w?!=]+)/, kind: "method", exported: true },
  { re: /^\s*class\s+(?<name>[\w:]+)/, kind: "class", exported: true },
  { re: /^\s*module\s+(?<name>[\w:]+)/, kind: "module", exported: true }
];
var ruby = {
  lang: "ruby",
  exts: [".rb", ".rake"],
  extract(rel, content) {
    return scan(rel, content, "ruby", RULES4);
  }
};

// src/lang/java.ts
var RULES5 = [
  { re: /^\s*(?:public|protected|private)?\s*(?:abstract\s+|final\s+)?class\s+(?<name>[\w]+)/, kind: "class", exported: (_m, l) => /\bpublic\b/.test(l) },
  { re: /^\s*(?:public|protected|private)?\s*interface\s+(?<name>[\w]+)/, kind: "interface", exported: (_m, l) => /\bpublic\b/.test(l) },
  { re: /^\s*(?:public|protected|private)?\s*enum\s+(?<name>[\w]+)/, kind: "enum", exported: (_m, l) => /\bpublic\b/.test(l) },
  { re: /^\s*(?:public|protected|private)\s+(?:static\s+|final\s+|abstract\s+|synchronized\s+)*[\w<>\[\],.?\s]+\s+(?<name>[\w]+)\s*\(/, kind: "method", exported: (_m, l) => /\bpublic\b/.test(l) }
];
var java = {
  lang: "java",
  exts: [".java"],
  extract(rel, content) {
    return scan(rel, content, "java", RULES5);
  }
};

// src/lang/rust.ts
var isPub = (_m, l) => /^\s*pub\b/.test(l);
var RULES6 = [
  { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(?<name>[\w]+)/, kind: "function", exported: isPub },
  { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+(?<name>[\w]+)/, kind: "struct", exported: isPub },
  { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+(?<name>[\w]+)/, kind: "enum", exported: isPub },
  { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+(?<name>[\w]+)/, kind: "trait", exported: isPub },
  { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?type\s+(?<name>[\w]+)/, kind: "type", exported: isPub }
];
var rust = {
  lang: "rust",
  exts: [".rs"],
  extract(rel, content) {
    return scan(rel, content, "rust", RULES6);
  }
};

// src/lang/csharp.ts
var pub2 = (_m, l) => /\b(public|internal)\b/.test(l);
var RULES7 = [
  { re: /^\s*(?:public|internal|protected|private)?\s*(?:static\s+|sealed\s+|abstract\s+|partial\s+)*(?:class|record)\s+(?<name>\w+)/, kind: "class", exported: pub2 },
  { re: /^\s*(?:public|internal|protected|private)?\s*(?:partial\s+)?interface\s+(?<name>\w+)/, kind: "interface", exported: pub2 },
  { re: /^\s*(?:public|internal|protected|private)?\s*(?:readonly\s+)?(?:ref\s+)?struct\s+(?<name>\w+)/, kind: "struct", exported: pub2 },
  { re: /^\s*(?:public|internal|protected|private)?\s*enum\s+(?<name>\w+)/, kind: "enum", exported: pub2 },
  // method: a visibility modifier, a return type, then `name(`
  { re: /^\s*(?:public|internal|protected|private)\s+(?:static\s+|virtual\s+|override\s+|async\s+|sealed\s+|abstract\s+|new\s+)*[\w<>\[\],.?]+\s+(?<name>\w+)\s*(?:<[^>]*>)?\s*\(/, kind: "method", exported: pub2 }
];
var csharp = {
  lang: "csharp",
  exts: [".cs"],
  extract(rel, content) {
    return scan(rel, content, "csharp", RULES7);
  }
};

// src/lang/php.ts
var RULES8 = [
  { re: /^\s*(?:abstract\s+|final\s+)*class\s+(?<name>\w+)/, kind: "class", exported: true },
  { re: /^\s*interface\s+(?<name>\w+)/, kind: "interface", exported: true },
  { re: /^\s*trait\s+(?<name>\w+)/, kind: "trait", exported: true },
  { re: /^\s*enum\s+(?<name>\w+)/, kind: "enum", exported: true },
  {
    re: /^\s*(?:public\s+|protected\s+|private\s+|static\s+|abstract\s+|final\s+)*function\s+(?<name>\w+)\s*\(/,
    kind: "function",
    exported: (_m, l) => !/\b(private|protected)\b/.test(l)
  }
];
var php = {
  lang: "php",
  exts: [".php"],
  extract(rel, content) {
    return scan(rel, content, "php", RULES8);
  }
};

// src/lang/swift.ts
var vis = (_m, l) => !/\b(private|fileprivate)\b/.test(l);
var MODS = "(?:public\\s+|open\\s+|internal\\s+|private\\s+|fileprivate\\s+)?(?:final\\s+)?";
var RULES9 = [
  { re: new RegExp(`^\\s*${MODS}class\\s+(?<name>\\w+)`), kind: "class", exported: vis },
  { re: new RegExp(`^\\s*${MODS}struct\\s+(?<name>\\w+)`), kind: "struct", exported: vis },
  { re: new RegExp(`^\\s*${MODS}enum\\s+(?<name>\\w+)`), kind: "enum", exported: vis },
  { re: new RegExp(`^\\s*${MODS}protocol\\s+(?<name>\\w+)`), kind: "protocol", exported: vis },
  { re: /^\s*(?:public\s+|open\s+|internal\s+|private\s+|fileprivate\s+)?(?:static\s+|class\s+|final\s+|override\s+|mutating\s+|@\w+\s+)*func\s+(?<name>\w+)/, kind: "function", exported: vis }
];
var swift = {
  lang: "swift",
  exts: [".swift"],
  extract(rel, content) {
    return scan(rel, content, "swift", RULES9);
  }
};

// src/lang/kotlin.ts
var vis2 = (_m, l) => !/\b(private|internal)\b/.test(l);
var RULES10 = [
  { re: /^\s*(?:public\s+|internal\s+|private\s+|abstract\s+|sealed\s+|open\s+|final\s+|data\s+)*class\s+(?<name>\w+)/, kind: "class", exported: vis2 },
  { re: /^\s*(?:public\s+|internal\s+|private\s+|fun\s+)?interface\s+(?<name>\w+)/, kind: "interface", exported: vis2 },
  { re: /^\s*(?:public\s+|internal\s+|private\s+|companion\s+)?object\s+(?<name>\w+)/, kind: "object", exported: vis2 },
  { re: /^\s*(?:public\s+|internal\s+|private\s+|protected\s+|override\s+|open\s+|abstract\s+|suspend\s+|inline\s+|operator\s+)*fun\s+(?:<[^>]*>\s+)?(?<name>\w+)\s*\(/, kind: "function", exported: vis2 }
];
var kotlin = {
  lang: "kotlin",
  exts: [".kt", ".kts"],
  extract(rel, content) {
    return scan(rel, content, "kotlin", RULES10);
  }
};

// src/lang/c.ts
var NOT_KEYWORD = "(?!\\s*(?:if|for|while|switch|return|else|do|sizeof|typedef)\\b)";
var RULES11 = [
  // C++ types
  { re: /^\s*(?:class|struct)\s+(?<name>[A-Za-z_]\w+)\s*(?:[:{]|$)/, kind: "class", exported: true },
  { re: /^\s*namespace\s+(?<name>[A-Za-z_]\w+)/, kind: "namespace", exported: true },
  // typedef struct/enum/union NAME {
  { re: /^\s*(?:typedef\s+)?(?:struct|enum|union)\s+(?<name>[A-Za-z_]\w+)\s*\{/, kind: "struct", exported: true },
  // function definition: <type ...> name(<args>) [const] {?  at column 0-ish
  { re: new RegExp(`^${NOT_KEYWORD}[A-Za-z_][\\w\\s\\*&<>:,]*?\\b(?<name>[A-Za-z_]\\w+)\\s*\\([^;{]*\\)\\s*(?:const)?\\s*\\{?\\s*$`), kind: "function", exported: true }
];
var c = {
  lang: "c/cpp",
  exts: [".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hh"],
  extract(rel, content) {
    return scan(rel, content, rel.match(/\.(c|h)$/) ? "c" : "cpp", RULES11);
  }
};

// src/lang/lua.ts
var RULES12 = [
  { re: /^\s*local\s+function\s+(?<name>[\w.:]+)\s*\(/, kind: "function", exported: false },
  { re: /^\s*function\s+(?<name>[\w.:]+)\s*\(/, kind: "function", exported: true },
  { re: /^\s*(?:local\s+)?(?<name>[\w.]+)\s*=\s*function\s*\(/, kind: "function", exported: true }
];
var lua = {
  lang: "lua",
  exts: [".lua"],
  extract(rel, content) {
    return scan(rel, content, "lua", RULES12);
  }
};

// src/lang/shell.ts
var RULES13 = [
  { re: /^\s*function\s+(?<name>[\w:-]+)\s*(?:\(\))?\s*\{?/, kind: "function", exported: true },
  { re: /^\s*(?<name>[A-Za-z_][\w:-]*)\s*\(\)\s*\{?/, kind: "function", exported: true }
];
var shell = {
  lang: "shell",
  exts: [".sh", ".bash", ".zsh", ".ksh"],
  extract(rel, content) {
    return scan(rel, content, "shell", RULES13);
  }
};

// src/lang/elixir.ts
var RULES14 = [
  { re: /^\s*defmodule\s+(?<name>[\w.]+)/, kind: "module", exported: true },
  { re: /^\s*defp\s+(?<name>[\w?!]+)/, kind: "function", exported: false },
  { re: /^\s*def\s+(?<name>[\w?!]+)/, kind: "function", exported: true },
  { re: /^\s*defmacrop?\s+(?<name>[\w?!]+)/, kind: "macro", exported: true }
];
var elixir = {
  lang: "elixir",
  exts: [".ex", ".exs"],
  extract(rel, content) {
    return scan(rel, content, "elixir", RULES14);
  }
};

// src/lang/scala.ts
var RULES15 = [
  { re: /^\s*(?:final\s+|sealed\s+|abstract\s+|implicit\s+)*(?:case\s+)?class\s+(?<name>\w+)/, kind: "class", exported: true },
  { re: /^\s*(?:sealed\s+)?trait\s+(?<name>\w+)/, kind: "trait", exported: true },
  { re: /^\s*(?:case\s+)?object\s+(?<name>\w+)/, kind: "object", exported: true },
  { re: /^\s*(?:override\s+|final\s+|private\s+|protected\s+|implicit\s+)*def\s+(?<name>\w+)/, kind: "def", exported: (_m, l) => !/\b(private|protected)\b/.test(l) }
];
var scala = {
  lang: "scala",
  exts: [".scala", ".sc"],
  extract(rel, content) {
    return scan(rel, content, "scala", RULES15);
  }
};

// src/lang/registry.ts
var EXTRACTORS = [
  jsTs,
  python,
  go,
  ruby,
  java,
  rust,
  csharp,
  php,
  swift,
  kotlin,
  c,
  lua,
  shell,
  elixir,
  scala
];
var BY_EXT = /* @__PURE__ */ new Map();
for (const e of EXTRACTORS) for (const ext of e.exts) BY_EXT.set(ext, e);
function extractSymbols(rel, ext, content) {
  const extractor = BY_EXT.get(ext);
  if (!extractor) return [];
  try {
    return extractor.extract(rel, content);
  } catch {
    return [];
  }
}
function languageOf(ext) {
  return BY_EXT.get(ext)?.lang ?? extToLang(ext);
}

// src/classify.ts
var DOC_BASENAME = /^(readme|changelog|contributing|history|news|authors|notice|security|code_of_conduct|faq|getting[-_]?started|usage|guide|tutorial)\b/i;
var DOC_EXT = /* @__PURE__ */ new Set([".md", ".mdx", ".rst", ".adoc", ".txt"]);
var DOC_DIR = /^(docs?|documentation|wiki|guides?|website|site|book)\//i;
var CONFIG_BASENAME = /* @__PURE__ */ new Set([
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "jsconfig.json",
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "requirements.txt",
  "pipfile",
  "go.mod",
  "cargo.toml",
  "gemfile",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "composer.json",
  "mix.exs",
  "pubspec.yaml",
  "build.sbt",
  "dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "makefile",
  ".env.example",
  "manifest.json"
]);
var CONFIG_EXT = /* @__PURE__ */ new Set([".json", ".yaml", ".yml", ".toml", ".ini", ".cfg"]);
var MARKDOWN_EXT = /* @__PURE__ */ new Set([".md", ".mdx"]);
function isDoc(rel, ext) {
  const base = rel.split("/").pop().toLowerCase();
  return DOC_EXT.has(ext) || DOC_BASENAME.test(base) || DOC_DIR.test(rel);
}
function isConfig(rel, ext) {
  const base = rel.split("/").pop().toLowerCase();
  return CONFIG_BASENAME.has(base) || CONFIG_EXT.has(ext);
}
var NON_CODE_LANGS = /* @__PURE__ */ new Set([
  "markdown",
  "restructuredtext",
  "text",
  "json",
  "yaml",
  "toml",
  "ini",
  "other",
  "html",
  "css",
  "scss"
]);
function isCode(ext) {
  return !NON_CODE_LANGS.has(languageOf(ext));
}
function classify(rel, ext) {
  if (isCode(ext)) return "code";
  if (isDoc(rel, ext)) return "doc";
  if (isConfig(rel, ext)) return "config";
  return "other";
}

// src/glob.ts
function globToRegExp(glob) {
  let re = "";
  for (let i2 = 0; i2 < glob.length; i2++) {
    const c2 = glob[i2];
    if (c2 === "*") {
      if (glob[i2 + 1] === "*") {
        i2++;
        if (glob[i2 + 1] === "/") {
          i2++;
          re += "(?:.*/)?";
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*";
      }
    } else if (c2 === "?") {
      re += "[^/]";
    } else {
      re += escapeRegExp(c2);
    }
  }
  return new RegExp(`^${re}$`);
}
function compileGlobs(globs) {
  if (!globs || globs.length === 0) return null;
  const res = globs.map(globToRegExp);
  return (rel) => res.some((r) => r.test(rel));
}

// src/sort.ts
function byStr(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function byKey(keyOf2) {
  return (a, b) => byStr(keyOf2(a), keyOf2(b));
}

// src/extract/markdown.ts
function stripFences(content) {
  const lines = content.split(/\r?\n/);
  const out2 = [];
  let fence2 = null;
  for (const line of lines) {
    const m = /^\s*(```+|~~~+)/.exec(line);
    if (fence2) {
      if (m && line.trim().startsWith(fence2[0][0].repeat(3).slice(0, 3))) fence2 = null;
      out2.push("");
      continue;
    }
    if (m) {
      fence2 = m[1];
      out2.push("");
      continue;
    }
    out2.push(line);
  }
  return out2.join("\n");
}
function isExternalTarget(spec) {
  if (!spec) return true;
  if (spec.startsWith("#")) return true;
  if (spec.startsWith("//")) return true;
  return /^[a-z][a-z0-9+.-]*:/i.test(spec);
}
function cleanProse(line) {
  return line.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/`([^`]*)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#>*_~-]+/g, " ").replace(/\s+/g, " ").trim();
}
function hasProse(s) {
  return /[A-Za-zÀ-ɏ]{3,}/.test(s);
}
function isBoilerplate(s) {
  return /^(all notable changes to this project|in the interest of fostering|this project adheres to|we as members and leaders|table of contents)\b/i.test(s);
}
function extractMarkdown(content) {
  let body2 = content;
  let frontTitle;
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(body2);
  if (fm) {
    const t = /(^|\n)title:\s*["']?(.+?)["']?\s*(\n|$)/i.exec(fm[1]);
    if (t) frontTitle = t[2].trim();
    body2 = body2.slice(fm[0].length);
  }
  const scan2 = stripFences(body2);
  const lines = scan2.split(/\r?\n/);
  const headings = [];
  let title = frontTitle;
  let summary;
  let summaryClosed = false;
  for (const line of lines) {
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      const text = cleanProse(h[2]);
      headings.push(text);
      if (!title && h[1].length === 1) title = text;
      if (!summary && h[1].length >= 2) summaryClosed = true;
      continue;
    }
    if (!summary && !summaryClosed) {
      const t = line.trim();
      if (t && !/^([-*+]|\d+\.)\s/.test(t) && !t.startsWith("|") && !t.startsWith("<")) {
        const cleaned = cleanProse(t);
        if (cleaned.length >= 8 && hasProse(cleaned) && !cleaned.endsWith(":") && !isBoilerplate(cleaned)) {
          summary = cleaned.slice(0, 200);
        }
      }
    }
  }
  const refs = [];
  const seen = /* @__PURE__ */ new Set();
  const addRef = (raw) => {
    let spec = raw.trim();
    spec = spec.replace(/\s+["'(].*$/, "").trim();
    spec = spec.replace(/^<|>$/g, "");
    if (isExternalTarget(spec)) return;
    if (seen.has(spec)) return;
    seen.add(spec);
    refs.push({ kind: "doc-link", spec });
  };
  const inline = /!?\[[^\]]*\]\(([^)]+)\)/g;
  let m;
  while (m = inline.exec(scan2)) addRef(m[1]);
  const refdef = /^\s*\[[^\]]+\]:\s+(\S+)/gm;
  while (m = refdef.exec(scan2)) addRef(m[1]);
  return { title, summary, headings, refs };
}

// src/ast/loader.ts
import { readFileSync as readFileSync2, existsSync } from "fs";
import { dirname, join as join2 } from "path";
import { fileURLToPath } from "url";

// node_modules/.pnpm/web-tree-sitter@0.26.10/node_modules/web-tree-sitter/web-tree-sitter.js
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var Edit = class {
  static {
    __name(this, "Edit");
  }
  /** The start position of the change. */
  startPosition;
  /** The end position of the change before the edit. */
  oldEndPosition;
  /** The end position of the change after the edit. */
  newEndPosition;
  /** The start index of the change. */
  startIndex;
  /** The end index of the change before the edit. */
  oldEndIndex;
  /** The end index of the change after the edit. */
  newEndIndex;
  constructor({
    startIndex,
    oldEndIndex,
    newEndIndex,
    startPosition,
    oldEndPosition,
    newEndPosition
  }) {
    this.startIndex = startIndex >>> 0;
    this.oldEndIndex = oldEndIndex >>> 0;
    this.newEndIndex = newEndIndex >>> 0;
    this.startPosition = startPosition;
    this.oldEndPosition = oldEndPosition;
    this.newEndPosition = newEndPosition;
  }
  /**
   * Edit a point and index to keep it in-sync with source code that has been edited.
   *
   * This function updates a single point's byte offset and row/column position
   * based on an edit operation. This is useful for editing points without
   * requiring a tree or node instance.
   */
  editPoint(point, index) {
    let newIndex = index;
    const newPoint = { ...point };
    if (index >= this.oldEndIndex) {
      newIndex = this.newEndIndex + (index - this.oldEndIndex);
      const originalRow = point.row;
      newPoint.row = this.newEndPosition.row + (point.row - this.oldEndPosition.row);
      newPoint.column = originalRow === this.oldEndPosition.row ? this.newEndPosition.column + (point.column - this.oldEndPosition.column) : point.column;
    } else if (index > this.startIndex) {
      newIndex = this.newEndIndex;
      newPoint.row = this.newEndPosition.row;
      newPoint.column = this.newEndPosition.column;
    }
    return { point: newPoint, index: newIndex };
  }
  /**
   * Edit a range to keep it in-sync with source code that has been edited.
   *
   * This function updates a range's start and end positions based on an edit
   * operation. This is useful for editing ranges without requiring a tree
   * or node instance.
   */
  editRange(range) {
    const newRange = {
      startIndex: range.startIndex,
      startPosition: { ...range.startPosition },
      endIndex: range.endIndex,
      endPosition: { ...range.endPosition }
    };
    if (range.endIndex >= this.oldEndIndex) {
      if (range.endIndex !== Number.MAX_SAFE_INTEGER) {
        newRange.endIndex = this.newEndIndex + (range.endIndex - this.oldEndIndex);
        newRange.endPosition = {
          row: this.newEndPosition.row + (range.endPosition.row - this.oldEndPosition.row),
          column: range.endPosition.row === this.oldEndPosition.row ? this.newEndPosition.column + (range.endPosition.column - this.oldEndPosition.column) : range.endPosition.column
        };
        if (newRange.endIndex < this.newEndIndex) {
          newRange.endIndex = Number.MAX_SAFE_INTEGER;
          newRange.endPosition = { row: Number.MAX_SAFE_INTEGER, column: Number.MAX_SAFE_INTEGER };
        }
      }
    } else if (range.endIndex > this.startIndex) {
      newRange.endIndex = this.startIndex;
      newRange.endPosition = { ...this.startPosition };
    }
    if (range.startIndex >= this.oldEndIndex) {
      newRange.startIndex = this.newEndIndex + (range.startIndex - this.oldEndIndex);
      newRange.startPosition = {
        row: this.newEndPosition.row + (range.startPosition.row - this.oldEndPosition.row),
        column: range.startPosition.row === this.oldEndPosition.row ? this.newEndPosition.column + (range.startPosition.column - this.oldEndPosition.column) : range.startPosition.column
      };
      if (newRange.startIndex < this.newEndIndex) {
        newRange.startIndex = Number.MAX_SAFE_INTEGER;
        newRange.startPosition = { row: Number.MAX_SAFE_INTEGER, column: Number.MAX_SAFE_INTEGER };
      }
    } else if (range.startIndex > this.startIndex) {
      newRange.startIndex = this.startIndex;
      newRange.startPosition = { ...this.startPosition };
    }
    return newRange;
  }
};
var SIZE_OF_SHORT = 2;
var SIZE_OF_INT = 4;
var SIZE_OF_CURSOR = 4 * SIZE_OF_INT;
var SIZE_OF_NODE = 5 * SIZE_OF_INT;
var SIZE_OF_POINT = 2 * SIZE_OF_INT;
var SIZE_OF_RANGE = 2 * SIZE_OF_INT + 2 * SIZE_OF_POINT;
var ZERO_POINT = { row: 0, column: 0 };
var INTERNAL = /* @__PURE__ */ Symbol("INTERNAL");
function assertInternal(x) {
  if (x !== INTERNAL) throw new Error("Illegal constructor");
}
__name(assertInternal, "assertInternal");
function isPoint(point) {
  return !!point && typeof point.row === "number" && typeof point.column === "number";
}
__name(isPoint, "isPoint");
function setModule(module2) {
  C = module2;
}
__name(setModule, "setModule");
var C;
var LookaheadIterator = class {
  static {
    __name(this, "LookaheadIterator");
  }
  /** @internal */
  [0] = 0;
  // Internal handle for Wasm
  /** @internal */
  language;
  /** @internal */
  constructor(internal, address, language) {
    assertInternal(internal);
    this[0] = address;
    this.language = language;
  }
  /** Get the current symbol of the lookahead iterator. */
  get currentTypeId() {
    return C._ts_lookahead_iterator_current_symbol(this[0]);
  }
  /** Get the current symbol name of the lookahead iterator. */
  get currentType() {
    return this.language.types[this.currentTypeId] || "ERROR";
  }
  /** Delete the lookahead iterator, freeing its resources. */
  delete() {
    C._ts_lookahead_iterator_delete(this[0]);
    this[0] = 0;
  }
  /**
   * Reset the lookahead iterator.
   *
   * This returns `true` if the language was set successfully and `false`
   * otherwise.
   */
  reset(language, stateId) {
    if (C._ts_lookahead_iterator_reset(this[0], language[0], stateId)) {
      this.language = language;
      return true;
    }
    return false;
  }
  /**
   * Reset the lookahead iterator to another state.
   *
   * This returns `true` if the iterator was reset to the given state and
   * `false` otherwise.
   */
  resetState(stateId) {
    return Boolean(C._ts_lookahead_iterator_reset_state(this[0], stateId));
  }
  /**
   * Returns an iterator that iterates over the symbols of the lookahead iterator.
   *
   * The iterator will yield the current symbol name as a string for each step
   * until there are no more symbols to iterate over.
   */
  [Symbol.iterator]() {
    return {
      next: /* @__PURE__ */ __name(() => {
        if (C._ts_lookahead_iterator_next(this[0])) {
          return { done: false, value: this.currentType };
        }
        return { done: true, value: "" };
      }, "next")
    };
  }
};
function getText(tree, startIndex, endIndex, startPosition) {
  const length = endIndex - startIndex;
  let result = tree.textCallback(startIndex, startPosition);
  if (result) {
    startIndex += result.length;
    while (startIndex < endIndex) {
      const string = tree.textCallback(startIndex, startPosition);
      if (string && string.length > 0) {
        startIndex += string.length;
        result += string;
      } else {
        break;
      }
    }
    if (startIndex > endIndex) {
      result = result.slice(0, length);
    }
  }
  return result ?? "";
}
__name(getText, "getText");
var Tree = class _Tree {
  static {
    __name(this, "Tree");
  }
  /** @internal */
  [0] = 0;
  // Internal handle for Wasm
  /** @internal */
  textCallback;
  /** The language that was used to parse the syntax tree. */
  language;
  /** @internal */
  constructor(internal, address, language, textCallback) {
    assertInternal(internal);
    this[0] = address;
    this.language = language;
    this.textCallback = textCallback;
  }
  /** Create a shallow copy of the syntax tree. This is very fast. */
  copy() {
    const address = C._ts_tree_copy(this[0]);
    return new _Tree(INTERNAL, address, this.language, this.textCallback);
  }
  /** Delete the syntax tree, freeing its resources. */
  delete() {
    C._ts_tree_delete(this[0]);
    this[0] = 0;
  }
  /** Get the root node of the syntax tree. */
  get rootNode() {
    C._ts_tree_root_node_wasm(this[0]);
    return unmarshalNode(this);
  }
  /**
   * Get the root node of the syntax tree, but with its position shifted
   * forward by the given offset.
   */
  rootNodeWithOffset(offsetBytes, offsetExtent) {
    const address = TRANSFER_BUFFER + SIZE_OF_NODE;
    C.setValue(address, offsetBytes, "i32");
    marshalPoint(address + SIZE_OF_INT, offsetExtent);
    C._ts_tree_root_node_with_offset_wasm(this[0]);
    return unmarshalNode(this);
  }
  /**
   * Edit the syntax tree to keep it in sync with source code that has been
   * edited.
   *
   * You must describe the edit both in terms of byte offsets and in terms of
   * row/column coordinates.
   */
  edit(edit) {
    marshalEdit(edit);
    C._ts_tree_edit_wasm(this[0]);
  }
  /** Create a new {@link TreeCursor} starting from the root of the tree. */
  walk() {
    return this.rootNode.walk();
  }
  /**
   * Compare this old edited syntax tree to a new syntax tree representing
   * the same document, returning a sequence of ranges whose syntactic
   * structure has changed.
   *
   * For this to work correctly, this syntax tree must have been edited such
   * that its ranges match up to the new tree. Generally, you'll want to
   * call this method right after calling one of the [`Parser::parse`]
   * functions. Call it on the old tree that was passed to parse, and
   * pass the new tree that was returned from `parse`.
   */
  getChangedRanges(other) {
    if (!(other instanceof _Tree)) {
      throw new TypeError("Argument must be a Tree");
    }
    C._ts_tree_get_changed_ranges_wasm(this[0], other[0]);
    const count = C.getValue(TRANSFER_BUFFER, "i32");
    const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
    const result = new Array(count);
    if (count > 0) {
      let address = buffer;
      for (let i2 = 0; i2 < count; i2++) {
        result[i2] = unmarshalRange(address);
        address += SIZE_OF_RANGE;
      }
      C._free(buffer);
    }
    return result;
  }
  /** Get the included ranges that were used to parse the syntax tree. */
  getIncludedRanges() {
    C._ts_tree_included_ranges_wasm(this[0]);
    const count = C.getValue(TRANSFER_BUFFER, "i32");
    const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
    const result = new Array(count);
    if (count > 0) {
      let address = buffer;
      for (let i2 = 0; i2 < count; i2++) {
        result[i2] = unmarshalRange(address);
        address += SIZE_OF_RANGE;
      }
      C._free(buffer);
    }
    return result;
  }
};
var TreeCursor = class _TreeCursor {
  static {
    __name(this, "TreeCursor");
  }
  /** @internal */
  // @ts-expect-error: never read
  [0] = 0;
  // Internal handle for Wasm
  /** @internal */
  // @ts-expect-error: never read
  [1] = 0;
  // Internal handle for Wasm
  /** @internal */
  // @ts-expect-error: never read
  [2] = 0;
  // Internal handle for Wasm
  /** @internal */
  // @ts-expect-error: never read
  [3] = 0;
  // Internal handle for Wasm
  /** @internal */
  tree;
  /** @internal */
  constructor(internal, tree) {
    assertInternal(internal);
    this.tree = tree;
    unmarshalTreeCursor(this);
  }
  /** Creates a deep copy of the tree cursor. This allocates new memory. */
  copy() {
    const copy = new _TreeCursor(INTERNAL, this.tree);
    C._ts_tree_cursor_copy_wasm(this.tree[0]);
    unmarshalTreeCursor(copy);
    return copy;
  }
  /** Delete the tree cursor, freeing its resources. */
  delete() {
    marshalTreeCursor(this);
    C._ts_tree_cursor_delete_wasm(this.tree[0]);
    this[0] = this[1] = this[2] = 0;
  }
  /** Get the tree cursor's current {@link Node}. */
  get currentNode() {
    marshalTreeCursor(this);
    C._ts_tree_cursor_current_node_wasm(this.tree[0]);
    return unmarshalNode(this.tree);
  }
  /**
   * Get the numerical field id of this tree cursor's current node.
   *
   * See also {@link TreeCursor#currentFieldName}.
   */
  get currentFieldId() {
    marshalTreeCursor(this);
    return C._ts_tree_cursor_current_field_id_wasm(this.tree[0]);
  }
  /** Get the field name of this tree cursor's current node. */
  get currentFieldName() {
    return this.tree.language.fields[this.currentFieldId];
  }
  /**
   * Get the depth of the cursor's current node relative to the original
   * node that the cursor was constructed with.
   */
  get currentDepth() {
    marshalTreeCursor(this);
    return C._ts_tree_cursor_current_depth_wasm(this.tree[0]);
  }
  /**
   * Get the index of the cursor's current node out of all of the
   * descendants of the original node that the cursor was constructed with.
   */
  get currentDescendantIndex() {
    marshalTreeCursor(this);
    return C._ts_tree_cursor_current_descendant_index_wasm(this.tree[0]);
  }
  /** Get the type of the cursor's current node. */
  get nodeType() {
    return this.tree.language.types[this.nodeTypeId] || "ERROR";
  }
  /** Get the type id of the cursor's current node. */
  get nodeTypeId() {
    marshalTreeCursor(this);
    return C._ts_tree_cursor_current_node_type_id_wasm(this.tree[0]);
  }
  /** Get the state id of the cursor's current node. */
  get nodeStateId() {
    marshalTreeCursor(this);
    return C._ts_tree_cursor_current_node_state_id_wasm(this.tree[0]);
  }
  /** Get the id of the cursor's current node. */
  get nodeId() {
    marshalTreeCursor(this);
    return C._ts_tree_cursor_current_node_id_wasm(this.tree[0]);
  }
  /**
   * Check if the cursor's current node is *named*.
   *
   * Named nodes correspond to named rules in the grammar, whereas
   * *anonymous* nodes correspond to string literals in the grammar.
   */
  get nodeIsNamed() {
    marshalTreeCursor(this);
    return C._ts_tree_cursor_current_node_is_named_wasm(this.tree[0]) === 1;
  }
  /**
   * Check if the cursor's current node is *missing*.
   *
   * Missing nodes are inserted by the parser in order to recover from
   * certain kinds of syntax errors.
   */
  get nodeIsMissing() {
    marshalTreeCursor(this);
    return C._ts_tree_cursor_current_node_is_missing_wasm(this.tree[0]) === 1;
  }
  /** Get the string content of the cursor's current node. */
  get nodeText() {
    marshalTreeCursor(this);
    const startIndex = C._ts_tree_cursor_start_index_wasm(this.tree[0]);
    const endIndex = C._ts_tree_cursor_end_index_wasm(this.tree[0]);
    C._ts_tree_cursor_start_position_wasm(this.tree[0]);
    const startPosition = unmarshalPoint(TRANSFER_BUFFER);
    return getText(this.tree, startIndex, endIndex, startPosition);
  }
  /** Get the start position of the cursor's current node. */
  get startPosition() {
    marshalTreeCursor(this);
    C._ts_tree_cursor_start_position_wasm(this.tree[0]);
    return unmarshalPoint(TRANSFER_BUFFER);
  }
  /** Get the end position of the cursor's current node. */
  get endPosition() {
    marshalTreeCursor(this);
    C._ts_tree_cursor_end_position_wasm(this.tree[0]);
    return unmarshalPoint(TRANSFER_BUFFER);
  }
  /** Get the start index of the cursor's current node. */
  get startIndex() {
    marshalTreeCursor(this);
    return C._ts_tree_cursor_start_index_wasm(this.tree[0]);
  }
  /** Get the end index of the cursor's current node. */
  get endIndex() {
    marshalTreeCursor(this);
    return C._ts_tree_cursor_end_index_wasm(this.tree[0]);
  }
  /**
   * Move this cursor to the first child of its current node.
   *
   * This returns `true` if the cursor successfully moved, and returns
   * `false` if there were no children.
   */
  gotoFirstChild() {
    marshalTreeCursor(this);
    const result = C._ts_tree_cursor_goto_first_child_wasm(this.tree[0]);
    unmarshalTreeCursor(this);
    return result === 1;
  }
  /**
   * Move this cursor to the last child of its current node.
   *
   * This returns `true` if the cursor successfully moved, and returns
   * `false` if there were no children.
   *
   * Note that this function may be slower than
   * {@link TreeCursor#gotoFirstChild} because it needs to
   * iterate through all the children to compute the child's position.
   */
  gotoLastChild() {
    marshalTreeCursor(this);
    const result = C._ts_tree_cursor_goto_last_child_wasm(this.tree[0]);
    unmarshalTreeCursor(this);
    return result === 1;
  }
  /**
   * Move this cursor to the parent of its current node.
   *
   * This returns `true` if the cursor successfully moved, and returns
   * `false` if there was no parent node (the cursor was already on the
   * root node).
   *
   * Note that the node the cursor was constructed with is considered the root
   * of the cursor, and the cursor cannot walk outside this node.
   */
  gotoParent() {
    marshalTreeCursor(this);
    const result = C._ts_tree_cursor_goto_parent_wasm(this.tree[0]);
    unmarshalTreeCursor(this);
    return result === 1;
  }
  /**
   * Move this cursor to the next sibling of its current node.
   *
   * This returns `true` if the cursor successfully moved, and returns
   * `false` if there was no next sibling node.
   *
   * Note that the node the cursor was constructed with is considered the root
   * of the cursor, and the cursor cannot walk outside this node.
   */
  gotoNextSibling() {
    marshalTreeCursor(this);
    const result = C._ts_tree_cursor_goto_next_sibling_wasm(this.tree[0]);
    unmarshalTreeCursor(this);
    return result === 1;
  }
  /**
   * Move this cursor to the previous sibling of its current node.
   *
   * This returns `true` if the cursor successfully moved, and returns
   * `false` if there was no previous sibling node.
   *
   * Note that this function may be slower than
   * {@link TreeCursor#gotoNextSibling} due to how node
   * positions are stored. In the worst case, this will need to iterate
   * through all the children up to the previous sibling node to recalculate
   * its position. Also note that the node the cursor was constructed with is
   * considered the root of the cursor, and the cursor cannot walk outside this node.
   */
  gotoPreviousSibling() {
    marshalTreeCursor(this);
    const result = C._ts_tree_cursor_goto_previous_sibling_wasm(this.tree[0]);
    unmarshalTreeCursor(this);
    return result === 1;
  }
  /**
   * Move the cursor to the node that is the nth descendant of
   * the original node that the cursor was constructed with, where
   * zero represents the original node itself.
   */
  gotoDescendant(goalDescendantIndex) {
    marshalTreeCursor(this);
    C._ts_tree_cursor_goto_descendant_wasm(this.tree[0], goalDescendantIndex);
    unmarshalTreeCursor(this);
  }
  /**
   * Move this cursor to the first child of its current node that contains or
   * starts after the given byte offset.
   *
   * This returns `true` if the cursor successfully moved to a child node, and returns
   * `false` if no such child was found.
   */
  gotoFirstChildForIndex(goalIndex) {
    marshalTreeCursor(this);
    C.setValue(TRANSFER_BUFFER + SIZE_OF_CURSOR, goalIndex, "i32");
    const result = C._ts_tree_cursor_goto_first_child_for_index_wasm(this.tree[0]);
    unmarshalTreeCursor(this);
    return result === 1;
  }
  /**
   * Move this cursor to the first child of its current node that contains or
   * starts after the given byte offset.
   *
   * This returns the index of the child node if one was found, and returns
   * `null` if no such child was found.
   */
  gotoFirstChildForPosition(goalPosition) {
    marshalTreeCursor(this);
    marshalPoint(TRANSFER_BUFFER + SIZE_OF_CURSOR, goalPosition);
    const result = C._ts_tree_cursor_goto_first_child_for_position_wasm(this.tree[0]);
    unmarshalTreeCursor(this);
    return result === 1;
  }
  /**
   * Re-initialize this tree cursor to start at the original node that the
   * cursor was constructed with.
   */
  reset(node) {
    marshalNode(node);
    marshalTreeCursor(this, TRANSFER_BUFFER + SIZE_OF_NODE);
    C._ts_tree_cursor_reset_wasm(this.tree[0]);
    unmarshalTreeCursor(this);
  }
  /**
   * Re-initialize a tree cursor to the same position as another cursor.
   *
   * Unlike {@link TreeCursor#reset}, this will not lose parent
   * information and allows reusing already created cursors.
   */
  resetTo(cursor) {
    marshalTreeCursor(this, TRANSFER_BUFFER);
    marshalTreeCursor(cursor, TRANSFER_BUFFER + SIZE_OF_CURSOR);
    C._ts_tree_cursor_reset_to_wasm(this.tree[0], cursor.tree[0]);
    unmarshalTreeCursor(this);
  }
};
var Node = class {
  static {
    __name(this, "Node");
  }
  /** @internal */
  // @ts-expect-error: never read
  [0] = 0;
  // Internal handle for Wasm
  /** @internal */
  _children;
  /** @internal */
  _namedChildren;
  /** @internal */
  constructor(internal, {
    id,
    tree,
    startIndex,
    startPosition,
    other
  }) {
    assertInternal(internal);
    this[0] = other;
    this.id = id;
    this.tree = tree;
    this.startIndex = startIndex;
    this.startPosition = startPosition;
  }
  /**
   * The numeric id for this node that is unique.
   *
   * Within a given syntax tree, no two nodes have the same id. However:
   *
   * * If a new tree is created based on an older tree, and a node from the old tree is reused in
   *   the process, then that node will have the same id in both trees.
   *
   * * A node not marked as having changes does not guarantee it was reused.
   *
   * * If a node is marked as having changed in the old tree, it will not be reused.
   */
  id;
  /** The byte index where this node starts. */
  startIndex;
  /** The position where this node starts. */
  startPosition;
  /** The tree that this node belongs to. */
  tree;
  /** Get this node's type as a numerical id. */
  get typeId() {
    marshalNode(this);
    return C._ts_node_symbol_wasm(this.tree[0]);
  }
  /**
   * Get the node's type as a numerical id as it appears in the grammar,
   * ignoring aliases.
   */
  get grammarId() {
    marshalNode(this);
    return C._ts_node_grammar_symbol_wasm(this.tree[0]);
  }
  /** Get this node's type as a string. */
  get type() {
    return this.tree.language.types[this.typeId] || "ERROR";
  }
  /**
   * Get this node's symbol name as it appears in the grammar, ignoring
   * aliases as a string.
   */
  get grammarType() {
    return this.tree.language.types[this.grammarId] || "ERROR";
  }
  /**
   * Check if this node is *named*.
   *
   * Named nodes correspond to named rules in the grammar, whereas
   * *anonymous* nodes correspond to string literals in the grammar.
   */
  get isNamed() {
    marshalNode(this);
    return C._ts_node_is_named_wasm(this.tree[0]) === 1;
  }
  /**
   * Check if this node is *extra*.
   *
   * Extra nodes represent things like comments, which are not required
   * by the grammar, but can appear anywhere.
   */
  get isExtra() {
    marshalNode(this);
    return C._ts_node_is_extra_wasm(this.tree[0]) === 1;
  }
  /**
   * Check if this node represents a syntax error.
   *
   * Syntax errors represent parts of the code that could not be incorporated
   * into a valid syntax tree.
   */
  get isError() {
    marshalNode(this);
    return C._ts_node_is_error_wasm(this.tree[0]) === 1;
  }
  /**
   * Check if this node is *missing*.
   *
   * Missing nodes are inserted by the parser in order to recover from
   * certain kinds of syntax errors.
   */
  get isMissing() {
    marshalNode(this);
    return C._ts_node_is_missing_wasm(this.tree[0]) === 1;
  }
  /** Check if this node has been edited. */
  get hasChanges() {
    marshalNode(this);
    return C._ts_node_has_changes_wasm(this.tree[0]) === 1;
  }
  /**
   * Check if this node represents a syntax error or contains any syntax
   * errors anywhere within it.
   */
  get hasError() {
    marshalNode(this);
    return C._ts_node_has_error_wasm(this.tree[0]) === 1;
  }
  /** Get the byte index where this node ends. */
  get endIndex() {
    marshalNode(this);
    return C._ts_node_end_index_wasm(this.tree[0]);
  }
  /** Get the position where this node ends. */
  get endPosition() {
    marshalNode(this);
    C._ts_node_end_point_wasm(this.tree[0]);
    return unmarshalPoint(TRANSFER_BUFFER);
  }
  /** Get the string content of this node. */
  get text() {
    return getText(this.tree, this.startIndex, this.endIndex, this.startPosition);
  }
  /** Get this node's parse state. */
  get parseState() {
    marshalNode(this);
    return C._ts_node_parse_state_wasm(this.tree[0]);
  }
  /** Get the parse state after this node. */
  get nextParseState() {
    marshalNode(this);
    return C._ts_node_next_parse_state_wasm(this.tree[0]);
  }
  /** Check if this node is equal to another node. */
  equals(other) {
    return this.tree === other.tree && this.id === other.id;
  }
  /**
   * Get the node's child at the given index, where zero represents the first child.
   *
   * This method is fairly fast, but its cost is technically log(n), so if
   * you might be iterating over a long list of children, you should use
   * {@link Node#children} instead.
   */
  child(index) {
    marshalNode(this);
    C._ts_node_child_wasm(this.tree[0], index);
    return unmarshalNode(this.tree);
  }
  /**
   * Get this node's *named* child at the given index.
   *
   * See also {@link Node#isNamed}.
   * This method is fairly fast, but its cost is technically log(n), so if
   * you might be iterating over a long list of children, you should use
   * {@link Node#namedChildren} instead.
   */
  namedChild(index) {
    marshalNode(this);
    C._ts_node_named_child_wasm(this.tree[0], index);
    return unmarshalNode(this.tree);
  }
  /**
   * Get this node's child with the given numerical field id.
   *
   * See also {@link Node#childForFieldName}. You can
   * convert a field name to an id using {@link Language#fieldIdForName}.
   */
  childForFieldId(fieldId) {
    marshalNode(this);
    C._ts_node_child_by_field_id_wasm(this.tree[0], fieldId);
    return unmarshalNode(this.tree);
  }
  /**
   * Get the first child with the given field name.
   *
   * If multiple children may have the same field name, access them using
   * {@link Node#childrenForFieldName}.
   */
  childForFieldName(fieldName) {
    const fieldId = this.tree.language.fields.indexOf(fieldName);
    if (fieldId !== -1) return this.childForFieldId(fieldId);
    return null;
  }
  /** Get the field name of this node's child at the given index. */
  fieldNameForChild(index) {
    marshalNode(this);
    const address = C._ts_node_field_name_for_child_wasm(this.tree[0], index);
    if (!address) return null;
    return C.AsciiToString(address);
  }
  /** Get the field name of this node's named child at the given index. */
  fieldNameForNamedChild(index) {
    marshalNode(this);
    const address = C._ts_node_field_name_for_named_child_wasm(this.tree[0], index);
    if (!address) return null;
    return C.AsciiToString(address);
  }
  /**
   * Get an array of this node's children with a given field name.
   *
   * See also {@link Node#children}.
   */
  childrenForFieldName(fieldName) {
    const fieldId = this.tree.language.fields.indexOf(fieldName);
    if (fieldId !== -1 && fieldId !== 0) return this.childrenForFieldId(fieldId);
    return [];
  }
  /**
    * Get an array of this node's children with a given field id.
    *
    * See also {@link Node#childrenForFieldName}.
    */
  childrenForFieldId(fieldId) {
    marshalNode(this);
    C._ts_node_children_by_field_id_wasm(this.tree[0], fieldId);
    const count = C.getValue(TRANSFER_BUFFER, "i32");
    const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
    const result = new Array(count);
    if (count > 0) {
      let address = buffer;
      for (let i2 = 0; i2 < count; i2++) {
        result[i2] = unmarshalNode(this.tree, address);
        address += SIZE_OF_NODE;
      }
      C._free(buffer);
    }
    return result;
  }
  /** Get the node's first child that contains or starts after the given byte offset. */
  firstChildForIndex(index) {
    marshalNode(this);
    const address = TRANSFER_BUFFER + SIZE_OF_NODE;
    C.setValue(address, index, "i32");
    C._ts_node_first_child_for_byte_wasm(this.tree[0]);
    return unmarshalNode(this.tree);
  }
  /** Get the node's first named child that contains or starts after the given byte offset. */
  firstNamedChildForIndex(index) {
    marshalNode(this);
    const address = TRANSFER_BUFFER + SIZE_OF_NODE;
    C.setValue(address, index, "i32");
    C._ts_node_first_named_child_for_byte_wasm(this.tree[0]);
    return unmarshalNode(this.tree);
  }
  /** Get this node's number of children. */
  get childCount() {
    marshalNode(this);
    return C._ts_node_child_count_wasm(this.tree[0]);
  }
  /**
   * Get this node's number of *named* children.
   *
   * See also {@link Node#isNamed}.
   */
  get namedChildCount() {
    marshalNode(this);
    return C._ts_node_named_child_count_wasm(this.tree[0]);
  }
  /** Get this node's first child. */
  get firstChild() {
    return this.child(0);
  }
  /**
   * Get this node's first named child.
   *
   * See also {@link Node#isNamed}.
   */
  get firstNamedChild() {
    return this.namedChild(0);
  }
  /** Get this node's last child. */
  get lastChild() {
    return this.child(this.childCount - 1);
  }
  /**
   * Get this node's last named child.
   *
   * See also {@link Node#isNamed}.
   */
  get lastNamedChild() {
    return this.namedChild(this.namedChildCount - 1);
  }
  /**
   * Iterate over this node's children.
   *
   * If you're walking the tree recursively, you may want to use the
   * {@link TreeCursor} APIs directly instead.
   */
  get children() {
    if (!this._children) {
      marshalNode(this);
      C._ts_node_children_wasm(this.tree[0]);
      const count = C.getValue(TRANSFER_BUFFER, "i32");
      const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
      this._children = new Array(count);
      if (count > 0) {
        let address = buffer;
        for (let i2 = 0; i2 < count; i2++) {
          this._children[i2] = unmarshalNode(this.tree, address);
          address += SIZE_OF_NODE;
        }
        C._free(buffer);
      }
    }
    return this._children;
  }
  /**
   * Iterate over this node's named children.
   *
   * See also {@link Node#children}.
   */
  get namedChildren() {
    if (!this._namedChildren) {
      marshalNode(this);
      C._ts_node_named_children_wasm(this.tree[0]);
      const count = C.getValue(TRANSFER_BUFFER, "i32");
      const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
      this._namedChildren = new Array(count);
      if (count > 0) {
        let address = buffer;
        for (let i2 = 0; i2 < count; i2++) {
          this._namedChildren[i2] = unmarshalNode(this.tree, address);
          address += SIZE_OF_NODE;
        }
        C._free(buffer);
      }
    }
    return this._namedChildren;
  }
  /**
   * Get the descendants of this node that are the given type, or in the given types array.
   *
   * The types array should contain node type strings, which can be retrieved from {@link Language#types}.
   *
   * Additionally, a `startPosition` and `endPosition` can be passed in to restrict the search to a byte range.
   */
  descendantsOfType(types, startPosition = ZERO_POINT, endPosition = ZERO_POINT) {
    if (!Array.isArray(types)) types = [types];
    const symbols = [];
    const typesBySymbol = this.tree.language.types;
    for (const node_type of types) {
      if (node_type == "ERROR") {
        symbols.push(65535);
      }
    }
    for (let i2 = 0, n = typesBySymbol.length; i2 < n; i2++) {
      if (types.includes(typesBySymbol[i2])) {
        symbols.push(i2);
      }
    }
    const symbolsAddress = C._malloc(SIZE_OF_INT * symbols.length);
    for (let i2 = 0, n = symbols.length; i2 < n; i2++) {
      C.setValue(symbolsAddress + i2 * SIZE_OF_INT, symbols[i2], "i32");
    }
    marshalNode(this);
    C._ts_node_descendants_of_type_wasm(
      this.tree[0],
      symbolsAddress,
      symbols.length,
      startPosition.row,
      startPosition.column,
      endPosition.row,
      endPosition.column
    );
    const descendantCount = C.getValue(TRANSFER_BUFFER, "i32");
    const descendantAddress = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
    const result = new Array(descendantCount);
    if (descendantCount > 0) {
      let address = descendantAddress;
      for (let i2 = 0; i2 < descendantCount; i2++) {
        result[i2] = unmarshalNode(this.tree, address);
        address += SIZE_OF_NODE;
      }
    }
    C._free(descendantAddress);
    C._free(symbolsAddress);
    return result;
  }
  /** Get this node's next sibling. */
  get nextSibling() {
    marshalNode(this);
    C._ts_node_next_sibling_wasm(this.tree[0]);
    return unmarshalNode(this.tree);
  }
  /** Get this node's previous sibling. */
  get previousSibling() {
    marshalNode(this);
    C._ts_node_prev_sibling_wasm(this.tree[0]);
    return unmarshalNode(this.tree);
  }
  /**
   * Get this node's next *named* sibling.
   *
   * See also {@link Node#isNamed}.
   */
  get nextNamedSibling() {
    marshalNode(this);
    C._ts_node_next_named_sibling_wasm(this.tree[0]);
    return unmarshalNode(this.tree);
  }
  /**
   * Get this node's previous *named* sibling.
   *
   * See also {@link Node#isNamed}.
   */
  get previousNamedSibling() {
    marshalNode(this);
    C._ts_node_prev_named_sibling_wasm(this.tree[0]);
    return unmarshalNode(this.tree);
  }
  /** Get the node's number of descendants, including one for the node itself. */
  get descendantCount() {
    marshalNode(this);
    return C._ts_node_descendant_count_wasm(this.tree[0]);
  }
  /**
   * Get this node's immediate parent.
   * Prefer {@link Node#childWithDescendant} for iterating over this node's ancestors.
   */
  get parent() {
    marshalNode(this);
    C._ts_node_parent_wasm(this.tree[0]);
    return unmarshalNode(this.tree);
  }
  /**
   * Get the node that contains `descendant`.
   *
   * Note that this can return `descendant` itself.
   */
  childWithDescendant(descendant) {
    marshalNode(this);
    marshalNode(descendant, 1);
    C._ts_node_child_with_descendant_wasm(this.tree[0]);
    return unmarshalNode(this.tree);
  }
  /** Get the smallest node within this node that spans the given byte range. */
  descendantForIndex(start2, end = start2) {
    if (typeof start2 !== "number" || typeof end !== "number") {
      throw new Error("Arguments must be numbers");
    }
    marshalNode(this);
    const address = TRANSFER_BUFFER + SIZE_OF_NODE;
    C.setValue(address, start2, "i32");
    C.setValue(address + SIZE_OF_INT, end, "i32");
    C._ts_node_descendant_for_index_wasm(this.tree[0]);
    return unmarshalNode(this.tree);
  }
  /** Get the smallest named node within this node that spans the given byte range. */
  namedDescendantForIndex(start2, end = start2) {
    if (typeof start2 !== "number" || typeof end !== "number") {
      throw new Error("Arguments must be numbers");
    }
    marshalNode(this);
    const address = TRANSFER_BUFFER + SIZE_OF_NODE;
    C.setValue(address, start2, "i32");
    C.setValue(address + SIZE_OF_INT, end, "i32");
    C._ts_node_named_descendant_for_index_wasm(this.tree[0]);
    return unmarshalNode(this.tree);
  }
  /** Get the smallest node within this node that spans the given point range. */
  descendantForPosition(start2, end = start2) {
    if (!isPoint(start2) || !isPoint(end)) {
      throw new Error("Arguments must be {row, column} objects");
    }
    marshalNode(this);
    const address = TRANSFER_BUFFER + SIZE_OF_NODE;
    marshalPoint(address, start2);
    marshalPoint(address + SIZE_OF_POINT, end);
    C._ts_node_descendant_for_position_wasm(this.tree[0]);
    return unmarshalNode(this.tree);
  }
  /** Get the smallest named node within this node that spans the given point range. */
  namedDescendantForPosition(start2, end = start2) {
    if (!isPoint(start2) || !isPoint(end)) {
      throw new Error("Arguments must be {row, column} objects");
    }
    marshalNode(this);
    const address = TRANSFER_BUFFER + SIZE_OF_NODE;
    marshalPoint(address, start2);
    marshalPoint(address + SIZE_OF_POINT, end);
    C._ts_node_named_descendant_for_position_wasm(this.tree[0]);
    return unmarshalNode(this.tree);
  }
  /**
   * Create a new {@link TreeCursor} starting from this node.
   *
   * Note that the given node is considered the root of the cursor,
   * and the cursor cannot walk outside this node.
   */
  walk() {
    marshalNode(this);
    C._ts_tree_cursor_new_wasm(this.tree[0]);
    return new TreeCursor(INTERNAL, this.tree);
  }
  /**
   * Edit this node to keep it in-sync with source code that has been edited.
   *
   * This function is only rarely needed. When you edit a syntax tree with
   * the {@link Tree#edit} method, all of the nodes that you retrieve from
   * the tree afterward will already reflect the edit. You only need to
   * use {@link Node#edit} when you have a specific {@link Node} instance that
   * you want to keep and continue to use after an edit.
   */
  edit(edit) {
    if (this.startIndex >= edit.oldEndIndex) {
      this.startIndex = edit.newEndIndex + (this.startIndex - edit.oldEndIndex);
      let subbedPointRow;
      let subbedPointColumn;
      if (this.startPosition.row > edit.oldEndPosition.row) {
        subbedPointRow = this.startPosition.row - edit.oldEndPosition.row;
        subbedPointColumn = this.startPosition.column;
      } else {
        subbedPointRow = 0;
        subbedPointColumn = this.startPosition.column;
        if (this.startPosition.column >= edit.oldEndPosition.column) {
          subbedPointColumn = this.startPosition.column - edit.oldEndPosition.column;
        }
      }
      if (subbedPointRow > 0) {
        this.startPosition.row += subbedPointRow;
        this.startPosition.column = subbedPointColumn;
      } else {
        this.startPosition.column += subbedPointColumn;
      }
    } else if (this.startIndex > edit.startIndex) {
      this.startIndex = edit.newEndIndex;
      this.startPosition.row = edit.newEndPosition.row;
      this.startPosition.column = edit.newEndPosition.column;
    }
  }
  /** Get the S-expression representation of this node. */
  toString() {
    marshalNode(this);
    const address = C._ts_node_to_string_wasm(this.tree[0]);
    const result = C.AsciiToString(address);
    C._free(address);
    return result;
  }
};
function unmarshalCaptures(query, tree, address, patternIndex, result) {
  for (let i2 = 0, n = result.length; i2 < n; i2++) {
    const captureIndex = C.getValue(address, "i32");
    address += SIZE_OF_INT;
    const node = unmarshalNode(tree, address);
    address += SIZE_OF_NODE;
    result[i2] = { patternIndex, name: query.captureNames[captureIndex], node };
  }
  return address;
}
__name(unmarshalCaptures, "unmarshalCaptures");
function marshalNode(node, index = 0) {
  let address = TRANSFER_BUFFER + index * SIZE_OF_NODE;
  C.setValue(address, node.id, "i32");
  address += SIZE_OF_INT;
  C.setValue(address, node.startIndex, "i32");
  address += SIZE_OF_INT;
  C.setValue(address, node.startPosition.row, "i32");
  address += SIZE_OF_INT;
  C.setValue(address, node.startPosition.column, "i32");
  address += SIZE_OF_INT;
  C.setValue(address, node[0], "i32");
}
__name(marshalNode, "marshalNode");
function unmarshalNode(tree, address = TRANSFER_BUFFER) {
  const id = C.getValue(address, "i32");
  address += SIZE_OF_INT;
  if (id === 0) return null;
  const index = C.getValue(address, "i32");
  address += SIZE_OF_INT;
  const row2 = C.getValue(address, "i32");
  address += SIZE_OF_INT;
  const column = C.getValue(address, "i32");
  address += SIZE_OF_INT;
  const other = C.getValue(address, "i32");
  const result = new Node(INTERNAL, {
    id,
    tree,
    startIndex: index,
    startPosition: { row: row2, column },
    other
  });
  return result;
}
__name(unmarshalNode, "unmarshalNode");
function marshalTreeCursor(cursor, address = TRANSFER_BUFFER) {
  C.setValue(address + 0 * SIZE_OF_INT, cursor[0], "i32");
  C.setValue(address + 1 * SIZE_OF_INT, cursor[1], "i32");
  C.setValue(address + 2 * SIZE_OF_INT, cursor[2], "i32");
  C.setValue(address + 3 * SIZE_OF_INT, cursor[3], "i32");
}
__name(marshalTreeCursor, "marshalTreeCursor");
function unmarshalTreeCursor(cursor) {
  cursor[0] = C.getValue(TRANSFER_BUFFER + 0 * SIZE_OF_INT, "i32");
  cursor[1] = C.getValue(TRANSFER_BUFFER + 1 * SIZE_OF_INT, "i32");
  cursor[2] = C.getValue(TRANSFER_BUFFER + 2 * SIZE_OF_INT, "i32");
  cursor[3] = C.getValue(TRANSFER_BUFFER + 3 * SIZE_OF_INT, "i32");
}
__name(unmarshalTreeCursor, "unmarshalTreeCursor");
function marshalPoint(address, point) {
  C.setValue(address, point.row, "i32");
  C.setValue(address + SIZE_OF_INT, point.column, "i32");
}
__name(marshalPoint, "marshalPoint");
function unmarshalPoint(address) {
  const result = {
    row: C.getValue(address, "i32") >>> 0,
    column: C.getValue(address + SIZE_OF_INT, "i32") >>> 0
  };
  return result;
}
__name(unmarshalPoint, "unmarshalPoint");
function marshalRange(address, range) {
  marshalPoint(address, range.startPosition);
  address += SIZE_OF_POINT;
  marshalPoint(address, range.endPosition);
  address += SIZE_OF_POINT;
  C.setValue(address, range.startIndex, "i32");
  address += SIZE_OF_INT;
  C.setValue(address, range.endIndex, "i32");
  address += SIZE_OF_INT;
}
__name(marshalRange, "marshalRange");
function unmarshalRange(address) {
  const result = {};
  result.startPosition = unmarshalPoint(address);
  address += SIZE_OF_POINT;
  result.endPosition = unmarshalPoint(address);
  address += SIZE_OF_POINT;
  result.startIndex = C.getValue(address, "i32") >>> 0;
  address += SIZE_OF_INT;
  result.endIndex = C.getValue(address, "i32") >>> 0;
  return result;
}
__name(unmarshalRange, "unmarshalRange");
function marshalEdit(edit, address = TRANSFER_BUFFER) {
  marshalPoint(address, edit.startPosition);
  address += SIZE_OF_POINT;
  marshalPoint(address, edit.oldEndPosition);
  address += SIZE_OF_POINT;
  marshalPoint(address, edit.newEndPosition);
  address += SIZE_OF_POINT;
  C.setValue(address, edit.startIndex, "i32");
  address += SIZE_OF_INT;
  C.setValue(address, edit.oldEndIndex, "i32");
  address += SIZE_OF_INT;
  C.setValue(address, edit.newEndIndex, "i32");
  address += SIZE_OF_INT;
}
__name(marshalEdit, "marshalEdit");
function unmarshalLanguageMetadata(address) {
  const major_version = C.getValue(address, "i32");
  const minor_version = C.getValue(address += SIZE_OF_INT, "i32");
  const patch_version = C.getValue(address += SIZE_OF_INT, "i32");
  return { major_version, minor_version, patch_version };
}
__name(unmarshalLanguageMetadata, "unmarshalLanguageMetadata");
var LANGUAGE_FUNCTION_REGEX = /^tree_sitter_\w+$/;
var Language = class _Language {
  static {
    __name(this, "Language");
  }
  /** @internal */
  [0] = 0;
  // Internal handle for Wasm
  /**
   * A list of all node types in the language. The index of each type in this
   * array is its node type id.
   */
  types;
  /**
   * A list of all field names in the language. The index of each field name in
   * this array is its field id.
   */
  fields;
  /** @internal */
  constructor(internal, address) {
    assertInternal(internal);
    this[0] = address;
    this.types = new Array(C._ts_language_symbol_count(this[0]));
    for (let i2 = 0, n = this.types.length; i2 < n; i2++) {
      if (C._ts_language_symbol_type(this[0], i2) < 2) {
        this.types[i2] = C.UTF8ToString(C._ts_language_symbol_name(this[0], i2));
      }
    }
    this.fields = new Array(C._ts_language_field_count(this[0]) + 1);
    for (let i2 = 0, n = this.fields.length; i2 < n; i2++) {
      const fieldName = C._ts_language_field_name_for_id(this[0], i2);
      if (fieldName !== 0) {
        this.fields[i2] = C.UTF8ToString(fieldName);
      } else {
        this.fields[i2] = null;
      }
    }
  }
  /**
   * Gets the name of the language.
   */
  get name() {
    const ptr = C._ts_language_name(this[0]);
    if (ptr === 0) return null;
    return C.UTF8ToString(ptr);
  }
  /**
   * Gets the ABI version of the language.
   */
  get abiVersion() {
    return C._ts_language_abi_version(this[0]);
  }
  /**
  * Get the metadata for this language. This information is generated by the
  * CLI, and relies on the language author providing the correct metadata in
  * the language's `tree-sitter.json` file.
  */
  get metadata() {
    C._ts_language_metadata_wasm(this[0]);
    const length = C.getValue(TRANSFER_BUFFER, "i32");
    if (length === 0) return null;
    return unmarshalLanguageMetadata(TRANSFER_BUFFER + SIZE_OF_INT);
  }
  /**
   * Gets the number of fields in the language.
   */
  get fieldCount() {
    return this.fields.length - 1;
  }
  /**
   * Gets the number of states in the language.
   */
  get stateCount() {
    return C._ts_language_state_count(this[0]);
  }
  /**
   * Get the field id for a field name.
   */
  fieldIdForName(fieldName) {
    const result = this.fields.indexOf(fieldName);
    return result !== -1 ? result : null;
  }
  /**
   * Get the field name for a field id.
   */
  fieldNameForId(fieldId) {
    return this.fields[fieldId] ?? null;
  }
  /**
   * Get the node type id for a node type name.
   */
  idForNodeType(type, named) {
    const typeLength = C.lengthBytesUTF8(type);
    const typeAddress = C._malloc(typeLength + 1);
    C.stringToUTF8(type, typeAddress, typeLength + 1);
    const result = C._ts_language_symbol_for_name(this[0], typeAddress, typeLength, named ? 1 : 0);
    C._free(typeAddress);
    return result || null;
  }
  /**
   * Gets the number of node types in the language.
   */
  get nodeTypeCount() {
    return C._ts_language_symbol_count(this[0]);
  }
  /**
   * Get the node type name for a node type id.
   */
  nodeTypeForId(typeId) {
    const name2 = C._ts_language_symbol_name(this[0], typeId);
    return name2 ? C.UTF8ToString(name2) : null;
  }
  /**
   * Check if a node type is named.
   *
   * @see {@link https://tree-sitter.github.io/tree-sitter/using-parsers/2-basic-parsing.html#named-vs-anonymous-nodes}
   */
  nodeTypeIsNamed(typeId) {
    return C._ts_language_type_is_named_wasm(this[0], typeId) ? true : false;
  }
  /**
   * Check if a node type is visible.
   */
  nodeTypeIsVisible(typeId) {
    return C._ts_language_type_is_visible_wasm(this[0], typeId) ? true : false;
  }
  /**
   * Get the supertypes ids of this language.
   *
   * @see {@link https://tree-sitter.github.io/tree-sitter/using-parsers/6-static-node-types.html?highlight=supertype#supertype-nodes}
   */
  get supertypes() {
    C._ts_language_supertypes_wasm(this[0]);
    const count = C.getValue(TRANSFER_BUFFER, "i32");
    const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
    const result = new Array(count);
    if (count > 0) {
      let address = buffer;
      for (let i2 = 0; i2 < count; i2++) {
        result[i2] = C.getValue(address, "i16");
        address += SIZE_OF_SHORT;
      }
    }
    return result;
  }
  /**
   * Get the subtype ids for a given supertype node id.
   */
  subtypes(supertype) {
    C._ts_language_subtypes_wasm(this[0], supertype);
    const count = C.getValue(TRANSFER_BUFFER, "i32");
    const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
    const result = new Array(count);
    if (count > 0) {
      let address = buffer;
      for (let i2 = 0; i2 < count; i2++) {
        result[i2] = C.getValue(address, "i16");
        address += SIZE_OF_SHORT;
      }
    }
    return result;
  }
  /**
   * Get the next state id for a given state id and node type id.
   */
  nextState(stateId, typeId) {
    return C._ts_language_next_state(this[0], stateId, typeId);
  }
  /**
   * Create a new lookahead iterator for this language and parse state.
   *
   * This returns `null` if state is invalid for this language.
   *
   * Iterating {@link LookaheadIterator} will yield valid symbols in the given
   * parse state. Newly created lookahead iterators will return the `ERROR`
   * symbol from {@link LookaheadIterator#currentType}.
   *
   * Lookahead iterators can be useful for generating suggestions and improving
   * syntax error diagnostics. To get symbols valid in an `ERROR` node, use the
   * lookahead iterator on its first leaf node state. For `MISSING` nodes, a
   * lookahead iterator created on the previous non-extra leaf node may be
   * appropriate.
   */
  lookaheadIterator(stateId) {
    const address = C._ts_lookahead_iterator_new(this[0], stateId);
    if (address) return new LookaheadIterator(INTERNAL, address, this);
    return null;
  }
  /**
   * Load a language from a WebAssembly module.
   * The module can be provided as a path to a file or as a buffer.
   */
  static async load(input) {
    let binary2;
    if (input instanceof Uint8Array) {
      binary2 = input;
    } else if (globalThis.process?.versions.node) {
      const fs2 = await import("fs/promises");
      binary2 = await fs2.readFile(input);
    } else {
      const response = await fetch(input);
      if (!response.ok) {
        const body2 = await response.text();
        throw new Error(`Language.load failed with status ${response.status}.

${body2}`);
      }
      const retryResp = response.clone();
      try {
        binary2 = await WebAssembly.compileStreaming(response);
      } catch (reason) {
        console.error("wasm streaming compile failed:", reason);
        console.error("falling back to ArrayBuffer instantiation");
        binary2 = new Uint8Array(await retryResp.arrayBuffer());
      }
    }
    const mod = await C.loadWebAssemblyModule(binary2, { loadAsync: true });
    const symbolNames = Object.keys(mod);
    const functionName = symbolNames.find((key) => LANGUAGE_FUNCTION_REGEX.test(key) && !key.includes("external_scanner_"));
    if (!functionName) {
      console.log(`Couldn't find language function in Wasm file. Symbols:
${JSON.stringify(symbolNames, null, 2)}`);
      throw new Error("Language.load failed: no language function found in Wasm file");
    }
    const languageAddress = mod[functionName]();
    return new _Language(INTERNAL, languageAddress);
  }
};
async function Module2(moduleArg = {}) {
  var moduleRtn;
  var Module = moduleArg;
  var ENVIRONMENT_IS_WEB = typeof window == "object";
  var ENVIRONMENT_IS_WORKER = typeof WorkerGlobalScope != "undefined";
  var ENVIRONMENT_IS_NODE = typeof process == "object" && process.versions?.node && process.type != "renderer";
  if (ENVIRONMENT_IS_NODE) {
    const { createRequire } = await import("module");
    var require = createRequire(import.meta.url);
  }
  Module.currentQueryProgressCallback = null;
  Module.currentProgressCallback = null;
  Module.currentLogCallback = null;
  Module.currentParseCallback = null;
  var arguments_ = [];
  var thisProgram = "./this.program";
  var quit_ = /* @__PURE__ */ __name((status, toThrow) => {
    throw toThrow;
  }, "quit_");
  var _scriptName = import.meta.url;
  var scriptDirectory = "";
  function locateFile(path) {
    if (Module["locateFile"]) {
      return Module["locateFile"](path, scriptDirectory);
    }
    return scriptDirectory + path;
  }
  __name(locateFile, "locateFile");
  var readAsync, readBinary;
  if (ENVIRONMENT_IS_NODE) {
    var fs = require("fs");
    if (_scriptName.startsWith("file:")) {
      scriptDirectory = require("path").dirname(require("url").fileURLToPath(_scriptName)) + "/";
    }
    readBinary = /* @__PURE__ */ __name((filename) => {
      filename = isFileURI(filename) ? new URL(filename) : filename;
      var ret = fs.readFileSync(filename);
      return ret;
    }, "readBinary");
    readAsync = /* @__PURE__ */ __name(async (filename, binary2 = true) => {
      filename = isFileURI(filename) ? new URL(filename) : filename;
      var ret = fs.readFileSync(filename, binary2 ? void 0 : "utf8");
      return ret;
    }, "readAsync");
    if (process.argv.length > 1) {
      thisProgram = process.argv[1].replace(/\\/g, "/");
    }
    arguments_ = process.argv.slice(2);
    quit_ = /* @__PURE__ */ __name((status, toThrow) => {
      process.exitCode = status;
      throw toThrow;
    }, "quit_");
  } else if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
    try {
      scriptDirectory = new URL(".", _scriptName).href;
    } catch {
    }
    {
      if (ENVIRONMENT_IS_WORKER) {
        readBinary = /* @__PURE__ */ __name((url) => {
          var xhr = new XMLHttpRequest();
          xhr.open("GET", url, false);
          xhr.responseType = "arraybuffer";
          xhr.send(null);
          return new Uint8Array(
            /** @type{!ArrayBuffer} */
            xhr.response
          );
        }, "readBinary");
      }
      readAsync = /* @__PURE__ */ __name(async (url) => {
        if (isFileURI(url)) {
          return new Promise((resolve3, reject) => {
            var xhr = new XMLHttpRequest();
            xhr.open("GET", url, true);
            xhr.responseType = "arraybuffer";
            xhr.onload = () => {
              if (xhr.status == 200 || xhr.status == 0 && xhr.response) {
                resolve3(xhr.response);
                return;
              }
              reject(xhr.status);
            };
            xhr.onerror = reject;
            xhr.send(null);
          });
        }
        var response = await fetch(url, {
          credentials: "same-origin"
        });
        if (response.ok) {
          return response.arrayBuffer();
        }
        throw new Error(response.status + " : " + response.url);
      }, "readAsync");
    }
  } else {
  }
  var out = console.log.bind(console);
  var err = console.error.bind(console);
  var dynamicLibraries = [];
  var wasmBinary;
  var ABORT = false;
  var EXITSTATUS;
  var isFileURI = /* @__PURE__ */ __name((filename) => filename.startsWith("file://"), "isFileURI");
  var readyPromiseResolve, readyPromiseReject;
  var wasmMemory;
  var HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAPF64;
  var HEAP64, HEAPU64;
  var HEAP_DATA_VIEW;
  var runtimeInitialized = false;
  function updateMemoryViews() {
    var b = wasmMemory.buffer;
    Module["HEAP8"] = HEAP8 = new Int8Array(b);
    Module["HEAP16"] = HEAP16 = new Int16Array(b);
    Module["HEAPU8"] = HEAPU8 = new Uint8Array(b);
    Module["HEAPU16"] = HEAPU16 = new Uint16Array(b);
    Module["HEAP32"] = HEAP32 = new Int32Array(b);
    Module["HEAPU32"] = HEAPU32 = new Uint32Array(b);
    Module["HEAPF32"] = HEAPF32 = new Float32Array(b);
    Module["HEAPF64"] = HEAPF64 = new Float64Array(b);
    Module["HEAP64"] = HEAP64 = new BigInt64Array(b);
    Module["HEAPU64"] = HEAPU64 = new BigUint64Array(b);
    Module["HEAP_DATA_VIEW"] = HEAP_DATA_VIEW = new DataView(b);
    LE_HEAP_UPDATE();
  }
  __name(updateMemoryViews, "updateMemoryViews");
  function initMemory() {
    if (Module["wasmMemory"]) {
      wasmMemory = Module["wasmMemory"];
    } else {
      var INITIAL_MEMORY = Module["INITIAL_MEMORY"] || 33554432;
      wasmMemory = new WebAssembly.Memory({
        "initial": INITIAL_MEMORY / 65536,
        // In theory we should not need to emit the maximum if we want "unlimited"
        // or 4GB of memory, but VMs error on that atm, see
        // https://github.com/emscripten-core/emscripten/issues/14130
        // And in the pthreads case we definitely need to emit a maximum. So
        // always emit one.
        "maximum": 32768
      });
    }
    updateMemoryViews();
  }
  __name(initMemory, "initMemory");
  var __RELOC_FUNCS__ = [];
  function preRun() {
    if (Module["preRun"]) {
      if (typeof Module["preRun"] == "function") Module["preRun"] = [Module["preRun"]];
      while (Module["preRun"].length) {
        addOnPreRun(Module["preRun"].shift());
      }
    }
    callRuntimeCallbacks(onPreRuns);
  }
  __name(preRun, "preRun");
  function initRuntime() {
    runtimeInitialized = true;
    callRuntimeCallbacks(__RELOC_FUNCS__);
    wasmExports["__wasm_call_ctors"]();
    callRuntimeCallbacks(onPostCtors);
  }
  __name(initRuntime, "initRuntime");
  function preMain() {
  }
  __name(preMain, "preMain");
  function postRun() {
    if (Module["postRun"]) {
      if (typeof Module["postRun"] == "function") Module["postRun"] = [Module["postRun"]];
      while (Module["postRun"].length) {
        addOnPostRun(Module["postRun"].shift());
      }
    }
    callRuntimeCallbacks(onPostRuns);
  }
  __name(postRun, "postRun");
  function abort(what) {
    Module["onAbort"]?.(what);
    what = "Aborted(" + what + ")";
    err(what);
    ABORT = true;
    what += ". Build with -sASSERTIONS for more info.";
    var e = new WebAssembly.RuntimeError(what);
    readyPromiseReject?.(e);
    throw e;
  }
  __name(abort, "abort");
  var wasmBinaryFile;
  function findWasmBinary() {
    if (Module["locateFile"]) {
      return locateFile("web-tree-sitter.wasm");
    }
    return new URL("web-tree-sitter.wasm", import.meta.url).href;
  }
  __name(findWasmBinary, "findWasmBinary");
  function getBinarySync(file) {
    if (file == wasmBinaryFile && wasmBinary) {
      return new Uint8Array(wasmBinary);
    }
    if (readBinary) {
      return readBinary(file);
    }
    throw "both async and sync fetching of the wasm failed";
  }
  __name(getBinarySync, "getBinarySync");
  async function getWasmBinary(binaryFile) {
    if (!wasmBinary) {
      try {
        var response = await readAsync(binaryFile);
        return new Uint8Array(response);
      } catch {
      }
    }
    return getBinarySync(binaryFile);
  }
  __name(getWasmBinary, "getWasmBinary");
  async function instantiateArrayBuffer(binaryFile, imports) {
    try {
      var binary2 = await getWasmBinary(binaryFile);
      var instance2 = await WebAssembly.instantiate(binary2, imports);
      return instance2;
    } catch (reason) {
      err(`failed to asynchronously prepare wasm: ${reason}`);
      abort(reason);
    }
  }
  __name(instantiateArrayBuffer, "instantiateArrayBuffer");
  async function instantiateAsync(binary2, binaryFile, imports) {
    if (!binary2 && !isFileURI(binaryFile) && !ENVIRONMENT_IS_NODE) {
      try {
        var response = fetch(binaryFile, {
          credentials: "same-origin"
        });
        var instantiationResult = await WebAssembly.instantiateStreaming(response, imports);
        return instantiationResult;
      } catch (reason) {
        err(`wasm streaming compile failed: ${reason}`);
        err("falling back to ArrayBuffer instantiation");
      }
    }
    return instantiateArrayBuffer(binaryFile, imports);
  }
  __name(instantiateAsync, "instantiateAsync");
  function getWasmImports() {
    return {
      "env": wasmImports,
      "wasi_snapshot_preview1": wasmImports,
      "GOT.mem": new Proxy(wasmImports, GOTHandler),
      "GOT.func": new Proxy(wasmImports, GOTHandler)
    };
  }
  __name(getWasmImports, "getWasmImports");
  async function createWasm() {
    function receiveInstance(instance2, module2) {
      wasmExports = instance2.exports;
      wasmExports = relocateExports(wasmExports, 1024);
      var metadata2 = getDylinkMetadata(module2);
      if (metadata2.neededDynlibs) {
        dynamicLibraries = metadata2.neededDynlibs.concat(dynamicLibraries);
      }
      mergeLibSymbols(wasmExports, "main");
      LDSO.init();
      loadDylibs();
      __RELOC_FUNCS__.push(wasmExports["__wasm_apply_data_relocs"]);
      assignWasmExports(wasmExports);
      return wasmExports;
    }
    __name(receiveInstance, "receiveInstance");
    function receiveInstantiationResult(result2) {
      return receiveInstance(result2["instance"], result2["module"]);
    }
    __name(receiveInstantiationResult, "receiveInstantiationResult");
    var info2 = getWasmImports();
    if (Module["instantiateWasm"]) {
      return new Promise((resolve3, reject) => {
        Module["instantiateWasm"](info2, (mod, inst) => {
          resolve3(receiveInstance(mod, inst));
        });
      });
    }
    wasmBinaryFile ??= findWasmBinary();
    var result = await instantiateAsync(wasmBinary, wasmBinaryFile, info2);
    var exports = receiveInstantiationResult(result);
    return exports;
  }
  __name(createWasm, "createWasm");
  class ExitStatus {
    static {
      __name(this, "ExitStatus");
    }
    name = "ExitStatus";
    constructor(status) {
      this.message = `Program terminated with exit(${status})`;
      this.status = status;
    }
  }
  var GOT = {};
  var currentModuleWeakSymbols = /* @__PURE__ */ new Set([]);
  var GOTHandler = {
    get(obj, symName) {
      var rtn = GOT[symName];
      if (!rtn) {
        rtn = GOT[symName] = new WebAssembly.Global({
          "value": "i32",
          "mutable": true
        });
      }
      if (!currentModuleWeakSymbols.has(symName)) {
        rtn.required = true;
      }
      return rtn;
    }
  };
  var LE_ATOMICS_NATIVE_BYTE_ORDER = [];
  var LE_HEAP_LOAD_F32 = /* @__PURE__ */ __name((byteOffset) => HEAP_DATA_VIEW.getFloat32(byteOffset, true), "LE_HEAP_LOAD_F32");
  var LE_HEAP_LOAD_F64 = /* @__PURE__ */ __name((byteOffset) => HEAP_DATA_VIEW.getFloat64(byteOffset, true), "LE_HEAP_LOAD_F64");
  var LE_HEAP_LOAD_I16 = /* @__PURE__ */ __name((byteOffset) => HEAP_DATA_VIEW.getInt16(byteOffset, true), "LE_HEAP_LOAD_I16");
  var LE_HEAP_LOAD_I32 = /* @__PURE__ */ __name((byteOffset) => HEAP_DATA_VIEW.getInt32(byteOffset, true), "LE_HEAP_LOAD_I32");
  var LE_HEAP_LOAD_I64 = /* @__PURE__ */ __name((byteOffset) => HEAP_DATA_VIEW.getBigInt64(byteOffset, true), "LE_HEAP_LOAD_I64");
  var LE_HEAP_LOAD_U32 = /* @__PURE__ */ __name((byteOffset) => HEAP_DATA_VIEW.getUint32(byteOffset, true), "LE_HEAP_LOAD_U32");
  var LE_HEAP_STORE_F32 = /* @__PURE__ */ __name((byteOffset, value) => HEAP_DATA_VIEW.setFloat32(byteOffset, value, true), "LE_HEAP_STORE_F32");
  var LE_HEAP_STORE_F64 = /* @__PURE__ */ __name((byteOffset, value) => HEAP_DATA_VIEW.setFloat64(byteOffset, value, true), "LE_HEAP_STORE_F64");
  var LE_HEAP_STORE_I16 = /* @__PURE__ */ __name((byteOffset, value) => HEAP_DATA_VIEW.setInt16(byteOffset, value, true), "LE_HEAP_STORE_I16");
  var LE_HEAP_STORE_I32 = /* @__PURE__ */ __name((byteOffset, value) => HEAP_DATA_VIEW.setInt32(byteOffset, value, true), "LE_HEAP_STORE_I32");
  var LE_HEAP_STORE_I64 = /* @__PURE__ */ __name((byteOffset, value) => HEAP_DATA_VIEW.setBigInt64(byteOffset, value, true), "LE_HEAP_STORE_I64");
  var LE_HEAP_STORE_U32 = /* @__PURE__ */ __name((byteOffset, value) => HEAP_DATA_VIEW.setUint32(byteOffset, value, true), "LE_HEAP_STORE_U32");
  var callRuntimeCallbacks = /* @__PURE__ */ __name((callbacks) => {
    while (callbacks.length > 0) {
      callbacks.shift()(Module);
    }
  }, "callRuntimeCallbacks");
  var onPostRuns = [];
  var addOnPostRun = /* @__PURE__ */ __name((cb) => onPostRuns.push(cb), "addOnPostRun");
  var onPreRuns = [];
  var addOnPreRun = /* @__PURE__ */ __name((cb) => onPreRuns.push(cb), "addOnPreRun");
  var UTF8Decoder = typeof TextDecoder != "undefined" ? new TextDecoder() : void 0;
  var findStringEnd = /* @__PURE__ */ __name((heapOrArray, idx, maxBytesToRead, ignoreNul) => {
    var maxIdx = idx + maxBytesToRead;
    if (ignoreNul) return maxIdx;
    while (heapOrArray[idx] && !(idx >= maxIdx)) ++idx;
    return idx;
  }, "findStringEnd");
  var UTF8ArrayToString = /* @__PURE__ */ __name((heapOrArray, idx = 0, maxBytesToRead, ignoreNul) => {
    var endPtr = findStringEnd(heapOrArray, idx, maxBytesToRead, ignoreNul);
    if (endPtr - idx > 16 && heapOrArray.buffer && UTF8Decoder) {
      return UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr));
    }
    var str = "";
    while (idx < endPtr) {
      var u0 = heapOrArray[idx++];
      if (!(u0 & 128)) {
        str += String.fromCharCode(u0);
        continue;
      }
      var u1 = heapOrArray[idx++] & 63;
      if ((u0 & 224) == 192) {
        str += String.fromCharCode((u0 & 31) << 6 | u1);
        continue;
      }
      var u2 = heapOrArray[idx++] & 63;
      if ((u0 & 240) == 224) {
        u0 = (u0 & 15) << 12 | u1 << 6 | u2;
      } else {
        u0 = (u0 & 7) << 18 | u1 << 12 | u2 << 6 | heapOrArray[idx++] & 63;
      }
      if (u0 < 65536) {
        str += String.fromCharCode(u0);
      } else {
        var ch = u0 - 65536;
        str += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
      }
    }
    return str;
  }, "UTF8ArrayToString");
  var getDylinkMetadata = /* @__PURE__ */ __name((binary2) => {
    var offset = 0;
    var end = 0;
    function getU8() {
      return binary2[offset++];
    }
    __name(getU8, "getU8");
    function getLEB() {
      var ret = 0;
      var mul = 1;
      while (1) {
        var byte = binary2[offset++];
        ret += (byte & 127) * mul;
        mul *= 128;
        if (!(byte & 128)) break;
      }
      return ret;
    }
    __name(getLEB, "getLEB");
    function getString() {
      var len = getLEB();
      offset += len;
      return UTF8ArrayToString(binary2, offset - len, len);
    }
    __name(getString, "getString");
    function getStringList() {
      var count2 = getLEB();
      var rtn = [];
      while (count2--) rtn.push(getString());
      return rtn;
    }
    __name(getStringList, "getStringList");
    function failIf(condition, message) {
      if (condition) throw new Error(message);
    }
    __name(failIf, "failIf");
    if (binary2 instanceof WebAssembly.Module) {
      var dylinkSection = WebAssembly.Module.customSections(binary2, "dylink.0");
      failIf(dylinkSection.length === 0, "need dylink section");
      binary2 = new Uint8Array(dylinkSection[0]);
      end = binary2.length;
    } else {
      var int32View = new Uint32Array(new Uint8Array(binary2.subarray(0, 24)).buffer);
      var magicNumberFound = int32View[0] == 1836278016 || int32View[0] == 6386541;
      failIf(!magicNumberFound, "need to see wasm magic number");
      failIf(binary2[8] !== 0, "need the dylink section to be first");
      offset = 9;
      var section_size = getLEB();
      end = offset + section_size;
      var name2 = getString();
      failIf(name2 !== "dylink.0");
    }
    var customSection = {
      neededDynlibs: [],
      tlsExports: /* @__PURE__ */ new Set(),
      weakImports: /* @__PURE__ */ new Set(),
      runtimePaths: []
    };
    var WASM_DYLINK_MEM_INFO = 1;
    var WASM_DYLINK_NEEDED = 2;
    var WASM_DYLINK_EXPORT_INFO = 3;
    var WASM_DYLINK_IMPORT_INFO = 4;
    var WASM_DYLINK_RUNTIME_PATH = 5;
    var WASM_SYMBOL_TLS = 256;
    var WASM_SYMBOL_BINDING_MASK = 3;
    var WASM_SYMBOL_BINDING_WEAK = 1;
    while (offset < end) {
      var subsectionType = getU8();
      var subsectionSize = getLEB();
      if (subsectionType === WASM_DYLINK_MEM_INFO) {
        customSection.memorySize = getLEB();
        customSection.memoryAlign = getLEB();
        customSection.tableSize = getLEB();
        customSection.tableAlign = getLEB();
      } else if (subsectionType === WASM_DYLINK_NEEDED) {
        customSection.neededDynlibs = getStringList();
      } else if (subsectionType === WASM_DYLINK_EXPORT_INFO) {
        var count = getLEB();
        while (count--) {
          var symname = getString();
          var flags2 = getLEB();
          if (flags2 & WASM_SYMBOL_TLS) {
            customSection.tlsExports.add(symname);
          }
        }
      } else if (subsectionType === WASM_DYLINK_IMPORT_INFO) {
        var count = getLEB();
        while (count--) {
          var modname = getString();
          var symname = getString();
          var flags2 = getLEB();
          if ((flags2 & WASM_SYMBOL_BINDING_MASK) == WASM_SYMBOL_BINDING_WEAK) {
            customSection.weakImports.add(symname);
          }
        }
      } else if (subsectionType === WASM_DYLINK_RUNTIME_PATH) {
        customSection.runtimePaths = getStringList();
      } else {
        offset += subsectionSize;
      }
    }
    return customSection;
  }, "getDylinkMetadata");
  function getValue(ptr, type = "i8") {
    if (type.endsWith("*")) type = "*";
    switch (type) {
      case "i1":
        return HEAP8[ptr];
      case "i8":
        return HEAP8[ptr];
      case "i16":
        return LE_HEAP_LOAD_I16((ptr >> 1) * 2);
      case "i32":
        return LE_HEAP_LOAD_I32((ptr >> 2) * 4);
      case "i64":
        return LE_HEAP_LOAD_I64((ptr >> 3) * 8);
      case "float":
        return LE_HEAP_LOAD_F32((ptr >> 2) * 4);
      case "double":
        return LE_HEAP_LOAD_F64((ptr >> 3) * 8);
      case "*":
        return LE_HEAP_LOAD_U32((ptr >> 2) * 4);
      default:
        abort(`invalid type for getValue: ${type}`);
    }
  }
  __name(getValue, "getValue");
  var newDSO = /* @__PURE__ */ __name((name2, handle2, syms) => {
    var dso = {
      refcount: Infinity,
      name: name2,
      exports: syms,
      global: true
    };
    LDSO.loadedLibsByName[name2] = dso;
    if (handle2 != void 0) {
      LDSO.loadedLibsByHandle[handle2] = dso;
    }
    return dso;
  }, "newDSO");
  var LDSO = {
    loadedLibsByName: {},
    loadedLibsByHandle: {},
    init() {
      newDSO("__main__", 0, wasmImports);
    }
  };
  var ___heap_base = 78240;
  var alignMemory = /* @__PURE__ */ __name((size, alignment) => Math.ceil(size / alignment) * alignment, "alignMemory");
  var getMemory = /* @__PURE__ */ __name((size) => {
    if (runtimeInitialized) {
      return _calloc(size, 1);
    }
    var ret = ___heap_base;
    var end = ret + alignMemory(size, 16);
    ___heap_base = end;
    GOT["__heap_base"].value = end;
    return ret;
  }, "getMemory");
  var isInternalSym = /* @__PURE__ */ __name((symName) => ["__cpp_exception", "__c_longjmp", "__wasm_apply_data_relocs", "__dso_handle", "__tls_size", "__tls_align", "__set_stack_limits", "_emscripten_tls_init", "__wasm_init_tls", "__wasm_call_ctors", "__start_em_asm", "__stop_em_asm", "__start_em_js", "__stop_em_js"].includes(symName) || symName.startsWith("__em_js__"), "isInternalSym");
  var uleb128EncodeWithLen = /* @__PURE__ */ __name((arr) => {
    const n = arr.length;
    return [n % 128 | 128, n >> 7, ...arr];
  }, "uleb128EncodeWithLen");
  var wasmTypeCodes = {
    "i": 127,
    // i32
    "p": 127,
    // i32
    "j": 126,
    // i64
    "f": 125,
    // f32
    "d": 124,
    // f64
    "e": 111
  };
  var generateTypePack = /* @__PURE__ */ __name((types) => uleb128EncodeWithLen(Array.from(types, (type) => {
    var code = wasmTypeCodes[type];
    return code;
  })), "generateTypePack");
  var convertJsFunctionToWasm = /* @__PURE__ */ __name((func2, sig) => {
    var bytes = Uint8Array.of(
      0,
      97,
      115,
      109,
      // magic ("\0asm")
      1,
      0,
      0,
      0,
      // version: 1
      1,
      ...uleb128EncodeWithLen([
        1,
        // count: 1
        96,
        // param types
        ...generateTypePack(sig.slice(1)),
        // return types (for now only supporting [] if `void` and single [T] otherwise)
        ...generateTypePack(sig[0] === "v" ? "" : sig[0])
      ]),
      // The rest of the module is static
      2,
      7,
      // import section
      // (import "e" "f" (func 0 (type 0)))
      1,
      1,
      101,
      1,
      102,
      0,
      0,
      7,
      5,
      // export section
      // (export "f" (func 0 (type 0)))
      1,
      1,
      102,
      0,
      0
    );
    var module2 = new WebAssembly.Module(bytes);
    var instance2 = new WebAssembly.Instance(module2, {
      "e": {
        "f": func2
      }
    });
    var wrappedFunc = instance2.exports["f"];
    return wrappedFunc;
  }, "convertJsFunctionToWasm");
  var wasmTableMirror = [];
  var wasmTable = new WebAssembly.Table({
    "initial": 31,
    "element": "anyfunc"
  });
  var getWasmTableEntry = /* @__PURE__ */ __name((funcPtr) => {
    var func2 = wasmTableMirror[funcPtr];
    if (!func2) {
      wasmTableMirror[funcPtr] = func2 = wasmTable.get(funcPtr);
    }
    return func2;
  }, "getWasmTableEntry");
  var updateTableMap = /* @__PURE__ */ __name((offset, count) => {
    if (functionsInTableMap) {
      for (var i2 = offset; i2 < offset + count; i2++) {
        var item = getWasmTableEntry(i2);
        if (item) {
          functionsInTableMap.set(item, i2);
        }
      }
    }
  }, "updateTableMap");
  var functionsInTableMap;
  var getFunctionAddress = /* @__PURE__ */ __name((func2) => {
    if (!functionsInTableMap) {
      functionsInTableMap = /* @__PURE__ */ new WeakMap();
      updateTableMap(0, wasmTable.length);
    }
    return functionsInTableMap.get(func2) || 0;
  }, "getFunctionAddress");
  var freeTableIndexes = [];
  var getEmptyTableSlot = /* @__PURE__ */ __name(() => {
    if (freeTableIndexes.length) {
      return freeTableIndexes.pop();
    }
    return wasmTable["grow"](1);
  }, "getEmptyTableSlot");
  var setWasmTableEntry = /* @__PURE__ */ __name((idx, func2) => {
    wasmTable.set(idx, func2);
    wasmTableMirror[idx] = wasmTable.get(idx);
  }, "setWasmTableEntry");
  var addFunction = /* @__PURE__ */ __name((func2, sig) => {
    var rtn = getFunctionAddress(func2);
    if (rtn) {
      return rtn;
    }
    var ret = getEmptyTableSlot();
    try {
      setWasmTableEntry(ret, func2);
    } catch (err2) {
      if (!(err2 instanceof TypeError)) {
        throw err2;
      }
      var wrapped = convertJsFunctionToWasm(func2, sig);
      setWasmTableEntry(ret, wrapped);
    }
    functionsInTableMap.set(func2, ret);
    return ret;
  }, "addFunction");
  var updateGOT = /* @__PURE__ */ __name((exports, replace) => {
    for (var symName in exports) {
      if (isInternalSym(symName)) {
        continue;
      }
      var value = exports[symName];
      GOT[symName] ||= new WebAssembly.Global({
        "value": "i32",
        "mutable": true
      });
      if (replace || GOT[symName].value == 0) {
        if (typeof value == "function") {
          GOT[symName].value = addFunction(value);
        } else if (typeof value == "number") {
          GOT[symName].value = value;
        } else {
          err(`unhandled export type for '${symName}': ${typeof value}`);
        }
      }
    }
  }, "updateGOT");
  var relocateExports = /* @__PURE__ */ __name((exports, memoryBase2, replace) => {
    var relocated = {};
    for (var e in exports) {
      var value = exports[e];
      if (typeof value == "object") {
        value = value.value;
      }
      if (typeof value == "number") {
        value += memoryBase2;
      }
      relocated[e] = value;
    }
    updateGOT(relocated, replace);
    return relocated;
  }, "relocateExports");
  var isSymbolDefined = /* @__PURE__ */ __name((symName) => {
    var existing = wasmImports[symName];
    if (!existing || existing.stub) {
      return false;
    }
    return true;
  }, "isSymbolDefined");
  var dynCall = /* @__PURE__ */ __name((sig, ptr, args2 = [], promising = false) => {
    var func2 = getWasmTableEntry(ptr);
    var rtn = func2(...args2);
    function convert(rtn2) {
      return rtn2;
    }
    __name(convert, "convert");
    return convert(rtn);
  }, "dynCall");
  var stackSave = /* @__PURE__ */ __name(() => _emscripten_stack_get_current(), "stackSave");
  var stackRestore = /* @__PURE__ */ __name((val) => __emscripten_stack_restore(val), "stackRestore");
  var createInvokeFunction = /* @__PURE__ */ __name((sig) => (ptr, ...args2) => {
    var sp = stackSave();
    try {
      return dynCall(sig, ptr, args2);
    } catch (e) {
      stackRestore(sp);
      if (e !== e + 0) throw e;
      _setThrew(1, 0);
      if (sig[0] == "j") return 0n;
    }
  }, "createInvokeFunction");
  var resolveGlobalSymbol = /* @__PURE__ */ __name((symName, direct = false) => {
    var sym;
    if (isSymbolDefined(symName)) {
      sym = wasmImports[symName];
    } else if (symName.startsWith("invoke_")) {
      sym = wasmImports[symName] = createInvokeFunction(symName.split("_")[1]);
    }
    return {
      sym,
      name: symName
    };
  }, "resolveGlobalSymbol");
  var onPostCtors = [];
  var addOnPostCtor = /* @__PURE__ */ __name((cb) => onPostCtors.push(cb), "addOnPostCtor");
  var UTF8ToString = /* @__PURE__ */ __name((ptr, maxBytesToRead, ignoreNul) => ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead, ignoreNul) : "", "UTF8ToString");
  var loadWebAssemblyModule = /* @__PURE__ */ __name((binary, flags, libName, localScope, handle) => {
    var metadata = getDylinkMetadata(binary);
    function loadModule() {
      var memAlign = Math.pow(2, metadata.memoryAlign);
      var memoryBase = metadata.memorySize ? alignMemory(getMemory(metadata.memorySize + memAlign), memAlign) : 0;
      var tableBase = metadata.tableSize ? wasmTable.length : 0;
      if (handle) {
        HEAP8[handle + 8] = 1;
        LE_HEAP_STORE_U32((handle + 12 >> 2) * 4, memoryBase);
        LE_HEAP_STORE_I32((handle + 16 >> 2) * 4, metadata.memorySize);
        LE_HEAP_STORE_U32((handle + 20 >> 2) * 4, tableBase);
        LE_HEAP_STORE_I32((handle + 24 >> 2) * 4, metadata.tableSize);
      }
      if (metadata.tableSize) {
        wasmTable.grow(metadata.tableSize);
      }
      var moduleExports;
      function resolveSymbol(sym) {
        var resolved = resolveGlobalSymbol(sym).sym;
        if (!resolved && localScope) {
          resolved = localScope[sym];
        }
        if (!resolved) {
          resolved = moduleExports[sym];
        }
        return resolved;
      }
      __name(resolveSymbol, "resolveSymbol");
      var proxyHandler = {
        get(stubs, prop) {
          switch (prop) {
            case "__memory_base":
              return memoryBase;
            case "__table_base":
              return tableBase;
          }
          if (prop in wasmImports && !wasmImports[prop].stub) {
            var res = wasmImports[prop];
            return res;
          }
          if (!(prop in stubs)) {
            var resolved;
            stubs[prop] = (...args2) => {
              resolved ||= resolveSymbol(prop);
              return resolved(...args2);
            };
          }
          return stubs[prop];
        }
      };
      var proxy = new Proxy({}, proxyHandler);
      currentModuleWeakSymbols = metadata.weakImports;
      var info = {
        "GOT.mem": new Proxy({}, GOTHandler),
        "GOT.func": new Proxy({}, GOTHandler),
        "env": proxy,
        "wasi_snapshot_preview1": proxy
      };
      function postInstantiation(module, instance) {
        updateTableMap(tableBase, metadata.tableSize);
        moduleExports = relocateExports(instance.exports, memoryBase);
        if (!flags.allowUndefined) {
          reportUndefinedSymbols();
        }
        function addEmAsm(addr, body) {
          var args = [];
          var arity = 0;
          for (; arity < 16; arity++) {
            if (body.indexOf("$" + arity) != -1) {
              args.push("$" + arity);
            } else {
              break;
            }
          }
          args = args.join(",");
          var func = `(${args}) => { ${body} };`;
          ASM_CONSTS[start] = eval(func);
        }
        __name(addEmAsm, "addEmAsm");
        if ("__start_em_asm" in moduleExports) {
          var start = moduleExports["__start_em_asm"];
          var stop = moduleExports["__stop_em_asm"];
          while (start < stop) {
            var jsString = UTF8ToString(start);
            addEmAsm(start, jsString);
            start = HEAPU8.indexOf(0, start) + 1;
          }
        }
        function addEmJs(name, cSig, body) {
          var jsArgs = [];
          cSig = cSig.slice(1, -1);
          if (cSig != "void") {
            cSig = cSig.split(",");
            for (var i in cSig) {
              var jsArg = cSig[i].split(" ").pop();
              jsArgs.push(jsArg.replace("*", ""));
            }
          }
          var func = `(${jsArgs}) => ${body};`;
          moduleExports[name] = eval(func);
        }
        __name(addEmJs, "addEmJs");
        for (var name in moduleExports) {
          if (name.startsWith("__em_js__")) {
            var start = moduleExports[name];
            var jsString = UTF8ToString(start);
            var parts = jsString.split("<::>");
            addEmJs(name.replace("__em_js__", ""), parts[0], parts[1]);
            delete moduleExports[name];
          }
        }
        var applyRelocs = moduleExports["__wasm_apply_data_relocs"];
        if (applyRelocs) {
          if (runtimeInitialized) {
            applyRelocs();
          } else {
            __RELOC_FUNCS__.push(applyRelocs);
          }
        }
        var init = moduleExports["__wasm_call_ctors"];
        if (init) {
          if (runtimeInitialized) {
            init();
          } else {
            addOnPostCtor(init);
          }
        }
        return moduleExports;
      }
      __name(postInstantiation, "postInstantiation");
      if (flags.loadAsync) {
        return (async () => {
          var instance2;
          if (binary instanceof WebAssembly.Module) {
            instance2 = new WebAssembly.Instance(binary, info);
          } else {
            ({ module: binary, instance: instance2 } = await WebAssembly.instantiate(binary, info));
          }
          return postInstantiation(binary, instance2);
        })();
      }
      var module = binary instanceof WebAssembly.Module ? binary : new WebAssembly.Module(binary);
      var instance = new WebAssembly.Instance(module, info);
      return postInstantiation(module, instance);
    }
    __name(loadModule, "loadModule");
    flags = {
      ...flags,
      rpath: {
        parentLibPath: libName,
        paths: metadata.runtimePaths
      }
    };
    if (flags.loadAsync) {
      return metadata.neededDynlibs.reduce((chain, dynNeeded) => chain.then(() => loadDynamicLibrary(dynNeeded, flags, localScope)), Promise.resolve()).then(loadModule);
    }
    metadata.neededDynlibs.forEach((needed) => loadDynamicLibrary(needed, flags, localScope));
    return loadModule();
  }, "loadWebAssemblyModule");
  var mergeLibSymbols = /* @__PURE__ */ __name((exports, libName2) => {
    for (var [sym, exp] of Object.entries(exports)) {
      const setImport = /* @__PURE__ */ __name((target) => {
        if (!isSymbolDefined(target)) {
          wasmImports[target] = exp;
        }
      }, "setImport");
      setImport(sym);
      const main_alias = "__main_argc_argv";
      if (sym == "main") {
        setImport(main_alias);
      }
      if (sym == main_alias) {
        setImport("main");
      }
    }
  }, "mergeLibSymbols");
  var asyncLoad = /* @__PURE__ */ __name(async (url) => {
    var arrayBuffer = await readAsync(url);
    return new Uint8Array(arrayBuffer);
  }, "asyncLoad");
  function loadDynamicLibrary(libName2, flags2 = {
    global: true,
    nodelete: true
  }, localScope2, handle2) {
    var dso = LDSO.loadedLibsByName[libName2];
    if (dso) {
      if (!flags2.global) {
        if (localScope2) {
          Object.assign(localScope2, dso.exports);
        }
      } else if (!dso.global) {
        dso.global = true;
        mergeLibSymbols(dso.exports, libName2);
      }
      if (flags2.nodelete && dso.refcount !== Infinity) {
        dso.refcount = Infinity;
      }
      dso.refcount++;
      if (handle2) {
        LDSO.loadedLibsByHandle[handle2] = dso;
      }
      return flags2.loadAsync ? Promise.resolve(true) : true;
    }
    dso = newDSO(libName2, handle2, "loading");
    dso.refcount = flags2.nodelete ? Infinity : 1;
    dso.global = flags2.global;
    function loadLibData() {
      if (handle2) {
        var data = LE_HEAP_LOAD_U32((handle2 + 28 >> 2) * 4);
        var dataSize = LE_HEAP_LOAD_U32((handle2 + 32 >> 2) * 4);
        if (data && dataSize) {
          var libData = HEAP8.slice(data, data + dataSize);
          return flags2.loadAsync ? Promise.resolve(libData) : libData;
        }
      }
      var libFile = locateFile(libName2);
      if (flags2.loadAsync) {
        return asyncLoad(libFile);
      }
      if (!readBinary) {
        throw new Error(`${libFile}: file not found, and synchronous loading of external files is not available`);
      }
      return readBinary(libFile);
    }
    __name(loadLibData, "loadLibData");
    function getExports() {
      if (flags2.loadAsync) {
        return loadLibData().then((libData) => loadWebAssemblyModule(libData, flags2, libName2, localScope2, handle2));
      }
      return loadWebAssemblyModule(loadLibData(), flags2, libName2, localScope2, handle2);
    }
    __name(getExports, "getExports");
    function moduleLoaded(exports) {
      if (dso.global) {
        mergeLibSymbols(exports, libName2);
      } else if (localScope2) {
        Object.assign(localScope2, exports);
      }
      dso.exports = exports;
    }
    __name(moduleLoaded, "moduleLoaded");
    if (flags2.loadAsync) {
      return getExports().then((exports) => {
        moduleLoaded(exports);
        return true;
      });
    }
    moduleLoaded(getExports());
    return true;
  }
  __name(loadDynamicLibrary, "loadDynamicLibrary");
  var reportUndefinedSymbols = /* @__PURE__ */ __name(() => {
    for (var [symName, entry] of Object.entries(GOT)) {
      if (entry.value == 0) {
        var value = resolveGlobalSymbol(symName, true).sym;
        if (!value && !entry.required) {
          continue;
        }
        if (typeof value == "function") {
          entry.value = addFunction(value, value.sig);
        } else if (typeof value == "number") {
          entry.value = value;
        } else {
          throw new Error(`bad export type for '${symName}': ${typeof value}`);
        }
      }
    }
  }, "reportUndefinedSymbols");
  var runDependencies = 0;
  var dependenciesFulfilled = null;
  var removeRunDependency = /* @__PURE__ */ __name((id) => {
    runDependencies--;
    Module["monitorRunDependencies"]?.(runDependencies);
    if (runDependencies == 0) {
      if (dependenciesFulfilled) {
        var callback = dependenciesFulfilled;
        dependenciesFulfilled = null;
        callback();
      }
    }
  }, "removeRunDependency");
  var addRunDependency = /* @__PURE__ */ __name((id) => {
    runDependencies++;
    Module["monitorRunDependencies"]?.(runDependencies);
  }, "addRunDependency");
  var loadDylibs = /* @__PURE__ */ __name(async () => {
    if (!dynamicLibraries.length) {
      reportUndefinedSymbols();
      return;
    }
    addRunDependency("loadDylibs");
    for (var lib of dynamicLibraries) {
      await loadDynamicLibrary(lib, {
        loadAsync: true,
        global: true,
        nodelete: true,
        allowUndefined: true
      });
    }
    reportUndefinedSymbols();
    removeRunDependency("loadDylibs");
  }, "loadDylibs");
  var noExitRuntime = true;
  function setValue(ptr, value, type = "i8") {
    if (type.endsWith("*")) type = "*";
    switch (type) {
      case "i1":
        HEAP8[ptr] = value;
        break;
      case "i8":
        HEAP8[ptr] = value;
        break;
      case "i16":
        LE_HEAP_STORE_I16((ptr >> 1) * 2, value);
        break;
      case "i32":
        LE_HEAP_STORE_I32((ptr >> 2) * 4, value);
        break;
      case "i64":
        LE_HEAP_STORE_I64((ptr >> 3) * 8, BigInt(value));
        break;
      case "float":
        LE_HEAP_STORE_F32((ptr >> 2) * 4, value);
        break;
      case "double":
        LE_HEAP_STORE_F64((ptr >> 3) * 8, value);
        break;
      case "*":
        LE_HEAP_STORE_U32((ptr >> 2) * 4, value);
        break;
      default:
        abort(`invalid type for setValue: ${type}`);
    }
  }
  __name(setValue, "setValue");
  var ___memory_base = new WebAssembly.Global({
    "value": "i32",
    "mutable": false
  }, 1024);
  var ___stack_high = 78240;
  var ___stack_low = 12704;
  var ___stack_pointer = new WebAssembly.Global({
    "value": "i32",
    "mutable": true
  }, 78240);
  var ___table_base = new WebAssembly.Global({
    "value": "i32",
    "mutable": false
  }, 1);
  var __abort_js = /* @__PURE__ */ __name(() => abort(""), "__abort_js");
  __abort_js.sig = "v";
  var getHeapMax = /* @__PURE__ */ __name(() => (
    // Stay one Wasm page short of 4GB: while e.g. Chrome is able to allocate
    // full 4GB Wasm memories, the size will wrap back to 0 bytes in Wasm side
    // for any code that deals with heap sizes, which would require special
    // casing all heap size related code to treat 0 specially.
    2147483648
  ), "getHeapMax");
  var growMemory = /* @__PURE__ */ __name((size) => {
    var oldHeapSize = wasmMemory.buffer.byteLength;
    var pages = (size - oldHeapSize + 65535) / 65536 | 0;
    try {
      wasmMemory.grow(pages);
      updateMemoryViews();
      return 1;
    } catch (e) {
    }
  }, "growMemory");
  var _emscripten_resize_heap = /* @__PURE__ */ __name((requestedSize) => {
    var oldSize = HEAPU8.length;
    requestedSize >>>= 0;
    var maxHeapSize = getHeapMax();
    if (requestedSize > maxHeapSize) {
      return false;
    }
    for (var cutDown = 1; cutDown <= 4; cutDown *= 2) {
      var overGrownHeapSize = oldSize * (1 + 0.2 / cutDown);
      overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296);
      var newSize = Math.min(maxHeapSize, alignMemory(Math.max(requestedSize, overGrownHeapSize), 65536));
      var replacement = growMemory(newSize);
      if (replacement) {
        return true;
      }
    }
    return false;
  }, "_emscripten_resize_heap");
  _emscripten_resize_heap.sig = "ip";
  var _fd_close = /* @__PURE__ */ __name((fd) => 52, "_fd_close");
  _fd_close.sig = "ii";
  var INT53_MAX = 9007199254740992;
  var INT53_MIN = -9007199254740992;
  var bigintToI53Checked = /* @__PURE__ */ __name((num) => num < INT53_MIN || num > INT53_MAX ? NaN : Number(num), "bigintToI53Checked");
  function _fd_seek(fd, offset, whence, newOffset) {
    offset = bigintToI53Checked(offset);
    return 70;
  }
  __name(_fd_seek, "_fd_seek");
  _fd_seek.sig = "iijip";
  var printCharBuffers = [null, [], []];
  var printChar = /* @__PURE__ */ __name((stream, curr) => {
    var buffer = printCharBuffers[stream];
    if (curr === 0 || curr === 10) {
      (stream === 1 ? out : err)(UTF8ArrayToString(buffer));
      buffer.length = 0;
    } else {
      buffer.push(curr);
    }
  }, "printChar");
  var _fd_write = /* @__PURE__ */ __name((fd, iov, iovcnt, pnum) => {
    var num = 0;
    for (var i2 = 0; i2 < iovcnt; i2++) {
      var ptr = LE_HEAP_LOAD_U32((iov >> 2) * 4);
      var len = LE_HEAP_LOAD_U32((iov + 4 >> 2) * 4);
      iov += 8;
      for (var j = 0; j < len; j++) {
        printChar(fd, HEAPU8[ptr + j]);
      }
      num += len;
    }
    LE_HEAP_STORE_U32((pnum >> 2) * 4, num);
    return 0;
  }, "_fd_write");
  _fd_write.sig = "iippp";
  function _tree_sitter_log_callback(isLexMessage, messageAddress) {
    if (Module.currentLogCallback) {
      const message = UTF8ToString(messageAddress);
      Module.currentLogCallback(message, isLexMessage !== 0);
    }
  }
  __name(_tree_sitter_log_callback, "_tree_sitter_log_callback");
  function _tree_sitter_parse_callback(inputBufferAddress, index, row2, column, lengthAddress) {
    const INPUT_BUFFER_SIZE = 10 * 1024;
    const string = Module.currentParseCallback(index, {
      row: row2,
      column
    });
    if (typeof string === "string") {
      setValue(lengthAddress, string.length, "i32");
      stringToUTF16(string, inputBufferAddress, INPUT_BUFFER_SIZE);
    } else {
      setValue(lengthAddress, 0, "i32");
    }
  }
  __name(_tree_sitter_parse_callback, "_tree_sitter_parse_callback");
  function _tree_sitter_progress_callback(currentOffset, hasError) {
    if (Module.currentProgressCallback) {
      return Module.currentProgressCallback({
        currentOffset,
        hasError
      });
    }
    return false;
  }
  __name(_tree_sitter_progress_callback, "_tree_sitter_progress_callback");
  function _tree_sitter_query_progress_callback(currentOffset) {
    if (Module.currentQueryProgressCallback) {
      return Module.currentQueryProgressCallback({
        currentOffset
      });
    }
    return false;
  }
  __name(_tree_sitter_query_progress_callback, "_tree_sitter_query_progress_callback");
  var runtimeKeepaliveCounter = 0;
  var keepRuntimeAlive = /* @__PURE__ */ __name(() => noExitRuntime || runtimeKeepaliveCounter > 0, "keepRuntimeAlive");
  var _proc_exit = /* @__PURE__ */ __name((code) => {
    EXITSTATUS = code;
    if (!keepRuntimeAlive()) {
      Module["onExit"]?.(code);
      ABORT = true;
    }
    quit_(code, new ExitStatus(code));
  }, "_proc_exit");
  _proc_exit.sig = "vi";
  var exitJS = /* @__PURE__ */ __name((status, implicit) => {
    EXITSTATUS = status;
    _proc_exit(status);
  }, "exitJS");
  var handleException = /* @__PURE__ */ __name((e) => {
    if (e instanceof ExitStatus || e == "unwind") {
      return EXITSTATUS;
    }
    quit_(1, e);
  }, "handleException");
  var lengthBytesUTF8 = /* @__PURE__ */ __name((str) => {
    var len = 0;
    for (var i2 = 0; i2 < str.length; ++i2) {
      var c2 = str.charCodeAt(i2);
      if (c2 <= 127) {
        len++;
      } else if (c2 <= 2047) {
        len += 2;
      } else if (c2 >= 55296 && c2 <= 57343) {
        len += 4;
        ++i2;
      } else {
        len += 3;
      }
    }
    return len;
  }, "lengthBytesUTF8");
  var stringToUTF8Array = /* @__PURE__ */ __name((str, heap, outIdx, maxBytesToWrite) => {
    if (!(maxBytesToWrite > 0)) return 0;
    var startIdx = outIdx;
    var endIdx = outIdx + maxBytesToWrite - 1;
    for (var i2 = 0; i2 < str.length; ++i2) {
      var u = str.codePointAt(i2);
      if (u <= 127) {
        if (outIdx >= endIdx) break;
        heap[outIdx++] = u;
      } else if (u <= 2047) {
        if (outIdx + 1 >= endIdx) break;
        heap[outIdx++] = 192 | u >> 6;
        heap[outIdx++] = 128 | u & 63;
      } else if (u <= 65535) {
        if (outIdx + 2 >= endIdx) break;
        heap[outIdx++] = 224 | u >> 12;
        heap[outIdx++] = 128 | u >> 6 & 63;
        heap[outIdx++] = 128 | u & 63;
      } else {
        if (outIdx + 3 >= endIdx) break;
        heap[outIdx++] = 240 | u >> 18;
        heap[outIdx++] = 128 | u >> 12 & 63;
        heap[outIdx++] = 128 | u >> 6 & 63;
        heap[outIdx++] = 128 | u & 63;
        i2++;
      }
    }
    heap[outIdx] = 0;
    return outIdx - startIdx;
  }, "stringToUTF8Array");
  var stringToUTF8 = /* @__PURE__ */ __name((str, outPtr, maxBytesToWrite) => stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite), "stringToUTF8");
  var stackAlloc = /* @__PURE__ */ __name((sz) => __emscripten_stack_alloc(sz), "stackAlloc");
  var stringToUTF8OnStack = /* @__PURE__ */ __name((str) => {
    var size = lengthBytesUTF8(str) + 1;
    var ret = stackAlloc(size);
    stringToUTF8(str, ret, size);
    return ret;
  }, "stringToUTF8OnStack");
  var AsciiToString = /* @__PURE__ */ __name((ptr) => {
    var str = "";
    while (1) {
      var ch = HEAPU8[ptr++];
      if (!ch) return str;
      str += String.fromCharCode(ch);
    }
  }, "AsciiToString");
  var stringToUTF16 = /* @__PURE__ */ __name((str, outPtr, maxBytesToWrite) => {
    maxBytesToWrite ??= 2147483647;
    if (maxBytesToWrite < 2) return 0;
    maxBytesToWrite -= 2;
    var startPtr = outPtr;
    var numCharsToWrite = maxBytesToWrite < str.length * 2 ? maxBytesToWrite / 2 : str.length;
    for (var i2 = 0; i2 < numCharsToWrite; ++i2) {
      var codeUnit = str.charCodeAt(i2);
      LE_HEAP_STORE_I16((outPtr >> 1) * 2, codeUnit);
      outPtr += 2;
    }
    LE_HEAP_STORE_I16((outPtr >> 1) * 2, 0);
    return outPtr - startPtr;
  }, "stringToUTF16");
  LE_ATOMICS_NATIVE_BYTE_ORDER = new Int8Array(new Int16Array([1]).buffer)[0] === 1 ? [
    /* little endian */
    ((x) => x),
    ((x) => x),
    void 0,
    ((x) => x)
  ] : [
    /* big endian */
    ((x) => x),
    ((x) => ((x & 65280) << 8 | (x & 255) << 24) >> 16),
    void 0,
    ((x) => x >> 24 & 255 | x >> 8 & 65280 | (x & 65280) << 8 | (x & 255) << 24)
  ];
  function LE_HEAP_UPDATE() {
    HEAPU16.unsigned = ((x) => x & 65535);
    HEAPU32.unsigned = ((x) => x >>> 0);
  }
  __name(LE_HEAP_UPDATE, "LE_HEAP_UPDATE");
  {
    initMemory();
    if (Module["noExitRuntime"]) noExitRuntime = Module["noExitRuntime"];
    if (Module["print"]) out = Module["print"];
    if (Module["printErr"]) err = Module["printErr"];
    if (Module["dynamicLibraries"]) dynamicLibraries = Module["dynamicLibraries"];
    if (Module["wasmBinary"]) wasmBinary = Module["wasmBinary"];
    if (Module["arguments"]) arguments_ = Module["arguments"];
    if (Module["thisProgram"]) thisProgram = Module["thisProgram"];
    if (Module["preInit"]) {
      if (typeof Module["preInit"] == "function") Module["preInit"] = [Module["preInit"]];
      while (Module["preInit"].length > 0) {
        Module["preInit"].shift()();
      }
    }
  }
  Module["setValue"] = setValue;
  Module["getValue"] = getValue;
  Module["UTF8ToString"] = UTF8ToString;
  Module["stringToUTF8"] = stringToUTF8;
  Module["lengthBytesUTF8"] = lengthBytesUTF8;
  Module["AsciiToString"] = AsciiToString;
  Module["stringToUTF16"] = stringToUTF16;
  Module["loadWebAssemblyModule"] = loadWebAssemblyModule;
  Module["LE_HEAP_STORE_I64"] = LE_HEAP_STORE_I64;
  var ASM_CONSTS = {};
  var _malloc, _calloc, _realloc, _free, _ts_range_edit, _memcmp, _ts_language_symbol_count, _ts_language_state_count, _ts_language_abi_version, _ts_language_name, _ts_language_field_count, _ts_language_next_state, _ts_language_symbol_name, _ts_language_symbol_for_name, _strncmp, _ts_language_symbol_type, _ts_language_field_name_for_id, _ts_lookahead_iterator_new, _ts_lookahead_iterator_delete, _ts_lookahead_iterator_reset_state, _ts_lookahead_iterator_reset, _ts_lookahead_iterator_next, _ts_lookahead_iterator_current_symbol, _ts_point_edit, _ts_parser_delete, _ts_parser_reset, _ts_parser_set_language, _ts_parser_set_included_ranges, _ts_query_new, _ts_query_delete, _iswspace, _iswalnum, _ts_query_pattern_count, _ts_query_capture_count, _ts_query_string_count, _ts_query_capture_name_for_id, _ts_query_capture_quantifier_for_id, _ts_query_string_value_for_id, _ts_query_predicates_for_pattern, _ts_query_start_byte_for_pattern, _ts_query_end_byte_for_pattern, _ts_query_is_pattern_rooted, _ts_query_is_pattern_non_local, _ts_query_is_pattern_guaranteed_at_step, _ts_query_disable_capture, _ts_query_disable_pattern, _ts_tree_copy, _ts_tree_delete, _ts_init, _ts_parser_new_wasm, _ts_parser_enable_logger_wasm, _ts_parser_parse_wasm, _ts_parser_included_ranges_wasm, _ts_language_type_is_named_wasm, _ts_language_type_is_visible_wasm, _ts_language_metadata_wasm, _ts_language_supertypes_wasm, _ts_language_subtypes_wasm, _ts_tree_root_node_wasm, _ts_tree_root_node_with_offset_wasm, _ts_tree_edit_wasm, _ts_tree_included_ranges_wasm, _ts_tree_get_changed_ranges_wasm, _ts_tree_cursor_new_wasm, _ts_tree_cursor_copy_wasm, _ts_tree_cursor_delete_wasm, _ts_tree_cursor_reset_wasm, _ts_tree_cursor_reset_to_wasm, _ts_tree_cursor_goto_first_child_wasm, _ts_tree_cursor_goto_last_child_wasm, _ts_tree_cursor_goto_first_child_for_index_wasm, _ts_tree_cursor_goto_first_child_for_position_wasm, _ts_tree_cursor_goto_next_sibling_wasm, _ts_tree_cursor_goto_previous_sibling_wasm, _ts_tree_cursor_goto_descendant_wasm, _ts_tree_cursor_goto_parent_wasm, _ts_tree_cursor_current_node_type_id_wasm, _ts_tree_cursor_current_node_state_id_wasm, _ts_tree_cursor_current_node_is_named_wasm, _ts_tree_cursor_current_node_is_missing_wasm, _ts_tree_cursor_current_node_id_wasm, _ts_tree_cursor_start_position_wasm, _ts_tree_cursor_end_position_wasm, _ts_tree_cursor_start_index_wasm, _ts_tree_cursor_end_index_wasm, _ts_tree_cursor_current_field_id_wasm, _ts_tree_cursor_current_depth_wasm, _ts_tree_cursor_current_descendant_index_wasm, _ts_tree_cursor_current_node_wasm, _ts_node_symbol_wasm, _ts_node_field_name_for_child_wasm, _ts_node_field_name_for_named_child_wasm, _ts_node_children_by_field_id_wasm, _ts_node_first_child_for_byte_wasm, _ts_node_first_named_child_for_byte_wasm, _ts_node_grammar_symbol_wasm, _ts_node_child_count_wasm, _ts_node_named_child_count_wasm, _ts_node_child_wasm, _ts_node_named_child_wasm, _ts_node_child_by_field_id_wasm, _ts_node_next_sibling_wasm, _ts_node_prev_sibling_wasm, _ts_node_next_named_sibling_wasm, _ts_node_prev_named_sibling_wasm, _ts_node_descendant_count_wasm, _ts_node_parent_wasm, _ts_node_child_with_descendant_wasm, _ts_node_descendant_for_index_wasm, _ts_node_named_descendant_for_index_wasm, _ts_node_descendant_for_position_wasm, _ts_node_named_descendant_for_position_wasm, _ts_node_start_point_wasm, _ts_node_end_point_wasm, _ts_node_start_index_wasm, _ts_node_end_index_wasm, _ts_node_to_string_wasm, _ts_node_children_wasm, _ts_node_named_children_wasm, _ts_node_descendants_of_type_wasm, _ts_node_is_named_wasm, _ts_node_has_changes_wasm, _ts_node_has_error_wasm, _ts_node_is_error_wasm, _ts_node_is_missing_wasm, _ts_node_is_extra_wasm, _ts_node_parse_state_wasm, _ts_node_next_parse_state_wasm, _ts_query_matches_wasm, _ts_query_captures_wasm, _memset, _memcpy, _memmove, _iswalpha, _iswblank, _iswdigit, _iswlower, _iswupper, _iswxdigit, _memchr, _strlen, _strcmp, _strncat, _strncpy, _towlower, _towupper, _setThrew, __emscripten_stack_restore, __emscripten_stack_alloc, _emscripten_stack_get_current, ___wasm_apply_data_relocs;
  function assignWasmExports(wasmExports2) {
    Module["_malloc"] = _malloc = wasmExports2["malloc"];
    Module["_calloc"] = _calloc = wasmExports2["calloc"];
    Module["_realloc"] = _realloc = wasmExports2["realloc"];
    Module["_free"] = _free = wasmExports2["free"];
    Module["_ts_range_edit"] = _ts_range_edit = wasmExports2["ts_range_edit"];
    Module["_memcmp"] = _memcmp = wasmExports2["memcmp"];
    Module["_ts_language_symbol_count"] = _ts_language_symbol_count = wasmExports2["ts_language_symbol_count"];
    Module["_ts_language_state_count"] = _ts_language_state_count = wasmExports2["ts_language_state_count"];
    Module["_ts_language_abi_version"] = _ts_language_abi_version = wasmExports2["ts_language_abi_version"];
    Module["_ts_language_name"] = _ts_language_name = wasmExports2["ts_language_name"];
    Module["_ts_language_field_count"] = _ts_language_field_count = wasmExports2["ts_language_field_count"];
    Module["_ts_language_next_state"] = _ts_language_next_state = wasmExports2["ts_language_next_state"];
    Module["_ts_language_symbol_name"] = _ts_language_symbol_name = wasmExports2["ts_language_symbol_name"];
    Module["_ts_language_symbol_for_name"] = _ts_language_symbol_for_name = wasmExports2["ts_language_symbol_for_name"];
    Module["_strncmp"] = _strncmp = wasmExports2["strncmp"];
    Module["_ts_language_symbol_type"] = _ts_language_symbol_type = wasmExports2["ts_language_symbol_type"];
    Module["_ts_language_field_name_for_id"] = _ts_language_field_name_for_id = wasmExports2["ts_language_field_name_for_id"];
    Module["_ts_lookahead_iterator_new"] = _ts_lookahead_iterator_new = wasmExports2["ts_lookahead_iterator_new"];
    Module["_ts_lookahead_iterator_delete"] = _ts_lookahead_iterator_delete = wasmExports2["ts_lookahead_iterator_delete"];
    Module["_ts_lookahead_iterator_reset_state"] = _ts_lookahead_iterator_reset_state = wasmExports2["ts_lookahead_iterator_reset_state"];
    Module["_ts_lookahead_iterator_reset"] = _ts_lookahead_iterator_reset = wasmExports2["ts_lookahead_iterator_reset"];
    Module["_ts_lookahead_iterator_next"] = _ts_lookahead_iterator_next = wasmExports2["ts_lookahead_iterator_next"];
    Module["_ts_lookahead_iterator_current_symbol"] = _ts_lookahead_iterator_current_symbol = wasmExports2["ts_lookahead_iterator_current_symbol"];
    Module["_ts_point_edit"] = _ts_point_edit = wasmExports2["ts_point_edit"];
    Module["_ts_parser_delete"] = _ts_parser_delete = wasmExports2["ts_parser_delete"];
    Module["_ts_parser_reset"] = _ts_parser_reset = wasmExports2["ts_parser_reset"];
    Module["_ts_parser_set_language"] = _ts_parser_set_language = wasmExports2["ts_parser_set_language"];
    Module["_ts_parser_set_included_ranges"] = _ts_parser_set_included_ranges = wasmExports2["ts_parser_set_included_ranges"];
    Module["_ts_query_new"] = _ts_query_new = wasmExports2["ts_query_new"];
    Module["_ts_query_delete"] = _ts_query_delete = wasmExports2["ts_query_delete"];
    Module["_iswspace"] = _iswspace = wasmExports2["iswspace"];
    Module["_iswalnum"] = _iswalnum = wasmExports2["iswalnum"];
    Module["_ts_query_pattern_count"] = _ts_query_pattern_count = wasmExports2["ts_query_pattern_count"];
    Module["_ts_query_capture_count"] = _ts_query_capture_count = wasmExports2["ts_query_capture_count"];
    Module["_ts_query_string_count"] = _ts_query_string_count = wasmExports2["ts_query_string_count"];
    Module["_ts_query_capture_name_for_id"] = _ts_query_capture_name_for_id = wasmExports2["ts_query_capture_name_for_id"];
    Module["_ts_query_capture_quantifier_for_id"] = _ts_query_capture_quantifier_for_id = wasmExports2["ts_query_capture_quantifier_for_id"];
    Module["_ts_query_string_value_for_id"] = _ts_query_string_value_for_id = wasmExports2["ts_query_string_value_for_id"];
    Module["_ts_query_predicates_for_pattern"] = _ts_query_predicates_for_pattern = wasmExports2["ts_query_predicates_for_pattern"];
    Module["_ts_query_start_byte_for_pattern"] = _ts_query_start_byte_for_pattern = wasmExports2["ts_query_start_byte_for_pattern"];
    Module["_ts_query_end_byte_for_pattern"] = _ts_query_end_byte_for_pattern = wasmExports2["ts_query_end_byte_for_pattern"];
    Module["_ts_query_is_pattern_rooted"] = _ts_query_is_pattern_rooted = wasmExports2["ts_query_is_pattern_rooted"];
    Module["_ts_query_is_pattern_non_local"] = _ts_query_is_pattern_non_local = wasmExports2["ts_query_is_pattern_non_local"];
    Module["_ts_query_is_pattern_guaranteed_at_step"] = _ts_query_is_pattern_guaranteed_at_step = wasmExports2["ts_query_is_pattern_guaranteed_at_step"];
    Module["_ts_query_disable_capture"] = _ts_query_disable_capture = wasmExports2["ts_query_disable_capture"];
    Module["_ts_query_disable_pattern"] = _ts_query_disable_pattern = wasmExports2["ts_query_disable_pattern"];
    Module["_ts_tree_copy"] = _ts_tree_copy = wasmExports2["ts_tree_copy"];
    Module["_ts_tree_delete"] = _ts_tree_delete = wasmExports2["ts_tree_delete"];
    Module["_ts_init"] = _ts_init = wasmExports2["ts_init"];
    Module["_ts_parser_new_wasm"] = _ts_parser_new_wasm = wasmExports2["ts_parser_new_wasm"];
    Module["_ts_parser_enable_logger_wasm"] = _ts_parser_enable_logger_wasm = wasmExports2["ts_parser_enable_logger_wasm"];
    Module["_ts_parser_parse_wasm"] = _ts_parser_parse_wasm = wasmExports2["ts_parser_parse_wasm"];
    Module["_ts_parser_included_ranges_wasm"] = _ts_parser_included_ranges_wasm = wasmExports2["ts_parser_included_ranges_wasm"];
    Module["_ts_language_type_is_named_wasm"] = _ts_language_type_is_named_wasm = wasmExports2["ts_language_type_is_named_wasm"];
    Module["_ts_language_type_is_visible_wasm"] = _ts_language_type_is_visible_wasm = wasmExports2["ts_language_type_is_visible_wasm"];
    Module["_ts_language_metadata_wasm"] = _ts_language_metadata_wasm = wasmExports2["ts_language_metadata_wasm"];
    Module["_ts_language_supertypes_wasm"] = _ts_language_supertypes_wasm = wasmExports2["ts_language_supertypes_wasm"];
    Module["_ts_language_subtypes_wasm"] = _ts_language_subtypes_wasm = wasmExports2["ts_language_subtypes_wasm"];
    Module["_ts_tree_root_node_wasm"] = _ts_tree_root_node_wasm = wasmExports2["ts_tree_root_node_wasm"];
    Module["_ts_tree_root_node_with_offset_wasm"] = _ts_tree_root_node_with_offset_wasm = wasmExports2["ts_tree_root_node_with_offset_wasm"];
    Module["_ts_tree_edit_wasm"] = _ts_tree_edit_wasm = wasmExports2["ts_tree_edit_wasm"];
    Module["_ts_tree_included_ranges_wasm"] = _ts_tree_included_ranges_wasm = wasmExports2["ts_tree_included_ranges_wasm"];
    Module["_ts_tree_get_changed_ranges_wasm"] = _ts_tree_get_changed_ranges_wasm = wasmExports2["ts_tree_get_changed_ranges_wasm"];
    Module["_ts_tree_cursor_new_wasm"] = _ts_tree_cursor_new_wasm = wasmExports2["ts_tree_cursor_new_wasm"];
    Module["_ts_tree_cursor_copy_wasm"] = _ts_tree_cursor_copy_wasm = wasmExports2["ts_tree_cursor_copy_wasm"];
    Module["_ts_tree_cursor_delete_wasm"] = _ts_tree_cursor_delete_wasm = wasmExports2["ts_tree_cursor_delete_wasm"];
    Module["_ts_tree_cursor_reset_wasm"] = _ts_tree_cursor_reset_wasm = wasmExports2["ts_tree_cursor_reset_wasm"];
    Module["_ts_tree_cursor_reset_to_wasm"] = _ts_tree_cursor_reset_to_wasm = wasmExports2["ts_tree_cursor_reset_to_wasm"];
    Module["_ts_tree_cursor_goto_first_child_wasm"] = _ts_tree_cursor_goto_first_child_wasm = wasmExports2["ts_tree_cursor_goto_first_child_wasm"];
    Module["_ts_tree_cursor_goto_last_child_wasm"] = _ts_tree_cursor_goto_last_child_wasm = wasmExports2["ts_tree_cursor_goto_last_child_wasm"];
    Module["_ts_tree_cursor_goto_first_child_for_index_wasm"] = _ts_tree_cursor_goto_first_child_for_index_wasm = wasmExports2["ts_tree_cursor_goto_first_child_for_index_wasm"];
    Module["_ts_tree_cursor_goto_first_child_for_position_wasm"] = _ts_tree_cursor_goto_first_child_for_position_wasm = wasmExports2["ts_tree_cursor_goto_first_child_for_position_wasm"];
    Module["_ts_tree_cursor_goto_next_sibling_wasm"] = _ts_tree_cursor_goto_next_sibling_wasm = wasmExports2["ts_tree_cursor_goto_next_sibling_wasm"];
    Module["_ts_tree_cursor_goto_previous_sibling_wasm"] = _ts_tree_cursor_goto_previous_sibling_wasm = wasmExports2["ts_tree_cursor_goto_previous_sibling_wasm"];
    Module["_ts_tree_cursor_goto_descendant_wasm"] = _ts_tree_cursor_goto_descendant_wasm = wasmExports2["ts_tree_cursor_goto_descendant_wasm"];
    Module["_ts_tree_cursor_goto_parent_wasm"] = _ts_tree_cursor_goto_parent_wasm = wasmExports2["ts_tree_cursor_goto_parent_wasm"];
    Module["_ts_tree_cursor_current_node_type_id_wasm"] = _ts_tree_cursor_current_node_type_id_wasm = wasmExports2["ts_tree_cursor_current_node_type_id_wasm"];
    Module["_ts_tree_cursor_current_node_state_id_wasm"] = _ts_tree_cursor_current_node_state_id_wasm = wasmExports2["ts_tree_cursor_current_node_state_id_wasm"];
    Module["_ts_tree_cursor_current_node_is_named_wasm"] = _ts_tree_cursor_current_node_is_named_wasm = wasmExports2["ts_tree_cursor_current_node_is_named_wasm"];
    Module["_ts_tree_cursor_current_node_is_missing_wasm"] = _ts_tree_cursor_current_node_is_missing_wasm = wasmExports2["ts_tree_cursor_current_node_is_missing_wasm"];
    Module["_ts_tree_cursor_current_node_id_wasm"] = _ts_tree_cursor_current_node_id_wasm = wasmExports2["ts_tree_cursor_current_node_id_wasm"];
    Module["_ts_tree_cursor_start_position_wasm"] = _ts_tree_cursor_start_position_wasm = wasmExports2["ts_tree_cursor_start_position_wasm"];
    Module["_ts_tree_cursor_end_position_wasm"] = _ts_tree_cursor_end_position_wasm = wasmExports2["ts_tree_cursor_end_position_wasm"];
    Module["_ts_tree_cursor_start_index_wasm"] = _ts_tree_cursor_start_index_wasm = wasmExports2["ts_tree_cursor_start_index_wasm"];
    Module["_ts_tree_cursor_end_index_wasm"] = _ts_tree_cursor_end_index_wasm = wasmExports2["ts_tree_cursor_end_index_wasm"];
    Module["_ts_tree_cursor_current_field_id_wasm"] = _ts_tree_cursor_current_field_id_wasm = wasmExports2["ts_tree_cursor_current_field_id_wasm"];
    Module["_ts_tree_cursor_current_depth_wasm"] = _ts_tree_cursor_current_depth_wasm = wasmExports2["ts_tree_cursor_current_depth_wasm"];
    Module["_ts_tree_cursor_current_descendant_index_wasm"] = _ts_tree_cursor_current_descendant_index_wasm = wasmExports2["ts_tree_cursor_current_descendant_index_wasm"];
    Module["_ts_tree_cursor_current_node_wasm"] = _ts_tree_cursor_current_node_wasm = wasmExports2["ts_tree_cursor_current_node_wasm"];
    Module["_ts_node_symbol_wasm"] = _ts_node_symbol_wasm = wasmExports2["ts_node_symbol_wasm"];
    Module["_ts_node_field_name_for_child_wasm"] = _ts_node_field_name_for_child_wasm = wasmExports2["ts_node_field_name_for_child_wasm"];
    Module["_ts_node_field_name_for_named_child_wasm"] = _ts_node_field_name_for_named_child_wasm = wasmExports2["ts_node_field_name_for_named_child_wasm"];
    Module["_ts_node_children_by_field_id_wasm"] = _ts_node_children_by_field_id_wasm = wasmExports2["ts_node_children_by_field_id_wasm"];
    Module["_ts_node_first_child_for_byte_wasm"] = _ts_node_first_child_for_byte_wasm = wasmExports2["ts_node_first_child_for_byte_wasm"];
    Module["_ts_node_first_named_child_for_byte_wasm"] = _ts_node_first_named_child_for_byte_wasm = wasmExports2["ts_node_first_named_child_for_byte_wasm"];
    Module["_ts_node_grammar_symbol_wasm"] = _ts_node_grammar_symbol_wasm = wasmExports2["ts_node_grammar_symbol_wasm"];
    Module["_ts_node_child_count_wasm"] = _ts_node_child_count_wasm = wasmExports2["ts_node_child_count_wasm"];
    Module["_ts_node_named_child_count_wasm"] = _ts_node_named_child_count_wasm = wasmExports2["ts_node_named_child_count_wasm"];
    Module["_ts_node_child_wasm"] = _ts_node_child_wasm = wasmExports2["ts_node_child_wasm"];
    Module["_ts_node_named_child_wasm"] = _ts_node_named_child_wasm = wasmExports2["ts_node_named_child_wasm"];
    Module["_ts_node_child_by_field_id_wasm"] = _ts_node_child_by_field_id_wasm = wasmExports2["ts_node_child_by_field_id_wasm"];
    Module["_ts_node_next_sibling_wasm"] = _ts_node_next_sibling_wasm = wasmExports2["ts_node_next_sibling_wasm"];
    Module["_ts_node_prev_sibling_wasm"] = _ts_node_prev_sibling_wasm = wasmExports2["ts_node_prev_sibling_wasm"];
    Module["_ts_node_next_named_sibling_wasm"] = _ts_node_next_named_sibling_wasm = wasmExports2["ts_node_next_named_sibling_wasm"];
    Module["_ts_node_prev_named_sibling_wasm"] = _ts_node_prev_named_sibling_wasm = wasmExports2["ts_node_prev_named_sibling_wasm"];
    Module["_ts_node_descendant_count_wasm"] = _ts_node_descendant_count_wasm = wasmExports2["ts_node_descendant_count_wasm"];
    Module["_ts_node_parent_wasm"] = _ts_node_parent_wasm = wasmExports2["ts_node_parent_wasm"];
    Module["_ts_node_child_with_descendant_wasm"] = _ts_node_child_with_descendant_wasm = wasmExports2["ts_node_child_with_descendant_wasm"];
    Module["_ts_node_descendant_for_index_wasm"] = _ts_node_descendant_for_index_wasm = wasmExports2["ts_node_descendant_for_index_wasm"];
    Module["_ts_node_named_descendant_for_index_wasm"] = _ts_node_named_descendant_for_index_wasm = wasmExports2["ts_node_named_descendant_for_index_wasm"];
    Module["_ts_node_descendant_for_position_wasm"] = _ts_node_descendant_for_position_wasm = wasmExports2["ts_node_descendant_for_position_wasm"];
    Module["_ts_node_named_descendant_for_position_wasm"] = _ts_node_named_descendant_for_position_wasm = wasmExports2["ts_node_named_descendant_for_position_wasm"];
    Module["_ts_node_start_point_wasm"] = _ts_node_start_point_wasm = wasmExports2["ts_node_start_point_wasm"];
    Module["_ts_node_end_point_wasm"] = _ts_node_end_point_wasm = wasmExports2["ts_node_end_point_wasm"];
    Module["_ts_node_start_index_wasm"] = _ts_node_start_index_wasm = wasmExports2["ts_node_start_index_wasm"];
    Module["_ts_node_end_index_wasm"] = _ts_node_end_index_wasm = wasmExports2["ts_node_end_index_wasm"];
    Module["_ts_node_to_string_wasm"] = _ts_node_to_string_wasm = wasmExports2["ts_node_to_string_wasm"];
    Module["_ts_node_children_wasm"] = _ts_node_children_wasm = wasmExports2["ts_node_children_wasm"];
    Module["_ts_node_named_children_wasm"] = _ts_node_named_children_wasm = wasmExports2["ts_node_named_children_wasm"];
    Module["_ts_node_descendants_of_type_wasm"] = _ts_node_descendants_of_type_wasm = wasmExports2["ts_node_descendants_of_type_wasm"];
    Module["_ts_node_is_named_wasm"] = _ts_node_is_named_wasm = wasmExports2["ts_node_is_named_wasm"];
    Module["_ts_node_has_changes_wasm"] = _ts_node_has_changes_wasm = wasmExports2["ts_node_has_changes_wasm"];
    Module["_ts_node_has_error_wasm"] = _ts_node_has_error_wasm = wasmExports2["ts_node_has_error_wasm"];
    Module["_ts_node_is_error_wasm"] = _ts_node_is_error_wasm = wasmExports2["ts_node_is_error_wasm"];
    Module["_ts_node_is_missing_wasm"] = _ts_node_is_missing_wasm = wasmExports2["ts_node_is_missing_wasm"];
    Module["_ts_node_is_extra_wasm"] = _ts_node_is_extra_wasm = wasmExports2["ts_node_is_extra_wasm"];
    Module["_ts_node_parse_state_wasm"] = _ts_node_parse_state_wasm = wasmExports2["ts_node_parse_state_wasm"];
    Module["_ts_node_next_parse_state_wasm"] = _ts_node_next_parse_state_wasm = wasmExports2["ts_node_next_parse_state_wasm"];
    Module["_ts_query_matches_wasm"] = _ts_query_matches_wasm = wasmExports2["ts_query_matches_wasm"];
    Module["_ts_query_captures_wasm"] = _ts_query_captures_wasm = wasmExports2["ts_query_captures_wasm"];
    Module["_memset"] = _memset = wasmExports2["memset"];
    Module["_memcpy"] = _memcpy = wasmExports2["memcpy"];
    Module["_memmove"] = _memmove = wasmExports2["memmove"];
    Module["_iswalpha"] = _iswalpha = wasmExports2["iswalpha"];
    Module["_iswblank"] = _iswblank = wasmExports2["iswblank"];
    Module["_iswdigit"] = _iswdigit = wasmExports2["iswdigit"];
    Module["_iswlower"] = _iswlower = wasmExports2["iswlower"];
    Module["_iswupper"] = _iswupper = wasmExports2["iswupper"];
    Module["_iswxdigit"] = _iswxdigit = wasmExports2["iswxdigit"];
    Module["_memchr"] = _memchr = wasmExports2["memchr"];
    Module["_strlen"] = _strlen = wasmExports2["strlen"];
    Module["_strcmp"] = _strcmp = wasmExports2["strcmp"];
    Module["_strncat"] = _strncat = wasmExports2["strncat"];
    Module["_strncpy"] = _strncpy = wasmExports2["strncpy"];
    Module["_towlower"] = _towlower = wasmExports2["towlower"];
    Module["_towupper"] = _towupper = wasmExports2["towupper"];
    _setThrew = wasmExports2["setThrew"];
    __emscripten_stack_restore = wasmExports2["_emscripten_stack_restore"];
    __emscripten_stack_alloc = wasmExports2["_emscripten_stack_alloc"];
    _emscripten_stack_get_current = wasmExports2["emscripten_stack_get_current"];
    ___wasm_apply_data_relocs = wasmExports2["__wasm_apply_data_relocs"];
  }
  __name(assignWasmExports, "assignWasmExports");
  var wasmImports = {
    /** @export */
    __heap_base: ___heap_base,
    /** @export */
    __indirect_function_table: wasmTable,
    /** @export */
    __memory_base: ___memory_base,
    /** @export */
    __stack_high: ___stack_high,
    /** @export */
    __stack_low: ___stack_low,
    /** @export */
    __stack_pointer: ___stack_pointer,
    /** @export */
    __table_base: ___table_base,
    /** @export */
    _abort_js: __abort_js,
    /** @export */
    emscripten_resize_heap: _emscripten_resize_heap,
    /** @export */
    fd_close: _fd_close,
    /** @export */
    fd_seek: _fd_seek,
    /** @export */
    fd_write: _fd_write,
    /** @export */
    memory: wasmMemory,
    /** @export */
    tree_sitter_log_callback: _tree_sitter_log_callback,
    /** @export */
    tree_sitter_parse_callback: _tree_sitter_parse_callback,
    /** @export */
    tree_sitter_progress_callback: _tree_sitter_progress_callback,
    /** @export */
    tree_sitter_query_progress_callback: _tree_sitter_query_progress_callback
  };
  function callMain(args2 = []) {
    var entryFunction = resolveGlobalSymbol("main").sym;
    if (!entryFunction) return;
    args2.unshift(thisProgram);
    var argc = args2.length;
    var argv = stackAlloc((argc + 1) * 4);
    var argv_ptr = argv;
    args2.forEach((arg) => {
      LE_HEAP_STORE_U32((argv_ptr >> 2) * 4, stringToUTF8OnStack(arg));
      argv_ptr += 4;
    });
    LE_HEAP_STORE_U32((argv_ptr >> 2) * 4, 0);
    try {
      var ret = entryFunction(argc, argv);
      exitJS(
        ret,
        /* implicit = */
        true
      );
      return ret;
    } catch (e) {
      return handleException(e);
    }
  }
  __name(callMain, "callMain");
  function run(args2 = arguments_) {
    if (runDependencies > 0) {
      dependenciesFulfilled = run;
      return;
    }
    preRun();
    if (runDependencies > 0) {
      dependenciesFulfilled = run;
      return;
    }
    function doRun() {
      Module["calledRun"] = true;
      if (ABORT) return;
      initRuntime();
      preMain();
      readyPromiseResolve?.(Module);
      Module["onRuntimeInitialized"]?.();
      var noInitialRun = Module["noInitialRun"] || false;
      if (!noInitialRun) callMain(args2);
      postRun();
    }
    __name(doRun, "doRun");
    if (Module["setStatus"]) {
      Module["setStatus"]("Running...");
      setTimeout(() => {
        setTimeout(() => Module["setStatus"](""), 1);
        doRun();
      }, 1);
    } else {
      doRun();
    }
  }
  __name(run, "run");
  var wasmExports;
  wasmExports = await createWasm();
  run();
  if (runtimeInitialized) {
    moduleRtn = Module;
  } else {
    moduleRtn = new Promise((resolve3, reject) => {
      readyPromiseResolve = resolve3;
      readyPromiseReject = reject;
    });
  }
  return moduleRtn;
}
__name(Module2, "Module");
var web_tree_sitter_default = Module2;
var Module3 = null;
async function initializeBinding(moduleOptions) {
  return Module3 ??= await web_tree_sitter_default(moduleOptions);
}
__name(initializeBinding, "initializeBinding");
function checkModule() {
  return !!Module3;
}
__name(checkModule, "checkModule");
var TRANSFER_BUFFER;
var LANGUAGE_VERSION;
var MIN_COMPATIBLE_VERSION;
var Parser = class {
  static {
    __name(this, "Parser");
  }
  /** @internal */
  [0] = 0;
  // Internal handle for Wasm
  /** @internal */
  [1] = 0;
  // Internal handle for Wasm
  /** @internal */
  logCallback = null;
  /** The parser's current language. */
  language = null;
  /**
   * This must always be called before creating a Parser.
   *
   * You can optionally pass in options to configure the Wasm module, the most common
   * one being `locateFile` to help the module find the `.wasm` file.
   */
  static async init(moduleOptions) {
    setModule(await initializeBinding(moduleOptions));
    TRANSFER_BUFFER = C._ts_init();
    LANGUAGE_VERSION = C.getValue(TRANSFER_BUFFER, "i32");
    MIN_COMPATIBLE_VERSION = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
  }
  /**
   * Create a new parser.
   */
  constructor() {
    this.initialize();
  }
  /** @internal */
  initialize() {
    if (!checkModule()) {
      throw new Error("cannot construct a Parser before calling `init()`");
    }
    C._ts_parser_new_wasm();
    this[0] = C.getValue(TRANSFER_BUFFER, "i32");
    this[1] = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
  }
  /** Delete the parser, freeing its resources. */
  delete() {
    C._ts_parser_delete(this[0]);
    C._free(this[1]);
    this[0] = 0;
    this[1] = 0;
  }
  /**
   * Set the language that the parser should use for parsing.
   *
   * If the language was not successfully assigned, an error will be thrown.
   * This happens if the language was generated with an incompatible
   * version of the Tree-sitter CLI. Check the language's version using
   * {@link Language#version} and compare it to this library's
   * {@link LANGUAGE_VERSION} and {@link MIN_COMPATIBLE_VERSION} constants.
   */
  setLanguage(language) {
    let address;
    if (!language) {
      address = 0;
      this.language = null;
    } else if (language.constructor === Language) {
      address = language[0];
      const version = C._ts_language_abi_version(address);
      if (version < MIN_COMPATIBLE_VERSION || LANGUAGE_VERSION < version) {
        throw new Error(
          `Incompatible language version ${version}. Compatibility range ${MIN_COMPATIBLE_VERSION} through ${LANGUAGE_VERSION}.`
        );
      }
      this.language = language;
    } else {
      throw new Error("Argument must be a Language");
    }
    C._ts_parser_set_language(this[0], address);
    return this;
  }
  /**
   * Parse a slice of UTF8 text.
   *
   * @param {string | ParseCallback} callback - The UTF8-encoded text to parse or a callback function.
   *
   * @param {Tree | null} [oldTree] - A previous syntax tree parsed from the same document. If the text of the
   *   document has changed since `oldTree` was created, then you must edit `oldTree` to match
   *   the new text using {@link Tree#edit}.
   *
   * @param {ParseOptions} [options] - Options for parsing the text.
   *  This can be used to set the included ranges, or a progress callback.
   *
   * @returns {Tree | null} A {@link Tree} if parsing succeeded, or `null` if:
   *  - The parser has not yet had a language assigned with {@link Parser#setLanguage}.
   *  - The progress callback returned true.
   */
  parse(callback, oldTree, options) {
    if (typeof callback === "string") {
      C.currentParseCallback = (index) => callback.slice(index);
    } else if (typeof callback === "function") {
      C.currentParseCallback = callback;
    } else {
      throw new Error("Argument must be a string or a function");
    }
    if (options?.progressCallback) {
      C.currentProgressCallback = options.progressCallback;
    } else {
      C.currentProgressCallback = null;
    }
    if (this.logCallback) {
      C.currentLogCallback = this.logCallback;
      C._ts_parser_enable_logger_wasm(this[0], 1);
    } else {
      C.currentLogCallback = null;
      C._ts_parser_enable_logger_wasm(this[0], 0);
    }
    let rangeCount = 0;
    let rangeAddress = 0;
    if (options?.includedRanges) {
      rangeCount = options.includedRanges.length;
      rangeAddress = C._calloc(rangeCount, SIZE_OF_RANGE);
      let address = rangeAddress;
      for (let i2 = 0; i2 < rangeCount; i2++) {
        marshalRange(address, options.includedRanges[i2]);
        address += SIZE_OF_RANGE;
      }
    }
    const treeAddress = C._ts_parser_parse_wasm(
      this[0],
      this[1],
      oldTree ? oldTree[0] : 0,
      rangeAddress,
      rangeCount
    );
    if (!treeAddress) {
      C.currentParseCallback = null;
      C.currentLogCallback = null;
      C.currentProgressCallback = null;
      return null;
    }
    if (!this.language) {
      throw new Error("Parser must have a language to parse");
    }
    const result = new Tree(INTERNAL, treeAddress, this.language, C.currentParseCallback);
    C.currentParseCallback = null;
    C.currentLogCallback = null;
    C.currentProgressCallback = null;
    return result;
  }
  /**
   * Instruct the parser to start the next parse from the beginning.
   *
   * If the parser previously failed because of a callback, 
   * then by default, it will resume where it left off on the
   * next call to {@link Parser#parse} or other parsing functions.
   * If you don't want to resume, and instead intend to use this parser to
   * parse some other document, you must call `reset` first.
   */
  reset() {
    C._ts_parser_reset(this[0]);
  }
  /** Get the ranges of text that the parser will include when parsing. */
  getIncludedRanges() {
    C._ts_parser_included_ranges_wasm(this[0]);
    const count = C.getValue(TRANSFER_BUFFER, "i32");
    const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
    const result = new Array(count);
    if (count > 0) {
      let address = buffer;
      for (let i2 = 0; i2 < count; i2++) {
        result[i2] = unmarshalRange(address);
        address += SIZE_OF_RANGE;
      }
      C._free(buffer);
    }
    return result;
  }
  /** Set the logging callback that a parser should use during parsing. */
  setLogger(callback) {
    if (!callback) {
      this.logCallback = null;
    } else if (typeof callback !== "function") {
      throw new Error("Logger callback must be a function");
    } else {
      this.logCallback = callback;
    }
    return this;
  }
  /** Get the parser's current logger. */
  getLogger() {
    return this.logCallback;
  }
};
var PREDICATE_STEP_TYPE_CAPTURE = 1;
var PREDICATE_STEP_TYPE_STRING = 2;
var QUERY_WORD_REGEX = /[\w-]+/g;
var CaptureQuantifier = {
  Zero: 0,
  ZeroOrOne: 1,
  ZeroOrMore: 2,
  One: 3,
  OneOrMore: 4
};
var isCaptureStep = /* @__PURE__ */ __name((step) => step.type === "capture", "isCaptureStep");
var isStringStep = /* @__PURE__ */ __name((step) => step.type === "string", "isStringStep");
var QueryErrorKind = {
  Syntax: 1,
  NodeName: 2,
  FieldName: 3,
  CaptureName: 4,
  PatternStructure: 5
};
var QueryError = class _QueryError extends Error {
  constructor(kind, info2, index, length) {
    super(_QueryError.formatMessage(kind, info2));
    this.kind = kind;
    this.info = info2;
    this.index = index;
    this.length = length;
    this.name = "QueryError";
  }
  static {
    __name(this, "QueryError");
  }
  /** Formats an error message based on the error kind and info */
  static formatMessage(kind, info2) {
    switch (kind) {
      case QueryErrorKind.NodeName:
        return `Bad node name '${info2.word}'`;
      case QueryErrorKind.FieldName:
        return `Bad field name '${info2.word}'`;
      case QueryErrorKind.CaptureName:
        return `Bad capture name @${info2.word}`;
      case QueryErrorKind.PatternStructure:
        return `Bad pattern structure at offset ${info2.suffix}`;
      case QueryErrorKind.Syntax:
        return `Bad syntax at offset ${info2.suffix}`;
    }
  }
};
function parseAnyPredicate(steps, index, operator, textPredicates) {
  if (steps.length !== 3) {
    throw new Error(
      `Wrong number of arguments to \`#${operator}\` predicate. Expected 2, got ${steps.length - 1}`
    );
  }
  if (!isCaptureStep(steps[1])) {
    throw new Error(
      `First argument of \`#${operator}\` predicate must be a capture. Got "${steps[1].value}"`
    );
  }
  const isPositive = operator === "eq?" || operator === "any-eq?";
  const matchAll = !operator.startsWith("any-");
  if (isCaptureStep(steps[2])) {
    const captureName1 = steps[1].name;
    const captureName2 = steps[2].name;
    textPredicates[index].push((captures) => {
      const nodes1 = [];
      const nodes2 = [];
      for (const c2 of captures) {
        if (c2.name === captureName1) nodes1.push(c2.node);
        if (c2.name === captureName2) nodes2.push(c2.node);
      }
      const compare = /* @__PURE__ */ __name((n1, n2, positive) => {
        return positive ? n1.text === n2.text : n1.text !== n2.text;
      }, "compare");
      return matchAll ? nodes1.every((n1) => nodes2.some((n2) => compare(n1, n2, isPositive))) : nodes1.some((n1) => nodes2.some((n2) => compare(n1, n2, isPositive)));
    });
  } else {
    const captureName = steps[1].name;
    const stringValue = steps[2].value;
    const matches = /* @__PURE__ */ __name((n) => n.text === stringValue, "matches");
    const doesNotMatch = /* @__PURE__ */ __name((n) => n.text !== stringValue, "doesNotMatch");
    textPredicates[index].push((captures) => {
      const nodes = [];
      for (const c2 of captures) {
        if (c2.name === captureName) nodes.push(c2.node);
      }
      const test = isPositive ? matches : doesNotMatch;
      return matchAll ? nodes.every(test) : nodes.some(test);
    });
  }
}
__name(parseAnyPredicate, "parseAnyPredicate");
function parseMatchPredicate(steps, index, operator, textPredicates) {
  if (steps.length !== 3) {
    throw new Error(
      `Wrong number of arguments to \`#${operator}\` predicate. Expected 2, got ${steps.length - 1}.`
    );
  }
  if (steps[1].type !== "capture") {
    throw new Error(
      `First argument of \`#${operator}\` predicate must be a capture. Got "${steps[1].value}".`
    );
  }
  if (steps[2].type !== "string") {
    throw new Error(
      `Second argument of \`#${operator}\` predicate must be a string. Got @${steps[2].name}.`
    );
  }
  const isPositive = operator === "match?" || operator === "any-match?";
  const matchAll = !operator.startsWith("any-");
  const captureName = steps[1].name;
  const regex = new RegExp(steps[2].value);
  textPredicates[index].push((captures) => {
    const nodes = [];
    for (const c2 of captures) {
      if (c2.name === captureName) nodes.push(c2.node.text);
    }
    const test = /* @__PURE__ */ __name((text, positive) => {
      return positive ? regex.test(text) : !regex.test(text);
    }, "test");
    if (nodes.length === 0) return !isPositive;
    return matchAll ? nodes.every((text) => test(text, isPositive)) : nodes.some((text) => test(text, isPositive));
  });
}
__name(parseMatchPredicate, "parseMatchPredicate");
function parseAnyOfPredicate(steps, index, operator, textPredicates) {
  if (steps.length < 2) {
    throw new Error(
      `Wrong number of arguments to \`#${operator}\` predicate. Expected at least 1. Got ${steps.length - 1}.`
    );
  }
  if (steps[1].type !== "capture") {
    throw new Error(
      `First argument of \`#${operator}\` predicate must be a capture. Got "${steps[1].value}".`
    );
  }
  const isPositive = operator === "any-of?";
  const captureName = steps[1].name;
  const stringSteps = steps.slice(2);
  if (!stringSteps.every(isStringStep)) {
    throw new Error(
      `Arguments to \`#${operator}\` predicate must be strings.".`
    );
  }
  const values = stringSteps.map((s) => s.value);
  textPredicates[index].push((captures) => {
    const nodes = [];
    for (const c2 of captures) {
      if (c2.name === captureName) nodes.push(c2.node.text);
    }
    if (nodes.length === 0) return !isPositive;
    return nodes.every((text) => values.includes(text)) === isPositive;
  });
}
__name(parseAnyOfPredicate, "parseAnyOfPredicate");
function parseIsPredicate(steps, index, operator, assertedProperties, refutedProperties) {
  if (steps.length < 2 || steps.length > 3) {
    throw new Error(
      `Wrong number of arguments to \`#${operator}\` predicate. Expected 1 or 2. Got ${steps.length - 1}.`
    );
  }
  if (!steps.every(isStringStep)) {
    throw new Error(
      `Arguments to \`#${operator}\` predicate must be strings.".`
    );
  }
  const properties = operator === "is?" ? assertedProperties : refutedProperties;
  if (!properties[index]) properties[index] = {};
  properties[index][steps[1].value] = steps[2]?.value ?? null;
}
__name(parseIsPredicate, "parseIsPredicate");
function parseSetDirective(steps, index, setProperties) {
  if (steps.length < 2 || steps.length > 3) {
    throw new Error(`Wrong number of arguments to \`#set!\` predicate. Expected 1 or 2. Got ${steps.length - 1}.`);
  }
  if (!steps.every(isStringStep)) {
    throw new Error(`Arguments to \`#set!\` predicate must be strings.".`);
  }
  if (!setProperties[index]) setProperties[index] = {};
  setProperties[index][steps[1].value] = steps[2]?.value ?? null;
}
__name(parseSetDirective, "parseSetDirective");
function parsePattern(index, stepType, stepValueId, captureNames, stringValues, steps, textPredicates, predicates, setProperties, assertedProperties, refutedProperties) {
  if (stepType === PREDICATE_STEP_TYPE_CAPTURE) {
    const name2 = captureNames[stepValueId];
    steps.push({ type: "capture", name: name2 });
  } else if (stepType === PREDICATE_STEP_TYPE_STRING) {
    steps.push({ type: "string", value: stringValues[stepValueId] });
  } else if (steps.length > 0) {
    if (steps[0].type !== "string") {
      throw new Error("Predicates must begin with a literal value");
    }
    const operator = steps[0].value;
    switch (operator) {
      case "any-not-eq?":
      case "not-eq?":
      case "any-eq?":
      case "eq?":
        parseAnyPredicate(steps, index, operator, textPredicates);
        break;
      case "any-not-match?":
      case "not-match?":
      case "any-match?":
      case "match?":
        parseMatchPredicate(steps, index, operator, textPredicates);
        break;
      case "not-any-of?":
      case "any-of?":
        parseAnyOfPredicate(steps, index, operator, textPredicates);
        break;
      case "is?":
      case "is-not?":
        parseIsPredicate(steps, index, operator, assertedProperties, refutedProperties);
        break;
      case "set!":
        parseSetDirective(steps, index, setProperties);
        break;
      default:
        predicates[index].push({ operator, operands: steps.slice(1) });
    }
    steps.length = 0;
  }
}
__name(parsePattern, "parsePattern");
var Query = class {
  static {
    __name(this, "Query");
  }
  /** @internal */
  [0] = 0;
  // Internal handle for Wasm
  /** @internal */
  exceededMatchLimit;
  /** @internal */
  textPredicates;
  /** The names of the captures used in the query. */
  captureNames;
  /** The quantifiers of the captures used in the query. */
  captureQuantifiers;
  /**
   * The other user-defined predicates associated with the given index.
   *
   * This includes predicates with operators other than:
   * - `match?`
   * - `eq?` and `not-eq?`
   * - `any-of?` and `not-any-of?`
   * - `is?` and `is-not?`
   * - `set!`
   */
  predicates;
  /** The properties for predicates with the operator `set!`. */
  setProperties;
  /** The properties for predicates with the operator `is?`. */
  assertedProperties;
  /** The properties for predicates with the operator `is-not?`. */
  refutedProperties;
  /** The maximum number of in-progress matches for this cursor. */
  matchLimit;
  /**
   * Create a new query from a string containing one or more S-expression
   * patterns.
   *
   * The query is associated with a particular language, and can only be run
   * on syntax nodes parsed with that language. References to Queries can be
   * shared between multiple threads.
   *
   * @link {@see https://tree-sitter.github.io/tree-sitter/using-parsers/queries}
   */
  constructor(language, source) {
    const sourceLength = C.lengthBytesUTF8(source);
    const sourceAddress = C._malloc(sourceLength + 1);
    C.stringToUTF8(source, sourceAddress, sourceLength + 1);
    const address = C._ts_query_new(
      language[0],
      sourceAddress,
      sourceLength,
      TRANSFER_BUFFER,
      TRANSFER_BUFFER + SIZE_OF_INT
    );
    if (!address) {
      const errorId = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
      const errorByte = C.getValue(TRANSFER_BUFFER, "i32");
      const errorIndex = C.UTF8ToString(sourceAddress, errorByte).length;
      const suffix = source.slice(errorIndex, errorIndex + 100).split("\n")[0];
      const word = suffix.match(QUERY_WORD_REGEX)?.[0] ?? "";
      C._free(sourceAddress);
      switch (errorId) {
        case QueryErrorKind.Syntax:
          throw new QueryError(QueryErrorKind.Syntax, { suffix: `${errorIndex}: '${suffix}'...` }, errorIndex, 0);
        case QueryErrorKind.NodeName:
          throw new QueryError(errorId, { word }, errorIndex, word.length);
        case QueryErrorKind.FieldName:
          throw new QueryError(errorId, { word }, errorIndex, word.length);
        case QueryErrorKind.CaptureName:
          throw new QueryError(errorId, { word }, errorIndex, word.length);
        case QueryErrorKind.PatternStructure:
          throw new QueryError(errorId, { suffix: `${errorIndex}: '${suffix}'...` }, errorIndex, 0);
      }
    }
    const stringCount = C._ts_query_string_count(address);
    const captureCount = C._ts_query_capture_count(address);
    const patternCount = C._ts_query_pattern_count(address);
    const captureNames = new Array(captureCount);
    const captureQuantifiers = new Array(patternCount);
    const stringValues = new Array(stringCount);
    for (let i2 = 0; i2 < captureCount; i2++) {
      const nameAddress = C._ts_query_capture_name_for_id(
        address,
        i2,
        TRANSFER_BUFFER
      );
      const nameLength = C.getValue(TRANSFER_BUFFER, "i32");
      captureNames[i2] = C.UTF8ToString(nameAddress, nameLength);
    }
    for (let i2 = 0; i2 < patternCount; i2++) {
      const captureQuantifiersArray = new Array(captureCount);
      for (let j = 0; j < captureCount; j++) {
        const quantifier = C._ts_query_capture_quantifier_for_id(address, i2, j);
        captureQuantifiersArray[j] = quantifier;
      }
      captureQuantifiers[i2] = captureQuantifiersArray;
    }
    for (let i2 = 0; i2 < stringCount; i2++) {
      const valueAddress = C._ts_query_string_value_for_id(
        address,
        i2,
        TRANSFER_BUFFER
      );
      const nameLength = C.getValue(TRANSFER_BUFFER, "i32");
      stringValues[i2] = C.UTF8ToString(valueAddress, nameLength);
    }
    const setProperties = new Array(patternCount);
    const assertedProperties = new Array(patternCount);
    const refutedProperties = new Array(patternCount);
    const predicates = new Array(patternCount);
    const textPredicates = new Array(patternCount);
    for (let i2 = 0; i2 < patternCount; i2++) {
      const predicatesAddress = C._ts_query_predicates_for_pattern(address, i2, TRANSFER_BUFFER);
      const stepCount = C.getValue(TRANSFER_BUFFER, "i32");
      predicates[i2] = [];
      textPredicates[i2] = [];
      const steps = new Array();
      let stepAddress = predicatesAddress;
      for (let j = 0; j < stepCount; j++) {
        const stepType = C.getValue(stepAddress, "i32");
        stepAddress += SIZE_OF_INT;
        const stepValueId = C.getValue(stepAddress, "i32");
        stepAddress += SIZE_OF_INT;
        parsePattern(
          i2,
          stepType,
          stepValueId,
          captureNames,
          stringValues,
          steps,
          textPredicates,
          predicates,
          setProperties,
          assertedProperties,
          refutedProperties
        );
      }
      Object.freeze(textPredicates[i2]);
      Object.freeze(predicates[i2]);
      Object.freeze(setProperties[i2]);
      Object.freeze(assertedProperties[i2]);
      Object.freeze(refutedProperties[i2]);
    }
    C._free(sourceAddress);
    this[0] = address;
    this.captureNames = captureNames;
    this.captureQuantifiers = captureQuantifiers;
    this.textPredicates = textPredicates;
    this.predicates = predicates;
    this.setProperties = setProperties;
    this.assertedProperties = assertedProperties;
    this.refutedProperties = refutedProperties;
    this.exceededMatchLimit = false;
  }
  /** Delete the query, freeing its resources. */
  delete() {
    C._ts_query_delete(this[0]);
    this[0] = 0;
  }
  /**
   * Iterate over all of the matches in the order that they were found.
   *
   * Each match contains the index of the pattern that matched, and a list of
   * captures. Because multiple patterns can match the same set of nodes,
   * one match may contain captures that appear *before* some of the
   * captures from a previous match.
   *
   * @param {Node} node - The node to execute the query on.
   *
   * @param {QueryOptions} options - Options for query execution.
   */
  matches(node, options = {}) {
    const startPosition = options.startPosition ?? ZERO_POINT;
    const endPosition = options.endPosition ?? ZERO_POINT;
    const startIndex = options.startIndex ?? 0;
    const endIndex = options.endIndex ?? 0;
    const startContainingPosition = options.startContainingPosition ?? ZERO_POINT;
    const endContainingPosition = options.endContainingPosition ?? ZERO_POINT;
    const startContainingIndex = options.startContainingIndex ?? 0;
    const endContainingIndex = options.endContainingIndex ?? 0;
    const matchLimit = options.matchLimit ?? 4294967295;
    const maxStartDepth = options.maxStartDepth ?? 4294967295;
    const progressCallback = options.progressCallback;
    if (typeof matchLimit !== "number") {
      throw new Error("Arguments must be numbers");
    }
    this.matchLimit = matchLimit;
    if (endIndex !== 0 && startIndex > endIndex) {
      throw new Error("`startIndex` cannot be greater than `endIndex`");
    }
    if (endPosition !== ZERO_POINT && (startPosition.row > endPosition.row || startPosition.row === endPosition.row && startPosition.column > endPosition.column)) {
      throw new Error("`startPosition` cannot be greater than `endPosition`");
    }
    if (endContainingIndex !== 0 && startContainingIndex > endContainingIndex) {
      throw new Error("`startContainingIndex` cannot be greater than `endContainingIndex`");
    }
    if (endContainingPosition !== ZERO_POINT && (startContainingPosition.row > endContainingPosition.row || startContainingPosition.row === endContainingPosition.row && startContainingPosition.column > endContainingPosition.column)) {
      throw new Error("`startContainingPosition` cannot be greater than `endContainingPosition`");
    }
    if (progressCallback) {
      C.currentQueryProgressCallback = progressCallback;
    }
    marshalNode(node);
    C._ts_query_matches_wasm(
      this[0],
      node.tree[0],
      startPosition.row,
      startPosition.column,
      endPosition.row,
      endPosition.column,
      startIndex,
      endIndex,
      startContainingPosition.row,
      startContainingPosition.column,
      endContainingPosition.row,
      endContainingPosition.column,
      startContainingIndex,
      endContainingIndex,
      matchLimit,
      maxStartDepth
    );
    const rawCount = C.getValue(TRANSFER_BUFFER, "i32");
    const startAddress = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
    const didExceedMatchLimit = C.getValue(TRANSFER_BUFFER + 2 * SIZE_OF_INT, "i32");
    const result = new Array(rawCount);
    this.exceededMatchLimit = Boolean(didExceedMatchLimit);
    let filteredCount = 0;
    let address = startAddress;
    for (let i2 = 0; i2 < rawCount; i2++) {
      const patternIndex = C.getValue(address, "i32");
      address += SIZE_OF_INT;
      const captureCount = C.getValue(address, "i32");
      address += SIZE_OF_INT;
      const captures = new Array(captureCount);
      address = unmarshalCaptures(this, node.tree, address, patternIndex, captures);
      if (this.textPredicates[patternIndex].every((p) => p(captures))) {
        result[filteredCount] = { patternIndex, captures };
        const setProperties = this.setProperties[patternIndex];
        result[filteredCount].setProperties = setProperties;
        const assertedProperties = this.assertedProperties[patternIndex];
        result[filteredCount].assertedProperties = assertedProperties;
        const refutedProperties = this.refutedProperties[patternIndex];
        result[filteredCount].refutedProperties = refutedProperties;
        filteredCount++;
      }
    }
    result.length = filteredCount;
    C._free(startAddress);
    C.currentQueryProgressCallback = null;
    return result;
  }
  /**
   * Iterate over all of the individual captures in the order that they
   * appear.
   *
   * This is useful if you don't care about which pattern matched, and just
   * want a single, ordered sequence of captures.
   *
   * @param {Node} node - The node to execute the query on.
   *
   * @param {QueryOptions} options - Options for query execution.
   */
  captures(node, options = {}) {
    const startPosition = options.startPosition ?? ZERO_POINT;
    const endPosition = options.endPosition ?? ZERO_POINT;
    const startIndex = options.startIndex ?? 0;
    const endIndex = options.endIndex ?? 0;
    const startContainingPosition = options.startContainingPosition ?? ZERO_POINT;
    const endContainingPosition = options.endContainingPosition ?? ZERO_POINT;
    const startContainingIndex = options.startContainingIndex ?? 0;
    const endContainingIndex = options.endContainingIndex ?? 0;
    const matchLimit = options.matchLimit ?? 4294967295;
    const maxStartDepth = options.maxStartDepth ?? 4294967295;
    const progressCallback = options.progressCallback;
    if (typeof matchLimit !== "number") {
      throw new Error("Arguments must be numbers");
    }
    this.matchLimit = matchLimit;
    if (endIndex !== 0 && startIndex > endIndex) {
      throw new Error("`startIndex` cannot be greater than `endIndex`");
    }
    if (endPosition !== ZERO_POINT && (startPosition.row > endPosition.row || startPosition.row === endPosition.row && startPosition.column > endPosition.column)) {
      throw new Error("`startPosition` cannot be greater than `endPosition`");
    }
    if (endContainingIndex !== 0 && startContainingIndex > endContainingIndex) {
      throw new Error("`startContainingIndex` cannot be greater than `endContainingIndex`");
    }
    if (endContainingPosition !== ZERO_POINT && (startContainingPosition.row > endContainingPosition.row || startContainingPosition.row === endContainingPosition.row && startContainingPosition.column > endContainingPosition.column)) {
      throw new Error("`startContainingPosition` cannot be greater than `endContainingPosition`");
    }
    if (progressCallback) {
      C.currentQueryProgressCallback = progressCallback;
    }
    marshalNode(node);
    C._ts_query_captures_wasm(
      this[0],
      node.tree[0],
      startPosition.row,
      startPosition.column,
      endPosition.row,
      endPosition.column,
      startIndex,
      endIndex,
      startContainingPosition.row,
      startContainingPosition.column,
      endContainingPosition.row,
      endContainingPosition.column,
      startContainingIndex,
      endContainingIndex,
      matchLimit,
      maxStartDepth
    );
    const count = C.getValue(TRANSFER_BUFFER, "i32");
    const startAddress = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
    const didExceedMatchLimit = C.getValue(TRANSFER_BUFFER + 2 * SIZE_OF_INT, "i32");
    const result = new Array();
    this.exceededMatchLimit = Boolean(didExceedMatchLimit);
    const captures = new Array();
    let address = startAddress;
    for (let i2 = 0; i2 < count; i2++) {
      const patternIndex = C.getValue(address, "i32");
      address += SIZE_OF_INT;
      const captureCount = C.getValue(address, "i32");
      address += SIZE_OF_INT;
      const captureIndex = C.getValue(address, "i32");
      address += SIZE_OF_INT;
      captures.length = captureCount;
      address = unmarshalCaptures(this, node.tree, address, patternIndex, captures);
      if (this.textPredicates[patternIndex].every((p) => p(captures))) {
        const capture = captures[captureIndex];
        const setProperties = this.setProperties[patternIndex];
        capture.setProperties = setProperties;
        const assertedProperties = this.assertedProperties[patternIndex];
        capture.assertedProperties = assertedProperties;
        const refutedProperties = this.refutedProperties[patternIndex];
        capture.refutedProperties = refutedProperties;
        result.push(capture);
      }
    }
    C._free(startAddress);
    C.currentQueryProgressCallback = null;
    return result;
  }
  /** Get the predicates for a given pattern. */
  predicatesForPattern(patternIndex) {
    return this.predicates[patternIndex];
  }
  /**
   * Disable a certain capture within a query.
   *
   * This prevents the capture from being returned in matches, and also
   * avoids any resource usage associated with recording the capture.
   */
  disableCapture(captureName) {
    const captureNameLength = C.lengthBytesUTF8(captureName);
    const captureNameAddress = C._malloc(captureNameLength + 1);
    C.stringToUTF8(captureName, captureNameAddress, captureNameLength + 1);
    C._ts_query_disable_capture(this[0], captureNameAddress, captureNameLength);
    C._free(captureNameAddress);
  }
  /**
   * Disable a certain pattern within a query.
   *
   * This prevents the pattern from matching, and also avoids any resource
   * usage associated with the pattern. This throws an error if the pattern
   * index is out of bounds.
   */
  disablePattern(patternIndex) {
    if (patternIndex >= this.predicates.length) {
      throw new Error(
        `Pattern index is ${patternIndex} but the pattern count is ${this.predicates.length}`
      );
    }
    C._ts_query_disable_pattern(this[0], patternIndex);
  }
  /**
   * Check if, on its last execution, this cursor exceeded its maximum number
   * of in-progress matches.
   */
  didExceedMatchLimit() {
    return this.exceededMatchLimit;
  }
  /** Get the byte offset where the given pattern starts in the query's source. */
  startIndexForPattern(patternIndex) {
    if (patternIndex >= this.predicates.length) {
      throw new Error(
        `Pattern index is ${patternIndex} but the pattern count is ${this.predicates.length}`
      );
    }
    return C._ts_query_start_byte_for_pattern(this[0], patternIndex);
  }
  /** Get the byte offset where the given pattern ends in the query's source. */
  endIndexForPattern(patternIndex) {
    if (patternIndex >= this.predicates.length) {
      throw new Error(
        `Pattern index is ${patternIndex} but the pattern count is ${this.predicates.length}`
      );
    }
    return C._ts_query_end_byte_for_pattern(this[0], patternIndex);
  }
  /** Get the number of patterns in the query. */
  patternCount() {
    return C._ts_query_pattern_count(this[0]);
  }
  /** Get the index for a given capture name. */
  captureIndexForName(captureName) {
    return this.captureNames.indexOf(captureName);
  }
  /** Check if a given pattern within a query has a single root node. */
  isPatternRooted(patternIndex) {
    return C._ts_query_is_pattern_rooted(this[0], patternIndex) === 1;
  }
  /** Check if a given pattern within a query has a single root node. */
  isPatternNonLocal(patternIndex) {
    return C._ts_query_is_pattern_non_local(this[0], patternIndex) === 1;
  }
  /**
   * Check if a given step in a query is 'definite'.
   *
   * A query step is 'definite' if its parent pattern will be guaranteed to
   * match successfully once it reaches the step.
   */
  isPatternGuaranteedAtStep(byteIndex) {
    return C._ts_query_is_pattern_guaranteed_at_step(this[0], byteIndex) === 1;
  }
};

// src/ast/loader.ts
var EXT_GRAMMAR = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".rb": "ruby",
  ".rake": "ruby",
  ".c": "c",
  ".h": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".cs": "c_sharp",
  ".php": "php"
};
function grammarKeyForExt(ext) {
  return EXT_GRAMMAR[ext];
}
function resolveGrammarDir() {
  const env = process.env.ULTRAINDEX_GRAMMAR_DIR;
  if (env && existsSync(env)) return env;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join2(here, "grammars"),
    // bundle: <...>/scripts/grammars
    join2(here, "..", "..", "scripts", "grammars"),
    // dev: src/ast → <repo>/scripts/grammars
    join2(here, "..", "scripts", "grammars")
  ];
  for (const c2 of candidates) if (existsSync(c2)) return c2;
  return join2(here, "grammars");
}
var runtimeReady = false;
var parser = null;
var loaded = /* @__PURE__ */ new Map();
var failed = /* @__PURE__ */ new Set();
async function ensureGrammars(keys) {
  const dir = resolveGrammarDir();
  if (!runtimeReady) {
    const runtime = join2(dir, "web-tree-sitter.wasm");
    if (!existsSync(runtime)) return;
    await Parser.init({ wasmBinary: readFileSync2(runtime) });
    runtimeReady = true;
    parser = new Parser();
  }
  for (const key of new Set(keys)) {
    if (loaded.has(key) || failed.has(key)) continue;
    const wasm = join2(dir, `${key}.wasm`);
    if (!existsSync(wasm)) {
      failed.add(key);
      continue;
    }
    try {
      loaded.set(key, await Language.load(new Uint8Array(readFileSync2(wasm))));
    } catch {
      failed.add(key);
    }
  }
}
function allGrammarKeys() {
  return [...new Set(Object.values(EXT_GRAMMAR))];
}
function grammarReady(key) {
  return loaded.has(key);
}
function parserFor(key) {
  const lang = loaded.get(key);
  if (!parser || !lang) return null;
  parser.setLanguage(lang);
  return parser;
}

// src/ast/extract.ts
var MAX_REF_IDENTS = 256;
var MAX_CALLS = 512;
var MAX_IMPORTED_NAMES = 256;
function collectRefIdents(root, defNames) {
  const found = /* @__PURE__ */ new Set();
  const visit = (node) => {
    if (node.namedChildCount === 0 && /identifier|constant|(^|_)name$/.test(node.type) && /^[A-Za-z_]\w{4,}$/.test(node.text) && !defNames.has(node.text)) {
      found.add(node.text);
    }
    for (let i2 = 0; i2 < node.namedChildCount; i2++) visit(node.namedChild(i2));
  };
  visit(root);
  return [...found].sort().slice(0, MAX_REF_IDENTS);
}
var byPublicKeyword = (line) => /\b(public|internal)\b/.test(line);
var byPub = (line) => /\bpub\b/.test(line);
var byCapital = (_l, name2) => /^[A-Z]/.test(name2);
var byPyConvention = (_l, name2) => !name2.startsWith("_") || /^__\w+__$/.test(name2);
var always = () => true;
var neverExport = () => false;
var TS_SPEC = {
  lang: "typescript",
  defs: {
    function_declaration: "function",
    generator_function_declaration: "function",
    class_declaration: "class",
    abstract_class_declaration: "class",
    interface_declaration: "interface",
    type_alias_declaration: "type",
    enum_declaration: "enum",
    method_definition: "method",
    variable_declarator: "const"
  },
  containers: /* @__PURE__ */ new Set(["class_body", "export_statement", "program", "lexical_declaration", "variable_declaration"]),
  exported: neverExport,
  // export is tracked structurally via export_statement; see walk
  imports: { import_statement: "string" },
  calls: { call_expression: "function", new_expression: "constructor" }
};
var SPECS = {
  typescript: TS_SPEC,
  tsx: { ...TS_SPEC, lang: "typescript" },
  javascript: {
    ...TS_SPEC,
    lang: "javascript",
    defs: {
      function_declaration: "function",
      generator_function_declaration: "function",
      class_declaration: "class",
      method_definition: "method",
      variable_declarator: "const"
    }
  },
  python: {
    lang: "python",
    defs: { function_definition: "function", class_definition: "class" },
    containers: /* @__PURE__ */ new Set(["block", "decorated_definition", "module"]),
    exported: byPyConvention,
    imports: { import_statement: "path", import_from_statement: "path" },
    calls: { call: "function" }
  },
  go: {
    lang: "go",
    defs: {
      function_declaration: "function",
      method_declaration: "method",
      type_spec: "type",
      const_spec: "const",
      var_spec: "var"
    },
    containers: /* @__PURE__ */ new Set(["type_declaration", "const_declaration", "var_declaration", "source_file"]),
    exported: byCapital,
    imports: { import_declaration: "string" },
    calls: { call_expression: "function" }
  },
  ruby: {
    lang: "ruby",
    defs: { method: "def", singleton_method: "def", class: "class", module: "module" },
    containers: /* @__PURE__ */ new Set(["class", "module", "body_statement", "program"]),
    exported: always,
    // Ruby models every invocation — dotted, parenthesized, or bare command form
    // (`puts "x"`) — as a `call` node whose callee is the `method` field.
    calls: { call: "function" }
  },
  java: {
    lang: "java",
    defs: {
      class_declaration: "class",
      interface_declaration: "interface",
      enum_declaration: "enum",
      record_declaration: "record",
      method_declaration: "method",
      constructor_declaration: "constructor"
    },
    containers: /* @__PURE__ */ new Set(["class_body", "interface_body", "enum_body", "program"]),
    exported: byPublicKeyword,
    imports: { import_declaration: "path" },
    calls: { method_invocation: "function", object_creation_expression: "constructor" }
  },
  rust: {
    lang: "rust",
    defs: {
      function_item: "function",
      struct_item: "struct",
      enum_item: "enum",
      trait_item: "trait",
      type_item: "type",
      mod_item: "mod",
      const_item: "const",
      static_item: "static",
      union_item: "union",
      macro_definition: "macro"
    },
    containers: /* @__PURE__ */ new Set(["impl_item", "declaration_list", "source_file"]),
    exported: byPub,
    calls: { call_expression: "function" }
  },
  c_sharp: {
    lang: "csharp",
    defs: {
      class_declaration: "class",
      interface_declaration: "interface",
      struct_declaration: "struct",
      enum_declaration: "enum",
      record_declaration: "record",
      method_declaration: "method",
      constructor_declaration: "constructor",
      property_declaration: "property"
    },
    containers: /* @__PURE__ */ new Set(["namespace_declaration", "declaration_list", "compilation_unit", "file_scoped_namespace_declaration"]),
    exported: byPublicKeyword,
    calls: { invocation_expression: "function", object_creation_expression: "constructor" }
  },
  php: {
    lang: "php",
    defs: {
      function_definition: "function",
      class_declaration: "class",
      interface_declaration: "interface",
      trait_declaration: "trait",
      enum_declaration: "enum",
      method_declaration: "method"
    },
    containers: /* @__PURE__ */ new Set(["declaration_list", "program"]),
    exported: always,
    calls: { function_call_expression: "function", member_call_expression: "member", object_creation_expression: "constructor" }
  }
};
function firstLine(node) {
  const nl = node.text.indexOf("\n");
  return (nl === -1 ? node.text : node.text.slice(0, nl)).trim().slice(0, 200);
}
function nameOf(node) {
  const named = node.childForFieldName("name");
  if (named?.text) return named.text;
  for (let i2 = 0; i2 < node.namedChildCount; i2++) {
    const c2 = node.namedChild(i2);
    if (/(^|_)(identifier|name|constant)$/.test(c2.type)) return c2.text;
  }
  return void 0;
}
function collectImports(root, spec) {
  if (!spec.imports) return [];
  const out2 = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (s) => {
    const v = s.trim();
    if (v && !seen.has(v)) {
      seen.add(v);
      out2.push({ kind: "import", spec: v });
    }
  };
  const visit = (node) => {
    const how = spec.imports[node.type];
    if (how === "string") {
      const str = findFirst(node, (n) => /string/.test(n.type));
      if (str) add(str.text.replace(/^['"]|['"]$/g, ""));
    } else if (how === "path") {
      const name2 = node.childForFieldName("name") ?? node.childForFieldName("module_name");
      add((name2 ?? node).text.replace(/^(import|from)\s+/, "").split(/\s+/)[0]);
    }
    for (let i2 = 0; i2 < node.namedChildCount; i2++) visit(node.namedChild(i2));
  };
  visit(root);
  return out2;
}
function findFirst(node, pred) {
  for (let i2 = 0; i2 < node.namedChildCount; i2++) {
    const c2 = node.namedChild(i2);
    if (pred(c2)) return c2;
    const deep = findFirst(c2, pred);
    if (deep) return deep;
  }
  return void 0;
}
var IDENT_LEAF = /(^|_)(identifier|name|constant)$/;
function readName(node) {
  if (!node) return void 0;
  if (node.namedChildCount === 0) return IDENT_LEAF.test(node.type) ? node.text : void 0;
  const seg = node.childForFieldName("name") ?? node.childForFieldName("property") ?? node.childForFieldName("attribute") ?? node.childForFieldName("field");
  if (seg) return readName(seg);
  const last = node.namedChild(node.namedChildCount - 1);
  return last && last !== node ? readName(last) : void 0;
}
function collectCalls(root, spec) {
  if (!spec.calls) return [];
  const out2 = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (name2, node) => {
    if (!name2 || name2.length < 2 || !/^[A-Za-z_]\w*$/.test(name2)) return;
    const line = node.startPosition.row + 1;
    const key = `${name2} ${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    out2.push({ name: name2, line });
  };
  const visit = (node) => {
    const how = spec.calls[node.type];
    if (how === "function") {
      add(readName(node.childForFieldName("function") ?? node.childForFieldName("callee") ?? node.childForFieldName("method") ?? node.childForFieldName("name")), node);
    } else if (how === "member") {
      add(readName(node.childForFieldName("name")), node);
    } else if (how === "constructor") {
      let t = node.childForFieldName("constructor") ?? node.childForFieldName("type") ?? node.childForFieldName("name");
      for (let i2 = 0; !t && i2 < node.namedChildCount; i2++) {
        const c2 = node.namedChild(i2);
        if (IDENT_LEAF.test(c2.type)) t = c2;
      }
      add(readName(t), node);
    }
    for (let i2 = 0; i2 < node.namedChildCount; i2++) visit(node.namedChild(i2));
  };
  visit(root);
  out2.sort((a, b) => byStr(a.name, b.name) || a.line - b.line);
  return out2.slice(0, MAX_CALLS);
}
function collectImportedNames(root, spec) {
  if (!spec.imports?.import_statement) return [];
  const found = /* @__PURE__ */ new Set();
  const visit = (node) => {
    if (node.type === "import_statement") {
      for (let i2 = 0; i2 < node.namedChildCount; i2++) {
        const clause = node.namedChild(i2);
        if (clause.type !== "import_clause") continue;
        for (let j = 0; j < clause.namedChildCount; j++) {
          const named = clause.namedChild(j);
          if (named.type !== "named_imports") continue;
          for (let k = 0; k < named.namedChildCount; k++) {
            const specifier = named.namedChild(k);
            if (specifier.type !== "import_specifier") continue;
            const nm = specifier.childForFieldName("name") ?? specifier.namedChild(0);
            if (nm?.text) found.add(nm.text);
          }
        }
      }
    }
    for (let i2 = 0; i2 < node.namedChildCount; i2++) visit(node.namedChild(i2));
  };
  visit(root);
  return [...found].sort(byStr).slice(0, MAX_IMPORTED_NAMES);
}
function extractAst(rel, ext, content) {
  const key = grammarKeyForExt(ext);
  if (!key || !grammarReady(key)) return void 0;
  const spec = SPECS[key];
  if (!spec) return void 0;
  const parser2 = parserFor(key);
  if (!parser2) return void 0;
  let tree = null;
  try {
    tree = parser2.parse(content);
    if (!tree) return void 0;
    const symbols = [];
    const root = tree.rootNode;
    const exportedNames = /* @__PURE__ */ new Set();
    const walk2 = (node, parent, exported) => {
      const nowExported = exported || node.type === "export_statement";
      if (node.type === "export_statement") {
        for (let i2 = 0; i2 < node.namedChildCount; i2++) {
          const c2 = node.namedChild(i2);
          if (c2.type === "identifier") exportedNames.add(c2.text);
          else if (c2.type === "export_clause") {
            for (let j = 0; j < c2.namedChildCount; j++) {
              const spec2 = c2.namedChild(j);
              const nm = spec2.childForFieldName("name") ?? spec2.namedChild(0);
              if (nm?.text) exportedNames.add(nm.text);
            }
          }
        }
      }
      const kind = spec.defs[node.type];
      if (kind) {
        const name2 = nameOf(node);
        if (name2) {
          const line = firstLine(node);
          symbols.push({
            name: name2,
            kind,
            file: rel,
            line: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            ...parent ? { parent } : {},
            signature: line,
            exported: nowExported || spec.exported(line, name2),
            lang: spec.lang
          });
          for (let i2 = 0; i2 < node.namedChildCount; i2++) {
            walkBody(node.namedChild(i2), name2, nowExported);
          }
          return;
        }
      }
      if (spec.containers.has(node.type)) {
        for (let i2 = 0; i2 < node.namedChildCount; i2++) walk2(node.namedChild(i2), parent, nowExported);
      }
    };
    const walkBody = (node, parent, exported) => {
      if (spec.containers.has(node.type)) {
        for (let i2 = 0; i2 < node.namedChildCount; i2++) walk2(node.namedChild(i2), parent, exported);
      }
    };
    walk2(root, void 0, false);
    if (exportedNames.size) {
      for (const s of symbols) if (!s.exported && exportedNames.has(s.name)) s.exported = true;
    }
    const refs = collectImports(root, spec);
    const idents = collectRefIdents(root, new Set(symbols.map((s) => s.name)));
    const calls = collectCalls(root, spec);
    const importedNames = collectImportedNames(root, spec);
    let pkg;
    if (spec.lang === "java") {
      const p = findFirst(root, (n) => n.type === "package_declaration");
      if (p) pkg = p.text.replace(/^package\s+/, "").replace(/;.*$/, "").trim();
    }
    return { symbols, refs, pkg, idents, calls, importedNames };
  } catch {
    return void 0;
  } finally {
    tree?.delete();
  }
}

// src/extract/code.ts
var JS_TS = /* @__PURE__ */ new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
var PY = /* @__PURE__ */ new Set([".py", ".pyi"]);
var C_CPP = /* @__PURE__ */ new Set([".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hh"]);
var DIRECTIVE_RE = /^(eslint\b|eslint-|prettier\b|prettier-|tslint\b|jshint\b|jslint\b|globals?\b|istanbul\b|c8\s|v8\s|@ts-|ts-|@flow\b|@jsx\b|@jsxRuntime\b|@jest-environment\b|@vitest-environment\b|@license\b|@preserve\b|@copyright\b|copyright\b|spdx-|<reference\b|use strict|biome-|deno-lint|noqa\b|type:\s*ignore|pylint:|flake8:|mypy:|coding[:=])/i;
function isDirective(line) {
  return DIRECTIVE_RE.test(line.trim());
}
function topDocComment(content) {
  const lines = content.split(/\r?\n/);
  const collected = [];
  let inBlock = null;
  for (let i2 = 0; i2 < Math.min(lines.length, 40); i2++) {
    const raw = lines[i2];
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
    if (line === "" && collected.length === 0) continue;
    if (line.startsWith("#!")) continue;
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
    break;
  }
  const text = collected.filter((l) => l && !isDirective(l)).join(" ").replace(/\s+/g, " ").trim();
  if (text.length < 8) return void 0;
  const sentence = /^(.*?[.!?])(\s|$)/.exec(text);
  return (sentence ? sentence[1] : text).slice(0, 200);
}
var MAX_USE_EXPANSION = 16;
function expandUseGroups(path, out2 = []) {
  if (out2.length >= MAX_USE_EXPANSION) return out2;
  const brace = path.indexOf("{");
  if (brace === -1) {
    const cleaned = path.replace(/\s+as\s+\w+\s*$/, "").replace(/::\s*\*\s*$/, "").replace(/^::/, "").trim();
    if (cleaned) out2.push(cleaned);
    return out2;
  }
  const prefix = path.slice(0, brace);
  let depth = 0;
  let end = -1;
  for (let i2 = brace; i2 < path.length; i2++) {
    if (path[i2] === "{") depth++;
    else if (path[i2] === "}" && --depth === 0) {
      end = i2;
      break;
    }
  }
  if (end === -1) return out2;
  const parts2 = [];
  let cur = "";
  depth = 0;
  for (const ch of path.slice(brace + 1, end)) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (ch === "," && depth === 0) {
      parts2.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts2.push(cur);
  for (const part of parts2) {
    const t = part.trim();
    if (!t) continue;
    if (t === "self") expandUseGroups(prefix.replace(/::\s*$/, ""), out2);
    else expandUseGroups(prefix + t, out2);
  }
  return out2;
}
function extractImports(ext, content) {
  const specs = /* @__PURE__ */ new Set();
  const lines = content.split(/\r?\n/);
  if (JS_TS.has(ext)) {
    let m;
    const from = /(?:^|[^\w$.])(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g;
    while (m = from.exec(content)) specs.add(m[1]);
    const bare = /(?:^|[\n;])\s*import\s*['"]([^'"]+)['"]/g;
    while (m = bare.exec(content)) specs.add(m[1]);
    const req = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
    while (m = req.exec(content)) specs.add(m[1]);
    const dyn = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
    while (m = dyn.exec(content)) specs.add(m[1]);
  } else if (PY.has(ext)) {
    for (const line of lines) {
      const from = /^\s*from\s+(\.*[\w.]*)\s+import\b/.exec(line);
      if (from) {
        specs.add(from[1]);
        continue;
      }
      const imp = /^\s*import\s+(.+)$/.exec(line);
      if (imp) {
        for (const part of imp[1].split(",")) {
          const name2 = part.trim().split(/\s+as\s+/)[0].trim();
          if (name2 && /^[\w.]+$/.test(name2)) specs.add(name2);
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
        if (b) specs.add(b[1]);
        continue;
      }
      if (/^import\s*\($/.test(t)) {
        inBlock = true;
        continue;
      }
      const single = /^import\s+(?:[\w.]+\s+)?"([^"]+)"/.exec(t);
      if (single) specs.add(single[1]);
    }
  } else if (ext === ".rs") {
    let m;
    const modRe = /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)\s*;/gm;
    while (m = modRe.exec(content)) specs.add(`mod ${m[1]}`);
    const useRe = /^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+([^;]+);/gm;
    while (m = useRe.exec(content)) {
      for (const p of expandUseGroups(m[1].trim())) specs.add(p);
    }
  } else if (ext === ".java") {
    let m;
    const imp = /^\s*import\s+(?:static\s+)?([\w.]+(?:\.\*)?)\s*;/gm;
    while (m = imp.exec(content)) specs.add(m[1]);
  } else if (ext === ".rb" || ext === ".rake") {
    let m;
    const rel = /^\s*require_relative\s+['"]([^'"]+)['"]/gm;
    while (m = rel.exec(content)) specs.add(/^\.\.?\//.test(m[1]) ? m[1] : "./" + m[1]);
    const req = /^\s*require\s+['"]([^'"]+)['"]/gm;
    while (m = req.exec(content)) specs.add(m[1]);
  } else if (C_CPP.has(ext)) {
    let m;
    const inc = /^\s*#\s*include\s*"([^"]+)"/gm;
    while (m = inc.exec(content)) specs.add(m[1]);
  } else if (ext === ".php") {
    let m;
    const use = /^\s*use\s+(?:function\s+|const\s+)?\\?([A-Za-z_][\w\\]*)\s*(?:as\s+\w+)?\s*;/gm;
    while (m = use.exec(content)) specs.add(m[1]);
    const inc = /\b(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/g;
    while (m = inc.exec(content)) specs.add(/^\.\.?\//.test(m[1]) ? m[1] : "./" + m[1]);
  } else if (ext === ".cs") {
    let m;
    const using = /^\s*(?:global\s+)?using\s+(?:static\s+)?([A-Za-z_][\w.]*)\s*;/gm;
    while (m = using.exec(content)) specs.add(m[1]);
  }
  return [...specs].map((spec) => ({ kind: "import", spec }));
}
function extractReexports(rel, content) {
  if (!JS_TS.has(rel.slice(rel.lastIndexOf(".")))) return [];
  const lang = /\.(ts|tsx|mts|cts)$/.test(rel) ? "typescript" : "javascript";
  const out2 = [];
  const seen = /* @__PURE__ */ new Set();
  const lineAt = (idx) => content.slice(0, idx).split(/\r?\n/).length;
  const named = /export\s*\{([\s\S]*?)\}\s*(?:from\s*['"]([^'"]+)['"])?\s*;?/g;
  let m;
  while ((m = named.exec(content)) && out2.length < 60) {
    const from = m[2];
    for (const part of m[1].split(",")) {
      const p = part.trim().replace(/^type\s+/, "");
      const as = /^(\S+)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(p);
      const name2 = as ? as[2] : p;
      if (!/^[A-Za-z_$][\w$]*$/.test(name2) || name2 === "default" || seen.has(name2)) continue;
      seen.add(name2);
      out2.push({
        name: name2,
        kind: "reexport",
        file: rel,
        line: lineAt(m.index),
        signature: from ? `export { ${name2} } from "${from}"` : `export { ${name2} }`,
        exported: true,
        lang
      });
    }
  }
  const star = /export\s*\*\s*(?:as\s+([A-Za-z_$][\w$]*)\s+)?from\s*['"]([^'"]+)['"]/g;
  while ((m = star.exec(content)) && out2.length < 60) {
    const ns = m[1];
    const from = m[2];
    const key = "*" + (ns ?? from);
    if (seen.has(key)) continue;
    seen.add(key);
    out2.push({
      name: ns ?? `* (${from})`,
      kind: ns ? "reexport" : "reexport-all",
      file: rel,
      line: lineAt(m.index),
      signature: `export * ${ns ? `as ${ns} ` : ""}from "${from}"`,
      exported: true,
      lang
    });
  }
  return out2;
}
function extractCode(rel, ext, content) {
  const ast = extractAst(rel, ext, content);
  const symbols = (ast ? ast.symbols : extractSymbols(rel, ext, content)).slice(0, 400);
  const known = new Set(symbols.map((s) => s.name));
  const reexports = extractReexports(rel, content).filter((s) => !known.has(s.name));
  return {
    symbols: [...symbols, ...reexports],
    summary: topDocComment(content),
    refs: extractImports(ext, content),
    // pkg anchors namespace→source-root resolution: Java's `package`, C#'s
    // `namespace` (block or file-scoped). Both feed the same resolver pattern.
    pkg: ext === ".java" ? /^\s*package\s+([\w.]+)\s*;/m.exec(content)?.[1] : ext === ".cs" ? /^\s*(?:file-scoped\s+)?namespace\s+([\w.]+)/m.exec(content)?.[1] : void 0,
    idents: ast?.idents,
    calls: ast?.calls,
    importedNames: ast?.importedNames
  };
}

// src/scan.ts
function countLines(s) {
  if (!s) return 0;
  let n = 1;
  for (let i2 = 0; i2 < s.length; i2++) if (s.charCodeAt(i2) === 10) n++;
  return n;
}
function scanRepo(root, opts = {}) {
  const include = compileGlobs(opts.include);
  const exclude = compileGlobs(opts.exclude);
  const { files: walked, capped } = walk(root, { maxFileBytes: opts.maxBytes, maxFiles: opts.maxFiles });
  const outPrefix = opts.out ? opts.out.replace(/\/+$/, "") + "/" : null;
  const files = [];
  const languages = {};
  const docText = /* @__PURE__ */ new Map();
  const mtimes = /* @__PURE__ */ new Map();
  for (const f of walked) {
    if (outPrefix && (f.abs === opts.out || f.abs.startsWith(outPrefix))) continue;
    if (include && !include(f.rel)) continue;
    if (exclude && exclude(f.rel)) continue;
    const kind = classify(f.rel, f.ext);
    const lang = extToLang(f.ext);
    languages[lang] = (languages[lang] ?? 0) + 1;
    mtimes.set(f.rel, f.mtimeMs);
    const cached = opts.cache?.get(f.rel);
    if (kind !== "doc" && !opts.fullHash && cached && cached.size !== void 0 && cached.mtimeMs !== void 0 && cached.size === f.size && cached.mtimeMs === f.mtimeMs) {
      files.push(cached.record);
      continue;
    }
    const content = readText(f.abs);
    const hash = sha1(content);
    if (cached && cached.hash === hash) {
      files.push(cached.record);
      if (kind === "doc" && content) docText.set(f.rel, content);
      continue;
    }
    const record = {
      rel: f.rel,
      ext: f.ext,
      size: f.size,
      lines: countLines(content),
      hash,
      kind,
      lang,
      headings: [],
      symbols: [],
      refs: []
    };
    if (content) {
      if (kind === "doc" && MARKDOWN_EXT.has(f.ext)) {
        const md = extractMarkdown(content);
        record.title = md.title ?? basename(f.rel);
        record.summary = md.summary;
        record.headings = md.headings;
        record.refs = md.refs;
      } else if (kind === "doc") {
        record.title = basename(f.rel);
      } else if (kind === "code") {
        const code = extractCode(f.rel, f.ext, content);
        record.title = basename(f.rel);
        record.summary = code.summary;
        record.symbols = code.symbols;
        record.refs = code.refs;
        record.pkg = code.pkg;
        record.idents = code.idents;
        record.calls = code.calls;
        record.importedNames = code.importedNames;
      } else {
        record.title = basename(f.rel);
      }
    } else {
      record.title = basename(f.rel);
    }
    if (kind === "doc" && content) docText.set(f.rel, content);
    files.push(record);
  }
  files.sort(byKey((f) => f.rel));
  return { root, commit: headCommit(root), files, languages, docText, mtimes, capped };
}

// src/resolve.ts
import { posix } from "path";
import { join as join3 } from "path";
var ASSET_EXT = /* @__PURE__ */ new Set([
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".icns",
  ".pdf",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".webm",
  ".wav",
  ".flac",
  ".ogg",
  ".map"
]);
var JS_EXT_PROBES = ["", ".ts", ".tsx", ".d.ts", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
var JS_INDEX = ["index.ts", "index.tsx", "index.js", "index.jsx", "index.mjs", "index.cjs"];
var JS_TS2 = /* @__PURE__ */ new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
var PY2 = /* @__PURE__ */ new Set([".py", ".pyi"]);
var C_CPP2 = /* @__PURE__ */ new Set([".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hh"]);
var BUILD_DIRS = /* @__PURE__ */ new Set(["dist", "build", "lib", "out", "output", "esm", "cjs", "umd"]);
function distToSrcCandidates(target) {
  const segs = norm(target).split("/").filter((s) => s !== ".");
  const out2 = [];
  let i2 = 0;
  while (i2 < segs.length - 1 && BUILD_DIRS.has(segs[i2])) {
    i2++;
    const rest = segs.slice(i2).join("/");
    out2.push("src/" + rest, rest);
  }
  return out2;
}
function norm(p) {
  return posix.normalize(p).replace(/\/$/, "");
}
function firstThat(fileSet, candidates) {
  for (const c2 of candidates) {
    const n = norm(c2);
    if (fileSet.has(n)) return n;
  }
  return void 0;
}
function byLen(a, b) {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}
function tolerantJsonParse(text) {
  let stripped = "";
  let inStr = false;
  for (let i2 = 0; i2 < text.length; i2++) {
    const c2 = text[i2];
    if (inStr) {
      stripped += c2;
      if (c2 === "\\") stripped += text[++i2] ?? "";
      else if (c2 === '"') inStr = false;
      continue;
    }
    if (c2 === '"') {
      inStr = true;
      stripped += c2;
    } else if (c2 === "/" && text[i2 + 1] === "/") {
      while (i2 < text.length && text[i2] !== "\n") i2++;
      stripped += "\n";
    } else if (c2 === "/" && text[i2 + 1] === "*") {
      i2 += 2;
      while (i2 < text.length && !(text[i2] === "*" && text[i2 + 1] === "/")) i2++;
      i2++;
    } else {
      stripped += c2;
    }
  }
  let out2 = "";
  inStr = false;
  for (let i2 = 0; i2 < stripped.length; i2++) {
    const c2 = stripped[i2];
    if (inStr) {
      out2 += c2;
      if (c2 === "\\") out2 += stripped[++i2] ?? "";
      else if (c2 === '"') inStr = false;
      continue;
    }
    if (c2 === '"') {
      inStr = true;
      out2 += c2;
      continue;
    }
    if (c2 === ",") {
      let j = i2 + 1;
      while (j < stripped.length && (stripped[j] === " " || stripped[j] === "	" || stripped[j] === "\n" || stripped[j] === "\r")) j++;
      if (stripped[j] === "}" || stripped[j] === "]") continue;
    }
    out2 += c2;
  }
  try {
    return JSON.parse(out2);
  } catch {
    return void 0;
  }
}
function resolveExtends(fileSet, fromDir, ext) {
  if (!/^\.\.?\//.test(ext)) return void 0;
  const base = norm(posix.join(fromDir, ext));
  const cands = ext.endsWith(".json") ? [base] : [base + ".json", posix.join(base, "tsconfig.json")];
  for (const c2 of cands) if (fileSet.has(c2)) return c2;
  return void 0;
}
function readTsConfig(root, fileSet, rel, warnings, seen) {
  if (seen.has(rel)) return void 0;
  seen.add(rel);
  const cfg = tolerantJsonParse(readText(join3(root, rel)));
  if (cfg === void 0) {
    warnings.push(`unparseable ${rel} \u2014 its path aliases were ignored`);
    return void 0;
  }
  const dir = rel.includes("/") ? posix.dirname(rel) : "";
  const eff = { baseUrlDir: "", pathsDir: "" };
  const exts = cfg.extends === void 0 ? [] : Array.isArray(cfg.extends) ? cfg.extends : [cfg.extends];
  for (const ext of exts) {
    if (typeof ext !== "string") continue;
    const baseRel = resolveExtends(fileSet, dir, ext);
    if (!baseRel) {
      if (/^\.\.?\//.test(ext)) warnings.push(`${rel} extends "${ext}" which is missing \u2014 its path aliases were ignored`);
      continue;
    }
    const inherited = readTsConfig(root, fileSet, baseRel, warnings, seen);
    if (inherited?.baseUrl !== void 0) {
      eff.baseUrl = inherited.baseUrl;
      eff.baseUrlDir = inherited.baseUrlDir;
    }
    if (inherited?.paths) {
      eff.paths = inherited.paths;
      eff.pathsDir = inherited.pathsDir;
    }
  }
  const co = cfg.compilerOptions;
  if (co?.baseUrl !== void 0) {
    eff.baseUrl = co.baseUrl;
    eff.baseUrlDir = dir;
  }
  if (co?.paths) {
    eff.paths = co.paths;
    eff.pathsDir = dir;
  }
  return eff;
}
var CONDITION_PRIORITY = ["source", "ts", "import", "module", "require", "node", "default"];
var MAX_EXPORT_TARGETS = 8;
function conditionRank(key) {
  const i2 = CONDITION_PRIORITY.indexOf(key);
  if (i2 !== -1) return i2;
  return key === "types" ? CONDITION_PRIORITY.length + 1 : CONDITION_PRIORITY.length;
}
function flattenExportTargets(value, out2) {
  if (out2.length >= MAX_EXPORT_TARGETS) return;
  if (typeof value === "string") {
    if (!out2.includes(value)) out2.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) flattenExportTargets(v, out2);
  } else if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort((a, b) => conditionRank(a) - conditionRank(b) || (a < b ? -1 : a > b ? 1 : 0));
    for (const k of keys) flattenExportTargets(value[k], out2);
  }
}
function parseExportEntries(exportsField) {
  if (exportsField === void 0 || exportsField === null) return [];
  const entries = [];
  const push = (key, value) => {
    const targets = [];
    flattenExportTargets(value, targets);
    if (targets.length) entries.push({ key, star: key.includes("*"), targets });
  };
  if (typeof exportsField === "string" || Array.isArray(exportsField)) {
    push(".", exportsField);
  } else if (typeof exportsField === "object") {
    const keys = Object.keys(exportsField);
    if (keys.every((k) => k === "." || k.startsWith("./"))) {
      for (const k of keys) push(k, exportsField[k]);
    } else {
      push(".", exportsField);
    }
  }
  entries.sort((a, b) => Number(a.star) - Number(b.star) || b.key.length - a.key.length || (a.key < b.key ? -1 : 1));
  return entries;
}
function parseGoReplaces(text, modDir) {
  const out2 = [];
  const addLine = (line) => {
    const m = /^\s*([^\s=]+)(?:\s+v\S+)?\s*=>\s*(\S+)(?:\s+v\S+)?\s*$/.exec(line);
    if (!m) return;
    const target = m[2];
    if (!/^\.\.?\//.test(target)) return;
    const toDir = norm(posix.join(modDir, target));
    if (toDir.startsWith("..")) return;
    out2.push({ from: m[1], toDir });
  };
  for (const m of text.matchAll(/^[ \t]*replace[ \t]+([^(\r\n][^\r\n]*)$/gm)) addLine(m[1]);
  for (const b of text.matchAll(/^[ \t]*replace[ \t]*\(([\s\S]*?)\)/gm)) {
    for (const line of b[1].split(/\r?\n/)) addLine(line);
  }
  return out2;
}
function buildResolveContext(scan2) {
  const fileSet = new Set(scan2.files.map((f) => f.rel));
  const filesByDir = /* @__PURE__ */ new Map();
  const dirSet = /* @__PURE__ */ new Set();
  for (const f of scan2.files) {
    const dir = f.rel.includes("/") ? posix.dirname(f.rel) : "";
    let list = filesByDir.get(dir);
    if (!list) filesByDir.set(dir, list = []);
    list.push(f.rel);
    let d = dir;
    while (d) {
      if (dirSet.has(d)) break;
      dirSet.add(d);
      d = d.includes("/") ? posix.dirname(d) : "";
    }
  }
  const warnings = [];
  const tsConfigs = [];
  for (const rel of fileSet) {
    const base = rel.slice(rel.lastIndexOf("/") + 1);
    const isRootBase = rel === "tsconfig.base.json";
    if (base !== "tsconfig.json" && base !== "jsconfig.json" && !isRootBase) continue;
    const dir = rel.includes("/") ? posix.dirname(rel) : "";
    const eff = readTsConfig(scan2.root, fileSet, rel, warnings, /* @__PURE__ */ new Set());
    if (!eff?.paths) continue;
    const tsPaths = [];
    for (const [alias, targets] of Object.entries(eff.paths)) {
      if (!Array.isArray(targets)) continue;
      const star = alias.endsWith("*");
      tsPaths.push({ prefix: star ? alias.slice(0, -1) : alias, star, targets });
    }
    if (!tsPaths.length) continue;
    const baseUrl = eff.baseUrl !== void 0 ? norm(posix.join(eff.baseUrlDir, eff.baseUrl)).replace(/^\.$/, "") : eff.pathsDir;
    tsConfigs.push({ dir, baseUrl, paths: tsPaths });
  }
  tsConfigs.sort((a, b) => b.dir.length - a.dir.length);
  const goModules = [];
  for (const rel of fileSet) {
    if (rel !== "go.mod" && !rel.endsWith("/go.mod")) continue;
    const text = readText(join3(scan2.root, rel));
    const m = /^\s*module\s+(\S+)/m.exec(text);
    if (!m) continue;
    const dir = rel.includes("/") ? posix.dirname(rel) : "";
    goModules.push({ module: m[1], dir, replaces: parseGoReplaces(text, dir) });
  }
  goModules.sort((a, b) => b.dir.length - a.dir.length || (a.dir < b.dir ? -1 : 1));
  const rustCrates = [];
  for (const rel of fileSet) {
    if (rel !== "Cargo.toml" && !rel.endsWith("/Cargo.toml")) continue;
    const text = readText(join3(scan2.root, rel));
    const m = /\[package\][^[]*?^\s*name\s*=\s*"([^"]+)"/ms.exec(text);
    if (!m) continue;
    const dir = rel.includes("/") ? posix.dirname(rel) : "";
    const srcDir = norm(posix.join(dir, "src")).replace(/^\.$/, "");
    const rootFile = firstThat(fileSet, [posix.join(srcDir, "lib.rs"), posix.join(srcDir, "main.rs")]);
    rustCrates.push({ name: m[1].replace(/-/g, "_"), dir, srcDir, rootFile });
  }
  rustCrates.sort((a, b) => b.dir.length - a.dir.length || (a.dir < b.dir ? -1 : 1));
  const javaRoots = /* @__PURE__ */ new Set();
  for (const f of scan2.files) {
    if (f.ext !== ".java" || !f.pkg) continue;
    const dir = f.rel.includes("/") ? posix.dirname(f.rel) : "";
    const pkgPath = f.pkg.replace(/\./g, "/");
    if (dir === pkgPath) javaRoots.add("");
    else if (dir.endsWith("/" + pkgPath)) javaRoots.add(dir.slice(0, -pkgPath.length - 1));
  }
  const pyRoots = /* @__PURE__ */ new Set([""]);
  for (const rel of fileSet) {
    const base = rel.split("/").pop();
    if (base === "__init__.py" || base === "pyproject.toml" || base === "setup.py") {
      pyRoots.add(rel.includes("/") ? posix.dirname(rel) : "");
    }
  }
  const workspacePackages = [];
  for (const rel of fileSet) {
    if (rel !== "package.json" && !rel.endsWith("/package.json")) continue;
    const pkg = tolerantJsonParse(readText(join3(scan2.root, rel)));
    if (pkg === void 0) {
      warnings.push(`unparseable ${rel} \u2014 skipped for workspace resolution`);
      continue;
    }
    if (typeof pkg.name !== "string") continue;
    const mainCandidates = [pkg.source, pkg.main, pkg.module, pkg.types].filter(
      (v) => typeof v === "string"
    );
    workspacePackages.push({
      name: pkg.name,
      dir: rel.includes("/") ? posix.dirname(rel) : "",
      exportEntries: parseExportEntries(pkg.exports),
      mainCandidates
    });
  }
  workspacePackages.sort((a, b) => b.name.length - a.name.length);
  const cIncludeRoots = /* @__PURE__ */ new Set([""]);
  for (const d of dirSet) {
    const base = d.slice(d.lastIndexOf("/") + 1);
    if (base === "include" || base === "inc" || base === "src") cIncludeRoots.add(d);
  }
  const rubyLibRoots = /* @__PURE__ */ new Set([""]);
  for (const d of dirSet) if (d.slice(d.lastIndexOf("/") + 1) === "lib") rubyLibRoots.add(d);
  const phpPsr4 = [];
  for (const rel of fileSet) {
    if (rel !== "composer.json" && !rel.endsWith("/composer.json")) continue;
    const composer = tolerantJsonParse(readText(join3(scan2.root, rel)));
    if (!composer) {
      warnings.push(`unparseable ${rel} \u2014 skipped for PHP PSR-4 resolution`);
      continue;
    }
    const baseDir = rel.includes("/") ? posix.dirname(rel) : "";
    for (const block of [composer.autoload?.["psr-4"], composer["autoload-dev"]?.["psr-4"]]) {
      if (!block) continue;
      for (const [prefix, dirs] of Object.entries(block)) {
        for (const d of Array.isArray(dirs) ? dirs : [dirs]) {
          if (typeof d !== "string") continue;
          phpPsr4.push({ prefix: prefix.replace(/\\+$/, ""), dir: norm(posix.join(baseDir, d)).replace(/^\.$/, "") });
        }
      }
    }
  }
  phpPsr4.sort((a, b) => b.prefix.length - a.prefix.length);
  const csharpNamespaces = /* @__PURE__ */ new Map();
  for (const f of scan2.files) {
    if (f.ext !== ".cs" || !f.pkg) continue;
    let arr = csharpNamespaces.get(f.pkg);
    if (!arr) csharpNamespaces.set(f.pkg, arr = []);
    arr.push(f.rel);
  }
  for (const arr of csharpNamespaces.values()) arr.sort(byStr);
  return {
    fileSet,
    dirSet,
    filesByDir,
    tsConfigs,
    goModules,
    rustCrates,
    javaRoots: [...javaRoots].sort(byLen),
    pyRoots: [...pyRoots],
    workspacePackages,
    cIncludeRoots: [...cIncludeRoots].sort(byLen),
    rubyLibRoots: [...rubyLibRoots].sort(byLen),
    phpPsr4,
    csharpNamespaces,
    warnings
  };
}
function firstExisting(ctx, candidates) {
  for (const c2 of candidates) {
    const n = norm(c2);
    if (n && !n.startsWith("..") && ctx.fileSet.has(n)) return n;
  }
  return void 0;
}
function resolveDocLink(fromRel, spec, ctx) {
  let target = spec.split("#")[0].split("?")[0];
  if (!target) return { kind: "external" };
  if (target.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(target)) return { kind: "external" };
  const base = fromRel.includes("/") ? posix.dirname(fromRel) : "";
  const p = norm(posix.join(base, target));
  if (p.startsWith("..")) return { kind: "dangling", reason: "escapes-repo-root" };
  const hit = firstExisting(ctx, [
    p,
    p + ".md",
    p + ".mdx",
    posix.join(p, "README.md"),
    posix.join(p, "readme.md"),
    posix.join(p, "index.md"),
    posix.join(p, "index.mdx")
  ]);
  if (hit) return { kind: "resolved", target: hit };
  if (ctx.dirSet.has(p)) return { kind: "external" };
  return { kind: "dangling", reason: "missing-target" };
}
function resolveJs(fromRel, spec, ctx) {
  const probe = (p) => firstExisting(ctx, [...JS_EXT_PROBES.map((e) => p + e), ...JS_INDEX.map((i2) => posix.join(p, i2))]);
  const tryResolve = (p) => {
    const hit = probe(p);
    if (hit) return hit;
    const noJs = p.replace(/\.(js|jsx|mjs|cjs)$/, "");
    return noJs !== p ? probe(noJs) : void 0;
  };
  if (spec.startsWith(".")) {
    const base = fromRel.includes("/") ? posix.dirname(fromRel) : "";
    const p = norm(posix.join(base, spec));
    if (p.startsWith("..")) return { kind: "dangling", reason: "escapes-repo-root" };
    const hit = tryResolve(p);
    return hit ? { kind: "resolved", target: hit } : { kind: "dangling", reason: "missing-module" };
  }
  let aliasFallback;
  for (const cfg of ctx.tsConfigs) {
    if (cfg.dir && fromRel !== cfg.dir && !fromRel.startsWith(cfg.dir + "/")) continue;
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
      aliasFallback = targetTreeExists ? { kind: "dangling", reason: "alias-unresolved" } : { kind: "external" };
      break;
    }
    if (matched) break;
  }
  for (const pkg of ctx.workspacePackages) {
    if (spec !== pkg.name && !spec.startsWith(pkg.name + "/")) continue;
    const sub = spec.slice(pkg.name.length).replace(/^\//, "");
    const probeEntry = (entry) => {
      for (const cand of [entry, ...distToSrcCandidates(entry)]) {
        const hit = tryResolve(norm(posix.join(pkg.dir, cand)));
        if (hit) return hit;
      }
      return void 0;
    };
    const subKey = sub ? "./" + sub : ".";
    for (const entry of pkg.exportEntries) {
      let fill;
      if (entry.star) {
        const starAt = entry.key.indexOf("*");
        const pre = entry.key.slice(0, starAt);
        const post = entry.key.slice(starAt + 1);
        if (!subKey.startsWith(pre) || !subKey.endsWith(post) || subKey.length < pre.length + post.length) continue;
        fill = subKey.slice(pre.length, subKey.length - post.length);
      } else if (entry.key !== subKey) continue;
      for (const t of entry.targets) {
        const hit = probeEntry(fill === void 0 ? t : t.replace(/\*/g, fill));
        if (hit) return { kind: "resolved", target: hit };
      }
      break;
    }
    if (!sub) {
      for (const m of pkg.mainCandidates) {
        const hit = probeEntry(m);
        if (hit) return { kind: "resolved", target: hit };
      }
    }
    const bases = sub ? [posix.join(pkg.dir, "src", sub), posix.join(pkg.dir, sub)] : [posix.join(pkg.dir, "src", "index"), posix.join(pkg.dir, "index"), posix.join(pkg.dir, "src")];
    for (const b of bases) {
      const hit = tryResolve(norm(b));
      if (hit) return { kind: "resolved", target: hit };
    }
    return { kind: "external" };
  }
  return aliasFallback ?? { kind: "external" };
}
function resolvePython(fromRel, spec, ctx) {
  const probeModule = (dir, dotted) => {
    const sub = dotted ? dotted.replace(/\./g, "/") : "";
    const base = norm(posix.join(dir, sub));
    return firstExisting(ctx, [base + ".py", base + ".pyi", posix.join(base, "__init__.py")]);
  };
  if (spec.startsWith(".")) {
    const dots = /^\.+/.exec(spec)[0].length;
    const rest = spec.slice(dots);
    const base = fromRel.includes("/") ? posix.dirname(fromRel) : "";
    let dir = base;
    for (let i2 = 1; i2 < dots; i2++) dir = dir.includes("/") ? posix.dirname(dir) : "";
    const hit = rest ? probeModule(dir, rest) : firstExisting(ctx, [posix.join(norm(dir), "__init__.py")]);
    return hit ? { kind: "resolved", target: hit } : { kind: "dangling", reason: "missing-module" };
  }
  for (const root of ctx.pyRoots) {
    const hit = probeModule(root, spec);
    if (hit) return { kind: "resolved", target: hit };
  }
  return { kind: "external" };
}
function resolveGo(fromRel, spec, ctx) {
  if (!ctx.goModules.length) return { kind: "external" };
  const probePkg = (dir) => {
    const d = norm(dir).replace(/^\.$/, "");
    const inDir = (ctx.filesByDir.get(d) ?? []).filter((f) => f.endsWith(".go")).sort();
    return inDir.length ? { kind: "resolved", target: inDir[0] } : { kind: "dangling", reason: "missing-package" };
  };
  const home = ctx.goModules.find((g) => !g.dir || fromRel === g.dir || fromRel.startsWith(g.dir + "/"));
  if (home) {
    for (const r of home.replaces) {
      if (spec !== r.from && !spec.startsWith(r.from + "/")) continue;
      const sub = spec.slice(r.from.length).replace(/^\//, "");
      return probePkg(posix.join(r.toDir, sub));
    }
  }
  const ordered = home ? [home, ...ctx.goModules.filter((g) => g !== home)] : ctx.goModules;
  for (const g of ordered) {
    if (spec !== g.module && !spec.startsWith(g.module + "/")) continue;
    const sub = spec.slice(g.module.length).replace(/^\//, "");
    return probePkg(posix.join(g.dir, sub));
  }
  return { kind: "external" };
}
function resolveRust(fromRel, spec, ctx) {
  if (!ctx.rustCrates.length) return { kind: "external" };
  const probeMod = (dir, name2) => firstExisting(ctx, [posix.join(dir, name2 + ".rs"), posix.join(dir, name2, "mod.rs")]);
  const walkPath = (baseDir2, segs2) => {
    for (let n = segs2.length; n >= 1; n--) {
      const dir = norm(posix.join(baseDir2, ...segs2.slice(0, n - 1)));
      const hit2 = probeMod(dir, segs2[n - 1]);
      if (hit2) return hit2;
    }
    return void 0;
  };
  const fromDir = fromRel.includes("/") ? posix.dirname(fromRel) : "";
  const stem2 = fromRel.slice(fromRel.lastIndexOf("/") + 1).replace(/\.rs$/, "");
  const isRootish = stem2 === "mod" || stem2 === "lib" || stem2 === "main";
  const childDir = isRootish ? fromDir : posix.join(fromDir, stem2);
  if (spec.startsWith("mod ")) {
    const name2 = spec.slice(4);
    const hit2 = probeMod(childDir, name2) ?? (isRootish ? void 0 : probeMod(fromDir, name2));
    return hit2 ? { kind: "resolved", target: hit2 } : { kind: "dangling", reason: "missing-module" };
  }
  const segs = spec.split("::").map((s) => s.trim()).filter(Boolean);
  if (!segs.length) return { kind: "external" };
  const head = segs[0];
  const home = ctx.rustCrates.find((c2) => !c2.dir || fromRel === c2.dir || fromRel.startsWith(c2.dir + "/"));
  let baseDir;
  let rest = [];
  if (head === "crate" && home) {
    baseDir = home.srcDir;
    rest = segs.slice(1);
  } else if (head === "self") {
    baseDir = childDir;
    rest = segs.slice(1);
  } else if (head === "super") {
    let dir = isRootish ? fromDir.includes("/") ? posix.dirname(fromDir) : "" : fromDir;
    let i2 = 1;
    while (i2 < segs.length && segs[i2] === "super") {
      dir = dir.includes("/") ? posix.dirname(dir) : "";
      i2++;
    }
    baseDir = dir;
    rest = segs.slice(i2);
  } else {
    const target = ctx.rustCrates.find((c2) => c2.name === head);
    if (target) {
      const walked = walkPath(target.srcDir, segs.slice(1));
      if (walked) return { kind: "resolved", target: walked };
      if (target.rootFile) return { kind: "resolved", target: target.rootFile };
    }
    return { kind: "external" };
  }
  if (!rest.length) return { kind: "external" };
  const hit = walkPath(baseDir, rest);
  if (hit) return { kind: "resolved", target: hit };
  if (home && baseDir === home.srcDir && home.rootFile) return { kind: "resolved", target: home.rootFile };
  const ownerDir = baseDir.includes("/") ? posix.dirname(baseDir) : "";
  const ownerName = baseDir.slice(baseDir.lastIndexOf("/") + 1);
  const owner = ownerName ? probeMod(ownerDir, ownerName) : void 0;
  if (owner && owner !== fromRel) return { kind: "resolved", target: owner };
  return { kind: "external" };
}
function resolveJava(spec, ctx) {
  if (!ctx.javaRoots.length) return { kind: "external" };
  const probe = (pkgPath) => {
    for (const root of ctx.javaRoots) {
      const p = norm(posix.join(root, pkgPath));
      if (p.endsWith("/*") || p === "*") {
        const dir = p === "*" ? "" : p.slice(0, -2);
        const inDir = (ctx.filesByDir.get(dir) ?? []).filter((f) => f.endsWith(".java")).sort();
        if (inDir.length) return inDir[0];
        continue;
      }
      if (ctx.fileSet.has(p + ".java")) return p + ".java";
    }
    return void 0;
  };
  const path = spec.replace(/\./g, "/");
  let hit = probe(path);
  if (!hit && !spec.endsWith(".*")) {
    const segs = path.split("/");
    for (let n = segs.length - 1; n >= 2 && !hit; n--) {
      hit = probe(segs.slice(0, n).join("/"));
    }
  }
  return hit ? { kind: "resolved", target: hit } : { kind: "external" };
}
function resolveC(fromRel, spec, ctx) {
  const fromDir = fromRel.includes("/") ? posix.dirname(fromRel) : "";
  const hit = firstExisting(ctx, [posix.join(fromDir, spec), ...ctx.cIncludeRoots.map((r) => posix.join(r, spec))]);
  return hit ? { kind: "resolved", target: hit } : { kind: "dangling", reason: "missing-include" };
}
function resolveRuby(fromRel, spec, ctx) {
  if (spec.startsWith(".")) {
    const fromDir = fromRel.includes("/") ? posix.dirname(fromRel) : "";
    const base = norm(posix.join(fromDir, spec));
    const hit = firstExisting(ctx, [base + ".rb", posix.join(base, "index.rb")]);
    return hit ? { kind: "resolved", target: hit } : { kind: "dangling", reason: "missing-module" };
  }
  for (const root of ctx.rubyLibRoots) {
    const hit = firstExisting(ctx, [posix.join(root, spec + ".rb")]);
    if (hit) return { kind: "resolved", target: hit };
  }
  return { kind: "external" };
}
function resolvePhp(fromRel, spec, ctx) {
  if (spec.startsWith(".")) {
    const fromDir = fromRel.includes("/") ? posix.dirname(fromRel) : "";
    const base = norm(posix.join(fromDir, spec));
    const hit = firstExisting(ctx, [base, base + ".php"]);
    return hit ? { kind: "resolved", target: hit } : { kind: "dangling", reason: "missing-module" };
  }
  const ns = spec.replace(/^\\+/, "");
  for (const { prefix, dir } of ctx.phpPsr4) {
    if (prefix && ns !== prefix && !ns.startsWith(prefix + "\\")) continue;
    const rest = prefix ? ns.slice(prefix.length).replace(/^\\+/, "") : ns;
    const hit = firstExisting(ctx, [posix.join(dir, rest.replace(/\\/g, "/")) + ".php"]);
    if (hit) return { kind: "resolved", target: hit };
  }
  return { kind: "external" };
}
function resolveCsharp(spec, ctx) {
  const exact = ctx.csharpNamespaces.get(spec);
  if (exact?.length) return { kind: "resolved", target: exact[0] };
  let best;
  for (const [ns, files] of ctx.csharpNamespaces) {
    if (ns === spec || ns.startsWith(spec + ".")) {
      const f = files[0];
      if (best === void 0 || byStr(f, best) < 0) best = f;
    }
  }
  return best ? { kind: "resolved", target: best } : { kind: "external" };
}
function resolveImport(fromRel, ext, spec, ctx) {
  const dot = spec.lastIndexOf(".");
  if (dot !== -1 && ASSET_EXT.has(spec.slice(dot).toLowerCase().replace(/[?#].*$/, ""))) {
    return { kind: "external" };
  }
  if (JS_TS2.has(ext)) return resolveJs(fromRel, spec, ctx);
  if (PY2.has(ext)) return resolvePython(fromRel, spec, ctx);
  if (ext === ".go") return resolveGo(fromRel, spec, ctx);
  if (ext === ".rs") return resolveRust(fromRel, spec, ctx);
  if (ext === ".java") return resolveJava(spec, ctx);
  if (C_CPP2.has(ext)) return resolveC(fromRel, spec, ctx);
  if (ext === ".rb" || ext === ".rake") return resolveRuby(fromRel, spec, ctx);
  if (ext === ".php") return resolvePhp(fromRel, spec, ctx);
  if (ext === ".cs") return resolveCsharp(spec, ctx);
  return { kind: "external" };
}

// src/modules.ts
import { posix as posix2 } from "path";
var ROOT_PATH = "(root)";
var TIER0 = /(^|\/)(types?|util|utils|lib|libs|common|core|config|configs|constants|shared|helpers|internal)$/i;
var TIER2_ANY = /(^|\/)(tests?|__tests?__|__mocks?__|__snapshots?__|spec|specs|e2e|examples?|example|benchmark|benchmarks|fixtures?|docs?|documentation|\.github)(\/|$)/i;
var TIER2_LEAF = /(^|\/)(scripts?|bin|\.storybook)$/i;
var TEST_FILE = /\.(test|spec|e2e|stories|story)\.[cm]?[jt]sx?$/i;
function isTestFile(rel) {
  return TEST_FILE.test(rel.split("/").pop());
}
function dirOf(rel) {
  return rel.includes("/") ? posix2.dirname(rel) : ROOT_PATH;
}
function tierForPath(path) {
  if (path === ROOT_PATH) return 0;
  if (TIER2_ANY.test(path) || TIER2_LEAF.test(path)) return 2;
  if (TIER0.test(path)) return 0;
  return null;
}
function tierOf(path, members) {
  const byPath = tierForPath(path);
  if (byPath !== null) return byPath;
  if (members.every((m) => m.kind === "doc" || m.kind === "config" || isTestFile(m.rel))) return 2;
  return 1;
}
function summaryOf(path, members) {
  const readme = members.find((m) => /^(readme|index)\.(md|mdx)$/i.test(m.rel.split("/").pop()));
  if (readme?.summary) return readme.summary;
  if (readme?.title) return readme.title;
  const withSummary = members.filter((m) => m.summary).sort((a, b) => (b.summary?.length ?? 0) - (a.summary?.length ?? 0));
  if (withSummary[0]?.summary) return withSummary[0].summary;
  const langs = [...new Set(members.map((m) => m.lang))].filter((l) => l !== "other");
  const where = path === ROOT_PATH ? "the repository root" : `\`${path}/\``;
  return `${members.length} file(s) in ${where}${langs.length ? ` (${langs.slice(0, 3).join(", ")})` : ""}.`;
}
function buildModules(scan2) {
  const byDir = /* @__PURE__ */ new Map();
  for (const f of scan2.files) {
    const dir = dirOf(f.rel);
    let list = byDir.get(dir);
    if (!list) byDir.set(dir, list = []);
    list.push(f);
  }
  const dirs = [...byDir.keys()].sort(byStr);
  const baseOf = /* @__PURE__ */ new Map();
  const baseCount = /* @__PURE__ */ new Map();
  for (const dir of dirs) {
    const b = dir === ROOT_PATH ? "root" : slugify(dir);
    baseOf.set(dir, b);
    baseCount.set(b, (baseCount.get(b) ?? 0) + 1);
  }
  const slugForDir = (dir) => {
    const b = baseOf.get(dir);
    return b && baseCount.get(b) === 1 ? b : `${b || "module"}-${sha1(dir).slice(0, 8)}`;
  };
  const modules = [];
  const moduleOf = /* @__PURE__ */ new Map();
  for (const dir of dirs) {
    const members = byDir.get(dir).slice().sort((a, b) => byStr(a.rel, b.rel));
    const slug = slugForDir(dir);
    const info2 = {
      slug,
      path: dir,
      title: dir,
      tier: tierOf(dir, members),
      members: members.map((m) => m.rel),
      summary: summaryOf(dir, members)
    };
    modules.push(info2);
    for (const m of members) moduleOf.set(m.rel, slug);
  }
  modules.sort((a, b) => byStr(a.slug, b.slug));
  return { modules, moduleOf };
}

// src/graph.ts
import { join as join4 } from "path";

// src/calls.ts
var REFERENCE_KINDS = /* @__PURE__ */ new Set(["reexport", "reexport-all", "default"]);
function familyOf(lang) {
  return lang === "typescript" || lang === "javascript" ? "js" : lang;
}
function sharedSegments(a, b) {
  const as = a.split("/");
  const bs = b.split("/");
  let n = 0;
  while (n < as.length && n < bs.length && as[n] === bs[n]) n++;
  return n;
}
function pick(callerRel, cands) {
  if (cands.length === 1) return cands[0];
  if (cands.length === 0) return void 0;
  let best;
  let bestScore = -1;
  let tied = false;
  for (const c2 of cands) {
    const s = sharedSegments(callerRel, c2.file);
    if (s > bestScore) {
      bestScore = s;
      best = c2;
      tied = false;
    } else if (s === bestScore) {
      tied = true;
    }
  }
  return tied ? void 0 : best;
}
function resolveCallEdges(scan2, importPairs) {
  const defs = /* @__PURE__ */ new Map();
  const seen = /* @__PURE__ */ new Set();
  for (const f of scan2.files) {
    for (const s of f.symbols) {
      if (!s.exported || REFERENCE_KINDS.has(s.kind)) continue;
      const dedup = `${s.name} ${s.file}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      let arr = defs.get(s.name);
      if (!arr) defs.set(s.name, arr = []);
      arr.push({ file: s.file, lang: s.lang });
    }
  }
  const agg = /* @__PURE__ */ new Map();
  for (const f of scan2.files) {
    if (!f.calls?.length) continue;
    const family = familyOf(f.lang);
    const ownNames = new Set(f.symbols.map((s) => s.name));
    const counts = /* @__PURE__ */ new Map();
    for (const c2 of f.calls) counts.set(c2.name, (counts.get(c2.name) ?? 0) + 1);
    for (const [name2, count] of counts) {
      if (ownNames.has(name2)) continue;
      const cands = (defs.get(name2) ?? []).filter((d) => familyOf(d.lang) === family && d.file !== f.rel);
      if (!cands.length) continue;
      const imported = cands.filter((d) => importPairs.has(`${f.rel}|${d.file}`));
      let chosen;
      let confidence;
      if (family === "js") {
        if (!imported.length) continue;
        chosen = pick(f.rel, imported);
        confidence = "extracted";
      } else if (imported.length) {
        chosen = pick(f.rel, imported);
        confidence = "extracted";
      } else {
        chosen = pick(f.rel, cands);
        confidence = "inferred";
      }
      if (!chosen) continue;
      const key = `${f.rel}|${chosen.file}`;
      const prev = agg.get(key);
      if (prev) {
        prev.weight += count;
        if (confidence === "extracted") prev.confidence = "extracted";
      } else {
        agg.set(key, { from: f.rel, to: chosen.file, weight: count, confidence });
      }
    }
  }
  return [...agg.values()].map((e) => ({ from: e.from, to: e.to, kind: "call", weight: Math.min(e.weight, 5), confidence: e.confidence })).sort((a, b) => byStr(a.from, b.from) || byStr(a.to, b.to));
}

// src/graph.ts
function isDistinctive(name2) {
  if (name2.length < 5) return false;
  const internalUpper = /[a-z][A-Z]/.test(name2) || /[A-Z]{2}/.test(name2);
  return internalUpper || name2.includes("_") || /\d/.test(name2);
}
var REFERENCE_KINDS2 = /* @__PURE__ */ new Set(["reexport", "reexport-all", "default"]);
function uniqueSymbolDefs(scan2) {
  const byName = /* @__PURE__ */ new Map();
  for (const f of scan2.files) {
    for (const s of f.symbols) {
      if (!s.exported || REFERENCE_KINDS2.has(s.kind) || !isDistinctive(s.name)) continue;
      let set = byName.get(s.name);
      if (!set) byName.set(s.name, set = /* @__PURE__ */ new Set());
      set.add(f.rel);
    }
  }
  const unique = /* @__PURE__ */ new Map();
  for (const [name2, files] of byName) if (files.size === 1) unique.set(name2, [...files][0]);
  return unique;
}
var keyOf = (from, to, kind) => `${from}\0${to}\0${kind}`;
function collect(edges, e) {
  const k = keyOf(e.from, e.to, e.kind);
  const prev = edges.get(k);
  if (prev) {
    prev.weight += e.weight;
    return;
  }
  edges.set(k, { ...e });
}
function buildGraph(scan2, ctx, modules, moduleOf) {
  const fileEdgeMap = /* @__PURE__ */ new Map();
  const importPairs = /* @__PURE__ */ new Set();
  for (const f of scan2.files) {
    for (const ref of f.refs) {
      if (ref.kind === "doc-link") {
        const r = resolveDocLink(f.rel, ref.spec, ctx);
        if (r.kind === "external") continue;
        if (r.kind === "dangling") {
          collect(fileEdgeMap, { from: f.rel, to: ref.spec, kind: "doc-link", weight: 1, dangling: true, reason: r.reason });
        } else if (r.target !== f.rel) {
          collect(fileEdgeMap, { from: f.rel, to: r.target, kind: "doc-link", weight: 1 });
        }
      } else {
        const r = resolveImport(f.rel, f.ext, ref.spec, ctx);
        if (r.kind === "external") continue;
        if (r.kind === "dangling") {
          collect(fileEdgeMap, { from: f.rel, to: ref.spec, kind: "import", weight: 1, dangling: true, reason: r.reason });
        } else if (r.target !== f.rel) {
          collect(fileEdgeMap, { from: f.rel, to: r.target, kind: "import", weight: 1 });
          importPairs.add(`${f.rel}|${r.target}`);
        }
      }
    }
  }
  const callPairs = /* @__PURE__ */ new Set();
  for (const e of resolveCallEdges(scan2, importPairs)) {
    collect(fileEdgeMap, e);
    callPairs.add(`${e.from}|${e.to}`);
  }
  const unique = uniqueSymbolDefs(scan2);
  if (unique.size) {
    for (const f of scan2.files) {
      if (f.kind !== "code" || !f.idents?.length) continue;
      const perTarget = /* @__PURE__ */ new Map();
      for (const id of f.idents) {
        const target = unique.get(id);
        if (!target || target === f.rel) continue;
        perTarget.set(target, (perTarget.get(target) ?? 0) + 1);
      }
      for (const [target, count] of perTarget) {
        const pair = `${f.rel}|${target}`;
        if (importPairs.has(pair) || callPairs.has(pair)) continue;
        collect(fileEdgeMap, { from: f.rel, to: target, kind: "use", weight: Math.min(count, 5) });
      }
    }
  }
  if (unique.size) {
    for (const f of scan2.files) {
      if (f.kind !== "doc") continue;
      const content = scan2.docText.get(f.rel) ?? readText(join4(scan2.root, f.rel));
      if (!content) continue;
      const tokens = /* @__PURE__ */ new Map();
      for (const tok of content.split(/[^A-Za-z0-9_]+/)) {
        if (unique.has(tok)) tokens.set(tok, (tokens.get(tok) ?? 0) + 1);
      }
      for (const [name2, count] of tokens) {
        const target = unique.get(name2);
        if (target === f.rel) continue;
        collect(fileEdgeMap, { from: f.rel, to: target, kind: "mention", weight: Math.min(count, 5) });
      }
    }
  }
  const fileEdges = [...fileEdgeMap.values()].sort(
    (a, b) => byStr(a.from, b.from) || byStr(a.to, b.to) || byStr(a.kind, b.kind)
  );
  const degIn = /* @__PURE__ */ new Map();
  const degOut = /* @__PURE__ */ new Map();
  const fileSet = new Set(scan2.files.map((f) => f.rel));
  for (const e of fileEdges) {
    if (e.dangling || !fileSet.has(e.to)) continue;
    degOut.set(e.from, (degOut.get(e.from) ?? 0) + 1);
    degIn.set(e.to, (degIn.get(e.to) ?? 0) + 1);
  }
  const KIND_RANK = { import: 5, call: 4, use: 3, "doc-link": 2, mention: 1, contains: 0 };
  const modEdgeMap = /* @__PURE__ */ new Map();
  for (const e of fileEdges) {
    if (e.dangling || !fileSet.has(e.to)) continue;
    const from = moduleOf.get(e.from);
    const to = moduleOf.get(e.to);
    if (!from || !to || from === to) continue;
    const k = `${from}\0${to}`;
    const prev = modEdgeMap.get(k);
    if (prev) {
      prev.weight += e.weight;
      if ((KIND_RANK[e.kind] ?? 0) > (KIND_RANK[prev.kind] ?? 0)) prev.kind = e.kind;
    } else {
      modEdgeMap.set(k, { from, to, kind: e.kind, weight: e.weight });
    }
  }
  const moduleEdges = [...modEdgeMap.values()].sort((a, b) => byStr(a.from, b.from) || byStr(a.to, b.to));
  const modDegIn = /* @__PURE__ */ new Map();
  const modDegOut = /* @__PURE__ */ new Map();
  for (const e of moduleEdges) {
    modDegOut.set(e.from, (modDegOut.get(e.from) ?? 0) + 1);
    modDegIn.set(e.to, (modDegIn.get(e.to) ?? 0) + 1);
  }
  const files = scan2.files.map((f) => ({
    id: f.rel,
    kind: "file",
    rel: f.rel,
    fileKind: f.kind,
    lang: f.lang,
    module: moduleOf.get(f.rel) ?? "root",
    title: f.title,
    summary: f.summary,
    symbols: f.symbols.length,
    lines: f.lines,
    degIn: degIn.get(f.rel) ?? 0,
    degOut: degOut.get(f.rel) ?? 0
  })).sort((a, b) => byStr(a.rel, b.rel));
  const symbolsByModule = /* @__PURE__ */ new Map();
  for (const f of scan2.files) {
    const slug = moduleOf.get(f.rel) ?? "root";
    symbolsByModule.set(slug, (symbolsByModule.get(slug) ?? 0) + f.symbols.length);
  }
  const moduleNodes = modules.map((m) => ({
    id: m.slug,
    kind: "module",
    slug: m.slug,
    path: m.path,
    title: m.title,
    summary: m.summary,
    tier: m.tier,
    members: m.members,
    symbols: symbolsByModule.get(m.slug) ?? 0,
    degIn: modDegIn.get(m.slug) ?? 0,
    degOut: modDegOut.get(m.slug) ?? 0
  })).sort((a, b) => byStr(a.slug, b.slug));
  return {
    schemaVersion: SCHEMA_VERSION,
    version: VERSION,
    commit: scan2.commit,
    fileCount: scan2.files.length,
    languages: scan2.languages,
    files,
    modules: moduleNodes,
    fileEdges,
    moduleEdges
  };
}

// src/community.ts
var GAMMA = 1;
var MAX_SWEEPS = 20;
var MAX_PASSES = 10;
var EPS = 1e-12;
var OVERSIZE_FRACTION = 0.25;
var OVERSIZE_MIN = 10;
function buildAdjacency(slugs, edges) {
  const n = slugs.length;
  const idx = new Map(slugs.map((s, i2) => [s, i2]));
  const adj = Array.from({ length: n }, () => /* @__PURE__ */ new Map());
  for (const e of edges) {
    if (e.dangling) continue;
    const a = idx.get(e.from);
    const b = idx.get(e.to);
    if (a === void 0 || b === void 0 || a === b) continue;
    adj[a].set(b, (adj[a].get(b) ?? 0) + e.weight);
    adj[b].set(a, (adj[b].get(a) ?? 0) + e.weight);
  }
  const k = adj.map((m) => {
    let s = 0;
    for (const w of m.values()) s += w;
    return s;
  });
  const twoM = k.reduce((a, b) => a + b, 0);
  return { n, adj, k, twoM };
}
function canonicalize(comm) {
  const remap = /* @__PURE__ */ new Map();
  const out2 = new Array(comm.length);
  for (let i2 = 0; i2 < comm.length; i2++) {
    let id = remap.get(comm[i2]);
    if (id === void 0) {
      id = remap.size;
      remap.set(comm[i2], id);
    }
    out2[i2] = id;
  }
  return { comm: out2, count: remap.size };
}
function localMove(g) {
  const { n, adj, k, twoM } = g;
  const comm = Array.from({ length: n }, (_, i2) => i2);
  if (twoM === 0) return canonicalize(comm);
  const commTot = k.slice();
  let moved = true;
  let sweeps = 0;
  while (moved && sweeps < MAX_SWEEPS) {
    moved = false;
    sweeps++;
    for (let i2 = 0; i2 < n; i2++) {
      const cOld = comm[i2];
      commTot[cOld] -= k[i2];
      const nb = /* @__PURE__ */ new Map();
      for (const [j, wij] of adj[i2]) {
        if (j === i2) continue;
        const cj = comm[j];
        nb.set(cj, (nb.get(cj) ?? 0) + wij);
      }
      let bestC = cOld;
      let bestScore = (nb.get(cOld) ?? 0) - GAMMA * k[i2] * commTot[cOld] / twoM;
      for (const c2 of [...nb.keys()].sort((a, b) => a - b)) {
        if (c2 === cOld) continue;
        const score = nb.get(c2) - GAMMA * k[i2] * commTot[c2] / twoM;
        if (score > bestScore + EPS) {
          bestScore = score;
          bestC = c2;
        }
      }
      commTot[bestC] += k[i2];
      if (bestC !== cOld) {
        comm[i2] = bestC;
        moved = true;
      }
    }
  }
  return canonicalize(comm);
}
function aggregate(g, comm, count) {
  const adj = Array.from({ length: count }, () => /* @__PURE__ */ new Map());
  for (let i2 = 0; i2 < g.n; i2++) {
    const ci = comm[i2];
    for (const [j, wij] of g.adj[i2]) {
      const cj = comm[j];
      adj[ci].set(cj, (adj[ci].get(cj) ?? 0) + wij);
    }
  }
  const k = adj.map((m) => {
    let s = 0;
    for (const w of m.values()) s += w;
    return s;
  });
  const twoM = k.reduce((a, b) => a + b, 0);
  return { n: count, adj, k, twoM };
}
function louvain(g) {
  if (g.n === 0) return [];
  let level = g;
  const mapping = Array.from({ length: g.n }, (_, i2) => i2);
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const { comm, count } = localMove(level);
    for (let i2 = 0; i2 < mapping.length; i2++) mapping[i2] = comm[mapping[i2]];
    if (count === level.n) break;
    level = aggregate(level, comm, count);
  }
  return canonicalize(mapping).comm;
}
function groupByLabel(labels) {
  const groups = [];
  for (let i2 = 0; i2 < labels.length; i2++) {
    (groups[labels[i2]] ??= []).push(i2);
  }
  return groups.filter((g) => g && g.length > 0);
}
function louvainInduced(g, members) {
  const m = members.length;
  const local = /* @__PURE__ */ new Map();
  members.forEach((b, li) => local.set(b, li));
  const adj = Array.from({ length: m }, () => /* @__PURE__ */ new Map());
  for (let li = 0; li < m; li++) {
    for (const [nb, w] of g.adj[members[li]]) {
      const lj = local.get(nb);
      if (lj === void 0) continue;
      adj[li].set(lj, w);
    }
  }
  const k = adj.map((mp) => {
    let s = 0;
    for (const w of mp.values()) s += w;
    return s;
  });
  const twoM = k.reduce((a, b) => a + b, 0);
  const labels = louvain({ n: m, adj, k, twoM });
  return groupByLabel(labels).map((grp) => grp.map((li) => members[li]));
}
function splitOversized(groups, g, n) {
  const out2 = [];
  for (const grp of groups) {
    if (grp.length > OVERSIZE_FRACTION * n && grp.length >= OVERSIZE_MIN) {
      const sub = louvainInduced(g, grp);
      if (sub.length > 1) {
        out2.push(...sub);
        continue;
      }
    }
    out2.push(grp);
  }
  return out2;
}
function compareCommunities(a, b) {
  if (a.length !== b.length) return b.length - a.length;
  for (let i2 = 0; i2 < a.length; i2++) {
    const c2 = byStr(a[i2], b[i2]);
    if (c2) return c2;
  }
  return 0;
}
function assignIds(ordered, previous) {
  const n = ordered.length;
  const ids = new Array(n).fill(-1);
  if (!previous || Object.keys(previous).length === 0) {
    for (let i2 = 0; i2 < n; i2++) ids[i2] = i2;
    return ids;
  }
  const prevSets = Object.entries(previous).map(([id, members]) => ({
    id: Number(id),
    set: new Set(members)
  }));
  const pairs = [];
  ordered.forEach((comm, ni) => {
    for (const prev of prevSets) {
      let inter = 0;
      for (const s of comm) if (prev.set.has(s)) inter++;
      if (inter > 0) pairs.push({ ni, prevId: prev.id, inter });
    }
  });
  pairs.sort((a, b) => b.inter - a.inter || a.ni - b.ni || a.prevId - b.prevId);
  const matched = /* @__PURE__ */ new Map();
  const usedPrev = /* @__PURE__ */ new Set();
  for (const p of pairs) {
    if (matched.has(p.ni) || usedPrev.has(p.prevId)) continue;
    matched.set(p.ni, p.prevId);
    usedPrev.add(p.prevId);
  }
  const taken = /* @__PURE__ */ new Set();
  for (let ni = 0; ni < n; ni++) {
    const pid = matched.get(ni);
    if (pid !== void 0 && pid >= 0 && pid < n && !taken.has(pid)) {
      ids[ni] = pid;
      taken.add(pid);
    }
  }
  const free = [];
  for (let id = 0; id < n; id++) if (!taken.has(id)) free.push(id);
  let fi = 0;
  for (let ni = 0; ni < n; ni++) if (ids[ni] === -1) ids[ni] = free[fi++];
  return ids;
}
function detectCommunities(modules, edges, previous) {
  const out2 = /* @__PURE__ */ new Map();
  if (modules.length === 0) return out2;
  const slugs = modules.map((m) => m.slug).sort(byStr);
  const g = buildAdjacency(slugs, edges);
  const labels = louvain(g);
  const split = splitOversized(groupByLabel(labels), g, slugs.length);
  const communities = split.map((grp) => grp.map((i2) => slugs[i2]).sort(byStr));
  communities.sort(compareCommunities);
  const ids = assignIds(communities, previous);
  communities.forEach((comm, ni) => {
    for (const s of comm) out2.set(s, ids[ni]);
  });
  return out2;
}

// src/merge.ts
var ENRICH_MARKER = "<!-- ui:enrich -->";
function isEnrichedBody(body2) {
  return body2.trim() !== "" && !body2.includes(ENRICH_MARKER);
}
var OPEN_RE = /^<!--\s*ui:(gen|human)\s+key=([A-Za-z0-9_-]+)(?:\s+hash=([a-f0-9]+))?\s*-->\s*$/;
var CLOSE_RE = /^<!--\s*\/ui:(gen|human)\s+key=([A-Za-z0-9_-]+)\s*-->\s*$/;
function trimBlank(lines) {
  let start2 = 0;
  let end = lines.length;
  while (start2 < end && lines[start2].trim() === "") start2++;
  while (end > start2 && lines[end - 1].trim() === "") end--;
  return lines.slice(start2, end).join("\n");
}
function serializeRegions(regions) {
  const blocks = regions.map((r) => {
    if (r.type === "gen") {
      return `<!-- ui:gen key=${r.key} hash=${shortHash(r.body)} -->
${r.body}
<!-- /ui:gen key=${r.key} -->`;
    }
    return `<!-- ui:human key=${r.key} -->
${r.body}
<!-- /ui:human key=${r.key} -->`;
  });
  return blocks.join("\n\n") + "\n";
}
function parseRegions(text) {
  const lines = text.split(/\r?\n/);
  const regions = [];
  let orphan = [];
  let open = null;
  const flushOrphan = () => {
    const body2 = trimBlank(orphan);
    orphan = [];
    if (body2) regions.push({ type: "human", key: `orphan-${shortHash(body2)}`, body: body2 });
  };
  for (const line of lines) {
    const o = OPEN_RE.exec(line);
    const c2 = CLOSE_RE.exec(line);
    if (open) {
      if (c2) {
        if (c2[1] !== open.type || c2[2] !== open.key) return { regions: [], ok: false };
        regions.push({ type: open.type, key: open.key, body: trimBlank(open.body) });
        open = null;
        continue;
      }
      if (o) return { regions: [], ok: false };
      open.body.push(line);
      continue;
    }
    if (c2) return { regions: [], ok: false };
    if (o) {
      flushOrphan();
      open = { type: o[1], key: o[2], body: [] };
      continue;
    }
    orphan.push(line);
  }
  if (open) return { regions: [], ok: false };
  flushOrphan();
  return { regions, ok: true };
}
function humanBodies(text) {
  const out2 = /* @__PURE__ */ new Map();
  const { regions, ok } = parseRegions(text);
  if (!ok) return out2;
  for (const r of regions) if (r.type === "human") out2.set(r.key, r.body);
  return out2;
}
function mergeEntry(spec, existing, migrated) {
  const specKeys = new Set(spec.filter((r) => r.type === "human").map((r) => r.key));
  let existingHuman = /* @__PURE__ */ new Map();
  let dupConflict;
  if (existing && existing.trim()) {
    const parsed = parseRegions(existing);
    if (!parsed.ok) {
      return {
        content: existing,
        humanKeys: [],
        migratedKeys: [],
        conflict: "unparseable region fences \u2014 kept existing entry, refused to rewrite"
      };
    }
    for (const r of parsed.regions) {
      if (r.type !== "human") continue;
      if (existingHuman.has(r.key) && existingHuman.get(r.key) !== r.body) {
        existingHuman.set(`${r.key}-dup-${shortHash(r.body)}`, r.body);
        dupConflict = `duplicate human region key "${r.key}" \u2014 preserved both bodies`;
      } else {
        existingHuman.set(r.key, r.body);
      }
    }
  }
  const migratedKeysUsed = [];
  const out2 = spec.map((r) => {
    if (r.type === "gen") return r;
    const fromExisting = existingHuman.get(r.key);
    if (fromExisting !== void 0) return { ...r, body: fromExisting };
    const fromMigrated = migrated?.get(r.key);
    if (fromMigrated !== void 0) {
      migratedKeysUsed.push(r.key);
      return { ...r, body: fromMigrated };
    }
    return r;
  });
  const appended = /* @__PURE__ */ new Map();
  for (const [key, body2] of existingHuman) if (!specKeys.has(key)) appended.set(key, body2);
  if (migrated) {
    for (const [key, body2] of migrated) {
      if (specKeys.has(key) || appended.has(key)) continue;
      const mk = key.startsWith("migrated-from-") || key.startsWith("orphan-") ? key : `migrated-${key}`;
      appended.set(mk, body2);
      migratedKeysUsed.push(mk);
    }
  }
  for (const key of [...appended.keys()].sort(byStr)) {
    out2.push({ type: "human", key, body: appended.get(key) });
  }
  const humanKeys = out2.filter((r) => r.type === "human").map((r) => r.key);
  return { content: serializeRegions(out2), humanKeys, migratedKeys: migratedKeysUsed, conflict: dupConflict };
}

// src/render/encyclopedia.ts
function buildEntryEdgeIndex(graph, moduleOf) {
  const out2 = /* @__PURE__ */ new Map();
  const inc = /* @__PURE__ */ new Map();
  const dangling = /* @__PURE__ */ new Map();
  const push = (m, key, e) => {
    const arr = m.get(key);
    if (arr) arr.push(e);
    else m.set(key, [e]);
  };
  for (const e of graph.moduleEdges) {
    push(out2, e.from, e);
    push(inc, e.to, e);
  }
  for (const e of graph.fileEdges) {
    if (!e.dangling) continue;
    const slug = moduleOf.get(e.from);
    if (slug) push(dangling, slug, e);
  }
  return { out: out2, inc, dangling };
}
var TIER_LABEL = { 0: "Foundations", 1: "Features", 2: "Tail" };
var MAX_SYMBOLS_PER_FILE = 15;
var MAX_DANGLING = 12;
var MAX_LINKS = 30;
function headerRegion(m) {
  const where = m.path === "(root)" ? "Repository root" : m.path;
  const body2 = [
    `# ${where}`,
    "",
    m.summary,
    "",
    `*Module \`${m.slug}\` \xB7 tier ${m.tier} (${TIER_LABEL[m.tier]}) \xB7 ${m.members.length} files \xB7 ${m.symbols} symbols*`
  ].join("\n");
  return { type: "gen", key: "header", body: body2 };
}
function businessStub() {
  return {
    type: "human",
    key: "business",
    body: `${ENRICH_MARKER} _What this module does for the product and how it connects to the rest of the system. Replace this paragraph during the enrichment pass._`
  };
}
function gotchasStub() {
  return {
    type: "human",
    key: "gotchas",
    body: `${ENRICH_MARKER} _Caveats, invariants, or pitfalls worth knowing before changing this module. Optional._`
  };
}
function codeViewRegion(m, records) {
  const lines = ["## Code view"];
  const langs = [...new Set(m.members.map((r) => records.get(r)?.lang).filter((l) => !!l && l !== "other"))];
  if (langs.length) {
    lines.push("");
    lines.push(`**Languages:** ${langs.sort(byStr).join(", ")}`);
  }
  const apiBlocks = [];
  for (const rel of m.members) {
    const rec = records.get(rel);
    if (!rec || rec.kind !== "code") continue;
    const exported = rec.symbols.filter((s) => s.exported).sort((a, b) => a.line - b.line);
    const shown = exported.slice(0, MAX_SYMBOLS_PER_FILE);
    if (!shown.length) continue;
    const block = [`- \`${rel}\``];
    for (const s of shown) {
      const sig = s.signature ? ` \u2014 \`${clip(s.signature, 100).split("\n")[0]}\`` : "";
      block.push(`  - \`${s.kind} ${s.name}\`${sig}`);
    }
    if (exported.length > shown.length) block.push(`  - _\u2026and ${exported.length - shown.length} more_`);
    apiBlocks.push(block.join("\n"));
  }
  lines.push("");
  if (apiBlocks.length) {
    lines.push("**Exported API:**");
    lines.push("");
    lines.push(apiBlocks.join("\n"));
  } else {
    lines.push("_No exported symbols detected (the module is docs/config, or its language has no extractor)._");
  }
  return { type: "gen", key: "code-view", body: lines.join("\n") };
}
function linksRegion(m, edgeIndex) {
  const render = (edges, other) => {
    const sorted = edges.slice().sort((a, b) => b.weight - a.weight || byStr(other(a), other(b)));
    const shown = sorted.slice(0, MAX_LINKS).map((e) => {
      const o = other(e);
      return `[\`${o}\`](${o}.md) (${e.kind}${e.weight > 1 ? ` \xD7${e.weight}` : ""})`;
    });
    if (sorted.length > MAX_LINKS) shown.push(`\u2026and ${sorted.length - MAX_LINKS} more`);
    return shown;
  };
  const out2 = render(edgeIndex.out.get(m.slug) ?? [], (e) => e.to);
  const inc = render(edgeIndex.inc.get(m.slug) ?? [], (e) => e.from);
  const dangling = (edgeIndex.dangling.get(m.slug) ?? []).slice().sort((a, b) => byStr(a.from, b.from) || byStr(a.to, b.to)).slice(0, MAX_DANGLING).map((e) => `\`${e.to}\` (${e.kind}, ${e.reason}) \u2014 from \`${e.from}\``);
  const bulletList = (items) => items.length ? items.map((i2) => `- ${i2}`) : ["_none_"];
  const lines = ["## Links"];
  lines.push("");
  lines.push("**Depends on / links out:**");
  lines.push(...bulletList(out2));
  lines.push("");
  lines.push("**Used by / linked from:**");
  lines.push(...bulletList(inc));
  if (dangling.length) {
    lines.push("");
    lines.push("**Dangling references:**");
    for (const d of dangling) lines.push(`- ${d}`);
  }
  return { type: "gen", key: "links", body: lines.join("\n") };
}
function sourcePointersRegion(m, records) {
  const lines = ["## Source pointers", "", "Open these files to work on this module:"];
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  for (const rel of m.members) {
    const rec = records.get(rel);
    const meta = rec ? `${plural(rec.lines, "line")}${rec.symbols.length ? `, ${plural(rec.symbols.length, "symbol")}` : ""}` : "";
    lines.push(`- \`${rel}\`${meta ? ` \u2014 ${meta}` : ""}`);
  }
  return { type: "gen", key: "source-pointers", body: lines.join("\n") };
}
function renderEntrySpec(m, edgeIndex, records) {
  return [
    headerRegion(m),
    businessStub(),
    codeViewRegion(m, records),
    linksRegion(m, edgeIndex),
    sourcePointersRegion(m, records),
    gotchasStub()
  ];
}

// src/render/index-md.ts
var TIER_LABEL2 = { 0: "Foundations", 1: "Features", 2: "Tail" };
var HUB_CAP = 12;
var MODULE_CAP = 120;
var ARCH_CAP = 12;
var ARCH_MEMBER_CAP = 12;
var degree = (m) => m.degIn + m.degOut;
function histogram(languages) {
  return Object.entries(languages).sort((a, b) => b[1] - a[1] || byStr(a[0], b[0])).slice(0, 8).map(([k, v]) => `${k}:${v}`).join(" \xB7 ");
}
function row(m) {
  const link = `[\`${m.slug}\`](encyclopedia/${m.slug}.md)`;
  return `| ${link} | \`${m.path}\` | ${clip(m.summary, 90).split("\n")[0]} | ${m.members.length} | ${degree(m)} |`;
}
function renderIndex(graph, opts) {
  const dangling = graph.fileEdges.filter((e) => e.dangling).length;
  const lines = [];
  lines.push(`# ${opts.repoName} \u2014 ultraindex map`);
  lines.push("");
  lines.push(
    `${graph.fileCount} files \xB7 ${graph.modules.length} modules \xB7 ${graph.fileEdges.length} links${dangling ? ` (${dangling} dangling)` : ""}${graph.commit ? ` \xB7 @ ${graph.commit}` : ""}`
  );
  lines.push("");
  lines.push(`**Languages:** ${histogram(graph.languages)}`);
  lines.push("");
  lines.push(
    '**Navigate:** `ultraindex find "<task>"` lists the exact files to open \xB7 `ultraindex neighbors <file|module>` walks the graph \xB7 entries are in `encyclopedia/` \xB7 the module diagram is in `graph.mmd`.'
  );
  const hubs = graph.modules.slice().filter((m) => degree(m) > 0).sort((a, b) => degree(b) - degree(a) || byStr(a.slug, b.slug)).slice(0, HUB_CAP);
  if (hubs.length) {
    lines.push("");
    lines.push("## Hubs");
    lines.push("");
    for (const m of hubs) {
      const d = degree(m);
      lines.push(`- [\`${m.slug}\`](encyclopedia/${m.slug}.md) (${d} link${d === 1 ? "" : "s"}) \u2014 ${clip(m.summary, 100).split("\n")[0]}`);
    }
  }
  const byCommunity = /* @__PURE__ */ new Map();
  for (const m of graph.modules) {
    if (m.community === void 0) continue;
    (byCommunity.get(m.community) ?? byCommunity.set(m.community, []).get(m.community)).push(m);
  }
  if (byCommunity.size > 1) {
    lines.push("");
    lines.push("## Architecture");
    lines.push("");
    const groups = [...byCommunity.entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0]).slice(0, ARCH_CAP);
    for (const [, members] of groups) {
      const label = members.slice().sort((a, b) => degree(b) - degree(a) || byStr(a.slug, b.slug))[0].path;
      const slugs = members.map((m) => m.slug).sort(byStr);
      const shown2 = slugs.slice(0, ARCH_MEMBER_CAP).map((s) => `\`${s}\``).join(", ");
      const overflow = slugs.length > ARCH_MEMBER_CAP ? ` _(+${slugs.length - ARCH_MEMBER_CAP} more)_` : "";
      lines.push(`- \`${label}\` \u2014 ${shown2}${overflow}`);
    }
  }
  lines.push("");
  lines.push("## Modules");
  const ranked = graph.modules.slice().sort((a, b) => degree(b) - degree(a) || byStr(a.slug, b.slug));
  const shown = ranked.slice(0, MODULE_CAP);
  const shownSet = new Set(shown.map((m) => m.slug));
  for (const tier of [0, 1, 2]) {
    const inTier = shown.filter((m) => m.tier === tier).sort((a, b) => byStr(a.slug, b.slug));
    if (!inTier.length) continue;
    lines.push("");
    lines.push(`### ${TIER_LABEL2[tier]}`);
    lines.push("");
    lines.push("| module | path | summary | files | links |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const m of inTier) lines.push(row(m));
  }
  if (ranked.length > shown.length) {
    const more = ranked.length - shown.length;
    const omitted = ranked.slice(shown.length).map((m) => m.slug);
    lines.push("");
    lines.push(`_\u2026 and ${more} more module(s) not shown here (run \`ultraindex map\` for the full list, or \`ultraindex find\`): ${clip(omitted.join(", "), 300).split("\n")[0]}_`);
  }
  if (opts.mermaid && (opts.mermaid.shownModules < opts.mermaid.totalModules || opts.mermaid.shownEdges < opts.mermaid.totalEdges)) {
    lines.push("");
    lines.push(
      `_Diagram (\`graph.mmd\`) shows ${opts.mermaid.shownModules}/${opts.mermaid.totalModules} modules and ${opts.mermaid.shownEdges}/${opts.mermaid.totalEdges} edges; full graph in \`graph.json\`._`
    );
  }
  lines.push("");
  return lines.join("\n");
}

// src/render/mermaid.ts
var TIER_LABEL3 = { 0: "Foundations", 1: "Features", 2: "Tail" };
var DEFAULT_MAX_MODULES = 40;
var DEFAULT_MAX_EDGES = 80;
var degree2 = (m) => m.degIn + m.degOut;
function nodeId(slug) {
  return "m_" + slug.replace(/[^A-Za-z0-9_]/g, "_");
}
function quoteLabel(s) {
  return s.replace(/"/g, "'");
}
function renderMermaid(graph, opts = {}) {
  const maxModules = opts.maxModules ?? DEFAULT_MAX_MODULES;
  const maxEdges = opts.maxEdges ?? DEFAULT_MAX_EDGES;
  const ranked = graph.modules.slice().sort((a, b) => degree2(b) - degree2(a) || byStr(a.slug, b.slug));
  const shown = ranked.slice(0, maxModules);
  const shownSet = new Set(shown.map((m) => m.slug));
  const eligibleEdges = graph.moduleEdges.filter((e) => shownSet.has(e.from) && shownSet.has(e.to));
  const edges = eligibleEdges.slice().sort((a, b) => b.weight - a.weight || byStr(a.from, b.from) || byStr(a.to, b.to)).slice(0, maxEdges);
  const lines = [];
  lines.push(`%% ultraindex module graph \u2014 ${shown.length} of ${graph.modules.length} modules, ${edges.length} of ${graph.moduleEdges.length} edges`);
  if (shown.length < graph.modules.length || edges.length < graph.moduleEdges.length) {
    lines.push(`%% truncated to the most-connected modules/edges; see graph.json for the full graph`);
  }
  lines.push("flowchart LR");
  for (const tier of [0, 1, 2]) {
    const inTier = shown.filter((m) => m.tier === tier);
    if (!inTier.length) continue;
    lines.push(`  subgraph ${TIER_LABEL3[tier]}`);
    for (const m of inTier) lines.push(`    ${nodeId(m.slug)}["${quoteLabel(m.path)}"]`);
    lines.push("  end");
  }
  for (const e of edges) {
    const label = e.weight > 1 ? `|${e.weight}| ` : "";
    lines.push(`  ${nodeId(e.from)} -->${label ? " " + label : " "}${nodeId(e.to)}`);
  }
  const content = "```mermaid\n" + lines.join("\n") + "\n```\n";
  return {
    content,
    shownModules: shown.length,
    totalModules: graph.modules.length,
    shownEdges: edges.length,
    totalEdges: graph.moduleEdges.length
  };
}

// src/render/graph-json.ts
function sortObject(obj) {
  const out2 = {};
  for (const k of Object.keys(obj).sort(byStr)) out2[k] = obj[k];
  return out2;
}
function renderGraphJson(graph) {
  const ordered = { ...graph, languages: sortObject(graph.languages) };
  return JSON.stringify(ordered, null, 2) + "\n";
}

// src/render/symbols-json.ts
function computeSymbolRefs(scan2) {
  const unique = uniqueSymbolDefs(scan2);
  const refs = /* @__PURE__ */ new Map();
  if (!unique.size) return refs;
  const add = (name2, file) => {
    let set = refs.get(name2);
    if (!set) refs.set(name2, set = /* @__PURE__ */ new Set());
    set.add(file);
  };
  for (const f of scan2.files) {
    if (f.kind === "code" && f.idents) {
      for (const id of f.idents) {
        const target = unique.get(id);
        if (target && target !== f.rel) add(id, f.rel);
      }
    } else if (f.kind === "doc") {
      const content = scan2.docText.get(f.rel);
      if (!content) continue;
      for (const tok of content.split(/[^A-Za-z0-9_]+/)) {
        const target = unique.get(tok);
        if (target && target !== f.rel) add(tok, f.rel);
      }
    }
  }
  return refs;
}
function buildSymbolIndex(scan2, refs = /* @__PURE__ */ new Map()) {
  const defsByName = /* @__PURE__ */ new Map();
  for (const f of scan2.files) {
    for (const s of f.symbols) {
      let arr = defsByName.get(s.name);
      if (!arr) defsByName.set(s.name, arr = []);
      arr.push({
        file: s.file,
        line: s.line,
        kind: s.kind,
        exported: s.exported,
        lang: s.lang,
        ...s.parent ? { parent: s.parent } : {}
      });
    }
  }
  const defs = {};
  for (const name2 of [...defsByName.keys()].sort(byStr)) {
    defs[name2] = defsByName.get(name2).slice().sort((a, b) => byStr(a.file, b.file) || a.line - b.line || byStr(a.kind, b.kind));
  }
  const refsOut = {};
  for (const name2 of [...refs.keys()].sort(byStr)) {
    const files = [...refs.get(name2)].sort(byStr);
    if (files.length) refsOut[name2] = files;
  }
  return { schemaVersion: SCHEMA_VERSION, defs, refs: refsOut };
}
function renderSymbolsJson(index) {
  return JSON.stringify(index, null, 2) + "\n";
}

// src/render/manifest.ts
function sortedRecord(obj) {
  const out2 = {};
  for (const k of Object.keys(obj).sort(byStr)) out2[k] = obj[k];
  return out2;
}
function buildManifest(scan2, graph, outRel, sync, builtAt, extraNotes = [], filters = {}) {
  const fileHashes = {};
  for (const f of scan2.files) fileHashes[f.rel] = f.hash;
  const modules = {};
  for (const m of graph.modules) {
    modules[m.slug] = { members: m.members, humanKeys: (sync.humanKeys[m.slug] ?? []).slice().sort(byStr) };
  }
  const communityMembers = /* @__PURE__ */ new Map();
  for (const m of graph.modules) {
    if (m.community === void 0) continue;
    (communityMembers.get(m.community) ?? communityMembers.set(m.community, []).get(m.community)).push(m.slug);
  }
  const communities = {};
  for (const [id, members] of communityMembers) communities[String(id)] = members.slice().sort(byStr);
  const scanFilters = {};
  if (filters.include?.length) scanFilters.include = filters.include;
  if (filters.exclude?.length) scanFilters.exclude = filters.exclude;
  if (filters.maxBytes !== void 0) scanFilters.maxBytes = filters.maxBytes;
  if (filters.maxFiles !== void 0) scanFilters.maxFiles = filters.maxFiles;
  return {
    schemaVersion: SCHEMA_VERSION,
    version: VERSION,
    commit: scan2.commit,
    builtAt,
    repo: scan2.root,
    out: outRel,
    fileHashes: sortedRecord(fileHashes),
    modules: sortedRecord(modules),
    orphaned: sync.orphaned.slice().sort(byStr),
    notes: [...extraNotes, ...sync.notes],
    ...Object.keys(communities).length ? { communities: sortedRecord(communities) } : {},
    ...Object.keys(scanFilters).length ? { scan: scanFilters } : {}
  };
}
function renderManifestJson(manifest) {
  return JSON.stringify(manifest, null, 2) + "\n";
}

// src/entries.ts
import { join as join6 } from "path";

// src/output.ts
import { existsSync as existsSync2, mkdirSync, readFileSync as readFileSync3, writeFileSync, renameSync, rmSync, readdirSync as readdirSync2 } from "fs";
import { dirname as dirname2, join as join5 } from "path";
function readIfExists(path) {
  try {
    return existsSync2(path) ? readFileSync3(path, "utf8") : void 0;
  } catch {
    return void 0;
  }
}
function writeFileIfChanged(path, content) {
  const current = readIfExists(path);
  if (current === content) return false;
  mkdirSync(dirname2(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
  return true;
}
function moveFile(from, to) {
  if (!existsSync2(from)) return;
  mkdirSync(dirname2(to), { recursive: true });
  renameSync(from, to);
}
function removeFile(path) {
  try {
    rmSync(path, { force: true });
  } catch {
  }
}
function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

// src/entries.ts
var MIGRATE_THRESHOLD = 0.5;
function jaccard(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}
function syncEntries(outDir, entries, prevModules) {
  const encDir = join6(outDir, "encyclopedia");
  const orphanDir = join6(encDir, "_orphaned");
  const entryPath = (slug) => join6(encDir, `${slug}.md`);
  const currentSlugs = new Set(entries.map((e) => e.slug));
  const consumed = /* @__PURE__ */ new Set();
  const notes = [];
  const humanKeys = {};
  const goneOld = Object.keys(prevModules).filter((s) => !currentSlugs.has(s));
  for (const e of entries.slice().sort((a, b) => byStr(a.slug, b.slug))) {
    const path = entryPath(e.slug);
    const existing = readIfExists(path);
    let migrated;
    if (!existing) {
      let best = null;
      for (const old of goneOld) {
        if (consumed.has(old)) continue;
        const score = jaccard(prevModules[old].members, e.members);
        if (score >= MIGRATE_THRESHOLD && (!best || score > best.score)) best = { slug: old, score };
      }
      if (best) {
        const oldText = readIfExists(entryPath(best.slug));
        if (oldText) {
          migrated = humanBodies(oldText);
          consumed.add(best.slug);
          notes.push(`migrated prose from "${best.slug}" \u2192 "${e.slug}" (member overlap ${best.score.toFixed(2)})`);
        }
      }
    }
    const merged = mergeEntry(e.spec, existing, migrated);
    if (merged.conflict) notes.push(`${e.slug}: ${merged.conflict}`);
    writeFileIfChanged(path, merged.content);
    humanKeys[e.slug] = merged.humanKeys;
  }
  const orphaned = [];
  for (const old of goneOld) {
    const path = entryPath(old);
    if (consumed.has(old)) {
      removeFile(path);
      continue;
    }
    const text = readIfExists(path);
    if (text === void 0) continue;
    const human = humanBodies(text);
    const hasProse2 = [...human.values()].some((b) => b.trim().length > 0);
    if (hasProse2) {
      moveFile(path, join6(orphanDir, `${old}.md`));
      orphaned.push(old);
      notes.push(`orphaned prose for removed module "${old}" \u2192 encyclopedia/_orphaned/${old}.md`);
    } else {
      removeFile(path);
    }
  }
  orphaned.sort(byStr);
  return { orphaned, notes, humanKeys };
}

// src/store.ts
import { join as join7 } from "path";
function indexPaths(outDir) {
  return {
    index: join7(outDir, "INDEX.md"),
    graph: join7(outDir, "graph.json"),
    manifest: join7(outDir, "manifest.json"),
    mermaid: join7(outDir, "graph.mmd"),
    encyclopedia: join7(outDir, "encyclopedia"),
    vectors: join7(outDir, "vectors.json"),
    semantic: join7(outDir, "semantic.json"),
    symbols: join7(outDir, "symbols.json"),
    cache: join7(outDir, "cache.json")
  };
}
function indexExists(outDir) {
  return readIfExists(indexPaths(outDir).graph) !== void 0;
}
function loadGraph(outDir) {
  const raw = readIfExists(indexPaths(outDir).graph);
  if (raw === void 0) return void 0;
  try {
    const g = JSON.parse(raw);
    return g.schemaVersion === SCHEMA_VERSION ? g : void 0;
  } catch {
    return void 0;
  }
}
function loadManifest(outDir) {
  const raw = readIfExists(indexPaths(outDir).manifest);
  if (raw === void 0) return void 0;
  try {
    const m = JSON.parse(raw);
    return m.schemaVersion === SCHEMA_VERSION ? m : void 0;
  } catch {
    return void 0;
  }
}
function loadSymbols(outDir) {
  const raw = readIfExists(indexPaths(outDir).symbols);
  if (raw === void 0) return void 0;
  try {
    const s = JSON.parse(raw);
    return s.schemaVersion === SCHEMA_VERSION ? s : void 0;
  } catch {
    return void 0;
  }
}
function loadCache(outDir) {
  const raw = readIfExists(indexPaths(outDir).cache);
  if (raw === void 0) return void 0;
  try {
    const c2 = JSON.parse(raw);
    if (c2.schemaVersion !== SCHEMA_VERSION || c2.extractorVersion !== EXTRACTOR_VERSION) return void 0;
    return new Map(Object.entries(c2.files));
  } catch {
    return void 0;
  }
}

// src/build.ts
function runBuild(opts, builtAt) {
  const cache = opts.noCache ? void 0 : loadCache(opts.out);
  const scan2 = scanRepo(opts.repo, {
    include: opts.include,
    exclude: opts.exclude,
    maxBytes: opts.maxBytes,
    maxFiles: opts.maxFiles,
    out: opts.out,
    cache,
    fullHash: opts.fullHash
  });
  const ctx = buildResolveContext(scan2);
  const { modules, moduleOf } = buildModules(scan2);
  const graph = buildGraph(scan2, ctx, modules, moduleOf);
  const records = new Map(scan2.files.map((f) => [f.rel, f]));
  const paths = indexPaths(opts.out);
  ensureDir(opts.out);
  const prev = loadManifest(opts.out);
  const communities = detectCommunities(graph.modules, graph.moduleEdges, prev?.communities);
  for (const m of graph.modules) {
    const id = communities.get(m.slug);
    if (id !== void 0) m.community = id;
  }
  const edgeIndex = buildEntryEdgeIndex(graph, moduleOf);
  const entryInputs = graph.modules.map((m) => ({
    slug: m.slug,
    members: m.members,
    spec: renderEntrySpec(m, edgeIndex, records)
  }));
  const sync = syncEntries(opts.out, entryInputs, prev?.modules ?? {});
  const mermaid = opts.mermaid ? renderMermaid(graph) : void 0;
  writeFileIfChanged(paths.graph, renderGraphJson(graph));
  writeFileIfChanged(paths.symbols, renderSymbolsJson(buildSymbolIndex(scan2, computeSymbolRefs(scan2))));
  if (mermaid) writeFileIfChanged(paths.mermaid, mermaid.content);
  else removeFile(paths.mermaid);
  writeFileIfChanged(paths.index, renderIndex(graph, { repoName: basename2(opts.repo) || "repo", mermaid }));
  const cappedNote = scan2.capped ? [`file scan hit the --max-files cap (${opts.maxFiles ?? DEFAULT_MAX_FILES}); the index is PARTIAL \u2014 raise --max-files to index the whole repo`] : [];
  const extraNotes = [
    ...ctx.warnings,
    ...cappedNote,
    ...opts.mermaid ? [] : ["mermaid diagram disabled (--no-mermaid)"]
  ];
  const outRel = !isAbsolute(relative2(opts.repo, opts.out)) && !relative2(opts.repo, opts.out).startsWith("..") ? relative2(opts.repo, opts.out) : opts.out;
  const manifest = buildManifest(scan2, graph, outRel, sync, builtAt, extraNotes, {
    include: opts.include,
    exclude: opts.exclude,
    maxBytes: opts.maxBytes,
    maxFiles: opts.maxFiles
  });
  writeFileIfChanged(paths.manifest, renderManifestJson(manifest));
  if (!opts.noCache) {
    const files = {};
    for (const f of scan2.files) files[f.rel] = { hash: f.hash, record: f, size: f.size, mtimeMs: scan2.mtimes.get(f.rel) };
    const cacheOut = { schemaVersion: SCHEMA_VERSION, extractorVersion: EXTRACTOR_VERSION, files };
    writeFileIfChanged(paths.cache, JSON.stringify(cacheOut) + "\n");
  }
  return { outDir: opts.out, graph, manifest, capped: scan2.capped };
}

// src/find.ts
import { join as join8, basename as basename3, extname as extname2 } from "path";

// src/lex.ts
function splitIdentifier(token) {
  const spaced = token.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/([A-Za-z])(\d)/g, "$1 $2").replace(/(\d)([A-Za-z])/g, "$1 $2");
  const seen = /* @__PURE__ */ new Set();
  const out2 = [];
  for (const part of spaced.split(/[^A-Za-z0-9]+| /)) {
    if (!part) continue;
    const lower = part.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out2.push(lower);
  }
  return out2;
}
function stem(token) {
  if (token.length < 4 || /\d/.test(token)) return token;
  let t = token;
  if (t.length >= 5 && t.endsWith("ies")) t = t.slice(0, -3) + "y";
  else if (/(ses|xes|zes|ches|shes)$/.test(t)) t = t.slice(0, -2);
  else if (!t.endsWith("ss") && t.endsWith("s")) t = t.slice(0, -1);
  if (t.length >= 6 && t.endsWith("ing")) t = t.slice(0, -3);
  else if (t.length >= 5 && t.endsWith("ed")) t = t.slice(0, -2);
  if (t.length >= 5 && t.endsWith("e")) t = t.slice(0, -1);
  return t.length >= 3 ? t : token;
}
var SYNONYM_GROUPS = [
  ["auth", "authentication", "authn", "login", "signin", "signon", "sso", "session"],
  ["perm", "permission", "authz", "authorization", "acl", "role", "rbac"],
  ["db", "database", "storage", "persistence", "sql"],
  ["config", "configuration", "settings", "options", "preferences"],
  ["init", "initialize", "initialise", "setup", "bootstrap"],
  ["delete", "remove", "destroy", "drop"],
  ["fetch", "request", "http", "api"],
  ["error", "exception", "failure", "fault"],
  ["user", "account", "profile"],
  ["test", "spec", "unittest"],
  ["dir", "directory", "folder"],
  ["doc", "docs", "documentation", "readme"],
  ["util", "utility", "helper"],
  ["nav", "navigate", "navigation", "router", "routing", "route"],
  ["embed", "embedding", "vector", "semantic"],
  ["search", "find", "query", "lookup"],
  ["log", "logging", "logger"],
  ["message", "messaging", "notification", "notify"]
];
var GROUP_OF = /* @__PURE__ */ new Map();
SYNONYM_GROUPS.forEach((group, id) => {
  for (const word of group) {
    GROUP_OF.set(word, id);
    GROUP_OF.set(stem(word), id);
  }
});
function synonymGroup(token) {
  return GROUP_OF.get(token) ?? GROUP_OF.get(stem(token));
}
function queryTerms(question) {
  return keywords(question).map((raw) => {
    const exact = raw.toLowerCase();
    const parts2 = splitIdentifier(raw).filter((p) => p !== exact && keywords(p).length > 0);
    const forms = /* @__PURE__ */ new Set();
    for (const f of [stem(exact), ...parts2, ...parts2.map(stem)]) {
      if (f !== exact) forms.add(f);
    }
    const groups = /* @__PURE__ */ new Set();
    for (const f of [exact, ...parts2]) {
      const g = synonymGroup(f);
      if (g !== void 0) groups.add(g);
    }
    return { raw, exact, forms: [...forms], groups: [...groups] };
  });
}
function bump(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}
function buildHaystack(text) {
  const folded = foldText(text);
  const counts = /* @__PURE__ */ new Map();
  const groups = /* @__PURE__ */ new Map();
  let length = 0;
  for (const tok of folded.split(/[^A-Za-z0-9_]+/)) {
    if (!tok) continue;
    length++;
    const lower = tok.toLowerCase();
    const forms = /* @__PURE__ */ new Set([lower, stem(lower)]);
    for (const part of splitIdentifier(tok)) {
      forms.add(part);
      forms.add(stem(part));
    }
    for (const f of forms) bump(counts, f);
    const seen = /* @__PURE__ */ new Set();
    for (const f of forms) {
      const g = GROUP_OF.get(f);
      if (g !== void 0 && !seen.has(g)) {
        seen.add(g);
        bump(groups, g);
      }
    }
  }
  return { counts, groups, raw: folded.toLowerCase(), length };
}
function scoreHaystack(hay, terms, saturate = false, idf) {
  let score = 0;
  const matched = [];
  for (const t of terms) {
    let weight = 0;
    let count = 0;
    const exactCount = hay.counts.get(t.exact) ?? 0;
    if (exactCount > 0) {
      weight = 3;
      count = exactCount;
    } else {
      for (const f of t.forms) {
        const c2 = hay.counts.get(f) ?? 0;
        if (c2 > count) count = c2;
      }
      if (count > 0) weight = 2;
      else {
        for (const g of t.groups) {
          const c2 = hay.groups.get(g) ?? 0;
          if (c2 > count) count = c2;
        }
        if (count > 0) weight = 1.5;
        else if (hay.raw.includes(t.exact)) {
          weight = 1;
          count = 1;
        }
      }
    }
    if (weight === 0) continue;
    const rarity = idf?.get(t.raw) ?? 1;
    score += (saturate ? weight * Math.min(1.5, 1 + Math.log1p(count - 1) * 0.25) : weight) * rarity;
    matched.push(t.raw);
  }
  if (saturate) score /= 1 + Math.log(Math.max(1, hay.length / 200));
  return { score, matched };
}

// src/symbols.ts
var MAX_HITS = 20;
var MAX_NAMES_PER_FILE = 60;
function exportedNamesByFile(index) {
  const out2 = /* @__PURE__ */ new Map();
  const seen = /* @__PURE__ */ new Map();
  for (const name2 of Object.keys(index.defs).sort(byStr)) {
    for (const d of index.defs[name2] ?? []) {
      if (!d.exported) continue;
      let list = out2.get(d.file);
      let dedupe = seen.get(d.file);
      if (!list) {
        out2.set(d.file, list = []);
        seen.set(d.file, dedupe = /* @__PURE__ */ new Set());
      }
      if (dedupe.has(name2) || list.length >= MAX_NAMES_PER_FILE) continue;
      dedupe.add(name2);
      list.push(name2);
    }
  }
  return out2;
}
var EXACT = 1e3;
var PREFIX = 100;
var SUBSTRING = 1;
var SOURCE = 0.5;
function lookupSymbols(index, graph, query) {
  const moduleOf = new Map(graph.files.map((f) => [f.rel, f.module]));
  const names = Object.keys(index.defs);
  let matches;
  if (index.defs[query]) {
    matches = [query];
  } else {
    let terms = keywords(query).map((t) => t.toLowerCase());
    if (terms.length === 0) terms = [foldText(query).toLowerCase()];
    const normLabels = names.map((n) => foldText(n).toLowerCase());
    const labelTokens = names.map((n) => splitIdentifier(n).join(" ").toLowerCase());
    const sourcePaths = names.map((n) => (index.defs[n] ?? []).map((d) => d.file.toLowerCase()));
    const N = names.length;
    const idf = /* @__PURE__ */ new Map();
    for (const t of terms) {
      const dfT = normLabels.reduce((c2, l) => c2 + (l.includes(t) ? 1 : 0), 0);
      idf.set(t, Math.log(1 + N / (1 + dfT)));
    }
    const joined = terms.join(" ");
    const maxIdf = Math.max(...terms.map((t) => idf.get(t) ?? 0)) || 1;
    const scored = [];
    for (let i2 = 0; i2 < names.length; i2++) {
      const normLabel = normLabels[i2];
      const label = labelTokens[i2];
      const paths = sourcePaths[i2];
      let score = 0;
      let tiered = 0;
      let matched = 0;
      if (joined === normLabel || joined === label) score += EXACT * 10 * maxIdf;
      else if (normLabel.startsWith(joined) || label.startsWith(joined)) score += PREFIX * 10 * maxIdf;
      for (const t of terms) {
        const w = idf.get(t) ?? 0;
        if (t === normLabel) {
          tiered += EXACT * w;
          matched++;
        } else if (normLabel.startsWith(t) || label.startsWith(t)) {
          tiered += PREFIX * w;
          matched++;
        } else if (normLabel.includes(t)) {
          score += SUBSTRING * w;
          matched++;
        }
        if (paths.some((p) => p.includes(t))) score += SOURCE * w;
      }
      score += tiered * (matched / terms.length) ** 2;
      if (score > 0) scored.push({ name: names[i2], score });
    }
    matches = scored.sort((a, b) => b.score - a.score || a.name.length - b.name.length || byStr(a.name, b.name)).slice(0, MAX_HITS).map((x) => x.name);
  }
  const hits = matches.map((name2) => ({
    name: name2,
    defs: (index.defs[name2] ?? []).map((d) => ({ ...d, module: moduleOf.get(d.file) ?? "root" })),
    refs: index.refs[name2] ?? []
  }));
  return { query, hits };
}
function runSymbols(outDir, query) {
  const graph = loadGraph(outDir);
  const index = loadSymbols(outDir);
  if (!graph || !index) return void 0;
  return lookupSymbols(index, graph, query);
}

// src/semantic.ts
function loadSemanticConfig(outDir) {
  const env = {
    baseUrl: process.env.ULTRAINDEX_EMBED_BASE_URL,
    model: process.env.ULTRAINDEX_EMBED_MODEL,
    apiKey: process.env.ULTRAINDEX_EMBED_API_KEY
  };
  let file = {};
  const raw = readIfExists(indexPaths(outDir).semantic);
  if (raw !== void 0) {
    try {
      file = JSON.parse(raw);
    } catch {
    }
  }
  const baseUrl = env.baseUrl || file.baseUrl;
  const model = env.model || file.model;
  if (!baseUrl || !model) return void 0;
  const apiKey = env.apiKey || file.apiKey;
  return { baseUrl, model, ...apiKey ? { apiKey } : {} };
}
function embeddingsUrl(baseUrl) {
  let base = baseUrl.replace(/\/+$/, "");
  if (!/\/v\d+$/.test(base)) base += "/v1";
  return base + "/embeddings";
}
var BATCH_SIZE = 32;
var TIMEOUT_MS = 3e4;
async function embedTexts(cfg, texts) {
  const url = embeddingsUrl(cfg.baseUrl);
  const out2 = [];
  for (let i2 = 0; i2 < texts.length; i2 += BATCH_SIZE) {
    const batch = texts.slice(i2, i2 + BATCH_SIZE);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}
        },
        body: JSON.stringify({ model: cfg.model, input: batch }),
        signal: controller.signal
      });
    } catch (e) {
      throw new Error(`embeddings provider unreachable at ${url}: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const body2 = clip(await res.text().catch(() => ""), 200);
      throw new Error(`embeddings provider returned ${res.status} for ${url}${body2 ? `: ${body2}` : ""}`);
    }
    const json = await res.json();
    const data = json.data;
    if (!Array.isArray(data) || data.length !== batch.length) {
      throw new Error(`embeddings provider returned ${data?.length ?? 0} vectors for ${batch.length} inputs`);
    }
    const rows = new Array(batch.length);
    data.forEach((d, j) => {
      const idx = typeof d.index === "number" ? d.index : j;
      if (!Array.isArray(d.embedding)) throw new Error("embeddings provider returned a row without an embedding");
      rows[idx] = d.embedding;
    });
    out2.push(...rows);
  }
  return out2;
}
var EMBED_TEXT_MAX = 4e3;
function moduleEmbedText(m, files, prose) {
  const members = files.slice().sort((a, b) => byStr(a.rel, b.rel)).map((f) => [f.rel, f.title, f.summary].filter(Boolean).join(" \u2014 "));
  const parts2 = [m.title, m.path, m.slug, m.summary, ...members, prose ?? ""];
  return clip(parts2.filter(Boolean).join("\n"), EMBED_TEXT_MAX);
}
function cosine(a, b) {
  if (a.length !== b.length || a.length === 0) return -1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i2 = 0; i2 < a.length; i2++) {
    dot += a[i2] * b[i2];
    na += a[i2] * a[i2];
    nb += b[i2] * b[i2];
  }
  if (na === 0 || nb === 0) return -1;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// src/vectors.ts
function loadVectors(outDir) {
  const raw = readIfExists(indexPaths(outDir).vectors);
  if (raw === void 0) return void 0;
  try {
    const v = JSON.parse(raw);
    return v.schemaVersion === SCHEMA_VERSION && v.vectors ? v : void 0;
  } catch {
    return void 0;
  }
}
function round6(v) {
  return v.map((x) => Number(x.toFixed(6)));
}
function saveVectors(outDir, store) {
  const sorted = {
    schemaVersion: store.schemaVersion,
    model: store.model,
    dim: store.dim,
    vectors: Object.fromEntries(
      Object.keys(store.vectors).sort(byStr).map((slug) => [slug, store.vectors[slug]])
    )
  };
  writeFileIfChanged(indexPaths(outDir).vectors, JSON.stringify(sorted, null, 2) + "\n");
}
function staleVectorSlugs(outDir, graph, store) {
  const prose = loadEnrichedProse(outDir, graph);
  const filesByModule = groupFiles(graph);
  const stale = [];
  for (const m of graph.modules) {
    const text = moduleEmbedText(m, filesByModule.get(m.slug) ?? [], prose.get(m.slug));
    const stored = store.vectors[m.slug];
    if (!stored || stored.hash !== sha1(text)) stale.push(m.slug);
  }
  return stale.sort(byStr);
}
function groupFiles(graph) {
  const byModule = /* @__PURE__ */ new Map();
  for (const f of graph.files) {
    let list = byModule.get(f.module);
    if (!list) byModule.set(f.module, list = []);
    list.push(f);
  }
  return byModule;
}
async function runEmbed(outDir, cfg, force = false) {
  const graph = loadGraph(outDir);
  if (!graph) return void 0;
  const prior = loadVectors(outDir);
  const reusable = !force && prior && prior.model === cfg.model ? prior.vectors : {};
  const prose = loadEnrichedProse(outDir, graph);
  const filesByModule = groupFiles(graph);
  const modules = graph.modules.slice().sort((a, b) => byStr(a.slug, b.slug));
  const next = { schemaVersion: SCHEMA_VERSION, model: cfg.model, dim: prior?.model === cfg.model ? prior.dim : 0, vectors: {} };
  const toEmbed = [];
  let reused = 0;
  for (const m of modules) {
    const text = moduleEmbedText(m, filesByModule.get(m.slug) ?? [], prose.get(m.slug));
    const hash = sha1(text);
    const stored = reusable[m.slug];
    if (stored && stored.hash === hash) {
      next.vectors[m.slug] = stored;
      reused++;
    } else {
      toEmbed.push({ slug: m.slug, hash, text });
    }
  }
  if (toEmbed.length) {
    const vectors = await embedTexts(cfg, toEmbed.map((t) => t.text));
    const dim = vectors[0]?.length ?? 0;
    if (next.dim && dim !== next.dim) {
      return runEmbed(outDir, cfg, true);
    }
    next.dim = dim;
    toEmbed.forEach((t, i2) => {
      next.vectors[t.slug] = { hash: t.hash, v: round6(vectors[i2]) };
    });
  }
  const removed = prior ? Object.keys(prior.vectors).filter((slug) => !(slug in next.vectors)).length : 0;
  saveVectors(outDir, next);
  return {
    model: cfg.model,
    dim: next.dim,
    total: graph.modules.length,
    embedded: toEmbed.length,
    reused,
    removed
  };
}

// src/find.ts
var DEFAULT_K = 8;
var MAX_FILES = 8;
var MIN_COSINE = 0.25;
function moduleNeighbors(graph, slug) {
  const ns = [
    ...graph.moduleEdges.filter((e) => e.from === slug).map((e) => e.to),
    ...graph.moduleEdges.filter((e) => e.to === slug).map((e) => e.from)
  ];
  return [...new Set(ns)].sort(byStr).slice(0, 8);
}
function textOf(parts2) {
  return parts2.filter(Boolean).join(" ").toLowerCase();
}
var PROSE_WEIGHT = 1.5;
function loadEnrichedProse(outDir, graph) {
  const enc = indexPaths(outDir).encyclopedia;
  const out2 = /* @__PURE__ */ new Map();
  for (const m of graph.modules) {
    const text = readIfExists(join8(enc, `${m.slug}.md`));
    if (!text) continue;
    const bodies = [...humanBodies(text).values()].filter(isEnrichedBody);
    if (!bodies.length) continue;
    out2.set(m.slug, bodies.join(" ").replace(/\[[^\]]*\]/g, " ").toLowerCase());
  }
  return out2;
}
function scoreModules(graph, query, prose, symbolNames) {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const namesOf = (rel) => (symbolNames?.get(rel) ?? []).join(" ");
  const filesByModule = /* @__PURE__ */ new Map();
  for (const f of graph.files) {
    let list = filesByModule.get(f.module);
    if (!list) filesByModule.set(f.module, list = []);
    list.push(f);
  }
  const moduleSummary = (m) => (
    // A structural-fallback summary ("N file(s) in `path/`…") just echoes the
    // path — never count it as lexical content.
    /^\d+ file\(s\) in /.test(m.summary) ? void 0 : m.summary
  );
  const N = graph.modules.length;
  const df = /* @__PURE__ */ new Map();
  for (const m of graph.modules) {
    const members = filesByModule.get(m.slug) ?? [];
    const combined = textOf([m.slug, m.path, moduleSummary(m)]) + " " + (prose?.get(m.slug) ?? "") + " " + // Must fold in the SAME symbol names as the scored haystacks, or df/idf
    // would drift from what's actually scored below.
    members.map((f) => textOf([f.rel, f.title, f.summary, namesOf(f.rel)])).join(" ");
    for (const raw of new Set(scoreHaystack(buildHaystack(combined), terms).matched)) {
      df.set(raw, (df.get(raw) ?? 0) + 1);
    }
  }
  const idf = /* @__PURE__ */ new Map();
  for (const t of terms) {
    const d = df.get(t.raw) ?? 0;
    idf.set(t.raw, Math.min(2, Math.max(0.5, 1 + Math.log((N + 1) / (d + 1)))));
  }
  const joined = terms.map((t) => t.exact).join(" ");
  const maxIdf = Math.max(1, ...terms.map((t) => idf.get(t.raw) ?? 1));
  const scored = [];
  for (const m of graph.modules) {
    const members = filesByModule.get(m.slug) ?? [];
    const summary = moduleSummary(m);
    const moduleHay = textOf([m.slug, m.path, summary]);
    const mod = scoreHaystack(buildHaystack(moduleHay), terms, false, idf);
    const enrichedText = prose?.get(m.slug);
    const pro = enrichedText ? scoreHaystack(buildHaystack(enrichedText), terms, true, idf) : { score: 0, matched: [] };
    const scoredFiles = members.map((f) => {
      const hay = textOf([f.rel, f.title, f.summary, namesOf(f.rel)]);
      const s = scoreHaystack(buildHaystack(hay), terms, false, idf);
      return { f, score: s.score, matched: s.matched, degree: f.degIn + f.degOut };
    }).sort((a, b) => b.score - a.score || b.degree - a.degree || byStr(a.f.rel, b.f.rel));
    const bestFile = scoredFiles[0]?.score ?? 0;
    const matchCount = scoredFiles.filter((x) => x.score > 0).length;
    if (mod.score === 0 && bestFile === 0 && pro.score === 0) continue;
    const matchedTerms = /* @__PURE__ */ new Set([...mod.matched, ...pro.matched, ...scoredFiles.flatMap((x) => x.matched)]);
    const coverageWeight = 0.4 + 0.6 * (matchedTerms.size / terms.length) ** 2;
    const tierWeight = m.tier === 2 ? 0.45 : 1;
    const pathPenalty = /(^|\/|-|_)(tests?|demo|examples?|sandbox|stub|mock|fixtures?)(\/|-|_|$)/i.test(m.path) ? 0.55 : 1;
    const leaf = m.path.split("/").pop() ?? "";
    const genericPenalty = /^(stores?|components?|types?|utils?|hooks?|constants?|helpers?|styles?|assets?|queries|state)$/i.test(leaf) ? 0.8 : 1;
    const labels = [
      splitIdentifier(m.slug).join(" "),
      splitIdentifier(m.path).join(" "),
      ...members.map((f) => splitIdentifier(basename3(f.rel, extname2(f.rel))).join(" ")),
      // An exported symbol name whose token form IS the whole query is as strong
      // a label as a matching basename — a query naming a function should lift its
      // module the same way its filename would.
      ...members.flatMap((f) => (symbolNames?.get(f.rel) ?? []).map((n) => splitIdentifier(n).join(" ")))
    ];
    const fullQuery = labels.some((l) => l === joined) ? 10 * maxIdf : labels.some((l) => l.startsWith(joined)) ? 4 * maxIdf : 0;
    const keywordScore = mod.score * 2 + pro.score * PROSE_WEIGHT + bestFile + Math.min(matchCount, 5) * 0.5 + fullQuery;
    const total = keywordScore * tierWeight * pathPenalty * genericPenalty * coverageWeight + Math.min(m.degIn + m.degOut, 5) * 0.25;
    const matched = [...matchedTerms].sort(byStr);
    let files = scoredFiles.filter((x) => x.score > 0).map((x) => x.f.rel);
    if (files.length === 0) {
      files = members.slice().sort((a, b) => b.degIn + b.degOut - (a.degIn + a.degOut) || byStr(a.rel, b.rel)).map((f) => f.rel);
    }
    scored.push({
      degree: m.degIn + m.degOut,
      r: {
        slug: m.slug,
        path: m.path,
        title: m.title,
        tier: m.tier,
        score: Number(total.toFixed(3)),
        matched,
        files: files.slice(0, MAX_FILES),
        neighbors: moduleNeighbors(graph, m.slug),
        enriched: enrichedText !== void 0
      }
    });
  }
  scored.sort((a, b) => b.r.score - a.r.score || b.degree - a.degree || byStr(a.r.slug, b.r.slug));
  return scored;
}
var MAX_SEEDS = 3;
var SEED_GAP_RATIO = 0.2;
function pickSeeds(scored, terms) {
  if (scored.length === 0) return [];
  const topScore = scored[0].r.score;
  const seeds = [];
  const picked = /* @__PURE__ */ new Set();
  const matchedBySlug = new Map(scored.map((s) => [s.r.slug, s.r.matched]));
  for (const s of scored) {
    if (seeds.length >= MAX_SEEDS) break;
    if (s.r.score < SEED_GAP_RATIO * topScore) break;
    seeds.push(s.r.slug);
    picked.add(s.r.slug);
  }
  for (const t of terms) {
    if (seeds.some((slug) => matchedBySlug.get(slug)?.includes(t.raw))) continue;
    const hit = scored.find((s) => s.r.matched.includes(t.raw));
    if (hit && !picked.has(hit.r.slug)) {
      seeds.push(hit.r.slug);
      picked.add(hit.r.slug);
    }
  }
  return seeds;
}
var EXPAND_DEPTH = 2;
var HUB_FLOOR = 50;
function hubThreshold(degrees) {
  const sorted = degrees.slice().sort((a, b) => a - b);
  const n = sorted.length;
  const p99 = n === 0 ? 0 : sorted[Math.min(n - 1, Math.floor(0.99 * n))];
  return Math.max(HUB_FLOOR, p99);
}
function expandResults(graph, top, fullScored, seeds, k, enrichedSlugs) {
  const cap = k + 4;
  const out2 = [...top];
  const present = new Set(out2.map((r) => r.slug));
  const rowBySlug = new Map(fullScored.map((s) => [s.r.slug, s.r]));
  const moduleBySlug = new Map(graph.modules.map((m) => [m.slug, m]));
  const degreeOf = (slug) => {
    const m = moduleBySlug.get(slug);
    return m ? m.degIn + m.degOut : 0;
  };
  for (const slug of seeds) {
    if (out2.length >= cap) break;
    if (present.has(slug)) continue;
    const r = rowBySlug.get(slug);
    if (!r) continue;
    out2.push({ ...r, via: "term" });
    present.add(slug);
  }
  const threshold = hubThreshold(graph.modules.map((m) => m.degIn + m.degOut));
  const adj = /* @__PURE__ */ new Map();
  const link = (a, b) => {
    let s = adj.get(a);
    if (!s) adj.set(a, s = /* @__PURE__ */ new Set());
    s.add(b);
  };
  for (const e of graph.moduleEdges) {
    if (e.dangling) continue;
    if (!moduleBySlug.has(e.from) || !moduleBySlug.has(e.to)) continue;
    link(e.from, e.to);
    link(e.to, e.from);
  }
  const seedSet = new Set(seeds);
  const depth = /* @__PURE__ */ new Map();
  const queue = [];
  for (const s of [...seeds].sort(byStr)) {
    if (!moduleBySlug.has(s) || depth.has(s)) continue;
    depth.set(s, 0);
    queue.push({ slug: s, d: 0 });
  }
  for (let i2 = 0; i2 < queue.length; i2++) {
    const { slug, d } = queue[i2];
    const expand = d < EXPAND_DEPTH && (seedSet.has(slug) || degreeOf(slug) < threshold);
    if (!expand) continue;
    for (const nb of [...adj.get(slug) ?? []].sort(byStr)) {
      if (depth.has(nb)) continue;
      depth.set(nb, d + 1);
      queue.push({ slug: nb, d: d + 1 });
    }
  }
  const filesByModule = /* @__PURE__ */ new Map();
  for (const f of graph.files) {
    let list = filesByModule.get(f.module);
    if (!list) filesByModule.set(f.module, list = []);
    list.push(f);
  }
  const discovered = [...depth.entries()].filter(([, d]) => d >= 1).sort((a, b) => a[1] - b[1] || degreeOf(b[0]) - degreeOf(a[0]) || byStr(a[0], b[0]));
  for (const [slug] of discovered) {
    if (out2.length >= cap) break;
    if (present.has(slug)) continue;
    const m = moduleBySlug.get(slug);
    if (!m) continue;
    out2.push({ ...bareRow(graph, m, filesByModule.get(slug) ?? [], enrichedSlugs?.has(slug) ?? false), via: "graph" });
    present.add(slug);
  }
  return out2.slice(0, cap);
}
function loadSymbolNames(outDir) {
  const index = loadSymbols(outDir);
  return index ? exportedNamesByFile(index) : void 0;
}
function bareRow(graph, m, members, enriched) {
  const files = members.slice().sort((a, b) => b.degIn + b.degOut - (a.degIn + a.degOut) || byStr(a.rel, b.rel)).map((f) => f.rel).slice(0, MAX_FILES);
  return {
    slug: m.slug,
    path: m.path,
    title: m.title,
    tier: m.tier,
    score: 0,
    matched: [],
    files,
    neighbors: moduleNeighbors(graph, m.slug),
    enriched
  };
}
async function runFindHybrid(outDir, query, k = DEFAULT_K) {
  const graph = loadGraph(outDir);
  if (!graph) return void 0;
  const prose = loadEnrichedProse(outDir, graph);
  const pool = Math.max(k * 3, 24);
  const full = scoreModules(graph, query, prose, loadSymbolNames(outDir));
  const lexical = full.slice(0, pool).map((x) => x.r);
  const seeds = pickSeeds(full, queryTerms(query));
  const expand = (topRows) => expandResults(graph, topRows, full, seeds, k, new Set(prose.keys()));
  const store = loadVectors(outDir);
  if (!store) return { results: expand(lexical.slice(0, k)), semantic: false };
  const lexOnly = (warning) => ({ results: expand(lexical.slice(0, k)), semantic: false, warning });
  const cfg = loadSemanticConfig(outDir);
  if (!cfg) {
    return lexOnly("vectors.json present but no semantic config (env or semantic.json) \u2014 lexical-only results");
  }
  let queryVector;
  try {
    const [v] = await embedTexts(cfg, [query]);
    queryVector = v;
  } catch (e) {
    return lexOnly(`semantic provider unavailable (${e.message}) \u2014 lexical-only results`);
  }
  if (queryVector.length !== store.dim) {
    return lexOnly(`query embedding dim ${queryVector.length} != vectors.json dim ${store.dim} (model changed?) \u2014 re-run \`ultraindex embed\`; lexical-only results`);
  }
  const moduleBySlug = new Map(graph.modules.map((m) => [m.slug, m]));
  const semanticSlugs = Object.entries(store.vectors).filter(([slug]) => moduleBySlug.has(slug)).map(([slug, rec]) => ({ slug, cos: cosine(queryVector, rec.v) })).filter((s) => s.cos >= MIN_COSINE).sort((a, b) => b.cos - a.cos || byStr(a.slug, b.slug)).slice(0, pool).map((s) => s.slug);
  const lexicalSlugs = lexical.map((r) => r.slug);
  const fused = rrf([lexicalSlugs, semanticSlugs], (s) => s);
  const lexRank = new Map(lexicalSlugs.map((s, i2) => [s, i2]));
  const semRank = new Map(semanticSlugs.map((s, i2) => [s, i2 + 1]));
  const ordered = [...fused.entries()].sort((a, b) => b[1] - a[1] || (lexRank.get(a[0]) ?? 1e9) - (lexRank.get(b[0]) ?? 1e9) || byStr(a[0], b[0])).slice(0, k).map(([slug]) => slug);
  const lexRow = new Map(lexical.map((r) => [r.slug, r]));
  const filesByModule = /* @__PURE__ */ new Map();
  for (const f of graph.files) {
    let list = filesByModule.get(f.module);
    if (!list) filesByModule.set(f.module, list = []);
    list.push(f);
  }
  const fusedTop = ordered.map((slug) => {
    const sem = semRank.get(slug);
    const row2 = lexRow.get(slug) ?? bareRow(graph, moduleBySlug.get(slug), filesByModule.get(slug) ?? [], prose.has(slug));
    return sem !== void 0 ? { ...row2, semanticRank: sem } : row2;
  });
  return { results: expand(fusedTop), semantic: true };
}

// src/neighbors.ts
function bfs(edges, start2, depth, kinds) {
  const out2 = /* @__PURE__ */ new Map();
  const inn = /* @__PURE__ */ new Map();
  const degree3 = /* @__PURE__ */ new Map();
  for (const e of edges) {
    if (e.dangling) continue;
    if (kinds && !kinds.has(e.kind)) continue;
    (out2.get(e.from) ?? out2.set(e.from, []).get(e.from)).push(e);
    (inn.get(e.to) ?? inn.set(e.to, []).get(e.to)).push(e);
    degree3.set(e.from, (degree3.get(e.from) ?? 0) + 1);
    degree3.set(e.to, (degree3.get(e.to) ?? 0) + 1);
  }
  const threshold = hubThreshold([...degree3.values()]);
  const seen = /* @__PURE__ */ new Set([start2]);
  const links = [];
  let frontier = [start2];
  for (let d = 1; d <= depth; d++) {
    const next = [];
    for (const node of frontier) {
      if (node !== start2 && (degree3.get(node) ?? 0) >= threshold) continue;
      for (const e of (out2.get(node) ?? []).slice().sort((a, b) => byStr(a.to, b.to))) {
        if (seen.has(e.to)) continue;
        links.push({ node: e.to, direction: "out", kind: e.kind, weight: e.weight, depth: d, confidence: e.confidence });
        seen.add(e.to);
        next.push(e.to);
      }
      for (const e of (inn.get(node) ?? []).slice().sort((a, b) => byStr(a.from, b.from))) {
        if (seen.has(e.from)) continue;
        links.push({ node: e.from, direction: "in", kind: e.kind, weight: e.weight, depth: d, confidence: e.confidence });
        seen.add(e.from);
        next.push(e.from);
      }
    }
    frontier = next;
  }
  return links;
}
function neighborsOf(graph, target, depth = 1, kinds) {
  const mod = graph.modules.find((m) => m.slug === target);
  if (mod) {
    return { target, scope: "module", links: bfs(graph.moduleEdges, target, depth, kinds), members: mod.members };
  }
  const file = graph.files.find((f) => f.rel === target);
  if (file) {
    return { target, scope: "file", links: bfs(graph.fileEdges, target, depth, kinds) };
  }
  return void 0;
}
function runNeighbors(outDir, target, depth = 1, kinds) {
  const graph = loadGraph(outDir);
  if (!graph) return void 0;
  return neighborsOf(graph, target, depth, kinds);
}

// src/impact.ts
function reverseClosure(edges, seeds, depth) {
  const dependents = /* @__PURE__ */ new Map();
  for (const e of edges) {
    if (e.dangling || e.kind !== "import" && e.kind !== "use" && e.kind !== "call") continue;
    let arr = dependents.get(e.to);
    if (!arr) dependents.set(e.to, arr = []);
    arr.push(e);
  }
  const depthOf = /* @__PURE__ */ new Map();
  const seen = new Set(seeds);
  let frontier = [...seeds];
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next = [];
    for (const node of frontier) {
      for (const e of (dependents.get(node) ?? []).slice().sort((a, b) => byStr(a.from, b.from))) {
        if (seen.has(e.from)) continue;
        seen.add(e.from);
        depthOf.set(e.from, d);
        next.push(e.from);
      }
    }
    frontier = next;
  }
  return depthOf;
}
function impactOf(graph, target, depth = Infinity) {
  const moduleOf = new Map(graph.files.map((f) => [f.rel, f.module]));
  const mod = graph.modules.find((m) => m.slug === target);
  const file = mod ? void 0 : graph.files.find((f) => f.rel === target);
  if (!mod && !file) return void 0;
  const seeds = mod ? mod.members : [file.rel];
  const depthOf = reverseClosure(graph.fileEdges, seeds, depth);
  const files = [...depthOf.entries()].map(([rel, d]) => ({ rel, module: moduleOf.get(rel) ?? "root", depth: d })).sort((a, b) => a.depth - b.depth || byStr(a.rel, b.rel));
  const modules = [...new Set(files.map((f) => f.module).filter((m) => m !== target))].sort(byStr);
  return { target, scope: mod ? "module" : "file", seeds, files, modules };
}
function runImpact(outDir, target, depth = Infinity) {
  const graph = loadGraph(outDir);
  if (!graph) return void 0;
  return impactOf(graph, target, depth);
}

// src/mapcmd.ts
import { join as join9 } from "path";
function runMap(outDir, moduleSlug) {
  const paths = indexPaths(outDir);
  if (moduleSlug) {
    return readIfExists(join9(paths.encyclopedia, `${moduleSlug}.md`));
  }
  return readIfExists(paths.index);
}

// src/status.ts
import { join as join10 } from "path";
function runStatus(outDir) {
  const graph = loadGraph(outDir);
  if (!graph) return void 0;
  const enc = indexPaths(outDir).encyclopedia;
  const modules = graph.modules.map((m) => {
    let total = 0;
    let filled = 0;
    const text = readIfExists(join10(enc, `${m.slug}.md`));
    if (text) {
      const parsed = parseRegions(text);
      if (parsed.ok) {
        for (const r of parsed.regions) {
          if (r.type !== "human") continue;
          total++;
          if (isEnrichedBody(r.body)) filled++;
        }
      }
    }
    return {
      slug: m.slug,
      path: m.path,
      tier: m.tier,
      degree: m.degIn + m.degOut,
      enriched: filled > 0,
      regions: { enriched: filled, total }
    };
  });
  modules.sort(
    (a, b) => Number(a.enriched) - Number(b.enriched) || // work first, done last
    Number(a.tier === 2) - Number(b.tier === 2) || // tail enriches last
    b.degree - a.degree || // most-connected first
    byStr(a.slug, b.slug)
  );
  const enriched = modules.filter((m) => m.enriched).length;
  return {
    enriched,
    total: modules.length,
    suggestedNext: modules.filter((m) => !m.enriched).slice(0, 5).map((m) => m.slug),
    modules
  };
}

// src/check.ts
import { dirname as dirname4, join as join12 } from "path";

// src/verify.ts
import { existsSync as existsSync3, readFileSync as readFileSync4, writeFileSync as writeFileSync2 } from "fs";
import { dirname as dirname3, join as join11 } from "path";

// src/cite.ts
var EXT_TOKEN = /\[((?:[^[\]\n]|\[(?:[^[\]\n]|\[[^\]\n]*\])*\])*?\.[A-Za-z0-9]{1,8}(?::\d+(?:-\d+)?)?)\]/g;
var SIMPLE_TOKEN = /\[([^[\]\n]+)\]/g;
var LINE_SUFFIX = /:(\d+)(?:-(\d+))?$/;
function looksLikePath(s) {
  return /\//.test(s) || /\.[A-Za-z0-9]{1,8}(:\d|$)/.test(s);
}
function stripNonProse(text) {
  return text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " ")).replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, " ")).replace(/~~~[\s\S]*?~~~/g, (m) => m.replace(/[^\n]/g, " ")).replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length)).replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, (m, t) => looksLikePath(t.trim()) ? m : " ".repeat(m.length));
}
function parseCitations(text) {
  const prose = stripNonProse(text);
  const out2 = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (rawIn) => {
    const raw = rawIn.trim().replace(/[.,;]+$/, "");
    if (!looksLikePath(raw) || seen.has(raw)) return;
    seen.add(raw);
    let path = raw;
    let start2;
    let end;
    const ls = LINE_SUFFIX.exec(raw);
    if (ls) {
      path = raw.slice(0, ls.index);
      start2 = Number(ls[1]);
      end = ls[2] ? Number(ls[2]) : void 0;
    }
    if (path) out2.push({ raw, path, start: start2, end });
  };
  let m;
  EXT_TOKEN.lastIndex = 0;
  while (m = EXT_TOKEN.exec(prose)) add(m[1]);
  SIMPLE_TOKEN.lastIndex = 0;
  while (m = SIMPLE_TOKEN.exec(prose)) add(m[1]);
  return out2;
}
function checkCitations(text, fileLines) {
  const resolved = [];
  const unresolved = [];
  for (const c2 of parseCitations(text)) {
    const lines = fileLines.get(c2.path);
    if (lines === void 0) {
      if (c2.path.includes("/")) unresolved.push({ citation: c2, reason: "no such file in the index" });
      continue;
    }
    if (c2.start !== void 0 && (c2.start < 1 || c2.start > lines)) {
      unresolved.push({ citation: c2, reason: `line ${c2.start} out of range (1-${lines})` });
      continue;
    }
    if (c2.end !== void 0 && (c2.end < (c2.start ?? 1) || c2.end > lines)) {
      unresolved.push({ citation: c2, reason: `line range ${c2.start}-${c2.end} out of range (1-${lines})` });
      continue;
    }
    resolved.push(c2);
  }
  return { ok: unresolved.length === 0, resolved, unresolved };
}
function fileLineTable(graph) {
  return new Map(graph.files.map((f) => [f.rel, f.lines]));
}

// src/verify.ts
var VERIFY_MAX = 40;
var VALID_VERDICTS = ["supported", "partial", "refuted", "unsupported"];
function stripHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
}
function stripInlineCode(line) {
  return line.replace(/`[^`\n]*`/g, " ");
}
function stripInlineCodeText(line) {
  return line.replace(/`([^`\n]*)`/g, "$1");
}
function codeMask(lines) {
  const mask = new Array(lines.length).fill(false);
  let inFence = false;
  for (let i2 = 0; i2 < lines.length; i2++) {
    if (/^\s*(```|~~~)/.test(lines[i2])) {
      mask[i2] = true;
      inFence = !inFence;
      continue;
    }
    mask[i2] = inFence;
  }
  return mask;
}
function isHeadingOrRule(t) {
  return /^#{1,6}\s/.test(t) || /^([-*_])\1{2,}$/.test(t);
}
function isTableSep(line) {
  return /\|/.test(line) && /^[\s:|-]+$/.test(line.trim()) && /-/.test(line);
}
function isTableRow(line) {
  return /\|/.test(line.trim()) && !isTableSep(line);
}
function tableCells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c2) => c2.trim()).join(" ");
}
function isListItem(line) {
  return /^\s*([-*+]|\d+\.)\s+\S/.test(line);
}
function extractClaimUnits(text) {
  const lines = stripHtmlComments(text).split("\n");
  const code = codeMask(lines);
  const units = [];
  let prose = [];
  let proseD = [];
  const flush = () => {
    if (prose.length) units.push({ kind: "text", text: prose.join(" "), display: proseD.join(" ") });
    prose = [];
    proseD = [];
  };
  let i2 = 0;
  while (i2 < lines.length) {
    if (code[i2]) {
      flush();
      i2++;
      continue;
    }
    const line = stripInlineCode(lines[i2]);
    const lineD = stripInlineCodeText(lines[i2]);
    const t = line.trim();
    if (t === "" || isHeadingOrRule(t) || isTableSep(line)) {
      flush();
      i2++;
      continue;
    }
    if (isTableRow(line)) {
      flush();
      units.push({ kind: "text", text: tableCells(line), display: tableCells(lineD) });
      i2++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const dq = line.replace(/^\s*>\s?/, "").trim();
      const dqD = lineD.replace(/^\s*>\s?/, "").trim();
      if (dq) {
        prose.push(dq);
        proseD.push(dqD || dq);
      }
      i2++;
      continue;
    }
    if (isListItem(line)) {
      flush();
      const items = [];
      const itemsD = [];
      while (i2 < lines.length && !code[i2]) {
        const l = stripInlineCode(lines[i2]);
        const lD = stripInlineCodeText(lines[i2]);
        const tt = l.trim();
        const ttD = lD.trim();
        if (tt === "" || isHeadingOrRule(tt) || isTableSep(l) || isTableRow(l)) break;
        if (isListItem(l)) {
          items.push(l.replace(/^\s*([-*+]|\d+\.)\s+/, "").trim());
          itemsD.push(lD.replace(/^\s*([-*+]|\d+\.)\s+/, "").trim());
        } else if (items.length) {
          items[items.length - 1] += " " + tt;
          itemsD[itemsD.length - 1] += " " + ttD;
        } else {
          items.push(tt);
          itemsD.push(ttD);
        }
        i2++;
      }
      units.push({ kind: "list", items, itemsD });
      continue;
    }
    prose.push(line);
    proseD.push(lineD);
    i2++;
  }
  flush();
  return units;
}
function claimPairs(text) {
  const out2 = [];
  for (const u of extractClaimUnits(text)) {
    if (u.kind === "text") out2.push({ parse: u.text, display: u.display });
    else for (let j = 0; j < u.items.length; j++) out2.push({ parse: u.items[j], display: u.itemsD[j] ?? u.items[j] });
  }
  return out2;
}
function readExcerpt(repo, c2) {
  let full;
  try {
    full = readFileSync4(join11(repo, c2.path), "utf8");
  } catch {
    return "";
  }
  const lines = full.split("\n");
  if (c2.start === void 0) return lines.slice(0, 40).join("\n").slice(0, 800).trim();
  const s = Math.max(1, c2.start) - 1;
  const e = Math.max(c2.start, c2.end ?? c2.start);
  return lines.slice(s, e).join("\n").slice(0, 800).trim();
}
function buildClaimPairs(answerText, repo) {
  const pairs = [];
  let claimNo = 0;
  for (const { parse, display } of claimPairs(answerText)) {
    const cites = parseCitations(parse);
    if (!cites.length) continue;
    claimNo++;
    const claimId = `C${claimNo}`;
    const claimText = display.replace(/\s+/g, " ").trim().slice(0, 400);
    for (const c2 of cites) {
      const digest = readExcerpt(repo, c2);
      if (!digest) continue;
      pairs.push({ claimId, claim: claimText, citation: c2.raw, path: c2.path, digest });
    }
  }
  return pairs;
}
function runVerify(answerPath, repo, opts = {}) {
  const answer = readFileSync4(answerPath, "utf8");
  const pairs = buildClaimPairs(answer, repo);
  const max = Math.max(1, Math.floor(opts.maxVerify ?? VERIFY_MAX));
  const kept = pairs.length > max ? pairs.slice(0, max) : pairs;
  const worklist = { answer: answerPath, pairs: kept };
  const dir = dirname3(answerPath);
  const todo = { answer: answerPath, pairs: kept.map((p) => ({ ...p, verdict: null, note: "" })) };
  writeFileSync2(join11(dir, "VERIFY.todo.json"), JSON.stringify(todo, null, 2));
  writeFileSync2(join11(dir, "VERIFY.md"), renderWorklistMd(worklist, pairs.length, kept.length));
  return worklist;
}
function renderWorklistMd(wl, total, kept) {
  const out2 = [];
  out2.push(`# Verification worklist`);
  out2.push("");
  out2.push(
    `For each pair, open the cited excerpt and judge whether it **supports** the claim. In \`VERIFY.todo.json\`, set each \`verdict\` to one of supported \xB7 partial \xB7 refuted \xB7 unsupported, add a short \`note\`, save it (e.g. as \`verdicts.json\`), then run \`ultraindex verify --apply verdicts.json --answer <file>\`.`
  );
  if (kept < total) out2.push(`
_Showing ${kept} of ${total} pair(s) \u2014 capped._`);
  out2.push("");
  for (const p of wl.pairs) {
    out2.push(`## ${p.claimId} \xB7 ${p.citation}`);
    out2.push(`**Claim:** ${p.claim}`);
    out2.push("```");
    out2.push(p.digest);
    out2.push("```");
    out2.push(`**Verdict:** _____ \xB7 **Note:** _____`);
    out2.push("");
  }
  return out2.join("\n");
}
function loadTodoPairs(dir) {
  const p = join11(dir, "VERIFY.todo.json");
  if (!existsSync3(p)) return void 0;
  let todo;
  try {
    todo = JSON.parse(readFileSync4(p, "utf8"));
  } catch {
    return void 0;
  }
  const pairs = Array.isArray(todo?.pairs) ? todo.pairs : [];
  const map = /* @__PURE__ */ new Map();
  for (const p2 of pairs) {
    if (!p2 || typeof p2.claimId !== "string" || typeof p2.citation !== "string") continue;
    map.set(`${p2.claimId}\0${p2.citation}`, {
      claimId: p2.claimId,
      claim: typeof p2.claim === "string" ? p2.claim : "",
      citation: p2.citation,
      path: typeof p2.path === "string" ? p2.path : "",
      digest: typeof p2.digest === "string" ? p2.digest : ""
    });
  }
  return map;
}
function applyVerdicts(dir, verdictsPath) {
  let raw;
  try {
    raw = JSON.parse(readFileSync4(verdictsPath, "utf8"));
  } catch (e) {
    throw new Error(`verdicts file is not valid JSON (${e.message})`);
  }
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.pairs) ? raw.pairs : [];
  const todoPairs = loadTodoPairs(dir);
  const backfill = (row2, field, src) => {
    if (typeof row2[field] === "string" && row2[field] !== "") return row2[field];
    return src ? src[field] : "";
  };
  const verdicts = [];
  const errors = [];
  list.forEach((v, i2) => {
    if (!v || typeof v.claimId !== "string" || typeof v.citation !== "string") {
      errors.push(`entry ${i2}: missing "claimId" and/or "citation"`);
      return;
    }
    if (!VALID_VERDICTS.includes(v.verdict)) {
      errors.push(`${v.claimId} (${v.citation}): invalid verdict ${JSON.stringify(v.verdict)} \u2014 use exactly one of ${VALID_VERDICTS.join(", ")}`);
      return;
    }
    const src = todoPairs?.get(`${v.claimId}\0${v.citation}`);
    verdicts.push({
      claimId: v.claimId,
      claim: backfill(v, "claim", src),
      citation: v.citation,
      path: backfill(v, "path", src),
      digest: backfill(v, "digest", src),
      verdict: v.verdict,
      note: typeof v.note === "string" ? v.note : ""
    });
  });
  if (errors.length) {
    throw new Error(`verdicts file has ${errors.length} problem(s):
  - ${errors.join("\n  - ")}`);
  }
  const result = reduceVerdicts(verdicts);
  writeFileSync2(join11(dir, "VERIFY.json"), JSON.stringify({ ...result, verdicts }, null, 2));
  return result;
}
function citationlessClaims(text) {
  const out2 = [];
  const substantive = (masked) => masked.trim().replace(/\s+/g, " ").length > 15;
  for (const u of extractClaimUnits(text)) {
    if (u.kind === "text") {
      if (substantive(u.text) && parseCitations(u.text).length === 0) out2.push(u.display.trim());
    } else {
      for (let i2 = 0; i2 < u.items.length; i2++) {
        if (substantive(u.items[i2]) && parseCitations(u.items[i2]).length === 0) out2.push(u.itemsD[i2].trim());
      }
    }
  }
  return out2;
}
function revalidateVerdicts(verdicts, repo) {
  const out2 = [];
  for (const v of verdicts) {
    const c2 = parseCitations(`[${v.citation}]`)[0];
    if (!c2) {
      out2.push({ claimId: v.claimId, citation: v.citation, reason: "citation is unparseable" });
      continue;
    }
    const live = readExcerpt(repo, c2);
    if (!live) {
      out2.push({ claimId: v.claimId, citation: v.citation, reason: "cited file is missing or empty in the repo" });
    } else if (live !== v.digest) {
      out2.push({ claimId: v.claimId, citation: v.citation, reason: "cited excerpt no longer matches the repo" });
    }
  }
  return out2;
}
function reduceVerdicts(verdicts) {
  const counts = { supported: 0, partial: 0, refuted: 0, unsupported: 0 };
  for (const v of verdicts) if (v.verdict && counts[v.verdict] !== void 0) counts[v.verdict]++;
  const byClaim = /* @__PURE__ */ new Map();
  for (const v of verdicts) {
    const g = byClaim.get(v.claimId) ?? [];
    g.push(v);
    byClaim.set(v.claimId, g);
  }
  const failures = [];
  const unadjudicated = [];
  for (const [claimId, group] of byClaim) {
    const adjudicated = group.filter((g) => !!g.verdict);
    if (adjudicated.length < group.length) unadjudicated.push(claimId);
    const refuted = adjudicated.find((g) => g.verdict === "refuted");
    const hasSupport = adjudicated.some((g) => g.verdict === "supported" || g.verdict === "partial");
    if (refuted) {
      failures.push({ claimId, citation: refuted.citation, verdict: "refuted", note: refuted.note });
    } else if (adjudicated.length === group.length && adjudicated.length > 0 && !hasSupport) {
      const u = adjudicated.find((g) => g.verdict === "unsupported") ?? adjudicated[0];
      failures.push({ claimId, citation: u.citation, verdict: u.verdict, note: u.note });
    }
  }
  return {
    ok: failures.length === 0,
    pairs: verdicts.length,
    adjudicated: verdicts.filter((v) => !!v.verdict).length,
    supported: counts.supported,
    partial: counts.partial,
    refuted: counts.refuted,
    unsupported: counts.unsupported,
    failures,
    unadjudicated
  };
}
function loadVerify(dir) {
  const p = join11(dir, "VERIFY.json");
  if (!existsSync3(p)) return void 0;
  try {
    return JSON.parse(readFileSync4(p, "utf8"));
  } catch {
    return void 0;
  }
}
function formatVerifyReport(r) {
  const lines = [];
  lines.push(`ultraindex verify: ${r.adjudicated}/${r.pairs} pair(s) adjudicated`);
  lines.push(`  supported: ${r.supported} \xB7 partial: ${r.partial} \xB7 refuted: ${r.refuted} \xB7 unsupported: ${r.unsupported}`);
  for (const f of r.failures.slice(0, 12)) lines.push(`  \u2717 ${f.claimId} (${f.citation}): ${f.verdict}${f.note ? " \u2014 " + f.note : ""}`);
  if (r.unadjudicated.length) lines.push(`  \u26A0 ${r.unadjudicated.length} claim(s) not fully adjudicated: ${r.unadjudicated.join(", ")}`);
  lines.push(r.ok ? `  \u2713 every claim is backed by its cited excerpt` : `  \u2717 some claims are refuted or unsupported`);
  return lines.join("\n");
}

// src/check.ts
function hashRepo(repo, outAbs, filters) {
  const outPrefix = outAbs.replace(/\/+$/, "") + "/";
  const include = compileGlobs(filters?.include);
  const exclude = compileGlobs(filters?.exclude);
  const out2 = {};
  for (const f of walk(repo, { maxFileBytes: filters?.maxBytes, maxFiles: filters?.maxFiles }).files) {
    if (f.abs === outAbs || f.abs.startsWith(outPrefix)) continue;
    if (include && !include(f.rel)) continue;
    if (exclude && exclude(f.rel)) continue;
    out2[f.rel] = sha1(readText(f.abs));
  }
  return out2;
}
function runCheck(outDir, repo) {
  const errors = [];
  const warnings = [];
  const graph = loadGraph(outDir);
  const manifest = loadManifest(outDir);
  if (!graph) errors.push("graph.json is missing or written by an incompatible engine version");
  if (!manifest) errors.push("manifest.json is missing or written by an incompatible engine version");
  if (!graph || !manifest) {
    return { ok: false, stale: false, changed: [], added: [], removed: [], errors, warnings };
  }
  const current = hashRepo(repo, outDir, manifest.scan);
  const recorded = manifest.fileHashes;
  const changed = [];
  const added = [];
  const removed = [];
  for (const rel of Object.keys(current)) {
    if (!(rel in recorded)) added.push(rel);
    else if (current[rel] !== recorded[rel]) changed.push(rel);
  }
  for (const rel of Object.keys(recorded)) if (!(rel in current)) removed.push(rel);
  changed.sort(byStr);
  added.sort(byStr);
  removed.sort(byStr);
  const enc = indexPaths(outDir).encyclopedia;
  for (const m of graph.modules) {
    if (readIfExists(join12(enc, `${m.slug}.md`)) === void 0) {
      errors.push(`module "${m.slug}" has no encyclopedia entry`);
    }
  }
  const nodes = new Set(graph.files.map((f) => f.rel));
  for (const e of graph.fileEdges) {
    if (!e.dangling && !nodes.has(e.to)) errors.push(`edge ${e.from} \u2192 ${e.to} (${e.kind}) points at a non-existent node`);
  }
  const fileLines = fileLineTable(graph);
  for (const m of graph.modules) {
    const text = readIfExists(join12(enc, `${m.slug}.md`));
    if (!text) continue;
    const parsed = parseRegions(text);
    if (!parsed.ok) {
      errors.push(
        `encyclopedia/${m.slug}.md: unparseable region fences \u2014 each <!-- ui:human key=\u2026 --> / <!-- /ui:human key=\u2026 --> marker must be on its own line; fix the fences and re-run \`ultraindex build\``
      );
      continue;
    }
    for (const r of parsed.regions) {
      if (r.type !== "human") continue;
      for (const u of checkCitations(r.body, fileLines).unresolved) {
        errors.push(`encyclopedia/${m.slug}.md [${r.key}]: citation [${u.citation.raw}] \u2014 ${u.reason}`);
      }
    }
  }
  const vectors = loadVectors(outDir);
  if (vectors) {
    if (!vectors.model || !vectors.dim) {
      warnings.push("vectors.json is corrupt (missing model/dim) \u2014 re-run `ultraindex embed`");
    } else {
      const staleVecs = staleVectorSlugs(outDir, graph, vectors);
      if (staleVecs.length) {
        warnings.push(`vectors.json stale for ${staleVecs.length} module(s) \u2014 run \`ultraindex embed\` to refresh`);
      }
    }
  }
  for (const slug of manifest.orphaned) {
    warnings.push(`orphaned prose kept at encyclopedia/_orphaned/${slug}.md (module removed)`);
  }
  for (const note of manifest.notes) {
    if (/conflict|unparseable/i.test(note)) warnings.push(note);
  }
  const stale = changed.length + added.length + removed.length > 0;
  return { ok: errors.length === 0 && !stale, stale, changed, added, removed, errors, warnings };
}
function checkAnswer(outDir, answerPath, opts = {}) {
  const errors = [];
  const graph = loadGraph(outDir);
  if (!graph) return { ok: false, citations: 0, resolved: 0, errors: ["no index \u2014 run `ultraindex build` first"] };
  const text = readIfExists(answerPath);
  if (text === void 0) return { ok: false, citations: 0, resolved: 0, errors: [`answer file not found: ${answerPath}`] };
  const cc = checkCitations(text, fileLineTable(graph));
  const attempts = cc.resolved.length + cc.unresolved.length;
  if (attempts === 0) errors.push("answer has no citations \u2014 cite every claim with [file:line] (bare brackets, not a markdown link)");
  for (const u of cc.unresolved) errors.push(`citation [${u.citation.raw}] \u2014 ${u.reason}`);
  const warnings = [];
  if (attempts > 0) {
    const missing = citationlessClaims(text);
    if (missing.length) warnings.push(`${missing.length} claim(s) carry no [file:line] citation \u2014 grounding is not enforced on them`);
  }
  const manifest = loadManifest(outDir);
  const repoRoot = opts.repo ?? manifest?.repo;
  if (manifest && repoRoot && cc.resolved.length) {
    const cited = [...new Set(cc.resolved.map((c2) => c2.path))];
    const drifted = cited.filter((rel) => {
      const recorded = manifest.fileHashes[rel];
      return recorded !== void 0 && sha1(readText(join12(repoRoot, rel))) !== recorded;
    });
    if (drifted.length) {
      warnings.push(
        `${drifted.length} cited file(s) changed since the index was built (${drifted.slice(0, 5).join(", ")}) \u2014 line numbers may be stale; re-run \`ultraindex build\``
      );
    }
  }
  const result = { ok: errors.length === 0, citations: attempts, resolved: cc.resolved.length, errors };
  if (opts.semantic) {
    const sem = loadVerify(dirname4(answerPath));
    if (!sem) {
      result.ok = false;
      errors.push(
        "--semantic: no VERIFY.json next to the answer \u2014 run `verify --answer`, adjudicate, then `verify --apply <verdicts.json>` before gating. (Plain `check --answer` is the resolution-only gate.)"
      );
    } else if (!Array.isArray(sem.verdicts)) {
      result.ok = false;
      errors.push(
        "--semantic: VERIFY.json has no verdicts[] to re-reduce from \u2014 regenerate it with `verify --apply <verdicts.json>` (a persisted summary alone is not attestable)"
      );
    } else {
      const recomputed = reduceVerdicts(sem.verdicts);
      if (sem.ok !== recomputed.ok || sem.pairs !== recomputed.pairs || (sem.failures?.length ?? 0) !== recomputed.failures.length) {
        warnings.push("--semantic: VERIFY.json summary disagrees with its verdicts[] \u2014 verdict recomputed from the raw verdicts");
      }
      result.semantic = recomputed;
      if (!recomputed.ok) {
        result.ok = false;
        errors.push(`semantic verification failed: ${recomputed.failures.length} claim(s) refuted or unsupported by their cited excerpt (see VERIFY.json)`);
      }
      if (repoRoot) {
        const mismatches = revalidateVerdicts(sem.verdicts, repoRoot);
        for (const m of mismatches.slice(0, 12)) {
          errors.push(`--semantic: ${m.claimId} [${m.citation}] \u2014 ${m.reason}; re-run \`verify\` and re-adjudicate`);
        }
        if (mismatches.length > 12) errors.push(`--semantic: \u2026and ${mismatches.length - 12} more excerpt mismatch(es)`);
        if (mismatches.length) result.ok = false;
      } else {
        warnings.push("--semantic: repo root unknown (no --repo and no manifest) \u2014 excerpt re-validation skipped");
      }
      const currentPairs = repoRoot ? buildClaimPairs(text, repoRoot) : [];
      const expected = currentPairs.length;
      const pairKey = (p) => `${p.claim}\0${p.citation}\0${p.digest}`;
      const adjudicated = new Set(sem.verdicts.map(pairKey));
      const covered = currentPairs.filter((p) => adjudicated.has(pairKey(p))).length;
      if (covered === 0 && expected > 0) {
        result.ok = false;
        errors.push(
          `--semantic: none of the answer's ${expected} verifiable claim\u2194citation pair(s) match the adjudicated verdicts \u2014 the answer was not actually verified (stale or foreign VERIFY.json); re-run \`verify\` on a fresh worklist`
        );
      } else if (covered < expected) {
        if (expected <= VERIFY_MAX) {
          result.ok = false;
          errors.push(
            `--semantic: only ${covered} of the answer's ${expected} verifiable claim\u2194citation pair(s) are adjudicated \u2014 ${expected - covered} claim(s) carry no verdict (a deleted verdict, or a claim added/edited after \`verify --apply\`); re-run \`verify\` on a fresh worklist and re-adjudicate before gating`
          );
        } else {
          warnings.push(
            `--semantic: VERIFY.json covers ${covered} of ${expected} verifiable pair(s) \u2014 the worklist cap (${VERIFY_MAX}) truncated it; raise \`--max-verify\` and re-run \`verify\` to adjudicate every pair`
          );
        }
      }
      if (recomputed.unadjudicated.length) warnings.push(`${recomputed.unadjudicated.length} claim(s) not fully adjudicated by verify`);
    }
  }
  if (warnings.length) result.warnings = warnings;
  return result;
}

// src/evidence.ts
import { join as join13, extname as extname3 } from "path";
var HEAD_LINES = 120;
var MAX_SYMS = 25;
var ASK_FILE_CAP = 20;
function gatherEvidence(repo, rels, headLines = HEAD_LINES) {
  const out2 = [];
  for (const rel of rels) {
    const content = readText(join13(repo, rel));
    if (!content) continue;
    const lines = content.split(/\r?\n/);
    const code = extractCode(rel, extname3(rel).toLowerCase(), content);
    const exported = code.symbols.filter((s) => s.exported).slice(0, MAX_SYMS).map((s) => ({ kind: s.kind, name: s.name, line: s.line, signature: s.signature }));
    out2.push({
      rel,
      lines: lines.length,
      exported,
      head: lines.slice(0, headLines).join("\n"),
      headTo: Math.min(lines.length, headLines)
    });
  }
  return out2;
}
function fence(rel) {
  const lang = extToLang(extname3(rel).toLowerCase());
  const map = { typescript: "ts", javascript: "js", python: "py", markdown: "md" };
  return map[lang] ?? (lang === "other" ? "" : lang);
}
function renderFile(e) {
  const parts2 = [`### \`${e.rel}\` (${e.lines} lines)`];
  if (e.exported.length) {
    parts2.push("", "Exported:");
    for (const s of e.exported) {
      const sig = s.signature ? ` \u2014 \`${clip(s.signature, 100).split("\n")[0]}\`` : "";
      parts2.push(`- \`${s.kind} ${s.name}\` @ line ${s.line}${sig}`);
    }
  }
  parts2.push("", `Source (lines 1-${e.headTo}${e.headTo < e.lines ? ", file continues\u2026" : ""}):`, "```" + fence(e.rel), e.head, "```");
  return parts2.join("\n");
}
function keyFiles(graph, module2, cap) {
  const nodes = new Map(graph.files.map((f) => [f.rel, f]));
  return module2.members.filter((rel) => nodes.get(rel)?.fileKind === "code").sort((a, b) => {
    const fa = nodes.get(a);
    const fb = nodes.get(b);
    return fb.symbols - fa.symbols || fb.degIn + fb.degOut - (fa.degIn + fa.degOut) || byStr(a, b);
  }).slice(0, cap);
}
var MAX_NEIGHBORS = 15;
function neighborLines(graph, slug) {
  const byId = new Map(graph.modules.map((m) => [m.slug, m]));
  const line = (s, dir) => `- ${dir} \`${s}\` \u2014 ${clipInline(byId.get(s)?.summary ?? "", 80)}`;
  const side = (ids, dir) => {
    const uniq = [...new Set(ids)].sort(byStr);
    const shown = uniq.slice(0, MAX_NEIGHBORS).map((s) => line(s, dir));
    if (uniq.length > MAX_NEIGHBORS) shown.push(`- \u2026and ${uniq.length - MAX_NEIGHBORS} more ${dir.includes("depends") ? "dependencies" : "consumers"}`);
    return shown;
  };
  return [
    ...side(graph.moduleEdges.filter((e) => e.from === slug).map((e) => e.to), "\u2192 depends on"),
    ...side(graph.moduleEdges.filter((e) => e.to === slug).map((e) => e.from), "\u2190 used by")
  ];
}
var CHARS_PER_TOKEN = 3;
function pushEvidence(lines, evidence, budget) {
  if (budget === void 0) {
    for (const e of evidence) lines.push("", renderFile(e));
    return;
  }
  const charBudget = budget * CHARS_PER_TOKEN;
  let used = 0;
  let i2 = 0;
  let trimmedShown = false;
  for (; i2 < evidence.length; i2++) {
    const block = renderFile(evidence[i2]);
    if (used + block.length <= charBudget) {
      lines.push("", block);
      used += block.length;
      continue;
    }
    const room = charBudget - used;
    const nl = room > 0 ? block.lastIndexOf("\n", room) : -1;
    if (nl > 0) {
      const kept = block.slice(0, nl);
      lines.push("", kept);
      if ((kept.match(/```/g)?.length ?? 0) % 2 === 1) lines.push("```");
      trimmedShown = true;
    }
    break;
  }
  if (i2 < evidence.length) {
    const cut = evidence.length - i2 - (trimmedShown ? 1 : 0);
    lines.push("", `\u2026 (truncated \u2014 ${cut} more file(s) cut by ~${budget}-token budget)`);
  }
}
var CITE_HELP = "Cite every factual claim with the file it rests on, in brackets: `[path]`, `[path:line]`, or `[path:start-end]` (e.g. `[src/api/client.ts:42-58]`). `ultraindex check` fails if a citation does not resolve to a real file/line.";
function renderModuleDossier(repo, graph, module2, budget) {
  const files = keyFiles(graph, module2, 6);
  const evidence = gatherEvidence(repo, files);
  const neighbors = neighborLines(graph, module2.slug);
  const lines = [
    `# Dossier \u2014 module \`${module2.slug}\`  (\`${module2.path}\`, tier ${module2.tier})`,
    "",
    `${module2.members.length} files \xB7 ${module2.symbols} symbols \xB7 entry: encyclopedia/${module2.slug}.md`,
    "",
    "## Task",
    `Read the REAL code below and write a grounded business analysis into the \`ui:human\` regions of \`encyclopedia/${module2.slug}.md\`: what this module does for the product, how it connects to the rest, and any gotchas. ${CITE_HELP}`
  ];
  if (neighbors.length) {
    lines.push("", "## Graph neighbours", ...neighbors);
  }
  lines.push("", "## Key source");
  if (evidence.length) pushEvidence(lines, evidence, budget);
  else if (files.length)
    lines.push("", `\u26A0\uFE0F ${files.length} code file(s) in this module but none were readable under \`${repo}\` \u2014 pass \`--repo <repo-root>\` (the index records its root; this usually means a wrong working directory).`);
  else lines.push("", "_(no code files in this module \u2014 likely docs/config)_");
  return lines.join("\n") + "\n";
}
function renderAskDossier(repo, graph, question, modules, budget) {
  const byId = new Map(graph.modules.map((m) => [m.slug, m]));
  const lines = [
    `# Evidence dossier for: "${question}"`,
    "",
    "## Task",
    `Answer the question USING ONLY the source below (and files you open from it) \u2014 not your own memory of the codebase. Write your answer to \`ANSWER.md\`, then run \`ultraindex check --answer ANSWER.md\`. ${CITE_HELP} An answer must carry at least one citation.`,
    "",
    `## Relevant modules`,
    ...modules.map((m) => `- \`${m.slug}\` (\`${byId.get(m.slug)?.path ?? m.slug}\`) \u2014 open: ${m.files.join(", ") || "(none)"}`),
    "",
    "## Source"
  ];
  const seen = /* @__PURE__ */ new Set();
  const rels = modules.flatMap((m) => m.files).filter((r) => seen.has(r) ? false : (seen.add(r), true)).slice(0, ASK_FILE_CAP);
  const evidence = gatherEvidence(repo, rels);
  if (evidence.length) pushEvidence(lines, evidence, budget);
  else if (rels.length)
    lines.push("", `\u26A0\uFE0F matched ${rels.length} file(s) but none were readable under \`${repo}\` \u2014 pass \`--repo <repo-root>\` (the index records its root).`);
  else lines.push("", "_(no modules matched your question \u2014 try different keywords or `ultraindex find`)_");
  return lines.join("\n") + "\n";
}

// src/explain.ts
function runDossier(outDir, repo, slug, budget) {
  const graph = loadGraph(outDir);
  if (!graph) return void 0;
  const module2 = graph.modules.find((m) => m.slug === slug);
  if (!module2) return void 0;
  return renderModuleDossier(repo, graph, module2, budget);
}
async function runAsk(outDir, repo, question, k = 5, budget) {
  const graph = loadGraph(outDir);
  if (!graph) return void 0;
  const found = await runFindHybrid(outDir, question, k);
  if (!found) return void 0;
  const modules = found.results.map((r) => ({ slug: r.slug, files: r.files }));
  return {
    content: renderAskDossier(repo, graph, question, modules, budget),
    modules: found.results.map((r) => r.slug),
    warning: found.warning
  };
}

// src/orchestrate.ts
import { existsSync as existsSync4, mkdirSync as mkdirSync2, readFileSync as readFileSync5, writeFileSync as writeFileSync3 } from "fs";
import { dirname as dirname5, join as join15, resolve } from "path";

// src/orchestrate-templates.ts
import { join as join14 } from "path";
var ENRICH_SCHEMA = {
  type: "object",
  required: ["entries"],
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        required: ["slug", "entry", "note"],
        properties: {
          slug: { type: "string", description: "the module slug you enriched" },
          entry: { type: "string", description: "absolute path of the encyclopedia entry you wrote" },
          note: { type: "string", description: "one line on what you enriched, grounded in the dossier" }
        }
      }
    }
  }
};
var VERIFY_ANSWER_SCHEMA = {
  type: "object",
  required: ["pairs"],
  properties: {
    pairs: {
      type: "array",
      items: {
        type: "object",
        required: ["claimId", "citation", "verdict", "note"],
        properties: {
          claimId: { type: "string" },
          citation: { type: "string" },
          verdict: { enum: ["supported", "partial", "refuted", "unsupported"] },
          note: { type: "string", description: "one line grounded in the source you read" }
        }
      }
    }
  }
};
var PHASE_SPECS = {
  enrich: {
    role: "enricher",
    title: "Enrich",
    schema: ENRICH_SCHEMA,
    description: (n) => `Enrich the ${n} unenriched encyclopedia entr${n === 1 ? "y" : "ies"} of an ultraindex index with cited prose (disjoint-write fan-out)`,
    joinHint: (ctx) => `node ${ctx.engine} check --out ${ctx.out} --repo ${ctx.repo}`
  },
  "verify-answer": {
    role: "refuter",
    title: "Verify",
    schema: VERIFY_ANSWER_SCHEMA,
    description: (n) => `Adversarially verify the ${n} claim\u2194citation pair(s) of an answer over an ultraindex index (skeptic fan-out)`,
    joinHint: (ctx) => `node ${ctx.engine} verify --apply <verdicts.json> --answer ${ctx.answer ?? "<answer.md>"}`
  }
};
function phaseSpec(name2) {
  const spec = PHASE_SPECS[name2];
  if (!spec) throw new Error(`no phase spec for "${name2}"`);
  return spec;
}
function toBatches(ids, batchSize) {
  const out2 = [];
  for (let i2 = 0; i2 < ids.length; i2 += batchSize) out2.push(ids.slice(i2, i2 + batchSize));
  return out2;
}
function phaseWorkflowScript(ph, ctx, batchSize) {
  const spec = phaseSpec(ph.name);
  const scriptPath = join14(ctx.out, "orchestration", `${ph.name}.workflow.mjs`);
  const meta = { name: `ultraindex-${ph.name}`, description: spec.description(ph.items), phases: [{ title: spec.title }] };
  const source = ph.name === "enrich" ? "the CURRENT enrichment queue (exactly what `status --json` reports)" : "the CURRENT claim\u2194citation worklist";
  return [
    `export const meta = ${JSON.stringify(meta)}`,
    ``,
    `// NOT a plain Node script: launch via the Workflow tool \u2014 Workflow({ scriptPath: ${JSON.stringify(scriptPath)} }).`,
    `// Emitted by \`ultraindex orchestrate\` from ${source}. The index is the`,
    `// source of truth: if it changes, re-run \`orchestrate --phase ${ph.name}\` before launching.`,
    // The clobber rationale only holds where agents WRITE (the enrich
    // disjoint-write fan-out); refuters are read-only, so the verify-answer
    // workflow must not carry it.
    ...ph.name === "enrich" ? [
      `//`,
      `// HARD RULE: no \`build\` or \`map\` runs while this fan-out is in flight \u2014 \`build\``,
      `// rewrites every encyclopedia entry, so a mid-fan-out rebuild races and clobbers`,
      `// the agents' writes. Build once before; never during.`
    ] : [],
    ``,
    `// Constants for THIS index (injected at emit time; no Date.now/Math.random in this harness).`,
    `const OUT = ${JSON.stringify(ctx.out)}`,
    `const REPO = ${JSON.stringify(ctx.repo)}`,
    `const ENGINE = ${JSON.stringify(ctx.engine)}`,
    `const WORKLIST = ${JSON.stringify(ph.worklist)}`,
    `const AGENTS = OUT + '/orchestration/agents'`,
    `const BATCHES = ${JSON.stringify(toBatches(ph.ids, batchSize))}`,
    `const SCHEMA = ${JSON.stringify(spec.schema)}`,
    ``,
    `function contract(name, extra) {`,
    `  return 'Read and follow the dispatch contract at ' + AGENTS + '/' + name + '.md VERBATIM.\\n'`,
    `    + 'Constants: OUT=' + OUT + '  REPO=' + REPO + '  ENGINE=' + ENGINE + '  WORKLIST=' + WORKLIST + '.\\n'`,
    `    + 'Invoke the engine only by its ABSOLUTE path: node ' + ENGINE + ' <cmd> \u2014 read-only commands only.'`,
    `    + (extra ? '\\n' + extra : '')`,
    `}`,
    ``,
    `log('ultraindex ${ph.name}: ' + ${JSON.stringify(String(ph.items))} + ' item(s) across ' + BATCHES.length + ' agent(s)')`,
    ``,
    `phase(${JSON.stringify(spec.title)})`,
    `const results = await pipeline(BATCHES, (batch, _item, i) =>`,
    `  agent(contract('${spec.role}', 'ITEMS=' + batch.join(',')), { label: '${ph.name}:' + (i + 1), phase: ${JSON.stringify(spec.title)}, agentType: 'general-purpose', schema: SCHEMA }))`,
    ``,
    ...ph.name === "enrich" ? [
      `// Disjoint-write exception: each enricher wrote ONLY its own encyclopedia/<slug>.md`,
      `// entries and returned the list. After the join, the orchestrator (you) runs the`,
      `// single repo-wide gate and routes each grounding failure back to the agent that`,
      `// owns that entry (never a mid-flight rebuild):`,
      `//   ${spec.joinHint(ctx, ph)}`
    ] : [
      `// One-writer rule: this workflow only COLLECTS verdict fragments. The main agent folds`,
      `// them into a verdicts.json itself (your ITEMS are 1-based positions in the worklist's`,
      `// pairs[]), then runs the fail-closed fold:`,
      `//   ${spec.joinHint(ctx, ph)}`
    ],
    `return { phase: ${JSON.stringify(ph.name)}, worklist: WORKLIST, results: results.filter(Boolean) }`,
    ``
  ].join("\n");
}
function agentContracts(ctx) {
  const engine = `node ${ctx.engine}`;
  return {
    enricher: `# Contract: enricher

You enrich encyclopedia entries of an ultraindex index \u2014 the grounded business analysis the deterministic engine cannot write. Handle ONLY the module slugs named in your prompt (\`ITEMS=<slug,\u2026>\`).

Index: \`${ctx.out}\` \xB7 Repo: \`${ctx.repo}\`. The queue you were drawn from is exactly what \`${engine} status --out ${ctx.out} --json\` reports (unenriched modules, most useful first).

For EACH of your slugs:

1. Run \`${engine} dossier <slug> --out ${ctx.out}\` (read-only) and read ONLY that packet \u2014 the module's real key source + graph neighbours. A docs/config-only module (often \`root\`) shows no code \u2014 cite its README/config files instead.
2. Edit \`${join14(ctx.out, "encyclopedia")}/<slug>.md\`: fill the \`ui:human\` regions (\`business\` \u2014 what it does for the product and how it connects; \`gotchas\` \u2014 caveats) with 2\u20135 sentences of genuine analysis, **citing the evidence** as \`[file]\`, \`[file:line]\` or \`[file:start-end]\`. Write only what the source supports \u2014 no guessing. Remove the \`<!-- ui:enrich -->\` stub marker; leave every \`ui:gen\` region alone.
3. Cite only files inside that module (you may open a file the dossier lists to cite a line past the excerpt \u2014 never a file outside your module).

Return (structured output): \`{ "entries": [{ "slug", "entry", "note" }] }\` \u2014 the entries you wrote (absolute paths) + a one-line note per entry, so the orchestrator can route \`check\` failures back to you.

## Write ONLY your own entries (the sanctioned disjoint-write exception)

ultraindex relaxes the family one-writer rule in exactly one place, and you are it: each module's entry is an independent unit of work, so you write your cited prose DIRECTLY into your own \`encyclopedia/<slug>.md\` entries \u2014 and nothing else. Do NOT edit another module's entry; do NOT touch \`graph.json\` / \`manifest.json\` / \`INDEX.md\` / \`vectors.json\` / \`symbols.json\`. HARD RULE: no \`build\` or \`map\` runs while the fan-out is in flight \u2014 a mid-fan-out rebuild races and clobbers every agent's writes. There is no per-module check either: the orchestrator runs a single repo-wide \`check\` after the join and routes grounding failures back per entry.
`,
    refuter: `# Contract: refuter

You are an adversarial skeptic verifying the claims of an answer written over an ultraindex index. Your job is to try to REFUTE each claim: assume it is wrong until the cited source proves it.

Worklist: the \`VERIFY.todo.json\` named in your prompt's \`WORKLIST=\` constant (an object with \`answer\` and \`pairs[]\`; each pair has \`claimId\`, \`claim\`, \`citation\`, \`path\`, \`digest\`). Handle ONLY the pairs whose 1-based position in \`pairs[]\` is named in your prompt (\`ITEMS=<n,\u2026>\`).

For EACH of your pairs:

1. Read the pair's \`digest\` (the cited excerpt, extracted verbatim at \`verify\` time) and open \`path\` in the repo (\`${ctx.repo}\`) at the cited lines whenever the digest alone cannot settle it.
2. Judge whether the excerpt SUPPORTS the claim:
   - \`supported\` \u2014 the cited source establishes the claim as stated.
   - \`partial\` \u2014 a real basis, but the claim overstates it (wrong scope, exaggerated behaviour).
   - \`unsupported\` \u2014 the source does not establish the claim.
   - \`refuted\` \u2014 the source contradicts the claim.
   When unsure, choose the HARSHER verdict \u2014 a false pass is worse than a false fail.
3. \`note\` is REQUIRED \u2014 one line grounded in what you read (quote or paraphrase the decisive code).

Return (structured output): \`{ "pairs": [{ "claimId", "citation", "verdict", "note" }] }\` \u2014 your ITEMS only.

## Return, don't write

Return ONLY the structured output specified above. Do NOT write, edit, or delete any file; do NOT run any engine command that writes (\`build\`, \`embed\`, \`verify --apply\`). The orchestrator is the sole writer \u2014 it folds your verdicts into a verdicts file itself and runs the fail-closed \`verify --apply\` gate. Exception: if a justification is prose too large to return, write ONLY to \`${join14(ctx.out, "orchestration", "out")}/<role>-<batch>.md\` (a file namespaced to you alone) and return its path.
`
  };
}
function runbookMd(phases, ctx) {
  const status = phases.map((p) => `| ${p.name} | \`${p.worklist}\` | ${p.ready ? `ready (${p.items} item(s))` : "not ready"} | \`${p.prerequisite}\` |`).join("\n");
  const engine = `node ${ctx.engine}`;
  const agents = join14(ctx.out, "orchestration", "agents");
  return `# ultraindex \u2014 sequential RUNBOOK (eco / no-subagent fallback)

Index: \`${ctx.out}\` \xB7 Repo: \`${ctx.repo}\` \xB7 Engine: \`${engine}\`

Generated by \`ultraindex orchestrate\` from the CURRENT index state. This sequential path is
correctness-identical to the multi-agent workflows \u2014 same queue, same contracts, same
grounding gates; only wall-clock differs. Fan-out is an optimization, not a requirement.

## Phase status

| Phase | Worklist | Status | Produce it with |
|---|---|---|---|
${status}

## The loop (play every role yourself, one item at a time)

1. **Build** (if not done): \`${engine} build --repo ${ctx.repo} --out ${ctx.out}\` \u2014 once, before any enrichment.
2. **Queue**: \`${engine} status --out ${ctx.out} --json\` \u2014 every module in the exact order to enrich (unenriched first, hubs first). The enrich phase fans out over \`${join14(ctx.out, "graph.json")}\` + the entries exactly as this queue reports them.
3. **Enrich each module** \u2014 apply \`${join14(agents, "enricher.md")}\` yourself: \`${engine} dossier <slug> --out ${ctx.out}\`, then write 2\u20135 sentences of cited \`[file:line]\` prose into the \`ui:human\` regions of \`${join14(ctx.out, "encyclopedia")}/<slug>.md\`. One module at a time; the hard rule holds here too \u2014 no \`build\` or \`map\` mid-loop.
4. **Gate**: \`${engine} check --out ${ctx.out} --repo ${ctx.repo}\` \u2014 repo-wide; it keys each grounding failure to its entry. Fix and re-run until green (never delete a citation just to pass).
5. **Semantic layer** (only if \`vectors.json\` exists): \`${engine} embed --out ${ctx.out}\`.
6. **Verify an answer** (high assurance): \`${engine} verify --answer <answer.md> --repo ${ctx.repo}\` writes \`VERIFY.todo.json\` next to the answer. For EVERY pair, apply \`${join14(agents, "refuter.md")}\` yourself (verdict + note), save your rows as \`verdicts.json\`, then \`${engine} verify --apply verdicts.json --answer <answer.md>\` and gate with \`${engine} check --answer <answer.md> --semantic --out ${ctx.out}\`.

With subagents available, prefer the emitted workflows instead: \`orchestrate --out ${ctx.out} --phase <p>\` then \`Workflow({ scriptPath: "${join14(ctx.out, "orchestration", "<p>.workflow.mjs")}" })\` \u2014 one repo-wide \`check\` after the join either way, and no \`build\` or \`map\` while agents are in flight.
`;
}

// src/orchestrate.ts
var PHASES = ["enrich", "verify-answer"];
var SMALL_WORKLIST = 3;
var BATCH_SIZE2 = 8;
function listPhases(ctx) {
  const st = runStatus(ctx.out);
  const enrichIds = st ? st.modules.filter((m) => !m.enriched).map((m) => m.slug) : [];
  const verifyWl = join15(ctx.answer ? dirname5(ctx.answer) : ctx.repo, "VERIFY.todo.json");
  const verifyPrereq = `node ${ctx.engine} verify --answer ${ctx.answer ?? "<answer.md>"} --repo ${ctx.repo}` + (ctx.answer ? "" : ` (then re-run orchestrate with --answer <answer.md>)`);
  let verifyIds = [];
  let verifyReady = false;
  let verifyReason;
  if (existsSync4(verifyWl)) {
    try {
      const todo = JSON.parse(readFileSync5(verifyWl, "utf8"));
      const owner = todo && typeof todo.answer === "string" ? todo.answer : void 0;
      if (ctx.answer !== void 0 && owner !== void 0 && resolve(owner) !== resolve(ctx.answer)) {
        verifyReason = `its worklist ${verifyWl} belongs to ${owner} \u2014 re-run: ${verifyPrereq}`;
      } else if (todo && Array.isArray(todo.pairs)) {
        verifyReady = true;
        verifyIds = todo.pairs.map((_, i2) => String(i2 + 1));
      }
    } catch {
    }
  }
  return [
    {
      name: "enrich",
      ready: st !== void 0,
      worklist: indexPaths(ctx.out).graph,
      items: enrichIds.length,
      ids: enrichIds,
      prerequisite: `node ${ctx.engine} build --repo ${ctx.repo} --out ${ctx.out}`
    },
    {
      name: "verify-answer",
      ready: verifyReady,
      worklist: verifyWl,
      items: verifyIds.length,
      ids: verifyIds,
      prerequisite: verifyPrereq,
      ...verifyReason === void 0 ? {} : { reason: verifyReason }
    }
  ];
}
function orchestrateRun(ctx, opts = {}) {
  const phases = listPhases(ctx);
  if (!phases[0].ready) {
    return {
      exitCode: 2,
      written: [],
      notices: [],
      errors: [`no index at ${ctx.out} \u2014 produce it first: ${phases[0].prerequisite}`],
      phases
    };
  }
  let selected = phases.filter((p) => p.ready);
  if (opts.phase !== void 0) {
    const ph = phases.find((p) => p.name === opts.phase);
    if (!ph) {
      return {
        exitCode: 2,
        written: [],
        notices: [],
        errors: [`unknown phase "${opts.phase}" \u2014 expected one of: ${PHASES.join(", ")}.`],
        phases
      };
    }
    if (!ph.ready) {
      return {
        exitCode: 2,
        written: [],
        notices: [],
        errors: [
          `phase "${ph.name}" is not ready \u2014 ` + (ph.reason ?? `its worklist ${ph.worklist} does not exist yet. Produce it first: ${ph.prerequisite}`)
        ],
        phases
      };
    }
    selected = [ph];
  }
  const orchDir = join15(ctx.out, "orchestration");
  const agentsDir = join15(orchDir, "agents");
  mkdirSync2(join15(orchDir, "out"), { recursive: true });
  mkdirSync2(agentsDir, { recursive: true });
  const written = [];
  const notices = [];
  for (const ph of phases) {
    if (!ph.ready && ph.reason) notices.push(`phase "${ph.name}": ${ph.reason}`);
  }
  for (const [name2, content] of Object.entries(agentContracts(ctx))) {
    const p = join15(agentsDir, `${name2}.md`);
    writeFileSync3(p, content);
    written.push(p);
  }
  if (!opts.eco) {
    for (const ph of selected) {
      if (ph.items === 0) {
        notices.push(`phase "${ph.name}": the queue is empty \u2014 nothing to orchestrate.`);
        continue;
      }
      if (ph.items <= SMALL_WORKLIST) {
        notices.push(`phase "${ph.name}": only ${ph.items} item(s) \u2014 the sequential --eco path is equivalent and cheaper.`);
      }
      const p = join15(orchDir, `${ph.name}.workflow.mjs`);
      writeFileSync3(p, phaseWorkflowScript(ph, ctx, BATCH_SIZE2));
      written.push(p);
    }
  }
  const rb = join15(orchDir, "RUNBOOK.md");
  writeFileSync3(rb, runbookMd(phases, ctx));
  written.push(rb);
  return { exitCode: 0, written, notices, errors: [], phases };
}

// src/cli.ts
var HELP = `ultraindex v${VERSION}
Deterministically index a whole repo (code + docs) into a navigable encyclopedia
\u2014 a small map, per-module entries, and a typed link-graph \u2014 so an AI can work in
huge codebases without filling its context window. Zero deps, no keys.

Usage:
  ultraindex build   --repo <dir> [--out <dir>] [--include <glob>] [--exclude <glob>] [--max-bytes <n>] [--max-files <n>] [--no-cache] [--full-hash] [--no-mermaid]
  ultraindex find    "<query>" [--out <dir>] [--k <n>]
  ultraindex embed   [--out <dir>] [--force]
  ultraindex neighbors <file|module-slug> [--out <dir>] [--depth <n>] [--kind <k>]
  ultraindex symbols "<name>" [--out <dir>] [--json]
  ultraindex impact  <file|module-slug> [--out <dir>] [--depth <n>] [--json]
  ultraindex map     [--out <dir>] [--module <slug>]
  ultraindex status  [--out <dir>]
  ultraindex dossier <module-slug> [--out <dir>] [--repo <dir>] [--budget <n>]
  ultraindex ask     "<question>" [--out <dir>] [--repo <dir>] [--k <n>] [--budget <n>]
  ultraindex check   [--out <dir>] [--repo <dir>] [--answer <file>] [--semantic]
  ultraindex verify  --answer <file> [--repo <dir>] [--apply <verdicts.json>] [--max-verify <n>]
  ultraindex orchestrate [--out <dir>] [--repo <dir>] [--answer <file>] [--phase <name>] [--eco] [--list]

Commands:
  build      Scan the repo and (re)write the layered index to --out (default
             <repo>/.ultraindex). Idempotent: refreshes generated sections,
             preserves your enriched prose.
  find       Rank modules for a task and print the exact files to open. Hybrid
             (lexical + semantic) when vectors.json exists; pure lexical otherwise.
  embed      Build/refresh vectors.json: embed each module through the configured
             provider (see Semantic below). Incremental \u2014 unchanged modules keep
             their vectors.
  neighbors  Show graph neighbours of a file or module (what links to/from it).
  symbols    Find where a symbol is defined (file:line, kind, owning module) and
             which files reference it \u2014 from symbols.json, no repo re-scan.
  impact     Reverse dependency closure: every file that transitively imports or
             uses the target, grouped by module \u2014 "what breaks if I change this".
  map        Print INDEX.md (the map) or one module's entry. With --json, emit
             the module table (slug, path, tier, degree, summary) for parsing.
  status     Show enrichment progress and the suggested order to enrich next \u2014
             unenriched first, foundations/features before tail, hubs first.
  dossier    Print a grounding packet for a module (its real key source + graph
             neighbours) so you can write a cited business analysis into its entry.
  ask        Assemble grounded evidence for a question (real source of the
             relevant modules) so you can answer it with citations.
  check      Report staleness + integrity + grounding (cited prose must resolve).
             With --answer <file>, validate that answer's citations instead;
             add --semantic to also fail on a claim its cited excerpt doesn't support.
  verify     Emit a claim\u2194citation worklist for adversarial support-checking of
             an answer, then (--apply <verdicts.json>) gate on refuted/unsupported.
  orchestrate  Emit the index's multi-agent fan-out from its CURRENT state into
             <out>/orchestration/: one workflow script per ready phase (enrich =
             the status work-queue; verify-answer = the claim\u2194citation worklist),
             the dispatch contracts, and a sequential RUNBOOK fallback.

Options:
  --repo <dir>      Repo to index / check / read source from  (default: .)
  --out <dir>       Index output dir   (default: <repo>/.ultraindex, else docs/ultraindex if present)
  --include <glob>  Only index paths matching (comma-separated globs)
  --exclude <glob>  Skip paths matching (comma-separated globs)
  --max-bytes <n>   Skip files larger than n bytes                (default: 1 MiB)
  --max-files <n>   Stop the scan after n files; the index warns if hit (default: 20000)
  --no-cache        build: ignore cache.json and re-extract every file
  --full-hash       build: re-hash every file, disabling the (size,mtime) fastpath
  --no-mermaid      Do not write graph.mmd
  --k <n>           find/ask: number of modules to return      (default: 8 / 5)
  --depth <n>       neighbors: hops to traverse                (default: 1)
  --kind <k>        neighbors: only these edge kinds (comma list: import,call,use,doc-link,mention)
  --budget <n>      ask/dossier: cap the source evidence at ~n tokens
  --module <slug>   map: print this module's entry instead of INDEX.md
  --answer <file>   check/verify: the answer file whose citations to validate
  --apply <file>    verify: reduce a filled verdicts file to a pass/fail gate
  --max-verify <n>  verify: cap the claim\u2194citation worklist           (default: 40)
  --phase <name>    orchestrate: emit one phase only \u2014 enrich | verify-answer
  --eco             orchestrate: emit only RUNBOOK.md + agents/*.md (the explicit
                    low-token sequential path)
  --list            orchestrate: print the phases + readiness as JSON, emit nothing
  --force           embed: re-embed every module even if unchanged
  --json            Machine-readable output
  --quiet           check: print nothing, use the exit code only
  -h, --help        Show this help
  -v, --version     Show version

Semantic (optional):
  \`find\` stays deterministic and offline by default. To add semantic ranking,
  point ultraindex at any OpenAI-compatible /v1/embeddings endpoint \u2014 e.g. the
  local container in docker-compose.yml (\`docker compose up -d\`) \u2014 via env
  (ULTRAINDEX_EMBED_BASE_URL, ULTRAINDEX_EMBED_MODEL, ULTRAINDEX_EMBED_API_KEY)
  or <out>/semantic.json, then run \`ultraindex embed\`. If the provider is down,
  \`find\` degrades to pure lexical with a warning. Delete vectors.json to turn
  the semantic layer off entirely.

Grounding:
  Analysis is verified, not trusted. Cite claims with [path], [path:line] or
  [path:start-end]. \`check\` (encyclopedia prose) and \`check --answer\` fail if a
  citation does not resolve to a real file/line \u2014 the anti-hallucination guard.
`;
var COMMANDS = /* @__PURE__ */ new Set(["build", "find", "embed", "neighbors", "symbols", "impact", "map", "status", "dossier", "ask", "check", "verify", "orchestrate"]);
var VALUE_FLAGS = /* @__PURE__ */ new Set(["repo", "out", "include", "exclude", "max-bytes", "max-files", "k", "depth", "kind", "budget", "module", "answer", "q", "question", "apply", "max-verify", "phase"]);
var BOOL_FLAGS = /* @__PURE__ */ new Set(["json", "no-mermaid", "no-cache", "full-hash", "quiet", "force", "semantic", "eco", "list"]);
var REASON_HINTS = {
  "missing-module": "a relative import's target file does not exist \u2014 usually a real broken import in the repo, worth reporting",
  "alias-unresolved": "a tsconfig path alias matched but its target file is missing \u2014 check the tsconfig paths or uncommitted build artifacts",
  "escapes-repo-root": "an import walks above the indexed root \u2014 index the parent directory, or ignore if intentional",
  "missing-package": "a Go import maps to a directory with no .go files \u2014 broken import or ungenerated code",
  "missing-include": 'a C/C++ `#include "..."` names a header with no in-repo file \u2014 a missing/renamed header or an external dep quoted like a local one',
  "missing-target": "a markdown link points at a file that does not exist \u2014 a stale doc link"
};
function fail(message) {
  process.stderr.write(`ultraindex: ${message}
`);
  process.exit(1);
}
function parseArgs(argv) {
  if (argv.length === 0) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  if (argv[0] === "-h" || argv[0] === "--help") {
    process.stdout.write(HELP);
    process.exit(0);
  }
  if (argv[0] === "-v" || argv[0] === "--version") {
    process.stdout.write(VERSION + "\n");
    process.exit(0);
  }
  const command = argv[0];
  if (!COMMANDS.has(command)) fail(`unknown command: ${command} (run --help for usage)`);
  const values = {};
  const bools = /* @__PURE__ */ new Set();
  const positional = [];
  for (let i2 = 1; i2 < argv.length; i2++) {
    const arg = argv[i2];
    if (arg === "-h" || arg === "--help") {
      process.stdout.write(HELP);
      process.exit(0);
    }
    if (arg === "-v" || arg === "--version") {
      process.stdout.write(VERSION + "\n");
      process.exit(0);
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const key = eq !== -1 ? arg.slice(2, eq) : arg.slice(2);
      if (BOOL_FLAGS.has(key)) {
        if (eq !== -1) fail(`--${key} is a boolean flag and does not take a value`);
        bools.add(key);
        continue;
      }
      if (!VALUE_FLAGS.has(key)) fail(`unknown flag: --${key} (run --help for the supported options)`);
      let value;
      if (eq !== -1) {
        value = arg.slice(eq + 1);
      } else {
        const next = argv[i2 + 1];
        if (next === void 0 || next.startsWith("--")) fail(`missing value for --${key}`);
        value = next;
        i2++;
      }
      values[key] = value;
      continue;
    }
    positional.push(arg);
  }
  return { command, positional, values, bools };
}
function splitList(s) {
  if (!s) return void 0;
  const parts2 = s.split(",").map((x) => x.trim()).filter(Boolean);
  return parts2.length ? parts2 : void 0;
}
function resolveOut(p, base) {
  if (p.values.out) return resolve2(p.values.out);
  const dotted = join16(base, ".ultraindex");
  if (existsSync5(dotted)) return dotted;
  const docs = join16(base, "docs", "ultraindex");
  if (existsSync5(docs)) return docs;
  return dotted;
}
function resolveRepoRoot(p, out2) {
  if (p.values.repo) return resolve2(p.values.repo);
  return loadManifest(out2)?.repo ?? resolve2(".");
}
async function cmdBuild(p) {
  const repo = resolve2(p.values.repo ?? ".");
  if (!existsSync5(repo)) fail(`repo not found: ${repo}`);
  const out2 = p.values.out ? resolve2(p.values.out) : join16(repo, ".ultraindex");
  const maxBytes = p.values["max-bytes"] ? Number(p.values["max-bytes"]) : void 0;
  if (maxBytes !== void 0 && (!Number.isFinite(maxBytes) || maxBytes <= 0)) fail("invalid --max-bytes");
  const maxFiles = p.values["max-files"] ? Number(p.values["max-files"]) : void 0;
  if (maxFiles !== void 0 && (!Number.isInteger(maxFiles) || maxFiles <= 0)) fail("invalid --max-files");
  await ensureGrammars(allGrammarKeys());
  const { graph, manifest, capped } = runBuild(
    {
      repo,
      out: out2,
      include: splitList(p.values.include),
      exclude: splitList(p.values.exclude),
      maxBytes,
      maxFiles,
      noCache: p.bools.has("no-cache"),
      fullHash: p.bools.has("full-hash"),
      mermaid: !p.bools.has("no-mermaid"),
      json: p.bools.has("json")
    },
    (/* @__PURE__ */ new Date()).toISOString()
  );
  const danglingEdges = graph.fileEdges.filter((e) => e.dangling);
  const dangling = danglingEdges.length;
  const callEdges = graph.fileEdges.filter((e) => e.kind === "call");
  const calls = {
    total: callEdges.length,
    extracted: callEdges.filter((e) => e.confidence === "extracted").length,
    inferred: callEdges.filter((e) => e.confidence === "inferred").length
  };
  if (p.bools.has("json")) {
    const danglingByReason = {};
    for (const e of danglingEdges) {
      const r = e.reason ?? "unknown";
      danglingByReason[r] = (danglingByReason[r] ?? 0) + 1;
    }
    const reasonHints = {};
    for (const r of Object.keys(danglingByReason)) {
      if (REASON_HINTS[r]) reasonHints[r] = REASON_HINTS[r];
    }
    process.stdout.write(
      JSON.stringify(
        {
          out: out2,
          files: graph.fileCount,
          modules: graph.modules.length,
          edges: graph.fileEdges.length,
          dangling,
          calls,
          ...dangling ? { danglingByReason, reasonHints } : {},
          ...capped ? { truncated: true } : {},
          orphaned: manifest.orphaned,
          ...manifest.notes.length ? { notes: manifest.notes } : {}
        },
        null,
        2
      ) + "\n"
    );
    return;
  }
  const lines = [
    `ultraindex: built index for ${graph.fileCount} files${capped ? " (PARTIAL \u2014 --max-files cap hit)" : ""}`,
    `  out:      ${out2}${graph.commit ? `  (@ ${graph.commit})` : ""}`,
    `  modules:  ${graph.modules.length} \xB7 links: ${graph.fileEdges.length}${dangling ? ` \xB7 dangling: ${dangling}` : ""}`,
    // Omitted on a repo with no call edges — no point flagging a zero.
    ...calls.total ? [`  calls:    ${calls.total} (${calls.extracted} extracted \xB7 ${calls.inferred} inferred)`] : [],
    ...capped ? [`  WARNING:  scan hit --max-files \u2014 the index is partial; raise --max-files to index the whole repo`] : [],
    ...manifest.orphaned.length ? [`  orphaned: ${manifest.orphaned.length} (see encyclopedia/_orphaned/)`] : [],
    ...manifest.notes.length ? [`  notes:    ${manifest.notes.length} (see manifest.json)`] : [],
    `  next:     enrich encyclopedia/*.md (ui:human regions), then \`ultraindex check\``
  ];
  process.stderr.write(lines.join("\n") + "\n");
}
async function cmdFind(p) {
  const base = resolve2(p.values.repo ?? ".");
  const out2 = resolveOut(p, base);
  const query = p.positional.join(" ").trim();
  if (!query) fail('missing query \u2014 usage: ultraindex find "<task keywords>"');
  const k = p.values.k ? Number(p.values.k) : 8;
  if (!Number.isFinite(k) || k <= 0) fail("invalid --k");
  const found = await runFindHybrid(out2, query, k);
  if (found === void 0) fail(`no index at ${out2} \u2014 run \`ultraindex build\` first`);
  if (found.warning) process.stderr.write(`ultraindex: warning: ${found.warning}
`);
  const results = found.results;
  if (p.bools.has("json")) {
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
    return;
  }
  if (results.length === 0) {
    process.stdout.write(`No modules matched "${query}".
`);
    return;
  }
  const lines = [`ultraindex: ${results.length} module(s) for "${query}"${found.semantic ? " (hybrid)" : ""}`, ""];
  for (const r of results) {
    lines.push(`\u25B8 ${r.slug}  (${r.path}, tier ${r.tier}, score ${r.score}${r.semanticRank !== void 0 ? `, semantic #${r.semanticRank}` : ""})${r.via ? ` via:${r.via}` : ""}`);
    if (r.matched.length) lines.push(`    matched: ${r.matched.join(", ")}`);
    lines.push(`    open:    ${r.files.join("  ") || "(no files)"}`);
    if (r.neighbors.length) lines.push(`    related: ${r.neighbors.join(", ")}`);
    lines.push(`    entry:   encyclopedia/${r.slug}.md`);
    lines.push("");
  }
  process.stdout.write(lines.join("\n"));
}
async function cmdEmbed(p) {
  const base = resolve2(p.values.repo ?? ".");
  const out2 = resolveOut(p, base);
  const cfg = loadSemanticConfig(out2);
  if (!cfg) {
    fail(
      `no semantic config \u2014 set ULTRAINDEX_EMBED_BASE_URL and ULTRAINDEX_EMBED_MODEL, or create ${join16(out2, "semantic.json")} ({"baseUrl": "http://localhost:8080/v1", "model": "BAAI/bge-small-en-v1.5"}). To run a local provider: \`docker compose up -d\` (see docker-compose.yml)`
    );
  }
  const report = await runEmbed(out2, cfg, p.bools.has("force"));
  if (report === void 0) fail(`no index at ${out2} \u2014 run \`ultraindex build\` first`);
  if (p.bools.has("json")) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return;
  }
  const lines = [
    `ultraindex: embedded ${report.embedded}/${report.total} module(s) (${report.reused} reused, ${report.removed} pruned)`,
    `  model:    ${report.model} (dim ${report.dim})`,
    `  next:     \`ultraindex find "<query>"\` now ranks hybrid (lexical + semantic)`
  ];
  process.stderr.write(lines.join("\n") + "\n");
}
function cmdNeighbors(p) {
  const base = resolve2(p.values.repo ?? ".");
  const out2 = resolveOut(p, base);
  const target = p.positional[0];
  if (!target) fail("missing target \u2014 usage: ultraindex neighbors <file|module-slug>");
  if (!indexExists(out2)) fail(`no index at ${out2} \u2014 run \`ultraindex build\` first`);
  const depth = p.values.depth ? Number(p.values.depth) : 1;
  if (!Number.isFinite(depth) || depth <= 0) fail("invalid --depth");
  const KNOWN_KINDS = /* @__PURE__ */ new Set(["import", "call", "use", "doc-link", "mention"]);
  const kindList = splitList(p.values.kind);
  let kinds;
  if (kindList) {
    for (const kk of kindList) if (!KNOWN_KINDS.has(kk)) fail(`invalid --kind "${kk}" (known: ${[...KNOWN_KINDS].join(", ")})`);
    kinds = new Set(kindList);
  }
  const res = runNeighbors(out2, target, depth, kinds);
  if (!res) fail(`"${target}" is not a module slug or file in the index`);
  if (p.bools.has("json")) {
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    return;
  }
  const lines = [`ultraindex: neighbours of ${res.scope} "${res.target}" (depth ${depth}${kinds ? `, kind ${[...kinds].join("/")}` : ""})`, ""];
  if (res.members) lines.push(`  members: ${res.members.join("  ")}`, "");
  if (res.links.length === 0) lines.push("  (no neighbours)");
  for (const l of res.links) {
    const arrow = l.direction === "out" ? "\u2192" : "\u2190";
    const confidence = l.confidence ? ` \xB7${l.confidence}` : "";
    lines.push(`  ${arrow} ${l.node}  (${l.kind}${l.weight > 1 ? ` \xD7${l.weight}` : ""}${confidence}, depth ${l.depth})`);
  }
  process.stdout.write(lines.join("\n") + "\n");
}
function cmdSymbols(p) {
  const out2 = resolveOut(p, resolve2(p.values.repo ?? "."));
  const query = p.positional.join(" ").trim();
  if (!query) fail('missing symbol name \u2014 usage: ultraindex symbols "<name>"');
  const res = runSymbols(out2, query);
  if (!res) fail(`no index at ${out2} \u2014 run \`ultraindex build\` first`);
  if (p.bools.has("json")) {
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    return;
  }
  if (!res.hits.length) {
    process.stderr.write(`ultraindex: no symbol matching "${query}" (try \`ultraindex find\`)
`);
    process.exit(1);
  }
  const lines = [];
  for (const h of res.hits) {
    lines.push(`${h.name}`);
    for (const d of h.defs) {
      const where = d.parent ? ` in ${d.parent}` : "";
      lines.push(`  def  ${d.file}:${d.line}  (${d.kind}${where}, ${d.exported ? "exported" : "local"}, module ${d.module})`);
    }
    if (h.refs.length) lines.push(`  used ${h.refs.length} file(s): ${h.refs.slice(0, 8).join("  ")}${h.refs.length > 8 ? "  \u2026" : ""}`);
  }
  process.stdout.write(lines.join("\n") + "\n");
}
function cmdImpact(p) {
  const out2 = resolveOut(p, resolve2(p.values.repo ?? "."));
  const target = p.positional[0];
  if (!target) fail("missing target \u2014 usage: ultraindex impact <file|module-slug>");
  if (!indexExists(out2)) fail(`no index at ${out2} \u2014 run \`ultraindex build\` first`);
  const depth = p.values.depth ? Number(p.values.depth) : void 0;
  if (depth !== void 0 && (!Number.isInteger(depth) || depth <= 0)) fail("invalid --depth");
  const res = runImpact(out2, target, depth ?? Infinity);
  if (!res) fail(`"${target}" is not a module slug or file in the index`);
  if (p.bools.has("json")) {
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    return;
  }
  const lines = [
    `ultraindex: impact of ${res.scope} "${res.target}" \u2014 ${res.files.length} dependent file(s), ${res.modules.length} module(s)`
  ];
  if (!res.files.length) lines.push("  (nothing depends on this)");
  else {
    lines.push(`  modules: ${res.modules.join("  ") || "(none other)"}`, "");
    for (const f of res.files) lines.push(`  \u2190 ${f.rel}  (module ${f.module}, depth ${f.depth})`);
  }
  process.stdout.write(lines.join("\n") + "\n");
}
function cmdMap(p) {
  const base = resolve2(p.values.repo ?? ".");
  const out2 = resolveOut(p, base);
  if (p.bools.has("json")) {
    if (p.values.module) fail("--json applies to the map view, not a single entry (read the markdown)");
    const graph = loadGraph(out2);
    if (!graph) fail(`no index at ${out2} \u2014 run \`ultraindex build\` first`);
    const modules = graph.modules.map((m) => ({
      slug: m.slug,
      path: m.path,
      tier: m.tier,
      degree: m.degIn + m.degOut,
      files: m.members.length,
      summary: m.summary
    }));
    process.stdout.write(JSON.stringify(modules, null, 2) + "\n");
    return;
  }
  const content = runMap(out2, p.values.module);
  if (content === void 0) {
    fail(p.values.module ? `no entry for module "${p.values.module}" at ${out2}` : `no index at ${out2} \u2014 run \`ultraindex build\` first`);
  }
  process.stdout.write(content.endsWith("\n") ? content : content + "\n");
}
function cmdStatus(p) {
  const base = resolve2(p.values.repo ?? ".");
  const out2 = resolveOut(p, base);
  const res = runStatus(out2);
  if (res === void 0) fail(`no index at ${out2} \u2014 run \`ultraindex build\` first`);
  if (p.bools.has("json")) {
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    return;
  }
  const lines = [`ultraindex: ${res.enriched}/${res.total} modules enriched`];
  if (res.suggestedNext.length) lines.push(`  next:     ${res.suggestedNext.join(", ")}`);
  lines.push("");
  for (const m of res.modules.slice(0, 15)) {
    const state = m.enriched ? "\u2713" : "\xB7";
    lines.push(`  ${state} ${m.slug}  (${m.path}, tier ${m.tier}, degree ${m.degree}) \u2014 ${m.regions.enriched}/${m.regions.total} regions`);
  }
  if (res.modules.length > 15) lines.push(`  \u2026and ${res.modules.length - 15} more (use --json for all)`);
  lines.push("", `  enrich:   \`ultraindex dossier <slug>\` then fill the ui:human regions, then \`ultraindex check\``);
  process.stdout.write(lines.join("\n") + "\n");
}
function cmdDossier(p) {
  const out2 = resolveOut(p, resolve2(p.values.repo ?? "."));
  const repo = resolveRepoRoot(p, out2);
  const slug = p.positional[0];
  if (!slug) fail("missing module slug \u2014 usage: ultraindex dossier <module-slug>");
  const budget = p.values.budget ? Number(p.values.budget) : void 0;
  if (budget !== void 0 && (!Number.isInteger(budget) || budget <= 0)) fail("invalid --budget");
  const content = runDossier(out2, repo, slug, budget);
  if (content === void 0) {
    fail(indexExists(out2) ? `no module "${slug}" in the index (try \`ultraindex map\`)` : `no index at ${out2} \u2014 run \`ultraindex build\` first`);
  }
  process.stdout.write(content);
}
async function cmdAsk(p) {
  const out2 = resolveOut(p, resolve2(p.values.repo ?? "."));
  const repo = resolveRepoRoot(p, out2);
  const question = (p.positional.join(" ") || p.values.q || p.values.question || "").trim();
  if (!question) fail('missing question \u2014 usage: ultraindex ask "<question>"');
  const k = p.values.k ? Number(p.values.k) : 5;
  if (!Number.isFinite(k) || k <= 0) fail("invalid --k");
  const budget = p.values.budget ? Number(p.values.budget) : void 0;
  if (budget !== void 0 && (!Number.isInteger(budget) || budget <= 0)) fail("invalid --budget");
  const res = await runAsk(out2, repo, question, k, budget);
  if (res === void 0) fail(`no index at ${out2} \u2014 run \`ultraindex build\` first`);
  if (res.warning) process.stderr.write(`ultraindex: warning: ${res.warning}
`);
  if (p.bools.has("json")) {
    process.stdout.write(JSON.stringify({ modules: res.modules, content: res.content }, null, 2) + "\n");
    return;
  }
  process.stdout.write(res.content);
}
function cmdCheck(p) {
  const out2 = resolveOut(p, resolve2(p.values.repo ?? "."));
  const repo = resolveRepoRoot(p, out2);
  if (p.values.answer) {
    const res2 = checkAnswer(out2, resolve2(p.values.answer), { semantic: p.bools.has("semantic"), repo });
    if (p.bools.has("json")) {
      process.stdout.write(JSON.stringify(res2, null, 2) + "\n");
    } else if (!p.bools.has("quiet")) {
      const lines = [`ultraindex: answer is ${res2.ok ? "GROUNDED" : "NOT GROUNDED"} (${res2.resolved}/${res2.citations} citations resolve)`];
      if (res2.semantic) {
        const s = res2.semantic;
        lines.push(`  semantic: supported ${s.supported} \xB7 partial ${s.partial} \xB7 refuted ${s.refuted} \xB7 unsupported ${s.unsupported}`);
        for (const f of s.failures.slice(0, 8)) lines.push(`  \u2717 semantic ${f.claimId} (${f.citation}): ${f.verdict}`);
      }
      for (const e of res2.errors) lines.push(`  error:    ${e}`);
      for (const w of res2.warnings ?? []) lines.push(`  warning:  ${w}`);
      process.stdout.write(lines.join("\n") + "\n");
    }
    if (!res2.ok) process.exit(1);
    return;
  }
  const res = runCheck(out2, repo);
  if (p.bools.has("json")) {
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    if (!res.ok) process.exit(1);
    return;
  }
  if (!p.bools.has("quiet")) {
    const lines = [];
    const status = res.errors.length ? "BROKEN" : res.stale ? "STALE" : "FRESH";
    lines.push(`ultraindex: index is ${status} (${out2})`);
    if (res.changed.length) lines.push(`  changed:  ${res.changed.length} \u2014 ${res.changed.slice(0, 8).join(", ")}${res.changed.length > 8 ? " \u2026" : ""}`);
    if (res.added.length) lines.push(`  added:    ${res.added.length} \u2014 ${res.added.slice(0, 8).join(", ")}${res.added.length > 8 ? " \u2026" : ""}`);
    if (res.removed.length) lines.push(`  removed:  ${res.removed.length} \u2014 ${res.removed.slice(0, 8).join(", ")}${res.removed.length > 8 ? " \u2026" : ""}`);
    for (const e of res.errors) lines.push(`  error:    ${e}`);
    for (const w of res.warnings) lines.push(`  warning:  ${w}`);
    if (res.stale) lines.push(`  fix:      re-run \`ultraindex build\` to refresh`);
    process.stdout.write(lines.join("\n") + "\n");
  }
  if (!res.ok) process.exit(1);
}
function cmdVerify(p) {
  const answer = p.values.answer;
  if (!answer) fail("missing --answer <file> \u2014 usage: ultraindex verify --answer <file> [--repo <dir>]");
  const answerPath = resolve2(answer);
  const dir = dirname6(answerPath);
  if (p.values.apply) {
    let res;
    try {
      res = applyVerdicts(dir, resolve2(p.values.apply));
    } catch (e) {
      fail(e.message);
    }
    if (p.bools.has("json")) process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    else if (!p.bools.has("quiet")) process.stdout.write(formatVerifyReport(res) + "\n");
    if (!res.ok) process.exit(1);
    return;
  }
  if (!existsSync5(answerPath)) fail(`answer file not found: ${answerPath}`);
  const out2 = resolveOut(p, resolve2(p.values.repo ?? "."));
  const repo = resolveRepoRoot(p, out2);
  const maxVerify = p.values["max-verify"] ? Number(p.values["max-verify"]) : VERIFY_MAX;
  if (!Number.isFinite(maxVerify) || maxVerify <= 0) fail("invalid --max-verify");
  const wl = runVerify(answerPath, repo, { maxVerify });
  if (p.bools.has("json")) {
    process.stdout.write(JSON.stringify(wl, null, 2) + "\n");
    return;
  }
  process.stderr.write(
    `ultraindex: ${wl.pairs.length} claim\u2194citation pair(s) \u2192 ${dir}/VERIFY.md & VERIFY.todo.json
  adjudicate each verdict, save as verdicts.json, then: ultraindex verify --apply verdicts.json --answer ${answerPath}
`
  );
}
function cmdOrchestrate(p) {
  const base = resolve2(p.values.repo ?? ".");
  const out2 = resolveOut(p, base);
  const repo = resolveRepoRoot(p, out2);
  const engine = realpathSync2(fileURLToPath2(import.meta.url));
  const ctx = { out: out2, repo, engine, answer: p.values.answer ? resolve2(p.values.answer) : void 0 };
  if (p.bools.has("list")) {
    process.stdout.write(JSON.stringify({ phases: listPhases(ctx) }, null, 2) + "\n");
    return;
  }
  const res = orchestrateRun(ctx, {
    phase: p.values.phase,
    eco: p.bools.has("eco")
  });
  if (res.exitCode !== 0) {
    for (const e of res.errors) process.stderr.write(`ultraindex orchestrate: ${e}
`);
    process.exit(res.exitCode);
  }
  const lines = ["ultraindex: orchestration generated", ...res.written.map((w) => `  ${w}`)];
  for (const n of res.notices) lines.push(`  note:     ${n}`);
  const workflows = res.written.filter((w) => w.endsWith(".workflow.mjs"));
  if (workflows.length) {
    for (const ph of res.phases) {
      const w = workflows.find((x) => x === join16(out2, "orchestration", `${ph.name}.workflow.mjs`));
      if (!w) continue;
      lines.push(`  launch:   Workflow({ scriptPath: ${JSON.stringify(w)} })`);
      lines.push(
        `  join:     ${phaseSpec(ph.name).joinHint(ctx, ph)}` + (ph.name === "enrich" ? ` \u2014 after all agents return; no \`build\` or \`map\` while they run` : ` \u2014 fold the agents' returned fragments into <verdicts.json> first`)
      );
    }
  } else {
    lines.push(`  next:     follow ${join16(out2, "orchestration", "RUNBOOK.md")} sequentially (the eco path)`);
  }
  process.stderr.write(lines.join("\n") + "\n");
}
async function main() {
  const p = parseArgs(process.argv.slice(2));
  switch (p.command) {
    case "build":
      return cmdBuild(p);
    case "find":
      return cmdFind(p);
    case "embed":
      return cmdEmbed(p);
    case "neighbors":
      return cmdNeighbors(p);
    case "symbols":
      return cmdSymbols(p);
    case "impact":
      return cmdImpact(p);
    case "map":
      return cmdMap(p);
    case "status":
      return cmdStatus(p);
    case "dossier":
      return cmdDossier(p);
    case "ask":
      return cmdAsk(p);
    case "check":
      return cmdCheck(p);
    case "verify":
      return cmdVerify(p);
    case "orchestrate":
      return cmdOrchestrate(p);
  }
}
function isInvokedDirectly() {
  const argv1 = process.argv[1];
  if (argv1 === void 0) return false;
  const modulePath = fileURLToPath2(import.meta.url);
  try {
    if (realpathSync2(argv1) === realpathSync2(modulePath)) return true;
  } catch {
  }
  return import.meta.url === pathToFileURL(argv1).href;
}
if (isInvokedDirectly()) {
  main().catch((e) => fail(e.message));
}
export {
  parseArgs
};
