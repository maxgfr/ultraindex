import type { CodeSymbol, RawRef } from "../types.js";
import { grammarKeyForExt, grammarReady, parserFor } from "./loader.js";

// A tree-sitter Node — typed structurally so we don't depend on web-tree-sitter's
// exported types leaking through the bundle. Only the members we use.
interface TSNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  namedChildCount: number;
  namedChild(i: number): TSNode | null;
  childForFieldName(name: string): TSNode | null;
  children: TSNode[];
}

export interface AstResult {
  symbols: CodeSymbol[];
  refs: RawRef[];
  pkg?: string;
}

// How one grammar's declarations map to symbols. `defs` maps a node type to a
// symbol kind; `containers` are nodes whose body we recurse into for nested
// members (methods, namespace/impl bodies); `exported` decides visibility from
// the declaration's first line or name.
interface LangSpec {
  lang: string;
  defs: Record<string, string>;
  containers: Set<string>;
  exported: (firstLine: string, name: string) => boolean;
  imports?: Record<string, "string" | "path">; // node type → how to read the specifier
}

const byPublicKeyword = (line: string): boolean => /\b(public|internal)\b/.test(line);
const byPub = (line: string): boolean => /\bpub\b/.test(line);
const byCapital = (_l: string, name: string): boolean => /^[A-Z]/.test(name);
const byPyConvention = (_l: string, name: string): boolean => !name.startsWith("_") || /^__\w+__$/.test(name);
const always = (): boolean => true;
// JS/TS export is structural (an `export` statement wraps the declaration); a
// bare declaration is module-private, so the name/line heuristic never marks it.
const neverExport = (): boolean => false;

// TypeScript is the base for tsx and javascript, so it is a named const rather
// than indexed back out of SPECS (which noUncheckedIndexedAccess would widen to
// `LangSpec | undefined`, breaking the derived spreads below).
const TS_SPEC: LangSpec = {
  lang: "typescript",
  defs: {
    function_declaration: "function", generator_function_declaration: "function",
    class_declaration: "class", abstract_class_declaration: "class",
    interface_declaration: "interface", type_alias_declaration: "type",
    enum_declaration: "enum", method_definition: "method", variable_declarator: "const",
  },
  containers: new Set(["class_body", "export_statement", "program", "lexical_declaration", "variable_declaration"]),
  exported: neverExport, // export is tracked structurally via export_statement; see walk
  imports: { import_statement: "string" },
};

const SPECS: Record<string, LangSpec> = {
  typescript: TS_SPEC,
  tsx: { ...TS_SPEC, lang: "typescript" },
  javascript: {
    ...TS_SPEC,
    lang: "javascript",
    defs: {
      function_declaration: "function", generator_function_declaration: "function",
      class_declaration: "class", method_definition: "method", variable_declarator: "const",
    },
  },
  python: {
    lang: "python",
    defs: { function_definition: "function", class_definition: "class" },
    containers: new Set(["block", "decorated_definition", "module"]),
    exported: byPyConvention,
    imports: { import_statement: "path", import_from_statement: "path" },
  },
  go: {
    lang: "go",
    defs: {
      function_declaration: "function", method_declaration: "method",
      type_spec: "type", const_spec: "const", var_spec: "var",
    },
    containers: new Set(["type_declaration", "const_declaration", "var_declaration", "source_file"]),
    exported: byCapital,
    imports: { import_declaration: "string" },
  },
  ruby: {
    lang: "ruby",
    defs: { method: "def", singleton_method: "def", class: "class", module: "module" },
    containers: new Set(["class", "module", "body_statement", "program"]),
    exported: always,
  },
  java: {
    lang: "java",
    defs: {
      class_declaration: "class", interface_declaration: "interface",
      enum_declaration: "enum", record_declaration: "record",
      method_declaration: "method", constructor_declaration: "constructor",
    },
    containers: new Set(["class_body", "interface_body", "enum_body", "program"]),
    exported: byPublicKeyword,
    imports: { import_declaration: "path" },
  },
  rust: {
    lang: "rust",
    defs: {
      function_item: "function", struct_item: "struct", enum_item: "enum",
      trait_item: "trait", type_item: "type", mod_item: "mod",
      const_item: "const", static_item: "static", union_item: "union", macro_definition: "macro",
    },
    containers: new Set(["impl_item", "declaration_list", "source_file"]),
    exported: byPub,
  },
  c_sharp: {
    lang: "csharp",
    defs: {
      class_declaration: "class", interface_declaration: "interface",
      struct_declaration: "struct", enum_declaration: "enum", record_declaration: "record",
      method_declaration: "method", constructor_declaration: "constructor", property_declaration: "property",
    },
    containers: new Set(["namespace_declaration", "declaration_list", "compilation_unit", "file_scoped_namespace_declaration"]),
    exported: byPublicKeyword,
  },
  php: {
    lang: "php",
    defs: {
      function_definition: "function", class_declaration: "class",
      interface_declaration: "interface", trait_declaration: "trait",
      enum_declaration: "enum", method_declaration: "method",
    },
    containers: new Set(["declaration_list", "program"]),
    exported: always,
  },
};

function firstLine(node: TSNode): string {
  const nl = node.text.indexOf("\n");
  return (nl === -1 ? node.text : node.text.slice(0, nl)).trim().slice(0, 200);
}

function nameOf(node: TSNode): string | undefined {
  const named = node.childForFieldName("name");
  if (named?.text) return named.text;
  // Fall back to the first identifier-like named child (covers grammars that do
  // not expose a `name` field on a given node).
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)!;
    if (/(^|_)(identifier|name|constant)$/.test(c.type)) return c.text;
  }
  return undefined;
}

// Read import specifiers from the whole tree by scanning for the grammar's import
// node types. "string" pulls the first string literal's inner text; "path" takes
// the dotted/namespaced module text verbatim (resolution happens later).
function collectImports(root: TSNode, spec: LangSpec): RawRef[] {
  if (!spec.imports) return [];
  const out: RawRef[] = [];
  const seen = new Set<string>();
  const add = (s: string): void => {
    const v = s.trim();
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push({ kind: "import", spec: v });
    }
  };
  const visit = (node: TSNode): void => {
    const how = spec.imports![node.type];
    if (how === "string") {
      const str = findFirst(node, (n) => /string/.test(n.type));
      if (str) add(str.text.replace(/^['"]|['"]$/g, ""));
    } else if (how === "path") {
      const name = node.childForFieldName("name") ?? node.childForFieldName("module_name");
      add((name ?? node).text.replace(/^(import|from)\s+/, "").split(/\s+/)[0]!);
    }
    for (let i = 0; i < node.namedChildCount; i++) visit(node.namedChild(i)!);
  };
  visit(root);
  return out;
}

function findFirst(node: TSNode, pred: (n: TSNode) => boolean): TSNode | undefined {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)!;
    if (pred(c)) return c;
    const deep = findFirst(c, pred);
    if (deep) return deep;
  }
  return undefined;
}

// Extract declared symbols from one file via its committed grammar. Returns
// undefined when no grammar is loaded for the extension (caller falls back to the
// regex extractor). Walks top-level declarations plus one level of nested members.
export function extractAst(rel: string, ext: string, content: string): AstResult | undefined {
  const key = grammarKeyForExt(ext);
  if (!key || !grammarReady(key)) return undefined;
  const spec = SPECS[key];
  if (!spec) return undefined;
  const parser = parserFor(key);
  if (!parser) return undefined;

  let tree: { rootNode: TSNode; delete(): void } | null = null;
  try {
    tree = parser.parse(content) as unknown as { rootNode: TSNode; delete(): void };
    if (!tree) return undefined;
    const symbols: CodeSymbol[] = [];
    const root = tree.rootNode;
    // `export default Foo;` / `export { Foo }` re-export a declaration made
    // earlier in the file; record those names and mark the matching symbols
    // exported after the walk (the declaration node itself is not wrapped).
    const exportedNames = new Set<string>();

    const walk = (node: TSNode, parent: string | undefined, exported: boolean): void => {
      // `export …` / `export default …` (JS/TS) marks the wrapped declaration.
      const nowExported = exported || node.type === "export_statement";
      if (node.type === "export_statement") {
        for (let i = 0; i < node.namedChildCount; i++) {
          const c = node.namedChild(i)!;
          if (c.type === "identifier") exportedNames.add(c.text);
          else if (c.type === "export_clause") {
            for (let j = 0; j < c.namedChildCount; j++) {
              const spec = c.namedChild(j)!;
              const nm = spec.childForFieldName("name") ?? spec.namedChild(0);
              if (nm?.text) exportedNames.add(nm.text);
            }
          }
        }
      }
      const kind = spec.defs[node.type];
      if (kind) {
        const name = nameOf(node);
        if (name) {
          const line = firstLine(node);
          symbols.push({
            name,
            kind,
            file: rel,
            line: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            ...(parent ? { parent } : {}),
            signature: line,
            exported: nowExported || spec.exported(line, name),
            lang: spec.lang,
          });
          // Recurse into this declaration's body for nested members (methods),
          // scoping their parent to this symbol.
          for (let i = 0; i < node.namedChildCount; i++) {
            walkBody(node.namedChild(i)!, name, nowExported);
          }
          return;
        }
      }
      if (spec.containers.has(node.type)) {
        for (let i = 0; i < node.namedChildCount; i++) walk(node.namedChild(i)!, parent, nowExported);
      }
    };
    // Recurse a declaration body one level: only container-ish children yield more
    // members, so nested functions inside a method body are not surfaced (matches
    // the "top-level + one level" contract).
    const walkBody = (node: TSNode, parent: string, exported: boolean): void => {
      if (spec.containers.has(node.type)) {
        for (let i = 0; i < node.namedChildCount; i++) walk(node.namedChild(i)!, parent, exported);
      }
    };

    walk(root, undefined, false);
    if (exportedNames.size) {
      for (const s of symbols) if (!s.exported && exportedNames.has(s.name)) s.exported = true;
    }

    const refs = collectImports(root, spec);
    let pkg: string | undefined;
    if (spec.lang === "java") {
      const p = findFirst(root, (n) => n.type === "package_declaration");
      if (p) pkg = p.text.replace(/^package\s+/, "").replace(/;.*$/, "").trim();
    }
    return { symbols, refs, pkg };
  } catch {
    return undefined; // any parse/walk failure → regex fallback
  } finally {
    tree?.delete(); // free wasm-side memory every file (not GC'd otherwise)
  }
}
