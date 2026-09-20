import { describe, expect, it } from 'vitest';
import { highlightAfter, levelChoice, tabAfter } from './menu';

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

describe('walking the list with the arrows', () => {
  it('moves one row at a time, either way', () => {
    expect(highlightAfter(3, 1, 10)).toBe(4);
    expect(highlightAfter(3, -1, 10)).toBe(2);
    expect(highlightAfter(3, 0, 10)).toBe(3);
  });

  it('reaches the levels a digit cannot', () => {
    // The whole reason for it, and the mechanism is worth naming precisely:
    // it is not that `levelChoice` refuses a tenth level, it is that there is
    // no tenth digit to offer it. The input layer reads Digit1..Digit9 and
    // NumpadEnter1..9, so the digits that can ever arrive are one to nine --
    // and none of them reaches the tenth row, or an eleventh, or a twelfth.
    const reachable = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => levelChoice(digit, 10, true)),
    );
    expect(reachable.has(9), 'the tenth level, by key').toBe(false);

    // Nine rows down from the first, which is what the arrows are for.
    expect(highlightAfter(0, 9, 10)).toBe(9);
  });

  it('wraps at both ends rather than stopping against them', () => {
    // Held down at the end of the list it carries on. Stopping dead is the
    // behaviour that makes a player wonder whether the key is working.
    expect(highlightAfter(9, 1, 10)).toBe(0);
    expect(highlightAfter(0, -1, 10)).toBe(9);
    // And a step longer than the list still lands on the list.
    expect(highlightAfter(0, 25, 10)).toBe(5);
    expect(highlightAfter(0, -25, 10)).toBe(5);
  });

  it('has somewhere to be even with nothing to show', () => {
    expect(highlightAfter(0, 1, 0)).toBe(0);
  });
});

describe('moving between the games', () => {
  it('stops at the ends rather than wrapping round', () => {
    // Three tabs, and the arrows are also a bird's roll: a strip that wrapped
    // would take you from the story to the round with one press.
    expect(tabAfter(0, -1, 3)).toBe(0);
    expect(tabAfter(0, 1, 3)).toBe(1);
    expect(tabAfter(2, 1, 3)).toBe(2);
    expect(tabAfter(1, -1, 3)).toBe(0);
  });

  it('takes a whole step however many frames the key was held for', () => {
    // The input hands over a total rather than one press at a time, so a key
    // held down arrives as three -- and three is still one tab from the end.
    expect(tabAfter(0, 3, 3)).toBe(2);
    expect(tabAfter(2, -5, 3)).toBe(0);
  });
});
