import { describe, expect, it } from 'vitest';
import { createSmoke, defaultSmokeOptions, puffOpacity, puffRadius, type Puff } from './smoke';

const calm = { x: 0, y: 0, z: 0 };
const stack = { x: 0, y: 4, z: 0 };
const DT = 1 / 120;

/** Run the plume for `seconds` out of a stationary stack, exactly. */
function burn(seconds: number, wind = calm, from = stack) {
  const smoke = createSmoke();
  for (let i = 0; i < Math.round(seconds * 120); i += 1) smoke.update(DT, from, wind);
  return smoke;
}

/** The puffs that are actually out. */
const out = (smoke: { puffs: readonly Puff[] }) => smoke.puffs.filter((p) => p.risen >= 0);

describe('a plume of exhaust', () => {
  it('emits at the rate asked for, whatever the tick length', () => {
    // Ten seconds is ten puffs taken a step at a time or a second at a time.
    // At one a second and a 120 Hz tick, every single step owes less than a
    // whole puff -- so a version that dropped the fraction instead of
    // carrying it would emit nothing at all, for ever.
    const fine = burn(10);
    const coarse = createSmoke();
    for (let t = 0; t < 10; t += 1) coarse.update(1, stack, calm);

    expect(coarse.living).toBe(10);
    // Within one, the last of them being a rounding error away from due.
    expect(fine.living).toBeGreaterThanOrEqual(9);
    expect(fine.living).toBeLessThanOrEqual(10);
  });

  it('settles at as many as fit in one climb, rather than growing for ever', () => {
    // A puff lasts as long as it takes to reach the top, so the plume settles
    // at one for each second of that and stays there however long it runs.
    const climbing = defaultSmokeOptions.reach / defaultSmokeOptions.climb;
    const settled = burn(60).living;
    expect(settled).toBeGreaterThan(climbing - 1);
    expect(settled).toBeLessThan(climbing + 1);
    expect(burn(600).living).toBe(settled);
  });

  it('never outgrows the room it was given', () => {
    const smoke = burn(600);
    expect(smoke.living).toBeLessThanOrEqual(smoke.puffs.length);
  });

  it('leaves the stack and climbs at the speed it says', () => {
    // The first puff is owed after a second, so at three seconds the oldest
    // has been out for two of them.
    const smoke = burn(3);
    const highest = Math.max(...out(smoke).map((p) => p.y));
    expect(highest - stack.y).toBeCloseTo(2 * defaultSmokeOptions.climb, 6);
  });

  it('goes on climbing at the same speed rather than slowing', () => {
    // The whole simplification: exhaust that has left the chimney is just
    // air, and air does not remember how hard it was pushed.
    const smoke = burn(12);
    const heights = out(smoke)
      .map((p) => p.risen)
      .sort((a, b) => a - b);
    const gaps = heights.slice(1).map((h, i) => h - heights[i]!);
    for (const gap of gaps) expect(gap).toBeCloseTo(defaultSmokeOptions.climb, 6);
  });

  it('leans downwind, and further the higher it has got', () => {
    const smoke = burn(12, { x: 4, y: 0, z: 0 });
    const laid = out(smoke).sort((a, b) => a.risen - b.risen);
    for (let i = 1; i < laid.length; i += 1) {
      expect(laid[i]!.x, `puff ${i}`).toBeGreaterThan(laid[i - 1]!.x);
    }
    // Drifting at the wind's own speed, not some fraction of it.
    const top = laid[laid.length - 1]!;
    expect(top.x).toBeCloseTo((top.risen / defaultSmokeOptions.climb) * 4, 1);
  });

  it('is only ever lit where the stack is now', () => {
    // The thing that makes a reversing train safe. A plume laid along the way
    // the engine came is wrong the moment the engine turns round, and wrong
    // again if it ever changes speed.
    const smoke = createSmoke();
    smoke.update(1, { ...stack, x: 0 }, calm);
    smoke.update(1, { ...stack, x: 40 }, calm);
    smoke.update(1, { ...stack, x: 0 }, calm);

    const laid = out(smoke).map((p) => p.x).sort((a, b) => a - b);
    expect(laid).toHaveLength(3);
    expect(laid).toEqual([0, 0, 40]);
  });

  it('thins away rather than switching off', () => {
    const climbing = [0, 6, 15, 24, 29].map((risen) => ({ ...stack, risen, seed: 0 }));
    const fading = climbing.map((p) => puffOpacity(p, defaultSmokeOptions));
    for (let i = 2; i < fading.length; i += 1) {
      expect(fading[i]!, `${i}`).toBeLessThan(fading[i - 1]!);
    }
    expect(fading[fading.length - 1]!).toBeLessThan(0.02);
  });

  it('eases in over the first metre, so it does not appear from nothing', () => {
    const atTheStack = puffOpacity({ ...stack, risen: 0, seed: 0 }, defaultSmokeOptions);
    const justOut = puffOpacity({ ...stack, risen: 1, seed: 0 }, defaultSmokeOptions);
    expect(atTheStack).toBe(0);
    expect(justOut).toBeGreaterThan(0.9);
  });

  it('gives an empty slot no substance at all', () => {
    expect(puffOpacity({ ...stack, risen: -1, seed: 0 }, defaultSmokeOptions)).toBe(0);
  });

  it('spreads as it climbs, not as it ages', () => {
    const low = puffRadius({ ...stack, risen: 0, seed: 0 }, defaultSmokeOptions);
    const high = puffRadius({ ...stack, risen: 30, seed: 0 }, defaultSmokeOptions);
    expect(low).toBe(defaultSmokeOptions.size);
    expect(high).toBeCloseTo(defaultSmokeOptions.size + 30 * defaultSmokeOptions.spread, 9);
    // And wide enough at the bottom to overlap its neighbour, which is what
    // makes a line of separate balls read as a column of smoke.
    expect(low * 2).toBeGreaterThan(defaultSmokeOptions.climb);
  });

  it('is the same smoke every time, for a given seed', () => {
    const a = createSmoke(defaultSmokeOptions, 5);
    const b = createSmoke(defaultSmokeOptions, 5);
    for (let t = 0; t < 4; t += DT) {
      a.update(DT, stack, calm);
      b.update(DT, stack, calm);
    }
    expect(a.puffs).toEqual(b.puffs);
  });

  it('does nothing on a tick of no time at all', () => {
    const smoke = burn(4);
    const before = JSON.parse(JSON.stringify(smoke.puffs));
    smoke.update(0, stack, calm);
    expect(smoke.puffs).toEqual(before);
  });

  it('dies exactly where it has faded to nothing', () => {
    // The renderer draws every puff in the world from `defaultSmokeOptions`,
    // because a puff carries where it is and how far it has risen but not
    // which plume it belongs to. So a plume that stopped short of its reach
    // would vanish at full strength, and one that outlived it would go on
    // being drawn at nothing.
    const last = puffOpacity({ ...stack, risen: defaultSmokeOptions.reach - 0.1, seed: 0 }, defaultSmokeOptions);
    expect(last).toBeLessThan(0.01);

    const smoke = burn(600);
    for (const puff of out(smoke)) expect(puff.risen).toBeLessThan(defaultSmokeOptions.reach);
  });

  it('costs a fraction of what a particle system did', () => {
    // A couple of dozen puffs against 1,883, and no wind lookup per puff per
    // tick -- that lookup was the single most expensive thing in the whole
    // simulation.
    expect(createSmoke().puffs.length).toBeLessThan(30);
  });
});
