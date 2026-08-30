# Project notes for Claude

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
out when it cannot find Chromium defeats its entire purpose. `puppeteer` is a
devDependency (it is not used at runtime) and CI installs a browser explicitly.

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
