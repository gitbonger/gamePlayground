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
| `Space` | Flap — costs stamina, climbs about 3 m/s |
| `Shift` | Tuck the wings and dive |
| `R` | Respawn |
| `H` | Hide the tuning panel |

Turning is done by banking, not by yawing. Roll into the turn and the tilted
lift vector pulls you round; the tail keeps the nose following the flight path.

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
  sim/       flight model and 3D math — pure, no renderer imports
  render/    scene, bird rig, chase camera, HUD
  world/     procedural city
  input.ts   keyboard to control axes
  main.ts    fixed-timestep loop, GUI wiring
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

## Tests

```bash
npm test
```

`src/sim/flight.test.ts` covers the shape of the lift curve, glide ratio and
sink rate staying in a plausible band, flapping climbing and draining stamina,
tucked dives outrunning spread ones, banking producing a heading change with no
yaw input, pitch stability recovering to trim, ground contact, determinism, and
that no input sequence can produce a NaN.

## Where this goes next

1. **Collision.** `buildWorld` already returns an AABB per building; nothing
   consumes them yet. Swept-sphere against those boxes is enough.
2. **A real pigeon.** `src/render/bird.ts` is primitives behind a two-method
   interface; replace it with a glTF model and a skeletal flap loop.
3. **Air.** Thermals over rooftops and ridge lift off building faces — add a
   wind field sampled at the bird's position and subtract it from velocity
   before the aerodynamics run.
4. **Sound.** Wind noise pitched by airspeed and a wingbeat driven by
   `flapPhase`. This is the cheapest large gain available.
5. **Something to do.** Perching, breadcrumbs, racing through gaps.
