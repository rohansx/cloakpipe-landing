// Waitlist submission validation. Pure functions, no I/O.
// Files under api/_lib are not deployed as functions (leading underscore).

export const ROLES = ['Engineering/ML', 'Platform/SRE', 'Security/Compliance', 'Founder/Exec', 'Other'];

export const LIMITS = { email: 254, emailLocal: 64, name: 120, company: 120, useCase: 1000, source: 200, utm: 100 };

/** Minimum time between the form loading and being submitted. */
export const MIN_FILL_MS = 2000;

/** Honeypot field name: hidden from people, filled by naive bots. */
export const HONEYPOT = 'cp_hp';

export const normalizeEmail = (v) => String(v ?? '').trim().toLowerCase();

// Pragmatic subset of RFC 5321/5322: dot-atom local part starting and ending
// with an alphanumeric (so no leading = + - @ either), a hostname of LDH
// labels and an alphabetic TLD. Quoted local parts and IP literals are refused.
const LOCAL = /^[a-z0-9](?:[a-z0-9._%+'-]*[a-z0-9])?$/;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function isValidEmail(email) {
  if (typeof email !== 'string' || email.length > LIMITS.email || email !== email.trim()) return false;
  const at = email.lastIndexOf('@');
  if (at < 1 || email.indexOf('@') !== at) return false;
  const local = email.slice(0, at).toLowerCase();
  const domain = email.slice(at + 1).toLowerCase();
  if (local.length > LIMITS.emailLocal || !LOCAL.test(local) || local.includes('..')) return false;
  const labels = domain.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return false;
  return /^[a-z]{2,63}$/.test(labels.at(-1));
}

// Strip C0/C1 control characters; keep newlines only where allowed.
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const CONTROL_AND_NL = /[\u0000-\u001F\u007F-\u009F]/g;

function clean(v, { multiline = false } = {}) {
  let s = String(v).replace(/\r\n?/g, '\n');
  s = s.replace(multiline ? CONTROL : CONTROL_AND_NL, '');
  return s.trim();
}

const len = (s) => [...s].length;
const cap = (s, n) => [...s].slice(0, n).join('');

function sitePath(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (!s.startsWith('/') || s.startsWith('//') || s.includes('\\')) return '';
  return cap(clean(s.split(/[?#]/, 1)[0]), LIMITS.source);
}

const toMs = (v) => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' && typeof v !== 'number') return NaN;
  return /^\d{10,16}$/.test(String(v).trim()) ? Number(v) : NaN;
};

/**
 * Validate a submitted form. `fields` uses the form's field names.
 * Returns { ok: true, data } or { ok: false, error, field?, silent? }.
 */
export function validateSubmission(fields, { now = Date.now() } = {}) {
  const f = fields ?? {};

  // Honeypot first: a bot gets a fake success and nothing is stored.
  const hp = f[HONEYPOT];
  if (hp !== undefined && hp !== null && String(hp).trim() !== '') return { ok: false, error: 'honeypot', silent: true };

  if (typeof f.email !== 'string') return { ok: false, error: 'invalid_email', field: 'email' };
  const email = normalizeEmail(f.email);
  if (!isValidEmail(email)) return { ok: false, error: 'invalid_email', field: 'email' };

  const text = {};
  for (const [field, max, multiline] of [['name', LIMITS.name], ['company', LIMITS.company], ['use_case', LIMITS.useCase, true], ['role', 64]]) {
    const v = f[field];
    if (v === undefined || v === null) { text[field] = ''; continue; }
    if (typeof v !== 'string') return { ok: false, error: 'invalid', field };
    const s = clean(v, { multiline });
    if (len(s) > max) return { ok: false, error: 'too_long', field };
    text[field] = s;
  }
  if (text.role && !ROLES.includes(text.role)) return { ok: false, error: 'invalid_role', field: 'role' };

  // Time-to-submit. JS sets started_at on load and submitted_at on submit, so
  // the difference is measured on one clock. A missing started_at means a
  // no-JS submission, which relies on the honeypot, origin check and rate limit.
  const started = toMs(f.started_at);
  const submitted = toMs(f.submitted_at);
  if (Number.isNaN(started) || Number.isNaN(submitted)) return { ok: false, error: 'invalid_timing' };
  if (started !== null) {
    const elapsed = submitted !== null ? submitted - started : now - started;
    if (elapsed < MIN_FILL_MS) return { ok: false, error: 'too_fast' };
  }

  const utm = (v) => (typeof v === 'string' ? cap(clean(v), LIMITS.utm) : '');
  return {
    ok: true,
    data: {
      email,
      name: text.name,
      company: text.company,
      role: text.role,
      useCase: text.use_case,
      source: sitePath(f.source),
      utmSource: utm(f.utm_source),
      utmMedium: utm(f.utm_medium),
      utmCampaign: utm(f.utm_campaign),
    },
  };
}
