import { join } from "node:path";
import type { Region } from "./merge.js";
import { mergeEntry, humanBodies } from "./merge.js";
import { readIfExists, writeFileIfChanged, moveFile, removeFile } from "./output.js";
import { byStr } from "./sort.js";

export interface EntryInput {
  slug: string;
  members: string[]; // current member file rels (for rename detection)
  spec: Region[]; // freshly rendered region spec
}

export interface PrevModule {
  members: string[];
}

export interface SyncResult {
  orphaned: string[]; // old module slugs whose prose was moved to _orphaned/
  notes: string[]; // merge conflicts and migration notes
  humanKeys: Record<string, string[]>; // slug -> human region keys in the written entry
}

const MIGRATE_THRESHOLD = 0.5;

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Write every current module's encyclopedia entry, preserving human prose and
// migrating it across renames; orphaned prose (a module that truly disappeared)
// is moved aside, never deleted. Returns bookkeeping for the manifest + check.
export function syncEntries(
  outDir: string,
  entries: EntryInput[],
  prevModules: Record<string, PrevModule>,
): SyncResult {
  const encDir = join(outDir, "encyclopedia");
  const orphanDir = join(encDir, "_orphaned");
  const entryPath = (slug: string): string => join(encDir, `${slug}.md`);

  const currentSlugs = new Set(entries.map((e) => e.slug));
  const consumed = new Set<string>(); // old slugs whose prose migrated into a current entry
  const notes: string[] = [];
  const humanKeys: Record<string, string[]> = {};

  // Candidate predecessors: old modules that no longer exist as current slugs.
  const goneOld = Object.keys(prevModules).filter((s) => !currentSlugs.has(s));

  for (const e of entries.slice().sort((a, b) => byStr(a.slug, b.slug))) {
    const path = entryPath(e.slug);
    const existing = readIfExists(path);

    // If this is a brand-new slug, see if it is the rename successor of a gone
    // module (best member-overlap above threshold) and migrate that prose.
    let migrated: Map<string, string> | undefined;
    if (!existing) {
      let best: { slug: string; score: number } | null = null;
      for (const old of goneOld) {
        if (consumed.has(old)) continue;
        const score = jaccard(prevModules[old]!.members, e.members);
        if (score >= MIGRATE_THRESHOLD && (!best || score > best.score)) best = { slug: old, score };
      }
      if (best) {
        const oldText = readIfExists(entryPath(best.slug));
        if (oldText) {
          migrated = humanBodies(oldText);
          consumed.add(best.slug);
          notes.push(`migrated prose from "${best.slug}" → "${e.slug}" (member overlap ${best.score.toFixed(2)})`);
        }
      }
    }

    const merged = mergeEntry(e.spec, existing, migrated);
    if (merged.conflict) notes.push(`${e.slug}: ${merged.conflict}`);
    writeFileIfChanged(path, merged.content);
    humanKeys[e.slug] = merged.humanKeys;
  }

  // Old modules that disappeared: consumed ones had their prose migrated (delete
  // the stale file); the rest are moved to _orphaned/ so prose is never lost.
  const orphaned: string[] = [];
  for (const old of goneOld) {
    const path = entryPath(old);
    if (consumed.has(old)) {
      removeFile(path);
      continue;
    }
    const text = readIfExists(path);
    if (text === undefined) continue;
    const human = humanBodies(text);
    const hasProse = [...human.values()].some((b) => b.trim().length > 0);
    if (hasProse) {
      moveFile(path, join(orphanDir, `${old}.md`));
      orphaned.push(old);
      notes.push(`orphaned prose for removed module "${old}" → encyclopedia/_orphaned/${old}.md`);
    } else {
      removeFile(path); // empty stub, nothing to preserve
    }
  }

  orphaned.sort(byStr);
  return { orphaned, notes, humanKeys };
}
