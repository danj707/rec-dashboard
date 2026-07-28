// Render a title/outro card (card.html) to a 1280x720 PNG.
//   node render-card.js '<query-string>' out.png
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = '/opt/pw-browsers';
  if (fs.existsSync(root)) {
    for (const d of fs.readdirSync(root).filter(x => x.startsWith('chromium'))) {
      const p = path.join(root, d, 'chrome-linux', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined; // fall back to Playwright's bundled browser
}

(async () => {
  const query = process.argv[2] || '';
  const out = process.argv[3] || 'card.png';
  const opts = { headless: true, args: ['--no-sandbox'] };
  const exe = findChromium(); if (exe) opts.executablePath = exe;
  const browser = await chromium.launch(opts);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto('file://' + path.join(__dirname, 'card.html') + '?' + query, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: out });
  await browser.close();
  console.log('CARD', out);
})();
