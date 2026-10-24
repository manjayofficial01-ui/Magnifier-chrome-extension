# Modernization roadmap

Repeat-run continuity document. Read this first on the next cycle.

- **Baseline:** v1.2.0
- **This cycle:** v1.3.0 (completed)
- **Pre-change snapshots:** `docs/modernization/snapshots/v1.2.0/`

## Execution waves

### Wave 1 — Foundation and critical fixes ✅
| # | Item | Priority | Status |
|---|---|---|---|
| 1 | Per-site override overwriting global settings | P0 | **Done, verified** |
| 2 | Frame recording the wrong scroll offset after a scroll | P1 | **Done, verified** |
| 3 | Recapture dropped while a capture is in flight | P1 | **Done, verified** |
| 4 | Unconditional 60 fps full-viewport repaint | P1 | **Done, verified** |
| 5 | Toolbar off-screen on narrow viewports | P2 | **Done, verified** |
| 6 | `[hidden]` ineffective on *Reset this site* and the viewer zoom bar | P2 | **Done, verified** |
| 7 | Stale stroke radius surviving a reset | P2 | **Done, verified** |
| 8 | Dead field `state.spoken` | P2 | **Done** |

### Wave 2 — Architecture and codebase modernization ⚠️ partial
| # | Item | Status |
|---|---|---|
| 1 | Shared model extended (bounds, site keys, pure helpers) | **Done** |
| 2 | Settings persistence unified between popup and content script | **Done** |
| 3 | Filter-chain factory generalised (`LuminaBoostFilter` alongside `LuminaSharpenFilter`) | **Done** |
| 4 | Split `magnifier.js` into modules | **Deferred** — pure-motion refactor, real regression risk, no user-visible benefit. Revisit only if the file grows further. |
| 5 | Dependency upgrades | **N/A** — zero runtime dependencies |

### Wave 3 — Feature development ✅
| # | Item | Source | Status |
|---|---|---|---|
| 1 | Reading guide (line mask) | ZoomText reading guides | **Done, verified** |
| 2 | Bold text — `feMorphology` stroke thickening | ZoomText xFont | **Done, verified** |
| 3 | Reflow reading strip | macOS Hover Typing, ZoomText DocReader | **Done, verified** |
| 4 | Sentence-navigable read-aloud + highlight + rate | Windows Magnifier H/K, ZoomText AppReader | **Done, verified** |
| 5 | CJK-aware sentence splitting | Own requirement | **Done, verified** |
| 6 | Viewer rotation + viewer Bold text | Own requirement | **Done, verified** |

### Wave 4 — UI/UX transformation ✅
| # | Item | Status |
|---|---|---|
| 1 | Collapsible popup sections (1533 → 1090 px, +14 controls) | **Done, measured** |
| 2 | Live summary values per section | **Done, verified** |
| 3 | Toolbar compact mode + wrap | **Done, verified** |
| 4 | Toolbar/strip/colour-readout collision handling | **Done, verified** |
| 5 | Focus visibility extended to summaries and the strip | **Done** |
| 6 | Strip theme contrast proven ≥ AAA | **Done, verified** |

### Wave 5 — Integration and verification ✅
| # | Item | Status |
|---|---|---|
| 1 | 94 model assertions | **Done** |
| 2 | 52 lens-engine assertions in headless Chrome | **Done** |
| 3 | 46 popup + viewer assertions in headless Chrome | **Done** |
| 4 | Dependency-free CDP driver (`test/cdp.mjs`) | **Done** |
| 5 | Popup layout benchmark (`test/measure.mjs`) | **Done** |
| 6 | Documentation set | **Done** |

## Next cycle priorities

Ordered by value, with the reasoning already recorded in `FEATURE_GAP_ANALYSIS.md`.

1. **DOM-transform lens engine** (L) — render magnified text with a CSS transform on
   the page subtree, keeping the screenshot path as a fallback for canvas/video/PDF.
   This is the only real fix for blur at 400 %+, which is the category's top complaint.
   *Pre-requisite:* a `restore` path that is provably lossless, and a feature check for
   pages where it cannot apply.
2. **WASM OCR in an offscreen document** (L) — makes copy / read-aloud / search work on
   image-only content, where the DOM-based path returns nothing today.
3. **Translator API spike** (S) — determine whether `Translator` works in an extension
   context, then feature-detect rather than promise.
4. **Voice picker for read-aloud** (S) — `speechSynthesis.getVoices()` is already
   reachable; only UI is missing.
5. **Surface `storage.sync` write failures** (S) — currently swallowed, so a quota
   overflow silently stops saving.
6. **Reading zones** (M) — saved regions for repeated form/label reading.
7. **Options page** (M) — the popup is at 59 controls and will not scale further.

## Standing constraints for future cycles

- Never ship a claim that a test did not prove. Report `SKIPPED` / `UNVERIFIED`
  rather than "passing".
- The browser suites must keep working with no npm dependencies.
- Preserve the frozen-frame architecture until the DOM-transform engine replaces it
  behind a flag — do not half-migrate.
- Every new setting goes in `LuminaDefaults`, gets bounds in `LuminaBounds`, and is
  added to `LuminaSiteKeys` if it is a per-site preference.
