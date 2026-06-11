#!/usr/bin/env node

// src/cli.ts
import { resolve, join as join12 } from "path";
import { existsSync as existsSync2 } from "fs";
import { pathToFileURL, fileURLToPath } from "url";
import { realpathSync as realpathSync2 } from "fs";

// src/types.ts
var VERSION = "2.0.0";
var SCHEMA_VERSION = 1;

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
function walk(root, opts = {}) {
  const maxFileBytes = opts.maxFileBytes ?? 1024 * 1024;
  const maxFiles = opts.maxFiles ?? 2e4;
  const out = [];
  const stack = [root];
  const seenDirs = /* @__PURE__ */ new Set();
  while (stack.length) {
    if (out.length >= maxFiles) break;
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
    for (const name of entries) {
      const abs = join(dir, name);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (IGNORE_DIRS.has(name)) continue;
        stack.push(abs);
        continue;
      }
      if (!st.isFile()) continue;
      if (st.size > maxFileBytes) continue;
      if (LOCKFILES.has(name.toLowerCase())) continue;
      const ext = extname(name).toLowerCase();
      if (BINARY_EXT.has(ext)) continue;
      if (name.endsWith(".min.js") || name.endsWith(".min.css")) continue;
      out.push({ rel: relative(root, abs).split(sep).join("/"), abs, size: st.size, ext });
    }
  }
  return out;
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
function sh(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
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
function keywords(question) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const raw of question.split(/[^A-Za-z0-9_]+/)) {
    if (!raw) continue;
    const lower = raw.toLowerCase();
    if (raw.length < 2) continue;
    if (STOPWORDS.has(lower)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(raw);
  }
  return out;
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
  const out = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    for (const rule of rules) {
      const m = rule.re.exec(line);
      if (!m) continue;
      const name = m.groups?.name ?? m[1];
      if (!name) continue;
      const exported = typeof rule.exported === "function" ? rule.exported(m, line) : rule.exported ?? false;
      out.push({
        name,
        kind: rule.kind,
        file: rel,
        line: i + 1,
        signature: line.trim().slice(0, 200),
        exported,
        lang
      });
      break;
    }
  }
  return out;
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
var pub = (name) => !name.startsWith("_") || name.startsWith("__");
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
var upper = (name) => /^[A-Z]/.test(name);
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
  for (let i = 0; i < glob.length; i++) {
    const c2 = glob[i];
    if (c2 === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
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
  const out = [];
  let fence2 = null;
  for (const line of lines) {
    const m = /^\s*(```+|~~~+)/.exec(line);
    if (fence2) {
      if (m && line.trim().startsWith(fence2[0][0].repeat(3).slice(0, 3))) fence2 = null;
      out.push("");
      continue;
    }
    if (m) {
      fence2 = m[1];
      out.push("");
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
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
  let body = content;
  let frontTitle;
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(body);
  if (fm) {
    const t = /(^|\n)title:\s*["']?(.+?)["']?\s*(\n|$)/i.exec(fm[1]);
    if (t) frontTitle = t[2].trim();
    body = body.slice(fm[0].length);
  }
  const scan2 = stripFences(body);
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

// src/extract/code.ts
var JS_TS = /* @__PURE__ */ new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
var PY = /* @__PURE__ */ new Set([".py", ".pyi"]);
var DIRECTIVE_RE = /^(eslint\b|eslint-|prettier\b|prettier-|tslint\b|jshint\b|jslint\b|globals?\b|istanbul\b|c8\s|v8\s|@ts-|ts-|@flow\b|@jsx\b|@jsxRuntime\b|@jest-environment\b|@vitest-environment\b|@license\b|@preserve\b|@copyright\b|copyright\b|spdx-|<reference\b|use strict|biome-|deno-lint|noqa\b|type:\s*ignore|pylint:|flake8:|mypy:|coding[:=])/i;
function isDirective(line) {
  return DIRECTIVE_RE.test(line.trim());
}
function topDocComment(content) {
  const lines = content.split(/\r?\n/);
  const collected = [];
  let inBlock = null;
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const raw = lines[i];
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
function expandUseGroups(path, out = []) {
  if (out.length >= MAX_USE_EXPANSION) return out;
  const brace = path.indexOf("{");
  if (brace === -1) {
    const cleaned = path.replace(/\s+as\s+\w+\s*$/, "").replace(/::\s*\*\s*$/, "").replace(/^::/, "").trim();
    if (cleaned) out.push(cleaned);
    return out;
  }
  const prefix = path.slice(0, brace);
  let depth = 0;
  let end = -1;
  for (let i = brace; i < path.length; i++) {
    if (path[i] === "{") depth++;
    else if (path[i] === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end === -1) return out;
  const parts = [];
  let cur = "";
  depth = 0;
  for (const ch of path.slice(brace + 1, end)) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  for (const part of parts) {
    const t = part.trim();
    if (!t) continue;
    if (t === "self") expandUseGroups(prefix.replace(/::\s*$/, ""), out);
    else expandUseGroups(prefix + t, out);
  }
  return out;
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
          const name = part.trim().split(/\s+as\s+/)[0].trim();
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
  }
  return [...specs].map((spec) => ({ kind: "import", spec }));
}
function extractReexports(rel, content) {
  if (!JS_TS.has(rel.slice(rel.lastIndexOf(".")))) return [];
  const lang = /\.(ts|tsx|mts|cts)$/.test(rel) ? "typescript" : "javascript";
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const lineAt = (idx) => content.slice(0, idx).split(/\r?\n/).length;
  const named = /export\s*\{([\s\S]*?)\}\s*(?:from\s*['"]([^'"]+)['"])?\s*;?/g;
  let m;
  while ((m = named.exec(content)) && out.length < 60) {
    const from = m[2];
    for (const part of m[1].split(",")) {
      const p = part.trim().replace(/^type\s+/, "");
      const as = /^(\S+)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(p);
      const name = as ? as[2] : p;
      if (!/^[A-Za-z_$][\w$]*$/.test(name) || name === "default" || seen.has(name)) continue;
      seen.add(name);
      out.push({
        name,
        kind: "reexport",
        file: rel,
        line: lineAt(m.index),
        signature: from ? `export { ${name} } from "${from}"` : `export { ${name} }`,
        exported: true,
        lang
      });
    }
  }
  const star = /export\s*\*\s*(?:as\s+([A-Za-z_$][\w$]*)\s+)?from\s*['"]([^'"]+)['"]/g;
  while ((m = star.exec(content)) && out.length < 60) {
    const ns = m[1];
    const from = m[2];
    const key = "*" + (ns ?? from);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: ns ?? `* (${from})`,
      kind: ns ? "reexport" : "reexport-all",
      file: rel,
      line: lineAt(m.index),
      signature: `export * ${ns ? `as ${ns} ` : ""}from "${from}"`,
      exported: true,
      lang
    });
  }
  return out;
}
function extractCode(rel, ext, content) {
  const symbols = extractSymbols(rel, ext, content).slice(0, 400);
  const known = new Set(symbols.map((s) => s.name));
  const reexports = extractReexports(rel, content).filter((s) => !known.has(s.name));
  return {
    symbols: [...symbols, ...reexports],
    summary: topDocComment(content),
    refs: extractImports(ext, content),
    pkg: ext === ".java" ? /^\s*package\s+([\w.]+)\s*;/m.exec(content)?.[1] : void 0
  };
}

// src/scan.ts
function countLines(s) {
  if (!s) return 0;
  let n = 1;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}
function scanRepo(root, opts = {}) {
  const include = compileGlobs(opts.include);
  const exclude = compileGlobs(opts.exclude);
  const walked = walk(root, { maxFileBytes: opts.maxBytes });
  const outPrefix = opts.out ? opts.out.replace(/\/+$/, "") + "/" : null;
  const files = [];
  const languages = {};
  for (const f of walked) {
    if (outPrefix && (f.abs === opts.out || f.abs.startsWith(outPrefix))) continue;
    if (include && !include(f.rel)) continue;
    if (exclude && exclude(f.rel)) continue;
    const kind = classify(f.rel, f.ext);
    const lang = extToLang(f.ext);
    languages[lang] = (languages[lang] ?? 0) + 1;
    const content = readText(f.abs);
    const record = {
      rel: f.rel,
      ext: f.ext,
      size: f.size,
      lines: countLines(content),
      hash: sha1(content),
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
      } else {
        record.title = basename(f.rel);
      }
    } else {
      record.title = basename(f.rel);
    }
    files.push(record);
  }
  files.sort(byKey((f) => f.rel));
  return { root, commit: headCommit(root), files, languages };
}

// src/resolve.ts
import { posix } from "path";
import { join as join2 } from "path";
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
var BUILD_DIRS = /* @__PURE__ */ new Set(["dist", "build", "lib", "out", "output", "esm", "cjs", "umd"]);
function distToSrcCandidates(target) {
  const segs = norm(target).split("/").filter((s) => s !== ".");
  const out = [];
  let i = 0;
  while (i < segs.length - 1 && BUILD_DIRS.has(segs[i])) {
    i++;
    const rest = segs.slice(i).join("/");
    out.push("src/" + rest, rest);
  }
  return out;
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
  for (let i = 0; i < text.length; i++) {
    const c2 = text[i];
    if (inStr) {
      stripped += c2;
      if (c2 === "\\") stripped += text[++i] ?? "";
      else if (c2 === '"') inStr = false;
      continue;
    }
    if (c2 === '"') {
      inStr = true;
      stripped += c2;
    } else if (c2 === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      stripped += "\n";
    } else if (c2 === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else {
      stripped += c2;
    }
  }
  let out = "";
  inStr = false;
  for (let i = 0; i < stripped.length; i++) {
    const c2 = stripped[i];
    if (inStr) {
      out += c2;
      if (c2 === "\\") out += stripped[++i] ?? "";
      else if (c2 === '"') inStr = false;
      continue;
    }
    if (c2 === '"') {
      inStr = true;
      out += c2;
      continue;
    }
    if (c2 === ",") {
      let j = i + 1;
      while (j < stripped.length && (stripped[j] === " " || stripped[j] === "	" || stripped[j] === "\n" || stripped[j] === "\r")) j++;
      if (stripped[j] === "}" || stripped[j] === "]") continue;
    }
    out += c2;
  }
  try {
    return JSON.parse(out);
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
  const cfg = tolerantJsonParse(readText(join2(root, rel)));
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
  const i = CONDITION_PRIORITY.indexOf(key);
  if (i !== -1) return i;
  return key === "types" ? CONDITION_PRIORITY.length + 1 : CONDITION_PRIORITY.length;
}
function flattenExportTargets(value, out) {
  if (out.length >= MAX_EXPORT_TARGETS) return;
  if (typeof value === "string") {
    if (!out.includes(value)) out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) flattenExportTargets(v, out);
  } else if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort((a, b) => conditionRank(a) - conditionRank(b) || (a < b ? -1 : a > b ? 1 : 0));
    for (const k of keys) flattenExportTargets(value[k], out);
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
  const out = [];
  const addLine = (line) => {
    const m = /^\s*([^\s=]+)(?:\s+v\S+)?\s*=>\s*(\S+)(?:\s+v\S+)?\s*$/.exec(line);
    if (!m) return;
    const target = m[2];
    if (!/^\.\.?\//.test(target)) return;
    const toDir = norm(posix.join(modDir, target));
    if (toDir.startsWith("..")) return;
    out.push({ from: m[1], toDir });
  };
  for (const m of text.matchAll(/^[ \t]*replace[ \t]+([^(\r\n][^\r\n]*)$/gm)) addLine(m[1]);
  for (const b of text.matchAll(/^[ \t]*replace[ \t]*\(([\s\S]*?)\)/gm)) {
    for (const line of b[1].split(/\r?\n/)) addLine(line);
  }
  return out;
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
    const text = readText(join2(scan2.root, rel));
    const m = /^\s*module\s+(\S+)/m.exec(text);
    if (!m) continue;
    const dir = rel.includes("/") ? posix.dirname(rel) : "";
    goModules.push({ module: m[1], dir, replaces: parseGoReplaces(text, dir) });
  }
  goModules.sort((a, b) => b.dir.length - a.dir.length || (a.dir < b.dir ? -1 : 1));
  const rustCrates = [];
  for (const rel of fileSet) {
    if (rel !== "Cargo.toml" && !rel.endsWith("/Cargo.toml")) continue;
    const text = readText(join2(scan2.root, rel));
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
    const pkg = tolerantJsonParse(readText(join2(scan2.root, rel)));
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
  const probe = (p) => firstExisting(ctx, [...JS_EXT_PROBES.map((e) => p + e), ...JS_INDEX.map((i) => posix.join(p, i))]);
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
    for (let i = 1; i < dots; i++) dir = dir.includes("/") ? posix.dirname(dir) : "";
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
  const probeMod = (dir, name) => firstExisting(ctx, [posix.join(dir, name + ".rs"), posix.join(dir, name, "mod.rs")]);
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
    const name = spec.slice(4);
    const hit2 = probeMod(childDir, name) ?? (isRootish ? void 0 : probeMod(fromDir, name));
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
    let i = 1;
    while (i < segs.length && segs[i] === "super") {
      dir = dir.includes("/") ? posix.dirname(dir) : "";
      i++;
    }
    baseDir = dir;
    rest = segs.slice(i);
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
    const info = {
      slug,
      path: dir,
      title: dir,
      tier: tierOf(dir, members),
      members: members.map((m) => m.rel),
      summary: summaryOf(dir, members)
    };
    modules.push(info);
    for (const m of members) moduleOf.set(m.rel, slug);
  }
  modules.sort((a, b) => byStr(a.slug, b.slug));
  return { modules, moduleOf };
}

// src/graph.ts
import { join as join3 } from "path";
function isDistinctive(name) {
  if (name.length < 5) return false;
  const internalUpper = /[a-z][A-Z]/.test(name) || /[A-Z]{2}/.test(name);
  return internalUpper || name.includes("_") || /\d/.test(name);
}
var REFERENCE_KINDS = /* @__PURE__ */ new Set(["reexport", "reexport-all", "default"]);
function uniqueSymbolDefs(scan2) {
  const byName = /* @__PURE__ */ new Map();
  for (const f of scan2.files) {
    for (const s of f.symbols) {
      if (!s.exported || REFERENCE_KINDS.has(s.kind) || !isDistinctive(s.name)) continue;
      let set = byName.get(s.name);
      if (!set) byName.set(s.name, set = /* @__PURE__ */ new Set());
      set.add(f.rel);
    }
  }
  const unique = /* @__PURE__ */ new Map();
  for (const [name, files] of byName) if (files.size === 1) unique.set(name, [...files][0]);
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
        }
      }
    }
  }
  const unique = uniqueSymbolDefs(scan2);
  if (unique.size) {
    for (const f of scan2.files) {
      if (f.kind !== "doc") continue;
      const content = readText(join3(scan2.root, f.rel));
      if (!content) continue;
      const tokens = /* @__PURE__ */ new Map();
      for (const tok of content.split(/[^A-Za-z0-9_]+/)) {
        if (unique.has(tok)) tokens.set(tok, (tokens.get(tok) ?? 0) + 1);
      }
      for (const [name, count] of tokens) {
        const target = unique.get(name);
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
  const KIND_RANK = { import: 3, "doc-link": 2, mention: 1, contains: 0 };
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

// src/merge.ts
var ENRICH_MARKER = "<!-- ui:enrich -->";
function isEnrichedBody(body) {
  return body.trim() !== "" && !body.includes(ENRICH_MARKER);
}
var OPEN_RE = /^<!--\s*ui:(gen|human)\s+key=([A-Za-z0-9_-]+)(?:\s+hash=([a-f0-9]+))?\s*-->\s*$/;
var CLOSE_RE = /^<!--\s*\/ui:(gen|human)\s+key=([A-Za-z0-9_-]+)\s*-->\s*$/;
function trimBlank(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start++;
  while (end > start && lines[end - 1].trim() === "") end--;
  return lines.slice(start, end).join("\n");
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
    const body = trimBlank(orphan);
    orphan = [];
    if (body) regions.push({ type: "human", key: `orphan-${shortHash(body)}`, body });
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
  const out = /* @__PURE__ */ new Map();
  const { regions, ok } = parseRegions(text);
  if (!ok) return out;
  for (const r of regions) if (r.type === "human") out.set(r.key, r.body);
  return out;
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
  const out = spec.map((r) => {
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
  for (const [key, body] of existingHuman) if (!specKeys.has(key)) appended.set(key, body);
  if (migrated) {
    for (const [key, body] of migrated) {
      if (specKeys.has(key) || appended.has(key)) continue;
      const mk = key.startsWith("migrated-from-") || key.startsWith("orphan-") ? key : `migrated-${key}`;
      appended.set(mk, body);
      migratedKeysUsed.push(mk);
    }
  }
  for (const key of [...appended.keys()].sort(byStr)) {
    out.push({ type: "human", key, body: appended.get(key) });
  }
  const humanKeys = out.filter((r) => r.type === "human").map((r) => r.key);
  return { content: serializeRegions(out), humanKeys, migratedKeys: migratedKeysUsed, conflict: dupConflict };
}

// src/render/encyclopedia.ts
var TIER_LABEL = { 0: "Foundations", 1: "Features", 2: "Tail" };
var MAX_SYMBOLS_PER_FILE = 15;
var MAX_DANGLING = 12;
var MAX_LINKS = 30;
function headerRegion(m) {
  const where = m.path === "(root)" ? "Repository root" : m.path;
  const body = [
    `# ${where}`,
    "",
    m.summary,
    "",
    `*Module \`${m.slug}\` \xB7 tier ${m.tier} (${TIER_LABEL[m.tier]}) \xB7 ${m.members.length} files \xB7 ${m.symbols} symbols*`
  ].join("\n");
  return { type: "gen", key: "header", body };
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
function linksRegion(m, graph, moduleOf) {
  const render = (edges, other) => {
    const sorted = edges.sort((a, b) => b.weight - a.weight || byStr(other(a), other(b)));
    const shown = sorted.slice(0, MAX_LINKS).map((e) => {
      const o = other(e);
      return `[\`${o}\`](${o}.md) (${e.kind}${e.weight > 1 ? ` \xD7${e.weight}` : ""})`;
    });
    if (sorted.length > MAX_LINKS) shown.push(`\u2026and ${sorted.length - MAX_LINKS} more`);
    return shown;
  };
  const out = render(graph.moduleEdges.filter((e) => e.from === m.slug), (e) => e.to);
  const inc = render(graph.moduleEdges.filter((e) => e.to === m.slug), (e) => e.from);
  const dangling = graph.fileEdges.filter((e) => e.dangling && moduleOf.get(e.from) === m.slug).sort((a, b) => byStr(a.from, b.from) || byStr(a.to, b.to)).slice(0, MAX_DANGLING).map((e) => `\`${e.to}\` (${e.kind}, ${e.reason}) \u2014 from \`${e.from}\``);
  const bulletList = (items) => items.length ? items.map((i) => `- ${i}`) : ["_none_"];
  const lines = ["## Links"];
  lines.push("");
  lines.push("**Depends on / links out:**");
  lines.push(...bulletList(out));
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
function renderEntrySpec(m, graph, records, moduleOf) {
  return [
    headerRegion(m),
    businessStub(),
    codeViewRegion(m, records),
    linksRegion(m, graph, moduleOf),
    sourcePointersRegion(m, records),
    gotchasStub()
  ];
}

// src/render/index-md.ts
var TIER_LABEL2 = { 0: "Foundations", 1: "Features", 2: "Tail" };
var HUB_CAP = 12;
var MODULE_CAP = 120;
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
  const out = {};
  for (const k of Object.keys(obj).sort(byStr)) out[k] = obj[k];
  return out;
}
function renderGraphJson(graph) {
  const ordered = { ...graph, languages: sortObject(graph.languages) };
  return JSON.stringify(ordered, null, 2) + "\n";
}

// src/render/manifest.ts
function sortedRecord(obj) {
  const out = {};
  for (const k of Object.keys(obj).sort(byStr)) out[k] = obj[k];
  return out;
}
function buildManifest(scan2, graph, outRel, sync, builtAt, extraNotes = [], filters = {}) {
  const fileHashes = {};
  for (const f of scan2.files) fileHashes[f.rel] = f.hash;
  const modules = {};
  for (const m of graph.modules) {
    modules[m.slug] = { members: m.members, humanKeys: (sync.humanKeys[m.slug] ?? []).slice().sort(byStr) };
  }
  const scanFilters = {};
  if (filters.include?.length) scanFilters.include = filters.include;
  if (filters.exclude?.length) scanFilters.exclude = filters.exclude;
  if (filters.maxBytes !== void 0) scanFilters.maxBytes = filters.maxBytes;
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
    ...Object.keys(scanFilters).length ? { scan: scanFilters } : {}
  };
}
function renderManifestJson(manifest) {
  return JSON.stringify(manifest, null, 2) + "\n";
}

// src/entries.ts
import { join as join5 } from "path";

// src/output.ts
import { existsSync, mkdirSync, readFileSync as readFileSync2, writeFileSync, renameSync, rmSync, readdirSync as readdirSync2 } from "fs";
import { dirname, join as join4 } from "path";
function readIfExists(path) {
  try {
    return existsSync(path) ? readFileSync2(path, "utf8") : void 0;
  } catch {
    return void 0;
  }
}
function writeFileIfChanged(path, content) {
  const current = readIfExists(path);
  if (current === content) return false;
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
  return true;
}
function moveFile(from, to) {
  if (!existsSync(from)) return;
  mkdirSync(dirname(to), { recursive: true });
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
  const encDir = join5(outDir, "encyclopedia");
  const orphanDir = join5(encDir, "_orphaned");
  const entryPath = (slug) => join5(encDir, `${slug}.md`);
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
      moveFile(path, join5(orphanDir, `${old}.md`));
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
import { join as join6 } from "path";
function indexPaths(outDir) {
  return {
    index: join6(outDir, "INDEX.md"),
    graph: join6(outDir, "graph.json"),
    manifest: join6(outDir, "manifest.json"),
    mermaid: join6(outDir, "graph.mmd"),
    encyclopedia: join6(outDir, "encyclopedia"),
    vectors: join6(outDir, "vectors.json"),
    semantic: join6(outDir, "semantic.json")
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

// src/build.ts
function runBuild(opts, builtAt) {
  const scan2 = scanRepo(opts.repo, {
    include: opts.include,
    exclude: opts.exclude,
    maxBytes: opts.maxBytes,
    out: opts.out
  });
  const ctx = buildResolveContext(scan2);
  const { modules, moduleOf } = buildModules(scan2);
  const graph = buildGraph(scan2, ctx, modules, moduleOf);
  const records = new Map(scan2.files.map((f) => [f.rel, f]));
  const paths = indexPaths(opts.out);
  ensureDir(opts.out);
  const prev = loadManifest(opts.out);
  const entryInputs = graph.modules.map((m) => ({
    slug: m.slug,
    members: m.members,
    spec: renderEntrySpec(m, graph, records, moduleOf)
  }));
  const sync = syncEntries(opts.out, entryInputs, prev?.modules ?? {});
  const mermaid = opts.mermaid ? renderMermaid(graph) : void 0;
  writeFileIfChanged(paths.graph, renderGraphJson(graph));
  if (mermaid) writeFileIfChanged(paths.mermaid, mermaid.content);
  else removeFile(paths.mermaid);
  writeFileIfChanged(paths.index, renderIndex(graph, { repoName: basename2(opts.repo) || "repo", mermaid }));
  const extraNotes = [
    ...ctx.warnings,
    ...opts.mermaid ? [] : ["mermaid diagram disabled (--no-mermaid)"]
  ];
  const outRel = !isAbsolute(relative2(opts.repo, opts.out)) && !relative2(opts.repo, opts.out).startsWith("..") ? relative2(opts.repo, opts.out) : opts.out;
  const manifest = buildManifest(scan2, graph, outRel, sync, builtAt, extraNotes, {
    include: opts.include,
    exclude: opts.exclude,
    maxBytes: opts.maxBytes
  });
  writeFileIfChanged(paths.manifest, renderManifestJson(manifest));
  return { outDir: opts.out, graph, manifest };
}

// src/find.ts
import { join as join7 } from "path";

// src/lex.ts
function splitIdentifier(token) {
  const spaced = token.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/([A-Za-z])(\d)/g, "$1 $2").replace(/(\d)([A-Za-z])/g, "$1 $2");
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const part of spaced.split(/[^A-Za-z0-9]+| /)) {
    if (!part) continue;
    const lower = part.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(lower);
  }
  return out;
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
    const parts = splitIdentifier(raw).filter((p) => p !== exact && keywords(p).length > 0);
    const forms = /* @__PURE__ */ new Set();
    for (const f of [stem(exact), ...parts, ...parts.map(stem)]) {
      if (f !== exact) forms.add(f);
    }
    const groups = /* @__PURE__ */ new Set();
    for (const f of [exact, ...parts]) {
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
  const counts = /* @__PURE__ */ new Map();
  const groups = /* @__PURE__ */ new Map();
  let length = 0;
  for (const tok of text.split(/[^A-Za-z0-9_]+/)) {
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
  return { counts, groups, raw: text.toLowerCase(), length };
}
function scoreHaystack(hay, terms, saturate = false) {
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
    score += saturate ? weight * Math.min(1.5, 1 + Math.log1p(count - 1) * 0.25) : weight;
    matched.push(t.raw);
  }
  if (saturate) score /= 1 + Math.log(Math.max(1, hay.length / 200));
  return { score, matched };
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
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
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
      const body = clip(await res.text().catch(() => ""), 200);
      throw new Error(`embeddings provider returned ${res.status} for ${url}${body ? `: ${body}` : ""}`);
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
    out.push(...rows);
  }
  return out;
}
var EMBED_TEXT_MAX = 4e3;
function moduleEmbedText(m, files, prose) {
  const members = files.slice().sort((a, b) => byStr(a.rel, b.rel)).map((f) => [f.rel, f.title, f.summary].filter(Boolean).join(" \u2014 "));
  const parts = [m.title, m.path, m.slug, m.summary, ...members, prose ?? ""];
  return clip(parts.filter(Boolean).join("\n"), EMBED_TEXT_MAX);
}
function cosine(a, b) {
  if (a.length !== b.length || a.length === 0) return -1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
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
    toEmbed.forEach((t, i) => {
      next.vectors[t.slug] = { hash: t.hash, v: round6(vectors[i]) };
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
function moduleNeighbors(graph, slug) {
  const ns = [
    ...graph.moduleEdges.filter((e) => e.from === slug).map((e) => e.to),
    ...graph.moduleEdges.filter((e) => e.to === slug).map((e) => e.from)
  ];
  return [...new Set(ns)].sort(byStr).slice(0, 8);
}
function textOf(parts) {
  return parts.filter(Boolean).join(" ").toLowerCase();
}
var PROSE_WEIGHT = 1.5;
function loadEnrichedProse(outDir, graph) {
  const enc = indexPaths(outDir).encyclopedia;
  const out = /* @__PURE__ */ new Map();
  for (const m of graph.modules) {
    const text = readIfExists(join7(enc, `${m.slug}.md`));
    if (!text) continue;
    const bodies = [...humanBodies(text).values()].filter(isEnrichedBody);
    if (!bodies.length) continue;
    out.set(m.slug, bodies.join(" ").replace(/\[[^\]]*\]/g, " ").toLowerCase());
  }
  return out;
}
function findModules(graph, query, k = DEFAULT_K, prose) {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const filesByModule = /* @__PURE__ */ new Map();
  for (const f of graph.files) {
    let list = filesByModule.get(f.module);
    if (!list) filesByModule.set(f.module, list = []);
    list.push(f);
  }
  const scored = [];
  for (const m of graph.modules) {
    const members = filesByModule.get(m.slug) ?? [];
    const summary = /^\d+ file\(s\) in /.test(m.summary) ? void 0 : m.summary;
    const moduleHay = textOf([m.slug, m.path, summary]);
    const mod = scoreHaystack(buildHaystack(moduleHay), terms);
    const enrichedText = prose?.get(m.slug);
    const pro = enrichedText ? scoreHaystack(buildHaystack(enrichedText), terms, true) : { score: 0, matched: [] };
    const scoredFiles = members.map((f) => {
      const hay = textOf([f.rel, f.title, f.summary]);
      const s = scoreHaystack(buildHaystack(hay), terms);
      return { f, score: s.score, matched: s.matched, degree: f.degIn + f.degOut };
    }).sort((a, b) => b.score - a.score || b.degree - a.degree || byStr(a.f.rel, b.f.rel));
    const bestFile = scoredFiles[0]?.score ?? 0;
    const matchCount = scoredFiles.filter((x) => x.score > 0).length;
    if (mod.score === 0 && bestFile === 0 && pro.score === 0) continue;
    const matchedTerms = /* @__PURE__ */ new Set([...mod.matched, ...pro.matched, ...scoredFiles.flatMap((x) => x.matched)]);
    const coverageWeight = 0.4 + 0.6 * (matchedTerms.size / terms.length);
    const tierWeight = m.tier === 2 ? 0.45 : 1;
    const pathPenalty = /(^|\/|-|_)(tests?|demo|examples?|sandbox|stub|mock|fixtures?)(\/|-|_|$)/i.test(m.path) ? 0.55 : 1;
    const leaf = m.path.split("/").pop() ?? "";
    const genericPenalty = /^(stores?|components?|types?|utils?|hooks?|constants?|helpers?|styles?|assets?|queries|state)$/i.test(leaf) ? 0.8 : 1;
    const keywordScore = mod.score * 2 + pro.score * PROSE_WEIGHT + bestFile + Math.min(matchCount, 5) * 0.5;
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
  return scored.slice(0, k).map((x) => x.r);
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
  const lexical = findModules(graph, query, pool, prose);
  const store = loadVectors(outDir);
  if (!store) return { results: lexical.slice(0, k), semantic: false };
  const lexOnly = (warning) => ({ results: lexical.slice(0, k), semantic: false, warning });
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
  const semanticSlugs = Object.entries(store.vectors).filter(([slug]) => moduleBySlug.has(slug)).map(([slug, rec]) => ({ slug, cos: cosine(queryVector, rec.v) })).sort((a, b) => b.cos - a.cos || byStr(a.slug, b.slug)).slice(0, pool).map((s) => s.slug);
  const lexicalSlugs = lexical.map((r) => r.slug);
  const fused = rrf([lexicalSlugs, semanticSlugs], (s) => s);
  const lexRank = new Map(lexicalSlugs.map((s, i) => [s, i]));
  const semRank = new Map(semanticSlugs.map((s, i) => [s, i + 1]));
  const ordered = [...fused.entries()].sort((a, b) => b[1] - a[1] || (lexRank.get(a[0]) ?? 1e9) - (lexRank.get(b[0]) ?? 1e9) || byStr(a[0], b[0])).slice(0, k).map(([slug]) => slug);
  const lexRow = new Map(lexical.map((r) => [r.slug, r]));
  const filesByModule = /* @__PURE__ */ new Map();
  for (const f of graph.files) {
    let list = filesByModule.get(f.module);
    if (!list) filesByModule.set(f.module, list = []);
    list.push(f);
  }
  const results = ordered.map((slug) => {
    const sem = semRank.get(slug);
    const row2 = lexRow.get(slug) ?? bareRow(graph, moduleBySlug.get(slug), filesByModule.get(slug) ?? [], prose.has(slug));
    return sem !== void 0 ? { ...row2, semanticRank: sem } : row2;
  });
  return { results, semantic: true };
}

// src/neighbors.ts
function bfs(edges, start, depth) {
  const out = /* @__PURE__ */ new Map();
  const inn = /* @__PURE__ */ new Map();
  for (const e of edges) {
    if (e.dangling) continue;
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)).push(e);
    (inn.get(e.to) ?? inn.set(e.to, []).get(e.to)).push(e);
  }
  const seen = /* @__PURE__ */ new Set([start]);
  const links = [];
  let frontier = [start];
  for (let d = 1; d <= depth; d++) {
    const next = [];
    for (const node of frontier) {
      for (const e of (out.get(node) ?? []).slice().sort((a, b) => byStr(a.to, b.to))) {
        if (seen.has(e.to)) continue;
        links.push({ node: e.to, direction: "out", kind: e.kind, weight: e.weight, depth: d });
        seen.add(e.to);
        next.push(e.to);
      }
      for (const e of (inn.get(node) ?? []).slice().sort((a, b) => byStr(a.from, b.from))) {
        if (seen.has(e.from)) continue;
        links.push({ node: e.from, direction: "in", kind: e.kind, weight: e.weight, depth: d });
        seen.add(e.from);
        next.push(e.from);
      }
    }
    frontier = next;
  }
  return links;
}
function neighborsOf(graph, target, depth = 1) {
  const mod = graph.modules.find((m) => m.slug === target);
  if (mod) {
    return { target, scope: "module", links: bfs(graph.moduleEdges, target, depth), members: mod.members };
  }
  const file = graph.files.find((f) => f.rel === target);
  if (file) {
    return { target, scope: "file", links: bfs(graph.fileEdges, target, depth) };
  }
  return void 0;
}
function runNeighbors(outDir, target, depth = 1) {
  const graph = loadGraph(outDir);
  if (!graph) return void 0;
  return neighborsOf(graph, target, depth);
}

// src/mapcmd.ts
import { join as join8 } from "path";
function runMap(outDir, moduleSlug) {
  const paths = indexPaths(outDir);
  if (moduleSlug) {
    return readIfExists(join8(paths.encyclopedia, `${moduleSlug}.md`));
  }
  return readIfExists(paths.index);
}

// src/status.ts
import { join as join9 } from "path";
function runStatus(outDir) {
  const graph = loadGraph(outDir);
  if (!graph) return void 0;
  const enc = indexPaths(outDir).encyclopedia;
  const modules = graph.modules.map((m) => {
    let total = 0;
    let filled = 0;
    const text = readIfExists(join9(enc, `${m.slug}.md`));
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
import { join as join10 } from "path";

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
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (rawIn) => {
    const raw = rawIn.trim().replace(/[.,;]+$/, "");
    if (!looksLikePath(raw) || seen.has(raw)) return;
    seen.add(raw);
    let path = raw;
    let start;
    let end;
    const ls = LINE_SUFFIX.exec(raw);
    if (ls) {
      path = raw.slice(0, ls.index);
      start = Number(ls[1]);
      end = ls[2] ? Number(ls[2]) : void 0;
    }
    if (path) out.push({ raw, path, start, end });
  };
  let m;
  EXT_TOKEN.lastIndex = 0;
  while (m = EXT_TOKEN.exec(prose)) add(m[1]);
  SIMPLE_TOKEN.lastIndex = 0;
  while (m = SIMPLE_TOKEN.exec(prose)) add(m[1]);
  return out;
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

// src/check.ts
function hashRepo(repo, outAbs, filters) {
  const outPrefix = outAbs.replace(/\/+$/, "") + "/";
  const include = compileGlobs(filters?.include);
  const exclude = compileGlobs(filters?.exclude);
  const out = {};
  for (const f of walk(repo, { maxFileBytes: filters?.maxBytes })) {
    if (f.abs === outAbs || f.abs.startsWith(outPrefix)) continue;
    if (include && !include(f.rel)) continue;
    if (exclude && exclude(f.rel)) continue;
    out[f.rel] = sha1(readText(f.abs));
  }
  return out;
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
    if (readIfExists(join10(enc, `${m.slug}.md`)) === void 0) {
      errors.push(`module "${m.slug}" has no encyclopedia entry`);
    }
  }
  const nodes = new Set(graph.files.map((f) => f.rel));
  for (const e of graph.fileEdges) {
    if (!e.dangling && !nodes.has(e.to)) errors.push(`edge ${e.from} \u2192 ${e.to} (${e.kind}) points at a non-existent node`);
  }
  const fileLines = fileLineTable(graph);
  for (const m of graph.modules) {
    const text = readIfExists(join10(enc, `${m.slug}.md`));
    if (!text) continue;
    const parsed = parseRegions(text);
    if (!parsed.ok) continue;
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
function checkAnswer(outDir, answerPath) {
  const errors = [];
  const graph = loadGraph(outDir);
  if (!graph) return { ok: false, citations: 0, resolved: 0, errors: ["no index \u2014 run `ultraindex build` first"] };
  const text = readIfExists(answerPath);
  if (text === void 0) return { ok: false, citations: 0, resolved: 0, errors: [`answer file not found: ${answerPath}`] };
  const cc = checkCitations(text, fileLineTable(graph));
  const attempts = cc.resolved.length + cc.unresolved.length;
  if (attempts === 0) errors.push("answer has no citations \u2014 cite every claim with [file:line] (bare brackets, not a markdown link)");
  for (const u of cc.unresolved) errors.push(`citation [${u.citation.raw}] \u2014 ${u.reason}`);
  return { ok: errors.length === 0, citations: attempts, resolved: cc.resolved.length, errors };
}

// src/evidence.ts
import { join as join11, extname as extname2 } from "path";
var HEAD_LINES = 120;
var MAX_SYMS = 25;
var ASK_FILE_CAP = 20;
function gatherEvidence(repo, rels, headLines = HEAD_LINES) {
  const out = [];
  for (const rel of rels) {
    const content = readText(join11(repo, rel));
    if (!content) continue;
    const lines = content.split(/\r?\n/);
    const code = extractCode(rel, extname2(rel).toLowerCase(), content);
    const exported = code.symbols.filter((s) => s.exported).slice(0, MAX_SYMS).map((s) => ({ kind: s.kind, name: s.name, line: s.line, signature: s.signature }));
    out.push({
      rel,
      lines: lines.length,
      exported,
      head: lines.slice(0, headLines).join("\n"),
      headTo: Math.min(lines.length, headLines)
    });
  }
  return out;
}
function fence(rel) {
  const lang = extToLang(extname2(rel).toLowerCase());
  const map = { typescript: "ts", javascript: "js", python: "py", markdown: "md" };
  return map[lang] ?? (lang === "other" ? "" : lang);
}
function renderFile(e) {
  const parts = [`### \`${e.rel}\` (${e.lines} lines)`];
  if (e.exported.length) {
    parts.push("", "Exported:");
    for (const s of e.exported) {
      const sig = s.signature ? ` \u2014 \`${clip(s.signature, 100).split("\n")[0]}\`` : "";
      parts.push(`- \`${s.kind} ${s.name}\` @ line ${s.line}${sig}`);
    }
  }
  parts.push("", `Source (lines 1-${e.headTo}${e.headTo < e.lines ? ", file continues\u2026" : ""}):`, "```" + fence(e.rel), e.head, "```");
  return parts.join("\n");
}
function keyFiles(graph, module, cap) {
  const nodes = new Map(graph.files.map((f) => [f.rel, f]));
  return module.members.filter((rel) => nodes.get(rel)?.fileKind === "code").sort((a, b) => {
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
var CITE_HELP = "Cite every factual claim with the file it rests on, in brackets: `[path]`, `[path:line]`, or `[path:start-end]` (e.g. `[src/api/client.ts:42-58]`). `ultraindex check` fails if a citation does not resolve to a real file/line.";
function renderModuleDossier(repo, graph, module) {
  const files = keyFiles(graph, module, 6);
  const evidence = gatherEvidence(repo, files);
  const neighbors = neighborLines(graph, module.slug);
  const lines = [
    `# Dossier \u2014 module \`${module.slug}\`  (\`${module.path}\`, tier ${module.tier})`,
    "",
    `${module.members.length} files \xB7 ${module.symbols} symbols \xB7 entry: encyclopedia/${module.slug}.md`,
    "",
    "## Task",
    `Read the REAL code below and write a grounded business analysis into the \`ui:human\` regions of \`encyclopedia/${module.slug}.md\`: what this module does for the product, how it connects to the rest, and any gotchas. ${CITE_HELP}`
  ];
  if (neighbors.length) {
    lines.push("", "## Graph neighbours", ...neighbors);
  }
  lines.push("", "## Key source");
  if (evidence.length) for (const e of evidence) lines.push("", renderFile(e));
  else if (files.length)
    lines.push("", `\u26A0\uFE0F ${files.length} code file(s) in this module but none were readable under \`${repo}\` \u2014 pass \`--repo <repo-root>\` (the index records its root; this usually means a wrong working directory).`);
  else lines.push("", "_(no code files in this module \u2014 likely docs/config)_");
  return lines.join("\n") + "\n";
}
function renderAskDossier(repo, graph, question, modules) {
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
  if (evidence.length) for (const e of evidence) lines.push("", renderFile(e));
  else if (rels.length)
    lines.push("", `\u26A0\uFE0F matched ${rels.length} file(s) but none were readable under \`${repo}\` \u2014 pass \`--repo <repo-root>\` (the index records its root).`);
  else lines.push("", "_(no modules matched your question \u2014 try different keywords or `ultraindex find`)_");
  return lines.join("\n") + "\n";
}

// src/explain.ts
function runDossier(outDir, repo, slug) {
  const graph = loadGraph(outDir);
  if (!graph) return void 0;
  const module = graph.modules.find((m) => m.slug === slug);
  if (!module) return void 0;
  return renderModuleDossier(repo, graph, module);
}
function runAsk(outDir, repo, question, k = 5) {
  const graph = loadGraph(outDir);
  if (!graph) return void 0;
  const results = findModules(graph, question, k);
  const modules = results.map((r) => ({ slug: r.slug, files: r.files }));
  return { content: renderAskDossier(repo, graph, question, modules), modules: results.map((r) => r.slug) };
}

// src/cli.ts
var HELP = `ultraindex v${VERSION}
Deterministically index a whole repo (code + docs) into a navigable encyclopedia
\u2014 a small map, per-module entries, and a typed link-graph \u2014 so an AI can work in
huge codebases without filling its context window. Zero deps, no keys.

Usage:
  ultraindex build   --repo <dir> [--out <dir>] [--include <glob>] [--exclude <glob>] [--no-mermaid]
  ultraindex find    "<query>" [--out <dir>] [--k <n>]
  ultraindex embed   [--out <dir>] [--force]
  ultraindex neighbors <file|module-slug> [--out <dir>] [--depth <n>]
  ultraindex map     [--out <dir>] [--module <slug>]
  ultraindex status  [--out <dir>]
  ultraindex dossier <module-slug> [--out <dir>] [--repo <dir>]
  ultraindex ask     "<question>" [--out <dir>] [--repo <dir>] [--k <n>]
  ultraindex check   [--out <dir>] [--repo <dir>] [--answer <file>]

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
  map        Print INDEX.md (the map) or one module's entry. With --json, emit
             the module table (slug, path, tier, degree, summary) for parsing.
  status     Show enrichment progress and the suggested order to enrich next \u2014
             unenriched first, foundations/features before tail, hubs first.
  dossier    Print a grounding packet for a module (its real key source + graph
             neighbours) so you can write a cited business analysis into its entry.
  ask        Assemble grounded evidence for a question (real source of the
             relevant modules) so you can answer it with citations.
  check      Report staleness + integrity + grounding (cited prose must resolve).
             With --answer <file>, validate that answer's citations instead.

Options:
  --repo <dir>      Repo to index / check / read source from  (default: .)
  --out <dir>       Index output dir   (default: <repo>/.ultraindex, else docs/ultraindex if present)
  --include <glob>  Only index paths matching (comma-separated globs)
  --exclude <glob>  Skip paths matching (comma-separated globs)
  --max-bytes <n>   Skip files larger than n bytes
  --no-mermaid      Do not write graph.mmd
  --k <n>           find/ask: number of modules to return      (default: 8 / 5)
  --depth <n>       neighbors: hops to traverse                (default: 1)
  --module <slug>   map: print this module's entry instead of INDEX.md
  --answer <file>   check: validate this answer file's citations against the index
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
var COMMANDS = /* @__PURE__ */ new Set(["build", "find", "embed", "neighbors", "map", "status", "dossier", "ask", "check"]);
var VALUE_FLAGS = /* @__PURE__ */ new Set(["repo", "out", "include", "exclude", "max-bytes", "k", "depth", "module", "answer", "q", "question"]);
var BOOL_FLAGS = /* @__PURE__ */ new Set(["json", "no-mermaid", "quiet", "force"]);
var REASON_HINTS = {
  "missing-module": "a relative import's target file does not exist \u2014 usually a real broken import in the repo, worth reporting",
  "alias-unresolved": "a tsconfig path alias matched but its target file is missing \u2014 check the tsconfig paths or uncommitted build artifacts",
  "escapes-repo-root": "an import walks above the indexed root \u2014 index the parent directory, or ignore if intentional",
  "missing-package": "a Go import maps to a directory with no .go files \u2014 broken import or ungenerated code",
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
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
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
        const next = argv[i + 1];
        if (next === void 0 || next.startsWith("--")) fail(`missing value for --${key}`);
        value = next;
        i++;
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
  const parts = s.split(",").map((x) => x.trim()).filter(Boolean);
  return parts.length ? parts : void 0;
}
function resolveOut(p, base) {
  if (p.values.out) return resolve(p.values.out);
  const dotted = join12(base, ".ultraindex");
  if (existsSync2(dotted)) return dotted;
  const docs = join12(base, "docs", "ultraindex");
  if (existsSync2(docs)) return docs;
  return dotted;
}
function resolveRepoRoot(p, out) {
  if (p.values.repo) return resolve(p.values.repo);
  return loadManifest(out)?.repo ?? resolve(".");
}
function cmdBuild(p) {
  const repo = resolve(p.values.repo ?? ".");
  if (!existsSync2(repo)) fail(`repo not found: ${repo}`);
  const out = p.values.out ? resolve(p.values.out) : join12(repo, ".ultraindex");
  const maxBytes = p.values["max-bytes"] ? Number(p.values["max-bytes"]) : void 0;
  if (maxBytes !== void 0 && (!Number.isFinite(maxBytes) || maxBytes <= 0)) fail("invalid --max-bytes");
  const { graph, manifest } = runBuild(
    {
      repo,
      out,
      include: splitList(p.values.include),
      exclude: splitList(p.values.exclude),
      maxBytes,
      mermaid: !p.bools.has("no-mermaid"),
      json: p.bools.has("json")
    },
    (/* @__PURE__ */ new Date()).toISOString()
  );
  const danglingEdges = graph.fileEdges.filter((e) => e.dangling);
  const dangling = danglingEdges.length;
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
          out,
          files: graph.fileCount,
          modules: graph.modules.length,
          edges: graph.fileEdges.length,
          dangling,
          ...dangling ? { danglingByReason, reasonHints } : {},
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
    `ultraindex: built index for ${graph.fileCount} files`,
    `  out:      ${out}${graph.commit ? `  (@ ${graph.commit})` : ""}`,
    `  modules:  ${graph.modules.length} \xB7 links: ${graph.fileEdges.length}${dangling ? ` \xB7 dangling: ${dangling}` : ""}`,
    ...manifest.orphaned.length ? [`  orphaned: ${manifest.orphaned.length} (see encyclopedia/_orphaned/)`] : [],
    ...manifest.notes.length ? [`  notes:    ${manifest.notes.length} (see manifest.json)`] : [],
    `  next:     enrich encyclopedia/*.md (ui:human regions), then \`ultraindex check\``
  ];
  process.stderr.write(lines.join("\n") + "\n");
}
async function cmdFind(p) {
  const base = resolve(p.values.repo ?? ".");
  const out = resolveOut(p, base);
  const query = p.positional.join(" ").trim();
  if (!query) fail('missing query \u2014 usage: ultraindex find "<task keywords>"');
  const k = p.values.k ? Number(p.values.k) : 8;
  if (!Number.isFinite(k) || k <= 0) fail("invalid --k");
  const found = await runFindHybrid(out, query, k);
  if (found === void 0) fail(`no index at ${out} \u2014 run \`ultraindex build\` first`);
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
    lines.push(`\u25B8 ${r.slug}  (${r.path}, tier ${r.tier}, score ${r.score}${r.semanticRank !== void 0 ? `, semantic #${r.semanticRank}` : ""})`);
    if (r.matched.length) lines.push(`    matched: ${r.matched.join(", ")}`);
    lines.push(`    open:    ${r.files.join("  ") || "(no files)"}`);
    if (r.neighbors.length) lines.push(`    related: ${r.neighbors.join(", ")}`);
    lines.push(`    entry:   encyclopedia/${r.slug}.md`);
    lines.push("");
  }
  process.stdout.write(lines.join("\n"));
}
async function cmdEmbed(p) {
  const base = resolve(p.values.repo ?? ".");
  const out = resolveOut(p, base);
  const cfg = loadSemanticConfig(out);
  if (!cfg) {
    fail(
      `no semantic config \u2014 set ULTRAINDEX_EMBED_BASE_URL and ULTRAINDEX_EMBED_MODEL, or create ${join12(out, "semantic.json")} ({"baseUrl": "http://localhost:8080/v1", "model": "BAAI/bge-small-en-v1.5"}). To run a local provider: \`docker compose up -d\` (see docker-compose.yml)`
    );
  }
  const report = await runEmbed(out, cfg, p.bools.has("force"));
  if (report === void 0) fail(`no index at ${out} \u2014 run \`ultraindex build\` first`);
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
  const base = resolve(p.values.repo ?? ".");
  const out = resolveOut(p, base);
  const target = p.positional[0];
  if (!target) fail("missing target \u2014 usage: ultraindex neighbors <file|module-slug>");
  if (!indexExists(out)) fail(`no index at ${out} \u2014 run \`ultraindex build\` first`);
  const depth = p.values.depth ? Number(p.values.depth) : 1;
  if (!Number.isFinite(depth) || depth <= 0) fail("invalid --depth");
  const res = runNeighbors(out, target, depth);
  if (!res) fail(`"${target}" is not a module slug or file in the index`);
  if (p.bools.has("json")) {
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    return;
  }
  const lines = [`ultraindex: neighbours of ${res.scope} "${res.target}" (depth ${depth})`, ""];
  if (res.members) lines.push(`  members: ${res.members.join("  ")}`, "");
  if (res.links.length === 0) lines.push("  (no neighbours)");
  for (const l of res.links) {
    const arrow = l.direction === "out" ? "\u2192" : "\u2190";
    lines.push(`  ${arrow} ${l.node}  (${l.kind}${l.weight > 1 ? ` \xD7${l.weight}` : ""}, depth ${l.depth})`);
  }
  process.stdout.write(lines.join("\n") + "\n");
}
function cmdMap(p) {
  const base = resolve(p.values.repo ?? ".");
  const out = resolveOut(p, base);
  if (p.bools.has("json")) {
    if (p.values.module) fail("--json applies to the map view, not a single entry (read the markdown)");
    const graph = loadGraph(out);
    if (!graph) fail(`no index at ${out} \u2014 run \`ultraindex build\` first`);
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
  const content = runMap(out, p.values.module);
  if (content === void 0) {
    fail(p.values.module ? `no entry for module "${p.values.module}" at ${out}` : `no index at ${out} \u2014 run \`ultraindex build\` first`);
  }
  process.stdout.write(content.endsWith("\n") ? content : content + "\n");
}
function cmdStatus(p) {
  const base = resolve(p.values.repo ?? ".");
  const out = resolveOut(p, base);
  const res = runStatus(out);
  if (res === void 0) fail(`no index at ${out} \u2014 run \`ultraindex build\` first`);
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
  const out = resolveOut(p, resolve(p.values.repo ?? "."));
  const repo = resolveRepoRoot(p, out);
  const slug = p.positional[0];
  if (!slug) fail("missing module slug \u2014 usage: ultraindex dossier <module-slug>");
  const content = runDossier(out, repo, slug);
  if (content === void 0) {
    fail(indexExists(out) ? `no module "${slug}" in the index (try \`ultraindex map\`)` : `no index at ${out} \u2014 run \`ultraindex build\` first`);
  }
  process.stdout.write(content);
}
function cmdAsk(p) {
  const out = resolveOut(p, resolve(p.values.repo ?? "."));
  const repo = resolveRepoRoot(p, out);
  const question = (p.positional.join(" ") || p.values.q || p.values.question || "").trim();
  if (!question) fail('missing question \u2014 usage: ultraindex ask "<question>"');
  const k = p.values.k ? Number(p.values.k) : 5;
  if (!Number.isFinite(k) || k <= 0) fail("invalid --k");
  const res = runAsk(out, repo, question, k);
  if (res === void 0) fail(`no index at ${out} \u2014 run \`ultraindex build\` first`);
  if (p.bools.has("json")) {
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    return;
  }
  process.stdout.write(res.content);
}
function cmdCheck(p) {
  const out = resolveOut(p, resolve(p.values.repo ?? "."));
  const repo = resolveRepoRoot(p, out);
  if (p.values.answer) {
    const res2 = checkAnswer(out, resolve(p.values.answer));
    if (p.bools.has("json")) {
      process.stdout.write(JSON.stringify(res2, null, 2) + "\n");
    } else if (!p.bools.has("quiet")) {
      const lines = [`ultraindex: answer is ${res2.ok ? "GROUNDED" : "NOT GROUNDED"} (${res2.resolved}/${res2.citations} citations resolve)`];
      for (const e of res2.errors) lines.push(`  error:    ${e}`);
      process.stdout.write(lines.join("\n") + "\n");
    }
    if (!res2.ok) process.exit(1);
    return;
  }
  const res = runCheck(out, repo);
  if (p.bools.has("json")) {
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    if (!res.ok) process.exit(1);
    return;
  }
  if (!p.bools.has("quiet")) {
    const lines = [];
    const status = res.errors.length ? "BROKEN" : res.stale ? "STALE" : "FRESH";
    lines.push(`ultraindex: index is ${status} (${out})`);
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
  }
}
function isInvokedDirectly() {
  const argv1 = process.argv[1];
  if (argv1 === void 0) return false;
  const modulePath = fileURLToPath(import.meta.url);
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
