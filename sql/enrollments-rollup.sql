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
-- THE WINDOW IS SIX COMPLETE DAYS, HARDCODED, and that is a correction rather
-- than a shortcut. It was a `{{days}}` template tag first, so the page's own
-- constants could govern it — and Metabase registered that tag as
-- **date/single** whatever the SQL cast said. Probed through the public
-- endpoint against every type the app could send:
--
--     days as category     -> 500   days as number/= -> 400
--     days as date/single  -> 500   days as string/= -> 400
--
-- There is no value this card could have been given. Six is what the page needs
-- (LIVE_DAYS 7 minus today, which is also the six the trend arrow's three
-- against three consumes), so it lives here instead — and the spec pins the
-- page's constant AGAINST this literal, because two numbers for one window is
-- how a trend arrow quietly starts comparing three days against two.
--
-- Losing the parameter also leaves this card with `org_id` alone, which is the
-- shape the rest of the family has: no date tag, so no flip after a push, ever.
--
-- A day with no signups has no row, which is correct: the page tallies by day
-- key and a missing key reads as zero. Emitting an empty row per day would
-- make an org that ran no registrations look like one this card could not
-- answer for.
--
-- Params: org_id (uuid) ONLY. Mirrored here; THE LIVE CARD IS THE SOURCE OF
-- TRUTH.
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
  WHERE o.id = {{org_id}}::uuid),
/* THE DAY AS AN INSTANT RANGE, resolved once.

   THIS IS THE WHOLE PERFORMANCE STORY, and it is not the row count. The first
   version of this card wrote the obvious thing —

       (b.created_at AT TIME ZONE cfg.tz)::date = (NOW() AT TIME ZONE cfg.tz)::date

   — which WRAPS THE COLUMN, so no index on created_at can be used and Postgres
   reads the org's entire history to throw almost all of it away. Measured on
   attendance_event at apex, EXPLAIN (ANALYZE, BUFFERS), same 399 rows out:

       wrapped column   221,313 rows read, 220,914 discarded, 19,148 blocks,
                        7,258ms of I/O, 7,815ms total
       instant range          409 rows read,       7 discarded,    190 blocks,
                            3.9ms of I/O,     4.5ms total

   Turning the org's day into a timestamptz range leaves the column bare, and
   the planner picks up an index that already existed and was simply
   unreachable. Same lesson the sibling repo records for the Tyler export:
   never wrap the column being filtered.

   MATERIALIZED so the bounds are computed once and land as InitPlan constants
   rather than being re-derived per row — verified in the plan. */
win AS MATERIALIZED (
  SELECT org_id, tz,
         (((NOW() AT TIME ZONE tz)::date - 6)::timestamp)  AT TIME ZONE tz AS t0,
         ((NOW() AT TIME ZONE tz)::date)::timestamp        AT TIME ZONE tz AS t1
  FROM cfg
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
    AND b.created_at >= (SELECT t0 FROM win)
    AND b.created_at <  (SELECT t1 FROM win)
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
