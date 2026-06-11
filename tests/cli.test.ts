import { describe, it, expect, vi, afterEach } from "vitest";
import { parseArgs } from "../src/cli.js";

// parseArgs calls process.exit on help/version/errors; trap it so tests can
// assert without killing the runner.
function trapExit(fn: () => void): { exited: boolean; code: number | undefined } {
  const state = { exited: false, code: undefined as number | undefined };
  const exit = vi.spyOn(process, "exit").mockImplementation(((c?: number) => {
    state.exited = true;
    state.code = c;
    throw new Error("__exit__");
  }) as never);
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    fn();
  } catch (e) {
    if ((e as Error).message !== "__exit__") throw e;
  } finally {
    exit.mockRestore();
  }
  return state;
}

afterEach(() => vi.restoreAllMocks());

describe("parseArgs", () => {
  it("parses build with value flags", () => {
    const p = parseArgs(["build", "--repo", "x", "--out", "y", "--exclude", "**/*.test.ts"]);
    expect(p.command).toBe("build");
    expect(p.values.repo).toBe("x");
    expect(p.values.out).toBe("y");
    expect(p.values.exclude).toBe("**/*.test.ts");
  });

  it("collects the positional query for find and supports boolean flags", () => {
    const p = parseArgs(["find", "retry", "backoff", "--json"]);
    expect(p.command).toBe("find");
    expect(p.positional).toEqual(["retry", "backoff"]);
    expect(p.bools.has("json")).toBe(true);
  });

  it("supports --key=value and --no-mermaid", () => {
    const p = parseArgs(["build", "--repo=.", "--no-mermaid"]);
    expect(p.values.repo).toBe(".");
    expect(p.bools.has("no-mermaid")).toBe(true);
  });

  it("exits on an unknown command", () => {
    expect(trapExit(() => parseArgs(["frobnicate"])).code).toBe(1);
  });

  it("exits on an unknown flag", () => {
    expect(trapExit(() => parseArgs(["build", "--bogus", "v"])).code).toBe(1);
  });

  it("exits 1 when a boolean flag is given a value", () => {
    expect(trapExit(() => parseArgs(["build", "--no-mermaid=1"])).code).toBe(1);
  });

  it("exits 0 on --version", () => {
    expect(trapExit(() => parseArgs(["--version"])).code).toBe(0);
  });

  it("parses embed with --force", () => {
    const p = parseArgs(["embed", "--out", "x", "--force"]);
    expect(p.command).toBe("embed");
    expect(p.values.out).toBe("x");
    expect(p.bools.has("force")).toBe(true);
  });
});
