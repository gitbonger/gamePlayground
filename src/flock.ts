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
  /** Birds wander within this radius of the middle of the map, in metres. */
  range: number;
  /** Heights they cruise between, in metres. */
  minAltitude: number;
  maxAltitude: number;
  /** Seconds a dead bird stays down before another is released. */
  respawnDelay: number;
  seed: number;
}

export const defaultFlockOptions: FlockOptions = {
  count: 10,
  range: 520,
  minAltitude: 48,
  maxAltitude: 105,
  respawnDelay: 2.5,
  seed: 1234,
};

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

export function createFlock(
  morphCount: number,
  options: FlockOptions = defaultFlockOptions,
  flight: FlightParams = defaultParams,
): Flock {
  const rand = mulberry32(options.seed);

  const somewhere = (): Waypoint => {
    const angle = rand() * Math.PI * 2;
    const radius = options.range * Math.sqrt(rand());
    return {
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      altitude: options.minAltitude + rand() * (options.maxAltitude - options.minAltitude),
    };
  };

  interface Pilot {
    member: FlockMember;
    controls: Controls;
    memory: AutopilotState;
    waypoint: Waypoint;
  }

  const release = (pilot: Pilot) => {
    const start = somewhere();
    pilot.member.state = createBird(
      vec(start.x, start.altitude, start.z),
      11 + rand() * 6,
      rand() * Math.PI * 2,
    );
    pilot.member.down = 0;
    pilot.memory.beating = true;
    pilot.waypoint = somewhere();
  };

  const pilots: Pilot[] = [];
  for (let i = 0; i < options.count; i += 1) {
    const pilot: Pilot = {
      member: { state: createBird(), morph: Math.floor(rand() * morphCount), down: 0 },
      controls: neutralControls(),
      memory: { beating: true },
      waypoint: somewhere(),
    };
    release(pilot);
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

      // Somewhere new to be, once it gets where it was going.
      if (distanceTo(member.state, pilot.waypoint) < defaultAutopilotParams.arrival) {
        pilot.waypoint = somewhere();
      }

      steer(member.state, pilot.waypoint, pilot.memory, pilot.controls);
      step(member.state, pilot.controls, flight, dt, collider, wind);

      if (member.state.ending) member.down = options.respawnDelay;
    }
  }

  return { members: pilots.map((pilot) => pilot.member), update };
}
