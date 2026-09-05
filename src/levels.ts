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

/** What a level asks you to land on. */
export type LevelTarget =
  /**
   * A vehicle of one of the rakes. By index rather than by coordinate,
   * because it will not be where you left it.
   */
  | { kind: 'wagon'; train: number; car: number | 'middle' }
  /** The building nearest a point, given in degrees. */
  | { kind: 'building'; near: [number, number] };

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
    name: 'The Yard',
    // North-east of the rail yard, high enough to see it from.
    start: [47.503261, 19.091374],
    // Late afternoon in midsummer: 24 degrees up and a little north of due
    // west, which hangs the sun over the rooftops instead of above the top of
    // the frame, and makes the shadows long enough to read from the air.
    when: '2025-06-21T16:00:00Z',
    target: { kind: 'wagon', train: 0, car: 'middle' },
    person: { morph: 3, along: 2.5, across: 0 },
  },
];

/** The level a name belongs to, or -1. */
export const levelNamed = (name: string): number =>
  LEVELS.findIndex((level) => level.name === name);
