# Validation report — v1.3.0

Run date: 2026-10-25 · Platform: Windows, Chrome (headless `--headless=new`),
Node 22.22.2, `devicePixelRatio` 1, viewport 1422×804 unless overridden.

## Result

| Suite | Command | Result |
|---|---|---|
| Shared model | `node test/model.test.mjs` | **94 passed, 0 failed** |
| Lens engine (headless Chrome) | `node test/browser.test.mjs` | **52 passed, 0 failed, 0 skipped** |
| Popup + viewer (headless Chrome) | `node test/ui.test.mjs` | **46 passed, 0 failed, 0 skipped** |
| Popup layout benchmark | `node test/measure.mjs` | 1533 px → **1090 px (−29 %)** for **+14** controls |

`192 assertions passing across three suites.` Baseline for comparison was 36 assertions,
none of which touched the lens engine, the popup or the viewer — which is precisely
where every defect in this cycle lived.

```
94 passed, 0 failed
52 passed, 0 failed, 0 skipped
46 passed, 0 failed, 0 skipped
```

## What each suite actually proves

### `test/model.test.mjs` (94) — pure logic, no browser
Clamping and coercion of every setting (including the 9 new ones), the custom lens
dimension maths, preset matching and application, the filter-string contract, WCAG
luminance/contrast, the sharpen kernel sum, the site-key list, sentence splitting
(Latin, CJK, mixed, empty, null, long-run wrapping, decimals, ellipsis), strip theme
resolution, and stroke-radius mapping.

Two of these are *invariants* rather than examples:
- `the plain filter string never names an SVG filter` — a `url(#…)` reference to a
  missing filter silently kills the entire filter list, so this is a real trap.
- `boost runs BEFORE invert` — the morphology has to see the page's own polarity.
- `every strip theme clears AAA (>=7:1)` — a reading aid that fails contrast is the
  problem, not the cure. Measured: 17.0 / 16.4 / 14.3 / 21.0.

### `test/browser.test.mjs` (52) — the real content script, real Chrome
Loads `test/harness.html`, which runs the **actual** `src/content/magnifier.js` with
`chrome.*` stubbed, then asserts on the rendered canvas by reading pixels back.

Proven:
- The lens starts, captures a frame, sizes its canvas to the viewport, and **paints
  pixels** (non-transparent pixel count > 5000).
- **On-demand rendering**: `draws` is unchanged over 700 ms with no input, and
  increases on pointer movement. This is the performance claim, measured.
- Lens geometry: centres on the pointer; docked band is full width and flush to the
  edge; wide lens keeps 1.6:1; custom 320×120 is honoured exactly.
- **Reading guide**: with the guide off, nothing is painted outside the lens (alpha
  < 4); with it on, the page area reaches alpha > 140 and luminance < 70 while the
  band stays clear (alpha < 20). Sampled at x 0–60 so the lens never covers the probe.
- **Text weight**: the `#lumina-boost feMorphology` element exists, radius is `0` when
  off and > 0.4 when set to 80.
- **Reading strip**: opens, measures its height, extracts real page text
  (`/LUMINOSTAT/`), splits it into ≥ 2 sentences, reports the count, and uses the
  configured 22 px size. The toolbar moves to y = 16 while it is open, and the lens
  stays clear of the strip's top edge even when the pointer is at the bottom of the
  viewport.
- **Sentence splitter**: Latin + CJK terminators produce 3 navigable sentences from
  `Take one tablet. Do not exceed four in 24 hours! 饭后服用。`
- **Read-aloud queue**, driven with a controllable speech stub whose `cancel()`
  deliberately fires the pending `onend` — which is what Chrome does, and the exact
  hazard the utterance-id guard exists for. Proven: the first sentence is spoken, the
  position is reported, `next` advances **exactly one** sentence (no double-skip),
  `previous` steps back, `stop` clears the active flag, and auto-advance reads
  `Alpha. → Beta. → Gamma.` in order then stops at the end.
- **Settings isolation**: global `{zoom:200}`, site `{zoom:500}` → loads 500, a change
  writes the site map to 500, and **the global record is still 200**.
- **Scroll race**: with a 260 ms artificial capture delay, scroll to 300, request a
  capture, scroll to 700 mid-flight, and `frameScroll.y` is still **300**.
- **Toolbar layout**: spans inside a 420 px viewport on one row (≤ 46 px tall), and
  wraps inside 300 px instead of clipping.
- No uncaught exceptions and no console errors for the whole run.

**The suite was mutation-checked.** Reversing the utterance-id guard (bumping the id
*after* `cancel()` instead of before) turns two of these assertions red with the
output `One.|Three.|Three.` — sentences silently skipped, exactly the bug the guard
prevents. Restoring the guard returns 52/52. The assertions are not vacuous.

### `test/ui.test.mjs` (46) — popup and viewer as pages
- Popup: boots into preview mode; **"Reset this site" is `display:none` when per-site
  is off and visible when it is on** (the `[hidden]` bug); reading-aid toggles flip and
  update the summary (`Off` → `Guide` → `Guide · Strip` → `Guide · Bold · Strip`);
  the bold button sets 55 and back to 0; read-rate labels format as `1.5×` and `2×`;
  the strip-theme segment moves; the lens summary tracks shape; preset chips drive the
  derived label; sections collapse and expand; 360 px wide with no horizontal overflow;
  Zoom and the power switch are reachable inside a 360×600 popup viewport.
- Viewer: boots; **zoom bar is `display:none` on the empty state** and visible once an
  image loads (the second `[hidden]` bug); fit shrinks a 2000×600 image below 100 %;
  zoom-in updates the label; **rotation refits for portrait** (34 % → smaller); canvas
  stays sized; bold raises the morphology radius and reset returns it to `0`; the
  sharpen kernel updates.
- No uncaught exceptions across both pages.

### `test/measure.mjs`
Loads the v1.2.0 snapshot and the current popup and reports width, height, control
count and section count. This is the evidence behind the "29 % shorter with 14 more
controls" claim.

## Quality gates

| Gate | Status |
|---|---|
| 1. Builds successfully | **N/A** — no build step; every file passes `node --check` |
| 2. Lint / static analysis | **Partial** — `node --check` on all 7 JS modules; no linter is configured in this repository |
| 3. Unit tests pass | **PASS** (94) |
| 4. Integration tests pass | **PASS** (52 lens + 46 UI, real Chrome) |
| 5. Critical end-to-end flows work | **PARTIAL** — see limitations |
| 6. No new critical security vulnerabilities | **PASS** — review in TECHNICAL_AUDIT §4; no new dependencies, no new permissions, no markup injection |
| 7. No breaking API/DB changes | **PASS** — settings are additive and `LuminaNormalize` defaults any missing key, so a v1.2.0 storage record loads unchanged |
| 8. UI responsive and accessible | **PASS** — narrow-viewport assertions, focus visibility, AAA strip contrast |
| 9. Existing functionality preserved | **PASS** — the v1.2.0 assertions still pass unchanged, plus shape/size/dock/zoom/preset coverage |
| 10. Performance does not regress | **PASS** — idle draw count 42 → 0 |
| 11. Documentation reflects behaviour | **PASS** — README, CHANGELOG, this report |
| 12. Acceptance criteria met | **PASS** for every item marked *Done, verified* in the roadmap |

## Limitations — what was NOT verified

These are stated plainly rather than glossed over.

1. **The extension was never loaded into Chrome as an extension.** The harness stubs
   `chrome.*`, so `chrome.tabs.captureVisibleTab`, the service-worker capture queue,
   `chrome.scripting.executeScript`, `chrome.commands`, `chrome.contextMenus` and the
   real `chrome.storage` quota behaviour are **UNVERIFIED** in this cycle. The capture
   *protocol* was exercised (with a simulated 260 ms delay) but not the real API.
2. **Speech *output* was not heard.** `speechSynthesis` exists in headless Chrome but
   produces no audio, so the real engine was replaced with a controllable stub for the
   queue tests. The queue, navigation, highlight and stop behaviour are proven; the
   audible result and real `onend` timing are **UNVERIFIED**.
3. **Only one fixture page was used** (`test/harness.html`). Real-world pages with
   complex DOM, shadow roots, cross-origin iframes, PDF viewers, canvas apps and
   aggressive CSS are **UNVERIFIED**. In particular, the DOM hit-testing behind the
   reading strip is known to return nothing over image-only content by design.
4. **`devicePixelRatio` 1 only.** Fractional-DPR behaviour (1.25× / 1.5×) is handled by
   `measureFrame()` and was reviewed, but was not asserted at 2× until the screenshot
   pass; the automated suites run at 1.
5. **No accessibility audit tool was run.** No axe/Lighthouse pass. The a11y claims in
   `UI_UX_AUDIT.md` are based on the code (roles, labels, focus rules, measured
   contrast), not on an automated audit.
6. **No real performance profile.** The idle-draw measurement is a behavioural proxy
   for battery cost, not a measured power figure.
7. **OCR, translation and the DOM-transform lens engine were not built**, so there is
   nothing to verify for them. They are recorded as future work, not as gaps silently
   closed.
8. **`magnifier.js` was not split into modules.** Deferred deliberately; see the
   technical debt section of `TECHNICAL_AUDIT.md`.

## How to reproduce

```bash
node test/model.test.mjs     # 94 assertions
node test/browser.test.mjs   # 52 assertions (add --shots / --headed)
node test/ui.test.mjs        # 46 assertions (add --shots / --headed)
node test/measure.mjs        # layout benchmark
```

The browser suites locate Chrome or Edge from a fixed candidate list, then launch it
with a throwaway profile that is removed afterwards. If no Chromium binary is found
they report `SKIPPED` and exit 0 rather than claiming a pass.
