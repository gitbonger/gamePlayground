import { sameInBoth } from '../i18n';
import { describe, expect, it } from 'vitest';
import { createTipStack, type Tip } from './tips';
import type { Message, Moment } from './messages';

/** A moment with nothing happening in it; every message here decides itself. */
const nowhere = {} as Moment;

/**
 * A message that is simply on or off, for testing the holding rather than the
 * deciding. What each real one decides is `messages.test.ts`'s business.
 */
const tip = (id: string, on = true, gone = false): Message => ({
  id,
  keys: [],
  text: sameInBoth(id),
  when: () => on,
  done: () => gone,
});

const said = (tips: readonly Tip[]) => tips.map((each) => each.text.en);

describe('holding what the game has to say', () => {
  it('shows two things that arrive together, rather than one of them', () => {
    // The whole reason this exists. The corner used to pick a winner out of a
    // chain of `??`, which meant everything below the winner was not late --
    // it was never said. A crow closing while the wings ran out said "crows",
    // and the stamina was simply never mentioned.
    const stack = createTipStack(3, 3);
    expect(said(stack.update([tip('crows'), tip('flap')], nowhere, 0))).toEqual(['crows', 'flap']);
  });

  it('keeps the older one where it was when a new one arrives', () => {
    // Oldest first, so the stack reads in the order it was said and the
    // newest is always in the same place -- nearest the bird.
    const stack = createTipStack(3, 3);
    stack.update([tip('pullUp')], nowhere, 0);
    expect(said(stack.update([tip('pullUp'), tip('tryRight')], nowhere, 1))).toEqual([
      'pullUp',
      'tryRight',
    ]);
  });

  it('takes one away once it has had its time', () => {
    const stack = createTipStack(3, 3);
    stack.update([tip('tryRight')], nowhere, 0);
    expect(said(stack.update([tip('tryRight', false)], nowhere, 2.9))).toEqual(['tryRight']);
    expect(stack.update([tip('tryRight', false)], nowhere, 3.1)).toEqual([]);
  });

  it('keeps one that is still true past its time', () => {
    // The half that keeps a warning honest. "Pull up" is true until the
    // ground stops being a problem, and one that timed out while it was still
    // true would blink off and straight back on.
    const stack = createTipStack(3, 3);
    for (let t = 0; t <= 10; t += 0.5) {
      expect(said(stack.update([tip('pullUp')], nowhere, t)), `${t}s`).toEqual(['pullUp']);
    }
    expect(stack.update([tip('pullUp', false)], nowhere, 10.5)).toEqual([]);
  });

  it('drops one the moment it says it is finished, however long it has been up', () => {
    // The other half, and the one the whole redesign is for: an instruction
    // the player has just acted on is an instruction that worked, and leaving
    // it up says the game did not notice.
    const stack = createTipStack(3, 3);
    expect(said(stack.update([tip('flap')], nowhere, 0))).toEqual(['flap']);
    expect(stack.update([tip('flap', true, true)], nowhere, 0.2)).toEqual([]);
  });

  it('never shows more than a screenful', () => {
    // Four warnings and a lesson is a player who reads none of them.
    const stack = createTipStack(3, 3);
    const showing = stack.update(
      ['one', 'two', 'three', 'four', 'five'].map((id) => tip(id)),
      nowhere,
      0,
    );
    expect(said(showing)).toEqual(['three', 'four', 'five']);
  });

  it('pushes the oldest off rather than refusing the newest', () => {
    // The newest is the one the game has just decided to say. Dropping that
    // to keep a three-second-old hint would be the queue ignoring the
    // emergency.
    const stack = createTipStack(3, 3);
    const three = ['one', 'two', 'three'].map((id) => tip(id));
    stack.update(three, nowhere, 0);
    expect(said(stack.update([...three, tip('four')], nowhere, 1))).toEqual([
      'two',
      'three',
      'four',
    ]);
  });

  it('leaves out a message that does not belong to this level', () => {
    const stack = createTipStack(3, 3);
    const elsewhere: Message = { ...tip('seeds'), on: ['Teleki tér'] };
    const here = { level: 'Blaha' } as Moment;
    expect(stack.update([elsewhere], here, 0)).toEqual([]);
    expect(said(stack.update([elsewhere], { level: 'Teleki tér' } as Moment, 0))).toEqual(['seeds']);
  });

  it('says a once-a-level message once, however often it comes true', () => {
    const stack = createTipStack(3, 3);
    const lesson: Message = { ...tip('tryRight'), once: true };
    expect(said(stack.update([lesson], nowhere, 0))).toEqual(['tryRight']);
    // Gone when its time is up, and it does not come back.
    stack.update([{ ...lesson, when: () => false }], nowhere, 4);
    expect(stack.update([lesson], nowhere, 5)).toEqual([]);
  });

  it('says it again for a flight that starts over', () => {
    // A death restarts the level, and a player who died is exactly the one
    // who wants the lesson again.
    const stack = createTipStack(3, 3);
    const lesson: Message = { ...tip('tryRight'), once: true };
    stack.update([lesson], nowhere, 0);
    stack.reset();
    expect(said(stack.update([lesson], nowhere, 0.1))).toEqual(['tryRight']);
  });
});
