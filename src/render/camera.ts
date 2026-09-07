/**
 * Spring-damped chase camera.
 *
 * This contributes more to feeling like a bird than the bird model does. The
 * camera deliberately lags behind acceleration and widens its field of view
 * with airspeed, which is what turns "the numbers went up" into "that was fast".
 */

import * as THREE from 'three';
import type { BirdState } from '../sim/flight';
import type { Vec3 } from '../sim/math3';

export interface CameraParams {
  /** Distance behind the bird, in metres. */
  distance: number;
  /** Height above the bird, in metres. */
  height: number;
  /** How far ahead of the bird the camera aims. */
  lookAhead: number;
  /** Half-life in seconds for the camera to close the gap to its ideal spot. */
  positionHalfLife: number;
  /** Half-life for the aim point, kept slightly tighter than position. */
  targetHalfLife: number;
  /** 0 keeps the horizon level, 1 rolls the camera fully with the bird. */
  rollFollow: number;
  /** Field of view at rest, in degrees. */
  baseFov: number;
  /** Extra degrees of FOV at top speed. */
  fovGain: number;
  /** Airspeed at which fovGain is fully applied, in m/s. */
  fovRefSpeed: number;
}

export const defaultCameraParams: CameraParams = {
  distance: 1.7,
  height: 0.5,
  lookAhead: 9,
  positionHalfLife: 0.075,
  targetHalfLife: 0.05,
  rollFollow: 0.45,
  baseFov: 68,
  fovGain: 26,
  fovRefSpeed: 45,
};

/**
 * How to frame two birds that have met.
 *
 * A different shot from the chase entirely: the subject is not one bird going
 * somewhere, it is two of them standing together, so the camera comes off the
 * boom and stands to one side of them both.
 */
export interface WatchParams {
  /**
   * Clear air to leave beyond the pair, in metres.
   *
   * Also what stops the camera crowding two birds standing on top of each
   * other: the stand-off never falls below `margin / tan(fov / 2)`, which at
   * the defaults is three metres, so no separate minimum is needed and the
   * one that used to be here was never once reached.
   */
  margin: number;
  /** How high above them it stands, in metres. */
  height: number;
  /** Half-life for easing into and out of the shot, in seconds. */
  halfLife: number;
  /** Field of view for the two-shot, in degrees. */
  fov: number;
}

export const defaultWatchParams: WatchParams = {
  margin: 1.4,
  height: 0.9,
  halfLife: 0.35,
  fov: 50,
};

export interface ChaseCamera {
  update(state: BirdState, params: CameraParams, dt: number): void;
  /**
   * Frame two birds together, easing from wherever the camera is.
   *
   * Shares the boom's own position and aim, so going into the shot and coming
   * back out of it are the same easing that follows the bird -- there is no
   * cut, and nothing to blend between two cameras.
   */
  watch(a: Vec3, b: Vec3, params: WatchParams, dt: number): void;
  /** Jump straight to the ideal pose, with no easing. */
  snap(state: BirdState, params: CameraParams): void;
  /**
   * The point it is looking at, right now.
   *
   * For anything that has to hand the shot back without a jump. The boom does
   * not aim at the bird -- it aims `lookAhead` metres past it, which is what
   * puts the bird low in frame with the ground it is flying at above it -- so
   * a caller that framed the bird itself and then let go would turn the camera
   * on the frame it let go. That was the seam at the end of every scene.
   */
  aim(): Vec3;
}

/**
 * Where a camera should stand to hold two points in frame, and what to aim at.
 *
 * Side on rather than over either shoulder: a two-shot taken from behind one
 * of them is a shot of the back of a pigeon. The stand-off comes from the
 * angle the pair subtends, so they fill the same part of the frame whether
 * they are touching or a wing apart.
 *
 * Of the two sides it could stand on, it takes the one it is already nearer,
 * so walking round somebody does not send the camera swinging through them.
 */
export function twoShot(
  a: Vec3,
  b: Vec3,
  from: Vec3,
  params: WatchParams,
): { position: Vec3; target: Vec3 } {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };

  const alongX = b.x - a.x;
  const alongZ = b.z - a.z;
  const span = Math.hypot(alongX, alongZ, b.y - a.y);

  // Far enough back that the pair plus its margin fits the frame.
  const half = (params.fov / 2) * (Math.PI / 180);
  const back = (span / 2 + params.margin) / Math.tan(half);

  // Across the line between them, in the ground plane.
  let outX = -alongZ;
  let outZ = alongX;
  const length = Math.hypot(outX, outZ);
  if (length < 1e-6) {
    // Standing on top of each other: any side will do, so keep the one the
    // camera is on rather than picking north every time.
    outX = from.x - mid.x;
    outZ = from.z - mid.z;
    const away = Math.hypot(outX, outZ);
    if (away < 1e-6) return { position: { x: mid.x, y: mid.y + back, z: mid.z }, target: mid };
    outX /= away;
    outZ /= away;
  } else {
    outX /= length;
    outZ /= length;
    // The near side of the two.
    if ((from.x - mid.x) * outX + (from.z - mid.z) * outZ < 0) {
      outX = -outX;
      outZ = -outZ;
    }
  }

  return {
    position: { x: mid.x + outX * back, y: mid.y + params.height, z: mid.z + outZ * back },
    target: mid,
  };
}

/** Frame-rate independent smoothing factor for a given half-life. */
const smoothing = (halfLife: number, dt: number) =>
  halfLife <= 0 ? 1 : 1 - Math.pow(2, -dt / halfLife);

export function createChaseCamera(camera: THREE.PerspectiveCamera): ChaseCamera {
  const position = new THREE.Vector3();
  const target = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  // Scratch objects, reused every frame to keep the loop allocation-free.
  const birdPos = new THREE.Vector3();
  const birdQuat = new THREE.Quaternion();
  const forward = new THREE.Vector3();
  const birdUp = new THREE.Vector3();
  const desiredPos = new THREE.Vector3();
  const desiredTarget = new THREE.Vector3();
  const desiredUp = new THREE.Vector3();

  let initialised = false;
  /** Where the pair was last frame, so the shot can be carried along with it. */
  const carried = new THREE.Vector3();
  let carrying = false;

  function computeIdeal(state: BirdState, params: CameraParams) {
    birdPos.set(state.position.x, state.position.y, state.position.z);
    birdQuat.set(
      state.orientation.x,
      state.orientation.y,
      state.orientation.z,
      state.orientation.w,
    );

    forward.set(0, 0, -1).applyQuaternion(birdQuat);
    birdUp.set(0, 1, 0).applyQuaternion(birdQuat);

    // The boom hangs from world up rather than the bird's up, so a barrel roll
    // spins the bird in frame instead of whipping the camera around it.
    desiredPos
      .copy(birdPos)
      .addScaledVector(forward, -params.distance)
      .addScaledVector(up, params.height);

    desiredTarget.copy(birdPos).addScaledVector(forward, params.lookAhead);

    // Only part of the bank is carried into the camera roll. Full roll follow
    // is disorienting; none at all makes turns feel weightless.
    desiredUp.copy(up).lerp(birdUp, params.rollFollow).normalize();
  }

  function aim(): Vec3 {
    return { x: target.x, y: target.y, z: target.z };
  }

  function snap(state: BirdState, params: CameraParams) {
    computeIdeal(state, params);
    position.copy(desiredPos);
    target.copy(desiredTarget);
    camera.position.copy(position);
    camera.up.copy(desiredUp);
    camera.lookAt(target);
    camera.fov = params.baseFov;
    camera.updateProjectionMatrix();
    initialised = true;
  }

  function update(state: BirdState, params: CameraParams, dt: number) {
    carrying = false;
    if (!initialised) {
      snap(state, params);
      return;
    }

    computeIdeal(state, params);

    position.lerp(desiredPos, smoothing(params.positionHalfLife, dt));
    target.lerp(desiredTarget, smoothing(params.targetHalfLife, dt));
    camera.up.lerp(desiredUp, smoothing(params.positionHalfLife, dt)).normalize();

    camera.position.copy(position);
    camera.lookAt(target);

    const speed = Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z);
    const rush = Math.min(speed / params.fovRefSpeed, 1);
    const targetFov = params.baseFov + params.fovGain * rush * rush;
    if (Math.abs(camera.fov - targetFov) > 0.01) {
      camera.fov += (targetFov - camera.fov) * smoothing(0.25, dt);
      camera.updateProjectionMatrix();
    }
  }

  function watch(a: Vec3, b: Vec3, params: WatchParams, dt: number) {
    const ideal = twoShot(a, b, position, params);

    // Carried along with the pair before any easing.
    //
    // Without this the shot lags whatever the two of them are standing on. An
    // eased aim trails a moving subject by about `speed x halfLife / ln 2` --
    // on a wagon at 6 m/s that is three metres, and from a stand-off of four
    // it puts both birds hard against the edge of the frame and keeps them
    // there. Moving the camera by however far the pair moved leaves the
    // easing only the gap it is actually for, so a pair travelling at a
    // steady rate is framed exactly, standing still or doing sixty.
    if (carrying) {
      const shiftX = ideal.target.x - carried.x;
      const shiftY = ideal.target.y - carried.y;
      const shiftZ = ideal.target.z - carried.z;
      position.set(position.x + shiftX, position.y + shiftY, position.z + shiftZ);
      target.set(target.x + shiftX, target.y + shiftY, target.z + shiftZ);
    }
    carried.set(ideal.target.x, ideal.target.y, ideal.target.z);
    carrying = true;

    desiredPos.set(ideal.position.x, ideal.position.y, ideal.position.z);
    desiredTarget.set(ideal.target.x, ideal.target.y, ideal.target.z);

    const ease = smoothing(params.halfLife, dt);
    position.lerp(desiredPos, ease);
    target.lerp(desiredTarget, ease);
    camera.up.lerp(up, ease).normalize();

    camera.position.copy(position);
    camera.lookAt(target);

    if (Math.abs(camera.fov - params.fov) > 0.01) {
      camera.fov += (params.fov - camera.fov) * ease;
      camera.updateProjectionMatrix();
    }
  }

  return { update, watch, snap, aim };
}
