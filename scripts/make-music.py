"""
Write the game's music out as MIDI files.

    python3 scripts/make-music.py

Three short pieces into `src/render/music/`, a few kilobytes each. They are
written here rather than recorded because of what the game needs to do with
them: a recording can only be faded into and out of, and the thing worth
having is a chase theme that arrives on the beat the crows do. A score can be
taken faster, put into another mode and have a layer added, at the moment
something happens. None of that is built yet -- this is the part that proves
the pipeline, and what it proves is that a file this small makes a noise.

The notes are written out by hand as scale degrees, not generated. Randomness
inside a bar sounds like randomness inside a bar.
"""

import os, struct

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, 'src', 'render', 'music')
TICKS = 480          # per quarter note, the usual figure

# Modes as semitones above the root. The game is set in Józsefváros and these
# are the modes the folk music of the place actually uses: Dorian for the
# ordinary flights, Phrygian -- with its flat second grinding against the
# root -- for being hunted.
DORIAN =    [0, 2, 3, 5, 7, 9, 10]
PHRYGIAN =  [0, 1, 3, 5, 7, 8, 10]
MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10]


def pitch(mode, root, degree, octave=0):
    """A scale degree as a MIDI note. Degrees run off either end of the mode."""
    step = degree % len(mode)
    over = degree // len(mode)
    return root + mode[step] + 12 * (over + octave)


def chord(mode, root, degree, octave=0, notes=3):
    """A triad (or seventh) built up the mode from `degree`."""
    return [pitch(mode, root, degree + 2 * n, octave) for n in range(notes)]


# ------------------------------------------------------------ writing it out

def vlq(n):
    """A variable-length quantity, which is how MIDI writes every delta time."""
    out = bytearray([n & 0x7F])
    n >>= 7
    while n:
        out.insert(0, (n & 0x7F) | 0x80)
        n >>= 7
    return bytes(out)


def track(events):
    """`events` are (tick, bytes), absolute; deltas and the end marker go on here."""
    events = sorted(events, key=lambda e: e[0])
    body, last = bytearray(), 0
    for at, data in events:
        body += vlq(at - last) + data
        last = at
    body += vlq(0) + b'\xff\x2f\x00'
    return b'MTrk' + struct.pack('>I', len(body)) + bytes(body)


def note_events(channel, notes):
    """(beat, beats, pitch, velocity) into the on and off pair each one is."""
    out = []
    for beat, length, key, velocity in notes:
        at = round(beat * TICKS)
        out.append((at, bytes([0x90 | channel, key, velocity])))
        # A hair short, so that a repeated note is two notes rather than one
        # long one -- the off has to land before the next on.
        out.append((at + max(1, round(length * TICKS) - 8), bytes([0x80 | channel, key, 0])))
    return out


def write(name, bpm, parts):
    """`parts` are (channel, program, notes). Tempo goes on its own track."""
    timing = [(0, b'\xff\x51\x03' + struct.pack('>I', round(60_000_000 / bpm))[1:]),
              (0, b'\xff\x58\x04\x04\x02\x18\x08')]
    chunks = [track(timing)]
    for channel, program, notes in parts:
        events = [(0, bytes([0xC0 | channel, program]))] if channel != 9 else []
        chunks.append(track(events + note_events(channel, notes)))
    head = b'MThd' + struct.pack('>IHHH', 6, 1, len(chunks), TICKS)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    open(path, 'wb').write(head + b''.join(chunks))
    print(f'  {name:16} {os.path.getsize(path):5} bytes  {bpm} bpm')


# ------------------------------------------------------------ the pieces

def over(bars, per_bar=4):
    """Every bar's first beat, for laying a part out over a whole piece."""
    return [bar * per_bar for bar in range(bars)]


def rooftops():
    """
    The ordinary flight. D Dorian, unhurried, four chords going round.

    Dorian rather than plain minor for the major sixth in it -- the B against
    the D -- which is the interval that stops a minor key sounding sad. This
    wants to sound like an afternoon, not like a funeral.
    """
    mode, root = DORIAN, 62          # D
    line = [                          # bar, beat, length, degree
        (0, 0, 2, 4), (0, 2, 1, 3), (0, 3, 1, 2),
        (1, 0, 3, 3), (1, 3, 1, 4),
        (2, 0, 2, 2), (2, 2, 1, 1), (2, 3, 1, 0),
        (3, 0, 4, 1),
        (4, 0, 2, 4), (4, 2, 1, 6), (4, 3, 1, 5),
        (5, 0, 3, 4), (5, 3, 1, 3),
        (6, 0, 2, 2), (6, 2, 2, 3),
        (7, 0, 4, 0),
    ]
    melody = [(bar * 4 + beat, length, pitch(mode, root, d, 1), 78)
              for bar, beat, length, d in line]

    # i - IV - III - VII, twice. The fourth is major here and that is the whole
    # colour of the mode.
    unders = [0, 3, 2, 6] * 2
    bass, pad, pluck = [], [], []
    for bar, degree in zip(over(8), unders):
        low = pitch(mode, root, degree, -2)
        bass += [(bar, 2.5, low, 70), (bar + 2, 1.5, low + 12, 58)]
        pad += [(bar, 3.8, n, 44) for n in chord(mode, root, degree, 0)]
        # Eighths up and down the triad, under everything, quiet enough to be
        # texture rather than a part.
        ring = chord(mode, root, degree, 1) + chord(mode, root, degree, 1)[1::-1]
        pluck += [(bar + n * 0.5, 0.45, ring[n % len(ring)], 34) for n in range(8)]

    write('rooftops.mid', 92, [(0, 73, melody), (1, 33, bass), (2, 89, pad), (3, 46, pluck)])


def crows():
    """
    Being hunted. D Phrygian, and fast enough to be a problem.

    The flat second is the point: an E flat leaning on the D never resolves,
    and a bar of it is a bar of something being wrong. Bass on every eighth so
    there is nowhere to rest.
    """
    mode, root = PHRYGIAN, 62
    bass = []
    for bar in over(8):
        # Root on the eighths with the flat second shoved in twice a bar.
        steps = [0, 0, 1, 0, 0, 0, 1, 0]
        bass += [(bar + n * 0.5, 0.45, pitch(mode, root, steps[n], -2), 88)
                 for n in range(8)]

    figure = [(0, 0.5, 0), (0.5, 0.5, 1), (1, 0.5, 0), (1.5, 0.5, 4),
              (2, 1, 3), (3, 1, 1)]
    lead = []
    for bar, up in zip(over(8), [0, 0, 0, 2, 0, 0, 3, 4]):
        lead += [(bar + beat, length, pitch(mode, root, d + up, 1), 92)
                 for beat, length, d in figure]

    stabs = []
    for bar in over(8):
        for beat in (0, 2.5):
            stabs += [(bar + beat, 0.4, n, 64) for n in chord(mode, root, 0, 0)]

    # Kick, snare, and a hat on every eighth. Channel ten is percussion and
    # the note number picks the drum, not the pitch.
    drums = []
    for bar in over(8):
        drums += [(bar + 0, 0.2, 36, 100), (bar + 1, 0.2, 38, 88),
                  (bar + 2, 0.2, 36, 96), (bar + 3, 0.2, 38, 88)]
        drums += [(bar + n * 0.5, 0.1, 42, 52) for n in range(8)]

    write('crows.mid', 148, [(0, 30, lead), (1, 38, bass), (2, 62, stabs), (9, 0, drums)])


def home():
    """
    After it. D Mixolydian, slow, and nothing in it is in a hurry.

    Major with a flat seventh: the mode you get when a major key stops
    insisting on going home, which is the right one for a level that has
    already got there.
    """
    mode, root = MIXOLYDIAN, 62
    line = [
        (0, 0, 3, 0), (0, 3, 1, 1),
        (1, 0, 2, 2), (1, 2, 2, 4),
        (2, 0, 3, 3), (2, 3, 1, 2),
        (3, 0, 4, 0),
        (4, 0, 2, 4), (4, 2, 2, 5),
        (5, 0, 4, 6),
        (6, 0, 2, 4), (6, 2, 1, 3), (6, 3, 1, 2),
        (7, 0, 4, 0),
    ]
    melody = [(bar * 4 + beat, length, pitch(mode, root, d, 1), 70)
              for bar, beat, length, d in line]

    unders = [0, 5, 3, 6, 0, 5, 3, 0]
    bass, pad = [], []
    for bar, degree in zip(over(8), unders):
        bass += [(bar, 3.8, pitch(mode, root, degree, -2), 62)]
        pad += [(bar, 3.9, n, 40) for n in chord(mode, root, degree, 0, 4)]

    write('home.mid', 76, [(0, 11, melody), (1, 33, bass), (2, 89, pad)])


if __name__ == '__main__':
    print(f'Writing to {OUT}')
    rooftops()
    crows()
    home()
