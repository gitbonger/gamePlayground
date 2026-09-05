/**
 * The described things in the world, as opposed to the generated ones.
 *
 * Everything else is worked out from the map: where the streets run, so where
 * the blocks are, so where the houses and the trees go. These are the other
 * way round. They are written down here, put in place before any of that, and
 * the generation gives way to them -- no house is built through one and no
 * tree is planted on one.
 *
 * That order is what makes them nameable. A level can say "The Loft" and rely
 * on it being a particular building of a particular shape at a particular
 * coordinate, rather than whichever house happened to come out nearest to a
 * point.
 */

/** A described thing, in degrees, before it is projected into local metres. */
export interface LandmarkSpec {
  /** What levels call it. */
  name: string;
  /** Where it stands. */
  at: [number, number];
  /** Its footprint: along it and across it, in metres. */
  width: number;
  depth: number;
  /**
   * How tall, in metres. Zero for something flat.
   *
   * A landmark building has no pitched roof: its flat top is exactly the top
   * of its collision box, so the bird lands where it looks like it does.
   */
  height: number;
  /** Which way it faces, in radians. */
  yaw?: number;
  /** Clear ground kept around it, so it is a landmark rather than a terrace. */
  margin?: number;
}

/**
 * A pigeon loft: a tall, narrow, flat-topped block standing clear of the
 * terraces around it.
 *
 * Taller than the twenty-four metre houses it stands among so that it can be
 * picked out of a roofline from a kilometre, and narrow enough that landing
 * on it is a real approach rather than arriving somewhere on a field.
 */
export const LOFT: LandmarkSpec = {
  name: 'The Loft',
  at: [47.494953, 19.081954],
  width: 16,
  depth: 12,
  height: 31,
  margin: 9,
};

/**
 * A patch of concrete in the park, level with the grass.
 *
 * Flat, so landing on it, landing beside it and walking from one to the other
 * are all the same surface -- a level whose target you have to put down
 * *inside* is a much harder level than one you land near and walk onto. The
 * margin keeps the trees off it, and off the approach to it.
 */
export const PARK_PATCH: LandmarkSpec = {
  name: 'The Concrete',
  at: [47.494297, 19.090454],
  width: 9,
  depth: 9,
  height: 0,
  margin: 7,
};

export const LANDMARKS: readonly LandmarkSpec[] = [LOFT, PARK_PATCH];
