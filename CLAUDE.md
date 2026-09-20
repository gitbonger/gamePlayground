# Working on Pigeon Sim

## How to answer

Short. The reply is for deciding and acting on, not for reading.

- **Lead with what needs a decision, or what to do next.** If there is
  nothing to decide and nothing to do, say what changed in a line or two and
  stop.
- **Skip mistakes that were made and then fixed.** A wrong turn that got
  corrected before the work landed is not news. Only say so where it still
  affects something: a number that turned out different, an assumption that
  is still standing, a thing left broken.
- **Details sparingly.** One measurement that settles the question beats
  five that surround it. No recaps of what was just read, no lists of
  options that were not taken.
- **Say plainly when something is unverified, incomplete or a guess.** That
  is not detail — it is the part that changes what the reader does.

Long is worth it for exactly one thing: a real trade-off the reader has to
weigh. Then give the numbers and a recommendation.

## Style

- No formatter. Prettier and friends rewrite the whole file — the style here
  is hand-maintained: single quotes, prose comments, deliberate line breaks.
  Match the surrounding code by eye.
- Comments say *why*, at the density of the code around them.

## Where things live

- `DIALOGUE.md` — every word anybody says. The source: the game parses it at
  load, so editing a line there changes the game.
- `MESSAGES.md` — the instructions the panel shows, and the conditions each
  appears and disappears under. A specification; the code follows it, and a
  test fails if the two stop naming the same messages.
- `MUSIC.md` — what puts the music at each intensity, 1 to 5, and what each
  intensity does to it. A specification like `MESSAGES.md`: the code is
  `src/render/intensity.ts`, and a test keeps the two naming the same things.
- `src/buildings/` — the few real buildings modelled by hand, one file each
  (`keleti.ts`, `loft.ts`), as a list of parts: boxes, gable and hipped roofs,
  arched windows. A building whose roof matters to the story (the Loft) also
  names a `deck` — the patch of roof the marker, the cast and the rescue use. The kit is `src/world/model.ts`; the parts are both drawn and made
  solid from the same list. Hook one up as a landmark in `src/landmarks.ts`,
  and it clears the generated city off its footprint. Look at it with
  `dev/look.html?x=..&y=..&z=..&tx=..&ty=..&tz=..` (local metres, north is -z).
- `src/world/ground.ts` — how high the ground is, read from the grid of
  heights in the map file. `scripts/fetch-height.ts` fetches that grid (free
  terrarium tiles, no key) and writes it into `src/world/data/home.json`
  without touching the rest, so it can be rerun on its own. Heights are
  metres above the map centre: Pest is flat and near nought, Buda rises a
  hundred. A first pass only — things *stand* on the ground, nothing tilts to
  it, and the flat layers are still settled by draw order.
- `src/levels.ts` — every level, and which of the three games it belongs to:
  `story` (Story1–Story13, the story as it was), `sight` (Sight1, Sight2:
  somewhere to go with nothing to do there) and `delivery` (Delivery1: the
  round). `LEVEL_TAGS` is what each is called in its own game, and that is
  what the level list shows. The rocket on `X` is flown on everything but the
  story — `rocketOn` — and the level says so when it begins.
- `src/world/grid.ts` — the overhead power lines: towers where the survey
  tagged one, cable sagging between them, three arms of two. The cable is
  solid and **soft**, so a pigeon can sit on a wire and nothing about a wire
  can kill him — see `Box.soft`, which now forgives a bad landing as well as
  a bad collision.
- `src/finish.ts` — what ends each kind of level.
- `src/render/messages.ts` — the instruction conditions in code.
- `scripts/start-manualtest.sh` — the play server, which does not reload
  under you. Started by hand, not by Claude.
- `src/render/sounds/` — the recorded noises, one folder per kind. The folder
  is the list: delete a file and the game stops making that sound, drop one in
  and it starts. `CREDITS.md` in there says where each came from and under
  what licence, and has to stay with them.
- `scripts/make-sounds.py` — fetches the recordings from Wikimedia Commons and
  cuts the clips. Only run when you want different noises; the output is
  checked in. Audition what it produced at `dev/clips.html`.
- `music/*.abc` — the tunes, in ABC (plain-text folk notation; abcnotation.com
  has thousands to paste in). Only the melody and chord symbols are written;
  `scripts/make-music.py` adds the bass and chords and writes the MIDI into
  `src/render/music/`, which is what the game plays through oscillators in
  `src/render/music.ts`. Run the script after editing a tune.
  `dev/music.html` plays them. In the game it is off until M.
