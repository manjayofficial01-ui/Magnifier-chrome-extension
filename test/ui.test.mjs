/* Headless verification for the extension's own pages (popup + Photo viewer).
 *
 * These pages run without `chrome.*` here, which is exactly the "preview mode" path
 * their code already supports — so this checks layout, wiring and the two display
 * bugs that were fixed (a [hidden] button that stayed visible, a zoom bar that
 * floated over the empty state).
 *
 * Run: node test/ui.test.mjs [--headed] [--shots]
 */

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import {
  launch, shutdown, openPage, waitFor, sleep, ok, eq, report, skipped
} from './cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const POPUP = pathToFileURL(join(here, '..', 'src', 'popup', 'popup.html')).href;
const VIEWER = pathToFileURL(join(here, '..', 'src', 'viewer', 'viewer.html')).href;

const argv = process.argv.slice(2);
const HEADED = argv.includes('--headed');
const KEEP = argv.includes('--keep');
const SHOTS = argv.includes('--shots');

const visible = (sel) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return 'missing';
  const cs = getComputedStyle(el);
  return (cs.display !== 'none' && cs.visibility !== 'hidden' && el.offsetParent !== null) ? 'visible' : 'hidden';
})()`;

async function goto(page, url, readyExpr) {
  await page.send('Page.navigate', { url });
  const okReady = await waitFor(() => page.eval(readyExpr).catch(() => false), 12000);
  await sleep(180);
  return !!okReady;
}

async function shoot(page, name) {
  await sleep(240);
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(here, 'shot-' + name + '.png'), Buffer.from(data, 'base64'));
  console.log('  \u2192 test/shot-' + name + '.png');
}

/* ---------------- popup ---------------- */

async function popupSuite(page) {
  console.log('\nPopup (control center)');

  const loaded = await goto(page, POPUP, '!!document.querySelector("#power") && !!window.LuminaDefaults');
  ok('popup boots', loaded);

  const status = await page.eval('document.querySelector("#statusTxt").textContent');
  eq('preview mode is detected without chrome.*', status, 'Preview mode');

  /* Default layout — measured before anything is expanded, because that is what a
     user actually opens. Chrome caps popups at 360x600. */
  const size = await page.eval('({ w: document.body.scrollWidth, h: document.body.scrollHeight })');
  eq('popup width matches the manifest popup width', size.w, 360);
  ok('popup has no horizontal overflow', size.w <= 360, 'scrollWidth = ' + size.w);
  ok('default popup is shorter than the v1.2.0 baseline (1533px)', size.h < 1533, 'height = ' + size.h);

  await page.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 600, deviceScaleFactor: 1, mobile: false });
  await sleep(220);
  const atCap = await page.eval(`(() => {
    const r = document.querySelector('#zoom').getBoundingClientRect();
    const p = document.querySelector('#power').getBoundingClientRect();
    return { zoomTop: Math.round(r.top), powerTop: Math.round(p.top), overflowX: document.body.scrollWidth };
  })()`);
  ok('zoom control is visible without scrolling in a 600px popup', atCap.zoomTop < 600, JSON.stringify(atCap));
  ok('power switch is at the top', atCap.powerTop < 60, 'top = ' + atCap.powerTop);
  eq('no horizontal overflow at the popup cap', atCap.overflowX, 360);
  await page.send('Emulation.clearDeviceMetricsOverride');
  await sleep(150);

  /* The bug: `.site-reset { display: block }` beat the UA sheet's [hidden] rule, so the
     "Reset this site" button showed even with per-site memory off. */
  eq('"Reset this site" is hidden when per-site is off', await page.eval(visible('#resetSite')), 'hidden');

  await page.eval('(() => { const c = document.querySelector("#perSite"); c.checked = true; c.dispatchEvent(new Event("change", {bubbles:true})); return true; })()');
  await sleep(120);
  eq('"Reset this site" appears when per-site is on', await page.eval(visible('#resetSite')), 'visible');
  eq('summary reflects per-site being on', await page.eval('document.querySelector("#perSite").checked'), true);

  /* Reading-aid toggles. */
  eq('reading aids start off', await page.eval('document.querySelector("#aidSum").textContent'), 'Off');
  await page.eval('document.querySelector("#guide").click()');
  await sleep(80);
  ok('guide toggle turns on', await page.eval('document.querySelector("#guide").classList.contains("on")'));
  eq('guide is named in the summary', await page.eval('document.querySelector("#aidSum").textContent'), 'Guide');

  await page.eval('document.querySelector("#readingStrip").click()');
  await sleep(80);
  eq('summary lists both aids', await page.eval('document.querySelector("#aidSum").textContent'), 'Guide · Strip');

  await page.eval('document.querySelector("#textBoostOn").click()');
  await sleep(80);
  eq('bold button sets a working text weight', await page.eval('+document.querySelector("#textBoost").value'), 55);
  eq('bold is named in the summary', await page.eval('document.querySelector("#aidSum").textContent'), 'Guide · Bold · Strip');
  await page.eval('document.querySelector("#textBoostOn").click()');
  await sleep(80);
  eq('bold button turns back off', await page.eval('+document.querySelector("#textBoost").value'), 0);

  /* Slider -> label plumbing for the new numeric controls. */
  await page.eval(`(() => {
    const r = document.querySelector('#readRate');
    r.value = '1.5'; r.dispatchEvent(new Event('input', {bubbles:true}));
    return true;
  })()`);
  await sleep(80);
  eq('read-rate label formats a fractional rate', await page.eval('document.querySelector("#readRateVal").textContent'), '1.5×');
  await page.eval(`(() => {
    const r = document.querySelector('#readRate');
    r.value = '2'; r.dispatchEvent(new Event('input', {bubbles:true}));
    return true;
  })()`);
  await sleep(80);
  eq('read-rate label drops a trailing .0', await page.eval('document.querySelector("#readRateVal").textContent'), '2×');

  /* Strip theme segmented control. */
  await page.eval('document.querySelector(\'#stripThemeSeg [data-theme="night"]\').click()');
  await sleep(80);
  eq('strip theme selection moves',
    await page.eval('document.querySelector("#stripThemeSeg .on").dataset.theme'), 'night');

  /* Lens summary + shape switch. */
  await page.eval('document.querySelector(\'#shapes [data-shape="rectangle"]\').click()');
  await sleep(80);
  ok('lens summary tracks the shape',
    /Rectangle/.test(await page.eval('document.querySelector("#lensSum").textContent')),
    await page.eval('document.querySelector("#lensSum").textContent'));

  /* Preset chips still drive the derived preset label. */
  await page.eval('document.querySelector(\'#presets [data-preset="invert"]\').click()');
  await sleep(80);
  eq('preset label follows the chip', await page.eval('document.querySelector("#presetVal").textContent'), 'Inverted');
  eq('preset chip is marked active',
    await page.eval('document.querySelector("#presets .chip.on").dataset.preset'), 'invert');

  /* Collapsible sections: the popup is height-capped by Chrome, so this matters. */
  const sections = await page.eval(`(() => {
    const all = [...document.querySelectorAll('details.sec')];
    return { count: all.length, open: all.filter((d) => d.open).length };
  })()`);
  ok('popup uses collapsible sections', sections.count >= 4, JSON.stringify(sections));
  ok('some sections start collapsed', sections.open < sections.count, JSON.stringify(sections));

  await page.eval(`(() => {
    const d = [...document.querySelectorAll('details.sec')].find((x) => !x.open);
    d.querySelector('summary').click();
    return d.open;
  })()`);
  await sleep(80);
  ok('a collapsed section opens on click', await page.eval(
    '[...document.querySelectorAll("details.sec")].filter((d) => d.open).length > 0'));

  /* Power switch in preview mode. */
  await page.eval('(() => { const p = document.querySelector("#power"); p.checked = true; p.dispatchEvent(new Event("change", {bubbles:true})); return true; })()');
  await sleep(120);
  eq('power switch reports active', await page.eval('document.querySelector("#statusTxt").textContent'), 'Active on this tab');

  if (SHOTS) await shoot(page, 'popup');
}

/* ---------------- viewer ---------------- */

async function viewerSuite(page) {
  console.log('\nPhoto viewer');

  const loaded = await goto(page, VIEWER, '!!document.querySelector("#zoombar") && !!window.LuminaDefaults');
  ok('viewer boots', loaded);

  /* The bug: `.zoombar { display: flex }` beat `[hidden]`, so the zoom bar floated over
     the empty state with no image loaded. */
  eq('zoom bar is hidden on the empty state', await page.eval(visible('#zoombar')), 'hidden');
  eq('empty state is shown', await page.eval(visible('#empty')), 'visible');

  /* Feed it a wide test image through the URL box, the same path a user takes. */
  const dataUrl = await page.eval(`(() => {
    const c = document.createElement('canvas');
    c.width = 2000; c.height = 600;
    const x = c.getContext('2d');
    x.fillStyle = '#fffdf7'; x.fillRect(0, 0, 2000, 600);
    x.fillStyle = '#1a2033'; x.font = '700 46px Arial';
    x.fillText('PHOTO MAGNIFIER TEST', 80, 170);
    x.font = '18px Arial';
    x.fillStyle = '#454e66';
    x.fillText('Fine print: batch LM-250-XQN7 — store below 25 C — keep out of reach', 80, 240);
    return c.toDataURL('image/png');
  })()`);
  await page.eval(`(() => {
    document.querySelector('#url').value = ${JSON.stringify(dataUrl)};
    document.querySelector('#loadUrl').click();
    return true;
  })()`);
  const shown = await waitFor(() => page.eval('document.querySelector("#zoombar").hidden === false'), 8000);
  ok('image loads from the URL box', !!shown);
  await sleep(160);
  eq('zoom bar appears once an image is loaded', await page.eval(visible('#zoombar')), 'visible');
  eq('empty state is dismissed', await page.eval(visible('#empty')), 'hidden');

  const fitPct = await page.eval('document.querySelector("#zPct").textContent');
  ok('fit scaled the wide image down', parseInt(fitPct, 10) < 100, 'fit = ' + fitPct);

  /* Zoom label plumbing. */
  await page.eval('document.querySelector("#zIn").click()');
  await sleep(100);
  const zoomed = await page.eval('document.querySelector("#zPct").textContent');
  ok('zoom-in updates the label', parseInt(zoomed, 10) > parseInt(fitPct, 10), fitPct + ' -> ' + zoomed);

  /* Rotation: a 2000x600 landscape becomes portrait, so fit() must shrink further. */
  const before = parseInt(await page.eval('document.querySelector("#zPct").textContent'), 10);
  await page.eval('document.querySelector("#zRotate").click()');
  await sleep(140);
  const after = parseInt(await page.eval('document.querySelector("#zPct").textContent'), 10);
  ok('rotate refits for portrait', after < before, before + '% -> ' + after + '%');

  const dims = await page.eval(`(() => {
    const c = document.querySelector('#vcanvas');
    return { w: c.width, h: c.height };
  })()`);
  ok('canvas still sized after rotation', dims.w > 0 && dims.h > 0, JSON.stringify(dims));

  /* Bold text uses the shared morphology filter, mounted in the page tree. */
  eq('boost filter exists in the viewer', await page.eval('!!document.querySelector("#lumina-boost feMorphology")'), true);
  eq('boost radius is 0 by default',
    await page.eval('document.querySelector("#lumina-boost feMorphology").getAttribute("radius")'), '0');
  await page.eval('document.querySelector("#vBold").click()');
  await sleep(120);
  ok('bold raises the morphology radius',
    parseFloat(await page.eval('document.querySelector("#lumina-boost feMorphology").getAttribute("radius")')) > 0.4);
  ok('bold button shows its state', await page.eval('document.querySelector("#vBold").classList.contains("on")'));

  /* Reset clears it again. */
  await page.eval('document.querySelector("#vReset").click()');
  await sleep(120);
  eq('reset clears the boost radius',
    await page.eval('document.querySelector("#lumina-boost feMorphology").getAttribute("radius")'), '0');
  eq('reset clears the bold state', await page.eval('document.querySelector("#vBold").classList.contains("on")'), false);

  /* Sharpen still appends its kernel correctly (regression guard on the filter chain). */
  await page.eval(`(() => {
    const r = document.querySelector('#vSharpen');
    r.value = '60'; r.dispatchEvent(new Event('input', {bubbles:true}));
    return true;
  })()`);
  await sleep(120);
  ok('sharpen kernel updates',
    (await page.eval('document.querySelector("#lumina-sharpen feConvolveMatrix").getAttribute("kernelMatrix")')) !== '0 -0 0 -0 1 -0 0 -0 0',
    'kernel = ' + await page.eval('document.querySelector("#lumina-sharpen feConvolveMatrix").getAttribute("kernelMatrix")'));

  if (SHOTS) await shoot(page, 'viewer');
}

/* ---------------- runner ---------------- */

let session = null;
let page = null;
let browser = null;

try {
  console.log('Launching headless Chrome…');
  session = await launch({ headed: HEADED });
  if (!session) {
    console.log('\nNo Chrome/Edge binary found — UI verification SKIPPED.');
    skipped('ui suite', 'no Chromium binary on this machine');
  } else {
    const opened = await openPage(session, 'about:blank');
    page = opened.page;
    browser = opened.browser;

    await popupSuite(page);
    await viewerSuite(page);

    const errs = opened.errors;
    ok('no uncaught page errors across both pages', errs.length === 0, errs.slice(0, 4).join(' | '));

    await browser.send('Target.closeTarget', { targetId: opened.targetId }).catch(() => {});
  }
} catch (e) {
  ok('harness completes', false, e.message);
} finally {
  if (page) page.close();
  if (browser) browser.close();
  await shutdown(session, { keep: KEEP });
}

process.exit(report() ? 1 : 0);
