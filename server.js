// rec.us Dashboard Server

// ── Langfuse + OpenTelemetry (must init BEFORE other imports) ────────
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { LangfuseSpanProcessor, isDefaultExportSpan } = require('@langfuse/otel');
const otelApi = require('@opentelemetry/api');

const _langfuseEnabled = !!(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
let _otelSdk = null;
let _langfuseProcessor = null;
if (_langfuseEnabled) {
  _langfuseProcessor = new LangfuseSpanProcessor({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl:   process.env.LANGFUSE_BASE_URL || 'https://us.cloud.langfuse.com',
    shouldExportSpan: ({ otelSpan }) =>
      isDefaultExportSpan(otelSpan) ||
      otelSpan.instrumentationScope?.name === 'rec-dashboard',
  });
  _otelSdk = new NodeSDK({ spanProcessors: [_langfuseProcessor], instrumentations: [] });
  _otelSdk.start();
  console.log('[langfuse] OpenTelemetry tracing enabled — baseUrl:', process.env.LANGFUSE_BASE_URL || '(default US)');
} else {
  console.log('[langfuse] LANGFUSE keys not set — tracing disabled (AI insights still work)');
}
const _recTracer = otelApi.trace.getTracer('rec-dashboard');

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3200;
const DATA_DIR = process.env.DATA_DIR || './data';
const METABASE_URL = process.env.METABASE_URL || 'https://rec.metabaseapp.com';
const REPORTING_BASE_URL = process.env.REPORTING_BASE_URL || 'https://rental-report-production-a046.up.railway.app';

// ── Metabase public-card parameter-id stamping ──────────────────────────────
// 2026-08-10: Metabase's public /query/json endpoint rejects parameters that
// lack the per-parameter `id` with 400 "An error occurred." — every dashboard
// widget went to zeros for every org (first noticed on Littleton). Same
// behavior change that hit rental-report on 2026-08-09; this is the same fix
// ported over: resolve each card's parameter ids from its public definition
// (cached 1h) and stamp them onto outbound query URLs via a guarded fetch
// wrapper. Card-definition reads pass through untouched, so no recursion.
const _origFetch = globalThis.fetch.bind(globalThis);
const _cardParamMeta = new Map();            // uuid -> { ts, byTag: Map(tag|slug -> id) }
const CARD_PARAM_META_TTL = 60 * 60 * 1000;  // 1h — picks up new ids if a card is re-saved

async function getCardParamMeta(uuid) {
  const hit = _cardParamMeta.get(uuid);
  if (hit && Date.now() - hit.ts < CARD_PARAM_META_TTL) return hit.byTag;
  try {
    const resp = await _origFetch(`${METABASE_URL}/api/public/card/${uuid}`, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const def = await resp.json();
    const byTag = new Map();
    for (const p of (def.parameters || [])) {
      if (!p || !p.id) continue;
      const tag = Array.isArray(p.target) && Array.isArray(p.target[1]) ? p.target[1][1] : null;
      if (tag) byTag.set(tag, p.id);
      if (p.slug) byTag.set(p.slug, p.id);
    }
    _cardParamMeta.set(uuid, { ts: Date.now(), byTag });
    return byTag;
  } catch (e) {
    console.warn(`[mb-params] param-id lookup failed for card ${String(uuid).slice(0, 8)}: ${e.message}`);
    return hit ? hit.byTag : null;           // fall back to any prior meta
  }
}

// Rewrite a Metabase public-card query URL to stamp the required `id` onto each
// parameter. Never throws — returns the URL unchanged on any problem so a lookup
// failure degrades to prior behavior rather than breaking the request.
async function enrichMetabaseCardUrl(url) {
  try {
    const m = /\/api\/public\/card\/([^/?]+)\/query\/json\?parameters=(.+)$/.exec(url);
    if (!m) return url;
    const uuid = m[1];
    const params = JSON.parse(decodeURIComponent(m[2]));
    if (!Array.isArray(params) || params.length === 0) return url;
    if (params.every(p => p && p.id)) return url;   // already stamped
    const byTag = await getCardParamMeta(uuid);
    if (!byTag) return url;
    let changed = false;
    const stamped = params.map(p => {
      if (!p || p.id) return p;
      const tag = Array.isArray(p.target) && Array.isArray(p.target[1]) ? p.target[1][1] : p.slug;
      const id = tag ? byTag.get(tag) : null;
      if (!id) return p;
      changed = true;
      return { id, ...p };
    });
    if (!changed) return url;
    return `${url.slice(0, m.index)}/api/public/card/${uuid}/query/json?parameters=${encodeURIComponent(JSON.stringify(stamped))}`;
  } catch (e) {
    console.warn(`[mb-params] URL enrich failed: ${e.message}`);
    return url;
  }
}

// Guarded global fetch wrapper: stamps parameter ids onto Metabase public-card
// QUERY requests only; everything else passes through untouched.
globalThis.fetch = async function (resource, init) {
  if (typeof resource === 'string'
      && resource.includes('/api/public/card/')
      && resource.includes('/query/json?parameters=')) {
    resource = await enrichMetabaseCardUrl(resource);
  }
  return _origFetch(resource, init);
};

// ═══════════════════════════════════════════
//  ORG CONFIG
// ═══════════════════════════════════════════
const ORGS = {
  watertown: {
    name: 'Watertown Recreation',
    orgId: 'd781690b-c5a0-43c5-8443-9ae43899528c',
    token: '7qNNXDFo4HGpOh5B',
    city: 'Watertown',
    state: 'MA',
    logoUrl: 'https://prod-rec-tech-img-bucket-8656aa2.s3.us-west-1.amazonaws.com/organization-d781690b-c5a0-43c5-8443-9ae43899528c/fullLogo.png',
    reports: {
      facility: '4b64af10-d57f-41af-aad8-b16d12a8f7b8'
    }
  },
  niagarafalls: {
    name: 'City of Niagara Falls',
    orgId: 'a976a11a-5303-4785-838a-1b281ca77678',
    token: 'LjW1vF7eZJCyjWVN',
    city: 'Niagara Falls',
    state: 'NY',
    logoUrl: 'https://prod-rec-tech-img-bucket-8656aa2.s3.us-west-1.amazonaws.com/organization-a976a11a-5303-4785-838a-1b281ca77678/fullLogo.png',
    reports: {},
  },
  torrance: {
    name: 'City of Torrance',
    orgId: '4246b144-a4e2-4bf1-bb7f-a89f47d71973',
    token: 'Xq3RtBnW8vKdM2Ly',
    city: 'Torrance',
    state: 'CA',
    logoUrl: 'https://prod-rec-tech-img-bucket-8656aa2.s3.us-west-1.amazonaws.com/organization-4246b144-a4e2-4bf1-bb7f-a89f47d71973/fullLogo.png',
    reports: {}
  }
};

// ── Dynamic Orgs (added via admin panel, persisted to data/) ─────────
const DYNAMIC_ORGS_FILE = path.join(DATA_DIR, 'dashboard-orgs.json');
function loadDynamicOrgs() {
  try {
    if (fs.existsSync(DYNAMIC_ORGS_FILE)) {
      const orgs = JSON.parse(fs.readFileSync(DYNAMIC_ORGS_FILE, 'utf8'));
      let count = 0;
      for (const [slug, org] of Object.entries(orgs)) {
        if (!ORGS[slug]) { ORGS[slug] = org; count++; }
      }
      if (count > 0) console.log(`[orgs] Loaded ${count} dynamic org(s) from ${DYNAMIC_ORGS_FILE}`);
    }
  } catch (e) { console.warn('[orgs] Failed to load dynamic orgs:', e.message); }
}
function saveDynamicOrgs() {
  // Only save orgs that aren't hardcoded (i.e. were added dynamically)
  const hardcoded = new Set(['watertown', 'niagarafalls']);
  const dynamic = {};
  for (const [slug, org] of Object.entries(ORGS)) {
    if (!hardcoded.has(slug) && org._dynamic) dynamic[slug] = org;
  }
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DYNAMIC_ORGS_FILE, JSON.stringify(dynamic, null, 2));
}
loadDynamicOrgs();

// ── Reporting identity: keep the two projects from drifting apart ────────────
// Every rental-report link this dashboard renders is built from OUR slug and OUR
// token. Both are copies — rental-report holds its own — and copies drift. They
// drifted: this dashboard called Shrewsbury `town-of-shrewsbury` for five weeks
// after the duplicate slug was removed over there, so every report link, and the
// report-visibility fetch, silently 404'd. Nobody noticed until a human clicked.
//
// The sync used to be one-way and one-time: Add Org adopted the reporting
// project's token if the slug already existed, and never looked again. Anything
// that changed afterwards — a rename, a re-issued token — went unnoticed.
//
// So: reconcile on boot and periodically, and resolve on the ORGANISATION UUID,
// which is stable in both projects, rather than on the slug, which is exactly
// what drifts. `reportingIdentity(slug)` is then the ONLY thing allowed to build a
// rental-report URL — the dashboard keeps its own slug for its own routes.
const REPORTING_IDENTITY = {};        // our slug -> { slug, token, state, checkedAt }
const REPORTING_RECONCILE_MS = 6 * 60 * 60 * 1000;

function reportingIdentity(slug) {
  const known = REPORTING_IDENTITY[slug];
  if (known && known.slug) return known;
  // Un-reconciled (first boot, or the reporting project was unreachable): assume
  // the names match, which is true for all but the drifted ones and is what the
  // dashboard did before this existed.
  const org = ORGS[slug];
  return { slug, token: org && org.token, state: 'unchecked' };
}

// Slugs a rename plausibly produced, in both directions — we may be holding the
// long name (`town-of-shrewsbury`) or the short one. These affix rules mirror
// rental-report's own near-miss suggestion in `noteDeadLink()`; keep the two in
// step, per the lockstep rule at the top of CLAUDE.md. Nothing here is trusted on
// its own: every candidate must prove itself on the organisation UUID.
const SLUG_AFFIX = /^(town|city|village|township|county)-of-/;
const SLUG_STATE = /-(ca|ma|nv|mo|tn|nc|ga|ny|nj|pa|oh|il|tx|wa|or|az|co|fl|va|md|ct|ri|nh|vt|me|wi|mn|ia|ks|ne|ut|id|mt|wy|nd|sd|ok|ar|la|ms|al|sc|ky|wv|de|in|mi)$/;
function candidateSlugs(slug) {
  const bare = String(slug).replace(SLUG_AFFIX, '').replace(SLUG_STATE, '');
  const out = new Set([bare, bare.replace(/-county$/, ''), bare + '-county']);
  for (const p of ['town-of-', 'city-of-', 'village-of-', 'township-of-']) out.add(p + bare);
  out.delete(slug);
  return [...out].filter(Boolean).slice(0, 8);
}

async function reconcileOrgWithReporting(slug) {
  const org = ORGS[slug];
  if (!org || !REPORTING_BASE_URL) return null;
  const get = async (u) => {
    const r = await fetch(`${REPORTING_BASE_URL}${u}`);
    return r.ok ? r.json() : null;
  };
  // 1. Does the reporting project know this slug?
  const bySlug = await get(`/api/admin/org/${encodeURIComponent(slug)}`);
  if (bySlug && bySlug.exists) {
    // A re-issued token is the quiet failure: the link resolves to a real org and
    // is refused. Adopt theirs — for their own URLs they are the authority.
    const drift = bySlug.token && org.token && bySlug.token !== org.token;
    return { slug, token: bySlug.token || org.token,
             state: drift ? 'token-drift' : 'ok', checkedAt: Date.now() };
  }
  // 2. The slug does not resolve. Ask by organisation UUID before concluding
  //    anything: this is the Shrewsbury case, and orgId equality is proof it is
  //    the same organisation under another name.
  if (org.orgId) {
    const byId = await get(`/api/admin/org-by-id/${encodeURIComponent(org.orgId)}`);
    if (byId && byId.exists && byId.slug) {
      return { slug: byId.slug, token: byId.token || org.token,
               state: 'slug-drift', checkedAt: Date.now() };
    }
    // 2b. That endpoint is newer than this code and 404s on an older
    //     rental-report, which would leave the links broken while waiting on a
    //     deploy over there. `/api/admin/org/:slug` has always existed, so ask it
    //     about the slugs a rename would plausibly have produced — and adopt one
    //     ONLY if its orgId equals ours. That check is what makes this a search
    //     with a proof rather than a guess: a same-named org in a different state
    //     answers 200 and must not be adopted.
    for (const cand of candidateSlugs(slug)) {
      const hit = await get(`/api/admin/org/${encodeURIComponent(cand)}`);
      if (!hit || !hit.exists) continue;
      if (hit.orgId !== org.orgId) {
        console.warn(`[reporting] \`${cand}\` exists over there but is a DIFFERENT `
          + `organisation (${hit.orgId} ≠ ${org.orgId}) — not adopting it.`);
        continue;
      }
      return { slug: cand, token: hit.token || org.token,
               state: 'slug-drift', checkedAt: Date.now() };
    }
  }
  // 3. Genuinely absent. Do NOT invent an identity — leaving it unresolved keeps
  //    the links pointing where they always did and makes the state visible.
  return { slug: null, token: null, state: 'missing', checkedAt: Date.now() };
}

async function reconcileWithReporting(opts) {
  if (!REPORTING_BASE_URL) return { skipped: 'no REPORTING_BASE_URL' };
  const summary = { ok: 0, 'token-drift': 0, 'slug-drift': 0, missing: 0, failed: 0 };
  for (const slug of Object.keys(ORGS)) {
    try {
      const id = await reconcileOrgWithReporting(slug);
      if (!id) { summary.failed++; continue; }
      REPORTING_IDENTITY[slug] = id;
      summary[id.state] = (summary[id.state] || 0) + 1;
      if (id.state === 'slug-drift') {
        console.warn(`[reporting] SLUG DRIFT — this dashboard calls it \`${slug}\`, `
          + `rental-report serves it as \`${id.slug}\`. Report links repaired.`);
      } else if (id.state === 'token-drift') {
        console.warn(`[reporting] TOKEN DRIFT for \`${slug}\` — adopted the reporting project's token.`);
      } else if (id.state === 'missing') {
        console.error(`[reporting] NO MATCH for \`${slug}\` (orgId ${org_id_of(slug)}) — `
          + `its report links will 404 until it is added over there.`);
      }
    } catch (e) {
      summary.failed++;
      console.warn(`[reporting] reconcile failed for ${slug}:`, e.message);
    }
  }
  const drift = summary['slug-drift'] + summary['token-drift'] + summary.missing;
  console.log(`[reporting] reconciled ${Object.keys(ORGS).length} org(s): `
    + JSON.stringify(summary) + (drift ? '  ← DRIFT' : ''));
  return summary;
}
function org_id_of(slug) { return (ORGS[slug] && ORGS[slug].orgId) || '?'; }

// Boot check runs slightly late so it cannot slow the first request, then every
// 6h. Failure to reach the reporting project leaves identities 'unchecked', which
// behaves exactly as this dashboard did before — never worse.
setTimeout(() => { reconcileWithReporting().catch(e => console.warn('[reporting]', e.message)); }, 4000);
setInterval(() => { reconcileWithReporting().catch(() => {}); }, REPORTING_RECONCILE_MS);

// Reports available to ALL orgs via shared Metabase cards (need org_id param)
/* Card 21517's public link. Verified through the public endpoint with the
   app's own date/single parameters before wiring: apex 1,150 scans in 7.7s
   cold and 0.9s warm, el-segundo 198 in 1.7s, three registered parameters.
   Empty here means the widget is absent — see the 'checkins-live' key below. */
const CHECKINS_LIVE_UUID = 'd9891f69-897e-4d60-985c-50b31ad6d280';

/* ── THE SINGLE-DAY LIVE CARDS ───────────────────────────────────────────────
   Dan: "if building super lightweight reports to fuel these live widgets is a
   better fit, consider that. since each is only pulling a single day's worth of
   data for a specific org, maybe that's smarter?"

   It is. Measured cache-independently through the public endpoint, 2026-09-05,
   on feeds the page polls EVERY 60 SECONDS:

     enrollments (21286)  apex  7 days  741 rows  8.3s  345KB
                                1 day     5 rows  1.9s    2KB
     checkins    (21517)  apex  2 days 1,314 rows 9.8s  319KB
                                1 day   164 rows  0.7s   39KB

   The wider windows were not waste, which is why this is a SPLIT rather than a
   narrowing. The enrollments feed carries seven days because the Programs Live
   leaderboard ranks over seven and its trend arrow compares three complete days
   against the three before them; the check-ins feed carries two because the
   page works out the org's "today" from the newest row's stamp. So:

     * card 21550 returns the ORG'S OWN today in full detail — the list, the
       dots, the prices, the chime;
     * card 21551 returns the six COMPLETE days before it at (day x section)
       grain, which is every figure the leaderboard actually reads and none of
       the twelve wide columns it never touches;
     * card 21552 does for check-ins what 21550 does for signups.

   NONE OF THE THREE HAS A DATE PARAMETER. That is the operational point as
   much as the performance one: the push->flip dance in these repos exists
   because an API push regenerates DATE tags as Text and the card 400s until a
   human re-types them. `org_id` and `days` are text tags and survive a push
   unchanged, so these can be corrected at any hour without taking a widget
   down — the property a LIVE card most wants. Verified on creation: all three
   register text tags only.

   EMPTY HERE MEANS ABSENT, and the page falls back to the wide-window feeds it
   used before. A Metabase card is not readable by this app until someone opens
   it and creates a public link, which is a UI action; Dan did that on
   2026-09-05 and these are the links.

   SIGNED OFF THROUGH THE PUBLIC ENDPOINT with the app's own parameter shape,
   run with nothing else in flight:

       21550 enrollments today   apex  11 rows   538ms    smyrna  4 rows  488ms
       21551 enrollments rollup  apex 435 rows  1158ms    smyrna 331 rows 2209ms
       21552 check-ins today     apex 402 rows   602ms    smyrna 45 rows  450ms

   Against 8.3s and 25.6s for the feeds they replace. Row counts match what the
   cards returned before the sargable rewrite, so the values are unchanged.

     21550  https://rec.metabaseapp.com/question/21550
     21551  https://rec.metabaseapp.com/question/21551
     21552  https://rec.metabaseapp.com/question/21552 */
const ENROLLMENTS_TODAY_UUID  = '970ce23a-d275-475d-a191-4fef9d07855f';
const ENROLLMENTS_ROLLUP_UUID = '3ecb1e84-a2f0-4580-9d98-eb24e53bdde9';
const CHECKINS_TODAY_UUID     = '6c43be44-5b83-4db3-be86-ebef472f6a56';
/* ✅ Facility Bookings Live — Today (card 21583). The fourth live widget, and
   the only one whose stream was CHOSEN by measurement rather than by which
   report already existed: per org over 90 days the median org's biggest hour
   of programme registrations is 44 signups against 185 facility bookings, and
   facility reaches 96 orgs against programmes' 93. Empty until somebody
   creates the public link — which hides the widget rather than rendering a
   confident zero, the same absence rule as its three siblings.
   https://rec.metabaseapp.com/question/21583 */
const FACILITY_TODAY_UUID     = '';

const SHARED_UUIDS = {
  facility: 'f6787f45-3a36-4501-8a5f-b0f647451a85',
  programs: 'e35f2b47-87c9-40e3-8507-3d9b56f9ce62',
  gl: '4374b344-06a7-42c5-996c-e1845bda3ff1',
  fasttrack: '9d38ab95-8562-42ca-b6c2-2582b7452457',
  'program-demographics': '67b77142-19ab-49bd-9d4b-1db8223a3616',
  users: '0aa0f55d-738f-4df7-837a-eb21f3ee1793',
  memberships: 'f4496307-d965-4637-b048-ecc703f2d37f',
  'court-utilization': '7b0fca20-8fe0-4720-9653-7e15c30176b2',
  retention: '3cfc9cfa-b1db-41e9-83fd-01fb90a5b0c8',
  products: 'b9678f5f-b5fb-48f7-96da-f22a1b4e8d8a',
  'instructor-payout': 'a8db6d86-eddc-4511-a28c-ad4bf636859e',
  checkins: '574324e0-b5a1-46c5-8770-8c466631fdcf',
  'program-checkins': 'cb6fd909-72d3-446b-930b-c0382da02d62',
  // Payment-dated revenue split by what each payment actually bought
  // (programs / facility / memberships / passes / products / events /
  // deposits / fees_tax / other) — reconciles exactly with the GL rollup.
  // Metabase card #19141 "Org Dashboard — Revenue by Stream (payment-dated)".
  revstreams: '4c75c2e7-b4c0-44f3-b5bc-f8aac598730b',
  /* ── LIVE WIDGETS ──────────────────────────────────────────────────────
     Card 21286 "Enrollments Live" — one row per confirmed section booking,
     newest first, behind the Coffee Counter. Mirrored at
     sql/enrollments-live.sql; the live card is the source of truth.

     A LITERAL, like every other card here. This was an env var for about an
     hour (Dan: "what is MB_ENROLLMENTS_UUID lol"), which put a deploy-time
     step between a card being published and the widget appearing — for no
     benefit, because the absence rule is enforced where it belongs: the widget
     renders NOTHING when the feed cannot answer, and the section hides itself
     when its widgets do. A confident "0 signups today" on a registration
     morning is the reading that had to be impossible; an env var was never
     what made it so.

     Verified live before wiring: shrewsbury, 7-day window, 126 rows in 20.7s
     through the public endpoint with the app's own date/single parameters. */
  enrollments: 'e663ecfb-71b4-4de1-b984-13c69beab005',
  /* Card 21517 "✅ Membership Check-Ins Live" — newest membership and pass
     scans first, behind the Membership Check-Ins widget. Mirrored at
     sql/checkins-live.sql; the live card is the source of truth.

     A LITERAL, like every other card here — the env-var version of this lasted
     about an hour on the enrollments card (Dan: "what is MB_ENROLLMENTS_UUID
     lol") and bought nothing, because the absence rule is enforced where it
     belongs rather than by a deploy step.

     THE KEY IS OMITTED WHILE THE UUID IS EMPTY, and that is the absence rule:
     `availableReports` is built from this map, so an absent key hides the
     widget, the route 404s, and the section hides itself when its widgets do.
     A confident "0 check-ins today" on a morning when the desk is scanning
     people through is the reading that had to be impossible. Filling this in
     is the whole wiring — no other change is needed. */
  ...(CHECKINS_LIVE_UUID ? { 'checkins-live': CHECKINS_LIVE_UUID } : {}),
  /* The single-day cards, each absent until it has a public link. The page
     tests for these by name and falls back to the wide-window feeds above, so
     an absent key costs nothing and a present one is the whole switch. */
  ...(ENROLLMENTS_TODAY_UUID  ? { 'enrollments-today':  ENROLLMENTS_TODAY_UUID }  : {}),
  ...(ENROLLMENTS_ROLLUP_UUID ? { 'enrollments-rollup': ENROLLMENTS_ROLLUP_UUID } : {}),
  ...(CHECKINS_TODAY_UUID     ? { 'checkins-today':     CHECKINS_TODAY_UUID }     : {}),
  ...(FACILITY_TODAY_UUID     ? { 'facility-today':     FACILITY_TODAY_UUID }     : {})
};

/* A LIVE WIDGET NEEDS ITS OWN CLOCK. Everything else here is a dashboard of a
   window somebody chose and caches 15 minutes by org config; a counter whose
   whole claim is "right now" cannot be a quarter of an hour behind. 60s is
   also what the page polls at, so most ticks are served from this cache and
   the card is queried about once a minute per org rather than once per
   viewer. */
const LIVE_REPORT_TTL_MS = {
  enrollments: 60 * 1000, 'checkins-live': 60 * 1000,
  'enrollments-today': 60 * 1000, 'checkins-today': 60 * 1000,
  'facility-today': 60 * 1000,
  /* THE ROLLUP IS NOT A LIVE FEED, and that is the point of it. It covers
     COMPLETE days only — never today — so within a day its answer cannot
     change, and asking for it once a minute would be asking sixty times for
     the same rows. Thirty minutes is the whole saving: the expensive half of
     the split stops being polled. It stays in this map rather than taking the
     org's configured TTL because, like its siblings, its refresh cadence is a
     property of the FEED and not of an org's preference. */
  'enrollments-rollup': 30 * 60 * 1000
};

// Reports that don't accept date parameters
const NO_DATE_REPORTS = new Set([
  'program-demographics', 'memberships', 'users', 'retention', 'checkins', 'fasttrack',
  /* The single-day live cards resolve the org's own today in SQL, so sending
     them a window would be sending the viewer's opinion about a day the org is
     the authority on. That is the bug they exist to remove. */
  'enrollments-today', 'checkins-today', 'enrollments-rollup', 'facility-today'
]);

// ═══════════════════════════════════════════
//  IN-MEMORY CACHE
// ═══════════════════════════════════════════
const { cache, DEFAULT_CACHE_TTL, getCached, getCacheEntry, setCache, revalidate } = require('./cache');

// ═══════════════════════════════════════════
//  DASHBOARD CONFIG PERSISTENCE
// ═══════════════════════════════════════════
const CONFIG_FILE = path.join(DATA_DIR, 'dashboards.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadAllConfigs() {
  ensureDataDir();
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load dashboard configs:', e.message);
  }
  return {};
}

function saveAllConfigs(configs) {
  ensureDataDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(configs, null, 2));
}

let dashboardConfigs = loadAllConfigs();

// ═══════════════════════════════════════════
//  AUTH MIDDLEWARE
// ═══════════════════════════════════════════
function authMiddleware(req, res, next) {
  const orgSlug = req.params.org;
  const org = ORGS[orgSlug];
  if (!org) return res.status(404).json({ error: 'Not found' });

  const token = req.query.token || req.headers['x-dashboard-token'];
  if (token !== org.token) return res.status(404).json({ error: 'Not found' });

  req.org = org;
  req.orgSlug = orgSlug;
  next();
}

// ═══════════════════════════════════════════
//  METABASE DATA PROXY
// ═══════════════════════════════════════════
function parseToISO(dateStr) {
  if (!dateStr) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return d.toISOString().split('T')[0];
}

function buildMetabaseParams(reportType, query) {
  const params = [];
  if (!NO_DATE_REPORTS.has(reportType)) {
    const start = parseToISO(query.start);
    const end = parseToISO(query.end);
    // The revstreams card's template tags are plain text variables (its SQL
    // casts them with ::date), and Metabase's public API only accepts
    // 'category' params against those — 'date/single' and 'string/=' both
    // 400 (verified against the live public card). Don't change those tags
    // to Date in the Metabase UI or this stops matching.
    const dateType = reportType === 'revstreams' ? 'category' : 'date/single';
    if (start) params.push({ type: dateType, target: ['variable', ['template-tag', 'start_date']], value: start });
    if (end) params.push({ type: dateType, target: ['variable', ['template-tag', 'end_date']], value: end });
  }
  /* NO `days` PARAMETER FOR THE ROLLUP, and this is a fact about Metabase
     rather than a simplification. The card had a `{{days}}` tag so the page's
     own LIVE_DAYS could govern its window; Metabase registered that tag as
     date/single whatever the SQL cast said, and every type the app can send
     was probed against the live public card — category 500, date/single 500,
     number/= 400, string/= 400. There is no value it would accept, so the six
     complete days live in the card's SQL and the spec pins the page's constant
     against that literal. Sending a parameter the card does not register is
     how this comes back as a 400 the first time Metabase tightens. */
  return params;
}

// Staff/guest exclusion for the users feed — mirrors the Community Intel
// report (rental-report users.html) exactly, so the dashboard's user tiles
// tie to that page instead of quietly counting Rec staff logins: drop staff
// (@rec.us, non-guest) and guest checkout accounts.
function excludeStaffAndGuests(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.filter(r => {
    const em = String(r['Email'] || r['email'] || '').trim().toLowerCase();
    const fn = String(r['First Name'] || r['first_name'] || '').trim().toLowerCase();
    const staff = em.includes('@rec.us') && !em.startsWith('guest-user+');
    const guest = fn === 'guest' || em.startsWith('guest-user+guest-');
    return !staff && !guest;
  });
}

async function fetchMetabaseData(orgSlug, reportType, query) {
  const org = ORGS[orgSlug];
  // Per-org UUID takes priority; fall back to shared
  const isShared = !org.reports?.[reportType];
  const uuid = org.reports?.[reportType] || SHARED_UUIDS[reportType];
  if (!uuid) return null;

  const params = buildMetabaseParams(reportType, query);
  // Shared UUIDs need org_id to filter data. The revstreams card's org_id is
  // a plain text variable, which the public API only accepts as 'category'.
  if (isShared && org.orgId) {
    const orgIdType = reportType === 'revstreams' ? 'category' : 'string/=';
    params.push({ type: orgIdType, target: ['variable', ['template-tag', 'org_id']], value: org.orgId });
  }
  const cacheKey = `${orgSlug}:${reportType}:${JSON.stringify(params)}`;
  
  // Check org-specific cache TTL
  const orgConfig = dashboardConfigs[orgSlug];
  // A live feed's TTL is a property of the FEED, not of the org's preference:
  // an org that set a 30-minute cache did not ask for a stale "right now".
  const ttl = LIVE_REPORT_TTL_MS[reportType] || (orgConfig?.cacheTTL || 15) * 60 * 1000;
  
  const doFetch = async () => {
    const paramStr = params.length ? `?parameters=${encodeURIComponent(JSON.stringify(params))}` : '';
    const url = `${METABASE_URL}/api/public/card/${uuid}/query/json${paramStr}`;
    console.log(`[FETCH] ${orgSlug}/${reportType} → ${uuid} (shared=${isShared})`);
    const resp = await fetch(url);
    if (!resp.ok) {
      /* SAY WHAT METABASE SAID. "Metabase 400: Bad Request" is what this threw
         for a Watertown programs prewarm that had actually spent 3m45s and hit
         a statement timeout — a slow card and a broken one are opposite
         problems with opposite fixes, and the status alone cannot tell them
         apart. The body carries the reason; 200 characters of it is plenty.
         Same lesson the sibling repo learned when its health check spent an
         afternoon reporting healthy-but-slow cards as down. */
      let why = '';
      try { why = (await resp.text()).slice(0, 200).replace(/\s+/g, ' ').trim(); } catch (e) {}
      throw new Error(`Metabase ${resp.status}: ${resp.statusText}${why ? ' — ' + why : ''}`);
    }
    const rows = await resp.json();
    console.log(`[DATA] ${orgSlug}/${reportType}: ${rows.length} rows${rows.length > 0 ? ', cols: ' + Object.keys(rows[0]).join(', ') : ''}`);
    return rows;
  };

  /* STALE-WHILE-REVALIDATE, EXCEPT FOR A LIVE FEED — and that exception is a
     bug fix, not a tuning choice. Dan, watching the card: "seems like the live
     widget is lagging — nothing happens until i click the refresh."

     Serving a stale entry and refreshing behind it means the answer a caller
     gets is the PREVIOUS fetch, so with a 60s TTL and a 60s poll the card
     shows rows between one and two minutes old, sawing between the two. And it
     is exactly why clicking Refresh appeared to fix it: the poll a moment
     earlier had kicked the background refresh, so the click landed after it
     finished and got the rows the poll should have had. The button was not
     doing anything the poll was not; it was arriving later.

     That trade is right for a dashboard of a window somebody chose — nobody
     should wait 30s for a report they can read a quarter of an hour old. It is
     wrong for a widget whose entire claim is "right now", where a stale answer
     is the failure rather than the graceful degradation. So a live feed AWAITS
     the refresh. It costs the poll the card's own time, measured 3.0s at
     Shrewsbury and 9.5s at San Francisco — comfortably inside the 60s poll —
     and `revalidate` de-duplicates, so ten viewers polling together still run
     the card once.

     A FAILED REFRESH STILL ANSWERS with the stale rows rather than an error: a
     card that empties itself the first time Metabase hiccups is worse than one
     that is a minute behind for a minute. */
  const isLive = !!LIVE_REPORT_TTL_MS[reportType];
  const entry = getCacheEntry(cacheKey);
  if (entry && entry.stale && isLive) {
    await revalidate(cacheKey, ttl, doFetch);
    const fresh = getCacheEntry(cacheKey);
    return fresh ? fresh.data : entry.data;
  }
  if (entry) {
    if (entry.stale) revalidate(cacheKey, ttl, doFetch);
    return entry.data;
  }

  // Cold: never fetched (or cleared since). Fetch live this once, then cache.
  const rows = await doFetch();
  setCache(cacheKey, rows, ttl);
  return rows;
}

// ═══════════════════════════════════════════
//  UPDATES LOG
// ═══════════════════════════════════════════
const UPDATES = [
  { date: '2026-08-03', title: 'Program Revenue fix', items: [
      'Fixed Program Revenue widget using || instead of ?? -- sections with $0 net_total (fully refunded) were falling back to charged (gross), inflating the number. Now correctly shows lifetime net revenue matching the Programs report.',
      'Same fix applied to Revenue by Stream programs bar and Revenue Trend line chart.',
  ] },
  { date: '2026-07-29', title: 'Project Updates / notifications', items: [
    'New admin "Add Update" composer publishes announcements to org dashboards — auto-drafted from the changelog (each line tagged by report and auto-targeted to the orgs that have that report) or written manually and sent to all or specific orgs.',
    'Org admins see published updates as a one-time dismissible popup on their dashboard, tracked per browser.',
    'Pause or delete any published update from the same composer.',
  ]},
  { date: '2026-07-28', title: 'Cross-Project Org Dedup', items: [
    'Add Org now checks the reporting project first; if the org already exists there, adopts its token instead of generating a new one.',
    'Prevents token overwrites and broken URLs when onboarding an org that was already in the reporting project.',
    'Skips the sync POST when the token was adopted (no-op write avoided).',
  ]},
  { date: '2026-07-18', title: 'Users & Demographics promoted to #1 section', items: [
    'Users & Demographics section now always renders first regardless of config order',
    'KPI metrics (Total Users, New Users) collapsed into a compact summary strip',
    'Chart widgets (City, Zip, Map, Age, Gender) get full grid space'
  ]},
  { date: '2026-07-15', title: 'Platform usage scoping + Send Now digest', items: ['Fixed admin org cards showing global event counts instead of per-org (AI Insights, Dash Views, Layout Saves)', 'Added POST /:org/api/send-digest endpoint — renders dashboard data as inline HTML email and sends via Resend API', 'New env vars: RESEND_API_KEY, FROM_EMAIL, FROM_NAME'] },
  {
    date: "2026-07-15",
    title: "PDF Export + Dashboard Sharing",
    items: [
      "PDF Export in settings: section picker lets you choose which sections to include, opens a print-optimized view. Works with any browser PDF printer.",
      "Share Dashboard: generates a read-only link (72hr expiry) that anyone can view without a token. Directors can share with city council, board members, or stakeholders.",
      "Share links serve live data through the same cache layer, no token required. Expired links auto-clean.",
    ],
  },
  {
    date: "2026-07-15",
    title: "Admin Feature Gates: AI Briefing + Email Digest",
    items: [
      "New admin toggles per org: AI Executive Briefing and Email Digest, alongside existing AI Insights and Report Linkage.",
      "AI Executive Briefing: when enabled, orgs see a new section option that renders a 3-sentence AI narrative summary at the top of their dashboard, synthesized from all widget data.",
      "Email Digest: when enabled, orgs see a subscribe panel in their dashboard settings where they can enter an email and receive periodic dashboard summaries via Resend.",
      "Both features are OFF by default and only appear to orgs when the admin checks the corresponding box.",
    ],
  },
  {
    date: "2026-07-15",
    title: "Cross-Project Integration Suite",
    items: [
      "Add Org auto-syncs to rental-report with matching token (no more token mismatches).",
      "Report Linking toggle: admin ON/OFF, per-section colored View Report links with auth tokens.",
      "Report Visibility sync: dashboard sections filtered by rental-report hidden-report toggles.",
      "Hidden reports excluded from dashboard render, Edit Dashboard modal, and Add Section list.",
      "Early Access banner at top of every dashboard (matches reporting project style).",
      "Next Mo date preset button for forward-looking date ranges.",
      "REPORTING_BASE_URL env var controls the target reporting project URL.",
    ],
  },
  {
    date: "2026-07-14",
    title: "AI Insights: Schema-Aware Context",
    items: [
      "Every AI insight prompt now includes a SCHEMA_CONTEXT block explaining the rec.us data model, column semantics, revenue recognition rules, and known data patterns.",
      "Eliminates hallucinations where the model misinterprets column meanings (e.g. customer_user_id vs participant_user_id, listed price vs charged amount).",
    ],
  },
  {
    date: "2026-07-14",
    title: "Admin Panel: Add Org Button",
    items: [
      "New Add Org button in the admin panel header opens a form to onboard orgs without touching code.",
      "Collects slug, name, org UUID, city, state, logo URL. Token is auto-generated server-side.",
      "Dynamic orgs persist to data/dashboard-orgs.json and merge into ORGS at startup.",
      "All shared reports light up automatically for new orgs. No Metabase UUIDs needed.",
    ],
  },
  {
    date: "2026-07-13",
    title: "Programs section: Session Check-In widgets",
    items: [
      "New widgets in the Programs & Enrollment section: Session Check-Ins, Attendees Checked In, Visits / Attendee (attendance frequency), and Check-Ins by Section.",
      "Backed by the shared program-checkins Metabase card (attendance_event, session check-ins), date-scoped to the dashboard's range.",
      "Added to the Programs default layout; existing dashboards can add them from the widget picker or reset to defaults.",
    ],
  },
  {
    date: "2026-07-13",
    title: "AI Insights — thumbs up/down + Langfuse",
    items: [
      "Rec Insights panels now have thumbs up/down feedback. Thumbs-down opens an optional comment box.",
      "Feedback flows to Langfuse as trace scores (name: user-feedback) via the /api/public/scores API, tagged by org + section.",
      "Each insight generation is wrapped in an OpenTelemetry span (rec.insights) exported to Langfuse — the span's traceId links the feedback score to the exact generation.",
      "Trace bodies carry the full prompt and generated insight (langfuse.observation input/output + model + token usage), so each score is reviewable in context.",
      "Graceful no-op when LANGFUSE_* keys are absent: insights still work, feedback logs locally to events.jsonl only.",
    ],
  },
  {
    date: "2026-07-13",
    title: "Welcome, City of Niagara Falls!",
    items: ["Niagara Falls is now live on the dashboard platform."],
  },
  { date: '2025-07-12', title: 'AI Insights + Maps + Heatmaps', items: [
    'Rec Insights: AI-powered analysis per section via Claude Haiku, purple gradient panel with emoji-led bullet points',
    'Admin AI toggle: enable/disable AI insights per org from admin panel',
    'User Location Map: server-side geocoding via Nominatim proxy, cached to /data/geocache.json, CartoDB dark/light tiles',
    'Court Locations Map: booking volume circles per court location with org city/state appended for geocoding',
    'Facility Booking Heatmap: day of week x hour grid showing booking density',
    'Court Booking Heatmap: day of week x court name reservation intensity',
    'Retention metrics: Unique Families, Returning Families, Retention Rate, Avg Programs/Family from program-demographics',
    'Widget targets: gear icon on metric cards, set goal number, progress ring donut with color-coded fill percentage',
    'Contextual notes on all 75 widgets explaining what each metric measures',
    'Loading state: amber progress bar + dim overlay when switching date ranges',
    'Favicon: rec yellow icon on browser tab'
  ]},
  { date: '2025-07-12', title: 'Admin Dashboard + Org Management', items: [
    'Admin page with SVG architecture diagram and collapsible sections',
    'Org cards: sections, widgets, events, AI insights, dash views, layout saves',
    'Admin toggles: AI Insights on/off, Report Linkage on/off per org',
    'HTTP Basic auth on all admin routes (ADMIN_PASSWORD env var)',
    'How It Works: caching layer, performance vs old dashboards, widget limits, roadmap documented',
    'Event summary API: totals by org, by type, 7-day activity'
  ]},
  { date: '2025-07-12', title: 'Widget Expansion: 75 Widgets Across 9 Sections', items: [
    'New sections: Courts, Fast Track, Users and Demographics (merged), Memberships, Products, Instructor Payout',
    'Table view widgets: GL codes, program revenue, facility bookings, instructor detail, membership summary',
    'All shared UUIDs wired: products, instructor-payout, checkins added',
    'Fast Track + Instructor Payout: date filters added to Metabase SQL, removed from NO_DATE_REPORTS',
    'Column names fixed from Railway logs for all report types',
    'Removed misleading headcount widgets',
    'Users and Demographics merged into single section with data source notes'
  ]},
  { date: '2025-07-12', title: 'Pre-warm Caching + Performance', items: [
    'Server pre-warms all report types on startup (2s between Metabase calls)',
    'Dashboard loads instantly after warm completes',
    'Smart data batching: one Metabase call per report type regardless of widget count',
    'Theme toggle no longer triggers data refetch',
    'Estimated 75%+ reduction in Metabase load vs old iframe dashboards'
  ]},
  { date: '2025-07-12', title: 'Light/Dark Theme + Reset + Tracking', items: [
    'Dark/light theme toggle in settings, persists per-org',
    'Light mode: polished buttons, borders, skeleton loading, modal styling',
    'Dashboard reset with inline confirmation (no iframe-blocked confirm())',
    'Full event tracking: dashboard_view, template_selected, edit_opened, layout_saved, date_preset_changed, refresh, cache_cleared, dashboard_reset, target_set, theme_changed, insight_requested'
  ]},
  { date: '2025-07-12', title: 'Sectioned Dashboard Architecture', items: [
    'Section-based layout replacing flat widget grid',
    'Edit modal redesigned: add/remove/reorder sections + widgets within sections',
    'Templates: General Overview, Revenue Focus, Operations',
    'GL revenue widgets match Rec admin transaction numbers'
  ]},
  { date: '2025-07-11', title: 'Initial Launch', items: [
    'Standalone Railway project with persistent volume',
    'Widget registry pattern: reportType + transform + component per widget',
    'Metabase data proxy with configurable cache TTL',
    'Token-based auth, Watertown as pilot org',
    'Embedded in Metabase iframe alongside existing dashboards'
  ]},
];

// ═══════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════

// Static files
app.use('/public', express.static(path.join(__dirname, 'public')));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', orgs: Object.keys(ORGS).length }));

// ── Admin auth ──
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function adminAuth(req, res, next) {
  if (!ADMIN_PASSWORD) return next(); // no password set = open access
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="rec.us Dashboard Admin"');
    return res.status(401).send('Authentication required');
  }
  const decoded = Buffer.from(auth.split(' ')[1], 'base64').toString();
  const password = decoded.includes(':') ? decoded.split(':').slice(1).join(':') : decoded;
  if (password !== ADMIN_PASSWORD) {
    res.setHeader('WWW-Authenticate', 'Basic realm="rec.us Dashboard Admin"');
    return res.status(401).send('Invalid credentials');
  }
  next();
}

// ── Admin routes (before /:org catch-all) ──
app.get('/', adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/admin/api/orgs', adminAuth, (req, res) => {
  const orgs = Object.entries(ORGS).map(([slug, org]) => {
    const config = dashboardConfigs[slug] || null;
    const availableReports = { ...SHARED_UUIDS };
    for (const r of Object.keys(org.reports || {})) availableReports[r] = true;
    return {
      slug,
      name: org.name,
      orgId: org.orgId,
      logoUrl: org.logoUrl,
      token: org.token,
      reportCount: Object.keys(availableReports).length,
      perOrgReports: Object.keys(org.reports || {}),
      configured: !!config,
      template: config?.template || null,
      sectionCount: config?.sections?.length || 0,
      widgetCount: config?.sections?.reduce((s, sec) => s + sec.widgets.length, 0) || 0,
      theme: config?.theme || 'dark',
      cacheTTL: config?.cacheTTL || 15,
      toggles: config?.toggles || { ai: true, reportLinks: false, aiBriefing: false, emailDigest: false },
      updatedAt: config?.updatedAt || null,
    };
  });
  res.json({ orgs, updates: UPDATES, sharedReports: Object.keys(SHARED_UUIDS) });
});

// ═══════════════════════════════════════════
//  PROJECT UPDATES / ANNOUNCEMENTS
//  Admin-published dashboard notifications. Two kinds share one store:
//   • smart  — items[] each tagged with report types; auto-targeted to the
//              orgs that actually have one of those reports.
//   • manual — title + markdown body; targeted by allOrgs or an orgs[] list.
//  Orgs see active announcements as a one-time dismissible popup (dismissal
//  tracked client-side in localStorage; no server-side per-user state).
// ═══════════════════════════════════════════
// Dashboard features (the per-org toggles) — announcements tag lines by these
// so an update can auto-target the orgs that actually have that feature on.
const FEATURE_META = {
  ai:          { label: 'AI Insights',      emoji: '✨' },
  aiBriefing:  { label: 'AI Briefing',      emoji: '📋' },
  emailDigest: { label: 'Email Digest',     emoji: '📧' },
  reportLinks: { label: 'Report Linkage',   emoji: '🔗' },
};
const FEATURE_EMOJI_FALLBACK = '✨';

const ANNOUNCEMENTS_FILE = path.join(DATA_DIR, 'announcements.json');
function loadAnnouncements() {
  try { if (fs.existsSync(ANNOUNCEMENTS_FILE)) { const a = JSON.parse(fs.readFileSync(ANNOUNCEMENTS_FILE, 'utf8')); return Array.isArray(a) ? a : []; } } catch (e) {}
  return [];
}
function saveAnnouncements(list) { ensureDataDir(); fs.writeFileSync(ANNOUNCEMENTS_FILE, JSON.stringify(list, null, 2)); }
let announcements = loadAnnouncements();
function newAnnId() { return 'upd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// Dashboard features currently enabled for an org (per-org toggles + support).
function enabledFeaturesForOrg(slug) {
  if (!ORGS[slug]) return [];
  const t = (dashboardConfigs[slug] || {}).toggles || {};
  const out = [];
  if (t.ai !== false) out.push('ai');            // AI Insights defaults on
  if (t.aiBriefing) out.push('aiBriefing');
  if (t.emailDigest) out.push('emailDigest');
  if (t.reportLinks) out.push('reportLinks');
  return out;
}

// Active announcements this org should see, newest first. For a smart
// announcement, an item with NO feature tags is a general dashboard update
// (shown to everyone); a tagged item only shows to orgs that have that feature.
function activeAnnouncementsForOrg(slug) {
  const feats = new Set(enabledFeaturesForOrg(slug));
  const sorted = announcements.slice().sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));
  const out = [];
  for (const a of sorted) {
    if (a.active === false) continue;
    if (a.smart && Array.isArray(a.items)) {
      const items = a.items.filter(it => !it.features || it.features.length === 0 || it.features.some(f => feats.has(f)));
      if (items.length) out.push({ id: a.id, title: a.title, smart: true, items: items.map(it => ({ text: it.text, emoji: it.emoji })), images: a.images || [] });
    } else if (a.allOrgs || (Array.isArray(a.orgs) && a.orgs.includes(slug))) {
      out.push({ id: a.id, title: a.title, body: a.body, images: a.images || [] });
    }
  }
  return out;
}

// How many orgs would see at least one of the given smart items. An untagged
// item counts as all orgs; a tagged item counts orgs with that feature on.
function smartAudienceCount(items) {
  const list = Array.isArray(items) ? items : [];
  if (list.some(it => !it.features || it.features.length === 0)) return Object.keys(ORGS).length;
  const wanted = new Set(); list.forEach(it => (it.features || []).forEach(f => wanted.add(f)));
  let n = 0;
  for (const slug of Object.keys(ORGS)) {
    if (enabledFeaturesForOrg(slug).some(f => wanted.has(f))) n++;
  }
  return n;
}

// GET — powers the admin composer (published list + org roster + report directory + changelog)
// ── Pasted screenshots attached to project updates ──────────────────
const ANNOUNCE_IMG_DIR = path.join(DATA_DIR, 'announce-images');
const ANNOUNCE_IMG_MIMES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
// Keep only image refs our upload endpoint minted (defends the popup's <img src>)
function cleanAnnounceImages(images) {
  if (!Array.isArray(images)) return [];
  return images.filter(u => typeof u === 'string' && /^\/announce-image\/[A-Za-z0-9_.-]+$/.test(u)).slice(0, 6);
}
// Upload (admin only): { dataUrl: "data:image/png;base64,..." } → { ok, url }
app.post('/admin/api/announcements/image', adminAuth, express.json({ limit: '8mb' }), (req, res) => {
  const dataUrl = String((req.body && req.body.dataUrl) || '');
  const m = dataUrl.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/);
  if (!m) return res.status(400).json({ error: 'Expected a base64 image data URL (png/jpeg/gif/webp)' });
  let buf;
  try { buf = Buffer.from(m[2], 'base64'); } catch (e) { return res.status(400).json({ error: 'Invalid base64 payload' }); }
  if (!buf.length) return res.status(400).json({ error: 'Empty image' });
  if (buf.length > 4 * 1024 * 1024) return res.status(413).json({ error: 'Image too large (max 4MB) — crop or downscale the screenshot' });
  const name = `img_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.${ANNOUNCE_IMG_MIMES[m[1]]}`;
  try { fs.mkdirSync(ANNOUNCE_IMG_DIR, { recursive: true }); fs.writeFileSync(path.join(ANNOUNCE_IMG_DIR, name), buf); }
  catch (e) { return res.status(500).json({ error: 'Failed to store image: ' + e.message }); }
  res.json({ ok: true, url: `/announce-image/${name}` });
});
// Serve (public path — org dashboards render these in the What's New popup)
app.get('/announce-image/:name', (req, res) => {
  const name = String(req.params.name || '');
  if (!/^[A-Za-z0-9_.-]+$/.test(name) || name.includes('..')) return res.status(400).end();
  const file = path.join(ANNOUNCE_IMG_DIR, name);
  if (!fs.existsSync(file)) return res.status(404).end();
  const ext = name.split('.').pop().toLowerCase();
  const mime = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[ext] || 'application/octet-stream';
  res.set('Content-Type', mime);
  res.set('Cache-Control', 'public, max-age=86400, immutable');
  res.send(fs.readFileSync(file));
});

app.get('/admin/api/announcements', adminAuth, (req, res) => {
  const orgs = Object.keys(ORGS).map(slug => ({ slug, name: ORGS[slug].name || slug })).sort((a, b) => a.name.localeCompare(b.name));
  const visibility = {};
  for (const slug of Object.keys(ORGS)) visibility[slug] = enabledFeaturesForOrg(slug);
  const features = Object.keys(FEATURE_META).map(key => ({
    key, label: FEATURE_META[key].label, emoji: FEATURE_META[key].emoji,
    orgs: Object.keys(ORGS).filter(slug => enabledFeaturesForOrg(slug).includes(key)).length,
  }));
  const list = announcements.slice().sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0)).map(a => {
    if (!a.smart) return a;
    return Object.assign({}, a, { audience: smartAudienceCount(a.items) });
  });
  res.json({ announcements: list, orgs, visibility, features, changelog: UPDATES });
});

// POST — create a MANUAL announcement (title + body, targeted by allOrgs/orgs[])
app.post('/admin/api/announcements', adminAuth, (req, res) => {
  const { title, body, orgs, allOrgs } = req.body || {};
  const t = (title || '').trim();
  if (!t) return res.status(400).json({ error: 'Title is required' });
  const orgList = Array.isArray(orgs) ? orgs.filter(s => ORGS[s]) : [];
  if (!allOrgs && orgList.length === 0) return res.status(400).json({ error: 'Pick All orgs or at least one org' });
  const ann = {
    id: newAnnId(), title: t, body: (body || '').trim(),
    images: cleanAnnounceImages(req.body.images),
    allOrgs: !!allOrgs, orgs: allOrgs ? [] : orgList,
    active: true, createdAt: Date.now(), createdISO: new Date().toISOString(),
  };
  announcements.push(ann); saveAnnouncements(announcements);
  res.json({ ok: true, announcement: ann });
});

// POST — create a SMART announcement from picked changelog lines. Each line may
// carry feature tags (auto-target orgs with that feature) or none (all orgs).
app.post('/admin/api/announcements/from-updates', adminAuth, (req, res) => {
  const { title, items } = req.body || {};
  const t = (title || '').trim();
  const clean = (Array.isArray(items) ? items : []).map(it => {
    const text = (it && it.text || '').trim();
    const features = (it && Array.isArray(it.features) ? it.features : []).filter(f => FEATURE_META[f]);
    if (!text) return null;
    return { text, features, emoji: (features[0] && FEATURE_META[features[0]] ? FEATURE_META[features[0]].emoji : FEATURE_EMOJI_FALLBACK), date: (it && it.date) || null };
  }).filter(Boolean);
  if (!t) return res.status(400).json({ error: 'Title is required' });
  if (!clean.length) return res.status(400).json({ error: 'Tick at least one change to include' });
  const ann = {
    id: newAnnId(), smart: true, title: t, items: clean,
    images: cleanAnnounceImages(req.body.images),
    active: true, createdAt: Date.now(), createdISO: new Date().toISOString(),
  };
  announcements.push(ann); saveAnnouncements(announcements);
  res.json({ ok: true, announcement: ann, audience: smartAudienceCount(clean) });
});

// POST — pause / unpause an announcement
app.post('/admin/api/announcements/toggle', adminAuth, (req, res) => {
  const { id } = req.body || {};
  const a = announcements.find(x => x.id === id);
  if (!a) return res.status(404).json({ error: 'Announcement not found' });
  a.active = a.active === false; // paused (active:false) -> active; anything else -> paused
  saveAnnouncements(announcements);
  res.json({ ok: true, active: a.active });
});

// POST — delete an announcement
app.post('/admin/api/announcements/delete', adminAuth, (req, res) => {
  const { id } = req.body || {};
  announcements = announcements.filter(x => x.id !== id);
  saveAnnouncements(announcements);
  res.json({ ok: true });
});

app.get('/admin/api/events/summary', adminAuth, (req, res) => {
  try {
    if (!fs.existsSync(EVENTS_FILE)) return res.json({ total: 0, byOrg: {}, byType: {} });
    const lines = fs.readFileSync(EVENTS_FILE, 'utf8').trim().split('\n').filter(Boolean);
    const events = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const byOrg = {}, byType = {}, byOrgType = {};
    events.forEach(e => {
      byOrg[e.org] = (byOrg[e.org] || 0) + 1;
      byType[e.event] = (byType[e.event] || 0) + 1;
      if (e.org) {
        if (!byOrgType[e.org]) byOrgType[e.org] = {};
        byOrgType[e.org][e.event] = (byOrgType[e.org][e.event] || 0) + 1;
      }
    });
    const last7 = {};
    const now = Date.now();
    events.forEach(e => {
      const day = e.ts?.split('T')[0];
      if (day && (now - new Date(e.ts).getTime()) < 7 * 86400000) last7[day] = (last7[day] || 0) + 1;
    });
    res.json({ total: events.length, byOrg, byType, byOrgType, last7Days: last7 });
  } catch (e) { res.json({ total: 0, error: e.message }); }
});

// ═══════════════════════════════════════════
//  GEOCODING PROXY (server-side, cached)
// ═══════════════════════════════════════════
const GEO_CACHE_FILE = path.join(DATA_DIR, 'geocache.json');
let geoCache = {};
try { if (fs.existsSync(GEO_CACHE_FILE)) geoCache = JSON.parse(fs.readFileSync(GEO_CACHE_FILE, 'utf8')); } catch(e) {}
function saveGeoCache() { try { ensureDataDir(); fs.writeFileSync(GEO_CACHE_FILE, JSON.stringify(geoCache)); } catch(e) {} }

app.get('/:org/api/geocode', authMiddleware, async (req, res) => {
  const q = req.query.q;
  if (!q) return res.json({ lat: null, lng: null });
  if (geoCache[q]) return res.json(geoCache[q]);
  try {
    const resp = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=us`, {
      headers: { 'User-Agent': 'rec-dashboard/1.0 (dan@rec.us)' }
    });
    const data = await resp.json();
    if (data.length) {
      const result = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      geoCache[q] = result;
      saveGeoCache();
      console.log(`[GEO] ${q} → ${result.lat},${result.lng}`);
      res.json(result);
    } else {
      console.log(`[GEO] ${q} → not found`);
      geoCache[q] = { lat: null, lng: null };
      saveGeoCache();
      res.json({ lat: null, lng: null });
    }
  } catch(e) {
    console.error(`[GEO] ${q} error:`, e.message);
    res.json({ lat: null, lng: null });
  }
});

// ═══════════════════════════════════════════
//  ADMIN ORG TOGGLES
// ═══════════════════════════════════════════
app.post('/admin/api/orgs/:slug/toggles', adminAuth, (req, res) => {
  const { slug } = req.params;
  if (!ORGS[slug]) return res.status(404).json({ error: 'Not found' });
  if (!dashboardConfigs[slug]) dashboardConfigs[slug] = {};
  dashboardConfigs[slug].toggles = { ...dashboardConfigs[slug].toggles, ...req.body };
  dashboardConfigs[slug].updatedAt = new Date().toISOString();
  saveAllConfigs(dashboardConfigs);
  res.json({ ok: true, toggles: dashboardConfigs[slug].toggles });
});

// ── Escalation recipients — one stored list, editable from both sides ──
function parseNotifyEmails(body) {
  const raw = Array.isArray(body?.emails) ? body.emails : String(body?.emails || '').split(',');
  const emails = [...new Set(raw.map(e => String(e).trim().toLowerCase()).filter(Boolean))];
  if (emails.length > 10) return { error: 'Max 10 recipients' };
  for (const e of emails) if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { error: `Invalid email: ${e}` };
  return { emails };
}

// Rec side (admin panel)

// Org side (their dashboard's notification settings)

// ── POST /admin/api/orgs — add new org via admin panel ───────────────
// First place to look when a report link 404s: what does the reporting project
// actually call each org, and when did we last ask? A re-check is available here
// too, because the alternative is waiting up to 6h to see whether a fix took.
app.get('/admin/api/reporting-identity', adminAuth, async (req, res) => {
  if (req.query.recheck) await reconcileWithReporting().catch(() => {});
  const orgs = Object.keys(ORGS).sort().map(slug => {
    const id = REPORTING_IDENTITY[slug] || {};
    return { slug, orgId: ORGS[slug].orgId, reportingSlug: id.slug || null,
             state: id.state || 'unchecked', tokenDiffers: !!(id.token && id.token !== ORGS[slug].token),
             checkedAt: id.checkedAt || null };
  });
  const counts = orgs.reduce((a, o) => (a[o.state] = (a[o.state] || 0) + 1, a), {});
  res.json({ reportingBaseUrl: REPORTING_BASE_URL || null,
             reconcileEveryMs: REPORTING_RECONCILE_MS, counts, orgs });
});

app.post('/admin/api/orgs', adminAuth, async (req, res) => {
  const { slug, name, orgId, city, state, logoUrl } = req.body;
  if (!slug || !orgId) return res.status(400).json({ error: 'slug and orgId are required' });
  if (ORGS[slug]) return res.status(409).json({ error: `Org "${slug}" already exists` });
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return res.status(400).json({ error: 'Slug must be lowercase alphanumeric with hyphens' });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId)) return res.status(400).json({ error: 'Invalid org UUID format' });

  let token;
  let adoptedFromReporting = false;

  // Check if org already exists in the reporting project — if so, adopt its token
  let reportingSlug = slug;
  if (REPORTING_BASE_URL) {
    try {
      const get = async (u) => {
        const r = await fetch(`${REPORTING_BASE_URL}${u}`);
        return r.ok ? r.json() : null;
      };
      let existing = await get(`/api/admin/org/${encodeURIComponent(slug)}`);
      // Then by organisation UUID — and THIS is how the duplicate that broke
      // Shrewsbury got made. The reporting project already served that org under
      // another slug; a by-slug check missed it, so Add Org minted a second
      // identity for the same organisation and pushed it over there as a new one.
      // orgId is stable in both projects; the slug is the part that drifts.
      if (!(existing && existing.exists) && orgId) {
        existing = await get(`/api/admin/org-by-id/${encodeURIComponent(orgId)}`);
      }
      if (existing && existing.exists && existing.token) {
        token = existing.token;
        adoptedFromReporting = true;
        reportingSlug = existing.slug || slug;
        console.log(`[orgs] Adopted existing token from reporting project for: ${slug}`
          + (reportingSlug === slug ? '' : ` (it serves this org as \`${reportingSlug}\`)`));
      }
    } catch (e) {
      console.warn(`[orgs] Could not check reporting project for ${slug}:`, e.message);
    }
  }

  // Generate new token only if reporting project didn't have one
  if (!token) {
    const crypto = require('crypto');
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    token = '';
    for (let i = 0; i < 16; i++) token += chars[crypto.randomInt(chars.length)];
  }

  const org = {
    name: name || slug,
    orgId,
    token,
    city: city || '',
    state: state || '',
    logoUrl: logoUrl || `https://prod-rec-tech-img-bucket-8656aa2.s3.us-west-1.amazonaws.com/organization-${orgId}/fullLogo.png`,
    reports: {},
    _dynamic: true,
  };

  ORGS[slug] = org;
  saveDynamicOrgs();
  // Record what the reporting project actually calls it, so its report links are
  // right from the first page load rather than after the next 6h reconcile.
  REPORTING_IDENTITY[slug] = { slug: reportingSlug, token,
    state: reportingSlug === slug ? 'ok' : 'slug-drift', checkedAt: Date.now() };
  console.log(`[orgs] Added new org: ${slug} (${orgId})${adoptedFromReporting ? ' (token from reporting)' : ''}`);

  // Sync to rental-report so report links work with the same token
  // (even if we adopted the token, this ensures logoUrl/displayName stay in sync)
  if (REPORTING_BASE_URL && !adoptedFromReporting) {
    fetch(`${REPORTING_BASE_URL}/api/admin/add-org`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, token, orgId, logoUrl: org.logoUrl, displayName: name || slug }),
    }).then(r => r.json()).then(j => {
      console.log(`[orgs] Synced ${slug} to rental-report: ${j.action || j.error || 'ok'}`);
    }).catch(e => {
      console.error(`[orgs] Failed to sync ${slug} to rental-report:`, e.message);
    });
  }

  res.json({ ok: true, slug, token, adoptedFromReporting, org: { ...org, _dynamic: undefined } });
});

// ═══════════════════════════════════════════
//  DASHBOARD SHARING (read-only links)
// ═══════════════════════════════════════════
const SHARES_FILE = path.join(DATA_DIR, 'shares.json');
function loadShares() { try { if (fs.existsSync(SHARES_FILE)) return JSON.parse(fs.readFileSync(SHARES_FILE, 'utf8')); } catch(e){} return {}; }
function saveShares(s) { ensureDataDir(); fs.writeFileSync(SHARES_FILE, JSON.stringify(s, null, 2)); }
let shares = loadShares();

app.post('/:org/api/share', authMiddleware, (req, res) => {
  const crypto = require('crypto');
  const shareToken = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(); // 72 hours
  shares[shareToken] = {
    orgSlug: req.orgSlug,
    orgName: req.org.name,
    logoUrl: req.org.logoUrl,
    config: dashboardConfigs[req.orgSlug] || null,
    dateRange: req.body.dateRange || null,
    createdAt: new Date().toISOString(),
    expiresAt,
  };
  saveShares(shares);
  track_server(req.orgSlug, 'dashboard_shared', { shareToken: shareToken.slice(0, 8) });
  console.log(`[SHARE] ${req.orgSlug}: created share ${shareToken.slice(0, 8)}... expires ${expiresAt}`);
  const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  res.json({ ok: true, url: `${baseUrl}/share/${shareToken}`, expiresAt });
});

app.get('/share/:shareToken', (req, res) => {
  const share = shares[req.params.shareToken];
  if (!share) return res.status(404).send('Share link not found or expired.');
  if (new Date(share.expiresAt) < new Date()) {
    delete shares[req.params.shareToken];
    saveShares(shares);
    return res.status(410).send('This share link has expired.');
  }
  // Serve dashboard.html — the client will detect share mode via injected config
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Share config API (no auth — the share token IS the auth)
app.get('/share/:shareToken/config', (req, res) => {
  const share = shares[req.params.shareToken];
  if (!share || new Date(share.expiresAt) < new Date()) return res.status(404).json({ error: 'Expired' });
  const org = ORGS[share.orgSlug];
  if (!org) return res.status(404).json({ error: 'Org not found' });
  const availableReports = { ...SHARED_UUIDS };
  for (const r of Object.keys(org.reports || {})) availableReports[r] = true;
  const orgToggles = dashboardConfigs[share.orgSlug]?.toggles || {};
  res.json({
    config: share.config,
    availableReports,
    orgName: share.orgName,
    logoUrl: share.logoUrl,
    city: org.city,
    state: org.state,
    toggles: { ai: false, reportLinks: false, aiBriefing: !!orgToggles.aiBriefing, emailDigest: false },
    dateRange: share.dateRange,
    readOnly: true,
    expiresAt: share.expiresAt,
    orgSlug: share.orgSlug,
  });
});

// Share data proxy (no auth — share token is auth)
app.get('/share/:shareToken/data/:reportType', async (req, res) => {
  const share = shares[req.params.shareToken];
  if (!share || new Date(share.expiresAt) < new Date()) return res.status(404).json({ error: 'Expired' });
  try {
    let rows = await fetchMetabaseData(share.orgSlug, req.params.reportType, req.query);
    if (rows === null) return res.status(404).json({ error: 'Report not available' });
    if (req.params.reportType === 'users') rows = excludeStaffAndGuests(rows);
    res.json({ rows, meta: { count: rows.length } });
  } catch (e) {
    res.status(502).json({ error: 'Failed to fetch data', detail: e.message });
  }
});

// Share insights proxy (no auth — share token is auth)
app.post('/share/:shareToken/insights/:sectionId', async (req, res) => {
  const share = shares[req.params.shareToken];
  if (!share || new Date(share.expiresAt) < new Date()) return res.status(404).json({ error: 'Expired' });
  if (!ANTHROPIC_API_KEY) return res.status(503).json({ error: 'AI not configured' });
  const org = ORGS[share.orgSlug];
  if (!org) return res.status(404).json({ error: 'Org not found' });
  const { sectionId } = req.params;
  const { summary, dateRange } = req.body;
  const sectionPrompt = INSIGHT_PROMPTS[sectionId] || 'Analyze these metrics and provide actionable insights.';
  const prompt = `You are a sharp, data-driven parks and recreation analytics advisor helping ${org.name}.\n\n${SCHEMA_CONTEXT} Date range: ${dateRange || 'current month'}.\n\n${sectionPrompt}\n\nData:\n${summary}\n\nRespond with 4-5 punchy insights. Rules:\n- Start each insight with a relevant emoji\n- Use **bold** for key numbers and metrics\n- Each insight should be 1-2 sentences max\n- Mix positive callouts with actionable warnings\n- Reference specific numbers from the data\n- No headers, no intro text`;
  try {
    const parentSpan = _recTracer.startSpan('rec.insights', { attributes: { 'rec.org': share.orgSlug, 'rec.section': sectionId, 'langfuse.trace.name': 'rec-insights-share' } });
    const traceId = parentSpan.spanContext().traceId;
    const spanCtx = otelApi.trace.setSpan(otelApi.context.active(), parentSpan);
    const resp = await otelApi.context.with(spanCtx, () => fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 600, messages: [{ role: 'user', content: prompt }] })
    }));
    const data = await resp.json();
    const insight = data.content?.[0]?.text || 'No insights generated.';
    parentSpan.end();
    if (_langfuseProcessor) _langfuseProcessor.forceFlush().catch(() => {});
    res.json({ insight, traceId });
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate insights' });
  }
});

// ── Org dashboard routes ──

// --- Dashboard page ---
app.get('/:org', authMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// --- Data proxy ---
app.get('/:org/api/data/:reportType', authMiddleware, async (req, res) => {
  try {
    let rows = await fetchMetabaseData(req.orgSlug, req.params.reportType, req.query);
    if (rows === null) return res.status(404).json({ error: 'Report not available' });
    if (req.params.reportType === 'users') rows = excludeStaffAndGuests(rows);
    res.json({ rows, meta: { count: rows.length, cached: !!getCached(`${req.orgSlug}:${req.params.reportType}:${JSON.stringify(buildMetabaseParams(req.params.reportType, req.query))}`) } });
  } catch (e) {
    console.error(`[ERROR] ${req.orgSlug}/${req.params.reportType}:`, e.message);
    res.status(502).json({ error: 'Failed to fetch data', detail: e.message });
  }
});

// --- Dashboard config ---
app.get('/:org/api/config', authMiddleware, async (req, res) => {
  const config = dashboardConfigs[req.orgSlug] || null;
  // Also send available report types for this org
  const availableReports = {};
  const org = ORGS[req.orgSlug];
  for (const [r, uuid] of Object.entries(org.reports || {})) availableReports[r] = true;
  for (const [r, uuid] of Object.entries(SHARED_UUIDS)) availableReports[r] = true;
  // Fetch report visibility from rental-report
  let reportVisibility = null;
  try {
    // Their slug, not ours — see reportingIdentity(). This fetch was the second
    // silent casualty of the Shrewsbury drift: it 404'd for five weeks and the
    // catch below just logged it.
    const visResp = await fetch(`${REPORTING_BASE_URL}/api/org-visibility/${encodeURIComponent(reportingIdentity(req.orgSlug).slug || req.orgSlug)}`);
    if (visResp.ok) reportVisibility = await visResp.json();
  } catch (e) {
    console.error(`[config] Failed to fetch report visibility for ${req.orgSlug}:`, e.message);
  }

  res.json({ config, availableReports, orgName: org.name, logoUrl: org.logoUrl, city: org.city, state: org.state,
    // The rec.us organisation uuid, which is what an admin link is addressed
    // by: https://www.rec.us/admin/o/<recOrgId>/users/<id>. Ours to send —
    // this page is already token-authenticated for exactly this org, and the
    // same id is in every report URL it renders.
    recOrgId: org.orgId,
    toggles: config?.toggles || { ai: true, reportLinks: false, aiBriefing: false, emailDigest: false },
    reportingBaseUrl: REPORTING_BASE_URL,
    // The slug and token rental-report actually serves this org under. The page
    // must build report links from these rather than from its own ORG_SLUG/TOKEN,
    // which are the dashboard's names for the same organisation and can drift.
    reportingSlug: reportingIdentity(req.orgSlug).slug || req.orgSlug,
    reportingToken: reportingIdentity(req.orgSlug).token || org.token,
    announcements: activeAnnouncementsForOrg(req.orgSlug),
    reportVisibility: reportVisibility?.available || null });
});

app.post('/:org/api/config', authMiddleware, (req, res) => {
  dashboardConfigs[req.orgSlug] = {
    ...req.body,
    updatedAt: new Date().toISOString()
  };
  saveAllConfigs(dashboardConfigs);
  res.json({ ok: true });
});

// --- Reset dashboard ---
app.delete('/:org/api/config', authMiddleware, (req, res) => {
  delete dashboardConfigs[req.orgSlug];
  saveAllConfigs(dashboardConfigs);
  res.json({ ok: true });
});

// --- Cache management ---
app.post('/:org/api/cache/clear', authMiddleware, (req, res) => {
  let cleared = 0;
  for (const key of cache.keys()) {
    if (key.startsWith(req.orgSlug + ':')) { cache.delete(key); cleared++; }
  }
  res.json({ cleared });
});

// ═══════════════════════════════════════════
//  EVENT TRACKING
// ═══════════════════════════════════════════
const EVENTS_FILE = path.join(DATA_DIR, 'events.jsonl');

app.post('/:org/api/events', authMiddleware, (req, res) => {
  const events = Array.isArray(req.body) ? req.body : [req.body];
  const lines = events.map(evt => JSON.stringify({
    ...evt,
    org: req.orgSlug,
    ts: new Date().toISOString(),
    ua: req.headers['user-agent'] || ''
  })).join('\n') + '\n';
  
  ensureDataDir();
  fs.appendFileSync(EVENTS_FILE, lines);
  res.json({ ok: true, count: events.length });
});

// --- Event stats (for internal use) ---
app.get('/:org/api/events/stats', authMiddleware, (req, res) => {
  try {
    if (!fs.existsSync(EVENTS_FILE)) return res.json({ total: 0, byType: {} });
    const lines = fs.readFileSync(EVENTS_FILE, 'utf8').trim().split('\n').filter(Boolean);
    const allEvents = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const orgEvents = req.query.all ? allEvents : allEvents.filter(e => e.org === req.orgSlug);
    const byType = {};
    orgEvents.forEach(e => { byType[e.event] = (byType[e.event] || 0) + 1; });
    // Last 7 days daily activity
    const now = Date.now();
    const dailyActivity = {};
    orgEvents.forEach(e => {
      const day = e.ts?.split('T')[0];
      if (day && (now - new Date(e.ts).getTime()) < 7 * 86400000) {
        dailyActivity[day] = (dailyActivity[day] || 0) + 1;
      }
    });
    res.json({ total: orgEvents.length, byType, dailyActivity });
  } catch (e) {
    res.json({ total: 0, byType: {}, error: e.message });
  }
});

// ═══════════════════════════════════════════
//  AI INSIGHTS
// ═══════════════════════════════════════════
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'reports@rec.us';
const FROM_NAME = process.env.FROM_NAME || 'Rec Dashboard';

// ── Schema Context for AI Insights ──────────────────────────────────
const SCHEMA_CONTEXT = `
DATA MODEL REFERENCE (rec.us platform):
- program (template) -> section (schedulable instance) -> session (individual meeting)
- booking = enrollment. customer_user_id = payer/parent, participant_user_id = actual attendee (often a child for youth programs)
- Revenue: applied_pricing->'result'->>'finalCents' = actual charged cents. order_item.price = listed price (may differ from charged).
- booking.status: confirmed = active, planned = Fast Track pre-reg, pending = mid-checkout.
- booking.is_fast_track: true = pre-registration that promotes when registration opens.
- reservation timestamps are LOCAL time. All money amounts are cents (divide by 100 for dollars).
- Payment date != booking date. 30-40% of monthly payments cover bookings from prior months (season passes, payment plans).
- Canceled records use soft delete: canceled_at IS NOT NULL. Filter with canceled_at IS NULL for active.
- Household bookings (20-30%): parent pays, child attends.
- payment_method_type values: card-online, card-present, check, cash, organization-credit, scholarship, free.`;

const INSIGHT_PROMPTS = {
  revenue: 'Analyze these revenue/GL metrics. Focus on: revenue health, refund rates, payment method trends, and any GL codes that stand out.',
  facility: 'Analyze these facility rental metrics. Focus on: booking volume trends, top/underperforming locations, revenue per booking, and headcount patterns.',
  programs: 'Analyze these program enrollment metrics. Focus on: enrollment vs capacity (fill rates), top programs, revenue per enrollment, and cancellation rates.',
  courts: 'Analyze these court utilization metrics. Focus on: instant vs managed booking mix, busiest courts, utilization patterns, and growth opportunities.',
  fasttrack: 'Analyze these Fast Track pre-registration metrics. Focus on: conversion rates, pending signups that need follow-up, demand vs capacity, and which programs generate the most interest.',
  'users-demographics': 'Analyze these user and demographic metrics. Focus on: user growth trends, geographic concentration, age/gender distribution, and community reach.',
  // Every number on this section is easy to misread, so the prompt says so.
  // Churn Per Renewal is a hazard rate and NOT the share who have ever
  // cancelled; renewals are DERIVED from the period dates because no renewal
  // history exists anywhere in the schema; a weekly plan's rate and a monthly
  // plan's rate are different units and must not be ranked against each other;
  // and a pass is not a membership that merely is not auto-renewing — it has no
  // subscription column at all, so it can never convert.
  memberships: 'Analyze these membership metrics. The book splits into MEMBERSHIPS and PASSES: a pass (day pass, gate fee) has no subscription field in the schema at all, so it can never auto-renew and must never be described as a conversion opportunity. "Churn Per Renewal" is a hazard rate — the share of renewal OPPORTUNITIES that ended in a cancellation — not the share of members who have ever cancelled; do not describe it as monthly unless a plan\'s own cadence says so, and never rank a weekly plan\'s rate against a monthly one without naming both periods. Renewal counts are derived from the billing period dates, not logged, so treat them as estimates. Converting somebody to auto-renew means getting a card on file, not flipping a plan setting: auto-renew is only available on card payments. Focus on: which plans hold the book and what they earn a month, which plans leak members fastest in their own period, anyone scheduled to leave at period end and what that is worth, and plans with no auto-renew configured at all.',
  products: 'Analyze these product/POS sales metrics. Focus on: top sellers, revenue trends, refund rates, and sales volume patterns.',
  instructors: 'Analyze these instructor payout metrics. Focus on: revenue per instructor, section coverage, top performers, and refund exposure.',
  'executive-briefing': 'You are writing an executive briefing for a parks and recreation director. The data below is organized by dashboard section. IMPORTANT: "Revenue Overview" (GL data) is the authoritative financial revenue — use those numbers for headline revenue. "Programs & Enrollment" revenue is enrollment-specific and should be called "program revenue" not just "revenue." Do not conflate the two. Synthesize ALL sections into exactly 3 concise sentences. Sentence 1: the headline financial picture from Revenue Overview. Sentence 2: the most notable positive signal across any section. Sentence 3: the single biggest risk or item needing attention. Be specific with numbers. No bullets, no headers, no emoji — just 3 clean sentences a director can read in 10 seconds.',
};

// ── Send Dashboard Digest Now ─────────────────────────
app.post('/:org/api/send-digest', authMiddleware, async (req, res) => {
  if (!RESEND_API_KEY) return res.status(503).json({ ok: false, error: 'RESEND_API_KEY not configured' });
  const { email, sections, dateRange, orgName, briefing } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ ok: false, error: 'Valid email required' });
  if (!sections || !sections.length) return res.status(400).json({ ok: false, error: 'No dashboard data provided' });

  // Build HTML email from dashboard data
  const html = buildDigestEmail({ sections, dateRange, orgName, orgSlug: req.orgSlug, briefing });

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to: [email],
        subject: `${orgName || req.orgSlug} Dashboard Digest \u2014 ${dateRange || 'Current Period'}`,
        html: html,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.message || JSON.stringify(data));
    track_server(req.orgSlug, 'digest_sent', { email, sectionCount: sections.length });
    console.log(`[EMAIL] Digest sent to ${email} for ${req.orgSlug} (${data.id})`);
    res.json({ ok: true, emailId: data.id });
  } catch (e) {
    console.error('[EMAIL] Send failed:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

function buildDigestEmail({ sections, dateRange, orgName, orgSlug, briefing }) {
  const ACCENT = '#f97316';
  const SECTION_COLORS = ['#f97316','#3b82f6','#7c3aed','#059669','#d97706','#0891b2','#dc2626','#6366f1'];

  function kpiCard(label, value, idx) {
    const bg = idx % 2 === 0 ? '#fff7ed' : '#f0f9ff';
    const color = idx % 2 === 0 ? '#c2410c' : '#1d4ed8';
    return `<td style="width:50%;padding:8px">
      <div style="background:${bg};border-radius:8px;padding:16px;text-align:center">
        <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">${label}</div>
        <div style="font-size:24px;font-weight:700;color:${color}">${value}</div>
      </div>
    </td>`;
  }

  // Extract hero KPIs (first 4 metric widgets from first section)
  let heroCards = '';
  const firstSec = sections[0];
  if (firstSec && firstSec.widgets) {
    const metrics = firstSec.widgets.filter(w => !w.value?.includes(':') && !w.value?.includes(',')).slice(0, 4);
    if (metrics.length) {
      const rows = [];
      for (let i = 0; i < metrics.length; i += 2) {
        rows.push('<tr>' + kpiCard(metrics[i].label, metrics[i].value, i) +
          (metrics[i+1] ? kpiCard(metrics[i+1].label, metrics[i+1].value, i+1) : '<td></td>') + '</tr>');
      }
      heroCards = `<table style="width:100%;border-collapse:separate;border-spacing:0;margin:0 0 8px 0">${rows.join('')}</table>`;
    }
  }

  // AI Briefing block
  let briefingHtml = '';
  if (briefing) {
    briefingHtml = `
    <div style="background:linear-gradient(135deg,#7c3aed,#6d28d9);padding:18px 22px;border-radius:8px;margin:16px 0">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:rgba(255,255,255,.6);margin-bottom:10px">&#x2728; AI Executive Briefing</div>
      <div style="font-size:13px;color:#fff;line-height:1.7">${briefing}</div>
    </div>`;
  }

  // Section blocks
  const sectionHtml = sections.map((sec, si) => {
    const color = SECTION_COLORS[si % SECTION_COLORS.length];
    const widgets = sec.widgets || [];

    // Separate simple metrics from breakdown widgets
    const simpleMetrics = widgets.filter(w => w.value && !String(w.value).includes(':'));
    const breakdowns = widgets.filter(w => w.value && String(w.value).includes(':'));

    let metricsHtml = '';
    if (simpleMetrics.length) {
      metricsHtml = simpleMetrics.map(w => {
        const deltaHtml = w.delta ? ` <span style="font-size:11px;font-weight:600;color:${w.delta > 0 ? '#16a34a' : '#dc2626'}">${w.delta > 0 ? '&#x2191;' : '&#x2193;'}${Math.abs(w.delta)}%</span>` : '';
        return `<tr>
          <td style="padding:10px 14px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#555">${w.label}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #f3f4f6;font-size:16px;font-weight:700;color:#111;text-align:right">${w.value}${deltaHtml}</td>
        </tr>`;
      }).join('');
      metricsHtml = `<table style="width:100%;border-collapse:collapse">${metricsHtml}</table>`;
    }

    let breakdownHtml = '';
    if (breakdowns.length) {
      breakdownHtml = breakdowns.map(w => {
        const items = String(w.value).split(', ').slice(0, 5);
        const itemsHtml = items.map((item, ii) => {
          const parts = item.split(': ');
          const label = parts[0] || '';
          const val = parts[1] || '';
          const numVal = parseFloat(val.replace(/[^0-9.-]/g, '')) || 0;
          const maxVal = Math.max(...items.map(it => parseFloat((it.split(': ')[1] || '0').replace(/[^0-9.-]/g, '')) || 0), 1);
          const pct = Math.min(Math.round((numVal / maxVal) * 100), 100);
          return `<tr>
            <td style="padding:4px 14px;font-size:12px;color:#555;width:40%">${label}</td>
            <td style="padding:4px 14px;width:40%">
              <div style="background:#f3f4f6;border-radius:4px;height:14px;overflow:hidden">
                <div style="background:${color};height:100%;width:${pct}%;border-radius:4px"></div>
              </div>
            </td>
            <td style="padding:4px 14px;font-size:12px;font-weight:600;color:#333;text-align:right;white-space:nowrap">${val}</td>
          </tr>`;
        }).join('');
        return `<div style="margin-top:12px">
          <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.5px;padding:0 14px;margin-bottom:6px">${w.label}</div>
          <table style="width:100%;border-collapse:collapse">${itemsHtml}</table>
        </div>`;
      }).join('');
    }

    // Skip first section hero metrics (already shown as cards)
    const skipHero = si === 0;
    const filteredMetricsHtml = skipHero ? '' : metricsHtml;

    return `
    <div style="margin:20px 0">
      <div style="display:flex;align-items:center;gap:8px;padding-bottom:10px;border-bottom:3px solid ${color}">
        <span style="font-size:16px">${sec.icon || ''}</span>
        <span style="font-size:15px;font-weight:700;color:#111">${sec.title || 'Section'}</span>
      </div>
      ${filteredMetricsHtml}
      ${breakdownHtml}
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:600px;margin:20px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
    <div style="background:linear-gradient(135deg,#f97316,#ea580c);padding:28px 28px 20px">
      <div style="font-size:24px;font-weight:800;color:#fff">${orgName || orgSlug}</div>
      <div style="font-size:13px;color:rgba(255,255,255,.85);margin-top:4px">Dashboard Digest &mdash; ${dateRange || 'Current Period'}</div>
    </div>
    <div style="padding:20px 24px">
      ${heroCards}
      ${briefingHtml}
      ${sectionHtml}
      <div style="margin-top:28px;padding-top:20px;border-top:1px solid #eee;text-align:center">
        <a href="${process.env.BASE_URL || 'https://rec-dashboard-production.up.railway.app'}/${orgSlug}" style="display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#f97316,#ea580c);color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:700">Open Full Dashboard &#x2192;</a>
      </div>
      <div style="margin-top:16px;text-align:center;font-size:11px;color:#bbb">Powered by rec.us &mdash; Parks & Recreation Intelligence</div>
    </div>
  </div>
</body></html>`;
}

// ── Email Digest Subscribe (stub — persists to data/) ─────────────
const EMAIL_SUBS_FILE = path.join(DATA_DIR, 'email-subscriptions.json');
function loadEmailSubs() { try { if (fs.existsSync(EMAIL_SUBS_FILE)) return JSON.parse(fs.readFileSync(EMAIL_SUBS_FILE, 'utf8')); } catch(e){} return {}; }
function saveEmailSubs(subs) { ensureDataDir(); fs.writeFileSync(EMAIL_SUBS_FILE, JSON.stringify(subs, null, 2)); }
let emailSubs = loadEmailSubs();

app.post('/:org/api/email-subscribe', authMiddleware, (req, res) => {
  const { email, frequency } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ ok: false, error: 'Valid email required' });
  const validFreqs = ['daily', 'weekly', 'monthly'];
  const freq = validFreqs.includes(frequency) ? frequency : 'weekly';

  if (!emailSubs[req.orgSlug]) emailSubs[req.orgSlug] = [];
  // Upsert by email
  const existing = emailSubs[req.orgSlug].find(s => s.email === email);
  if (existing) {
    existing.frequency = freq;
    existing.updatedAt = new Date().toISOString();
  } else {
    emailSubs[req.orgSlug].push({ email, frequency: freq, subscribedAt: new Date().toISOString() });
  }
  saveEmailSubs(emailSubs);
  track_server(req.orgSlug, 'email_subscribed', { email, frequency: freq });
  console.log(`[EMAIL] ${req.orgSlug}: ${email} subscribed (${freq})`);
  res.json({ ok: true });
});

app.post('/:org/api/insights/:sectionId', authMiddleware, async (req, res) => {
  if (!ANTHROPIC_API_KEY) return res.status(503).json({ error: 'AI insights not configured (missing ANTHROPIC_API_KEY)' });
  const { sectionId } = req.params;
  const { summary, dateRange } = req.body;

  const sectionPrompt = INSIGHT_PROMPTS[sectionId] || 'Analyze these metrics and provide actionable insights.';
  const prompt = `You are a sharp, data-driven parks and recreation analytics advisor helping ${req.org.name}.

${SCHEMA_CONTEXT} Date range: ${dateRange || 'current month'}.

${sectionPrompt}

Data:
${summary}

Respond with 4-5 punchy insights. Rules:
- Start each insight with a relevant emoji (📈 📉 🔥 ⚠️ 💡 🎯 ✅ 🏆 💰 📊 etc.)
- Use **bold** for key numbers and metrics
- Each insight should be 1-2 sentences max — be direct
- Mix positive callouts with actionable warnings
- Reference specific numbers from the data
- No headers, no intro text — jump straight into the insights`;

  try {
    // Wrap in an OTel span so we can capture a traceId for user feedback → Langfuse
    // Wrap in an OTel span so we can capture a traceId for user feedback → Langfuse.
    // Set Langfuse semantic attributes so the trace shows the prompt + generated text.
    const parentSpan = _recTracer.startSpan('rec.insights', {
      attributes: {
        'rec.org': req.orgSlug,
        'rec.section': sectionId,
        'langfuse.trace.name': 'rec-insights',
        'langfuse.trace.input': prompt,
        'langfuse.trace.metadata': JSON.stringify({ org: req.orgSlug, section: sectionId, dateRange: dateRange || 'current month' }),
        'langfuse.observation.type': 'generation',
        'langfuse.observation.model.name': 'claude-haiku-4-5-20251001',
        'langfuse.observation.input': JSON.stringify([{ role: 'user', content: prompt }]),
      },
    });
    const traceId = parentSpan.spanContext().traceId;
    const spanCtx = otelApi.trace.setSpan(otelApi.context.active(), parentSpan);

    const resp = await otelApi.context.with(spanCtx, () => fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 600,
        messages: [{ role: 'user', content: prompt }] })
    }));
    const data = await resp.json();
    const insight = data.content?.[0]?.text || 'No insights generated.';
    const u = data.usage || {};
    parentSpan.setAttribute('langfuse.observation.output', insight);
    parentSpan.setAttribute('langfuse.trace.output', insight);
    if (u.input_tokens != null) {
      parentSpan.setAttribute('langfuse.observation.usage_details', JSON.stringify({ input: u.input_tokens, output: u.output_tokens || 0 }));
    }
    parentSpan.end();
    track_server(req.orgSlug, 'insight_generated', { section: sectionId, traceId });
    if (_langfuseProcessor) _langfuseProcessor.forceFlush().catch(() => {});
    res.json({ insight, traceId });
  } catch (e) {
    console.error('[AI] Insight error:', e.message);
    res.status(500).json({ error: 'Failed to generate insights' });
  }
});

// ── POST /:org/api/insights/:sectionId/score — thumbs up/down → Langfuse ──
app.post('/:org/api/insights/:sectionId/score', authMiddleware, (req, res) => {
  const { sectionId } = req.params;
  const { traceId, score, comment } = req.body || {};

  if (!traceId || typeof traceId !== 'string') {
    return res.status(400).json({ ok: false, error: 'traceId required' });
  }
  if (score !== 1 && score !== 0) {
    return res.status(400).json({ ok: false, error: 'score must be 1 (up) or 0 (down)' });
  }

  // Log locally
  track_server(req.orgSlug, 'insight_feedback', { section: sectionId, traceId, score, comment: (comment || '').slice(0, 500) });

  // Send to Langfuse asynchronously (don't block the response)
  if (process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY) {
    const baseUrl = process.env.LANGFUSE_BASE_URL || 'https://us.cloud.langfuse.com';
    const auth = Buffer.from(process.env.LANGFUSE_PUBLIC_KEY + ':' + process.env.LANGFUSE_SECRET_KEY).toString('base64');
    fetch(baseUrl + '/api/public/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + auth },
      body: JSON.stringify({
        traceId,
        name: 'user-feedback',
        value: score,
        comment: comment ? `[${req.orgSlug}/${sectionId}] ${comment}` : `[${req.orgSlug}/${sectionId}] ${score === 1 ? 'thumbs up' : 'thumbs down'}`,
        metadata: { org: req.orgSlug, section: sectionId, userComment: comment || null },
      }),
    })
    .then(r => {
      if (!r.ok) r.text().then(t => console.error('[langfuse] score error:', r.status, t.slice(0, 200)));
      else console.log('[langfuse] score sent:', traceId.slice(0, 8), score === 1 ? '\uD83D\uDC4D' : '\uD83D\uDC4E');
    })
    .catch(e => console.error('[langfuse] score error:', e.message));
  }

  res.json({ ok: true });
});

function track_server(org, event, props = {}) {
  try {
    ensureDataDir();
    const line = JSON.stringify({ event, org, ...props, ts: new Date().toISOString() }) + '\n';
    fs.appendFileSync(EVENTS_FILE, line);
  } catch(e) {}
}

// ═══════════════════════════════════════════
//  PRE-WARM CACHE
// ═══════════════════════════════════════════
async function warmCache() {
  const now = new Date();
  const start = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
  const end = new Date(now.getFullYear(), now.getMonth()+1, 0).toISOString().split('T')[0];

  for (const [slug, org] of Object.entries(ORGS)) {
    console.log(`[WARM] Pre-warming cache for ${slug} (${start} to ${end})`);
    // Collect all available report types for this org
    const reportTypes = new Set([...Object.keys(org.reports || {}), ...Object.keys(SHARED_UUIDS)]);

    for (const rt of reportTypes) {
      try {
        await fetchMetabaseData(slug, rt, { start, end });
        console.log(`[WARM] ${slug}/${rt} \u2713`);
      } catch (e) {
        console.log(`[WARM] ${slug}/${rt} \u2717 ${e.message}`);
      }
      // 2s between requests to be nice to Metabase
      await new Promise(r => setTimeout(r, 2000));
    }
    console.log(`[WARM] ${slug} complete — ${reportTypes.size} reports cached`);
  }
}

// ═══════════════════════════════════════════
//  START
// ═══════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`rec.us Dashboard running on port ${PORT}`);
  console.log(`Orgs: ${Object.keys(ORGS).join(', ')}`);
  // Pre-warm cache 5s after startup
  setTimeout(warmCache, 5000);
});

// ═══════════════════════════════════════════
//  METABASE CANARY — catch the next silent outage
// ═══════════════════════════════════════════
// 2026-08-10: a Metabase behavior change 400'd every widget fetch for every
// org and the dashboards rendered plausible-looking zeros for hours. This
// canary re-fetches one real org's GL feed through the SAME code path the
// widgets use, hourly, and alerts when it errors or comes back empty after
// previously having rows. Alerts go to Slack when SLACK_WEBHOOK_URL is set,
// else email via Resend (ALERT_EMAIL, default dan@rec.us), else console.
const CANARY_INTERVAL_MS = 60 * 60 * 1000;   // hourly
const CANARY_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;  // re-alert at most every 6h while broken
let _canaryLastGood = null;   // row count from the last successful probe
let _canaryLastAlert = 0;
let _canaryBroken = false;

async function sendOpsAlert(subject, body) {
  const slack = process.env.SLACK_WEBHOOK_URL;
  if (slack) {
    try {
      await fetch(slack, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `*${subject}*\n${body}` }) });
      return;
    } catch (e) { console.error('[canary] Slack alert failed:', e.message); }
  }
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL || 'dan@rec.us';
  if (key) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `${process.env.FROM_NAME || 'Rec Dashboard'} <${process.env.FROM_EMAIL || 'reports@rec.us'}>`,
          to, subject,
          html: `<pre style="font-family:sans-serif;white-space:pre-wrap">${body}</pre>`,
        }),
      });
      return;
    } catch (e) { console.error('[canary] Resend alert failed:', e.message); }
  }
  console.error(`[canary] ALERT (no Slack/Resend configured): ${subject} — ${body}`);
}

async function runMetabaseCanary() {
  // First org with an orgId — GL is a shared card, so any real org works.
  const slug = Object.keys(ORGS).find(s => ORGS[s]?.orgId);
  if (!slug) return;
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  try {
    const rows = await fetchMetabaseData(slug, 'gl', { start, end, _canary: Date.now() });
    const n = Array.isArray(rows) ? rows.length : 0;
    if (n === 0 && _canaryLastGood > 0) {
      throw new Error(`GL probe returned 0 rows for ${slug} (last good probe had ${_canaryLastGood})`);
    }
    if (n > 0) _canaryLastGood = n;
    if (_canaryBroken) {
      _canaryBroken = false;
      await sendOpsAlert('✅ rec-dashboard Metabase canary recovered',
        `${slug}/gl (${start}..${end}) returned ${n} rows. Dashboards should be healthy again.`);
    }
    console.log(`[canary] OK — ${slug}/gl ${n} rows`);
  } catch (e) {
    _canaryBroken = true;
    console.error(`[canary] FAIL — ${slug}/gl: ${e.message}`);
    if (Date.now() - _canaryLastAlert > CANARY_ALERT_COOLDOWN_MS) {
      _canaryLastAlert = Date.now();
      await sendOpsAlert('🚨 rec-dashboard Metabase canary FAILED — dashboards may be showing zeros',
        `Probe: ${slug}/gl ${start}..${end}\nError: ${e.message}\n\nThis probe uses the exact fetch path the dashboard widgets use. ` +
        `If it fails, every org's dashboard is likely rendering empty/zero widgets. ` +
        `Check Railway logs for [ERROR] lines and the Metabase public-card endpoints.`);
    }
  }
}
setTimeout(runMetabaseCanary, 2 * 60 * 1000);      // first probe 2 min after boot
setInterval(runMetabaseCanary, CANARY_INTERVAL_MS);
