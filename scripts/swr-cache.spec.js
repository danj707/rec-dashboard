// Tests for the stale-while-revalidate cache (../cache.js).
// Run: node scripts/swr-cache.spec.js
const assert = require('assert');
const { cache, getCached, getCacheEntry, setCache, revalidate } = require('../cache');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let passed = 0;
async function test(name, fn) {
  cache.clear();
  await fn();
  console.log(`  ✓ ${name}`);
  passed++;
}

(async () => {
  await test('missing key → getCached null, getCacheEntry null', () => {
    assert.strictEqual(getCached('nope'), null);
    assert.strictEqual(getCacheEntry('nope'), null);
  });

  await test('fresh entry served, not stale', () => {
    setCache('k', [1, 2, 3], 60000);
    assert.deepStrictEqual(getCached('k'), [1, 2, 3]);
    assert.strictEqual(getCacheEntry('k').stale, false);
  });

  await test('getCached evicts on expiry; getCacheEntry does not', async () => {
    setCache('k', ['old'], 5);
    await sleep(20);
    assert.strictEqual(getCached('k'), null);          // strict reader deletes it...
    setCache('k', ['old'], 5);                          // re-seed
    await sleep(20);
    const e = getCacheEntry('k');                       // ...non-evicting reader keeps it
    assert.deepStrictEqual(e.data, ['old']);
    assert.strictEqual(e.stale, true);
  });

  await test('stale-while-revalidate: serve stale now, refresh in background', async () => {
    setCache('k', ['old'], 5);
    await sleep(20);
    const before = getCacheEntry('k');
    assert.deepStrictEqual(before.data, ['old']);       // visitor gets the old value instantly
    assert.strictEqual(before.stale, true);
    await revalidate('k', 60000, async () => ['new']);  // background refresh completes
    assert.deepStrictEqual(getCached('k'), ['new']);    // next request is fresh
    assert.strictEqual(getCacheEntry('k').stale, false);
  });

  await test('single in-flight: concurrent revalidate calls fetch once', async () => {
    setCache('k', ['old'], 5);
    await sleep(20);
    let fetches = 0;
    const slow = async () => { await sleep(15); fetches++; return ['new']; };
    const p1 = revalidate('k', 60000, slow);
    const p2 = revalidate('k', 60000, slow);            // no-op: a refresh is already in flight
    assert.strictEqual(p2, null);
    await p1;
    assert.strictEqual(fetches, 1);
    assert.deepStrictEqual(getCached('k'), ['new']);
  });

  await test('failed refresh keeps the stale value', async () => {
    setCache('k', ['old'], 5);
    await sleep(20);
    await revalidate('k', 60000, async () => { throw new Error('metabase down'); });
    const e = getCacheEntry('k');
    assert.deepStrictEqual(e.data, ['old']);            // stale value retained for next try
    assert.strictEqual(e.stale, true);
  });

  await test('after a failed refresh the key is not locked (can retry)', async () => {
    setCache('k', ['old'], 5);
    await sleep(20);
    await revalidate('k', 60000, async () => { throw new Error('boom'); });
    await revalidate('k', 60000, async () => ['recovered']);
    assert.deepStrictEqual(getCached('k'), ['recovered']);
  });

  console.log(`\n${passed}/${passed} passing`);
})().catch(e => { console.error('✗ FAILED:', e.message); process.exit(1); });
