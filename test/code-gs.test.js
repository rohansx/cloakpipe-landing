// apps-script/Code.gs itself, run in a vm against fake Google services.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEADER } from '../api/_lib/row.js';
import { fakeAppsScript, SECRET } from './fake-apps-script.js';

const post = (g, body) => JSON.parse(g.sandbox.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).text);
const entry = (over = {}) => ({ timestamp: '2026-10-09T12:00:00.000Z', email: 'ada@example.com', name: 'Ada', company: 'Co', role: 'Other', useCase: 'x', source: '/waitlist', utmSource: '', utmMedium: '', utmCampaign: '', userAgent: 'curl', ...over });

test('creates the tab and header row, then appends; answers JSON', () => {
  const g = fakeAppsScript();
  const out = g.sandbox.doPost({ postData: { contents: JSON.stringify({ secret: SECRET, entry: entry() }) } });
  assert.equal(out.mime, 'application/json');
  assert.deepEqual(JSON.parse(out.text), { status: 'joined' });
  assert.deepEqual(g.rows()[0], HEADER);
  assert.deepEqual(g.rows()[1], ['2026-10-09T12:00:00.000Z', 'ada@example.com', 'Ada', 'Co', 'Other', 'x', '/waitlist', '', '', '', 'curl']);
  assert.equal(g.sheet.sheets.get('Waitlist').frozen, 1);
});

test('dedupes by email, case-insensitively, reading column B (also de-neutralised values)', () => {
  const g = fakeAppsScript({ tabs: { Waitlist: [HEADER, ['t', 'ADA@example.com'], ['t', "'+x@y.co"]] } });
  assert.deepEqual(post(g, { secret: SECRET, entry: entry({ email: 'Ada@Example.COM ' }) }), { status: 'already' });
  assert.deepEqual(post(g, { secret: SECRET, entry: entry({ email: '+x@y.co' }) }), { status: 'already' });
  assert.equal(g.rows().length, 3);
  assert.deepEqual(post(g, { secret: SECRET, entry: entry({ email: 'new@example.com' }) }), { status: 'joined' });
  assert.equal(g.rows().length, 4);
});

test('does not rewrite the header when the tab has data', () => {
  const g = fakeAppsScript({ tabs: { Waitlist: [['My own header'], ['t', 'old@example.com']] } });
  post(g, { secret: SECRET, entry: entry() });
  assert.deepEqual(g.rows()[0], ['My own header']);
  assert.equal(g.rows().length, 3);
});

test('neutralises leading = + - @ again, and caps cells', () => {
  const g = fakeAppsScript();
  post(g, { secret: SECRET, entry: entry({ name: '=HYPERLINK("x")', company: '+1', useCase: '-2', utmSource: '@SUM(A1)', role: 'y'.repeat(5000) }) });
  const row = g.rows()[1];
  assert.equal(row[2], "'=HYPERLINK(\"x\")");
  assert.equal(row[3], "'+1");
  assert.equal(row[5], "'-2");
  assert.equal(row[7], "'@SUM(A1)");
  assert.equal(row[4].length, 1000);
});

test('already-neutralised values are not double-prefixed', () => {
  const g = fakeAppsScript();
  post(g, { secret: SECRET, entry: entry({ name: "'=x" }) });
  assert.equal(g.rows()[1][2], "'=x");
});

test('secret: wrong, missing, non-string, or unset property → error, nothing written', () => {
  const g = fakeAppsScript();
  assert.deepEqual(post(g, { secret: SECRET + 'x', entry: entry() }), { error: 'unauthorized' });
  assert.deepEqual(post(g, { secret: SECRET.slice(0, -1), entry: entry() }), { error: 'unauthorized' });
  assert.deepEqual(post(g, { entry: entry() }), { error: 'unauthorized' });
  assert.deepEqual(post(g, { secret: [SECRET], entry: entry() }), { error: 'unauthorized' });
  assert.equal(g.rows(), undefined);
  assert.deepEqual(post(fakeAppsScript({ properties: {} }), { secret: SECRET, entry: entry() }), { error: 'not_configured' });
});

test('bad bodies → bad_request', () => {
  const g = fakeAppsScript();
  assert.deepEqual(post(g, '{nope'), { error: 'bad_request' });
  assert.deepEqual(post(g, 'null'), { error: 'bad_request' });
  assert.deepEqual(post(g, { secret: SECRET }), { error: 'bad_request' });
  assert.deepEqual(post(g, { secret: SECRET, entry: entry({ email: 'no-at-sign' }) }), { error: 'bad_request' });
  assert.deepEqual(JSON.parse(g.sandbox.doPost(undefined).text), { error: 'bad_request' });
});

test('takes the script lock and releases it, even when the sheet throws', () => {
  const g = fakeAppsScript();
  post(g, { secret: SECRET, entry: entry() });
  assert.equal(g.lock.acquired, 1);
  assert.equal(g.lock.held, false);
  g.sandbox.SpreadsheetApp.getActiveSpreadsheet = () => { throw new Error('boom'); };
  assert.deepEqual(post(g, { secret: SECRET, entry: entry({ email: 'b@example.com' }) }), { error: 'server' });
  assert.equal(g.lock.held, false);
});

test('a held lock → busy', () => {
  const g = fakeAppsScript();
  g.lock.held = true;
  assert.deepEqual(post(g, { secret: SECRET, entry: entry() }), { error: 'busy' });
});

test('WAITLIST_TAB property selects the tab', () => {
  const g = fakeAppsScript({ properties: { WAITLIST_SECRET: SECRET, WAITLIST_TAB: 'Signups' } });
  post(g, { secret: SECRET, entry: entry() });
  assert.equal(g.rows('Signups').length, 2);
  assert.equal(g.rows('Waitlist'), undefined);
});

test('grows the sheet past its row limit', () => {
  const g = fakeAppsScript({ tabs: { Waitlist: [HEADER] } });
  g.sheet.sheets.get('Waitlist').maxRows = 2;
  post(g, { secret: SECRET, entry: entry({ email: 'a@example.com' }) });
  post(g, { secret: SECRET, entry: entry({ email: 'b@example.com' }) });
  assert.equal(g.rows().length, 3);
});

test('doGet is a data-free health check', () => {
  const g = fakeAppsScript({ tabs: { Waitlist: [HEADER, ['t', 'ada@example.com']] } });
  const out = g.sandbox.doGet({});
  assert.deepEqual(JSON.parse(out.text), { ok: true });
});
