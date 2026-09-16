-- 📣 Org Dashboard — CRM & Messaging  (card 21913)
--
-- Dan: "This might need a whole new 'CRM/Messaging' section on the dashboard.
-- Could track total messages sent, SMS's, etc." and "there's a whole bunch of
-- stuff here, segments, message counts, etc. email delivery rates (which are a
-- bit sus)."
--
-- GRAIN: one row per MESSAGE (a send) — the same grain Rec's own
-- /marketing/messages list uses (Subject, Type, Recipient Count, Sender, Send
-- Time), which is the page this section's header links to. Every delivery
-- figure is aggregated onto that row, so nothing downstream has to fan a
-- message out and every count on the dashboard stays additive.
--
-- TAGS: org_id + optional start_date / end_date. ALL THREE COME BACK `text` ON
-- CREATION — read back off the live card rather than assumed, because the
-- sibling repo's note on card 20197 says Metabase auto-types a tag named
-- start_date as Date from its name, and THAT DID NOT HAPPEN HERE. The
-- dashboard sends date/single for every dated card and Metabase refuses that
-- against a Text tag, so both dates must be flipped to Date in the UI. The
-- flip is free exactly once: a card with no public link has no consumers, so
-- there is no outage window — which is the argument for doing it now rather
-- than discovering it on the next edit.
--
-- ── THE DELIVERY RATE IS REC'S OWN FORMULA, delivered / sent ─────────────────
-- Matched against the Rec admin UI rather than chosen. West Haven's "Last
-- Chance to register for Zumba: Start Monday" (2026-09-11) reads
-- "Sent 1,664 · Delivered 98.4%" on its own message page, and 1,637 delivered
-- of 1,664 sent is 98.38%. Dividing by the rows that reached a TERMINAL state
-- instead gives 99.3% — defensible, and 0.9pp adrift of the page an admin
-- reaches by clicking this very section's header. Two surfaces disagreeing
-- about one send is worse than either formula being imperfect. So the card
-- ships the raw counts and the page divides Rec's way.
--
-- ── AND WHY THE RATE LOOKED "A BIT SUS" ─────────────────────────────────────
-- Email delivery webhooks were not wired until 2026-02. Measured platform-wide
-- by month, delivered as a share of sent:
--
--     2025-03 .. 2025-12    0.0%   (15,158 deliveries, delivered_at NEVER set)
--     2026-01               0.2%
--     2026-02              20.3%
--     2026-03              91.5%   (and a real 13.2% bounce spike)
--     2026-04 onward       96-98%
--
-- So a LIFETIME rate reads 91.6% and is a statement about the webhook rather
-- than about deliverability. That is why this card ships the three outcome
-- counts SEPARATELY — delivered, bounced, and NO OUTCOME RECORDED — instead of
-- a rate: the page can then withhold the figure entirely when a window has no
-- outcomes at all. A confident 0% for a 2025 window would read as a
-- catastrophe that never happened; null says the feed cannot tell us.
-- Measured on West Haven's whole history: 93,906 delivered / 786 bounced /
-- 12,300 with no outcome recorded, of 106,785 sent.
--
-- ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────
-- * OPEN RATE. `first_opened_at` is NULL and `open_count` is 0 on ALL 818,239
--   deliveries, both channels, every org. There is no open tracking on this
--   platform, and a 0% open rate would be a confident number over nothing —
--   the `memberships.last_used_at` trap. Clicks ARE real but thin (1,280 of
--   800,412 email rows), so `Clicked` ships as a count and never as a rate.
-- * SEGMENT SIZE. `segment` stores criteria (filters / globalOperator /
--   notificationPreferences) and no size; Rec computes the Size column in its
--   own UI by evaluating them. Reproducing that means reimplementing the
--   criteria engine, so this card reports which segments were USED to send,
--   which is a fact it can actually establish.
--
-- Verified by running THIS WHOLE FINAL SELECT with literals inside a counting
-- wrapper — not a summary probe around the CTEs, which is exactly how card
-- 21682 shipped with an ORDER BY that had never executed:
--   west-haven, unwindowed: 394 messages, 106,785 recipients (5,304 SMS /
--     101,481 email), 128 marketing / 266 transactional, 93,906 delivered,
--     786 bounced, 12,300 no outcome, $264.33 SMS cost, 138 messages carrying
--     a segment, 13 senders, 2025-11-25..2026-09-16, 737ms. The 5,304 SMS is
--     the figure Dan's own gauge reads.
--   apex, 2026-06-01..2026-08-31: 524 messages, 159,009 recipients, 152,441
--     delivered, 1,875 bounced, 4,869 no outcome, 534ms — and the span comes
--     back exactly 06-01..08-31, so both [[ ]] bounds bind.
--
-- Mirrored at rec-dashboard sql/messaging.sql; THE LIVE CARD IS THE SOURCE OF
-- TRUTH.
WITH cfg AS (
  -- The org's own clock. `config.general.primaryTimezone` is populated on all
  -- 93 orgs that have ever sent a message, so this never falls back in
  -- practice — but Metabase renders every timestamp in America/Los_Angeles, so
  -- without the conversion an Eastern org's 1am send lands on the previous DAY
  -- and the daily trend is wrong at every midnight.
  SELECT COALESCE(NULLIF(o.config #>> '{general,primaryTimezone}', ''),
                  'America/Los_Angeles') AS tz
  FROM organization o
  WHERE o.id = {{org_id}}::uuid
),
win AS (
  -- Scoped and windowed FIRST, so everything below is computed only for
  -- messages that can survive. The bounds are converted to INSTANTS rather
  -- than the column being wrapped, which keeps message_organization_id_index
  -- usable and — the half that actually matters — makes the window mean the
  -- org's local day at both ends.
  SELECT m.id, m.subject, m.type, m.channel, m.sender_user_id, m."to",
         (m.created_at AT TIME ZONE c.tz) AS sent_local
  FROM message m
  CROSS JOIN cfg c
  WHERE m.organization_id = {{org_id}}::uuid
    AND m.deleted_at IS NULL
    [[ AND m.created_at >= ({{start_date}}::timestamp AT TIME ZONE c.tz) ]]
    [[ AND m.created_at <  (({{end_date}}::date + 1)::timestamp AT TIME ZONE c.tz) ]]
),
deliv AS (
  -- Driven FROM the windowed message set INTO
  -- message_delivery_message_id_index, so the 818k-row delivery table is never
  -- scanned to answer for one org's sends.
  SELECT md.message_id,
         COUNT(*)                                                  AS recipients,
         COUNT(*) FILTER (WHERE md.delivered_at  IS NOT NULL)      AS delivered,
         COUNT(*) FILTER (WHERE md.bounced_at    IS NOT NULL)      AS bounced,
         COUNT(*) FILTER (WHERE md.delivered_at IS NULL
                            AND md.bounced_at   IS NULL)           AS no_outcome,
         COUNT(*) FILTER (WHERE md.complained_at IS NOT NULL)      AS complaints,
         COUNT(*) FILTER (WHERE md.click_count > 0)                AS clicked,
         COALESCE(SUM(md.cost_cents), 0)                           AS cost_cents,
         COALESCE(SUM(md.segments), 0)                             AS sms_segments
  FROM message_delivery md
  JOIN win ON win.id = md.message_id
  WHERE md.deleted_at IS NULL
  GROUP BY md.message_id
),
seg AS (
  -- A marketing send resolves its segments to user ids at send time, so the
  -- only record of WHICH segment was used is `message.to -> segmentIds`
  -- (present on 481 messages platform-wide). Names travel as a JSON ARRAY, not
  -- a joined string: segments are named by humans and "Spring Pickleball
  -- Intermediate League Captains" is one comma away from being read as two
  -- segments the day somebody uses one.
  SELECT w.id, JSONB_AGG(s.name ORDER BY s.name) AS names
  FROM win w
  CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS_TEXT(
    CASE WHEN JSONB_TYPEOF(w."to" -> 'segmentIds') = 'array'
         THEN w."to" -> 'segmentIds' ELSE '[]'::jsonb END) sid
  JOIN segment s ON s.id = sid::uuid
  WHERE sid ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  GROUP BY w.id
)
SELECT
  w.id::text                                   AS "Message ID",
  w.sent_local::date                           AS "Sent Date",
  TO_CHAR(w.sent_local, 'HH12:MIam')           AS "Sent Time",
  w.subject                                    AS "Subject",
  INITCAP(w.type)                              AS "Type",
  UPPER(w.channel)                             AS "Channel",
  -- Named from `users` rather than left as a uuid: the Rec messages list shows
  -- a Sender column, and a dashboard that cannot name the person who sent a
  -- campaign is a worse version of the page it links to.
  NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '')
                                               AS "Sender",
  -- LEFT JOIN, not INNER: 3 messages platform-wide have no delivery row at all
  -- (a segment that resolved to nobody). Dropping them would make the send
  -- count disagree with Rec's own list.
  COALESCE(d.recipients, 0)                    AS "Recipients",
  COALESCE(d.delivered, 0)                     AS "Delivered",
  COALESCE(d.bounced, 0)                       AS "Bounced",
  COALESCE(d.no_outcome, 0)                    AS "No Outcome",
  COALESCE(d.complaints, 0)                    AS "Complaints",
  COALESCE(d.clicked, 0)                       AS "Clicked",
  COALESCE(d.cost_cents, 0)                    AS "Cost Cents",
  COALESCE(d.sms_segments, 0)                  AS "SMS Segments",
  COALESCE(sg.names, '[]'::jsonb)              AS "Segments"
FROM win w
LEFT JOIN deliv d  ON d.message_id = w.id
LEFT JOIN seg   sg ON sg.id        = w.id
LEFT JOIN users u  ON u.id         = w.sender_user_id
ORDER BY w.sent_local DESC, w.id
