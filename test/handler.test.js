import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createHandler, REQUIRED_ENV } from '../api/_lib/handler.js';
import { createRateLimiter } from '../api/_lib/guard.js';
import { HEADER } from '../api/_lib/sheets.js';
import { fakeGoogle, SHEET_ID, TOKEN } from './fake-google.js';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const SA_EMAIL = 'waitlist@proj.iam.gserviceaccount.com';
const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);
const ENV = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: SA_EMAIL,
  GOOGLE_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n'),
  WAITLIST_SHEET_ID: SHEET_ID,
  VERCEL_ENV: 'production',
};
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function setup({ env = ENV, google = fakeGoogle(), limit = 100 } = {}) {
  const logs = [];
  const log = { error: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')) };
  const rateLimiter = createRateLimiter({ limit, windowMs: 60_000, now: () => NOW });
  const handle = createHandler({ fetch: google.fetch, now: () => NOW, rateLimiter, log });
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

test('missing env vars → 503 JSON, names logged server-side, no Google call', async () => {
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
    assert.ok(!JSON.stringify(body).includes('GOOGLE'), 'env names not echoed to the client');
  }
  assert.deepEqual(REQUIRED_ENV, ['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'WAITLIST_SHEET_ID']);
});

test('missing env on a no-JS form post redirects with ?error=unavailable', async () => {
  const { handle } = setup({ env: {} });
  const res = await handle(formReq(fields()));
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /^\/waitlist\?error=unavailable#/);
});

test('happy path (JSON): header row auto-created, then one RAW append', async () => {
  const { handle, google } = setup();
  const res = await handle(jsonReq(fields({ source: '/waitlist', utm_source: 'x' })));
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { status: 'joined' });
  assert.equal(res.headers.get('cache-control'), 'no-store');

  const rows = google.sheet.tabs.Waitlist;
  assert.deepEqual(rows[0], HEADER);
  assert.deepEqual(rows[1], ['2026-10-09T12:00:00.000Z', 'ada@example.com', 'Ada', 'Analytical', 'Engineering/ML', 'support agents', '/waitlist', 'x', '', '', 'Chrome/macOS']);
  const append = google.calls.find((c) => c.url.pathname.endsWith(':append'));
  assert.equal(append.url.searchParams.get('valueInputOption'), 'RAW');
  assert.ok(!JSON.stringify(rows).includes('203.0.113'), 'IP never stored');
});

test('the header row is not rewritten when the tab already has data', async () => {
  const google = fakeGoogle({ tabs: { Waitlist: [HEADER, ['t', 'old@example.com']] } });
  const { handle } = setup({ google });
  assert.equal((await handle(jsonReq(fields()))).status, 201);
  assert.equal(google.calls.filter((c) => c.method === 'PUT').length, 0);
  assert.equal(google.sheet.tabs.Waitlist.length, 3);
});

test('duplicate email → 200 {status:"already"} and no append', async () => {
  const google = fakeGoogle({ tabs: { Waitlist: [HEADER, ['t', 'ada@example.com']] } });
  const { handle } = setup({ google });
  const res = await handle(jsonReq(fields({ email: '  ADA@example.COM ' })));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'already' });
  assert.equal(google.calls.filter((c) => c.url.pathname.endsWith(':append')).length, 0);
});

test('form post (no JS): 303 to ?joined=1, UTM and source taken from the Referer', async () => {
  const { handle, google } = setup();
  const res = await handle(formReq(fields()));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/waitlist?joined=1#wl-joined');
  const row = google.sheet.tabs.Waitlist[1];
  assert.deepEqual(row.slice(6, 10), ['/waitlist', 'hn', 'post', 'launch']);
});

test('form post duplicate → 303 to ?joined=already', async () => {
  const google = fakeGoogle({ tabs: { Waitlist: [HEADER, ['t', 'ada@example.com']] } });
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

test('Google error → 502 with a friendly message and no secret leaked', async () => {
  for (const failAt of ['token', 'read', 'header', 'append']) {
    const google = fakeGoogle({ failAt });
    const { handle, logs } = setup({ google });
    const res = await handle(jsonReq(fields()));
    assert.equal(res.status, 502, failAt);
    const text = await res.text();
    const body = JSON.parse(text);
    assert.equal(body.error, 'upstream');
    assert.ok(body.message.length > 0);
    for (const secret of [TOKEN, SHEET_ID, SA_EMAIL, 'PRIVATE KEY', 'boom', 'stack', 'at ']) {
      assert.ok(!text.includes(secret), `${failAt}: response leaks ${secret}`);
    }
    assert.ok(logs.some((l) => l.includes(failAt === 'token' ? 'token' : failAt)), `${failAt} logged`);
    assert.ok(!logs.join('\n').includes('PRIVATE KEY') && !logs.join('\n').includes(TOKEN), 'logs carry no secrets');
  }
});

test('Google error on a form post → 303 ?error=server', async () => {
  const { handle } = setup({ google: fakeGoogle({ failAt: 'append' }) });
  const res = await handle(formReq(fields()));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/waitlist?error=server#wl-error');
});

test('WAITLIST_SHEET_TAB overrides the tab name', async () => {
  const google = fakeGoogle({ tabs: { Signups: [] } });
  const { handle } = setup({ env: { ...ENV, WAITLIST_SHEET_TAB: 'Signups' }, google });
  assert.equal((await handle(jsonReq(fields()))).status, 201);
  assert.equal(google.sheet.tabs.Signups.length, 2);
});

test('the access token is reused across requests (module-scope cache)', async () => {
  const { handle, google } = setup();
  await handle(jsonReq(fields({ email: 'a1@example.com' })));
  await handle(jsonReq(fields({ email: 'a2@example.com' })));
  assert.equal(google.calls.filter((c) => c.url.hostname === 'oauth2.googleapis.com').length, 1);
});
