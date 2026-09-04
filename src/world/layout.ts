/**
 * City layout as plain data.
 *
 * Kept separate from the meshes so the exact world the player flies through can
 * be generated and collision-tested in Node, without a WebGL context.
 */

import { aabb, type Box } from '../sim/collision';
import type { Road } from './streets';

/** Small deterministic PRNG, so the same seed always builds the same city. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface WorldOptions {
  seed: number;
  /** Half-width of the built-up area in metres. */
  extent: number;
  buildingCount: number;
  treeCount: number;
}

export const defaultWorldOptions: WorldOptions = {
  seed: 7,
  extent: 900,
  buildingCount: 900,
  treeCount: 500,
};

export interface Building {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  /** Rotation about the vertical axis, radians. Zero for the procedural city. */
  yaw?: number;
  /** The landmark the pigeon is homing on. At most one building has this. */
  isTarget?: boolean;
}

export interface Tree {
  x: number;
  z: number;
  radius: number;
  height: number;
}

export interface CityLayout {
  buildings: Building[];
  trees: Tree[];
  /** Solid volumes for every object above, in simulation coordinates. */
  boxes: Box[];
  /** Streets to draw, when the world was built from a real map. */
  roads?: Road[];
}

/** How much tighter a tree's collision box is than its visible cone. */
const TRUNK_FRACTION = 0.7;

export function generateCityLayout(options: WorldOptions = defaultWorldOptions): CityLayout {
  const rand = mulberry32(options.seed);
  const buildings: Building[] = [];
  const trees: Tree[] = [];
  const boxes: Box[] = [];

  for (let i = 0; i < options.buildingCount; i++) {
    const x = (rand() * 2 - 1) * options.extent;
    const z = (rand() * 2 - 1) * options.extent;

    // Taller towers cluster toward the middle, so the skyline has a centre.
    const distance = Math.hypot(x, z) / options.extent;
    const centreBias = Math.max(0, 1 - distance);
    const height = 8 + rand() * 22 + centreBias * centreBias * (30 + rand() * 90);
    const width = 8 + rand() * 16;
    const depth = 8 + rand() * 16;

    buildings.push({ x, z, width, depth, height });
    boxes.push(aabb(x - width / 2, 0, z - depth / 2, x + width / 2, height, z + depth / 2));
  }

  for (let i = 0; i < options.treeCount; i++) {
    const x = (rand() * 2 - 1) * options.extent * 1.9;
    const z = (rand() * 2 - 1) * options.extent * 1.9;
    const height = 6 + rand() * 9;
    const radius = 2.5 + rand() * 2;

    trees.push({ x, z, radius, height });

    // Boxed tighter than the cone's base, so clipping a leafy edge does not
    // read as hitting a wall.
    const trunk = radius * TRUNK_FRACTION;
    boxes.push(aabb(x - trunk, 0, z - trunk, x + trunk, height, z + trunk));
  }

  return { buildings, trees, boxes };
}
