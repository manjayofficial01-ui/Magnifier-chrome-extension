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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
