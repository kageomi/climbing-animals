import { CFG } from './config';
import { findJump, HALF_H, HALF_W, jumpNearHazard, pathHits } from './jumpsim';
import type { Box, Hazard, Jump } from './jumpsim';
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
  mushroom: { emoji: '🍄', friction: 0.6, grippable: true, bouncy: true },
  rock: { emoji: '🪨', friction: 0.9, grippable: true },
  // A little friction so a careful landing can stop before the edge.
  ice: { emoji: '🧊', friction: 0.05, grippable: false },
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

/** 0 at the bottom, 1 from 300 m on: drives every difficulty knob below. */
export function difficulty(meters: number): number {
  return Math.max(0, Math.min(1, meters / 300));
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const PLATFORM_H = CFG.tile * 0.9;

export function boxOf(p: PlatformDef): Box {
  const half = (p.tiles * CFG.tile) / 2;
  const mat = MATERIALS[p.mat];
  return {
    l: p.x - half,
    r: p.x + half,
    top: p.y - PLATFORM_H / 2,
    bot: p.y + PLATFORM_H / 2,
    oneWay: !!mat.oneWay,
    bouncy: !!mat.bouncy,
    slippery: !mat.grippable,
    friction: mat.friction,
  };
}

/** Boxes closer than an animal's size would leave no room to pass between them. */
function crowded(a: Box, b: Box): boolean {
  return a.l < b.r + 2 * HALF_W && a.r > b.l - 2 * HALF_W && a.top < b.bot + 2 * HALF_H && a.bot > b.top - 2 * HALF_H;
}

/** One verified step of the main path: `jump` gets an animal from `from` to `to`. */
export interface PathStep {
  from: PlatformDef;
  to: PlatformDef;
  jump: Jump | null;
  /** No random candidate worked; placed by the systematic fallback search. */
  fallback: boolean;
}

/**
 * Endless upward world, generated lazily from a seed.
 *
 * Each step adds a main-path platform and keeps it only if the jump simulator
 * finds a jump onto it (partner holding on, clear of hazards) within the power
 * allowed at that height, and a way on from it (one step of lookahead). Branch
 * platforms, cacti and bees are added only where they keep every recent jump
 * and that way on intact; jumps in their way are rerouted when possible.
 */
export class WorldGen {
  readonly steps: PathStep[] = [];
  private rng: Rng;
  private started = false;
  private main: PlatformDef = START_PLATFORM;
  private boxes: Box[] = [];
  private boxByPlatform = new Map<PlatformDef, Box>();
  private hazards: Hazard[] = [];
  private nextCheckpoint: number = CFG.checkpointEvery;
  /** A verified way on from the end of the main path, kept as a guaranteed fallback. */
  private plan: Box | null = null;

  constructor(seed: number) {
    this.rng = new Rng(seed);
  }

  /** Generates the world until it reaches `yTop` (a negative y). */
  generateUpTo(yTop: number): Chunk {
    const out: Chunk = { platforms: [], walls: [], hazards: [] };
    if (!this.started) {
      this.started = true;
      this.addPlatform(out, START_PLATFORM);
      out.walls.push({ top: -40, bottom: CFG.waterY + 200, emoji: ZONES[0].wall });
    }
    while (this.main.y > yTop) this.addStep(out);
    return out;
  }

  private addStep(out: Chunk): void {
    const r = this.rng;
    const from = this.main;
    const fromBox = this.boxByPlatform.get(from)!;
    const d = difficulty(-from.y / CFG.meter);
    const zone = zoneAt(-from.y / CFG.meter);
    const power = lerp(0.7, 0.92, d);
    const boost = MATERIALS[from.mat].bouncy ? CFG.mushroomBoost : 1;

    let to: PlatformDef | null = null;
    let toBox: Box | undefined;
    let plan: Box | null = null;
    let jump: Jump | null = null;
    let cactus: HazardDef | null = null;
    // Decide what this step should be first and search a placement for it, so
    // special platforms and cacti aren't simply filtered out by the checks.
    const wantMat = this.pickMaterial(zone);
    const wantCactus = r.chance(zone.cacti);
    const ATTEMPTS = 40;
    for (let attempt = 0; attempt < ATTEMPTS && !jump; attempt++) {
      // Later attempts relax towards easier steps so a path is always found.
      const relax = attempt / ATTEMPTS;
      const dy = r.range(lerp(70, 100, d), lerp(95, 150, d)) * (1 - 0.5 * relax);
      const y = from.y - dy;
      const checkpoint = -y / CFG.meter >= this.nextCheckpoint;
      const keepWish = relax < 0.6;
      const withCactus = !checkpoint && (keepWish ? wantCactus : r.chance(zone.cacti));
      // A cactus takes one end, so the pair needs a wider platform to stand side by side.
      const minTiles = withCactus ? 4 : 3;
      const tiles = checkpoint ? 6 : r.int(minTiles + Math.round(2 * relax), Math.max(minTiles, Math.round(lerp(5, 3, d) + 2 * relax)));
      const half = (tiles * CFG.tile) / 2;
      const limit = CFG.worldHalfWidth - half - 4;
      // Anywhere across the width; the simulator decides whether it can be reached.
      const x = r.range(-limit, limit);

      const mat: MaterialId = checkpoint ? zone.materials[0][0] : keepWish ? wantMat : this.pickMaterial(zone);
      const cand: PlatformDef = { x, y, tiles, mat, ...(checkpoint ? { checkpoint: true } : {}) };
      const box = boxOf(cand);
      if (this.boxes.some((b) => crowded(b, box))) continue;
      let candCactus = withCactus ? this.cactusOn(cand) : null;
      let reroutes = this.reroute(box, candCactus ? sweep(candCactus) : undefined);
      if (!reroutes && candCactus) {
        candCactus = null;
        reroutes = this.reroute(box);
      }
      if (!reroutes) continue;
      const hazards = candCactus ? [...this.hazards, sweep(candCactus)] : this.hazards;
      jump = findJump(fromBox, box, [...this.boxes, box], hazards, lerp(power, 1, relax) * CFG.jumpMaxSpeed * boost);
      const next = jump && this.findSuccessor(box, jump, hazards, [], reroutes);
      if (!next) jump = null;
      if (jump) {
        plan = next;
        this.applyReroutes(reroutes);
        to = cand;
        toBox = box;
        cactus = candCactus;
      }
    }
    const fallback = !to;
    if (!to) {
      ({ to, jump, plan } = this.fallbackStep(from, fromBox, boost));
    }

    this.addPlatform(out, to, toBox);
    if (cactus) this.addHazard(out, cactus);
    out.walls.push({ top: to.y - 40, bottom: from.y - 40, emoji: zone.wall });
    this.steps.push({ from, to, jump, fallback });
    this.plan = plan;
    this.main = to;
    if (to.checkpoint) this.nextCheckpoint += CFG.checkpointEvery;

    if (r.chance(lerp(0.5, 0.25, d))) this.addBranch(out, from, to, zone);
    // Bees go in once the platforms around them exist: between the one before
    // `from` and `to`, so they can't block steps that aren't generated yet.
    const before = this.steps[this.steps.length - 2]?.from;
    if (before && r.chance(zone.bees)) this.addBee(out, before, to, d);
  }

  /**
   * Used if no random candidate passed (rare): first the successor planned when
   * `from` was placed, which is known to work, then a systematic search.
   */
  private fallbackStep(from: PlatformDef, fromBox: Box, boost: number): { to: PlatformDef; jump: Jump | null; plan: Box | null } {
    const full = CFG.jumpMaxSpeed * boost;
    const candidates: PlatformDef[] = [];
    if (this.plan) {
      const p = this.plan;
      candidates.push({ x: (p.l + p.r) / 2, y: (p.top + p.bot) / 2, tiles: Math.round((p.r - p.l) / CFG.tile), mat: 'log' });
    }
    // Down to almost level steps, which move sideways out of tight spots. Shuffled
    // per height band so fallback steps don't all look alike.
    for (const dy of [70, 55, 40, 25, 10]) {
      const band: PlatformDef[] = [];
      for (const tiles of [4, 6, 3]) {
        const limit = CFG.worldHalfWidth - (tiles * CFG.tile) / 2 - 4;
        for (let x = -limit; x <= limit; x += 20) band.push({ x, y: from.y - dy, tiles, mat: this.pickMaterial(zoneAt(-from.y / CFG.meter)) });
      }
      for (let i = band.length - 1; i > 0; i--) {
        const j = this.rng.int(0, i);
        [band[i], band[j]] = [band[j], band[i]];
      }
      candidates.push(...band);
    }
    // First pass demands a way on from the new platform; the second settles for any verified step.
    for (const lookahead of [true, false]) {
      for (const cand of candidates) {
        const box = boxOf(cand);
        const reroutes = this.boxes.some((b) => crowded(b, box)) ? null : this.reroute(box);
        if (!reroutes) continue;
        const jump = findJump(fromBox, box, [...this.boxes, box], this.hazards, full);
        if (!jump) continue;
        const plan = this.findSuccessor(box, jump, this.hazards, [], reroutes);
        if (lookahead && !plan) continue;
        this.applyReroutes(reroutes);
        return { to: cand, jump, plan };
      }
    }
    // Unverified last resort; the level check script reports these.
    return { to: { x: -from.x * 0.5, y: from.y - 60, tiles: 5, mat: 'log' }, jump: null, plan: null };
  }

  /** Optional platform off the main path: a shortcut, detour or dead end. */
  private addBranch(out: Chunk, from: PlatformDef, to: PlatformDef, zone: Zone): void {
    const r = this.rng;
    for (let i = 0; i < 8; i++) {
      const tiles = r.int(2, 4);
      const half = (tiles * CFG.tile) / 2;
      const limit = CFG.worldHalfWidth - half - 4;
      const p: PlatformDef = { x: r.range(-limit, limit), y: r.range(to.y - 20, from.y - 40), tiles, mat: this.pickMaterial(zone) };
      const box = boxOf(p);
      const reroutes = this.boxes.some((b) => crowded(b, box)) ? null : this.reroute(box);
      const plan = reroutes && this.mainSuccessor([box], [], reroutes);
      if (!reroutes || plan === null) continue;
      this.applyReroutes(reroutes);
      if (plan) this.plan = plan;
      this.addPlatform(out, p, box);
      if (tiles >= 3 && r.chance(zone.cacti)) this.tryHazard(out, this.cactusOn(p));
      return;
    }
  }

  /** Bee flying back and forth, kept off the jumps made so far. */
  private addBee(out: Chunk, before: PlatformDef, to: PlatformDef, d: number): void {
    const r = this.rng;
    // Anywhere from below `to` down to `before`; standing spots and jumps are
    // protected by the checks in tryHazard.
    for (let i = 0; i < 12; i++) {
      const y = r.range(to.y + 30, before.y - 20);
      const bee: HazardDef = {
        kind: 'bee',
        x: r.range(-150, 150),
        y,
        range: r.range(25, 45) * lerp(1, 1.3, d),
        phase: r.range(0, Math.PI * 2),
      };
      if (this.tryHazard(out, bee)) return;
    }
  }

  /**
   * One step of lookahead: finds a platform that could follow `box` without
   * blocking recent jumps. Prevents painting the path into a corner.
   */
  private findSuccessor(box: Box, jump: Jump, hazards: Hazard[], extra: Box[] = [], reroutes?: Map<PathStep, Jump>): Box | null {
    const boxes = [...this.boxes, ...extra, box];
    const paths = [jump.path];
    for (const s of this.steps.slice(-4)) {
      const j = reroutes?.get(s) ?? s.jump;
      if (j) paths.push(j.path);
    }
    const full = CFG.jumpMaxSpeed * (box.bouncy ? CFG.mushroomBoost : 1);
    const half = (3 * CFG.tile) / 2;
    const limit = CFG.worldHalfWidth - half - 4;
    // Moderate sideways offsets succeed most often; try those first.
    const cx = (box.l + box.r) / 2;
    const xs: number[] = [];
    for (let x = -limit; x <= limit; x += 30) xs.push(x);
    xs.sort((a, b) => Math.abs(Math.abs(a - cx) - 110) - Math.abs(Math.abs(b - cx) - 110));
    for (const dy of [80, 55, 30]) {
      for (const x of xs) {
        const y = (box.top + box.bot) / 2 - dy;
        const next: Box = { l: x - half, r: x + half, top: y - PLATFORM_H / 2, bot: y + PLATFORM_H / 2, oneWay: false, bouncy: false, slippery: false, friction: 1 };
        // Like a real step, the successor must not cut through recent jumps.
        if (boxes.some((b) => crowded(b, next)) || paths.some((p) => pathHits(p, next, 4))) continue;
        if (findJump(box, next, [...boxes, next], hazards, full)) return next;
      }
    }
    return null;
  }

  /**
   * Lookahead for the current end of the main path with extra obstacles added:
   * a new planned successor, null if there would be none, undefined if unchecked.
   */
  private mainSuccessor(boxes: Box[], hazards: Hazard[], reroutes: Map<PathStep, Jump>): Box | null | undefined {
    const last = this.steps[this.steps.length - 1];
    const jump = (last && reroutes.get(last)) ?? last?.jump;
    if (!jump) return undefined;
    return this.findSuccessor(this.boxByPlatform.get(last.to)!, jump, [...this.hazards, ...hazards], boxes, reroutes);
  }

  /**
   * Checks that recent main-path jumps survive a new platform or hazard. A jump
   * whose flight path is in the way gets a new route; null if one can't be found.
   */
  private reroute(box?: Box, hazard?: Hazard): Map<PathStep, Jump> | null {
    const out = new Map<PathStep, Jump>();
    for (const s of this.steps.slice(-4)) {
      if (!s.jump) continue;
      const fromBox = this.boxByPlatform.get(s.from)!;
      const hit = (box && pathHits(s.jump.path, box, 4)) || (hazard && jumpNearHazard(s.jump, fromBox, hazard));
      if (!hit) continue;
      const boxes = box ? [...this.boxes, box] : this.boxes;
      const hazards = hazard ? [...this.hazards, hazard] : this.hazards;
      // A rerouted jump may use full power: rare, and better than a dead end.
      const full = CFG.jumpMaxSpeed * (MATERIALS[s.from.mat].bouncy ? CFG.mushroomBoost : 1);
      const jump = findJump(fromBox, this.boxByPlatform.get(s.to)!, boxes, hazards, full);
      if (!jump) return null;
      out.set(s, jump);
    }
    return out;
  }

  private applyReroutes(reroutes: Map<PathStep, Jump>): void {
    for (const [s, jump] of reroutes) s.jump = jump;
  }

  private addPlatform(out: Chunk, p: PlatformDef, box = boxOf(p)): void {
    out.platforms.push(p);
    this.boxes.push(box);
    this.boxByPlatform.set(p, box);
  }

  private cactusOn(p: PlatformDef): HazardDef {
    // On one end of the platform; the other end stays safe.
    const side = this.rng.chance(0.5) ? -1 : 1;
    return { kind: 'cactus', x: p.x + side * ((p.tiles - 1) / 2) * CFG.tile, y: p.y - CFG.tile, range: 0, phase: 0 };
  }

  /** Adds a hazard unless it would cut off recent jumps or the way on. */
  private tryHazard(out: Chunk, h: HazardDef): boolean {
    const reroutes = this.reroute(undefined, sweep(h));
    const plan = reroutes && this.mainSuccessor([], [sweep(h)], reroutes);
    if (!reroutes || plan === null) return false;
    this.applyReroutes(reroutes);
    if (plan) this.plan = plan;
    this.addHazard(out, h);
    return true;
  }

  private addHazard(out: Chunk, h: HazardDef): void {
    out.hazards.push(h);
    this.hazards.push(sweep(h));
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
}

/** Area a hazard can occupy: a point for cacti, a horizontal line for bees. */
export function sweep(h: HazardDef): Hazard {
  return { x0: h.x - h.range, x1: h.x + h.range, y: h.y };
}

/** Where a game gets its world from. Chunks arrive in request order through `onChunk`. */
export interface WorldFeed {
  onChunk: (chunk: Chunk) => void;
  /** Asks for the world up to `yTop`. */
  request(yTop: number): void;
  dispose(): void;
}

/** Generates on the calling thread and delivers immediately (tests, tools). */
export class LocalFeed implements WorldFeed {
  readonly gen: WorldGen;
  onChunk: (chunk: Chunk) => void = () => {};

  constructor(seed: number) {
    this.gen = new WorldGen(seed);
  }

  request(yTop: number): void {
    this.onChunk(this.gen.generateUpTo(yTop));
  }

  dispose(): void {}
}
