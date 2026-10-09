// The waitlist row: column order, formula neutralisation and the short
// user-agent family. Mirrored in apps-script/Code.gs (COLUMNS, neutralize_).

export const HEADER = ['Timestamp (UTC)', 'Email', 'Name', 'Company', 'Role', 'Use case', 'Source page', 'UTM source', 'UTM medium', 'UTM campaign', 'User agent'];

/** JSON keys sent to the Apps Script, in HEADER order. */
export const KEYS = ['timestamp', 'email', 'name', 'company', 'role', 'useCase', 'source', 'utmSource', 'utmMedium', 'utmCampaign', 'userAgent'];

/**
 * Prefix cells that a spreadsheet (or a later CSV export) could read as a
 * formula. The Apps Script neutralises again (defence in depth); this also
 * covers CSV exports.
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

/** One signup as an object keyed by KEYS, every value a neutralised string. */
export function buildEntry(d, { now = Date.now(), userAgent = '' } = {}) {
  const values = [
    new Date(now).toISOString(),
    d.email, d.name, d.company, d.role, d.useCase, d.source, d.utmSource, d.utmMedium, d.utmCampaign,
    uaFamily(userAgent),
  ];
  return Object.fromEntries(KEYS.map((k, i) => [k, neutralize(values[i])]));
}
