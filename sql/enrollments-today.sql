-- ✅ Enrollments Live — Today
--
-- WHY A SECOND CARD EXISTS. Dan: "if building super lightweight reports to fuel
-- these live widgets is a better fit, consider that. since each is only pulling
-- a single day's worth of data for a specific org, maybe that's smarter?"
--
-- It is, and the measurement is lopsided enough to be worth writing down.
-- Card 21286 over its seven-day window, cache-independent through the public
-- endpoint on 2026-09-05:
--
--     apex     741 rows   8.3s   345KB        one day:  5 rows  1.9s   2KB
--     smyrna   748 rows   6.8s   332KB        one day:  1 row   0.9s   0KB
--     menifee  674 rows   4.6s   289KB        one day:  2 rows  0.8s   1KB
--
-- The widget polls every 60 SECONDS. So the live list — whose entire claim is
-- "right now" — was paying for a week of history on every tick, to render one
-- day of it.
--
-- THE OTHER SIX DAYS ARE NOT WASTED, which is why this is a split and not a
-- narrowing: the Programs Live leaderboard ranks sections over seven days and
-- its trend arrow compares three complete days against the three before them.
-- But every one of those figures is an AGGREGATE — signups, charged, paid, a
-- per-day tally. Not one of them reads a name, an email, a participant, a card
-- detail or a plan column. So the history moved to its own rollup card
-- (enrollments-rollup.sql) at (day x section) grain, and this card carries the
-- full row detail for one day only.
--
-- THERE ARE NO DATE PARAMETERS, and that is deliberate three times over:
--
--   1. IT IS THE AUTHORITY ON "TODAY". The page used to derive today from the
--      newest row's own stamp, which is wrong before the first signup of the
--      morning (fixed once already — see liveTodayFor) and still leaves a gap
--      when the viewer is west of the org. Here the day is decided by Postgres
--      in the ORG's timezone and every row returned is today by construction,
--      so there is nothing left to derive.
--   2. IT COSTS THE CHECK-INS TRICK NOTHING. The check-ins widget asks for TWO
--      days purely so it can work out what the org's today is — apex, measured:
--      1,314 rows / 9.8s / 319KB for two days against 164 rows / 0.7s for one.
--      A dateless card buys that back outright.
--   3. NO TAG FLIP, EVER. The whole push->flip dance in these repos exists
--      because an API push regenerates DATE tags as Text and the card 400s
--      until a human re-types them. `org_id` is a text parameter and survives
--      a push unchanged, so a live card with no date tags can be corrected at
--      any hour without taking a widget down.
--
-- `Org Today` rides on every row so the card can be LABELLED by the day it
-- actually covers rather than by the viewer's clock. On a day with no signups
-- there are no rows to carry it and the page falls back to the viewer's
-- calendar day for the label alone — which is what it does today, and the
-- figure it labels is zero either way.
--
-- Every other column, its name and its meaning are lifted from card 21286 so
-- the two feeds are interchangeable and the page needs no second mapper. See
-- enrollments-live.sql for why each one is what it is; the notes are not
-- repeated here.
--
-- Params: org_id (uuid). Mirrored here; THE LIVE CARD IS THE SOURCE OF TRUTH.
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
         ((NOW() AT TIME ZONE tz)::date)::timestamp        AT TIME ZONE tz AS t0,
         (((NOW() AT TIME ZONE tz)::date + 1)::timestamp)  AT TIME ZONE tz AS t1
  FROM cfg
),
-- TODAY, IN THE ORG'S OWN TIMEZONE, resolved once and reused. `bk` is the same
-- shape as card 21286's so everything downstream is line-for-line the same
-- query with a smaller input.
bk AS (
  SELECT b.id, b.created_at, b.customer_user_id, b.participant_user_id,
         b.session_id, b.section_id, b.status, cfg.org_id, cfg.tz
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
         SUM(COALESCE(t.succeeded_cents,0))                                      AS paid_cents,
         BOOL_OR(oi.payment_plan IS NOT NULL OR COALESCE(pl.n,0) > 0)            AS on_plan,
         SUM(COALESCE(pl.n,0))                                                   AS plan_installments,
         SUM(COALESCE(pl.paid_n,0))                                              AS plan_installments_paid
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
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE ppi.paid_at IS NOT NULL) AS paid_n
    FROM payment_plan_installment ppi
    WHERE ppi.order_item_id = oi.id
  ) pl ON TRUE
  GROUP BY oi.booking_id
)
SELECT
  TO_CHAR(b.created_at AT TIME ZONE b.tz,   'YYYY-MM-DD"T"HH24:MI:SS')            AS "Signed Up At",
  -- THE DAY THIS CARD COVERS, as a STRING. A bare ::date comes back through
  -- Metabase carrying the report timezone's offset ("2026-09-05T00:00:00-07:00"),
  -- and a day key that has to be parsed is a day key that can be parsed wrong —
  -- the bug this file's siblings have been bitten by five times over.
  TO_CHAR((NOW() AT TIME ZONE b.tz)::date, 'YYYY-MM-DD')                          AS "Org Today",
  CONCAT(u.first_name, ' ', u.last_name)                                          AS "Customer Name",
  b.customer_user_id::text                                                        AS "User ID",
  u.email                                                                         AS "Email",
  NULLIF(TRIM(CONCAT(pu.first_name, ' ', pu.last_name)), '')                      AS "Participant",
  s.name                                                                          AS "Section",
  s.id::text                                                                      AS "Section Id",
  s.section_code                                                                  AS "Section Code",
  p.name                                                                          AS "Program",
  (SELECT STRING_AGG(DISTINCT a.name, ', ' ORDER BY a.name)
     FROM program_activity pa JOIN activity a ON a.id = pa.activity_id
    WHERE pa.program_id = p.id)                                                   AS "Activity",
  ROUND(COALESCE(m.price_cents,0) / 100.0, 2)                                     AS "Price",
  ROUND(COALESCE(m.paid_cents,0)  / 100.0, 2)                                     AS "Paid",
  COALESCE(m.on_plan, FALSE)                                                      AS "On Plan",
  COALESCE(m.plan_installments, 0)                                                AS "Plan Installments",
  COALESCE(m.plan_installments_paid, 0)                                           AS "Plan Installments Paid",
  b.status                                                                        AS "Status"
FROM bk AS b
JOIN users u    ON u.id = b.customer_user_id
LEFT JOIN users pu ON pu.id = b.participant_user_id AND pu.id <> b.customer_user_id
LEFT JOIN session se ON se.id = b.session_id AND se.deleted_at IS NULL
JOIN section s  ON s.id = COALESCE(b.section_id, se.section_id) AND s.deleted_at IS NULL
JOIN program p  ON p.id = s.program_id
LEFT JOIN money m ON m.booking_id = b.id
WHERE s.is_rec_managed IS FALSE
ORDER BY b.created_at DESC, b.id DESC
