import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSong, type Song } from './midi';

const song = (name: string): Song =>
  readSong(readFileSync(new URL(`./music/${name}.mid`, import.meta.url)));

describe('reading a MIDI file', () => {
  it('reads the pieces the game ships', () => {
    for (const name of ['rooftops', 'crows', 'home']) {
      const piece = song(name);
      expect(piece.notes.length, name).toBeGreaterThan(40);
      expect(piece.length, name).toBeGreaterThan(10);
      // Nothing outside the piano's range: a parser that has lost its place
      // in the byte stream produces notes at 3 and at 126.
      for (const note of piece.notes) {
        expect(note.key, `${name} ${note.at}`).toBeGreaterThan(20);
        expect(note.key, `${name} ${note.at}`).toBeLessThan(108);
        expect(note.length).toBeGreaterThan(0);
      }
    }
  });

  it('gets the tempo off the file rather than assuming one', () => {
    expect(song('rooftops').bpm).toBeCloseTo(92, 0);
    expect(song('crows').bpm).toBeCloseTo(148, 0);
    expect(song('home').bpm).toBeCloseTo(76, 0);
  });

  it('puts eight bars of four at the tempo written on them', () => {
    // The arithmetic the whole file is for: thirty-two beats at 92 to the
    // minute is twenty and a bit seconds, and if ticks-per-beat or the tempo
    // were being read wrongly this is where it would show.
    expect(song('rooftops').length).toBeCloseTo((32 * 60) / 92, 1);
    expect(song('crows').length).toBeCloseTo((32 * 60) / 148, 1);
  });

  it('keeps the parts on their own channels, drums on ten', () => {
    const crows = song('crows');
    expect(new Set(crows.notes.map((n) => n.channel))).toEqual(new Set([0, 1, 2, 9]));
    // And the drum notes are drums: 36 is a kick, 38 a snare, 42 a hat.
    const drums = crows.notes.filter((n) => n.channel === 9);
    expect(new Set(drums.map((n) => n.key))).toEqual(new Set([36, 38, 42]));
  });

  it('carries the instrument each note was played with', () => {
    const rooftops = song('rooftops');
    const melody = rooftops.notes.filter((n) => n.channel === 0);
    expect(melody.every((n) => n.program === 73)).toBe(true);
  });

  it('refuses a file that is not one', () => {
    expect(() => readSong(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/not a MIDI file/);
  });

  it('reads a note written with running status and a zero-velocity off', () => {
    // Both are what real files do and neither is what ours does, so they are
    // written out here by hand: header, one track, note on at 0, note off a
    // beat later with the status byte left off.
    const bytes = new Uint8Array([
      0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 0x60,
      0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 9,
      0x00, 0x90, 60, 100,
      0x60, 60, 0,
      0x00, 0xff, 0x2f, 0x00,
    ]);
    const piece = readSong(bytes);
    expect(piece.notes).toHaveLength(1);
    expect(piece.notes[0]!.key).toBe(60);
    // 0x60 ticks at 96 to the beat is one beat, and a beat at the assumed
    // 120 bpm is half a second.
    expect(piece.notes[0]!.length).toBeCloseTo(0.5, 3);
  });
});
