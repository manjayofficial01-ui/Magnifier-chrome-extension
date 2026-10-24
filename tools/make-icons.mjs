/* Generates assets/icons/*.png without any dependencies.
   Paints a magnifier glyph with SDF shapes at 4x supersampling, box-downsamples,
   and hand-encodes PNG (zlib + CRC32). Run: node tools/make-icons.mjs */

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ---------- PNG encoding ---------- */

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let crc = -1;
  for (const b of buf) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ b) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- SDF painting ---------- */

const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

const lerp = (a, b, t) => a + (b - a) * t;
const mix3 = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/* Render one icon at `size` px. */
function renderIcon(size) {
  const S = 4;
  const N = size * S;
  const buf = new Float64Array(N * N * 4);

  // unit-space color stops
  const tileTop = [26, 31, 51];
  const tileBottom = [11, 13, 19];
  const rimA = [248, 250, 255];
  const rimB = [165, 180, 252];
  const handleA = [255, 255, 255];
  const handleB = [196, 181, 253];

  function paint(i, r, g, b, a) {
    // source-over
    const da = buf[i + 3];
    const oa = a + da * (1 - a);
    if (oa <= 0) return;
    buf[i] = (r * a + buf[i] * da * (1 - a)) / oa;
    buf[i + 1] = (g * a + buf[i + 1] * da * (1 - a)) / oa;
    buf[i + 2] = (b * a + buf[i + 2] * da * (1 - a)) / oa;
    buf[i + 3] = oa;
  }

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const fx = (x + 0.5) / N;
      const fy = (y + 0.5) / N;
      const i = (y * N + x) * 4;

      const dTile = sdRoundRect(fx, fy, 0.5, 0.5, 0.5, 0.5, 0.22);
      if (dTile >= 0) continue;

      // tile base: vertical gradient
      const base = mix3(tileTop, tileBottom, clamp01(fy * 1.15));
      paint(i, base[0], base[1], base[2], 1);

      // ambient glows (additive-ish, alpha-scaled)
      const g1 = clamp01(1 - Math.hypot(fx - 0.24, fy - 0.16) / 0.75);
      if (g1 > 0) paint(i, 124, 92, 246, 0.32 * g1 * g1);
      const g2 = clamp01(1 - Math.hypot(fx - 0.85, fy - 0.95) / 0.7);
      if (g2 > 0) paint(i, 34, 211, 238, 0.16 * g2 * g2);

      // glass interior
      const dGlass = sdCircle(fx, fy, 0.44, 0.42, 0.285);
      if (dGlass < 0) {
        const t = clamp01(Math.hypot(fx - 0.36, fy - 0.34) / 0.52);
        const glass = mix3([99, 113, 241], [13, 16, 28], t);
        const alpha = lerp(0.18, 0.94, t);
        paint(i, glass[0], glass[1], glass[2], alpha);
      }

      // rim ring with gradient
      const dRim = Math.abs(sdCircle(fx, fy, 0.44, 0.42, 0.3)) - 0.048;
      if (dRim < 0) {
        const t = clamp01((fx + fy - 0.3) / 1.05);
        const rim = mix3(rimA, rimB, t);
        paint(i, rim[0], rim[1], rim[2], 1);
      }

      // glass highlight arc (top-left)
      const distC = Math.hypot(fx - 0.44, fy - 0.42);
      if (Math.abs(distC - 0.243) < 0.013) {
        const ang = Math.atan2(fy - 0.42, fx - 0.44);
        if (ang >= -2.7 && ang <= -0.9) paint(i, 255, 255, 255, 0.85);
      }

      // handle
      const hw = size < 32 ? 0.062 : 0.052;
      const dHandle = sdSegment(fx, fy, 0.655, 0.635, 0.795, 0.775) - hw;
      if (dHandle < 0) {
        const t = clamp01(((fx - 0.65) + (fy - 0.62)) / 0.35);
        const col = mix3(handleA, handleB, t);
        paint(i, col[0], col[1], col[2], 1);
      }
    }
  }

  // box downsample S x S -> RGBA
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const i = ((y * S + sy) * N + (x * S + sx)) * 4;
          const pa = buf[i + 3];
          r += buf[i] * pa;
          g += buf[i + 1] * pa;
          b += buf[i + 2] * pa;
          a += pa;
        }
      }
      const o = (y * size + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round((a / (S * S)) * 255);
    }
  }
  return encodePNG(size, size, out);
}

const outDir = path.join(__dirname, '..', 'assets', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const png = renderIcon(size);
  fs.writeFileSync(path.join(outDir, 'icon' + size + '.png'), png);
  console.log('icon' + size + '.png  ' + png.length + ' bytes');
}
console.log('done');
