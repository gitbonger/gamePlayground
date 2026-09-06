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
import { energyOf, workDone, zeroWork, type EnergyState, type WorkLedger } from './energy';
import { calm, type WindField } from './wind';
import {
  add,
  clamp,
  cross,
  damp,
  dot,
  integrateOrientation,
  length,
  normalize,
  quatFromAxisAngle,
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
   * Lift multiplier while braking. Below one on purpose: cupped wings held
   * broadside at a high angle of attack are an airbrake, not a wing. They
   * still carry some weight -- that is what a flare is for -- but far less
   * than their spread area would suggest.
   */
  brakeLiftFactor: number;
  /**
   * Drag coefficient added while braking, referenced to wing area.
   *
   * This is an absolute figure rather than a multiplier on purpose. A wing
   * held broadside with the flow separated behind it is a flat plate, and a
   * flat plate's coefficient is of order one -- not a small multiple of the
   * streamlined value, which is nearer 0.1. Scaling the streamlined figure
   * gave a brake that could not actually stop anything: the bird dipped a
   * knot or two, settled into a steeper path, and gravity handed the speed
   * straight back.
   */
  brakeDrag: number;
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
  /**
   * The beat rate at which `flapThrust` is the peak force, in Hz.
   *
   * A wing's aerodynamic force goes with the square of how fast it sweeps
   * through the air, and that speed is set by the beat rate, so force scales
   * with the square of frequency. Without this, `flapFrequency` only changed
   * how fast the wings waggled: the time-averaged thrust of `max(0, sin)` is
   * `1/pi` of the peak whatever the frequency, so beating twice as hard did
   * nothing at all.
   */
  flapReferenceRate: number;
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
  /** Stamina consumed per second of continuous flapping. */
  flapStaminaCost: number;
  /** Stamina recovered per second while gliding. */
  staminaRecovery: number;
  /**
   * How much of a full belly it costs to recover one bar of stamina.
   *
   * Food is what stamina is made of. Resting gets the wings back and eats
   * into what the bird had for breakfast, which is the honest way round: a
   * pigeon that has flown all afternoon is not tired, it is hungry, and
   * resting on a roof does not fix that.
   *
   * Measured rather than picked. Level flight -- beating when sinking,
   * gliding when climbing -- covers three kilometres in 218 seconds and
   * cycles 1.96 bars of stamina through recovery. At 0.51 of a belly per bar
   * that is one full belly for three kilometres, which is the figure this was
   * asked to hit.
   */
  bellyPerStamina: number;

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
  /**
   * How fast a solid has to be moving before being touched by it is fatal,
   * in m/s.
   *
   * Because a wall you walk into and a train that runs into you are not the
   * same event, however similar the geometry: one of them chose the moment.
   * A pigeon standing on a rail as a wagon arrives is not going to scrape
   * gently along the side of it.
   *
   * Which way round the two are moving does not come into it. A bird that
   * walks into the flank of a moving train has been run over just as surely
   * as one that stood still and let it come, and asking whose fault it was
   * would need a closing speed the collider does not report.
   */
  struckSpeed: number;

  // --- On foot ------------------------------------------------------------
  /**
   * Walking speed in m/s, reached at once and held. A pigeon on the ground
   * has one gear: it is either walking or it is not.
   */
  walkSpeed: number;
  /** How fast it turns on the spot while walking, in rad/s. */
  walkTurnRate: number;
  /** The tallest thing it will step up onto, in metres. */
  walkStepUp: number;
  /**
   * The longest drop it will step down, in metres. Anything further is
   * walking off an edge, and the bird is in the air again.
   */
  walkStepDown: number;
  /** Ground covered by one full stride, in metres. Drives the animation. */
  walkStride: number;
  /**
   * Speed a standing bird leaves the ground at, in m/s.
   *
   * A pigeon does not roll for a take-off, it leaves with a wing-clap: from
   * standing to flying speed in a beat or two. So the launch is a velocity
   * given outright rather than a force applied over time, which is a fair
   * description of something that happens inside a fifth of a second.
   */
  launchSpeed: number;
  /** How steeply it leaves, in radians above the horizontal. */
  launchAngle: number;

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
  dragBase: 0.05,
  inducedDrag: 0.062,
  keelDrag: 0.35,

  tuckAreaFactor: 0.3,
  tuckDragFactor: 0.55,

  brakeAreaFactor: 1.4,
  brakeLiftFactor: 0.7,
  brakeDrag: 1.2,
  brakeStallBonus: 0.25,
  brakeFlapReverse: 0.16,
  brakeFlapAngle: 1.45,

  flapThrust: 5,
  flapFrequency: 5.5,
  flapReferenceRate: 5.5,
  flapAngle: 0.45,
  flapAngleSlow: 1.35,
  flapStrokeSpeed: 12,
  flapSlowBoost: 13,
  flapStaminaCost: 0.07,
  staminaRecovery: 0.14,
  bellyPerStamina: 0.51,

  pitchRate: 1.9,
  rollRate: 3.6,
  yawRate: 1.1,
  controlHalfLife: 0.09,
  controlRefSpeed: 12,
  trimAngle: 0.1,
  pitchStability: 2.2,
  yawStability: 2.6,

  groundHeight: 0,

  bodyRadius: 0.22,
  crashSpeed: 7.5,
  struckSpeed: 0.5,

  walkSpeed: 1.2,
  walkTurnRate: 2.5,
  walkStepUp: 0.12,
  walkStepDown: 0.25,
  walkStride: 0.16,
  launchSpeed: 11,
  launchAngle: 0.4,

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
  | 'not-level'
  /** Run into by something that was already moving. */
  | 'struck';

/**
 * How a flight finished.
 *
 * Only `crashed` ends the run. A `landed` bird is perched: at rest on the
 * ground, out of the air but still very much in the game, waiting for a
 * takeoff that does not exist yet.
 */
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
  /**
   * What is left in the belly, 1 to 0.
   *
   * Not a health bar in the usual sense: nothing takes it away but flying,
   * and nothing puts it back but eating. At zero the wings stop recovering --
   * a starving bird can still beat what it has left, and cannot get any of it
   * back.
   */
  health: number;
  /** 0..1 position within the current wingbeat, for animation. */
  flapPhase: number;
  /** 0..1 position within the current stride, for animation on foot. */
  stridePhase: number;
  /** Seconds since launch. Drives anything that has to evolve in time. */
  age: number;
  /**
   * Set once the flight is over, cleanly or otherwise. The bird is inert while
   * this is non-null; the caller decides when to launch a new one.
   */
  ending: Ending | null;
  /**
   * What it came to rest on, as whatever tag that solid was given, or null for
   * the ground and for anything in the air.
   *
   * Meaningless here on purpose. A bird standing on a wagon has to go where
   * the wagon goes, and this is how whoever is moving the wagon knows the bird
   * is aboard -- without the flight model needing to know what a wagon is.
   */
  restingOn: number | null;
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
  /** Speed over the ground, in m/s. Differs from airspeed in wind. */
  groundSpeed: number;
  /** Air velocity where the bird is, in m/s. */
  wind: Vec3;
  /** Headwind component, positive when the air opposes the flight path. */
  headwind: number;
  /** Mechanical energy at the end of the tick. */
  energy: EnergyState;
  /** Joules each force added or removed over the tick. */
  work: WorkLedger;
}

export function createBird(
  position: Vec3 = vec(0, 60, 0),
  speed = 14,
  /** Compass heading to launch on, radians clockwise from north. */
  heading = 0,
): BirdState {
  // Three.js measures rotation about Y the other way round from a compass.
  const orientation = quatFromAxisAngle(vec(0, 1, 0), -heading);
  return {
    position,
    // Launched gliding along whatever way it is pointed.
    velocity: rotate(orientation, vec(0, 0, -speed)),
    orientation,
    angularVelocity: vec(),
    stamina: 1,
    health: 1,
    flapPhase: 0,
    stridePhase: 0,
    age: 0,
    ending: null,
    restingOn: null,
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
/** Everything about the wings that does not depend on how fast the air moves. */
interface WingSetup {
  area: number;
  liftFactor: number;
  dragFactor: number;
  /** Absolute drag coefficient added on top, for airbrake configurations. */
  dragOffset: number;
  stallAngle: number;
  braking: boolean;
  flapPower: number;
}

/** Velocity-dependent forces and the flow angles they came from. */
interface Airflow {
  speed: number;
  alpha: number;
  beta: number;
  cl: number;
  cd: number;
  lift: Vec3;
  drag: Vec3;
  keel: Vec3;
  flap: Vec3;
}

/**
 * Aerodynamic and wingbeat forces for a given velocity through the air.
 *
 * Pure in the velocity, so `step` can evaluate it twice and use the midpoint.
 * That matters for more than accuracy: lift is perpendicular to the airflow
 * and must therefore do no work, and holding a start-of-tick lift direction
 * across the whole tick quietly breaks that in hard turns.
 */
function forcesAt(velocity: Vec3, q: Quat, p: FlightParams, wing: WingSetup): Airflow {
  const speed = length(velocity);
  const vBody = rotateInverse(q, velocity);

  // Angle of attack is positive when the nose sits above the flight path.
  const alpha = speed > 0.1 ? Math.atan2(-vBody.y, Math.abs(-vBody.z) + 1e-6) : 0;
  // Sideslip, normalised: positive when sliding right.
  const beta = speed > 0.1 ? vBody.x / speed : 0;

  const cl = liftCoefficient(alpha, p, wing.stallAngle) * wing.liftFactor;
  const cd = dragCoefficient(alpha, cl, p) * wing.dragFactor + wing.dragOffset;

  const dynamicPressure = 0.5 * p.airDensity * speed * speed;
  const rightWorld = rotate(q, vec(1, 0, 0));

  let lift = vec(0, 0, 0);
  let drag = vec(0, 0, 0);
  let keel = vec(0, 0, 0);

  if (speed > 0.05) {
    const vHat = normalize(velocity);
    // Lift acts perpendicular to the airflow in the plane of symmetry, so a
    // banked wing tilts its lift sideways and the bird carves a turn.
    const liftDir = normalize(cross(rightWorld, vHat));

    lift = scale(liftDir, dynamicPressure * wing.area * cl);
    drag = scale(vHat, -dynamicPressure * wing.area * cd);
    // The body and tail resist sideways slip.
    keel = scale(rightWorld, -dynamicPressure * wing.area * p.keelDrag * beta);
  }

  let flap = vec(0, 0, 0);
  if (wing.flapPower > 0) {
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
    const thrustBody = wing.braking
      ? vec(0, Math.sin(p.brakeFlapAngle), Math.cos(p.brakeFlapAngle))
      : vec(0, Math.sin(strokeAngle), -Math.cos(strokeAngle));

    // The stroke plane is bolted to the shoulders, so the force comes out of
    // the bird's back and nowhere else. A bird aims its thrust by pointing its
    // body -- which is why a hovering hummingbird stands its body upright, and
    // why a pigeon diving nose-first can only beat itself sideways until it
    // pulls the nose up first.
    const direction = rotate(q, thrustBody);

    // Force goes with the square of the beat rate, so a bird that wants to
    // beat gravity beats faster.
    const rate = (p.flapFrequency / Math.max(p.flapReferenceRate, 1e-6)) ** 2;

    const magnitude =
      p.flapThrust *
      wing.flapPower *
      rate *
      strokeBoost *
      (wing.braking ? p.brakeFlapReverse : 1);
    flap = scale(direction, magnitude);
  }

  return { speed, alpha, beta, cl, cd, lift, drag, keel, flap };
}

const sumForces = (a: Airflow, gravity: Vec3): Vec3 =>
  add(add(gravity, a.lift), add(a.drag, add(a.keel, a.flap)));

export function step(
  state: BirdState,
  controls: Controls,
  p: FlightParams,
  dt: number,
  collider?: Collider,
  wind: WindField = calm,
): FlightTelemetry {
  // Once the flight is over the bird is inert until the caller replaces it.
  if (state.ending) {
    return telemetryFor(state, p, 0, 0, 0, p.stallAngle, zeroWork(), vec(0, 0, 0));
  }

  state.age += dt;

  const q = state.orientation;

  // --- Wingbeat -----------------------------------------------------------
  // Advanced before the forces, because the phase and stamina are state rather
  // than functions of velocity, and must not be stepped twice below.
  const braking = controls.brake;
  const tucked = controls.tuck && !braking;

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
    // Recovery is paid for out of the belly, and an empty one buys nothing.
    // Measured from what actually goes back into the wings rather than from
    // what was offered, so a bird resting at full stamina eats nothing --
    // sitting on a branch is free, and only the recovering costs.
    const wanted = state.health > 0 ? p.staminaRecovery * dt : 0;
    const gained = clamp(state.stamina + wanted, 0, 1) - state.stamina;
    state.stamina += gained;
    state.health = clamp(state.health - gained * p.bellyPerStamina, 0, 1);
  }

  // --- Wing configuration -------------------------------------------------
  // Braking wins over tucking: they are opposites, and a player holding both
  // is trying to slow down.
  const wing: WingSetup = {
    area: p.wingArea * (braking ? p.brakeAreaFactor : tucked ? p.tuckAreaFactor : 1),
    // Folded wings shed lift out of all proportion to the area they give up:
    // what is left is mostly body, which is a poor wing. Braked wings give up
    // lift too, for the opposite reason: too much angle, too little airflow
    // still attached to them.
    liftFactor: braking ? p.brakeLiftFactor : tucked ? p.tuckAreaFactor : 1,
    dragFactor: tucked ? p.tuckDragFactor : 1,
    dragOffset: braking ? p.brakeDrag : 0,
    stallAngle: p.stallAngle + (braking ? p.brakeStallBonus : 0),
    braking,
    flapPower,
  };

  // --- Forces, evaluated at the midpoint of the tick -----------------------
  const gravityForce = vec(0, -p.mass * p.gravity, 0);
  const before = state.velocity;

  // Wings work against the air, not the ground. Everything aerodynamic uses
  // velocity relative to the local air; gravity and the position update stay
  // in the world frame.
  const airVelocity = wind.at(state.position, state.age);

  const start = forcesAt(sub(before, airVelocity), q, p, wing);
  const predicted = add(before, scale(sumForces(start, gravityForce), dt / p.mass));
  const mean = scale(add(before, predicted), 0.5);
  const flow = forcesAt(sub(mean, airVelocity), q, p, wing);

  const { alpha, beta, cl, cd } = flow;
  const speed = start.speed;

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
  const acceleration = scale(sumForces(flow, gravityForce), 1 / p.mass);
  state.velocity = add(before, scale(acceleration, dt));

  // --- Energy ledger ------------------------------------------------------
  // Work at the mean velocity, which for this integrator is exactly the change
  // in kinetic energy -- so the books balance to floating-point, not to a
  // tolerance. The leftover term is the integrator's own O(dt^2) artefact,
  // named rather than absorbed.
  const meanVelocity = scale(add(before, state.velocity), 0.5);
  const work = zeroWork();
  work.flap = workDone(flow.flap, meanVelocity, dt);
  work.lift = workDone(flow.lift, meanVelocity, dt);
  work.drag = workDone(flow.drag, meanVelocity, dt);
  work.keel = workDone(flow.keel, meanVelocity, dt);
  work.integration = (p.mass * p.gravity * dt * (state.velocity.y - before.y)) / 2;

  const from = state.position;
  const to = add(from, scale(state.velocity, dt));

  // --- World collision ----------------------------------------------------
  // Sweep rather than test the end point: at a tucked-dive 50 m/s the bird
  // covers most of a tree in a single tick.
  if (collider) {
    const hit = collider.sweep(from, to, p.bodyRadius);
    if (hit) {
      // Rolling back to the contact point moves the bird vertically, so that
      // potential energy is work done by the contact and has to be booked
      // here: both branches below return before the shared accounting.
      work.collision = p.mass * p.gravity * (hit.point.y - to.y);

      if (hit.normal.y >= ROOF_NORMAL) {
        // Something you could stand on. A roof is judged exactly as the ground
        // is -- come down slow, level and gently and you have landed on it.
        settle(state, p, work, hit.point, hit.carrier);
        return telemetryFor(state, p, alpha, cl, cd, wing.stallAngle, work, airVelocity);
      }

      // Being run into is not the same event as running into something, and
      // the difference is whether the other thing was going anywhere. Below
      // `crashSpeed` a bird bumps a wall and slides off it; the flank of a
      // moving train it does not. The exception is above, not here: putting
      // down on the deck is judged as a landing before any of this is reached.
      // Both being null is not a match: a bird in the air is riding nothing
      // and an untagged solid belongs to nobody, and reading that as "it is
      // standing on the thing that hit it" exempts the whole world.
      const aboard = state.restingOn !== null && hit.carrier === state.restingOn;
      const struck = hit.speed >= p.struckSpeed && !aboard;
      const impact = closingSpeed(state.velocity, hit.normal);
      if (struck || impact >= p.crashSpeed) {
        // Read the arrival before the velocity is spent on it, or the report
        // is of a bird that hit a wall at nothing.
        const arrival = {
          speed: length(state.velocity),
          sink: -state.velocity.y,
          bank: Math.abs(bankAngle(state)),
        };
        state.position = hit.point;
        work.collision -= kinetic(state.velocity, p);
        state.velocity = vec(0, 0, 0);
        state.angularVelocity = vec(0, 0, 0);
        state.ending = {
          kind: 'crashed',
          cause: struck ? 'struck' : 'building',
          ...arrival,
          position: hit.point,
        };
        return telemetryFor(state, p, alpha, cl, cd, wing.stallAngle, work, airVelocity);
      }

      // Survivable scrape: stop at the surface and slide along it.
      state.position = add(hit.point, scale(hit.normal, 1e-3));
      const beforeScrape = kinetic(state.velocity, p);
      state.velocity = sub(state.velocity, scale(hit.normal, dot(state.velocity, hit.normal)));
      work.collision += kinetic(state.velocity, p) - beforeScrape;
      // The lift back out of the surface is a further correction of its own.
      work.collision += p.mass * p.gravity * (state.position.y - hit.point.y);
      return finish(state, p, alpha, cl, cd, wing, work, airVelocity);
    }
    state.position = to;
  } else {
    state.position = to;
  }

  // Any positional correction above moved the bird vertically, which changes
  // its potential energy. That is work done by the contact, not a leak.
  work.collision += p.mass * p.gravity * (state.position.y - to.y);

  return finish(state, p, alpha, cl, cd, wing, work, airVelocity);
}

/**
 * How level a surface has to be before the bird can put down on it, as the
 * upward part of its normal. Buildings are boxes, so in practice this is
 * simply "a roof rather than a wall".
 */
export const ROOF_NORMAL = 0.5;

/** Ground contact, then telemetry. Shared by every path out of `step`. */
function finish(
  state: BirdState,
  p: FlightParams,
  alpha: number,
  cl: number,
  cd: number,
  wing: WingSetup,
  work: WorkLedger,
  airVelocity: Vec3,
): FlightTelemetry {
  // Touching down always ends the flight; the only question is how well.
  if (state.position.y <= p.groundHeight) {
    const settled = state.position.y;
    const ground = vec(state.position.x, p.groundHeight, state.position.z);
    work.collision += p.mass * p.gravity * (ground.y - settled);
    settle(state, p, work, ground);
  }
  return telemetryFor(state, p, alpha, cl, cd, wing.stallAngle, work, airVelocity);
}

/**
 * Come to rest on a surface, and judge how it went.
 *
 * The caller has already booked the potential energy of moving the bird onto
 * the surface; this books the kinetic energy the surface absorbs.
 */
function settle(
  state: BirdState,
  p: FlightParams,
  work: WorkLedger,
  at: Vec3,
  carrier: number | null = null,
): void {
  state.position = at;
  state.restingOn = carrier;
  state.ending = touchdown(state, p);
  work.collision -= kinetic(state.velocity, p);
  state.velocity = vec(0, 0, 0);
  state.angularVelocity = vec(0, 0, 0);

  // A bird that lands settles onto its feet: keep where it was pointing, drop
  // the flare attitude it arrived in. A crashed one keeps its pose.
  if (state.ending.kind === 'landed') {
    state.orientation = quatFromAxisAngle(vec(0, 1, 0), -heading(state));
  }
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
  work: WorkLedger,
  wind: Vec3,
): FlightTelemetry {
  const through = sub(state.velocity, wind);
  const airspeed = length(through);
  return {
    airspeed,
    altitude: state.position.y - p.groundHeight,
    angleOfAttack: alpha,
    liftCoefficient: cl,
    dragCoefficient: cd,
    climbRate: state.velocity.y,
    stalled: Math.abs(alpha) > stallAngle,
    groundSpeed: length(state.velocity),
    wind,
    // Positive when the air is pushing back along the direction of travel.
    headwind: airspeed > 1e-6 ? -dot(wind, scale(through, 1 / airspeed)) : 0,
    energy: birdEnergy(state, p),
    work,
  };
}

const kinetic = (velocity: Vec3, p: FlightParams): number =>
  0.5 * p.mass * dot(velocity, velocity);

/** Mechanical energy of the bird, relative to the ground plane. */
export const birdEnergy = (state: BirdState, p: FlightParams): EnergyState =>
  energyOf(state.velocity, state.position.y - p.groundHeight, p.mass, p.gravity);

/** True while the bird is resting on the ground after a clean landing. */
export const isPerched = (state: BirdState): boolean => state.ending?.kind === 'landed';

/** True once the flight has ended badly and the run is over. */
export const hasCrashed = (state: BirdState): boolean => state.ending?.kind === 'crashed';

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
