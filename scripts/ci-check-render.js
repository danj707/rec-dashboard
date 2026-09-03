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
  { 'Signed Up At': liveIso(0, '11:35:00'), 'Customer Name': 'Nicole Baldarelli', 'Participant': 'Cameron Baldarelli',
    'Section': 'Music, Movement & Sensory Play', 'Program': 'Music, Movement & Sensory Play', 'Price': 60 },
  /* YESTERDAY, and LATER IN THE DAY than the row above it — which is exactly
     what made the list look unsorted: a column showing only a clock cannot say
     that 8:15p was yesterday. This row is what proves the weekday prefix. */
  { 'Signed Up At': liveIso(1, '20:15:37'), 'Customer Name': 'Kaitlin Gentile', 'Participant': 'Cecelia Gentile',
    'User ID': 'user-kaitlin', 'Section Id': 'sec-girls78',
    'Section': 'Girls Grades 7-8', 'Program': 'Shrewsbury Rec Youth Basketball', 'Price': 170, 'Paid': 0 },
  { 'Signed Up At': liveIso(3, '09:02:00'), 'Customer Name': 'Zaid Syed', 'Participant': null,
    'Section': 'Apple Picking', 'Program': 'Rec Connect Fall', 'Price': 30 },
];

/* THE SECOND POLL BRINGS ONE MORE. A widget that highlights arrivals can only
   be tested against a feed that CHANGES — with a constant payload the
   highlight is indistinguishable from no highlight at all. This row is newest,
   so it lands at the top, and it is the ONLY one that may light up. */
const ENROLL_ARRIVAL = { 'Signed Up At': liveIso(0, '23:59:01'), 'Customer Name': 'Newly Arrived',
  'Participant': 'Kid Arrived', 'Section': 'Just Registered', 'Program': 'Just Registered', 'Price': 42 };
let enrollCalls = 0;

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
  { name: 'live · the coffee counter reads its own feed', needs: '[data-live-coffee="5"]' },
  // THREE of the five rows are today. A widget printing rows.length reads 5.
  { name: 'live · and counts TODAY, not the list', needs: '[data-live-today="3"]' },
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
      await page.waitForSelector('.live-table thead th', { timeout: 15000 });
      await page.evaluate(() => {
        const hs = [...document.querySelectorAll('.live-table thead th')].map(h => h.textContent.trim());
        document.body.setAttribute('data-livehead', hs.join('|'));
        document.body.setAttribute('data-livefixed', getComputedStyle(document.querySelector('.live-table')).tableLayout);
      });
    } },
  { name: 'live · ...and fixed column tracks', needs: 'body[data-livefixed="fixed"]' },

  /* A NEW REGISTRATION HIGHLIGHTS, AND ONLY THE NEW ONE. Dan: "the new one(s)
     pop on the top, highlighted, then the highlighting fades." Unpausing
     forces the refresh, and the stub serves one extra row from the second call
     — so a widget that highlights everything, or nothing, fails. */
  { name: 'live · a new registration lands highlighted, at the top',
    needs: '.live-table tbody tr:first-child[data-live-new="1"] td.ln',
    act: async page => {
      await page.waitForSelector('.live-pause input', { timeout: 15000 });
      await page.click('.live-pause input');          // pause
      await page.click('.live-pause input');          // unpause -> immediate refetch
      await page.waitForSelector('[data-live-new="1"]', { timeout: 15000 });
    } },
  { name: 'live · ...and it is the only one highlighted',
    needs: '.live-table tbody tr:first-child[data-live-new="1"]',
    absent: '.live-table tbody tr:nth-child(2)[data-live-new="1"]' },
  /* THE TIMELINE replaced a per-day bar chart (Dan: "what is the odd bar chart
     there... how about a moving timeline of the days/time... and when people
     pay, it gets a dollar sign"). Keyed on the MARKS, because a lane with no
     marks in it renders as a perfectly good empty timeline. */
  { name: 'live · the timeline plots every registration', needs: '.live-timeline[data-live-marks="6"]' },
  { name: 'live · a paid registration carries a dollar sign', needs: '.lt-mark.paid[data-live-mark="paid"]' },
  { name: 'live · an unpaid one does not', needs: '.lt-mark[data-live-mark="unpaid"]',
    absent: '.lt-mark.paid[data-live-mark="unpaid"]' },
  { name: 'live · the last day is labelled Today', needs: '.lt-day.today' },
  /* ROWS FROM ANOTHER DAY SAY SO. The list is sorted newest-first and always
     was; a column showing only a clock made it look shuffled, because 8:15p
     yesterday sorts below 2:41p today. */
  { name: 'live · a row from another day carries its weekday',
    needs: 'body[data-liveday="1"]',
    act: async page => {
      await page.waitForSelector('.live-table tbody tr', { timeout: 15000 });
      await page.evaluate(() => {
        const cells = [...document.querySelectorAll('.live-table td.lt')].map(c => c.textContent.trim());
        const today = cells.filter(t => /^\d{1,2}:\d{2}[ap]$/.test(t)).length;
        const dated = cells.filter(t => /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2}:\d{2}[ap]$/.test(t)).length;
        if (today > 0 && dated > 0) document.body.setAttribute('data-liveday', '1');
      });
    } },
  /* LINKS INTO REC, built from the ids rather than the names — a link built
     from rec_id or from a section NAME renders identically and 404s. */
  { name: 'live · the household owner links into Rec',
    needs: 'a.live-link[data-live-user="user-rita"][href="https://www.rec.us/admin/o/rec-org-uuid/users/user-rita"]' },
  { name: 'live · the section links into Rec',
    needs: 'a.live-link[data-live-section="sec-oxygen"][href="https://www.rec.us/admin/o/rec-org-uuid/programming/sections/sec-oxygen"]' },
  { name: 'live · a row with no id is plain text, not a dead link',
    needs: '.live-table tbody tr', absent: 'a.live-link[href$="/users/undefined"]' },
  { name: 'live · the bolt is animated', needs: 'body[data-livebolt="1"]',
    act: async page => {
      await page.evaluate(() => {
        const el = document.querySelector('.live-bolt');
        const running = el && el.getAnimations && el.getAnimations().length > 0;
        if (running) document.body.setAttribute('data-livebolt', '1');
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
        return json({ rows: enrollCalls > 1 ? [ENROLL_ARRIVAL, ...ENROLLMENTS] : ENROLLMENTS });
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
