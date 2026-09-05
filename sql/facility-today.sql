-- ✅ Facility Bookings Live — Today
--
-- THE FOURTH LIVE WIDGET, and it exists because the third one was measured
-- against the alternatives rather than picked. Dan: "the data just doesn't
-- 'move' often enough, and watching a program slowly increment is not very
-- fulfilling." He is right about programmes, and the numbers are blunter than
-- the complaint. Per org over 90 days, orgs with enough volume to rank:
--
--     stream                 orgs  median org's   hours over 20/hr
--                            with   BIGGEST hour   in 90 days
--                            any    all quarter    (median org)
--     program signups         93         44              4
--     facility reservations   96        185             14
--     membership scans        46         53             29
--
-- So the median org's best hour of programme registrations ALL QUARTER is 44
-- signups, and it clears 20/hr on four hours in ninety days. Facility is four
-- times as bursty, reaches more orgs than any other stream, and is the one
-- vertical with no live surface at all. Programmes keep their widget because
-- their CEILING is the highest on the platform — 2,500 signups in one hour
-- somewhere in those ninety days — but facility is what moves on a Tuesday.
--
-- THE GRAIN IS THE RENTAL, NOT THE RESERVATION ROW, and that is the single
-- most important decision here. A recurring rental writes one `reservation`
-- per date: 49,092 reservation rows over 14 days are 16,752 rentals, 2.93
-- rows each. Counting rows would make one staff member entering a season of
-- Friday nights look like forty people booking, which is exactly the kind of
-- lie a LIVE counter must not tell. 16,752 rentals over 14 days is 1,197 a
-- day platform-wide, 81% of them `instant` — a real person self-booking a
-- court, not a bulk import.
--
-- A BOOKING IS A RENTAL WITH AT LEAST ONE LIVE SLOT. Measured over 14 days,
-- platform-wide, by status:
--
--     status        type      rentals   with no live reservation
--     confirmed     instant    11,669      98   (0.8%)
--     in-progress   managed     2,179     267  (12.3%)
--     confirmed     managed     1,098     159  (14.5%)
--     canceled      instant     1,071   1,071   (100%)
--     canceled      managed        73      73   (100%)
--
-- Two things follow. **Cancelling a rental cancels its slots** — 1,144 of
-- 1,144, no exceptions — so a cancelled rental has nothing to show: no site,
-- no time, no hours. It is still worth COUNTING, exactly as a refused scan is
-- on the check-ins card, so it comes back with Status 'Canceled' and the page
-- puts it in a counter rather than in the list. And the 524 non-cancelled
-- rentals with no live slot are carts and re-entries — a staff member starting
-- a booking and redoing it (both halves are visible in apex's own day: one
-- "Ball Machine" at 09:20 with nothing on it, another at 09:25 with a court
-- and $10). Those are not bookings and are dropped here rather than rendered
-- as a row reading "(No Site)".
--
-- `in-progress` IS NOT AN UNPAID CART. It is managed-only and 1,912 of 2,179
-- carry live slots; at apex those rows have real courts, real times and money
-- already collected. It is where a staff rental sits mid-lifecycle, so it
-- stays, labelled.
--
-- THE SARGABLE DAY IS THE WHOLE PERFORMANCE STORY, same as its siblings. The
-- obvious form —
--
--     (f.created_at AT TIME ZONE cfg.tz)::date = (NOW() AT TIME ZONE cfg.tz)::date
--
-- — WRAPS THE COLUMN, so no index on created_at is reachable and Postgres
-- reads the org's whole rental history to discard almost all of it. Measured
-- on attendance_event when this pattern was first fixed, same rows out:
-- 221,313 rows read and 7,815ms becomes 409 rows and 4.5ms. Turning the org's
-- day into a timestamptz range leaves the column bare.
--
-- NO DATE PARAMETERS MEANS NO TAG FLIP, EVER — the property a live card most
-- wants, since it can then be corrected at any hour without taking the widget
-- down. `org_id` is a text tag and survives an API push unchanged.
--
-- Params: org_id (uuid). Mirrored here; THE LIVE CARD IS THE SOURCE OF TRUTH.
-- Live card: 21583 — https://rec.metabaseapp.com/question/21583
WITH org_tz AS (
  SELECT COALESCE(MODE() WITHIN GROUP (ORDER BY timezone), 'America/Chicago') AS tz
  FROM location
  WHERE organization_id = {{org_id}}::uuid
    AND timezone IS NOT NULL AND timezone <> ''),
/* THE DAY AS AN INSTANT RANGE, resolved once. MATERIALIZED so the bounds are
   computed once and land as InitPlan constants rather than being re-derived
   per row. See the header for the 7,815ms -> 4.5ms this buys. */
win AS MATERIALIZED (
  SELECT tz,
         ((NOW() AT TIME ZONE tz)::date)::timestamp        AT TIME ZONE tz AS t0,
         (((NOW() AT TIME ZONE tz)::date + 1)::timestamp)  AT TIME ZONE tz AS t1
  FROM org_tz
),
-- TODAY'S RENTALS, resolved before any of the per-rental joins below, so the
-- site, schedule and money lookups run over a day of rentals rather than the
-- org's entire booking history.
fr AS (
  SELECT f.id, f.created_at, f.name, f.customer_user_id, f.attendee_count,
         f.status, f.canceled_at, f.booking_type, otz.tz
  FROM facility_rental f
  CROSS JOIN org_tz otz
  WHERE f.organization_id = {{org_id}}::uuid
    AND f.deleted_at IS NULL
    AND f.created_at >= (SELECT t0 FROM win)
    AND f.created_at <  (SELECT t1 FROM win)
),
-- THE SLOTS THAT STAND. A reservation cancelled on its own leaves the rental
-- alive (one night dropped from a recurring stay), so this is per-slot and not
-- per-rental — and it is what "at least one live slot" is counted from.
res AS (
  SELECT r.id, r.facility_rental_id AS rental_id, r.starts_at, r.ends_at
  FROM reservation r
  JOIN fr ON fr.id = r.facility_rental_id
  WHERE r.deleted_at IS NULL AND r.canceled_at IS NULL
),
/* THE SITE, FROM BOTH PATHS. `reservation.court_id` is NULL on entire orgs —
   all 557,367 of San Francisco's reservations — where the link is the
   `reservation_court` join table instead. Reading one side silently loses
   every booking made the other way, so this UNIONs them. */
site AS (
  SELECT rental_id, court_id FROM (
    SELECT res.rental_id, rc.court_id
      FROM res JOIN reservation_court rc
        ON rc.reservation_id = res.id AND rc.deleted_at IS NULL
    UNION
    SELECT res.rental_id, res.court_id FROM res WHERE res.court_id IS NOT NULL
  ) u
),
-- A rental CAN span more than one court, so the name is a primary with a count
-- beside it rather than a confident single answer. Ordered by name so two runs
-- of the same query cannot disagree about which one is primary.
site_agg AS (
  SELECT s.rental_id,
         MIN(c.court_number)        AS primary_site,
         COUNT(DISTINCT s.court_id) AS site_count,
         MIN(l.name)                AS location_name
  FROM site s
  JOIN court c ON c.id = s.court_id
  LEFT JOIN location l ON l.id = c.location_id
  GROUP BY s.rental_id
),
when_agg AS (
  SELECT rental_id,
         COUNT(*) AS slot_count,
         COUNT(DISTINCT (starts_at AT TIME ZONE (SELECT tz FROM org_tz))::date) AS date_count,
         MIN(starts_at) AS first_start,
         MAX(ends_at)   AS last_end,
         SUM(EXTRACT(EPOCH FROM (ends_at - starts_at))) / 3600.0 AS hours
  FROM res GROUP BY rental_id
),
-- Money is the reservation's own order items, the same basis card 19570 uses:
-- `finalCents` off applied_pricing rather than `order_item.price`, which is
-- the rate card and leaves a comped-to-$0 booking carrying a price it never
-- charged. Paid is confirmed, succeeded, non-credit transactions.
money AS (
  SELECT res.rental_id,
         SUM(COALESCE(NULLIF(oi.applied_pricing->'result'->>'finalCents','')::numeric, 0)) AS charged_cents,
         SUM(COALESCE(t.succeeded_cents, 0)) AS paid_cents
  FROM res
  JOIN order_item oi ON oi.reservation_id = res.id AND oi.deleted_at IS NULL
  LEFT JOIN LATERAL (
    SELECT SUM(CASE WHEN pmt.status = 'succeeded' THEN oit.amount ELSE 0 END) AS succeeded_cents
    FROM order_item_transaction oit
    LEFT JOIN payment pmt ON pmt.id = oit.payment_id
    WHERE oit.order_item_id = oi.id AND oit.deleted_at IS NULL
      AND oit.confirmed_at IS NOT NULL AND oit.credit_id IS NULL
  ) t ON TRUE
  GROUP BY res.rental_id
)
SELECT
  -- A bare local wall-clock string, already converted to the ORG's timezone, so
  -- the page READS it rather than parsing it through new Date() and re-applying
  -- the viewer's zone — which would slide an evening booking onto the wrong day.
  TO_CHAR(f.created_at AT TIME ZONE f.tz, 'YYYY-MM-DD"T"HH24:MI:SS')   AS "Booked At",
  -- The day this card covers, as a STRING. A bare ::date comes back through
  -- Metabase carrying the report timezone's offset, and a day key that has to
  -- be parsed is a day key that can be parsed wrong.
  TO_CHAR((NOW() AT TIME ZONE f.tz)::date, 'YYYY-MM-DD')                AS "Org Today",
  -- NULL, never '', when a staff booking carries no customer account — 926 of
  -- 2,179 in-progress rentals have none, and the page falls back to the
  -- rental's own name, which is where the person's name actually is.
  NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '')             AS "Customer Name",
  f.customer_user_id::text                                             AS "User ID",
  NULLIF(u.image, '')                                                  AS "Photo",
  f.id::text                                                           AS "Rental Id",
  f.name                                                               AS "Rental",
  sa.primary_site                                                      AS "Site",
  COALESCE(sa.site_count, 0)                                           AS "Site Count",
  sa.location_name                                                     AS "Location",
  CASE WHEN f.booking_type = 'instant' THEN 'Instant' ELSE 'Staff' END AS "Booking Type",
  CASE WHEN f.canceled_at IS NOT NULL THEN 'Canceled'
       ELSE INITCAP(f.status) END                                      AS "Status",
  COALESCE(w.date_count, 0)                                            AS "Dates",
  ROUND(COALESCE(w.hours, 0)::numeric, 2)                              AS "Hours",
  TO_CHAR(w.first_start AT TIME ZONE f.tz, 'YYYY-MM-DD"T"HH24:MI:SS')  AS "First Slot",
  TO_CHAR(w.last_end    AT TIME ZONE f.tz, 'YYYY-MM-DD"T"HH24:MI:SS')  AS "Last Slot",
  f.attendee_count                                                     AS "Attendees",
  ROUND(COALESCE(m.charged_cents, 0) / 100.0, 2)                       AS "Price",
  ROUND(COALESCE(m.paid_cents, 0)    / 100.0, 2)                       AS "Paid"
FROM fr AS f
LEFT JOIN users u     ON u.id = f.customer_user_id
LEFT JOIN site_agg sa ON sa.rental_id = f.id
LEFT JOIN when_agg w  ON w.rental_id  = f.id
LEFT JOIN money m     ON m.rental_id  = f.id
-- A BOOKING, OR A CANCELLATION — and nothing else. See the header: a rental
-- with no live slot and no cancellation is a cart or a re-entry, and would
-- render as a row with no site, no time and no money.
WHERE w.rental_id IS NOT NULL OR f.canceled_at IS NOT NULL
ORDER BY f.created_at DESC, f.id DESC
