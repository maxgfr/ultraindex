import { describe, it, expect } from "vitest";
import { TOOLS, WRITE_TOOLS, TOOL_META, annotationsFor, toolsFor } from "../src/mcp/tools.js";
import { validateArgs } from "../src/mcp/protocol.js";

const ALL = [...TOOLS, ...WRITE_TOOLS];

describe("tool declarations", () => {
  it("names every tool consistently and uniquely", () => {
    const names = ALL.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^ultraindex_[a-z_]+$/);
  });

  it("declares a well-formed object schema whose required properties exist", () => {
    for (const t of ALL) {
      expect(t.inputSchema.type, t.name).toBe("object");
      expect(t.inputSchema.properties, t.name).toBeTypeOf("object");
      expect(Array.isArray(t.inputSchema.required), t.name).toBe(true);
      for (const r of t.inputSchema.required) {
        expect(Object.keys(t.inputSchema.properties), `${t.name}.required lists "${r}"`).toContain(r);
      }
      for (const [key, spec] of Object.entries(t.inputSchema.properties)) {
        expect(spec.description, `${t.name}.${key} has no description`).toBeTruthy();
      }
    }
  });

  it("gives every tool a description that says what it is for", () => {
    for (const t of ALL) {
      expect(t.description.length, t.name).toBeGreaterThan(80);
      expect(t.title, t.name).toBeTruthy();
    }
  });

  it("takes `repo` on every tool, since every tool works against one repository", () => {
    for (const t of ALL) {
      expect(t.inputSchema.properties.repo, t.name).toBeTruthy();
      expect(t.inputSchema.required, t.name).toContain("repo");
    }
  });

  it("tells the caller an index is needed, on every tool that needs one", () => {
    // The single most common reason a call fails. A description that omits it
    // leaves the model reading "no index" as a broken tool rather than a
    // missing step. `read` and `verify` are exempt because both resolve against
    // the REPO — read opens a file, verify reads the line each citation names —
    // so neither has an index to be missing.
    const INDEX_FREE = new Set(["ultraindex_read", "ultraindex_verify"]);
    for (const t of TOOLS) {
      if (INDEX_FREE.has(t.name)) {
        expect(t.description, `${t.name} claims to need an index it does not use`).not.toContain("ultraindex_build");
        continue;
      }
      expect(t.description, t.name).toContain("ultraindex_build");
    }
  });

  it("declares an outputSchema only where the result shape is small and stable", () => {
    expect(ALL.filter((t) => t.outputSchema).map((t) => t.name)).toEqual(["ultraindex_read"]);
  });
});

describe("annotations", () => {
  // Asserted tool by tool: a new tool with no expected row fails here rather
  // than sliding in unannotated.
  const EXPECTED: Record<string, { readOnlyHint: boolean; openWorldHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean }> = {
    ultraindex_map: { readOnlyHint: true, openWorldHint: false },
    ultraindex_find: { readOnlyHint: true, openWorldHint: false },
    ultraindex_ask: { readOnlyHint: true, openWorldHint: false },
    ultraindex_dossier: { readOnlyHint: true, openWorldHint: false },
    ultraindex_symbols: { readOnlyHint: true, openWorldHint: false },
    ultraindex_neighbors: { readOnlyHint: true, openWorldHint: false },
    ultraindex_impact: { readOnlyHint: true, openWorldHint: false },
    ultraindex_delta: { readOnlyHint: true, openWorldHint: false },
    ultraindex_status: { readOnlyHint: true, openWorldHint: false },
    ultraindex_read: { readOnlyHint: true, openWorldHint: false },
    ultraindex_check: { readOnlyHint: true, openWorldHint: false },
    ultraindex_verify: { readOnlyHint: true, openWorldHint: false },
    ultraindex_build: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    ultraindex_embed: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  };

  it("annotates every declared tool, and only declared tools", () => {
    expect(Object.keys(TOOL_META).sort()).toEqual(ALL.map((t) => t.name).sort());
    expect(Object.keys(EXPECTED).sort()).toEqual(ALL.map((t) => t.name).sort());
  });

  it("matches the expected hint matrix", () => {
    for (const [name, want] of Object.entries(EXPECTED)) {
      expect(annotationsFor(name), name).toEqual(want);
    }
  });

  it("marks exactly the tools that write into the user's repository", () => {
    // The read-only line is drawn at the USER'S tree, not at whether a tool
    // touches a disk at all. Only build and embed create files there.
    const writers = ALL.filter((t) => TOOL_META[t.name]!.write).map((t) => t.name);
    expect(writers.sort()).toEqual(["ultraindex_build", "ultraindex_embed"]);
  });
});

describe("toolsFor", () => {
  it("hides the write tools unless the server was started with --allow-write", () => {
    expect(toolsFor("2025-06-18").map((t) => t.name)).not.toContain("ultraindex_build");
    expect(toolsFor("2025-06-18", { allowWrite: true }).map((t) => t.name)).toContain("ultraindex_build");
  });

  it("gates rich fields and annotations on the negotiated protocol version", () => {
    const old = toolsFor("2024-11-05").find((t) => t.name === "ultraindex_read")!;
    expect(old.annotations).toBeUndefined();
    expect(old.title).toBeUndefined();
    expect(old.outputSchema).toBeUndefined();

    const mid = toolsFor("2025-03-26").find((t) => t.name === "ultraindex_read")!;
    expect(mid.annotations).toBeTruthy();
    expect(mid.title).toBeUndefined();

    const now = toolsFor("2025-06-18").find((t) => t.name === "ultraindex_read")!;
    expect(now.annotations).toBeTruthy();
    expect(now.title).toBeTruthy();
    expect(now.outputSchema).toBeTruthy();
  });

  it("makes `repo` optional, and says so, when the server has a default", () => {
    for (const t of toolsFor("2025-06-18", { defaultRepo: "/srv/app", allowWrite: true })) {
      expect(t.inputSchema.required, t.name).not.toContain("repo");
      expect(t.inputSchema.properties.repo!.description, t.name).toContain("/srv/app");
    }
  });

  it("leaves the schema untouched without a default repo", () => {
    for (const t of toolsFor("2025-06-18", { allowWrite: true })) {
      expect(t.inputSchema.required, t.name).toContain("repo");
    }
  });
});

describe("declared schemas accept what the handlers expect", () => {
  it("validates a representative call per tool", () => {
    const sample: Record<string, Record<string, unknown>> = {
      ultraindex_map: { repo: "/r", module: "core" },
      ultraindex_find: { repo: "/r", query: "auth", k: 5 },
      ultraindex_ask: { repo: "/r", question: "how?", budget: 4000 },
      ultraindex_dossier: { repo: "/r", slug: "core" },
      ultraindex_symbols: { repo: "/r", name: "parse" },
      ultraindex_neighbors: { repo: "/r", target: "src/a.ts", depth: 2, kind: "import" },
      ultraindex_impact: { repo: "/r", target: "src/a.ts" },
      ultraindex_delta: { repo: "/r", base: "main", staged: false },
      ultraindex_status: { repo: "/r" },
      ultraindex_read: { repo: "/r", path: "src/a.ts", start_line: 1, end_line: 20 },
      ultraindex_check: { repo: "/r", answer_text: "x [src/a.ts:1]", semantic: true },
      ultraindex_verify: { repo: "/r", answer_text: "x [src/a.ts:1]", max_verify: 10 },
      ultraindex_build: { repo: "/r", include: ["src/**"], max_files: 100, no_cache: true },
      ultraindex_embed: { repo: "/r", force: true },
    };
    for (const t of ALL) {
      expect(validateArgs(t.inputSchema, sample[t.name]!), t.name).toBeUndefined();
    }
  });

  it("rejects a missing required argument", () => {
    const find = TOOLS.find((t) => t.name === "ultraindex_find")!;
    expect(validateArgs(find.inputSchema, { repo: "/r" })).toMatch(/`query` is required/);
  });

  it("accepts a numeric string, since several clients stringify every argument", () => {
    const find = TOOLS.find((t) => t.name === "ultraindex_find")!;
    expect(validateArgs(find.inputSchema, { repo: "/r", query: "x", k: "5" })).toBeUndefined();
  });
});
