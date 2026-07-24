import { describe, it, expect, afterEach } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Drives the SHIPPED bundle (skills/ultraindex/scripts/ultraindex.mjs) — the
// artifact agents actually run — through the `mcp` verb: a newline-delimited
// JSON-RPC 2.0 handshake over stdio (initialize, then tools/list). Guards that
// the verb stays wired to the vendored engine's MCP server and that the server
// actually answers, not just that the process starts.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = join(ROOT, "skills/ultraindex/scripts/ultraindex.mjs");

interface RpcMessage {
  jsonrpc: string;
  id?: number | string | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

let child: ChildProcessWithoutNullStreams | undefined;

afterEach(() => {
  child?.kill("SIGKILL");
  child = undefined;
});

// Send one JSON-RPC request and resolve with the response bearing the same id.
// stdout is parsed line-by-line (the server emits one JSON object per line).
function request(proc: ChildProcessWithoutNullStreams, msg: Record<string, unknown>, timeoutMs: number): Promise<RpcMessage> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`no response to ${String(msg.method)} within ${timeoutMs}ms`));
    }, timeoutMs);
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString("utf8");
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let parsed: RpcMessage;
        try {
          parsed = JSON.parse(line) as RpcMessage;
        } catch {
          continue; // not a complete/valid JSON line — keep reading
        }
        if (parsed.id === msg.id) {
          cleanup();
          resolve(parsed);
          return;
        }
      }
    };
    const onExit = (code: number | null): void => {
      cleanup();
      reject(new Error(`server exited (code ${String(code)}) before answering ${String(msg.method)}`));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      proc.stdout.off("data", onData);
      proc.off("exit", onExit);
    };
    proc.stdout.on("data", onData);
    proc.on("exit", onExit);
    proc.stdin.write(JSON.stringify(msg) + "\n");
  });
}

describe("ultraindex mcp (shipped bundle)", () => {
  it("answers initialize then tools/list with the engine's tool set", async () => {
    child = spawn(process.execPath, [BUNDLE, "mcp"], {
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    const init = await request(
      child,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "ultraindex-test", version: "0.0.0" },
        },
      },
      8000,
    );
    expect(init.error).toBeUndefined();
    expect(init.result?.protocolVersion).toBe("2024-11-05");
    const serverInfo = init.result?.serverInfo as { name?: string } | undefined;
    // Engine v2.13.0 hardcodes its own server name; no override is exposed yet.
    expect(serverInfo?.name).toBe("codeindex");

    const list = await request(child, { jsonrpc: "2.0", id: 2, method: "tools/list" }, 8000);
    expect(list.error).toBeUndefined();
    const tools = (list.result?.tools ?? []) as { name: string }[];
    const names = tools.map((t) => t.name);
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain("find_symbol");
    expect(names).toContain("scan_summary");

    child.kill("SIGKILL");
  }, 10000);
});
