/* Lumina Magnifier popup — control center. */

'use strict';

const $ = (sel) => document.querySelector(sel);

const els = {
  power: $('#power'),
  status: $('#status'),
  statusTxt: $('#statusTxt'),
  zoom: $('#zoom'),
  zoomNum: $('#zoomNum'),
  zoomChips: $('#zoomChips'),
  shapes: $('#shapes'),
  lensSize: $('#lensSize'),
  lensW: $('#lensW'),
  lensH: $('#lensH'),
  sizeVal: $('#sizeVal'),
  lensSum: $('#lensSum'),
  dockSeg: $('#dockSeg'),
  followSeg: $('#followSeg'),
  presets: $('#presets'),
  presetVal: $('#presetVal'),
  // reading aids
  guide: $('#guide'),
  textBoostOn: $('#textBoostOn'),
  readingStrip: $('#readingStrip'),
  aidSum: $('#aidSum'),
  guideHeight: $('#guideHeight'),
  guideHeightVal: $('#guideHeightVal'),
  guideDim: $('#guideDim'),
  guideDimVal: $('#guideDimVal'),
  textBoost: $('#textBoost'),
  textBoostVal: $('#textBoostVal'),
  stripSize: $('#stripSize'),
  stripSizeVal: $('#stripSizeVal'),
  readRate: $('#readRate'),
  readRateVal: $('#readRateVal'),
  stripThemeSeg: $('#stripThemeSeg'),
  // enhance
  brightness: $('#brightness'),
  brightnessVal: $('#brightnessVal'),
  contrast: $('#contrast'),
  contrastVal: $('#contrastVal'),
  saturation: $('#saturation'),
  saturationVal: $('#saturationVal'),
  sepia: $('#sepia'),
  sepiaVal: $('#sepiaVal'),
  hue: $('#hue'),
  hueVal: $('#hueVal'),
  sharpen: $('#sharpen'),
  sharpenVal: $('#sharpenVal'),
  invert: $('#invert'),
  grayscale: $('#grayscale'),
  crosshair: $('#crosshair'),
  pixelPerfect: $('#pixelPerfect'),
  resetEnh: $('#resetEnh'),
  perSite: $('#perSite'),
  resetSite: $('#resetSite'),
  openViewer: $('#openViewer')
};

const PRESET_ZOOMS = [150, 200, 300, 400, 600];
const RANGES = [
  'zoom', 'lensSize',
  'brightness', 'contrast', 'saturation', 'sepia', 'hue', 'sharpen',
  'guideHeight', 'guideDim', 'textBoost', 'stripSize', 'readRate'
];

let settings = null;
// Raw global record from sync, WITHOUT a site override merged in. Writing the merged
// settings back to sync is what used to let a site override become everyone's default.
let globalSettings = {};
let tabId = null;
let siteKey = null;
let live = false;      // is the lens currently active on this tab?
let hasChromeApi = typeof chrome !== 'undefined' && !!(chrome.tabs && chrome.tabs.query);

/* ---------------- helpers ---------------- */

function setFill(el) {
  const min = +el.min, max = +el.max, v = +el.value;
  el.style.setProperty('--fill', ((v - min) / (max - min)) * 100 + '%');
}

function setStatus(kind, text) {
  els.status.className = 'status' + (kind ? ' ' + kind : '');
  els.statusTxt.textContent = text;
}

/* Slider bounds live in the shared model so the popup can never drift from the
   values the lens engine actually clamps to. */
function applyBounds() {
  const b = window.LuminaBounds;
  const defs = {
    zoom: [b.zoomMin, b.zoomMax, 5],
    lensSize: [b.sizeMin, b.sizeMax, 10],
    brightness: [b.enhanceMin, b.enhanceMax, 5],
    contrast: [b.enhanceMin, b.enhanceMax, 5],
    saturation: [b.enhanceMin, b.enhanceMax, 5],
    sepia: [b.sepiaMin, b.sepiaMax, 5],
    hue: [b.hueMin, b.hueMax, 5],
    sharpen: [0, 100, 5],
    guideHeight: [b.guideHeightMin, b.guideHeightMax, 2],
    guideDim: [b.guideDimMin, b.guideDimMax, 2],
    textBoost: [0, 100, 5],
    stripSize: [b.stripSizeMin, b.stripSizeMax, 1],
    readRate: [b.readRateMin, b.readRateMax, 0.1]
  };
  for (const id of RANGES) {
    const [lo, hi, step] = defs[id];
    els[id].min = lo;
    els[id].max = hi;
    els[id].step = step;
  }
  els.zoomNum.min = b.zoomMin; els.zoomNum.max = b.zoomMax; els.zoomNum.step = 1;
  els.lensW.min = b.sizeMin; els.lensW.max = b.sizeMax; els.lensW.step = 2;
  els.lensH.min = 0; els.lensH.max = b.heightMax; els.lensH.step = 2;
}

function hostOf(url) {
  try { return new URL(url).hostname || null; } catch (e) { return null; }
}

function persist() {
  if (!hasChromeApi) return;
  const s = settings;
  const global = s.perSite
    ? Object.assign({}, globalSettings, { perSite: true })
    : Object.assign({}, s);
  globalSettings = global;
  chrome.storage.sync.set({ luminaSettings: global }).catch(() => {});

  if (!s.perSite || !siteKey) return;
  // Site overrides live in local storage: the map can outgrow the 8KB per-item sync quota.
  chrome.storage.local.get('luminaSites').then((res) => {
    const map = (res && res.luminaSites) || {};
    const ov = {};
    for (const k of window.LuminaSiteKeys) ov[k] = s[k];
    map[siteKey] = ov;
    chrome.storage.local.set({ luminaSites: map }).catch(() => {});
  }).catch(() => {});
}

function broadcast() {
  if (!hasChromeApi || !live || !tabId) return;
  chrome.tabs.sendMessage(tabId, { type: 'lumina:settings', settings }).catch(() => {});
}

/* One funnel for every control: normalise (so out-of-range typed input is clamped,
   not stored), repaint, save, push to the live lens. */
function commit() {
  settings = window.LuminaNormalize(settings);
  renderAll();
  persist();
  broadcast();
}

function readEnhance() {
  settings.brightness = +els.brightness.value;
  settings.contrast = +els.contrast.value;
  settings.saturation = +els.saturation.value;
  settings.sepia = +els.sepia.value;
  settings.hue = +els.hue.value;
  settings.sharpen = +els.sharpen.value;
  settings.invert = els.invert.classList.contains('on');
  settings.grayscale = els.grayscale.classList.contains('on');
  settings.crosshair = els.crosshair.classList.contains('on');
  settings.pixelPerfect = els.pixelPerfect.classList.contains('on');
}

function renderAll() {
  els.zoom.value = settings.zoom;
  els.zoomNum.value = settings.zoom;
  els.lensSize.value = settings.lensSize;
  els.lensW.value = settings.lensSize;
  els.lensH.value = settings.lensHeight;
  els.brightness.value = settings.brightness;
  els.contrast.value = settings.contrast;
  els.saturation.value = settings.saturation;
  els.sepia.value = settings.sepia;
  els.hue.value = settings.hue;
  els.sharpen.value = settings.sharpen;

  els.guideHeight.value = settings.guideHeight;
  els.guideDim.value = settings.guideDim;
  els.textBoost.value = settings.textBoost;
  els.stripSize.value = settings.stripSize;
  els.readRate.value = settings.readRate;

  els.brightnessVal.textContent = settings.brightness;
  els.contrastVal.textContent = settings.contrast;
  els.saturationVal.textContent = settings.saturation;
  els.sepiaVal.textContent = settings.sepia;
  els.hueVal.textContent = settings.hue;
  els.sharpenVal.textContent = settings.sharpen;

  els.guideHeightVal.textContent = settings.guideHeight;
  els.guideDimVal.textContent = settings.guideDim;
  els.textBoostVal.textContent = settings.textBoost;
  els.stripSizeVal.textContent = settings.stripSize;
  els.readRateVal.textContent = settings.readRate.toFixed(1).replace(/\.0$/, '') + '×';

  const dims = window.LuminaLensDims(settings);
  els.sizeVal.textContent = dims.w + ' × ' + dims.h + ' px';
  const shapeName = settings.shape.charAt(0).toUpperCase() + settings.shape.slice(1);
  els.lensSum.textContent = shapeName + ' · ' + dims.w + '×' + dims.h;

  for (const id of RANGES) setFill(els[id]);

  els.zoomChips.querySelectorAll('.chip').forEach((c) =>
    c.classList.toggle('on', +c.dataset.z === settings.zoom)
  );
  els.shapes.querySelectorAll('.shape').forEach((b) =>
    b.classList.toggle('on', b.dataset.shape === settings.shape)
  );
  els.dockSeg.querySelectorAll('button').forEach((b) =>
    b.classList.toggle('on', b.dataset.dock === settings.dock)
  );
  els.followSeg.querySelectorAll('button').forEach((b) =>
    b.classList.toggle('on', b.dataset.follow === settings.follow)
  );
  els.stripThemeSeg.querySelectorAll('button').forEach((b) =>
    b.classList.toggle('on', b.dataset.theme === settings.stripTheme)
  );

  // Preset is derived from the sliders, never stored — so it cannot go stale.
  const pid = window.LuminaMatchPreset(settings);
  els.presets.querySelectorAll('.chip').forEach((c) =>
    c.classList.toggle('on', c.dataset.preset === pid)
  );
  const p = window.LuminaPresetById(pid);
  els.presetVal.textContent = p ? p.name : 'Custom';

  els.guide.classList.toggle('on', !!settings.guide);
  els.textBoostOn.classList.toggle('on', settings.textBoost > 0);
  els.readingStrip.classList.toggle('on', !!settings.readingStrip);

  const aids = [];
  if (settings.guide) aids.push('Guide');
  if (settings.textBoost > 0) aids.push('Bold');
  if (settings.readingStrip) aids.push('Strip');
  els.aidSum.textContent = aids.length ? aids.join(' · ') : 'Off';

  els.invert.classList.toggle('on', settings.invert);
  els.grayscale.classList.toggle('on', settings.grayscale);
  els.crosshair.classList.toggle('on', settings.crosshair);
  els.pixelPerfect.classList.toggle('on', settings.pixelPerfect);
  els.perSite.checked = !!settings.perSite;
  els.resetSite.hidden = !settings.perSite;
}

/* ---------------- wiring ---------------- */

function buildZoomChips() {
  for (const z of PRESET_ZOOMS) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.z = z;
    b.textContent = z + '%';
    b.addEventListener('click', () => {
      settings.zoom = z;
      commit();
    });
    els.zoomChips.appendChild(b);
  }
}

function buildPresets() {
  for (const p of window.LuminaPresets) {
    const b = document.createElement('button');
    b.className = 'chip preset';
    b.dataset.preset = p.id;
    b.title = p.name;
    b.innerHTML =
      '<span class="sw" style="background:' + p.swatch[0] + ';color:' + p.swatch[1] + '">A</span>' +
      '<span>' + p.name + '</span>';
    b.addEventListener('click', () => {
      settings = window.LuminaApplyPreset(settings, p.id);
      commit();
    });
    els.presets.appendChild(b);
  }
}

// Number inputs commit on `change` (blur / Enter) so half-typed values aren't clamped
// mid-keystroke — but `input` is used when the value is already in range.
function wireNumber(el, apply) {
  const push = () => {
    const v = +el.value;
    if (el.value === '' || isNaN(v)) return;
    apply(v);
    commit();
  };
  el.addEventListener('change', push);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); push(); } });
}

function wire() {
  els.power.addEventListener('change', async () => {
    if (els.power.checked) {
      setStatus('', 'Starting…');
      if (!hasChromeApi) { live = true; setStatus('on', 'Active on this tab'); return; }
      try {
        const res = await chrome.runtime.sendMessage({ type: 'lumina:activate', settings });
        if (res && res.ok) {
          live = true;
          setStatus('on', 'Active on this tab');
        } else {
          els.power.checked = false;
          setStatus('err', (res && res.error) || 'Could not start the magnifier.');
        }
      } catch (e) {
        els.power.checked = false;
        setStatus('err', 'Could not reach this tab. Try reloading the page.');
      }
    } else {
      live = false;
      if (hasChromeApi) {
        chrome.runtime.sendMessage({ type: 'lumina:deactivate' }).catch(() => {});
      }
      setStatus('', 'Inactive');
    }
  });

  for (const id of RANGES) {
    els[id].addEventListener('input', () => {
      settings[id] = +els[id].value;
      commit();
    });
  }

  wireNumber(els.zoomNum, (v) => { settings.zoom = v; });
  wireNumber(els.lensW, (v) => { settings.lensSize = v; });
  wireNumber(els.lensH, (v) => { settings.lensHeight = v; });

  els.shapes.addEventListener('click', (e) => {
    const btn = e.target.closest('.shape');
    if (!btn) return;
    settings.shape = btn.dataset.shape;
    commit();
  });

  els.dockSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    settings.dock = btn.dataset.dock;
    commit();
  });

  els.followSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    settings.follow = btn.dataset.follow;
    commit();
  });

  els.stripThemeSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    settings.stripTheme = btn.dataset.theme;
    commit();
  });

  // Reading-aid toggles. `textBoost` is a 0-100 slider, so its button is a shortcut
  // between "off" and the usual working amount rather than a boolean.
  els.guide.addEventListener('click', () => {
    settings.guide = !settings.guide;
    commit();
  });
  els.readingStrip.addEventListener('click', () => {
    settings.readingStrip = !settings.readingStrip;
    commit();
  });
  els.textBoostOn.addEventListener('click', () => {
    settings.textBoost = settings.textBoost > 0 ? 0 : 55;
    commit();
  });

  for (const id of ['invert', 'grayscale', 'crosshair', 'pixelPerfect']) {
    els[id].addEventListener('click', () => {
      els[id].classList.toggle('on');
      readEnhance();
      commit();
    });
  }

  els.resetEnh.addEventListener('click', () => {
    // Full reset — including the tint channels, which the old reset used to leave behind.
    settings = window.LuminaApplyPreset(settings, 'none');
    settings.sharpen = 0;
    settings.textBoost = 0;
    settings.crosshair = false;
    settings.pixelPerfect = false;
    commit();
  });

  els.perSite.addEventListener('change', async () => {
    if (els.perSite.checked) {
      settings.perSite = true;
      commit();
      return;
    }
    // Turning per-site memory off means "go back to my global defaults". Re-reading
    // sync is the only honest way to know them: the in-memory settings are this
    // site's values, not the global ones.
    settings.perSite = false;
    if (hasChromeApi) {
      try {
        const res = await chrome.storage.sync.get('luminaSettings');
        globalSettings = (res && res.luminaSettings) || {};
        settings = window.LuminaNormalize(globalSettings);
        settings.perSite = false;
      } catch (e) { /* keep the current values */ }
    }
    commit();
  });

  els.resetSite.addEventListener('click', async () => {
    if (!hasChromeApi || !siteKey) return;
    try {
      const res = await chrome.storage.local.get('luminaSites');
      const map = (res && res.luminaSites) || {};
      delete map[siteKey];
      await chrome.storage.local.set({ luminaSites: map });
    } catch (e) { /* nothing stored — nothing to reset */ }
    const res = await chrome.storage.sync.get('luminaSettings');
    globalSettings = (res && res.luminaSettings) || {};
    settings = window.LuminaNormalize(globalSettings);
    renderAll();
    broadcast();
  });

  els.openViewer.addEventListener('click', () => {
    if (!hasChromeApi) return;
    chrome.tabs.create({ url: chrome.runtime.getURL('src/viewer/viewer.html') });
  });
}

/* ---------------- boot ---------------- */

async function loadSettings() {
  let stored = {};
  if (hasChromeApi) {
    try {
      const res = await chrome.storage.sync.get('luminaSettings');
      stored = (res && res.luminaSettings) || {};
    } catch (e) { /* defaults are fine */ }
  }
  globalSettings = stored;
  if (stored.perSite && siteKey && hasChromeApi) {
    try {
      const res = await chrome.storage.local.get('luminaSites');
      const map = (res && res.luminaSites) || {};
      if (map[siteKey]) stored = Object.assign({}, stored, map[siteKey]);
    } catch (e) { /* fall back to the global settings */ }
  }
  return window.LuminaNormalize(stored);
}

async function boot() {
  applyBounds();
  settings = window.LuminaNormalize({});
  buildZoomChips();
  buildPresets();
  wire();
  renderAll();

  if (!hasChromeApi) {
    // Opened outside the extension (design preview) — show defaults.
    setStatus('', 'Preview mode');
    return;
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab ? tab.id : null;
    siteKey = tab && tab.url ? hostOf(tab.url) : null;
  } catch (e) { tabId = null; siteKey = null; }

  settings = await loadSettings();

  if (tabId != null) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: 'lumina:ping' });
      live = !!(res && res.active);
    } catch (e) { live = false; }
  }

  els.power.checked = live;
  renderAll();
  setStatus(live ? 'on' : '', live ? 'Active on this tab' : 'Inactive');
}

boot();
