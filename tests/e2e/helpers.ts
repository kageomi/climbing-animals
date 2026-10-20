import type { Browser, Page } from '@playwright/test';

/** Game state as exposed on window for tests (see main.ts). */
type TestWindow = Window & { __game: () => any; __renderer: { scale: number; camY: number } };

export const PEER = 'peer=127.0.0.1:9000';

export async function waitForGame(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as TestWindow).__game()?.ready, null, { timeout: 30_000 });
}

/** Puts both animals into the water: the round must end. */
export async function drown(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = (window as unknown as TestWindow).__game();
    g.checkpoint = { x: 0, y: 200, tiles: 1, mat: 'log' };
    g.respawn();
    g.checkpoint = null;
  });
}

/** First platforms of the current world, to compare worlds between runs or devices. */
export function worldSignature(page: Page): Promise<string> {
  return page.evaluate(() =>
    JSON.stringify(
      (window as unknown as TestWindow)
        .__game()
        .platforms.slice(0, 15)
        .map((p: { x: number; y: number; tiles: number; mat: string }) => [p.x, p.y, p.tiles, p.mat]),
    ),
  );
}

/**
 * Fastest an animal moves within `ms`, sampled every frame in the page. Checking
 * speed instead of height keeps jump tests independent of the level layout.
 */
export function peakSpeed(page: Page, index: number, ms: number): Promise<number> {
  return page.evaluate(
    ([i, duration]) =>
      new Promise<number>((resolve) => {
        const g = (window as unknown as TestWindow).__game;
        let max = 0;
        let last = g().animals[i].body.position;
        last = { x: last.x, y: last.y };
        const end = performance.now() + duration;
        const tick = () => {
          const p = g().animals[i].body.position;
          max = Math.max(max, Math.hypot(p.x - last.x, p.y - last.y));
          last = { x: p.x, y: p.y };
          if (performance.now() < end) requestAnimationFrame(tick);
          else resolve(max);
        };
        tick();
      }),
    [index, ms] as const,
  );
}

/** Screen position of an animal. */
export function animalOnScreen(page: Page, index: number): Promise<{ x: number; y: number }> {
  return page.evaluate((i) => {
    const w = window as unknown as TestWindow;
    const p = w.__game().animals[i].body.position;
    const r = w.__renderer;
    return { x: p.x * r.scale + innerWidth / 2, y: (p.y - r.camY) * r.scale + innerHeight / 2 };
  }, index);
}

/** Slingshot gesture with a real touch: press at `from`, pull by (dx, dy), release. */
export async function swipe(page: Page, from: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const point = (k: number) => [{ x: from.x + (dx * k) / 6, y: from.y + (dy * k) / 6, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(0) });
  for (let k = 1; k <= 6; k++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(k) });
    await page.waitForTimeout(20);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** Host opens a room, guest joins through the invite link. */
export async function connectPair(browser: Browser): Promise<{ host: Page; guest: Page }> {
  const host = await (await browser.newContext()).newPage();
  const guest = await (await browser.newContext()).newPage();
  await host.goto(`/?${PEER}`);
  await host.click('#online');
  await host.waitForFunction(() => (document.getElementById('room-code')?.textContent ?? '').length > 0);
  const room = (await host.textContent('#room-code'))!.toLowerCase();
  await guest.goto(`/?join=${room}&${PEER}`);
  await guest.click('#join-go');
  await waitForGame(host);
  await waitForGame(guest);
  return { host, guest };
}
