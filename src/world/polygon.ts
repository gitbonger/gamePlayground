/**
 * Polygon arithmetic in the (x, z) ground plane.
 *
 * Shared by the two things in this world that are rings: the map's own areas,
 * which arrive as closed ways, and the city blocks the street network encloses.
 */

export type Point2 = [number, number];

/**
 * Signed area, positive when the ring winds counter-clockwise.
 *
 * The sign is the useful part. Tracing the faces of the street graph produces
 * the outer, unbounded face alongside the real blocks, drawn the other way
 * round and otherwise indistinguishable from them.
 */
export function polygonArea(points: readonly Point2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x0, z0] = points[i]!;
    const [x1, z1] = points[(i + 1) % points.length]!;
    sum += x0 * z1 - x1 * z0;
  }
  return sum / 2;
}

/** Ray casting, counting boundary crossings to the right of the point. */
export function pointInPolygon(x: number, z: number, points: readonly Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, zi] = points[i]!;
    const [xj, zj] = points[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Area-weighted centroid, which for a block is roughly its courtyard. */
export function polygonCentroid(points: readonly Point2[]): Point2 {
  let twiceArea = 0;
  let x = 0;
  let z = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x0, z0] = points[i]!;
    const [x1, z1] = points[(i + 1) % points.length]!;
    const cross = x0 * z1 - x1 * z0;
    twiceArea += cross;
    x += (x0 + x1) * cross;
    z += (z0 + z1) * cross;
  }
  // A ring of zero area has no centroid worth the name; fall back to the mean.
  if (Math.abs(twiceArea) < 1e-9) {
    const n = points.length || 1;
    return [
      points.reduce((sum, p) => sum + p[0], 0) / n,
      points.reduce((sum, p) => sum + p[1], 0) / n,
    ];
  }
  return [x / (3 * twiceArea), z / (3 * twiceArea)];
}

/** Distance from a point to the nearest edge of the ring. */
export function distanceToEdges(x: number, z: number, points: readonly Point2[]): number {
  let best = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const [x0, z0] = points[i]!;
    const [x1, z1] = points[(i + 1) % points.length]!;
    const dx = x1 - x0;
    const dz = z1 - z0;
    const lengthSquared = dx * dx + dz * dz;
    const t =
      lengthSquared < 1e-12
        ? 0
        : Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / lengthSquared));
    best = Math.min(best, Math.hypot(x - (x0 + t * dx), z - (z0 + t * dz)));
  }
  return best;
}

/** Consecutive duplicates removed, which the inset cannot take a direction from. */
export function tidyRing(points: readonly Point2[], epsilon = 1e-6): Point2[] {
  const out: Point2[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < epsilon) continue;
    out.push([point[0], point[1]]);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first && last && Math.hypot(first[0] - last[0], first[1] - last[1]) < epsilon) {
    out.pop();
  }
  return out;
}

/**
 * The ring moved inward, by `distance` metres, or by a distance per edge.
 *
 * Every edge slides along its own inward normal, and the new corners are where
 * neighbouring edges -- having moved -- now cross. That keeps each wall exactly
 * parallel to the street it fronts, which moving the *corners* inward would
 * not: a sharp corner would pull its two walls away from their streets.
 *
 * Inset far enough and a ring turns itself inside out. Callers are expected to
 * check the area afterwards rather than have a wrong answer hidden from them.
 */
export function insetPolygon(
  points: readonly Point2[],
  distance: number | readonly number[],
  miterLimit = 3,
): Point2[] {
  const ring = tidyRing(points);
  const n = ring.length;
  if (n < 3) return [];

  const distanceAt = (i: number) => (typeof distance === 'number' ? distance : (distance[i] ?? 0));

  const lines = ring.map((point, i) => {
    const [x0, z0] = point;
    const [x1, z1] = ring[(i + 1) % n]!;
    const length = Math.hypot(x1 - x0, z1 - z0);
    const ux = (x1 - x0) / length;
    const uz = (z1 - z0) / length;
    // The interior is to the left of every edge of a counter-clockwise ring.
    const away = distanceAt(i);
    return { px: x0 - uz * away, pz: z0 + ux * away, ux, uz };
  });

  return lines.map((b, i) => {
    const a = lines[(i + n - 1) % n]!;
    const cross = a.ux * b.uz - a.uz * b.ux;
    // Straight through, or doubled back: there is no corner to place.
    if (Math.abs(cross) < 1e-9) return [b.px, b.pz] as Point2;

    const t = ((b.px - a.px) * b.uz - (b.pz - a.pz) * b.ux) / cross;
    const mx = a.px + a.ux * t;
    const mz = a.pz + a.uz * t;

    // A sharp corner sends the crossing point away towards infinity: as the
    // angle closes, two edges that have each moved a few metres meet a long
    // way from where they started. Left alone that flings a corner clean
    // outside the ring being shrunk. Cutting it off is what a builder would do
    // with the corner anyway.
    const away = Math.hypot(mx - b.px, mz - b.pz);
    const cap = miterLimit * Math.max(1e-6, Math.abs(distanceAt(i)));
    if (away <= cap) return [mx, mz] as Point2;
    return [b.px + ((mx - b.px) / away) * cap, b.pz + ((mz - b.pz) / away) * cap] as Point2;
  });
}

/**
 * `insetPolygon`, but refusing to return a shape it does not believe.
 *
 * Offsetting a ring inward is only well defined until the walls meet: past
 * that, edges cross each other and the result reads as a valid polygon while
 * describing ground that is nowhere near the original. Silently, too -- the
 * shoelace area of a ring turned inside out is a perfectly ordinary number.
 * Everything here is a check that the answer is still the same shape, smaller.
 */
export function shrinkRing(
  points: readonly Point2[],
  distance: number | readonly number[],
): Point2[] {
  const source = tidyRing(points);
  if (source.length < 3) return [];
  const sourceArea = polygonArea(source);
  if (sourceArea <= 0) return [];

  let ring = source;
  let gaps =
    typeof distance === 'number'
      ? source.map(() => distance)
      : source.map((_, i) => distance[i] ?? 0);

  // Edges disappear as a ring shrinks, and a vanished edge is not a failure.
  // Pull the sides of a wedge inward and its short end closes up long before
  // the long sides have gone anywhere; on a real block that is any corner cut
  // off at an angle. So an edge that has turned round is dropped and the
  // remaining ones re-fitted, which is what the shape actually does.
  for (let pass = 0; pass < 8 && ring.length >= 3; pass += 1) {
    const inset = insetPolygon(ring, gaps);
    // The inset tidies as it goes, and dropping a corner can leave two of the
    // remaining ones on the same spot. Without a ring to put edge for edge
    // against there is nothing to judge, so give up rather than read past the
    // end of it.
    if (inset.length !== ring.length) return [];

    const turned = new Set<number>();
    for (let i = 0; i < ring.length; i += 1) {
      const j = (i + 1) % ring.length;
      const wasX = ring[j]![0] - ring[i]![0];
      const wasZ = ring[j]![1] - ring[i]![1];
      const nowX = inset[j]![0] - inset[i]![0];
      const nowZ = inset[j]![1] - inset[i]![1];
      if (wasX * nowX + wasZ * nowZ < 0) turned.add(i);
    }

    if (turned.size === 0) {
      const shrunk = tidyRing(inset);
      if (shrunk.length < 3) return [];
      const area = polygonArea(shrunk);
      // Wound the same way, smaller than what it came from, and every corner
      // still standing on it. Inset a 100 m square by 80 m and the offset
      // lines cross on the far side of each other: what comes back is a tidy
      // 60 m square, wound the right way and comfortably inside the original,
      // describing ground the inset has no business claiming. Only the edge
      // directions give that away, which is why they are checked first.
      if (area <= 0 || area >= sourceArea) return [];
      return shrunk.every(([x, z]) => pointInPolygon(x, z, source)) ? shrunk : [];
    }

    // Drop the near end of each edge that turned, so it merges into the edge
    // before it and that edge's own distance carries across the join.
    const keptRing: Point2[] = [];
    const keptGaps: number[] = [];
    for (let i = 0; i < ring.length; i += 1) {
      if (turned.has(i)) continue;
      keptRing.push(ring[i]!);
      keptGaps.push(gaps[i]!);
    }
    ring = keptRing;
    gaps = keptGaps;
  }

  return [];
}
