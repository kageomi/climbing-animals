import './style.css';
import qrcode from 'qrcode-generator';
import { DEFAULT_SKIN, loadedAssets, loadSkin } from './assets';
import { TICK_MS } from './config';
import { Game } from './game';
import type { Command } from './game';
import { SlingshotInput } from './input';
import { Session } from './net';
import { SnapshotBuffer } from './snapshots';
import type { Message } from './net';
import { Renderer } from './render';
import { WorkerFeed } from './workerFeed';

const ANIMALS = ['🐸', '🐵', '🐱', '🐨', '🐧', '🐷', '🐻', '🐰', '🦊', '🐼', '🐢', '🐍', '🐡', '🦔', '🐌', '🦀'];

/** Snapshots go out every this many ticks (≈30 per second). */
const SNAPSHOT_EVERY = 2;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('game');
const overlays = {
  menu: $('menu'),
  lobby: $('lobby'),
  join: $('join'),
  over: $('over'),
  lost: $('lost'),
};
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

/**
 * solo: this device simulates and controls both animals.
 * host: this device simulates, controls animal 0 and streams snapshots.
 * guest: this device only mirrors snapshots and sends input for animal 1.
 */
type Mode = 'solo' | 'host' | 'guest';
let mode: Mode = 'solo';
let session: Session | null = null;
let lastSnapshotTick = -Infinity;
let lastSnapshotState: Game['state'] = 'play';
const snapshots = new SnapshotBuffer();

const renderer = new Renderer(canvas);
// Until the skin is loaded (or if it fails) the stage is drawn with emojis.
void loadSkin(new URLSearchParams(location.search).get('skin') ?? DEFAULT_SKIN);
let game: Game | null = null;
const queue: Command[] = [];
const input = new SlingshotInput(canvas, renderer, () => game, (cmd) => {
  if (mode === 'guest') session?.send({ t: 'cmd', cmd });
  else queue.push(cmd);
});

const localTick = () => performance.now() / TICK_MS;

function show(name: keyof typeof overlays | null): void {
  for (const [key, el] of Object.entries(overlays)) el.classList.toggle('hidden', key !== name);
}

function startGame(emojis: [string, string], seed: number, m: Mode): void {
  game?.destroy();
  game = new Game(emojis, seed, new WorkerFeed(seed));
  mode = m;
  input.own = m === 'solo' ? null : m === 'host' ? 0 : 1;
  queue.length = 0;
  input.reset();
  snapshots.clear();
  lastSnapshotTick = -Infinity;
  lastSnapshotState = 'play';
  renderer.follow(game, true);
  show(null);
}

function leaveSession(): void {
  session?.close();
  session = null;
  mode = 'solo';
  input.own = null;
  // Drop ?join so a reload doesn't try to rejoin a finished room.
  const url = new URL(location.href);
  if (url.searchParams.has('join')) {
    url.searchParams.delete('join');
    history.replaceState(null, '', url);
  }
}

function newSeed(fresh = false): number {
  // ?seed=N pins the first world for debugging; a stage change always rolls a new one.
  const seedParam = new URLSearchParams(location.search).get('seed');
  return seedParam && !fresh ? Number(seedParam) >>> 0 : (Math.random() * 2 ** 32) >>> 0;
}

function partnerLost(): void {
  session = null;
  mode = 'solo';
  input.own = null;
  game?.destroy();
  game = null;
  show('lost');
}

// --- Menu -------------------------------------------------------------------

function renderPicks(): void {
  document.querySelectorAll<HTMLElement>('.pick').forEach((btn) => {
    btn.textContent = picks[Number(btn.dataset.slot)];
  });
  document.querySelectorAll<HTMLElement>('[data-me]').forEach((el) => {
    el.textContent = picks[0];
  });
}

document.querySelectorAll<HTMLButtonElement>('.pick').forEach((btn) => {
  const slot = Number(btn.dataset.slot) as 0 | 1;
  btn.addEventListener('click', () => {
    picks[slot] = ANIMALS[(ANIMALS.indexOf(picks[slot]) + 1) % ANIMALS.length];
    store.set(`animal${slot}`, picks[slot]);
    renderPicks();
  });
});

$('start').addEventListener('click', () => startGame([...picks], newSeed(), 'solo'));

// --- Online: host -------------------------------------------------------------

function inviteUrl(room: string): string {
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('join', room);
  const peer = new URLSearchParams(location.search).get('peer');
  if (peer) url.searchParams.set('peer', peer);
  return url.toString();
}

let invite = '';

$('online').addEventListener('click', () => {
  leaveSession();
  $('qr').innerHTML = '';
  $('room-code').textContent = '';
  $('lobby-status').textContent = '⏳';
  show('lobby');

  const s = Session.host();
  session = s;
  s.onRoom = (room) => {
    invite = inviteUrl(room);
    const qr = qrcode(0, 'M');
    qr.addData(invite);
    qr.make();
    $('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    $('room-code').textContent = room.toUpperCase();
  };
  s.onMessage = (m) => onHostMessage(m);
  s.onClose = partnerLost;
  s.onError = () => {
    $('lobby-status').textContent = '❌';
  };
});

function onHostMessage(m: Message): void {
  if (!session) return;
  if (m.t === 'hello' && !game) {
    const seed = newSeed();
    const emojis: [string, string] = [picks[0], m.emoji];
    session.send({ t: 'start', seed, emojis });
    startGame(emojis, seed, 'host');
  } else if (m.t === 'cmd' && m.cmd.animal === 1) {
    // The guest may only steer its own animal.
    queue.push(m.cmd);
  } else if (m.t === 'retry') {
    retry();
  } else if (m.t === 'newStage' && game?.state === 'over') {
    newStage();
  }
}

$('share').addEventListener('click', async () => {
  if (!invite) return;
  const btn = $('share');
  try {
    if (navigator.share) await navigator.share({ url: invite });
    else {
      await navigator.clipboard.writeText(invite);
      btn.textContent = '✅';
      setTimeout(() => (btn.textContent = '📤'), 1500);
    }
  } catch {
    // Share sheet dismissed.
  }
});

$('lobby-cancel').addEventListener('click', () => {
  leaveSession();
  show('menu');
});

// --- Online: guest ------------------------------------------------------------

const joinRoom = new URLSearchParams(location.search).get('join');

$('join-go').addEventListener('click', () => {
  if (!joinRoom) return;
  session?.close();
  $('join-status').textContent = '⏳';
  const s = Session.join(joinRoom);
  session = s;
  s.onConnected = () => s.send({ t: 'hello', emoji: picks[0] });
  s.onMessage = (m) => {
    if (m.t === 'start') startGame(m.emojis, m.seed, 'guest');
    else if (m.t === 'snap' && mode === 'guest') snapshots.push(m.s, localTick());
  };
  s.onClose = partnerLost;
  s.onError = () => {
    session = null;
    $('join-status').textContent = '❌';
  };
});

$('join-cancel').addEventListener('click', () => {
  leaveSession();
  show('menu');
});

// --- Game over / leaving ------------------------------------------------------

function retry(): void {
  if (!game) return;
  if (mode === 'guest') {
    session?.send({ t: 'retry' });
    return;
  }
  game.respawn();
  queue.length = 0;
  input.reset();
  show(null);
}

$('retry').addEventListener('click', retry);

/** New world with the same animals; online the pair stays connected. */
function newStage(): void {
  if (!game) return;
  if (mode === 'guest') {
    session?.send({ t: 'newStage' });
    return;
  }
  const emojis = game.animals.map((a) => a.emoji) as [string, string];
  const seed = newSeed(true);
  if (mode === 'host') session?.send({ t: 'start', seed, emojis });
  startGame(emojis, seed, mode);
}

$('new-stage').addEventListener('click', newStage);

function home(): void {
  leaveSession();
  show('menu');
}

$('home').addEventListener('click', home);
$('lost-home').addEventListener('click', home);

// --- Loop -------------------------------------------------------------------

let last = performance.now();
let acc = 0;

function frame(now: number): void {
  acc = Math.min(acc + (now - last), TICK_MS * 5);
  last = now;
  if (game && mode === 'guest') {
    acc = 0;
    const s = snapshots.sample(localTick());
    if (s) game.applySnapshot(s);
  } else if (game) {
    while (acc >= TICK_MS) {
      for (const cmd of queue.splice(0)) game.apply(cmd);
      game.step();
      acc -= TICK_MS;
    }
    // Also send right away when the round ends or restarts, so the guest never misses it.
    if (mode === 'host' && (game.tick - lastSnapshotTick >= SNAPSHOT_EVERY || game.state !== lastSnapshotState)) {
      session?.send({ t: 'snap', s: game.snapshot() });
      lastSnapshotTick = game.tick;
      lastSnapshotState = game.state;
    }
  } else {
    acc = 0;
  }

  if (game) {
    if (game.maxHeight > best) {
      best = game.maxHeight;
      store.set('best', String(best));
    }
    heightEl.textContent = `⬆️ ${game.maxHeight}m`;
    bestEl.textContent = `🏆 ${best}m`;
    const overVisible = !overlays.over.classList.contains('hidden');
    if (game.state === 'over' && !overVisible && overlays.menu.classList.contains('hidden')) {
      $('over-height').textContent = `⬆️ ${game.maxHeight}m`;
      show('over');
    } else if (game.state === 'play' && overVisible) {
      // The host restarted the round (guest side).
      show(null);
    }
    renderer.follow(game);
    renderer.draw(game, input.aims(), input.own);
  }
  requestAnimationFrame(frame);
}

// Closing the tab or leaving the page ends the session for the partner right away.
addEventListener('pagehide', () => session?.close());

renderPicks();
bestEl.textContent = `🏆 ${best}m`;
if (joinRoom) show('join');
requestAnimationFrame(frame);

// Expose for debugging/tests in the browser console.
Object.assign(window, { __game: () => game, __renderer: renderer, __session: () => session, __assets: loadedAssets });
