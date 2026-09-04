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
  { 'Signed Up At': liveIso(0, '13:06:40'), 'Customer Name': 'Ryan Little', 'Participant': 'Brayden Little',
    'Section': 'Boys (Grades 4-5) Tryouts', 'Program': 'SBA Travel Teams', 'Price': 25 },
  /* PART-PAID, and it has to be HIGH IN THE LIST: only the newest eight rows
     render, and the other part-paid row (Swim Lessons) sits ninth — so the
     orange-price assertion had nothing to read. A payment plan among the first
     three rows is what makes that case discriminating. */
  { 'Signed Up At': liveIso(0, '11:35:00'), 'Customer Name': 'Nicole Baldarelli', 'Participant': 'Cameron Baldarelli',
    'Section': 'Music, Movement & Sensory Play', 'Program': 'Music, Movement & Sensory Play',
    'Price': 60, 'Paid': 25 },
  /* YESTERDAY, and LATER IN THE DAY than the row above it — which is exactly
     what made the list look unsorted: a column showing only a clock cannot say
     that 8:15p was yesterday. This row is what proves the weekday prefix. */
  /* A SECOND signup on SBA Travel Teams, EARLIER in the day. Without it every
     programme in this fixture has exactly one registration, and a Programs
     Live card sorted by size would render identically to one sorted by
     recency — plausible, but unable to tell the two apart. */
  { 'Signed Up At': liveIso(0, '06:12:00'), 'Customer Name': 'Early Bird', 'Participant': 'Wren Bird',
    'Section': 'Boys (Grades 4-5) Tryouts', 'Program': 'SBA Travel Teams', 'Price': 25, 'Paid': 25 },
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

const FIXTURES = {
  memberships: MEMBERSHIPS,
  enrollments: ENROLLMENTS,
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
  availableReports: { memberships: true, enrollments: true },
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

const CASES = [
  { name: 'dashboard renders', needs: '.widget-card' },
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
  { name: 'live · the registrations card reads its own feed', needs: '[data-live-regs="30"]' },
  // 14 of the 16 rows are today. A widget printing rows.length reads 16.
  { name: 'live · and counts TODAY, not the list', needs: '[data-live-today="14"]' },
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
  { name: 'live · the list has column headers', needs: 'body[data-livehead="Time|Household owner|Participant|Section|Price"]',
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
    needs: '[data-live-regs] .live-table tbody tr:first-child[data-live-new="1"] td.ln',
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
    needs: '[data-live-regs] .live-timeline[data-live-marks="15"]',
    absent: '[data-live-regs] .live-timeline[data-live-marks="17"]' },
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
  /* ROWS FROM ANOTHER DAY SAY SO. The list is sorted newest-first and always
     was; a column showing only a clock made it look shuffled, because 8:15p
     yesterday sorts below 2:41p today. */
  { name: 'live · a row from another day carries its weekday',
    needs: 'body[data-liveday="1"]',
    act: async page => {
      await page.waitForSelector('[data-live-regs] .live-table tbody tr', { timeout: 15000 });
      await page.evaluate(() => {
        const cells = [...document.querySelectorAll('[data-live-regs] .live-table td.lt')].map(c => c.textContent.trim());
        const today = cells.filter(t => /^\d{1,2}:\d{2}[ap]$/.test(t)).length;
        const dated = cells.filter(t => /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2}:\d{2}[ap]$/.test(t)).length;
        if (today > 0 && dated > 0) document.body.setAttribute('data-liveday', '1');
      });
    } },
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
    needs: 'body[data-lp-first="Summer Camp"]',
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
    needs: '[data-live-progs] [data-live-prog="Summer Camp"]',
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
    needs: '[data-live-progs] [data-live-prog="Swim Lessons"] [data-live-prog-charged="240"]',
    absent: '[data-live-progs] [data-live-prog="Swim Lessons"] [data-live-prog-charged="480"]' },
  { name: 'live · ...with the charge underneath it on a payment plan',
    needs: 'body[data-lp-plan*="of $480 charged"]',
    act: async page => {
      await page.waitForSelector('[data-live-prog="Swim Lessons"]', { timeout: 15000 });
      await page.evaluate(() => {
        const c = document.querySelector('[data-live-prog="Swim Lessons"] .lm');
        document.body.setAttribute('data-lp-plan', c ? c.innerText.replace(/\s+/g, ' ').trim() : '');
      });
    } },
  { name: 'live · the column is called Program revenue',
    needs: 'body[data-lp-head*="program revenue"]',
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

  { name: 'live · the household owner links into Rec',
    needs: 'a.live-link[data-live-user="user-rita"][href="https://www.rec.us/admin/o/rec-org-uuid/users/user-rita"]' },
  { name: 'live · the section links into Rec',
    needs: 'a.live-link[data-live-section="sec-oxygen"][href="https://www.rec.us/admin/o/rec-org-uuid/programming/sections/sec-oxygen"]' },
  { name: 'live · a row with no id is plain text, not a dead link',
    needs: '[data-live-regs] .live-table tbody tr', absent: 'a.live-link[href$="/users/undefined"]' },
  /* EVERY BOLT, NOT THE FIRST ONE. This case used to read
     `querySelector('.live-bolt')` — the registrations card's — so the programs
     card's bolt was never checked, which is exactly the one Dan reported as
     dead ("The lightning bolt on the programs card isn't pulsing"). Both were
     in fact running; the guard could not have told us either way. */
  { name: 'live · every bolt is animated', needs: 'body[data-livebolt="2of2"]',
    act: async page => {
      await page.waitForSelector('[data-live-progs] .live-bolt', { timeout: 15000 });
      await page.evaluate(() => {
        const els = [...document.querySelectorAll('.live-bolt')];
        const running = els.filter(el => el.getAnimations && el.getAnimations().length > 0);
        document.body.setAttribute('data-livebolt', running.length + 'of' + els.length);
      });
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
    needs: '[data-live-regs] input[data-live-mute="1"]',
    absent: '.live-chime-pick',
    act: async page => {
      const checked = await page.$eval('input[data-live-mute="1"]', el => el.checked);
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
      await page.waitForFunction(() => /\bPaid \d/.test(document.body.innerText), { timeout: 10000 });
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
      await page.click('input[data-live-mute="1"]');
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
      const wasMuted = await page.$eval('input[data-live-mute="1"]', el => el.checked);
      if (wasMuted) await page.click('input[data-live-mute="1"]');
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
        return (rings === n && voiced === n && audio && n >= 9)
          ? 'ok' : ('rings=' + rings + ' voiced=' + voiced + ' of ' + n + ' audio=' + audio);
      }, names.length);
      await page.evaluate(v => document.body.setAttribute('data-chime-all', v), out);
      if (wasMuted) await page.click('input[data-live-mute="1"]');
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
      const seenBefore = await page.evaluate(() => document.body.innerText.match(/Unpaid \d+/g) || []);
      await page.waitForFunction((prev) => (document.body.innerText.match(/Unpaid \d+/g) || [])
        .some(x => prev.indexOf(x) < 0), { timeout: 15000 }, seenBefore);
      // The burst is staggered, so give the later handles time to have fired
      // had they been queued — a count read too early would hide a second ring.
      await new Promise(r => setTimeout(r, 600));
      const rings = await page.evaluate(() => window.__liveChimeRings || 0);
      await page.evaluate(n => document.body.setAttribute('data-chime-rings', String(n)), rings);
      // Re-tick it, or every case after this one runs on an unmuted dashboard.
      await page.click('input[data-live-mute="1"]');
    } },
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
    needs: '[data-live-prog="Youth Winter Basketball"] [data-live-prog-trend="down"]' },
  { name: 'live · ...and one that is climbing reads UP',
    needs: '[data-live-prog="Fall Volleyball"] [data-live-prog-trend="up"]' },
  /* AND A PROGRAMME WITH NO HISTORY CARRIES NO ARROW. Everything else in this
     fixture registered today only, so it sits under the floor — a build that
     drew a flat dash for those would be claiming a measurement it does not
     have. Summer Camp is the check: top of the card, one signup, today. */
  { name: 'live · a programme with no history shows no arrow at all',
    needs: '[data-live-prog="Summer Camp"] [data-live-prog-trend=""]' },

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
];

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/opt/pw-browsers/chromium',
  });
  let failures = [];
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
      if (/\/api\/config/.test(u)) return json(CONFIG);
      // fetchReportData reads json.rows off /:org/api/data/:reportType.
      const m = /\/api\/data\/([a-z-]+)/.exec(u);
      const rt = m ? m[1] : null;
      if (rt === 'enrollments') {
        enrollCalls++;
        return json({ rows: [...enrollArrivals(), ...ENROLLMENTS] });
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

  for (const c of CASES) {
    let bad = null;
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
