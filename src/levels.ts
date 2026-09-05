/**
 * The levels, as data.
 *
 * The map is settled, so a coordinate written here means the same place for
 * good. That is what makes a level something you can describe rather than
 * something you have to build: a point to be released at, an hour to fly it
 * at, a thing to land on and somebody standing on it.
 *
 * No story yet, and no mechanism for one. These are landing problems in
 * increasing order of difficulty, and whatever eventually joins them up can
 * be another field on the same objects.
 */

/**
 * What a level asks you to land on. Always a thing, never a place.
 *
 * Open ground was the awkward case: a wagon and a building are objects with a
 * material each to flash and a top to land on, and a field is a field. Rather
 * than teach the marker about targets that are not things, a level that wants
 * one lays one -- a patch of concrete in the park. Everything downstream then
 * treats all three the same.
 */
export type LevelTarget =
  /**
   * A vehicle of one of the rakes. By index rather than by coordinate,
   * because it will not be where you left it.
   */
  | { kind: 'wagon'; train: number; car: number | 'middle' }
  /** The building nearest a point, given in degrees. */
  | { kind: 'building'; near: [number, number] }
  /** A patch of concrete, laid at a point given in degrees. */
  | { kind: 'patch'; at: [number, number]; size: number };

/** Who is waiting there. */
export interface LevelPerson {
  /** Which colour scheme to wear, as an index into the morph list. */
  morph: number;
  /**
   * Where on the target they stand: metres along it and across it.
   *
   * A little off the middle, so that arriving is not the same thing as
   * meeting them and there is a walk in between.
   */
  along: number;
  across: number;
}

export interface Level {
  /** What it is called, on the marker and in the menu. */
  name: string;
  /** Where the pigeon is released, in degrees. */
  start: [number, number];
  /**
   * The moment it is flown at, as an ISO instant.
   *
   * Which is to say where the sun is: the light is worked out from the real
   * solar position at this time over the map's own coordinates, so an hour is
   * a lighting decision that cannot be wrong for the place.
   */
  when: string;
  target: LevelTarget;
  person: LevelPerson;
}

export const LEVELS: readonly Level[] = [
  {
    // A short hop onto a concrete patch in the park, in the flattest light
    // there is. Nothing to fly round, nothing that moves, and the whole
    // approach visible from the start.
    name: 'The Park',
    start: [47.495944, 19.093122],
    // Midday, so the shadows are short and the ground reads plainly.
    when: '2025-06-21T10:00:00Z',
    target: { kind: 'patch', at: [47.494297, 19.090454], size: 9 },
    person: { morph: 6, along: 2.4, across: 0 },
  },
  {
    // Twenty-four metres up, on a roof among other roofs. Still nothing
    // moving, but now you have to pick the right one and stop on it.
    name: 'The Loft',
    start: [47.503261, 19.091374],
    // Late afternoon in midsummer: 24 degrees up and a little north of due
    // west, which hangs the sun over the rooftops instead of above the top of
    // the frame, and makes the shadows long enough to read from the air.
    when: '2025-06-21T16:00:00Z',
    target: { kind: 'building', near: [47.494953, 19.081954] },
    person: { morph: 1, along: 2.6, across: 0 },
  },
  {
    // A wagon of a running train, which is the first target that will not
    // wait for you.
    name: 'The Yard',
    start: [47.503261, 19.091374],
    // Low evening sun, straight down the yard.
    when: '2025-06-21T17:30:00Z',
    target: { kind: 'wagon', train: 0, car: 'middle' },
    person: { morph: 3, along: 2.5, across: 0 },
  },
];
