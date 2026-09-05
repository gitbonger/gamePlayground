/**
 * City layout as plain data.
 *
 * Kept separate from the meshes so the exact world the player flies through can
 * be generated and collision-tested in Node, without a WebGL context.
 */

import { aabb, type Box } from '../sim/collision';
import type { Rail, Road } from './streets';
import type { Train } from './train';
import type { Area } from './areas';

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
}

/**
 * A described thing, placed before the city is generated around it.
 *
 * Everything else in the world is worked out from the map: where the streets
 * run, so where the blocks are, so where the houses and the trees go. A
 * landmark is the other way round -- it is written down, put in place first,
 * and the generation avoids it. That is what makes it something a level can
 * name and rely on: the loft is a particular building at a particular
 * coordinate rather than whichever house happened to come out nearest.
 *
 * A patch of concrete is the same idea lying flat. Zero height means nothing
 * to fly into and nothing to land on that is not the ground, but it is still
 * reserved ground and still something a level can point at.
 */
export interface Landmark {
  /** What levels call it. */
  name: string;
  /** Where it stands, in local metres. */
  x: number;
  z: number;
  /** Its footprint: along it and across it. */
  width: number;
  depth: number;
  /** How tall. Zero for something flat. */
  height: number;
  /** Which way it faces, in the collider's yaw convention. */
  yaw?: number;
  /**
   * Clear ground kept around it, in metres.
   *
   * So that a landmark is a landmark rather than something wedged between
   * two houses -- and, for a flat one, so that the approach to it is not
   * through a wood.
   */
  margin?: number;
}

export interface Tree {
  x: number;
  z: number;
  radius: number;
  height: number;
  /**
   * Which sort of tree it is, as an index into the renderer's list.
   *
   * A fact about the tree rather than about how it is drawn, so it is decided
   * here with everything else about it, and stays the same run to run because
   * it comes off the same seeded stream as its size and its place.
   */
  species: number;
}

/**
 * How many sorts there are.
 *
 * Named here because the layout picks one and the renderer draws it, and the
 * two have to agree about how many there are to pick from. The renderer keeps
 * the shapes; this is only the count.
 */
export const SPECIES = 4;

export interface CityLayout {
  buildings: Building[];
  trees: Tree[];
  /** Described things, placed before the rest and avoided by it. */
  landmarks: Landmark[];
  /** Solid volumes for every object above, in simulation coordinates. */
  boxes: Box[];
  /** Streets to draw, when the world was built from a real map. */
  roads?: Road[];
  /** Surface railway to draw: heavy rail and tram. */
  rails?: Rail[];
  /** Trains standing on it. */
  trains?: Train[];
  /** Parks, woods and water to draw. */
  areas?: Area[];
}

/** How much tighter a tree's collision box is than its visible cone. */
const TRUNK_FRACTION = 0.7;

export function generateCityLayout(options: WorldOptions = defaultWorldOptions): CityLayout {
  const rand = mulberry32(options.seed);
  // One sort for the whole of it. This layout has no blocks to plant by, and
  // scattering four sorts through one wood is the noise that having sorts at
  // all was meant to avoid.
  const species = Math.floor(rand() * SPECIES);
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

    trees.push({ x, z, radius, height, species });

    // Boxed tighter than the cone's base, so clipping a leafy edge does not
    // read as hitting a wall.
    const trunk = radius * TRUNK_FRACTION;
    boxes.push(aabb(x - trunk, 0, z - trunk, x + trunk, height, z + trunk));
  }

  // No landmarks: this layout describes nothing, it only generates.
  return { buildings, trees, landmarks: [], boxes };
}
