import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, REQUIRED_ENV } from '../api/_lib/handler.js';
import { createRateLimiter } from '../api/_lib/guard.js';
import { HEADER } from '../api/_lib/row.js';
import { fakeAppsScript, SCRIPT_URL, SECRET } from './fake-apps-script.js';

const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);
const ENV = {
  WAITLIST_SCRIPT_URL: SCRIPT_URL,
  WAITLIST_SCRIPT_SECRET: SECRET,
  VERCEL_ENV: 'production',
};
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function setup({ env = ENV, google = fakeAppsScript(), limit = 100, timeoutMs = 1000 } = {}) {
  const logs = [];
  const log = { error: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')) };
  const rateLimiter = createRateLimiter({ limit, windowMs: 60_000, now: () => NOW });
  const handle = createHandler({ fetch: google.fetch, now: () => NOW, rateLimiter, log, timeoutMs });
  return { handle: (req) => handle(req, env), google, logs };
}

const fields = (over = {}) => ({ email: 'Ada@Example.com', name: 'Ada', company: 'Analytical', role: 'Engineering/ML', use_case: 'support agents', started_at: String(NOW - 8000), ...over });

function jsonReq(body, { headers = {}, method = 'POST' } = {}) {
  return new Request('https://cloakpipe.co/api/waitlist', {
    method,
    headers: { origin: 'https://cloakpipe.co', 'content-type': 'application/json', accept: 'application/json', 'user-agent': UA, 'x-forwarded-for': '203.0.113.7', ...headers },
    body: method === 'GET' || method === 'HEAD' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}
function formReq(body, { headers = {} } = {}) {
  return new Request('https://cloakpipe.co/api/waitlist', {
    method: 'POST',
    headers: { origin: 'https://cloakpipe.co', referer: 'https://cloakpipe.co/waitlist?utm_source=hn&utm_medium=post&utm_campaign=launch', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA, 'x-forwarded-for': '203.0.113.8', ...headers },
    body: new URLSearchParams(body).toString(),
  });
}

test('non-POST methods get 405 with Allow: POST', async () => {
  const { handle } = setup({ env: {} });
  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
    const res = await handle(jsonReq(null, { method }));
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get('allow'), 'POST');
  }
});

test('missing env vars → 503 JSON, names logged server-side, no upstream call', async () => {
  for (const missing of REQUIRED_ENV) {
    const env = { ...ENV };
    delete env[missing];
    const { handle, google, logs } = setup({ env });
    const res = await handle(jsonReq(fields()));
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error, 'unavailable');
    assert.equal(google.calls.length, 0);
    assert.ok(logs.some((l) => l.includes(missing)), `logs name ${missing}`);
    assert.ok(!JSON.stringify(body).includes('WAITLIST_'), 'env names not echoed to the client');
  }
  assert.deepEqual(REQUIRED_ENV, ['WAITLIST_SCRIPT_URL', 'WAITLIST_SCRIPT_SECRET']);
});

test('misconfigured env (not an /exec URL, short secret) → 503, logged without values', async () => {
  for (const [over, needle] of [
    [{ WAITLIST_SCRIPT_URL: 'https://docs.google.com/spreadsheets/d/abc/edit' }, 'WAITLIST_SCRIPT_URL'],
    [{ WAITLIST_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbx/dev' }, 'WAITLIST_SCRIPT_URL'],
    [{ WAITLIST_SCRIPT_SECRET: 'short-secret' }, 'WAITLIST_SCRIPT_SECRET'],
  ]) {
    const { handle, google, logs } = setup({ env: { ...ENV, ...over } });
    const res = await handle(jsonReq(fields()));
    assert.equal(res.status, 503);
    assert.equal(google.calls.length, 0);
    assert.ok(logs.some((l) => l.includes(needle)), needle);
    assert.ok(!logs.join('\n').includes('short-secret'), 'secret value not logged');
  }
});

test('missing env on a no-JS form post redirects with ?error=unavailable', async () => {
  const { handle } = setup({ env: {} });
  const res = await handle(formReq(fields()));
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /^\/waitlist\?error=unavailable#/);
});

test('happy path (JSON): forwarded to the script, header row auto-created, row appended', async () => {
  const { handle, google } = setup();
  const res = await handle(jsonReq(fields({ source: '/waitlist', utm_source: 'x' })));
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { status: 'joined' });
  assert.equal(res.headers.get('cache-control'), 'no-store');

  const rows = google.rows();
  assert.deepEqual(rows[0], HEADER);
  assert.deepEqual(rows[1], ['2026-10-09T12:00:00.000Z', 'ada@example.com', 'Ada', 'Analytical', 'Engineering/ML', 'support agents', '/waitlist', 'x', '', '', 'Chrome/macOS']);
  const [post, echo] = google.calls;
  assert.equal(post.method, 'POST');
  assert.equal(JSON.parse(post.body).secret, SECRET);
  assert.equal(echo.method, 'GET');
  assert.ok(!JSON.stringify(rows).includes('203.0.113'), 'IP never stored');
  assert.ok(!post.body.includes('203.0.113'), 'IP never sent');
});

test('formula-looking input is neutralised before it reaches the sheet', async () => {
  const { handle, google } = setup();
  assert.equal((await handle(jsonReq(fields({ name: '=IMPORTXML("http://x")', company: '@evil' })))).status, 201);
  const row = google.rows()[1];
  assert.equal(row[2], `'=IMPORTXML("http://x")`);
  assert.equal(row[3], "'@evil");
});

test('duplicate email → 200 {status:"already"} and no append', async () => {
  const google = fakeAppsScript({ tabs: { Waitlist: [HEADER, ['t', 'ada@example.com']] } });
  const { handle } = setup({ google });
  const res = await handle(jsonReq(fields({ email: '  ADA@example.COM ' })));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'already' });
  assert.equal(google.rows().length, 2);
});

test('form post (no JS): 303 to ?joined=1, UTM and source taken from the Referer', async () => {
  const { handle, google } = setup();
  const res = await handle(formReq(fields()));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/waitlist?joined=1#wl-joined');
  const row = google.rows()[1];
  assert.deepEqual(row.slice(6, 10), ['/waitlist', 'hn', 'post', 'launch']);
});

test('form post duplicate → 303 to ?joined=already', async () => {
  const google = fakeAppsScript({ tabs: { Waitlist: [HEADER, ['t', 'ada@example.com']] } });
  const { handle } = setup({ google });
  const res = await handle(formReq(fields()));
  assert.equal(res.headers.get('location'), '/waitlist?joined=already#wl-already');
});

test('validation errors: 400 JSON or 303 with ?error=', async () => {
  const { handle } = setup();
  let res = await handle(jsonReq(fields({ email: 'nope' })));
  assert.equal(res.status, 400);
  let body = await res.json();
  assert.equal(body.error, 'invalid_email');
  assert.equal(body.field, 'email');
  assert.equal(typeof body.message, 'string');
  res = await handle(jsonReq(fields({ role: 'Wizard' })));
  assert.equal((await res.json()).error, 'invalid_role');
  res = await handle(jsonReq(fields({ use_case: 'x'.repeat(1001) })));
  body = await res.json();
  assert.equal(body.error, 'too_long');
  assert.equal(body.field, 'use_case');
  res = await handle(jsonReq(fields({ started_at: String(NOW - 300) })));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'too_fast');
  res = await handle(formReq(fields({ email: 'nope' })));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/waitlist?error=invalid_email#wl-error');
});

test('honeypot: pretend success, write nothing', async () => {
  const { handle, google } = setup();
  const res = await handle(jsonReq(fields({ cp_hp: 'http://spam.example' })));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'joined' });
  assert.equal(google.calls.length, 0);
});

test('foreign origin → 403, nothing written', async () => {
  const { handle, google } = setup();
  const res = await handle(jsonReq(fields(), { headers: { origin: 'https://evil.example' } }));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'forbidden');
  assert.equal(google.calls.length, 0);
});

test('rate limit: the 6th request in a minute from one IP gets 429', async () => {
  const { handle } = setup({ limit: 5 });
  for (let i = 0; i < 5; i++) assert.notEqual((await handle(jsonReq(fields({ email: `u${i}@example.com` })))).status, 429);
  const res = await handle(jsonReq(fields({ email: 'u6@example.com' })));
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('retry-after'), '60');
  const other = await handle(jsonReq(fields({ email: 'z@example.com' }), { headers: { 'x-forwarded-for': '198.51.100.1' } }));
  assert.equal(other.status, 201);
});

test('unsupported content type → 415; malformed JSON → 400; oversized body → 413', async () => {
  const { handle } = setup();
  let res = await handle(jsonReq('email=a', { headers: { 'content-type': 'text/plain' } }));
  assert.equal(res.status, 415);
  res = await handle(jsonReq('{not json'));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid');
  res = await handle(jsonReq('[1,2]'));
  assert.equal(res.status, 400);
  res = await handle(jsonReq(JSON.stringify({ ...fields(), pad: 'x'.repeat(20_000) })));
  assert.equal(res.status, 413);
});

test('upstream failures → 502 (504 on timeout) with a friendly message; secret never leaked', async () => {
  const cases = [
    [{ properties: { WAITLIST_SECRET: 'c'.repeat(64) } }, 502, /unauthorized.*hint: WAITLIST_SCRIPT_SECRET/],
    [{ mode: 'signin' }, 502, /sign-in.*Anyone/],
    [{ mode: 'signin-html' }, 502, /HTML.*Anyone/],
    [{ mode: 'html' }, 502, /HTML/],
    [{ mode: 'not-json' }, 502, /not a JSON/],
    [{ mode: 'http500' }, 502, /HTTP 500/],
    [{ mode: 'offsite' }, 502, /unexpected redirect/],
    [{ mode: 'hang' }, 504, /timeout/],
    [{ mode: 'echo-hang' }, 504, /timeout/],
  ];
  for (const [opts, status, logPattern] of cases) {
    const label = JSON.stringify(opts);
    const { handle, logs } = setup({ google: fakeAppsScript(opts), timeoutMs: 50 });
    const res = await handle(jsonReq(fields()));
    assert.equal(res.status, status, label);
    const text = await res.text();
    const body = JSON.parse(text);
    assert.equal(body.error, 'upstream', label);
    assert.ok(body.message.length > 0);
    const all = `${text}\n${logs.join('\n')}`;
    for (const secret of [SECRET, SCRIPT_URL, 'AKfycb', 'c'.repeat(64), '<html', 'stack']) {
      assert.ok(!all.includes(secret), `${label}: leaks ${secret}`);
    }
    assert.ok(!text.includes('hint'), `${label}: hint stays in the server log`);
    assert.ok(logs.some((l) => logPattern.test(l)), `${label}: log ${logs.join(' | ')}`);
  }
});

test('upstream error on a form post → 303 ?error=server', async () => {
  const { handle } = setup({ google: fakeAppsScript({ mode: 'html' }) });
  const res = await handle(formReq(fields()));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/waitlist?error=server#wl-error');
});
