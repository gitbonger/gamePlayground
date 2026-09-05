import { describe, expect, it } from 'vitest';
import { LEVELS, targetName } from './levels';
import { LANDMARKS, LOFT } from './landmarks';
import { penthouseOf, plantTerrace, pointOn, terraceOf } from './world/layout';
import { project } from './world/geo';
import HOME_MAP from './world/data/home.json';
import { indexStreets, type Road } from './world/streets';
import { footprintSamples } from './world/areas';
import { defaultMapWorldOptions } from './world/from-map';

describe('what the levels aim at', () => {
  it('names a described thing that exists', () => {
    // The whole reason a level says "The Loft" rather than a coordinate is
    // that the name is checkable. Here is the check.
    const described = new Set(LANDMARKS.map((landmark) => landmark.name));
    for (const level of LEVELS) {
      if (level.target.kind !== 'landmark') continue;
      expect(described, level.name).toContain(level.target.name);
    }
  });

  it('calls the marker after the thing, not after the level', () => {
    // They differ, and the difference is load-bearing: the marker is looked
    // up by the target's name, and two levels on one building would collide
    // if it went by the level's.
    for (const level of LEVELS) {
      expect(targetName(level), level.name).toBe(level.target.name);
    }
  });

  it('gives every described thing a name of its own', () => {
    const names = LANDMARKS.map((landmark) => landmark.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('stands the loft clear of the roofline it is meant to be picked out of', () => {
    // A landmark you cannot find from the air is not one. The houses come out
    // between 16 and 24 metres, so the loft has to beat the tallest of them by
    // enough to read as different rather than as merely on the end of the
    // distribution.
    expect(LOFT.height).toBeGreaterThan(defaultMapWorldOptions.maxHeight + 5);
  });

  it('stands the loft\'s pigeon on the terrace, clear of the planting', () => {
    // The level is won by walking up to it, so where it stands has to be
    // somewhere a bird can be. It is placed relative to the marker, which
    // hangs over the middle of the terrace, and along the building's own axes
    // rather than the world's -- so this holds however the loft is turned.
    const level = LEVELS.find((l) => l.target.name === LOFT.name)!;
    const here = { ...LOFT, x: 0, z: 0 };
    const terrace = terraceOf(here)!;
    const person = pointOn(terrace, level.person.along, level.person.across);

    // On the terrace: measured back in the terrace's own frame, because the
    // terrace is turned too.
    const dx = person.x - terrace.x;
    const dz = person.z - terrace.z;
    const along = dx * Math.cos(terrace.yaw) - dz * Math.sin(terrace.yaw);
    const across = dx * Math.sin(terrace.yaw) + dz * Math.cos(terrace.yaw);
    expect(Math.abs(along)).toBeLessThan(terrace.width / 2);
    expect(Math.abs(across)).toBeLessThan(terrace.depth / 2);

    // And not inside a bush, with room to walk round it: a pigeon is about a
    // fifth of a metre across.
    for (const bush of plantTerrace(here)) {
      const gap = Math.hypot(person.x - bush.x, person.z - bush.z) - bush.radius;
      expect(gap, `${bush.x.toFixed(1)}, ${bush.z.toFixed(1)}`).toBeGreaterThan(0.5);
    }
  });

  it('turns the loft to face the way the pigeon comes in', () => {
    // The terrace is the target. Behind the penthouse it would be hidden on
    // every approach until the last second.
    const level = LEVELS.find((l) => l.target.name === LOFT.name)!;
    const centre = HOME_MAP.centre as [number, number];
    const loft = project(LOFT.at[0], LOFT.at[1], centre);
    const start = project(level.start[0], level.start[1], centre);

    const terrace = terraceOf({ ...LOFT, ...loft })!;
    const penthouse = penthouseOf({ ...LOFT, ...loft })!;
    const away = (at: { x: number; z: number }) => Math.hypot(at.x - start.x, at.z - start.z);
    expect(away(terrace)).toBeLessThan(away(penthouse));
  });

  it('stands every described building clear of the streets', () => {
    // The one that actually bites. A described thing is put down at a written
    // coordinate and the generator gives way to it -- so nothing checks it
    // against the map, and a building made three times bigger around a point
    // thirteen metres from the kerb ends up standing across two roads with
    // the carriageway disappearing under it.
    const centre = HOME_MAP.centre as [number, number];
    const streets = indexStreets(HOME_MAP.roads as Road[]);

    for (const landmark of LANDMARKS) {
      if (landmark.height <= 0) continue;
      const at = project(landmark.at[0], landmark.at[1], centre);
      const corners = footprintSamples(
        at.x,
        at.z,
        landmark.width,
        landmark.depth,
        landmark.yaw ?? 0,
        4,
      );
      for (const [x, z] of corners) {
        const road = streets.nearest(x, z, 120);
        if (!road) continue;
        // Clear of the carriageway, and off the pavement beside it.
        expect(road.distance, `${landmark.name} at ${x.toFixed(0)}, ${z.toFixed(0)}`)
          .toBeGreaterThan(road.width / 2 + 2);
      }
    }
  });

  it('leaves room around each described thing, so it stands apart', () => {
    // Nothing is built or planted inside the margin. Without one a landmark
    // ends up in a terrace, which is exactly what it must not be.
    for (const landmark of LANDMARKS) {
      expect(landmark.margin ?? 0, landmark.name).toBeGreaterThan(0);
    }
  });
});
