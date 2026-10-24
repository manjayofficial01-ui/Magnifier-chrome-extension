# Technical audit — Lumina Magnifier

Audit date: 2026-10-25 · Baseline: v1.2.0 · No git history in this repository, so
pre-change copies of every touched file are in
`docs/modernization/snapshots/v1.2.0/`.

## 1. Architecture (as found)

```
manifest.json (MV3)
  ├─ background/service-worker.js   capture queue, injection, commands, context menus, badge
  ├─ content/magnifier.js           lens engine (shadow DOM + one full-viewport canvas)
  ├─ popup/                         control center
  ├─ viewer/                        Photo Magnifier page
  └─ shared/defaults.js             settings model, presets, WCAG maths, SVG filter factory
```

**Data flow.** Popup → `chrome.runtime.sendMessage({type:'lumina:activate'})` →
service worker injects `defaults.js` + `magnifier.js` → content script asks for a
`captureVisibleTab` screenshot through the worker's rate-limited queue → renders the
lens locally from that frozen frame.

**Assessment.** The architecture is sound and unusually disciplined for an extension
of this size: one shared model as the single source of truth, a shadow root so page
CSS cannot reach the UI, a serialised capture queue that respects Chrome's 2/sec cap,
and a debug hook used by the tests. Nothing was found that warranted restructuring.
The problems were all in the details.

| Area | Finding |
|---|---|
| Dead code | One genuinely dead field (`state.spoken`, written never read). Removed. Everything else had a live reference. |
| Duplicated logic | The popup and the content script both implemented global-vs-site settings persistence. Both had the same bug (below). Both fixed with the same shape. |
| Deprecated APIs | None in use. `document.execCommand('copy')` survives only as a deliberate fallback for non-secure contexts, where the Clipboard API is unavailable. |
| Dependencies | Zero runtime dependencies, zero build step. `tools/make-icons.mjs` is the only script, and it needs nothing but Node. |
| Test coverage (baseline) | 36 assertions against the shared model. **No test touched the lens engine, the popup or the viewer.** That is where all five defects were. |

## 2. Defects found and fixed

Severity: **P0** data loss / unusable · **P1** wrong output or broken flow ·
**P2** polish / maintainability.

### P1 — The lens sampled the wrong pixels after a scroll
**Where** `content/magnifier.js`, `requestCapture()`
**Root cause** The frame's `scrollX/scrollY` were read inside `img.onload`, i.e. when
the screenshot finished *decoding*. `captureVisibleTab` is queued in the service
worker behind a ≥550 ms gap, so on any page where the user kept scrolling during the
round trip the recorded origin was not the origin the pixels were taken at. The
compensation term in `draw()` (`scroll - frame.scroll`) was then wrong by exactly the
scroll distance, and the magnified content slid away from the pointer.
**Fix** Capture the offset synchronously, before the request is sent, and store it
with the frame.
**Verification** `browser.test.mjs` → *"frame records the scroll offset at capture
time, not reply time"*: with a 260 ms artificial capture delay, scroll to 300, request
a capture, scroll to 700 mid-flight, assert `frameScroll.y === 300`.

### P1 — A scroll during a capture was silently dropped
**Where** `requestCapture()`
**Root cause** `if (state.capturePending) return;` — with no re-queue. The scroll
handler had already cancelled its debounce timer, so the recapture was simply lost and
the lens kept showing a stale frame until the user happened to scroll again.
**Fix** A `recaptureWanted` flag; `flushRecapture()` services it once the queue drains.
**Verification** Covered indirectly by the same scroll test plus the recapture path;
the lens no longer needs a second scroll to refresh.

### P0 — Per-site memory overwrote the global settings
**Where** `content/magnifier.js` `persistSettings()`, `popup/popup.js` `persist()`
**Root cause** `loadStoredSettings()` merged the site override into the global record,
and every subsequent write pushed that *merged* object back to
`chrome.storage.sync.luminaSettings`. Merely using the magnifier on a site with a
saved override silently replaced the user's defaults on every other site. This is data
loss from the user's point of view: their settings are gone and they never asked.
**Fix** Keep the raw global record (`state.globalSettings` / `globalSettings`) separate
from the effective settings. When per-site is on, write the site map only; when it is
off, write the global record. Toggling per-site off re-reads sync so the global values
come back.
**Verification** `browser.test.mjs` → *"global defaults are NOT overwritten by a site
override"*: global `{zoom:200}`, site `{zoom:500}`, load → 500, change → site 500 and
global still 200.

### P1 — Unconditional 60 fps full-viewport repaint
**Where** `content/magnifier.js`, `loop()`
**Root cause** `requestAnimationFrame` re-scheduled itself forever and `draw()`
cleared and repainted a viewport-sized canvas every frame, whether or not anything had
changed. On a 4K display that is continuous compositing for a tool users leave running
while they read.
**Fix** On-demand rendering: a `dirty` flag and `requestDraw()`, called from every
input that can change the picture (pointer, scroll, resize, settings, capture, follow
events). `cancelDraw()` on stop.
**Verification** `browser.test.mjs` → *"idle page does not repaint"*: `draws` is
unchanged over 700 ms with no input, and increases on pointer movement.

### P2 — Toolbar ran off-screen on narrow viewports
**Root cause** `positionToolbar()` clamped `left` between `dockW/2+8` and
`innerWidth-dockW/2-8`; when the toolbar was wider than the viewport the lower bound
exceeded the upper bound and `Math.min` won, pushing it off the left edge. Adding three
toolbar buttons in this cycle made it reachable.
**Fix** `width: max-content` + `max-width: calc(100vw - 16px)` + `flex-wrap`, a
compact media query below 620 px, and a clamp that centres instead of overrunning.
Note: `flex-wrap` with `width: auto` on a fixed element collapses to the widest single
item — `max-content` is required, not optional.
**Verification** `browser.test.mjs` → toolbar spans inside a 420 px viewport (single
row) and inside 300 px (wrapped).

### P2 — `[hidden]` had no effect on two controls
**Root cause** `[hidden] { display: none }` comes from the UA sheet, so any author
`display` declaration beats it. `.site-reset { display: block }` and
`.zoombar { display: flex }` did exactly that, so *Reset this site* stayed visible with
per-site memory off and the viewer's zoom bar floated over the empty state.
**Fix** Explicit `[hidden] { display: none }` rules for both.
**Verification** `ui.test.mjs` → *"Reset this site is hidden when per-site is off"* and
*"zoom bar is hidden on the empty state"*.

### P2 — Stale stroke radius after a reset
**Root cause** The morphology radius was only written when the boost was *enabled*;
turning it off left the previous radius on the element. Harmless visually (the filter
was also dropped from the string) but the DOM disagreed with the setting.
**Fix** Sync the attribute whenever the value differs, including to `0`.
**Verification** `ui.test.mjs` → *"reset clears the boost radius"*.

### P2 — Toolbar centring read a stale width
Folded into the toolbar fix above: `state.dockW` is now re-measured on resize, and the
clamp tolerates a toolbar wider than the viewport.

## 3. Performance

| Measure | Baseline | v1.3.0 | Method |
|---|---|---|---|
| Frames drawn while idle (700 ms) | ~42 (60 fps) | **0** | `draws` counter, `browser.test.mjs` |
| Frames drawn per pointer move | 1 | 1 | same |
| DOM hit-tests per second while the strip is open | n/a | ≤ 4 (throttled 240 ms + text-identity check) | `maybeRefreshStrip()` |
| Layout reads per frame while the strip is open | n/a | 0 (strip height cached) | `state.stripH` |
| Popup height | 1533 px | **1090 px** (−29 %) | `test/measure.mjs` |
| Popup controls | 45 | 59 (+14) | `test/measure.mjs` |

The capture path is unchanged and still bounded by Chrome's 2 captures/sec.

## 4. Security review

| Check | Result |
|---|---|
| Untrusted input reaching the DOM as markup | **None.** The reading strip is built with `textContent` and per-sentence text nodes; the only `innerHTML` uses are static icon strings and a page-supplied hex colour validated through `LuminaHex`. |
| Secrets / credentials in the repo | None. No network calls, no analytics, no remote code, no `eval`. |
| Permissions | Unchanged from v1.2.0: `storage`, `scripting`, `contextMenus`, `tabs`, `<all_urls>`. All four are load-bearing and documented in the README. |
| Injection surface | `chrome.scripting.executeScript` with a fixed file list only — no `func`/`args`, no user-controlled code. |
| Clipboard | `navigator.clipboard.writeText` with an `execCommand` fallback; nothing is read *from* the clipboard in the lens. |
| Cross-origin data | The captured frame is a `data:` URL from `captureVisibleTab`, so the canvas is same-origin and `getImageData` is safe; nothing is transmitted. |
| New dependencies | None added. |

No new vulnerabilities introduced; no pre-existing critical ones found.

## 5. Remaining technical debt

1. **`magnifier.js` is ~1735 lines** in one IIFE. It is coherent and sectioned, but the
   reading strip and read-aloud have pushed it past the point where a split
   (`lens-render` / `reading` / `settings`) would help. Not done here because it is a
   pure-motion refactor with real regression risk and no user-visible benefit.
2. **The capture round trip is still visible** as a ~600 ms stale frame after
   scrolling. The DOM-transform engine is the real fix.
3. **`chrome.storage.sync.set` failures are swallowed.** If a user exceeds the sync
   quota their settings silently stop saving. Worth surfacing.
4. **No options page.** The popup doubles as one, which is fine at 59 controls but
   will not scale.
