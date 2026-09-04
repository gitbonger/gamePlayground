/**
 * Turning latitude and longitude into the simulation's local metres.
 *
 * Shared by the map baker and the game so that a point named in degrees lands
 * in the same place in both. Over a couple of kilometres a tangent plane about
 * the map's centre is accurate to well under a metre, and it avoids the scale
 * distortion a Mercator projection would bring.
 */

/** Metres per degree of latitude and longitude, on the WGS84 ellipsoid. */
export function metresPerDegree(latitude: number): { lat: number; lon: number } {
  const phi = (latitude * Math.PI) / 180;
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi),
    lon: 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi) + 0.118 * Math.cos(5 * phi),
  };
}

export interface Point {
  x: number;
  z: number;
}

/** Project a point onto the plane about `centre`. North is -Z, east is +X. */
export function project(
  latitude: number,
  longitude: number,
  centre: readonly [number, number],
): Point {
  const perDegree = metresPerDegree(centre[0]);
  return {
    x: (longitude - centre[1]) * perDegree.lon,
    z: -(latitude - centre[0]) * perDegree.lat,
  };
}

/** Compass heading from `from` to `to`, in radians clockwise from north. */
export const bearing = (from: Point, to: Point): number =>
  Math.atan2(to.x - from.x, -(to.z - from.z));

/** Horizontal distance between two local points, in metres. */
export const distance = (from: Point, to: Point): number =>
  Math.hypot(to.x - from.x, to.z - from.z);
