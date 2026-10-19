import './style.css';
import { TICK_MS } from './config';
import { Game } from './game';
import type { Command } from './game';
import { SoloInput } from './input';
import { Renderer } from './render';

const ANIMALS = ['🐸', '🐵', '🐱', '🐨', '🐧', '🐷', '🐻', '🐰', '🦊', '🐼', '🐢', '🐍', '🐡', '🦔', '🐌', '🦀'];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('game');
const menu = $('menu');
const over = $('over');
const heightEl = $('height');
const bestEl = $('best');

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage unavailable (private mode): settings just aren't remembered.
    }
  },
};

const picks: [string, string] = [store.get('animal0') ?? '🐸', store.get('animal1') ?? '🐵'];
let best = Number(store.get('best') ?? 0) || 0;

const renderer = new Renderer(canvas);
let game: Game | null = null;
const queue: Command[] = [];
const input = new SoloInput(canvas, renderer, () => game, (cmd) => queue.push(cmd));

// --- Menu -------------------------------------------------------------------

document.querySelectorAll<HTMLButtonElement>('.pick').forEach((btn) => {
  const slot = Number(btn.dataset.slot) as 0 | 1;
  btn.textContent = picks[slot];
  btn.addEventListener('click', () => {
    picks[slot] = ANIMALS[(ANIMALS.indexOf(picks[slot]) + 1) % ANIMALS.length];
    btn.textContent = picks[slot];
    store.set(`animal${slot}`, picks[slot]);
  });
});

$('start').addEventListener('click', () => {
  game?.destroy();
  // The seed will be shared with the partner once online play exists; ?seed=N pins it for debugging.
  const seedParam = new URLSearchParams(location.search).get('seed');
  game = new Game([...picks], seedParam ? Number(seedParam) >>> 0 : (Math.random() * 2 ** 32) >>> 0);
  queue.length = 0;
  input.reset();
  renderer.follow(game, true);
  menu.classList.add('hidden');
});

$('retry').addEventListener('click', () => {
  if (!game) return;
  game.respawn();
  queue.length = 0;
  input.reset();
  over.classList.add('hidden');
});

$('home').addEventListener('click', () => {
  over.classList.add('hidden');
  menu.classList.remove('hidden');
});

// --- Loop -------------------------------------------------------------------

let last = performance.now();
let acc = 0;

function frame(now: number): void {
  acc = Math.min(acc + (now - last), TICK_MS * 5);
  last = now;
  if (game) {
    while (acc >= TICK_MS) {
      for (const cmd of queue.splice(0)) game.apply(cmd);
      game.step();
      acc -= TICK_MS;
    }
    if (game.maxHeight > best) {
      best = game.maxHeight;
      store.set('best', String(best));
    }
    heightEl.textContent = `⬆️ ${game.maxHeight}m`;
    bestEl.textContent = `🏆 ${best}m`;
    if (game.state === 'over' && over.classList.contains('hidden')) {
      $('over-height').textContent = `⬆️ ${game.maxHeight}m`;
      over.classList.remove('hidden');
    }
    renderer.follow(game);
    renderer.draw(game, input.aims());
  } else {
    acc = 0;
  }
  requestAnimationFrame(frame);
}

bestEl.textContent = `🏆 ${best}m`;
requestAnimationFrame(frame);

// Expose for debugging/tests in the browser console.
Object.assign(window, { __game: () => game, __renderer: renderer });
