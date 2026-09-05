/**
 * Enough judgement to fly a pigeon that nobody is steering.
 *
 * Deliberately not a good pilot. It holds a rough heading and a rough height
 * and beats its wings when it is sinking, which is all a bird wandering over a
 * city appears to be doing — and it means the flock hits things now and then,
 * which is the point of having them.
 */

import { clamp, rotate, sub, vec, type Vec3 } from './math3';
import { bankAngle, heading, type BirdState, type Controls } from './flight';

export interface Waypoint {
  x: number;
  z: number;
  /** Height above the ground to hold, in metres. */
  altitude: number;
}

export interface AutopilotParams {
  /** Bank angle wanted per radian of heading error, radians. */
  bankPerRadian: number;
  /** Steepest bank it will ask for, radians. */
  maxBank: number;
  /** How hard it moves the wings to reach the bank it wants. */
  bankGain: number;
  /** Opposes the roll already happening, so the bank stops where it is aimed. */
  bankDamping: number;
  /**
   * Most nose-up it will ever ask for.
   *
   * The roll and pitch controls are *rates*, not attitudes, so a controller
   * that commands them directly from an error just keeps rolling: the first
   * version of this flew the flock inverted, and a bird on its back falls at
   * seventeen metres a second.
   */
  pitchLimit: number;
  /**
   * Airspeed it tries to hold, in m/s.
   *
   * Pitch flies the speed and the wings fly the height, which is the way round
   * that works: pitching up to climb at ten metres a second just bleeds the
   * speed the wing needs, and the bird sinks while pointing at the sky.
   */
  cruiseSpeed: number;
  /** How hard it pitches per m/s of speed error. */
  speedGain: number;
  /** Damping on vertical speed, which stops the beat becoming a zoom climb. */
  levelGain: number;
  /**
   * Stamina it rests down to, and picks back up at.
   *
   * Set close together and near the top on purpose. Thrust falls away with
   * stamina, so a bird that beats until it is exhausted spends most of its
   * effort at a fraction of full power and sinks anyway; resting early keeps
   * every stroke worth making. Draining at 0.07/s and recovering at 0.14/s,
   * this band works out at about two thirds of the time on the wing, which is
   * the most it could sustain in any case.
   */
  flapAbove: number;
  flapBelow: number;
  /** Within this distance the waypoint counts as reached, in metres. */
  arrival: number;
  /**
   * How far above the wanted height it will drift before diving, in metres.
   *
   * "The wings fly the height" only ever described climbing. Losing height had
   * no control at all: a bird above its waypoint simply stopped beating, and
   * the vertical damping below then actively resisted the sink it needed. It
   * could go up and it could not really come down, so a flock escorting a
   * gliding pigeon ended up a mean of 23 m above it and never once below.
   *
   * Tucking is what a bird does about that, and it is the same control the
   * player has. The gap is so there is still a gliding state between beating
   * and diving, rather than the bird always doing one or the other.
   */
  descendSlack: number;
  /**
   * Below this height the bird stops wandering and concentrates on getting
   * back up. Without it a pigeon that runs its stamina down simply sinks into
   * the rooftops, and a flock spends its life respawning.
   */
  floor: number;
  /** The height it climbs back to when it has dropped below the floor. */
  recover: number;
  /**
   * Airspeed below which nothing else matters.
   *
   * A bird trying hard to climb bleeds speed doing it, and below its stall
   * speed the wing stops working -- at which point it is going down whatever
   * it wanted. Recovery is the same as it is for anything with wings: nose
   * down, wings level, get some air moving again.
   */
  minSpeed: number;
}

export const defaultAutopilotParams: AutopilotParams = {
  bankPerRadian: 0.8,
  maxBank: 0.5,
  bankGain: 2.2,
  bankDamping: 0.32,
  pitchLimit: 0.5,
  cruiseSpeed: 14,
  speedGain: 0.12,
  levelGain: 0.25,
  flapAbove: 0.85,
  flapBelow: 0.4,
  arrival: 45,
  descendSlack: 1,
  floor: 38,
  recover: 70,
  minSpeed: 10,
};

/** Signed difference between two headings, wrapped to -pi..pi. */
export function headingError(from: number, to: number): number {
  let error = to - from;
  while (error > Math.PI) error -= Math.PI * 2;
  while (error < -Math.PI) error += Math.PI * 2;
  return error;
}

export interface AutopilotState {
  /** Whether the wings are currently going, kept between ticks for hysteresis. */
  beating: boolean;
}

/**
 * Work out what a wandering pigeon would do this tick.
 *
 * Mutates `memory` because the flapping decision needs hysteresis: without it
 * the bird chatters its wings on and off at the stamina threshold.
 */
export function steer(
  state: BirdState,
  to: Waypoint,
  memory: AutopilotState,
  controls: Controls,
  p: AutopilotParams = defaultAutopilotParams,
): Controls {
  const forward = rotate(state.orientation, vec(0, 0, -1));
  const bearing = Math.atan2(to.x - state.position.x, -(to.z - state.position.z));
  const error = headingError(Math.atan2(forward.x, -forward.z), bearing);

  // Bank into the turn and let the tail bring the nose round, the same way a
  // player does. The outer loop picks a bank angle; the inner one flies to it,
  // because the roll control is a rate and commanding it from heading error
  // alone never stops rolling.
  const wantBank = clamp(error * p.bankPerRadian, -p.maxBank, p.maxBank);
  // Rolling right is negative about the body's forward axis, so adding the
  // rate opposes the roll already under way.
  controls.roll = clamp(
    (wantBank - bankAngle(state)) * p.bankGain + state.angularVelocity.z * p.bankDamping,
    -1,
    1,
  );

  // Getting low matters more than getting anywhere.
  const low = state.position.y < p.floor;
  const wantedHeight = low ? Math.max(to.altitude, p.recover) : to.altitude;

  // Hold height, damped hard on vertical speed so the beat drives the bird
  // along rather than bouncing it up and down.
  // Pitch holds the airspeed, damped on vertical speed so it settles rather
  // than porpoising. Held well short of full deflection either way: a bird
  // that pitches up as hard as it can simply stalls.
  const airspeed = Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z);
  const trim = (airspeed - p.cruiseSpeed) * p.speedGain - state.velocity.y * p.levelGain;
  controls.pitch = clamp(trim, -p.pitchLimit, p.pitchLimit);

  if (memory.beating && state.stamina < p.flapBelow) memory.beating = false;
  else if (!memory.beating && state.stamina > p.flapAbove) memory.beating = true;

  // Beat while below the height wanted, glide once above it. That sawtooth is
  // what keeps a pigeon up: climbing at 2.8 m/s and sinking at 2.6 puts it in
  // the air about half the time, comfortably inside what its stamina allows.
  //
  // Flapping on any looser condition than this empties the reserve and then
  // never lets it refill -- the bird beats its wings at zero stamina, which
  // costs nothing and achieves nothing, and sinks the whole way down.
  controls.flap = memory.beating && state.position.y < wantedHeight;

  if (airspeed < p.minSpeed) {
    controls.pitch = clamp(-(p.minSpeed - airspeed) * 0.3, -p.pitchLimit, 0);
    controls.roll = clamp(-bankAngle(state) * p.bankGain, -1, 1);
    // The flap decision is left alone: a tired bird recovering its speed still
    // has to glide to recover its stamina.
  }

  controls.yaw = 0;
  // Beat to climb, glide in the band above that, tuck to come down. The last
  // of those is what the height control was missing.
  controls.tuck = state.position.y > wantedHeight + p.descendSlack;
  controls.brake = false;
  return controls;
}

/** Distance from a bird to a waypoint, ignoring height. */
export const distanceTo = (state: BirdState, to: Waypoint): number =>
  Math.hypot(to.x - state.position.x, to.z - state.position.z);

/** Compass heading a bird is currently pointing, for callers that want it. */
export const facing = (state: BirdState): number => heading(state);

/** Straight-line distance between two birds, for keeping them apart. */
export const separation = (a: BirdState, b: BirdState): Vec3 =>
  sub(a.position, b.position);
