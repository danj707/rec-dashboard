// rec.us Dashboard Server
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3200;
const DATA_DIR = process.env.DATA_DIR || './data';
const METABASE_URL = process.env.METABASE_URL || 'https://rec.metabaseapp.com';

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
  }
};

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
  checkins: '574324e0-b5a1-46c5-8770-8c466631fdcf'
};

// Reports that don't accept date parameters
const NO_DATE_REPORTS = new Set([
  'program-demographics', 'memberships', 'users', 'retention', 'checkins'
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
  { date: '2025-07-12', title: 'Widget Expansion: 70+ Widgets Across 10 Sections', items: [
    'New sections: Courts, Fast Track, Users, Memberships, Products, Instructor Payout, Demographics',
    'Table view widgets added to each section (program revenue, GL codes, bookings, instructors, memberships)',
    'Widget limits: max 8 per section, max 20 per dashboard',
    'Admin auth: HTTP Basic auth on admin routes'
  ]},
  { date: '2025-07-12', title: 'Light/Dark Theme + Reset', items: [
    'Added dark/light theme toggle in settings, persists per-org',
    'Fixed dashboard reset (inline confirm, no iframe-blocked confirm())',
    'Event tracking for theme changes'
  ]},
  { date: '2025-07-12', title: 'Event Tracking + Analytics', items: [
    'Full event tracking pipeline: dashboard_view, template_selected, edit_opened, layout_saved, date_preset_changed, refresh, cache_cleared, dashboard_reset',
    'Batched client-side events (2s debounce), server-side JSONL storage',
    'GET /:org/api/events/stats endpoint for analytics'
  ]},
  { date: '2025-07-12', title: 'Sectioned Dashboard Architecture', items: [
    'Replaced flat widget grid with section-based layout (Revenue Overview, Facility Rentals, Programs & Enrollment)',
    'GL widgets: Total Revenue, Refunds, Net Revenue, Transactions, Revenue by GL Code, Payment Methods',
    'Programs widgets: Enrollments, Revenue, Refunds, Fill Rate, Top Programs, Revenue by Program',
    'Facility widgets renamed with rental- prefix for clarity',
    'Edit modal redesigned for section-level + widget-level editing',
    'Templates updated to section-based config'
  ]},
  { date: '2025-07-11', title: 'Initial Launch', items: [
    'Standalone Railway project with persistent volume',
    'Widget registry with 12 facility-based widgets',
    'Template chooser (General, Revenue Focus, Operations)',
    'Edit Widgets modal with add/remove/reorder',
    'Metabase data proxy with configurable cache TTL',
    'Token-based auth, Watertown as pilot org'
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
      toggles: config?.toggles || { ai: true, reportLinks: false },
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
app.get('/:org/api/config', authMiddleware, (req, res) => {
  const config = dashboardConfigs[req.orgSlug] || null;
  // Also send available report types for this org
  const availableReports = {};
  const org = ORGS[req.orgSlug];
  for (const [r, uuid] of Object.entries(org.reports || {})) availableReports[r] = true;
  for (const [r, uuid] of Object.entries(SHARED_UUIDS)) availableReports[r] = true;
  res.json({ config, availableReports, orgName: org.name, logoUrl: org.logoUrl, city: org.city, state: org.state,
    toggles: config?.toggles || { ai: true, reportLinks: false } });
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
};

app.post('/:org/api/insights/:sectionId', authMiddleware, async (req, res) => {
  if (!ANTHROPIC_API_KEY) return res.status(503).json({ error: 'AI insights not configured (missing ANTHROPIC_API_KEY)' });
  const { sectionId } = req.params;
  const { summary, dateRange } = req.body;

  const sectionPrompt = INSIGHT_PROMPTS[sectionId] || 'Analyze these metrics and provide actionable insights.';
  const prompt = `You are a sharp, data-driven parks and recreation analytics advisor helping ${req.org.name}. Date range: ${dateRange || 'current month'}.

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
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 600,
        messages: [{ role: 'user', content: prompt }] })
    });
    const data = await resp.json();
    const insight = data.content?.[0]?.text || 'No insights generated.';
    track_server(req.orgSlug, 'insight_generated', { section: sectionId });
    res.json({ insight });
  } catch (e) {
    console.error('[AI] Insight error:', e.message);
    res.status(500).json({ error: 'Failed to generate insights' });
  }
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
