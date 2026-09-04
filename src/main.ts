/**
 * Entry point: fixed-timestep simulation, interpolated rendering, live tuning.
 */

import * as THREE from 'three';
import GUI from 'lil-gui';

import {
  createBird,
  defaultParams,
  step,
  type BirdState,
  type FlightTelemetry,
} from './sim/flight';
import { quat, vec, type Quat, type Vec3 } from './sim/math3';
import { createInput } from './input';
import { createScene } from './render/scene';
import { createBirdRig } from './render/bird';
import { createChaseCamera, defaultCameraParams } from './render/camera';
import { createHud } from './render/hud';
import { buildWorld, defaultWorldOptions } from './world/city';

/** Simulation tick rate. Fixed, so the flight model stays tunable and stable. */
const TICK = 1 / 120;
/** Never simulate more than this much time in one frame; a tab that was
 *  backgrounded for a minute should not try to catch up all of it. */
const MAX_FRAME_TIME = 0.25;

const SPAWN = vec(0, 120, 260);

const canvas = document.querySelector<HTMLCanvasElement>('#viewport')!;
const overlay = document.querySelector<HTMLElement>('#overlay')!;

const { renderer, scene, camera, sun } = createScene(canvas);
const world = buildWorld(defaultWorldOptions);
scene.add(world.group);

const rig = createBirdRig();
scene.add(rig.object);

const chase = createChaseCamera(camera);
const hud = createHud(overlay);
const input = createInput();

const flightParams = { ...defaultParams };
const cameraParams = { ...defaultCameraParams };

let bird: BirdState = createBird(SPAWN, 16);
let telemetry: FlightTelemetry = step(bird, input.controls, flightParams, TICK);

// Previous tick's pose, so rendering can interpolate between ticks instead of
// showing the simulation's stair-steps.
let previousPosition: Vec3 = { ...bird.position };
let previousOrientation: Quat = { ...bird.orientation };

function respawn() {
  bird = createBird(SPAWN, 16);
  previousPosition = { ...bird.position };
  previousOrientation = { ...bird.orientation };
  chase.snap(bird, cameraParams);
}

// --- Debug GUI -------------------------------------------------------------
const gui = new GUI({ title: 'pigeon sim' });

const flightFolder = gui.addFolder('flight');
flightFolder.add(flightParams, 'wingArea', 0.02, 0.15, 0.001);
flightFolder.add(flightParams, 'liftSlope', 1, 8, 0.1);
flightFolder.add(flightParams, 'stallAngle', 0.1, 0.6, 0.01);
flightFolder.add(flightParams, 'dragBase', 0.005, 0.2, 0.005);
flightFolder.add(flightParams, 'inducedDrag', 0.01, 0.3, 0.005);
flightFolder.add(flightParams, 'keelDrag', 0, 1.5, 0.05);
flightFolder.add(flightParams, 'trimAngle', 0, 0.3, 0.005);
flightFolder.add(flightParams, 'mass', 0.15, 1.2, 0.01);

const flapFolder = gui.addFolder('wingbeat');
flapFolder.add(flightParams, 'flapThrust', 0, 12, 0.1);
flapFolder.add(flightParams, 'flapFrequency', 1, 12, 0.1);
flapFolder.add(flightParams, 'flapAngle', 0, 1.2, 0.01);
flapFolder.add(flightParams, 'flapStaminaCost', 0, 0.5, 0.01);
flapFolder.add(flightParams, 'staminaRecovery', 0, 0.5, 0.01);

const handlingFolder = gui.addFolder('handling');
handlingFolder.add(flightParams, 'pitchRate', 0.2, 6, 0.1);
handlingFolder.add(flightParams, 'rollRate', 0.2, 8, 0.1);
handlingFolder.add(flightParams, 'yawRate', 0, 4, 0.05);
handlingFolder.add(flightParams, 'controlHalfLife', 0.01, 0.5, 0.01);
handlingFolder.add(flightParams, 'pitchStability', 0, 8, 0.1);
handlingFolder.add(flightParams, 'yawStability', 0, 8, 0.1);
handlingFolder.close();

const cameraFolder = gui.addFolder('camera');
cameraFolder.add(cameraParams, 'distance', 1, 20, 0.1);
cameraFolder.add(cameraParams, 'height', -2, 8, 0.1);
cameraFolder.add(cameraParams, 'lookAhead', 0, 40, 0.5);
cameraFolder.add(cameraParams, 'positionHalfLife', 0.01, 0.6, 0.005);
cameraFolder.add(cameraParams, 'rollFollow', 0, 1, 0.05);
cameraFolder.add(cameraParams, 'baseFov', 40, 110, 1);
cameraFolder.add(cameraParams, 'fovGain', 0, 50, 1);
cameraFolder.close();

gui.add({ respawn }, 'respawn').name('respawn (R)');

// H hides the GUI for an unobstructed look at the world.
let guiVisible = true;
window.addEventListener('keydown', (event) => {
  if (event.code !== 'KeyH') return;
  guiVisible = !guiVisible;
  gui.show(guiVisible);
});

// --- Loop ------------------------------------------------------------------
const SUN_OFFSET = new THREE.Vector3(-160, 240, 120);

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

const interpolatedState: BirdState = { ...bird };
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

  accumulator += frameTime;
  while (accumulator >= TICK) {
    previousPosition = { ...bird.position };
    previousOrientation = { ...bird.orientation };
    telemetry = step(bird, input.controls, flightParams, TICK);
    accumulator -= TICK;
  }

  // Blend between the last two ticks so motion is smooth at any refresh rate.
  const alpha = accumulator / TICK;
  interpolatedState.position = lerpVec(previousPosition, bird.position, alpha);
  interpolatedState.orientation = slerpQuat(previousOrientation, bird.orientation, alpha);
  interpolatedState.velocity = bird.velocity;
  interpolatedState.flapPhase = bird.flapPhase;
  interpolatedState.stamina = bird.stamina;
  interpolatedState.grounded = bird.grounded;

  rig.update(interpolatedState, input.controls.tuck, frameTime);
  chase.update(interpolatedState, cameraParams, frameTime);

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

respawn();
requestAnimationFrame(frame);
