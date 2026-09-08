import { describe, expect, it } from 'vitest';
import { onPanel } from './minimap';

/** A panel 100 across, showing 200 m each way. */
const MIDDLE = 50;
const SCALE = MIDDLE / 200;
const here = { x: 0, z: 0 };

describe('turning the ground onto the panel', () => {
  it('puts what is in front of the bird at the top', () => {
    // The whole reason the map turns. North-up would make the player do the
    // rotation in their head at the moment they are also flying.
    //
    // Facing nought is -Z, so a hundred metres ahead is z = -100.
    const ahead = onPanel(here, 0, { x: 0, z: -100 }, MIDDLE, SCALE);
    expect(ahead.x).toBeCloseTo(MIDDLE, 6);
    expect(ahead.y).toBeLessThan(MIDDLE);
  });

  it('puts what is on the bird’s right on the right', () => {
    // The other half, and the one that would go unnoticed: a map mirrored
    // left to right still looks like a map.
    const right = onPanel(here, 0, { x: 100, z: 0 }, MIDDLE, SCALE);
    expect(right.x).toBeGreaterThan(MIDDLE);
    expect(right.y).toBeCloseTo(MIDDLE, 6);
  });

  it('turns with the bird', () => {
    // Flying east, the thing that was on the right is now straight ahead.
    const east = Math.PI / 2;
    const spot = onPanel(here, east, { x: 100, z: 0 }, MIDDLE, SCALE);
    expect(spot.x).toBeCloseTo(MIDDLE, 6);
    expect(spot.y).toBeLessThan(MIDDLE);
  });

  it('keeps the scale honest in both directions', () => {
    // A hundred metres out is a quarter of the panel, whichever way it lies.
    const ahead = onPanel(here, 0, { x: 0, z: -100 }, MIDDLE, SCALE);
    const right = onPanel(here, 0, { x: 100, z: 0 }, MIDDLE, SCALE);
    expect(MIDDLE - ahead.y).toBeCloseTo(right.x - MIDDLE, 6);
    expect(right.x - MIDDLE).toBeCloseTo(100 * SCALE, 6);
  });
});
