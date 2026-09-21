// Spec for the INBOUND half of the cross-project org sync.
//
// Add Org here has pushed its new orgs to rental-report since it was built.
// Nothing came back the other way, so an org created over THERE existed in one
// place and Dan added it again by hand. These routes are that missing half.
//
// WHAT THIS PINS:
//
// 1. A TOKEN IS NEVER HANDED TO AN UNAUTHENTICATED CALLER. The mirror of this
//    route on rental-report was leaking one — an org's access token is the only
//    thing in front of every report it has. Existence, slug and orgId stay open:
//    that is what slug-drift repair reads, and none of it is a credential.
// 2. THE WRITE FAILS CLOSED. `adminAuth` above deliberately falls OPEN when no
//    password is set, which is right for a dev root page and very wrong for a
//    route that mints an org with a token of the caller's own choosing. An
//    unset secret must authorise nothing.
// 3. THE orgId IS THE IDENTITY. An org already here under ANOTHER slug is the
//    drift case, not a create — adding it again is exactly the duplicate that
//    made `town-of-shrewsbury`. And a slug we already hold may not be repointed
//    at a different organisation.
// 4. THE OUTBOUND CALLS CARRY THE SECRET. rental-report now withholds the token
//    from an unauthenticated caller, so a reconcile that forgets the header
//    silently stops repairing token drift — and Add Org mints a second token for
//    an org that already has one over there.
// 5. A SYNCED ORG'S REPORTING IDENTITY IS RECORDED. They told us their slug and
//    token; not storing it means every link is wrong until the next 6h reconcile.
//
// SKIP_SOURCE=1 drops the source half. Run: node scripts/org-sync.spec.js
'use strict';
const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) passed++; else { failed++; console.error(`  ✗ ${msg}`); } }
function slice(a, b) {
  const i = src.indexOf(a);
  if (i < 0) { failed++; console.error(`  ✗ server.js should contain ${a}`); return ''; }
  const j = src.indexOf(b, i + a.length);
  return src.slice(i, j > i ? j : undefined);
}

if (!process.env.SKIP_SOURCE) {
  console.log('\n— source —');

  const authFn = slice('function orgSyncAuthOk(req) {', '\n}');
  ok(/if \(!ORG_SYNC_SECRET\) return false;/.test(authFn),
    'an unset secret must authorise nothing — adminAuth falls open, this must not');
  ok(/got\.length === want\.length && crypto\.timingSafeEqual/.test(authFn),
    'timingSafeEqual THROWS on a length mismatch: without the length test a wrong secret is a 500');
  console.log('  ✓ orgSyncAuthOk fails closed and cannot throw on a wrong-length secret');

  const byId = slice("app.get('/api/admin/org-by-id/:orgId'", '\n});');
  ok(/if \(orgSyncAuthOk\(req\)\) out\.token = org\.token; else out\.tokenWithheld = true;/.test(byId),
    'the token must only be attached when authed, and a withheld one must say so');
  console.log('  ✓ the lookup withholds the token from an unauthenticated caller');

  const add = slice("app.post('/api/admin/add-org'", '\n});');
  ok(/if \(!orgSyncAuthOk\(req\)\)/.test(add), 'add-org must be gated');
  ok(/ORG_SYNC_SECRET\s*\n?\s*\?\s*'Bad x-org-sync-secret'/.test(add),
    "the two refusals must be worded apart — 'not configured' is a task, 'bad secret' is an incident");
  ok(/o\.orgId === orgId && s !== slug/.test(add) && /already serves/.test(add),
    'SHREWSBURY: an org already here under another slug must be refused, not duplicated');
  ok(/existing\.orgId && existing\.orgId !== orgId/.test(add),
    'a slug already held may not be repointed at a different organisation');
  // Deliberately NOT asserted here: "the identity is recorded" and "it is
  // persisted" both appear in the UPDATE branch too, so a regex over this slice
  // passes with the CREATE branch's copy deleted. Both are checked live below,
  // where the two branches cannot stand in for each other.
  console.log('  ✓ add-org is gated, refuses duplicates and repoints, and records the identity');

  // Every outbound call must carry the header, or the token comes back withheld.
  const n = (src.match(/orgSyncHeaders\(/g) || []).length;
  ok(n >= 4, `all three outbound call sites must send the secret (orgSyncHeaders seen ${n}x incl. its definition)`);
  ok(!/await fetch\(`\$\{REPORTING_BASE_URL\}\$\{u\}`\);/.test(src),
    'a lookup without the header silently stops repairing token drift');
  ok(/const ORG_SYNC_SECRET = process\.env\.ORG_SYNC_SECRET[\s\S]{0,400}?function reconcileOrgWithReporting/.test(src)
     || src.indexOf('const ORG_SYNC_SECRET') < src.indexOf('async function reconcileOrgWithReporting'),
    'the constant must be declared ABOVE its readers — a const read early is the dead-zone trap');
  console.log('  ✓ every outbound call carries the secret, and the constant is declared above its readers');
}

if (!process.env.SKIP_LIVE) {
  const PORT = 3940 + (process.pid % 50);
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dashsync-'));
  const SECRET = 'spec-secret-' + Date.now();
  const PW = 'spec-pw-' + Date.now();
  const OTHER = '11111111-1111-1111-1111-111111111111';

  fs.writeFileSync(path.join(DATA, 'dashboard-orgs.json'), JSON.stringify({
    'spec-held': { name: 'Spec Held', orgId: OTHER, token: 'heldToken000001',
                   logoUrl: '', reports: {}, _dynamic: true },
  }, null, 2));

  const srv = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    // REPORTING_BASE_URL points at a dead port so the 4s boot reconcile fails
    // harmlessly rather than reaching production.
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, SKIP_PREWARM: '1',
           ADMIN_PASSWORD: PW, ORG_SYNC_SECRET: SECRET,
           REPORTING_BASE_URL: 'http://127.0.0.1:9' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stdout.on('data', () => {}); srv.stderr.on('data', () => {});

  const safe = b => { try { return JSON.parse(b || '{}'); } catch { return {}; } };
  const call = (method, p_, headers, body) => new Promise(r => {
    const data = body == null ? null : JSON.stringify(body);
    const h = { ...(headers || {}) };
    if (data) { h['content-type'] = 'application/json'; h['content-length'] = Buffer.byteLength(data); }
    const rq = http.request({ host: '127.0.0.1', port: PORT, path: p_, method, headers: h }, res => {
      let b = ''; res.on('data', d => b += d);
      res.on('end', () => r({ status: res.statusCode, json: safe(b) }));
    });
    rq.on('error', e => r({ status: 0, json: {}, err: String(e) }));
    if (data) rq.write(data); rq.end();
  });
  const withSecret = { 'x-org-sync-secret': SECRET };
  const withPw = { authorization: 'Basic ' + Buffer.from('admin:' + PW).toString('base64') };

  (async () => {
    for (let i = 0; i < 120; i++) { if ((await call('GET', '/health')).status) break; await new Promise(s => setTimeout(s, 400)); }
    console.log('\n— live —');

    const anon = await call('GET', `/api/admin/org-by-id/${OTHER}`);
    ok(anon.json.exists === true, 'the lookup still answers an unauthenticated caller');
    ok(anon.json.token === undefined,
      `THE LEAK: the lookup handed a token to an unauthenticated caller (${anon.json.token})`);
    ok(anon.json.tokenWithheld === true, 'a withheld token must say so');
    const authed = await call('GET', `/api/admin/org-by-id/${OTHER}`, withSecret);
    ok(authed.json.token === 'heldToken000001', 'the secret must unlock the token');
    console.log('  ✓ the lookup withholds the token unless authenticated');

    const NEW = '22222222-2222-2222-2222-222222222222';
    const refused = await call('POST', '/api/admin/add-org', {}, { slug: 'spec-intruder', token: 'x0000000000000y', orgId: NEW });
    ok(refused.status === 401, `an unauthenticated write must be refused (got ${refused.status})`);
    ok((await call('GET', `/api/admin/org-by-id/${NEW}`)).json.exists === false,
      'the refused org must not exist');
    console.log('  ✓ add-org refuses an unauthenticated write, and writes nothing');

    const made = await call('POST', '/api/admin/add-org', withSecret,
      { slug: 'spec-made', token: 'madeToken000001', orgId: NEW, displayName: 'Spec Made' });
    ok(made.status === 200 && made.json.action === 'created', 'the secret must create');
    const back = await call('GET', `/api/admin/org-by-id/${NEW}`, withSecret);
    ok(back.json.exists === true && back.json.slug === 'spec-made', 'and the org must be there');
    ok(back.json.token === 'madeToken000001',
      'THEIR token, not a new one — a second token here means every report link is refused');
    console.log('  ✓ a synced org is created, carrying the token the reporting project sent');

    // SHREWSBURY, from this side.
    const dupe = await call('POST', '/api/admin/add-org', withSecret,
      { slug: 'their-name-for-it', token: 'heldToken000001', orgId: OTHER });
    ok(dupe.status === 409, `an org already here under another slug must be refused (got ${dupe.status})`);
    ok(dupe.json.slug === 'spec-held', 'and the refusal must say what we DO call it');
    console.log('  ✓ an org already here under another slug is refused, not duplicated');

    const repoint = await call('POST', '/api/admin/add-org', withSecret,
      { slug: 'spec-held', token: 'heldToken000001', orgId: '33333333-3333-3333-3333-333333333333' });
    ok(repoint.status === 409, `repointing a held slug must be refused (got ${repoint.status})`);
    console.log('  ✓ a held slug cannot be repointed at a different organisation');

    // The two things a source regex could not tell apart from the update
    // branch's identical lines.
    const ident = await call('GET', '/admin/api/reporting-identity', withPw);
    const row = ((ident.json || {}).orgs || []).find(o => o.slug === 'spec-made');
    ok(row && row.reportingSlug === 'spec-made' && row.state === 'ok',
      `they told us their slug and token — not recording it leaves every link wrong for 6h (got ${JSON.stringify(row)})`);
    const onDisk = safe(fs.readFileSync(path.join(DATA, 'dashboard-orgs.json'), 'utf8'));
    ok(!!onDisk['spec-made'],
      'a created org must be persisted, or it vanishes on the next restart');
    console.log('  ✓ a synced org records its reporting identity and survives a restart');

    const byHand = await call('POST', '/api/admin/add-org', withPw,
      { slug: 'spec-byhand', token: 'handToken000001', orgId: '44444444-4444-4444-4444-444444444444' });
    ok(byHand.status === 200, 'the admin password must work, or a by-hand repair is impossible');
    console.log('  ✓ the admin password is accepted too');

    const PORT2 = PORT + 1;
    const DATA2 = fs.mkdtempSync(path.join(os.tmpdir(), 'dashsync2-'));
    const srv2 = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT2), DATA_DIR: DATA2, SKIP_PREWARM: '1',
             ADMIN_PASSWORD: PW, ORG_SYNC_SECRET: '',
             REPORTING_BASE_URL: 'http://127.0.0.1:9' },
      stdio: ['ignore', 'pipe', 'pipe'] });
    srv2.stdout.on('data', () => {}); srv2.stderr.on('data', () => {});
    const call2 = (method, p_, headers, body) => new Promise(r => {
      const data = body == null ? null : JSON.stringify(body);
      const h = { ...(headers || {}) };
      if (data) { h['content-type'] = 'application/json'; h['content-length'] = Buffer.byteLength(data); }
      const rq = http.request({ host: '127.0.0.1', port: PORT2, path: p_, method, headers: h }, res => {
        let b = ''; res.on('data', d => b += d);
        res.on('end', () => r({ status: res.statusCode, json: safe(b) }));
      });
      rq.on('error', () => r({ status: 0, json: {} }));
      if (data) rq.write(data); rq.end();
    });
    for (let i = 0; i < 120; i++) { if ((await call2('GET', '/health')).status) break; await new Promise(x => setTimeout(x, 400)); }
    const fell = await call2('POST', '/api/admin/add-org', { 'x-org-sync-secret': 'anything' },
      { slug: 'spec-open', token: 'x0000000000000y', orgId: '55555555-5555-5555-5555-555555555555' });
    ok(fell.status === 401,
      `with no ORG_SYNC_SECRET set the route must FAIL CLOSED — adminAuth falls open, this must not (got ${fell.status})`);
    ok(/ORG_SYNC_SECRET/.test((fell.json || {}).error || ''),
      'the refusal must name the variable to set');
    console.log('  ✓ an unconfigured deploy fails closed');
    srv2.kill();
    fs.rmSync(DATA2, { recursive: true, force: true });

    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    done();
  })().catch(e => { failed++; console.error('  ✗ live half threw:', e.message); srv.kill(); done(); });
} else { done(); }

function done() {
  console.log(`\n${passed} assertions passed${failed ? `, ${failed} FAILED` : ''}.`);
  process.exit(failed ? 1 : 0);
}
