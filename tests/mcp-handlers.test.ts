import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type JsonRpcMessage } from "../src/mcp/server.js";
import { callTool, ToolError } from "../src/mcp/handlers.js";

// The handlers driven through the JSON-RPC core, in-process, against a real
// index built from a real fixture. Nothing here mocks the engine: the point is
// that a tool name reaches the same library call the CLI makes.

const FIXTURE = resolve("tests/fixtures/mini-repo");
let REPO: string;
const temps: string[] = [];

beforeAll(async () => {
  REPO = mkdtempSync(join(tmpdir(), "ui-mcp-"));
  temps.push(REPO);
  cpSync(FIXTURE, REPO, { recursive: true });
  // Build the index the read tools need. This is also the write-tool test:
  // going through callTool proves the allowWrite gate lets it through.
  await callTool("ultraindex_build", { repo: REPO }, { allowWrite: true });
}, 120_000);

afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

const server = createServer();

async function rpc(msg: Omit<JsonRpcMessage, "jsonrpc">): Promise<JsonRpcMessage | undefined> {
  let out: JsonRpcMessage | undefined;
  await server.handle({ jsonrpc: "2.0", ...msg }, (m) => {
    out = m;
  });
  return out;
}

async function call(name: string, args: Record<string, unknown>): Promise<JsonRpcMessage> {
  return (await rpc({ id: 1, method: "tools/call", params: { name, arguments: args } }))!;
}

async function ok(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await call(name, args);
  const result = res.result as { content: { text: string }[]; isError?: boolean } | undefined;
  expect(res.error, `unexpected JSON-RPC error: ${JSON.stringify(res.error)}`).toBeUndefined();
  expect(result?.isError, `unexpected isError: ${result?.content?.[0]?.text}`).toBeFalsy();
  return JSON.parse(result!.content[0]!.text);
}

async function errorText(name: string, args: Record<string, unknown>): Promise<string> {
  const res = await call(name, args);
  const result = res.result as { content: { text: string }[]; isError?: boolean } | undefined;
  expect(result?.isError, "expected an isError tool result").toBe(true);
  return result!.content[0]!.text;
}

describe("lifecycle methods", () => {
  it("negotiates a protocol version and advertises all three primitives", async () => {
    const res = await rpc({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    const r = res!.result as { protocolVersion: string; serverInfo: { name: string; version: string }; capabilities: unknown };
    expect(r.protocolVersion).toBe("2025-06-18");
    expect(r.serverInfo.name).toBe("ultraindex");
    expect(r.serverInfo.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(r.capabilities).toEqual({
      tools: { listChanged: false },
      resources: { subscribe: false, listChanged: false },
      prompts: { listChanged: false },
    });
  });

  it("answers nothing to a notification", async () => {
    expect(await rpc({ method: "notifications/initialized" })).toBeUndefined();
  });

  it("rejects an unknown method, an unknown tool and bad arguments as protocol errors", async () => {
    // The distinction matters: a client bug must not arrive as a result the
    // model then tries to reason around.
    expect((await rpc({ id: 1, method: "resources/subscribe" }))!.error).toMatchObject({ code: -32601 });
    expect((await call("ultraindex_nope", {})).error).toMatchObject({ code: -32602 });
    expect((await call("ultraindex_find", { repo: REPO })).error).toMatchObject({ code: -32602 });
  });
});

describe("navigation tools", () => {
  it("map returns the index and one module entry", async () => {
    const all = await ok("ultraindex_map", { repo: REPO });
    expect(String(all.content).length).toBeGreaterThan(100);

    const slug = (await ok("ultraindex_status", { repo: REPO })).suggestedNext;
    if (typeof slug === "string" && slug) {
      const one = await ok("ultraindex_map", { repo: REPO, module: slug });
      expect(one.module).toBe(slug);
    }
  });

  it("find ranks modules for a task", async () => {
    const res = await ok("ultraindex_find", { repo: REPO, query: "config parsing", k: 3 });
    expect(Array.isArray(res.results)).toBe(true);
    expect((res.results as unknown[]).length).toBeLessThanOrEqual(3);
  });

  it("status reports the enrichment queue", async () => {
    const res = await ok("ultraindex_status", { repo: REPO });
    expect(res.total).toBeTypeOf("number");
    expect(res.enriched).toBeTypeOf("number");
  });

  it("ask returns real source plus the next step", async () => {
    const res = await ok("ultraindex_ask", { repo: REPO, question: "how is config parsed?" });
    expect(String(res.evidence).length).toBeGreaterThan(50);
    expect(String(res.next)).toContain("ultraindex_check");
  });
});

describe("read", () => {
  it("returns a line window and reports the real total", async () => {
    const res = await ok("ultraindex_read", { repo: REPO, path: "src/index.ts", start_line: 1, end_line: 3 });
    expect(res.start_line).toBe(1);
    expect(res.end_line).toBeLessThanOrEqual(3);
    expect(res.total_lines).toBeTypeOf("number");
    expect(String(res.content).split("\n").length).toBeLessThanOrEqual(3);
  });

  it("refuses a path outside the repo and its index", async () => {
    // Containment is the whole point: this server can be reached over HTTP.
    expect(await errorText("ultraindex_read", { repo: REPO, path: "/etc/passwd" })).toMatch(/outside the repo/);
    expect(await errorText("ultraindex_read", { repo: REPO, path: "../../etc/passwd" })).toMatch(/outside the repo|no such file/);
  });

  it("reports a missing file as a tool error, not a crash", async () => {
    expect(await errorText("ultraindex_read", { repo: REPO, path: "src/nope.ts" })).toMatch(/no such file/);
  });
});

describe("the citation gate", () => {
  it("passes an answer whose citations resolve", async () => {
    const res = await ok("ultraindex_check", { repo: REPO, answer_text: "Config is parsed here [src/index.ts:1]." });
    expect(res.mode).toBe("answer");
    expect(res.answer_source).toBe("inline");
    expect(res.citations).toBeGreaterThan(0);
  });

  it("fails an answer whose citation does not resolve — as a verdict, not an error", async () => {
    // ok:false must come back as a normal result. Reported as a tool failure,
    // the model reads it as "the gate is broken" instead of "my answer is".
    const res = await ok("ultraindex_check", { repo: REPO, answer_text: "Invented [src/does-not-exist.ts:99]." });
    expect(res.ok).toBe(false);
    expect((res.errors as string[]).length).toBeGreaterThan(0);
  });

  it("checks the index itself when given no answer", async () => {
    const res = await ok("ultraindex_check", { repo: REPO });
    expect(res.mode).toBe("index");
  });

  it("refuses answer_text and answer_file together", async () => {
    expect(await errorText("ultraindex_check", { repo: REPO, answer_text: "x", answer_file: "/tmp/a.md" })).toMatch(/not both/);
  });
});

describe("verify", () => {
  it("emits a claim worklist without writing anything", async () => {
    const res = await ok("ultraindex_verify", { repo: REPO, answer_text: "Config is parsed here [src/index.ts:1]." });
    expect(Array.isArray(res.pairs)).toBe(true);
    expect(res.emitted).toBeTypeOf("number");
    expect(String(res.next)).toMatch(/supported/);
  });

  it("caps the worklist and says how many it dropped", async () => {
    const many = Array.from({ length: 8 }, (_, i) => `Claim ${i} [src/index.ts:1].`).join("\n\n");
    const res = await ok("ultraindex_verify", { repo: REPO, answer_text: many, max_verify: 2 });
    expect(res.emitted).toBe(2);
    expect(String(res.note)).toMatch(/dropped/);
  });
});

describe("guardrails", () => {
  it("refuses a write tool unless the server allows writes", async () => {
    // Defense in depth: the server also hides these from tools/list, so this is
    // the path a direct callTool would take.
    await expect(callTool("ultraindex_build", { repo: REPO })).rejects.toThrow(ToolError);
    await expect(callTool("ultraindex_build", { repo: REPO })).rejects.toThrow(/--allow-write/);
  });

  it("names the missing STEP when there is no index", async () => {
    const bare = mkdtempSync(join(tmpdir(), "ui-bare-"));
    temps.push(bare);
    const msg = await errorText("ultraindex_find", { repo: bare, query: "x" });
    expect(msg).toMatch(/no index/);
    expect(msg).toMatch(/ultraindex_build/);
  });

  it("reports a repo that does not exist", async () => {
    expect(await errorText("ultraindex_map", { repo: "/nope/not/here" })).toMatch(/repo not found/);
  });

  it("uses the server's default repo when the caller omits one", async () => {
    const withDefault = createServer({ defaultRepo: REPO });
    let out: JsonRpcMessage | undefined;
    await withDefault.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ultraindex_status", arguments: {} } }, (m) => {
      out = m;
    });
    const result = out!.result as { content: { text: string }[]; isError?: boolean };
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]!.text).total).toBeTypeOf("number");
  });
});
