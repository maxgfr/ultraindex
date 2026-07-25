import { sha1, byStr } from "./engine.js";
import { isEnrichedBody } from "./merge.js";
import type { Region } from "./merge.js";

// Prose is the only thing in the index that can become silently WRONG. The code
// view and the graph are regenerated from source on every build, so they cannot
// drift; a business analysis written six months ago still reads as true after
// the code under it changed. Worse, downstream trusts it MORE — `find` reports
// `enriched` as higher-signal and boosts it in ranking.
//
// So record, per module, two content-derived scalars: a fingerprint of the prose
// itself, and a fingerprint of the source state that prose was last written
// against. Both are content-derived, never clock-derived, so a rebuild of an
// unchanged repo re-emits them byte-identically.

// sha1 over the entry's ENRICHED human regions ("key\0body", sorted by key).
// "" when the entry is all stubs. Moves if and only if someone edited the prose.
export function proseDigest(regions: Region[]): string {
  const parts = regions
    .filter((r) => r.type === "human" && isEnrichedBody(r.body))
    .map((r) => `${r.key}\0${r.body}`)
    .sort(byStr);
  return parts.length === 0 ? "" : sha1(parts.join("\n"));
}

// sha1 over "rel\0hash" for each member, sorted by rel. A member's content
// changing, a member being added or removed, or a member being MOVED all move
// this hash — all three genuinely invalidate an explanation. A member missing
// from `hashes` (deleted since) contributes a sentinel rather than being
// skipped, so a deletion moves the hash instead of silently matching.
export function proseSourceHash(members: string[], hashes: Record<string, string>): string {
  const parts = members
    .slice()
    .sort(byStr)
    .map((rel) => `${rel}\0${hashes[rel] ?? "<deleted>"}`);
  return sha1(parts.join("\n"));
}

export type ProseFreshness =
  | "none" // no prose at all — a stub
  | "unknown" // enriched, but no recorded source state (index predates tracking)
  | "fresh" // written against the source as it stands
  | "stale"; // the source moved after the prose was written

// The ONE predicate, used identically by `check` (live hashes) and `status`
// (the manifest's hashes). `liveDigest` is the digest of the prose ON DISK NOW.
export function proseFreshness(
  rec: { digest: string; source: string } | undefined,
  liveDigest: string,
  members: string[],
  hashes: Record<string, string>,
): ProseFreshness {
  if (liveDigest === "") return "none";
  // No record at all. Two situations are indistinguishable from here — prose
  // written since the last build, and prose from an index that predates this
  // tracking — so claim neither. `unknown` is not stale (nothing says the
  // source moved) and not fresh (nothing proves it didn't); a rebuild resolves
  // it either way.
  if (!rec) return "unknown";
  // Recorded prose whose digest has since moved: it was edited after the build
  // that recorded it, so it was necessarily written against source at least as
  // new as that record. Without this branch, revising an entry and then running
  // `status` before rebuilding would report the just-written prose as stale.
  if (rec.digest !== liveDigest) return "fresh";
  return proseSourceHash(members, hashes) === rec.source ? "fresh" : "stale";
}
