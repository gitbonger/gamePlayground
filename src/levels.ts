/**
 * The levels, as data.
 *
 * The map is settled, so a coordinate written here means the same place for
 * good. That is what makes a level something you can describe rather than
 * something you have to build: a point to be released at, an hour to fly it
 * at, a thing to land on and somebody standing on it.
 *
 * No story yet. These are landing problems in increasing order of difficulty,
 * each ending in the same placeholder conversation, and whatever eventually
 * joins them up can be different data in the same shape.
 */

import { GREETING, LEAVING, type Turn } from './dialogue';
import { HOME_TREE, LOFT, PARK_PATCH, WEST_PATCH } from './landmarks';

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
  | { kind: 'wagon'; name: string; train: number; car: number | 'middle' }
  /**
   * One of the described things in the world, by name.
   *
   * Referenced rather than described here, so that two levels aiming at the
   * same building are aiming at the same building. The name comes off the
   * landmark itself rather than being written out again, which is a typo
   * that cannot be made.
   */
  | { kind: 'landmark'; name: string };

/** What the marker over a level's target is called. */
export const targetName = (level: Level): string => level.target.name;

/** Who is waiting there. */
export interface LevelPerson {
  /**
   * Which colour scheme to wear, as an index into `CHARACTER_MORPHS`.
   *
   * The crowd's four come first and the ones who are somebody after, so an
   * index past the crowd is a deliberate choice of a particular bird -- which
   * is why the pink one being on exactly one level is a test rather than a
   * convention.
   */
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
  /**
   * What is said when you reach the pigeon waiting there.
   *
   * The same placeholder on every level for now. Each carries its own so
   * that giving one a different conversation is changing one line here.
   */
  dialogue: Turn;
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
  /**
   * How the level opens: in the air, or already on your feet on the target.
   *
   * Flight is the ordinary case and the default. Perched is for a level that
   * is a conversation rather than a flight -- the hero starts standing on the
   * thing the level is about, an arm's length from whoever is waiting there,
   * so it is complete the moment it begins and the only thing left to do is
   * talk and go.
   *
   * It is a hack in the sense that a story beat is being told through the
   * level-completion machinery rather than through anything of its own. It is
   * not a hack in the sense that matters: nothing downstream is special-cased
   * for it. The bird is standing, the resident is standing, they are within
   * reach, and the same rule that finishes every other level finishes this
   * one.
   */
  begins?: 'flight' | 'perched';
}

export const LEVELS: readonly Level[] = [
  {
    // The story's first beat rather than a flight: the hero on the home tree
    // with his mate and their egg, leaving. It is won on the instant it opens
    // -- he is already standing next to her -- so what the player does here
    // is read, answer, and take off.
    name: 'Leaving',
    // The tree itself. Unused for a perched start, which stands him on the
    // platform, but written down because a level without a place is not one.
    start: [47.493452, 19.085940],
    // First light, which is when a homing pigeon is actually let go, and the
    // only level in the game flown out of a sunrise.
    when: '2025-06-21T03:10:00Z',
    target: { kind: 'landmark', name: HOME_TREE.name },
    // The pink one, and the only bird in the game wearing her colours. She
    // stands beside the nest rather than on it.
    person: { morph: 4, along: -1.05, across: 0.5 },
    dialogue: LEAVING,
    begins: 'perched',
  },
  {
    // A short hop onto a concrete patch in the park, in the flattest light
    // there is. Nothing to fly round, nothing that moves, and the whole
    // approach visible from the start.
    name: 'The Park',
    start: [47.495944, 19.093122],
    // Midday, so the shadows are short and the ground reads plainly.
    when: '2025-06-21T10:00:00Z',
    target: { kind: 'landmark', name: PARK_PATCH.name },
    person: { morph: 0, along: 2.4, across: 0 },
    dialogue: GREETING,
  },
  {
    // Twenty-four metres up, on a roof among other roofs. Still nothing
    // moving, but now you have to pick the right one and stop on it.
    name: 'The Loft',
    // Three hundred metres out and a hundred and twenty up, which is a good
    // deal steeper than a pigeon glides: 1:2.5 against a best glide of 1:6.2,
    // so the height has to be got rid of rather than merely flown off.
    start: [47.494610, 19.086245],
    // Late afternoon in midsummer: 24 degrees up and a little north of due
    // west, which hangs the sun over the rooftops instead of above the top of
    // the frame, and makes the shadows long enough to read from the air.
    when: '2025-06-21T16:00:00Z',
    target: { kind: 'landmark', name: LOFT.name },
    person: { morph: 1, along: 2.6, across: 0 },
    dialogue: GREETING,
  },
  {
    // A wagon of a running train, which is the first target that will not
    // wait for you.
    name: 'The Yard',
    start: [47.503261, 19.091374],
    // Low evening sun, straight down the yard.
    when: '2025-06-21T17:30:00Z',
    target: { kind: 'wagon', name: 'The middle wagon', train: 0, car: 'middle' },
    person: { morph: 2, along: 2.5, across: 0 },
    dialogue: GREETING,
  },
  {
    // Across the city to the west, and the first level flown in the morning:
    // a low sun behind you rather than in front, throwing the shadows the
    // other way from every level before it.
    name: 'The Crossing',
    start: [47.494106, 19.071122],
    // Half past seven in the morning, local. Four degrees north of due east
    // and eleven degrees up, which is the sun of the evening levels seen from
    // the other side.
    when: '2025-06-21T05:30:00Z',
    target: { kind: 'landmark', name: WEST_PATCH.name },
    person: { morph: 3, along: 2.4, across: 0 },
    dialogue: GREETING,
  },
];
