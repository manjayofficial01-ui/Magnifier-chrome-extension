# Competitor analysis — Lumina Magnifier

Cycle: v1.2.0 → v1.3.0 · Research date: 2026-10-25 · Method: official docs first,
aggregator data second, no inference about features that could not be verified.

Confidence key: **High** = official documentation read directly. **Medium** =
reputable secondary source or aggregator. **Unverified** = could not confirm;
explicitly not relied upon.

---

## 1. Windows Magnifier (Microsoft)

**Confidence: High** — support.microsoft.com Magnifier guide, chapters 2/3/5/6 and
the keyboard-shortcuts page.

| Capability | Detail |
|---|---|
| Views | Full screen / **Lens** (movable, resizable W×H) / **Docked** (strip pinned to an edge, draggable, undockable). `Ctrl+Alt+F/L/D/M` |
| Follow targets | Mouse pointer, keyboard focus, text cursor, Narrator cursor — independently toggleable |
| Navigation | Pan `Ctrl+Alt+arrows`, zoom `Ctrl+Alt+wheel`, toggle 1× vs set zoom `Ctrl+Alt+−`, **peek whole desktop** (hold `Ctrl+Alt+Space`), **viewport locking** `Ctrl+Win+K` |
| Zoom | Settable default level **and increment size** (25/50/100 %). A maximum is not stated on the pages read — treat "1600 %" claims as unverified |
| Rendering | "Smooth edges of images and text" toggle |
| Reading | Modifier+Enter play/pause, modifier+click = read from here, **modifier+H / K = previous / next sentence**, speed slider, voice picker, downloadable Natural/Natural HD voices |

**What it told us:** sentence-level navigation (H/K) is the platform convention for
narrated reading, and viewport locking is the answer to "I need to compare this line
against that field".

---

## 2. macOS Zoom + Hover Text (Apple)

**Confidence: High for Hover Text** (support.apple.com/guide/mac-help/mchl46661917),
**Medium for Zoom** (Apple's MDM accessibility schema; the consumer Zoom page
redirected to a manual index on every fetch, so picture-in-picture and
follow-keyboard-focus are **unverified** in this cycle).

- Hover Text: modifier key activates; **triple-press modifier = activation lock** so
  it stays on. Adjustable text size, font, text colour, window colour, and a
  **highlight colour for the hovered text**. Shows text *and* app icons at high
  resolution.
- Siblings: **Hover Colour** (magnified colour sampling) and **Hover Typing** (an
  editable magnified input box).
- Zoom: keyboard shortcuts, scroll-gesture activation, "smooth images", near/far
  points as min/max zoom.

**What it told us:** the aid should be *locked on* while you read, and a
highlighted-text view beats a merely larger view. Hover Typing is effectively a
reflow box — the same insight that produced the reading strip.

---

## 3. ZoomText / Fusion (Vispero / Freedom Scientific)

**Confidence: High** — vispero.com product pages and freedomscientific.com Fusion
pages. Note: several reseller pages quote "60×/30 levels" from ZoomText 10.1 and are
**stale**; current wording is 36× (60× on some Windows builds).

- **xFont** text smoothing with *smooth / bold / condense* controls — stroke-level
  glyph treatment, not just scaling.
- Smooth mouse and keyboard panning; focus, caret and cursor tracking.
- Custom colour filters, invert/contrast, **focus rectangle, pointer enhancements,
  reading guides**.
- Reader edition: **AppReader** (in-app reading with per-word highlight, configurable
  shape/size/colour/transparency, word/line/sentence/paragraph granularity) and
  **DocReader** (a reflowed reading environment).
- **Definable reading zones** (listed on Papenmeier's Fusion datasheet).

**What it told us:** xFont is the feature that separates a professional low-vision
tool from a magnifier, and it is achievable on a screenshot with an SVG morphology
filter. AppReader's sentence granularity + highlight is the correct shape for
read-aloud.

---

## 4. Chrome Web Store magnifier extensions

**Confidence: Medium** — Google blocks direct fetches of store listing pages, so
install counts and ratings come from chrome-stats.com (an aggregator, ±a few %).

| Extension | Users | Rating | Notes |
|---|---|---|---|
| Zoom for Google Chrome (Stefan vd) | ~300 k | 4.27 (1,758) | v2.8.28, Aug 2026. 1–400 %, per-site memory, text-only zoom. Complaints: **options page won't open**, fails to load at startup/after updates, conflicts with Discord/Brave/Facebook |
| Magnifying Glass | ~30 k Chrome, ~5.4 k Edge | 4.05 (41) | `Alt+Z`, round/square, size, hotkeys. Last updated May 2024 |
| Webpage Magnifier | ~4 k | **2.10** | 83 % one-star: "doesn't work", "will not activate", "clicking Start does nothing" |
| Louper | ~2 k | **2.60** (recent average 1.00) | — |

A "magnifier" search on the store returns mostly **Android apps** with millions of
installs; the real extension niche tops out around 300 k users.

**What it told us — the most important finding of this cycle:** this category is
thin, stale and badly rated. The dominant user complaint is not "missing feature",
it is **"it broke"**. Reliability and verified behaviour are the moat. That is why
v1.3.0 is weighted toward defect fixes and a real test suite rather than toward
feature count.

---

## 5. Google Lens / Circle to Search / Chrome platform

**Confidence: High** — developer.chrome.com, support.google.com.

What an MV3 extension can actually reach:

| API | Status | Relevance |
|---|---|---|
| `chrome.tabs.captureVisibleTab` | Available, **max 2 calls/sec** (`MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND`) | The current engine's ceiling — hence the frozen-frame design |
| Prompt API (Gemini Nano) | **Chrome 138 stable, extensions supported.** 22 GB free disk + >4 GB VRAM (or 16 GB RAM + 4 cores); desktop; en/ja/es/de/fr; **image input, text output only** | A plausible future OCR-free text path |
| Translator + Language Detector API | Desktop Chrome, ~40 languages, on-demand packs. Docs describe top-level windows / same-origin iframes; **extension-context support is not explicitly stated** | Needs a spike before being promised |
| Shape Detection `TextDetector` | **Not viable.** Text detection is still "In Progress" and flag-gated; only `BarcodeDetector` shipped | Rules out a cheap on-device OCR |
| `chrome.offscreen` | Available (DOM_PARSER, BLOBS, WORKERS, CLIPBOARD); one document at a time | The correct home for a WASM OCR engine |

**What it told us:** there is no server-side Lens pipeline available to an
extension, and no usable on-device text detector. Anything advertised as "Lens-like"
in this category is either a server call or a fiction. OCR stays future work.

---

## Cross-cutting conclusions

1. **Reliability is the differentiator.** Every high-rated competitor is rated for
   *working*, not for features.
2. **Narration without navigation is half a feature.** Windows ships H/K; ZoomText
   ships AppReader. v1.2.0 shipped a single `speak()` call.
3. **Stroke-level treatment (xFont) is the real fix for faint print**, not more zoom.
4. **A dimmed band (reading guide) is cheap and disproportionately effective** — and
   this extension had no equivalent.
5. **Reflow beats magnification** when print is genuinely unreadable — Hover Typing,
   DocReader and the reading strip are the same idea.
6. **Locking is a first-class need** — already covered here by pin mode.

## Sources

support.microsoft.com/en-us/accessibility/windows/magnifier/{chapter-2,chapter-3,chapter-5,chapter-6,keyboard-shortcuts-for-magnifier} ·
support.apple.com/guide/mac-help/mchl46661917 ·
developer.apple.com/documentation/devicemanagement/accessibility ·
vispero.com/zoomtext-screen-magnifier-software ·
freedomscientific.com/products/software/fusion ·
chrome-stats.com/d/{lajondecmobodlejlcjllhojikagldgd,ibhegccigccbgpjjmkofhobdnhpinacb,alhghmdmimkaigeelekfacojbhfokdpl} ·
developer.chrome.com/docs/ai/{prompt-api,translator-api} ·
developer.chrome.com/docs/capabilities/shape-detection ·
developer.chrome.com/docs/extensions/reference/api/{tabs,offscreen} ·
support.google.com/chrome/answer/14218244
