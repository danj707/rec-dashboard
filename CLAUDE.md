# Project notes for Claude

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
