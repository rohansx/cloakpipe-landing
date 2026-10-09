// /changelog: rendered at build time from the core repository's CHANGELOG.md
// (Keep a Changelog), the single source of truth. Falls back to the vendored
// copy in src/content/CHANGELOG.md when GitHub is unreachable or the file is
// missing, so a build never fails on it.
import { createSatteriMarkdownProcessor } from '@astrojs/markdown-satteri';
import vendored from '../content/CHANGELOG.md?raw';
import { GH_MAIN, GH_REPO } from './github';

export const CHANGELOG_RAW_URL = `https://raw.githubusercontent.com/${GH_REPO}/main/CHANGELOG.md`;
export const CHANGELOG_GH_URL = `${GH_MAIN}/CHANGELOG.md`;

export interface Changelog {
  html: string;
  source: 'github' | 'vendored';
}

const looksLikeChangelog = (md: string) => /^#\s+Changelog\b/m.test(md) && md.length < 2_000_000;

async function fetchMain(): Promise<string | null> {
  try {
    const res = await fetch(CHANGELOG_RAW_URL, {
      headers: { 'User-Agent': 'cloakpipe-landing-build' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const md = await res.text();
    return looksLikeChangelog(md) ? md : null;
  } catch {
    return null;
  }
}

/**
 * Point relative links at the core repo on GitHub: "docs/X.md" and "/docs/X.md"
 * mean files in rohansx/cloakpipe, not pages on this site.
 */
export function rewriteRelativeLinks(html: string): string {
  return html.replace(/(<a\b[^>]*?\shref=")([^"]*)(")/g, (m, pre: string, href: string, post: string) => {
    if (!href || href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return m;
    const path = href.replace(/^\.\//, '').replace(/^\/+/, '');
    return `${pre}${GH_MAIN}/${path}${post}`;
  });
}

let cached: Promise<Changelog> | undefined;

export function getChangelog(): Promise<Changelog> {
  cached ??= (async () => {
    const remote = await fetchMain();
    const source = remote ? 'github' : 'vendored';
    console.log(`[changelog] using ${source === 'github' ? CHANGELOG_RAW_URL : 'src/content/CHANGELOG.md (vendored fallback)'}`);
    const renderer = await createSatteriMarkdownProcessor({
      shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false, wrap: false },
    });
    const { code } = await renderer.render(remote ?? vendored);
    return { html: rewriteRelativeLinks(code), source };
  })();
  return cached;
}
