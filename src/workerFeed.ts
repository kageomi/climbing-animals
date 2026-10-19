import type { Chunk, WorldFeed } from './world';

/** World feed backed by a Web Worker running the generator. */
export class WorkerFeed implements WorldFeed {
  onChunk: (chunk: Chunk) => void = () => {};
  private worker = new Worker(new URL('./worldWorker.ts', import.meta.url), { type: 'module' });

  constructor(seed: number) {
    this.worker.onmessage = (e: MessageEvent<Chunk>) => this.onChunk(e.data);
    this.worker.postMessage({ seed });
  }

  request(yTop: number): void {
    this.worker.postMessage({ yTop });
  }

  dispose(): void {
    this.worker.terminate();
  }
}
