// ═══════════════════════════════════════════════════════════════════════
//  INTERCOM LIVE CLIENT
//
//  Live counterpart to the snapshots in support-data.js /
//  support-inbox-data.js. Activates when INTERCOM_ACCESS_TOKEN is set;
//  otherwise every export returns null and the server falls back to the
//  snapshots. Serves the exact same row/inbox/thread shapes the widgets
//  and inbox UI already consume.
//
//  Scoping: an org sees only conversations whose author is one of ITS
//  residents — contacts whose Intercom custom attributes match
//  { Organization: org.intercomOrg, user_role: 'user' }. Staff
//  (external-admin) conversations are excluded. Contacts are looked up
//  once per author and cached.
// ═══════════════════════════════════════════════════════════════════════

const INTERCOM_TOKEN = process.env.INTERCOM_ACCESS_TOKEN || '';
const INTERCOM_BASE = 'https://api.intercom.io';

function liveEnabled() { return !!INTERCOM_TOKEN; }

async function ic(path, opts = {}) {
  const resp = await fetch(`${INTERCOM_BASE}${path}`, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${INTERCOM_TOKEN}`,
      'Intercom-Version': '2.11',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!resp.ok) throw new Error(`Intercom ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  return resp.json();
}

// ── Contact classification cache (author id → { org, role }) ──
// The sweep only needs two attributes per author, and they change rarely —
// 24h TTL, persisted to the DATA_DIR volume so deploys/restarts don't force
// the workspace-wide relookup that made cold loads take a minute+.
const fs = require('fs');
const path = require('path');
const DATA_DIR = process.env.DATA_DIR || './data';
const CONTACT_META_FILE = path.join(DATA_DIR, 'intercom-contact-meta.json');
const CONTACT_TTL = 24 * 60 * 60 * 1000;
const contactMeta = new Map();
try {
  for (const [id, m] of Object.entries(JSON.parse(fs.readFileSync(CONTACT_META_FILE, 'utf8')))) contactMeta.set(id, m);
  console.log(`[intercom] loaded ${contactMeta.size} cached contact classification(s)`);
} catch (e) { /* first boot */ }

let _metaSaveTimer = null;
function saveContactMeta() {
  if (_metaSaveTimer) return;
  _metaSaveTimer = setTimeout(() => {
    _metaSaveTimer = null;
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(CONTACT_META_FILE, JSON.stringify(Object.fromEntries(contactMeta)));
    } catch (e) { console.error('[intercom] contact meta persist failed:', e.message); }
  }, 2000);
}

async function getContactMeta(id) {
  const hit = contactMeta.get(id);
  if (hit && Date.now() - hit.at < CONTACT_TTL) return hit;
  let meta = { org: null, role: null, at: Date.now() };
  try {
    const c = await ic(`/contacts/${id}`);
    const a = c?.custom_attributes || {};
    meta = { org: a.Organization || null, role: a.user_role || null, at: Date.now() };
  } catch (e) { /* deleted/merged contacts 404 — cache the miss too */ }
  contactMeta.set(id, meta);
  saveContactMeta();
  return meta;
}

function isOrgResidentMeta(meta, intercomOrg) {
  return !!meta && meta.org === intercomOrg && meta.role === 'user';
}

// Bounded-concurrency map: Intercom allows ~1000 req/min, so 10 parallel
// contact lookups is safe and turns a minute of sequential round trips
// into a few seconds.
async function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ── Conversation search across the window, filtered to org residents ──
// One sweep serves both the metrics rows and the inbox: concurrent callers
// share the same in-flight promise, and results are held for 5 minutes so
// the tab's two fetches don't each crawl the whole workspace.
const sweepCache = new Map();
const SWEEP_TTL = 5 * 60 * 1000;

function searchOrgConversations(org, query) {
  const key = `${org.intercomOrg}:${query.start}:${query.end}`;
  const hit = sweepCache.get(key);
  if (hit && Date.now() - hit.at < SWEEP_TTL) return hit.promise;
  const promise = doSearchOrgConversations(org, query).catch(e => { sweepCache.delete(key); throw e; });
  sweepCache.set(key, { promise, at: Date.now() });
  return promise;
}

async function doSearchOrgConversations(org, { start, end }) {
  const startTs = Math.floor(new Date(`${start}T00:00:00Z`).getTime() / 1000);
  const endTs = end ? Math.floor(new Date(`${end}T23:59:59Z`).getTime() / 1000) : null;
  const value = [{ field: 'created_at', operator: '>', value: startTs }];
  if (endTs) value.push({ field: 'created_at', operator: '<', value: endTs });

  const all = [];
  let startingAfter = null;
  do {
    const body = {
      query: { operator: 'AND', value },
      pagination: { per_page: 150, ...(startingAfter ? { starting_after: startingAfter } : {}) },
    };
    const page = await ic('/conversations/search', { method: 'POST', body: JSON.stringify(body) });
    all.push(...(page.conversations || []));
    startingAfter = page.pages?.next?.starting_after || null;
  } while (startingAfter);

  // Classify unique authors with bounded parallelism (mostly cache hits
  // after the first sweep thanks to the persisted contact meta).
  const authorIds = [...new Set(all.map(c => c.source?.author).filter(a => a?.type === 'user' && a.id).map(a => a.id))];
  await mapConcurrent(authorIds, 10, getContactMeta);
  return all.filter(c => {
    const a = c.source?.author;
    if (a?.type !== 'user' || !a.id) return false;
    return isOrgResidentMeta(contactMeta.get(a.id), org.intercomOrg);
  });
}

// ── Shape mappers (must match the snapshot shapes exactly) ──
const RESOLUTION_LABEL = {
  assumed_resolution: 'Resolved by AI',
  confirmed_resolution: 'Resolved by AI',
  escalated: 'Escalated to Staff',
};

// ai_agent.resolution_state is not reliably present on conversation-search
// payloads (it is on GET /conversations/:id). The "Fin AI Agent resolution
// state" custom attribute carries the same signal — fall back to it so
// escalations are not silently mislabeled as staff-handled.
const ATTR_RESOLUTION = {
  'Assumed Resolution': 'assumed_resolution',
  'Confirmed Resolution': 'confirmed_resolution',
  'Escalated': 'escalated',
};
function resolutionOf(c) {
  return (c.ai_agent || {}).resolution_state
    || ATTR_RESOLUTION[(c.custom_attributes || {})['Fin AI Agent resolution state']]
    || null;
}

const TOPIC_RULES = [
  [/refund|cancel|booking cancelled|purchased in error/i, 'Refunds & Cancellations'],
  [/sign in|log ?in|password|changing email|email associated/i, 'Account & Login'],
  [/residency|badge/i, 'Residency Verification'],
  [/payout|direct deposit|next pay/i, 'Instructor Payout'],
  [/payment|missing payment/i, 'Payments & Billing'],
  [/registration|register|sign up|add a camper|lesson booking|ticket purchase|class no show|level change/i, 'Registration & Enrollment'],
];

function stripHtml(s) {
  if (!s) return '';
  return s
    .replace(/<img[^>]*>/g, '[image]')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<\/(p|div|li|ul|blockquote|h\d)>/g, '\n')
    .replace(/<li[^>]*>/g, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function topicOf(c) {
  const ca = c.custom_attributes || {};
  const blob = `${stripHtml(ca['AI Title'] || c.title || c.source?.subject || '')} ${ca['Issue Type or Tag'] || ''}`;
  for (const [re, label] of TOPIC_RULES) if (re.test(blob)) return label;
  if (ca['Issue Type or Tag'] === 'Refunds') return 'Refunds & Cancellations';
  return 'Other';
}

function toSupportRow(c) {
  const ca = c.custom_attributes || {}, ai = c.ai_agent || {}, s = c.statistics || {};
  const res = resolutionOf(c);
  const srcs = ai.content_sources?.content_sources || [];
  return {
    'Date': new Date(c.created_at * 1000).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }),
    'Channel': c.source?.type === 'conversation' ? 'Chat' : 'Email',
    'Topic': topicOf(c),
    'Issue Type': ca['Issue Type or Tag'] || '',
    'Priority': ca['Priority'] || '',
    'Fin Involved': c.ai_agent_participated ? 1 : 0,
    'Resolution State': RESOLUTION_LABEL[res] || 'Handled by Staff',
    'Escalated': res === 'escalated' ? 1 : 0,
    'State': c.state,
    'Time to Close Minutes': s.time_to_first_close != null ? Math.round(s.time_to_first_close / 6) / 10 : null,
    'Replies': s.count_conversation_parts || 0,
    'Help Articles': srcs.map(x => x.title),
  };
}

// The escalate-to-org loop lives on Intercom tags: forwarding from the
// dashboard applies this tag (visible to Rec staff in Intercom), and the
// dashboard reads it back so the escalated state survives refreshes.
const ORG_ESCALATED_TAG = 'Org Escalated';

// Applied when org staff mark an escalated conversation done from their
// dashboard — closes the loop back to Rec CS inside Intercom.
const ORG_RESOLVED_TAG = 'Org Resolved';

// Applied by Rec staff in Intercom to (re-)send the escalation email to the
// org — the poller sends and then removes the tag, so it's repeatable.
const ORG_NOTIFY_TAG = 'Org Notify';
function hasTagNamed(c, name) { return (c.tags?.tags || []).some(t => t.name === name); }

// Explicit routing override: a conversation tagged for a specific org
// belongs to that org's dashboard regardless of the author's contact
// attributes (those are synced from the Rec app and aren't editable in
// Intercom — this tag is how Rec staff route a conversation whose author
// has missing or wrong Organization data).
//
// Accepted tag formats, matched against the org's slug, name, or city:
//   "Org Escalated: Niagara Falls"   (human-friendly, preferred)
//   "org:niagarafalls"               (machine-y shorthand)
function _norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function isOrgRouteTag(tagName, slug, org) {
  const t = String(tagName || '').trim();
  if (t.toLowerCase() === `org:${slug}`.toLowerCase()) return true;
  const m = t.match(/^org escalated:\s*(.+)$/i);
  if (!m) return false;
  const v = _norm(m[1]);
  if (!v) return false;
  if (v === _norm(slug) || v === _norm(org?.city)) return true;
  const name = _norm(org?.name);
  return !!name && (v === name || name.endsWith(v)); // "Niagara Falls" matches "City of Niagara Falls"
}
function hasOrgRouteTag(c, slug, org) { return (c.tags?.tags || []).some(t => isOrgRouteTag(t.name, slug, org)); }

function toInboxEntry(c) {
  const ca = c.custom_attributes || {}, a = c.source?.author || {};
  const first = stripHtml(c.source?.body || '').split(/\nOn .{5,80} wrote:\n/)[0].trim();
  const res = resolutionOf(c);
  const tagNames = (c.tags?.tags || []).map(t => t.name);
  return {
    orgEscalated: tagNames.some(isRoutingTagName),
    orgResolved: tagNames.includes(ORG_RESOLVED_TAG),
    id: String(c.id),
    subject: stripHtml(c.source?.subject || '') || ca['AI Title'] || '(no subject)',
    contact: { name: a.name || 'Resident', email: a.email || '' },
    channel: c.source?.type === 'conversation' ? 'Chat' : 'Email',
    state: c.state,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    topic: topicOf(c),
    resolution: RESOLUTION_LABEL[res] || 'Handled by Staff',
    finInvolved: !!c.ai_agent_participated,
    preview: first.length > 110 ? first.slice(0, 110) + '…' : first,
    _first: first,
  };
}

function partRole(p) {
  if (p.author?.type === 'user') return 'resident';
  if (p.part_type === 'note') return 'note';
  if (p.author?.type === 'bot') return 'ai';
  return 'agent';
}

// ── Public API (each returns null when live mode is off) ──

// Same shape as getSupportRows() in support-data.js
// Conversations explicitly routed to this org via its routing tag, within
// the query window. Merged into both metrics and inbox so the tab agrees
// with itself — an escalated conversation from a non-resident author (e.g.
// wrong contact attributes) still counts.
async function taggedOrgConversations(org, orgSlug, { start, end }, excludeIds) {
  if (!orgSlug) return [];
  const startTs = Math.floor(new Date(`${start}T00:00:00Z`).getTime() / 1000);
  const endTs = end ? Math.floor(new Date(`${end}T23:59:59Z`).getTime() / 1000) : null;
  try {
    const tagged = await liveEscalatedConversations();
    return (tagged || [])
      .map(t => t.conv)
      .filter(c => hasOrgRouteTag(c, orgSlug, org))
      .filter(c => c.created_at > startTs && (!endTs || c.created_at < endTs))
      .filter(c => !excludeIds.has(String(c.id)));
  } catch (e) {
    return []; // best-effort merge
  }
}

async function liveSupportRows(org, query, orgSlug) {
  if (!liveEnabled() || !org?.intercomOrg) return null;
  const convs = [...await searchOrgConversations(org, query)];
  const extra = await taggedOrgConversations(org, orgSlug, query, new Set(convs.map(c => String(c.id))));
  return [...convs, ...extra].map(toSupportRow);
}

// Same shape as getSupportInbox() in support-inbox-data.js
async function liveSupportInbox(org, query, orgSlug) {
  if (!liveEnabled() || !org?.intercomOrg) return null;
  const convs = await searchOrgConversations(org, query);
  // Merge in escalated conversations explicitly routed here via org:<slug> —
  // their authors aren't org residents, so the sweep alone misses them.
  if (orgSlug) {
    try {
      const seen = new Set(convs.map(c => String(c.id)));
      const tagged = await liveEscalatedConversations();
      for (const { conv } of tagged || []) {
        if (hasOrgRouteTag(conv, orgSlug, org) && !seen.has(String(conv.id))) {
          convs.push(conv);
          seen.add(String(conv.id)); // guard against duplicate rows from the tag search
        }
      }
    } catch (e) { /* override merge is best-effort */ }
  }
  return convs
    .sort((x, y) => y.created_at - x.created_at)
    .map(c => { const { _first, ...e } = toInboxEntry(c); return { ...e, messageCount: (c.statistics?.count_conversation_parts || 0) + 1 }; });
}

// Same shape as getSupportThread() in support-inbox-data.js
async function liveSupportThread(org, id, orgSlug) {
  if (!liveEnabled() || !org?.intercomOrg) return null;
  const c = await ic(`/conversations/${id}`);
  const author = c.source?.author;
  const meta = author?.id ? await getContactMeta(author.id) : null;
  const explicitlyRouted = orgSlug && hasOrgRouteTag(c, orgSlug, org);
  if (!explicitlyRouted && !isOrgResidentMeta(meta, org.intercomOrg)) return null; // never leak another org's thread
  const entry = toInboxEntry(c);
  const messages = [{ role: 'resident', name: entry.contact.name, at: c.created_at, text: entry._first }];
  for (const p of c.conversation_parts?.conversation_parts || []) {
    if (!p.body) continue;
    if (!['comment', 'assignment', 'open', 'note'].includes(p.part_type)) continue;
    const text = stripHtml(p.body);
    if (!text || text === '[Conversation Rating Request]') continue;
    // Rec-internal notes are private. The only notes shown back are the
    // dashboard-originated ones (org's own notes + escalation audit trail).
    let display = text;
    if (p.part_type === 'note') {
      if (ORG_ADDRESSED_NOTE.test(text)) display = '💬 ' + text.replace(ORG_ADDRESSED_NOTE, '');
      else if (!ORG_VISIBLE_NOTE.test(text)) continue;
    }
    messages.push({ role: partRole(p), name: p.author?.name || '', at: p.created_at, text: display });
  }
  const { _first, ...rest } = entry;
  return { ...rest, messages };
}

// ── Escalate-to-org write-back ──
// After a forward, tag the conversation and drop an internal note so Rec
// staff see the escalation inside Intercom. Best-effort: failures are the
// caller's to log, never to surface to the org admin.

// Intercom attributes every API action (notes, closes, tags) to a real
// teammate — names can't be invented, and teammates must be tied to real
// accounts. Selection order:
//   1. INTERCOM_ADMIN_ID env (pin an exact teammate)
//   2. the shared support identity: teammate with email support@rec.us
//      or named "Rec Support" — actions read "Rec Support closed the
//      conversation", with the org named in the note body
//   3. a dashboard-ish service teammate, then first admin (fallbacks)
let _adminId = null;
async function getActingAdminId() {
  if (process.env.INTERCOM_ADMIN_ID) return process.env.INTERCOM_ADMIN_ID;
  if (_adminId) return _adminId;
  const res = await ic('/admins');
  const admins = res.admins || [];
  // One-time roster dump so the right acting identity can be picked from logs
  console.log(`[intercom] workspace teammates: ${admins.map(a => `${a.name} <${a.email}> (${a.id})`).join(' | ')}`);
  const service =
    admins.find(a => (a.email || '').toLowerCase() === 'support@rec.us') ||
    admins.find(a => /^rec support$/i.test((a.name || '').trim())) ||
    admins.find(a => /(org|rec)?\s*dashboard/i.test(a.name || ''));
  _adminId = (service || admins[0])?.id;
  console.log(`[intercom] acting as teammate "${(service || admins[0])?.name}" (${_adminId})${service ? '' : ' — no support@rec.us/Rec Support teammate found, using first admin'}`);
  return _adminId;
}

let _escalatedTagId = null;
async function getEscalatedTagId() {
  if (_escalatedTagId) return _escalatedTagId;
  // POST /tags with just a name creates-or-returns the tag
  const tag = await ic('/tags', { method: 'POST', body: JSON.stringify({ name: ORG_ESCALATED_TAG }) });
  _escalatedTagId = tag.id;
  return _escalatedTagId;
}

// Org staff set a status from their dashboard — mirror it into Intercom so
// Rec CS sees the outcome where they work. Close-type statuses tag the
// conversation Org Resolved and close it; reopen sends it back to Rec.
const ORG_STATUS = {
  resolved: { emoji: '✅', label: 'RESOLVED', part: 'close', tagResolved: true,
    text: org => `Marked <b>resolved</b> by ${org} staff via their Rec dashboard — issue handled on the org side.` },
  no_action: { emoji: '⛔', label: 'NO ACTION NEEDED', part: 'close', tagResolved: true,
    text: org => `Closed by ${org} staff via their Rec dashboard — <b>no action needed</b>.` },
  reopen: { emoji: '🔄', label: 'BACK TO REC', part: 'open', tagResolved: false,
    text: org => `${org} staff sent this back to Rec Support via their dashboard — <b>needs Rec follow-up</b>.` },
};

let _resolvedTagId = null;
async function getResolvedTagId() {
  if (_resolvedTagId) return _resolvedTagId;
  const tag = await ic('/tags', { method: 'POST', body: JSON.stringify({ name: ORG_RESOLVED_TAG }) });
  _resolvedTagId = tag.id;
  return _resolvedTagId;
}

async function markOrgStatus(conversationId, status, { orgName, note }) {
  const def = ORG_STATUS[status];
  if (!def) throw new Error(`Unknown status: ${status}`);
  const adminId = await getActingAdminId();
  if (!adminId) throw new Error('No Intercom admin available');
  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (def.tagResolved) {
    const tagId = await getResolvedTagId();
    await ic(`/conversations/${conversationId}/tags`, { method: 'POST', body: JSON.stringify({ id: tagId, admin_id: adminId }) });
  }
  await ic(`/conversations/${conversationId}/reply`, {
    method: 'POST',
    body: JSON.stringify({
      message_type: 'note', type: 'admin', admin_id: adminId,
      body: `<p>${def.emoji} <b>${def.label}</b> — ${def.text(esc(orgName))}${note ? `</p><p>Note from org: "${esc(note)}"` : ''}</p>`,
    }),
  });
  // Mirror the conversation state (close/open). Best-effort: the note+tag
  // already carry the signal if state management is rejected.
  try {
    await ic(`/conversations/${conversationId}/parts`, {
      method: 'POST', body: JSON.stringify({ message_type: def.part, type: 'admin', admin_id: adminId }),
    });
  } catch (e) {
    console.error(`[intercom] state change (${def.part}) failed:`, e.message);
  }
  return { resolved: def.tagResolved, state: def.part === 'close' ? 'closed' : 'open' };
}

// Org staff write an internal note from their dashboard — visible to Rec CS
// in Intercom (never to the resident). This is the org→Rec channel: "please
// tell the resident X", "we approved this on our side", etc.
async function addOrgNote(conversationId, { orgName, text }) {
  const adminId = await getActingAdminId();
  if (!adminId) throw new Error('No Intercom admin available');
  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  await ic(`/conversations/${conversationId}/reply`, {
    method: 'POST',
    body: JSON.stringify({
      message_type: 'note', type: 'admin', admin_id: adminId,
      body: `<p>💬 <b>Note from ${esc(orgName)} staff</b> (via their Rec dashboard):</p><p>${esc(text)}</p>`,
    }),
  });
  return true;
}

// Dashboard-originated notes carry these markers; they're the only notes
// the org is allowed to see back (their own audit trail). Everything else
// stays Rec-internal.
const ORG_VISIBLE_NOTE = /^(💬|📤|✅|⛔|🔄)/;
// Rec staff can deliberately surface a note to the org by starting it with
// "@org" in Intercom — shown in the org's thread with the prefix stripped.
const ORG_ADDRESSED_NOTE = /^@org\b[:,]?\s*/i;

async function markEscalatedToOrg(conversationId, { orgName, to, note }) {
  if (!liveEnabled()) return false;
  const adminId = await getActingAdminId();
  if (!adminId) throw new Error('No Intercom admin available for tagging');
  const tagId = await getEscalatedTagId();
  await ic(`/conversations/${conversationId}/tags`, {
    method: 'POST', body: JSON.stringify({ id: tagId, admin_id: adminId }),
  });
  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  await ic(`/conversations/${conversationId}/reply`, {
    method: 'POST',
    body: JSON.stringify({
      message_type: 'note', type: 'admin', admin_id: adminId,
      body: `<p>📤 <b>Escalated to org staff</b> — forwarded to ${esc(to)} from the ${esc(orgName)} dashboard.${note ? `</p><p>Note from org: "${esc(note)}"` : ''}</p>`,
    }),
  });
  return true;
}

// ── Escalation notifier support ──
// Conversations carrying the Org Escalated tag (recently updated), each with
// its author contact so the caller can map conversation → org. Powers the
// poller that emails org admins when Rec staff tag a conversation in Intercom.
// Any escalation-flavored tag counts — the base "Org Escalated" OR a
// per-org routing tag ("Org Escalated: Niagara Falls", "org:<slug>").
// One tag is enough: a city tag alone both triggers and routes.
function isRoutingTagName(name) {
  return /^org escalated(:|$)/i.test(String(name || '').trim()) || /^org:/i.test(String(name || '').trim());
}

let _routingTagIds = { ids: null, at: 0 };
async function getRoutingTagIds() {
  if (_routingTagIds.ids && Date.now() - _routingTagIds.at < 10 * 60 * 1000) return _routingTagIds.ids;
  const res = await ic('/tags');
  const ids = (res.data || []).filter(t => isRoutingTagName(t.name) || t.name === ORG_NOTIFY_TAG).map(t => t.id);
  _routingTagIds = { ids, at: Date.now() };
  return ids;
}

async function liveEscalatedConversations() {
  if (!liveEnabled()) return null;
  const tagIds = await getRoutingTagIds();
  if (!tagIds.length) return [];
  // No time filter: tagging an old conversation doesn't reliably bump
  // updated_at, and the tag population is small (only this feature applies
  // it). The caller's notified-set prevents re-sends.
  const body = {
    query: { field: 'tag_ids', operator: 'IN', value: tagIds },
    pagination: { per_page: 50 },
  };
  const page = await ic('/conversations/search', { method: 'POST', body: JSON.stringify(body) });
  const out = [];
  const emitted = new Set(); // tag_ids IN [...] returns one row PER matching tag — dedupe
  for (const c of page.conversations || []) {
    if (emitted.has(String(c.id))) continue;
    emitted.add(String(c.id));
    const author = c.source?.author;
    if (author?.type !== 'user' || !author.id) continue;
    // Fetch fresh (no cache): escalation routing must see attribute edits
    // immediately — e.g. a contact's Organization corrected after tagging.
    let contact = null;
    try { contact = await ic(`/contacts/${author.id}`); } catch (e) { /* deleted/merged */ }
    if (contact) out.push({ conv: c, contact });
  }
  return out;
}

// ── Tag provisioning ──
// Create the routing tags in Intercom so they're waiting in the tag picker:
// the base "Org Escalated" plus "Org Escalated: <City>" for every configured
// org. POST /tags is create-or-return, so this is idempotent and safe to run
// on every boot; newly onboarded orgs get their tag automatically.
async function ensureOrgTags(orgs) {
  if (!liveEnabled()) return [];
  const names = [ORG_ESCALATED_TAG, ORG_RESOLVED_TAG, ORG_NOTIFY_TAG];
  for (const org of Object.values(orgs)) {
    const label = org.city || org.name;
    if (label) names.push(`${ORG_ESCALATED_TAG}: ${label}`);
  }
  const ensured = [];
  for (const name of names) {
    try {
      await ic('/tags', { method: 'POST', body: JSON.stringify({ name }) });
      ensured.push(name);
    } catch (e) {
      console.error(`[intercom] ensure tag "${name}" failed:`, e.message);
    }
  }
  return ensured;
}

// Remove the Org Notify tag after a ping is delivered so the tag acts as
// a repeatable button rather than a permanent state.
async function clearNotifyTag(conversationId) {
  const adminId = await getActingAdminId();
  const res = await ic('/tags');
  const tag = (res.data || []).find(t => t.name === ORG_NOTIFY_TAG);
  if (!tag || !adminId) return false;
  await ic(`/conversations/${conversationId}/tags/${tag.id}`, { method: 'DELETE', body: JSON.stringify({ admin_id: adminId }) });
  return true;
}

module.exports = { liveEnabled, liveSupportRows, liveSupportInbox, liveSupportThread, markEscalatedToOrg, markOrgStatus, addOrgNote, liveEscalatedConversations, toInboxEntry, hasOrgRouteTag, hasTagNamed, ensureOrgTags, getActingAdminId, clearNotifyTag, ORG_ESCALATED_TAG, ORG_RESOLVED_TAG, ORG_NOTIFY_TAG };
