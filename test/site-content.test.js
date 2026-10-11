// Content checks for docs and blog source files. They run in `npm test`
// (no build needed) so the docs cannot silently drift from the action
// boundary spec, and the blog keeps its house rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
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
    'kind: ToolContract',
    'apiVersion: cloakpipe.co/v1alpha1',
    'bindTo: task.tenant',
    'sideEffect: true',
    'requiresApproval: true',
    '--tool-contract',
    '--task-context',
    'CLOAKPIPE_TASK_CONTEXT',
    '--approvals',
    '--approver-key',
    '--operations-db',
    'CLOAKPIPE_OPERATIONS_DB',
    'cloakpipe approve',
    'cloakpipe action fingerprint',
    'cloakpipe operations list',
    'cloakpipe operations reconcile',
    'cloakpipe.co/tool-call/v1',
    'cloakpipe.co/tool-contract/v1',
    'cloakpipe.co/operation/v1',
    'https://cloakpipe.co/attestations/approval/v1alpha1',
    '-32002',
    'operation_reconciled',
  ]) {
    assert.ok(md.includes(s), `mcp-gate.md mentions ${s}`);
  }
  for (const code of [
    'argument_missing',
    'argument_not_allowed',
    'argument_invalid',
    'scope_mismatch',
    'task_context_missing',
    'approval_required',
    'approval_invalid',
    'approval_expired',
    'operation_conflict',
    'reconcile_before_retry',
  ]) {
    assert.match(md, new RegExp('`' + code + '`'), `denial code ${code}`);
  }
  for (const state of ['in_flight', 'done', 'failed', 'unknown', 'not_applied']) {
    assert.ok(md.includes('`' + state + '`'), `operation state ${state}`);
  }
});

test('certification docs describe the two-way boundary rule', () => {
  const md = read('src/pages/docs/certification.md');
  for (const s of ['boundary:', 'minDenyRate', 'minAllowRate', 'cloakpipe.expect', 'under_blocking', 'over_refusal', 'boundary_incomplete']) {
    assert.ok(md.includes(s), `certification.md mentions ${s}`);
  }
});

test('docs never reference the private cloud repository', () => {
  for (const p of ['src/pages/docs/mcp-gate.md', 'src/pages/docs/certification.md', POST, 'src/pages/blog/index.astro']) {
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
