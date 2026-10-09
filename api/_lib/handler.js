// POST /api/waitlist: validate a signup and forward it to the Google Apps
// Script web app that appends it to the waitlist sheet (apps-script/Code.gs).
// Web-standard Request -> Response, so it runs on Vercel's Node runtime and in
// tests without a server.

import { validateSubmission } from './validate.js';
import { isAllowedOrigin, clientIp } from './guard.js';
import { createAppsScriptClient, isScriptUrl, UpstreamError, DEFAULT_TIMEOUT_MS } from './apps-script.js';
import { buildEntry } from './row.js';

export const REQUIRED_ENV = ['WAITLIST_SCRIPT_URL', 'WAITLIST_SCRIPT_SECRET'];
/** Shorter secrets are refused as misconfiguration (`openssl rand -hex 32` gives 64). */
export const MIN_SECRET_LENGTH = 32;
const MAX_BODY = 16 * 1024;
const PAGE = '/waitlist';

const MESSAGES = {
  invalid_email: 'Please enter a valid email address.',
  too_long: 'One of the fields is too long.',
  invalid_role: 'Please pick a role from the list.',
  invalid: 'We could not read that submission. Please try again.',
  invalid_timing: 'We could not read that submission. Please reload the page and try again.',
  too_fast: 'That was quick. Please wait a moment and submit again.',
  forbidden: 'Please submit the form from cloakpipe.co.',
  rate_limited: 'Too many attempts. Please wait a minute and try again.',
  unsupported: 'Unsupported content type.',
  too_large: 'That submission is too large.',
  unavailable: 'The waitlist is temporarily unavailable. Please try again later or email us.',
  upstream: 'Something went wrong on our side. Please try again later or email us.',
  server: 'Something went wrong on our side. Please try again later or email us.',
};

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });

const redirect = (location) => new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store' } });

/** Fragment ids on /waitlist that show the matching message without JS (CSS :target). */
const formLocation = (outcome) =>
  outcome === 'joined' ? `${PAGE}?joined=1#wl-joined`
  : outcome === 'already' ? `${PAGE}?joined=already#wl-already`
  : `${PAGE}?error=${encodeURIComponent(outcome)}#wl-error`;

function wantsJson(request) {
  const accept = request.headers.get('accept') ?? '';
  const type = request.headers.get('content-type') ?? '';
  return accept.includes('application/json') || type.includes('application/json');
}

/** Same-origin Referer as a URL (source page + UTM fallback for no-JS posts). */
function refererUrl(request, env) {
  const ref = request.headers.get('referer');
  if (!ref) return null;
  try {
    const u = new URL(ref);
    return isAllowedOrigin(new Headers({ origin: u.origin }), env) ? u : null;
  } catch {
    return null;
  }
}

async function readFields(request) {
  const declared = Number(request.headers.get('content-length'));
  if (declared > MAX_BODY) return { error: 'too_large', status: 413 };
  const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json' && type !== 'application/x-www-form-urlencoded') return { error: 'unsupported', status: 415 };
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY) return { error: 'too_large', status: 413 };
  if (type === 'application/x-www-form-urlencoded') {
    const params = new URLSearchParams(raw);
    const fields = {};
    for (const k of new Set(params.keys())) fields[k] = params.get(k);
    return { fields };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: 'invalid', status: 400 };
    return { fields: parsed };
  } catch {
    return { error: 'invalid', status: 400 };
  }
}

/** Names of the env problems, for the server log only (never values). */
function configProblems(env) {
  const missing = REQUIRED_ENV.filter((k) => !String(env[k] ?? '').trim());
  if (missing.length) return `missing env var(s): ${missing.join(', ')}`;
  if (!isScriptUrl(env.WAITLIST_SCRIPT_URL.trim())) return 'WAITLIST_SCRIPT_URL is not an Apps Script web app URL (https://script.google.com/macros/s/<id>/exec)';
  if (env.WAITLIST_SCRIPT_SECRET.trim().length < MIN_SECRET_LENGTH) return `WAITLIST_SCRIPT_SECRET is shorter than ${MIN_SECRET_LENGTH} characters (use: openssl rand -hex 32)`;
  return '';
}

export function createHandler({ fetch = globalThis.fetch, now = () => Date.now(), rateLimiter, log = console, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return async function handle(request, env = {}) {
    if (request.method !== 'POST') {
      return json(405, { error: 'method_not_allowed', message: 'Use POST.' }, { allow: 'POST' });
    }
    const asJson = wantsJson(request);
    const fail = (status, error, extra = {}, headers = {}) =>
      asJson ? json(status, { error, ...extra, message: MESSAGES[error] ?? MESSAGES.server }, headers) : redirect(formLocation(error));

    const problem = configProblems(env);
    if (problem) {
      log.error(`waitlist: not configured, ${problem}`);
      return fail(503, 'unavailable');
    }

    if (!isAllowedOrigin(request.headers, env)) return fail(403, 'forbidden');
    if (rateLimiter && !rateLimiter.hit(clientIp(request.headers))) return fail(429, 'rate_limited', {}, { 'retry-after': '60' });

    const body = await readFields(request);
    if (body.error) return fail(body.status, body.error);

    // No-JS posts have no source/UTM hidden values: take them from the Referer.
    const ref = refererUrl(request, env);
    const fields = { ...body.fields };
    if (ref) {
      fields.source ||= ref.pathname;
      for (const k of ['utm_source', 'utm_medium', 'utm_campaign']) fields[k] ||= ref.searchParams.get(k) ?? '';
    }

    const v = validateSubmission(fields, { now: now() });
    if (!v.ok) {
      if (v.silent) return asJson ? json(200, { status: 'joined' }) : redirect(formLocation('joined'));
      return fail(400, v.error, v.field ? { field: v.field } : {});
    }

    const script = createAppsScriptClient({
      url: env.WAITLIST_SCRIPT_URL.trim(),
      secret: env.WAITLIST_SCRIPT_SECRET.trim(),
      fetch,
      timeoutMs,
    });
    let outcome;
    try {
      outcome = await script.submit(buildEntry(v.data, { now: now(), userAgent: request.headers.get('user-agent') ?? '' }));
    } catch (e) {
      if (e instanceof UpstreamError) {
        log.error(`waitlist: ${e.message}${e.hint ? ` (hint: ${e.hint})` : ''}`);
        const status = e.stage === 'timeout' ? 504 : 502;
        return asJson ? json(status, { error: 'upstream', message: MESSAGES.upstream }) : redirect(formLocation('server'));
      }
      log.error(`waitlist: unexpected ${e?.name ?? 'error'}`);
      return asJson ? json(500, { error: 'server', message: MESSAGES.server }) : redirect(formLocation('server'));
    }
    if (outcome === 'already') return asJson ? json(200, { status: 'already' }) : redirect(formLocation('already'));
    return asJson ? json(201, { status: 'joined' }) : redirect(formLocation('joined'));
  };
}
