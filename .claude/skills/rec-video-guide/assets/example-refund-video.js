const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const VID = path.join(__dirname, 'vids');
const NARR = require('./narr/lines.json');
const durOf = id => (NARR.find(l => l.id === id) || {}).dur || 0;
const t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;
const cues = [];

const OVERLAY = `
(() => {
  if (window.__ovl) return; window.__ovl = true;
  const mk = () => {
    if (document.getElementById('__cursor') || !document.body) return;
    const c = document.createElement('div'); c.id = '__cursor';
    c.style.cssText = 'position:fixed;z-index:2147483647;width:22px;height:22px;border-radius:50%;background:rgba(20,20,20,.45);border:2.5px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.5);pointer-events:none;transform:translate(-50%,-50%);left:-50px;top:-50px';
    document.body.appendChild(c);
    const cap = document.createElement('div'); cap.id = '__cap';
    cap.style.cssText = 'position:fixed;z-index:2147483646;left:50%;bottom:34px;transform:translateX(-50%);max-width:72%;background:rgba(17,17,22,.92);color:#fff;font:600 21px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;padding:14px 26px;border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.45);opacity:0;transition:opacity .35s;text-align:center;pointer-events:none';
    document.body.appendChild(cap);
    if (window.__lastCap) { cap.textContent = window.__lastCap; cap.style.opacity = '1'; }
  };
  new MutationObserver(mk).observe(document.documentElement, { childList: true, subtree: false });
  document.addEventListener('DOMContentLoaded', mk);
  mk();
  document.addEventListener('mousemove', e => { mk(); const c = document.getElementById('__cursor'); if (c) { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; } }, true);
  document.addEventListener('mousedown', e => {
    mk();
    const r = document.createElement('div');
    r.style.cssText = 'position:fixed;z-index:2147483645;width:14px;height:14px;border-radius:50%;border:3px solid #fbbf24;pointer-events:none;transform:translate(-50%,-50%);left:' + e.clientX + 'px;top:' + e.clientY + 'px;opacity:.95;transition:width .45s,height .45s,opacity .45s';
    document.body.appendChild(r);
    requestAnimationFrame(() => { r.style.width = '58px'; r.style.height = '58px'; r.style.opacity = '0'; });
    setTimeout(() => r.remove(), 600);
  }, true);
  window.__setCap = t => { mk(); window.__lastCap = t; const el = document.getElementById('__cap'); if (!el) return; if (!t) { el.style.opacity = '0'; return; } el.textContent = t; el.style.opacity = '1'; };
  window.__title = (big, small, hold) => {
    mk();
    const w = document.createElement('div');
    w.style.cssText = 'position:fixed;inset:0;z-index:2147483644;background:linear-gradient(135deg,#111116,#26262e);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;opacity:1;transition:opacity .6s';
    w.innerHTML = '<div style="font:800 44px -apple-system,Segoe UI,Roboto,sans-serif;color:#fff">' + big + '</div><div style="font:500 22px -apple-system,Segoe UI,Roboto,sans-serif;color:#fbbf24">' + small + '</div>';
    document.body.appendChild(w);
    setTimeout(() => { w.style.opacity = '0'; setTimeout(() => w.remove(), 700); }, hold || 2600);
  };
})();`;

(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: [`--proxy-server=${process.env.HTTPS_PROXY}`, '--ssl-version-max=tls1.2'],
  });
  const ctx = await b.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: VID, size: { width: 1440, height: 900 } },
  });
  await ctx.addInitScript(OVERLAY);
  const p = await ctx.newPage();
  p.setDefaultTimeout(35000);
  let mx = 720, my = 450;

  const cap = t => p.evaluate(t => window.__setCap(t), t).catch(() => {});
  const pause = ms => p.waitForTimeout(ms);
  const moveTo = async (x, y) => {
    const steps = Math.max(14, Math.min(38, Math.round(Math.hypot(x - mx, y - my) / 28)));
    await p.mouse.move(x, y, { steps }); mx = x; my = y;
  };
  const click = async loc => {
    const el = typeof loc === 'string' ? p.locator(loc).first() : loc;
    await el.waitFor({ state: 'visible' });
    const bb = await el.boundingBox();
    await moveTo(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await pause(420);
    await p.mouse.down(); await pause(90); await p.mouse.up();
  };
  const type = async (loc, text) => { await click(loc); await pause(250); await p.keyboard.type(text, { delay: 60 }); };
  // start a narration cue: caption + record timestamp; returns min end time
  const cueEnds = {};
  const cue = async (id, caption) => {
    await cap(caption);
    const t = now();
    cues.push({ id, at: t });
    cueEnds[id] = t + durOf(id) + 0.7;
    console.log(`cue ${id} @ ${t.toFixed(1)}s`);
  };
  const finishCue = async id => {
    const remaining = (cueEnds[id] - now()) * 1000;
    if (remaining > 0) await pause(remaining);
  };

  // ── intro ──
  await p.goto('https://www.rec.us/organizations/city-of-niagara-falls', { waitUntil: 'domcontentloaded' });
  await pause(4000);
  await p.evaluate(() => window.__title('Refunding a Fee or Transaction', 'Rec Admin · 90-second guide', 3600)).catch(() => {});
  await cue('intro', 'Refund a fee or transaction from the Rec admin dashboard');
  await pause(3800);
  await p.getByText("Don't show again").first().click({ timeout: 2500 }).catch(() => {});
  await finishCue('intro');

  // ── login ──
  await cue('login', 'Log in with your Rec staff account');
  await click(p.getByRole('button', { name: 'Log in' }).first());
  await pause(1600);
  await type(p.locator('input[type="email"], input[name*="email" i]').first(), 'REPLACE_WITH_REC_TEST_EMAIL');
  await type(p.locator('input[type="password"]').first(), 'REPLACE_WITH_REC_TEST_PASSWORD');
  await click(p.locator('button[type="submit"], button:has-text("Log in")').last());
  await pause(7000);
  await finishCue('login');

  // ── admin dashboard + users ──
  await cue('admin', 'Account menu → Admin Dashboard → Users');
  const avatars = p.locator('[aria-label="Open account menu"]');
  const n = await avatars.count();
  for (let i = 0; i < n; i++) if (await avatars.nth(i).isVisible()) { await click(avatars.nth(i)); break; }
  await pause(1000);
  await click(p.getByText('Admin Dashboard').first());
  await pause(7500);
  await click(p.locator('a[href*="/users"]').first());
  await pause(4000);
  await finishCue('admin');

  // ── search ──
  await cue('search', 'Search by name or email, then open the household');
  await type(p.locator('main input[placeholder*="earch"], input[placeholder*="earch"]').last(), 'dan@rec.us');
  await pause(3500);
  await click(p.locator('tr, [role="row"], a').filter({ hasText: 'dan@rec.us' }).last());
  await pause(5500);
  await finishCue('search');

  // ── transactions tab ──
  await cue('txtab', 'Open the Transactions tab');
  await click(p.getByText('Transactions', { exact: true }).first());
  await pause(4200);
  await finishCue('txtab');

  // ── manage ──
  await cue('manage', 'Find the transaction → ⋯ menu → Manage');
  const row = p.locator('tbody tr').filter({ hasText: 'Account Credit' }).first();
  await row.scrollIntoViewIfNeeded();
  await pause(800);
  await click(row.locator('button').last());
  await pause(1300);
  const [popup] = await Promise.all([
    ctx.waitForEvent('page'),
    click(p.locator('[role="menu"] button').filter({ hasText: 'Manage' }).first()),
  ]);
  const manageUrl = popup.url();
  await popup.close();
  await p.goto(manageUrl, { waitUntil: 'domcontentloaded' });
  await pause(6000);
  await finishCue('manage');

  // ── refund checkbox + continue ──
  await cue('refund', 'Check Refund, then click Continue');
  await click(p.getByText('Refund', { exact: true }).first());
  await pause(1500);
  await click(p.getByRole('button', { name: 'Continue' }));
  await pause(4500);
  await finishCue('refund');

  // ── review ──
  await cue('review', 'Review the refund amount, method, and add an optional note');
  const noteBox = p.locator('textarea, input[placeholder*="note" i]').first();
  await noteBox.isVisible().then(async v => {
    if (v) { await click(noteBox); await pause(200); await p.keyboard.type('Requested by resident — see you next season!', { delay: 45 }); }
  }).catch(() => {});
  await finishCue('review');

  // ── confirm (hover only) ──
  await cue('confirm', 'Click Confirm to process the refund');
  const confirmBtn = p.getByRole('button', { name: 'Confirm' }).last();
  const bb = await confirmBtn.boundingBox();
  if (bb) { await moveTo(bb.x + bb.width / 2, bb.y + bb.height / 2); }
  await finishCue('confirm');

  // ── outro ──
  await cue('outro', 'More guides at help.rec.us 🎉');
  await p.evaluate(() => window.__title('That’s it!', 'More guides at help.rec.us', 3400)).catch(() => {});
  await finishCue('outro');
  await cap('');
  await pause(900);

  fs.writeFileSync(path.join(VID, 'refund-cues.json'), JSON.stringify(cues, null, 1));
  const video = p.video();
  await ctx.close();
  fs.renameSync(await video.path(), path.join(VID, 'refund.webm'));
  console.log('DONE', JSON.stringify(cues));
  await b.close();
})();
