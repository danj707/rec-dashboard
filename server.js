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
    logoUrl: 'https://prod-rec-tech-img-bucket-8656aa2.s3.us-west-1.amazonaws.com/organization-d781690b-c5a0-43c5-8443-9ae43899528c/fullLogo.png',
    reports: {
      facility: '4b64af10-d57f-41af-aad8-b16d12a8f7b8',
      programs: 'd3a3554f-1232-4803-9cc7-5b0f611360b0'
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
  retention: '3cfc9cfa-b1db-41e9-83fd-01fb90a5b0c8'
};

// Reports that don't accept date parameters
const NO_DATE_REPORTS = new Set([
  'program-demographics', 'memberships', 'users', 'retention'
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
//  ROUTES
// ═══════════════════════════════════════════

// Static files
app.use('/public', express.static(path.join(__dirname, 'public')));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', orgs: Object.keys(ORGS).length }));

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
  res.json({ config, availableReports, orgName: org.name, logoUrl: org.logoUrl });
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
//  START
// ═══════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`rec.us Dashboard running on port ${PORT}`);
  console.log(`Orgs: ${Object.keys(ORGS).join(', ')}`);
});
