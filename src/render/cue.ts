/**
 * A note when an instruction appears, saying what kind it is.
 *
 * The panel holds one thing at a time and the player is flying, which is to
 * say looking somewhere else. What reaches them before they have read a word
 * is a colour and a note -- so the note has to be worth something, and the
 * only way it is worth something is if it means the same thing every time.
 *
 * Three of them, and they are meant to be told apart with no training at all:
 * `survival` goes up and is sharp, because up is a question and sharp is
 * urgent; `story` is a soft two-note fall, the shape of somebody saying
 * something; `hint` is one short soft tick that could be ignored, and is
 * meant to be ignorable. A player who learns one of these learns the one
 * that matters.
 *
 * Quieter than the crow alarm on purpose. That one is about something coming
 * at you now; these are about a panel.
 */

export type Sort = 'survival' | 'story' | 'hint';

/** Whatever makes the noise, so a test does not need an audio card. */
export interface Chime {
  play(sort: Sort): void;
  close(): void;
}

export interface Cue {
  /** Sound the note for a kind of instruction. */
  sound(sort: Sort): void;
  dispose(): void;
}

export function createCue(chime: Chime): Cue {
  return {
    sound(sort) {
      chime.play(sort);
    },
    dispose() {
      chime.close();
    },
  };
}

/** Each note: the tones in order, how long each is, and how loud. */
const NOTES: Record<Sort, { tones: readonly number[]; blip: number; loud: number }> = {
  // Up, and quick. Two notes rising is the one shape nothing else here makes.
  survival: { tones: [740, 1108], blip: 0.075, loud: 0.13 },
  // Down, and softer: the cadence of a sentence ending.
  story: { tones: [659, 494], blip: 0.13, loud: 0.075 },
  // One tick. Short enough to be missed, which is the point of it.
  hint: { tones: [880], blip: 0.05, loud: 0.05 },
};

export function browserChime(): Chime {
  let ctx: AudioContext | null = null;
  return {
    play(sort) {
      ctx ??= new AudioContext();
      void ctx.resume();
      const audio = ctx;
      const now = audio.currentTime;
      const note = NOTES[sort];
      note.tones.forEach((hz, i) => {
        const at = now + i * (note.blip + 0.03);
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        // Triangle rather than the warning's square: these are notes, not
        // alarms, and a square wave at this rate would be a machine.
        osc.type = sort === 'survival' ? 'square' : 'triangle';
        osc.frequency.value = hz;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(note.loud, at + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + note.blip);
        osc.connect(gain).connect(audio.destination);
        osc.start(at);
        osc.stop(at + note.blip + 0.02);
      });
    },
    close() {
      void ctx?.close();
      ctx = null;
    },
  };
}
