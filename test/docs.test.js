// Docs structure and copy rules for the gate positioning (Oct 2026): the
// docs describe a self-hosted policy-enforcement gate for agent tool calls,
// not evaluation certification, a hosted Cloud or a PII proxy. They run in
// `npm test` with no build, against the Markdown sources.
//
// Every `cloakpipe ...` command shown in the docs is checked against
// test/fixtures/cli-v0.14.json, the `--help` output of the v0.14.0 binary
// (scripts/cli-fixture.mjs), so a documented subcommand or flag that does
// not exist fails the build. Anything v0.12.0 (test/fixtures/cli-v0.12.json)
// lacks must carry the v0.13 or v0.14 badge; test/docs-v013.test.js and
// test/docs-v014.test.js check that.
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

const CLI = JSON.parse(read('test/fixtures/cli-v0.14.json'));

// ---------------------------------------------------------------------------
// Structure

const REMOVED = {
  certification: '/docs',
  evaluation: '/docs',
  releases: '/docs/manifest',
  runtime: '/docs/mcp-gate',
  'audit-pack': '/docs/evidence#audit-pack',
};
const NEW_PAGES = ['manifest', 'policy', 'threat-model', 'keys', 'comparison', 'events', 'docker', 'approvals'];
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
  assert.doesNotMatch(nav, /Evaluate|certif(?:y|ied|ication)/i);
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
    assert.doesNotMatch(src, /certif(?:y|ied|ication)/i, `${p} mentions certification`);
    assert.doesNotMatch(src, /eval import/, `${p}: eval import`);
  }
});

test('docs make no hosted Cloud claims', () => {
  for (const p of [...docPages(), 'src/layouts/Docs.astro', 'src/lib/docs.ts']) {
    const src = read(p);
    for (const re of [/api\.cloakpipe\.co/, /cpk_/, /badge cloud/, /early access/i, /design partners/i, /release register/, /cloakpipe-cloud/i]) {
      assert.doesNotMatch(src, re, `${p} matches ${re}`);
    }
    // CloakPipe Cloud implements the v0.14.0 broker protocol, but it is not
    // deployed: every line that names it says it is coming, under the Roadmap badge.
    for (const line of src.split('\n').filter((l) => /CloakPipe Cloud/i.test(l))) {
      assert.match(line, /badge building/, `${p}: CloakPipe Cloud without the Roadmap badge: ${line.trim().slice(0, 120)}`);
      assert.match(line, /coming soon|not (?:yet )?deployed|not built/i, `${p}: CloakPipe Cloud without saying it is coming: ${line.trim().slice(0, 120)}`);
    }
    // "hosted" may only appear next to a statement that it is not built.
    for (const line of src.split('\n').filter((l) => /(?<!self-)\bhosted\b/i.test(l))) {
      assert.match(line, /not built|waitlist|roadmap|badge building/i, `${p}: "hosted" without saying it is not built: ${line.trim().slice(0, 120)}`);
    }
  }
});

test('the site links no private repository', () => {
  const files = ['src', 'public'].flatMap(function walk(dir) {
    return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
    );
  }).filter((p) => /\.(astro|md|html|ts|js|xml|json)$/.test(p));
  for (const p of files) {
    const src = read(p);
    assert.doesNotMatch(src, /cloakpipe-cloud/i, `${p} names the private cloud repository`);
    for (const m of src.matchAll(/github\.com\/rohansx\/([A-Za-z0-9._-]+)/g)) {
      assert.ok(['cloakpipe', 'cloakpipe-landing'].includes(m[1]), `${p} links github.com/rohansx/${m[1]}`);
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
// Release status: v0.14.0 is tagged (29 October 2026), v0.13.0 before it
// (28 October 2026) and v0.12.0 (27 October 2026). Features new in each carry
// that release's badge: the newest release is `badge next`, older ones
// `badge oss`, as v0.12 moved once v0.13 shipped. Nothing says any is unreleased.

const V012 = [/cloakpipe\.manifest\.yaml/, /--mode shadow/, /ledger export/, /cloakpipe verify\b/, /--anchor-every/, /\.cedar\b/, /--signing-key/];
const V012_BADGE = '<span class="badge oss">v0.12</span>';
const V013_BADGE = '<span class="badge oss">v0.13</span>';
const V014_BADGE = '<span class="badge next">v0.14</span>';
const UNRELEASED = [
  /v0\.1[234](?:\.0)? (?:is|was|remains) (?:not tagged|unreleased|in review|not (?:yet )?released)/i,
  /v0\.1[234](?:\.0)?[^.\n]{0,20}\(?(?:unreleased|not tagged|in review)/i,
  /next release,? (?:is )?v0\.1[234]/i,
  /Unreleased<\/strong> is the next/i,
  /badge unreleased/,
  /\bunreleased\b/i,
  /before the tag|until v0\.1[34](?:\.0)? is tagged/i,
];

test('features new in v0.12 carry the v0.12 badge', () => {
  for (const p of docPages()) {
    const src = read(p);
    // A page wholly about v0.13 or v0.14 features carries that badge instead.
    if (V012.some((re) => re.test(src))) assert.ok([V012_BADGE, V013_BADGE, V014_BADGE].some((b) => src.includes(b)), `${p} uses v0.12 features but has no v0.12 badge`);
    assert.doesNotMatch(src, /badge oss">Main</, `${p}: the old "Main" badge`);
    assert.doesNotMatch(src, /badge next">v0\.1[23]</, `${p}: v0.12 and v0.13 are no longer the newest release`);
  }
  const layout = read('src/layouts/Docs.astro');
  assert.ok(layout.includes('.badge.next'), 'the layout styles the v0.14 badge');
  assert.ok(!layout.includes('.badge.unreleased'), 'no Unreleased badge style is left');
});

test('no page says v0.12, v0.13 or v0.14 is unreleased', () => {
  for (const p of [...docPages(), 'src/pages/changelog.astro', 'src/partials/index.html']) {
    const src = read(p);
    for (const re of UNRELEASED) assert.doesNotMatch(src, re, `${p} matches ${re}`);
  }
});

test('the overview says the latest release is v0.14.0 and explains the badges', () => {
  const overview = page('index');
  assert.match(overview, /latest release is \*\*v0\.14\.0\*\* \(29 October 2026\)/);
  for (const s of [
    'https://github.com/rohansx/cloakpipe/releases/tag/v0.14.0',
    'https://crates.io/crates/cloakpipe-cli/0.14.0',
    'ghcr.io/rohansx/cloakpipe:0.14.0',
  ]) assert.ok(overview.includes(s), `overview links ${s}`);
  assert.doesNotMatch(overview, /releases\/tag\/v0\.13\.0|cloakpipe-cli\/0\.13\.0|cloakpipe:0\.13\.0/, 'the overview links the v0.14.0 artefacts only');
  assert.match(overview, /<span class="badge oss">v0\.11<\/span> since v0\.11, and still in v0\.14\.0/);
  assert.match(overview, /<span class="badge oss">v0\.12<\/span> since v0\.12, and still in v0\.14\.0/);
  assert.match(overview, /<span class="badge oss">v0\.13<\/span> since v0\.13, and still in v0\.14\.0/);
  assert.match(overview, /<span class="badge next">v0\.14<\/span> new in v0\.14\.0/);
  assert.doesNotMatch(overview, /--path crates\/cloakpipe-cli/, 'no build-from-main instructions');
  assert.match(overview, /<span class="badge building">Roadmap<\/span> planned, not built/);
});

test('the comparison status row says v0.14.0 is released', () => {
  const row = page('comparison').split('\n').find((l) => l.startsWith('| **Status'));
  assert.ok(row, 'comparison has a status row');
  assert.ok(row.includes('v0.14.0 released 29 Oct 2026'), row);
});

test('operations reconcile --manifest takes a v1 manifest in v0.12.0', () => {
  const md = page('mcp-gate');
  assert.doesNotMatch(md, /reconcile --manifest` reads only the legacy/, 'fixed in v0.12.0');
  assert.match(md, /`operations reconcile --manifest` takes either format/);
});

test('install lines use crates.io pinned to 0.14.0 and mention the Docker image', () => {
  const qs = page('quickstart');
  assert.match(qs, /cargo install --locked cloakpipe-cli@0\.14\.0/);
  assert.match(qs, /git clone --branch v0\.14\.0 https:\/\/github\.com\/rohansx\/cloakpipe/);
  assert.ok(qs.includes('ghcr.io/rohansx/cloakpipe:0.14.0'), 'quickstart mentions the Docker image');
  assert.match(qs, /releases\/tag\/v0\.14\.0/, 'quickstart links the v0.14.0 release notes');
  assert.doesNotMatch(qs, /PII proxy/, 'the image runs the gate by default now');
  assert.match(qs, /\/docs\/docker/, 'quickstart points at the Docker page');
  assert.match(page('index'), /https:\/\/crates\.io\/crates\/cloakpipe-cli/);
  for (const p of docPages()) {
    const md = read(p);
    assert.doesNotMatch(md, /cloakpipe-cli@0\.1[23]|--branch v0\.1[23]|cloakpipe:0\.1[23]\.0`? (?:image )?(?:runs|is the)/, `${p}: install lines name 0.14.0`);
    assert.doesNotMatch(md, /cloakpipe:0\.13\.0/, `${p}: the image to run is 0.14.0`);
    // Links to core files on a tag point at the release they describe, v0.14.0.
    for (const m of md.matchAll(/github\.com\/rohansx\/cloakpipe\/(?:blob|tree)\/(v[0-9.]+)\//g)) assert.equal(m[1], 'v0.14.0', `${p}: link to core at ${m[1]}`);
    assert.doesNotMatch(md, /not on crates\.io/i, `${p}: 0.12.0 is on crates.io`);
    assert.doesNotMatch(md, /cargo install --git/, `${p}: install from crates.io`);
  }
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

test('every documented cloakpipe command and flag exists in the CLI built for v0.14.0', () => {
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
  for (const s of ['cloakpipe.decision/v1', 'entry_hash', 'prev_hash', 'args_fingerprint', 'cloakpipe ledger export', 'cloakpipe verify', 'pack.json', 'entries.jsonl', 'epoch', 'RFC 3161', 'Rekor', 'gaps', '--anchor-every', '--anchor-interval', 'anchor.failed', '\n## Audit pack\n']) {
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
  const md = page('integrations').split('\n---\n').slice(1).join('\n---\n'); // body, after the frontmatter
  const at = (s) => {
    const i = md.indexOf(s);
    assert.ok(i >= 0, `integrations mentions ${s}`);
    return i;
  };
  const hosts = Math.max(at('claude mcp add'), at('.mcp.json'), at('.cursor/mcp.json'), at('~/.codex/config.toml'), at('[mcp_servers.'));
  assert.ok(hosts < at('LangChain'), 'host snippets come before LangChain');
  assert.match(md, /LangChain[\s\S]{0,400}PII/, 'LangChain is described as a PII proxy client');
  // Webhooks and OTel are new in v0.13.0; hosted alerts are not built.
  assert.match(md, /OpenTelemetry[^\n]*badge oss">v0\.13|badge oss">v0\.13[^\n]*OpenTelemetry/, 'OTel is v0.13');
  assert.match(md, /[Ww]ebhooks[^\n]*badge oss">v0\.13|badge oss">v0\.13[^\n]*[Ww]ebhooks/, 'webhooks are v0.13');
  assert.match(md, /badge building[^\n]*[Hh]osted alerts/, 'hosted alerts stay roadmap');
});

test('comparison is dated, sourced and names the alternatives', () => {
  const md = page('comparison');
  for (const s of ['Agent Governance Toolkit', 'Pipelock', 'observability', 'as of October 2026', 'https://github.com/microsoft/agent-governance-toolkit', 'https://github.com/pipelab-org/pipelock', '## Sources']) {
    assert.ok(md.includes(s), `comparison mentions ${s}`);
  }
});

test('the changelog page source has the dated v0.12.0, v0.13.0 and v0.14.0 releases', () => {
  const md = read('src/content/CHANGELOG.md');
  assert.ok(md.includes('\n## [0.12.0] - 2026-10-27\n'), 'vendored changelog has a dated 0.12.0 section');
  const v012 = md.slice(md.indexOf('## [0.12.0]'), md.indexOf('## [0.11.0]'));
  assert.ok(v012.includes('cloakpipe.manifest.yaml'), '0.12.0 has the manifest entries');
  assert.ok(v012.includes('policy-enforcement gate'), '0.12.0 has the gate positioning');
  assert.ok(md.includes('\n## [0.13.0] - 2026-10-28\n'), 'vendored changelog has a dated 0.13.0 section');
  assert.ok(md.includes('\n## [0.14.0] - 2026-10-29\n'), 'vendored changelog has a dated 0.14.0 section');
  const unreleased = md.slice(md.indexOf('## [Unreleased]'), md.indexOf('## [0.14.0]'));
  assert.equal(unreleased.trim(), '## [Unreleased]', 'nothing is unreleased at the tag');
  const v013 = md.slice(md.indexOf('## [0.13.0]'), md.indexOf('## [0.12.0]'));
  for (const s of ['--listen', '--server NAME=COMMAND', 'cloakpipe tools pin', '--webhook', '--otel-endpoint', 'docker/compose.example.yaml']) {
    assert.ok(v013.includes(s), `0.13.0 has ${s}`);
  }
  const astro = read('src/pages/changelog.astro');
  assert.match(astro, /v0\.12\.0/, 'changelog page names v0.12.0');
  assert.match(astro, /^\s*<strong>v0\.14\.0<\/strong> \(29 October 2026\)/m, 'changelog page leads with v0.14.0');
  assert.match(astro, /<strong>v0\.13\.0<\/strong> \(28 October 2026\)/, 'changelog page names v0.13.0');
  assert.match(astro, /out of scope/, 'changelog page says older entries describe out-of-scope features');
});
