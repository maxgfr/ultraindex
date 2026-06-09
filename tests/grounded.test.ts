import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCitations, checkCitations } from "../src/cite.js";
import { runBuild } from "../src/build.js";
import { runCheck, checkAnswer } from "../src/check.js";
import { runDossier, runAsk } from "../src/explain.js";

const REPO = fileURLToPath(new URL("./fixtures/mini-repo", import.meta.url));

describe("parseCitations", () => {
  it("captures path / path:line / path:a-b and ignores prose + markdown links", () => {
    const cs = parseCitations("See [src/a.ts], [src/a.ts:12] and [a.ts:3-9]. Not [TODO] nor [text](http://x).");
    expect(cs.map((c) => c.raw)).toEqual(["src/a.ts", "src/a.ts:12", "a.ts:3-9"]);
    expect(cs[1]).toMatchObject({ path: "src/a.ts", start: 12 });
    expect(cs[2]).toMatchObject({ path: "a.ts", start: 3, end: 9 });
  });
});

describe("checkCitations", () => {
  const lines = new Map([["src/a.ts", 20]]);
  it("resolves in-range citations and rejects unknown files / out-of-range lines", () => {
    expect(checkCitations("[src/a.ts:5]", lines).ok).toBe(true);
    expect(checkCitations("[missing.ts]", lines).unresolved[0]?.reason).toMatch(/no such file/);
    expect(checkCitations("[src/a.ts:99]", lines).unresolved[0]?.reason).toMatch(/out of range/);
  });
});

function buildTmp(): string {
  const out = join(mkdtempSync(join(tmpdir(), "ui-ground-")), ".ultraindex");
  runBuild({ repo: REPO, out, mermaid: false, json: false }, "2026-01-01T00:00:00.000Z");
  return out;
}

describe("dossier + ask (grounding packets carry real source)", () => {
  const out = buildTmp();
  it("dossier includes the module's real code and the cite instruction", () => {
    const d = runDossier(out, REPO, "src")!;
    expect(d).toContain("export class HttpClient"); // real source inlined
    expect(d).toMatch(/\[path:line\]|\[path:start-end\]/); // cite help present
  });
  it("ask assembles evidence for the relevant module", () => {
    const a = runAsk(out, REPO, "backoff retry", 3)!;
    expect(a.modules).toContain("src");
    expect(a.content).toContain("export function backoff");
    expect(a.content).toMatch(/ANSWER\.md/);
  });
  it("unknown module / missing index returns undefined", () => {
    expect(runDossier(out, REPO, "no-such-module")).toBeUndefined();
  });
});

describe("check grounding (encyclopedia prose)", () => {
  it("passes a resolvable citation and FAILS a hallucinated one (blocking)", () => {
    const out = buildTmp();
    const entry = join(out, "encyclopedia", "src.md");
    const base = readFileSync(entry, "utf8");

    const good = base.replace(/<!-- ui:enrich -->[^\n]*/, "Retry/backoff core [src/util.ts:2].");
    writeFileSync(entry, good);
    expect(runCheck(out, REPO).ok).toBe(true);

    const bad = base.replace(/<!-- ui:enrich -->[^\n]*/, "Totally made up [src/ghost.ts:999].");
    writeFileSync(entry, bad);
    const res = runCheck(out, REPO);
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/src\/ghost\.ts/);
  });
});

describe("checkAnswer (Q&A grounding gate)", () => {
  const out = buildTmp();
  const answer = join(out, "ANSWER.md");
  it("requires at least one citation and that all resolve", () => {
    writeFileSync(answer, "Backoff is exponential [src/util.ts:2].");
    expect(checkAnswer(out, answer).ok).toBe(true);

    writeFileSync(answer, "No citations here at all.");
    expect(checkAnswer(out, answer).ok).toBe(false);

    writeFileSync(answer, "Bad ref [src/nope.ts:1].");
    const res = checkAnswer(out, answer);
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/nope\.ts/);
  });
});
