/**
 * Where the sun actually was.
 *
 * The light had been aimed by eye, which is fine until you notice that the
 * shadows in a game set in a real place at a real latitude are pointing
 * somewhere that time of day never puts them. This is the standard NOAA solar
 * position calculation: given a date, a latitude and a longitude it returns
 * the sun's altitude and bearing, and the renderer puts the light and the disc
 * in the sky exactly there.
 *
 * Accurate to a fraction of a degree, which is a great deal better than the
 * half-degree the sun itself covers.
 */

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export interface SunPosition {
  /** Degrees above the horizon; negative when the sun has set. */
  altitude: number;
  /** Degrees clockwise from north: 90 is due east, 180 due south. */
  azimuth: number;
}

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

export function solarPosition(latitude: number, longitude: number, when: Date): SunPosition {
  const dayOfYear =
    Math.floor((when.getTime() - Date.UTC(when.getUTCFullYear(), 0, 1)) / 86400000) + 1;
  const hours =
    when.getUTCHours() + when.getUTCMinutes() / 60 + when.getUTCSeconds() / 3600;

  // How far round its orbit the Earth is, from which everything else follows.
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hours - 12) / 24);

  // The sun runs up to a quarter of an hour fast or slow against the clock,
  // because the orbit is an ellipse and the axis is tilted.
  const equationOfTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g));

  const declination =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);

  // Working in UTC throughout, so longitude alone carries the time zone.
  const trueSolarTime = hours * 60 + equationOfTime + 4 * longitude;
  // Hour angle: zero at local solar noon, and a degree for every four minutes
  // either side of it.
  const hourAngle = (((trueSolarTime / 4 - 180 + 180) % 360) + 360) % 360 - 180;

  const lat = latitude * DEG;
  const ha = hourAngle * DEG;

  const cosZenith = clamp(
    Math.sin(lat) * Math.sin(declination) +
      Math.cos(lat) * Math.cos(declination) * Math.cos(ha),
    -1,
    1,
  );
  const zenith = Math.acos(cosZenith);

  const denominator = Math.cos(lat) * Math.sin(zenith);
  // Straight overhead, or straight down: every bearing is the same bearing.
  const bearing =
    Math.abs(denominator) < 1e-9
      ? 0
      : Math.acos(
          clamp((Math.sin(lat) * Math.cos(zenith) - Math.sin(declination)) / denominator, -1, 1),
        ) * RAD;

  return {
    altitude: 90 - zenith * RAD,
    // The arc cosine cannot tell morning from afternoon; the hour angle can.
    azimuth: hourAngle > 0 ? (bearing + 180) % 360 : (540 - bearing) % 360,
  };
}

/**
 * The same, as a unit vector pointing at the sun in world axes.
 *
 * The map is projected with north at -Z and east at +X, so a bearing measured
 * clockwise from north lands on those two the way it does here.
 */
export function sunVector(
  latitude: number,
  longitude: number,
  when: Date,
): { x: number; y: number; z: number } {
  const { altitude, azimuth } = solarPosition(latitude, longitude, when);
  const up = altitude * DEG;
  const round = azimuth * DEG;
  return {
    x: Math.sin(round) * Math.cos(up),
    y: Math.sin(up),
    z: -Math.cos(round) * Math.cos(up),
  };
}
