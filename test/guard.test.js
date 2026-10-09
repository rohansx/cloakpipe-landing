import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedOrigin, createRateLimiter, clientIp } from '../api/_lib/guard.js';

const H = (o) => new Headers(o);
const PREVIEW_ENV = { VERCEL_ENV: 'preview', VERCEL_URL: 'cloakpipe-landing-abc123-rohansx.vercel.app', VERCEL_BRANCH_URL: 'cloakpipe-landing-git-feat-waitlist-rohansx.vercel.app' };
const PROD_ENV = { VERCEL_ENV: 'production', VERCEL_URL: 'cloakpipe-landing-def456-rohansx.vercel.app' };

test('production origins are allowed', () => {
  assert.equal(isAllowedOrigin(H({ origin: 'https://cloakpipe.co' }), PROD_ENV), true);
  assert.equal(isAllowedOrigin(H({ origin: 'https://www.cloakpipe.co' }), PROD_ENV), true);
});

test('foreign, look-alike and insecure origins are rejected', () => {
  for (const o of ['https://evil.example', 'https://cloakpipe.co.evil.example', 'https://evilcloakpipe.co', 'http://cloakpipe.co',
    'https://app.cloakpipe.co', 'null', 'not a url']) {
    assert.equal(isAllowedOrigin(H({ origin: o }), PROD_ENV), false, o);
  }
});

test('missing Origin falls back to Referer; neither means reject', () => {
  assert.equal(isAllowedOrigin(H({ referer: 'https://cloakpipe.co/waitlist?utm_source=x' }), PROD_ENV), true);
  assert.equal(isAllowedOrigin(H({ referer: 'https://evil.example/cloakpipe.co' }), PROD_ENV), false);
  assert.equal(isAllowedOrigin(H({ origin: 'null', referer: 'https://cloakpipe.co/waitlist' }), PROD_ENV), true);
  assert.equal(isAllowedOrigin(H({}), PROD_ENV), false);
});

test("this deployment's own vercel.app URLs are allowed, other vercel.app projects are not", () => {
  assert.equal(isAllowedOrigin(H({ origin: `https://${PREVIEW_ENV.VERCEL_URL}` }), PREVIEW_ENV), true);
  assert.equal(isAllowedOrigin(H({ origin: `https://${PREVIEW_ENV.VERCEL_BRANCH_URL}` }), PREVIEW_ENV), true);
  assert.equal(isAllowedOrigin(H({ origin: 'https://cloakpipe-landing-evil.vercel.app' }), PREVIEW_ENV), false);
  assert.equal(isAllowedOrigin(H({ origin: 'https://someone-else.vercel.app' }), PREVIEW_ENV), false);
});

test('localhost is allowed outside production only', () => {
  assert.equal(isAllowedOrigin(H({ origin: 'http://localhost:4321' }), {}), true);
  assert.equal(isAllowedOrigin(H({ origin: 'http://127.0.0.1:3000' }), { VERCEL_ENV: 'development' }), true);
  assert.equal(isAllowedOrigin(H({ origin: 'http://localhost:4321' }), PREVIEW_ENV), true);
  assert.equal(isAllowedOrigin(H({ origin: 'http://localhost:4321' }), PROD_ENV), false);
});

test('rate limiter allows `limit` hits per window per key', () => {
  let t = 0;
  const rl = createRateLimiter({ limit: 5, windowMs: 60_000, now: () => t });
  for (let i = 0; i < 5; i++) assert.equal(rl.hit('1.2.3.4'), true, `hit ${i}`);
  assert.equal(rl.hit('1.2.3.4'), false);
  assert.equal(rl.hit('5.6.7.8'), true, 'other IPs unaffected');
  t = 60_001;
  assert.equal(rl.hit('1.2.3.4'), true, 'window slides');
});

test('rate limiter memory is bounded', () => {
  const rl = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 0, maxKeys: 3 });
  for (const ip of ['a', 'b', 'c', 'd', 'e']) rl.hit(ip);
  assert.ok(rl.size() <= 3);
});

test('clientIp prefers the first x-forwarded-for entry', () => {
  assert.equal(clientIp(H({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' })), '203.0.113.9');
  assert.equal(clientIp(H({ 'x-real-ip': '198.51.100.2' })), '198.51.100.2');
  assert.equal(clientIp(H({})), 'unknown');
});
