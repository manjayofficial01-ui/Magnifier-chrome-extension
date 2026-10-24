/* Photo Magnifier — full-image pan/zoom viewer with enhancement filters.
   Opens from the "Magnify this image" context menu (?src=…), the popup,
   file drag-drop, clipboard paste, or a pasted URL. */

'use strict';

const $ = (sel) => document.querySelector(sel);

const els = {
  stage: $('#stage'),
  canvas: $('#vcanvas'),
  empty: $('#empty'),
  err: $('#err'),
  url: $('#url'),
  loadUrl: $('#loadUrl'),
  file: $('#file'),
  vOpen: $('#vOpen'),
  vInvert: $('#vInvert'),
  vGray: $('#vGray'),
  vBold: $('#vBold'),
  vPixel: $('#vPixel'),
  vBrightness: $('#vBrightness'),
  vBrightnessVal: $('#vBrightnessVal'),
  vContrast: $('#vContrast'),
  vContrastVal: $('#vContrastVal'),
  vSaturation: $('#vSaturation'),
  vSaturationVal: $('#vSaturationVal'),
  vSharpen: $('#vSharpen'),
  vSharpenVal: $('#vSharpenVal'),
  vReset: $('#vReset'),
  zoombar: $('#zoombar'),
  zIn: $('#zIn'),
  zOut: $('#zOut'),
  zPct: $('#zPct'),
  zRotate: $('#zRotate'),
  zFit: $('#zFit')
};

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 32;
const BOLD_ON = 55;

const state = {
  img: null,
  objectUrl: null,
  scale: 1,
  ox: 0, // origin of the rotated image box in stage css px
  oy: 0,
  rotation: 0, // 0 | 90 | 180 | 270
  w: 0,  // cached stage size — measured on resize, not per frame
  h: 0,
  dirty: true,
  raf: 0,
  panning: null,
  sharpenConv: null,
  boostMorph: null,
  lastSharpen: -1,
  lastBoost: -1,
  settings: window.LuminaNormalizeColour({})
};

const ctx = els.canvas.getContext('2d');

/* ---------------- settings ---------------- */

async function loadSettings() {
  try {
    const res = await chrome.storage.sync.get('luminaViewer');
    state.settings = window.LuminaNormalizeColour((res && res.luminaViewer) || {});
  } catch (e) { /* preview mode / defaults */ }
}

function persistSettings() {
  try {
    chrome.storage.sync.set({ luminaViewer: state.settings }).catch(() => {});
  } catch (e) { /* preview mode */ }
}

function setFill(el) {
  const min = +el.min, max = +el.max;
  el.style.setProperty('--fill', ((+el.value - min) / (max - min)) * 100 + '%');
}

function renderControls() {
  els.vBrightness.value = state.settings.brightness;
  els.vContrast.value = state.settings.contrast;
  els.vSaturation.value = state.settings.saturation;
  els.vSharpen.value = state.settings.sharpen;
  els.vBrightnessVal.textContent = state.settings.brightness;
  els.vContrastVal.textContent = state.settings.contrast;
  els.vSaturationVal.textContent = state.settings.saturation;
  els.vSharpenVal.textContent = state.settings.sharpen;
  els.vInvert.classList.toggle('on', state.settings.invert);
  els.vGray.classList.toggle('on', state.settings.grayscale);
  els.vBold.classList.toggle('on', state.settings.textBoost > 0);
  els.vPixel.classList.toggle('on', state.settings.pixelPerfect);
  for (const el of [els.vBrightness, els.vContrast, els.vSaturation, els.vSharpen]) setFill(el);
  updateZoomLabel();
}

/* ---------------- rendering ---------------- */

/* Dimensions of the image *after* rotation — what fit() and the pan origin use. */
function displayDims() {
  if (!state.img) return { w: 0, h: 0 };
  const iw = state.img.naturalWidth, ih = state.img.naturalHeight;
  return (state.rotation % 180 === 0) ? { w: iw, h: ih } : { w: ih, h: iw };
}

function resizeCanvas() {
  const dpr = devicePixelRatio || 1;
  const r = els.stage.getBoundingClientRect();
  const prevW = state.w, prevH = state.h;
  state.w = r.width;
  state.h = r.height;
  els.canvas.width = Math.max(1, Math.round(state.w * dpr));
  els.canvas.height = Math.max(1, Math.round(state.h * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Keep the same point centred when the window is resized instead of stranding the image.
  if (state.img && prevW > 0 && prevH > 0) {
    state.ox += (state.w - prevW) / 2;
    state.oy += (state.h - prevH) / 2;
  }
  requestDraw();
}

function requestDraw() {
  state.dirty = true;
  if (state.raf) return;
  state.raf = requestAnimationFrame(() => {
    state.raf = 0;
    if (state.dirty) { state.dirty = false; draw(); }
  });
}

function draw() {
  ctx.clearRect(0, 0, state.w, state.h);
  if (!state.img) return;
  ctx.imageSmoothingEnabled = !state.settings.pixelPerfect;
  ctx.imageSmoothingQuality = 'high';

  // Sync the radius even when it drops back to 0, so the filter never disagrees with
  // the control (a reset used to leave the previous radius on the element).
  if (state.boostMorph && state.lastBoost !== state.settings.textBoost) {
    state.boostMorph.setAttribute('radius', String(window.LuminaBoostRadius(state.settings.textBoost)));
    state.lastBoost = state.settings.textBoost;
  }
  const boost = state.settings.textBoost > 0 && !!state.boostMorph;
  let filter = window.LuminaFilterString(state.settings, { boost });
  if (state.settings.sharpen > 0 && state.sharpenConv) {
    if (state.lastSharpen !== state.settings.sharpen) {
      state.sharpenConv.setAttribute('kernelMatrix', window.LuminaSharpenKernel(state.settings.sharpen));
      state.lastSharpen = state.settings.sharpen;
    }
    filter += ' url(#lumina-sharpen)';
  }
  ctx.filter = filter;

  // Draw rotated about the centre of the display box, so ox/oy stay the top-left of
  // the *rotated* bounding box and every pan/zoom calculation is rotation-agnostic.
  const iw = state.img.naturalWidth, ih = state.img.naturalHeight;
  const d = displayDims();
  const dw = d.w * state.scale, dh = d.h * state.scale;
  ctx.save();
  ctx.translate(Math.round(state.ox) + dw / 2, Math.round(state.oy) + dh / 2);
  if (state.rotation) ctx.rotate((state.rotation * Math.PI) / 180);
  ctx.drawImage(state.img, (-iw * state.scale) / 2, (-ih * state.scale) / 2, iw * state.scale, ih * state.scale);
  ctx.restore();
  ctx.filter = 'none';
}

function fit(margin) {
  if (!state.img) return;
  const m = margin == null ? 56 : margin;
  const d = displayDims();
  // A stage smaller than the margin would otherwise yield a negative scale.
  const s = Math.min((Math.max(40, state.w - m)) / d.w, (Math.max(40, state.h - m)) / d.h, 1);
  state.scale = Math.max(ZOOM_MIN, s);
  state.ox = (state.w - d.w * state.scale) / 2;
  state.oy = (state.h - d.h * state.scale) / 2;
  updateZoomLabel();
  requestDraw();
}

/* Zoom about a point given in stage coordinates. Expressing the anchor as a ratio of
   the display box keeps this correct at every rotation, which the old
   image-coordinate version was not. */
function setZoom(target, ax, ay) {
  if (!state.img) return;
  if (ax == null) { ax = state.w / 2; ay = state.h / 2; }
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, target));
  if (next === state.scale) return;
  const k = next / state.scale;
  state.ox = ax - (ax - state.ox) * k;
  state.oy = ay - (ay - state.oy) * k;
  state.scale = next;
  updateZoomLabel();
  requestDraw();
}

function rotate90() {
  if (!state.img) return;
  state.rotation = (state.rotation + 90) % 360;
  fit();
}

function updateZoomLabel() {
  els.zPct.textContent = Math.round(state.scale * 100) + '%';
}

/* ---------------- image loading ---------------- */

function showErr(msg) {
  els.err.hidden = false;
  els.err.textContent = msg;
}

function clearErr() {
  els.err.hidden = true;
}

/* `objectUrl` is the blob URL backing this image (null for data/http sources).
   The previous one is revoked only after the swap, so a still-displayed image is
   never left pointing at freed bytes. */
function applyImage(img, objectUrl) {
  const prev = state.objectUrl;
  state.img = img;
  state.objectUrl = objectUrl || null;
  if (prev && prev !== state.objectUrl) URL.revokeObjectURL(prev);
  els.empty.style.display = 'none';
  els.zoombar.hidden = false;
  fit();
}

function loadBlob(blob) {
  clearErr();
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => applyImage(img, url);
  img.onerror = () => {
    URL.revokeObjectURL(url);
    showErr('That file could not be decoded as an image.');
  };
  img.src = url;
}

async function loadFromUrl(raw) {
  const url = (raw || '').trim();
  if (!url) return;
  clearErr();

  if (/^data:image\//i.test(url)) {
    const img = new Image();
    img.onload = () => applyImage(img, null);
    img.onerror = () => showErr('That data URL could not be decoded.');
    img.src = url;
    return;
  }
  if (!/^https?:/i.test(url)) {
    showErr('Please paste a http(s) image URL.');
    return;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    if (!/^image\//i.test(blob.type) && !/\.(png|jpe?g|gif|webp|bmp|avif|svg)(\?|$)/i.test(url)) {
      throw new Error('Not an image');
    }
    loadBlob(blob);
  } catch (e) {
    showErr(
      'Could not load that image (' + (e && e.message ? e.message : 'network error') + '). ' +
      'Some sites block direct access — try right-clicking the image on its page and choosing “Magnify this image”, or download it and drop the file here.'
    );
  }
}

/* ---------------- interactions ---------------- */

/* Slider id -> settings key. Explicit: the old `slice(1).toLowerCase()` trick silently
   broke the moment an id and a key stopped matching. */
const SLIDERS = [
  ['vBrightness', 'vBrightnessVal', 'brightness'],
  ['vContrast', 'vContrastVal', 'contrast'],
  ['vSaturation', 'vSaturationVal', 'saturation'],
  ['vSharpen', 'vSharpenVal', 'sharpen']
];

function wire() {
  new ResizeObserver(resizeCanvas).observe(els.stage);
  resizeCanvas();

  els.vOpen.addEventListener('click', () => els.file.click());
  els.file.addEventListener('change', () => {
    if (els.file.files && els.file.files[0]) loadBlob(els.file.files[0]);
    els.file.value = '';
  });

  els.loadUrl.addEventListener('click', () => loadFromUrl(els.url.value));
  els.url.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadFromUrl(els.url.value);
  });

  // Drag & drop
  els.stage.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.stage.classList.add('dragover');
  });
  els.stage.addEventListener('dragleave', () => els.stage.classList.remove('dragover'));
  els.stage.addEventListener('drop', (e) => {
    e.preventDefault();
    els.stage.classList.remove('dragover');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadBlob(f);
  });

  // Clipboard paste
  window.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) {
        loadBlob(it.getAsFile());
        e.preventDefault();
        return;
      }
    }
  });

  // Pan (skip presses on the floating UI so its buttons keep receiving clicks)
  const inStageUI = (e) => !!(e.target.closest && e.target.closest('.zoombar, .panel, .empty'));
  els.stage.addEventListener('pointerdown', (e) => {
    if (!state.img || e.button !== 0 || inStageUI(e)) return;
    state.panning = { x: e.clientX, y: e.clientY, ox: state.ox, oy: state.oy };
    els.stage.classList.add('panning');
    try { els.stage.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
  });
  els.stage.addEventListener('pointermove', (e) => {
    if (!state.panning) return;
    state.ox = state.panning.ox + (e.clientX - state.panning.x);
    state.oy = state.panning.oy + (e.clientY - state.panning.y);
    requestDraw();
  });
  const endPan = () => {
    state.panning = null;
    els.stage.classList.remove('panning');
  };
  els.stage.addEventListener('pointerup', endPan);
  els.stage.addEventListener('pointercancel', endPan);
  els.stage.addEventListener('lostpointercapture', endPan);

  // Wheel zoom at cursor (but not over the floating panel, so its sliders stay scrollable)
  els.stage.addEventListener('wheel', (e) => {
    if (!state.img || inStageUI(e)) return;
    e.preventDefault();
    const r = els.canvas.getBoundingClientRect();
    // Trackpad pinch arrives as ctrl+wheel with much smaller deltas.
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016));
    setZoom(state.scale * factor, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  // Double-click: dive in, or back out
  els.stage.addEventListener('dblclick', (e) => {
    if (!state.img || inStageUI(e)) return;
    const r = els.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (state.scale < 1.6) setZoom(2.5, x, y);
    else fit();
  });

  // Zoom bar
  els.zIn.addEventListener('click', () => setZoom(state.scale * 1.25));
  els.zOut.addEventListener('click', () => setZoom(state.scale / 1.25));
  els.zPct.addEventListener('click', () => setZoom(1, state.w / 2, state.h / 2));
  els.zRotate.addEventListener('click', rotate90);
  els.zFit.addEventListener('click', () => fit());

  // Enhancement controls
  for (const [slider, val, key] of SLIDERS) {
    els[slider].addEventListener('input', () => {
      state.settings[key] = +els[slider].value;
      els[val].textContent = els[slider].value;
      setFill(els[slider]);
      persistSettings();
      requestDraw();
    });
  }

  els.vInvert.addEventListener('click', () => {
    state.settings.invert = !state.settings.invert;
    els.vInvert.classList.toggle('on', state.settings.invert);
    persistSettings();
    requestDraw();
  });

  els.vGray.addEventListener('click', () => {
    state.settings.grayscale = !state.settings.grayscale;
    els.vGray.classList.toggle('on', state.settings.grayscale);
    persistSettings();
    requestDraw();
  });

  els.vPixel.addEventListener('click', () => {
    state.settings.pixelPerfect = !state.settings.pixelPerfect;
    els.vPixel.classList.toggle('on', state.settings.pixelPerfect);
    persistSettings();
    requestDraw();
  });

  els.vBold.addEventListener('click', () => {
    state.settings.textBoost = state.settings.textBoost > 0 ? 0 : BOLD_ON;
    els.vBold.classList.toggle('on', state.settings.textBoost > 0);
    persistSettings();
    requestDraw();
  });

  els.vReset.addEventListener('click', () => {
    state.settings.brightness = 100;
    state.settings.contrast = 100;
    state.settings.saturation = 100;
    state.settings.sharpen = 0;
    state.settings.textBoost = 0;
    state.settings.invert = false;
    state.settings.grayscale = false;
    state.settings.pixelPerfect = false;
    renderControls();
    persistSettings();
    requestDraw();
  });

  // Keyboard
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === '+' || e.key === '=') setZoom(state.scale * 1.25);
    else if (e.key === '-' || e.key === '_') setZoom(state.scale / 1.25);
    else if (e.key === '0') fit();
    else if (e.key === '1') setZoom(1, state.w / 2, state.h / 2);
    else if (e.key === 'r' || e.key === 'R') rotate90();
  });

  // Don't leak the blob URL when the tab goes away.
  window.addEventListener('pagehide', () => {
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  });
}

/* ---------------- boot ---------------- */

async function boot() {
  state.sharpenConv = window.LuminaSharpenFilter.ensure(document.body);
  state.boostMorph = window.LuminaBoostFilter.ensure(document.body);
  await loadSettings();
  renderControls();
  wire();

  const src = new URLSearchParams(location.search).get('src');
  if (src) loadFromUrl(src);
}

boot();
