/* Shared settings model — loaded by the content script and every extension page.
   Single source of truth for defaults, bounds, the CSS filter string, the
   reading-preset catalogue and the WCAG colour maths, so the lens, the popup and
   the Photo viewer can never disagree about what a setting means. */
(function () {
  'use strict';

  window.LuminaDefaults = {
    zoom: 200,            // percent
    shape: 'circle',      // circle | square | rounded | rectangle
    lensSize: 240,        // css px — lens width (or diameter)
    lensHeight: 0,        // css px — 0 = auto (square, or 1:1.6 for rectangle); else explicit
    dock: 'off',          // off | top | bottom   (Windows/macOS "docked" view parity)
    follow: 'pointer',    // pointer | caret | focus  (Windows Magnifier follow-targets)
    brightness: 100,      // percent
    contrast: 100,        // percent
    saturation: 100,      // percent
    sepia: 0,             // 0-100, tints the frame (presets build on this)
    hue: 0,               // -180..180 deg, rotates the tint
    sharpen: 0,           // 0-100 (unsharp kernel strength)
    pixelPerfect: false,  // nearest-neighbour + integer zoom — crisp text/pixel inspection
    invert: false,
    grayscale: false,
    crosshair: false,
    perSite: false        // remember zoom/shape/colour per site (stored in storage.local)
  };

  window.LuminaBounds = {
    zoomMin: 100,
    zoomMax: 1000,
    sizeMin: 80,          // lens width
    sizeMax: 1000,
    heightMin: 40,        // explicit lens height (0 = auto)
    heightMax: 1000,
    enhanceMin: 60,
    enhanceMax: 160,
    sepiaMin: 0,
    sepiaMax: 100,
    hueMin: -180,
    hueMax: 180
  };

  window.LuminaShapes = ['circle', 'square', 'rounded', 'rectangle'];
  window.LuminaDocks = ['off', 'top', 'bottom'];
  window.LuminaFollows = ['pointer', 'caret', 'focus'];

  /* Settings that are remembered per site. Never includes `perSite` itself, so
     flipping the master switch can't be overridden by a stale site record. */
  window.LuminaSiteKeys = [
    'zoom', 'shape', 'lensSize', 'lensHeight', 'dock', 'follow',
    'brightness', 'contrast', 'saturation', 'sepia', 'hue', 'sharpen',
    'pixelPerfect', 'invert', 'grayscale', 'crosshair'
  ];

  var num = function (v, fallback) {
    var n = +v;
    return isNaN(n) ? fallback : n;
  };
  var clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };

  window.LuminaNormalize = function (partial) {
    var d = window.LuminaDefaults;
    var b = window.LuminaBounds;
    var s = Object.assign({}, d, partial || {});
    s.zoom = clamp(Math.round(num(s.zoom, d.zoom)), b.zoomMin, b.zoomMax);
    s.lensSize = clamp(Math.round(num(s.lensSize, d.lensSize)), b.sizeMin, b.sizeMax);
    // 0 / null / NaN all mean "auto" — a stored 0 from an older version stays valid.
    var lh = num(s.lensHeight, 0);
    s.lensHeight = (lh > 0) ? clamp(Math.round(lh), b.heightMin, b.heightMax) : 0;
    if (window.LuminaShapes.indexOf(s.shape) === -1) s.shape = d.shape;
    if (window.LuminaDocks.indexOf(s.dock) === -1) s.dock = d.dock;
    if (window.LuminaFollows.indexOf(s.follow) === -1) s.follow = d.follow;
    s.brightness = clamp(Math.round(num(s.brightness, d.brightness)), b.enhanceMin, b.enhanceMax);
    s.contrast = clamp(Math.round(num(s.contrast, d.contrast)), b.enhanceMin, b.enhanceMax);
    s.saturation = clamp(Math.round(num(s.saturation, d.saturation)), b.enhanceMin, b.enhanceMax);
    s.sepia = clamp(Math.round(num(s.sepia, d.sepia)), b.sepiaMin, b.sepiaMax);
    s.hue = clamp(Math.round(num(s.hue, d.hue)), b.hueMin, b.hueMax);
    s.sharpen = clamp(Math.round(num(s.sharpen, d.sharpen)), 0, 100);
    s.pixelPerfect = !!s.pixelPerfect;
    s.invert = !!s.invert;
    s.grayscale = !!s.grayscale;
    s.crosshair = !!s.crosshair;
    s.perSite = !!s.perSite;
    return s;
  };

  /* Requested lens box in CSS px, before the viewport-fit clamp in the lens engine.
     For "rectangle" the lens is wider than tall (1.6:1) so a single size value gives
     the wide band; an explicit lensHeight overrides the height for true custom WxH.
     The square shapes always use the requested width as both dimensions. */
  window.LuminaLensDims = function (s) {
    var w = s.lensSize;
    if (s.shape === 'rectangle') w = Math.round(w * 1.6);
    var h = s.lensHeight > 0 ? s.lensHeight : s.lensSize;
    return { w: w, h: h };
  };

  /* Colour-only subset, for surfaces (the Photo viewer) that persist just the
     enhancement settings and must tolerate corrupt or partial stored values. */
  window.LuminaNormalizeColour = function (partial) {
    var s = window.LuminaNormalize(partial);
    return {
      brightness: s.brightness,
      contrast: s.contrast,
      saturation: s.saturation,
      sepia: s.sepia,
      hue: s.hue,
      sharpen: s.sharpen,
      pixelPerfect: s.pixelPerfect,
      invert: s.invert,
      grayscale: s.grayscale
    };
  };

  /* The one CSS filter builder. Order matters: tints (sepia/hue-rotate) are applied
     after the level adjustments and before the boolean modes. */
  window.LuminaFilterString = function (s) {
    var f =
      'brightness(' + s.brightness + '%) contrast(' + s.contrast + '%) saturate(' + s.saturation + '%)';
    if (s.sepia > 0) f += ' sepia(' + s.sepia + '%)';
    if (s.hue !== 0) f += ' hue-rotate(' + s.hue + 'deg)';
    if (s.grayscale) f += ' grayscale(1)';
    if (s.invert) f += ' invert(1)';
    return f;
  };

  /* Reading presets. Each is a colour-only partial: applying one never touches zoom,
     shape, size, sharpen or the crosshair. `swatch` is [background, foreground] for
     the chip preview. Signatures are precomputed so the UI can tell which preset the
     current sliders correspond to (and show "Custom" when none does). */
  window.LuminaPresets = [
    { id: 'none',     name: 'Default',       swatch: ['#f6f7fb', '#1a2033'], set: {} },
    { id: 'night',    name: 'Night',         swatch: ['#241a10', '#f0d9b5'], set: { brightness: 82, contrast: 104, saturation: 70, sepia: 55, hue: -14 } },
    { id: 'paper',    name: 'Sepia paper',   swatch: ['#f3e7cf', '#4a3a22'], set: { brightness: 102, contrast: 103, saturation: 80, sepia: 65 } },
    { id: 'contrast', name: 'High contrast', swatch: ['#ffffff', '#000000'], set: { brightness: 106, contrast: 145, saturation: 55 } },
    { id: 'mono',     name: 'Grayscale',     swatch: ['#e8e8e8', '#222222'], set: { grayscale: true, contrast: 112 } },
    { id: 'invert',   name: 'Inverted',      swatch: ['#10131c', '#e8ecf7'], set: { invert: true, contrast: 104 } },
    { id: 'rose',     name: 'Rose tint',     swatch: ['#f6dfe3', '#5a2b33'], set: { brightness: 100, contrast: 102, saturation: 60, sepia: 35, hue: -35 } },
    { id: 'aqua',     name: 'Aqua tint',     swatch: ['#dceef0', '#1f4a50'], set: { brightness: 100, contrast: 102, saturation: 60, sepia: 35, hue: 150 } }
  ];

  var COLOUR_KEYS = ['brightness', 'contrast', 'saturation', 'sepia', 'hue', 'invert', 'grayscale'];

  window.LuminaPresets.forEach(function (p) {
    p.sig = window.LuminaNormalize(p.set);
  });

  /* Which preset do the current colour settings equal? 'custom' when the user has
     moved a slider off every preset. Derived, never stored — so it cannot go stale. */
  window.LuminaMatchPreset = function (s) {
    for (var i = 0; i < window.LuminaPresets.length; i++) {
      var sig = window.LuminaPresets[i].sig, ok = true;
      for (var k = 0; k < COLOUR_KEYS.length; k++) {
        if (s[COLOUR_KEYS[k]] !== sig[COLOUR_KEYS[k]]) { ok = false; break; }
      }
      if (ok) return window.LuminaPresets[i].id;
    }
    return 'custom';
  };

  window.LuminaPresetById = function (id) {
    for (var i = 0; i < window.LuminaPresets.length; i++) {
      if (window.LuminaPresets[i].id === id) return window.LuminaPresets[i];
    }
    return null;
  };

  /* Merge a preset's colours onto the caller's non-colour preferences. */
  window.LuminaApplyPreset = function (current, id) {
    var p = window.LuminaPresetById(id) || window.LuminaPresetById('none');
    var merged = Object.assign({}, p.set);
    merged.zoom = current.zoom;
    merged.shape = current.shape;
    merged.lensSize = current.lensSize;
    merged.lensHeight = current.lensHeight;
    merged.dock = current.dock;
    merged.follow = current.follow;
    merged.sharpen = current.sharpen;
    merged.pixelPerfect = current.pixelPerfect;
    merged.crosshair = current.crosshair;
    merged.perSite = current.perSite;
    return window.LuminaNormalize(merged);
  };

  /* ---------------- WCAG colour maths (used by the lens colour picker) ---------------- */

  function channel(v) {
    v = v / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  /* WCAG 2.x relative luminance. */
  window.LuminaLuminance = function (r, g, b) {
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };

  /* Contrast ratio between two sRGB triples — 1..21. */
  window.LuminaContrast = function (a, b) {
    var l1 = window.LuminaLuminance(a[0], a[1], a[2]);
    var l2 = window.LuminaLuminance(b[0], b[1], b[2]);
    var hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  };

  window.LuminaContrastVerdict = function (ratio) {
    return {
      aaLarge: ratio >= 3,      // 1.4.11 non-text / 1.4.3 large text
      aa: ratio >= 4.5,         // 1.4.3 AA normal text
      aaa: ratio >= 7           // 1.4.6 AAA normal text
    };
  };

  window.LuminaHex = function (r, g, b) {
    var h = function (v) { return ('0' + clamp(Math.round(v), 0, 255).toString(16)).slice(-2); };
    return '#' + h(r) + h(g) + h(b);
  };

  /* ---------------- sharpen ---------------- */

  /* Unsharp-mask convolution kernel: center = 1 + 4s, neighbors = -s.
     Sum stays 1 (no brightness shift); s is capped below 1 to limit ringing. */
  window.LuminaSharpenKernel = function (sharpenPercent) {
    var s = Math.min(1, Math.max(0, (sharpenPercent || 0) / 100)) * 0.75;
    var n = function (v) { return Number(v.toFixed(4)); };
    return [0, n(-s), 0, n(-s), n(1 + 4 * s), n(-s), 0, n(-s), 0].join(' ');
  };

  /* Idempotently create the shared <filter> (feConvolveMatrix) inside `mount`
     (a shadow root or document.body) and return its feConvolveMatrix node,
     so callers can rebuild the kernel when the strength changes. */
  window.LuminaSharpenFilter = {
    ensure: function (mount) {
      var SVG_NS = 'http://www.w3.org/2000/svg';
      var svg = mount.querySelector('#lumina-sharpen-svg');
      if (!svg) {
        svg = document.createElementNS(SVG_NS, 'svg');
        svg.id = 'lumina-sharpen-svg';
        svg.setAttribute('width', '0');
        svg.setAttribute('height', '0');
        svg.setAttribute('aria-hidden', 'true');
        svg.style.position = 'absolute';
        svg.style.left = '-9999px';
        var filter = document.createElementNS(SVG_NS, 'filter');
        filter.id = 'lumina-sharpen';
        filter.setAttribute('x', '0');
        filter.setAttribute('y', '0');
        filter.setAttribute('width', '100%');
        filter.setAttribute('height', '100%');
        filter.setAttribute('color-interpolation-filters', 'sRGB');
        var conv = document.createElementNS(SVG_NS, 'feConvolveMatrix');
        conv.setAttribute('order', '3');
        conv.setAttribute('preserveAlpha', 'true');
        conv.setAttribute('kernelMatrix', window.LuminaSharpenKernel(0));
        filter.appendChild(conv);
        svg.appendChild(filter);
        mount.appendChild(svg);
      }
      return svg.querySelector('feConvolveMatrix');
    }
  };
})();
