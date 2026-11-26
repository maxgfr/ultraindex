import { describe, it, expect, vi, afterEach } from "vitest";
import { parseArgs, HELP, VALUE_FLAGS, BOOL_FLAGS } from "../src/cli.js";

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

  it("parses delta with --base as a value flag and --staged as a boolean", () => {
    const p = parseArgs(["delta", "--base", "origin/main", "--depth", "3", "--json"]);
    expect(p.command).toBe("delta");
    expect(p.values.base).toBe("origin/main");
    expect(p.values.depth).toBe("3");
    expect(p.bools.has("json")).toBe(true);
    const staged = parseArgs(["delta", "--staged"]);
    expect(staged.bools.has("staged")).toBe(true);
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

describe("--help", () => {
  const usage = (cmd: string): string[] => HELP.split("\n").filter((l) => l.startsWith(`  ultraindex ${cmd} `));

  it("lists map --json in the usage line and the flag docs", () => {
    expect(usage("map").some((l) => l.includes("[--json]"))).toBe(true);
    const json = HELP.slice(HELP.indexOf("  --json "), HELP.indexOf("  --prose "));
    expect(json).toMatch(/\bmap\b/);
  });

  it("puts --json on the usage line of every command that accepts it", () => {
    for (const cmd of ["build", "find", "embed", "neighbors", "symbols", "impact", "delta", "map", "status", "ask", "check", "verify"]) {
      expect(usage(cmd).some((l) => l.includes("--json")), cmd).toBe(true);
    }
  });

  it("documents every flag the parser accepts", () => {
    for (const flag of [...VALUE_FLAGS, ...BOOL_FLAGS]) {
      expect(HELP, `--${flag} is accepted but not in --help`).toMatch(new RegExp(`--${flag}(?![\\w-])`));
    }
  });

  it("describes symbols call sites and mentions apart", () => {
    expect(HELP).toContain("callSites");
    expect(HELP).toContain("mentions");
    expect(HELP).toMatch(/unbound\s+name matches/);
  });
});
