/* Headless browser verification for the lens engine.
 *
 * Drives a real Chrome over the DevTools Protocol (no npm dependencies — Node 22
 * ships a global WebSocket) and asserts against test/harness.html, which runs the
 * actual content script with chrome.* stubbed.
 *
 * Run: node test/browser.test.mjs
 *      node test/browser.test.mjs --headed --keep   (watch it, keep the profile)
 */

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  launch, shutdown, openPage, waitFor, sleep,
  ok, eq, near, skipped, report
} from './cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const HARNESS = pathToFileURL(join(here, 'harness.html')).href;

const argv = process.argv.slice(2);
const HEADED = argv.includes('--headed');
const KEEP = argv.includes('--keep');
const SHOTS = argv.includes('--shots');

/* ---------------- page-side helpers ---------------- */

const SNAP = 'window.__luminaMagnifier.snapshot';
const READY = 'window.__harnessReady === true';

async function ready(page, url) {
  await page.send('Page.navigate', { url });
  const okReady = await waitFor(() => page.eval(READY).catch(() => false), 15000);
  if (!okReady) throw new Error('harness never became ready: ' + url);
  // Wait for the initial capture + first paint to settle.
  await waitFor(() => page.eval(`${SNAP}.frame === true`).catch(() => false), 8000);
  await sleep(120);
  return okReady;
}

/* Count non-transparent pixels in the lens canvas (shadow root is open). */
const CANVAS_INK = `(() => {
  const c = document.querySelector('.lumina-host').shadowRoot.querySelector('canvas.lens');
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
  return n;
})()`;

/* Average alpha + luminance over a canvas region, for the guide test. */
const regionStats = (x0, x1, y0, y1) => `(() => {
  const c = document.querySelector('.lumina-host').shadowRoot.querySelector('canvas.lens');
  const g = c.getContext('2d');
  const dpr = devicePixelRatio || 1;
  const x = Math.round(${x0} * dpr), w = Math.max(1, Math.round((${x1} - ${x0}) * dpr));
  const y = Math.round(${y0} * dpr), h = Math.max(1, Math.round((${y1} - ${y0}) * dpr));
  const d = g.getImageData(x, y, w, h).data;
  let aSum = 0, lSum = 0, lN = 0;
  for (let i = 0; i < d.length; i += 4) {
    aSum += d[i + 3];
    if (d[i + 3] > 8) { lSum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; lN++; }
  }
  const px = d.length / 4;
  return { alpha: aSum / px, luma: lN ? lSum / lN : -1 };
})()`;

/* ---------------- the suite ---------------- */

async function suite(page, session) {
  console.log('\nLens engine (headless Chrome)');

  /* ---- 1. boot + capture ---- */
  await ready(page, HARNESS + '?shape=circle&zoom=300&x=893&y=378');
  const vp = await page.eval('({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio || 1 })');
  const s0 = await page.eval(SNAP);
  ok('lens starts', s0.active === true);
  ok('frame captured', s0.frame === true);
  eq('canvas sized to the viewport', s0.canvas.w, Math.round(vp.w * vp.dpr));
  eq('canvas height matches the viewport', s0.canvas.h, Math.round(vp.h * vp.dpr));
  const ink = await page.eval(CANVAS_INK);
  ok('lens actually paints pixels', ink > 5000, 'non-transparent px = ' + ink);

  /* ---- 2. on-demand rendering (perf fix) ---- */
  await page.eval('window.__luminaMagnifier.renderNow()');
  const d0 = (await page.eval(SNAP)).draws;
  await sleep(700);                       // no pointer movement, no scroll, no settings change
  const d1 = (await page.eval(SNAP)).draws;
  eq('idle page does not repaint', d1, d0);
  await page.eval('window.__luminaMagnifier.setPointer(700, 400)');
  await sleep(120);
  const d2 = (await page.eval(SNAP)).draws;
  ok('pointer movement repaints', d2 > d1, d1 + ' -> ' + d2);

  /* ---- 3. lens geometry + zoom ---- */
  const s1 = await page.eval(SNAP);
  near('lens centres on the pointer', s1.lens.x, 700, 2);
  near('lens centres on the pointer (y)', s1.lens.y, 400, 2);
  await page.eval('window.__luminaMagnifier.applySettings({zoom: 500})');
  const s2 = await page.eval(SNAP);
  eq('zoom setting applied', s2.settings.zoom, 500);

  /* ---- 4. reading guide dims outside the band only ----
     Sampled at x 0..60 so the lens (centred on the pointer) never covers the probe. */
  await page.eval('window.__luminaMagnifier.applySettings({guide: false})');
  await page.eval('window.__luminaMagnifier.setPointer(893, 450)');
  await page.eval('window.__luminaMagnifier.renderNow()');
  const topOff = await page.eval(regionStats(0, 60, 4, 24));
  const bandOff = await page.eval(regionStats(0, 60, 444, 456));
  await page.eval('window.__luminaMagnifier.applySettings({guide: true, guideHeight: 130, guideDim: 70})');
  await page.eval('window.__luminaMagnifier.renderNow()');
  const topOn = await page.eval(regionStats(0, 60, 4, 24));
  const bandOn = await page.eval(regionStats(0, 60, 444, 456));

  ok('nothing is painted outside the lens when the guide is off', topOff.alpha < 4,
    'alpha = ' + topOff.alpha.toFixed(1));
  ok('guide dims the page outside the band', topOn.alpha > 140 && topOn.luma < 70,
    'alpha = ' + topOn.alpha.toFixed(1) + ', luma = ' + Math.round(topOn.luma));
  ok('guide leaves the band clear', bandOn.alpha < 20,
    'band alpha = ' + bandOn.alpha.toFixed(1) + ' vs page alpha = ' + topOn.alpha.toFixed(1));
  ok('guide band moved with the pointer', bandOff.alpha < 4);

  /* ---- 5. text weight (xFont-style morphology) ---- */
  const filterOff = await page.eval(`(() => {
    const r = document.querySelector('.lumina-host').shadowRoot;
    return { has: !!r.querySelector('#lumina-boost'), radius: r.querySelector('#lumina-boost feMorphology').getAttribute('radius') };
  })()`);
  ok('boost filter element exists', filterOff.has === true);
  eq('boost radius is 0 when off', filterOff.radius, '0');
  await page.eval('window.__luminaMagnifier.applySettings({textBoost: 80})');
  await page.eval('window.__luminaMagnifier.renderNow()');
  const radius = await page.eval(`document.querySelector('.lumina-host').shadowRoot
    .querySelector('#lumina-boost feMorphology').getAttribute('radius')`);
  ok('boost radius follows the setting', parseFloat(radius) > 0.4, 'radius = ' + radius);

  /* ---- 6. reading strip ---- */
  await page.eval('window.__luminaMagnifier.applySettings({textBoost: 0, guide: false, readingStrip: false})');
  await page.eval('window.__luminaMagnifier.setPointer(893, 260)');   // over #prose
  await page.eval('window.__luminaMagnifier.applySettings({readingStrip: true})');
  await sleep(120);
  const s3 = await page.eval(SNAP);
  ok('reading strip opens', s3.stripOpen === true);
  ok('reading strip measured its height', s3.stripH > 40, 'stripH = ' + s3.stripH);
  const strip = await page.eval(`(() => {
    const r = document.querySelector('.lumina-host').shadowRoot;
    return {
      text: r.querySelector('.strip .body').textContent,
      spans: r.querySelectorAll('.strip .s').length,
      who: r.querySelector('.strip .who').textContent,
      bg: getComputedStyle(r.querySelector('.strip')).backgroundColor,
      size: getComputedStyle(r.querySelector('.strip')).fontSize
    };
  })()`);
  ok('strip extracted real page text', /LUMINOSTAT/.test(strip.text), strip.text.slice(0, 60));
  ok('strip split the text into sentences', strip.spans >= 2, 'spans = ' + strip.spans);
  ok('strip reports the sentence count', /\d+ sentence/.test(strip.who), strip.who);
  eq('strip uses the theme size', strip.size, '22px');

  /* The toolbar must move out of the strip's way. */
  const s4 = await page.eval(SNAP);
  near('toolbar moves to the top when the strip is open', s4.toolbar.top, 16, 2);

  /* And the lens must not hide behind the strip when the pointer goes low. */
  await page.eval(`window.__luminaMagnifier.setPointer(700, ${vp.h} - 6)`);
  await page.eval('window.__luminaMagnifier.renderNow()');
  const s4b = await page.eval(SNAP);
  const lensBottom = s4b.aim.rect.y + s4b.aim.rect.h;
  ok('lens stays clear of the reading strip',
    lensBottom <= vp.h - s4b.stripH + 1,
    'lens bottom ' + Math.round(lensBottom) + ' vs strip top ' + Math.round(vp.h - s4b.stripH));

  /* ---- 7. sentence navigation + highlight ---- */
  await page.eval('window.__luminaMagnifier.readStop()');
  const sent = await page.eval(`window.__luminaMagnifier.sentences('Take one tablet. Do not exceed four in 24 hours! 饭后服用。')`);
  eq('sentence splitter handles Latin + CJK', sent.length, 3);

  /* Drive the real read-aloud queue with a controllable speech stub. The stub's
     cancel() deliberately fires the pending onend, which is what Chrome does — that is
     exactly the hazard the utterance-id guard exists for. Without the guard, stepping
     forward would skip a sentence. */
  const speech = await page.eval(`(async () => {
    const spoken = [];
    let last = null;
    window.__autoEnd = false;
    // speechSynthesis is a readonly IDL attribute on window — a plain assignment is
    // silently dropped, so it has to be redefined.
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        speak(u) { last = u; spoken.push(u.text); if (window.__autoEnd) setTimeout(() => u.onend && u.onend(), 0); },
        cancel() { if (last && last.onend) { const f = last.onend; last = null; f(); } },
        pause() {}, resume() {}
      }
    });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: function (t) { this.text = t; }
    });
    const api = window.__luminaMagnifier;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    api.readStop();
    api.readStart('One. Two. Three.');
    await wait(40);
    const started = { spoken: spoken.slice(), state: api.readState() };

    api.readNext();
    await wait(40);
    const next = { spoken: spoken.slice(), state: api.readState() };

    api.readPrev();
    await wait(40);
    const prev = { spoken: spoken.slice(), state: api.readState() };

    api.readStop();
    const stopped = api.readState();

    // Now let it run to the end on its own.
    window.__autoEnd = true;
    spoken.length = 0;
    api.readStart('Alpha. Beta. Gamma.');
    await wait(200);
    const auto = { spoken: spoken.slice(), state: api.readState() };

    return { started, next, prev, stopped, auto };
  })()`);

  eq('read-aloud speaks the first sentence', speech.started.spoken.join('|'), 'One.');
  eq('read-aloud reports its position', speech.started.state.index, 0);
  eq('read-aloud knows how many sentences there are', speech.started.state.count, 3);
  ok('read-aloud is active while speaking', speech.started.state.active === true);
  eq('next advances exactly one sentence (no double-skip from the cancel)', speech.next.spoken.join('|'), 'One.|Two.');
  eq('next moves the index', speech.next.state.index, 1);
  eq('previous steps back', speech.prev.state.index, 0);
  ok('stop clears the active flag', speech.stopped.active === false);
  eq('auto-advance reads every sentence in order', speech.auto.spoken.join('|'), 'Alpha.|Beta.|Gamma.');
  ok('auto-advance stops at the end', speech.auto.state.active === false);

  /* ---- 8. docked view ---- */
  await page.eval('window.__luminaMagnifier.applySettings({readingStrip: false, dock: "bottom", guide: false})');
  await page.eval('window.__luminaMagnifier.renderNow()');
  const s5 = await page.eval(SNAP);
  eq('dock setting applied', s5.settings.dock, 'bottom');
  near('docked band sits at the bottom edge', s5.aim.rect.y + s5.aim.rect.h, vp.h, 2);
  eq('docked band is full width', s5.aim.rect.w, vp.w);

  /* ---- 9. shapes ---- */
  await page.eval('window.__luminaMagnifier.applySettings({dock: "off", shape: "rectangle", lensSize: 300, lensHeight: 0})');
  await page.eval('window.__luminaMagnifier.renderNow()');
  const s6 = await page.eval(SNAP);
  near('wide lens keeps 1.6:1', s6.aim.rect.w / s6.aim.rect.h, 1.6, 0.02);

  /* ---- 10. custom width x height ---- */
  await page.eval('window.__luminaMagnifier.applySettings({shape: "square", lensSize: 320, lensHeight: 120})');
  await page.eval('window.__luminaMagnifier.renderNow()');
  const s7 = await page.eval(SNAP);
  eq('custom lens height honoured', Math.round(s7.aim.rect.h), 120);
  eq('custom lens width honoured', Math.round(s7.aim.rect.w), 320);

  /* ---- 11. settings persistence does not leak a site override into globals ---- */
  const leak = await page.eval(`(async () => {
    const api = window.__luminaMagnifier;
    const key = location.hostname || location.origin || 'unknown';
    // Global defaults: zoom 200. Site override for THIS page's key: zoom 500.
    window.__syncWrites = { luminaSettings: { zoom: 200, perSite: true } };
    window.__localWrites = { luminaSites: { [key]: { zoom: 500 } } };
    await api.stop();
    await api.start();
    await new Promise((r) => setTimeout(r, 120));
    const afterLoad = api.snapshot.settings.zoom;
    api.applySettings({ zoom: 500 });   // a site-specific change
    await new Promise((r) => setTimeout(r, 260));
    return {
      afterLoad,
      globalZoom: (window.__syncWrites.luminaSettings || {}).zoom,
      siteZoom: ((window.__localWrites.luminaSites || {})[key] || {}).zoom
    };
  })()`);
  eq('site override is applied on load', leak.afterLoad, 500);
  eq('site change is written to the site map', leak.siteZoom, 500);
  eq('global defaults are NOT overwritten by a site override', leak.globalZoom, 200);

  /* ---- 12. capture records the scroll offset from request time ---- */
  const race = await page.eval(`(async () => {
    await window.__luminaMagnifier.stop();
    return true;
  })()`);
  ok('lens stops cleanly', race === true);

  await ready(page, HARNESS + '?manual=1&tall=1&slow=260');
  const scrolled = await page.eval(`(async () => {
    const api = window.__luminaMagnifier;
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 60));
    await api.start();
    await new Promise((r) => setTimeout(r, 400));   // let the first frame land
    window.scrollTo(0, 300);
    await new Promise((r) => setTimeout(r, 30));
    await api.recapture();                          // capture begins with scrollY = 300
    window.scrollTo(0, 700);                        // page moves during the round trip
    await new Promise((r) => setTimeout(r, 900));
    return { frameY: api.snapshot.frameScroll && api.snapshot.frameScroll.y, now: Math.round(scrollY) };
  })()`);
  ok('frame records the scroll offset at capture time, not reply time',
    scrolled.frameY === 300, 'frameScrollY = ' + scrolled.frameY + ', live scrollY = ' + scrolled.now);

  /* ---- 13. narrow viewport: the toolbar must fit on screen ---- */
  await page.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 760, deviceScaleFactor: 1, mobile: false });
  await sleep(260);
  await page.eval('window.__luminaMagnifier.renderNow()');
  const s8 = await page.eval(SNAP);
  const leftEdge = s8.toolbar.left - s8.toolbar.w / 2;
  const rightEdge = s8.toolbar.left + s8.toolbar.w / 2;
  ok('toolbar fits inside a 420px viewport',
    leftEdge >= -1 && rightEdge <= 421,
    'spans ' + Math.round(leftEdge) + '..' + Math.round(rightEdge) + ' (w = ' + s8.toolbar.w + ')');
  ok('toolbar stays a single row at 420px', s8.toolbar.h <= 46, 'h = ' + s8.toolbar.h);
  ok('canvas resized for the narrow viewport', s8.canvas.w === 420, 'w = ' + s8.canvas.w);

  /* And it must still fit at an absurdly narrow width, by wrapping rather than clipping. */
  await page.send('Emulation.setDeviceMetricsOverride', { width: 300, height: 700, deviceScaleFactor: 1, mobile: false });
  await sleep(260);
  await page.eval('window.__luminaMagnifier.renderNow()');
  const s9 = await page.eval(SNAP);
  ok('toolbar wraps instead of overflowing at 300px',
    s9.toolbar.left - s9.toolbar.w / 2 >= -1 && s9.toolbar.left + s9.toolbar.w / 2 <= 301,
    'spans ' + Math.round(s9.toolbar.left - s9.toolbar.w / 2) + '..' + Math.round(s9.toolbar.left + s9.toolbar.w / 2) +
    ', w = ' + s9.toolbar.w + ', h = ' + s9.toolbar.h);
  await page.send('Emulation.clearDeviceMetricsOverride');

  /* ---- 14. no page errors during the whole run ---- */
  const errors = session.errors || [];
  ok('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  /* ---- 15. visual capture (--shots) ---- */
  if (SHOTS) {
    const { writeFile } = await import('node:fs/promises');
    const shoot = async (name) => {
      await sleep(260);
      const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(here, 'shot-' + name + '.png'), Buffer.from(data, 'base64'));
      console.log('  \u2192 test/shot-' + name + '.png');
    };

    await ready(page, HARNESS + '?shape=circle&zoom=260&size=300&x=890&y=250');
    await page.eval('window.__luminaMagnifier.applySettings({shape:"circle", zoom:260, lensSize:300})');
    await page.eval('window.__luminaMagnifier.setPointer(890, 250)');
    await shoot('lens-circle');

    await page.eval('window.__luminaMagnifier.applySettings({guide:true, guideHeight:150, guideDim:68})');
    await shoot('lens-guide');

    await page.eval('window.__luminaMagnifier.applySettings({guide:false, readingStrip:true})');
    await shoot('lens-strip');

    await page.eval('window.__luminaMagnifier.applySettings({readingStrip:false, textBoost:85, sharpen:55, contrast:130})');
    await page.eval('window.__luminaMagnifier.setPointer(760, 415)');
    await shoot('lens-boost');

    await page.send('Emulation.setDeviceMetricsOverride', { width: 430, height: 780, deviceScaleFactor: 2, mobile: false });
    await sleep(220);
    await page.eval('window.__luminaMagnifier.applySettings({textBoost:0, sharpen:0, contrast:100, readingStrip:true, zoom:200, lensSize:220})');
    await page.eval('window.__luminaMagnifier.setPointer(215, 270)');
    await shoot('lens-narrow-strip');
    await page.send('Emulation.clearDeviceMetricsOverride');
  }
}

/* ---------------- runner ---------------- */

let session = null;
let page = null;
let browser = null;

try {
  console.log('Launching headless Chrome…');
  session = await launch({ headed: HEADED });
  if (!session) {
    console.log('\nNo Chrome/Edge binary found — browser verification SKIPPED.');
    skipped('browser suite', 'no Chromium binary on this machine');
  } else {
    const opened = await openPage(session, 'about:blank');
    page = opened.page;
    browser = opened.browser;
    await suite(page, { errors: opened.errors });
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
