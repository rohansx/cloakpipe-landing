// Generates the home-page hero scene: three isometric layers (agent, gate,
// tools) with two tool calls falling through them, one allowed and one refused,
// plus the ledger stack the refusal lands in. Writes the SVG into
// src/partials/index.html between the gate-scene markers.
//
//   node scripts/gen-gate-scene.mjs
//
// Geometry is computed here so the scene stays a true isometric projection;
// colours and the animation live in CSS (index.html <style>), keyed on the
// class names below.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'src/partials/index.html');

// Isometric projection: plate coordinates (x, y) on the floor, z up.
const X0 = 600;
const Y0 = 392;
const C = Math.cos(Math.PI / 6);
const P = (x, y, z) => [X0 + (x - y) * C, Y0 + (x + y) * 0.5 - z];
const pts = (...ps) => ps.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
const poly = (cls, ...ps) => `<polygon class="${cls}" points="${pts(...ps)}"/>`;

const L = 300; // plate edge
const GAP = 150; // vertical distance between layers
const T = 8; // plate thickness
const Z = { tools: 0, gate: GAP, agent: 2 * GAP };

/** An axis-aligned box: footprint (x, y, w, d), base z, height h. */
function box(cls, x, y, w, d, z, h) {
  const top = poly(`${cls}-top`, P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h));
  const right = poly(`${cls}-r`, P(x + w, y, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x + w, y, z + h));
  const left = poly(`${cls}-l`, P(x, y + d, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x, y + d, z + h));
  return left + right + top;
}

/** A plate: thick slab with an inner grid. */
function plate(layer, z, { grid = 0 } = {}) {
  let s = `<g class="layer layer-${layer}">`;
  s += box('plate', 0, 0, L, L, z - T, T);
  for (let i = 1; i < grid; i++) {
    const v = (L / grid) * i;
    s += `<line class="plate-grid" x1="${P(v, 0, z)[0].toFixed(1)}" y1="${P(v, 0, z)[1].toFixed(1)}" x2="${P(v, L, z)[0].toFixed(1)}" y2="${P(v, L, z)[1].toFixed(1)}"/>`;
    s += `<line class="plate-grid" x1="${P(0, v, z)[0].toFixed(1)}" y1="${P(0, v, z)[1].toFixed(1)}" x2="${P(L, v, z)[0].toFixed(1)}" y2="${P(L, v, z)[1].toFixed(1)}"/>`;
  }
  return s + '</g>';
}

/** A layer name, with a leader line to the plate's left corner. */
function layerLabel(name, sub, z) {
  const [cx, cy] = P(0, L, z);
  const lx = 60;
  return (
    `<g class="scene-label">` +
    `<line class="leader" x1="${lx + 215}" y1="${cy.toFixed(1)}" x2="${(cx - 14).toFixed(1)}" y2="${cy.toFixed(1)}"/>` +
    `<text class="label-name" x="${lx}" y="${(cy - 4).toFixed(1)}">${name}</text>` +
    `<text class="label-sub" x="${lx}" y="${(cy + 16).toFixed(1)}">${sub}</text>` +
    `</g>`
  );
}

const CUBE = 34;
const OK = { x: 70, y: 168 }; // left of centre
const NO = { x: 176, y: 62 }; // right of centre, same depth row
const restZ = Z.agent; // calls start resting on the agent layer

const parts = [];

// Tools layer, with three tools. The allowed call lands next to "email".
parts.push(plate('tools', Z.tools, { grid: 6 }));
parts.push(`<g class="tools">`);
parts.push(`<g class="tool tool-email">${box('tool', OK.x - 3, OK.y + CUBE + 10, 40, 40, 0, 16)}</g>`);
parts.push(`<g class="tool">${box('tool', 190, 150, 40, 40, 0, 16)}</g>`);
parts.push(`<g class="tool">${box('tool', 40, 40, 40, 40, 0, 16)}</g>`);
const toolText = (label, x, y) => {
  const [tx, ty] = P(x, y, 0);
  return `<text class="tool-name" x="${tx.toFixed(1)}" y="${(ty + 22).toFixed(1)}" text-anchor="middle">${label}</text>`;
};
parts.push(toolText('email', OK.x + 17, OK.y + CUBE + 50));
parts.push(toolText('database', 210, 190));
parts.push(toolText('payments', 60, 80));
parts.push(`</g>`);

// Gate layer: the contract grid, the slot the allowed call drops through, and
// the spot that flashes when the refused call hits it.
parts.push(plate('gate', Z.gate, { grid: 10 }));
parts.push(poly('slot', P(OK.x - 6, OK.y - 6, Z.gate + 0.5), P(OK.x + CUBE + 6, OK.y - 6, Z.gate + 0.5), P(OK.x + CUBE + 6, OK.y + CUBE + 6, Z.gate + 0.5), P(OK.x - 6, OK.y + CUBE + 6, Z.gate + 0.5)));
parts.push(poly('gate-hit', P(NO.x - 10, NO.y - 10, Z.gate + 0.5), P(NO.x + CUBE + 10, NO.y - 10, Z.gate + 0.5), P(NO.x + CUBE + 10, NO.y + CUBE + 10, Z.gate + 0.5), P(NO.x - 10, NO.y + CUBE + 10, Z.gate + 0.5)));

// Agent layer.
parts.push(plate('agent', Z.agent));

// Ledger: a stack of receipts to the right of the gate. The top slab is the
// new denial receipt.
const LX = L + 70;
const LY = 40;
parts.push(`<g class="ledger">`);
for (let i = 0; i < 5; i++) parts.push(box('slab', LX, LY, 56, 56, Z.tools + i * 12, 8));
parts.push(`<g class="ledger-new">${box('slab-new', LX, LY, 56, 56, Z.tools + 5 * 12, 8)}</g>`);
{
  const [tx, ty] = P(LX + 56, LY, Z.tools);
  parts.push(`<text class="label-name" x="${(tx + 18).toFixed(1)}" y="${(ty + 30).toFixed(1)}">LEDGER</text>`);
  parts.push(`<text class="label-sub" x="${(tx + 18).toFixed(1)}" y="${(ty + 50).toFixed(1)}">hash-chained, anchored</text>`);
}
parts.push(`</g>`);

// The two calls, drawn last. Each rests on the agent layer; CSS translates
// them down (in user units) to the gate or the tools.
const tag = (cls, x, y, z, lines) => {
  const [tx, ty] = P(x, y, z);
  return `<text class="${cls}" x="${tx.toFixed(1)}" y="${ty.toFixed(1)}">${lines}</text>`;
};
parts.push(
  `<g class="call call-ok">${box('cube-ok', OK.x, OK.y, CUBE, CUBE, restZ, CUBE)}` +
    tag('call-tag', OK.x - 70, OK.y + 60, restZ + CUBE + 14, 'send_email → customer') +
    `</g>`,
);
parts.push(
  `<g class="call call-deny">${box('cube-no', NO.x, NO.y, CUBE, CUBE, restZ, CUBE)}` +
    `<g class="deny-paint">${box('cube-red', NO.x, NO.y, CUBE, CUBE, restZ, CUBE)}</g>` +
    tag('call-tag', NO.x + 30, NO.y - 30, restZ + CUBE + 14, 'send_email → attacker@evil.com') +
    `</g>`,
);
{
  // Off the plate's right corner, with a leader back to where the call stopped.
  const [cx, cy] = P(NO.x + CUBE, NO.y + CUBE / 2, Z.gate);
  const [rx, ry] = P(L, 0, Z.gate);
  parts.push(`<g class="deny-tag"><line class="leader" x1="${(cx + 8).toFixed(1)}" y1="${cy.toFixed(1)}" x2="${(rx + 14).toFixed(1)}" y2="${ry.toFixed(1)}"/>` +
    `<text x="${(rx + 22).toFixed(1)}" y="${(ry + 5).toFixed(1)}">✕ refused · scope_mismatch</text></g>`);
}

// Layer labels, left.
parts.push(layerLabel('AGENT', 'proposes a tool call', Z.agent));
parts.push(layerLabel('CLOAKPIPE GATE', 'checks it against the contract', Z.gate));
parts.push(layerLabel('TOOLS', 'only see allowed calls', Z.tools));

const label =
  'Three layers: the agent on top, the CloakPipe gate in the middle, your tools below. ' +
  'A send_email call to the customer is allowed and drops through the gate to the email tool. ' +
  'A send_email call to attacker@evil.com is refused at the gate and a receipt is added to the ledger.';
const svg =
  `<svg class="scene-svg" viewBox="0 0 1200 760" role="img" aria-label="${label}" preserveAspectRatio="xMidYMid meet">` +
  parts.join('') +
  `</svg>`;

// ---------- Problem figures: small line-art isometrics, one per problem ----------
// Each figure gets its own projection centred in a 320x220 box.
function fig(draw) {
  const fx = 160;
  const fy = 124;
  const Q = (x, y, z) => [fx + (x - y) * C, fy + (x + y) * 0.5 - z];
  const qp = (...ps) => ps.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const qbox = (cls, x, y, w, d, z, h) =>
    `<g class="${cls}">` +
    `<polygon points="${qp(Q(x, y + d, z), Q(x + w, y + d, z), Q(x + w, y + d, z + h), Q(x, y + d, z + h))}"/>` +
    `<polygon points="${qp(Q(x + w, y, z), Q(x + w, y + d, z), Q(x + w, y + d, z + h), Q(x + w, y, z + h))}"/>` +
    `<polygon points="${qp(Q(x, y, z + h), Q(x + w, y, z + h), Q(x + w, y + d, z + h), Q(x, y + d, z + h))}"/>` +
    `</g>`;
  const qline = (cls, a, b) => `<line class="${cls}" x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}"/>`;
  return `<svg class="fig-svg" viewBox="0 0 320 220" aria-hidden="true">${draw({ Q, qp, qbox, qline })}</svg>`;
}

// Tricked: a ticket with a hidden line, its call stopped short of a wall.
const figTricked = fig(({ Q, qp, qbox, qline }) => {
  let s = qbox('f-solid', -40, 40, 90, 120, 0, 4); // the ticket
  for (let i = 0; i < 4; i++) s += qline(i === 2 ? 'f-hidden' : 'f-rule', Q(-30, 56 + i * 24, 4), Q(36, 56 + i * 24, 4));
  s += qline('f-dash', Q(10, 40, 30), Q(70, -60, 34));
  // the wall: a vertical plane across the path
  s += `<polygon class="f-wall" points="${qp(Q(40, -110, 0), Q(130, -110, 0), Q(130, -110, 84), Q(40, -110, 84))}"/>`;
  s += qbox('f-hot', 70, -90, 26, 26, 22, 26); // the call, stopped
  return s;
});

// Over-permissioned: one long-lived token reaching every resource.
const figPerm = fig(({ Q, qbox, qline }) => {
  let s = '';
  const cells = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) cells.push([i * 34 - 40, j * 34 - 40]);
  for (const [x, y] of cells) s += qbox('f-solid', x, y, 22, 22, 0, 14);
  for (const [x, y] of cells) s += qline('f-dash', Q(10, 10, 84), Q(x + 11, y + 11, 14));
  s += qbox('f-hot', -14, -14, 48, 48, 84, 8); // the token
  return s;
});

// Repeats itself: the same invoice, twice.
const figRepeat = fig(({ Q, qbox, qline }) => {
  let s = '';
  s += qbox('f-solid', -50, -20, 90, 110, 0, 6);
  s += qbox('f-solid', -50, -20, 90, 110, 26, 6);
  s += qbox('f-hot', -50, -20, 90, 110, 52, 6);
  for (let i = 0; i < 3; i++) s += qline('f-rule', Q(-38, 0 + i * 24, 58), Q(28, 0 + i * 24, 58));
  s += qline('f-dash', Q(40, 90, 6), Q(40, 90, 52));
  return s;
});

let html = readFileSync(target, 'utf8');
function inject(name, content) {
  const re = new RegExp(`(<!-- ${name}:start -->)[\\s\\S]*?(<!-- ${name}:end -->)`);
  if (!re.test(html)) throw new Error(`${name} markers not found in src/partials/index.html`);
  html = html.replace(re, `$1${content}$2`);
}
inject('gate-scene', svg);
inject('fig-tricked', figTricked);
inject('fig-perm', figPerm);
inject('fig-repeat', figRepeat);
writeFileSync(target, html);
console.log(`gate scene: ${svg.length} bytes; figures: ${figTricked.length + figPerm.length + figRepeat.length} bytes`);
