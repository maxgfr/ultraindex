import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeRegions, parseRegions, mergeEntry, type Region } from "../src/merge.js";
import { syncEntries } from "../src/entries.js";

const spec = (codeBody = "- foo()"): Region[] => [
  { type: "gen", key: "header", body: "# Title\n\nSummary line." },
  { type: "human", key: "business", body: "_Business context — fill this in._" },
  { type: "gen", key: "code-view", body: codeBody },
];

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "ui-merge-"));
}

describe("serialize / parse", () => {
  it("round-trips regions preserving type, key and body", () => {
    const text = serializeRegions(spec());
    const { regions, ok } = parseRegions(text);
    expect(ok).toBe(true);
    expect(regions).toEqual(spec());
  });

  it("captures text outside fences as a stable orphan human region", () => {
    const text = serializeRegions(spec()) + "\nA hand-added paragraph.\n";
    const { regions, ok } = parseRegions(text);
    expect(ok).toBe(true);
    const orphan = regions.find((r) => r.key.startsWith("orphan-"));
    expect(orphan?.body).toBe("A hand-added paragraph.");
    // Re-parsing is stable (same orphan key).
    expect(parseRegions(serializeRegions(regions)).regions.find((r) => r.key.startsWith("orphan-"))?.key)
      .toBe(orphan?.key);
  });

  it("reports malformed fences as not-ok", () => {
    expect(parseRegions("<!-- ui:gen key=a -->\nbody\n").ok).toBe(false); // unterminated
    expect(parseRegions("<!-- /ui:human key=a -->").ok).toBe(false); // stray close
  });
});

describe("mergeEntry idempotency", () => {
  it("preserves human prose and refreshes gen bodies across a rebuild", () => {
    const first = mergeEntry(spec(), undefined).content;
    // Author enriches the business region.
    const enriched = first.replace("_Business context — fill this in._", "This module owns auth.");
    // Rebuild with a CHANGED code view.
    const merged = mergeEntry(spec("- foo()\n- bar()"), enriched);
    expect(merged.content).toContain("This module owns auth."); // human kept
    expect(merged.content).toContain("- bar()"); // gen refreshed
    expect(merged.content).not.toContain("_Business context — fill this in._");
    // Stable: merging the same inputs again changes nothing.
    expect(mergeEntry(spec("- foo()\n- bar()"), merged.content).content).toBe(merged.content);
  });

  it("keeps an unchanged build byte-identical", () => {
    const a = mergeEntry(spec(), undefined).content;
    const b = mergeEntry(spec(), a).content;
    expect(b).toBe(a);
  });

  it("refuses to rewrite an entry with unparseable fences (conflict)", () => {
    const broken = "<!-- ui:gen key=header -->\nno close fence\n";
    const merged = mergeEntry(spec(), broken);
    expect(merged.conflict).toBeTruthy();
    expect(merged.content).toBe(broken); // kept verbatim, prose not clobbered
  });
});

describe("syncEntries — rename + disappear", () => {
  function seedEntry(dir: string, slug: string, businessBody: string): void {
    const enc = join(dir, "encyclopedia");
    mkdirSync(enc, { recursive: true });
    const regions: Region[] = [
      { type: "gen", key: "header", body: "# Old" },
      { type: "human", key: "business", body: businessBody },
    ];
    writeFileSync(join(enc, `${slug}.md`), serializeRegions(regions));
  }

  it("migrates human prose from a renamed predecessor", () => {
    const dir = tmp();
    seedEntry(dir, "old-mod", "Owns the retry logic.");
    const res = syncEntries(
      dir,
      [{ slug: "new-mod", members: ["a.ts", "b.ts", "c.ts"], spec: spec() }],
      { "old-mod": { members: ["a.ts", "b.ts"] } },
    );
    const written = readFileSync(join(dir, "encyclopedia", "new-mod.md"), "utf8");
    expect(written).toContain("Owns the retry logic."); // migrated into the business region
    expect(existsSync(join(dir, "encyclopedia", "old-mod.md"))).toBe(false); // stale file removed
    expect(res.orphaned).toEqual([]);
    expect(res.notes.join(" ")).toMatch(/migrated prose/);
  });

  it("moves prose of a truly-removed module to _orphaned, never deletes it", () => {
    const dir = tmp();
    seedEntry(dir, "gone", "Important historical context.");
    const res = syncEntries(
      dir,
      [{ slug: "kept", members: ["y.ts"], spec: spec() }],
      { gone: { members: ["x.ts"] } },
    );
    expect(res.orphaned).toEqual(["gone"]);
    const orphan = readFileSync(join(dir, "encyclopedia", "_orphaned", "gone.md"), "utf8");
    expect(orphan).toContain("Important historical context.");
    expect(existsSync(join(dir, "encyclopedia", "kept.md"))).toBe(true);
  });

  it("does not migrate when member overlap is below threshold", () => {
    const dir = tmp();
    seedEntry(dir, "old", "Prose A.");
    const res = syncEntries(
      dir,
      [{ slug: "brand-new", members: ["totally", "different"], spec: spec() }],
      { old: { members: ["nothing", "shared"] } },
    );
    // No overlap → old prose is orphaned, not migrated into brand-new.
    expect(res.orphaned).toEqual(["old"]);
    expect(readFileSync(join(dir, "encyclopedia", "brand-new.md"), "utf8")).not.toContain("Prose A.");
  });
});
