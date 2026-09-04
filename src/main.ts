/**
 * Entry point: fixed-timestep simulation, interpolated rendering, live tuning.
 */

import * as THREE from 'three';

import {
  createBird,
  defaultParams,
  step,
  type BirdState,
  type FlightTelemetry,
} from './sim/flight';
import { quat, vec, type Quat, type Vec3 } from './sim/math3';
import { createInput } from './input';
import { createRunTracker } from './run';
import { createDebugGui } from './debug-gui';
import { createScene } from './render/scene';
import { createBirdRig } from './render/bird';
import { createChaseCamera, defaultCameraParams } from './render/camera';
import { createHud } from './render/hud';
import { createGameOverPanel } from './render/gameover';
import { buildWorld, defaultWorldOptions } from './world/city';

/** Simulation tick rate. Fixed, so the flight model stays tunable and stable. */
const TICK = 1 / 120;
/** Never simulate more than this much time in one frame; a tab that was
 *  backgrounded for a minute should not try to catch up all of it. */
const MAX_FRAME_TIME = 0.25;

const SPAWN = vec(0, 120, 260);
const SPAWN_SPEED = 16;
/** Clearance kept above anything standing at the spawn point. */
const SPAWN_CLEARANCE = 40;

const SUN_OFFSET = new THREE.Vector3(-160, 240, 120);

const canvas = document.querySelector<HTMLCanvasElement>('#viewport')!;
const overlay = document.querySelector<HTMLElement>('#overlay')!;

const { renderer, scene, camera, sun } = createScene(canvas);
const world = buildWorld(defaultWorldOptions);
scene.add(world.group);

const rig = createBirdRig();
scene.add(rig.object);

const chase = createChaseCamera(camera);
const hud = createHud(overlay);
const gameOver = createGameOverPanel(overlay);
const input = createInput();

const flightParams = { ...defaultParams };
const cameraParams = { ...defaultCameraParams };

// The spawn is hand-placed, but the city is procedural, so make sure nothing
// has been generated into the space the bird appears in.
const spawnFloor = world.collider.heightAt(SPAWN.x, SPAWN.z);
const spawn = vec(
  SPAWN.x,
  Number.isFinite(spawnFloor) ? Math.max(SPAWN.y, spawnFloor + SPAWN_CLEARANCE) : SPAWN.y,
  SPAWN.z,
);

let bird: BirdState = createBird(spawn, SPAWN_SPEED);
let telemetry: FlightTelemetry = step(bird, input.controls, flightParams, TICK);
const run = createRunTracker(bird);

// Previous tick's pose, so rendering can interpolate between ticks instead of
// showing the simulation's stair-steps.
let previousPosition: Vec3 = { ...bird.position };
let previousOrientation: Quat = { ...bird.orientation };

function respawn() {
  bird = createBird(spawn, SPAWN_SPEED);
  previousPosition = { ...bird.position };
  previousOrientation = { ...bird.orientation };
  run.reset(bird);
  gameOver.hide();
  chase.snap(bird, cameraParams);
}

createDebugGui(flightParams, cameraParams, { respawn });

// --- Loop ------------------------------------------------------------------
const interpolatedState: BirdState = { ...bird };
// After a crash the camera drifts back to take in the wreck.
const crashCameraParams = { ...cameraParams };

let accumulator = 0;
let lastTime = performance.now() / 1000;
let smoothedFps = 60;

function frame(nowMs: number) {
  const now = nowMs / 1000;
  const frameTime = Math.min(now - lastTime, MAX_FRAME_TIME);
  lastTime = now;

  smoothedFps += (1 / Math.max(frameTime, 1e-4) - smoothedFps) * 0.1;

  input.update(frameTime);
  if (input.consumeReset()) respawn();

  const wasFlying = bird.crash === null;

  accumulator += frameTime;
  while (accumulator >= TICK) {
    previousPosition = { ...bird.position };
    previousOrientation = { ...bird.orientation };
    telemetry = step(bird, input.controls, flightParams, TICK, world.collider);
    if (bird.crash === null) run.update(bird, TICK);
    accumulator -= TICK;
  }

  if (wasFlying && bird.crash) gameOver.show(bird.crash, run.stats);

  // Blend between the last two ticks so motion is smooth at any refresh rate.
  const alpha = accumulator / TICK;
  interpolatedState.position = lerpVec(previousPosition, bird.position, alpha);
  interpolatedState.orientation = slerpQuat(previousOrientation, bird.orientation, alpha);
  interpolatedState.velocity = bird.velocity;
  interpolatedState.flapPhase = bird.flapPhase;
  interpolatedState.stamina = bird.stamina;
  interpolatedState.grounded = bird.grounded;
  interpolatedState.crash = bird.crash;

  rig.update(interpolatedState, input.controls.tuck, frameTime);

  // Pull back and level off once the bird is down, so the crash site is legible.
  const activeCamera = bird.crash ? crashCameraParams : cameraParams;
  if (bird.crash) {
    Object.assign(crashCameraParams, cameraParams, {
      distance: cameraParams.distance + 5,
      height: cameraParams.height + 2.5,
      lookAhead: 0,
      rollFollow: 0,
      positionHalfLife: 0.5,
    });
  }
  chase.update(interpolatedState, activeCamera, frameTime);

  // Keep the shadow frustum centred on the bird rather than on the origin.
  sun.target.position.set(
    interpolatedState.position.x,
    interpolatedState.position.y,
    interpolatedState.position.z,
  );
  sun.position.copy(sun.target.position).add(SUN_OFFSET);
  sun.target.updateMatrixWorld();

  hud.update(interpolatedState, telemetry, smoothedFps);
  renderer.render(scene, camera);

  requestAnimationFrame(frame);
}

const lerpVec = (a: Vec3, b: Vec3, t: number): Vec3 =>
  vec(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);

/** Shortest-arc quaternion interpolation, for the render-side blend only. */
function slerpQuat(a: Quat, b: Quat, t: number): Quat {
  let cos = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let bx = b.x;
  let by = b.y;
  let bz = b.z;
  let bw = b.w;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  // Near-parallel orientations: plain lerp is stable and visually identical.
  if (cos > 0.9995) {
    return quat(
      a.x + (bx - a.x) * t,
      a.y + (by - a.y) * t,
      a.z + (bz - a.z) * t,
      a.w + (bw - a.w) * t,
    );
  }
  const theta = Math.acos(cos);
  const sin = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sin;
  const wb = Math.sin(t * theta) / sin;
  return quat(a.x * wa + bx * wb, a.y * wa + by * wb, a.z * wa + bz * wb, a.w * wa + bw * wb);
}

respawn();
requestAnimationFrame(frame);
