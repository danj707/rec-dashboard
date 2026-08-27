// Spec for the two Fast Track widgets added 2026-08-27.
//
// Dan asked for "top Fast Tracked Sections" and a money widget, calling the
// latter "HUGE insights, basically free money by adding a few more spots".
//
// THE MEASUREMENT THAT RESHAPED THE MONEY WIDGET. Measured against card 17300
// (watertown), EXACT on all 338 sections:
//
//     Left on Table === FT Pending * Section Price
//
// So it is the value of Fast Track holds that have NOT converted — it is NOT
// demand that exceeded capacity. Of the 138 sections carrying it, only 2 are
// oversubscribed and 100 STILL HAVE EMPTY SEATS. Adding spots there captures
// nothing: those families already had a seat and did not finish checkout.
//
// The genuine "add a few more spots" money is a DIFFERENT column, Over Demand $
// — $1,170 across one section at Watertown. Small there, and the figure that
// grows at the oversubscribed orgs (Smyrna has 66 oversubscribed sections).
//
// A widget that summed the two, or labelled Left on Table as capacity-blocked,
// would send someone to add seats to sections that are already half empty. So
// the widget reports three pots with their own levers, and this spec fails if
// they are ever merged or mislabelled.
//
// ALSO PINNED: the sections widget must be SECTION grain. 'Top FT Programs'
// already exists, and a program hides its sections — at Watertown the tallest
// program bar aggregates several pickleball sessions while ONE of them holds 67
// signups. A second program-grain chart would be the same chart twice.
//
// Run: node scripts/ft-widgets.spec.js

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const PAGE = path.join(__dirname, '..', 'public', 'dashboard.html');
const src = fs.readFileSync(PAGE, 'utf8');

let n = 0;
const ok = (cond, what) => { n++; assert.ok(cond, what); };
const is = (a, b, what) => { n++; assert.strictEqual(a, b, what); };

// ── Lift a widget's transform and run it, rather than regexing over it ──────
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
  // eslint-disable-next-line no-eval
  return eval('(' + src.slice(t + 'transform: '.length, end).trim().replace(/,$/, '') + ')');
}

// A fixture built to discriminate, not to flatter. Every row is a case:
const ROWS = [
  // Oversubscribed and full: the ONLY kind of row where adding spots is the fix.
  { 'Row Type': 'section', Section: 'Skills', Program: 'Pickleball', 'FT Total': 14, 'FT Pending': 6,
    'FT Converted': 8, Capacity: 8, 'Total Enrolled': 8, 'Section Price': 195,
    'FT Revenue': 1560, 'Left on Table': 1170, 'Over Demand $': 1170 },
  // Money waiting, but SEATS ARE FREE — follow-up, not capacity. This is the row
  // that makes "free money by adding spots" the wrong read.
  { 'Row Type': 'section', Section: 'Fishing', Program: 'Academy', 'FT Total': 9, 'FT Pending': 2,
    'FT Converted': 7, Capacity: 13, 'Total Enrolled': 7, 'Section Price': 500,
    'FT Revenue': 3500, 'Left on Table': 1000, 'Over Demand $': 0 },
  // Big room, big signups, nothing waiting: should top the sections chart on
  // volume but contribute nothing to either pot.
  { 'Row Type': 'section', Section: 'Extended Day', Program: 'Summer', 'FT Total': 36, 'FT Pending': 0,
    'FT Converted': 36, Capacity: 200, 'Total Enrolled': 36, 'Section Price': 100,
    'FT Revenue': 3600, 'Left on Table': 0, 'Over Demand $': 0 },
  // Zero FT — must not appear in the sections chart at all.
  { 'Row Type': 'section', Section: 'Empty', Program: 'Quiet', 'FT Total': 0, 'FT Pending': 0,
    'FT Converted': 0, Capacity: 20, 'Total Enrolled': 3, 'Section Price': 50,
    'FT Revenue': 0, 'Left on Table': 0, 'Over Demand $': 0 },
  // Non-section rows must be filtered out, or per-booking rows inflate everything.
  { 'Row Type': 'ft_booking', Section: 'Skills', 'FT Total': 999, 'Left on Table': 9999 },
  { 'Row Type': 'user', Section: 'nobody', 'FT Total': 999, 'Left on Table': 9999 },
  { 'Row Type': 'ft_daily', 'Daily FT': 3, 'Left on Table': 9999 },
];

// ── 1. Top Fast Tracked Sections ───────────────────────────────────────────
{
  const out = transformOf('ft-top-sections')(ROWS);

  is(out.values.length, 3, 'only the three sections WITH Fast Track demand should chart');
  is(out.values[0], 36, 'sorted by signup volume, so Extended Day (36) leads');
  is(out.values[2], 9, 'and Fishing (9) is last of the three');
  ok(!out.labels.some(l => /Empty/.test(l)), 'a section with no FT signups must not appear');
  ok(!out.labels.some(l => /nobody/.test(l)),
     'non-section rows must be filtered out — a booking row would otherwise inflate the chart');

  // Capacity in the label is the whole point: 36/200 and 14/8 are the same bar
  // height and opposite situations.
  ok(/36\/200/.test(out.labels[0]), 'the label should carry signups/capacity');
  ok(out.labels.some(l => /14\/8/.test(l)), 'an oversubscribed section should read 14/8');

  // It must be SECTION grain — the label comes from Section, not Program.
  ok(out.labels.some(l => /^Extended Day/.test(l)),
     'labels should come from the Section, not the Program (that chart already exists)');
  ok(!out.labels.some(l => /^Summer/.test(l)), 'a Program name as the label means the grain regressed');
}

// ── 2. Fast Track Money — three pots, three levers ─────────────────────────
{
  const out = transformOf('ft-money')(ROWS);
  const row = name => out.data.find(r => r[0] === name);
  const amount = name => row(name)[1];

  is(out.data.length, 3, 'three pots: earned, awaiting checkout, blocked by capacity');

  // Earned reads from FT Revenue, not re-derived.
  is(amount('Earned'), '$8,660', 'earned should be the sum of FT Revenue (1560+3500+3600)');

  // THE LOAD-BEARING SEPARATION.
  is(amount('Awaiting checkout'), '$2,170',
     'awaiting checkout is Left on Table (1170+1000) — holds that have not converted');
  is(amount('Blocked by capacity'), '$1,170',
     'blocked is Over Demand $ ONLY — the money that adding spots would actually capture');

  ok(amount('Awaiting checkout') !== amount('Blocked by capacity'),
     'the two pots must never be the same number — they have opposite fixes');

  // The pots must not be summed into one "opportunity" figure.
  is((src.match(/holds \+ blocked|blocked \+ holds/g) || []).length, 0,
     'Left on Table and Over Demand must never be added together');

  // The lever text is what stops the wrong action being taken.
  ok(/Follow-up/.test(row('Awaiting checkout')[3]),
     'the awaiting-checkout row must say follow-up, not add capacity');
  ok(/still have seats free/.test(row('Awaiting checkout')[3]),
     'it must say how many of those sections still have seats — that is the evidence for follow-up over capacity');
  ok(/1 of these still have seats free/.test(row('Awaiting checkout')[3]),
     'Fishing has free seats and Skills does not, so exactly 1 of 2 should be reported');
  ok(/Add spots/.test(row('Blocked by capacity')[3]),
     'the blocked row is the only one that should say add spots');
  ok(!/Add spots/.test(row('Awaiting checkout')[3]),
     'the awaiting-checkout row must NOT tell anyone to add spots — 100 of 138 such sections at Watertown already have seats free');

  // "Where" carries the counts that make each amount checkable.
  ok(/2 sections/.test(row('Awaiting checkout')[2]), 'two sections carry unconverted holds');
  ok(/8 families/.test(row('Awaiting checkout')[2]), 'and 8 families are holding (6+2)');
  ok(/1 section$/.test(row('Blocked by capacity')[2]), 'singular when exactly one section is blocked');
}

// ── 3. An org with no capacity pressure must not be told to add spots ──────
{
  const calm = ROWS.filter(r => r['Over Demand $'] !== 1170);
  const out = transformOf('ft-money')(calm);
  const blocked = out.data.find(r => r[0] === 'Blocked by capacity');
  is(blocked[1], '$0', 'no over-demand means no blocked money');
  ok(/Nothing blocked on seats/.test(blocked[3]),
     'with nothing blocked the row must say so rather than inviting a capacity change');
  ok(!/Add spots/.test(blocked[3]), 'and must not say add spots');
}

// ── 4. Registry wiring ─────────────────────────────────────────────────────
ok(/defaultWidgets: \['ft-signups','ft-converted','ft-pending','ft-conv-rate','ft-top-sections','ft-top-programs','ft-money'\]/.test(src),
   'both widgets should be in the Fast Track section defaults');
ok(/'ft-top-sections':[\s\S]{0,400}?size: 'md'/.test(src), 'the sections chart should be md, to sit beside Top FT Programs');
ok(/'ft-money':[\s\S]{0,400}?component: 'table'/.test(src),
   'the money widget should be a table — it has to carry a lever per row, which metrics cannot');

console.log('✓ ft-widgets.spec.js — ' + n + ' assertions');
