---
name: rec-training-video
description: "Produce a narrated, captioned, Rec-branded training/walkthrough video of the rec.us admin (or any logged-in rec.us page) from a plain-language prompt. Use whenever someone asks for a training video, walkthrough video, screen recording, demo video, 'how-to' video, or Loom-style tutorial of a Rec feature or admin section — e.g. 'make a training video of the Finance settings', 'record a walkthrough of the memberships page', 'demo video for the check-in flow'. Logs into rec.us, clicks through the pages, adds an ElevenLabs voiceover synced to on-screen captions, and wraps it in a Rec title card and a 'Thanks for watching / partnersupport@rec.us' outro. Outputs an MP4."
---

# Rec Training Video

Turns a prompt like *"make a training video walking through the Finance settings"* into a
finished MP4: a **Rec title card** → a **narrated + captioned click-through** of the real
admin pages → a **narrated outro splash** with the Customer Experience contact.

The heavy lifting is a deterministic builder (`make-video.js`). Your job as the agent is to
turn the prompt into a **spec** (which pages to visit, what to say on each) and then run the
builder. All the production settings (voice, tempo, fonts, logo, cards) are fixed in
`config.json` so every video in the set looks and sounds identical.

## What's fixed vs. what you provide

**Fixed (config.json — don't change unless the user asks):**
- Voice: ElevenLabs **Adam** (`pNInz6obpgDQGcFmaJgB`), model `eleven_turbo_v2_5`.
- Tempo: each section stays on screen for `narration length + ~2.9s`; caption updates the instant you navigate.
- Brand: **Inter** typeface + the **Rec wordmark**, "REC TRAINING VIDEO" title card, outro splash to **partnersupport@rec.us**.
- 1280×720, 25fps, H.264 + AAC.

**You provide (a `spec.json`):** the start URL, the cards to click, and the caption + narration text per section. See `examples/finance-settings.spec.json` for the full shape.

## Prerequisites (check first, tell the user if missing)

- Credentials: **bundled** in `credentials.json` (Rec-internal sandbox rec.us login + ElevenLabs key), so no setup is needed. Env vars `REC_EMAIL` / `REC_PASSWORD` / `ELEVENLABS_API_KEY` override the bundled values if set. The bundled login is a sandbox account (no real data); rotate the ElevenLabs key from the Rec ElevenLabs account if it ever leaks outside Rec.
- Tools: `node` with Playwright, `ffmpeg` (full build, for the MP4 muxer), Chromium (pre-installed at `/opt/pw-browsers`). If `ffmpeg` is the minimal Playwright build, `apt-get install -y ffmpeg`.
- Behind the CCR agent proxy, the builder handles TLS itself (pins the proxy CA, caps TLS at 1.2, reads `HTTPS_PROXY`). No action needed.

## Workflow

### 1. Resolve the target and org
- Identify the section/flow the user wants and the **org UUID** (rec.us admin URLs look like `/admin/o/<uuid>/...`). If the user names an org, resolve its UUID with the `search_organizations` MCP tool or `https://api.rec.us/v1/organizations/<uuid>`. If unclear, ask.
- Note the base path, e.g. `https://www.rec.us/admin/o/<uuid>/settings/finance`.

### 2. Discover the subpages (build the click list)
Do NOT guess the page structure. Get the real one:
- **Log in and look**: with `REC_EMAIL`/`REC_PASSWORD`, open the start page and read the section-card headings and breadcrumb (this is what the tour clicks). A quick throwaway Playwright script or one `make-video.js` dry idea is fine.
- Or, to enumerate every subpage an admin actually uses, query PostHog pageviews:
  `SELECT DISTINCT replaceRegexpAll(properties.$pathname,'[0-9a-f-]{36}',':id') FROM events WHERE event='$pageview' AND properties.$pathname LIKE '/admin/o/%/<section>%'`.
- Confirm each intended page actually renders (no redirect to `/locations`) before including it.

### 3. Learn how each page works (so narration is accurate)
For every page, read its real content (screenshot or dump `main` innerText while logged in) and, when it's data/behavior you can't see in the UI, verify with the Staff MCP (`query_subagent`, `discover_schema`). Narration must describe what's actually there — never invent fields or behavior.

### 4. Write the spec
Copy an example and edit. Per section provide:
- `card`: exact on-screen text of the card/row to click (SPA nav keeps the caption overlay alive). Use `path` instead for a direct URL if there's no card to click.
- `title` + `lines`: the on-screen caption (short; `lines` is an array, one per line).
- `narration`: 1–3 spoken sentences. Write for the ear — expand abbreviations the way they should be *said* ("GL" reads fine; write "partner support at rec dot us", "twelve months", etc.).
- `intro` (landing page) and top-level `title`/`subtitle` (title card) and `back` (breadcrumb link text to return between sections).
Keep narration tight and factual; the pacing auto-fits each section to its narration.

### 5. Build
```bash
cd .claude/skills/rec-training-video
node make-video.js examples/finance-settings.spec.json ../../Finance-Settings.mp4
```
Credentials come from the bundled `credentials.json` (override with `REC_EMAIL` / `REC_PASSWORD` / `ELEVENLABS_API_KEY` env vars if needed). Runs narrate → record → mux → brand and writes the MP4. ~2–4 min depending on length (the login + full-page loads go through the proxy).

### 6. Verify before delivering
- Confirm duration ≈ title(4.8s) + sum(section dwells) + outro, and that both a video and audio stream exist (`ffprobe`).
- Sample a few frames (`ffmpeg -ss <t> -i out.mp4 -frames:v 1 f.png`) to confirm captions match their pages and the title/outro cards render.
- Spot-check audio alignment: speech (`volumedetect` mean ≈ −16 dB) during sections, silence (≈ −91 dB) in the gaps.
- Deliver with `SendUserFile` (display: render).

## Consistency across a set
Reuse the same `config.json` for every video in a series so voice, pacing, and branding match. Only the spec's `title`, `subtitle`, and per-section text change. Keep output names consistent, e.g. `Rec-Training_<Topic>.mp4`.

## Tuning knobs (config.json)
- `tts.voiceId` / `voiceName` — swap the narrator (the provided key may lack `voices_read`; pass a known voice ID). `tts.voiceSettings.stability` etc. shape delivery.
- `tempo.leadMs` / `tailMs` — pacing (how long a section lingers after its line ends). Raise `tailMs` for a slower feel.
- `brand.outro.email` and copy — change the contact or wording.
- `brand.titleCardSeconds` — title-card hold time.

## Files
- `make-video.js` — orchestrator (narrate → record → mux → brand).
- `config.json` — fixed voice/tempo/brand settings.
- `card.html` + `render-card.js` — Rec-branded title/outro card (inline Rec wordmark, Inter).
- `overlay.js` — the in-page caption + cursor overlay injected during recording.
- `fonts/` — Inter (Rec's typeface). `examples/` — two working specs.

## Notes / gotchas
- Login is email+password via the rec.us modal. A magic-link (email) login is also possible but needs Gmail access to grab the link; password is simpler when the account has one.
- The org's timezone toast can reappear on some pages; the recorder dismisses it, but if it lingers in a frame it's harmless.
- Narration text is authored, not transcribed — keep it in the spec so wording/voice can be re-rendered cheaply without re-recording the screen.
