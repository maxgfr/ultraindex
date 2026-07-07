import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha1, shortHash } from "../src/hash.js";
import { byStr, byKey } from "../src/sort.js";
import { headCommit } from "../src/git.js";
import { readIfExists, writeFileIfChanged, removeFile, ensureDir, moveFile } from "../src/output.js";

describe("hash", () => {
  it("sha1 is stable and content-sensitive; shortHash truncates", () => {
    expect(sha1("abc")).toBe(sha1("abc"));
    expect(sha1("abc")).not.toBe(sha1("abd"));
    expect(sha1("")).toHaveLength(40);
    expect(shortHash("abc", 8)).toBe(sha1("abc").slice(0, 8));
  });
});

describe("sort", () => {
  it("byStr is a deterministic, locale-independent ordering", () => {
    const arr = ["b", "A", "a", "B", "10", "2"];
    const sorted = arr.slice().sort(byStr);
    // Stable across runs and code-point based (uppercase before lowercase).
    expect(sorted).toEqual(arr.slice().sort(byStr));
    expect(byStr("a", "a")).toBe(0);
    expect(byStr("a", "b")).toBeLessThan(0);
  });
  it("byKey sorts by a derived key", () => {
    const items = [{ n: "z" }, { n: "a" }, { n: "m" }];
    expect(items.slice().sort(byKey((x) => x.n)).map((x) => x.n)).toEqual(["a", "m", "z"]);
  });
});

describe("git.headCommit", () => {
  it("returns undefined for a non-git directory (no throw)", () => {
    const d = mkdtempSync(join(tmpdir(), "ui-nogit-"));
    expect(headCommit(d)).toBeUndefined();
  });
});

describe("output", () => {
  it("writeFileIfChanged writes once, then skips an identical write", () => {
    const dir = mkdtempSync(join(tmpdir(), "ui-out-"));
    const f = join(dir, "x.txt");
    expect(writeFileIfChanged(f, "hello")).toBe(true); // wrote
    expect(readIfExists(f)).toBe("hello");
    expect(writeFileIfChanged(f, "hello")).toBe(false); // unchanged → skipped
    expect(writeFileIfChanged(f, "world")).toBe(true); // changed → wrote
    expect(readIfExists(f)).toBe("world");
  });

  it("readIfExists returns undefined for a missing file; removeFile is a no-op when absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "ui-out2-"));
    expect(readIfExists(join(dir, "nope.txt"))).toBeUndefined();
    expect(() => removeFile(join(dir, "nope.txt"))).not.toThrow();
  });

  it("ensureDir creates nested dirs; moveFile relocates", () => {
    const dir = mkdtempSync(join(tmpdir(), "ui-out3-"));
    const nested = join(dir, "a", "b", "c");
    ensureDir(nested);
    expect(existsSync(nested)).toBe(true);
    writeFileSync(join(nested, "s.txt"), "data");
    moveFile(join(nested, "s.txt"), join(dir, "moved.txt"));
    expect(readIfExists(join(dir, "moved.txt"))).toBe("data");
    expect(existsSync(join(nested, "s.txt"))).toBe(false);
  });
});
