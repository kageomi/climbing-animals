// All tuning values in one place. World units: +y points down, 1 m = METER units.
export const CFG = {
  meter: 20,

  /** Visible world width; the playfield is narrower so walls stay on screen. */
  viewWidth: 420,
  /** Walls sit at ±worldHalfWidth. */
  worldHalfWidth: 190,
  tile: 28,

  /** Rendered size of an animal sprite (the emoji fills ~80% of it). */
  animalSize: 44,
  animalDensity: 0.002,

  ropeSegments: 12,
  /** Rest length: the rope is slack below this and stretches like rubber above. */
  ropeLength: 170,
  ropeStiffness: 0.3,
  ropeDamping: 0.05,

  jumpMaxSpeed: 13,
  /** Drag distance (world units) that gives full jump power. */
  jumpMaxDrag: 120,
  /** Shorter drags count as a plain tap (no jump). */
  jumpMinDrag: 10,

  /** Surface of the water at the bottom of the world. */
  waterY: 100,
  /** Top of the drawn waves; touching this counts as being in the water. */
  waterSurfaceY: 90,
  /** An animal must touch the water this long (ticks) for game over; a short splash before the screen. */
  drownTicks: 8,

  checkpointEvery: 50, // m
  /** Jumps from a mushroom are this much stronger. */
  mushroomBoost: 1.4,
  /** Fraction of the landing speed a mushroom gives back. */
  mushroomRestitution: 0.6,
  hazardKnock: 10,
  hazardRadius: 26,
} as const;

export const TICK_MS = 1000 / 60;
