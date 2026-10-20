import { expect, test } from '@playwright/test';
import { waitForGame } from './helpers';

const SQUARE = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#a0522d"/></svg>';

test('a skin replaces emojis with its images; broken files stay emojis', async ({ page }) => {
  await page.route('**/skins/test/skin.json', (route) =>
    route.fulfill({
      json: { pixelated: true, assets: { 'platform.log': { left: 'tile.svg', mid: 'tile.svg' }, 'hazard.bee': 'missing.svg' } },
    }),
  );
  await page.route('**/skins/test/tile.svg', (route) => route.fulfill({ contentType: 'image/svg+xml', body: SQUARE }));
  await page.goto('/?seed=7&skin=test');
  await page.click('#start');
  await waitForGame(page);
  await expect.poll(() => page.evaluate(() => (window as any).__assets())).toEqual(['platform.log']);
});

test('without a skin everything is drawn as emojis', async ({ page }) => {
  await page.goto('/?seed=7&skin=does-not-exist');
  await page.click('#start');
  await waitForGame(page);
  expect(await page.evaluate(() => (window as any).__assets())).toEqual([]);
});

test('the pixel skin loads and the game runs with it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?seed=7&skin=pixel');
  await page.click('#start');
  await waitForGame(page);
  await expect.poll(() => page.evaluate(() => (window as any).__assets().length)).toBeGreaterThan(5);
  const tick = await page.evaluate(() => (window as any).__game().tick);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as any).__game().tick)).toBeGreaterThan(tick);
  expect(errors).toEqual([]);
});
