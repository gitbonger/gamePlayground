import { describe, expect, it } from 'vitest';
import { createFlock, defaultFlockOptions } from './flock';
import { defaultAutopilotParams, distanceTo, headingError, steer } from './sim/autopilot';
import { bankAngle, createBird, defaultParams, neutralControls, step } from './sim/flight';
import { createColliderField, turnedBox } from './sim/collision';
import { calm, createWind } from './sim/wind';
import { vec } from './sim/math3';

const DT = 1 / 120;

/** A leader that stays put, so what the flock does is the only thing moving. */
const still = (x = 0, y = 60, z = 0, heading = 0) => () => ({ x, y, z, heading });

describe('heading error', () => {
  it('takes the short way round', () => {
    expect(headingError(0, 1)).toBeCloseTo(1, 9);
    expect(headingError(1, 0)).toBeCloseTo(-1, 9);
    // Just west of north to just east of it is a small turn, not a big one.
    expect(headingError(3.0, -3.0)).toBeCloseTo(Math.PI * 2 - 6, 9);
    expect(Math.abs(headingError(3.0, -3.0))).toBeLessThan(0.5);
  });
});

describe('the autopilot', () => {
  /**
   * Fly one bird under the autopilot, moving it on to the next waypoint as it
   * arrives, which is what the flock does. Held on one point for ever it
   * circles, tightens up and eventually puts itself down -- correct, but not
   * what is being measured here.
   */
  function fly(seconds: number, route = [{ x: 400, z: -400, altitude: 70 }]) {
    const bird = createBird(vec(0, 70, 0), 14, 0);
    const controls = neutralControls();
    const memory = { beating: true };
    let steepest = 0;
    let lowest = Infinity;
    let leg = 0;

    for (let t = 0; t < seconds; t += DT) {
      const target = route[leg % route.length]!;
      if (distanceTo(bird, target) < defaultAutopilotParams.arrival) leg += 1;
      steer(bird, target, memory, controls);
      // No collider: anything that goes wrong here is the pilot, not a wall.
      step(bird, controls, defaultParams, DT, undefined, calm);
      if (bird.ending) break;
      steepest = Math.max(steepest, Math.abs(bankAngle(bird)));
      lowest = Math.min(lowest, bird.position.y);
    }
    return { bird, steepest, lowest };
  }

  /** A circuit, so the bird always has somewhere new to be. */
  const CIRCUIT = [
    { x: 400, z: -400, altitude: 70 },
    { x: -350, z: -450, altitude: 85 },
    { x: -420, z: 380, altitude: 60 },
    { x: 430, z: 410, altitude: 75 },
  ];

  it('holds a sane bank instead of rolling right over', () => {
    // Commanding roll straight from heading error rolls for ever, because roll
    // is a rate: the first version of this flew the whole flock inverted.
    const { steepest } = fly(90, CIRCUIT);
    expect(steepest).toBeLessThan(defaultAutopilotParams.maxBank + 0.35);
  });

  it('stays airborne when left to itself', () => {
    const { bird, lowest } = fly(120, CIRCUIT);
    expect(bird.ending).toBeNull();
    expect(lowest).toBeGreaterThan(5);
  });

  it('gets where it is going', () => {
    const target = { x: 400, z: -400, altitude: 70 };
    const { bird } = fly(60, [target]);
    expect(distanceTo(bird, target)).toBeLessThan(Math.hypot(400, 400));
  });

  it('puts the nose down when it runs out of flying speed', () => {
    const bird = createBird(vec(0, 80, 0), 4, 0);
    const controls = neutralControls();
    steer(bird, { x: 0, z: -400, altitude: 200 }, { beating: true }, controls);
    // Even asked to climb 120 m, a bird below flying speed lowers the nose.
    expect(controls.pitch).toBeLessThanOrEqual(0);
  });

  it('flies the speed with the nose and the height with the wings', () => {
    // Pitching up to climb at ten metres a second only bleeds the speed the
    // wing needs, so pitch holds the airspeed and the beat holds the height.
    const slow = createBird(vec(0, 70, 0), 8, 0);
    const fast = createBird(vec(0, 70, 0), 22, 0);
    const controls = neutralControls();

    steer(slow, { x: 0, z: -400, altitude: 70 }, { beating: true }, controls);
    expect(controls.pitch).toBeLessThan(0);

    steer(fast, { x: 0, z: -400, altitude: 70 }, { beating: true }, controls);
    expect(controls.pitch).toBeGreaterThan(0);
  });

  it('lifts its sights when it gets low', () => {
    // Above its waypoint but below the floor: without the floor it would be
    // content to stay down among the rooftops.
    const bird = createBird(vec(0, 25, 0), 14, 0);
    const controls = neutralControls();
    steer(bird, { x: 0, z: -400, altitude: 20 }, { beating: true }, controls);
    expect(controls.flap).toBe(true);
  });

  it('rests before it is spent, not after', () => {
    // Thrust falls away with stamina, so beating on to exhaustion means
    // beating at a fraction of full power -- which sinks the bird while it
    // looks like it is trying.
    expect(defaultAutopilotParams.flapBelow).toBeGreaterThan(0.3);
    expect(defaultAutopilotParams.flapAbove).toBeGreaterThan(defaultAutopilotParams.flapBelow);
  });
});

describe('the flock', () => {
  it('launches the number asked for, in a spread of colours', () => {
    const flock = createFlock(8);
    expect(flock.members).toHaveLength(defaultFlockOptions.count);
    expect(new Set(flock.members.map((m) => m.morph)).size).toBeGreaterThan(2);
    for (const member of flock.members) {
      expect(member.morph).toBeGreaterThanOrEqual(0);
      expect(member.morph).toBeLessThan(8);
    }
  });

  it('is the same flock every time', () => {
    const a = createFlock(8);
    const b = createFlock(8);
    expect(a.members.map((m) => m.morph)).toEqual(b.members.map((m) => m.morph));
  });

  it('keeps most of them in the air over a city', () => {
    const flock = createFlock(8);
    const city = createColliderField(
      // A grid of towers to blunder into.
      Array.from({ length: 400 }, (_, i) =>
        turnedBox(((i % 20) - 10) * 60, (Math.floor(i / 20) - 10) * 60, 26, 22, 26, 0),
      ),
    );
    const wind = createWind();

    let airborne = 0;
    let samples = 0;
    for (let t = 0; t < 180; t += DT) {
      flock.update(DT, city, wind);
      if (Math.abs(t % 1) < DT) {
        for (const member of flock.members) {
          samples += 1;
          if (!member.state.ending) airborne += 1;
        }
      }
    }
    expect(airborne / samples).toBeGreaterThan(0.85);
  });

  it('brings them back after they die', () => {
    // Walled in rather than sent through a field of towers to see who trips
    // over one. That is how this used to work, and it tested the autopilot's
    // incompetence as much as the respawn: the flying improved and the test
    // quietly stopped exercising anything, because nobody hit anything any
    // more. A closed wall they cannot out-climb kills every one of them
    // through the same code path a real collision uses.
    //
    // The wall has come in to 45 m, because the flock has. Escorting a leader
    // it wheels out to about seventy and no further, so a ring at the old 150
    // is one it would never reach -- which is exactly the way this test has
    // gone quiet once before.
    //
    // Counted by watching them reappear rather than by watching them die. A
    // bird goes back in the air on the tick it hits something, so an ending is
    // never visible from outside: polling for one sees nothing at all.
    const flock = createFlock(8, still(0, 60, 0));
    const ring = Array.from({ length: 64 }, (_, i) => {
      const around = (i / 64) * Math.PI * 2;
      // Thin, so its inner face really is at 45 m: a 40 m deep box centred
      // there reaches in to 25, and the flock would die before it had flown
      // far enough out for a respawn to be distinguishable from ordinary
      // flying.
      return turnedBox(Math.cos(around) * 45, Math.sin(around) * 45, 40, 400, 6, around);
    });
    const wall = createColliderField(ring);
    const wind = createWind();

    let returns = 0;
    const out = flock.members.map(() => 0);
    for (let t = 0; t < 300; t += DT) {
      flock.update(DT, wall, wind);
      flock.members.forEach((member, i) => {
        if (member.down > 0) return;
        const away = Math.hypot(member.state.position.x, member.state.position.z);
        // A jump from well out to exactly the release point is a respawn:
        // nothing flies thirty metres in a hundred and twentieth of a second.
        if (out[i]! > 30 && Math.abs(away - defaultFlockOptions.spawnBehind) < 0.01) {
          returns += 1;
        }
        out[i] = away;
      });
    }

    // Every one of them, many times over: they cannot get out.
    expect(returns).toBeGreaterThan(flock.members.length);
    // And none of them is left lying there.
    expect(flock.members.every((m) => !m.state.ending)).toBe(true);
  });
});

describe('keeping the player company', () => {
  it('appears behind the leader, not on top of them', () => {
    const flock = createFlock(4, still(0, 60, 0, 0));
    for (const member of flock.members) {
      const back = Math.hypot(member.state.position.x, member.state.position.z);
      expect(back).toBeCloseTo(defaultFlockOptions.spawnBehind, 6);
    }
  });

  it('behind means behind whichever way the leader is facing', () => {
    // Facing north, "behind" is south, which is +Z. Facing east it is west.
    const north = createFlock(2, still(0, 60, 0, 0)).members[0]!;
    expect(north.state.position.z).toBeCloseTo(defaultFlockOptions.spawnBehind, 6);
    expect(north.state.position.x).toBeCloseTo(0, 6);

    const east = createFlock(2, still(0, 60, 0, Math.PI / 2)).members[0]!;
    expect(east.state.position.x).toBeCloseTo(-defaultFlockOptions.spawnBehind, 6);
    expect(east.state.position.z).toBeCloseTo(0, 6);
  });

  it('sets off the same way the leader is going, not turning to face them', () => {
    for (const bearing of [0, 1.2, -2.5]) {
      const member = createFlock(2, still(0, 60, 0, bearing)).members[0]!;
      const went = Math.atan2(member.state.velocity.x, -member.state.velocity.z);
      expect(went).toBeCloseTo(bearing, 6);
    }
  });

  it('follows the leader about rather than a spot on the map', () => {
    // A leader crossing the map: every bird let out is put behind wherever
    // the leader is by then, not behind where it started.
    let along = 0;
    const flock = createFlock(4, () => ({ x: along, y: 60, z: 0, heading: Math.PI / 2 }));
    const wind = createWind();

    for (let t = 0; t < 12; t += DT) {
      along += 19 * DT;
      flock.update(DT, undefined, wind);
    }

    // The last one out came from a point hundreds of metres from the first.
    const spread = Math.max(...flock.members.map((m) => m.state.position.x));
    expect(spread).toBeGreaterThan(100);
  });

  it('stays with a leader who stays put', () => {
    // The real claim: a stationary player is not left alone. Not inside the
    // 20 m targets are picked in -- a bird cruising at 11 m/s and banking to
    // 0.9 rad turns in about ten metres, so it overshoots and comes back
    // round -- but near enough to be company, and never at the stray limit,
    // which is what was really bounding this before the flock was given its
    // own way of flying.
    const flock = createFlock(6, still(0, 60, 0));
    const wind = createWind();
    const distances: number[] = [];

    for (let t = 0; t < 120; t += DT) {
      flock.update(DT, undefined, wind);
      for (const member of flock.members) {
        if (member.down > 0) continue;
        distances.push(Math.hypot(member.state.position.x, member.state.position.z));
      }
    }

    const furthest = distances.reduce((a, b) => Math.max(a, b), 0);
    expect(furthest).toBeLessThan(85);
    const mean = distances.reduce((a, b) => a + b, 0) / distances.length;
    expect(mean).toBeLessThan(40);
    // And well short of the stray rule, or that would be doing the work.
    expect(furthest).toBeLessThan(defaultFlockOptions.strayDistance * 0.7);
  });

  it('wheels over a leader on the ground instead of climbing away', () => {
    // The default autopilot's floor is 38 m: a flock escorting a pigeon that
    // has landed would spend the whole time getting away from it.
    const flock = createFlock(6, still(0, defaultParams.bodyRadius, 0));
    const wind = createWind();
    const heights: number[] = [];

    for (let t = 0; t < 90; t += DT) {
      flock.update(DT, undefined, wind);
      for (const member of flock.members) {
        if (member.down <= 0) heights.push(member.state.position.y);
      }
    }

    const mean = heights.reduce((a, b) => a + b, 0) / heights.length;
    expect(mean).toBeLessThan(defaultAutopilotParams.floor);
    // Overhead, not on top of them.
    expect(heights.reduce((a, b) => Math.min(a, b), Infinity)).toBeGreaterThan(4);
  });

  it('brings back one that has lost touch, rather than trailing it for ever', () => {
    const flock = createFlock(2, still(0, 60, 0));
    const wind = createWind();
    flock.update(DT, undefined, wind);

    const stray = flock.members[0]!;
    stray.state.position = { x: 400, y: 60, z: 0 };
    flock.update(DT, undefined, wind);

    expect(Math.hypot(stray.state.position.x, stray.state.position.z)).toBeCloseTo(
      defaultFlockOptions.spawnBehind,
      6,
    );
  });
});

describe('where they are aiming', () => {
  /**
   * Targets are private, so they are read from where the birds go: with a
   * stationary leader and no collider, the nearest each bird gets over a long
   * flight bounds where it was aiming.
   */
  function closestApproaches(leaderY: number, seconds = 120) {
    const flock = createFlock(6, still(0, leaderY, 0));
    const wind = createWind();
    const nearest = flock.members.map(() => Infinity);
    const lowest = flock.members.map(() => Infinity);

    for (let t = 0; t < seconds; t += DT) {
      flock.update(DT, undefined, wind);
      flock.members.forEach((member, i) => {
        if (member.down > 0) return;
        const out = Math.hypot(member.state.position.x, member.state.position.z);
        nearest[i] = Math.min(nearest[i]!, out);
        lowest[i] = Math.min(lowest[i]!, member.state.position.y);
      });
    }
    return { nearest, lowest };
  }

  it('gets in among the leader, rather than orbiting at a fixed stand-off', () => {
    // Every bird passes close at some point, which is what aiming inside a
    // 20 m circle round somebody looks like once a wing is involved.
    const { nearest } = closestApproaches(60);
    for (const near of nearest) expect(near).toBeLessThan(defaultFlockOptions.radius);
  });

  it('does not aim at the dirt when the leader is standing on it', () => {
    // The leader can be on foot now. Targets at the leader's own height would
    // be targets in the ground, and the flock would spend the run in it.
    const { lowest } = closestApproaches(defaultParams.bodyRadius, 60);
    for (const low of lowest) {
      expect(low).toBeGreaterThan(defaultFlockOptions.minAltitude * 0.5);
    }
  });

  it('picks its targets inside the radius, and never outside it', () => {
    const flock = createFlock(6, still(0, 60, 0));
    const wind = createWind();
    for (let t = 0; t < 120; t += DT) {
      flock.update(DT, undefined, wind);
      for (const member of flock.members) {
        const away = Math.hypot(member.aiming.x, member.aiming.z);
        expect(away).toBeLessThanOrEqual(defaultFlockOptions.radius + 1e-9);
      }
    }
  });

  it('spreads its targets over the circle instead of favouring the middle', () => {
    // Taking the radius straight from a random number bunches points at the
    // centre: half of them would land inside half the radius, which is a
    // quarter of the area. Evenly covered, it should be a quarter of them.
    const flock = createFlock(8, still(0, 60, 0));
    const wind = createWind();
    const radii: number[] = [];
    let was = flock.members.map((m) => `${m.aiming.x},${m.aiming.z}`);

    for (let t = 0; t < 240; t += DT) {
      flock.update(DT, undefined, wind);
      flock.members.forEach((member, i) => {
        const key = `${member.aiming.x},${member.aiming.z}`;
        if (key !== was[i]) {
          radii.push(Math.hypot(member.aiming.x, member.aiming.z));
          was[i] = key;
        }
      });
    }

    expect(radii.length).toBeGreaterThan(200);
    const inner = radii.filter((r) => r < defaultFlockOptions.radius / 2).length / radii.length;
    expect(inner).toBeGreaterThan(0.15);
    expect(inner).toBeLessThan(0.35);
  });

  it('keeps up with a leader it can match, rather than being recycled', () => {
    // A target is chosen against where the leader was at the time, so it goes
    // stale; the attention span is what makes a bird look again. Without it a
    // bird chases the memory until the stray rule hauls it back, which is a
    // teleport rather than flying.
    let along = 0;
    const flock = createFlock(6, () => ({ x: along, y: 60, z: 0, heading: Math.PI / 2 }));
    const wind = createWind();
    let recycles = 0;
    const was = flock.members.map(() => 0);

    for (let t = 0; t < 120; t += DT) {
      // Half the flock's own cruise, so keeping up is possible.
      along += 5 * DT;
      flock.update(DT, undefined, wind);
      flock.members.forEach((member, i) => {
        if (member.down > 0) return;
        const away = Math.hypot(member.state.position.x - along, member.state.position.z);
        if (was[i]! > 30 && Math.abs(away - defaultFlockOptions.spawnBehind) < 0.01) recycles += 1;
        was[i] = away;
      });
    }

    expect(recycles).toBe(0);
  });
});

describe('letting them out', () => {
  const open = createColliderField([]);

  it('emits one at a time rather than all at once', () => {
    // A loft waking up, not a spawn: the first is out immediately and the
    // rest follow at the emission interval.
    const flock = createFlock(4, still(0, 6, 0));
    const wind = createWind();
    const inTheAir = () => flock.members.filter((m) => m.down <= 0).length;

    expect(inTheAir()).toBe(1);
    for (const seconds of [3, 6, 9]) {
      for (let t = 0; t < 3; t += DT) flock.update(DT, open, wind);
      expect(inTheAir(), `${seconds}s`).toBe(seconds / defaultFlockOptions.emitInterval + 1);
    }
  });

  it('keeps the ones still waiting out of the air entirely', () => {
    // They have a position -- the roost -- but nothing should draw them there.
    const flock = createFlock(4, still(0, 6, 0));
    expect(flock.members.filter((m) => m.down > 0).length).toBe(flock.members.length - 1);
  });

  it('puts a dead one straight back', () => {
    const flock = createFlock(4, still(0, 40, 0));
    const wind = createWind();
    for (let t = 0; t < 30; t += DT) flock.update(DT, open, wind);

    const victim = flock.members.find((m) => m.down <= 0)!;
    const where = { ...victim.state.position };
    victim.state.ending = {
      kind: 'crashed',
      cause: 'hard-impact',
      speed: 12,
      sink: 6,
      bank: 0,
      position: where,
    };

    flock.update(DT, open, wind);
    expect(victim.state.ending).toBeNull();
    expect(victim.down).toBe(0);
    // Back behind the leader, not left where it fell.
    expect(Math.hypot(victim.state.position.x, victim.state.position.z)).toBeCloseTo(
      defaultFlockOptions.spawnBehind,
      6,
    );
  });
});
