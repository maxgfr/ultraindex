import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBuild } from "../src/build.js";
import { runCheck } from "../src/check.js";
import { runStatus } from "../src/status.js";
import { loadManifest } from "../src/store.js";
import { proseDigest, proseSourceHash, proseFreshness } from "../src/prose.js";

let repo: string;
let out: string;

// A fixed `builtAt` keeps manifests comparable byte-for-byte across rebuilds
// without stripping the field — it is the only volatile one.
function build(): void {
  runBuild({ repo, out, mermaid: false, json: true }, "2026-01-01T00:00:00.000Z");
}

// Replace a module entry's ui:human `business` region body with real prose.
function enrich(slug: string, body: string): void {
  const path = join(out, "encyclopedia", `${slug}.md`);
  const text = readFileSync(path, "utf8");
  const next = text.replace(
    /(<!-- ui:human key=business -->\n)[\s\S]*?(\n<!-- \/ui:human key=business -->)/,
    `$1${body}$2`,
  );
  expect(next, `no business region in ${slug}.md`).not.toBe(text);
  writeFileSync(path, next);
}

function proseOf(slug: string): { digest: string; source: string } | undefined {
  return loadManifest(out)?.modules[slug]?.prose;
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "uidx-prose-repo-"));
  out = join(repo, ".ultraindex");
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "auth.ts"), "export function login(): void {}\n");
  writeFileSync(join(repo, "src", "token.ts"), "export function mint(): string { return ''; }\n");
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("proseFreshness (the predicate)", () => {
  const hashes = { "a.ts": "h1", "b.ts": "h2" };

  it("reports none for a stub and unknown for untracked prose", () => {
    expect(proseFreshness(undefined, "", ["a.ts"], hashes)).toBe("none");
    expect(proseFreshness(undefined, "d1", ["a.ts"], hashes)).toBe("unknown");
  });

  it("treats a moved digest as fresh — prose edited since the build saw current source", () => {
    const rec = { digest: "old", source: "whatever" };
    expect(proseFreshness(rec, "new", ["a.ts"], hashes)).toBe("fresh");
  });

  it("is stale only when the digest held and the source moved", () => {
    const source = proseSourceHash(["a.ts"], hashes);
    expect(proseFreshness({ digest: "d", source }, "d", ["a.ts"], hashes)).toBe("fresh");
    expect(proseFreshness({ digest: "d", source }, "d", ["a.ts"], { "a.ts": "CHANGED" })).toBe("stale");
  });

  it("moves the source hash on a deleted or renamed member, not just edited content", () => {
    const base = proseSourceHash(["a.ts", "b.ts"], hashes);
    expect(proseSourceHash(["a.ts"], hashes)).not.toBe(base); // removed
    expect(proseSourceHash(["a.ts", "b.ts"], { "a.ts": "h1" })).not.toBe(base); // deleted from disk
    expect(proseSourceHash(["a.ts", "moved.ts"], { "a.ts": "h1", "moved.ts": "h2" })).not.toBe(base); // same bytes, new path
  });

  it("ignores stub regions when fingerprinting prose", () => {
    expect(proseDigest([{ type: "human", key: "business", body: "<!-- ui:enrich -->" }])).toBe("");
    expect(proseDigest([{ type: "gen", key: "code", body: "anything" }])).toBe("");
    expect(proseDigest([{ type: "human", key: "business", body: "real" }])).not.toBe("");
  });
});

describe("prose freshness end to end", () => {
  it("stamps the source state once prose is written, and clears on re-enrichment", () => {
    build();
    expect(proseOf("src")).toBeUndefined(); // stubs record nothing

    enrich("src", "Handles login. [src/auth.ts:1]");
    build();
    const first = proseOf("src");
    expect(first).toBeDefined();
    expect(runCheck(out, repo).proseStale).toEqual([]);

    // Source moves under the unchanged prose.
    writeFileSync(join(repo, "src", "auth.ts"), "export function login(): void { /* rewritten */ }\n");
    build();
    expect(proseOf("src")?.digest).toBe(first!.digest);
    expect(proseOf("src")?.source).toBe(first!.source); // carried forward, NOT re-stamped
    expect(runCheck(out, repo).proseStale).toEqual(["src"]);

    // Revising the prose re-stamps it against the current source.
    enrich("src", "Handles login, now rewritten. [src/auth.ts:1]");
    build();
    expect(proseOf("src")?.digest).not.toBe(first!.digest);
    expect(runCheck(out, repo).proseStale).toEqual([]);
  });

  it("keeps stale prose OUT of the default exit code and IN under --prose", () => {
    build();
    enrich("src", "Handles login. [src/auth.ts:1]");
    build();
    writeFileSync(join(repo, "src", "auth.ts"), "export function login(): void { /* moved on */ }\n");
    build();

    const lenient = runCheck(out, repo);
    expect(lenient.proseStale).toEqual(["src"]);
    expect(lenient.stale).toBe(false); // the INDEX is fresh — different failure
    expect(lenient.ok).toBe(true);

    expect(runCheck(out, repo, { prose: true }).ok).toBe(false);
  });

  it("never calls prose written since the last build stale", () => {
    build();
    enrich("src", "Handles login. [src/auth.ts:1]");
    // No rebuild yet, and no prior record: unknown, because from here "written
    // a minute ago" and "written by an index that predates tracking" look
    // identical. Not fresh, not stale — just not claimed either way.
    const first = runStatus(out)!;
    expect(first.modules.find((m) => m.slug === "src")?.prose).toBe("unknown");
    expect(first.proseStale).toBe(0);

    // Once a record exists, revising the prose IS distinguishable: the digest
    // moved, so it was written against source at least as new as the record.
    // This is what stops `status` calling a just-revised entry stale.
    build();
    writeFileSync(join(repo, "src", "auth.ts"), "export function login(): void { /* moved on */ }\n");
    build();
    expect(runStatus(out)!.modules.find((m) => m.slug === "src")?.prose).toBe("stale");

    enrich("src", "Handles login, revised. [src/auth.ts:1]");
    const revised = runStatus(out)!;
    expect(revised.modules.find((m) => m.slug === "src")?.prose).toBe("fresh");
    expect(revised.proseStale).toBe(0);
  });

  it("ranks stale prose ahead of never-enriched in the work-queue", () => {
    mkdirSync(join(repo, "lib"), { recursive: true });
    writeFileSync(join(repo, "lib", "util.ts"), "export function noop(): void {}\n");
    build();
    enrich("src", "Handles login. [src/auth.ts:1]");
    build();
    writeFileSync(join(repo, "src", "auth.ts"), "export function login(): void { /* moved on */ }\n");
    build();

    const st = runStatus(out)!;
    expect(st.proseStale).toBe(1);
    expect(st.modules[0]?.slug).toBe("src"); // stale first, before the untouched `lib`
    expect(st.suggestedNext[0]).toBe("src");
    expect(st.suggestedNext).toContain("lib");
  });

  it("does not carry a source pointer onto prose whose module disappeared", () => {
    // A directory rename is NOT a prose migration in this codebase: syncEntries
    // matches predecessors by member REL PATH overlap, and renaming src/ -> core/
    // changes every member path, so the Jaccard score is 0. The prose is
    // preserved (encyclopedia/_orphaned/) rather than migrated, and the new
    // module correctly starts with no prose at all — never an inherited pointer
    // that would make an empty entry look accounted for.
    build();
    enrich("src", "Handles login. [src/auth.ts:1]");
    build();

    renameSync(join(repo, "src"), join(repo, "core"));
    build();

    expect(proseOf("src")).toBeUndefined();
    expect(proseOf("core")).toBeUndefined();
    expect(loadManifest(out)!.orphaned).toContain("src");
  });

  it("does not launder staleness through a mangled-then-repaired fence", () => {
    build();
    enrich("src", "Handles login. [src/auth.ts:1]");
    build();
    writeFileSync(join(repo, "src", "auth.ts"), "export function login(): void { /* moved on */ }\n");
    build();
    expect(runCheck(out, repo).proseStale).toEqual(["src"]);

    // A hand-edit mangles a region fence. `build` refuses to rewrite the entry
    // and reports no prose digest for it — so the manifest must KEEP the last
    // known record rather than dropping it, otherwise repairing the fence
    // re-stamps the pointer against current source and the stale prose comes
    // back reporting fresh.
    const entry = join(out, "encyclopedia", "src.md");
    const good = readFileSync(entry, "utf8");
    writeFileSync(entry, good + "\n<!-- /ui:human key=bogus -->\n");
    build();
    expect(proseOf("src"), "the record must survive an unreadable entry").toBeDefined();

    writeFileSync(entry, good); // repair
    build();
    expect(runCheck(out, repo).proseStale, "still stale after the round trip").toEqual(["src"]);
  });

  it("reports a module whose member list grew as stale — the explanation is now partial", () => {
    build();
    enrich("src", "Handles login. [src/auth.ts:1]");
    build();
    expect(runCheck(out, repo).proseStale).toEqual([]);

    // A new file joins the module. Nothing the prose cites changed, but the
    // thing the prose DESCRIBES did: the module now contains something the
    // explanation never accounted for. Intentional, and the reason
    // proseSourceHash covers the member list and not just member content.
    writeFileSync(join(repo, "src", "session.ts"), "export const ttl = 60;\n");
    build();
    expect(runCheck(out, repo).proseStale).toEqual(["src"]);
  });

  it("keeps staleness through a slug rename caused by a path collision", () => {
    // `src/foo/bar` slugifies to `src-foo-bar`. Adding a sibling `src/foo-bar`
    // collides on that slug, so the module's slug shifts — a rename nobody asked
    // for. Staleness must survive it: the prose still describes source that
    // moved, and a slug change is not evidence that anyone revisited it.
    mkdirSync(join(repo, "src", "foo", "bar"), { recursive: true });
    writeFileSync(join(repo, "src", "foo", "bar", "a.ts"), "export function helper(): number { return 1; }\n");
    build();
    enrich("src-foo-bar", "Shared helpers. [src/foo/bar/a.ts:1]");
    build();
    expect(runCheck(out, repo).proseStale).toEqual([]);

    writeFileSync(join(repo, "src", "foo", "bar", "a.ts"), "export function helper(): number { return 2; }\n");
    mkdirSync(join(repo, "src", "foo-bar"), { recursive: true });
    writeFileSync(join(repo, "src", "foo-bar", "x.ts"), "export const x = 1;\n");
    build();

    expect(runCheck(out, repo).proseStale).toHaveLength(1);
  });

  it("stays byte-identical across rebuilds", () => {
    build();
    enrich("src", "Handles login. [src/auth.ts:1]");
    build();
    const strip = (s: string): string => s.replace(/"builtAt": "[^"]*"/, '"builtAt": "-"');
    const a = strip(readFileSync(join(out, "manifest.json"), "utf8"));
    build();
    expect(strip(readFileSync(join(out, "manifest.json"), "utf8"))).toBe(a);
  });

  it("admits it has no evidence when the manifest is deleted, instead of stamping silently", () => {
    build();
    enrich("src", "Handles login. [src/auth.ts:1]");
    build();
    writeFileSync(join(repo, "src", "auth.ts"), "export function login(): void { /* moved on */ }\n");
    build();
    expect(runCheck(out, repo).proseStale).toEqual(["src"]);

    // Deleting manifest.json destroys the only record of what the prose was
    // written against, so the rebuild HAS to stamp the pointer from the current
    // state — which on its own would quietly turn this stale entry into a fresh
    // one. It cannot recover the evidence, but it must not pretend to have it.
    rmSync(join(out, "manifest.json"));
    build();
    const notes = loadManifest(out)!.notes;
    expect(notes.some((n) => /baselined without evidence/.test(n))).toBe(true);
    expect(runCheck(out, repo).warnings.some((w) => /baselined without evidence/.test(w))).toBe(true);

    // Self-clearing: the next build has a record to compare against.
    build();
    expect(loadManifest(out)!.notes.some((n) => /baselined/.test(n))).toBe(false);
  });

  it("does not warn about baselining on an ordinary first enrichment", () => {
    build();
    enrich("src", "Handles login. [src/auth.ts:1]");
    build(); // prev manifest exists — stamping current source is correct here
    expect(loadManifest(out)!.notes.some((n) => /baselined/.test(n))).toBe(false);
  });

  it("reports prose with no recorded source state as unknown, not as fresh", () => {
    build();
    enrich("src", "Handles login. [src/auth.ts:1]");
    build();

    // An index written before prose tracking existed: enriched entries on disk,
    // no prose block in the manifest. It must NOT be silently called fresh.
    const mPath = join(out, "manifest.json");
    const m = JSON.parse(readFileSync(mPath, "utf8")) as { modules: Record<string, { prose?: unknown }> };
    for (const key of Object.keys(m.modules)) delete m.modules[key]!.prose;
    writeFileSync(mPath, JSON.stringify(m, null, 2) + "\n");

    const res = runCheck(out, repo);
    expect(res.proseUnknown).toEqual(["src"]);
    expect(res.proseStale).toEqual([]);
    expect(res.warnings.some((w) => /no recorded source state/.test(w))).toBe(true);
    expect(res.ok).toBe(true); // unknown is a warning, never a failure

    build(); // self-clearing: the rebuild baselines it
    expect(runCheck(out, repo).proseUnknown).toEqual([]);
  });
});
