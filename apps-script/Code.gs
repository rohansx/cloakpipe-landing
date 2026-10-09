/**
 * CloakPipe waitlist: Google Apps Script web app bound to the waitlist sheet.
 *
 * The site's Vercel Function (api/waitlist.js) validates each signup and POSTs
 * it here as JSON: {"secret": "...", "entry": {"email": "...", ...}}.
 * This script checks the shared secret, de-duplicates by email and appends one
 * row. It answers JSON: {"status":"joined"}, {"status":"already"} or
 * {"error":"<code>"}. Web apps cannot set HTTP status codes, so errors are
 * reported in the body.
 *
 * Script properties (Project Settings > Script properties):
 *   WAITLIST_SECRET  required, same value as WAITLIST_SCRIPT_SECRET in Vercel
 *   WAITLIST_TAB     optional sheet tab name, default "Waitlist"
 *
 * Deploy as a web app: Execute as "Me", Who has access "Anyone".
 * Setup steps: README.md, "Waitlist setup", in rohansx/cloakpipe-landing.
 */

// [JSON key, header]. Keep in sync with api/_lib/row.js (KEYS, HEADER).
var COLUMNS = [
  ['timestamp', 'Timestamp (UTC)'],
  ['email', 'Email'],
  ['name', 'Name'],
  ['company', 'Company'],
  ['role', 'Role'],
  ['useCase', 'Use case'],
  ['source', 'Source page'],
  ['utmSource', 'UTM source'],
  ['utmMedium', 'UTM medium'],
  ['utmCampaign', 'UTM campaign'],
  ['userAgent', 'User agent'],
];
var EMAIL_COL = 2; // column B
var DEFAULT_TAB = 'Waitlist';
var MAX_CELL = 1000; // the site caps fields at 1000 characters (use case)
var LOCK_WAIT_MS = 10000;

function doPost(e) {
  try {
    var req;
    try {
      req = JSON.parse((e && e.postData && e.postData.contents) || '');
    } catch (err) {
      return json_({ error: 'bad_request' });
    }
    if (!req || typeof req !== 'object') return json_({ error: 'bad_request' });

    var props = PropertiesService.getScriptProperties();
    var expected = props.getProperty('WAITLIST_SECRET');
    if (!expected) return json_({ error: 'not_configured' });
    if (typeof req.secret !== 'string' || !safeEqual_(req.secret, expected)) return json_({ error: 'unauthorized' });

    var entry = req.entry;
    if (!entry || typeof entry !== 'object') return json_({ error: 'bad_request' });
    var email = String(entry.email == null ? '' : entry.email).trim().toLowerCase();
    if (!email || email.length > 254 || email.indexOf('@') < 1) return json_({ error: 'bad_request' });

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(LOCK_WAIT_MS)) return json_({ error: 'busy' });
    try {
      var sheet = sheet_(props.getProperty('WAITLIST_TAB') || DEFAULT_TAB);
      if (sheet.getLastRow() === 0) {
        sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS.map(function (c) { return c[1]; })]);
        sheet.setFrozenRows(1);
      }
      var last = sheet.getLastRow();
      if (last > 1) {
        var emails = sheet.getRange(2, EMAIL_COL, last - 1, 1).getValues();
        for (var i = 0; i < emails.length; i++) {
          if (String(emails[i][0]).trim().replace(/^'/, '').toLowerCase() === email) return json_({ status: 'already' });
        }
      }
      var row = COLUMNS.map(function (c) {
        var v = c[0] === 'email' ? email : entry[c[0]];
        return neutralize_(String(v == null ? '' : v).slice(0, MAX_CELL));
      });
      if (last + 1 > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 100);
      // Plain-text format first, so timestamps and numbers stay as typed.
      sheet.getRange(last + 1, 1, 1, row.length).setNumberFormat('@').setValues([row]);
      return json_({ status: 'joined' });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    console.error('waitlist doPost failed: ' + (err && err.name ? err.name : 'error'));
    return json_({ error: 'server' });
  }
}

/** Health check: shows the deployment answers, without exposing any data. */
function doGet() {
  return json_({ ok: true });
}

function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

/** Text a spreadsheet could read as a formula gets a leading apostrophe. */
function neutralize_(s) {
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

/** Compares SHA-256 digests byte by byte without an early exit. */
function safeEqual_(a, b) {
  var da = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, a, Utilities.Charset.UTF_8);
  var db = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, b, Utilities.Charset.UTF_8);
  var diff = 0;
  for (var i = 0; i < da.length; i++) diff |= da[i] ^ db[i];
  return diff === 0;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
