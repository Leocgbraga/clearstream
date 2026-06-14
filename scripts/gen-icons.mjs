// Generate a single source icon (src/assets/icon.png) — @wxt-dev/auto-icons resizes it to all
// manifest sizes at build time. Zero deps (Node 22+/24 has zlib.crc32). Replace with a real
// logo before shipping (Phase 6). Teal square + white play triangle.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}

function makeIcon(size) {
  const bg = [13, 148, 136]; // teal
  const fg = [255, 255, 255]; // white play triangle
  const x1 = 0.40 * size;
  const x2 = 0.66 * size;
  const cy = 0.50 * size;
  const halfAtBase = 0.18 * size;
  const inTriangle = (x, y) => {
    if (x < x1 || x > x2) return false;
    const halfH = halfAtBase * ((x2 - x) / (x2 - x1));
    return Math.abs(y - cy) <= halfH;
  };

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type 2 = RGB
  const rowLen = size * 3 + 1;
  const raw = Buffer.alloc(rowLen * size);
  for (let y = 0; y < size; y++) {
    raw[y * rowLen] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const o = y * rowLen + 1 + x * 3;
      const c = inTriangle(x + 0.5, y + 0.5) ? fg : bg;
      raw[o] = c[0];
      raw[o + 1] = c[1];
      raw[o + 2] = c[2];
    }
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('src/assets', { recursive: true });
writeFileSync('src/assets/icon.png', makeIcon(512));
console.log('source icon written: src/assets/icon.png (512px) — auto-icons resizes at build');
