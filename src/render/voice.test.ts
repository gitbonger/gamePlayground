import { sameInBoth } from '../i18n';
import { describe, expect, it } from 'vitest';
import { createVoice, type Speaker } from './voice';

/** A speaker that writes down what it was asked to say, and when it was hushed. */
function heard() {
  const words: string[] = [];
  let hushes = 0;
  const speaker: Speaker = {
    say(said) {
      words.push(said);
    },
    hush() {
      hushes += 1;
    },
  };
  return { speaker, words, hushed: () => hushes };
}

const tip = (text: string) => ({ keys: ['SPACE'], text: sameInBoth(text) });

describe('saying the instructions out loud', () => {
  it('says a thing once when it appears, not once a frame', () => {
    // The panel is told what to show sixty times a second. A voice told the
    // same way would be sixty voices.
    const { speaker, words } = heard();
    const voice = createVoice(speaker, 8);
    for (let frame = 0; frame < 30; frame += 1) voice.update(tip('Pull up!'), frame / 60);
    expect(words).toEqual(['Pull up!']);
  });

  it('says nothing more while the same thing is still on screen', () => {
    // Twenty seconds of one caution -- a long sink towards a park -- is one
    // thing being true for twenty seconds, not three things happening. The
    // waiting rule alone would not catch this: it would come round after
    // eight and say it again to a player who can still see it.
    const { speaker, words } = heard();
    const voice = createVoice(speaker, 8);
    for (let second = 0; second < 20; second += 0.25) voice.update(tip('Pull up!'), second);
    expect(words).toEqual(['Pull up!']);
  });

  it('waits before saying the same thing again', () => {
    // The cautions are the reason this rule exists. "Pull up" comes on and
    // off as the bird crosses ten metres, and a voice without this would say
    // it four times in a straight line.
    const { speaker, words } = heard();
    const voice = createVoice(speaker, 8);
    voice.update(tip('Pull up!'), 0);
    voice.update(null, 1);
    voice.update(tip('Pull up!'), 2);
    voice.update(null, 3);
    voice.update(tip('Pull up!'), 7.9);
    expect(words).toEqual(['Pull up!']);

    // And says it again once enough has gone by that hearing it twice means
    // something has gone wrong twice.
    voice.update(null, 8.5);
    voice.update(tip('Pull up!'), 9);
    expect(words).toEqual(['Pull up!', 'Pull up!']);
  });

  it('cuts off what it was saying when something else needs saying', () => {
    // An instruction is about now. A queue of them would be a voice
    // describing a flight that has already happened.
    const { speaker, words, hushed } = heard();
    const voice = createVoice(speaker, 8);
    voice.update(tip('Keep flapping!'), 0);
    voice.update(tip('Pull up!'), 0.2);
    expect(words).toEqual(['Keep flapping!', 'Pull up!']);
    expect(hushed()).toBe(2);
  });

  it('says nothing at all once it is turned off', () => {
    const { speaker, words, hushed } = heard();
    const voice = createVoice(speaker, 8);
    voice.update(tip('Keep flapping!'), 0);
    expect(voice.toggle()).toBe(false);
    expect(hushed()).toBeGreaterThan(1);

    voice.update(tip('Pull up!'), 1);
    voice.update(tip('Brake to slow down'), 2);
    expect(words).toEqual(['Keep flapping!']);
  });

  it('starts a fresh flight when it is turned back on', () => {
    // Turning it on has to be a beginning, not a resumption: what it said
    // before the silence is no use to whoever has just asked to hear it.
    const { speaker, words } = heard();
    const voice = createVoice(speaker, 8);
    voice.update(tip('Pull up!'), 0);
    voice.toggle();
    voice.toggle();
    voice.update(tip('Pull up!'), 1);
    expect(words).toEqual(['Pull up!', 'Pull up!']);
  });
});
