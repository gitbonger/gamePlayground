/**
 * Playing the music, one note at a time.
 *
 * There is no recording here and no soundfont. What is on disk is a few
 * kilobytes of MIDI -- the notes, and nothing about how they sound -- and
 * this is the instrument: a handful of oscillator voices chosen off the
 * General MIDI instrument number, an envelope on each note, and a room to put
 * them in.
 *
 * Which is exactly what the machines this game is dressed as did. It will not
 * be mistaken for an orchestra. What it buys instead is the thing a recording
 * cannot do: the piece is still a score at the moment it is played, so it can
 * be taken faster, or have the drums brought in, or be swapped for another
 * one on the beat -- when the crows lock on, rather than eight bars later.
 */

import { audio, noiseBuffer } from './audio';
import { readSong, type Note, type Song } from './midi';

/**
 * Every piece in the folder beside this one, by name.
 *
 * Same arrangement as the sound effects: the folder is the list. Drop a MIDI
 * file into `music/` and it is a piece the game can play.
 */
const FILES = import.meta.glob('./music/*.mid', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export const pieces = (): string[] =>
  Object.keys(FILES)
    .map((path) => path.slice(path.lastIndexOf('/') + 1, -4))
    .sort();

const urlOf = (name: string): string | undefined => FILES[`./music/${name}.mid`];

/**
 * How a family of instruments is made out of oscillators.
 *
 * The fields are the ordinary ones: a waveform, an envelope, and how bright
 * the filter lets it be. `detune` is the useful one -- two of the same
 * oscillator a few cents apart beat against each other, and that beating is
 * most of the difference between a synthesiser pad and a single rude buzz.
 */
interface Patch {
  wave: OscillatorType;
  /** Cents between the two oscillators, or zero to run only one. */
  detune: number;
  attack: number;
  decay: number;
  /** Fraction of the peak held while the note is down. */
  sustain: number;
  release: number;
  /** Filter cutoff as a multiple of the note's own frequency. */
  brightness: number;
  /** Trim, because a sawtooth pad and a sine bell are not the same size. */
  gain: number;
  /** Depth of a slow wobble on the pitch, in cents. Nought for none. */
  vibrato?: number;
}

/**
 * The General MIDI instruments, in the families the standard groups them in.
 *
 * A hundred and twenty-eight instruments is not a hundred and twenty-eight
 * sounds anybody is going to write here. The families are what the numbering
 * is *for*: 32 to 39 is where every bass lives, 88 to 95 is where every pad
 * lives, and a file that asks for 33 wants something low and round whatever
 * else is true. Anything unrecognised comes out as the plucked one, which is
 * the least wrong thing to be wrong as.
 */
const FAMILIES: { upTo: number; patch: Patch }[] = [
  // Piano, and tuned percussion.
  { upTo: 15, patch: { wave: 'triangle', detune: 0, attack: 0.005, decay: 1.4,
                       sustain: 0.05, release: 0.3, brightness: 7, gain: 0.9 } },
  // Organ: no decay at all, which is what an organ is.
  { upTo: 23, patch: { wave: 'square', detune: 4, attack: 0.02, decay: 0.1,
                       sustain: 0.85, release: 0.12, brightness: 5, gain: 0.5 } },
  // Guitar.
  { upTo: 31, patch: { wave: 'sawtooth', detune: 6, attack: 0.005, decay: 0.7,
                       sustain: 0.12, release: 0.25, brightness: 4, gain: 0.7 } },
  // Bass. Darker than everything and allowed to be the loudest.
  { upTo: 39, patch: { wave: 'sawtooth', detune: 0, attack: 0.008, decay: 0.9,
                       sustain: 0.45, release: 0.18, brightness: 2.5, gain: 1.1 } },
  // Strings and ensembles: slow on, slow off, and detuned enough to be more
  // than one player.
  { upTo: 55, patch: { wave: 'sawtooth', detune: 9, attack: 0.22, decay: 0.6,
                       sustain: 0.8, release: 0.5, brightness: 3.5, gain: 0.5 } },
  // Brass.
  { upTo: 63, patch: { wave: 'sawtooth', detune: 5, attack: 0.05, decay: 0.3,
                       sustain: 0.7, release: 0.2, brightness: 4.5, gain: 0.6 } },
  // Reeds and pipes -- the flute the melodies are written for. A little
  // wobble, because a held wind note that does not move sounds like a test
  // tone.
  { upTo: 79, patch: { wave: 'triangle', detune: 3, attack: 0.07, decay: 0.4,
                       sustain: 0.85, release: 0.28, brightness: 6, gain: 0.85,
                       vibrato: 9 } },
  // Synth leads.
  { upTo: 87, patch: { wave: 'square', detune: 7, attack: 0.02, decay: 0.35,
                       sustain: 0.7, release: 0.2, brightness: 5, gain: 0.5 } },
  // Synth pads: the long slow one that sits under everything.
  { upTo: 95, patch: { wave: 'sawtooth', detune: 12, attack: 0.6, decay: 1,
                       sustain: 0.85, release: 1.2, brightness: 2.8, gain: 0.4 } },
];

const PLUCKED: Patch = { wave: 'triangle', detune: 0, attack: 0.004, decay: 0.5,
                         sustain: 0.02, release: 0.2, brightness: 6, gain: 0.8 };

const patchFor = (program: number): Patch =>
  FAMILIES.find((family) => program <= family.upTo)?.patch ?? PLUCKED;

/** A note number as a frequency. 69 is the A above middle C, at 440 Hz. */
const hz = (key: number): number => 440 * 2 ** ((key - 69) / 12);

/**
 * How a drum is made. Channel ten's note number picks the instrument rather
 * than the pitch, and these are the few the game's own pieces use -- a kick,
 * a snare, and hats.
 */
interface Drum {
  /** A pitched thump: from this frequency down to `to` over `sweep` seconds. */
  from?: number;
  to?: number;
  sweep?: number;
  /** A burst of noise through a filter. */
  band?: number;
  q?: number;
  highpass?: boolean;
  length: number;
  gain: number;
}

const DRUMS: Record<number, Drum> = {
  35: { from: 130, to: 42, sweep: 0.1, length: 0.4, gain: 1 },
  36: { from: 140, to: 45, sweep: 0.09, length: 0.35, gain: 1 },
  38: { band: 1900, q: 0.8, length: 0.16, gain: 0.5 },
  40: { band: 2200, q: 0.8, length: 0.14, gain: 0.5 },
  42: { band: 8000, q: 0.7, highpass: true, length: 0.05, gain: 0.28 },
  44: { band: 8000, q: 0.7, highpass: true, length: 0.05, gain: 0.22 },
  46: { band: 7000, q: 0.6, highpass: true, length: 0.32, gain: 0.26 },
  49: { band: 5000, q: 0.4, highpass: true, length: 0.9, gain: 0.3 },
  51: { band: 7500, q: 0.5, highpass: true, length: 0.7, gain: 0.24 },
};

/**
 * A room, as a made-up impulse response.
 *
 * Two seconds of noise fading out exponentially, which is a crude but honest
 * description of a small hall, convolved with everything. It matters more
 * than any of the voices above: oscillators with no room around them sound
 * like a circuit rather than like music, and this is the cheapest thing that
 * fixes that.
 */
function makeRoom(ctx: AudioContext, seconds = 1.9, decay = 3.2): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const room = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = room.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay;
    }
  }
  return room;
}

/** How far ahead notes are handed to the audio clock, in seconds. */
const LOOKAHEAD = 0.4;
/** How often the scheduler wakes up. Well inside the lookahead. */
const EVERY = 90;
/** Seconds to fade between two pieces. */
const CHANGES_OVER = 1.5;

export interface Music {
  /**
   * Play a piece by name, fading out whatever was on.
   *
   * Playing the piece that is already on does nothing, so this can be called
   * every frame with whatever the level wants -- which is the point, and is
   * how it will end up being driven.
   */
  play(name: string | null): void;
  /** How loud, 0 to 1, ramped. For ducking under a warning. */
  level(loud: number): void;
  stop(): void;
  readonly playing: string | null;
}

/**
 * `into` is where the music ends up, and defaults to the speakers. It exists
 * so that `dev/music.html` can hang a meter off the output -- which is the
 * only way anybody without ears can tell whether this works.
 */
export function createMusic(
  volume = 0.32,
  into: (ctx: AudioContext) => AudioNode = (ctx) => ctx.destination,
): Music {
  const loaded = new Map<string, Song>();
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let wet: GainNode | null = null;
  let room: ConvolverNode | null = null;

  /** The piece being played, and the machinery keeping it going. */
  let now: {
    name: string;
    song: Song;
    out: GainNode;
    /** Context time that the current time round the piece started at. */
    from: number;
    /** How far down the note list this loop has been scheduled. */
    next: number;
  } | null = null;
  let wanted: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let loud = 1;

  function build(): AudioContext {
    const made = audio();
    if (ctx !== made || !master) {
      ctx = made;
      master = made.createGain();
      master.gain.value = volume * loud;
      room = made.createConvolver();
      room.buffer = makeRoom(made);
      wet = made.createGain();
      wet.gain.value = 0.3;
      const out = into(made);
      master.connect(out);
      master.connect(wet).connect(room).connect(out);
    }
    return made;
  }

  /** One note, as however many oscillators and filters that takes. */
  function sound(at: number, note: Note, into: GainNode): void {
    const ctx_ = ctx!;
    const level = (note.velocity / 127) ** 1.4;

    if (note.channel === 9) {
      const drum = DRUMS[note.key];
      if (!drum) return;
      const gain = ctx_.createGain();
      gain.gain.setValueAtTime(drum.gain * level, at);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + drum.length);
      gain.connect(into);
      if (drum.from !== undefined) {
        // A thump is a pitch falling fast: that fall is the whole sound, and
        // a kick without it is a click.
        const osc = ctx_.createOscillator();
        osc.frequency.setValueAtTime(drum.from, at);
        osc.frequency.exponentialRampToValueAtTime(drum.to ?? 40, at + (drum.sweep ?? 0.1));
        osc.connect(gain);
        osc.start(at);
        osc.stop(at + drum.length + 0.02);
      } else {
        const source = ctx_.createBufferSource();
        source.buffer = noiseBuffer(ctx_);
        source.loop = true;
        const filter = ctx_.createBiquadFilter();
        filter.type = drum.highpass ? 'highpass' : 'bandpass';
        filter.frequency.value = drum.band ?? 2000;
        filter.Q.value = drum.q ?? 1;
        source.connect(filter).connect(gain);
        source.start(at);
        source.stop(at + drum.length + 0.02);
      }
      return;
    }

    const patch = patchFor(note.program);
    const frequency = hz(note.key);
    const until = at + note.length;

    const gain = ctx_.createGain();
    const peak = patch.gain * level;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + patch.attack);
    gain.gain.setTargetAtTime(peak * patch.sustain, at + patch.attack, patch.decay / 3);
    // Released where the note ends rather than decayed to nothing: a pad has
    // to still be there when the bar changes.
    gain.gain.setTargetAtTime(0, until, patch.release / 3);

    const filter = ctx_.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.6;
    // Bright at the front and darker as it dies away, which is what a struck
    // or blown thing does and is worth more than any of the waveforms.
    filter.frequency.setValueAtTime(Math.min(16000, frequency * patch.brightness * 1.6), at);
    filter.frequency.setTargetAtTime(
      Math.min(16000, frequency * patch.brightness),
      at + patch.attack,
      Math.max(0.05, patch.decay),
    );
    filter.connect(gain).connect(into);

    const stopAt = until + patch.release * 2 + 0.05;
    const detunes = patch.detune ? [-patch.detune, patch.detune] : [0];
    for (const cents of detunes) {
      const osc = ctx_.createOscillator();
      osc.type = patch.wave;
      osc.frequency.value = frequency;
      osc.detune.value = cents;
      if (patch.vibrato) {
        // Late, and shallow. A wobble that starts with the note is a siren.
        const wobble = ctx_.createOscillator();
        wobble.frequency.value = 5.2;
        const depth = ctx_.createGain();
        depth.gain.setValueAtTime(0, at);
        depth.gain.linearRampToValueAtTime(patch.vibrato, at + 0.35);
        wobble.connect(depth).connect(osc.detune);
        wobble.start(at);
        wobble.stop(stopAt);
      }
      osc.connect(filter);
      osc.start(at);
      osc.stop(stopAt);
    }
  }

  /** Hand the audio clock everything that starts in the next `LOOKAHEAD`. */
  function fill(): void {
    if (!now || !ctx) return;
    const until = ctx.currentTime + LOOKAHEAD;
    for (;;) {
      const note = now.song.notes[now.next];
      if (note && now.from + note.at < until) {
        sound(now.from + note.at, note, now.out);
        now.next += 1;
        continue;
      }
      if (note) return;
      // Round again. The loop point is the piece's length rather than its
      // last note-off, so a bar that ends in silence keeps its silence.
      if (now.from + now.song.length >= until) return;
      now.from += now.song.length;
      now.next = 0;
    }
  }

  function begin(name: string, song: Song): void {
    const made = build();
    const out = made.createGain();
    out.gain.setValueAtTime(0, made.currentTime);
    out.gain.linearRampToValueAtTime(1, made.currentTime + CHANGES_OVER);
    out.connect(master!);
    // A beat's grace before the first note, so that a piece started from a
    // key press does not begin in the middle of the press.
    now = { name, song, out, from: made.currentTime + 0.15, next: 0 };
    fill();
    timer ??= setInterval(fill, EVERY);
  }

  function fade(): void {
    if (!now || !ctx) return;
    const going = now;
    going.out.gain.cancelScheduledValues(ctx.currentTime);
    going.out.gain.setValueAtTime(going.out.gain.value, ctx.currentTime);
    going.out.gain.linearRampToValueAtTime(0, ctx.currentTime + CHANGES_OVER);
    setTimeout(() => going.out.disconnect(), (CHANGES_OVER + 0.2) * 1000);
    now = null;
  }

  return {
    play(name) {
      if (name === wanted) return;
      wanted = name;
      fade();
      if (name === null) return;
      const url = urlOf(name);
      if (!url) return;

      const already = loaded.get(name);
      if (already) {
        begin(name, already);
        return;
      }
      void fetch(url)
        .then((r) => r.arrayBuffer())
        .then((bytes) => {
          const song = readSong(bytes);
          loaded.set(name, song);
          // Only if it is still the piece that is wanted: two changes in
          // under a second would otherwise start the first one late.
          if (wanted === name) begin(name, song);
        })
        // A piece that will not parse is a game without music, not a game
        // with a stack trace over it.
        .catch(() => {});
    },
    level(next) {
      loud = Math.max(0, Math.min(1, next));
      if (ctx && master) master.gain.setTargetAtTime(volume * loud, ctx.currentTime, 0.3);
    },
    stop() {
      wanted = null;
      fade();
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
    get playing() {
      return now?.name ?? null;
    },
  };
}
