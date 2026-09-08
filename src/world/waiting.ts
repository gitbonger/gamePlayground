/**
 * Who is standing on a tram platform, and where.
 *
 * Its own file because it is asked twice: once when the world is built, and
 * again every time a tram pulls away from a stop. The rule has to be the same
 * both times -- a platform that fills up differently after the first tram
 * would be a platform that was never really populated, just decorated.
 *
 * The tram is what makes this move at all. People wait, a tram comes, they
 * get on and it takes them away; the ones standing there a minute later are
 * different people who arrived while it was gone. Nothing here models any of
 * that -- there is no boarding and nobody walks -- but a platform that empties
 * when a tram calls and fills again after it leaves reads as all of it, which
 * is the whole trick.
 */

import { SHELTER, type Waiting } from './layout';

/** How many wait on one: a few, never none, never a crowd. */
export const WAITING = { least: 1, most: 5 };

/**
 * How often somebody has a dog with them.
 *
 * A quarter. Often enough to be a thing you notice on a flight across the
 * district, rare enough that noticing it is still worth something.
 */
export const DOG_SHARE = 0.25;

/** How far from its owner a dog stands, in metres. */
const LEAD = 0.8;

export type { Waiting };

/** Just enough of a platform to stand somebody on it. */
export interface Standable {
  x: number;
  z: number;
  /** Along the platform. */
  width: number;
  /** Across it. */
  depth: number;
  yaw: number;
  height: number;
  /** Where the shelters are, as distances from the middle. */
  shelters: readonly number[];
}

/**
 * Fill a platform.
 *
 * Facing along the line rather than any which way, because that is what
 * waiting for a tram looks like: everyone turned the way it comes from, give
 * or take. Which of the two ways is a coin, since a platform serves one
 * direction and nothing here knows which.
 */
export function crowdOn(stop: Standable, random: () => number): Waiting[] {
  const cos = Math.cos(stop.yaw);
  const sin = Math.sin(stop.yaw);
  const clearOfHuts = (run: number) =>
    !stop.shelters.some((at) => Math.abs(run - at) < SHELTER.long / 2 + 0.5);

  const many = WAITING.least + Math.floor(random() * (WAITING.most - WAITING.least + 1));
  const waiting: Waiting[] = [];
  for (let i = 0; i < many; i += 1) {
    // Kept off the ends, and out of the huts -- a figure inside a solid box
    // is a figure nobody sees, and the one place it would be worth standing.
    //
    // Tried a few times rather than skipped, so a short platform with a hut
    // down the middle of it still has somebody on it. Six goes and then
    // wherever it landed: a platform that cannot fit a person beside its own
    // shelter is one the player will never be close enough to count.
    let run = 0;
    for (let go = 0; go < 6; go += 1) {
      run = (random() - 0.5) * Math.max(0, stop.width - 2);
      if (clearOfHuts(run)) break;
    }
    const across = (random() - 0.5) * (stop.depth - 1.2);
    const facing = stop.yaw + (random() < 0.5 ? 0 : Math.PI) + (random() - 0.5) * 0.6;
    const at = (run2: number, across2: number) => ({
      x: stop.x + run2 * cos + across2 * sin,
      z: stop.z - run2 * sin + across2 * cos,
    });
    // The dog first, so that whether there is one does not depend on how many
    // random numbers the person before it happened to use.
    const hasDog = random() < DOG_SHARE;
    const beside = random() < 0.5 ? -LEAD : LEAD;
    waiting.push({
      person: { ...at(run, across), base: stop.height, facing },
      dog: hasDog
        ? {
            ...at(run + beside, across),
            // Looking at whoever is holding the lead, near enough.
            facing: facing + (random() - 0.5) * 1.6,
          }
        : null,
    });
  }
  return waiting;
}
