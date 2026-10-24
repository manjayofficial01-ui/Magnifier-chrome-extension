# UI/UX audit — v1.3.0

Scope: the lens overlay (toolbar + panels), the popup, and the Photo viewer. The
visual language (dark glass, indigo→violet→cyan, 14 px radii) was already strong and
coherent and was **not** replaced — the problems were structural, not cosmetic.

## Findings

### F1 — The popup had become a 1533 px scroll (P1)
v1.2.0 stacked nine always-expanded cards. Chrome caps popups at 360×600, so more than
half the interface — including every enhancement control — was below the fold on
arrival, with no affordance suggesting it existed.

**Fix** Collapsible `<details>` sections. Zoom stays open (it is the control people
touch constantly); *Lens* and *Reading aids* open by default; *Presets & enhance*
starts collapsed; the shortcut list collapses inside the footer. The enhancement
sliders fold behind a nested *Fine-tune* disclosure inside Reading aids.

**Measured result** 1533 px → **1090 px (−29 %) while gaining 14 controls**
(`test/measure.mjs`).

### F2 — No affordance for which aids were active (P2)
Three independent toggles with no summary meant the only way to know the state was to
read each button.

**Fix** Each section summary carries a live value: `Circle · 240×240` for the lens,
`Guide · Bold · Strip` (or `Off`) for the reading aids, the preset name for enhance.

### F3 — The toolbar had no room to grow (P1)
Ten buttons was already close to the practical limit; the reading aids needed three
more. On a 430 px viewport the row ran off both edges and clipped.

**Fix** A compact media query (26 px buttons, no separators, shorter zoom label) keeps
the row on one line down to ~430 px; `max-content` + `max-width` + `flex-wrap` wraps it
cleanly below that instead of clipping. `border-radius: 22px` reads as a pill on one
row and as a rounded rect when wrapped.

**Verification** `browser.test.mjs` asserts the toolbar spans inside 420 px (one row,
≤46 px tall) and inside 300 px (wrapped).

### F4 — The reading strip had nowhere to live (P1)
A bottom panel collides with a bottom-centred toolbar and a bottom-anchored colour
readout.

**Fix** When the strip opens, the toolbar moves to the top edge and the colour readout
offsets above the measured strip height. The strip itself is capped at
`min(46vh, 420px)` with its own scroll, so it never eats the page.

### F5 — Read-aloud gave no feedback (P1)
v1.2.0 fired a single `speechSynthesis.speak()` and showed "Reading aloud…". No
indication of position, no way to pause, no way to repeat a sentence.

**Fix** The spoken sentence is highlighted in the strip (`scrollIntoView` block
`nearest`), the banner reports `Reading 3 of 12 · <text>`, the toolbar speaker button
shows an active state, and the strip bar carries Read / ◀ / ▶ / Copy.

### F6 — Two controls were invisible-but-present (P2)
*Reset this site* rendered with per-site memory off; the viewer's zoom bar floated over
the empty state. Both were `[hidden]` failures (see TECHNICAL_AUDIT). Fixed.

### F7 — Accessibility gaps (P2)
| Item | Status |
|---|---|
| WCAG 2.4.7 focus visible | Already handled (`:focus-visible` on every `all: unset` control). **Extended** to `<summary>`, the strip buttons and the strip body. |
| WCAG 4.1.2 name/role/value | Toolbar is `role="toolbar"` + `aria-label`; every icon button has `aria-label`; the strip is `role="region"` + `aria-label`; segmented controls are `role="group"`. New buttons follow the same pattern. |
| WCAG 2.4.11 Focus not obscured | The `follow: focus` mode already steps the lens aside; the toolbar now also yields the bottom edge to the strip. |
| WCAG 2.5.8 Target size | 30 px (26 px in the compact query) — above the 24 px minimum. |
| WCAG 2.3.3 Animation | `prefers-reduced-motion` honoured in both the shadow root and the shared theme. |
| Live status | Banner is `role="status"`; the popup status line is `role="status"`. |
| Canvas content | The lens canvas is decorative — all information is in the page itself, the strip, or the banner. |

### F8 — Colour contrast of the new surfaces
The strip is user-themed, so contrast is guaranteed by construction. Measured with the
extension's own `LuminaContrast()` (WCAG 2.x relative luminance):

| Theme | Background | Foreground | Ratio |
|---|---|---|---|
| Paper | `#fffdf7` | `#201a10` | **17.0:1** |
| Night | `#10131c` | `#eef1fa` | **16.4:1** |
| Amber | `#fff8c5` | `#2a2410` | **14.3:1** |
| High contrast | `#ffffff` | `#000000` | **21.0:1** |

All four clear AAA (7:1) for body text at the default 22 px. The active-sentence
highlight (`rgba(250,204,21,0.42)`) is deliberately a wash rather than a colour change,
so the text keeps its own contrast ratio.

## What was not changed, and why

- **The dark glass identity.** It is distinctive, consistent, and appropriate for an
  overlay that sits on top of arbitrary pages.
- **The popup's 360 px width.** It matches the manifest and the platform norm; widening
  it would only make the page underneath harder to see.
- **The lens chrome** (accent gradient rim, drop shadow, vignette). Unchanged; it reads
  as a lens rather than a rectangle, which is doing real work.
- **No light theme.** An overlay competing with a bright page needs to be dark to stay
  legible; the reading strip offers Paper/Amber for people who need light text
  surfaces, which is the actual requirement.
