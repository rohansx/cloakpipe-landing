// Docs for v0.14.0 (tagged 29 October 2026): approvals through a broker.
// `approval.show`, `mcp-proxy --approvals-url / --approvals-secret-file /
// --approvals-poll-interval`, `cloakpipe approvals keys`, the open broker
// protocol and the `approval_denied` refusal. New things carry the v0.14
// badge (`badge next`, the newest release).
//
// The claims are checked against what the released binary does:
//   - test/fixtures/cli-v0.14.json: --help of cloakpipe-cli 0.14.0 from
//     crates.io (scripts/cli-fixture.mjs, hidden flags from cli-v0.13.json)
//   - test/fixtures/approval-broker-v0.14.json: real traffic between that
//     binary and a recording broker (approve and deny paths), with the
//     secret that signed it, the refusals the agent got and the files the
//     gate wrote
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHmac } from 'node:crypto';
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

const CLI013 = JSON.parse(read('test/fixtures/cli-v0.13.json'));
const CLI014 = JSON.parse(read('test/fixtures/cli-v0.14.json'));
const BROKER = JSON.parse(read('test/fixtures/approval-broker-v0.14.json'));

const V014 = '<span class="badge next">v0.14</span>';
const ROADMAP = '<span class="badge building">Roadmap</span>';
const GATE_FLAGS = ['--approvals', '--approver-key', '--approvals-url', '--approvals-secret-file', '--approvals-poll-interval', '--task-context'];

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
      const path = CLI014.commands[two] ? two : words[0];
      const args = (words.length === 2 && path !== two ? words[1] + ' ' : '') + m[2];
      const flags = args.replace(/"[^"]*"|'[^']*'/g, '').match(/--[a-z][a-z0-9-]*/g) ?? [];
      out.push({ path, flags, text: m[0].trim() });
    }
  }
  return out;
}

/** The commands and flags a page shows that v0.13.0 does not have. */
function newIn014(md) {
  const found = [];
  for (const { path, flags, text } of invocations(md)) {
    if (!CLI013.commands[path]) found.push(`cloakpipe ${path} (${text})`);
    const known = new Set([...(CLI013.commands[path] ?? []), ...(CLI013.hidden[path] ?? []), ...CLI013.commands['(root)']]);
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

/** The `| `reason` |` rows of a Markdown table. */
const hasRow = (md, first) => md.split('\n').find((l) => l.startsWith(`| \`${first}\``) || l.startsWith(`| \`${first} `));

// ---------------------------------------------------------------------------
// Fixtures and badges

test('the fixtures come from the v0.14.0 binary, which only adds the broker flags and approvals keys', () => {
  assert.match(CLI014.source, /cloakpipe-cli 0\.14\.0[^"]*v0\.14\.0/);
  assert.match(BROKER.source, /0\.14\.0/);
  for (const [cmd, flags] of Object.entries(CLI013.commands)) {
    if (cmd === 'mcp-proxy') continue;
    assert.deepEqual(CLI014.commands[cmd], flags, `${cmd} is unchanged`);
  }
  const added = CLI014.commands['mcp-proxy'].filter((f) => !CLI013.commands['mcp-proxy'].includes(f));
  assert.deepEqual(added, ['--approvals-poll-interval', '--approvals-secret-file', '--approvals-url']);
  const newCommands = Object.keys(CLI014.commands).filter((c) => !CLI013.commands[c]);
  assert.deepEqual(newCommands.sort(), ['approvals', 'approvals keys']);
  assert.deepEqual(CLI014.commands['approvals keys'], ['--approvals-secret-file', '--approvals-url', '--help', '--out']);
  assert.deepEqual(CLI014.hidden, CLI013.hidden, 'hidden flags carried over');
});

test('the overview explains the v0.14 badge and lists approvals through a broker', () => {
  const overview = page('index');
  assert.ok(overview.includes(`${V014} new in v0.14.0: not in the 0.13.0 crates or the 0.13.0 image.`));
  const row = overview.split('\n').find((l) => l.startsWith('|') && /broker/i.test(l) && l.includes(V014));
  assert.ok(row, 'a status row puts approvals through a broker under v0.14');
  for (const s of ['`approval.show`', '`--approvals-url`', '`cloakpipe approvals keys`', '/docs/approvals']) assert.ok(row.includes(s), `status row: ${s}`);
  for (const l of overview.split('\n').filter((x) => x.includes(ROADMAP))) {
    assert.doesNotMatch(l, /^\| An approval broker/, 'the approval broker row is no longer roadmap');
  }
  assert.match(overview, /\[Approvals\]\(\/docs\/approvals\)/, 'where to go next links the approvals page');
});

test('a command or flag v0.13.0 does not have is only shown under the v0.14 badge', () => {
  let n = 0;
  for (const p of docPages()) {
    const { lede, sections: secs } = sections(read(p));
    const pageIs014 = lede.includes(V014);
    for (const s of [lede, ...secs]) {
      const fresh = newIn014(s);
      n += fresh.length;
      if (fresh.length && !pageIs014) {
        assert.ok(s.includes(V014), `${p}, section "${s.split('\n').find(Boolean)}": shows ${fresh[0]} without the v0.14 badge`);
      }
    }
  }
  assert.ok(n >= 8, `found ${n} v0.14 commands and flags in the docs`);
});

// ---------------------------------------------------------------------------
// The approvals page

test('the approvals page is in the nav and the sitemap, and its lede carries the v0.14 badge', () => {
  assert.ok(read('src/lib/docs.ts').includes("{ title: 'Approvals', href: '/docs/approvals' }"), 'nav lists Approvals');
  assert.ok(read('public/sitemap.xml').includes('<loc>https://cloakpipe.co/docs/approvals</loc>'));
  const md = page('approvals');
  assert.match(md, /^---\nlayout: \.\.\/\.\.\/layouts\/Docs\.astro\ntitle: Approvals\ndescription: .{40,}\n/);
  assert.ok(sections(md).lede.includes(V014), 'lede has the v0.14 badge');
});

test('the approvals page covers approval.show and every gate flag the broker needs', () => {
  const md = page('approvals');
  assert.ok(md.includes('## approval.show') || md.includes('## `approval.show`'), 'a section on approval.show');
  assert.match(md, /```yaml\n[\s\S]*approval:\n[\s\S]*show: \[amount\]/, 'a manifest example with show');
  for (const f of GATE_FLAGS) {
    assert.ok(md.includes('`' + f), `approvals documents ${f}`);
    assert.ok(CLI014.commands['mcp-proxy'].includes(f), `mcp-proxy has ${f}`);
  }
  // Each broker flag is a row of the flag table.
  for (const f of ['--approvals-url', '--approvals-secret-file', '--approvals-poll-interval']) assert.ok(hasRow(md, f), `flag row ${f}`);
  assert.match(md, /`5s`[^\n]*default|default[^\n]*`5s`/, 'poll interval default');
  assert.match(md, /`taskId`/, 'the task context must have a taskId');
  assert.match(md, /scalar/i, 'show takes scalar values only');
  assert.match(md, /default[^.\n]*none|none by default/i, 'show defaults to none');
  // The flags are shown in a command the gate accepts.
  const run = invocations(md).find((i) => i.path === 'mcp-proxy' && i.flags.includes('--approvals-url'));
  assert.ok(run, 'a mcp-proxy command with --approvals-url');
  for (const f of GATE_FLAGS) assert.ok(run.flags.includes(f), `the example command passes ${f}`);
});

test('the approvals page documents cloakpipe approvals keys as the binary behaves', () => {
  const md = page('approvals');
  const keys = invocations(md).find((i) => i.path === 'approvals keys');
  assert.ok(keys, 'shows cloakpipe approvals keys');
  assert.deepEqual([...keys.flags].sort(), ['--approvals-secret-file', '--approvals-url', '--out']);
  // It wrote <keyid hex>.approver.json, refusing a keyid that is not its own.
  const [file] = BROKER.approvals_keys_files;
  assert.match(file, /^[0-9a-f]{16}\.approver\.json$/);
  assert.ok(md.includes('<keyid hex>.approver.json'), 'names the files it writes');
  assert.match(md, /refuses[^.]*keyid/, 'says it refuses a key whose keyid is not its own');
  assert.match(md, /[Rr]eview/, 'says to review keys before pinning them');
});

test('the approvals page documents the broker protocol, and the signing reproduces real requests', () => {
  const md = page('approvals');
  for (const s of ['POST <url>/approvals', 'GET <url>/approvals?since=<cursor>', 'GET <url>/approver-keys', 'cloakpipe.approval-request/v1', 'CloakPipe-Signature: t=<unix seconds>,v1=<hex>', '"<t>." + body', '`GET <target>`', 'cursor', 'idempotent', 'five minutes', 'DSSE']) {
    assert.ok(md.includes(s), `approvals mentions ${s}`);
  }
  assert.equal(BROKER.requests.filter((r) => r.method === 'POST').length, 2);
  for (const r of BROKER.requests) {
    const sig = r.headers['cloakpipe-signature'];
    const t = /(?:^|,)t=(\d+)/.exec(sig)[1];
    const v1 = /(?:^|,)v1=([0-9a-f]+)/.exec(sig)[1];
    // As documented: HMAC-SHA256 over "<t>." + the POST body, or "<t>." + "GET <target>".
    const signed = r.method === 'POST' ? r.body : `GET ${r.target}`;
    assert.equal(createHmac('sha256', BROKER.secret).update(`${t}.${signed}`).digest('hex'), v1, `${r.method} ${r.target}`);
  }
  assert.ok(BROKER.requests.some((r) => r.target === '/v1/gates/g1/approvals'), 'the first poll has no since');
  assert.ok(BROKER.requests.some((r) => /\?since=/.test(r.target)), 'later polls carry since');
});

test('the example approval request has exactly the members a real one has, and shows only approval.show values', () => {
  const md = page('approvals');
  const block = /```json\n(\{\n  "schema": "cloakpipe\.approval-request\/v1"[\s\S]*?)```/.exec(md);
  assert.ok(block, 'approvals shows an example request');
  const shown = JSON.parse(block[1].replace(/…/g, ''));
  const real = JSON.parse(BROKER.requests.find((r) => r.method === 'POST').body);
  assert.deepEqual(Object.keys(shown).sort(), Object.keys(real).sort());
  assert.deepEqual(Object.keys(real.shown), ['amount'], 'only the shown argument left the host');
  assert.deepEqual(Object.keys(shown.shown), ['amount']);
  assert.ok(!BROKER.requests.some((r) => (r.body ?? '').includes('T-1042')), 'ticket_id was never sent');
});

test('the poll records and the denial marker are documented as the gate handles them', () => {
  const md = page('approvals');
  for (const s of ['"status": "approved"', '"status": "denied"', '"status": "expired"', '"envelope"', '"not_after"', '"task_id"', '<fingerprint hex>.approval.json', '<fingerprint hex>.denied.json']) {
    assert.ok(md.includes(s), `approvals mentions ${s}`);
  }
  // The gate wrote a receipt after the approval and a denial marker after the denial.
  assert.ok(BROKER.approvals_dir_after_approve.every((f) => /^[0-9a-f]{64}\.approval\.json$/.test(f)));
  assert.ok(BROKER.approvals_dir_after_deny.some((f) => /^[0-9a-f]{64}\.denied\.json$/.test(f)));
  assert.match(md, /approval\.mismatch/, 'a receipt that does not verify raises approval.mismatch');
  assert.match(md, /never waits|never wait/, 'decisions never wait on the broker');
});

test('the refusal shown is a real one, and approval_request takes the values the gate sends', () => {
  const md = page('approvals');
  const states = BROKER.refusals.map((r) => r.error.data.approval_request);
  assert.deepEqual([...new Set(states)].sort(), ['denied', 'pending', 'requested']);
  for (const s of states) assert.ok(md.includes('`' + s + '`'), `approvals explains ${s}`);
  const real = BROKER.refusals[0].error.data;
  const block = /```json\n(\{"jsonrpc":"2\.0"[^\n]*approval_required[^\n]*)\n```/.exec(md);
  assert.ok(block, 'approvals shows an approval_required refusal');
  assert.deepEqual(Object.keys(JSON.parse(block[1].replace(/…/g, '')).error.data).sort(), Object.keys(real).sort());
  assert.ok(md.includes(real.hint), 'quotes the hint the gate sends');
  const denied = BROKER.refusals.at(-1).error.data;
  assert.equal(denied.reason, 'approval_denied');
  assert.ok(md.includes(denied.hint), 'quotes the denial hint');
});

test('approval_denied and expiry are documented on the approvals, mcp-gate and manifest pages', () => {
  const md = page('approvals');
  assert.ok(md.includes('## Denied and expired'), 'a section on denial and expiry');
  assert.match(md, /`approval_expired`[^\n]*`notAfter`/, 'approval_expired keeps its meaning');
  assert.match(md, /expired[^\n]*(?:files? (?:it|a new request)|new request)/i, 'an expired request is filed again');
  for (const slug of ['mcp-gate', 'manifest']) {
    const row = hasRow(page(slug), 'approval_denied');
    assert.ok(row, `${slug} has an approval_denied row`);
    assert.ok(row.includes(V014), `${slug}: approval_denied is v0.14`);
  }
  assert.match(page('events'), /approval_denied/, 'events: a denial is a decision.deny');
});

test('data minimisation: low-entropy fingerprints, show sparingly', () => {
  for (const slug of ['approvals', 'keys', 'threat-model', 'manifest']) {
    const md = page(slug);
    assert.match(md, /low-entropy/, `${slug} warns about low-entropy fingerprints`);
  }
  const md = page('approvals');
  assert.match(md, /sparingly/);
  assert.match(md, /brute.force|guess/i);
  assert.match(page('approvals'), /never leave the host|never leaves? the host/);
});

test('approving by hand still works without a broker', () => {
  const md = page('approvals');
  const offline = md.slice(md.indexOf('## Without a broker'));
  assert.ok(md.includes('## Without a broker'), 'a section on approving without a broker');
  assert.match(offline, /cloakpipe approve /, 'cloakpipe approve by hand');
  assert.match(offline, /offline|no network|without a network/i);
  assert.match(offline, /\.denied\.json/, 'a denial marker works without a broker too');
  // The marker shown has the members of the one the gate wrote.
  const marker = /```json\n(\{\n  "schema": "cloakpipe\.approval-denial\/v1"[\s\S]*?)```/.exec(offline);
  assert.ok(marker, 'shows a denial marker');
  assert.deepEqual(Object.keys(JSON.parse(marker[1])).sort(), Object.keys(BROKER.denial_marker).sort());
});

test('CloakPipe Cloud is a broker that is coming, with Slack approval cards, and nothing links a private repository', () => {
  const md = page('approvals');
  const cloud = md.split('\n').filter((l) => /CloakPipe Cloud/.test(l));
  assert.ok(cloud.length >= 1, 'the approvals page names CloakPipe Cloud as a broker');
  for (const l of cloud) {
    assert.ok(l.includes(ROADMAP), `Cloud line has the Roadmap badge: ${l.slice(0, 100)}`);
    assert.match(l, /coming soon/i);
  }
  assert.ok(cloud.some((l) => /Slack/.test(l) && /approval cards/.test(l)), 'Slack approval cards are coming');
  for (const p of docPages()) assert.doesNotMatch(read(p), /cloakpipe-cloud|github\.com\/rohansx\/cloakpipe-[a-z]/i, p);
});

test('no page still says approvals are command-line only or the broker is roadmap', () => {
  for (const p of docPages()) {
    const src = read(p);
    assert.doesNotMatch(src, /no approval broker|approval broker yet|approval broker is <span class="badge building">/i, `${p} says there is no broker`);
    assert.doesNotMatch(src, /a human still runs `cloakpipe approve`/, `${p}: approving is not command-line only`);
    for (const line of src.split('\n').filter((l) => l.includes('badge building'))) {
      assert.doesNotMatch(line, /\b(?:an )?approval broker\b(?![^\n]*(?:hosted|CloakPipe Cloud))/i, `${p}: Roadmap line calls the broker unbuilt: ${line.slice(0, 120)}`);
    }
  }
  const mg = page('mcp-gate');
  assert.match(mg, /\[Approvals\]\(\/docs\/approvals\)/, 'mcp-gate links the approvals page');
  assert.ok(hasRow(mg, '--approvals-url'), 'mcp-gate flag table has --approvals-url');
  const keys = page('keys');
  assert.match(keys, /cloakpipe approvals keys/, 'keys page: approver keys held by a broker');
});

test('the changelog page source carries the v0.14.0 entries', () => {
  const md = read('src/content/CHANGELOG.md');
  const v014 = md.slice(md.indexOf('## [0.14.0] - 2026-10-29'), md.indexOf('## [0.13.0]'));
  for (const s of ['--approvals-url', 'approval.show', 'approval_denied', 'cloakpipe approvals keys', '.denied.json', 'ApprovalRule']) assert.ok(v014.includes(s), `0.14.0 has ${s}`);
  assert.match(read('src/pages/changelog.astro'), /approval broker|broker/);
});
