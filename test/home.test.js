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

test('hero: one plain headline, one sentence, two buttons', () => {
  const html = home();
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  assert.ok(h1, 'has an h1');
  assert.equal(text(h1[1]), 'The gate between your AI agents and their tools');
  assert.equal((html.match(/<h1\b/g) || []).length, 1, 'exactly one h1');
  const hero = section(html, 'hero');
  const lede = /<p class="lede[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(hero);
  assert.ok(lede, 'hero has a lede');
  const words = text(lede[1]).split(' ').length;
  assert.ok(words <= 40, `lede is short (${words} words)`);
  assert.match(text(lede[1]), /contract/);
  assert.match(text(lede[1]), /refused/);
  assert.equal((hero.match(/<a class="btn\b/g) || []).length, 2, 'two hero buttons');
  for (const cls of ['hero-stats', 'stance', 'eyebrow', 'term-body']) {
    assert.ok(!hero.includes(`class="${cls}`), `hero has no .${cls} (keep it uncluttered)`);
  }
});

test('hero scene: agent, gate and tools as layers, with one call allowed and one refused', () => {
  const scene = section(home(), 'gate-scene');
  const svg = /<svg[^>]*>/.exec(scene);
  assert.ok(svg, 'the scene is an inline svg');
  assert.match(svg[0], /role="img"/);
  const label = /aria-label="([^"]+)"/.exec(svg[0]);
  assert.ok(label, 'svg has an aria-label');
  assert.match(label[1], /allowed/i);
  assert.match(label[1], /refused/i);
  for (const layer of ['layer-agent', 'layer-gate', 'layer-tools', 'ledger']) {
    assert.match(scene, new RegExp(`class="[^"]*\\b${layer}\\b`), `scene has ${layer}`);
  }
  assert.match(scene, /class="[^"]*\bcall-ok\b/, 'an allowed call');
  assert.match(scene, /class="[^"]*\bcall-deny\b/, 'a refused call');
  const steps = /<ol class="scene-steps"[\s\S]*?<\/ol>/.exec(scene);
  assert.ok(steps, 'the scene is explained in HTML text, not only inside the svg');
  assert.equal((steps[0].match(/<li\b/g) || []).length, 3, 'three steps');
  const t = text(steps[0]);
  assert.match(t, /proposes/i);
  assert.match(t, /contract/i);
  assert.match(t, /log/i);
});

test('scene v2: the ticket, the contract and the receipt are shown, with a synced caption', () => {
  const scene = section(home(), 'gate-scene');
  const svg = /<svg[\s\S]*?<\/svg>/.exec(scene)[0];
  const t = text(svg);
  // where the bad call comes from
  assert.match(svg, /class="[^"]*\bcallout-ticket\b/, 'ticket callout');
  assert.match(t, /#4472/);
  assert.match(t, /attacker@evil\.com/);
  // what the gate checks it against
  assert.match(svg, /class="[^"]*\bcallout-contract\b/, 'contract callout');
  assert.match(t, /must be the ticket's customer/);
  assert.match(t, /forwarded/);
  assert.match(t, /refused/);
  assert.match(t, /scope_mismatch/);
  // what is left behind
  assert.match(svg, /class="[^"]*\breceipt\b/, 'receipt tag on the ledger');
  // the caption narrates the loop in five beats
  const cap = /<div class="scene-caption"[\s\S]*?<\/div>/.exec(scene);
  assert.ok(cap, 'caption under the scene');
  assert.equal((cap[0].match(/<p\b/g) || []).length, 5, 'five caption beats');
  const ct = text(cap[0]);
  for (const s of ['proposes', 'contract', 'Hidden text', 'refuses', 'ledger']) assert.ok(ct.includes(s), `caption: ${s}`);
});

test('the scene animation respects reduced motion', () => {
  const html = home();
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)/);
});

test('statement: the one-line stance, under the hero', () => {
  const t = text(section(home(), 'statement'));
  assert.ok(t.includes('Model proposes. Code disposes. CloakPipe is the code.'));
});

test('the Example 2 deny transcript has its own section, not the hero', () => {
  const html = home();
  const hero = section(html, 'hero');
  for (const s of ['-32001', 'term-body', 'jsonrpc']) assert.ok(!hero.includes(s), `hero has no transcript (${s})`);
  const deny = section(html, 'deny');
  const t = text(deny);
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
    assert.ok(t.includes(s), `transcript mentions ${s}`);
  }
  for (const s of ['bindTo', 'ToolContract', 'apiVersion', 'anyOf', 'yaml', 'manifest']) {
    assert.ok(!deny.includes(s), `transcript has no config (${s})`);
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

test('Declare, Enforce, Prove describe v0.12.0 as it ships', () => {
  const html = section(home(), 'how');
  const t = text(html);
  // v0.12.0 ships Cedar, conditional approvals, shadow mode, a signed entry per decision and `cloakpipe verify`.
  assert.match(t, /Cedar policy/, 'Declare mentions the optional Cedar policy');
  assert.match(t, /rate limits/i);
  assert.match(t, /over \$100/, 'approval is conditional on the amount');
  assert.match(t, /--mode shadow/);
  assert.doesNotMatch(t, /--gate warn/, 'the v0.11 flag is gone');
  assert.match(t, /every decision/i, 'every decision, allowed or refused, is logged');
  assert.match(t, /signed/i);
  assert.match(t, /cloakpipe verify/);
  assert.doesNotMatch(t, /roadmap/i, 'nothing in Declare, Enforce, Prove is roadmap');
  for (const s of ['issue_refund', 'over $100']) assert.ok(text(html).includes(s), `contract panel: ${s}`);
});

test('nothing v0.12.0 ships is called roadmap on the home page', () => {
  const t = text(home());
  const roadmap = [...t.matchAll(/[^.]*\broadmap\b[^.]*\./gi)].map((m) => m[0]);
  for (const s of roadmap) {
    for (const re of [/per-entry signatures/i, /every allowed call/i, /amount thresholds/i, /Cedar/, /shadow/i, /verify/i, /per tool/i]) {
      assert.doesNotMatch(s, re, `"${s.trim()}" calls a v0.12.0 feature roadmap`);
    }
  }
  assert.doesNotMatch(t, /gate_denial=/, 'no v0.11 ledger field in the transcript');
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
  assert.match(text(cards[0]), /every decision/i, 'example 1: allowed calls are logged too');
  assert.match(text(cards[1]), /Slack[^.]*roadmap/, 'example 2: alerts stay roadmap');
  assert.match(text(cards[2]), /over \$100/, 'example 3: approval is conditional on the amount');
  assert.match(text(cards[2]), /exact (?:call|arguments)/, 'example 3: approval is bound to the exact arguments');
  assert.match(text(cards[2]), /approval broker[^.]*roadmap|roadmap[^.]*approval broker/, 'example 3: no approval broker yet');
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
