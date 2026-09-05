import { describe, expect, it } from 'vitest';
import { createFlock, defaultFlockOptions } from './flock';
import { defaultAutopilotParams, distanceTo, headingError, steer } from './sim/autopilot';
import { bankAngle, createBird, defaultParams, neutralControls, step } from './sim/flight';
import { createColliderField, turnedBox } from './sim/collision';
import { calm, createWind } from './sim/wind';
import { vec } from './sim/math3';

const DT = 1 / 120;

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
    const flock = createFlock(8);
    const ring = Array.from({ length: 48 }, (_, i) => {
      const around = (i / 48) * Math.PI * 2;
      return turnedBox(Math.cos(around) * 150, Math.sin(around) * 150, 40, 400, 40, around);
    });
    const wall = createColliderField(ring);
    const wind = createWind();

    let died = 0;
    const seen = flock.members.map(() => false);
    for (let t = 0; t < 200; t += DT) {
      flock.update(DT, wall, wind);
      flock.members.forEach((member, i) => {
        if (member.state.ending && !seen[i]) {
          seen[i] = true;
          died += 1;
        } else if (!member.state.ending) {
          seen[i] = false;
        }
      });
    }

    // Every one of them, many times over: they cannot get out.
    expect(died).toBeGreaterThan(flock.members.length);

    // Then take the wall away. Counting survivors while they are still trapped
    // measures nothing but how many happened to be mid-respawn at the whistle.
    const open = createColliderField([]);
    for (let t = 0; t < 8; t += DT) flock.update(DT, open, wind);
    expect(flock.members.every((m) => !m.state.ending)).toBe(true);
  });
});

describe('leaving the roost', () => {
  it('scatters in every direction by default', () => {
    // A loft on a roof has open sky all round it.
    const flock = createFlock(4, { x: 0, y: 30, z: 0 });
    const bearings = flock.members.map((m) =>
      Math.atan2(m.state.velocity.x, -m.state.velocity.z),
    );
    const spread = Math.max(...bearings) - Math.min(...bearings);
    expect(spread).toBeGreaterThan(Math.PI);
  });

  it('leaves along the line when it is given one', () => {
    // A roost in a rail yard is ringed with blocks of flats, and the open
    // ground is the corridor. Released every which way they fly into the
    // buildings before they have climbed over them.
    const bearing = Math.PI / 2;
    const spread = 0.7;
    const flock = createFlock(4, { x: 0, y: 4, z: 0 }, {
      ...defaultFlockOptions,
      outbound: { bearing, spread },
    });

    for (const member of flock.members) {
      const went = Math.atan2(member.state.velocity.x, -member.state.velocity.z);
      const off = Math.abs(((went - bearing + Math.PI) % (2 * Math.PI)) - Math.PI);
      expect(off).toBeLessThanOrEqual(spread + 1e-6);
    }
  });

  it('releases them from the height the roost is at', () => {
    // Not from a fixed altitude, which is what it used to do -- and which was
    // invisible only because the one caller passed the same number.
    for (const height of [4.4, 30, 90]) {
      const flock = createFlock(3, { x: 12, y: height, z: -8 });
      for (const member of flock.members) {
        expect(member.state.position.y).toBe(height);
        expect(member.state.position.x).toBe(12);
        expect(member.state.position.z).toBe(-8);
      }
    }
  });
});
