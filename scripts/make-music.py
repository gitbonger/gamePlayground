"""
Turn the tunes in `music/` into the MIDI files the game plays.

    python3 scripts/make-music.py

The tunes are written in ABC, which is how folk music is written down in
plain text: `G2 B2 d2` is three notes, `"D"` over them is the chord, and
`|: ... :|` repeats. Thousands of traditional tunes are published in it --
abcnotation.com has most of them -- so a new piece can be pasted in rather
than composed, and edited in any text editor.

Only the tune is written. The backing is made here from the chord symbols,
in the shape the metre asks for: bass and chord alternating in 2/4 (the
oom-pah of a polka), bass-chord-chord in 3/4 (a waltz), and so on. Which is
also how a village band plays: somebody has the tune, and everybody else
knows the three chords under it.

A subset of ABC, and it says so when it meets something it does not read.
What is here: notes and rests with lengths, octave marks, accidentals, keys
in any mode, chord symbols, bar lines, repeats with first and second
endings, broken rhythm (`>` `<`), triplets and ties. Grace notes,
decorations and slurs are passed over; they are ornament, and the synth
could not play them anyway.

Three lines of our own at the top of a tune pick the instruments, by General
MIDI number: `%%melody 21` (an accordion), `%%bass 58` (a tuba), `%%chords 24`
(a guitar), and `%%drums on` for a light kick and snare under it.
"""

import os, re, struct, sys
from fractions import Fraction as F

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TUNES = os.path.join(HERE, 'music')
OUT = os.path.join(HERE, 'src', 'render', 'music')
TICKS = 480          # per quarter note


# ------------------------------------------------------------ writing MIDI

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
    # Offs before ons at the same tick, so a repeated note is two notes.
    events = sorted(events, key=lambda e: (e[0], e[1][0] & 0xF0 != 0x80))
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
        out.append((at + max(1, round(length * TICKS) - 8), bytes([0x80 | channel, key, 0])))
    return out


def write(name, bpm, parts, beats):
    """`parts` are (channel, program, notes); `beats` is the length, in quarters."""
    timing = [(0, b'\xff\x51\x03' + struct.pack('>I', round(60_000_000 / bpm))[1:])]
    chunks = [track(timing)]
    for channel, program, notes in parts:
        events = [(0, bytes([0xC0 | channel, program]))] if channel != 9 else []
        # A silent marker at the very end, so the file is exactly as long as
        # the tune -- the player loops on the length, and a last note that
        # stops short of the bar would otherwise pull the loop point in.
        events.append((round(beats * TICKS), b'\xff\x01\x00'))
        chunks.append(track(events + note_events(channel, notes)))
    head = b'MThd' + struct.pack('>IHHH', 6, 1, len(chunks), TICKS)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    open(path, 'wb').write(head + b''.join(chunks))
    return os.path.getsize(path)


# ------------------------------------------------------------ reading ABC

NATURAL = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
# How many sharps each major key has; flats count negative.
MAJOR_SHARPS = {'C': 0, 'G': 1, 'D': 2, 'A': 3, 'E': 4, 'B': 5, 'F#': 6, 'C#': 7,
                'F': -1, 'Bb': -2, 'Eb': -3, 'Ab': -4, 'Db': -5, 'Gb': -6, 'Cb': -7}
# A mode is the major key a few steps round the circle of fifths.
MODE_SHIFT = {'': 0, 'maj': 0, 'ion': 0, 'mix': -1, 'dor': -2, 'm': -3, 'min': -3,
              'aeo': -3, 'phr': -4, 'loc': -5, 'lyd': 1}
SHARP_ORDER = 'FCGDAEB'


def key_signature(value):
    """`G`, `Dmix`, `Am`, `Bb` -> {letter: -1, 0 or +1} for the notes it alters."""
    m = re.match(r'\s*([A-G])([#b]?)\s*([A-Za-z]*)', value)
    if not m:
        raise SystemExit(f'cannot read the key {value!r}')
    tonic = m.group(1) + m.group(2)
    mode = m.group(3).lower()[:3]
    if mode == 'mi':           # "min" cut to three is "min"; "m" alone is minor too
        mode = 'min'
    if mode not in MODE_SHIFT:
        mode = 'm' if mode.startswith('m') else ''
    sharps = MAJOR_SHARPS.get(tonic)
    if sharps is None:
        raise SystemExit(f'cannot read the key {value!r}')
    sharps += MODE_SHIFT[mode]
    altered = {}
    for letter in (SHARP_ORDER[:sharps] if sharps > 0 else SHARP_ORDER[::-1][:-sharps]):
        altered[letter] = 1 if sharps > 0 else -1
    return altered


def chord_notes(symbol):
    """`G`, `Am`, `D7`, `F#m`, `Bb` -> (root pitch class, intervals), or None."""
    m = re.match(r'([A-G])([#b]?)(maj7|m7|dim|m|7)?', symbol)
    if not m:
        return None
    root = (NATURAL[m.group(1)] + {'#': 1, 'b': -1, '': 0}[m.group(2)]) % 12
    quality = m.group(3) or ''
    shape = {'': [0, 4, 7], 'm': [0, 3, 7], 'dim': [0, 3, 6], '7': [0, 4, 7, 10],
             'm7': [0, 3, 7, 10], 'maj7': [0, 4, 7, 11]}[quality]
    return root, shape


TOKEN = re.compile(r'''
    (?P<chord>"[^"]*")
  | (?P<bar>\|\]|\|\||:\||\|:|::|\[[12]|\|[12]|\|)
  | (?P<triplet>\(3)
  | (?P<note>(?P<acc>\^\^|\^|__|_|=)?(?P<pitch>[A-Ga-gz])(?P<oct>[,']*)(?P<num>\d*)(?P<slash>/*)(?P<den>\d*))
  | (?P<broken>[<>])
  | (?P<tie>-)
  | (?P<skip>\{[^}]*\}|![^!]*!|[()~.HLMOPSTuv\s\\])
''', re.X)


def length_of(num, slash, den):
    """ABC's length multipliers: `2`, `/`, `/2`, `3/2`, `//`."""
    value = F(int(num)) if num else F(1)
    if slash:
        value /= int(den) if den else 2 ** len(slash)
    return value


def read_tune(text):
    """An ABC tune as its header fields and the notes and chords, repeats played out."""
    head, body = {}, []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith('%%'):
            word, _, rest = stripped[2:].partition(' ')
            head['%' + word] = rest.strip()
            continue
        if stripped.startswith('%') or not stripped:
            continue
        m = re.match(r'^([A-Za-z]):(.*)$', stripped)
        if m and 'K' not in head:
            head[m.group(1)] = m.group(2).strip()
            continue
        body.append(stripped.split('%')[0])

    unit = F(head.get('L', '1/8'))
    key = key_signature(head.get('K', 'C'))

    # First pass: tokens into a flat list of items, each still in the order
    # it is written. Repeats are played out in the second pass.
    items = []
    text = ' '.join(body)
    at = 0
    while at < len(text):
        m = TOKEN.match(text, at)
        if not m:
            raise SystemExit(f'cannot read {text[at:at + 12]!r} in {head.get("T", "a tune")}')
        at = m.end()
        kind = m.lastgroup if m.lastgroup in ('chord', 'bar', 'triplet', 'broken', 'tie', 'skip') else 'note'
        if kind == 'skip':
            continue
        items.append((kind, m))

    # Second pass: the repeats, walked the way a player walks them. `|:` marks
    # where to go back to; the first `:|` goes back, the second goes on; on
    # the way round again a first ending is jumped to its `:|`.
    played, i, start, second = [], 0, 0, False
    while i < len(items):
        kind, m = items[i]
        if kind == 'bar':
            mark = m.group('bar')
            if mark == '|:':
                start, second = i + 1, False
            elif mark in ('[1', '|1') and second:
                j = i + 1
                while j < len(items) and not (items[j][0] == 'bar' and items[j][1].group('bar') in (':|', '::')):
                    j += 1
                i, second = j + 1, False
                if j < len(items) and items[j][1].group('bar') == '::':
                    start = i
                continue
            elif mark in (':|', '::'):
                if not second:
                    second = True
                    played.append(('bar', '|'))
                    i = start
                    continue
                second = False
                if mark == '::':
                    start = i + 1
            played.append(('bar', '|'))
            i += 1
            continue
        played.append((kind, m))
        i += 1

    # Third pass: into timed notes. Time is in whole notes, as ABC counts it.
    notes, chords, bars = [], [], [F(0)]
    now = F(0)
    accidentals = {}
    triplet = 0
    broken = None
    tie = False
    for kind, m in played:
        if kind == 'bar':
            accidentals = {}
            if now != bars[-1]:
                bars.append(now)
        elif kind == 'chord':
            symbol = m.group('chord').strip('"')
            if chord_notes(symbol):
                chords.append((now, symbol))
        elif kind == 'triplet':
            triplet = 3
        elif kind == 'broken':
            broken = m.group('broken')
        elif kind == 'tie':
            tie = True
        else:
            length = unit * length_of(m.group('num'), m.group('slash'), m.group('den'))
            if triplet:
                length *= F(2, 3)
                triplet -= 1
            # `a>b` is a dotted a and a halved b; the arrow is read before the
            # second note arrives, so the first is fixed up in place.
            if broken and notes:
                previous = notes[-1]
                share = previous[1] / 2
                if broken == '>':
                    notes[-1] = (previous[0], previous[1] + share, previous[2])
                    now += share
                    length -= share
                else:
                    notes[-1] = (previous[0], previous[1] - share, previous[2])
                    now -= share
                    length += share
                broken = None
            letter = m.group('pitch')
            if letter == 'z':
                now += length
                tie = False
                continue
            base = NATURAL[letter.upper()] + (72 if letter.islower() else 60)
            base += 12 * m.group('oct').count("'") - 12 * m.group('oct').count(',')
            acc = m.group('acc')
            if acc:
                accidentals[(letter.upper(), base)] = {'^': 1, '^^': 2, '_': -1, '__': -2, '=': 0}[acc]
            shift = accidentals.get((letter.upper(), base), key.get(letter.upper(), 0))
            pitch = base + shift
            if tie and notes and notes[-1][2] == pitch:
                notes[-1] = (notes[-1][0], notes[-1][1] + length, pitch)
            else:
                notes.append((now, length, pitch))
            tie = False
            now += length
    if now != bars[-1]:
        bars.append(now)
    return head, notes, chords, bars, now


# ------------------------------------------------------------ the backing

def metre(value):
    """`2/4` -> (beats a bar, length of a beat in whole notes)."""
    value = {'C': '4/4', 'C|': '2/2'}.get(value, value)
    top, bottom = (int(n) for n in value.split('/'))
    if bottom == 8 and top % 3 == 0:
        # Compound time: 6/8 is two beats of three quavers, not six beats.
        return top // 3, F(3, 8)
    return top, F(1, bottom)


def place(pitch_class, low):
    """The pitch of that class at or just above `low`."""
    return low + (pitch_class - low) % 12


def backing(chords, bars, beats, beat, drums):
    """Bass, chords and drums from the chord symbols, bar by bar."""
    bass, stabs, kit = [], [], []
    bar_length = beat * beats
    # In 2/4 and 3/4 the bass takes the first beat; in 4/4 the first and the
    # third, root then fifth, which is what stops four beats sounding like
    # two bars of two.
    pattern = {2: 'BC', 3: 'BCC', 4: 'BCFC'}.get(beats, 'B' + 'C' * (beats - 1))
    flip = False
    for start, end in zip(bars, bars[1:]):
        # A pickup bar or a short last bar gets nothing under it.
        if end - start != bar_length:
            continue
        for n, role in enumerate(pattern):
            at = start + beat * n
            symbol = None
            for when, name in chords:
                if when <= at:
                    symbol = name
                else:
                    break
            if symbol is None:
                continue
            root, shape = chord_notes(symbol)
            quarters = float(at * 4)
            span = float(beat * 4)
            if role in 'BF':
                # Alternating root and fifth from bar to bar, which is the
                # tuba's whole job and is why an oom-pah does not drone.
                low = place(root, 40)
                note = low + 7 if (role == 'F' or flip) and low + 7 <= 55 else low
                bass.append((quarters, span * 0.85, note, 84))
                if drums:
                    kit.append((quarters, 0.2, 36, 92))
            else:
                for interval in shape[:3]:
                    stabs.append((quarters, span * 0.45, place((root + interval) % 12, 55), 50))
                if drums:
                    kit.append((quarters, 0.2, 38, 70))
            if drums:
                # A hat on every half beat, quietly, for the drive.
                kit.append((quarters, 0.1, 42, 40))
                kit.append((quarters + span / 2, 0.1, 42, 34))
        flip = not flip
    return bass, stabs, kit


def make(path):
    name = os.path.splitext(os.path.basename(path))[0]
    head, notes, chords, bars, length = read_tune(open(path, encoding='utf-8').read())
    beats, beat = metre(head.get('M', '4/4'))
    tempo = head.get('Q', '1/4=100')
    per, _, bpm = tempo.rpartition('=')
    # Tempo in quarter notes a minute, which is what MIDI counts in.
    quarters_a_minute = float(bpm) * float(F(per or '1/4') * 4)

    melody = [(float(at * 4), float(n * 4), pitch, 96) for at, n, pitch in notes]
    bass, stabs, kit = backing(chords, bars, beats, beat, head.get('%drums') == 'on')
    parts = [
        (0, int(head.get('%melody', 21)), melody),
        (1, int(head.get('%bass', 58)), bass),
        (2, int(head.get('%chords', 24)), stabs),
    ]
    if kit:
        parts.append((9, 0, kit))
    size = write(f'{name}.mid', quarters_a_minute, parts, float(length * 4))
    seconds = float(length * 4) * 60 / quarters_a_minute
    print(f'  {name:10} {head.get("T", ""):12} {len(melody):4} notes  {seconds:5.1f} s  '
          f'{quarters_a_minute:.0f} bpm  {size} bytes')


if __name__ == '__main__':
    tunes = sorted(f for f in os.listdir(TUNES) if f.endswith('.abc'))
    print(f'{len(tunes)} tunes from {TUNES}')
    for tune in tunes:
        make(os.path.join(TUNES, tune))
