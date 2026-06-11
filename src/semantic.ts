import type { FileNode, ModuleNode, SemanticConfig } from "./types.js";
import { indexPaths } from "./store.js";
import { readIfExists } from "./output.js";
import { clip } from "./util.js";
import { byStr } from "./sort.js";

// The optional semantic layer talks to any OpenAI-compatible /v1/embeddings
// endpoint (a local TEI container via docker-compose, Ollama, or a hosted API).
// It is OFF unless configured — the core engine stays zero-dependency and
// network-free, and `find` degrades to pure lexical when the provider is gone.

// Env wins over <out>/semantic.json so a key never has to live in a committed
// file. Returns undefined when no baseUrl+model is available — semantic off.
export function loadSemanticConfig(outDir: string): SemanticConfig | undefined {
  const env: Partial<SemanticConfig> = {
    baseUrl: process.env.ULTRAINDEX_EMBED_BASE_URL,
    model: process.env.ULTRAINDEX_EMBED_MODEL,
    apiKey: process.env.ULTRAINDEX_EMBED_API_KEY,
  };
  let file: Partial<SemanticConfig> = {};
  const raw = readIfExists(indexPaths(outDir).semantic);
  if (raw !== undefined) {
    try {
      file = JSON.parse(raw) as Partial<SemanticConfig>;
    } catch {
      /* malformed config = no config; `embed` will say how to fix it */
    }
  }
  const baseUrl = env.baseUrl || file.baseUrl;
  const model = env.model || file.model;
  if (!baseUrl || !model) return undefined;
  const apiKey = env.apiKey || file.apiKey;
  return { baseUrl, model, ...(apiKey ? { apiKey } : {}) };
}

// Normalize a base URL into the embeddings endpoint: accept it with or without
// a trailing slash or `/v1`, so `http://localhost:8080`, `…:8080/`, and
// `…:8080/v1` all reach POST <base>/v1/embeddings.
export function embeddingsUrl(baseUrl: string): string {
  let base = baseUrl.replace(/\/+$/, "");
  if (!/\/v\d+$/.test(base)) base += "/v1";
  return base + "/embeddings";
}

const BATCH_SIZE = 32;
const TIMEOUT_MS = 30_000;

// Embed texts through the provider, batched. Throws one clear Error on any
// failure — callers decide whether that aborts (`embed`) or degrades (`find`).
export async function embedTexts(cfg: SemanticConfig, texts: string[]): Promise<number[][]> {
  const url = embeddingsUrl(cfg.baseUrl);
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: cfg.model, input: batch }),
        signal: controller.signal,
      });
    } catch (e) {
      throw new Error(`embeddings provider unreachable at ${url}: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const body = clip(await res.text().catch(() => ""), 200);
      throw new Error(`embeddings provider returned ${res.status} for ${url}${body ? `: ${body}` : ""}`);
    }
    const json = (await res.json()) as { data?: { index?: number; embedding?: number[] }[] };
    const data = json.data;
    if (!Array.isArray(data) || data.length !== batch.length) {
      throw new Error(`embeddings provider returned ${data?.length ?? 0} vectors for ${batch.length} inputs`);
    }
    // The OpenAI shape carries an index per row — respect it rather than
    // assuming response order.
    const rows: number[][] = new Array(batch.length);
    data.forEach((d, j) => {
      const idx = typeof d.index === "number" ? d.index : j;
      if (!Array.isArray(d.embedding)) throw new Error("embeddings provider returned a row without an embedding");
      rows[idx] = d.embedding;
    });
    out.push(...rows);
  }
  return out;
}

const EMBED_TEXT_MAX = 4000;

// The deterministic text embedded for one module: identity, member file
// titles/summaries, and the enriched prose — the same signals lexical `find`
// scores, so the two rankings see the same evidence.
export function moduleEmbedText(m: ModuleNode, files: FileNode[], prose?: string): string {
  const members = files
    .slice()
    .sort((a, b) => byStr(a.rel, b.rel))
    .map((f) => [f.rel, f.title, f.summary].filter(Boolean).join(" — "));
  const parts = [m.title, m.path, m.slug, m.summary, ...members, prose ?? ""];
  return clip(parts.filter(Boolean).join("\n"), EMBED_TEXT_MAX);
}

// Cosine similarity; -1 on dimension mismatch (a corrupt store or a model swap
// mid-flight) so the mismatching row simply ranks last instead of crashing.
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return -1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return -1;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
