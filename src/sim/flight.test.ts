import { describe, expect, it } from 'vitest';
import {
  bankAngle,
  createBird,
  defaultParams,
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
  it('lands on the ground plane instead of sinking through it', () => {
    const bird = createBird(vec(0, 3, 0), 2);
    const { bird: end } = fly(6, {}, {}, bird);
    expect(end.position.y).toBeGreaterThanOrEqual(defaultParams.groundHeight);
    expect(end.grounded).toBe(true);
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

    expect(end.crash).not.toBeNull();
    expect(end.crash!.kind).toBe('building');
    expect(end.crash!.speed).toBeGreaterThan(defaultParams.crashSpeed);
    // Stopped at the wall's near face, not inside or beyond it.
    expect(end.crash!.position.z).toBeCloseTo(-95, 0);
  });

  it('leaves the bird inert once crashed', () => {
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
    expect(end.crash).toBeNull();
    expect(end.position.z).toBeLessThan(-100);
  });

  it('survives a gentle brush below the crash threshold', () => {
    const bird = createBird(vec(0, 120, 0), 2);
    const { bird: end } = fly(3, {}, { gravity: 0 }, bird, wall());
    expect(end.crash).toBeNull();
  });

  it('does not tunnel through a wall during a tucked dive', () => {
    // Started below the wall's 300 m top, so it cannot simply overfly it.
    const bird = createBird(vec(0, 150, 0), 50);
    const { bird: end } = fly(20, { tuck: true }, {}, bird, wall());
    expect(end.crash).not.toBeNull();
    expect(end.position.z).toBeGreaterThan(-105);
  });

  it('ends the flight on slamming into the ground', () => {
    const bird = createBird(vec(0, 60, 0), 5);
    bird.orientation = quatFromAxisAngle(vec(1, 0, 0), -1.2);
    const { bird: end } = fly(20, { tuck: true }, {}, bird);

    expect(end.crash).not.toBeNull();
    expect(end.crash!.kind).toBe('ground');
  });

  it('lets a slow descent land instead of crashing', () => {
    const bird = createBird(vec(0, 3, 0), 2);
    const { bird: end } = fly(6, {}, {}, bird);
    expect(end.crash).toBeNull();
    expect(end.grounded).toBe(true);
  });
});
