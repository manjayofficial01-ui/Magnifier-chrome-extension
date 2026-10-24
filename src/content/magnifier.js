/* Lumina Magnifier — content script.
   Renders a magnifying lens on a fixed overlay canvas at 60fps from a single
   frozen screenshot (captureVisibleTab is quota-limited to 2/sec, so panning,
   zooming and filtering are all done locally against that frame; a fresh frame
   is captured automatically ~600ms after scrolling stops). While a capture is
   in flight the overlay is hidden so it cannot photobomb the new frame.

   All UI lives inside a shadow root so page CSS can't touch it (and it can't
   touch the page). Exposes window.__luminaMagnifier for tests. */
(() => {
  'use strict';
  if (window.__luminaMagnifier) return;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const nextFrames = (n = 2) =>
    new Promise((r) => {
      const step = () => (--n <= 0 ? r() : requestAnimationFrame(step));
      requestAnimationFrame(step);
    });

  const state = {
    active: false,
    pinned: false,
    settings: null,
    // Raw global record as stored in sync, WITHOUT any per-site override merged in.
    // Keeping it separate is what stops a site override from leaking back into the
    // global defaults the next time any control is touched (see persistSettings).
    globalSettings: {},
    frame: null, // { img, w, h, scale, scrollX, scrollY }
    pointer: { x: Math.round(innerWidth / 2), y: Math.round(innerHeight / 2) },
    lens: { x: Math.round(innerWidth / 2), y: Math.round(innerHeight / 2) },
    ui: null,
    raf: 0,
    dirty: true,
    draws: 0,
    capturePending: false,
    recaptureWanted: false,
    recaptureTimer: 0,
    saveTimer: 0,
    drag: null,
    aim: null,
    bannerTimer: 0,
    sharpenConv: null,
    boostMorph: null,
    lastSharpen: -1,
    lastBoost: -1,
    dockW: 340,
    dockH: 42,
    // follow-target cache: recomputed on events and throttled in draw(), because
    // getBoundingClientRect() on every frame would thrash layout on heavy pages.
    followBox: null,
    followStamp: 0,
    siteKey: '',
    // Reading strip: what is on screen, and the throttle for re-extracting it.
    strip: null,
    stripAt: 0,
    stripKey: '',
    stripText: '',
    stripH: 0,
    // Read-aloud session. `utterId` invalidates callbacks queued by a cancelled
    // utterance; `index` is the sentence being spoken.
    read: { sentences: [], index: -1, utterId: 0, paused: false, active: false }
  };

  const sendToBg = (msg) => chrome.runtime.sendMessage(msg).catch(() => {});

  const siteKeyOf = (loc) => (loc && loc.hostname) ? loc.hostname : (location.hostname || location.origin || 'unknown');

  /* ---------------- settings ---------------- */

  async function loadStoredSettings() {
    let globalSettings = {};
    try {
      const res = await chrome.storage.sync.get('luminaSettings');
      globalSettings = (res && res.luminaSettings) || {};
    } catch (e) { /* unavailable — fall back to defaults */ }
    state.globalSettings = globalSettings;

    state.siteKey = siteKeyOf(location);
    if (globalSettings.perSite) {
      try {
        const loc = await chrome.storage.local.get('luminaSites');
        const map = (loc && loc.luminaSites) || {};
        const override = map[state.siteKey];
        if (override) globalSettings = Object.assign({}, globalSettings, override);
      } catch (e) { /* local storage unavailable — global settings still apply */ }
    }
    return window.LuminaNormalize(globalSettings);
  }

  /* Write the effective settings back.
     When per-site memory is ON the effective settings are site-specific, so they go
     to the site map ONLY — writing them to `luminaSettings` as well would overwrite
     the user's global defaults with whichever site they happened to be on. When it is
     OFF the effective settings *are* the global defaults. */
  function persistSettings() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
      const s = state.settings;
      if (!s) return;
      const store = chrome.storage && chrome.storage.sync;
      if (!store) return; // harness / preview mode

      const global = s.perSite
        ? Object.assign({}, state.globalSettings, { perSite: true })
        : Object.assign({}, s);
      state.globalSettings = global;
      try { store.set({ luminaSettings: global }).catch(() => {}); } catch (e) { /* quota */ }

      if (!s.perSite) return;
      const local = chrome.storage && chrome.storage.local;
      if (!local) return;
      // The site map can outgrow the 8KB per-item sync quota, so it lives in local storage.
      local.get('luminaSites').then((res) => {
        const map = (res && res.luminaSites) || {};
        const ov = {};
        for (const k of window.LuminaSiteKeys) ov[k] = s[k];
        map[state.siteKey] = ov;
        local.set({ luminaSites: map }).catch(() => {});
      }).catch(() => {});
    }, 150);
  }

  /* ---------------- UI (shadow DOM) ---------------- */

  const UI_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .host {
      position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;
      font-family: "Segoe UI Variable Text", "Segoe UI", Inter, system-ui, -apple-system, sans-serif;
    }
    canvas.lens { position: fixed; inset: 0; width: 100vw; height: 100vh; display: block; }
    .toolbar {
      position: fixed; left: 0; top: 0; display: flex; align-items: center; gap: 2px;
      padding: 5px; border-radius: 22px;
      /* 22px == a pill for the one-row case (half of the 40px height) and a clean
         rounded rect when the row wraps on a narrow viewport, instead of a broken
         pill with clipped ends. */
      flex-wrap: wrap; justify-content: center;
      /* width: max-content is required: with flex-wrap and an auto width a fixed
         element shrink-to-fits down to its widest single item and collapses into a
         column. max-content asks for the one-row width, then max-width clamps it so
         the row wraps only when it genuinely cannot fit. */
      width: max-content;
      max-width: calc(100vw - 16px);
      background: rgba(13, 15, 24, 0.82);
      border: 1px solid rgba(255, 255, 255, 0.12);
      box-shadow: 0 10px 32px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.08);
      -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
      opacity: 0; pointer-events: none; user-select: none;
      transition: opacity .18s ease, transform .2s cubic-bezier(.2, .9, .3, 1.15);
      transform: translate(-50%, 6px) scale(.94);
    }
    .toolbar.show { opacity: 1; pointer-events: auto; transform: translate(-50%, 0) scale(1); }
    .toolbar.above.show { transform: translate(-50%, -100%) scale(1); }
    .toolbar button {
      all: unset; width: 30px; height: 30px; border-radius: 999px; cursor: pointer;
      display: grid; place-items: center; color: #C9D1E8;
      transition: background .15s ease, color .15s ease, transform .1s ease;
    }
    .toolbar button:hover { background: rgba(255, 255, 255, 0.09); color: #fff; }
    .toolbar button:active { transform: scale(.9); }
    /* all:unset strips the UA focus ring — WCAG 2.4.7 needs an explicit one. */
    .toolbar button:focus-visible { outline: 2px solid #8B9CF9; outline-offset: 2px; }
    .toolbar button.on {
      color: #fff; background: linear-gradient(135deg, #6366F1, #A855F7);
      box-shadow: 0 2px 10px rgba(124, 92, 246, 0.45);
    }
    .toolbar svg { width: 16px; height: 16px; display: block; }
    .zoom-label {
      min-width: 52px; text-align: center; font-size: 12px; font-weight: 600;
      color: #EDEFFB; letter-spacing: .02em; font-variant-numeric: tabular-nums; padding: 0 2px;
    }
    .sep { width: 1px; height: 18px; background: rgba(255, 255, 255, 0.14); margin: 0 4px; }
    .banner {
      position: fixed; top: 18px; left: 50%; transform: translateX(-50%) translateY(-6px);
      padding: 9px 16px; border-radius: 12px; max-width: 460px;
      background: rgba(13, 15, 24, 0.92); border: 1px solid rgba(255, 255, 255, 0.14);
      color: #EDEFFB; font-size: 13px; line-height: 1.4; text-align: center;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
      opacity: 0; transition: opacity .2s ease, transform .2s ease; pointer-events: none;
    }
    .banner.show { opacity: 1; transform: translateX(-50%) translateY(0); }
    .swatch {
      position: fixed; left: 50%; transform: translateX(-50%) translateY(6px);
      display: none; align-items: center; gap: 10px; padding: 7px 10px;
      border-radius: 12px; background: rgba(13, 15, 24, 0.92);
      border: 1px solid rgba(255, 255, 255, 0.14); color: #EDEFFB;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5); opacity: 0;
      transition: opacity .18s ease, transform .18s ease;
    }
    .swatch.show { display: flex; opacity: 1; transform: translateX(-50%) translateY(0); }
    .swatch .dot {
      width: 26px; height: 26px; border-radius: 8px; flex: none;
      border: 1px solid rgba(255, 255, 255, 0.3);
    }
    .swatch .hex { font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: .02em; }
    .swatch .meta { font-size: 11px; color: #9aa3b8; line-height: 1.35; }
    .swatch .meta b { color: #a7f3d0; font-weight: 700; }
    .swatch .meta i { color: #fecaca; font-style: normal; font-weight: 700; }
    .swatch button {
      all: unset; padding: 5px 10px; border-radius: 8px; cursor: pointer;
      background: rgba(255, 255, 255, 0.08); color: #EDEFFB;
      font-size: 11.5px; font-weight: 600; font-family: inherit;
    }
    .swatch button:hover { background: rgba(255, 255, 255, 0.16); }
    .swatch button:focus-visible { outline: 2px solid #8B9CF9; outline-offset: 2px; }
    /* ---- reading strip: the text under the lens, reflowed and readable ---- */
    .strip {
      position: fixed; left: 50%; bottom: 16px; width: min(780px, calc(100vw - 32px));
      max-height: min(46vh, 420px); display: none; flex-direction: column;
      border-radius: 16px; overflow: hidden; pointer-events: auto;
      background: var(--strip-bg, #fffdf7); color: var(--strip-fg, #201a10);
      border: 1px solid rgba(128, 128, 128, 0.28);
      box-shadow: 0 18px 52px rgba(0, 0, 0, 0.55);
      transform: translateX(-50%) translateY(10px); opacity: 0;
      transition: opacity .18s ease, transform .2s cubic-bezier(.2, .9, .3, 1.15);
      font-size: var(--strip-size, 22px); line-height: var(--strip-line, 1.6);
      font-family: "Segoe UI Variable Text", "Segoe UI", Inter, system-ui, -apple-system, sans-serif;
    }
    .strip.show { display: flex; opacity: 1; transform: translateX(-50%) translateY(0); }
    .strip .bar {
      display: flex; align-items: center; gap: 6px; flex: none;
      padding: 7px 10px; border-bottom: 1px solid var(--strip-rule, rgba(0,0,0,.14));
      font-size: 12px; font-weight: 600;
    }
    .strip .bar .who { flex: 1; min-width: 0; opacity: .72; font-size: 11.5px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .strip .bar button {
      all: unset; cursor: pointer; padding: 4px 9px; border-radius: 8px;
      font-size: 11.5px; font-weight: 600; font-family: inherit;
      background: rgba(128, 128, 128, 0.16); color: inherit;
      transition: background .15s ease;
    }
    .strip .bar button:hover { background: rgba(128, 128, 128, 0.3); }
    .strip .bar button:focus-visible { outline: 2px solid #8B9CF9; outline-offset: 2px; }
    .strip .bar .size { min-width: 26px; text-align: center; font-variant-numeric: tabular-nums; }
    .strip .body { overflow-y: auto; padding: 14px 20px 18px; overscroll-behavior: contain; }
    .strip .body:focus-visible { outline: 2px solid #8B9CF9; outline-offset: -3px; }
    .strip .s { border-radius: 5px; }
    .strip .s.active { background: rgba(250, 204, 21, 0.42); box-shadow: 0 0 0 3px rgba(250, 204, 21, 0.42); }
    .strip .empty { opacity: .6; font-size: 14px; line-height: 1.5; }
    /* Narrow viewports: shrink the controls so the whole row still fits without
       wrapping, and drop the purely decorative separators. */
    @media (max-width: 620px) {
      .toolbar { gap: 0; padding: 4px; }
      .toolbar button { width: 26px; height: 26px; }
      .toolbar svg { width: 14px; height: 14px; }
      .toolbar .sep { display: none; }
      .zoom-label { min-width: 42px; font-size: 11px; }
      .strip { font-size: min(var(--strip-size, 22px), 19px); }
      .strip .bar .who { display: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      * { transition-duration: 0.01ms !important; }
    }
  `;

  const ICONS = {
    circle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="7"/></svg>',
    square: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>',
    rounded: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="5.5" y="5.5" width="13" height="13" rx="5.5"/></svg>',
    rectangle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3.5" y="7.5" width="17" height="9" rx="2.5"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v4h-4"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    // Pixel grid — the "crisp / pixel-perfect" toggle.
    crisp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/></svg>',
    // Eyedropper.
    color: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M18.5 3.5a2.1 2.1 0 0 1 3 3L13 15l-4 1 1-4z"/><path d="M10.5 16.5 4 19l2.5-6.5"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2.2"/><path d="M5.5 15H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v.5"/></svg>',
    speak: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3L12 5v14l-5-4.5H4z"/><path d="M16.5 9a4 4 0 0 1 0 6"/><path d="M19 6.5a8 8 0 0 1 0 11"/></svg>',
    // Reading guide — a clear band with the rest of the page dimmed.
    guide: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3 6h18M3 18h18"/><rect x="3" y="9.5" width="18" height="5" rx="1.5"/></svg>',
    // Reflowed reading strip.
    strip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M6.5 9.5h11M6.5 12.5h11M6.5 15.5h6"/></svg>',
    // Bold text (stroke thickening).
    bold: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 5h6.2a3.6 3.6 0 0 1 0 7.2H7z"/><path d="M7 12.2h7a3.7 3.7 0 0 1 0 7.4H7z"/></svg>'
  };

  function buildUI() {
    const host = document.createElement('div');
    host.className = 'lumina-host';
    const root = host.attachShadow({ mode: 'open' });

    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(UI_CSS);
      root.adoptedStyleSheets = [sheet];
    } catch (e) {
      const style = document.createElement('style');
      style.textContent = UI_CSS;
      root.appendChild(style);
    }

    const canvas = document.createElement('canvas');
    canvas.className = 'lens';

    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Magnifier controls');
    toolbar.innerHTML =
      '<button data-act="zoomout" aria-label="Zoom out" title="Zoom out (Alt+-)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 12h12"/></svg></button>' +
      '<span class="zoom-label" aria-hidden="true">200%</span>' +
      '<button data-act="zoomin" aria-label="Zoom in" title="Zoom in (Alt+=)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 6v12M6 12h12"/></svg></button>' +
      '<i class="sep" aria-hidden="true"></i>' +
      '<button data-act="shape" aria-label="Change lens shape" title="Change shape (Alt+S)">' + ICONS.circle + '</button>' +
      '<button data-act="crisp" aria-label="Pixel-perfect mode" title="Pixel-perfect: no smoothing, whole-step zoom (Alt+X)">' + ICONS.crisp + '</button>' +
      '<button data-act="bold" aria-label="Bold text" title="Thicken strokes — rescues faint print (Alt+B)">' + ICONS.bold + '</button>' +
      '<button data-act="guide" aria-label="Reading guide" title="Reading guide: dim the page except one band (Alt+L)">' + ICONS.guide + '</button>' +
      '<button data-act="strip" aria-label="Reading strip" title="Reading strip: reflow the text under the lens (Alt+T)">' + ICONS.strip + '</button>' +
      '<button data-act="color" aria-label="Pick colour under the lens" title="Pick colour + contrast (Alt+G)">' + ICONS.color + '</button>' +
      '<button data-act="copy" aria-label="Copy text under the lens" title="Copy text under the lens (Alt+C)">' + ICONS.copy + '</button>' +
      '<button data-act="speak" aria-label="Read text aloud" title="Read text under the lens aloud (Alt+V)">' + ICONS.speak + '</button>' +
      '<i class="sep" aria-hidden="true"></i>' +
      '<button data-act="refresh" aria-label="Recapture page" title="Recapture page (Alt+R)">' + ICONS.refresh + '</button>' +
      '<button data-act="pin" aria-label="Pin lens in place" title="Pin lens in place (Alt+P)">' + ICONS.pin + '</button>' +
      '<button data-act="close" aria-label="Close magnifier" title="Close (Esc)">' + ICONS.close + '</button>';

    const banner = document.createElement('div');
    banner.className = 'banner';
    banner.setAttribute('role', 'status');

    const swatch = document.createElement('div');
    swatch.className = 'swatch';
    swatch.innerHTML =
      '<span class="dot"></span>' +
      '<span><span class="hex">#000000</span><span class="meta"></span></span>' +
      '<button data-act="swatch-copy">Copy</button>';

    const strip = document.createElement('section');
    strip.className = 'strip';
    strip.setAttribute('role', 'region');
    strip.setAttribute('aria-label', 'Reading strip — text under the lens');
    strip.innerHTML =
      '<div class="bar">' +
      '<button data-act="strip-speak" title="Read this text aloud (Alt+V)">Read</button>' +
      '<button data-act="strip-prev" title="Previous sentence (Alt+J)">◀</button>' +
      '<button data-act="strip-next" title="Next sentence (Alt+K)">▶</button>' +
      '<button data-act="strip-copy" title="Copy this text (Alt+C)">Copy</button>' +
      '<span class="who"></span>' +
      '<button data-act="strip-smaller" aria-label="Smaller text" title="Smaller text">A−</button>' +
      '<button data-act="strip-bigger" aria-label="Bigger text" title="Bigger text">A+</button>' +
      '<button data-act="strip-close" aria-label="Close reading strip" title="Close (Alt+T)">✕</button>' +
      '</div>' +
      '<div class="body" tabindex="0"></div>';

    root.appendChild(canvas);
    root.appendChild(toolbar);
    root.appendChild(banner);
    root.appendChild(swatch);
    root.appendChild(strip);
    (document.documentElement || document.body).appendChild(host);

    const ui = { host, root, canvas, ctx: canvas.getContext('2d'), toolbar, banner, swatch, strip, stripBody: strip.querySelector('.body') };
    toolbar.addEventListener('click', onToolbarClick);
    swatch.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="swatch-copy"]')) copyText(state.lastHex || '');
    });
    strip.addEventListener('click', onStripClick);
    // buildFilter() reads the nodes off `state`, not `ui` — the filter elements live in
    // this shadow root because canvas url(#id) only resolves within the element's own
    // tree scope, and a reference to a missing filter kills the whole filter list.
    state.sharpenConv = window.LuminaSharpenFilter.ensure(root);
    state.boostMorph = window.LuminaBoostFilter.ensure(root);
    state.lastSharpen = -1;
    state.lastBoost = -1;
    return ui;
  }

  function showBanner(text, ms) {
    const ui = state.ui;
    if (!ui) return;
    ui.banner.textContent = text;
    ui.banner.classList.add('show');
    clearTimeout(state.bannerTimer);
    state.bannerTimer = setTimeout(() => ui.banner.classList.remove('show'), ms || 2800);
  }

  function updateToolbar() {
    const ui = state.ui;
    if (!ui) return;
    const s = state.settings;
    ui.toolbar.querySelector('.zoom-label').textContent = Math.round(effectiveZoom() * 100) + '%';
    ui.toolbar.querySelector('[data-act="shape"]').innerHTML = ICONS[s.shape];
    ui.toolbar.querySelector('[data-act="pin"]').classList.toggle('on', state.pinned);
    ui.toolbar.querySelector('[data-act="crisp"]').classList.toggle('on', !!s.pixelPerfect);
    ui.toolbar.querySelector('[data-act="bold"]').classList.toggle('on', s.textBoost > 0);
    ui.toolbar.querySelector('[data-act="guide"]').classList.toggle('on', !!s.guide);
    ui.toolbar.querySelector('[data-act="strip"]').classList.toggle('on', !!s.readingStrip);
    ui.toolbar.querySelector('[data-act="speak"]').classList.toggle('on', state.read.active);
  }

  function measureToolbar() {
    const tb = state.ui && state.ui.toolbar;
    if (!tb) return;
    state.dockW = tb.offsetWidth || 340;
    state.dockH = tb.offsetHeight || 42;
  }

  // Space a bottom-edge panel steals from the viewport, so the lens can never sit
  // underneath it and hide the text you are trying to read. In dock view the lens *is*
  // a full-width band and the toolbar moves to the opposite edge, so nothing is stolen;
  // the reading strip, however, is a real bottom panel and must reserve its own height.
  function dockReserve() {
    if (state.pinned) return 0;
    if (state.settings.readingStrip) return (state.stripH || 0) + 16;
    return state.settings.dock !== 'off' ? 0 : state.dockH + 16;
  }

  // Unpinned the lens tracks the cursor, so a lens-anchored toolbar would sit a constant
  // distance from the pointer and could never be hovered — it docks instead. Pinning freezes
  // the lens, which makes an under-lens toolbar reachable, so it re-anchors there.
  function positionToolbar(rect) {
    const tb = state.ui.toolbar;
    const s = state.settings;
    let top, cx;

    if (s.readingStrip) {
      // The strip owns the bottom edge — the controls move out of its way.
      tb.classList.remove('above');
      top = 16;
      cx = innerWidth / 2;
    } else if (s.dock !== 'off') {
      // Band occupies one edge — park the controls on the other one.
      tb.classList.remove('above');
      top = s.dock === 'top' ? innerHeight - state.dockH - 16 : 16;
      cx = innerWidth / 2;
    } else if (!state.pinned) {
      tb.classList.remove('above');
      top = innerHeight - state.dockH - 16;
      cx = innerWidth / 2;
    } else {
      const below = rect.y + rect.h + 14 + state.dockH < innerHeight - 6;
      tb.classList.toggle('above', !below);
      top = below ? rect.y + rect.h + 14 : rect.y - 14;
      cx = rect.x + rect.w / 2;
    }

    // A toolbar wider than the viewport would otherwise be clamped off-screen entirely;
    // when that happens, centre it and let it overhang symmetrically instead.
    const half = Math.min(state.dockW / 2 + 8, innerWidth / 2);
    tb.style.left = Math.round(clamp(cx, half, innerWidth - half)) + 'px';
    tb.style.top = Math.round(top) + 'px';

    state.toolbarTop = top;
    // Keep the colour readout clear of both the toolbar and the reading strip.
    const bottom = s.readingStrip
      ? 16 + (state.stripH || 0) + 10
      : Math.max(8, innerHeight - top + 10);
    state.ui.swatch.style.bottom = Math.round(Math.min(bottom, innerHeight - 90)) + 'px';
  }

  /* ---------------- follow targets ---------------- */

  /* Where is the caret / keyboard focus right now? Returns viewport CSS px.
     Throttled by the caller — getBoundingClientRect() forces layout. */
  function focusPoint() {
    const mode = state.settings.follow;
    if (mode === 'pointer') return null;

    let rect = null;

    if (mode === 'caret') {
      const sel = window.getSelection && window.getSelection();
      if (sel && sel.rangeCount) {
        const r = sel.getRangeAt(0);
        let box = r.getBoundingClientRect();
        if (!box || (!box.width && !box.height)) {
          const rects = r.getClientRects();
          if (rects && rects.length) box = rects[rects.length - 1];
        }
        if (box && (box.width || box.height)) rect = box;
      }
    }

    if (!rect) {
      const el = document.activeElement;
      if (el && el !== document.body && el.getBoundingClientRect) {
        const box = el.getBoundingClientRect();
        if (box && (box.width || box.height)) rect = box;
      }
    }

    if (!rect) return null;
    return {
      x: clamp(rect.left + rect.width / 2, 0, innerWidth),
      y: clamp(rect.top + rect.height / 2, 0, innerHeight),
      box: rect
    };
  }

  function refreshFollowBox(force) {
    if (state.settings.follow === 'pointer') { state.followBox = null; return null; }
    const now = performance.now();
    if (!force && state.followBox && now - state.followStamp < 90) return state.followBox;
    const p = focusPoint();
    state.followBox = p;
    state.followStamp = now;
    return p;
  }

  // A follow target that has scrolled out of view is useless — bring it back, the way
  // platform magnifiers do, then let the recapture settle.
  function ensureFollowVisible(p) {
    const el = document.activeElement;
    if (!p || !el || el === document.body || !el.scrollIntoView) return;
    const b = p.box;
    if (b.bottom < 0 || b.top > innerHeight || b.right < 0 || b.left > innerWidth) {
      try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) { /* older signature */ }
    }
  }

  /* The point the lens magnifies. Independent of where the lens is drawn, which is what
     lets the lens step aside instead of covering what you are reading (WCAG 2.4.11). */
  function samplePoint() {
    if (state.pinned) return { x: state.lens.x, y: state.lens.y, box: null };
    const p = refreshFollowBox(false);
    if (p) return p;
    return { x: state.pointer.x, y: state.pointer.y, box: null };
  }

  /* ---------------- lens geometry ---------------- */

  function effectiveZoom() {
    const s = state.settings;
    if (s.pixelPerfect) {
      // Nearest-neighbour upscaling only looks right at whole multiples; anything else
      // produces uneven pixel doubling, so snap and report the value actually used.
      return Math.max(1, Math.round(s.zoom / 100));
    }
    return s.zoom / 100;
  }

  /* Lens rectangle in viewport CSS px. `sp` is the sample point (what to magnify); the
     returned box is where the magnified content is painted, which is deliberately not
     always centred on `sp`. */
  function lensRect(sp) {
    const s = state.settings;

    if (s.dock !== 'off') {
      const maxH = Math.max(80, Math.round(innerHeight * 0.45));
      const bh = clamp(Math.round(s.lensHeight > 0 ? s.lensHeight : s.lensSize), 60, maxH);
      // Keep the (unpinned) sample point in sync so pinning later freezes what is on screen.
      if (!state.pinned) state.lens = { x: sp.x, y: sp.y };
      return {
        x: 0,
        y: s.dock === 'top' ? 0 : innerHeight - bh,
        w: innerWidth,
        h: bh,
        docked: true
      };
    }

    // Effective lens dimensions. The requested size is a wish: a lens at or beyond the
    // viewport size cannot track the pointer (draw() would have to centre it), so the whole
    // shape is scaled down proportionally to leave a margin instead.
    const want = window.LuminaLensDims(s);
    const availW = innerWidth - 32;
    const availH = innerHeight - 32 - dockReserve();
    const k = Math.min(1, availW / want.w, availH / want.h);
    const w = k < 1 ? Math.max(48, Math.round(want.w * k)) : want.w;
    const h = k < 1 ? Math.max(48, Math.round(want.h * k)) : want.h;

    let cx = sp.x, cy = sp.y;
    if (state.pinned) { cx = state.lens.x; cy = state.lens.y; }

    cx = clamp(cx, w / 2 + 6, Math.max(w / 2 + 6, innerWidth - w / 2 - 6));
    cy = clamp(cy, h / 2 + 6, Math.max(h / 2 + 6, innerHeight - h / 2 - 6 - dockReserve()));

    // Follow-focus: keep the focused target on screen (WCAG 2.2 SC 2.4.11 Focus Not
    // Obscured) by parking the lens beside the target rather than on top of it.
    if (!state.pinned && s.follow === 'focus' && sp.box) {
      const gap = 14;
      const below = sp.box.bottom + gap + h < innerHeight - 6;
      const above = !below && sp.box.top - gap - h > 6;
      if (below) cy = clamp(sp.box.bottom + gap + h / 2, h / 2 + 6, innerHeight - h / 2 - 6 - dockReserve());
      else if (above) cy = clamp(sp.box.top - gap - h / 2, h / 2 + 6, innerHeight - h / 2 - 6 - dockReserve());
      else cx = sp.box.right + gap + w < innerWidth - 6
        ? clamp(sp.box.right + gap + w / 2, w / 2 + 6, innerWidth - w / 2 - 6)
        : clamp(sp.box.left - gap - w / 2, w / 2 + 6, innerWidth - w / 2 - 6);
    }

    if (!state.pinned) state.lens = { x: cx, y: cy };
    return { x: cx - w / 2, y: cy - h / 2, w: w, h: h, docked: false };
  }

  function lensPath(x, y, w, h, shape) {
    const p = new Path2D();
    if (shape === 'band') {
      p.rect(x, y, w, h);
    } else if (shape === 'circle') {
      p.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
    } else {
      const r = shape === 'square' ? 10 : shape === 'rounded' ? Math.min(w, h) * 0.24 : 14;
      if (r > 0 && p.roundRect) p.roundRect(x, y, w, h, r);
      else p.rect(x, y, w, h);
    }
    return p;
  }

  function hitLens(x, y) {
    if (state.settings.dock !== 'off') return false;
    const r = lensRect(samplePoint());
    if (state.settings.shape === 'circle') {
      const dx = x - (r.x + r.w / 2), dy = y - (r.y + r.h / 2);
      return dx * dx + dy * dy <= (r.w / 2) * (r.w / 2);
    }
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  /* ---------------- rendering ---------------- */

  function resizeCanvas() {
    const ui = state.ui;
    if (!ui) return;
    const dpr = devicePixelRatio || 1;
    ui.canvas.width = Math.max(1, Math.round(innerWidth * dpr));
    ui.canvas.height = Math.max(1, Math.round(innerHeight * dpr));
    ui.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function buildFilter(s) {
    // Keep the filter's radius in sync with the setting even when it drops to 0, so the
    // DOM never disagrees with what the user chose (a reset used to leave the old radius
    // behind and only look right because the reference was dropped from the string).
    if (state.boostMorph && state.lastBoost !== s.textBoost) {
      state.boostMorph.setAttribute('radius', String(window.LuminaBoostRadius(s.textBoost)));
      state.lastBoost = s.textBoost;
    }
    const boost = s.textBoost > 0 && !!state.boostMorph;
    let f = window.LuminaFilterString(s, { boost });
    if (s.sharpen > 0 && state.sharpenConv) {
      if (state.lastSharpen !== s.sharpen) {
        state.sharpenConv.setAttribute('kernelMatrix', window.LuminaSharpenKernel(s.sharpen));
        state.lastSharpen = s.sharpen;
      }
      f += ' url(#lumina-sharpen)';
    }
    return f;
  }

  /* Reading guide: everything except a horizontal band at the sample point is dimmed.
     Drawn under the lens so the band reads as a window onto the page. */
  function drawGuide(sp) {
    const s = state.settings;
    if (!s.guide || s.dock !== 'off') return;
    const ctx = state.ui.ctx;
    const w = innerWidth, h = innerHeight;
    const bandH = clamp(Math.round(s.guideHeight), window.LuminaBounds.guideHeightMin, Math.max(60, h - 24));
    const cy = clamp(sp.y, bandH / 2 + 4, Math.max(bandH / 2 + 4, h - bandH / 2 - 4));
    const by = cy - bandH / 2;

    const p = new Path2D();
    p.rect(0, 0, w, h);
    if (p.roundRect) p.roundRect(0, by, w, bandH, 10);
    else p.rect(0, by, w, bandH);

    ctx.save();
    ctx.fillStyle = 'rgba(6, 8, 14, ' + (s.guideDim / 100) + ')';
    // evenodd punches the band out of the full-viewport rectangle in one fill.
    ctx.fill(p, 'evenodd');
    // A hairline on each edge so the band reads as a guide and not a rendering glitch.
    ctx.strokeStyle = 'rgba(139, 156, 249, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, by + 0.5); ctx.lineTo(w, by + 0.5);
    ctx.moveTo(0, by + bandH - 0.5); ctx.lineTo(w, by + bandH - 0.5);
    ctx.stroke();
    ctx.restore();
  }

  function draw() {
    const ui = state.ui;
    if (!ui) return;
    state.draws++;
    const ctx = ui.ctx;
    const w = innerWidth, h = innerHeight;
    const s = state.settings;
    ctx.clearRect(0, 0, w, h);

    const sp = samplePoint();
    const rect = lensRect(sp);

    drawGuide(sp);

    if (!state.frame) {
      const p = lensPath(rect.x, rect.y, rect.w, rect.h, s.dock !== 'off' ? 'band' : s.shape);
      ctx.save();
      ctx.strokeStyle = 'rgba(139, 124, 255, 0.9)';
      ctx.lineWidth = 2;
      ctx.stroke(p);
      ctx.fillStyle = 'rgba(237, 239, 251, 0.92)';
      ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Preparing magnifier…', rect.x + rect.w / 2, rect.y + rect.h / 2 + 4);
      ctx.restore();
      positionToolbar(rect);
      return;
    }

    const f = state.frame;
    // Scroll compensation: content under the cursor moved by (scroll - captured scroll)
    // in the frozen frame, so sample that far past the pointer.
    const compX = scrollX - f.scrollX;
    const compY = scrollY - f.scrollY;
    const zoom = effectiveZoom();

    const srcW = rect.w * f.scale / zoom;
    const srcH = rect.h * f.scale / zoom;
    const wantX = (sp.x + compX) * f.scale - srcW / 2;
    const wantY = (sp.y + compY) * f.scale - srcH / 2;

    // Clamp the sample window into the frame ("edge pull" instead of blank gaps).
    let srcXf = clamp(wantX, 0, Math.max(0, f.w - srcW));
    let srcYf = clamp(wantY, 0, Math.max(0, f.h - srcH));

    // Where the true sample point lands inside the (possibly clamped) window, mapped into
    // lens space. The lens centre is *not* this point near a screen edge — off by up to
    // half the lens — so this is what the crosshair has to mark.
    const aimX = clamp(rect.x + ((wantX + srcW / 2 - srcXf) / srcW) * rect.w, rect.x, rect.x + rect.w);
    const aimY = clamp(rect.y + ((wantY + srcH / 2 - srcYf) / srcH) * rect.h, rect.y, rect.y + rect.h);
    state.aim = { x: aimX, y: aimY, rect };

    const path = lensPath(rect.x, rect.y, rect.w, rect.h, s.dock !== 'off' ? 'band' : s.shape);

    if (!rect.docked) {
      // Drop shadow.
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = 30;
      ctx.shadowOffsetY = 12;
      ctx.fillStyle = 'rgba(0, 0, 0, 1)';
      ctx.fill(path);
      ctx.restore();
    }

    // Magnified content.
    if (s.pixelPerfect) {
      // Snap source and destination to whole pixels: a half-pixel source offset is the
      // single biggest cause of mush when upscaling a screenshot.
      srcXf = Math.round(srcXf);
      srcYf = Math.round(srcYf);
      ctx.imageSmoothingEnabled = false;
    } else {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    }

    ctx.save();
    ctx.clip(path);
    ctx.filter = buildFilter(s);
    ctx.drawImage(
      f.img,
      srcXf, srcYf, Math.max(1, srcW), Math.max(1, srcH),
      Math.round(rect.x), Math.round(rect.y), rect.w, rect.h
    );
    ctx.filter = 'none';

    if (!rect.docked) {
      // Subtle inner vignette for depth.
      const vg = ctx.createRadialGradient(
        rect.x + rect.w / 2, rect.y + rect.h / 2, Math.min(rect.w, rect.h) * 0.35,
        rect.x + rect.w / 2, rect.y + rect.h / 2, Math.max(rect.w, rect.h) * 0.62
      );
      vg.addColorStop(0, 'rgba(10, 12, 18, 0)');
      vg.addColorStop(1, 'rgba(10, 12, 18, 0.22)');
      ctx.fillStyle = vg;
      ctx.fill(path);
    }
    ctx.restore();

    // Accent rim + glow.
    ctx.save();
    const grad = ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
    grad.addColorStop(0, '#8B9CF9');
    grad.addColorStop(0.55, '#C084FC');
    grad.addColorStop(1, '#67E8F9');
    ctx.shadowColor = rect.docked ? 'transparent' : 'rgba(124, 92, 246, 0.55)';
    ctx.shadowBlur = rect.docked ? 0 : 16;
    ctx.strokeStyle = grad;
    ctx.lineWidth = rect.docked ? 3 : 2;
    ctx.stroke(path);
    ctx.restore();

    if (s.crosshair) {
      ctx.save();
      ctx.clip(path);
      ctx.translate(aimX, aimY);
      for (const pass of [[3, 'rgba(10, 12, 18, 0.85)'], [1.4, '#E0E7FF']]) {
        ctx.strokeStyle = pass[1];
        ctx.lineWidth = pass[0];
        ctx.beginPath();
        ctx.moveTo(-11, 0); ctx.lineTo(-4, 0);
        ctx.moveTo(4, 0); ctx.lineTo(11, 0);
        ctx.moveTo(0, -11); ctx.lineTo(0, -4);
        ctx.moveTo(0, 4); ctx.lineTo(0, 11);
        ctx.stroke();
      }
      ctx.restore();
    }

    // In dock view, mark the band so it reads as a magnifier strip and not a page artefact.
    if (rect.docked) {
      ctx.save();
      ctx.fillStyle = 'rgba(13, 15, 24, 0.55)';
      ctx.fillRect(0, rect.docked === true && s.dock === 'top' ? rect.h - 2 : rect.y, innerWidth, 2);
      ctx.restore();
    }

    positionToolbar(rect);
    maybeRefreshStrip(false);
  }

  /* Draw on demand instead of repainting the whole viewport 60 times a second forever.
     The old unconditional rAF loop kept a 4K canvas compositing even with a still
     pointer and nothing to show, which is a measurable battery cost for a tool people
     leave running while they read. Every input that changes the picture calls this. */
  function requestDraw() {
    if (!state.active) return;
    state.dirty = true;
    if (state.raf) return;
    state.raf = requestAnimationFrame(() => {
      state.raf = 0;
      if (!state.dirty) return;
      state.dirty = false;
      draw();
    });
  }

  function cancelDraw() {
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
  }

  /* ---------------- capture ---------------- */

  async function requestCapture(initial) {
    if (!state.active) return;
    if (state.capturePending) {
      // A capture is already in flight (captureVisibleTab is throttled to 2/sec). Queue
      // one more instead of dropping it: returning early here left the lens showing a
      // stale frame until the user happened to scroll a second time.
      state.recaptureWanted = true;
      return;
    }
    state.capturePending = true;
    clearTimeout(state.recaptureTimer);

    const ui = state.ui;
    const hadFrame = !!state.frame;
    // Read the scroll offset NOW, before the round trip. The capture is queued in the
    // service worker and can wait ~550 ms; reading scrollX at decode time recorded
    // wherever the page had drifted to by then, so the lens sampled the wrong pixels —
    // visible as magnified content sliding away from the pointer after a scroll.
    const shotScrollX = scrollX;
    const shotScrollY = scrollY;

    if (ui) {
      // Hide the *whole* overlay — the banner and the colour readout are separate
      // elements and would otherwise be baked into the new screenshot.
      ui.host.style.visibility = 'hidden';
      ui.toolbar.classList.remove('show');
      ui.swatch.classList.remove('show');
      if (hadFrame) await nextFrames(2);
    }

    let res = null;
    try {
      res = await chrome.runtime.sendMessage({ type: 'lumina:capture' });
    } catch (e) {
      res = { ok: false, error: String(e) };
    }

    if (ui) ui.host.style.visibility = '';
    state.capturePending = false;
    if (!state.active || !state.ui) return;

    if (!res || !res.ok) {
      if (hadFrame) ui.toolbar.classList.add('show');
      if (initial) showBanner('Could not capture this page — try reloading it, then toggle the magnifier again.');
      flushRecapture();
      return;
    }

    const img = new Image();
    img.decoding = 'async';
    await new Promise((resolve) => {
      img.onload = () => {
        // The lens may have been closed while these bytes were decoding.
        if (!state.active || !state.ui) { resolve(); return; }
        const m = measureFrame(img.naturalWidth, img.naturalHeight);
        state.frame = {
          img,
          w: img.naturalWidth,
          h: img.naturalHeight,
          scale: m.scale,
          scrollX: shotScrollX,
          scrollY: shotScrollY
        };
        ui.toolbar.classList.add('show');
        if (initial) {
          state.lens = { x: state.pointer.x, y: state.pointer.y };
          if (state.settings.follow !== 'pointer') {
            const p = refreshFollowBox(true);
            if (p) { state.lens = { x: p.x, y: p.y }; ensureFollowVisible(p); }
          }
        }
        requestDraw();
        resolve();
      };
      // A decode failure is permanent for these exact bytes, so there is nothing to retry.
      img.onerror = () => {
        if (initial || !state.frame) showBanner('The captured page could not be displayed — press Alt+R to recapture.');
        resolve();
      };
      img.src = res.dataUrl;
    });
    flushRecapture();
  }

  /* A recapture that arrived while one was in flight gets serviced here, once, after
     the queue drains. Without this a scroll during the capture round trip was lost. */
  function flushRecapture() {
    if (!state.recaptureWanted) return;
    state.recaptureWanted = false;
    scheduleRecapture(140);
  }

  /* Chrome's tab capture has differed between versions on (a) whether the classic
     scrollbar is inside the bitmap and (b) whether the bitmap is at CSS or device
     resolution. Rather than assume, score every plausible pairing and keep the best —
     otherwise the lens drifts on scrolled pages and at devicePixelRatio > 1. */
  function measureFrame(pxW, pxH) {
    const dpr = devicePixelRatio || 1;
    const pairs = [
      [document.documentElement.clientWidth, document.documentElement.clientHeight],
      [innerWidth, innerHeight]
    ];
    let best = null;
    for (const [cssW, cssH] of pairs) {
      for (const scale of [dpr, 1]) {
        const err = Math.abs(pxW - cssW * scale) + Math.abs(pxH - cssH * scale);
        if (!best || err < best.err) best = { cssW, cssH, scale, err };
      }
    }
    return best || { cssW: innerWidth, cssH: innerHeight, scale: dpr, err: 0 };
  }

  function scheduleRecapture(delay) {
    clearTimeout(state.recaptureTimer);
    state.recaptureTimer = setTimeout(() => {
      if (state.active) requestCapture(false);
    }, delay == null ? 650 : delay);
  }

  /* ---------------- text & colour tools ---------------- */

  // Elements whose textContent is source code or metadata, not something a reader wants.
  const NON_TEXT_TAGS = /^(HTML|HEAD|BODY|SCRIPT|STYLE|NOSCRIPT|TEMPLATE|META|TITLE|LINK|SVG|CANVAS|IMG|VIDEO|AUDIO|IFRAME)$/;

  function usableTextElement(el) {
    if (!el || el.nodeType !== 1) return false;
    if (NON_TEXT_TAGS.test(el.tagName)) return false;
    // A caret query over non-rendered content (an image, empty space) can land on a node
    // inside <head>; anything without a client rect is not visible text.
    try { if (!el.getClientRects().length) return false; } catch (e) { return false; }
    return true;
  }

  /* Rendered text at an element, with source-code nodes stripped. */
  function visibleTextOf(el) {
    try {
      const clone = el.cloneNode(true);
      clone.querySelectorAll('script, style, noscript, template').forEach((n) => n.remove());
      return (clone.textContent || '').replace(/\s+/g, ' ').trim();
    } catch (e) {
      return ((el.textContent) || '').replace(/\s+/g, ' ').trim();
    }
  }

  /* Run `fn` with the overlay invisible. Needed for every hit-test: the lens canvas
     covers the viewport, so leaving it visible makes caretRangeFromPoint /
     elementsFromPoint resolve to the overlay instead of the page underneath. */
  function withOverlayHidden(fn) {
    const host = state.ui && state.ui.host;
    if (host) host.style.visibility = 'hidden';
    try { return fn(); }
    finally { if (host) host.style.visibility = ''; }
  }

  /* The element whose rendered text sits under `sp`, or null. */
  function textElementAt(sp) {
    let el = null;

    // Precise path: the caret hit-test resolves to the exact text node under the point.
    try {
      let node = null;
      if (document.caretRangeFromPoint) {
        const r = document.caretRangeFromPoint(sp.x, sp.y);
        node = r && r.startContainer;
      } else if (document.caretPositionFromPoint) {
        const p = document.caretPositionFromPoint(sp.x, sp.y);
        node = p && p.offsetNode;
      }
      const cand = node && (node.nodeType === 1 ? node : node.parentElement);
      if (usableTextElement(cand)) el = cand;
    } catch (e) { /* some nodes reject caret queries */ }

    // Fallback: deepest rendered element under the point.
    if (!el && document.elementsFromPoint) {
      for (const n of document.elementsFromPoint(sp.x, sp.y)) {
        if (usableTextElement(n)) { el = n; break; }
      }
    }
    return el;
  }

  function textUnderLens() {
    const sp = samplePoint();
    return withOverlayHidden(() => {
      const el = textElementAt(sp);
      return el ? visibleTextOf(el).slice(0, 5000) : '';
    });
  }

  /* The *block* of text under the lens, for the reading strip. A caret hit lands on an
     inline node — often a single <a> or <span> inside a sentence — so walk up until the
     subtree carries enough text to be worth reflowing. */
  function readingBlockAt(sp) {
    const el = textElementAt(sp);
    if (!el) return null;
    let node = el;
    let best = el;
    for (let i = 0; i < 10; i++) {
      if (!node || node === document.body || node === document.documentElement) break;
      best = node;
      if (visibleTextOf(node).length >= 60) break;
      node = node.parentElement;
    }
    return best;
  }

  /* ---------------- reading strip ---------------- */

  const BLOCK_TAGS = new Set([
    'P', 'LI', 'TD', 'TH', 'DD', 'DT', 'BLOCKQUOTE', 'FIGCAPTION', 'PRE',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'ARTICLE', 'SECTION', 'LABEL'
  ]);

  function stripExtract() {
    const sp = samplePoint();
    return withOverlayHidden(() => {
      let el = readingBlockAt(sp);
      // Prefer the nearest real block ancestor — a bare <div> wrapper can hold a whole
      // page and reflowing that is useless.
      let node = el;
      for (let i = 0; i < 6 && node; i++) {
        if (BLOCK_TAGS.has(node.tagName)) { el = node; break; }
        node = node.parentElement;
      }
      return el ? visibleTextOf(el).slice(0, 4000) : '';
    });
  }

  function hideStrip() {
    if (!state.ui) return;
    state.ui.strip.classList.remove('show');
    state.stripH = 0;
    state.stripKey = '';
    state.stripText = '';
    readStop(true);
  }

  function highlightActiveSentence() {
    const ui = state.ui;
    if (!ui) return;
    const nodes = ui.stripBody.querySelectorAll('.s');
    for (let i = 0; i < nodes.length; i++) {
      nodes[i].classList.toggle('active', state.read.active && i === state.read.index);
    }
    const act = ui.stripBody.querySelector('.s.active');
    if (act && act.scrollIntoView) {
      try { act.scrollIntoView({ block: 'nearest' }); } catch (e) { /* older signature */ }
    }
  }

  /* Repaint the panel from a block of text. Everything is inserted as text nodes —
     never as markup — because this content comes from an untrusted page. */
  function paintStrip(text) {
    const ui = state.ui;
    if (!ui) return;
    const s = state.settings;
    const theme = window.LuminaStripTheme(s.stripTheme, s.invert);

    ui.strip.style.setProperty('--strip-bg', theme.bg);
    ui.strip.style.setProperty('--strip-fg', theme.fg);
    ui.strip.style.setProperty('--strip-rule', theme.rule);
    ui.strip.style.setProperty('--strip-size', s.stripSize + 'px');
    ui.strip.style.setProperty('--strip-line', String(s.stripLine));

    const sentences = window.LuminaSentences(text);
    state.stripText = text;
    ui.stripBody.textContent = '';

    if (!sentences.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'No text under the lens. Move it over words rather than an image or empty space.';
      ui.stripBody.appendChild(p);
    } else {
      for (let i = 0; i < sentences.length; i++) {
        const span = document.createElement('span');
        span.className = 's';
        span.dataset.i = String(i);
        span.textContent = sentences[i] + ' ';
        ui.stripBody.appendChild(span);
      }
    }

    const who = ui.strip.querySelector('.who');
    who.textContent = sentences.length
      ? sentences.length + (sentences.length === 1 ? ' sentence' : ' sentences') + ' under the lens'
      : '';

    ui.strip.classList.add('show');
    const prevH = state.stripH;
    state.stripH = ui.strip.offsetHeight || 0;
    highlightActiveSentence();
    // The strip height drives the reserved band and the colour-readout offset, so a
    // change needs one more frame. The 240 ms throttle in maybeRefreshStrip stops this
    // from looping.
    if (Math.abs(state.stripH - prevH) > 2) requestDraw();
  }

  /* Re-extract at most ~4× a second, and only when the text actually changed —
     caretRangeFromPoint plus cloneNode on every animation frame would be wasteful. */
  function maybeRefreshStrip(force) {
    const ui = state.ui;
    if (!ui) return;
    if (!state.settings.readingStrip) {
      if (ui.strip.classList.contains('show')) hideStrip();
      return;
    }
    const now = performance.now();
    if (!force && now - state.stripAt < 240) return;
    state.stripAt = now;

    const text = stripExtract();
    const key = text.slice(0, 200) + '|' + text.length;
    if (!force && key === state.stripKey) return;
    state.stripKey = key;
    paintStrip(text);
  }

  function onStripClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const s = state.settings;
    const b = window.LuminaBounds;
    switch (btn.dataset.act) {
      case 'strip-speak':
        if (state.read.active) readStop();
        else readStart(state.stripText);
        break;
      case 'strip-next': readNext(); break;
      case 'strip-prev': readPrev(); break;
      case 'strip-copy': copyText(state.stripText); break;
      case 'strip-smaller':
        s.stripSize = clamp(s.stripSize - 2, b.stripSizeMin, b.stripSizeMax);
        persistSettings(); paintStrip(state.stripText); requestDraw();
        break;
      case 'strip-bigger':
        s.stripSize = clamp(s.stripSize + 2, b.stripSizeMin, b.stripSizeMax);
        persistSettings(); paintStrip(state.stripText); requestDraw();
        break;
      case 'strip-close':
        s.readingStrip = false;
        hideStrip();
        persistSettings(); updateToolbar(); requestDraw();
        break;
    }
  }

  /* ---------------- read aloud ----------------
     One utterance per sentence, so next/previous always makes progress and the strip
     can highlight what is being spoken — the dual-coding that makes a magnifier usable
     for low vision rather than merely larger. */

  function truncate(text, n) {
    return text.length > n ? text.slice(0, n - 1) + '…' : text;
  }

  function readStart(text) {
    const src = (text == null ? '' : text) || textUnderLens();
    if (!src) { showBanner('No text found under the lens.'); return; }
    if (!window.speechSynthesis) { showBanner('Text-to-speech is not available in this browser.'); return; }
    const sentences = window.LuminaSentences(src);
    if (!sentences.length) { showBanner('No text found under the lens.'); return; }

    state.read.active = true;
    state.read.paused = false;
    state.read.sentences = sentences;
    state.read.index = 0;
    speakIndex(0);
  }

  function speakIndex(i) {
    const r = state.read;
    if (!r.active || !r.sentences.length) return;
    r.index = clamp(i, 0, r.sentences.length - 1);
    // Bump the id BEFORE cancelling: cancel() fires onend/onerror for the utterance it
    // kills, and without this the stale callback would advance the queue a second time.
    const id = ++r.utterId;
    try { speechSynthesis.cancel(); } catch (e) { /* not available */ }

    const u = new SpeechSynthesisUtterance(r.sentences[r.index]);
    u.rate = state.settings.readRate;
    u.onend = () => {
      if (!r.active || id !== r.utterId) return;
      if (r.index + 1 < r.sentences.length) speakIndex(r.index + 1);
      else readStop(true);
    };
    u.onerror = () => { /* cancel() reports an error too — readStop() owns the UI state */ };

    try { speechSynthesis.speak(u); } catch (e) {
      readStop(true);
      showBanner('Could not start text-to-speech.');
      return;
    }
    r.paused = false;
    showBanner('Reading ' + (r.index + 1) + ' of ' + r.sentences.length + ' · ' + truncate(r.sentences[r.index], 84), 9000);
    highlightActiveSentence();
    updateToolbar();
  }

  function readStop(silent) {
    const r = state.read;
    r.active = false;
    r.paused = false;
    r.index = -1;
    r.utterId = (r.utterId || 0) + 1;
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    if (!silent) showBanner('Stopped reading.');
    highlightActiveSentence();
    updateToolbar();
  }

  function readNext() {
    const r = state.read;
    if (!r.active) { readStart(state.stripText || null); return; }
    if (r.index + 1 >= r.sentences.length) { showBanner('That was the last sentence.'); return; }
    speakIndex(r.index + 1);
  }

  function readPrev() {
    const r = state.read;
    if (!r.active) { readStart(state.stripText || null); return; }
    if (r.index <= 0) { speakIndex(0); return; }
    speakIndex(r.index - 1);
  }

  function readTogglePause() {
    const r = state.read;
    if (!r.active) { readStart(state.stripText || null); return; }
    try {
      if (r.paused) { speechSynthesis.resume(); r.paused = false; showBanner('Reading…', 1500); }
      else { speechSynthesis.pause(); r.paused = true; showBanner('Paused — Alt+Shift+V to resume.', 4000); }
    } catch (e) { showBanner('This browser cannot pause speech.'); }
  }

  function copyText(text) {
    if (!text) { showBanner('No text found under the lens.'); return; }
    const done = () => showBanner('Copied: “' + (text.length > 60 ? text.slice(0, 60) + '…' : text) + '”');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      ok ? done() : showBanner('Your browser blocked the clipboard — select the text to copy it.');
    } catch (e) {
      showBanner('Your browser blocked the clipboard — select the text to copy it.');
    }
  }

  /* Sample the frozen frame at the sample point and report the colour plus its WCAG
     contrast against white and black — the check low-vision users actually need. */
  function pickColour() {
    const f = state.frame;
    if (!f) { showBanner('No frame captured yet.'); return; }
    const sp = samplePoint();
    const px = Math.round((sp.x + (scrollX - f.scrollX)) * f.scale);
    const py = Math.round((sp.y + (scrollY - f.scrollY)) * f.scale);
    if (px < 0 || py < 0 || px >= f.w || py >= f.h) { showBanner('That point is outside the captured frame.'); return; }

    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.filter = window.LuminaFilterString(state.settings);
    cx.drawImage(f.img, px, py, 1, 1, 0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    const rgb = [d[0], d[1], d[2]];
    const hex = window.LuminaHex(rgb[0], rgb[1], rgb[2]);

    const onWhite = window.LuminaContrast(rgb, [255, 255, 255]);
    const onBlack = window.LuminaContrast(rgb, [0, 0, 0]);
    const best = onWhite >= onBlack ? onWhite : onBlack;
    const v = window.LuminaContrastVerdict(best);
    const tag = v.aaa ? 'AAA' : v.aa ? 'AA' : v.aaLarge ? 'AA large' : 'fails';
    const good = v.aaLarge;

    state.lastHex = hex;
    const ui = state.ui;
    ui.swatch.querySelector('.dot').style.background = hex;
    ui.swatch.querySelector('.hex').textContent = hex.toUpperCase();
    ui.swatch.querySelector('.meta').innerHTML =
      'rgb(' + rgb.join(', ') + ')<br>' +
      'Best contrast <' + (good ? 'b' : 'i') + '>' + best.toFixed(2) + ':1 (' + tag + ')</' + (good ? 'b' : 'i') + '>' +
      ' — vs white ' + onWhite.toFixed(1) + ', vs black ' + onBlack.toFixed(1);
    ui.swatch.classList.add('show');
    clearTimeout(state.swatchTimer);
    state.swatchTimer = setTimeout(() => ui.swatch.classList.remove('show'), 9000);
  }

  /* ---------------- controls ---------------- */

  function zoomStep(d) {
    const b = window.LuminaBounds;
    state.settings.zoom = clamp(state.settings.zoom + d, b.zoomMin, b.zoomMax);
    persistSettings();
    updateToolbar();
    requestDraw();
  }

  function sizeStep(d) {
    const b = window.LuminaBounds;
    const s = state.settings;
    s.lensSize = clamp(s.lensSize + d, b.sizeMin, b.sizeMax);
    if (s.lensHeight > 0) s.lensHeight = clamp(s.lensHeight + d, b.heightMin, b.heightMax);
    persistSettings();
    updateToolbar();
    requestDraw();
  }

  function cycleShape() {
    const shapes = window.LuminaShapes;
    state.settings.shape = shapes[(shapes.indexOf(state.settings.shape) + 1) % shapes.length];
    persistSettings();
    updateToolbar();
    requestDraw();
  }

  function cycleDock() {
    const docks = window.LuminaDocks;
    state.settings.dock = docks[(docks.indexOf(state.settings.dock) + 1) % docks.length];
    if (state.settings.dock !== 'off') state.pinned = false;
    persistSettings();
    updateToolbar();
    requestDraw();
    showBanner('Lens view: ' + (state.settings.dock === 'off' ? 'floating' : 'docked ' + state.settings.dock));
  }

  function cycleFollow() {
    const follows = window.LuminaFollows;
    state.settings.follow = follows[(follows.indexOf(state.settings.follow) + 1) % follows.length];
    refreshFollowBox(true);
    persistSettings();
    updateToolbar();
    requestDraw();
    showBanner('Following: ' + state.settings.follow);
  }

  function toggleCrisp() {
    state.settings.pixelPerfect = !state.settings.pixelPerfect;
    persistSettings();
    updateToolbar();
    requestDraw();
    showBanner(state.settings.pixelPerfect ? 'Pixel-perfect on — zoom snaps to whole steps' : 'Pixel-perfect off — smooth scaling');
  }

  /* Text weight. A binary toggle on the keyboard/toolbar (off ↔ 55) with the exact
     amount on a slider in the popup — the two-option case is what people actually use. */
  function toggleBold() {
    const s = state.settings;
    s.textBoost = s.textBoost > 0 ? 0 : 55;
    persistSettings();
    updateToolbar();
    requestDraw();
    showBanner(s.textBoost > 0 ? 'Text weight boosted — strokes thickened' : 'Text weight back to normal');
  }

  function toggleGuide() {
    const s = state.settings;
    s.guide = !s.guide;
    persistSettings();
    updateToolbar();
    requestDraw();
    showBanner(s.guide ? 'Reading guide on — the page dims to one band' : 'Reading guide off');
  }

  function toggleStrip() {
    const s = state.settings;
    s.readingStrip = !s.readingStrip;
    if (s.readingStrip) {
      state.stripKey = '';
      maybeRefreshStrip(true);
      showBanner('Reading strip on — Alt+J / Alt+K step through sentences', 3600);
    } else {
      hideStrip();
      showBanner('Reading strip off');
    }
    persistSettings();
    updateToolbar();
    requestDraw();
  }

  function togglePin() {
    state.pinned = !state.pinned;
    // lensRect() keeps state.lens current every frame, so pinning simply stops
    // updating it — the lens freezes exactly where it is drawn.
    updateToolbar();
    requestDraw();
  }

  function nudge(dx, dy) {
    state.pinned = true;
    state.lens.x = clamp(state.lens.x + dx, 0, innerWidth);
    state.lens.y = clamp(state.lens.y + dy, 0, innerHeight);
    updateToolbar();
    requestDraw();
  }

  function onToolbarClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    switch (btn.dataset.act) {
      case 'zoomin': zoomStep(10); break;
      case 'zoomout': zoomStep(-10); break;
      case 'shape': cycleShape(); break;
      case 'crisp': toggleCrisp(); break;
      case 'bold': toggleBold(); break;
      case 'guide': toggleGuide(); break;
      case 'strip': toggleStrip(); break;
      case 'color': pickColour(); break;
      case 'copy': copyText(textUnderLens()); break;
      case 'speak':
        if (state.read.active) readStop();
        else readStart(state.stripText || null);
        break;
      case 'refresh': requestCapture(false); break;
      case 'pin': togglePin(); break;
      case 'close': stop(); break;
    }
  }

  /* ---------------- event wiring ---------------- */

  const listeners = {};

  function attachListeners() {
    listeners.pointerMove = (e) => {
      if (state.drag) {
        state.lens.x = clamp(e.clientX - state.drag.dx, 0, innerWidth);
        state.lens.y = clamp(e.clientY - state.drag.dy, 0, innerHeight);
        requestDraw();
        return;
      }
      if (state.pinned) return;
      state.pointer.x = e.clientX;
      state.pointer.y = e.clientY;
      requestDraw();
    };
    listeners.pointerDown = (e) => {
      if (!state.pinned || e.button !== 0 || !hitLens(e.clientX, e.clientY)) return;
      e.preventDefault();
      state.drag = { dx: e.clientX - state.lens.x, dy: e.clientY - state.lens.y };
      document.body.style.userSelect = 'none';
    };
    listeners.pointerUp = () => {
      if (state.drag) {
        state.drag = null;
        document.body.style.userSelect = '';
      }
    };
    listeners.scroll = () => {
      // The frozen frame goes stale while scrolling — compensate live in draw(), then
      // grab a fresh frame once scrolling settles. The draw has to be requested here
      // explicitly: rendering is on demand now, so nothing else would repaint.
      requestDraw();
      scheduleRecapture();
    };
    listeners.wheel = (e) => {
      const overLens = state.pinned && hitLens(e.clientX, e.clientY);
      if (!e.altKey && !overLens) return;
      e.preventDefault();
      zoomStep(e.deltaY < 0 ? 10 : -10);
    };
    listeners.keyDown = (e) => {
      if (!state.active) return;
      const k = e.key;
      const alt = e.altKey, shift = e.shiftKey;
      if (alt && shift && (k === 'F' || k === 'f')) { e.preventDefault(); cycleFollow(); }
      else if (alt && shift && (k === 'D' || k === 'd')) { e.preventDefault(); cycleDock(); }
      else if (alt && shift && (k === 'V' || k === 'v')) { e.preventDefault(); readTogglePause(); }
      else if (alt && (k === '=' || k === '+')) { e.preventDefault(); zoomStep(10); }
      else if (alt && (k === '-' || k === '_')) { e.preventDefault(); zoomStep(-10); }
      else if (alt && (k === 's' || k === 'S')) { e.preventDefault(); cycleShape(); }
      else if (alt && (k === 'r' || k === 'R')) { e.preventDefault(); requestCapture(false); }
      else if (alt && (k === 'p' || k === 'P')) { e.preventDefault(); togglePin(); }
      else if (alt && (k === 'x' || k === 'X')) { e.preventDefault(); toggleCrisp(); }
      else if (alt && (k === 'b' || k === 'B')) { e.preventDefault(); toggleBold(); }
      else if (alt && (k === 'l' || k === 'L')) { e.preventDefault(); toggleGuide(); }
      else if (alt && (k === 't' || k === 'T')) { e.preventDefault(); toggleStrip(); }
      else if (alt && (k === 'g' || k === 'G')) { e.preventDefault(); pickColour(); }
      else if (alt && (k === 'c' || k === 'C')) { e.preventDefault(); copyText(textUnderLens()); }
      else if (alt && (k === 'v' || k === 'V')) {
        e.preventDefault();
        if (state.read.active) readStop(); else readStart(state.stripText || null);
      }
      else if (alt && (k === 'k' || k === 'K')) { e.preventDefault(); readNext(); }
      else if (alt && (k === 'j' || k === 'J')) { e.preventDefault(); readPrev(); }
      else if (alt && (k === '[' || k === '{')) { e.preventDefault(); sizeStep(-20); }
      else if (alt && (k === ']' || k === '}')) { e.preventDefault(); sizeStep(20); }
      else if (alt && (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown')) {
        // Alt+Left/Right are browser back/forward — claim them while the lens is up.
        e.preventDefault();
        const d = shift ? 40 : 8;
        nudge(k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0,
              k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0);
      }
      else if (k === 'Escape') { e.preventDefault(); stop(); }
    };
    listeners.resize = () => {
      resizeCanvas();
      measureToolbar();
      if (state.settings.readingStrip) state.stripKey = ''; // re-measure the strip height
      scheduleRecapture(400);
      requestDraw();
    };
    listeners.selectionChange = () => {
      if (state.settings.follow !== 'pointer' && state.active) {
        refreshFollowBox(true);
        requestDraw();
      }
    };
    listeners.focusIn = () => {
      if (state.active && state.settings.follow !== 'pointer') {
        const p = refreshFollowBox(true);
        if (p) ensureFollowVisible(p);
        requestDraw();
      }
    };

    window.addEventListener('pointermove', listeners.pointerMove, true);
    window.addEventListener('pointerdown', listeners.pointerDown, true);
    window.addEventListener('pointerup', listeners.pointerUp, true);
    window.addEventListener('scroll', listeners.scroll, true);
    window.addEventListener('wheel', listeners.wheel, { passive: false, capture: true });
    window.addEventListener('keydown', listeners.keyDown, true);
    window.addEventListener('resize', listeners.resize);
    document.addEventListener('selectionchange', listeners.selectionChange, true);
    document.addEventListener('focusin', listeners.focusIn, true);
  }

  function detachListeners() {
    window.removeEventListener('pointermove', listeners.pointerMove, true);
    window.removeEventListener('pointerdown', listeners.pointerDown, true);
    window.removeEventListener('pointerup', listeners.pointerUp, true);
    window.removeEventListener('scroll', listeners.scroll, true);
    window.removeEventListener('wheel', listeners.wheel, true);
    window.removeEventListener('keydown', listeners.keyDown, true);
    window.removeEventListener('resize', listeners.resize);
    document.removeEventListener('selectionchange', listeners.selectionChange, true);
    document.removeEventListener('focusin', listeners.focusIn, true);
  }

  /* ---------------- lifecycle ---------------- */

  async function start(partial) {
    if (state.active) return;
    state.settings = window.LuminaNormalize(Object.assign({}, await loadStoredSettings(), partial || {}));
    state.ui = buildUI();
    measureToolbar();
    attachListeners();
    state.active = true;
    state.pinned = false;
    state.dirty = true;
    state.recaptureWanted = false;
    state.read = { sentences: [], index: -1, utterId: 0, paused: false, active: false };
    state.stripKey = '';
    state.stripText = '';
    state.stripAt = 0;
    state.stripH = 0;
    state.pointer = { x: Math.round(innerWidth / 2), y: Math.round(innerHeight / 2) };
    state.lens = { x: state.pointer.x, y: state.pointer.y };
    resizeCanvas();
    updateToolbar();
    sendToBg({ type: 'lumina:state', active: true });
    requestCapture(true);
    // A restored session can arrive with the reading strip already switched on.
    if (state.settings.readingStrip) maybeRefreshStrip(true);
    requestDraw();
  }

  function stop() {
    if (!state.active) return;
    state.active = false;
    cancelDraw();
    detachListeners();
    clearTimeout(state.recaptureTimer);
    clearTimeout(state.saveTimer);
    clearTimeout(state.bannerTimer);
    clearTimeout(state.swatchTimer);
    state.read.active = false;
    state.read.utterId = (state.read.utterId || 0) + 1;
    if (window.speechSynthesis) { try { speechSynthesis.cancel(); } catch (e) {} }
    if (state.ui) {
      state.ui.toolbar.removeEventListener('click', onToolbarClick);
      state.ui.strip.removeEventListener('click', onStripClick);
      state.ui.host.remove();
    }
    state.ui = null;
    state.frame = null;
    state.pinned = false;
    state.drag = null;
    state.followBox = null;
    state.capturePending = false;
    state.recaptureWanted = false;
    state.stripKey = '';
    state.stripText = '';
    state.stripH = 0;
    // The shadow root holding the filter elements is gone; drop the stale nodes and the
    // cached kernel/radius so the next session re-applies them to its own elements.
    state.sharpenConv = null;
    state.boostMorph = null;
    state.lastSharpen = -1;
    state.lastBoost = -1;
    document.body.style.userSelect = '';
    sendToBg({ type: 'lumina:state', active: false });
  }

  /* ---------------- messages from the extension ---------------- */

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg && msg.type) {
      case 'lumina:ping':
        sendResponse({ ok: true, active: state.active });
        return;
      case 'lumina:activate':
        start(msg.settings).then(() => sendResponse({ ok: true, active: true }));
        return true;
      case 'lumina:deactivate':
        stop();
        sendResponse({ ok: true, active: false });
        return;
      case 'lumina:toggle':
        if (state.active) {
          stop();
          sendResponse({ ok: true, active: false });
        } else {
          start(msg.settings).then(() => sendResponse({ ok: true, active: true }));
        }
        return true;
      case 'lumina:settings':
        if (state.active && msg.settings) {
          const wasStrip = !!(state.settings && state.settings.readingStrip);
          state.settings = window.LuminaNormalize(msg.settings);
          if (state.settings.dock !== 'off') state.pinned = false;
          refreshFollowBox(true);
          updateToolbar();
          if (state.settings.readingStrip && !wasStrip) {
            state.stripKey = '';
            maybeRefreshStrip(true);
          } else if (!state.settings.readingStrip && wasStrip) {
            hideStrip();
          }
          requestDraw();
        }
        sendResponse({ ok: true });
        return;
      case 'lumina:resetsite':
        // Drop this site's override and fall back to the global settings.
        chrome.storage.local.get('luminaSites').then((res) => {
          const map = (res && res.luminaSites) || {};
          delete map[state.siteKey];
          return chrome.storage.local.set({ luminaSites: map });
        }).then(async () => {
          state.settings = window.LuminaNormalize(Object.assign({}, await loadStoredSettings()));
          updateToolbar();
          requestDraw();
          sendResponse({ ok: true });
        }).catch(() => sendResponse({ ok: false }));
        return true;
    }
  });

  // Debug / test hook.
  window.__luminaMagnifier = {
    start,
    stop,
    setPointer(x, y) {
      state.pointer.x = x;
      state.pointer.y = y;
      requestDraw();
    },
    applySettings(s) {
      if (!state.settings) return;
      state.settings = window.LuminaNormalize(s);
      if (state.settings.readingStrip) { state.stripKey = ''; maybeRefreshStrip(true); }
      else if (state.ui && state.ui.strip.classList.contains('show')) hideStrip();
      updateToolbar();
      requestDraw();
    },
    /* Force a synchronous repaint — the test harness cannot wait for rAF to settle. */
    renderNow() {
      if (!state.ui) return;
      state.dirty = false;
      draw();
    },
    pickColour,
    copyTextUnderLens() { return textUnderLens(); },
    stripText() { return state.stripText; },
    sentences(text) { return window.LuminaSentences(text); },
    readStart(text) { readStart(text); },
    readNext() { readNext(); },
    readPrev() { readPrev(); },
    readStop() { readStop(true); },
    readState() {
      return {
        active: state.read.active,
        index: state.read.index,
        count: state.read.sentences.length,
        paused: state.read.paused
      };
    },
    recapture() { return requestCapture(false); },
    get snapshot() {
      const ui = state.ui;
      return {
        active: state.active,
        pinned: state.pinned,
        frame: !!state.frame,
        frameScroll: state.frame ? { x: state.frame.scrollX, y: state.frame.scrollY } : null,
        dirty: state.dirty,
        draws: state.draws,
        capturePending: state.capturePending,
        settings: state.settings,
        globalSettings: state.globalSettings,
        lens: { x: state.lens.x, y: state.lens.y },
        aim: state.aim && { x: state.aim.x, y: state.aim.y, rect: state.aim.rect },
        stripOpen: !!(ui && ui.strip.classList.contains('show')),
        stripH: state.stripH,
        read: { active: state.read.active, index: state.read.index, count: state.read.sentences.length },
        toolbar: ui ? {
          left: parseFloat(ui.toolbar.style.left) || 0,
          top: parseFloat(ui.toolbar.style.top) || 0,
          w: state.dockW,
          h: state.dockH
        } : null,
        canvas: ui ? { w: ui.canvas.width, h: ui.canvas.height } : null
      };
    }
  };
})();
