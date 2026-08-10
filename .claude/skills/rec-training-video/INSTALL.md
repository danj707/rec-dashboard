# Installing the Rec Training Video skill (no command line needed)

This skill lets you ask Claude, in plain language, for a narrated + captioned,
Rec-branded walkthrough video of a rec.us admin section — and get an MP4 back.

There are two "Claude on the web" surfaces. Pick the one that matches you.

--------------------------------------------------------------------------
## ✅ Recommended: Claude Code on the web  (claude.ai/code)
--------------------------------------------------------------------------
This is the one that actually produces videos, and you never touch a terminal —
Claude runs everything in a cloud container for you. You just type prompts.

It's **already installed** for anyone who opens the `danj707/rec-dashboard`
repo here (it was merged into `main`). Nothing to upload.

To use it:
1. Go to claude.ai/code and open the `rec-dashboard` repo.
2. Ask, e.g.:  "Make a Rec training video walking through the Memberships settings."
3. Claude asks you a few quick questions: a **rec.us login** to record with, **which
   site/org**, a **plain-language description** of what to record, roughly **how long**,
   and any **specific context**. (The login is used only for that build and is never
   saved or committed — the shared ElevenLabs narration key is already bundled, so you
   don't provide that.)
Claude then discovers the pages, writes the narration, records, brands, and hands you
the MP4 to **review for correctness**.

--------------------------------------------------------------------------
## Uploading to claude.ai chat  (Settings → Capabilities → Skills)
--------------------------------------------------------------------------
You can upload this zip as a Skill in the claude.ai web UI:
  Settings → Capabilities → Skills → Upload skill → choose the .zip.

Heads-up on what this does and doesn't do:
- Claude will KNOW the workflow and can help you author specs / narration.
- But the claude.ai chat sandbox generally can't log into rec.us with a real
  browser, screen-record, or run ffmpeg — so it usually CANNOT render the final
  video there. Use Claude Code on the web (above) for the actual recording.

--------------------------------------------------------------------------
## What the skill needs to actually render a video
--------------------------------------------------------------------------
- Node.js + Playwright, a headless Chromium, and ffmpeg (full build).
- Network access to rec.us and the ElevenLabs API.
- Credentials: the **rec.us login is provided at run time** (Claude asks you, then
  passes it via REC_EMAIL / REC_PASSWORD for that one build — never saved or committed).
  Only the shared **ElevenLabs key** is bundled in `credentials.json` (override with
  ELEVENLABS_API_KEY). Keep this package internal, and rotate the ElevenLabs key from
  the Rec ElevenLabs account if it ever leaks.
Claude installs/uses these for you in a container environment; see SKILL.md.

Voice, pacing, fonts, logo, and the title/outro cards are all fixed in
`config.json` so every video in a set matches. Change the narrator by putting a
different ElevenLabs voice ID in `config.json`.
