// Docs structure and copy rules for the gate positioning (Oct 2026): the
// docs describe a self-hosted policy-enforcement gate for agent tool calls,
// not evaluation certification, a hosted Cloud or a PII proxy. They run in
// `npm test` with no build, against the Markdown sources.
//
// Every `cloakpipe ...` command shown in the docs is checked against
// test/fixtures/cli-v0.12.json, the `--help` output of the v0.12 binary, so a
// documented subcommand or flag that does not exist fails the build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
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

const CLI = JSON.parse(read('test/fixtures/cli-v0.12.json'));

// ---------------------------------------------------------------------------
// Structure

const REMOVED = {
  certification: '/docs',
  evaluation: '/docs',
  releases: '/docs/manifest',
  runtime: '/docs/mcp-gate',
  'audit-pack': '/docs/evidence#audit-pack',
};
const NEW_PAGES = ['manifest', 'policy', 'threat-model', 'keys', 'comparison'];
const ALL_PAGES = ['index', 'quickstart', 'mcp-gate', 'evidence', 'faq', 'integrations', ...NEW_PAGES];

test('certification, evaluation, releases, runtime and audit-pack pages are removed', () => {
  for (const p of Object.keys(REMOVED)) assert.ok(!existsSync(join(root, `${DOCS_DIR}/${p}.md`)), `${p}.md is removed`);
});

test('the new pages exist with a title and a description', () => {
  for (const p of ALL_PAGES) {
    const src = page(p);
    assert.match(src, /^---\nlayout: \.\.\/\.\.\/layouts\/Docs\.astro\ntitle: .+\ndescription: .{40,}\n/, `${p}.md frontmatter`);
  }
});

test('the sidebar has no "Evaluate & certify" group and lists every docs page', () => {
  const nav = read('src/lib/docs.ts');
  assert.doesNotMatch(nav, /Evaluate|certif/i);
  for (const p of Object.keys(REMOVED)) assert.doesNotMatch(nav, new RegExp(`'/docs/${p}'`), `nav drops ${p}`);
  for (const p of ALL_PAGES) {
    const href = p === 'index' ? '/docs' : `/docs/${p}`;
    assert.ok(nav.includes(`href: '${href}'`), `nav lists ${href}`);
  }
});

test('the sitemap lists every docs page and none of the removed ones', () => {
  const sitemap = read('public/sitemap.xml');
  for (const p of ALL_PAGES) {
    const loc = p === 'index' ? 'https://cloakpipe.co/docs' : `https://cloakpipe.co/docs/${p}`;
    assert.ok(sitemap.includes(`<loc>${loc}</loc>`), `sitemap has ${loc}`);
  }
  for (const p of Object.keys(REMOVED)) assert.ok(!sitemap.includes(`/docs/${p}<`), `sitemap drops ${p}`);
});

test('vercel.json redirects each removed docs page to its replacement', () => {
  const { redirects } = JSON.parse(read('vercel.json'));
  for (const [p, to] of Object.entries(REMOVED)) {
    const r = redirects.find((x) => x.source === `/docs/${p}(\\.html)?`);
    assert.ok(r, `redirect for /docs/${p}`);
    assert.equal(r.destination, to, `/docs/${p} goes to ${to}`);
    assert.equal(r.permanent, true, `/docs/${p} is a permanent redirect`);
  }
});

test('nothing links to a removed docs page', () => {
  const files = ['src', 'public'].flatMap(function walk(dir) {
    return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
    );
  }).filter((p) => /\.(astro|md|html|ts|js|xml)$/.test(p) && p !== 'src/content/CHANGELOG.md');
  const link = new RegExp(`(?:href=["']|\\]\\(|<loc>https://cloakpipe\\.co)/docs/(${Object.keys(REMOVED).join('|')})(?:[#?"')<]|$)`);
  for (const p of files) assert.doesNotMatch(read(p), link, p);
});

// ---------------------------------------------------------------------------
// Copy rules

test('docs never sell evaluation or certification', () => {
  for (const p of docPages()) {
    const src = read(p);
    assert.doesNotMatch(src, /Evaluate,? (?:·\s*)?Certify/i, `${p}: Evaluate, Certify`);
    assert.doesNotMatch(src, /certif/i, `${p} mentions certification`);
    assert.doesNotMatch(src, /eval import/, `${p}: eval import`);
  }
});

test('docs make no hosted Cloud claims', () => {
  for (const p of [...docPages(), 'src/layouts/Docs.astro', 'src/lib/docs.ts']) {
    const src = read(p);
    for (const re of [/CloakPipe Cloud/i, /api\.cloakpipe\.co/, /cpk_/, /badge cloud/, /early access/i, /design partners/i, /release register/]) {
      assert.doesNotMatch(src, re, `${p} matches ${re}`);
    }
    // "hosted" may only appear next to a statement that it is not built.
    for (const line of src.split('\n').filter((l) => /\bhosted\b/i.test(l))) {
      assert.match(line, /not built|waitlist|roadmap|badge building/i, `${p}: "hosted" without saying it is not built: ${line.trim().slice(0, 120)}`);
    }
  }
});

test('PII is never the headline of a docs page', () => {
  for (const p of docPages()) {
    const src = read(p);
    const description = /^description: (.*)$/m.exec(src)[1];
    const afterH1 = src.slice(src.indexOf('\n# '));
    const lede = afterH1.split('\n\n').slice(0, 2).join('\n\n');
    for (const re of [/\bPII\b/, /privacy/i, /pseudonym/i, /mask/i]) {
      assert.doesNotMatch(description, re, `${p} description mentions ${re}`);
      assert.doesNotMatch(lede, re, `${p} heading or lede mentions ${re}`);
    }
  }
});

test('the overview leads with the action boundary', () => {
  const src = page('index');
  assert.ok(src.includes('Model proposes. Code disposes.'));
  for (const s of ['Declare', 'Enforce', 'Prove', 'cloakpipe.manifest.yaml', 'Cedar', 'What it is not']) assert.ok(src.includes(s), `overview mentions ${s}`);
});

// ---------------------------------------------------------------------------
// Release status: v0.12 is not tagged, so its features are labelled as such.

const V012 = [/cloakpipe\.manifest\.yaml/, /--mode shadow/, /ledger export/, /cloakpipe verify\b/, /--anchor-every/, /\.cedar\b/, /--signing-key/];
const NEXT_BADGE = '<span class="badge next">v0.12</span>';

test('features of the next release are labelled v0.12, never as shipped', () => {
  for (const p of docPages()) {
    const src = read(p);
    if (V012.some((re) => re.test(src))) assert.ok(src.includes(NEXT_BADGE), `${p} uses v0.12 features but has no v0.12 badge`);
    assert.doesNotMatch(src, /badge oss">Main</, `${p}: the old "Main" badge`);
  }
  const overview = page('index');
  assert.match(overview, /next release/i);
  assert.match(overview, /v0\.11\.0/);
  assert.ok(read('src/layouts/Docs.astro').includes('.badge.next'), 'the layout styles the v0.12 badge');
});

// ---------------------------------------------------------------------------
// Commands shown in the docs exist, with the flags shown.

/** Code in a Markdown page: fenced blocks plus inline code spans. */
function code(md) {
  const fenced = [...md.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const rest = md.replace(/```[a-z]*\n[\s\S]*?```/g, '');
  const inline = [...rest.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
  return [...fenced, ...inline].join('\n').replace(/\\\n/g, ' ');
}

/** Every `cloakpipe <sub> ...` invocation: the command path and the flags passed to it. */
function invocations(md) {
  const out = [];
  for (const line of code(md).split('\n')) {
    for (const m of line.matchAll(/(?:^|[\s$(|;])cloakpipe ((?:[a-z][a-z0-9-]*)(?: [a-z][a-z0-9-]*)?)([^|;&>#]*)/g)) {
      const words = m[1].split(' ');
      const two = words.join(' ');
      const path = CLI.commands[two] ? two : words[0];
      const args = (words.length === 2 && path !== two ? words[1] + ' ' : '') + m[2];
      const flags = args.replace(/"[^"]*"|'[^']*'/g, '').match(/--[a-z][a-z0-9-]*/g) ?? [];
      out.push({ path, flags, text: m[0].trim() });
    }
  }
  return out;
}

test('every documented cloakpipe command and flag exists in the v0.12 CLI', () => {
  let n = 0;
  for (const p of docPages()) {
    for (const { path, flags, text } of invocations(read(p))) {
      n++;
      assert.ok(CLI.commands[path], `${p}: no such command \`cloakpipe ${path}\` (${text})`);
      const known = new Set([...CLI.commands[path], ...(CLI.hidden[path] ?? []), ...CLI.commands['(root)']]);
      for (const f of flags) assert.ok(known.has(f), `${p}: \`cloakpipe ${path}\` has no flag ${f} (${text})`);
    }
  }
  assert.ok(n >= 20, `checked ${n} invocations`);
});

test('every documented cloakpipe-verify subcommand exists', () => {
  for (const p of docPages()) {
    for (const m of code(read(p)).matchAll(/cloakpipe-verify ([a-z][a-z-]*)(?=\s)/g)) {
      assert.ok(CLI['cloakpipe-verify'].includes(m[1]), `${p}: cloakpipe-verify ${m[1]}`);
    }
  }
});

test('the invocation parser finds commands and flags (self-test)', () => {
  const found = invocations('```bash\ncloakpipe mcp-proxy --upstream "x --nope" \\\n  --manifest m.yaml | jq\ncloakpipe ledger export --out a.tar\n```\nRun `cloakpipe frobnicate`.');
  assert.deepEqual(found.map((f) => [f.path, f.flags]), [
    ['mcp-proxy', ['--upstream', '--manifest']],
    ['ledger export', ['--out']],
    ['frobnicate', []],
  ]);
});

test('mcp-gate documents every mcp-proxy flag and no legacy certification flag', () => {
  const md = page('mcp-gate');
  for (const f of CLI.commands['mcp-proxy'].filter((f) => f !== '--help')) assert.ok(md.includes('`' + f), `mcp-gate.md documents ${f}`);
  for (const f of ['--certification', '--trust', '--trust-key', '--revoked-statement', '--revoked-key', '--environment']) {
    assert.doesNotMatch(md, new RegExp(`${f}(?![a-z-])`), `mcp-gate.md drops ${f}`);
  }
  for (const s of ['--mode shadow', '--transform pii', '--signing-key', 'ledger.db', 'gate.key', '--no-ledger', 'fail_closed', 'policy_denied', 'undeclared_argument', 'undeclared_tool', '-32001', '-32002']) {
    assert.ok(md.includes(s), `mcp-gate.md mentions ${s}`);
  }
  assert.doesNotMatch(md, /always masks/i);
});

// ---------------------------------------------------------------------------
// Page content

test('quick start runs Example 2 on the v1 manifest and Cedar and shows the refusals', () => {
  const md = page('quickstart');
  for (const s of [
    'examples/support-agent',
    'cloakpipe.manifest.yaml',
    'policies/support.cedar',
    'task-context.json',
    'mock_upstream.py',
    '"reason":"scope_mismatch"',
    '"reason":"undeclared_tool"',
    '"reason":"approval_required"',
    'attacker@evil.example',
    'cloakpipe ledger export',
    'cloakpipe verify',
  ]) {
    assert.ok(md.includes(s), `quickstart mentions ${s}`);
  }
  assert.doesNotMatch(md, /cloakpipe start/);
});

test('manifest reference covers the v1 format', () => {
  const md = page('manifest');
  for (const s of ['release:', 'version:', 'policy:', 'tools:', 'args:', 'one_of_context', 'or_pattern', 'max_len', 'min_len', 'side_effect', 'effect:', 'idempotency_key', '{sha256(', 'approval:', 'when:', 'approvers:', 'ttl:', 'required: true', 'undeclared_argument', 'cloakpipe manifest validate', 'cloakpipe manifest hash', 'manifest_digest', 'policy_digest', 'schemas/cloakpipe.manifest.schema.json', 'apiVersion']) {
    assert.ok(md.includes(s), `manifest.md mentions ${s}`);
  }
});

test('policy page covers Cedar entities, context, counters and @approval', () => {
  const md = page('policy');
  for (const s of ['Release::', 'Action::', 'Tool::', 'Call::', 'resource.args', 'context.task', 'context.counters', '_1h', '_24h', 'context.time', 'hour_utc', 'weekday', '@approval', '@id', 'policy_denied', 'fail_closed', '--state-db', 'forbid', 'permit']) {
    assert.ok(md.includes(s), `policy.md mentions ${s}`);
  }
});

test('evidence page covers the ledger entry, the tar pack and epochs', () => {
  const md = page('evidence');
  for (const s of ['cloakpipe.decision/v1', 'entry_hash', 'prev_hash', 'args_fingerprint', 'cloakpipe ledger export', 'cloakpipe verify', 'pack.json', 'entries.jsonl', 'epoch', 'RFC 3161', 'Rekor', 'gaps', '--anchor-every', '--anchor-interval', 'anchor.failed', 'id="audit-pack"']) {
    assert.ok(md.includes(s), `evidence.md mentions ${s}`);
  }
});

test('threat model and keys pages say what is and is not protected', () => {
  const tm = page('threat-model');
  for (const s of ['task context', 'host', 'signing key', 'out of scope', 'shadow']) assert.ok(tm.toLowerCase().includes(s), `threat-model mentions ${s}`);
  const keys = page('keys');
  for (const s of ['gate.key', 'CLOAKPIPE_SIGNING_KEY', '--signing-key', '--approver-key', 'cloakpipe release keygen', '--tsa-root', '--rekor-key', 'rotat', 'KMS', 'HSM', 'badge building']) {
    assert.ok(keys.includes(s), `keys.md mentions ${s}`);
  }
});

test('integrations put Claude Code, Cursor and Codex first and label the roadmap', () => {
  const md = page('integrations');
  const at = (s) => {
    const i = md.indexOf(s);
    assert.ok(i >= 0, `integrations mentions ${s}`);
    return i;
  };
  const hosts = Math.max(at('claude mcp add'), at('.mcp.json'), at('.cursor/mcp.json'), at('~/.codex/config.toml'), at('[mcp_servers.'));
  assert.ok(hosts < at('LangChain'), 'host snippets come before LangChain');
  assert.match(md, /LangChain[\s\S]{0,400}PII/, 'LangChain is described as a PII proxy client');
  assert.match(md, /OpenTelemetry[^\n]*badge building|badge building[^\n]*OpenTelemetry/, 'OTel is roadmap');
  assert.match(md, /[Ww]ebhooks[^\n]*badge building|badge building[^\n]*[Ww]ebhooks/, 'webhooks are roadmap');
});

test('comparison is dated, sourced and names the alternatives', () => {
  const md = page('comparison');
  for (const s of ['Agent Governance Toolkit', 'Pipelock', 'observability', 'as of October 2026', 'https://github.com/microsoft/agent-governance-toolkit', 'https://github.com/pipelab-org/pipelock', '## Sources']) {
    assert.ok(md.includes(s), `comparison mentions ${s}`);
  }
});

test('the changelog page source carries the new positioning', () => {
  const md = read('src/content/CHANGELOG.md');
  const unreleased = md.slice(md.indexOf('## [Unreleased]'), md.indexOf('## [0.11.0]'));
  assert.ok(unreleased.includes('cloakpipe.manifest.yaml'), 'vendored changelog has the v0.12 entries');
  assert.ok(unreleased.includes('policy-enforcement gate'), 'vendored changelog has the gate positioning');
  const astro = read('src/pages/changelog.astro');
  assert.match(astro, /v0\.12/, 'changelog page says Unreleased is v0.12');
});
