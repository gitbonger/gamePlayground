import { describe, expect, it } from 'vitest';
import {
  distanceToEdges,
  insetPolygon,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  shrinkRing,
  tidyRing,
  type Point2,
} from './polygon';

/** A 100 m square, wound counter-clockwise. */
const square: Point2[] = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
];

/** An L, so concave corners are exercised rather than assumed away. */
const ell: Point2[] = [
  [0, 0],
  [100, 0],
  [100, 40],
  [40, 40],
  [40, 100],
  [0, 100],
];

describe('polygon arithmetic', () => {
  it('signs the area by which way the ring winds', () => {
    expect(polygonArea(square)).toBeCloseTo(10000, 6);
    expect(polygonArea([...square].reverse())).toBeCloseTo(-10000, 6);
  });

  it('measures a concave ring by its area, not its bounding box', () => {
    expect(polygonArea(ell)).toBeCloseTo(10000 - 60 * 60, 6);
  });

  it('tells inside from outside, including in the notch of a concave ring', () => {
    expect(pointInPolygon(20, 20, ell)).toBe(true);
    expect(pointInPolygon(70, 20, ell)).toBe(true);
    // Inside the bounding box, outside the L.
    expect(pointInPolygon(70, 70, ell)).toBe(false);
    expect(pointInPolygon(-1, 50, ell)).toBe(false);
  });

  it('puts the centroid where the area is', () => {
    const [x, z] = polygonCentroid(square);
    expect(x).toBeCloseTo(50, 6);
    expect(z).toBeCloseTo(50, 6);
    // The L's mass is toward its corner, not the middle of its box.
    const [ex, ez] = polygonCentroid(ell);
    expect(ex).toBeLessThan(50);
    expect(ez).toBeLessThan(50);
  });

  it('measures to the nearest edge, whichever it is', () => {
    expect(distanceToEdges(50, 50, square)).toBeCloseTo(50, 6);
    expect(distanceToEdges(10, 50, square)).toBeCloseTo(10, 6);
  });

  it('drops the repeated points an inset could take no direction from', () => {
    expect(tidyRing([[0, 0], [0, 0], [10, 0], [10, 10], [0, 0]])).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
  });
});

describe('insetting a ring', () => {
  it('moves every edge inward by the distance asked for', () => {
    const inset = insetPolygon(square, 10);
    expect(polygonArea(inset)).toBeCloseTo(80 * 80, 6);
    for (const [x, z] of inset) {
      expect(distanceToEdges(x, z, square)).toBeCloseTo(10, 6);
    }
  });

  it('takes a distance per edge, for a block with a boulevard on one side', () => {
    // Only the first edge, the one from (0,0) to (100,0), moves 30 m.
    const inset = insetPolygon(square, [30, 10, 10, 10]);
    expect(polygonArea(inset)).toBeCloseTo(80 * 60, 6);
  });

  it('keeps the walls parallel to their streets, not the corners equidistant', () => {
    // The whole reason for intersecting offset lines rather than pulling the
    // corners in: a corner moved along its own bisector drags its two walls
    // away from the streets they front.
    const inset = insetPolygon(ell, 10);
    const bottom = inset.filter(([, z]) => Math.abs(z - 10) < 1e-6);
    expect(bottom.length).toBeGreaterThanOrEqual(2);
  });

  it('cuts a sharp corner off instead of flinging it into the distance', () => {
    // A spike: two edges meeting at a hair's breadth. Their offset lines cross
    // a very long way out, and an unclamped miter puts a corner there.
    const spike: Point2[] = [
      [0, 0],
      [400, 1],
      [400, -1],
    ];
    for (const [x, z] of insetPolygon(spike, 10)) {
      expect(Math.hypot(x, z)).toBeLessThan(1000);
    }
  });
});

describe('shrinking a ring, safely', () => {
  it('gives back the inset when the inset means something', () => {
    const shrunk = shrinkRing(square, 10);
    expect(polygonArea(shrunk)).toBeCloseTo(80 * 80, 6);
  });

  it('refuses once the walls have met in the middle', () => {
    // Half the square's width. Past this the ring turns itself inside out, and
    // a ring inside out still has a perfectly ordinary-looking area.
    for (const distance of [50, 55, 60, 80, 120]) {
      expect(shrinkRing(square, distance), `${distance} m`).toEqual([]);
    }

    // Which is the trap, and the reason this is checked edge by edge rather
    // than by area: inset 80 m, the raw result is a tidy 60 m square, wound
    // the right way and well inside the original. Every plausible sanity check
    // short of looking at the edge directions waves it through.
    const wrong = insetPolygon(square, 80);
    expect(polygonArea(wrong)).toBeCloseTo(3600, 6);
    expect(wrong.every(([x, z]) => pointInPolygon(x, z, square))).toBe(true);
  });

  it('refuses a ring wound the wrong way rather than inventing one', () => {
    expect(shrinkRing([...square].reverse(), 10)).toEqual([]);
  });

  it('gives an answer, or nothing, for any ring at any distance', () => {
    // Shrinking is iterative -- collapsed edges are dropped and the rest
    // re-fitted -- and each pass can hand the next one a ring that has changed
    // shape underneath it. Every awkward case has to end in a usable ring or
    // an empty one, never a throw and never a ring that has escaped.
    const awkward: Point2[][] = [
      square,
      ell,
      // A sliver.
      [[0, 0], [200, 1], [200, -1]],
      // A wedge with a clipped corner, which is any real block corner.
      [[0, 0], [60, 0], [80, 20], [80, 60], [0, 60]],
      // Nearly collinear neighbours.
      [[0, 0], [50, 0.01], [100, 0], [100, 40], [0, 40]],
      // A deep notch.
      [[0, 0], [100, 0], [100, 100], [55, 100], [55, 10], [45, 10], [45, 100], [0, 100]],
    ];

    for (const ring of awkward) {
      for (let distance = 0.5; distance <= 60; distance += 0.5) {
        const shrunk = shrinkRing(ring, distance);
        if (shrunk.length === 0) continue;
        expect(shrunk.length, `${distance}`).toBeGreaterThanOrEqual(3);
        expect(polygonArea(shrunk)).toBeGreaterThan(0);
        expect(polygonArea(shrunk)).toBeLessThan(polygonArea(ring));
        for (const [x, z] of shrunk) {
          expect(pointInPolygon(x, z, ring), `${distance} m: ${x},${z}`).toBe(true);
        }
      }
    }
  });

  it('never returns ground outside what it shrank', () => {
    for (const distance of [1, 5, 12, 19]) {
      for (const [x, z] of shrinkRing(ell, distance)) {
        expect(pointInPolygon(x, z, ell), `${distance} m: ${x},${z}`).toBe(true);
      }
    }
  });
});
