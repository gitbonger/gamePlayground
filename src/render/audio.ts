/**
 * The one audio context, opened on the first noise anybody makes.
 *
 * Not at startup, and this is the reason: a context built before the player
 * has touched the keyboard is a suspended one, browsers count that against
 * the page, and the first thing it would do on waking is play whatever was
 * queued while it was asleep. Opening it on the first sound means it is only
 * ever opened by something the player did.
 *
 * One rather than several because a context is a hardware stream. The city,
 * the warning and the music are three parts of one soundtrack, and three
 * streams is three lots of latency and three chances for a browser to decide
 * one of them is not important.
 */

let open: AudioContext | null = null;

/** The context, made if it is not there yet, and nudged if it has been parked. */
export function audio(): AudioContext {
  open ??= new AudioContext();
  void open.resume();
  return open;
}

/** The context if something has already opened one, and null otherwise. */
export const audioIfOpen = (): AudioContext | null => open;

export function closeAudio(): void {
  void open?.close();
  open = null;
}

/**
 * A second of white noise, made once and shared.
 *
 * Every rough sound in the game is a filtered slice of this: wheels, a rasp
 * in a bark, a snare, a hi-hat. Making it per sound was measurably silly --
 * a second of noise is a hundred thousand calls to `Math.random` and they
 * were being paid every time a dog barked.
 */
let hiss: AudioBuffer | null = null;

export function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (hiss && hiss.sampleRate === ctx.sampleRate) return hiss;
  const made = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = made.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  hiss = made;
  return made;
}
