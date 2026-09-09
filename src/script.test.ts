import { describe, expect, it } from 'vitest';
import { alone, conversation, readScript, SPOKEN } from './script';
import { LEVELS, dialogueOf, SCENES } from './levels';
import { begin, isOver, reply } from './dialogue';

/** Walk a conversation to the end down the `choice`th branch each time. */
const toTheEnd = (name: string, choice = 1) => {
  let talk = begin(conversation(name));
  for (let step = 0; step < 20 && !isOver(talk); step += 1) {
    talk = reply(talk, step === 0 ? choice : 1);
  }
  return talk;
};

describe('reading the script out of the file', () => {
  it('finds every conversation the levels ask for', () => {
    const wanted = LEVELS.filter((level) => dialogueOf(level)).length;
    expect(wanted, 'the levels do ask for some').toBeGreaterThan(0);
    // `dialogueOf` would have thrown at load if one were missing -- see
    // `conversation` -- so reaching here is most of the assertion.
    for (const level of LEVELS) {
      const said = dialogueOf(level);
      if (!said) continue;
      expect(said.them.en.length, level.name).toBeGreaterThan(0);
      expect(said.them.hu.length, level.name).toBeGreaterThan(0);
    }
  });

  it('gives every scene that speaks its lines', () => {
    const speaking = SCENES.filter((scene) => scene.says?.length);
    expect(speaking.map((scene) => scene.name)).toEqual([
      'a full belly',
      'flying home',
      'nobody at Mátyás tér',
      'nobody at Jani Pali tér',
    ]);
    for (const scene of speaking) {
      for (const line of scene.says ?? []) {
        expect(line.en.length, scene.name).toBeGreaterThan(0);
        expect(line.hu.length, scene.name).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the branch that the first conversation is about', () => {
    // Two replies, and the second goes somewhere before it ends -- which is
    // the first thing in the game that shows a reply can lead on rather than
    // merely be chosen. A parser that flattened the tree would lose exactly
    // this and nothing else would notice.
    const opening = begin(conversation('Heading out'));
    expect(opening.replies.map((each) => each.text.en)).toEqual([
      'Yes, sure!',
      'I would watch the egg, while you go!',
    ]);
    expect(toTheEnd('Heading out', 1).said).toHaveLength(3);
    expect(toTheEnd('Heading out', 2).said).toHaveLength(4);
    for (const choice of [1, 2]) expect(toTheEnd('Heading out', choice).opens).toBe('Temető');
  });

  it('keeps the long unbranching one at its full length', () => {
    // Four exchanges deep and no forks: the beat is being *told* something,
    // and a fork would be offering to not be told it.
    const done = toTheEnd('The trapper');
    expect(done.said.map((each) => each.text.en)).toEqual([
      'Hey mate!',
      'I am looking for my girl',
      'Good luck with that!',
      'She has gone missing while I was away!',
      'There is a crazy person, a trapper, captures birds! On the top of a big house! Go look there!',
      'I go quick!',
    ]);
    expect(done.opens).toBe('up to the roofs');
  });

  it('reads both languages off one line', () => {
    expect(conversation('Caught').them).toEqual({
      en: 'The trapper got me!',
      hu: 'Elkapott a madarász!',
    });
    expect(alone('nobody at Jani Pali tér')).toEqual([
      { en: 'She is not here!', hu: 'Itt sincs!' },
      { en: 'Maybe on Blaha!', hu: 'Talán a Blahán!' },
    ]);
  });

  it('has no headings nobody uses', () => {
    // A conversation in the file that nothing reaches for is a scene somebody
    // wrote and forgot to hook up, which reads exactly like one that works.
    const used = new Set<string>();
    for (const scene of SCENES) if (alone(scene.name).length) used.add(scene.name);
    for (const name of ['Heading out', 'The trapper', 'Caught', 'The ask', 'Saved']) used.add(name);
    for (const heading of SPOKEN) expect(used, `"${heading}" is in the file`).toContain(heading);
  });
});

describe('the notation itself', () => {
  const only = (text: string) => readScript(text);

  it('nests by indentation', () => {
    const read = only(`## t
- them: a | á
  - you: b | bé
    - them: c | cé
`);
    const turn = read.get('t');
    expect(turn?.kind).toBe('talk');
    if (turn?.kind !== 'talk') return;
    expect(turn.turn.you?.[0]?.then?.them.hu).toBe('cé');
  });

  it('takes several replies at the same indent as the choices on offer', () => {
    const read = only(`## t
- them: a | á
  - you: one | egy
  - you: two | kettő
  - you: three | három
`);
    const turn = read.get('t');
    if (turn?.kind !== 'talk') throw new Error('not a conversation');
    expect(turn.turn.you?.map((each) => each.text.en)).toEqual(['one', 'two', 'three']);
  });

  it('hands over where a branch says so', () => {
    const read = only(`## t
- them: a | á
  - you: b | bé
    - opens: Somewhere
`);
    const turn = read.get('t');
    if (turn?.kind !== 'talk') throw new Error('not a conversation');
    expect(turn.turn.you?.[0]?.opens).toBe('Somewhere');
  });

  it('uses the same words in both where there is no pipe', () => {
    // Which is what a proper noun wants: `Blaha Lujza tér` is what the place
    // is called, not a phrase to translate.
    const read = only('## t\n- them: Blaha Lujza tér\n');
    const turn = read.get('t');
    if (turn?.kind !== 'talk') throw new Error('not a conversation');
    expect(turn.turn.them).toEqual({ en: 'Blaha Lujza tér', hu: 'Blaha Lujza tér' });
  });

  it('reads a section with nobody else in it as a monologue', () => {
    const read = only('## alone\n- you: one | egy\n- you: two | kettő\n');
    expect(read.get('alone')).toEqual({
      kind: 'alone',
      says: [
        { en: 'one', hu: 'egy' },
        { en: 'two', hu: 'kettő' },
      ],
    });
  });

  it('ignores everything that is not a bullet', () => {
    // The notes are the point of writing it in this file rather than in the
    // code, and a parser that choked on prose would make them unwritable.
    const read = only(`## t

Some notes about why this conversation is shaped as it is, with a - dash.

- them: a | á
`);
    expect(read.get('t')?.kind).toBe('talk');
  });

  it('refuses a conversation that starts with the wrong bird', () => {
    // A `Turn` opens on their line. One that opened on yours would be the
    // player talking to nobody, and the shape would be silently wrong.
    expect(() => only('## t\n- you: hello | szia\n  - them: hi | szia\n')).toThrow(/starts with/);
  });

  it('refuses a line with one side of the pipe missing', () => {
    expect(() => only('## t\n- them: hello | \n')).toThrow(/pipe/);
  });
});
