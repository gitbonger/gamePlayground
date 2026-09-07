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

import { createBird, isPerched, type BirdState, type FlightParams } from './sim/flight';
import { neutralWalk, standStill, turnToFace, walk, type WalkControls } from './sim/walk';
import type { Collider } from './sim/collision';
import { vec } from './sim/math3';

/** One of them: a bird on its feet with somewhere to be. */
export interface Helper {
  state: BirdState;
  controls: WalkControls;
  /** Which of the flock's colours it is drawn in. */
  morph: number;
}

/**
 * How long after they arrive before the cage gives way, in seconds.
 *
 * Five. Long enough for the nearest of them to have reached it and the
 * furthest to still be coming, which is what makes it read as thirty birds
 * doing something rather than a timer running out.
 */
export const BREAKS_AFTER = 5;

/** How near the cage a bird stops, in metres. Just off it, not inside it. */
const CLOSE_ENOUGH = 1.1;

export interface Rescue {
  readonly helpers: readonly Helper[];
  /** Seconds since they appeared. */
  readonly age: number;
  /** Whether the cage has come apart yet. */
  readonly broken: boolean;
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
    const state = createBird(vec(x, spec.ground, z), 0, looking);
    // On their feet from the first frame: they did not land, they are simply
    // there. `standStill` is the same call the game makes for anybody who is
    // standing somewhere.
    standStill(state);
    state.health = 1;
    return { state, controls: neutralWalk(), morph: Math.floor(random() * spec.morphs) };
  });

  let age = 0;

  return {
    helpers,
    get age() {
      return age;
    },
    get broken() {
      return age >= BREAKS_AFTER;
    },
    update(dt, collider) {
      age += dt;
      const to = vec(spec.cage.x, spec.ground, spec.cage.z);

      for (const helper of helpers) {
        if (!isPerched(helper.state)) continue;

        const away = Math.hypot(
          helper.state.position.x - spec.cage.x,
          helper.state.position.z - spec.cage.z,
        );
        // Arrived: it stands where it is and looks at the thing. A bird that
        // kept walking would push into the cage and shuffle against it, which
        // reads as being stuck rather than as being there.
        turnToFace(helper.state, to, spec.flight, dt);
        helper.controls.forward = away > CLOSE_ENOUGH ? 1 : 0;
        helper.controls.turn = 0;
        helper.controls.launch = false;
        walk(helper.state, helper.controls, spec.flight, dt, collider);
      }
    },
  };
}
