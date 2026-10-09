import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppsScriptClient, isScriptUrl, UpstreamError, ECHO_HOST } from '../api/_lib/apps-script.js';
import { HEADER, buildEntry } from '../api/_lib/row.js';
import { fakeAppsScript, SCRIPT_URL, SECRET } from './fake-apps-script.js';

const entry = (over = {}) =>
  buildEntry({ email: 'ada@example.com', name: 'Ada', company: 'Analytical', role: 'Other', useCase: 'agents', source: '/waitlist', utmSource: '', utmMedium: '', utmCampaign: '', ...over }, { now: Date.UTC(2026, 9, 9), userAgent: 'curl/8' });
const client = (g, opts = {}) => createAppsScriptClient({ url: SCRIPT_URL, secret: SECRET, fetch: g.fetch, timeoutMs: 1000, ...opts });

async function rejectsUpstream(promise, check) {
  await assert.rejects(promise, (e) => {
    assert.ok(e instanceof UpstreamError, `UpstreamError, got ${e?.name}`);
    for (const s of [SECRET, SCRIPT_URL, 'AKfycb']) assert.ok(!`${e.message} ${e.detail} ${e.hint}`.includes(s), `error leaks ${s}`);
    check(e);
    return true;
  });
}

test('isScriptUrl accepts web app /exec URLs only', () => {
  assert.equal(isScriptUrl('https://script.google.com/macros/s/AKfycbx-1_Z/exec'), true);
  assert.equal(isScriptUrl('https://script.google.com/a/macros/example.com/s/AKfycbx/exec'), true);
  for (const u of ['http://script.google.com/macros/s/x/exec', 'https://script.google.com/macros/s/x/dev', 'https://evil.example/macros/s/x/exec',
    'https://script.google.com.evil.example/macros/s/x/exec', 'https://script.googleusercontent.com/macros/echo', 'not a url', '']) {
    assert.equal(isScriptUrl(u), false, u);
  }
});

test('success: POST with redirect:manual, then GET of the googleusercontent echo URL', async () => {
  const g = fakeAppsScript();
  assert.equal(await client(g).submit(entry()), 'joined');
  assert.equal(g.calls.length, 2);
  const [post, echo] = g.calls;
  assert.equal(post.url.href, SCRIPT_URL);
  assert.equal(post.method, 'POST');
  assert.equal(post.redirect, 'manual');
  assert.equal(post.headers.get('content-type'), 'application/json');
  assert.deepEqual(JSON.parse(post.body), { secret: SECRET, entry: entry() });
  assert.equal(echo.url.hostname, ECHO_HOST);
  assert.equal(echo.url.pathname, '/macros/echo');
  assert.equal(echo.method, 'GET', 'the echo URL is fetched with GET (a re-POST fails)');
  assert.equal(echo.body, undefined);
  assert.deepEqual(g.rows()[0], HEADER);
  assert.equal(g.rows()[1][1], 'ada@example.com');
});

test('already on the list → "already", no second row', async () => {
  const g = fakeAppsScript({ tabs: { Waitlist: [HEADER, ['t', 'Ada@Example.com']] } });
  assert.equal(await client(g).submit(entry()), 'already');
  assert.equal(g.rows().length, 2);
});

test('wrong secret → UpstreamError(script, unauthorized) with a hint, secret not echoed', async () => {
  const g = fakeAppsScript({ properties: { WAITLIST_SECRET: 'b'.repeat(64) } });
  await rejectsUpstream(client(g).submit(entry()), (e) => {
    assert.equal(e.stage, 'script');
    assert.match(e.detail, /unauthorized/);
    assert.match(e.hint, /WAITLIST_SCRIPT_SECRET/);
  });
  assert.equal(g.rows(), undefined, 'nothing written');
});

test('script without WAITLIST_SECRET property → not_configured', async () => {
  const g = fakeAppsScript({ properties: {} });
  await rejectsUpstream(client(g).submit(entry()), (e) => assert.match(e.detail, /not_configured/));
});

test('302 to Google sign-in (deployment not "Anyone") → redirect error with an access hint, not followed', async () => {
  const g = fakeAppsScript({ mode: 'signin' });
  await rejectsUpstream(client(g).submit(entry()), (e) => {
    assert.equal(e.stage, 'redirect');
    assert.match(e.hint, /Anyone/);
  });
  assert.equal(g.calls.length, 1, 'sign-in page is not fetched');
});

test('200 HTML sign-in page → response error with an access hint', async () => {
  const g = fakeAppsScript({ mode: 'signin-html' });
  await rejectsUpstream(client(g).submit(entry()), (e) => {
    assert.equal(e.stage, 'response');
    assert.match(e.detail, /HTML/);
    assert.match(e.hint, /sign-in.*Anyone/);
  });
});

test('HTML from the echo URL (doPost threw / function missing) → response error', async () => {
  const g = fakeAppsScript({ mode: 'html' });
  await rejectsUpstream(client(g).submit(entry()), (e) => {
    assert.equal(e.stage, 'response');
    assert.match(e.hint, /Executions/);
  });
});

test('non-JSON text → response error', async () => {
  const g = fakeAppsScript({ mode: 'not-json' });
  await rejectsUpstream(client(g).submit(entry()), (e) => assert.equal(e.stage, 'response'));
});

test('HTTP 500 from /exec → post error', async () => {
  const g = fakeAppsScript({ mode: 'http500' });
  await rejectsUpstream(client(g).submit(entry()), (e) => {
    assert.equal(e.stage, 'post');
    assert.equal(e.status, 500);
  });
});

test('redirect to any host other than script.googleusercontent.com is refused', async () => {
  const g = fakeAppsScript({ mode: 'offsite' });
  await rejectsUpstream(client(g).submit(entry()), (e) => {
    assert.equal(e.stage, 'redirect');
    assert.match(e.detail, /evil\.example/);
  });
  assert.equal(g.calls.length, 1);
});

test('timeout on the POST and on the echo GET → timeout error', async () => {
  for (const mode of ['hang', 'echo-hang']) {
    const g = fakeAppsScript({ mode });
    const t0 = Date.now();
    await rejectsUpstream(client(g, { timeoutMs: 50 }).submit(entry()), (e) => assert.equal(e.stage, 'timeout', mode));
    assert.ok(Date.now() - t0 < 1000, `${mode} gave up promptly`);
  }
});

test('network failure → post error naming only the error code', async () => {
  const fetch = async () => { const e = new TypeError('fetch failed'); e.cause = { code: 'ENOTFOUND' }; throw e; };
  await rejectsUpstream(createAppsScriptClient({ url: SCRIPT_URL, secret: SECRET, fetch }).submit(entry()), (e) => {
    assert.equal(e.stage, 'post');
    assert.match(e.detail, /ENOTFOUND/);
  });
});
