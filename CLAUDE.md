# Project notes for Claude

## THE ORG DASHBOARD TAKES THE LOCAL SKY (2026-09-19)

Dan, with Watertown's dashboard open: *"can we do the same weather treatment to
the org-dashboard project? I'm thinking something small about the weather on a
card in the top bar, then the whole background for the card reflects current
weather, time of day, etc."* Then, on the mockup: **"merge it!"**

A 206×44 card in `.dash-header-left`, beside the org's name, whose own
background is that org's current sky. Mockup (both placements, all eight skies,
day and night): https://claude.ai/artifact/2G79aJQgE56vZAG2Ckiy9B

**AND THEN THE WHOLE PAGE, the same afternoon.** Dan, on the live card:
*"doesn't the whole org page get the overcast treatment?"* Offered three
landings — the sky in light theme only, damped in dark, or full strength in
both like the reports project — he picked **"C"**. So a fixed layer sits
behind the dashboard and the org's sky is the page.

### THE LIBRARY IS A TWIN, BYTE FOR BYTE, AND THAT IS THE WHOLE POINT

`lib/weather.js` is rental-report's file copied across. Two deployed services
in two repositories cannot share a module, and **no CI job on either side can
assert the two agree** — so the note at the top of both says *change both or
neither*, and the spec here fails if that note is ever deleted. A WMO code that
means rain on the report and overcast on the dashboard is the
two-surfaces-disagreeing bug, one repo over.

Everything it already encodes carries over unchanged and is not re-derived
here: an unknown code is **never CLEAR**, `strictNum` rejects `null`/`""`/
booleans by name before coercing, an expired reading is not served, and the
look-ahead line is withheld rather than softened.

### THE COORDINATES WERE ALREADY THERE, ON THE SAME orgId

Two of the three static orgs are in rental-report's `ORGS` under the **same
organisation uuid**, so their coords came across rather than being looked up
again — the two projects sharing an org must not disagree about where it is.

| | |
|---|---|
| watertown `d781690b…` | 42.3709, -71.1828 — carried over |
| niagarafalls `a976a11a…` | 43.0962, -79.0377 — carried over |
| **torrance `4246b144…`** | **33.8358, -118.3406 — NEW.** Not a static org over there |

Torrance is safe to look up because the org record carries **`state` as well as
`city`**; the "never guess from the name" rule is about a name ALONE, and there
are Watertowns in MA, NY, CT and WI. **Every dynamic org has no coords and
therefore no card**, and renders exactly as it does today.

### EVERY ORG WITH AN ADDRESS NOW HAS A SKY (2026-09-20)

Dan, on Apex's dashboard showing nothing: *"why do 21/24 get nothing?"* then
*"backfill those coords — we need live weather data and sky/dark/weather on
boot."*

**THREE ORGS HAD COORDINATES AND EVERY OTHER ONE WAS ADDED THROUGH ADD ORG,
WHICH HAS NEVER STORED THEM.** `watertown`, `niagarafalls` and `torrance` are
hardcoded in `ORGS` with lat/lon typed in by hand; everything else carries
`city` and `state` and nothing else, so `coordsOf` returned null and both gates
correctly declined. Not broken — unfinished, and invisible because declining is
the designed behaviour.

**A CITY AND A STATE ARE NOT A NAME**, which is what makes resolving them
consistent with the standing rule rather than a hole in it. *"Never a guess
from the org's name"* stands and is now asserted: `displayName` is never
consulted, because there are Watertowns in MA, NY, CT and WI. But
`city: 'Arvada', state: 'CO'` is the org telling us where it is, in two fields
somebody filled in. Reading that is not guessing.

**AN ORG WITH NEITHER STILL GETS NOTHING**, and renders exactly as before.

### TWO SOURCES, CHEAPEST FIRST, AND THE TABLE IS KEYED ON orgId

| | |
|---|---|
| 1. `ORG_COORDS_BY_ID` | **13 orgs**, lifted from the reporting project. No network, no failure mode |
| 2. `city` + `state` | geocoded once through Nominatim, cached, persisted |

**KEYED ON orgId, NEVER ON SLUG.** The two projects spell the same organisation
differently and have drifted before — this dashboard called Shrewsbury
`town-of-shrewsbury` for five weeks — so a slug-keyed table would silently miss
exactly the orgs most likely to be wrong. The uuid is the half that is stable.

**THE VALUES ARE LIFTED, NOT RE-DERIVED**, so the two projects cannot disagree
about where an org is. Cross-checked against an independent geocode: Nominatim
puts Arvada at **39.8006, -105.0812** against the table's **39.8028, -105.0875**
— about 300 m, the difference between a city centroid and a district office,
and nothing at this zoom.

**AND THE REPORTING PROJECT'S OWN NOTE SAYS 18. IT IS 13** — counted three
times, because the first two parses were wrong: rental-report writes
`coords:  {` with two spaces (so a `coords: {` grep finds nothing) and some of
its org keys are QUOTED (`"douglas-county-nv"`), which a bare-key regex skips.
Both mistakes produced a confident short list, and the second one silently
attributed San Francisco's coordinates to Pawnee. *A parse that returns
plausible rows is not a parse that is right.*

### WEATHER ON BOOT — which reverses a decision recorded one repo over

The reporting project's rule is that **nothing is pre-warmed**: an org nobody
opens is an org never fetched. That is still right for 29 report surfaces. It is
not right here, and Dan asked for the opposite: this dashboard is a page people
leave open, the org set is small, and a first load with no sky was the
complaint. Said out loud rather than quietly diverging.

- **`orgWeatherFor` STAYS SYNCHRONOUS.** The pre-warm is not awaited and the
  front door still never blocks on a third party — it only means the answer is
  usually already there when the first reader arrives. Proven: apex's very
  first `/api/config` after a cold boot returns a real reading.
- **Both run AFTER `app.listen`**, and not only for pacing: `backfillOrgCoords`
  reads `geoCache`, a `let` declared some six hundred lines further down. At
  module scope that is a temporal dead zone and the boot dies — the trap this
  repo's sibling has shipped twice.
- **`SKIP_PREWARM` covers both**, so a spec that boots this server neither
  geocodes nor fans out at open-meteo.
- **Both gates are honoured by the pre-warm** — the kill switch and the coords —
  or it fetches for orgs that will never render a card.

### THE THIRD-PARTY RULES, each of which is a way to be permanently wrong

- **Paced at 1.2s.** Nominatim's published limit is one call a second.
- **A MISS IS CACHED AS A MISS.** *"We asked and there is no such place"* is a
  real answer and must not be re-asked on every boot; what it must never do is
  become a coordinate. Read back by **presence**, not truthiness — a truthy test
  on `{lat: null}` re-asks it forever.
- **A FAILURE IS NOT CACHED.** A timeout is not evidence about the place, and
  caching it would make one bad minute permanent.
- **`lng` VS `lon`.** Nominatim answers `lng` and the weather library wants
  `lon`. A silent key mismatch reads as a missing field rather than an error —
  the `Number(null)` defect in a new costume — so the conversion is explicit and
  the result goes through `coordsOf`, which rejects nulls and anything off the
  globe before it can be stored.
- **A STATE ALONE IS A REGION, NOT A POINT.** Geocoding `', CO'` lands on the
  state centroid, which is a confident wrong sky rather than no sky.

Add Org resolves coordinates at creation too, so a new org has weather on its
first open rather than after the next deploy — the table synchronously, the
geocode not awaited.

### THE SLICE RAN PAST ITS OWN FUNCTION, and the suite still passed

`fnRefresh` ended at the literal `"/* The per-org kill switch"`, and the backfill
was inserted between the two — so that slice went from **~30 lines to 141** and
every assertion under it silently widened to cover code it was never written
about. **All 407 assertions still passed.** It is bounded on the function's own
closing brace now, with an assertion on the slice's LENGTH, so the next
insertion fails by name instead of quietly weakening six tests. Nth instance in
these two projects of a slice pinned to a neighbour's spelling.

### THE GROUND IS WHERE THE WEATHER ACTUALLY READS HERE

The reports project's org landing is a sparse list of cards, so its sky shows.
**This page is a dense grid — 48 widgets on Watertown — and the first build
put a beautiful sky entirely behind opaque cards: you could not tell overcast
from clear.** Rendered it and looked at it, which is the only way that is
visible.

So the strong part of every ramp keeps the top of the viewport and **settles by
30% into a GROUND TINTED WITH ITS OWN COLOUR**, which is then what shows in
every gutter, every gap between cards, and the whole page below the fold.

**THE GROUND IS MIXED INTO `var(--bg-page)`, NEVER SUBSTITUTED FOR IT**, and
that one word is what makes "C" possible at all. Over there the page has no
theme switch and every ramp settles into one hardcoded near-white; here the
viewer picks, and a ramp ending in a literal light grey drops a sheet of
daylight behind a dark-themed dashboard. `color-mix(in srgb, var(--bg-page)
74%, <sky>)` gives light theme a tinted near-white and dark theme a tinted
near-black — same sky, both themes, neither fighting its own chrome. The spec
reproduces that blend arithmetically and the render check drives a dark-theme
case, because a stylesheet reads plausibly whichever way round it is written.

### THE LAYER IS PORTALLED TO `<body>`, and both reasons are load-bearing

`ReactDOM.createPortal(…, document.body)`: `body.has-wx > *:not(.wx-layer)`
needs the layer to be a **SIBLING** of `#root` rather than a descendant of it,
and **a fixed layer inside a stacking context is trapped by that context**.
Rendered in place it is neither, and the page still looks approximately right
in a screenshot — which is why there is a HIT TEST: `elementFromPoint` at a
widget's top edge must find the dashboard and not the sky. Every other selector
keeps matching when the layer paints over everything.

- **The classes go on `<body>`, not on the layer.** Every rule is written
  `body.wx-rain .wx-sky`, so the ground, the glow and the particles key off one
  place — and the ground token has to be on `body` anyway, since it tints
  chrome the layer does not contain.
- **They are removed on unmount**, or a page that later loses its reading keeps
  painting the last sky it had.
- **No reading, no `has-wx`**, and the page renders exactly as it did before.
  That is the state 21 of the 24 orgs are in.
- **Nothing in print.** The PDF is a document about a date range.

### TWO PIECES OF CHROME SIT ON THE SKY RATHER THAN IN A CARD

The refresh strip and each section's own header, both in the TOP fifth of the
layer — the part of every ramp that is actually sky. 11px muted text on
`#485663` is **3.2:1**. Both get a plate in the theme's own page colour, so
every ink ratio in them is what it was yesterday.

- **The top bars are TRANSLUCENT, not opaque** (86%/88% with a blur). They sit
  over the most saturated part of every ramp and opaque they waste it.
- **THE SECTION-HEADER PLATE IS NOT DECORATION, and taking it out proved it:**
  where the first section header lands depends on the viewport height and on
  whether the early-access banner is up, so the gradient cannot be tuned to
  dodge it — without the plate its 11px *"not date-filtered"* chip is muted
  grey on mid-grey sky. The later headers are already over the tinted ground,
  where the same plate is within a hair of the page colour and invisible.
- **The gutters and the gaps between cards are where the sky is MEANT to show**,
  which is why the cards themselves were left alone.

### NIGHT IS THE ORG'S CLOCK. DARK MODE IS THE VIEWER'S.

**Night paints the sky and the ground; it does NOT touch `data-theme`**, and
that is where this port stays deliberately smaller than the original. Over
there night takes the whole page dark — ground, cards, their ink, the section
labels and the footer — because that page has no dark mode of its own. This
one does, and the theme is a setting somebody chose. So after sunset the sky
goes dark behind a light dashboard if that is what the viewer asked for, and a
render case reads `data-theme` at 9pm and requires it untouched.

Night is still a **MODIFIER, NOT A SKY**, on both surfaces: `wxc-night` rides
on top of whichever sky is current (`.wxc-night.wxc-rain` is (0,2,0) against
`.wxc-rain`'s (0,1,0)), and `body.wx-night .wx-sky` overrides the day ramp at
equal specificity by **source order** while leaving the condition's own
particles alone. So rain at 9pm still rains, on the card and on the page. A
single `night` class silently drops the weather, which is the half the original
mockup got wrong.

### THE PALETTE **IS** THE LEGIBILITY FIX, and the spec COMPUTES it

The full-page version floats its text on cards sitting ABOVE the sky. **A 44px
card has nowhere to hide** — the temperature sits directly on the gradient — so
every day sky is kept wholly in the light range with dark ink and every night
and wet one wholly in the dark range with light ink.

That is a rule a stylesheet cannot show: it reads plausibly whatever hexes it
holds. So `org-weather.spec.js` **parses every gradient stop out of
dashboard.html and works out the real ratio** against that sky's declared ink,
at 4.5:1 for both lines. It found three failures in my own palette on its first
run — overcast's sub-line at 4.26, night fog's at 4.32, drizzle's at 4.14 — all
three of them colours I had reasoned about and not measured. Prettying up a
gradient without re-checking it now fails CI.

### `Number(null)` IS 0 — THE SAME DEFECT, IN THE SAME FEATURE, AGAIN

`if (!wx || !Number.isFinite(Number(wx.temp))) return null` reads like a guard
and is not one: **`Number(null)` is 0 and `Number.isFinite(0)` is true**, so a
reading with no temperature rendered a confident **0°**. That is precisely the
bug the reporting side shipped — a missing weather code read as code 0 and
painted sunshine — and `lib/weather.js` has `strictNum` for it. The page runs
in a browser and cannot require that file, so it carries `wxcNum`, and the spec
**LIFTS AND RUNS** it against `null`, `undefined`, `''`, `false`, `true`, `NaN`
and a real `0` rather than reading it.

**Found by the render check on the first run of the new cases, not by review.**
A regex over the old guard passes on the broken version.

### THE FRONT DOOR MUST NOT BLOCK ON A THIRD PARTY

`orgWeatherFor` is **synchronous** — `/:org/api/config` is what the whole
dashboard waits on. It answers from memory and kicks a refresh behind the
reader. Measured end to end on a real boot: the first call returns
`weather: null`, the next one four seconds later returns the reading. That cost
is the right way round, and nothing is pre-warmed or fanned out.

### THE KILL SWITCH DEFAULTS ON, SO THE TEST IS `!== false`

Dan approved the treatment, so it ships on; what must not need a deploy is
turning it **off**, which is a checkbox in the admin grid.

**Every org already has a saved `toggles` object with no `weather` key in it**,
so a truthy read (`!!t.weather`) would ship the feature dark for all of them.
`orgWeatherEnabled` is the one predicate, and **both** payloads that carry
`toggles` — the admin listing and the org's own config route — are normalised
through it. A raw pass-through draws the box UNCHECKED while the card is very
much on, which is the inverted-eye bug this repo's sibling shipped once.

### Guards

`scripts/org-weather.spec.js` (**459 assertions, in CI**), which LIFTS AND RUNS
`lib/weather.js` and `wxcNum`, and computes the contrast of every gradient stop
and every tinted ground in both themes.

**Mutation-tested 34 ways, all failing by an assertion that names the defect.**
The card half: the kill switch read as truthy, the front door awaiting the
fetch, an unreadable reading overwriting a good one, an expired reading served,
the coords gate removed, the share route dropping the readout, either toggle
payload read raw, watertown's coords drifting from the reporting project's,
`orgMeta` defaulting to `{}` instead of null, the sky un-whitelisted, night
replacing the sky instead of riding on it, a wet night stopping, a night ramp
dropped, a gradient prettied up past the contrast bar, the card rendering with
no temperature, `strictNum` reverted, a real 0°F thrown away, night reaching
for `data-theme`, the card printed into the PDF, and the admin losing its
switch. The page half: the layer rendered in place instead of portalled, a ramp
ending in a hardcoded colour, a ground substituted for the page rather than
mixed into it, the app no longer lifted above the layer, the section-header
plate dropped, the settings-bar plate gone transparent, the sky printed into
the PDF, the body classes never cleaned up on unmount, the sky reading a
different object from the card, the ground swamping the theme's own colour, and
night losing its own ground.

**ONE MUTATION IS GENUINELY BENIGN AND IS RECORDED AS SUCH** rather than
reported as caught: darkening a single sky's ground tone. At the shipped 74%
mix the ground cannot travel far enough from the page for the ink to fail —
the worst tone either way measures **7.78:1** — so the per-tone contrast loop
cannot fail on its own. It is coupled to the mix percentage, which has its own
bounded assertion, and at 30% light theme lands at **2.10:1**. Written into the
spec beside the loop, or the next person reads it as vetting each tone.

**Twenty-five `ci-check-render.js` cases**, because none of this is visible in
source — the CSS reads plausibly whichever sky it paints, a card in the wrong
half of the toolbar is the same markup, and a sky painted OVER the dashboard
still leaves every selector matching. They key on the **computed**
`background-image`, so a night class that loses the cascade fails
(`rgb(19, 26, 34)` is the night rain ramp; daylight rain starts `rgb(47, 58, 69)`).
**Browser-mutation-tested twelve ways, each failing exactly the case that names
it**: the night card ramp losing the cascade, the particle layer never mounted,
the card removed, the card moved to the controls side, the look-ahead dropped
from the tooltip, the app not lifted above the layer, the layer rendered in
place, the ground substituted rather than mixed, the page night ramp dropped,
the settings-bar plate removed, the body classes never applied, and a page with
no reading painting a sky anyway.

### "I BETTER SEE SNOW AND RAIN" — and on the page you could not (2026-09-20)

Dan, the moment the page treatment merged. Fair, and it was worse than it
looked: the particles were lifted straight off the CARD, whose background is a
dark saturated ramp, onto a page whose ground is a light tint of the theme
colour. **White-on-near-white.** Measured over the ground band, before and
after, as strength (mean delta where the weather touches) over share of the
band:

| | as merged | with both edges |
|---|---|---|
| rain | 6.5 / 3.10% | **17.7 / 9.93%** |
| snow | 13.4 / **0.04%** | **19.5 / 0.21%** |
| drizzle | 19.7 / **0.03%** | **13.1 / 9.30%** |
| storm | 7.5 / 0.41% | **15.3 / 9.93%** |

**EVERY PARTICLE NOW CARRIES A LIGHT EDGE AND A DARK ONE.** It has to read on
the dark sky band at the top of the viewport and on the light ground below it,
in either theme, so each rain streak is drawn twice — a light line and a slate
one beside it, which is also what rain actually looks like. **A flake stays
white**, so its second edge is a `drop-shadow` instead: invisible against the
dark band, and the only thing separating it from the light ground.

**THE CARD IS UNTOUCHED.** Its particles were never the problem — they were
designed against the right background, and the two surfaces have had separate
classes (`.wxc-fx` / `.wx-fx`) since the page treatment shipped.

*Generalise it: a treatment that works on one surface is not a treatment, it is
a treatment tuned to that surface's background. The ground problem, one layer
down from where it was already recorded.*

### THE VISIBILITY CHECK TOOK FOUR TRIES, and three of them passed on the bug

`loadWet` screenshots the ground band with the particles shown and hidden and
decodes both to pixels. Every earlier version of it was wrong, and **not one of
them was caught by review** — each was found by running it against the merged
build and watching it pass:

1. **It compared the two PNGs as FILES and asked whether they differed.** An
   inequality where a magnitude was meant — a change nobody can perceive still
   moves the bytes. Third time in this feature.
2. **Then `peak >= 12`**, which passes the merged build for rain and snow, i.e.
   would not have caught the thing it was written for.
3. **Then a 48px gutter strip**, on which snow swung from a peak of 60 to 21
   between two runs of the SAME build — flakes are sparse and drift, so which
   ones were inside the strip when the shutter fell decided the answer. *A
   flaky assertion is not a guard.*
4. **And the band was pinned to the foot of the viewport**, which was open
   ground in my probe's fixture and solid cards in the harness's — so the two
   disagreed about the same build, and I calibrated somewhere the guard does
   not run.

What it measures now is **STRENGTH, not peak**: the mean delta over the pixels
the weather touches. The brightest single pixel swung 48→155 across three runs
of one build; strength moves by about one unit (rain 17.7 / 18.9 / 16.8). The
band is everything below 36% of the viewport — **below 30% matters**, because
that is where every ramp settles into the ground, and including the sky band
scores a particle that reads beautifully on the dark top and vanishes on the
ground, which is the whole bug.

**BOTH FLOORS CARRY REAL CASES**, which is worth saying because usually one is
decoration: strength catches merged rain and storm, and share catches merged
snow and drizzle — merged drizzle has a perfectly healthy strength of 19.7 off
a handful of pixels covering 0.03% of the band, which is the single-bright-spot
case the share floor exists for, turning up in real data rather than in theory.

**The PNG decoder is thirty lines and has no dependency** — a PNG is
zlib-compressed scanlines and zlib ships with node. Round-tripped against an
image built byte by byte before being trusted. Without pixels this check could
only ever say the picture changed, which is version 1 above.

### THE RAIN CASE IS BELT-AND-BRACES, and its mutations say so

Rain got the dark edge AND an opacity lift, and **either alone is enough**: at
the merged opacity with the new edge it passes, and at the new opacity without
the edge it passes. Only the merged build, which has neither, fails. So no
single mutation fails `the rain is actually visible on the page` — the same
shape the reporting project records for its PDF filter gate and scoper.

Removing the shared streak's dark edge fails **drizzle** rather than rain,
because one rule serves `wx-drizzle`, `wx-rain` and `wx-storm` and drizzle is
deliberately the faintest, so it crosses the floor first. Caught, and by the
most sensitive of the three rather than the one it is named for — recorded
rather than dressed up as a clean hit.

### TWO OF MY OWN NEW GUARDS WERE BLIND, and mutation is what showed both

Neither was found by review — both passed on correct code, read convincingly,
and survived the mutation they were written for:

- **A HIT TEST CANNOT SEE A LAYER PAINTING OVER THE PAGE.** `.wx-layer` is
  `pointer-events: none`, and `document.elementFromPoint` **honours that**, so
  it can never return the layer — the assertion reported `page` on the build
  where the sky covers everything. My own comment beside it said *"only a hit
  test can tell"*, which was exactly backwards. It computes the paint order
  from the **computed** styles instead: the layer is positioned at z-index 0,
  so the app has to be positioned AND higher, and on a tie the layer wins for
  being appended after it. Still a browser check rather than a source one — it
  fails when the rule is present but no longer matches.
- **`ground !== pageBg` IS NOT "the ground is a tint".** A ground hardcoded to a
  light grey differs from a dark page too, which is the whole bug. The stamp
  measures **luminance distance** now: a different colour, but within 0.22 of
  the page in whichever theme the viewer picked. The dark-theme case went from
  passing on the substitution to failing by name.

*Generalise it: a guard written for a mechanism has to be tested against that
mechanism's own defences, and an inequality is rarely the claim you mean.*

**AND ONE MUTATION DIED INSTEAD OF FAILING.** Dropping `ReactDOM.createPortal(`
leaves its `, document.body);` tail behind — a SyntaxError, so the page never
rendered and three unrelated cases failed while the portal case never ran. The
form somebody would actually write closes the parenthesis too, and that fails
by name. Nth instance in these two projects.

The fixture deliberately carries **no** `weather` key by default — an org with
no coordinates is the common case and the honest baseline — so each case opts
in, and `wx: null` is checked with `!== undefined` rather than truthiness
because null is a real case.

### NOT DONE

- **The look-ahead is on the TOOLTIP, not on the card.** *"Rain arrives Sunday
  — 90%"* is the one line a parks department acts on and it does not fit 206px.
  Dan was asked whether he wanted a hover and said "merge it" without picking,
  so it rides the native `title` — no new surface, nothing lost.
- **No city name.** Open-Meteo returns no place name and the org's own
  `displayName` is *"Watertown Recreation"*; deriving a city from it is a guess.
  The org record already carries `city` and `state`, so this is one line the day
  it is wanted.
- **Imperial units, hardcoded.** Every org here is in the US.
- **THE CARDS THEMSELVES ARE NOT TRANSLUCENT.** The sky shows in the gutters,
  the gaps and below the fold; a widget stays opaque. 48 translucent cards over
  a gradient is a different, much riskier change — every figure on this page
  would then be sitting on a colour that moves with the weather.
- **An org with no city on file still gets no sky**, which is the designed
  outcome rather than a gap: `city` and `state` are optional on Add Org, and the
  wrong city's sky is worse than none. The fix is typing a city, and the boot
  log names every org in that state.
- **`POST /admin/api/orgs/:slug/toggles` still accepts any key** and writes a
  flag nothing reads — pre-existing, not touched here, and the same hole the
  reporting project closed on its own flags route.

## THE ALLOWANCE IS COUNTED IN SEGMENTS, AND A MESSAGE IS TWO OF THEM (2026-09-17)

Hannah, relaying Irvine: *"Irvine is asking to receive notification before
exceeding the 10,000-message monthly allowance, and any usage resulting in
additional charges should require City authorization. Is this currently
possible to setup in the system?"* Then Dan: *"we want to sent a notification
option on BOTH the total segments and the cost… we'll need an 'Average segments
per SMS' somewhere and options to configure both."*

### 1.99 SEGMENTS PER MESSAGE — so "10,000" is about 5,000

Measured over every SMS on the platform: **17,850 messages, 35,604 segments,
mean 1.9946, and nothing above 3.** The distribution is 20% one-segment, 60%
two, 20% three.

| | |
|---|---|
| 10,000 segments | **≈ 5,013 real messages** |
| orgs that have ever sent an SMS | 22 |
| ratio across all 22 | min 1.000 · median 2.000 · max 2.568 |
| ratio for the orgs sending ≥500 | **min 1.661 · median 2.222 · max 2.568** |

**AND `$300` OF CREDIT IS EXACTLY 10,000 SEGMENTS AT 3¢.** Irvine's sandbox
carries $300 added and zero usage, which is the arithmetic of somebody reading
"10,000 included messages" as 10,000 × 3¢. If that is what happened, Irvine's
allowance is spent at roughly **4,500–5,000 of their own messages** — half what
the contract reads like. That is an inference from one number and it needs
confirming with whoever seeded the credits; it is also the whole reason the
tile prints the conversion rather than leaving it to be worked out.

**THE ADMIN FIELD SAYS "Rate per Message (cents)" AND BILLS PER SEGMENT.**
`organization_sms_config.rate_cents` is **3 on all 175 orgs**, one config row
each, charged per segment — verified 3.0000 exactly on all 389 sends across
Watertown and West Haven, zero exceptions. Platform-wide **33 of 17,850 rows**
(+188¢ total) have `cost_cents <> 3 × segments`; 0.18% and not chased.

### WHAT REC CANNOT DO TODAY, and which half is ours

Three separate gaps, and only one of them is a dashboard job:

| Irvine's ask | state |
|---|---|
| know the allowance | **nothing stores it.** `organization_sms_config` is numbers, service ids, campaign ids and `rate_cents` — no included-messages column anywhere |
| notify before exceeding | **built here** |
| require authorization before overage | **product's.** Credits hitting zero does not stop sending, it starts billing — Dan's call, deliberate. A gate is a block in the send path, which a dashboard cannot do |

### A CREDIT IS SPENT BY AN ADMIN, NOT BY THE SYSTEM — and I got this wrong twice

Dan: *"transactional sms messages such as reminders from programs don't use
credits only. Only intentional SMS sent messages by admins"*, then *"SYSTEM
sent transaction messages don't cost a credit, but any ADMIN sent ones do."*

I read `message.type` as the discriminator and reported the ledger as a
possible **billing bug**, because Watertown's ledger charges 265
`type='transaction'` sends. **It is not a bug.** `type` is the message's
CATEGORY — transactional vs marketing content, which is a compliance
distinction — and says nothing about who pressed send. **All 267 of Watertown's
SMS sends carry a named sender** (8 staff), zero system-sent. On the sender
test every charged row is correct.

*Generalise it: when a rule names a word that is also a column value, check the
column actually encodes the rule before calling anything a bug.* The likely
reason the two sources tie to the cent is that **system reminders never reach
`message` at all** — that table holds admin-composed sends — which is inference
from zero system rows in Watertown's whole history, not confirmed.

**THE LEDGER AND THE FEED AGREE EXACTLY**, which is what makes either usable:

| | card 21913 SMS sends | cost | `sms_usage` rows | ledger |
|---|---|---|---|---|
| Watertown | 267 | $205.89 | **267** | **−$205.89** |
| West Haven | 122 | $264.33 | **122** | **−$264.33** |

`organization_credit_transaction` is `addition` (+) and `sms_usage` (−) and has
**no stored balance** — the balance is their sum, so anything showing one
computes it. 1,681 rows across 176 orgs since 2026-03-06.

### THE TWO TILES, AND WHY "SEGMENTS" HAD TO BE RENAMED

`Segments Used` already meant **saved audiences** on this card. The allowance is
counted in **carrier segments**. Two tiles reading "Segments" is a number
nobody can act on, so the audience tile is **`Audience Segments`** and the new
one is **`SMS Segments`**.

- **`msgAvgSegments` divides by RECIPIENTS, not sends.** A campaign to 1,600
  people is 1,600 texts; per-send it would report the whole campaign's segment
  count as if one person got it. The render fixture makes the two 1.18 against
  33.50 so they cannot be confused.
- **NULL when the window holds no SMS — never 1.** "No texts" and "one segment
  each" are different facts, and the second makes an allowance look twice as
  roomy as it is.
- **No allowance configured is `null`, never 0%.** A zero allowance would put
  every org permanently over on the day this shipped.

### THE BUCKET IS ONE-TIME AND ALL-TIME — a correction, twice over

Dan: *"bucket does not refill. an org gets 10,000 or 15,000 when they signup
with rec. once that's gone, they pay for it… It's the all time we want to alert
on."*

**I shipped the monthly model first and it was wrong in both halves.** Hannah's
relay said *"10,000-message monthly allowance"* and I built a monthly window
and a monthly alert marker on it. What it actually is: a **one-time bucket
granted at signup**, consumed cumulatively, never refilled, and billed per
segment once gone.

**Watertown is the case that shows the cost of getting it wrong.** 6,863
segments all time against a 15,000 bucket is **46% gone**; the same tile on a
This-Month view holds **285**, which against 15,000 reads **1.9%** — an org
that looks untouched and is actually halfway through. So:

- **The tile shows BOTH**, which is what Dan asked for: the big number follows
  the date picker (that is the burn rate, and every other tile on the card
  follows it), and the line beneath is the **all-time position against the
  bucket** — `6,863 of 15,000 used all time (46%)`, and past it `— billed from
  here`.
- **The percentage is taken from all-time, never the window.** The mutation
  that reverts it fails by name.
- **A BUCKET IS A POSITION, NOT A FLOW**, which is the LTV rule from the
  sibling repo applied one surface over: it does not move when the toolbar
  does, and the tile says which window each number came from.
- **The alert evaluates every segment the org has ever sent** — the probe sends
  **no date bounds at all**, so the card's `[[ ]]` blocks drop out and it
  reports the whole account. A wide literal start would silently truncate the
  bucket for an org that predates it.
- **It fires ONCE, and the marker is no longer keyed by month.** A bucket
  crossed in September is still crossed in October; re-arming monthly would
  announce the same exhausted bucket every month until somebody filtered the
  sender.

**`used` is NULL, never 0, while the all-time feed is in flight.** It is a
second fetch, so there is a real window where the number is unknown — and a 0
there claims an untouched bucket, which is the confident-zero failure this repo
keeps recording. The tile says *"checking all-time use…"* instead.

### AN ALLOWANCE THAT DOES NOT SURVIVE A DEPLOY IS WORSE THAN NONE

Caught within minutes of the feature going live, in the production log, on the
first org anybody configured:

```
[orgs] sms thresholds for watertown: limit=15000 notifyAt=6000 spend=20000 (static org — not persisted)
```

The thresholds were written onto the ORGS entry and saved through
`saveDynamicOrgs()`, **which only writes the orgs that came from the store**.
Watertown is in the `ORGS` literal, so its allowance lived in one process's
memory: the save returned ok, the tile showed `6,863 of 15,000 used all time
(46%)`, and the next deploy would have switched the alert off with **nothing on
screen to say so**. A contract term that silently unsets itself is worse than a
field that refuses to save.

They persist in **`sms-thresholds.json`, keyed by slug**, read back OVER the org
record — which also deletes the static/dynamic distinction from this path
entirely, rather than making one more thing depend on it. `persisted: true`
unconditionally now, because it is.

**Proven by restarting the server, not by reading the diff**: save on the static
org → the file on disk → kill → boot → the values come back. The same test
against the old code is what the `[source]` assertions could never have shown.

### `defaultEmail` HAD THE IDENTICAL GAP — CLOSED (2026-09-17)

Recorded here as still open hours earlier; Dan: *"fix the defaultEmail
persistence gap too."* Same shape, same fix, and the fields are not
independent — **`defaultEmail` is the address the SMS alert is sent to** when
the org has set no alert address of its own, so an allowance that survives a
deploy pointing at an address that does not is the same outage one field over.

`org-emails.json`, keyed by slug, read back over the org record through ONE
`orgDefaultEmail(org, slug)` that all three readers go through — the admin
grid, the org config route, and the alert recipient. `persisted: true`
unconditionally, and Add Org writes the store too, so a new org is durable by
the same one path rather than by happening to be dynamic.

**IT IS READ BY PRESENCE, NOT TRUTHINESS, AND THAT IS LOAD-BEARING TODAY.** A
CLEARED address is stored as `''`, and `store[slug] || org.defaultEmail` would
resurrect the address somebody just deleted — which is the one outcome a Clear
must never have. Not hypothetical: the route no longer calls
`saveDynamicOrgs()`, so for a **dynamic** org the old address stays on
`dashboard-orgs.json` forever while the store says `''`. Proven live rather
than argued — created an org with `old@spectown.example`, cleared it,
restarted, and on the fresh boot the org record on disk still read
`'old@spectown.example'` while both routes returned `''`.

**AND `smsAlertRecipient` WAS READING BOTH SIDES RAW OFF THE ORG RECORD**, found
while moving the second store rather than by looking for it. A fresh process has
nothing on the `ORGS` entry — `applySmsThresholds` only assigns it on a write —
so after a deploy the alert would have gone to the fallback address, or to
nobody, while both stores held the right one. It takes the slug and reads
through both stores now. *The bug only appears after a deploy, which is exactly
when the alert matters.*

**Two comments of mine tripped the widened guard**, both quoting the old log
line as the trap it was. Reworded rather than teaching the assertion to ignore
comments — keeping it dumb and literal is the more robust half. Nth instance
across these repos.

**And I hit the `pkill` self-match twice in one session**, the second time with
the needle in a LATER part of the same command line after assembling it at
runtime in the first. The rule is stronger than "assemble the needle": *neither
needle may appear anywhere in the command, and the sweep runs in its own call.*

Guards: `messaging-widgets.spec.js` 201 → **210 assertions**. The "no route
admits a loss" test is **file-wide now** rather than scoped to the SMS path —
there is no honest gap left for it to be refuted by. Mutation-tested six ways,
all failing by name: the route reverted to `saveDynamicOrgs()` (the bug as it
shipped), the store read by truthiness (Clear resurrects), one reader left on
the org record, `smsAlertRecipient` back to raw, the alert caller dropping the
slug, and Add Org not writing the store.

**Two files rather than one map of overrides, deliberately:** different routes,
different validators, and the thresholds file already holds live contract terms
— refactoring it the hour after it shipped buys tidiness and risks the alert.
A third per-org override is the point at which they should be generalised.

### ONE EMAIL PER PASS, NOT ONE PER THRESHOLD (2026-09-17)

Both alerts fired for Watertown within the hour and landed in Dan's inbox —
which is the feature proven end to end — and he read them back: *"maybe a bit
verbose but all good"*, then *"yes, fold them into one email when both fire"*.

**THE REDUNDANCY WAS THE DUPLICATION, NOT THE WORDING**, so nothing is cut. The
two emails carried the identical figures block and the identical two paragraphs
of explanation; the only part that genuinely differs per threshold is the line
saying where it was set. One email now, with one `Segment alert at` /
`Spend alert at` line per threshold **actually crossed** — naming one that has
not been crossed is a claim about a limit the reader never set.

**The subject leads with the number**, because that is what is readable in an
inbox list: `Watertown Recreation: 6,863 of 15,000 SMS segments used · $205.89
spent`. Each single-threshold subject is unchanged.

**`smsAlertEmail` IS PURE AND AT MODULE SCOPE**, so the spec RUNS it over all
three combinations rather than regexing a template literal — the defect worth
catching is a subject or a line naming the WRONG threshold, and a regex passes
on every one of those.

**EVERY DUE KIND IS MARKED BEFORE THE ONE SEND.** Marking them all first is what
stops the next pass re-announcing the half of a folded email that already
landed; the asymmetry is unchanged — a send that throws is one missed email, a
mark that never lands is the same email every hour for a month.

Guards: 210 → **225 assertions**. Mutation-tested six ways, all failing by
name: back to one email per threshold (the shape as it shipped), the subject
naming only segments when both fired, both "alert at" lines emitted regardless,
the mark moved after the send, only the first due kind marked, and the figures
block repeated per threshold.

**And one of my mutations did not reproduce the bug.** "Move the mark after the
send" first moved it after the COMPOSER, which leaves it textually before
`sendOrgEmail` — so it passed, and would have read as a hole. Rewritten to the
form somebody would actually write (inside the `if (to)` branch, after the
send), it fails by name. *A mutation that does not reproduce the bug has not
tested the guard.*

**A pre-existing assertion pinned `const isSeg`**, the line that used to follow
the mark — legitimately removed by the fold, so it broke with nothing about
marking having changed. It tests the ORDERING it was always about now.

### AND THE ABSENCE RULE CAUGHT MY OWN NEW FETCH

The all-time figure needs a second, unwindowed messaging pull. I gated it on a
bucket being configured — and **not** on the feed being servable, so at an org
whose messaging card has no public link it went and asked anyway: a 404 that
raises the dashboard's own failure banner **naming a report the org never asked
for**, which is the exact failure the `dataKey` gate was built for two days
earlier.

**`messaging · absent until the card has a public link` failed by counting the
fetches** — *"the feed was fetched 1 time(s) for a section the server cannot
serve"* — on a build where the section itself was correctly hidden. It now
reads `sectionFeedMissing('messaging', availableReports)`, the same one gate.

*Generalise it: a new fetch has to pass every gate the old ones pass, and "the
section is hidden" is not the same as "nothing asks for the feed".*

### Guards

`scripts/messaging-widgets.spec.js` 124 → **201 assertions**, lifting and
RUNNING `msgAvgSegments`, `msgSegmentUsage`, `normalizeSmsThresholds`,
`smsSegmentAlertPoint` and `smsAlertsDue` — every defect here is arithmetic
about a comparison and a regex passes on an inverted one. **Mutation-tested 12
ways, all 12 failing by name**: the alert firing only above the limit, the
default-to-allowance dropped, blank stored as 0, an absent key clearing the
stored value, the fired marker never written, every org probed, no-SMS reading
as 1 segment, the ratio computed per send, `over` losing its equality, the
`defaultEmail` whitelist bug reintroduced, both tiles called Segments, and the
thresholds published as `{}`.

**A pre-existing assertion pinned `normalizeOrgEmail(` at a literal count of
3** and broke the moment a fourth caller reused it correctly. Rewritten to the
claim it was always making — **one definition, several readers** — which is the
same brittleness as pinning the end of an array.

**And one of my own assertions passed vacuously first.** A rename left the
declaration as `THR` and the six usages as `T`, which silently resolved to an
unrelated earlier binding; the `length === 0` case passed against the wrong
object while the next one failed. *An assertion that reads a different object
than it names is not testing anything.*

**Five `ci-check-render.js` cases**, keyed on computed figures: 67 segments
(not 57 messages), `134% of the 50 allowance`, `1.18` (not 33.50), the two
numbers behind it, and the audience tile under its own name. The fixture's
allowance is set so the org is already OVER, because over is the state Irvine
cares about and the only one that exercises the tone.

**Verified on a real boot**, not only in source: store, read back off
`/api/config`, a partial save leaving the allowance alone, both refusals, 404
without a token, and the value on disk.

### NOT BUILT

- **The authorization gate.** Product's, in the send path.
- **No allowance entitlement.** It lives in a contract and now in an org field;
  nothing in Rec's own product knows about it.
- **No per-campaign forecast** — "this send will cost you 4,000 segments"
  before it goes out is the genuinely preventive version and needs the composer.

## CRM & MESSAGING, AND THE DELIVERY RATE THAT WAS RIGHT TO LOOK WRONG (2026-09-16)

Dan, with a Metabase gauge reading 5,304: *"lets add this as a widget on the
dashboard project"* — a count of SMS deliveries at West Haven. Then the shape:
*"This might need a whole new 'CRM/Messaging' section on the dashboard. Could
track total messages sent, SMS's, etc. Clicking into the section would take
them to their CRM portal in Rec"*, with Watertown's URL. Then, with screenshots
of the Segments and Messages pages: *"there's a whole bunch of stuff here,
segments, message counts, etc. email delivery rates (which are a bit sus)."*

Card **21913**, a new `messaging` report type, fourteen widgets, and a section
whose way out is Rec rather than a report.
https://rec.metabaseapp.com/question/21913

### THE RATES REALLY ARE SUS, AND IT IS A WEBHOOK RATHER THAN DELIVERABILITY

The most useful thing measured here. Email delivery, platform-wide by month, as
a share of sent:

| | delivered | bounced | no outcome |
|---|---|---|---|
| 2025-03 .. 2025-12 | **0.0%** | 0.0% | **100%** |
| 2026-01 | 0.2% | 0.0% | 99.8% |
| 2026-02 | 20.3% | 0.1% | 79.6% |
| 2026-03 | 91.5% | **13.2%** | 8.1% |
| 2026-04 onward | 96–98% | 1–2% | 1–3% |

**DELIVERY WEBHOOKS WERE NOT WIRED UNTIL 2026-02.** All 15,158 deliveries
before then carry `delivered_at` NULL *and* `bounced_at` NULL — not a failure,
an absence. So a lifetime rate reads **91.6%** and is a statement about our own
plumbing. West Haven's whole history is 93,906 delivered / 786 bounced /
**12,300 with no outcome recorded**, of 106,785 sent — 87.9% that nobody should
read as deliverability.

So the card ships the **three outcomes as separate columns** and the page
divides them, which is what makes the honest behaviour expressible:

- **`null`, never 0%, when a window records no outcome at all.** A 2025 window
  otherwise renders a confident deliverability catastrophe that never happened
  — the `memberships.last_used_at` trap wearing a percentage.
- **A REAL 0% still shows.** A window where everything bounced is an answer.
- **`No Outcome Recorded` is a DEFAULT tile, not an opt-in.** The rate is not
  believable without it, and an org that has to go and add a widget before the
  number beside it can be trusted has been told the wrong thing by default.

### THE RATE IS REC'S OWN FORMULA, AND THAT WAS MATCHED RATHER THAN CHOSEN

`delivered / sent`. West Haven's *"Last Chance to register for Zumba: Start
Monday"* reads **"Sent 1,664 · Delivered 98.4%"** on its own Rec message page,
and 1,637/1,664 = 98.38%.

Dividing by the rows that reached a **terminal** state gives 99.3% instead —
defensible, arguably better, and **0.9pp adrift of the page this section's own
header links to**. Two surfaces disagreeing about one send is worse than either
formula being imperfect, and this section exists partly to send people to that
page. The fixture separates the two by **27 points** so no mutation passes by
rounding.

### THERE IS NO OPEN TRACKING, AND THAT IS MEASURED

`first_opened_at` is NULL and `open_count` is 0 on **all 818,239 deliveries**,
both channels, every org. An open-rate tile would be a confident number over
nothing, and it is the first tile somebody will ask for — so the spec fails if
one appears and the card selects neither column. Clicks are real but thin
(1,280 of 800,412 email rows), so `Clicked` ships as a **count and never a
rate**.

### MARKETING AND TRANSACTIONAL ARE 2x2 WITH CHANNEL, AND THE SPLIT MATTERS

| | email | sms |
|---|---|---|
| marketing | 685,414 (44 orgs) | 1,221 (7 orgs) |
| transaction | 114,998 (88 orgs) | 16,604 (22 orgs) |

**86% of email volume is marketing; 94% of SMS volume is transactional.** The
section header opens `/marketing/messages`, so folding receipts and permit mail
into one "Messages Sent" headline would put a number seven times the CRM's own
beside a link to the CRM. Both are reported, labelled, and split on their own
donut. West Haven: 128 marketing sends against 266 transactional.

**SMS IS RARE AND THAT IS WORTH KNOWING BEFORE READING A ZERO**: 22 orgs have
ever sent one, against 92 for email, and SMS only exists at all from 2026-02.
A zero on this tile is usually a real zero.

### SMS COSTS MONEY AND EMAIL DOES NOT — correcting a note in the sibling repo

`message_delivery.cost_cents` is populated on **17,823 of 17,825 SMS rows**
($1,068.29 platform-wide) and on **zero** email rows. rental-report's CLAUDE.md
records it as *"NULL on all 45,347 SF deliveries"*, which is true of SF and
true of email everywhere, and reads as a statement about the column. It is a
statement about the channel.

### GRAIN IS THE MESSAGE, WHICH IS REC'S OWN GRAIN

One row per SEND — Subject, Type, Recipient Count, Sender, Send Time, exactly
the columns Rec's Messages list shows. So "Messages Sent" and "Recipients
Reached" are two tiles rather than one ambiguous number: West Haven's 394 sends
reached 106,785 people, and a campaign to 1,664 is one message.

- **`LEFT JOIN`, not inner.** Three messages platform-wide have no delivery row
  at all (an audience that resolved to nobody). Dropping them makes the send
  count disagree with Rec's own list.
- **Driven FROM the windowed message set INTO
  `message_delivery_message_id_index`**, so the 818k-row delivery table is
  never scanned for one org. apex over three months: **524 sends, 159,009
  recipients, 534ms**.
- **Dated in the ORG's own timezone.** `config.general.primaryTimezone` is
  populated on all 93 orgs that have ever sent a message; Metabase renders
  Pacific, so without the conversion an Eastern org's 1am send lands on the
  previous DAY and the daily line is wrong at every midnight. The window bounds
  are converted to instants rather than the column being wrapped.

### SEGMENT NAMES TRAVEL AS A JSON ARRAY, BECAUSE HUMANS NAME THEM

`message.to -> segmentIds` is on 481 messages, and it is the only record of
which segment a send used — the audience is resolved to user ids at send time.
Names come back as `JSONB_AGG`, never `STRING_AGG`: Watertown has a segment
called *"Spring Pickleball Intermediate League Captains"*, and the first one
somebody names *"Adults, Seniors"* would be split into two segments that do not
exist, both of which look entirely real.

`msgSegmentNames` reads **both shapes** — Metabase hands a jsonb column back
already parsed or as text depending on what it infers — and anything else
yields nothing rather than a guess.

**SEGMENTS ARE RANKED BY SENDS, NOT RECIPIENTS**, which is deliberately the
same thing Rec's own Segments page counts under *Usage*. It also sidesteps a
real ambiguity: a send targeting two segments reaches ONE audience, and adding
its recipients to both totals more people than the org has.

**SEGMENT SIZE IS NOT REPRODUCIBLE AND IS NOT FAKED.** `segment` stores
criteria (`filters` / `globalOperator` / `notificationPreferences`) and no
size; Rec computes the Size column by evaluating them. So the tile is named
**Segments Used** — a fact this feed can establish — rather than *Segments*,
which would be a claim about the org's library.

### THE WAY OUT IS REC, AND THE PATH IS WHITELISTED

`SECTION_REPORT_MAP` is deliberately **not** given a `messaging` entry: that
map means *"this section has a report on the reporting project"*, and it drives
both the View Report link and the per-org visibility filter. There is no
messaging report over there, so an entry would render a dead link and hang the
section's visibility off a report nobody serves.

`recPageUrl(orgId, pageName)` is **whitelisted by name** (`REC_PAGES`), not a
free path — the org uuid is ours and the path is ours, and handing an arbitrary
string to a URL builder is how a typo becomes a confident 404 on somebody
else's admin. The lesson is `recPage()`'s, from the sibling repo. No uuid, no
link.

### ABSENT UNTIL THE CARD HAS A PUBLIC LINK — and NOT FETCHED either

`MESSAGING_UUID` empty means `SHARED_UUIDS` omits the key, so
`availableReports` has no entry — the same absence rule as the five live cards.

**LINKED AND FLIPPED 2026-09-16, so that is the SHAPE and no longer the state.**
Both halves were read back off the live card rather than assumed: exactly
**three** parameters — `org_id` `string/=`, both dates `date/single` — with no
`string/=` duplicate set to re-save away, which is what a card that is CREATED
rather than re-saved on top of an earlier push gets. The flip cost nothing
because it happened before the link existed: a card with no public link has no
consumers and therefore no outage window to pay for.

**Signed off cache-independently through the public endpoint** with the app's
own parameter shape (the registered parameter **ids**, not just the slugs) —
west-haven unwindowed, **4.8s**: 395 sends · 106,786 recipients · **5,304
SMS** · 93,907 delivered · 786 bounced · 12,300 with no outcome recorded ·
$264.33 of SMS cost · 138 rows carrying a segment, spanning
2025-11-25..2026-09-16. **The 5,304 reproduces Dan's own Metabase gauge to the
message**, which is the correctness sign-off. It reads one send and one
recipient above a literal run taken minutes earlier — that is the OPEN WINDOW,
not a discrepancy (the Clarksville rule).

**AND `Segments` COMES BACK AS A JSON STRING, not an array.** The live sample
row carries `"[\"Kids Track & Field\"]"`, so the branch of `msgSegmentNames`
written to cope with Metabase handing a jsonb column back as text is **the one
that actually runs**. A reader written for the array alone would report every
send as untargeted, empty the Top Segments tile and read `Segments Used = 0` —
all of which look like an org that does not use segments. *A defensive branch
that turns out to be the live path is worth measuring rather than assuming
which way round it is.*

**The omit-when-unset shape STAYS** — it is what makes the next card safe to
merge before its link exists — but the spec now also asserts that THIS uuid
shipped: a real uuid, and not a copy of another card's, because a paste-over
draws another report's numbers under these labels and looks entirely plausible.
Both mutations fail by name.

**THE NEW HALF IS THAT IT GATES THE FETCH, NOT ONLY THE RENDER.** A section
config is read by the data effect, the comparison effect and the render; hiding
it in the third still fires a request from the first, which 404s and raises the
dashboard's own failure banner **naming a report the org never asked for** — a
louder version of the confident zero the absence rule exists to prevent. So the
gate is folded into **`dataKey`**, which all three already funnel through.

**One half of that gate is DEFENSIVE and is recorded as such**, because the
mutation testing said so: `availableReports` and `config` are set from one
response in one handler, so there is no observable state where config exists
and the map has not answered. The browser mutation that reads an empty map as
"present" **SURVIVED**. It stays — "they arrive together" is a property of one
fetch handler rather than a rule — but claiming the render check catches it
would be claiming a guard that is not doing the work.

### THE ORG'S DEFAULT EMAIL

Dan, in the same pass: *"add another field to the 'Add Org' section — the
'default' org email. We'll use this to send email notifications, summary emails,
etc to. And surface that email in the dashboard settings... prefill that email
box with the email entered at the time the org is created."*

- **ONE validator.** `normalizeOrgEmail` is read by the add route and the edit
  route; two copies is how a value is accepted by one and refused by the other,
  on a field whose whole job is to be already correct in a box somebody is
  about to press Send on.
- **EMPTY IS ALLOWED AND MEANS ABSENT.** Every org onboarded before the field
  existed has none, and the boxes it seeds fall back to their placeholder. A
  made-up default is an address somebody has to notice is wrong.
- **SEEDED, NEVER DRIVEN.** `useState(defaultEmail || '')` — a value somebody
  types straight over. An effect writing it back is the "my settings keep
  resetting" complaint the report-settings panel already earned once.
- **EDITABLE AFTER CREATION**, via `POST /admin/api/orgs/:slug/default-email`
  and an inline editor on each admin org card. A field only a brand-new org can
  carry does nothing for the twenty-nine already here.
- **Stored on the ORG, not in `dashboardConfigs`** — Reset Dashboard must not
  wipe the address the platform mails. Only `_dynamic` orgs persist, and the
  route says so in its response rather than letting a Save quietly not survive
  a deploy.

### Guards

`scripts/messaging-widgets.spec.js` (**124 assertions, in CI**), which LIFTS
AND RUNS every helper and every widget transform — a regex over a rate passes
on an inverted comparison, and every defect this section can have is arithmetic
about counts. **Mutation-tested 21 ways, all 21 failing by an assertion that
names the defect**: the rate divided by terminal outcomes, the no-outcome gate
removed, segment names split on commas, the string shape of `Segments` dropped,
the availability gate inverted, `dataKey` back on `config.sections`, a fetch
effect back on `config.sections`, `recPageUrl` accepting a free path,
`messaging` added to `SECTION_REPORT_MAP`, a tile reducing the rows itself,
`No Outcome Recorded` dropped from the defaults, the digest box driven instead
of seeded, `SHARED_UUIDS` carrying an empty key, `normalizeOrgEmail` accepting
anything, the edit route growing its own copy of the email rule, the default
email stored in `dashboardConfigs`, the card losing its trailing `ORDER BY`,
the card joining segment names with a comma, the card selecting an
open-tracking column, the card dropping the timezone conversion, and the Add
Org field removed.

**One of my own assertions was satisfied by different code and mutation is what
showed it.** `/AT TIME ZONE c\.tz/` file-wide also matches the two `[[ ]]`
bounds, so stripping the conversion from the emitted date SURVIVED. It is
scoped to `AS sent_local` now, with a second assertion for the bounds.

**Twenty `ci-check-render.js` cases**, every one keyed on a computed figure or
an absence — "a messaging tile rendered" passes on a tile reading the wrong
field, on a rate over the wrong denominator, and on a segment list that split a
name in half. Browser mutations verified to fail exactly what they name: the
Rec link dropped (three cases), `data-widget-id` dropped (which is also how the
absence cases stop being vacuous), and the rate on the terminal denominator
(`reads "97.9%", wanted "70.4%"`).

**`data-widget-id` IS NEW ON THE WIDGET CARD, and adding it fixed a live
vacuity.** Every `absent:` case naming one — including the pre-existing
retired-support case — was matching a selector that could never match, which
passes on any page including one still rendering the thing it claims is gone.

**THE FIRST RUN FAILED ALL SIXTEEN VALUE CASES ON A PERFECTLY GOOD SECTION.**
The page is loaded ONCE and the live cases above end with the Edit modal open
over a lighter availability map, so every case below ran against somebody
else's page state and reported *"no widget labelled …"*. The first messaging
case reloads onto the base config. *A render case inherits whatever the case
before it left on screen.*

**AND ONE CASE COULD NEVER HAVE PASSED.** *"a segment name with a comma
survives whole"* asserted on `document.body.innerText` — the bar chart is a
Chart.js **CANVAS**, so its labels are pixels. It is keyed on `Segments Used`
reading **2** instead of 3 now, which discriminates just as well, and the name
itself is pinned in the spec where `msgBySegment` is actually run.

### NOT BUILT

- **No segment SIZE or a segment library view.** Rec computes Size by
  evaluating criteria; reproducing it means reimplementing the criteria engine.
- **No open rate, ever, on this data.** See above.
- **No click rate.** 1,280 of 800,412 email rows have a click, concentrated in
  whichever orgs have link tracking on — a rate would read 0.2% for everybody
  and mean nothing.
- **No per-message drill-through to Rec.** The section header opens the
  Messages list; a row-level link wants `/marketing/messages/<id>`, which is
  not verified from here and this repo does not print unconfirmed links.

## THE IMAGE UPLOAD ROUTE WAS UNREACHABLE, AND IT READ PERFECTLY (2026-09-11)

Dan, pasting a screenshot into Project Updates:

```
Image upload failed: Unexpected token '<', "<!DOCTYPE "... is not valid JSON
```

**THE UPLOAD ROUTE WAS NEVER THE PROBLEM.** `/admin/api/announcements/image`
declares its own `express.json({ limit: '8mb' })`, validates the data URL,
guards at 4MB and answers every path in JSON. It never ran.

`server.js:33` carried a **global `app.use(express.json())` on Express's DEFAULT
100kb limit**, registered ~930 lines ABOVE that route. **Express matches
middleware in registration order**, so the global parser took every POST first.
A pasted screenshot as a base64 data URL clears 100kb easily (base64 inflates
~33%), so it threw `PayloadTooLargeError`, **Express's default error handler
answered in HTML**, and the client's `r.json()` choked on `<!DOCTYPE` — telling
the reader their JSON was malformed when the truth was the body was too big.

**The route's own limit, its 4MB guard and its tidy 413 were all DEAD CODE** —
unreachable, and they read correctly, which is why nothing looked wrong.

**FOURTH INSTANCE OF THIS TRAP ACROSS THE TWO REPOS**: the campmap beacon route
registered below the generic `/:org/:report/api/log`, the saved-views
`Cache-Control` middleware registered below its own routes, and the render
check's `/api/data` stub matching before the specific one. *A route that reads
correctly can be unreachable because of where it sits.*

### THE FIX IS TWO HALVES AND THEY GUARD DIFFERENT THINGS

**1. The big parser is mounted PATH-SCOPED, BEFORE the global one.** The global
parser then no-ops because `req.body` is already set. **Raising the global limit
was the tempting one-liner and is wrong**: it widens the body a stranger can
post at *every* endpoint in order to fix one, and 100kb is the right default for
the other routes.

**2. An error handler that answers an `/api` path in JSON**, registered last —
an Express error handler only catches what is registered above it. Any unhandled
throw otherwise reaches a `r.json()` client as HTML and it dies inside its own
error path, one layer from the real problem. Same lesson as `reportFetchError`
in the sibling repo. Non-API paths keep Express's own handling, because an HTML
page is the right answer for an HTML surface.

**THE TWO CEILINGS ARE WHY THERE ARE TWO TEST CASES, and the first draft of the
spec could not tell them apart.** 6MB clears the 8mb parser and is refused by
the ROUTE's own 4MB guard — that proves the order fix made the guard reachable.
9MB dies in body-parser *before any route code runs*, which is the only case the
error handler can answer. My first draft used 6MB for both and the
handler-removed mutation therefore SURVIVED.

### `SKIP_PREWARM=1` exists so the server can be booted by a test

`app.listen` kicks `warmCache` five seconds in, which fans ~22 orgs at
**production** Metabase. A spec that spawns this app would do that on every CI
run — the self-inflicted-load trap the sibling repo records twice, where a sweep
run alongside other work invented card failures on cards nobody had touched.
Unset in production, so the default is unchanged.

### Guards

`scripts/announce-image-upload.spec.js` (**21 assertions, in CI**), and the
live half is the real guard: **no source assertion can see this**, because the
route reads correctly either way and what was wrong is where a line sits. It
boots the server and posts real bodies — a 1px PNG (or the whole spec passes on
a route that refuses everything), 600kb, 6MB and 9MB.

Mutation-tested three ways, each failing by name and each isolating one half:

| mutation | what fails |
|---|---|
| parser order reverted | the **600kb** case — the order fix is what makes a real paste work |
| error handler removed | only the **9MB** case — the handler is what makes a parser-level failure legible |
| **both** (the original state) | **7 assertions**, including *"a 600kb paste does NOT come back as an HTML error page — this is the bug exactly as Dan hit it"* |

**`node_modules` is empty in this sandbox** (CI installs; nothing here did), so
the live half died on `MODULE_NOT_FOUND` at `server.js:4` before asserting
anything — which reads as a broken server rather than a missing install.
`npm install` first, or the live half of any spec here proves nothing.

## "WHY ONLY THREE ORGS" — it was 22, and my own count was wrong (2026-09-11)

Dan, on the merge note: *"why only three orgs, make the new live widget config
live for everyone!"*

**IT WAS ALREADY LIVE FOR EVERY ORG THIS DASHBOARD SERVES, AND THAT IS 22, NOT
THREE.** I read the hardcoded `ORGS` map in `server.js` (watertown, niagarafalls,
torrance) and reported it as the platform. The other nineteen are **dynamic
orgs**, loaded from `dashboard-orgs.json` at boot and invisible in the source.
Measured rather than re-read: `GET /health` on production answers
`{"status":"ok","orgs":22}`, and `GET /watertown/api/config` returns
`availableReports` carrying `happening-today: true` — so the card was on for all
22 the moment the merge deployed.

**Generalise it: the hardcoded map is not the org list.** Every count taken from
`server.js` alone under-reports this dashboard by a factor of seven, and
`/health` is the cheap, ungated way to get the real one.

### THE GATE THE FILE WARNED ABOUT, IN THE ONE PLACE IT WAS WARNING ABOUT

Checking "is it really on for everyone" found one that was not derived.
`liveHasEnrollments`'s own comment says:

> *"spelling out a four-way test at each gate is how one of them ends up missing
> a card and a widget silently never renders for the orgs that only have the new
> ones"*

...and the **Edit Dashboard** gate was spelled out by hand as

```js
liveHasEnrollments(a) || liveHasCheckins(a) || liveHasFacility(a)
```

— **missing `liveHasHappening`**, from the day that card shipped. The RENDER
side was always fine (`liveCardsResolved(...).some(Boolean)`, derived from
`LIVE_CARDS`); only the editor's gate was hand-written.

**It is benign TODAY and the reason is worth stating**, because it is the thing
that stops being true: all five feeds arrive together out of `SHARED_UUIDS`, so
no org can hold Happening Today without also holding the other three. The day
one card is org-specific, an org holding only that card would have had the
widget **rendering on its dashboard with no way to switch it off** — a control
that does not exist for a card that does.

`liveAnyCard(available)` is `LIVE_CARDS.some(c => c.has(available))`. A sixth
card is covered on the day it is added, with nothing to remember.

**AND THE SPEC WAS PINNING THE BUG.** Two assertions required the three helpers
named by hand, so the fix FAILED the spec until their intent was corrected —
the same shape as `report-settings.spec.js` requiring `disabled` on the gear.

### What is NOT fixed here: 22 is not 29

The reporting project serves ~29 orgs and this dashboard serves 22, so up to
seven organisations have no dashboard at all — which is a different problem from
the widget, and is exactly the item pinned in the sibling repo's notes:
*"creating an org should create it in BOTH projects."* **The seven cannot be
enumerated from a sandbox**: `/admin/api/orgs` is admin-gated, and `/:org`
deliberately 404s for a real org and an unknown one alike (no existence leak), so
there is no ungated way to diff the two lists. Ask an admin for the list, or add
the reverse of `reconcileWithReporting` — it already resolves identity by
`orgId`, which is the stable key; what is missing is the IMPORT.

Guards: `live-widgets.spec.js` 622 → **634 assertions**, lifting and RUNNING
`liveAnyCard` — a regex over it passes on an inverted test, and the case that
discriminates is an org holding exactly ONE card. Mutation-tested both ways, each
failing by name: the hand-spelled three-way gate restored (the bug as it
shipped), and `liveAnyCard` reading one helper instead of the registry.

## HAPPENING TODAY — the fifth live card, and the first that is a LIST (2026-09-11)

Dan: *"create a new 'Happening Today' double height live widget on the left
side. Scope for this is all programs happening at that org today. Columns are:
Time frame / Location/site / Section Name / Enrollment (11/20 as an example) /
Clickable link directly to Rec admin ... As the program becomes 'live' and
happening in their time zone, it highlights in green, once the time passes, it
bumps off the top of the list and the list scrolls up ... If there are no
sections, it should say, "No programs happening today - enjoy the time off!"*

Card **21814**, mirror `sql/happening-today.sql`, page `HappeningToday` in
`public/dashboard.html`.
https://rec.metabaseapp.com/question/21814

**IT IS ABSENT UNTIL DAN CREATES THE PUBLIC LINK.** `HAPPENING_TODAY_UUID` ships
empty, so the `SHARED_UUIDS` key is omitted, the data route 404s and the widget
hides — the same absence rule as its four siblings, and it matters more here
than anywhere else in this repo: **this is the only live card with a cheerful
empty state**, and *"enjoy the time off!"* over a feed that simply cannot answer
is the most confidently wrong thing this dashboard could print. Filling in that
one constant is the whole of the wiring.

### THE ORG'S CLOCK IS A COLUMN, and nothing on the page constructs a Date

Every other live card asks *"what landed today"*; this one asks *"is this
running RIGHT NOW"*, and the answer has to be identical on a wall screen in
Denver and a laptop in Boston. So the card ships **`Org Now`** — the org's own
wall clock at the moment the feed answered — beside `Starts At` and `Ends At`,
all three already converted, and the page compares three integers in one zone.

`new Date("2026-09-11T14:30:00")` is the **READER's** 14:30. It renders a
perfectly plausible time either way, so only a source assertion can see it:
`htMinutes` reads the string with a regex, and the spec lifts all six helpers
and fails if any of them contains `new Date(`.

**NO SECOND CLOCK IN THE PAGE, deliberately.** The feed re-stamps `Org Now`
every sixty seconds, which is the cadence the list would move at anyway — and a
page ticking its own clock would keep promoting rows while **Pause** was on,
which is exactly what Pause is for.

**AN END AT OR BEFORE THE START RAN PAST MIDNIGHT** and is clamped to the end of
the day. Comparing a `00:30` end against a `21:00` start marks an evening class
finished the moment it begins — the row greys and then vanishes while the hall
is full. A session with **no end at all** is treated as an instant, so it is
green on the poll it starts and gone on the next rather than sitting there for
the rest of the day.

**WITHOUT A CLOCK NOTHING IS FINISHED.** A feed that could not stamp `Org Now`
leaves every row `upcoming`, so the list stays whole. The safe direction is a
stale schedule, never a blank one that reads as a day off.

### THE CLOCK ON THE ROW IS THE SESSION'S LOCATION — not the org's

Dan, with the widget open beside the Rec page: *"lets fix the time thing,
should be in the time zone of the org."* The symptom was one hour, not three,
which is what said it was not the org zone at all.

**REC'S ADMIN RENDERS EACH SESSION IN ITS LOCATION'S TIMEZONE.** Proven twice
on live data rather than reasoned:

| session | raw | org zone (what shipped) | location zone | |
|---|---|---|---|---|
| 2026 Beach Volleyball | 11:00Z | 07:00–23:00 | **06:00–22:00** (Chicago) | Rec's own page, to the minute |
| Tiny Tots **(8:00am-11:00am)** | 15:00Z | 11:00–14:00 | **08:00–11:00** (LA) | the time is in the section's own NAME |

The second is the better proof because nobody planted it — and it also rules
out the tempting alternative that Rec renders in the VIEWER's browser zone,
which fits Beach Volleyball and fails Tiny Tots.

**THE DAY IS STILL ONE ZONE.** `win` stays on the org's, so "today" is one
window; per-location boundaries would let a row belong to two days at once.
Stated cost: a session at a location an hour behind, starting 23:30 local,
lands in tomorrow. Every real single-zone org is unaffected.

### THE STATE IS MINUTES FROM NOW, NOT A WALL CLOCK

Once the displayed clock is the location's and the window is the org's,
comparing them is comparing different zones. So the card ships `Starts In` /
`Ends In` as signed minutes against one absolute `NOW()`, and the page does
integer arithmetic: live is `Starts In <= 0 < Ends In`.

**It deleted a whole class of bug rather than adding one.** The past-midnight
clamp is gone — `ends_at` is a timestamptz, so a class running to 00:30 is
already later in absolute terms and only a wall clock ever made it look
earlier. `CEIL` on both ends, so a session thirty seconds out reads as a
minute away rather than as already running.

**WITHOUT THE MINUTES NOTHING IS FINISHED**, so a feed that cannot supply them
keeps every row. The safe direction is a stale schedule, never a blank one
that reads as a day off.

### THE ROW SAYS WHOSE CLOCK IT IS — but only when it is not the org's

The list is ordered by the INSTANT, so on a multi-zone org a 9:30a Chicago row
sits below a 10:00a Eastern one and looks out of order. `htZoneLabel` turns
the IANA name into a place (`America/Chicago` → `Chicago`) without
constructing a Date, and the row reads *"… · Chicago time"*. A marker on every
row would be noise, and on a single-zone org — every real one — there is none.

### THE ORG'S OWN `primaryTimezone` WINS — and it was three hours out live

Found signing the card off through the public link, before the widget was ever
opened. The four live cards resolve the zone with
`MODE() WITHIN GROUP (ORDER BY location.timezone)`, and for **City of Niagara
Falls** that is **America/Los_Angeles** — 17 Pacific locations against 13
Eastern and 4 Central, so a four-location plurality wins for a city in New York
State. Its 7am beach volleyball reported as **04:00** and the card returned
**15 rows on the Pacific day** instead of **16 on the Eastern one**.

`organization.config #>> '{general,primaryTimezone}'` is the org's own stated
answer — **America/New_York**, and populated on all 168 live orgs — so this
card prefers it, with the location mode as the fallback and `America/Chicago`
behind that. **It deliberately differs from its three siblings on this**, and
the reason is the difference in what the zone decides: they ask *"what landed
today"*, where it only moves a day boundary; this one decides whether a row is
**green**, so a wrong zone is visible on screen all day. Watertown and Torrance
agree either way, so this moves exactly one of the three dashboard orgs.

Worth carrying back: **the same disagreement is on 22 of 168 orgs** (already
recorded in the sibling repo for card 21649), so the other three live cards are
sitting on a day boundary that can be three hours out for those orgs. Not
changed here — that is a separate decision with its own sign-off.

### TWO EMPTY STATES, because they are two different days

Dan's line is verbatim for a day with **nothing on it**. A day whose programmes
have all **run** says *"That's a wrap — all N programs today have finished."*
Printing *"enjoy the time off"* at 9pm to a team that has just run forty
sessions reads as the card having lost them.

### THE SQL

- **NO DATE PARAMETERS MEANS NO TAG FLIP, EVER** — `org_id` is a text parameter
  and survives an API push unchanged, so this card can be corrected at any hour
  without taking the widget down. Same property all four siblings are built on.
- **The day is an instant range, never a wrapped column.**
  `starts_at >= t0 AND starts_at < t1` keeps the session index usable; the
  measurement is already recorded on `checkins-today.sql` and applies to
  `session` the same way.
- **THE SITE IS AGGREGATED, NEVER JOINED.** A session's reservation can occupy
  more than one court — **measured at apex today, MAX 4** — so joining
  `reservation_court` would multiply the session and every figure with it.
  `Site Count` ships beside the name and the row renders *"Lane 1, Lane 2 +1"*.
- **ENROLMENT IS READ AT THE SECTION'S OWN GRAIN.** A `per-session` section's
  bookings carry a `session_id`; every other mode enrols into the RUN and its
  bookings carry none. Reading one side only reports 0 for the other — measured
  at apex today, **25 of 101** sessions are per-session, so either mistake is a
  quarter of the list or three quarters of it.
- **Cancelled and unpublished sessions are RETURNED AND MARKED, not dropped.** A
  cancelled meeting still holds the room and an unpublished section still has
  staff turning up; excluded is never hidden. apex today: 3 cancelled, 40 on
  unpublished sections.
- **`sec.publish_at`, not `published_at`** — the column that does not exist, and
  the only reason it was caught is that the **whole final SELECT was run with
  literals inside a counting wrapper** rather than a summary probe around the
  CTEs. That is the card-21682 lesson applied: *prove the exact text you are
  saving.* apex: **101 rows in 11.3s**, 65 with a site, 0 with no capacity,
  `Org Now` `2026-09-11T09:47:45` in America/Denver.
- **Sessions today elsewhere the same afternoon:** smyrna 18 (New York),
  el-segundo 15 (Los Angeles), watertown 1 (New York). So Dan's *"50 programs"*
  is mid-band and **a near-empty day is the common case outside apex**, which is
  what the empty state is for.

**NULL capacity is unlimited, not zero.** The cell reads `4/—`; `11/0` is a
number that cannot be true, and `Number(undefined)` is how it gets printed.

### THE LAYOUT IS THE ORDER, and the list must not size its own row

Dan, on his sketch: *"programs live and facility bookings drop to a row
underneath. Check ins and live enrollment are the same height, half of happening
today."* On the four-column grid that falls straight out of source order — the
tall card takes columns 1-2 for two rows, the next two fill 3-4, and the last
two wrap — so the order of the five cards in `LiveSection` is **not cosmetic**.

- **`.live-grid { grid-auto-rows: 1fr; }`** is what makes the two on the right
  the same height as each other rather than each sizing to its own content.
  Scoped to the live grid; `.widget-grid` is every report section on the page
  and equal rows there would resize widgets nobody touched.
- **`.ht-list { flex: 1 1 0; min-height: 0; overflow-y: auto; }`** — and
  `overflow-y: auto` ALONE IS NOT THE FIX. An auto grid row sizes to its
  content, so a hundred sessions would grow the row and there would be nothing
  left over to scroll. The zero flex basis is what drops the list out of the
  card's own intrinsic height.
- **Below four columns the span means nothing** — there is no column beside it
  for the two half-height cards to stack in — so the tall card becomes an
  ordinary one and the rows size to content again.
- **Finished rows LEAVE.** The list is already ordered by start time, so
  dropping them off the top IS the "scrolls up"; there is nothing to animate.

### A CARD WITH NOTHING TO ANNOUNCE GETS NO MUTE BOX

`LiveCardHeader`'s `sound` is optional now. Nothing ever *lands* on a schedule,
so a Mute checkbox and a sound picker there would be two controls that cannot do
anything — the dead end this repo keeps writing down. Every other card passes a
sound and is unchanged.

### Guards

`live-widgets.spec.js` 516 → **606 assertions**, which **LIFT AND RUN** all six
time helpers over the shapes the card actually emits — a regex over a comparison
passes on an inverted one. Mutation-tested thirteen ways, all failing by name:
the flex basis dropped (the plausible half-fix), the past-midnight clamp
dropped, finished rows kept, the clock parsed as a Date, the cheerful empty
state fired on a day that merely ended, the grid order reverted, the equal-row
rule dropped, NULL capacity rendered as 0, the uuid spread unconditionally, the
feed given date parameters, the fetch ungated, the section outliving its last
widget, and a Mute box on a card with no sound.

**Fourteen `ci-check-render.js` cases**, every one keyed on a computed value —
"a card rendered" passes on all of the above. **The fixture pins the org at
10:15 on a date the harness is almost never running on**, which is the only way
to tell a card reading `Org Now` from one reading the browser: the two would
otherwise agree. Five rows, five states — one already finished (so the visible
count is 4 and not 5), one running now, one with no capacity, one cancelled, and
one evening class whose end is numerically before its start.

**AND THE GEOMETRY IS MEASURED, not asserted in CSS.** One case reads the
rendered boxes and requires Check-Ins and Live Enrollments to be the same height
to within 2px and Happening Today to be the two of them plus the grid gap — Dan's
own spec, and a claim no source assertion can make.

**A CASE THAT DEPENDED ON CARD ORDER BROKE, and that is the reusable part.**
`live · a new registration lands highlighted` clicked a bare `.live-pause input`
— whichever card renders FIRST — so the moment Happening Today took that place
it paused the wrong card, the enrollments feed never refetched, and **three
cases that had nothing to do with this change failed**. Scoped to
`[data-live-regs]` now. *A case that depends on there being one of a thing, or
on which one is first, stops testing what it names the moment that moves.*

**`live · four cards fit on one screen` is gone, replaced rather than deleted.**
Five cards is three grid rows and genuinely does not fit 900px — that is a
consequence of the layout Dan asked for, not a regression. The fit assertion
moved to the **default three-card set**, which is two rows and is what an org
that has never opened Edit Dashboard actually opens on.

**Happening Today defaults ON.** Two of the five still default off; the absence
rule is what keeps this one off every org whose Metabase cannot answer it.

## EACH LIVE CARD HAS ITS OWN SWITCH — AND TWO OF THEM DEFAULT OFF (2026-09-07)

Dan: *"Ability to disable/enable specific widgets from the edit dashboard
section, same treatment as the other widgets. By default the live enrollments
and check-in widgets should show up, but the other two must be manually
enabled."*

Edit Dashboard had ONE checkbox covering all four cards. It now has that
checkbox plus a per-card list under it.

### THE ONE LINE THAT MATTERS: ABSENT IS THE CARD'S OWN DEFAULT, NOT ON

Every other toggle in `dashboard.html` reads `!== false`, because absent means
an org that has never opened Edit Dashboard and the answer is yes. **Two of
these four default OFF**, so the same idiom here would have switched Programs
Live and Facility Bookings on for every org on the platform the day this
shipped — the opposite of the ask, and **invisible in review, because the code
would read exactly like every other gate in the file.**

```js
function liveCardOn(id, saved) {
  const def = LIVE_CARDS.find(c => c.id === id);
  if (!def) return false;
  if (!saved || typeof saved !== 'object') return def.defaultOn;
  const v = saved[id];
  return v === undefined || v === null ? def.defaultOn : v !== false;
}
```

`null` is handled beside `undefined` on purpose: a config written by an older
build can carry it, and it is not a choice.

### ONE REGISTRY, THREE READERS

`LIVE_CARDS` is the single definition — label, icon, `defaultOn`, and the
PRESENCE test — read by the resolver, the section, and the editor's list. Three
surfaces answering that question separately is how a card becomes tickable in
the editor and never renders, or renders and cannot be turned off. Same rule as
`mbPlanKey` and `vertRowMatch` in the sibling repo.

**Programs Live shares the enrollments presence test rather than carrying one
of its own**, because it reads the same feed. Giving it its own would let it
light up for an org whose enrollments card is missing and then draw from a feed
nobody fetched.

### TWO GATES, NOT FOUR — the section switch stays the master

`config.liveWidgets !== false` is untouched, so an org that turned the whole
section off stays off and never has to re-tick four boxes. The per-card map only
decides what renders INSIDE a section that is already on. Collapsing the two
would have silently re-enabled the section for every org that had switched it
off.

### A CARD THAT IS OFF STOPS COSTING A QUERY

These poll every sixty seconds **per viewer**, so the switches gate the fetches
and not merely the render. `useLiveEnrollments` gained an `enabled` argument
(defaulting to true, so any older caller is unaffected) matching the shape
`useLiveCheckins` and `useLiveFacility` already had.

**ONE FEED, TWO READERS.** Live Enrollments and Programs Live are the same
query, so it runs while EITHER is on and stops only when both are off — gating
it on the enrollments card alone leaves Programs Live drawing from a feed
nobody fetched.

### THE EMPTINESS TEST HAD TO LEARN ABOUT THE SWITCHES

It read `!alive && !showCi && !showFac` — correct while a card could only
vanish by its feed dying. With per-card toggles an org that switched all four
off would have kept a **heading over a blank grid**, which is the exact dead end
the comment above that line exists to prevent. Each `show*` now folds its
switch in.

### THE EDITOR SEEDS THROUGH THE RESOLVER

Not from the raw saved map. A first-time org would otherwise open the modal to
four EMPTY boxes and a Save would switch off the two that are meant to be on —
the control silently undoing its own default.

### Guards

`live-widgets.spec.js` → **542 assertions**, lifting and RUNNING `liveCardOn`
and `liveCardsResolved` over the four ids. Mutation-tested seven ways, all
failing by name: the resolver reverted to `!== false` (the load-bearing bug),
Programs Live defaulted on, the enrollments feed gated on one of its two cards,
the emptiness test reverted, Save dropping the card map, the modal seeding from
the raw map, and the presence gate removed.

**Three PRE-EXISTING assertions pinned the old shapes** and were updated rather
than deleted — the emptiness test, the per-card render gates, and Save's
payload. Each keeps what it was written to catch; the Save one now names BOTH
keys, because asserting only `liveWidgets: live` would pass on a build that
dropped the card map.

Plus **8 `ci-check-render.js` cases** for the defaults, and they are **LAST in
the list** — they reload onto a config with no saved `liveCards`, and a reload
sticks for every case after it (the trap the `lightFeeds` block already
records). The fixture itself now saves all four ON, so every existing case that
asserts a Programs Live or Facility Bookings card keeps proving what it was
written to prove rather than accidentally testing the default.

**THE RENDER CASES EARN THEIR KEEP ON A MUTATION THE SPEC CANNOT SEE.** Calling
the resolver with its arguments swapped — `liveCardsResolved(availableReports,
config.liveCards)`, a plain copy-paste error that still MENTIONS the resolver —
leaves all 542 spec assertions passing and produces **49 render failures**. That
is the discrimination those cases exist for.

## THE LIVE CARDS CALLED YESTERDAY "TODAY" (2026-09-05)

Dan, on Clarkstown at 9:18am: *"these enrollments are all from YESTERDAY. I
should only be seeing today's enrollments."* The card read **26 signups today ·
$1,838** over a list whose newest row was 10:02pm the night before.

**`today` WAS THE NEWEST ROW'S DAY.**

```js
const today = rows.length ? liveDay(rows[0]['Signed Up At']) : '';
```

The feed fetches SEVEN days (deliberately — the Programs card beside it is a
week-long leaderboard on the same feed), and the card narrows to one. So before
the first registration of the morning the newest row is yesterday evening's, and
the card relabels yesterday as today — **every single day, for the whole quiet
stretch between midnight and the first signup**, which is exactly when somebody
opens a dashboard to watch a registration day start.

**IT WAS A DELIBERATE CHOICE, AND THE PREMISE WAS TRUE.** The comment argued
that the card stamps each row in the ORG's timezone, so a viewer elsewhere must
not be shown a different day from the person in the rec centre. That is correct
and the conclusion did not follow: the newest row is not "today" on anybody's
clock, it is the last time anything happened. **A spec assertion pinned it**
(*"today is the newest ROW's own day"*), which is why it survived review — the
guard had encoded the bug as the desired behaviour, the third instance of that
in these two repos.

`liveTodayFor(rows, key)` is the calendar day from the viewer's clock, built
from PARTS (`toISOString()` is UTC and is already tomorrow west of it), **raised
to the feed's own latest stamp when that is later** — a row dated past the
viewer's today proves the org is ahead, because the card stamps in the org's
zone. Nothing is inferred in the other direction, because nothing there is
evidence.

- **ALL THREE CARDS HAD IT.** Check-ins looked right only because somebody had
  scanned in that morning; Programs Live counted yesterday's signups in a column
  headed today. One helper, three readers.
- **THE RESIDUAL GAP IS STATED, NOT PAPERED OVER**: a viewer WEST of the org,
  late in their own day, is shown an org-tomorrow that has barely started. The
  honest fix is one column on card 21286 — `(now() AT TIME ZONE cfg.tz)::date`,
  whose `cfg` CTE already resolves that timezone — and that is a push plus a tag
  flip, so it is written down rather than guessed at.
- **AN EMPTY TODAY IS A NEW STATE.** With `today` taken from the newest row
  there was always at least one row in it, so an empty tbody under live headers
  was unreachable. It now says *"No signups yet today."*

## CUSTOMER SUPPORT IS REMOVED FROM THE DASHBOARD (2026-09-05)

Dan: *"lets turn off the intercom thing entirely, and remove the customer
support stuff from the dashboard project. my bad."*

**IT WAS TWO FEATURES SHARING A NAME**, and the scope was worth confirming
before deleting:

* **Intercom operations** — a 3-minute poller that emailed org admins about
  escalated conversations, plus seven inbox routes (list, read, forward, set
  status, add note).
* **An org-facing dashboard section** — thirteen widgets including *Resident
  Conversations*, *AI Resolution Rate*, **Admin Hours Saved** and **Admin $
  Saved**. That pair is a Rec-value story rather than support plumbing, which is
  why it was put to Dan rather than assumed. He chose everything.

**WHAT WENT:** three modules (`intercom-live.js`, `support-data.js`,
`support-inbox-data.js`), the notifier, the seven routes, the section and its
thirteen widgets, the `supportNotify` / `intercomOrg` / `supportReadOnly` org
config, the AI-insights prompt for the report type, and the Support tab.

**AND THE TAB STRIP WENT WITH IT.** With Customer Support gone there was one tab
left, and a one-button tab strip is a control that cannot do anything — the dead
end this file keeps writing down.

**THE SAFETY PROPERTY: saved layouts are NOT rewritten by the deploy.** Org
layouts live in `dashboards.json` on the volume, so a dashboard still listing
`sup-*` ids and a `support` section has to keep rendering. It does — verified by
reading every `W[...]` and `SECTIONS[...]` lookup before deleting anything, and
they all guard. That is what made this safe without a data migration.

**A GUARD I COULD NOT MAKE FAIL, recorded honestly.** The render case
`dashboard · a retired support layout still renders` is a SMOKE TEST, not a
guard. Removing the widget renderer's `if (!def)`, the section renderer's
`if (!sec)`, and the metric/chart filter's `W[id] &&` — separately and all three
together — left it green, because the unknown ids are dropped by several
independent layers. Defence in depth is why the removal is safe and also why no
single mutation discriminates. The exact-text assertions in
`support-removed.spec.js` are what actually pin the guards, and the case says so
in its own comment rather than claiming a proof it does not deliver.

**TWO SELF-INFLICTED CUTS WORTH REMEMBERING**, both from deleting by pattern:

1. Brace-counting to find a block's end **counts braces inside strings and
   template literals**, so a route with `${...}` in it ended in the wrong place
   and took the next route's opener with it. Cutting on a top-level terminator
   (`});` at column 0) is what worked.
2. Cutting a CSS block "to the next `/* ── */` banner" swallowed **98 lines of
   shared CSS** — the loading bar, its keyframes and the print rules — because
   the following blocks had no banner. The spec caught it (`the inner bar is
   hidden by default`) and so did a render case. *When you delete by pattern,
   diff what actually left.*

Guard: `scripts/support-removed.spec.js` (**25 assertions**) — the modules are
deleted rather than merely unreferenced, nothing requires them, no route or
notifier symbol survives, no `sup-*` widget or section remains, and the lookup
guards that make a stale layout safe are pinned by their exact text.

## THE CHECK-INS CARD COULD NEVER MAKE A SOUND (2026-09-05)

Dan: *"no sounds playing from the check-in widget, only the live enrollments one
is playing sound."*

`useLiveCheckins` computed its `fresh` diff — it used it to drive the highlight —
and **never returned it**. So `useLiveSound('checkins', feed.freshRows, ...)` was
handed `undefined` and bailed on its own `!freshRows` guard on every poll. The
mute box rendered, the sound picker rendered, the card lit up new rows, and it
was structurally incapable of playing anything.

**BOTH HALVES READ CORRECTLY ON THEIR OWN**, which is why review missed it and
why no existing assertion caught it: the hook diffs, the card rings, and the one
value that joins them was simply not in the return object. The enrollments hook
had `setFreshRows(...)`; this one did not.

**So the guard is the CONTRACT, not either half** — a hook whose feed is handed
to `useLiveSound` must publish its arrivals. Counted, not matched: a single
`.test()` passes while one of the two hooks is missing it, which is exactly how
this shipped. Mutation-tested both ways (the return field dropped, the publish
dropped); both fail by name.

**Generalise it:** when two correct components are joined by a value passed
between them, assert the JOIN. Nothing about either end tells you the wire is
connected.

## FREE IS NOT "NOT YET PAID" (2026-09-05)

Dan, on Lesline Mullings' Trunk or Treat: *"we're picking up free
registrations, which is fine, but we should call them 'Free' on the card, not
'not yet paid'."* Rec's own household page says **Free** for the same booking.

`liveMarkState` tested `paid > 0` and filed everything else as `unpaid`. The two
are opposite facts — one is finished, the other is owed — and a comped
registration in the "not yet" bucket makes an org look behind on collection when
it is not. Now: **nothing paid AND nothing charged is `free`**; nothing paid
with a charge is still `unpaid`. Own slate dot, own legend entry, own cell
colour, and the cell prints the word rather than an em dash (which reads as
missing data).

**The spec assertion here was ALSO pinning the old rule** — `Price: 0, Paid: 0`
was asserted to be `unpaid`, described as *"a $0 row has nothing to arrive"*.
Second instance in one afternoon.

## PAYMENT PLANS ARE INVISIBLE TO THE FEED — FIXED, card 21286 v4 (2026-09-05)

**Done.** v4 adds `On Plan`, `Plan Installments` and `Plan Installments Paid`,
the tags were flipped, and the page renders an orange dot with `$0 / $5`. The
diagnosis below is kept because what it RULED OUT is the useful part — the two
shapes really are arithmetically identical and no client-side rule could ever
have separated them.

**The plan test is the UNION of two signals and neither alone is enough.**
Measured over 287,575 order items across 30 days: `order_item.payment_plan` is
set on 6,794, installments exist on 6,712, and they **disagree on 110** — 96
with a plan whose schedule has not been written yet, 14 the other way.

**Three things the client side had to get right**, all guarded and
mutation-tested: the cell prints its zero through `liveMoneyZ` (`liveMoney`
suppresses zeros on purpose, because `$0 / $325` on an ordinary unpaid row reads
as a refund); the **chime stays on money, not on the colour**, or turning these
rows orange would have quietly started ringing for registrations where nothing
arrived; and a pre-v4 feed degrades to the old behaviour rather than guessing,
because `undefined` falls through to false — which is why there is deliberately
no presence gate here, unlike columns where a missing one renders a confident
zero.

### The original diagnosis


Dan, on Harper McKibben at Essex Junction: *"it's a payment plan, we need a
colored dot for that and an associated colored text when they pay. Shouldn't
that be orange?"* Yes — and **the card cannot currently tell.** Measured:

| | |
|---|---|
| Price | **$3,380** |
| Paid (what card 21286 emits) | **$0.00** |
| installments | **11** |
| installments marked paid | 1, for **$0.00** |

So a real, running eleven-installment plan is **arithmetically identical to an
unpaid registration** — `Price > 0, Paid = 0` — and renders as the grey "not
yet" dot. The existing `part` state only fires once money has actually landed,
which for a plan with a $0 first installment is never at signup.

**Card 21286 emits no plan indicator at all**: Signed Up At, Customer Name, User
ID, Email, Participant, Section, Section Id, Section Code, Program, Activity,
Price, Paid, Status. So this is a card change — one additive column, e.g.
`EXISTS (SELECT 1 FROM payment_plan_installment i WHERE i.order_item_id = oi.id)
AS "On Plan"`, or the installment counts — plus the usual push, date-tag flip
and downtime on the live widget until a human re-saves. **NOT DONE**; it needs
Dan at the keyboard, and the client-side half (an orange dot and orange text for
a plan, at every stage) lands the moment the column exists.

**Do not fake it from `Price > 0 && Paid === 0`** — that is also every genuinely
unpaid registration, and the two need opposite reactions from an admin.

## THE LIVE WIDGETS GET THEIR OWN CARDS (2026-09-05)

Dan: *"if building super lightweight reports to fuel these live widgets is a
better fit, consider that. since each is only pulling a single day's worth of
data for a specific org, maybe that's smarter?"*

It is. **But not one of them was pulling a single day**, and that is the part
worth knowing before touching this again.

### THE MEASUREMENT

Cache-independent, through the public endpoint, on feeds the page polls **every
60 seconds**:

| feed | window | rows | time | payload |
|---|---|---|---|---|
| enrollments 21286, apex | 7 days | 741 | **8.3s** | 345KB |
| | 1 day | 5 | 1.9s | 2KB |
| enrollments 21286, smyrna | 7 days | 748 | 6.8s | 332KB |
| | 1 day | 1 | 0.9s | 0KB |
| check-ins 21517, apex | 2 days | 1,314 | **9.8s** | 319KB |
| | 1 day | 164 | 0.7s | 39KB |

### THE WIDER WINDOWS WERE NOT WASTE, so this is a SPLIT and not a narrowing

Narrowing to one day would have silently killed two features, and this is the
whole reason the obvious version of Dan's idea is wrong:

* **the enrollments feed carries seven days** because the Programs Live
  leaderboard ranks sections over seven and its trend arrow compares three
  complete days against the three before them;
* **the check-ins feed carries two** because the page works out what the org's
  "today" is by reading the newest row's stamp.

**But every figure the leaderboard reads is an AGGREGATE.** Read out of
`liveBySection` rather than assumed: signups, today's signups, charged, paid,
the newest stamp, a per-day tally. Not one name, email, participant, card detail
or plan column is ever touched for that panel. So the history goes to its own
card at **(day × section)** grain: smyrna 748 booking rows collapse to 332, apex
741 to 440, menifee 674 to 136, each dropping twelve wide columns for eight
narrow ones.

And the check-ins second day answers a question **Postgres can answer directly**
— `(NOW() AT TIME ZONE tz)::date` — so it costs nothing to buy back.

### THREE CARDS, AND NONE OF THEM HAS A DATE PARAMETER

| card | what it returns |
|---|---|
| **21550** ✅ Enrollments Live — Today | the org's own today, full detail |
| **21551** ✅ Enrollments Live — Daily Rollup | the COMPLETE days before it, (day × section) |
| **21552** ✅ Membership Check-Ins — Today | the org's own today |

**NO DATE TAGS IS AN OPERATIONAL PROPERTY, not a tidiness one.** The whole
push→flip dance in these repos exists because an API push regenerates DATE tags
as Text and the card 400s until a human re-types them. `org_id` and `days` are
text tags and survive a push unchanged — verified on creation, all three
register text tags only — so **a live card can be corrected at any hour without
taking a widget down.** That is the property a live card most wants, and it is
worth copying to the next one.

**It also closes a gap this file recorded rather than guessed at.** `Org Today`
rides on every row of the two today cards, so the day is decided by Postgres in
the ORG's timezone and `liveTodayFor` reads it before touching the clock — the
viewer-west-of-the-org case is simply gone on the light feeds.

### THE ROLLUP COVERS COMPLETE DAYS ONLY, NEVER TODAY

Load-bearing twice, and the second one is where the saving actually is:

1. **Today's figures on the leaderboard come from the same feed as the live list
   beside it**, so the two panels cannot disagree about today. `todaySignups`
   and `lastAt` take no rollup contribution for exactly this reason.
2. **A set of complete days is immutable within the day**, so it caches for
   **30 minutes** instead of 60 seconds and is fetched once on mount rather than
   on every poll. The expensive half stops being polled at all.

`liveBySection` **refuses a rollup row dated today**. The card cannot emit one;
if a future edit ever made it, adding it would double the busiest day on the
panel. Cheap to assert, catastrophic to omit — and it is one of the eight
mutations.

### PROVEN EQUIVALENT BEFORE ANY WIRING

The two enrollment cards added together per section over seven days, against
card 21286's own seven-day window:

| org | sections | only in split | only in one-card | signup diffs | charged diffs | paid diffs |
|---|---|---|---|---|---|---|
| apex | 288 | 0 | 0 | 0 | 0 | 0 |
| menifee | 75 | 0 | 0 | 0 | 0 | 0 |
| smyrna | 176 | 0 | 0 | 0 | 0 | 0 |

### ABSENT MEANS "CARRY ON EXACTLY AS BEFORE"

A Metabase card is not readable by this app until somebody creates a **public
link**, which is a UI action — so the three UUID literals ship **empty** and
`liveFeedChoice` returns `wide`, the shape that already works. Filling them in
is the whole switch.

**BOTH ENROLLMENT CARDS OR NEITHER.** The rollup is not optional on the light
path: without it the leaderboard would rank on today alone under a header saying
seven days, and the trend arrow would have no history — a panel that looks right
and answers a different question.

### Guards

`live-widgets.spec.js` 370 → **406 assertions**, lifting and RUNNING
`liveFeedChoice`, `liveHasEnrollments`, `liveHasCheckins`, and driving the real
`liveBySection` merge. Mutation-tested eight ways, all failing by name: the
light path taken with only half the pair, the rollup's today guard removed,
rollup rows bumping `todaySignups`, `Org Today` ignored, the light path sending
a window anyway, the rollup put back on the 60s poll, the new cards not
registered date-less, and the widget gate spelled out by hand (which drops the
orgs that only have the new cards).

Plus three `ci-check-render.js` cases over a `lightFeeds` config variant, keyed
on the printed signup count — 1 today + the rollup's 7 + 3 = **11**, so a board
that lost its history reads 1 and one that double-counted reads more. All three
mutation-tested in a browser.

**TWO HARNESS TRAPS, both of which cost a wrong "it passes":**

* **`ci-check-render.js` loads the page ONCE** and runs every case against it,
  so a case needing a different `availableReports` must reload — my first draft
  sat mid-list and silently tested the WIDE path while passing. Tracing which
  stub was hit is what found it. The light cases go **last** and each reloads,
  because a reload leaves the page on the light config for everything after it.
* **`data-live-prog` carries the section NAME, not its id**, and the board is
  capped at the top ten by revenue — so a fixture section that sorts eleventh
  never renders. That trap is already recorded one case over and it caught me
  again; the history-only fixture row is priced high enough to rank, or "it was
  dropped" and "it sorted out of view" look identical.

### Two spec assertions were CORRECTED rather than deleted

Both pinned literal forms that the split changed: the section gate now goes
through `liveHasEnrollments`/`liveHasCheckins` (a hand-written four-way test is
how one card shape ends up missing), and the `freshRows` contract now matches on
the field rather than a full field list, because `rollup` rides on one hook's
return and not the other's.

### NOT DONE

The three UUIDs need public links — **https://rec.metabaseapp.com/question/21550**,
**/21551**, **/21552** → Sharing → Create a public link — and then pasting into
`ENROLLMENTS_TODAY_UUID`, `ENROLLMENTS_ROLLUP_UUID`, `CHECKINS_TODAY_UUID` in
server.js. Nothing else is needed; there is no tag flip and no downtime.

## Live widgets, round three — seven fixes from Dan (2026-09-05)

### ONE MUTE AND ONE SOUND PER CARD

*"make the mute/unmute toggles separate for each widget, some might want to hear
sounds for a widget and not the others"*, and *"Ideally I'd be able to set a
separate sound for each, and hear them going off like it's a las vegas casino
during busy times."*

Mute and the sound picker used to live on the FEED, which was right while one
feed served two cards and wrong the moment somebody wanted one card audible.
**A feed that rings can only ever have one opinion about that**, so the feed now
publishes its fresh arrivals (`freshRows`) and each card rings them itself
through `useLiveSound(card, freshRows, worthy)`.

- **`worthy` travels with the card that knows the rows.** A signup rings when
  its money arrived; a scan rings only when the desk let the member in — a chime
  on a refusal would announce the opposite of what happened.
- **Still the same `fresh` diff the highlight uses**, so no card can ring for a
  row it does not light up, and the first load still produces no diff at all.
- **Three cards ring one batch with three sounds, deliberately overlapping.**
  That is the casino.
- **The old single-key preferences are NOT migrated.** They were
  `rec-dash-live-muted` / `-chime`; carrying them over would mean guessing which
  of three cards the old choice was about, and the value in question is
  "silent", which is where every card starts anyway.
- The fetch no longer reads mute at all. It used to, through a ref, because
  putting `muted` in `load`'s deps would rebuild the callback and restart the
  poll clock — the hazard is removed rather than guarded.

### THE FIVE ANIMALS ARE GONE, and so is the synthesis they needed

Dan asked for a car horn, a chicken, a cow, a sheep and a foghorn, heard them,
and asked for them out. The menu is four again. **`liveVoice`, `liveNoise`,
`liveNoiseBuffer`, the formant bandpasses and the LFO went with them** — none of
the four chiptune sounds uses any of it, and a helper with no callers is the
first thing a reader mistakes for a live feature. The spec pins the ABSENCE,
which is what a later "let's add a few more" would quietly undo.

### LIVE ENROLLMENTS IS TODAY. THE FEED IS STILL SEVEN DAYS.

Dan: *"aren't the live enrollments just the CURRENT day? Not 7 days? I don't
care about 7 days ago, I care about today, this is an open and watch what
happens today. Programs can stay 7 days."*

**The CARD narrowed, not the query.** Programs Live sits beside it, is a
leaderboard over the week, and reads the SAME feed — narrowing the fetch would
have broken it while narrowing the card costs nothing. One query, two windows,
and `today` is still the newest row's own org-timezone day rather than the
viewer's clock.

The day-break rule went with it: over one day it can never fire, and a CSS class
nothing can apply is what sends the next reader hunting for the feature it
belonged to. Same for the weekday-prefix render case — **a case that can no
longer pass is not a stricter guard, it is a broken one**, so it is retired and
`liveWhen`'s prefix behaviour stays lifted and run in the spec, where a rule
about a pure function belongs.

### ONE PERSON COLUMN, AND THE FEED CANNOT LINK A CHILD

Dan: *"remove the HH owner here and just keep the participant column. If the
participant IS the HH owner, just have their name in this column. And make the
participant name clickable to their profile."*

`liveParticipant(r)` returns the name, the id to link to, and what to say on
hover. Two person columns — one of them blank on every adult registration — was
half a table saying nothing.

**THE LINK GOES TO THE HOUSEHOLD, AND THAT IS THE DESTINATION RATHER THAN A
FALLBACK.** I first built this so a child's name rendered as plain text, on the
reasoning that card 21286 emits only the BUYER's uuid and linking a child with
it would open the wrong person. Dan: *"actually linking to the parent's account
is fine, since the profile is all at the household level. so if the parent books
the kid, we show the kids name, but it links to the HH account."*

So the premise was wrong, not the code: **a Rec profile IS the household**, so
the buyer's id is exactly where a reader wants to land from a child's name.
Every row links now, and no card change is needed — the `Participant Id` column
I had queued up is not wanted.

Worth keeping as a general point: *"I cannot address this row" was a fact about
the FEED; "so it must not be a link" was an inference about the PRODUCT, and
only one of those was mine to make.*

### THE SECTION CAN BE TURNED OFF

*"as cool as they are, not everyone will want them."* The editor row read
"Always on" and could not be — fine for Support, which Rec runs, wrong for a row
of self-refreshing cards. It is a checkbox now, saved with the layout as
`config.liveWidgets`.

**Read as `!== false`, never as a truthy test.** An org that has never opened
Edit Dashboard has no value stored, so absent has to keep meaning ON — a truthy
gate would have made the section vanish for every org the day it shipped.

### THE `\u00b7` THAT REACHED PRODUCTION — a JSX attribute is not a string literal

The check-ins card read *"Members and passes as they scan in \u00b7 today"* on
screen, with the escape as five literal characters. `sub="a \u00b7 b"` passes
the backslash through verbatim; `sub={'a \u00b7 b'}` is a real string. Same
family as the `\u2014` written into JSX TEXT in the sibling repo.

**Every guard passed on it.** The specs regex source, the parse check parses,
and the render check was looking at attributes and counts — **nothing was
looking at the words**. `ci-check-render.js` now scans every rendered page for
literal `\uXXXX`, a literal `\n`, and HTML entities that reached the eye. It is
global rather than a case, because the bug is not about one card and a case
pinning this one sentence would not cover the next one.

### Guards

`live-widgets.spec.js` 309 → **326 assertions**, lifting and RUNNING
`liveParticipant`. The sound block was rewritten rather than extended: it now
pins the ABSENCE of the five animals and of the synthesis they used, the
per-card keys, and that the fetch reads neither mute nor chime any more.

**Two render cases had to be written to prove independence, not presence.** No
source assertion can tell three mute boxes wired to one piece of state from
three wired to their own — all three render and all three tick. So one case
unmutes ONE card and reads the other two back, and another sets TWO cards to
DIFFERENT sounds and reads both.

**That second case failed first time, and the failure was mine, not the code's.**
It read one card back against the default `coin` — but an earlier case walks the
whole menu on the first picker on the page, so `coin` was an assumption about
test ORDER rather than about the cards. Setting both explicitly and requiring
two distinct values is the independence claim itself. Third instance of "these
cases are not independent" in this file; the mute cases now normalise every box
before touching one rather than asserting a starting state.

**Two mutations SURVIVED the first draft of these guards**, and both are the
same shape — an assertion that checked a mechanism was present rather than that
it worked. `const LIVE_MUTE_KEY = card => 'rec-dash-live-muted'` still matches
`/card =>/` while ignoring its own parameter, so three cards would share one
stored preference and unmuting any of them would unmute all three **on the next
reload** — the bug arriving a refresh late. And a checkbox hardcoded to
`useState(true)` looks identical until you reopen the editor after turning the
section off, at which point Save Layout silently turns it back on. Both
assertions read the whole expression now.

**A render case was RETIRED rather than repaired.** `a row from another day
carries its weekday` required a row from another day on screen, which this card
can no longer show — and a case that cannot pass is not a stricter guard, it is
a broken one.

### A near-miss worth recording: `.lp` is two columns in two tables

Widening the person column, I set `.live-table .lp { width: 34% }` — and the
Programs card reuses `.live-table` with `.lp` as its **Signups** count, so that
made a number column a third of the row wide. Scoped to
`.live-table:not(.live-table-progs)`. Second instance of the one-class-two-tables
trap already recorded here for `.lm` at 62px.


## The Membership Check-Ins live widget (2026-09-05)

Dan: *"a membership check in card — showing the last XX membership checkins,
similar to this Facility Insights view"*, and then on the shape: *"I'd prefer a
similar line chart or graph, with a small section underneath of the users who've
checked in. And add their tiny photos, orgs love that."*

Card **21517**, its own feed, sitting beside the two enrollment cards.

### LIVE, AND THE SIGN-OFF CAUGHT A BUG BEFORE IT SHIPPED

Public UUID `d9891f69-897e-4d60-985c-50b31ad6d280`, verified
cache-independently through the public endpoint with the app's own
`date/single` parameters: **apex 1,150 scans in 7.7s cold and 0.9s warm,
el-segundo 198 in 1.7s**, three registered parameters.

**Asking for the VIEWER's today returned ZERO rows at both orgs**, while the
previous day returned 1,150 and 198. `liveWindow` builds dates in the viewer's
zone and the card windows on the ORG's, so from the org's midnight-in-viewer-
time onwards — for a Denver org read from Eastern that is 22:00 to 00:00 every
night, and longer for a Pacific one — a one-day window asks for a date the rec
centre has not reached yet. An empty live card at 10pm is exactly the confident
zero this widget exists not to render.

It asks for **two** days now and derives `today` from the newest row's own
org-timezone stamp, which is how the registrations card already absorbs this by
asking for seven. **No render check or spec could have caught it** — the fixture
supplies whatever day it likes. Only a live probe of the real card does.

The live sample also confirmed the design call: photo coverage was **29/1150 at
apex (2.5%) and 0/198 at el-segundo**, the measured 7.5%-and-bimodal figure
showing through. And **zero refusals** in 1,348 real scans, which is what 58
denials platform-wide *ever* looks like from the inside.

### IT IS ABSENT UNTIL SOMEBODY PUBLISHES THE LINK, and that is the design

`CHECKINS_LIVE_UUID` is a literal in server.js and `SHARED_UUIDS` **omits the
key entirely while it is empty**. So `availableReports` has no entry, the route
404s, the card renders nothing, the section hides it — and, the part worth
noting, **the hook does not even poll**. Polling a 404 every sixty seconds for
every org without a link is a self-inflicted error rate that reads exactly like
a broken feed in the logs.

A confident *"0 check-ins today"* on a morning when the desk is scanning people
through is the reading that had to be impossible. Filling in the uuid is the
whole wiring; nothing else changes.

**The tag flip came back CLEAN — three parameters, not six.** Worth recording,
because this is the first card in either repo where an API-created card's flip
did not leave `string/=` duplicates behind. The six-parameter mess is common,
not inevitable.

### A DENIAL IS NOT ATTENDANCE

`liveCheckinState(r)` is the one predicate, at module scope so the spec can RUN
it. The headline counts **accepted scans only**: a card that folded refusals in
would report a member the desk turned away as having come in — the facility
Summary counting invoice fee lines as bookings, one report over.

- **A ROW WITH NO `Status` IS AN ACCEPTED SCAN.** Testing `=== 'Checked In'`
  instead would make every row of a pre-column feed — including every warm
  cache entry — read as a refusal, and the card would report the whole day as
  turned away. Same rule as `ciIsFailed` on the check-ins report.
- **Refusals are shown, not hidden.** They are the interesting rows. They are
  counted separately, named on screen, and marked red in the lane.
- **NO REASON IS INVENTED, and none can be.** `attendance_event.side_effects` is
  empty on all 58 denials platform-wide, and of 52 membership refusals only 5
  had an expired, unstarted or cancelled membership — so a "Reason" column would
  be a confident sentence sitting beside real rows. The spec fails if one
  appears.

### ONE AXIS, TWO LANES

`liveDayAxis(today)` is extracted from `liveTimeline` and read by both cards.
They sit one above the other, so **a noon that is not in the same place on both
is a defect a reader sees immediately**, and two copies of that arithmetic is
how it happens. The MARKS are deliberately not shared: a signup is coloured by
what its money is doing, a scan by whether it was accepted.

An accepted scan is the **same green** as a paid signup — both mean "this went
through", and a second green across two adjacent cards would read as a third
state. A refusal is **red**, not the registrations card's grey: grey there means
"no money yet", which is ordinary and waits.

The render case compares the rendered tick POSITIONS of the two lanes, which is
the only thing that can catch them drifting apart.

### INITIALS ARE THE DESIGN AND THE PHOTO SLOTS INTO THEM

Measured before building, over the 33,239 members who checked in with a
membership or pass in 90 days: **7.5% have an image**, and it is bimodal rather
than merely thin — Clarkstown 94.7%, Euclid 93.5%, Douglas County 22.9%, Norman
16.9%, **Apex 2.2%**. So a photo-first row is a delight at two orgs and a wall
of holes at the rest.

The photo is absolutely positioned **over** the initials in the same box, so
both cases are the same shape and the row never goes ragged. A broken image URL
hides itself and the initials are simply already there.

**The link takes `User ID`, the uuid.** `Member ID` is `users.rec_id`, the
six-character code staff read out at a desk — it looks identical in a link and
404s. A row without a uuid renders as plain text; a link to nowhere is worse
than none.

### NO SOUND ON THIS CARD

The chime says *"somebody just gave you money"*. A beep every time the front
desk scans a card would be unbearable in a busy gym and would train people to
mute the whole section — taking the registrations chime with it.

### TWO FEEDS, AND THE THING THAT MUST NOT DRIFT

The check-ins card reads a **different Metabase card**, so it cannot share the
enrollments feed. Each card is gated on its own verdict and the SECTION hides
only when both are gone — one feed failing must not blank the other.

What must not drift is the poll behaviour, which had just been fixed on the
other hook: the spec counts **two** `visibilitychange` listeners, **two**
`setInterval(load, LIVE_POLL_MS)` and **two** removals. A stale-serving or
tab-sleeping feed is exactly the bug Dan reported, and it would be invisible if
only one of the two carried the fix.

### Guards

`live-widgets.spec.js` 273 → **307 assertions**, lifting and RUNNING
`liveCheckinState`, `liveInitials`, `liveCheckinKey`, `liveDayAxis` and
`liveCheckinTimeline`. Plus **12 `ci-check-render.js` cases** over a fixture
where every number is different on purpose — **17 rows · 16 today · 14 accepted
· 2 turned away · 13 people** — because a fixture where the row count and the
accepted count coincide cannot tell a correct card from one reading the wrong
set. Ada scans twice so `people < accepted`; one row carries a photo and one
carries no uuid, the two branches a source assertion cannot separate.

**Two brittle literals had to be generalised**, both the shape already recorded
for `SLACK_NOTIFY` and an `ALLOWED` array: the `LIVE_REPORT_TTL_MS` assertion
pinned the whole object and broke when a second live feed was added, and the
`every bolt is animated` case pinned `"2of2"` and broke when a third card
appeared. Both test the property now — membership, and the RATIO with a floor
of two so a page rendering no bolts cannot pass as `0of0`.

**A spec that DIED instead of failing, sixth instance.** `liveCheckinTimeline`
calls `liveAt`, which was not in the lift, so the spec threw a bare
`ReferenceError` at call time naming nothing rather than failing by name. The
lift block's try/catch only covers lift time, not call time.

### AND THE REPORT-GOES-LAST TRAP BIT AGAIN — the spec printed a clean pass over two real failures

The check-ins block was appended BELOW the `if (failures.length)` reporter. So
all 34 of its assertions ran, incremented `pass`, recorded two genuine failures
under a mutation — and the spec printed **"✓ 305 assertions passed"** and
exited 0. The mutation (`liveCheckinState` inverted, so a row with no `Status`
reads as a refusal) SURVIVED, and the only visible symptom was the pass count
dropping by two.

This file already carried a comment warning about exactly this, from the first
time it happened. **A rule written in a comment did not stop the second
instance**, so the fix is structural: the reporter is a `process.on('exit')`
handler now, which cannot be appended past, using `process.exitCode` rather
than `process.exit` so it is allowed to finish writing. Verified both ways —
the mutated run exits 1 and names both assertions, the clean run exits 0.

Generalise it: *when a rule about where code goes has failed twice, stop
restating the rule and remove the position from the design.*

**And the first fix left the old block behind**, which is worth recording as
its own mistake: for one commit the file carried BOTH reporters, and the stale
`if (failures.length)` sat ABOVE the check-ins section with a `process.exit(1)`
in it — so any pre-existing failure would have exited before those 34
assertions ran at all. The exit handler was what kept it honest. Removing a
mechanism means removing it, not adding its replacement next to it.


## THE LIVE CARD WAS A MINUTE BEHIND, AND REFRESH ONLY LOOKED LIKE THE FIX (2026-09-05)

Dan: *"seems like the larger orgs are lagging a bit on the live cards? Not
seeing these recent bookings, no?"* and then *"seems like the live widget is
lagging — nothing happens until i click the refresh."*

**Three separate things, and only one of them was what it looked like.**

### 1. THE CACHE WAS HANDING BACK THE PREVIOUS FETCH

`fetchMetabaseData` is stale-while-revalidate: a caller gets the cached rows
immediately and, if they are past the TTL, a refresh is kicked off *behind* the
answer. With a 60s TTL and a 60s poll that means the card shows rows between one
and two minutes old, sawing between the two:

| | |
|---|---|
| t=0 | cold fetch, cache = D0 |
| t=60 | stale → **serves D0**, kicks a refresh that lands at ~t=65 |
| t=120 | fresh → serves D65 |
| t=180 | stale → **serves D65**, kicks a refresh |

**AND THAT IS EXACTLY WHY THE REFRESH BUTTON LOOKED LIKE THE CURE.** `refresh`
IS `load` — the same function, the same URL, no cache-buster. Clicking it a
moment after a poll simply lands *after* the background refresh that poll had
already started, so it gets the rows the poll should have had. The button was
never doing anything the poll was not; it was arriving later. Anyone diagnosing
this from the symptom will look for a difference between the two code paths and
there is none.

The trade is right for a dashboard of a window somebody chose — nobody should
wait 30s for a report they can read a quarter of an hour old. It is wrong for a
widget whose whole claim is *"right now"*, where a stale answer is the failure
rather than the graceful degradation. **So a live feed now AWAITS the refresh**
(`isLive` off `LIVE_REPORT_TTL_MS`, which already knows which feeds those are);
everything else is unchanged.

- **It costs the poll the card's own time**, measured through the public
  endpoint: shrewsbury **3.0s**, el-segundo **5.2s**, san-francisco **9.5s** —
  comfortably inside the 60s poll.
- **`revalidate` now returns the IN-FLIGHT PROMISE instead of `null`** when a
  refresh is already running. Fire-and-forget callers never noticed; a caller
  that has to *wait* would have fallen straight back to the stale rows it was
  avoiding — silently, and only when two viewers polled in the same second,
  which is the hardest version of that bug to ever see.
- **A failed refresh still answers with the stale rows.** A card that empties
  itself the first time Metabase hiccups is worse than one a minute behind for
  a minute.

### 2. A HIDDEN TAB'S 60-SECOND TIMER IS NOT A 60-SECOND TIMER

Browsers throttle `setInterval` hard in backgrounded pages, so a dashboard left
open on a second monitor can go minutes without a poll and then show its age the
instant somebody looks at it. Coming back to the tab IS the request for current
rows, so the feed refetches on `visibilitychange` rather than waiting out
whatever is left of an interval that may not have been running. **Not while
paused** — a tab switch is not an un-pause.

### 3. SESSION BOOKINGS NEVER REACHED THE CARD AT ALL — this is the big one

Card 21286's `bk` CTE filters `b.type = 'section'`. The biggest orgs run camps
and drop-ins in `registration_mode = per-session`, and those register as
`type = 'session'`. Measured over seven days, deduped to one row per
(customer, participant, section) — a parent booking a nine-day camp is nine
booking rows and must stay one line:

| org | on the card | missing | |
|---|---|---|---|
| apex | 795 | **+556** | +70% |
| essex-junction | 261 | **+241** | +92% |
| el-segundo | 211 | **+319** | +151% |

So on a busy morning the feed skips long stretches, which reads as lag and is
not. **The card was built for these rows and the filter is what stops them**: it
already `LEFT JOIN`s `session` and resolves
`COALESCE(b.section_id, se.section_id)` downstream — anticipating session
bookings the upstream `WHERE` never lets through.

Not fixed here: it is a push, a Date-tag flip and a live-widget outage window.
Flip link https://rec.metabaseapp.com/question/21286

**AND SAN FRANCISCO'S EMPTY CARD IS CORRECT.** SF took 2,963 bookings in seven
days and the card returns **0 rows**, which looks identical to the bug above.
All 80 of its `section` bookings are `is_rec_managed = true` (excluded by
design), and everything else is `facilityRental`. *A report that is empty for
one org and healthy for another is not evidence about that org* — check what its
rows actually ARE before calling it a defect.

## A BIG REGISTRATION DAY SOUNDS LIKE ONE (2026-09-05)

Dan: *"When an org has a big registration day, I want it to sound like a las
vegas casino."*

`LIVE_CHIME_MAX` was **3**, on the argument that a dozen overlapping coins is
noise. That argument was about LOUDNESS, and truncating the burst was the wrong
answer to it — a morning where sixty people register is the one morning this
card is worth having on, and ringing three times for it says nothing about the
size of the day. It is **40** now, and the loudness is handled where it belongs.

### THE DUCK IS BY THE OVERLAP, NOT THE BATCH SIZE

The mistake worth not repeating. Forty rings at full gain sum past 1.0 and the
browser hard-clips, which crackles — it sounds broken, not loud. But **forty
rings 90ms apart do not play together**: each lasts about 0.7s, so only about
eight are ever sounding at once and the rest are strictly later. Ducking by
forty would divide by five times the loudness actually present, and the biggest
morning of the year would ring the quietest.

`level = overlap^-0.4`, where `overlap = RING_MS / GAP_MS` capped by the count.
**Slightly less than equal loudness (`^-0.5`) on purpose**, so a bigger burst
really is a bit louder. A batch of ONE is exactly 1.0 and takes the old code
path entirely, so an ordinary single signup sounds identical to before.

The duck **saturates**: past the overlap point a longer burst is longer, not
quieter. That is the assertion that fails if anyone reads the level off the
batch size again.

### THE DETUNE IS NOT DECORATION

Identical simultaneous copies of the same waveform sum coherently — forty coins
scheduled together sound like **one louder coin, not like forty**. A four-step
rising run of 25 cents, resetting, keeps them from phase-cancelling into a
flanged mush. Under a semitone, so the coin's own B5→E6 interval still sounds in
tune.

Jitter for the same family of reason: an exactly even stagger is a machine gun
and reads as one effect. **The first ring is deliberately NOT jittered** — it is
the one a person reacts to, and delaying it up to 45ms for nothing only makes
the card feel slower.

### `liveChimeBurst(n, rnd)` RETURNS THE SCHEDULE AS DATA

Delay, level and detune per ring, at module scope, with `rnd` injected. A
browser has no ears in CI, so the only checkable claim about a burst is its
SHAPE — and a jitter read off `Math.random` cannot be asserted about at all.

The level and detune reach the voices through a module-level output bus and a
detune value that `liveChime` swaps in around one **synchronous** `play()` call
and restores in a `finally`. Scheduling a voice only queues nodes, it never
awaits, so nothing can run in between; the alternative was a third argument
threaded through three primitives and nine voices that every one of them would
only pass along. The `finally` matters: without it one throwing voice mutes
every ring after it.

## $195 / $325 — a part-paid row shows both figures (2026-09-05)

Dan, on a $325 registration with $195 paid on a plan: *"would like to see
195/325 here."* Rec's own household page reads *"$195.00 / $325.00 · Partially
paid"* for the same booking.

`livePriceCell(r)` — **only** a part-paid row gets two figures. A fully paid one
has nothing to compare against and *"$325 / $325"* is noise; an unpaid one has
no first figure, and *"$0 / $325"* reads as a refund rather than as a booking
nobody has paid for yet. It goes through `liveMarkState`, so the rows that get
two figures are exactly the rows the dots in the lane call part-paid — the two
cannot disagree.

The charge is **muted** behind the paid figure rather than sharing its orange:
two figures in one colour read as a single number with a slash in it. `.lm` went
62px → 104px with `white-space: nowrap`; the programs card's own 116px override
still stacks on top of that.

**A benign mutation worth recording.** Changing the gate from
`!== 'part'` to `=== 'paid'` SURVIVES, and correctly: an unpaid row falls
through to `liveMoney(r['Paid'])`, which is `''` for zero, and the sub-dollar
fallback already returns the charge alone. The branch is belt-and-braces and the
fallback is the real guard — reporting that mutation as "caught" would have been
wrong.

## RUN `ci-check-html.js` AFTER EVERY dashboard.html EDIT (2026-09-05)

Self-inflicted, and it cost a ten-minute render run. Rewriting a comment block
left the old paragraphs *outside* it:

```js
   ...which is exactly the relationship wanted.
*/
const LIVE_CHIME_RING_MS = 700;

   AND THE DETUNE IS NOT DECORATION. ...        ← now bare code
```

Babel threw `Missing semicolon (1916:6)`, discarded the entire inline block, and
**every widget on the dashboard vanished** — the blank-page class both these
repos keep being bitten by.

**`live-widgets.spec.js` passed on it, all 270 assertions**, because a spec
regexes source and never parses it. `ci-check-render.js` caught it — and so does
`node scripts/ci-check-html.js`, **in about a second**, which is the cheap guard
that should have run first. Verified by reintroducing the bug: the HTML check
names the file, the block and the line.

Generalise it: *editing a comment is editing code.* Run the parse check after
touching a `text/babel` block, before spending ten minutes on a browser.


## The Programs Live money column was 62px (2026-09-04)

Dan: *"look at the alignment on the headers and revenue section"*, with the
header **PROGRAM REVENUE** running off the card's right edge and the sub-line
reading *"of $1,879 cha…"*.

**`.live-table` is shared by both live cards, and `.lm` was 62px** — the right
width for the registrations card, whose money cell holds a bare price. The
programs card reuses the same table for a fifteen-character header and an
`of $X charged` sub-line. With `table-layout: fixed` the declared width is
honoured rather than negotiated, so the `nowrap` header simply overflowed the
cell and then the card, and the sub-line was clipped.

`.live-table-progs` widens that one column to 116px. **Scoped to the programs
table rather than to `.live-table`**, because the registrations column really is
that narrow and widening both would steal width from the name column for no
reason.

The sub-line also moved off an inline style onto `.lm-sub` — an inline style
only wins for the properties it names, and `white-space` was not one of them.

### The guard has to be GEOMETRY

*"A header rendered"* passes on the clipped version, and `textContent` is blind
to a box the text is spilling out of — the same lesson as the `9across` headline
two changes ago. The cases compare `scrollWidth` against `clientWidth` for both
the header and the sub-line, and the header's right edge against the card's.
Mutation-tested by putting 62px back: both fail by name.

## The cha-ching (2026-09-04)

Dan: *"every time a person enrolls and pays, play a 'cha-ching' sound. mute by
default, but add a 'mute' checkbox on the card, that can be unchecked... Give me
a few sample sounds and I'll pick one. Maybe the super mario bros coin sound"* —
then, with a link to it: *"this is it"*.

### IT IS SYNTHESISED, NOT SAMPLED — and that is a decision

An audio FILE here would be a redistributed copy of Nintendo's recording sitting
in a public repo, and one more asset that can 404 on a dashboard people leave
open all day. The coin is **two square-wave notes — B5 (987.77 Hz) then E6
(1318.51 Hz)**, the second held and decaying, so the synth IS the sound rather
than an impression of it. Both frequencies are pinned by the spec: the interval
is what makes it recognisable, so neither note may be tuned by feel.

Four to choose from (`coin`, `chaching`, `arcade`, `bell`), because Dan asked to
hear a few. **Choosing one in the menu plays it**, so the menu is its own preview
and there is no second button that does nothing else.

### THE FIRST LOAD IS SILENT, and that is the load-bearing half

The chime rides the **same `fresh` diff the row highlight uses**, which is empty
on the first poll by construction. So opening the dashboard on a week holding 61
paid registrations plays **nothing** instead of 61 coins — and the card can never
ring for a row it does not also light up.

**A mutation to exactly that survived the spec's first draft.**
`seenRef.current || new Set()` leaves the `if (seen)` branch standing and passing
while making every row on the first load an arrival. The spec now pins the ref
being read **with no fallback**, which is the only form that discriminates.

### "ENROLLS AND PAYS" — so an unpaid hold is silent

`liveChimeWorthy()` is `liveMarkState(r) !== 'unpaid'`, i.e. **the same predicate
the price colour and the revenue figure already read**, so the three cannot
disagree about one row. A cha-ching for a hold with no money behind it announces
revenue that has not arrived, out loud.

### A BURST IS CAPPED AT THREE, staggered 130ms

Twelve registrations landing in one poll is **one event** to somebody listening
from across the room; twelve overlapping coins is a reason to mute the card for
good. Two or three still read as two or three.

### The mute box, and the gesture problem

- **Ticked by default**, remembered per browser like the theme and the column
  toggles. The stored form is `!== '0'`, so an absent key, an unreadable store
  and a private window all land on **muted** — reading `=== '1'` is equivalent
  today and would flip the default the first time the written value changed.
- **UNTICKING IT IS THE BROWSER GESTURE.** Browsers keep an `AudioContext`
  suspended until the user has interacted, so without a `resume()` there the
  first arrival after unticking is silent and the checkbox reads as broken. A
  *persisted* unmute arrives with no gesture behind it, so the context is woken
  again on the first pointer or key event — `{ once: true }`, not a listener
  left on the window for the session.
- **Mute is read through a REF inside `load`.** As a dependency it would rebuild
  the callback, and the poll interval is keyed on that callback — so muting the
  card would silently restart its 60-second clock.
- **The AudioContext is built on first use**, never at module scope: otherwise
  every dashboard load including every muted one starts a suspended context.

### The mute box is on BOTH cards, the sound menu on one

Mute is an operating control like Pause — one feed behind two cards, so it has to
read the same on either. But WHICH sound is a setting you touch once, and two
menus side by side both reading *"Coin"* look like a duplication bug rather than
a choice. The menu also **cannot outlive the sound**: beside a ticked Mute box it
would be a control that does nothing.

### THE GUARDS NEEDED A COUNTER, because a browser has no ears

`liveChime()` bumps `window.__liveChimeRings` **before it touches audio at all**,
and this container has no audio device. That counter is the only observable:
*"a Mute box rendered"* passes just as happily on a chime wired to every arrival,
to the first load, or to an unpaid hold.

So the render fixture now delivers **one paid AND one unpaid arrival on every
refresh**, and the case requires **exactly one ring** — two means it does not
read the payment, zero means unmuting did nothing. **A pair per call, not a fixed
script:** the first draft prepended the pair on one specific call number and the
muted case, which refreshes twice, *consumed it* — so by the time the sound was
on there was nothing new left to ring for, and a passing-looking `0` meant
nothing. Accumulating means the case order cannot starve the case that matters.

The four cases share one page and **must run in order** (the mute box is real
state, and unticking it persists); the last of them re-ticks it.

**And the unmute had to be a REAL click.** React tracks a controlled input's
value internally and ignores a direct assignment, so the first draft toggled the
DOM, left the state ticked, and timed out on a menu that never appeared — the
same lesson already recorded for the reporting project's cache dial.

### Guards

`scripts/live-widgets.spec.js` 157 → **182 assertions**, lifting and RUNNING
`liveChimeWorthy`. Mutation-tested six ways, all failing by name: the chime not
gated on the box, the paid filter dropped, the default flipped to unmuted, the
picker shown while muted, the burst cap removed, and the first load treated as
arrivals. Plus **four `ci-check-render.js` cases**, all four verified against a
real regression in a browser.

**Two pre-existing assertions had to have their intent restored**, both instances
of a shape this file and its sibling keep recording: one pinned
`clearTimeout(timerRef.current), [])` and broke the day a second timer joined the
same unmount effect, and one pinned `LiveCardHeader`'s exact parameter list and
broke when a fourth prop was added. Both test membership now.

## Live Enrollments, and the revenue figure that cannot match (2026-09-04, second pass)

Dan's tonight list. Five were mechanical; the sixth is a measurement.

### Live Enrollments

Second rename in a day, and neither older name is spelled out anywhere in
`dashboard.html` — the comments in the babel block are served to the browser, so
a comment naming a retired card still ships it. That was a real leftover the
first time: a comment kept the old name in the served HTML while the spec's
own assertion read a comment-STRIPPED copy and passed.

### The legend was landing on the hour labels

`.lt-day em` is absolutely placed at `bottom: -14px` — OUTSIDE the timeline's
box — so a legend pulled up under the lane sits in the same fourteen pixels.
The timeline reserves that space in its margin now. **The render case is
geometry** (the legend's top against the tick's bottom), because the DOM is
identical either way.

### The price carries its payment state's colour

Green paid, orange part-paid, default ink for unpaid — the same two colours as
the dots in the lane, because they say the same thing about the same
enrollment. **Unpaid deliberately keeps the default colour**: the grey dot
already says it, and a grey price reads as disabled.

**AND THE ARRIVAL POP WAS STEALING THAT COLOUR.** `liveMoneyPop` animated
`color` to green for ten seconds, so a brand-new UNPAID price rendered green —
saying the money had arrived when it had not. It animates scale only now. Found
by the case that reads the computed colour of each state, not by review.

### The right card covers the FEED's window now

*"Can we get more programs to show up on the right side chart? Seems a little
thin over there. where is this list coming from?"*

It comes from card 21286 — the same rows as the list on the left — and it was
**scoped to today**, so a quiet morning was a five-row card. Watertown had 13
enrollments across 5 programs that morning: five rows was every row there was,
and the ten-row cap had nothing to do with it. It reads the whole feed window
(`LIVE_DAYS` = 7) now: one query, one window, two views. `todaySignups` still
separates what arrived today for the headline.

### PROGRAM REVENUE IS MONEY RECEIVED — and it cannot equal the Revenue tab

*"The program revenue doesn't seem to be matching what we're showing on the
Programs->Revenue tab for programs. It needs to."*

Half of that is fixable and half is not, so both halves are here.

**Fixed:** the column counted `Price` (what was charged) under the header
`Charged`. The reporting project's Revenue tab counts payments **received**, so
this column now counts `Paid` — what has actually succeeded — and ranks on it.
The amount charged appears underneath only when the two differ, which is a
payment plan.

**NOT fixable, and this is the part to keep.** Card 17295 windows on **SESSION
dates**; this feed windows on the **SIGNUP date**. Measured at Watertown on
2026-09-04 — 13 enrollments taking $1,082:

| of that day's enrollments | count | money |
|---|---|---|
| for a section running THAT DAY | **0** | $0 |
| for a section running anywhere in September | 4 | $270 |
| for a section starting after September | **9** | $812 |

So a Revenue tab set to that day shows **$0** of it, and September shows $270 —
the other $812 is fall and winter programming that lands in those months'
windows over there. Same money, filed by when the programme RUNS rather than
when it SOLD. It is the same gap already recorded in the sibling repo for
`period_received` ("August money paid for sections that do NOT run in
August", ~$514K at apex).

**The two agree on the INCREMENT, which is what watching it live is for**: a
$65 enrollment moves both by $65, in whichever window that section belongs to.
The card's sub-line names its basis so nobody reconciles a total.

### What the widgets cost

Asked and measured, because "live" invites the question:

- The page polls every **60s per open dashboard**, and `LIVE_REPORT_TTL_MS` is
  60s for `enrollments`, so a poll is served from cache **instantly** and
  triggers a background refresh when the entry is older than that. The cache key
  is org + params, so it is **one card run per minute per ORG**, not per viewer.
- Card time through the public endpoint, 7-day window, two passes each:
  **Watertown 2.6s → 1.0s (61 rows), Niagara Falls 2.9s → 0.6s (37), Torrance
  15.4s → 9.0s (198)**.
- **Torrance is the one to watch**: a 9-second query once a minute is a ~15%
  duty cycle on a Metabase connection for as long as a dashboard is open there.
  Row count drives it. If that becomes a problem the lever is a longer TTL for
  big orgs (the poll can stay at 60s — it would just serve stale more often),
  not a cheaper card.

### Guards

`live-widgets.spec.js` 152 → **157 assertions**. Four old ones had to be
corrected rather than deleted: they pinned the today-only window and the
charged basis. Nine new `ci-check-render.js` cases, and three of them found real
faults in my own work before the run reported clean — the pop animation
recolouring an unpaid price, a `thead` compared case-sensitively when
`innerText` honours `text-transform`, and a leaderboard assertion keyed on a
program that ranks below the ten-row cap (relational now: the card knows more
than 14 programs, where today-only knew 14).

## The live cards, polished (2026-09-04)

Dan's list, in his words, after watching the pair on production for a morning:
*"change the coffee counter name to 'Live Program Registrations', much sexier.
Sorry coffee."*, the dollar signs to payment dots, a manual refresh on both, the
programs bolt, *"not 'programmes', 'Programs'"*, ten programs ranked by revenue,
and a warmer background because *"they look a bit washed out and don't stand out
from the current cards."*

### The Coffee Counter is now Live Program Registrations

Name only — the card is the same one-day lane and list. Nothing in the repo says
Coffee Counter any more, comments included, and `data-live-coffee` became
`data-live-regs` so the DOM handle does not outlive the name.

### THREE PAYMENT STATES, AS DOTS

*"change the dollar signs (yeah I loved it too) to a green dot for paid, and an
orange dot for a partial payment/payment plan (you had a grey dot right now)."*

`liveMarkState(r)` reads the two figures the feed already carries — `Price`
(charged) and `Paid` (arrived) — which is all three states without a new column:
**green** paid in full, **orange** part-paid, **grey** nothing in. A payment plan
IS the middle state by construction: charged in full at registration with only
the first installment taken.

- **Money with no readable charge still reads PAID.** A row we cannot price is
  not evidence the payment did not land.
- **A half-cent epsilon**, or two independently rounded figures make a
  fully-paid registration render as a plan.
- **Colour is the only difference between the three** — same size, same shape. A
  dot that also changed shape would read as a different KIND of thing.
- **A three-colour code is named on screen.** The legend is the only thing that
  says which is which; the per-dot titles only say it on hover.

### One header, both cards — which is how the bolt got fixed

*"The lightning bolt on the programs card isn't pulsing/no animation."*

**Both bolts were running** — proven in a browser: two `.live-bolt` elements,
one animation each, `animationName: liveBolt`. What the guard could not tell us
is *which* one, because it read `querySelector('.live-bolt')` — the
registrations card's — so the programs bolt had never been checked at all.

Two things changed. The keyframes no longer sit flat at `opacity: .55` for two
of every three seconds, which is what made a still frame (or a glance) read as a
dead icon; the baseline drifts now and the flicker is stronger. And the header
is **one shared component** (`LiveCardHeader`) instead of two copies, because
two copies is how the pair would eventually differ for real. The render case
counts **every** bolt (`data-livebolt="2of2"`).

The shared header is also what put the refresh button on both cards at once, and
**Pause is now on both** — there is one feed behind them, so a Pause on the left
card that silently stopped the right one was a confusing half-measure.

### Refresh now

*"add a manual refresh button on both these live cards in case I don't want to
wait every minute."* The hook hands out its own fetch (`refresh: load`), so both
cards move together — a button that refreshed half a shared feed is the
two-cards-disagree bug this section was built to avoid.

- **Disabled while a fetch is in flight**, and `loading` starts **true**,
  because the first fetch is already running when the cards mount.
- **REFRESHING DOES NOT UNPAUSE.** Pause says "stop moving while I read";
  refresh says "move once, now". Conflating them makes the button a second,
  hidden un-pause.
- The render case clicks it and counts the browser's own enrollments requests
  either side — a button that renders and does nothing looks identical.

### Ten programs, ranked by REVENUE

*"We need to show more programs on the program revenue card, I'd expect to see
the top, say 10 or so programs, which pulse or move as users enroll in them.
User pays, they show up on the left card as a new registration, AND the card on
the right pulses with more revenue for that program."*

It shipped most-recent-first, which answers "what just happened". This is a
leaderboard instead: **money ranks the table and arrival animates it.**

- `LIVE_PROG_ROWS = 10`, its **own** constant — each row there is a whole
  program, while ten registrations would be a wall, so one constant governing
  both kinds of row would be wrong for one of them.
- **Recency did not leave the card**, which is why the sort could move: the Last
  column still shows it, and ties break on signups then on the raw timestamp
  string.
- **A program with no readable price sorts LAST**, not first — `null` is "we
  cannot tell", not "nothing".
- **The pulse carries the increment.** `freshBy` is built in one pass from the
  same `flash` set the registrations list highlights, so the row lights up AND
  prints `+$215` — a total that grew by $215 is a different thing to read than a
  total that is $215. Two cards cannot disagree about what arrived, because
  there is one arrival diff.

### Programs, not programmes — and the spacing was TWO bugs

The headline read *"9across 5 programmes"*. The spelling was one fix; the
squash was two:

- **`.live-big` had no CSS rule at all**, so the number and its caption were two
  inline boxes with nothing between them. It is a flex `gap` now, not a literal
  space in the markup.
- **A gap does not fix the TEXT.** `textContent` is still `"15across"` with the
  elements merely spaced apart — what a screen reader says and what a
  copy-paste carries — so `{' '}` goes in as well.

**My first render case for this could not tell them apart**, and that is the
lesson: it read `textContent`, which is blind to layout, so it "caught" a squash
the flex gap had already fixed and would have passed on a page with no gap at
all. It measures the two bounding rects now AND checks the text, because the
symptom is one and the faults are two.

### The program name opens Rec

*"I should also be able to click the section name on the right side and open a
new tab directly to the rec admin section page."*

A program row is **not** a section — it can span several — so what it opens is
the section the **most recent** registration went into, and where the row covers
more than that, a muted `+N` says so (the same "+N is a primary, not the whole
truth" shape the reporting project uses for instructors). No section id on the
row means plain text, not a link to nowhere. It goes through the same
`liveSectionUrl` the registrations list uses, so one id shape governs both.

**The render case for it failed first time, and not because the link was
broken:** it keyed on Oxygen Dance, whose $25 sorts it thirteenth of fourteen —
below the ten-row cap, so it never rendered. The fixture's Swim Lessons row
carries the id now, because it ranks second. *A case has to key on something the
page actually draws.*

### The warm tint, and a cascade collision

`--live-bg` / `--live-border` are tokens defined in **both** theme blocks — a
colour defined once is a card that reads correctly in one theme and disappears
in the other.

**AND IT NEEDED THE COMPOUND SELECTOR.** `.widget-card` sets
`background: var(--bg-card)` a hundred lines BELOW the live block, and at equal
specificity the later rule wins — so a bare `.live-card { background }` is
silently overridden and the cards render exactly as washed-out as before.
`.widget-card.live-card` (0,2,0) outranks it whatever the order. **Caught by the
render check comparing the live card's computed background against a normal
card's**; no source assertion would have noticed, and neither did I until it
ran.

### Guards

`live-widgets.spec.js` 112 → **146 assertions**, lifting and RUNNING
`liveMarkState` over all three states plus the two edge rules (paid with no
charge, the half-cent epsilon). Six old assertions had to be corrected rather
than deleted — they pinned the dollar sign, the recency sort and the British
spelling, all of which Dan changed.

`ci-check-render.js`: the fixture gained **ten more programs today**, and each
one is load-bearing — the 10-row cap is invisible with three programs, **Summer
Camp holds the most money while Oxygen Dance is the most recent** (so a revenue
sort and a recency sort put different rows on top), and **Swim Lessons is $480
charged with $240 in**, the part-paid state nothing else in the fixture produces.

Mutation-tested eight ways, all failing by name: the tint reverted to a bare
`.live-card` (the cascade bug), the text space removed, the flex gap removed,
part-paid folded into paid, the cap back to eight, the sort back to recency, the
refresh button removed, and the programs bolt's animation killed.

**AND THE SPEC'S FAILURE REPORT WAS IN THE WRONG PLACE**, which is the worst of
these to leave behind. `if (failures.length) { … process.exit(1) }` sat ABOVE
the section I added, so all seventeen new assertions ran, incremented `pass`,
and could never be REPORTED — one of them was in fact failing (a comment still
naming the old card, which SHIPS: these comments are served to the browser
inside the babel block) and the spec printed a clean 146. The report goes last
now. Same family as the guards in the sibling repo that died instead of failing:
a check whose result cannot reach the report is not a check.

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

- **A SKELETON WHILE IT LOADS; ABSENT ONLY IF IT FAILS.** Rendering nothing
  during the first fetch left a "Live Widgets" heading over blank space for the
  several seconds the query takes — Dan: *"now the widget is gone lol"*, which
  was the load, not a failure. Not-yet-answered and could-not-answer are
  different states and only one of them is absence.
- **ABSENT, NEVER A ZERO.** A failed feed renders **nothing** —
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

### v2 — THE WINDOW IS APPLIED BEFORE THE MONEY (2026-09-03, same day)

The first version was slow in a way that only showed up on a second org.
Measured through the public endpoint: **Shrewsbury 20.7s, then 42.2s;
Watertown 46s.** The cause is not the feed's size — it returns 126 rows — it is
that the `money` CTE aggregated the org's **whole `order_item` ledger** and was
then joined to a handful of windowed bookings. A widget asking for seven days
was paying for every registration the org had ever taken.

`bk` resolves the windowed bookings first and `money` joins to it, so the
per-item work runs over a week instead of a history: **Shrewsbury 1.05s.**

**PROVEN IDENTICAL, not assumed.** Same org, same window, fingerprinted over
(signed-up-at, customer, section, price, paid): **126 rows, $11,123 charged /
$11,123 paid, md5 `173198a77f96255c22982d9fa9c067a5`** — byte-identical to the
deployed v1. `oi.organization_id = bk.org_id` is **kept** even though the
booking join makes it redundant, so the claim being made is "same query,
smaller input" rather than "a different query that looks right".

**THE DATE TAGS MOVED INTO `bk`,** which is the whole point — a window applied
after the aggregate is the bug being fixed, and `live-widgets.spec.js` asserts
their POSITION (between `bk AS (` and `money AS (`), not merely their presence.

The 60-second cache stays: an open dashboard costs about one query a minute for
its org, not one per viewer. Nothing waits on it — the widget renders when it
answers.

After any API push to the card, re-set the Start/End Date variables to type
**Date** and re-save until it registers three parameters rather than six.
Flip link: https://rec.metabaseapp.com/question/21286

### Three things the first look found (2026-09-03, same evening)

- **HALF WIDTH.** It shipped `widget-lg`, which spans all four columns — right
  for a chart, wrong for eight short rows, and full-bleed it dwarfed the board.
- **THE EDITOR OFFERED TO ADD IT WHILE IT WAS ALREADY ON SCREEN.** Dan: *"if
  it's already loaded, shouldn't it be highlighted, and at the top with a
  widget counter of 1?"* Adding it would have produced a **second, empty copy**,
  because the section renders outside `config.sections`. It is shown the way
  Support is now — pinned first, labelled *"Always on · not date-filtered"*,
  1 widget, and removed from the addable list. A control that offers to add
  what is already there is the dead end this file keeps recording.
- **"SPINNING FOREVER, TOP BAR NEVER STOPS."** It had already stopped, and
  that was the problem: `.loading-bar-inner` carried a background and a 30%
  width unconditionally while only the ANIMATION was gated on `.active`, so a
  finished load left a static amber stub under the header that reads exactly
  like a progress bar wedged at 30%. Pre-existing, on every dashboard. The
  inner bar is `display: none` unless the bar is active.

**AND THE RENDER HARNESS SILENTLY IGNORED `act`.** Four cases for the above
failed against perfectly good code because this repo's `ci-check-render.js` had
no per-case interaction hook — it accepted the field and dropped it. Ported
from the sibling repo, and a throwing hook now fails by name rather than
vanishing. *A harness that accepts an unknown field and drops it is worse than
one that rejects it.*

### The list, reworked after the second look

Dan: *"set fixed column widths here, it's a bit of a jumbled mess. time of
registration, then household owner, then participant name, then section or
program name, then price. Add column headers. And animate the lightning bolt or
something make it seem more 'alive'. Doesn't feel like it's doing anything."*
And: *"when a new registration happens, the bottom one drops off, the new
one(s) pop on the top, highlighted, then the highlighting fades after 10
seconds or so."*

- **FIXED COLUMN TRACKS.** The rows change under the reader every minute, so
  natural widths meant every poll re-measured the table and the columns jumped.
  Only the section flexes. Headers name the five columns.
- **A ROW HAS AN IDENTITY.** The feed carries no booking id, so `liveKey()` is
  the four things that cannot collide for two different registrations: the
  second, the buyer, the participant, the section. **Rows are keyed by it, never
  by array index** — otherwise React reuses a `<tr>` for a different
  registration and the highlight lands on the wrong person.
- **AN ARRIVAL IS A DIFF AGAINST THE PREVIOUS POLL**, not a timestamp
  comparison: a row can arrive with an older stamp than one already on screen
  (a staff-entered registration backdated by minutes).
- **THE FIRST LOAD HIGHLIGHTS NOTHING.** Every row is new to an empty set, and
  a card that lights up entirely on arrival has a highlight that means nothing —
  the point is to catch the eye when ONE thing lands.
- **The fade is the animation's job; the class comes off on a timer** (10s), so
  a later re-render cannot replay it on a row that is no longer news. Reduced
  motion still gets the highlight, without the movement.
- **UNPAUSING REFRESHES IMMEDIATELY.** Otherwise the reader unticks the box and
  waits up to a minute staring at the list they paused — the opposite of what
  un-pausing a live feed should mean. It is also what makes the arrival
  behaviour testable in a browser without waiting 60 seconds.
- **The bolt pulses.** It is the only thing on the card that moves between
  registrations, so it is what says the widget is still watching. Slow and
  low-contrast on purpose: this sits on a dashboard somebody leaves open, and a
  hard blink is an irritation rather than a signal.

### A timeline instead of a bar chart, and links into Rec

Dan: *"what is the odd bar chart there....how about a moving timeline of the
days/time...and when people pay, it gets a dollar sign."* And: *"the HH owner
and the section should be clickable directly to Rec, can we do that?"*

- **THE BAR CHART SAID ALMOST NOTHING** this card does not say better in words.
  A timeline says **WHEN** — the rush when registration opens, the long quiet
  evening, the burst that just landed — which is the thing somebody watching a
  registration day is watching for. One mark per registration at its own
  minute, staggered across three rows so a cluster reads as a cluster.
- **A PAID REGISTRATION CARRIES A `$`; an unpaid one is a plain dot.**
  Registered and paid-for are different facts and the gap between them is worth
  seeing on a card about money arriving.
- **NOW is drawn.** Without it the last day reads as empty rather than as
  not-yet-happened.
- **A row outside the window is dropped, never clamped** onto the edge, which
  would invent a signup at midnight.

**THE LIST WAS ALWAYS SORTED; THE CLOCK HID IT.** Dan: *"shouldn't this be
sorted by time? look at the times there"* — 11:23a, then 4:04p, then 2:12p.
Newest first, and those are three different **days**, which a column showing
only a clock cannot say. Today keeps the bare time (that is the day being
watched); every other row is prefixed with its weekday, and a rule is drawn
where the day changes — a list scanned in two seconds is read by its shape, not
only by its text.

**THE REC LINKS ARE COPIED, NOT GUESSED.** Both shapes already exist in the
reporting project: `/admin/o/<org>/users/<id>` and
`/admin/o/<org>/programming/sections/<id>`. A link built from the wrong id
renders identically and 404s — the `rec_id` vs `users.id` mistake already
recorded there. So **card v3 carries `User ID`** (`b.customer_user_id`, the
uuid), the org uuid is sent as `recOrgId`, and either missing renders **plain
text**: a link to nowhere is worse than no link.

**`orgMeta` IS A WHITELIST**, so a field the server sends and that map forgets
is silently absent — `recOrgId` has to be copied into it explicitly, and the
spec pins that.

### Guards

`scripts/live-widgets.spec.js` (**96 assertions, in CI**), which LIFTS AND RUNS
the four date helpers rather than regexing them. Mutation-tested four ways, all
failing by name: a "0 signups today" rendered on a dead feed, the live TTL
override removed so the org's 15 minutes wins, "today" taken from the browser's
clock instead of the newest row, and the print exclusion dropped.

**One assertion failed on correct code first time**, and the lesson is the
familiar one: `!/new Date\(r\[/` file-wide fails because other tiles
legitimately build Dates for their own charts. Scope an assertion to the
surface it is about — it slices the widget now.

Plus **eighteen** `ci-check-render.js` cases keyed on **computed values**: the row count,
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
