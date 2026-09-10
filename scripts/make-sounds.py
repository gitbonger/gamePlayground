"""
Turn field recordings from Wikimedia Commons into the game's sound folders.

Run when you want different noises, or more of them:

    python3 -m venv .venv && .venv/bin/pip install numpy
    .venv/bin/python scripts/make-sounds.py

It downloads the recordings listed in WANT, finds the seconds in each that
are actually the sound, and writes short clips into `src/render/sounds/`,
where the game picks them up by folder name. Nothing here runs at build time
-- the output is checked in, and this only exists so the output can be
regenerated or extended.

The interesting part is finding the sound. A twenty-five second recording of
a crow is mostly wind, and nothing here can listen. So each kind of noise is
described numerically -- the band it lives in, how long it lasts, whether it
is a tone or a rasp -- and windows are scored against that description. It
gets it right often and wrong sometimes, which is what `dev/clips.html` is
for: play them, delete the bad ones, and the folder is the list.
"""

import json, os, re, subprocess, sys, time, urllib.parse, urllib.request
import numpy as np

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(HERE, '.sound-cache')     # downloads, not checked in
DEST = os.path.join(HERE, 'src', 'render', 'sounds')
UA = {'User-Agent': 'pigeon-sim/1.0 (hobby game; asset fetch)'}
API = 'https://commons.wikimedia.org/w/api.php'
SR = 22050
FRAME, HOP = 1024, 256

# What to fetch, and what each one is meant to become. Add a line to get more
# of a thing; the picking below decides which of them survive.
WANT = [
    ('bark',   'Barking of a dog.ogg'),
    ('bark',   'Barking of a dog 2.ogg'),
    ('bark',   'Perro labrador ladrando 01.ogg'),
    ('bark',   'Perro labrador ladrando 02.ogg'),
    ('bark',   'Barking dog in Rome.ogg'),
    ('coo',    'Columba livia - Rock Dove XC539061.mp3'),
    ('coo',    'Columba livia - Rock Dove XC541143.mp3'),
    ('coo',    'Dove cooing.ogg'),
    ('coo',    'Сизый Голубь.ogg'),
    ('coo',    '20200321 125634 Pigeons.ogg'),
    ('caw',    'Corvus cornix.ogg'),
    ('caw',    'Corvus cornix - Hooded Crow XC347296.mp3'),
    ('caw',    'Corvus cornix - Hooded Crow XC405788.mp3'),
    ('caw',    'Corvus corone - Carrion Crow XC511945.mp3'),
    ('caw',    'Corvus corone - Carrion Crow XC511976.mp3'),
    ('caw',    'Hooded Crow (Corvus cornix) - Bærum, Norway 2021-04-03.mp3'),
    ('tram',   'Melbourne trams - 2018-09-15 - Andy Mabbett.oga'),
    ('tram',   'Sydney tram 18 - 2016-02-14.ogg'),
    ('tram',   'Tram sound in Lyon, France.ogg'),
    ('street', 'Sunday in the city street noise1.ogg'),
    ('street', 'Sunday in the city street noise3.ogg'),
]

# A tram recording holds two different sounds and they have to be told apart
# by what they are made of, so one download can feed two folders.
FEEDS = {'tram': ['bell', 'screech']}

# Each noise, numerically. `lo`/`hi` is the band it lives in, `secs` how long
# a clip should be, `tonal` above zero rewards a tone and below zero rewards
# a rasp, and `burst` says whether it should start out of quiet.
#
# `share` is how much of a clip's energy has to be inside that band before it
# is believed, and it is the one that has to differ. An animal is the loudest
# thing in its own recording, so a bark that is not mostly bark is not a bark.
# A wheel squeal is a thin bright thing riding on a whole tram going past,
# and most of what is on the tape is the rumble underneath it -- hold a squeal
# to a bark's standard and every squeal ever recorded is rejected.
KINDS = {
    'bark':    dict(lo=250,  hi=2500, secs=0.75, pre=0.10, tonal=-0.3, burst=True,  share=0.25),
    'caw':     dict(lo=900,  hi=4500, secs=0.90, pre=0.10, tonal=-0.4, burst=True,  share=0.25),
    'coo':     dict(lo=280,  hi=900,  secs=2.60, pre=0.15, tonal=1.0,  burst=True,  share=0.25),
    'bell':    dict(lo=1200, hi=5000, secs=1.50, pre=0.08, tonal=1.0,  burst=True,  share=0.22),
    'screech': dict(lo=1500, hi=7000, secs=1.60, pre=0.10, tonal=-0.2, burst=False, share=0.10),
}

KEEP = 6        # clips per folder
FROM_ONE = 2    # at most this many out of any one recording
LOOP, BLEND = 40.0, 2.0   # the street bed, and how much of it folds back


# ---------------------------------------------------------------- fetching

def call(params):
    q = urllib.parse.urlencode(params)
    req = urllib.request.Request(f'{API}?{q}', headers=UA)
    for attempt in range(6):
        try:
            r = json.load(urllib.request.urlopen(req, timeout=60))
            time.sleep(1.2)
            return r
        except Exception:
            time.sleep(4 * (attempt + 1))
    raise SystemExit('Commons would not answer: ' + q)


def fetch_all():
    """Download everything in WANT, and return what is on disk with its licence."""
    os.makedirs(RAW, exist_ok=True)
    titles = ['File:' + t for _, t in WANT]
    meta = {}
    for i in range(0, len(titles), 20):
        r = call({'action': 'query', 'format': 'json', 'prop': 'imageinfo',
                  'iiprop': 'extmetadata|url', 'titles': '|'.join(titles[i:i + 20])})
        for v in r['query']['pages'].values():
            if 'imageinfo' not in v:
                print('  no such file:', v['title']); continue
            ii = v['imageinfo'][0]
            m = ii.get('extmetadata', {})
            meta[v['title']] = {
                'url': ii['url'],
                'lic': (m.get('LicenseShortName') or {}).get('value'),
                'page': 'https://commons.wikimedia.org/wiki/'
                        + urllib.parse.quote(v['title'].replace(' ', '_')),
            }

    have = []
    for kind, title in WANT:
        m = meta.get('File:' + title)
        if not m:
            continue
        name = f"{kind}--{re.sub(r'[^A-Za-z0-9]', '_', title[:40])}{os.path.splitext(title)[1]}"
        path = os.path.join(RAW, name)
        if not os.path.exists(path) or os.path.getsize(path) < 2048:
            # Commons throttles anonymous downloads hard, and a throttled
            # transfer never finishes rather than failing: hence a deadline
            # per file and a note about which ones did not make it.
            r = subprocess.run(['curl', '-sSL', '--retry', '4', '--retry-all-errors',
                                '--retry-delay', '5', '--max-time', '120',
                                '-A', UA['User-Agent'], '-o', path, m['url']])
            if r.returncode != 0 or not os.path.exists(path) or os.path.getsize(path) < 2048:
                print(f'  throttled, skipped: {title}  (run again to pick it up)')
                if os.path.exists(path):
                    os.remove(path)
                continue
            time.sleep(2)
        have.append({'kind': kind, 'title': title, 'path': path, **m})
        print(f"  {kind:7} {m['lic']:16} {os.path.getsize(path) // 1024:5}KB  {title[:48]}")
    return have


# ---------------------------------------------------------------- listening

def decode(path):
    p = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR),
                        '-f', 'f32le', '-'], capture_output=True)
    return np.frombuffer(p.stdout, dtype=np.float32).astype(np.float64)


def spectra(x):
    n = 1 + max(0, (len(x) - FRAME) // HOP)
    if n < 2:
        return None, None
    frames = np.lib.stride_tricks.as_strided(
        x, shape=(n, FRAME), strides=(x.strides[0] * HOP, x.strides[0])) * np.hanning(FRAME)
    return np.abs(np.fft.rfft(frames, axis=1)), np.fft.rfftfreq(FRAME, 1 / SR)


def windows(x, k):
    """Every place this sound might be, best first, as (sample, score)."""
    mag, freqs = spectra(x)
    if mag is None:
        return []
    inside = (freqs >= k['lo']) & (freqs < k['hi'])
    want = mag[:, inside].sum(axis=1)
    share = want / (mag.sum(axis=1) + 1e-12)
    loud = want / (want.max() + 1e-12)
    m = mag + 1e-12
    tone = 1 - np.exp(np.log(m).mean(axis=1)) / m.mean(axis=1)
    score = loud * (0.5 + share) * (1 + k['tonal'] * (tone - 0.5) * 2)

    span = max(1, int(k['secs'] * SR / HOP))
    run = np.concatenate([[0.0], np.cumsum(score)])
    over = (run[span:] - run[:-span]) / span
    if len(over) < 2:
        return []
    if k['burst']:
        # Worth more if it starts out of quiet: that is what makes it one
        # sound rather than a slice out of the middle of a texture.
        back = min(span, len(over))
        before = np.concatenate([np.zeros(back), over[: len(over) - back]])
        over = over * (1 + 0.6 * np.clip(1 - before / (over.max() + 1e-12), 0, 1))

    out = []
    for i in np.argsort(over)[::-1]:
        if len(out) >= 8:
            break
        if any(abs(i - j) < span for j, _ in out):
            continue
        out.append((int(i), float(over[i])))
    return [(max(0, i * HOP - int(k['pre'] * SR)), s) for i, s in out]


def shape(x, k):
    """A window of samples, made into a clip: no offset, no click, no clipping."""
    clip = x[: int(k['secs'] * SR)].copy()
    if len(clip) < SR // 10:
        return None
    clip -= clip.mean()                       # a DC offset is a click at both ends
    edge = int(0.015 * SR)
    clip[:edge] *= np.linspace(0, 1, edge)
    out = int(0.08 * SR)
    clip[-out:] *= np.linspace(1, 0, out)
    peak = np.abs(clip).max()
    if peak <= 0:
        return None
    # To -3.5 dBFS, in here rather than in a filter. A limiter has an attack
    # and a bell's strike is faster than any of them, so it goes straight
    # through one; then mp3 adds its own overshoot; then the browser resamples
    # 22 kHz up to 48 and overshoots again. Measured through all three, a
    # tram bell normalised to -1.5 came back out of Chrome's decoder at 1.00,
    # which is the clamp. The kit sets the level it plays at, so this costs
    # nothing but the arithmetic.
    return clip * (0.67 / peak)


def worth_keeping(clip, k):
    """Whether this is the sound, or the wind either side of it."""
    rms = np.sqrt((clip ** 2).mean())
    if rms < 0.02:                            # nothing there once it is levelled
        return False, 'silent'
    mag, freqs = spectra(clip)
    if mag is None:
        return False, 'short'
    average = mag.mean(axis=0)
    inside = (freqs >= k['lo']) & (freqs < k['hi'])
    if average[inside].sum() / (average.sum() + 1e-12) < k['share']:
        return False, 'mostly elsewhere'
    # Where the energy peaks only settles it for the sounds that are meant to
    # dominate their own recording; a squeal never does, so it is judged on
    # its share alone.
    if k['share'] >= 0.2:
        loudest = freqs[int(np.argmax(average))]
        if loudest < k['lo'] / 2 or loudest > k['hi'] * 1.5:
            return False, f'{loudest:.0f}Hz, out of band'
    return True, ''


def write(clip, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1',
                    '-i', '-', '-c:a', 'libmp3lame', '-q:a', '7', path],
                   input=clip.astype(np.float32).tobytes(), capture_output=True)


# ---------------------------------------------------------------- the bed

def steadiest(x, secs):
    """Where a recording is most like itself -- a bed must not have events in it."""
    hop = 2048
    n = len(x) // hop
    span = max(2, int(secs * SR / hop))
    if n <= span:
        return 0
    energy = np.sqrt((x[: n * hop].reshape(n, hop) ** 2).mean(axis=1) + 1e-12)
    c1 = np.concatenate([[0.0], np.cumsum(energy)])
    c2 = np.concatenate([[0.0], np.cumsum(energy ** 2)])
    mean = (c1[span:] - c1[:-span]) / span
    var = (c2[span:] - c2[:-span]) / span - mean ** 2
    steady = mean / (np.sqrt(np.maximum(var, 0)) + 1e-6)
    # Steady and not silent: the fade-out at the end of a recording is the
    # steadiest thing in it, and it is not a city.
    return int(np.argmax(np.where(mean < 0.25 * mean.max(), 0, steady))) * hop


def make_bed(src):
    x = decode(src['path'])
    need = int((LOOP + BLEND) * SR)
    if len(x) < need:
        print('  too short for a bed:', src['title'])
        return None
    at = min(steadiest(x, LOOP + BLEND), len(x) - need)
    cut = x[at: at + need]
    blend = int(BLEND * SR)
    body, tail = cut[: int(LOOP * SR)].copy(), cut[int(LOOP * SR):]
    rising = np.linspace(0, 1, blend)
    # The head becomes head-rising plus tail-falling, so that playing the end
    # of the body into it continues the tail it was already hearing: the loop
    # comes round with nothing to hear at the join.
    body[:blend] = body[:blend] * rising + tail[:blend] * (1 - rising)
    body -= body.mean()
    peak = np.abs(body).max()
    return body * (0.72 / peak) if peak > 0 else None


# ---------------------------------------------------------------- the run

def main():
    print('Fetching from Wikimedia Commons...')
    sources = fetch_all()

    print('\nFinding the sound in each...')
    found = {}
    for src in sources:
        if src['kind'] == 'street':
            continue
        x = decode(src['path'])
        if len(x) < SR // 2:
            print('  will not decode:', src['title']); continue
        # Two folders may want different moments out of the same recording,
        # and they must not be the same moment: a bell and a squeal that turn
        # out to be one sound is two folders holding one sound.
        spoken_for = []
        for kind in FEEDS.get(src['kind'], [src['kind']]):
            k = KINDS[kind]
            kept = 0
            for at, score in windows(x, k):
                if any(abs(at - other) < k['secs'] * SR for other in spoken_for):
                    continue
                clip = shape(x[at:], k)
                if clip is None:
                    continue
                good, why = worth_keeping(clip, k)
                if not good:
                    continue
                spoken_for.append(at)
                found.setdefault(kind, []).append(
                    {'clip': clip, 'score': score, 'from': src['title'],
                     'lic': src['lic'], 'page': src['page']})
                kept += 1
                if kept >= 4:
                    break
            print(f"  {kind:8} {src['title'][:44]:44} {kept} usable")

    print('\nWriting...')
    for folder in os.listdir(DEST) if os.path.isdir(DEST) else []:
        at = os.path.join(DEST, folder)
        if os.path.isdir(at):
            for f in os.listdir(at):
                os.remove(os.path.join(at, f))

    credits = []
    for kind, clips in sorted(found.items()):
        picked, seen = [], {}
        for c in sorted(clips, key=lambda c: -c['score']):
            if seen.get(c['from'], 0) >= FROM_ONE:
                continue
            seen[c['from']] = seen.get(c['from'], 0) + 1
            picked.append(c)
            if len(picked) >= KEEP:
                break
        for n, c in enumerate(picked):
            name = f'{kind}/{kind}-{n + 1}.mp3'
            write(c['clip'], os.path.join(DEST, name))
            credits.append({'file': name, 'from': c['from'], 'lic': c['lic'], 'page': c['page']})
        print(f'  {kind:8} {len(picked)}')

    for n, src in enumerate([s for s in sources if s['kind'] == 'street']):
        bed = make_bed(src)
        if bed is None:
            continue
        name = f'street/street-{n + 1}.mp3'
        write(bed, os.path.join(DEST, name))
        credits.append({'file': name, 'from': src['title'], 'lic': src['lic'], 'page': src['page']})
        print(f'  street   {src["title"][:44]}')

    json.dump(credits, open(os.path.join(DEST, 'credits.json'), 'w'), indent=1, ensure_ascii=False)
    write_credits(credits)
    total = sum(os.path.getsize(os.path.join(DEST, c['file'])) for c in credits)
    print(f'\n{len(credits)} files, {total // 1024}KB in {DEST}')


def write_credits(credits):
    lines = [
        '# Where the sounds came from', '',
        'Every file in these folders was cut out of a freely licensed recording on',
        'Wikimedia Commons by `scripts/make-sounds.py`. The licence belongs to the',
        'sound file, not to the game -- a CC BY-SA recording stays CC BY-SA however',
        'it is trimmed -- which is why this page exists and why it travels with them.',
        '', 'Cut, levelled and faded at the edges; otherwise unaltered.', '',
    ]
    for kind in sorted({c['file'].split('/')[0] for c in credits}):
        lines += [f'## {kind}', '']
        together = {}
        for c in credits:
            if c['file'].split('/')[0] != kind:
                continue
            together.setdefault((c['from'], c['lic'], c['page']), []).append(
                c['file'].split('/')[1])
        for (title, lic, page), files in together.items():
            lines.append(f"- **{', '.join(files)}** -- [{title}]({page}), {lic}")
        lines.append('')
    open(os.path.join(DEST, 'CREDITS.md'), 'w').write('\n'.join(lines))


if __name__ == '__main__':
    main()
