// Spec for the Project Updates image upload — and the registration-order trap
// underneath it.
//
// THE INCIDENT (2026-09-11): Dan pasted a screenshot into Project Updates and
// got an alert reading
//
//     Image upload failed: Unexpected token '<', "<!DOCTYPE "... is not valid JSON
//
// which reads as a broken upload route. The upload route was fine. server.js
// carried a GLOBAL `app.use(express.json())` on Express's DEFAULT 100kb limit,
// registered ~930 lines ABOVE the route that declares its own
// `express.json({ limit: '8mb' })`. Express matches middleware in REGISTRATION
// ORDER, so the global parser ran first, a base64 screenshot (base64 inflates
// ~33%) blew 100kb, it threw PayloadTooLargeError, and Express's DEFAULT error
// handler answered with an HTML page. The client's r.json() then choked on
// `<!DOCTYPE` — one layer away from the real problem, telling the reader their
// JSON was malformed when the truth was the body was too big.
//
// The route's own limit, its 4MB guard and its tidy 413 were all UNREACHABLE.
// Dead code that read perfectly.
//
// WHY THIS SPEC BOOTS A SERVER: no source assertion can see this. The route
// reads correctly either way — what was wrong is WHERE it sits relative to
// another line. Only a real POST of a real oversized body can tell the two
// apart, which is why the source half below is a backstop and the live half is
// the actual guard.
//
// Run:  node scripts/announce-image-upload.spec.js
//       SKIP_SOURCE=1 node scripts/announce-image-upload.spec.js   (live half alone)

const { spawn } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

let passed = 0;
const failures = [];
function ok(cond, msg) { if (cond) passed++; else failures.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + ` — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }

const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// ── SOURCE HALF ────────────────────────────────────────────────────────────
if (process.env.SKIP_SOURCE !== '1') {
  const bigParser    = SRC.indexOf("app.use('/admin/api/announcements/image', express.json({ limit: '8mb' }))");
  const globalParser = SRC.indexOf('app.use(express.json());');
  const uploadRoute  = SRC.indexOf("app.post('/admin/api/announcements/image'");

  ok(bigParser > 0, 'the 8mb parser is mounted path-scoped for the upload route');
  ok(globalParser > 0, 'the global json parser is still there');
  // THE ASSERTION THAT IS THE BUG. Ordering, not presence — both lines existed
  // before the fix and the upload was still broken.
  ok(bigParser > 0 && globalParser > 0 && bigParser < globalParser,
     'the path-scoped 8mb parser is registered BEFORE the global one, or the global 100kb limit eats the body first');
  ok(uploadRoute > globalParser,
     '(sanity) the upload route itself still sits below both parsers, which is why its own limit could never win');

  // The global limit stays at the default on purpose: raising it would widen
  // the body a stranger can post at EVERY endpoint in order to fix one.
  ok(!/app\.use\(express\.json\(\{\s*limit/.test(SRC),
     'the GLOBAL parser keeps its default limit — one route needing 8mb is not a reason to widen every route');

  // An /api path must not answer a failure in HTML, or the client dies inside
  // its own error handler rather than reporting what went wrong.
  ok(/app\.use\(\(err, req, res, next\) => \{/.test(SRC),
     'there is an error handler that can answer an API failure in JSON');
  ok(/entity\.too\.large/.test(SRC),
     "...and it reads body-parser's own error type rather than guessing at the message");
  const errHandler = SRC.indexOf('app.use((err, req, res, next) => {');
  const listen     = SRC.indexOf('app.listen(PORT');
  ok(errHandler > 0 && listen > 0 && errHandler < listen,
     'the error handler is registered after the routes and before listen — an Express error handler only catches what is above it');

  ok(/SKIP_PREWARM/.test(SRC),
     'the server can be booted by a test without fanning ~22 orgs at production Metabase');
}

// ── LIVE HALF ──────────────────────────────────────────────────────────────
const PORT = 3971;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-upload-'));

function post(pathname, body) {
  return fetch(`http://127.0.0.1:${PORT}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

(async () => {
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, SKIP_PREWARM: '1',
           ADMIN_PASSWORD: '' },   // adminAuth falls open with no password, so the route is drivable
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  srv.stdout.on('data', d => { out += d; });
  srv.stderr.on('data', d => { out += d; });

  // wait for listen
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/health`); if (r.ok) break; } catch (_) {}
    await new Promise(r => setTimeout(r, 200));
  }

  try {
    // 1. A SMALL VALID IMAGE STILL UPLOADS. Without this the whole spec passes
    //    on a route that refuses everything, which is not a fix.
    const onePx = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const small = await post('/admin/api/announcements/image', { dataUrl: 'data:image/png;base64,' + onePx });
    eq(small.status, 200, 'a small pasted screenshot uploads');
    const smallBody = await small.json();
    ok(smallBody && smallBody.ok === true && /^\/announce-image\/img_/.test(smallBody.url || ''),
       '...and answers with the minted url');

    // 2. THE BUG, REPRODUCED. ~600kb of base64 — comfortably over the old
    //    global 100kb limit and comfortably under the route's own 4MB guard,
    //    so before the fix this died in the global parser and came back as
    //    HTML. It must now reach the route and succeed.
    const bigPng = 'data:image/png;base64,' + 'A'.repeat(600 * 1024);
    const big = await post('/admin/api/announcements/image', { dataUrl: bigPng });
    const bigText = await big.text();
    ok(!/^\s*<!DOCTYPE/i.test(bigText),
       'a 600kb paste does NOT come back as an HTML error page — this is the bug exactly as Dan hit it');
    let bigJson = null;
    try { bigJson = JSON.parse(bigText); } catch (_) {}
    ok(bigJson !== null,
       '...it is parseable JSON, which is what the client does with it');
    eq(big.status, 200, '...and a 600kb screenshot is accepted rather than refused');

    // 3. GENUINELY TOO BIG STILL SAYS SO, IN JSON — and there are TWO ceilings
    //    here, which is why there are two cases. 6MB clears the path-scoped
    //    8mb parser and reaches the ROUTE, whose own 4MB guard answers. That
    //    guard was unreachable before the order fix; this is what proves it is
    //    reachable now.
    const huge = await post('/admin/api/announcements/image',
      { dataUrl: 'data:image/png;base64,' + 'A'.repeat(6 * 1024 * 1024) });
    const hugeText = await huge.text();
    ok(!/^\s*<!DOCTYPE/i.test(hugeText),
       'an oversized paste is refused in JSON, not in HTML');
    let hugeJson = null;
    try { hugeJson = JSON.parse(hugeText); } catch (_) {}
    ok(hugeJson && typeof hugeJson.error === 'string' && hugeJson.error.length > 0,
       '...with a readable sentence saying what to do about it');
    ok(huge.status === 413 || huge.status === 400,
       '...under a status that says "too large" rather than "server broke"');

    // 3b. PAST THE PARSER'S OWN CEILING, which no route code can catch — this
    //     is the case the error handler exists for, and the ONLY one that
    //     discriminates it. 9MB exceeds the 8mb parser limit, so body-parser
    //     throws before the handler function is ever entered; without an error
    //     handler Express answers in HTML and the client dies on <!DOCTYPE,
    //     which is the shape of the bug Dan reported.
    const past = await post('/admin/api/announcements/image',
      { dataUrl: 'data:image/png;base64,' + 'A'.repeat(9 * 1024 * 1024) });
    const pastText = await past.text();
    ok(!/^\s*<!DOCTYPE/i.test(pastText),
       'a paste past the PARSER ceiling is refused in JSON, not HTML — the case only the error handler can answer');
    let pastJson = null;
    try { pastJson = JSON.parse(pastText); } catch (_) {}
    ok(pastJson && typeof pastJson.error === 'string',
       '...with a readable sentence, rather than an HTML page the client cannot parse');
    eq(past.status, 413, '...under 413, which says "too large" rather than "server broke"');

    // 4. AND THE SHAPE CHECK STILL WORKS — the fix must not have turned the
    //    route into something that accepts anything.
    const notAnImage = await post('/admin/api/announcements/image', { dataUrl: 'data:text/html;base64,PGI+' });
    eq(notAnImage.status, 400, 'a non-image data URL is still refused');
  } catch (e) {
    ok(false, 'the live half threw: ' + e.message + '\n' + out.slice(-800));
  } finally {
    srv.kill('SIGKILL');
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (_) {}
  }

  if (failures.length) {
    console.error(`✗ announce-image-upload.spec.js — ${failures.length} failure(s):`);
    for (const f of failures) console.error('  ✗ ' + f);
    console.error(`${passed} passed, ${failures.length} failed.`);
    process.exit(1);
  }
  console.log(`✓ announce-image-upload.spec.js — ${passed} assertions passed.`);
})();
