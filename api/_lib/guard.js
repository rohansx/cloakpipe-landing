// Request guards: same-origin check, per-IP rate limit, client IP.

const PRODUCTION_HOSTS = new Set(['cloakpipe.co', 'www.cloakpipe.co']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function originOf(value) {
  if (!value || value === 'null') return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * True when the request comes from a page on this site: cloakpipe.co,
 * www.cloakpipe.co, this deployment's own *.vercel.app URLs (VERCEL_URL,
 * VERCEL_BRANCH_URL, VERCEL_PROJECT_PRODUCTION_URL; system env vars Vercel
 * sets at runtime), or localhost outside production. Uses Origin, falling back
 * to Referer. Requests with neither are refused.
 */
export function isAllowedOrigin(headers, env = {}) {
  const url = originOf(headers.get('origin')) ?? originOf(headers.get('referer'));
  if (!url) return false;
  const host = url.host.toLowerCase();
  const hostname = url.hostname.toLowerCase();

  if (LOCAL_HOSTS.has(hostname)) return env.VERCEL_ENV !== 'production' && (url.protocol === 'http:' || url.protocol === 'https:');
  if (url.protocol !== 'https:') return false;
  if (PRODUCTION_HOSTS.has(host)) return true;

  const own = [env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL]
    .filter(Boolean)
    .map((h) => String(h).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''));
  return own.includes(host);
}

/**
 * Best-effort sliding-window rate limiter held in memory. Each warm function
 * instance has its own copy, so it limits bursts rather than guaranteeing a
 * global quota.
 */
export function createRateLimiter({ limit = 5, windowMs = 60_000, now = () => Date.now(), maxKeys = 5000 } = {}) {
  const hits = new Map(); // key -> timestamps (ms), oldest first

  function prune(t) {
    for (const [k, list] of hits) {
      while (list.length && list[0] <= t - windowMs) list.shift();
      if (!list.length) hits.delete(k);
    }
  }

  return {
    /** Records a hit; returns false when the key is over the limit. */
    hit(key) {
      const t = now();
      let list = hits.get(key);
      if (list) while (list.length && list[0] <= t - windowMs) list.shift();
      if (!list || !list.length) {
        if (hits.size >= maxKeys) prune(t);
        // Still full: drop the oldest keys (Map keeps insertion order).
        while (hits.size >= maxKeys) hits.delete(hits.keys().next().value);
        list = [];
        hits.set(key, list);
      }
      if (list.length >= limit) return false;
      list.push(t);
      return true;
    },
    size: () => hits.size,
  };
}

export function clientIp(headers) {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0].trim();
    if (first) return first;
  }
  return headers.get('x-real-ip')?.trim() || headers.get('x-vercel-forwarded-for')?.trim() || 'unknown';
}
