// A fake Apps Script web app for tests and local dev. It runs the real
// apps-script/Code.gs in a node:vm sandbox against in-memory stand-ins for
// SpreadsheetApp, LockService, PropertiesService, ContentService and
// Utilities, and serves it over a `fetch` that behaves like Google's:
// POST /exec runs doPost and answers 302 to a one-time
// script.googleusercontent.com/macros/echo URL that returns the output to a GET.

import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import vm from 'node:vm';

export const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbFAKEdeployment123/exec';
export const SECRET = 'a'.repeat(24) + 'f00dfeedc0ffee1234567890abcdef00'; // 56 chars, test only
const CODE = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');

/** In-memory spreadsheet: tabs of rows (arrays of strings). */
function fakeSpreadsheet(tabs) {
  const sheets = new Map(Object.entries(structuredClone(tabs)).map(([name, rows]) => [name, { rows, maxRows: 1000, frozen: 0 }]));
  const sheetApi = (name) => {
    const s = sheets.get(name);
    return {
      getLastRow: () => s.rows.length,
      getMaxRows: () => s.maxRows,
      insertRowsAfter: (_after, n) => { s.maxRows += n; },
      setFrozenRows: (n) => { s.frozen = n; },
      getRange(row, col, numRows = 1, numCols = 1) {
        if (row + numRows - 1 > s.maxRows) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
        const range = {
          getValues: () => Array.from({ length: numRows }, (_, r) => Array.from({ length: numCols }, (_, c) => s.rows[row - 1 + r]?.[col - 1 + c] ?? '')),
          setNumberFormat: () => range,
          setValues(values) {
            values.forEach((vals, r) => {
              const target = (s.rows[row - 1 + r] ??= []);
              vals.forEach((v, c) => { target[col - 1 + c] = v; });
            });
            return range;
          },
        };
        return range;
      },
    };
  };
  return {
    sheets,
    api: {
      getSheetByName: (name) => (sheets.has(name) ? sheetApi(name) : null),
      insertSheet: (name) => { sheets.set(name, { rows: [], maxRows: 1000, frozen: 0 }); return sheetApi(name); },
    },
  };
}

/**
 * @param {object} o
 * @param {Record<string,string[][]>} [o.tabs]   initial sheet contents
 * @param {Record<string,string>} [o.properties] Script properties (default: WAITLIST_SECRET = SECRET)
 * @param {'ok'|'signin'|'signin-html'|'html'|'not-json'|'http500'|'hang'|'echo-hang'|'offsite'} [o.mode]
 */
export function fakeAppsScript({ tabs = {}, properties = { WAITLIST_SECRET: SECRET }, mode = 'ok' } = {}) {
  const calls = [];
  const sheet = fakeSpreadsheet(tabs);
  const echoes = new Map(); // user_content_key -> body (served once)
  const lock = { held: false, acquired: 0 };

  const sandbox = {
    console: { error() {}, log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in properties ? properties[k] : null) }) },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => { if (lock.held) return false; lock.held = true; lock.acquired++; return true; },
        releaseLock: () => { lock.held = false; },
      }),
    },
    SpreadsheetApp: { getActiveSpreadsheet: () => sheet.api },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => {
        const out = { text, mime: 'text/plain', setMimeType(m) { out.mime = m; return out; } };
        return out;
      },
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      // Apps Script returns signed bytes (-128..127).
      computeDigest: (alg, s) => [...createHash(alg).update(String(s), 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(CODE, sandbox, { filename: 'Code.gs' });

  const waitForAbort = (signal) =>
    new Promise((_, reject) => {
      if (!signal) return; // never settles
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });

  async function fetch(input, init = {}) {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const call = { url, method, redirect: init.redirect ?? 'follow', headers: new Headers(init.headers), body: init.body };
    calls.push(call);

    if (url.href === SCRIPT_URL) {
      if (mode === 'hang') return waitForAbort(init.signal);
      if (mode === 'http500') return new Response('<html><body>Error</body></html>', { status: 500, headers: { 'content-type': 'text/html' } });
      if (mode === 'signin') {
        return new Response(null, { status: 302, headers: { location: 'https://accounts.google.com/ServiceLogin?service=wise&continue=https://script.google.com/macros/s/x/exec' } });
      }
      if (mode === 'signin-html') {
        return new Response('<!DOCTYPE html><html><head><title>Google Drive: Sign-in</title></head><body>Sign in - Google Accounts accounts.google.com</body></html>', {
          status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
      if (mode === 'offsite') return new Response(null, { status: 302, headers: { location: 'https://evil.example/macros/echo?x=1' } });
      if (method === 'GET') {
        const out = sandbox.doGet({ parameter: Object.fromEntries(url.searchParams) });
        return new Response(out.text, { status: 200, headers: { 'content-type': `${out.mime}; charset=utf-8` } });
      }
      if (method !== 'POST') return new Response('', { status: 405 });
      const out = sandbox.doPost({ postData: { contents: String(init.body ?? ''), type: call.headers.get('content-type') ?? '' }, parameter: {} });
      const body = mode === 'html' ? '<html><body>Script function not found: doPost</body></html>'
        : mode === 'not-json' ? 'ok'
        : out.text;
      const key = randomUUID().replace(/-/g, '');
      echoes.set(key, { body, mime: mode === 'html' ? 'text/html' : out.mime });
      const location = `https://script.googleusercontent.com/macros/echo?user_content_key=${key}&lib=MFAKELIB`;
      // Like Google: a client that re-POSTs to the echo URL (e.g. after a 307) gets an error page.
      return new Response(null, { status: 302, headers: { location } });
    }

    if (url.origin === 'https://script.googleusercontent.com' && url.pathname === '/macros/echo') {
      if (mode === 'echo-hang') return waitForAbort(init.signal);
      if (method !== 'GET') return new Response('<html>405</html>', { status: 405, headers: { 'content-type': 'text/html' } });
      const key = url.searchParams.get('user_content_key');
      const echo = echoes.get(key);
      if (!echo) return new Response('<html>Not Found</html>', { status: 404, headers: { 'content-type': 'text/html' } });
      echoes.delete(key);
      return new Response(echo.body, { status: 200, headers: { 'content-type': `${echo.mime}; charset=utf-8` } });
    }
    return new Response('not found', { status: 404 });
  }

  return {
    fetch,
    calls,
    lock,
    /** Rows of a tab (header included), or undefined. */
    rows: (tab = 'Waitlist') => sheet.sheets.get(tab)?.rows,
    sheet,
    sandbox,
  };
}
