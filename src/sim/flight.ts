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

import {
  add,
  clamp,
  cross,
  damp,
  dot,
  integrateOrientation,
  length,
  normalize,
  quat,
  rotate,
  rotateInverse,
  scale,
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

  /** Peak thrust of a downstroke in newtons. */
  flapThrust: number;
  /** Wingbeats per second while actively flapping. */
  flapFrequency: number;
  /** How far above the forward axis the flap pushes, in radians. */
  flapAngle: number;
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
}

export const defaultParams: FlightParams = {
  mass: 0.35,
  gravity: 9.81,
  airDensity: 1.225,

  wingArea: 0.06,
  liftSlope: 4.5,
  stallAngle: 0.28,
  postStallLift: 0.8,
  dragBase: 0.04,
  inducedDrag: 0.062,
  keelDrag: 0.35,

  tuckAreaFactor: 0.3,
  tuckDragFactor: 0.55,

  flapThrust: 4.0,
  flapFrequency: 5.5,
  flapAngle: 0.45,
  flapStaminaCost: 0.07,
  staminaRecovery: 0.14,

  pitchRate: 1.9,
  rollRate: 3.6,
  yawRate: 1.1,
  controlHalfLife: 0.09,
  controlRefSpeed: 12,
  trimAngle: 0.09,
  pitchStability: 2.2,
  yawStability: 2.6,

  groundHeight: 0,
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
}

export const neutralControls = (): Controls => ({
  pitch: 0,
  roll: 0,
  yaw: 0,
  flap: false,
  tuck: false,
});

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
  /** True while resting on the ground. */
  grounded: boolean;
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
    grounded: false,
  };
}

/**
 * Lift coefficient across the whole angle-of-attack range.
 * Linear up to the stall, then decaying to a flat-plate plateau so that
 * stalling drops you out of the sky instead of producing NaNs.
 */
export function liftCoefficient(alpha: number, p: FlightParams): number {
  const sign = Math.sign(alpha);
  const a = Math.abs(alpha);
  const peak = p.liftSlope * p.stallAngle;
  if (a <= p.stallAngle) return p.liftSlope * alpha;

  const span = Math.max(Math.PI / 2 - p.stallAngle, 1e-6);
  const t = clamp((a - p.stallAngle) / span, 0, 1);
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
): FlightTelemetry {
  const q = state.orientation;

  // --- Body frame airflow -------------------------------------------------
  const speed = length(state.velocity);
  const vBody = rotateInverse(q, state.velocity);
  const forwardSpeed = -vBody.z;

  // Angle of attack is positive when the nose sits above the flight path.
  const alpha = speed > 0.1 ? Math.atan2(-vBody.y, Math.abs(forwardSpeed) + 1e-6) : 0;
  // Sideslip, normalised: positive when sliding right.
  const beta = speed > 0.1 ? vBody.x / speed : 0;

  const tucked = controls.tuck;
  const area = p.wingArea * (tucked ? p.tuckAreaFactor : 1);
  const cl = liftCoefficient(alpha, p) * (tucked ? p.tuckAreaFactor : 1);
  const cd = dragCoefficient(alpha, cl, p) * (tucked ? p.tuckDragFactor : 1);

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
    const thrustBody = vec(0, Math.sin(p.flapAngle), -Math.cos(p.flapAngle));
    force = add(force, scale(rotate(q, thrustBody), p.flapThrust * flapPower));
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
  state.position = add(state.position, scale(state.velocity, dt));

  // --- Ground -------------------------------------------------------------
  state.grounded = false;
  if (state.position.y <= p.groundHeight) {
    state.position = vec(state.position.x, p.groundHeight, state.position.z);
    if (state.velocity.y < 0) {
      // Absorb the impact rather than bouncing; scrub off horizontal speed too.
      state.velocity = vec(state.velocity.x * 0.6, 0, state.velocity.z * 0.6);
    }
    state.grounded = true;
  }

  return {
    airspeed: speed,
    altitude: state.position.y - p.groundHeight,
    angleOfAttack: alpha,
    liftCoefficient: cl,
    dragCoefficient: cd,
    climbRate: state.velocity.y,
    stalled: Math.abs(alpha) > p.stallAngle,
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
