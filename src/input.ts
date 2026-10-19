import { CFG } from './config';
import type { Command, Game } from './game';
import type { Aim, Renderer } from './render';

interface Touch {
  animal: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
}

/**
 * Slingshot controls. Holding a finger down grips; dragging aims (opposite to
 * the drag, like a slingshot); releasing jumps. In solo mode each finger takes
 * the animal nearest to where it touched, so two fingers can steer both.
 * Online, every touch steers the player's own animal.
 */
export class SlingshotInput {
  /** Animal this device controls, or null to control both (solo). */
  own: number | null = null;
  private touches = new Map<number, Touch>();

  constructor(
    private el: HTMLElement,
    private renderer: Renderer,
    private getGame: () => Game | null,
    private send: (cmd: Command) => void,
  ) {
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e, true));
    el.addEventListener('pointercancel', (e) => this.up(e, false));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Current aim previews for the renderer. */
  aims(): Aim[] {
    const game = this.getGame();
    if (!game) return [];
    const out: Aim[] = [];
    for (const t of this.touches.values()) {
      const v = this.velocity(t);
      if (!v) continue;
      const a = game.animals[t.animal];
      const boost = game.jumpBoost(a);
      out.push({ animal: t.animal, vx: v.x * boost, vy: v.y * boost, canJump: game.canJump(a) });
    }
    return out;
  }

  reset(): void {
    this.touches.clear();
  }

  private down(e: PointerEvent): void {
    const game = this.getGame();
    if (!game || game.state !== 'play') return;
    e.preventDefault();
    this.el.setPointerCapture(e.pointerId);
    const taken = new Set([...this.touches.values()].map((t) => t.animal));
    const free = game.animals.map((_, i) => i).filter((i) => !taken.has(i) && (this.own === null || i === this.own));
    if (free.length === 0) return;
    const p = this.renderer.screenToWorld(e.clientX, e.clientY);
    const dist = (i: number) => Math.hypot(game.animals[i].body.position.x - p.x, game.animals[i].body.position.y - p.y);
    const animal = free.reduce((best, i) => (dist(i) < dist(best) ? i : best));
    this.touches.set(e.pointerId, { animal, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY });
    this.send({ type: 'grip', animal, on: true });
  }

  private move(e: PointerEvent): void {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    t.x = e.clientX;
    t.y = e.clientY;
  }

  private up(e: PointerEvent, jump: boolean): void {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    this.touches.delete(e.pointerId);
    const v = this.velocity(t);
    if (jump && v) this.send({ type: 'jump', animal: t.animal, vx: v.x, vy: v.y });
    this.send({ type: 'grip', animal: t.animal, on: false });
  }

  /** Jump velocity for a drag, or null while the drag is still a tap. */
  private velocity(t: Touch): { x: number; y: number } | null {
    const dx = (t.startX - t.x) / this.renderer.scale;
    const dy = (t.startY - t.y) / this.renderer.scale;
    const d = Math.hypot(dx, dy);
    if (d < CFG.jumpMinDrag) return null;
    const speed = (Math.min(d, CFG.jumpMaxDrag) / CFG.jumpMaxDrag) * CFG.jumpMaxSpeed;
    return { x: (dx / d) * speed, y: (dy / d) * speed };
  }
}
