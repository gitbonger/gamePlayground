import { describe, expect, it } from 'vitest';
import { footprintSamples, indexAreas, type Area } from './areas';

/** A 100 m square park centred on the origin. */
const square: Area = {
  kind: 'park',
  points: [
    [-50, -50],
    [50, -50],
    [50, 50],
    [-50, 50],
  ],
};

/** A pocket park, small enough for one building to stand right over it. */
const pocket: Area = {
  kind: 'park',
  points: [
    [390, 390],
    [410, 390],
    [410, 410],
    [390, 410],
  ],
};

/** An L, to check concave boundaries are handled rather than bounding-boxed. */
const ell: Area = {
  kind: 'wood',
  points: [
    [200, 0],
    [300, 0],
    [300, 100],
    [260, 100],
    [260, 40],
    [200, 40],
  ],
};

describe('green space index', () => {
  const green = indexAreas([square, ell]);

  it('knows inside from outside', () => {
    expect(green.at(0, 0)?.kind).toBe('park');
    expect(green.at(49, 49)?.kind).toBe('park');
    expect(green.at(51, 0)).toBeNull();
    expect(green.at(0, -51)).toBeNull();
  });

  it('follows a concave boundary rather than its bounding box', () => {
    // Inside the L's arm.
    expect(green.at(210, 20)?.kind).toBe('wood');
    expect(green.at(280, 80)?.kind).toBe('wood');
    // In the notch: inside the bounding box, outside the shape.
    expect(green.at(210, 80)).toBeNull();
  });

  it('finds nothing far away, and does not fall over doing it', () => {
    expect(green.at(5000, -5000)).toBeNull();
    expect(green.at(-1e6, 1e6)).toBeNull();
  });

  it('reports whether any of a set of points is inside', () => {
    expect(green.anyInside([[200, 200], [0, 0]])).toBe(true);
    expect(green.anyInside([[200, 200], [400, 400]])).toBe(false);
    expect(green.anyInside([])).toBe(false);
  });

  it('handles an empty map', () => {
    const none = indexAreas([]);
    expect(none.count).toBe(0);
    expect(none.at(0, 0)).toBeNull();
  });
});

describe('footprint samples', () => {
  it('covers the whole footprint, corners included', () => {
    const points = footprintSamples(10, 20, 4, 6, 0);

    expect(Math.min(...points.map(([x]) => x))).toBeCloseTo(8, 9);
    expect(Math.max(...points.map(([x]) => x))).toBeCloseTo(12, 9);
    expect(Math.min(...points.map(([, z]) => z))).toBeCloseTo(17, 9);
    expect(Math.max(...points.map(([, z]) => z))).toBeCloseTo(23, 9);

    // And nothing outside it, or a building would be rejected for ground it
    // does not actually stand on.
    for (const [x, z] of points) {
      expect(Math.abs(x - 10)).toBeLessThanOrEqual(2 + 1e-9);
      expect(Math.abs(z - 20)).toBeLessThanOrEqual(3 + 1e-9);
    }
  });

  it('turns them with the building, keeping them the same distance out', () => {
    const straight = footprintSamples(0, 0, 10, 10, 0);
    const turned = footprintSamples(0, 0, 10, 10, Math.PI / 4);
    const away = (c: [number, number][]) => c.map(([x, z]) => Math.hypot(x, z));

    for (const [i, radius] of away(turned).entries()) {
      expect(radius).toBeCloseTo(away(straight)[i]!, 9);
    }
    // Turned 45 degrees, a corner leads instead of a wall.
    expect(Math.max(...straight.map(([x]) => x))).toBeCloseTo(5, 9);
    expect(Math.max(...turned.map(([x]) => x))).toBeCloseTo(Math.hypot(5, 5), 9);
  });

  it('samples no coarser than the step, and always on the centre', () => {
    // Both halves matter for the same reason: a park smaller than the step
    // slips between samples, and with an odd number of divisions the biggest
    // hole of all is the one in the middle of the building.
    for (const width of [20, 24, 30, 36, 46]) {
      for (const depth of [15, 20, 23, 30]) {
        const label = `${width} x ${depth}`;
        const points = footprintSamples(7, -3, width, depth, 0);

        expect(points.some(([x, z]) => Math.hypot(x - 7, z + 3) < 1e-9), label).toBe(true);

        const spread = (values: number[]) => [...new Set(values.map((v) => v.toFixed(6)))].length;
        const columns = spread(points.map(([x]) => x));
        const rows = spread(points.map(([, z]) => z));
        expect(width / (columns - 1), label).toBeLessThanOrEqual(8 + 1e-9);
        expect(depth / (rows - 1), label).toBeLessThanOrEqual(8 + 1e-9);
      }
    }
  });

  it('catches a building that only reaches into a park at one corner', () => {
    const green = indexAreas([square]);
    // Centre well clear of the park, but a corner inside it.
    const centre: [number, number] = [58, 58];
    expect(green.at(...centre)).toBeNull();
    expect(green.anyInside(footprintSamples(centre[0], centre[1], 26, 26, 0))).toBe(true);
  });

  it('catches a building standing right over a park too small to touch', () => {
    // The case corners alone miss, and the reason for sampling the inside: a
    // 46 m block over a pocket park has all four corners out on the pavement.
    const green = indexAreas([pocket]);
    const centre: [number, number] = [400, 400];
    const footprint = footprintSamples(centre[0], centre[1], 46, 30, 0);

    expect(green.anyInside(footprint)).toBe(true);
    const corners = footprint.filter(
      ([x, z]) => Math.abs(x - 400) > 22 && Math.abs(z - 400) > 14,
    );
    expect(corners).toHaveLength(4);
    expect(green.anyInside(corners)).toBe(false);
  });
});
