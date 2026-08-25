---
name: rec-training-video
description: "Produce a narrated, captioned, Rec-branded training/walkthrough video of the rec.us admin (or any logged-in rec.us page) from a plain-language prompt. Use whenever someone asks for a training video, walkthrough video, screen recording, demo video, 'how-to' video, or Loom-style tutorial of a Rec feature or admin section — e.g. 'make a training video of the Finance settings', 'record a walkthrough of the memberships page', 'demo video for the check-in flow'. The skill asks for a short script or blurb, a target length, a narrator voice, and which team to send viewers to in the outro (Customer Experience, Sales, etc.), then logs in, clicks through the real pages, adds an ElevenLabs voiceover synced to on-screen captions, and wraps it in a Rec title card and a closing contact splash. Outputs an MP4 for the requester to review."
---

# Rec Training Video

Turns a plain-language request like *"walk through the Finance settings, about two minutes"*
into a finished MP4: a **Rec title card** → a **narrated + captioned click-through** of the
real admin pages → a **narrated outro splash** with the Customer Experience contact.

You gather a few inputs from the requester, log in, learn how the pages actually work,
write the narration, and run a deterministic builder (`make-video.js`). Production settings
(voice, tempo, fonts, logo, cards) are fixed in `config.json` so every video looks and
sounds identical. **The requester reviews the finished video for correctness** — so keep
narration factual and flag anything you were unsure about when you deliver.

## Step 0 — Intake (ask the requester first)

**Ask the requester for these four things** (in one short message). Everything else has a
sensible default — see "Auto-defaulted" below — so don't make them answer more than this.

1. **Script blurb** — what the video should say. Two ways to give it:
   - **Paste an exact script** — the wording you want spoken; I'll use it verbatim. If it's
     more than one screen, tell me which lines go with which section so each block lands on
     the right page.
   - **Give a short blurb** — a few sentences on what to cover, and I'll write the script.
   Either way you review the finished video for correctness.
2. **Length** — a rough target (e.g. "~30 seconds", "~1 minute", "2–3 minutes"). Pacing
   auto-fits each section to its narration, so length ≈ sum of what's said; I'll size the
   number of sections and words to hit it.
3. **Voice** — which narrator. Default **Adam** (deep, neutral male — matches the existing
   Finance / General Ledger / Meet Seb series, so keep it for anything in that set). Offer
   these presets and pass the chosen ID via the spec's `voiceId`; the requester may also
   paste any ElevenLabs voice ID:
   | Voice | Style | voiceId |
   |---|---|---|
   | Adam (default) | deep, neutral male | `pNInz6obpgDQGcFmaJgB` |
   | Rachel | calm, warm female | `21m00Tcm4TlvDq8ikWAM` |
   | Antoni | friendly male | `ErXwobaYiN019PkySvjV` |
   | Bella | soft, upbeat female | `EXAVITQu4vr4xnSDxMaL` |
   | Josh | younger male | `TxGEqnHWrfWFTfGW9XjX` |
   | Domi | confident female | `AZnzlk1XvdvUeBnXmlld` |
   These are standard ElevenLabs preset IDs (no `voices_read` scope needed). If a pasted ID
   fails, fall back to Adam and tell the requester.
4. **Outro — which team to send viewers to at the end.** The closing splash names a team and
   a contact, and the sign-off speaks it. Pick one:
   | Outro | Card label | Email |
   |---|---|---|
   | Customer Experience (default) | Reach out to the Rec Customer Experience team. | `partnersupport@rec.us` |
   | Sales | Reach out to the Rec Sales team. | *confirm the address with the requester* |
   | Onboarding / Implementation | Reach out to your Rec onboarding team. | *confirm the address* |
   | Custom (a specific dept/person) | *their wording* | *their address* |

   Only Customer Experience has a known default address — for any other team, get the exact
   email from the requester before building (don't guess an address). Set it via the spec's
   `outro` object (see below); leave it out for the Customer Experience default.

**Auto-defaulted (don't ask unless the request is unusual):**
- **Login** — the **bundled Rec University admin** (`niagara+admin6@rec.us`) in
  `credentials.json`. Only ask for a login to record a **different** org; then pass it via
  `REC_EMAIL` / `REC_PASSWORD` for that one build and **never write it to disk or commit it**.
  (The ElevenLabs key is bundled too.)
- **Org** — the **Rec University** demo org (`9f032cf2-0fc4-440e-b2f3-2f8382c9ca7f`, public
  page `/organizations/rec-university`). Only use another org if the requester names one —
  then get its admin URL (`/admin/o/<uuid>/…`) or resolve the UUID with `search_organizations`.
- **Example link** — if they happen to give a URL to the exact page the video is about, use
  it as the `start` URL; it removes guesswork. Not required.
- **Specific context** — audience, things to emphasize/avoid, terminology, a specific example
  record to open. Take it if offered.

If a required input is missing and you can't safely default it, ask a short follow-up
rather than guessing. Don't proceed to recording without a working login and a clear target.

### Credential handling

The **Rec University demo login is bundled** in `credentials.json` for zero-setup recording of the training org — that's intentional. Any **other** login a requester gives you (to record a different org) is used **only** for that one build, then discarded:

- Pass a provided login **through the environment only** (`REC_EMAIL='…' REC_PASSWORD='…' node make-video.js …`). Never put a requester-provided login in a spec file, a script, a note, or any file.
- The builder uses the login solely to fill the rec.us login form; it writes it nowhere. Intermediate files go to a temp dir outside the repo, deleted when the build finishes. The finished MP4 contains no credentials.
- **Never commit a requester-provided login**, and don't echo passwords back or print them in logs.

### Demo data — never show real resident PII

When a video needs to show people — a user, a household, a profile, a search result, a roster — use a **fake test household**, not the live directory, so no real resident's name, email, phone, or birthdate ever lands on screen:

- **Rec University demo org (`9f032cf2-0fc4-440e-b2f3-2f8382c9ca7f`):** use **Ron Swanson's Household** — owner `niagara@rec.us`, household id `ced1aee0-e89d-404c-abe1-c0ce27bd14f4` (full URL `/admin/o/9f032cf2-0fc4-440e-b2f3-2f8382c9ca7f/users/ced1aee0-e89d-404c-abe1-c0ce27bd14f4`). It's fully fake (Parks & Rec) data with lots of members, bookings, and transactions. Point every people-related step at this household.
- **Avoid these as general shots — they expose real PII:** the **Users directory** (`/users`, even filtered) and a household's **Profiles tab** both list real residents' emails, phones, and birthdates. Safe to show: a household's **overview / Bookings** (names only) and the **Groups** list (group names, coverage, counts — no individuals).
- **Other orgs:** ask the requester for their designated fake/test household before showing any personal data; don't default to the live directory.
- After building any video that touched people data, sample frames and confirm no real emails/phones/birthdates are visible before delivering.

## What's fixed vs. what you provide

**Fixed (config.json — don't change unless the user asks):**
- Voice: ElevenLabs **Adam** (`pNInz6obpgDQGcFmaJgB`), model `eleven_turbo_v2_5`.
- Tempo: each section stays on screen for `narration length + ~2.9s`; caption updates the instant you navigate.
- Brand: **Inter** typeface + the **Rec wordmark**, "REC TRAINING VIDEO" title card, outro splash to **partnersupport@rec.us**.
- 1280×720, 25fps, H.264 + AAC.

**You provide (a `spec.json`):** the start URL, the cards to click, and the caption + narration text per section. See `examples/finance-settings.spec.json` for the full shape.

## Prerequisites (check first, tell the user if missing)

- Login: bundled Rec University admin in `credentials.json`; override with `REC_EMAIL` / `REC_PASSWORD` for a different org (build only, never committed).
- ElevenLabs key: **bundled** in `credentials.json` (shared Rec key); `ELEVENLABS_API_KEY` overrides it.
- Tools: `node` with Playwright, `ffmpeg` (full build, for the MP4 muxer), Chromium (pre-installed at `/opt/pw-browsers`). If `ffmpeg` is the minimal Playwright build, `apt-get install -y ffmpeg`.
- Behind the CCR agent proxy, the builder handles TLS itself (pins the proxy CA, caps TLS at 1.2, reads `HTTPS_PROXY`). No action needed.

## Workflow

### 1. Resolve the target and org
- From the narrative, identify the section/flow and the **org UUID** (rec.us admin URLs look like `/admin/o/<uuid>/...`). Resolve a named org's UUID with `search_organizations`. Note the base path, e.g. `https://www.rec.us/admin/o/<uuid>/settings/finance`.

### 2. Discover the subpages (build the click list)
Do NOT guess the page structure. Get the real one:
- **Log in and look**: with the provided login, open the start page and read the section-card headings and breadcrumb (this is what the tour clicks). A quick throwaway Playwright script is fine — reuse the launch opts from `make-video.js` (proxy + TLS pin) so it works behind the proxy.
- Or, to enumerate every subpage an admin actually uses, query PostHog pageviews:
  `SELECT DISTINCT replaceRegexpAll(properties.$pathname,'[0-9a-f-]{36}',':id') FROM events WHERE event='$pageview' AND properties.$pathname LIKE '/admin/o/%/<section>%'`.
- Confirm each intended page actually renders (no redirect to `/locations`) before including it.

### 3. Learn how each page works (so narration is accurate)
For every page, read its real content (screenshot or dump `main` innerText while logged in) and, when it's data/behavior you can't see in the UI, verify with the Staff MCP (`query_subagent`, `discover_schema`). Narration must describe what's actually there — never invent fields or behavior. This is what the requester will check.

### 4. Write the spec
Copy an example and edit. Top-level: `title`/`subtitle` (title card), `start` (landing URL — the example link if they gave one), optional `baseUrl` (non-prod host), optional `voiceId` (chosen narrator), `intro`, optional `back` (breadcrumb link text to return between sections). Optional per-video overrides (none needed for a standard video):
- `outro`: **who/department to reference at the end** (intake #7). Any of `{ title, sub, email, narration }` — each falls back to the house default. `title` is the big word (default "Questions?"), `sub` the line under it, `email` the contact chip, `narration` the spoken sign-off. Write the narration phonetically so TTS reads it right (`@` → "at", `.` → "dot", `.us` → "dot you ess"). Example: `"outro": { "sub": "Reach out to the Aquatics Department.", "email": "aquatics@townpool.gov", "narration": "Thanks for watching. Questions? Reach out to the Aquatics Department at aquatics at townpool dot gov." }`.
- `voiceSettings`: `{ stability, style, ... }` to shape delivery for this video (higher `style` = livelier).
- `tempo`: `{ leadMs, tailMs, settleMs, scrollChunks }` to pace this video (bigger `tailMs` = slower/airier) without editing `config.json`.
- `noLogin: true`: record the **logged-out resident/public site** (e.g. `/organizations/<slug>`) instead of logging into the admin.

Per section provide:
- `card`: exact on-screen text of the card/row to click (SPA nav keeps the caption overlay alive). Use `path` instead for a direct URL if there's no card to click.
- `title` + `lines`: the on-screen caption (short; `lines` is an array, one per line).
- `narration`: 1–3 spoken sentences. Write for the ear — expand abbreviations the way they should be *said* ("GL" reads fine; write "partner support at rec dot us", "twelve months", etc.).
Size the number of sections and narration length to the requester's target length. Keep narration tight and factual.

**Show what you're talking about (important).** Each section's on-screen page must match its narration — don't park on a random or landing page while describing something else. Choose the `path`/`card` for a section so the thing the narration references is actually visible:
- When narration says "here," "this page," "this list," or names a specific field/button/tab (e.g. "the Facilitators field," "the Finance tab"), make sure that screen or element is on screen for that section — navigate there (or click into it) rather than describing it from afar.
- If a point genuinely spans a place you can't or shouldn't show (a modal you can't deep-link to, a page with real PII, a feature in a different area), keep that section's narration **general** and don't reference on-screen specifics that aren't visible — or move to a page where it *is* visible.
- It's fine (and good) to reuse the same page across two sections when both are about that page; it's the mismatch — talking about X while showing Y — to avoid.
- This doesn't have to be perfect, but default to matching the words to the screen; when in doubt, pick the page the viewer would expect to be looking at for that sentence.

### 5. Build
Pass the login through the environment for this one invocation (do not hard-code it in the spec or write it to a file):
```bash
cd .claude/skills/rec-training-video
REC_EMAIL='<email>' REC_PASSWORD='<password>' \
  node make-video.js examples/your-spec.json ../../Rec-Training_<Topic>.mp4
```
The ElevenLabs key comes from the bundled `credentials.json` (override with `ELEVENLABS_API_KEY`). To record a non-production host, set `baseUrl` in the spec or `REC_BASE_URL`. Runs narrate → record → mux → brand and writes the MP4. ~2–4 min depending on length (login + full-page loads go through the proxy).

### 6. Verify, then hand off for review
- Confirm duration ≈ title(4.8s) + sum(section dwells) + outro, and that both a video and audio stream exist (`ffprobe`).
- Sample a few frames (`ffmpeg -ss <t> -i out.mp4 -frames:v 1 f.png`) to confirm captions match their pages and the title/outro cards render.
- Spot-check audio alignment: speech during sections, silence in the gaps.
- Deliver with `SendUserFile` (display: render). Tell the requester it's a **draft for their review**, name anything you were uncertain about (a field you couldn't verify, a page that behaved oddly), and offer to re-cut with fixes.

## Consistency across a set
Reuse the same `config.json` for every video in a series so voice, pacing, and branding match. Only the spec's `title`, `subtitle`, and per-section text change. Keep output names consistent, e.g. `Rec-Training_<Topic>.mp4`.

## Tuning knobs (config.json)
- `tts.voiceId` / `voiceName` — swap the narrator (the provided key may lack `voices_read`; pass a known voice ID). `tts.voiceSettings.stability` etc. shape delivery.
- `tempo.leadMs` / `tailMs` — pacing (how long a section lingers after its line ends). Raise `tailMs` for a slower feel.
- `brand.outro.email` and copy — change the contact or wording.
- `brand.titleCardSeconds` — title-card hold time.

## Files
- `make-video.js` — orchestrator (narrate → record → mux → brand). Login via `REC_EMAIL`/`REC_PASSWORD`; site via spec `baseUrl` / `REC_BASE_URL`; narration key bundled.
- `config.json` — fixed production settings (voice, tempo, brand).
- `card.html` / `render-card.js` — the Rec title + outro cards.
- `overlay.js` — the caption + cursor overlay injected into each page.
- `credentials.json` — bundled ElevenLabs key only (no login).
- `examples/` — sample specs to copy.

## Scope note
The packaged builder records **click-through walkthroughs** (navigate to pages / click cards, describe them). For flows that need live interaction with streaming responses (e.g. typing into Rec AI / Seb chat and waiting for it to think), that needs a hand-built recorder with think-gap compression — out of scope for the one-command builder; do it as a bespoke script if asked.
