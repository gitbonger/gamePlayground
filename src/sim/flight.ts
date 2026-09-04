/**
 * Pigeon flight model.
 *
 * A simplified but physically-shaped aerodynamic model: real lift/drag curves
 * with a stall, plus rate-based control authority that fades with airspeed.
 * Every constant lives in `FlightParams` so it can be bound to a debug GUI and
 * tuned live -- tuning is how this gets to feel like a bird.
 *
 * Body axes follow the Three.js convention: +X right, +Y up, -Z forward.
 */

import type { Collider } from './collision';
import { closingSpeed } from './collision';
import {
  add,
  clamp,
  cross,
  damp,
  dot,
  integrateOrientation,
  length,
  lerp,
  normalize,
  quat,
  rotate,
  rotateInverse,
  scale,
  sub,
  vec,
  type Quat,
  type Vec3,
} from './math3';

export interface FlightParams {
  /** Body mass in kg. A feral pigeon is around 0.35 kg. */
  mass: number;
  gravity: number;
  airDensity: number;

  /** Wing planform area in m^2 with wings fully spread. */
  wingArea: number;
  /** Lift curve slope (dCL/dalpha) for the finite wing, per radian. */
  liftSlope: number;
  /** Angle of attack at which the wing stalls, in radians. */
  stallAngle: number;
  /** Lift retained past the stall, as a flat-plate-like plateau. */
  postStallLift: number;
  /** Parasitic drag coefficient at zero lift. */
  dragBase: number;
  /** Induced drag factor: CD_induced = inducedDrag * CL^2. */
  inducedDrag: number;
  /** Resistance to sideways slip, from the body and tail acting as a keel. */
  keelDrag: number;

  /** Wing area multiplier while diving with wings tucked. */
  tuckAreaFactor: number;
  /** Parasitic drag multiplier while tucked. */
  tuckDragFactor: number;

  /** Wing area multiplier while braking: wings spread, tail fanned. */
  brakeAreaFactor: number;
  /**
   * Drag multiplier while braking. Cupped wings, a fanned tail and lowered
   * feet are far draggier than the extra area alone would suggest, and this
   * is the term that actually sheds airspeed.
   */
  brakeDragFactor: number;
  /**
   * Extra angle of attack a braking bird can hold before stalling, in radians.
   * Stands in for the alula, the thumb feather that works as a leading-edge
   * slat -- it is what keeps a steep flare controllable instead of a stall.
   */
  brakeStallBonus: number;
  /**
   * Strength of the reversed wingbeat while braking, as a fraction of
   * `flapThrust`. A braking pigeon beats forward and down, pushing itself
   * backwards and holding itself up at the same time.
   */
  brakeFlapReverse: number;
  /**
   * How far above the backwards axis the braking stroke pushes, in radians.
   * Much steeper than a cruising beat: most of a braking stroke goes into
   * holding the bird up while it settles, not into pushing it backwards.
   */
  brakeFlapAngle: number;

  /** Peak thrust of a downstroke in newtons. */
  flapThrust: number;
  /** Wingbeats per second while actively flapping. */
  flapFrequency: number;
  /** How far above the forward axis the flap pushes at cruise, in radians. */
  flapAngle: number;
  /**
   * Stroke angle at a standstill, in radians. A bird taking off beats almost
   * straight down and gets a nearly vertical force out of it; only at speed
   * does the stroke plane tilt forward and turn into thrust. Holding the
   * cruise angle at every airspeed leaves a slow bird unable to hold itself up.
   */
  flapAngleSlow: number;
  /** Airspeed at which the stroke plane has fully tilted to `flapAngle`. */
  flapStrokeSpeed: number;
  /**
   * Thrust multiplier at a standstill, easing to 1 at `flapStrokeSpeed`.
   * Beating against still air is worth far more than beating against air
   * already rushing past.
   */
  flapSlowBoost: number;
  /**
   * How far a slow bird can aim its stroke at the sky regardless of which way
   * its body is pointing, 0..1. A hovering bird holds the stroke plane level
   * and its body hangs beneath it; without this, a bird that has fallen into a
   * nose-down attitude beats itself sideways and can never recover.
   * Fades out with airspeed, so it never becomes a cruise cheat.
   */
  flapUpright: number;
  /** Stamina consumed per second of continuous flapping. */
  flapStaminaCost: number;
  /** Stamina recovered per second while gliding. */
  staminaRecovery: number;

  /** Maximum commanded body rates in rad/s. */
  pitchRate: number;
  rollRate: number;
  yawRate: number;
  /** Half-life in seconds for body rates to approach the commanded rate. */
  controlHalfLife: number;
  /** Airspeed at which control surfaces reach full authority, in m/s. */
  controlRefSpeed: number;
  /**
   * Angle of attack the bird naturally settles at with no pitch input, in
   * radians. This is what a tail's incidence does on a real airframe: without
   * it, pitch stability trims to zero lift and the bird simply falls.
   */
  trimAngle: number;
  /** Nose-follows-trim stability about the pitch axis. */
  pitchStability: number;
  /** Weathervane stability about the yaw axis; this is what makes banking turn. */
  yawStability: number;

  /** Ground plane height in metres. */
  groundHeight: number;

  /** Collision radius of the bird, in metres. */
  bodyRadius: number;
  /**
   * Closing speed at which hitting a wall kills rather than bumps, in m/s.
   * Below this the bird scrapes to a stop and slides along the surface.
   * Touching the ground is judged by the landing limits below instead.
   */
  crashSpeed: number;

  /** Greatest descent rate the legs can absorb on touchdown, in m/s. */
  landingSink: number;
  /** Greatest airspeed a clean touchdown can be made at, in m/s. */
  landingSpeed: number;
  /** Greatest bank angle a clean touchdown can be made at, in radians. */
  landingBank: number;
}

export const defaultParams: FlightParams = {
  mass: 0.35,
  gravity: 9.81,
  airDensity: 1.225,

  wingArea: 0.06,
  liftSlope: 4.5,
  stallAngle: 0.28,
  postStallLift: 0.8,
  dragBase: 0.12,
  inducedDrag: 0.062,
  keelDrag: 0.35,

  tuckAreaFactor: 0.3,
  tuckDragFactor: 0.55,

  brakeAreaFactor: 1.4,
  brakeDragFactor: 1.6,
  brakeStallBonus: 0.25,
  brakeFlapReverse: 0.16,
  brakeFlapAngle: 1.45,

  flapThrust: 5,
  flapFrequency: 5.5,
  flapAngle: 0.45,
  flapAngleSlow: 1.35,
  flapStrokeSpeed: 12,
  flapSlowBoost: 13,
  flapUpright: 0.8,
  flapStaminaCost: 0.07,
  staminaRecovery: 0.14,

  pitchRate: 1.9,
  rollRate: 3.6,
  yawRate: 1.1,
  controlHalfLife: 0.09,
  controlRefSpeed: 12,
  trimAngle: 0.17,
  pitchStability: 2.2,
  yawStability: 2.6,

  groundHeight: 0,

  bodyRadius: 0.22,
  crashSpeed: 7.5,

  landingSink: 4,
  landingSpeed: 10,
  landingBank: 0.35,
};

export interface Controls {
  /** -1 nose down .. +1 nose up */
  pitch: number;
  /** -1 roll left .. +1 roll right */
  roll: number;
  /** -1 yaw left .. +1 yaw right */
  yaw: number;
  /** Beat the wings for thrust. */
  flap: boolean;
  /** Tuck the wings to dive. */
  tuck: boolean;
  /** Spread and cup the wings to shed airspeed. */
  brake: boolean;
}

export const neutralControls = (): Controls => ({
  pitch: 0,
  roll: 0,
  yaw: 0,
  flap: false,
  tuck: false,
  brake: false,
});

/** Why a flight ended badly. */
export type CrashCause =
  /** Flew into something solid. */
  | 'building'
  /** Came down harder than the legs can absorb. */
  | 'hard-impact'
  /** Touched down without bleeding off enough speed. */
  | 'too-fast'
  /** Touched down with a wing well down. */
  | 'not-level';

export interface Ending {
  kind: 'landed' | 'crashed';
  /** Null on a clean landing. */
  cause: CrashCause | null;
  /** Airspeed at contact, in m/s. */
  speed: number;
  /** Descent rate at contact, in m/s; negative if still climbing. */
  sink: number;
  /** Bank angle magnitude at contact, in radians. */
  bank: number;
  position: Vec3;
}

/**
 * Whether the bird could put down cleanly if it touched the ground right now.
 * Drives both the touchdown verdict and the HUD's approach cue, so the cue
 * cannot drift out of step with the rule it is reporting on.
 */
export interface LandingReadiness {
  sink: number;
  speed: number;
  bank: number;
  sinkOk: boolean;
  speedOk: boolean;
  bankOk: boolean;
  /** True when all three are within limits. */
  ready: boolean;
}

export interface BirdState {
  position: Vec3;
  velocity: Vec3;
  orientation: Quat;
  /** Angular velocity in the body frame, rad/s. */
  angularVelocity: Vec3;
  /** 0..1, drains while flapping. */
  stamina: number;
  /** 0..1 position within the current wingbeat, for animation. */
  flapPhase: number;
  /**
   * Set once the flight is over, cleanly or otherwise. The bird is inert while
   * this is non-null; the caller decides when to launch a new one.
   */
  ending: Ending | null;
}

/** Read-only diagnostics from the last step, for the HUD and tuning. */
export interface FlightTelemetry {
  airspeed: number;
  altitude: number;
  angleOfAttack: number;
  liftCoefficient: number;
  dragCoefficient: number;
  climbRate: number;
  stalled: boolean;
}

export function createBird(position: Vec3 = vec(0, 60, 0), speed = 14): BirdState {
  return {
    position,
    // Launched gliding forward along -Z.
    velocity: vec(0, 0, -speed),
    orientation: quat(),
    angularVelocity: vec(),
    stamina: 1,
    flapPhase: 0,
    ending: null,
  };
}

/**
 * Lift coefficient across the whole angle-of-attack range.
 * Linear up to the stall, then decaying to a flat-plate plateau so that
 * stalling drops you out of the sky instead of producing NaNs.
 */
export function liftCoefficient(
  alpha: number,
  p: FlightParams,
  stallAngle: number = p.stallAngle,
): number {
  const sign = Math.sign(alpha);
  const a = Math.abs(alpha);
  const peak = p.liftSlope * stallAngle;
  if (a <= stallAngle) return p.liftSlope * alpha;

  const span = Math.max(Math.PI / 2 - stallAngle, 1e-6);
  const t = clamp((a - stallAngle) / span, 0, 1);
  const plateau = p.postStallLift * Math.sin(2 * a);
  return sign * (peak * (1 - t) + plateau * t);
}

export function dragCoefficient(alpha: number, cl: number, p: FlightParams): number {
  const separation = Math.sin(Math.abs(alpha)) ** 2;
  return p.dragBase + p.inducedDrag * cl * cl + separation;
}

/**
 * Advance the bird by one fixed timestep.
 *
 * Mutates and returns `state` -- the loop runs this at a fixed rate and
 * allocating a fresh state per tick would be wasted garbage.
 */
export function step(
  state: BirdState,
  controls: Controls,
  p: FlightParams,
  dt: number,
  collider?: Collider,
): FlightTelemetry {
  // Once the flight is over the bird is inert until the caller replaces it.
  if (state.ending) return telemetryFor(state, p, 0, 0, 0, p.stallAngle);

  const q = state.orientation;

  // --- Body frame airflow -------------------------------------------------
  const speed = length(state.velocity);
  const vBody = rotateInverse(q, state.velocity);
  const forwardSpeed = -vBody.z;

  // Angle of attack is positive when the nose sits above the flight path.
  const alpha = speed > 0.1 ? Math.atan2(-vBody.y, Math.abs(forwardSpeed) + 1e-6) : 0;
  // Sideslip, normalised: positive when sliding right.
  const beta = speed > 0.1 ? vBody.x / speed : 0;

  // --- Wing configuration -------------------------------------------------
  // Braking wins over tucking: they are opposites, and a player holding both
  // is trying to slow down.
  const braking = controls.brake;
  const tucked = controls.tuck && !braking;

  const areaFactor = braking ? p.brakeAreaFactor : tucked ? p.tuckAreaFactor : 1;
  const dragFactor = braking ? p.brakeDragFactor : tucked ? p.tuckDragFactor : 1;
  const stallAngle = p.stallAngle + (braking ? p.brakeStallBonus : 0);

  const area = p.wingArea * areaFactor;
  // Folded wings shed lift out of all proportion to the area they give up:
  // what is left is mostly body, which is a poor wing.
  const liftFactor = tucked ? p.tuckAreaFactor : 1;
  const cl = liftCoefficient(alpha, p, stallAngle) * liftFactor;
  const cd = dragCoefficient(alpha, cl, p) * dragFactor;

  const dynamicPressure = 0.5 * p.airDensity * speed * speed;

  // --- Aerodynamic forces, in world space ---------------------------------
  let force = vec(0, -p.mass * p.gravity, 0);

  if (speed > 0.05) {
    const vHat = normalize(state.velocity);
    const rightWorld = rotate(q, vec(1, 0, 0));
    // Lift acts perpendicular to the airflow in the plane of symmetry, so a
    // banked wing tilts its lift sideways and the bird carves a turn.
    const liftDir = normalize(cross(rightWorld, vHat));

    force = add(force, scale(liftDir, dynamicPressure * area * cl));
    force = add(force, scale(vHat, -dynamicPressure * area * cd));

    // The body and tail resist sideways slip.
    force = add(force, scale(rightWorld, -dynamicPressure * area * p.keelDrag * beta));
  }

  // --- Wingbeat -----------------------------------------------------------
  let flapPower = 0;
  if (controls.flap && !tucked && state.stamina > 0) {
    state.flapPhase = (state.flapPhase + p.flapFrequency * dt) % 1;
    // Thrust comes from the downstroke, the first half of the cycle.
    flapPower = Math.max(0, Math.sin(state.flapPhase * Math.PI * 2));
    // A tired bird beats just as often, but with much less power behind it.
    flapPower *= clamp(state.stamina * 2, 0, 1);
    state.stamina = clamp(state.stamina - p.flapStaminaCost * dt, 0, 1);
  } else {
    // Settle the wings back to the neutral, mid-glide pose.
    state.flapPhase = damp(state.flapPhase, 0, 0.15, dt);
    state.stamina = clamp(state.stamina + p.staminaRecovery * dt, 0, 1);
  }

  if (flapPower > 0) {
    // The stroke plane rotates with airspeed: near-vertical force when slow,
    // forward thrust at cruise. This is what lets a slow bird claw its way
    // back up instead of mushing into the ground.
    const strokeBlend = clamp(speed / p.flapStrokeSpeed, 0, 1);
    const strokeAngle = p.flapAngleSlow + (p.flapAngle - p.flapAngleSlow) * strokeBlend;
    // Squared falloff, so this stays a genuinely low-speed effect and leaves
    // cruising flight as it was.
    const strokeBoost = 1 + (p.flapSlowBoost - 1) * (1 - strokeBlend) ** 2;

    // Braking reverses the stroke: the bird beats forward and down, which
    // pushes it backwards while still holding it up -- a pigeon back-pedalling
    // onto a ledge.
    const thrustBody = braking
      ? vec(0, Math.sin(p.brakeFlapAngle), Math.cos(p.brakeFlapAngle))
      : vec(0, Math.sin(strokeAngle), -Math.cos(strokeAngle));

    // A slow bird holds its stroke plane level and hangs its body beneath it,
    // so the beat still pushes at the sky even from a nose-down attitude.
    const upright = p.flapUpright * (1 - strokeBlend);
    const direction = normalize(lerp(rotate(q, thrustBody), vec(0, 1, 0), upright));

    const magnitude =
      p.flapThrust * flapPower * strokeBoost * (braking ? p.brakeFlapReverse : 1);
    force = add(force, scale(direction, magnitude));
  }

  // --- Rotation -----------------------------------------------------------
  // Control authority fades as the air gets thin over the wings, so a stalled
  // bird goes limp until it has dived back up to speed.
  const authority = clamp(speed / p.controlRefSpeed, 0.12, 1);

  const targetOmega = vec(
    controls.pitch * p.pitchRate * authority -
      (alpha - p.trimAngle) * p.pitchStability * authority,
    controls.yaw * p.yawRate * authority - beta * p.yawStability * authority,
    // Positive roll input means right wing down, which is negative about +Z.
    -controls.roll * p.rollRate * authority,
  );

  state.angularVelocity = vec(
    damp(state.angularVelocity.x, targetOmega.x, p.controlHalfLife, dt),
    damp(state.angularVelocity.y, targetOmega.y, p.controlHalfLife, dt),
    damp(state.angularVelocity.z, targetOmega.z, p.controlHalfLife, dt),
  );

  state.orientation = integrateOrientation(q, state.angularVelocity, dt);

  // --- Integrate ----------------------------------------------------------
  // Semi-implicit Euler: velocity first, then position, which stays stable at
  // the tick rates we care about.
  const acceleration = scale(force, 1 / p.mass);
  state.velocity = add(state.velocity, scale(acceleration, dt));

  const from = state.position;
  const to = add(from, scale(state.velocity, dt));

  // --- World collision ----------------------------------------------------
  // Sweep rather than test the end point: at a tucked-dive 50 m/s the bird
  // covers most of a tree in a single tick.
  if (collider) {
    const hit = collider.sweep(from, to, p.bodyRadius);
    if (hit) {
      const impact = closingSpeed(state.velocity, hit.normal);
      if (impact >= p.crashSpeed) {
        state.position = hit.point;
        state.velocity = vec(0, 0, 0);
        state.angularVelocity = vec(0, 0, 0);
        state.ending = {
          kind: 'crashed',
          cause: 'building',
          speed: length(state.velocity),
          sink: -state.velocity.y,
          bank: Math.abs(bankAngle(state)),
          position: hit.point,
        };
        return telemetryFor(state, p, alpha, cl, cd, stallAngle);
      }

      // Survivable scrape: stop at the surface and slide along it.
      state.position = add(hit.point, scale(hit.normal, 1e-3));
      state.velocity = sub(state.velocity, scale(hit.normal, dot(state.velocity, hit.normal)));
    } else {
      state.position = to;
    }
  } else {
    state.position = to;
  }

  // --- Ground -------------------------------------------------------------
  // Touching down always ends the flight; the only question is how well.
  if (state.position.y <= p.groundHeight) {
    state.position = vec(state.position.x, p.groundHeight, state.position.z);
    state.ending = touchdown(state, p);
    state.velocity = vec(0, 0, 0);
    state.angularVelocity = vec(0, 0, 0);
    return telemetryFor(state, p, alpha, cl, cd, stallAngle);
  }

  return telemetryFor(state, p, alpha, cl, cd, stallAngle);
}

export function landingReadiness(state: BirdState, p: FlightParams): LandingReadiness {
  const sink = -state.velocity.y;
  const speed = length(state.velocity);
  const bank = Math.abs(bankAngle(state));

  const sinkOk = sink <= p.landingSink;
  const speedOk = speed <= p.landingSpeed;
  const bankOk = bank <= p.landingBank;

  return { sink, speed, bank, sinkOk, speedOk, bankOk, ready: sinkOk && speedOk && bankOk };
}

/**
 * Judge a touch of the ground. Any one limit breached ruins the landing; the
 * order below only decides which fault gets named to the player, cheapest
 * mistake to fix first.
 */
function touchdown(state: BirdState, p: FlightParams): Ending {
  const r = landingReadiness(state, p);

  const cause: CrashCause | null = !r.sinkOk
    ? 'hard-impact'
    : !r.speedOk
      ? 'too-fast'
      : !r.bankOk
        ? 'not-level'
        : null;

  return {
    kind: cause ? 'crashed' : 'landed',
    cause,
    speed: r.speed,
    sink: r.sink,
    bank: r.bank,
    position: state.position,
  };
}

function telemetryFor(
  state: BirdState,
  p: FlightParams,
  alpha: number,
  cl: number,
  cd: number,
  stallAngle: number,
): FlightTelemetry {
  return {
    airspeed: length(state.velocity),
    altitude: state.position.y - p.groundHeight,
    angleOfAttack: alpha,
    liftCoefficient: cl,
    dragCoefficient: cd,
    climbRate: state.velocity.y,
    stalled: Math.abs(alpha) > stallAngle,
  };
}

/** Heading in radians, measured clockwise from north (-Z). */
export function heading(state: BirdState): number {
  const fwd = rotate(state.orientation, vec(0, 0, -1));
  return Math.atan2(fwd.x, -fwd.z);
}

/** Bank angle in radians; positive is right wing down. */
export function bankAngle(state: BirdState): number {
  const up = rotate(state.orientation, vec(0, 1, 0));
  const right = rotate(state.orientation, vec(1, 0, 0));
  return Math.atan2(-dot(right, vec(0, 1, 0)), dot(up, vec(0, 1, 0)));
}
