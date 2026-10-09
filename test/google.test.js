import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { signJwt, normalizePrivateKey, createTokenProvider, SHEETS_SCOPE, TOKEN_URL } from '../api/_lib/google.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const EMAIL = 'waitlist@proj.iam.gserviceaccount.com';
const b64json = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

test('normalizePrivateKey turns literal \\n into newlines and strips wrapping quotes', () => {
  const pem = privateKey.trim(); // surrounding whitespace is not significant
  const flat = privateKey.replace(/\n/g, "\\n");
  assert.equal(normalizePrivateKey(flat), pem);
  assert.equal(normalizePrivateKey(`"${flat}"`), pem);
  assert.equal(normalizePrivateKey(privateKey), pem);
});

test('signJwt produces an RS256 JWT that verifies with the matching public key', () => {
  const now = 1_800_000_000_000;
  const jwt = signJwt({ clientEmail: EMAIL, privateKey, now });
  const [h, p, s] = jwt.split('.');
  assert.deepEqual(b64json(h), { alg: 'RS256', typ: 'JWT' });
  assert.deepEqual(b64json(p), {
    iss: EMAIL, scope: SHEETS_SCOPE, aud: TOKEN_URL, iat: now / 1000, exp: now / 1000 + 3600,
  });
  const v = createVerify('RSA-SHA256');
  v.update(`${h}.${p}`);
  assert.equal(v.verify(publicKey, Buffer.from(s, 'base64url')), true);
  // Tampering breaks it.
  const v2 = createVerify('RSA-SHA256');
  v2.update(`${h}.${p}x`);
  assert.equal(v2.verify(publicKey, Buffer.from(s, 'base64url')), false);
});

test('signJwt accepts a key with literal \\n sequences', () => {
  const jwt = signJwt({ clientEmail: EMAIL, privateKey: privateKey.replace(/\n/g, '\\n'), now: 0 });
  assert.equal(jwt.split('.').length, 3);
});

function tokenFetch(calls, { token = 'ya29.token', expires_in = 3600, status = 200 } = {}) {
  return async (url, init) => {
    calls.push({ url, init });
    if (status !== 200) return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }), { status });
    return Response.json({ access_token: `${token}-${calls.length}`, expires_in, token_type: 'Bearer' });
  };
}

test('token provider exchanges a JWT bearer assertion at the token endpoint', async () => {
  const calls = [];
  const tp = createTokenProvider({ clientEmail: EMAIL, privateKey, fetch: tokenFetch(calls), now: () => 0 });
  assert.equal(await tp.getToken(), 'ya29.token-1');
  assert.equal(calls[0].url, TOKEN_URL);
  assert.equal(calls[0].init.method, 'POST');
  const body = new URLSearchParams(calls[0].init.body);
  assert.equal(body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  assert.equal(body.get('assertion').split('.').length, 3);
});

test('token provider caches until shortly before expiry', async () => {
  const calls = [];
  let t = 0;
  const tp = createTokenProvider({ clientEmail: EMAIL, privateKey, fetch: tokenFetch(calls), now: () => t });
  await tp.getToken();
  t = 3000 * 1000; // 50 minutes later: still cached
  assert.equal(await tp.getToken(), 'ya29.token-1');
  assert.equal(calls.length, 1);
  t = (3600 - 30) * 1000; // inside the 60s refresh margin
  assert.equal(await tp.getToken(), 'ya29.token-2');
  assert.equal(calls.length, 2);
});

test('concurrent callers share one in-flight token request', async () => {
  const calls = [];
  const tp = createTokenProvider({ clientEmail: EMAIL, privateKey, fetch: tokenFetch(calls), now: () => 0 });
  const [a, b] = await Promise.all([tp.getToken(), tp.getToken()]);
  assert.equal(a, b);
  assert.equal(calls.length, 1);
});

test('token errors throw a GoogleError without the key or assertion in the message', async () => {
  const calls = [];
  const tp = createTokenProvider({ clientEmail: EMAIL, privateKey, fetch: tokenFetch(calls, { status: 400 }), now: () => 0 });
  await assert.rejects(tp.getToken(), (err) => {
    assert.equal(err.name, 'GoogleError');
    assert.equal(err.stage, 'token');
    assert.equal(err.status, 400);
    assert.ok(!err.message.includes('PRIVATE KEY'));
    assert.ok(!err.message.includes(new URLSearchParams(calls[0].init.body).get('assertion')));
    return true;
  });
  // A failure is not cached: the next call retries.
  await assert.rejects(tp.getToken());
  assert.equal(calls.length, 2);
});
