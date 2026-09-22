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
let msgCalls = 0;
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

/* ── HAPPENING TODAY ──────────────────────────────────────────────────────
   THE STATE IS PINNED AS MINUTES, so these cases are deterministic whenever
   CI happens to run. The card ships `Starts In` / `Ends In` against one
   absolute NOW; a page that went back to reading `new Date()` would compute
   from the printed clock instead and land on the wrong rows the moment the
   harness is not running at 10:15 on this date — which is almost always.

   THE CLOCK ON EACH ROW IS ITS LOCATION'S, NOT THE ORG'S, because that is
   what Rec's own admin shows. `sess-chi` is the row that proves the page
   honours it AND the reason the marker exists: it prints 9:30a and sits
   BELOW the 10:00a row, because the list is ordered by the actual moment and
   Chicago is an hour behind the org. Without the "Chicago time" note that
   reads as a sorting bug.

   SIX NAMED ROWS, SIX STATES, because rows of markup look identical under
   most regressions worth catching: one already finished (so the visible count
   is one short of the total), one running now, one in another zone, one with
   NO CAPACITY (which must read "4/—" and never "4/0"), one cancelled, and one
   evening class whose printed end is numerically before its printed start. */
const HT_NOW = '2026-09-11T10:15:00';
const HT_TZ  = 'America/New_York';
const htRow = (o) => Object.assign({
  'Org Now': HT_NOW, 'Org Today': '2026-09-11', 'Org Timezone': HT_TZ,
  'Display Timezone': HT_TZ,
  'Program': null, 'Location': null, 'Site': null, 'Site Count': 0,
  'Registration Mode': 'section', 'Cancelled': false, 'Published': true,
}, o);
const HAPPENING = [
  htRow({ 'Session Id': 'sess-yoga', 'Section Id': 'sec-yoga', 'Section': 'Sunrise Yoga',
          'Program': 'Yoga', 'Starts At': '2026-09-11T08:00:00', 'Ends At': '2026-09-11T09:00:00',
          'Starts In': -135, 'Ends In': -75,
          'Location': 'Rec Center', 'Site': 'Studio 1', 'Site Count': 1,
          'Enrolled': 12, 'Capacity': 12 }),
  htRow({ 'Session Id': 'sess-swim', 'Section Id': 'sec-swim', 'Section': 'Swim Lessons AM',
          'Program': 'Swim Lessons', 'Starts At': '2026-09-11T10:00:00', 'Ends At': '2026-09-11T11:00:00',
          'Starts In': -15, 'Ends In': 45,
          'Location': 'Aquatic Center', 'Site': 'Lane 1, Lane 2', 'Site Count': 2,
          'Enrolled': 8, 'Capacity': 20 }),
  /* ANOTHER ZONE. Printed 9:30a, starts FIFTEEN MINUTES FROM NOW — so it sits
     below the 10:00a row, and only the marker explains that. */
  htRow({ 'Session Id': 'sess-chi', 'Section Id': 'sec-chi', 'Section': 'Lakefront Volleyball',
          'Program': 'Volleyball', 'Starts At': '2026-09-11T09:30:00', 'Ends At': '2026-09-11T11:30:00',
          'Display Timezone': 'America/Chicago', 'Starts In': 15, 'Ends In': 135,
          'Location': 'Lake Shore Drive Courts', 'Site': 'Court 2', 'Site Count': 1,
          'Enrolled': 6, 'Capacity': 12 }),
  htRow({ 'Session Id': 'sess-open', 'Section Id': 'sec-open', 'Section': 'Open Gym',
          'Starts At': '2026-09-11T13:00:00', 'Ends At': '2026-09-11T14:00:00',
          'Starts In': 165, 'Ends In': 225,
          'Location': 'Field House', 'Enrolled': 4, 'Capacity': null, 'Published': false }),
  htRow({ 'Session Id': 'sess-pb', 'Section Id': 'sec-pb', 'Section': 'Pickleball Social',
          'Program': 'Pickleball', 'Starts At': '2026-09-11T15:00:00', 'Ends At': '2026-09-11T16:00:00',
          'Starts In': 285, 'Ends In': 345,
          'Location': 'Courts', 'Site': 'Court 3', 'Site Count': 1,
          'Enrolled': 6, 'Capacity': 16, 'Cancelled': true }),
  htRow({ 'Session Id': 'sess-vb', 'Section Id': 'sec-vb', 'Section': 'Evening Volleyball',
          'Program': 'Volleyball', 'Starts At': '2026-09-11T21:00:00', 'Ends At': '2026-09-12T00:30:00',
          'Starts In': 645, 'Ends In': 855,
          'Location': 'Gym', 'Site': 'Court A', 'Site Count': 1,
          'Enrolled': 18, 'Capacity': 24 }),
];
/* ENOUGH ROWS THAT THE LIST MUST SCROLL, and this padding is load-bearing.
   With six rows the list fits inside the card whatever its flex rules say, so
   a build that dropped `flex: 1 1 0` — the plausible half-fix, keeping only
   `overflow-y: auto` — renders identically and the scroller case passes on it.
   Caught by mutation, not by review. Twenty-five more upcoming sessions make
   an unbounded list obviously taller than the card it sits in. */
for (let i = 0; i < 25; i++) {
  const h = 11 + Math.floor(i / 3);
  const mm = (i % 3) * 20;
  const t = (n) => String(n).padStart(2, '0');
  HAPPENING.push(htRow({
    'Session Id': 'sess-fill-' + i, 'Section Id': 'sec-fill-' + i,
    'Section': 'Filler Session ' + i, 'Program': 'Filler',
    'Starts At': '2026-09-11T' + t(h) + ':' + t(mm) + ':00',
    'Ends At':   '2026-09-11T' + t(h) + ':' + t(mm + 15) + ':00',
    'Starts In': 45 + i * 20, 'Ends In': 60 + i * 20,
    'Location': 'Annex', 'Site': 'Room ' + i, 'Site Count': 1,
    'Enrolled': i % 7, 'Capacity': 10 }));
}

/* THE WHOLE DAY, ALREADY RUN. Every session ended before now, so the list is
   empty for a reason that is NOT "nothing was scheduled" — which is the one
   case where Dan's "enjoy the time off!" would be the wrong thing to print. */
const HAPPENING_DONE = HAPPENING.map(r => htRow(Object.assign({}, r, {
  'Starts At': '2026-09-11T06:00:00', 'Ends At': '2026-09-11T07:00:00',
  'Starts In': -255, 'Ends In': -195 })));


/* A DENSE DAY, shaped like Apex's real one: 468 scans between 05:46 and 14:29,
   peaking at 37 in the 8:45 quarter-hour. The lane's whole reason for changing
   form is this shape, and a fixture of seventeen scans cannot express it — so
   the dense cases drive their own feed rather than the shared one.

   THE COUNTS ARE THE REAL PER-QUARTER-HOUR SERIES, not a curve I invented, so
   the peak label the card prints is a number that came out of a rec centre. */
const DENSE_CI_BUCKETS = [[23,13],[24,1],[25,3],[26,5],[27,7],[28,4],[29,1],[30,7],[31,12],
  [32,21],[33,20],[34,16],[35,37],[36,12],[37,17],[38,26],[39,17],[40,17],[41,20],[42,12],
  [43,15],[44,18],[45,21],[46,14],[47,16],[48,13],[49,9],[50,12],[51,11],[52,14],[53,9],
  [54,8],[55,6],[56,4],[57,2]];
function denseCheckins() {
  const day = liveIso(0, '00:00:00').slice(0, 10);
  const rows = [];
  DENSE_CI_BUCKETS.forEach(([b, n]) => {
    for (let k = 0; k < n; k++) {
      const mins = b * 15 + Math.floor(k / Math.max(1, n) * 15);
      const hh = String(Math.floor(mins / 60)).padStart(2, '0');
      const mm = String(mins % 60).padStart(2, '0');
      rows.push({ 'Checked In At': day + 'T' + hh + ':' + mm + ':00', 'Org Today': day,
        /* ONE REFUSAL, in the busiest quarter-hour. Apex turned nobody away on
           the day this was measured, so the red would never render — and a
           stack that is only ever one colour cannot prove it stacks. */
        Member: 'Member ' + b + '-' + k, 'User ID': 'u' + b + '-' + k, 'Member ID': 'M' + b + k,
        Photo: null, Status: (b === 35 && k === 0) ? 'Failed' : 'Checked In',
        'Desk Location': 'Front Desk', Product: 'Adult Annual' });
    }
  });
  return rows;
}

/* ── CRM & MESSAGING ──────────────────────────────────────────────────────
   Every row is a case, and no two totals collide: 6 sends, 1,458 recipients,
   57 SMS, 1,401 email, 1,026 delivered, 22 bounced, 410 with no outcome
   recorded, $9.05 of SMS cost. A tile reading the wrong field lands on a
   number that is in this list exactly once, so it fails rather than looking
   plausible.

   THE 2025 ROW IS THE POINT. Email delivery webhooks were not wired until
   2026-02, so its 400 recipients carry neither a delivery nor a bounce. It
   drags the rate from 97.9% (delivered / terminal) to 70.4% (delivered /
   sent, which is Rec's own formula) — 27 points apart, so the two cannot be
   confused by rounding. */
const MESSAGING = [
  { 'Message ID': 'm1', 'Sent Date': '2025-11-04', Subject: 'Fall newsletter', Type: 'Marketing', Channel: 'EMAIL',
    Sender: 'Brian Hayden', Recipients: 400, Delivered: 0, Bounced: 0, 'No Outcome': 400,
    Complaints: 0, Clicked: 0, 'Cost Cents': 0, 'SMS Segments': 0, Segments: [] },
  // A segment name with a COMMA in it. A comma-split would render two segments
  // that do not exist, and both halves would look entirely plausible.
  { 'Message ID': 'm2', 'Sent Date': '2026-09-11', Subject: 'Last Chance for Zumba', Type: 'Marketing', Channel: 'EMAIL',
    Sender: 'Brian Hayden', Recipients: 1000, Delivered: 970, Bounced: 20, 'No Outcome': 10,
    Complaints: 1, Clicked: 40, 'Cost Cents': 0, 'SMS Segments': 0,
    Segments: ['Adults, Seniors', 'Opted Into Marketing'] },
  // Segments as a STRING — Metabase hands a jsonb column back either already
  // parsed or as text, and the page has to read both.
  { 'Message ID': 'm3', 'Sent Date': '2026-09-11', Subject: 'Pickleball tonight', Type: 'Marketing', Channel: 'SMS',
    Sender: 'Grace Lin', Recipients: 50, Delivered: 48, Bounced: 2, 'No Outcome': 0,
    Complaints: 0, Clicked: 0, 'Cost Cents': 800, 'SMS Segments': 60,
    Segments: '["Opted Into Marketing"]' },
  { 'Message ID': 'm4', 'Sent Date': '2026-09-12', Subject: 'Permit Request', Type: 'Transaction', Channel: 'EMAIL',
    Sender: 'Carol Ng-Lee', Recipients: 1, Delivered: 1, Bounced: 0, 'No Outcome': 0,
    Complaints: 0, Clicked: 0, 'Cost Cents': 0, 'SMS Segments': 0, Segments: [] },
  { 'Message ID': 'm5', 'Sent Date': '2026-09-12', Subject: 'Your booking is confirmed', Type: 'Transaction', Channel: 'SMS',
    Sender: 'Carol Ng-Lee', Recipients: 7, Delivered: 7, Bounced: 0, 'No Outcome': 0,
    Complaints: 0, Clicked: 0, 'Cost Cents': 105, 'SMS Segments': 7, Segments: [] },
  // A send whose audience resolved to nobody. Still a SEND, or the dashboard
  // disagrees with Rec's own Messages list about how many there were.
  { 'Message ID': 'm6', 'Sent Date': '2026-09-13', Subject: 'Empty audience', Type: 'Marketing', Channel: 'EMAIL',
    Sender: 'Grace Lin', Recipients: 0, Delivered: 0, Bounced: 0, 'No Outcome': 0,
    Complaints: 0, Clicked: 0, 'Cost Cents': 0, 'SMS Segments': 0, Segments: [] },
];

const FIXTURES = {
  messaging: MESSAGING,
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
                                              'mem-type-donut','tbl-mem-autorenew'] },
                /* ALL FOURTEEN messaging widgets, not the eleven defaults — a
                   transform that throws takes the whole page down, and the
                   three non-default ones would otherwise never be rendered by
                   anything. */
                { id: 'messaging', widgets: ['msg-sent','msg-recipients','msg-sms','msg-email',
                                             'msg-delivery-rate','msg-bounced','msg-no-outcome','msg-sms-cost',
                                             'msg-sms-segments','msg-avg-segments',
                                             'msg-segments-used','msg-by-channel','msg-by-type','msg-daily',
                                             'msg-top-segments','tbl-msg-campaigns'] }],
    toggles: { ai: false, reportLinks: true, aiBriefing: false, emailDigest: false },
    /* ALL FOUR LIVE CARDS ON, deliberately. Two of them default OFF now, and
       every case below that asserts a Programs Live or Facility Bookings card
       is about THAT CARD rather than about the default — so the fixture saves
       an explicit choice and those cases keep proving what they were written
       to prove. The DEFAULTS get their own cases at the very end of the list,
       on a config that saves no liveCards at all. */
    liveCards: { enrollments: true, programs: true, checkins: true, facility: true },
  },
  // enrollments present = the card has a public link, which is the ONLY
  // thing that puts the Live Widgets section on the page.
  availableReports: { memberships: true, enrollments: true, 'checkins-live': true, messaging: true },
  // The rec.us org uuid the admin links are addressed by. Deliberately NOT the
  // dashboard's own slug or token — a link built from those is the drift that
  // broke every report link for five weeks.
  recOrgId: 'rec-org-uuid',
  /* A CONFIGURED ALLOWANCE the fixture's SMS traffic is already OVER, because
     over is the state Irvine cares about and the only one that exercises the
     tone. The fixture carries 67 carrier segments across 57 texts, so an
     allowance of 50 reads 134% — a number no other tile on the card produces,
     where a round 100% could be arrived at by accident.

     The 57 texts against 67 segments also make the ratio 1.18, which is
     nothing like the 33.50 a per-SEND ratio would give over this fixture's 2
     SMS sends. A fixture where those two agreed could not tell the correct
     implementation from the one that divides by the wrong denominator. */
  smsThresholds: { smsSegmentLimit: 50, smsSegmentNotifyAt: null, smsSpendNotifyCents: 50000, smsNotifyEmail: '' },
  // The prefill this seeds. Its absence from orgMeta's whitelist is what made
  // the digest box silently never prefill, so the case below reads the BOX.
  defaultEmail: 'parks@rendercheck.gov',
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
/* ── The toolbar's weather card ────────────────────────────────────────────
   The readout is computed server-side, so the harness supplies it directly and
   the real open-meteo path is never reached. CONFIG deliberately carries NO
   `weather` key: an org with no coordinates is the common case and the honest
   default, so the baseline proves the absence and each case below opts in. */
const WX_CLEAR_DAY = { sky: 'clear', night: false, code: 0, temp: 71, feels: 69, label: 'Clear',
  hi: 76, lo: 58, wind: '7 mph', sunLabel: 'Sunset 6:47 PM', ahead: 'Rain arrives Sunday — 90%',
  day: 'Saturday', observedAt: '2026-09-19T16:48' };
const WX_RAIN_NIGHT = { ...WX_CLEAR_DAY, sky: 'rain', night: true, code: 61, temp: 48,
  feels: 44, label: 'Light rain', hi: 57, lo: 46, sunLabel: 'Sunrise 6:31 AM' };

/* A RELOAD ONTO THIS CASE'S SKY, then the computed styles stamped where a
   selector can reach them. The stamping is the point: a stylesheet reads
   plausibly whichever colours it holds, and "a card rendered" passes on a card
   painted in the wrong sky, on a night card still wearing daylight, and on
   particles that were never mounted. */
/* THE SKY BEHIND THE WHOLE PAGE. Everything here is computed style: a
   stylesheet reads plausibly whatever it holds, a layer that is present but
   trapped in a stacking context paints nothing, and a ground that was never
   tinted is the bug the first build of this shipped — a full sky behind a
   dense grid of opaque cards, indistinguishable from no sky at all. */
/* A MINIMAL PNG READER — enough to turn a screenshot into pixels. Puppeteer
   writes 8-bit colour-type 6 (RGBA) or 2 (RGB); anything else returns null and
   the caller reports nothing rather than guessing. No dependency: a PNG is
   zlib-compressed scanlines with a one-byte filter on each, and zlib ships with
   node. Worth the thirty lines — without pixels this check can only say the
   picture changed, which is what let the invisible build through. */
/* Set from the measurement in loadWet's comment, not by eye. */
const STRENGTH_FLOOR = 8;
function decodePng(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  let off = 8, w = 0, h = 0, depth = 0, ctype = 0;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0); h = body.readUInt32BE(4);
      depth = body[8]; ctype = body[9];
      if (depth !== 8 || (ctype !== 6 && ctype !== 2) || body[12] !== 0) return null; // no interlace
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!w || !h) return null;
  let raw;
  try { raw = require('zlib').inflateSync(Buffer.concat(idat)); } catch (e) { return null; }
  const bpp = ctype === 6 ? 4 : 3, stride = w * bpp;
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride), pos = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[pos++];
    const line = Buffer.from(raw.subarray(pos, pos + stride)); pos += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      if (f === 1) line[x] = (line[x] + a) & 255;
      else if (f === 2) line[x] = (line[x] + b) & 255;
      else if (f === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    for (let x = 0; x < w; x++) {
      out[(y * w + x) * 4] = line[x * bpp];
      out[(y * w + x) * 4 + 1] = line[x * bpp + 1];
      out[(y * w + x) * 4 + 2] = line[x * bpp + 2];
      out[(y * w + x) * 4 + 3] = bpp === 4 ? line[x * bpp + 3] : 255;
    }
    prev = line;
  }
  return { width: w, height: h, data: out };
}

/* CAN YOU ACTUALLY SEE IT FALL? Dan, on the merged page: "if it starts
   snowing there or raining, I better see snow and rain." The first version was
   lifted off the card, whose background is a dark saturated ramp, onto a page
   whose ground is a light tint — white-on-near-white, and snow was invisible.

   Neither `getAnimations()` nor a computed opacity can answer this: a layer can
   be running, painted and perfectly transparent against what it lands on. So
   this SCREENSHOTS a strip of the gutter twice — particles shown, then hidden
   — and reports how many of those pixels the weather actually changes. It is
   the only assertion here that measures the thing the complaint was about. */
async function loadWet(page) {
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.wx-layer .wx-fx', { timeout: 20000 });
  await new Promise(r => setTimeout(r, 650));
  const strip = await page.evaluate(() => {
    /* EVERYTHING BELOW THE SKY BAND, full width. Three things this shape has
       to get right, each of which the versions before it got wrong:

       - WIDE, because a 48px gutter strip made snow swing from a peak of 60 to
         21 between two runs of the same build: flakes are sparse and they
         drift, so which ones were inside the strip when the shutter fell
         decided the answer. A flaky assertion is not a guard.
       - NOT PINNED TO THE FOOT of the viewport, because a band at 68% landed
         on open ground in one fixture's layout and on solid cards in another —
         the probe and the harness then disagreed about the same build.
       - BELOW 30%, because that is where every ramp settles into the ground.
         Include the sky band and a particle that reads beautifully on the dark
         top and vanishes on the ground still scores well, which is precisely
         the bug being guarded against.

       Cards inside the band contribute nothing either way, so they dilute the
       share and leave the peak alone — which is why the peak is what decides. */
    return { x: 0, y: Math.round(innerHeight * 0.36), width: innerWidth,
             height: Math.round(innerHeight * 0.62) };
  });
  const on = await page.screenshot({ encoding: 'base64', clip: strip });
  await page.evaluate(() => {
    const st = document.createElement('style');
    st.id = 'wx-off';
    st.textContent = '.wx-fx, .wx-fx2 { display: none !important; }';
    document.head.appendChild(st);
  });
  await new Promise(r => setTimeout(r, 120));
  const off = await page.screenshot({ encoding: 'base64', clip: strip });
  await page.evaluate(() => { const n = document.getElementById('wx-off'); if (n) n.remove(); });

  /* PIXELS, NOT BYTES. The first version of this compared the two PNGs as
     files and asked whether they differed — which is an inequality where a
     MAGNITUDE was meant, and it passed happily on the invisible build: a
     one-unit change nobody can perceive still moves the bytes. Same defect as
     the hit test and the ground test before it. Decoded here rather than with
     a dependency, because a PNG is zlib scanlines and zlib is built in. */
  const A = decodePng(Buffer.from(on, 'base64'));
  const B = decodePng(Buffer.from(off, 'base64'));
  let peak = 0, lit = 0, sum = 0, n = 0;
  if (A && B && A.data.length === B.data.length) {
    for (let i = 0; i < A.data.length; i += 4) {
      const d = Math.max(Math.abs(A.data[i] - B.data[i]),
                         Math.abs(A.data[i + 1] - B.data[i + 1]),
                         Math.abs(A.data[i + 2] - B.data[i + 2]));
      if (d > peak) peak = d;
      if (d >= 6) { lit++; sum += d; }  // 6/255 is where a flat tone stops reading as flat
      n++;
    }
  }
  /* STRENGTH, NOT PEAK. The brightest single pixel swung 48 to 155 across
     three runs of the SAME build — it depends on where one streak happens to
     be when the shutter falls. The mean over the pixels the weather actually
     touches is the same quantity a reader perceives and barely moves between
     frames, so it is what the floor is set against; the peak is kept only
     because it is the useful number in a failure message. */
  const strength = lit ? sum / lit : 0;
  /* THE FLOORS ARE MEASURED, NOT PICKED, and this is the third threshold in
     this feature I first set by eye and had to correct. Across three runs of
     each build, over the same band:

                            strength / share of the band

         as merged     rain  6.5 / 3.10%   snow 13.4 / 0.04%   drizzle 19.7 / 0.03%   storm  7.5 / 0.41%
         with edges    rain 17.7 / 9.93%   snow 19.5 / 0.21%   drizzle 13.1 / 9.30%   storm 15.3 / 9.93%

     BOTH FLOORS CARRY REAL CASES, which is unusual enough to say: strength
     catches merged rain and storm (6.5 and 7.5 against a fixed minimum of
     12.1), and share catches merged snow and DRIZZLE, whose strength is a
     perfectly healthy 19.7 off a handful of pixels covering 0.03% of the band.
     That is the single-bright-spot case the share floor exists for, turning up
     in real data rather than in theory.

     Margins, over three runs of each: strength 12.1 low on the fixed build
     against 7.5 high on the merged one; share 0.21% low against 0.04% high.

     TWO EARLIER VERSIONS OF THIS CHECK WERE WRONG, both caught by measuring
     rather than by review. It first asked whether the two PNGs differed at all
     — an inequality where a magnitude was meant, which passes on a change
     nobody can see. Then it used peak >= 12, which PASSES the merged build for
     rain and snow, i.e. would not have caught the thing it was written for. */
  const share = n ? lit / n : 0;
  const visible = strength >= STRENGTH_FLOOR && share >= 0.0012;
  await page.evaluate((v, pk, sh) => {
    document.body.setAttribute('data-wet-visible', v ? '1' : '0');
    document.body.setAttribute('data-wet-peak', String(pk));
    document.body.setAttribute('data-wet-share', sh.toFixed(4));
  }, visible, peak, share);
  if (process.env.WET_DEBUG) console.log('      measured — strength ' + strength.toFixed(1)
    + '  share ' + (share * 100).toFixed(2) + '%  peak ' + peak
    + '  -> ' + (visible ? 'visible' : 'NOT VISIBLE'));
  /* deliberately NOT loadSky() afterwards: it opens with a reload, which would
     wipe the two attributes this hook exists to set. Cost an entire run. */
}

async function loadSky(page) {
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.dash-header', { timeout: 20000 });
  await page.evaluate(() => {
    const b = document.body, cs = getComputedStyle(b);
    const layer = document.querySelector('.wx-layer');
    const ground = cs.getPropertyValue('--wx-ground').trim();
    const pageBg = cs.getPropertyValue('--bg-page').trim();
    b.setAttribute('data-sky-portalled', layer && layer.parentElement === b ? '1' : '0');
    b.setAttribute('data-sky-ground', ground);
    /* A TINT, NOT A SUBSTITUTION. `ground !== pageBg` is not the claim and does
       not discriminate: a ramp hardcoded to a light grey differs from a dark
       page too, and that is exactly the bug — a sheet of daylight behind a
       dark-themed dashboard. What has to hold is that the ground is a BLEND of
       the page: a different colour, but near it in luminance in whichever
       theme the viewer picked. */
    const lum = (c) => {
      const m = String(c).match(/\d+(\.\d+)?/g);
      if (!m || m.length < 3) return null;
      const f = m.slice(0, 3).map(v => {
        const x = Number(v) / 255;
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
    };
    const lg = lum(ground), lp = lum(pageBg);
    const tinted = ground && pageBg && ground !== pageBg &&
      lg !== null && lp !== null && Math.abs(lg - lp) <= 0.22;
    b.setAttribute('data-sky-tinted', tinted ? '1' : '0');
    b.setAttribute('data-sky-lumgap', lg === null || lp === null ? '' : Math.abs(lg - lp).toFixed(3));
    b.setAttribute('data-sky-bg', layer ? getComputedStyle(layer.querySelector('.wx-sky')).backgroundImage.slice(0, 46) : '');
    const strip = document.querySelector('.settings-bar');
    b.setAttribute('data-sky-strip', strip ? getComputedStyle(strip).backgroundColor : '');
    /* WHAT IS ACTUALLY ON TOP. `body.has-wx > *:not(.wx-layer) { z-index: 1 }`
       is the only thing keeping a fixed, positioned layer from painting over
       the entire dashboard — and without it every selector below still finds
       its card, because the card is in the DOM either way.

       A HIT TEST CANNOT SEE THIS, and the first version of this stamp was one:
       `.wx-layer` is `pointer-events: none`, which `elementFromPoint` honours,
       so it can never return the layer and the assertion passed on the bug.
       Found by mutation, not by review.

       So the paint order is COMPUTED the way the browser resolves it: the layer
       is positioned at z-index 0, and a positioned z-index-0 element paints
       above every non-positioned in-flow sibling. The app therefore has to be
       positioned AND carry a higher z-index; on a tie the layer wins anyway,
       being appended to <body> after it. This reads the COMPUTED style, so it
       still fails when the rule is present but no longer matches. */
    const app = b.querySelector(':scope > div:not(.wx-layer)');
    let onTop = 'none';
    if (app && layer) {
      const az = getComputedStyle(app), lz = getComputedStyle(layer);
      const zOf = (cs) => cs.position === 'static' ? -1
        : (cs.zIndex === 'auto' ? 0 : Number(cs.zIndex) || 0);
      onTop = zOf(az) > zOf(lz) ? 'page' : 'sky';
      b.setAttribute('data-sky-z', zOf(az) + '/' + zOf(lz));
    }
    b.setAttribute('data-sky-ontop', onTop);
  });
}

async function loadWx(page) {
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.dash-header-left', { timeout: 20000 });
  await page.evaluate(() => {
    const c = document.querySelector('.wxc');
    const fx = document.querySelector('.wxc-fx');
    document.body.setAttribute('data-wxbg', c ? getComputedStyle(c).backgroundImage : '');
    document.body.setAttribute('data-wxfx', fx ? getComputedStyle(fx).backgroundImage : '');
    document.body.setAttribute('data-wxtheme', document.documentElement.getAttribute('data-theme') || '');
  });
}

async function loadLight(page) {
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('[data-live-section="1"]', { timeout: 20000 });
}

/* THE 2x CASES EACH RELOAD onto their own config, and stamp the header's own
   sub-line where a selector has to read it — `:has-text` is not a CSS
   selector, so "the place is in the header" has to become an attribute. */
async function loadCi(page) {
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('[data-live-checkins]', { timeout: 25000 });
  await page.evaluate(() => {
    const el = document.querySelector('[data-live-checkins] .widget-sub, [data-live-checkins] .live-sub');
    document.body.dataset.ciSub = el ? el.textContent : '';
  });
}
async function loadCi2(page) { await loadCi(page); }

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
      /* SCOPED TO THE ENROLLMENTS CARD. A bare `.live-pause input` is
         whichever card renders FIRST, and Happening Today took that place when
         it shipped — so this quietly paused the wrong card and the enrollments
         feed never refetched, failing three cases that had nothing to do with
         the change. A case that depends on card order stops testing what it
         names the moment the order moves. */
      await page.waitForSelector('[data-live-regs] .live-pause input', { timeout: 15000 });
      await page.click('[data-live-regs] .live-pause input');          // pause
      await page.click('[data-live-regs] .live-pause input');          // unpause -> immediate refetch
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

  /* ── HAPPENING TODAY ──────────────────────────────────────────────────
     KEYED ON COMPUTED VALUES, never on the card existing. Every regression
     worth catching here renders a perfectly plausible list: a page that kept
     finished sessions draws five rows, one that read the browser's clock
     draws them all grey, and one that printed Number(capacity) draws "4/0".
     Only the numbers separate them. */
  { name: 'live · happening today drops what has already finished',
    lightFeeds: true, needs: '[data-live-happening="31"] [data-ht-rows="30"]',
    act: loadLight },
  /* ABSENT FROM THE DOM, not merely greyed. Dan: "it bumps off the top of the
     list and the list scrolls up." */
  { name: 'live · ...the finished one is gone from the list entirely',
    lightFeeds: true, needs: '[data-ht-rows="30"]', absent: '[data-ht-session="sess-yoga"]' },
  /* THE STATE COMES OFF THE FEED, NOT OFF THE READER'S CLOCK. The fixture
     pins every row's `Starts In` / `Ends In` in minutes, so these hold whenever
     CI runs; a page that went back to reading `new Date()` against the printed
     clock lands on the wrong rows the moment it is not 10:15 on this date. */
  { name: 'live · ...the session running now is the green one',
    lightFeeds: true, needs: '[data-ht-session="sess-swim"][data-ht-row="live"]' },
  { name: 'live · ...and a later one is NOT green just because it is on the list',
    lightFeeds: true, needs: '[data-ht-session="sess-open"][data-ht-row="upcoming"]',
    absent: '[data-ht-session="sess-open"][data-ht-row="live"]' },
  /* THE GREEN IS CSS, so only a browser can say it is actually painted. A
     class that renders and styles nothing reads identically in source. */
  { name: 'live · ...and green means a green bar, not just a class name',
    lightFeeds: true, needs: 'body[data-ht-bar="rgb(22, 163, 74)"]',
    act: async page => {
      await page.waitForSelector('[data-ht-session="sess-swim"]', { timeout: 20000 });
      await page.evaluate(() => {
        const el = document.querySelector('[data-ht-session="sess-swim"]');
        document.body.setAttribute('data-ht-bar', getComputedStyle(el).borderLeftColor);
      });
    } },
  /* THE ROW'S CLOCK IS ITS LOCATION'S, which is what Rec's own page shows.
     Dan: "lets fix the time thing". The fixture's Chicago row PRINTS 9:30a
     while starting fifteen minutes from now, so a page that re-derived the
     time from anything else cannot produce it. */
  { name: 'live · ...a session in another zone keeps its own clock',
    lightFeeds: true, needs: '[data-ht-session="sess-chi"] [data-ht-when="9:30a–11:30a"]' },
  /* AND SAYS SO. The list is ordered by the instant, so that 9:30a sits BELOW
     a 10:00a row — without the marker that reads as a sorting bug. */
  { name: 'live · ...and says whose clock it is',
    lightFeeds: true, needs: '[data-ht-session="sess-chi"] [data-ht-zone="America/Chicago"]',
    text: /Chicago time/ },
  /* BUT ONLY WHEN IT DIFFERS. A marker on every row is noise, and on a
     single-zone org — which is every real one — there should be none at all. */
  { name: 'live · ...and stays quiet on a row in the org\'s own zone',
    lightFeeds: true, needs: '[data-ht-session="sess-swim"]',
    absent: '[data-ht-session="sess-swim"] [data-ht-zone]' },
  /* ORDERED BY THE MOMENT, NOT THE PRINTED CLOCK — 9:30a below 10:00a is the
     point. Sorting on what is displayed would put them the other way round. */
  { name: 'live · ...and the list is ordered by the moment, not the clock',
    lightFeeds: true, needs: 'body[data-ht-order="sess-swim,sess-chi"]',
    act: async page => {
      await page.waitForSelector('[data-ht-session="sess-chi"]', { timeout: 20000 });
      await page.evaluate(() => {
        const ids = [...document.querySelectorAll('[data-ht-session]')]
          .map(el => el.getAttribute('data-ht-session'))
          .filter(id => id === 'sess-swim' || id === 'sess-chi');
        document.body.setAttribute('data-ht-order', ids.join(','));
      });
    } },
  /* NULL CAPACITY IS UNLIMITED, NOT ZERO. Both halves: the dash present AND
     "4/0" absent — asserting the dash alone passes on a row that never
     rendered. */
  { name: 'live · ...a section with no capacity reads 4/— and never 4/0',
    lightFeeds: true, needs: '[data-ht-session="sess-open"] [data-ht-enrolled="4/—"]',
    absent: '[data-ht-enrolled="4/0"]' },
  { name: 'live · ...and a section with one reads Dan’s 8/20',
    lightFeeds: true, needs: '[data-ht-session="sess-swim"] [data-ht-enrolled="8/20"]' },
  /* A SESSION CAN HOLD MORE THAN ONE SITE — four, measured. Printing the first
     as though it were the whole booking is the confident half-truth. */
  { name: 'live · ...a session on two sites says +1 rather than naming one',
    lightFeeds: true, needs: '[data-ht-session="sess-swim"]',
    text: /Lane 1, Lane 2 \+1/ },
  /* THE LINK IS THE ASK: "clickable link directly to Rec admin". */
  { name: 'live · ...and the section name links into Rec',
    lightFeeds: true, needs: '[data-ht-link="sec-swim"][href*="/programming/sections/sec-swim"]' },
  { name: 'live · ...a cancelled session stays on the list and says so',
    lightFeeds: true, needs: '[data-ht-session="sess-pb"] [data-ht-cancelled="1"]' },
  /* THE LIST SCROLLS INSIDE THE CARD rather than growing it. Only a browser
     can say whether the box actually clips — `overflow-y: auto` with an
     unbounded row renders identically in source and scrolls nothing. */
  { name: 'live · ...and the list is a scroller, not a card that grew to fit',
    lightFeeds: true, needs: 'body[data-ht-scrolls="1"]',
    act: async page => {
      await page.waitForSelector('.ht-list', { timeout: 20000 });
      await page.evaluate(() => {
        const l = document.querySelector('.ht-list');
        const card = l.closest('.live-card');
        /* The list must be no taller than the card that holds it, and the
           card no taller than the two beside it stacked. */
        const others = [...document.querySelectorAll('.live-card')]
          .filter(c => c !== card).map(c => c.getBoundingClientRect().height);
        const tallestOther = Math.max.apply(null, others.concat([0]));
        /* IT REALLY CLIPS. Without this the case passes on a list that
           simply fits — which is what let the "overflow-y alone" mutation
           through on a five-row fixture. */
        const ok = l.scrollHeight > l.clientHeight + 8
                && l.clientHeight <= card.getBoundingClientRect().height + 1
                && card.getBoundingClientRect().height > tallestOther
                && getComputedStyle(l).overflowY === 'auto';
        document.body.setAttribute('data-ht-scrolls', ok ? '1' : '0');
      });
    } },
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
  /* ── THE LANE CHANGES FORM WHEN THE DAY DOES ──────────────────────────────
     Dan: "for small orgs, dots are good, for apex and other orgs, they need
     the bar." No source assertion can tell a working threshold from one that
     never fires — both render a lane — so these read WHICH FORM each card
     chose, over a fixture that puts two cards on opposite sides of it in the
     same paint. */
  { name: 'live · a busy day draws columns and a quiet one keeps its dots',
    lightFeeds: true, denseLane: true, needs: '[data-live-lane]',
    act: async page => {
      await loadLight(page);
      await page.waitForSelector('[data-live-ci-marks]', { timeout: 20000 });
      const got = await page.evaluate(() => {
        const pick = a => { const el = document.querySelector('[data-' + a + 'marks]');
                            return el && el.getAttribute('data-live-lane'); };
        const ci = document.querySelector('[data-live-ci-marks]');
        return { checkins: pick('live-ci-'), facility: pick('live-fac-'),
                 enrol: pick('live-'),
                 ciMarks: ci && Number(ci.getAttribute('data-live-ci-marks')),
                 peak: ci && ci.getAttribute('data-live-lane-peak'),
                 cols: document.querySelectorAll('[data-live-ci-marks] .lt-col').length,
                 dots: document.querySelectorAll('[data-live-ci-marks] .lt-mark').length,
                 facDots: document.querySelectorAll('[data-live-fac-marks] .lt-mark').length };
      });
      /* 440 scans is well over the threshold; 8 bookings is well under. Both
         cards are in one paint, so this cannot pass by the threshold being
         hardcoded either way. */
      if (got.checkins !== 'columns') throw new Error('a ' + got.ciMarks + '-scan day drew ' + got.checkins);
      if (got.facility !== 'dots') throw new Error('a handful of bookings drew ' + got.facility);
      if (got.dots !== 0) throw new Error('the busy lane still rendered ' + got.dots + ' dots');
      if (got.facDots === 0) throw new Error('the quiet lane lost its dots');
      /* THE PEAK IS THE POINT OF THE COLUMN FORM. 37 in the 8:45 quarter-hour
         is Apex's real busiest fifteen minutes; a lane that drew columns
         without a scale would read as "busier here than there" and no more. */
      if (got.peak !== '37') throw new Error('peak reads ' + got.peak + ', want 37');
      if (got.cols < 30) throw new Error('only ' + got.cols + ' columns for 35 busy quarter-hours');
    } },

  { name: 'live · a refusal stacks on its quarter-hour rather than shortening it',
    lightFeeds: true, denseLane: true, needs: '[data-live-lane-seg="failed"]',
    act: async page => {
      await loadLight(page);
      await page.waitForSelector('[data-live-lane-seg]', { timeout: 20000 });
      const got = await page.evaluate(() => {
        const bad = document.querySelector('[data-live-ci-marks] [data-live-lane-seg="failed"]');
        if (!bad) return { ok: false, why: 'no refused segment rendered' };
        const col = bad.closest('.lt-col');
        const good = col.querySelector('[data-live-lane-seg="ok"]');
        const cs = getComputedStyle(bad);
        return { ok: true, total: col.getAttribute('data-live-lane-bucket'),
                 hasGood: !!good, colour: cs.backgroundColor,
                 /* Stacked ON TOP: the red's `bottom` clears the green's height. */
                 stacked: good ? parseFloat(bad.style.bottom) >= parseFloat(good.style.height) - 0.01 : false };
      });
      if (!got.ok) throw new Error(got.why);
      if (!got.hasGood) throw new Error('the refused segment has no accepted scans under it to stack on');
      if (!got.stacked) throw new Error('the refusal is not stacked above the accepted scans');
      if (got.colour !== 'rgb(220, 38, 38)') throw new Error('a refusal is ' + got.colour + ', not the red it is everywhere else');
    } },

  /* THE GEOMETRY REGRESSION, in the only place it is visible. The compact
     cards shrank the lane and the third row of dots then sat BELOW it, on top
     of the hour labels — the stray "5a" in Dan's screenshot. Measured, not
     asserted in CSS: every mark's box inside its lane's box. */
  { name: 'live · no dot escapes its lane',
    lightFeeds: true, needs: '.live-card .lt-mark',
    act: async page => {
      await loadLight(page);
      await page.waitForSelector('.live-card .lt-mark', { timeout: 20000 });
      const bad = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('.live-card .live-timeline').forEach(lane => {
          const lb = lane.getBoundingClientRect();
          lane.querySelectorAll('.lt-mark').forEach(m => {
            const mb = m.getBoundingClientRect();
            if (mb.bottom > lb.bottom + 0.5) out.push(Math.round(mb.bottom - lb.bottom));
          });
        });
        return out;
      });
      if (bad.length) throw new Error(bad.length + ' dot(s) hang below the lane by up to '
                                      + Math.max(...bad) + 'px, onto the hour labels');
    } },

  /* DAN'S LAYOUT, MEASURED. His own words on the sketch: "programs live and
     facility bookings drop to a row underneath. Check ins and live enrollment
     are the same height, half of happening today." That is a geometric claim
     and NOTHING IN SOURCE CAN SEE IT — the spans and the `1fr` rows are
     asserted there, but whether they actually produce a tall card of exactly
     two short ones is a question about the rendered box. The tall card's
     content is a scroller, so a build whose row sizing failed would render a
     perfectly plausible card at whatever height its header needs.

     WITH FIVE CARDS THIS IS THREE ROWS AND NO LONGER FITS ONE SCREEN, which is
     a consequence of the layout Dan asked for rather than a regression — the
     fit assertion moved to the DEFAULT three-card set below, which is what an
     org actually opens on. */
  { name: 'live · the tall card is exactly the two beside it, stacked',
    lightFeeds: true, needs: '[data-live-fac-today]',
    viewport: { width: 1400, height: 900 },
    act: async page => {
      await loadLight(page);
      await page.waitForSelector('[data-live-fac-today]', { timeout: 20000 });
      const m = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.widget-card.live-card')];
        const h = (frag) => {
          const c = cards.find(x => (x.innerText || '').indexOf(frag) >= 0);
          return c ? Math.round(c.getBoundingClientRect().height) : null;
        };
        const grid = cards.length ? getComputedStyle(cards[0].parentElement) : null;
        return { n: cards.length, tall: h('Happening Today'), ci: h('Membership Check-Ins'),
                 en: h('Live Enrollments'), prog: h('Programs Live'), fac: h('Facility Bookings'),
                 gap: grid ? Math.round(parseFloat(grid.rowGap) || 0) : 0,
                 titles: cards.map(c => (c.innerText || '').split('\n')[0].slice(0, 30)) };
      });
      if (m.n !== 5) throw new Error('want five live cards, got ' + m.n + ': ' + JSON.stringify(m.titles));
      if (m.tall === null || m.ci === null || m.en === null)
        throw new Error('could not measure all three cards: ' + JSON.stringify(m));
      /* SAME HEIGHT AS EACH OTHER — the half of it the `1fr` rows buy. */
      if (Math.abs(m.ci - m.en) > 2)
        throw new Error('Check-Ins is ' + m.ci + 'px and Live Enrollments ' + m.en
                        + 'px — Dan asked for the same height');
      /* AND HALF OF HAPPENING TODAY, which is the two of them plus the gap. */
      if (Math.abs(m.tall - (m.ci + m.en + m.gap)) > 4)
        throw new Error('Happening Today is ' + m.tall + 'px against ' + m.ci + '+' + m.en
                        + '+' + m.gap + ' beside it — it is not two rows tall');
      /* AND THE OTHER TWO DROPPED TO A ROW UNDERNEATH, which is what makes the
         section three rows rather than two. */
      if (m.prog === null || m.fac === null)
        throw new Error('Programs Live and Facility Bookings are not both rendered: ' + JSON.stringify(m));
    } },

  /* ── THE PER-CARD DEFAULTS, IN A BROWSER ─────────────────────────────────
     Dan: "By default the live enrollments and check-in widgets should show up,
     but the other two must be manually enabled."

     NO SOURCE ASSERTION CAN SEE THIS. The resolver is unit-tested over the four
     ids, but whether the SECTION actually draws two cards and withholds two is
     a claim about the rendered DOM — a build that resolved correctly and then
     rendered all four (or a `!== false` slip) reads identically in source.

     LAST IN THE LIST, and that is not tidiness: these reload onto a config with
     no saved liveCards, and a reload sticks for every case after it. The
     lightFeeds block above records the same trap catching someone already. */
  /* TWO EMPTY STATES. Dan's line verbatim for a day with nothing on it... */
  { name: 'live · an empty day says enjoy the time off',
    lightFeeds: true, htEmpty: true, needs: '[data-ht-empty="none"]',
    text: /No programs happening today - enjoy the time off!/,
    act: loadLight },
  /* ...and NOT for a day that simply ran its course. Printing "enjoy the time
     off" at 9pm to a team that ran five sessions reads as the card having lost
     them. */
  { name: 'live · ...but a day that has finished does not',
    lightFeeds: true, htDone: true, needs: '[data-ht-empty="done"]',
    absent: '[data-ht-empty="none"]',
    act: loadLight },
  { name: 'live · by default only the enrollments, check-ins and happening cards render',
    liveDefaults: true, needs: '[data-live-section="1"] [data-live-regs]',
    act: async page => {
      await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
      await page.waitForSelector('[data-live-section="1"]', { timeout: 20000 });
    } },
  { name: 'live · ...check-ins is one of them',
    liveDefaults: true, needs: '[data-live-section="1"] [data-live-checkins]' },
  { name: 'live · ...and so is Happening Today, which Dan asked to lead the section',
    liveDefaults: true, needs: '[data-live-section="1"] [data-live-happening]' },
  /* ABSENT FROM THE DOM, not merely empty. "Renders nothing" and "renders a
     card with no rows" are different claims and only one of them is the ask. */
  { name: 'live · ...and Programs Live is ABSENT until it is switched on',
    liveDefaults: true, needs: '[data-live-section="1"]', absent: '[data-live-progs]' },
  { name: 'live · ...and so is Facility Bookings',
    liveDefaults: true, needs: '[data-live-section="1"]', absent: '[data-live-fac-today]' },
  /* THE COUNT, so a build that drew three could not pass the two absences by
     luck of a renamed attribute. */
  /* AND THE DEFAULT LAYOUT STILL FITS ONE SCREEN. Three cards is two grid
     rows — the tall one beside the two stacked — which is exactly the shape
     Dan sketched, and it is what an org that has never opened Edit Dashboard
     actually opens on. The headroom is the point of the 40px: "fits exactly"
     would pass at 899 of 900 and flip on any future row. */
  { name: 'live · the default three-card layout fits one screen',
    liveDefaults: true, needs: '[data-live-section="1"]',
    viewport: { width: 1400, height: 900 },
    act: async page => {
      await page.waitForSelector('.widget-card.live-card', { timeout: 20000 });
      const m = await page.evaluate(() => {
        const sect = document.querySelector('[data-live-section="1"]');
        return { n: document.querySelectorAll('.widget-card.live-card').length,
                 section: sect ? Math.round(sect.getBoundingClientRect().height) : 0,
                 viewport: window.innerHeight };
      });
      if (m.n !== 3) throw new Error('want three default live cards, got ' + m.n);
      if (m.section > m.viewport - 40)
        throw new Error('the live section is ' + m.section + 'px inside a ' + m.viewport
                        + 'px viewport — the default three do not fit');
    } },
  { name: 'live · ...exactly three cards, not five',
    liveDefaults: true, needs: 'body[data-live-default-cards="3"]',
    act: async page => {
      await page.waitForSelector('.widget-card.live-card', { timeout: 20000 });
      await page.evaluate(() => document.body.setAttribute('data-live-default-cards',
        String(document.querySelectorAll('.widget-card.live-card').length)));
    } },
  /* THE EDITOR AGREES WITH THE PAGE. A modal that opened with four empty boxes
     would switch the two ON defaults off on the next Save — the seeding bug. */
  { name: 'live · the editor opens with the three defaults ticked',
    liveDefaults: true, needs: '[data-edit-live-cards="3"]',
    act: async page => {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find(x => /Edit Dashboard/.test(x.textContent || ''));
        if (b) b.click();
      });
      await page.waitForSelector('.modal-body', { timeout: 15000 }).catch(() => {});
    } },
  { name: 'live · ...with Programs Live offered but clear',
    liveDefaults: true, needs: '[data-edit-live-card="programs"][data-edit-live-card-on="0"]' },
  { name: 'live · ...and Live Enrollments offered and ticked',
    liveDefaults: true, needs: '[data-edit-live-card="enrollments"][data-edit-live-card-on="1"]' },

  /* ── CRM & MESSAGING ─────────────────────────────────────────────────────
     Keyed on COMPUTED VALUES. "A messaging tile rendered" passes on a tile
     reading the wrong field, on a delivery rate taken over the wrong
     denominator, and on a segment list that split a name in half — all three
     of which render a perfectly plausible number. Every figure below appears
     exactly once in the fixture. */
  /* A RELOAD ONTO THE BASE CONFIG FIRST. The live cases above end with the
     Edit modal open over a lighter availability map, and the page is loaded
     once — so without this every case below ran against somebody else's page
     state and reported "no widget labelled …" on a section that renders
     perfectly. Found by running it, which is the whole argument for the
     render check existing. */
  { name: 'messaging · the section renders',
    act: async (page) => {
      await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
      await page.waitForSelector('[data-widget-id="msg-sms"]', { timeout: 30000 });
    },
    needs: '[data-widget-id="msg-sms"]' },
  { name: 'messaging · SMS Sent is the SMS recipients, not the send count',
    metric: 'SMS Sent', value: '57',
    note: 'two SMS sends reaching 50 and 7 — 2 would be the send count, 1,458 the whole feed' },
  { name: 'messaging · ...and says how many sends that was',
    metric: 'SMS Sent', sub: /2 sends/ },
  { name: 'messaging · Messages Sent counts SENDS',
    metric: 'Messages Sent', value: '6',
    note: '1,458 here would be counting recipients' },
  { name: 'messaging · Recipients Reached counts deliveries',
    metric: 'Recipients Reached', value: '1,458' },
  /* THE ALLOWANCE. 67 carrier segments against 57 texts — the tile must show
     the SEGMENT count, because that is what an SMS allowance is measured in
     and "SMS Sent" (57) is the number everyone reaches for instead. */
  { name: 'messaging · SMS Segments is the carrier count, not the message count',
    metric: 'SMS Segments', value: '67',
    note: '57 here would be the message count, which is what an allowance is NOT measured in' },
  /* THE BUCKET IS ALL-TIME. The windowed feed and the unwindowed one are the
     same stub here, so all-time reads 67 against the 50 bucket — over, and
     billed from here. What this case is really pinning is that the sub-line
     is the ALL-TIME position and says so, not a percentage of the window. */
  { name: 'messaging · ...against the one-time bucket, all time',
    metric: 'SMS Segments', sub: /67 of 50 used all time \(134%\)/,
    note: 'a tile ignoring smsThresholds renders a plausible 67 and no sub-line at all' },
  { name: 'messaging · ...and says billing starts past it',
    metric: 'SMS Segments', sub: /billed from here/ },
  /* THE CONVERSION. 1.18 per RECIPIENT; a per-SEND ratio over this fixture's
     two SMS sends would read 33.50, so the two implementations cannot be
     confused for one another here. */
  { name: 'messaging · Avg Segments per SMS divides by texts, not sends',
    metric: 'Avg Segments per SMS', value: '1.18',
    note: '33.50 would be segments per SEND — a campaign counted as one text' },
  { name: 'messaging · ...and shows the two numbers behind it',
    metric: 'Avg Segments per SMS', sub: /67 segments over 57 texts/ },
  /* "Segments" meant saved AUDIENCES on this card before the allowance work.
     Two tiles reading "Segments" is a number nobody can act on. */
  { name: 'messaging · the audience tile renders under its own name',
    metric: 'Audience Segments', value: '2',
    note: 'two saved audiences targeted. If this tile is still called "Segments Used" the lookup finds nothing and the case fails — which is the point, because two tiles reading "Segments" on one card is a number nobody can act on' },
  { name: 'messaging · emails are the rest',
    metric: 'Emails Sent', value: '1,401' },
  /* THE RATE IS REC'S OWN, delivered / SENT. 97.9% is delivered / terminal —
     the defensible-looking alternative that disagrees with the message page
     this section's own header links to. */
  { name: 'messaging · the delivery rate is Rec’s own formula',
    metric: 'Delivery Rate', value: '70.4%',
    note: '1,026 delivered of 1,458 sent; 97.9% would be dividing by terminal outcomes only' },
  { name: 'messaging · ...and says how much of the window it cannot speak for',
    metric: 'Delivery Rate', sub: /28\.1% with no outcome recorded/ },
  /* THE WEBHOOK GAP GETS ITS OWN TILE, because the rate is not believable
     without it. 410 of 1,458 recipients here have neither a delivery nor a
     bounce on file — the shape every 2025 email on the platform has. */
  { name: 'messaging · the unrecorded outcomes are a tile of their own',
    metric: 'No Outcome Recorded', value: '410' },
  { name: 'messaging · bounces are counted apart from them',
    metric: 'Bounced', value: '22' },
  { name: 'messaging · SMS cost is money, to the cent',
    metric: 'SMS Cost', value: '$9.05' },
  /* SEGMENTS. Watertown really has one called "Spring Pickleball Intermediate
     League Captains"; the fixture's is "Adults, Seniors". A comma split
     renders two segments that do not exist, and both halves look real. */
  /* SEGMENT NAMES ARE PROVED BY THE COUNT, NOT BY THE LABEL. The bar chart is
     a Chart.js CANVAS, so its labels are pixels and no DOM assertion can read
     them — a `text:` case on "Adults, Seniors" fails on a perfectly good page,
     which is what it did on the first run.

     The count discriminates anyway, and more cheaply: two segments were used,
     and a comma split reads THREE (Adults / Seniors / Opted Into Marketing)
     while still drawing something that looks exactly like a segment list. The
     name surviving whole is pinned directly in messaging-widgets.spec.js,
     which runs msgBySegment rather than looking at a canvas. */
  { name: 'messaging · a segment name with a comma is not split in two',
    metric: 'Audience Segments', value: '2',
    note: 'a comma split on "Adults, Seniors" reads 3 here' },
  /* NO OPEN RATE. first_opened_at is NULL and open_count is 0 on all 818,239
     deliveries platform-wide, so a tile here would be a confident number over
     nothing — and it is the tile somebody will ask for. */
  { name: 'messaging · no open-rate tile, because there is no open tracking',
    needs: '[data-widget-id="msg-delivery-rate"]', absent: '[data-widget-id*="open"]' },
  /* THE WAY OUT IS REC. Dan gave this URL for Watertown; the harness's org
     uuid is deliberately not the dashboard's slug or token, so a link built
     from the wrong identity cannot pass by looking similar. */
  { name: 'messaging · the header opens the org’s CRM portal in Rec',
    needs: 'a[data-rec-link="messaging"][href="https://www.rec.us/admin/o/rec-org-uuid/marketing/messages"]' },
  { name: 'messaging · ...in its own tab',
    needs: 'a[data-rec-link="messaging"][target="_blank"]' },
  { name: 'messaging · and no section invents a Rec link it was not given',
    needs: 'a[data-rec-link="messaging"]', absent: 'a[data-rec-link="memberships"]' },
  /* ABSENT UNTIL THE CARD HAS A PUBLIC LINK — and NOT FETCHED either. Gating
     only the render still fires a request that 404s and raises the
     dashboard's own failure banner naming a report the org never asked for,
     which is a louder version of the confident zero this exists to prevent.
     msgCalls is what proves the second half; the reload is what makes the
     flag mean anything, since the page is loaded once. */
  { name: 'messaging · absent until the card has a public link',
    msgHidden: true,
    act: async (page) => {
      msgCalls = 0;
      await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
      await page.waitForSelector('.widget-card', { timeout: 30000 });
      await new Promise(r => setTimeout(r, 800));
      if (msgCalls > 0) throw new Error('the feed was fetched ' + msgCalls + ' time(s) for a section the server cannot serve');
    },
    absent: 'a[data-rec-link="messaging"]' },
  { name: 'messaging · ...and its tiles go with it',
    msgHidden: true, absent: '[data-widget-id="msg-sms"]' },
  // Restores the page for anything after it, and proves the switch works in
  // the other direction: a case that only ever saw the section hidden would
  // pass on a section that can never appear.
  { name: 'messaging · ...and back the moment the link exists',
    act: async (page) => {
      await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
      await page.waitForSelector('.widget-card', { timeout: 30000 });
    },
    needs: 'a[data-rec-link="messaging"]' },

  /* ── The toolbar's weather card ─────────────────────────────────────────
     NONE of this is visible in source: the CSS reads plausibly whichever sky
     it paints, a class called `wxc-night` is not a night sky, and a card that
     renders in the wrong half of the toolbar is the same markup. */
  { name: 'weather · no reading means no card at all', act: loadWx, wx: null,
    needs: '.dash-header-left', absent: '.wxc' },
  { name: 'weather · the card is in the toolbar', act: loadWx, wx: WX_CLEAR_DAY,
    needs: '.wxc[data-wx-sky="clear"][data-wx-night="0"][data-wx-temp="71"]' },
  // Placement, not presence: both layouts render a card and a toolbar.
  { name: 'weather · ...beside the org name, not with the controls', act: loadWx, wx: WX_CLEAR_DAY,
    needs: '.dash-header-left > .wxc', absent: '.dash-header-right .wxc' },
  { name: 'weather · it reads the temperature and the condition', act: loadWx, wx: WX_CLEAR_DAY,
    needs: '.wxc .wxc-l1 b', text: /71°\s*Clear/ },
  { name: 'weather · the hi/lo line carries the sun', act: loadWx, wx: WX_CLEAR_DAY,
    needs: '.wxc .wxc-l2', text: /H 76° · L 58° · Sunset 6:47 PM/ },
  /* THE LOOK-AHEAD RIDES THE TOOLTIP. It is the one line a parks department
     acts on and it does not fit 206px, so it must be somewhere — losing it
     entirely is the regression this catches. */
  { name: 'weather · the rain look-ahead survives, on the tooltip', act: loadWx, wx: WX_CLEAR_DAY,
    needs: '.wxc[title*="Rain arrives Sunday"]' },
  /* NIGHT IS A MODIFIER. The night ramp must WIN — `.wxc-night.wxc-rain` is
     (0,2,0) against `.wxc-rain`'s (0,1,0) — and the rain must keep falling.
     Keyed on the COMPUTED gradient, because a class that is present and loses
     the cascade renders in broad daylight. */
  { name: 'weather · night paints its own sky', act: loadWx, wx: WX_RAIN_NIGHT,
    needs: 'body[data-wxbg*="rgb(19, 26, 34)"]',
    note: 'the night rain ramp starts #131a22; daylight rain starts #2f3a45' },
  { name: 'weather · ...and a wet night still rains', act: loadWx, wx: WX_RAIN_NIGHT,
    needs: '.wxc[data-wx-night="1"][data-wx-sky="rain"] .wxc-fx-rain',
    absent: 'body[data-wxfx="none"]' },
  /* NIGHT IS THE ORG'S CLOCK. The dashboard's own dark mode belongs to whoever
     is looking at it, and a card after sunset must not reach out and take it. */
  { name: 'weather · night leaves the viewer’s theme alone', act: loadWx, wx: WX_RAIN_NIGHT,
    needs: 'body[data-wxtheme="light"]' },
  /* An unknown sky must fall back to something that PAINTS. Un-whitelisted it
     builds `wxc-meteor-shower`, which has no rule at all — a transparent card
     sitting in the middle of the toolbar. */
  { name: 'weather · an unknown sky falls back rather than painting nothing', act: loadWx,
    wx: { ...WX_CLEAR_DAY, sky: 'meteor-shower' },
    needs: '.wxc[data-wx-sky="overcast"]', absent: 'body[data-wxbg="none"]' },
  { name: 'weather · a reading with no temperature renders nothing', act: loadWx,
    wx: { ...WX_CLEAR_DAY, temp: null }, needs: '.dash-header-left', absent: '.wxc' },
  /* Put the page back on the plain config, or whichever case runs next
     inherits this one's sky. */
  /* ── the sky behind the whole page ── */
  { name: 'weather · the sky is behind the whole page', act: loadSky, wx: WX_CLEAR_DAY,
    needs: 'body.has-wx.wx-clear .wx-layer' },
  /* A PORTAL, not a child of #root: `body.has-wx > *:not(.wx-layer)` needs the
     layer to be a SIBLING of the app, and a fixed layer inside a stacking
     context is trapped by it. Rendered in place it looks identical in source. */
  { name: 'weather · ...as a sibling of the app, not inside it', act: loadSky, wx: WX_CLEAR_DAY,
    needs: 'body[data-sky-portalled="1"]' },
  /* THE GROUND IS THE WHOLE POINT on a page this dense. The first build put a
     full sky behind 48 opaque cards and you could not tell overcast from clear. */
  { name: 'weather · ...and the ground is tinted by it', act: loadSky, wx: WX_CLEAR_DAY,
    needs: 'body[data-sky-tinted="1"]', absent: 'body[data-sky-ground=""]' },
  { name: 'weather · the tint survives dark theme', act: loadSky, wx: WX_CLEAR_DAY, theme: 'dark',
    needs: 'body[data-sky-tinted="1"]',
    note: 'the ground is MIXED INTO var(--bg-page): a substituted light grey is a sheet of daylight here' },
  { name: 'weather · night takes the page, not just the card', act: loadSky, wx: WX_RAIN_NIGHT,
    needs: 'body.has-wx.wx-night.wx-rain[data-sky-bg*="rgb(7, 13, 30)"]',
    note: 'the night ramp opens #070d1e; the daylight rain ramp opens #333d48' },
  { name: 'weather · the sky stays BEHIND the dashboard', act: loadSky, wx: WX_CLEAR_DAY,
    needs: 'body[data-sky-ontop="page"]', absent: 'body[data-sky-ontop="sky"]',
    note: 'computed paint order — every selector still finds its card when the layer paints over it' },
  { name: 'weather · the refresh strip keeps a plate over the sky', act: loadSky, wx: WX_RAIN_NIGHT,
    needs: '.settings-bar', absent: 'body[data-sky-strip="rgba(0, 0, 0, 0)"]' },
  { name: 'weather · no reading, no sky either', act: loadSky, wx: null,
    needs: '.dash-header', absent: '.wx-layer' },
  { name: 'weather · ...and the body carries no sky class', act: loadSky, wx: null,
    needs: 'body:not(.has-wx)', absent: 'body[class*="wx-"]' },
  { name: 'weather · the dashboard still renders around it', act: loadWx, wx: WX_CLEAR_DAY,
    needs: '.widget-card' },
  /* "I better see snow and rain." Measured in the GUTTER, on the ground —
     the card's own palette was designed against a dark ramp and white-on-
     near-white is where it failed. A running animation is not visibility. */
  { name: 'weather · the rain is actually visible on the page', act: loadWet,
    wx: { ...WX_CLEAR_DAY, sky: 'rain', label: 'Rain', night: false },
    needs: 'body.wx-rain[data-wet-visible="1"]', absent: 'body[data-wet-visible="0"]' },
  { name: 'weather · ...and so is the snow', act: loadWet,
    wx: { ...WX_CLEAR_DAY, sky: 'snow', label: 'Snow', temp: 28, night: false },
    needs: 'body.wx-snow[data-wet-visible="1"]', absent: 'body[data-wet-visible="0"]',
    note: 'white flakes on a light-tinted ground — the one that was invisible' },
  { name: 'weather · ...and a wet night still rains on the page', act: loadWet,
    wx: { ...WX_RAIN_NIGHT, sky: 'storm', label: 'Thunderstorm' },
    needs: 'body.wx-night.wx-storm[data-wet-visible="1"]', absent: 'body[data-wet-visible="0"]' },
  { name: 'weather · even drizzle is above the threshold of being seen', act: loadWet,
    wx: { ...WX_CLEAR_DAY, sky: 'drizzle', label: 'Light drizzle', night: false },
    needs: 'body.wx-drizzle[data-wet-visible="1"]', absent: 'body[data-wet-visible="0"]' },

  /* ── THE CHECK-INS CARD'S 2x HEIGHT ───────────────────────────────────
     Dan, on a screenshot with a red arrow pointing at the empty half of the
     card: "can we add a '2x height' option ... so it takes up the same height
     as the happening today widget", and then "there's mouse hover data there
     now, would like to show that under their profile photo in the '2x height'
     view."

     NONE OF THIS IS VISIBLE IN SOURCE. A grid span reads plausibly whether or
     not the two cards end up the same height; a list that grows its own row
     and one that scrolls inside it are the same markup; and a detail line
     under a face renders identically whether it was gated on `tall` or not.
     So these measure the rendered box and stamp the verdict.

     LAST IN THE LIST, AND EACH RELOADS. Cases are not independent in this
     harness — a reload sticks for everything after it — which is recorded
     twice already in this file and has caught someone both times. */
  { name: 'live · the check-ins card is its normal height by default',
    ciShort: true, needs: '[data-live-checkins][data-live-ci-tall="0"]',
    absent: '.ci-tall', act: loadCi },
  /* THE SHORT CARD IS UNCHANGED — Dan: "current size would show what's there
     now." Asserted on the same feeds the 2x cases use, so a build where the
     card failed to render entirely cannot pass these by absence. */
  { name: 'live · ...and prints no product under the face at that size',
    ciShort: true, needs: '[data-live-checkins]', absent: '[data-live-ci-product]' },
  { name: 'live · ...nor a check-in location',
    ciShort: true, needs: '[data-live-checkins]', absent: '[data-live-ci-where]' },
  /* TWELVE OF SIXTEEN, with the rest behind a "+4 more today" — which is the
     dead space the option exists to fill, measured rather than described. */
  { name: 'live · ...and caps the faces at twelve, with four held back',
    ciShort: true, needs: '[data-live-ci-people="12"]', absent: '[data-live-ci-more="0"]' },

  { name: 'live · the saved layout switches the 2x card on',
    ciTall: true, needs: '.ci-tall[data-live-checkins][data-live-ci-tall="1"]',
    act: loadCi },
  /* THE ASK, LITERALLY. "the same height as the happening today widget" — so
     the two boxes are measured and compared, which is the only assertion that
     can tell a card that spans two grid rows from one that merely says it
     does. `data-ci-heights` is stamped beside the verdict so a failure can be
     read off the DOM rather than guessed at. */
  { name: 'live · the 2x card is the same height as Happening Today',
    ciTall: true, needs: 'body[data-ci-sameheight="1"]',
    act: async page => {
      await page.waitForSelector('.ci-tall', { timeout: 20000 });
      await page.evaluate(() => {
        const ht = document.querySelector('[data-live-happening]');
        const ci = document.querySelector('[data-live-checkins]');
        if (!ht || !ci) { document.body.dataset.ciSameheight = 'missing'; return; }
        const a = ht.getBoundingClientRect().height;
        const b = ci.getBoundingClientRect().height;
        document.body.dataset.ciHeights = Math.round(a) + '/' + Math.round(b);
        document.body.dataset.ciSameheight = Math.abs(a - b) <= 2 ? '1' : '0';
      });
    } },
  /* AND IT IS ACTUALLY TALLER, not merely equal to a Happening card that
     collapsed with it. Equality alone passes on a build where both are short. */
  { name: 'live · ...and that height is genuinely double, not two short cards',
    ciTall: true, needs: 'body[data-ci-tallenough="1"]',
    act: async page => {
      await page.evaluate(() => {
        const ci = document.querySelector('[data-live-checkins]');
        const reg = document.querySelector('[data-live-regs]');
        if (!ci || !reg) { document.body.dataset.ciTallenough = 'missing'; return; }
        const b = ci.getBoundingClientRect().height;
        const r = reg.getBoundingClientRect().height;
        document.body.dataset.ciVsreg = Math.round(b) + '/' + Math.round(r);
        document.body.dataset.ciTallenough = b > r * 1.5 ? '1' : '0';
      });
    } },
  /* THE CAP RISES WITH THE HEIGHT. Sixteen of sixteen and no "+N more" — so a
     build that doubled the card and kept twelve faces fails here rather than
     shipping twice the empty space it was meant to remove. */
  { name: 'live · the 2x card shows every face rather than capping at twelve',
    ciTall: true, needs: '[data-live-ci-people="16"]', absent: '[data-live-ci-more]' },
  /* THE HOVER, PRINTED. Keyed on the VALUE, not on the element: a line wired
     to the wrong field renders a perfectly plausible second line. */
  { name: 'live · the 2x card prints the product under the face',
    ciTall: true, needs: '[data-live-ci-person="Ada Lovelace"] [data-live-ci-product="Adult Annual"]' },
  { name: 'live · ...and where they checked in',
    ciTall: true, needs: '[data-live-ci-person="Grace Hopper"] [data-live-ci-where="North Desk"]' },
  /* TWO PLACES IN THE FIXTURE, so the per-face line is the right call here —
     and the card says so on itself. */
  { name: 'live · ...because this org runs more than one',
    ciTall: true, needs: '[data-live-checkins][data-live-ci-wheres="2"].ci-where' },

  /* ONE DESK IS SAID ONCE. Eight orgs really run one, and a per-face line
     there is the same string repeated down the whole card. */
  { name: 'live · one place is hoisted into the header, not repeated per face',
    ciTall: true, ciOneDesk: true, needs: 'body[data-ci-sub~="Front"]',
    absent: '[data-live-ci-where]', act: loadCi2 },
  { name: 'live · ...and the card says it found only one',
    ciTall: true, ciOneDesk: true, needs: '[data-live-ci-wheres="1"]',
    absent: '[data-live-checkins].ci-where' },

  /* NO DESK AT ALL: the card's own placeholder is not a place, and must reach
     neither the faces nor the header. */
  { name: 'live · an org with no desks prints no place under any face',
    ciTall: true, ciNoDesk: true, needs: '[data-live-checkins][data-live-ci-wheres="0"]',
    absent: '[data-live-ci-where]', act: loadCi2 },
  { name: 'live · ...and never says "(No Desk Location)" in the header either',
    ciTall: true, ciNoDesk: true, needs: '[data-live-checkins]',
    text: /Members and passes as they scan in/, absent: 'body[data-ci-sub~="(No"]' },

  /* A BUSY AFTERNOON MUST NOT GROW THE GRID ROW. Apex scans 468 members before
     three; `.live-grid` sizes its rows `1fr`, so a list that kept its intrinsic
     height would push Happening Today's height with it and the section would
     re-lay-out as the day fills. The dense feed is that day, and the card has
     to still match Happening Today. */
  { name: 'live · a 470-scan afternoon still fits the same box',
    ciTall: true, denseLane: true, needs: 'body[data-ci-sameheight="1"]',
    act: async page => {
      await loadCi2(page);
      await page.evaluate(() => {
        const ht = document.querySelector('[data-live-happening]');
        const ci = document.querySelector('[data-live-checkins]');
        if (!ht || !ci) { document.body.dataset.ciSameheight = 'missing'; return; }
        const a = ht.getBoundingClientRect().height;
        const b = ci.getBoundingClientRect().height;
        document.body.dataset.ciHeights = Math.round(a) + '/' + Math.round(b);
        document.body.dataset.ciSameheight = Math.abs(a - b) <= 2 ? '1' : '0';
      });
    } },
  /* ...and the faces stay INSIDE it. Measured on that same 470-scan feed:
     the list is 696px of faces in an 864px card, so on this fixture they fit
     and nothing scrolls — the row is driven by Happening Today's own list,
     which really does scroll (1130px of sessions in a 776px box).

     SAID PLAINLY SO NOBODY READS THIS AS PROVING A SCROLL IT DOES NOT. An
     earlier draft asserted `scrollHeight > clientHeight` and failed on correct
     code for exactly that reason. What keeps a busy day bounded is the CAP —
     forty-eight faces however many scanned — and the overflow is the backstop
     for the day the cap is raised or the tiles widen. So this asserts the two
     things that are actually true and load-bearing: the list is bounded by the
     card it sits in, and it is set up to scroll rather than to push. */
  { name: 'live · ...with the faces bounded by the card rather than pushing it',
    ciTall: true, denseLane: true, needs: 'body[data-ci-bounded="1"]',
    act: async page => {
      await page.evaluate(() => {
        const el = document.querySelector('.ci-tall .live-ci-people');
        const card = document.querySelector('[data-live-checkins]');
        if (!el || !card) { document.body.dataset.ciBounded = 'missing'; return; }
        const cs = getComputedStyle(el);
        const inside = el.getBoundingClientRect().bottom <= card.getBoundingClientRect().bottom + 1;
        document.body.dataset.ciOverflow = cs.overflowY;
        document.body.dataset.ciBounded =
          inside && (cs.overflowY === 'auto' || cs.overflowY === 'scroll') &&
          cs.flexBasis === '0px' ? '1' : '0';
      });
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
            'facility-today': true, 'happening-today': true } });
        }
        /* AN ORG THAT HAS NEVER OPENED EDIT DASHBOARD. Every feed present, so
           presence cannot be what hides a card — the only thing deciding is
           the per-card default. `liveCards` is DELETED rather than set empty,
           because an empty object and an absent key are different inputs to
           the resolver and the absent one is what a real untouched org has. */
        if (currentCase.liveDefaults) {
          const cfg = { ...CONFIG.config };
          delete cfg.liveCards;
          return json({ ...CONFIG, config: cfg, availableReports: { memberships: true,
            'enrollments-today': true, 'enrollments-rollup': true, 'checkins-today': true,
            'facility-today': true, 'happening-today': true } });
        }
        /* THE SAVED 2x HEIGHT. Every feed present, because the claim under
           test is that the check-ins card ends up the SAME HEIGHT as Happening
           Today — which needs Happening Today on the page, and the default
           availability map does not carry it. */
        if (currentCase.ciTall) {
          return json({ ...CONFIG,
            config: { ...CONFIG.config, liveTall: { checkins: true } },
            availableReports: { memberships: true,
              'enrollments-today': true, 'enrollments-rollup': true, 'checkins-today': true,
              'facility-today': true, 'happening-today': true } });
        }
        /* THE SAME PAGE WITHOUT THE HEIGHT, so the short card can be asserted
           against the identical feeds — otherwise "no product line" would pass
           on a build where the whole card failed to render. */
        if (currentCase.ciShort) {
          return json({ ...CONFIG, availableReports: { memberships: true,
              'enrollments-today': true, 'enrollments-rollup': true, 'checkins-today': true,
              'facility-today': true, 'happening-today': true } });
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
        /* NO PUBLIC LINK YET. The whole absence rule in one flag: with the
           key gone from availableReports the section must be neither drawn
           NOR fetched, and msgCalls is what proves the second half. */
        if (currentCase.msgHidden) {
          const { messaging, ...rest } = CONFIG.availableReports;
          return json({ ...CONFIG, availableReports: rest });
        }
        // `!== undefined` and not truthiness: `wx: null` is a real case — it is
        // what an org with no coordinates gets, and the card must be absent.
        if (currentCase.wx !== undefined) {
          // `theme` rides along because the ground is mixed INTO the theme's own
          // page colour — the dark half is the case Dan's "full strength" choice
          // actually risked, and it is unreachable without setting it here.
          const cfg = currentCase.theme ? { ...CONFIG.config, theme: currentCase.theme } : CONFIG.config;
          return json({ ...CONFIG, config: cfg, weather: currentCase.wx });
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
      if (rt === 'happening-today') {
        if (currentCase.htEmpty) return json({ rows: [] });
        if (currentCase.htDone) return json({ rows: HAPPENING_DONE });
        return json({ rows: HAPPENING });
      }
      if (rt === 'facility-today') {
        const today = liveIso(0, '00:00:00').slice(0, 10);
        return json({ rows: FACILITY.map(r => ({ ...r, 'Org Today': today })) });
      }
      if (rt === 'checkins-today') {
        if (currentCase.denseLane) return json({ rows: denseCheckins() });
        const today = liveIso(0, '00:00:00').slice(0, 10);
        let rows = (FIXTURES['checkins-live'] || [])
          .filter(r => String(r['Checked In At']).slice(0, 10) === today)
          .map(r => ({ ...r, 'Org Today': today }));
        /* ONE DESK, which eight orgs really run — Piedmont 7,254 scans in 30
           days, Buffalo 2,126, Jurupa 1,526. The place must be said ONCE in the
           header rather than repeated under every face, and no source assertion
           can tell the two renders apart. */
        if (currentCase.ciOneDesk) rows = rows.map(r => ({ ...r, 'Desk Location': 'Front Desk' }));
        /* NO DESK AT ALL, which six orgs really have — taylor 809 scans,
           madison 586, malibu 350, the-ranch 251, yerba-buena 205,
           northern-door 141, all 0%. The card COALESCEs that to a literal, and
           printing it renders "(No Desk Location)" as though it were a place. */
        if (currentCase.ciNoDesk) rows = rows.map(r => ({ ...r, 'Desk Location': '(No Desk Location)' }));
        return json({ rows });
      }
      if (rt === 'messaging') msgCalls++;
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
