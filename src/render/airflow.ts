/**
 * The air going past, as a sound.
 *
 * Every other noise in this game is an event -- a bark, a bell, a tram --
 * and this is the only one that is a state. It is the loudest thing a bird
 * hears and the one nobody notices until it is missing: four hundred
 * kilometres an hour in silence is a picture of speed rather than speed, and
 * no amount of camera work covers for it.
 *
 * Noise through two filters, and nothing else. A band-pass for the body of
 * it, which is what a wing makes, and a low-pass over the top that opens as
 * he goes faster -- because what changes with speed is not only how loud the
 * air is but how bright: a glide is a hush, a dive is a hiss. Both are driven
 * off one number, the airspeed, and both are moved towards their target
 * rather than set, so a gust in the flight model is not a click in the ears.
 *
 * It costs one buffer source that runs for the life of the page. Starting and
 * stopping it with the speed would be a click every time, and a sound that is
 * silent is free.
 */

import { audio, noiseBuffer } from './audio';

export interface Airflow {
  /** Airspeed in m/s, and how much of a frame has passed. */
  hear(speed: number, dt: number): void;
  /** Off entirely: the flight is over, or nobody is flying. */
  hush(): void;
  stop(): void;
}

/**
 * Where it starts and where it is as loud as it gets, in m/s.
 *
 * Six is a pigeon flying about: there is air going past and you can hear it.
 * Fifty-five is about where the rocket leaves him, and beyond that it gets no
 * louder -- a sound that grows for ever is a sound with no scale in it.
 */
const FROM = 6;
const FULL = 55;

/** How loud it ever gets, against everything else in the mix. */
const LOUDEST = 0.19;

/** How fast the level and the brightness follow the speed, as a half-life. */
const FOLLOWS = 0.22;

/**
 * How much of the way from a glide to a dive a speed is, nought to one.
 *
 * Its own function because it is the whole of what this thing decides: the
 * rest is filters. Six metres a second is a pigeon flying about, fifty-five
 * is where the rocket leaves him, and over that it gets no louder.
 */
export const airRush = (speed: number): number =>
  Math.min(1, Math.max(0, (speed - FROM) / (FULL - FROM)));

/** How loud it is at a speed, and how far open: what `hear` moves towards. */
export const airVoice = (speed: number): { level: number; bright: number } => {
  const rush = airRush(speed);
  // Squared, because the first half of the range is a bird flying and should
  // stay under everything else in the mix.
  return { level: rush * rush * LOUDEST, bright: rush };
};

export function createAirflow(): Airflow {
  let parts: {
    ctx: AudioContext;
    source: AudioBufferSourceNode;
    body: BiquadFilterNode;
    open: BiquadFilterNode;
    out: GainNode;
  } | null = null;

  /** What is being played now, followed towards what the speed asks for. */
  let level = 0;
  let bright = 0;

  const start = () => {
    if (parts) return parts;
    const ctx = audio();
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(ctx);
    source.loop = true;

    // The body of it: a broad band around a kilohertz, which is where moving
    // air sits. Narrower than this and it whistles like a kettle.
    const body = ctx.createBiquadFilter();
    body.type = 'bandpass';
    body.frequency.value = 900;
    body.Q.value = 0.55;

    // And the lid, which is what opens with speed.
    const open = ctx.createBiquadFilter();
    open.type = 'lowpass';
    open.frequency.value = 400;
    open.Q.value = 0.0001;

    const out = ctx.createGain();
    out.gain.value = 0;

    source.connect(body).connect(open).connect(out).connect(ctx.destination);
    source.start();
    parts = { ctx, source, body, open, out };
    return parts;
  };

  return {
    hear(speed, dt) {
      const wants = airRush(speed);
      const wantsLevel = airVoice(speed).level;
      const follow = dt > 0 ? 1 - Math.pow(2, -dt / FOLLOWS) : 1;
      level += (wantsLevel - level) * follow;
      bright += (wants - bright) * follow;

      // Nothing is opened until there is something to hear. A context made
      // before the player has touched anything is a suspended context, and
      // silence does not need one.
      if (level < 0.0005 && !parts) return;
      const { ctx, open, out } = start();
      const now = ctx.currentTime;
      out.gain.setTargetAtTime(level, now, 0.05);
      // Four hundred hertz at a glide, four thousand at full tilt: the same
      // air, heard through a door that opens.
      open.frequency.setTargetAtTime(400 + 3600 * bright, now, 0.05);
    },
    hush() {
      level = 0;
      bright = 0;
      if (!parts) return;
      parts.out.gain.setTargetAtTime(0, parts.ctx.currentTime, 0.08);
    },
    stop() {
      if (!parts) return;
      parts.source.stop();
      parts.source.disconnect();
      parts.out.disconnect();
      parts = null;
      level = 0;
      bright = 0;
    },
  };
}
