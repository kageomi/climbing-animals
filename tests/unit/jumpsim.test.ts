import { describe, expect, it } from 'vitest';
import { CFG } from '../../src/config';
import { findJump, jumpNearHazard, pathHits } from '../../src/jumpsim';
import type { Box } from '../../src/jumpsim';

const TILE = CFG.tile;

/** Platform box centred on x at y, `tiles` wide. */
function platform(x: number, y: number, tiles: number, extra: Partial<Box> = {}): Box {
  const half = (tiles * TILE) / 2;
  const h = TILE * 0.45;
  return { l: x - half, r: x + half, top: y - h, bot: y + h, oneWay: false, bouncy: false, slippery: false, friction: 0.8, ...extra };
}

describe('findJump', () => {
  it('finds a jump to a platform up and to the side', () => {
    const from = platform(-60, 0, 4);
    const to = platform(80, -80, 4);
    const jump = findJump(from, to, [from, to], [], CFG.jumpMaxSpeed);
    expect(jump).not.toBeNull();
    // Lands on the target.
    const path = jump!.path;
    const [x, y] = [path[path.length - 2], path[path.length - 1]];
    expect(x).toBeGreaterThan(to.l);
    expect(x).toBeLessThan(to.r);
    expect(y).toBeLessThan(to.top);
  });

  it('respects the speed limit', () => {
    const from = platform(-60, 0, 4);
    const to = platform(80, -80, 4);
    const jump = findJump(from, to, [from, to], [], CFG.jumpMaxSpeed)!;
    expect(Math.hypot(jump.vx, jump.vy)).toBeLessThanOrEqual(CFG.jumpMaxSpeed + 1e-9);
    expect(findJump(from, to, [from, to], [], 4)).toBeNull();
  });

  it('cannot reach a platform that covers the launch platform from above', () => {
    // No air control: a wider platform right overhead can't be landed on.
    const from = platform(0, 0, 3);
    const to = platform(0, -80, 8);
    expect(findJump(from, to, [from, to], [], CFG.jumpMaxSpeed)).toBeNull();
  });

  it('cannot go beyond the rope', () => {
    const from = platform(-150, 0, 3);
    const to = platform(150, -150, 3);
    expect(findJump(from, to, [from, to], [], CFG.jumpMaxSpeed * 3)).toBeNull();
  });

  it('avoids a cactus on the way', () => {
    const from = platform(-60, 0, 4);
    const to = platform(80, -80, 4);
    const free = findJump(from, to, [from, to], [], CFG.jumpMaxSpeed)!;
    // Put a cactus on the flight path of the jump it found.
    const mid = Math.floor(free.path.length / 4) * 2;
    const cactus = { x0: free.path[mid], x1: free.path[mid], y: free.path[mid + 1] };
    expect(jumpNearHazard(free, from, cactus)).toBe(true);
    const detour = findJump(from, to, [from, to], [cactus], CFG.jumpMaxSpeed);
    if (detour) expect(jumpNearHazard(detour, from, cactus)).toBe(false);
  });

  it('is deterministic', () => {
    const from = platform(-60, 0, 4);
    const to = platform(80, -80, 4);
    expect(findJump(from, to, [from, to], [], 11)).toEqual(findJump(from, to, [from, to], [], 11));
  });
});

describe('pathHits', () => {
  it('detects a box on the path, with the animal size added', () => {
    const box = platform(0, 0, 2);
    expect(pathHits([0, -100, 0, box.top - 5], box)).toBe(true);
    expect(pathHits([0, -200, 100, -200], box)).toBe(false);
  });
});
