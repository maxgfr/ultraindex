#!/usr/bin/env node

// src/cli.ts
import { resolve, join as join9 } from "path";
import { existsSync as existsSync2 } from "fs";
import { pathToFileURL, fileURLToPath } from "url";
import { realpathSync } from "fs";

// src/types.ts
var VERSION = "0.0.0";
var SCHEMA_VERSION = 1;

// src/build.ts
import { basename as basename2, relative as relative2, isAbsolute } from "path";

// src/scan.ts
import { basename } from "path";

// src/walk.ts
import { readdirSync, statSync, readFileSync } from "fs";
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
  while (stack.length) {
    if (out.length >= maxFiles) break;
    const dir = stack.pop();
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
    const head = buf.subarray(0, 4096);
    if (head.includes(0)) return "";
    return buf.toString("utf8");
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
  { re: /^\s*(?:const|let)\s+(?<name>[\w$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::[^=]+)?=>/, kind: "const", exported: false }
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
  if (isDoc(rel, ext)) return "doc";
  if (isConfig(rel, ext)) return "config";
  if (isCode(ext)) return "code";
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
        if (glob[i + 1] === "/") i++;
        re += "(?:.*/)?";
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
  let fence = null;
  for (const line of lines) {
    const m = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      if (m && line.trim().startsWith(fence[0][0].repeat(3).slice(0, 3))) fence = null;
      out.push("");
      continue;
    }
    if (m) {
      fence = m[1];
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
  for (const line of lines) {
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      const text = cleanProse(h[2]);
      headings.push(text);
      if (!title && h[1].length === 1) title = text;
      continue;
    }
    if (!summary) {
      const t = line.trim();
      if (t && !/^([-*+]|\d+\.)\s/.test(t) && !t.startsWith("|") && !t.startsWith("<")) {
        const cleaned = cleanProse(t);
        if (cleaned.length >= 8 && hasProse(cleaned)) summary = cleaned.slice(0, 200);
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
var DIRECTIVE_RE = /^(eslint\b|eslint-|prettier\b|prettier-|tslint\b|jshint\b|jslint\b|globals?\b|istanbul\b|c8\s|v8\s|@ts-|ts-|@flow\b|@jsx\b|@jsxRuntime\b|@license\b|@preserve\b|@copyright\b|copyright\b|spdx-|use strict|biome-|deno-lint|noqa\b|type:\s*ignore|pylint:|flake8:|mypy:|coding[:=])/i;
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
function extractImports(ext, content) {
  const specs = /* @__PURE__ */ new Set();
  const lines = content.split(/\r?\n/);
  if (JS_TS.has(ext)) {
    for (const line of lines) {
      let m;
      const from = /(?:^|\s)(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/.exec(line);
      if (from) specs.add(from[1]);
      const bare = /^\s*import\s*['"]([^'"]+)['"]/.exec(line);
      if (bare) specs.add(bare[1]);
      const req = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
      while (m = req.exec(line)) specs.add(m[1]);
      const dyn = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
      while (m = dyn.exec(line)) specs.add(m[1]);
    }
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
  }
  return [...specs].map((spec) => ({ kind: "import", spec }));
}
function extractCode(rel, ext, content) {
  return {
    symbols: extractSymbols(rel, ext, content).slice(0, 400),
    summary: topDocComment(content),
    refs: extractImports(ext, content)
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
function norm(p) {
  return posix.normalize(p).replace(/\/$/, "");
}
function tolerantJsonParse(text) {
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const noLine = noBlock.replace(/(^|[^:])\/\/.*$/gm, "$1");
  const noTrailingComma = noLine.replace(/,(\s*[}\]])/g, "$1");
  try {
    return JSON.parse(noTrailingComma);
  } catch {
    return void 0;
  }
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
  let tsBaseUrl = "";
  const tsPaths = [];
  if (fileSet.has("tsconfig.json")) {
    const cfg = tolerantJsonParse(readText(join2(scan2.root, "tsconfig.json")));
    const co = cfg?.compilerOptions;
    if (co?.baseUrl) tsBaseUrl = norm(co.baseUrl).replace(/^\.$/, "");
    for (const [alias, targets] of Object.entries(co?.paths ?? {})) {
      const star = alias.endsWith("*");
      tsPaths.push({ prefix: star ? alias.slice(0, -1) : alias, star, targets });
    }
  }
  let goModule;
  let goModuleDir = "";
  const goModRel = [...fileSet].filter((r) => r.endsWith("go.mod")).sort((a, b) => a.length - b.length)[0];
  if (goModRel) {
    const m = /^\s*module\s+(\S+)/m.exec(readText(join2(scan2.root, goModRel)));
    if (m) {
      goModule = m[1];
      goModuleDir = goModRel.includes("/") ? posix.dirname(goModRel) : "";
    }
  }
  const pyRoots = /* @__PURE__ */ new Set([""]);
  for (const rel of fileSet) {
    const base = rel.split("/").pop();
    if (base === "__init__.py" || base === "pyproject.toml" || base === "setup.py") {
      pyRoots.add(rel.includes("/") ? posix.dirname(rel) : "");
    }
  }
  return { fileSet, dirSet, filesByDir, tsBaseUrl, tsPaths, goModule, goModuleDir, pyRoots: [...pyRoots] };
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
  return { kind: "external" };
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
function resolveGo(spec, ctx) {
  if (!ctx.goModule) return { kind: "external" };
  if (spec !== ctx.goModule && !spec.startsWith(ctx.goModule + "/")) return { kind: "external" };
  const sub = spec.slice(ctx.goModule.length).replace(/^\//, "");
  const dir = norm(posix.join(ctx.goModuleDir, sub)).replace(/^\.$/, "");
  const inDir = (ctx.filesByDir.get(dir) ?? []).filter((f) => f.endsWith(".go")).sort();
  return inDir.length ? { kind: "resolved", target: inDir[0] } : { kind: "dangling", reason: "missing-package" };
}
function resolveImport(fromRel, ext, spec, ctx) {
  const dot = spec.lastIndexOf(".");
  if (dot !== -1 && ASSET_EXT.has(spec.slice(dot).toLowerCase().replace(/[?#].*$/, ""))) {
    return { kind: "external" };
  }
  if (JS_TS2.has(ext)) return resolveJs(fromRel, spec, ctx);
  if (PY2.has(ext)) return resolvePython(fromRel, spec, ctx);
  if (ext === ".go") return resolveGo(spec, ctx);
  return { kind: "external" };
}

// src/modules.ts
import { posix as posix2 } from "path";
var ROOT_PATH = "(root)";
var TIER0 = /(^|\/)(types?|util|utils|lib|libs|common|core|config|configs|constants|shared|helpers|internal)$/i;
var TIER2_ANY = /(^|\/)(tests?|__tests__|spec|specs|__mocks__|__snapshots__|examples?|example|benchmark|benchmarks|fixtures?|docs?|documentation|\.github)(\/|$)/i;
var TIER2_LEAF = /(^|\/)(scripts?|bin|\.storybook)$/i;
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
  if (members.every((m) => m.kind === "doc" || m.kind === "config")) return 2;
  return 1;
}
function summaryOf(path, members) {
  const readme = members.find((m) => /^(readme|index)\.(md|mdx)$/i.test(m.rel.split("/").pop()));
  if (readme?.summary) return readme.summary;
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
  const usedSlugs = /* @__PURE__ */ new Set();
  const uniqueSlug = (base) => {
    let slug = base || "module";
    let n = 2;
    while (usedSlugs.has(slug)) slug = `${base}-${n++}`;
    usedSlugs.add(slug);
    return slug;
  };
  const modules = [];
  const moduleOf = /* @__PURE__ */ new Map();
  const dirs = [...byDir.keys()].sort(byStr);
  for (const dir of dirs) {
    const members = byDir.get(dir).slice().sort((a, b) => byStr(a.rel, b.rel));
    const slug = uniqueSlug(dir === ROOT_PATH ? "root" : slugify(dir));
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
  const mixedCase = /[a-z]/.test(name) && /[A-Z]/.test(name);
  return mixedCase || name.includes("_");
}
function uniqueSymbolDefs(scan2) {
  const byName = /* @__PURE__ */ new Map();
  for (const f of scan2.files) {
    for (const s of f.symbols) {
      if (!s.exported || !isDistinctive(s.name)) continue;
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
    const slug = moduleOf.get(f.rel);
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

// src/render/encyclopedia.ts
var TIER_LABEL = { 0: "Foundations", 1: "Features", 2: "Tail" };
var MAX_SYMBOLS_PER_FILE = 15;
var MAX_DANGLING = 12;
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
    body: "<!-- ui:enrich --> _What this module does for the product and how it connects to the rest of the system. Replace this paragraph during the enrichment pass._"
  };
}
function gotchasStub() {
  return {
    type: "human",
    key: "gotchas",
    body: "<!-- ui:enrich --> _Caveats, invariants, or pitfalls worth knowing before changing this module. Optional._"
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
  const out = graph.moduleEdges.filter((e) => e.from === m.slug).sort((a, b) => byStr(a.to, b.to)).map((e) => `[\`${e.to}\`](${e.to}.md) (${e.kind}${e.weight > 1 ? ` \xD7${e.weight}` : ""})`);
  const inc = graph.moduleEdges.filter((e) => e.to === m.slug).sort((a, b) => byStr(a.from, b.from)).map((e) => `[\`${e.from}\`](${e.from}.md) (${e.kind}${e.weight > 1 ? ` \xD7${e.weight}` : ""})`);
  const dangling = graph.fileEdges.filter((e) => e.dangling && moduleOf.get(e.from) === m.slug).sort((a, b) => byStr(a.from, b.from) || byStr(a.to, b.to)).slice(0, MAX_DANGLING).map((e) => `\`${e.to}\` (${e.kind}, ${e.reason}) \u2014 from \`${e.from}\``);
  const lines = ["## Links"];
  lines.push("");
  lines.push(`**Depends on / links out:** ${out.length ? out.join(", ") : "_none_"}`);
  lines.push("");
  lines.push(`**Used by / linked from:** ${inc.length ? inc.join(", ") : "_none_"}`);
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
function buildManifest(scan2, graph, outRel, sync, builtAt, extraNotes = []) {
  const fileHashes = {};
  for (const f of scan2.files) fileHashes[f.rel] = f.hash;
  const modules = {};
  for (const m of graph.modules) {
    modules[m.slug] = { members: m.members, humanKeys: (sync.humanKeys[m.slug] ?? []).slice().sort(byStr) };
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    version: VERSION,
    commit: scan2.commit,
    builtAt,
    out: outRel,
    fileHashes: sortedRecord(fileHashes),
    modules: sortedRecord(modules),
    orphaned: sync.orphaned.slice().sort(byStr),
    notes: [...extraNotes, ...sync.notes]
  };
}
function renderManifestJson(manifest) {
  return JSON.stringify(manifest, null, 2) + "\n";
}

// src/entries.ts
import { join as join5 } from "path";

// src/merge.ts
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
    for (const r of parsed.regions) if (r.type === "human") existingHuman.set(r.key, r.body);
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
  return { content: serializeRegions(out), humanKeys, migratedKeys: migratedKeysUsed };
}

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
    encyclopedia: join6(outDir, "encyclopedia")
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
  const extraNotes = opts.mermaid ? [] : ["mermaid diagram disabled (--no-mermaid)"];
  const outRel = !isAbsolute(relative2(opts.repo, opts.out)) && !relative2(opts.repo, opts.out).startsWith("..") ? relative2(opts.repo, opts.out) : opts.out;
  const manifest = buildManifest(scan2, graph, outRel, sync, builtAt, extraNotes);
  writeFileIfChanged(paths.manifest, renderManifestJson(manifest));
  return { outDir: opts.out, graph, manifest };
}

// src/find.ts
var DEFAULT_K = 8;
var MAX_FILES = 8;
function textOf(parts) {
  return parts.filter(Boolean).join(" ").toLowerCase();
}
function scoreText(hay, kws) {
  let score = 0;
  const matched = [];
  for (const kw of kws) {
    const k = kw.toLowerCase();
    const word = new RegExp(`(^|[^a-z0-9_])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9_]|$)`);
    if (word.test(hay)) {
      score += 3;
      matched.push(kw);
    } else if (hay.includes(k)) {
      score += 1;
      matched.push(kw);
    }
  }
  return { score, matched };
}
function findModules(graph, query, k = DEFAULT_K) {
  const kws = keywords(query);
  if (kws.length === 0) return [];
  const filesByModule = /* @__PURE__ */ new Map();
  for (const f of graph.files) {
    let list = filesByModule.get(f.module);
    if (!list) filesByModule.set(f.module, list = []);
    list.push(f);
  }
  const results = [];
  for (const m of graph.modules) {
    const members = filesByModule.get(m.slug) ?? [];
    const moduleHay = textOf([m.slug, m.path, m.summary]);
    const mod = scoreText(moduleHay, kws);
    const scoredFiles = members.map((f) => {
      const hay = textOf([f.rel, f.title, f.summary]);
      const s = scoreText(hay, kws);
      return { f, score: s.score, matched: s.matched, degree: f.degIn + f.degOut };
    }).sort((a, b) => b.score - a.score || b.degree - a.degree || byStr(a.f.rel, b.f.rel));
    const bestFile = scoredFiles[0]?.score ?? 0;
    const matchCount = scoredFiles.filter((x) => x.score > 0).length;
    if (mod.score === 0 && bestFile === 0) continue;
    const tierWeight = m.tier === 2 ? 0.45 : 1;
    const keywordScore = mod.score * 2 + bestFile + Math.min(matchCount, 5) * 0.5;
    const total = keywordScore * tierWeight + Math.min(m.degIn + m.degOut, 5) * 0.25;
    const matched = [.../* @__PURE__ */ new Set([...mod.matched, ...scoredFiles.flatMap((x) => x.matched)])].sort(byStr);
    let files = scoredFiles.filter((x) => x.score > 0).map((x) => x.f.rel);
    if (files.length === 0) {
      files = members.slice().sort((a, b) => b.degIn + b.degOut - (a.degIn + a.degOut) || byStr(a.rel, b.rel)).map((f) => f.rel);
    }
    const neighbors = [
      ...graph.moduleEdges.filter((e) => e.from === m.slug).map((e) => e.to),
      ...graph.moduleEdges.filter((e) => e.to === m.slug).map((e) => e.from)
    ];
    results.push({
      slug: m.slug,
      path: m.path,
      title: m.title,
      tier: m.tier,
      score: Number(total.toFixed(3)),
      matched,
      files: files.slice(0, MAX_FILES),
      neighbors: [...new Set(neighbors)].sort(byStr).slice(0, 8)
    });
  }
  results.sort((a, b) => b.score - a.score || byStr(a.slug, b.slug));
  return results.slice(0, k);
}
function runFind(outDir, query, k = DEFAULT_K) {
  const graph = loadGraph(outDir);
  if (!graph) return void 0;
  return findModules(graph, query, k);
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
import { join as join7 } from "path";
function runMap(outDir, moduleSlug) {
  const paths = indexPaths(outDir);
  if (moduleSlug) {
    return readIfExists(join7(paths.encyclopedia, `${moduleSlug}.md`));
  }
  return readIfExists(paths.index);
}

// src/check.ts
import { join as join8 } from "path";
function hashRepo(repo, outAbs) {
  const outPrefix = outAbs.replace(/\/+$/, "") + "/";
  const out = {};
  for (const f of walk(repo)) {
    if (f.abs === outAbs || f.abs.startsWith(outPrefix)) continue;
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
  const current = hashRepo(repo, outDir);
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
    if (readIfExists(join8(enc, `${m.slug}.md`)) === void 0) {
      errors.push(`module "${m.slug}" has no encyclopedia entry`);
    }
  }
  const nodes = new Set(graph.files.map((f) => f.rel));
  for (const e of graph.fileEdges) {
    if (!e.dangling && !nodes.has(e.to)) errors.push(`edge ${e.from} \u2192 ${e.to} (${e.kind}) points at a non-existent node`);
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

// src/cli.ts
var HELP = `ultraindex v${VERSION}
Deterministically index a whole repo (code + docs) into a navigable encyclopedia
\u2014 a small map, per-module entries, and a typed link-graph \u2014 so an AI can work in
huge codebases without filling its context window. Zero deps, no keys.

Usage:
  ultraindex build  --repo <dir> [--out <dir>] [--include <glob>] [--exclude <glob>] [--no-mermaid]
  ultraindex find   "<query>" [--out <dir>] [--k <n>]
  ultraindex neighbors <file|module-slug> [--out <dir>] [--depth <n>]
  ultraindex map    [--out <dir>] [--module <slug>]
  ultraindex check  [--out <dir>] [--repo <dir>]

Commands:
  build      Scan the repo and (re)write the layered index to --out (default
             <repo>/.ultraindex). Idempotent: refreshes generated sections,
             preserves your enriched prose.
  find       Rank modules for a task and print the exact files to open.
  neighbors  Show graph neighbours of a file or module (what links to/from it).
  map        Print INDEX.md (the map) or one module's entry.
  check      Report staleness (files changed since build) + integrity problems.

Options:
  --repo <dir>      Repo to index / check                    (default: .)
  --out <dir>       Index output dir   (default: <repo>/.ultraindex, else docs/ultraindex if present)
  --include <glob>  Only index paths matching (comma-separated globs)
  --exclude <glob>  Skip paths matching (comma-separated globs)
  --max-bytes <n>   Skip files larger than n bytes
  --no-mermaid      Do not write graph.mmd
  --k <n>           find: number of modules to return         (default: 8)
  --depth <n>       neighbors: hops to traverse               (default: 1)
  --module <slug>   map: print this module's entry instead of INDEX.md
  --json            Machine-readable output
  --quiet           check: print nothing, use the exit code only
  -h, --help        Show this help
  -v, --version     Show version
`;
var COMMANDS = /* @__PURE__ */ new Set(["build", "find", "neighbors", "map", "check"]);
var VALUE_FLAGS = /* @__PURE__ */ new Set(["repo", "out", "include", "exclude", "max-bytes", "k", "depth", "module"]);
var BOOL_FLAGS = /* @__PURE__ */ new Set(["json", "no-mermaid", "quiet"]);
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
  const dotted = join9(base, ".ultraindex");
  if (existsSync2(dotted)) return dotted;
  const docs = join9(base, "docs", "ultraindex");
  if (existsSync2(docs)) return docs;
  return dotted;
}
function cmdBuild(p) {
  const repo = resolve(p.values.repo ?? ".");
  if (!existsSync2(repo)) fail(`repo not found: ${repo}`);
  const out = p.values.out ? resolve(p.values.out) : join9(repo, ".ultraindex");
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
  const dangling = graph.fileEdges.filter((e) => e.dangling).length;
  if (p.bools.has("json")) {
    process.stdout.write(
      JSON.stringify(
        { out, files: graph.fileCount, modules: graph.modules.length, edges: graph.fileEdges.length, dangling, orphaned: manifest.orphaned },
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
function cmdFind(p) {
  const base = resolve(p.values.repo ?? ".");
  const out = resolveOut(p, base);
  const query = p.positional.join(" ").trim();
  if (!query) fail('missing query \u2014 usage: ultraindex find "<task keywords>"');
  const k = p.values.k ? Number(p.values.k) : 8;
  if (!Number.isFinite(k) || k <= 0) fail("invalid --k");
  const results = runFind(out, query, k);
  if (results === void 0) fail(`no index at ${out} \u2014 run \`ultraindex build\` first`);
  if (p.bools.has("json")) {
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
    return;
  }
  if (results.length === 0) {
    process.stdout.write(`No modules matched "${query}".
`);
    return;
  }
  const lines = [`ultraindex: ${results.length} module(s) for "${query}"`, ""];
  for (const r of results) {
    lines.push(`\u25B8 ${r.slug}  (${r.path}, tier ${r.tier}, score ${r.score})`);
    if (r.matched.length) lines.push(`    matched: ${r.matched.join(", ")}`);
    lines.push(`    open:    ${r.files.join("  ") || "(no files)"}`);
    if (r.neighbors.length) lines.push(`    related: ${r.neighbors.join(", ")}`);
    lines.push(`    entry:   encyclopedia/${r.slug}.md`);
    lines.push("");
  }
  process.stdout.write(lines.join("\n"));
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
  const content = runMap(out, p.values.module);
  if (content === void 0) {
    fail(p.values.module ? `no entry for module "${p.values.module}" at ${out}` : `no index at ${out} \u2014 run \`ultraindex build\` first`);
  }
  process.stdout.write(content.endsWith("\n") ? content : content + "\n");
}
function cmdCheck(p) {
  const repo = resolve(p.values.repo ?? ".");
  const out = resolveOut(p, repo);
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
function main() {
  const p = parseArgs(process.argv.slice(2));
  switch (p.command) {
    case "build":
      return cmdBuild(p);
    case "find":
      return cmdFind(p);
    case "neighbors":
      return cmdNeighbors(p);
    case "map":
      return cmdMap(p);
    case "check":
      return cmdCheck(p);
  }
}
function isInvokedDirectly() {
  const argv1 = process.argv[1];
  if (argv1 === void 0) return false;
  const modulePath = fileURLToPath(import.meta.url);
  try {
    if (realpathSync(argv1) === realpathSync(modulePath)) return true;
  } catch {
  }
  return import.meta.url === pathToFileURL(argv1).href;
}
if (isInvokedDirectly()) {
  try {
    main();
  } catch (e) {
    fail(e.message);
  }
}
export {
  parseArgs
};
