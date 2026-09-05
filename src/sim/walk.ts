/**
 * The pigeon on its feet.
 *
 * A landed bird is not a flying bird with the numbers turned down: it has one
 * speed, reaches it at once, holds it while the key is held and stops dead
 * when it is released. There is no momentum on foot, so none of the flight
 * model applies and none of it is used here.
 *
 * What the two modes share is the world. Walking sweeps the same collider the
 * flight model does, with the same body radius, so a wall is a wall either way
 * and a bird that walks onto a wagon is carried by it exactly as one that
 * landed on it is.
 *
 * Walking off an edge hands the bird back to the flight model, in the air with
 * whatever pace it stepped off at. That is the whole of the falling rule:
 * there is no separate survivable drop, because a pigeon that steps off a
 * ledge is a pigeon flying, and what happens next is judged by the landing
 * rules that judge every other arrival.
 */

import type { Collider } from './collision';
import { heading, isPerched, type BirdState, type FlightParams } from './flight';
import {
  add,
  quatFromAxisAngle,
  quatMultiply,
  rotate,
  scale,
  sub,
  vec,
  type Vec3,
} from './math3';

export interface WalkControls {
  /** -1 back .. +1 forward. Digital: a pigeon has one walking speed. */
  forward: number;
  /** -1 left .. +1 right, turning on the spot. */
  turn: number;
  /** Leave the ground. The same key that beats the wings in the air. */
  launch: boolean;
}

export const neutralWalk = (): WalkControls => ({ forward: 0, turn: 0, launch: false });

export interface WalkTelemetry {
  /** False when the bird has just left the ground, by edge or by wing. */
  grounded: boolean;
  /** Ground covered this step, in metres. */
  travelled: number;
  /** Whether something was in the way, so the walk cue can say so. */
  blocked: boolean;
}

/**
 * Step a walking bird forward by `dt`.
 *
 * Does nothing to a bird that is not on its feet, so a caller can hand every
 * bird to it and let the state decide.
 */
export function walk(
  state: BirdState,
  controls: WalkControls,
  p: FlightParams,
  dt: number,
  collider?: Collider,
): WalkTelemetry {
  if (!isPerched(state)) return { grounded: false, travelled: 0, blocked: false };

  state.age += dt;

  if (controls.launch) {
    takeOff(state, p);
    return { grounded: false, travelled: 0, blocked: false };
  }

  // --- Turning ------------------------------------------------------------
  // On the spot, and level: a walking pigeon has no bank and no pitch, so the
  // whole attitude is one number.
  const facing = heading(state) + controls.turn * p.walkTurnRate * dt;
  state.orientation = quatFromAxisAngle(vec(0, 1, 0), -facing);

  // --- The step -----------------------------------------------------------
  const forward = rotate(state.orientation, vec(0, 0, -1));
  const stride = clampAxis(controls.forward) * p.walkSpeed * dt;
  if (stride === 0) return { grounded: true, travelled: 0, blocked: false };

  // Carried out with the bird lifted by its step height, so that a kerb, a
  // rail or a wagon's solebar is something to walk over rather than a wall.
  // The ground probe below puts it back down.
  const lift = vec(0, p.walkStepUp, 0);
  const raised = add(state.position, lift);
  const wanted = scale(forward, stride);

  const { moved, blocked } = slide(raised, wanted, p.bodyRadius, collider);

  // --- Where the foot lands ------------------------------------------------
  const footing = groundUnder(moved, p, collider);
  if (footing) {
    state.position = footing.point;
    state.restingOn = footing.carrier;
    advanceStride(state, p, stride);
    return { grounded: true, travelled: Math.abs(stride), blocked };
  }

  // Nothing within stepping distance: the bird has walked off an edge and is
  // flying again, at the pace it stepped off with. Everything from here is the
  // flight model's, including whether the arrival at the bottom is survivable.
  state.position = sub(moved, lift);
  state.ending = null;
  state.restingOn = null;
  state.velocity = scale(forward, clampAxis(controls.forward) * p.walkSpeed);
  advanceStride(state, p, stride);
  return { grounded: false, travelled: Math.abs(stride), blocked };
}

const clampAxis = (v: number): number => (v > 1 ? 1 : v < -1 ? -1 : v);

/** Advance the stride animation by the ground actually covered. */
function advanceStride(state: BirdState, p: FlightParams, stride: number): void {
  if (p.walkStride <= 0) return;
  const phase = state.stridePhase + stride / p.walkStride;
  // Kept in 0..1 for a negative stride too, which walking backwards gives.
  state.stridePhase = phase - Math.floor(phase);
}

/**
 * Move as far along `wanted` as the world allows, sliding along whatever is in
 * the way rather than stopping dead against it.
 *
 * Two passes, not a loop. One is enough to follow a wall; a second would be
 * for the inside of a corner, where stopping is the right answer anyway.
 */
function slide(
  from: Vec3,
  wanted: Vec3,
  radius: number,
  collider?: Collider,
): { moved: Vec3; blocked: boolean } {
  if (!collider) return { moved: add(from, wanted), blocked: false };

  const first = collider.sweep(from, add(from, wanted), radius);
  if (!first) return { moved: add(from, wanted), blocked: false };

  // Up to the contact, held a hair off the surface so the next sweep starts
  // outside it rather than in it.
  const contact = add(first.point, scale(first.normal, 1e-3));

  // What is left of the step, with the part pushing into the surface removed.
  const left = scale(wanted, 1 - first.t);
  const into = left.x * first.normal.x + left.y * first.normal.y + left.z * first.normal.z;
  const along = sub(left, scale(first.normal, into));

  const second = collider.sweep(contact, add(contact, along), radius);
  if (!second) return { moved: add(contact, along), blocked: true };
  return { moved: add(second.point, scale(second.normal, 1e-3)), blocked: true };
}

/**
 * The surface the bird's feet come down on, sweeping from its step height down
 * to as far as it will step.
 *
 * Returns where the bird's centre belongs and what it is standing on, or null
 * if there is nothing within reach -- which is what walking off an edge is.
 */
function groundUnder(
  raised: Vec3,
  p: FlightParams,
  collider?: Collider,
): { point: Vec3; carrier: number | null } | null {
  const foot = raised.y - p.walkStepUp;
  const lowest = foot - p.walkStepDown;

  let best: { point: Vec3; carrier: number | null } | null = null;

  if (collider) {
    // Straight down, which is why there is no check that the surface is level
    // enough to stand on. The sweep is a slab test, and an axis the ray does
    // not move along cannot be the entry axis: a vertical sweep can only ever
    // come back with an upward normal, or with nothing.
    const hit = collider.sweep(raised, vec(raised.x, lowest, raised.z), p.bodyRadius);
    if (hit) best = { point: hit.point, carrier: hit.carrier };
  }

  // The ground plane is not in the collider, so it is checked separately -- and
  // it wins only if it is higher, which is what stops a bird stepping through
  // a wagon deck onto the ballast below.
  const plane = p.groundHeight + p.bodyRadius;
  if (plane >= lowest && plane <= raised.y && (!best || plane > best.point.y)) {
    best = { point: vec(raised.x, plane, raised.z), carrier: null };
  }

  return best;
}

/**
 * Leave the ground under your own power.
 *
 * Up and forward at once, at a speed the wing can actually fly at: a bird put
 * into the air below its stall speed is a bird that has been thrown, and it
 * comes straight back down. The angle is what stops it being a bunny hop --
 * steep enough to clear what you were standing on, shallow enough that the
 * speed goes into flying rather than into the climb.
 *
 * A velocity handed over outright rather than a force applied over some
 * ticks, because that is a fair description of a wing-clap: a pigeon goes
 * from standing to flying speed inside a fifth of a second, and modelling the
 * beat-by-beat of that would be modelling something nobody can see.
 */
export function takeOff(state: BirdState, p: FlightParams): void {
  const forward = rotate(state.orientation, vec(0, 0, -1));
  state.velocity = add(
    scale(forward, p.launchSpeed * Math.cos(p.launchAngle)),
    vec(0, p.launchSpeed * Math.sin(p.launchAngle), 0),
  );
  // Pitched up to match, so it leaves along its own velocity rather than
  // flying sideways through the air for the first half second.
  state.orientation = quatMultiply(
    quatFromAxisAngle(vec(0, 1, 0), -heading(state)),
    quatFromAxisAngle(vec(1, 0, 0), p.launchAngle),
  );
  state.angularVelocity = vec(0, 0, 0);
  state.ending = null;
  state.restingOn = null;
}
