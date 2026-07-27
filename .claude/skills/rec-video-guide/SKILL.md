---
name: rec-video-guide
description: "Generate narrated in-product video walkthroughs and GIF guides of the Rec platform (rec.us) by driving the real UI with Playwright. Use whenever someone asks for a video walkthrough, video guide, training video, narrated demo, screen recording, or animated GIF of a Rec flow — e.g. 'Make me a video walkthrough of creating a rental and building an invoice, under 2 minutes, with voice narration'. Handles login, recording with cursor/caption overlays, local neural TTS voiceover (Piper), MP4/GIF rendering, and delivery back to the user."
---

# Rec Video Guide Generator

Turn a one-line request into a polished, narrated MP4 (plus optional GIF cuts) of a real flow in the Rec product, recorded live against the test org. Videos are **regenerable**: keep the script, re-run it after UI changes, get a fresh video.

## What the user gives you

- **The flow** ("creating a rental and building an invoice") — may span several screens.
- Optional: **length cap** ("under 2 minutes"), **narration** (voice / captions-only), **formats** (MP4, GIF, both), **audience** (admin / resident / front desk).

Defaults when unspecified: captioned MP4 **with** voice narration, 60–120s, 1440×900, plus one 10–20s GIF of the money moment.

## Hard rules

1. **Test org only.** Record against the Niagara Falls test org (`/organizations/city-of-niagara-falls`, org id `a976a11a-5303-4785-838a-1b281ca77678`) or another org the user explicitly names as test. Never a live customer org.
2. **Credentials are never hardcoded or committed.** Use `REC_TEST_EMAIL` / `REC_TEST_PASSWORD` env vars if set; otherwise ask the user. (Historically: Dan's test account, ask him.)
3. **Stop before destructive confirms.** End write-flows hovering the final *Confirm/Submit* with a caption+narration explaining it — so re-renders never mutate data. Only click the real confirm if the user explicitly asks and the data is disposable.
4. **No real PII on screen.** The test org's data is fake; if you see anything that looks real, reframe or pick different records.
5. **Recon before recording.** Dry-run every selector read-only first. Never debug selectors inside a recording run.

## Environment setup (each session)

- **Chromium**: `executablePath: '/opt/pw-browsers/chromium'` (Playwright preinstalled; never `playwright install`).
- **Outbound proxy**: launch args MUST include
  `[`--proxy-server=${process.env.HTTPS_PROXY}`, '--ssl-version-max=tls1.2']`
  — the egress proxy's TLS interception fails on Chromium's TLS 1.3 handshake; TLS 1.2 works, certificate verification stays on. If `www.rec.us` is unreachable (curl exit 56 / CONNECT 403), the environment network policy must allow `rec.us` + `*.rec.us` — ask the user, don't work around.
- **ffmpeg**: `npm install -g ffmpeg-static` → binary at `$(npm root -g)/ffmpeg-static/ffmpeg` (apt usually unavailable).
- **Piper TTS** (voice narration):
  ```bash
  curl -sL -o piper.tgz https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz && tar xzf piper.tgz
  curl -sL -o voice.tar.gz https://github.com/rhasspy/piper/releases/download/v0.0.2/voice-en-us-lessac-medium.tar.gz && tar xzf voice.tar.gz
  echo "text" | ./piper/piper --model en-us-lessac-medium.onnx --length_scale 1.05 --output_file out.wav
  ```
- Work in the session scratchpad, not the repo.

## Product knowledge that saves you an hour

- **Login**: org page → *Log in* button → email+password inputs → submit. No MFA. **Sessions don't survive browser restarts** — script the login at the start of every run (~10s; also makes a free "logging in" scene).
- **Admin entry**: account-menu avatar (`[aria-label="Open account menu"]` — pick the *visible* one; there's a hidden mobile duplicate) → *Admin Dashboard* → lands on `/admin/o/{orgId}/users`.
- **Row-level ⋯ menus** (transactions, bookings): items are plain `<button>`s inside `div[role="menu"]`, NOT Radix menuitems — click via `p.locator('[role="menu"] button').filter({ hasText: 'Manage' })`. **"Manage" opens a NEW TAB** (`/orders/{id}/manage`). For a single-video recording: `Promise.all([ctx.waitForEvent('page'), click])`, grab `popup.url()`, `popup.close()`, then `p.goto(url)` in the recorded page — looks seamless.
- **Manage Order wizard**: step 1 *Select Items* (Refund ☑ / Waive Payment Plan) → *Continue* → step 2 *Review & Confirm* (amount, method, customer note textarea) → *Confirm*.
- The full click-map of the admin (28 destinations, tabs, actions) lives in the "Video Guide Candidates" and product-map docs from 7/26 — check chat history/Notion under Partner Success.

## Workflow

1. **Parse the request** → list of scenes. Budget narration: Piper speaks ~2.5 words/sec; a 2-minute cap ≈ 250 narration words max across ~8–12 cues.
2. **Recon** (no recording): drive the flow, screenshot each state, verify selectors, note popups. Read the matching help article (Intercom / Rec U Training Center) so narration uses the product's own vocabulary.
3. **Write narration lines** to `narr/lines.json` (`[{id, text}]`), synthesize each with Piper, measure durations with ffmpeg, store `dur` back in the JSON.
4. **Record** using the rig in `assets/record-rig.js` (copy it to the scratchpad and `require` it). Structure: title card → scenes, each scene = `cue(id, caption)` → actions → `finishCue(id)` (which waits out the narration). The rig injects the cursor, click ripples, and caption bar into the page so they render into the video, and logs cue timestamps to JSON.
5. **Mux**: overlay each narration WAV at its cue timestamp:
   `adelay=<ms>|<ms>` per input → `amix=inputs=N:normalize=0` → `-c:v libx264 -pix_fmt yuv420p -crf 22 -c:a aac -b:a 160k -ac 2 -ar 48000 -movflags +faststart`. **Always encode audio as stereo 48kHz** — mono tracks play silent in some inline players.
6. **GIF cut** (if wanted): pick the key segment from cue timestamps:
   `ffmpeg -ss <start> -t <len> -i video.webm -vf "fps=12,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer" out.gif`
7. **Verify before delivering**: extract 2–3 frames (`-ss N -frames:v 1`) and check them; run `volumedetect` and confirm `max_volume` ≈ 0dB.
8. **Deliver** with SendUserFile (MP4 + GIF), captioned with length, what it covers, and the stop-before-confirm note. Offer to publish into the matching help article.

## Quality bar

- Human pacing: eased cursor moves (the rig does this), ~60ms/keystroke typing, ≥1s settle after page loads.
- Captions ≤ 60 chars, imperative voice ("Check Refund, then click Continue"); narration is the longer conversational version of the same beat.
- Title card at open (flow name + duration), outro card pointing at help.rec.us.
- If a run fails mid-recording, fix the selector in recon mode and re-record from scratch — never ship a video with a visible mistake/backtrack.
