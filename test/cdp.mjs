/* Minimal Chrome DevTools Protocol driver — no npm dependencies.
   Node 22 ships a global WebSocket, which is all this needs.

   Shared by test/browser.test.mjs (lens engine) and test/ui.test.mjs (popup + viewer). */

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(fn, timeout = 10000, step = 60) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) return null;
    await sleep(step);
  }
}

/* ---------------- assertions ---------------- */

export const tally = { pass: 0, fail: 0, skip: 0, failures: [] };

export function ok(name, cond, extra) {
  if (cond) { tally.pass++; console.log('  \u2713 ' + name); }
  else {
    tally.fail++;
    tally.failures.push(name + (extra ? ' — ' + extra : ''));
    console.log('  \u2717 ' + name + (extra ? ' — ' + extra : ''));
  }
}

export const eq = (name, a, b) => ok(name + ' (' + JSON.stringify(a) + ' === ' + JSON.stringify(b) + ')', a === b);
export const near = (name, a, b, tol) => ok(name + ' (' + a + ' \u2248 ' + b + ')', Math.abs(a - b) <= tol);

export function skipped(name, why) {
  tally.skip++;
  console.log('  \u2013 ' + name + ' (SKIPPED: ' + why + ')');
}

export function report() {
  console.log('\n' + tally.pass + ' passed, ' + tally.fail + ' failed, ' + tally.skip + ' skipped');
  if (tally.failures.length) {
    console.log('Failures:');
    for (const f of tally.failures) console.log('  - ' + f);
  }
  return tally.fail;
}

/* ---------------- CDP ---------------- */

export class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP timeout: ' + method));
        }
      }, 20000);
    });
  }

  /* Evaluate an expression in the page and return its JSON value. */
  async eval(expr, { awaitPromise = true } = {}) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      awaitPromise,
      returnByValue: true,
      userGesture: true
    });
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      throw new Error('Page exception: ' + ((d.exception && d.exception.description) || d.text));
    }
    return res.result.value;
  }

  close() { try { this.ws.close(); } catch (e) { /* already gone */ } }
}

export function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', () => reject(new Error('could not open a debugger socket at ' + url)));
  });
}

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
];

export function findChrome() {
  for (const p of CHROME_CANDIDATES) if (existsSync(p)) return p;
  return null;
}

export async function launch({ headed = false } = {}) {
  const exe = findChrome();
  if (!exe) return null;
  const profile = await mkdtemp(join(tmpdir(), 'lumina-cdp-'));
  const port = 9222 + Math.floor(Math.random() * 600);
  const args = [
    headed ? '--headless=old' : '--headless=new',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--allow-file-access-from-files',
    '--force-device-scale-factor=1',
    '--window-size=1440,900',
    'about:blank'
  ];
  if (headed) args.shift();
  const proc = spawn(exe, args, { stdio: 'ignore', windowsHide: true });

  const version = await waitFor(async () => {
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/json/version');
      return r.ok ? r.json() : null;
    } catch (e) { return null; }
  }, 20000);
  if (!version) { proc.kill(); return null; }
  return { proc, port, profile, browserWs: version.webSocketDebuggerUrl };
}

export async function shutdown(session, { keep = false } = {}) {
  if (!session) return;
  try { session.proc.kill(); } catch (e) { /* already dead */ }
  if (keep) return;
  await sleep(250);
  await rm(session.profile, { recursive: true, force: true }).catch(() => {});
}

/* Open a page target and return { page, targetId, browser }.
   Target.getTargetInfo does not expose a webSocketDebuggerUrl, so the page socket is
   looked up from the HTTP /json/list endpoint by target id. */
export async function openPage(session, url) {
  const browser = new CDP(await connect(session.browserWs));
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });

  const entry = await waitFor(async () => {
    try {
      const r = await fetch('http://127.0.0.1:' + session.port + '/json/list');
      const list = await r.json();
      return list.find((t) => t.id === targetId && t.webSocketDebuggerUrl) || null;
    } catch (e) { return null; }
  }, 10000);
  if (!entry) throw new Error('could not resolve a debugger socket for the new page target');

  const page = new CDP(await connect(entry.webSocketDebuggerUrl));
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Log.enable');
  await page.send('Page.navigate', { url });

  /* Uncaught exceptions and console errors land here; the tests assert on them. */
  const errors = [];
  page.ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push(((d.exception && d.exception.description) || d.text || 'exception').split('\n')[0]);
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      const t = msg.params.entry.text || '';
      if (!/favicon/i.test(t)) errors.push(t);
    }
  });

  return { page, targetId, browser, errors };
}
