/**
 * Reading a MIDI file.
 *
 * A MIDI file is not a recording. It is a list of instructions -- this note
 * on, that one off, and the tempo is now this -- which is why a piece of it
 * is a couple of kilobytes where a recording of the same piece is fifteen
 * megabytes, and why the thing playing it can take it faster, put it in
 * another mode or leave a part out at the moment something happens on screen.
 * A recording can only be faded into and out of.
 *
 * What comes out of here is deliberately dull: a flat list of notes with
 * their times already worked out in seconds. Everything about *how* a note
 * sounds belongs to the synthesiser next door -- this only says what and
 * when.
 *
 * Standard MIDI Files, formats 0 and 1. Format 2 is a set of unrelated
 * sequences rather than one piece and nothing writes it.
 */

/** One note, with the file's ticks and tempo changes already resolved away. */
export interface Note {
  /** Seconds from the start of the piece. */
  at: number;
  /** How long it is held, in seconds. */
  length: number;
  /** MIDI note number: 60 is middle C, and each step is a semitone. */
  key: number;
  /** 1..127. What the player does with it is the synthesiser's business. */
  velocity: number;
  /** 0..15. Ten (that is, index 9) is percussion by long convention. */
  channel: number;
  /**
   * The General MIDI instrument in force on that channel when the note began.
   *
   * Kept per note rather than per channel because a file is allowed to change
   * instrument halfway through, and because it is what the synthesiser
   * chooses a voice by.
   */
  program: number;
}

export interface Song {
  notes: Note[];
  /** To the end of the last note, in seconds. */
  length: number;
  /** Beats per minute at the start, which is what a piece is looped on. */
  bpm: number;
}

/** A reader over the bytes, because every one of these is read in order. */
class Reader {
  at = 0;
  constructor(readonly bytes: Uint8Array) {}

  u8(): number {
    const b = this.bytes[this.at++];
    if (b === undefined) throw new Error('MIDI: ran off the end');
    return b;
  }

  u16(): number {
    return (this.u8() << 8) | this.u8();
  }

  u32(): number {
    return ((this.u16() << 16) | this.u16()) >>> 0;
  }

  text(n: number): string {
    let out = '';
    for (let i = 0; i < n; i += 1) out += String.fromCharCode(this.u8());
    return out;
  }

  /**
   * A variable-length quantity: seven bits a byte, high bit set on every byte
   * but the last. Every delta time in a MIDI file is one of these, which is
   * how a file can say "now" in one byte and "in four bars" in two.
   */
  vlq(): number {
    let value = 0;
    for (;;) {
      const b = this.u8();
      value = (value << 7) | (b & 0x7f);
      if ((b & 0x80) === 0) return value;
    }
  }
}

/** The default tempo when a file never says: 120 bpm, half a second a beat. */
const DEFAULT_US_PER_BEAT = 500_000;

/** An event on one track, still in ticks. */
interface Timed {
  tick: number;
  data: number[];
}

function readTrack(read: Reader, length: number): Timed[] {
  const end = read.at + length;
  const out: Timed[] = [];
  let tick = 0;
  /**
   * Running status: a file may leave the status byte off when it is the same
   * as the last one, which is most of them -- a run of notes on one channel
   * is a status byte and then two bytes a note.
   */
  let status = 0;

  while (read.at < end) {
    tick += read.vlq();
    let byte = read.u8();
    if (byte < 0x80) {
      // No status byte: it is the one before, and this was the first data
      // byte.
      read.at -= 1;
      byte = status;
    } else if (byte < 0xf0) {
      status = byte;
    }

    if (byte === 0xff) {
      const kind = read.u8();
      const size = read.vlq();
      const data = [...read.bytes.slice(read.at, read.at + size)];
      read.at += size;
      out.push({ tick, data: [0xff, kind, ...data] });
    } else if (byte === 0xf0 || byte === 0xf7) {
      // A sysex message, which is somebody's synthesiser talking to itself.
      read.at += read.vlq();
    } else {
      const kind = byte & 0xf0;
      // Programme change and channel pressure carry one byte; everything else
      // carries two.
      const carries = kind === 0xc0 || kind === 0xd0 ? 1 : 2;
      const data = [byte];
      for (let i = 0; i < carries; i += 1) data.push(read.u8());
      out.push({ tick, data });
    }
  }
  read.at = end;
  return out;
}

export function readSong(bytes: ArrayBuffer | Uint8Array): Song {
  const read = new Reader(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));

  if (read.text(4) !== 'MThd') throw new Error('MIDI: not a MIDI file');
  const headerLength = read.u32();
  const format = read.u16();
  read.u16(); // how many tracks the header claims; the chunks are counted instead
  const division = read.u16();
  read.at += headerLength - 6;

  if (format === 2) throw new Error('MIDI: format 2 is a set of pieces, not a piece');
  // The other division is SMPTE, which counts in film frames rather than in
  // beats. Nothing that writes music uses it.
  if (division & 0x8000) throw new Error('MIDI: timecode division is not supported');
  const ticksPerBeat = division;

  // Every track, laid on top of each other. In format 1 the parts are
  // separate tracks meant to sound together, and in format 0 there is one
  // track with everything in it -- merging covers both without asking.
  const events: Timed[] = [];
  while (read.at + 8 <= read.bytes.length) {
    const kind = read.text(4);
    const length = read.u32();
    if (kind !== 'MTrk') {
      read.at += length;
      continue;
    }
    events.push(...readTrack(read, length));
  }
  // Stable by tick: a note-off and a note-on at the same instant have to keep
  // the order the file put them in, or a repeated note eats itself.
  events.sort((a, b) => a.tick - b.tick);

  /**
   * Tick to seconds. Tempo can change mid-piece, so this walks the tempo
   * changes and accumulates -- the sum of each stretch at the rate that was
   * in force across it.
   */
  const tempos: { tick: number; usPerBeat: number }[] = [];
  for (const event of events) {
    if (event.data[0] === 0xff && event.data[1] === 0x51) {
      const [, , a = 0, b = 0, c = 0] = event.data;
      tempos.push({ tick: event.tick, usPerBeat: (a << 16) | (b << 8) | c });
    }
  }
  if (tempos[0]?.tick !== 0) tempos.unshift({ tick: 0, usPerBeat: DEFAULT_US_PER_BEAT });

  const seconds = (tick: number): number => {
    let total = 0;
    for (let i = 0; i < tempos.length; i += 1) {
      const from = tempos[i]!;
      if (from.tick >= tick) break;
      const to = tempos[i + 1];
      const until = to && to.tick < tick ? to.tick : tick;
      total += ((until - from.tick) / ticksPerBeat) * (from.usPerBeat / 1e6);
    }
    return total;
  };

  const programs = new Array<number>(16).fill(0);
  /** Notes waiting for their off, keyed by channel and note number. */
  const sounding = new Map<number, Note>();
  const notes: Note[] = [];

  const release = (channel: number, key: number, tick: number) => {
    const held = sounding.get(channel * 128 + key);
    if (!held) return;
    sounding.delete(channel * 128 + key);
    held.length = Math.max(0.02, seconds(tick) - held.at);
    notes.push(held);
  };

  for (const event of events) {
    const [byte = 0, one = 0, two = 0] = event.data;
    const kind = byte & 0xf0;
    const channel = byte & 0x0f;
    if (kind === 0xc0) {
      programs[channel] = one;
    } else if (kind === 0x80 || (kind === 0x90 && two === 0)) {
      // A note-on with no velocity is a note-off. Files written by hand use
      // the real one; files written by sequencers mostly do this.
      release(channel, one, event.tick);
    } else if (kind === 0x90) {
      // A second on for a note already down ends the first: two of the same
      // note at once is one note as far as anything can hear.
      release(channel, one, event.tick);
      sounding.set(channel * 128 + one, {
        at: seconds(event.tick),
        length: 0,
        key: one,
        velocity: two,
        channel,
        program: programs[channel] ?? 0,
      });
    }
  }
  // Anything still down when the file stops is stopped there.
  const last = events[events.length - 1]?.tick ?? 0;
  for (const key of [...sounding.keys()]) release(Math.floor(key / 128), key % 128, last);

  notes.sort((a, b) => a.at - b.at);
  return {
    notes,
    length: notes.reduce((end, note) => Math.max(end, note.at + note.length), 0),
    bpm: 60 / ((tempos[0]?.usPerBeat ?? DEFAULT_US_PER_BEAT) / 1e6),
  };
}
