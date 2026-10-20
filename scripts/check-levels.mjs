// Level sanity check: generates many worlds and verifies that every step of the
// main path is still jumpable once all branches, cacti and bees are placed.
//   npm run check:levels [-- --seeds 200 --meters 500]
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : def;
};
const SEEDS = arg('seeds', 200);
const METERS = arg('meters', 500);

const dir = mkdtempSync(join(tmpdir(), 'levels-'));
const outfile = join(dir, 'levels.mjs');
await build({
  stdin: {
    contents: `export * from './src/world.ts'; export * from './src/jumpsim.ts'; export { CFG } from './src/config.ts';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'warning',
});
const { WorldGen, MATERIALS, boxOf, sweep, findJump, difficulty, CFG } = await import(pathToFileURL(outfile).href);
rmSync(dir, { recursive: true });

let failures = 0;
let fallbacks = 0;
let steps = 0;
let ms = 0;
const powerByBand = new Map();
for (let seed = 1; seed <= SEEDS; seed++) {
  const t0 = performance.now();
  const gen = new WorldGen(seed);
  const chunk = gen.generateUpTo(-METERS * CFG.meter);
  ms += performance.now() - t0;

  const boxes = new Map(chunk.platforms.map((p) => [p, boxOf(p)]));
  const all = [...boxes.values()];
  const hazards = chunk.hazards.map(sweep);
  for (const s of gen.steps) {
    steps++;
    if (s.fallback) fallbacks++;
    const boost = MATERIALS[s.from.mat].bouncy ? CFG.mushroomBoost : 1;
    const ok = s.jump && findJump(boxes.get(s.from), boxes.get(s.to), all, hazards, CFG.jumpMaxSpeed * boost);
    if (!ok) {
      failures++;
      console.log(`seed ${seed}: step to ${Math.round(-s.to.y / CFG.meter)} m is not jumpable${s.jump ? ' after decorations' : ' (fallback)'}`);
      continue;
    }
    const band = Math.floor(-s.from.y / CFG.meter / 100) * 100;
    const power = Math.hypot(s.jump.vx, s.jump.vy) / (CFG.jumpMaxSpeed * boost);
    const b = powerByBand.get(band) ?? { n: 0, sum: 0, max: 0 };
    powerByBand.set(band, { n: b.n + 1, sum: b.sum + power, max: Math.max(b.max, power) });
  }
}

console.log(`${SEEDS} worlds × ${METERS} m: ${steps} main-path steps, ${failures} not jumpable, ${fallbacks} from the fallback search, ${(ms / SEEDS).toFixed(0)} ms per world`);
console.log('jump power needed (share of max) by height:');
for (const [band, b] of [...powerByBand].sort((a, b) => a[0] - b[0])) {
  console.log(`  ${String(band).padStart(3)}–${band + 100} m  difficulty ${difficulty(band + 50).toFixed(2)}  avg ${(b.sum / b.n).toFixed(2)}  max ${b.max.toFixed(2)}`);
}
process.exit(failures ? 1 : 0);
