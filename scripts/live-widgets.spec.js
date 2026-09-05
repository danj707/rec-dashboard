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

/* RE-EXEC UNDER A NON-UTC ZONE, and this is not decoration. `liveDayShift`
   builds a day key from PARTS; the tempting `new Date("2026-09-03")` is UTC
   midnight, which lands on the PREVIOUS day anywhere west of UTC. This sandbox
   and GitHub Actions both run UTC, where the broken version returns the right
   answer — so that mutation SURVIVED the whole spec until this existed.
   America/Los_Angeles is chosen for the PROPERTY, not for an org: it is behind
   UTC, so the two implementations diverge. A zone ahead of UTC would not
   discriminate either. Same lesson as fasttrack-dates.spec.js one repo over. */
if (process.env.TZ !== 'America/Los_Angeles') {
  const r = require('child_process').spawnSync(process.argv[0], [__filename], {
    stdio: 'inherit', env: Object.assign({}, process.env, { TZ: 'America/Los_Angeles' }),
  });
  process.exit(r.status == null ? 1 : r.status);
}

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
// The sounds the page offers, read out of the page rather than transcribed —
// a spec carrying its own copy of the list agrees with itself and nothing else.
const LIVE_CHIME_NAMES = (() => {
  const m = code.match(/const LIVE_CHIMES = \[([\s\S]*?)\];/);
  return m ? (m[1].match(/'[a-z]+',/g) || []).map(x => x.slice(1, -2)) : [];
})();
const LIVE_CHIME_DEFAULT_NAME = (code.match(/const LIVE_CHIME_DEFAULT = '([a-z]+)'/) || [])[1] || '';

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
    liftFn(src, 'liveKey') + '\n' + liftFn(src, 'liveSectionKey') + '\n' +
    liftFn(src, 'liveBySection') + '\n' +
    liftFn(src, 'liveMarkState') + '\n' + liftFn(src, 'liveChimeWorthy') + '\n' +
    liftFn(src, 'livePriceCell') + '\n' +
    liftFn(src, 'liveCheckinKey') + '\n' + liftFn(src, 'liveCheckinState') + '\n' +
    liftFn(src, 'liveInitials') + '\n' + liftFn(src, 'liveDayAxis') + '\n' +
    liftFn(src, 'liveAt') + '\n' + liftFn(src, 'liveCheckinTimeline') + '\n' +
    liftFn(src, 'liveDayShift') + '\n' + liftFn(src, 'liveProgramTrend') + '\n' +
    liftFn(src, 'liveChimeBurst') + '\n' +
    'const LIVE_TREND_DAYS = ' + (code.match(/LIVE_TREND_DAYS = (\d+)/) || [0,3])[1] + ';\n' +
    'const LIVE_TREND_MIN = '  + (code.match(/LIVE_TREND_MIN = (\d+)/)  || [0,4])[1] + ';\n' +
    /* THE BURST CONSTANTS ARE READ OUT OF THE PAGE, never transcribed here.
       Copying `12` into the spec makes it a test of the spec: the page could
       drop to three and every assertion below would still pass. */
    ['LIVE_CHIME_MAX', 'LIVE_CHIME_GAP_MS', 'LIVE_CHIME_JITTER_MS',
     'LIVE_CHIME_DUCK', 'LIVE_CHIME_DETUNE_STEP', 'LIVE_CHIME_DETUNE_STEPS',
     'LIVE_CHIME_RING_MS']
      .map(n => {
        const m = code.match(new RegExp('const ' + n + ' = ([0-9.]+)'));
        if (!m) throw new Error(n + ' is not declared in the page');
        return 'const ' + n + ' = ' + m[1] + ';\n';
      }).join('') +
    'return { liveWindow, liveDay, liveClock, liveMoney, liveKey, liveSectionKey, liveBySection, liveMarkState,' +
    ' liveChimeWorthy, livePriceCell, liveDayShift, liveProgramTrend, liveChimeBurst,' +
    ' liveCheckinKey, liveCheckinState, liveInitials, liveDayAxis, liveCheckinTimeline,' +
    ' LIVE_CHIME_MAX, LIVE_CHIME_GAP_MS, LIVE_CHIME_JITTER_MS, LIVE_CHIME_RING_MS };')();
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
  ok(/if \(err\) return null;/.test(code),
     'a FAILED feed renders nothing — a "0 signups today" counter on a registration morning is the worst reading this dashboard could show');
  /* But not-yet-answered is not failed. Rendering nothing during the first
     fetch left a heading over blank space for several seconds — Dan: "now the
     widget is gone lol", which was the load, not a failure. */
  ok(/if \(!rows\) \{[\s\S]{0,900}?skeleton skeleton-chart/.test(code),
     '...and a feed that has not answered YET shows a skeleton, the way every other widget here does');
  ok(/data-live-loading="1"/.test(code), 'the loading card is distinguishable from the loaded one');
  ok(/availableReports\.enrollments && \(/.test(code),
     'and the section renders only where the feed exists at all');
  /* THE SECTION HIDES WITH ITS WIDGETS. This was an env gate for about an hour
     (Dan: "what is MB_ENROLLMENTS_UUID lol"), which put a deploy step between
     publishing a card and seeing the widget for no benefit — the rule that had
     to hold is that a dead feed can never render a zero, and that lives in the
     component, not in a variable. A header over an empty grid is its own dead
     end, so the section goes too. */
  /* NOTHING LEFT TO SHOW, not "the first feed failed". There are two feeds
     now — registrations and check-ins are different cards on different
     questions — so one of them going down must not take the other off the
     page, and the SECTION goes only when both are gone. */
  ok(/if \(!alive && !showCi\) return null;/.test(code),
     'the Live Widgets section hides itself when its widgets have nothing — a heading over a blank space reads as broken, not as absent');
  ok(/\{alive \? <LiveRegistrations/.test(code) && /\{showCi \? <MembershipCheckins/.test(code),
     '...and each card is gated on ITS OWN feed, so one failing does not blank the other');
  ok(/const \[alive, setAlive\] = useState\(true\);/.test(code),
     '...optimistically, so a slow first fetch does not flash the section out and back in');
  ok(/\.catch\(\(\) => \{ setErr\(true\);[^}]*onAvailable\(false\); \}\)/.test(code),
     'and it is a FAILED fetch that hides it, never a pending one');
  ok(/enrollments: 'e663ecfb-71b4-4de1-b984-13c69beab005'/.test(srv),
     'the card is wired as a literal, like every other shared card in this file');
}

/* ── 5. IT HAS ITS OWN CLOCK ───────────────────────────────────────────────*/
{
  /* MEMBERSHIP, NOT THE WHOLE LITERAL. Pinning the exact object broke the day
     a second live feed was added, with nothing about the enrollments TTL having
     changed — the same brittleness already recorded twice in the sibling repo
     for SLACK_NOTIFY and an ALLOWED array. */
  ok(/const LIVE_REPORT_TTL_MS = \{[^}]*enrollments: 60 \* 1000/.test(srv),
     'the live feed caches for a minute, not the org\'s 15');
  ok(/const ttl = LIVE_REPORT_TTL_MS\[reportType\] \|\| \(orgConfig\?\.cacheTTL \|\| 15\) \* 60 \* 1000;/.test(srv),
     "...and the override wins over the org's own preference: an org that set a 30-minute cache did not ask for a stale \"right now\"");
  ok(/const LIVE_POLL_MS = 60000;/.test(code), 'the page polls every 60s');
  ok(/if \(paused\) return;[\s\S]{0,120}?const t = setInterval\(load, LIVE_POLL_MS\);/.test(code),
     'and Pause STOPS the timer rather than hiding its effect — a list that reorders under the cursor while you read a name is worse than a stale one');
  ok(/return \(\) => clearInterval\(t\);/.test(code),
     'the interval is cleared on unmount, or switching tabs leaves a timer polling forever');

  /* A LIVE FEED NEVER SERVES A STALE ANSWER. Dan: "seems like the live widget
     is lagging — nothing happens until i click the refresh." Stale-while-
     revalidate hands the caller the PREVIOUS fetch and refreshes behind it, so
     with a 60s TTL and a 60s poll the card shows rows one to two minutes old —
     and clicking Refresh appeared to fix it only because the click landed
     after the background refresh the poll itself had kicked off. That trade is
     right for a report of a chosen window and wrong for a widget whose whole
     claim is "right now". */
  ok(/const isLive = !!LIVE_REPORT_TTL_MS\[reportType\];/.test(srv),
     'the fetcher knows which feeds are live');
  ok(/if \(entry && entry\.stale && isLive\) \{\s*await revalidate\(/.test(srv),
     '...and a stale LIVE entry is refreshed BEFORE answering, not behind the answer');
  ok(/if \(entry && entry\.stale && isLive\)[\s\S]{0,400}?if \(entry\) \{\s*if \(entry\.stale\) revalidate\(/.test(srv),
     '...while everything else still gets stale-while-revalidate — a 30s report must not block a reader');
  /* AND A FAILED REFRESH STILL ANSWERS. A card that empties itself the first
     time Metabase hiccups is worse than one a minute behind for a minute. */
  ok(/return fresh \? fresh\.data : entry\.data;/.test(srv),
     'a live refresh that failed falls back to the stale rows rather than to nothing');
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
  ok(!/dateRange/.test(code.slice(code.indexOf('function LiveRegistrations'), code.indexOf('function LiveSection'))),
     'the widget itself never reads dateRange');
}

/* ── 7. NOT IN PRINT, and ABOVE the stored sections ───────────────────────*/
{
  ok(/\{!IS_PRINT && activeTab === 'dashboard'\s*\n?\s*&& \(availableReports\.enrollments \|\| availableReports\['checkins-live'\]\) && \(/.test(code),
     'the live section is excluded from print — a printed "right now" is a lie the moment the paper leaves the printer');
  /* EITHER card is enough to render the section: an org with a check-ins link
     and no enrollments one would otherwise lose a widget it has. */
  ok(/availableReports\.enrollments \|\| availableReports\['checkins-live'\]/.test(code),
     '...and either feed being available is enough to render it');
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
  const widget = code.slice(code.indexOf('function LiveRegistrations'), code.indexOf('function LiveSection'));
  ok(!/new Date\(r\[/.test(widget) && !/new Date\(ts/.test(widget) && !/new Date\(String\(/.test(widget),
     'nothing in the widget parses a feed timestamp through new Date() — that is UTC midnight and lands on the previous day west of UTC');
  ok(/liveAt\(r\['Signed Up At'\]\)/.test(code),
     "...and the instant it does build comes through liveAt, which reads the stamp's PARTS");
}

/* ── 9. THE TIMELINE ──────────────────────────────────────────────────────
   It replaced a per-day bar chart. Dan: "what is the odd bar chart there...
   how about a moving timeline of the days/time... and when people pay, it gets
   a dollar sign." A count-per-day bar said almost nothing this card does not
   say better in words; a timeline says WHEN, which is what somebody watching a
   registration day is watching for. */
{
  ok(/function liveTimeline\(rows, today\)/.test(code),
     'the timeline is a module-scope model taking the FEED\'s day, so a spec can run it');
  /* THREE PAYMENT STATES, NOT TWO (Dan, 2026-09-04): "change the dollar signs
     to a green dot for paid, and an orange dot for a partial payment/payment
     plan (you had a grey dot right now)". Lifted and RUN, because a regex over
     a three-branch comparison passes on an inverted one. */
  ok(/state: liveMarkState\(r\)/.test(code),
     'a mark carries its payment STATE, not a boolean');
  if (H.liveMarkState) {
    eq(H.liveMarkState({ Price: 65, Paid: 65 }), 'paid', 'paid in full is paid');
    eq(H.liveMarkState({ Price: 65, Paid: 25 }), 'part',
       'part of the charge arrived — a payment plan is charged in full and pays its first installment, so this is the state it lives in');
    eq(H.liveMarkState({ Price: 65, Paid: 0 }),  'unpaid', 'nothing in is unpaid');
    eq(H.liveMarkState({ Price: 65, Paid: null }), 'unpaid', '...and so is a missing figure');
    eq(H.liveMarkState({ Price: null, Paid: 40 }), 'paid',
       'MONEY ARRIVED WITH NO READABLE CHARGE IS STILL PAID — a row we cannot price is not evidence the payment did not land');
    eq(H.liveMarkState({ Price: 0, Paid: 0 }), 'unpaid', 'a $0 row has nothing to arrive');
    eq(H.liveMarkState({ Price: 65, Paid: 64.999 }), 'paid',
       'a half-cent epsilon, or two independently rounded figures make a fully-paid registration read as a plan');
  } else {
    ok(false, 'liveMarkState should be liftable — it is the whole payment-dot rule');
  }
  ok(/data-live-mark=\{m\.state\}/.test(code),
     '...and the mark renders that state, so a render case can read it');
  ok(!/\{m\.paid \? '\$' : ''\}/.test(code),
     'the dollar-sign glyph is gone from the lane — the dots carry it now');
  ok(/live-legend/.test(code),
     'and a three-colour code is NAMED on screen, because nothing else explains it');
  ok(/lane: n\+\+ % 3/.test(code),
     'marks stagger across three rows, so a cluster reads as a cluster rather than as one dot');

  /* ONE DAY, NOT SEVEN. Dan, 2026-09-04: "would prefer this card show the
     current day, so it's not so smooshed... in terms of the dollar signs and
     the chart at the top." Over a week every signup fell inside a one-seventh
     slice and a busy afternoon rendered as an unreadable clump. These four
     assertions previously pinned the seven-day design; they pin the reason for
     the one-day one now, so a revert fails rather than passing quietly. */
  ok(/if \(liveDay\(r\['Signed Up At'\]\) !== today\) return;/.test(code),
     'a row from another day is DROPPED, not squeezed in — the lane is one day wide');
  ok(!/liveTimeline\(rows, LIVE_DAYS\)/.test(code),
     'the timeline is no longer handed the seven-day window');
  ok(/const tl = liveTimeline\(rows, today\)/.test(code),
     "...it is handed the feed's own day, so a viewer in another timezone sees the rec centre's day");
  ok(/for \(let h = 0; h < 24; h \+= 4\)/.test(code),
     'the axis is a FIXED 24 hours with 4-hourly ticks — an axis fitted to the marks would slide every signup sideways each minute as the day fills');
  ok(/const nowLeft = now >= t0 && now <= t1 \?/.test(code),
     'NOW is drawn only while the viewer\'s clock is inside the day being shown, rather than pinned to the right edge implying the day is still running');
  ok(/function liveAt\(ts\)/.test(code) && /new Date\(Number\(m\[1\]\), Number\(m\[2\]\) - 1/.test(code),
     'an instant is rebuilt from PARTS — new Date(str) would read the org-local stamp as UTC and slide an evening signup onto the wrong day');
}

/* ── 9a. THE CLOCK ALONE HID THE ORDER ────────────────────────────────────
   Dan, reading the list: "shouldn't this be sorted by time? look at the times
   there" — 11:23a, then 4:04p, then 2:12p. It IS sorted, newest first; those
   are three different DAYS, and a column showing only a clock cannot say so. */
{
  ok(/function liveWhen\(ts, todayKey\)/.test(code), 'the time cell knows which day it is showing');
  ok(/if \(!day \|\| day === todayKey\) return clock;/.test(code),
     'today keeps the bare clock — that is the day being watched, and prefixing every row would be noise');
  ok(/\['Sun','Mon','Tue','Wed','Thu','Fri','Sat'\]\[d\.getDay\(\)\] \+ ' ' \+ clock/.test(code),
     '...and every other row carries its weekday');
  ok(/live-daybreak/.test(code),
     'plus a rule where the day changes: a list scanned in two seconds is read by its shape, not only by its text');
}

/* ── 9e. LINKS INTO REC, built from ids rather than names ─────────────────
   Dan: "the HH owner and the section should be clickable directly to Rec."
   Both URL shapes are COPIED from the reporting project, not guessed — a link
   built from the wrong id renders identically and 404s, which is the mistake
   already recorded there for rec_id vs users.id. */
{
  ok(/'https:\/\/www\.rec\.us\/admin\/o\/' \+ orgId \+ '\/users\/' \+ userId/.test(code),
     'the household owner links to the Rec user page');
  ok(/'https:\/\/www\.rec\.us\/admin\/o\/' \+ orgId \+ '\/programming\/sections\/' \+ sectionId/.test(code),
     'the section links to the Rec section page');
  ok(/orgId && userId \? /.test(code) && /orgId && sectionId \? /.test(code),
     'both return null without an org or an id...');
  ok(/return u \? <a className="live-link"/.test(code),
     '...and the cell then renders plain text — a link to nowhere is worse than no link');
  ok(/recOrgId: json\.recOrgId \|\| ''/.test(code),
     'orgMeta is a whitelist, so the org uuid has to be copied into it explicitly or it is silently absent');
  ok(/recOrgId: org\.orgId,/.test(srv), 'and the server sends it');
  ok(/AS "User ID"/.test(sql), 'the card carries the buyer\'s own id');
  ok(/b\.customer_user_id::text/.test(sql),
     "...which is users.id, NOT rec_id — the six-character desk code looks like an id, renders identically in a link, and 404s");
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

/* ── 9d. THE LIST: FIXED COLUMNS, HEADERS, AND AN ARRIVAL THAT ANNOUNCES ──
   Dan: "set fixed column widths here, it's a bit of a jumbled mess... Add
   column headers. And animate the lightning bolt or something, make it seem
   more 'alive'. Doesn't feel like it's doing anything." And: "when a new
   registration happens, the bottom one drops off, the new one(s) pop on the
   top, highlighted, then the highlighting fades after 10 seconds or so." */
{
  ok(/table-layout: fixed/.test(code),
     'the columns are FIXED tracks — the rows change every minute, so natural widths re-measured the table and the columns jumped');
  ['Time', 'Household owner', 'Participant', 'Section', 'Price'].forEach(h =>
    ok(new RegExp('>' + h + '</th>').test(code), 'the list has a ' + h + ' header'));

  /* THE ROW KEY IS THE ROW'S IDENTITY. The feed carries no booking id, so it
     is the four things that cannot collide for two different registrations —
     and it has to be a KEY, not an index, or React reuses a <tr> for a
     different registration and the highlight lands on the wrong person. */
  ok(/function liveKey\(r\)/.test(code), 'a row has a stable identity');
  ok(/key=\{k\}/.test(code), '...and the rows are keyed by it, never by array index');

  /* A DIFF AGAINST THE PREVIOUS POLL, not a timestamp comparison: a row can
     arrive with an older stamp than one already on screen (a staff-entered
     registration backdated by minutes). */
  ok(/const fresh = keys\.filter\(k => !seen\.has\(k\)\);/.test(code),
     'an arrival is a row the previous poll did not have');
  /* AND THE PREVIOUS SET IS READ WITH NO FALLBACK. `seenRef.current ||
     new Set()` leaves the `if (seen)` branch standing and passing while making
     every row on the first load an "arrival" — which since the chime landed
     means three coins on every open, not just a card that lights up whole.
     A mutation to exactly that survived this spec until this assertion. */
  ok(/const seen = seenRef\.current;/.test(code),
     'the diff reads the previous poll\'s set with no empty-set fallback');
  ok(/if \(seen\) \{/.test(code),
     'THE FIRST LOAD HIGHLIGHTS NOTHING — every row is new to an empty set, and a card that lights up entirely on arrival has a highlight that means nothing');
  ok(/setTimeout\(\(\) => setFlash\(new Set\(\)\), LIVE_FLASH_MS\)/.test(code),
     'and the highlight comes off on a timer, so a later re-render cannot replay it on a row that is no longer news');
  ok(/const LIVE_FLASH_MS = 10000;/.test(code), '...after ten seconds');
  // Tests the CLEANUP, not its one-line shape: this pinned
  // `clearTimeout(timerRef.current), [])` and broke the day a second timer
  // joined the same unmount effect — nothing about the flash timer had changed.
  {
    const un = code.slice(code.indexOf('useEffect(() => () =>'));
    ok(/clearTimeout\(timerRef\.current\)/.test(un.slice(0, un.indexOf('}, [])') + 6)),
       'the timer is cleared on unmount');
  }

  ok(/if \(wasPaused\) load\(\);/.test(code),
     'unpausing refreshes immediately, rather than leaving the reader staring for up to a minute at the list they paused');
  ok(/\.live-bolt \{ animation: liveBolt/.test(code),
     'the bolt has a pulse — it is the only thing that moves between registrations, so it is what says the widget is still watching');
  ok(/prefers-reduced-motion: reduce[\s\S]{0,120}live-new/.test(code),
     'and reduced motion still gets the highlight, just without the movement');
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
/* ── 12. PROGRAMS LIVE ────────────────────────────────────────────────────
   Dan, 2026-09-04: "another live card — this one will be a live programs card,
   showing the most recent registrations by program. Admins can watch both
   users enrolling in sections, AND section revenue increasing."

   The model is LIFTED AND RUN here rather than regexed, because every way it
   can be wrong still renders a plausible table: a sort by size instead of
   recency, a total that folds in yesterday, or one money number standing in
   for two that legitimately differ. */
if (H.liveBySection) {
  const R = (day, time, program, section, price, paid) => ({
    'Signed Up At': day + 'T' + time, 'Program': program, 'Section': section,
    'Price': price, 'Paid': paid, 'Customer Name': 'x', 'Section Id': section,
  });
  const TODAY = '2026-09-04', YDAY = '2026-09-03';
  const rows = [
    R(TODAY, '18:30:00', 'Tap Dance',  'Tap Mon',    60, 60),
    R(TODAY, '09:05:00', 'Swim Camp',  'Swim AM',   120, 30),   // a payment plan: charged 120, paid 30
    R(TODAY, '09:04:00', 'Swim Camp',  'Swim PM',   120, 120),
    R(TODAY, '08:00:00', 'Swim Camp',  'Swim AM',   120, 120),
    R(YDAY,  '23:00:00', 'Tap Dance',  'Tap Mon',    60, 60),   // yesterday, must not count
    R(TODAY, '07:00:00', 'Free Play',  'Drop In',  null, null), // no price at all
  ];
  const out = H.liveBySection(rows, TODAY);

  /* ONE ROW PER SECTION since 2026-09-04, not per programme. Swim Camp's two
     sections are two rows now, which is the whole point of the change: a
     programme row summed sections its link could not open. */
  eq(out.length, 4, 'one row per SECTION, and yesterday is not one of them');

  /* BIGGEST BY REVENUE FIRST, since 2026-09-04 — Dan asked for a leaderboard:
     "I'd expect to see the top, say 10 or so programs". Swim Camp holds $240 of
     today's money against Tap Dance's $60 while Tap Dance is the MORE RECENT,
     so this fixture tells a revenue sort from a recency sort — which is exactly
     what it was written to do when the rule ran the other way. */
  eq(out[0].section, 'Swim AM', 'the biggest section by revenue leads');
  /* THE TIE IS BROKEN BY SIGNUPS. Tap Mon and Swim PM both hold $120, so the
     busier one leads — pinned because a fixture that happens to tie is exactly
     where an unstable sort would make two runs disagree. */
  eq(out[1].section, 'Tap Mon', '...then the next, by money and not by clock');
  eq(out[2].section, 'Swim PM', '...with a money tie broken by the busier section');
  eq((out[3] || {}).section, 'Drop In',
     'and a section with NO readable price sorts LAST — null is "we cannot tell", not "nothing"');

  const swim = out.find(g => g.section === 'Swim AM');
  eq(swim.signups, 2, "a section's signups count every row the feed carries for THAT section");
  eq(swim.charged, 240, 'charged is the sum of what was committed to this section');
  eq(swim.paid, 150, '...and paid is only what has actually arrived');
  ok(swim.charged !== swim.paid,
     'charged and paid DIFFER on a payment plan, which is why one "revenue" number would be a lie');
  eq(swim.program, 'Swim Camp', 'the programme rides along as CONTEXT on the row');
  /* THE SISTER SECTION IS ITS OWN ROW AND ITS OWN MONEY. This is the assertion
     that fails if the grain ever slides back to programmes: under the old
     shape both of these were one row holding $360. */
  const swimPm = out.find(g => g.section === 'Swim PM');
  eq(swimPm.signups, 1, 'the sister section is counted separately');
  eq(swimPm.paid, 120, '...with only its own money, never the programme total');

  /* EVERY DAY THE FEED CARRIES, since 2026-09-04. Dan: "Can we get more
     programs to show up on the right side chart? Seems a little thin over
     there." It was scoped to today, so a quiet morning was a three-row card
     while the feed already held a week for the list beside it. Tap Dance's
     yesterday row is the one that proves the widening — it used to be dropped. */
  const tap = out.find(g => g.section === 'Tap Mon');
  eq(tap.signups, 2, "yesterday's registration COUNTS now — the card covers the feed's window");
  eq(tap.charged, 120, '...and its money with it');
  eq(tap.todaySignups, 1,
     '...while `todaySignups` still separates what arrived today, which is what the headline reads');

  const free = out.find(g => g.section === 'Drop In');
  eq(free.charged, null, 'a section whose rows carried NO price is null, never 0 — free and unreadable are different facts');
  eq(free.signups, 1, '...but it still counts as a registration');

  eq(H.liveBySection(rows, '').length, 0,
     'no day means no rows rather than the whole week — the feed had not answered yet');
  eq(H.liveBySection([], TODAY).length, 0, 'an empty feed is an empty list, not a throw');

  // A programme with no name is labelled, not dropped: the registration
  // happened and hiding it would make the totals disagree with the counter.
  const noName = H.liveBySection([R(TODAY, '10:00:00', null, null, 10, 10)], TODAY);
  eq(noName.length, 1, 'a registration with no section name is still counted');
  eq(noName[0].section, '(no section)', '...under a label rather than blank');
  ok(!/no programme/.test(code),
     'and it is spelled Program, on screen and in the fallback (Dan: "not \'programmes\', \'Programs\'")');

  ok(/liveBySection\(rows, today\)/.test(code),
     'the widget calls the shared model rather than aggregating inline');
  ok(/function useLiveEnrollments/.test(code) && /const feed   = useLiveEnrollments/.test(code),
     'ONE feed for both ENROLLMENT widgets — two polls would double the query and let the cards disagree about the same minute');
  /* The check-ins card is the exception, and deliberately: it reads a
     DIFFERENT Metabase card, so sharing the enrollments feed is not even
     possible. What must not drift is the poll behaviour, asserted below. */
  ok((code.match(/const feed\s+= useLiveEnrollments|const ciFeed = useLiveCheckins/g) || []).length === 2,
     '...and the check-ins card has its own, because it reads a different card');
  ok(!/function ProgramsLive[\s\S]{0,4000}?fetch\(/.test(code),
     '...and the programmes card does not fetch for itself');
  /* PROGRAM REVENUE IS MONEY RECEIVED (Dan: "Change 'charged' on the programs
     live chart to 'Program Revenue'" / "It needs to match" the reporting
     project's Revenue tab, which counts payments received). The cell reads
     `paid`; `charged` survives as the sub-line on a payment plan. */
  ok(/data-live-prog-charged/.test(code) && /g\.paid == null \? '\\u2014'/.test(code),
     'no readable money renders a dash, never $0');
  ok(/<th className="lm">Section revenue<\/th>/.test(code),
     'the column is called Section revenue — the row is a section, so its money is too');
  ok(/<th className="ls">Section<\/th>/.test(code),
     '...and the identity column is the SECTION, not the programme');
  ok(/of \{liveMoney\(g\.charged\)\} charged/.test(code),
     '...with what was CHARGED underneath it, and only when the two differ — that is a payment plan, not a discrepancy');
  ok(/\(b\.paid == null \? -1 : b\.paid\) - \(a\.paid == null \? -1 : a\.paid\)/.test(code),
     'and the table ranks on the figure it shows, or the leaderboard disagrees with its own column');
}

/* ── 13. Dan's 2026-09-04 polish pass ────────────────────────────────────── */
{
  // The rename. "Coffee Counter" must not survive anywhere a person can read.
  ok(/Live Enrollments/.test(code), 'the card is called Live Enrollments');
  ok(!/Live Program Registrations/.test(src),
     '...and no older name survives anywhere a person can read — these comments ship to the browser');
  ok(!/Coffee Counter/.test(src), '...and nothing still says Coffee Counter, comments included');

  /* ONE HEADER, BOTH CARDS. The bolt lived in two copies and Dan reported the
     second as dead; a shared header is what stops the pair drifting, and it is
     also what puts the refresh button on both at once. */
  // Membership in the parameter list, not the literal list — this pinned
  // `{ icon, title, sub, feed }` and broke when a fourth prop was added.
  {
    const sig = (code.match(/function LiveCardHeader\(\{([^}]*)\}\)/) || [])[1] || '';
    ok((code.match(/function LiveCardHeader\(/g) || []).length === 1,
       'the live cards share ONE header component');
    ok(/\bfeed\b/.test(sig), '...taking the one shared feed rather than its own');
  }
  ok((code.match(/<LiveCardHeader/g) || []).length >= 4,
     '...used by every state of both cards — a loading branch with its own header is how one bolt ends up different');
  ok(!/widget-icon live-bolt/.test(code.slice(code.indexOf('function LiveRegistrations'))),
     '...and neither card hand-rolls its own bolt below that point');

  /* THE MANUAL REFRESH. Dan: "add a manual refresh button on both these live
     cards in case I don't want to wait every minute." */
  ok(/refresh: load/.test(code), 'the hook hands out its own fetch as refresh');
  ok(/onClick=\{refresh\} disabled=\{loading\}/.test(code),
     '...the button runs it and is disabled while a fetch is in flight, so a double-click cannot queue two');
  ok(/const \[loading, setLoading\] = useState\(true\);/.test(code),
     '...starting true, because the first fetch is already running when the cards mount');
  ok(/setLoading\(true\);\s*\n\s*fetch\(url\)/.test(code), '...set before the request');
  {
    const hdr = code.slice(code.indexOf('function LiveCardHeader'), code.indexOf('function LiveRegistrations'));
    ok(!/setPaused\(false\)/.test(hdr),
       'REFRESHING DOES NOT UNPAUSE — pause says "stop moving while I read", refresh says "move once, now"');
  }

  /* TEN PROGRAMS, not eight rows. */
  ok(/const LIVE_PROG_ROWS = 10;/.test(code), 'the programs card shows ten');
  ok(/progs\.slice\(0, LIVE_PROG_ROWS\)/.test(code), '...and slices on its own constant');
  ok(/rows\.slice\(0, LIVE_ROWS\)/.test(code),
     '...while the registration list keeps its own, or one constant would govern two different kinds of row');

  /* THE MONEY PULSE comes from the SAME arrival diff as the row highlight, or
     the two cards would disagree about what just landed. */
  ok(/freshBy/.test(code) && /flash\.has\(liveKey\(r\)\)/.test(code.slice(code.indexOf('const freshBy'))),
     'the per-program delta is built from the shared flash set');
  ok(/className=\{freshBy\.has\(g\.key\) \? 'live-new' : ''\}/.test(code),
     '...and the row lights up from the same map rather than a second scan');
  /* THE MAP IS KEYED THE SAME WAY THE ROWS ARE. Keyed by programme while the
     rows are sections, one signup would light up every section of its
     programme and add its whole bump to each of their money cells. */
  ok(/const key = liveSectionKey\(r\);[\s\S]{0,200}freshBy\.set\(key, g\)/.test(code),
     '...and the arrival map keys on the SAME section key the rows do');
  ok(/freshBy\.get\(g\.key\)/.test(code),
     '...so the money bump lands on the section that took the signup');
  ok(/data-live-bump=/.test(code), '...with the increment on screen, so a render case can read it');

  /* THE ROW OPENS EXACTLY ITSELF. Dan, after clicking a $20,390 programme row
     and landing on a section page reading $1,970.29: "I don't care how much the
     program has made, I want to know which section it's associated with." The
     row IS the section now, so the name, the count, the money and the link are
     one scope and cannot disagree. */
  ok(/data-live-prog-section=\{g\.sectionId\}/.test(code),
     'the section name links to its OWN section, not to a sibling');
  ok(/liveSectionUrl\(recOrgId, g\.sectionId\)/.test(code),
     '...built with the same helper the registrations list uses, so one id shape governs both');
  ok(!/lastSectionId/.test(code),
     '...and nothing still reaches for a "most recent of several" section — that was the 10x mismatch');
  if (H.liveBySection) {
    const D = '2026-09-04';   // fixed, like the block above: a literal day, never the clock
    const R2 = (day, clock, program, section, secId) => ({
      'Signed Up At': day + 'T' + clock, 'Program': program, 'Section': section,
      'Section Id': secId, 'Price': 10, 'Paid': 10, 'Customer Name': 'C',
    });
    const multi = H.liveBySection([
      R2(D, '09:00:00', 'Camp', 'Camp AM', 'sec-am'),
      R2(D, '11:00:00', 'Camp', 'Camp PM', 'sec-pm'),
    ], D);
    eq(multi.length, 2, 'a programme spanning two sections is TWO rows, each opening itself');
    eq(multi.find(g => g.section === 'Camp PM').sectionId, 'sec-pm', '...each carrying its own id');
    eq(multi.find(g => g.section === 'Camp AM').sectionId, 'sec-am', '...and not its sibling\'s');
    const none = H.liveBySection([R2(D, '09:00:00', 'Camp', 'Camp AM', null)], D)[0];
    eq(none.sectionId, '', 'no id means no link rather than a link to nowhere');
    /* TWO PROGRAMMES CAN RUN THE SAME SECTION NAME — already recorded for this
       feed ("two programs run Girls Grades 3-4"). Without an id they must stay
       apart, or one row would hold both their money. */
    const clash = H.liveBySection([
      R2(D, '09:00:00', 'Rec Basketball', 'Girls Grades 3-4', null),
      R2(D, '10:00:00', 'Travel Basketball', 'Girls Grades 3-4', null),
    ], D);
    eq(clash.length, 2, 'two programmes running the same section NAME stay two rows');
  }

  /* THE WARM TINT, in BOTH themes. A colour defined once is a card that reads
     correctly in one theme and disappears in the other. */
  ok((code.match(/--live-bg:/g) || []).length === 2,
     'the live tint is a token defined in both the dark and light blocks');
  ok(/background: var\(--live-bg\); border-color: var\(--live-border\)/.test(code),
     '...and the card reads it rather than a literal');
}


/* ── 14. THE CHA-CHING ────────────────────────────────────────────────────────
   Dan: "every time a person enrolls and pays, play a 'cha-ching' sound. mute by
   default, but add a 'mute' checkbox on the card". Every assertion here is
   about a CONDITION, not about a checkbox existing: a mute box renders
   identically on a chime wired to fire on every arrival, on first load, or on
   an unpaid hold. */
{
  /* "ENROLLS AND PAYS". An unpaid registration is silent — a cha-ching for a
     hold with no money behind it announces revenue that has not arrived. And
     it reads the SAME predicate the price colour and the revenue figure use,
     so the three cannot disagree about one row. */
  if (H.liveChimeWorthy) {
    ok(H.liveChimeWorthy({ Price: 40, Paid: 40 }) === true,  'a fully paid enrollment rings');
    ok(H.liveChimeWorthy({ Price: 40, Paid: 10 }) === true,  'a partial payment rings — money did arrive');
    ok(H.liveChimeWorthy({ Price: 40, Paid: 0 })  === false, 'an UNPAID enrollment is silent');
    ok(H.liveChimeWorthy({ Price: 40 })           === false, '...and so is one with no payment field at all');
    ok(/liveMarkState\(r\)\s*!==\s*'unpaid'/.test(code),
       "...via liveMarkState, not its own arithmetic — one predicate, three readers");
  }

  /* WHAT ARRIVED, OVER WHAT WAS CHARGED. Dan, on a $325 registration with $195
     paid on a payment plan: "would like to see 195/325 here." Lifted and RUN,
     because the interesting part is WHICH rows get two figures. */
  if (H.livePriceCell) {
    const { livePriceCell } = H;
    const part = livePriceCell({ Price: 325, Paid: 195 });
    ok(part.paid === '$195' && part.price === '$325',
       'a part-paid row shows what arrived over what was charged');
    ok(livePriceCell({ Price: 325, Paid: 325 }).paid === '',
       'a fully paid row shows one figure — "$325 / $325" is noise');
    ok(livePriceCell({ Price: 325, Paid: 325 }).price === '$325',
       '...and it is the charge');
    /* AN UNPAID ROW SHOWS NO ZERO. "$0 / $325" reads as a refund rather than
       as a booking nobody has paid for yet; the grey dot already says it. */
    ok(livePriceCell({ Price: 325, Paid: 0 }).paid === '',
       'an unpaid row shows no paid figure');
    ok(livePriceCell({ Price: 325 }).price === '$325',
       '...and still prints the charge');
    ok(livePriceCell({}).price === '\u2014',
       'a row with no money at all is a dash, not an empty cell');
    /* THE STATE AND THE CELL CANNOT DISAGREE. Both read liveMarkState, so a
       row the dots call part-paid is exactly the row that gets two figures. */
    const rows = [{ Price: 325, Paid: 195 }, { Price: 45, Paid: 45 }, { Price: 50, Paid: 0 }];
    ok(rows.every(r => (H.liveMarkState(r) === 'part') === !!livePriceCell(r).paid),
       'two figures appear on exactly the rows the dots call part-paid');
  }

  /* COMING BACK TO THE TAB REFETCHES. A 60-second interval in a hidden tab is
     not a 60-second interval — browsers throttle backgrounded timers hard — so
     a dashboard on a second monitor shows its age the moment somebody looks at
     it. That is the other half of "nothing happens until i click the refresh". */
  ok(/visibilitychange/.test(code) && /document\.visibilityState === 'visible'/.test(code),
     'the feed refetches when the tab becomes visible');
  ok(/visibilityState === 'visible' && !pausedRef\.current/.test(code),
     '...but not while paused — a tab switch is not an un-pause');
  ok(/removeEventListener\('visibilitychange'/.test(code),
     '...and the listener comes off, or a remount stacks a second fetch on every switch');

  /* THE FIRST LOAD IS SILENT, and this is the load-bearing one. The chime
     rides the `fresh` diff, which is empty on the first poll by construction —
     so opening the dashboard on a week holding 61 paid registrations plays
     nothing rather than 61 coins. */
  const loadFn = code.slice(code.indexOf('const fresh = keys.filter'), code.indexOf('seenRef.current = new Set(keys)'));
  ok(/if \(fresh\.length\)/.test(loadFn) && /liveChime\(/.test(loadFn),
     'the chime fires inside the fresh-arrivals branch, so the first load cannot ring');
  ok(!/liveChime\(/.test(code.slice(0, code.indexOf('const fresh = keys.filter'))
       .slice(code.slice(0, code.indexOf('const fresh = keys.filter')).indexOf('function useLiveEnrollments'))),
     '...and nowhere else inside the hook ahead of that diff');
  ok(/mutedRef\.current/.test(loadFn),
     'it reads mute through a REF — a dependency would rebuild `load` and restart the poll clock');
  ok(/\.filter\(r => r && liveChimeWorthy\(r\)\)/.test(loadFn),
     'the arrivals are filtered to the paid ones before any of them rings');

  /* A BIG REGISTRATION DAY SOUNDS LIKE ONE. Dan: "When an org has a big
     registration day, I want it to sound like a las vegas casino." The
     schedule is LIFTED AND RUN, because the only checkable claim about a burst
     in a browser with no ears is the shape of it. */
  ok(/liveChimeBurst\(paid\.length\)/.test(loadFn),
     'the batch is handed to the burst scheduler whole — the cap lives in one place');
  ok(/liveChime\(kind, hit\)/.test(loadFn),
     '...and each ring carries its own level and detune');
  if (H.liveChimeBurst) {
    const { liveChimeBurst, LIVE_CHIME_MAX, LIVE_CHIME_GAP_MS, LIVE_CHIME_JITTER_MS } = H;
    const half = () => 0.5;                  // seeded: no jitter, so delays are exact
    /* EVERY INDEXED READ GOES THROUGH THIS. Shrinking the cap makes `big[3]`
       undefined, and reading `.delay` off it kills the process with a
       TypeError naming nothing — which is how this spec first reacted to the
       cap being put back to three: it DIED instead of failing by name, the
       lesson already recorded twice in these repos. */
    const hit = (b, i) => (b && b[i]) || { delay: null, level: null, detune: null };
    ok(LIVE_CHIME_MAX >= 8,
       'a busy poll rings enough times to sound busy (cap is ' + LIVE_CHIME_MAX + ')');
    ok(liveChimeBurst(0).length === 0, 'nothing arriving rings nothing');
    ok(liveChimeBurst(1).length === 1, 'one arrival rings once');
    ok(liveChimeBurst(60).length === LIVE_CHIME_MAX,
       'a flood is capped, so one poll cannot ring forever');

    /* A LONE ARRIVAL IS UNCHANGED. The duck exists for crowds; applying it to
       the common case would make every ordinary signup quieter than it was. */
    ok(hit(liveChimeBurst(1), 0).level === 1, 'a single arrival rings at full level');
    ok(hit(liveChimeBurst(1), 0).delay === 0, '...and immediately');
    ok(hit(liveChimeBurst(1), 0).detune === 0, '...and in tune');

    /* DUCKED, BUT NOT TO EQUAL LOUDNESS AND NOT BY THE BATCH SIZE. Rings at
       full gain clip and crackle, which sounds broken rather than loud — but
       ducking by the whole batch would divide a forty-ring burst by five times
       the loudness actually present, since only about eight of them ever sound
       at once. The biggest morning of the year would ring the quietest. */
    const big = liveChimeBurst(LIVE_CHIME_MAX, half);
    ok(big.every(h => h.level === hit(big, 0).level), 'one level across the burst');
    ok(hit(big, 0).level < 1, 'a burst is ducked, so a peal does not clip');
    ok(hit(big, 0).level > Math.pow(LIVE_CHIME_MAX, -0.5),
       '...but LESS than equal-loudness, so a bigger day really is louder');
    ok(liveChimeBurst(3, half)[0].level < 1, 'even three arrivals duck a little');
    ok(hit(big, 0).level > 0.25,
       'a full burst is still clearly audible per ring, not divided into nothing');
    /* THE DUCK SATURATES. This is the assertion that fails if the level is
       taken from the batch size again: past the overlap point a longer burst
       has to be LONGER, not quieter. */
    const overlap = Math.round(H.LIVE_CHIME_RING_MS / LIVE_CHIME_GAP_MS);
    ok(overlap > 1 && overlap < LIVE_CHIME_MAX,
       'the fixture actually spans the overlap point (overlap is ' + overlap + ')');
    ok(hit(liveChimeBurst(overlap + 1, half), 0).level === hit(big, 0).level,
       'a longer burst is longer, not quieter — the duck saturates at the overlap');

    /* DETUNED, or twelve identical waveforms sum coherently into ONE louder
       coin instead of into a crowd. Under a semitone, so the coin's own
       interval still sounds in tune. */
    ok(new Set(big.slice(0, 4).map(h => h.detune)).size === 4,
       'consecutive rings are detuned against each other');
    ok(big.every(h => Math.abs(h.detune) < 100),
       '...by less than a semitone, so nothing sounds out of tune');

    /* STAGGERED AND ORDERED. A burst that can schedule a later ring earlier
       than an earlier one is not a run, it is a smear. */
    ok(big.every((h, i) => i === 0 || h.delay >= hit(big, i - 1).delay),
       'the schedule never runs backwards');
    ok(hit(big, 1).delay === LIVE_CHIME_GAP_MS,
       'the gap is the configured one when the jitter is centred');
    ok(big.every(h => h.delay >= 0), 'no ring is scheduled in the past');

    /* THE LEAD RING IS EXACT. It is the one somebody reacts to, and delaying
       it by up to a jitter for nothing would make the card feel slower. */
    const jittery = liveChimeBurst(LIVE_CHIME_MAX, () => 0);   // full negative jitter
    ok(hit(jittery, 0).delay === 0, 'the first ring is never jittered');
    ok(jittery.every((h, i) => Math.abs(h.delay - i * LIVE_CHIME_GAP_MS) <= LIVE_CHIME_JITTER_MS),
       'every other ring stays within one jitter of its slot');
    ok(new Set([hit(liveChimeBurst(6, () => 0), 3).delay,
                hit(liveChimeBurst(6, () => 1), 3).delay]).size === 2,
       'the jitter actually moves a ring — an even stagger is a machine gun');
  }

  /* THE BUS IS RESTORED EVEN IF A VOICE THROWS, or one broken sound mutes
     every ring after it — the failure mode the ring/voice counter split was
     added for in the first place. */
  ok(/finally \{ _liveOut = null; _liveDetune = 0; \}/.test(code),
     'the output bus and detune are put back in a finally');

  /* MUTED BY DEFAULT, and the stored form has to make the DEFAULT the safe one:
     `!== '0'` means an absent key, an unreadable store and a private window all
     land on muted. Reading `=== '1'` would be equivalent today and would flip
     the default the first time the value written changed. */
  ok(/localStorage\.getItem\(LIVE_MUTE_KEY\) !== '0'/.test(code),
     'mute defaults ON, including when localStorage cannot be read');
  ok(/checked=\{muted\}/.test(code), 'the box reflects the state rather than being decorative');

  /* THE UNMUTE IS THE GESTURE. Browsers keep an AudioContext suspended until
     the user has interacted, so without a resume the first arrival after
     unticking is silent and the checkbox reads as broken. */
  ok(/if \(!muted\) liveAudioWake\(\)/.test(code), 'unticking Mute resumes the audio context');
  ok(/liveAudioWakeOnFirstGesture\(\)/.test(code),
     '...and a persisted unmute is woken by the first gesture after a reload, which carries none');
  ok(/\{ once: true/.test(code), '...once, not a listener left on the window for the session');

  /* NO AUDIO FILE. A sampled coin would be a redistributed recording in a
     public repo and one more asset that can 404 on a dashboard left open all
     day. The interval is what makes it recognisable, so both notes are pinned:
     B5 then E6. */
  ok(!/\.mp3|\.wav|\.ogg|new Audio\(/.test(code), 'no audio asset and no <audio> — the sound is synthesised');
  ok(/987\.77/.test(code) && /1318\.51/.test(code), 'the coin is B5 then E6');
  ok(LIVE_CHIME_NAMES.length >= 3, 'there are several sounds to choose between');
  ok(/LIVE_CHIME_DEFAULT = 'coin'/.test(code), "...and the default is the one Dan named");

  /* THE MENU AND THE SYNTH MUST BE THE SAME SET, and this is the assertion the
     voices map exists to make possible. Both halves are read out of the page,
     never transcribed here — a spec carrying its own list agrees with itself
     and nothing else.

     BOTH DIRECTIONS FAIL, because they are different bugs. A name in the menu
     with no voice falls through to the default, so picking "Cow" plays a coin —
     which is worse than silence, since it looks like it worked. A voice nothing
     lists is unreachable code that nobody can hear. */
  const LIVE_CHIME_VOICE_KEYS = (() => {
    const m = code.match(/const LIVE_CHIME_VOICES = \{([\s\S]*?)\n\};/);
    return m ? (m[1].match(/^  ([a-z]+)\(ctx, t\) \{/gm) || []).map(x => x.trim().split('(')[0]) : [];
  })();
  ok(LIVE_CHIME_VOICE_KEYS.length > 0, 'the voices map was found at all — otherwise the next two are vacuous');
  const missingVoice = LIVE_CHIME_NAMES.filter(n => !LIVE_CHIME_VOICE_KEYS.includes(n));
  const unlistedVoice = LIVE_CHIME_VOICE_KEYS.filter(k => !LIVE_CHIME_NAMES.includes(k));
  ok(missingVoice.length === 0,
     'every sound in the menu has a voice — no voice for: ' + missingVoice.join(', '));
  ok(unlistedVoice.length === 0,
     'every voice is offered in the menu — unreachable: ' + unlistedVoice.join(', '));
  ok(LIVE_CHIME_VOICE_KEYS.includes(LIVE_CHIME_DEFAULT_NAME),
     'the DEFAULT has a voice — it is what an unknown stored name falls back to');
  ok(/LIVE_CHIME_VOICES\[kind\] \|\| LIVE_CHIME_VOICES\[LIVE_CHIME_DEFAULT\]/.test(code),
     '...and an unknown stored name rings the default rather than nothing');

  /* THE FIVE DAN ASKED FOR SECOND. Named individually, because "there are nine
     sounds" passes just as happily on nine chiptune beeps. */
  ['horn', 'chicken', 'cow', 'sheep', 'foghorn'].forEach(n => {
    ok(LIVE_CHIME_NAMES.includes(n), 'the menu offers ' + n);
  });

  /* AN ANIMAL IS A PITCH CONTOUR, NOT A NOTE. These three are what separate the
     five from a row of beeps, and each one is a thing that was got wrong first:
     without the glide a moo is a flat hum, without the LFO on FREQUENCY a bleat
     is a stutter, and without the noise burst a cluck is a bird toy. */
  ok(/exponentialRampToValueAtTime\(to, at \+ dur\)/.test(code),
     'liveVoice glides between two pitches');
  ok(/lg\.connect\(o\.frequency\)/.test(code),
     'the wobble drives FREQUENCY, not gain — a gain LFO is a tremolo, not a bleat');
  ok(/createBufferSource\(\)/.test(code) && /type = 'bandpass'/.test(code),
     'there is a filtered noise burst — no oscillator can make the front of a cluck');
  ok(/if \(_liveNoiseBuf\) return _liveNoiseBuf;/.test(code),
     '...and its buffer is built once, not per ring');
  ok(/from: 440\.00[\s\S]{0,200}from: 554\.37/.test(code),
     'the car horn is a DYAD (A4 + C#5) — one reed alone is a buzzer');

  /* FORMANTS ARE WHAT MAKE A VOICE A VOICE. A moo and a bleat are a buzzing
     source played through a resonant tube, and the tube's peaks are what the
     ear reads as an animal rather than an oscillator — the first pass at these
     used a lowpass alone and sounded like a dull sawtooth.

     PARALLEL AND SUMMED, never chained: two narrow bandpasses in series barely
     overlap and multiply down to near silence, so the sound would all but
     vanish. That is the mutation this pins. */
  ok(/formants\.forEach/.test(code) && /bg\.connect\(sum\)/.test(code),
     'the formants are summed in PARALLEL — chaining two narrow bands is silence');
  ['cow', 'sheep', 'chicken'].forEach(n => {
    const v = (code.match(new RegExp('\\n  ' + n + '\\(ctx, t\\) \\{[\\s\\S]*?\\n  \\},')) || [''])[0];
    ok(/formants:/.test(v), n + ' is voiced through formants, not a bare lowpass');
  });

  /* THE PICKER CANNOT OUTLIVE THE SOUND. A menu of sounds beside a ticked Mute
     box is a control that does nothing. */
  ok(/\{muted \|\| !sound \? null : \(/.test(code),
     'the sound menu is hidden while muted');
  ok((code.match(/data-live-mute="1"/g) || []).length === 1,
     'one mute box in one shared header — two copies is how Pause and the bolt drifted');
}

/* ── the trend arrow ────────────────────────────────────────────────────────
   Laurel's "youth winter basketball is not really catching right now" — the
   number says how many, the arrow says whether it is still moving. RUN, never
   regexed: a regex over a comparison passes just as happily on an inverted
   one. */
if (H.liveProgramTrend && H.liveDayShift) {
  const T = H.liveProgramTrend, S = H.liveDayShift;

  // Day keys are built from PARTS, so a month boundary has to roll over.
  eq(S('2026-09-03', 1), '2026-09-02', 'a day key shifts back one day');
  eq(S('2026-09-01', 1), '2026-08-31', '...and rolls over a month boundary');
  eq(S('2026-01-01', 1), '2025-12-31', '...and a year boundary');
  eq(S('', 1), '', 'a missing day key yields nothing rather than a bogus date');

  const today = '2026-09-10';
  // recent = 9th, 8th, 7th   prior = 6th, 5th, 4th
  const rising  = { '2026-09-09': 5, '2026-09-08': 4, '2026-09-07': 3,
                    '2026-09-06': 1, '2026-09-05': 1, '2026-09-04': 1 };
  const falling = { '2026-09-09': 1, '2026-09-08': 0, '2026-09-07': 1,
                    '2026-09-06': 6, '2026-09-05': 5, '2026-09-04': 4 };
  const flat    = { '2026-09-09': 2, '2026-09-08': 2, '2026-09-07': 2,
                    '2026-09-06': 2, '2026-09-05': 2, '2026-09-04': 2 };

  /* READ THROUGH A SAFE ACCESSOR. A mutation that shifts the day keys makes
     every fixture fall under the floor, so `T(...)` returns null and a bare
     `.dir` THREW — the spec died on a stack trace naming nothing instead of
     failing on the assertion that provoked it. That is the "a guard that dies
     instead of failing has not told anyone what broke" lesson, and it has now
     bitten both these repos several times. */
  const at = (t, k) => (t == null ? '(no trend at all)' : t[k]);

  eq(at(T(rising,  today), 'dir'), 'up',   'a programme taking more signups than last week reads UP');
  eq(at(T(falling, today), 'dir'), 'down', "...and one that has stopped catching reads DOWN (Laurel's basketball)");
  eq(at(T(flat,    today), 'dir'), 'flat', '...and an unchanged one is flat, not up');
  eq(at(T(rising,  today), 'recent'), 12, 'the recent half counts the three complete days before today');
  eq(at(T(rising,  today), 'prior'),   3, '...and the prior half the three before those');
  eq(at(T(rising,  today), 'pct'),   300, 'the percentage is against the prior half');

  /* TODAY IS EXCLUDED — the whole correctness rule. A partial day counted
     against three full ones makes EVERY programme read as declining. This
     fixture puts a huge count on today; if it were counted, `rising` would
     still be up but `flat` would swing. */
  const withToday = Object.assign({}, flat, { '2026-09-10': 99 });
  eq(at(T(withToday, today), 'dir'), 'flat', "today's partial count is excluded from the comparison");
  eq(at(T(withToday, today), 'recent'), 6, '...and does not inflate the recent half');

  /* THE SEVENTH DAY BACK IS OUT OF RANGE. The feed carries seven calendar days
     ending today, so only six are complete and a stray older row must not be
     counted into the prior half. */
  const older = Object.assign({}, flat, { '2026-09-03': 50 });
  eq(at(T(older, today), 'prior'), 6, 'a day outside the two halves is not counted');

  /* A FLOOR: a direction is not a trend. One signup against none is "up 100%"
     and means nothing. */
  ok(T({ '2026-09-09': 1 }, today) === null, 'under the floor there is no arrow at all');
  ok(T({}, today) === null, 'a programme with no signups in either half has no arrow');
  ok(T(flat, '') === null, 'without a known day there is no arrow');

  /* A ZERO BASE HAS NO PERCENTAGE. Four signups against a week of none is real
     news and is NOT "+400%" — there is no base to be a percentage of. */
  const fresh = { '2026-09-09': 2, '2026-09-08': 2 };
  eq(at(T(fresh, today), 'dir'), 'up', 'a programme with signups only in the recent half is up');
  ok(T(fresh, today) != null && T(fresh, today).pct === null,
     '...and its percentage is null, never a number off a zero base');
}

/* The cell has to READ the trend, and the arrow has to be absent when there is
   none — a flat dash pretending to be a measurement is the confident-zero bug
   this codebase keeps writing down. */
{
  /* SCOPED TO THE PROGRAMS TABLE'S CELL. `className="lp"` is also the
     PARTICIPANT cell in the enrollments table above, and a non-greedy match
     finds that one first — so this anchors on the attribute only this cell
     has. The first draft matched the wrong table and failed on correct code. */
  const cell = (code.match(/<td className="lp" data-live-prog-trend[\s\S]*?<\/td>/) || [''])[0];
  ok(/data-live-prog-trend=/.test(cell), 'the signups cell exposes the trend for a render case');
  ok(/g\.trend \? \(/.test(cell), '...and renders the arrow only when there IS a trend');
  ok(/today is excluded/.test(cell), '...and the tooltip says today is excluded, since that is why it can differ from the count');
  ok(/liveProgramTrend\(g\.dayCounts, today\)/.test(code),
     'the grouping computes the trend from its own per-day tally');
  /* DOWN CARRIES THE COLOUR, up and flat are muted — and neither reuses the
     green/orange the price column spends on payment state. */
  ok(/\.live-trend-down \{ color: #b45309/.test(code), 'down is the emphasised direction');
  ok(/\.live-trend-up   \{ color: var\(--text-muted\)/.test(code), '...and up is muted, not a second green');
}



/* THE REPORT RUNS ON EXIT, and that is a structural fix rather than a rule to
   remember. It used to be a plain `if (failures.length)` near the end, on the
   understanding that nothing would ever be appended below it — and that
   understanding failed TWICE. The first time a block sat above it and printed
   a clean 146 with one assertion failing; the second time (2026-09-05) an
   appended check-ins block sat BELOW it, so its 34 assertions ran, incremented
   `pass`, recorded two genuine failures under a mutation, and the spec printed
   "✓ 305 assertions passed". A mutation that survives because the report never
   reached the console is worse than no guard at all.

   An exit handler cannot be appended past. `process.exitCode` rather than
   `process.exit`, so the handler is allowed to finish writing. */
process.on('exit', () => {
  if (failures.length) {
    console.error('\n✗ live-widgets.spec.js — ' + failures.length + ' failure(s):\n');
    failures.forEach(f => console.error('  ✗ ' + f));
    console.error('\n' + pass + ' passed, ' + failures.length + ' failed.\n');
    process.exitCode = 1;
  } else {
    console.log('✓ live-widgets.spec.js — ' + pass + ' assertions passed.');
  }
});


/* ── MEMBERSHIP CHECK-INS ─────────────────────────────────────────────────*/
{
  if (H.liveCheckinState) {
    const { liveCheckinState, liveInitials, liveCheckinKey, liveDayAxis, liveCheckinTimeline } = H;

    /* A DENIAL IS NOT ATTENDANCE. Anything counting attendance must filter on
       this, or a member the desk turned away is reported as having come in —
       the facility Summary counting invoice fee lines as bookings, one report
       over. Lifted and RUN, because a regex passes on an inverted comparison. */
    ok(liveCheckinState({ Status: 'Failed' })     === 'failed', 'a refused scan reads failed');
    ok(liveCheckinState({ Status: 'Checked In' }) === 'ok',     'an accepted scan reads ok');
    /* A ROW WITH NO STATUS IS AN ACCEPTED SCAN, and this is the dangerous one:
       testing `=== 'Checked In'` instead would make every row of a pre-column
       feed — including every warm cache entry — read as a refusal, and the
       card would report the whole day as turned away. Same rule as ciIsFailed
       in the sibling repo. */
    ok(liveCheckinState({})                       === 'ok',     'a row with no Status is a check-in, not a refusal');
    ok(liveCheckinState({ Status: 'failed' })     === 'ok',     '...and the comparison is exact, not case-folded guessing');

    /* THE HEADLINE COUNTS ACCEPTED SCANS ONLY. */
    ok(/const okRows   = todayRows\.filter\(r => liveCheckinState\(r\) === 'ok'\)/.test(code),
       'the check-in count is accepted scans, never every row');
    ok(/data-live-ci-today=\{String\(okRows\.length\)\}/.test(code),
       '...and that is the number on screen');
    /* REFUSALS ARE SHOWN, NOT HIDDEN — they are the interesting rows — but
       counted separately and named. */
    ok(/turned away/.test(code), 'refusals are named on screen rather than folded into the count');
    /* AND NO REASON IS INVENTED. side_effects is empty on all 58 denials
       platform-wide, and of 52 membership refusals only 5 had an expired,
       unstarted or cancelled membership — so a "Reason" column would be
       fabrication sitting beside real rows. */
    ok(!/Reason/.test(code.slice(code.indexOf('function MembershipCheckins'),
                                 code.indexOf('function LiveSection'))),
       'no reason for a refusal is invented — the log records none');

    /* INITIALS ARE THE DESIGN AND THE PHOTO SLOTS INTO THEM: only 7.5% of the
       33,239 members who checked in over 90 days have an image, and it is
       bimodal (Clarkstown 94.7%, Apex 2.2%), so a photo-first row is a wall of
       holes at most orgs. */
    ok(liveInitials('Ada Lovelace')       === 'AL', 'two names give two initials');
    ok(liveInitials('Prince')             === 'P',  'one name gives one');
    ok(liveInitials('  ada   b lovelace ')=== 'AL', '...taken from the FIRST and LAST, not the first two');
    ok(liveInitials('')                   === '?',  'a nameless row still renders a face');
    ok(liveInitials(null)                 === '?',  '...and so does a null one');
    ok(/<em>\{liveInitials\(nm\)\}<\/em>/.test(code) && /r\['Photo'\]\s*\n?\s*\?\s*<img/.test(code),
       'the photo sits OVER the initials rather than replacing them');
    ok(/onError=\{e => \{ e\.target\.style\.display = 'none'; \}\}/.test(code),
       'a broken image URL falls back to the initials, not to a torn-page glyph');

    /* THE LINK TAKES THE UUID. "Member ID" is users.rec_id, the six-character
       code staff read at a desk — it looks identical in a link and 404s. */
    ok(/liveUserUrl\(recOrgId, r\['User ID'\]\)/.test(code),
       "the member link is built from User ID, the uuid — never Member ID");
    ok(!/liveUserUrl\(recOrgId, r\['Member ID'\]\)/.test(code),
       '...and never from the desk code');

    /* ONE AXIS, TWO LANES. The two cards sit one above the other, so a noon
       that is not in the same place on both is a defect a reader sees at once
       — and two copies of the arithmetic is how that happens. */
    const ax = liveDayAxis('2026-09-05');
    ok(ax.tickLabels.length === 6, 'the axis is a fixed 24 hours in 4-hour ticks');
    ok(ax.tickLabels[0].text === '12a' && ax.tickLabels[3].text === '12p',
       '...labelled in 12-hour clock');
    ok(ax.span === 24 * 3600 * 1000, '...and one day wide');
    ok(/const ax = liveDayAxis\(today\);/.test(code.slice(code.indexOf('function liveTimeline'))),
       'the registrations lane reads the shared axis');
    ok((code.match(/liveDayAxis\(/g) || []).length >= 3,
       '...and so does the check-ins lane, off the same function');

    /* A SCAN'S IDENTITY. A household of five scanning together really does
       produce same-second rows, so a key of time alone would collapse them
       into one and the card would under-count a family. */
    const fam = t => ({ 'Checked In At': t, 'User ID': 'u1', 'Desk Location': 'Front', Product: 'Adult' });
    ok(liveCheckinKey(fam('2026-09-05T09:00:00')) !== liveCheckinKey({ ...fam('2026-09-05T09:00:00'), 'User ID': 'u2' }),
       'two people scanning in the same second are two rows');
    ok(liveCheckinKey(fam('2026-09-05T09:00:00')) === liveCheckinKey(fam('2026-09-05T09:00:00')),
       '...and the same scan read twice is one');

    /* THE LANE DRAWS TODAY ONLY, and colours by acceptance rather than money. */
    const rows = [
      { 'Checked In At': '2026-09-05T09:00:00', Member: 'A', Status: 'Checked In', 'User ID': 'a', 'Desk Location': 'F', Product: 'P' },
      { 'Checked In At': '2026-09-05T18:00:00', Member: 'B', Status: 'Failed',     'User ID': 'b', 'Desk Location': 'F', Product: 'P' },
      { 'Checked In At': '2026-09-04T09:00:00', Member: 'C', Status: 'Checked In', 'User ID': 'c', 'Desk Location': 'F', Product: 'P' },
    ];
    const tl = liveCheckinTimeline(rows, '2026-09-05');
    ok(tl.marks.length === 2, "yesterday's scans are not drawn on today's lane");
    ok(tl.marks[0].state === 'ok' && tl.marks[1].state === 'failed',
       'a refusal is marked as one rather than as an ordinary scan');
    ok(Math.round(tl.marks[0].left) === 38 && Math.round(tl.marks[1].left) === 75,
       '...and each sits at its own hour (9am and 6pm)');
    ok(liveCheckinTimeline(rows, '').marks.length === 0,
       'no day, no lane — a feed that has not answered draws nothing');
  }

  /* NO SOUND ON THIS CARD, deliberately: the chime says "somebody just gave
     you money", and a beep on every desk scan would train a busy gym to mute
     the section and lose the registrations chime with it. */
  const ciCard = code.slice(code.indexOf('function MembershipCheckins'), code.indexOf('function LiveSection'));
  ok(!/sound/.test(ciCard), 'the check-ins card offers no sound');

  /* THE WINDOW IS TWO DAYS, NOT ONE. `liveWindow` builds dates in the VIEWER's
     zone and the card windows on the ORG's, so a one-day window asks for a
     date the org has not reached yet once it is tomorrow for the viewer — and
     the card comes back empty. Measured against the live card: today's window
     returned 0 rows at apex and el-segundo while the previous day returned
     1,150 and 198. */
  ok(/const w = liveWindow\(2\);/.test(code),
     'the check-ins feed asks for two days, so an org behind the viewer is never empty');
  ok(/const today = rows\.length \? liveDay\(rows\[0\]\['Checked In At'\]\) : ''/.test(code),
     "...and TODAY is the newest row's own org-timezone day, never the viewer's clock");

  /* NO CARD, NO REQUEST. Polling a 404 every sixty seconds for every org
     without a public link is a self-inflicted error rate that reads exactly
     like a broken feed in the logs. */
  ok(/if \(!enabled\) \{ setLoading\(false\); if \(onAvailable\) onAvailable\(false\); return; \}/.test(code),
     'the check-ins feed does not fetch when the org has no such card');
  ok(/if \(paused \|\| !enabled\) return;/.test(code),
     '...and does not start a poll clock either');

  /* THE TWO HOOKS MUST NOT DRIFT on the two things that were just fixed. A
     feed that keeps serving a stale answer, or one that sleeps through a
     backgrounded tab, is the bug Dan reported — and it would be invisible if
     only one of the two carried the fix. */
  ok((code.match(/document\.addEventListener\('visibilitychange', onVis\)/g) || []).length === 2,
     'BOTH live feeds refetch when the tab becomes visible');
  ok((code.match(/const t = setInterval\(load, LIVE_POLL_MS\);/g) || []).length === 2,
     '...and both poll on the same clock');
  ok((code.match(/document\.removeEventListener\('visibilitychange', onVis\)/g) || []).length === 2,
     '...and both take the listener off again');
}

