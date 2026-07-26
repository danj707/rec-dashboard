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

// ── Contact classification cache (author id → contact or null) ──
const contactCache = new Map();
const CONTACT_TTL = 60 * 60 * 1000; // contacts change org/role rarely

async function getContact(id) {
  const hit = contactCache.get(id);
  if (hit && Date.now() - hit.at < CONTACT_TTL) return hit.contact;
  let contact = null;
  try { contact = await ic(`/contacts/${id}`); } catch (e) { /* deleted/merged contacts 404 */ }
  contactCache.set(id, { contact, at: Date.now() });
  return contact;
}

function isOrgResident(contact, intercomOrg) {
  const attrs = contact?.custom_attributes || {};
  return attrs.Organization === intercomOrg && attrs.user_role === 'user';
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

  const out = [];
  for (const c of all) {
    const author = c.source?.author;
    if (author?.type !== 'user' || !author.id) continue;
    const contact = await getContact(author.id);
    if (contact && isOrgResident(contact, org.intercomOrg)) out.push(c);
  }
  return out;
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
async function liveSupportRows(org, query) {
  if (!liveEnabled() || !org?.intercomOrg) return null;
  const convs = await searchOrgConversations(org, query);
  return convs.map(toSupportRow);
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
        if (hasOrgRouteTag(conv, orgSlug, org) && !seen.has(String(conv.id))) convs.push(conv);
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
  const contact = author?.id ? await getContact(author.id) : null;
  const explicitlyRouted = orgSlug && hasOrgRouteTag(c, orgSlug, org);
  if (!explicitlyRouted && (!contact || !isOrgResident(contact, org.intercomOrg))) return null; // never leak another org's thread
  const entry = toInboxEntry(c);
  const messages = [{ role: 'resident', name: entry.contact.name, at: c.created_at, text: entry._first }];
  for (const p of c.conversation_parts?.conversation_parts || []) {
    if (!p.body) continue;
    // 'note' is deliberately excluded: internal Rec staff notes are private
    if (!['comment', 'assignment', 'open'].includes(p.part_type)) continue;
    const text = stripHtml(p.body);
    if (!text || text === '[Conversation Rating Request]') continue;
    messages.push({ role: partRole(p), name: p.author?.name || '', at: p.created_at, text });
  }
  const { _first, ...rest } = entry;
  return { ...rest, messages };
}

// ── Escalate-to-org write-back ──
// After a forward, tag the conversation and drop an internal note so Rec
// staff see the escalation inside Intercom. Best-effort: failures are the
// caller's to log, never to surface to the org admin.

// Intercom attributes every API action (notes, closes, tags) to a real
// teammate — names can't be invented. Selection order:
//   1. INTERCOM_ADMIN_ID env (pin an exact teammate)
//   2. a teammate whose name looks like a dashboard service account
//      (e.g. "Org Dashboard", "Rec Dashboard", "Dashboard Bot")
//   3. first workspace admin (fallback — shows up as that person)
// Create a lite-seat teammate named "Org Dashboard" and it's picked up
// automatically on the next restart, no config needed.
let _adminId = null;
async function getActingAdminId() {
  if (process.env.INTERCOM_ADMIN_ID) return process.env.INTERCOM_ADMIN_ID;
  if (_adminId) return _adminId;
  const res = await ic('/admins');
  const admins = res.admins || [];
  const service = admins.find(a => /(org|rec)?\s*dashboard/i.test(a.name || ''));
  _adminId = (service || admins[0])?.id;
  if (service) console.log(`[intercom] acting as service teammate "${service.name}" (${service.id})`);
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
  const ids = (res.data || []).filter(t => isRoutingTagName(t.name)).map(t => t.id);
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
  for (const c of page.conversations || []) {
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
  const names = [ORG_ESCALATED_TAG, ORG_RESOLVED_TAG];
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

module.exports = { liveEnabled, liveSupportRows, liveSupportInbox, liveSupportThread, markEscalatedToOrg, markOrgStatus, liveEscalatedConversations, toInboxEntry, hasOrgRouteTag, hasTagNamed, ensureOrgTags, ORG_ESCALATED_TAG, ORG_RESOLVED_TAG };
