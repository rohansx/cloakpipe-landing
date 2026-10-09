#!/usr/bin/env node
// Regenerates every icon and the Open Graph image from the brand mark
// public/brand/cloakpipe-logo.svg (viewBox 0 0 82 60). Run after changing the
// mark and commit the output:
//
//   node scripts/generate-icons.mjs
//
// Writes to public/: favicon.svg, favicon.ico (16/32/48), favicon-16.png,
// favicon-32.png, apple-touch-icon.png, icon-192.png, icon-512.png,
// icon-maskable-512.png, site.webmanifest, og.png.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const source = readFileSync(join(pub, 'brand', 'cloakpipe-logo.svg'), 'utf8');

export const GREEN = '#73F597'; // the mark, dark backgrounds
export const GREEN_DARK = '#178A45'; // same hue for light backgrounds (4.4:1 on white)
export const TILE = '#0B0F0C';
const W = 82;
const H = 60;

const paths = [...source.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
if (paths.length !== 2) throw new Error(`expected 2 paths in the logo, found ${paths.length}`);

/** The mark scaled to `width` px, top-left at (x, y). */
const mark = (x, y, width, fill = GREEN) =>
  `<g transform="translate(${x} ${y}) scale(${width / W})">${paths.map((d) => `<path fill="${fill}" d="${d}"/>`).join('')}</g>`;

/** Square tile with the mark centred at `ratio` of its width. */
function tile(size, { ratio = 0.72, radius = 0.22, bleed = false } = {}) {
  const w = size * ratio;
  const h = (w * H) / W;
  const bg = bleed ? `<rect width="${size}" height="${size}" fill="${TILE}"/>` : `<rect width="${size}" height="${size}" rx="${size * radius}" fill="${TILE}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${bg}${mark((size - w) / 2, (size - h) / 2, w)}</svg>`;
}

const png = (svg) => sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();

/** ICO container holding PNG images (supported by every current browser). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.data)]);
}

// favicon.svg: transparent, square viewBox, colour follows the OS scheme.
const pad = (W - H) / 2;
writeFileSync(
  join(pub, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${-pad} ${W} ${W}">
  <style>path{fill:${GREEN_DARK}}@media (prefers-color-scheme:dark){path{fill:${GREEN}}}</style>
${paths.map((d) => `  <path d="${d}"/>`).join('\n')}
</svg>
`,
);

// Small sizes: a dark tile keeps the mark legible on light and dark tab bars.
const small = {};
for (const size of [16, 32, 48]) small[size] = await png(tile(size, { ratio: 0.84, radius: 0.18 }));
writeFileSync(join(pub, 'favicon-16.png'), small[16]);
writeFileSync(join(pub, 'favicon-32.png'), small[32]);
writeFileSync(join(pub, 'favicon.ico'), ico([16, 32, 48].map((size) => ({ size, data: small[size] }))));

// iOS rounds the corners itself, so the apple icon is a full square.
writeFileSync(join(pub, 'apple-touch-icon.png'), await png(tile(180, { ratio: 0.66, bleed: true })));
writeFileSync(join(pub, 'icon-192.png'), await png(tile(192)));
writeFileSync(join(pub, 'icon-512.png'), await png(tile(512)));
// Maskable: full bleed, mark inside the central safe circle (radius 40%).
writeFileSync(join(pub, 'icon-maskable-512.png'), await png(tile(512, { ratio: 0.58, bleed: true })));

writeFileSync(
  join(pub, 'site.webmanifest'),
  JSON.stringify(
    {
      name: 'CloakPipe',
      short_name: 'CloakPipe',
      description: 'The reliability layer for AI agents.',
      start_url: '/',
      display: 'browser',
      background_color: TILE,
      theme_color: TILE,
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    null,
    2,
  ) + '\n',
);

// Open Graph image, 1200x630.
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="glow" cx="0.22" cy="0.5" r="0.6">
      <stop offset="0" stop-color="${GREEN}" stop-opacity="0.16"/>
      <stop offset="1" stop-color="${GREEN}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="${TILE}"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <rect x="0" y="0" width="1200" height="6" fill="${GREEN}"/>
  ${mark(96, 222, 254)}
  <text x="400" y="300" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="92" font-weight="700" fill="#FFFFFF" letter-spacing="-2">CloakPipe</text>
  <text x="402" y="370" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="38" font-weight="400" fill="#B8C2BB">The reliability layer for AI agents</text>
  <text x="402" y="540" font-family="Menlo, DejaVu Sans Mono, monospace" font-size="24" fill="${GREEN}" letter-spacing="2">CLOAKPIPE.CO</text>
</svg>`;
writeFileSync(join(pub, 'og.png'), await png(og));

console.log('icons written to public/');
