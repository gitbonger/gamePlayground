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
import type { Landmark } from './world/layout';

/**
 * A described thing, in degrees, before it is projected into local metres.
 *
 * The same thing the layout calls a `Landmark`, said in the coordinates a
 * place is written down in. Declared as that type with the position swapped
 * so the two cannot drift apart: adding a field there is adding it here.
 */
export interface LandmarkSpec extends Omit<Landmark, 'x' | 'z'> {
  /** Where it stands, in degrees. */
  at: [number, number];
}

/**
 * A large block of flats, standing on the corner of its block.
 *
 * Taller than the sixteen-to-twenty-four metre houses it stands among so that
 * it can be picked out of a roofline from a kilometre, and thirty metres by
 * fourteen because that is what fits between the two streets it faces.
 *
 * Half of it is one storey higher: a penthouse, whose windows look out over
 * the flat half, which is a terrace with bushes in two rows down it. The
 * terrace is what the level asks you to land on -- not the top of the
 * penthouse. Fifteen metres by fourteen with the planting to the edges, so
 * there is a clear strip eight metres wide down the middle of it to come down
 * on and to walk along.
 */
export const LOFT: LandmarkSpec = {
  name: 'The Loft',
  at: [47.494953, 19.081954],
  width: 30,
  depth: 14,
  // The terrace. The penthouse stands three and a bit above this.
  height: 31,
  margin: 9,
  penthouse: { cover: 0.5, rise: 3.2 },
  planting: { rows: 2, perRow: 6, radius: 0.7 },
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
