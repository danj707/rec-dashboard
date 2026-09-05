/* ── CUSTOMER SUPPORT IS GONE, AND STAYS GONE ─────────────────────────────
   Dan, 2026-09-05: "lets turn off the intercom thing entirely, and remove the
   customer support stuff from the dashboard project."

   The whole surface came out: the Intercom escalation notifier (which emailed
   org admins every 3 minutes' worth of escalations), the seven support-inbox
   routes, the Customer Support dashboard section and its thirteen widgets, the
   per-org supportNotify config, and three modules.

   WHY THIS FILE EXISTS RATHER THAN NOTHING. A removal has no positive test —
   the feature works right up until it is gone, and then nothing exercises it.
   What can regress is a PARTIAL return: a route re-added without its module, a
   widget id that survives in a saved layout, a require of a file that no longer
   exists. So the guard is the absence itself, asserted at every layer.

   AND THE ONE THING THAT MUST STILL WORK: an org whose saved dashboard still
   lists `sup-*` widget ids, or a `support` section, has to keep rendering. Every
   widget and section lookup in the page is guarded (`if (!def) return null`,
   `.filter(Boolean)`, `?.`), so an unknown id resolves to nothing instead of
   throwing — that is what makes this removal safe without a data migration, and
   it is asserted below because it is the property the whole change rests on. */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const page   = fs.readFileSync(path.join(root, 'public/dashboard.html'), 'utf8');

let pass = 0; const failures = [];
const ok = (cond, msg) => { if (cond) pass++; else failures.push(msg); };

/* 1. the modules are actually deleted, not merely unreferenced */
for (const f of ['intercom-live.js', 'support-data.js', 'support-inbox-data.js']) {
  ok(!fs.existsSync(path.join(root, f)), `${f} is deleted`);
}

/* 2. nothing requires them — a dangling require is a boot crash, not a bug you
      find later */
ok(!/require\('\.\/(intercom-live|support-data|support-inbox-data)'\)/.test(server),
   'server.js requires none of the removed modules');

/* 3. the routes are gone */
ok(!/app\.(get|post)\([^)]*\/api\/support\//.test(server), 'no support-inbox routes remain');
ok(!/support-notify/.test(server), 'no support-notify route remains');

/* 4. the notifier is gone — this is the one that sent real email on a timer,
      and the one that blocks going multi-replica */
for (const sym of ['pollEscalations', 'sendEscalationEmail', 'markNotified', 'NOTIFIED_FILE', 'intercomLive']) {
  ok(!server.includes(sym), `${sym} is gone from server.js`);
}
ok(!/INTERCOM/.test(server), 'no INTERCOM_* env read remains');

/* 5. the dashboard surface is gone */
ok(!/'sup-[a-z-]+':/.test(page), 'no sup-* widget definitions remain');
ok(!/'tbl-support-topics':/.test(page), 'the support table widget is gone');
ok(!/SECTIONS\.support|support: \{ id: 'support'/.test(page), 'the Customer Support section is gone');
for (const sym of ['SupportTab', 'SupportInbox', 'hasSupport', 'availableReports.support']) {
  ok(!page.includes(sym), `${sym} is gone from the page`);
}

/* 6. THE SAFETY PROPERTY: a saved layout carrying retired ids still renders.
      Every lookup site must guard, or an org that pinned a support widget gets
      a blank dashboard on the deploy that removes it. */
/* The guards, asserted by their exact text rather than by a pattern-matching
   heuristic. A regex that tries to infer "is this guarded" produces false
   positives on perfectly good code, which is worse than not checking: the
   BEHAVIOURAL proof is the render case `dashboard · a retired support layout
   still renders`, which loads a saved config holding `sup-total` and a
   `support` section and requires the page to come up. */
ok(/const def = W\[widgetId\]; if \(!def\) return null;/.test(page),
   'the widget renderer drops an unknown id instead of throwing');
ok(/const def = W\[id\]; if \(!def \|\|/.test(page),
   '...and so does the section renderer');
ok(/W\[id\] && W\[id\]\.component/.test(page),
   '...and the metric/chart split tests the id exists first');
ok(/const sec = SECTIONS\[sectionId\]; if \(!sec\) return null;/.test(page),
   'an unknown SECTION renders nothing rather than throwing');
ok(/\.filter\(key => SECTIONS\[key\]\)/.test(page),
   '...and the editor lists only sections that still exist');

/* 7. a one-button tab strip is a control that cannot do anything */
ok(!/activeTab/.test(page), 'the tab strip went with the second tab it existed to reach');

process.on('exit', () => {
  if (failures.length) {
    console.error(`✗ support-removed.spec.js — ${failures.length} failure(s):\n`);
    failures.forEach(f => console.error('  ✗ ' + f));
    console.error(`\n${pass} passed, ${failures.length} failed.`);
    process.exitCode = 1;
  } else {
    console.log(`✓ support-removed.spec.js — ${pass} assertions passed.`);
  }
});
