import { describe, expect, it } from 'vitest';
import { escortDrawn } from './escort';

describe('drawing the escort', () => {
  it('draws her when her bird can be seen', () => {
    // The bug this exists for. Her rig's visibility was set inside the loop
    // over the birds, so the one that is her turned it on and the
    // twenty-nine that are not turned it off again -- and she was never drawn
    // on the level that is about nobody else.
    //
    // Thirty rigs and one bird in the air, which is exactly the last level.
    const shown = Array.from({ length: 30 }, (_, i) => i === 0);
    expect(escortDrawn(shown, 0).her).toBe(true);
  });

  it('takes her own grey rig off, so there is not a pigeon inside her', () => {
    const shown = Array.from({ length: 30 }, (_, i) => i === 0);
    expect(escortDrawn(shown, 0).flock[0]).toBe(false);
  });

  it('draws the rest of a flock as themselves', () => {
    // She is one level. Every other flock is nobody in particular, and asking
    // for her by index must not take a bird out of an ordinary one.
    const shown = [true, true, true, false];
    const drawn = escortDrawn(shown, null);
    expect(drawn.her).toBe(false);
    expect(drawn.flock).toEqual([true, true, true, false]);
  });

  it('draws nobody who cannot be seen, her included', () => {
    // A bird waiting its turn to be let out is not in the air, and a level
    // with no escort has none at all.
    const drawn = escortDrawn([false, false, false], 0);
    expect(drawn.her).toBe(false);
    expect(drawn.flock).toEqual([false, false, false]);
  });

  it('says nothing about birds that are not there', () => {
    expect(escortDrawn([], 0).her).toBe(false);
    expect(escortDrawn([], null).flock).toEqual([]);
  });
});
