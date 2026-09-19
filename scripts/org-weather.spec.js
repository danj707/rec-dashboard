#!/usr/bin/env node
"use strict";

/* ── The toolbar's weather card ────────────────────────────────────────────
   LIFTS AND RUNS lib/weather.js rather than regexing it: every defect this
   feature can have is a comparison — a WMO range read the wrong way round, a
   staleness test inverted, a null treated as a zero — and a regex passes on an
   inverted comparison just as happily as on a correct one.

   THE CONTRAST HALF IS COMPUTED, NOT ASSERTED. The card carries its text ON
   the sky, so the palette IS the legibility fix — and a stylesheet reads
   plausibly whichever colours it holds. So this spec parses every gradient
   stop out of dashboard.html and works out the real ratio against that sky's
   declared ink. Prettying up a gradient without re-checking it now fails here
   rather than shipping unreadable.

   IT RE-EXECS UNDER A ZONE BEHIND UTC. `new Date("2026-09-19")` is UTC
   midnight, so west of UTC it is the 18th — and this sandbox and GitHub
   Actions both run UTC, where the broken derivation passes every assertion.
   `America/Los_Angeles` is chosen for that property, not because an org is in
   it.
   ───────────────────────────────────────────────────────────────────────── */

const path = require("path");
const fs = require("fs");

if (!process.env.WX_SPEC_TZ_REEXEC) {
  const r = require("child_process").spawnSync(
    process.execPath, [__filename],
    { stdio: "inherit", env: { ...process.env, TZ: "America/Los_Angeles", WX_SPEC_TZ_REEXEC: "1" } });
  process.exit(r.status === null ? 1 : r.status);
}

const W = require(path.join(__dirname, "..", "lib", "weather.js"));
const SERVER = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const PAGE = fs.readFileSync(path.join(__dirname, "..", "public", "dashboard.html"), "utf8");
const ADMIN = fs.readFileSync(path.join(__dirname, "..", "public", "admin.html"), "utf8");

let passed = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) { passed++; return; }
  failures.push(msg);
}
function eq(actual, expected, msg) {
  ok(actual === expected, `${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
// A throw at CALL time must fail by name rather than killing the run.
function guard(fn, msg) {
  try { return fn(); } catch (err) { failures.push(`${msg} — THREW ${err.message}`); return undefined; }
}

/* ── The timezone pin is only worth having if it can discriminate ───────── */
ok(/^America\/Los_Angeles$/.test(process.env.TZ || ""),
  "the spec must run under a zone behind UTC, or the date derivation is untested");
eq(new Date("2026-09-19").getDay(), 5,
  "sanity: under this zone a bare ISO date parses to the PREVIOUS day — if this is 6 the pin no longer discriminates");
eq(W.skyFor(2), "cloudy", "code 2 is partly cloudy");
eq(W.skyFor(3), "overcast", "code 3 is overcast");
eq(W.skyFor(45), "fog", "code 45 is fog");
eq(W.skyFor(48), "fog", "code 48 is rime fog");
[51, 53, 55, 56, 57].forEach(c => eq(W.skyFor(c), "drizzle", `code ${c} is drizzle`));
[61, 63, 65, 66, 67].forEach(c => eq(W.skyFor(c), "rain", `code ${c} is rain`));
[80, 81, 82].forEach(c => eq(W.skyFor(c), "rain", `code ${c} is a rain shower`));
[71, 73, 75, 77].forEach(c => eq(W.skyFor(c), "snow", `code ${c} is snow`));
[85, 86].forEach(c => eq(W.skyFor(c), "snow", `code ${c} is a snow shower`));
[95, 96, 99].forEach(c => eq(W.skyFor(c), "storm", `code ${c} is a thunderstorm`));

/* THE RULE THAT IS NOT COSMETIC. A code we do not recognise must never paint
   sunshine — the treatment would then be claiming weather it cannot vouch for,
   which is the load-versus-empty mistake this repo already has a rule for. */
[999, -1, 4, 50, 70, 100, null, undefined, "", "abc", NaN].forEach(c => {
  ok(W.skyFor(c) !== "clear", `an unreadable code (${JSON.stringify(c)}) must not read as CLEAR`);
});
eq(W.skyFor(999), "overcast", "an unknown code falls to overcast, which claims nothing");
eq(W.skyFor(undefined), "overcast", "a missing code falls to overcast");

ok(W.WX_SKIES.length === 8, "eight skies");
ok(!W.WX_SKIES.includes("night"), "NIGHT IS NOT A SKY — it is a modifier, or a wet night silently stops raining");
W.WX_SKIES.forEach(s => ok(typeof s === "string" && /^[a-z]+$/.test(s), `sky ${s} is a bare class-safe name`));

/* ── labels ─────────────────────────────────────────────────────────────── */
eq(W.labelFor(0), "Clear", "code 0 reads Clear");
eq(W.labelFor(61), "Light rain", "code 61 reads Light rain");
ok(W.labelFor(999) !== "Clear", "an unknown code must not be LABELLED Clear either");
ok(typeof W.labelFor(999) === "string" && W.labelFor(999).length > 0, "an unknown code still gets a word");

/* ── isWet: what the look-ahead line acts on ────────────────────────────── */
["drizzle", "rain", "snow", "storm"].forEach(s => ok(W.isWet(s), `${s} is wet`));
["clear", "cloudy", "overcast", "fog"].forEach(s => ok(!W.isWet(s), `${s} is not wet`));

/* ── dates and clocks, built from PARTS ─────────────────────────────────── */
eq(W.weekdayOf("2026-09-19"), "Saturday", "2026-09-19 is a Saturday — a UTC-midnight parse says Friday here");
eq(W.weekdayOf("2026-09-20"), "Sunday", "2026-09-20 is a Sunday");
eq(W.weekdayOf("2026-01-22"), "Thursday", "2026-01-22 is a Thursday");
eq(W.weekdayOf(""), "", "no date, no weekday");
eq(W.weekdayOf(null), "", "a null date yields no weekday rather than throwing");
eq(W.clockOf("2026-09-19T18:47"), "6:47 PM", "18:47 is 6:47 PM");
eq(W.clockOf("2026-09-19T06:28"), "6:28 AM", "06:28 is 6:28 AM");
eq(W.clockOf("2026-09-19T00:15"), "12:15 AM", "midnight is 12, not 0");
eq(W.clockOf("2026-09-19T12:00"), "12:00 PM", "noon is 12 PM, not 12 AM");
eq(W.clockOf(""), "", "no stamp, no clock");

/* ── the look-ahead line ────────────────────────────────────────────────── */
const dailyDry = { time: ["2026-09-19", "2026-09-20", "2026-09-21"], weather_code: [0, 1, 3], precipitation_probability_max: [0, 5, 10] };
const dailyWetTomorrow = { time: ["2026-09-19", "2026-09-20", "2026-09-21"], weather_code: [3, 61, 61], precipitation_probability_max: [0, 90, 82] };
const dailyWetToday = { time: ["2026-09-19", "2026-09-20"], weather_code: [61, 0], precipitation_probability_max: [85, 0] };
const dailySnow = { time: ["2026-01-22", "2026-01-23"], weather_code: [3, 73], precipitation_probability_max: [10, 80] };
const dailyThin = { time: ["2026-09-19", "2026-09-20"], weather_code: [3, 61], precipitation_probability_max: [0, 40] };

eq(W.aheadFrom(dailyDry), null, "a dry week says nothing rather than printing a 0%");
eq(W.aheadFrom(dailyWetTomorrow), "Rain arrives Sunday — 90%", "the next wet day is named, with its own chance");
eq(W.aheadFrom(dailyWetToday), "Rain likely today — 85%", "a wet TODAY is said plainly rather than pointing at tomorrow");
eq(W.aheadFrom(dailySnow), "Snow arrives Friday — 80%", "snow is called snow, not rain");
eq(W.aheadFrom(dailyThin), null, `below the ${W.WX_AHEAD_MIN_PROB}% floor the line is withheld`);
eq(W.aheadFrom(null), null, "no daily block, no look-ahead");
eq(W.aheadFrom({ time: ["2026-09-19", "2026-09-20"], weather_code: [3, 61] }), null,
  "a wet day with NO probability is withheld — the line's whole value is the number on it");
ok(W.WX_AHEAD_MIN_PROB >= 40 && W.WX_AHEAD_MIN_PROB <= 70,
  "the look-ahead floor is a judgement, but a 10% chance is not a forecast worth acting on");

/* ── the readout ────────────────────────────────────────────────────────── */
const rawDay = {
  current: { time: "2026-09-19T08:15", temperature_2m: 53.8, apparent_temperature: 49.4, is_day: 1, weather_code: 0, wind_speed_10m: 7.0 },
  daily: Object.assign({ sunrise: ["2026-09-19T06:28", "2026-09-20T06:30"], sunset: ["2026-09-19T18:47", "2026-09-20T18:45"], temperature_2m_max: [64.0, 60.3], temperature_2m_min: [50.6, 47.4] }, dailyWetTomorrow),
};
const day = guard(() => W.readoutFrom(rawDay), "readoutFrom(day)") || {};
eq(day.sky, "clear", "a clear reading paints a clear sky");
eq(day.night, false, "is_day 1 is not night");
eq(day.temp, 54, "53.8 rounds to 54");
eq(day.feels, 49, "49.4 rounds to 49");
eq(day.hi, 64, "today's high comes from daily[0]");
eq(day.lo, 51, "today's low comes from daily[0]");
eq(day.wind, "7 mph", "the wind carries its unit");
eq(day.sunLabel, "Sunset 6:47 PM", "by day the useful clock is the sunset");
eq(day.day, "Saturday", "the readout names its own day");
eq(day.ahead, "Rain arrives Sunday — 90%", "the look-ahead rides on the readout");
eq(day.label, "Clear", "the label comes from the code");

const rawNight = JSON.parse(JSON.stringify(rawDay));
rawNight.current.is_day = 0;
rawNight.current.temperature_2m = 50.6;
const night = guard(() => W.readoutFrom(rawNight), "readoutFrom(night)") || {};
eq(night.night, true, "is_day 0 is night");
eq(night.sunLabel, "Sunrise 6:30 AM", "after dark the next sunrise is TOMORROW'S — today's has been and gone");

const rawOneDay = JSON.parse(JSON.stringify(rawDay));
rawOneDay.current.is_day = 0;
rawOneDay.daily.sunrise = ["2026-09-19T06:28"];
eq((guard(() => W.readoutFrom(rawOneDay), "readoutFrom(one day)") || {}).sunLabel, "Sunrise 6:28 AM",
  "with only one day on file the night falls back to that day's sunrise rather than printing nothing");

eq(W.readoutFrom(null), null, "no payload, no readout");
eq(W.readoutFrom({}), null, "no current block, no readout");
eq(W.readoutFrom({ current: { weather_code: 0 } }), null,
  "NO TEMPERATURE, NO CARD — it is the one field with no honest fallback");
const noWind = JSON.parse(JSON.stringify(rawDay));
delete noWind.current.wind_speed_10m;
eq((guard(() => W.readoutFrom(noWind), "readoutFrom(no wind)") || {}).wind, null,
  "a missing wind is null, never the string NaN mph");
const noDaily = { current: rawDay.current };
const bare = guard(() => W.readoutFrom(noDaily), "readoutFrom(no daily)") || {};
eq(bare.temp, 54, "a reading with no daily block still carries its temperature");
eq(bare.hi, null, "...and nulls the figures it cannot support");
eq(bare.ahead, null, "...and says nothing about tomorrow");

/* ── staleness ──────────────────────────────────────────────────────────── */
const now = 1_758_000_000_000;
eq(W.ageStateOf({ ts: now }, now), "fresh", "a reading taken now is fresh");
eq(W.ageStateOf({ ts: now - 60_000 }, now), "fresh", "a minute old is still fresh");
eq(W.ageStateOf({ ts: now - 30 * 60_000 }, now), "stale", "half an hour old is stale — serve it, refresh behind the reader");
eq(W.ageStateOf({ ts: now - 5 * 3600_000 }, now), "expired",
  "FIVE HOURS OLD IS NOT SERVED: an org nobody opened for a week must not be shown last Tuesday's snow");
eq(W.ageStateOf(undefined, now), "expired", "no entry is expired, never fresh");
eq(W.ageStateOf({}, now), "expired", "an entry with no timestamp is expired");
eq(W.ageStateOf({ ts: now + 3600_000 }, now), "expired", "a reading from the future is a broken clock, not a fresh reading");
ok(W.WX_FRESH_MS < W.WX_STALE_MS, "the fresh window sits inside the stale one");
ok(W.WX_STALE_MS <= 6 * 3600_000, "the stale window is hours, not days");

/* ── coordinates are the gate ───────────────────────────────────────────── */
eq(JSON.stringify(W.coordsOf({ coords: { lat: 42.3709, lon: -71.1828 } })), JSON.stringify({ lat: 42.3709, lon: -71.1828 }), "real coordinates resolve");
eq(W.coordsOf({}), null, "an org with no coords gets NO weather — never a guess from its name");
eq(W.coordsOf(null), null, "a missing org is not a crash");
eq(W.coordsOf({ coords: {} }), null, "an empty coords block is not coordinates");
eq(W.coordsOf({ coords: { lat: "x", lon: 1 } }), null, "an unreadable latitude is refused");
eq(W.coordsOf({ coords: { lat: 91, lon: 0 } }), null, "a latitude past the pole is refused");
eq(W.coordsOf({ coords: { lat: 0, lon: 181 } }), null, "a longitude past the meridian is refused");
eq(JSON.stringify(W.coordsOf({ coords: { lat: 0, lon: 0 } })), JSON.stringify({ lat: 0, lon: 0 }), "zero is a real coordinate, not a missing one");

/* ── the request ────────────────────────────────────────────────────────── */
const url = W.requestUrlFor({ lat: 42.37, lon: -71.18 });
ok(/timezone=auto/.test(url),
  "TIMEZONE=AUTO IS LOAD-BEARING: without it is_day and every daily boundary are computed in the wrong zone");
ok(/is_day/.test(url) && /weather_code/.test(url), "the current block asks for the two fields the sky is chosen from");
["sunrise", "sunset", "precipitation_probability_max", "temperature_2m_max", "temperature_2m_min"].forEach(f =>
  ok(url.includes(f), `the daily block asks for ${f}`));
ok(/temperature_unit=fahrenheit/.test(url) && /wind_speed_unit=mph/.test(url), "US orgs, US units");
ok(/^https:\/\/api\.open-meteo\.com\//.test(url), "over https, to the documented host");


/* ── The library is a TWIN, and the note that says so must survive ───────── */
const LIB = fs.readFileSync(path.join(__dirname, "..", "lib", "weather.js"), "utf8");
ok(/THIS FILE EXISTS TWICE/.test(LIB),
  "lib/weather.js must keep the note that rental-report holds the same file — no CI job on either side can "
  + "assert the two agree, so the only thing stopping them drifting is that the next reader is told");

/* ── Server wiring ───────────────────────────────────────────────────────── */
function sliceIn(text, from, to, label) {
  const a = text.indexOf(from);
  const b = a < 0 ? -1 : text.indexOf(to, a + from.length);
  ok(a >= 0 && b > a, `slice for ${label} was not found — every assertion under it would pass on nothing`);
  return a >= 0 && b > a ? text.slice(a, b) : "";
}
const fnFor     = sliceIn(SERVER, "function orgWeatherFor(", "\n// \u2550", "orgWeatherFor");
const fnEnabled = sliceIn(SERVER, "function orgWeatherEnabled(", "function orgWeatherFor(", "orgWeatherEnabled");
const fnRefresh = sliceIn(SERVER, "async function refreshOrgWeather(", "/* The per-org kill switch", "refreshOrgWeather");

/* THE FRONT DOOR MUST NOT BLOCK ON A THIRD PARTY. /:org/api/config is what the
   whole dashboard waits on, so this one is synchronous by design — an `await`
   here puts api.open-meteo.com in the critical path of every load. */
ok(!/^\s*async function orgWeatherFor/m.test(SERVER),
  "orgWeatherFor must stay SYNCHRONOUS — the config route is what the dashboard waits on");
ok(!/await/.test(fnFor), "orgWeatherFor must not await anything");
ok(/refreshOrgWeather\(slug\)/.test(fnFor), "it must kick a refresh behind the reader when the reading is not fresh");
ok(/state !== ['"]fresh['"]/.test(fnFor), "...and only when it is not fresh, or every load re-fetches");
ok(/state === ['"]expired['"] \? null/.test(fnFor),
  "an EXPIRED reading is not served: an org nobody opened for a week must not be shown last Tuesday's snow");
ok(/coordsOf\(ORGS\[slug\]\)/.test(fnFor),
  "no coordinates, no weather — never a guess from the org's name");
ok(/orgWeatherEnabled\(slug\)/.test(fnFor), "the per-org kill switch is checked");

/* DEFAULTS ON, so the test is `!== false` and never truthiness: every org
   already has a saved toggles object with no `weather` key in it, and reading
   that as OFF would ship the feature dark for everybody. */
ok(/!==\s*false/.test(fnEnabled),
  "orgWeatherEnabled must test `!== false` — a truthy read makes an untoggled org (which is all of them) read as OFF");
ok(!/t\.weather\s*(\?|&&|\|\|)/.test(fnEnabled) || /!==\s*false/.test(fnEnabled),
  "the default must be ON");

ok(/if \(_wxInFlight\.has\(slug\)\) return;/.test(fnRefresh),
  "a refresh already running must not be started again — the card is read on every load");
ok(/if \(readout\) _wxCache\.set/.test(fnRefresh),
  "AN UNREADABLE READING MUST NOT OVERWRITE A GOOD ONE — the last good answer keeps serving and ages out on its own");
ok(/AbortSignal\.timeout/.test(fnRefresh), "the outbound call is bounded");

/* BOTH config routes send it. A shared dashboard is still that org's. */
eq((SERVER.match(/weather: orgWeatherFor\(/g) || []).length, 2,
  "both the org's own config route and the share route must send the readout");

/* ── Coordinates ─────────────────────────────────────────────────────────── */
const orgsBlock = sliceIn(SERVER, "const ORGS = {", "\n};", "ORGS");
/* PINNED AS LITERALS, and carried over from rental-report's own ORGS on the
   SAME organisation uuid rather than looked up again. The two projects sharing
   an org must not disagree about where it is. */
const COORDS = {
  watertown:    { lat: 42.3709, lon: -71.1828 },
  niagarafalls: { lat: 43.0962, lon: -79.0377 },
  torrance:     { lat: 33.8358, lon: -118.3406 },
};
for (const [slug, want] of Object.entries(COORDS)) {
  const seg = sliceIn(orgsBlock, `  ${slug}: {`, "\n  }", `ORGS.${slug}`);
  const m = /coords:\s*\{\s*lat:\s*(-?[\d.]+),\s*lon:\s*(-?[\d.]+)\s*\}/.exec(seg);
  ok(!!m, `${slug} must carry coords, or its toolbar never paints`);
  if (m) {
    eq(Number(m[1]), want.lat, `${slug} latitude`);
    eq(Number(m[2]), want.lon, `${slug} longitude`);
    const c = guard(() => W.coordsOf({ coords: { lat: Number(m[1]), lon: Number(m[2]) } }), `coordsOf(${slug})`);
    ok(c !== null, `${slug}'s coords must survive coordsOf — an out-of-range pair yields no weather at all`);
  }
}

/* ── The page ────────────────────────────────────────────────────────────── */
ok(/weather: json\.weather \|\| null/.test(PAGE),
  "`weather` must be in orgMeta's whitelist — a key the server sends and that map forgets is silently absent");
ok(/\|\| null/.test((/weather: json\.weather[^,;]*/.exec(PAGE) || [""])[0]),
  "it must default to NULL and not {} — an empty object is truthy and would render a card with no temperature");
ok(/<WeatherCard wx=\{orgMeta\.weather\} \/>/.test(PAGE), "the card is rendered");

const cardFn = sliceIn(PAGE, "function WeatherCard({ wx })", "\nfunction CompareDropdown", "WeatherCard");
ok(/if \(!wx \|\| wxcNum\(wx\.temp\) === null\) return null;/.test(cardFn),
  "no reading, or one with no temperature, renders NOTHING — not a card with a blank where the number goes");
ok(/wxcSky\(wx\.sky\)/.test(cardFn),
  "the sky must go through the whitelist: the class name is built from the payload, and an unknown value "
  + "paints `wxc-<whatever>`, which has no background rule and renders a transparent card in the toolbar");

const skyFn = sliceIn(PAGE, "function wxcSky(", "const WXC_FX ", "wxcSky");
ok(/WXC_SKIES\.indexOf\(v\) >= 0/.test(skyFn), "wxcSky checks membership");
ok(/: ['"]overcast['"]/.test(skyFn), "...and falls back to overcast, which claims nothing — never to clear");

/* NIGHT IS A MODIFIER, NOT A SKY. A single `night` class would silently drop
   the weather: rain at 9pm would stop raining. */
ok(/wxc wxc-\$\{sky\}\$\{night \? ' wxc-night' : ''\}/.test(cardFn),
  "wxc-night must ride ON TOP of the sky class rather than replacing it");
const fxNight = sliceIn(PAGE, "const WXC_FX_NIGHT", "\n\n", "WXC_FX_NIGHT");
["rain: 'rain'", "drizzle: 'drizzle'", "snow: 'snow'", "storm: 'rain'"].forEach(pair =>
  ok(fxNight.includes(pair), `a wet night still falls: ${pair} must survive into the night map`));

/* NIGHT IS THE ORG'S CLOCK, NOT THE VIEWER'S SETTING. The dashboard already
   has a dark mode and it belongs to whoever is looking at it. */
ok(!/data-theme/.test(cardFn), "the card must never touch data-theme — dark mode is the viewer's own choice");

ok(/\.print-header \.wxc \{ display: none/.test(PAGE),
  "the PDF is a document about a date range; a live sky is not part of it");

/* ── The admin kill switch ───────────────────────────────────────────────── */
ok(/toggleOrg\('\$\{o\.slug\}','weather'/.test(ADMIN), "the admin grid can turn it off without a deploy");
ok(/o\.toggles\.weather \? 'checked'/.test(ADMIN), "...and draws the box from the org's own state");
eq((SERVER.match(/weather: orgWeatherEnabled\(/g) || []).length, 2,
  "BOTH payloads that carry `toggles` must normalise it — the admin grid and the org's own config route "
  + "describing one switch differently is how the eye and the page disagree");
ok(/weather: orgWeatherEnabled\(slug\)/.test(SERVER),
  "THE GRID AND THE SERVER MUST READ ONE PREDICATE. Every org has a toggles object with no `weather` key, so a "
  + "raw read draws the box UNCHECKED while the card is on — the inverted-eye bug, one repo over");

/* ── The page must not grow its own copy of the library's rules ──────────── */
ok(!/weather_code|WMO|=== 45 \|\| /.test(cardFn),
  "the sky is decided server-side by lib/weather.js; a second WMO ladder on the page is a second thing to get wrong");

/* ── `Number(null)` IS 0, AND IT PAINTS A CONFIDENT NOTHING ───────────────
   LIFTED AND RUN, not read: `Number.isFinite(Number(null))` is TRUE, so the
   obvious guard lets a reading with no temperature through and the card says
   0°. That is the defect this feature already shipped once on the reporting
   side — a missing weather code read as code 0 and painted sunshine — and the
   render check caught it here on the first run of these cases. A regex over
   the guard passes on the broken version. */
const wxcNumSrc = sliceIn(PAGE, "function wxcNum(v) {", "\n}\n", "wxcNum") + "\n}";
const wxcNum = guard(() => new Function(wxcNumSrc + "\nreturn wxcNum;")(), "lifting wxcNum");
if (typeof wxcNum === "function") {
  eq(wxcNum(null), null, "a missing temperature is NOT 0 — Number(null) is, which is the whole bug");
  eq(wxcNum(undefined), null, "an absent field is not 0");
  eq(wxcNum(""), null, "an empty string is not 0");
  eq(wxcNum(false), null, "a boolean is not a reading — Number(false) is 0");
  eq(wxcNum(true), null, "...nor is true a temperature of 1");
  eq(wxcNum(NaN), null, "NaN is not a reading");
  eq(wxcNum("x"), null, "an unparseable string is not a reading");
  eq(wxcNum(0), 0, "a REAL zero survives — it is 0°F somewhere every winter");
  eq(wxcNum(-9), -9, "...and so does a negative one");
  eq(wxcNum("48"), 48, "a numeric string reads as its number");
}
ok(/wxcNum\(wx\.temp\) === null/.test(cardFn),
  "the temperature gate must go through the strict reader, not Number.isFinite(Number(...))");
ok(!/Number\.isFinite\(Number\(/.test(cardFn),
  "no raw Number.isFinite(Number(x)) may survive in the card — it is true for null, '' and false");


/* ── THE INK CLEARS THE SKY: computed, not eyeballed ──────────────────────
   The load-bearing palette rule, and the one no source assertion can see —
   a gradient reads plausibly whatever hexes it holds. Every stop of every sky
   is measured against that sky's declared ink at WCAG AA for small text.

   It is also what makes the day/night split a rule rather than a preference:
   the day ramps have to stay light enough for dark ink and the night ones dark
   enough for light ink, or this fails. */
function lum(hex) {
  const n = hex.replace("#", "");
  const v = [0, 2, 4].map(i => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
// sanity: the formula itself, before anything is judged by it
ok(Math.abs(ratio("#ffffff", "#000000") - 21) < 0.01, "sanity: white on black is 21:1");
ok(Math.abs(ratio("#767676", "#ffffff") - 4.54) < 0.05, "sanity: the classic 4.5:1 grey measures 4.54");

const SKIES = ["clear", "cloudy", "overcast", "fog", "drizzle", "rain", "snow", "storm"];
function ruleFor(sel) {
  const re = new RegExp("\\" + sel + "\\s*\\{([^}]*)\\}");
  const m = re.exec(PAGE);
  return m ? m[1] : "";
}
function stops(body) { return (body.match(/#[0-9a-fA-F]{6}/g) || []).filter(h => /linear-gradient/.test(body)); }

const dayInk = {};
["clear", "cloudy"].forEach(s => { dayInk[s] = "#2b4a62"; });
["overcast", "fog", "snow"].forEach(s => { dayInk[s] = "#32383e"; });
["drizzle", "rain", "storm"].forEach(s => { dayInk[s] = "#dde6ee"; });
const NIGHT_INK = "#eef2f8", NIGHT_SUB = "#a8b5c8";

for (const sky of SKIES) {
  /* DAY */
  const body = ruleFor(".wxc-" + sky);
  ok(/linear-gradient/.test(body), `.wxc-${sky} must declare a day gradient`);
  const ink = (/color:\s*(#[0-9a-fA-F]{6})/.exec(body) || [])[1];
  ok(!!ink, `.wxc-${sky} must declare its ink beside its sky — the two are one decision`);
  const all = body.match(/#[0-9a-fA-F]{6}/g) || [];
  const grad = ink ? all.filter(h => h.toLowerCase() !== ink.toLowerCase()) : all;
  ok(grad.length >= 2, `.wxc-${sky} should have several gradient stops`);
  grad.forEach(stop => {
    const r = ratio(ink || "#000000", stop);
    ok(r >= 4.5, `.wxc-${sky}: the temperature on ${stop} measures ${r.toFixed(2)}:1 — a card carries its text ON `
      + "the sky, so the palette is the only place legibility can come from");
  });
  // the second line is smaller still, so it is held to the same bar
  grad.forEach(stop => {
    const r = ratio(dayInk[sky], stop);
    ok(r >= 4.5, `.wxc-${sky}: the hi/lo line on ${stop} measures ${r.toFixed(2)}:1`);
  });

  /* NIGHT */
  const nbody = ruleFor(".wxc-night.wxc-" + sky);
  ok(/linear-gradient/.test(nbody), `.wxc-night.wxc-${sky} must declare its own ramp — night is a modifier on `
    + "EVERY sky, so a missing one leaves a night card painted in daylight");
  (nbody.match(/#[0-9a-fA-F]{6}/g) || []).forEach(stop => {
    const r1 = ratio(NIGHT_INK, stop), r2 = ratio(NIGHT_SUB, stop);
    ok(r1 >= 4.5, `.wxc-night.wxc-${sky}: the temperature on ${stop} measures ${r1.toFixed(2)}:1`);
    ok(r2 >= 4.5, `.wxc-night.wxc-${sky}: the hi/lo line on ${stop} measures ${r2.toFixed(2)}:1`);
  });
}

/* ── report ──────────────────────────────────────────────────────────────
   LAST STATEMENT IN THE FILE, deliberately: this has been got wrong three
   times across these two projects — assertions appended below the print run,
   count up, and can never be reported. */
if (failures.length) {
  console.error(`\n${failures.length} FAILED:`);
  failures.forEach(f => console.error("  ✗ " + f));
  console.error(`\n${passed} passed, ${failures.length} failed.`);
  process.exit(1);
}
console.log(`${passed} assertions passed.`);
