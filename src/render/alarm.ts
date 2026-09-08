/**
 * A two-tone warning, for the one thing in the game that is hunting you.
 *
 * Not the voice. The voice reads an instruction, which takes as long as the
 * instruction is -- `Varjak! Repülj alacsonyan!` is most of a second -- and a
 * crow that has locked on is a thing you need to know about now and go on
 * knowing about. So: two short tones, the shape a cockpit warning is, said
 * again while the thing is still true.
 *
 * Built on an oscillator rather than a file. It is two beeps; a file would be
 * a download, a decode and a format question, and none of those buys anything
 * a hundred and eighty milliseconds of square wave does not already have.
 */

/** The two tones, in hertz. A fourth apart, which is what an alert sounds like. */
const TONES = [1046.5, 784];
/** How long each is, in seconds, and the gap between them. */
const BLIP = 0.09;
const GAP = 0.06;

/**
 * How long before it will sound again, in seconds.
 *
 * Two and a half. Long enough that a crow following you for twenty seconds is
 * eight warnings rather than a siren, short enough that it is plainly still
 * happening. A warning nobody can bear is a warning that gets muted, and then
 * it is not there for the one that mattered -- the same reason the voice only
 * reads what kills you.
 */
const AGAIN = 2.5;

export interface Alarm {
  /**
   * Sound it, if it has not sounded lately. `now` is the world's own clock.
   *
   * Given the clock rather than reading one, so that a game held on a beat or
   * paused between levels does not tick the warning along behind the scenes.
   */
  sound(now: number): void;
  dispose(): void;
}

/** Whatever actually makes the noise, so a test does not need an audio card. */
export interface Tone {
  play(tones: readonly number[], blip: number, gap: number): void;
  close(): void;
}

/**
 * The browser's own, made on the first warning rather than at startup.
 *
 * An `AudioContext` made before anybody has touched the keyboard is a
 * suspended `AudioContext`, and browsers count that against the page. This
 * one is built the first time something is actually worth hearing, by which
 * point the player has certainly pressed a key.
 */
export function browserTone(): Tone {
  let ctx: AudioContext | null = null;
  return {
    play(tones, blip, gap) {
      ctx ??= new AudioContext();
      // Resumed every time: a tab that has been in the background comes back
      // suspended, and the first warning after that would otherwise be silent.
      void ctx.resume();
      const start = ctx.currentTime;
      tones.forEach((hz, i) => {
        const at = start + i * (blip + gap);
        const osc = ctx!.createOscillator();
        const gain = ctx!.createGain();
        // Square, because it has to be heard over whatever else is going on
        // and because it is the sound the thing being imitated makes.
        osc.type = 'square';
        osc.frequency.value = hz;
        // An envelope rather than a bare on and off, which clicks: the click
        // is the loudest part of a bare tone and the least like a warning.
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.14, at + 0.008);
        gain.gain.setValueAtTime(0.14, at + blip - 0.02);
        gain.gain.linearRampToValueAtTime(0, at + blip);
        osc.connect(gain).connect(ctx!.destination);
        osc.start(at);
        osc.stop(at + blip + 0.01);
      });
    },
    close() {
      void ctx?.close();
      ctx = null;
    },
  };
}

export function createAlarm(tone: Tone, again = AGAIN): Alarm {
  let last = -Infinity;
  return {
    sound(now) {
      if (now - last < again) return;
      last = now;
      tone.play(TONES, BLIP, GAP);
    },
    dispose() {
      tone.close();
    },
  };
}
