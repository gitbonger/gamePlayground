import { describe, expect, it } from 'vitest';
import { solarPosition, sunVector } from './sun';

/** The shipped map's centre: Budapest. */
const LAT = 47.4946;
const LON = 19.0813;

describe('where the sun is', () => {
  it('puts it overhead at the equator at noon on the equinox', () => {
    // Solar noon at longitude 0 is a few minutes off 12:00 UTC, hence the
    // tolerance; the altitude is the part being checked.
    const { altitude } = solarPosition(0, 0, new Date('2025-03-20T12:07:00Z'));
    expect(altitude).toBeGreaterThan(89);
  });

  it('reaches the height at midsummer noon that the latitude allows', () => {
    // 90 - latitude + the axial tilt, which is as high as it ever gets here.
    const { altitude, azimuth } = solarPosition(LAT, LON, new Date('2025-06-21T10:45:00Z'));
    expect(altitude).toBeCloseTo(90 - LAT + 23.44, 0);
    // And due south at noon, as it is anywhere north of the tropics.
    expect(azimuth).toBeCloseTo(180, 0);
  });

  it('is far lower at midwinter than at midsummer', () => {
    const summer = solarPosition(LAT, LON, new Date('2025-06-21T10:45:00Z'));
    const winter = solarPosition(LAT, LON, new Date('2025-12-21T10:45:00Z'));
    expect(summer.altitude - winter.altitude).toBeCloseTo(2 * 23.44, 0);
  });

  it('rises in the east and sets in the west', () => {
    const morning = solarPosition(LAT, LON, new Date('2025-06-21T04:00:00Z'));
    const evening = solarPosition(LAT, LON, new Date('2025-06-21T17:00:00Z'));

    expect(morning.azimuth).toBeGreaterThan(45);
    expect(morning.azimuth).toBeLessThan(120);
    expect(evening.azimuth).toBeGreaterThan(250);
    expect(evening.azimuth).toBeLessThan(320);
  });

  it('goes below the horizon at night', () => {
    expect(solarPosition(LAT, LON, new Date('2025-12-21T23:00:00Z')).altitude).toBeLessThan(0);
  });

  it('points the vector where the bearing says, with north at -Z', () => {
    // Due south and halfway up: +Z is south, so that is where it should point.
    const south = sunVector(LAT, LON, new Date('2025-06-21T10:45:00Z'));
    expect(south.x).toBeCloseTo(0, 1);
    expect(south.z).toBeGreaterThan(0);
    expect(south.y).toBeGreaterThan(0);

    // Afternoon: west of south, so the light comes from -X.
    const afternoon = sunVector(LAT, LON, new Date('2025-06-21T13:00:00Z'));
    expect(afternoon.x).toBeLessThan(0);
    expect(afternoon.y).toBeGreaterThan(0);

    for (const v of [south, afternoon]) {
      expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 9);
    }
  });
});
