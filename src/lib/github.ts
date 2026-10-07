// Public core repository.
export const GH_REPO = 'rohansx/cloakpipe';
export const GH_URL = `https://github.com/${GH_REPO}`;
/** Source links must point at files that exist on this branch. */
export const GH_MAIN = `${GH_URL}/blob/main`;
export const GH_TREE = `${GH_URL}/tree/main`;

/** 1234 → "1.2k", 12345 → "12k", 999 → "999". Mirrored in Nav.astro's inline script. */
export function formatStars(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return (k < 10 ? k.toFixed(1).replace(/\.0$/, '') : String(Math.round(k))) + 'k';
}

let cached: Promise<number | null> | undefined;

/** Star count at build time; null when GitHub is unreachable or rate-limited. */
export function getStarCount(): Promise<number | null> {
  cached ??= (async () => {
    try {
      const res = await fetch(`https://api.github.com/repos/${GH_REPO}`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'cloakpipe-landing-build' },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return null;
      const n = (await res.json())?.stargazers_count;
      return typeof n === 'number' && Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  })();
  return cached;
}
