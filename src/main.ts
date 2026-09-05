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
import { LEVELS, levelNamed, type Level, type LevelTarget } from './levels';
import { loadProgress, saveProgress } from './progress';
import { createLevelMenu } from './render/menu';
import {
  combineColliders,
  createColliderField,
  type Collider,
} from './sim/collision';
import { createChaseCamera, defaultCameraParams, defaultWatchParams } from './render/camera';
import { createHud } from './render/hud';
import { sunVector } from './render/sun';
import { createOutcomePanel } from './render/outcome';
import { buildWorld, targetFlash } from './world/city';
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
  WAGON,
} from './world/train';
import { createSmoke } from './world/smoke';
import {
  asStance,
  meeting,
  stanceOf,
  turnToFace,
  walk,
  type WalkControls,
  type WalkTelemetry,
} from './sim/walk';
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

/** How far up-sun the shadow camera sits from the bird, in metres. */
const SUN_RANGE = 320;

const canvas = document.querySelector<HTMLCanvasElement>('#viewport')!;
const overlay = document.querySelector<HTMLElement>('#overlay')!;

// Real streets from OpenStreetMap, with the blocks between them filled in.
// JSON widens the fixed-length tuples, so this crosses through unknown.
const map = homeMap as unknown as MapData;

const { renderer, scene, camera, sun, sunDirection, setSun } = createScene(canvas, {
  sun: sunVector(map.centre[0], map.centre[1], new Date(LEVELS[0]?.when ?? 0)),
});
/**
 * How far up-sun the shadow camera sits from the bird.
 *
 * Recomputed whenever the sun moves, which is every time a level begins.
 */
const sunOffset = sunDirection.clone().multiplyScalar(SUN_RANGE);

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
 * Which vehicle of which rake a level's target is, with `middle` worked out
 * here because only this end knows how long the rake came out.
 */
const carOf = (target: Extract<LevelTarget, { kind: 'wagon' }>): number =>
  target.car === 'middle'
    ? Math.floor((layout.trains[target.train]?.vehicles.length ?? 1) / 2)
    : target.car;

const smoke = createSmoke();
/**
 * The landmark building belongs to whichever level is about a building, if
 * any is. None is yet, so it stands there as a landmark and nothing more --
 * which is what it looked like before it was ever a target.
 */
const landmarkLevel = LEVELS.find((spec) => spec.target.kind === 'building');

/** Where each level's concrete patch goes, in local metres. */
const patches = LEVELS.filter((spec) => spec.target.kind === 'patch').map((spec) => {
  const on = spec.target as Extract<LevelTarget, { kind: 'patch' }>;
  const at = project(on.at[0], on.at[1], map.centre);
  return { name: spec.name, x: at.x, z: at.z, size: on.size };
});
// Nothing solid: a patch is level with the grass, so it is a marking rather
// than a step. Landing on it, landing beside it and walking across from one
// to the other are all the same surface, which is what keeps the first level
// a first level.

const world = buildWorld(layout, {
  ...(landmarkLevel ? { landmark: landmarkLevel.name } : {}),
  patches,
  // Every level's target is built and sitting there dark. Which one is lit is
  // the whole of switching between them.
  objectives: LEVELS.filter((spec) => spec.target.kind === 'wagon').map((spec) => {
    const on = spec.target as Extract<LevelTarget, { kind: 'wagon' }>;
    return { name: spec.name, train: on.train, vehicle: carOf(on) };
  }),
  smoke: smoke.puffs.length,
});

/**
 * Storage, if the browser will give us any.
 *
 * Touching `localStorage` at all throws in some settings, so even getting
 * hold of it is a thing that can fail.
 */
function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** The one being flown, remembered between visits. */
let level = loadProgress(storage(), LEVELS.length);

/**
 * The last level finished and when, for the HUD to say so.
 *
 * It says so for a few seconds and then stops. An announcement that never
 * goes away is not an announcement, and this one sits in the slot everything
 * else has to speak through -- including the line telling you how to leave
 * the conversation you are in.
 */
let reached: string | null = null;
let reachedAt = 0;
const NOTE_SECONDS = 6;

/**
 * The resident the hero is standing with, or null.
 *
 * Held rather than recomputed from the level, because the level moves on the
 * moment they meet and the conversation does not: they go on standing there
 * until one of them walks away or takes off.
 */
let talkingTo: Resident | null = null;

// All of the above is declared here rather than beside the code that uses it
// because `playLevel` runs at module scope, and a `let` read before its own
// declaration throws. This file has now made that mistake twice.
const objective = (name: string) => world.markers.find((marker) => marker.name === name) ?? null;
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
const watchParams = { ...defaultWatchParams };
const windParams = { ...defaultWindParams };

// Rebuilt whenever the panel changes the air, since the field closes over its
// parameters rather than reading them each tick.
let wind = createWind(windParams);
const rebuildWind = () => {
  wind = createWind(windParams);
};

/**
 * Where a level starts, and which way the bird is pointed.
 *
 * The release point is named in degrees, but the city around it is generated,
 * so it makes sure nothing has been built into the space the bird appears in.
 * Pointed at whatever the level is about, which is the direction a homing
 * pigeon leaves in and saves the player a search before they have started.
 */
function releaseFor(spec: Level | undefined): { at: Vec3; heading: number } {
  const point = spec ? project(spec.start[0], spec.start[1], map.centre) : release;
  const floor = world.collider.heightAt(point.x, point.z);
  const marker = spec ? objective(spec.name) : null;
  const aim = marker ? { x: marker.position.x, z: marker.position.z } : home;
  return {
    at: vec(
      point.x,
      Number.isFinite(floor)
        ? Math.max(SPAWN_ALTITUDE, floor + SPAWN_CLEARANCE)
        : SPAWN_ALTITUDE,
      point.z,
    ),
    heading: bearing(point, aim),
  };
}

let start = releaseFor(LEVELS[level]);

let bird: BirdState = createBird(start.at, SPAWN_SPEED, start.heading);
let telemetry: FlightTelemetry = step(bird, input.controls, flightParams, TICK);
/** What the bird did on its feet this tick, when it was on them. */
let onFoot: WalkTelemetry = { grounded: false, travelled: 0, blocked: false };
/**
 * The walk controls handed to the simulation, rebuilt from the input each
 * tick. Take-off is an edge rather than a held key, and it is held here until
 * a tick has actually seen it: a frame short enough to run no ticks at all
 * would otherwise swallow the press.
 */
const walkControls: WalkControls = { forward: 0, turn: 0, launch: false };
let launchPending = false;

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

/**
 * Pigeons that stay where they are, and finishing a level means walking up to
 * one of them.
 *
 * Not part of the flock: the flock flies, and these do not do anything at all.
 * A resident is an ordinary `BirdState` marked as landed, standing on a named
 * solid, so that everything that already knows what to do with a bird on its
 * feet -- riding the wagon it is on, being drawn perched, being met -- works
 * on it without knowing it is not a player.
 */
interface Resident {
  state: BirdState;
  rig: ReturnType<typeof createBirdRig>;
  /** The level walking up to it completes. */
  completes: string;
  /** How red it is being washed this frame, 0 to 1. */
  glowing: number;
}

/** Where an arrow hangs over a resident: its own head, near enough. */
const personTop = (resident: Resident) =>
  new THREE.Vector3(
    resident.state.position.x,
    resident.state.position.y + 0.3,
    resident.state.position.z,
  );

/**
 * Which tag a vehicle's collision boxes are given.
 *
 * Shared with `moveTrains`, which assigns them, so a resident can say which
 * wagon it is standing on without the two drifting apart.
 */
function carrierOf(train: number, vehicle: number): number {
  let base = 0;
  for (let i = 0; i < train; i += 1) base += layout.trains[i]?.vehicles.length ?? 0;
  return base + vehicle;
}

/**
 * A pigeon standing on every level's target, waiting to be walked up to.
 *
 * Built once for all of them rather than made and unmade as levels change.
 * They are stationary birds on wagons that were going to be drawn anyway, and
 * a level nobody is playing having somebody standing on it costs a draw call
 * and reads, correctly, as a city with pigeons in it.
 */
const residents: Resident[] = [];
for (const spec of LEVELS) {
  const stood = standingSpot(spec);
  if (!stood) continue;

  const state = createBird(stood.at, 0, stood.facing);
  state.velocity = vec(0, 0, 0);
  state.restingOn = stood.on;
  state.ending = {
    kind: 'landed',
    cause: null,
    speed: 0,
    sink: 0,
    bank: 0,
    position: state.position,
  };
  const rig = createBirdRig(PIGEON_MORPHS[spec.person.morph % PIGEON_MORPHS.length]);
  scene.add(rig.object);
  residents.push({ state, rig, completes: spec.name, glowing: 0 });
}

/**
 * Where a level's resident stands, whatever kind of thing the level is about.
 *
 * The three kinds differ only in what they are standing on and how high that
 * is. `on` is the collider's tag for it, which only a wagon has -- a roof and
 * a slab of concrete are part of the world and belong to nobody, so a bird on
 * one is standing on nothing in particular, exactly as it is on the grass.
 */
function standingSpot(spec: Level): { at: Vec3; facing: number; on: number | null } | null {
  const person = spec.person;

  if (spec.target.kind === 'wagon') {
    const car = carOf(spec.target);
    const wagon = layout.trains[spec.target.train]?.vehicles[car];
    if (!wagon) return null;
    const spot = onVehicle(wagon, person.along, person.across);
    return {
      at: vec(spot.x, WAGON.deck + defaultParams.bodyRadius, spot.z),
      // Facing across the wagon, so it reads as standing about rather than
      // waiting to leave. It turns to look at you when you walk up to it.
      facing: wagon.yaw + Math.PI / 2,
      on: carrierOf(spec.target.train, car),
    };
  }

  // Everything else is a fixed thing, and the only question is what height
  // its top is. The marker already knows, having been built on it -- except
  // for a patch, whose marker sits on the marking and whose *surface* is the
  // ground the marking is painted on.
  const marker = objective(spec.name);
  if (!marker) return null;
  const top = spec.target.kind === 'patch' ? defaultParams.groundHeight : marker.position.y;
  return {
    at: vec(
      marker.position.x + person.along,
      top + defaultParams.bodyRadius,
      marker.position.z + person.across,
    ),
    facing: Math.PI / 2,
    on: null,
  };
}

const run = createRunTracker(bird);

// Previous tick's pose, so rendering can interpolate between ticks instead of
// showing the simulation's stair-steps.
let previousPosition: Vec3 = { ...bird.position };
let previousOrientation: Quat = { ...bird.orientation };

function respawn() {
  bird = createBird(start.at, SPAWN_SPEED, start.heading);
  previousPosition = { ...bird.position };
  previousOrientation = { ...bird.orientation };
  run.reset(bird);
  outcome.hide();
  chase.snap(bird, cameraParams);
}

/**
 * Switch to a level: its target, its hour, its release point.
 *
 * Everything a level is, applied in one place, so that starting the game and
 * picking one out of the menu and finishing the one before are all the same
 * thing happening.
 */
function playLevel(at: number): void {
  const spec = LEVELS[at];
  if (!spec) return;

  level = at;
  saveProgress(storage(), at);

  for (const marker of world.markers) marker.setActive(marker.name === spec.name);
  // Where the sun really was over this map at that hour, rather than wherever
  // looked all right.
  setSun(sunVector(map.centre[0], map.centre[1], new Date(spec.when)));
  sunOffset.copy(sunDirection).multiplyScalar(SUN_RANGE);

  reached = null;
  talkingTo = null;
  start = releaseFor(spec);
  respawn();
}

createDebugGui(flightParams, cameraParams, windParams, { respawn, rebuildWind });

const menu = createLevelMenu(overlay, LEVELS);
// The level being flown is the one remembered, applied through the same path
// everything else uses rather than by having been set up that way.
playLevel(level);

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
    // Every box knows how fast the rake is running, which is what makes
    // being touched by one fatal rather than merely blocking.
    fields.push(
      createColliderField(
        trainBoxes(train.vehicles, (vehicle) => base + vehicle, train.speed),
      ),
    );
  });

  // Anything standing on a wagon goes where the wagon goes. Without this a
  // bird that has just landed watches the train slide out from under it.
  const after = allVehicles();
  for (const passenger of [
    bird,
    ...flock.members.map((member) => member.state),
    ...residents.map((resident) => resident.state),
  ]) {
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

/**
 * Walking up to the resident that belongs to the level being flown finishes
 * it, and lights the next one.
 *
 * Both birds on their feet, both standing on the same solid, and within arm's
 * reach -- the middle of those is what stops a train running under a rooftop
 * from counting. `meeting` is where all three live; this only decides what
 * happens next.
 */
function reachLevel(): void {
  // Anyone at all, not just the one this level is about: standing with a
  // pigeon is standing with a pigeon, and the camera should say so.
  talkingTo = residents.find((resident) => meeting(bird, resident.state)) ?? null;

  const here = LEVELS[level];
  if (!here || talkingTo?.completes !== here.name) return;

  // The next one, if there is one. Staying put on the last is the honest
  // answer until there is something to move on to.
  if (level + 1 < LEVELS.length) playLevel(level + 1);

  // Announced *after* moving on, because starting a level clears the note --
  // which is right when you pick one out of the menu and wrong when you have
  // just earned it. Set here it survives, and says which one you finished.
  reached = here.name;
  reachedAt = clock;
}

/** The resident this level is about, if it has one. */
function levelPerson(): Resident | null {
  const here = LEVELS[level];
  return here ? (residents.find((r) => r.completes === here.name) ?? null) : null;
}



function frame(nowMs: number) {
  const now = nowMs / 1000;
  const frameTime = Math.min(now - lastTime, MAX_FRAME_TIME);
  lastTime = now;

  smoothedFps += (1 / Math.max(frameTime, 1e-4) - smoothedFps) * 0.1;

  input.update(frameTime);
  if (input.consumeMenu()) menu.toggle(level);
  // Digits are only ever a level while the menu is up, so they are offered to
  // it and it says whether it wanted one.
  for (let digit = input.consumeDigit(); digit !== null; digit = input.consumeDigit()) {
    const picked = menu.choose(digit);
    if (picked !== null) playLevel(picked);
  }
  if (input.consumeReset()) respawn();
  if (input.consumeLaunch()) launchPending = true;

  // Alive rather than flying: a walking bird is not flying, and being run
  // over while on foot is still a death that has to raise the panel.
  const wasAlive = !hasCrashed(bird);

  accumulator += frameTime;
  let ticked = false;
  while (accumulator >= TICK) {
    ticked = true;
    previousPosition = { ...bird.position };
    previousOrientation = { ...bird.orientation };
    solid = moveTrains(TICK);
    // Two modes, one of them live at a time. `walk` ignores a bird that is not
    // on its feet and `step` ignores one whose flight has ended, so which of
    // the two does anything is decided by the bird's own state rather than by
    // a flag kept alongside it.
    // Filtered by what the bird is doing. Talking takes the movement away and
    // leaves the wing, so the only way out of a conversation is to fly out of
    // it -- which is a thing you do on purpose.
    const allowed = asStance(
      { forward: input.walk.forward, turn: input.walk.turn, launch: launchPending },
      stanceOf(bird, talkingTo !== null),
    );
    walkControls.forward = allowed.forward;
    walkControls.turn = allowed.turn;
    walkControls.launch = allowed.launch;
    onFoot = walk(bird, walkControls, flightParams, TICK, solid);
    telemetry = step(bird, input.controls, flightParams, TICK, solid, wind);
    flock.update(TICK, solid, wind);
    if (bird.ending === null) run.update(bird, TICK);
    reachLevel();
    // Somebody you have walked up to looks at you.
    if (talkingTo) turnToFace(talkingTo.state, bird.position, flightParams, TICK);
    accumulator -= TICK;
  }
  if (ticked) launchPending = false;

  // Only a crash ends the run. A clean landing leaves the bird perched, which
  // is a place to watch it from rather than a screen to dismiss.
  if (wasAlive && hasCrashed(bird)) outcome.show(bird.ending!, run.stats);

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

  // --- What is being pointed at -------------------------------------------
  // Three states, and the marker is told the answer rather than working it
  // out: in the air you are looking for the place, on foot you are looking
  // for the pigeon standing on it, and once you have found them there is
  // nothing left to look for.
  const person = levelPerson();
  const pulse = targetFlash(now, false);
  const stance = stanceOf(bird, talkingTo !== null);

  const showing: 'object' | 'person' | 'nobody' =
    stance === 'flying' ? 'object' : stance === 'walking' && person ? 'person' : 'nobody';

  for (const resident of residents) {
    resident.glowing = showing === 'person' && resident === person ? pulse : 0;
  }

  const marker = objective(LEVELS[level]?.name ?? '');
  marker?.update(
    now,
    camera.position,
    showing === 'object' ? pulse : 0,
    showing === 'object'
      ? marker.position
      : showing === 'person' && person
        ? personTop(person)
        : null,
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

  for (const resident of residents) {
    resident.rig.update(resident.state, 'perched', frameTime, surfaceUnder(resident.state));
    resident.rig.glow(resident.glowing);
  }

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
  // Standing with somebody is a different shot: off the boom and to one
  // side, holding both of them. It eases from wherever the chase camera had
  // got to and back again, because it is the same camera.
  if (talkingTo) {
    chase.watch(interpolatedState.position, talkingTo.state.position, watchParams, frameTime);
  } else {
    chase.update(interpolatedState, activeCamera, frameTime);
  }

  // Keep the shadow frustum centred on the bird rather than on the origin.
  sun.target.position.set(
    interpolatedState.position.x,
    interpolatedState.position.y,
    interpolatedState.position.z,
  );
  sun.position.copy(sun.target.position).add(sunOffset);
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
    distance(interpolatedState.position, objective(LEVELS[level]?.name ?? '')?.position ?? home),
    smoothedFps,
    onFoot,
    reached === null || clock - reachedAt > NOTE_SECONDS
      ? null
      : level > levelNamed(reached)
        ? `${reached} reached — now for ${LEVELS[level]?.name}`
        : `${reached} reached — that is all of them`,
    stance === 'talking',
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
