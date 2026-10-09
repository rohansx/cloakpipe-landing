import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HEADER, KEYS, neutralize, uaFamily, buildEntry } from '../api/_lib/row.js';

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

test('buildEntry keys follow HEADER order and every value is neutralised', () => {
  const entry = buildEntry(
    { email: 'ada@example.com', name: '=evil()', company: 'Co', role: 'Other', useCase: '-x', source: '/waitlist', utmSource: '@s', utmMedium: 'm', utmCampaign: 'c' },
    { now: Date.UTC(2026, 9, 9, 12, 0, 0), userAgent: 'curl/8' },
  );
  assert.deepEqual(Object.keys(entry), KEYS);
  assert.equal(KEYS.length, HEADER.length);
  assert.deepEqual(Object.values(entry), ['2026-10-09T12:00:00.000Z', 'ada@example.com', "'=evil()", 'Co', 'Other', "'-x", '/waitlist', "'@s", 'm', 'c', 'curl']);
  assert.deepEqual(HEADER, ['Timestamp (UTC)', 'Email', 'Name', 'Company', 'Role', 'Use case', 'Source page', 'UTM source', 'UTM medium', 'UTM campaign', 'User agent']);
});

test('Code.gs COLUMNS match KEYS and HEADER (same columns in the sheet)', () => {
  const code = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
  const block = /var COLUMNS = \[([\s\S]*?)\];/.exec(code)[1];
  const cols = [...block.matchAll(/\['([^']+)', '([^']+)'\]/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(cols.map((c) => c[0]), KEYS);
  assert.deepEqual(cols.map((c) => c[1]), HEADER);
});
