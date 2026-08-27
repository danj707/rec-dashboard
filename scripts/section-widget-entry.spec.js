// Spec for the per-section widget entry point.
//
// THE ASK (Dan, 2026-08-27): "for the '5 widgets' section, make the widgets area
// clickable, so I can customize the specific widgets for that section (in
// addition to keeping the 'Edit Dashboard' option at the top. Just makes more
// sense to add/remove widgets inside a specific section, I think people don't
// see it at the top."
//
// WHAT THIS PINS, and why each one is load-bearing:
//
// 1. ONE WIDGET PICKER, NOT TWO. The badge opens the SAME EditModal, focused on
//    the section it was clicked from. A second, section-scoped picker would drift
//    from the first the moment a widget rule changed (a limit, a new section, the
//    report-visibility filter), and the two would disagree about what is
//    addable. So the spec fails if a second modal appears.
//
// 2. THE BADGE MUST LOOK LIKE A CONTROL AT REST. This whole request exists
//    because a control nobody can find is a control that does not exist — the
//    same lesson as the Fast Track pin, which shipped at 35% opacity on hover and
//    was later reported as a missing feature. A hover-only affordance here would
//    reproduce exactly the problem being fixed.
//
// 3. THE TOOLBAR ROUTE MUST STAY UNFOCUSED. "in addition to keeping the 'Edit
//    Dashboard' option at the top" — so opening from the toolbar must not inherit
//    a section from a previous badge click, or the generic entry point silently
//    becomes section-scoped after the first use.
//
// 4. READ-ONLY AND PRINT GET A PLAIN BADGE. A shared/read-only dashboard cannot
//    save a config, so an inviting button that refuses to work is worse than a
//    label. Print, likewise, has nothing to click.
//
// Run: node scripts/section-widget-entry.spec.js

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const PAGE = path.join(__dirname, '..', 'public', 'dashboard.html');
const src = fs.readFileSync(PAGE, 'utf8');

let n = 0;
const ok = (cond, what) => { n++; assert.ok(cond, what); };
const is = (a, b, what) => { n++; assert.strictEqual(a, b, what); };

// ── 1. One picker ──────────────────────────────────────────────────────────
is((src.match(/function EditModal\(/g) || []).length, 1,
   'there must be exactly ONE EditModal — a second section-scoped picker would drift from it');

ok(/function EditModal\(\{[^}]*focusSection[^}]*\}\)/.test(src),
   'EditModal should take focusSection, so the badge reuses it rather than duplicating it');

ok(/useState\(focusSection \|\| sections\[0\]\?\.id \|\| ''\)/.test(src),
   'the modal should open expanded on focusSection when given one, falling back to the first section');

// ── 2. The badge is a real, visible control ────────────────────────────────
ok(/data-customize=\{sectionId\}/.test(src),
   'the badge should carry data-customize so a browser check can find and drive it');

ok(/onClick=\{\(\) => onCustomize\(sectionId\)\}/.test(src),
   'the badge should open this section, not the modal in general');

ok(/className="section-badge section-badge-btn"/.test(src),
   'the badge should be a button with its own class, not a bare span');

{
  // The affordance must be present at REST, not only on :hover — that is the
  // failure mode this whole change is fixing.
  const rest = /\.section-badge-btn \{([^}]*)\}/.exec(src);
  ok(rest, 'there should be a .section-badge-btn rule');
  ok(/cursor: pointer/.test(rest[1]),
     'the badge must read as clickable at rest (cursor), not only on hover');
  ok(/\.section-badge-btn \.sb-pencil/.test(src),
     'a persistent affordance (the pencil) should sit in the badge at rest');
  // ...and the MARKUP must actually render it. Checking only the CSS rule passes
  // happily when the JSX stops emitting the element — caught by mutation.
  ok(/className="sb-pencil"/.test(src),
     'the badge markup must render the sb-pencil element, not just style one');
  const hoverOnly = /\.section-badge-btn:hover \{([^}]*)\}/.exec(src);
  ok(hoverOnly, 'a hover state is fine as reinforcement');
  ok(!/opacity:\s*0(\.\d+)?\s*;[^}]*\}\s*\.section-badge-btn:hover/.test(src.replace(/\s+/g, ' ')),
     'the badge must not be hidden or faded at rest — that is the pin bug again');
}

ok(/:focus-visible/.test(src), 'the badge needs a visible keyboard focus state');

// ── 3. The two entry points stay distinct ──────────────────────────────────
ok(/setEditFocus\(null\);setEditOpen\(true\);track\('edit_opened',\{from:'toolbar'\}\)/.test(src),
   'Edit Dashboard must CLEAR the focus, or it inherits whichever section was opened last');

ok(/function openSectionWidgets\(sectionId\)/.test(src),
   'the section route should be its own named handler');

ok(/track\('edit_opened', \{ from: 'section', section: sectionId \}\)/.test(src),
   'the two routes should be distinguishable in the event log, so we can see which one people use');

ok(/onClose=\{\(\)=>\{setEditOpen\(false\);setEditFocus\(null\);\}\}/.test(src),
   'closing must clear the focus too');

// ── 4. Read-only and print get a label, not a dead button ─────────────────
ok(/onCustomize=\{isReadOnly \|\| IS_PRINT \? null : openSectionWidgets\}/.test(src),
   'read-only and print dashboards must not be handed a customize handler');

ok(/onCustomize\s*\n?\s*\?\s*<button/.test(src) || /\{onCustomize\s*$/m.test(src),
   'the badge should fall back to a plain span when there is no handler');

is((src.match(/<span className="section-badge">\{widgetIds\.length\} widgets<\/span>/g) || []).length, 1,
   'the plain-badge fallback should still exist for read-only viewers');

// ── 5. The modal names what it is showing ─────────────────────────────────
ok(/SECTIONS\[focusSection\]\.label \+ ' widgets' : 'Edit Dashboard'/.test(src),
   'the modal title should name the section when focused, so it is clear it is scoped');

console.log('✓ section-widget-entry.spec.js — ' + n + ' assertions');
