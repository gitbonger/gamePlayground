/**
 * The other pigeons.
 *
 * They fly the same model the player does, on the same collider and in the
 * same wind, steered by `sim/autopilot`. Nothing about them is special-cased:
 * they stall, they get blown off course, and when they fly into a building
 * they die exactly as the player does, wait a moment, and are released again
 * somewhere else.
 */

import {
  createBird,
  defaultParams,
  step,
  type BirdState,
  type Controls,
  type FlightParams,
} from './sim/flight';
import { neutralControls } from './sim/flight';
import {
  defaultAutopilotParams,
  distanceTo,
  steer,
  type AutopilotState,
  type Waypoint,
} from './sim/autopilot';
import type { Collider } from './sim/collision';
import type { WindField } from './sim/wind';
import { vec } from './sim/math3';

export interface FlockOptions {
  count: number;
  /** How far out they fly before turning up again, in metres. */
  range: number;
  /**
   * Which way out of the roost they head, in radians clockwise from north,
   * and how far either side of it they spread.
   *
   * A full circle by default, which is right for a loft on a roof with open
   * sky all round. It is wrong for a roost in a cutting: released in every
   * direction from a rail yard, most of them fly straight into the blocks
   * ringing it before they have climbed over the roofs. Given the line to
   * follow, they leave along it, which is what the open ground is for.
   */
  outbound?: { bearing: number; spread: number };
  /** Heights they climb to on the way out, in metres. */
  minAltitude: number;
  maxAltitude: number;
  /** Seconds a dead bird stays down before another is released. */
  respawnDelay: number;
  seed: number;
}

export const defaultFlockOptions: FlockOptions = {
  count: 10,
  range: 340,
  minAltitude: 45,
  maxAltitude: 105,
  respawnDelay: 2.5,
  seed: 1234,
};

/**
 * The point the flock lives at, and leaves from.
 *
 * The height is part of it. It used to be ignored in favour of a fixed release
 * altitude, which nothing noticed because the only caller passed the same
 * number -- and which would have been wrong the moment the loft stopped being
 * a rooftop and became, say, the deck of a wagon.
 */
export interface Anchor {
  x: number;
  y: number;
  z: number;
}

export interface FlockMember {
  state: BirdState;
  /** Which colour scheme to draw it in, as an index into PIGEON_MORPHS. */
  morph: number;
  /** Seconds until it is released again; zero while it is flying. */
  down: number;
}

export interface Flock {
  readonly members: readonly FlockMember[];
  update(dt: number, collider: Collider | undefined, wind: WindField): void;
}

/** Small deterministic PRNG, so a flock is the same flock every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pigeons living at the loft, which is wherever the player is trying to get
 * back to.
 *
 * Each leaves low and heads off in its own direction, climbing as it goes, and
 * is released again once it has gone far enough or flown into something. The
 * effect is a slow scatter outward from home, which doubles as a way of seeing
 * where home is from some distance off.
 */
export function createFlock(
  morphCount: number,
  loft: Anchor = { x: 0, y: 30, z: 0 },
  options: FlockOptions = defaultFlockOptions,
  flight: FlightParams = defaultParams,
): Flock {
  const rand = mulberry32(options.seed);

  interface Pilot {
    member: FlockMember;
    controls: Controls;
    memory: AutopilotState;
    waypoint: Waypoint;
  }

  /** Leave the loft on a fresh bearing, climbing out to somewhere distant. */
  const release = (pilot: Pilot) => {
    const bearing = options.outbound
      ? options.outbound.bearing + (rand() * 2 - 1) * options.outbound.spread
      : rand() * Math.PI * 2;
    pilot.member.state = createBird(
      vec(loft.x, loft.y, loft.z),
      12 + rand() * 4,
      bearing,
    );
    pilot.member.down = 0;
    pilot.memory.beating = true;
    pilot.waypoint = {
      x: loft.x + Math.sin(bearing) * options.range,
      z: loft.z - Math.cos(bearing) * options.range,
      altitude: options.minAltitude + rand() * (options.maxAltitude - options.minAltitude),
    };
  };

  const pilots: Pilot[] = [];
  for (let i = 0; i < options.count; i += 1) {
    const pilot: Pilot = {
      member: { state: createBird(), morph: Math.floor(rand() * morphCount), down: 0 },
      controls: neutralControls(),
      memory: { beating: true },
      waypoint: { x: loft.x, z: loft.z, altitude: options.minAltitude },
    };
    release(pilot);
    // Stagger the start, so they are not all released in the same instant.
    pilot.member.down = 0;
    pilots.push(pilot);
  }

  function update(dt: number, collider: Collider | undefined, wind: WindField) {
    for (const pilot of pilots) {
      const { member } = pilot;

      if (member.state.ending) {
        member.down -= dt;
        if (member.down <= 0) release(pilot);
        continue;
      }

      // Once it has flown its leg, it goes back to the loft and out again.
      if (distanceTo(member.state, pilot.waypoint) < defaultAutopilotParams.arrival) {
        release(pilot);
        continue;
      }

      steer(member.state, pilot.waypoint, pilot.memory, pilot.controls);
      step(member.state, pilot.controls, flight, dt, collider, wind);

      if (member.state.ending) member.down = options.respawnDelay;
    }
  }

  return { members: pilots.map((pilot) => pilot.member), update };
}
