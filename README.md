# Lumina Magnifier

A premium Chrome extension (Manifest V3) that puts a magnifying lens over any
web page or photo, so small text — fine print, receipts, labels, medication
leaflets — becomes effortlessly readable.

`v1.3.0` turns the lens from a magnifier into a **reading aid**: a
**reading guide** that dims everything but one band, **Bold text** that thickens
faint strokes the way ZoomText's xFont does, a **reflow reading strip** that
lifts the text under the lens into a legible panel, and **read-aloud you can
navigate sentence by sentence** with the spoken sentence highlighted. It also
fixes five real defects found in the v1.2.0 engine — including two that corrupted
what you were looking at and one that silently overwrote your saved settings.

![Design language: dark glass UI with indigo → violet → cyan gradient accents]

## Features

### The lens (on any web page)
- Follows your mouse with fully local rendering — crisp text, smooth edges,
  accent glow rim.
- **Zoom 100%–1000%** — slider, a typed `%` box, preset chips
  (150 / 200 / 300 / 400 / 500), `Alt` + scroll wheel, or `Alt` + `=` / `Alt` + `-`.
- **Four lens shapes** — Circle, Square, Rounded, Wide rectangle. Switch from
  the popup, the floating toolbar, or `Alt` + `S`.
- **Adjustable lens size, including a custom width × height.** The size slider
  sets the width (or diameter); a numeric **Height** box (0 = auto) lets you
  type any exact dimensions — e.g. a tall 200 × 600 strip for a column of fine
  print. `Alt` + `[` / `]` nudges the size in 20 px steps.
- **Lens view modes** — `Floating`, `Dock top`, `Dock bottom`. The docked lens
  parks a full-width magnified band at an edge, mirroring the Windows Magnifier
  / macOS Zoom "docked" view for continuous reading.
- **Follow mode** — `Pointer` (default), `Text cursor`, and `Keyboard focus`
  (the lens hops to whatever you Tab to, and steps aside so it never hides the
  control you're focused on — a WCAG 2.4.11-style guard).
- **Enhancement filters** — brightness, contrast, saturation, sepia tint with
  hue rotation, **sharpen** (unsharp convolution), invert, grayscale, crosshair.
- **Pixel-perfect mode** (`Alt` + `X`) — nearest-neighbour sampling with whole
  integer zoom steps, so pixel grids and tiny UI text stay razor sharp.
- **Reading presets** — 8 one-click colour schemes (Default, Night, Sepia
  paper, High contrast, Grayscale, Inverted, Rose tint, Aqua tint). Colour-only:
  a preset never clobbers your zoom, shape, size, guide or text weight.
- **Pin mode** (`Alt` + `P`) — freezes the lens in place; drag it anywhere,
  scroll-wheel over it to zoom.
- **Colour picker + WCAG contrast** (`Alt` + `G`) — samples the colour under
  the lens, shows its hex, and grades text-on-this-background contrast as
  AA / AAA or failing, using real WCAG 2.x relative-luminance maths.
- **Copy text under the lens** (`Alt` + `C`) and **read aloud** (`Alt` + `V`).
- **Per-site memory** — tick *Remember these settings for this site* and your
  choices are stored per host and restored next time. *Reset this site* clears it.
- **Auto-refresh** — the lens is rendered from a frozen screenshot (Chrome caps
  tab captures at 2/sec, so panning and zooming are done locally and a fresh
  frame is captured automatically ~0.6 s after you stop scrolling).
- **Draws on demand** — the lens repaints when something actually changes, not
  60 times a second forever. A still pointer on a still page costs nothing.

### Reading aids (new in v1.3.0)

- **Reading guide** (`Alt` + `L`) — dims the whole page to a single horizontal
  band that follows the lens, so your eye cannot drift to the wrong line. Band
  height and dim strength are adjustable. The classic low-vision reading ruler.
- **Bold text** (`Alt` + `B`) — an `feMorphology` erosion pass that thickens
  glyph strokes before any invert, so it rescues faint, thin or
  low-contrast print instead of just enlarging it. Strength is a 0–100 slider
  (0.12–0.70 px of stroke growth); the toolbar button is a one-touch toggle.
- **Reading strip** (`Alt` + `T`) — reflows the text block under the lens into a
  panel at the bottom of the screen, at a size and line height you choose, on a
  Paper / Night / Amber / High-contrast theme. This is the feature that rescues
  print that is *visually* unrecoverable — a 6 px medication leaflet becomes
  22 px prose. The lens toolbar moves to the top edge so nothing overlaps.
- **Navigable read-aloud** — `Alt` + `V` starts reading, `Alt` + `J` / `Alt` + `K`
  step back and forward a sentence (the Windows Magnifier H/K convention),
  `Alt` + `Shift` + `V` pauses. The sentence being spoken is highlighted in the
  reading strip, so you see and hear the same words. Speech rate is adjustable
  0.5×–2×.
- Sentences are split on Latin *and* CJK terminators, so `饭后服用。Store below
  25 C.` is two navigable sentences.

### Photo Magnifier (a full page for images)
- Right-click any image on the web → **"Magnify this image"**, or open it from
  the popup, then drag & drop a file, paste from the clipboard, or paste a URL.
- Wheel zoom at the cursor (up to 3200%), drag to pan, double-click to dive in,
  Fit / 1:1 buttons, **rotate 90°** (`R`), the same enhancement filters plus
  **Bold text**, and a pixel-perfect toggle.

### Control center (popup)
- Power toggle with live per-tab status, zoom (slider **and** typed box), lens
  shape, size (slider **and** typed width/height), lens view, follow mode,
  reading aids, reading presets, all enhancement sliders, per-site switch.
- Sections collapse, so the popup is **29 % shorter than v1.2.0 despite 14 more
  controls** — Zoom and the reading aids stay visible, the seven enhancement
  sliders fold away until you need them.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Alt` + `M` | Toggle the magnifier |
| `Alt` + scroll | Zoom in / out |
| `Alt` + `=` / `Alt` + `-` | Zoom in / out (10% steps) |
| `Alt` + `[` / `]` | Decrease / increase lens size (20 px) |
| `Alt` + arrows | Nudge the lens — `Shift` held = 40 px steps (8 px otherwise) |
| `Alt` + `S` | Cycle lens shape |
| `Alt` + `X` | Toggle pixel-perfect mode |
| `Alt` + `B` | Toggle Bold text (stroke thickening) |
| `Alt` + `L` | Toggle the reading guide |
| `Alt` + `T` | Toggle the reading strip |
| `Alt` + `G` | Pick colour + WCAG contrast under the lens |
| `Alt` + `C` | Copy text under the lens |
| `Alt` + `V` | Read aloud / stop reading |
| `Alt` + `J` / `Alt` + `K` | Previous / next sentence while reading |
| `Alt` + `Shift` + `V` | Pause / resume reading |
| `Alt` + `P` | Pin / unpin the lens |
| `Alt` + `R` | Recapture the page |
| `Alt` + `Shift` + `F` | Cycle follow mode (pointer / caret / focus) |
| `Alt` + `Shift` + `D` | Cycle lens view (floating / dock top / dock bottom) |
| `Esc` | Close the lens |

(All shortcuts except `Alt`+`M` can be re-bound at `chrome://extensions/shortcuts`.)

## Install (developer mode)

1. Download / unzip this folder.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked** and select the `Magnifier` folder (the one
   containing `manifest.json`).
5. Pin **Lumina Magnifier** to the toolbar, open any page, press `Alt` + `M`.

For the lens to work on `file://` pages, enable **Allow access to file URLs** for
the extension on the `chrome://extensions` details page.

## How it works (and privacy)

- When you activate the lens, the extension takes **one screenshot of the
  visible tab** (`chrome.tabs.captureVisibleTab`) and renders the lens
  **entirely locally**: panning, zooming, shapes, filters and stroke
  thickening are canvas and SVG-filter operations on that frozen frame,
  refreshed automatically after scrolling. Nothing is ever uploaded; there is no
  analytics, no network calls, no remote code.
- The reading strip and copy/read-aloud read the **live DOM** under the lens
  with `caretRangeFromPoint` — locally, and only the block you point at.
- Permissions: `storage` (your settings), `scripting` (inject the lens on
  demand), `contextMenus` (right-click magnify), `tabs` (read the page host for
  per-site memory), and host access to capture the page you are looking at.

## Research basis

We benchmarked against the leading magnifiers and folded in the gaps that
actually matter for reading:

- **Windows Magnifier** — the *docked* lens and the *follow text cursor /
  keyboard focus* targets (v1.2.0); the **reading/narration controls with
  previous/next sentence** (H/K) in v1.3.0.
- **macOS Zoom and Hover Text** — docked-lens parity, and the idea that the aid
  should be *locked* on while you read rather than chasing the pointer.
- **ZoomText** — reading presets and high-contrast modes (v1.2.0); **xFont-style
  stroke thickening** and AppReader-style **sentence-by-sentence reading with a
  highlight** in v1.3.0.
- **Chrome Web Store magnifier extensions** — the category is thin and badly
  rated: the most-installed option has ~300k users at 4.27, while several peers
  sit at 2.1–2.6 stars with reviews like *"doesn't work"*, *"will not activate"*,
  *"options page won't open"*. **Reliability is the moat here, not feature
  count** — which is why v1.3.0 is mostly bug fixes and verified behaviour.
- **Google Lens / Circle to Search** — there is still **no Chrome extension API**
  that hands an extension Lens's server-side pipeline, and `TextDetector` is
  still flag-gated and unimplemented for text. So we don't pretend to be Lens:
  everything is on-device, and OCR is listed as future work rather than faked.

## What changed in v1.3.0

### Real bugs fixed
- **The lens sampled the wrong pixels after a scroll.** The frame's scroll
  offset was read when the screenshot finished *decoding*, not when it was
  *taken*. `captureVisibleTab` is queued and can wait ~550 ms, so any scroll in
  that window was recorded as the wrong origin and the magnified content slid
  away from the pointer. The offset is now captured before the request.
- **A scroll during a capture was silently dropped.** `requestCapture` returned
  early while a capture was in flight and nothing re-queued it, so the lens kept
  showing a stale frame until you happened to scroll again. Pending requests are
  now coalesced and serviced once the queue drains.
- **Per-site memory overwrote your global settings.** With *Remember for this
  site* on, the effective (site-merged) settings were written back to
  `luminaSettings`, so merely using the magnifier on one site replaced your
  defaults everywhere. Global and site records are now written separately.
- **The toolbar ran off the screen on narrow viewports.** It is now
  `max-content` with a `max-width`, so it stays one row down to ~430 px and
  wraps cleanly below that instead of clipping both ends.
- **`[hidden]` did nothing on two controls.** `.site-reset { display: block }`
  and `.zoombar { display: flex }` outranked the UA sheet's
  `[hidden] { display: none }`, so "Reset this site" showed with per-site memory
  off and the viewer's zoom bar floated over the empty state.
- **A stale stroke radius survived a reset** — the filter's DOM attribute is now
  kept in sync with the setting even when it drops to zero.

### Performance
- **Rendering is on demand.** The old `requestAnimationFrame` loop repainted the
  full-viewport canvas 60 times a second forever, even with a still pointer and
  nothing to show — a real battery cost for a tool people leave running while
  they read. Every input that changes the picture now requests a draw; an idle
  lens costs zero frames (verified in the browser test).

### New
- Reading guide, Bold text, reading strip, navigable read-aloud, viewer rotation
  and viewer Bold text.
- Popup sections collapse; new controls for every reading aid.
- A real test suite: 94 model assertions, 52 lens-engine assertions and 46
  popup/viewer assertions, run against headless Chrome.

## Project layout

```
manifest.json                  MV3 manifest (v1.3.0)
src/background/service-worker  capture queue (quota-aware), command relay, context menus, badge
src/content/magnifier.js       lens engine: canvas rendering, guide, strip, read-aloud, toolbar, shortcuts
src/popup/                     popup control center (HTML/CSS/JS)
src/viewer/                    Photo Magnifier page (HTML/CSS/JS)
src/shared/defaults.js         settings model (shared): bounds, filters, presets, sentence splitting, WCAG maths
src/shared/theme.css           design system (shared)
assets/icons/                  generated icons (16/32/48/128)
tools/make-icons.mjs           dependency-free icon generator (node tools/make-icons.mjs)
test/harness.html              visual + behavioural rig for the lens (chrome.* stubbed)
test/cdp.mjs                   dependency-free Chrome DevTools Protocol driver
test/model.test.mjs            Node unit tests for the shared model
test/browser.test.mjs          headless-Chrome assertions for the lens engine
test/ui.test.mjs               headless-Chrome assertions for the popup and viewer
test/measure.mjs               popup layout benchmark (v1.2.0 vs current)
docs/modernization/            audit, competitor analysis, roadmap, validation report
```

## Testing

```bash
node test/model.test.mjs     # 94 shared-model assertions, no browser needed
node test/browser.test.mjs   # 52 lens-engine assertions in headless Chrome
node test/ui.test.mjs        # 46 popup + viewer assertions in headless Chrome
node test/measure.mjs        # popup layout benchmark
```

`browser.test.mjs` and `ui.test.mjs` drive a real Chrome over the DevTools
Protocol with no npm dependencies (Node 22's built-in `WebSocket`), loading the
actual content script with `chrome.*` stubbed. Add `--shots` to either to write
screenshots into `test/`, or `--headed` to watch. If no Chromium binary is found
the browser suites report `SKIPPED` rather than pretending to pass.

| Symptom | Fix |
| --- | --- |
| "Chrome blocks extensions on this page" | The lens can't run on `chrome://` / Web Store pages — use a normal web page. |
| Lens shows stale content after fast scrolling | It auto-refreshes; press the ↻ button or `Alt` + `R` for an instant refresh. |
| Blurry magnified text | Expected at very high zoom from a frozen frame; try **Bold text** (`Alt`+`B`) or pixel-perfect mode for UI/pixel work. |
| Image won't load in Photo Magnifier | Some sites block direct image access — use right-click → "Magnify this image" on the source page, or drop the downloaded file. |
| Copy / read-aloud returns nothing | The lens must be over actual rendered text; over an image-only area there is no extractable DOM text. |
| Reading strip says "No text under the lens" | Same reason — it reads the DOM, not the pixels. Use the lens itself on image-only content. |
