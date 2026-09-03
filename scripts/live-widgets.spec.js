#!/usr/bin/env node
/* ============================================================================
 * live-widgets.spec.js — the Live Widgets section, and the Coffee Counter.
 *
 * WHY IT IS HERE AND NOT ON THE REPORT. It was built on the reporting project
 * first and moved the same afternoon. Dan, 2026-09-03:
 *
 *   "I ruminated on the live reports/widgets, and decided they don't belong on
 *    the reporting project side... The new live coffee counter widget, and all
 *    other live widgets, need to live on the org-dashboard project. A
 *    dashboard is the spot for live data, not static reports."
 *
 * The line is between a REPORT and a DASHBOARD, not between two features: a
 * report answers a question about a window somebody chose, and a panel
 * refreshing itself under that answer is a second, contradictory clock on the
 * same screen.
 *
 * WHAT IT SHOWS. "Laurel's Coffee Chart", named for Laurel Rossiter at
 * Shrewsbury: "registration day opens and I can literally watch people
 * register for stuff and keep track... I don't have that umbrella viewpoint
 * that I'm used to having, and I miss it." Her own Metabase card is four
 * columns, newest first, no filters — and it beat a seven-tab report for the
 * one question she asks daily.
 *
 * THE FIVE THINGS THAT CAN BE WRONG WHILE THE WIDGET STILL LOOKS RIGHT:
 *
 *   1. A CONFIDENT ZERO. If the feed cannot answer, "0 signups today" says
 *      nobody registered when the truth is that nothing answered — on a
 *      registration morning that is the most damaging reading this dashboard
 *      could show. The card key is omitted until the public link exists, so
 *      the section does not render at all; a failed fetch renders nothing.
 *   2. A STALE "RIGHT NOW". Every other feed here caches 15 minutes by org
 *      config. A counter whose whole claim is "now" cannot inherit that.
 *   3. THE DATE PICKER. These widgets deliberately ignore it, and the section
 *      says so on screen — mixing "this quarter" and "right now" under one
 *      range is how a number comes to mean two things.
 *   4. THE VIEWER'S CLOCK. The card stamps each signup in the ORG's timezone,
 *      so "today" is read off the newest ROW, not off the browser — a viewer
 *      in another zone must not be told a different number from the person
 *      sitting in the rec centre. And nothing here parses a date string
 *      through `new Date()`: that is UTC midnight and lands on the previous
 *      day west of UTC.
 *   5. PRINT. A printed "right now" is a lie the moment the paper leaves the
 *      printer.
 *
 * The card's own defects are pinned against the mirror in sql/, since it was
 * ported from Laurel's card 3571 and each difference is a bug in the original.
 * ==========================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');

const PAGE   = path.join(__dirname, '..', 'public', 'dashboard.html');
const SERVER = path.join(__dirname, '..', 'server.js');
const CARD   = path.join(__dirname, '..', 'sql', 'enrollments-live.sql');

const src = fs.readFileSync(PAGE, 'utf8');
const srv = fs.readFileSync(SERVER, 'utf8');
const sql = fs.readFileSync(CARD, 'utf8');

// Line comments FIRST. Both files quote the broken forms (`new Date(`, a
// hardcoded TTL) in their comments on purpose, and stripping block comments
// first can pair a `/*` inside a `//` comment with a real close far below —
// the trap that left nine specs in the sibling repo blind over a region.
const strip = t => t.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const code = strip(src);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const eq = (g, w, m) => ok(g === w, m + ' — got ' + JSON.stringify(g) + ', want ' + JSON.stringify(w));

// ── lift and RUN the date helpers ───────────────────────────────────────────
function liftFn(text, name) {
  const start = text.indexOf('function ' + name + '(');
  if (start < 0) throw new Error(name + ' not found at module scope — a spec cannot run what it cannot reach');
  let i = text.indexOf(')', start);
  let depth = 0;
  i = text.indexOf('{', i);
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) break; }
  }
  return text.slice(start, i + 1);
}

let H = {};
try {
  H = new Function(
    liftFn(src, 'liveWindow') + '\n' + liftFn(src, 'liveDay') + '\n' +
    liftFn(src, 'liveClock') + '\n' + liftFn(src, 'liveMoney') + '\n' +
    'return { liveWindow, liveDay, liveClock, liveMoney };')();
  pass++;
} catch (e) {
  // A guard that DIES instead of failing has not told anyone what broke.
  failures.push('the live date helpers THREW when lifted: ' + e.message);
}

if (H.liveWindow) {
  const { liveWindow, liveDay, liveClock, liveMoney } = H;

  /* ── 1. THE WINDOW IS SEVEN LOCAL DAYS, INCLUSIVE ─────────────────────────
     Built from date PARTS. A window derived through toISOString() is a UTC
     day, so from late afternoon onwards in the US it asks for tomorrow and
     drops today's first signups — on the one feed whose entire value is
     today. */
  {
    const w = liveWindow(7);
    ok(/^\d{4}-\d{2}-\d{2}$/.test(w.start) && /^\d{4}-\d{2}-\d{2}$/.test(w.end),
       'the window is two bare ISO dates');
    const t = new Date();
    const todayLocal = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0')
                     + '-' + String(t.getDate()).padStart(2, '0');
    eq(w.end, todayLocal, "the window ends on the viewer's LOCAL today, not a UTC one");
    const p = w.start.split('-').map(Number);
    const q = w.end.split('-').map(Number);
    const days = Math.round((Date.UTC(q[0], q[1] - 1, q[2]) - Date.UTC(p[0], p[1] - 1, p[2])) / 864e5);
    eq(days, 6, 'seven days INCLUSIVE, so start is six days before end');
    eq(liveWindow(1).start, liveWindow(1).end, 'a one-day window is a single day, not an empty range');
  }

  /* ── 2. THE TIMESTAMP IS READ, NEVER PARSED ──────────────────────────────
     The card emits a bare local wall-clock string already converted to the
     ORG's timezone. Parsing it as a Date and reformatting re-applies the
     VIEWER's zone and moves an evening signup onto the wrong day. */
  {
    eq(liveDay('2026-09-03T21:41:48'), '2026-09-03', 'the day is the first ten characters');
    eq(liveDay(null), '', 'a missing timestamp yields no day rather than throwing inside a filter');
    eq(liveClock('2026-09-03T14:41:48'), '2:41p', 'the afternoon reads as pm');
    eq(liveClock('2026-09-03T09:02:00'), '9:02a', 'the morning reads as am');
    eq(liveClock('2026-09-03T00:15:00'), '12:15a', 'midnight is 12, not 0');
    eq(liveClock('2026-09-03T12:00:00'), '12:00p', 'noon is 12 pm, not 0 pm');
    eq(liveClock('nonsense'), '', 'an unreadable timestamp renders nothing rather than "NaN:NaN"');
  }

  /* ── 3. MONEY IS BLANK, NEVER $0 ─────────────────────────────────────────
     A free registration and a registration whose price we could not read are
     different facts, and $0 asserts the first. */
  {
    eq(liveMoney(25), '$25', 'a price renders');
    eq(liveMoney('170'), '$170', 'a string price renders');
    eq(liveMoney(0), '', 'zero renders nothing rather than "$0"');
    eq(liveMoney(null), '', 'and so does a missing price');
  }
}

/* ── 4. NO CONFIDENT ZERO, at either end ───────────────────────────────────*/
{
  ok(/if \(err \|\| !rows\) return null;/.test(code),
     'a failed or unanswered feed renders NOTHING — a "0 signups today" counter on a registration morning is the worst reading this dashboard could show');
  ok(/availableReports\.enrollments && \(/.test(code),
     'and the section renders only where the feed exists at all');
  /* THE SECTION HIDES WITH ITS WIDGETS. This was an env gate for about an hour
     (Dan: "what is MB_ENROLLMENTS_UUID lol"), which put a deploy step between
     publishing a card and seeing the widget for no benefit — the rule that had
     to hold is that a dead feed can never render a zero, and that lives in the
     component, not in a variable. A header over an empty grid is its own dead
     end, so the section goes too. */
  ok(/if \(!alive\) return null;/.test(code),
     'the Live Widgets section hides itself when its widgets have nothing — a heading over a blank space reads as broken, not as absent');
  ok(/const \[alive, setAlive\] = useState\(true\);/.test(code),
     '...optimistically, so a slow first fetch does not flash the section out and back in');
  ok(/\.catch\(\(\) => \{ setErr\(true\); if \(onAvailable\) onAvailable\(false\); \}\)/.test(code),
     'and it is a FAILED fetch that hides it, never a pending one');
  ok(/enrollments: 'e663ecfb-71b4-4de1-b984-13c69beab005'/.test(srv),
     'the card is wired as a literal, like every other shared card in this file');
}

/* ── 5. IT HAS ITS OWN CLOCK ───────────────────────────────────────────────*/
{
  ok(/const LIVE_REPORT_TTL_MS = \{ enrollments: 60 \* 1000 \}/.test(srv),
     'the live feed caches for a minute, not the org\'s 15');
  ok(/const ttl = LIVE_REPORT_TTL_MS\[reportType\] \|\| \(orgConfig\?\.cacheTTL \|\| 15\) \* 60 \* 1000;/.test(srv),
     "...and the override wins over the org's own preference: an org that set a 30-minute cache did not ask for a stale \"right now\"");
  ok(/const LIVE_POLL_MS = 60000;/.test(code), 'the page polls every 60s');
  ok(/if \(paused\) return;\s*\n\s*const t = setInterval\(load, LIVE_POLL_MS\);/.test(code),
     'and Pause STOPS the timer rather than hiding its effect — a list that reorders under the cursor while you read a name is worse than a stale one');
  ok(/return \(\) => clearInterval\(t\);/.test(code),
     'the interval is cleared on unmount, or switching tabs leaves a timer polling forever');
}

/* ── 6. IT IGNORES THE DATE PICKER, and says so ────────────────────────────*/
{
  const i = code.indexOf("live: { id: 'live'");
  const sec = code.slice(i, i + 400);
  ok(i > 0, 'the Live Widgets section is registered');
  ok(/_special: true/.test(sec),
     'it is _special, so it renders its own component instead of going through the date-ranged reportData pipeline');
  ok(/not scoped to the date range/.test(sec),
     '...and its description says so, because a reader cannot otherwise tell which clock a number is on');
  ok(/not date-filtered/.test(code),
     'and the badge on the section header repeats it where the numbers are');
  ok(!/dateRange/.test(code.slice(code.indexOf('function CoffeeCounter'), code.indexOf('function LiveSection'))),
     'the widget itself never reads dateRange');
}

/* ── 7. NOT IN PRINT, and ABOVE the stored sections ───────────────────────*/
{
  ok(/\{!IS_PRINT && activeTab === 'dashboard' && availableReports\.enrollments && \(/.test(code),
     'the live section is excluded from print — a printed "right now" is a lie the moment the paper leaves the printer');
  const live = code.indexOf('<LiveSection');
  const rest = code.indexOf('displaySections.map');
  ok(live > 0 && rest > live,
     'and it renders ABOVE the stored sections: live data is what you want on arrival, not below the fold');
}

/* ── 8. TODAY COMES FROM THE FEED, NOT THE BROWSER ────────────────────────*/
{
  ok(/const today\s+= rows\.length \? liveDay\(rows\[0\]\['Signed Up At'\]\) : '';/.test(code),
     "\"today\" is the newest ROW's own day — the card stamps it in the ORG's timezone, so a viewer elsewhere must not be shown a different number");
  ok(/rows\.filter\(r => liveDay\(r\['Signed Up At'\]\) === today\)/.test(code),
     'and the count is the rows sharing that day');
  /* SCOPED TO THE WIDGET. A file-wide test fails on correct code — other tiles
     legitimately build Dates for their own charts — and an assertion that
     cannot pass is not a guard, it is noise that gets deleted. */
  const widget = code.slice(code.indexOf('function CoffeeCounter'), code.indexOf('function LiveSection'));
  ok(!/new Date\(r\[/.test(widget) && !/new Date\(ts/.test(widget) && !/new Date\(String\(/.test(widget),
     'nothing in the widget parses a feed timestamp through new Date() — that is UTC midnight and lands on the previous day west of UTC');
  ok(/new Date\(d0\.getFullYear\(\), d0\.getMonth\(\), d0\.getDate\(\) \+ i\)/.test(widget),
     '...and the day it does build for the sparkline comes from PARTS');
}

/* ── 9. THE SPARKLINE IS BUILT FROM THE WINDOW ────────────────────────────
   One bar per day across the last seven, including the days with nothing.
   Built from the days the rows happen to carry, a quiet Tuesday disappears and
   the shape lies about the week. */
{
  ok(/for \(let i = 0; i < LIVE_DAYS; i\+\+\)/.test(code),
     'the bars are generated from the window, not from the rows');
  ok(/i === days\.length - 1 \? 'today' : ''/.test(code),
     'the last bar is marked as today');
  ok(/still filling/.test(code),
     "...and the panel says today is still filling, or a half-finished day reads as a decline");
}

/* ── 9b. IT IS HALF WIDTH, AND THE EDITOR TREATS IT AS A STATE ────────────
   Dan, seeing it in "Add a Section" while it was already rendering above:
   "if it's already loaded, shouldn't it be highlighted, and at the top with a
   widget counter of 1?" Adding it would have produced a SECOND, empty copy —
   the section renders outside config.sections — so it is shown the way Support
   is: pinned, labelled always-on, not offered. */
{
  ok(/widget-card widget-md live-card/.test(code),
     'the counter is half width — widget-lg spans all four columns, and this is eight short rows, not a chart');
  ok(/data-edit-live/.test(code), 'the editor carries a pinned row for it');
  ok(/1 widget<\/span>|>1 widget</.test(code) || /1 widget/.test(code),
     '...with its widget count');
  ok(/if \(s\.id === 'live'\) return false;/.test(code),
     'and it is excluded from the addable list, or the editor offers to add what is already there');
  const editIdx = code.indexOf('data-edit-live');
  const supIdx  = code.indexOf('availableReports.support && (');
  ok(editIdx > 0 && supIdx > editIdx,
     'it is the FIRST pinned row, which is where the section itself sits on the page');
}

/* ── 9c. THE LOADING BAR STOPS ────────────────────────────────────────────
   Its inner bar carried a background and a 30% width unconditionally and only
   the ANIMATION was gated, so a finished load left a static amber stub under
   the header. Dan: "spinning forever, top bar never stops." It had already
   stopped; that was the problem. */
{
  ok(/\.loading-bar-inner \{[^}]*display: none;/.test(code),
     'the inner bar is hidden by default');
  ok(/\.loading-bar\.active \.loading-bar-inner \{ display: block; \}/.test(code),
     '...and shown only while the bar is active');
}

/* ── 10. THE CARD, and the four defects it fixes ──────────────────────────
   Ported from Laurel's own card 3571. THE LIVE CARD IS THE SOURCE OF TRUTH —
   read it before writing to it. */
{
  ok(/b\.created_at AT TIME ZONE cfg\.tz/.test(sql),
     '"Signed Up At" reads created_at, NOT updated_at — 3571 sorts on updated_at while its own date filter is bound to created_at, so a staff note re-dates a months-old signup to today and floats it to the top');
  ok(!/updated_at/.test(sql.replace(/^--.*$/gm, '')),
     'and updated_at appears nowhere in the executable SQL');
  ok(/\{\{org_id\}\}/.test(sql),
     'the org is a PARAMETER — 3571 hardcodes Shrewsbury\'s uuid while its description says Madison');
  ok(/FROM location l/.test(sql) && /ORDER BY COUNT\(\*\) DESC/.test(sql),
     "the timezone comes from the org's majority location, not a hardcoded America/New_York which renders a 9pm signup on the wrong DAY for half the platform");
  ok(!/2025-04-15/.test(sql.replace(/^--.*$/gm, '')),
     'and there is no arbitrary date floor silently truncating history');
  ok(/ORDER BY b\.created_at DESC, b\.id DESC/.test(sql),
     'newest first with a stable tie-break, or two runs disagree about same-second signups');
  ok(/applied_pricing->'result'->>'finalCents'/.test(sql),
     'Price is the item\'s own charge, never order_item.price — the rate card reads non-zero for a comped booking');
  ok(/AS "Participant"/.test(sql),
     'and the participant is carried, because a parent registering a child is the common case and one "name" column has to pick a side');

  /* v2: THE WINDOW IS APPLIED BEFORE THE MONEY. The money CTE used to
     aggregate the org's whole order_item ledger and then be joined to a
     handful of windowed bookings, so a seven-day widget paid for every
     registration the org had ever taken — 46s at Watertown, 42.2s at
     Shrewsbury. Scoping it to the bookings the feed returns is 1.05s for
     byte-identical output (126 rows, $11,123/$11,123, md5 173198a7…). */
  ok(/^bk AS \(/m.test(sql),
     'the windowed bookings are resolved in their own CTE, before any money is touched');
  {
    // The date tags must sit INSIDE bk — i.e. before the money CTE opens.
    const bkAt    = sql.indexOf('\nbk AS (');
    const moneyAt = sql.indexOf('\nmoney AS (');
    const startAt = sql.indexOf('{{start_date}}');
    const endAt   = sql.indexOf('{{end_date}}');
    ok(bkAt > 0 && moneyAt > bkAt && startAt > bkAt && startAt < moneyAt && endAt > bkAt && endAt < moneyAt,
       '...and the DATE TAGS live in it — a window applied after the aggregate is the bug this replaced');
  }
  ok(/FROM bk\n  JOIN order_item oi ON oi\.booking_id = bk\.id/.test(sql),
     'the money CTE reads the windowed bookings rather than the org');
  ok(/oi\.organization_id = bk\.org_id/.test(sql),
     "...and KEEPS the org predicate, so this is the same query over a smaller input rather than a different query");
  ok(!/JOIN order_item oi ON oi\.organization_id = cfg\.org_id/.test(sql),
     'the org-wide order_item scan is gone');
}

/* ── report ───────────────────────────────────────────────────────────────*/
if (failures.length) {
  console.error('\n✗ live-widgets.spec.js — ' + failures.length + ' failure(s):\n');
  failures.forEach(f => console.error('  ✗ ' + f));
  console.error('\n' + pass + ' passed, ' + failures.length + ' failed.\n');
  process.exit(1);
}
console.log('✓ live-widgets.spec.js — ' + pass + ' assertions passed.');
