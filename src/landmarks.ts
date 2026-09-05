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
 * A large block of flats, standing in its own ground.
 *
 * Ninety metres by forty-two and thirty-one to the terrace, which makes it
 * about three times the plan of the buildings around it without being taller
 * than it already was -- a slab you can pick out of a roofline from a
 * kilometre by its footprint rather than by its height.
 *
 * Half of it is one storey higher: a penthouse, whose windows look out over
 * the flat half, which is a terrace planted with bushes in two long rows. The
 * terrace is what the level asks you to land on -- not the top of the
 * penthouse -- and the turn puts it on the near side, so the half you are
 * aiming at is the half you meet first instead of being hidden behind the
 * taller one on every approach.
 *
 * The coordinate is not quite the one the terrace was first pinned at. That
 * point is thirteen metres from the kerb, which was room enough for a thirty
 * metre building and is not room for a ninety metre one; this is the same
 * block, moved far enough in that the walls stand clear of the streets rather
 * than across them.
 */
export const LOFT: LandmarkSpec = {
  name: 'The Loft',
  at: [47.495294, 19.081901],
  width: 90,
  depth: 42,
  // The terrace. The penthouse stands three and a bit above this.
  height: 31,
  // Turned to face the way the pigeon comes in, which is from the east.
  yaw: Math.PI,
  margin: 9,
  penthouse: { cover: 0.5, rise: 3.2 },
  // Longer rows for a longer terrace: the spacing within a row is what makes
  // it read as a hedge rather than as a line of separate shrubs.
  planting: { rows: 2, perRow: 16, radius: 0.7 },
  // Somebody at the parapet, looking out over the city. Beyond the near row
  // of bushes rather than between them, so they are out of the strip the
  // bird comes down on, and turned to face off the edge.
  people: [{ along: -6, across: 17.5, facing: Math.PI }],
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
