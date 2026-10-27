// Content checks for docs and blog source files. They run in `npm test`
// (no build needed) so the docs cannot silently drift from the action
// boundary spec, and the blog keeps its house rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const MEDIUM =
  'https://medium.com/@vidhiwaghela./your-ai-agent-finished-the-task-can-your-system-prove-what-happened-2a9015cb1e39';
const POST = 'src/pages/blog/agent-cannot-be-its-own-authority.astro';

test('mcp-gate docs cover the action boundary flags and commands', () => {
  const md = read('src/pages/docs/mcp-gate.md');
  for (const s of [
    '--manifest',
    '--task-context',
    'CLOAKPIPE_TASK_CONTEXT',
    '--approvals',
    '--approver-key',
    '--operations-db',
    'CLOAKPIPE_OPERATIONS_DB',
    '--state-db',
    'cloakpipe approve',
    'cloakpipe action fingerprint',
    'cloakpipe operations list',
    'cloakpipe operations reconcile',
    'https://cloakpipe.co/attestations/approval/v1alpha1',
    '-32002',
  ]) {
    assert.ok(md.includes(s), `mcp-gate.md mentions ${s}`);
  }
  for (const code of [
    'undeclared_tool',
    'undeclared_argument',
    'argument_missing',
    'argument_invalid',
    'scope_mismatch',
    'task_context_missing',
    'policy_denied',
    'approval_required',
    'approval_invalid',
    'approval_expired',
    'operation_conflict',
    'reconcile_before_retry',
    'fail_closed',
  ]) {
    assert.match(md, new RegExp('`' + code + '`'), `denial code ${code}`);
  }
  assert.doesNotMatch(md, /argument_not_allowed/, 'renamed to undeclared_argument');
  for (const state of ['in_flight', 'done', 'failed', 'unknown', 'not_applied']) {
    assert.ok(md.includes('`' + state + '`'), `operation state ${state}`);
  }
});

test('docs never reference the private cloud repository', () => {
  for (const p of ['src/pages/docs/mcp-gate.md', POST, 'src/pages/blog/index.astro']) {
    if (existsSync(join(root, p))) assert.doesNotMatch(read(p), /github\.com\/[^/\s]+\/cloakpipe-cloud/, p);
  }
});

test('blog index and post exist with the site title format and meta', () => {
  assert.ok(existsSync(join(root, 'src/pages/blog/index.astro')), 'blog index exists');
  assert.ok(existsSync(join(root, POST)), 'post exists');
  const index = read('src/pages/blog/index.astro');
  assert.match(index, /title = "Blog · CloakPipe"/);
  assert.ok(index.includes('/blog/agent-cannot-be-its-own-authority'), 'index links the post');
  const post = read(POST);
  assert.match(post, /title = "An agent can't be its own authority · CloakPipe"/);
  assert.match(post, /const description = "[^"]{50,}"/);
  assert.match(post, /<Base /, 'uses the shared Base layout (og/twitter meta via HeadMeta)');
});

/** Visible prose of the post: the markup between <article> tags with tags stripped. */
function prose(src) {
  const body = src.slice(src.indexOf('<article'), src.lastIndexOf('</article>'));
  return body
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\{[^}]*\}/g, ' ');
}

test('blog post follows the house rules', () => {
  const post = read(POST);
  assert.ok(post.includes(MEDIUM), 'credits and links the Medium article');
  assert.match(post, /Vidhi Waghela/);
  assert.doesNotMatch(post, /—/, 'no em dashes');
  const words = prose(post).split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
  assert.ok(words >= 900 && words <= 1200, `900-1200 words, got ${words}`);
  const quotes = [...post.matchAll(/<blockquote[\s\S]*?<\/blockquote>/g)];
  assert.ok(quotes.length <= 1, 'at most one quote');
  for (const q of quotes) {
    const n = q[0].replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
    assert.ok(n < 15, `quote under 15 words, got ${n}`);
  }
  assert.doesNotMatch(post, /cloakpipe-cloud/);
});

test('footer and sitemap list the blog', () => {
  assert.ok(read('src/components/Footer.astro').includes('href="/blog"'), 'footer links /blog');
  const sitemap = read('public/sitemap.xml');
  assert.ok(sitemap.includes('<loc>https://cloakpipe.co/blog</loc>'));
  assert.ok(sitemap.includes('<loc>https://cloakpipe.co/blog/agent-cannot-be-its-own-authority</loc>'));
});

// ---------------------------------------------------------------------------
// Site cleanup for the "policy gate for agent tool calls" positioning.

/** Every file under `dir` (relative to the repo root), recursively. */
function walk(dir) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`;
    return e.isDirectory() ? walk(p) : [p];
  });
}

const SOURCE_EXT = /\.(astro|md|mdx|html|ts|js|mjs|css|json|webmanifest|xml|txt)$/;
const sources = () => ['src', 'public', 'scripts', 'api'].flatMap(walk).filter((p) => SOURCE_EXT.test(p));

// Pages removed from the site and where their old URLs now go.
// Temporary (302) where the destination will change once the new pages ship.
const REMOVED = {
  pricing: { to: '/', permanent: false },
  platform: { to: '/', permanent: false },
  trust: { to: '/', permanent: false },
  integrations: { to: '/docs/integrations', permanent: true },
  playground: { to: '/', permanent: true },
  dashboard: { to: '/', permanent: true },
};

test('removed pages, partials and their scripts are gone', () => {
  const gone = [
    ...Object.keys(REMOVED).flatMap((p) => [`src/pages/${p}.astro`, `src/partials/${p}.html`]),
    'src/scripts/playground.js',
    'src/scripts/dashboard.js',
    'src/scripts/hero-chart.js',
    'src/layouts/Dashboard.astro',
    'src/styles/dashboard.css',
  ];
  for (const p of gone) assert.ok(!existsSync(join(root, p)), `${p} is removed`);
});

/** Run a Vercel redirect list against a path (supports the source forms used in vercel.json). */
function redirectFor(redirects, path) {
  for (const r of redirects) {
    const names = [];
    const re = new RegExp(
      '^' +
        r.source.replace(/:(\w+)\(([^)]*)\)/g, (_, n, alt) => (names.push(n), `(${alt})`)).replace(/\.html/g, '\\.html').replace(/\\\\/g, '\\') +
        '$',
    );
    const m = re.exec(path);
    if (!m) continue;
    let to = r.destination;
    names.forEach((n, i) => (to = to.replace(`:${n}`, m[i + 1])));
    return { to, permanent: r.permanent };
  }
  return null;
}

test('vercel.json redirects every removed page (and its legacy .html URL) in one hop', () => {
  const { redirects } = JSON.parse(read('vercel.json'));
  for (const [page, want] of Object.entries(REMOVED)) {
    for (const path of [`/${page}`, `/${page}.html`]) {
      assert.deepEqual(redirectFor(redirects, path), { to: want.to, permanent: want.permanent }, path);
    }
  }
  assert.deepEqual(redirectFor(redirects, '/docs.html'), { to: '/docs', permanent: true });
  assert.deepEqual(redirectFor(redirects, '/demo'), { to: '/waitlist', permanent: false });
  // The legacy .html rule only lists pages that still exist.
  const legacy = redirects.find((r) => r.source.startsWith('/:page('));
  for (const page of Object.keys(REMOVED)) assert.doesNotMatch(legacy.source, new RegExp(`\\b${page}\\b`), `.html rule drops ${page}`);
});

test('CSP no longer allows the hosted API', () => {
  const { headers } = JSON.parse(read('vercel.json'));
  const csp = headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy').value;
  assert.doesNotMatch(csp, /api\.cloakpipe\.co/);
  assert.match(csp, /connect-src 'self'/);
});

test('nothing links to a removed page', () => {
  const link = new RegExp(`(?:href=["']|\\]\\(|<loc>https://cloakpipe\\.co)/(${Object.keys(REMOVED).join('|')})(?:[#?"')<]|$)`);
  for (const p of sources()) {
    assert.doesNotMatch(read(p), link, p);
  }
});

test('sitemap lists only pages that exist', () => {
  const sitemap = read('public/sitemap.xml');
  const locs = [...sitemap.matchAll(/<loc>https:\/\/cloakpipe\.co([^<]*)<\/loc>/g)].map((m) => m[1] || '/');
  assert.ok(locs.length > 0);
  for (const loc of locs) {
    const base = loc === '/' ? 'src/pages/index' : `src/pages${loc}`;
    const found = ['.astro', '.md', '/index.astro', '/index.md'].some((ext) => existsSync(join(root, base + ext)));
    assert.ok(found, `sitemap entry ${loc} has a page`);
  }
});

// Retired positioning. Nothing may use these phrases (PENDING_DOCS is the
// escape hatch for a page being rewritten; keep it empty).
const BANNED = [/reliability layer/i, /Evaluate · Certify/i, /privacy proxy/i, /control plane/i];
const PENDING_DOCS = new Set([]);

test('banned phrases are absent from the site', () => {
  for (const p of sources()) {
    if (PENDING_DOCS.has(p)) continue;
    const text = read(p);
    for (const re of BANNED) assert.doesNotMatch(text, re, `${p} uses retired phrase ${re}`);
  }
});

const TAGLINE = 'Policy enforcement for AI-agent tool calls';

test('the tagline is consistent across chrome, meta, manifest and the icon script', () => {
  assert.ok(read('src/components/Footer.astro').includes(TAGLINE), 'footer');
  assert.ok(read('src/components/HeadMeta.astro').includes(`content="CloakPipe: ${TAGLINE}"`), 'og:image:alt');
  assert.equal(JSON.parse(read('public/site.webmanifest')).description, `${TAGLINE}.`);
  const icons = read('scripts/generate-icons.mjs');
  assert.ok(icons.includes(`description: '${TAGLINE}.'`), 'icon script manifest');
  assert.ok(icons.includes(`>${TAGLINE}</text>`), 'og.png text');
  assert.match(read('src/pages/index.astro'), new RegExp(`const title = "CloakPipe · ${TAGLINE}"`));
});

test('nav: Docs, Blog, Changelog and GitHub; primary CTA is Get started', () => {
  const nav = read('src/components/Nav.astro');
  const labels = [...nav.matchAll(/\{ label: '([^']+)', href: '([^']+)'/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(labels, [['Docs', '/docs'], ['Blog', '/blog'], ['Changelog', '/changelog']]);
  assert.match(nav, /href=\{QUICKSTART\}[^>]*>[\s\S]*?Get started/);
  assert.match(nav, /const QUICKSTART = '\/docs\/quickstart'/);
  assert.doesNotMatch(nav, /Join the waitlist/);
  assert.doesNotMatch(read('src/partials/index.html'), /class="btn btn-lg btn-cta" href="\/waitlist"/, 'waitlist is not the primary home CTA');
});

test('waitlist page asks about hosted alerts and approvals', () => {
  const page = read('src/pages/waitlist.astro');
  assert.match(page, /Hosted alerts &(?:amp;)? approvals \(Team\): tell us you want it/);
  assert.match(page, /<input[^>]*name="wants_hosted"[^>]*type="checkbox"[^>]*required/);
  assert.match(page, /<input[^>]*name="company"[^>]*required/);
  for (const code of ['company_required', 'hosted_required']) assert.ok(page.includes(code), `page explains ${code}`);
});

test('CI runs the unit tests and the site build on pull requests', () => {
  const wf = read('.github/workflows/ci.yml');
  assert.match(wf, /pull_request/);
  assert.match(wf, /npm ci/);
  assert.match(wf, /npm test/);
  assert.match(wf, /npm run test:site/);
});
