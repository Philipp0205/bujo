// Writes the three PNG icons the app-kit manifest script expects. Node built-ins only.
//
//   node scripts/generate-icons.mjs
//
// A black square with an accent bullet (the bullet journal "task" dot). The maskable icon keeps the
// art inside the central 80%, as the kit docs ask.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'icons');

const BG = [0, 0, 0];
const FG = [141, 153, 255]; // the dark accent in public/css/styles.css

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

// radiusRatio: bullet radius as a share of the size. Anti-aliased by 4x4 supersampling.
function png(size, radiusRatio) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const centre = size / 2;
  const radius = size * radiusRatio;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const dx = x + (sx + 0.5) / 4 - centre;
          const dy = y + (sy + 0.5) / 4 - centre;
          if (dx * dx + dy * dy <= radius * radius) hits++;
        }
      }
      const t = hits / 16;
      for (let channel = 0; channel < 3; channel++) {
        raw[y * (size * 3 + 1) + 1 + x * 3 + channel] = Math.round(BG[channel] + (FG[channel] - BG[channel]) * t);
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon-192.png'), png(192, 0.2));
fs.writeFileSync(path.join(outDir, 'icon-512.png'), png(512, 0.2));
fs.writeFileSync(path.join(outDir, 'icon-512-maskable.png'), png(512, 0.16));
console.log('wrote icons to public/icons');
