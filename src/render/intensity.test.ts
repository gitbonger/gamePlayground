import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CROWS_NEAR, FAST, intensityOf, RUNGS, type Situation } from './intensity';

/** Cruising along, with nothing about. */
const calm = (over: Partial<Situation> = {}): Situation => ({
  aloft: true,
  airspeed: 12,
  climb: 0,
  altitude: 60,
  stamina: 1,
  health: 1,
  flock: 0,
  crow: null,
  lockedOn: false,
  falling: false,
  rescuing: false,
  ...over,
});

describe('how much is going on', () => {
  it('rates the five examples the way they were asked for', () => {
    expect(intensityOf(calm()).level).toBe(1);
    expect(intensityOf(calm({ airspeed: FAST + 1 })).level).toBe(2);
    expect(intensityOf(calm({ flock: 11 })).level).toBe(3);
    expect(intensityOf(calm({ crow: CROWS_NEAR - 1 })).level).toBe(4);
    expect(intensityOf(calm({ crow: 40, lockedOn: true })).level).toBe(5);
  });

  it('takes the loudest thing that is true, not the first one thought of', () => {
    // Fast, with a big flock, with crows locked on: that is a five.
    expect(intensityOf(calm({ airspeed: 30, flock: 20, lockedOn: true })).id).toBe('lockedOn');
  });

  it('is calm on the ground whatever the numbers say', () => {
    // Standing on a roof beside a flock of thirty, which is where the
    // numbers above would otherwise put him.
    expect(intensityOf(calm({ aloft: false, flock: 30, crow: 50 })).level).toBe(1);
  });

  it('names the same situations as MUSIC.md', () => {
    const spec = readFileSync(new URL('../../MUSIC.md', import.meta.url), 'utf8');
    const written = [...spec.matchAll(/^- \*\*(\w+)\*\*/gm)].map((m) => m[1]).sort();
    expect(RUNGS.map((rung) => rung.id).sort()).toEqual(written);
  });
});
