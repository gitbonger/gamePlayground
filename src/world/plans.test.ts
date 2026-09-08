import { describe, expect, it } from 'vitest';
import { fitBoxes, inside, insetRing, orientedBox, shoelace } from './plans';

/** A rectangle, counter-clockwise in (x, z). */
const rect = (x: number, z: number, width: number, depth: number): number[][] => [
  [x - width / 2, z - depth / 2],
  [x + width / 2, z - depth / 2],
  [x + width / 2, z + depth / 2],
  [x - width / 2, z + depth / 2],
];

const area = (ring: readonly (readonly number[])[]) => Math.abs(shoelace(ring)) / 2;

const crosses = (ring: readonly (readonly number[])[]) => {
  const side = (o: readonly number[], a: readonly number[], b: readonly number[]) =>
    Math.sign((a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!));
  for (let i = 0; i < ring.length; i += 1) {
    for (let j = i + 2; j < ring.length; j += 1) {
      if (i === 0 && j === ring.length - 1) continue;
      const a0 = ring[i]!;
      const a1 = ring[(i + 1) % ring.length]!;
      const b0 = ring[j]!;
      const b1 = ring[(j + 1) % ring.length]!;
      if (side(a0, a1, b0) !== side(a0, a1, b1) && side(b0, b1, a0) !== side(b0, b1, a1)) {
        return true;
      }
    }
  }
  return false;
};

describe('pulling a footprint in for its roof', () => {
  it('brings every wall in by the reach', () => {
    // A hipped roof is exactly this: every wall leans in at the same slope,
    // so the ridge is the outline moved inwards by the rise over the pitch.
    const pulled = insetRing(rect(0, 0, 40, 20), 4)!;
    expect(pulled).not.toBeNull();
    const box = orientedBox(pulled)!;
    expect(Math.min(box.width, box.depth)).toBeCloseTo(20 - 8, 3);
    expect(Math.max(box.width, box.depth)).toBeCloseTo(40 - 8, 3);
  });

  it('finds a ridge where the shape has no room for the full inset', () => {
    // The case this district is made of. A wing twelve metres deep with a
    // roof that wants six from either side meets itself in the middle -- the
    // ridge of a pitched roof *is* the inset that has just collapsed. Handing
    // back nothing there left every narrow wing in Józsefváros with a flat
    // roof, which is what happened.
    const ridge = insetRing(rect(0, 0, 40, 12), 6);
    expect(ridge, 'a ridge rather than nothing').not.toBeNull();
    const box = orientedBox(ridge!)!;
    // Long and all but flat: a line up the middle of the wing.
    expect(Math.max(box.width, box.depth)).toBeGreaterThan(25);
    expect(Math.min(box.width, box.depth)).toBeLessThan(1);
  });

  it('refuses an inset that walks through itself', () => {
    // The failure that neither a reversed edge nor a change of sign catches:
    // on a concave shape an inset wall can cross a wall it is not next to
    // while every edge still points the way it did. Measured on the real map,
    // 1,136 of nine thousand insets were knots, and the triangulator turned
    // them into roofs up to two hundred times the area of the building --
    // great orange sheets lying across the district.
    //
    // A narrow-waisted shape does it: pull both sides of the waist in far
    // enough and they pass through each other.
    const waisted: number[][] = [
      [0, 0],
      [40, 0],
      [40, 40],
      [22, 40],
      [22, 22],
      [18, 22],
      [18, 40],
      [0, 40],
    ];
    // Asked directly of the geometry, so the claim is about the check and not
    // about the search that backs off from it.
    const knotted = insetRing(waisted, 9);
    expect(knotted, 'something came back').not.toBeNull();
    expect(crosses(knotted!), 'and it is a shape, not a knot').toBe(false);
    // The search had to give ground to manage it.
    expect(area(knotted!)).toBeGreaterThan(0);
    expect(area(knotted!)).toBeLessThan(area(waisted));
  });

  it('keeps an L an L', () => {
    // Which is the whole point of insetting rather than boxing: the inset of
    // an L is an L, so each arm keeps its own ridge instead of the building
    // growing one tent over the notch.
    const ell: number[][] = [
      [0, 0],
      [60, 0],
      [60, 20],
      [20, 20],
      [20, 60],
      [0, 60],
    ];
    const pulled = insetRing(ell, 4)!;
    expect(pulled).toHaveLength(ell.length);
    // The notch is still a notch: a point in it is outside the inset shape.
    expect(crosses(pulled)).toBe(false);
    expect(area(pulled)).toBeLessThan(area(ell));
    expect(area(pulled)).toBeGreaterThan(area(ell) * 0.4);
  });

  it('winds the ridge the way the outline was wound', () => {
    // Everything downstream decides which way a wall faces from the winding,
    // so an inset that came back the other way round would turn a roof inside
    // out.
    const forward = rect(0, 0, 40, 20);
    const backward = [...forward].reverse();
    for (const ring of [forward, backward]) {
      const pulled = insetRing(ring, 3)!;
      expect(Math.sign(shoelace(pulled))).toBe(Math.sign(shoelace(ring)));
      // And it went *in*: a rule that took the winding for granted insets one
      // way round and outsets the other, which keeps the sign and grows the
      // building.
      expect(area(pulled)).toBeLessThan(area(ring));
      expect(area(pulled)).toBeCloseTo((40 - 6) * (20 - 6), 3);
    }
  });

  it('has nothing to say about a shape with no inside', () => {
    expect(insetRing([[0, 0], [10, 0]], 2)).toBeNull();
    expect(insetRing(rect(0, 0, 40, 20), 0)).toBeNull();
  });
});

describe('the boxes the collider gets from an outline', () => {
  it('covers a rectangle with one box that is the rectangle', () => {
    const boxes = fitBoxes(rect(10, 20, 30, 12));
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.x).toBeCloseTo(10, 6);
    expect(boxes[0]!.z).toBeCloseTo(20, 6);
    expect(Math.max(boxes[0]!.width, boxes[0]!.depth)).toBeCloseTo(30, 6);
  });

  it('cuts a courtyard block into wings rather than filling the hole', () => {
    // Taking the box every time put half the ground in this district under a
    // building -- about twice what a dense European district is -- and filled
    // in every courtyard in Józsefváros, which is the one thing about the
    // place worth having.
    const ring: number[][] = [
      [0, 0],
      [80, 0],
      [80, 80],
      [0, 80],
      [0, 60],
      [60, 60],
      [60, 20],
      [0, 20],
    ];
    // The fixture is a C: the yard is the ground at (30, 40), which is inside
    // the bounding box and outside the building.
    expect(inside(30, 40, ring), 'the yard really is a yard').toBe(false);

    const boxes = fitBoxes(ring);
    expect(boxes.length).toBeGreaterThan(1);

    // Asked of the yard rather than of a total area: wings overlap at the
    // corners, so adding them up says nothing about whether the middle is
    // built on -- and the middle is the whole question.
    const covers = (b: (typeof boxes)[number], x: number, z: number) => {
      const turn = -b.yaw;
      const dx = x - b.x;
      const dz = z - b.z;
      const along = dx * Math.cos(turn) + dz * Math.sin(turn);
      const across = -dx * Math.sin(turn) + dz * Math.cos(turn);
      return Math.abs(along) <= b.width / 2 && Math.abs(across) <= b.depth / 2;
    };
    expect(boxes.some((b) => covers(b, 30, 40))).toBe(false);
  });
});
