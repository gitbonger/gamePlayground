/**
 * The end of the story: thirty birds walking up to a cage and taking it apart.
 *
 * ## Why this is not the flock landing
 *
 * It was, and it did not work. The flock flies at spots on the ground and the
 * flight model judges the touchdown, which is honest and produces nothing you
 * can watch: the last level is a hundred and fifty-five metres long and a
 * flock lets one bird out at a time, so by the time the hero is on the roof
 * there are four of them in the sky and twenty-six still in the loft. What
 * arrives is not a flock.
 *
 * So this is the cheat, and it is worth saying plainly that it is one. The
 * flock goes away, thirty birds appear behind the hero already on their feet,
 * and they walk to the cage. Nobody sees them arrive because they arrive
 * behind the camera, which is the same trick the flock's own spawn point uses
 * and for the same reason.
 *
 * What it buys is the beat: thirty birds converging on one thing, and then
 * the thing coming apart. That is the shot the whole game has been walking
 * towards, and it should not be at the mercy of twenty-six separate landings.
 */

import { createBird, type BirdState, type FlightParams } from './sim/flight';
import { neutralWalk, standStill, turnToFace, walk, type WalkControls } from './sim/walk';
import type { Collider } from './sim/collision';
import { vec, type Vec3 } from './sim/math3';

/**
 * What one of them is in the middle of.
 *
 * They do not all arrive at once and they do not all set to work at once,
 * which is the whole of what makes it read as thirty birds rather than as an
 * effect: `coming` is the glide down, `settling` is the pause on the roof
 * after the feet are down, `going` is the walk over, and `working` is what
 * they came for.
 */
export type Doing = 'coming' | 'settling' | 'going' | 'working';

/** One of them: a bird with somewhere to be and something to do there. */
export interface Helper {
  state: BirdState;
  controls: WalkControls;
  /** Which of the flock's colours it is drawn in. */
  morph: number;
  doing: Doing;
  /**
   * Seconds left of whatever it is doing, where that is timed.
   *
   * The wait on the roof, and the gap between one peck at the cage and the
   * next. Nought while it is walking, which ends by arriving rather than by
   * running out.
   */
  left: number;
  /** Where it comes down from, and the spot it comes down to. */
  from: Vec3;
  to: Vec3;
  /** Seconds until this one starts down, so they do not all drop together. */
  waits: number;
}

/**
 * How long the glide down takes, in seconds, and how far it comes from.
 *
 * They used to be standing on the roof from the first frame -- the cheat is
 * explained above and it is still a cheat -- but arriving *at all* is worth
 * having, and a scripted glide is a good deal cheaper than thirty separate
 * touchdowns judged by the flight model. Thirty metres of run for twelve of
 * height is about a five-to-one glide, which is what a pigeon does.
 */
const COMES_DOWN = 2.2;
const GLIDE_RUN = 30;
const GLIDE_UP = 12;
/**
 * How far apart their arrivals are spread, in seconds.
 *
 * Thirty birds touching down on the same frame is a single event; spread over
 * a second and a half it is a flock coming in.
 */
const SPREAD = 1.5;

/**
 * How long one stands on the roof before going for the cage, in seconds.
 *
 * Five. They have just flown across the district and the thing they came for
 * is right there, and walking straight into it off the landing gives the
 * whole arrival no weight at all.
 */
export const SETTLES = 5;

/** Seconds between one bird's go at the cage and its next. */
export const PECK_EVERY = 5;
/**
 * How many goes each of them has before the cage gives way.
 *
 * The cage used to come apart five seconds after they appeared, on a timer
 * that knew nothing about whether anybody had reached it. Now it comes apart
 * when it has been worked at enough, which with thirty birds is about four
 * times as long -- and every hit shows on the bar, so the wait is something
 * being watched rather than something being sat through.
 */
export const ROUNDS = 4;

/** How near the cage a bird stops, in metres. Just off it, not inside it. */
const CLOSE_ENOUGH = 1.1;

export interface Rescue {
  readonly helpers: readonly Helper[];
  /** Seconds since they appeared. */
  readonly age: number;
  /** What is left of the cage, 1 down to 0. */
  readonly health: number;
  /** Whether the cage has come apart yet. */
  readonly broken: boolean;
  /** Whether any of them has reached it, which is when the bar is worth showing. */
  readonly started: boolean;
  update(dt: number, collider?: Collider): void;
}

export interface Rescuing {
  /**
   * The roof they appear on: where it is, how big, and which way it is
   * turned.
   *
   * Spread over the whole of it rather than bunched behind the hero, which is
   * what this was at first. They have to be seen to *come* -- thirty birds
   * already standing round the cage is thirty birds who were always there,
   * and the walk up to it is the piece of the story that this whole cheat
   * exists to buy. So they arrive at the far corners and converge.
   */
  terrace: { x: number; z: number; width: number; depth: number; yaw: number };
  /** The cage they are going for. */
  cage: { x: number; z: number };
  /** The height of the roof they are all standing on. */
  ground: number;
  many: number;
  morphs: number;
  flight: FlightParams;
  random?: () => number;
}

/**
 * How near the cage one may appear, in metres.
 *
 * Nobody starts inside this. It is the difference between a flock that
 * arrived and a flock that was always standing there, and it is the whole
 * reason they are scattered over a terrace instead of dropped where they are
 * wanted.
 */
const NO_NEARER = 5;

/**
 * A bird standing still, which is what the walk model calls doing nothing.
 *
 * Written over rather than made fresh, because it is asked for thirty times a
 * tick and a walk control is three booleans.
 */
const standing = (controls: WalkControls): WalkControls => {
  controls.forward = 0;
  controls.turn = 0;
  controls.launch = false;
  return controls;
};

/**
 * One bird on its way down, moved along its glide.
 *
 * Flown by hand rather than by the flight model, and that is the cheat this
 * whole file is: thirty touchdowns judged properly is thirty birds making a
 * mess of it in thirty different ways, and what is wanted is a flock coming
 * in. What it borrows from the real thing is the shape -- decelerating into
 * the roof rather than arriving at cruise, so the last metre reads as
 * settling and not as landing on rails.
 *
 * The velocity is written down as well as the position. Nothing simulates
 * with it; the rig poses the wings off it, and a bird gliding at nought looks
 * like a bird falling.
 */
function comeDown(helper: Helper, dt: number): void {
  if (helper.waits > 0) {
    helper.waits -= dt;
    return;
  }
  helper.left += dt;
  const through = Math.min(1, helper.left / COMES_DOWN);
  // Eased out, so it flares into the touchdown instead of driving into it.
  const eased = 1 - (1 - through) * (1 - through);
  const was = helper.state.position;
  helper.state.position = vec(
    helper.from.x + (helper.to.x - helper.from.x) * eased,
    helper.from.y + (helper.to.y - helper.from.y) * eased,
    helper.from.z + (helper.to.z - helper.from.z) * eased,
  );
  helper.state.velocity = vec(
    (helper.state.position.x - was.x) / Math.max(dt, 1e-6),
    (helper.state.position.y - was.y) / Math.max(dt, 1e-6),
    (helper.state.position.z - was.z) / Math.max(dt, 1e-6),
  );

  if (through < 1) return;
  // Down. `standStill` is the same call the game makes for anybody who is
  // simply standing somewhere, and from here it is the walk model's bird.
  standStill(helper.state);
  helper.state.position = helper.to;
  helper.doing = 'settling';
  helper.left = SETTLES;
}

export function beginRescue(spec: Rescuing): Rescue {
  const random = spec.random ?? Math.random;

  /**
   * Where the nth of them stands, in the terrace's own frame.
   *
   * Laid out on a grid rather than scattered at random, and then jogged: a
   * random scatter of thirty over a rectangle leaves holes you can see and
   * pairs standing on each other, and what is wanted is the roof *covered*.
   * The jog is what stops the grid reading as a grid.
   */
  const spot = (i: number) => {
    const columns = Math.max(1, Math.ceil(Math.sqrt(spec.many)));
    const rows = Math.max(1, Math.ceil(spec.many / columns));
    const column = i % columns;
    const row = Math.floor(i / columns);
    // Inset by half a cell, so nobody is put on the parapet.
    const along = ((column + 0.5) / columns - 0.5) * spec.terrace.width;
    const across = ((row + 0.5) / rows - 0.5) * spec.terrace.depth;
    return {
      along: along + (random() - 0.5) * (spec.terrace.width / columns) * 0.5,
      across: across + (random() - 0.5) * (spec.terrace.depth / rows) * 0.5,
    };
  };

  const helpers: Helper[] = Array.from({ length: spec.many }, (_, i) => {
    const on = spot(i);
    const cos = Math.cos(spec.terrace.yaw);
    const sin = Math.sin(spec.terrace.yaw);
    let x = spec.terrace.x + on.along * cos - on.across * sin;
    let z = spec.terrace.z + on.along * sin + on.across * cos;

    // Nobody starts on top of the cage. Pushed straight out from it rather
    // than re-rolled, so the grid keeps its shape and the ring round the cage
    // is a ring rather than a hole.
    const out = Math.hypot(x - spec.cage.x, z - spec.cage.z);
    if (out < NO_NEARER) {
      const away = out > 1e-6 ? out : 1;
      x = spec.cage.x + ((x - spec.cage.x) / away) * NO_NEARER;
      z = spec.cage.z + ((z - spec.cage.z) / away) * NO_NEARER;
    }

    // Facing the cage from the first frame: they came for it.
    const looking = Math.atan2(spec.cage.x - x, -(spec.cage.z - z));
    // Coming in along the way it is facing, from behind and above: a glide
    // rather than a drop. Where it starts is where it would have been a
    // couple of seconds ago had it flown the approach itself.
    const to = vec(x, spec.ground, z);
    const from = vec(
      x - Math.sin(looking) * GLIDE_RUN,
      spec.ground + GLIDE_UP,
      z + Math.cos(looking) * GLIDE_RUN,
    );
    const state = createBird(from, 0, looking);
    state.health = 1;
    return {
      state,
      controls: neutralWalk(),
      morph: Math.floor(random() * spec.morphs),
      doing: 'coming' as Doing,
      left: 0,
      from,
      to,
      // Spread over the flock in the order they were laid out, jogged so the
      // grid does not arrive in rows.
      waits: (i / Math.max(1, spec.many - 1)) * SPREAD + random() * 0.25,
    };
  });

  let age = 0;
  /** What is left of the cage: one whole cage down to none of it. */
  let health = 1;
  /** How much one go at it takes off, so that `ROUNDS` each finishes it. */
  const perPeck = 1 / Math.max(1, spec.many * ROUNDS);

  return {
    helpers,
    get age() {
      return age;
    },
    get health() {
      return health;
    },
    get broken() {
      return health <= 0;
    },
    get started() {
      return helpers.some((helper) => helper.doing === 'working');
    },
    update(dt, collider) {
      age += dt;
      const at = vec(spec.cage.x, spec.ground, spec.cage.z);

      for (const helper of helpers) {
        if (helper.doing === 'coming') {
          comeDown(helper, dt);
          continue;
        }

        // Standing about, having just got here. Facing the thing but not yet
        // going to it: they have flown across the district and it is right
        // there, and walking into it off the landing gives the arrival no
        // weight at all.
        turnToFace(helper.state, at, spec.flight, dt);
        if (helper.doing === 'settling') {
          helper.left -= dt;
          if (helper.left <= 0) {
            helper.doing = 'going';
            helper.left = 0;
          }
          walk(helper.state, standing(helper.controls), spec.flight, dt, collider);
          continue;
        }

        const away = Math.hypot(
          helper.state.position.x - spec.cage.x,
          helper.state.position.z - spec.cage.z,
        );
        if (helper.doing === 'going' && away <= CLOSE_ENOUGH) {
          // Arrived, and the first go at it lands now rather than five
          // seconds later: the bar should start moving when the birds get
          // there, which is when the player starts watching it.
          helper.doing = 'working';
          helper.left = 0;
        }

        if (helper.doing === 'working') {
          helper.left -= dt;
          if (helper.left <= 0) {
            health = Math.max(0, health - perPeck);
            helper.left = PECK_EVERY;
          }
        }

        // A bird that kept walking would push into the cage and shuffle
        // against it, which reads as being stuck rather than as being there.
        helper.controls.forward = helper.doing === 'going' ? 1 : 0;
        helper.controls.turn = 0;
        helper.controls.launch = false;
        walk(helper.state, helper.controls, spec.flight, dt, collider);
      }
    },
  };
}
