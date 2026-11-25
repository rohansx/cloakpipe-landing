// Docs for v0.15.0 (tagged 24 November 2026): `mcp-proxy --capture`,
// `cloakpipe infer` (a draft manifest from captured calls, `--diff` for drift)
// and `cloakpipe prove` (a live agent through an attack pack, gate off and on).
// New things carry the v0.15 badge (`badge next`, the newest release).
//
// test/fixtures/cli-v0.15.json is the --help of the released image
// ghcr.io/rohansx/cloakpipe:0.15.0 (scripts/cli-fixture.mjs, hidden flags
// from cli-v0.14.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const DOCS_DIR = 'src/pages/docs';
const docPages = () =>
  readdirSync(join(root, DOCS_DIR))
    .filter((f) => f.endsWith('.md'))
    .map((f) => `${DOCS_DIR}/${f}`);
const page = (slug) => read(`${DOCS_DIR}/${slug}.md`);

const CLI014 = JSON.parse(read('test/fixtures/cli-v0.14.json'));
const CLI015 = JSON.parse(read('test/fixtures/cli-v0.15.json'));
const V015 = '<span class="badge next">v0.15</span>';
const CAPTURE = ['--capture', '--capture-max-age', '--capture-shapes'];

/** Code in a Markdown page: fenced blocks plus inline code spans. */
function code(md) {
  const fenced = [...md.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const rest = md.replace(/```[a-z]*\n[\s\S]*?```/g, '');
  const inline = [...rest.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
  return [...fenced, ...inline].join('\n').replace(/\\\n/g, ' ');
}

/** Every `cloakpipe <sub> ...` invocation, as in docs.test.js. */
function invocations(md) {
  const out = [];
  for (const line of code(md).split('\n')) {
    for (const m of line.matchAll(/(?:^|[\s$(|;])cloakpipe ((?:[a-z][a-z0-9-]*)(?: [a-z][a-z0-9-]*)?)([^|;&>#]*)/g)) {
      const words = m[1].split(' ');
      const two = words.join(' ');
      const path = CLI015.commands[two] ? two : words[0];
      const args = (words.length === 2 && path !== two ? words[1] + ' ' : '') + m[2];
      const flags = args.replace(/"[^"]*"|'[^']*'/g, '').match(/--[a-z][a-z0-9-]*/g) ?? [];
      out.push({ path, flags, text: m[0].trim() });
    }
  }
  return out;
}

/** The commands and flags a page shows that v0.14.0 does not have. */
function newIn015(md) {
  const found = [];
  for (const { path, flags, text } of invocations(md)) {
    if (!CLI014.commands[path]) found.push(`cloakpipe ${path} (${text})`);
    const known = new Set([...(CLI014.commands[path] ?? []), ...(CLI014.hidden[path] ?? []), ...CLI014.commands['(root)']]);
    for (const f of flags) if (!known.has(f)) found.push(`${f} (${text})`);
  }
  return found;
}

/** A page's lede (the paragraph after the H1) and its `## ` sections. */
function sections(md) {
  const body = md.slice(md.indexOf('\n# '));
  const parts = body.split(/\n(?=## )/);
  return { lede: parts[0], sections: parts.slice(1) };
}

test('the fixture comes from the v0.15.0 release, which only adds capture flags, infer and prove', () => {
  assert.match(CLI015.source, /0\.15\.0[^"]*v0\.15\.0/);
  for (const [cmd, flags] of Object.entries(CLI014.commands)) {
    if (cmd === 'mcp-proxy') continue;
    assert.deepEqual(CLI015.commands[cmd], flags, `${cmd} is unchanged`);
  }
  const added = CLI015.commands['mcp-proxy'].filter((f) => !CLI014.commands['mcp-proxy'].includes(f));
  assert.deepEqual(added, CAPTURE);
  const newCommands = Object.keys(CLI015.commands).filter((c) => !CLI014.commands[c]);
  assert.deepEqual(newCommands.sort(), ['infer', 'prove']);
  assert.deepEqual(CLI015.hidden, CLI014.hidden, 'hidden flags carried over');
});

test('a command or flag v0.14.0 does not have is only shown under the v0.15 badge', () => {
  let n = 0;
  for (const p of docPages()) {
    const { lede, sections: secs } = sections(read(p));
    const pageIs015 = lede.includes(V015);
    for (const s of [lede, ...secs]) {
      const fresh = newIn015(s);
      n += fresh.length;
      if (fresh.length && !pageIs015) {
        assert.ok(s.includes(V015), `${p}, section "${s.split('\n').find(Boolean)}": shows ${fresh[0]} without the v0.15 badge`);
      }
    }
  }
  assert.ok(n >= 8, `found ${n} v0.15 commands and flags in the docs`);
});

test('the overview lists infer and prove under v0.15', () => {
  const overview = page('index');
  for (const [cmd, href] of [['`cloakpipe infer`', '/docs/infer'], ['`cloakpipe prove`', '/docs/prove']]) {
    const row = overview.split('\n').find((l) => l.startsWith('|') && l.includes(cmd) && l.includes(V015) && l.includes(href));
    assert.ok(row, `a status row puts ${cmd} under v0.15 and links ${href}`);
  }
});

test('the infer and prove pages are in the nav and the sitemap, with the v0.15 badge in the lede', () => {
  const nav = read('src/lib/docs.ts');
  const sitemap = read('public/sitemap.xml');
  for (const slug of ['infer', 'prove']) {
    assert.ok(nav.includes(`href: '/docs/${slug}'`), `nav lists ${slug}`);
    assert.ok(sitemap.includes(`<loc>https://cloakpipe.co/docs/${slug}</loc>`), `sitemap lists ${slug}`);
    assert.ok(sections(page(slug)).lede.includes(V015), `${slug}: lede has the v0.15 badge`);
  }
});

test('every infer and prove flag is documented, and every capture flag on mcp-gate', () => {
  for (const cmd of ['infer', 'prove']) {
    const md = page(cmd);
    for (const f of CLI015.commands[cmd].filter((f) => f !== '--help')) assert.ok(md.includes('`' + f), `${cmd}.md documents ${f}`);
  }
  const mg = page('mcp-gate');
  for (const f of CAPTURE) assert.ok(mg.split('\n').some((l) => l.startsWith('| `' + f) && l.includes(V015)), `mcp-gate flag row ${f} under v0.15`);
});

test('the infer page says what capture keeps, that the draft is reviewed, and how --diff fails CI', () => {
  const md = page('infer');
  assert.match(md, /Shadow only[^\n]*[Rr]efused with an enforcing gate/);
  assert.match(md, /never activated/i);
  assert.match(md, /outlier/i);
  assert.match(md, /low-entropy/);
  assert.match(md, /exit 1/i);
  assert.match(md, /0700/);
  assert.match(md, /`0600`/);
});

test('the prove page covers shadow vs enforce, sandboxes, the verified audit pack and exit codes', () => {
  const md = page('prove');
  for (const s of ['support-basics', '`local`', '`docker`', '`e2b`', 'cloakpipe verify', 'report.html', 'report.json', 'cloakpipe.prove/v1', 'Exit 2', 'NOT EXERCISED']) {
    assert.ok(md.includes(s), `prove mentions ${s}`);
  }
  assert.match(md, /shadow mode[^.]*enforce mode/);
  assert.match(md, /exits 1/);
  for (const r of ['scope_mismatch', 'undeclared_tool', 'approval_required', 'reconcile_before_retry', 'argument_invalid']) assert.ok(md.includes(r), `prove names ${r}`);
  assert.match(md, /not a guarantee/i, 'says what a passing report does not show');
});

test('nothing after v0.15.0 is documented as shipped', () => {
  for (const p of docPages()) {
    const src = read(p);
    assert.doesNotMatch(src, /support-injection|gen_ai\.tool|v0\.16/, `${p} describes something v0.15.0 does not ship`);
  }
});

test('the changelog and home page carry v0.15.0', () => {
  const md = read('src/content/CHANGELOG.md');
  const v015 = md.slice(md.indexOf('## [0.15.0] - 2026-11-24'), md.indexOf('## [0.14.0]'));
  for (const s of ['--capture', '--capture-shapes', 'cloakpipe infer', '--diff', 'cloakpipe prove', 'support-basics']) assert.ok(v015.includes(s), `0.15.0 has ${s}`);
  const astro = read('src/pages/changelog.astro');
  assert.match(astro, /cloakpipe infer/);
  assert.match(astro, /cloakpipe prove/);
  const home = read('src/partials/index.html');
  assert.match(home, /cloakpipe infer<\/code> drafts/);
  assert.match(home, /cloakpipe prove<\/code> runs your agent through an attack pack/);
});
