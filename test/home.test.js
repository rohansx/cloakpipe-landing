// Home page content. The home page is the product pitch, so it must say what
// the gate does today and label everything else as roadmap. These checks run
// on the source (no build needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const home = () => read('src/partials/index.html');

/** Visible text: tags, styles and entities stripped, whitespace collapsed. */
const text = (html) =>
  html
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The markup of the element with `id`, up to the closing tag of the same name. */
function section(html, id) {
  const open = new RegExp(`<(section|div|figure)[^>]*\\bid="${id}"[^>]*>`).exec(html);
  assert.ok(open, `#${id} exists`);
  const tag = open[1];
  let depth = 0;
  const re = new RegExp(`<${tag}\\b|</${tag}>`, 'g');
  re.lastIndex = open.index;
  for (let m; (m = re.exec(html)); ) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(open.index, m.index + m[0].length);
  }
  assert.fail(`#${id} is closed`);
}

test('hero: headline and the one-line stance', () => {
  const html = home();
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  assert.ok(h1, 'has an h1');
  assert.equal(text(h1[1]), 'Policy enforcement for teams running AI agents in production');
  assert.equal((html.match(/<h1\b/g) || []).length, 1, 'exactly one h1');
  assert.ok(text(html).includes('Model proposes. Code disposes. CloakPipe is the code.'));
});

test('hero shows the Example 2 deny transcript, and only the transcript', () => {
  const hero = section(home(), 'hero-deny');
  const t = text(hero);
  for (const s of [
    'send_email',
    'attacker@evil.com',
    "not the ticket's customer",
    '-32001',
    'scope_mismatch',
    '"path":"/to"',
    'tool call refused by CloakPipe: scope_mismatch',
    'never called',
    'receipt written',
  ]) {
    assert.ok(t.includes(s), `hero transcript mentions ${s}`);
  }
  // No configuration in the hero (the bindTo-only contract is not shown until
  // the manifest format with anyOf lands).
  for (const s of ['bindTo', 'ToolContract', 'apiVersion', 'anyOf', 'yaml', 'manifest']) {
    assert.ok(!hero.includes(s), `hero has no config (${s})`);
  }
});

test('the page shows no config snippet anywhere', () => {
  const html = home();
  for (const s of ['bindTo', 'kind: ToolContract', 'apiVersion:', 'class="yaml"']) {
    assert.ok(!html.includes(s), `no config (${s})`);
  }
});

test('three problems: tricked, over-permissioned, repeats itself', () => {
  const t = text(section(home(), 'problems'));
  for (const s of ['tricked', 'over-permissioned', 'repeats itself']) {
    assert.match(t, new RegExp(s, 'i'), `problem: ${s}`);
  }
});

test('Declare, Enforce, Prove', () => {
  const html = section(home(), 'how');
  for (const s of ['Declare', 'Enforce', 'Prove']) {
    assert.match(html, new RegExp(`<h3[^>]*>[^<]*${s}`), `step ${s}`);
  }
  const t = text(html);
  assert.match(t, /closed by default/i);
  assert.match(t, /RFC 3161/);
  assert.match(t, /Rekor/);
  assert.match(t, /offline/i);
});

test('four examples, each with an honest status badge', () => {
  const html = section(home(), 'examples');
  const cards = [...html.matchAll(/<article class="ex[^"]*"[\s\S]*?<\/article>/g)].map((m) => m[0]);
  assert.equal(cards.length, 4, 'four example cards');
  const badge = (c) => {
    const m = /<span class="status ([a-z-]+)">([\s\S]*?)<\/span>/.exec(c);
    assert.ok(m, 'card has a status badge');
    return { kind: m[1], label: text(m[2]) };
  };
  const [one, two, three, four] = cards.map(badge);
  assert.deepEqual(one, { kind: 'shipping', label: 'Shipping' });
  assert.deepEqual(two, { kind: 'shipping', label: 'Shipping' });
  assert.equal(three.kind, 'partial');
  assert.equal(three.label, 'CLI approval today; Slack approvals on roadmap');
  assert.equal(four.kind, 'shipping');
  assert.equal(four.label, 'Shipping · manual reconcile');
  assert.match(text(cards[1]), /attacker@evil\.com/);
  assert.match(text(cards[1]), /undeclared_tool/);
  assert.match(text(cards[2]), /approval_required/);
  assert.match(text(cards[2]), /cloakpipe approve/);
  assert.match(text(cards[3]), /reconcile_before_retry/);
  assert.match(text(cards[3]), /cloakpipe operations reconcile/);
});

test('"What it is not"', () => {
  const t = text(section(home(), 'not'));
  assert.match(t, /What it is not/);
  assert.match(t, /prompt filter/i);
  assert.match(t, /classifier/i);
  assert.match(t, /governance platform/i);
  assert.match(t, /never becomes? a tool call/i);
});

test('free, open-source gate note; waitlist is secondary', () => {
  const html = home();
  assert.ok(text(html).includes('Free, open-source gate (MIT)'));
  const primary = [...html.matchAll(/<a class="btn btn-lg btn-cta" href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(primary.length > 0, 'has a primary CTA');
  for (const href of primary) {
    assert.ok(href === '/docs/quickstart' || href === 'https://github.com/rohansx/cloakpipe', `primary CTA ${href}`);
  }
  assert.match(html, /<a class="btn[^"]*" href="\/waitlist"/, 'waitlist is still linked');
});

test('retired and unshipped claims are gone from the home page', () => {
  const html = home();
  const t = text(html);
  for (const re of [
    /Cedar/i,
    /Building next/i,
    /Langfuse/i,
    /Braintrust/i,
    /certif/i,
    /Agent Release/,
    /Evaluate/,
    /pseudonymi[sz]/i,
    /dashboard/i,
    /signed receipt/i,
    /CloakPipe Cloud/i,
    /cloakpipe-cloud/,
    /api\.cloakpipe\.co/,
    /OpenTelemetry/,
  ]) {
    assert.doesNotMatch(t, re, `home page does not say ${re}`);
  }
  // Roadmap items are allowed only when labelled as roadmap.
  for (const m of t.matchAll(/[^.]*\bSlack\b[^.]*\./g)) assert.match(m[0], /roadmap/i, `"${m[0].trim()}" is labelled roadmap`);
});

test('home page title and description', () => {
  const page = read('src/pages/index.astro');
  assert.match(page, /const description = "[^"]*Model proposes\. Code disposes\.[^"]*"/);
  assert.doesNotMatch(page, /signed receipt/i);
});
