import { describe, expect, it } from 'vitest';
import {
  createSmoke,
  defaultSmokeOptions,
  puffOpacity,
  puffRadius,
  type Puff,
} from './smoke';

const still = () => ({ x: 0, y: 0, z: 0 });
const nowhere = { x: 0, y: 0, z: 0 };
const stack = { x: 0, y: 4, z: 0 };
const DT = 1 / 120;

/** Run the plume for `seconds` out of a stationary stack in still air. */
function burn(seconds: number, air = still) {
  const smoke = createSmoke();
  for (let t = 0; t < seconds; t += DT) smoke.update(DT, stack, nowhere, air);
  return smoke;
}

const live = (smoke: { puffs: readonly Puff[] }) => smoke.puffs.filter((p) => p.age >= 0);

describe('smoke', () => {
  it('emits at the rate asked for, whatever the tick length', () => {
    // At 55 a second and a 120 Hz tick, less than one is due each time: the
    // fraction has to carry over or the plume comes out at nothing a second.
    for (const dt of [1 / 120, 1 / 60, 1 / 30]) {
      const smoke = createSmoke();
      for (let t = 0; t < 2; t += dt) smoke.update(dt, stack, nowhere, still);
      expect(live(smoke).length, `dt ${dt}`).toBeGreaterThan(defaultSmokeOptions.rate * 2 * 0.9);
    }
  });

  it('settles at as many puffs as fit in one lifetime', () => {
    // Rate times life, give or take the spread on the lifetimes.
    const smoke = burn(20);
    const expected = defaultSmokeOptions.rate * defaultSmokeOptions.life;
    expect(live(smoke).length).toBeGreaterThan(expected * 0.75);
    expect(live(smoke).length).toBeLessThan(expected * 1.25);
  });

  it('never outgrows the room it was given', () => {
    // The ring is sized from the rate and the longest life; overrunning it
    // would quietly overwrite puffs that are still burning.
    const smoke = burn(60);
    expect(live(smoke).length).toBeLessThanOrEqual(smoke.puffs.length);
  });

  it('leaves the stack and climbs', () => {
    const smoke = burn(3);
    const above = live(smoke).filter((p) => p.y > stack.y + 1).length;
    expect(above).toBeGreaterThan(live(smoke).length / 3);
    // And nothing has fallen back down through the chimney.
    for (const puff of live(smoke)) expect(puff.y).toBeGreaterThan(stack.y - 0.5);
  });

  it('stops climbing as it cools, instead of rising forever', () => {
    // Hot exhaust goes up hard and then stops going up. Without that a plume
    // is a column standing on the engine rather than a cloud lying over it.
    const smoke = burn(12);
    const old = live(smoke).filter((p) => p.age > 6);
    expect(old.length).toBeGreaterThan(0);
    for (const puff of old) expect(puff.vy).toBeLessThan(defaultSmokeOptions.exhaust * 0.5);
  });

  it('lies down and drifts with the wind', () => {
    const blown = burn(10, () => ({ x: 9, y: 0, z: 0 }));
    const calm = burn(10);
    const reach = (s: typeof blown) => Math.max(...live(s).map((p) => Math.abs(p.x)));
    expect(reach(blown)).toBeGreaterThan(reach(calm) + 20);
  });

  it('is never blown faster than the air blowing it', () => {
    const smoke = burn(15, () => ({ x: 9, y: 0, z: 0 }));
    for (const puff of live(smoke)) expect(puff.vx).toBeLessThanOrEqual(9 + 1e-9);
  });

  it('trails behind something that is moving', () => {
    // Carried out of the stack at the machine's own speed, so the plume lies
    // along the track rather than standing over the chimney.
    const smoke = createSmoke();
    for (let t = 0; t < 4; t += DT) smoke.update(DT, stack, { x: 12, y: 0, z: 0 }, still);
    expect(Math.max(...live(smoke).map((p) => p.x))).toBeGreaterThan(15);
  });

  it('thins away rather than switching off', () => {
    const puff: Puff = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 4, seed: 0 };
    const seen: number[] = [];
    // Sampled a frame at a time, because the rise is deliberately quick --
    // exhaust is thick the moment it is out -- and a coarser sample would
    // read that as a jump.
    for (let age = 0; age <= 4; age += 1 / 60) {
      puff.age = age;
      seen.push(puffOpacity(puff));
    }

    // It never quite reaches one, because it has started thinning before it
    // has finished thickening. Thick enough is the point.
    expect(Math.max(...seen)).toBeGreaterThan(0.85);
    expect(seen[seen.length - 1]!).toBeCloseTo(0, 3);
    for (let i = 1; i < seen.length; i += 1) {
      expect(Math.abs(seen[i]! - seen[i - 1]!), `at sample ${i}`).toBeLessThan(0.08);
    }

    // And past its life it is gone, not negative.
    puff.age = 5;
    expect(puffOpacity(puff)).toBe(0);
  });

  it('gives an empty slot no substance at all', () => {
    expect(puffOpacity({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: -1, life: 4, seed: 0 })).toBe(0);
  });

  it('spreads as it ages', () => {
    const young: Puff = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 8, seed: 0 };
    const old: Puff = { ...young, age: 6 };
    expect(puffRadius(young, defaultSmokeOptions)).toBeCloseTo(defaultSmokeOptions.size, 9);
    expect(puffRadius(old, defaultSmokeOptions)).toBeGreaterThan(
      puffRadius(young, defaultSmokeOptions) * 3,
    );
  });

  it('is the same smoke every time, for a given seed', () => {
    const a = burn(5);
    const b = burn(5);
    expect(live(a).map((p) => p.x.toFixed(6))).toEqual(live(b).map((p) => p.x.toFixed(6)));
  });

  it('does nothing on a tick of no time at all', () => {
    const smoke = createSmoke();
    smoke.update(0, stack, nowhere, still);
    expect(live(smoke)).toHaveLength(0);
  });

  it('is thick enough to see nothing through', () => {
    // The requirement was a lot of smoke, more than one would expect, and
    // "a lot" is measurable: add up the area of every puff, against the area
    // of the plume they make between them. Below about one there are gaps and
    // you can see the yard through it. This is fifteen.
    const smoke = createSmoke();
    const blowing = () => ({ x: 3.5, y: 0, z: 1.5 });
    for (let t = 0; t < 40; t += DT) {
      smoke.update(DT, stack, { x: 6, y: 0, z: 0 }, blowing);
    }

    let area = 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const puff of live(smoke)) {
      const r = puffRadius(puff, defaultSmokeOptions);
      area += Math.PI * r * r * puffOpacity(puff);
      minX = Math.min(minX, puff.x - r);
      maxX = Math.max(maxX, puff.x + r);
      minY = Math.min(minY, puff.y - r);
      maxY = Math.max(maxY, puff.y + r);
    }

    const frontal = (maxX - minX) * (maxY - minY);
    expect(area / frontal).toBeGreaterThan(8);
    // And it is a plume rather than a puff: tens of metres of it.
    expect(maxX - minX).toBeGreaterThan(40);
    expect(maxY - minY).toBeGreaterThan(20);
  });
});

/**
 * A step is a stretch of track, not a point.
 *
 * A plume far from the bird is worked out a second at a time rather than a
 * hundred and twentieth, which is what makes it nearly free. That only works
 * if what a second buys is a second's worth of plume laid along the way the
 * engine came -- otherwise it is eighty puffs stacked on one spot, sixteen
 * metres from the last eighty, and when the train comes into view it is
 * trailing a string of beads.
 */
describe('a plume laid down in one long step', () => {
  /** Where the live puffs are, along the axis the stack moved down. */
  const spread = (smoke: ReturnType<typeof createSmoke>) => {
    const live = smoke.puffs.filter((p) => p.age >= 0).map((p) => p.x);
    return { count: live.length, low: Math.min(...live), high: Math.max(...live) };
  };

  it('lays the puffs along the way the stack came, not all where it got to', () => {
    const smoke = createSmoke();
    // One second of travel at 16 m/s, in a single step.
    smoke.update(1 / 120, { ...stack, x: 0 }, nowhere, still);
    smoke.update(1, { ...stack, x: 16 }, nowhere, still);

    const laid = spread(smoke);
    expect(laid.count).toBeGreaterThan(50);
    // Spread down the sixteen metres rather than piled at the end of them.
    expect(laid.low).toBeLessThan(2);
    expect(laid.high).toBeGreaterThan(14);
  });

  it('leaves no gap where one step ends and the next begins', () => {
    const smoke = createSmoke();
    smoke.update(1 / 120, { ...stack, x: 0 }, nowhere, still);
    for (let step = 1; step <= 3; step += 1) {
      smoke.update(1, { ...stack, x: step * 16 }, nowhere, still);
    }
    // Sorted, no two consecutive puffs further apart than a puff is wide.
    const along = smoke.puffs.filter((p) => p.age >= 0).map((p) => p.x).sort((a, b) => a - b);
    let widest = 0;
    for (let i = 1; i < along.length; i += 1) widest = Math.max(widest, along[i]! - along[i - 1]!);
    expect(widest).toBeLessThan(defaultSmokeOptions.size);
  });

  it('starts again when the stack has plainly been moved rather than driven', () => {
    // A level change puts the engine kilometres away. Smeared, that is a line
    // of smoke across the whole map; the plume should simply begin again.
    const smoke = createSmoke();
    smoke.update(1, { ...stack, x: 0 }, nowhere, still);
    smoke.update(1, { ...stack, x: 4000 }, nowhere, still);

    const along = smoke.puffs.filter((p) => p.age >= 0).map((p) => p.x);
    expect(along.length).toBeGreaterThan(100);
    // Smoke at both ends, and none of it in between.
    expect(along.filter((x) => x < 100).length).toBeGreaterThan(50);
    expect(along.filter((x) => x > 3900).length).toBeGreaterThan(50);
    expect(along.filter((x) => x > 500 && x < 3500)).toEqual([]);
  });

  it('gives the same plume in one step as in many, near enough', () => {
    // Not identical -- this is an integration, not a straight line, so a
    // coarse step really does come out a little different. The claim is only
    // that it is the same plume: the same amount of smoke, in the same place,
    // going the same way.
    const fine = createSmoke();
    for (let t = 0; t < 1; t += DT) fine.update(DT, stack, nowhere, still);
    const coarse = createSmoke();
    coarse.update(1, stack, nowhere, still);

    expect(coarse.living).toBeCloseTo(fine.living, -1);
    const top = (smoke: ReturnType<typeof createSmoke>) =>
      Math.max(...smoke.puffs.filter((p) => p.age >= 0).map((p) => p.y));
    // Within a couple of metres of the same height after a second of climb.
    expect(Math.abs(top(coarse) - top(fine))).toBeLessThan(2.5);
  });
});
