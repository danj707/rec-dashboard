-- ✅ Membership Check-Ins — Today
--
-- THE SAME SPLIT AS THE ENROLLMENTS CARDS, and this is the shape where it pays
-- most. Card 21517 is asked for TWO days, and the second one is not displayed:
-- it exists only so the page can work out what "today" is in the org's own
-- timezone, by reading the newest row's stamp. Measured cache-independently
-- through the public endpoint on 2026-09-05:
--
--     apex     two days  1,314 rows  9.8s  319KB      one day  164 rows  0.7s
--     smyrna   two days    104 rows  0.5s   28KB      one day   31 rows  0.4s
--
-- So apex paid fourteen times over, every sixty seconds, to answer a question
-- Postgres can answer directly: `(NOW() AT TIME ZONE tz)::date`. This card asks
-- it that way instead, and every row it returns is today by construction —
-- which also closes the residual timezone gap recorded against liveTodayFor,
-- where a viewer west of the org could see the wrong day labelled as today.
--
-- NO DATE PARAMETERS MEANS NO TAG FLIP, EVER. The push->flip dance in these
-- repos exists because an API push regenerates DATE tags as Text and the card
-- 400s until a human re-types them. `org_id` is a text parameter and survives
-- a push unchanged, so this card can be corrected at any hour without taking
-- the widget down — which is the property a LIVE widget most wants.
--
-- Everything else is card 21517 unchanged, column for column, so the two feeds
-- are interchangeable and the page needs no second mapper. See
-- checkins-live.sql for why each column is what it is.
--
-- Params: org_id (uuid). Mirrored here; THE LIVE CARD IS THE SOURCE OF TRUTH.
WITH org_tz AS (
  SELECT COALESCE(MODE() WITHIN GROUP (ORDER BY timezone), 'America/Chicago') AS tz
  FROM location
  WHERE organization_id = {{org_id}}::uuid
    AND timezone IS NOT NULL AND timezone <> ''
),
-- THE WINDOWED EVENTS, resolved before any of the per-scan joins below, so the
-- product and desk lookups run over a day of scans rather than the org's whole
-- attendance history.
ev AS (
  SELECT ae.id, ae.created_at, ae.type, ae.participant_user_id, ae.desk_location_id,
         ae.check_in_method_type, ae.check_in_method_id, ae.organization_id, otz.tz
  FROM attendance_event ae
  CROSS JOIN org_tz otz
  WHERE ae.organization_id = {{org_id}}::uuid
    AND ae.type IN ('check_in', 'check_in_denied')
    AND ae.check_in_method_type IN ('membership', 'pass')
    -- TODAY, IN THE ORG'S OWN TIMEZONE. No date parameters at all — see the
    -- header for why, and what asking for two days used to cost.
    AND (ae.created_at AT TIME ZONE otz.tz)::date = (NOW() AT TIME ZONE otz.tz)::date
)
SELECT
  -- A bare local wall-clock string, already converted to the ORG's timezone, so
  -- the page READS it rather than parsing it through new Date() and re-applying
  -- the viewer's zone — which would slide an evening scan onto the wrong day.
  TO_CHAR(e.created_at AT TIME ZONE e.tz, 'YYYY-MM-DD"T"HH24:MI:SS') AS "Checked In At",
  -- The day this card covers, as a STRING. A bare ::date comes back carrying
  -- the report timezone's offset, and a day key that must be parsed is one
  -- that can be parsed wrong.
  TO_CHAR((NOW() AT TIME ZONE e.tz)::date, 'YYYY-MM-DD')             AS "Org Today",
  TRIM(u.first_name || ' ' || u.last_name)            AS "Member",
  u.id::text                                          AS "User ID",
  u.rec_id                                            AS "Member ID",
  NULLIF(u.image, '')                                 AS "Photo",
  CASE WHEN e.type = 'check_in_denied' THEN 'Failed' ELSE 'Checked In' END AS "Status",
  COALESCE(dl.name, '(No Desk Location)')             AS "Desk Location",
  CASE
    WHEN e.check_in_method_type = 'membership'
      THEN TRIM(COALESCE(mpr.product_name, '(Unknown Membership)'))
    WHEN e.check_in_method_type = 'pass'
      THEN TRIM(COALESCE(ps.name, '(Unknown Pass)'))
    ELSE '(Other)'
  END                                                 AS "Product"
FROM ev e
JOIN users u
  ON u.id = e.participant_user_id
 AND u.deleted_at IS NULL
 AND u.first_name <> '[DELETED]'
LEFT JOIN membership m
  ON m.id = e.check_in_method_id::uuid AND e.check_in_method_type = 'membership'
LEFT JOIN materialized.membership_and_pass_plans_report mpr
  ON mpr.group_id = m.group_id
 AND mpr.organization_id = e.organization_id
 AND e.check_in_method_type = 'membership'
LEFT JOIN pass p
  ON p.id = e.check_in_method_id::uuid AND e.check_in_method_type = 'pass'
LEFT JOIN pass_schema ps
  ON ps.id = p.pass_schema_id AND e.check_in_method_type = 'pass'
LEFT JOIN desk_location dl
  ON dl.id = e.desk_location_id AND dl.organization_id = e.organization_id
-- Newest first: the whole point of a live feed. A stable tie-break on the event
-- id, or two runs of the same query can disagree about same-second scans — and
-- this org really does produce them (a household of five scanning together).
ORDER BY e.created_at DESC, e.id DESC
