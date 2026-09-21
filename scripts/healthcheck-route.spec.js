#!/usr/bin/env node
/* /health IS RAILWAY'S HEALTHCHECK, so it is load-bearing for every deploy.
 *
 * Until 2026-09-21 this service had no healthcheckPath configured at all, so
 * Railway declared a deploy live the moment the container started — a container
 * that booted into a broken state still took over from the working one and the
 * deploy still reported SUCCESS. Pointing it at /health fixes that, and in
 * exchange makes this one route the thing every deploy passes through.
 *
 * WHICH MEANS THE FAILURE MODE CHANGED SHAPE. Break /health now and the symptom
 * is not "a status endpoint is wrong", it is "deploys have stopped working" —
 * with nothing on screen connecting the two. Three ways it can break, and this
 * spec pins each:
 *
 *  1. SHADOWED BY THE /:org CATCH-ALL. Express matches in registration order,
 *     and `/:org` with org="health" swallows it. authMiddleware then 404s it,
 *     because ORGS['health'] is undefined — so the healthcheck fails on every
 *     deploy from then on. /health sits at ~1274 and the first /:org route at
 *     ~1547, and the only thing keeping that margin is nobody having added a
 *     route in between. This repo's own CI comments record the
 *     registration-order trap four times.
 *
 *  2. GATED BEHIND AUTH. Railway's healthcheck sends no credentials, so any
 *     auth on this route fails it permanently.
 *
 *  3. NOT ANSWERING 200.
 *
 * THE LIVE HALF BOOTS WITH ADMIN_PASSWORD SET, and that is the whole reason it
 * discriminates. adminAuth opens with `if (!ADMIN_PASSWORD) return next()`, so
 * with no password configured it falls OPEN and a 200 on /health proves nothing
 * about whether a gate is wrapped around it. Every PR preview and local boot is
 * that case. A fixture where a wrong implementation cannot look wrong is not a
 * guard.
 *
 * SKIP_SOURCE=1 drops the source half, so the live half can be shown to catch a
 * regression on its own.
 */
const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; }
  else { failed++; console.error(`  ✗ ${name}`); }
}

const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const LINES = SRC.split('\n');

// ── source half: registration order and the absence of a gate ──
if (process.env.SKIP_SOURCE !== '1') {
  // The route itself, matched on its own registration rather than on the string
  // '/health' appearing anywhere — the word is in prose and log lines too.
  const healthIdx = LINES.findIndex(l => /^app\.get\(\s*['"]\/health['"]/.test(l));
  ok(healthIdx >= 0, 'GET /health is registered in server.js');

  // A vacuous-derivation guard: if the pattern above stops matching, every
  // assertion below it compares against -1 and passes on nothing.
  ok(healthIdx > 0, 'the /health registration was located (not a vacuous -1)');

  /* ONLY A ROUTE THAT CAN MATCH A ONE-SEGMENT PATH IS A HAZARD, and getting
     that wrong is how the first draft of this spec passed on the bug. It
     compared /health against the FIRST /:param route of any shape — but
     `app.get('/:org/api/geocode')` needs three segments and can never catch
     `/health`, so the comparison was against a route that is not a threat, and
     a mutation moving /health to sit just above it still read as above-the-
     first-param-route. Found by mutation, not by review.

     The two shapes that DO swallow it:
       app.get('/:org')      — one param segment, matched exactly
       app.use('/:org', ...) — app.use matches on PREFIX, so any depth catches it
  */
  const swallows = LINES
    .map((l, i) => {
      const m = l.match(/^app\.(get|post|put|patch|delete|all|use)\(\s*['"](\/:[^'"]*)['"]/);
      if (!m) return -1;
      const [, verb, routePath] = m;
      if (verb === 'use') return i;                        // prefix match, any depth
      return routePath.split('/').filter(Boolean).length === 1 ? i : -1;
    })
    .filter(i => i >= 0);
  ok(swallows.length > 0,
    'the scan found at least one route that could swallow /health — otherwise the ordering assertion below is vacuous');
  const firstSwallow = swallows.length ? swallows[0] : Infinity;
  ok(healthIdx < firstSwallow,
    `/health (line ${healthIdx + 1}) is registered ABOVE the first route that could swallow it `
    + `(line ${firstSwallow === Infinity ? 'n/a' : firstSwallow + 1}) — below it, ORGS['health'] is undefined, `
    + `authMiddleware 404s, and EVERY DEPLOY FAILS from then on`);

  // No auth middleware on the route's own registration line.
  const healthLine = LINES[healthIdx] || '';
  ok(!/authMiddleware|adminAuth/.test(healthLine),
    '/health carries no auth middleware — Railway sends no credentials');

  // Nor a blanket one mounted above it. app.use with a bare path is fine
  // (express.json, static); app.use with an auth function is not.
  const gateAbove = LINES.slice(0, healthIdx)
    .some(l => /^app\.use\(/.test(l) && /authMiddleware|adminAuth/.test(l));
  ok(!gateAbove, 'no auth middleware is mounted app-wide above /health');

  // The route must answer without touching anything that can throw or block:
  // a healthcheck that reads the volume fails when the volume is the problem.
  ok(!/readFileSync|await |fetch\(/.test(healthLine),
    '/health does no I/O — it must answer from memory');
}

// ── live half: boot a real server WITH a password set and drive the route ──
(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-spec-'));
  const PORT = 3417;
  const child = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dataDir,
      // THE DISCRIMINATING CONDITION. Without it adminAuth falls open and a 200
      // here is satisfied by a build that has the gate.
      ADMIN_PASSWORD: 'spec-password-not-a-real-one',
      // Or the boot fans ~24 orgs out against PRODUCTION Metabase.
      SKIP_PREWARM: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let bootLog = '';
  child.stdout.on('data', d => { bootLog += d; });
  child.stderr.on('data', d => { bootLog += d; });

  const base = `http://127.0.0.1:${PORT}`;
  let up = false;
  for (let i = 0; i < 200; i++) {
    try {
      const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) });
      if (r) { up = true; break; }
    } catch (_) { await new Promise(r => setTimeout(r, 100)); }
  }
  ok(up, 'the server came up (the live half proves nothing otherwise)');

  if (up) {
    // 1. Unauthenticated, 200, with a password configured.
    const r = await fetch(`${base}/health`);
    ok(r.status === 200,
      `GET /health with no credentials answers 200 (got ${r.status}) — a password IS configured on this boot`);

    let body = null;
    try { body = await r.json(); } catch (_) {}
    ok(body && typeof body === 'object', '/health answers a parseable JSON body');
    ok(body && body.status === 'ok', '/health reports status ok');

    // 2. And the admin surface it must NOT resemble really is gated on this
    //    boot — or assertion 1 above is being satisfied by a fall-open.
    const admin = await fetch(`${base}/admin/api/orgs`);
    ok(admin.status === 401,
      `the admin API refuses an uncredentialed call on this same boot (got ${admin.status}) `
      + `— this is what proves /health's 200 is not adminAuth falling open`);

    // 3. The shadowing case, demonstrated rather than argued: an unknown org
    //    404s, which is exactly what /health would return if /:org caught it.
    const unknown = await fetch(`${base}/health-not-an-org`);
    ok(unknown.status === 404,
      'an unknown org path 404s — the shape /health would take if the catch-all swallowed it');
  }

  child.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 300));
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}

  console.log(`${passed} assertions passed${failed ? `, ${failed} FAILED` : ''}.`);
  process.exit(failed ? 1 : 0);
})();
