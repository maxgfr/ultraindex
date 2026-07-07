import { describe, it, expect, beforeAll } from "vitest";
import { ensureGrammars, allGrammarKeys, grammarReady } from "../src/ast/loader.js";
import { extractAst } from "../src/ast/extract.js";

// Load every committed grammar once before the suite. This exercises the exact
// path the CLI uses (wasmBinary init + Language.load from scripts/grammars/).
beforeAll(async () => {
  await ensureGrammars(allGrammarKeys());
});

const names = (rel: string, ext: string, src: string) =>
  (extractAst(rel, ext, src)?.symbols ?? []).map((s) => s.name);

describe("AST extraction (tree-sitter)", () => {
  it("loads every committed grammar", () => {
    for (const k of allGrammarKeys()) expect(grammarReady(k)).toBe(true);
  });

  it("extracts TypeScript declarations with exported/parent/endLine", () => {
    const src = [
      "export function foo(a: number): number { return a }",
      "function bar() {}",
      "export class Widget {",
      "  render() { return 1 }",
      "}",
      "export interface Shape { area(): number }",
      "export type Id = string",
      "export const K = 1",
    ].join("\n");
    const syms = extractAst("src/w.ts", ".ts", src)!.symbols;
    const foo = syms.find((s) => s.name === "foo")!;
    expect(foo.kind).toBe("function");
    expect(foo.exported).toBe(true);
    expect(foo.endLine).toBe(1);
    expect(syms.find((s) => s.name === "bar")!.exported).toBe(false);
    const render = syms.find((s) => s.name === "render")!;
    expect(render.kind).toBe("method");
    expect(render.parent).toBe("Widget");
    expect(syms.find((s) => s.name === "Shape")!.kind).toBe("interface");
    expect(syms.find((s) => s.name === "Id")!.kind).toBe("type");
  });

  it("captures TS import specifiers", () => {
    const refs = extractAst("a.ts", ".ts", "import { x } from './y';\nimport z from 'pkg';\n")!.refs;
    const specs = refs.map((r) => r.spec);
    expect(specs).toContain("./y");
    expect(specs).toContain("pkg");
  });

  it("extracts Python with public/private convention and nested methods", () => {
    const src = "class A:\n    def method(self):\n        return 1\n    def _hidden(self):\n        pass\n\ndef top():\n    return 2\n";
    const syms = extractAst("m.py", ".py", src)!.symbols;
    expect(syms.find((s) => s.name === "A")!.kind).toBe("class");
    const method = syms.find((s) => s.name === "method")!;
    expect(method.parent).toBe("A");
    expect(method.exported).toBe(true);
    expect(syms.find((s) => s.name === "_hidden")!.exported).toBe(false);
    expect(syms.find((s) => s.name === "top")!.exported).toBe(true);
  });

  it("extracts Go with exported-by-capitalization", () => {
    const src = "package p\n\nimport \"fmt\"\n\nfunc Exported() {}\nfunc unexported() {}\ntype Widget struct{}\n";
    const res = extractAst("g.go", ".go", src)!;
    const syms = res.symbols;
    expect(syms.find((s) => s.name === "Exported")!.exported).toBe(true);
    expect(syms.find((s) => s.name === "unexported")!.exported).toBe(false);
    expect(syms.find((s) => s.name === "Widget")!.kind).toBe("type");
    expect(res.refs.map((r) => r.spec)).toContain("fmt");
  });

  it("extracts Ruby methods and classes (all exported)", () => {
    const src = "class Foo\n  def bar\n  end\nend\n\nmodule M\nend\n";
    const nms = names("r.rb", ".rb", src);
    expect(nms).toEqual(expect.arrayContaining(["Foo", "bar", "M"]));
  });

  it("extracts Java with public visibility and package", () => {
    const src = "package com.acme.app;\n\npublic class Service {\n  public void run() {}\n  private int n;\n}\n";
    const res = extractAst("S.java", ".java", src)!;
    expect(res.pkg).toBe("com.acme.app");
    expect(res.symbols.find((s) => s.name === "Service")!.exported).toBe(true);
    expect(res.symbols.find((s) => s.name === "run")!.parent).toBe("Service");
  });

  it("extracts Rust pub visibility", () => {
    const src = "pub fn open() {}\nfn closed() {}\npub struct Handle;\n";
    const syms = extractAst("l.rs", ".rs", src)!.symbols;
    expect(syms.find((s) => s.name === "open")!.exported).toBe(true);
    expect(syms.find((s) => s.name === "closed")!.exported).toBe(false);
    expect(syms.find((s) => s.name === "Handle")!.kind).toBe("struct");
  });

  it("returns undefined for a language with no committed grammar (regex fallback)", () => {
    expect(extractAst("s.swift", ".swift", "func f() {}")).toBeUndefined();
    expect(extractAst("s.lua", ".lua", "function f() end")).toBeUndefined();
  });

  it("falls back (undefined) rather than throwing on unparseable input", () => {
    // Deeply broken source must never throw — the engine degrades to regex.
    const r = extractAst("broken.ts", ".ts", "export class {{{ <<< not valid");
    expect(r === undefined || Array.isArray(r.symbols)).toBe(true);
  });
});
