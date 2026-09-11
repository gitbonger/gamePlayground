# How loud the music gets

The music follows one number, the **intensity**, from 1 to 5. This page
says what puts the game at each one. It is the specification: the code in
`src/render/intensity.ts` follows it, and a test fails if the two stop
naming the same situations.

Higher wins. The situations are tried from 5 down, and the first one that
is true is the intensity — so crows locked on is a 5 however slowly you are
flying.

For now the intensity sets two things: **how fast** the piece is played and
**how loud**. Later it will choose what is played as well.

| Intensity | Tempo | Volume |
|---|---|---|
| 1 | 85% | 55% |
| 2 | 95% | 70% |
| 3 | 100% | 82% |
| 4 | 112% | 92% |
| 5 | 125% | 100% |

## 5 — something is trying to kill him

- **lockedOn** — crows locked on: a crow has picked him out and is coming.
- **falling** — hit by a crow or flown into something, and going down.

## 4 — danger in sight

- **crowsNear** — crows nearby: one is up and within 200 m, and has not yet
  decided. (They notice you inside 100 m.)
- **rescue** — the flock at work on the cage.
- **hurtAndSpent** — health under 35% and stamina under 20%, in the air: one
  more mistake is the last.

## 3 — a lot going on

- **bigFlock** — flying with a flock larger than 10.
- **fastAndLow** — above 80 km/h and under 25 m: rooftop height at speed.
- **spent** — stamina under 20%, in the air.

## 2 — some intensity

- **fast** — speed above 80 km/h.
- **diving** — coming down faster than 7 m/s.
- **targetInSight** — the thing that ends the level is on screen and within
  500 m: the marked roof, bird or patch, or the finishing line. Waypoints
  along the way do not count.

## 1 — flying around

- **calm** — everything else: cruising, perched, walking, talking.
