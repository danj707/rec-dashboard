# Project notes for Claude

## Live Widgets — a new section, and the Coffee Counter (2026-09-03)

Dan, after the first one was built on the reporting side and taken back off the
same afternoon: *"I ruminated on the live reports/widgets, and decided they
don't belong on the reporting project side... The new live coffee counter
widget, and all other live widgets, need to live on the org-dashboard project.
A dashboard is the spot for live data, not static reports."*

**THE LINE IS BETWEEN A REPORT AND A DASHBOARD, not between two features.** A
report answers a question about a window somebody chose; a panel refreshing
itself under that answer is a second, contradictory clock on the same screen.
So `SECTIONS.live` is `_special` — it renders its own component instead of
going through the date-ranged `reportData` pipeline that every other section
uses, because that pipeline is keyed on the range these widgets ignore. The
section header says *"not date-filtered"* where the numbers are, since a reader
cannot otherwise tell which clock a figure is on.

### The Coffee Counter

Named for Laurel Rossiter at Shrewsbury, whose feedback on the reporting
project produced it: *"registration day opens and I can literally watch people
register for stuff and keep track... I don't have that umbrella viewpoint that
I'm used to having, and I miss it."* What she already had was a Metabase card
with four columns, newest first, no filters — and it beat a seven-tab report
for the one question she asks daily.

**THE DESIGN IS THE RESTRAINT.** Today's count, a seven-day sparkline, the last
eight signups, and a Pause. Every instinct to add a filter here should be
resisted: the reports exist for analysis, this is the thing you leave open.

- **ABSENT, NEVER A ZERO.** A failed or unanswered feed renders **nothing** —
  not a zero — and **the section hides with its widgets**, because a "Live
  Widgets" heading over a blank grid reads as broken rather than as absent. On
  a registration morning *"0 signups today"* when the truth is "nothing
  answered" is the most damaging thing this dashboard could show.
  **This was an env gate (`MB_ENROLLMENTS_UUID`) for about an hour** — Dan:
  *"what is MB_ENROLLMENTS_UUID lol"* — which put a deploy step between
  publishing a card and seeing the widget, for no benefit: the rule that had to
  hold lives in the component, not in a variable. The card is a literal now,
  like every other entry in `SHARED_UUIDS`.
- **IT HAS ITS OWN CLOCK.** `LIVE_REPORT_TTL_MS` caches this feed for **60
  seconds** and **beats the org's own `cacheTTL`** — an org that set a
  30-minute cache did not ask for a stale "right now". The page polls at the
  same 60s, so most ticks are served from that cache and the card is queried
  about once a minute per org rather than once per viewer.
- **"TODAY" COMES FROM THE FEED, NOT THE BROWSER.** The card stamps each signup
  in the ORG's timezone, so the day being counted is the newest ROW's own day.
  A viewer in another zone — or with a wrong clock — must not be told a
  different number from the person sitting in the rec centre.
- **Nothing parses a feed timestamp through `new Date()`.** It is a bare local
  wall-clock string already converted to the org's zone; parsing and
  reformatting re-applies the VIEWER's zone and moves an evening signup onto
  the wrong day. The window is built from date PARTS for the same reason — a
  `toISOString()` window asks for tomorrow from late afternoon onwards in the
  US, on the one feed whose entire value is today.
- **The sparkline is built from the WINDOW, not from the rows' own days**, so a
  day with no signups is a real empty bar rather than silently missing. Today
  is the last bar and the panel says it is still filling — otherwise a
  half-finished day reads as a decline.
- **Money is blank, never `$0`.** A free registration and a price we could not
  read are different facts.
- **Pause stops the timer**, because a list that reorders under the cursor
  while you are reading a name is worse than a stale one.
- **It renders ABOVE the stored sections and is NOT in `config.sections`.** Live
  data is what you want on arrival, and gating it on a per-org config would
  mean nobody sees it until they go looking in the editor for a widget they do
  not know exists. **Never in print:** a printed "right now" is a lie the moment
  the paper leaves the printer.

### Card 21286, and the four defects it fixes

`sql/enrollments-live.sql` mirrors it; **the live card is the source of truth —
read it before writing to it.** Ported from Laurel's own card 3571, and each
difference is a bug in the original:

1. **`Signed Up At` reads `created_at`, not `updated_at`.** 3571 selects and
   sorts on `updated_at` while its own date filter is bound to `created_at`, so
   the column and the filter describe different events and "newest first" is
   really "most recently TOUCHED first" — a transfer or a staff note re-dates a
   months-old signup to today and floats it to the top.
2. **The org is a parameter.** 3571 hardcodes Shrewsbury's uuid while its
   description says Madison — it was copied.
3. **The timezone comes from the org's majority location**, not a hardcoded
   `America/New_York`, which renders a 9pm signup on the wrong DAY for the
   non-Eastern half of the platform.
4. **No `updated_at > '2025-04-15'` floor** silently truncating history.

Plus `Participant` (a parent registering a child is the common case, and one
"name" column has to pick a side). **It is not a revenue report:** `Price` is
`applied_pricing` finalCents, never `order_item.price` — the rate card, which
reads non-zero for a comped booking.

**Public UUID `e663ecfb-71b4-4de1-b984-13c69beab005`**, wired 2026-09-03 and
signed off cache-independently through the public endpoint with the app's own
`date/single` parameters: **shrewsbury, 7-day window, 126 rows in 20.7s.**

**Worth knowing about that 20.7s:** it is a cold run, and it is why the feed
caches for a minute rather than being fetched per poll — an open dashboard
costs about one query a minute for its org, not one per viewer. The cost is in
the `money` CTE, which aggregates the org's whole `order_item` ledger rather
than the window; narrowing it is the obvious optimisation if this ever needs
one. Nothing waits on it: the widget renders when it answers.

After any API push to the card, re-set the Start/End Date variables to type
**Date** and re-save until it registers three parameters rather than six.
Flip link: https://rec.metabaseapp.com/question/21286

### Guards

`scripts/live-widgets.spec.js` (**46 assertions, in CI**), which LIFTS AND RUNS
the four date helpers rather than regexing them. Mutation-tested four ways, all
failing by name: a "0 signups today" rendered on a dead feed, the live TTL
override removed so the org's 15 minutes wins, "today" taken from the browser's
clock instead of the newest row, and the print exclusion dropped.

**One assertion failed on correct code first time**, and the lesson is the
familiar one: `!/new Date\(r\[/` file-wide fails because other tiles
legitimately build Dates for their own charts. Scope an assertion to the
surface it is about — it slices the widget now.

Plus six `ci-check-render.js` cases keyed on **computed values**: the row count,
today's count (three of the five fixture rows share the newest day, so a widget
printing `rows.length` reads 5 and fails), exactly seven bars, the last bar
marked today and carrying its own count, and the section sitting above the
date-ranged ones. **The fixture's dates are built relative to today** — with
hardcoded dates the sparkline draws seven empty bars and every bar assertion is
vacuous.

## Metabase public-card fetches — keep in lockstep with rental-report (IMPORTANT)

This app and `danj707/rental-report` both fetch Metabase public cards with
hand-rolled clients. **Any fix to Metabase-facing behavior in one repo MUST be
swept into the other** — grep both for `api/public/card` and apply the change
everywhere it matches. This is not hypothetical: on 2026-08-09 Metabase started
requiring a per-parameter `id` on public `/query/json` requests; rental-report
got the fix, this repo didn't, and on 2026-08-10 **every org's dashboard
rendered zeros** until the same wrapper was ported (see the param-id stamping
block near the top of server.js).

Incident closeout rule: after fixing any Metabase/platform behavior change,
sweep sibling repos (rental-report, rec-dashboard; org-features does not fetch
Metabase) for the same pattern before calling it done.

## Report links: build them from the reporting project's identity, not ours (IMPORTANT)

**The incident (2026-08-25).** Dan clicked a report link from this dashboard —
`/town-of-shrewsbury/users?token=WcAyo1FVtpVmXXA2` — and got **"Unknown org"**.
rental-report had removed the duplicate `town-of-shrewsbury` slug on 2026-07-20
and serves that org as `shrewsbury` with a **different token**. This dashboard
kept its own copy of both and never looked again, so every report link it
rendered for Shrewsbury — and the `/api/org-visibility/` fetch behind the report
list — silently 404'd for **five weeks**. The detection mechanism was a human
clicking a link.

**Why nothing saw it.** `ORG_SLUG` and `TOKEN` are *this* dashboard's names for
an organisation; rental-report holds its own copies. Both are copies, and copies
drift. The sync was **one-way and one-time**: Add Org asked
`/api/admin/org/:slug` once, at creation, **by slug**. A renamed org answers
`exists: false` there, which is indistinguishable from an org that was never
added — so there was nothing to alarm on even if anyone had been looking. And a
dead report link fails on the *other* project's side, where nothing here can see
the 404.

**The fix, and the rule it establishes.**

- **Reconcile on the organisation UUID, never the slug.** The slug is each
  project's own name for the org and is precisely the thing that drifts; the
  rec.us `orgId` is stable in both. orgId equality is what makes "same
  organisation, other name" a safe conclusion rather than a guess.
  `reconcileWithReporting()` runs 4s after boot and every 6h, in three steps:
  by our slug; then `GET /api/admin/org-by-id/:orgId` (exact, added to
  rental-report in PR #157); then, because that endpoint 404s on a rental-report
  that has not deployed it yet, `GET /api/admin/org/:slug` over the slugs a
  rename plausibly produced.
- **The candidate probe is a search with a proof, not a guess.** A candidate is
  adopted only if its `orgId` equals ours. That matters: a same-named town in
  another state answers 200, and adopting it would point an org's report links at
  another town's data — worse than a 404. The affix rules mirror rental-report's
  own near-miss suggestion in `noteDeadLink()`; keep them in step. Candidates are
  reachable **only after a by-slug miss**, so an agreeing org still costs exactly
  one request per reconcile — the spec pins that, or a fleet reconcile becomes a
  slug crawl. Verified against production rental-report on 2026-08-25, where
  `org-by-id` is still a 404: `town-of-shrewsbury` → `shrewsbury`, live token
  adopted, and the resulting report URL returns 200.
- **`reportingIdentity(slug)` is the ONLY thing allowed to build a rental-report
  URL.** Server-side that means the org-visibility fetch; client-side it means
  `RPT_SLUG()` / `RPT_TOKEN()` in `public/dashboard.html`, fed from `_orgMeta`.
  The dashboard keeps `ORG_SLUG`/`TOKEN` for **its own** routes — they are still
  correct there.
- **A re-issued token is the same failure, quieter.** The link resolves to a real
  org and is refused, so it reads as a permissions problem rather than a naming
  one. Adopted the same way (`token-drift`): for their own URLs, rental-report is
  the authority.
- **An org rental-report genuinely does not have gets NO invented identity**
  (`{slug: null, state: 'missing'}`). A guessed slug would point live links at the
  wrong org, which is worse than a 404. It falls back to our own names — exactly
  what the page did before — and says so in the log and on the admin route.
- **Unreachable must degrade, not break.** No `REPORTING_BASE_URL`, or a network
  failure, leaves identities `unchecked`, which behaves exactly as this dashboard
  did before any of this existed. Never worse.
- **Add Org now asks by orgId too — this is where the duplicate was MADE.**
  rental-report already served Shrewsbury under another slug; the by-slug check
  missed it, so Add Org minted a second token for the same organisation and
  pushed it over there as a new org. A by-slug-only check recreates that.

**Where to look when a report link 404s:**
`GET /admin/api/reporting-identity` (admin-gated) lists every org with what
rental-report actually calls it, whether the tokens differ, and when it was last
checked. `?recheck=1` re-runs the reconcile rather than waiting up to 6h to see
whether a fix took.

**Where the Shrewsbury entry lives:** the Railway volume's
`dashboard-orgs.json`, not a source file — so there was no line to change and the
reconcile self-heals it on the next boot.

Guarded by `node scripts/reporting-identity.spec.js` (**11 assertions, in CI**).
It stands up a stub rental-report holding the real Shrewsbury shape (org under a
different slug, different token, same orgId) and **slices the real reconciliation
block out of server.js** rather than restating it — a copy would keep passing
after the shipping one regressed. Mutation-tested against six regressions, each
failing by name: dropping the orgId fallback; inventing an identity for a missing
org; keeping our own token on token drift; reverting the visibility fetch to our
slug; reverting a client link to `ORG_SLUG`/`TOKEN`; and removing Add Org's
by-orgId lookup.

**The other half of this ships in rental-report** (PR #157): a `deadlink` Slack
alert on any **tokened** 404, which is what would have caught this in hours
instead of five weeks. A tokenless 404 stays silent — that is bot traffic — and
the token itself is never recorded.

## The Memberships section reads the paid book (2026-08-30)

Dan: *"we need a new 'Memberships' section... With according metrics based off
the memberships reports."*

**The section already existed. What it did not have was anything the memberships
REPORT had learned.** Card 17301 is **shared** with rental-report
(`f4496307-…` here, `SHARED_UUIDS.memberships` there), so every column that card
gained in v2–v4 — `Product Kind`, `Auto Renew`, `Period Start`, `Next Renewal`,
`Cancel Scheduled At` — has been arriving in this dashboard all along and being
thrown away. Five tiles counted rows and summed a price.

**The helpers are a deliberate MIRROR, and they carry rental-report's names on
purpose** so a grep finds both copies. A rule about what a row MEANS has to be
the same in both repos or the dashboard and the report it links to will disagree
about the same org on the same day — which is the sibling-sweep rule at the top
of this file applied to semantics rather than to fetch behaviour.

Three rules, each one a bug that shipped on the report side first:

- **A PASS IS NOT A MEMBERSHIP**, and it is not a membership that merely is not
  auto-renewing either — `pass` has no subscription column in the schema at all.
  Norman's feed is 20,341 rows of which **16,940 are passes**, 4,518 of those $5
  league-tournament gate admissions. `Active Members` counted every one of them.
  It is gated on the COLUMN, so a pre-v3 cache entry keeps the number the tile
  has always shown instead of dropping by two thirds for a reason nothing on
  screen explains — and **the excluded count is named in the sub-line**, because
  a silent exclusion is how a number stops being trusted.
- **A BILLING CYCLE BELONGS TO THE PLAN, NOT TO ONE ROW'S TIMESTAMPS.** Dividing
  by each row's own `Next Renewal − Period Start` reads the time REMAINING in
  the period on a membership about to renew: at Apex 8 rows had a gap under a
  day (smallest **15 minutes**) and one derived **44,665 renewals**.
  `mbPlanCycles` takes the median across a plan's members with sub-day gaps
  given no vote at all.
- **PRESENCE, NOT COUNT.** Feeds cache 4 hours, so a pre-v3 response is live
  alongside a current one. A tile rendering `0` there says *"this org has no
  auto-renew"*; the truth is *"this feed cannot tell us"*. Every gate tests
  whether the COLUMN exists, never whether any row has a value. This is the same
  invariant as *A failed fetch must never render as $0* below, one column down.

**Churn is a HAZARD RATE in the plan's own cadence** — cancellations over
renewal *opportunities* — never the lifetime share who have ever cancelled. The
book-level tile carries **no period label**, deliberately: a book of weekly,
monthly and annual plans has no single cadence, so "per month" would be false
for part of it. Every per-plan rate does carry one, or the table invites ranking
a weekly plan against a monthly one.

**Each tile links to the TAB it was computed from** (`reportTab` on the widget
def). The section header link lands on the report's own default tab, so "Churn
Per Renewal" used to send a reader to a membership list with no churn on it.
Built through `RPT_SLUG()`/`RPT_TOKEN()` — never `ORG_SLUG`/`TOKEN` — per the
reporting-identity rule above; the spec fails if that reverts.

Guards: `scripts/membership-book.spec.js` (**73 assertions, in CI**), which
LIFTS AND RUNS the helpers and every transform rather than regexing them, over a
fixture where **the passes outnumber the memberships** and the corrupt sub-day
rows are the MAJORITY on their plan — nine good rows against one bad passes with
the sub-day filter deleted, because a median over nine good values ignores the
tenth. Mutation-tested eleven ways, all failing by name.

**One mutation exposed a gap in the fixture rather than in the code**: deleting
the churn presence gate passed, because the pre-v3 book held no cancellation for
it to divide by. With that row's `Renewal Type` set so it survives the inferred
fallback, the mutation now renders a confident **100%** churn — which is the
kind of absurd-but-authoritative number the gate exists to prevent.

## The dashboard render check (2026-08-30)

**This repo had none**, for a 3,500-line React page compiled by in-browser
Babel. `node --check` reads a different file; `ci-check-html.js` proves the
block PARSES; no spec mounts a component. **Parsing is not running**, and its
sibling shipped two blank pages to production learning that.

`node scripts/ci-check-render.js` boots a static server for `public/`, answers
every `/api/` request from fixtures, and drives a real Chromium — failing on any
uncaught exception, an empty body, or a tile whose COMPUTED VALUE is wrong.
Cases are keyed on the tile's own `.metric-value`, not on page text: "a widget
rendered" passes on every regression the specs above name.

**It earned its keep on its first run.** `tbl-mem-autorenew` returned
`{ headers, rows }` where `TableWidget` reads `{ columns, data }` — which reads
`data.data.length` off `undefined` and **unmounts the whole dashboard**, not
just that tile. All 73 spec assertions passed on that build, and so did the JSX
check. Verified in both directions: restoring the bad shape reproduces
*"the page came up blank (0 chars of text)"*.

**Never let a missing browser become a silent skip** — a render check that opts
out when it cannot find Chromium defeats its entire purpose. CI installs one
explicitly and fails the build if it cannot.

**`puppeteer` is deliberately NOT in `package.json`.** Adding it as a
devDependency broke the Railway PR preview immediately: `npm ci` fails in ~10s
against a `package-lock.json` that does not know about it, at `BUILD_IMAGE` with
no useful log. Regenerating the lock would have fixed that and left a worse
problem — every production deploy downloading a ~150MB browser it never opens.
CI installs it on demand (`npm install --no-save puppeteer@22`) and the script
resolves a sibling checkout when one is present. **Generalise it: a tool only CI
needs does not belong in the manifest the deploy installs from.**

## A failed fetch must never render as $0

`fetchReportData` in public/dashboard.html tracks failures per report type and
the dashboard shows a red "N data feeds failed to load" banner — keep this
invariant when touching the data layer. Zeros that are actually errors cost
hours of confusion (2026-08-06 Fast Track cache incident, 2026-08-10 outage).

## Metabase canary

server.js runs an hourly canary (`runMetabaseCanary`) that probes one org's GL
feed through the same code path the widgets use, and alerts on failure via
`SLACK_WEBHOOK_URL` (preferred; copy the var from the rental-report service to
enable) or Resend email to `ALERT_EMAIL` (default dan@rec.us). If you change
the fetch path, make sure the canary still exercises it.

## revstreams card param types

The revstreams card's template tags are plain text variables — the public API
only accepts `category`-type params against them (`date/single`/`string/=`
both 400). Don't flip those tags to Date in the Metabase UI.
