import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

// Read a file if it exists, else undefined. Never throws.
export function readIfExists(path: string): string | undefined {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : undefined;
  } catch {
    return undefined;
  }
}

// Write atomically (temp-then-rename) and ONLY when the content actually changed,
// so unchanged files keep their mtime and the git diff stays empty. Returns true
// if a write happened.
export function writeFileIfChanged(path: string, content: string): boolean {
  const current = readIfExists(path);
  if (current === content) return false;
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
  return true;
}

// Move a file, creating the destination dir. No-op if the source is missing.
export function moveFile(from: string, to: string): void {
  if (!existsSync(from)) return;
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
}

export function removeFile(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    /* best effort */
  }
}

// List *.md basenames (without extension) directly under a dir. Empty if absent.
export function listEntrySlugs(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((n) => n.endsWith(".md"))
      .map((n) => n.slice(0, -3));
  } catch {
    return [];
  }
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export { join };
