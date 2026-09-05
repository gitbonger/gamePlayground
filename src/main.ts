import * as THREE from 'three';
/**
 * Entry point: fixed-timestep simulation, interpolated rendering, live tuning.
 */


import {
  createBird,
  defaultParams,
  hasCrashed,
  heading,
  isPerched,
  landingReadiness,
  step,
  type BirdState,
  type FlightTelemetry,
  type LandingReadiness,
} from './sim/flight';
import {
  quat,
  quatFromAxisAngle,
  quatMultiply,
  quatNormalize,
  vec,
  type Quat,
  type Vec3,
} from './sim/math3';
import { createInput } from './input';
import { createRunTracker } from './run';
import { createDebugGui } from './debug-gui';
import { createScene } from './render/scene';
import { createBirdRig, PIGEON_MORPHS, type WingPose } from './render/bird';
import { createFlock } from './flock';
import {
  combineColliders,
  createColliderField,
  type Collider,
} from './sim/collision';
import { createChaseCamera, defaultCameraParams } from './render/camera';
import { createHud } from './render/hud';
import { sunVector } from './render/sun';
import { createOutcomePanel } from './render/outcome';
import { buildWorld } from './world/city';
import { buildLayoutFromMap, defaultMapWorldOptions } from './world/from-map';
import {
  carriedBy,
  consistLength,
  layOutTrain,
  lineLength,
  onVehicle,
  shuttle,
  stackTop,
  trainBoxes,
  turnedBetween,
  tweenAlong,
} from './world/train';
import { createSmoke } from './world/smoke';
import { walk, type WalkTelemetry } from './sim/walk';
import { bearing, distance, project } from './world/geo';
import type { MapData } from './world/streets';
import homeMap from './world/data/home.json';
import { createWind, defaultWindParams } from './sim/wind';

/** Simulation tick rate. Fixed, so the flight model stays tunable and stable. */
const TICK = 1 / 120;
/** Never simulate more than this much time in one frame; a tab that was
 *  backgrounded for a minute should not try to catch up all of it. */
const MAX_FRAME_TIME = 0.25;

/**
 * Where the pigeon is released, and where it is trying to get back to.
 *
 * The release point sits on the line from the loft through the train, 400 m
 * short of it, so the pigeon is let go facing both: the rake of wagons is dead
 * ahead and home is directly beyond it. From 120 m the bird glides 515 m, so
 * the train is comfortably in reach and wants braking to settle on.
 *
 * The baked map is centred between release and loft rather than on either, so
 * the flight stays inside it with room to wander. The bird is raised clear of
 * whatever stands at the release point by SPAWN_CLEARANCE.
 */
const RELEASE_POINT: [number, number] = [47.503261, 19.091374];
const HOME_POINT: [number, number] = [47.494953, 19.081954];

const SPAWN_ALTITUDE = 120;
const SPAWN_SPEED = 16;
/** Clearance kept above anything standing at the spawn point. */
const SPAWN_CLEARANCE = 40;
/** Altitude below which the HUD starts showing the approach cue, in metres. */
const APPROACH_ALTITUDE = 45;

/**
 * When the game is set: six in the evening on the longest day, over the map's
 * own coordinates.
 *
 * The sun is then where it really was rather than wherever looked all right --
 * 24 degrees up and a little north of due west, which is the point of picking
 * an hour rather than a direction. Early afternoon was the first choice and
 * was wrong for a reason worth keeping: at 54 degrees the sun sits above the
 * top of the frame in level flight, so a pigeon never sees it. This one hangs
 * over the rooftops, and the shadows are long enough to read from the air.
 */
const WHEN = new Date('2025-06-21T16:00:00Z');
/** How far up-sun the shadow camera sits from the bird, in metres. */
const SUN_RANGE = 320;

const canvas = document.querySelector<HTMLCanvasElement>('#viewport')!;
const overlay = document.querySelector<HTMLElement>('#overlay')!;

// Real streets from OpenStreetMap, with the blocks between them filled in.
// JSON widens the fixed-length tuples, so this crosses through unknown.
const map = homeMap as unknown as MapData;

const { renderer, scene, camera, sun, sunDirection } = createScene(canvas, {
  sun: sunVector(map.centre[0], map.centre[1], WHEN),
});
const SUN_OFFSET = sunDirection.clone().multiplyScalar(SUN_RANGE);

const release = project(RELEASE_POINT[0], RELEASE_POINT[1], map.centre);
const home = project(HOME_POINT[0], HOME_POINT[1], map.centre);

/** A rake of empty stake wagons, standing in the yard for the pigeon to use. */
const TRAIN_POINT: [number, number] = [47.500052, 19.088174];
const train = project(TRAIN_POINT[0], TRAIN_POINT[1], map.centre);

const layout = buildLayoutFromMap(map, {
  ...defaultMapWorldOptions,
  target: home,
  trains: [{ near: train, wagons: 12 }],
});
/**
 * The levels, in order, and which one is being flown at the moment.
 *
 * Level 1 is the middle wagon of the rake the flock roosts on; Level 2 is the
 * loft, which is where the homing pigeon was always headed. Only the level
 * being flown is marked -- the others are built and sitting there dark, so
 * moving the game on is a matter of switching which one is lit.
 */
const LEVELS = ['Level 1', 'Level 2'] as const;
const middleCar = Math.floor((layout.trains[0]?.vehicles.length ?? 1) / 2);

const smoke = createSmoke();
const world = buildWorld(layout, {
  landmark: LEVELS[1],
  objectives: [{ name: LEVELS[0], train: 0, vehicle: middleCar }],
  smoke: smoke.puffs.length,
});

/** The one being flown. How this advances is not decided yet. */
let level = 0;
const objective = (name: string) => world.markers.find((marker) => marker.name === name) ?? null;
for (const marker of world.markers) marker.setActive(marker.name === LEVELS[level]);
scene.add(world.group);

/**
 * The marker arrows get a pass of their own, over a cleared depth buffer.
 *
 * Nothing in the world can then be in front of them, which is the point: an
 * arrow you cannot see from behind a block of flats is no help at all.
 */
const markerPass = new THREE.Scene();
markerPass.add(world.overlay);

const rig = createBirdRig();
scene.add(rig.object);

// The other pigeons: same flight model, same collider, same wind, steered by
// an autopilot that is not especially good at it.

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
/** What the bird did on its feet this tick, when it was on them. */
let onFoot: WalkTelemetry = { grounded: false, travelled: 0, blocked: false };

/**
 * They keep the player company rather than living anywhere.
 *
 * Read as a function rather than handed the bird, because `bird` is replaced
 * outright on a respawn: a flock holding the old one would fly escort to a
 * pigeon that no longer exists -- which is a mistake this file has already
 * made once, in a debug probe, and is worth not making again in the game.
 *
 * Built after the bird rather than beside the rest of the world, because the
 * first pigeon is released the moment the flock exists, and it is released
 * behind whoever it is escorting: reading `bird` in its dead zone throws.
 */
const flock = createFlock(PIGEON_MORPHS.length, () => ({
  x: bird.position.x,
  y: bird.position.y,
  z: bird.position.z,
  heading: heading(bird),
  speed: Math.hypot(bird.velocity.x, bird.velocity.y, bird.velocity.z),
  climb: bird.velocity.y,
}));
const flockRigs = flock.members.map((member) => {
  const rig = createBirdRig(PIGEON_MORPHS[member.morph]);
  scene.add(rig.object);
  return rig;
});

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

/**
 * Run the trains on, and hand back a collider that includes them.
 *
 * The city is built into a grid once and never touched; a train is somewhere
 * else every tick and carries its own field, rebuilt from scratch each time.
 * That costs 0.012 ms for a rake of thirteen, which is nothing worth avoiding.
 */
let clock = 0;
/**
 * Where each train stood at the previous tick, for drawing between them.
 *
 * The simulation moves a train in whole ticks, and a frame lands wherever it
 * lands between two of them. Drawn at the raw tick position a train jumps five
 * centimetres at a time, one or two or three jumps a frame depending on how
 * the frame fell -- next to a camera gliding along with an interpolated bird,
 * that reads as the whole rake shivering.
 */
const previousAlong = layout.trains.map((train) => train.along);

/** Every vehicle on the map, flattened. The index is its carrier tag. */
function allVehicles() {
  return layout.trains.flatMap((train) => train.vehicles);
}

function moveTrains(dt: number) {
  clock += dt;
  const fields: Collider[] = [world.collider];
  const before = allVehicles();
  let tagged = 0;

  layout.trains.forEach((train, index) => {
    previousAlong[index] = train.along;
    const run = shuttle(
      lineLength(train.line.points),
      consistLength(train.vehicles.length - 1),
      train.along,
      train.direction,
      train.speed * dt,
    );
    train.along = run.along;
    train.direction = run.direction;
    train.vehicles = layOutTrain(train.line, train.along, train.vehicles.length - 1);
    const base = tagged;
    tagged += train.vehicles.length;
    fields.push(createColliderField(trainBoxes(train.vehicles, (vehicle) => base + vehicle)));
  });

  // Anything standing on a wagon goes where the wagon goes. Without this a
  // bird that has just landed watches the train slide out from under it.
  const after = allVehicles();
  for (const passenger of [bird, ...flock.members.map((member) => member.state)]) {
    const riding = passenger.restingOn;
    if (riding === null) continue;
    const was = before[riding];
    const now = after[riding];
    if (!was || !now) continue;

    passenger.position = carriedBy(passenger.position, was, now);
    const turned = turnedBetween(was, now);
    if (turned !== 0) {
      // Turned about the world's vertical, the way the wagon turns.
      passenger.orientation = quatNormalize(
        quatMultiply(quatFromAxisAngle(vec(0, 1, 0), -turned), passenger.orientation),
      );
    }
  }

  // Smoke off the leading locomotive's stack, carried at the speed the train
  // is doing so it trails behind rather than standing over the chimney.
  const engine = layout.trains[0]?.vehicles[0];
  if (engine) {
    const stack = stackTop();
    const at = onVehicle(engine, stack.along, stack.across);
    const train = layout.trains[0]!;
    const heading = onVehicle(engine, 1, 0);
    const speed = train.speed * train.direction;
    smoke.update(
      dt,
      { x: at.x, y: stack.height, z: at.z },
      {
        x: (heading.x - engine.x) * speed,
        y: 0,
        z: (heading.z - engine.z) * speed,
      },
      (x, y, z) => wind.at(vec(x, y, z), clock),
    );
  }

  return combineColliders(...fields);
}

let solid = moveTrains(0);
let accumulator = 0;
let lastTime = performance.now() / 1000;
let smoothedFps = 60;

/**
 * The drawn ground under a bird, when it is close enough for that to show.
 *
 * Only asked while a bird is on or just above the surface: the answer is a
 * scan of every road and railway on the map, and it changes nothing at all
 * for a bird that is flying, standing on a roof or riding a wagon.
 */
function surfaceUnder(state: BirdState): number {
  if (state.restingOn !== null) return Number.NEGATIVE_INFINITY;
  if (state.position.y > flightParams.groundHeight + 1) return Number.NEGATIVE_INFINITY;
  return world.surfaceAt(state.position.x, state.position.z);
}

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
    solid = moveTrains(TICK);
    // Two modes, one of them live at a time. `walk` ignores a bird that is not
    // on its feet and `step` ignores one whose flight has ended, so which of
    // the two does anything is decided by the bird's own state rather than by
    // a flag kept alongside it.
    onFoot = walk(bird, input.walk, flightParams, TICK, solid);
    telemetry = step(bird, input.controls, flightParams, TICK, solid, wind);
    flock.update(TICK, solid, wind);
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
  // Carried over too, or anything reading the drawn state is told the bird is
  // still standing on whatever it was riding when the run started.
  interpolatedState.restingOn = bird.restingOn;
  interpolatedState.stridePhase = bird.stridePhase;

  const wings: WingPose = isPerched(bird)
    ? 'perched'
    : input.controls.brake
      ? 'braking'
      : input.controls.tuck
        ? 'tucked'
        : 'gliding';
  // Drawn between the last two ticks, exactly as the bird is. A train covers
  // five centimetres a tick, which is small enough to be invisible and big
  // enough to shimmer if you take it in steps.
  world.updateTrains(
    layout.trains.map((train, index) => ({
      ...train,
      vehicles: layOutTrain(
        train.line,
        tweenAlong(previousAlong[index]!, train.along, alpha),
        train.vehicles.length - 1,
      ),
    })),
  );
  world.updateSmoke(smoke.puffs, camera.quaternion);
  rig.update(interpolatedState, wings, frameTime, surfaceUnder(interpolatedState));

  // Flash the target and size its arrow. Both want the drawn position rather
  // than the tick position, or the arrow judders against everything else.
  objective(LEVELS[level])?.update(
    now,
    camera.position,
    new THREE.Vector3(
      interpolatedState.position.x,
      interpolatedState.position.y,
      interpolatedState.position.z,
    ),
  );

  // The flock is far enough away that the raw tick pose is smooth enough.
  flock.members.forEach((member, i) => {
    // A bird waiting its turn to be let out is not in the air, and should not
    // be standing on the wagon either.
    flockRigs[i]!.object.visible = member.down <= 0;
    flockRigs[i]!.update(
      member.state,
      isPerched(member.state) ? 'perched' : 'gliding',
      frameTime,
      surfaceUnder(member.state),
    );
  });

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
            // A walking bird is going somewhere, so the camera looks ahead of
            // it and keeps up. A standing one is the subject of the shot, and
            // a boom that drifts in over most of a second suits it.
            lookAhead: onFoot.travelled > 0 ? 2.2 : 0.3,
            rollFollow: 0,
            positionHalfLife: onFoot.travelled > 0 ? 0.12 : 0.7,
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
    distance(interpolatedState.position, objective(LEVELS[level])?.position ?? home),
    smoothedFps,
    onFoot,
  );
  renderer.render(scene, camera);
  // Then the arrows, on a fresh depth buffer so the world cannot cover them.
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(markerPass, camera);
  renderer.autoClear = true;

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
