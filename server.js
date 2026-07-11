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
    orgId: '7d22bf62',
    token: '7qNNXDFo4HGpOh5B',
    logoUrl: 'https://rec.us/assets/images/organizations/watertown.png',
    reports: {
      facility: '4b64af10',
      gl: 'e0043550',
      programs: 'd3a3554f'
    }
  }
};

// Reports available to ALL orgs via shared Metabase cards
const SHARED_UUIDS = {
  gl: '4374b344',
  fasttrack: '9d38ab95',
  'program-demographics': '67b77142'
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
  const uuid = org.reports?.[reportType] || SHARED_UUIDS[reportType];
  if (!uuid) return null;

  const params = buildMetabaseParams(reportType, query);
  const cacheKey = `${orgSlug}:${reportType}:${JSON.stringify(params)}`;
  
  // Check org-specific cache TTL
  const orgConfig = dashboardConfigs[orgSlug];
  const ttl = (orgConfig?.cacheTTL || 15) * 60 * 1000;
  
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const paramStr = params.length ? `?parameters=${encodeURIComponent(JSON.stringify(params))}` : '';
  const url = `${METABASE_URL}/api/public/card/${uuid}/query/json${paramStr}`;

  console.log(`[FETCH] ${orgSlug}/${reportType} → ${uuid}`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Metabase ${resp.status}: ${resp.statusText}`);
  
  const rows = await resp.json();
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
  const { template, widgets, cacheTTL, datePreset } = req.body;
  dashboardConfigs[req.orgSlug] = {
    template: template || 'general',
    widgets: widgets || [],
    cacheTTL: cacheTTL || 15,
    datePreset: datePreset || 'thisMonth',
    updatedAt: new Date().toISOString()
  };
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
//  START
// ═══════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`rec.us Dashboard running on port ${PORT}`);
  console.log(`Orgs: ${Object.keys(ORGS).join(', ')}`);
});
