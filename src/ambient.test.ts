import { describe, expect, it } from 'vitest';
import { CONTAGION, createAmbient, type Ground } from './ambient';
import { defaultParams, isPerched } from './sim/flight';
import { createWind, defaultWindParams } from './sim/wind';
import { WANDER_RANGE } from './sim/wander';

const TICK = 1 / 120;
const p = defaultParams;
const wind = createWind(defaultWindParams);

/** A slab of concrete twelve metres by eight, turned off the map's axes. */
const SLAB: Ground = { x: 100, z: -40, yaw: 0.6, width: 12, depth: 8, top: p.groundHeight };

/** Random numbers that are not random, so a square is the same square twice. */
const rolls = (values: number[]) => {
  let at = 0;
  return () => values[at++ % values.length]!;
};

/** And a spread of them, for the checks that have to reach into the corners. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const someBirds = (count = 4, random = rolls([0.2, 0.7, 0.45, 0.9, 0.1, 0.6, 0.35, 0.8])) =>
  createAmbient({ count, ground: SLAB, morphs: 4, flight: p, random });

/** Run for `seconds` with nothing in the way. */
const run = (ambient: ReturnType<typeof createAmbient>, seconds: number) => {
  for (let t = 0; t < seconds / TICK; t += 1) ambient.update(TICK, undefined, wind);
};

/** How far a point is from the middle of the slab, in the slab's own frame. */
function onSlab(x: number, z: number) {
  const dx = x - SLAB.x;
  const dz = z - SLAB.z;
  return {
    along: dx * Math.cos(SLAB.yaw) - dz * Math.sin(SLAB.yaw),
    across: dx * Math.sin(SLAB.yaw) + dz * Math.cos(SLAB.yaw),
  };
}

describe('the pigeons on the concrete', () => {
  it('stands every one of them on the slab, on its feet', () => {
    // Homes are picked in the slab's own frame, so this holds however the
    // concrete is turned -- and getting the turn wrong would put pigeons in
    // the road beside it, which is exactly the sort of thing that looks fine
    // from above and is wrong.
    //
    // Forty of them rather than four, from a spread of random numbers: a slab
    // half again as long as it is wide only betrays a missing rotation near
    // its ends, and four birds may all be near the middle.
    const ambient = someBirds(40, mulberry32(7));
    expect(ambient.birds).toHaveLength(40);
    for (const pigeon of ambient.birds) {
      expect(isPerched(pigeon.state)).toBe(true);
      expect(pigeon.state.position.y).toBeCloseTo(SLAB.top + p.bodyRadius, 6);
      const { along, across } = onSlab(pigeon.state.position.x, pigeon.state.position.z);
      expect(Math.abs(along)).toBeLessThanOrEqual(SLAB.width / 2);
      expect(Math.abs(across)).toBeLessThanOrEqual(SLAB.depth / 2);
    }
  });

  it('has them walking about the place rather than standing to attention', () => {
    // The reason they are here at all: a person throwing grain at four
    // statues is not a person feeding pigeons.
    const ambient = someBirds();
    const before = ambient.birds.map((pigeon) => ({ ...pigeon.state.position }));
    run(ambient, 8);

    const moved = ambient.birds.map((pigeon, i) =>
      Math.hypot(pigeon.state.position.x - before[i]!.x, pigeon.state.position.z - before[i]!.z),
    );
    expect(moved.every((away) => away > 0.1)).toBe(true);
    // And still where they belong: none of them has walked off to Vienna.
    for (const away of moved) expect(away).toBeLessThan(WANDER_RANGE * 2);
  });

  it('puts up the birds near a take-off and leaves the far ones feeding', () => {
    // Contagious fear, and the half of it that is easy to lose: the birds
    // that did not notice. A square where every bird goes up whenever any
    // bird goes up is one nervous animal rather than several.
    const ambient = someBirds();
    const near = ambient.birds[0]!.state.position;
    const up = ambient.startle(near.x, near.z, 3);

    expect(up).toBeGreaterThan(0);
    expect(up).toBeLessThan(ambient.birds.length);
    for (const pigeon of ambient.birds) {
      const away = Math.hypot(pigeon.state.position.x - near.x, pigeon.state.position.z - near.z);
      expect(isPerched(pigeon.state), `${away.toFixed(1)} m away`).toBe(away > 3);
    }
  });

  it('takes no notice of something happening across the square', () => {
    // Stated on its own, because the distance is the whole rule and a
    // `startle` that ignored it would still pass a test that only checks
    // birds going up.
    const ambient = someBirds();
    const home = ambient.birds[0]!.wander.home;
    expect(ambient.startle(home.x + CONTAGION + 20, home.z, CONTAGION)).toBe(0);
    for (const pigeon of ambient.birds) expect(isPerched(pigeon.state)).toBe(true);
  });

  it('flies the startled ones away and up rather than dropping them', () => {
    // They leave under the same flight model everything else uses, so this is
    // the check that they are actually being flown: a bird taken off the
    // ground and left alone falls over within a second.
    const ambient = someBirds();
    const home = ambient.birds[0]!.wander.home;
    expect(ambient.startle(home.x, home.z, 100)).toBe(ambient.birds.length);

    run(ambient, 6);
    for (const pigeon of ambient.birds) {
      expect(pigeon.state.ending, 'still flying').toBeNull();
      expect(pigeon.state.position.y).toBeGreaterThan(SLAB.top + 5);
    }
  });

  it('leaves them out of the food, however long they fly on it', () => {
    // They are standing in a heap of grain and are scenery, so their bellies
    // are nobody's business. Stated in the air rather than on the ground,
    // because the ground is where it cannot fail: a belly is only spent
    // recovering stamina, and a walking bird spends none. It is the flushed
    // ones that would run out -- and a scenery bird whose belly empties stops
    // holding height and comes down in the middle of somebody's level.
    const ambient = someBirds();
    const home = ambient.birds[0]!.wander.home;
    ambient.startle(home.x, home.z, 100);
    run(ambient, 90);
    for (const pigeon of ambient.birds) expect(pigeon.state.health).toBe(1);
  });

  it('gives them somewhere new to make for as they get there', () => {
    // Otherwise the flush is four birds converging on one point in the sky.
    const ambient = someBirds();
    const home = ambient.birds[0]!.wander.home;
    ambient.startle(home.x, home.z, 100);

    const first = ambient.birds.map((pigeon) => ({ ...pigeon.aiming! }));
    run(ambient, 20);
    const now = ambient.birds.map((pigeon) => pigeon.aiming!);
    expect(now.some((to, i) => to.x !== first[i]!.x || to.z !== first[i]!.z)).toBe(true);
  });
});
