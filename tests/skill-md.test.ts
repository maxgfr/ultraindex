import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { VERSION } from "../src/types.js";

// Guards that the published SKILL.md stays installable via `npx skills add`.
// The `skills` CLI discovers a skill by reading SKILL.md, extracting the
// frontmatter with this exact regex and `parse()`-ing it with `yaml`. If that
// parse throws — or name/description are missing — it SILENTLY drops the skill.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const SKILL_DIR = "skills/ultraindex";
const REFS_DIR = join(ROOT, SKILL_DIR, "references");

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
const raw = readFileSync(join(ROOT, SKILL_DIR, "SKILL.md"), "utf8");
const match = raw.match(FRONTMATTER_RE);
const frontmatter = match?.[1] ?? "";
const body = match?.[2] ?? "";
const refFiles = readdirSync(REFS_DIR).filter((f) => f.endsWith(".md"));
const refBodies = Object.fromEntries(refFiles.map((f) => [f, readFileSync(join(REFS_DIR, f), "utf8")]));

describe("SKILL.md is installable", () => {
  it("is the only skill (the navigator merged into it)", () => {
    expect(readdirSync(join(ROOT, "skills"))).toEqual(["ultraindex"]);
    expect(existsSync(join(ROOT, "skills/ultraindex-nav"))).toBe(false);
  });

  it("has a frontmatter block", () => {
    expect(match).not.toBeNull();
    expect(frontmatter.length).toBeGreaterThan(0);
  });

  it("parses as YAML without throwing", () => {
    expect(() => parse(frontmatter)).not.toThrow();
  });

  it("exposes the expected name and a non-empty description", () => {
    const data = parse(frontmatter) as Record<string, unknown>;
    expect(data.name).toBe("ultraindex");
    expect(typeof data.description).toBe("string");
    expect((data.description as string).length).toBeGreaterThan(0);
  });

  it("describes BOTH trigger sets (build it AND navigate it)", () => {
    const description = (parse(frontmatter) as { description: string }).description;
    expect(description).toMatch(/index|build/i);
    expect(description).toMatch(/where is|navigate/i);
  });

  it("keeps version in lockstep with package.json and src/types.ts", () => {
    const data = parse(frontmatter) as { metadata?: { version?: string } };
    expect(data.metadata?.version).toBe(pkg.version);
    expect(VERSION).toBe(pkg.version);
  });
});

// Content guards: the docs must not drift from the CLI they describe.
const CLI_COMMANDS = new Set(["build", "find", "embed", "neighbors", "symbols", "impact", "map", "status", "dossier", "ask", "check", "verify"]);

describe("skill docs stay in sync with the CLI", () => {
  const docs: [string, string][] = [["SKILL.md", body], ...Object.entries(refBodies)];

  it.each(docs)("%s only references commands the CLI actually has", (_name, text) => {
    for (const m of text.matchAll(/ultraindex\.mjs\s+([a-z-]+)/g)) {
      expect(CLI_COMMANDS.has(m[1]!), `references unknown command "${m[1]}"`).toBe(true);
    }
  });

  it("teaches the machine-readable surface (--json)", () => {
    expect(body).toContain("--json");
  });

  // Flag-level drift guard: every `--flag` the skill documents must appear in the
  // engine's own `--help`. Catches the class of drift that once hid `verify` /
  // `--max-verify` from the help text for a release (command-name checks missed it).
  it("documents every CLI flag the skill mentions (guards help-text drift)", () => {
    const help = execFileSync(process.execPath, [join(ROOT, "scripts/ultraindex.mjs"), "--help"], { encoding: "utf8" });
    const docText = [body, ...Object.values(refBodies)].join("\n");
    const flags = new Set(docText.match(/--[a-z][a-z-]+/g) ?? []);
    for (const f of flags) {
      expect(help.includes(f), `--help omits ${f}, which the skill documents`).toBe(true);
    }
  });
});

describe("SKILL.md routes to the references (progressive disclosure)", () => {
  it("ships the four workflow references", () => {
    expect(refFiles.sort()).toEqual(["generate.md", "navigate.md", "semantic.md", "verify.md"]);
  });

  it("mentions every reference file that exists", () => {
    for (const f of refFiles) {
      expect(body, `SKILL.md never routes to references/${f}`).toContain(`references/${f}`);
    }
  });
});

describe("generate.md teaches the agent loop", () => {
  const text = refBodies["generate.md"]!;
  it("drives enrichment through `status`", () => {
    expect(text).toContain("status");
    expect(text).toMatch(/work-queue/i);
  });
  it("covers error recovery without weakening the grounding gate", () => {
    expect(text).toMatch(/Never delete a citation/i);
  });
});

describe("navigate.md teaches escalation", () => {
  const text = refBodies["navigate.md"]!;
  it("mentions the enriched flag and the find-miss escalation ladder", () => {
    expect(text).toContain("enriched");
    expect(text).toMatch(/neighbors/);
    expect(text).toMatch(/never whole-repo/i);
  });
});

describe("semantic.md teaches the optional embeddings layer", () => {
  const text = refBodies["semantic.md"]!;
  it("covers the provider, embed, and graceful degradation", () => {
    expect(text).toContain("docker compose");
    expect(text).toMatch(/ultraindex\.mjs embed/);
    expect(text).toMatch(/lexical/i);
    expect(text).toContain("vectors.json");
  });
});

describe("verify.md teaches the semantic verify gate", () => {
  const text = refBodies["verify.md"]!;
  it("covers the verify command, the --semantic gate, and the verdict tokens", () => {
    expect(text).toMatch(/ultraindex\.mjs verify/);
    expect(text).toContain("--semantic");
    expect(text).toMatch(/supported/);
    expect(text).toMatch(/refuted/);
    expect(text).toMatch(/unsupported/);
  });
});
