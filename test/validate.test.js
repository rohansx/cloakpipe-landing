import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, LIMITS, MIN_FILL_MS, normalizeEmail, isValidEmail, validateSubmission } from '../api/_lib/validate.js';

const NOW = 1_800_000_000_000;
const base = (over = {}) => ({ email: 'Ada@Example.com', started_at: String(NOW - 10_000), ...over });

test('normalizeEmail trims and lowercases', () => {
  assert.equal(normalizeEmail('  Ada.Lovelace@Example.COM \n'), 'ada.lovelace@example.com');
  assert.equal(normalizeEmail(undefined), '');
});

test('isValidEmail accepts ordinary addresses', () => {
  for (const e of ['a@b.co', 'ada.lovelace@example.com', 'first+tag@sub.example.co.uk', 'x_y-z@my-domain.io']) {
    assert.equal(isValidEmail(e), true, e);
  }
});

test('isValidEmail rejects malformed or oversized addresses', () => {
  const long = 'a'.repeat(250) + '@b.co';
  for (const e of ['', 'plain', '@example.com', 'a@', 'a@b', 'a b@c.com', 'a@b..com', 'a..b@c.com', '.a@b.com', 'a.@b.com',
    '=cmd@x.com', '+a@x.com', 'a@-b.com', 'a@b.c', '"q"@b.com', 'a@b.com\n', long, 'x'.repeat(65) + '@b.com']) {
    assert.equal(isValidEmail(e), false, JSON.stringify(e));
  }
});

test('validateSubmission returns cleaned data', () => {
  const r = validateSubmission(
    base({ name: '  Ada ', company: 'Analytical', role: 'Platform/SRE', use_case: 'agents\r\nthat work', source: '/waitlist', utm_source: 'hn' }),
    { now: NOW },
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, {
    email: 'ada@example.com', name: 'Ada', company: 'Analytical', role: 'Platform/SRE', useCase: 'agents\nthat work',
    source: '/waitlist', utmSource: 'hn', utmMedium: '', utmCampaign: '',
  });
});

test('email is required and validated', () => {
  assert.deepEqual(validateSubmission(base({ email: '' }), { now: NOW }), { ok: false, error: 'invalid_email', field: 'email' });
  assert.equal(validateSubmission(base({ email: 'nope' }), { now: NOW }).error, 'invalid_email');
  assert.equal(validateSubmission(base({ email: ['a@b.co'] }), { now: NOW }).error, 'invalid_email');
});

test('field length limits', () => {
  const cases = { name: LIMITS.name, company: LIMITS.company, use_case: LIMITS.useCase };
  for (const [field, max] of Object.entries(cases)) {
    assert.equal(validateSubmission(base({ [field]: 'x'.repeat(max) }), { now: NOW }).ok, true, field);
    assert.deepEqual(validateSubmission(base({ [field]: 'x'.repeat(max + 1) }), { now: NOW }), { ok: false, error: 'too_long', field });
  }
  assert.equal(LIMITS.useCase, 1000);
});

test('non-string optional fields are rejected', () => {
  assert.deepEqual(validateSubmission(base({ name: { a: 1 } }), { now: NOW }), { ok: false, error: 'invalid', field: 'name' });
});

test('role must come from the allowed list', () => {
  assert.deepEqual(ROLES, ['Engineering/ML', 'Platform/SRE', 'Security/Compliance', 'Founder/Exec', 'Other']);
  for (const role of ROLES) assert.equal(validateSubmission(base({ role }), { now: NOW }).ok, true, role);
  assert.equal(validateSubmission(base({ role: '' }), { now: NOW }).ok, true);
  assert.deepEqual(validateSubmission(base({ role: 'CEO' }), { now: NOW }), { ok: false, error: 'invalid_role', field: 'role' });
});

test('a filled honeypot is flagged as silent spam', () => {
  assert.deepEqual(validateSubmission(base({ cp_hp: 'http://spam' }), { now: NOW }), { ok: false, error: 'honeypot', silent: true });
  assert.equal(validateSubmission(base({ cp_hp: '' }), { now: NOW }).ok, true);
});

test('timing: submissions faster than MIN_FILL_MS are rejected', () => {
  assert.equal(MIN_FILL_MS, 2000);
  assert.deepEqual(validateSubmission(base({ started_at: String(NOW - 500) }), { now: NOW }), { ok: false, error: 'too_fast' });
  assert.equal(validateSubmission(base({ started_at: String(NOW - 2000) }), { now: NOW }).ok, true);
});

test('timing: client-side elapsed (started_at → submitted_at) wins over server clock skew', () => {
  // Client clock 1h ahead of the server, but the user spent 5s on the form.
  const skew = 3_600_000;
  const r = validateSubmission(base({ started_at: String(NOW + skew - 5000), submitted_at: String(NOW + skew) }), { now: NOW });
  assert.equal(r.ok, true);
  const fast = validateSubmission(base({ started_at: String(NOW + skew - 500), submitted_at: String(NOW + skew) }), { now: NOW });
  assert.equal(fast.error, 'too_fast');
});

test('timing: garbage timestamps are rejected; a missing one (no-JS) is allowed', () => {
  assert.equal(validateSubmission(base({ started_at: 'abc' }), { now: NOW }).error, 'invalid_timing');
  assert.equal(validateSubmission(base({ started_at: String(NOW + 60_000) }), { now: NOW }).error, 'too_fast');
  assert.equal(validateSubmission({ email: 'a@b.co' }, { now: NOW }).ok, true);
});

test('source must be a site path; utm values are trimmed and capped', () => {
  assert.equal(validateSubmission(base({ source: 'https://evil.example/x' }), { now: NOW }).data.source, '');
  assert.equal(validateSubmission(base({ source: '//evil.example' }), { now: NOW }).data.source, '');
  assert.equal(validateSubmission(base({ source: '/pricing?x=1' }), { now: NOW }).data.source, '/pricing');
  assert.equal(validateSubmission(base({ utm_campaign: 'c'.repeat(500) }), { now: NOW }).data.utmCampaign.length, LIMITS.utm);
});

test('control characters are stripped', () => {
  const r = validateSubmission(base({ name: 'A\u0000d\u0007a', use_case: 'line1\nline2\u0000' }), { now: NOW });
  assert.equal(r.data.name, 'Ada');
  assert.equal(r.data.useCase, 'line1\nline2');
});
