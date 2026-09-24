'use strict';
// Per-org usage for the admin page: how often each org opens its dashboard,
// what it clicks through to, and which features it touches. PURE — no fs, no
// Express — so scripts/admin-usage.spec.js can run it over fixtures.
//
// Three rules the numbers rest on:
//   1. OUR OWN VISITS DO NOT COUNT. "Open Dashboard" on the admin page opens
//      the org's dashboard with the org's own token, which is indistinguishable
//      from the org using it — so that link carries via=admin, the page stamps
//      it on every event it sends, and those events are counted apart
//      (adminEvents) rather than as adoption.
//   2. SERVER-SIDE BOOKKEEPING IS NOT USAGE. An org deleted, or a digest the
//      scheduler sent, is not somebody at a desk.
//   3. A SHORT LOG IS NOT A QUIET ORG. `coverageDays` says how far back the log
//      actually reaches, so the page can say "since Sep 3" instead of drawing a
//      confident zero over days nobody recorded.

const DAY = 86400000;
const NON_USAGE = new Set(['org_deleted', 'digest_sent']);

// The features worth an adoption row, in the order the table shows them.
const FEATURES = [
  ['report_link_clicked', 'Clicked through to a report'],
  ['rec_link_clicked',    'Clicked through to Rec'],
  ['insight_requested',   'Rec Insights'],
  ['briefing_generated',  'AI Briefing'],
  ['pdf_exported',        'PDF export'],
  ['dashboard_shared',    'Share link'],
  ['email_subscribed',    'Email digest sign-up'],
  ['edit_opened',         'Opened the editor'],
  ['layout_saved',        'Saved a layout'],
  ['compare_changed',     'Compare mode'],
  ['date_preset_changed', 'Changed the date range'],
];

function utcDay(ms) { return Math.floor(ms / DAY); }

function buildUsage(events, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const days = opts.days || 30;
  const today = utcDay(now);
  const first = today - days + 1;          // first day of the current window
  const priorFirst = first - days;         // first day of the equal prior window
  const orgSlugs = opts.orgs || [];

  const blank = () => ({
    daily: new Array(days).fill(0),        // dashboard views per day, oldest first
    views: 0, viewsPrior: 0,
    activeDays: new Set(),
    lastSeen: null,
    clicks: 0, clickTargets: {},
    features: {},
    adminEvents: 0,
  });
  const byOrg = {};
  orgSlugs.forEach(s => { byOrg[s] = blank(); });

  let oldest = null, adminEvents = 0, unknownOrgEvents = 0;
  const platformDaily = new Array(days).fill(0);

  for (const e of events) {
    if (!e || !e.org || !e.event || !e.ts) continue;
    const ms = Date.parse(e.ts);
    if (!Number.isFinite(ms)) continue;
    if (oldest == null || ms < oldest) oldest = ms;
    if (NON_USAGE.has(e.event)) continue;
    // An org no longer configured (deleted, renamed) is not an org on this
    // page; counting it would read "4 / 3 active".
    if (orgSlugs.length && !byOrg[e.org]) { unknownOrgEvents++; continue; }
    const o = byOrg[e.org] || (byOrg[e.org] = blank());
    if (e.via === 'admin') { o.adminEvents++; adminEvents++; continue; }

    const d = utcDay(ms);
    if (o.lastSeen == null || ms > o.lastSeen) o.lastSeen = ms;
    if (d >= priorFirst && d < first && e.event === 'dashboard_view') o.viewsPrior++;
    if (d < first || d > today) continue;

    o.activeDays.add(d);
    o.features[e.event] = (o.features[e.event] || 0) + 1;
    if (e.event === 'dashboard_view') {
      o.views++; o.daily[d - first]++; platformDaily[d - first]++;
    }
    if (e.event === 'report_link_clicked' || e.event === 'rec_link_clicked') {
      o.clicks++;
      const t = e.target || '(unknown)';
      o.clickTargets[t] = (o.clickTargets[t] || 0) + 1;
    }
  }

  const orgs = {};
  let active7 = 0, active30 = 0, views = 0, clicks = 0;
  for (const [slug, o] of Object.entries(byOrg)) {
    const recent7 = [...o.activeDays].some(d => d > today - 7);
    if (recent7) active7++;
    if (o.activeDays.size) active30++;
    views += o.views; clicks += o.clicks;
    orgs[slug] = {
      daily: o.daily,
      views: o.views,
      viewsPrior: o.viewsPrior,
      activeDays: o.activeDays.size,
      lastSeen: o.lastSeen != null ? new Date(o.lastSeen).toISOString() : null,
      clicks: o.clicks,
      topTargets: Object.entries(o.clickTargets).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        .slice(0, 3).map(([target, count]) => ({ target, count })),
      features: o.features,
      adminEvents: o.adminEvents,
    };
  }

  const adoption = FEATURES.map(([event, label]) => {
    let orgCount = 0, count = 0;
    for (const o of Object.values(orgs)) {
      const n = o.features[event] || 0;
      if (n) { orgCount++; count += n; }
    }
    return { event, label, orgs: orgCount, count };
  });

  // How many of the window's days the log can actually see. A log that starts
  // mid-window must not read as an org that did nothing before it began.
  const coverageDays = oldest == null ? 0 : Math.min(days, today - utcDay(oldest) + 1);

  return {
    days, windowStart: new Date(first * DAY).toISOString().slice(0, 10),
    coverageDays, logStartsAt: oldest != null ? new Date(oldest).toISOString() : null,
    platform: { daily: platformDaily, views, clicks, active7, active30, orgCount: Object.keys(orgs).length, adminEvents, unknownOrgEvents },
    adoption, orgs,
  };
}

module.exports = { buildUsage, FEATURES, NON_USAGE };
