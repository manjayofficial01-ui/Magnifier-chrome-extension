# Lumina Magnifier

A premium Chrome extension (Manifest V3) that puts a magnifying lens over any
web page or photo, so small text — fine print, receipts, labels, medication
leaflets — becomes effortlessly readable.

`v1.2.0` adds the features users told us were missing and the ones the best
system magnifiers on the market already ship: **custom lens dimensions** (any
width **and** height you type), a **docked full-width lens** like Windows
Magnifier / macOS Zoom, **follow-caret and follow-focus** tracking, a
**colour picker with live WCAG contrast**, **copy-the-text-under-the-lens**,
**read-aloud**, **pixel-perfect (nearest-neighbour) zoom**, **per-site
settings memory**, and eight **reading presets**. It also fixes several real
bugs found during the v1.2.0 pass (see *What changed*).

![Design language: dark glass UI with indigo → violet → cyan gradient accents]

## Features

### The lens (on any web page)
- Follows your mouse at 60 fps with fully local rendering — crisp text, smooth
  edges, accent glow rim.
- **Zoom 100%–1000%** — slider, a typed `%` box, preset chips
  (150 / 200 / 300 / 400 / 500), `Alt` + scroll wheel, or `Alt` + `=` / `Alt` + `-`.
- **Four lens shapes** — Circle, Square, Rounded, Wide rectangle. Switch from
  the popup, the floating toolbar, or `Alt` + `S`.
- **Adjustable lens size, including a custom width × height.** The size slider
  sets the width (or diameter); a numeric **Height** box (0 = auto) lets you
  type any exact dimensions — e.g. a tall 200 × 600 strip for a column of
  fine print, or a short 700 × 160 band for a receipt line. `Alt` + `[` / `]`
  nudges the size in 20 px steps.
- **Lens view modes** — `Floating` (free lens), `Dock top`, `Dock bottom`.
  The docked lens parks a full-width magnified band at the top or bottom of the
  viewport, mirroring the Windows Magnifier / macOS Zoom "docked" view for
  continuous reading.
- **Follow mode** — `Pointer` (default), `Text cursor` (the lens tracks the
  caret / selection as you type or read), and `Keyboard focus` (the lens hops
  to whichever element you Tab to, and steps aside so it never hides the
  control you're focused on — a WCAG 2.4.11-style guard). This matches the
  Windows Magnifier "follow the insertion point / keyboard focus" behaviour.
- **Enhancement filters** — brightness, contrast, **saturation**, sepia **tint**
  with **hue** rotation, **sharpen** (live unsharp convolution kernel that
  crisps up magnified text), invert colours, grayscale, and an optional
  crosshair. Classic low-vision modes: invert a glaring white page into calm
  dark, or boost contrast on faint text.
- **Pixel-perfect mode** (`Alt` + `X`) — nearest-neighbour sampling with whole
  integer zoom steps, so pixel grids and tiny UI text stay razor sharp instead
  of smearing.
- **Reading presets** — 8 one-click colour schemes (Default, Night, Sepia
  paper, High contrast, Grayscale, Inverted, Rose tint, Aqua tint). Each is a
  colour-only preset that never clobbers your zoom, shape, size or sharpen.
- **Pin mode** (`Alt` + `P`) — freezes the lens in place; drag it anywhere,
  scroll-wheel over it to zoom. The frozen frame is sampled at the pinned
  point, so the content no longer chases the pointer (a bug fixed in v1.2.0).
- **Colour picker + WCAG contrast** (`Alt` + `G`) — samples the colour under
  the lens, shows its hex, and grades text-on-this-background contrast as
  AA / AAA or failing, using real WCAG 2.x relative-luminance maths.
- **Copy text under the lens** (`Alt` + `C`) — reads the live DOM text beneath
  the lens (receipts, labels, paragraphs) and copies it to the clipboard.
- **Read aloud** (`Alt` + `V`) — speaks the text under the lens via the Web
  Speech API.
- **Floating glass toolbar** — zoom in/out, shape, pixel-perfect, colour,
  copy, read-aloud, recapture, pin, close — right under the lens.
- **Auto-refresh** — the lens is rendered from a frozen high-resolution
  screenshot (Chrome caps tab captures at 2/sec, so panning and zooming are
  done locally and a fresh frame is captured automatically ~0.6 s after you
  stop scrolling). Content that moves under the lens while you scroll is kept
  aligned in the meantime.
- **Per-site memory** — tick *Remember these settings for this site* and your
  zoom / shape / size / colour choices are stored per host in `chrome.storage.local`
  (sync-quota-friendly) and restored next time. *Reset this site* clears it.

### Photo Magnifier (a full page for images)
- Right-click any image on the web → **"Magnify this image"**.
- Or open it from the popup, then drag & drop a file, paste from the clipboard,
  or paste an image URL.
- Wheel zoom at the cursor (up to 3200%), drag to pan, double-click to dive in,
  Fit / 1:1 buttons, the same enhancement filters, plus a pixel-perfect toggle.

### Control center (popup)
- Power toggle with live per-tab status, zoom (slider **and** typed box),
  shape, size (slider **and** typed width/height), lens view, follow mode,
  reading presets, all enhancement sliders, per-site switch — settings persist
  and apply live.

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
| `Alt` + `G` | Pick colour + WCAG contrast under the lens |
| `Alt` + `C` | Copy text under the lens |
| `Alt` + `V` | Read the text under the lens aloud |
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

To read local images with the Photo Magnifier via drag & drop, that's it —
nothing else to configure. For the lens to work on `file://` pages, enable
**Allow access to file URLs** for the extension on the `chrome://extensions`
details page.

## How it works (and privacy)

- When you activate the lens, the extension takes **one screenshot of the
  visible tab** (`chrome.tabs.captureVisibleTab`) and renders the lens
  **entirely locally**: panning, zooming, shapes and filters are canvas
  operations on that frozen frame, refreshed automatically after scrolling.
  Nothing is ever uploaded; there is no analytics, no network calls, no remote
  code.
- Permissions: `storage` (your settings), `scripting` (inject the lens on
  demand), `contextMenus` (right-click magnify), `tabs` (read the page host for
  per-site memory), and host access to capture the page you are looking at.

## Research basis (what "best-in-class" meant for v1.2.0)

We benchmarked the lens against the leading magnifiers and folded in the gaps:

- **Windows Magnifier** — contributed the *docked* full-width lens and the
  *follow the text cursor / keyboard focus* targets.
- **macOS Zoom** — reinforced docked-lens parity and smooth, frame-synced
  tracking.
- **ZoomText** — informed the reading presets and the high-contrast colour
  modes aimed at low-vision users.
- **Chrome Web Store magnifier extensions** — confirmed the demand for
  *custom lens dimensions* and a *colour checker*, both of which were missing
  from v1.0.0.
- **Google Lens / Circle to Search** — research finding: there is **no Chrome
  extension API** that hands an extension Lens's server-side object/translate
  pipeline, so we don't pretend to be Lens. Instead we integrated the
  Lens-flavoured, fully-local capabilities that *are* possible in an extension:
  point-to-copy text, read-aloud, and instant colour/contrast analysis —
  keeping everything on-device.

## What changed in v1.2.0 (bugs & dead code)

**Real bugs fixed**
- *Pinned lens chasing the pointer* — pinned sampling now reads the frozen
  aim, so the magnified content stays put when pinned.
- *Capture photobombing* — the recapture now hides the whole overlay host
  (toolbar + swatch included), so the lens never appears inside its own
  screenshot.
- *Wrong zoom on fractional-DPR displays* — replaced the fuzzy CSS-scale guess
  with `measureFrame()`, which scores `clientWidth × devicePixelRatio` scale
  pairs for pixel-accurate sampling at 1.25× / 1.5× DPR.
- *Text-under-lens extracting junk / empty* — rewrote extraction to reject
  script/style/svg/canvas/img nodes and, critically, to hide the overlay host
  during DOM hit-testing so the lens frame no longer intercepts its own
  `elementsFromPoint` queries.

**Dead code revived (not deleted — it carried real value)**
- `LuminaMatchPreset` / `LuminaApplyPreset` / `LuminaPresets` / `LuminaNormalizeColour`
  were unused in v1.0.0. They now power the 8 reading-preset chips and the
  colour subset used by the Photo viewer.
- The `saturation`, `sepia`, and `hue` enhancement sliders existed but had no
  UI; they now ship in the popup's *Enhance* panel.

**Other**
- Custom width × height (the headline ask): `lensSize` + `lensHeight` with
  `LuminaLensDims()` driving the lens box, clamped by `LuminaBounds`.
- Zoom ceiling raised 500% → 1000%; size floor lowered to 80 px.
- Manifest bumped to `1.2.0`; added the `tabs` permission for per-site keys.

## Project layout

```
manifest.json                  MV3 manifest (v1.2.0)
src/background/service-worker  capture queue (quota-aware), command relay, context menus, badge
src/content/magnifier.js       lens engine: canvas rendering, shapes, filters, toolbar, shortcuts
src/popup/                     popup control center (HTML/CSS/JS)
src/viewer/                    Photo Magnifier page (HTML/CSS/JS)
src/shared/defaults.js         settings model (shared): bounds, filters, presets, WCAG maths
src/shared/theme.css           design system (shared)
assets/icons/                  generated icons (16/32/48/128)
tools/make-icons.mjs           dependency-free icon generator (node tools/make-icons.mjs)
demo/demo.html                 demo page with tiny text + a "label photo"
test/harness.html              visual test rig for the lens (chrome.* stubbed)
test/model.test.mjs            36 Node unit tests for the shared model
```

## Testing & troubleshooting

- `test/model.test.mjs` — run `node test/model.test.mjs` for the shared-model
  unit tests (clamping, custom lens dims, presets, filter string, WCAG,
  per-site keys). 36/36 pass.
- Load `demo/demo.html` (via a local server or with file access enabled) and
  try the lens on the 7.5 px fine print.
- `test/harness.html?shape=rectangle&zoom=300` renders the lens against a known
  fake screenshot — useful for visual checks without loading the extension.

| Symptom | Fix |
| --- | --- |
| "Chrome blocks extensions on this page" | The lens can't run on `chrome://` / Web Store pages — use a normal web page. |
| Lens shows stale content after fast scrolling | It auto-refreshes; press the ↻ button or `Alt` + `R` for an instant refresh. |
| Blurry magnified text | Expected at very high zoom from a frozen frame; the capture is full device-pixel resolution, so it stays sharp up to ~400% on most displays (use pixel-perfect mode for UI/pixel work). |
| Image won't load in Photo Magnifier | Some sites block direct image access — use right-click → "Magnify this image" on the source page, or drop the downloaded file. |
| Copy / read-aloud returns nothing | The lens must be over actual rendered text; over an image-only area there is no extractable DOM text. |
