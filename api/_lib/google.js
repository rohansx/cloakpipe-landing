// Google service-account auth without dependencies: sign an RS256 JWT with
// node:crypto, exchange it for an OAuth access token, cache the token.

import { createSign } from 'node:crypto';

export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const LIFETIME_S = 3600;
const REFRESH_MARGIN_MS = 60_000;

/** An error from a Google API. `message` never contains credentials or response bodies. */
export class GoogleError extends Error {
  constructor(stage, status, detail = '') {
    super(`Google ${stage} request failed with HTTP ${status}`);
    this.name = 'GoogleError';
    this.stage = stage;
    this.status = status;
    /** Google's short error code/status (e.g. PERMISSION_DENIED, invalid_grant), for server logs. */
    this.detail = detail;
  }
}

/** Env values often carry the PEM with literal "\n" sequences and sometimes wrapping quotes. */
export function normalizePrivateKey(key) {
  let k = String(key ?? '').trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) k = k.slice(1, -1);
  return k.replace(/\\r/g, '').replace(/\\n/g, '\n').trim();
}

const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

export function signJwt({ clientEmail, privateKey, scope = SHEETS_SCOPE, now = Date.now() }) {
  const iat = Math.floor(now / 1000);
  const header = b64url({ alg: 'RS256', typ: 'JWT' });
  const claims = b64url({ iss: clientEmail, scope, aud: TOKEN_URL, iat, exp: iat + LIFETIME_S });
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const sig = signer.sign(normalizePrivateKey(privateKey)).toString('base64url');
  return `${header}.${claims}.${sig}`;
}

/** Short error code from a Google error body, without echoing free text. */
export async function errorCode(res) {
  try {
    const j = await res.json();
    const code = typeof j?.error === 'string' ? j.error : j?.error?.status;
    return typeof code === 'string' && /^[A-Za-z_]{1,64}$/.test(code) ? code : '';
  } catch {
    return '';
  }
}

export function createTokenProvider({ clientEmail, privateKey, scope = SHEETS_SCOPE, fetch = globalThis.fetch, now = () => Date.now() }) {
  let cached = null; // { token, expiresAt }
  let inflight = null;

  async function fetchToken() {
    const assertion = signJwt({ clientEmail, privateKey, scope, now: now() });
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    if (!res.ok) throw new GoogleError('token', res.status, await errorCode(res));
    const j = await res.json();
    if (typeof j.access_token !== 'string') throw new GoogleError('token', res.status, 'no_access_token');
    const ttl = Number(j.expires_in) > 0 ? Number(j.expires_in) : LIFETIME_S;
    cached = { token: j.access_token, expiresAt: now() + ttl * 1000 };
    return cached.token;
  }

  return {
    async getToken() {
      if (cached && now() < cached.expiresAt - REFRESH_MARGIN_MS) return cached.token;
      inflight ??= fetchToken().finally(() => { inflight = null; });
      return inflight;
    },
  };
}

