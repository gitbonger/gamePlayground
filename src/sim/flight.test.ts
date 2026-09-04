import { describe, expect, it } from 'vitest';
import {
  bankAngle,
  createBird,
  defaultParams,
  landingReadiness,
  liftCoefficient,
  neutralControls,
  step,
  type Controls,
  type FlightParams,
} from './flight';
import { length, quatFromAxisAngle, rotate, vec } from './math3';
import { aabb, createColliderField } from './collision';

const DT = 1 / 120;

/** Run the model for `seconds` and hand back the final telemetry. */
function fly(
  seconds: number,
  controls: Partial<Controls> = {},
  params: Partial<FlightParams> = {},
  bird = createBird(),
  collider?: Parameters<typeof step>[4],
) {
  const p = { ...defaultParams, ...params };
  const c = { ...neutralControls(), ...controls };
  let telemetry = step(bird, c, p, DT, collider);
  for (let t = DT; t < seconds; t += DT) telemetry = step(bird, c, p, DT, collider);
  return { bird, telemetry };
}

describe('lift coefficient', () => {
  it('is linear below the stall', () => {
    const cl = liftCoefficient(0.1, defaultParams);
    expect(cl).toBeCloseTo(defaultParams.liftSlope * 0.1, 6);
  });

  it('peaks at the stall angle and falls off past it', () => {
    const atStall = liftCoefficient(defaultParams.stallAngle, defaultParams);
    const pastStall = liftCoefficient(defaultParams.stallAngle + 0.3, defaultParams);
    expect(pastStall).toBeLessThan(atStall);
  });

  it('is antisymmetric about zero', () => {
    expect(liftCoefficient(-0.4, defaultParams)).toBeCloseTo(-liftCoefficient(0.4, defaultParams), 6);
  });

  it('stays finite through the whole range', () => {
    for (let a = -Math.PI; a <= Math.PI; a += 0.05) {
      expect(Number.isFinite(liftCoefficient(a, defaultParams))).toBe(true);
    }
  });
});

describe('gliding', () => {
  it('sinks slowly rather than dropping like a stone', () => {
    const { telemetry } = fly(2);
    const freefall = -defaultParams.gravity * 2;
    expect(telemetry.climbRate).toBeGreaterThan(freefall * 0.25);
    expect(telemetry.climbRate).toBeLessThan(0);
  });

  it('reaches a glide ratio in the range a real pigeon manages', () => {
    const bird = createBird(vec(0, 400, 0));
    const start = { ...bird.position };
    const { bird: end } = fly(20, {}, {}, bird);

    const dropped = start.y - end.position.y;
    const travelled = Math.hypot(end.position.x - start.x, end.position.z - start.z);
    const glideRatio = travelled / dropped;

    expect(glideRatio).toBeGreaterThan(3);
    expect(glideRatio).toBeLessThan(14);
  });

  it('settles toward a steady airspeed instead of accelerating forever', () => {
    const { telemetry: early } = fly(3, {}, {}, createBird(vec(0, 400, 0)));
    const { telemetry: late } = fly(25, {}, {}, createBird(vec(0, 400, 0)));
    expect(Math.abs(late.airspeed - early.airspeed)).toBeLessThan(8);
  });
});

describe('flapping', () => {
  it('climbs when a rested bird flaps', () => {
    const glide = fly(3, {}, {}, createBird(vec(0, 200, 0)));
    const flapped = fly(3, { flap: true }, {}, createBird(vec(0, 200, 0)));
    expect(flapped.bird.position.y).toBeGreaterThan(glide.bird.position.y);
  });

  it('drains stamina while flapping and recovers while gliding', () => {
    const { bird } = fly(3, { flap: true }, {}, createBird(vec(0, 200, 0)));
    expect(bird.stamina).toBeLessThan(1);

    const before = bird.stamina;
    fly(3, {}, {}, bird);
    expect(bird.stamina).toBeGreaterThan(before);
  });

  it('loses thrust once stamina is gone', () => {
    const tired = createBird(vec(0, 200, 0));
    tired.stamina = 0;
    const rested = createBird(vec(0, 200, 0));

    const a = fly(2, { flap: true }, {}, tired);
    const b = fly(2, { flap: true }, {}, rested);
    expect(a.bird.position.y).toBeLessThan(b.bird.position.y);
  });
});

describe('diving', () => {
  it('builds more speed tucked than spread', () => {
    const nose = quatFromAxisAngle(vec(1, 0, 0), -0.6);

    const spread = createBird(vec(0, 300, 0));
    spread.orientation = nose;
    const tucked = createBird(vec(0, 300, 0));
    tucked.orientation = nose;

    const a = fly(4, {}, {}, spread);
    const b = fly(4, { tuck: true }, {}, tucked);
    expect(b.telemetry.airspeed).toBeGreaterThan(a.telemetry.airspeed);
  });
});

describe('turning', () => {
  it('changes heading when banked, with no yaw input at all', () => {
    const bird = createBird(vec(0, 200, 0));
    // A short input to establish the bank, then hands off the controls.
    fly(0.4, { roll: 1 }, {}, bird);
    expect(bankAngle(bird)).toBeGreaterThan(0.3);

    fly(3, {}, {}, bird);

    // Banked right, so the nose should have swung right of the start heading.
    const forward = rotate(bird.orientation, vec(0, 0, -1));
    expect(forward.x).toBeGreaterThan(0.1);
  });

  it('rolls the opposite way for the opposite input', () => {
    // Short enough that neither bird rolls past vertical and wraps around.
    const right = createBird(vec(0, 200, 0));
    fly(0.3, { roll: 1 }, {}, right);
    const left = createBird(vec(0, 200, 0));
    fly(0.3, { roll: -1 }, {}, left);

    expect(bankAngle(right)).toBeGreaterThan(0);
    expect(bankAngle(left)).toBeLessThan(0);
  });
});

describe('stability', () => {
  it('pulls the nose back toward the trim angle', () => {
    const bird = createBird(vec(0, 300, 0));
    bird.orientation = quatFromAxisAngle(vec(1, 0, 0), 0.5);
    const { telemetry } = fly(5, {}, {}, bird);
    expect(telemetry.angleOfAttack).toBeCloseTo(defaultParams.trimAngle, 1);
  });

  it('never produces NaN, even from an absurd starting state', () => {
    const bird = createBird(vec(0, 500, 0));
    bird.velocity = vec(60, -40, 25);
    bird.angularVelocity = vec(9, -7, 12);
    const { bird: end, telemetry } = fly(10, { pitch: 1, roll: -1, flap: true }, {}, bird);

    expect(Number.isFinite(length(end.position))).toBe(true);
    expect(Number.isFinite(length(end.velocity))).toBe(true);
    expect(Number.isFinite(telemetry.airspeed)).toBe(true);
  });
});

describe('ground', () => {
  it('stops at the ground plane instead of sinking through it', () => {
    const bird = createBird(vec(0, 3, 0), 2);
    const { bird: end } = fly(6, {}, {}, bird);
    expect(end.position.y).toBe(defaultParams.groundHeight);
    expect(end.ending).not.toBeNull();
  });
});

describe('determinism', () => {
  it('produces identical results for identical inputs', () => {
    const a = fly(5, { pitch: 0.3, roll: 0.2, flap: true });
    const b = fly(5, { pitch: 0.3, roll: 0.2, flap: true });
    expect(a.bird.position).toEqual(b.bird.position);
    expect(a.bird.velocity).toEqual(b.bird.velocity);
  });
});

describe('crashing', () => {
  /** A wall across the bird's path, 100 m ahead of the spawn. */
  const wall = () =>
    createColliderField([aabb(-200, 0, -105, 200, 300, -95)]);

  it('ends the flight on hitting a building at speed', () => {
    const bird = createBird(vec(0, 120, 0), 16);
    const { bird: end } = fly(12, {}, {}, bird, wall());

    expect(end.ending).not.toBeNull();
    expect(end.ending!.kind).toBe('crashed');
    expect(end.ending!.cause).toBe('building');
    // Stopped at the wall's near face, not inside or beyond it.
    expect(end.ending!.position.z).toBeCloseTo(-95, 0);
  });

  it('leaves the bird inert once the flight has ended', () => {
    const bird = createBird(vec(0, 120, 0), 16);
    fly(12, {}, {}, bird, wall());
    const crashed = { ...bird.position };

    fly(5, { flap: true, pitch: 1 }, {}, bird, wall());
    expect(bird.position).toEqual(crashed);
    expect(length(bird.velocity)).toBe(0);
  });

  it('flies clean past the same wall when there is no collider', () => {
    const bird = createBird(vec(0, 120, 0), 16);
    const { bird: end } = fly(12, {}, {}, bird);
    expect(end.ending).toBeNull();
    expect(end.position.z).toBeLessThan(-100);
  });

  it('survives a gentle brush below the crash threshold', () => {
    const bird = createBird(vec(0, 120, 0), 2);
    const { bird: end } = fly(3, {}, { gravity: 0 }, bird, wall());
    expect(end.ending).toBeNull();
  });

  it('does not tunnel through a wall during a tucked dive', () => {
    // Started below the wall's 300 m top, so it cannot simply overfly it.
    const bird = createBird(vec(0, 150, 0), 50);
    const { bird: end } = fly(20, { tuck: true }, {}, bird, wall());
    expect(end.ending!.cause).toBe('building');
    expect(end.position.z).toBeGreaterThan(-105);
  });

  it('ends the flight on slamming into the ground', () => {
    const bird = createBird(vec(0, 60, 0), 5);
    bird.orientation = quatFromAxisAngle(vec(1, 0, 0), -1.2);
    const { bird: end } = fly(20, { tuck: true }, {}, bird);

    expect(end.ending!.kind).toBe('crashed');
    expect(end.ending!.cause).toBe('hard-impact');
  });
});

describe('landing', () => {
  /**
   * Fly an approach: glide until `flareAt` metres, then hold `pitch`.
   * This is the manoeuvre a player performs, run open-loop.
   */
  function approach(flareAt: number, pitch: number, extra: Partial<Controls> = {}) {
    const bird = createBird(vec(0, 60, 0), 15);
    const p = defaultParams;
    const controls = { ...neutralControls(), ...extra };
    for (let t = 0; t < 60; t += DT) {
      controls.pitch = bird.position.y < flareAt ? pitch : (extra.pitch ?? 0);
      step(bird, controls, p, DT);
      if (bird.ending) break;
    }
    return bird;
  }

  it('lands cleanly when the flare is timed well', () => {
    const bird = approach(4, 0.7);
    expect(bird.ending).not.toBeNull();
    expect(bird.ending!.kind).toBe('landed');
    expect(bird.ending!.cause).toBeNull();
  });

  it('accepts the whole spread of flare strengths at the sweet spot', () => {
    for (const pitch of [0.3, 0.5, 0.7, 0.9, 1]) {
      expect(approach(4, pitch).ending!.kind, `pitch ${pitch}`).toBe('landed');
    }
  });

  it('rejects a straight-in glide as too fast', () => {
    const bird = approach(0, 0);
    expect(bird.ending!.kind).toBe('crashed');
    expect(bird.ending!.cause).toBe('too-fast');
  });

  it('rejects flaring far too high, which balloons and then drops', () => {
    const bird = approach(12, 0.9);
    expect(bird.ending!.kind).toBe('crashed');
    expect(bird.ending!.cause).toBe('hard-impact');
  });

  it('rejects touching down with a wing down', () => {
    const bird = createBird(vec(0, 2, 0), 4);
    bird.orientation = quatFromAxisAngle(vec(0, 0, 1), 0.9);
    bird.velocity = vec(0, -0.5, -4);
    const p = { ...defaultParams, gravity: 2 };
    const controls = neutralControls();
    for (let t = 0; t < 20; t += DT) {
      step(bird, controls, p, DT);
      if (bird.ending) break;
    }
    expect(bird.ending!.kind).toBe('crashed');
    expect(bird.ending!.cause).toBe('not-level');
  });

  it('records the touchdown numbers it judged', () => {
    const bird = approach(4, 0.7);
    const ending = bird.ending!;
    expect(ending.sink).toBeLessThanOrEqual(defaultParams.landingSink);
    expect(ending.speed).toBeLessThanOrEqual(defaultParams.landingSpeed);
    expect(ending.bank).toBeLessThanOrEqual(defaultParams.landingBank);
    expect(ending.position.y).toBe(defaultParams.groundHeight);
  });

  it('leaves the bird stopped where it landed', () => {
    const bird = approach(4, 0.7);
    expect(length(bird.velocity)).toBe(0);
    expect(bird.position.y).toBe(defaultParams.groundHeight);
  });
});

describe('landing readiness', () => {
  it('agrees with the verdict the touchdown actually gives', () => {
    // A bird held just above the ground in a good attitude reads as ready.
    const good = createBird(vec(0, 5, 0), 6);
    good.velocity = vec(0, -1, -6);
    expect(landingReadiness(good, defaultParams).ready).toBe(true);

    const fast = createBird(vec(0, 5, 0), 20);
    fast.velocity = vec(0, -1, -20);
    const readiness = landingReadiness(fast, defaultParams);
    expect(readiness.ready).toBe(false);
    expect(readiness.speedOk).toBe(false);
    expect(readiness.sinkOk).toBe(true);
  });

  it('flags a fast descent', () => {
    const dropping = createBird(vec(0, 5, 0), 3);
    dropping.velocity = vec(0, -9, -3);
    const readiness = landingReadiness(dropping, defaultParams);
    expect(readiness.sinkOk).toBe(false);
    expect(readiness.ready).toBe(false);
  });

  it('flags a banked attitude', () => {
    const banked = createBird(vec(0, 5, 0), 5);
    banked.velocity = vec(0, -1, -5);
    banked.orientation = quatFromAxisAngle(vec(0, 0, 1), 1);
    const readiness = landingReadiness(banked, defaultParams);
    expect(readiness.bankOk).toBe(false);
    expect(readiness.ready).toBe(false);
  });
});

describe('braking', () => {
  /** Hold a configuration from cruise and report where it settles. */
  function settle(controls: Partial<Controls>, seconds = 6) {
    const bird = createBird(vec(0, 5000, 0), 15.3);
    const { telemetry } = fly(seconds, controls, {}, bird);
    return { speed: telemetry.airspeed, sink: -telemetry.climbRate, telemetry, bird };
  }

  it('sheds airspeed a glide cannot', () => {
    expect(settle({ brake: true }).speed).toBeLessThan(settle({}).speed - 2);
  });

  it('settles slower still when the beat is reversed', () => {
    expect(settle({ brake: true, flap: true }).speed).toBeLessThan(settle({ brake: true }).speed);
  });

  it('sinks more gently with the reversed beat than without it', () => {
    // The braking stroke is nearly vertical: most of it holds the bird up.
    expect(settle({ brake: true, flap: true }).sink).toBeLessThan(settle({ brake: true }).sink);
  });

  it('reaches a landable speed and sink when braking into a flare', () => {
    const { speed, sink } = settle({ brake: true, pitch: 0.4 });
    expect(speed).toBeLessThanOrEqual(defaultParams.landingSpeed);
    expect(sink).toBeLessThanOrEqual(defaultParams.landingSink);
  });

  it('holds a far higher angle of attack before stalling', () => {
    // Fly at a fixed angle of attack chosen to sit between the clean stall
    // angle and the braked one, so only the alula bonus decides the verdict.
    const alpha = defaultParams.stallAngle + defaultParams.brakeStallBonus / 2;
    const speed = 14;
    const at = (brake: boolean) => {
      const bird = createBird(vec(0, 5000, 0), speed);
      bird.velocity = vec(0, -Math.sin(alpha) * speed, -Math.cos(alpha) * speed);
      const controls = { ...neutralControls(), brake };
      const telemetry = step(bird, controls, defaultParams, DT);
      return telemetry;
    };

    expect(at(false).angleOfAttack).toBeCloseTo(alpha, 4);
    expect(at(false).stalled).toBe(true);
    expect(at(true).stalled).toBe(false);
    // And the extra margin buys real lift, not just a relabelled verdict.
    expect(at(true).liftCoefficient).toBeGreaterThan(at(false).liftCoefficient);
  });

  it('overrides tucking, since a player holding both wants to slow down', () => {
    const both = settle({ brake: true, tuck: true });
    const braked = settle({ brake: true });
    expect(both.speed).toBeCloseTo(braked.speed, 5);
  });

  it('reverses the direction the wingbeat pushes', () => {
    // Same bird, same beat, opposite configuration: one gains ground speed
    // over a short burst, the other loses it.
    const forward = createBird(vec(0, 5000, 0), 12);
    fly(1.5, { flap: true }, {}, forward);
    const backward = createBird(vec(0, 5000, 0), 12);
    fly(1.5, { brake: true, flap: true }, {}, backward);

    expect(-forward.velocity.z).toBeGreaterThan(-backward.velocity.z);
  });

  it('brings the same approach down slower, and lands it', () => {
    function approach(brake: boolean) {
      const bird = createBird(vec(0, 80, 0), 15.3);
      const controls = { ...neutralControls() };
      for (let t = 0; t < 60; t += DT) {
        const alt = bird.position.y;
        controls.brake = brake && alt < 20;
        controls.pitch = alt < 4 ? 0.6 : 0;
        step(bird, controls, defaultParams, DT);
        if (bird.ending) break;
      }
      return bird.ending!;
    }

    expect(approach(true).speed).toBeLessThan(approach(false).speed);
    expect(approach(true).kind).toBe('landed');
  });

  it('rescues an approach flared too late to slow down on its own', () => {
    function approach(brake: boolean) {
      const bird = createBird(vec(0, 80, 0), 15.3);
      const controls = { ...neutralControls() };
      for (let t = 0; t < 60; t += DT) {
        const alt = bird.position.y;
        controls.brake = brake && alt < 25;
        controls.pitch = alt < 2 ? 0.6 : 0;
        step(bird, controls, defaultParams, DT);
        if (bird.ending) break;
      }
      return bird.ending!;
    }

    expect(approach(false).kind).toBe('crashed');
    expect(approach(true).kind).toBe('landed');
  });

  it('leaves unbraked flight exactly as it was', () => {
    const withParams = createBird(vec(0, 400, 0), 15);
    fly(10, {}, {}, withParams);
    const zeroed = createBird(vec(0, 400, 0), 15);
    fly(10, {}, { brakeDragFactor: 99, brakeAreaFactor: 99 }, zeroed);

    expect(withParams.position).toEqual(zeroed.position);
  });
});
