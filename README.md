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
all three of: descending no faster than 4 m/s, no faster than 10 m/s through
the air, and wings within 20° of level. Meet them and you have landed; miss any
one and it is a crash that names what went wrong.

The approach is **brake, then flare**. Coasting already brings you down to
about 11 m/s; holding `Ctrl` spreads the wings and fans the tail to take that
to 9 m/s while giving you a configuration you can hold and steer. Then at
roughly **2 metres** pull the nose up. Braking into a flare settles at 5.1 m/s
with 2.2 m/s of sink, comfortably inside both limits.

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

## Energy

The simulation is Newtonian, so it conserves energy for free — but only if
every force is honest. `src/sim/energy.ts` audits that rather than assuming it.
Each tick, `FlightTelemetry.work` reports the joules every force moved:

| Term | Sign | Meaning |
| --- | --- | --- |
| `flap` | ± | The only source of energy. Negative when braking, because beating backwards against your own motion is a brake, not a motor |
| `lift` | ≈ 0 | Lift acts perpendicular to the airflow, so it must do no work |
| `drag` | ≤ 0 | Dissipation |
| `keel` | ≤ 0 | Sideslip resistance |
| `collision` | — | Kinetic energy absorbed by a surface, plus the potential energy of being pushed clear of one |
| `integration` | ± | Not physics: the fixed-step integrator's own artefact, named rather than hidden in a tolerance |

**The ledger balances exactly, not approximately.** With semi-implicit Euler the
change in kinetic energy is *identically* the work done at the mean velocity:

```
dKE = ½m(|v₁|² − |v₀|²) = F · (v₀ + v₁)/2 · dt
```

Potential energy moves with the end velocity instead, because that is what the
position update uses, and the difference is exactly `m·g·dt·(v₁.y − v₀.y)/2`.
Reporting that as its own term means everything else has to add up to
floating-point rounding — about 4 × 10⁻¹² J on a few hundred joules. Any force
that quietly creates energy shows up immediately, which is the point: that kind
of bug reads as "the flight feel is off" rather than as an obvious error.

Two things the audit caught when it was first switched on:

- **Positional corrections leaked energy.** Clamping to the ground plane, or
  rolling back to a contact point, moves the bird vertically and so changes its
  potential energy. That is work done by the contact and is now booked as such.
- **Lift was creating energy in hard turns** — about 13 J over a 20 second
  manoeuvre, always positive. Lift is perpendicular to the airflow at the
  *start* of a tick, but the velocity rotates during that tick, so holding the
  direction fixed leaves a small component along the flight path. Forces are
  now evaluated at the tick midpoint (predict, then re-evaluate), which cuts
  that by a factor of 26 and flips the residual negative, so it can no longer
  spuriously accelerate the bird. The flight envelope did not move: glide,
  brake, climb curve and landing rates are all unchanged.

The HUD shows **energy height** — altitude plus the height your airspeed is
worth, `h + v²/2g`. Pilots call it specific energy, and it is the number that
actually answers whether you can clear the roofline ahead.

Stamina is still a clock rather than a fuel gauge: it drains per second of
flapping, not per joule delivered. Tying it to `work.flap` would be the honest
next step.

## How coasting works

A pigeon is a powered flier, not a soarer. Stop beating and it should slow down
and give up height quickly — you should not be able to cross the city on one
glide. Two parameters carry that:

- **`trimAngle`** (0.17 rad) is the angle of attack the bird settles at with no
  input, and it sets the speed a coast decays *to*. Trimmed nose-up like this,
  the bird flies slowly when left alone: powered level flight holds about
  17 m/s, and letting go bleeds that back to 11 m/s in a couple of seconds.
  Trimmed flatter, the glide equilibrium sits up at cruise speed and coasting
  never slows you at all, which is what made an earlier build feel like it had
  no brakes even before there was a brake.
- **`dragBase`** (0.12) sets how steeply that coast descends. It takes the
  glide ratio from a sailplane-like 8:1 down to about 4:1, which is the right
  neighbourhood for a bird with a round body, a head out front and its feet
  tucked up under it.

The two do different jobs and are worth tuning separately: trim decides *how
slow* a coast ends up, drag decides *how steep* it is.

The trade-off worth knowing about, if you retune: drag costs climb. Tripling
`dragBase` more than halves the climb rate at a given speed, and dropping the
glide speed pushes the bird permanently into the low-speed part of the wingbeat
curve. `flapThrust` and `flapStrokeSpeed` had to move with it, and the landing
sink limit went from 3.5 to 4 m/s so that a steeper coast did not make landing
harder purely as a side effect.

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
- **Slow air is worth more.** `flapSlowBoost` multiplies thrust up to ×13 at a
  standstill, falling off with the *square* of airspeed so cruise is untouched.
  A wing beating against still air does far more than one beating against air
  already rushing past. The effect is stark at the bottom of the envelope: at
  6 m/s, below the 8.6 m/s stall speed, the boost is the difference between
  sinking at 1 m/s and climbing at 2. By 15 m/s it contributes nothing.
- **The stroke plane is not bolted to the body.** `flapUpright` lets a slow
  bird aim its beat at the sky regardless of which way its body points, the way
  a hovering bird holds the stroke plane level and hangs beneath it. Without
  it, a bird that has fallen nose-down beats itself sideways and can never
  recover — the wingbeat stops being a way out exactly when you need it.

The result: panic-flapping while pulling up recovers 12–15 m in three seconds
from a 4 m/s sink, at any speed. A committed 45 m/s dive still cannot be
flapped away, so the low-speed boost never becomes a universal airbrake.

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
30% of the time, braking first lands 73%, and braking with the reversed beat
lands 83%.

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

104 tests across four files:

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
  Vertical authority is pinned separately: the low-speed boost turns a sinking
  slow bird into a climbing one and fades to nothing by cruise, the beat buys
  altitude when slow and ground speed at cruise, a sinking bird recovers, a
  nose-down bird still gets lift from the beat, and a committed dive still
  cannot be flapped away.
  Coasting has its own group: a coast settles well below what powered level
  flight holds, bleeds a fast entry back down in under three seconds, reaches
  the same trim from above or below, and is measurably slower and steeper than
  the same bird given a sleek body.
- **`src/sim/collision.test.ts`** — entry faces and normals, radius expansion,
  nearest-hit ordering, boxes spanning several grid cells, and a fast segment
  that a point test would tunnel through.
- **`src/world/layout.test.ts`** — flies a bird through the *actual* generated
  city and asserts it crashes into the skyline, never ends up inside a solid
  box, passes clean overhead when high enough, and that the broad phase stays
  fast.

- **`src/sim/energy.test.ts`** — audits the energy books on every tick of ten
  scenarios (including inverted, sideways and a deliberately violent entry),
  through crashes and landings, and at four different timesteps. Then it pins
  the rules: lift does under 1% of drag's work, drag and the keel never add
  energy, a collision never leaves the bird with more than it had, and *nothing
  but flapping* can raise total energy for any control input.

Because the city layout is plain data with no Three.js in it, the layout file
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
