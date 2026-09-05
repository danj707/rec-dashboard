-- ✅Membership Check-Ins Live — Metabase card 21517
-- https://rec.metabaseapp.com/question/21517
--
-- MIRROR of the live card. THE LIVE CARD IS THE SOURCE OF TRUTH — read it
-- (metabase://question/21517) and apply changes to THAT, then mirror the result
-- back here. The 17294 mirror was 53 lines stale once and pushing the repo copy
-- would have silently deleted a whole feature.
--
-- STATUS 2026-09-05: TAGS FLIPPED, WIDGET BUILT, AWAITING THE PUBLIC LINK.
--   1. DONE — Dan flipped Start Date and End Date to type Date. It came back
--      CLEAN: three parameters, not six. Worth recording, because this is the
--      first card in either repo where the flip did not leave string/=
--      duplicates behind; the six-parameter mess is common but not inevitable.
--   2. OUTSTANDING — a public link. Its uuid goes into CHECKINS_LIVE_UUID in
--      server.js and nothing else changes.
-- The widget is ABSENT until then, deliberately: SHARED_UUIDS omits the key
-- while the uuid is empty, so `availableReports` has no entry, the route 404s,
-- the card renders nothing and the hook does not even poll. A confident
-- "0 check-ins today" on a morning when the desk is scanning people through is
-- the reading that had to be impossible. Filling in the uuid is the whole
-- wiring — no redeploy of anything else (card 21055 landed exactly this way).
--
-- WHY A SEPARATE CARD FROM 18151. Card 18151 is the Memberships Check-In
-- REPORT: it returns every check-in in a window (apex: 23,525 rows in 22.3s)
-- and is read by a page an admin sits and filters. This is a live widget that
-- re-asks every 60 seconds, so it wants the newest few hundred scans and
-- nothing else. Measured on apex, today's window: 200 rows in 2.4s.
--
-- IT CARRIES A COLUMN 18151 DOES NOT: users.image, the member's photo.
--
-- THE PHOTO IS SPARSE AND BIMODAL, so the page must treat it as a bonus rather
-- than the design. Measured 2026-09-04 over the 33,239 members who checked in
-- with a membership or pass in 90 days: 7.5% have an image, but it is
-- concentrated — Town of Clarkstown 94.7%, City of Euclid 93.5%, Douglas
-- County 22.9%, City of Norman 16.9%, Apex Park & Rec 2.2%. So initials are
-- the design and the photo slots into them; a photo-first layout is a wall of
-- holes for most orgs. (Values are S3 URLs.)
--
-- A DENIAL IS NOT ATTENDANCE. Status is 'Checked In' | 'Failed', the same split
-- card 18151 v3 introduced. Anything counting attendance must filter Status, or
-- a member who was turned away is reported as having attended — the same shape
-- as the facility Summary counting invoice fee lines as bookings.
--
-- THERE IS NO REASON FOR A DENIAL AND NONE MAY BE INVENTED.
-- attendance_event.side_effects is empty on all 58 denials platform-wide, and
-- it is not inferable: of 52 membership refusals only 5 had an expired,
-- unstarted or cancelled membership.
--
-- "User ID" IS users.id, the uuid the Rec admin URL takes. "Member ID" is
-- users.rec_id, the six-character code staff read at the desk — a link built
-- from that looks identical and 404s.
--
-- Params: org_id (uuid), start_date, end_date (inclusive, on the SCAN date in
-- the org's timezone). Row cap is the caller's — the page asks for the most
-- recent N.
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
    [[ AND (ae.created_at AT TIME ZONE otz.tz)::date >= {{start_date}}::date ]]
    [[ AND (ae.created_at AT TIME ZONE otz.tz)::date <= {{end_date}}::date ]]
)
SELECT
  -- A bare local wall-clock string, already converted to the ORG's timezone, so
  -- the page READS it rather than parsing it through new Date() and re-applying
  -- the viewer's zone — which would slide an evening scan onto the wrong day.
  TO_CHAR(e.created_at AT TIME ZONE e.tz, 'YYYY-MM-DD"T"HH24:MI:SS') AS "Checked In At",
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
