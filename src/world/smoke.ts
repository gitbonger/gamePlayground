/**
 * Exhaust, as a handful of rising puffs.
 *
 * No Three.js here. A puff is a place and how far it has risen since it left
 * the stack; how it moves is a fixed climb plus whatever the wind is doing.
 * The renderer's only job is to draw a smudge wherever this says there is one.
 *
 * This used to be a proper particle system -- a hundred and fifty puffs a
 * second, each with its own velocity, dragged toward the wind sampled at its
 * own position, buoyant while it was hot. It looked right and it was the
 * largest thing in the simulation: three and a half thousand puffs advected a
 * hundred and twenty times a second, most of the cost being one wind lookup
 * per puff per tick.
 *
 * Almost all of that bought detail nobody can see. A plume is a column of
 * smoke leaning downwind, and a column of smoke leaning downwind is what one
 * puff a second gets you, if the puffs are big enough and grow as they climb.
 * So: one a second, a fixed climb, one wind vector for the lot of them.
 *
 * Puffs live in a fixed ring, because a thing that emits for as long as the
 * game is open should not be allocating.
 */

export interface Puff {
  x: number;
  y: number;
  z: number;
  /**
   * How far it has risen since it left the stack, in metres.
   *
   * Negative means the slot is empty. Everything about how a puff is drawn is
   * a function of this rather than of its age -- it is the same thing while
   * the climb is fixed, and it is the thing that is actually being described:
   * exhaust spreads and thins as it gets up and away, not as it gets old.
   */
  risen: number;
  /** Fixed per puff, so each one is drawn a little differently. */
  seed: number;
}

export interface SmokeOptions {
  /** Puffs a second. */
  rate: number;
  /** How fast one climbs, in m/s. Fixed: exhaust that has left is just air. */
  climb: number;
  /** How high it gets before it has dispersed entirely, in metres. */
  reach: number;
  /** Radius at the stack, in metres, and how much wider per metre risen. */
  size: number;
  spread: number;
}

/**
 * One puff a second, climbing slowly, growing to five times its width.
 *
 * At a climb of 1.2 m/s and a reach of 26 m a puff lasts about twenty-two
 * seconds, so a working engine carries twenty-two of them -- against the
 * 1,883 it used to. The spacing is what makes them a plume rather than a row
 * of balls: 1.2 m apart up the column and 3 m across at the bottom, so each
 * one already covers its neighbour when it is born and covers two of them by
 * the time it is halfway up.
 */
export const defaultSmokeOptions: SmokeOptions = {
  rate: 1,
  climb: 1.2,
  reach: 26,
  size: 1.5,
  spread: 0.2,
};

export interface Smoke {
  /** The ring. Slots with a negative `risen` are empty. */
  readonly puffs: readonly Puff[];
  /** How many are currently out. */
  readonly living: number;
  /**
   * Emit from `from` and move everything already out.
   *
   * `wind` is one vector for the whole plume rather than a lookup per puff.
   * Smoke a hundred metres long does not need to know that the air is doing
   * something slightly different at each end of it, and asking cost more than
   * everything else here put together.
   */
  update(
    dt: number,
    from: { x: number; y: number; z: number },
    wind: { x: number; y: number; z: number },
  ): void;
}

/** How wide a puff is, in metres. */
export function puffRadius(puff: Puff, options: SmokeOptions): number {
  return options.size + Math.max(0, puff.risen) * options.spread;
}

/**
 * How solid a puff is, 0 to 1.
 *
 * Thick the moment it is out, then thinning away over the climb. Squared on
 * the way out so it disperses rather than switching off, and eased in over
 * the first metre so it does not appear from nothing at the chimney.
 */
export function puffOpacity(puff: Puff, options: SmokeOptions): number {
  if (puff.risen < 0) return 0;
  const through = Math.min(1, puff.risen / options.reach);
  const leaving = Math.min(1, puff.risen / 1);
  const fading = 1 - through;
  return leaving * fading * fading;
}

/** Small deterministic PRNG, so a given run always makes the same smoke. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSmoke(
  options: SmokeOptions = defaultSmokeOptions,
  seed = 99,
): Smoke {
  const rand = mulberry32(seed);
  // Enough slots for everything that can be alive at once, and a little over.
  const capacity = Math.ceil(options.rate * (options.reach / options.climb)) + 4;

  const puffs: Puff[] = Array.from({ length: capacity }, () => ({
    x: 0,
    y: 0,
    z: 0,
    risen: -1,
    seed: 0,
  }));

  let next = 0;
  let owed = 0;
  let living = 0;

  return {
    puffs,
    get living() {
      return living;
    },
    update(dt, from, wind) {
      if (dt <= 0) return;

      // Lit where the stack is now, and nowhere else. Nothing is remembered
      // about where it was: a train that has reversed since the last puff did
      // not leave a trail through the place it used to be, and one that
      // changes speed did not leave an evenly spaced one.
      owed += options.rate * dt;
      while (owed >= 1) {
        owed -= 1;
        const puff = puffs[next]!;
        next = (next + 1) % capacity;
        puff.x = from.x;
        puff.y = from.y;
        puff.z = from.z;
        puff.risen = 0;
        puff.seed = rand();
      }

      living = 0;
      const up = options.climb * dt;
      for (const puff of puffs) {
        if (puff.risen < 0) continue;

        puff.risen += up;
        if (puff.risen >= options.reach) {
          puff.risen = -1;
          continue;
        }
        living += 1;

        puff.x += wind.x * dt;
        puff.y += up;
        puff.z += wind.z * dt;
      }
    },
  };
}
