import { expect, test } from '@playwright/test';
import { animalOnScreen, drown, peakSpeed, swipe, waitForGame, worldSignature } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/?seed=7');
  await page.click('#start');
  await waitForGame(page);
});

test('a slingshot swipe makes the animal jump', async ({ page }) => {
  // Pull from the animal: a full-power jump moves several units per frame.
  const speed = peakSpeed(page, 0, 1500);
  await swipe(page, await animalOnScreen(page, 0), 0, 150);
  expect(await speed).toBeGreaterThan(5);
});

test('idling on the start platform is safe', async ({ page }) => {
  await page.waitForTimeout(2000);
  await expect(page.locator('#over')).toBeHidden();
});

test('touching the water ends the round; 🚩 restarts', async ({ page }) => {
  await drown(page);
  await expect(page.locator('#over')).toBeVisible();
  await page.click('#retry');
  await expect(page.locator('#over')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__game().state)).toBe('play');
});

test('🎲 starts a new stage', async ({ page }) => {
  const before = await worldSignature(page);
  await drown(page);
  await page.click('#new-stage');
  await waitForGame(page);
  await expect(page.locator('#over')).toBeHidden();
  expect(await worldSignature(page)).not.toBe(before);
});
