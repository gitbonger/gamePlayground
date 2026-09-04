/**
 * Swept collision against axis-aligned boxes.
 *
 * The bird moves up to about 0.5 m per tick, which is small next to a building
 * but not small next to a tree, so this sweeps the movement segment rather than
 * testing the end point. A uniform grid over the XZ plane keeps the broad phase
 * to a handful of candidates regardless of how big the world gets.
 */

import { dot, vec, type Vec3 } from './math3';

export interface Aabb {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/**
 * A solid box, optionally turned about the vertical axis through its centre.
 *
 * The extents are the box's own, before the turn. Buildings lining a diagonal
 * street want to face it, and squaring them off to the world axes instead
 * would inflate a 12 m building's footprint by 40% at 45 degrees -- felt as
 * invisible walls while threading between them.
 */
export interface Box extends Aabb {
  /** Radians about Y. Absent or zero means the extents are the solid. */
  yaw?: number;
}

export interface SweepHit {
  /** Fraction along the swept segment where contact happens, 0..1. */
  t: number;
  /** Contact point. */
  point: Vec3;
  /** Unit surface normal, pointing back toward the mover. */
  normal: Vec3;
}

export interface Collider {
  /** Sweep a sphere of `radius` from `from` to `to`; nearest hit or null. */
  sweep(from: Vec3, to: Vec3, radius: number): SweepHit | null;
  /** Height of the tallest box overlapping this column, or -Infinity. */
  heightAt(x: number, z: number): number;
  readonly boxCount: number;
}

/**
 * Turn a point about the vertical axis through (cx, cz).
 *
 * `angle` follows Three.js's `rotation.y`, so a box's yaw means the same thing
 * to the collider as it does to the mesh drawn for it.
 */
function turnAbout(x: number, z: number, cx: number, cz: number, angle: number): [number, number] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = x - cx;
  const dz = z - cz;
  return [cx + dx * cos + dz * sin, cz - dx * sin + dz * cos];
}

export function aabb(
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): Aabb {
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

/** A box centred on the ground at (x, z), turned by `yaw`. */
export function turnedBox(
  x: number,
  z: number,
  width: number,
  height: number,
  depth: number,
  yaw: number,
): Box {
  return {
    minX: x - width / 2,
    minY: 0,
    minZ: z - depth / 2,
    maxX: x + width / 2,
    maxY: height,
    maxZ: z + depth / 2,
    yaw,
  };
}

/** World-aligned bounds of a box, wide enough to contain it however it turns. */
export function worldBounds(box: Box): Aabb {
  if (!box.yaw) return box;

  const halfX = (box.maxX - box.minX) / 2;
  const halfZ = (box.maxZ - box.minZ) / 2;
  const cos = Math.abs(Math.cos(box.yaw));
  const sin = Math.abs(Math.sin(box.yaw));
  const spanX = halfX * cos + halfZ * sin;
  const spanZ = halfX * sin + halfZ * cos;
  const centreX = (box.minX + box.maxX) / 2;
  const centreZ = (box.minZ + box.maxZ) / 2;

  return aabb(centreX - spanX, box.minY, centreZ - spanZ, centreX + spanX, box.maxY, centreZ + spanZ);
}

/** Grid cell size in metres. Comfortably larger than a typical building. */
const CELL_SIZE = 32;
/** Cell coordinates are packed into one integer; this bounds the world. */
const GRID_OFFSET = 512;
const GRID_STRIDE = 1024;

const cellKey = (cx: number, cz: number) =>
  (cx + GRID_OFFSET) * GRID_STRIDE + (cz + GRID_OFFSET);

export function createColliderField(boxes: readonly Box[]): Collider {
  // Broad phase works on world bounds; the narrow phase knows about the turn.
  const bounds = boxes.map(worldBounds);
  const grid = new Map<number, number[]>();

  const toCell = (v: number) =>
    Math.max(-GRID_OFFSET, Math.min(GRID_OFFSET - 1, Math.floor(v / CELL_SIZE)));

  bounds.forEach((box, index) => {
    const x0 = toCell(box.minX);
    const x1 = toCell(box.maxX);
    const z0 = toCell(box.minZ);
    const z1 = toCell(box.maxZ);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const key = cellKey(cx, cz);
        const bucket = grid.get(key);
        if (bucket) bucket.push(index);
        else grid.set(key, [index]);
      }
    }
  });

  // Marks which boxes a given query has already considered, so a box spanning
  // several cells is only tested once. Cheaper than allocating a Set per query.
  const seen = new Int32Array(boxes.length).fill(-1);
  let queryId = 0;

  function sweep(from: Vec3, to: Vec3, radius: number): SweepHit | null {
    const id = queryId++;

    // Cells touched by the movement's XZ bounding box, grown by the radius.
    const x0 = toCell(Math.min(from.x, to.x) - radius);
    const x1 = toCell(Math.max(from.x, to.x) + radius);
    const z0 = toCell(Math.min(from.z, to.z) - radius);
    const z1 = toCell(Math.max(from.z, to.z) + radius);

    const delta = vec(to.x - from.x, to.y - from.y, to.z - from.z);
    let best: SweepHit | null = null;

    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const bucket = grid.get(cellKey(cx, cz));
        if (!bucket) continue;

        for (const index of bucket) {
          if (seen[index] === id) continue;
          seen[index] = id;

          const hit = sweepBox(from, delta, radius, boxes[index]!);
          if (hit && (!best || hit.t < best.t)) best = hit;
        }
      }
    }

    return best;
  }

  function heightAt(x: number, z: number): number {
    const bucket = grid.get(cellKey(toCell(x), toCell(z)));
    if (!bucket) return -Infinity;

    let highest = -Infinity;
    for (const index of bucket) {
      const box = bounds[index]!;
      if (x < box.minX || x > box.maxX || z < box.minZ || z > box.maxZ) continue;
      if (box.maxY > highest) highest = box.maxY;
    }
    return highest;
  }

  return { sweep, heightAt, boxCount: boxes.length };
}

/**
 * Segment against an AABB grown by `radius` on every axis — the Minkowski sum
 * of the box and the sphere, approximated with a box. That rounds the corners
 * off slightly in the mover's favour, which is invisible at these speeds and
 * much cheaper than the exact rounded-box test.
 */
export function sweepBox(
  from: Vec3,
  delta: Vec3,
  radius: number,
  box: Box,
): SweepHit | null {
  // A turned box is the same problem seen from a different angle: rotate the
  // sweep into the box's own frame, run the identical slab test, and rotate
  // the answer back. Exact, and it reuses the tested path rather than adding
  // a second one.
  if (box.yaw) {
    const centreX = (box.minX + box.maxX) / 2;
    const centreZ = (box.minZ + box.maxZ) / 2;
    const [localX, localZ] = turnAbout(from.x, from.z, centreX, centreZ, -box.yaw);
    const [tipX, tipZ] = turnAbout(
      from.x + delta.x,
      from.z + delta.z,
      centreX,
      centreZ,
      -box.yaw,
    );

    const hit = sweepBox(
      vec(localX, from.y, localZ),
      vec(tipX - localX, delta.y, tipZ - localZ),
      radius,
      { ...box, yaw: 0 },
    );
    if (!hit) return null;

    const [normalX, normalZ] = turnAbout(hit.normal.x, hit.normal.z, 0, 0, box.yaw);
    return {
      t: hit.t,
      // The contact point is easier to recover from the original sweep than to
      // rotate back, and is exact either way.
      point: vec(from.x + delta.x * hit.t, from.y + delta.y * hit.t, from.z + delta.z * hit.t),
      normal: vec(normalX, hit.normal.y, normalZ),
    };
  }

  const min = [box.minX - radius, box.minY - radius, box.minZ - radius];
  const max = [box.maxX + radius, box.maxY + radius, box.maxZ + radius];
  const origin = [from.x, from.y, from.z];
  const direction = [delta.x, delta.y, delta.z];

  let entry = 0;
  let exit = 1;
  let entryAxis = -1;
  let entrySign = 0;

  for (let axis = 0; axis < 3; axis++) {
    const d = direction[axis]!;
    const p = origin[axis]!;

    if (Math.abs(d) < 1e-9) {
      // Parallel to this slab: either always inside it, or never touching.
      if (p < min[axis]! || p > max[axis]!) return null;
      continue;
    }

    let near = (min[axis]! - p) / d;
    let far = (max[axis]! - p) / d;
    let sign = -1;
    if (near > far) {
      [near, far] = [far, near];
      sign = 1;
    }

    if (near > entry) {
      entry = near;
      entryAxis = axis;
      entrySign = sign;
    }
    if (far < exit) exit = far;
    if (entry > exit) return null;
  }

  // Started already overlapping: no meaningful entry face to report.
  if (entryAxis < 0) return null;

  const normal = vec(
    entryAxis === 0 ? entrySign : 0,
    entryAxis === 1 ? entrySign : 0,
    entryAxis === 2 ? entrySign : 0,
  );

  return {
    t: entry,
    point: vec(
      from.x + delta.x * entry,
      from.y + delta.y * entry,
      from.z + delta.z * entry,
    ),
    normal,
  };
}

/** Speed at which a mover is closing on a surface, in m/s. Negative if moving away. */
export const closingSpeed = (velocity: Vec3, normal: Vec3): number => -dot(velocity, normal);
