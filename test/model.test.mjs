/* Headless checks for the shared settings model (src/shared/defaults.js).
   Run: node test/model.test.mjs
   No DOM needed — defaults.js only touches `window`. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'src', 'shared', 'defaults.js'), 'utf8');

const window = {};
const document = { createElementNS: () => ({ setAttribute() {}, appendChild() {}, style: {} }) };
new Function('window', 'document', src)(window, document);

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
};
const eq = (name, a, b) => ok(name + ' (' + JSON.stringify(a) + ' === ' + JSON.stringify(b) + ')', a === b);

/* ---- clamping / coercion ---- */
eq('garbage zoom falls back', window.LuminaNormalize({ zoom: 'abc' }).zoom, 200);
eq('zoom below min clamps', window.LuminaNormalize({ zoom: 1 }).zoom, 100);
eq('zoom above max clamps', window.LuminaNormalize({ zoom: 99999 }).zoom, 1000);
eq('bad shape falls back', window.LuminaNormalize({ shape: 'triangle' }).shape, 'circle');
eq('bad dock falls back', window.LuminaNormalize({ dock: 'side' }).dock, 'off');
eq('bad follow falls back', window.LuminaNormalize({ follow: 'vibes' }).follow, 'pointer');
eq('negative lensHeight means auto', window.LuminaNormalize({ lensHeight: -5 }).lensHeight, 0);
eq('NaN lensHeight means auto', window.LuminaNormalize({ lensHeight: 'x' }).lensHeight, 0);
eq('lensHeight below min clamps', window.LuminaNormalize({ lensHeight: 5 }).lensHeight, 40);
eq('booleans coerced', window.LuminaNormalize({ invert: 'yes' }).invert, true);
eq('hue clamps negative', window.LuminaNormalize({ hue: -400 }).hue, -180);
eq('hue clamps positive', window.LuminaNormalize({ hue: 400 }).hue, 180);

/* ---- custom lens size ---- */
const d = window.LuminaLensDims;
const sq = d(window.LuminaNormalize({ lensSize: 300 }));
eq('square lens stays square', sq.w + 'x' + sq.h, '300x300');
const rect = d(window.LuminaNormalize({ lensSize: 320, shape: 'rectangle' }));
eq('wide lens keeps 1.6:1', rect.w + 'x' + rect.h, '512x320');
const custom = d(window.LuminaNormalize({ lensSize: 500, lensHeight: 120 }));
eq('custom height overrides', custom.w + 'x' + custom.h, '500x120');
const customRect = d(window.LuminaNormalize({ lensSize: 600, lensHeight: 90, shape: 'rectangle' }));
eq('custom height overrides rectangle', customRect.w + 'x' + customRect.h, '960x90');

/* ---- presets ---- */
eq('preset match: default', window.LuminaMatchPreset(window.LuminaNormalize({})), 'none');
eq('preset match: night', window.LuminaMatchPreset(window.LuminaNormalize({ brightness: 82, contrast: 104, saturation: 70, sepia: 55, hue: -14 })), 'night');
eq('preset match: custom', window.LuminaMatchPreset(window.LuminaNormalize({ brightness: 91 })), 'custom');
const applied = window.LuminaApplyPreset(window.LuminaNormalize({ zoom: 350, shape: 'rounded', lensSize: 480 }), 'night');
eq('applyPreset keeps zoom', applied.zoom, 350);
eq('applyPreset keeps shape', applied.shape, 'rounded');
eq('applyPreset keeps size', applied.lensSize, 480);
eq('applyPreset sets colours', applied.sepia, 55);
eq('applyPreset clears crosshair? no', applied.crosshair, false);

/* ---- filter string ---- */
const f = window.LuminaFilterString(window.LuminaNormalize({ sepia: 40, hue: 20, invert: true }));
ok('filter includes sepia', f.includes('sepia(40%)'), f);
ok('filter includes hue', f.includes('hue-rotate(20deg)'), f);
ok('filter includes invert', f.includes('invert(1)'), f);
ok('filter omits zero sepia', !window.LuminaFilterString(window.LuminaNormalize({})).includes('sepia'), f);
ok('sharpen kernel sums to 1', (() => {
  const k = window.LuminaSharpenKernel(100).split(' ').map(Number);
  return Math.abs(k.reduce((a, b) => a + b, 0) - 1) < 1e-6;
})());

/* ---- WCAG maths ---- */
const w = window.LuminaContrast([255, 255, 255], [0, 0, 0]);
ok('white/black ratio is 21', Math.abs(w - 21) < 0.01, w);
const mid = window.LuminaContrast([119, 119, 119], [255, 255, 255]);
ok('mid grey vs white ~4.5', mid > 4.4 && mid < 4.6, mid);
eq('hex formatting', window.LuminaHex(255, 0, 10), '#ff000a');
eq('AAA verdict on black/white', window.LuminaContrastVerdict(21).aaa, true);
eq('no verdict on low ratio', window.LuminaContrastVerdict(1.4).aaLarge, false);

/* ---- site override keys ---- */
ok('site keys exclude perSite', !window.LuminaSiteKeys.includes('perSite'));
ok('site keys cover the visible controls',
  ['zoom', 'shape', 'lensSize', 'lensHeight', 'dock', 'follow', 'pixelPerfect'].every((k) => window.LuminaSiteKeys.includes(k)));

/* ---- v1.3.0: reading-aid settings ---- */
const nd = window.LuminaNormalize({});
eq('guide is off by default', nd.guide, false);
eq('reading strip is off by default', nd.readingStrip, false);
eq('text boost is off by default', nd.textBoost, 0);
eq('guide band has a sane default', nd.guideHeight, 130);
eq('strip text size has a sane default', nd.stripSize, 22);
eq('read rate has a sane default', nd.readRate, 1);

eq('guideHeight clamps low', window.LuminaNormalize({ guideHeight: 1 }).guideHeight, 48);
eq('guideHeight clamps high', window.LuminaNormalize({ guideHeight: 9999 }).guideHeight, 600);
eq('guideDim clamps high', window.LuminaNormalize({ guideDim: 400 }).guideDim, 90);
eq('guideDim allows full transparency', window.LuminaNormalize({ guideDim: -20 }).guideDim, 0);
eq('textBoost clamps', window.LuminaNormalize({ textBoost: 500 }).textBoost, 100);
eq('stripSize clamps low', window.LuminaNormalize({ stripSize: 2 }).stripSize, 14);
eq('stripLine clamps and rounds', window.LuminaNormalize({ stripLine: 9 }).stripLine, 2.6);
eq('stripLine keeps two decimals', window.LuminaNormalize({ stripLine: 1.555 }).stripLine, 1.56);
eq('readRate clamps low', window.LuminaNormalize({ readRate: 0.1 }).readRate, 0.5);
eq('readRate clamps high', window.LuminaNormalize({ readRate: 9 }).readRate, 2);
eq('bad stripTheme falls back to auto', window.LuminaNormalize({ stripTheme: 'chartreuse' }).stripTheme, 'auto');
eq('auto is a valid stripTheme', window.LuminaNormalize({ stripTheme: 'auto' }).stripTheme, 'auto');
eq('named stripTheme is kept', window.LuminaNormalize({ stripTheme: 'yellow' }).stripTheme, 'yellow');
eq('colour subset carries textBoost', window.LuminaNormalizeColour({ textBoost: 40 }).textBoost, 40);

/* ---- v1.3.0: strip themes ---- */
eq('auto theme resolves to paper', window.LuminaStripTheme('auto', false).id, 'paper');
eq('auto theme follows invert', window.LuminaStripTheme('auto', true).id, 'night');
eq('explicit theme wins over invert', window.LuminaStripTheme('yellow', true).id, 'yellow');
eq('unknown theme falls back to paper', window.LuminaStripTheme('nope', false).id, 'paper');
ok('every theme has a foreground and background', window.LuminaStripThemes.every((t) => t.bg && t.fg && t.rule));
/* Every strip theme must clear WCAG AAA for body text, or the reading aid is the
   problem rather than the cure. */
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
for (const t of window.LuminaStripThemes) {
  const ratio = window.LuminaContrast(hexRgb(t.bg), hexRgb(t.fg));
  ok('strip theme "' + t.id + '" clears AAA (>=7:1)', ratio >= 7, ratio.toFixed(1) + ':1');
}

/* ---- v1.3.0: sentence splitting ---- */
const S = window.LuminaSentences;
eq('splits plain prose', S('One. Two. Three.').length, 3);
eq('keeps the terminator', S('One. Two.')[0], 'One.');
eq('splits CJK without spaces', S('饭后服用。Store below 25C.').length, 2);
eq('handles a mix of scripts', S('Drink 2 tablets. 每日两次。Done!').length, 3);
eq('empty text yields no sentences', S('').length, 0);
eq('null yields no sentences', S(null).length, 0);
eq('whitespace yields no sentences', S('   \n\t ').length, 0);
ok('a long run of text is broken into navigable pieces', S('word '.repeat(200)).length >= 3);
ok('every piece is non-empty', S('word '.repeat(200)).every((s) => s.length > 0));
ok('no piece exceeds the hard wrap', S('word '.repeat(200)).every((s) => s.length <= 241));
eq('does not split inside a decimal', S('Take 2.5 mg daily.').length, 1);
eq('ellipsis ends a sentence', S('Wait… then go. Fine.').length, 3);

/* ---- v1.3.0: text-weight morphology ---- */
eq('zero boost is zero radius', window.LuminaBoostRadius(0), 0);
eq('negative boost is zero radius', window.LuminaBoostRadius(-10), 0);
eq('boost radius grows with the setting', window.LuminaBoostRadius(100) > window.LuminaBoostRadius(40), true);
ok('boost radius stays under a pixel', window.LuminaBoostRadius(100) < 1, window.LuminaBoostRadius(100));
eq('boost radius is capped at 100', window.LuminaBoostRadius(999), window.LuminaBoostRadius(100));

/* ---- v1.3.0: filter chain order ---- */
const plainFilter = window.LuminaFilterString(window.LuminaNormalize({}));
ok('the plain filter string never names an SVG filter', !plainFilter.includes('url('), plainFilter);
const boostFilter = window.LuminaFilterString(window.LuminaNormalize({ invert: true }), { boost: true });
ok('boost is inserted as an SVG reference', boostFilter.includes('url(#lumina-boost)'), boostFilter);
ok('boost runs BEFORE invert so it thickens the page\u2019s own polarity',
  boostFilter.indexOf('url(#lumina-boost)') < boostFilter.indexOf('invert(1)'), boostFilter);
ok('boost runs after the level adjustments',
  boostFilter.indexOf('saturate(') < boostFilter.indexOf('url(#lumina-boost)'), boostFilter);

/* ---- v1.3.0: presets leave the reading aids alone ---- */
const presetKeeps = window.LuminaApplyPreset(
  window.LuminaNormalize({ guide: true, guideHeight: 200, readingStrip: true, stripSize: 30, readRate: 1.5, textBoost: 40 }),
  'night'
);
eq('preset keeps the guide switch', presetKeeps.guide, true);
eq('preset keeps the guide band', presetKeeps.guideHeight, 200);
eq('preset keeps the strip switch', presetKeeps.readingStrip, true);
eq('preset keeps the strip size', presetKeeps.stripSize, 30);
eq('preset keeps the read rate', presetKeeps.readRate, 1.5);
eq('preset keeps the text weight', presetKeeps.textBoost, 40);

/* ---- v1.3.0: site keys cover the new controls ---- */
ok('site keys cover the reading aids',
  ['guide', 'guideHeight', 'guideDim', 'textBoost', 'readingStrip', 'stripSize', 'stripLine', 'stripTheme', 'readRate']
    .every((k) => window.LuminaSiteKeys.includes(k)));
ok('site keys still exclude perSite', !window.LuminaSiteKeys.includes('perSite'));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
