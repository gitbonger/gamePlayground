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
