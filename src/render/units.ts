/**
 * Units for anything the player reads.
 *
 * The simulation is metric throughout and thinks in metres per second, which
 * is the right unit for the physics and the wrong one for a speedometer. Every
 * speed on screen goes through here instead of each readout converting for
 * itself -- one of them not doing so is exactly how the airspeed came to be in
 * km/h while the ground-impact message next to it was in m/s.
 *
 * That includes vertical speeds. Climb and sink in m/s next to an airspeed in
 * km/h is the aviation convention and it is a perfectly good one, but it means
 * two numbers a second apart on screen disagree about what a speed is, and a
 * pigeon is not an instrument-rated aircraft.
 */

/** Metres per second to kilometres per hour. A metre a second is 3.6 km/h. */
export function kmh(metresPerSecond: number): number {
  return metresPerSecond * 3.6;
}

/**
 * A speed as the player sees it, rounded to whole km/h.
 *
 * Whole numbers because the tenths are noise: a pigeon's airspeed wanders by
 * more than that between one frame and the next, and a readout whose last
 * digit is never still is harder to read than one that is.
 */
export function speedText(metresPerSecond: number): string {
  return kmh(metresPerSecond).toFixed(0);
}

/**
 * A vertical speed, signed, as the player sees it.
 *
 * Climbing is positive and sinking is negative, which is worth stating because
 * the flight model reports sink as a positive number in the other direction.
 */
export function rateText(metresPerSecond: number): string {
  // Anything that rounds to nothing is nothing. Checked on the text rather
  // than the number, because every rate from -0.5 km/h up to negative zero
  // itself prints as "-0", and a readout flickering that in level flight
  // reads as a fault in the instrument.
  const text = kmh(metresPerSecond).toFixed(0);
  return text === '-0' ? '0' : text;
}
