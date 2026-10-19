import { CFG } from './config';
import { Rng } from './rng';

export type MaterialId = 'log' | 'lotus' | 'leaf' | 'mushroom' | 'rock' | 'ice' | 'cloud' | 'star';

export interface Material {
  emoji: string;
  friction: number;
  /** Holding the finger down only anchors on grippable surfaces (ice is too slippery). */
  grippable: boolean;
  /** Can be jumped through from below. */
  oneWay?: boolean;
  /** Launches animals that land on it. */
  bouncy?: boolean;
}

export const MATERIALS: Record<MaterialId, Material> = {
  log: { emoji: '🪵', friction: 0.8, grippable: true },
  lotus: { emoji: '🪷', friction: 0.6, grippable: true },
  leaf: { emoji: '🍃', friction: 0.5, grippable: true },
  mushroom: { emoji: '🍄', friction: 0.6, grippable: false, bouncy: true },
  rock: { emoji: '🪨', friction: 0.9, grippable: true },
  ice: { emoji: '🧊', friction: 0, grippable: false },
  cloud: { emoji: '☁️', friction: 0.5, grippable: true, oneWay: true },
  star: { emoji: '🌟', friction: 0.7, grippable: true },
};

export interface Zone {
  /** Zone starts at this height (m). */
  from: number;
  sky: [string, string];
  wall: string;
  materials: [MaterialId, number][];
  bees: number;
  cacti: number;
}

// Pond → forest → mountain → sky.
export const ZONES: Zone[] = [
  { from: 0, sky: ['#7ec8e3', '#bfe6c9'], wall: '🌾', materials: [['log', 3], ['lotus', 3], ['leaf', 1]], bees: 0, cacti: 0 },
  { from: 60, sky: ['#6fb98f', '#cde8b0'], wall: '🌲', materials: [['log', 3], ['leaf', 2], ['mushroom', 1]], bees: 0.18, cacti: 0 },
  { from: 160, sky: ['#8aa4c8', '#e3e8f0'], wall: '🪨', materials: [['rock', 4], ['ice', 2]], bees: 0.05, cacti: 0.25 },
  { from: 280, sky: ['#1d2b64', '#6a7fd0'], wall: '☁️', materials: [['cloud', 3], ['star', 2]], bees: 0.12, cacti: 0 },
];

export function zoneAt(meters: number): Zone {
  let z = ZONES[0];
  for (const zone of ZONES) if (meters >= zone.from) z = zone;
  return z;
}

export interface PlatformDef {
  /** Centre of the tile row. */
  x: number;
  y: number;
  tiles: number;
  mat: MaterialId;
  checkpoint?: boolean;
}

export interface WallDef {
  /** Vertical span [top, bottom] covered on both sides. */
  top: number;
  bottom: number;
  emoji: string;
}

export interface HazardDef {
  kind: 'bee' | 'cactus';
  x: number;
  y: number;
  /** Bees fly back and forth over this half-width. */
  range: number;
  phase: number;
}

export interface Chunk {
  platforms: PlatformDef[];
  walls: WallDef[];
  hazards: HazardDef[];
}

export const START_PLATFORM: PlatformDef = { x: 0, y: 0, tiles: 8, mat: 'log' };

/** Endless upward world, generated lazily row by row from a seed. */
export class WorldGen {
  private rng: Rng;
  private rowY = 0;
  private lastX = 0;
  private nextCheckpoint: number = CFG.checkpointEvery;

  constructor(seed: number) {
    this.rng = new Rng(seed);
  }

  /** Generates rows until the world reaches `yTop` (a negative y). */
  generateUpTo(yTop: number): Chunk {
    const out: Chunk = { platforms: [], walls: [], hazards: [] };
    if (this.rowY === 0) {
      out.platforms.push(START_PLATFORM);
      out.walls.push({ top: -40, bottom: CFG.waterY + 200, emoji: ZONES[0].wall });
    }
    while (this.rowY > yTop) this.addRow(out);
    return out;
  }

  private addRow(out: Chunk): void {
    const r = this.rng;
    const prevY = this.rowY;
    const y = prevY - r.range(85, 120);
    this.rowY = y;
    const meters = -y / CFG.meter;
    const zone = zoneAt(meters);
    out.walls.push({ top: y - 40, bottom: prevY - 40, emoji: zone.wall });

    if (meters >= this.nextCheckpoint) {
      this.nextCheckpoint += CFG.checkpointEvery;
      const tiles = 6;
      const x = this.placeX(tiles);
      out.platforms.push({ x, y, tiles, mat: zone.materials[0][0], checkpoint: true });
      this.lastX = x;
      return;
    }

    const count = r.chance(0.35) ? 2 : 1;
    const first = this.placePlatform(out, y, zone, this.lastX + r.range(-150, 150));
    this.lastX = first.x;
    if (count === 2 && Math.abs(first.x) > 80) {
      // Second platform on the opposite side for an alternative route.
      this.placePlatform(out, y + r.range(-25, 25), zone, -first.x + r.range(-40, 40));
    }

    if (r.chance(zone.bees)) {
      out.hazards.push({ kind: 'bee', x: r.range(-80, 80), y: y - r.range(45, 60), range: r.range(50, 110), phase: r.range(0, Math.PI * 2) });
    }
  }

  private placePlatform(out: Chunk, y: number, zone: Zone, wantX: number): PlatformDef {
    const r = this.rng;
    const tiles = r.int(2, 5);
    const p: PlatformDef = { x: this.clampX(wantX, tiles), y, tiles, mat: this.pickMaterial(zone) };
    out.platforms.push(p);
    if (tiles >= 3 && r.chance(zone.cacti)) {
      // Cactus on one end of the platform; the other end stays safe.
      const side = r.chance(0.5) ? -1 : 1;
      out.hazards.push({ kind: 'cactus', x: p.x + side * ((tiles - 1) / 2) * CFG.tile, y: y - CFG.tile, range: 0, phase: 0 });
    }
    return p;
  }

  private pickMaterial(zone: Zone): MaterialId {
    const total = zone.materials.reduce((s, [, w]) => s + w, 0);
    let roll = this.rng.range(0, total);
    for (const [id, w] of zone.materials) {
      roll -= w;
      if (roll < 0) return id;
    }
    return zone.materials[0][0];
  }

  private placeX(tiles: number): number {
    return this.clampX(this.lastX + this.rng.range(-100, 100), tiles);
  }

  private clampX(x: number, tiles: number): number {
    const half = (tiles * CFG.tile) / 2;
    const limit = CFG.worldHalfWidth - half - 4;
    return Math.max(-limit, Math.min(limit, x));
  }
}
