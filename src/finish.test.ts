import { describe, expect, it } from 'vitest';
import { ARRIVED_WITHIN, endingFor, LINGERS, type Progress } from './finish';
import { LEVELS } from './levels';

const TICK = 1 / 120;

/** Flying along, nothing achieved. */
const flying = (over: Partial<Progress> = {}): Progress => ({
  perched: false,
  toTarget: 400,
  belly: 0.3,
  overTheLine: false,
  ...over,
});

/** Ask the rule for `seconds`, and say whether it ever said yes. */
const held = (ending: ReturnType<typeof endingFor>, at: Progress, seconds: number) => {
  for (let t = 0; t < seconds; t += TICK) if (ending!.done(at, TICK)) return true;
  return false;
};

const kindOf = (kind: string) => LEVELS.find((level) => level.finish.kind === kind)!.finish;

describe('what finishes a level', () => {
  it('has nothing to say about the two that end elsewhere', () => {
    // One you finish by walking up to somebody, which is the conversation's
    // business, and one that does not finish at all.
    expect(endingFor(kindOf('meeting'))).toBeNull();
    expect(endingFor(kindOf('free'))).toBeNull();
  });

  it('ends a crossing the moment the line is behind you', () => {
    const ending = endingFor(kindOf('crossing'))!;
    expect(ending.done(flying(), TICK)).toBe(false);
    expect(ending.done(flying({ overTheLine: true }), TICK)).toBe(true);
  });

  it('ends the eating when the belly is full and not before', () => {
    const ending = endingFor(kindOf('fed'))!;
    expect(ending.done(flying({ belly: 0.99 }), TICK)).toBe(false);
    expect(ending.done(flying({ belly: 1 }), TICK)).toBe(true);
  });
});

describe('arriving at a square, which takes a moment', () => {
  const arrival = () => endingFor(kindOf('arrival'))!;

  it('does not end on the frame the feet touch', () => {
    // It used to. That is a landing rather than an arrival: he has come to a
    // square to look for somebody, and the looking took no time at all.
    const ending = arrival();
    expect(ending.done(flying({ perched: true, toTarget: 5 }), TICK)).toBe(false);
  });

  it('gives him a couple of seconds to walk about on it', () => {
    const ending = arrival();
    const on = flying({ perched: true, toTarget: 5 });
    expect(held(ending, on, LINGERS - 0.5), 'not yet').toBe(false);
    expect(held(ending, on, 1), 'and then yes').toBe(true);
  });

  it('counts only the time spent on it', () => {
    // A bird circling overhead is not looking for anybody.
    const ending = arrival();
    expect(held(ending, flying({ perched: false, toTarget: 5 }), 30), 'in the air').toBe(false);
    expect(held(ending, flying({ perched: true, toTarget: 400 }), 30), 'down elsewhere').toBe(
      false,
    );
  });

  it('adds up time on it across more than one landing', () => {
    // Land, hop off the kerb, come back. He has still spent his two seconds
    // on the square, and a rule that wanted them in one go would be a rule
    // about standing still.
    const ending = arrival();
    const on = flying({ perched: true, toTarget: 5 });
    expect(held(ending, on, LINGERS * 0.6), 'most of the way').toBe(false);
    expect(held(ending, flying(), 5), 'off again').toBe(false);
    expect(held(ending, on, LINGERS * 0.6), 'and back').toBe(true);
  });

  it('takes anywhere on the square, not the middle of it', () => {
    // A square is a place. A rule that wanted the middle would be a spot
    // landing wearing a story's clothes.
    const ending = arrival();
    expect(held(ending, flying({ perched: true, toTarget: ARRIVED_WITHIN - 1 }), 4)).toBe(true);
    expect(held(arrival(), flying({ perched: true, toTarget: ARRIVED_WITHIN + 1 }), 4)).toBe(
      false,
    );
  });

  it('is its own rule per level, not a clock they share', () => {
    // Two levels end this way and they are flown one after the other; a
    // counter that carried over would finish the second one on landing.
    const first = arrival();
    expect(held(first, flying({ perched: true, toTarget: 5 }), 4)).toBe(true);
    const second = arrival();
    expect(second.done(flying({ perched: true, toTarget: 5 }), TICK)).toBe(false);
  });
});
