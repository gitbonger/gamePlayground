import { describe, expect, it } from 'vitest';
import { createFlock, defaultFlockOptions, type Hunt } from './flock';
import { defaultAutopilotParams, distanceTo, headingError, steer } from './sim/autopilot';
import { bankAngle, createBird, defaultParams, neutralControls, step } from './sim/flight';
import { createColliderField, turnedBox } from './sim/collision';
import { calm, createWind } from './sim/wind';
import { vec, type Vec3 } from './sim/math3';

const DT = 1 / 120;

/** A leader that stays put, so what the flock does is the only thing moving. */
const still = (x = 0, y = 60, z = 0, heading = 0) => () => ({ x, y, z, heading, speed: 0, climb: 0 });

/** How far behind the leader the escort comes in, unwrapped from its spawn. */
const SPAWN_BEHIND =
  defaultFlockOptions.spawn.kind === 'behind' ? defaultFlockOptions.spawn.away : 0;

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
        if (out[i]! > 30 && Math.abs(away - SPAWN_BEHIND) < 0.01) {
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

  it('lets nobody out while the loft is shut', () => {
    // What the player sees when they have just flown into a building: the sky
    // stops restocking itself. A fresh pigeon appearing over the wreck is the
    // game carrying on cheerfully around a corpse.
    //
    // The same wall, so the same deaths happen -- and this time nobody comes
    // back from them.
    const flock = createFlock(8, still(0, 60, 0));
    const ring = Array.from({ length: 64 }, (_, i) => {
      const around = (i / 64) * Math.PI * 2;
      return turnedBox(Math.cos(around) * 45, Math.sin(around) * 45, 40, 400, 6, around);
    });
    const wall = createColliderField(ring);
    const wind = createWind();

    // Let them out first, so there is a flock to stop restocking.
    for (let t = 0; t < 20; t += DT) flock.update(DT, wall, wind);
    const flying = flock.members.filter((m) => !m.state.ending && m.down <= 0).length;
    expect(flying).toBeGreaterThan(0);

    for (let t = 0; t < 120; t += DT) flock.update(DT, wall, wind, false);
    // They have all hit the wall by now and stayed down, which is the claim:
    // dead where they fell, and no new ones.
    expect(flock.members.some((m) => m.state.ending !== null)).toBe(true);
    const left = flock.members.filter((m) => !m.state.ending && m.down <= 0).length;
    expect(left).toBeLessThan(flying);

    // And it is shut rather than broken: open it again and they come back.
    for (let t = 0; t < 20; t += DT) flock.update(DT, wall, wind);
    expect(flock.members.every((m) => !m.state.ending)).toBe(true);
  });

  it('holds back the ones that have not been let out yet', () => {
    // The other half, and the one that matters at the start of a level: they
    // come out one a second, so a player who dies in the first few seconds
    // has most of the flock still waiting. Those must wait, and they must
    // wait *properly* -- the wait is how everything else knows a bird is not
    // in the air yet, so a bird held at nought would be drawn sitting at its
    // spawn point in the middle of the shot.
    const flock = createFlock(8, still(0, 60, 0));
    const wind = createWind();
    const waiting = () => flock.members.filter((m) => m.down > 0).length;
    expect(waiting()).toBeGreaterThan(4);

    const held = waiting();
    for (let t = 0; t < 30; t += DT) flock.update(DT, undefined, wind, false);
    expect(waiting(), 'nobody let out, and nobody counted down').toBe(held);

    // Opened again, they come out at the spacing they would have had.
    for (let t = 0; t < 30; t += DT) flock.update(DT, undefined, wind);
    expect(waiting()).toBe(0);
  });
});

describe('where a bird appears', () => {
  /** A ring they cannot climb out of, so every one of them dies. */
  const cage = () => {
    const ring = Array.from({ length: 64 }, (_, i) => {
      const around = (i / 64) * Math.PI * 2;
      return turnedBox(Math.cos(around) * 45, Math.sin(around) * 45, 40, 400, 6, around);
    });
    return createColliderField(ring);
  };

  it('brings the escort in behind whatever it is following', () => {
    // The original, and still the one the player's flock uses: they are
    // following somebody, so they come in behind them going the same way. A
    // bird released nose-on spends its first seconds turning round in shot.
    const flock = createFlock(4, still(0, 60, 0, 0), {
      ...defaultFlockOptions,
      count: 4,
      spawn: { kind: 'behind', away: 12 },
    });
    for (const member of flock.members) {
      expect(Math.hypot(member.state.position.x, member.state.position.z)).toBeCloseTo(12, 6);
      // Behind is the heading reversed: at a heading of nought that is +Z.
      expect(member.state.position.z).toBeGreaterThan(0);
    }
  });

  it('puts one back at its place, wherever it died', () => {
    const flock = createFlock(2, still(0, 60, 0), {
      ...defaultFlockOptions,
      count: 2,
      emitInterval: 0,
      spawn: { kind: 'at', x: 30, y: 80, z: -10 },
    });
    const wind = createWind();
    for (let t = 0; t < 60; t += DT) flock.update(DT, cage(), wind);

    for (const member of flock.members) {
      // Wherever it got to, it has been put back here at least once, and it
      // is a place rather than a distance -- so they arrive on top of each
      // other and fly apart, which is what a loft looks like.
      expect(member.state.ending).toBeNull();
    }
    const fresh = createFlock(1, still(0, 60, 0), {
      ...defaultFlockOptions,
      count: 1,
      spawn: { kind: 'at', x: 30, y: 80, z: -10 },
    });
    expect(fresh.members[0]!.state.position).toEqual({ x: 30, y: 80, z: -10 });
  });

  it('leaves one that dies for good where it fell', () => {
    // A flock you can lose. Nothing puts them back, so the sky thins out --
    // which is the whole difference between scenery and something at stake.
    const flock = createFlock(4, still(0, 60, 0), {
      ...defaultFlockOptions,
      count: 4,
      emitInterval: 0,
      spawn: { kind: 'gone' },
    });
    const wind = createWind();
    for (let t = 0; t < 60; t += DT) flock.update(DT, cage(), wind);
    expect(flock.members.every((m) => m.state.ending !== null)).toBe(true);
  });

  it('puts one back exactly so far from where it went down', () => {
    // "A random point exactly fifty metres from the point of death." Exactly
    // is the word that matters, so it is measured from the point of death --
    // which means giving them half a second on the ground first. Measured
    // across the tick they die on, the answer comes out a few centimetres
    // short, because the bird flies part of that tick before it hits
    // anything and the jump is from where it started the tick rather than
    // from where it stopped.
    const away = 50;
    const flock = createFlock(3, still(0, 90, 0), {
      ...defaultFlockOptions,
      count: 3,
      emitInterval: 0,
      minAltitude: 20,
      respawnDelay: 0.5,
      spawn: { kind: 'nearby', away },
    });
    const wind = createWind();
    const walls = cage();

    const died: (Vec3 | null)[] = flock.members.map(() => null);
    let seen = 0;
    const bearings: number[] = [];

    for (let t = 0; t < 120; t += DT) {
      flock.update(DT, walls, wind);
      flock.members.forEach((member, i) => {
        if (member.state.ending) {
          died[i] = { ...member.state.position };
          return;
        }
        const fell = died[i];
        if (!fell) return;
        died[i] = null;
        seen += 1;
        // Fifty, plus at most one tick of flying: a bird is put back at the
        // top of the update and then flown for the rest of that same tick,
        // so the first look anybody gets at it is already a hundred and
        // thirty millimetres downstream at cruise. Held to a third of a
        // metre, which that accounts for and a wrong radius would not.
        const back = Math.hypot(
          member.state.position.x - fell.x,
          member.state.position.z - fell.z,
        );
        expect(Math.abs(back - away), `${back.toFixed(3)} m from where it fell`).toBeLessThan(0.3);
        bearings.push(
          Math.atan2(member.state.position.x - fell.x, member.state.position.z - fell.z),
        );
      });
    }

    expect(seen, 'some of them came back').toBeGreaterThan(2);
    // Random rather than always the same way round: two of them landing on
    // the same bearing would be a flock stacking up in one place.
    expect(new Set(bearings.map((b) => b.toFixed(3))).size).toBeGreaterThan(1);
  });
});

describe('going for something', () => {
  /** A pigeon sitting still at a place and a height, or nothing at all. */
  const quarry = (x: number, y: number, z: number, heading = 0) => () => ({
    x,
    y,
    z,
    heading,
    speed: 0,
    climb: 0,
  });

  const hunters = (hunt: Hunt) =>
    createFlock(1, still(0, 60, 0), {
      ...defaultFlockOptions,
      count: 2,
      emitInterval: 0,
      radius: 20,
      spawn: { kind: 'at', x: 0, y: 60, z: 0 },
      hunt,
    });

  const rules = { within: 50, above: 20, floor: 20, loses: 250, speed: 23, turn: 2.5 };

  it('goes for something that comes close enough, high enough', () => {
    const flock = hunters({ ...rules, quarry: quarry(10, 60, 10) });
    flock.update(DT, undefined, createWind());
    expect(flock.members.every((m) => m.hunting)).toBe(true);
  });

  it('lets a low one alone, however near it comes', () => {
    // The rule the level is built on: the warning says fly low, so flying low
    // has to keep one off you in the first place.
    const flock = hunters({ ...rules, quarry: quarry(0, 10, 0) });
    for (let t = 0; t < 5; t += DT) flock.update(DT, undefined, createWind());
    expect(flock.members.some((m) => m.hunting)).toBe(false);
  });

  it('lets a far one alone, however high it flies', () => {
    const flock = hunters({ ...rules, quarry: quarry(500, 90, 500) });
    for (let t = 0; t < 5; t += DT) flock.update(DT, undefined, createWind());
    expect(flock.members.some((m) => m.hunting)).toBe(false);
  });

  it('aims at the bird itself, and moves the aim with it', () => {
    // Not at a point it picked once. A crow that flew at where you were is a
    // crow you can leave behind by carrying on.
    let where = { x: 0, y: 60, z: 0 };
    const flock = hunters({
      ...rules,
      quarry: () => ({ ...where, heading: 0, speed: 0, climb: 0 }),
    });
    flock.update(DT, undefined, createWind());
    for (const member of flock.members) {
      expect(member.aiming.x).toBeCloseTo(0, 6);
      expect(member.aiming.z).toBeCloseTo(0, 6);
      expect(member.aiming.altitude).toBeCloseTo(60, 6);
    }

    where = { x: 40, y: 70, z: -25 };
    flock.update(DT, undefined, createWind());
    for (const member of flock.members) {
      expect(member.aiming.x).toBeCloseTo(40, 6);
      expect(member.aiming.z).toBeCloseTo(-25, 6);
      expect(member.aiming.altitude).toBeCloseTo(70, 6);
    }
  });

  it('keeps at it once it has started, however long it takes', () => {
    // It used to break off on arriving, which made an attack a single pass.
    // Now the chase is the thing: nothing but losing you ends it.
    const flock = hunters({ ...rules, quarry: quarry(30, 70, 0) });
    const wind = createWind();
    flock.update(DT, undefined, wind);
    expect(flock.members.every((m) => m.hunting)).toBe(true);

    for (let t = 0; t < 60; t += DT) flock.update(DT, undefined, wind);
    expect(flock.members.every((m) => m.hunting), 'still after it').toBe(true);
  });

  it('follows a bird that dives, but will not go down after it', () => {
    // The safety, and the whole shape of the level. Diving does not call off
    // an attack that has begun -- it puts the bird under the floor the crow
    // will not cross, so what was an attack becomes an escort.
    let where = { x: 0, y: 60, z: 0 };
    const flock = hunters({
      ...rules,
      quarry: () => ({ ...where, heading: 0, speed: 0, climb: 0 }),
    });
    flock.update(DT, undefined, createWind());
    expect(flock.members.every((m) => m.hunting)).toBe(true);

    // Down on the deck. Still hunted, still followed in plan -- and aimed at
    // no lower than the floor.
    where = { x: 0, y: 3, z: 0 };
    flock.update(DT, undefined, createWind());
    for (const member of flock.members) {
      expect(member.hunting, 'still after it').toBe(true);
      expect(member.aiming.x).toBeCloseTo(0, 6);
      expect(member.aiming.altitude).toBe(rules.floor);
    }
  });

  it('loses one that gets far enough away', () => {
    // Or a bird that saw you once follows you for the rest of the game, which
    // is not tenacity, it is a bug with a story attached.
    let where = { x: 0, y: 60, z: 0 };
    const flock = hunters({
      ...rules,
      quarry: () => ({ ...where, heading: 0, speed: 0, climb: 0 }),
    });
    flock.update(DT, undefined, createWind());
    expect(flock.members.every((m) => m.hunting)).toBe(true);

    where = { x: 0, y: 60, z: rules.loses + 50 };
    flock.update(DT, undefined, createWind());
    expect(flock.members.some((m) => m.hunting)).toBe(false);
  });

  it('closes on something that is running away from it', () => {
    // The whole complaint that started this: flown properly, a bird banks to
    // turn, and a bank is a circle sixteen metres across -- so it arrives
    // where the pigeon was, sails past, and comes round again. A hunting bird
    // is moved rather than flown, and this is the difference stated as a
    // number: the gap shuts.
    // Started off the crows' own spot, or the gap begins at nought and
    // "the gap shuts" is not a claim about anything.
    let where = { x: 0, y: 60, z: -30 };
    const flock = hunters({
      ...rules,
      quarry: () => ({ ...where, heading: 0, speed: 19, climb: 0 }),
    });
    const wind = createWind();
    flock.update(DT, undefined, wind);

    const gap = () =>
      Math.min(
        ...flock.members.map((m) =>
          Math.hypot(
            m.state.position.x - where.x,
            m.state.position.y - where.y,
            m.state.position.z - where.z,
          ),
        ),
      );
    const first = gap();

    // Running for it at a pigeon's cruise, in a straight line.
    for (let t = 0; t < 12; t += DT) {
      where = { ...where, z: where.z - 19 * DT };
      flock.update(DT, undefined, wind);
    }
    expect(gap(), `was ${first.toFixed(0)} m`).toBeLessThan(first);
    // Caught, and that is the claim: four metres a second of overtake against
    // a thirty-metre head start is a run-down rather than a tail chase, so a
    // player who answers a crow by flying flat out in a straight line loses.
    // Running is not the defence -- height is.
    expect(gap()).toBeLessThan(3);
  });

  it('turns onto it rather than sailing past', () => {
    // Started pointed the wrong way entirely. What it must not do is hold its
    // course, overshoot, and come round: that is the behaviour this replaced.
    const flock = hunters({ ...rules, quarry: quarry(0, 60, -40) });
    const wind = createWind();
    for (const member of flock.members) member.state.velocity = { x: 0, y: 0, z: 23 };

    let closest = Infinity;
    for (let t = 0; t < 6; t += DT) {
      flock.update(DT, undefined, wind);
      closest = Math.min(
        closest,
        ...flock.members.map((m) =>
          Math.hypot(m.state.position.x, m.state.position.y - 60, m.state.position.z + 40),
        ),
      );
    }
    expect(closest).toBeLessThan(2);
  });

  it('comes round in its own length, not in one tick', () => {
    // The cap on the cheat. A moved bird could be pointed at its quarry
    // instantly, and something that reverses between two frames is not a
    // crow, it is a homing missile -- the player sees a sprite snap round and
    // stops believing in any of it. So the course bends at a rate, and this
    // is that rate: nothing it does may turn it faster.
    //
    // Started dead astern on purpose, which is the hardest case and the one
    // an unbent version gets wrong most visibly.
    const flock = hunters({ ...rules, quarry: quarry(0, 60, -40) });
    const wind = createWind();
    for (const member of flock.members) member.state.velocity = { x: 0, y: 0, z: 23 };

    const bearing = (m: (typeof flock.members)[number]) => ({ ...m.state.velocity });
    let sharpest = 0;
    let was = flock.members.map(bearing);
    for (let t = 0; t < 3; t += DT) {
      flock.update(DT, undefined, wind);
      const now = flock.members.map(bearing);
      for (let i = 0; i < now.length; i += 1) {
        const a = was[i]!;
        const b = now[i]!;
        const ends = Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z);
        if (ends < 1e-6) continue;
        const turned = Math.acos(
          Math.min(1, Math.max(-1, (a.x * b.x + a.y * b.y + a.z * b.z) / ends)),
        );
        sharpest = Math.max(sharpest, turned);
      }
      was = now;
    }

    // A hair over the cap for the arithmetic, and nowhere near the half-turn
    // an uncapped one would take on the first tick.
    expect(sharpest).toBeLessThan(rules.turn * DT * 1.05);
    // And it did turn -- a bird frozen on its heading would also pass the
    // line above.
    expect(sharpest).toBeGreaterThan(rules.turn * DT * 0.5);
  });

  it('holds its speed and keeps above the floor while it chases', () => {
    // The cheat has limits, and this is the one that matters: it may ignore
    // the wind and the buildings, but it may not follow a bird onto the deck.
    const flock = hunters({ ...rules, quarry: quarry(0, 2, 0) });
    const wind = createWind();
    // Seen while it was still high, then straight down to the pavement.
    const seen = hunters({ ...rules, quarry: quarry(0, 60, 0) });
    seen.update(DT, undefined, wind);

    for (let t = 0; t < 8; t += DT) flock.update(DT, undefined, wind);
    for (const member of flock.members) {
      // It never saw this one -- two metres up is below the trigger -- so it
      // is still flying the ordinary model and is where the flock lives.
      expect(member.hunting).toBe(false);
    }

    const chasing = hunters({ ...rules, quarry: quarry(0, 60, 0) });
    chasing.update(DT, undefined, wind);
    expect(chasing.members.every((m) => m.hunting)).toBe(true);
    for (let t = 0; t < 8; t += DT) {
      chasing.update(DT, undefined, wind);
      for (const member of chasing.members) {
        expect(member.state.position.y).toBeGreaterThanOrEqual(rules.floor - 0.5);
        const going = Math.hypot(
          member.state.velocity.x,
          member.state.velocity.y,
          member.state.velocity.z,
        );
        expect(going).toBeCloseTo(rules.speed, 6);
      }
    }
  });

  it('stops going for something that is no longer there', () => {
    // The quarry can vanish -- a level ends, the bird dies, the game stops
    // caring. A crow still diving at where it used to be is a crow flying at
    // a memory.
    let alive = true;
    const flock = hunters({
      ...rules,
      quarry: () => (alive ? { x: 10, y: 60, z: 10, heading: 0, speed: 0, climb: 0 } : null),
    });
    flock.update(DT, undefined, createWind());
    expect(flock.members.every((m) => m.hunting)).toBe(true);

    alive = false;
    flock.update(DT, undefined, createWind());
    expect(flock.members.some((m) => m.hunting)).toBe(false);
  });
});

describe('a bird close enough to touch', () => {
  it('says so for one in the air, and not for one that is out of it', () => {
    // Asked by whoever owns the consequences. A flock knows where its birds
    // are; what happens to something they touch is not its business.
    const flock = createFlock(1, still(0, 60, 0), {
      ...defaultFlockOptions,
      count: 2,
      emitInterval: 0,
      spawn: { kind: 'at', x: 0, y: 60, z: 0 },
    });

    expect(flock.touching({ x: 0, y: 60, z: 0 }, 1.25)).toBe(true);
    expect(flock.touching({ x: 0, y: 60, z: 2 }, 1.25)).toBe(false);
    // Through the air rather than on the ground: something directly below is
    // not touching, whatever the map says.
    expect(flock.touching({ x: 0, y: 20, z: 0 }, 1.25)).toBe(false);
  });

  it('touches nothing while it is waiting to be let out', () => {
    // The spawn point is a real place, and a bird that has not come out yet
    // is sitting on it as far as its coordinates are concerned. Flying
    // through that spot should not kill anybody.
    const flock = createFlock(1, still(0, 60, 0), {
      ...defaultFlockOptions,
      count: 2,
      emitInterval: 5,
      spawn: { kind: 'at', x: 0, y: 60, z: 0 },
    });
    flock.recall();
    expect(flock.members.every((m) => m.down > 0)).toBe(true);
    expect(flock.touching({ x: 0, y: 60, z: 0 }, 1.25)).toBe(false);
  });

  it('touches nothing once it is dead', () => {
    // Same rule, other end: a bird lying where it fell is scenery, and flying
    // over it is flying over scenery.
    const flock = createFlock(1, still(0, 60, 0), {
      ...defaultFlockOptions,
      count: 1,
      emitInterval: 0,
      spawn: { kind: 'at', x: 0, y: 60, z: 0 },
    });
    const at = flock.members[0]!.state.position;
    expect(flock.touching(at, 1.25)).toBe(true);

    flock.members[0]!.state.ending = {
      kind: 'crashed',
      cause: 'building',
      speed: 0,
      sink: 0,
      bank: 0,
      position: at,
    };
    expect(flock.touching(at, 1.25)).toBe(false);
  });
});

describe('putting the flock away', () => {
  it('takes them all out of the air, and lets them back one at a time', () => {
    // For a flock that has been off duty. Left alone while nobody updated it,
    // it is frozen where it was two levels ago -- so resuming would either
    // strand it out of sight or, once the stray rule noticed, hand back all
    // ten at once in a lump behind the player.
    const flock = createFlock(4, still(0, 60, 0), {
      ...defaultFlockOptions,
      count: 4,
      emitInterval: 1,
    });
    const wind = createWind();
    for (let t = 0; t < 10; t += DT) flock.update(DT, undefined, wind);
    expect(flock.members.every((m) => m.down <= 0), 'all out to begin with').toBe(true);

    flock.recall();
    expect(flock.members.every((m) => m.down > 0), 'and all away again').toBe(true);

    // Then back in order rather than in a lump: after a second and a half,
    // some of them are flying and some are still waiting.
    for (let t = 0; t < 1.5; t += DT) flock.update(DT, undefined, wind);
    const out = flock.members.filter((m) => m.down <= 0).length;
    expect(out).toBeGreaterThan(0);
    expect(out).toBeLessThan(flock.members.length);

    for (let t = 0; t < 10; t += DT) flock.update(DT, undefined, wind);
    expect(flock.members.every((m) => m.down <= 0), 'and all out again').toBe(true);
  });
});

describe('keeping the player company', () => {
  it('appears behind the leader, not on top of them', () => {
    const flock = createFlock(4, still(0, 60, 0, 0));
    for (const member of flock.members) {
      const back = Math.hypot(member.state.position.x, member.state.position.z);
      expect(back).toBeCloseTo(SPAWN_BEHIND, 6);
    }
  });

  it('behind means behind whichever way the leader is facing', () => {
    // Facing north, "behind" is south, which is +Z. Facing east it is west.
    const north = createFlock(2, still(0, 60, 0, 0)).members[0]!;
    expect(north.state.position.z).toBeCloseTo(SPAWN_BEHIND, 6);
    expect(north.state.position.x).toBeCloseTo(0, 6);

    const east = createFlock(2, still(0, 60, 0, Math.PI / 2)).members[0]!;
    expect(east.state.position.x).toBeCloseTo(-SPAWN_BEHIND, 6);
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
    const flock = createFlock(4, () => ({ x: along, y: 60, z: 0, heading: Math.PI / 2, speed: 5, climb: 0 }));
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

    // Looser than it was, deliberately. Letting them tuck to lose height is
    // what fixed the flock sitting 23 m above a gliding player, and a bird
    // that dives is a bird going faster, which turns wider: the mean went
    // from 28 m to 37 and the worst from 70 to 97. Altitude was the thing
    // being complained about, and it is worth this.
    const furthest = distances.reduce((a, b) => Math.max(a, b), 0);
    expect(furthest).toBeLessThan(110);
    const mean = distances.reduce((a, b) => a + b, 0) / distances.length;
    expect(mean).toBeLessThan(45);
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
      SPAWN_BEHIND,
      6,
    );
  });
});

describe('where they are aiming', () => {
  /**
   * Every distinct target a flock picks over a long flight beside a leader
   * hanging well clear of the ground, so nothing is clamped by the floor.
   */
  function sampleTargets(leaderY: number) {
    const flock = createFlock(8, still(0, leaderY, 0));
    const wind = createWind();
    const targets: { x: number; z: number; altitude: number }[] = [];
    const was = flock.members.map((m) => `${m.aiming.x},${m.aiming.z}`);

    for (let t = 0; t < 240; t += DT) {
      flock.update(DT, undefined, wind);
      flock.members.forEach((member, i) => {
        const key = `${member.aiming.x},${member.aiming.z}`;
        if (key !== was[i]) {
          targets.push({ ...member.aiming });
          was[i] = key;
        }
      });
    }
    return { targets };
  }

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

  it('picks its targets inside the radius, in three dimensions', () => {
    // A ball, not a disc with a separate slab of height: the distance that is
    // bounded is the whole distance, height included.
    const flock = createFlock(6, still(0, 60, 0));
    const wind = createWind();
    for (let t = 0; t < 120; t += DT) {
      flock.update(DT, undefined, wind);
      for (const member of flock.members) {
        const away = Math.hypot(member.aiming.x, member.aiming.z, member.aiming.altitude - 60);
        expect(away).toBeLessThanOrEqual(defaultFlockOptions.radius + 1e-9);
      }
    }
  });

  it('flies at the leader’s own height, give or take', () => {
    // Not at a height of its own: the flock shares the player's airspace, so
    // the offset is spread about zero rather than sitting off to one side.
    const { targets } = sampleTargets(200);
    const offsets = targets.map((t) => t.altitude - 200);

    const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
    expect(Math.abs(mean)).toBeLessThan(defaultFlockOptions.radius * 0.15);
    // Spread, not pinned to the leader exactly.
    expect(offsets.filter((d) => Math.abs(d) > 3).length / offsets.length).toBeGreaterThan(0.4);
    // Above as often as below.
    const above = offsets.filter((d) => d > 0).length / offsets.length;
    expect(above).toBeGreaterThan(0.35);
    expect(above).toBeLessThan(0.65);
  });

  it('fills the ball evenly instead of favouring the middle', () => {
    // Taking the radius straight from a random number puts half the targets
    // inside half the radius, which is an eighth of the volume. The cube root
    // is what makes the ball evenly filled.
    const { targets } = sampleTargets(200);
    const radii = targets.map((t) => Math.hypot(t.x, t.z, t.altitude - 200));

    expect(radii.length).toBeGreaterThan(200);
    const inner = radii.filter((r) => r < defaultFlockOptions.radius / 2).length / radii.length;
    expect(inner).toBeGreaterThan(0.06);
    expect(inner).toBeLessThan(0.2);
  });

  it('keeps up with a leader it can match, rather than being recycled', () => {
    // A target is chosen against where the leader was at the time, so it goes
    // stale; the attention span is what makes a bird look again. Without it a
    // bird chases the memory until the stray rule hauls it back, which is a
    // teleport rather than flying.
    let along = 0;
    const flock = createFlock(6, () => ({ x: along, y: 60, z: 0, heading: Math.PI / 2, speed: 5, climb: 0 }));
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
        if (was[i]! > 30 && Math.abs(away - SPAWN_BEHIND) < 0.01) recycles += 1;
        was[i] = away;
      });
    }

    expect(recycles).toBe(0);
  });
});

describe('flying with a leader who is going somewhere', () => {
  /** A leader crossing the map due east at a steady speed. */
  function crossing(speed: number) {
    let along = 0;
    const leader = () => ({ x: along, y: 60, z: 0, heading: Math.PI / 2, speed, climb: 0 });
    return { leader, advance: (dt: number) => { along += speed * dt; }, at: () => along };
  }

  it('aims ahead of the leader rather than at them', () => {
    // Pure pursuit -- aiming at where somebody is -- always arrives behind
    // them. The ball is centred on where the leader will be.
    const { leader, advance } = crossing(17);
    const flock = createFlock(6, leader);
    const wind = createWind();

    // Sampled as each target is chosen. Read later it would be measuring how
    // stale the target had got, since the leader keeps going past it.
    const ahead: number[] = [];
    const was = flock.members.map((m) => `${m.aiming.x},${m.aiming.z}`);
    for (let t = 0; t < 30; t += DT) {
      advance(DT);
      flock.update(DT, undefined, wind);
      flock.members.forEach((member, i) => {
        const key = `${member.aiming.x},${member.aiming.z}`;
        if (key !== was[i]) {
          ahead.push(member.aiming.x - leader().x);
          was[i] = key;
        }
      });
    }

    expect(ahead.length).toBeGreaterThan(20);
    // Every one of them in front, and by more than the ball is wide: aimed at
    // the leader, half would be behind.
    expect(ahead.every((d) => d > defaultFlockOptions.radius)).toBe(true);
  });

  it('does not aim ahead of a leader who is not going anywhere', () => {
    // At rest the lead is nothing and the ball sits on the leader exactly,
    // which is the case the twenty-metre-sphere rule most obviously means.
    const flock = createFlock(6, still(0, 60, 0));
    const wind = createWind();
    for (let t = 0; t < 20; t += DT) {
      flock.update(DT, undefined, wind);
      for (const member of flock.members) {
        expect(Math.hypot(member.aiming.x, member.aiming.z)).toBeLessThanOrEqual(
          defaultFlockOptions.radius + 1e-9,
        );
      }
    }
  });

  it('flies at the leader’s pace, with a little in hand', () => {
    // Two birds at the same speed released ten metres apart stay ten metres
    // apart for ever, so matching exactly is not enough to ever come past.
    for (const pace of [12, 20]) {
      const { leader, advance } = crossing(pace);
      const flock = createFlock(6, leader);
      const wind = createWind();
      for (let t = 0; t < 40; t += DT) {
        advance(DT);
        flock.update(DT, undefined, wind);
      }
      const speeds = flock.members
        .filter((m) => m.down <= 0)
        .map((m) => Math.hypot(m.state.velocity.x, m.state.velocity.y, m.state.velocity.z));
      const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
      expect(mean, `${pace} m/s`).toBeGreaterThan(pace);
    }
  });

  it('gets in front of the camera at cruise, which is the whole point', () => {
    // The complaint this answers was that you could not see them. Measured
    // the way the player sees it: how often anything is inside the chase
    // camera's cone. Aimed at the leader instead of ahead of them, and
    // matching their speed instead of bettering it, this is zero.
    const HALF_FOV = (68 / 2) * (Math.PI / 180);
    const { leader, advance } = crossing(17);
    const flock = createFlock(6, leader);
    const wind = createWind();

    let seen = 0;
    let frames = 0;
    for (let t = 0; t < 120; t += DT) {
      advance(DT);
      flock.update(DT, undefined, wind);
      // Let the flock fill up before judging it.
      if (t < 15 || Math.abs(t % 0.5) > DT) continue;
      frames += 1;
      // The chase camera sits just behind the bird, looking along its heading.
      const camera = { x: leader().x - 1.7, y: 60.5, z: 0 };
      const anyInShot = flock.members.some((member) => {
        if (member.down > 0) return false;
        const dx = member.state.position.x - camera.x;
        const dy = member.state.position.y - camera.y;
        const dz = member.state.position.z - camera.z;
        const range = Math.hypot(dx, dy, dz);
        return range < 300 && Math.acos(dx / Math.max(range, 1e-9)) < HALF_FOV;
      });
      if (anyInShot) seen += 1;
    }

    expect(seen / frames).toBeGreaterThan(0.6);
  });
});

describe('flying at the leader’s height', () => {
  /** A leader losing height steadily, which is what gliding is. */
  function sinking(rate: number, from = 120) {
    const at = { x: 0, y: from, z: 0, heading: Math.PI / 2, speed: 17, climb: -rate };
    return {
      leader: () => ({ ...at }),
      advance: (dt: number) => {
        at.x += at.speed * dt;
        at.y -= rate * dt;
      },
      y: () => at.y,
    };
  }

  it('comes down with a gliding leader instead of hanging above them', () => {
    // The bug this guards: escorting a pigeon gliding down from 120 m, the
    // flock sat a mean of 23 m over it and was never once below it. Two
    // things were wrong. The autopilot could climb and could not descend --
    // above its waypoint it merely stopped beating, and the vertical damping
    // then fought the sink. And the target height did not lead the leader's
    // own sink the way the target position leads their track.
    // Swept across sink rates, because the two faults show at different ones:
    // a flock that cannot descend is already 8 m high at a gentle glide, and
    // a target height that does not follow the leader down is 18 m high in a
    // proper descent while a bird that can dive hides it at 1 m/s.
    for (const rate of [1, 3, 5]) {
      const { leader, advance, y } = sinking(rate, 300);
      const flock = createFlock(8, leader);
      const wind = createWind();
      const offsets: number[] = [];

      for (let t = 0; t < 50; t += DT) {
        advance(DT);
        flock.update(DT, undefined, wind);
        if (t < 20 || Math.abs(t % 0.5) > DT) continue;
        for (const member of flock.members) {
          if (member.down <= 0) offsets.push(member.state.position.y - y());
        }
      }

      const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
      expect(Math.abs(mean), `${rate} m/s sink`).toBeLessThan(5);
      // And a fair share of them below the leader, which is the part that was
      // never true: a flock that can only climb is a ceiling, not company.
      const below = offsets.filter((d) => d < 0).length / offsets.length;
      expect(below, `${rate} m/s sink`).toBeGreaterThan(0.25);
    }
  });

  it('holds height either side of a leader who is not moving', () => {
    const flock = createFlock(8, still(0, 100, 0));
    const wind = createWind();
    const offsets: number[] = [];
    for (let t = 0; t < 90; t += DT) {
      flock.update(DT, undefined, wind);
      if (t < 20 || Math.abs(t % 0.5) > DT) continue;
      for (const member of flock.members) {
        if (member.down <= 0) offsets.push(member.state.position.y - 100);
      }
    }
    const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
    expect(Math.abs(mean)).toBeLessThan(5);
    expect(offsets.filter((d) => d < 0).length / offsets.length).toBeGreaterThan(0.3);
  });
});

describe('letting them out', () => {
  const open = createColliderField([]);

  it('lets one out every second rather than all at once', () => {
    // Stated in seconds and birds rather than against the constant that
    // produces them: this is the rate the game is meant to have, and a test
    // that divides by `emitInterval` agrees with whatever it is set to.
    const flock = createFlock(4, still(0, 6, 0));
    const wind = createWind();
    const inTheAir = () => flock.members.filter((m) => m.down <= 0).length;

    expect(inTheAir()).toBe(1);
    for (const [seconds, out] of [
      [3, 4],
      [6, 7],
      [9, 10],
    ] as const) {
      for (let t = 0; t < 3; t += DT) flock.update(DT, open, wind);
      expect(inTheAir(), `${seconds}s`).toBe(out);
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
      SPAWN_BEHIND,
      6,
    );
  });
});
