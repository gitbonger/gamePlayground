/**
 * Local wind, evaluated on demand.
 *
 * There is no stored wind map. The field is a pure function of where you are
 * and what time it is, so only the air the bird is actually flying through
 * ever gets computed. That also gives one behaviour for free: because the gusts
 * vary with *position*, a bird crossing the map quickly runs through them
 * quickly, and the air feels rougher the faster you go -- without anything in
 * the model having to know how fast that is.
 *
 * Two layers, both real:
 *
 * - A mean wind that strengthens with height, following the power law used for
 *   atmospheric boundary layers. Friction against the ground drags the lowest
 *   air to a near standstill, and the exponent says how quickly it recovers --
 *   about 0.3 over rooftops, less over open water.
 * - Gusts on top, as smooth spatial noise that also drifts in time, scaled by
 *   the local mean so the air is rougher where it is faster.
 */

import { add, vec, type Vec3 } from './math3';

export interface WindParams {
  /** Mean wind speed at `referenceHeight`, in m/s. Zero for dead calm. */
  speed: number;
  /** Height at which the mean reaches `speed`, in metres. */
  referenceHeight: number;
  /**
   * Boundary-layer exponent. Higher means the wind stays weak for longer near
   * the ground and picks up faster above it; roughly 0.3 over a city.
   */
  shear: number;
  /** Compass bearing the wind blows *towards*, in radians. */
  bearing: number;
  /** Gust strength, as a fraction of the local mean. */
  gustiness: number;
  /** Distance over which the gusts vary, in metres. */
  gustScale: number;
  /** How fast the gust field churns where it stands, in Hz. */
  gustRate: number;
  /** Vertical gusts as a fraction of horizontal ones; real air is flatter. */
  verticalGusts: number;
}

export const defaultWindParams: WindParams = {
  speed: 4,
  referenceHeight: 100,
  shear: 0.3,
  bearing: 1.05,
  gustiness: 0.45,
  gustScale: 25,
  gustRate: 0.2,
  verticalGusts: 0.5,
};

export interface WindField {
  /** Air velocity at a point and time, in world coordinates, m/s. */
  at(position: Vec3, time: number): Vec3;
  /** Mean wind speed at a height, in m/s, ignoring gusts. */
  meanAt(altitude: number): number;
}

/** Still air. Used wherever wind should be out of the picture. */
export const calm: WindField = {
  at: () => vec(0, 0, 0),
  meanAt: () => 0,
};

/**
 * Octaves of gust noise: a direction to vary along, a rate to churn at, and a
 * weight. The directions deliberately point every which way and the rates
 * carry mixed signs, because a field whose octaves all drift together has a
 * speed at which a bird surfs along with the pattern and the air goes eerily
 * still. Spread like this, no single ground speed can cancel more than one
 * octave at a time.
 */
const OCTAVES = [
  { dir: vec(0.79, 0.36, 0.49), rate: 1, amplitude: 1, spread: 1 },
  { dir: vec(-0.42, 0.71, -0.57), rate: -1.63, amplitude: 0.55, spread: 2.1 },
  { dir: vec(0.55, -0.62, 0.56), rate: 3.41, amplitude: 0.3, spread: 4.4 },
  { dir: vec(-0.68, -0.31, 0.66), rate: -5.27, amplitude: 0.18, spread: 8.7 },
];
const OCTAVE_SUM = OCTAVES.reduce((total, o) => total + o.amplitude, 0);

/** Per-component rotations, so the three axes do not share a blind speed. */
const COMPONENT_SWIZZLE = [
  (v: Vec3) => v,
  (v: Vec3) => vec(v.z, v.x, -v.y),
  (v: Vec3) => vec(-v.y, v.z, v.x),
];

/**
 * Smooth noise in -1..1, varying over `scale` metres and churning at `rate`.
 * Sines rather than a lattice: it is stateless, cheap, and smooth to every
 * derivative, which matters because this feeds a force.
 */
function gust(
  position: Vec3,
  time: number,
  scale: number,
  rate: number,
  component: number,
  phase: number,
): number {
  let total = 0;
  const base = 1 / Math.max(scale, 1e-3);
  const swizzle = COMPONENT_SWIZZLE[component]!;

  for (const octave of OCTAVES) {
    const dir = swizzle(octave.dir);
    const along = position.x * dir.x + position.y * dir.y + position.z * dir.z;
    total +=
      octave.amplitude *
      Math.sin(along * base * octave.spread + time * rate * octave.rate + phase * octave.spread);
  }

  return total / OCTAVE_SUM;
}

export function createWind(params: WindParams = defaultWindParams): WindField {
  function meanAt(altitude: number): number {
    if (params.speed === 0) return 0;
    // Ground friction takes the lowest air with it, so the profile starts near
    // zero and climbs. Clamped at the bottom to keep the exponent well behaved.
    const height = Math.max(altitude, 0);
    const reference = Math.max(params.referenceHeight, 1e-3);
    return params.speed * Math.pow(height / reference, params.shear);
  }

  const alongX = Math.sin(params.bearing);
  const alongZ = -Math.cos(params.bearing);

  function at(position: Vec3, time: number): Vec3 {
    const mean = meanAt(position.y);
    if (mean === 0) return vec(0, 0, 0);

    const steady = vec(alongX * mean, 0, alongZ * mean);

    // Gusts scale with the local mean, so the air is rougher where it is
    // faster -- and the phase offsets keep the three axes independent.
    const strength = mean * params.gustiness;
    const { gustScale: s, gustRate: r } = params;

    return add(
      steady,
      vec(
        gust(position, time, s, r, 0, 0) * strength,
        gust(position, time, s, r, 1, 17.3) * strength * params.verticalGusts,
        gust(position, time, s, r, 2, 41.7) * strength,
      ),
    );
  }

  return { at, meanAt };
}
