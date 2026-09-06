/**
 * The instructions, said out loud.
 *
 * A tip in the corner has to be read, and reading is the one thing a player
 * three seconds from a rooftop cannot spare attention for. Speech arrives
 * without being looked at, which is the whole of why it is worth having.
 *
 * The speaking itself is the browser's: `speechSynthesis` is built into every
 * one of them, the voices come from the operating system, and there is
 * nothing to download and nothing to pay for. What is written here is the
 * part that matters, which is *when to say something* -- a game that reads
 * every change of state aloud is a game nobody can bear for two minutes.
 */

import type { Tip } from './tips';

/** Whatever actually makes the noise. */
export interface Speaker {
  say(words: string): void;
  /** Stop whatever is being said, because it is no longer the thing to say. */
  hush(): void;
}

export interface Voice {
  /**
   * Say a tip if it is worth saying now, given the time in seconds.
   *
   * Called every frame with whatever is on screen, so the rules about not
   * repeating live in here rather than in the caller.
   */
  update(tip: Tip | null, now: number): void;
  /** Turn it on or off, and say which it now is. */
  toggle(): boolean;
  readonly speaking: boolean;
}

/**
 * How long before the same words are worth saying again, in seconds.
 *
 * The cautions are the reason there is a number here at all. "Pull up" comes
 * on and off as the bird crosses ten metres, and a voice that said it every
 * time would be saying it four times in a straight line. Eight seconds is
 * long enough that hearing it twice means something has actually gone wrong
 * twice.
 */
const REPEAT_AFTER = 8;

export function createVoice(speaker: Speaker, repeatAfter = REPEAT_AFTER): Voice {
  /** When each phrase was last said. */
  const said = new Map<string, number>();
  let showing: string | null = null;
  let on = true;

  return {
    update(tip, now) {
      const words = tip?.text ?? null;
      if (words === showing) return;
      showing = words;
      if (!on || words === null) return;

      const before = said.get(words);
      if (before !== undefined && now - before < repeatAfter) return;
      said.set(words, now);

      // Whatever was being said is out of date the moment something else is
      // on screen: an instruction is about now, and a queue of them would be
      // a voice describing a flight that has already happened.
      speaker.hush();
      speaker.say(words);
    },
    toggle() {
      on = !on;
      if (!on) speaker.hush();
      // Forgotten either way, so turning it back on starts a fresh flight
      // rather than a silence full of things it has already said.
      said.clear();
      showing = null;
      return on;
    },
    get speaking() {
      return on;
    },
  };
}

/**
 * The browser's own synthesiser, wrapped down to two methods.
 *
 * Voices load asynchronously and some browsers hand back an empty list until
 * they have, so the choice is made afresh each time rather than cached: it is
 * a lookup through a handful of entries, once per thing said.
 */
export function browserSpeaker(synth: SpeechSynthesis): Speaker {
  return {
    say(words) {
      // Cancelled here as well as by the caller, and not as a belt-and-braces
      // flourish: `speak` queues rather than replaces, and `cancel` clears
      // the queue. Anything that reaches this without a cancel first is a
      // second voice talking over the first, which is worse than silence --
      // two instructions at once are no instructions at all.
      synth.cancel();

      const utterance = new SpeechSynthesisUtterance(words);
      const english = synth.getVoices().find((voice) => voice.lang.startsWith('en'));
      if (english) utterance.voice = english;
      // Slower than reading pace rather than faster. The first version was at
      // 1.15 on the theory that these are called out rather than read; said
      // aloud over a wingbeat, that is a voice you have to concentrate on,
      // and concentrating is what the speech was there to save.
      utterance.rate = 0.8;
      utterance.pitch = 1.05;
      synth.speak(utterance);
    },
    hush() {
      synth.cancel();
    },
  };
}
