// membership-book.spec.js — the Memberships section's auto-renew widgets.
//
// Dan: "we need a new 'Memberships' section on the rec-dashboard project. With
// according metrics based off the memberships reports."
//
// The section already existed; what it did not have was anything the
// memberships REPORT learned. Card 17301 is SHARED between this dashboard and
// rental-report (f4496307-…), so every column the report gained in v2-v4 has
// been arriving here all along and being thrown away.
//
// THE THREE RULES THIS SPEC EXISTS TO PIN, each one a bug that actually shipped
// on the report side before it was fixed there:
//
//   1. A PASS IS NOT A MEMBERSHIP, and it is not a membership that merely is
//      not auto-renewing either — `pass` has no subscription column in the
//      schema at all. Norman's feed is 20,341 rows of which 16,940 are passes,
//      4,518 of those being $5 gate admissions. Counting them inflates every
//      membership figure on the section.
//   2. A BILLING CYCLE IS A PROPERTY OF THE PLAN, NOT OF ONE ROW. Dividing by
//      each row's own (Next Renewal - Period Start) reads the time REMAINING in
//      the period on a membership about to renew. At Apex 8 rows had a gap
//      under a day, the smallest 15 minutes, and one derived 44,665 renewals.
//   3. PRESENCE, NOT COUNT. Feeds cache 4 hours, so a pre-v3 response is live
//      alongside a current one. A tile that renders 0 there says "this org has
//      no auto-renew"; the truth is "this feed cannot tell us".
//
// Everything is LIFTED AND RUN rather than regexed. A regex over our own patch
// is not evidence the page computes anything.
//
// Run: node scripts/membership-book.spec.js

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const PAGE = path.join(__dirname, '..', 'public', 'dashboard.html');
const src = fs.readFileSync(PAGE, 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

let n = 0;
const ok = (c, w) => { n++; assert.ok(c, w); };
const is = (a, b, w) => { n++; assert.strictEqual(a, b, w); };
const near = (a, b, tol, w) => { n++; assert.ok(Math.abs(a - b) <= tol, w + ' (got ' + a + ', wanted ~' + b + ')'); };

// ── Lift the helper block and RUN it ────────────────────────────────────────
const NAMES = ['mbHasColumn','mbHasProductKind','mbHasAutoRenew','mbHasCancelSchedule','mbHasPeriod',
               'mbIsPass','mbIsActive','mbIsCanceled','mbCancelPending','mbIsAutoRenew','mbPlanKey',
               'mbRowGapDays','mbPlanCycles','mbCadence','mbRenewalsSoFar','mbChurnPerCycle',
               'mbMonthlyValue','mbPrice','mbBook'];
const block = /function mbCol\(r, name\)[\s\S]*?\nfunction mbBook\(rows\) \{[\s\S]*?\n\}/.exec(src);
assert.ok(block, 'could not lift the membership book helpers');
const H = vm.runInThisContext(
  '(function(){ function pf(v){ const x = parseFloat(String(v == null ? 0 : v).replace(/[^0-9.-]/g, "")); return isNaN(x) ? 0 : x; }\n'
  + block[0] + '\nreturn {' + NAMES.join(',') + '};})()');

// ── Lift a widget transform and RUN it ──────────────────────────────────────
function transformOf(id) {
  const i = src.indexOf("'" + id + "': {");
  assert.ok(i > 0, 'widget ' + id + ' should exist in the W registry');
  const t = src.indexOf('transform: rows =>', i);
  assert.ok(t > i, id + ' should have a transform');
  let depth = 0, end = -1;
  for (let j = t; j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth < 0) { end = j; break; } }
  }
  assert.ok(end > t, 'could not find the end of ' + id + "'s transform");
  const body = src.slice(t + 'transform: '.length, end).trim().replace(/,$/, '');
  const ctx = { pf: (v) => { const x = parseFloat(String(v == null ? 0 : v).replace(/[^0-9.-]/g, '')); return isNaN(x) ? 0 : x; } };
  NAMES.forEach(k => { ctx[k] = H[k]; });
  ctx.mbCadence = H.mbCadence;
  return vm.runInNewContext('(' + body + ')', ctx);
}

// ── The fixture, built to discriminate rather than to flatter ───────────────
// Every row is a case. In particular the PASSES OUTNUMBER THE MEMBERSHIPS, the
// way they do at Norman — a fixture where they are a minority lets a dropped
// pass gate pass unnoticed.
const D = (d) => d;                       // dates are plain YYYY-MM-DD strings
function row(o) {
  return Object.assign({
    'Status': 'active', 'Product Kind': 'membership', 'Group / Plan': 'Monthly Individual',
    'Membership Type': 'Individual', 'Net Collected': '20', 'Auto Renew': false,
    'Renewal Type': 'one-time', 'Start Date': null, 'Period Start': null,
    'Next Renewal': null, 'Canceled At': null, 'Cancel Scheduled At': null,
  }, o);
}

const ROWS = [
  // Four healthy monthly auto-renewers. Started 2026-01-01, current period
  // opened 2026-07-01 — six whole 31-day-ish cycles.
  ...[0,1,2,3].map(i => row({ 'Auto Renew': true, 'Renewal Type': 'auto',
    'Start Date': D('2026-01-01'), 'Period Start': D('2026-07-01'), 'Next Renewal': D('2026-08-01') })),
  // Two on the SAME plan whose renewal is imminent — a 15-minute and a 2-hour
  // gap. These are rule (2): each row's own gap is the time REMAINING, and a
  // per-row cycle would derive tens of thousands of renewals from them.
  row({ 'Auto Renew': true, 'Start Date': D('2026-01-01'), 'Period Start': D('2026-07-01'),
        'Next Renewal': '2026-07-01T00:15:00Z' }),
  row({ 'Auto Renew': true, 'Start Date': D('2026-01-01'), 'Period Start': D('2026-07-01'),
        'Next Renewal': '2026-07-01T02:00:00Z' }),
  // A WEEKLY plan, so the book mixes cadences — a single "per month" label on
  // the book-level rate would be false for part of it.
  ...[0,1].map(() => row({ 'Auto Renew': true, 'Group / Plan': 'Weekly Childcare', 'Net Collected': '35',
    'Start Date': D('2026-06-01'), 'Period Start': D('2026-07-27'), 'Next Renewal': D('2026-08-03') })),
  // One cancelled auto-renewer: it contributes a cancellation, and NULL
  // renewals rather than a zero that would punish the plan that billed it longest.
  // Renewal Type is set here too, so this row survives into the PRE_V3 book via
  // the inferred fallback. Without that the pre-v3 book holds no cancellation
  // at all and the churn presence gate cannot be shown to matter — verified by
  // mutation, which is the only way that gap shows up.
  row({ 'Auto Renew': true, 'Renewal Type': 'auto', 'Status': 'canceled', 'Canceled At': D('2026-07-15'),
        'Start Date': D('2026-01-01'), 'Period Start': D('2026-07-01'), 'Next Renewal': null }),
  // One scheduled to leave at period end: still live, still billing.
  row({ 'Auto Renew': true, 'Cancel Scheduled At': D('2026-08-01'),
        'Start Date': D('2026-05-01'), 'Period Start': D('2026-07-01'), 'Next Renewal': D('2026-08-01') }),
  // A season membership nobody auto-renews — out of the book by the on>0 rule.
  row({ 'Group / Plan': '2026 Season Pass', 'Net Collected': '224' }),
  // TWELVE $5 gate admissions. The majority of the feed, exactly like Norman.
  ...Array.from({length: 12}, () => row({ 'Product Kind': 'pass', 'Group / Plan': 'League Tournament Gate Adult',
    'Net Collected': '5' })),
];

// A pre-v3 feed: the same book with none of the columns v2-v4 added. Note it
// still carries Renewal Type, which is what the pre-v2 fallback reads.
const PRE_V3 = ROWS.map(r => {
  const c = Object.assign({}, r);
  delete c['Product Kind']; delete c['Auto Renew']; delete c['Period Start'];
  delete c['Next Renewal']; delete c['Cancel Scheduled At'];
  return c;
});

// ── 1. The helpers ─────────────────────────────────────────────────────────
is(H.mbIsPass(row({ 'Product Kind': 'pass' })), true, 'a pass is a pass');
is(H.mbIsPass(row({})), false, 'a membership is not');
is(H.mbIsPass(PRE_V3[0]), false,
   'a feed with no Product Kind must not call everything a pass — that would empty the section');

is(H.mbIsAutoRenew(row({ 'Auto Renew': true })), true, 'the explicit column is the truth');
is(H.mbIsAutoRenew(row({ 'Auto Renew': 'true' })), true, '…however the JSON encodes it');
is(H.mbIsAutoRenew(row({ 'Auto Renew': false, 'Renewal Type': 'auto-renew' })), false,
   'AN EXPLICIT false BEATS THE INFERRED COLUMN. Renewal Type infers auto-renew from '
   + 'next_renewal_at and is a different test; letting it win would re-report the old wrong answer');
is(H.mbIsAutoRenew({ 'Renewal Type': 'auto-renew' }), true,
   'THE CACHE INVARIANT: with no Auto Renew column at all the inferred one still answers, so a '
   + 'warm 4-hour entry does not read as nobody auto-renewing');

is(H.mbIsCanceled(row({ 'Canceled At': D('2026-07-15'), 'Status': 'active' })), true,
   'the DATE decides, not the status word');
is(H.mbCancelPending(row({ 'Cancel Scheduled At': D('2026-08-01') })), true,
   'scheduled to cancel is a live, still-billing membership');
is(H.mbCancelPending(row({ 'Cancel Scheduled At': D('2026-08-01'), 'Canceled At': D('2026-07-01') })), false,
   'SCHEDULED IS NOT CANCELLED, and the guard is what stops the two being added together the '
   + 'moment one becomes the other');

// Rule (2), pinned. The bad rows are the MAJORITY on their plan here: nine good
// rows against one bad passes with the sub-day filter deleted, because a median
// over nine good values ignores the tenth.
{
  const plan = [
    row({ 'Period Start': D('2026-07-01'), 'Next Renewal': '2026-07-01T00:15:00Z' }),
    row({ 'Period Start': D('2026-07-01'), 'Next Renewal': '2026-07-01T00:20:00Z' }),
    row({ 'Period Start': D('2026-07-01'), 'Next Renewal': '2026-07-01T02:00:00Z' }),
    row({ 'Period Start': D('2026-07-01'), 'Next Renewal': D('2026-08-01') }),
    row({ 'Period Start': D('2026-07-01'), 'Next Renewal': D('2026-08-01') }),
  ];
  const c = H.mbPlanCycles(plan)['Monthly Individual'];
  is(c, 31, 'THE 44,665-RENEWAL BUG, pinned: three of five rows have a sub-day gap and the plan '
     + 'cycle is still 31 days, because sub-day gaps get no vote at all');
  const worst = H.mbRenewalsSoFar(row({ 'Start Date': D('2022-01-01'), 'Period Start': D('2026-07-01') }), c);
  ok(worst != null && worst < 600, 'and the worst row derives a plausible number rather than 44,665');
}
is(H.mbRenewalsSoFar(row({ 'Start Date': D('2026-01-01'), 'Period Start': D('2026-07-01') }), 0.01), null,
   'an implausible answer is NULL, not a confident number — if the dates are wrong a dash is honest');
is(H.mbRenewalsSoFar(row({ 'Start Date': D('2026-01-01'), 'Period Start': D('2026-07-01') }), null), null,
   'and an unknown cycle yields null rather than defaulting to 30 days');

is(H.mbChurnPerCycle(0, 0), null, 'no opportunities is unknown, not 0%');
near(H.mbChurnPerCycle(18, 2), 0.1, 1e-9,
     'churn is cancellations over RENEWAL OPPORTUNITIES — 2 of 20, not 2 of the 2 who left');
is(H.mbCadence(7), 'per week', 'a weekly plan says so');
is(H.mbCadence(31), 'per month', 'and a monthly one says so — the two are different units');
near(H.mbMonthlyValue(35, 7), 152.2, 0.1,
     'A WEEKLY PLAN IS WORTH MORE PER MONTH THAN ITS CHARGE. Reading $35 as monthly understates it ~4x');
is(H.mbMonthlyValue(20, null), null, 'and an unknown cycle is null, never the raw charge');

// ── 2. Active Members excludes passes, and says how many ────────────────────
{
  const t = transformOf('mem-active');
  const cur = t(ROWS);
  is(cur.value, 10, 'A PASS IS NOT A MEMBER: 22 active rows, 12 of them gate admissions, so 10 members');
  ok(/12 active passes excluded/.test(cur.sub || ''),
     'EXCLUDED IS NOT HIDDEN — the count that left is named, or a number that dropped by two thirds '
     + 'has no explanation on screen');
  const old = t(PRE_V3);
  is(old.value, 22, 'and on a pre-v3 feed the tile keeps the number it has always shown rather than '
     + 'silently changing its meaning when a cache entry expires');
  ok(/not separable/.test(old.sub || ''), '…saying why it cannot separate them');
}

// ── 3. The auto-renew book ─────────────────────────────────────────────────
{
  const t = transformOf('mem-autorenew');
  is(t(ROWS).value, 10, 'the book is who is ACTUALLY on auto-renew — 10 rows, and that one rule '
     + 'takes out the season plan, the passes and everything else without three special cases');
  ok(/2 plans/.test(t(ROWS).sub || ''), 'across the two plans that hold it');
}
{
  const t = transformOf('mem-passes');
  is(t(ROWS).value, 12, 'passes are counted in their own right, not merged away');
  is(t(PRE_V3).value, null, 'PRESENCE, NOT COUNT: a feed without Product Kind renders a dash, '
     + 'because 0 would say this org sells no passes');
}
{
  const t = transformOf('mem-mrr');
  const cur = t(ROWS);
  // 8 monthly-plan auto-renewers at $20 on a 31-day cycle + 2 weekly at $35 on 7.
  near(cur.value, 8 * 20 * (30.44/31) + 2 * 35 * (30.44/7), 1,
       'monthly recurring converts each charge by its OWN plan cycle — the weekly pair is worth '
       + '4x its charge and a flat read would understate the book');
  is(t(PRE_V3).value, null, 'and with no period columns it is a dash, not $0');
}
{
  const t = transformOf('mem-churn');
  const cur = t(ROWS);
  ok(cur.value != null && cur.value > 0,
     'CHURN IS NOT STRUCTURALLY ZERO. The fixture holds a cancelled auto-renewer; a rate taken '
     + 'from an active-only view can never see one and reads 0.0% for every org forever');
  ok(cur.value < 20, 'and it is a per-renewal hazard rate, not the lifetime share who ever cancelled '
     + '(1 of 10 members would be 10% as a lifetime figure and is far lower per renewal)');
  ok(!/per (month|week|year)/.test(cur.sub || ''),
     'THE BOOK-LEVEL RATE CARRIES NO PERIOD LABEL: this book mixes weekly and monthly plans, so '
     + '"per month" would be false for part of it');
  is(t(PRE_V3).value, null, 'and it is a dash on a feed that cannot derive renewals');
}
{
  const t = transformOf('mem-leaving');
  is(t(ROWS).value, 1, 'one membership is scheduled to leave at period end');
  is(t(PRE_V3).value, null, 'PRESENCE, NOT COUNT, again — 0 here would read as nobody leaving');
}

// ── 4. The per-plan table ──────────────────────────────────────────────────
{
  const t = transformOf('tbl-mem-autorenew');
  const out = t(ROWS);
  // The shape is part of the contract: TableWidget reads { columns, data } and a
  // { headers, rows } shape unmounts the whole dashboard rather than this tile.
  ok(Array.isArray(out.columns) && Array.isArray(out.data),
     'the table returns TableWidget\'s own { columns, data } shape');
  const plans = out.data.map(r => r[0]);
  ok(plans.indexOf('2026 Season Pass') < 0,
     'a plan nobody auto-renews is NOT in the auto-renew book — it sat at the top reading "0%", '
     + 'looking like a misconfiguration and not being one');
  ok(plans.indexOf('League Tournament Gate Adult') < 0, 'nor are the gate admissions');
  is(plans.length, 2, 'exactly the two plans somebody is enrolled on');
  const weekly = out.data.find(r => r[0] === 'Weekly Childcare');
  ok(weekly && /per week/.test(weekly[4]),
     'EVERY PER-PLAN RATE CARRIES ITS CADENCE. A weekly plan losing 5% a week and a monthly plan '
     + 'losing 5% a month are not the same thing, and a bare column invites ranking them');
  const monthly = out.data.find(r => r[0] === 'Monthly Individual');
  ok(monthly && /per month/.test(monthly[4]), '…and the monthly plan says month');
}

// ── 5. The section, its links, and the prompt ──────────────────────────────
{
  const m = /memberships: \{ id: 'memberships'[\s\S]*?defaultWidgets: \[([^\]]*)\]/.exec(src);
  ok(m, 'the memberships section should be findable');
  const defaults = m[1].split(',').map(x => x.trim().replace(/^'|'$/g, ''));
  ['mem-active','mem-passes','mem-autorenew','mem-mrr','mem-churn','mem-leaving','tbl-mem-autorenew']
    .forEach(id => ok(defaults.indexOf(id) >= 0, id + ' is on the section by default — a widget nobody '
      + 'can find is a widget that does not exist'));
  // Nothing was removed. The section had five widgets and orgs have been
  // reading them; this is additive.
  ['mem-active','mem-canceled','mem-revenue','mem-net','mem-type-donut'].forEach(id =>
    ok(src.indexOf("'" + id + "': {") > 0, 'the pre-existing widget ' + id + ' is still registered'));
}
{
  // THE LINK RULE, and it is the one this repo has already been burned by:
  // ORG_SLUG/TOKEN are THIS dashboard's names for an org and drifted for five
  // weeks when Shrewsbury was renamed. Only RPT_SLUG/RPT_TOKEN may build a
  // rental-report URL.
  const link = /<a className="widget-report-link"[\s\S]*?\/>|<a className="widget-report-link"[\s\S]*?<\/a>/.exec(src);
  ok(link, 'the per-widget report link should be findable');
  ok(/RPT_SLUG\(\)/.test(link[0]) && /RPT_TOKEN\(\)/.test(link[0]),
     'the tile link is built from the REPORTING project identity');
  ok(!/\$\{ORG_SLUG\}|\$\{TOKEN\}/.test(link[0]),
     '…and never from our own slug or token, which is exactly what drifted for five weeks');
  ok(/tab=\$\{def\.reportTab\}/.test(link[0]), 'and it lands on the tab the tile was computed from');

  const tabs = {};
  ['mem-autorenew','mem-mrr','mem-churn','mem-leaving','tbl-mem-autorenew'].forEach(id => {
    const i = src.indexOf("'" + id + "': {");
    const seg = src.slice(i, i + 900);
    const rt = /reportTab: '([a-z]+)'/.exec(seg);
    ok(rt, id + ' should carry a reportTab');
    tabs[id] = rt[1];
  });
  Object.entries(tabs).forEach(([id, tab]) => is(tab, 'autorenew',
    id + ' opens the Auto-Renew tab — the section header link lands on the report default, so a '
    + 'churn tile used to send a reader to a membership list with no churn on it'));
}
{
  const p = /memberships: 'Analyze these membership metrics[\s\S]*?',\n/.exec(SERVER);
  ok(p, 'the memberships insight prompt should be findable');
  ok(/hazard rate/.test(p[0]),
     'the prompt says churn is a hazard rate, or the model describes it as the share who ever left');
  ok(/card on file/i.test(p[0]),
     'and that converting somebody means capturing a card, not flipping a plan setting — '
     + 'auto-renew is only available on card payments');
  ok(/can never auto-renew|never auto-renew/.test(p[0]),
     'and that a pass can never auto-renew, so it is never a conversion opportunity');
}

console.log('✓ membership-book.spec.js — ' + n + ' assertions');
