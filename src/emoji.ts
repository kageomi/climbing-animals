import type { Vector } from 'matter-js';

/** Sprite canvas resolution; the emoji glyph fills ~80% of it. */
const SPRITE_PX = 96;
export const GLYPH_FILL = 0.8;

const FONT_STACK = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';
const sprites = new Map<string, HTMLCanvasElement>();

/** Emoji rendered once to an offscreen canvas, reused for drawing and hull extraction. */
export function sprite(emoji: string): HTMLCanvasElement {
  let c = sprites.get(emoji);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = SPRITE_PX;
  const g = c.getContext('2d')!;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `${SPRITE_PX * GLYPH_FILL}px ${FONT_STACK}`;
  g.fillText(emoji, SPRITE_PX / 2, SPRITE_PX / 2 + SPRITE_PX * 0.04);
  sprites.set(emoji, c);
  return c;
}

/** Draws an emoji centred at (x, y) so its sprite spans `size` world units. */
export function drawEmoji(g: CanvasRenderingContext2D, emoji: string, x: number, y: number, size: number): void {
  g.drawImage(sprite(emoji), x - size / 2, y - size / 2, size, size);
}

/**
 * Convex hull of the emoji's opaque pixels, relative to the sprite centre and
 * scaled so the full sprite spans `size` units. This is what makes a 🐍 long and
 * thin and a 🐡 round: the emoji's own silhouette becomes its collision body.
 */
export function emojiHull(emoji: string, size: number, maxVertices = 12): Vector[] {
  const c = sprite(emoji);
  const data = c.getContext('2d')!.getImageData(0, 0, SPRITE_PX, SPRITE_PX).data;
  const pts: Vector[] = [];
  for (let y = 0; y < SPRITE_PX; y++) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < SPRITE_PX; x++) {
      if (data[(y * SPRITE_PX + x) * 4 + 3] > 64) {
        if (left < 0) left = x;
        right = x;
      }
    }
    if (left >= 0) {
      pts.push({ x: left, y }, { x: right + 1, y }, { x: left, y: y + 1 }, { x: right + 1, y: y + 1 });
    }
  }

  const scale = size / SPRITE_PX;
  let hull = convexHull(pts);
  if (hull.length < 3 || polygonArea(hull) < (SPRITE_PX * SPRITE_PX) / 20) {
    // No colour-emoji font available: fall back to a circle.
    const r = (SPRITE_PX * GLYPH_FILL) / 2.4;
    hull = Array.from({ length: maxVertices }, (_, i) => {
      const a = (i / maxVertices) * Math.PI * 2;
      return { x: SPRITE_PX / 2 + Math.cos(a) * r, y: SPRITE_PX / 2 + Math.sin(a) * r };
    });
  }
  hull = simplify(hull, maxVertices);
  return hull.map((p) => ({ x: (p.x - SPRITE_PX / 2) * scale, y: (p.y - SPRITE_PX / 2) * scale }));
}

function cross(o: Vector, a: Vector, b: Vector): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Andrew's monotone chain. */
function convexHull(points: Vector[]): Vector[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const lower: Vector[] = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
    lower.push(pt);
  }
  const upper: Vector[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
    upper.push(pt);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function polygonArea(p: Vector[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    a += p[i].x * p[j].y - p[j].x * p[i].y;
  }
  return Math.abs(a) / 2;
}

/** Repeatedly drops the vertex that contributes the least area. */
function simplify(poly: Vector[], max: number): Vector[] {
  const p = [...poly];
  while (p.length > max) {
    let best = 0;
    let bestArea = Infinity;
    for (let i = 0; i < p.length; i++) {
      const a = Math.abs(cross(p[(i - 1 + p.length) % p.length], p[i], p[(i + 1) % p.length]));
      if (a < bestArea) {
        bestArea = a;
        best = i;
      }
    }
    p.splice(best, 1);
  }
  return p;
}
