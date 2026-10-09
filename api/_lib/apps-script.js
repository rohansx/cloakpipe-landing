// Client for the Google Apps Script web app that owns the waitlist sheet
// (apps-script/Code.gs). No Google credentials live here: the script runs as
// the sheet owner and checks a shared secret sent in the JSON body (web apps
// cannot read custom request headers).
//
// The redirect. A web app's doPost runs during the POST to /exec, but Google
// does not return the ContentService output there: it answers 302 with a
// Location on script.googleusercontent.com (/macros/echo?user_content_key=…)
// that serves the output once, to a GET. See "Redirects" in
// https://developers.google.com/apps-script/guides/content
// The Fetch standard (HTTP-redirect fetch) already turns a POST into a GET
// with no body after a 301/302, so `redirect: 'follow'` would happen to work,
// but it would also silently follow a 302 to a Google sign-in page and return
// HTML with status 200. So the POST uses `redirect: 'manual'`, and the client
// checks the Location host itself and GETs the echo URL explicitly.

export const ECHO_HOST = 'script.googleusercontent.com';
export const DEFAULT_TIMEOUT_MS = 10_000;
const SIGN_IN_HOSTS = new Set(['accounts.google.com', 'www.google.com']);
const MAX_REDIRECTS = 2;

const HINT_ACCESS =
  'the web app is not public: in Apps Script, Deploy > Manage deployments > edit > "Who has access: Anyone", and use the /exec URL';
const HINT_SECRET = 'WAITLIST_SCRIPT_SECRET in Vercel does not match the Script property WAITLIST_SECRET';

/** An Apps Script failure. `message` and `detail` never carry the secret, the URL or response bodies. */
export class UpstreamError extends Error {
  constructor(stage, detail, { status = 0, hint = '' } = {}) {
    super(`Apps Script ${stage} failed${status ? ` (HTTP ${status})` : ''}: ${detail}`);
    this.name = 'UpstreamError';
    this.stage = stage; // post | redirect | echo | response | script | timeout
    this.detail = detail;
    this.status = status;
    this.hint = hint;
  }
}

/** A deployed web app URL: https://script.google.com/macros/s/<id>/exec (or /a/macros/<domain>/s/<id>/exec). */
export function isScriptUrl(value) {
  try {
    const u = new URL(String(value));
    return u.protocol === 'https:' && u.hostname === 'script.google.com' && /^\/(?:a\/macros\/[^/]+|macros)\/s\/[\w-]+\/exec$/.test(u.pathname);
  } catch {
    return false;
  }
}

const isRedirect = (s) => s === 301 || s === 302 || s === 303 || s === 307 || s === 308;
const shortCode = (v) => (typeof v === 'string' && /^[a-z_]{1,40}$/.test(v) ? v : 'unknown');

async function parseJson(res) {
  const type = (res.headers.get('content-type') ?? '').toLowerCase();
  const text = await res.text();
  const looksHtml = type.includes('text/html') || /^\s*</.test(text);
  if (looksHtml) {
    throw new UpstreamError('response', 'got HTML instead of JSON', {
      status: res.status,
      hint: /accounts\.google\.com|ServiceLogin|sign in/i.test(text)
        ? `Google sign-in page: ${HINT_ACCESS}`
        : `an HTML page usually means a sign-in or error page: ${HINT_ACCESS}; or doPost threw (see Apps Script > Executions)`,
    });
  }
  try {
    const j = JSON.parse(text);
    if (j && typeof j === 'object' && !Array.isArray(j)) return j;
  } catch {}
  throw new UpstreamError('response', 'response is not a JSON object', { status: res.status, hint: 'check WAITLIST_SCRIPT_URL is the web app /exec URL' });
}

export function createAppsScriptClient({ url, secret, fetch = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return {
    /** Sends one entry (see row.js buildEntry). Resolves 'joined' or 'already'; throws UpstreamError. */
    async submit(entry) {
      const signal = AbortSignal.timeout(timeoutMs); // one budget for both hops
      try {
        let res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ secret, entry }),
          redirect: 'manual',
          signal,
        });

        let stage = 'post';
        for (let hops = 0; isRedirect(res.status); hops++) {
          let next;
          try {
            next = new URL(res.headers.get('location') ?? '', url);
          } catch {
            throw new UpstreamError('redirect', 'redirect without a usable Location', { status: res.status });
          }
          if (SIGN_IN_HOSTS.has(next.hostname)) {
            throw new UpstreamError('redirect', 'redirected to Google sign-in', { status: res.status, hint: HINT_ACCESS });
          }
          if (next.protocol !== 'https:' || next.hostname !== ECHO_HOST || hops >= MAX_REDIRECTS) {
            throw new UpstreamError('redirect', `unexpected redirect to ${next.protocol === 'https:' ? next.hostname : next.protocol}`, { status: res.status });
          }
          // doPost has already run; this GET only collects its output.
          res = await fetch(next.href, { method: 'GET', redirect: 'manual', signal });
          stage = 'echo';
        }

        if (!res.ok) {
          throw new UpstreamError(stage, 'non-2xx response', {
            status: res.status,
            hint:
              res.status === 404 ? 'no such deployment: check WAITLIST_SCRIPT_URL is the current /exec URL and the deployment is not archived'
              : res.status === 401 || res.status === 403 ? HINT_ACCESS
              : '',
          });
        }
        const body = await parseJson(res);
        if (body.status === 'joined' || body.status === 'already') return body.status;
        const code = shortCode(body.error);
        throw new UpstreamError('script', `script answered error "${code}"`, {
          status: res.status,
          hint:
            code === 'unauthorized' ? HINT_SECRET
            : code === 'not_configured' ? 'set the Script property WAITLIST_SECRET (Project Settings > Script properties)'
            : code === 'busy' ? 'the sheet lock was held for too long; retry'
            : '',
        });
      } catch (e) {
        if (e instanceof UpstreamError) throw e;
        if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
          throw new UpstreamError('timeout', `no answer within ${timeoutMs} ms`, { hint: 'Apps Script cold starts can be slow; check Apps Script > Executions' });
        }
        throw new UpstreamError('post', `network error (${e?.cause?.code ?? e?.name ?? 'unknown'})`);
      }
    },
  };
}
