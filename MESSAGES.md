# The instructions

Every message the game can put under the bird, and the conditions it appears
and disappears under. **This file is the specification.** Edit a condition
here, say so, and the code follows — `src/render/messages.ts` is the same list
in TypeScript, and a test fails if the two stop naming the same messages.

## How a message works

Each one has two questions asked of it, every frame, against the same record
of the moment (`Moment` in `messages.ts`):

- **shows when** — does this apply right now?
- **goes when** — has it said what it had to say, and should it go *now*, even
  though "shows when" may still be true?

The second is the interesting half. An instruction the player has just acted
on is an instruction that worked, and leaving it up says the game did not
notice. Pressing the key a message names is how somebody says they understood.

On top of that:

- A message stays **5 seconds**, and longer if it is still true. One can ask
  for its own time instead: `nearingTeleki` takes 6.
- A **once a level** message is an *event*, not a state. "You have flown a
  hundred and fifty metres" goes on being true for the rest of the level, so
  these are shown once and then age out on the clock rather than being held
  up by a condition that never becomes false again.
- **Three** at most on screen; a fourth pushes the oldest off.
- **once a level** means it is said once per flight — a death restarts the
  level and says it again.

## What the conditions are written in

| name | meaning |
| --- | --- |
| `altitude` | metres above the ground |
| `airspeed` | metres a second through the air |
| `climb` | metres a second up; negative is sinking |
| `stamina` | what is left in the wings, 0 to 1 |
| `flown` | metres flown since the level began |
| `toGo` | metres to whatever finishes the level: a thing, or a line |
| `landing` | metres to a **marked place to land**, or ∞ where there is none |
| `too fast` / `too hard` | touching down right now would kill, by the landing rule |
| `hunted` | a crow has picked him out and is coming |
| `teaching` | the level is still explaining itself (Levels 1–4 only) |

Thresholds: **slow** is 20 km/h, **low** is 10 m, **tired** is 0.3 of a tank,
the **crow ceiling** is 20 m, an **approach** is the last 150 m to somewhere
to land, and something to land on is **in sight** at 200 m.

---

## The game has arranged this

| name | keys | says | shows when | goes when |
| --- | --- | --- | --- | --- |
| `restart` | `R` | to restart | the flight ended in a crash | — |
| `voiceOn` | `V` | Voice on | the voice was just switched on | after 2 s |
| `voiceOff` | `V` | Voice off | the voice was just switched off | after 2 s |
| `answer` | — | Press a number key to respond! | somebody is waiting for an answer | the reply is given |
| `takeOff` | `SPACE` | Take off! | finished talking, or held on a beat | `SPACE` is pressed |
| `walkRound` | `←` `→` | Turn and walk round it | on foot and walked into something | the way is clear |
| `takeOffAgain` | `SPACE` | Take off again! | **teaching** levels: down, and not down on the thing the level was aiming at | `SPACE` is pressed |
| `offerHungarian` | `TAB` | Magyar nyelvért nyomd meg a TAB-ot | playing in English, first 10 s of Level 1 | — (once a level) |
| `offerEnglish` | `TAB` | Press TAB for English | playing in Hungarian, first 10 s of Level 1 | — (once a level) |

## The ground

| name | keys | says | shows when | goes when |
| --- | --- | --- | --- | --- |
| `flap` | `SPACE` | Keep flapping! | airspeed below **slow** with nowhere to land within 150 m; **or** nose already up, below **low**, sinking, and nowhere to land | `SPACE` is pressed |
| `pullUp` | `↓` | Pull up! | below **low**, sinking, nowhere to land within 150 m, **and** an arrival right now would kill | `↓` is pressed |
| `brakes` | `B` | Try the brakes! | **teaching** levels only, and stamina below **tired** | `B` is pressed (once a level) |

## The crows

| name | keys | says | shows when | goes when |
| --- | --- | --- | --- | --- |
| `crowsLocked` | — | Crows locked on! *(double beep, no voice)* | a crow is coming and the bird is in the air | it stops coming, or the feet go down |
| `crowsFlyLow` | — | Crows! Fly low! | **Level 6 (Népszínház)** and **Level 7 (Blaha)**, above **20 m** | below **20 m** |

## The arrival

| name | keys | says | shows when | goes when |
| --- | --- | --- | --- | --- |
| `flyToMark` | — | Fly towards the blue mark! | **teaching** levels: a mark has just come up — each one, not only the first | after 5 s |
| `landNearArrow` | — | Land near the arrow! | something marked to land on within 200 m | the feet are down (once a level) |
| `loseHeight` | `↑` | Lose some height | teaching, inside the approach, higher than a third of the distance left | the height is right |
| `brakeToSlow` | `B` | Brake to slow down | teaching, inside the approach, and too fast — height or no height | no longer too fast |
| `beatToSoften` | `SPACE` | Beat to soften it | teaching, inside the approach, below 12 m and coming down too hard | no longer too hard |
| `flare` | `↓` | Pull up! | teaching, inside the approach, below 6 m and not too fast | the feet are down |

## What each level has to say

| name | level | keys | says | shows when | goes when |
| --- | --- | --- | --- | --- | --- |
| `tryRight` | Temető | `→` | Try right! | 80 m flown | `→` is pressed |
| `tryLeft` | Temető | `←` | Try left! | 120 m flown | `←` is pressed |
| `trees` | Teleki tér | — | Fly through trees. Avoid buildings and vehicles. | 30 m flown | — |
| `nearingTeleki` | Teleki tér | — | Approaching Teleki tér | 150 m flown | after **6 s** |
| `seeds` | Teleki tér | — | Collect some seeds! | the feet are down | — |
| `keepFast` | Blaha | — | Keep fast! | 150 m flown | — |
| `flyHigh` | The Loft | — | Fly above 150! | 10 m flown | — |
| `descendForSpeed` | The Loft | — | Descend to gain speed! | 130 m flown | — |
| `outflyCrows` | The Loft | — | Outfly the crows! | 260 m flown | — |
| `keepSpeedUp` | The Loft | — | Keep speed above 100! | 400 m flown | — |
| `brakeAtLoft` | The Loft | `B` | to brake! | 220 m still to go | `B` is pressed |
| `noCrows` | Fiumei út | — | Chill, no crows here | 50 m flown | — |
| `landOnTrain` | Keleti | — | You need to land on the train! | 50 m flown | the feet are down |
| `trainTurns` | Keleti | — | Careful, it's changing directions! | 100 m flown | the feet are down |
| `markedCar` | Keleti | — | Only land at the marked car! | 150 m flown | the feet are down |

All of the per-level ones are **once a level**.

---

## Things changed on the way here, worth a look

- **`Keep high!` and `Mind the crows!` are gone from Blaha.** `Keep high!` said
  the opposite of the new crow rule — a crow will not follow below 20 m, and
  Blaha releases you at exactly 20 — so following it was asking to be hunted.
  `Mind the crows!` is now said by `crowsFlyLow`, on both crow levels, and at
  the moment it is actually true rather than 100 m into the flight.
- **`pullUp` reads "an arrival would kill" as too fast *or* coming down too
  hard.** You said speed. Sink is in there because a slow bird dropping at six
  metres a second still dies and pulling up is still the answer — say the word
  and I will narrow it to speed alone.
- **`landNearArrow` now applies to every level with something marked to land
  on**, not only Teleki tér. It was your example, and the condition you gave
  ("if there is a landing arrow nearby") is not level-specific.
- **`flap` and `pullUp` no longer stop after Level 4.** They are about flying
  into the ground, which is not a tutorial topic. `Try the brakes!` does stop,
  as you said.
- **The approach coaching stacks** rather than picking one. `flare` still
  waits until the speed is right — flaring fast is how a bird arrives fast --
  but `brakeToSlow` no longer waits for the height. Coming in high *and* fast
  is most arrivals and all the fatal ones, and it used to be told about the
  height and never about the brake.
- **Level 9 (Fiumei út) had nothing to fly at.** It ends at a line and a line
  has no marker, so once the minimap stopped pointing at the finish there was
  nothing on screen until the stripe came inside the panel's 300 m — which on
  that level is most of the way. The map points at the line's own crossing
  point again, which is Level 10's spawn point, exactly as the level data
  already said.
