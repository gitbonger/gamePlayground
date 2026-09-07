import { describe, expect, it } from 'vitest';
import { createDog } from './dog';

const TICK = 1 / 120;

/** Random numbers that are not random, so a walk can be checked twice. */
const rolls = (values: number[]) => {
  let at = 0;
  return () => values[at++ % values.length]!;
};

const strolling = (seconds: number, random = rolls([0.2, 0.7, 0.45, 0.9, 0.1, 0.6])) => {
  const dog = createDog({ home: { x: 10, z: -4 }, ground: 0, random });
  const path: { x: number; z: number; phase: number }[] = [];
  for (let t = 0; t < seconds / TICK; t += 1) {
    dog.update(TICK);
    path.push({ x: dog.pose.x, z: dog.pose.z, phase: dog.pose.stridePhase });
  }
  return { dog, path };
};

describe('a dog on a square', () => {
  it('walks about rather than standing still', () => {
    const { dog } = strolling(10);
    expect(Math.hypot(dog.pose.x - 10, dog.pose.z + 4)).toBeGreaterThan(0.5);
  });

  it('keeps to its own patch, however long it is left', () => {
    // The same rule the pigeons keep, and for the same reason: a dog that
    // wandered off is a dog you put in a square and then had to go and find.
    const { path } = strolling(120, rolls([0.97, 0.02, 0.5, 0.99, 0.8, 0.13]));
    for (const at of path) {
      expect(Math.hypot(at.x - 10, at.z + 4)).toBeLessThan(10);
    }
  });

  it('takes its stride from the ground it covers, not from the clock', () => {
    // Which is what stops it paddling on the spot. Stated by walking two of
    // them for the same length of time at different speeds: the faster one
    // covers twice the ground and must turn its legs over twice as often. A
    // gait driven by the clock gives them both the same.
    //
    // It was first written as one dog and a ratio, and the arithmetic came
    // out the same either way -- two metres a second for half a second over a
    // half-metre stride is two whole cycles, and two whole cycles and a clock
    // running at two a second both land on nought. A test that passes on a
    // coincidence is a test that is not looking.
    const walked = (speed: number) => {
      const dog = createDog({
        home: { x: 0, z: 0 },
        ground: 0,
        random: () => 0.5,
        speed,
        stride: 0.5,
        range: 40,
      });
      // Past the turn at the start, which is not walking.
      for (let t = 0; t < 2 / TICK; t += 1) dog.update(TICK);
      const was = { x: dog.pose.x, z: dog.pose.z, phase: dog.pose.stridePhase };
      for (let t = 0; t < 0.7 / TICK; t += 1) dog.update(TICK);
      return {
        gone: Math.hypot(dog.pose.x - was.x, dog.pose.z - was.z),
        turned: (dog.pose.stridePhase - was.phase + 1) % 1,
      };
    };

    const slow = walked(1);
    const fast = walked(2);
    expect(slow.gone).toBeGreaterThan(0.5);
    expect(fast.gone / slow.gone).toBeCloseTo(2, 1);
    // The cycles turned over follow the ground, not the seconds. Counted
    // without the wrap, since seven tenths of a second at two metres a second
    // is nearly three whole strides.
    expect(fast.gone / 0.5).toBeCloseTo(2.8, 1);
    expect((fast.gone / 0.5) % 1).toBeCloseTo(fast.turned, 6);
    expect((slow.gone / 0.5) % 1).toBeCloseTo(slow.turned, 6);
  });

  it('never stops, however long it is watched', () => {
    // The one thing that makes it a dog and not a large pigeon. A pigeon
    // arrives somewhere and stands looking at it; a dog let into a park is
    // restless -- it gets where it was going and goes somewhere else, without
    // a frame of standing in between.
    const { path } = strolling(60);
    for (let i = 1; i < path.length; i += 1) {
      const moved = Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.z - path[i - 1]!.z);
      expect(moved, `stopped at ${i / 120}s`).toBeGreaterThan(0);
    }
  });

  it('stays on the ground it was put on', () => {
    // It has no flight model and wants none: a dog is scenery with legs.
    const dog = createDog({ home: { x: 0, z: 0 }, ground: 3.4, random: () => 0.5 });
    for (let t = 0; t < 600; t += 1) dog.update(TICK);
    expect(dog.pose.y).toBe(3.4);
  });
});
