/* Layout benchmark: measures the popup at both the shipped v1.2.0 snapshot and the
 * current build, so a redesign can be judged on real numbers rather than impressions.
 *
 * Run: node test/measure.mjs
 *
 * The popup is the only surface with a hard external constraint (Chrome caps popups at
 * 360x600), so this is the one place where a height regression is worth tracking.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, shutdown, openPage, waitFor, sleep } from './cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const TARGETS = [
  ['v1.2.0 (snapshot)', join(root, 'docs', 'modernization', 'snapshots', 'v1.2.0', 'src', 'popup', 'popup.html')],
  ['v1.3.0 (current)', join(root, 'src', 'popup', 'popup.html')]
];

const session = await launch();
if (!session) {
  console.log('No Chrome/Edge binary found — measurement skipped.');
  process.exit(0);
}

const { page, browser, targetId } = await openPage(session, 'about:blank');
const rows = [];

for (const [name, file] of TARGETS) {
  await page.send('Page.navigate', { url: pathToFileURL(file).href });
  const ready = await waitFor(() => page.eval('!!document.querySelector("#zoom")').catch(() => false), 12000);
  if (!ready) { console.log(name + ': did not load'); continue; }
  await sleep(420);
  const m = await page.eval(`({
    w: document.body.scrollWidth,
    h: document.body.scrollHeight,
    controls: document.querySelectorAll('input, button, [role="group"]').length,
    cards: document.querySelectorAll('.card, details.sec').length
  })`);
  rows.push({ name, ...m });
}

await browser.send('Target.closeTarget', { targetId }).catch(() => {});
page.close();
browser.close();
await shutdown(session);

console.log('\nPopup layout');
console.log('  ' + 'build'.padEnd(20) + 'width  height  controls  groups');
for (const r of rows) {
  console.log('  ' + r.name.padEnd(20) + String(r.w).padEnd(7) + String(r.h).padEnd(8) + String(r.controls).padEnd(10) + r.cards);
}

if (rows.length === 2) {
  const [before, after] = rows;
  const dh = after.h - before.h;
  console.log('\n  height change: ' + (dh > 0 ? '+' : '') + dh + 'px (' +
    (dh >= 0 ? '+' : '') + Math.round((dh / before.h) * 100) + '%) for ' +
    (after.controls - before.controls) + ' more controls');
  console.log('  Chrome popup cap: 600px — both builds scroll, which is expected.');
}

process.exit(0);
