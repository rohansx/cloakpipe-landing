#!/usr/bin/env node
// Internal link checker for the built site. Run after `astro build`:
//
//   node scripts/check-links.mjs [distDir]
//
// For every .html file under dist/ it checks each href (and src) that points
// inside the site: the target page or file must exist, and a #fragment must
// match an id (or <a name>) on the target page. External links (http(s),
// mailto, tel, …) are skipped: checking them in CI is too flaky.
// Exits 1 and lists every broken link, or 0 when all resolve.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'dist'));
if (!existsSync(root)) {
  console.error(`check-links: ${root} does not exist; run \`npm run build\` first`);
  process.exit(2);
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(root);
const pages = files.filter((f) => f.endsWith('.html'));

/** Site path of a built page: dist/docs/index.html → /docs/ */
const sitePath = (file) => '/' + relative(root, file).split('\\').join('/').replace(/index\.html$/, '');

const decode = (s) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** Strip <script>, <style> and comments so code inside them is not parsed as markup. */
const markup = (html) =>
  html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '');

const idCache = new Map();
function idsOf(file) {
  if (!idCache.has(file)) {
    const html = markup(readFileSync(file, 'utf8'));
    const ids = new Set();
    for (const m of html.matchAll(/\s(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) ids.add(decode(m[1] ?? m[2]));
    idCache.set(file, ids);
  }
  return idCache.get(file);
}

/** Resolve a site path to a file in dist, the way nginx/astro preview would. */
function target(pathname) {
  let p;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const abs = join(root, p);
  if (!abs.startsWith(root)) return null;
  const candidates = p.endsWith('/') ? [join(abs, 'index.html')] : [abs, join(abs, 'index.html'), `${abs}.html`];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

const SKIP = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i; // http:, https:, mailto:, tel:, data:, javascript:, protocol-relative
const broken = [];
let checked = 0;

for (const page of pages) {
  const html = markup(readFileSync(page, 'utf8'));
  const base = sitePath(page);
  for (const m of html.matchAll(/\s(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const raw = decode((m[2] ?? m[3]).trim());
    if (!raw || SKIP.test(raw)) continue;
    checked++;
    const [beforeHash, fragment] = raw.split('#', 2);
    const pathOnly = beforeHash.split('?')[0];
    const resolved = pathOnly === '' ? base : posix.resolve(posix.dirname(base + 'x'), pathOnly) + (pathOnly.endsWith('/') && pathOnly !== '/' ? '/' : '');
    const file = pathOnly === '' ? page : target(resolved);
    const where = `${relative(root, page)}: ${m[1]}="${raw}"`;
    if (!file) {
      broken.push(`${where} → no page or file at ${resolved}`);
      continue;
    }
    if (fragment && file.endsWith('.html') && !idsOf(file).has(decodeURIComponent(fragment))) {
      broken.push(`${where} → no id="${fragment}" on ${sitePath(file) || '/'}`);
    }
  }
}

if (broken.length) {
  console.error(`check-links: ${broken.length} broken internal link(s) in ${pages.length} page(s):`);
  for (const b of broken) console.error(`  ${b}`);
  process.exit(1);
}
console.log(`check-links: ${checked} internal link(s) across ${pages.length} page(s) resolve`);
