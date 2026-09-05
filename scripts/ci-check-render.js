#!/usr/bin/env node
/**
 * CI guard: the dashboard must actually RENDER in a browser.
 *
 * THIS REPO HAD NO RENDER CHECK. Its sibling, rental-report, shipped TWO blank
 * pages before adding one — both times a derived value computed above the
 * `const` it read, which in source is a temporal dead zone but which
 * in-browser Babel compiles to `var`: instead of a ReferenceError naming the
 * identifier, you get `undefined` and a TypeError two lines later. The page
 * still returns HTTP 200 with a complete document and renders a blank area.
 *
 * Nothing else here can see that. `node --check server.js` passes (the page is
 * a separate file). `ci-check-html.js` passes (the block PARSES; it only throws
 * when RUN). Every spec passes (none of them mount a component). Parsing is not
 * running, and a page can only be proven to render by rendering it.
 *
 * Hermetic: a static server for public/, and every /api/ request answered from
 * FIXTURES below — so it never touches Metabase, never varies with live data,
 * and cannot fail because a card is slow.
 *
 * The CDN bundles (React, Babel, Chart.js, Leaflet) are cached under
 * node_modules/.cache/render-check and fetched once with curl, which honours
 * the sandbox proxy where Chromium's own requests do not. Without them every
 * page is blank — the exact symptom this looks for — so a failed fetch says so
 * rather than reporting a false failure.
 *
 * Run: node scripts/ci-check-render.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 4187;
const ORG = 'rendercheck';
const TOKEN = 'rendercheck-token';

// puppeteer is DELIBERATELY NOT IN package.json. It is not used at runtime, and
// declaring it made Railway's `npm ci` fail against the unchanged lockfile —
// then, once that was fixed, it would have had every production deploy download
// a ~150MB browser it never opens. CI installs it on demand instead
// (`npm install --no-save puppeteer@22`), and this sandbox resolves the sibling
// checkout that already has one.
//
// NEVER make a missing browser a silent skip — a render check that opts out when
// it cannot find one defeats its entire purpose, and the failure it exists to
// catch is invisible to every other check in this repo.
let puppeteer;
for (const cand of ['puppeteer', '/home/user/rental-report/node_modules/puppeteer',
                    path.join(process.env.HOME || '', 'rental-report/node_modules/puppeteer')]) {
  try { puppeteer = require(cand); break; } catch (e) { /* next */ }
}
if (!puppeteer) {
  console.error('puppeteer not available — cannot prove the page renders. '
    + 'CI installs it with `npm install --no-save puppeteer@22`; do not skip this check.');
  process.exit(1);
}

// ── CDN bundles, fetched once ───────────────────────────────────────────────
const CDN = {
  'react.js': 'https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js',
  'react-dom.js': 'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js',
  'babel.js': 'https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.9/babel.min.js',
  'chart.js': 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'leaflet.js': 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
};
const CACHE = path.join(ROOT, 'node_modules', '.cache', 'render-check');
fs.mkdirSync(CACHE, { recursive: true });
for (const [file, url] of Object.entries(CDN)) {
  const dest = path.join(CACHE, file);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) continue;
  try {
    execFileSync('curl', ['-fsSL', '--max-time', '90', '-o', dest, url], { stdio: 'pipe' });
  } catch (e) {
    console.error('could not fetch ' + url + '\nThis check proves nothing without the bundles — '
      + 'every page would come up blank, which is exactly the symptom it looks for.');
    process.exit(1);
  }
}

// ── The feed, shaped to exercise every rule the widgets encode ──────────────
// Passes OUTNUMBER memberships, as they do at Norman; one plan holds the
// auto-renew book; one member is scheduled to leave at period end.
function memRow(o) {
  return Object.assign({
    'User ID': 'u1', 'First Name': 'A', 'Last Name': 'B', 'Email': 'a@b.c',
    'Status': 'active', 'Product Kind': 'membership', 'Group / Plan': 'Monthly Individual',
    'Membership Type': 'Individual', 'Price': '20', 'Paid': '20', 'Net Collected': '20',
    'Auto Renew': false, 'Renewal Type': 'one-time', 'Start Date': '2026-01-01',
    'Period Start': null, 'Next Renewal': null, 'Canceled At': null, 'Cancel Scheduled At': null,
  }, o);
}
const MEMBERSHIPS = [
  ...Array.from({ length: 6 }, () => memRow({ 'Auto Renew': true, 'Renewal Type': 'auto',
    'Period Start': '2026-07-01', 'Next Renewal': '2026-08-01' })),
  memRow({ 'Auto Renew': true, 'Renewal Type': 'auto', 'Cancel Scheduled At': '2026-08-01',
    'Period Start': '2026-07-01', 'Next Renewal': '2026-08-01' }),
  memRow({ 'Auto Renew': true, 'Renewal Type': 'auto', 'Status': 'canceled',
    'Canceled At': '2026-07-15', 'Period Start': '2026-07-01' }),
  memRow({ 'Group / Plan': '2026 Season Pass', 'Net Collected': '224', 'Paid': '224' }),
  ...Array.from({ length: 11 }, () => memRow({ 'Product Kind': 'pass',
    'Group / Plan': 'League Tournament Gate Adult', 'Net Collected': '5', 'Paid': '5' })),
];

/* THE SIGNUP FEED behind the Coffee Counter. Dates are built RELATIVE TO TODAY
   on purpose: the widget's sparkline is one bar per day across the last seven,
   so a fixture with hardcoded dates draws seven empty bars and every bar
   assertion becomes vacuous.
   THREE ROWS SHARE THE NEWEST DAY and two do not, so "signups today" is 3 and
   not the row count — a widget printing the total passes on a single-day
   fixture. */
function liveIso(daysAgo, clock) {
  const t = new Date();
  const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() - daysAgo);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-'
       + String(d.getDate()).padStart(2, '0') + 'T' + clock;
}
const ENROLLMENTS = [
  { 'Signed Up At': liveIso(0, '14:41:48'), 'Customer Name': 'Rita Perri', 'Participant': null,
    'User ID': 'user-rita', 'Section Id': 'sec-oxygen',
    'Section': 'Play on 60+ Beginner Oxygen Dance', 'Program': 'Oxygen Dance Aerobics', 'Price': 25, 'Paid': 25 },
  /* A CHILD REGISTERED BY A PARENT, TODAY, WITH THE BUYER'S UUID. The other
     child rows in this fixture carry no User ID (they are the plain-text
     branch), and the one that did — Kaitlin/Cecelia — is dated YESTERDAY, so
     it stopped rendering when the card narrowed to today. Without an id here
     the household-link case would have had nothing to key on. */
  { 'Signed Up At': liveIso(0, '13:06:40'), 'Customer Name': 'Ryan Little', 'Participant': 'Brayden Little',
    'User ID': 'user-ryan',
    'Section': 'Boys (Grades 4-5) Tryouts', 'Program': 'SBA Travel Teams', 'Price': 25 },
  /* PART-PAID, and it has to be HIGH IN THE LIST: only the newest eight rows
     render, and the other part-paid row (Swim Lessons) sits ninth — so the
     orange-price assertion had nothing to read. A payment plan among the first
     three rows is what makes that case discriminating. */
  { 'Signed Up At': liveIso(0, '11:35:00'), 'Customer Name': 'Nicole Baldarelli', 'Participant': 'Cameron Baldarelli',
    'Section': 'Music, Movement & Sensory Play', 'Program': 'Music, Movement & Sensory Play',
    'Price': 60, 'Paid': 25 },
  /* A PAYMENT PLAN THAT HAS COLLECTED NOTHING YET — Jan Denner's real shape.
     Dan: "I enrolled in a payment plan section for Jan Denner, it was $5 due
     as a future installment, but I paid $0 now. I'd expect that to show $5 in
     orange, with the price showing $0/$5, denoting a payment plan. Also the
     dot for that should be orange, not grey."

     PRICE 5 / PAID 0 IS BYTE FOR BYTE THE UNPAID ROW two entries down, and
     that is the entire point: only card 21286 v4's "On Plan" column separates
     them, so a build that ignores it renders a perfectly plausible grey dot
     and a bare "$5". Placed above Nicole Baldarelli so both part-paid shapes
     are inside the newest eight and can be told apart by their PAID figure. */
  { 'Signed Up At': liveIso(0, '12:10:00'), 'Customer Name': 'Jan Denner', 'Participant': null,
    'User ID': 'user-jan', 'Section Id': 'sec-demo',
    'Section': 'Demo Program Template', 'Program': 'Demo Program Template',
    'Price': 5, 'Paid': 0, 'On Plan': true, 'Plan Installments': 2, 'Plan Installments Paid': 0 },
  /* YESTERDAY, and LATER IN THE DAY than the row above it — which is exactly
     what made the list look unsorted: a column showing only a clock cannot say
     that 8:15p was yesterday. This row is what proves the weekday prefix. */
  /* A SECOND signup on SBA Travel Teams, EARLIER in the day. Without it every
     programme in this fixture has exactly one registration, and a Programs
     Live card sorted by size would render identically to one sorted by
     recency — plausible, but unable to tell the two apart. */
  { 'Signed Up At': liveIso(0, '06:12:00'), 'Customer Name': 'Early Bird', 'Participant': 'Wren Bird',
    'Section': 'Boys (Grades 4-5) Tryouts', 'Program': 'SBA Travel Teams', 'Price': 25, 'Paid': 25 },
  /* A FREE REGISTRATION, TODAY. Dan, on Lesline Mullings' Trunk or Treat:
     "we're picking up free registrations, which is fine, but we should call
     them 'Free' on the card, not 'not yet paid'." Priced at 0 and paid 0 —
     which is exactly what the card emits for a comped booking, because it
     COALESCEs both figures. No source assertion can tell "Free" from a dash;
     only the rendered cell can. */
  { 'Signed Up At': liveIso(0, '18:39:00'), 'Customer Name': 'Lesline Mullings', 'Participant': null,
    'User ID': 'user-lesline', 'Section Id': 'sec-trunk',
    'Section': 'Trunk or Treat', 'Program': 'Community Events', 'Price': 0, 'Paid': 0 },
  { 'Signed Up At': liveIso(1, '20:15:37'), 'Customer Name': 'Kaitlin Gentile', 'Participant': 'Cecelia Gentile',
    'User ID': 'user-kaitlin', 'Section Id': 'sec-girls78',
    'Section': 'Girls Grades 7-8', 'Program': 'Shrewsbury Rec Youth Basketball', 'Price': 170, 'Paid': 0 },
  { 'Signed Up At': liveIso(3, '09:02:00'), 'Customer Name': 'Zaid Syed', 'Participant': null,
    'Section': 'Apple Picking', 'Program': 'Rec Connect Fall', 'Price': 30 },
  /* TEN MORE PROGRAMS TODAY, and they are load-bearing three ways.
     (1) The programs card caps at LIVE_PROG_ROWS = 10, and with three programs
         a cap of 8 and a cap of 10 render identically.
     (2) SUMMER CAMP HOLDS THE MOST MONEY AND IS NOT THE MOST RECENT — Oxygen
         Dance is, at 14:41. So a revenue sort and a recency sort put different
         rows on top, which is the only way an assertion can tell them apart.
     (3) Swim Lessons is charged $480 with $240 in: the PART-PAID state, which
         nothing else in this fixture produces, and the orange dot cannot be
         proven without it. */
  /* TWO PROGRAMMES WITH A REAL DAY SPREAD, because every other row in this
     fixture lands today and a card with no history renders no arrow at all —
     the trend cases would pass on a build that never computes one.

     THESE ARE LAUREL'S TWO CASES, deliberately opposite. Winter Basketball has
     stopped catching (6 signups in the older half, 1 in the recent) and
     Fall Volleyball is climbing (1 then 6), so a build with the direction
     inverted renders both and fails on WHICH. They are priced to rank inside
     the ten-row cap, or they would not render to be asserted on. */
  ...[
    ...[[1, 1]].flatMap(([d, n]) => Array.from({ length: n }, (_, k) => ({
      'Signed Up At': liveIso(d, '09:0' + k + ':00'), 'Customer Name': 'Hoops Parent ' + d + k,
      'Participant': 'Hoops Kid ' + d + k, 'Section': 'Youth Winter Basketball AM',
      'Program': 'Youth Winter Basketball', 'Price': 100, 'Paid': 100 }))),
    ...[[4, 2], [5, 2], [6, 2]].flatMap(([d, n]) => Array.from({ length: n }, (_, k) => ({
      'Signed Up At': liveIso(d, '09:1' + k + ':00'), 'Customer Name': 'Hoops Parent ' + d + k,
      'Participant': 'Hoops Kid ' + d + k, 'Section': 'Youth Winter Basketball AM',
      'Program': 'Youth Winter Basketball', 'Price': 100, 'Paid': 100 }))),
    ...[[1, 2], [2, 2], [3, 2]].flatMap(([d, n]) => Array.from({ length: n }, (_, k) => ({
      'Signed Up At': liveIso(d, '10:0' + k + ':00'), 'Customer Name': 'Net Parent ' + d + k,
      'Participant': 'Net Kid ' + d + k, 'Section': 'Fall Volleyball AM',
      'Program': 'Fall Volleyball', 'Price': 100, 'Paid': 100 }))),
    ...[[5, 1]].flatMap(([d, n]) => Array.from({ length: n }, (_, k) => ({
      'Signed Up At': liveIso(d, '10:1' + k + ':00'), 'Customer Name': 'Net Parent ' + d + k,
      'Participant': 'Net Kid ' + d + k, 'Section': 'Fall Volleyball AM',
      'Program': 'Fall Volleyball', 'Price': 100, 'Paid': 100 }))),
  ],
  ...[
    ['Summer Camp',   900, 900, '07:05:00'],
    /* THE ONE FILLER WITH A SECTION ID, and it has to be one that RANKS: the
       card shows the top ten by revenue, so Oxygen Dance ($25, the other row
       carrying an id) sorts thirteenth and never renders. That is what the
       first draft of the link case keyed on, and it failed for that reason
       rather than because the link was broken. */
    ['Swim Lessons',  480, 240, '07:10:00', 'sec-swim'],
    ['Gymnastics',    300, 300, '07:15:00'],
    ['Soccer Clinic', 260,   0, '07:20:00'],
    ['Ceramics',      220, 220, '07:25:00'],
    ['Chess Club',    180, 180, '07:30:00'],
    ['Yoga Basics',   140, 140, '07:35:00'],
    ['Track & Field', 100, 100, '07:40:00'],
    ['Cooking 101',    80,  80, '07:45:00'],
    ['Story Time',     70,  70, '07:50:00'],
  ].map(([program, price, paid, clock, secId]) => ({
    'Signed Up At': liveIso(0, clock), 'Customer Name': program + ' Buyer',
    'Participant': program + ' Kid', 'Section': program + ' AM',
    'Section Id': secId, 'Program': program, 'Price': price, 'Paid': paid,
  })),
];

/* THE HISTORY THE ROLLUP CARD RETURNS — one row per (day x section), COMPLETE
   days only. Built so the merge is observable rather than plausible:

     * "SBA Travel Teams AM" has both history AND signups today, so its board
       row proves the two halves are ADDED rather than one chosen over the other;
     * "Long Gone" has history and NOTHING today, so it proves a section is not
       dropped from a board headed "last 7 days" merely because nobody joined
       this morning — the failure a today-only leaderboard would show;
     * every Day is in the past, because the card cannot emit today and a
       fixture that broke that rule would be testing something the feed can
       never produce. */
const ROLLUP = [
  /* ONTO `sec-swim`, WHICH ALREADY HAS A ROW TODAY — the same section id the
     detail fixture carries, so the two halves land in one group through
     liveSectionKey and the addition is what the board prints. Swim also ranks:
     the card shows the top ten by revenue, and a fixture section that sorts
     eleventh never renders, which is a trap this file has already been caught
     by once. */
  { Day: liveIso(1, '00:00:00').slice(0, 10), 'Section Id': 'sec-swim', Section: 'Swim Lessons AM',
    Program: 'Swim Lessons', Signups: 7, Charged: 700, Paid: 700, 'Last At': liveIso(1, '18:00:00') },
  { Day: liveIso(2, '00:00:00').slice(0, 10), 'Section Id': 'sec-swim', Section: 'Swim Lessons AM',
    Program: 'Swim Lessons', Signups: 3, Charged: 300, Paid: 300, 'Last At': liveIso(2, '12:00:00') },
  /* HISTORY AND NOTHING TODAY, priced high enough to rank — otherwise "it was
     dropped" and "it sorted out of the top ten" look identical. */
  { Day: liveIso(3, '00:00:00').slice(0, 10), 'Section Id': 'sec-gone', Section: 'Long Gone',
    Program: 'Long Gone', Signups: 5, Charged: 5000, Paid: 5000, 'Last At': liveIso(3, '09:00:00') },
];

/* THE SECOND POLL BRINGS ONE MORE. A widget that highlights arrivals can only
   be tested against a feed that CHANGES — with a constant payload the
   highlight is indistinguishable from no highlight at all. This row is newest,
   so it lands at the top, and it is the ONLY one that may light up. */
const ENROLL_ARRIVAL = { 'Signed Up At': liveIso(0, '23:59:01'), 'Customer Name': 'Newly Arrived',
  'Participant': 'Kid Arrived', 'Section': 'Just Registered', 'Program': 'Just Registered', 'Price': 42 };
/* EVERY REFRESH DELIVERS ONE PAID AND ONE UNPAID ARRIVAL, so the chime can be
   OBSERVED rather than assumed. A browser has no ears and this container has no
   audio device, so the only way to tell a chime wired to "a paid arrival" from
   one wired to "any arrival" is to hand it one of each in the SAME diff and
   require exactly one ring.

   A PAIR PER CALL, not a fixed script: the first draft prepended the pair on
   one specific call number, and the muted case — which refreshes twice —
   consumed it, so by the time the sound was on there was nothing new left to
   ring for and a passing-looking 0 meant nothing. Accumulating means the case
   order cannot starve the case that matters. */
let enrollCalls = 0;
const enrollExtra = [];
function enrollArrivals() {
  if (enrollCalls <= 1) return [];
  if (enrollCalls === 2) { enrollExtra.unshift(ENROLL_ARRIVAL); return enrollExtra.slice(); }
  const n = enrollCalls;
  enrollExtra.unshift(
    { 'Signed Up At': liveIso(0, '23:5' + (n % 10) + ':4' + (n % 10)), 'Customer Name': 'Unpaid ' + n,
      'Participant': 'Kid U' + n, 'Section': 'Unpaid Section ' + n, 'Program': 'Unpaid Program',
      'Price': 60, 'Paid': 0 },
    { 'Signed Up At': liveIso(0, '23:5' + (n % 10) + ':5' + (n % 10)), 'Customer Name': 'Paid ' + n,
      'Participant': 'Kid P' + n, 'Section': 'Paid Section ' + n, 'Program': 'Paid Program',
      'Price': 60, 'Paid': 60 });
  return enrollExtra.slice();
}

/* ── MEMBERSHIP CHECK-INS ──────────────────────────────────────────────────
   Built so that every number on the card is DIFFERENT, because a fixture where
   the row count, the accepted count and the head count coincide cannot tell a
   correct card from one reading the wrong set:

     17 rows  ·  16 today  ·  14 accepted  ·  2 turned away  ·  13 people

   Ada scans twice, so people (13) < accepted (14) and the "N members" sub-line
   has something to say. One row carries a PHOTO and one carries NO USER ID —
   the two branches that render identically to a source assertion. */
const CHECKINS = [
  { 'Checked In At': liveIso(0, '18:02:00'), Member: 'Katherine Johnson', 'User ID': 'user-kj',
    'Member ID': 'KJ1234', Photo: null, Status: 'Failed', 'Desk Location': 'Front Desk', Product: 'Adult Annual' },
  { 'Checked In At': liveIso(0, '17:00:00'), Member: 'Ada Lovelace', 'User ID': 'user-ada',
    'Member ID': 'AD0001', Photo: 'https://example.test/ada.jpg', Status: 'Checked In',
    'Desk Location': 'Front Desk', Product: 'Adult Annual' },
  /* NO USER ID: the face must render as plain text rather than as a link to
     nowhere — and never from "Member ID", the six-character desk code, which
     looks identical in a link and 404s. */
  { 'Checked In At': liveIso(0, '09:10:00'), Member: 'Alan Turing', 'User ID': null,
    'Member ID': 'TU9999', Photo: null, Status: 'Checked In', 'Desk Location': 'Front Desk', Product: 'Pool Pass' },
  { 'Checked In At': liveIso(0, '09:05:00'), Member: 'Grace Hopper', 'User ID': 'user-grace',
    'Member ID': 'GH0002', Photo: null, Status: 'Checked In', 'Desk Location': 'North Desk', Product: 'Adult Annual' },
  { 'Checked In At': liveIso(0, '09:00:00'), Member: 'Ada Lovelace', 'User ID': 'user-ada',
    'Member ID': 'AD0001', Photo: 'https://example.test/ada.jpg', Status: 'Checked In',
    'Desk Location': 'Front Desk', Product: 'Adult Annual' },
  { 'Checked In At': liveIso(0, '08:40:00'), Member: 'Turned Away Two', 'User ID': 'user-ta2',
    'Member ID': 'TA0002', Photo: null, Status: 'Failed', 'Desk Location': 'Front Desk', Product: 'Youth Pass' },
];
for (let n = 1; n <= 10; n++) CHECKINS.push(
  { 'Checked In At': liveIso(0, '07:' + String(60 - n).padStart(2, '0') + ':00'),
    Member: 'Member ' + n + ' Regular', 'User ID': 'user-m' + n, 'Member ID': 'M' + n,
    Photo: null, Status: 'Checked In', 'Desk Location': 'Front Desk', Product: 'Adult Annual' });
/* YESTERDAY. The lane and the face list are both TODAY, so this row proves
   they filter rather than merely rendering whatever arrived. */
CHECKINS.push({ 'Checked In At': liveIso(1, '19:00:00'), Member: 'Yesterday Person',
  'User ID': 'user-yp', 'Member ID': 'YP0001', Photo: null, Status: 'Checked In',
  'Desk Location': 'Front Desk', Product: 'Adult Annual' });

/* FACILITY BOOKINGS, shaped so every branch that renders identically to a
   source assertion is separated by a NUMBER on screen.

     9 rows  ·  8 today  ·  6 booked  ·  2 cancelled  ·  4 self-service
     $240 booked  ·  9.5 hours

   The rows that carry their weight:
     - a CANCELLED rental with no site, no hours and no money, which is what a
       cancellation really looks like (cancelling a rental cancels its slots,
       1,144 of 1,144 platform-wide) — so a card that counted it as a booking
       reads 7, not 6;
     - a STAFF rental with NO customer account, where the person's name is the
       rental's own name — 926 of 2,179 in-progress rentals platform-wide, and
       it must render as plain text rather than a link to nowhere;
     - a RECURRING rental over 12 dates, so "+11" has to appear rather than one
       date printed as though it were the whole booking;
     - a rental across TWO courts, so the site cell has to say "+1";
     - a booking made TODAY for a slot three weeks out, which is the case a
       card showing only the booking time would hide entirely;
     - and a YESTERDAY row, so the count and the lane are proven to filter
       rather than to render whatever arrived. */
const FACILITY = [
  { 'Booked At': liveIso(0, '16:40:00'), 'Org Today': null, 'Customer Name': 'Rosalind Franklin',
    'User ID': 'user-rf', Photo: null, 'Rental Id': 'fr-1', Rental: 'Court Reservation',
    Site: 'Court 3', 'Site Count': 1, Location: 'Tennis Center', 'Booking Type': 'Instant',
    Status: 'Confirmed', Dates: 1, Hours: 1.5,
    'First Slot': liveIso(0, '18:00:00'), 'Last Slot': liveIso(0, '19:30:00'),
    Attendees: 2, Price: 34, Paid: 34 },
  /* A CANCELLATION: no site, no time, no money — and it must not be counted. */
  { 'Booked At': liveIso(0, '15:10:00'), 'Org Today': null, 'Customer Name': 'Gone Away',
    'User ID': 'user-ga', Photo: null, 'Rental Id': 'fr-2', Rental: 'Court Reservation',
    Site: null, 'Site Count': 0, Location: null, 'Booking Type': 'Instant',
    Status: 'Canceled', Dates: 0, Hours: 0,
    'First Slot': null, 'Last Slot': null, Attendees: null, Price: 0, Paid: 0 },
  /* NO CUSTOMER ACCOUNT: the name lives in the rental, and there is no id to
     link to. */
  { 'Booked At': liveIso(0, '14:20:00'), 'Org Today': null, 'Customer Name': null,
    'User ID': null, Photo: null, 'Rental Id': 'fr-3', Rental: 'David Herman',
    Site: 'Court 5', 'Site Count': 1, Location: 'Racquetball Center', 'Booking Type': 'Staff',
    Status: 'In-Progress', Dates: 1, Hours: 2,
    'First Slot': liveIso(-19, '10:00:00'), 'Last Slot': liveIso(-19, '12:00:00'),
    Attendees: null, Price: 32, Paid: 0 },
  /* TWELVE DATES: a season of Friday nights entered once. */
  { 'Booked At': liveIso(0, '11:05:00'), 'Org Today': null, 'Customer Name': 'League Organiser',
    'User ID': 'user-lo', Photo: null, 'Rental Id': 'fr-4', Rental: 'Fall Adult League',
    Site: 'Field 1', 'Site Count': 1, Location: 'Sports Park', 'Booking Type': 'Staff',
    Status: 'Confirmed', Dates: 12, Hours: 24,
    'First Slot': liveIso(-14, '18:00:00'), 'Last Slot': liveIso(-91, '20:00:00'),
    Attendees: 40, Price: 0, Paid: 0 },
  /* TWO COURTS on one rental. */
  { 'Booked At': liveIso(0, '10:30:00'), 'Org Today': null, 'Customer Name': 'Marie Curie',
    'User ID': 'user-mc', Photo: null, 'Rental Id': 'fr-5', Rental: 'Room Reservation',
    Site: 'Party Room A', 'Site Count': 2, Location: 'Community Center', 'Booking Type': 'Instant',
    Status: 'Confirmed', Dates: 1, Hours: 1.5,
    'First Slot': liveIso(-21, '13:00:00'), 'Last Slot': liveIso(-21, '14:30:00'),
    Attendees: 40, Price: 140, Paid: 140 },
  { 'Booked At': liveIso(0, '09:15:00'), 'Org Today': null, 'Customer Name': 'Ada Lovelace',
    'User ID': 'user-ada', Photo: null, 'Rental Id': 'fr-6', Rental: 'Court Reservation',
    Site: 'Court 11', 'Site Count': 1, Location: 'Pickleball Courts', 'Booking Type': 'Instant',
    Status: 'Confirmed', Dates: 1, Hours: 2,
    'First Slot': liveIso(-2, '08:00:00'), 'Last Slot': liveIso(-2, '10:00:00'),
    Attendees: 1, Price: 34, Paid: 34 },
  { 'Booked At': liveIso(0, '08:05:00'), 'Org Today': null, 'Customer Name': 'Second Cancel',
    'User ID': 'user-sc', Photo: null, 'Rental Id': 'fr-7', Rental: 'Court Reservation',
    Site: null, 'Site Count': 0, Location: null, 'Booking Type': 'Staff',
    Status: 'Canceled', Dates: 0, Hours: 0,
    'First Slot': null, 'Last Slot': null, Attendees: null, Price: 0, Paid: 0 },
  { 'Booked At': liveIso(0, '07:50:00'), 'Org Today': null, 'Customer Name': 'Grace Hopper',
    'User ID': 'user-grace', Photo: null, 'Rental Id': 'fr-8', Rental: 'Court Reservation',
    Site: 'Court 6', 'Site Count': 1, Location: 'Racquetball Center', 'Booking Type': 'Staff',
    Status: 'Confirmed', Dates: 1, Hours: 0.5,
    'First Slot': liveIso(-1, '07:00:00'), 'Last Slot': liveIso(-1, '07:30:00'),
    Attendees: null, Price: 0, Paid: 0 },
  /* YESTERDAY: proves the headline and the lane filter to today. */
  { 'Booked At': liveIso(1, '19:00:00'), 'Org Today': null, 'Customer Name': 'Yesterday Booker',
    'User ID': 'user-yb', Photo: null, 'Rental Id': 'fr-9', Rental: 'Court Reservation',
    Site: 'Court 1', 'Site Count': 1, Location: 'Tennis Center', 'Booking Type': 'Instant',
    Status: 'Confirmed', Dates: 1, Hours: 1,
    'First Slot': liveIso(0, '09:00:00'), 'Last Slot': liveIso(0, '10:00:00'),
    Attendees: 1, Price: 999, Paid: 999 },
];

const FIXTURES = {
  memberships: MEMBERSHIPS,
  enrollments: ENROLLMENTS,
  'checkins-live': CHECKINS,
  gl: [], facility: [], programs: [], 'court-utilization': [], fasttrack: [],
  users: [], products: [], 'instructor-payout': [],
};

// The saved layout. Without one the page renders its onboarding picker instead
// of a dashboard, so a check that skipped this would prove only that the SETUP
// screen renders — which is not the screen the widgets live on.
//
// reportLinks is ON, because the per-tile deep link is half of what is being
// proved here, and it is gated on that toggle.
const CONFIG = {
  config: {
    sections: [{ id: 'memberships', widgets: ['mem-active','mem-passes','mem-autorenew','mem-mrr',
                                              'mem-churn','mem-leaving','mem-revenue','mem-kind-donut',
                                              'mem-type-donut','tbl-mem-autorenew'] }],
    toggles: { ai: false, reportLinks: true, aiBriefing: false, emailDigest: false },
  },
  // enrollments present = the card has a public link, which is the ONLY
  // thing that puts the Live Widgets section on the page.
  availableReports: { memberships: true, enrollments: true, 'checkins-live': true },
  // The rec.us org uuid the admin links are addressed by. Deliberately NOT the
  // dashboard's own slug or token — a link built from those is the drift that
  // broke every report link for five weeks.
  recOrgId: 'rec-org-uuid',
  orgName: 'Render Check Parks',
  toggles: { ai: false, reportLinks: true, aiBriefing: false, emailDigest: false },
  // THE LINK IDENTITY. Deliberately DIFFERENT from this dashboard's own slug and
  // token, because identical values make the check vacuous: a page that wrongly
  // used ORG_SLUG/TOKEN would produce a byte-identical URL and pass.
  reportingBaseUrl: 'https://reports.example.test',
  reportingSlug: 'reporting-slug',
  reportingToken: 'reporting-token',
};

// ── A static server for public/ ─────────────────────────────────────────────
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const file = url === '/' || !path.extname(url) ? 'dashboard.html' : path.basename(url);
  const p = path.join(ROOT, 'public', file);
  if (!fs.existsSync(p)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'text/plain' });
  res.end(fs.readFileSync(p));
});

/* A PAGE RELOAD ONTO THE LIGHT-FEED CONFIG. `currentCase` is already set when
   a case's act() runs, so the /api/config stub serves the light availability
   map on this fetch — which is the only way to exercise the single-day cards
   in a harness that loads the page once. */
async function loadLight(page) {
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('[data-live-section="1"]', { timeout: 20000 });
}

const CASES = [
  { name: 'dashboard renders', needs: '.widget-card' },
  /* A LAYOUT SAVED BEFORE CUSTOMER SUPPORT WAS REMOVED. Org layouts live on the
     volume and are not rewritten by the deploy that deletes the widgets, so the
     page has to survive ids and a section it no longer knows.

     THIS IS A SMOKE TEST, NOT A GUARD, and the difference is worth stating: I
     could not make it fail. Removing the widget renderer's `if (!def)`, the
     section renderer's `if (!sec)`, and the metric/chart filter's `W[id] &&` —
     separately and together — left it green, because the unknown ids are
     dropped by several independent layers and something upstream of all of them
     catches this shape first. Defence in depth is why the removal is safe; it
     is also why no single mutation discriminates here. The exact-text
     assertions in support-removed.spec.js are what actually pin the guards. */
  { name: 'dashboard · a retired support layout still renders',
    retiredSupport: true, needs: '.widget-card' },
  { name: 'dashboard · ...and the retired widgets are simply absent',
    retiredSupport: true, needs: '.widget-card', absent: '[data-widget-id^="sup-"]' },
  // Keyed on COMPUTED VALUES, not "a widget rendered" — every regression these
  // guard against leaves a perfectly good-looking tile behind.
  // Read the TILE'S OWN value, not the page text: "a widget rendered" passes on
  // every regression these guard against, and a loose text match collides with
  // unrelated numbers elsewhere on the page.
  { name: 'memberships · a pass is not a member', metric: 'Active Members', value: '8',
    note: '19 active rows, 11 of them $5 gate admissions, so 8 members' },
  { name: 'memberships · and it says what it took out', metric: 'Active Members', sub: /11 active passes excluded/ },
  { name: 'memberships · passes counted in their own right', metric: 'Day Passes & Gate Fees', value: '11' },
  { name: 'memberships · the auto-renew book', metric: 'On Auto-Renew', value: '8' },
  // A DASH, NOT A ZERO, is what a missing column must produce — but this feed
  // HAS the columns, so these two must be real numbers here. A tile stuck on an
  // em dash would look like a working presence gate.
  { name: 'memberships · monthly recurring is computed, not dashed', metric: 'Monthly Recurring', notValue: '\u2014' },
  { name: 'memberships · churn is computed, not dashed', metric: 'Churn Per Renewal', notValue: '\u2014' },
  { name: 'memberships · leaving at period end', metric: 'Leaving At Period End', value: '1' },
  // THE LINK RULE. Built from the REPORTING project's identity, never ours —
  // this dashboard rendered dead links for five weeks because it used its own
  // slug and token for an org rental-report had renamed.
  { name: 'memberships · tile links to the auto-renew tab',
    needs: 'a.widget-report-link[data-report-tab="autorenew"][href*="/reporting-slug/memberships"][href*="tab=autorenew"]' },
  { name: 'memberships · tile link carries the reporting token',
    needs: 'a.widget-report-link[href*="token=reporting-token"]' },
  { name: 'memberships · never our own slug',
    needs: 'a.widget-report-link', absent: `a.widget-report-link[href*="/${ORG}/"]` },

  /* ── LIVE WIDGETS ────────────────────────────────────────────────────────
     Keyed on COMPUTED VALUES. "A live section rendered" passes on a counter
     printing the row count, on a sparkline drawn from the wrong days, and on a
     list wired to the wrong feed. */
  { name: 'live · the section is on the page', needs: '[data-live-section]' },
  /* TODAY, NOT THE WHOLE FEED. The fixture holds 32 rows of which 16 are
     today — different numbers on purpose, so a card that still rendered the
     seven-day list reads 32 here and fails. */
  { name: 'live · the registrations card shows TODAY, not the whole feed',
    needs: '[data-live-regs="16"]',
    absent: '[data-live-regs="32"]' },
  { name: 'live · and counts TODAY, not the list', needs: '[data-live-today="16"]' },
  /* FREE, NOT "NOT YET PAID". Keyed on the CELL, because the state and the
     word are two different things that can disagree — and on the dot, because
     a free row sharing the unpaid grey is the bug wearing the fix's clothes. */
  { name: 'live · a free registration says Free',
    needs: '[data-live-price="free"]' },
  { name: 'live · ...and Free is not the unpaid dash',
    needs: 'td.live-free',
    absent: '[data-live-price="free"][data-live-paid="\u2014"]' },
  { name: 'live · above the date-ranged sections', needs: '.dashboard-section[data-live-section] + .dashboard-section' },
  // HALF WIDTH (Dan). widget-lg spans all four columns; this is a list of
  // eight short rows, not a chart, and full-bleed it dwarfed the dashboard.
  { name: 'live · the counter is half width', needs: '.live-card.widget-md', absent: '.live-card.widget-lg' },
  /* THE LOADING BAR STOPS. Its inner bar carried a background and a 30% width
     unconditionally — only the ANIMATION was gated — so a finished load left a
     static amber stub under the header that reads as a progress bar stuck at
     30%. Dan: "spinning forever, top bar never stops." Computed style, because
     that stub renders identically to a real one in the DOM. */
  { name: 'dashboard · the loading bar stops when loading does',
    needs: 'body[data-loadbar="none"]',
    act: async page => {
      await page.waitForSelector('.widget-card', { timeout: 30000 });
      await page.evaluate(() => {
        const bar = document.querySelector('.loading-bar');
        const inner = document.querySelector('.loading-bar-inner');
        // Only meaningful once loading has finished; `.active` is the class the
        // bar carries while it has not.
        if (bar && !bar.classList.contains('active') && inner)
          document.body.setAttribute('data-loadbar', getComputedStyle(inner).display);
      });
    } },
  /* THE EDITOR SHOWS IT AS A STATE, NOT A CHOICE. It was in "Add a Section"
     while already rendering above — and adding it would have produced a second,
     empty copy, because the section is rendered outside config.sections. */
  { name: 'live · the editor lists it as always-on, first', needs: '[data-edit-live]',
    act: async page => {
      await page.waitForSelector('.widget-card', { timeout: 30000 });
      const clicked = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find(x => /Edit Dashboard/.test(x.textContent || ''));
        if (!b) { document.body.setAttribute('data-noedit', String(document.querySelectorAll('button').length)); return false; }
        b.click(); return true;
      });
      if (clicked) await page.waitForSelector('.modal-body', { timeout: 15000 }).catch(() => {});
    } },
  { name: 'live · ...and never offers to add it again',
    needs: '.modal-body', absent: '.add-section-btn[data-add-live]' },
  { name: 'live · it is the FIRST row in the editor',
    needs: '.modal-body > [data-edit-live]:first-child' },

  /* COLUMN HEADERS, in the order Dan named them, and FIXED tracks — the rows
     change under the reader every minute, so natural widths re-measured the
     table on every poll and the columns jumped. */
  { name: 'live · the list has column headers', needs: 'body[data-livehead="Time|Participant|Section|Price"]',
    act: async page => {
      // Close the editor first: it is a modal left open by the cases above.
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === 'Cancel');
        if (b) b.click();
      });
      await page.waitForSelector('[data-live-regs] .live-table thead th', { timeout: 15000 });
      await page.evaluate(() => {
        const hs = [...document.querySelectorAll('[data-live-regs] .live-table thead th')].map(h => h.textContent.trim());
        document.body.setAttribute('data-livehead', hs.join('|'));
        document.body.setAttribute('data-livefixed', getComputedStyle(document.querySelector('[data-live-regs] .live-table')).tableLayout);
      });
    } },
  { name: 'live · ...and fixed column tracks', needs: 'body[data-livefixed="fixed"]' },

  /* A NEW REGISTRATION HIGHLIGHTS, AND ONLY THE NEW ONE. Dan: "the new one(s)
     pop on the top, highlighted, then the highlighting fades." Unpausing
     forces the refresh, and the stub serves one extra row from the second call
     — so a widget that highlights everything, or nothing, fails. */
  { name: 'live · a new registration lands highlighted, at the top',
    needs: '[data-live-regs] .live-table tbody tr:first-child[data-live-new="1"] td.lp',
    act: async page => {
      await page.waitForSelector('.live-pause input', { timeout: 15000 });
      await page.click('.live-pause input');          // pause
      await page.click('.live-pause input');          // unpause -> immediate refetch
      await page.waitForSelector('[data-live-new="1"]', { timeout: 15000 });
    } },
  { name: 'live · ...and it is the only one highlighted',
    needs: '[data-live-regs] .live-table tbody tr:first-child[data-live-new="1"]',
    absent: '[data-live-regs] .live-table tbody tr:nth-child(2)[data-live-new="1"]' },
  /* THE TIMELINE replaced a per-day bar chart (Dan: "what is the odd bar chart
     there... how about a moving timeline of the days/time... and when people
     pay, it gets a dollar sign"). Keyed on the MARKS, because a lane with no
     marks in it renders as a perfectly good empty timeline. */
  /* THE LANE IS ONE DAY WIDE (Dan: "would prefer this card show the current
     day, so it's not so smooshed"). By the time this runs the arrival row has
     been injected, so 15 of the feed's 17 rows are today — and 17 is exactly
     what a revert to the seven-day lane would render. */
  { name: 'live · the timeline plots today, not the week',
    needs: '[data-live-regs] .live-timeline[data-live-marks="17"]',
    absent: '[data-live-regs] .live-timeline[data-live-marks="19"]' },
  /* THREE PAYMENT STATES, ALL DOTS (Dan: "change the dollar signs to a green
     dot for paid, and an orange dot for a partial payment/payment plan").
     Every one of the three has to be PRESENT, or a build that collapsed part
     into paid — or into unpaid — renders a perfectly plausible lane. And the $
     glyph has to be GONE: the class alone cannot tell a green dot from a green
     dollar sign. */
  { name: 'live · a paid registration is a green dot', needs: '[data-live-regs] .lt-mark.paid[data-live-mark="paid"]' },
  { name: 'live · a payment plan is an orange dot', needs: '[data-live-regs] .lt-mark.part[data-live-mark="part"]' },
  { name: 'live · an unpaid one is neither', needs: '[data-live-regs] .lt-mark[data-live-mark="unpaid"]',
    absent: '[data-live-regs] .lt-mark.paid[data-live-mark="unpaid"], [data-live-regs] .lt-mark.part[data-live-mark="unpaid"]' },
  { name: 'live · no dollar signs left in the lane', needs: 'body[data-lt-glyphs=""]',
    act: async page => {
      await page.waitForSelector('[data-live-regs] .lt-mark', { timeout: 15000 });
      await page.evaluate(() => {
        const t = [...document.querySelectorAll('[data-live-regs] .lt-mark')]
          .map(x => x.textContent.trim()).join('');
        document.body.setAttribute('data-lt-glyphs', t);
      });
    } },
  /* THE DOTS ARE NAMED. A three-colour code with nothing explaining it is a
     puzzle, and the legend is the only thing on the card that says which is
     which. */
  { name: 'live · the dots are named in a legend',
    needs: '[data-live-regs] [data-live-legend] .lg-part' },
  /* Hour ticks, not weekday ones — and keyed on a LATE hour, because an axis
     that quietly reverted to days would still render some `.lt-day` spans. */
  { name: 'live · the axis is hours across one day', needs: '[data-live-regs] .lt-day',
    act: async page => {
      await page.waitForSelector('[data-live-regs] .live-timeline', { timeout: 15000 });
      await page.evaluate(() => {
        const t = [...document.querySelectorAll('[data-live-regs] .lt-day')].map(x => x.textContent.trim()).join('|');
        document.body.setAttribute('data-lt-ticks', t);
      });
    } },
  { name: 'live · ...labelled 12a through 8p', needs: 'body[data-lt-ticks="12a|4a|8a|12p|4p|8p"]' },
  /* THE WEEKDAY-PREFIX CASE IS GONE WITH THE SEVEN-DAY LIST. It required a
     row from another day to be on screen, and this card now only ever shows
     today — so the case could never pass again, and a case that cannot pass is
     not a stricter guard, it is a broken one. `liveWhen`'s prefix behaviour is
     still lifted and RUN in live-widgets.spec.js, which is where a rule about a
     pure function belongs anyway. */
  /* LINKS INTO REC, built from the ids rather than the names — a link built
     from rec_id or from a section NAME renders identically and 404s. */
  /* PROGRAMS LIVE (Dan: "a live programs card, showing the most recent
     registrations by program... watch both users enrolling in sections, AND
     section revenue increasing"). Keyed on COMPUTED values, because a table
     that rendered the wrong aggregation renders just as convincingly: the
     fixture's four today-rows span three programmes, and the ordering is by
     recency rather than size — the newest row is a one-signup programme, so a
     size sort would put a different name first. */
  { name: 'live · the programmes card is on the page', needs: '[data-live-progs]' },
  { name: 'live · programme rows carry their own signup counts',
    needs: 'body[data-lp-firstn]',
    act: async page => {
      await page.waitForSelector('[data-live-prog]', { timeout: 15000 });
      await page.evaluate(() => {
        const rows = [...document.querySelectorAll('[data-live-prog]')];
        const n = r => Number(r.getAttribute('data-live-prog-signups') || 0);
        document.body.setAttribute('data-lp-firstn', String(n(rows[0])));
        document.body.setAttribute('data-lp-max', String(Math.max(...rows.map(n))));
        document.body.setAttribute('data-lp-first', rows[0].getAttribute('data-live-prog') || '');
        document.body.setAttribute('data-lp-rows', String(rows.length));
        const foot = document.querySelector('[data-live-progs] .live-foot');
        document.body.setAttribute('data-lp-foot', foot ? foot.textContent.trim() : '');
        /* THE BIG LINE HAD NO SPACING RULE and read "9across 5 programmes"
           (Dan: "fix the spacing"). Read the rendered TEXT, because the markup
           is identical either way — only the layout differs. */
        const big = document.querySelector('[data-live-progs] .live-big');
        document.body.setAttribute('data-lp-big', big ? big.textContent.trim() : '');
      });
    } },
  /* BIGGEST BY REVENUE LEADS, since 2026-09-04 — Dan asked for a leaderboard:
     "I'd expect to see the top, say 10 or so programs, which pulse or move as
     users enroll in them." Summer Camp holds $900 of the fixture's money and
     is NOT the most recent registration (Oxygen Dance is, at 14:41), so this
     pair tells a revenue sort from the recency sort it replaced. */
  { name: 'live · the biggest program by revenue leads',
    needs: 'body[data-lp-first="Summer Camp AM"]',
    absent: 'body[data-lp-first="Oxygen Dance Aerobics"]' },
  /* TEN ROWS, NOT EIGHT. The fixture has thirteen programs today, so the cap
     is visible; with three it was not. */
  { name: 'live · ten programs, and it says how many it left out',
    needs: 'body[data-lp-rows="10"]', absent: 'body[data-lp-rows="8"]' },
  { name: 'live · ...and the footer names the cap',
    needs: 'body[data-lp-foot*="showing top 10 of"]' },
  /* THE PROGRAM NAME OPENS REC (Dan: "I should also be able to click the
     section name on the right side and open a new tab directly to the rec
     admin section page"). Keyed on the HREF, not on an anchor existing: a link
     built from the wrong id renders identically and 404s, which is the mistake
     already recorded for rec_id vs users.id. Swim Lessons is the row that
     carries an id AND ranks inside the top ten. */
  { name: 'live · the program name links into Rec',
    needs: '[data-live-progs] a.live-link[data-live-prog-section="sec-swim"]'
         + '[href="https://www.rec.us/admin/o/rec-org-uuid/programming/sections/sec-swim"][target="_blank"]' },
  /* AND A PROGRAM WITH NO SECTION ID IS PLAIN TEXT. Most of this fixture has
     none, so the row still renders — it just does not pretend to link. */
  { name: 'live · ...and a program with no section id is not a dead link',
    needs: '[data-live-progs] [data-live-prog="Summer Camp AM"]',
    absent: '[data-live-progs] a.live-link[href$="/sections/undefined"], [data-live-progs] a.live-link[href$="/sections/"]' },
  /* THE RIGHT CARD COVERS THE FEED'S WINDOW (Dan: "Can we get more programs to
     show up on the right side chart? Seems a little thin over there"). The
     fixture's other-day rows — Shrewsbury Rec Youth Basketball (yesterday) and
     Rec Connect Fall (three days ago) — are the ones that prove it: under the
     old today-only rule neither appeared. */
  /* RELATIONAL, not a magic number: the other-day programs carry little or no
     money, so they rank below the ten-row cap and cannot be asserted by name.
     What the widening changes is how many programs the card KNOWS about — 14
     under the old today-only rule, more now. */
  { name: 'live · the leaderboard covers the whole feed, not just today',
    needs: 'body[data-lp-widened="1"]',
    act: async page => {
      await page.waitForSelector('[data-live-progs]', { timeout: 15000 });
      await page.evaluate(() => {
        const n = Number(document.querySelector('[data-live-progs]').getAttribute('data-live-progs') || 0);
        document.body.setAttribute('data-lp-known', String(n));
        if (n > 14) document.body.setAttribute('data-lp-widened', '1');
      });
    } },
  { name: 'live · ...and the headline still separates what arrived today',
    needs: 'body[data-lp-big*="today"]' },
  /* PROGRAM REVENUE IS MONEY RECEIVED. Swim Lessons is charged $480 with $240
     in, so the cell reading 240 and the sub-line reading 480 is the whole
     distinction — a build that kept the charged basis renders 480 in the cell
     and no sub-line at all. */
  { name: 'live · program revenue is what arrived, not what was charged',
    needs: '[data-live-progs] [data-live-prog="Swim Lessons AM"] [data-live-prog-charged="240"]',
    absent: '[data-live-progs] [data-live-prog="Swim Lessons AM"] [data-live-prog-charged="480"]' },
  { name: 'live · ...with the charge underneath it on a payment plan',
    needs: 'body[data-lp-plan*="of $480 charged"]',
    act: async page => {
      await page.waitForSelector('[data-live-prog="Swim Lessons AM"]', { timeout: 15000 });
      await page.evaluate(() => {
        const c = document.querySelector('[data-live-prog="Swim Lessons AM"] .lm');
        document.body.setAttribute('data-lp-plan', c ? c.innerText.replace(/\s+/g, ' ').trim() : '');
      });
    } },
  { name: 'live · the column is called Section revenue',
    needs: 'body[data-lp-head*="section revenue"]',
    absent: 'body[data-lp-head*="charged"]',
    act: async page => {
      await page.evaluate(() => {
        const h = document.querySelector('[data-live-progs] .live-table thead');
        // innerText honours text-transform, and these headers are uppercased
        // in CSS — so compare in one case rather than pinning the rendering.
        document.body.setAttribute('data-lp-head',
          h ? h.innerText.replace(/\s+/g, ' ').trim().toLowerCase() : '');
      });
    } },
  /* THE PRICE CARRIES ITS PAYMENT STATE'S COLOUR (Dan: "Full payment the price
     is in green, partial or installment plan, price is in orange to match the
     legend"). Computed, because a class name proves nothing about the ink. */
  /* WHAT ARRIVED, OVER WHAT WAS CHARGED. Dan, on a $325 registration with $195
     paid on a plan: "would like to see 195/325 here." The fixture's part-paid
     row is $25 of $60, and no source assertion can tell a cell that renders
     both figures from one that renders the charge twice — so this keys on the
     TEXT of the cell. */
  { name: 'live · a part-paid row shows what arrived over what was charged',
    needs: '[data-live-regs] td[data-live-price="part"][data-live-paid="$25"]',
    act: async page => {
      /* SCOPED TO ITS OWN PAID FIGURE. There are two part-paid rows now — this
         one and Jan Denner's $0 plan — and a bare `part` selector would read
         whichever sorts first, so the case would pass or fail on row order. */
      const sel = '[data-live-regs] td[data-live-price="part"][data-live-paid="$25"]';
      await page.waitForSelector(sel, { timeout: 15000 });
      const txt = await page.$eval(sel, el => el.innerText.replace(/\s+/g, ' ').trim());
      if (txt !== '$25 / $60') throw new Error('the part-paid cell reads "' + txt + '", not "$25 / $60"');
    } },
  /* A PLAN THAT HAS TAKEN NOTHING SHOWS ITS ZERO. `liveMoney` suppresses a
     zero on purpose — "$0 / $170" on an ordinary unpaid row reads as a refund
     — so the plan row needs its own rule, and no source assertion can tell a
     cell that prints the zero from one that drops it. This keys on the TEXT.

     Note what the unpaid rows in this fixture are also doing: none of them
     carries an "On Plan" key at all, which is exactly the shape a warm pre-v4
     cache entry serves. So the case below that requires an unpaid row to show
     no zero IS the proof that this degrades rather than guessing. */
  { name: 'live · a payment plan shows $0 over the full charge',
    needs: '[data-live-regs] td[data-live-price="part"][data-live-paid="$0"]',
    act: async page => {
      const sel = '[data-live-regs] td[data-live-price="part"][data-live-paid="$0"]';
      await page.waitForSelector(sel, { timeout: 15000 });
      const txt = await page.$eval(sel, el => el.innerText.replace(/\s+/g, ' ').trim());
      if (txt !== '$0 / $5') throw new Error('Jan Denner\'s plan cell reads "' + txt + '", not "$0 / $5"');
    } },
  /* ...AND ITS DOT IS ORANGE, NOT GREY. The dot and the cell are separate
     code paths — the timeline builds its own marks — so a build that fixed
     the cell and not the lane passes the case above. Keyed on the CLASS *and*
     the state, because the class alone cannot say which row it belongs to. */
  { name: 'live · a payment plan with nothing collected is an orange dot',
    needs: '[data-live-regs] .lt-mark.part[data-live-mark="part"][title*="$0 of $5 paid"]',
    absent: '[data-live-regs] .lt-mark[data-live-mark="unpaid"][title*="Jan Denner"]' },
  /* AND A FULLY PAID ROW DOES NOT. "$45 / $45" is noise, and an unpaid row
     showing "$0 / $170" would read as a refund rather than as a booking
     nobody has paid for yet. Absence, not a different value — the two claims
     are different and only one keeps the column readable. */
  { name: 'live · a fully paid row shows one figure, and an unpaid one shows no zero',
    needs: '[data-live-regs] td[data-live-price="paid"][data-live-paid=""]',
    absent: '[data-live-regs] td[data-live-price="unpaid"]:not([data-live-paid=""])' },
  { name: 'live · a paid price is green and a part-paid one orange',
    needs: 'body[data-lc-paid="rgb(22, 163, 74)"][data-lc-part="rgb(245, 158, 11)"]',
    act: async page => {
      await page.waitForSelector('[data-live-regs] td[data-live-price]', { timeout: 15000 });
      await page.evaluate(() => {
        const pick = st => document.querySelector('[data-live-regs] td[data-live-price="' + st + '"]');
        for (const st of ['paid', 'part', 'unpaid']) {
          const el = pick(st);
          if (el) document.body.setAttribute('data-lc-' + st, getComputedStyle(el).color);
        }
      });
    } },
  /* AN UNPAID PRICE KEEPS THE DEFAULT INK — a third colour, or a grey price,
     reads as disabled. Asserted as "not either of the two". */
  { name: 'live · ...and an unpaid one is neither',
    needs: 'body[data-lc-unpaid]',
    absent: 'body[data-lc-unpaid="rgb(22, 163, 74)"], body[data-lc-unpaid="rgb(245, 158, 11)"]' },
  /* THE LEGEND CLEARS THE HOUR LABELS. They are absolutely placed BELOW the
     timeline's own box, so a legend pulled up under it lands in the same 14
     pixels — which is what Dan saw. Geometry, because the DOM is identical
     either way. */
  { name: 'live · the legend clears the hour labels',
    needs: 'body[data-lg-clear="1"]',
    act: async page => {
      await page.waitForSelector('[data-live-legend]', { timeout: 15000 });
      await page.evaluate(() => {
        const tick = document.querySelector('[data-live-regs] .lt-day em');
        const leg  = document.querySelector('[data-live-regs] [data-live-legend]');
        if (!tick || !leg) return;
        const gap = leg.getBoundingClientRect().top - tick.getBoundingClientRect().bottom;
        document.body.setAttribute('data-lg-gap', String(Math.round(gap)));
        if (gap >= 0) document.body.setAttribute('data-lg-clear', '1');
      });
    } },
  { name: 'live · two widgets in the section',
    needs: '[data-live-section] [data-live-regs] ~ [data-live-progs]' },

  /* ONE PERSON COLUMN, AND IT LINKS TO THE HOUSEHOLD. Rita's row has no
     separate participant, so she IS the participant. */
  { name: 'live · the participant links into Rec',
    needs: 'a.live-link[data-live-participant="user-rita"][href="https://www.rec.us/admin/o/rec-org-uuid/users/user-rita"]' },
  /* AND SO DOES A CHILD'S — to the account that booked them, because the Rec
     profile is household-level. Kaitlin's row names Cecelia and must open
     Kaitlin's household; a card that linked only the adult rows would render
     almost identically, so this keys on the CHILD's row carrying the link. */
  { name: "live · ...and a child's name opens the household that booked them",
    needs: '[data-live-regs] a[data-live-participant="user-ryan"]',
    absent: '[data-live-regs] a[data-live-participant="undefined"]',
    act: async page => {
      await page.waitForSelector('[data-live-regs] .live-table td.lp', { timeout: 15000 });
      const t = await page.$eval('[data-live-regs] a[data-live-participant="user-ryan"]',
                                 el => el.textContent.trim()).catch(() => null);
      if (t !== 'Brayden Little')
        throw new Error('the linked name reads "' + t + '", wanted the CHILD, Brayden Little');
    } },
  { name: 'live · the section links into Rec',
    needs: 'a.live-link[data-live-section="sec-oxygen"][href="https://www.rec.us/admin/o/rec-org-uuid/programming/sections/sec-oxygen"]' },
  { name: 'live · a row with no id is plain text, not a dead link',
    needs: '[data-live-regs] .live-table tbody tr', absent: 'a.live-link[href$="/users/undefined"]' },
  /* EVERY BOLT, NOT THE FIRST ONE. This case used to read
     `querySelector('.live-bolt')` — the registrations card's — so the programs
     card's bolt was never checked, which is exactly the one Dan reported as
     dead ("The lightning bolt on the programs card isn't pulsing"). Both were
     in fact running; the guard could not have told us either way. */
  /* EVERY bolt, however many cards there are. This pinned "2of2" and broke the
     day a third live card was added, with nothing about the animation having
     changed — the brittle-literal shape already recorded twice for
     SLACK_NOTIFY and an ALLOWED array. It asserts the RATIO now, and requires
     at least two, or a page that rendered no bolts at all would read "0of0"
     and pass. */
  { name: 'live · every bolt is animated', needs: 'body[data-livebolt="all"]',
    act: async page => {
      await page.waitForSelector('[data-live-progs] .live-bolt', { timeout: 15000 });
      const out = await page.evaluate(() => {
        const els = [...document.querySelectorAll('.live-bolt')];
        const running = els.filter(el => el.getAnimations && el.getAnimations().length > 0);
        return els.length >= 2 && running.length === els.length
          ? 'all' : (running.length + ' of ' + els.length + ' bolts animating');
      });
      await page.evaluate(v => document.body.setAttribute('data-livebolt', v), out);
      if (out !== 'all') throw new Error(out);
    } },
  /* THE MANUAL REFRESH, on BOTH cards (Dan: "add a manual refresh button on
     both these live cards in case I don't want to wait every minute"). */
  { name: 'live · both cards have a refresh button',
    needs: '[data-live-regs] [data-live-refresh]', },
  { name: 'live · ...including the programs card',
    needs: '[data-live-progs] [data-live-refresh]' },
  /* AND IT ACTUALLY REFETCHES. A button that renders and does nothing looks
     identical, so this counts the enrollments requests the browser made either
     side of a click. */
  { name: 'live · clicking refresh refetches the feed', needs: 'body[data-lr-refetched="1"]',
    act: async page => {
      await page.waitForSelector('[data-live-progs] [data-live-refresh]:not([disabled])', { timeout: 20000 });
      const count = () => page.evaluate(() => performance.getEntriesByType('resource')
        .filter(e => /api\/data\/enrollments/.test(e.name)).length);
      const before = await count();
      await page.click('[data-live-progs] [data-live-refresh]');
      await page.waitForFunction((b) => performance.getEntriesByType('resource')
        .filter(e => /api\/data\/enrollments/.test(e.name)).length > b, { timeout: 15000 }, before);
      await page.evaluate(() => document.body.setAttribute('data-lr-refetched', '1'));
    } },
  /* ── THE CHA-CHING ────────────────────────────────────────────────────────
     Dan: "every time a person enrolls and pays, play a 'cha-ching' sound. mute
     by default, but add a 'mute' checkbox on the card".

     THESE FOUR CASES SHARE ONE PAGE AND MUST RUN IN ORDER — the mute box is
     real state, and unticking it persists. The last of them re-ticks it, or
     every later case runs on an unmuted dashboard.

     They read `window.__liveChimeRings`, a counter `liveChime` bumps before it
     touches audio at all. That is the only observable: this container has no
     audio device, and "a Mute box rendered" passes just as happily on a chime
     wired to every arrival, to the first load, or to an unpaid hold. */
  { name: 'live · muted by default, with no sound menu',
    needs: '[data-live-regs] input[data-live-mute="enrollments"]',
    absent: '.live-chime-pick',
    act: async page => {
      const checked = await page.$eval('[data-live-regs] input[data-live-mute="enrollments"]', el => el.checked);
      if (!checked) throw new Error('the Mute box is NOT ticked on arrival');
    } },
  /* MUTED, A PAID ARRIVAL IS SILENT. Refresh twice: the second call brings a
     paid registration that the card highlights, and the counter must not move.
     A chime that ignored the box would look identical on screen. */
  { name: 'live · muted, a paid arrival makes no sound', needs: 'body[data-chime-muted="0"]',
    act: async page => {
      await page.evaluate(() => { window.__liveChimeRings = 0; });
      for (let i = 0; i < 2; i++) {
        await page.waitForSelector('[data-live-regs] [data-live-refresh]:not([disabled])', { timeout: 20000 });
        const b = await page.evaluate(() => performance.getEntriesByType('resource')
          .filter(e => /api\/data\/enrollments/.test(e.name)).length);
        await page.click('[data-live-regs] [data-live-refresh]');
        await page.waitForFunction((n) => performance.getEntriesByType('resource')
          .filter(e => /api\/data\/enrollments/.test(e.name)).length > n, { timeout: 15000 }, b);
      }
      // The paid arrival really did land — otherwise a zero count proves nothing.
      /* KEYED ON THE SECTION, not the customer name. The person column is the
         PARTICIPANT now, so "Paid 3" (the buyer) is no longer on screen at all
         and this waited ten seconds for text that could never appear. */
      await page.waitForFunction(() => /Paid Section \d/.test(document.body.innerText), { timeout: 10000 });
      const rings = await page.evaluate(() => window.__liveChimeRings || 0);
      await page.evaluate(n => document.body.setAttribute('data-chime-muted', String(n)), rings);
    } },
  /* UNTICKING IT REVEALS THE MENU, and choosing a sound plays it — the menu is
     its own preview, which is why there is no second button. */
  { name: 'live · unmuting offers the sounds, and picking one plays it',
    needs: '.live-chime-pick[data-live-chime="chaching"]',
    act: async page => {
      /* A REAL CLICK, never `el.checked = false` plus a synthetic event:
         React tracks a controlled input's value internally and ignores a
         direct assignment, so the first draft of this case toggled the DOM,
         left the state ticked, and timed out on a menu that never appeared. */
      await page.click('[data-live-regs] input[data-live-mute="enrollments"]');
      await page.waitForSelector('.live-chime-pick', { timeout: 10000 });
      await page.evaluate(() => { window.__liveChimeRings = 0; });
      await page.select('.live-chime-pick', 'chaching');
      await page.waitForFunction(() => (window.__liveChimeRings || 0) > 0, { timeout: 10000 });
    } },
  /* EVERY SOUND IS PLAYED FOR REAL, which the ring counter alone cannot check:
     `liveChime` bumps it BEFORE calling the voice, so a voice that THROWS still
     counts. That gap did not matter while the four sounds were a pair of
     oscillators each; the five Dan asked for next build filters, buffer sources
     and LFOs, and a bad node graph throws at the point of use.

     So this walks the whole menu. A throwing voice surfaces as an uncaught
     error, which this harness already fails on, and a voice that never ran
     leaves the count short.

     IT ALSO REQUIRES A REAL AudioContext. Without one `liveChime` returns after
     incrementing, so the count would reach nine having synthesised nothing and
     the case would pass while proving the opposite of what it claims. */
  { name: 'live · every sound in the menu actually plays',
    needs: 'body[data-chime-all="ok"]',
    act: async page => {
      /* THESE CASES ARE NOT INDEPENDENT — the mute box is one shared control and
         the case before this one leaves it UNTICKED. A blind click therefore
         re-muted it, the menu never appeared, and this case took the next one
         down with it. So: read the state, ensure unmuted, and put it back
         exactly as found rather than assuming either starting point. */
      const wasMuted = await page.$eval('[data-live-regs] input[data-live-mute="enrollments"]', el => el.checked);
      if (wasMuted) await page.click('[data-live-regs] input[data-live-mute="enrollments"]');
      await page.waitForSelector('.live-chime-pick', { timeout: 10000 });
      const names = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.live-chime-pick option')).map(o => o.value));
      await page.evaluate(() => { window.__liveChimeRings = 0; window.__liveChimeVoiced = 0; });
      for (const n of names) await page.select('.live-chime-pick', n);
      await new Promise(r => setTimeout(r, 300));
      /* __liveChimeVoiced, NOT __liveChimeRings, is what proves a voice ran:
         the ring counter is bumped before the audio, so it stays at nine even
         when a voice throws. Verified by mutation — a broken `cow` passed this
         case until the second counter existed. */
      const out = await page.evaluate(n => {
        const rings  = window.__liveChimeRings  || 0;
        const voiced = window.__liveChimeVoiced || 0;
        const audio = !!(window.AudioContext || window.webkitAudioContext);
        /* n >= 4, not === 4: the claim is that EVERY sound in the menu plays,
           and a literal count turns adding one into a failing test rather than
           a passing one. The floor still catches a menu that silently emptied. */
        return (rings === n && voiced === n && audio && n >= 4)
          ? 'ok' : ('rings=' + rings + ' voiced=' + voiced + ' of ' + n + ' audio=' + audio);
      }, names.length);
      await page.evaluate(v => document.body.setAttribute('data-chime-all', v), out);
      if (wasMuted) await page.click('[data-live-regs] input[data-live-mute="enrollments"]');
    } },
  /* A BIG REGISTRATION MORNING, DRIVEN IN A REAL BROWSER. Dan: "When an org
     has a big registration day, I want it to sound like a las vegas casino."
     No source assertion can prove a burst is audible: the level and detune are
     new arguments that reach an AudioContext, and a voice that throws under
     them would leave the ring counter untouched (it is bumped first) while
     making the card silent for the rest of the session.

     So this fires a FULL burst through EVERY sound in the menu and requires
     the VOICED count to match the ring count — a hundred-odd scheduled voices,
     ducked and detuned, all of which have to synthesize. It also pins that a
     flood is capped, which is what stops one poll ringing forever. */
  { name: 'live · a flood of arrivals rings as a burst, and every voice survives it',
    needs: 'body[data-chime-burst="ok"]',
    act: async page => {
      const wasMuted = await page.$eval('[data-live-regs] input[data-live-mute="enrollments"]', el => el.checked);
      if (wasMuted) await page.click('[data-live-regs] input[data-live-mute="enrollments"]');
      await page.waitForSelector('.live-chime-pick', { timeout: 10000 });
      const out = await page.evaluate(() => {
        if (typeof liveChimeBurst !== 'function' || typeof liveChime !== 'function')
          return 'the burst scheduler is not reachable from the page';
        const names = Array.from(document.querySelectorAll('.live-chime-pick option')).map(o => o.value);
        const plan = liveChimeBurst(60);          // a flood, far past the cap
        if (plan.length < 8) return 'a flood rang only ' + plan.length + ' times';
        if (plan.length >= 60) return 'a flood was not capped at all';
        if (!(plan[0].level > 0 && plan[0].level <= 1)) return 'level out of range: ' + plan[0].level;
        window.__liveChimeRings = 0; window.__liveChimeVoiced = 0;
        // Fired synchronously rather than on the real timers: the schedule is
        // already proven by the spec, and what a browser adds is whether the
        // synthesis SURVIVES the level and detune it is handed.
        /* A THROWN VOICE IS REPORTED BY NAME, not left to kill act(). Verified
           by mutation: a `cow` rigged to throw when detuned took this case out
           with a bare "act() threw: moo", which names the mutation and not the
           sound — the die-instead-of-fail lesson already recorded twice here. */
        const broke = [];
        names.forEach(n => plan.forEach(hit => {
          try { liveChime(n, hit); } catch (e) { if (broke.indexOf(n) < 0) broke.push(n); }
        }));
        if (broke.length) return 'these sounds threw in a burst: ' + broke.join(', ');
        const want = names.length * plan.length;
        const rings = window.__liveChimeRings, voiced = window.__liveChimeVoiced;
        return (rings === want && voiced === want && names.length >= 4)
          ? 'ok' : ('rings=' + rings + ' voiced=' + voiced + ' of ' + want +
                    ' across ' + names.length + ' sounds');
      });
      await page.evaluate(v => document.body.setAttribute('data-chime-burst', v), out);
      if (wasMuted) await page.click('[data-live-regs] input[data-live-mute="enrollments"]');
      /* THE DIAGNOSIS IS THROWN AS WELL AS STAMPED. The runner prints `rendered
         no body[data-chime-burst="ok"]` for any failure, which is the same
         sentence whether the cap vanished, a voice threw or the level went to
         zero — three different bugs with three different fixes. */
      if (out !== 'ok') throw new Error(out);
    } },
  /* AND THE COUNT IS WHAT SEPARATES "PAID" FROM "ANY ARRIVAL". This refresh
     delivers ONE paid registration and ONE unpaid one together, so a correct
     card rings exactly once. Two rings means it does not read the payment;
     zero means unmuting did nothing. */
  { name: 'live · unmuted, one paid + one unpaid arrival rings ONCE',
    needs: 'body[data-chime-rings="1"]',
    act: async page => {
      await page.evaluate(() => { window.__liveChimeRings = 0; });
      await page.waitForSelector('[data-live-regs] [data-live-refresh]:not([disabled])', { timeout: 20000 });
      const b = await page.evaluate(() => performance.getEntriesByType('resource')
        .filter(e => /api\/data\/enrollments/.test(e.name)).length);
      await page.click('[data-live-regs] [data-live-refresh]');
      const seenBefore = await page.evaluate(() => document.body.innerText.match(/Unpaid Section \d+/g) || []);
      await page.waitForFunction((prev) => (document.body.innerText.match(/Unpaid Section \d+/g) || [])
        .some(x => prev.indexOf(x) < 0), { timeout: 15000 }, seenBefore);
      // The burst is staggered, so give the later handles time to have fired
      // had they been queued — a count read too early would hide a second ring.
      await new Promise(r => setTimeout(r, 600));
      const rings = await page.evaluate(() => window.__liveChimeRings || 0);
      await page.evaluate(n => document.body.setAttribute('data-chime-rings', String(n)), rings);
      // Re-tick it, or every case after this one runs on an unmuted dashboard.
      await page.click('[data-live-regs] input[data-live-mute="enrollments"]');
    } },
  /* ── ONE MUTE AND ONE SOUND PER CARD ─────────────────────────────────────
     Dan: "make the mute/unmute toggles separate for each widget, some might
     want to hear sounds for a widget and not the others", and "Ideally I'd be
     able to set a separate sound for each."

     No source assertion can tell three boxes wired to one piece of state from
     three wired to their own — all three render, and all three tick. Only
     clicking one and reading the other two can. */
  { name: 'live · every card has its own mute box',
    needs: 'body[data-mutes="3"]',
    act: async page => {
      await page.waitForSelector('[data-live-checkins] input[data-live-mute]', { timeout: 20000 });
      const n = await page.evaluate(() =>
        new Set([...document.querySelectorAll('input[data-live-mute]')]
          .map(el => el.getAttribute('data-live-mute'))).size);
      await page.evaluate(v => document.body.setAttribute('data-mutes', String(v)), n);
      if (n !== 3) throw new Error('found ' + n + ' distinct mute boxes, wanted 3');
    } },
  { name: 'live · ...and unmuting one leaves the others silent',
    needs: 'body[data-mute-indep="ok"]',
    act: async page => {
      const out = await page.evaluate(async () => {
        const box = c => document.querySelector('input[data-live-mute="' + c + '"]');
        /* THESE CASES ARE NOT INDEPENDENT — the mute boxes are shared controls
           and an earlier case may have left one unticked. Normalise rather than
           assert a starting state, which is the trap already recorded here for
           the single shared box. */
        for (const c of ['enrollments', 'programs', 'checkins']) {
          if (box(c) && !box(c).checked) box(c).click();
        }
        await new Promise(r => setTimeout(r, 250));
        box('programs').click();
        await new Promise(r => setTimeout(r, 250));
        const after = ['enrollments', 'programs', 'checkins'].map(c => box(c) && box(c).checked);
        // Put it back, or every later case runs on a half-unmuted dashboard.
        box('programs').click();
        await new Promise(r => setTimeout(r, 150));
        return (after[0] === true && after[1] === false && after[2] === true)
          ? 'ok' : 'unmuting programs gave ' + after.join(',');
      });
      await page.evaluate(v => document.body.setAttribute('data-mute-indep', v), out);
      if (out !== 'ok') throw new Error(out);
    } },
  /* AND THE SOUNDS ARE SET SEPARATELY. Two cards left on the same sound would
     look identical to two cards sharing one — so this sets them DIFFERENTLY
     and reads both back. */
  { name: 'live · two cards can carry two different sounds',
    needs: 'body[data-sounds="arcade|bell"]',
    act: async page => {
      const out = await page.evaluate(async () => {
        const box = c => document.querySelector('input[data-live-mute="' + c + '"]');
        const pick = c => document.querySelector('select[data-live-chime-card="' + c + '"]');
        // Normalise to muted first — an earlier case may have left one open,
        // and a blind click would then MUTE the card this needs to hear.
        for (const c of ['enrollments', 'programs', 'checkins']) {
          if (box(c) && !box(c).checked) box(c).click();
        }
        await new Promise(r => setTimeout(r, 250));
        box('enrollments').click(); box('checkins').click();
        await new Promise(r => setTimeout(r, 300));
        if (!pick('enrollments') || !pick('checkins')) return 'a picker did not appear on unmute';
        const set = (el, v) => {
          const d = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value');
          d.set.call(el, v);
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        /* SET BOTH, and to DIFFERENT values. Reading one back against a
           default proves nothing here — an earlier case walks the whole menu
           on the first picker on the page, so "enrollments is still coin" is
           an assumption about test ORDER rather than about the cards. Two
           writes and two distinct reads is the independence claim itself. */
        set(pick('enrollments'), 'arcade');
        set(pick('checkins'), 'bell');
        await new Promise(r => setTimeout(r, 300));
        const got = [pick('enrollments').value, pick('checkins').value].join('|');
        box('enrollments').click(); box('checkins').click();
        await new Promise(r => setTimeout(r, 150));
        return got;
      });
      await page.evaluate(v => document.body.setAttribute('data-sounds', v), out);
      if (out !== 'arcade|bell') throw new Error('the two cards read ' + out + ', wanted arcade|bell');
    } },

  /* ── MEMBERSHIP CHECK-INS ────────────────────────────────────────────────
     Every case here keys on a COMPUTED VALUE, because "a check-ins card
     rendered" passes on every one of the regressions worth catching. The
     fixture makes 17 / 16 / 14 / 2 / 13 all different on purpose. */
  { name: 'live · the check-ins card is on the page',
    needs: '[data-live-checkins="17"]' },
  /* A DENIAL IS NOT ATTENDANCE. Counting every row reads 16, counting the
     whole feed reads 17; only filtering to today's ACCEPTED scans reads 14. */
  { name: 'live · the count is accepted scans today, not every row',
    needs: '[data-live-ci-today="14"]',
    absent: '[data-live-ci-today="16"], [data-live-ci-today="17"]' },
  /* ...AND THE REFUSALS ARE STILL SHOWN, separately and named. A card that
     silently dropped them would pass the case above. */
  { name: 'live · ...and the ones turned away are counted separately',
    needs: '[data-live-ci-failed="2"]' },
  /* THE LANE IS TODAY. 16, not 17 — the yesterday row must not be drawn on
     today's axis, where it would pin to 7pm and invent an evening rush. */
  { name: 'live · yesterday is not drawn on today\'s lane',
    needs: '[data-live-ci-marks="16"]' },
  { name: 'live · a refused scan is marked as one',
    needs: '[data-live-ci-mark="failed"]' },
  /* THE FACES. Capped at twelve of sixteen, and the cap says so rather than
     trailing off. */
  { name: 'live · the people who checked in are shown, capped',
    needs: '[data-live-ci-people="12"] [data-live-ci-person="Ada Lovelace"]' },
  { name: 'live · ...and the cap names what it left out',
    needs: '[data-live-ci-more="4"]' },
  /* A PHOTO WHERE THERE IS ONE, INITIALS WHERE THERE IS NOT — and both in the
     same row. No source assertion can tell a photo-first layout from one that
     falls back, because both render an element. */
  { name: 'live · a member with a photo gets it, and one without gets initials',
    needs: '[data-live-ci-face="photo"]',
    act: async page => {
      await page.waitForSelector('[data-live-ci-face]', { timeout: 15000 });
      const out = await page.evaluate(() => {
        const ini = document.querySelector('[data-live-ci-person="Grace Hopper"] .ci-face em');
        if (!ini) return 'no initials element for Grace Hopper';
        if (ini.textContent.trim() !== 'GH') return 'initials read "' + ini.textContent.trim() + '", not GH';
        const photoRow = document.querySelector('[data-live-ci-person="Ada Lovelace"] .ci-face');
        if (!photoRow || !photoRow.querySelector('img')) return 'Ada has no <img> over her initials';
        if (!photoRow.querySelector('em')) return 'the photo REPLACED the initials instead of sitting over them';
        return 'ok';
      });
      if (out !== 'ok') throw new Error(out);
    } },
  /* THE LINK TAKES THE UUID, and a row without one is plain text rather than
     a link to nowhere. "Member ID" is the six-character desk code — it looks
     identical in a link and 404s, so the absent case is the load-bearing one. */
  { name: 'live · a member links into Rec by uuid',
    needs: '[data-live-ci-link="user-ada"]',
    absent: '[data-live-ci-link="AD0001"]' },
  { name: 'live · ...and a row with no uuid is not a dead link',
    needs: '[data-live-ci-person="Alan Turing"]',
    absent: '[data-live-ci-person="Alan Turing"] a' },
  /* ONE AXIS, TWO LANES. The two cards sit one above the other, so a noon in
     two places is a defect a reader sees at once. Compares the rendered tick
     positions rather than the code, which is the only thing that can. */
  { name: 'live · both lanes share one axis',
    needs: 'body[data-ci-axis="same"]',
    act: async page => {
      await page.waitForSelector('[data-live-ci-marks]', { timeout: 15000 });
      const same = await page.evaluate(() => {
        const lanes = Array.from(document.querySelectorAll('.live-timeline'));
        if (lanes.length < 2) return 'only ' + lanes.length + ' lane(s) on the page';
        const ticks = lanes.map(l => Array.from(l.querySelectorAll('.lt-day')).map(d => d.style.left).join(','));
        return ticks[0] && ticks[0] === ticks[1] ? 'same' : 'lanes disagree: ' + ticks.join(' | ');
      });
      await page.evaluate(v => document.body.setAttribute('data-ci-axis', v), same);
      if (same !== 'same') throw new Error(same);
    } },
  /* NO SOUND ON THIS CARD. The chime says "somebody just gave you money"; a
     beep on every desk scan would get the whole section muted. */
  /* IT HAS ONE NOW, and its own. Dan: "Add the soundbar to the programs and
     memberships check-in widgets." Muted on arrival like every card, so the
     picker is absent until somebody unticks it — which is the state this
     asserts, since every earlier case restores the boxes it touched. */
  { name: 'live · the check-ins card has its own mute box',
    needs: '[data-live-checkins] input[data-live-mute="checkins"]',
    absent: '[data-live-checkins] .live-chime-pick' },

  /* NOTE THE DESCENDANT SPACE in these selectors: the programme name is on the
     ROW and the trend on its signups CELL, so `[data-live-prog=x][data-live-prog-trend=y]`
     demands both on ONE element and matches nothing. All three cases failed
     that way on the first run — the page was right, the selectors were not.

     THE ARROW IS ON THE RIGHT PROGRAMME. No source assertion can tell a trend
     wired to the wrong row from a correct one — both render an arrow — so this
     keys on WHICH programme carries WHICH direction. The fixture makes them
     opposite on purpose: Youth Winter Basketball has stopped catching, Fall
     Volleyball is climbing, so an inverted implementation still renders two
     arrows and fails here. */
  { name: 'live · a programme that stopped catching reads DOWN',
    needs: '[data-live-prog="Youth Winter Basketball AM"] [data-live-prog-trend="down"]' },
  { name: 'live · ...and one that is climbing reads UP',
    needs: '[data-live-prog="Fall Volleyball AM"] [data-live-prog-trend="up"]' },
  /* AND A PROGRAMME WITH NO HISTORY CARRIES NO ARROW. Everything else in this
     fixture registered today only, so it sits under the floor — a build that
     drew a flat dash for those would be claiming a measurement it does not
     have. Summer Camp is the check: top of the card, one signup, today. */
  { name: 'live · a programme with no history shows no arrow at all',
    needs: '[data-live-prog="Summer Camp AM"] [data-live-prog-trend=""]' },

  /* THE MONEY COLUMN HOLDS ITS OWN HEADER. Dan: "look at the alignment on the
     headers and revenue section" — `.lm` was 62px, sized for the registrations
     card's bare price, and `table-layout: fixed` honours that, so the programs
     card's 15-character nowrap header overflowed the card's right edge and the
     "of $X charged" sub-line was clipped.

     GEOMETRY, not presence: "a header rendered" passes on the clipped version,
     and textContent is blind to a box the text is spilling out of. This
     compares the header's own text width against the cell it lives in, and the
     cell's right edge against the card's. */
  { name: 'live · the revenue header fits its column',
    needs: 'body[data-lm-fit="1"][data-lm-inside="1"]',
    act: async page => {
      await page.waitForSelector('[data-live-progs] .live-table-progs th.lm', { timeout: 20000 });
      await page.evaluate(() => {
        const th = document.querySelector('[data-live-progs] .live-table-progs th.lm');
        const card = th.closest('.widget-card');
        // scrollWidth > clientWidth means the text does not fit the cell.
        const fits = th.scrollWidth <= th.clientWidth + 1;
        const r = th.getBoundingClientRect(), c = card.getBoundingClientRect();
        document.body.setAttribute('data-lm-fit', fits ? '1' : '0');
        document.body.setAttribute('data-lm-inside', r.right <= c.right + 1 ? '1' : '0');
        document.body.setAttribute('data-lm-debug',
          'th ' + Math.round(th.scrollWidth) + '/' + Math.round(th.clientWidth) +
          ' right ' + Math.round(r.right) + ' card ' + Math.round(c.right));
      });
    } },
  /* ...AND SO DOES THE "of $X charged" SUB-LINE, which is the other half of
     what was clipped. Keyed on a row that actually HAS one — a fixture where
     paid == charged everywhere would make this vacuous. */
  { name: 'live · the charged sub-line is not clipped',
    needs: 'body[data-lmsub-fit="1"]',
    act: async page => {
      await page.waitForSelector('[data-live-progs] .live-table-progs .lm-sub', { timeout: 20000 });
      await page.evaluate(() => {
        const el = document.querySelector('[data-live-progs] .live-table-progs .lm-sub');
        document.body.setAttribute('data-lmsub-fit', el.scrollWidth <= el.clientWidth + 1 ? '1' : '0');
      });
    } },
  /* THE BIG LINE READS AS WORDS. "9across 5 programmes" was the bug (Dan: "fix
     the spacing"), and it took two assertions because it is two faults wearing
     one symptom:
       - GEOMETRY, for the look. `textContent` is blind to layout, so the first
         version of this case "caught" a squash that a flex gap had already
         fixed. The number's right edge and the caption's left edge are what a
         reader sees.
       - TEXT, for everything that is not a pair of eyes. With the elements
         merely spaced apart, `textContent` is still "15across" — what a screen
         reader says and what a copy-paste carries. */
  { name: 'live · the headline is spaced, and says Programs',
    needs: 'body[data-lp-gap="1"][data-lp-big*=" across"]',
    absent: 'body[data-lp-big*="programme"]',
    act: async page => {
      await page.evaluate(() => {
        const big = document.querySelector('[data-live-progs] .live-big');
        if (!big) return;
        const n = big.querySelector('strong'), cap = big.querySelector('span');
        if (!n || !cap) return;
        const a = n.getBoundingClientRect(), b = cap.getBoundingClientRect();
        document.body.setAttribute('data-lp-gappx', String(Math.round(b.left - a.right)));
        if (b.left - a.right >= 4) document.body.setAttribute('data-lp-gap', '1');
      });
    } },
  /* THE WARM TINT. Dan: "make these two cards have a slightly different colored
     background... they look a bit washed out and don't stand out from the
     current cards." Computed, and COMPARED against a normal card — a literal
     colour assertion would pin the shade rather than the difference, and would
     fail the moment either theme's palette moves. */
  { name: 'live · the live cards stand out from the rest', needs: 'body[data-lb-tinted="1"]',
    act: async page => {
      await page.evaluate(() => {
        const live = document.querySelector('.live-card');
        const plain = [...document.querySelectorAll('.widget-card')].find(c => !c.classList.contains('live-card'));
        if (!live || !plain) return;
        const a = getComputedStyle(live).backgroundColor, b = getComputedStyle(plain).backgroundColor;
        document.body.setAttribute('data-lb-live', a);
        document.body.setAttribute('data-lb-plain', b);
        if (a && b && a !== b) document.body.setAttribute('data-lb-tinted', '1');
      });
    } },
  /* ── THE SINGLE-DAY CARDS ────────────────────────────────────────────────
     Dan: "since each is only pulling a single day's worth of data for a
     specific org, maybe that's smarter?" It is, and the risk of the split is
     entirely in the MERGE: no source assertion can tell a leaderboard that
     folded its history in from one that quietly lost it, because both render a
     perfectly plausible table. These drive the light feeds in a browser.

     THEY GO LAST, AND EACH ONE RELOADS. This harness loads the page ONCE and
     then runs every case against it, so a case that needs a different
     `availableReports` has to fetch it — and a reload leaves the page on the
     light config for everything after it, which is why nothing follows. The
     first draft of these sat mid-list and silently tested the WIDE path: they
     passed, and the trace showed the wide feed being requested. Cases are not
     independent here; that is recorded once already and it caught me again. */
  { name: 'live · the light feeds render all three cards',
    lightFeeds: true, needs: '[data-live-section="1"] [data-live-regs]',
    act: loadLight },
  { name: 'live · ...including the check-ins card, off its own one-day feed',
    lightFeeds: true, needs: '[data-live-section="1"] [data-live-checkins]',
    act: loadLight },
  /* THE MERGE ITSELF. The rollup gives Swim 7 + 3 signups across two past days
     and the today feed gives it one; a board that dropped the history would
     show 1, and one that double-counted today would show more than 11. Keyed
     on the printed number rather than on the row existing. */
  { name: 'live · the leaderboard adds the history to today',
    lightFeeds: true, needs: '[data-live-prog-signups]',
    act: async page => {
      await loadLight(page);
      await page.waitForSelector('[data-live-prog-signups]', { timeout: 20000 });
      const got = await page.evaluate(() => {
        const out = {};
        document.querySelectorAll('[data-live-prog]').forEach(el => {
          out[el.getAttribute('data-live-prog')] = Number(el.getAttribute('data-live-prog-signups'));
        });
        return out;
      });
      /* KEYED ON THE SECTION NAME, which is what data-live-prog carries. */
      const swim = got['Swim Lessons AM'];
      if (swim == null) throw new Error('Swim is not on the board at all: ' + JSON.stringify(got));
      if (swim !== 11) throw new Error('Swim reads ' + swim + ', want 11 (1 today + the rollup\'s 7 + 3)');
      if (!('Long Gone' in got)) throw new Error('a section with history and nothing today was dropped from a 7-day board');
      if (got['Long Gone'] !== 5) throw new Error('history-only section reads ' + got['Long Gone'] + ', want 5');
    } },

  /* ── THE FACILITY CARD ────────────────────────────────────────────────────
     Keyed on COMPUTED VALUES throughout. "A fourth card rendered" passes on a
     card that counts cancellations as bookings, prints the first of twelve
     dates as though it were the whole rental, or links a staff booking with no
     customer to nowhere — which are the four things that can go wrong here. */
  { name: 'live · the facility card counts bookings that stand',
    lightFeeds: true, needs: '[data-live-fac-today]',
    act: async page => {
      await loadLight(page);
      await page.waitForSelector('[data-live-fac-today]', { timeout: 20000 });
      const got = await page.evaluate(() => ({
        booked:   document.querySelector('[data-live-fac-today]').getAttribute('data-live-fac-today'),
        canceled: (document.querySelector('[data-live-fac-canceled]') || {}).getAttribute
                  ? document.querySelector('[data-live-fac-canceled]').getAttribute('data-live-fac-canceled') : null,
        instant:  (document.querySelector('[data-live-fac-instant]') || {}).getAttribute
                  ? document.querySelector('[data-live-fac-instant]').getAttribute('data-live-fac-instant') : null,
        headline: document.querySelector('[data-live-fac-today]').parentElement.innerText.replace(/\s+/g, ' '),
      }));
      /* SIX, not eight: two of today's rows are cancellations and one row is
         yesterday's. A card folding either in reads 7 or 8. */
      if (got.booked !== '6') throw new Error('bookings today reads ' + got.booked + ', want 6');
      if (got.canceled !== '2') throw new Error('cancellations read ' + got.canceled + ', want 2');
      /* FOUR of the six booked rows are self-service; yesterday's instant row
         must not be one of them. */
      /* THREE of the six booked rows are self-service — the fourth Instant row
         in the fixture is a CANCELLATION, and a card counting it would read 4.
         (My own first draft of this assertion said 4 and was wrong about its
         own fixture; the number is worth deriving rather than eyeballing.) */
      if (got.instant !== '3') throw new Error('self-service reads ' + got.instant + ', want 3');
      /* THE MONEY IS TODAY'S BOOKED MONEY. Yesterday's $999 row is the one that
         separates a card reading `rows` from one reading today's. */
      if (!/\$240/.test(got.headline)) throw new Error('headline money is ' + got.headline + ', want $240');
      if (/999/.test(got.headline)) throw new Error("yesterday's booking is in today's money: " + got.headline);
    } },

  { name: 'live · a recurring rental says how many dates',
    lightFeeds: true, needs: '[data-live-fac-when]',
    act: async page => {
      await loadLight(page);
      await page.waitForSelector('[data-live-fac-when]', { timeout: 20000 });
      const got = await page.evaluate(() => {
        const out = {};
        document.querySelectorAll('[data-live-fac-row]').forEach(tr => {
          const who  = tr.querySelector('.lp').innerText.trim();
          out[who] = {
            when: tr.querySelector('[data-live-fac-when]').getAttribute('data-live-fac-when'),
            site: tr.querySelector('[data-live-fac-site]').innerText.replace(/\s+/g, ' ').trim(),
            link: !!tr.querySelector('[data-live-fac-user]'),
          };
        });
        return out;
      });
      const league = got['League Organiser'];
      if (!league) throw new Error('the twelve-date rental is not on the card: ' + JSON.stringify(got));
      /* +11, NOT ONE DATE PRINTED AS THE ANSWER. */
      if (!/\+11$/.test(league.when)) throw new Error('a 12-date rental reads "' + league.when + '", want a +11');
      /* TWO COURTS SAY SO. */
      const curie = got['Marie Curie'];
      if (!curie || !/\+1\b/.test(curie.site)) throw new Error('a two-court rental reads "' + (curie||{}).site + '", want a +1');
      /* A STAFF RENTAL WITH NO CUSTOMER falls back to the rental's own name and
         is NOT a link — the branch that renders identically in source. */
      const herman = got['David Herman'];
      if (!herman) throw new Error('a staff rental with no customer account lost its name: ' + JSON.stringify(got));
      if (herman.link) throw new Error('a booking with no user id was rendered as a link to nowhere');
      /* A CANCELLATION SAYS SO rather than leaving an empty cell. */
      const gone = got['Gone Away'];
      if (!gone || gone.when !== 'canceled') throw new Error('a cancelled rental reads "' + (gone||{}).when + '"');
    } },

  /* ── FOUR ON A SCREEN ─────────────────────────────────────────────────────
     Dan: "lets shrink the cards a bit, ideally we have 4 cards on a screen."
     A CSS diff cannot prove that; only a browser can measure it, and only over
     the real fixture, because the height is the rows. Driven at 1400x900 —
     roughly a 1080p laptop once the browser chrome is off — and the assertion
     is that the whole live grid fits inside it. */
  { name: 'live · four cards fit on one screen',
    lightFeeds: true, needs: '[data-live-fac-today]',
    viewport: { width: 1400, height: 900 },
    act: async page => {
      await loadLight(page);
      await page.waitForSelector('[data-live-fac-today]', { timeout: 20000 });
      const m = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.widget-card.live-card')];
        const grid  = cards.length ? cards[0].parentElement.getBoundingClientRect() : null;
        const sect  = document.querySelector('[data-live-section="1"]');
        return { n: cards.length, grid: grid ? Math.round(grid.height) : 0,
                 section: sect ? Math.round(sect.getBoundingClientRect().height) : 0,
                 viewport: window.innerHeight,
                 each: cards.map(c => (c.innerText || '').split('\n')[0].slice(0, 22)
                                      + ' ' + Math.round(c.getBoundingClientRect().height)),
                 titles: cards.map(c => (c.innerText || '').split('\n')[0].slice(0, 30)) };
      });
      if (m.n !== 4) throw new Error('want four live cards, got ' + m.n + ': ' + JSON.stringify(m.titles));
      /* THE ASSERTION IS THE ACTUAL PROPERTY: the whole live section — its
         heading included — inside the viewport, with headroom. Before the
         compact block the four cards were ~500 each and the grid alone was
         ~1020px, so this fails by a wide margin on the version Dan reported.

         THE HEADROOM IS THE POINT OF THE 40px. Asserting "fits exactly" would
         pass at 899 of 900 and flip on any future row, which is a guard that
         reports luck rather than fit. */
      if (m.section > m.viewport - 40)
        throw new Error('the live section is ' + m.section + 'px inside a ' + m.viewport + 'px viewport'
                        + ' \u2014 four cards do not fit \u2014 ' + JSON.stringify(m.each));
    } },

];

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/opt/pw-browsers/chromium',
  });
  let failures = [];
  /* The request handler is installed once, before the case loop, so a case that
     needs a different stub reaches it through this. */
  let currentCase = {};
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1400 });
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = req.url();
    for (const [file] of Object.entries(CDN)) {
      if (u === CDN[file]) {
        return req.respond({ status: 200, contentType: 'application/javascript',
                             body: fs.readFileSync(path.join(CACHE, file), 'utf8') });
      }
    }
    if (/fonts\.googleapis|fonts\.gstatic|leaflet\.min\.css/.test(u)) {
      return req.respond({ status: 200, contentType: 'text/css', body: '' });
    }
    if (/\/api\//.test(u)) {
      const json = (o) => req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (/\/api\/config/.test(u)) {
        /* A SAVED LAYOUT FROM BEFORE CUSTOMER SUPPORT WAS REMOVED. Orgs'
           layouts live on the volume, so the deploy that deletes the widgets
           does NOT rewrite them — the page has to survive ids it no longer
           knows. Serving the retired shape here is the only way to prove that;
           a source assertion about guard clauses cannot. */
        /* AN ORG ON THE SINGLE-DAY CARDS. Only the availability map changes —
           the same three widgets have to render, from a today feed plus a
           rollup instead of one seven-day pull, and no source assertion can
           tell a working merge from a leaderboard that quietly lost its
           history. */
        if (currentCase.lightFeeds) {
          return json({ ...CONFIG, availableReports: { memberships: true,
            'enrollments-today': true, 'enrollments-rollup': true, 'checkins-today': true,
            'facility-today': true } });
        }
        if (currentCase.retiredSupport) {
          /* TWO different guards have to hold, and an earlier version of this
             fixture only reached one: a whole unknown SECTION is dropped before
             its widget ids are ever looked at, so retired ids also have to sit
             inside a section that still EXISTS. */
          const surviving = CONFIG.config.sections.map(sec => ({ ...sec,
            widgets: ['sup-total', ...sec.widgets, 'tbl-support-topics'] }));
          return json({ ...CONFIG, config: { ...CONFIG.config,
            sections: [{ id: 'support', widgets: ['sup-hours-saved'] }, ...surviving] },
            availableReports: { ...CONFIG.availableReports, support: true } });
        }
        return json(CONFIG);
      }
      // fetchReportData reads json.rows off /:org/api/data/:reportType.
      const m = /\/api\/data\/([a-z-]+)/.exec(u);
      const rt = m ? m[1] : null;
      if (rt === 'enrollments') {
        enrollCalls++;
        return json({ rows: [...enrollArrivals(), ...ENROLLMENTS] });
      }
      /* THE LIGHT FEEDS. `enrollments-today` is the same fixture narrowed to
         today and stamped with the card's own `Org Today`, which is what makes
         it the authority on the day; `enrollments-rollup` carries the history
         those rows no longer include. Deliberately NOT the same rows twice:
         if the rollup echoed today, the merge would double it, and a fixture
         that cannot express that bug cannot catch it. */
      if (rt === 'enrollments-today') {
        enrollCalls++;
        const today = liveIso(0, '00:00:00').slice(0, 10);
        return json({ rows: [...enrollArrivals(), ...ENROLLMENTS]
          .filter(r => String(r['Signed Up At']).slice(0, 10) === today)
          .map(r => ({ ...r, 'Org Today': today })) });
      }
      if (rt === 'enrollments-rollup') return json({ rows: ROLLUP });
      if (rt === 'facility-today') {
        const today = liveIso(0, '00:00:00').slice(0, 10);
        return json({ rows: FACILITY.map(r => ({ ...r, 'Org Today': today })) });
      }
      if (rt === 'checkins-today') {
        const today = liveIso(0, '00:00:00').slice(0, 10);
        return json({ rows: (FIXTURES['checkins-live'] || [])
          .filter(r => String(r['Checked In At']).slice(0, 10) === today)
          .map(r => ({ ...r, 'Org Today': today })) });
      }
      return json({ rows: (rt && FIXTURES[rt]) || [] });
    }
    req.continue();
  });
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message.split('\n')[0].slice(0, 200)); console.error('STACK:', (e.stack||'').split('\n').slice(0,6).join(' | ')); });

  await page.goto(`http://127.0.0.1:${PORT}/${ORG}/dashboard?token=${TOKEN}`, { waitUntil: 'networkidle2', timeout: 60000 });
  // The widgets mount after the config and the feed land.
  try { await page.waitForSelector('.widget-card', { timeout: 30000 }); } catch (e) {}
  await new Promise(r => setTimeout(r, 1500));

  if (errors.length) failures.push('uncaught error(s): ' + errors.join(' | '));
  const bodyLen = await page.evaluate(() => document.body.innerText.trim().length);
  if (bodyLen < 100) failures.push('the page came up blank (' + bodyLen + ' chars of text)');

  /* NO UNRENDERED ESCAPES ANYWHERE ON THE PAGE. This is here because one
     shipped: the check-ins card read "Members and passes as they scan in
     \u00b7 today" on production, with the escape as five literal characters.

     THE CAUSE IS WORTH KNOWING, because it looks like correct code. A JSX
     ATTRIBUTE is not a JavaScript string literal — `sub="a \u00b7 b"` passes
     the backslash through verbatim, while `sub={'a \u00b7 b'}` is a real
     string and renders the character. The same trap catches escapes written in
     JSX text. Every spec passed on it, the parse check passed on it, and the
     render check passed on it too, because nothing was LOOKING at the words.

     Global rather than per-case: the bug is not about one card, and a case
     that pinned this one sentence would not have covered the next one. */
  const escaped = await page.evaluate(() => {
    const t = document.body.innerText;
    const hits = [];
    // \uXXXX and \n as literal text, plus an HTML entity that reached the eye.
    [/\\u[0-9a-fA-F]{4}/g, /\\n(?![a-zA-Z])/g, /&(amp|lt|gt|quot|#\d+);/g].forEach(re => {
      const m = t.match(re);
      if (m) hits.push(...m.slice(0, 4));
    });
    return hits;
  });
  if (escaped.length) {
    failures.push('unrendered escape(s) on screen: ' + [...new Set(escaped)].join(', ') +
                  ' — a JSX attribute or JSX text is not a string literal');
  }

  const BASE_VIEWPORT = { width: 1400, height: 1400 };
  for (const c of CASES) {
    currentCase = c;
    let bad = null;
    /* A PER-CASE VIEWPORT, ported from the sibling repo's render check. Some
       bugs do not exist at the default size — "four cards on a screen" is only
       a question at a screen's height — and a case that silently ran at 1400px
       tall would pass on a layout nobody can fit on a laptop. Restored after,
       in a finally, so a throwing act() cannot leave the next case measuring
       the wrong box. */
    if (c.viewport) await page.setViewport(c.viewport);
    /* A per-case `act` hook, ported from the sibling repo's render check. Some
       states only exist after an interaction — the widget editor is behind a
       button, and a computed style has to be READ and stamped before a
       selector can assert it. Without this the hook was silently ignored and
       four cases failed against perfectly good code, which is its own lesson:
       a harness that accepts an unknown field and drops it is worse than one
       that rejects it. */
    if (c.act) {
      try { await c.act(page); }
      catch (e) { bad = 'act() threw: ' + String(e.message).split('\n')[0].slice(0, 160); }
    }
    if (!bad && c.needs) {
      const found = await page.$(c.needs);
      if (!found) bad = 'rendered no "' + c.needs + '"';
    }
    if (!bad && c.absent) {
      const still = await page.$(c.absent);
      if (still) bad = '"' + c.absent + '" should NOT be present, but it is';
    }
    if (!bad && c.text) {
      const t = await page.evaluate(() => document.body.innerText);
      if (!c.text.test(t)) bad = 'no text matching ' + c.text + (c.note ? ' (' + c.note + ')' : '');
    }
    if (!bad && c.metric) {
      const got = await page.evaluate((label) => {
        const card = [...document.querySelectorAll('.widget-card')].find(
          el => (el.querySelector('.widget-label') || {}).textContent === label);
        if (!card) return null;
        const v = card.querySelector('.metric-value');
        return { value: v ? v.textContent.trim() : null,
                 sub: card.textContent };
      }, c.metric);
      if (!got) bad = 'no widget labelled "' + c.metric + '"';
      else if (c.value != null && got.value !== c.value) bad = c.metric + ' reads "' + got.value + '", wanted "' + c.value + '"' + (c.note ? ' (' + c.note + ')' : '');
      else if (c.notValue != null && got.value === c.notValue) bad = c.metric + ' reads "' + got.value + '" — a dash here means the tile could not compute, but this feed carries the columns';
      else if (c.sub && !c.sub.test(got.sub || '')) bad = c.metric + ' does not say ' + c.sub;
    }
    console.log((bad ? '  ✗ ' : '  ✓ ') + c.name + (bad ? ': ' + bad : ''));
    if (bad) failures.push(c.name + ': ' + bad);
    if (c.viewport) await page.setViewport(BASE_VIEWPORT);
  }

  await browser.close();
  server.close();
  if (failures.length) {
    console.error('\n✗ ' + failures.length + ' render failure(s)');
    failures.forEach((f, i) => console.error('  ' + (i + 1) + '. ' + f));
    process.exit(1);
  }
  console.log('✓ the dashboard renders with no uncaught errors');
})().catch(e => { console.error(e); process.exit(1); });
