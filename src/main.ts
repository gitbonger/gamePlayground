import * as THREE from 'three';
/**
 * Entry point: fixed-timestep simulation, interpolated rendering, live tuning.
 */


import {
  createBird,
  defaultParams,
  hasCrashed,
  heading,
  landingReadiness,
  isPerched,
  step,
  type BirdState,
  type FlightTelemetry,
} from './sim/flight';
import {
  quat,
  vec,
  type Quat,
  type Vec3,
} from './sim/math3';
import { createInput } from './input';
import { createRunTracker } from './run';
import { createDebugGui } from './debug-gui';
import { createScene } from './render/scene';
import {
  CHARACTER_MORPHS,
  createBirdRig,
  HERO_MORPH,
  PIGEON_MORPHS,
  type WingPose,
} from './render/bird';
import { createFlock } from './flock';
import { createAmbient } from './ambient';
import { createFlyover, type Flyover, type Framing } from './cutscene';
import {
  bellyOnEntry,
  crossed,
  crossingLine,
  dialogueOf,
  HOMECOMING,
  LEVELS,
  personOf,
  sceneNamed,
  targetName,
  type Level,
  type LevelTarget,
  type Opens,
  type Scene,
} from './levels';
import { HOME_TREE, LANDMARKS, PARK_PATCH } from './landmarks';
import { begin, isOver, reply, type Exchange } from './dialogue';
import { createDialoguePanel, speechColour } from './render/dialogue';
import { browserSpeaker, createVoice } from './render/voice';
import { createVitals, type Vital } from './render/vitals';
import {
  approachFor,
  cautionFor,
  courseFor,
  createTipPanel,
  createTutor,
  type Tip,
} from './render/tips';
import { loadProgress, saveProgress } from './progress';
import { DEFAULT_MODE, MODES, otherMode, paramsFor, windFor, type Mode } from './sim/modes';
import { createLevelMenu } from './render/menu';
import {
  aabb,
  combineColliders,
  createColliderField,
  type Collider,
} from './sim/collision';
import { createChaseCamera, defaultCameraParams, defaultWatchParams } from './render/camera';
import { createHud } from './render/hud';
import { defaultSight, sighted } from './render/sighted';
import { sunVector } from './render/sun';
import { createOutcomePanel } from './render/outcome';
import { buildWorld, targetFlash, type TargetMarker } from './world/city';
import { peopleOn, PERSON_HEIGHT, pointOn } from './world/layout';
import { createScatter, seedWithin } from './world/seeds';
import { buildLayoutFromMap, defaultMapWorldOptions } from './world/from-map';
import {
  carryPassengers,
  consistLength,
  layOutTrain,
  lineLength,
  boxCount,
  moveTrain,
  moveTrainBoxes,
  onVehicle,
  rakeNear,
  shuttle,
  stackTop,
  stockIsHauled,
  stockTop,
  tweenAlong,
  type Vehicle,
} from './world/train';
import { createSmoke, defaultSmokeOptions, type Puff, type Smoke } from './world/smoke';
import {
  asStance,
  meeting,
  standStill,
  stanceOf,
  turnToFace,
  walk,
  type WalkControls,
  type WalkTelemetry,
} from './sim/walk';
import { bearing, distance, project, unproject } from './world/geo';
import type { MapData } from './world/streets';
import homeMap from './world/data/home.json';
import { createWind, defaultWindParams } from './sim/wind';

/** Simulation tick rate. Fixed, so the flight model stays tunable and stable. */
const TICK = 1 / 120;
/** Never simulate more than this much time in one frame; a tab that was
 *  backgrounded for a minute should not try to catch up all of it. */
const MAX_FRAME_TIME = 0.25;

/**
 * Where home is.
 *
 * The tree, not the loft and not whatever this level happens to be about. The
 * readout in the corner counts the distance to it and nothing else, which is
 * no use at all for flying the level and is exactly the point: a homing
 * pigeon's one instrument is the direction of home, and the story is about
 * leaving it and getting back. It used to follow the lit target, which made
 * it a second distance-to-go readout beside the arrow that already says so.
 */
const HOME_POINT: [number, number] = HOME_TREE.at;

const SPAWN_SPEED = 16;

/**
 * How near a bird has to be for its own bar to be worth drawing, in metres.
 *
 * Close enough that it is a bird you are dealing with rather than one of the
 * dots on a roof three streets away.
 */
const VITALS_REACH = 40;

/**
 * Clearance kept above anything standing at the release point.
 *
 * The one thing that overrides a level's stated release height. Being let go
 * inside a roof is not a hard level, it is a bug, and no level should have to
 * know what the generator happened to build under it.
 */
const SPAWN_CLEARANCE = 40;

/** How far up-sun the shadow camera sits from the bird, in metres. */
const SUN_RANGE = 320;

const canvas = document.querySelector<HTMLCanvasElement>('#viewport')!;
const overlay = document.querySelector<HTMLElement>('#overlay')!;

// Real streets from OpenStreetMap, with the blocks between them filled in.
// JSON widens the fixed-length tuples, so this crosses through unknown.
const map = homeMap as unknown as MapData;

const { renderer, scene, camera, sun, sunDirection, setSun, setPixelRatio } = createScene(canvas, {
  sun: sunVector(map.centre[0], map.centre[1], new Date(LEVELS[0]?.when ?? 0)),
});
/**
 * How far up-sun the shadow camera sits from the bird.
 *
 * Recomputed whenever the sun moves, which is every time a level begins.
 */
const sunOffset = sunDirection.clone().multiplyScalar(SUN_RANGE);

const home = project(HOME_POINT[0], HOME_POINT[1], map.centre);

/**
 * The yard, where both trains stand.
 *
 * One point for the two of them: a train takes the roomiest line near it that
 * nothing else has taken, so the second one ends up on the next track over,
 * which is what two trains in a yard look like.
 */
const TRAIN_POINT: [number, number] = [47.500052, 19.088174];
const train = project(TRAIN_POINT[0], TRAIN_POINT[1], map.centre);

/**
 * The tramway west of the city, beside the fourth level's patch of concrete.
 *
 * On the line rather than near it: a tram is put on the tramway nearest the
 * point it is asked for, and this one has a railway within reach as well.
 */
const TRAM_POINT: [number, number] = [47.496648, 19.070644];
const tram = project(TRAM_POINT[0], TRAM_POINT[1], map.centre);

/**
 * Further down the same tramway, where it is double track.
 *
 * One point for the pair of them: a tram takes the tramway nearest it that
 * nothing else has taken, so the second ends up on the other road. Measured,
 * the two come out 3 to 6 m apart, which is a pair of tracks and not two
 * lines that happen to run near each other.
 */
const TRAM_PAIR: [number, number] = [47.495932, 19.072042];
const trams = project(TRAM_PAIR[0], TRAM_PAIR[1], map.centre);

const layout = buildLayoutFromMap(map, {
  ...defaultMapWorldOptions,
  // Described first, and everything generated afterwards gives way to them.
  // The park the home tree stands in is a cemetery, which the map has no idea
  // about: its areas are park, wood, water and pitch, and which of the parks
  // is a burial ground is a decision about this story rather than a fact off
  // OpenStreetMap. Named by the tree's own coordinate, so there is nothing to
  // keep in step if the tree moves again.
  cemetery: project(HOME_TREE.at[0], HOME_TREE.at[1], map.centre),
  landmarks: LANDMARKS.map((landmark) => {
    const at = project(landmark.at[0], landmark.at[1], map.centre);
    const { at: _degrees, ...rest } = landmark;
    return { ...rest, x: at.x, z: at.z };
  }),
  trains: [
    // The rake of stake wagons, shuttling up and down the yard. First in the
    // list because a level names it by its place in this one.
    { near: train, cars: 12 },
    // And three passenger trains, all of which leave: out of the platforms
    // and away down whatever main line the switches lead them onto, to
    // wherever the track really stops, and back. They come out with 3,687 m,
    // 3,004 m and 899 m to run, against the two or three hundred metres of
    // the ways they start on.
    //
    // No two of them share a way -- a route marks everything it runs over as
    // spoken for -- so each is asked for after the last has taken its road
    // and gets the best of what is left. Different lengths and different
    // speeds so the yard reads as a station with several trains working out
    // of it rather than as one train drawn three times.
    { near: train, cars: 6, stock: 'carriage', speed: 16, runsOut: true },
    { near: train, cars: 4, stock: 'carriage', speed: 13, runsOut: true },
    { near: train, cars: 8, stock: 'carriage', speed: 11, runsOut: true },
    // And a tram, on the tramway rather than the railway: four articulated
    // cars, no locomotive, and 3.2 km of route once the switches are
    // followed. Set off south, which the line does not know how to be -- a
    // polyline is drawn in whatever order somebody traced it -- so it is
    // asked for as a bearing and worked out from the tangent.
    { near: tram, cars: 4, stock: 'tram', speed: 10, runsOut: true, setOff: 180 },
    // Two more where the line is double track, one on each road, set off
    // against each other the way a pair of tracks is worked. They would come
    // out opposed anyway, the two roads having been traced in opposite
    // orders -- which is exactly the thing not to rely on, since it is a fact
    // about the map's editing history rather than about the tramway.
    { near: trams, cars: 4, stock: 'tram', speed: 10, runsOut: true, setOff: 110 },
    { near: trams, cars: 4, stock: 'tram', speed: 10, runsOut: true, setOff: 290 },
  ],
  // And then the rest of the network, which nothing in the game names or
  // cares about. A city with a hundred and thirty kilometres of tramway and
  // three trams on it reads as a model of a city; these are what make it a
  // working one. They go wherever there is a line long enough, one to a
  // route, and nobody decides where.
  fill: [
    { stock: 'tram', cars: 4, speed: 10, minRoute: 320, most: 30 },
    { stock: 'carriage', cars: 5, speed: 14, minRoute: 1200, most: 8 },
  ],
});
/**
 * Which vehicle of which rake a level's target is, with `middle` worked out
 * here because only this end knows how long the rake came out.
 */
const carOf = (target: Extract<LevelTarget, { kind: 'wagon' }>): number =>
  target.car === 'middle'
    ? Math.floor(((layout.trains[target.train]?.cars ?? 0) + 1) / 2)
    : target.car;

/**
 * A plume per working engine, and none for anything standing still.
 *
 * One `Smoke` is one emitter with a pool sized for its own rate, so several
 * chimneys are several of them rather than one called several times -- called
 * twice in a tick it would advect every puff it owns twice. The pools are
 * concatenated once here and the same array handed to the renderer every
 * frame, because the puffs are stable objects that get written in place.
 *
 * The goods engine works hard up and down the yard; the passenger engines are
 * running easily on the main line, so they get a thinner plume, which costs
 * proportionally less to keep as well as looking like less effort. A tram has
 * no chimney and no emitter, which is the same rule as a train standing in a
 * platform: nothing special, it just never gets one.
 */
const smokes = layout.trains
  .map((train, index) =>
    train.speed > 0 && stockIsHauled(train.stock)
      ? {
          index,
          // One shape of plume for every chimney, and deliberately so: the
          // renderer draws a puff from `defaultSmokeOptions`, because a puff
          // carries where it is and how far it has risen but not which plume
          // it belongs to. Give one engine a different reach and its smoke
          // vanishes at full strength instead of thinning away.
          puffs: createSmoke(
            defaultSmokeOptions,
            // A seed each, or every chimney billows in step.
            99 + index * 17,
          ),
        }
      : null,
  )
  .filter((each): each is { index: number; puffs: Smoke } => each !== null);

/** Every puff in the world, in one array the renderer can be given as is. */
const allPuffs: Puff[] = smokes.flatMap((each) => each.puffs.puffs);

/**
 * How far a painted finishing line reaches either side of the route.
 *
 * The whole map, because that is what the line is. The rule has no ends --
 * any path from the near side to the far side crosses it, however wide the
 * detour -- and a stripe that stopped a hundred metres out would have been
 * telling a smaller truth than the rule it stands for. Painting all of it
 * costs one more quad.
 */
const GATE_SPAN = map.radius * 2;

/**
 * The finishing lines to paint, one for every level that ends at one.
 *
 * Worked out from the same two points the crossing itself is: the level's
 * release point and the thing it is aimed at. Two calculations of one line
 * would be one calculation too many -- the paint and the rule have to be in
 * the same place or the paint is a lie.
 */
const gates = LEVELS.flatMap((spec) => {
  const finish = spec.finish;
  if (finish.kind !== 'crossing' || spec.target.kind !== 'landmark') return [];
  const described = LANDMARKS.find((landmark) => landmark.name === spec.target.name);
  if (!described) return [];

  const line = crossingLine(
    project(spec.start[0], spec.start[1], map.centre),
    project(described.at[0], described.at[1], map.centre),
    finish.at,
  );
  // The band is modelled along its own x, so it is turned to lie along the
  // route: the same convention everything else on this map is turned in.
  return [
    {
      name: spec.name,
      x: line.x,
      z: line.z,
      yaw: Math.atan2(-line.uz, line.ux),
      span: GATE_SPAN,
    },
  ];
});

/**
 * The grain, and the person throwing it.
 *
 * One scatter, at the patch of concrete the food level is about, thrown by
 * the person already standing beside it. Eight down at a time: at the limit
 * the oldest is picked up and thrown somewhere else, so the ground keeps a
 * handful and it is never the same handful.
 */
const SEEDS_AT_ONCE = 8;
/**
 * How much of a belly one seed is worth: a tenth.
 *
 * Ten seeds for a full belly, against eight on the ground at a time, so a
 * meal is a scatter and a bit rather than a long patient job. Grain this size
 * is already ten times life; a bird that had to eat forty of them would be a
 * bird doing paperwork.
 */
const SEED_VALUE = 0.1;
/** How near a standing bird's beak gets to the ground around it, in metres. */
const BEAK_REACH = 0.35;

const feeder = layout.landmarks.find((landmark) => landmark.name === PARK_PATCH.name);
const hand = feeder ? peopleOn(feeder)[0] : undefined;
const scatter =
  feeder && hand
    ? createScatter({
        // Out of a hand rather than off the ground: chest height on somebody
        // two metres tall.
        from: { x: hand.x, y: hand.base + PERSON_HEIGHT * 0.7, z: hand.z },
        onto: { x: feeder.x, z: feeder.z },
        // Onto the slab and not over its edge, a seed's width in from it.
        spread: Math.min(feeder.width, feeder.depth) / 2 - 0.3,
        most: SEEDS_AT_ONCE,
        // One piece every three seconds. It was 1.6, and at the limit the
        // oldest is picked up and thrown again -- so a seed was vanishing off
        // the concrete every 1.6 seconds, often the one being walked towards.
        // Three is slow enough that the ground looks settled between throws.
        every: 3,
        random: Math.random,
      })
    : null;

const world = buildWorld(layout, {
  seeds: SEEDS_AT_ONCE,
  gates,
  // The described things need no list here: they arrive on the layout already
  // named, having been put there on purpose. Only the wagons do, because
  // which wagon is a level is a decision about the game rather than a fact
  // about the train.
  objectives: LEVELS.filter((spec) => spec.target.kind === 'wagon').map((spec) => {
    const on = spec.target as Extract<LevelTarget, { kind: 'wagon' }>;
    return { name: on.name, train: on.train, vehicle: carOf(on) };
  }),
  smoke: allPuffs.length,
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

/** Seconds of simulated time since the page loaded. */
let clock = 0;

/**
 * Whether the level being flown has been finished.
 *
 * Finishing it and moving on are two things. You meet the pigeon waiting at
 * the target and that is the level done -- and then you are standing there
 * with them, which is where the conversation goes once there is one. The next
 * level begins when you leave, from its own point at its own hour, with
 * nothing carried over. Levels are separate places rather than one long
 * flight, which is easier to build and, with a fresh start each time, rather
 * more of an occasion.
 */
let finished = false;

/**
 * The conversation with the pigeon at the target, once there is one.
 *
 * Null until the level is finished, and the reason the take-off key does not
 * simply move you on: you say your piece first.
 */
let talk: Exchange | null = null;

/**
 * The level just started, named on screen for a few seconds.
 *
 * Set by whatever started it, so picking one out of the menu says the same
 * thing as flying on from the one before.
 */
let started: string | null = null;
let startedAt = 0;
const NOTE_SECONDS = 5;

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
/** The marker for whatever the level being played is about. */
const activeMarker = () => {
  const here = LEVELS[level];
  return here ? objective(targetName(here)) : null;
};
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

/**
 * Which birds are worth drawing, reused rather than rebuilt every frame.
 *
 * The hero is never asked -- it is the thing the camera is pointed at.
 */
const sightForward = new THREE.Vector3();
const sight = { ...defaultSight, eye: camera.position, forward: sightForward };
const hud = createHud(overlay, map.attribution);
const outcome = createOutcomePanel(overlay);
const input = createInput();

/**
 * Which simulation is being flown, and everything that follows from it.
 *
 * The mode owns three numbers and one choice of air, all of them worked out
 * in `sim/modes` -- so switching is: take the parameters the mode asks for,
 * take the air it asks for, and carry on. `flightParams` keeps its identity
 * through it because the tuning panel is bound to that object.
 */
let mode: Mode = MODES[DEFAULT_MODE];
const flightParams = { ...paramsFor(mode) };
const cameraParams = { ...defaultCameraParams };
const watchParams = { ...defaultWatchParams };
const windParams = { ...defaultWindParams };

// Rebuilt whenever the panel changes the air, since the field closes over its
// parameters rather than reading them each tick.
let weather = createWind(windParams);
/**
 * The air everything is actually flown in.
 *
 * The mode's choice rather than the field itself: in the basic one this is
 * still air, and it is still air for the flock and the smoke as well as for
 * the player. A mode where the wind blows the chimney smoke sideways while
 * the bird cannot feel it is a mode that shows you something it then denies.
 */
let wind = windFor(mode, weather);
const rebuildWind = () => {
  weather = createWind(windParams);
  wind = windFor(mode, weather);
};

/** Fly the other one, from here on. */
function switchMode(to: Mode): void {
  mode = to;
  // Assigned into rather than replaced: the tuning panel holds this object.
  Object.assign(flightParams, paramsFor(mode));
  wind = windFor(mode, weather);
}

/**
 * Where a level starts, and which way the bird is pointed.
 *
 * The release point is named in degrees, but the city around it is generated,
 * so it makes sure nothing has been built into the space the bird appears in.
 * Pointed at whatever the level is about, which is the direction a homing
 * pigeon leaves in and saves the player a search before they have started.
 */
function releaseFor(spec: Level): { at: Vec3; heading: number; perched: boolean } {
  const point = project(spec.start[0], spec.start[1], map.centre);
  const floor = world.collider.heightAt(point.x, point.z);
  const marker = objective(targetName(spec));
  const aim = marker ? { x: marker.position.x, z: marker.position.z } : home;

  // A perched level does not release the bird at all: it stands him on the
  // thing the level is about, opposite whoever is waiting there -- her offset
  // from the middle, mirrored. The middle would be simpler and is wrong: on a
  // platform not much wider than the two of them it puts him on top of her.
  // Mirrored, they face each other across it, and the level is complete
  // before the player has touched anything, which is the whole idea of it.
  const stood = spec.begins === 'perched' ? standingSpot(spec) : null;
  const described = LANDMARKS.find((l) => l.name === spec.target.name);
  const waiting = personOf(spec);
  if (marker && stood && waiting) {
    const across = pointOn(
      { x: marker.position.x, z: marker.position.z, yaw: described?.yaw ?? 0 },
      -waiting.along,
      -waiting.across,
    );
    const at = vec(across.x, stood.at.y, across.z);
    return { at, heading: bearing(at, stood.at), perched: true };
  }

  return {
    at: vec(
      point.x,
      Number.isFinite(floor)
        ? Math.max(spec.release, floor + SPAWN_CLEARANCE)
        : spec.release,
      point.z,
    ),
    heading: bearing(point, aim),
    perched: false,
  };
}

// The level being flown, which `loadProgress` has already made sure is one
// the game has. The fallback is for the type rather than for the case.
let start = releaseFor(LEVELS[level] ?? LEVELS[0]!);

let bird: BirdState = createBird(start.at, start.perched ? 0 : SPAWN_SPEED, start.heading);
if (start.perched) standStill(bird);
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
 * The other pigeons on the concrete: four of them, ambient.
 *
 * They are here because of the person throwing grain. Somebody feeding
 * pigeons with no pigeons in front of them is somebody throwing food on the
 * ground, and the level asks the player to walk into that scene and eat --
 * which reads as joining a crowd rather than as scavenging alone only if
 * there is a crowd.
 *
 * Ambient, in the sense the module sets out: nothing they do changes the
 * game. They are not the birds a level is finished by walking up to, they do
 * not eat the grain, and the level's condition is the player's belly and
 * nothing else.
 */
const AMBIENT_PIGEONS = 4;
const ambient = feeder
  ? createAmbient({
      count: AMBIENT_PIGEONS,
      ground: {
        x: feeder.x,
        z: feeder.z,
        yaw: feeder.yaw ?? 0,
        width: feeder.width,
        depth: feeder.depth,
        // A flat thing has no top of its own, so it is the ground's.
        top: feeder.height > 0 ? feeder.height : defaultParams.groundHeight,
      },
      morphs: PIGEON_MORPHS.length,
      flight: flightParams,
    })
  : null;

const ambientRigs = (ambient?.birds ?? []).map((pigeon) => {
  const rig = createBirdRig(PIGEON_MORPHS[pigeon.morph]);
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
  /** The colour its words are printed in: its own, made readable. */
  voice: string;
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
  // A train is its engine and its cars, whatever the last layout managed to
  // place: the tags have to be the same every tick or a resident's idea of
  // which wagon it is on drifts off the wagon.
  for (let i = 0; i < train; i += 1) {
    const each = layout.trains[i];
    base += each ? each.cars + 1 : 0;
  }
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
  // Whoever waits on a level the hero starts *on* is in the same story and
  // the same morning as he is, and is as hungry. The rest are standing about
  // in somebody else's afternoon.
  if (spec.begins === 'perched') state.health = spec.health;
  standStill(state);
  state.restingOn = stood.on;
  const morph = CHARACTER_MORPHS[(personOf(spec)?.morph ?? 0) % CHARACTER_MORPHS.length]!;
  const rig = createBirdRig(morph);
  scene.add(rig.object);
  residents.push({
    state,
    rig,
    completes: spec.name,
    voice: speechColour(morph.body),
    glowing: 0,
  });
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
  const person = personOf(spec);
  // Nobody waits at a line. A level that ends by being crossed has no arrival
  // to stand at, and a resident for it would be a second pigeon on the same
  // slab as the next level's.
  if (!person) return null;

  if (spec.target.kind === 'wagon') {
    const car = carOf(spec.target);
    const wagon = layout.trains[spec.target.train]?.vehicles[car];
    if (!wagon) return null;
    const spot = onVehicle(wagon, person.along, person.across);
    return {
      at: vec(spot.x, stockTop(wagon.kind) + defaultParams.bodyRadius, spot.z),
      // Facing across the wagon, so it reads as standing about rather than
      // waiting to leave. It turns to look at you when you walk up to it.
      facing: wagon.yaw + Math.PI / 2,
      on: carrierOf(spec.target.train, car),
    };
  }

  // Otherwise it is one of the described things, which stands still and whose
  // shape is written down. The marker gives the place -- over the terrace of
  // a block of flats, over the middle of a patch of concrete -- and the
  // description gives the height, because a flat one's marker sits a hair
  // above the marking while what stands there stands on the ground.
  const described = LANDMARKS.find((landmark) => landmark.name === spec.target.name);
  const marker = objective(spec.target.name);
  if (!described || !marker) return null;
  const top = described.height > 0 ? described.height : defaultParams.groundHeight;
  // Placed along and across the thing rather than along and across the world,
  // so turning the building turns where its pigeon stands with it.
  const yaw = described.yaw ?? 0;
  const at = pointOn(
    { x: marker.position.x, z: marker.position.z, yaw },
    person.along,
    person.across,
  );
  return {
    at: vec(at.x, top + defaultParams.bodyRadius, at.z),
    facing: yaw + Math.PI / 2,
    on: null,
  };
}

const run = createRunTracker(bird);

// Previous tick's pose, so rendering can interpolate between ticks instead of
// showing the simulation's stair-steps.
let previousPosition: Vec3 = { ...bird.position };
let previousOrientation: Quat = { ...bird.orientation };

/**
 * Put the bird at the start of the level being flown, in the light of it.
 *
 * The hour and the start point are one thing, and this is the one place
 * either of them is applied. A level says where you are released and what
 * time it is when you are, so a level you are never released into never
 * imposes either: walk out of a conversation into the next level and you
 * carry on from the branch you were standing on, at the hour you were
 * standing there. Which is the only thing that could happen -- an hour that
 * arrived on its own would cut the whole sky in a frame while the bird had
 * not so much as opened its wings.
 *
 * This is also why a level handed over in place still works out where its
 * start *is*, having no intention of going there. Dying is the reason. A
 * level entered by talking was entered once, and a bird that flew into a wall
 * two hundred metres later should not have to be talked into it again -- so
 * what a death returns you to is the level's own start point, in the level's
 * own light, exactly as though you had picked it out of the menu. The
 * conversation happened. It is not going to happen twice.
 */
function respawn() {
  const here = LEVELS[level];
  if (here) {
    // Where the sun really was over this map at that hour, rather than
    // wherever looked all right.
    setSun(sunVector(map.centre[0], map.centre[1], new Date(here.when)));
    sunOffset.copy(sunDirection).multiplyScalar(SUN_RANGE);
  }

  bird = createBird(start.at, start.perched ? 0 : SPAWN_SPEED, start.heading);
  // Put here rather than arrived here, so the level's own figure is the
  // figure: what the last flight left is gone with the last flight.
  if (here) bird.health = here.health;
  if (start.perched) standStill(bird);
  previousPosition = { ...bird.position };
  previousOrientation = { ...bird.orientation };
  run.reset(bird);
  // A flight starting again is a player starting again: the lessons come back
  // with the distance, which is the whole reason they are measured in metres
  // flown rather than remembered for good.
  tutor.reset();
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
function playLevel(at: number, where: 'released' | 'in place' = 'released'): void {
  const spec = LEVELS[at];
  if (!spec) return;

  level = at;
  saveProgress(storage(), at);

  for (const marker of world.markers) marker.setActive(marker.name === targetName(spec));
  // Only this level's line is painted. Every other one belongs to a flight
  // that is not being flown, and a stripe across the ground that means
  // nothing is worse than no stripe at all.
  for (const gate of world.gates) gate.object.visible = gate.name === spec.name;

  finished = false;
  talk = null;
  started = spec.name;
  startedAt = clock;
  talkingTo = null;
  // Where the level would put you if you asked for it again -- from the menu,
  // or by pressing R after making a mess of it. Worked out either way; it is
  // only the *going* there that a level taken up in place skips, and with it
  // the level's own hour, which `respawn` is the only thing that applies.
  start = releaseFor(spec);
  // Put down on purpose -- picked out of the menu, or dead and starting again
  // -- is re-entering the story before she left it, and she was there then.
  if (where === 'released') sheHasGone = false;
  // What this level teaches, from where it starts teaching it. A level taken
  // up in mid-air inherits the distance the last one ran up, so the course
  // counts from here rather than from the take-off two levels ago.
  tutor.teach(courseFor(spec.name), where === 'in place' ? run.stats.distance : 0);
  // The finishing line, if this level has one: square across the way to the
  // target, so far along it. Worked out here, from the release point this
  // level was given rather than from wherever the bird happens to be, so that
  // arriving at the level in mid-air puts the line in the same place as
  // taking off into it.
  const marker = objective(targetName(spec));
  handover = handoverFor(spec, marker);
  // Walked into rather than put down in: keep whatever the last level left,
  // unless this one needs more than that to be flyable at all.
  if (where === 'in place') bird.health = bellyOnEntry(spec, bird.health);
  if (where === 'released') respawn();
}

/**
 * How this level ends of its own accord, if it does, and what it opens.
 *
 * Two of the three finishes hand the next level over where the bird already
 * is: a line to cross, and a belly to fill. They differ only in the question
 * being asked, so they are one thing here with the question kept as a
 * closure -- adding a fourth is writing a fourth question. The third ends in
 * a conversation, which is nobody's business but the conversation's, and
 * gives back nothing.
 */
let handover: { done: () => boolean; opens: Opens } | null = null;

function handoverFor(spec: Level, marker: TargetMarker | null) {
  const ends = spec.finish;
  if (ends.kind === 'meeting') return null;
  // Eaten. There is no arrival to test, only a bird that has had enough --
  // which it can reach standing still in one spot, and usually does.
  if (ends.kind === 'fed') return { done: () => bird.health >= 1, opens: ends.opens };
  if (!marker) return null;
  // Crossed. Square across the way to the target, so far along it. Worked out
  // from the release point this level was given rather than from wherever the
  // bird happens to be, so that arriving in mid-air puts the line in the same
  // place as taking off into it does.
  const line = crossingLine(
    project(spec.start[0], spec.start[1], map.centre),
    { x: marker.position.x, z: marker.position.z },
    ends.at,
  );
  return { done: () => crossed(line, bird.position.x, bird.position.z), opens: ends.opens };
}

/**
 * End the level if whatever it is waiting for has happened.
 *
 * The hand-over is the same one a conversation makes: the next level begins
 * where the bird is, at the speed it was already going. What it changes is
 * where a death puts you -- which is the whole point of it, and the reason
 * this is a level rather than a checkpoint.
 */
function handOver(): void {
  if (!handover?.done()) return;
  const opens = handover.opens;

  if ('scene' in opens) {
    const scene = sceneNamed(opens.scene);
    if (scene) beginScene(scene);
    return;
  }
  const next = LEVELS.findIndex((spec) => spec.name === opens.level);
  if (next < 0) return;
  playLevel(next, 'in place');
}

/**
 * The scene being played, while the game has the controls.
 *
 * Null almost always, and while it is not, the player is an audience: the
 * keys do nothing, the instruction panel is empty, and the bird is flown by
 * the autopilot. What is kept alongside the flight is where it ends, worked
 * out when it starts rather than when it finishes -- the closing shot is a
 * place in the world and it does not depend on how the flying went.
 */
let cutscene: { play: Flyover; scene: Scene; ends: ReturnType<typeof releaseFor> } | null = null;

/**
 * Whether the bird that stood in the closing shot has gone.
 *
 * She is the resident of the level the scene closes on, which is how the
 * story says it without a second list to keep in step: the pigeon standing in
 * the shot the game is about to play back, empty. Cleared by anything that
 * puts the player down somewhere on purpose -- picking a level, or dying --
 * because that is re-entering the story before she left, and she was there
 * then.
 */
let sheHasGone = false;

/** Whether a resident is still in the story, and so still on its branch. */
const stillThere = (resident: Resident): boolean =>
  !sheHasGone || resident.completes !== HOMECOMING.endsOn;

/**
 * The shot a bird on its feet is filmed in: close, low, and level.
 *
 * Named rather than written where it is used, because it is used twice now --
 * once by the camera that settles on a landed bird, and once to work out
 * where a scene's closing shot is, which is the same shot arrived at from a
 * different direction. Two copies of it would drift, and the whole point of
 * the closing shot is that it is the one the player already remembers.
 */
function perchedCamera(walking: boolean) {
  return {
    distance: 1.4,
    height: 0.35,
    // A walking bird is going somewhere, so the camera looks ahead of it and
    // keeps up. A standing one is the subject of the shot, and a boom that
    // drifts in over most of a second suits it.
    lookAhead: walking ? 2.2 : 0.3,
    rollFollow: 0,
    positionHalfLife: walking ? 0.12 : 0.7,
    baseFov: 55,
    fovGain: 0,
  };
}

/** Take the camera off the bird and fly it home. */
function beginScene(scene: Scene): void {
  const closing = LEVELS.find((spec) => spec.name === scene.endsOn);
  if (!closing) return;

  // Where the level it closes on begins, which is a branch eighteen metres up
  // with somebody standing opposite. The same call the game makes to put the
  // player there, so the shot cannot drift from the one they remember: move
  // the tree and the closing shot moves with it.
  const ends = releaseFor(closing);
  const from: Framing = {
    eye: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    look: { ...interpolatedState.position },
  };

  // And where the camera has to get to, asked of the camera rather than
  // worked out again here: a stand-in bird is put in the closing shot, the
  // chase camera is snapped onto it, and where it lands is the answer. Two
  // calculations of one shot would be one too many, and the arithmetic of a
  // boom is exactly the sort that goes quietly out of step.
  const stand = createBird(ends.at, 0, ends.heading);
  standStill(stand);
  chase.snap(stand, { ...cameraParams, ...perchedCamera(false) });
  const to: Framing = {
    eye: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    look: { ...ends.at },
  };

  cutscene = {
    scene,
    ends,
    play: createFlyover(from, to, { seconds: scene.seconds, arc: scene.cruise }),
  };

  // The level that opened it is over, and must not open it again: the belly
  // is still full, so the condition that started this is still true.
  handover = null;
  talk = null;
  talkingTo = null;
}

/** Put the bird in the closing shot, and let the player have it back. */
function endScene(): void {
  if (!cutscene) return;
  const { ends, scene } = cutscene;
  cutscene = null;

  // He is simply there. Nothing flew him: the camera went, and the point of
  // the shot is where the player now is -- the same spot, the same heading,
  // the same camera as the morning he left, and nobody opposite him.
  const home = createBird(ends.at, 0, ends.heading);
  home.health = bird.health;
  home.stamina = bird.stamina;
  bird = home;
  standStill(bird);
  previousPosition = { ...bird.position };
  previousOrientation = { ...bird.orientation };

  sheHasGone = true;
  storyNote = { text: scene.says, at: clock };
  outcome.hide();
  // Nothing left to teach. The level the scene came out of still has a course
  // -- its last lesson is the one about eating, and it waits for the feet to
  // come down, which they have just done nine hundred metres from the grain.
  // The act is over; the panel should be empty for the last shot of it.
  tutor.teach([], run.stats.distance);
  // Cut rather than swung: the camera is sixty metres up and the closing shot
  // is a metre and a half behind a standing bird, and easing between those
  // two is a long fairground ride. Taken at the end of the frame, once the
  // perched shot has actually been worked out -- snapping here would snap to
  // whatever the camera wanted while it was still flying.
  cutTo = true;
}

/** Whether the camera should jump to the shot rather than ease into it. */
let cutTo = false;

/** What the picture is drawn at, so the panel can move it and see. */
const pictureParams = { pixelRatio: renderer.getPixelRatio() };
createDebugGui(flightParams, cameraParams, windParams, pictureParams, {
  respawn,
  rebuildWind,
  repaint: () => setPixelRatio(pictureParams.pixelRatio),
});

const menu = createLevelMenu(overlay, LEVELS, () => {
  // Switching takes effect on the spot rather than at the next level: the
  // bird carries on from where it is, in the air it is now in, with the
  // parameters the new mode asks for. Which is the honest thing for a switch
  // to do -- somebody who turns the wind off wants the wind off now.
  switchMode(otherMode(mode));
  menu.showMode(level, mode);
});
const talkPanel = createDialoguePanel(overlay);
const tipPanel = createTipPanel(overlay);
/** The bars over the heads of the birds you are looking at. */
const vitals = createVitals(overlay);
/**
 * The same instructions, said out loud.
 *
 * Reading is the one thing a player three seconds from a rooftop cannot spare
 * attention for, and speech arrives without being looked at. V turns it off,
 * for the two of us who will get tired of it first.
 */
const voice = createVoice(browserSpeaker(window.speechSynthesis));
/** Hands out the flying lessons, by how far this flight has gone. */
const tutor = createTutor();
/**
 * Whether the game is still teaching.
 *
 * On for now, and it turns itself off nowhere: which level has earned the
 * player the right to be left alone is not decided yet, and when it is, it is
 * one line in `playLevel`. What it gates is the instructions that watch the
 * flight rather than the flight's distance -- the ones that say pull up, keep
 * flapping, slow down. Those are exactly right for somebody learning and
 * exactly wrong for somebody who knows, since a pigeon spends half its life
 * low, slow or tired on purpose.
 */
let tutorial = true;
/** The hero's own colour, which is what his half of a conversation is set in. */
const hero = speechColour(HERO_MORPH.body);
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
/**
 * How close the bird has to be for a train to be worth drawing exactly.
 *
 * Generous: the bird covers 30 m in a second at its fastest, so it takes ten
 * seconds to cross this, and the test is made every tick. There is no way to
 * arrive somewhere before the rake there has been boxed.
 */
const TRAIN_REACH = 300;
/**
 * How often one out of reach is put back where it has got to, in seconds.
 *
 * Thirty times a second, which is a third of a metre of tram. It was once a
 * second, and that was a rule made when laying a rake out in world
 * coordinates was most of the simulation -- before the cumulative-distance
 * tables turned `pointAlong` from a walk along a polyline into a binary
 * search over one, and before the collision boxes stopped being rebuilt from
 * scratch. It is not that any more, and the leftover rule was visible: a tram
 * a kilometre off does not blur into invisibility, it lurches, and the eye
 * finds a lurch across a whole city.
 *
 * Measured rather than guessed. One pass over all thirty-eight trains and
 * their hundred and sixty-eight vehicles is 0.017 ms, so this costs 0.5 ms a
 * second. Every frame would cost 1.0, which is also affordable; thirty is
 * where more stops being visible.
 */
const DISTANT_REDRAW = 1 / 30;
/** When each train was last laid out in world coordinates. */
const laidOut = layout.trains.map(() => Number.NEGATIVE_INFINITY);
/**
 * Each rake's collision boxes, made once and moved ever after.
 *
 * A train never changes -- the same locomotive and the same twelve wagons,
 * the same shape, for as long as the game is open. Only where they are
 * changes, so these are written over rather than built again.
 */
const trainBoxSets = layout.trains.map((train) =>
  Array.from({ length: boxCount(train.cars, train.stock) }, () => aabb(0, 0, 0, 0, 0, 0)),
);
/** And the pose each is drawn in, between one tick and the next. */
const drawnVehicles = layout.trains.map((train) =>
  layOutTrain(train.line, train.along, train.cars, train.stock),
);
/** And which of them were near enough to be worth it, this tick. */
const near = layout.trains.map(() => false);

/**
 * Every vehicle on the map, flattened. The index is its carrier tag.
 *
 * Worked out once. The vehicles are the same objects for as long as the game
 * is open -- written over rather than rebuilt -- so this list never changes
 * either, and flattening it again every tick was 142 references copied twice
 * a tick for nothing.
 */
const everyVehicle: readonly Vehicle[] = layout.trains.flatMap((train) => train.vehicles);

/**
 * Where every vehicle was before the trains were moved.
 *
 * A copy, not a list of the vehicles themselves. They are the same objects
 * from one tick to the next now -- written over rather than rebuilt -- so
 * holding references and comparing them afterwards compares each vehicle with
 * itself, and everything riding on a train quietly stops being carried. That
 * was a real bug: the pigeon standing on the middle wagon watched the train
 * leave without it.
 */
const wasAt = everyVehicle.map((vehicle) => ({ x: vehicle.x, z: vehicle.z, yaw: vehicle.yaw }));

/** Take that copy. Called at the top of a tick, before anything has moved. */
function rememberWhereTrainsWere() {
  for (let i = 0; i < wasAt.length; i += 1) {
    const vehicle = everyVehicle[i]!;
    const kept = wasAt[i]!;
    kept.x = vehicle.x;
    kept.z = vehicle.z;
    kept.yaw = vehicle.yaw;
  }
}

function moveTrains(dt: number) {
  clock += dt;
  const fields: Collider[] = [world.collider];
  rememberWhereTrainsWere();
  let tagged = 0;
  near.fill(false);

  layout.trains.forEach((train, index) => {
    previousAlong[index] = train.along;
    // Where it is. Every train, every tick, whether or not anyone is looking:
    // a train is part of the world rather than a prop, and one that stopped
    // while your back was turned would be in the wrong place when you came
    // back. It is also the cheap half -- a step along a line and a reflection
    // at the ends -- so there is nothing to gain by skipping it.
    const run = shuttle(
      lineLength(train.line.points),
      consistLength(train.cars, train.stock),
      train.along,
      train.direction,
      train.speed * dt,
    );
    train.along = run.along;
    train.direction = run.direction;

    // The tags are handed out for every train in turn whatever happens next,
    // so that skipping one does not renumber the rest -- a resident's idea of
    // which wagon it is standing on is one of these numbers.
    const base = tagged;
    tagged += train.cars + 1;

    // And what it looks like, which is only worth working out near the bird.
    // Laying a rake out in world coordinates and boxing it for collision is
    // 96% of the whole simulation, and six of the seven trains are usually
    // kilometres away.
    if (!rakeNear(train, bird.position.x, bird.position.z, TRAIN_REACH)) {
      // Still put back where it has got to, often enough that a distant train
      // moves rather than lurches. What is skipped out here is the expensive
      // half -- the collision boxes and the field built over them -- not the
      // layout, which is cheap.
      if (clock - laidOut[index]! >= DISTANT_REDRAW) {
        moveTrain(train.vehicles, train.line, train.along, train.cars, train.stock);
        laidOut[index] = clock;
      }
      return;
    }

    moveTrain(train.vehicles, train.line, train.along, train.cars, train.stock);
    laidOut[index] = clock;
    near[index] = true;
    // Every box knows how fast the rake is running, which is what makes
    // being touched by one fatal rather than merely blocking.
    const boxes = trainBoxSets[index]!;
    moveTrainBoxes(boxes, train.vehicles, base, train.speed);
    fields.push(createColliderField(boxes));
  });

  // Anything standing on a wagon goes where the wagon goes.
  carryPassengers(
    [
      bird,
      ...flock.members.map((member) => member.state),
      ...residents.map((resident) => resident.state),
    ],
    wasAt,
    everyVehicle,
  );

  const air = wind.at(bird.position, clock);
  for (const plume of smokes) {
    const engine = layout.trains[plume.index]?.vehicles[0];
    if (!engine) continue;

    const stack = stackTop();
    const at = onVehicle(engine, stack.along, stack.across);
    plume.puffs.update(dt, { x: at.x, y: stack.height, z: at.z }, air);
  }

  return combineColliders(...fields);
}

let solid = moveTrains(0);
let accumulator = 0;
let lastTime = performance.now() / 1000;
let smoothedFps = 60;

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
  talkingTo =
    residents.find((resident) => stillThere(resident) && meeting(bird, resident.state)) ?? null;

  const here = LEVELS[level];
  // Meeting them finishes the level and nothing else. What happens next is
  // the player's move, not the game's: they are standing with somebody, and
  // the somebody says hello.
  const said = here ? dialogueOf(here) : undefined;
  if (said && talkingTo?.completes === here!.name && !finished) {
    finished = true;
    talk = begin(said);
  }
}

/**
 * Leave a finished conversation, which is what starts the next level.
 *
 * The take-off key, because flying on *is* what you do -- but taken here
 * rather than left to the flight model, so that leaving is a transition to
 * somewhere else rather than a launch from where you are. On the last level
 * there is nowhere to go, so it stays an ordinary take-off.
 */
/**
 * The line across the top of the screen, when there is one.
 *
 * Finishing outranks everything: it is the one moment the player is waiting
 * to be told about, and it says what the key in their hand will do next.
 */
function banner(): string | null {
  // Nothing while there is still something to say. The conversation has the
  // screen and its own line about which key does what; two of them
  // contradicting each other is worse than one.
  if (talk && talkingTo && !isOver(talk)) return null;

  const here = LEVELS[level]?.name;
  if (finished && talkingTo) {
    // Two ways on, and they ask for different things. Handed a level where
    // you stand, the key is a take-off and the flying is yours to do; handed
    // one the ordinary way, the key is the journey.
    const handed = opened();
    if (handed >= 0) return `${here} complete — SPACE to take off for ${LEVELS[handed]!.name}`;
    const next = LEVELS[level + 1]?.name;
    return next ? `${here} complete — SPACE to fly on to ${next}` : `${here} complete`;
  }
  // Nothing at all while the game is flying: an audience is not being told
  // which key to press.
  if (cutscene) return null;
  if (storyNote && clock - storyNote.at <= NOTE_SECONDS) return storyNote.text;
  if (started && clock - startedAt <= NOTE_SECONDS) return `now flying — ${started}`;
  return null;
}

/**
 * A line the story wants on screen, and when it was put there.
 *
 * Not an instruction and not a level's name: the one place the game says
 * something that is only the story. It sits where "now flying -- X" sits,
 * because that is the line above the bird and this is the same sort of thing.
 */
let storyNote: { text: string; at: number } | null = null;

/** Whether the conversation still wants something said before you go. */
const midSentence = (): boolean => talkingTo !== null && talk !== null && !isOver(talk);

function flyOn(): boolean {
  if (!finished || !talkingTo || midSentence()) return false;

  // A conversation that named a level hands it over where you stand: the
  // level changes, the bird does not move, and the key is not spent -- it
  // goes on to the flight model as the ordinary take-off it looks like. That
  // is the whole of it. There is no in-between state and nothing new for the
  // rest of the game to know about: by the time the wings open, this is
  // simply the next level, being flown from wherever the last one ended.
  const handed = opened();
  if (handed >= 0) {
    playLevel(handed, 'in place');
    return false;
  }

  if (level + 1 >= LEVELS.length) return false;
  playLevel(level + 1);
  return true;
}

/** The level the conversation on screen has handed over, or -1. */
function opened(): number {
  const name = talk?.opens;
  return name === undefined ? -1 : LEVELS.findIndex((spec) => spec.name === name);
}

/**
 * What to do now, in a situation the game has put the bird in.
 *
 * The second of the three kinds of instruction -- see `render/tips.ts` -- and
 * the one that outranks the others: a situation the game has arranged is more
 * definite than a risk it has noticed. Standing with somebody and out of
 * things to say, the next thing is to go; standing on a roof, the next thing
 * is that the controls are different now.
 */
/** The last thing said about the voice itself, and when. */
let voiceNote: { text: string; at: number } | null = null;
/** How long that stays up, in seconds. */
const NOTICE = 2;

function command(): Tip | null {
  // A setting confirming itself outranks everything for a moment, because
  // the player has just pressed a key and is owed an answer about it.
  if (voiceNote && clock - voiceNote.at < NOTICE)
    // Spoken, so that turning it on is answered in the voice being turned on.
    return { keys: ['V'], text: voiceNote.text, spoken: true };

  if (finished && talkingTo && !midSentence())
    // Said aloud: without it the flight does not continue at all.
    return { keys: ['SPACE'], text: 'Take off!', spoken: true };

  // On foot, where the controls are a different set entirely and the player
  // has just arrived in them. These used to be the line above the bird, which
  // is the story's line.
  if (isPerched(bird)) {
    if (talkingTo) return null;
    if (onFoot.blocked) return { keys: ['←', '→'], text: 'Turn and walk round it' };
    if (onFoot.travelled > 0) return { keys: [], text: 'Mind the edge' };
    // On a level that is won by eating, walking about *is* the level, and the
    // thing to do on foot is not "walk, or take off" -- it is the lesson the
    // level has waiting for the moment the feet are down. A command outranks
    // a lesson and the corner holds one thing, so a standing prompt here
    // would be the game talking over its own instructions.
    if (LEVELS[level]?.finish.kind === 'fed') return null;
    return { keys: ['↑', 'SPACE'], text: 'Walk, or take off' };
  }
  return null;
}

/** The resident this level is about, if it has one. */
function levelPerson(): Resident | null {
  const here = LEVELS[level];
  const found = here ? residents.find((r) => r.completes === here.name) : undefined;
  return found && stillThere(found) ? found : null;
}



function frame(nowMs: number) {
  const now = nowMs / 1000;
  const frameTime = Math.min(now - lastTime, MAX_FRAME_TIME);
  lastTime = now;

  smoothedFps += (1 / Math.max(frameTime, 1e-4) - smoothedFps) * 0.1;

  input.update(frameTime);
  if (input.consumeMenu()) menu.toggle(level, mode);
  // A digit is a level while the menu is up and a thing to say while a
  // conversation is waiting on one. Offered to the menu first, because the
  // menu is the thing the player has just deliberately opened.
  for (let digit = input.consumeDigit(); digit !== null; digit = input.consumeDigit()) {
    const picked = menu.choose(digit);
    if (picked !== null) playLevel(picked);
    else if (talk && !isOver(talk)) talk = reply(talk, digit);
  }
  if (input.consumeReset()) respawn();
  // V for the voice. An undiscoverable key for now, which is the right amount
  // of discoverable for a thing whose whole purpose is to be turned off by
  // whoever is tired of it.
  if (input.consumeVoice()) {
    // Said through the panel rather than shown here and overwritten a line
    // later by whatever the flight has to say: the panel is told what to show
    // once a frame, so anything written straight to it lasts one frame.
    voiceNote = { text: voice.toggle() ? 'Voice on' : 'Voice off', at: clock };
  }
  // Leaving a finished conversation starts the next level rather than taking
  // off from this one, so the key is taken here before the flight model can
  // have it -- and while there is still something to say it is taken and
  // dropped, because flying off mid-sentence is not an answer either.
  if (cutscene) {
    // One key, and it is the one already in their hand: the take-off. Taken
    // as an edge rather than a held key, so cutting the scene short does not
    // also launch the bird off the branch it has just been placed on.
    if (input.consumeLaunch()) cutscene.play.cut();
  } else if (input.consumeLaunch() && !midSentence()) launchPending = !flyOn();

  // Alive rather than flying: a walking bird is not flying, and being run
  // over while on foot is still a death that has to raise the panel.
  const wasAlive = !hasCrashed(bird);

  // The world holds still while the camera is away. Nothing is simulated at
  // all: no ticks, so the trams stop where they are, the flock hangs in the
  // air and the bird stands in the grain until it is picked up and put on its
  // branch. It is five seconds, and a frozen city is a great deal easier to
  // believe than a pigeon flying itself across one.
  if (cutscene) {
    if (!cutscene.play.update(frameTime)) endScene();
  } else accumulator += frameTime;

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
    const wasDown = isPerched(bird);
    onFoot = walk(bird, walkControls, flightParams, TICK, solid);
    // Contagious fear. One bird leaving is the only warning the rest of them
    // get, and they go with it -- so a player who takes off in the middle of
    // the crowd scatters the crowd. By the wing rather than by walking off an
    // edge: stepping off a kerb is not an alarm, and the birds on the
    // concrete would not have noticed it.
    if (ambient && wasDown && walkControls.launch && !isPerched(bird)) {
      ambient.startle(bird.position.x, bird.position.z);
    }
    if (scatter) {
      scatter.update(TICK, clock);
      // A bird on its feet eats what is under its beak. Nothing to press:
      // walking onto grain is what eating grain looks like, and a key for it
      // would be a key for the one thing the player is already doing.
      if (isPerched(bird)) {
        const found = seedWithin(scatter.seeds, bird.position.x, bird.position.z, BEAK_REACH);
        if (found >= 0) {
          scatter.take(found);
          bird.health = Math.min(1, bird.health + SEED_VALUE);
        }
      }
    }
    telemetry = step(bird, input.controls, flightParams, TICK, solid, wind);
    flock.update(TICK, solid, wind);
    ambient?.update(TICK, solid, wind);
    if (bird.ending === null) run.update(bird, TICK);
    // Alive rather than airborne. A crossing is flown over and a belly is
    // filled standing on the concrete, so testing for flight here would have
    // been the food level never finishing at all: the bird is on its feet the
    // whole time it is eating.
    if (!hasCrashed(bird)) handOver();
    reachLevel();
    // Somebody you have walked up to looks at you.
    if (talkingTo) turnToFace(talkingTo.state, bird.position, flightParams, TICK);
    accumulator -= TICK;
  }
  if (ticked) launchPending = false;

  // Only a crash ends the run. A clean landing leaves the bird perched, which
  // is a place to watch it from rather than a screen to dismiss.
  if (wasAlive && hasCrashed(bird)) outcome.show(bird.ending!);

  // Blend between the last two ticks so motion is smooth at any refresh rate.
  const alpha = accumulator / TICK;
  interpolatedState.position = lerpVec(previousPosition, bird.position, alpha);
  interpolatedState.orientation = slerpQuat(previousOrientation, bird.orientation, alpha);
  interpolatedState.velocity = bird.velocity;
  interpolatedState.flapPhase = bird.flapPhase;
  interpolatedState.stamina = bird.stamina;
  // And the belly. It was missing, and the bar in the corner spent the whole
  // game showing whatever the bird had when this object was first made -- a
  // copy taken once at startup and then never told anything again, disagreeing
  // with the bar over the bird's own head, which reads the bird.
  interpolatedState.health = bird.health;
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
  // Interpolated between the last two ticks, exactly as the bird is: a train
  // covers five centimetres a tick, small enough to be invisible and big
  // enough to shimmer if you take it in steps. Only for the ones near enough
  // for that to show -- a distant rake keeps whatever pose it was last laid
  // out in, which is a second old at worst and a fraction of a pixel wrong.
  for (const [index, train] of layout.trains.entries()) {
    if (!near[index]) continue;
    moveTrain(
      drawnVehicles[index]!,
      train.line,
      tweenAlong(previousAlong[index]!, train.along, alpha),
      train.cars,
      train.stock,
    );
  }
  world.updateTrains(
    layout.trains.map((train, index) =>
      near[index] ? { ...train, vehicles: drawnVehicles[index]! } : train,
    ),
  );
  talkPanel.show(
    talkingTo ? talk : null,
    talkingTo ? { them: talkingTo.voice, you: hero } : undefined,
  );
  // The tutor is asked every frame whether or not anything is showing, so its
  // own clock runs; a state tip takes the corner while it has something to
  // say, because what to do now outranks what to learn.
  // What the flight is in the middle of outranks what it might learn next,
  // and what to do right now outranks both.
  const aim = activeMarker();
  const toGo = aim
    ? Math.hypot(bird.position.x - aim.position.x, bird.position.z - aim.position.z)
    : Infinity;
  // Talking the approach down, which is a command rather than a caution: the
  // level has put a target in front of you and you are near it. The two
  // verdicts come off the landing rule itself, so the panel and the ground
  // cannot disagree about what "too fast" means.
  const settling =
    bird.ending === null && toGo <= 150 ? landingReadiness(bird, flightParams) : null;

  const urgent =
    command() ??
    (settling
      ? approachFor({
          toGo,
          altitude: telemetry.altitude,
          fast: !settling.speedOk,
          sinking: !settling.sinkOk,
        })
      : null) ??
    (bird.ending === null
      ? cautionFor(tutorial, {
          altitude: telemetry.altitude,
          airspeed: telemetry.airspeed,
          climb: telemetry.climbRate,
          stamina: bird.stamina,
          stalled: telemetry.stalled,
          // Two thirds of the way to the stall: enough of an angle that the
          // wing is working hard and more of it would buy nothing.
          noseUp: telemetry.angleOfAttack > flightParams.stallAngle * 0.65,
        })
      : null);

  // The tutor is only asked while the corner is free. Asked anyway, it would
  // hand out lessons into a panel that is showing something else -- given,
  // never seen, and never given again -- which is the whole failure mode of a
  // queue that does not know whether anyone is listening. A level flown
  // entirely below the "pull up" mark would have taught nothing.
  // Some lessons count from the take-off and some from the arrival, and the
  // arrival is the harder half.
  const saying = cutscene
    ? null
    : (urgent ??
      tutor.update(
        { flown: run.stats.distance, toGo, landed: isPerched(bird) },
        frameTime,
        input.anyDown,
      ));
  tipPanel.show(saying);
  // Only the critical ones are said aloud. A voice that reads every
  // instruction is a voice that gets turned off, and then it is not there for
  // the one that mattered.
  voice.update(saying?.spoken ? saying : null, clock);
  world.updateSmoke(allPuffs, camera.quaternion);
  if (scatter) world.updateSeeds(scatter.seeds);

  // A bar over every bird on its feet nearby: the hero while he is walking,
  // and whoever he has walked up to. Standing still is when the belly is
  // worth looking at -- flying, the one in the corner is the one that matters.
  const standing: Vital[] = [];
  if (isPerched(bird)) {
    standing.push({
      at: new THREE.Vector3(bird.position.x, bird.position.y + 0.32, bird.position.z),
      health: bird.health,
    });
  }
  for (const resident of residents) {
    if (!resident.rig.object.visible) continue;
    const away = distance(interpolatedState.position, resident.state.position);
    if (away > VITALS_REACH) continue;
    standing.push({
      at: new THREE.Vector3(
        resident.state.position.x,
        resident.state.position.y + 0.32,
        resident.state.position.z,
      ),
      health: resident.state.health,
    });
  }
  vitals.show(standing, camera, canvas);
  rig.update(interpolatedState, wings, frameTime);

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

  const marker = activeMarker();
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

  // One judgement a bird, made on its middle: a pigeon that cannot be seen is
  // not posed at all. Wings, tail, legs and head are forty small meshes, and
  // most of the fifteen birds in the world are behind the camera, too far to
  // read, or standing on the target of a level nobody is playing.
  camera.getWorldDirection(sightForward);
  sight.eye = camera.position;
  sight.forward = sightForward;

  // The flock is far enough away that the raw tick pose is smooth enough.
  flock.members.forEach((member, i) => {
    // A bird waiting its turn to be let out is not in the air, and should not
    // be standing on the wagon either.
    const shown = member.down <= 0 && sighted(member.state.position, sight);
    flockRigs[i]!.object.visible = shown;
    if (!shown) return;
    flockRigs[i]!.update(
      member.state,
      isPerched(member.state) ? 'perched' : 'gliding',
      frameTime,
    );
  });

  (ambient?.birds ?? []).forEach((pigeon, i) => {
    const rig = ambientRigs[i];
    if (!rig) return;
    const shown = sighted(pigeon.state.position, sight);
    rig.object.visible = shown;
    if (!shown) return;
    rig.update(pigeon.state, isPerched(pigeon.state) ? 'perched' : 'gliding', frameTime);
  });

  for (const resident of residents) {
    const shown = stillThere(resident) && sighted(resident.state.position, sight);
    resident.rig.object.visible = shown;
    if (!shown) continue;
    resident.rig.update(resident.state, 'perched', frameTime);
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
        ? perchedCamera(onFoot.travelled > 0)
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
  if (cutscene) {
    // Driven by hand, and the only time anything but the chase camera moves
    // it. Levelled, because the boom banks with the bird and a scene inherits
    // whatever roll it was left in mid-turn -- which reads as the whole city
    // being tilted rather than as the camera being tilted.
    const { eye, look } = cutscene.play.framing;
    camera.position.set(eye.x, eye.y, eye.z);
    camera.up.set(0, 1, 0);
    camera.lookAt(look.x, look.y, look.z);
  } else if (cutTo) {
    chase.snap(bird, activeCamera);
    cutTo = false;
  } else if (talkingTo) {
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


  hud.update(
    interpolatedState,
    telemetry,
    distance(interpolatedState.position, home),
    smoothedFps,
    banner(),
    unproject(interpolatedState.position, map.centre),
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
