// Spec for the CRM & Messaging section (card 21913), added 2026-09-16.
//
// Dan: "lets add this as a widget on the dashboard project" — a gauge reading
// 5,304 SMS at West Haven — then "This might need a whole new 'CRM/Messaging'
// section on the dashboard. Could track total messages sent, SMS's, etc.
// Clicking into the section would take them to their CRM portal in Rec", and
// "there's a whole bunch of stuff here, segments, message counts, etc. email
// delivery rates (which are a bit sus)."
//
// ── THE RATES REALLY WERE SUS, AND THE REASON IS THE WHOLE SPEC ─────────────
// Email delivery webhooks were not wired until 2026-02. Measured platform-wide
// by month, delivered as a share of sent: 0.0% for every month of 2025 (15,158
// deliveries with delivered_at NULL and bounced_at NULL), 0.2% in 2026-01,
// 20.3% in 2026-02, 91.5% in 2026-03, then 96-98%. So a lifetime rate reads
// 91.6% and is a statement about the webhook, not about deliverability.
//
// A window with NO outcome recorded must therefore render nothing, not 0%.
// That is the load-bearing assertion here, and the fixture is built so a
// wrong implementation produces a wrong NUMBER rather than a vague failure.
//
// ── AND THE RATE MATCHES REC'S OWN PAGE, delivered / sent ───────────────────
// West Haven's "Last Chance to register for Zumba: Start Monday" reads
// "Sent 1,664 · Delivered 98.4%" in the Rec admin, and 1,637/1,664 = 98.38%.
// Dividing by the rows that reached a terminal state gives 99.3% instead —
// 0.9pp adrift of the page this section's own header links to. The fixture
// separates the two by 27 points, so the mutation cannot pass by luck.
//
// ── NO OPEN RATE, AND THAT IS MEASURED ─────────────────────────────────────
// `first_opened_at` is NULL and `open_count` is 0 on ALL 818,239 deliveries,
// both channels, every org. A 0% open rate would be a confident number over
// nothing — the `memberships.last_used_at` trap. The spec fails if one appears.
//
// Run: node scripts/messaging-widgets.spec.js

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const PAGE   = path.join(__dirname, '..', 'public', 'dashboard.html');
const SERVER = path.join(__dirname, '..', 'server.js');
const CARD   = path.join(__dirname, '..', 'sql', 'messaging.sql');
const ADMIN  = path.join(__dirname, '..', 'public', 'admin.html');

const src    = fs.readFileSync(PAGE, 'utf8');
const server = fs.readFileSync(SERVER, 'utf8');
const card   = fs.readFileSync(CARD, 'utf8');
const admin  = fs.readFileSync(ADMIN, 'utf8');

// The card's comments quote the forms this spec forbids, on purpose — they are
// named there as the traps they are. Strip them before asserting, or every
// "must not appear" test fails on correct SQL. Nth instance of that in these
// repos.
const cardExec = card.replace(/--[^\n]*/g, '');

let n = 0;
const ok = (cond, what) => { n++; assert.ok(cond, what); };
const is = (a, b, what) => { n++; assert.strictEqual(a, b, what); };
const near = (a, b, what) => { n++; assert.ok(Math.abs(a - b) < 0.05, what + ' (got ' + a + ', want ~' + b + ')'); };

// ═══════════════════════════════════════════════════════════════════════════
//  LIFT AND RUN the helpers. A regex over a rate passes on an inverted
//  comparison, and every defect this section can have is arithmetic.
// ═══════════════════════════════════════════════════════════════════════════
function lift(startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  assert.ok(a > 0, 'could not find ' + startMarker);
  const b = src.indexOf(endMarker, a);
  assert.ok(b > a, 'could not find ' + endMarker + ' after ' + startMarker);
  return src.slice(a, b);
}

const helperSrc = lift('function msgN(r, k)', '// ═══════════════════════════════════════════════════════\n//  SECTION REGISTRY');
ok(helperSrc.includes('function msgBySegment'), 'the lifted helper block reaches msgBySegment — otherwise everything below runs on a partial slice');

const sandbox = {};
// eslint-disable-next-line no-new-func
new Function('exports', helperSrc + '\nexports.msgN=msgN;exports.msgIsSms=msgIsSms;exports.msgIsMarketing=msgIsMarketing;'
  + 'exports.msgSegmentNames=msgSegmentNames;exports.msgTotals=msgTotals;exports.msgDeliveryRate=msgDeliveryRate;'
  + 'exports.msgNoOutcomeShare=msgNoOutcomeShare;exports.msgDaily=msgDaily;exports.msgBySegment=msgBySegment;')(sandbox);
const { msgSegmentNames, msgTotals, msgDeliveryRate, msgNoOutcomeShare, msgDaily, msgBySegment } = sandbox;

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
  // eslint-disable-next-line no-new-func
  return new Function('msgN', 'msgTotals', 'msgDeliveryRate', 'msgBySegment', 'msgDaily', 'shortDate',
    'return (' + body + ');')(sandbox.msgN, msgTotals, msgDeliveryRate, msgBySegment, msgDaily, d => String(d).slice(5));
}

// ═══════════════════════════════════════════════════════════════════════════
//  THE FIXTURE — every row is a case, and no two totals collide
// ═══════════════════════════════════════════════════════════════════════════
const ROWS = [
  // 2025: the webhook gap. Sent, and the provider never reported back.
  { 'Message ID': 'm1', 'Sent Date': '2025-11-04', Subject: 'Fall newsletter', Type: 'Marketing', Channel: 'EMAIL',
    Recipients: 400, Delivered: 0, Bounced: 0, 'No Outcome': 400, Complaints: 0, Clicked: 0,
    'Cost Cents': 0, 'SMS Segments': 0, Segments: [] },
  // A healthy 2026 campaign, targeting TWO segments — one of whose names has a
  // comma in it. A comma split would invent two segments that do not exist.
  { 'Message ID': 'm2', 'Sent Date': '2026-09-11', Subject: 'Last Chance for Zumba', Type: 'Marketing', Channel: 'EMAIL',
    Recipients: 1000, Delivered: 970, Bounced: 20, 'No Outcome': 10, Complaints: 1, Clicked: 40,
    'Cost Cents': 0, 'SMS Segments': 0, Segments: ['Adults, Seniors', 'Opted Into Marketing'] },
  // SMS, and its Segments arrive as a STRING — Metabase hands a jsonb column
  // back either already parsed or as text depending on what it infers.
  { 'Message ID': 'm3', 'Sent Date': '2026-09-11', Subject: 'Pickleball tonight', Type: 'Marketing', Channel: 'SMS',
    Recipients: 50, Delivered: 48, Bounced: 2, 'No Outcome': 0, Complaints: 0, Clicked: 0,
    'Cost Cents': 800, 'SMS Segments': 60, Segments: '["Opted Into Marketing"]' },
  // Transactional — a permit confirmation to one person. 266 of West Haven's
  // 394 sends are this shape, so folding them into "campaigns" is not a
  // rounding error.
  { 'Message ID': 'm4', 'Sent Date': '2026-09-12', Subject: 'Permit Request', Type: 'Transaction', Channel: 'EMAIL',
    Recipients: 1, Delivered: 1, Bounced: 0, 'No Outcome': 0, Complaints: 0, Clicked: 0,
    'Cost Cents': 0, 'SMS Segments': 0, Segments: [] },
  { 'Message ID': 'm5', 'Sent Date': '2026-09-12', Subject: 'Your booking is confirmed', Type: 'Transaction', Channel: 'SMS',
    Recipients: 7, Delivered: 7, Bounced: 0, 'No Outcome': 0, Complaints: 0, Clicked: 0,
    'Cost Cents': 105, 'SMS Segments': 7, Segments: [] },
  // A send whose segment resolved to nobody. Three exist platform-wide; they
  // must still count as a SEND or the dashboard disagrees with Rec's own list.
  { 'Message ID': 'm6', 'Sent Date': '2026-09-13', Subject: 'Empty audience', Type: 'Marketing', Channel: 'EMAIL',
    Recipients: 0, Delivered: 0, Bounced: 0, 'No Outcome': 0, Complaints: 0, Clicked: 0,
    'Cost Cents': 0, 'SMS Segments': 0, Segments: [] },
];

// ── msgTotals ──────────────────────────────────────────────────────────────
const T = msgTotals(ROWS);
is(T.sends, 6, 'six sends — a zero-recipient send is still a send');
is(T.recipients, 1458, 'recipients sum across every row');
is(T.smsRecipients, 57, 'SMS recipients are 50 + 7');
is(T.emailRecipients, 1401, 'email recipients are 400 + 1000 + 1 + 0');
is(T.smsSends, 2, 'two SMS sends');
is(T.emailSends, 4, 'four email sends');
is(T.marketingSends, 4, 'four marketing sends');
is(T.transactionalSends, 2, 'two transactional sends');
is(T.marketingRecipients, 1450, 'marketing reach');
is(T.transactionalRecipients, 8, 'transactional reach');
is(T.delivered, 1026, 'delivered');
is(T.bounced, 22, 'bounced');
is(T.noOutcome, 410, 'no outcome recorded');
is(T.costCents, 905, 'SMS cost in cents — email carries none');
is(T.smsSegments, 67, 'carrier segments');
is(T.segmentSends, 2, 'two sends targeted a segment');
is(T.recipients, T.smsRecipients + T.emailRecipients, 'the channel split partitions recipients exactly');
is(T.recipients, T.marketingRecipients + T.transactionalRecipients, 'the type split partitions recipients exactly');
is(T.recipients, T.delivered + T.bounced + T.noOutcome, 'the three outcomes partition recipients exactly — a fourth state would be money the page cannot account for');

// ── THE DELIVERY RATE ──────────────────────────────────────────────────────
near(msgDeliveryRate(ROWS), 70.37, "delivered / SENT is Rec's own formula");
ok(Math.abs(msgDeliveryRate(ROWS) - (1026 / 1048 * 100)) > 25,
  'and it is NOT delivered / terminal — the two are 27 points apart on this fixture, so the mutation cannot pass by luck');

// The Zumba send, reproduced: Rec's page says 98.4%.
near(msgDeliveryRate([{ Channel: 'EMAIL', Type: 'Marketing', Recipients: 1664, Delivered: 1637, Bounced: 13, 'No Outcome': 14 }]),
  98.38, "the rate reproduces the Rec admin's own 98.4% on the message Dan was looking at");

// THE WEBHOOK GAP: sent, and nothing came back.
is(msgDeliveryRate([ROWS[0]]), null,
  'a window that records NO outcome yields null, never 0% — 15,158 deliveries in 2025 are exactly this shape');
is(msgDeliveryRate([ROWS[0], ROWS[5]]), null,
  'adding a zero-recipient send does not conjure an outcome');
is(msgDeliveryRate([]), null, 'no rows, no rate');
is(msgDeliveryRate([ROWS[5]]), null, 'no recipients, no rate');
// ...but a REAL zero still shows.
is(msgDeliveryRate([{ Channel: 'EMAIL', Type: 'Marketing', Recipients: 10, Delivered: 0, Bounced: 10, 'No Outcome': 0 }]), 0,
  'a window where everything bounced reads 0%, not blank — that is an answer');
near(msgNoOutcomeShare(ROWS), 28.12, 'the unrecorded share is what lets a reader argue with the rate');
is(msgNoOutcomeShare([]), null, 'no rows, no share');

// ── SEGMENTS ───────────────────────────────────────────────────────────────
const segs = msgBySegment(ROWS);
const segNames = segs.map(e => e[0]);
ok(segNames.includes('Adults, Seniors'),
  'a segment name containing a comma survives as ONE segment — splitting on commas would invent two that do not exist');
ok(!segNames.includes('Adults') && !segNames.includes('Seniors'),
  '...and neither half appears on its own');
is(segs.length, 2, 'two distinct segments were used');
is(segs[0][0], 'Opted Into Marketing', 'ranked by SENDS, the same count Rec’s own Segments page shows under Usage');
is(segs[0][1], 2, 'and it was used by two sends — the array row and the string row');
is(msgSegmentNames(ROWS[2]).length, 1, 'a Segments column handed back as a JSON STRING is read, not dropped');
is(msgSegmentNames({ Segments: 'Adults, Seniors' }).length, 0,
  'a bare unparseable string yields nothing rather than a guessed split');
is(msgSegmentNames({}).length, 0, 'an absent Segments column yields nothing');
is(msgSegmentNames({ Segments: '{"not":"an array"}' }).length, 0, 'a non-array JSON value yields nothing');

// ── DAILY ──────────────────────────────────────────────────────────────────
const daily = msgDaily(ROWS);
is(daily.length, 4, 'four distinct send dates');
is(daily[0][0], '2025-11-04', 'ordered oldest first');
is(daily[1][1], 1050, 'the two 2026-09-11 sends sum — 1000 email + 50 SMS');
is(daily.reduce((s, e) => s + e[1], 0), T.recipients, 'the daily series totals to the same recipients as the tiles');

// ═══════════════════════════════════════════════════════════════════════════
//  THE WIDGETS — every one goes through the shared reducer
// ═══════════════════════════════════════════════════════════════════════════
is(transformOf('msg-sent')(ROWS).value, 6, 'Messages Sent counts SENDS');
is(transformOf('msg-recipients')(ROWS).value, 1458, 'Recipients Reached counts deliveries');
is(transformOf('msg-sms')(ROWS).value, 57, 'SMS Sent counts SMS recipients — the figure Dan’s gauge reads');
is(transformOf('msg-email')(ROWS).value, 1401, 'Emails Sent counts email recipients');
near(transformOf('msg-delivery-rate')(ROWS).value, 70.37, 'the tile reads the shared rate');
is(transformOf('msg-delivery-rate')([ROWS[0]]).value, null, 'and withholds it when nothing was recorded');
ok(/no delivery outcome/i.test(transformOf('msg-delivery-rate')([ROWS[0]]).sub || ''),
  '...saying so on screen rather than leaving a bare dash');
is(transformOf('msg-bounced')(ROWS).value, 22, 'Bounced');
is(transformOf('msg-no-outcome')(ROWS).value, 410, 'No Outcome Recorded is a tile of its own, not a footnote');
is(transformOf('msg-sms-cost')(ROWS).value, 9.05, 'SMS Cost is dollars, from cents');
is(transformOf('msg-segments-used')(ROWS).value, 2, 'Segments Used counts segments actually sent to');

const byChan = transformOf('msg-by-channel')(ROWS);
is(byChan.values.reduce((a, b) => a + b, 0), 1458, 'the channel donut totals to recipients');
const byType = transformOf('msg-by-type')(ROWS);
is(byType.labels[0], 'Marketing', 'marketing leads the type donut');
is(byType.values.reduce((a, b) => a + b, 0), 1458, 'the type donut totals to recipients');
is(transformOf('msg-daily')(ROWS).values.length, 4, 'the line has a point per send date');
is(transformOf('msg-top-segments')(ROWS).labels[0], 'Opted Into Marketing', 'the segment bar ranks by usage');

const tbl = transformOf('tbl-msg-campaigns')(ROWS);
is(tbl.data.length, 6, 'the table lists every send');
is(tbl.data[0][1], 'Last Chance for Zumba', 'ranked by recipients');
is(tbl.data[0][4], '1,000', 'with its reach');
const legacyRow = tbl.data.find(r => r[1] === 'Fall newsletter');
is(legacyRow[5], '—', 'a send with no recorded outcome shows a dash in the table, never 0%');
ok(tbl.columns.every(c => !/open/i.test(c)), 'no open-rate column anywhere — there is no open tracking on this platform');

// Every messaging widget reads the shared reducer rather than reducing inline.
const wBlock = lift("  // ── CRM & Messaging ──", "\n};");
const inlineReduces = (wBlock.match(/rows\.reduce\(/g) || []).length;
is(inlineReduces, 0, 'no messaging widget reduces the rows itself — nine tiles disagreeing about one window is the Programs-revenue defect');
ok(/msgTotals\(/.test(wBlock), 'they go through msgTotals');

// ═══════════════════════════════════════════════════════════════════════════
//  WIRING
// ═══════════════════════════════════════════════════════════════════════════
// The absence rule, lifted and RUN rather than regexed: with no public link
// the key must not exist at all, so availableReports has no entry, the route
// 404s and the section is neither offered nor drawn.
const uuidBlock = server.slice(server.indexOf('const CHECKINS_LIVE_UUID'), server.indexOf('};', server.indexOf('const SHARED_UUIDS = {')) + 2);
const sandbox2 = {};
// eslint-disable-next-line no-new-func
new Function('exports', uuidBlock.replace(/^\s*const MESSAGING_UUID = .*$/m, "const MESSAGING_UUID = '';")
  + '\nexports.EMPTY = SHARED_UUIDS;')(sandbox2);
is(sandbox2.EMPTY.messaging, undefined,
  'with an empty MESSAGING_UUID the key is OMITTED, not present-and-blank — a blank uuid builds a URL Metabase answers an error to, which renders as a broken report');
const sandbox3 = {};
// eslint-disable-next-line no-new-func
new Function('exports', uuidBlock.replace(/^\s*const MESSAGING_UUID = .*$/m, "const MESSAGING_UUID = 'abc-123';")
  + '\nexports.SET = SHARED_UUIDS;')(sandbox3);
is(sandbox3.SET.messaging, 'abc-123', '...and filling the uuid in is the whole wiring');

// The gate, lifted and RUN. Unknown counts as missing.
const gateSrc = lift('const SECTION_REQUIRES_FEED', '// Reports that show all-time data');
const sandbox4 = {};
// eslint-disable-next-line no-new-func
new Function('exports', gateSrc + '\nexports.miss=sectionFeedMissing;exports.filter=sectionsWithFeeds;')(sandbox4);
// DEFENSIVE, not load-bearing, and the mutation testing is what settled which.
// availableReports and config are set from one response in one handler today,
// so there is no observable state where config exists and the map is empty —
// the browser mutation that reads an empty map as "present" SURVIVES the
// render check, and is recorded as benign rather than dressed up. This stays
// because "they arrive together" is a property of one fetch handler, not a
// rule, and the day the map is fetched on its own the other reading is a
// doomed request on every load.
is(sandbox4.miss('messaging', {}), true,
  'an availableReports map that has not answered counts as MISSING');
is(sandbox4.miss('messaging', { messaging: 'uuid' }), false, 'and present once the feed exists');
is(sandbox4.miss('messaging', { gl: 'x' }), true, 'a map that answered without the key is a real absence');
is(sandbox4.miss('revenue', {}), false, 'an ungated section is never hidden by this — a blanket rule would blank the whole board on first paint');
is(sandbox4.filter([{ id: 'revenue' }, { id: 'messaging' }], {}).length, 1, 'the funnel drops what cannot be served');
is(sandbox4.filter([{ id: 'revenue' }, { id: 'messaging' }], { messaging: 'u' }).length, 2, '...and keeps it once it can');

// ONE funnel: neither fetch effect may read config.sections directly.
is((src.match(/config\.sections\.flatMap/g) || []).length, 0,
  'both fetch effects read feedSections — a hidden section that still fetches its feed is the louder half of the bug');
ok(/const dataKey = config && config !== 'new' \? JSON\.stringify\(feedSections/.test(src),
  'and the gate is folded into dataKey, so resolving availableReports re-runs them against the corrected set');

// The way out is Rec, and it is whitelisted.
const recSrc = lift('const REC_PAGES', 'const SECTION_REQUIRES_FEED');
const sandbox5 = {};
// eslint-disable-next-line no-new-func
new Function('exports', recSrc + '\nexports.url=recPageUrl;exports.map=SECTION_REC_PAGE;')(sandbox5);
is(sandbox5.url('d781690b-c5a0-43c5-8443-9ae43899528c', sandbox5.map.messaging),
  'https://www.rec.us/admin/o/d781690b-c5a0-43c5-8443-9ae43899528c/marketing/messages',
  "the header link is byte-identical to the URL Dan gave for Watertown");
is(sandbox5.url('d781690b-c5a0-43c5-8443-9ae43899528c', 'marketing/messages'), null,
  'a raw path is REFUSED — the builder knows a whitelist of page names, so a typo cannot become a confident 404 on somebody’s admin');
is(sandbox5.url('', sandbox5.map.messaging), null, 'no org uuid, no link');
is(sandbox5.url('org', 'users'), null, 'an unknown page name yields nothing');

ok(/data-rec-link=\{sectionId\}/.test(src), 'the link carries a hook a render case can key on');

// It is NOT a reporting-project report, and that absence is deliberate.
const reportMap = lift('const SECTION_REPORT_MAP = {', '};');
ok(!/messaging/.test(reportMap),
  'messaging is absent from SECTION_REPORT_MAP — there is no messaging report on the reporting project, so an entry would render a dead View Report link and hang this section’s visibility off a report nobody serves');

// The section exists and its defaults are real widgets.
const secBlock = lift('  messaging: { id: \'messaging\'', '\n  \'ai-briefing\'');
const defaults = JSON.parse(('[' + (secBlock.match(/defaultWidgets: \[([^\]]*)\]/) || [, ''])[1] + ']').replace(/'/g, '"'));
ok(defaults.length >= 8, 'the section ships a usable default layout');
defaults.forEach(id => ok(src.includes("'" + id + "': {"), 'default widget ' + id + ' exists in the registry'));
ok(defaults.includes('msg-sms'), 'SMS Sent is a default — it is the widget Dan asked for');
ok(defaults.includes('msg-no-outcome'),
  'and so is No Outcome Recorded: the tile that stops the delivery rate being read as deliverability is not an opt-in');

// ═══════════════════════════════════════════════════════════════════════════
//  THE CARD
// ═══════════════════════════════════════════════════════════════════════════
ok(/ORDER BY w\.sent_local DESC, w\.id\s*$/.test(cardExec.trimEnd()),
  'the trailing ORDER BY is intact — card 17300 lost one to transcription and nothing noticed');
is((cardExec.match(/\[\[/g) || []).length, 2, 'both date bounds are optional, or an undated request returns nothing');
ok(/m\.organization_id = \{\{org_id\}\}::uuid/.test(cardExec), 'scoped to one org');
// SCOPED TO sent_local, not a file-wide match: the two [[ ]] bounds also say
// "AT TIME ZONE c.tz", so a bare test is satisfied by different code and
// survives the mutation that strips the conversion from the emitted date —
// which it did, on the first run of this spec.
ok(/\(m\.created_at AT TIME ZONE c\.tz\) AS sent_local/.test(cardExec),
  'the emitted date is converted to the org\u2019s own timezone — Metabase renders Pacific, so an Eastern org\u2019s 1am send would otherwise land on the previous day');
ok(/\{\{start_date\}\}::timestamp AT TIME ZONE c\.tz/.test(cardExec),
  '...and so are the window bounds, or the window means a different day from the column it filters');
ok(!/first_opened_at|open_count/.test(cardExec),
  'the card selects no open-tracking column: both are empty on all 818,239 deliveries, and a 0% open rate is a confident number over nothing');
ok(/No Outcome/.test(cardExec), 'the third outcome is a column of its own');
ok(/JSONB_AGG/.test(cardExec), 'segment names travel as a JSON array, never a joined string');
ok(!/STRING_AGG\(s\.name/.test(cardExec), '...specifically not STRING_AGG, which a comma in a segment name would split');
ok(/message_delivery md\s*\n\s*JOIN win/.test(cardExec),
  'the delivery table is driven FROM the windowed message set, not scanned for the org');

// ═══════════════════════════════════════════════════════════════════════════
//  THE ORG'S DEFAULT EMAIL
// ═══════════════════════════════════════════════════════════════════════════
const emailFn = server.slice(server.indexOf('function normalizeOrgEmail'), server.indexOf('app.post(\'/admin/api/orgs\', adminAuth'));
const sandbox6 = {};
// eslint-disable-next-line no-new-func
new Function('exports', emailFn + '\nexports.n=normalizeOrgEmail;')(sandbox6);
is(sandbox6.n('parks@westhaven.gov').email, 'parks@westhaven.gov', 'a real address is kept');
is(sandbox6.n('  parks@westhaven.gov  ').email, 'parks@westhaven.gov', 'and trimmed');
is(sandbox6.n('').ok, true, 'empty is ALLOWED — every org onboarded before this field existed has none');
is(sandbox6.n('').email, '', '...and stays empty rather than becoming a made-up default');
is(sandbox6.n(undefined).ok, true, 'an absent field is empty, not invalid');
is(sandbox6.n('nope').ok, false, 'a malformed address is refused — a bad prefill fails silently every time somebody presses Send');
is(sandbox6.n('a@b').ok, false, 'a domain with no dot is refused');
is(sandbox6.n('a b@c.com').ok, false, 'whitespace is refused');
is((server.match(/normalizeOrgEmail\(/g) || []).length, 3,
  'ONE validator, read by the add route and the edit route — two copies is how a value is accepted by one and refused by the other');
ok(/app\.post\('\/admin\/api\/orgs\/:slug\/default-email'/.test(server),
  'the address is editable after creation, or the field does nothing for the twenty-nine orgs already onboarded');
ok(/defaultEmail: org\.defaultEmail \|\| ''/.test(server), 'and it reaches the dashboard');
ok(/defaultEmail: emailCheck\.email/.test(server), 'Add Org stores it on the ORG, not in dashboardConfigs — Reset Dashboard must not wipe the address the platform mails');
ok(/<input id="ao-email"/.test(admin), 'the Add Org modal carries the field');
ok(/defaultEmail \}\)/.test(admin) || /defaultEmail\s*\}/.test(admin), '...and sends it');
ok(/const \[sendEmail, setSendEmail\] = useState\(defaultEmail \|\| ''\)/.test(src),
  'the digest box is SEEDED from the default, never driven by it — an effect writing it back would take a typed address away mid-sentence');
ok(/const \[subEmail, setSubEmail\] = useState\(defaultEmail \|\| ''\)/.test(src), 'and so is the summary box');

console.log('✓ messaging-widgets.spec.js — ' + n + ' assertions passed.');
