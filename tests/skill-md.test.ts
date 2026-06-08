import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { VERSION } from "../src/types.js";

// Guards that BOTH published SKILL.md files stay installable via `npx skills
// add`. The `skills` CLI discovers a skill by reading SKILL.md, extracting the
// frontmatter with this exact regex and `parse()`-ing it with `yaml`. If that
// parse throws — or name/description are missing — it SILENTLY drops the skill.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const SKILLS = [
  { dir: "skills/ultraindex", name: "ultraindex" },
  { dir: "skills/ultraindex-nav", name: "ultraindex-nav" },
];

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };

describe.each(SKILLS)("$dir/SKILL.md is installable", ({ dir, name }) => {
  const raw = readFileSync(join(ROOT, dir, "SKILL.md"), "utf8");
  const match = raw.match(FRONTMATTER_RE);
  const frontmatter = match?.[1] ?? "";

  it("has a frontmatter block", () => {
    expect(match).not.toBeNull();
    expect(frontmatter.length).toBeGreaterThan(0);
  });

  it("parses as YAML without throwing", () => {
    expect(() => parse(frontmatter)).not.toThrow();
  });

  it("exposes the expected name and a non-empty description", () => {
    const data = parse(frontmatter) as Record<string, unknown>;
    expect(data.name).toBe(name);
    expect(typeof data.description).toBe("string");
    expect((data.description as string).length).toBeGreaterThan(0);
  });

  it("keeps version in lockstep with package.json and src/types.ts", () => {
    const data = parse(frontmatter) as { metadata?: { version?: string } };
    expect(data.metadata?.version).toBe(pkg.version);
    expect(VERSION).toBe(pkg.version);
  });
});
