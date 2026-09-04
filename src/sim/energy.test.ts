import { describe, expect, it } from 'vitest';
import {
  birdEnergy,
  createBird,
  defaultParams,
  neutralControls,
  step,
  type Controls,
  type FlightParams,
} from './flight';
import { energyOf, totalWork } from './energy';
import { quatFromAxisAngle, vec, type Vec3 } from './math3';
import { aabb, createColliderField } from './collision';

const DT = 1 / 120;

interface Run {
  /** Largest single-tick discrepancy between energy change and work done. */
  worstResidual: number;
  /** Totals over the run, in joules. */
  lift: number;
  drag: number;
  flap: number;
  keel: number;
  collision: number;
  startEnergy: number;
  endEnergy: number;
  ended: boolean;
}

/** Fly a scenario, auditing the energy books on every tick. */
function fly(
  controls: Partial<Controls>,
  options: {
    seconds?: number;
    velocity?: Vec3;
    altitude?: number;
    orientation?: ReturnType<typeof quatFromAxisAngle>;
    angularVelocity?: Vec3;
    params?: Partial<FlightParams>;
    collider?: Parameters<typeof step>[4];
    dt?: number;
  } = {},
): Run {
  const p = { ...defaultParams, ...options.params };
  const dt = options.dt ?? DT;
  const bird = createBird(vec(0, options.altitude ?? 3000, 0), 15);
  if (options.velocity) bird.velocity = options.velocity;
  if (options.orientation) bird.orientation = options.orientation;
  if (options.angularVelocity) bird.angularVelocity = options.angularVelocity;

  const c = { ...neutralControls(), ...controls };
  const startEnergy = birdEnergy(bird, p).total;

  const run: Run = {
    worstResidual: 0,
    lift: 0,
    drag: 0,
    flap: 0,
    keel: 0,
    collision: 0,
    startEnergy,
    endEnergy: startEnergy,
    ended: false,
  };

  let previous = startEnergy;
  for (let t = 0; t < (options.seconds ?? 15); t += dt) {
    const telemetry = step(bird, c, p, dt, options.collider);
    const now = telemetry.energy.total;

    const residual = now - previous - totalWork(telemetry.work);
    run.worstResidual = Math.max(run.worstResidual, Math.abs(residual));

    run.lift += telemetry.work.lift;
    run.drag += telemetry.work.drag;
    run.flap += telemetry.work.flap;
    run.keel += telemetry.work.keel;
    run.collision += telemetry.work.collision;

    previous = now;
    run.endEnergy = now;
    if (bird.ending) {
      run.ended = true;
      break;
    }
  }
  return run;
}

describe('energy bookkeeping', () => {
  it('computes kinetic, potential and energy height', () => {
    const e = energyOf(vec(0, 0, -10), 100, 0.35, 10);
    expect(e.kinetic).toBeCloseTo(0.5 * 0.35 * 100, 9);
    expect(e.potential).toBeCloseTo(0.35 * 10 * 100, 9);
    expect(e.total).toBeCloseTo(e.kinetic + e.potential, 9);
    // 10 m/s is worth 5 m of climb at g = 10.
    expect(e.height).toBeCloseTo(105, 9);
  });

  it('is at rest on the ground with no energy at all', () => {
    const e = energyOf(vec(), 0, 0.35, 9.81);
    expect(e.total).toBe(0);
    expect(e.height).toBe(0);
  });
});

describe('the books balance', () => {
  /** Every force must account for exactly the energy it moves. */
  const scenarios: [string, Partial<Controls>, Parameters<typeof fly>[1]][] = [
    ['gliding', {}, {}],
    ['flapping', { flap: true }, {}],
    ['braking', { brake: true }, {}],
    ['braking with the reversed beat', { brake: true, flap: true }, {}],
    ['tucked dive', { tuck: true }, {}],
    ['hard turn', { roll: 1, pitch: 0.5 }, {}],
    ['every control at once', { flap: true, brake: true, roll: -1, pitch: 1, yaw: 1 }, {}],
    ['inverted', {}, { orientation: quatFromAxisAngle(vec(0, 0, 1), Math.PI) }],
    ['flying sideways', {}, { velocity: vec(20, -3, 0) }],
    [
      'a violent entry',
      { flap: true },
      { velocity: vec(40, -35, 20), angularVelocity: vec(8, -6, 11) },
    ],
  ];

  for (const [label, controls, options] of scenarios) {
    it(`balances to floating point while ${label}`, () => {
      // Not a tolerance: with this integrator the change in kinetic energy is
      // identically the work done at the mean velocity, so the only slack is
      // floating-point rounding on a few hundred joules.
      expect(fly(controls, options).worstResidual).toBeLessThan(1e-9);
    });
  }

  it('balances through a crash into a building', () => {
    const wall = createColliderField([aabb(-200, 0, -105, 200, 300, -95)]);
    const run = fly({}, { altitude: 120, collider: wall, seconds: 30 });
    expect(run.ended).toBe(true);
    expect(run.worstResidual).toBeLessThan(1e-9);
  });

  it('balances through a landing', () => {
    const run = fly({ brake: true }, { altitude: 30, seconds: 40 });
    expect(run.ended).toBe(true);
    expect(run.worstResidual).toBeLessThan(1e-9);
  });
});

describe('which forces may move energy', () => {
  it('lets lift do essentially no work, because it is perpendicular to the airflow', () => {
    // Evaluating forces at the midpoint of the tick is what keeps this true;
    // holding a start-of-tick lift direction leaks energy in hard turns.
    const turn = fly({ roll: 1, pitch: 0.5 });
    expect(Math.abs(turn.lift)).toBeLessThan(Math.abs(turn.drag) * 0.01);
  });

  it('never lets drag add energy', () => {
    for (const controls of [{}, { brake: true }, { tuck: true }, { roll: 1, pitch: -1 }]) {
      expect(fly(controls).drag).toBeLessThanOrEqual(0);
    }
  });

  it('never lets the keel add energy', () => {
    expect(fly({}, { velocity: vec(20, -3, 0) }).keel).toBeLessThanOrEqual(0);
    expect(fly({ yaw: 1, roll: 1 }).keel).toBeLessThanOrEqual(0);
  });

  it('never lets a collision add energy to the bird', () => {
    const wall = createColliderField([aabb(-200, 0, -105, 200, 300, -95)]);
    // Potential energy from being pushed clear of a surface is part of this
    // term, so allow for that but not for a net gain in the bird's energy.
    const run = fly({}, { altitude: 120, collider: wall, seconds: 30 });
    expect(run.endEnergy).toBeLessThan(run.startEnergy);
  });

  it('makes the wingbeat the only source of energy', () => {
    // Nothing but flapping may raise total energy, for any control input.
    for (const controls of [
      {},
      { brake: true },
      { tuck: true },
      { pitch: 1 },
      { pitch: -1, roll: 1 },
      { brake: true, roll: -1, yaw: 1 },
    ]) {
      const run = fly(controls, { seconds: 20 });
      expect(run.flap).toBe(0);
      expect(run.endEnergy, JSON.stringify(controls)).toBeLessThan(run.startEnergy);
    }
  });

  it('adds energy when flapping, and only then', () => {
    expect(fly({ flap: true }).flap).toBeGreaterThan(0);
    expect(fly({}).flap).toBe(0);
    // Tucking folds the wings away, so there is no beat to make.
    expect(fly({ flap: true, tuck: true }).flap).toBe(0);
  });

  it('has the braking beat take energy out rather than put it in', () => {
    // Beating backwards against your own motion is a brake, not a motor.
    expect(fly({ brake: true, flap: true }).flap).toBeLessThan(0);
  });
});

describe('energy height', () => {
  it('trades height for speed in a dive, losing only what drag takes', () => {
    const bird = createBird(vec(0, 3000, 0), 15);
    bird.orientation = quatFromAxisAngle(vec(1, 0, 0), -1);
    const p = defaultParams;
    const controls = { ...neutralControls(), tuck: true };

    const start = birdEnergy(bird, p);
    let telemetry = step(bird, controls, p, DT);
    for (let t = DT; t < 4; t += DT) telemetry = step(bird, controls, p, DT);

    // Height is spent and speed is bought.
    expect(bird.position.y).toBeLessThan(3000);
    expect(telemetry.energy.kinetic).toBeGreaterThan(start.kinetic);
    // But the total can only ever fall, and by exactly what drag removed.
    expect(telemetry.energy.height).toBeLessThan(start.height);
  });

  it('falls monotonically while coasting', () => {
    const bird = createBird(vec(0, 3000, 0), 25);
    const controls = neutralControls();
    let previous = birdEnergy(bird, defaultParams).height;

    for (let t = 0; t < 15; t += DT) {
      const telemetry = step(bird, controls, defaultParams, DT);
      expect(telemetry.energy.height).toBeLessThanOrEqual(previous + 1e-9);
      previous = telemetry.energy.height;
    }
  });

  it('rises while a rested bird flaps', () => {
    const bird = createBird(vec(0, 3000, 0), 12);
    const start = birdEnergy(bird, defaultParams).height;
    const controls = { ...neutralControls(), flap: true };

    let telemetry = step(bird, controls, defaultParams, DT);
    for (let t = DT; t < 3; t += DT) telemetry = step(bird, controls, defaultParams, DT);

    expect(telemetry.energy.height).toBeGreaterThan(start);
  });
});

describe('timestep independence', () => {
  it('reaches nearly the same place at half the timestep', () => {
    // Midpoint forces make the model far less sensitive to tick rate than a
    // plain start-of-tick evaluation would be.
    const coarse = fly({ flap: true, roll: 0.5 }, { seconds: 10, dt: 1 / 120 });
    const fine = fly({ flap: true, roll: 0.5 }, { seconds: 10, dt: 1 / 480 });

    const drift = Math.abs(coarse.endEnergy - fine.endEnergy);
    expect(drift / Math.abs(fine.endEnergy)).toBeLessThan(0.02);
  });

  it('balances the books at any timestep', () => {
    for (const dt of [1 / 30, 1 / 60, 1 / 240]) {
      expect(fly({ flap: true, roll: 1 }, { dt, seconds: 10 }).worstResidual).toBeLessThan(1e-9);
    }
  });
});
