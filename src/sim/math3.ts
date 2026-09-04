/**
 * Minimal 3D math for the flight model.
 *
 * Kept deliberately free of any renderer dependency so the simulation stays
 * unit-testable and portable. Conventions match Three.js: Y is up, and a body's
 * local forward axis is -Z.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Quaternion rotating body-local coordinates into world coordinates. */
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const vec = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const add = (a: Vec3, b: Vec3): Vec3 => vec(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => vec(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, s: number): Vec3 => vec(a.x * s, a.y * s, a.z * s);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a: Vec3, b: Vec3): Vec3 =>
  vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

export const length = (a: Vec3): number => Math.sqrt(dot(a, a));

export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  return len > 1e-9 ? scale(a, 1 / len) : vec(0, 0, 0);
}

/** Linear interpolation between two vectors. */
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 =>
  vec(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);

export const quat = (x = 0, y = 0, z = 0, w = 1): Quat => ({ x, y, z, w });

export function quatMultiply(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function quatNormalize(q: Quat): Quat {
  const len = Math.hypot(q.x, q.y, q.z, q.w);
  if (len < 1e-9) return quat();
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
}

export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const n = normalize(axis);
  const h = angle * 0.5;
  const s = Math.sin(h);
  return { x: n.x * s, y: n.y * s, z: n.z * s, w: Math.cos(h) };
}

/** Rotate a vector from body space into world space. */
export function rotate(q: Quat, v: Vec3): Vec3 {
  // t = 2 * (q.xyz x v); v' = v + q.w * t + q.xyz x t
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return vec(
    v.x + q.w * tx + (q.y * tz - q.z * ty),
    v.y + q.w * ty + (q.z * tx - q.x * tz),
    v.z + q.w * tz + (q.x * ty - q.y * tx),
  );
}

/** Rotate a vector from world space into body space. */
export const rotateInverse = (q: Quat, v: Vec3): Vec3 =>
  rotate({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, v);

/**
 * Integrate an orientation by a body-frame angular velocity (rad/s) over dt.
 * Uses the exact axis-angle exponential rather than the first-order
 * approximation, so large roll rates stay stable at low tick rates.
 */
export function integrateOrientation(q: Quat, bodyOmega: Vec3, dt: number): Quat {
  const angle = length(bodyOmega) * dt;
  if (angle < 1e-9) return q;
  const delta = quatFromAxisAngle(bodyOmega, angle);
  return quatNormalize(quatMultiply(q, delta));
}

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/**
 * Frame-rate independent exponential smoothing.
 * `halfLife` is the time in seconds for the gap to `target` to halve.
 */
export function damp(current: number, target: number, halfLife: number, dt: number): number {
  if (halfLife <= 0) return target;
  const t = 1 - Math.pow(2, -dt / halfLife);
  return current + (target - current) * t;
}
