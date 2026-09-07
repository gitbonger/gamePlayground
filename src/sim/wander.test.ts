import { describe, expect, it } from 'vitest';
import { startWander, steerWander, WANDER_RANGE } from './wander';
import { standStill, walk } from './walk';
import { createBird, defaultParams, heading, type BirdState } from './flight';
import { vec } from './math3';

const TICK = 1 / 120;
const p = defaultParams;
const STANDING = p.groundHeight + p.bodyRadius;

/** A bird on its feet at this spot, facing `bearing`. */
function standing(x = 0, z = 0, bearing = 0): BirdState {
  const bird = createBird(vec(x, STANDING, z), 0, bearing);
  standStill(bird);
  return bird;
}

/** Random numbers that are not random, so a walk can be checked twice. */
const rolls = (values: number[]) => {
  let at = 0;
  return () => values[at++ % values.length]!;
};

/** Wander for `seconds`, and say where it went. */
function wandered(bird: BirdState, random: () => number, seconds: number, range = WANDER_RANGE) {
  const wander = startWander({ x: bird.position.x, z: bird.position.z }, random, range);
  const path: { x: number; z: number; facing: number }[] = [];
  for (let t = 0; t < seconds / TICK; t += 1) {
    walk(bird, steerWander(bird, wander, TICK, random, range), p, TICK);
    path.push({ x: bird.position.x, z: bird.position.z, facing: heading(bird) });
  }
  return { wander, path };
}

describe('a pigeon pottering about', () => {
  it('walks to the spot it picked and stops there', () => {
    // The whole errand, and both halves of it matter: a bird that never
    // arrives is a bird walking into the distance, and one that arrives
    // without stopping is one that walks through its own goal.
    const bird = standing();
    const { wander } = wandered(bird, rolls([0.25, 0.9, 0.5]), 4);
    const away = Math.hypot(bird.position.x - wander.goal.x, bird.position.z - wander.goal.z);
    expect(away).toBeLessThan(0.25);
  });

  it('turns towards its goal before walking, rather than crabbing at it', () => {
    // It presses the same two keys the player does, so it cannot slide
    // sideways -- it can only end up pointing the wrong way for a long time.
    // Facing due north with a goal due south, the first thing that happens is
    // a turn and not a step.
    const bird = standing(0, 0, 0);
    const wander = startWander({ x: 0, z: 0 }, () => 0.5);
    wander.goal = { x: 0, z: 5 };
    wander.pause = 0;

    const first = steerWander(bird, wander, TICK, () => 0.5);
    expect(first.forward).toBe(0);
    expect(Math.abs(first.turn)).toBe(1);

    // And once it has come round, it walks: pointed at the goal, and closer
    // to it than it was.
    //
    // Measured against the bearing to the goal rather than against the half
    // turn it started with. They are not the same thing -- the bird walks
    // while it turns, so it curves out and the goal is no longer dead astern
    // by the time it is round -- and the bearing is what the claim is
    // actually about. Stated as a heading it would be a test that failed
    // whenever a pigeon's walking pace changed, which tells you it was
    // measuring the wrong thing.
    for (let t = 0; t < 2 / TICK; t += 1) {
      walk(bird, steerWander(bird, wander, TICK, () => 0.5), p, TICK);
    }
    const bearing = Math.atan2(
      wander.goal.x - bird.position.x,
      -(wander.goal.z - bird.position.z),
    );
    expect(Math.abs(heading(bird) - bearing)).toBeLessThan(0.2);
    expect(bird.position.z).toBeGreaterThan(0.5);
  });

  it('stands about when it arrives instead of setting off again', () => {
    // The pauses are most of what makes it read as a pigeon. Without one it
    // is a waypoint follower, which never stops.
    //
    // Turning counts as doing something, which is the whole difficulty of
    // stating this: a bird swinging round on the spot does not move an inch,
    // so "did not move" alone is satisfied by a bird that arrived, re-aimed
    // and is already turning towards the next place. Standing about means
    // neither walking nor turning.
    const bird = standing();
    const { path } = wandered(bird, rolls([0.25, 0.9, 0.5]), 6);

    let stillest = 0;
    let run = 0;
    for (let i = 1; i < path.length; i += 1) {
      const here = path[i]!;
      const before = path[i - 1]!;
      const moved = Math.hypot(here.x - before.x, here.z - before.z);
      const turned = Math.abs(here.facing - before.facing);
      run = moved < 1e-9 && turned < 1e-9 ? run + TICK : 0;
      stillest = Math.max(stillest, run);
    }
    expect(stillest).toBeGreaterThan(0.5);
  });

  it('picks somewhere new each time, rather than the same spot for ever', () => {
    // Arriving has to set a fresh goal, or the bird stands on its one spot
    // for the rest of the level.
    const bird = standing();
    const random = rolls([0.1, 0.8, 0.35, 0.4, 0.65, 0.2, 0.9, 0.55]);
    const wander = startWander({ x: 0, z: 0 }, random);
    const goals = [{ ...wander.goal }];
    for (let t = 0; t < 40 / TICK; t += 1) {
      walk(bird, steerWander(bird, wander, TICK, random), p, TICK);
      const last = goals[goals.length - 1]!;
      if (wander.goal.x !== last.x || wander.goal.z !== last.z) goals.push({ ...wander.goal });
    }
    expect(goals.length).toBeGreaterThan(3);
  });

  it('keeps to its own circle over a long stretch of wandering', () => {
    // This is what makes four of them a group rather than four birds walking
    // off in four directions. Measured over the whole walk and not only at
    // the goals, because the walking is where it could stray.
    const bird = standing();
    const random = rolls([0.97, 0.02, 0.5, 0.99, 0.8, 0.13, 0.6, 0.44]);
    const { path } = wandered(bird, random, 60);
    for (const at of path) {
      // Its own body width of slack: it stops when its centre is within a
      // fifth of a metre of the goal, and the goal itself may be on the rim.
      expect(Math.hypot(at.x, at.z)).toBeLessThan(WANDER_RANGE + 0.3);
    }
    // And it does use the circle rather than shuffling about the middle of it.
    expect(Math.max(...path.map((at) => Math.hypot(at.x, at.z)))).toBeGreaterThan(1);
  });

  it('presses nothing at all while the bird is in the air', () => {
    // A bird thirty metres up is somebody else's problem. Its goal is on the
    // ground below it, which in plan view it may well be standing on, so a
    // wander that kept running would have it arriving at a spot it is
    // nowhere near and standing about in mid-air.
    const flying = createBird(vec(0, 30, 0), 12, 0);
    const wander = startWander({ x: 0, z: 0 }, () => 0.5);
    wander.goal = { x: 0, z: 0 };
    const before = { ...wander.goal };

    for (let t = 0; t < 5 / TICK; t += 1) {
      const pressed = steerWander(flying, wander, TICK, () => 0.5);
      expect(pressed).toEqual({ forward: 0, turn: 0, launch: false });
    }
    expect(wander.pause).toBe(0);
    expect(wander.goal).toEqual(before);
  });
});
