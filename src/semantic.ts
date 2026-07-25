import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import type { FileNode, ModuleNode } from "./types.js";
import {
  clip,
  byStr,
  embedViaEndpoint,
  encode,
  encodeQueryViaEndpoint,
  intDot,
  loadEmbedModel,
  quantize,
  resolveEmbedEndpoint,
  resolveEmbedModelDir,
  sharedGrammarsCacheDir,
} from "./engine.js";
import type { StaticEmbedModel } from "./engine.js";

// The optional semantic layer runs on the vendored engine's embedding tiers —
// no API key, no provider to stand up, no `docker compose`. Two tiers, engine
// precedence (endpoint > static > none):
//
//   static   a `model.json` on disk (`codeindex embed pull` fetches it,
//            sha256-verified). Pure JS lookup-table encoder: tokenize →
//            mean-pool → L2-normalize → int8-quantize. Byte-DETERMINISTIC, so
//            vectors.json is reproducible like every other artifact.
//   endpoint CODEINDEX_EMBED_ENDPOINT points at a local containerized model.
//            Setting it is explicit intent, so it wins over a local model; its
//            float vectors go through the SAME quantize + integer-ranking path.
//
// With neither resolvable the layer is simply off and `find` stays lexical —
// never an error, never a silent network touch.
//
// What stays ultraindex's own: the embedded TEXT is per MODULE and folds in the
// agent-written prose (see `moduleEmbedText`). The engine embeds per file/symbol
// and knows nothing about prose, so its file-level index cannot answer "which
// module did someone already explain in these terms".

export type EmbedTier =
  | { kind: "static"; model: StaticEmbedModel; label: string }
  | { kind: "endpoint"; url: string; label: string };

// Where ultraindex pulls the static model to. The engine's own resolution order
// is CODEINDEX_EMBED_DIR > <repo>/.codeindex/models > <cwd>/.codeindex/models —
// all three of which drop a multi-megabyte asset INSIDE the user's repository.
// The model is identical for every repo on the machine, so it belongs in the
// shared cache the grammars already use. We derive that path from the engine's
// own cache root rather than re-deriving XDG rules, and hand it to the engine
// via CODEINDEX_EMBED_DIR — the one knob that wins over the in-repo defaults.
//
// (Upstream this should be the engine's own default, mirroring
// `sharedGrammarsCacheDir`; until then this keeps working trees clean.)
export function sharedEmbedCacheDir(): string {
  return join(dirname(dirname(sharedGrammarsCacheDir())), "models");
}

// Resolve the active tier for a repo, or undefined when the layer is off.
// Mirrors the engine's own precedence so ultraindex and `codeindex search
// --semantic` never disagree about which tier is live — with the shared cache
// consulted as a last resort, after everything the engine would look at.
export function resolveEmbedTier(repo: string): EmbedTier | undefined {
  const url = resolveEmbedEndpoint();
  if (url) return { kind: "endpoint", url, label: `endpoint ${url}` };
  const dir = resolveEmbedModelDir(repo) ?? cachedModelDir();
  if (!dir) return undefined;
  // A truncated or malformed model.json (an interrupted pull, a botched copy)
  // makes loadEmbedModel throw. The whole contract of this layer is that it
  // degrades to lexical and never breaks `find`, so an unreadable model is
  // treated exactly like an absent one.
  let model: StaticEmbedModel | undefined;
  try {
    model = loadEmbedModel(dir);
  } catch {
    return undefined;
  }
  if (!model) return undefined;
  return { kind: "static", model, label: `${model.modelId} (dim ${model.dim})` };
}

// The id a vectors.json built by this tier is stamped with. Compared at query
// time: two different models can share a dimension, and ranking a store built
// by one against a query encoded by the other yields confident nonsense that no
// dimension check would catch.
export function tierModelId(tier: EmbedTier): string {
  return tier.kind === "static" ? tier.model.modelId : `endpoint:${tier.url}`;
}

function cachedModelDir(): string | undefined {
  const dir = sharedEmbedCacheDir();
  return existsSync(join(dir, "model.json")) ? dir : undefined;
}

// The int8 quantization scale the engine encodes with. A dot product of two
// unit vectors quantized at this scale peaks at QUANT², so dividing by it turns
// the integer score back into a cosine-comparable [-1, 1] number.
const QUANT = 127;
const QUANT_SQ = QUANT * QUANT;

// Cosine-equivalent similarity from the engine's integer dot product. The
// ranking itself stays integer (exact, platform-stable); this is only used to
// apply a noise floor and to report.
export function similarity(a: Int8Array, b: Int8Array): number {
  if (a.length !== b.length || a.length === 0) return -1;
  return intDot(a, b) / QUANT_SQ;
}

// Embed texts through the active tier. The static tier is synchronous and
// offline; the endpoint tier batches over HTTP and is quantized on arrival so
// both tiers produce identical downstream shapes.
export async function embedTexts(tier: EmbedTier, texts: string[]): Promise<Int8Array[]> {
  if (tier.kind === "static") return texts.map((t) => encode(tier.model, t));
  const floats = await embedViaEndpoint(texts, { url: tier.url });
  return floats.map((v) => quantize(v));
}

// Embed one query through the active tier.
export async function encodeQuery(tier: EmbedTier, query: string): Promise<Int8Array> {
  if (tier.kind === "static") return encode(tier.model, query);
  return encodeQueryViaEndpoint(query, { url: tier.url });
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
