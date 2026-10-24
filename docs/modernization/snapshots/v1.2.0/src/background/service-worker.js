/* Lumina Magnifier — MV3 service worker.
   Responsibilities:
   - Serialize chrome.tabs.captureVisibleTab calls (API is throttled to 2/sec) and retry on quota errors.
   - Inject the content script on demand, toggle the lens, keep the action badge in sync.
   - Context menus: "Magnify this image" and "Open Photo Magnifier". */

'use strict';

const CAPTURE_MIN_GAP_MS = 550; // stays safely under MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND (2/sec)
const INJECT_FILES = ['src/shared/defaults.js', 'src/content/magnifier.js'];

let captureChain = Promise.resolve();
let lastCaptureAt = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function injectableUrl(url) {
  return /^(https?|file):/i.test(url || '');
}

async function ensureInjected(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: INJECT_FILES });
    return true;
  } catch (e) {
    return false;
  }
}

function setBadge(tabId, active) {
  if (!tabId) return;
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#6D5DF6' }).catch(() => {});
  chrome.action.setBadgeText({ tabId, text: active ? 'ON' : '' }).catch(() => {});
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

/* One captureVisibleTab at a time, spaced >= CAPTURE_MIN_GAP_MS, one quota retry. */
function captureQueued(windowId) {
  const run = async () => {
    const wait = Math.max(0, CAPTURE_MIN_GAP_MS - (Date.now() - lastCaptureAt));
    if (wait > 0) await sleep(wait);
    let result;
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
      result = { ok: true, dataUrl };
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (/MAX_CAPTURE|quota/i.test(msg)) {
        await sleep(650);
        try {
          const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
          result = { ok: true, dataUrl };
        } catch (e2) {
          result = { ok: false, error: String((e2 && e2.message) || e2) };
        }
      } else {
        result = { ok: false, error: msg };
      }
    }
    lastCaptureAt = Date.now();
    return result;
  };
  const handed = captureChain.then(run);
  captureChain = handed.catch(() => {});
  return handed;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'lumina:capture') {
    const windowId = sender.tab && sender.tab.windowId;
    if (windowId == null) {
      sendResponse({ ok: false, error: 'No window to capture.' });
      return;
    }
    captureQueued(windowId).then(sendResponse);
    return true; // async response
  }

  if (msg && msg.type === 'lumina:state') {
    setBadge(sender.tab && sender.tab.id, !!msg.active);
    sendResponse({ ok: true });
    return;
  }

  if (msg && msg.type === 'lumina:activate') {
    (async () => {
      const tab = await getActiveTab();
      if (!tab || !tab.id) return sendResponse({ ok: false, error: 'No active tab found.' });
      if (!injectableUrl(tab.url)) {
        return sendResponse({ ok: false, error: 'Chrome blocks extensions on this page — try a normal web page.' });
      }
      if (!(await ensureInjected(tab.id))) {
        return sendResponse({ ok: false, error: 'Could not load the magnifier on this page.' });
      }
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'lumina:activate', settings: msg.settings });
      } catch (e) { /* tab may have navigated mid-flight */ }
      setBadge(tab.id, true);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg && msg.type === 'lumina:deactivate') {
    (async () => {
      const tab = await getActiveTab();
      if (tab && tab.id) {
        try {
          await chrome.tabs.sendMessage(tab.id, { type: 'lumina:deactivate' });
        } catch (e) { /* not injected — nothing to do */ }
        setBadge(tab.id, false);
      }
      sendResponse({ ok: true });
    })();
    return true;
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-magnifier') return;
  const tab = await getActiveTab();
  if (!tab || !tab.id || !injectableUrl(tab.url)) return;
  if (!(await ensureInjected(tab.id))) return;
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'lumina:toggle' });
    setBadge(tab.id, !!(res && res.active));
  } catch (e) { /* ignore */ }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'lumina-magnify-image',
      title: 'Magnify this image',
      contexts: ['image']
    });
    chrome.contextMenus.create({
      id: 'lumina-open-viewer',
      title: 'Open Photo Magnifier',
      contexts: ['action']
    });
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  const base = chrome.runtime.getURL('src/viewer/viewer.html');
  if (info.menuItemId === 'lumina-magnify-image' && info.srcUrl) {
    chrome.tabs.create({ url: base + '?src=' + encodeURIComponent(info.srcUrl) });
  } else if (info.menuItemId === 'lumina-open-viewer') {
    chrome.tabs.create({ url: base });
  }
});

/* Content script dies on navigation — clear the badge so it never lies. */
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') setBadge(tabId, false);
});
