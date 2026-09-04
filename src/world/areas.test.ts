import { describe, expect, it } from 'vitest';
import { footprintCorners, indexAreas, type Area } from './areas';

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

describe('footprint corners', () => {
  it('gives the four corners of an unturned box', () => {
    const corners = footprintCorners(10, 20, 4, 6, 0);
    expect(corners).toHaveLength(4);
    expect(corners.map(([x]) => x).sort((a, b) => a - b)).toEqual([8, 8, 12, 12]);
    expect(corners.map(([, z]) => z).sort((a, b) => a - b)).toEqual([17, 17, 23, 23]);
  });

  it('turns them with the building, keeping them the same distance out', () => {
    const straight = footprintCorners(0, 0, 10, 10, 0);
    const turned = footprintCorners(0, 0, 10, 10, Math.PI / 4);
    const away = (c: [number, number][]) => c.map(([x, z]) => Math.hypot(x, z));

    for (const [i, radius] of away(turned).entries()) {
      expect(radius).toBeCloseTo(away(straight)[i]!, 9);
    }
    // Turned 45 degrees, a corner sits on an axis.
    expect(Math.min(...turned.map(([, z]) => Math.abs(z)))).toBeCloseTo(0, 9);
  });

  it('catches a building that only reaches into a park at one corner', () => {
    const green = indexAreas([square]);
    // Centre well clear of the park, but a corner inside it.
    const centre: [number, number] = [58, 58];
    expect(green.at(...centre)).toBeNull();
    expect(green.anyInside(footprintCorners(centre[0], centre[1], 26, 26, 0))).toBe(true);
  });
});
