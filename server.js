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
  'program-checkins': 'cb6fd909-72d3-446b-930b-c0382da02d62'
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
    if (start) params.push({ type: 'date/single', target: ['variable', ['template-tag', 'start_date']], value: start });
    if (end) params.push({ type: 'date/single', target: ['variable', ['template-tag', 'end_date']], value: end });
  }
  return params;
}

async function fetchMetabaseData(orgSlug, reportType, query) {
  const org = ORGS[orgSlug];
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

app.get('/admin/api/events/summary', adminAuth, (req, res) => {
  try {
    if (!fs.existsSync(EVENTS_FILE)) return res.json({ total: 0, byOrg: {}, byType: {} });
    const lines = fs.readFileSync(EVENTS_FILE, 'utf8').trim().split('\n').filter(Boolean);
    const events = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const byOrg = {}, byType = {};
    events.forEach(e => {
      byOrg[e.org] = (byOrg[e.org] || 0) + 1;
      byType[e.event] = (byType[e.event] || 0) + 1;
    });
    const last7 = {};
    const now = Date.now();
    events.forEach(e => {
      const day = e.ts?.split('T')[0];
      if (day && (now - new Date(e.ts).getTime()) < 7 * 86400000) last7[day] = (last7[day] || 0) + 1;
    });
    res.json({ total: events.length, byOrg, byType, last7Days: last7 });
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

// ── POST /admin/api/orgs — add new org via admin panel ───────────────
app.post('/admin/api/orgs', adminAuth, (req, res) => {
  const { slug, name, orgId, city, state, logoUrl } = req.body;
  if (!slug || !orgId) return res.status(400).json({ error: 'slug and orgId are required' });
  if (ORGS[slug]) return res.status(409).json({ error: `Org "${slug}" already exists` });
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return res.status(400).json({ error: 'Slug must be lowercase alphanumeric with hyphens' });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId)) return res.status(400).json({ error: 'Invalid org UUID format' });

  // Generate 16-char base62 token
  const crypto = require('crypto');
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 16; i++) token += chars[crypto.randomInt(chars.length)];

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
  console.log(`[orgs] Added new org: ${slug} (${orgId})`);

  // Sync to rental-report so report links work with the same token
  if (REPORTING_BASE_URL) {
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

  res.json({ ok: true, slug, token, org: { ...org, _dynamic: undefined } });
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
    const visResp = await fetch(`${REPORTING_BASE_URL}/api/org-visibility/${req.orgSlug}`);
    if (visResp.ok) reportVisibility = await visResp.json();
  } catch (e) {
    console.error(`[config] Failed to fetch report visibility for ${req.orgSlug}:`, e.message);
  }

  res.json({ config, availableReports, orgName: org.name, logoUrl: org.logoUrl, city: org.city, state: org.state,
    toggles: config?.toggles || { ai: true, reportLinks: false, aiBriefing: false, emailDigest: false },
    reportingBaseUrl: REPORTING_BASE_URL,
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
  'executive-briefing': 'You are writing an executive briefing for a parks and recreation director. Synthesize ALL the data below into exactly 3 concise sentences. Sentence 1: the headline number and whether things are trending up or down. Sentence 2: the most notable positive signal. Sentence 3: the single biggest risk or thing that needs attention. Be specific with numbers. No bullets, no headers, no emoji — just 3 clean sentences a director can read in 10 seconds.',
};

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
