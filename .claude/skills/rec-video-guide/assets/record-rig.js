// Reusable recording rig for Rec product walkthrough videos.
// Copy to the scratchpad next to your recording script and:
//   const { launch } = require('./record-rig');
//   const { ctx, p, helpers } = await launch({ vidDir });
// See example-refund-video.js for a complete production script.
const { chromium } = require('playwright');

// Injected on every page: fake cursor, click ripple, caption bar, title cards.
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

async function launch({ vidDir, width = 1440, height = 900, record = true }) {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    // TLS 1.2 is required: the egress proxy's interception breaks on Chromium's TLS 1.3.
    args: [`--proxy-server=${process.env.HTTPS_PROXY}`, '--ssl-version-max=tls1.2'],
  });
  const ctx = await b.newContext({
    viewport: { width, height },
    ...(record ? { recordVideo: { dir: vidDir, size: { width, height } } } : {}),
  });
  await ctx.addInitScript(OVERLAY);
  const p = await ctx.newPage();
  p.setDefaultTimeout(35000);

  const t0 = Date.now();
  const now = () => (Date.now() - t0) / 1000;
  let mx = width / 2, my = height / 2;
  const cues = [];
  const cueEnds = {};

  const helpers = {
    now, cues,
    cap: t => p.evaluate(t => window.__setCap(t), t).catch(() => {}),
    pause: ms => p.waitForTimeout(ms),
    title: (big, small, hold) => p.evaluate(a => window.__title(a.big, a.small, a.hold), { big, small, hold }).catch(() => {}),
    moveTo: async (x, y) => {
      const steps = Math.max(14, Math.min(38, Math.round(Math.hypot(x - mx, y - my) / 28)));
      await p.mouse.move(x, y, { steps }); mx = x; my = y;
    },
    click: async loc => {
      const el = typeof loc === 'string' ? p.locator(loc).first() : loc;
      await el.waitFor({ state: 'visible' });
      const bb = await el.boundingBox();
      await helpers.moveTo(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await helpers.pause(420);
      await p.mouse.down(); await helpers.pause(90); await p.mouse.up();
    },
    type: async (loc, text) => { await helpers.click(loc); await helpers.pause(250); await p.keyboard.type(text, { delay: 60 }); },
    // Narration cue: caption + timestamp; finishCue waits out the narration audio.
    cue: async (id, caption, narrDur) => {
      await helpers.cap(caption);
      const t = now();
      cues.push({ id, at: t });
      cueEnds[id] = t + (narrDur || 0) + 0.7;
    },
    finishCue: async id => {
      const remaining = (cueEnds[id] - now()) * 1000;
      if (remaining > 0) await helpers.pause(remaining);
    },
    // Log in from an org page. Call after goto(orgPageUrl).
    login: async (email, password) => {
      await p.getByRole('button', { name: 'Log in' }).first().click();
      await helpers.pause(1800);
      await helpers.type(p.locator('input[type="email"], input[name*="email" i]').first(), email);
      await helpers.type(p.locator('input[type="password"]').first(), password);
      await helpers.click(p.locator('button[type="submit"], button:has-text("Log in")').last());
      await helpers.pause(7000);
    },
    // Click something that opens a new tab, then continue in the SAME recorded page.
    clickPopupInline: async loc => {
      const [popup] = await Promise.all([ctx.waitForEvent('page'), helpers.click(loc)]);
      const url = popup.url();
      await popup.close();
      await p.goto(url, { waitUntil: 'domcontentloaded' });
    },
  };
  return { browser: b, ctx, p, helpers };
}

module.exports = { launch, OVERLAY };
