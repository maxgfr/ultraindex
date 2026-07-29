import { describe, it, expect } from "vitest";
import { getPrompt, PROMPTS, PromptError, unknownToolNamesIn, toolNamesReferencedBy } from "../src/mcp/prompts.js";

describe("prompt declarations", () => {
  it("names every prompt uniquely and describes what it is for", () => {
    const names = PROMPTS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    for (const p of PROMPTS) {
      expect(p.name, p.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(p.title, p.name).toBeTruthy();
      expect(p.description.length, p.name).toBeGreaterThan(60);
    }
  });

  it("documents every argument", () => {
    for (const p of PROMPTS) {
      for (const a of p.arguments) {
        expect(a.description, `${p.name}.${a.name}`).toBeTruthy();
        expect(a.name, `${p.name}.${a.name}`).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    }
  });
});

describe("prompts/get", () => {
  const args = { repo: "/repo/root", question: "how does the retry backoff work?" };

  it("renders every prompt from its required arguments", () => {
    for (const p of PROMPTS) {
      const got = getPrompt(p.name, args);
      expect(got.description, p.name).toBe(p.description);
      expect(got.messages.length, p.name).toBeGreaterThan(0);
      expect(got.messages[0]!.role, p.name).toBe("user");
      expect(got.messages[0]!.content.type, p.name).toBe("text");
      expect(got.messages[0]!.content.text.length, p.name).toBeGreaterThan(400);
    }
  });

  it("interpolates the arguments it was given", () => {
    const text = getPrompt("answer_grounded", args).messages[0]!.content.text;
    expect(text).toContain("/repo/root");
    expect(text).toContain("how does the retry backoff work?");
  });

  it("mentions optional arguments only when they are supplied", () => {
    // enrich_module without a slug must still be usable: it opens on
    // ultraindex_status to pick the module itself.
    const without = getPrompt("enrich_module", args).messages[0]!.content.text;
    expect(without).toContain("ultraindex_status");
    expect(without).toContain("the next module that needs it");

    const withSlug = getPrompt("enrich_module", { ...args, slug: "core-parser" }).messages[0]!.content.text;
    expect(withSlug).toContain("core-parser");
    expect(withSlug).not.toContain("the next module that needs it");
  });

  it("adapts the review prompt to a base ref or the staged changes", () => {
    const staged = getPrompt("review_changes", args).messages[0]!.content.text;
    expect(staged).toContain("staged");

    const branch = getPrompt("review_changes", { ...args, base: "main" }).messages[0]!.content.text;
    expect(branch).toContain("main");
  });

  it("rejects an unknown prompt", () => {
    expect(() => getPrompt("nope", args)).toThrow(PromptError);
  });

  it("rejects a missing required argument", () => {
    expect(() => getPrompt("answer_grounded", { repo: "/repo/root" })).toThrow(/`question` is required/);
    expect(() => getPrompt("answer_grounded", { question: "x" })).toThrow(/`repo` is required/);
    // Whitespace is not an argument.
    expect(() => getPrompt("answer_grounded", { repo: "  ", question: "x" })).toThrow(/`repo` is required/);
  });
});

describe("prompts stay honest about the tools", () => {
  const args = { repo: "/repo/root", question: "q" };

  it("never tells the model to call a tool that is not declared", () => {
    // The failure this catches: a tool gets renamed, the prompt keeps naming
    // the old one, and every host following the prompt fails on a tool that
    // does not exist. Nobody notices, because the prompt still reads fine.
    for (const p of PROMPTS) {
      const text = getPrompt(p.name, args).messages[0]!.content.text;
      expect(unknownToolNamesIn(text), `${p.name} names undeclared tools`).toEqual([]);
    }
  });

  it("gives each workflow a real tool sequence, ending at the citation gate", () => {
    for (const p of PROMPTS) {
      const text = getPrompt(p.name, args).messages[0]!.content.text;
      const referenced = toolNamesReferencedBy(text);
      expect(referenced.length, `${p.name} names no tools at all`).toBeGreaterThan(2);
      expect(referenced, `${p.name} never reaches the gate`).toContain("ultraindex_check");
    }
  });

  it("carries the core rule into every workflow", () => {
    // Every prompt must state the division of labour — the engine owns the code
    // view, you own the business view, and every claim is cited. A workflow that
    // lists tools without it is the failure mode this whole primitive exists to
    // prevent.
    for (const p of PROMPTS) {
      const text = getPrompt(p.name, args).messages[0]!.content.text;
      expect(text, p.name).toContain("The engine owns the code view");
      expect(text, p.name).toContain("[file:line] citation");
      expect(text, p.name).toMatch(/ok: false|VERDICT/);
    }
  });
});
