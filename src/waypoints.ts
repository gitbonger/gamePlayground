import { crossed, type Line } from './levels';

/**
 * Marks strung along a route, one showing at a time.
 *
 * Help and nothing else. A waypoint is not a target, it does not finish
 * anything, and passing all of them does not do anything at all -- it is a
 * line of breadcrumbs for a player who cannot see where the level wants them
 * to go. Nothing in the story knows they exist.
 *
 * One at a time on purpose. A route drawn all at once is a map, and reading a
 * map is a different activity from flying: the player looks at the whole
 * shape, works out a plan, and stops looking out of the window. One mark is a
 * direction, which is a thing you can hold in your head while flying at it.
 *
 * Reached in plan rather than through the air, because height is the player's
 * business here: the level below this one wants them under twenty metres and
 * the one above wants them over the roofs, and a mark that had to be flown
 * through at a particular altitude would be arguing with both.
 */

/**
 * How near, in metres on the ground, counts as having got there.
 *
 * Twenty, by way of five and ten. This is the number that decides whether the
 * help helps: a mark you have to hit is a second game played alongside the
 * one you meant to play, and a player lining up a column from four hundred
 * metres out with a crow on their tail is not going to hit it. Nothing else
 * about the mark changes with it -- the column is the size it looks.
 */
export const REACHED = 20;

/** One mark, placed, and what passing it takes. */
export interface Placed {
  x: number;
  z: number;
  /**
   * The line square across the route through it, for a mark that is a line.
   *
   * Left out for one that is a place, and that absence is the whole of the
   * difference: a place is reached by being near it and a line by getting to
   * the far side of it. See `Waypoint` in `levels.ts`.
   */
  across?: Line;
}

export interface Waymarks {
  /** The one showing now, or null once they have all been passed. */
  readonly at: { x: number; z: number } | null;
  /**
   * The one after it, or null when this is the last.
   *
   * For the arrow at the foot of the mark, which points at where you are
   * going *next* -- so a mark says both "here" and "then that way", and the
   * player turns before they arrive rather than after.
   */
  readonly next: { x: number; z: number } | null;
  /** How many are still to come, including the one showing. */
  readonly left: number;
  /**
   * Which one is showing, counting from nought.
   *
   * For anything that has to find the thing painted on the ground for it:
   * a line's stripe is built with the world, one per mark, and this is how
   * the right one is picked out. Past the last, it is the number of them.
   */
  readonly index: number;
  /**
   * Take the bird's position on the ground, and say whether one was passed.
   *
   * True on the tick a mark is reached, so a caller can make a noise about it
   * if it ever wants to. Passing several in one tick is possible in principle
   * and handled: at a hundred and twenty ticks a second a pigeon covers
   * sixteen centimetres, so it would take marks stacked on top of each other,
   * but a rule that quietly skipped one would be a rule that stranded the
   * player on a mark they had already flown through.
   */
  update(x: number, z: number): boolean;
}

export function createWaymarks(points: readonly Placed[]): Waymarks {
  let at = 0;

  /**
   * Whether the mark showing has been passed.
   *
   * Two questions, and which one gets asked is the mark's own business: a
   * place is near enough, a line has been got to the far side of. Everything
   * else here -- the order, the arrow to the next one, the counting -- is the
   * same for both, which is why they are one list rather than two.
   */
  const passed = (x: number, z: number) => {
    const point = points[at];
    if (!point) return false;
    if (point.across) return crossed(point.across, x, z);
    return Math.hypot(point.x - x, point.z - z) <= REACHED;
  };

  return {
    get at() {
      return points[at] ?? null;
    },
    get next() {
      return points[at + 1] ?? null;
    },
    get left() {
      return Math.max(0, points.length - at);
    },
    get index() {
      return at;
    },
    update(x, z) {
      let any = false;
      while (passed(x, z)) {
        at += 1;
        any = true;
      }
      return any;
    },
  };
}
