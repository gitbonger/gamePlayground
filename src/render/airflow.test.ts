import { describe, expect, it } from 'vitest';
import { airRush, airVoice } from './airflow';

describe('the sound of the air', () => {
  it('is silent while he is standing about, and rises with the speed', () => {
    expect(airVoice(0).level).toBe(0);
    expect(airVoice(6).level).toBe(0);
    expect(airVoice(20).level).toBeGreaterThan(0);
    expect(airVoice(40).level).toBeGreaterThan(airVoice(20).level);
  });

  it('stops getting louder past the speed the rocket leaves him at', () => {
    // Or a long enough burn would end with the air the only thing audible.
    expect(airRush(55)).toBe(1);
    expect(airVoice(120).level).toBe(airVoice(55).level);
  });

  it('keeps ordinary flying well under the rest of the noise', () => {
    // Fourteen metres a second is a pigeon getting somewhere, and at that
    // speed the air should be a hush behind the city rather than a wind
    // tunnel: a fifth of what it has at full tilt, because it is squared.
    expect(airVoice(14).level).toBeLessThan(airVoice(55).level / 5);
    expect(airVoice(14).level).toBeGreaterThan(0);
  });

  it('opens up as it gets louder, so fast air is brighter as well as louder', () => {
    expect(airVoice(14).bright).toBeLessThan(airVoice(45).bright);
    expect(airVoice(55).bright).toBe(1);
  });
});
