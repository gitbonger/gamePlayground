/**
 * The pigeons who are just there.
 *
 * Two kinds of bird in this game are not the player, and it is worth being
 * exact about which is which, because they are built out of the same parts:
 *
 *  - an **interactive NPC** has business with the player. It stands on the
 *    thing a level is about, waits to be walked up to, and says something.
 *    Those are the `residents`, and they do not move.
 *  - an **ambient NPC** has business with nobody. It is there so that the
 *    place looks like a place: pigeons on a square, a flock over a rooftop.
 *    Nothing it does changes the game.
 *
 * The flock is a special case of the second kind -- ambient NPCs that happen
 * to be flying and happen to stay near the player. These are the other case:
 * ambient NPCs on their feet, pottering about on the concrete where somebody
 * is throwing grain, because a person feeding pigeons with no pigeons in
 * front of them is a person throwing food on the ground.
 *
 * They walk and fly the same models the player does -- `walk` for the
 * pottering, `steer` and `step` once something has put them in the air -- so
 * there is nothing here that could disagree with the rest of the world about
 * how a pigeon moves.
 */

import {
  createBird,
  neutralControls,
  step,
  type BirdState,
  type Controls,
  type FlightParams,
} from './sim/flight';
import { standStill, takeOff, walk } from './sim/walk';
import {
  distanceTo,
  steer,
  type AutopilotParams,
  type AutopilotState,
  type Waypoint,
} from './sim/autopilot';
import { startWander, steerWander, type Wander } from './sim/wander';
import { escortAutopilot } from './flock';
import type { Collider } from './sim/collision';
import type { WindField } from './sim/wind';
import { vec } from './sim/math3';
import { pointOn } from './world/layout';

/** The flat thing they are standing on, in the world's frame. */
export interface Ground {
  x: number;
  z: number;
  /** Which way it is turned, so a bird is placed along the slab, not the map. */
  yaw: number;
  width: number;
  depth: number;
  /** The height of its surface, which is what they stand on. */
  top: number;
}

export interface AmbientPigeon {
  state: BirdState;
  /** Which colour it is drawn in, as an index into `PIGEON_MORPHS`. */
  morph: number;
  /** Its circle and its errand, while it is on its feet. */
  wander: Wander;
  /** Where it is making for once it has been put up; null on the ground. */
  aiming: Waypoint | null;
}

export interface Ambient {
  readonly birds: readonly AmbientPigeon[];
  update(dt: number, collider: Collider | undefined, wind: WindField): void;
  /**
   * Something took off here: put up everything close enough to have seen it.
   *
   * Pigeons do not decide to fly one at a time. One bird leaving is the only
   * warning the rest of them get, and they go with it -- which is why walking
   * into a flock scatters the flock rather than the nearest three.
   *
   * Says how many went up, which is the only thing a caller could want from
   * it and is what makes it checkable.
   */
  startle(x: number, z: number, within?: number): number;
}

/**
 * How near a take-off has to be to put the others up, in metres.
 *
 * Twenty is about as far as a pigeon on the ground takes notice of another
 * one leaving. Beyond that they carry on feeding, which is the other half of
 * the behaviour and just as recognisable: a square where every bird goes up
 * whenever any bird goes up is a square with one enormous nervous animal on
 * it rather than thirty small ones.
 */
export const CONTAGION = 20;

/**
 * Where a startled bird heads for: up, and off the square.
 *
 * Nothing brings it back down again. A flushed pigeon that settles four
 * seconds later was never flushed, and the ones that matter here are gone by
 * then anyway -- the player has taken off, and the square is behind them.
 */
const FLUSH_LEAST = 30;
const FLUSH_MOST = 60;
const FLUSH_HEIGHT = 25;
const FLUSH_SPREAD = 15;
/** Near enough to the point it was making for to pick another, in metres. */
const FLUSH_ARRIVED = 12;

/** Kept off the very edge of the slab, so nobody starts half over the drop. */
const INSET = 0.5;

export interface AmbientOptions {
  /** How many, and the ground they live on. */
  count: number;
  ground: Ground;
  /** How far from home each of them wanders. */
  range?: number;
  /** How many colours there are to draw them in. */
  morphs: number;
  random?: () => number;
  flight: FlightParams;
  autopilot?: AutopilotParams;
}

export function createAmbient(options: AmbientOptions): Ambient {
  const random = options.random ?? Math.random;
  const { ground, flight } = options;
  const flying = options.autopilot ?? escortAutopilot;

  interface Bird {
    pigeon: AmbientPigeon;
    walking: ReturnType<typeof steerWander>;
    controls: Controls;
    memory: AutopilotState;
  }

  const birds: Bird[] = [];
  for (let i = 0; i < options.count; i += 1) {
    // Home is somewhere on the slab, placed in the slab's own frame with the
    // same `pointOn` the people and the residents use, so turning the
    // concrete turns the birds standing on it. The wandering happens around
    // home, so one may stray a little over the edge and walk back -- which is
    // what they do: the grain is on the concrete, so that is where they are,
    // roughly.
    const home = pointOn(
      ground,
      (random() - 0.5) * Math.max(0, ground.width - INSET * 2),
      (random() - 0.5) * Math.max(0, ground.depth - INSET * 2),
    );
    const state = createBird(
      vec(home.x, ground.top + flight.bodyRadius, home.z),
      0,
      random() * Math.PI * 2,
    );
    standStill(state);
    birds.push({
      pigeon: {
        state,
        morph: Math.floor(random() * options.morphs),
        wander: startWander(home, random, options.range),
        aiming: null,
      },
      walking: { forward: 0, turn: 0, launch: false },
      controls: neutralControls(),
      memory: { beating: true },
    });
  }

  /** Somewhere up and away from home, for a bird that has just been put up. */
  const flushTo = (pigeon: AmbientPigeon): Waypoint => {
    const around = random() * Math.PI * 2;
    const away = FLUSH_LEAST + random() * (FLUSH_MOST - FLUSH_LEAST);
    return {
      x: pigeon.wander.home.x + Math.cos(around) * away,
      z: pigeon.wander.home.z + Math.sin(around) * away,
      altitude: ground.top + FLUSH_HEIGHT + random() * FLUSH_SPREAD,
    };
  };

  return {
    birds: birds.map((bird) => bird.pigeon),

    update(dt, collider, wind) {
      for (const bird of birds) {
        const { pigeon } = bird;
        // They do not eat, for the same reason the flock does not: an empty
        // belly stops a bird recovering and brings it down, and scenery that
        // starves to death in the middle of somebody's level is scenery
        // failing at the one thing it is for. That they are standing in a
        // heap of grain and not eating it is a fair complaint, and the answer
        // is that the grain is the player's meal, not theirs.
        pigeon.state.health = 1;

        if (pigeon.state.ending?.kind === 'landed') {
          pigeon.aiming = null;
          const wanted = steerWander(pigeon.state, pigeon.wander, dt, random, options.range);
          bird.walking.forward = wanted.forward;
          bird.walking.turn = wanted.turn;
          bird.walking.launch = false;
          walk(pigeon.state, bird.walking, flight, dt, collider);
          continue;
        }

        // Dead: it flew into something. Nothing here brings it back, because
        // a bird lying on the concrete is exactly as much scenery as one
        // standing on it, and one that stood up again would be a miracle
        // happening in the corner of the shot.
        if (pigeon.state.ending !== null) continue;

        // In the air, either startled or walked off an edge. Either way it
        // wheels about over the square until it is out of the story.
        if (!pigeon.aiming || distanceTo(pigeon.state, pigeon.aiming) < FLUSH_ARRIVED) {
          pigeon.aiming = flushTo(pigeon);
        }
        steer(pigeon.state, pigeon.aiming, bird.memory, bird.controls, flying);
        step(pigeon.state, bird.controls, flight, dt, collider, wind);
      }
    },

    startle(x, z, within = CONTAGION) {
      let up = 0;
      for (const bird of birds) {
        const { pigeon } = bird;
        if (pigeon.state.ending?.kind !== 'landed') continue;
        const away = Math.hypot(pigeon.state.position.x - x, pigeon.state.position.z - z);
        if (away > within) continue;
        takeOff(pigeon.state, flight);
        pigeon.aiming = flushTo(pigeon);
        bird.memory.beating = true;
        up += 1;
      }
      return up;
    },
  };
}
