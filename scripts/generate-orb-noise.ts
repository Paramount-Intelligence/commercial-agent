import { deflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';

const SIZE = 256;

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function lattice(x: number, y: number, period: number, seed: number): number {
  const wrappedX = ((x % period) + period) % period;
  const wrappedY = ((y % period) + period) % period;
  let value = Math.imul(wrappedX + seed * 1013, 374761393);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  value ^= Math.imul(wrappedY + seed * 1619, 668265263);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967295;
}

function periodicValueNoise(x: number, y: number, cells: number, seed: number): number {
  const px = x * cells;
  const py = y * cells;
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const fx = px - ix;
  const fy = py - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = lattice(ix, iy, cells, seed) * (1 - sx) + lattice(ix + 1, iy, cells, seed) * sx;
  const bottom = lattice(ix, iy + 1, cells, seed) * (1 - sx) + lattice(ix + 1, iy + 1, cells, seed) * sx;
  return top * (1 - sy) + bottom * sy;
}

// Periodic value-noise octaves repeat exactly at every edge and retain the
// soft, stochastic Perlin character expected by the upstream shader.
function seamlessNoise(x: number, y: number): number {
  const octaves = [
    [2, 0.5, 11],
    [4, 0.27, 23],
    [8, 0.15, 47],
    [16, 0.08, 89],
  ] as const;
  let value = 0;
  let weight = 0;
  for (const [cells, amplitude, seed] of octaves) {
    value += periodicValueNoise(x, y, cells, seed) * amplitude;
    weight += amplitude;
  }
  const midtone = 0.5 + (value / weight - 0.5) * 0.72;
  return Math.max(0, Math.min(255, Math.round(midtone * 255)));
}

const raw = Buffer.alloc((SIZE + 1) * SIZE);
for (let y = 0; y < SIZE; y += 1) {
  const row = y * (SIZE + 1);
  raw[row] = 0;
  for (let x = 0; x < SIZE; x += 1) {
    raw[row + x + 1] = seamlessNoise(x / SIZE, y / SIZE);
  }
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8;
header[9] = 0;
header[10] = 0;
header[11] = 0;
header[12] = 0;

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

async function main() {
  await writeFile('public/orb-noise.png', png);
  console.log(`Generated public/orb-noise.png (${png.length} bytes)`);
}

void main();
