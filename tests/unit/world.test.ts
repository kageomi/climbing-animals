import { describe, expect, it } from 'vitest';
import { CFG } from '../../src/config';
import { findJump } from '../../src/jumpsim';
import { boxOf, difficulty, LocalFeed, MATERIALS, START_PLATFORM, sweep, WorldGen } from '../../src/world';
import type { Chunk } from '../../src/world';

const HEIGHT = 200 * CFG.meter;

function generate(seed: number): { gen: WorldGen; chunk: Chunk } {
  const gen = new WorldGen(seed);
  return { gen, chunk: gen.generateUpTo(-HEIGHT) };
}

describe('WorldGen', () => {
  it('builds the same world from the same seed', () => {
    expect(generate(5).chunk).toEqual(generate(5).chunk);
    expect(generate(5).chunk).not.toEqual(generate(6).chunk);
  });

  it('gives the same result in one go or in pieces', () => {
    const whole = generate(9).chunk;
    const gen = new WorldGen(9);
    const parts: Chunk = { platforms: [], walls: [], hazards: [] };
    for (let y = -500; y >= -HEIGHT; y -= 500) {
      const c = gen.generateUpTo(y);
      parts.platforms.push(...c.platforms);
      parts.walls.push(...c.walls);
      parts.hazards.push(...c.hazards);
    }
    expect(parts.platforms.slice(0, whole.platforms.length)).toEqual(whole.platforms);
  });

  it('starts on the start platform and keeps platforms inside the walls', () => {
    const { chunk } = generate(3);
    expect(chunk.platforms[0]).toEqual(START_PLATFORM);
    for (const p of chunk.platforms) {
      const half = (p.tiles * CFG.tile) / 2;
      expect(Math.abs(p.x) + half).toBeLessThanOrEqual(CFG.worldHalfWidth);
    }
  });

  it('places a checkpoint about every 50 m', () => {
    const { chunk } = generate(4);
    const meters = chunk.platforms.filter((p) => p.checkpoint).map((p) => -p.y / CFG.meter);
    expect(meters.length).toBeGreaterThanOrEqual(3);
    meters.forEach((m, i) => expect(m).toBeGreaterThanOrEqual((i + 1) * CFG.checkpointEvery));
  });

  it('keeps every main-path step jumpable once decorations are placed', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { gen, chunk } = generate(seed);
      const boxes = new Map(chunk.platforms.map((p) => [p, boxOf(p)]));
      const all = [...boxes.values()];
      const hazards = chunk.hazards.map(sweep);
      for (const s of gen.steps) {
        const boost = MATERIALS[s.from.mat].bouncy ? CFG.mushroomBoost : 1;
        expect(s.jump, `seed ${seed}: step to ${s.to.y}`).not.toBeNull();
        expect(findJump(boxes.get(s.from)!, boxes.get(s.to)!, all, hazards, CFG.jumpMaxSpeed * boost)).not.toBeNull();
      }
    }
  });

  it('raises difficulty up to 300 m', () => {
    expect(difficulty(0)).toBe(0);
    expect(difficulty(150)).toBeCloseTo(0.5);
    expect(difficulty(300)).toBe(1);
    expect(difficulty(500)).toBe(1);
  });
});

describe('LocalFeed', () => {
  it('delivers chunks right away', () => {
    const feed = new LocalFeed(1);
    const chunks: Chunk[] = [];
    feed.onChunk = (c) => chunks.push(c);
    feed.request(-1000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].platforms.length).toBeGreaterThan(1);
  });
});
