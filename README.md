# Pigeon Sim

A flight simulator where you are a pigeon.

```bash
npm install
npm run dev
```

Then open http://localhost:5183.

## Controls

| Key | Action |
| --- | --- |
| `W` / `S` | Pitch down / up |
| `A` / `D` | Roll left / right |
| `Q` / `E` | Yaw left / right |
| `Space` | Flap — costs stamina; climbs hardest when slow |
| `Shift` | Tuck the wings and dive |
| `Ctrl` (or `B`) | Brake — spread the wings, fan the tail, beat backwards |
| `R` | Respawn |
| `H` | Hide the tuning panel |

Turning is done by banking, not by yawing. Roll into the turn and the tilted
lift vector pulls you round; the tail keeps the nose following the flight path.

**Buildings and trees are solid.** Hit one above 7.5 m/s of closing speed and
the run is over. Slower than that and you scrape to a stop and slide.

**Touching the ground ends the flight, well or badly.** A clean landing needs
all three of: descending no faster than 3.5 m/s, no faster than 10 m/s through
the air, and wings within 20° of level. Meet them and you have landed; miss any
one and it is a crash that names what went wrong.

The approach is **brake, then flare**. Hold `Ctrl` to spread the wings and fan
the tail: airspeed falls from a 15 m/s cruise to about 11 m/s and stays there,
which is a configuration you can hold and steer. Then at roughly **4 metres**
pull the nose up. Braking into a flare settles at 8.2 m/s with 0.6 m/s of sink,
comfortably inside both limits.

Flare too high and you balloon, stall, and drop. Glide straight in without
either tool and you arrive far too fast. Below 45 m the HUD shows the three
checks live, so you can see which one is still red.

## Stack

| Concern | Choice |
| --- | --- |
| Build | Vite |
| Language | TypeScript, strict |
| Rendering | Three.js |
| Live tuning | lil-gui |
| Tests | Vitest |

## Layout

```
src/
  sim/         flight model, 3D math, collision — pure, no renderer imports
  render/      scene, bird rig, chase camera, HUD, game-over panel
  world/       layout.ts generates the city as data; city.ts turns it into meshes
  input.ts     keyboard to control axes
  run.ts       per-flight statistics
  debug-gui.ts live tuning panel
  main.ts      fixed-timestep loop, wiring
```

The one rule worth keeping: **`src/sim/` never imports Three.js.** That is what
makes the flight model unit-testable and lets the renderer be replaced without
touching the physics.

## How the flight model works

`src/sim/flight.ts` is a simplified aerodynamic model rather than an arcade
approximation, because the interesting behaviours fall out for free that way —
stalls, spiral dives, trading height for speed, banking into a turn.

Each tick it computes angle of attack and sideslip in the body frame, looks up
lift and drag coefficients, and applies lift perpendicular to the airflow, drag
along it, and a keel force resisting sideways slip. Rotation is rate-commanded
rather than torque-based: control inputs ask for a body rotation rate, damped
toward the target, and scaled by an authority term that falls off with airspeed
so a stalled bird goes limp until it has dived back up to speed.

Two details matter more than they look:

- **`trimAngle`** is the angle of attack the bird settles at with no input. It
  stands in for a tail's incidence. Without it, pitch stability trims the bird
  to zero lift and it simply falls out of the sky.
- **Fixed timestep** (120 Hz, with the renderer interpolating between ticks).
  A variable-dt flight model cannot be tuned, because every constant you pick
  is quietly a function of frame rate.

Default numbers land close to a real feral pigeon: 0.35 kg, ~15 m/s cruise,
2.1 m/s sink, roughly 7:1 glide ratio, and about 14 seconds of continuous
flapping before stamina runs out.

Everything in `FlightParams` and `CameraParams` is bound to the on-screen panel.
Tuning live is the intended workflow — the committed defaults are a starting
point, not an answer.

## How the wingbeat works

A wingbeat is not a fixed push. Its direction and strength both depend on how
fast the bird is already moving through the air, and getting this wrong is what
made an early build feel dead near the ground:

- **The stroke plane rotates.** At cruise the beat points mostly forward
  (`flapAngle`, 0.45 rad — 90% forward, 43% up) and works by making thrust,
  which the wing turns into lift. Slow down and it swings toward vertical
  (`flapAngleSlow`, 1.35 rad), because a bird bursting off the ground beats
  almost straight down. Holding the cruise angle at every speed leaves the
  average upward force at 16% of body weight, and a slow bird simply cannot
  hold itself up.
- **Slow air is worth more.** `flapSlowBoost` multiplies thrust up to ×9 at a
  standstill, falling off with the *square* of airspeed so cruise is untouched.
  A wing beating against still air does far more than one beating against air
  already rushing past — which is also why climb performance peaks well below
  cruise, for a real pigeon and now for this one.
- **The stroke plane is not bolted to the body.** `flapUpright` lets a slow
  bird aim its beat at the sky regardless of which way its body points, the way
  a hovering bird holds the stroke plane level and hangs beneath it. Without
  it, a bird that has fallen nose-down beats itself sideways and can never
  recover — the wingbeat stops being a way out exactly when you need it.

The result: panic-flapping while pulling up recovers roughly 15 m in three
seconds from a 4 m/s sink, at any speed. A committed 45 m/s dive still cannot
be flapped away, so the low-speed boost never becomes a universal airbrake.

## How braking works

A pigeon has no airbrake, so it brakes with three things at once, and all three
are modelled:

- **Spreading.** Wings out and tail fanned, `brakeAreaFactor` × 1.4 area and
  `brakeDragFactor` × 1.6 drag. The drag term is what actually sheds speed.
- **The alula.** `brakeStallBonus` adds 0.25 rad to the stall angle. The alula
  is the bird's thumb feather, working as a leading-edge slat; without it a
  steep flare just stalls, and with it the flare stays controllable. This is
  the difference between a brake that is a tool and a brake that is a trap.
- **Reversing the beat.** Flapping while braking beats forward and down instead
  of back and down. The stroke plane goes nearly vertical (`brakeFlapAngle`
  1.45 rad), so most of it holds the bird up while the rest pushes it
  backwards — which is why braking *and* beating settles at 7.5 m/s and 2.7 m/s
  sink, slower and gentler than braking alone.

Pitching up sheds speed faster than the brake does (1.1 s to reach 10 m/s,
against never for the brake alone, which asymptotes at 11.4 m/s). The
difference is that a flare is a transient that ends in a stall, while the brake
is a configuration you can sit in. They are complementary, which is why landing
wants both.

The measured effect: across a grid of open-loop approaches, flaring alone lands
30% of the time and braking first lands 61%.

## How landing works

`landingReadiness()` in `src/sim/flight.ts` answers one question — could the
bird put down cleanly if it touched the ground right now — and both the
touchdown verdict and the HUD's approach cue are built on it. That is
deliberate: the cue cannot drift out of step with the rule it reports on,
because they are the same function.

Touching the ground always ends the flight. `touchdown()` checks sink, then
speed, then bank, and names the first limit breached as the cause. Ordering
only affects which fault is reported, cheapest mistake to fix first; any one of
them is enough to ruin the landing.

The limits sit in the panel's `landing` folder. Widening them is the fastest way
to practise the rest of the flight without every run ending on the approach.

## How collision works

`src/sim/collision.ts` sweeps the bird's movement segment against axis-aligned
boxes, one per building and tree, grown by the bird's radius. Sweeping rather
than testing the end position matters: in a tucked dive the bird covers most of
a tree in a single tick, and a point test would pass straight through it.

A uniform grid over the XZ plane keeps the broad phase to a handful of
candidates — 20,000 sweeps against the full 1,400-object city run in well under
a second, which the test suite asserts so the grid cannot quietly regress into
a linear scan.

On contact the closing speed along the surface normal decides what happens:
at or above `crashSpeed` the run ends, below it the bird stops at the surface
and slides along it. Set `crashSpeed` high in the panel's `collision` folder to
make the world non-lethal while tuning handling.

Tree collision boxes are 30% narrower than the cones look, so clipping a leafy
edge does not read as hitting a wall.

## Tests

```bash
npm test
```

71 tests across three files:

- **`src/sim/flight.test.ts`** — the shape of the lift curve, glide ratio and
  sink rate staying in a plausible band, flapping climbing and draining stamina,
  tucked dives outrunning spread ones, banking producing a heading change with
  no yaw input, pitch stability recovering to trim, crashes and survivable
  scrapes, determinism, and that no input sequence produces a NaN.
  Landing gets its own group that flies real approaches open-loop: a well-timed
  flare lands across the whole spread of flare strengths, a straight-in glide is
  rejected as too fast, flaring far too high balloons and then drops, and a
  wing-down touchdown is rejected as not level.
  Braking has its own group too: it sheds speed a glide cannot, the reversed
  beat settles slower *and* more gently than braking alone, the alula bonus
  keeps a fixed angle of attack unstalled that stalls without it, braking
  overrides tucking, and an approach flared too late to save itself lands when
  braked.
  Vertical authority is pinned separately: climbing is better slow than fast,
  the beat buys altitude when slow and ground speed at cruise, a sinking bird
  recovers, a nose-down bird still gets lift from the beat, a committed dive
  still cannot be flapped away, and cruising flight is unchanged by the boost.
- **`src/sim/collision.test.ts`** — entry faces and normals, radius expansion,
  nearest-hit ordering, boxes spanning several grid cells, and a fast segment
  that a point test would tunnel through.
- **`src/world/layout.test.ts`** — flies a bird through the *actual* generated
  city and asserts it crashes into the skyline, never ends up inside a solid
  box, passes clean overhead when high enough, and that the broad phase stays
  fast.

Because the city layout is plain data with no Three.js in it, that last file
tests the real world the player flies through, in Node, with no WebGL.

## Where this goes next

1. **A real pigeon.** `src/render/bird.ts` is primitives behind a two-method
   interface; replace it with a glTF model and a skeletal flap loop.
2. **Air.** Thermals over rooftops and ridge lift off building faces — add a
   wind field sampled at the bird's position and subtract it from velocity
   before the aerodynamics run.
3. **Sound.** Wind noise pitched by airspeed and a wingbeat driven by
   `flapPhase`. This is the cheapest large gain available — and braking, which
   is currently silent, is exactly the kind of thing sound sells.
4. **Landing on rooftops and branches.** Only the ground can currently be
   landed on; a rooftop is still judged by the wall rule, so a gentle touchdown
   on one just slides. The collision layer already reports the surface normal,
   so routing near-horizontal faces through `touchdown()` is most of the work.
5. **Taking off again.** A landed bird is inert by design for now. Resuming
   from a standing start needs a ground mode — hopping, a flap-driven launch,
   and something to stop the aerodynamics from running while perched.
6. **A crash you can see.** The bird currently freezes at the impact point.
   Tumbling it, or leaving a puff of feathers, would cost little.
