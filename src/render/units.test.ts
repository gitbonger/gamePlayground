import { describe, expect, it } from 'vitest';
import hudSource from './hud.ts?raw';
import outcomeSource from './outcome.ts?raw';
import { kmh, rateText, speedText } from './units';

describe('speeds as the player reads them', () => {
  it('agrees with speeds nobody has to look up', () => {
    // Anchored to known figures rather than to the factor that produces them:
    // a wrong constant that happens to be self-consistent still fails here.
    expect(kmh(1)).toBeCloseTo(3.6, 9); // A metre a second, by definition.
    expect(kmh(13.89)).toBeCloseTo(50, 1); // A car through a Budapest street.
    expect(kmh(27.78)).toBeCloseTo(100, 1); // A motorway.
    expect(kmh(343)).toBeCloseTo(1234.8, 1); // The speed of sound at sea level.
  });

  it('reads a racing pigeon at the speed a racing pigeon flies', () => {
    // Homing pigeons average 80 km/h over a race and can hold about 120.
    expect(Number(speedText(22))).toBeGreaterThan(75);
    expect(Number(speedText(22))).toBeLessThan(85);
    expect(Number(speedText(33))).toBeCloseTo(119, 0);
  });

  it('rounds to whole km/h, and never by more than half of one', () => {
    for (let ms = 0; ms < 60; ms += 0.017) {
      expect(Math.abs(Number(speedText(ms)) - kmh(ms))).toBeLessThanOrEqual(0.5);
      expect(speedText(ms)).toMatch(/^\d+$/);
    }
  });
});

describe('vertical speeds', () => {
  it('keeps climbing apart from sinking', () => {
    expect(rateText(2.5)).toBe('9');
    expect(rateText(-2.5)).toBe('-9');
  });

  it('does not tell a bird it is descending when it is level', () => {
    // climbRate crosses zero from below constantly in level flight, and a
    // readout that flickers "-0" reads as a fault in the instrument.
    expect(rateText(-0)).toBe('0');
    expect(rateText(-0.01)).toBe('0');
    expect(rateText(0)).toBe('0');
  });
});

describe('every readout the player sees', () => {
  // A guard against reintroduction rather than a proof: the airspeed was in
  // km/h and the ground-impact message beside it in m/s, because each readout
  // converted -- or forgot to -- on its own. It cannot catch a new file that
  // does the same thing, only these two doing it again.
  const displays = [
    ['hud.ts', hudSource],
    ['outcome.ts', outcomeSource],
  ] as const;

  it('leaves the conversion to one place', () => {
    for (const [name, source] of displays) {
      const code = source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
      expect(code, `${name} converts a speed itself`).not.toMatch(/\*\s*3\.6/);
      expect(code, `${name} still labels something m/s`).not.toMatch(/m\/s/);
    }
  });
});
