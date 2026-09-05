/**
 * The other pigeons.
 *
 * They fly the same model the player does, on the same collider and in the
 * same wind, steered by `sim/autopilot`. Nothing about them is special-cased:
 * they stall, they get blown off course, and when they fly into a building
 * they die exactly as the player does and are released again.
 *
 * They keep the player company rather than living anywhere. A bird appears
 * behind the player, picks somewhere near them to fly to, and picks somewhere
 * else near them when it gets there. The effect is a loose escort that keeps
 * breaking up and re-forming, which is what a flock does and, more to the
 * point, means there is always another pigeon in shot.
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
  type AutopilotParams,
  type AutopilotState,
  type Waypoint,
} from './sim/autopilot';
import type { Collider } from './sim/collision';
import type { WindField } from './sim/wind';
import { vec } from './sim/math3';

export interface FlockOptions {
  count: number;
  /** How far behind the leader a bird is released, in metres. */
  spawnBehind: number;
  /** Radius around the leader that targets are picked inside, in metres. */
  radius: number;
  /** How far above or below the leader a target may be, in metres. */
  altitudeSpread: number;
  /**
   * The lowest a target is ever put, in metres.
   *
   * Because the leader can be standing on the ground. Aiming at the leader's
   * own height then means aiming at the dirt, and the flock would spend its
   * time ploughing into it instead of wheeling about overhead.
   */
  minAltitude: number;
  /**
   * How near a target counts as reaching it, in metres.
   *
   * The autopilot's own arrival radius is 45 m, which is wider than the whole
   * area targets are picked in: every bird would count as arrived before it
   * had set off, and re-aim every tick. Escorting somebody is close work and
   * needs its own number.
   */
  arrivalRadius: number;
  /**
   * Seconds before a bird picks somewhere else regardless.
   *
   * Two reasons, and the second is the important one. A pigeon at 14 m/s
   * cannot turn inside about 34 m, so a target 20 m away is one it may simply
   * never hit, and without a timeout it would chase that point for ever. And
   * a target is chosen against where the leader was at the time: a leader
   * doing 19 m/s is 76 m away four seconds later, so the target has to go
   * stale or the flock is escorting a memory.
   */
  attentionSpan: number;
  /**
   * How far a bird may get from the leader before it is brought back, in
   * metres.
   *
   * A pigeon at cruise does about 19 m/s and the flock does about 14, so a
   * player who simply flies away cannot be caught. Rather than leave a trail
   * of stragglers strung out behind for the rest of the run, a bird that has
   * lost touch is released again -- which happens far enough back to be off
   * the end of the camera.
   */
  strayDistance: number;
  /**
   * Seconds a dead bird stays down before another is released.
   *
   * Zero puts it straight back in the air on the tick it died.
   */
  respawnDelay: number;
  /**
   * Seconds between birds when the flock is first let out.
   *
   * They used to appear all at once, which reads as a spawn rather than a
   * loft waking up. Staggering them was what the code claimed to do and did
   * not: it set every bird's timer to zero immediately afterwards.
   */
  emitInterval: number;
  seed: number;
  /** How they fly. Their own, because escorting is not crossing a city. */
  autopilot: AutopilotParams;
}

/**
 * How a bird flies when it is escorting somebody rather than crossing a city.
 *
 * The default autopilot cruises at 14 m/s and banks to 28 degrees, which is a
 * turn of 37 m radius -- it physically cannot stay inside a 20 m circle, and
 * left on those numbers the flock wheels out to 137 m and is only ever pulled
 * back by the stray rule. Slower and steeper turns inside ten metres, which is
 * both what the feature needs and what a pigeon milling about actually does.
 *
 * The floor comes down with it. At the default 38 m a flock over a pigeon
 * walking on the ground would spend the whole time climbing away from it.
 */
export const escortAutopilot: AutopilotParams = {
  ...defaultAutopilotParams,
  cruiseSpeed: 11,
  maxBank: 0.9,
  floor: 8,
  recover: 20,
  minSpeed: 8,
};

export const defaultFlockOptions: FlockOptions = {
  count: 10,
  spawnBehind: 10,
  radius: 20,
  altitudeSpread: 8,
  minAltitude: 12,
  arrivalRadius: 8,
  attentionSpan: 4,
  strayDistance: 140,
  respawnDelay: 0,
  emitInterval: 3,
  seed: 1234,
  autopilot: escortAutopilot,
};

/**
 * The bird they are keeping company, as it is right now.
 *
 * Read through a function rather than held as an object, because the player's
 * bird is replaced outright when the run restarts: anything holding the old
 * one keeps flying escort to a pigeon nobody can see any more.
 */
export interface Leader {
  x: number;
  y: number;
  z: number;
  /** Heading in radians clockwise from north. */
  heading: number;
}

export interface FlockMember {
  state: BirdState;
  /** Which colour scheme to draw it in, as an index into PIGEON_MORPHS. */
  morph: number;
  /** Seconds until it is released again; zero while it is flying. */
  down: number;
  /** Where it is making for at the moment. */
  aiming: Waypoint;
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
  leader: () => Leader = () => ({ x: 0, y: 60, z: 0, heading: 0 }),
  options: FlockOptions = defaultFlockOptions,
  flight: FlightParams = defaultParams,
): Flock {
  const rand = mulberry32(options.seed);

  interface Pilot {
    member: FlockMember;
    controls: Controls;
    memory: AutopilotState;
    /** Seconds spent on the current target. */
    chasing: number;
  }

  /** Somewhere near the leader to make for, chosen fresh each time. */
  const target = (at: Leader): Waypoint => {
    // Square-rooted so the points are spread evenly over the disc rather than
    // bunched at the middle of it, which is what taking the radius straight
    // from the random number would do.
    const away = options.radius * Math.sqrt(rand());
    const around = rand() * Math.PI * 2;
    return {
      x: at.x + Math.cos(around) * away,
      z: at.z + Math.sin(around) * away,
      altitude: Math.max(
        options.minAltitude,
        at.y + (rand() * 2 - 1) * options.altitudeSpread,
      ),
    };
  };

  /** Appear behind the leader, going the same way, and pick somewhere to go. */
  const release = (pilot: Pilot) => {
    const at = leader();
    // Behind is the leader's heading reversed. Facing the same way as the
    // leader rather than at it, because a bird released nose-on would spend
    // its first seconds turning round in front of the camera.
    const behind = at.heading + Math.PI;
    pilot.member.state = createBird(
      vec(
        at.x + Math.sin(behind) * options.spawnBehind,
        Math.max(at.y, options.minAltitude),
        at.z - Math.cos(behind) * options.spawnBehind,
      ),
      12 + rand() * 4,
      at.heading,
    );
    pilot.member.down = 0;
    pilot.memory.beating = true;
    aim(pilot, at);
  };

  /** Pick somewhere new and start the clock on it. */
  const aim = (pilot: Pilot, at: Leader) => {
    pilot.member.aiming = target(at);
    pilot.chasing = 0;
  };

  const pilots: Pilot[] = [];
  for (let i = 0; i < options.count; i += 1) {
    const pilot: Pilot = {
      member: {
        state: createBird(),
        morph: Math.floor(rand() * morphCount),
        down: 0,
        aiming: { x: 0, z: 0, altitude: options.minAltitude },
      },
      controls: neutralControls(),
      memory: { beating: true },
      chasing: 0,
    };
    // Released so it has a real position to sit at, then held back: one comes
    // out every `emitInterval` seconds rather than all of them at once.
    release(pilot);
    pilot.member.down = i * options.emitInterval;
    pilots.push(pilot);
  }

  function update(dt: number, collider: Collider | undefined, wind: WindField) {
    const at = leader();

    for (const pilot of pilots) {
      const { member } = pilot;

      // Waiting: either not let out yet, or down after hitting something.
      // Both are the same thing to everyone else -- a bird that is not in the
      // air -- so they are the same thing here.
      if (member.down > 0) {
        member.down -= dt;
        if (member.down > 0) continue;
        release(pilot);
      }

      // Left behind for good: brought back rather than strung out for ever.
      const adrift = Math.hypot(
        member.state.position.x - at.x,
        member.state.position.z - at.z,
      );
      if (adrift > options.strayDistance) {
        release(pilot);
        continue;
      }

      // Arrived, or given up on it: somewhere else near the leader, who has
      // moved on since.
      pilot.chasing += dt;
      if (
        distanceTo(member.state, member.aiming) < options.arrivalRadius ||
        pilot.chasing > options.attentionSpan
      ) {
        aim(pilot, at);
      }

      steer(member.state, member.aiming, pilot.memory, pilot.controls, options.autopilot);
      step(member.state, pilot.controls, flight, dt, collider, wind);

      if (member.state.ending) {
        member.down = options.respawnDelay;
        // Nothing to wait for: back in the air on the spot.
        if (member.down <= 0) release(pilot);
      }
    }
  }

  return { members: pilots.map((pilot) => pilot.member), update };
}
