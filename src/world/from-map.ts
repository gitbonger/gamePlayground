/**
 * Build a world from a real street network.
 *
 * The streets are real; the buildings are not. What makes this neighbourhood
 * recognisable from the air is not which building is which, but that it is
 * built in *perimeter blocks*: one continuous building running right round the
 * block, six or seven floors of it, with a courtyard in the middle. Rows of
 * separate houses along a road cannot produce that, however carefully they are
 * placed, because nothing in a row knows the block is a closed shape.
 *
 * So the block comes first. The streets are traced into the polygons they
 * enclose, each polygon is pulled in to the kerb, and a wing of building is
 * laid around the inside of it. The courtyard is whatever is left in the
 * middle, which is also where the gardens go.
 */

import { turnedBox, type Box } from '../sim/collision';
import { indexStreets, type MapData, type StreetIndex } from './streets';
import { footprintSamples, indexAreas, type AreaIndex } from './areas';
import { extractBlocks, type Block } from './blocks';
import {
  distanceToEdges,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  shrinkRing,
  type Point2,
} from './polygon';
import type { Building, CityLayout, Tree } from './layout';
import { distance, type Point } from './geo';

export interface MapWorldOptions {
  /** Clear space kept between the carriageway and the wall, in metres. */
  setback: number;
  /** Frontage of one house along the block edge, in metres. */
  minFrontage: number;
  maxFrontage: number;
  /**
   * How deep the wing of building is, from street wall to courtyard.
   *
   * The one number that decides how much of a block is built on. Around 16 m
   * is a staircase and two rooms either side of it, which is what these blocks
   * actually are.
   */
  wingDepth: number;
  /**
   * A courtyard smaller across than this is not worth leaving, and the block
   * is built solid instead. Small blocks in this district really are solid.
   */
  minCourtyard: number;
  /** Ignore faces outside this range of ground area, in square metres. */
  minBlockArea: number;
  maxBlockArea: number;
  /**
   * Building heights, in metres. A flat band rather than something derived
   * from road importance: this neighbourhood is uniformly about seven floors,
   * and that evenness is what its skyline looks like.
   */
  minHeight: number;
  maxHeight: number;
  /** Grid the trees are scattered on, in metres. */
  spacing: number;
  /**
   * How thickly to plant, in trees per hectare.
   *
   * A density rather than a chance per candidate, because a chance per
   * candidate quietly means something different every time the scattering grid
   * changes: tightening `spacing` alone would otherwise turn a park into a
   * thicket without anyone touching the planting.
   */
  parkTrees: number;
  /** The same, for courtyards. Thicker: these are gardens, and small. */
  gardenTrees: number;
  seed: number;
  /**
   * Where the pigeon is trying to get to. The building nearest it is marked,
   * so the renderer can pick it out as a landmark to home in on.
   */
  target?: Point;
}

export const defaultMapWorldOptions: MapWorldOptions = {
  setback: 2,
  minFrontage: 14,
  maxFrontage: 28,
  wingDepth: 16,
  minCourtyard: 14,
  minBlockArea: 500,
  maxBlockArea: 90000,
  minHeight: 16,
  maxHeight: 24,
  spacing: 9,
  parkTrees: 19,
  gardenTrees: 60,
  seed: 11,
};

/** Small deterministic PRNG, so the same map always builds the same city. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MapWorld extends CityLayout {
  streets: StreetIndex;
  green: AreaIndex;
  target: Building | null;
  /** The blocks the streets enclose, for anything that wants the shape of one. */
  blocks: Block[];
  /** The open middle of each block, once its wing of building is subtracted. */
  courtyards: Point2[][];
}

export function buildLayoutFromMap(
  map: MapData,
  options: MapWorldOptions = defaultMapWorldOptions,
): MapWorld {
  const streets = indexStreets(map.roads);
  const green = indexAreas(map.areas ?? []);
  const rand = mulberry32(options.seed);

  const buildings: Building[] = [];
  const trees: Tree[] = [];
  const boxes: Box[] = [];
  const courtyards: Point2[][] = [];

  const blocks = extractBlocks(map.roads, {
    minArea: options.minBlockArea,
    maxArea: options.maxBlockArea,
  });

  for (const block of blocks) {
    // The ring runs along the centrelines, so pulling it in by half the
    // carriageway plus the setback puts it exactly on the kerb -- and each
    // edge by its own street's width, because a block bounded by a boulevard
    // and three side streets is not a square anything.
    const kerbs = block.ring.map((point, i) => {
      const next = block.ring[(i + 1) % block.ring.length]!;
      const street = streets.nearest((point[0] + next[0]) / 2, (point[1] + next[1]) / 2, 60);
      return (street ? street.width / 2 : 6) + options.setback;
    });

    const face = shrinkRing(block.ring, kerbs);
    // Pulled in past its own middle: a sliver between two wide roads, which
    // has no room to build on at all.
    if (face.length < 3 || polygonArea(face) < options.minBlockArea / 4) continue;

    const [cx, cz] = polygonCentroid(face);
    const reach = distanceToEdges(cx, cz, face);

    // Deep enough for a wing and a courtyard, or too small for both, in which
    // case the wings meet in the middle and the block is solid.
    const roomy = reach > options.wingDepth + options.minCourtyard / 2;
    const depth = roomy ? options.wingDepth : Math.max(reach, 4);

    for (let i = 0; i < face.length; i += 1) {
      const [x0, z0] = face[i]!;
      const [x1, z1] = face[(i + 1) % face.length]!;
      const run = Math.hypot(x1 - x0, z1 - z0);
      // Shorter than a single house: a clipped corner, not a frontage.
      if (run < 6) continue;

      const ux = (x1 - x0) / run;
      const uz = (z1 - z0) / run;
      // Into the block, which for a counter-clockwise ring is to the left.
      const nx = -uz;
      const nz = ux;
      // The building's own X axis runs along the street, so `width` is its
      // frontage and `depth` is how far back into the block it reaches.
      const yaw = Math.atan2(-uz, ux);

      // Rounded up, never down: rounding to the nearest whole number of
      // houses lets a run a little over the limit become one house wider than
      // any house is allowed to be.
      const wanted = options.minFrontage + rand() * (options.maxFrontage - options.minFrontage);
      const houses = Math.max(1, Math.ceil(run / wanted));
      const width = run / houses;

      for (let h = 0; h < houses; h += 1) {
        const along = (h + 0.5) * width;
        const bx = x0 + ux * along + nx * (depth / 2);
        const bz = z0 + uz * along + nz * (depth / 2);
        const height = options.minHeight + rand() * (options.maxHeight - options.minHeight);

        // Inside the block it belongs to. Shrinking a ring is delicate around
        // a sharp corner, and this is the plain statement of the thing that
        // actually matters: a building of this block stands on this block.
        if (!pointInPolygon(bx, bz, block.ring)) continue;

        // And never out in the carriageway -- of its own street or of one
        // cutting through the block. Measured to the near wall, not the
        // centre: a deep building set back only by its centre still overhangs.
        const front = streets.nearest(bx, bz, depth + 40);
        if (front && front.distance - depth / 2 < front.width / 2) continue;

        // Ground the map already accounts for. Nobody builds a house in a
        // park, and this is most of what stops a generated city looking
        // generated: real cities have holes in them, and the holes are not
        // random.
        if (green.anyInside(footprintSamples(bx, bz, width, depth, yaw))) continue;

        buildings.push({ x: bx, z: bz, width, depth, height, yaw });
        boxes.push(turnedBox(bx, bz, width, height, depth, yaw));
      }
    }

    if (!roomy) continue;
    const courtyard = shrinkRing(face, depth);
    if (courtyard.length < 3 || polygonArea(courtyard) < 40) continue;
    courtyards.push(courtyard);
    plant(courtyard, options.gardenTrees);
  }

  /** Scatter trees on a grid, wherever the grid falls inside `ring`. */
  function plant(ring: Point2[], perHectare: number) {
    const chance = Math.min(1, (perHectare / 10000) * options.spacing * options.spacing);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of ring) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    for (let x = minX; x <= maxX; x += options.spacing) {
      for (let z = minZ; z <= maxZ; z += options.spacing) {
        const px = x + (rand() - 0.5) * options.spacing * 0.85;
        const pz = z + (rand() - 0.5) * options.spacing * 0.85;
        if (rand() >= chance) continue;
        if (!pointInPolygon(px, pz, ring)) continue;
        // Not on the water, and not in the middle of a five-a-side pitch.
        const ground = green.at(px, pz);
        if (ground && ground.kind !== 'park' && ground.kind !== 'wood') continue;
        trees.push({ x: px, z: pz, radius: 2.5 + rand() * 2, height: 6 + rand() * 9 });
      }
    }
  }

  // Parks and woods, which are their own rings and owe nothing to the blocks.
  for (const area of map.areas ?? []) {
    if (area.kind !== 'park' && area.kind !== 'wood') continue;
    plant(area.points as Point2[], options.parkTrees);
  }

  // Mark the building nearest the destination, so there is something to aim
  // at rather than a bare coordinate.
  let target: Building | null = null;
  if (options.target) {
    let nearest = Infinity;
    for (const building of buildings) {
      const away = distance(options.target, building);
      if (away < nearest) {
        nearest = away;
        target = building;
      }
    }
    if (target) target.isTarget = true;
  }

  return {
    buildings,
    trees,
    boxes,
    roads: map.roads,
    areas: map.areas ?? [],
    streets,
    green,
    blocks,
    courtyards,
    target,
  };
}
