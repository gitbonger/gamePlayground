/**
 * What finishes a level.
 *
 * One rule per kind of ending, in one place, asked the same way. It lived in
 * `main.ts` as a switch inside a closure over the bird and the marker, which
 * meant the answer to "when is this level over?" could only be found by
 * reading the frame loop -- and could not be asked a question by a test.
 *
 * Every rule is handed the same four facts and the time since it was last
 * asked. Four is all of them: whether the feet are down, how far the thing
 * the level named still is, how full the belly is, and whether the line has
 * been crossed. A rule that wanted a fifth would be a rule about something
 * other than finishing.
 */

import type { Finish, Opens } from './levels';

/**
 * How near a level's target counts as having arrived at it, in metres.
 *
 * Half again the widest square, so landing anywhere on one of them -- or
 * beside it, on the pavement -- counts. The alternative is a player who has
 * plainly got there being told they have not: a square is a *place*, and a
 * rule that wanted the middle of it would be a spot landing wearing a story's
 * clothes.
 */
export const ARRIVED_WITHIN = 22;

/**
 * How long the feet have to be down on it, in seconds.
 *
 * Two. It used to be nought -- the level ended on the frame the feet touched
 * -- and that is a landing rather than an arrival: he has come to a square to
 * look for somebody, and the looking took no time at all. Two seconds is long
 * enough to walk a few steps and see that she is not there, which is the
 * whole of what these levels are about.
 *
 * Counted up rather than watched for in one go: a bird that lands, hops off
 * the kerb and comes back has still spent its two seconds on the square.
 */
export const LINGERS = 2;

/** What the game knows about a level in progress. */
export interface Progress {
  /** On its feet. */
  perched: boolean;
  /** Metres to the thing the level named, or Infinity where it named none. */
  toTarget: number;
  /** How full the belly is, 0 to 1. */
  belly: number;
  /** Whether the finishing line, if the level has one, is behind us. */
  overTheLine: boolean;
}

export interface Ending {
  /**
   * Whether the level is over, asked every tick with the time since the last.
   *
   * Takes the time because one of them is a dwell rather than a threshold,
   * and a rule that had to be told the clock separately would be a rule that
   * could be asked without it.
   */
  done(at: Progress, dt: number): boolean;
  opens: Opens;
}

/**
 * The rule that ends a level, or null for one that ends some other way.
 *
 * Two kinds end elsewhere and say so by returning nothing: one you finish by
 * walking up to somebody, which is the conversation's business, and one that
 * does not finish at all.
 */
export function endingFor(finish: Finish): Ending | null {
  if (finish.kind === 'meeting' || finish.kind === 'free') return null;

  // Eaten. There is no arrival to test, only a bird that has had enough --
  // which it can reach standing still in one spot, and usually does.
  if (finish.kind === 'fed') {
    return { done: (at) => at.belly >= 1, opens: finish.opens };
  }

  // Crossed. The line is worked out where the stripe is painted, so the rule
  // and the paint cannot disagree about where it is.
  if (finish.kind === 'crossing') {
    return { done: (at) => at.overTheLine, opens: finish.opens };
  }

  // Arrived, and stayed. On its feet, on the thing the level named, for long
  // enough to have looked round it.
  let stood = 0;
  return {
    done: (at, dt) => {
      if (!at.perched || at.toTarget > ARRIVED_WITHIN) return false;
      stood += dt;
      return stood >= LINGERS;
    },
    opens: finish.opens,
  };
}
