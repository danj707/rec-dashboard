// Spec for reconciliation between this dashboard and the rental-report project.
//
// THE INCIDENT (2026-08-25): a report link from this dashboard,
// /town-of-shrewsbury/users?token=WcAyo1FVtpVmXXA2, returned "Unknown org".
// rental-report had removed the duplicate `town-of-shrewsbury` slug on
// 2026-07-20 and serves the org as `shrewsbury` with a different token. This
// dashboard kept its own copy of both and never looked again, so every report
// link it rendered for that org — and the report-visibility fetch — 404'd for
// five weeks. A human clicking it was the detection mechanism.
//
// WHY THE OLD CHECK COULD NOT SEE IT: Add Org asked
// /api/admin/org/:slug once, at creation. By slug. A renamed org answers
// `exists: false` there, which is indistinguishable from an org that was never
// added — so there was nothing to alarm on even if anyone had looked.
//
// WHAT THIS PINS:
//
// 1. RECONCILE ON THE ORGANISATION UUID, NOT THE SLUG. The slug is each
//    project's own name and is precisely the thing that drifts; the rec.us orgId
//    is stable in both. orgId equality is what makes "same organisation, other
//    name" a safe conclusion rather than a guess.
// 2. A RE-ISSUED TOKEN IS ALSO DRIFT, and quieter: the link resolves to a real
//    org and is refused.
// 3. AN ORG THE REPORTING PROJECT GENUINELY DOES NOT HAVE MUST NOT GET AN
//    INVENTED IDENTITY. Leaving it unresolved keeps behaviour as it was and
//    keeps the state visible.
// 4. UNREACHABLE MUST DEGRADE, NOT BREAK. If the reporting project cannot be
//    reached, links must keep pointing where they always did.
//
// Run: node scripts/reporting-identity.spec.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const http = require("http");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");

let passed = 0;
// MUST await: an async case that is not awaited prints ✓ before it runs, and a
// failure surfaces as an unhandled rejection after the summary. Three cases here
// are async.
async function test(name, fn) { await fn(); console.log(`  ✓ ${name}`); passed++; }

// ── A stand-in rental-report, holding the real Shrewsbury shape: the org exists
//    under a DIFFERENT slug, with a DIFFERENT token, same orgId.
const THEIRS = {
  shrewsbury: { token: "17hO58KgKgNVauE5", orgId: "0a9c47af-b4c3-4601-ab0f-d2f401bb787a" },
  watertown:  { token: "sameTokenBothSides", orgId: "11111111-1111-1111-1111-111111111111" },
  torrance:   { token: "theirsIsNewer",      orgId: "22222222-2222-2222-2222-222222222222" },
};
let reqCount = 0;
const stub = http.createServer((req, res) => {
  reqCount++;
  const send = o => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  let m = /^\/api\/admin\/org\/([^/?]+)/.exec(req.url);
  if (m) {
    const slug = decodeURIComponent(m[1]);
    const o = THEIRS[slug];
    return send(o ? { exists: true, slug, ...o } : { exists: false });
  }
  m = /^\/api\/admin\/org-by-id\/([^/?]+)/.exec(req.url);
  if (m) {
    const orgId = decodeURIComponent(m[1]);
    const hit = Object.entries(THEIRS).find(([, o]) => o.orgId === orgId);
    return send(hit ? { exists: true, slug: hit[0], ...hit[1] } : { exists: false });
  }
  res.writeHead(404); res.end("{}");
});

// ── A second stand-in: the SAME data, but /api/admin/org-by-id 404s. This is
//    production rental-report as it stands today — that endpoint ships in a PR
//    that has not merged. The drift must still be resolved against it, or the
//    fix is inert until an unrelated deploy lands in the other project.
//    `sister-city` is the trap: a real org with a similar name and a DIFFERENT
//    orgId, which must never be adopted.
const OLD = {
  shrewsbury:    { token: "17hO58KgKgNVauE5", orgId: "0a9c47af-b4c3-4601-ab0f-d2f401bb787a" },
  "sister-city": { token: "notOurs", orgId: "deadbeef-0000-0000-0000-000000000000" },
};
let oldReqs = [];
const stubOld = http.createServer((req, res) => {
  oldReqs.push(req.url);
  const send = o => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  const m = /^\/api\/admin\/org\/([^/?]+)/.exec(req.url);
  if (m) {
    const slug = decodeURIComponent(m[1]);
    const o = OLD[slug];
    return send(o ? { exists: true, slug, ...o } : { exists: false });
  }
  // org-by-id does not exist here.
  res.writeHead(404); res.end("Cannot GET");
});

// ── Lift the real reconciliation out of server.js rather than restating it: a
//    copy would keep passing after the shipping one regressed.
function slice(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  assert.ok(i > 0 && j > i, `could not slice ${from} — did server.js move?`);
  return src.slice(i, j);
}
const block = slice("const REPORTING_IDENTITY = {};", "// Boot check runs slightly late");

function build(base, orgs) {
  return new Function("REPORTING_BASE_URL", "ORGS", "fetch", "console", `
    ${block}
    return { reconcileWithReporting, reportingIdentity, REPORTING_IDENTITY };
  `)(base, orgs, fetch, { log(){}, warn(){}, error(){} });
}

(async () => {
  await new Promise(r => stub.listen(0, "127.0.0.1", r));
  const BASE = `http://127.0.0.1:${stub.address().port}`;
  await new Promise(r => stubOld.listen(0, "127.0.0.1", r));
  const OLD_BASE = `http://127.0.0.1:${stubOld.address().port}`;

  // ── source-level: the client must not build links from its own slug ────────
  const page = fs.readFileSync(path.join(ROOT, "public", "dashboard.html"), "utf8");
  await test("no rental-report URL is built from the dashboard's own slug/token", () => {
    const bad = page.split("\n").filter(l =>
      /reportingBaseUrl/.test(l) && /ORG_SLUG|[^_]\bTOKEN\b/.test(l) && !/RPT_SLUG|RPT_TOKEN/.test(l));
    assert.deepStrictEqual(bad, [], "these lines still use the dashboard's own names:\n" + bad.join("\n"));
  });

  // Source-level only: this pins that the call exists, not that it behaves. The
  // behaviour above is what is exercised; this is here because Add Org is where
  // the duplicate identity was MADE, and a by-slug-only check there recreates it.
  await test("Add Org looks the org up by orgId too, not only by slug", () => {
    const i = src.indexOf("app.post('/admin/api/orgs'");
    const block = src.slice(i, src.indexOf("ORGS[slug] = org;", i));
    assert.ok(/api\/admin\/org-by-id/.test(block),
      "a by-slug-only check mints a second identity for an org the reporting project already has");
  });

  await test("the report-visibility fetch uses the reconciled slug", () => {
    const i = src.indexOf("/api/org-visibility/");
    const line = src.slice(src.lastIndexOf("\n", i) + 1, src.indexOf("\n", i));
    assert.ok(/reportingIdentity/.test(line), "still fetching visibility with our own slug: " + line.trim());
  });

  // ── the Shrewsbury case ───────────────────────────────────────────────────
  const ours = {
    "town-of-shrewsbury": { token: "WcAyo1FVtpVmXXA2", orgId: THEIRS.shrewsbury.orgId },
    watertown:            { token: "sameTokenBothSides", orgId: THEIRS.watertown.orgId },
    torrance:             { token: "oursIsStale", orgId: THEIRS.torrance.orgId },
    "gone-entirely":      { token: "whatever", orgId: "99999999-9999-9999-9999-999999999999" },
  };
  const M = build(BASE, ours);
  const summary = await M.reconcileWithReporting();

  await test("a renamed org is resolved by orgId, and its links repaired", () => {
    const id = M.reportingIdentity("town-of-shrewsbury");
    assert.strictEqual(id.slug, "shrewsbury", "must adopt the slug rental-report actually serves");
    assert.strictEqual(id.token, "17hO58KgKgNVauE5", "and its token");
    assert.strictEqual(id.state, "slug-drift");
  });

  await test("a re-issued token is adopted — the quieter half of the same failure", () => {
    const id = M.reportingIdentity("torrance");
    assert.strictEqual(id.slug, "torrance");
    assert.strictEqual(id.token, "theirsIsNewer");
    assert.strictEqual(id.state, "token-drift");
  });

  await test("an org that already agrees is left alone", () => {
    const id = M.reportingIdentity("watertown");
    assert.strictEqual(id.slug, "watertown");
    assert.strictEqual(id.token, "sameTokenBothSides");
    assert.strictEqual(id.state, "ok");
  });

  await test("an org the reporting project does not have gets NO invented identity", () => {
    const id = M.reportingIdentity("gone-entirely");
    // Falls back to our own names — unchanged behaviour — and says so.
    assert.strictEqual(id.slug, "gone-entirely");
    assert.strictEqual(M.REPORTING_IDENTITY["gone-entirely"].state, "missing");
    assert.strictEqual(M.REPORTING_IDENTITY["gone-entirely"].slug, null,
      "a guessed slug would point real links at the wrong org");
  });

  await test("the summary counts each kind of drift", () => {
    assert.strictEqual(summary["slug-drift"], 1);
    assert.strictEqual(summary["token-drift"], 1);
    assert.strictEqual(summary.ok, 1);
    assert.strictEqual(summary.missing, 1);
  });

  // ── the fix must not depend on an unmerged deploy in the other project ────
  const oursOld = {
    "town-of-shrewsbury": { token: "WcAyo1FVtpVmXXA2", orgId: OLD.shrewsbury.orgId },
    // Our name for an org whose look-alike over there is a different town.
    "sister-city-ny":     { token: "ours", orgId: "11112222-3333-4444-5555-666677778888" },
  };
  const O = build(OLD_BASE, oursOld);
  await O.reconcileWithReporting();

  await test("drift still resolves when org-by-id is unavailable (production today)", async () => {
    const id = O.reportingIdentity("town-of-shrewsbury");
    assert.strictEqual(id.slug, "shrewsbury",
      "without a candidate probe the fix is inert until rental-report deploys");
    assert.strictEqual(id.token, "17hO58KgKgNVauE5");
    assert.strictEqual(id.state, "slug-drift");
    assert.ok(oldReqs.some(u => /org\/shrewsbury/.test(u)), "it never probed the surviving slug");
  });

  await test("a look-alike org with a different orgId is NEVER adopted", () => {
    // `sister-city` answers 200 over there. Adopting it would point this org's
    // report links at another town's data — worse than a 404.
    assert.strictEqual(O.REPORTING_IDENTITY["sister-city-ny"].state, "missing");
    assert.strictEqual(O.REPORTING_IDENTITY["sister-city-ny"].slug, null);
  });

  // ── degradation ───────────────────────────────────────────────────────────
  await test("an unreachable reporting project leaves links exactly as they were", async () => {
    const N = build("http://127.0.0.1:1", { foo: { token: "t", orgId: "x" } });
    await N.reconcileWithReporting();
    const id = N.reportingIdentity("foo");
    assert.strictEqual(id.slug, "foo", "must not blank the slug on a network failure");
    assert.strictEqual(id.token, "t");
  });

  await test("no REPORTING_BASE_URL is a skip, not a crash", async () => {
    const N = build("", { foo: { token: "t", orgId: "x" } });
    const r = await N.reconcileWithReporting();
    assert.ok(r && r.skipped, "should report a skip");
    assert.strictEqual(N.reportingIdentity("foo").slug, "foo");
  });

  await test("an org that agrees costs exactly one request — no needless probing", async () => {
    // The happy path is every org, every 6h. Candidate probing must be reachable
    // only after a by-slug miss, or a fleet reconcile turns into a slug crawl.
    reqCount = 0;
    const N = build(BASE, { watertown: { token: "sameTokenBothSides", orgId: THEIRS.watertown.orgId } });
    await N.reconcileWithReporting();
    assert.strictEqual(N.reportingIdentity("watertown").state, "ok");
    assert.strictEqual(reqCount, 1, `an agreeing org made ${reqCount} requests`);
  });

  stub.close(); stubOld.close();
  console.log(`\n${passed}/${passed} passing`);
})().catch(e => { stub.close(); stubOld.close(); console.error("\n✗ " + e.message); process.exit(1); });
