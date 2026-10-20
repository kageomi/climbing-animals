import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../../src/game';
import { SnapshotBuffer } from '../../src/snapshots';

function snap(tick: number, x: number, over = false): Snapshot {
  return { tick, over, height: 0, cp: -1, animals: [{ x, y: 0, angle: 0, flags: 0 }], rope: [x, 0] };
}

describe('SnapshotBuffer', () => {
  it('is empty until the first snapshot', () => {
    expect(new SnapshotBuffer().sample(0)).toBeNull();
  });

  it('renders a few ticks in the past and interpolates', () => {
    const buf = new SnapshotBuffer();
    // Host tick = local tick (offset 0); render delay is 6 ticks.
    buf.push(snap(100, 0), 100);
    buf.push(snap(102, 20), 102);
    buf.push(snap(104, 40), 104);
    const s = buf.sample(107)!; // renders tick 101: halfway between 100 and 102
    expect(s.tick).toBeCloseTo(101);
    expect(s.animals[0].x).toBeCloseTo(10);
    expect(s.rope[0]).toBeCloseTo(10);
  });

  it('holds the latest snapshot instead of extrapolating', () => {
    const buf = new SnapshotBuffer();
    buf.push(snap(100, 0), 100);
    buf.push(snap(102, 20), 102);
    expect(buf.sample(200)!.animals[0].x).toBe(20);
  });

  it('starts over when the host tick goes backwards (new round)', () => {
    const buf = new SnapshotBuffer();
    buf.push(snap(500, 99), 100);
    buf.push(snap(0, 1), 101);
    expect(buf.sample(500)!.animals[0].x).toBe(1);
  });
});
