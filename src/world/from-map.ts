/**
 * Build a world from a real street network.
 *
 * The streets are real; the buildings are not. Extracting true city blocks
 * would mean finding the faces of a planar graph, which is fiddly and fragile
 * against real map data -- bridges cross tunnels without meeting, ways dangle,
 * and a single bad node swallows a whole block. Scattering candidates and
 * rejecting the ones that fall in the road is robust against all of that, and
 * from the air the thing that makes a place recognisable is the street pattern
 * rather than which building is which.
 *
 * One detail does most of the work: every building is turned to face the
 * street nearest it. That is the difference between boxes near lines and a
 * city.
 */

import { turnedBox, type Box } from '../sim/collision';
import { indexStreets, type MapData, type StreetIndex } from './streets';
import type { Building, CityLayout, Tree } from './layout';
import { distance, type Point } from './geo';

export interface MapWorldOptions {
  /** Spacing of the candidate grid, in metres. */
  spacing: number;
  /** Clear space kept between a building and the kerb, in metres. */
  setback: number;
  /** How far back from the kerb buildings still front the street, in metres. */
  frontage: number;
  /**
   * Building heights, in metres. A flat band rather than something derived
   * from road importance: this neighbourhood is uniformly about seven floors,
   * and that evenness is what its skyline looks like.
   */
  minHeight: number;
  maxHeight: number;
  /** Trees need this much clear ground to appear in, in metres. */
  parkland: number;
  seed: number;
  /**
   * Where the pigeon is trying to get to. The building nearest it is marked,
   * so the renderer can pick it out as a landmark to home in on.
   */
  target?: Point;
}

export const defaultMapWorldOptions: MapWorldOptions = {
  spacing: 17,
  setback: 2.5,
  frontage: 17,
  minHeight: 16,
  maxHeight: 24,
  parkland: 30,
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

export function buildLayoutFromMap(
  map: MapData,
  options: MapWorldOptions = defaultMapWorldOptions,
): CityLayout & { streets: StreetIndex; target: Building | null } {
  const streets = indexStreets(map.roads);
  const rand = mulberry32(options.seed);

  const buildings: Building[] = [];
  const trees: Tree[] = [];
  const boxes: Box[] = [];

  const { bounds } = streets;
  const search = options.setback + options.frontage + options.spacing;

  for (let x = bounds.minX; x <= bounds.maxX; x += options.spacing) {
    for (let z = bounds.minZ; z <= bounds.maxZ; z += options.spacing) {
      // Jitter off the lattice, or the result reads as a grid of its own and
      // fights the street pattern underneath it.
      const px = x + (rand() - 0.5) * options.spacing * 0.85;
      const pz = z + (rand() - 0.5) * options.spacing * 0.85;

      const street = streets.nearest(px, pz, search);
      if (!street) continue;

      // Well clear of every road: block interior, so plant something.
      if (street.distance > options.parkland) {
        if (rand() < 0.16) {
          const height = 6 + rand() * 9;
          trees.push({ x: px, z: pz, radius: 2.5 + rand() * 2, height });
        }
        continue;
      }

      // Turn to face the street: the building's own X axis runs along it, so
      // `width` is its frontage and `depth` is how far back it reaches.
      const yaw = Math.atan2(-street.dirZ, street.dirX);

      const width = 12 + rand() * 16;
      const depth = 11 + rand() * 11;

      // Set back from the kerb by half the depth, because what has to clear
      // the carriageway is the building's near wall, not its centre. Testing
      // the centre alone lets a deep building overhang the road it fronts.
      const kerb = street.width / 2 + options.setback + depth / 2;
      if (street.distance < kerb) continue;
      // Behind the frontage band: leave the middle of the block open.
      if (street.distance > kerb + options.frontage) continue;

      const height = options.minHeight + rand() * (options.maxHeight - options.minHeight);

      buildings.push({ x: px, z: pz, width, depth, height, yaw });
      boxes.push(turnedBox(px, pz, width, height, depth, yaw));
    }
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

  return { buildings, trees, boxes, roads: map.roads, streets, target };
}
