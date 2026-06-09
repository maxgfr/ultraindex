import { shortHash } from "./hash.js";
import { byStr } from "./sort.js";

// An encyclopedia entry is an ordered list of regions. `gen` regions are owned by
// the tool and rewritten wholesale every build; `human` regions are owned by the
// agent/author and NEVER overwritten — matched by key, not position. This split
// is what lets `build` refresh the code view + graph while preserving prose.
export interface Region {
  type: "gen" | "human";
  key: string;
  body: string;
}

const OPEN_RE = /^<!--\s*ui:(gen|human)\s+key=([A-Za-z0-9_-]+)(?:\s+hash=([a-f0-9]+))?\s*-->\s*$/;
const CLOSE_RE = /^<!--\s*\/ui:(gen|human)\s+key=([A-Za-z0-9_-]+)\s*-->\s*$/;

function trimBlank(lines: string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === "") start++;
  while (end > start && lines[end - 1]!.trim() === "") end--;
  return lines.slice(start, end).join("\n");
}

// Serialize regions back to markdown. `gen` regions carry a content fingerprint
// so an unchanged rebuild produces byte-identical output (clean git diffs).
export function serializeRegions(regions: Region[]): string {
  const blocks = regions.map((r) => {
    if (r.type === "gen") {
      return `<!-- ui:gen key=${r.key} hash=${shortHash(r.body)} -->\n${r.body}\n<!-- /ui:gen key=${r.key} -->`;
    }
    return `<!-- ui:human key=${r.key} -->\n${r.body}\n<!-- /ui:human key=${r.key} -->`;
  });
  return blocks.join("\n\n") + "\n";
}

// Parse a stored entry into ordered regions. Text outside any fence is preserved
// as an orphan HUMAN region keyed by a hash of its content (stable across
// re-parses, collision-resistant). Returns ok=false on malformed/unbalanced
// fences so the caller can refuse to rewrite and keep the old file intact.
export function parseRegions(text: string): { regions: Region[]; ok: boolean } {
  const lines = text.split(/\r?\n/);
  const regions: Region[] = [];
  let orphan: string[] = [];
  let open: { type: "gen" | "human"; key: string; body: string[] } | null = null;

  const flushOrphan = () => {
    const body = trimBlank(orphan);
    orphan = [];
    if (body) regions.push({ type: "human", key: `orphan-${shortHash(body)}`, body });
  };

  for (const line of lines) {
    const o = OPEN_RE.exec(line);
    const c = CLOSE_RE.exec(line);
    if (open) {
      if (c) {
        if (c[1] !== open.type || c[2] !== open.key) return { regions: [], ok: false };
        regions.push({ type: open.type, key: open.key, body: trimBlank(open.body) });
        open = null;
        continue;
      }
      if (o) return { regions: [], ok: false }; // nested open — malformed
      open.body.push(line);
      continue;
    }
    if (c) return { regions: [], ok: false }; // close with no open — malformed
    if (o) {
      flushOrphan();
      open = { type: o[1] as "gen" | "human", key: o[2]!, body: [] };
      continue;
    }
    orphan.push(line);
  }
  if (open) return { regions: [], ok: false }; // unterminated region
  flushOrphan();
  return { regions, ok: true };
}

// Collect human-owned bodies by key from a stored entry (for rename migration).
export function humanBodies(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const { regions, ok } = parseRegions(text);
  if (!ok) return out;
  for (const r of regions) if (r.type === "human") out.set(r.key, r.body);
  return out;
}

export interface MergeResult {
  content: string;
  humanKeys: string[];
  migratedKeys: string[];
  conflict?: string; // set when the existing file was kept un-rewritten
}

// Merge a freshly rendered region spec with an existing entry: GEN regions take
// the new body; HUMAN regions keep the existing body (by key), falling back to a
// migrated predecessor's body, then to the rendered stub. Human regions/orphans
// not in the spec are preserved and appended (deterministically, by key) so no
// prose is ever lost. If the existing file's fences are unparseable, the old file
// is kept verbatim and a conflict is reported.
export function mergeEntry(
  spec: Region[],
  existing?: string,
  migrated?: Map<string, string>,
): MergeResult {
  const specKeys = new Set(spec.filter((r) => r.type === "human").map((r) => r.key));

  let existingHuman = new Map<string, string>();
  let dupConflict: string | undefined;
  if (existing && existing.trim()) {
    const parsed = parseRegions(existing);
    if (!parsed.ok) {
      return {
        content: existing,
        humanKeys: [],
        migratedKeys: [],
        conflict: "unparseable region fences — kept existing entry, refused to rewrite",
      };
    }
    for (const r of parsed.regions) {
      if (r.type !== "human") continue;
      if (existingHuman.has(r.key) && existingHuman.get(r.key) !== r.body) {
        // Duplicate human key (hand-edit / bad paste). Preserve BOTH — the extra
        // under a content-stable key — rather than silently dropping prose.
        existingHuman.set(`${r.key}-dup-${shortHash(r.body)}`, r.body);
        dupConflict = `duplicate human region key "${r.key}" — preserved both bodies`;
      } else {
        existingHuman.set(r.key, r.body);
      }
    }
  }

  const migratedKeysUsed: string[] = [];
  const out: Region[] = spec.map((r) => {
    if (r.type === "gen") return r;
    const fromExisting = existingHuman.get(r.key);
    if (fromExisting !== undefined) return { ...r, body: fromExisting };
    const fromMigrated = migrated?.get(r.key);
    if (fromMigrated !== undefined) {
      migratedKeysUsed.push(r.key);
      return { ...r, body: fromMigrated };
    }
    return r; // rendered stub
  });

  // Preserve any human regions the spec doesn't define: existing extras first,
  // then migrated extras (existing wins on key collision). Appended by key order.
  const appended = new Map<string, string>();
  for (const [key, body] of existingHuman) if (!specKeys.has(key)) appended.set(key, body);
  if (migrated) {
    for (const [key, body] of migrated) {
      if (specKeys.has(key) || appended.has(key)) continue;
      const mk = key.startsWith("migrated-from-") || key.startsWith("orphan-") ? key : `migrated-${key}`;
      appended.set(mk, body);
      migratedKeysUsed.push(mk);
    }
  }
  for (const key of [...appended.keys()].sort(byStr)) {
    out.push({ type: "human", key, body: appended.get(key)! });
  }

  const humanKeys = out.filter((r) => r.type === "human").map((r) => r.key);
  return { content: serializeRegions(out), humanKeys, migratedKeys: migratedKeysUsed, conflict: dupConflict };
}
