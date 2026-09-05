import { describe, expect, it } from 'vitest';
import { levelChoice } from './menu';

/**
 * The menu's own markup is not tested here: there is no DOM in this suite and
 * adding one to check that a list of three names comes out as three rows is
 * not worth a dependency. It is built out of nodes with `textContent` rather
 * than out of a string, so the one thing that would have been worth testing --
 * that a level name cannot become markup -- is true by construction instead.
 *
 * The rule about which key picks what is the part with anything in it.
 */
describe('picking a level with a number key', () => {
  it('picks the level the number stands for, counting from one', () => {
    expect(levelChoice(1, 3, true)).toBe(0);
    expect(levelChoice(2, 3, true)).toBe(1);
    expect(levelChoice(3, 3, true)).toBe(2);
  });

  it('does nothing at all while the menu is closed', () => {
    // Or every digit typed during a flight would be a level change.
    for (const digit of [1, 2, 3]) expect(levelChoice(digit, 3, false)).toBeNull();
  });

  it('does nothing for a number that is not a level', () => {
    // A menu that closes itself when you mistype is worse than one that waits.
    for (const digit of [0, 4, 9, -1]) expect(levelChoice(digit, 3, true)).toBeNull();
  });

  it('does nothing when there are no levels to pick', () => {
    expect(levelChoice(1, 0, true)).toBeNull();
  });

  it('offers exactly the levels there are, and no more', () => {
    for (const count of [1, 2, 5, 9]) {
      const picked = [1, 2, 3, 4, 5, 6, 7, 8, 9]
        .map((digit) => levelChoice(digit, count, true))
        .filter((at): at is number => at !== null);
      expect(picked, `${count} levels`).toEqual(
        Array.from({ length: count }, (_, i) => i),
      );
    }
  });
});
