/**
 * Seed, thrown and landed.
 *
 * Somebody stands by the concrete and throws grain, one piece at a time, at
 * no particular spot. The pigeon eats it. That is the whole of the food in
 * this game, and it is a physical object rather than a number going up: a
 * seed is thrown from a hand, arcs, lands, sits there, and is gone when it
 * has been eaten.
 *
 * Deliberately too big. A seed a bird would actually eat is three or four
 * millimetres, which at any altitude worth flying at is nothing at all --
 * invisible, and impossible to aim a landing at. A tenth of the pigeon is
 * about two centimetres, which is a grain of maize the size of a plum. It is
 * the same trade the nest and the headstones make: life size is the truth and
 * is not there.
 */

import type { Point2 } from './polygon';

/** A seed, in flight or at rest. */
export interface Seed {
  x: number;
  y: number;
  z: number;
  /** Metres a second. Zero once it has settled. */
  vx: number;
  vy: number;
  vz: number;
  /** Whether it has come to rest on the ground. */
  landed: boolean;
  /** When it was thrown, so the oldest can be found without a sort. */
  thrown: number;
}

/**
 * How big a seed is, in metres across: a fifth of the pigeon.
 *
 * Four and a half centimetres, which is twenty times life and a grain of
 * maize the size of a small plum. It started at a tenth of the pigeon, on the
 * grounds that a tenth is already absurd; a tenth is three pixels from
 * standing height and gone entirely from the air, and a thing you are meant
 * to walk over has to be a thing you can see from further away than your own
 * beak.
 */
export const SEED_SIZE = 0.045;
/** The ground the seeds land on, and the height they rest at. */
const REST = SEED_SIZE / 2;
/** Metres a second squared, downwards. The same gravity as everything else. */
const GRAVITY = 9.81;

/**
 * Advance every seed by one tick.
 *
 * Ballistic and nothing else: no drag, no bounce, no roll. A seed weighs a
 * gram and spends three quarters of a second in the air, over which drag
 * would move it by less than its own width, and it lands on concrete from
 * knee height rather than dropping onto it from a roof.
 */
export function flySeeds(seeds: Seed[], dt: number, ground = 0): void {
  for (const seed of seeds) {
    if (seed.landed) continue;
    seed.vy -= GRAVITY * dt;
    seed.x += seed.vx * dt;
    seed.y += seed.vy * dt;
    seed.z += seed.vz * dt;
    if (seed.y <= ground + REST) {
      seed.y = ground + REST;
      seed.vx = 0;
      seed.vy = 0;
      seed.vz = 0;
      seed.landed = true;
    }
  }
}

/**
 * The velocity that throws a seed from `from` to `to` in `flight` seconds.
 *
 * Solved rather than aimed: the thrower knows where the seed is to land, and
 * the arc follows from that and the time given. A flat lob and a high one are
 * both reachable, and which you get is the time.
 */
export function throwAt(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  flight: number,
): { vx: number; vy: number; vz: number } {
  return {
    vx: (to.x - from.x) / flight,
    // The vertical one carries the fall as well as the difference in height.
    vy: (to.y - from.y) / flight + 0.5 * GRAVITY * flight,
    vz: (to.z - from.z) / flight,
  };
}

/** Somebody standing by a patch of ground, throwing grain onto it. */
export interface Scatter {
  /** Every seed in the air or on the ground, oldest first. */
  readonly seeds: Seed[];
  /** Throw and fly, given the time since the last call and the clock. */
  update(dt: number, now: number): void;
  /** Take the seed at this index, because something has eaten it. */
  take(index: number): void;
}

export interface Scattering {
  /** Where the thrower stands, hand height included. */
  from: { x: number; y: number; z: number };
  /** The middle of the ground they are throwing at. */
  onto: { x: number; z: number };
  /** How far from that middle a seed may land. */
  spread: number;
  /** How many may be down at once. */
  most: number;
  /** Seconds between throws. */
  every: number;
  /** Random numbers, so a world can be built the same way twice. */
  random: () => number;
}

/**
 * A person feeding the birds, as a small machine.
 *
 * The limit is what makes it a scatter rather than a heap: at `most` seeds
 * down, the oldest is picked up and thrown again somewhere else, so the
 * ground keeps a constant handful and it is never the same handful. Which is
 * also, conveniently, exactly what somebody with a bag of grain looks like
 * from thirty metres up.
 */
export function createScatter(spec: Scattering): Scatter {
  const seeds: Seed[] = [];
  let next = 0;

  const toss = (now: number) => {
    // Anywhere on the ground they are aiming at, in a disc rather than a
    // square: grain thrown by hand does not land in a rectangle.
    const angle = spec.random() * Math.PI * 2;
    const away = Math.sqrt(spec.random()) * spec.spread;
    const to = {
      x: spec.onto.x + Math.cos(angle) * away,
      // Aimed at where the seed will sit rather than at the ground under it.
      // A seed comes to rest on its own radius, so a throw solved to y=0
      // touches down early and lands short by half its own width -- which is
      // nothing at three millimetres and visible at four centimetres.
      y: REST,
      z: spec.onto.z + Math.sin(angle) * away,
    };
    // A little under a second in the air: a lob rather than a bowl.
    const flight = 0.7 + spec.random() * 0.3;
    const speed = throwAt(spec.from, to, flight);
    const seed: Seed = {
      x: spec.from.x,
      y: spec.from.y,
      z: spec.from.z,
      ...speed,
      landed: false,
      thrown: now,
    };

    // At the limit the oldest is picked up rather than a new one added. The
    // ground holds a handful and it is never the same handful.
    if (seeds.length >= spec.most) seeds.shift();
    seeds.push(seed);
  };

  return {
    seeds,
    update(dt, now) {
      flySeeds(seeds, dt);
      if (now < next) return;
      // Set from the throw rather than added to, so a long frame does not
      // make up for lost time with a burst.
      next = now + spec.every;
      toss(now);
    },
    take(index) {
      if (index >= 0 && index < seeds.length) seeds.splice(index, 1);
    },
  };
}

/**
 * The seed within reach of a bird standing at this point, or -1.
 *
 * Nearest first, so walking into a scatter takes them one at a time and in
 * the order a bird would: whichever is under its beak.
 */
export function seedWithin(
  seeds: readonly Seed[],
  x: number,
  z: number,
  reach: number,
): number {
  let found = -1;
  let nearest = reach * reach;
  for (const [index, seed] of seeds.entries()) {
    if (!seed.landed) continue;
    const away = (seed.x - x) ** 2 + (seed.z - z) ** 2;
    if (away <= nearest) {
      nearest = away;
      found = index;
    }
  }
  return found;
}

/** Where the seeds are, for anything that wants to draw or aim at them. */
export const seedPoints = (seeds: readonly Seed[]): Point2[] =>
  seeds.map((seed) => [seed.x, seed.z] as Point2);
