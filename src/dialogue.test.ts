import { describe, expect, it } from 'vitest';
import { alone, begin, isOver, reply, type Turn } from './dialogue';

/**
 * Two branches that each end after one exchange: the shape most of this
 * module's rules are about.
 *
 * It used to live in `dialogue.ts` as the placeholder every level ended on
 * until it had a story. Every level has one now, so nothing in the game said
 * it any more -- and a piece of production code that only the tests reach for
 * is a piece of production code that has stopped being any.
 */
const GREETING: Turn = {
  them: "It's good to see you!",
  you: [
    { text: 'You too!', then: { them: 'Good luck on your quest!' } },
    { text: 'It was not easy!', then: { them: 'Nothing is easy!' } },
  ],
};
import { dialogueOf, LEVELS } from './levels';

/** What is on screen, as plain strings, for comparing against. */
const lines = (exchange: ReturnType<typeof begin>) =>
  exchange.said.map((said) => `${said.who}: ${said.text}`);

describe('a monologue', () => {
  it('is a conversation with one speaker and nothing to say back', () => {
    // Which is what makes it worth having as a special case rather than as a
    // second kind of thing: the panel that shows conversations shows this,
    // and everything that asks whether the talking is finished gets "yes".
    const said = alone('Where did she go?', 'Maybe she is on Mátyás tér.');
    expect(said.said).toEqual([
      { who: 'you', text: 'Where did she go?' },
      { who: 'you', text: 'Maybe she is on Mátyás tér.' },
    ]);
    expect(said.replies).toEqual([]);
    expect(isOver(said)).toBe(true);
  });

  it('hands nothing over by itself', () => {
    // A conversation can open a level, because an answer can lead somewhere.
    // Nobody answers a monologue, so what follows it is the scene's business
    // and not the words'.
    expect(alone('...').opens).toBeUndefined();
  });

  it('is still a monologue when there is only one thing to say', () => {
    expect(alone('She is not here.').said).toHaveLength(1);
    expect(isOver(alone('She is not here.'))).toBe(true);
  });
});

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

describe('a conversation that hands over a level', () => {
  const ERRAND: Turn = {
    them: 'Could you go?',
    you: [
      { text: 'Yes.', then: { them: 'See you!', opens: 'The Park' } },
      { text: 'No.', then: { them: 'Then I will.', you: [{ text: 'Fine.', opens: 'The Yard' }] } },
      { text: 'Maybe.', then: { them: 'Make your mind up.', you: [{ text: 'Yes.' }] } },
      // A line that names a level and still has something to say after it.
      // Writing one is a mistake, but it is a mistake the types allow, and
      // what it must not do is hand the level over with her mouth still open.
      {
        text: 'Where again?',
        then: { them: 'Teleki tér.', opens: 'The Yard', you: [{ text: 'Right.' }] },
      },
    ],
  };

  it('takes the level off whichever line ended it, hers or yours', () => {
    // Where a branch *ends* decides, not which reply started it -- so an
    // exchange that finishes on her word and one that finishes on yours both
    // hand over what they were written to hand over.
    expect(reply(begin(ERRAND), 1).opens).toBe('The Park');
    expect(reply(reply(begin(ERRAND), 2), 1).opens).toBe('The Yard');
  });

  it('hands over nothing until it is actually over', () => {
    // The level changes when the conversation ends, and a conversation with
    // something still to say has not ended. This is the difference between
    // reading the last line and being moved on before you have read it.
    const opening = begin(ERRAND);
    expect(isOver(opening)).toBe(false);
    expect(opening.opens).toBeUndefined();

    // Two lines in and still mid-branch: her answer is on screen and the
    // reply to it is not made yet.
    const midway = reply(opening, 2);
    expect(isOver(midway)).toBe(false);
    expect(midway.opens).toBeUndefined();

    // And the case that actually bites: a line that names a level and still
    // has a reply waiting under it hands over nothing, because it has not
    // ended anything. Handing over here would take the panel off the screen
    // with her last line unread.
    const talking = reply(opening, 4);
    expect(isOver(talking)).toBe(false);
    expect(talking.opens).toBeUndefined();
  });

  it('leaves an ending that opens nothing alone', () => {
    // Most endings are just endings. The field is absent rather than
    // undefined, so nothing downstream has to tell those two apart.
    const over = reply(reply(begin(ERRAND), 3), 1);
    expect(isOver(over)).toBe(true);
    expect('opens' in over).toBe(false);
  });
});

describe('every level that has somebody waiting has something to say', () => {
  /** A level ends at a person or at a line; only the first sort talks. */
  const spoken = LEVELS.filter((level) => dialogueOf(level));

  it('opens with a line and at least one thing to say back', () => {
    expect(spoken.length).toBeGreaterThan(0);
    for (const level of spoken) {
      const talk = begin(dialogueOf(level)!);
      expect(talk.said[0]?.text.length, level.name).toBeGreaterThan(0);
      expect(talk.replies.length, level.name).toBeGreaterThan(0);
    }
  });

  it('ends, whichever way you take it', () => {
    // A branch that never runs out is a level you can never leave.
    for (const level of spoken) {
      for (const [index] of dialogueOf(level)!.you!.entries()) {
        let talk = begin(dialogueOf(level)!);
        for (let step = 0; step < 20 && !isOver(talk); step += 1) {
          talk = reply(talk, step === 0 ? index + 1 : 1);
        }
        expect(isOver(talk), `${level.name}, reply ${index + 1}`).toBe(true);
      }
    }
  });
});
