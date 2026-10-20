import { Peer } from 'peerjs';
import type { DataConnection, PeerOptions } from 'peerjs';
import type { Command, Snapshot } from './game';

export type Message =
  /** Guest → host after connecting. */
  | { t: 'hello'; emoji: string }
  /** Host → guest: both build the same world from this seed. */
  | { t: 'start'; seed: number; emojis: [string, string] }
  /** Guest → host: input for the guest's animal. */
  | { t: 'cmd'; cmd: Command }
  /** Host → guest: authoritative state. */
  | { t: 'snap'; s: Snapshot }
  /** Guest → host: restart from the checkpoint after game over. */
  | { t: 'retry' }
  /** Guest → host: start a fresh world after game over, staying connected. */
  | { t: 'newStage' };

/** Link-level messages handled inside Session. */
type Control = { t: 'ping' } | { t: 'bye' };

const ID_PREFIX = 'huckepack-';
// No 0/o/1/l so codes survive being read aloud or typed.
const ROOM_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const JOIN_TIMEOUT_MS = 15000;
const PING_EVERY_MS = 1000;
/** A closed tab or lost network often never fires 'close'; silence this long means the partner is gone. */
const SILENCE_TIMEOUT_MS = 6000;

function randomRoom(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join('');
}

/** `?peer=host:port` points at a self-hosted PeerServer (used for local testing). */
function peerOptions(): PeerOptions {
  const custom = new URLSearchParams(location.search).get('peer');
  if (!custom) return { debug: 1 };
  const [host, port] = custom.split(':');
  return { host, port: Number(port) || 9000, path: '/', secure: false, debug: 1 };
}

/**
 * One peer-to-peer link between two phones over WebRTC. PeerJS's free public
 * server only brokers the handshake; game data flows directly between players.
 */
export class Session {
  onRoom: (room: string) => void = () => {};
  onConnected: () => void = () => {};
  onMessage: (m: Message) => void = () => {};
  onClose: () => void = () => {};
  onError: () => void = () => {};

  private peer: Peer;
  private conn: DataConnection | null = null;
  private closed = false;
  private heartbeat = 0;
  private lastHeard = 0;

  private constructor(peerId: string | null) {
    this.peer = peerId ? new Peer(peerId, peerOptions()) : new Peer(peerOptions());
    this.peer.on('error', () => this.fail());
  }

  /** Opens a room and waits for one partner. */
  static host(): Session {
    const room = randomRoom();
    const s = new Session(ID_PREFIX + room);
    s.peer.on('open', () => s.onRoom(room));
    s.peer.on('connection', (conn) => {
      if (s.conn) {
        conn.close();
        return;
      }
      s.attach(conn);
    });
    return s;
  }

  static join(room: string): Session {
    const s = new Session(null);
    s.peer.on('open', () => s.attach(s.peer.connect(ID_PREFIX + room, { serialization: 'json', reliable: true })));
    setTimeout(() => {
      if (!s.conn?.open) s.fail();
    }, JOIN_TIMEOUT_MS);
    return s;
  }

  send(m: Message | Control): void {
    if (this.conn?.open) this.conn.send(m);
  }

  /** Leaves the session, telling the partner so it doesn't have to wait for a timeout. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeat);
    this.send({ t: 'bye' });
    // Give the goodbye a moment to leave before tearing the connection down.
    setTimeout(() => {
      this.conn?.close();
      this.peer.destroy();
    }, 100);
  }

  private attach(conn: DataConnection): void {
    this.conn = conn;
    conn.on('open', () => {
      this.lastHeard = performance.now();
      this.heartbeat = window.setInterval(() => {
        if (performance.now() - this.lastHeard > SILENCE_TIMEOUT_MS) this.lost();
        else this.send({ t: 'ping' });
      }, PING_EVERY_MS);
      this.onConnected();
    });
    conn.on('data', (data) => {
      this.lastHeard = performance.now();
      const m = data as Message | Control;
      if (m.t === 'bye') this.lost();
      else if (m.t !== 'ping') this.onMessage(m);
    });
    conn.on('close', () => this.lost());
    conn.on('error', () => this.lost());
  }

  private lost(): void {
    if (this.closed) return;
    this.close();
    this.onClose();
  }

  private fail(): void {
    if (this.closed) return;
    // Errors after the link was up mean the partner is gone.
    if (this.conn?.open) {
      this.lost();
      return;
    }
    this.close();
    this.onError();
  }
}

/**
 * Guest-side smoothing: snapshots arrive ~30×/s with network jitter, so the
 * guest renders slightly in the past and interpolates between two snapshots.
 */
export class SnapshotBuffer {
  private buf: Snapshot[] = [];
  /** Estimated host tick minus local tick, smoothed. */
  private offset: number | null = null;
  private static readonly DELAY_TICKS = 6;

  push(s: Snapshot, localTick: number): void {
    // A new round restarts the host's tick; start over then.
    if (s.tick < this.latestTick()) this.clear();
    const est = s.tick - localTick;
    this.offset = this.offset === null ? est : this.offset + (est - this.offset) * 0.05;
    this.buf.push(s);
    if (this.buf.length > 60) this.buf.shift();
  }

  sample(localTick: number): Snapshot | null {
    if (!this.buf.length || this.offset === null) return null;
    const t = localTick + this.offset - SnapshotBuffer.DELAY_TICKS;
    while (this.buf.length > 2 && this.buf[1].tick <= t) this.buf.shift();
    const [a, b] = this.buf;
    if (!b || t <= a.tick) return a;
    if (t >= b.tick) return b;
    const k = (t - a.tick) / (b.tick - a.tick);
    const lerp = (x: number, y: number) => x + (y - x) * k;
    return {
      ...b,
      tick: t,
      animals: b.animals.map((bb, i) => ({
        ...bb,
        x: lerp(a.animals[i].x, bb.x),
        y: lerp(a.animals[i].y, bb.y),
        angle: lerpAngle(a.animals[i].angle, bb.angle, k),
      })),
      rope: b.rope.map((v, i) => lerp(a.rope[i], v)),
    };
  }

  clear(): void {
    this.buf = [];
    this.offset = null;
  }

  private latestTick(): number {
    return this.buf.length ? this.buf[this.buf.length - 1].tick : -Infinity;
  }
}

function lerpAngle(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
