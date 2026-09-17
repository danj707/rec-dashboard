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
// Same marker slice, against a named source — the server half needs it, and a
// slice that silently read the wrong file would assert nothing about either.
function liftFrom(text, startMarker, endMarker) {
  const a = text.indexOf(startMarker);
  assert.ok(a > 0, 'could not find ' + startMarker);
  const b = text.indexOf(endMarker, a);
  assert.ok(b > a, 'could not find ' + endMarker + ' after ' + startMarker);
  return text.slice(a, b);
}
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

// ...and it IS filled in. The link exists and the tags are flipped, so an
// empty constant here is no longer a staging state — it is the section
// vanishing from every dashboard, silently, with the card healthy behind it.
// The omit-when-unset shape above stays because it is what makes the NEXT
// card safe to merge before its link exists; this asserts THIS one shipped.
const sandboxLive = {};
// eslint-disable-next-line no-new-func
new Function('exports', uuidBlock + '\nexports.LIVE = SHARED_UUIDS;')(sandboxLive);
ok(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(sandboxLive.LIVE.messaging || '')),
  'the shipped MESSAGING_UUID is a real public-link uuid, not empty and not a placeholder');
const liveUuids = Object.entries(sandboxLive.LIVE).filter(([k]) => k !== 'messaging').map(([, v]) => v);
ok(!liveUuids.includes(sandboxLive.LIVE.messaging),
  '...and it is not a copy of another card\'s link — a paste-over renders another report\'s numbers under these labels and looks entirely plausible');

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
// The claim is ONE DEFINITION and several readers, not a head count. Pinning
// the literal 3 broke the day a fourth caller (the SMS alert address) reused
// it correctly — the same brittleness as pinning the end of an array.
is((server.match(/function normalizeOrgEmail\(/g) || []).length, 1,
  'ONE validator — two copies is how a value is accepted by one route and refused by the other');
ok((server.match(/normalizeOrgEmail\(/g) || []).length >= 4,
  '...read by the add route, the edit route and the SMS alert address');
ok(/app\.post\('\/admin\/api\/orgs\/:slug\/default-email'/.test(server),
  'the address is editable after creation, or the field does nothing for the twenty-nine orgs already onboarded');
is((server.match(/defaultEmail: orgDefaultEmail\(org, /g) || []).length, 2,
  'both readers — the admin grid and the org config route — go through the store, or one of them serves an address the other does not');
ok(/defaultEmail: emailCheck\.email/.test(server), 'Add Org stores it on the ORG, not in dashboardConfigs — Reset Dashboard must not wipe the address the platform mails');
ok(/<input id="ao-email"/.test(admin), 'the Add Org modal carries the field');
ok(/defaultEmail \}\)/.test(admin) || /defaultEmail\s*\}/.test(admin), '...and sends it');
ok(/const \[sendEmail, setSendEmail\] = useState\(defaultEmail \|\| ''\)/.test(src),
  'the digest box is SEEDED from the default, never driven by it — an effect writing it back would take a typed address away mid-sentence');
ok(/const \[subEmail, setSubEmail\] = useState\(defaultEmail \|\| ''\)/.test(src), 'and so is the summary box');


// ═══════════════════════════════════════════════════════════════════════════
//  SMS ALLOWANCE — segments, the conversion, and the two alerts
// ═══════════════════════════════════════════════════════════════════════════
// THE WHITELIST BUG, pinned so it cannot come back. The server has sent
// defaultEmail since the field shipped; the page's orgMeta map is a WHITELIST
// and did not copy it, so `orgMeta.defaultEmail` was undefined and every box
// it seeds fell back to '' — indistinguishable from an org with no default.
// A source assertion is the only thing that can see this: the popover, the
// prop and the server were all correct on their own.
ok(/defaultEmail: json\.defaultEmail \|\| ''/.test(src),
  "orgMeta copies defaultEmail — it is a whitelist, so a key the server sends and this map forgets is absent SILENTLY and the prefill quietly never happens");
ok(/<SettingsPopover[^>]*defaultEmail=\{orgMeta\.defaultEmail/.test(src),
  '...and the popover is handed it');
ok(/<SettingsPopover[^>]*smsThresholds=\{window\._smsThresholds/.test(src),
  '...and the SMS thresholds too, or the boxes cannot seed from what is stored');
ok(/window\._smsThresholds = json\.smsThresholds \|\| null/.test(src),
  'the thresholds are published as null when unset, never {} — an empty object makes the tile claim an allowance of zero');

// The conversion helper, LIFTED AND RUN. Every defect here is arithmetic, and
// a regex passes on a ratio computed per SEND instead of per recipient.
const segSrc = lift('/* AVERAGE SEGMENTS PER SMS', '// SENDS per segment, not recipients');
const sb = {};
// eslint-disable-next-line no-new-func
new Function('exports', 'msgTotals', segSrc + '\nexports.avg=msgAvgSegments;exports.usage=msgSegmentUsage;')(sb, sandbox.msgTotals);

// A campaign to 1,600 people at 2 segments each. Per RECIPIENT this is 2.0;
// per SEND it would read 3200, which is the mistake the fixture exists to catch.
const bulk = [{ Channel: 'SMS', Recipients: 1600, 'SMS Segments': 3200, 'Cost Cents': 9600 }];
is(sb.avg(bulk), 2, 'segments per RECIPIENT, not per send — a send to 1,600 people is 1,600 texts');
is(sb.avg([]), null, 'no SMS in the window is NULL, never 1 — "no texts" and "one segment each" are different facts, and the second makes an allowance look twice as roomy');
is(sb.avg([{ Channel: 'EMAIL', Recipients: 500 }]), null, 'email does not count toward an SMS ratio');

// The measured platform shape: 17,850 messages, 35,604 segments.
const plat = [{ Channel: 'SMS', Recipients: 17850, 'SMS Segments': 35604, 'Cost Cents': 106812 }];
ok(Math.abs(sb.avg(plat) - 1.9946) < 0.0001, 'reproduces the measured platform mean of 1.99 segments per SMS');
ok(Math.round(10000 / sb.avg(plat)) === 5013,
  '...so a 10,000 SEGMENT allowance is about 5,013 real messages — the conversion the contract term hides');

/* THE BUCKET IS ALL-TIME AND THE WINDOW IS NOT. An org is given 10,000 or
   15,000 segments once at signup and billed per segment after; nothing
   refills. So the percentage must be taken from the all-time figure, never
   from whatever the date picker is showing.

   Watertown is the case that proves it: 6,863 all time against a 15,000
   bucket is 46% gone, while the same tile on a This-Month view holds 285. A
   percentage from the window reads 1.9% — an org that looks untouched and is
   actually halfway through. The fixture keeps the two numbers far apart for
   exactly that reason. */
const WIN = [{ Channel: 'SMS', Recipients: 149, 'SMS Segments': 285, 'Cost Cents': 855 }];
const ALL = { segments: 6863, messages: 3400 };

const u = sb.usage(WIN, { smsSegmentLimit: 15000 }, ALL);
is(u.windowSegments, 285, 'the big number is the WINDOW — that is the burn rate and every other tile follows the picker');
is(u.used, 6863, '...and the bucket position is ALL TIME');
is(Math.round(u.pct), 46, 'the percentage comes from all-time, not the window');
ok(Math.round((u.windowSegments / u.limit) * 100) === 2,
  '...and a window-based percentage would read 2%, which is the misreading this exists to prevent');
is(u.remaining, 8137, 'what is left of the one-time bucket');
is(u.over, false, 'under the bucket');

is(sb.usage(WIN, { smsSegmentLimit: 6863 }, ALL).over, true,
  'AT the bucket counts as used up — the next segment is billed');
is(sb.usage(WIN, { smsSegmentLimit: 200 }, ALL).remaining, 0, 'remaining never goes negative');

// The all-time feed is a second fetch and can be in flight or fail.
is(sb.usage(WIN, { smsSegmentLimit: 15000 }, null).used, null,
  'no all-time figure yet is NULL — deliberately not 0, which would claim an untouched bucket');
is(sb.usage(WIN, { smsSegmentLimit: 15000 }, null).pct, null,
  '...and no percentage is invented while it is unknown');
is(sb.usage(WIN, { smsSegmentLimit: 15000 }, null).over, false,
  '...and an org is never reported over a bucket we have not measured');

is(sb.usage(WIN, null, ALL).limit, null, 'no bucket configured is null, not zero');
is(sb.usage(WIN, null, ALL).pct, null, '...and no percentage is invented against it');
is(sb.usage(WIN, {}, ALL).over, false, 'an org with no bucket is never "over" it');

// The two tiles must not both be called Segments. "Segments" already meant
// saved AUDIENCES on this card; the allowance is counted in CARRIER segments.
ok(/'msg-segments-used': \{ label: 'Audience Segments'/.test(src),
  'the audience tile says AUDIENCE — two tiles reading "Segments" on one card is a number nobody can act on');
ok(/'msg-sms-segments': \{ label: 'SMS Segments'/.test(src), 'and the billing tile says SMS');
ok(/used all time/.test(src), 'the tile names the all-time position in words, or a reader cannot tell which window the percentage came from');
ok(/checking all-time use/.test(src),
  '...and says so while that second feed is in flight, rather than printing a percentage of a number it does not have');
ok(/if \(!t \|\| t\.smsSegmentLimit == null\) return;/.test(src),
  'the all-time fetch is gated on a configured bucket — an unwindowed messaging pull measured 4.8s and buys nothing for an org with no allowance');
ok(/if \(sectionFeedMissing\('messaging', availableReports\)\) return;/.test(src),
  "...and on the feed being servable at all — without it this asks for a report the org has no link for, 404s, and raises the failure banner naming a report nobody asked for. ONE gate, read the same way the section reads it");
ok(/_smsAllTime/.test(src) && !/_smsAllTime = \{ segments: 0/.test(src),
  'and the all-time global is only set from a real answer');
ok(/'msg-avg-segments'/.test(src) && /msg-sms-segments/.test(src),
  'both new tiles exist');
ok(/'msg-no-outcome','msg-sms-cost','msg-sms-segments','msg-avg-segments'/.test(src),
  'and both are ON by default — the allowance is the reason this section exists for Irvine');

// ── the server half ────────────────────────────────────────────────────────
const thrSrc = liftFrom(server, 'const SMS_THRESHOLD_MAX_SEGMENTS', 'function normalizeOrgEmail(v)');
const sbT = {};
// eslint-disable-next-line no-new-func
/* The slice now carries the threshold FILE STORE too, which reaches for path,
   fs, DATA_DIR and ensureDataDir. Injected rather than the marker moved: the
   store sits between the validator and the reader this lift is about, so
   narrowing the slice would cut one of them out. DATA_DIR points at a path
   that does not exist, so the module-scope load returns {} and the pure
   functions under test are unaffected. */
new Function('exports', 'normalizeOrgEmail', 'path', 'fs', 'DATA_DIR', 'ensureDataDir', thrSrc +
  '\nexports.norm=normalizeSmsThresholds;exports.point=smsSegmentAlertPoint;'
  + 'exports.store=smsThresholdStore;exports.read=orgSmsThresholds;')(
  sbT, sandbox6.n, require('path'), require('fs'), '/nonexistent-spec-dir', () => {});

is(JSON.stringify(sbT.store), '{}', 'an absent threshold file loads as {} rather than throwing — a fresh volume must not take the server down');
is(sbT.read({ smsSegmentLimit: 10 }, 'nosuchorg').smsSegmentLimit, 10,
  'with nothing stored the org record is read as-is');

is(sbT.norm({ smsSegmentLimit: 10000 }).thresholds.smsSegmentLimit, 10000, 'an allowance is stored');
is(sbT.norm({ smsSegmentLimit: '' }).thresholds.smsSegmentLimit, null,
  'blank switches the alert OFF as null — never 0, which would put every org permanently over its allowance');
is(sbT.norm({ smsSegmentLimit: 0 }).ok, false, 'zero is refused outright');
is(sbT.norm({ smsSegmentLimit: -5 }).ok, false, 'and so is a negative');
is(sbT.norm({ smsSegmentLimit: 1.5 }).ok, false, 'and a fraction of a segment');
is(sbT.norm({ smsSegmentLimit: 99999999999 }).ok, false, 'an implausible number is a typo, not a policy');
is(sbT.norm({ smsSpendNotifyCents: 30000 }).thresholds.smsSpendNotifyCents, 30000, 'spend is stored in CENTS');
is(sbT.norm({}, { smsSegmentLimit: 10000 }).thresholds.smsSegmentLimit, 10000,
  'an ABSENT key leaves the stored value alone — saving the spend alert must not clear the allowance');
is(sbT.norm({ smsNotifyEmail: 'nope' }).ok, false, 'the alert address goes through the same email validator');
is(sbT.norm({ smsNotifyEmail: '' }).thresholds.smsNotifyEmail, '', 'and blank is allowed — it falls back to the org default');

is(sbT.point({ smsSegmentLimit: 10000, smsSegmentNotifyAt: null }), 10000,
  'the alert DEFAULTS to the allowance — 10,000 set and nothing else means "tell me at 10,000", not "never tell me"');
is(sbT.point({ smsSegmentLimit: 10000, smsSegmentNotifyAt: 8000 }), 8000,
  '...and a lower alert is honoured, which is what "notify BEFORE exceeding" needs');
is(sbT.point({ smsSegmentLimit: null, smsSegmentNotifyAt: null }), null, 'nothing configured is no alert');

// The due-check, lifted and RUN — a regex passes on an inverted comparison.
const dueSrc = liftFrom(server, 'function smsAlertsDue(', 'function smsAlertRecipient(');
const sbD = {};
// eslint-disable-next-line no-new-func
new Function('exports', 'smsSegmentAlertPoint', dueSrc + '\nexports.due=smsAlertsDue;')(sbD, sbT.point);

const THR = { smsSegmentLimit: 10000, smsSegmentNotifyAt: null, smsSpendNotifyCents: 30000 };
is(sbD.due({ segments: 9999, costCents: 100 }, THR, {}).length, 0, 'under both thresholds, nothing fires');
is(sbD.due({ segments: 10000, costCents: 100 }, THR, {}).length, 1, 'AT the segment threshold it fires');
is(sbD.due({ segments: 10000, costCents: 100 }, THR, {})[0].kind, 'segments', '...naming which one');
is(sbD.due({ segments: 10, costCents: 30000 }, THR, {})[0].kind, 'spend', 'and spend fires on its own');
is(sbD.due({ segments: 10000, costCents: 30000 }, THR, {}).length, 2,
  'both can be due at once — Irvine wants both, and one must not mask the other');
is(sbD.due({ segments: 10000, costCents: 30000 }, THR, { segments: '2026-09' }).length, 1,
  'an alert already sent this month does not fire again — this service deploys several times a day');
is(sbD.due({ segments: 99999, costCents: 0 }, { smsSegmentLimit: null, smsSegmentNotifyAt: null, smsSpendNotifyCents: null }, {}).length, 0,
  'an org with no thresholds is never alerted, however much it sends');

/* ONE EMAIL PER PASS, LIFTED AND RUN over every combination. Crossing both
   thresholds in the same pass sent two messages carrying the identical figures
   block and the identical two paragraphs — Dan, on receiving them: "maybe a bit
   verbose but all good", then "yes, fold them into one email when both fire".

   RUN rather than regexed, because the defect worth catching is a subject or a
   line naming the WRONG threshold, and a regex over a template literal passes
   on all of them. */
const mailSrc = liftFrom(server, 'function smsAlertEmail(', 'async function runSmsAlertCheck(');
const sbM = {};
// eslint-disable-next-line no-new-func
new Function('exports', mailSrc + '\nexports.mail=smsAlertEmail;')(sbM);

const MU = { segments: 6863, messages: 3400, costCents: 20589 };
const MT = { smsSegmentLimit: 15000, smsSegmentNotifyAt: 6000, smsSpendNotifyCents: 20000 };
const SEG = { kind: 'segments', at: 6000 };
const SPD = { kind: 'spend', at: 20000 };

const both = sbM.mail([SEG, SPD], MU, MT, 'Watertown Recreation');
ok(/6,863 of 15,000 SMS segments used/.test(both.subject) && /\$205\.89 spent/.test(both.subject),
  'both fired: ONE subject carrying both numbers — the number leads, because that is what is readable in an inbox list');
ok(/both been reached/.test(both.body), '...and the opener says both');
ok(/Segment alert at  6,000 segments/.test(both.body) && /Spend alert at    \$200\.00/.test(both.body),
  '...with one line per threshold actually crossed, which is the only part that differs');
is((both.body.match(/Carrier cost/g) || []).length, 1,
  'the shared figures block appears ONCE — the duplication was the verbosity, not the wording');
is((both.body.match(/billed in 160-character segments/g) || []).length, 1,
  '...and so does the explanation nobody expects');

const segOnly = sbM.mail([SEG], MU, MT, 'Watertown Recreation');
ok(/segments used$/.test(segOnly.subject), 'segments alone keeps its own subject');
ok(/The SMS segment alert has been reached/.test(segOnly.body), '...and its own opener');
ok(!/Spend alert at/.test(segOnly.body),
  '...and does NOT name a spend threshold that has not been crossed');

const spendOnly = sbM.mail([SPD], MU, MT, 'Watertown Recreation');
ok(/\$205\.89 of SMS spend to date/.test(spendOnly.subject), 'spend alone keeps its own subject');
ok(!/Segment alert at/.test(spendOnly.body),
  '...and does NOT name a segment threshold that has not been crossed');
ok(/8,137 segments remain/.test(spendOnly.body),
  '...while still stating the bucket position, which is what the reader acts on either way');

is((server.match(/function smsAlertEmail\(/g) || []).length, 1,
  'ONE composer — a second copy is how the folded email and a single one start disagreeing about the same figures');
ok(/for \(const d of due\) smsAlerts\[slug\]\[d\.kind\] = new Date\(\)\.toISOString\(\);\s*\n\s*saveSmsAlerts\(smsAlerts\);/.test(server),
  'EVERY due threshold is marked before the send — otherwise the next pass re-announces the half of a folded email that already landed');
is((server.match(/await sendOrgEmail\(to, subject, body\)/g) || []).length, 1,
  '...and the send is ONE call, not one per threshold');
ok(!/for \(const d of due\) \{[\s\S]{0,400}sendOrgEmail/.test(server),
  '...outside the per-threshold loop entirely, which is the fold');

// Only configured orgs are probed — the cost gate, and the reason this job is
// free until somebody is given an allowance.
ok(/function smsAlertOrgs\(\)[\s\S]{0,320}smsSegmentAlertPoint\(t\) != null \|\| t\.smsSpendNotifyCents != null/.test(server),
  'only orgs with a threshold are probed — fanning the messaging card at ~29 orgs hourly is the prewarm storm the reporting project already paid for');
ok(/THE BUCKET IS ALL-TIME AND DOES NOT REFILL/.test(server),
  'the alert reads the whole account, not a window — the bucket is given once at signup and billing starts when it is gone');
ok(/fetchMetabaseData\(slug, 'messaging', \{\}\)/.test(server),
  '...so the probe sends NO date bounds; the card reports every send when its [[ ]] blocks drop out');
ok(!/smsMonthRange|smsMonthKey/.test(server),
  'and the calendar-month window is gone entirely — a bucket crossed in September is still crossed in October');
ok(/smsAlerts\[slug\]\[d\.kind\] = new Date\(\)\.toISOString\(\)/.test(server),
  'the fired marker is keyed by org + threshold, NOT by month — re-arming monthly would announce the same exhausted bucket every month');
/* Was pinned to `const isSeg`, the line that used to follow it — the fold
   removed that line, so it now tests the ORDERING it was always about. */
ok(server.indexOf('saveSmsAlerts(smsAlerts);', server.indexOf('for (const d of due) smsAlerts[slug]'))
     < server.indexOf('await sendOrgEmail(to, subject, body)'),
  'the fired marker is written BEFORE the send — a send that throws is one missed email, a mark that never lands is the same email every hour forever');
ok(/const SMS_ALERT_FILE = path\.join\(DATA_DIR, 'sms-alerts\.json'\)/.test(server),
  '...and it is on disk, or every deploy re-alerts');
ok(/function smsAlertRecipient\(org, slug\) \{\s*\n\s*return orgSmsThresholds\(org, slug\)\.smsNotifyEmail \|\| orgDefaultEmail\(org, slug\);/.test(server),
  "the org's own alert address wins, with the platform default as the fallback — which is what that field was added for");
// BOTH SIDES READ THEIR STORE. A fresh process has nothing on the ORGS entry,
// so reading org.smsNotifyEmail / org.defaultEmail raw sends the alert to the
// fallback address — or to nobody — while both stores hold the right one. The
// bug only appears after a deploy, which is exactly when the alert matters.
ok(!/function smsAlertRecipient\([\s\S]{0,300}org\.smsNotifyEmail\)/.test(server),
  '...and neither side is read raw off the org record, which is empty on a fresh boot');
ok(/const to = smsAlertRecipient\(org, slug\);/.test(server),
  'the caller passes the slug, or the stores cannot be consulted at all');
ok(/sendOpsAlert\(`⚠️ \$\{subject\} \(no alert email set/.test(server),
  'an org with no address still raises the crossing to ops — silence about a contractual allowance is the one outcome nobody wants');
/* PERSISTENCE, AND IT IS NOT saveDynamicOrgs. That writes only the orgs that
   came from the store, so a STATIC org kept its allowance in one process's
   memory and lost it on the next deploy. Watertown is static and hit exactly
   that within minutes of the feature shipping — the value saved, the tile
   showed it, and the log said "(static org — not persisted)". An allowance is
   a contract term; losing it quietly is the worst available failure. */
ok(/const SMS_THRESHOLD_FILE = path\.join\(DATA_DIR, 'sms-thresholds\.json'\)/.test(server),
  'thresholds persist in a file of their own, keyed by slug — not on the org record, which only survives for dynamic orgs');
ok(/smsThresholdStore\[slug\] = check\.thresholds;\s*\n\s*saveSmsThresholdStore\(smsThresholdStore\);/.test(server),
  '...and every save writes it');
ok(!/if \(org\._dynamic\) saveDynamicOrgs\(\);[\s\S]{0,200}sms thresholds for/.test(server),
  'the static/dynamic split is gone from this path entirely — one storage route for every org');
/* Was scoped to the SMS path while defaultEmail still had the SAME gap and
   still honestly logged that line. Both are moved now, so the test is
   file-wide: no route on this server may report a save it did not keep. */
ok(!/static org — not persisted/.test(server),
  'no route admits a loss anywhere, because there is no longer a loss anywhere');
ok(!/if \(org\._dynamic\) saveDynamicOrgs\(\);/.test(server),
  '...and no write is gated on the org being dynamic');
ok(/const st = \(slug && smsThresholdStore\[slug\]\) \|\| null;/.test(server),
  'the stored value is read back over the org record — it is the one that survives a deploy');

/* THE DEFAULT EMAIL HAD THE IDENTICAL GAP, and it is closed the same way.
   Its route wrote onto the ORGS entry and called saveDynamicOrgs(), so for a
   STATIC org the address lived in one process's memory — the same shape that
   lost Watertown's allowance, on the field the alert emails are addressed
   from. */
ok(/const ORG_EMAIL_FILE = path\.join\(DATA_DIR, 'org-emails\.json'\)/.test(server),
  'the default email persists in a file of its own, keyed by slug');
ok(/orgEmailStore\[slug\] = check\.email;\s*\n\s*saveOrgEmailStore\(orgEmailStore\);/.test(server),
  '...and the edit route writes it');
ok(/orgEmailStore\[slug\] = emailCheck\.email;\s*\n\s*saveOrgEmailStore\(orgEmailStore\);/.test(server),
  '...and so does Add Org, so a new org is durable by the same one path rather than by being dynamic');
ok(/res\.json\(\{ ok: true, defaultEmail: check\.email, persisted: true \}\)/.test(server),
  'the route answers persisted:true unconditionally now — it no longer reports a save it did not keep');
/* PRESENCE, not truthiness. A CLEARED address is stored as '' and has to win
   over whatever the org record still carries; `store[slug] || org.x` would
   resurrect the address somebody just deleted, which is the one outcome a
   Clear must never have. */
ok(/const st = slug \? orgEmailStore\[slug\] : undefined;\s*\n\s*if \(typeof st === 'string'\) return st;/.test(server),
  'a cleared address wins over the org record — the store is read by PRESENCE, so Clear cannot resurrect what it deleted');
is((server.match(/function orgDefaultEmail\(/g) || []).length, 1,
  'ONE reader — a second copy is how one surface shows an address another has already cleared');

is((server.match(/function applySmsThresholds\(/g) || []).length, 1,
  'ONE handler behind both the admin route and the org gear — two would accept different numbers on each side');
ok(/app\.post\('\/admin\/api\/orgs\/:slug\/sms-thresholds', adminAuth/.test(server), 'the admin route is behind adminAuth');
ok(/app\.post\('\/:org\/api\/sms-thresholds', authMiddleware/.test(server), 'and the org route behind the org token');
ok(/smsThresholds: orgSmsThresholds\(org, (slug|req\.orgSlug)\)/.test(server),
  'and the values reach the dashboard — read BY SLUG, or the persisted store cannot be consulted');
is((server.match(/orgSmsThresholds\(org, req\.orgSlug\)/g) || []).length, 1,
  "...and the org-facing route passes req.orgSlug, since `slug` is not bound there — a bare `slug` would be a ReferenceError on every dashboard load");
ok(!/dashboardConfigs\[[^\]]*\]\.smsSegmentLimit/.test(server),
  'stored on the ORG, never in dashboardConfigs — Reset Dashboard must not be able to wipe a contractual allowance');

console.log('✓ messaging-widgets.spec.js — ' + n + ' assertions passed.');
