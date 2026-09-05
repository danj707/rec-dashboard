-- ✅ Enrollments Live — Daily Rollup
--
-- THE HISTORY HALF OF THE SPLIT. See enrollments-today.sql for the measurement
-- that motivated it; in one line: the live list polls every 60 seconds and was
-- paying 8.3s and 345KB for a week of full row detail to render one day of it.
--
-- The Programs Live leaderboard genuinely needs that week — it ranks sections
-- by money received over seven days and its trend arrow compares three
-- complete days against the three before them. But every figure it needs is an
-- AGGREGATE. Read out of liveBySection rather than assumed: signups, today's
-- signups, charged, paid, the newest stamp, and a per-day tally. Not one name,
-- email, participant, card detail or plan column is ever read for that panel.
--
-- So this card carries (day x section) and nothing else. Measured over seven
-- days on 2026-09-05: smyrna 748 booking rows collapse to 332, apex 741 to
-- 440, menifee 674 to 136 — and each surviving row drops twelve wide columns
-- for eight narrow ones.
--
-- IT COVERS COMPLETE DAYS ONLY, NEVER TODAY, and that is the load-bearing
-- decision rather than an optimisation:
--
--   * Today's numbers on the leaderboard come from the SAME feed as the live
--     list beside it, so the two panels cannot disagree about today. Two
--     surfaces reporting different figures for one window is the trap this
--     repo and its sibling keep writing down.
--   * A set of complete days is IMMUTABLE within the day, so this can be
--     cached for half an hour instead of sixty seconds. That is where the load
--     actually goes: the expensive half stops being asked once a minute.
--
-- `{{days}}` is how many complete days to return, ending yesterday. The page
-- asks for six, which with today makes the seven the leaderboard advertises
-- and the six the trend needs (three against three). It is a NUMBER parameter,
-- not a date one — see enrollments-today.sql on why this card family carries
-- no date tags and therefore never needs a flip after a push.
--
-- A day with no signups has no row, which is correct: the page tallies by day
-- key and a missing key reads as zero. Emitting an empty row per day would
-- make an org that ran no registrations look like one this card could not
-- answer for.
--
-- Params: org_id (uuid), days (number). Mirrored here; THE LIVE CARD IS THE
-- SOURCE OF TRUTH.
WITH cfg AS (
  SELECT o.id AS org_id,
         COALESCE(
            (SELECT l.timezone
               FROM location l
              WHERE l.organization_id = o.id
                AND l.deleted_at IS NULL
                AND l.timezone <> 'UTC'
              GROUP BY l.timezone
              ORDER BY COUNT(*) DESC
              LIMIT 1),
            'America/New_York'
         ) AS tz
  FROM organization o
  WHERE o.id = {{org_id}}::uuid
),
-- COMPLETE DAYS ONLY: from `days` back, up to and including YESTERDAY in the
-- org's own timezone. Today is deliberately outside this window.
bk AS (
  SELECT b.id, b.created_at, b.session_id, b.section_id, cfg.org_id, cfg.tz,
         (b.created_at AT TIME ZONE cfg.tz)::date AS day
  FROM cfg
  JOIN booking b ON b.organization_id = cfg.org_id AND b.deleted_at IS NULL
  WHERE b.type = 'section'
    AND b.status = 'confirmed'
    AND (b.created_at AT TIME ZONE cfg.tz)::date
          >= (NOW() AT TIME ZONE cfg.tz)::date - ({{days}}::int)
    AND (b.created_at AT TIME ZONE cfg.tz)::date
          <  (NOW() AT TIME ZONE cfg.tz)::date
),
money AS (
  SELECT oi.booking_id,
         SUM(COALESCE((oi.applied_pricing->'result'->>'finalCents')::numeric,0)) AS price_cents,
         SUM(COALESCE(t.succeeded_cents,0))                                      AS paid_cents
  FROM bk
  JOIN order_item oi ON oi.booking_id = bk.id AND oi.organization_id = bk.org_id
       AND oi.deleted_at IS NULL AND oi.parent_order_item_id IS NULL
  LEFT JOIN LATERAL (
    SELECT SUM(CASE WHEN pmt.status = 'succeeded' THEN oit.amount ELSE 0 END) AS succeeded_cents
    FROM order_item_transaction oit
    LEFT JOIN payment pmt ON pmt.id = oit.payment_id
    WHERE oit.order_item_id = oi.id AND oit.deleted_at IS NULL
      AND oit.confirmed_at IS NOT NULL AND oit.credit_id IS NULL
  ) t ON TRUE
  GROUP BY oi.booking_id
)
SELECT
  -- A STRING, not a date. Metabase renders a bare ::date with the report
  -- timezone's offset, and the page keys its per-day tally on 'YYYY-MM-DD'.
  TO_CHAR(b.day, 'YYYY-MM-DD')                                                    AS "Day",
  s.id::text                                                                      AS "Section Id",
  s.name                                                                          AS "Section",
  p.name                                                                          AS "Program",
  COUNT(*)                                                                        AS "Signups",
  ROUND(SUM(COALESCE(m.price_cents,0)) / 100.0, 2)                                AS "Charged",
  ROUND(SUM(COALESCE(m.paid_cents,0))  / 100.0, 2)                                AS "Paid",
  -- The newest signup in this (day, section), so the leaderboard can order and
  -- label by recency without any row detail. Same format as the detail card's
  -- "Signed Up At", because the page compares the two as strings.
  TO_CHAR(MAX(b.created_at) AT TIME ZONE b.tz, 'YYYY-MM-DD"T"HH24:MI:SS')         AS "Last At"
FROM bk AS b
LEFT JOIN session se ON se.id = b.session_id AND se.deleted_at IS NULL
JOIN section s  ON s.id = COALESCE(b.section_id, se.section_id) AND s.deleted_at IS NULL
JOIN program p  ON p.id = s.program_id
LEFT JOIN money m ON m.booking_id = b.id
WHERE s.is_rec_managed IS FALSE
GROUP BY b.day, s.id, s.name, p.name, b.tz
ORDER BY b.day DESC, 5 DESC
