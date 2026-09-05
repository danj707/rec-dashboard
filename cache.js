// ═══════════════════════════════════════════
//  IN-MEMORY CACHE (+ stale-while-revalidate)
// ═══════════════════════════════════════════
//
// A single process-wide Map of report rows, keyed by org:reportType:params.
//
// getCached()      — strict reader: fresh value or null, evicts on expiry.
// getCacheEntry()  — non-evicting reader that reports staleness.
// revalidate()     — background refresh for a stale key.
//
// getCacheEntry() + revalidate() implement stale-while-revalidate. Some org
// report queries take 30s+ to run live, so once a report has been cached we
// keep serving the last rows instantly even after the TTL lapses and refresh
// in the background. A visitor never waits on a slow live query; only a truly
// cold report (never fetched, or cleared) blocks — and only once.

const cache = new Map();
const DEFAULT_CACHE_TTL = 15 * 60 * 1000; // 15 min

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > entry.ttl) { cache.delete(key); return null; }
  return entry.data;
}

// Like getCached but never deletes and reports whether the entry is past its
// TTL — the basis for stale-while-revalidate (serve the stale value now,
// refresh behind the request).
function getCacheEntry(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  return { data: entry.data, stale: Date.now() - entry.ts > entry.ttl };
}

function setCache(key, data, ttl = DEFAULT_CACHE_TTL) {
  cache.set(key, { data, ts: Date.now(), ttl });
}

// Background refresh for a stale key. De-duplicated: if a refresh is already
// in flight for the key, extra calls JOIN it rather than starting a second one
// (no thundering herd on a slow card). On success the entry is replaced and
// its TTL reset; on failure the stale entry is kept so it can be retried on
// the next request.
//
// IT RETURNS THE IN-FLIGHT PROMISE, INCLUDING WHEN IT DID NOT START THE WORK.
// This used to return `null` in that case, which is fine for a caller that
// fires and forgets — and useless to the one that has to WAIT for the fresh
// rows. A live feed cannot serve a stale answer (see the live-feed branch in
// fetchReportData), so it awaits this; handing it `null` would have made it
// return the stale rows it was trying to avoid, silently, precisely when two
// viewers polled at once. The promise resolves either way: it never rejects,
// because a failed refresh is a kept stale entry, not an error to the caller.
const _revalidating = new Map();
function revalidate(key, ttl, doFetch) {
  const running = _revalidating.get(key);
  if (running) return running;
  const p = Promise.resolve().then(doFetch)
    .then(rows => { setCache(key, rows, ttl); console.log(`[REVALIDATE] ${key} ✓`); })
    .catch(e => console.warn(`[REVALIDATE] ${key} failed, keeping stale: ${e.message}`))
    .finally(() => _revalidating.delete(key));
  _revalidating.set(key, p);
  return p;
}

module.exports = { cache, DEFAULT_CACHE_TTL, getCached, getCacheEntry, setCache, revalidate };
