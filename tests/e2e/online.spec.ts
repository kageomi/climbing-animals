import { expect, test } from '@playwright/test';
import { connectPair, drown, peakSpeed, swipe, waitForGame, worldSignature } from './helpers';

test('both players get the same world', async ({ browser }) => {
  const { host, guest } = await connectPair(browser);
  expect(await worldSignature(guest)).toBe(await worldSignature(host));
});

test("the guest's jump reaches the host", async ({ browser }) => {
  const { host, guest } = await connectPair(browser);
  // Online any touch steers the player's own animal (the guest's is animal 1).
  const speed = peakSpeed(host, 1, 2500);
  await swipe(guest, { x: 200, y: 500 }, 0, 150);
  expect(await speed).toBeGreaterThan(5);
});

test('game over shows on both; 🚩 from the guest restarts both', async ({ browser }) => {
  const { host, guest } = await connectPair(browser);
  await drown(host);
  await expect(host.locator('#over')).toBeVisible();
  await expect(guest.locator('#over')).toBeVisible();
  await guest.click('#retry');
  await expect(host.locator('#over')).toBeHidden();
  await expect(guest.locator('#over')).toBeHidden();
});

test('🎲 switches both to a new world without reconnecting', async ({ browser }) => {
  const { host, guest } = await connectPair(browser);
  const before = await worldSignature(host);
  await drown(host);
  await expect(guest.locator('#over')).toBeVisible();
  await guest.click('#new-stage');
  await expect.poll(() => worldSignature(host)).not.toBe(before);
  await waitForGame(guest);
  await expect.poll(() => worldSignature(guest)).toBe(await worldSignature(host));
  await expect(host.locator('#over')).toBeHidden();
  await expect(guest.locator('#over')).toBeHidden();
  await expect(host.locator('#lost')).toBeHidden();
});

test('leaving shows 🔌 to the partner', async ({ browser }) => {
  const { host, guest } = await connectPair(browser);
  await guest.close();
  await expect(host.locator('#lost')).toBeVisible();
});
