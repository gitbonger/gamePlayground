import { describe, expect, it } from 'vitest';
import { loadProgress, saveProgress } from './progress';
import { LEVELS } from './levels';

/** A Storage that keeps what it is given. */
function memory(initial: Record<string, string> = {}): Storage {
  const held = new Map(Object.entries(initial));
  return {
    get length() {
      return held.size;
    },
    clear: () => held.clear(),
    getItem: (key) => held.get(key) ?? null,
    key: (i) => [...held.keys()][i] ?? null,
    removeItem: (key) => void held.delete(key),
    setItem: (key, value) => void held.set(key, value),
  } as Storage;
}

/** A Storage that refuses, the way a locked-down browser does. */
const refuses = (): Storage =>
  ({
    getItem() {
      throw new Error('nope');
    },
    setItem() {
      throw new Error('nope');
    },
  }) as unknown as Storage;

describe('remembering which level you are on', () => {
  it('starts at the beginning when nothing is stored', () => {
    expect(loadProgress(memory(), 4)).toBe(0);
  });

  it('comes back to the level it was left on', () => {
    const store = memory();
    saveProgress(store, 2);
    expect(loadProgress(store, 4)).toBe(2);
  });

  it('starts at the beginning when there is no storage at all', () => {
    // A private window, or a test. Not having anywhere to remember things is
    // an ordinary case rather than a fault.
    expect(loadProgress(undefined, 4)).toBe(0);
    expect(() => saveProgress(undefined, 2)).not.toThrow();
  });

  it('survives storage that refuses to be read or written', () => {
    expect(loadProgress(refuses(), 4)).toBe(0);
    expect(() => saveProgress(refuses(), 2)).not.toThrow();
  });

  it('starts at the beginning for anything that is not a level', () => {
    // A number from a build that had more levels in it, or something typed
    // into the console. There is nothing here worth throwing over.
    for (const stored of ['4', '-1', '1.5', 'two', '', 'NaN', '1e3']) {
      expect(loadProgress(memory({ 'pigeon-sim.level': stored }), 4), stored).toBe(0);
    }
  });

  it('does not offer a level when there are none', () => {
    expect(loadProgress(memory({ 'pigeon-sim.level': '0' }), 0)).toBe(0);
  });

  it('is a level the game actually has', () => {
    const store = memory();
    saveProgress(store, LEVELS.length - 1);
    const at = loadProgress(store, LEVELS.length);
    expect(LEVELS[at]).toBeDefined();
  });
});

describe('the levels themselves', () => {
  it('has at least one, with everything a level needs', () => {
    expect(LEVELS.length).toBeGreaterThan(0);
    for (const level of LEVELS) {
      expect(level.name.length, level.name).toBeGreaterThan(0);
      // Somewhere on Earth, and somewhere over Budapest at that.
      expect(level.start[0], level.name).toBeGreaterThan(47);
      expect(level.start[0], level.name).toBeLessThan(48);
      expect(level.start[1], level.name).toBeGreaterThan(18);
      expect(level.start[1], level.name).toBeLessThan(20);
      // An hour that a Date can actually be made of.
      expect(Number.isFinite(new Date(level.when).getTime()), level.name).toBe(true);
    }
  });

  it('names them all differently', () => {
    // The name is what a marker and a resident are found by, so two levels
    // sharing one is two levels sharing a target.
    expect(new Set(LEVELS.map((level) => level.name)).size).toBe(LEVELS.length);
  });
});
