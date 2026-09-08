/**
 * Building footprints, and the boxes the simulation needs from them.
 *
 * The map gives a building as a ring of ten or twenty points, and that ring is
 * what gets drawn: a real footprint, with its notch in the corner and its
 * courtyard arm, rather than the rectangle that covers it. What the *physics*
 * wants is different -- the collider is boxes, and boxes are what make it
 * cheap -- so the ring is also reduced to a box, or to a ring of wings where
 * one box will not do.
 *
 * Both come from the outline, here, so they cannot disagree about where a
 * building is. This used to live in the fetch script, which baked the boxes
 * and threw the outlines away; the outlines are baked now and the boxes are
 * worked out on the way in.
 */


/**
 * A footprint: points as `[x, z]`, open, and read-only.
 *
 * Read-only because everything here is a measurement of a ring rather than a
 * change to one, and the rings themselves come off a baked map that several
 * things share.
 */
export type Ring = readonly (readonly number[])[];

/**
 * The smallest turned rectangle that covers a footprint.
 *
 * A building in the game is `{ x, z, width, depth, yaw }` -- a box on the
 * ground with a turn -- and a building in OpenStreetMap is a ring of ten or
 * twenty points. Rather than teach the game about polygons, the ring is
 * reduced to the box that best covers it, here, once, at bake time.
 *
 * That is a real loss and it is the right one. What it keeps is the thing
 * worth having: where the building actually is, which way it actually faces,
 * and how big it actually is. What it loses is the notch in the corner, and
 * nobody flying over a city at fifty metres has ever seen a notch. A block of
 * these is still a ring of buildings round a courtyard, because the real ones
 * are a ring of buildings round a courtyard.
 *
 * Rotating calipers, in the cheap form: the best rectangle shares an edge with
 * the hull, so every edge is tried and the smallest area wins. The rings here
 * are a dozen points, so trying all of them is nothing.
 */
export function orientedBox(
  ring: Ring,
): { x: number; z: number; width: number; depth: number; yaw: number } | null {
  if (ring.length < 3) return null;

  let best: { area: number; yaw: number; cx: number; cz: number; w: number; d: number } | null =
    null;

  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const dx = b[0]! - a[0]!;
    const dz = b[1]! - a[1]!;
    if (Math.hypot(dx, dz) < 1e-6) continue;

    // The turn that puts this edge along the box's own X axis. The game's
    // convention -- Three.js's rotation.y, which `footprintSamples` and the
    // collider both follow -- takes a local (dx, dz) to
    // (x + dx*cos + dz*sin, z - dx*sin + dz*cos), so going the other way is
    // this.
    const yaw = Math.atan2(-dz, dx);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of ring) {
      const lx = p[0]! * cos - p[1]! * sin;
      const lz = p[0]! * sin + p[1]! * cos;
      if (lx < minX) minX = lx;
      if (lx > maxX) maxX = lx;
      if (lz < minZ) minZ = lz;
      if (lz > maxZ) maxZ = lz;
    }

    const w = maxX - minX;
    const d = maxZ - minZ;
    const area = w * d;
    if (!best || area < best.area) {
      // Back out of the box's frame into the world.
      const lx = (minX + maxX) / 2;
      const lz = (minZ + maxZ) / 2;
      best = { area, yaw, w, d, cx: lx * cos + lz * sin, cz: -lx * sin + lz * cos };
    }
  }

  if (!best) return null;
  return { x: best.cx, z: best.cz, width: best.w, depth: best.d, yaw: best.yaw };
}

/** Twice the signed area of a ring: positive or negative says which way round. */
export function shoelace(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    sum += a[0]! * b[1]! - b[0]! * a[1]!;
  }
  return sum;
}

/** Whether a point is inside a ring, by the crossing count. */
export function inside(x: number, z: number, ring: Ring): boolean {
  let within = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (
      a[1]! > z !== b[1]! > z &&
      x < ((b[0]! - a[0]!) * (z - a[1]!)) / (b[1]! - a[1]!) + a[0]!
    ) {
      within = !within;
    }
  }
  return within;
}

/** How deep a wing of a courtyard block is, in metres. */
const WING = 12;

/**
 * A footprint as one box, or as a ring of wings when one box will not do.
 *
 * The box is the right answer for the great majority: a building is a
 * rectangle, near enough, and reducing it to one is what keeps this map to a
 * size a browser will download. It is the wrong answer for two shapes, and
 * this district is full of both -- the L, and the closed courtyard block whose
 * outline goes all the way round a hole.
 *
 * Reduced to one box, a courtyard block becomes a solid slab the size of the
 * whole block. Measured over this map, taking the box every time put fifty
 * percent of the ground under a building, which is roughly twice what a dense
 * European district actually is, and it filled in every courtyard in
 * Józsefváros -- which is the one thing about the place worth having.
 *
 * So the fit is checked. Where the box covers much more than the outline
 * encloses, the shape is a ring or an L, and what is emitted instead is a wing
 * along each side of it: exactly what the generator invents for a block, only
 * now standing where the real building stands.
 */
export function fitBoxes(
  ring: Ring,
): { x: number; z: number; width: number; depth: number; yaw: number }[] {
  const box = orientedBox(ring);
  if (!box) return [];

  const enclosed = Math.abs(shoelace(ring)) / 2;
  // A rectangle scores 1. Anything up to about a half again is a building with
  // a bay or a chamfered corner, and the box is still the honest answer.
  if (enclosed > 0 && box.width * box.depth <= enclosed * 1.55) return [box];

  // Otherwise, wings. Which side of each edge is *into* the shape is asked
  // rather than worked out from the winding: a step inward from the middle of
  // the edge either lands inside the outline or it does not, and that is a
  // question with an answer.
  const wings: { x: number; z: number; width: number; depth: number; yaw: number }[] = [];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const run = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
    if (run < 7) continue;

    const ux = (b[0]! - a[0]!) / run;
    const uz = (b[1]! - a[1]!) / run;
    const midX = (a[0]! + b[0]!) / 2;
    const midZ = (a[1]! + b[1]!) / 2;

    let nx = -uz;
    let nz = ux;
    if (!inside(midX + nx * 0.5, midZ + nz * 0.5, ring)) {
      nx = -nx;
      nz = -nz;
    }
    // Still not inside either way: a sliver too thin to have an inside.
    if (!inside(midX + nx * 0.5, midZ + nz * 0.5, ring)) continue;

    wings.push({
      x: midX + nx * (WING / 2),
      z: midZ + nz * (WING / 2),
      width: run,
      depth: WING,
      yaw: Math.atan2(-uz, ux),
    });
  }

  // A shape that produced no usable wing is better as its box than as nothing.
  return wings.length > 0 ? wings : [box];
}

/**
 * A footprint pulled inwards, for the roof that sits on it.
 *
 * A pitched roof on a rectangle is easy and a pitched roof on an arbitrary
 * polygon is the straight skeleton, which is a real algorithm with real
 * failure cases. This is the cheap version of the same idea and it is what a
 * hipped roof actually is: every wall leans in at the same slope, so the ridge
 * is the outline moved inwards by however far the roof rises divided by how
 * steeply it climbs.
 *
 * It gets the shapes this district is made of right, which is the point: the
 * inset of an L is an L and the inset of a courtyard wing is a courtyard wing,
 * so each arm keeps its own ridge instead of the whole block growing one tent.
 *
 * Returns null where the shape is too thin to inset -- a wing narrower than
 * twice the reach has no middle left, and the honest answer there is a flat
 * roof rather than a knot.
 */
function insetOnce(ring: Ring, reach: number): number[][] | null {
  if (ring.length < 3 || reach <= 0) return null;

  // Which way round it goes, so "inwards" means inwards.
  const hand = shoelace(ring) > 0 ? 1 : -1;

  const pulled: number[][] = [];
  for (let i = 0; i < ring.length; i += 1) {
    const before = ring[(i + ring.length - 1) % ring.length]!;
    const here = ring[i]!;
    const after = ring[(i + 1) % ring.length]!;

    const into = (a: readonly number[], b: readonly number[]) => {
      const dx = b[0]! - a[0]!;
      const dz = b[1]! - a[1]!;
      const length = Math.hypot(dx, dz);
      if (length < 1e-9) return null;
      // The inward normal of the edge a->b, for this winding.
      return [(-dz / length) * hand, (dx / length) * hand];
    };

    const back = into(before, here);
    const on = into(here, after);
    if (!back || !on) return null;

    // The bisector, scaled so both walls end up `reach` in. Where the two
    // walls nearly double back on each other the scale runs away, which is a
    // spike the roof cannot have, so it is capped.
    const bx = back[0]! + on[0]!;
    const bz = back[1]! + on[1]!;
    const grip = 1 + (back[0]! * on[0]! + back[1]! * on[1]!);
    if (grip < 1e-6) return null;
    const scale = Math.min(reach / grip, reach * 4);
    pulled.push([here[0]! + bx * scale, here[1]! + bz * scale]);
  }

  // Did it turn itself inside out? An inset that has flipped an edge has
  // eaten through the shape, and the roof it would make is a knot.
  for (let i = 0; i < ring.length; i += 1) {
    const j = (i + 1) % ring.length;
    const wasX = ring[j]![0]! - ring[i]![0]!;
    const wasZ = ring[j]![1]! - ring[i]![1]!;
    const nowX = pulled[j]![0]! - pulled[i]![0]!;
    const nowZ = pulled[j]![1]! - pulled[i]![1]!;
    if (wasX * nowX + wasZ * nowZ < 0) return null;
  }
  // And it must still enclose something, wound the same way it started.
  const area = shoelace(pulled);
  if (Math.abs(area) < 1 || Math.sign(area) !== Math.sign(shoelace(ring))) {
    return null;
  }

  // And it must not have crossed itself, which is the failure the two checks
  // above do not catch: on a concave shape an inset wall can walk clean
  // through a wall it is not adjacent to without any edge reversing or the
  // area changing sign. Measured before this was here, 1,136 of the nine
  // thousand insets on this map were knots, and the triangulator handed back
  // caps up to two hundred times the area of the building -- great orange
  // sheets lying across the district.
  if (crossesItself(pulled)) return null;

  return pulled;
}

/** Does any pair of a ring's non-adjacent edges cross? */
function crossesItself(ring: Ring): boolean {
  const side = (o: readonly number[], a: readonly number[], b: readonly number[]) =>
    Math.sign((a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!));

  for (let i = 0; i < ring.length; i += 1) {
    const a0 = ring[i]!;
    const a1 = ring[(i + 1) % ring.length]!;
    for (let j = i + 2; j < ring.length; j += 1) {
      // The first and last edges share a corner, so they are adjacent too.
      if (i === 0 && j === ring.length - 1) continue;
      const b0 = ring[j]!;
      const b1 = ring[(j + 1) % ring.length]!;
      if (
        side(a0, a1, b0) !== side(a0, a1, b1) &&
        side(b0, b1, a0) !== side(b0, b1, a1)
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * The most a footprint can be pulled in, up to what was asked for.
 *
 * The plain inset fails on exactly the shape this district is made of. A wing
 * twelve metres deep with a roof that wants to come in six from either side
 * meets itself in the middle: the ridge of a pitched roof is the inset that
 * has just collapsed, and asking for a polygon there gets nothing back.
 *
 * Returning nothing was wrong in the common case rather than the rare one --
 * every narrow wing in Jozsefvaros lost its roof and went flat. So where the
 * asked-for inset will not stand up, this finds the largest one that will,
 * which for a rectangle is a ridge with a strip along it too thin to see, and
 * for an L is the same at each arm.
 */
export function insetRing(ring: Ring, reach: number): number[][] | null {
  const wanted = insetOnce(ring, reach);
  if (wanted) return wanted;

  // Six halvings, which lands within a couple of per cent of the most the
  // shape will take -- a flat strip a few centimetres across on a ridge that
  // should have none.
  let low = 0;
  let high = reach;
  let best: number[][] | null = null;
  for (let step = 0; step < 6; step += 1) {
    const middle = (low + high) / 2;
    const tried = insetOnce(ring, middle);
    if (tried) {
      best = tried;
      low = middle;
    } else {
      high = middle;
    }
  }
  return best;
}
