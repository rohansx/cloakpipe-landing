import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEADER, neutralize, uaFamily, buildRow, quoteTab, createSheetsClient } from '../api/_lib/sheets.js';
import { fakeGoogle, SHEET_ID, TOKEN } from './fake-google.js';

const client = (g, tab = 'Waitlist') => createSheetsClient({ sheetId: SHEET_ID, tab, getToken: async () => TOKEN, fetch: g.fetch });

test('neutralize defuses leading formula characters', () => {
  assert.equal(neutralize('=HYPERLINK("x")'), "'=HYPERLINK(\"x\")");
  assert.equal(neutralize('+1'), "'+1");
  assert.equal(neutralize('-2'), "'-2");
  assert.equal(neutralize('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(neutralize('\t=1'), "'\t=1");
  assert.equal(neutralize('Ada = Lovelace'), 'Ada = Lovelace');
  assert.equal(neutralize(''), '');
});

test('uaFamily reports a short browser/OS family, never the full string', () => {
  const chromeMac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  const safariIos = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const edgeWin = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
  const ffLinux = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';
  const chromeAndroid = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
  assert.equal(uaFamily(chromeMac), 'Chrome/macOS');
  assert.equal(uaFamily(safariIos), 'Safari/iOS');
  assert.equal(uaFamily(edgeWin), 'Edge/Windows');
  assert.equal(uaFamily(ffLinux), 'Firefox/Linux');
  assert.equal(uaFamily(chromeAndroid), 'Chrome/Android');
  assert.equal(uaFamily('curl/8.7.1'), 'curl');
  assert.equal(uaFamily(''), 'unknown');
  assert.equal(uaFamily('Googlebot/2.1'), 'bot');
});

test('buildRow orders columns like HEADER and neutralises every cell', () => {
  const row = buildRow(
    { email: 'ada@example.com', name: '=evil()', company: 'Co', role: 'Other', useCase: '-x', source: '/waitlist', utmSource: '@s', utmMedium: 'm', utmCampaign: 'c' },
    { now: Date.UTC(2026, 9, 9, 12, 0, 0), userAgent: 'curl/8' },
  );
  assert.equal(row.length, HEADER.length);
  assert.deepEqual(row, ['2026-10-09T12:00:00.000Z', 'ada@example.com', "'=evil()", 'Co', 'Other', "'-x", '/waitlist', "'@s", 'm', 'c', 'curl']);
  assert.deepEqual(HEADER, ['Timestamp (UTC)', 'Email', 'Name', 'Company', 'Role', 'Use case', 'Source page', 'UTM source', 'UTM medium', 'UTM campaign', 'User agent']);
});

test('quoteTab quotes and escapes sheet names for A1 ranges', () => {
  assert.equal(quoteTab('Waitlist'), "'Waitlist'");
  assert.equal(quoteTab("Rohan's list"), "'Rohan''s list'");
});

test('readEmails reports an empty tab and the existing emails (lowercased, de-neutralised)', async () => {
  const empty = fakeGoogle();
  assert.deepEqual(await client(empty).readEmails(), { empty: true, emails: new Set() });
  const call = empty.calls[0];
  assert.equal(call.method, 'GET');
  assert.equal(call.url.href, `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent("'Waitlist'!A:B")}`);
  assert.equal(call.headers.get('authorization'), `Bearer ${TOKEN}`);

  const g = fakeGoogle({ tabs: { Waitlist: [HEADER, ['t', 'Ada@Example.com'], ['t', "'+x@y.co"]] } });
  const r = await client(g).readEmails();
  assert.equal(r.empty, false);
  assert.deepEqual([...r.emails].sort(), ['+x@y.co', 'ada@example.com']);
});

test('readEmails creates a missing tab instead of failing', async () => {
  const g = fakeGoogle({ tabs: { Sheet1: [] } });
  assert.deepEqual(await client(g).readEmails(), { empty: true, emails: new Set() });
  const add = g.calls.find((c) => c.url.pathname.endsWith(':batchUpdate'));
  assert.ok(add, 'batchUpdate called');
  assert.deepEqual(JSON.parse(add.body), { requests: [{ addSheet: { properties: { title: 'Waitlist' } } }] });
  assert.ok('Waitlist' in g.sheet.tabs);
});

test('writeHeader PUTs the header row with valueInputOption=RAW', async () => {
  const g = fakeGoogle();
  await client(g).writeHeader();
  const c = g.calls[0];
  assert.equal(c.method, 'PUT');
  assert.equal(c.url.pathname, `/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent("'Waitlist'!A1:K1")}`);
  assert.equal(c.url.searchParams.get('valueInputOption'), 'RAW');
  assert.deepEqual(JSON.parse(c.body), { values: [HEADER] });
  assert.deepEqual(g.sheet.tabs.Waitlist[0], HEADER);
});

test('appendRow POSTs :append with valueInputOption=RAW and INSERT_ROWS', async () => {
  const g = fakeGoogle({ tabs: { Waitlist: [HEADER] } });
  const row = HEADER.map((_, i) => `v${i}`);
  await client(g).appendRow(row);
  const c = g.calls[0];
  assert.equal(c.method, 'POST');
  assert.equal(c.url.pathname, `/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent("'Waitlist'!A:K")}:append`);
  assert.equal(c.url.searchParams.get('valueInputOption'), 'RAW');
  assert.equal(c.url.searchParams.get('insertDataOption'), 'INSERT_ROWS');
  assert.equal(c.headers.get('content-type'), 'application/json');
  assert.deepEqual(JSON.parse(c.body), { values: [row] });
  assert.deepEqual(g.sheet.tabs.Waitlist[1], row);
});

test('Sheets errors throw a GoogleError carrying status and stage', async () => {
  const g = fakeGoogle({ failAt: 'append', failStatus: 503 });
  await assert.rejects(client(g).appendRow(['x']), (e) => e.name === 'GoogleError' && e.status === 503 && e.stage === 'append');
});
