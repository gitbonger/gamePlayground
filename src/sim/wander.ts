/**
 * A pigeon pottering about on the ground.
 *
 * The autopilot for a bird with nowhere to be. It picks a spot near where it
 * is standing, walks to it, stands about for a moment, and picks another --
 * which, watched from a bench, is the whole of what a pigeon on a square
 * does. There is no flocking in it and no reason: each one keeps to its own
 * little circle, and the four of them together look like a group because
 * their circles overlap.
 *
 * The circle is the important part. Left to walk anywhere, four birds
 * following the same rule drift apart within a minute and end up as four
 * pigeons in four different places; tied to a home, they stay a group without
 * anything having to hold them together.
 *
 * It drives the same `walk` the player does, through the same controls, so a
 * wandering bird steps over kerbs, is stopped by walls and is run down by
 * trams exactly as the player is. Nothing here moves a bird; it only presses
 * the keys.
 */

import { heading, isPerched, type BirdState } from './flight';
import { neutralWalk, type WalkControls } from './walk';

/** Where a wandering bird lives, and where it is going. */
export interface Wander {
  /** The middle of its circle: it never sets off further than `range` from here. */
  home: { x: number; z: number };
  /** The spot it is walking to now. */
  goal: { x: number; z: number };
  /** Seconds left of standing about before it sets off again. */
  pause: number;
  /**
   * How long it stands about on arriving, in seconds, at the least and most.
   *
   * A property of the animal rather than of the wandering, which is the point
   * of it being here: a pigeon arrives somewhere and stops to look at it, and
   * a dog let off the lead in a park does not arrive anywhere at all -- it
   * gets there and goes somewhere else. Both at nought means never stopping,
   * and that is not a pause of zero length, it is no pause: the goal is
   * replaced on the spot and the animal keeps walking through the turn.
   */
  rest: { least: number; most: number };
}

/**
 * How far from home a bird will go, in metres.
 *
 * Two metres is ten pigeon lengths and about a second and a half of walking:
 * far enough that it is going somewhere, near enough that it is still the
 * same bird in the same place when you look back.
 */
export const WANDER_RANGE = 2;

/** Near enough to have arrived, in metres: about a bird's own length. */
const ARRIVED = 0.2;

/**
 * How long a pigeon stands there when it gets there, in seconds.
 *
 * The pauses are most of what makes it read as a pigeon rather than as a
 * waypoint follower. A bird that arrived and immediately set off again would
 * be pacing; one that stops, looks about and then goes is feeding.
 */
export const PIGEON_REST = { least: 0.6, most: 2.6 };
/** And an animal that never stops. */
export const NEVER_RESTS = { least: 0, most: 0 };

/**
 * How far off the heading it will walk while still turning, in radians.
 *
 * Turning is proportional inside this band and full-lock outside it, which
 * gives a bird that swings round on the spot when the spot is behind it and
 * curves gently when it is roughly ahead -- rather than one that pirouettes
 * before every step, or one that crabs sideways towards its goal.
 */
const TURN_BAND = 0.35;
/** Beyond this much off, it turns before it walks rather than while. */
const WALK_WITHIN = 1;

/** A point picked evenly inside a disc of `range` about `home`. */
function spotNear(home: { x: number; z: number }, range: number, random: () => number) {
  const around = random() * Math.PI * 2;
  // Square-rooted, so the points fill the disc evenly rather than bunching in
  // the middle of it: taking the radius straight from the random number puts
  // half of them inside half the radius, which is a quarter of the area.
  const away = Math.sqrt(random()) * range;
  return { x: home.x + Math.cos(around) * away, z: home.z + Math.sin(around) * away };
}

/** Start a bird wandering about the place it is standing. */
export function startWander(
  home: { x: number; z: number },
  random: () => number,
  range = WANDER_RANGE,
  rest = PIGEON_REST,
): Wander {
  return { home: { ...home }, goal: spotNear(home, range, random), pause: 0, rest };
}

/**
 * The controls a wandering bird is pressing this tick.
 *
 * Advances the wander as a side effect -- arriving, resting, and picking
 * somewhere new -- because arriving is a thing that happens by walking and
 * there is nowhere else it could be noticed.
 */
export function steerWander(
  state: BirdState,
  wander: Wander,
  dt: number,
  random: () => number,
  range = WANDER_RANGE,
): WalkControls {
  // Nothing at all to a bird that is not on its feet, the same as `walk` and
  // `turnToFace`: a bird in the air is somebody else's problem, and a wander
  // that kept running would have it arriving at a spot on the ground it is
  // thirty metres above.
  if (!isPerched(state)) return neutralWalk();
  return wanderStep(
    { x: state.position.x, z: state.position.z, facing: heading(state) },
    wander,
    dt,
    random,
    range,
  );
}

/** Where something is standing and which way it is turned. */
export interface Pose {
  x: number;
  z: number;
  /** Radians clockwise from north, the same convention the bird's heading is. */
  facing: number;
}

/**
 * The same again, for anything that is not a bird.
 *
 * A dog pottering about a square is doing exactly what a pigeon pottering
 * about a slab of concrete is doing -- pick a spot, walk to it, stand there a
 * moment, pick another -- and it would be daft for the two of them to have
 * separate ideas about it. What differs between them is what they are made
 * of, so what this needs is a position and a heading rather than an animal.
 */
export function wanderStep(
  pose: Pose,
  wander: Wander,
  dt: number,
  random: () => number,
  range = WANDER_RANGE,
): WalkControls {
  const controls = neutralWalk();

  // Standing about. The count runs down whether or not it has arrived, so a
  // bird shoved off its spot by a tram stands where it has ended up rather
  // than snapping straight back into walking.
  if (wander.pause > 0) {
    wander.pause -= dt;
    if (wander.pause <= 0) wander.goal = spotNear(wander.home, range, random);
    return controls;
  }

  let dx = wander.goal.x - pose.x;
  let dz = wander.goal.z - pose.z;
  if (Math.hypot(dx, dz) <= ARRIVED) {
    const { least, most } = wander.rest;
    if (most > 0) {
      wander.pause = least + random() * (most - least);
      return controls;
    }
    // Restless: somewhere else, now, and walked at in the same tick rather
    // than after a frame of standing. A pause of no length is not the same
    // thing as no pause -- taken through the waiting branch it would arrive,
    // stop, notice it had arrived again, and stand there for ever.
    wander.goal = spotNear(wander.home, range, random);
    dx = wander.goal.x - pose.x;
    dz = wander.goal.z - pose.z;
  }

  // The short way round, in the same frame `walk` turns in.
  const want = Math.atan2(dx, -dz);
  let off = (want - pose.facing + Math.PI) % (Math.PI * 2);
  if (off < 0) off += Math.PI * 2;
  off -= Math.PI;

  controls.turn = Math.max(-1, Math.min(1, off / TURN_BAND));
  // Restless means never stopping, and turning on the spot is stopping: a dog
  // that halted to pivot and then trotted off would read as a dog that keeps
  // stopping, whatever the pause was set to. So it walks through the turn and
  // curves round, which is what a dog in a park does anyway -- at a metre and
  // a half a second and two radians of turn, the arc is two thirds of a metre
  // across, so it comes round in its own length.
  //
  // A pigeon is the other way: it faces where it is going and then goes, or
  // it crabs sideways across a slab.
  const restless = wander.rest.most <= 0;
  controls.forward = restless || Math.abs(off) < WALK_WITHIN ? 1 : 0;
  return controls;
}
