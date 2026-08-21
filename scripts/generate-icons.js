#!/usr/bin/env node
/* ============================================================
   Draws the PWA icon set into public/icons/.

   No image library and no binary blobs in the repo: the icons are painted
   pixel by pixel here and encoded as PNG with Node's own zlib. Re-run after
   changing the brand colours — `npm run icons`.

   Maskable icons get their artwork inside the inner 80% safe zone, because
   Android is free to crop the outer ring into a circle or a squircle.
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.resolve(__dirname, '..', 'public', 'icons');

/* ---------- brand ---------- */
const BRAND_DARK = [0, 59, 112];      // #003B70
const BRAND      = [0, 115, 230];     // #0073E6
const WHITE      = [255, 255, 255];
const CLASP      = [237, 28, 36];     // #ED1C24 — the VietinBank red accent

/* ---------- tiny PNG encoder ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(width, height, rgba) {
  const stride = width * 4;
  // one filter byte (0 = None) in front of every scanline
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- drawing ---------- */
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
/* Coverage of a shape at a pixel, smoothed over one pixel so edges are not
   jagged: `d` is the signed distance, negative inside. */
const cover = (d, feather) => clamp01(0.5 - d / feather);

function roundedRectDist(x, y, cx, cy, halfW, halfH, r) {
  const dx = Math.abs(x - cx) - (halfW - r);
  const dy = Math.abs(y - cy) - (halfH - r);
  const ax = Math.max(dx, 0), ay = Math.max(dy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(dx, dy), 0) - r;
}

function paint(size, maskable) {
  const buf = Buffer.alloc(size * size * 4);
  const feather = Math.max(1, size / 256);
  /* Maskable art must survive an aggressive crop, so shrink it into the safe
     zone; the plain icon can use the full canvas. */
  const artScale = maskable ? 0.62 : 0.78;
  const c = size / 2;
  const bgRadius = maskable ? size : size * 0.22;   // full bleed when maskable

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5, py = y + 0.5;
      let col, alpha;

      /* background: brand gradient on a rounded square (or full bleed) */
      const bgD = maskable ? -1 : roundedRectDist(px, py, c, c, c, c, bgRadius);
      alpha = maskable ? 1 : cover(bgD, feather);
      col = mix(BRAND_DARK, BRAND, clamp01((px + py) / (2 * size)));

      /* the card tucked inside, drawn first so it peeks out behind the wallet */
      const bw = size * artScale * 0.5, bh = size * artScale * 0.36;
      const cardD = roundedRectDist(px, py, c, c - bh * 0.92 + size * 0.02, bw * 0.82, bh * 0.42, size * artScale * 0.07);
      const cardA = cover(cardD, feather);
      if (cardA > 0) col = mix(col, mix(WHITE, BRAND_DARK, 0.35), cardA);

      /* wallet body */
      const bodyD = roundedRectDist(px, py, c, c + size * 0.02, bw, bh, size * artScale * 0.11);
      const bodyA = cover(bodyD, feather);
      if (bodyA > 0) col = mix(col, WHITE, bodyA);

      /* clasp: a coin on the right edge of the body */
      const clx = c + bw * 0.52, cly = c + size * 0.02;
      const claspD = Math.sqrt((px - clx) ** 2 + (py - cly) ** 2) - size * artScale * 0.115;
      const claspA = cover(claspD, feather);
      if (claspA > 0) col = mix(col, CLASP, claspA);
      const holeD = Math.sqrt((px - clx) ** 2 + (py - cly) ** 2) - size * artScale * 0.045;
      const holeA = cover(holeD, feather);
      if (holeA > 0) col = mix(col, WHITE, holeA);

      const o = (y * size + x) * 4;
      buf[o] = col[0]; buf[o + 1] = col[1]; buf[o + 2] = col[2];
      buf[o + 3] = Math.round(alpha * 255);
    }
  }
  return encodePNG(size, size, buf);
}

fs.mkdirSync(OUT, { recursive: true });
const files = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-192.png', 192, true],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true]   // iOS crops to its own rounded square
];
for (const [name, size, maskable] of files) {
  const png = paint(size, maskable);
  fs.writeFileSync(path.join(OUT, name), png);
  console.log(`✓ icons/${name}  ${size}×${size}  ${(png.length / 1024).toFixed(1)} KB`);
}
