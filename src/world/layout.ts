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
 * A taller part over one end of a landmark, leaving the rest as a terrace.
 *
 * This is the whole of what makes a block of flats a place rather than a box:
 * the flat top is at two levels, the lower one is open, and the upper one
 * looks out over it. Both halves are the same building and flash together --
 * it is one thing with a shape, not two things standing next to each other.
 */
export interface Penthouse {
  /**
   * How much of the length it takes, as a fraction, measured from the far
   * end. A half is a half.
   */
  cover: number;
  /** How much higher than the terrace it stands, in metres. */
  rise: number;
}

/**
 * Bushes standing in rows on a terrace.
 *
 * Rows run the length of the terrace and are spaced symmetrically about its
 * centre line, outermost first, which leaves the middle of it clear. That is
 * not decoration of the arithmetic: the middle is where the arrow points,
 * where a bird comes down and where the pigeon waiting for it stands, so it
 * is the one part of a terrace that must stay walkable.
 */
export interface Planting {
  /** How many rows. */
  rows: number;
  /** How many bushes in each. */
  perRow: number;
  /** How wide each one is. */
  radius: number;
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
  /**
   * How high its flat top is. Zero for something lying on the ground.
   *
   * With a penthouse this is the *terrace* -- the lower of the two levels,
   * and the one that is walked on. What stands above it is described by the
   * penthouse rather than by this.
   */
  height: number;
  /** Which way it faces, in the collider's yaw convention. */
  yaw?: number;
  /** A taller part over one end, if it has one. */
  penthouse?: Penthouse;
  /** What is planted on the terrace, if anything. */
  planting?: Planting;
  /**
   * Clear ground kept around it, in metres.
   *
   * So that a landmark is a landmark rather than something wedged between
   * two houses -- and, for a flat one, so that the approach to it is not
   * through a wood.
   */
  margin?: number;
}

/**
 * A shrub standing on something, rather than a tree standing in the ground.
 *
 * The base is the only real difference and it is the whole point: a tree can
 * be drawn wherever the terrain is, a bush is on a terrace thirty metres up
 * and has to be told so.
 */
/**
 * One flat-topped rectangular tier of a landmark.
 *
 * A landmark with a penthouse is two of these -- the terrace and the part
 * standing over it -- and everything that has to point at one of them (the
 * marker, the collider, the planting) asks for it here rather than working it
 * out again with its own arithmetic and its own idea of which end is which.
 *
 * Not called a level. A level is a thing the game has three of.
 */
export interface Tier {
  x: number;
  z: number;
  width: number;
  depth: number;
  /** How high its flat top is. */
  top: number;
  /** Which way it faces, in the collider's yaw convention. */
  yaw: number;
}

/**
 * A point in a turned thing's own frame, put back into the world.
 *
 * `along` runs with its width and `across` with its depth. The convention is
 * the collider's, which is Three.js's rotation.y -- the same one
 * `footprintSamples` uses, and the inverse of the one `reserved` tests with.
 *
 * Everything that puts something on a landmark goes through here: the tiers,
 * the planting, and whoever is standing on it. Turn the building and they all
 * turn with it, because none of them works out its own place in the world.
 */
export function pointOn(
  place: { x: number; z: number; yaw?: number },
  along: number,
  across: number,
): { x: number; z: number } {
  const cos = Math.cos(place.yaw ?? 0);
  const sin = Math.sin(place.yaw ?? 0);
  return {
    x: place.x + along * cos + across * sin,
    z: place.z - along * sin + across * cos,
  };
}

/**
 * The open part of a landmark's flat top: everything the penthouse leaves.
 *
 * Null when there is no penthouse, because then the flat top is all one thing
 * and calling any of it a terrace would be inventing a distinction the
 * description does not make.
 */
export function terraceOf(landmark: Landmark): Tier | null {
  const penthouse = landmark.penthouse;
  if (!penthouse || landmark.height <= 0) return null;

  const width = landmark.width * (1 - penthouse.cover);
  if (width <= 0) return null;
  // The penthouse takes the far end, so the terrace is what is left at the
  // near one, and its middle is half the taken length back from the middle of
  // the building.
  const centre = pointOn(landmark, -(landmark.width * penthouse.cover) / 2, 0);
  return {
    ...centre,
    width,
    depth: landmark.depth,
    top: landmark.height,
    yaw: landmark.yaw ?? 0,
  };
}

/** The taller part, standing over the far end. */
export function penthouseOf(landmark: Landmark): Tier | null {
  const penthouse = landmark.penthouse;
  if (!penthouse || landmark.height <= 0) return null;

  const width = landmark.width * penthouse.cover;
  if (width <= 0) return null;
  const centre = pointOn(landmark, (landmark.width * (1 - penthouse.cover)) / 2, 0);
  return {
    ...centre,
    width,
    depth: landmark.depth,
    top: landmark.height + penthouse.rise,
    yaw: landmark.yaw ?? 0,
  };
}

/** How much taller than wide a bush is drawn, and boxed. */
const BUSH_RISE = 1.25;

/**
 * How far out the outermost row sits, as a fraction of the terrace's depth.
 *
 * Rows go near the edges, which is where planters are put on a real terrace
 * and, more usefully, is what keeps the middle open. A third and a bit out
 * leaves a clear strip down the centre wider than the planted margins either
 * side of it.
 */
const ROW_SPREAD = 0.35;

/** How far a bush is kept back from the ends of its row. */
const ROW_INSET = 0.8;

/**
 * The bushes on a landmark's terrace, in rows.
 *
 * Rows run the length of the terrace, spaced symmetrically about its centre
 * line. With two of them the middle is left open, which is where the arrow
 * points and where the pigeon waiting there stands -- planting that closed it
 * would be planting the landing off.
 */
export function plantTerrace(landmark: Landmark): Bush[] {
  const planting = landmark.planting;
  const terrace = terraceOf(landmark);
  if (!planting || !terrace || planting.rows < 1 || planting.perRow < 1) return [];

  const bushes: Bush[] = [];
  const height = planting.radius * BUSH_RISE;
  const span = terrace.width - 2 * (ROW_INSET + planting.radius);
  // Where the terrace's own middle is, in the landmark's frame: the rows are
  // laid there and turned with everything else.
  const back = -(landmark.width - terrace.width) / 2;

  for (let row = 0; row < planting.rows; row += 1) {
    // -1 .. 1 across the rows, and 0 when there is only one of them.
    const side = planting.rows === 1 ? 0 : (row / (planting.rows - 1)) * 2 - 1;
    const across = side * ROW_SPREAD * terrace.depth;

    for (let i = 0; i < planting.perRow; i += 1) {
      const step = planting.perRow === 1 ? 0.5 : i / (planting.perRow - 1);
      const along = back + (step - 0.5) * span;
      const at = pointOn(landmark, along, across);
      bushes.push({ ...at, base: terrace.top, radius: planting.radius, height });
    }
  }
  return bushes;
}

export interface Bush {
  x: number;
  z: number;
  /** The height of the surface it stands on. */
  base: number;
  radius: number;
  height: number;
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
  /** Bushes on the terraces of those, if any of them has one. */
  bushes: Bush[];
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

  // No landmarks: this layout describes nothing, it only generates. And so
  // nothing to plant a terrace on either.
  return { buildings, trees, landmarks: [], bushes: [], boxes };
}
