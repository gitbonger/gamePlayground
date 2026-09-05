/**
 * A real street network, and the questions the world generator asks of it.
 *
 * The roads come from OpenStreetMap by way of `scripts/fetch-map.ts`; this
 * module projects nothing and fetches nothing, it just indexes what was baked
 * so that "what is the nearest street, and which way does it run?" is cheap
 * enough to ask for every candidate building on the map.
 */

import { aabb, type Aabb } from '../sim/collision';
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
  /** Surface railway: heavy rail and tram. Absent on older baked maps. */
  rails?: Rail[];
  /** Parks, woods, playing fields and water. Absent on older baked maps. */
  areas?: Area[];
}

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
