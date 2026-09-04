import { describe, expect, it } from 'vitest';
import { calm, createWind, defaultWindParams, type WindField } from './wind';
import { length, sub, vec, type Vec3 } from './math3';
import { birdEnergy, createBird, defaultParams, neutralControls, step } from './flight';
import { totalWork } from './energy';

const DT = 1 / 120;

/** Mean rate of change of the wind a bird feels while crossing at `speed`. */
function churn(field: WindField, speed: number, seconds = 40): number {
  let previous = field.at(vec(0, 120, 0), 0);
  let total = 0;
  for (let i = 1; i <= Math.round(seconds / DT); i++) {
    const t = i * DT;
    // Diagonal, so no single axis of the field dominates the answer.
    const here = field.at(vec(speed * t * 0.6, 120, -speed * t * 0.8), t);
    total += length(sub(here, previous));
    previous = here;
  }
  return total / seconds;
}

/** Peak gust magnitude seen over a patch of sky. */
function spread(field: WindField, altitude: number): { min: number; max: number } {
  let min = Infinity;
  let max = 0;
  for (let i = 0; i < 400; i++) {
    const w = field.at(vec(i * 7.3, altitude, i * -11.1), i * 0.37);
    const s = length(w);
    min = Math.min(min, s);
    max = Math.max(max, s);
  }
  return { min, max };
}

describe('wind profile', () => {
  const wind = createWind();

  it('is still at ground level and stronger with height', () => {
    expect(wind.meanAt(0)).toBe(0);
    const heights = [2, 10, 30, 60, 100, 150, 250];
    for (let i = 1; i < heights.length; i++) {
      expect(wind.meanAt(heights[i]!)).toBeGreaterThan(wind.meanAt(heights[i - 1]!));
    }
  });

  it('reaches its stated speed at the reference height', () => {
    expect(wind.meanAt(defaultWindParams.referenceHeight)).toBeCloseTo(
      defaultWindParams.speed,
      9,
    );
  });

  it('gusts harder up high, where the mean is stronger', () => {
    const low = spread(wind, 20);
    const high = spread(wind, 200);
    expect(high.max - high.min).toBeGreaterThan(low.max - low.min);
  });

  it('goes properly calm when asked', () => {
    const still = createWind({ ...defaultWindParams, speed: 0 });
    expect(still.at(vec(10, 200, -40), 12).x).toBe(0);
    expect(length(still.at(vec(10, 200, -40), 12))).toBe(0);
    expect(length(calm.at(vec(1, 2, 3), 4))).toBe(0);
  });
});

describe('wind varies with where you are, not just when', () => {
  const wind = createWind();

  it('roughens the faster you cross the map', () => {
    // The gusts are a function of position, so covering ground quickly means
    // running through them quickly. Nothing in the model tracks ground speed.
    const speeds = [0, 5, 11, 20, 35, 50];
    const rates = speeds.map((v) => churn(wind, v));
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i]!, `${speeds[i]} m/s`).toBeGreaterThan(rates[i - 1]!);
    }
    // A dive should be markedly rougher than a cruise, not marginally.
    expect(churn(wind, 50)).toBeGreaterThan(churn(wind, 11) * 3);
  });

  it('still shifts around a bird that is holding station', () => {
    expect(churn(wind, 0)).toBeGreaterThan(0.05);
  });

  it('has no ground speed at which the air goes eerily still', () => {
    // An earlier field had every octave drifting together, so at about 30 m/s
    // the bird surfed along with the pattern and the gusts vanished.
    for (let speed = 2; speed <= 60; speed += 2) {
      expect(churn(wind, speed, 20), `${speed} m/s`).toBeGreaterThan(0.1);
    }
  });

  it('is a pure function of place and time', () => {
    const a = wind.at(vec(12, 88, -37), 5.5);
    const b = wind.at(vec(12, 88, -37), 5.5);
    expect(a).toEqual(b);
  });
});

describe('flying in wind', () => {
  const wind = createWind();

  it('pushes a coasting bird off a straight line', () => {
    const drift = (field: WindField) => {
      const bird = createBird(vec(0, 150, 0), 16);
      const controls = neutralControls();
      for (let t = 0; t < 20; t += DT) step(bird, controls, defaultParams, DT, undefined, field);
      return Math.abs(bird.position.x);
    };

    expect(drift(calm)).toBeLessThan(0.001);
    expect(drift(wind)).toBeGreaterThan(5);
  });

  it('separates airspeed from ground speed', () => {
    const bird = createBird(vec(0, 150, 0), 16);
    const controls = neutralControls();
    let telemetry = step(bird, controls, defaultParams, DT, undefined, wind);
    for (let t = DT; t < 12; t += DT) {
      telemetry = step(bird, controls, defaultParams, DT, undefined, wind);
    }
    expect(telemetry.airspeed).not.toBeCloseTo(telemetry.groundSpeed, 2);
    // Airspeed is what the wing feels, so it is ground speed minus the air.
    const through: Vec3 = sub(bird.velocity, telemetry.wind);
    expect(telemetry.airspeed).toBeCloseTo(length(through), 6);
  });

  it('leaves the flight model untouched in calm air', () => {
    const withField = createBird(vec(0, 400, 0), 15);
    const without = createBird(vec(0, 400, 0), 15);
    const controls = { ...neutralControls(), flap: true };
    for (let t = 0; t < 10; t += DT) {
      step(withField, controls, defaultParams, DT, undefined, calm);
      step(without, controls, defaultParams, DT);
    }
    expect(withField.position).toEqual(without.position);
  });

  it('keeps the energy books balanced, even though the air can do work', () => {
    // Drag is only guaranteed dissipative in the air's frame. Measured against
    // the ground a tailwind gust can hand the bird energy -- which is real,
    // and has to show up in the ledger rather than as a leak.
    const bird = createBird(vec(0, 3000, 0), 15);
    const controls = { ...neutralControls(), flap: true, roll: 0.4 };
    let previous = birdEnergy(bird, defaultParams).total;
    let worst = 0;

    for (let t = 0; t < 30; t += DT) {
      const telemetry = step(bird, controls, defaultParams, DT, undefined, wind);
      worst = Math.max(worst, Math.abs(telemetry.energy.total - previous - totalWork(telemetry.work)));
      previous = telemetry.energy.total;
    }
    expect(worst).toBeLessThan(1e-9);
  });
});
