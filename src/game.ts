import Matter, { Bodies, Body, Composite, Constraint, Engine, Events, Vertices } from 'matter-js';
import type { IEventCollision, Pair, Vector } from 'matter-js';
import { CFG, TICK_MS } from './config';
import { emojiHull } from './emoji';
import { MATERIALS, WorldGen } from './world';
import type { HazardDef, Material, PlatformDef, WallDef } from './world';

/** Animals' resting height on the start platform; height is measured from here. */
const START_Y = -30;

const CAT_PLATFORM = 0x1;
const CAT_ANIMAL = 0x2;
const CAT_ROPE = 0x4;
const CAT_CLOUD = 0x8;

/**
 * Everything that changes the simulation goes through a Command. In solo mode
 * the local input produces them directly; online the host will receive the
 * guest's commands over the network and apply them the same way.
 */
export type Command =
  | { type: 'grip'; animal: number; on: boolean }
  | { type: 'jump'; animal: number; vx: number; vy: number };

export interface Snapshot {
  tick: number;
  over: boolean;
  height: number;
  /** Index of the checkpoint platform in `platforms`, or -1. */
  cp: number;
  /** flags: 1 anchored, 2 grip, 4 in water, 8 touching ground. */
  animals: { x: number; y: number; angle: number; flags: number }[];
  /** Rope segment positions as [x0, y0, x1, y1, …]. */
  rope: number[];
}

export interface Animal {
  body: Body;
  emoji: string;
  /** Sprite centre in body-local coordinates (the body is centred on its hull centroid). */
  spriteOffset: Vector;
  /** Finger is down for this animal. */
  grip: boolean;
  /** Pinned to a surface (body is static) because grip is held while touching. */
  anchored: boolean;
  contacts: number;
  gripContacts: number;
  /** Centre is below the surface: buoyancy applies and jumping is impossible. */
  inWater: boolean;
  /** Any part touches the visible water; this ends the round. */
  touchingWater: boolean;
  pendingBounce: boolean;
  /** Lowest point at the end of the previous tick (for one-way platforms). */
  lastBottom: number;
}

interface PlatformBody {
  kind: 'platform';
  def: PlatformDef;
  mat: Material;
}

type BodyTag = PlatformBody | { kind: 'wall' } | { kind: 'animal'; index: number } | { kind: 'rope' };

function tag(body: Body): BodyTag | undefined {
  return (body.plugin as { tag?: BodyTag }).tag;
}

// Matter only fires collisionStart *before* solving, so one-way platforms need a
// hook right after pairs are updated each step. Installed once, routed to the
// active game.
let pairFilter: ((pair: Pair) => void) | null = null;
type PairsUpdate = (pairs: { list: Pair[] }, ...rest: unknown[]) => void;
const MatterPairs = (Matter as unknown as { Pairs: { update: PairsUpdate } }).Pairs;
const originalPairsUpdate = MatterPairs.update;
MatterPairs.update = function (pairs: { list: Pair[] }, ...rest: unknown[]) {
  originalPairsUpdate.call(this, pairs, ...rest);
  if (pairFilter) for (const p of pairs.list) if (p.isActive) pairFilter(p);
};

export class Game {
  readonly engine: Engine;
  readonly animals: Animal[];
  readonly rope: Body[] = [];
  readonly platforms: PlatformDef[] = [];
  readonly walls: WallDef[] = [];
  readonly hazards: HazardDef[] = [];

  state: 'play' | 'over' = 'play';
  tick = 0;
  /** Highest point reached this run, in metres. */
  maxHeight = 0;
  checkpoint: PlatformDef | null = null;

  private gen: WorldGen;
  private generatedTo = 0;
  private drownTimer = 0;

  constructor(emojis: [string, string], seed: number) {
    this.engine = Engine.create({ positionIterations: 8, velocityIterations: 6, constraintIterations: 4 });
    this.gen = new WorldGen(seed);
    this.streamWorld(-1500);

    this.animals = emojis.map((emoji, index) => this.createAnimal(emoji, index, (index === 0 ? -40 : 40), -40));
    this.createRope();

    Events.on(this.engine, 'collisionStart', (e: IEventCollision<Engine>) => this.onCollisions(e, true));
    Events.on(this.engine, 'collisionActive', (e: IEventCollision<Engine>) => this.onCollisions(e, false));
    pairFilter = (pair) => this.filterPair(pair);
  }

  apply(cmd: Command): void {
    const a = this.animals[cmd.animal];
    if (!a || this.state !== 'play') return;
    if (cmd.type === 'grip') {
      a.grip = cmd.on;
      if (!cmd.on) this.release(a);
      return;
    }
    if (!this.canJump(a)) return;
    this.release(a);
    const speed = Math.hypot(cmd.vx, cmd.vy);
    const k = speed > CFG.jumpMaxSpeed ? CFG.jumpMaxSpeed / speed : 1;
    Body.setVelocity(a.body, { x: cmd.vx * k, y: cmd.vy * k });
    Body.setAngularVelocity(a.body, 0);
  }

  canJump(a: Animal): boolean {
    return !a.inWater && (a.anchored || a.contacts > 0);
  }

  /** Advances the simulation by one fixed tick. */
  step(): void {
    if (this.state !== 'play') return;
    for (const a of this.animals) {
      a.contacts = 0;
      a.gripContacts = 0;
      a.pendingBounce = false;
    }

    Engine.update(this.engine, TICK_MS);
    this.tick++;

    for (const a of this.animals) {
      if (a.pendingBounce && !a.anchored) Body.setVelocity(a.body, { x: a.body.velocity.x, y: -CFG.mushroomBounce });
      if (a.grip && !a.anchored && a.gripContacts > 0 && !a.inWater) {
        a.anchored = true;
        Body.setStatic(a.body, true);
      }
      this.applyWater(a);
    }
    this.applyHazards();
    for (const a of this.animals) a.lastBottom = a.body.bounds.max.y;

    const top = Math.min(...this.animals.map((a) => a.body.position.y));
    this.maxHeight = Math.max(this.maxHeight, Math.floor((START_Y - top) / CFG.meter));
    this.streamWorld(top - 1500);

    // Either animal touching the water ends the round. Bobbing at the surface briefly
    // lifts animals out, so the timer decays instead of resetting.
    if (this.animals.some((a) => a.touchingWater)) {
      if (++this.drownTimer >= CFG.drownTicks) this.state = 'over';
    } else {
      this.drownTimer = Math.max(0, this.drownTimer - 1);
    }
  }

  /** Puts both animals back on the last checkpoint (or the start). */
  respawn(): void {
    const cp = this.checkpoint ?? { x: 0, y: 0 };
    const y = cp.y - CFG.tile / 2 - 24;
    const xs = [cp.x - 30, cp.x + 30];
    this.animals.forEach((a, i) => {
      this.release(a);
      a.grip = false;
      a.inWater = false;
      a.touchingWater = false;
      Body.setPosition(a.body, { x: xs[i], y });
      Body.setVelocity(a.body, { x: 0, y: 0 });
      Body.setAngle(a.body, 0);
      Body.setAngularVelocity(a.body, 0);
      a.lastBottom = a.body.bounds.max.y;
    });
    this.rope.forEach((seg, i) => {
      const t = (i + 1) / (this.rope.length + 1);
      Body.setPosition(seg, { x: xs[0] + (xs[1] - xs[0]) * t, y: y - 10 });
      Body.setVelocity(seg, { x: 0, y: 0 });
    });
    this.drownTimer = 0;
    this.state = 'play';
  }

  /** Compact state the host sends to the guest (positions rounded to 0.1). */
  snapshot(): Snapshot {
    const r = (v: number) => Math.round(v * 10) / 10;
    return {
      tick: this.tick,
      over: this.state === 'over',
      height: this.maxHeight,
      cp: this.checkpoint ? this.platforms.indexOf(this.checkpoint) : -1,
      animals: this.animals.map((a) => ({
        x: r(a.body.position.x),
        y: r(a.body.position.y),
        angle: Math.round(a.body.angle * 1000) / 1000,
        flags: (a.anchored ? 1 : 0) | (a.grip ? 2 : 0) | (a.inWater ? 4 : 0) | (a.contacts > 0 ? 8 : 0),
      })),
      rope: this.rope.flatMap((s) => [r(s.position.x), r(s.position.y)]),
    };
  }

  /**
   * Guest side: mirrors the host's state without simulating. The world is
   * regenerated locally from the shared seed, so only moving parts are synced.
   */
  applySnapshot(s: Snapshot): void {
    this.tick = s.tick;
    this.state = s.over ? 'over' : 'play';
    this.maxHeight = s.height;
    s.animals.forEach((sa, i) => {
      const a = this.animals[i];
      Body.setPosition(a.body, { x: sa.x, y: sa.y });
      Body.setAngle(a.body, sa.angle);
      a.anchored = (sa.flags & 1) !== 0;
      a.grip = (sa.flags & 2) !== 0;
      a.inWater = (sa.flags & 4) !== 0;
      a.contacts = (sa.flags & 8) !== 0 ? 1 : 0;
    });
    this.rope.forEach((seg, i) => Body.setPosition(seg, { x: s.rope[i * 2], y: s.rope[i * 2 + 1] }));
    const top = Math.min(...s.animals.map((a) => a.y));
    this.streamWorld(top - 1500);
    while (s.cp >= this.platforms.length) this.streamWorld(this.generatedTo - 500);
    this.checkpoint = s.cp >= 0 ? this.platforms[s.cp] : null;
  }

  beePosition(h: HazardDef): Vector {
    return { x: h.x + Math.sin(this.tick * 0.025 + h.phase) * h.range, y: h.y + Math.sin(this.tick * 0.07 + h.phase) * 6 };
  }

  destroy(): void {
    pairFilter = null;
    Composite.clear(this.engine.world, false, true);
    Engine.clear(this.engine);
  }

  private release(a: Animal): void {
    if (!a.anchored) return;
    a.anchored = false;
    Body.setStatic(a.body, false);
  }

  private createAnimal(emoji: string, index: number, x: number, y: number): Animal {
    const hull = emojiHull(emoji, CFG.animalSize);
    const centre = Vertices.centre(hull);
    const body = Bodies.fromVertices(x, y, [hull], {
      density: CFG.animalDensity,
      friction: 0.8,
      frictionStatic: 1,
      frictionAir: 0.004,
      restitution: 0.05,
      collisionFilter: { category: CAT_ANIMAL, mask: CAT_PLATFORM | CAT_CLOUD | CAT_ANIMAL },
      plugin: { tag: { kind: 'animal', index } satisfies BodyTag },
    });
    Composite.add(this.engine.world, body);
    return {
      body,
      emoji,
      spriteOffset: { x: -centre.x, y: -centre.y },
      grip: false,
      anchored: false,
      contacts: 0,
      gripContacts: 0,
      inWater: false,
      touchingWater: false,
      pendingBounce: false,
      lastBottom: body.bounds.max.y,
    };
  }

  private createRope(): void {
    const [a, b] = this.animals.map((an) => an.body);
    const n = CFG.ropeSegments;
    const link = CFG.ropeLength / (n + 1);
    let prev = a;
    for (let i = 0; i < n; i++) {
      const t = (i + 1) / (n + 1);
      const seg = Bodies.circle(a.position.x + (b.position.x - a.position.x) * t, a.position.y - 10, 3, {
        density: 0.0008,
        friction: 0.2,
        frictionAir: 0.02,
        collisionFilter: { category: CAT_ROPE, mask: CAT_PLATFORM },
        plugin: { tag: { kind: 'rope' } satisfies BodyTag },
      });
      this.rope.push(seg);
      Composite.add(this.engine.world, [seg, this.link(prev, seg, link)]);
      prev = seg;
    }
    Composite.add(this.engine.world, this.link(prev, b, link));
  }

  private link(bodyA: Body, bodyB: Body, length: number): Constraint {
    return Constraint.create({ bodyA, bodyB, length, stiffness: CFG.ropeStiffness, damping: CFG.ropeDamping });
  }

  private streamWorld(yTop: number): void {
    if (yTop >= this.generatedTo) return;
    this.generatedTo = yTop;
    const chunk = this.gen.generateUpTo(yTop);
    for (const p of chunk.platforms) this.addPlatform(p);
    for (const w of chunk.walls) this.addWalls(w);
    this.hazards.push(...chunk.hazards);
  }

  private addPlatform(def: PlatformDef): void {
    const mat = MATERIALS[def.mat];
    const body = Bodies.rectangle(def.x, def.y, def.tiles * CFG.tile, CFG.tile * 0.9, {
      isStatic: true,
      friction: mat.friction,
      frictionStatic: mat.friction === 0 ? 0 : 1,
      collisionFilter: mat.oneWay ? { category: CAT_CLOUD, mask: CAT_ANIMAL } : { category: CAT_PLATFORM, mask: CAT_ANIMAL | CAT_ROPE },
      plugin: { tag: { kind: 'platform', def, mat } satisfies BodyTag },
    });
    Composite.add(this.engine.world, body);
    this.platforms.push(def);
  }

  private addWalls(w: WallDef): void {
    const h = w.bottom - w.top;
    for (const side of [-1, 1]) {
      Composite.add(
        this.engine.world,
        Bodies.rectangle(side * (CFG.worldHalfWidth + CFG.tile / 2), w.top + h / 2, CFG.tile, h, {
          isStatic: true,
          friction: 0,
          frictionStatic: 0,
          collisionFilter: { category: CAT_PLATFORM, mask: CAT_ANIMAL | CAT_ROPE },
          plugin: { tag: { kind: 'wall' } satisfies BodyTag },
        }),
      );
    }
    this.walls.push(w);
  }

  /** Lets animals pass through one-way (cloud) platforms from below. */
  private filterPair(pair: Pair): void {
    const ta = tag(pair.bodyA);
    const tb = tag(pair.bodyB);
    const platformBody = ta?.kind === 'platform' ? pair.bodyA : tb?.kind === 'platform' ? pair.bodyB : null;
    if (!platformBody) return;
    const pt = tag(platformBody) as PlatformBody;
    if (!pt.mat.oneWay) return;
    const other = tag(platformBody === pair.bodyA ? pair.bodyB : pair.bodyA);
    if (other?.kind !== 'animal') return;
    const a = this.animals[other.index];
    // Solid only if the animal was above the surface at the end of the last tick.
    if (a.body.velocity.y < -0.5 || a.lastBottom > platformBody.bounds.min.y + 6) pair.isActive = false;
  }

  private onCollisions(e: IEventCollision<Engine>, started: boolean): void {
    for (const pair of e.pairs) {
      if (!pair.isActive || pair.isSensor) continue;
      const ta = tag(pair.bodyA);
      const tb = tag(pair.bodyB);
      const [animalTag, platformBody] =
        ta?.kind === 'animal' && tb?.kind === 'platform'
          ? [ta, pair.bodyB]
          : tb?.kind === 'animal' && ta?.kind === 'platform'
            ? [tb, pair.bodyA]
            : [null, null];
      if (!animalTag || !platformBody) continue;
      const a = this.animals[animalTag.index];
      const { def, mat } = tag(platformBody) as PlatformBody;
      a.contacts++;
      if (mat.grippable) a.gripContacts++;
      if (started && mat.bouncy && a.body.position.y < platformBody.position.y - CFG.tile / 2) a.pendingBounce = true;
      if (def.checkpoint && this.checkpoint !== def && (!this.checkpoint || def.y < this.checkpoint.y)) this.checkpoint = def;
    }
  }

  private applyWater(a: Animal): void {
    a.inWater = a.body.position.y > CFG.waterY;
    a.touchingWater = a.body.bounds.max.y > CFG.waterSurfaceY;
    if (!a.inWater || a.anchored) return;
    const v = a.body.velocity;
    // Buoyancy slightly stronger than gravity plus heavy damping: animals bob at the surface.
    Body.setVelocity(a.body, { x: v.x * 0.9, y: v.y * 0.9 - 0.45 });
  }

  private applyHazards(): void {
    for (const h of this.hazards) {
      const pos = h.kind === 'bee' ? this.beePosition(h) : { x: h.x, y: h.y };
      for (const a of this.animals) {
        const dx = a.body.position.x - pos.x;
        const dy = a.body.position.y - pos.y;
        const d = Math.hypot(dx, dy);
        if (d > CFG.hazardRadius || d === 0) continue;
        this.release(a);
        Body.setVelocity(a.body, { x: (dx / d) * CFG.hazardKnock, y: (dy / d) * CFG.hazardKnock - 3 });
      }
    }
  }
}
