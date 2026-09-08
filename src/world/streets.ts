/**
 * A real street network, and the questions the world generator asks of it.
 *
 * The roads come from OpenStreetMap by way of `scripts/fetch-map.ts`; this
 * module projects nothing and fetches nothing, it just indexes what was baked
 * so that "what is the nearest street, and which way does it run?" is cheap
 * enough to ask for every candidate building on the map.
 */

import { aabb, type Aabb } from '../sim/collision';
import type { Bridge } from './bridges';
import { fitBoxes } from './plans';
import type { Area } from './areas';

export interface Road {
  /** OpenStreetMap highway class: motorway, primary, residential and so on. */
  kind: string;
  /** Carriageway width in metres. */
  width: number;
  /** Polyline in local metres, [x, z] with north at -Z. */
  points: [number, number][];
}

/**
 * A railway, as a centreline and the ground it occupies.
 *
 * Shaped exactly like a `Road` so the same index can carry it: `width` is not
 * the gauge but the corridor nothing may be built on, which is what the
 * generator needs to know and all it needs to know.
 */
export interface Rail {
  /** OpenStreetMap railway class: rail, tram, light_rail or narrow_gauge. */
  kind: string;
  /** Width of the corridor in metres. */
  width: number;
  /** Polyline in local metres, [x, z] with north at -Z. */
  points: [number, number][];
}

export interface MapData {
  name: string;
  centre: [number, number];
  radius: number;
  attribution: string;
  roads: Road[];
  /**
   * Roads carried over something, kept out of `roads` so they are not painted
   * flat across whatever they cross. Absent on older baked maps.
   */
  bridges?: Bridge[];
  /** Surface railway: heavy rail and tram. Absent on older baked maps. */
  rails?: Rail[];
  /** Parks, woods, playing fields and water. Absent on older baked maps. */
  areas?: Area[];
  /**
   * Real building outlines, as the map drew them.
   *
   * `[height, x0, z0, x1, z1, ...]` per building, with `height` null where it
   * does not say how tall it is, and the ring left open -- the last point does
   * not repeat the first.
   *
   * Bare arrays rather than named fields because there are nine thousand of
   * them and the names would be a quarter of a megabyte of the same two
   * letters. This is a generated file, and the only places the order has to
   * be known are here and `bakedPlans`.
   *
   * The outline rather than a box round it. It used to be a box, worked out
   * at bake time, and a box is still what the collider gets -- but it is
   * derived from this on the way in now, so the thing drawn and the thing
   * flown into cannot disagree. Baked as a box and the outline thrown away,
   * every L-plan corner house was drawn as the rectangle round it, and 1,605
   * buildings stood in the road.
   */
  plans?: readonly (readonly (number | null)[])[];
  /**
   * Painted pedestrian crossings, as `[x, z]`.
   *
   * Marked ones only -- zebras and signalled crossings, which are painted too.
   * A dropped kerb with nothing on the road is not something to draw.
   */
  crossings?: readonly (readonly number[])[];
  /**
   * Street trees, as `[x, z]`.
   *
   * The ones somebody has actually recorded standing in a street, as against
   * the ones the generator plants in parks.
   */
  trees?: readonly (readonly number[])[];
  /**
   * The brand names the signs say, each written once.
   *
   * Eighty-eight signs between nineteen brands, so the names are a list and a
   * sign is a number into it.
   */
  brands?: readonly string[];
  /**
   * Shop signs, as `[x, z, brand]`, `brand` being an index into `brands`.
   *
   * Groceries and fuel that carry a chain's name, and nothing else. The
   * district has three and a half thousand named shops in it; what makes a
   * sign worth having is that you know it from three hundred metres without
   * reading it, and that is a property of a chain.
   */
  signs?: readonly (readonly number[])[];
  /**
   * Places of worship, as `[x, z, kind]`: 0 a church, 1 a chapel, 2 a
   * synagogue.
   *
   * A point rather than an outline, because the outline is already in
   * `buildings` -- this only says which of those buildings is a church, and
   * what sort. What it buys is the one thing a district is navigated by from
   * the air: something tall that is not a block of flats.
   */
  worship?: readonly (readonly number[])[];
  /**
   * Tram platforms, as flat runs of `x, z`: `[x0, z0, x1, z1, ...]`.
   *
   * The way the map drew the kerb, open -- most are two points, and the few
   * closed ones are a depot yard or an underpass rather than an island. What
   * a platform *is* is worked out at the other end, where the track is known:
   * see `PLATFORM` in `from-map.ts`.
   */
  stops?: readonly (readonly number[])[];
}

/** A building outline, as the game wants it. */
export interface MapBuilding {
  x: number;
  z: number;
  width: number;
  depth: number;
  yaw: number;
  /** Metres, or null where the map does not say. */
  height: number | null;
}

/**
 * The boxes the collider needs, worked out from the outlines.
 *
 * One outline can come back as several: a courtyard block is fitted as a wing
 * along each side of it rather than as one slab over the hole. See
 * `fitBoxes`, which decides which.
 *
 * The height rides along on each box, so a building that was cut into wings
 * has all of its wings the same height -- which is what it is.
 */
export const bakedBuildings = (map: MapData): MapBuilding[] =>
  bakedPlans(map.plans).flatMap((plan) =>
    fitBoxes(plan.ring).map((box) => ({ ...box, height: plan.height })),
  );

/** And the pairs, for the two things that are only ever a place. */

/** A building as the map drew it: a ring, and how tall it says it is. */
export interface BuildingPlan {
  /** Metres, or null where the map gave neither a height nor a storey count. */
  height: number | null;
  /** The footprint, open: the last point does not repeat the first. */
  ring: [number, number][];
}

/** Unpack the baked outlines, dropping anything too short to be a shape. */
export const bakedPlans = (
  rows: readonly (readonly (number | null)[])[] | undefined,
): BuildingPlan[] =>
  (rows ?? []).flatMap((row) => {
    const ring: [number, number][] = [];
    for (let i = 1; i + 1 < row.length; i += 2) {
      const x = row[i];
      const z = row[i + 1];
      if (typeof x !== 'number' || typeof z !== 'number') return [];
      ring.push([x, z]);
    }
    if (ring.length < 3) return [];
    const height = row[0];
    return [{ height: typeof height === 'number' ? height : null, ring }];
  });

export const bakedPoints = (rows: readonly (readonly number[])[] | undefined): [number, number][] =>
  (rows ?? []).flatMap((row) =>
    row.length >= 2 && Number.isFinite(row[0]) && Number.isFinite(row[1])
      ? [[row[0]!, row[1]!] as [number, number]]
      : [],
  );

export interface NearestStreet {
  /** Distance from the query point to the road's centreline, in metres. */
  distance: number;
  /** The closest point on the centreline, so callers can measure out from it. */
  nearX: number;
  nearZ: number;
  /** Direction the road runs at the closest point, as a unit vector. */
  dirX: number;
  dirZ: number;
  width: number;
  kind: string;
}

export interface StreetIndex {
  /** Nearest road within `limit` metres, or null. */
  nearest(x: number, z: number, limit: number): NearestStreet | null;
  /** Extent of the network, in metres. */
  readonly bounds: Aabb;
  readonly segmentCount: number;
}

interface Segment {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  width: number;
  kind: string;
}

/** Grid cell size for the segment index, in metres. */
const CELL = 40;

export function indexStreets(roads: readonly Road[]): StreetIndex {
  const segments: Segment[] = [];
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;

  for (const road of roads) {
    for (let i = 1; i < road.points.length; i += 1) {
      const [x0, z0] = road.points[i - 1]!;
      const [x1, z1] = road.points[i]!;
      if (x0 === x1 && z0 === z1) continue;
      segments.push({ x0, z0, x1, z1, width: road.width, kind: road.kind });
      minX = Math.min(minX, x0, x1);
      maxX = Math.max(maxX, x0, x1);
      minZ = Math.min(minZ, z0, z1);
      maxZ = Math.max(maxZ, z0, z1);
    }
  }

  // Every cell a segment passes through gets a reference to it, so a nearest
  // query only has to look at the handful of streets actually nearby.
  const grid = new Map<number, number[]>();
  const cell = (v: number) => Math.floor(v / CELL);
  const key = (cx: number, cz: number) => cx * 100003 + cz;

  segments.forEach((segment, index) => {
    const x0 = cell(Math.min(segment.x0, segment.x1));
    const x1 = cell(Math.max(segment.x0, segment.x1));
    const z0 = cell(Math.min(segment.z0, segment.z1));
    const z1 = cell(Math.max(segment.z0, segment.z1));
    for (let cx = x0; cx <= x1; cx += 1) {
      for (let cz = z0; cz <= z1; cz += 1) {
        const bucket = grid.get(key(cx, cz));
        if (bucket) bucket.push(index);
        else grid.set(key(cx, cz), [index]);
      }
    }
  });

  function nearest(x: number, z: number, limit: number): NearestStreet | null {
    const reach = Math.ceil(limit / CELL);
    const cx = cell(x);
    const cz = cell(z);

    let best: NearestStreet | null = null;
    let bestDistance = limit;

    for (let ix = cx - reach; ix <= cx + reach; ix += 1) {
      for (let iz = cz - reach; iz <= cz + reach; iz += 1) {
        const bucket = grid.get(key(ix, iz));
        if (!bucket) continue;

        for (const index of bucket) {
          const s = segments[index]!;
          const dx = s.x1 - s.x0;
          const dz = s.z1 - s.z0;
          const lengthSquared = dx * dx + dz * dz;
          const t = Math.max(
            0,
            Math.min(1, ((x - s.x0) * dx + (z - s.z0) * dz) / lengthSquared),
          );
          const distance = Math.hypot(x - (s.x0 + t * dx), z - (s.z0 + t * dz));
          if (distance >= bestDistance) continue;

          const length = Math.sqrt(lengthSquared);
          bestDistance = distance;
          best = {
            distance,
            nearX: s.x0 + t * dx,
            nearZ: s.z0 + t * dz,
            dirX: dx / length,
            dirZ: dz / length,
            width: s.width,
            kind: s.kind,
          };
        }
      }
    }

    return best;
  }

  return {
    nearest,
    bounds: Number.isFinite(minX) ? aabb(minX, 0, minZ, maxX, 0, maxZ) : aabb(0, 0, 0, 0, 0, 0),
    segmentCount: segments.length,
  };
}
