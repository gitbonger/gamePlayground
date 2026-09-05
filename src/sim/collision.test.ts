import { describe, expect, it } from 'vitest';
import {
  aabb,
  combineColliders,
  createColliderField,
  sweepBox,
  turnedBox,
  worldBounds,
  type Aabb,
} from './collision';
import { vec } from './math3';

/** A 10 m cube sitting on the ground at the origin. */
const TOWER: Aabb = aabb(-5, 0, -5, 5, 20, 5);

describe('sweepBox', () => {
  it('reports the entry face of a head-on hit', () => {
    const hit = sweepBox(vec(0, 10, -20), vec(0, 0, 40), 0, TOWER);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeCloseTo(15 / 40, 5);
    expect(hit!.normal).toEqual(vec(0, 0, -1));
    expect(hit!.point.z).toBeCloseTo(-5, 5);
  });

  it('misses when the segment passes to the side', () => {
    expect(sweepBox(vec(20, 10, -20), vec(0, 0, 40), 0, TOWER)).toBeNull();
  });

  it('misses when the segment stops short', () => {
    expect(sweepBox(vec(0, 10, -20), vec(0, 0, 10), 0, TOWER)).toBeNull();
  });

  it('grows the box by the mover radius', () => {
    const grazing = vec(5.5, 10, -20);
    expect(sweepBox(grazing, vec(0, 0, 40), 0, TOWER)).toBeNull();
    expect(sweepBox(grazing, vec(0, 0, 40), 1, TOWER)).not.toBeNull();
  });

  it('catches a landing on the roof and names the up face', () => {
    const hit = sweepBox(vec(0, 30, 0), vec(0, -20, 0), 0, TOWER);
    expect(hit).not.toBeNull();
    expect(hit!.normal).toEqual(vec(0, 1, 0));
    expect(hit!.point.y).toBeCloseTo(20, 5);
  });

  it('does not fire for a segment that starts inside the box', () => {
    expect(sweepBox(vec(0, 10, 0), vec(1, 0, 0), 0, TOWER)).toBeNull();
  });

  it('catches a fast segment that would tunnel through a point test', () => {
    // 200 m of travel in one step, against a 10 m box.
    const hit = sweepBox(vec(0, 10, -100), vec(0, 0, 200), 0, TOWER);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeCloseTo(95 / 200, 5);
  });
});

describe('collider field', () => {
  const boxes = [
    aabb(-5, 0, -5, 5, 20, 5),
    aabb(95, 0, -5, 105, 40, 5),
    aabb(-5, 0, 195, 5, 60, 205),
  ];
  const field = createColliderField(boxes);

  it('finds a hit through the broad phase', () => {
    const hit = field.sweep(vec(100, 10, -40), vec(100, 10, 40), 0.2);
    expect(hit).not.toBeNull();
    expect(hit!.point.z).toBeCloseTo(-5.2, 5);
  });

  it('returns the nearest hit when a sweep crosses several boxes', () => {
    const far = createColliderField([aabb(-5, 0, 10, 5, 20, 20), aabb(-5, 0, 40, 5, 20, 50)]);
    const hit = far.sweep(vec(0, 10, 0), vec(0, 10, 100), 0);
    expect(hit!.point.z).toBeCloseTo(10, 5);
  });

  it('finds nothing in open air', () => {
    expect(field.sweep(vec(-300, 200, -300), vec(-300, 200, 300), 0.2)).toBeNull();
  });

  it('handles boxes spanning several grid cells without duplicate work', () => {
    // 300 m wide, far larger than the 32 m cell size.
    const wide = createColliderField([aabb(-150, 0, -5, 150, 30, 5)]);
    const hit = wide.sweep(vec(0, 10, -50), vec(0, 10, 50), 0);
    expect(hit).not.toBeNull();
    expect(hit!.normal).toEqual(vec(0, 0, -1));
  });

  it('reports the tallest box standing over a point', () => {
    expect(field.heightAt(0, 0)).toBe(20);
    expect(field.heightAt(100, 0)).toBe(40);
    expect(field.heightAt(50, 50)).toBe(-Infinity);
  });

  it('stays correct across repeated queries reusing the seen-stamp buffer', () => {
    for (let i = 0; i < 200; i++) {
      expect(field.sweep(vec(0, 10, -40), vec(0, 10, 40), 0.2)).not.toBeNull();
      expect(field.sweep(vec(0, 300, -40), vec(0, 300, 40), 0.2)).toBeNull();
    }
  });
});

describe('turned boxes', () => {
  /** A 10 x 10 m building, 20 m tall, centred on the origin. */
  const square = (yaw: number) => turnedBox(0, 0, 10, 20, 10, yaw);

  it('is unchanged when the turn is zero', () => {
    const hit = sweepBox(vec(0, 10, -30), vec(0, 0, 60), 0, square(0));
    expect(hit!.point.z).toBeCloseTo(-5, 6);
    expect(hit!.normal).toEqual(vec(0, 0, -1));
  });

  it('presents its corner to a sweep that meets it at forty-five degrees', () => {
    // Turned 45 degrees, the near face is a corner: contact comes earlier than
    // the flat face would give, at half the diagonal rather than half a side.
    const hit = sweepBox(vec(0, 10, -30), vec(0, 0, 60), 0, square(Math.PI / 4));
    expect(hit).not.toBeNull();
    expect(hit!.point.z).toBeCloseTo(-Math.SQRT2 * 5, 4);
  });

  it('is not the inflated box its world bounds describe', () => {
    // Turned 45 degrees the solid is a diamond, and its world bounds are 40%
    // wider than it is. A sweep into the empty corner between the two must
    // miss the building and hit the bounds -- otherwise a building on a
    // diagonal street would collide as a much bigger one.
    const turned = square(Math.PI / 4);
    const bounds = worldBounds(turned);
    expect(bounds.maxX).toBeCloseTo(Math.SQRT2 * 5, 6);

    const intoTheCorner = vec(-7, 0, -7);
    expect(sweepBox(vec(12, 10, 12), intoTheCorner, 0, turned)).toBeNull();
    expect(sweepBox(vec(12, 10, 12), intoTheCorner, 0, bounds)).not.toBeNull();
  });

  it('reports a normal turned with the box', () => {
    const yaw = 0.6;
    const hit = sweepBox(vec(0, 10, -30), vec(0, 0, 60), 0, square(yaw));
    // The near face's outward normal starts at -Z and turns with the building.
    expect(hit!.normal.x).toBeCloseTo(-Math.sin(yaw), 5);
    expect(hit!.normal.z).toBeCloseTo(-Math.cos(yaw), 5);
    expect(Math.hypot(hit!.normal.x, hit!.normal.z)).toBeCloseTo(1, 6);
  });

  it('agrees with an unturned box when the turn is a quarter of a circle', () => {
    // A square turned 90 degrees is the same square.
    const straight = sweepBox(vec(2, 10, -30), vec(0, 0, 60), 0, square(0));
    const quarter = sweepBox(vec(2, 10, -30), vec(0, 0, 60), 0, square(Math.PI / 2));
    expect(quarter!.point.z).toBeCloseTo(straight!.point.z, 5);
  });

  it('finds turned buildings through the broad phase', () => {
    const field = createColliderField([turnedBox(60, -40, 14, 30, 9, 0.9)]);
    expect(field.sweep(vec(60, 12, -80), vec(60, 12, 0), 0.22)).not.toBeNull();
    expect(field.sweep(vec(200, 12, -80), vec(200, 12, 0), 0.22)).toBeNull();
  });

  it('indexes turned buildings by the space they can reach', () => {
    // The grid must use world bounds, or a building turned across a cell
    // boundary would be missed from the cell it sticks into.
    const field = createColliderField([turnedBox(0, 0, 40, 30, 6, Math.PI / 4)]);
    const corner = 40 * 0.5 * Math.SQRT1_2 * 0.8;
    expect(field.sweep(vec(corner, 10, -40), vec(corner, 10, 40), 0.2)).not.toBeNull();
  });

  it('still reports height over a turned building', () => {
    const field = createColliderField([turnedBox(0, 0, 10, 25, 10, 0.4)]);
    expect(field.heightAt(0, 0)).toBe(25);
    expect(field.heightAt(80, 80)).toBe(-Infinity);
  });
});

describe('several fields at once', () => {
  // How anything that moves gets to be solid: the city is gridded once and
  // never touched, while a train is somewhere else every tick and brings its
  // own field along.
  const near = createColliderField([turnedBox(0, 10, 8, 20, 8, 0)]);
  const far = createColliderField([turnedBox(0, 40, 8, 20, 8, 0)]);
  const both = combineColliders(near, far);

  it('counts everything it was given', () => {
    expect(both.boxCount).toBe(near.boxCount + far.boxCount);
  });

  it('finds what either one would have found', () => {
    expect(both.sweep(vec(0, 5, -10), vec(0, 5, 20), 0.2)).not.toBeNull();
    expect(both.sweep(vec(0, 5, 25), vec(0, 5, 50), 0.2)).not.toBeNull();
  });

  it('takes the nearer hit when both are in the way', () => {
    const along = both.sweep(vec(0, 5, -10), vec(0, 5, 60), 0.2)!;
    const alone = near.sweep(vec(0, 5, -10), vec(0, 5, 60), 0.2)!;
    expect(along.t).toBeCloseTo(alone.t, 9);
    // Which is the near box, not the far one.
    expect(along.t).toBeLessThan(far.sweep(vec(0, 5, -10), vec(0, 5, 60), 0.2)!.t);
  });

  it('stands on the taller of them', () => {
    expect(both.heightAt(0, 10)).toBe(near.heightAt(0, 10));
    expect(both.heightAt(0, 40)).toBe(far.heightAt(0, 40));
    // Nothing anywhere near, from either.
    expect(both.heightAt(500, 500)).toBe(-Infinity);
  });

  it('is an empty world when given nothing', () => {
    const none = combineColliders();
    expect(none.boxCount).toBe(0);
    expect(none.sweep(vec(0, 5, -10), vec(0, 5, 60), 0.2)).toBeNull();
    expect(none.heightAt(0, 0)).toBe(-Infinity);
  });
});
