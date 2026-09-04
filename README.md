# Pigeon Sim

A flight simulator where you are a homing pigeon.

You are released 607 m from home, pointed straight at it. Home is the **red
building**. Get there and land on the ground beside it.

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
| `R` | Release again |
| `H` | Hide the tuning panel |

Turning is done by banking, not by yawing. Roll into the turn and the tilted
lift vector pulls you round; the tail keeps the nose following the flight path.

**Buildings and trees are solid.** Hit one above 7.5 m/s of closing speed and
the run is over. Slower than that and you scrape to a stop and slide.

**Touching the ground is the end of the flight, not of the run.** A clean
landing needs all three of: descending no faster than 4 m/s, no faster than
10 m/s through the air, and wings within 20° of level. Meet them and the bird
settles onto its feet, wings folded, facing where it landed — no summary
screen, because the game is not over. Miss any one and it is a crash, which
does end the run and does name what went wrong.

The approach is **brake to slow, beat to settle, flare to touch down**.
Coasting brings you to about 11 m/s; holding `Ctrl` takes that to 5 m/s in two
seconds, but it also doubles your descent rate — an airbrake is not a parachute.
Holding `Space` at the same time reverses the wingbeat and arrests the sink,
which is the configuration you actually land from. Then pull the nose up at
roughly **2 metres**.

Braking without beating will slow you beautifully and then drive you into the
ground; that is correct, and it is the single most useful thing to learn.

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
scripts/
  fetch-map.ts bakes a real street network from OpenStreetMap
src/
  sim/         flight model, 3D math, collision, wind — pure, no renderer imports
  render/      scene, bird rig, chase camera, HUD, game-over panel
  world/       streets.ts indexes real roads and areas.ts real parks;
               from-map.ts and layout.ts produce a CityLayout; city.ts turns
               one into meshes
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

## The route

Two points in the world, named in degrees and projected into local metres by
`src/world/geo.ts`, which the map baker and the game share so a coordinate
lands in the same place in both:

| | |
| --- | --- |
| Release | 47.491540, 19.075658 |
| Home | 47.494953, 19.081954 |
| Distance | 607 m, on a bearing of 51° |

The bird is released **pointing exactly at home**, which is what `createBird`'s
heading argument is for.

**Distance is not the challenge, and the route is not sized against a glide.**
Stamina recovers at 0.14/s and drains at 0.07/s, so the bird can beat its wings
two thirds of the time indefinitely, and at that duty cycle it gains about a
metre a second. It can stay up and keep going as long as it likes. 607 m is a
distance you can cover several ways, not a budget you have to make last.

What the route asks for is the *arrival*: slow enough, low enough and level
enough to put down beside the red building, in a street bounded by 16–24 m
buildings. Coasting all the way there is one way to get it wrong — the bird
turns up 44 seconds later doing 12.7 m/s at 11 m, below the rooftops and much
too fast — but that is an observation about one way to fly it, not a limit.

The home point itself sits on open ground 13 m from a residential street, so
the red landmark is the building nearest it, about 32 m away.

Whichever generated building lands nearest the home point is marked, and drawn
in red. It gets its own mesh rather than a seventh instanced bucket, because it
is one building among five thousand.

## Flying over a real place

The streets are real. The buildings are not.

`scripts/fetch-map.ts` queries OpenStreetMap for the roads around a point,
projects them into local metres, simplifies the polylines and bakes a JSON
asset. Run it once and commit the result — the game never talks to a map
server, so it works offline and cannot be broken by someone else's rate limit.

```bash
npm run fetch-map -- --centre 47.494593,19.081282 --radius 1200 --name home
```

The shipped world is that square of Budapest: 986 roads, 1,428 segments, 77 kB.
The bird spawns directly over the centre point, raised clear of whatever stands
there.

**Why not real buildings too?** Because OSM's road coverage is essentially
complete worldwide while its building *heights* are patchy — in most cities
you would get footprints with no height and have to invent them anyway. Seen
from the air, what makes a place recognisable is the street pattern.

**Parks are left alone.** The baker also fetches green space and water —
`leisure=park`, `landuse=grass|forest|cemetery`, `natural=wood|water` and
friends — mapped to four coarse kinds. 243 areas here, 97% of them closed ways;
the handful of multipolygon relations are taken as their outer rings, which
ignores holes and at worst costs a few houses that were never there.

Nothing is built on that ground, and the check is on all four corners of the
turned footprint rather than the centre, because a building set back from a
road can still reach across a boundary it is not centred on. Parks and woods
get planted instead. Excluding them removed 599 buildings and nearly tripled
the trees, from 299 to 847.

This is most of what stops a generated city looking generated: real cities have
holes in them, and the holes are not random.

**How the buildings get placed.** Not by extracting true city blocks: that
means finding the faces of a planar graph, which is fragile against real map
data — bridges cross tunnels without meeting, ways dangle, and one bad node
swallows a whole block. Instead, candidates are scattered on a jittered grid
and rejected if they fall in a road, which is robust against all of it:

- Each candidate asks the street index for its nearest road.
- It has to sit **behind the kerb by half its own depth**, so the near wall
  clears the carriageway rather than just the centre — a deep building set back
  only by its centre still overhangs the street it fronts.
- It has to be inside a **frontage band**, so buildings line the streets and
  block interiors stay open instead of filling solid. Interiors get trees.
- Height comes from a flat 16–24 m band rather than from road importance. This
  neighbourhood is uniformly about seven floors, and that evenness *is* what
  its skyline looks like.

Then the detail that does most of the work: **every building is turned to face
its street**. That is the difference between boxes near lines and a city. From
central Budapest it produces 126 distinct building orientations; a grid city
would have about two.

**Turning them meant the collider had to stop being axis-aligned.** The world
bounds of a 12 m building turned 45° are 40% wider than the building, which
would be felt as invisible walls while threading between them. A `Box` now
carries an optional `yaw`, and the sweep rotates the ray into the box's own
frame, runs *the identical slab test*, and rotates the answer back — exact
oriented-box collision that reuses the tested path rather than adding a second
one. The uniform grid still indexes world bounds for broad phase.

From 1,428 real street segments and 243 green areas: 5,008 buildings and 847
trees, built in 24 ms, with 20,000 collision sweeps in under 20 ms.

OpenStreetMap data is ODbL. The baked file is a derived database, so it carries
the attribution and the HUD keeps it on screen.

## Wind

Pigeons almost never coast in a straight line. `src/sim/wind.ts` is why this
one doesn't either.

There is **no stored wind map**. The field is a pure function of position and
time, so only the air the bird is actually flying through ever gets computed.
Two layers:

- **A mean that strengthens with height**, on the power law used for
  atmospheric boundary layers. Friction drags the lowest air to a near
  standstill and the `shear` exponent says how quickly it recovers — about 0.3
  over rooftops. At the defaults that is 0 m/s at ground level, 2.0 at 10 m,
  4.0 at 100 m, 5.3 at 250 m.
- **Gusts on top**, as smooth spatial noise that also churns in place, scaled
  by the local mean so the air is rougher where it is faster.

**Faster across the map means rougher air, and nothing in the model tracks
ground speed to achieve it.** Because the gusts vary with *position*, covering
ground quickly means running through them quickly. Measured as the rate the
wind vector changes under the bird:

| Ground speed | Air changes at |
| --- | --- |
| 0 m/s (holding station) | 0.32 m/s per second |
| 11 m/s (cruise) | 0.64 |
| 20 m/s | 1.08 |
| 50 m/s (dive) | 2.60 |

Getting that monotonic took two goes. The first field had every octave drifting
the same way, so at about 30 m/s the bird surfed along with the pattern and the
gusts went eerily still — churn *fell* from 0.67 to 0.06. The octaves now point
every which way with mixed-sign rates, and a test sweeps ground speeds from 2
to 60 m/s to make sure no such blind spot comes back.

Wings work against the air, not the ground, so every aerodynamic force now uses
velocity **relative to the local air**, while gravity and the position update
stay in the world frame. That splits airspeed from ground speed — both are on
the HUD, along with the local wind and whether it is head, tail or cross.

One consequence worth knowing: **in wind, drag can add energy to the bird.**
Drag is only guaranteed dissipative in the air's own frame; measured against
the ground, a tailwind gust hands you energy. That is real, and the ledger
still balances to floating point because the work is booked where it happens.

Landing barely notices: the best technique goes from 67% to 61% across the
open-loop grid. Set `mean at 100 m` to 0 in the `wind` folder for dead calm.

The asymmetric beating pigeons use to hold a line against a crosswind is not
modelled.

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

## How the wing works

Three things about lift are worth stating, because the intuitive version of
each is subtly wrong and the model deliberately does not follow it.

**Banking does not shrink the wing, it turns the lift sideways.** Lift acts
perpendicular to the airflow, so rolling the bird rotates the whole lift vector
rather than reducing it. The observable is the one you would expect — a bird
with its wings vertical has nothing holding it up and falls out of the sky, at
about 17 m/s against 1 m/s wings-level — but the *reason* matters, because the
lift did not vanish. It went sideways, and that sideways lift is exactly what
makes the turn. Falling and turning are two views of the same vector, which is
why a projected-horizontal-area model would be wrong: it would take away the
turn along with the height.

| Bank | Sink |
| --- | --- |
| 0° | 1.2 m/s |
| 30° | 3.8 m/s |
| 45° | 6.6 m/s |
| 60° | 10.0 m/s |
| 90° | 16.7 m/s |

**Gravity is unconditional.** It is applied every tick with no special cases:
one tick from rest is exactly `-g·dt`, and in vacuum (`airDensity: 0`) free
fall is exact to nine decimal places. A bird dropped from rest in *real* air
only reaches 7.4 m/s after a second, but that is drag, not missing gravity —
falling belly-first puts the wing at a 39° angle of attack with a drag
coefficient of 0.6. A pigeon is a fairly good parachute.

**A braking wing is not a wing, and its drag is not a multiple of a wing's.**
Spreading and cupping adds 40% to the area, but that area is held broadside
with the flow separated behind it, so `brakeLiftFactor` discounts the lift back
down — the net is *no extra lift at all* from 40% more wing.

The drag side is where this was originally wrong, and badly. A braking wing is
a **flat plate**, and a flat plate's drag coefficient is of order one. The
first version multiplied the *streamlined* coefficient by 1.6, which gave about
0.19 — so braking dipped the airspeed a knot or two, settled into a steeper
path, and gravity handed the speed straight back. From a real 11.6 m/s coast it
recovered to 10.7 m/s within five seconds. It was not a brake at all.

`brakeDrag` is therefore an absolute coefficient (1.2) added on top, not a
multiplier. Braking now behaves the way it looks:

| From an 11.6 m/s coast | Coasting | Braking |
| --- | --- | --- |
| Airspeed after 2 s | 10.7 m/s | **5.1 m/s** |
| Airspeed after 12 s | 10.8 m/s | **6.6 m/s** |
| Height lost over 12 s | 14 m | **27 m** |

Which means braking is a way to stop, not a way to float: it costs you height
at nearly twice the rate of a coast. Arresting that is what the **reversed
beat** is for, and it is why a pigeon beats all the way onto the ledge rather
than gliding the last few metres. The landing ladder reflects it — flare alone
lands 30% of open-loop approaches, brake *and* flare only 9%, and brake with
the reversed beat 64%.

## How the wingbeat works

A wingbeat is not a fixed push. Its direction and strength both depend on how
fast the bird is already moving through the air, and getting this wrong is what
made an early build feel dead near the ground:

- **Beating harder means beating faster.** A wing's force goes with the square
  of how fast it sweeps through the air, and that speed is set by the beat
  rate, so thrust scales with the square of `flapFrequency`. This was missing
  entirely: the time-average of `max(0, sin)` is `1/π` of the peak whatever the
  frequency, so the beat rate only changed how fast the wings waggled. With it,
  the model lands on a real pigeon's takeoff: below 2 beats a second the bird
  cannot hold itself up, and somewhere between 2 and 3 it starts to climb.

  | Beats/s | Average vertical force | From a standstill |
  | --- | --- | --- |
  | 1 | 0.3 × body weight | sinks |
  | 2 | 0.7 × | sinks |
  | 3 | 1.3 × | climbs |
  | 5.5 (default) | 3.2 × | climbs strongly |

  One beat at the default rate is worth about 5.7 m/s of vertical speed from a
  standstill. `flapReferenceRate` is the rate at which `flapThrust` is the peak
  force, and it ships equal to `flapFrequency`, so the default is a no-op.

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
- **The stroke plane is bolted to the shoulders.** The force comes out of the
  bird's back and nowhere else — a bird aims its thrust by pointing its *body*,
  which is why a hovering hummingbird stands itself upright. Measured, the beat
  holds a fixed angle to the back in every attitude (16° at rest, 39° at 6 m/s,
  65° at cruise), while its angle to the world swings with the bird:

  | Attitude | Beat direction relative to the world |
  | --- | --- |
  | Level | 16° off straight up |
  | 60° nose-down | 76° off up — very nearly horizontal |
  | 90° bank | exactly horizontal, no vertical component at all |
  | Inverted | 164° off up — driving itself at the ground |

  So a diving bird cannot beat its way up; it has to pull the nose up first,
  and only then does the beat help. An earlier version blended the force toward
  vertical at low speed to make panic-flapping forgiving, which was a fudge and
  is gone. It turned out to cost nothing: climb rates are identical and the
  landing rate went *up*, because pulling up before beating was always the
  correct technique and the blend only rescued people who did not.

The result: panic-flapping *while pulling the nose up* recovers 11–14 m in
three seconds from a 4 m/s sink, at any speed. Without the pitch input it
recovers nothing, which is the point — attitude is how a bird aims its engine.
A committed 45 m/s dive still cannot be flapped away, so the low-speed boost
never becomes a universal airbrake.

## How braking works

A pigeon has no airbrake, so it brakes with three things at once, and all three
are modelled:

- **Spreading.** Wings out and tail fanned: `brakeAreaFactor` × 1.4 area, and
  `brakeDrag` adds a flat-plate coefficient of 1.2 on top of the streamlined
  one. That absolute term is what actually sheds speed — see *How the wing
  works* for why a multiplier could not.
- **The alula.** `brakeStallBonus` adds 0.25 rad to the stall angle. The alula
  is the bird's thumb feather, working as a leading-edge slat; without it a
  steep flare just stalls, and with it the flare stays controllable. This is
  the difference between a brake that is a tool and a brake that is a trap.
- **Reversing the beat.** Flapping while braking beats forward and down instead
  of back and down. The stroke plane goes nearly vertical (`brakeFlapAngle`
  1.45 rad), so most of it holds the bird up while the rest pushes it
  backwards — which is why braking *and* beating settles at 7.5 m/s and 2.7 m/s
  sink, slower and gentler than braking alone.

A flare is a transient that ends in a stall; the brake is a configuration you
can sit in, at the price of height. They are complementary, which is why
landing wants both, plus the beat to pay the height back.

The measured effect: across a grid of open-loop approaches, flaring alone lands
30% of the time, braking *without* the beat only 9% — because spreading the
wings now genuinely drops you — and braking with the reversed beat 64%.

## Landing, and being perched

`isPerched()` and `hasCrashed()` split what used to be one terminal state. A
crash raises the end-of-flight panel and the run is over. A landing does not:
the bird stands there, wings folded and legs down, with the camera settled
close in on it, and the HUD saying so.

Two small things that make it read as standing rather than stopped. The bird's
orientation is levelled on touchdown, keeping its heading, because a bird that
lands settles onto its feet instead of freezing in its flare. And the rendered
body is lifted 0.14 m — the simulation tracks a point at the bird's centre and
stops it at ground level, which would otherwise bury half the model. That
offset is a rendering concern and lives in the rig, not the flight model.

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

172 tests across eight files:

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
  beat arrests the descent that spreading causes, the alula bonus
  keeps a fixed angle of attack unstalled that stalls without it, braking
  overrides tucking, and an approach flared too late to save itself lands when
  braked.
  Vertical authority is pinned separately: the low-speed boost turns a sinking
  slow bird into a climbing one and fades to nothing by cruise, the beat buys
  altitude when slow and ground speed at cruise, a sinking bird recovers when
  it pulls up, the beat holds a fixed angle to the bird's back in every
  attitude (and is exactly horizontal at knife-edge), and a committed dive
  still cannot be flapped away.
  Coasting has its own group: a coast settles well below what powered level
  flight holds, bleeds a fast entry back down in under three seconds, reaches
  the same trim from above or below, and is measurably slower and steeper than
  the same bird given a sleek body.
  Wing physics has one too: sink rises monotonically with bank angle and the
  bird still turns hardest where it holds height worst, gravity is exact from
  rest and in vacuum, thrust scales with the square of the beat rate, takeoff
  breaks even between two and three beats a second, and a braking wing makes
  less lift than a spread one despite covering more area.
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

- **`src/sim/wind.test.ts`** — the profile is still at ground level and
  strengthens with height, gusts scale with the mean, the air roughens
  monotonically with ground speed, no ground speed between 2 and 60 m/s makes
  it go quiet, a coast drifts off a straight line while a calm one does not,
  airspeed separates from ground speed, calm air reproduces the old flight
  model bit for bit, and the energy books balance even though moving air can do
  work on the bird.

- **`src/world/areas.test.ts`** — point-in-polygon follows a concave boundary
  rather than its bounding box, and a footprint that reaches into a park by one
  corner is caught even when its centre is clear.
- **`src/world/from-map.test.ts`** — the street index measures to the ends of
  roads rather than infinite lines; buildings never overhang the carriageway
  they front, stay inside the frontage band, face their street, and grow taller
  on more important roads; the street itself is flyable end to end while
  crossing it nearly always meets something; heights stay in their band
  whatever road a building is on; and exactly one building is marked as the
  target, the one actually nearest it. Green space has its own group, including
  a control that the test park covers ground the generator *would* have built
  on — a park in a block interior would prove nothing.

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
5. **Taking off again.** A perched bird holds its position and nothing else;
   `isPerched()` is the hook. Launching wants a leg push, and a first wingbeat
   from a standstill already carries 11.6 times body weight, so most of the
   physics is there — what is missing is the transition out of the resting
   state.
6. **A crash you can see.** The bird currently freezes at the impact point.
   Tumbling it, or leaving a puff of feathers, would cost little.
