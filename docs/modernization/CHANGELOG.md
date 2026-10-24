# Changelog

## v1.3.0 — 2026-10-25

Theme: **from magnifier to reading aid.** Plus five real defects fixed, and the first
test suite that actually exercises the lens engine, the popup and the viewer.

### Added

**Reading guide** (`Alt`+`L`)
- Dims the page to one horizontal band that follows the lens; band height
  (48–600 px) and dim strength (0–90 %) adjustable.
- Drawn as a single `evenodd` canvas fill under the lens, so it costs nothing extra.

**Bold text** (`Alt`+`B`)
- `feMorphology` erosion that thickens glyph strokes; strength 0–100 maps to
  0.12–0.70 px of stroke growth.
- Inserted into the filter chain **after** the level adjustments and **before** any
  tint/grayscale/invert, so it thickens dark-on-light print *and* light-on-dark print
  after inversion. Appending it at the end would erode inverted text into nothing.
- Also available in the Photo viewer.

**Reading strip** (`Alt`+`T`)
- Reflows the text block under the lens into a bottom panel at a chosen size
  (14–48 px), line height (1.1–2.6) and theme (Paper / Night / Amber / High contrast /
  Auto).
- Auto theme follows inversion: a dark lens gets a dark panel.
- The lens toolbar moves to the top edge while the strip is open; the colour readout
  offsets above it.
- Text is inserted as text nodes only — never as markup.

**Navigable read-aloud**
- `Alt`+`V` start/stop, `Alt`+`J` / `Alt`+`K` previous/next sentence,
  `Alt`+`Shift`+`V` pause/resume, speech rate 0.5×–2×.
- Speaks one utterance per sentence, so navigation always makes progress; the spoken
  sentence is highlighted in the reading strip and scrolled into view.
- Stale `onend` callbacks from a cancelled utterance are discarded by an utterance id,
  which is what stops a cancel from skipping a sentence.

**Sentence splitting** (`LuminaSentences`)
- Splits on Latin terminators (`! ? …`) **and** CJK terminators (`。！？`) which are
  self-delimiting and need no following space.
- Hard-wraps runs longer than 240 characters so next/previous always advances.

**Photo viewer**
- Rotate 90° (`R`, or the zoom-bar button); `setZoom` reworked to anchor on the
  rotated display box, so zoom-at-cursor is correct at every rotation.
- Bold text toggle.

**Popup**
- Collapsible sections with live summary values (`Circle · 240×240`,
  `Guide · Bold · Strip`, preset name).
- Controls for every reading aid, including a nested *Fine-tune* disclosure.
- Keyboard-shortcut reference moved into a collapsible section.

**Tests**
- `test/cdp.mjs` — dependency-free Chrome DevTools Protocol driver.
- `test/browser.test.mjs` — 52 assertions against the lens engine in headless Chrome.
- `test/ui.test.mjs` — 46 assertions against the popup and viewer.
- `test/measure.mjs` — popup layout benchmark.
- `test/model.test.mjs` — grown from 36 to 94 assertions.

### Fixed

- **Lens sampled the wrong pixels after a scroll.** The frame's scroll offset was read
  at decode time instead of capture time; `captureVisibleTab` is queued behind a
  ≥550 ms gap, so any scroll during the round trip shifted the recorded origin and the
  magnified content slid away from the pointer. The offset is now recorded before the
  request.
- **A scroll during a capture was silently dropped.** `requestCapture` returned early
  with nothing re-queued, leaving a stale frame until the next scroll. Pending requests
  are now coalesced and serviced once the queue drains.
- **Per-site memory overwrote global settings.** The site-merged settings were written
  back to `luminaSettings`, so using the magnifier on a site with an override replaced
  the user's defaults everywhere. Global and site records are now written separately,
  in both the content script and the popup, and turning per-site off restores the
  global values.
- **Unconditional 60 fps full-viewport repaint.** Rendering is now on demand; an idle
  lens draws zero frames (was ~42 per 700 ms).
- **Toolbar ran off-screen on narrow viewports.** `max-content` width, `max-width`,
  `flex-wrap`, a compact media query below 620 px, and a clamp that centres rather than
  overrunning.
- **`[hidden]` had no effect on *Reset this site* and the viewer zoom bar**, because
  author `display` declarations outrank the UA sheet. Explicit rules added.
- **Stale stroke radius survived a reset** — the filter attribute now tracks the
  setting even at zero.
- Removed dead field `state.spoken`.

### Changed

- `LuminaFilterString(s, opts)` gained an optional `{ boost }`; the base string still
  contains no `url(#…)` reference, because naming a missing SVG filter invalidates the
  whole list.
- `LuminaSharpenFilter` and `LuminaBoostFilter` now share one idempotent SVG mount.
- `LuminaNormalizeColour` carries `textBoost`.
- `LuminaApplyPreset` preserves the reading-aid settings (a colour preset must not
  switch off your guide).
- `LuminaSiteKeys` covers all nine new per-site settings.
- Manifest `1.2.0` → `1.3.0`; description mentions the reading aids.
- README rewritten for v1.3.0.

### Verification

94 model + 52 lens-engine + 46 popup/viewer assertions, all passing. See
`VALIDATION_REPORT.md` for exactly what was and was not proven.

---

## v1.2.0 — 2026-10-10

Custom lens width × height, docked lens, follow pointer/caret/focus, colour picker with
WCAG contrast, copy-text-under-lens, read-aloud, pixel-perfect mode, 8 reading presets,
per-site settings memory. Fixed: pinned-lens pointer chase, capture photobomb,
fractional-DPR frame scaling, text-under-lens overlay interception. 36 model assertions.
