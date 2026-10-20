import type { Snapshot } from './game';

/**
 * Guest-side smoothing: snapshots arrive ~30×/s with network jitter, so the
 * guest renders slightly in the past and interpolates between two snapshots.
 */
export class SnapshotBuffer {
  private buf: Snapshot[] = [];
  /** Estimated host tick minus local tick, smoothed. */
  private offset: number | null = null;
  private static readonly DELAY_TICKS = 6;

  push(s: Snapshot, localTick: number): void {
    // A new round restarts the host's tick; start over then.
    if (s.tick < this.latestTick()) this.clear();
    const est = s.tick - localTick;
    this.offset = this.offset === null ? est : this.offset + (est - this.offset) * 0.05;
    this.buf.push(s);
    if (this.buf.length > 60) this.buf.shift();
  }

  sample(localTick: number): Snapshot | null {
    if (!this.buf.length || this.offset === null) return null;
    const t = localTick + this.offset - SnapshotBuffer.DELAY_TICKS;
    while (this.buf.length > 2 && this.buf[1].tick <= t) this.buf.shift();
    const [a, b] = this.buf;
    if (!b || t <= a.tick) return a;
    if (t >= b.tick) return b;
    const k = (t - a.tick) / (b.tick - a.tick);
    const lerp = (x: number, y: number) => x + (y - x) * k;
    return {
      ...b,
      tick: t,
      animals: b.animals.map((bb, i) => ({
        ...bb,
        x: lerp(a.animals[i].x, bb.x),
        y: lerp(a.animals[i].y, bb.y),
        angle: lerpAngle(a.animals[i].angle, bb.angle, k),
      })),
      rope: b.rope.map((v, i) => lerp(a.rope[i], v)),
    };
  }

  clear(): void {
    this.buf = [];
    this.offset = null;
  }

  private latestTick(): number {
    return this.buf.length ? this.buf[this.buf.length - 1].tick : -Infinity;
  }
}

function lerpAngle(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
