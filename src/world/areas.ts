/**
 * Ground that is already spoken for: parks, woods, playing fields, water.
 *
 * The world generator uses this to leave those places alone, which is most of
 * what makes a generated city stop looking generated — real cities have holes
 * in them, and the holes are not random.
 */

export type AreaKind = 'park' | 'wood' | 'water' | 'pitch';

export interface Area {
  kind: AreaKind;
  /** Closed ring in local metres, [x, z]. The last point need not repeat. */
  points: [number, number][];
}

export interface AreaIndex {
  /** The area covering this point, or null if the ground is free. */
  at(x: number, z: number): Area | null;
  /**
   * Whether any area covering this point is of this kind.
   *
   * A different question from `at(x, z)?.kind === kind`, and the difference
   * is the one that matters: areas overlap. A lake drawn inside a park is two
   * areas over the same point, and `at` answers with whichever of them the
   * index reaches first -- fine for "what ground is this", wrong for "is this
   * water", where the answer must not depend on which was listed first.
   */
  covers(x: number, z: number, kind: AreaKind): boolean;
  /** True when any of the points falls inside an area. */
  anyInside(points: readonly (readonly [number, number])[]): boolean;
  readonly count: number;
}

/** Grid cell size for the area index, in metres. */
const CELL = 64;

interface Bounded {
  area: Area;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/**
 * Ray casting: count how many edges a ray from the point crosses. Odd means
 * inside. Handles concave rings, which park boundaries very much are.
 */
function inRing(x: number, z: number, points: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, zi] = points[i]!;
    const [xj, zj] = points[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function indexAreas(areas: readonly Area[]): AreaIndex {
  const bounded: Bounded[] = areas.map((area) => {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of area.points) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    return { area, minX, minZ, maxX, maxZ };
  });

  const grid = new Map<number, number[]>();
  const cell = (v: number) => Math.floor(v / CELL);
  const key = (cx: number, cz: number) => cx * 100003 + cz;

  bounded.forEach((entry, index) => {
    for (let cx = cell(entry.minX); cx <= cell(entry.maxX); cx += 1) {
      for (let cz = cell(entry.minZ); cz <= cell(entry.maxZ); cz += 1) {
        const bucket = grid.get(key(cx, cz));
        if (bucket) bucket.push(index);
        else grid.set(key(cx, cz), [index]);
      }
    }
  });

  function at(x: number, z: number): Area | null {
    const bucket = grid.get(key(cell(x), cell(z)));
    if (!bucket) return null;

    for (const index of bucket) {
      const entry = bounded[index]!;
      // Bounding box first: most candidates fail here for the cost of four
      // comparisons, rather than a walk around a hundred-vertex boundary.
      if (x < entry.minX || x > entry.maxX || z < entry.minZ || z > entry.maxZ) continue;
      if (inRing(x, z, entry.area.points)) return entry.area;
    }
    return null;
  }

  function covers(x: number, z: number, kind: AreaKind): boolean {
    const bucket = grid.get(key(cell(x), cell(z)));
    if (!bucket) return false;
    for (const index of bucket) {
      const entry = bounded[index]!;
      if (entry.area.kind !== kind) continue;
      if (x < entry.minX || x > entry.maxX || z < entry.minZ || z > entry.maxZ) continue;
      if (inRing(x, z, entry.area.points)) return true;
    }
    return false;
  }

  const anyInside = (points: readonly (readonly [number, number])[]) =>
    points.some(([x, z]) => at(x, z) !== null);

  return { at, covers, anyInside, count: areas.length };
}

/**
 * Points covering a footprint, turned by `yaw`, in world coordinates.
 *
 * A grid rather than just the corners. Corners alone are enough to catch a
 * building reaching *into* a park, but not one large enough to sit right over
 * a small one: with a 46 m frontage and a tennis court's worth of grass, every
 * corner can be outside while the middle is not.
 */
export function footprintSamples(
  x: number,
  z: number,
  width: number,
  depth: number,
  yaw: number,
  step = 8,
): [number, number][] {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  // An even number of divisions each way, so the grid always has a point on
  // the centre. With an odd count there is none, and a park smaller than the
  // step can sit in the hole in the middle of a building and go unnoticed.
  const even = (span: number) => Math.max(2, 2 * Math.ceil(span / (2 * step)));
  const across = even(width);
  const back = even(depth);

  const points: [number, number][] = [];
  for (let i = 0; i <= across; i += 1) {
    for (let j = 0; j <= back; j += 1) {
      const dx = (i / across - 0.5) * width;
      const dz = (j / back - 0.5) * depth;
      // Matching the collider's yaw convention, which is Three.js's rotation.y.
      points.push([x + dx * cos + dz * sin, z - dx * sin + dz * cos]);
    }
  }
  return points;
}
