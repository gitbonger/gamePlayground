import { describe, expect, it } from 'vitest';
import { createAirStreaks, placeAhead, spent } from './rush';

const north = { x: 0, y: 0, z: -1 };
const here = { x: 0, y: 40, z: 0 };

/** A seeded random, so a failure is the same failure every run. */
const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

describe('the air at speed', () => {
  it('puts a mote in front of the camera, never behind it', () => {
    const random = seeded(5);
    for (let i = 0; i < 400; i += 1) {
      const mote = placeAhead(here, north, random);
      const along = (mote.x - here.x) * north.x + (mote.y - here.y) * north.y + (mote.z - here.z) * north.z;
      // A little behind is allowed and wanted -- the frame is wider than the
      // line of flight, so air beside and just past him is air he can see --
      // but nothing is born a long way back where it would only fly away.
      expect(along).toBeGreaterThan(-7);
      expect(along).toBeLessThan(47);
      const off = Math.hypot(mote.x - here.x, mote.y - here.y - 0, mote.z - here.z) ** 2 - along ** 2;
      expect(Math.sqrt(Math.max(0, off))).toBeLessThan(17);
    }
  });

  it('spreads them through the air rather than piling them at the near end', () => {
    const random = seeded(9);
    const far = [];
    for (let i = 0; i < 600; i += 1) {
      const mote = placeAhead(here, north, random);
      far.push(-(mote.z - here.z));
    }
    // Half the length holds an eighth of the volume, so it should hold about
    // an eighth of them: what this rules out is the even spread that puts
    // half of them in the first metres, where they are a wall of sticks.
    const near = far.filter((along) => along < 46 / 2).length / far.length;
    expect(near).toBeGreaterThan(0.05);
    expect(near).toBeLessThan(0.2);
  });

  it('gives one up once it is behind or too far out to the side', () => {
    expect(spent({ x: 0, y: 40, z: -20 }, here, north)).toBe(false);
    // Behind him.
    expect(spent({ x: 0, y: 40, z: 9 }, here, north)).toBe(true);
    // Past the far end.
    expect(spent({ x: 0, y: 40, z: -60 }, here, north)).toBe(true);
    // Out to the side, within the length but not the width.
    expect(spent({ x: 30, y: 40, z: -20 }, here, north)).toBe(true);
  });

  it('draws none at all below the speed it starts at, and more as it rises', () => {
    const streaks = createAirStreaks(seeded(3));
    const mesh = streaks.object as unknown as { count: number };

    streaks.update(here, north, 10, 0);
    expect(mesh.count).toBe(0);

    streaks.update(here, north, 40, 0.5);
    const half = mesh.count;
    expect(half).toBeGreaterThan(0);

    streaks.update(here, north, 80, 1);
    expect(mesh.count).toBeGreaterThan(half);
    streaks.dispose();
  });

  it('keeps them in front of a camera that has flown on', () => {
    const streaks = createAirStreaks(seeded(11));
    const mesh = streaks.object as unknown as {
      count: number;
      instanceMatrix: { array: Float32Array };
    };
    let at = { ...here };
    streaks.update(at, north, 80, 1);

    // Eighty metres a second for a second and a half, which is further than
    // the air in front of him is deep: every mote should have been given up
    // and replaced, and none left streaming away behind.
    for (let step = 0; step < 90; step += 1) {
      at = { x: at.x, y: at.y, z: at.z - 80 / 60 };
      streaks.update(at, north, 80, 1);
    }
    const m = mesh.instanceMatrix.array;
    for (let i = 0; i < mesh.count; i += 1) {
      const along = -(m[i * 16 + 14]! - at.z);
      expect(along).toBeGreaterThan(-7);
      expect(along).toBeLessThan(51);
    }
    streaks.dispose();
  });
});
