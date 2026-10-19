import { CFG } from './config';
import { drawEmoji, GLYPH_FILL, sprite } from './emoji';
import type { Game } from './game';
import { MATERIALS, ZONES } from './world';
import type { PlatformDef } from './world';

export interface Aim {
  animal: number;
  vx: number;
  vy: number;
  canJump: boolean;
}

/** Gravity per tick in Matter's units (gravity 1 × scale 0.001 × (1000/60)²). */
const GRAVITY_PER_TICK = 0.001 * (1000 / 60) ** 2;
const TILE_DRAW = CFG.tile / GLYPH_FILL;

export class Renderer {
  private g: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  /** Pixels per world unit. */
  scale = 1;
  camY = -100;

  constructor(private canvas: HTMLCanvasElement) {
    this.g = canvas.getContext('2d')!;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const dpr = Math.min(devicePixelRatio || 1, 3);
    this.width = innerWidth;
    this.height = innerHeight;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    const g = this.g;
    const halfH = this.height / 2 / this.scale;
    const top = this.camY - halfH - 40;
    const bottom = this.camY + halfH + 40;

    this.drawSky(-this.camY / CFG.meter);

    g.save();
    g.translate(this.width / 2, this.height / 2);
    g.scale(this.scale, this.scale);
    g.translate(0, -this.camY);

    this.drawWalls(game, top, bottom);
    for (const p of game.platforms) if (p.y > top && p.y < bottom) this.drawPlatform(p, game.checkpoint);

    for (const h of game.hazards) {
      if (h.y < top || h.y > bottom) continue;
      const pos = h.kind === 'bee' ? game.beePosition(h) : h;
      drawEmoji(g, h.kind === 'bee' ? '🐝' : '🌵', pos.x, pos.y, TILE_DRAW);
    }

    this.drawWaves(game);
    this.drawRope(game);
    for (const a of game.animals) this.drawAnimal(a);
    if (own !== null) this.drawOwnMarker(game.animals[own].body.position);
    for (const aim of aims) this.drawAim(game, aim);
    this.drawWater(bottom);

    g.restore();
  }

  private drawSky(meters: number): void {
    // Blend into the next zone over the last 20 m before it starts.
    let i = 0;
    while (i + 1 < ZONES.length && meters >= ZONES[i + 1].from) i++;
    let [c0, c1] = ZONES[i].sky;
    const next = ZONES[i + 1];
    if (next) {
      const t = Math.max(0, Math.min(1, (meters - (next.from - 20)) / 20));
      c0 = mix(c0, next.sky[0], t);
      c1 = mix(c1, next.sky[1], t);
    }
    const grad = this.g.createLinearGradient(0, 0, 0, this.height);
    grad.addColorStop(0, c0);
    grad.addColorStop(1, c1);
    this.g.fillStyle = grad;
    this.g.fillRect(0, 0, this.width, this.height);
  }

  private drawWalls(game: Game, top: number, bottom: number): void {
    const x = CFG.worldHalfWidth + CFG.tile / 2;
    for (const w of game.walls) {
      if (w.bottom < top || w.top > bottom) continue;
      const from = w.top + Math.max(0, Math.floor((top - w.top) / CFG.tile)) * CFG.tile;
      for (let y = from; y < Math.min(w.bottom, bottom); y += CFG.tile) {
        drawEmoji(this.g, w.emoji, -x, y, TILE_DRAW);
        drawEmoji(this.g, w.emoji, x, y, TILE_DRAW);
      }
    }
  }

  private drawPlatform(p: PlatformDef, checkpoint: PlatformDef | null): void {
    const emoji = MATERIALS[p.mat].emoji;
    const x0 = p.x - ((p.tiles - 1) / 2) * CFG.tile;
    for (let i = 0; i < p.tiles; i++) drawEmoji(this.g, emoji, x0 + i * CFG.tile, p.y, TILE_DRAW);
    if (p.checkpoint) {
      const reached = checkpoint !== null && p.y >= checkpoint.y;
      drawEmoji(this.g, reached ? '🏁' : '🚩', p.x, p.y - CFG.tile * 1.1, TILE_DRAW * 1.2);
    }
  }

  private drawRope(game: Game): void {
    const pts = [game.animals[0].body.position, ...game.rope.map((s) => s.position), game.animals[1].body.position];
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const stretch = Math.max(0, Math.min(1, (len / CFG.ropeLength - 1) / 0.5));
    const g = this.g;
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
    g.strokeStyle = mix('#8b5a2b', '#e04a3a', stretch);
    g.stroke();
  }

  private drawAnimal(a: Game['animals'][number]): void {
    const g = this.g;
    const { position, angle } = a.body;
    if (a.anchored || a.grip) {
      g.beginPath();
      g.arc(position.x, position.y, CFG.animalSize * 0.48, 0, Math.PI * 2);
      g.fillStyle = a.anchored ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.2)';
      g.fill();
    }
    g.save();
    g.translate(position.x, position.y);
    g.rotate(angle);
    const s = CFG.animalSize;
    g.drawImage(sprite(a.emoji), a.spriteOffset.x - s / 2, a.spriteOffset.y - s / 2, s, s);
    g.restore();
  }

  private drawOwnMarker(p: { x: number; y: number }): void {
    const g = this.g;
    const y = p.y - CFG.animalSize * 0.75;
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
    const g = this.g;
    const start = game.animals[aim.animal].body.position;
    let { x, y } = start;
    let vx = aim.vx;
    let vy = aim.vy;
    g.fillStyle = aim.canJump ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)';
    for (let i = 1; i <= 45; i++) {
      x += vx;
      y += vy;
      vy += GRAVITY_PER_TICK;
      if (i % 3 === 0) {
        g.beginPath();
        g.arc(x, y, Math.max(1, 3.2 - i * 0.05), 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  /** Wave line behind the animals so floating ones stay visible. */
  private drawWaves(game: Game): void {
    const left = -this.width / 2 / this.scale;
    const w = this.width / this.scale;
    const off = ((game.tick * 0.4) % CFG.tile) - CFG.tile;
    for (let x = left + off; x < left + w + CFG.tile; x += CFG.tile) {
      drawEmoji(this.g, '🌊', x, CFG.waterY + 2, TILE_DRAW);
    }
  }

  /** Translucent water body in front, so submerged parts look underwater. */
  private drawWater(bottom: number): void {
    if (CFG.waterY > bottom) return;
    const left = -this.width / 2 / this.scale;
    this.g.fillStyle = 'rgba(40, 120, 200, 0.55)';
    this.g.fillRect(left, CFG.waterY + 8, this.width / this.scale, bottom - CFG.waterY);
  }

}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
