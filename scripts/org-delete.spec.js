// Spec for deleting an org from the dashboard (Dan, 2026-09-23: "we have a
// delete tool on the reporting project, but not the dashboard project").
//
// Boots a REAL server on a fixture DATA_DIR and drives the real route, because
// every claim here is about what the route does to the stores on disk.
//
// WHAT THIS PINS:
//  1. It FAILS CLOSED with no ADMIN_PASSWORD (adminAuth falls open; this must not).
//  2. The typed slug is the confirmation, checked on the server.
//  3. A static org (in the ORGS literal) is refused — it would come back on boot.
//  4. Everything held for the org is SNAPSHOT before it is purged, and it is
//     gone from every store it was in — not just from the org list.
//  5. Another org's data is untouched, and the deletion survives a restart.
'use strict';
const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log('  ✓ ' + msg); } else { failed++; console.error('  ✗ ' + msg); } }

const SLUG = 'spec-doomed', KEEP = 'spec-kept';
const PW = 'spec-pw-' + Date.now();
function fixture() {
  const D = fs.mkdtempSync(path.join(os.tmpdir(), 'dashdel-'));
  const w = (f, v) => fs.writeFileSync(path.join(D, f), JSON.stringify(v, null, 2));
  w('dashboard-orgs.json', {
    [SLUG]: { name: 'Doomed Org', orgId: '22222222-2222-2222-2222-222222222222', token: 'doomedToken00001', reports: {}, _dynamic: true },
    [KEEP]: { name: 'Kept Org',   orgId: '33333333-3333-3333-3333-333333333333', token: 'keptToken0000001', reports: {}, _dynamic: true },
  });
  w('dashboards.json', { [SLUG]: { sections: [{ widgets: [1, 2] }] }, [KEEP]: { sections: [] } });
  w('org-emails.json', { [SLUG]: 'doomed@example.com', [KEEP]: 'kept@example.com' });
  w('sms-thresholds.json', { [SLUG]: { smsSegmentLimit: 100 } });
  w('email-subscriptions.json', { [SLUG]: [{ email: 'a@example.com' }], [KEEP]: [{ email: 'b@example.com' }] });
  w('shares.json', { tokA: { orgSlug: SLUG }, tokB: { orgSlug: KEEP } });
  return D;
}
const read = (D, f) => { try { return JSON.parse(fs.readFileSync(path.join(D, f), 'utf8')); } catch { return null; } };

function boot(D, port, pw) {
  const env = { ...process.env, PORT: String(port), DATA_DIR: D, SKIP_PREWARM: '1', REPORTING_BASE_URL: 'http://127.0.0.1:9', SLACK_WEBHOOK_URL: '', RESEND_API_KEY: '' };
  if (pw) env.ADMIN_PASSWORD = pw; else delete env.ADMIN_PASSWORD;
  const srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stdout.on('data', () => {}); srv.stderr.on('data', () => {});
  const call = (method, p, body, auth) => new Promise(r => {
    const data = body == null ? null : JSON.stringify(body);
    const h = {};
    if (auth) h.authorization = 'Basic ' + Buffer.from('admin:' + auth).toString('base64');
    if (data) { h['content-type'] = 'application/json'; h['content-length'] = Buffer.byteLength(data); }
    const rq = http.request({ host: '127.0.0.1', port, path: p, method, headers: h }, res => {
      let b = ''; res.on('data', d => b += d);
      res.on('end', () => { let j = {}; try { j = JSON.parse(b || '{}'); } catch {} r({ status: res.statusCode, json: j }); });
    });
    rq.on('error', () => r({ status: 0, json: {} }));
    if (data) rq.write(data); rq.end();
  });
  const ready = async () => { for (let i = 0; i < 120; i++) { if ((await call('GET', '/health')).status) return; await new Promise(s => setTimeout(s, 400)); } };
  return { srv, call, ready };
}

(async () => {
  const base = 3990 + (process.pid % 40);
  const del = (call, slug, confirm, auth) => call('POST', `/admin/api/orgs/${slug}/delete`, { confirm }, auth);

  // 1. no password configured → refuse, and delete nothing
  {
    const D = fixture(); const s = boot(D, base, null); await s.ready();
    const r = await del(s.call, SLUG, SLUG);
    ok(r.status === 503, `fails CLOSED with no ADMIN_PASSWORD (got ${r.status})`);
    ok(!!(read(D, 'dashboard-orgs.json') || {})[SLUG], 'and the org is still there');
    s.srv.kill();
  }

  const D = fixture(); let s = boot(D, base + 1, PW); await s.ready();

  ok((await del(s.call, SLUG, SLUG)).status === 401, 'refused without the admin password');
  ok((await del(s.call, SLUG, 'spec-doome', PW)).status === 400, 'a mistyped confirmation is refused');
  ok((await del(s.call, 'watertown', 'watertown', PW)).status === 409, 'a static org is refused — it would come back on boot');
  ok((await del(s.call, 'no-such-org', 'no-such-org', PW)).status === 404, 'an unknown org is a 404');

  const orgs0 = await s.call('GET', '/admin/api/orgs', null, PW);
  const row = (orgs0.json.orgs || []).find(o => o.slug === SLUG);
  ok(row && row.dynamic === true, 'the orgs API marks a dynamic org so the page can offer Delete');
  const wt = (orgs0.json.orgs || []).find(o => o.slug === 'watertown');
  ok(wt && wt.dynamic === false, '...and does not offer it for a static one');

  const r = await del(s.call, SLUG, SLUG, PW);
  ok(r.status === 200 && r.json.ok, `the delete succeeds (got ${r.status} ${JSON.stringify(r.json)})`);

  const orgs = read(D, 'dashboard-orgs.json') || {};
  ok(!orgs[SLUG] && !!orgs[KEEP], 'gone from dashboard-orgs.json, the other org kept');
  ok(!(read(D, 'dashboards.json') || {})[SLUG] && !!(read(D, 'dashboards.json') || {})[KEEP], 'dashboard layout purged, other kept');
  const em = read(D, 'org-emails.json') || {};
  ok(!(SLUG in em) && em[KEEP] === 'kept@example.com', 'default email purged, other kept');
  ok(!(read(D, 'sms-thresholds.json') || {})[SLUG], 'sms thresholds purged');
  const subs = read(D, 'email-subscriptions.json') || {};
  ok(!subs[SLUG] && !!subs[KEEP], 'email subscriptions purged, other kept');
  const sh = read(D, 'shares.json') || {};
  ok(!sh.tokA && !!sh.tokB, 'share links purged, other kept');

  const snapDir = path.join(D, 'deleted-orgs');
  const snaps = fs.existsSync(snapDir) ? fs.readdirSync(snapDir) : [];
  const snap = snaps[0] ? JSON.parse(fs.readFileSync(path.join(snapDir, snaps[0]), 'utf8')) : {};
  ok(snaps.length === 1 && snap.org && snap.org.orgId === '22222222-2222-2222-2222-222222222222'
     && snap.dashboard && snap.defaultEmail === 'doomed@example.com' && snap.emailSubs && snap.shares && snap.shares.tokA,
     'a snapshot holds everything that was purged');

  ok((await s.call('GET', `/${SLUG}?token=doomedToken00001`)).status === 404, 'the org dashboard 404s immediately');

  s.srv.kill(); await new Promise(x => setTimeout(x, 400));
  s = boot(D, base + 2, PW); await s.ready();
  const after = await s.call('GET', '/admin/api/orgs', null, PW);
  ok(!(after.json.orgs || []).some(o => o.slug === SLUG), 'still gone after a restart');
  ok((after.json.orgs || []).some(o => o.slug === KEEP), 'the other org still loads after a restart');
  s.srv.kill();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
