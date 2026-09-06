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

import { GREETING, HEADING_OUT, type Turn } from './dialogue';
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
   * Absent when nobody is waiting, which is the same levels that end at a
   * line: there is nobody to say it to.
   */
  dialogue?: Turn;
  /** Where the pigeon is released, in degrees. */
  start: [number, number];
  /**
   * How high it is released, in metres above the ground.
   *
   * Stated by every level and defaulted by none, because there is no height
   * that is right twice: a hundred metres is a sky drop with the whole
   * approach laid out beneath you, and twenty-three is leaving a tree. Which
   * of those a level is, is the level's own business, and a default would let
   * one be written without anybody deciding.
   *
   * The ground is flat, so this is both a height and an altitude. The one
   * thing that overrides it is something solid underneath -- a release point
   * over a roof is raised clear of the roof, since being released inside a
   * building is not a difficulty, it is a bug.
   */
  release: number;
  /**
   * How full the belly is on arriving, 0 to 1.
   *
   * Stated by every level for the same reason the release height is: there is
   * no figure that is right twice. What makes this one different is that the
   * belly, unlike a position, *carries* -- a level walked into out of the one
   * before it starts with whatever the last one left.
   *
   * So it is a floor rather than a setting. Put here by the menu or by a
   * death, it is exactly this; arrived at from the level before, it is this
   * or what you brought, whichever is more. That takes nothing away from a
   * player who flew the last one well, and it makes sure a player who limped
   * in on nothing is given a level they can still fly rather than one they
   * have already lost.
   */
  health: number;
  /**
   * The moment it is flown at, as an ISO instant.
   *
   * Which is to say where the sun is: the light is worked out from the real
   * solar position at this time over the map's own coordinates, so an hour is
   * a lighting decision that cannot be wrong for the place.
   *
   * It belongs to `start` and travels with it. Both say what happens when you
   * are *put* at this level -- from the menu, on a respawn, or by flying on
   * from the level before -- and a level taken up where you stand, handed over
   * by a conversation, applies neither. You carry on from the branch you were
   * on, at the hour you were standing there.
   */
  when: string;
  target: LevelTarget;
  /**
   * Who is waiting at the target, if anybody is.
   *
   * A level ends either by walking up to somebody or by crossing a line, and
   * a level that ends at a line has nobody standing at the far end of it --
   * it is the first half of a flight, not a place you arrive. Optional for
   * that reason and not for convenience: two levels aiming at one landmark
   * would otherwise stand two pigeons on the same square metre of it.
   */
  person?: LevelPerson;
  /**
   * A line across the flight that ends the level when it is crossed.
   *
   * `at` is metres from the release point, measured along the straight line
   * to the target, and the line itself is square to that -- so any way of
   * getting from here to there crosses it, however wide the detour.
   *
   * It exists to break a long flight into pieces you do not have to fly
   * twice. Nothing new had to be invented for that: crossing hands the next
   * level over where you are standing, exactly as the end of a conversation
   * does, and a level already knows where it starts, already puts you back
   * there when you die, and already remembers itself between sessions. A
   * checkpoint would have been a fourth thing that does what three things
   * already do.
   */
  crossing?: { at: number; opens: string };
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

/**
 * The hour every level is flown at, as an instant.
 *
 * Six in the evening in Budapest on the first of July, which is 16:00 UTC --
 * the field is an instant and the city is two hours ahead of it in summer.
 * One hour for all five: the levels run into each other now, one handing over
 * to the next where the last one ended, and a story that crosses a whole
 * afternoon between one wingbeat and the next is a story with a cut in it.
 *
 * It is written once rather than five times because it is one decision. When
 * a level wants its own light again, it says so by not using this.
 */
const EVENING = '2026-07-01T16:00:00Z';

/**
 * Where a level's finishing line lies, as a point on it and the way across.
 *
 * Square to the flight, so it is a line rather than a ring: any path from the
 * near side to the far side crosses it, and a bird that wanders half a
 * kilometre off course still gets there.
 */
export interface Line {
  x: number;
  z: number;
  /** Unit vector from the release point towards the target. */
  ux: number;
  uz: number;
}

/**
 * The belly to start a level with, given what was carried into it.
 *
 * The whole rule in one line, and it is a maximum rather than an assignment
 * on purpose: never less than the level can be flown on, never less than what
 * was earned.
 */
export const bellyOnEntry = (level: Level, carried: number): number =>
  Math.max(carried, level.health);

/** The line `at` metres along the way from `from` to `to`. */
export function crossingLine(
  from: { x: number; z: number },
  to: { x: number; z: number },
  at: number,
): Line {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const span = Math.hypot(dx, dz) || 1;
  const ux = dx / span;
  const uz = dz / span;
  return { x: from.x + ux * at, z: from.z + uz * at, ux, uz };
}

/** Whether a point is on the far side of the line. */
export const crossed = (line: Line, x: number, z: number): boolean =>
  (x - line.x) * line.ux + (z - line.z) * line.uz >= 0;

export const LEVELS: readonly Level[] = [
  {
    // The story's first beat rather than a flight: the hero on the home tree
    // with his mate and their egg, leaving. It is won on the instant it opens
    // -- he is already standing next to her -- so what the player does here
    // is read, answer, and take off.
    name: 'Heading out',
    // The tree itself. Unused for a perched start, which stands him on the
    // platform, but written down because a level without a place is not one.
    start: [47.493997, 19.096538],
    // Never used: a perched level puts him on the crest rather than in the
    // air over it. Stated anyway, at the height of the thing he is standing
    // on, so that taking `begins: 'perched'` away would leave a level that
    // still makes sense rather than one with a hole in it.
    release: HOME_TREE.height,
    // Hungry, which is the reason for everything that follows. The two of
    // them have been on this branch all night.
    health: 0.2,
    when: EVENING,
    target: { kind: 'landmark', name: HOME_TREE.name },
    // The pink one, and the only bird in the game wearing her colours. She
    // stands beside the nest rather than on it.
    person: { morph: 4, along: -0.4, across: 0.08 },
    dialogue: HEADING_OUT,
    begins: 'perched',
  },
  {
    // The errand, and the first flight of the game: most of a kilometre from
    // the branch he leaves to a slab of concrete in a park, with somebody
    // standing beside it. Nothing to fly round and nothing that moves, and
    // long on purpose -- landing is the hard part of this game, and a first
    // level that reaches the hard part twenty seconds in asks the player to
    // learn flying and landing at the same time. Nine hundred metres of
    // flapping first, and the slab is still there when he arrives.
    name: 'Across the park',
    // Twenty metres the far side of the home tree, so that the tree is the
    // first thing in front of him: he is released facing his target, the
    // target is most of a kilometre west, and the tree stands between. Being
    // put here from the menu or after a death is being put back at the top of
    // the same flight, looking at the same thing he looked at on leaving it.
    start: [47.494019, 19.096828],
    // Five metres over the crest he has just left, which is the whole
    // difference between this level and every other one: he is not dropped
    // into it from the sky, he is leaving a tree. It also means the flight
    // cannot be glided -- from twenty-three metres a pigeon covers about a
    // hundred and forty of the nine hundred.
    release: HOME_TREE.height + 5,
    // The same morning and nothing eaten yet: a fifth of a belly is about
    // six hundred metres, and this half is five.
    health: 0.2,
    when: EVENING,
    // The same slab the next level is about: the arrow points at the food for
    // the whole way there, because that is what he is doing. This half is
    // over when he is halfway, and nobody is standing on the line.
    target: { kind: 'landmark', name: PARK_PATCH.name },
    crossing: { at: 500, opens: 'Grabbing food' },
  },
  {
    // The second half of the same errand, and the reason it is a level of its
    // own: nine hundred metres is a long way to fly again because you misread
    // the last twenty. Crossing the line hands this over in the air -- so it
    // costs nothing while the flight is going well, and when it is not, this
    // is where the flight starts again.
    name: 'Grabbing food',
    // On the line, which is where he was when this became his level.
    start: [47.494062, 19.090192],
    // Forty metres: about what a bird has under it after half a kilometre of
    // flapping, and well clear of the park's own trees.
    release: 40,
    // Arrived on what is left, which by rights is almost nothing. A quarter
    // is what makes the last four hundred metres flyable when this level is
    // picked out of the menu -- and a floor, so flying the first half well
    // still counts for something.
    health: 0.25,
    when: EVENING,
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
    // High enough to see the whole approach and to reach it gliding.
    release: 100,
    // After the errand, and the errand was food. These three are flown on a
    // full belly because the story says he has eaten.
    health: 1,
    when: EVENING,
    target: { kind: 'landmark', name: LOFT.name },
    person: { morph: 1, along: 2.6, across: 0 },
    dialogue: GREETING,
  },
  {
    // A wagon of a running train, which is the first target that will not
    // wait for you.
    name: 'The Yard',
    start: [47.503261, 19.091374],
    // High enough to see the whole approach and to reach it gliding.
    release: 100,
    health: 1,
    when: EVENING,
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
    // High enough to see the whole approach and to reach it gliding.
    release: 100,
    health: 1,
    when: EVENING,
    target: { kind: 'landmark', name: WEST_PATCH.name },
    person: { morph: 3, along: 2.4, across: 0 },
    dialogue: GREETING,
  },
];
