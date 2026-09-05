/**
 * Spring-damped chase camera.
 *
 * This contributes more to feeling like a bird than the bird model does. The
 * camera deliberately lags behind acceleration and widens its field of view
 * with airspeed, which is what turns "the numbers went up" into "that was fast".
 */

import * as THREE from 'three';
import type { BirdState } from '../sim/flight';

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

export interface ChaseCamera {
  update(state: BirdState, params: CameraParams, dt: number): void;
  /** Jump straight to the ideal pose, with no easing. */
  snap(state: BirdState, params: CameraParams): void;
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

  return { update, snap };
}
