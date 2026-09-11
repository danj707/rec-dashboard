-- 📅 Happening Today — every program session running at this org today
--
-- Dan: "Scope for this is all programs happening at that org today ... As the
-- program becomes 'live' and happening in their time zone, it highlights in
-- green, once the time passes, it bumps off the top of the list and the list
-- scrolls up."
--
-- NO DATE PARAMETERS MEANS NO TAG FLIP, EVER — the property every live card
-- here is built around. `org_id` is a text parameter and survives an API push
-- unchanged, so this card can be corrected at any hour without taking the
-- widget down. The day is resolved in SQL from the org's own timezone, so the
-- page never parses an offset and a viewer three zones away still sees the
-- org's today.
--
-- THE WINDOW IS AN INSTANT RANGE, NOT A WRAPPED COLUMN. `starts_at >= t0 AND
-- starts_at < t1` keeps the session index usable; the obvious
-- `(starts_at AT TIME ZONE tz)::date = ...` reads the org's whole history and
-- throws almost all of it away — the measurement already recorded on
-- checkins-today.sql, and it applies to `session` the same way.
--
-- `Org Now` IS THE GREEN-STATE ANCHOR. It is the org's wall clock at the
-- moment the feed answered, so the page decides live / upcoming / finished by
-- comparing three strings in one zone rather than against the reader's own
-- clock. Between polls the page advances it by elapsed local milliseconds,
-- which is why the next poll re-stamps it rather than the page trusting a
-- sixty-second-old instant.
--
-- THE SITE IS AGGREGATED, NEVER JOINED. A session's reservation can occupy
-- more than one court — measured at apex today, MAX 4 — so joining
-- reservation_court onto the row set would multiply the session and every
-- figure hanging off it. `Site Count` ships beside the name for the same
-- reason `location_count` does on card 17295: "Gym A" alone is a confident
-- half-truth for a session that also holds the annex.
--
-- ENROLMENT IS READ AT THE SECTION'S OWN GRAIN. A `per-session` section's
-- bookings carry a session_id and belong to that meeting; every other section
-- enrols into the RUN and its bookings carry no session at all. Reading one
-- side only reports 0 for the other — measured at apex today, 25 of 101
-- sessions are per-session, so either mistake is a quarter of the list or
-- three quarters of it.
--
-- CANCELLED AND UNPUBLISHED SESSIONS ARE RETURNED AND MARKED, not dropped. A
-- cancelled meeting still holds the room and an unpublished section still has
-- staff turning up; excluded is never hidden. Measured at apex today: 3
-- cancelled, 40 on sections with no publish date.
--
-- Verified 2026-09-11 by running THIS WHOLE FINAL SELECT with literals inside
-- a counting wrapper — not a summary probe around the CTEs, which is exactly
-- how card 21682 shipped with an ORDER BY that had never executed. apex:
-- 101 rows in 11.3s, 65 with a site, 0 with no capacity, `Org Now`
-- 2026-09-11T09:47:45 in America/Denver. Sessions today elsewhere the same
-- afternoon: smyrna 18 (New York), el-segundo 15 (Los Angeles), watertown 1
-- (New York) — so Dan's "50 programs" is mid-band and a near-empty day is the
-- common case outside apex, which is what the empty state is for.
--
-- Params: org_id (uuid). Mirrored here; THE LIVE CARD IS THE SOURCE OF TRUTH.
WITH cfg AS (
  SELECT COALESCE(MODE() WITHIN GROUP (ORDER BY l.timezone), 'America/Chicago') AS tz
  FROM location l
  WHERE l.organization_id = {{org_id}}::uuid
    AND l.deleted_at IS NULL AND l.timezone IS NOT NULL AND l.timezone <> ''
),
win AS (
  SELECT tz,
         ((NOW() AT TIME ZONE tz)::date)::timestamp       AT TIME ZONE tz AS t0,
         (((NOW() AT TIME ZONE tz)::date + 1)::timestamp) AT TIME ZONE tz AS t1
  FROM cfg
),
sess AS (
  SELECT s.id, s.section_id, s.starts_at, s.ends_at, s.canceled_at,
         s.location_id, s.capacity AS sess_cap,
         sec.name AS section_name, sec.capacity AS sec_cap,
         sec.registration_mode, sec.publish_at,
         p.name AS program_name, w.tz
  FROM win w
  JOIN section sec ON sec.organization_id = {{org_id}}::uuid
       AND sec.deleted_at IS NULL AND sec.archived_at IS NULL
  JOIN session s ON s.section_id = sec.id
       AND s.deleted_at IS NULL
       AND s.starts_at >= w.t0 AND s.starts_at < w.t1
  LEFT JOIN program p ON p.id = sec.program_id
),
loc AS (
  SELECT l.id, l.name FROM location l WHERE l.organization_id = {{org_id}}::uuid
),
site AS (
  SELECT r.session_id,
         STRING_AGG(DISTINCT c.court_number, ', ' ORDER BY c.court_number) AS site_names,
         COUNT(DISTINCT c.id) AS site_count
  FROM reservation r
  JOIN sess ON sess.id = r.session_id
  JOIN reservation_court rc ON rc.reservation_id = r.id
  JOIN court c ON c.id = rc.court_id
  GROUP BY r.session_id
),
bk_sec AS (
  SELECT b.section_id, COUNT(*) AS n
  FROM booking b JOIN sess ON sess.section_id = b.section_id
  WHERE b.type = 'section' AND b.status = 'confirmed' AND b.canceled_at IS NULL
    AND b.deleted_at IS NULL
  GROUP BY b.section_id
),
bk_ses AS (
  SELECT b.session_id, COUNT(*) AS n
  FROM booking b JOIN sess ON sess.id = b.session_id
  WHERE b.type = 'session' AND b.status = 'confirmed' AND b.canceled_at IS NULL
    AND b.deleted_at IS NULL
  GROUP BY b.session_id
)
SELECT
  s.id::text                                                            AS "Session Id",
  s.section_id::text                                                    AS "Section Id",
  s.section_name                                                        AS "Section",
  s.program_name                                                        AS "Program",
  TO_CHAR(s.starts_at AT TIME ZONE s.tz, 'YYYY-MM-DD"T"HH24:MI:SS')     AS "Starts At",
  TO_CHAR(s.ends_at   AT TIME ZONE s.tz, 'YYYY-MM-DD"T"HH24:MI:SS')     AS "Ends At",
  TO_CHAR((NOW() AT TIME ZONE s.tz), 'YYYY-MM-DD"T"HH24:MI:SS')         AS "Org Now",
  TO_CHAR((NOW() AT TIME ZONE s.tz)::date, 'YYYY-MM-DD')                AS "Org Today",
  s.tz                                                                  AS "Org Timezone",
  l.name                                                                AS "Location",
  st.site_names                                                         AS "Site",
  COALESCE(st.site_count, 0)                                            AS "Site Count",
  CASE WHEN s.registration_mode = 'per-session'
       THEN COALESCE(bs.n, 0) ELSE COALESCE(bc.n, 0) END                AS "Enrolled",
  COALESCE(s.sess_cap, s.sec_cap)                                       AS "Capacity",
  s.registration_mode                                                   AS "Registration Mode",
  (s.canceled_at IS NOT NULL)                                           AS "Cancelled",
  (s.publish_at IS NOT NULL)                                            AS "Published"
FROM sess s
LEFT JOIN loc l    ON l.id = s.location_id
LEFT JOIN site st  ON st.session_id = s.id
LEFT JOIN bk_sec bc ON bc.section_id = s.section_id
LEFT JOIN bk_ses bs ON bs.session_id = s.id
ORDER BY s.starts_at, s.section_name
;
