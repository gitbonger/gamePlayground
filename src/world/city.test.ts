import { describe, expect, it } from 'vitest';
import { arrowScale, buildRoofs, roofRise, targetFlash } from './city';
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

describe('marking the target', () => {
  it('flashes once a second, and is dark for most of it', () => {
    const far = 500;
    // One clean pulse per second: nothing at the turn of the second, a peak
    // partway through, and dark again well before the next one.
    expect(targetFlash(0, far)).toBeCloseTo(0, 6);
    expect(targetFlash(0.225, far)).toBeCloseTo(1, 6);
    expect(targetFlash(0.45, far)).toBeCloseTo(0, 6);

    let dark = 0;
    for (let t = 0; t < 1; t += 0.01) if (targetFlash(t, far) < 0.05) dark += 1;
    expect(dark / 100).toBeGreaterThan(0.6);
  });

  it('repeats every second, whenever you look', () => {
    for (const second of [0, 1, 7, 123]) {
      expect(targetFlash(second + 0.225, 500)).toBeCloseTo(1, 6);
      expect(targetFlash(second + 0.8, 500)).toBeCloseTo(0, 6);
    }
  });

  it('swells and fades rather than snapping on', () => {
    // A hard edge at this size reads as a rendering fault rather than a
    // signal, so the pulse has to be continuous at both ends.
    let biggest = 0;
    let last = targetFlash(0, 500);
    for (let t = 0; t < 1; t += 1 / 240) {
      const now = targetFlash(t, 500);
      biggest = Math.max(biggest, Math.abs(now - last));
      last = now;
    }
    expect(biggest).toBeLessThan(0.05);
  });

  it('stops flashing once the bird is close enough to see it', () => {
    for (const t of [0, 0.2, 0.225, 0.4]) {
      expect(targetFlash(t, 100), `${t}s`).toBe(0);
      expect(targetFlash(t, 129), `${t}s`).toBe(0);
    }
  });

  it('fades out across the band rather than switching off', () => {
    // Snapping to nothing at a threshold makes the last flash before it look
    // like the marker breaking.
    const peak = (away: number) => targetFlash(0.225, away);
    expect(peak(130)).toBeCloseTo(0, 6);
    expect(peak(185)).toBeGreaterThan(0.3);
    expect(peak(185)).toBeLessThan(0.7);
    expect(peak(240)).toBeCloseTo(1, 6);
    expect(peak(2000)).toBeCloseTo(1, 6);
  });

  it('keeps the arrow the same apparent size however far off it is', () => {
    // Which is the whole point of it: a marker you lose at 800 m is no marker.
    // Above the floor, the size has to be proportional to the distance, or it
    // shrinks away with everything else.
    const ratio = (d: number) => arrowScale(d) / d;
    for (const distance of [200, 800, 2000]) {
      expect(ratio(distance)).toBeCloseTo(ratio(200), 9);
    }
    expect(arrowScale(1500)).toBeGreaterThan(arrowScale(150));
  });

  it('keeps a floor on it, so it does not vanish underfoot', () => {
    expect(arrowScale(0)).toBeGreaterThan(1);
    expect(arrowScale(1)).toBe(arrowScale(0));
  });
});
