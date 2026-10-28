// Docs for the gate features built for the next release, v0.13.0, and not in
// v0.12.0: MCP over HTTP, several servers per gate, tool pinning, event
// delivery (webhooks, OpenTelemetry, a JSONL log) and the gate-by-default
// Docker image. They are labelled Unreleased until v0.13.0 is tagged.
//
// The claims are checked against what the code does, captured from the
// binary built from rohansx/cloakpipe gate/integ (PR #42):
//   - test/fixtures/cli-v0.13-unreleased.json: --help (scripts/cli-fixture.mjs)
//   - test/fixtures/webhooks-v0.13-unreleased.json: real `cloakpipe events
//     test` requests in each format, with the secret that signed them
//   - test/fixtures/gate-entrypoint-v0.13-unreleased.sh: the image entrypoint
//   - test/fixtures/claude-mcp-add.json: `claude mcp add --help`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
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

const CLI012 = JSON.parse(read('test/fixtures/cli-v0.12.json'));
const CLI013 = JSON.parse(read('test/fixtures/cli-v0.13-unreleased.json'));
const HOOKS = JSON.parse(read('test/fixtures/webhooks-v0.13-unreleased.json'));
const ENTRYPOINT = read('test/fixtures/gate-entrypoint-v0.13-unreleased.sh');
const CLAUDE = JSON.parse(read('test/fixtures/claude-mcp-add.json'));

const UNREL = '<span class="badge unreleased">Unreleased</span>';
const ROADMAP = '<span class="badge building">Roadmap</span>';

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
      const path = CLI013.commands[two] ? two : words[0];
      const args = (words.length === 2 && path !== two ? words[1] + ' ' : '') + m[2];
      const flags = args.replace(/"[^"]*"|'[^']*'/g, '').match(/--[a-z][a-z0-9-]*/g) ?? [];
      out.push({ path, flags, text: m[0].trim() });
    }
  }
  return out;
}

/** The commands and flags a page shows that v0.12.0 does not have. */
function newIn013(md) {
  const found = [];
  for (const { path, flags, text } of invocations(md)) {
    if (!CLI012.commands[path]) found.push(`cloakpipe ${path} (${text})`);
    const known = new Set([...(CLI012.commands[path] ?? []), ...(CLI012.hidden[path] ?? []), ...CLI012.commands['(root)']]);
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

// ---------------------------------------------------------------------------
// The badge

test('the layout styles the Unreleased badge and the overview explains it', () => {
  assert.match(read('src/layouts/Docs.astro'), /\.badge\.unreleased \{ color: var\(--[a-z0-9-]+\); \}/);
  const overview = page('index');
  assert.match(overview, /<span class="badge unreleased">Unreleased<\/span> built for the next release, v0\.13\.0, and not in any release yet/);
  // How to use it before the tag: build from source, not crates.io 0.12.0.
  assert.match(overview, /cargo install --locked --path crates\/cloakpipe-cli/);
});

test('the fixtures come from the binary built for v0.13.0', () => {
  assert.match(CLI013.source, /gate\/integ/);
  assert.match(HOOKS.source, /gate\/integ/);
  // The generator reproduces the v0.12 fixture for every command v0.12 has,
  // apart from mcp-proxy, which gained flags.
  for (const [cmd, flags] of Object.entries(CLI012.commands)) {
    if (cmd === 'mcp-proxy') continue;
    assert.deepEqual(CLI013.commands[cmd], flags, `${cmd} is unchanged`);
  }
  for (const f of CLI012.commands['mcp-proxy']) assert.ok(CLI013.commands['mcp-proxy'].includes(f), `mcp-proxy keeps ${f}`);
});

test('a command or flag v0.12.0 does not have is only shown under an Unreleased badge', () => {
  let n = 0;
  for (const p of docPages()) {
    const { lede, sections: secs } = sections(read(p));
    const pageIsUnreleased = lede.includes(UNREL);
    for (const s of [lede, ...secs]) {
      const fresh = newIn013(s);
      n += fresh.length;
      if (fresh.length && !pageIsUnreleased) {
        assert.ok(s.includes(UNREL), `${p}, section "${s.split('\n').find(Boolean)}": shows ${fresh[0]} without the Unreleased badge`);
      }
    }
  }
  assert.ok(n >= 15, `found ${n} unreleased commands and flags in the docs`);
});

test('built-for-v0.13.0 features are not called Roadmap or v0.12', () => {
  const built = [/HTTP\/SSE MCP/i, /several (?:upstreams|servers)/i, /`?tools\/list`? pinning/i, /\bwebhooks?\b/i, /OpenTelemetry/i, /drift (?:alerts|detection)/i];
  // What stays roadmap: a hosted plane, per-webhook secrets, SSE streams, HTTP servers behind --server.
  const stillRoadmap = /hosted|each webhook|per webhook|SSE response streams|GET \/mcp|HTTP (?:upstreams|servers) behind|PagerDuty/i;
  for (const p of docPages()) {
    for (const line of read(p).split('\n')) {
      if (line.includes('badge building') && !stillRoadmap.test(line)) {
        for (const re of built) assert.doesNotMatch(line, re, `${p}: Roadmap line names a built feature: ${line.trim().slice(0, 140)}`);
      }
      if (line.includes('badge next') && !line.includes('badge unreleased')) {
        assert.equal(newIn013(line.includes('`') ? line : '').length, 0, `${p}: a v0.12 line shows an unreleased flag: ${line.trim().slice(0, 140)}`);
      }
    }
  }
});

test('the status tables put the new features under Unreleased', () => {
  const row = (md, re) => {
    const r = md.split('\n').find((l) => l.startsWith('|') && re.test(l));
    assert.ok(r, `a status row matches ${re}`);
    return r;
  };
  for (const [slug, re] of [
    ['index', /MCP over HTTP/],
    ['index', /several (?:stdio )?servers/i],
    ['index', /[Ww]ebhooks/],
    ['index', /Docker image/],
    ['mcp-gate', /MCP over HTTP/],
    ['mcp-gate', /tools lock|pinning/],
    ['integrations', /over HTTP/],
  ]) {
    assert.ok(row(page(slug), re).includes(UNREL), `${slug}: ${re} row is Unreleased`);
  }
  assert.ok(row(page('index'), /hosted/i).includes(ROADMAP), 'a hosted plane stays roadmap');
});

// ---------------------------------------------------------------------------
// MCP gate: HTTP, several servers, pinning

test('mcp-gate documents MCP over HTTP as the code behaves', () => {
  const md = page('mcp-gate');
  for (const s of [
    '## MCP over HTTP',
    'POST /mcp',
    'Mcp-Session-Id',
    '`202`',
    '`405`',
    '`400`',
    '`404`',
    'DELETE /mcp',
    'GET /health',
    'Origin',
    'Authorization: Bearer',
    'env:VAR',
    'text/event-stream',
    'upstream_unavailable',
    '`-32003`',
    'MCP over HTTP listening on http://127.0.0.1:8900/mcp',
    '2025-06-18',
  ]) {
    assert.ok(md.includes(s), `mcp-gate mentions ${s}`);
  }
  assert.match(md, /`--upstream-url`[^\n]*(?:cannot|not) (?:be )?combined? with `--server` or `--tools-lock`|`--server` (?:and|or) `--tools-lock`[^\n]*stdio/, 'upstream-url limits');
  assert.match(md, /SSE response streams[^\n]*badge building|badge building[^\n]*SSE response streams/, 'SSE streams to agents are roadmap');
});

test('mcp-gate documents several servers and tool pinning as the code behaves', () => {
  const md = page('mcp-gate');
  for (const s of [
    '## Several servers',
    '## Pinning tool definitions',
    '--server NAME=COMMAND',
    '`default`',
    '<server>__<tool>',
    '`-32601`',
    'cloakpipe.tools-lock/v1',
    'RFC 8785',
    '`name`, `description`, `inputSchema` and `annotations`',
    'tool_drift',
    'tool.drift',
    'notifications/tools/list_changed',
    'cloakpipe tools pin',
    'cloakpipe tools diff',
    '--against',
    'exits 1',
  ]) {
    assert.ok(md.includes(s), `mcp-gate mentions ${s}`);
  }
  // The refusal table lists the new reasons.
  for (const r of ['tool_drift', 'upstream_unavailable']) assert.match(md, new RegExp(`^\\| \`${r}\` \\|`, 'm'), `refusal row ${r}`);
  // The v0.12 limits stay, but only as v0.12.0 limits.
  assert.doesNotMatch(md, /^- One upstream server per gate/m, 'the one-server limit is qualified');
  assert.doesNotMatch(md, /^- `tools\/list` is passed through unchanged/m, 'the pinning limit is qualified');
});

// ---------------------------------------------------------------------------
// Events

const EVENT_KINDS = ['decision.deny', 'approval.requested', 'approval.mismatch', 'shadow.finding', 'side_effect.replayed', 'side_effect.unknown', 'tool.drift', 'anchor.failed'];

test('the events page is Unreleased and lists every event kind', () => {
  const md = page('events');
  assert.ok(sections(md).lede.includes(UNREL), 'events page lede has the Unreleased badge');
  for (const k of EVENT_KINDS) assert.match(md, new RegExp(`^\\| \`${k.replace('.', '\\.')}\` \\|`, 'm'), `events table lists ${k}`);
  for (const s of ['cloakpipe.event/v1', '--events-log', '--webhook', '--webhook-secret-file', '--webhook-format', '--otel-endpoint', '`--otel`', 'OTEL_EXPORTER_OTLP_ENDPOINT', '/v1/traces', 'cloakpipe.decision']) {
    assert.ok(md.includes(s), `events mentions ${s}`);
  }
});

test('the example event on the events page has exactly the members a real event has', () => {
  const md = page('events');
  const block = /```json\n(\{\n  "schema": "cloakpipe\.event\/v1"[\s\S]*?)```/.exec(md);
  assert.ok(block, 'events page shows an example event');
  const shown = JSON.parse(block[1].replace(/…/g, ''));
  const real = JSON.parse(HOOKS.requests.find((r) => r.path === '/generic').body);
  assert.deepEqual(Object.keys(shown).sort(), Object.keys(real).sort());
  assert.ok(!block[1].includes('attacker'), 'no argument value in the example');
});

test('the documented fingerprint formula reproduces a real fingerprint', () => {
  const md = page('events');
  assert.ok(md.includes('`kind|reason|tool|path|policy_version`'), 'formula shown');
  assert.match(md, /absent member (?:counts|is counted) as an empty string/);
  assert.match(md, /`<server>\/<tool>`/, 'tool.drift fingerprints name the server');
  const e = JSON.parse(HOOKS.requests[0].body);
  const input = [e.kind, e.reason, e.tool, e.path, e.policy_version].map((v) => v ?? '').join('|');
  assert.equal(`sha256:${createHash('sha256').update(input).digest('hex')}`, e.fingerprint);
});

test('the documented signature algorithm verifies real webhook requests', () => {
  const md = page('events');
  assert.ok(md.includes('CloakPipe-Signature: t=<unix seconds>,v1=<hex>'));
  assert.ok(md.includes('hex( HMAC-SHA256( secret, "<t>" + "." + <raw request body> ) )'));
  for (const h of ['CloakPipe-Event', 'CloakPipe-Fingerprint']) assert.ok(md.includes(h), `events mentions ${h}`);
  assert.match(md, /constant time/);
  assert.equal(HOOKS.requests.length, 3);
  for (const r of HOOKS.requests) {
    const sig = r.headers['cloakpipe-signature'];
    const t = /(?:^|,)t=(\d+)/.exec(sig)[1];
    const v1 = /(?:^|,)v1=([0-9a-f]+)/.exec(sig)[1];
    // As documented: hex(HMAC-SHA256(secret, "<t>.<body>")) over the raw body.
    const mine = createHmac('sha256', HOOKS.secret).update(`${t}.${r.body}`).digest('hex');
    assert.equal(mine, v1, `${r.path}: documented algorithm matches`);
    assert.equal(r.headers['cloakpipe-event'], 'decision.deny');
    assert.equal(r.headers['cloakpipe-fingerprint'], JSON.parse(HOOKS.requests[0].body).fingerprint);
  }
});

test('the Slack and Discord descriptions match the payloads the gate sends', () => {
  const md = page('events');
  const slack = JSON.parse(HOOKS.requests.find((r) => r.path === '/slack').body);
  const discord = JSON.parse(HOOKS.requests.find((r) => r.path === '/discord').body);
  const header = slack.blocks.find((b) => b.type === 'header').text.text;
  assert.ok(md.includes(`"${header}"`), `events quotes the Slack header ${header}`);
  const fields = slack.blocks.find((b) => b.type === 'section').fields.map((f) => /^\*([A-Za-z ]+)\*/.exec(f.text)[1]);
  const slackSection = md.slice(md.indexOf('### Slack'), md.indexOf('### Discord'));
  for (const f of fields) assert.match(slackSection, new RegExp(`\\b${f.toLowerCase()}\\b`, 'i'), `Slack field ${f} is described`);
  assert.ok(slackSection.includes('Incoming Webhooks'), 'Slack setup names Incoming Webhooks');
  assert.ok(slackSection.includes('cloakpipe events test --webhook "$SLACK_WEBHOOK_URL" --webhook-format slack'));
  assert.equal(discord.embeds[0].footer.text, JSON.parse(HOOKS.requests[0].body).fingerprint, 'Discord puts the fingerprint in the footer');
  assert.match(md.slice(md.indexOf('### Discord')), /fingerprint[^.]*footer|footer[^.]*fingerprint/);
  // No payload carries an argument value; the sample has none, and the docs say so.
  assert.match(md, /never carries an argument value/);
});

test('the events page states the delivery limits the code has', () => {
  const md = page('events');
  for (const s of ['1024', 'three tries', '5 s', 'never delays', 'changes it']) assert.ok(md.includes(s), `events mentions ${s}`);
  assert.match(md, /hosted[^\n]*not built|not built[^\n]*hosted/i, 'no hosted plane');
  assert.match(md, /each webhook[^\n]*badge building|badge building[^\n]*each webhook/i, 'per-webhook secrets are roadmap');
});

// ---------------------------------------------------------------------------
// Docker

test('the docker page documents every variable the entrypoint reads, and no other', () => {
  const md = page('docker');
  assert.ok(sections(md).lede.includes(UNREL), 'docker page lede has the Unreleased badge');
  const read_ = new Set([...ENTRYPOINT.matchAll(/\$\{(CLOAKPIPE_[A-Z_]+)/g)].map((m) => m[1]));
  assert.ok(read_.size >= 12, `entrypoint reads ${read_.size} variables`);
  for (const v of read_) assert.ok(md.includes('`' + v), `docker documents ${v}`);
  const image = new Set(['CLOAKPIPE_HOME', 'CLOAKPIPE_OPERATIONS_DB', 'CLOAKPIPE_TASK_CONTEXT', 'CLOAKPIPE_VAULT_KEY']);
  for (const m of md.matchAll(/`(CLOAKPIPE_[A-Z_]+)/g)) assert.ok(read_.has(m[1]) || image.has(m[1]), `docker documents ${m[1]}, which nothing reads`);
});

test('the docker page says what the image runs and where state lives', () => {
  const md = page('docker');
  for (const s of [
    '--listen 0.0.0.0:8900',
    '/app/cloakpipe.manifest.yaml',
    '/data',
    'CLOAKPIPE_HOME=/data',
    'GET /health',
    'docker/compose.example.yaml',
    'mock_http_upstream.py',
    'CLOAKPIPE_INSECURE_NO_TOKEN=1',
    'exit code 2',
    'cloakpipe-gate gate --mode shadow',
    'cloakpipe-gate start',
    'ghcr.io/rohansx/cloakpipe:0.12.0',
  ]) {
    assert.ok(md.includes(s), `docker mentions ${s}`);
  }
  // The entrypoint refuses to start in four cases; each is described.
  assert.equal((ENTRYPOINT.match(/\bfail "/g) ?? []).length, 4, 'the entrypoint has four refusals');
  const refusals = md.slice(md.indexOf('refuses to start'));
  assert.ok(md.includes('refuses to start'), 'docker says when the entrypoint refuses to start');
  for (const s of ['no manifest', 'both', 'neither', 'non-loopback']) assert.ok(refusals.slice(0, 900).includes(s), `refusal: ${s}`);
  assert.match(md, /0\.12\.0[^\n]*PII proxy/, 'the released image still runs the PII proxy by default');
});

// ---------------------------------------------------------------------------
// Claude Code

test('Claude Code setup over HTTP uses flags `claude mcp add` has', () => {
  const md = page('integrations');
  assert.ok(md.includes('claude mcp add --transport http'), 'HTTP form');
  assert.match(md, /--header "Authorization: Bearer \$\(cat [^)]+\)"/, 'token header');
  assert.match(md, /cloakpipe mcp-proxy --listen 127\.0\.0\.1:8900 --listen-token-file/);
  let n = 0;
  for (const p of docPages()) {
    for (const m of code(read(p)).matchAll(/claude mcp add ([^\n]*)/g)) {
      const own = m[1].split(' -- ')[0]; // flags after -- belong to the server command
      for (const f of own.replace(/"[^"]*"|'[^']*'/g, '').match(/--[a-z][a-z-]*/g) ?? []) {
        n++;
        assert.ok(CLAUDE.flags.includes(f), `${p}: claude mcp add has no ${f}`);
      }
    }
  }
  assert.ok(n >= 3, `checked ${n} claude mcp add flags`);
});

test('the changelog page source carries the unreleased entries', () => {
  const md = read('src/content/CHANGELOG.md');
  const unreleased = md.slice(md.indexOf('## [Unreleased]'), md.indexOf('## [0.12.0]'));
  for (const s of ['--upstream-url', '--tools-lock', 'tool_drift', 'verify-signature', 'Breaking (Docker)']) assert.ok(unreleased.includes(s), `Unreleased has ${s}`);
});
