// Serialize work that touches one index directory.
//
// `runBuild` and `runEmbed` are not concurrency-safe: two overlapping calls for
// the same index race on the same files. `build` rewrites INDEX.md, the
// per-module entries, graph.json, symbols.json and cache.json — and it does so
// while PRESERVING the prose regions a human wrote, which means it reads the
// existing entry, merges, and writes back. Two of those interleaved lose one
// side's prose. `embed` has the same read-merge-write shape over vectors.json.
//
// The CLI never hit this because one process runs one command to completion.
// The MCP server can have several tool calls in flight at once — an `ask` while
// a `build` is still writing is exactly the case that reads a half-written
// graph.
//
// The fix is a promise chain per index directory — the smallest thing that is
// actually correct. It is deliberately coarse: a `find` blocks a `symbols` on
// the SAME index, while different repos stay fully parallel. Finer locking (a
// read/write split, letting the many read tools overlap) is a follow-up, not a
// v1 requirement: reads are milliseconds once the index exists.
//
// This guards a single process. An MCP server and a CLI invocation writing the
// same index side by side remains a known gap.
const chains = new Map<string, Promise<unknown>>();

export function withIndexLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(dir) ?? Promise.resolve();
  // Chain off `prev` however it settled: a failed predecessor must not poison
  // every later call for the same index.
  const next = prev.then(fn, fn);
  // The tail the NEXT caller waits on never rejects, so one thrown tool call
  // can't reject the whole queue behind it.
  const tail = next.then(noop, noop);
  chains.set(dir, tail);
  // Drop the entry once the tail is still us, so a long-lived server doesn't
  // accumulate a settled promise per index it ever touched.
  tail.then(() => {
    if (chains.get(dir) === tail) chains.delete(dir);
  }, noop);
  return next;
}

function noop(): void {}

// Test seam: drop every pending chain. Never call this from product code — an
// in-flight lock holder would stop serializing against later arrivals.
export function resetIndexLocks(): void {
  chains.clear();
}
