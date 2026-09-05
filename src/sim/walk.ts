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

import type { Collider, SweepHit } from './collision';
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

/**
 * What a bird is doing, which is what the controls mean.
 *
 * Three of them and not two. Flying and walking were always distinct enough
 * to be separate models; standing talking to somebody is a third, and the
 * thing that makes it one rather than a variety of walking is that the player
 * cannot move at all. You walked up to somebody deliberately -- being able to
 * shuffle a foot sideways and end the conversation by accident is not the
 * behaviour of somebody having one.
 *
 * A bird whose flight ended badly is in none of these. It is not doing
 * anything.
 */
export type Stance = 'flying' | 'walking' | 'talking';

/**
 * Which of the three a bird is in.
 *
 * `met` rather than a search for who: whether there is anybody to talk to is
 * a question about the world, and this only needs the answer.
 */
export function stanceOf(state: BirdState, met: boolean): Stance | null {
  if (state.ending === null) return 'flying';
  if (state.ending.kind !== 'landed') return null;
  return met ? 'talking' : 'walking';
}

export interface WalkControls {
  /** -1 back .. +1 forward. Digital: a pigeon has one walking speed. */
  forward: number;
  /** -1 left .. +1 right, turning on the spot. */
  turn: number;
  /** Leave the ground. The same key that beats the wings in the air. */
  launch: boolean;
}

export const neutralWalk = (): WalkControls => ({ forward: 0, turn: 0, launch: false });

/**
 * The controls as the bird's stance lets them through.
 *
 * Talking takes the movement away and leaves the wing: a conversation you
 * cannot walk out of but can fly out of is one you leave on purpose.
 */
export function asStance(controls: WalkControls, stance: Stance | null): WalkControls {
  if (stance === 'walking') return controls;
  return { forward: 0, turn: 0, launch: stance === 'talking' && controls.launch };
}

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

  // Asked before anything else, and whether or not the bird is going
  // anywhere: standing still on a railway line is the way to be hit by a
  // train, not a way to avoid it.
  const arriving = collider?.touching(state.position, p.bodyRadius);
  if (arriving && arriving.speed >= p.struckSpeed && !aboard(state, arriving.carrier)) {
    runOver(state, p, state.position);
    return { grounded: false, travelled: 0, blocked: true };
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

  const { moved, blocked, struck } = slide(raised, wanted, p.bodyRadius, collider, p, state);
  if (struck) {
    runOver(state, p, struck);
    return { grounded: false, travelled: 0, blocked: true };
  }

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
  collider: Collider | undefined,
  p: FlightParams,
  state: BirdState,
): { moved: Vec3; blocked: boolean; struck: Vec3 | null } {
  const clear = { moved: add(from, wanted), blocked: false, struck: null };
  if (!collider) return clear;

  const first = collider.sweep(from, add(from, wanted), radius);
  if (!first) return clear;
  if (runsOver(first, p, state)) return { ...clear, struck: first.point };

  // Up to the contact, held a hair off the surface so the next sweep starts
  // outside it rather than in it.
  const contact = add(first.point, scale(first.normal, 1e-3));

  // What is left of the step, with the part pushing into the surface removed.
  const left = scale(wanted, 1 - first.t);
  const into = left.x * first.normal.x + left.y * first.normal.y + left.z * first.normal.z;
  const along = sub(left, scale(first.normal, into));

  const second = collider.sweep(contact, add(contact, along), radius);
  if (!second) return { moved: add(contact, along), blocked: true, struck: null };
  if (runsOver(second, p, state)) {
    return { moved: contact, blocked: true, struck: second.point };
  }
  return {
    moved: add(second.point, scale(second.normal, 1e-3)),
    blocked: true,
    struck: null,
  };
}

/**
 * Whether this contact is something arriving rather than something in the way.
 *
 * The thing already underfoot is exempt: a bird riding a wagon walks into its
 * own stakes all the time, and those are moving at exactly the speed it is.
 */
function runsOver(hit: SweepHit, p: FlightParams, state: BirdState): boolean {
  return hit.speed >= p.struckSpeed && !aboard(state, hit.carrier);
}

/**
 * Whether the bird is riding the thing it just touched.
 *
 * Both being null is not a match. A bird on the ground has nothing under it
 * and an untagged solid is nobody's -- reading that as "it is standing on the
 * thing that hit it" exempts every moving object in the world from ever
 * hurting anybody, which is what the first version of this did.
 */
function aboard(state: BirdState, carrier: number | null): boolean {
  return state.restingOn !== null && carrier === state.restingOn;
}

/** Struck by something moving. On foot there is no version of this you walk away from. */
function runOver(state: BirdState, p: FlightParams, where: Vec3): void {
  state.ending = {
    kind: 'crashed',
    cause: 'struck',
    speed: p.walkSpeed,
    sink: 0,
    bank: 0,
    position: where,
  };
  state.velocity = vec(0, 0, 0);
  state.angularVelocity = vec(0, 0, 0);
  state.restingOn = null;
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

/**
 * How near two birds have to be to have met, in metres.
 *
 * Close enough that you had to walk up to it deliberately, rather than close
 * enough that flying past counts.
 */
export const MEET_RADIUS = 2;

/**
 * Whether two birds have met.
 *
 * Three things, and the middle one is what stops a train passing under a
 * rooftop from being a meeting: both have to be on their feet, both have to
 * be standing on the same thing, and they have to be within arm's reach.
 *
 * "The same thing" is whatever the collider tagged the solid they came to
 * rest on. Two birds on open ground are both standing on nothing, which
 * counts -- they are on the same ground -- and the reach is what keeps that
 * honest. The one case it cannot tell apart is a low roof from the ground
 * beneath it, because neither is tagged; nothing in the game is close enough
 * to the other for that to arise, and tagging buildings is the fix if it ever
 * does.
 */
export function meeting(a: BirdState, b: BirdState, within = MEET_RADIUS): boolean {
  if (!isPerched(a) || !isPerched(b)) return false;
  if (a.restingOn !== b.restingOn) return false;
  return (
    Math.hypot(
      a.position.x - b.position.x,
      a.position.y - b.position.y,
      a.position.z - b.position.z,
    ) <= within
  );
}

/**
 * Turn a standing bird to face a point, at the pace it turns while walking.
 *
 * Eased rather than snapped, and at the same rate as `walk` turns on the
 * spot, because it is the same action: a pigeon noticing somebody and coming
 * round to look at them. Snapping would read as the bird being teleported
 * rather than as it turning.
 *
 * Does nothing to a bird that is not on its feet, and nothing to one already
 * looking the right way.
 */
export function turnToFace(state: BirdState, at: Vec3, p: FlightParams, dt: number): void {
  if (!isPerched(state)) return;

  const want = Math.atan2(at.x - state.position.x, -(at.z - state.position.z));
  const facing = heading(state);

  // The short way round. Turning 350 degrees to the left to look 10 to the
  // right is the sort of thing that happens without this.
  let off = (want - facing + Math.PI) % (Math.PI * 2);
  if (off < 0) off += Math.PI * 2;
  off -= Math.PI;

  const most = p.walkTurnRate * dt;
  const step = off > most ? most : off < -most ? -most : off;
  state.orientation = quatFromAxisAngle(vec(0, 1, 0), -(facing + step));
}
