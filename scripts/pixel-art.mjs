// Turns the pixel-art sources in art/pixel/ into PNGs for public/skins/pixel/.
//
//   node scripts/pixel-art.mjs           write the PNGs
//   node scripts/pixel-art.mjs --check   fail if a PNG is out of date
//
// Sources: <name>.txt is a grid, one palette character per pixel ('.' = transparent,
// see palette.json); "mirror <other>" flips another grid horizontally. Backdrops are
// generated below from a fixed seed. Any PNG can also be replaced by a hand-drawn one:
// delete its source so it isn't overwritten.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'art/pixel');
const OUT = join(root, 'public/skins/pixel');

/** Returns { file name: PNG buffer } for every source. */
export function renderAll() {
  const palette = JSON.parse(readFileSync(join(SRC, 'palette.json'), 'utf8'));
  const grids = {};
  const load = (name) => {
    if (grids[name]) return grids[name];
    const text = readFileSync(join(SRC, `${name}.txt`), 'utf8').trimEnd();
    const mirror = /^mirror (\S+)$/.exec(text);
    const rows = mirror ? load(mirror[1]).map((r) => [...r].reverse().join('')) : text.split('\n');
    if (rows.some((r) => r.length !== rows[0].length)) throw new Error(`${name}.txt: rows differ in length`);
    return (grids[name] = rows);
  };
  const out = {};
  for (const file of readdirSync(SRC).filter((f) => f.endsWith('.txt'))) {
    const name = file.slice(0, -4);
    out[`${name}.png`] = png(load(name), palette, name);
  }
  for (const [name, make] of Object.entries(BACKDROPS)) out[`${name}.png`] = png(make(), palette, name);
  return out;
}

// --- Backdrops -------------------------------------------------------------
// They repeat vertically, so every shape uses whole periods of the layer height.

const W = 240;
const H = 256;

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const blank = () => Array.from({ length: H }, () => Array(W).fill('.'));

/**
 * Smooth noise in -1..1 that repeats every H rows: `k` random knots, smoothstep
 * in between. Only + − × ÷, so every machine generates the same PNG.
 */
function periodic(r, k) {
  const knots = Array.from({ length: k }, () => r() * 2 - 1);
  return (y) => {
    const f = (y / H) * k;
    const i = Math.floor(f);
    const t = f - i;
    const s = t * t * (3 - 2 * t);
    return knots[i % k] * (1 - s) + knots[(i + 1) % k] * s;
  };
}

/** Foliage banks along both sides: widths vary smoothly, edges are ragged. */
function banks(r, base, amp, body, rim) {
  const g = blank();
  const [l1, l2, r1, r2] = [periodic(r, 4), periodic(r, 11), periodic(r, 5), periodic(r, 9)];
  for (let y = 0; y < H; y++) {
    const wl = Math.round(base + amp * (0.7 * l1(y) + 0.3 * l2(y))) + Math.floor(r() * 3);
    const wr = Math.round(base + amp * (0.7 * r1(y) + 0.3 * r2(y))) + Math.floor(r() * 3);
    for (let x = 0; x < W; x++) {
      const d = Math.max(wl - x, x - (W - 1 - wr));
      if (d >= 1) g[y][x] = body;
      else if (d >= 0) g[y][x] = rim;
    }
  }
  return g;
}

/** Reed stalks with cattail heads poking out of the banks. */
function reeds(g, r, count, stalk, head) {
  for (let i = 0; i < count; i++) {
    const left = r() < 0.5;
    const x0 = left ? Math.floor(r() * 46) : W - 1 - Math.floor(r() * 46);
    const len = 20 + Math.floor(r() * 50);
    const y0 = Math.floor(r() * H);
    const lean = (left ? 1 : -1) * (0.05 + r() * 0.15);
    for (let j = 0; j < len; j++) {
      const y = (((y0 - j) % H) + H) % H;
      const x = Math.round(x0 + lean * j);
      if (x >= 0 && x < W) g[y][x] = stalk;
    }
    if (r() < 0.5) {
      for (let j = 0; j < 5; j++) {
        const y = (((y0 - len - j) % H) + H) % H;
        const x = Math.round(x0 + lean * (len + j));
        for (const dx of [0, 1]) if (x + dx >= 0 && x + dx < W) g[y][x + dx] = head;
      }
    }
  }
}

const BACKDROPS = {
  'pond-stars': () => {
    const r = rng(11);
    const g = blank();
    for (let i = 0; i < 70; i++) g[Math.floor(r() * H)][Math.floor(r() * W)] = r() < 0.15 ? 'f' : r() < 0.5 ? '4' : '3';
    for (let i = 0; i < 4; i++) {
      // A few brighter stars with a small cross.
      const x = 2 + Math.floor(r() * (W - 4));
      const y = 2 + Math.floor(r() * (H - 4));
      g[y][x] = '6';
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) g[y + dy][x + dx] = '4';
    }
    return g.map((row) => row.join(''));
  },
  'pond-far': () => {
    const r = rng(23);
    const g = banks(r, 44, 16, '2', '3');
    reeds(g, r, 50, '2', '2');
    return g.map((row) => row.join(''));
  },
  'pond-near': () => {
    const r = rng(37);
    const g = banks(r, 28, 12, '0', '1');
    reeds(g, r, 40, '0', 'b');
    return g.map((row) => row.join(''));
  },
};

// --- PNG -------------------------------------------------------------------

function png(rows, palette, name) {
  const h = rows.length;
  const w = rows[0].length;
  const raw = Buffer.alloc(h * (1 + 4 * w));
  rows.forEach((row, y) => {
    const o = y * (1 + 4 * w);
    raw[o] = 0; // filter: none
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      const hex = palette[ch];
      if (!hex) throw new Error(`${name}: unknown colour '${ch}' at ${x},${y}`);
      const p = o + 1 + 4 * x;
      raw[p] = parseInt(hex.slice(1, 3), 16);
      raw[p + 1] = parseInt(hex.slice(3, 5), 16);
      raw[p + 2] = parseInt(hex.slice(5, 7), 16);
      raw[p + 3] = 255;
    });
  });
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8 bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// --- CLI -------------------------------------------------------------------

/** Names of PNGs that are missing or differ from their source. */
export function outdated(files = renderAll()) {
  return Object.entries(files)
    .filter(([name, data]) => !existsSync(join(OUT, name)) || !readFileSync(join(OUT, name)).equals(data))
    .map(([name]) => name);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = renderAll();
  if (process.argv.includes('--check')) {
    const stale = outdated(files);
    if (stale.length) {
      console.error(`Out of date (run npm run art): ${stale.join(', ')}`);
      process.exit(1);
    }
    console.log(`${Object.keys(files).length} PNGs up to date`);
  } else {
    for (const [name, data] of Object.entries(files)) writeFileSync(join(OUT, name), data);
    console.log(`Wrote ${Object.keys(files).length} PNGs to public/skins/pixel/`);
  }
}
