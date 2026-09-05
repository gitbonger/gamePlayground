import { describe, expect, it } from 'vitest';
import { buildRoofs, roofRise } from './city';
import { buildLayoutFromMap, defaultMapWorldOptions } from './from-map';
import type { MapData, Road } from './streets';

const BLOCK: Road[] = [
  { kind: 'primary', width: 16, points: [[-40, 0], [0, 0], [200, 0], [240, 0]] },
  { kind: 'primary', width: 16, points: [[-40, 200], [0, 200], [200, 200], [240, 200]] },
  { kind: 'residential', width: 8, points: [[0, -40], [0, 0], [0, 200], [0, 240]] },
  { kind: 'residential', width: 8, points: [[200, -40], [200, 0], [200, 200], [200, 240]] },
];

const map: MapData = {
  name: 'test',
  centre: [0, 0],
  radius: 300,
  attribution: 'test',
  roads: BLOCK,
  areas: [],
};

describe('roofs', () => {
  it('takes the roof out of the building rather than piling it on top', () => {
    // The ridge is the height the layout says, so the collision box -- which
    // stops there -- still means what it did before there were roofs, and the
    // heights stay in the band the district was measured at.
    const layout = buildLayoutFromMap(map);
    expect(layout.buildings.length).toBeGreaterThan(20);

    for (const building of layout.buildings) {
      const rise = roofRise(building);
      expect(rise, `${building.width} x ${building.depth}`).toBeGreaterThan(0);
      expect(building.height).toBeLessThanOrEqual(defaultMapWorldOptions.maxHeight);
      // And the walls that carry it are still the bulk of the building.
      expect(building.height - rise).toBeGreaterThan(building.height * 0.6);
    }
  });

  it('leaves the landmark flat, so the pigeon has somewhere to land', () => {
    // A pitched roof is nowhere for a bird to stand: the collider would settle
    // it on the ridge line with the tiles falling away underneath.
    const homing = buildLayoutFromMap(map, { ...defaultMapWorldOptions, target: { x: 40, z: 40 } });
    const marked = homing.buildings.filter((b) => b.isTarget);
    expect(marked).toHaveLength(1);

    // Six triangles per roof, three vertices each, and one building without.
    const vertices = buildRoofs(homing.buildings).getAttribute('position').count;
    expect(vertices).toBe((homing.buildings.length - 1) * 6 * 3);
    expect(buildRoofs([marked[0]!]).getAttribute('position').count).toBe(0);
  });

  it('pitches a roof to its own depth, up to a limit', () => {
    // A shallow wing gets a shallow roof; a deep one stops growing rather than
    // turning the building into a spire.
    expect(roofRise({ depth: 8, height: 20 })).toBeCloseTo(2, 6);
    expect(roofRise({ depth: 16, height: 20 })).toBeCloseTo(4, 6);
    expect(roofRise({ depth: 40, height: 20 })).toBeCloseTo(5, 6);
  });

  it('never lets the roof swallow a short building', () => {
    // A deep, low building would otherwise be all roof and no wall.
    expect(roofRise({ depth: 40, height: 6 })).toBeCloseTo(6 * 0.35, 6);
  });
});
