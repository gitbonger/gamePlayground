import { describe, expect, it } from 'vitest';
import { begin, GREETING, isOver, reply, type Turn } from './dialogue';
import { LEVELS } from './levels';

/** What is on screen, as plain strings, for comparing against. */
const lines = (exchange: ReturnType<typeof begin>) =>
  exchange.said.map((said) => `${said.who}: ${said.text}`);

describe('holding a conversation', () => {
  it('opens on their line, with yours to choose from', () => {
    const talk = begin(GREETING);
    expect(lines(talk)).toEqual(["them: It's good to see you!"]);
    expect(talk.replies.map((r) => r.text)).toEqual(['You too!', 'It was not easy!']);
    expect(isOver(talk)).toBe(false);
  });

  it('answers what you actually said', () => {
    // The branch is the whole point: two replies, two different answers.
    const kind = reply(begin(GREETING), 1);
    expect(lines(kind)).toEqual([
      "them: It's good to see you!",
      'you: You too!',
      'them: Good luck on your quest!',
    ]);

    const weary = reply(begin(GREETING), 2);
    expect(lines(weary)).toEqual([
      "them: It's good to see you!",
      'you: It was not easy!',
      'them: Nothing is easy!',
    ]);
  });

  it('keeps everything said, not just the last of it', () => {
    // A conversation you can only see the last line of is one you have to
    // remember rather than read.
    const talk = reply(begin(GREETING), 1);
    expect(talk.said).toHaveLength(3);
  });

  it('is over once there is nothing left to say', () => {
    for (const choice of [1, 2]) {
      const talk = reply(begin(GREETING), choice);
      expect(isOver(talk), `reply ${choice}`).toBe(true);
      expect(talk.replies, `reply ${choice}`).toHaveLength(0);
    }
  });

  it('says nothing when you press a key that is not on offer', () => {
    // Being asked to pick between two things and pressing a third is not an
    // answer, and putting words in the player's mouth would be worse.
    const talk = begin(GREETING);
    for (const choice of [0, 3, 9, -1]) {
      expect(reply(talk, choice), `${choice}`).toEqual(talk);
    }
  });

  it('cannot be replied to once it is over', () => {
    const done = reply(begin(GREETING), 1);
    expect(reply(done, 1)).toEqual(done);
  });

  it('leaves the exchange it was given alone', () => {
    // Every step is a new one, so nothing that has been shown can change
    // under the panel drawing it.
    const talk = begin(GREETING);
    const before = lines(talk);
    reply(talk, 1);
    expect(lines(talk)).toEqual(before);
  });

  it('goes deeper than one exchange when a branch does', () => {
    // The placeholder is two lines deep. The shape is a tree, so nothing
    // about the traversal should know that.
    const deep: Turn = {
      them: 'one',
      you: [{ text: 'two', then: { them: 'three', you: [{ text: 'four', then: { them: 'five' } }] } }],
    };
    const talk = reply(reply(begin(deep), 1), 1);
    expect(lines(talk)).toEqual([
      'them: one',
      'you: two',
      'them: three',
      'you: four',
      'them: five',
    ]);
    expect(isOver(talk)).toBe(true);
  });

  it('ends on your word when a reply has no answer', () => {
    const talk = reply(begin({ them: 'well?', you: [{ text: 'nothing' }] }), 1);
    expect(lines(talk)).toEqual(['them: well?', 'you: nothing']);
    expect(isOver(talk)).toBe(true);
  });

  it('starts over from nothing, so a level can be replayed', () => {
    const once = reply(begin(GREETING), 1);
    const again = begin(GREETING);
    expect(again.said).toHaveLength(1);
    expect(isOver(again)).toBe(false);
    expect(once.said.length).toBeGreaterThan(again.said.length);
  });
});

describe('every level has something to say', () => {
  it('opens with a line and at least one thing to say back', () => {
    for (const level of LEVELS) {
      const talk = begin(level.dialogue);
      expect(talk.said[0]?.text.length, level.name).toBeGreaterThan(0);
      expect(talk.replies.length, level.name).toBeGreaterThan(0);
    }
  });

  it('ends, whichever way you take it', () => {
    // A branch that never runs out is a level you can never leave.
    for (const level of LEVELS) {
      for (const [index] of level.dialogue.you!.entries()) {
        let talk = begin(level.dialogue);
        for (let step = 0; step < 20 && !isOver(talk); step += 1) {
          talk = reply(talk, step === 0 ? index + 1 : 1);
        }
        expect(isOver(talk), `${level.name}, reply ${index + 1}`).toBe(true);
      }
    }
  });
});
