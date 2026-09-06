/**
 * Whether a thing is worth drawing at all.
 *
 * A pigeon is about forty small meshes. Fifteen of them is five hundred, and
 * every one is posed every frame -- wings, tail, legs, head -- whether or not
 * anybody can see it. Most of the time most of them cannot be seen: the flock
 * is around the bird and the camera is behind it, and there are residents
 * standing on the targets of levels nobody is playing.
 *
 * One judgement for the whole bird, made on its centre. A pigeon is 35 cm
 * across, so the difference between judging it by its middle and judging it
 * properly is a bird a third of a metre from the edge of the screen -- and the
 * cone is opened out past the corners of the view to cover exactly that.
 *
 * No Three.js here, so it can be tested for what it says rather than for what
 * a renderer does with it.
 */

export interface Sight {
  /** Where the camera is. */
  eye: { x: number; y: number; z: number };
  /** Which way it looks, as a unit vector. */
  forward: { x: number; y: number; z: number };
  /**
   * The cosine of the half-angle of the cone that counts as "in front".
   *
   * Opened out well past the corners of the frame, because this is a cheap
   * test standing in for a proper frustum and a bird that pops into existence
   * at the edge of the screen is worse than one drawn needlessly.
   */
  spread: number;
  /** How far away a bird stops being worth drawing, in metres. */
  range: number;
}

/** Whether something at `at` is worth drawing. */
export function sighted(at: { x: number; y: number; z: number }, sight: Sight): boolean {
  const dx = at.x - sight.eye.x;
  const dy = at.y - sight.eye.y;
  const dz = at.z - sight.eye.z;
  const away = Math.hypot(dx, dy, dz);
  if (away > sight.range) return false;
  // Anything on top of the camera is in view by definition, and normalising a
  // zero-length vector is not.
  if (away < 1e-6) return true;

  const ahead = (dx * sight.forward.x + dy * sight.forward.y + dz * sight.forward.z) / away;
  return ahead >= sight.spread;
}

/**
 * A cone a good deal wider than the view, and a range at which a pigeon is a
 * pixel.
 *
 * The camera is 70 degrees vertically on a wide frame, so the corners are
 * about 55 degrees off the axis. Ninety gives a full half-turn of slack, which
 * costs a few birds drawn behind the edge of the screen and buys never seeing
 * one appear from nothing.
 *
 * At 250 m a pigeon subtends about a fifth of a degree, which on a 1080-line
 * display is a pixel and a half.
 */
export const defaultSight = { spread: Math.cos((90 * Math.PI) / 180), range: 250 };
