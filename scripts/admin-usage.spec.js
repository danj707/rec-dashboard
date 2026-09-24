// Spec for the admin page's usage metrics (Dan, 2026-09-24: "we're missing
// ... metrics or stats around usage. how often are the orgs using this,
// clicking into cards, etc. It's missing the sparklines and metrics I need to
// make informed decisions.")
//
// WHAT THIS PINS:
//  1. lib/usage.js arithmetic, RUN over fixtures: views per day land on the
//     right day, the prior window is separate, active days are days not events.
//  2. Our own visits (via=admin, from the admin page's Open Dashboard link)
//     are counted APART, never as adoption.
//  3. Server bookkeeping (org_deleted, digest_sent) is not usage.
//  4. A log shorter than the window says so (coverageDays), not zeros.
//  5. The click-through classifier records WHERE, never the URL — a report
//     link carries the org's token.
//  6. Live: /admin/api/usage is behind the admin password and answers from
//     the real events.jsonl.
'use strict';
const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const { buildUsage } = require('../lib/usage');

let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log('  ✓ ' + msg); } else { failed++; console.error('  ✗ ' + msg); } }

const NOW = Date.parse('2026-09-24T15:00:00Z');
const at = (daysAgo, h = 12) => new Date(Date.parse('2026-09-24T00:00:00Z') - daysAgo * 86400000 + h * 3600000).toISOString();
const ev = (org, event, daysAgo, extra) => Object.assign({ org, event, ts: at(daysAgo) }, extra || {});

console.log('\nusage arithmetic');
const events = [
  ev('alpha', 'dashboard_view', 0), ev('alpha', 'dashboard_view', 0), ev('alpha', 'dashboard_view', 3),
  ev('alpha', 'report_link_clicked', 3, { target: 'programs' }), ev('alpha', 'report_link_clicked', 5, { target: 'programs' }),
  ev('alpha', 'rec_link_clicked', 5, { target: 'facilities/balance-due' }),
  ev('alpha', 'insight_requested', 10),
  ev('alpha', 'dashboard_view', 40), ev('alpha', 'dashboard_view', 45),          // prior window
  ev('alpha', 'dashboard_view', 1, { via: 'admin' }), ev('alpha', 'dashboard_view', 1, { via: 'admin' }), // us
  ev('beta', 'dashboard_view', 20),
  ev('gamma', 'org_deleted', 2), ev('gamma', 'digest_sent', 2),                   // bookkeeping
  ev('alpha', 'dashboard_view', 70),                                              // outside both windows
];
const u = buildUsage(events, { now: NOW, days: 30, orgs: ['alpha', 'beta', 'gamma', 'delta'] });
const A = u.orgs.alpha;
ok(A.views === 3, 'alpha: 3 views in the window (got ' + A.views + ')');
ok(A.daily.length === 30 && A.daily[29] === 2 && A.daily[26] === 1, 'views land on their own day, today last');
ok(A.viewsPrior === 2, 'the prior 30 days are counted separately (got ' + A.viewsPrior + ')');
ok(A.activeDays === 4, 'active days are distinct DAYS, not events (got ' + A.activeDays + ')');
ok(A.clicks === 3 && A.topTargets[0].target === 'programs' && A.topTargets[0].count === 2, 'click-throughs and their top target');
ok(A.adminEvents === 2, 'our own visits are counted apart (got ' + A.adminEvents + ')');
ok(!A.features.dashboard_view || A.features.dashboard_view === 3, '...and never folded into the views');
ok(A.lastSeen && A.lastSeen.startsWith('2026-09-24'), 'last seen ignores our own later-looking visits');
ok(u.orgs.gamma.views === 0 && u.orgs.gamma.lastSeen === null, 'org_deleted / digest_sent are not usage');
ok(u.orgs.delta && u.orgs.delta.views === 0 && u.orgs.delta.daily.every(x => x === 0), 'an org with no events still gets a row of zeros');
ok(u.platform.active7 === 1 && u.platform.active30 === 2, 'active orgs 7d / 30d (got ' + u.platform.active7 + '/' + u.platform.active30 + ')');
ok(u.platform.views === 4 && u.platform.adminEvents === 2, 'platform totals exclude our visits');
const ad = Object.fromEntries(u.adoption.map(a => [a.event, a]));
ok(ad.report_link_clicked.orgs === 1 && ad.report_link_clicked.count === 2, 'adoption counts orgs AND uses');
ok(u.coverageDays === 30, 'a log older than the window covers the whole window');
const short = buildUsage([ev('alpha', 'dashboard_view', 4)], { now: NOW, days: 30, orgs: ['alpha'] });
ok(short.coverageDays === 5, 'a log starting 4 days ago covers 5 days, not 30 (got ' + short.coverageDays + ')');
ok(buildUsage([], { now: NOW, orgs: ['a'] }).coverageDays === 0, 'an empty log covers nothing');
const gone = buildUsage([ev('deleted-org', 'dashboard_view', 1), ev('alpha', 'dashboard_view', 1)], { now: NOW, orgs: ['alpha'] });
ok(!gone.orgs['deleted-org'] && gone.platform.active30 === 1 && gone.platform.unknownOrgEvents === 1, 'an org no longer configured is not counted as active');

console.log('\nclick-through classifier (lifted from dashboard.html)');
const html = fs.readFileSync(path.join(ROOT, 'public/dashboard.html'), 'utf8');
const i0 = html.indexOf('var UUID_RE ='), i1 = html.indexOf('function trackOutbound(');
ok(i0 > 0 && i1 > i0, 'the classifier is where this expects it');
const window = { _orgMeta: { reportingBaseUrl: 'https://rental-report-production-a046.up.railway.app' } };
const location = { href: 'https://dash.example/watertown' };
const outboundTarget = new Function('window', 'location', html.slice(i0, i1) + '; return outboundTarget;')(window, location);
const r1 = outboundTarget('https://rental-report-production-a046.up.railway.app/watertown/programs?token=SECRET123&tab=revenue');
ok(r1 && r1.event === 'report_link_clicked' && r1.target === 'programs', 'a report link records the report type');
ok(!JSON.stringify(r1).includes('SECRET123'), '...and never the token');
const r2 = outboundTarget('https://www.rec.us/admin/o/8ae77057-6bce-4c20-b0f2-366ed5fa14dd/facilities/balance-due');
ok(r2 && r2.event === 'rec_link_clicked' && r2.target === 'facilities/balance-due', 'a Rec link records the page, not the org uuid');
ok(outboundTarget('https://example.com/x') === null, 'an unrelated link is not a click-through');
ok(/data-section=\{sectionId\}/.test(html), 'sections carry data-section so a click names its section');
ok(/openTracked\(href/.test(html) && !/window\.open\(href, '_blank'\)/.test(html.replace(/function openTracked[^\n]*/, '')), 'window.open click-throughs go through openTracked');
ok(/via.*admin/.test(fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8').match(/class="org-link"[^>]*|href="[^"]*via=admin[^"]*"/)[0] || ''), 'the admin Open Dashboard link is tagged via=admin');

async function live() {
  console.log('\nlive route');
  const D = fs.mkdtempSync(path.join(os.tmpdir(), 'dashusage-'));
  fs.writeFileSync(path.join(D, 'events.jsonl'), [
    { org: 'watertown', event: 'dashboard_view', ts: new Date().toISOString() },
    { org: 'watertown', event: 'dashboard_view', ts: new Date().toISOString(), via: 'admin' },
  ].map(x => JSON.stringify(x)).join('\n') + '\n');
  const PW = 'spec-pw-' + Date.now(), port = 3900 + Math.floor(Math.random() * 90);
  const env = { ...process.env, PORT: String(port), DATA_DIR: D, SKIP_PREWARM: '1', ADMIN_PASSWORD: PW, REPORTING_BASE_URL: 'http://127.0.0.1:9', SLACK_WEBHOOK_URL: '', RESEND_API_KEY: '' };
  const srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'ignore', 'ignore'] });
  const get = (p, auth) => new Promise(r => {
    const h = auth ? { authorization: 'Basic ' + Buffer.from('admin:' + auth).toString('base64') } : {};
    http.get({ host: '127.0.0.1', port, path: p, headers: h }, res => { let b = ''; res.on('data', d => b += d); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} r({ status: res.statusCode, json: j }); }); }).on('error', () => r({ status: 0 }));
  });
  try {
    for (let i = 0; i < 120 && !(await get('/health')).status; i++) await new Promise(s => setTimeout(s, 400));
    ok((await get('/admin/api/usage')).status === 401, 'no password → 401');
    const r = await get('/admin/api/usage', PW);
    ok(r.status === 200 && r.json && r.json.orgs, 'with the password → 200 and a usage body');
    const w = r.json && r.json.orgs && r.json.orgs.watertown;
    ok(w && w.views === 1 && w.adminEvents === 1, 'reads the real log, our visit counted apart');
    ok(r.json && r.json.orgs && Object.keys(r.json.orgs).length > 1, 'every configured org gets a row');
  } finally { srv.kill(); }
}

live().then(() => {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
});
