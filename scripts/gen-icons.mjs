// Generate the source icon (src/assets/icon.png) — @wxt-dev/auto-icons resizes it to all manifest
// sizes at build time. Zero deps (Node 22+/24 has zlib.crc32). The mark: a teal-gradient rounded
// square with a subtle "clarity" ring and a clean white play triangle — reads at 16px, looks
// designed at 128px. Supersampled 4× for smooth edges. Run: pnpm icons
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const SIZE = 512;
const SS = 4; // supersample factor for antialiasing

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const { hypot } = Math;

const TEAL_TOP = [28, 214, 192];
const TEAL_BOT = [11, 134, 122];
const WHITE = [255, 255, 255];

// Normalized-coordinate color (fx,fy in 0..1) → { rgb, a:0..1 }.
function colorAt(fx, fy) {
  // Rounded-rect mask (SDF): transparent outside the rounded square.
  const rr = 0.235;
  const cx = fx < rr ? rr : fx > 1 - rr ? 1 - rr : fx;
  const cy = fy < rr ? rr : fy > 1 - rr ? 1 - rr : fy;
  const inCorner = (fx < rr || fx > 1 - rr) && (fy < rr || fy > 1 - rr);
  if (inCorner && hypot(fx - cx, fy - cy) > rr) return { rgb: WHITE, a: 0 };

  // Teal gradient + a soft highlight toward the centre for depth.
  let rgb = mix(TEAL_TOP, TEAL_BOT, fy);
  const dc = hypot(fx - 0.5, fy - 0.5);
  rgb = mix(rgb, WHITE, Math.max(0, 0.08 * (1 - dc * 2)));

  // "Clarity" ring.
  if (dc > 0.3 && dc < 0.345) rgb = mix(rgb, WHITE, 0.5);

  // Play triangle (rightward), sitting inside the ring.
  const ax = 0.405,
    ay = 0.32,
    bx = 0.405,
    by = 0.68,
    px = 0.66,
    py = 0.5;
  const d1 = (fx - bx) * (ay - by) - (ax - bx) * (fy - by);
  const d2 = (fx - px) * (by - py) - (bx - px) * (fy - py);
  const d3 = (fx - ax) * (py - ay) - (px - ax) * (fy - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  if (!(hasNeg && hasPos)) rgb = WHITE;

  return { rgb, a: 1 };
}

const N = SIZE * SS;
const rowLen = 1 + SIZE * 4;
const raw = Buffer.alloc(rowLen * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * rowLen] = 0; // PNG filter: none
  for (let x = 0; x < SIZE; x++) {
    let r = 0,
      g = 0,
      b = 0,
      a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const c = colorAt((x * SS + sx + 0.5) / N, (y * SS + sy + 0.5) / N);
        r += c.rgb[0] * c.a;
        g += c.rgb[1] * c.a;
        b += c.rgb[2] * c.a;
        a += c.a;
      }
    }
    const off = y * rowLen + 1 + x * 4;
    // Un-premultiply so partial-alpha edge pixels keep full colour.
    raw[off] = a ? Math.round(r / a) : 0;
    raw[off + 1] = a ? Math.round(g / a) : 0;
    raw[off + 2] = a ? Math.round(b / a) : 0;
    raw[off + 3] = Math.round((a / (SS * SS)) * 255);
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type 6 = RGBA
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync('src/assets', { recursive: true });
writeFileSync('src/assets/icon.png', png);
console.log(`source icon written: src/assets/icon.png (${SIZE}px RGBA) — auto-icons resizes at build`);
