/**
 * Entry point: fixed-timestep simulation, interpolated rendering, live tuning.
 */

import * as THREE from 'three';

import {
  createBird,
  defaultParams,
  hasCrashed,
  isPerched,
  landingReadiness,
  step,
  type BirdState,
  type FlightTelemetry,
  type LandingReadiness,
} from './sim/flight';
import { quat, vec, type Quat, type Vec3 } from './sim/math3';
import { createInput } from './input';
import { createRunTracker } from './run';
import { createDebugGui } from './debug-gui';
import { createScene } from './render/scene';
import { createBirdRig, type WingPose } from './render/bird';
import { createChaseCamera, defaultCameraParams } from './render/camera';
import { createHud } from './render/hud';
import { createOutcomePanel } from './render/outcome';
import { buildWorld } from './world/city';
import { buildLayoutFromMap, defaultMapWorldOptions } from './world/from-map';
import { bearing, distance, project } from './world/geo';
import type { MapData } from './world/streets';
import homeMap from './world/data/home.json';
import { createWind, defaultWindParams } from './sim/wind';

/** Simulation tick rate. Fixed, so the flight model stays tunable and stable. */
const TICK = 1 / 120;
/** Never simulate more than this much time in one frame; a tab that was
 *  backgrounded for a minute should not try to catch up all of it. */
const MAX_FRAME_TIME = 0.25;

// Directly over the map's centre point, which is what the coordinates in
// `fetch-map` name. Raised clear of whatever stands there by SPAWN_CLEARANCE.
/** Where the pigeon is released, and where it is trying to get back to. */
const RELEASE_POINT: [number, number] = [47.49154, 19.075658];
const HOME_POINT: [number, number] = [47.494593, 19.081282];

const SPAWN_ALTITUDE = 120;
const SPAWN_SPEED = 16;
/** Clearance kept above anything standing at the spawn point. */
const SPAWN_CLEARANCE = 40;
/** Altitude below which the HUD starts showing the approach cue, in metres. */
const APPROACH_ALTITUDE = 45;

const SUN_OFFSET = new THREE.Vector3(-160, 240, 120);

const canvas = document.querySelector<HTMLCanvasElement>('#viewport')!;
const overlay = document.querySelector<HTMLElement>('#overlay')!;

const { renderer, scene, camera, sun } = createScene(canvas);
// Real streets from OpenStreetMap, with the blocks between them filled in.
// JSON widens the fixed-length tuples, so this crosses through unknown.
const map = homeMap as unknown as MapData;

const release = project(RELEASE_POINT[0], RELEASE_POINT[1], map.centre);
const home = project(HOME_POINT[0], HOME_POINT[1], map.centre);

const layout = buildLayoutFromMap(map, { ...defaultMapWorldOptions, target: home });
const world = buildWorld(layout);
scene.add(world.group);

const rig = createBirdRig();
scene.add(rig.object);

const chase = createChaseCamera(camera);
const hud = createHud(overlay, map.attribution);
const outcome = createOutcomePanel(overlay);
const input = createInput();

const flightParams = { ...defaultParams };
const cameraParams = { ...defaultCameraParams };
const windParams = { ...defaultWindParams };

// Rebuilt whenever the panel changes the air, since the field closes over its
// parameters rather than reading them each tick.
let wind = createWind(windParams);
const rebuildWind = () => {
  wind = createWind(windParams);
};

// The release point is named in degrees, but the city around it is generated,
// so make sure nothing has been built into the space the bird appears in.
const spawnFloor = world.collider.heightAt(release.x, release.z);
const spawn = vec(
  release.x,
  Number.isFinite(spawnFloor)
    ? Math.max(SPAWN_ALTITUDE, spawnFloor + SPAWN_CLEARANCE)
    : SPAWN_ALTITUDE,
  release.z,
);
// Released pointing straight at home, the way a homing pigeon starts out.
const spawnHeading = bearing(release, home);

let bird: BirdState = createBird(spawn, SPAWN_SPEED, spawnHeading);
let telemetry: FlightTelemetry = step(bird, input.controls, flightParams, TICK);

const run = createRunTracker(bird);

// Previous tick's pose, so rendering can interpolate between ticks instead of
// showing the simulation's stair-steps.
let previousPosition: Vec3 = { ...bird.position };
let previousOrientation: Quat = { ...bird.orientation };

function respawn() {
  bird = createBird(spawn, SPAWN_SPEED, spawnHeading);
  previousPosition = { ...bird.position };
  previousOrientation = { ...bird.orientation };
  run.reset(bird);
  outcome.hide();
  chase.snap(bird, cameraParams);
}

createDebugGui(flightParams, cameraParams, windParams, { respawn, rebuildWind });

// --- Loop ------------------------------------------------------------------
const interpolatedState: BirdState = { ...bird };
// Once the flight is over the camera drifts back to take in the spot.
const restCameraParams = { ...cameraParams };

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

  const wasFlying = bird.ending === null;

  accumulator += frameTime;
  while (accumulator >= TICK) {
    previousPosition = { ...bird.position };
    previousOrientation = { ...bird.orientation };
    telemetry = step(bird, input.controls, flightParams, TICK, world.collider, wind);
    if (bird.ending === null) run.update(bird, TICK);
    accumulator -= TICK;
  }

  // Only a crash ends the run. A clean landing leaves the bird perched, which
  // is a place to watch it from rather than a screen to dismiss.
  if (wasFlying && hasCrashed(bird)) outcome.show(bird.ending!, run.stats);

  // Blend between the last two ticks so motion is smooth at any refresh rate.
  const alpha = accumulator / TICK;
  interpolatedState.position = lerpVec(previousPosition, bird.position, alpha);
  interpolatedState.orientation = slerpQuat(previousOrientation, bird.orientation, alpha);
  interpolatedState.velocity = bird.velocity;
  interpolatedState.flapPhase = bird.flapPhase;
  interpolatedState.stamina = bird.stamina;
  interpolatedState.ending = bird.ending;

  const wings: WingPose = isPerched(bird)
    ? 'perched'
    : input.controls.brake
      ? 'braking'
      : input.controls.tuck
        ? 'tucked'
        : 'gliding';
  rig.update(interpolatedState, wings, frameTime);

  // Once the bird is down the camera settles: further back and levelled off
  // for a crash, closer and lower for a perch, where the bird is the subject.
  const activeCamera = bird.ending ? restCameraParams : cameraParams;
  if (bird.ending) {
    Object.assign(
      restCameraParams,
      cameraParams,
      isPerched(bird)
        ? {
            distance: 1.4,
            height: 0.35,
            lookAhead: 0.3,
            rollFollow: 0,
            positionHalfLife: 0.7,
            baseFov: 55,
            fovGain: 0,
          }
        : {
            distance: cameraParams.distance + 5,
            height: cameraParams.height + 2.5,
            lookAhead: 0,
            rollFollow: 0,
            positionHalfLife: 0.5,
          },
    );
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

  // The approach cue is only shown while still flying and low enough to act on.
  const landing: LandingReadiness | null =
    bird.ending === null && telemetry.altitude < APPROACH_ALTITUDE
      ? landingReadiness(bird, flightParams)
      : null;

  hud.update(
    interpolatedState,
    telemetry,
    landing,
    distance(interpolatedState.position, home),
    smoothedFps,
  );
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
