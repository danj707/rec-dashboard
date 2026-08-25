#!/usr/bin/env node
/**
 * Rec training-video builder.  One entrypoint: spec (what to walk through) + config
 * (voice, tempo, brand) -> a narrated, captioned, branded MP4.
 *
 *   REC_EMAIL=... REC_PASSWORD=... ELEVENLABS_API_KEY=... \
 *     node make-video.js path/to/spec.json [out.mp4]
 *
 * Pipeline:  narrate (ElevenLabs) -> record (Playwright login + click tour, captions,
 * timings) -> mux narration onto the trimmed screen recording -> prepend Rec title
 * card + append narrated outro splash.  All knobs live in config.json / the spec.
 *
 * See SKILL.md for how an agent turns a plain-language prompt into a spec.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { chromium } = require('playwright');

const HERE = __dirname;
const CFG = JSON.parse(fs.readFileSync(path.join(HERE, 'config.json'), 'utf8'));
const SPEC_PATH = process.argv[2];
if (!SPEC_PATH) { console.error('usage: make-video.js spec.json [out.mp4]'); process.exit(1); }
const SPEC = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
const OUT = process.argv[3] || SPEC.outFile || 'rec-training-video.mp4';
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'rtv-'));

// Credentials. Defaults to the bundled Rec University demo login + ElevenLabs key in
// credentials.json (zero-setup recording of the training org). REC_EMAIL / REC_PASSWORD
// override the login at run time when recording a different org (never commit that login).
const CREDS = (() => { try { return JSON.parse(fs.readFileSync(path.join(HERE, 'credentials.json'), 'utf8')); } catch { return {}; } })();
const EMAIL = process.env.REC_EMAIL || CREDS.recEmail;
const PW = process.env.REC_PASSWORD || CREDS.recPassword;
const EL_KEY = process.env.ELEVENLABS_API_KEY || CREDS.elevenLabsApiKey;
// Which site to log into (prod by default). Spec or env can point at another rec.us env.
const BASE = SPEC.baseUrl || process.env.REC_BASE_URL || CFG.baseUrl;
const sh = (c) => execSync(c, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const dur = (f) => parseFloat(sh(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${f}"`).trim());

// ---- Chromium launch opts that work behind the CCR agent proxy -------------
function launchOpts() {
  const args = ['--no-sandbox'];
  const caFile = '/root/.ccr/agent-proxy-ca.crt';
  if (fs.existsSync(caFile)) {
    // TLS1.3 fails through the re-terminating proxy; pin the proxy CA by SPKI and cap at 1.2.
    const spki = sh(`openssl x509 -in ${caFile} -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64`).trim();
    args.push('--ssl-version-max=tls1.2', `--ignore-certificate-errors-spki-list=${spki}`, '--dns-over-https-mode=off');
  }
  const opts = { headless: true, args };
  if (process.env.HTTPS_PROXY) opts.proxy = { server: process.env.HTTPS_PROXY };
  return opts;
}
// find the pre-installed chromium without extra deps
function findChromium() {
  const root = '/opt/pw-browsers';
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  if (!fs.existsSync(root)) return undefined;
  for (const d of fs.readdirSync(root).filter(x => x.startsWith('chromium'))) {
    const p = path.join(root, d, 'chrome-linux', 'chrome');
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

// ---- 1. Narrate -----------------------------------------------------------
async function tts(text, file) {
  const c = CFG.tts;
  // Voice is chosen at intake; spec/env overrides the config default without editing it.
  const voiceId = SPEC.voiceId || process.env.REC_TTS_VOICE_ID || c.voiceId;
  // Spec can shape delivery (stability/style/speed) without editing the shared config.
  const voiceSettings = Object.assign({}, c.voiceSettings, SPEC.voiceSettings || {});
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': EL_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: c.model, voice_settings: voiceSettings }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  // Loudness-normalize the clip as a standalone step (NOT inside the mux graph,
  // where loudnorm corrupts amix timing) so every voice lands at a consistent
  // level. Duration is preserved; falls back to the raw clip if this fails.
  try {
    const norm = file + '.norm.mp3';
    sh(`ffmpeg -y -v error -i "${file}" -af loudnorm=I=-16:TP=-1.5:LRA=11 -ar 44100 -ac 1 -c:a libmp3lame -q:a 2 "${norm}"`);
    if (fs.existsSync(norm) && fs.statSync(norm).size > 0) fs.renameSync(norm, file);
  } catch { /* keep the un-normalized clip */ }
}
async function narrateAll() {
  process.env.NODE_USE_ENV_PROXY = '1';
  const items = [SPEC.intro, ...SPEC.steps];
  const clips = [];
  for (let i = 0; i < items.length; i++) {
    const f = path.join(WORK, `narr-${String(i).padStart(2, '0')}.mp3`);
    await tts(items[i].narration, f);
    clips.push({ i, file: f, dur: dur(f) });
    console.log(`  narration[${i}] ${clips[i].dur.toFixed(1)}s`);
  }
  // shared outro line
  const outroFile = path.join(WORK, 'narr-outro.mp3');
  await tts(SPEC.outroNarration || `Thanks for watching. If you have any questions, reach out to the Rec Customer Experience team at partner support at rec dot you ess.`, outroFile);
  return { clips, outro: { file: outroFile, dur: dur(outroFile) } };
}

// ---- 2. Record (login + click tour, captions, timings) --------------------
const OVERLAY = fs.readFileSync(path.join(HERE, 'overlay.js'), 'utf8');
async function record(narr) {
  const { width: W, height: H } = CFG.viewport;
  // Spec can override pacing (leadMs/tailMs/settleMs/scrollChunks) per video without editing config.
  const T = Object.assign({}, CFG.tempo, SPEC.tempo || {});
  const opts = launchOpts(); opts.executablePath = findChromium();
  const browser = await chromium.launch(opts);
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: WORK, size: { width: W, height: H } } });
  const page = await ctx.newPage();
  const t0 = Date.now();
  const timings = [];
  const mark = (i) => timings.push({ i, t: (Date.now() - t0) / 1000 + T.leadMs / 1000 });
  const sleep = (ms) => page.waitForTimeout(ms);
  const main = () => page.locator('main');
  const ensure = () => page.evaluate(OVERLAY);
  const setCap = async (title, lines) => { await ensure(); await page.evaluate(([a, b]) => window.__setCap(a, b), [title, lines.join('<br>')]); };
  const point = async (loc) => { try { const b = await loc.boundingBox(); if (b) { await ensure(); await page.evaluate(([x, y]) => window.__cur(x, y), [b.x + Math.min(b.width / 2, 260), b.y + b.height / 2]); await sleep(650); } } catch {} };
  const dwell = async (ms) => { const n = T.scrollChunks; for (let i = 0; i < n; i++) { await page.mouse.wheel(0, 250); await sleep(ms / (n + 2)); } await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })); await sleep(ms / (n + 2) * 2); };
  const dwellFor = (i, base) => Math.max(base || 0, Math.round(narr.clips[i].dur * 1000) + T.leadMs + T.tailMs);

  // Dismiss overlays that would cover the caption strip: the ET-timezone toast and the
  // cookie-consent banner (the banner appears on logged-out resident/public pages).
  const dismiss = async () => {
    await page.getByRole('button', { name: /don.t show again/i }).click({ timeout: 1200 }).catch(() => {});
    await page.getByRole('button', { name: /close this consent banner|accept all|got it/i }).click({ timeout: 1200 }).catch(() => {});
  };

  // login (email + password) — skipped for resident/public tours via spec `noLogin: true`
  if (!SPEC.noLogin) {
    await page.goto(`${BASE}/locations`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(2500);
    await page.locator('button:visible, a:visible').filter({ hasText: /^Log in$/ }).first().click();
    await sleep(1200);
    const dlg = page.locator('[role="dialog"]');
    await dlg.locator('input[name="email"]').fill(EMAIL);
    await dlg.locator('input[name="password"]').fill(PW);
    await dlg.getByRole('button', { name: 'Log in', exact: true }).click();
    await sleep(6000);
  }

  await page.goto(SPEC.start, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(3000);
  await dismiss();
  // Some toasts (ET-timezone) pop in a beat after load; dismiss again once they appear.
  // Clicking "don't show again" persists for the context, so later pages stay clean.
  await sleep(1200);
  await dismiss();
  await setCap(SPEC.intro.title, SPEC.intro.lines);
  mark(0);
  await dwell(dwellFor(0, SPEC.intro.dwellMs));

  for (let i = 0; i < SPEC.steps.length; i++) {
    const s = SPEC.steps[i];
    if (s.card) {
      const target = main().getByText(s.card, { exact: true }).first();
      await point(target);
      await target.click();
    } else if (s.path) {
      await page.goto(s.path, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await dismiss();
    }
    await setCap(s.title, s.lines);
    await sleep(T.settleMs);
    await setCap(s.title, s.lines);
    mark(i + 1);
    await dwell(dwellFor(i + 1, s.dwellMs));
    if (s.card && SPEC.back) {
      await main().getByRole('link', { name: SPEC.back, exact: true }).first().click();
      await setCap(SPEC.intro.title, SPEC.intro.lines);
      await sleep(T.returnMs);
    }
  }
  await ctx.close();
  await browser.close();
  const webm = path.join(WORK, fs.readdirSync(WORK).find(f => f.endsWith('.webm')));
  return { webm, timings };
}

// ---- 3. Mux narration onto trimmed screen recording -----------------------
function muxBody(rec, narr) {
  const { webm, timings } = rec;
  const vdur = dur(webm);
  const introT = timings.find(x => x.i === 0).t;
  const trim = Math.max(0, introT - 1.0);
  const finalDur = vdur - trim;
  const inputs = [`-ss ${trim.toFixed(3)} -i "${webm}"`];
  const parts = [], labels = [];
  // Stagger guard: a narration never starts before the previous one ends (+gap),
  // so two clips can never talk over each other if a section runs short.
  let prevEnd = 0;
  narr.clips.forEach((c, k) => {
    const tm = timings.find(x => x.i === c.i);
    const startS = Math.max(tm.t - trim, prevEnd + 0.35);
    prevEnd = startS + c.dur;
    const delay = Math.max(0, Math.round(startS * 1000));
    inputs.push(`-i "${c.file}"`);
    parts.push(`[${k + 1}:a]adelay=${delay}|${delay}[a${k}]`);
    labels.push(`[a${k}]`);
  });
  const filter = `${parts.join(';')};${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0[aout]`;
  const body = path.join(WORK, 'body.mp4');
  sh(`ffmpeg -y -v error ${inputs.join(' ')} -filter_complex "${filter}" -map 0:v -map "[aout]" -t ${finalDur.toFixed(3)} -c:v libx264 -pix_fmt yuv420p -crf 24 -c:a aac -b:a 160k -ar 44100 -ac 1 "${body}"`);
  return body;
}

// ---- 4. Branding: title card + narrated outro, then concat ----------------
function renderCard(query, outPng) {
  sh(`node "${path.join(HERE, 'render-card.js')}" ${JSON.stringify(query)} "${outPng}"`);
}
function q(obj) { return Object.entries(obj).filter(([, v]) => v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&'); }
function brand(body, narrOutro) {
  const B = CFG.brand;
  const titlePng = path.join(WORK, 'title.png'), outroPng = path.join(WORK, 'outro.png');
  renderCard(q({ eyebrow: B.eyebrow, title: SPEC.title, sub: SPEC.subtitle, foot: B.foot }), titlePng);
  renderCard(q({ eyebrow: B.outro.eyebrow, title: B.outro.title, sub: B.outro.sub, email: B.outro.email, foot: B.foot }), outroPng);
  const titleMp4 = path.join(WORK, 'title.mp4'), outroMp4 = path.join(WORK, 'outro.mp4');
  const td = B.titleCardSeconds;
  sh(`ffmpeg -y -v error -loop 1 -i "${titlePng}" -f lavfi -t ${td} -i anullsrc=r=44100:cl=mono -vf "scale=1280:720,fade=t=in:st=0:d=0.4,fade=t=out:st=${(td-0.4).toFixed(2)}:d=0.4,format=yuv420p" -r ${CFG.fps} -t ${td} -c:v libx264 -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k -ar 44100 -ac 1 "${titleMp4}"`);
  const od = +(narrOutro.dur + 2.2).toFixed(2);
  sh(`ffmpeg -y -v error -loop 1 -i "${outroPng}" -i "${narrOutro.file}" -filter_complex "[0:v]scale=1280:720,fade=t=in:st=0:d=0.4,fade=t=out:st=${(od-0.4).toFixed(2)}:d=0.4,format=yuv420p[v];[1:a]adelay=600|600,apad[a]" -map "[v]" -map "[a]" -r ${CFG.fps} -t ${od} -c:v libx264 -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k -ar 44100 -ac 1 "${outroMp4}"`);
  sh(`ffmpeg -y -v error -i "${titleMp4}" -i "${body}" -i "${outroMp4}" -filter_complex "[0:v][0:a][1:v][1:a][2:v][2:a]concat=n=3:v=1:a=1[v][a]" -map "[v]" -map "[a]" -r ${CFG.fps} -c:v libx264 -crf 22 -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 160k -ar 44100 -ac 1 "${OUT}"`);
}

(async () => {
  if (!EMAIL || !PW) throw new Error('Login required: the bundled Rec University login is missing from credentials.json — set REC_EMAIL and REC_PASSWORD, or restore credentials.json.');
  if (!EL_KEY) throw new Error('missing ELEVENLABS_API_KEY (bundled in credentials.json, or set the env var).');
  console.log('1/4 narrating…'); const narr = await narrateAll();
  console.log('2/4 recording…'); const rec = await record(narr);
  console.log('3/4 muxing narration…'); const body = muxBody(rec, narr);
  console.log('4/4 branding…'); brand(body, narr.outro);
  console.log(`\nDONE  ${OUT}  (${dur(OUT).toFixed(1)}s)`);
  fs.rmSync(WORK, { recursive: true, force: true });
})().catch(e => { console.error(e); process.exit(1); });
