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
  /** Where the hero is standing, and which way he is facing. */
  behind: { x: number; z: number; heading: number };
  /** The cage they are going for. */
  cage: { x: number; z: number };
  /** The height of the roof they are all standing on. */
  ground: number;
  many: number;
  morphs: number;
  flight: FlightParams;
  random?: () => number;
}

export function beginRescue(spec: Rescuing): Rescue {
  const random = spec.random ?? Math.random;

  const helpers: Helper[] = Array.from({ length: spec.many }, (_, i) => {
    // In an arc behind him, three deep, so it reads as a crowd that came with
    // him rather than a rank that was drawn up. Behind is his heading turned
    // half a circle.
    const back = spec.behind.heading + Math.PI;
    const rows = 3;
    const row = i % rows;
    const along = 2.5 + row * 1.6 + random() * 0.7;
    // Spread across the arc, widening with each row back.
    const across = ((i / spec.many) * 2 - 1) * (2.2 + row * 1.1) + (random() - 0.5) * 0.8;

    const x = spec.behind.x + Math.sin(back) * along + Math.cos(back) * across;
    const z = spec.behind.z - Math.cos(back) * along + Math.sin(back) * across;

    const state = createBird(vec(x, spec.ground, z), 0, spec.behind.heading);
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
