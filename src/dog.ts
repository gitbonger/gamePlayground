/**
 * A dog on a square, walking about.
 *
 * The simplest animal in the game and deliberately so: it has a position, a
 * heading and a stride, it wanders the same way the pigeons on the concrete
 * do -- the same `wanderStep`, since picking a spot and walking to it is the
 * same thought whatever is thinking it -- and it collides with nothing. A
 * pigeon has a flight model because the player flies one. A dog is scenery
 * with legs.
 *
 * What it is *for* is the pigeons. A dog in a square is the thing that makes
 * a square full of birds into a square full of birds that might leave, and it
 * already has the machinery to do it: the ambient flock is startled by
 * anything taking off within twenty metres, and a dog trotting through them
 * is the same alarm arriving on four legs. That is not wired up yet -- this
 * is the animal, walking.
 */

import { NEVER_RESTS, startWander, wanderStep, type Wander } from './sim/wander';
import type { DogPose } from './render/dog';

export interface Dog {
  /** Where it is and how far through its stride, for the rig to draw. */
  readonly pose: DogPose;
  /** Walk it for a tick. */
  update(dt: number): void;
}

export interface Walking {
  /** The middle of the ground it keeps to. */
  home: { x: number; z: number };
  /** The height it stands at: the ground under it. */
  ground: number;
  /** How far from home it will go, in metres. */
  range?: number;
  /** Metres a second. */
  speed?: number;
  /** Ground covered by one full gait cycle, in metres. */
  stride?: number;
  /** Radians a second, turning on the spot. */
  turnRate?: number;
  random?: () => number;
}

/**
 * How fast a dog walks, in m/s.
 *
 * A collie at a walk does about one and a half, which is a good deal faster
 * than a pigeon and slower than the pigeon's new trot -- so a bird on the
 * ground can get out of its way, which is the whole point of having it there.
 */
const SPEED = 1.5;
/**
 * Ground covered by one full gait cycle, in metres.
 *
 * About a body length, which is what a walking dog does: at a metre and a
 * half a second that is a little over two cycles a second, and four legs at
 * two cycles a second is a walk you can count.
 */
const STRIDE = 0.7;
const TURN_RATE = 2.2;
/** How far it ranges: a dog on a square keeps a wider circle than a pigeon. */
const RANGE = 9;

export function createDog(options: Walking): Dog {
  const random = options.random ?? Math.random;
  const speed = options.speed ?? SPEED;
  const stride = options.stride ?? STRIDE;
  const turnRate = options.turnRate ?? TURN_RATE;
  const range = options.range ?? RANGE;

  // Never stands about. A pigeon on a slab arrives somewhere and stops to
  // look at it; a dog finally let into a park does not arrive anywhere -- it
  // gets there and immediately goes somewhere else, which is the whole of
  // what makes it read as a dog rather than as a small horse on errands.
  const wander: Wander = startWander(options.home, random, range, NEVER_RESTS);
  const pose: DogPose = {
    x: options.home.x,
    y: options.ground,
    z: options.home.z,
    facing: random() * Math.PI * 2,
    stridePhase: 0,
  };

  return {
    pose,
    update(dt) {
      const wanted = wanderStep(pose, wander, dt, random, range);

      pose.facing += wanted.turn * turnRate * dt;
      if (wanted.forward === 0) return;

      // Walked along its own nose, in the convention everything else here
      // uses: facing zero is north, which is -Z.
      const gone = wanted.forward * speed * dt;
      pose.x += Math.sin(pose.facing) * gone;
      pose.z -= Math.cos(pose.facing) * gone;
      // Advanced by ground covered rather than by the clock, so a dog
      // standing still has its feet still and one walking slowly walks
      // slowly. The same rule the pigeon's stride follows.
      pose.stridePhase = (pose.stridePhase + gone / stride) % 1;
    },
  };
}
