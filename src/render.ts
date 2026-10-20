import { CFG } from './config';
import { currentLook, drawAsset, drawRow } from './assets';
import type { Light, LightSource, Look, Picture, ZoneLook } from './assets';
import { pixelSprite, sprite } from './emoji';
import type { Game } from './game';
import { ZONES, zoneAt } from './world';
import type { PlatformDef } from './world';

export interface Aim {
  animal: number;
  vx: number;
  vy: number;
  canJump: boolean;
}

/** Gravity per tick in Matter's units (gravity 1 × scale 0.001 × (1000/60)²). */
const GRAVITY_PER_TICK = 0.001 * (1000 / 60) ** 2;
/** Zones blend into the next one over this many metres before it starts. */
const ZONE_BLEND_M = 20;
/** Fireflies are placed per cell of this height (world units = 10 m). */
const FIREFLY_CELL = 10 * CFG.meter;
const OUTLINE = '#181425';

interface LitPoint extends Light {
  x: number;
  y: number;
}

/**
 * Draws the game into a "target": straight onto the screen canvas, or, when the
 * skin asks for pixel art, into a small buffer that is scaled up at the end so
 * everything (art, emojis, rope, light) shares one pixel grid.
 */
export class Renderer {
  private screen: CanvasRenderingContext2D;
  private buffer = document.createElement('canvas');
  private lightMap = document.createElement('canvas');
  private scratch = document.createElement('canvas');
  private dpr = 1;
  private width = 0;
  private height = 0;
  /** Pixels per world unit. */
  scale = 1;
  camY = -100;

  // Set per frame by `begin`.
  private g!: CanvasRenderingContext2D;
  private look!: Look<Picture>;
  private pixel = false;
  /** Target size in its own pixels. */
  private w = 0;
  private h = 0;
  /** Target pixels per world unit. */
  private ppu = 1;
  /** Device pixels per target pixel. */
  private k = 1;
  /** Camera, snapped to whole target pixels in pixel mode. */
  private cam = 0;
  private lights: LitPoint[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.screen = canvas.getContext('2d')!;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize(): void {
    this.dpr = Math.min(devicePixelRatio || 1, 3);
    this.width = innerWidth;
    this.height = innerHeight;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    // Fit the playfield width; on landscape screens keep enough height visible.
    this.scale = Math.min(this.width / CFG.viewWidth, this.height / 520);
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.width / 2) / this.scale, y: (sy - this.height / 2) / this.scale + this.camY };
  }

  /** Smoothly follows the midpoint of both animals, biased so more of the way up is visible. */
  follow(game: Game, snap = false): void {
    const ys = game.animals.map((a) => a.body.position.y);
    const target = Math.min(CFG.waterY + 110 - this.height / 2 / this.scale, (ys[0] + ys[1]) / 2 - 40);
    this.camY = snap ? target : this.camY + (target - this.camY) * 0.08;
  }

  /** `own` marks the local player's animal in online games. */
  draw(game: Game, aims: Aim[], own: number | null = null): void {
    this.begin();
    const g = this.g;
    const halfH = this.height / 2 / this.scale;
    const top = this.camY - halfH - 40;
    const bottom = this.camY + halfH + 40;
    const zone = this.zoneBlend(-this.camY / CFG.meter);

    this.toTarget();
    this.drawSky(zone);
    this.drawBackdrop(zone);

    this.toWorld();
    this.drawWalls(game, top, bottom);
    for (const p of game.platforms) if (p.y > top && p.y < bottom) this.drawPlatform(p, game.checkpoint);

    for (const h of game.hazards) {
      if (h.y < top || h.y > bottom) continue;
      const pos = h.kind === 'bee' ? game.beePosition(h) : h;
      const id = h.kind === 'bee' ? 'hazard.bee' : 'hazard.cactus';
      drawAsset(g, id, this.snap(pos.x), this.snap(pos.y), CFG.tile);
      this.light(id, pos.x, pos.y);
    }

    this.drawWaves(game);
    this.drawRope(game);
    for (const a of game.animals) this.drawAnimal(a);
    this.drawWater(game, bottom);

    const fireflies = this.fireflies(game, top, bottom);
    this.applyLighting(zone.ambient);
    this.toWorld();
    for (const f of fireflies) this.dot(f.x, f.y, 0.5 / this.ppu, f.color);

    if (own !== null) this.drawOwnMarker(game.animals[own].body.position);
    for (const aim of aims) this.drawAim(game, aim);
    this.end();
  }

  private begin(): void {
    this.look = currentLook();
    this.pixel = this.look.pixelsPerTile > 0;
    this.lights = [];
    if (!this.pixel) {
      this.g = this.screen;
      this.w = this.width;
      this.h = this.height;
      this.ppu = this.scale;
      this.k = this.dpr;
      this.cam = this.camY;
      return;
    }
    this.ppu = this.look.pixelsPerTile / CFG.tile;
    // Even sizes keep the world's x = 0 on a pixel boundary.
    const w = 2 * Math.ceil((this.width / this.scale) * this.ppu * 0.5);
    const h = 2 * Math.ceil((this.height / this.scale) * this.ppu * 0.5);
    if (this.buffer.width !== w || this.buffer.height !== h) {
      this.buffer.width = w;
      this.buffer.height = h;
    }
    this.g = this.buffer.getContext('2d')!;
    this.w = w;
    this.h = h;
    this.k = 1;
    // Moving the camera by whole pixels keeps the art from shimmering.
    this.cam = Math.round(this.camY * this.ppu) / this.ppu;
  }

  private end(): void {
    this.g.globalAlpha = 1;
    this.g.globalCompositeOperation = 'source-over';
    if (!this.pixel) return;
    const s = this.screen;
    const f = (this.scale * this.dpr) / this.ppu;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.imageSmoothingEnabled = false;
    s.drawImage(this.buffer, this.canvas.width / 2 - (this.w / 2) * f, this.canvas.height / 2 - (this.h / 2) * f, this.w * f, this.h * f);
  }

  /** Draw in target pixels. */
  private toTarget(): void {
    this.g.setTransform(this.k, 0, 0, this.k, 0, 0);
  }

  /** Draw in world units. */
  private toWorld(): void {
    const s = this.k * this.ppu;
    this.g.setTransform(s, 0, 0, s, (this.k * this.w) / 2, this.k * (this.h / 2 - this.cam * this.ppu));
  }

  /** Rounds a world coordinate to the pixel grid (pixel mode only). */
  private snap(v: number): number {
    return this.pixel ? Math.round(v * this.ppu) / this.ppu : v;
  }

  /** Snaps a tile's centre so its edge, `half` away, lands on the pixel grid. */
  private snapEdge(centre: number, half: number): number {
    return this.snap(centre - half) + half;
  }

  /** Current zone look, blended into the next zone's sky and light near its start. */
  private zoneBlend(meters: number): ZoneLook<Picture> & { next?: ZoneLook<Picture>; t: number } {
    let i = 0;
    while (i + 1 < ZONES.length && meters >= ZONES[i + 1].from) i++;
    const cur = this.look.zones[ZONES[i].id];
    const nextZone = ZONES[i + 1];
    if (!nextZone) return { ...cur, t: 0 };
    const next = this.look.zones[nextZone.id];
    const t = Math.max(0, Math.min(1, (meters - (nextZone.from - ZONE_BLEND_M)) / ZONE_BLEND_M));
    const ambient = cur.ambient || next.ambient ? mix(cur.ambient ?? '#ffffff', next.ambient ?? '#ffffff', t) : undefined;
    return { ...cur, sky: [mix(cur.sky[0], next.sky[0], t), mix(cur.sky[1], next.sky[1], t)], ambient, next, t };
  }

  private drawSky(zone: ZoneLook<Picture>): void {
    const grad = this.g.createLinearGradient(0, 0, 0, this.h);
    grad.addColorStop(0, zone.sky[0]);
    grad.addColorStop(1, zone.sky[1]);
    this.g.fillStyle = grad;
    this.g.fillRect(0, 0, this.w, this.h);
  }

  private drawBackdrop(zone: ZoneLook<Picture> & { next?: ZoneLook<Picture>; t: number }): void {
    const g = this.g;
    this.drawLayers(zone.backdrop, 1 - zone.t);
    if (zone.next && zone.t > 0) this.drawLayers(zone.next.backdrop, zone.t);
    g.globalAlpha = 1;
  }

  /** Layers repeat in both directions; their pixels match the art's pixels. */
  private drawLayers(layers: ZoneLook<Picture>['backdrop'], alpha: number): void {
    const g = this.g;
    const artPerUnit = (this.look.pixelsPerTile || 16) / CFG.tile;
    const s = this.ppu / artPerUnit;
    g.globalAlpha = alpha;
    g.imageSmoothingEnabled = !this.look.pixelated;
    for (const { image, parallax } of layers) {
      const lw = image.w * s;
      const lh = image.h * s;
      const x0 = mod(this.w / 2 - lw / 2, lw) - lw;
      const y0 = mod(-this.cam * this.ppu * parallax, lh) - lh;
      for (let y = y0; y < this.h; y += lh) {
        for (let x = x0; x < this.w; x += lw) g.drawImage(image.src, Math.round(x), Math.round(y), lw, lh);
      }
    }
    g.imageSmoothingEnabled = true;
  }

  private drawWalls(game: Game, top: number, bottom: number): void {
    const x = CFG.worldHalfWidth + CFG.tile / 2;
    const half = CFG.tile / 2;
    for (const w of game.walls) {
      if (w.bottom < top || w.top > bottom) continue;
      const from = w.top + Math.max(0, Math.floor((top - w.top) / CFG.tile)) * CFG.tile;
      for (let y = from; y < Math.min(w.bottom, bottom); y += CFG.tile) {
        const sy = this.snapEdge(y, half);
        drawAsset(this.g, `wall.${w.zone}`, this.snapEdge(-x, half), sy, CFG.tile);
        drawAsset(this.g, `wall.${w.zone}`, this.snapEdge(x, half), sy, CFG.tile, true);
      }
    }
  }

  private drawPlatform(p: PlatformDef, checkpoint: PlatformDef | null): void {
    const id = `platform.${p.mat}` as const;
    const half = (p.tiles * CFG.tile) / 2;
    drawRow(this.g, id, this.snapEdge(p.x, half), this.snapEdge(p.y, CFG.tile / 2), p.tiles, CFG.tile);
    const x0 = p.x - half + CFG.tile / 2;
    for (let i = 0; i < p.tiles; i++) this.light(id, x0 + i * CFG.tile, p.y);
    if (p.checkpoint) {
      const reached = checkpoint !== null && p.y >= checkpoint.y;
      const flag = reached ? 'flag.reached' : 'flag';
      const size = CFG.tile * 1.25;
      drawAsset(this.g, flag, this.snapEdge(p.x, size / 2), this.snapEdge(p.y - CFG.tile * 1.1, size / 2), size);
      this.light(flag, p.x, p.y - CFG.tile * 1.1);
    }
  }

  private drawRope(game: Game): void {
    const pts = [game.animals[0].body.position, ...game.rope.map((s) => s.position), game.animals[1].body.position];
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const stretch = Math.max(0, Math.min(1, (len / CFG.ropeLength - 1) / 0.5));
    const g = this.g;
    const color = mix('#8b5a2b', '#e04a3a', stretch);
    if (this.pixel) {
      // Stamp 2 px squares along the curve: crisp instead of an anti-aliased line.
      const size = 2 / this.ppu;
      g.fillStyle = color;
      for (const p of ropeCurve(pts, 0.5 / this.ppu)) g.fillRect(this.snap(p.x - size / 2), this.snap(p.y - size / 2), size, size);
      return;
    }
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      g.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    g.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = 3.5 - stretch * 1.5;
    g.strokeStyle = color;
    g.stroke();
  }

  private drawAnimal(a: Game['animals'][number]): void {
    const g = this.g;
    const { position, angle } = a.body;
    this.light('animal', position.x, position.y);
    if (a.anchored || a.grip) {
      g.beginPath();
      g.arc(position.x, position.y, CFG.animalSize * 0.48, 0, Math.PI * 2);
      g.fillStyle = a.anchored ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.2)';
      g.fill();
    }
    g.save();
    g.translate(this.snap(position.x), this.snap(position.y));
    g.rotate(angle);
    let s = CFG.animalSize;
    let img: CanvasImageSource = sprite(a.emoji);
    if (this.pixel) {
      const px = Math.round(s * this.ppu);
      img = pixelSprite(a.emoji, px, OUTLINE);
      s *= (px + 2) / px;
      g.imageSmoothingEnabled = false;
    }
    g.drawImage(img, a.spriteOffset.x - s / 2, a.spriteOffset.y - s / 2, s, s);
    g.restore();
  }

  private drawOwnMarker(p: { x: number; y: number }): void {
    const g = this.g;
    const y = p.y - CFG.animalSize * 0.75;
    if (this.pixel) {
      // ▼ out of pixel rows, with a dark outline.
      const u = 1 / this.ppu;
      const x = this.snap(p.x);
      const yy = this.snap(y);
      g.fillStyle = OUTLINE;
      for (let r = 0; r < 5; r++) g.fillRect(x - (5 - r) * u, yy - (5 - r) * u, (2 * (5 - r) + 1) * u, u);
      g.fillStyle = '#fff';
      for (let r = 0; r < 4; r++) g.fillRect(x - (4 - r) * u + u, yy - (5 - r) * u + u, (2 * (4 - r) - 1) * u, u);
      return;
    }
    g.beginPath();
    g.moveTo(p.x - 7, y - 8);
    g.lineTo(p.x + 7, y - 8);
    g.lineTo(p.x, y);
    g.closePath();
    g.fillStyle = '#fff';
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 1.5;
    g.fill();
    g.stroke();
  }

  private drawAim(game: Game, aim: Aim): void {
    const start = game.animals[aim.animal].body.position;
    let { x, y } = start;
    let vx = aim.vx;
    let vy = aim.vy;
    const color = aim.canJump ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)';
    for (let i = 1; i <= 45; i++) {
      x += vx;
      y += vy;
      vy += GRAVITY_PER_TICK;
      if (i % 3 === 0) this.dot(x, y, Math.max(1, 3.2 - i * 0.05), color);
    }
  }

  /** A round dot, or a square one snapped to the grid in pixel mode. */
  private dot(x: number, y: number, r: number, color: string): void {
    const g = this.g;
    g.fillStyle = color;
    if (this.pixel) {
      const size = Math.max(1, Math.round(2 * r * this.ppu)) / this.ppu;
      g.fillRect(this.snap(x - size / 2), this.snap(y - size / 2), size, size);
      return;
    }
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  /** Wave line behind the animals so floating ones stay visible. */
  private drawWaves(game: Game): void {
    const left = -this.w / 2 / this.ppu;
    const off = ((game.tick * 0.4) % CFG.tile) - CFG.tile;
    for (let x = left + off; x < -left + CFG.tile; x += CFG.tile) {
      drawAsset(this.g, 'water.wave', this.snapEdge(x, CFG.tile / 2), this.snapEdge(CFG.waterY + 2, CFG.tile / 2), CFG.tile);
    }
  }

  /** Water body in front, so submerged parts look underwater; in pixel mode it mirrors the scene above. */
  private drawWater(game: Game, bottom: number): void {
    if (CFG.waterY > bottom) return;
    const g = this.g;
    const { color, reflection } = this.look.water;
    if (!this.pixel || !reflection) {
      const left = -this.w / 2 / this.ppu;
      g.fillStyle = color;
      g.fillRect(left, CFG.waterY + 8, this.w / this.ppu, bottom - CFG.waterY);
      return;
    }
    const surface = Math.round(this.h / 2 + (CFG.waterY + 2 - this.cam) * this.ppu);
    if (surface >= this.h) return;
    const rows = this.h - surface;
    if (this.scratch.width !== this.w || this.scratch.height !== this.h) {
      this.scratch.width = this.w;
      this.scratch.height = this.h;
    }
    const sg = this.scratch.getContext('2d')!;
    sg.clearRect(0, 0, this.w, this.h);
    sg.drawImage(this.buffer, 0, 0);
    this.toTarget();
    g.imageSmoothingEnabled = false;
    // Mirror row by row, each shifted a little: a rippling reflection.
    for (let r = 0; r < rows && surface - 1 - r >= 0; r++) {
      const dx = Math.round(Math.sin(game.tick * 0.06 + r * 0.6) * Math.min(2, 0.3 + r * 0.06));
      g.drawImage(this.scratch, 0, surface - 1 - r, this.w, 1, dx, surface + r, this.w, 1);
    }
    g.fillStyle = color;
    g.fillRect(0, surface, this.w, rows);
    g.imageSmoothingEnabled = true;
    this.toWorld();
  }

  private light(source: LightSource, x: number, y: number): void {
    const l = this.look.lights[source];
    if (l) this.lights.push({ x, y, ...l });
  }

  /** Fireflies drift around fixed spots; render-only, so free to use Math.sin. */
  private fireflies(game: Game, top: number, bottom: number): LitPoint[] {
    const out: LitPoint[] = [];
    const light = this.look.lights.firefly ?? { color: '#fee761', radius: 0.8 };
    const t = game.tick;
    for (let c = Math.floor(top / FIREFLY_CELL); c * FIREFLY_CELL < bottom; c++) {
      const n = this.look.zones[zoneAt(-(c + 0.5) * FIREFLY_CELL / CFG.meter).id].fireflies;
      for (let i = 0; i < n; i++) {
        const h1 = hash(c * 97 + i * 13 + 1);
        const h2 = hash(c * 97 + i * 13 + 2);
        const h3 = hash(c * 97 + i * 13 + 3);
        const blink = 0.5 + 0.5 * Math.sin(t * 0.05 + h3 * 40);
        if (blink < 0.15) continue;
        const x = (h1 * 2 - 1) * CFG.worldHalfWidth * 0.95 + Math.sin(t * 0.013 + h3 * 6.3) * 14;
        const y = (c + h2) * FIREFLY_CELL + Math.cos(t * 0.011 + h1 * 6.3) * 10;
        if (y > CFG.waterY - 4) continue;
        const f = { x, y, color: light.color, radius: light.radius * blink };
        out.push(f);
        this.lights.push(f);
      }
    }
    return out;
  }

  /**
   * Darkens the scene to the zone's ambient light, except around lights, and
   * adds a soft glow around each light.
   */
  private applyLighting(ambient: string | undefined): void {
    if (!ambient) return;
    const { w, h } = this;
    if (this.lightMap.width !== w || this.lightMap.height !== h) {
      this.lightMap.width = w;
      this.lightMap.height = h;
    }
    const lg = this.lightMap.getContext('2d')!;
    lg.globalCompositeOperation = 'source-over';
    lg.fillStyle = ambient;
    lg.fillRect(0, 0, w, h);
    lg.globalCompositeOperation = 'lighter';
    const g = this.g;
    this.toTarget();
    const spots = this.lights.map((l) => ({
      x: w / 2 + l.x * this.ppu,
      y: h / 2 + (l.y - this.cam) * this.ppu,
      r: l.radius * CFG.tile * this.ppu,
      color: l.color,
    }));
    const visible = spots.filter((s) => s.r > 0 && s.x + s.r > 0 && s.x - s.r < w && s.y + s.r > 0 && s.y - s.r < h);
    for (const s of visible) radial(lg, s.x, s.y, s.r, s.color);
    g.globalCompositeOperation = 'multiply';
    g.drawImage(this.lightMap, 0, 0, w, h);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.18;
    for (const s of visible) radial(g, s.x, s.y, s.r * 0.6, s.color);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
}

function radial(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(x - r, y - r, 2 * r, 2 * r);
}

/** Points every `step` units along the rope's smoothed curve (same curve as the vector rope). */
function ropeCurve(pts: { x: number; y: number }[], step: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  let from = pts[0];
  const segment = (c: { x: number; y: number }, to: { x: number; y: number }) => {
    const n = Math.max(1, Math.ceil((Math.hypot(c.x - from.x, c.y - from.y) + Math.hypot(to.x - c.x, to.y - c.y)) / step));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const u = 1 - t;
      out.push({ x: u * u * from.x + 2 * u * t * c.x + t * t * to.x, y: u * u * from.y + 2 * u * t * c.y + t * t * to.y });
    }
    from = to;
  };
  for (let i = 1; i < pts.length - 1; i++) segment(pts[i], { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 });
  const last = pts[pts.length - 1];
  segment({ x: (from.x + last.x) / 2, y: (from.y + last.y) / 2 }, last);
  out.push(last);
  return out;
}

function hash(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

function mod(a: number, m: number): number {
  return ((a % m) + m) % m;
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1, 7), 16);
  const pb = parseInt(b.slice(1, 7), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
