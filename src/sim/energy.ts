/**
 * Energy accounting for the flight model.
 *
 * The simulation is Newtonian, so it already conserves energy for free -- but
 * only if every force is honest. Lift must do no work (it acts perpendicular
 * to the airflow), drag must only ever remove energy, and the wingbeat must be
 * the sole source. Auditing that is worth more than asserting it: a force that
 * quietly creates energy is exactly the kind of bug that reads as "the flight
 * feel is off" rather than as an obvious error.
 *
 * The ledger below balances *exactly*, not approximately. With semi-implicit
 * Euler (v1 = v0 + F/m dt, then x1 = x0 + v1 dt) the change in kinetic energy
 * is identically the work done at the mean velocity:
 *
 *     dKE = 1/2 m (|v1|^2 - |v0|^2) = F . (v0 + v1)/2 dt
 *
 * while potential energy moves with the *end* velocity, because that is what
 * the position update uses. The mismatch between the two is a known artefact
 * of the integrator rather than a physics error, so it is reported as its own
 * term instead of being hidden in a tolerance.
 */

import { dot, length, type Vec3 } from './math3';

export interface EnergyState {
  /** Kinetic energy, in joules. */
  kinetic: number;
  /** Gravitational potential energy relative to the ground, in joules. */
  potential: number;
  /** Total mechanical energy, in joules. */
  total: number;
  /**
   * Total energy expressed as an altitude, in metres: the height the bird
   * would reach if it converted all its speed into climb. Pilots call this
   * specific energy, and it is the number that actually tells you whether you
   * can clear what is ahead.
   */
  height: number;
}

export function energyOf(
  velocity: Vec3,
  altitude: number,
  mass: number,
  gravity: number,
): EnergyState {
  const speed = length(velocity);
  const kinetic = 0.5 * mass * speed * speed;
  const potential = mass * gravity * altitude;
  return {
    kinetic,
    potential,
    total: kinetic + potential,
    height: altitude + (speed * speed) / (2 * gravity),
  };
}

/**
 * Joules added or removed by each force over one tick. Signs are meaningful:
 * `flap` is the only term allowed to be positive.
 */
export interface WorkLedger {
  /** Work done by the wingbeat. The only source of energy in the system. */
  flap: number;
  /** Work done by lift. Zero by construction; audited, not assumed. */
  lift: number;
  /** Work removed by drag. Never positive. */
  drag: number;
  /** Work removed by the keel resisting sideslip. Never positive. */
  keel: number;
  /** Work removed by hitting the world or the ground. Never positive. */
  collision: number;
  /**
   * Residual from the fixed-step integrator, exactly `m g dt (v1.y - v0.y)/2`.
   * Not a physics term: it is the price of stepping velocity before position,
   * and it shrinks with the square of the timestep.
   */
  integration: number;
}

export const zeroWork = (): WorkLedger => ({
  flap: 0,
  lift: 0,
  drag: 0,
  keel: 0,
  collision: 0,
  integration: 0,
});

/** Net energy change the ledger accounts for, in joules. */
export const totalWork = (w: WorkLedger): number =>
  w.flap + w.lift + w.drag + w.keel + w.collision + w.integration;

/** Work done by a constant force over a step, using the mean velocity. */
export const workDone = (force: Vec3, meanVelocity: Vec3, dt: number): number =>
  dot(force, meanVelocity) * dt;
