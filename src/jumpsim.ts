import { CFG } from './config';

/**
 * Ballistic jump simulation used by the level generator to guarantee that every
 * step of the main path is climbable. It mirrors Matter's integration for the
 * animals (gravity + air friction per tick) and treats an animal as a box.
 *
 * Only + − × ÷ and Math.sqrt are used, which are exactly specified by IEEE 754,
 * so host and guest generate identical worlds even on different browsers.
 */

/** Half size of the box standing in for an animal: covers the widest emoji bodies, also when tilted. */
export const HALF_W = 21;
export const HALF_H = 20;

const GRAVITY = 0.001 * (1000 / 60) * (1000 / 60);
const AIR = 1 - 0.004;
const MAX_TICKS = 160;
/** Share of the launch speed left once the rope is dragged along (measured in the game: ~0.95). */
const JUMP_EFFICIENCY = 0.93;
/** Lowest resting height of an animal's centre above the surface it stands on. */
const REST_H = 14;
/** The holding partner stands this far behind the jumper (animals are up to ~40 wide). */
const PARTNER_GAP = 40;
/** Body of the standing partner as an obstacle; with the jumper's box this just clears PARTNER_GAP. */
const PARTNER_HALF_W = PARTNER_GAP - HALF_W - 3;
/** How far a jumper may get from its anchored partner before the rope pulls it back. */
const ROPE_REACH = CFG.ropeLength * 1.15;
/** A jump must rise this far above the target's surface: real jumps lose a little height to the rope. */
const LAND_CLEARANCE = 10;
/** Landing on a slippery platform must leave the rope slack. */
const SLACK_REACH = CFG.ropeLength * 0.8;
/** Room left on a slippery platform between the animal and the edge facing its partner. */
const SLIP_MARGIN = 35;

export interface Box {
  l: number;
  r: number;
  top: number;
  bot: number;
  oneWay: boolean;
  bouncy: boolean;
  /** Can't be gripped (ice, mushroom): a taut rope would pull the animal off. */
  slippery: boolean;
  friction: number;
}

/** Circles a jump must stay clear of (cacti) and horizontal sweeps (bee flight paths). */
export interface Hazard {
  x0: number;
  x1: number;
  y: number;
}

export interface Jump {
  x: number;
  vx: number;
  vy: number;
  /** Partner position the jump was checked against. */
  anchorX: number;
  /** Sampled flight path, used to keep later platforms and bees out of the way. */
  path: number[];
}

// Launch directions from integer vectors, normalised with sqrt only (deterministic).
const DIRS: [number, number][] = [];
for (let k = -12; k <= 12; k += 2) DIRS.push(norm(k, -10));
for (const k of [-12, 12]) for (const j of [-6, -3]) DIRS.push(norm(k, j));

function norm(x: number, y: number): [number, number] {
  const l = Math.sqrt(x * x + y * y);
  return [x / l, y / l];
}

// Bees wobble ±6 vertically around their flight line.
const HAZARD_CLEARANCE = CFG.hazardRadius + HALF_W + 6;

/**
 * Finds a jump from `from` that lands safely on `to` using at most `maxSpeed`,
 * while the partner holds on next to the jumper. Softer jumps are tried first,
 * so the result is the most comfortable one found.
 */
export function findJump(
  from: Box,
  to: Box,
  boxes: Box[],
  hazards: Hazard[],
  maxSpeed: number,
): Jump | null {
  const toX = (to.l + to.r) / 2;
  const startY = from.top - REST_H;

  // Cheap rejections before simulating: too high to reach, or beyond the rope.
  const v = maxSpeed * JUMP_EFFICIENCY;
  if (startY - (to.top - HALF_H) > (v * v) / (2 * GRAVITY)) return null;
  const gapX = Math.max(0, to.l - from.r, from.l - to.r);
  const gapY = from.top - to.top;
  if (gapX * gapX + gapY * gapY > ROPE_REACH * ROPE_REACH) return null;

  const near = boxes.filter((b) => b.bot > to.top - 260 && b.top < from.bot + 260);
  const nearHazards = hazards.filter((h) => h.y > to.top - 260 && h.y < from.bot + 260);

  // Launch spots (spots next to a cactus fail the hazard check on the first tick).
  // The partner holds on just behind the jumper (or ahead if there is no room)
  // and is in the way like any obstacle. Both must fit side by side.
  const launches: { x: number; ax: number; boxes: Box[] }[] = [];
  const fits = (ax: number) => ax >= from.l + 6 && ax <= from.r - 6;
  for (let x = from.l + 6; x <= from.r - 6; x += 14) {
    const behind = x - (toX >= x ? 1 : -1) * PARTNER_GAP;
    const ahead = x + (toX >= x ? 1 : -1) * PARTNER_GAP;
    // The partner's spot must fit on the platform and be clear of cacti.
    const ok = (p: number) => fits(p) && !nearHazards.some((h) => nearSweep(p, startY, h));
    const ax = ok(behind) ? behind : ok(ahead) ? ahead : null;
    if (ax === null) continue;
    const partner: Box = { l: ax - PARTNER_HALF_W, r: ax + PARTNER_HALF_W, top: from.top - 36, bot: from.top, oneWay: false, bouncy: false, slippery: false, friction: 1 };
    launches.push({ x, ax, boxes: [...near, partner] });
  }
  // Prefer the edge facing the target.
  const edge = Math.max(from.l, Math.min(from.r, toX));
  launches.sort((a, b) => Math.abs(a.x - edge) - Math.abs(b.x - edge));

  for (let speed = 3; speed <= maxSpeed + 1e-9; speed += 0.75) {
    const v = speed * JUMP_EFFICIENCY;
    for (const [dx, dy] of DIRS) {
      for (const l of launches) {
        // Without air control, jumping away from the target never reaches it.
        if (dx * (toX - l.x) < 0 && Math.abs(dx) > 0.15) continue;
        if (!fly(l.x, startY, dx * v, dy * v, from, to, l.boxes, nearHazards, l.ax, startY, null)) continue;
        // Fly the winner again to record its path (skipped while searching to save allocations).
        const path: number[] = [];
        fly(l.x, startY, dx * v, dy * v, from, to, l.boxes, nearHazards, l.ax, startY, path);
        return { x: l.x, vx: dx * speed, vy: dy * speed, anchorX: l.ax, path };
      }
    }
  }
  return null;
}

function fly(
  x: number,
  y: number,
  vx: number,
  vy: number,
  from: Box,
  to: Box,
  boxes: Box[],
  hazards: Hazard[],
  ax: number,
  ay: number,
  path: number[] | null,
): boolean {
  let highestBottom = y + HALF_H;
  for (let t = 0; t < MAX_TICKS; t++) {
    // Same order as Matter's Body.update: damp, add gravity, move.
    vx = vx * AIR;
    vy = vy * AIR + GRAVITY;
    const prevBottom = y + HALF_H;
    x += vx;
    y += vy;
    highestBottom = Math.min(highestBottom, y + HALF_H);
    if (x < -CFG.worldHalfWidth + HALF_W || x > CFG.worldHalfWidth - HALF_W) return false;
    // Falling past the target's surface: it can only be landed on from above.
    if (vy > 0 && y > to.top) return false;
    const rx = x - ax;
    const ry = y - ay;
    if (rx * rx + ry * ry > ROPE_REACH * ROPE_REACH) return false;
    path?.push(x, y);

    for (const h of hazards) if (nearSweep(x, y, h)) return false;

    for (const b of boxes) {
      if (x < b.l - HALF_W || x > b.r + HALF_W || y < b.top - HALF_H || y > b.bot + HALF_H) continue;
      if (prevBottom <= b.top + 1 && vy > 0) {
        // Landed on top of b: success only on the target, well inside its edges,
        // and only if the arc cleared its surface with room to spare.
        if (b !== to || x < to.l + 10 || x > to.r - 10 || highestBottom > to.top - LAND_CLEARANCE) return false;
        // Mushrooms bounce back (non-grippable): it must settle on the same one.
        if (to.bouncy && vy > 2) {
          y = to.top - HALF_H;
          vy = -vy * CFG.mushroomRestitution;
          break;
        }
        if (to.slippery) {
          // Can't hold on: the rope must stay slack, and its sag slowly drags the
          // animal towards the partner, so keep well away from that edge.
          if (rx * rx + ry * ry > SLACK_REACH * SLACK_REACH) return false;
          // On ice the animal may slide on (by friction × gravity at most, the landing
          // often stops it sooner): both where it lands and where it stops must be safe.
          const stopX = to.friction < 0.1 ? x + (vx * Math.abs(vx)) / (2 * to.friction * GRAVITY) : x;
          for (const px of [x, stopX]) {
            const towardsPartner = ax < x ? px - to.l : to.r - px;
            if (px < to.l + 10 || px > to.r - 10 || towardsPartner < SLIP_MARGIN) return false;
          }
        }
        path?.push(x, y);
        return true;
      }
      if (b === from && vy < 0) continue; // still leaving the launch platform
      if (b.oneWay) continue;
      return false; // hit a side or an underside
    }
  }
  return false;
}

/** True if any sampled point of `path` comes within the box grown by the animal's size. */
export function pathHits(path: number[], b: Box, margin = 0): boolean {
  for (let i = 0; i < path.length; i += 2) {
    const x = path[i];
    const y = path[i + 1];
    if (x > b.l - HALF_W - margin && x < b.r + HALF_W + margin && y > b.top - HALF_H - margin && y < b.bot + HALF_H + margin) return true;
  }
  return false;
}

function nearSweep(x: number, y: number, h: Hazard): boolean {
  const cx = x < h.x0 ? h.x0 : x > h.x1 ? h.x1 : x;
  const dx = x - cx;
  const dy = y - h.y;
  return dx * dx + dy * dy < HAZARD_CLEARANCE * HAZARD_CLEARANCE;
}

/** True if a hazard comes close to the jump's flight path or to where the pair stands before it. */
export function jumpNearHazard(jump: Jump, from: Box, h: Hazard): boolean {
  const standY = from.top - REST_H;
  if (nearSweep(jump.x, standY, h) || nearSweep(jump.anchorX, standY, h)) return true;
  for (let i = 0; i < jump.path.length; i += 2) if (nearSweep(jump.path[i], jump.path[i + 1], h)) return true;
  return false;
}
