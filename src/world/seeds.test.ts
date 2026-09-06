import { describe, expect, it } from 'vitest';
import { createScatter, flySeeds, SEED_SIZE, seedWithin, throwAt, type Seed } from './seeds';

/** A hand at chest height, three metres from the middle of the ground. */
const HAND = { x: -3, y: 1.4, z: 0 };

/** Random numbers that are not random, so a throw can be checked twice. */
const rolls = (values: number[]) => {
  let at = 0;
  return () => values[at++ % values.length]!;
};

describe('throwing a seed', () => {
  it('lands it where it was aimed', () => {
    // The thrower knows where the seed is to land; the arc follows from that
    // and the time given, rather than from a guess at an angle.
    // Aimed at where it will sit, which is its own radius above the ground:
    // solved to y=0 it touches down early and lands short by half its width.
    const to = { x: 2, y: SEED_SIZE / 2, z: 1.5 };
    const speed = throwAt(HAND, to, 0.8);
    const seed: Seed = { ...HAND, ...speed, landed: false, thrown: 0 };

    for (let t = 0; t < 300 && !seed.landed; t += 1) flySeeds([seed], 1 / 120);
    expect(seed.landed).toBe(true);
    // Within its own width, at a hundred and twenty ticks a second.
    expect(Math.hypot(seed.x - to.x, seed.z - to.z)).toBeLessThan(SEED_SIZE);
  });

  it('throws an arc rather than a straight line', () => {
    // Thrown flat it would go through anything between here and there, and
    // read as a bullet. It goes up first.
    const speed = throwAt(HAND, { x: 2, y: 0, z: 0 }, 0.8);
    const seed: Seed = { ...HAND, ...speed, landed: false, thrown: 0 };
    let highest = seed.y;
    for (let t = 0; t < 300 && !seed.landed; t += 1) {
      flySeeds([seed], 1 / 120);
      highest = Math.max(highest, seed.y);
    }
    expect(highest).toBeGreaterThan(HAND.y + 0.1);
  });

  it('leaves it on the ground rather than through it', () => {
    const seed: Seed = { x: 0, y: 2, z: 0, vx: 0, vy: 0, vz: 0, landed: false, thrown: 0 };
    for (let t = 0; t < 600; t += 1) flySeeds([seed], 1 / 120);
    expect(seed.y).toBeCloseTo(SEED_SIZE / 2, 6);
    expect(seed.vy).toBe(0);
    expect(seed.landed).toBe(true);
  });
});

describe('somebody throwing grain', () => {
  const scattering = (most: number, every = 1) => ({
    from: HAND,
    onto: { x: 0, z: 0 },
    spread: 4,
    most,
    every,
    random: rolls([0.1, 0.9, 0.5, 0.3, 0.7, 0.2, 0.6, 0.4]),
  });

  /** Run the scatter for this many seconds of ticks. */
  const run = (scatter: ReturnType<typeof createScatter>, seconds: number, from = 0) => {
    for (let t = 0; t < seconds * 120; t += 1) scatter.update(1 / 120, from + t / 120);
  };

  it('throws one at a time rather than a handful at once', () => {
    const scatter = createScatter(scattering(8, 1));
    run(scatter, 0.5);
    expect(scatter.seeds).toHaveLength(1);
    run(scatter, 2.5, 0.5);
    expect(scatter.seeds.length).toBeGreaterThan(1);
    expect(scatter.seeds.length).toBeLessThanOrEqual(4);
  });

  it('never has more down than it is allowed', () => {
    // And this is the interesting half: at the limit the oldest is picked up
    // and thrown again somewhere else, so the ground keeps a handful and it
    // is never the same handful.
    const scatter = createScatter(scattering(3, 0.5));
    run(scatter, 20);
    expect(scatter.seeds).toHaveLength(3);

    const before = scatter.seeds.map((seed) => seed.thrown);
    run(scatter, 4, 20);
    const after = scatter.seeds.map((seed) => seed.thrown);
    expect(after.every((when) => !before.includes(when))).toBe(true);
  });

  it('lands them all on the ground it is aiming at', () => {
    const scatter = createScatter(scattering(8, 0.4));
    run(scatter, 30);
    for (const seed of scatter.seeds) {
      if (!seed.landed) continue;
      expect(Math.hypot(seed.x, seed.z), `${seed.x}, ${seed.z}`).toBeLessThanOrEqual(4);
    }
  });

  it('gives one up when it is eaten, and throws another', () => {
    const scatter = createScatter(scattering(4, 0.5));
    run(scatter, 10);
    expect(scatter.seeds).toHaveLength(4);

    scatter.take(0);
    expect(scatter.seeds).toHaveLength(3);
    run(scatter, 1, 10);
    expect(scatter.seeds).toHaveLength(4);
  });
});

describe('finding a seed under a beak', () => {
  const at = (x: number, z: number, landed = true): Seed => ({
    x,
    y: SEED_SIZE / 2,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    landed,
    thrown: 0,
  });

  it('takes the nearest one within reach, and nothing beyond it', () => {
    const seeds = [at(1, 0), at(0.2, 0.1), at(0.6, 0)];
    expect(seedWithin(seeds, 0, 0, 0.35)).toBe(1);
    expect(seedWithin(seeds, 0, 0, 0.05)).toBe(-1);
  });

  it('ignores one still in the air', () => {
    // A bird cannot eat what has not landed, and a seed passing overhead is
    // not a meal -- it is a seed that will be one in half a second.
    expect(seedWithin([at(0.05, 0, false)], 0, 0, 0.35)).toBe(-1);
    expect(seedWithin([at(0.05, 0, true)], 0, 0, 0.35)).toBe(0);
  });
});
