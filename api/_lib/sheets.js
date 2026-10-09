// Google Sheets v4 calls for the waitlist, over fetch. Values are written with
// valueInputOption=RAW so nothing is parsed as a formula.

import { GoogleError, errorCode } from './google.js';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';

export const HEADER = ['Timestamp (UTC)', 'Email', 'Name', 'Company', 'Role', 'Use case', 'Source page', 'UTM source', 'UTM medium', 'UTM campaign', 'User agent'];
const LAST_COL = String.fromCharCode(64 + HEADER.length); // K

/**
 * Prefix cells that a spreadsheet (or a later CSV export) could read as a
 * formula. RAW input already stores them as text; this also covers exports.
 */
export function neutralize(v) {
  const s = String(v ?? '');
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/** A short browser/OS family such as "Chrome/macOS"; the full user-agent is never stored. */
export function uaFamily(ua) {
  const s = String(ua ?? '');
  if (!s) return 'unknown';
  if (/bot|crawler|spider|slurp|headless/i.test(s)) return 'bot';
  if (/^curl\//i.test(s)) return 'curl';
  const browser =
    /Edg(?:e|A|iOS)?\//.test(s) ? 'Edge'
    : /OPR\/|Opera/.test(s) ? 'Opera'
    : /Firefox\/|FxiOS\//.test(s) ? 'Firefox'
    : /Chrome\/|CriOS\//.test(s) ? 'Chrome'
    : /Safari\//.test(s) ? 'Safari'
    : null;
  const os =
    /iPhone|iPad|iPod/.test(s) ? 'iOS'
    : /Android/.test(s) ? 'Android'
    : /Windows/.test(s) ? 'Windows'
    : /Mac OS X|Macintosh/.test(s) ? 'macOS'
    : /CrOS/.test(s) ? 'ChromeOS'
    : /Linux/.test(s) ? 'Linux'
    : null;
  if (!browser) return 'other';
  return os ? `${browser}/${os}` : browser;
}

export function buildRow(d, { now = Date.now(), userAgent = '' } = {}) {
  return [
    new Date(now).toISOString(),
    d.email, d.name, d.company, d.role, d.useCase, d.source, d.utmSource, d.utmMedium, d.utmCampaign,
    uaFamily(userAgent),
  ].map(neutralize);
}

/** Quote a sheet (tab) name for an A1 range: 'Rohan''s list'. */
export const quoteTab = (tab) => `'${String(tab).replace(/'/g, "''")}'`;

export function createSheetsClient({ sheetId, tab = 'Waitlist', getToken, fetch = globalThis.fetch }) {
  const base = `${API}/${encodeURIComponent(sheetId)}`;
  const range = (a1) => encodeURIComponent(`${quoteTab(tab)}!${a1}`);

  async function call(stage, url, init = {}) {
    const token = await getToken();
    const res = await fetch(url, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
    });
    if (!res.ok) throw new GoogleError(stage, res.status, await errorCode(res.clone()));
    return res;
  }

  async function createTab() {
    await call('addSheet', `${base}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab } } }] }),
    });
  }

  return {
    /** Reads columns A:B. { empty } is true when the tab has no rows (it is created if missing). */
    async readEmails() {
      let res;
      try {
        res = await call('read', `${base}/values/${range('A:B')}`, { method: 'GET' });
      } catch (e) {
        // A missing tab makes the range unparsable (HTTP 400): create it.
        if (e instanceof GoogleError && e.status === 400) {
          await createTab();
          return { empty: true, emails: new Set() };
        }
        throw e;
      }
      const values = (await res.json()).values ?? [];
      const emails = new Set();
      for (const row of values.slice(1)) {
        const e = String(row?.[1] ?? '').trim().replace(/^'/, '').toLowerCase();
        if (e) emails.add(e);
      }
      // Row 1 counts as the header even when someone typed a different one.
      return { empty: values.length === 0, emails };
    },

    async writeHeader() {
      await call('header', `${base}/values/${range(`A1:${LAST_COL}1`)}?valueInputOption=RAW`, {
        method: 'PUT',
        body: JSON.stringify({ values: [HEADER] }),
      });
    },

    async appendRow(row) {
      await call('append', `${base}/values/${range(`A:${LAST_COL}`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
        method: 'POST',
        body: JSON.stringify({ values: [row] }),
      });
    },
  };
}
