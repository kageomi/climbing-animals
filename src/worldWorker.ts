// Generates the world off the main thread: the level checks take tens of
// milliseconds per step on slow phones, which would stutter the game.
import { WorldGen } from './world';

type Request = { seed: number } | { yTop: number };

let gen: WorldGen | null = null;

self.onmessage = (e: MessageEvent<Request>) => {
  if ('seed' in e.data) gen = new WorldGen(e.data.seed);
  else if (gen) (self as unknown as Worker).postMessage(gen.generateUpTo(e.data.yTop));
};
