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
  `reconcileWithReporting()` runs 4s after boot and every 6h: by slug first, then
  by `GET /api/admin/org-by-id/:orgId` (added to rental-report in PR #157) when
  the slug misses.
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
