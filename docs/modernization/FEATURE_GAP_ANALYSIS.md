# Feature gap analysis — v1.3.0

Coverage legend: **Yes** = shipped and verified · **Partial** · **No** · **N/A**.
"Verified" means asserted by `test/model.test.mjs`, `test/browser.test.mjs` or
`test/ui.test.mjs` — see `VALIDATION_REPORT.md`.

| # | Feature | Windows Mag | macOS Hover Text | ZoomText | Best store ext. | Lumina v1.2.0 | Lumina v1.3.0 |
|---|---|---|---|---|---|---|---|
| 1 | Movable lens with custom W×H | Yes | No | Yes | Partial | Yes | **Yes** |
| 2 | Docked full-width band | Yes | No | Yes | No | Yes | **Yes** |
| 3 | Follow pointer / caret / focus | Yes | No | Yes | Partial | Yes | **Yes** |
| 4 | Lock / freeze the view | Yes | Yes | Yes | No | Yes (pin) | **Yes** |
| 5 | Colour filters + invert | Yes | Partial | Yes | Partial | Yes | **Yes** |
| 6 | Colour picker with WCAG grading | No | Yes (Hover Colour) | Partial | No | Yes | **Yes** |
| 7 | Copy text under the lens | No | No | Partial | No | Yes | **Yes** |
| 8 | Read aloud | Yes | No | Yes | No | Partial (one shot) | **Yes** |
| 9 | **Sentence back / forward while reading** | Yes (H/K) | No | Yes (AppReader) | No | **No** | **Yes** |
| 10 | **Highlight the text being spoken** | Yes | Yes | Yes | No | **No** | **Yes** |
| 11 | **Adjustable speech rate** | Yes | N/A | Yes | No | **No** | **Yes** |
| 12 | **Stroke thickening (xFont-style)** | Partial ("smooth edges") | No | Yes | No | **No** | **Yes** |
| 13 | **Reading guide / line mask** | No | No | Yes | No | **No** | **Yes** |
| 14 | **Reflow reading panel** | No | Yes (Hover Typing) | Yes (DocReader) | No | **No** | **Yes** |
| 15 | Zoom 100–1000 % | Yes | N/A | Yes (3600 %) | Partial (400 %) | Yes | **Yes** |
| 16 | Pixel-perfect / nearest-neighbour | No | No | No | No | Yes | **Yes** |
| 17 | Per-site settings memory | N/A | N/A | N/A | Partial | Yes (buggy) | **Yes (fixed)** |
| 18 | Reading presets (colour schemes) | Partial | Partial | Yes | No | Yes | **Yes** |
| 19 | Photo / image magnifier page | No | No | No | No | Yes | **Yes** |
| 20 | Rotate a scanned photo | No | No | No | No | **No** | **Yes** |
| 21 | On-device OCR | No | Partial | Yes (Fusion) | No | No | **No** (blocked) |
| 22 | Translation of lens text | No | No | No | No | No | **No** (needs spike) |
| 23 | Reading zones / multiple regions | No | No | Yes | No | No | **No** |
| 24 | Text reflow of the *page* (DOM transform) | No | No | Yes (DocReader) | No | No | **No** (L effort) |

## What was deliberately not built, and why

| Candidate | Effort | Decision |
|---|---|---|
| **DOM-transform lens engine** (CSS `transform: scale` on the page subtree, screenshot only as fallback) | L | **Rejected for this cycle.** It would fix the category's #1 complaint (blur at high zoom from a 2 fps frame) but it is a rewrite of the engine, it breaks on canvas/video/PDF/cross-origin iframes, and it risks the working screenshot path. It is the single highest-value item for the *next* cycle. |
| **WASM OCR in an offscreen document** (Tesseract) | L | **Rejected.** Multi-megabyte download for a feature that only helps image-only content, and `TextDetector` is not a shortcut. Would need a packaging and licensing decision. |
| **On-device translation** | M | **Rejected.** Translator API extension-context support is not documented; shipping it would mean shipping an unverified promise. Needs a feature-detection spike first. |
| **Reading zones (several saved regions)** | M | **Rejected.** Real ZoomText feature, but the lens + strip already covers the "read this one thing" case; the UI cost in the popup is high. |
| **Hold-to-magnify gesture** | S | **Rejected.** Requires a modifier-hold state machine that conflicts with the existing `Alt`-chord shortcuts, for a benefit pin mode already provides. |
| **Reading guide** | S | **Built.** Highest value-per-line-of-code in the whole list: an `evenodd` fill on the existing canvas. |
| **Stroke thickening** | S | **Built.** One `feMorphology` node in the existing filter chain; reuses the sharpen plumbing. |
| **Reflow reading strip** | M | **Built.** The only feature that rescues *visually* unrecoverable print, and it makes read-aloud navigable and highlightable in one go. |
| **Sentence-navigable read-aloud** | M | **Built.** Closes the clearest parity gap with Windows Magnifier and ZoomText, and the shared `LuminaSentences()` splitter is pure and unit-tested. |
| **Viewer rotation** | S | **Built.** Photos of documents are frequently sideways; 20 lines. |

## Ranked backlog carried into the next cycle

1. **DOM-transform lens engine** (L) — the real fix for blur at 400 %+.
2. **WASM OCR in an offscreen document** (L) — makes copy/read/translate work on
   image-only content.
3. **Translation spike** (S) — verify `Translator` availability in an extension
   context, then gate behind feature detection.
4. **Reading zones** (M) — saved regions for repeated form/label reading.
5. **Voice picker** in the read-aloud bar (S) — `speechSynthesis.getVoices()` is
   already available; only the UI is missing.
