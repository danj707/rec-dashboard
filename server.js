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
const { getSupportRows } = require('./support-data');
const { getSupportInbox, getSupportThread } = require('./support-inbox-data');
const intercomLive = require('./intercom-live');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3200;
const DATA_DIR = process.env.DATA_DIR || './data';
const METABASE_URL = process.env.METABASE_URL || 'https://rec.metabaseapp.com';
const REPORTING_BASE_URL = process.env.REPORTING_BASE_URL || 'https://rental-report-production-a046.up.railway.app';

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
    // Support testbed: Niagara's Intercom contacts are Rec test accounts —
    // safe to exercise forwards, tags, and escalation emails here.
    intercomOrg: 'city-of-niagara-falls',
    supportNotify: ['dan@rec.us'],
  },
  torrance: {
    name: 'City of Torrance',
    orgId: '4246b144-a4e2-4bf1-bb7f-a89f47d71973',
    token: 'Xq3RtBnW8vKdM2Ly',
    city: 'Torrance',
    state: 'CA',
    intercomOrg: 'city-of-torrance', // Intercom contact attribute `Organization` — enables live support data
    // Torrance is a LIVE org: support tab stays read-only (no forwards, no
    // tags/notes written to their real conversations, no escalation emails)
    // until the flow is proven out on the Niagara testbed. No supportNotify.
    supportReadOnly: true,
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

// Reports available to ALL orgs via shared Metabase cards (need org_id param)
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
  // null until public sharing is enabled on the card; while null the
  // Revenue by Stream widget falls back to inferring streams from the
  // section-dated reports.
  revstreams: null
};

// Reports that don't accept date parameters
const NO_DATE_REPORTS = new Set([
  'program-demographics', 'memberships', 'users', 'retention', 'checkins', 'fasttrack'
]);

// ═══════════════════════════════════════════
//  IN-MEMORY CACHE
// ═══════════════════════════════════════════
const cache = new Map();
const DEFAULT_CACHE_TTL = 15 * 60 * 1000; // 15 min

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > entry.ttl) { cache.delete(key); return null; }
  return entry.data;
}

function setCache(key, data, ttl = DEFAULT_CACHE_TTL) {
  cache.set(key, { data, ts: Date.now(), ttl });
}

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

// ── Support enablement (code + admin config merged) ─────────────────
// An org has Customer Support if it carries a code-level intercomOrg
// mapping OR the admin panel's "Customer Support" toggle is on. The
// Intercom `Organization` attribute defaults to the slug (code override
// wins for mismatches like torrance → city-of-torrance). Escalation
// recipients come from admin/org-managed config first, code fallback.
function supportSettings(slug) {
  const org = ORGS[slug] || {};
  const cfg = dashboardConfigs[slug] || {};
  const enabled = !!(org.intercomOrg || cfg.toggles?.support);
  const notify = (Array.isArray(cfg.supportNotify) && cfg.supportNotify.length ? cfg.supportNotify : org.supportNotify) || [];
  return {
    enabled,
    intercomOrg: enabled ? (org.intercomOrg || slug) : null,
    notify,
    readOnly: !!org.supportReadOnly,
  };
}

// Org object with the effective support fields resolved — what the
// intercom-live client expects.
function effectiveSupportOrg(slug) {
  const ss = supportSettings(slug);
  return { ...(ORGS[slug] || {}), intercomOrg: ss.intercomOrg, supportNotify: ss.notify };
}

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
    // The revstreams card's start/end template tags are text variables (its
    // SQL casts them with ::date), so date/single params would be rejected —
    // send them the same way org_id goes over. Don't change those tags to
    // Date in the Metabase UI or this stops matching.
    const dateType = reportType === 'revstreams' ? 'string/=' : 'date/single';
    if (start) params.push({ type: dateType, target: ['variable', ['template-tag', 'start_date']], value: start });
    if (end) params.push({ type: dateType, target: ['variable', ['template-tag', 'end_date']], value: end });
  }
  return params;
}

async function fetchMetabaseData(orgSlug, reportType, query) {
  const org = ORGS[orgSlug];
  const eff = effectiveSupportOrg(orgSlug);
  // Support data comes from Intercom, not Metabase — short-circuit before the card lookup.
  // Live API when INTERCOM_ACCESS_TOKEN is set (cached), else the baked snapshot.
  if (reportType === 'support') {
    if (intercomLive.liveEnabled() && eff.intercomOrg) {
      const cacheKey = `${orgSlug}:support:${query.start}:${query.end}`;
      const cached = getCached(cacheKey);
      if (cached) return cached;
      try {
        const rows = await intercomLive.liveSupportRows(eff, query, orgSlug);
        console.log(`[DATA] ${orgSlug}/support: ${rows.length} rows (intercom LIVE)`);
        setCache(cacheKey, rows, 15 * 60 * 1000);
        return rows;
      } catch (e) {
        console.error(`[intercom] live rows failed, falling back to snapshot:`, e.message);
      }
    }
    const rows = getSupportRows(orgSlug, query);
    if (rows) console.log(`[DATA] ${orgSlug}/support: ${rows.length} rows (intercom snapshot)`);
    return rows;
  }
  // Per-org UUID takes priority; fall back to shared
  const isShared = !org.reports?.[reportType];
  const uuid = org.reports?.[reportType] || SHARED_UUIDS[reportType];
  if (!uuid) return null;

  const params = buildMetabaseParams(reportType, query);
  // Shared UUIDs need org_id to filter data
  if (isShared && org.orgId) {
    params.push({ type: 'string/=', target: ['variable', ['template-tag', 'org_id']], value: org.orgId });
  }
  const cacheKey = `${orgSlug}:${reportType}:${JSON.stringify(params)}`;
  
  // Check org-specific cache TTL
  const orgConfig = dashboardConfigs[orgSlug];
  const ttl = (orgConfig?.cacheTTL || 15) * 60 * 1000;
  
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const paramStr = params.length ? `?parameters=${encodeURIComponent(JSON.stringify(params))}` : '';
  const url = `${METABASE_URL}/api/public/card/${uuid}/query/json${paramStr}`;

  console.log(`[FETCH] ${orgSlug}/${reportType} → ${uuid} (shared=${isShared})`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Metabase ${resp.status}: ${resp.statusText}`);
  
  const rows = await resp.json();
  console.log(`[DATA] ${orgSlug}/${reportType}: ${rows.length} rows${rows.length > 0 ? ', cols: ' + Object.keys(rows[0]).join(', ') : ''}`);
  setCache(cacheKey, rows, ttl);
  return rows;
}

// ═══════════════════════════════════════════
//  UPDATES LOG
// ═══════════════════════════════════════════
const UPDATES = [
  
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
      support: supportSettings(slug).enabled,
      supportNotify: supportSettings(slug).notify,
      supportReadOnly: !!org.supportReadOnly,
      supportLockedOn: !!org.intercomOrg, // code-level mapping — toggle can't turn it off
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
  support:     { label: 'Customer Support', emoji: '💬' },
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
  try { if (supportSettings(slug).enabled) out.push('support'); } catch (e) {}
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
      if (items.length) out.push({ id: a.id, title: a.title, smart: true, items: items.map(it => ({ text: it.text, emoji: it.emoji })) });
    } else if (a.allOrgs || (Array.isArray(a.orgs) && a.orgs.includes(slug))) {
      out.push({ id: a.id, title: a.title, body: a.body });
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
  // Enabling support spins up the org's routing tag in Intercom right away
  if (req.body.support === true && intercomLive.liveEnabled()) {
    intercomLive.ensureOrgTags(ORGS).then(t => console.log(`[intercom] tags ensured after enabling support for ${slug}`))
      .catch(e => console.error('[intercom] tag provisioning failed:', e.message));
  }
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

function setSupportNotify(slug, emails) {
  if (!dashboardConfigs[slug]) dashboardConfigs[slug] = {};
  dashboardConfigs[slug].supportNotify = emails;
  dashboardConfigs[slug].updatedAt = new Date().toISOString();
  saveAllConfigs(dashboardConfigs);
}

// Rec side (admin panel)
app.post('/admin/api/orgs/:slug/support-notify', adminAuth, (req, res) => {
  const { slug } = req.params;
  if (!ORGS[slug]) return res.status(404).json({ error: 'Not found' });
  const parsed = parseNotifyEmails(req.body);
  if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error });
  setSupportNotify(slug, parsed.emails);
  console.log(`[support] ${slug}: escalation recipients set via admin → ${parsed.emails.join(', ') || '(none)'}`);
  res.json({ ok: true, emails: parsed.emails });
});

// Org side (their dashboard's notification settings)
app.post('/:org/api/support/notify-emails', authMiddleware, (req, res) => {
  const parsed = parseNotifyEmails(req.body);
  if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error });
  setSupportNotify(req.orgSlug, parsed.emails);
  track_server(req.orgSlug, 'support_notify_updated', { count: parsed.emails.length });
  console.log(`[support] ${req.orgSlug}: escalation recipients set by org → ${parsed.emails.join(', ') || '(none)'}`);
  res.json({ ok: true, emails: parsed.emails });
});

// ── POST /admin/api/orgs — add new org via admin panel ───────────────
app.post('/admin/api/orgs', adminAuth, async (req, res) => {
  const { slug, name, orgId, city, state, logoUrl } = req.body;
  if (!slug || !orgId) return res.status(400).json({ error: 'slug and orgId are required' });
  if (ORGS[slug]) return res.status(409).json({ error: `Org "${slug}" already exists` });
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return res.status(400).json({ error: 'Slug must be lowercase alphanumeric with hyphens' });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId)) return res.status(400).json({ error: 'Invalid org UUID format' });

  let token;
  let adoptedFromReporting = false;

  // Check if org already exists in the reporting project — if so, adopt its token
  if (REPORTING_BASE_URL) {
    try {
      const check = await fetch(`${REPORTING_BASE_URL}/api/admin/org/${encodeURIComponent(slug)}`);
      if (check.ok) {
        const existing = await check.json();
        if (existing.exists && existing.token) {
          token = existing.token;
          adoptedFromReporting = true;
          console.log(`[orgs] Adopted existing token from reporting project for: ${slug}`);
        }
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
    const rows = await fetchMetabaseData(share.orgSlug, req.params.reportType, req.query);
    if (rows === null) return res.status(404).json({ error: 'Report not available' });
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
    const rows = await fetchMetabaseData(req.orgSlug, req.params.reportType, req.query);
    if (rows === null) return res.status(404).json({ error: 'Report not available' });
    res.json({ rows, meta: { count: rows.length, cached: !!getCached(`${req.orgSlug}:${req.params.reportType}:${JSON.stringify(buildMetabaseParams(req.params.reportType, req.query))}`) } });
  } catch (e) {
    console.error(`[ERROR] ${req.orgSlug}/${req.params.reportType}:`, e.message);
    res.status(502).json({ error: 'Failed to fetch data', detail: e.message });
  }
});

// ── Support Inbox (Intercom) ─────────────────────────────────────────
// List: live Intercom when INTERCOM_ACCESS_TOKEN is set, snapshot otherwise.
app.get('/:org/api/support/inbox', authMiddleware, async (req, res) => {
  const org = ORGS[req.orgSlug];
  const eff = effectiveSupportOrg(req.orgSlug);
  const query = { start: req.query.start || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), end: req.query.end };
  if (intercomLive.liveEnabled() && eff.intercomOrg) {
    const fresh = req.query.fresh === '1'; // manual refresh: skip caches, still repopulate them
    const cacheKey = `${req.orgSlug}:support-inbox:${query.start}:${query.end}`;
    const cached = fresh ? null : getCached(cacheKey);
    if (cached) return res.json({ conversations: cached, live: true });
    try {
      const list = await intercomLive.liveSupportInbox(eff, query, req.orgSlug, fresh);
      console.log(`[DATA] ${req.orgSlug}/support-inbox: ${list.length} conversations (intercom LIVE)`);
      setCache(cacheKey, list, 5 * 60 * 1000);
      return res.json({ conversations: list, live: true });
    } catch (e) {
      console.error('[intercom] live inbox failed, falling back to snapshot:', e.message);
    }
  }
  const list = getSupportInbox(req.orgSlug);
  if (!list) return res.status(404).json({ error: 'Support inbox not available for this org' });
  res.json({ conversations: list, live: false });
});

app.get('/:org/api/support/inbox/:id', authMiddleware, async (req, res) => {
  const org = ORGS[req.orgSlug];
  const eff = effectiveSupportOrg(req.orgSlug);
  if (intercomLive.liveEnabled() && eff.intercomOrg) {
    const cacheKey = `${req.orgSlug}:support-thread:${req.params.id}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json({ conversation: cached, live: true });
    try {
      const thread = await intercomLive.liveSupportThread(eff, req.params.id, req.orgSlug);
      if (thread) { setCache(cacheKey, thread, 5 * 60 * 1000); return res.json({ conversation: thread, live: true }); }
      return res.status(404).json({ error: 'Conversation not found' });
    } catch (e) {
      console.error('[intercom] live thread failed, falling back to snapshot:', e.message);
    }
  }
  const thread = getSupportThread(req.orgSlug, req.params.id);
  if (!thread) return res.status(404).json({ error: 'Conversation not found' });
  res.json({ conversation: thread, live: false });
});

// Forward a conversation to an org admin via email (Resend) — the "tag your
// staff on a resident question" action.
app.post('/:org/api/support/inbox/:id/forward', authMiddleware, async (req, res) => {
  const { to, note } = req.body || {};
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ ok: false, error: 'Valid "to" email required' });
  const org = ORGS[req.orgSlug];
  const eff = effectiveSupportOrg(req.orgSlug);
  if (org?.supportReadOnly) return res.status(403).json({ ok: false, error: 'Support actions are disabled for this org while the feature is in testing' });
  let thread = null;
  if (intercomLive.liveEnabled() && eff.intercomOrg) {
    try { thread = await intercomLive.liveSupportThread(eff, req.params.id, req.orgSlug); } catch (e) { /* fall through to snapshot */ }
  }
  if (!thread) thread = getSupportThread(req.orgSlug, req.params.id);
  if (!thread) return res.status(404).json({ ok: false, error: 'Conversation not found' });
  if (!RESEND_API_KEY) return res.status(503).json({ ok: false, error: 'RESEND_API_KEY not configured' });

  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  const ROLE_LABEL = { resident: 'Resident', ai: 'Rec AI Agent', agent: 'Rec Support', note: 'Internal Note' };
  const msgsHtml = thread.messages.map(m => `
    <div style="margin:0 0 14px 0;padding:10px 14px;border-radius:8px;background:${m.role === 'resident' ? '#f4f4f2' : m.role === 'note' ? '#fffbe6' : '#eef4fd'};border:1px solid #e5e2db">
      <div style="font-size:11px;font-weight:700;color:#666;margin-bottom:4px">${esc(m.name)} · ${ROLE_LABEL[m.role] || m.role} · ${new Date(m.at * 1000).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
      <div style="font-size:13px;color:#222;line-height:1.5">${esc(m.text)}</div>
    </div>`).join('');
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;padding:20px">
      <p style="font-size:13px;color:#444">A resident support conversation was forwarded to you from the ${esc(org.name)} dashboard.</p>
      ${note ? `<div style="padding:12px 14px;background:#fef3e2;border:1px solid #f5d9a8;border-radius:8px;margin:0 0 16px 0"><div style="font-size:11px;font-weight:700;color:#92600a;margin-bottom:4px">Note from your team</div><div style="font-size:13px;color:#333">${esc(note)}</div></div>` : ''}
      <h2 style="font-size:16px;margin:0 0 2px 0">${esc(thread.subject)}</h2>
      <p style="font-size:12px;color:#777;margin:0 0 16px 0">${esc(thread.contact.name)} &lt;${esc(thread.contact.email)}&gt; · ${thread.channel} · ${esc(thread.topic)} · ${thread.state}</p>
      ${msgsHtml}
      <p style="font-size:11px;color:#999;margin-top:20px">Handled by Rec Support on behalf of ${esc(org.name)}. Hitting reply on this email goes straight to the resident — you'll be writing as yourself, not as Rec. Or start fresh: <a href="mailto:${encodeURIComponent(thread.contact.email)}?subject=${encodeURIComponent('Re: ' + thread.subject)}">email ${esc(thread.contact.email)}</a>.</p>
    </div>`;
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to: [to],
        // The whole point of forwarding is org staff replying to the
        // resident as themselves — make "Reply" in their mail client
        // address the resident, not Rec.
        reply_to: thread.contact.email || undefined,
        subject: `[${org.name} Support] Fwd: ${thread.subject}`,
        html,
      }),
    });
    const json = await resp.json();
    if (!resp.ok) throw new Error(json?.message || `Resend ${resp.status}`);
    track_server(req.orgSlug, 'support_forwarded', { to, conversationId: req.params.id });
    // Best-effort Intercom write-back: tag the conversation + internal note so
    // Rec staff see the escalation in Intercom, and the dashboard reads the
    // tag back on refresh. Email already went out — never fail on this.
    let escalated = false;
    if (intercomLive.liveEnabled()) {
      try {
        escalated = await intercomLive.markEscalatedToOrg(req.params.id, { orgName: org.name, to, note });
        // Bust cached views so the tag shows without waiting out the TTL
        cache.delete(`${req.orgSlug}:support-thread:${req.params.id}`);
        for (const key of cache.keys()) if (key.startsWith(`${req.orgSlug}:support-inbox:`)) cache.delete(key);
        // The org admin was just emailed directly — don't let the notifier double-send
        markNotified(req.params.id);
      } catch (e) {
        console.error('[intercom] escalate write-back failed (email was sent):', e.message);
      }
    }
    res.json({ ok: true, id: json.id, escalated });
  } catch (e) {
    console.error('[support] forward failed:', e.message);
    res.status(502).json({ ok: false, error: e.message });
  }
});

// Org staff set a conversation's status from their dashboard. Mirrors into
// Intercom (Org Resolved tag + internal note + close/reopen) so Rec CS sees
// the outcome, and clears the conversation off the org's action list.
app.post('/:org/api/support/inbox/:id/status', authMiddleware, async (req, res) => {
  const { status, note } = req.body || {};
  if (!['resolved', 'no_action', 'reopen'].includes(status)) return res.status(400).json({ ok: false, error: 'Invalid status' });
  const org = ORGS[req.orgSlug];
  const eff = effectiveSupportOrg(req.orgSlug);
  if (org?.supportReadOnly) return res.status(403).json({ ok: false, error: 'Support actions are disabled for this org while the feature is in testing' });
  if (!intercomLive.liveEnabled() || !eff.intercomOrg) return res.status(503).json({ ok: false, error: 'Live Intercom not configured' });
  try {
    // Access check: only conversations visible to this org can be acted on
    const thread = await intercomLive.liveSupportThread(eff, req.params.id, req.orgSlug);
    if (!thread) return res.status(404).json({ ok: false, error: 'Conversation not found' });
    const result = await intercomLive.markOrgStatus(req.params.id, status, { orgName: org.name, note });
    cache.delete(`${req.orgSlug}:support-thread:${req.params.id}`);
    for (const key of cache.keys()) if (key.startsWith(`${req.orgSlug}:support-inbox:`)) cache.delete(key);
    track_server(req.orgSlug, 'support_status_set', { conversationId: req.params.id, status });
    console.log(`[support] ${req.orgSlug}: conversation ${req.params.id} marked ${status} by org staff`);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('[support] status change failed:', e.message);
    res.status(502).json({ ok: false, error: e.message });
  }
});

// Org staff add an internal note from their dashboard — Rec CS sees it in
// Intercom; the resident never does. The org→Rec communication channel.
app.post('/:org/api/support/inbox/:id/note', authMiddleware, async (req, res) => {
  const text = (req.body?.text || '').trim();
  if (!text) return res.status(400).json({ ok: false, error: 'Note text required' });
  if (text.length > 4000) return res.status(400).json({ ok: false, error: 'Note too long (4000 chars max)' });
  const org = ORGS[req.orgSlug];
  const eff = effectiveSupportOrg(req.orgSlug);
  if (org?.supportReadOnly) return res.status(403).json({ ok: false, error: 'Support actions are disabled for this org while the feature is in testing' });
  if (!intercomLive.liveEnabled() || !eff.intercomOrg) return res.status(503).json({ ok: false, error: 'Live Intercom not configured' });
  try {
    const thread = await intercomLive.liveSupportThread(eff, req.params.id, req.orgSlug);
    if (!thread) return res.status(404).json({ ok: false, error: 'Conversation not found' });
    await intercomLive.addOrgNote(req.params.id, { orgName: org.name, text });
    cache.delete(`${req.orgSlug}:support-thread:${req.params.id}`);
    track_server(req.orgSlug, 'support_note_added', { conversationId: req.params.id });
    res.json({ ok: true });
  } catch (e) {
    console.error('[support] note failed:', e.message);
    res.status(502).json({ ok: false, error: e.message });
  }
});

// --- Dashboard config ---
app.get('/:org/api/config', authMiddleware, async (req, res) => {
  const config = dashboardConfigs[req.orgSlug] || null;
  // Also send available report types for this org
  const availableReports = {};
  const org = ORGS[req.orgSlug];
  const eff = effectiveSupportOrg(req.orgSlug);
  for (const [r, uuid] of Object.entries(org.reports || {})) availableReports[r] = true;
  for (const [r, uuid] of Object.entries(SHARED_UUIDS)) availableReports[r] = true;
  // Support is Intercom-backed — offered to orgs with a snapshot, or any
  // org with a live Intercom mapping when the token is configured
  const ss = supportSettings(req.orgSlug);
  if (getSupportRows(req.orgSlug) || (intercomLive.liveEnabled() && ss.enabled)) availableReports.support = true;
  // Fetch report visibility from rental-report
  let reportVisibility = null;
  try {
    const visResp = await fetch(`${REPORTING_BASE_URL}/api/org-visibility/${req.orgSlug}`);
    if (visResp.ok) reportVisibility = await visResp.json();
  } catch (e) {
    console.error(`[config] Failed to fetch report visibility for ${req.orgSlug}:`, e.message);
  }

  res.json({ config, availableReports, orgName: org.name, logoUrl: org.logoUrl, city: org.city, state: org.state,
    toggles: config?.toggles || { ai: true, reportLinks: false, aiBriefing: false, emailDigest: false },
    reportingBaseUrl: REPORTING_BASE_URL,
    supportReadOnly: !!org.supportReadOnly,
    supportNotify: ss.notify,
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
  memberships: 'Analyze these membership metrics. Focus on: active vs canceled ratio, revenue per member, renewal patterns, and retention opportunities.',
  products: 'Analyze these product/POS sales metrics. Focus on: top sellers, revenue trends, refund rates, and sales volume patterns.',
  instructors: 'Analyze these instructor payout metrics. Focus on: revenue per instructor, section coverage, top performers, and refund exposure.',
  support: 'Analyze these resident support metrics. Rec\'s support team handles these conversations on the org\'s behalf, so frame insights around what residents are struggling with and what the org could fix upstream. Focus on: which topics drive the most volume, whether AI resolution is holding up or escalating, how fast residents get resolved, and any topic that looks like a self-service or documentation gap rather than a one-off.',
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
//  ESCALATION NOTIFIER
//
//  Rec staff tag a conversation "Org Escalated" in Intercom → the org's
//  configured admins (org.supportNotify) get a Resend email with a deep
//  link that opens the dashboard on that exact conversation. Polls every
//  3 minutes; notified conversation IDs persist to DATA_DIR so restarts
//  don't re-send. Dashboard-initiated forwards mark themselves notified
//  (the admin was already emailed directly).
// ═══════════════════════════════════════════
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://rec-dashboard-production.up.railway.app';

// Current month in YYYY-MM-DD, matching the frontend's default date preset
function getMonthRangeServer() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = d => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}
// v2: v1 wrongly marked unmatched conversations as processed forever; fresh
// file so tagged-but-unrouted test conversations become eligible again.
const NOTIFIED_FILE = path.join(DATA_DIR, 'support-notified-v2.json');
let _notified = null;
function loadNotified() {
  if (_notified) return _notified;
  try { _notified = new Set(JSON.parse(fs.readFileSync(NOTIFIED_FILE, 'utf8'))); }
  catch (e) { _notified = new Set(); }
  return _notified;
}
function markNotified(id) {
  const set = loadNotified();
  set.add(String(id));
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(NOTIFIED_FILE, JSON.stringify([...set]));
  } catch (e) { console.error('[notify] persist failed:', e.message); }
}

async function sendEscalationEmail(orgSlug, org, entry) {
  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const link = `${PUBLIC_BASE_URL}/${orgSlug}?token=${org.token}&tab=support&conversation=${entry.id}`;
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px">
      <div style="font-size:11px;font-weight:700;letter-spacing:1px;color:#f59e0b;text-transform:uppercase;margin-bottom:6px">Rec Customer Support</div>
      <h2 style="font-size:18px;margin:0 0 14px 0;color:#111">You have a new Customer Support inquiry via Rec</h2>
      <div style="padding:14px 16px;background:#f9f9f7;border:1px solid #e8e5df;border-radius:10px;margin-bottom:18px">
        <div style="font-size:14px;font-weight:700;color:#111;margin-bottom:3px">${esc(entry.subject)}</div>
        <div style="font-size:12px;color:#777;margin-bottom:8px">${esc(entry.contact.name)} · ${entry.channel} · ${esc(entry.topic)}</div>
        <div style="font-size:13px;color:#333;line-height:1.5">${esc(entry.preview)}</div>
      </div>
      <a href="${link}" style="display:inline-block;background:#f59e0b;color:#000;font-weight:700;font-size:14px;padding:11px 24px;border-radius:8px;text-decoration:none">View the conversation →</a>
      <p style="font-size:11px;color:#999;margin-top:20px">Rec's support team flagged this resident conversation for ${esc(org.name)}. The link opens your Rec dashboard with the conversation pulled up.</p>
    </div>`;
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: org.supportNotify,
      subject: `You have a new Customer Support inquiry via Rec — ${entry.subject}`,
      html,
    }),
  });
  if (!resp.ok) throw new Error(`Resend ${resp.status}`);
}

async function pollEscalations() {
  if (!intercomLive.liveEnabled() || !RESEND_API_KEY) return;
  try {
    const tagged = await intercomLive.liveEscalatedConversations();
    if (!tagged) return;
    const notified = loadNotified();
    for (const { conv, contact } of tagged) {
      // "Org Notify" is an explicit re-ping: bypasses the notified-set and
      // the resolved-skip, and the tag is removed after sending.
      const isPing = intercomLive.hasTagNamed(conv, intercomLive.ORG_NOTIFY_TAG);
      if (!isPing) {
        if (notified.has(String(conv.id))) continue;
        if (intercomLive.hasTagNamed(conv, intercomLive.ORG_RESOLVED_TAG)) continue; // org already handled it
      }
      const attrs = contact.custom_attributes || {};
      // Routing: an explicit org:<slug> tag wins (staff override for
      // conversations whose author has missing/wrong Organization data —
      // those attributes are synced from the Rec app, not editable in
      // Intercom). Otherwise route by the author's contact attributes.
      // Unmatched conversations are skipped but stay eligible for later.
      const candidates = Object.keys(ORGS).map(slug => [slug, supportSettings(slug)])
        .filter(([slug, c]) => c.enabled && c.notify.length && !c.readOnly);
      const match =
        candidates.find(([slug]) => intercomLive.hasOrgRouteTag(conv, slug, ORGS[slug])) ||
        candidates.find(([slug, c]) => attrs.Organization === c.intercomOrg && attrs.user_role === 'user');
      if (!match) continue;
      const [orgSlug, matchSettings] = match;
      const org = { ...ORGS[orgSlug], supportNotify: matchSettings.notify };
      const { _first, ...entry } = intercomLive.toInboxEntry(conv);
      await sendEscalationEmail(orgSlug, org, entry);
      markNotified(conv.id);
      if (isPing) {
        try { await intercomLive.clearNotifyTag(conv.id); }
        catch (e) { console.error('[notify] failed to clear Org Notify tag:', e.message); }
        // the tag change should reflect in the org inbox promptly
        for (const key of cache.keys()) if (key.startsWith(`${orgSlug}:support-`)) cache.delete(key);
      }
      track_server(orgSlug, 'support_escalation_notified', { conversationId: String(conv.id), recipients: org.supportNotify.length });
      console.log(`[notify] ${orgSlug}: escalation email sent for conversation ${conv.id} → ${org.supportNotify.join(', ')}`);
    }
  } catch (e) {
    console.error('[notify] escalation poll failed:', e.message);
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
  if (intercomLive.liveEnabled()) {
    console.log('[notify] escalation notifier active — polling Intercom every 3 minutes');
    setTimeout(pollEscalations, 15000);
    setInterval(pollEscalations, 3 * 60 * 1000);
    // Provision routing tags so they're ready in the Intercom tag picker
    setTimeout(async () => {
      try {
        const tags = await intercomLive.ensureOrgTags(ORGS);
        console.log(`[intercom] ensured ${tags.length} routing tag(s): ${tags.join(' | ')}`);
      } catch (e) { console.error('[intercom] tag provisioning failed:', e.message); }
      // Resolve (and log) the acting teammate at boot so attribution
      // issues show up in logs before anyone performs an action
      try { await intercomLive.getActingAdminId(); } catch (e) { console.error('[intercom] admin lookup failed:', e.message); }
    }, 10000);
    // Pre-warm the support sweeps so the first visitor doesn't eat the
    // cold classification pass: rolling 30d (inbox default) + current month
    // (the date picker's default). Contact classifications persist to the
    // volume, so even a cold sweep after this is mostly search pages.
    setTimeout(async () => {
      const rolling = { start: new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10) };
      const month = getMonthRangeServer();
      for (const slug of Object.keys(ORGS)) {
        if (!supportSettings(slug).enabled) continue;
        const org = effectiveSupportOrg(slug);
        for (const q of [rolling, month]) {
          try {
            const rows = await intercomLive.liveSupportRows(org, q, slug);
            console.log(`[WARM] ${slug}/support ${q.start}..${q.end || 'now'}: ${rows?.length ?? 0} rows`);
          } catch (e) { console.error(`[WARM] ${slug}/support failed:`, e.message); }
        }
      }
    }, 25000);
  }
});
