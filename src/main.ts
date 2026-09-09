// Named apart from this file's own `crowdOn`, which is about pigeons.
import { crowdOn as fillPlatform } from './world/waiting';
import {
  PHRASES,
  languageNow,
  otherLanguage,
  read,
  rememberLanguage,
  say,
  setLanguage,
  startLanguage,
} from './i18n';
import * as THREE from 'three';
/**
 * Entry point: fixed-timestep simulation, interpolated rendering, live tuning.
 */


import {
  createBird,
  defaultParams,
  caught,
  fall,
  hasCrashed,
  heading,
  landingReadiness,
  isPerched,
  neutralControls,
  step,
  type BirdState,
  type FlightTelemetry,
} from './sim/flight';
import {
  quat,
  quatFromAxisAngle,
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
  CROW_MORPH,
  CROW_SCALE,
  HERO_MORPH,
  PIGEON_MORPHS,
  PINK_MORPH,
  type WingPose,
} from './render/bird';
import { createFlock, defaultFlockOptions, FLOCK_AHEAD, type Anchor } from './flock';
import { createAmbient } from './ambient';
import { createDog } from './dog';
import { createWaymarks, type Placed, type Waymarks } from './waypoints';
import { createWaymark } from './render/waymark';
import { createDogRig } from './render/dog';
import { escortDrawn } from './render/escort';
import { cageSolid, createCage } from './render/cage';
import { beginRescue } from './rescue';
import { createFlyover, type Flyover, type Framing } from './cutscene';
import {
  bellyOnEntry,
  CHARACTERS,
  crossed,
  crowsOn,
  hersOnMap,
  lineThrough,
  dialogueOf,
  cagedIn,
  LEVELS,
  hersHidden,
  meetsSomewhereFixed,
  metBy,
  PINK,
  sceneNamed,
  standingOf,
  targetName,
  waitingIn,
  type Character,
  type Level,
  type LevelTarget,
  type Line,
  type Opens,
  type Scene,
  type Standing,
} from './levels';
import { HOME_TREE, JANI_SQUARE, LANDMARKS, LOFT, PARK_PATCH, WEST_PATCH } from './landmarks';
import { alone, begin, isOver, opensFrom, reply, type Exchange } from './dialogue';
import { createDialoguePanel, speechColour } from './render/dialogue';
import { browserSpeaker, createVoice } from './render/voice';
import { browserTone, createAlarm } from './render/alarm';
import { browserKit, createAmbience, type Source } from './render/ambience';
import { browserChime, createCue } from './render/cue';
import { createVitals, type Vital } from './render/vitals';
import { MESSAGES, NOTICE, type Moment } from './render/messages';
import { createGauge } from './render/gauge';
import { ARRIVED_WITHIN, endingFor, type Ending } from './finish';
import { headingError } from './sim/autopilot';
import { codesOf, createTipPanel, createTipStack } from './render/tips';
import { loadProgress, saveProgress } from './progress';
import { DEFAULT_MODE, MODES, otherMode, paramsFor, windFor, type Mode } from './sim/modes';
import { createLevelMenu } from './render/menu';
import {
  aabb,
  combineColliders,
  createColliderField,
  turnedBox,
  type Collider,
} from './sim/collision';
import { createChaseCamera, defaultCameraParams, defaultWatchParams } from './render/camera';
import { createHud } from './render/hud';
import { createMinimap, REACH as MINIMAP_REACH } from './render/minimap';
import { defaultSight, sighted } from './render/sighted';
import { sunVector } from './render/sun';
import { createOutcomePanel } from './render/outcome';
import { buildWorld, targetFlash } from './world/city';
import { peopleOn, PERSON_HEIGHT, pointOn } from './world/layout';
import { createScatter, seedWithin, SEED_SIZE } from './world/seeds';
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
  advance,
  blockedBy,
  noseAhead,
  vehicleCount,
  stackTop,
  comeOnAt,
  legAfter,
  roomToComeOn,
  stockIsHauled,
  stockTop,
  pointAlong,
  tweenAlong,
  type Vehicle,
} from './world/train';
import { createSmoke, defaultSmokeOptions, type Puff, type Smoke } from './world/smoke';
import {
  asFlight,
  asStance,
  meeting,
  standStill,
  stanceOf,
  faceTurn,
  turnToFace,
  walk,
  type WalkControls,
  type WalkTelemetry,
} from './sim/walk';
import { bearing, distance, project, unproject } from './world/geo';
import type { MapData, Rail } from './world/streets';
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
    // No trams here. There were three, placed by hand at two coordinates on
    // the tramway west of the city -- one beside the fourth level's patch of
    // concrete, two where the line is double track -- back when a tram only
    // existed if it was asked for by name. The network fills itself now, and
    // it puts a tram on that stretch along with every other stretch, running
    // the correct way and at a headway, which is all those three were for.
    //
    // Nothing names them. `train: 0` in a level is the rake of stake wagons
    // at the top of this list, and that is the only place in the game where
    // a train is picked out by its position here.
  ],
  // And then the rest of the network, which nothing in the game names or
  // cares about. A city with a hundred and thirty kilometres of tramway and
  // three trams on it reads as a model of a city; these are what make it a
  // working one. They go wherever there is a line long enough, and nobody
  // decides where.
  //
  // The headway is the dial on how alive the city looks, and the only thing
  // in here that costs anything: ninety seconds over the hundred and eighteen
  // kilometres of tram route on this map comes to about a hundred and sixteen
  // trams, where a hundred and twenty seconds would be eighty-three. Stepping
  // them is nothing -- 250 trams is 3 us of a tick that has 8300 -- and
  // laying them out is 75 us at thirty times a second. What it really buys is
  // paid in draw calls, four to a tram, for the handful in shot at any moment.
  fill: [
    { stock: 'tram', cars: 4, speed: 10, minRoute: 320, most: 30, headway: 90 },
    // One to a route: a carriage train shuttles, so a second on the same
    // rails would be met head-on. The headway is here because the shape
    // requires it and is not read.
    { stock: 'carriage', cars: 5, speed: 14, minRoute: 1200, most: 8, headway: 0 },
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
 * The line a level ends at, worked out from the level alone.
 *
 * One calculation, used by the rule and by the paint. Two would be one too
 * many: the stripe on the ground and the thing that notices you crossing it
 * have to be the same line, or the paint is a lie.
 */
function finishingLine(spec: Level): Line | null {
  if (spec.finish.kind !== 'crossing') return null;
  const through = spec.finish.through;
  return lineThrough(
    project(spec.start[0], spec.start[1], map.centre),
    project(through[0], through[1], map.centre),
  );
}

/**
 * The whole route of a level, as marks in the order they are passed.
 *
 * The waypoints, and then the line that finishes it -- which used to be a
 * thing apart, painted for the whole level while the marks came and went one
 * at a time. That meant two of them on screen at once and no telling which
 * was which: the same blue stripe, one of them the next step and the other
 * the end of the flight, six hundred metres apart.
 *
 * As the last mark it simply takes its turn. Passing the one before it brings
 * it up, exactly as passing the first brings up the second, and there is
 * never more than one on the ground or on the map.
 *
 * It does not become the *rule*, and that is on purpose: crossing the line
 * ends the level whether or not the marks before it were passed, because a
 * bird that wandered off the route and came back over the line has finished.
 * See `handoverFor`.
 */
function markedRoute(spec: Level): Placed[] {
  // A line is worked out from the release point, exactly as a level's
  // finishing line is, so the stripe painted on the ground and the rule that
  // notices you crossing it are the same line.
  const from = project(spec.start[0], spec.start[1], map.centre);
  const marks = (spec.waypoints ?? []).map((mark) => {
    const point = project(mark.at[0], mark.at[1], map.centre);
    return mark.kind === 'line' ? { ...point, across: lineThrough(from, point) } : point;
  });
  const ending = finishingLine(spec);
  return ending ? [...marks, { x: ending.x, z: ending.z, across: ending }] : marks;
}

/**
 * Every line to paint: the one that finishes a level, and the ones along it.
 *
 * The same stripe for both, because they are the same thing asked at two
 * points -- square across the way in from the release point, so any path to
 * the far side crosses it. What differs is only when each is shown: see
 * `World.gates`.
 */
const gates = LEVELS.flatMap((spec) => {
  // The band is modelled along its own x, so it is turned to lie along the
  // route: the same convention everything else on this map is turned in.
  const paint = (line: Line, mark: number) => ({
    name: spec.name,
    mark,
    x: line.x,
    z: line.z,
    yaw: Math.atan2(-line.uz, line.ux),
    span: GATE_SPAN,
  });

  const from = project(spec.start[0], spec.start[1], map.centre);
  const along = (spec.waypoints ?? []).flatMap((mark, index) =>
    mark.kind === 'line'
      ? [paint(lineThrough(from, project(mark.at[0], mark.at[1], map.centre)), index)]
      : [],
  );
  // And the one that ends the level, as the mark after the last of them --
  // see `markedRoute`.
  const ending = finishingLine(spec);
  return ending ? [...along, paint(ending, (spec.waypoints ?? []).length)] : along;
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

/**
 * The freight train: the rake of stake wagons, first in the list.
 *
 * Named once here rather than written as 0 in five places. A level picks it
 * out by that index, and so now do the grain and the birds standing in it.
 */
const FREIGHT = 0;

/**
 * A patch of grain on the deck of every wagon of the freight train.
 *
 * Decoration, and deliberately nothing else: it is drawn by the same
 * instanced mesh the thrown scatter uses, and grain has no collision of any
 * kind, so the bird walks and lands straight through it. Only `scatter.seeds`
 * is ever offered to `seedWithin`, so none of this can be eaten either -- it
 * is the reason there are birds all over this train, not a meal.
 *
 * Placed in the wagon's own frame and turned into world coordinates every
 * frame, because the train is somewhere else every tick.
 */
const WAGON_GRAIN = (() => {
  const rake = layout.trains[FREIGHT];
  if (!rake) return [];
  let seed = 0x51ed270b;
  const random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const on: { car: number; along: number; across: number }[] = [];
  rake.vehicles.forEach((vehicle, car) => {
    // The deck only. A locomotive has a hood rather than a floor, and grain
    // heaped on the bonnet of a running diesel is a different picture.
    if (vehicle.kind !== 'wagon') return;
    for (let i = 0; i < 14; i += 1) {
      on.push({
        car,
        // Inside the stakes, which stand along both sides: grain against the
        // uprights reads as spillage rather than as a load.
        along: (random() - 0.5) * (vehicle.length - 1.6),
        across: (random() - 0.5) * (vehicle.width - 1),
      });
    }
  });
  return on;
})();

/**
 * The birds standing on the freight train.
 *
 * Thirty of them, and they are the reason the grain is there: a rake of
 * wagons with a patch of grain on every deck is somewhere pigeons would be,
 * and thirty pigeons on it is the flock the story is about to ask for help.
 *
 * They stand rather than walk, and that is a decision rather than a
 * limitation. A walking bird is steered by `wander`, which knows about ground
 * and not about decks -- a wagon is fourteen metres long, two metres nine
 * wide and somewhere else every tick, so a wanderer would need an edge test
 * in a moving frame and would still eventually put a foot over the side.
 * Standing on a spot on a wagon is exact: the spot is in the wagon's own
 * frame, so it rides perfectly however the train moves and whatever it does
 * at the end of the line.
 *
 * What keeps them from reading as ornaments is the turning: each one shifts
 * its heading slowly and independently, which is what a bird standing about
 * actually does with its time.
 */
const RIDERS = 30;
const riders = (() => {
  const rake = layout.trains[FREIGHT];
  if (!rake) return [];
  const decks = rake.vehicles
    .map((vehicle, car) => ({ vehicle, car }))
    .filter((each) => each.vehicle.kind === 'wagon');
  if (decks.length === 0) return [];

  let seed = 0x2f6ea1c3;
  const random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return Array.from({ length: RIDERS }, (_, i) => {
    // Dealt round the wagons rather than scattered at random over them, so
    // every deck has some: thirty random draws over twelve wagons leaves one
    // or two of them empty, and an empty wagon in the middle of a rake reads
    // as the one you are meant to land on.
    const deck = decks[i % decks.length]!;
    return {
      car: deck.car,
      along: (random() - 0.5) * (deck.vehicle.length - 2),
      across: (random() - 0.5) * (deck.vehicle.width - 1.2),
      /** Which way it is looking, in the wagon's own frame. */
      facing: random() * Math.PI * 2,
      /** And how fast it is drifting round, in radians a second. */
      turning: (random() - 0.5) * 0.5,
      morph: Math.floor(random() * PIGEON_MORPHS.length),
    };
  });
})();

const world = buildWorld(layout, {
  // The thrown scatter and the grain riding on the freight train, in one
  // mesh: they are the same object drawn in two places.
  seeds: SEEDS_AT_ONCE + WAGON_GRAIN.length,
  gates,
  // The described things need no list here: they arrive on the layout already
  // named, having been put there on purpose. Only the wagons do, because
  // which wagon is a level is a decision about the game rather than a fact
  // about the train.
  //
  // Picked out and narrowed in one pass rather than filtered and then cast: a
  // cast over a field that may not be there is a promise the compiler cannot
  // check, and `target` may not be there since the ever after is aimed at
  // nothing.
  objectives: LEVELS.flatMap((spec) => {
    const on = spec.target;
    if (on?.kind !== 'wagon') return [];
    return [{ name: on.name, train: on.train, vehicle: carOf(on) }];
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

/**
 * Which language the game is in, before anything is built.
 *
 * First, because the HUD writes its labels the moment it is made and the menu
 * builds its list from whatever is current: starting in English and swapping
 * a frame later would be a visible flicker on every load for half the people
 * this game is about.
 */
startLanguage(storage() ?? null);

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
const objective = (name: string | null) =>
  name === null ? null : (world.markers.find((marker) => marker.name === name) ?? null);
/** The marker for whatever the level being played is about. */
/**
 * The thing being pointed at, or null when nothing is.
 *
 * Null on a level that ends at a line: nothing is being pointed at, so the
 * arrow is down, the target does not flash, and the approach instructions --
 * which count down the distance to what you are landing on -- stay quiet.
 * There is nothing to land on; there is a stripe to cross.
 */
const activeMarker = () => {
  const here = LEVELS[level];
  if (!here || here.finish.kind === 'crossing') return null;
  return objective(targetName(here));
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
/**
 * The map in the corner, turned so forward is up.
 *
 * Given the streets once: they never change, and bucketing seven and a half
 * thousand segments every frame would be the whole point of a minimap thrown
 * away on drawing it.
 */
const minimap = createMinimap(overlay, layout.roads ?? [], layout.stops ?? []);
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
 * Where the hero stands to talk to whoever is waiting on a level, if anybody.
 *
 * Opposite them: her offset from the middle of the thing, mirrored. The
 * middle would be simpler and is wrong -- on a platform not much wider than
 * the two of them it puts him on top of her. Mirrored, they face each other
 * across it.
 *
 * Pulled out because two things want it now. A level that *begins* perched
 * uses it to stand him there, and a level that was walked into from one of
 * those uses it to work out where it began -- see `releaseFor`.
 */
function opposite(spec: Level): { at: Vec3; facing: Vec3 } | null {
  const waiting = waitingIn(spec);
  const stood = waiting ? standingSpot(waiting) : null;
  const marker = objective(targetName(spec));
  if (!waiting || !stood || !marker) return null;

  const described = LANDMARKS.find((l) => l.name === spec.target?.name);
  const across = pointOn(
    { x: marker.position.x, z: marker.position.z, yaw: described?.yaw ?? 0 },
    -waiting.along,
    -waiting.across,
  );
  return { at: vec(across.x, stood.at.y, across.z), facing: stood.at };
}

/**
 * The level whose conversation opens this one, if one does.
 *
 * Read off the conversations rather than declared on the levels, because it
 * is the conversation that hands over: a reply says which level it opens, and
 * this is that fact looked at from the other end.
 */
function handedFrom(name: string): Level | undefined {
  return LEVELS.find((spec) => {
    const said = dialogueOf(spec);
    return said !== undefined && opensFrom(said).includes(name);
  });
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
  // The level's own coordinate, and it has to be *this* level's rather than
  // whichever one is being played: a scene asks where the level it closes on
  // begins, and it asks while the level before it is still the current one.
  //
  // This used to read a `releaseAt` that only `playLevel` wrote, which meant
  // a scene aimed its camera at the start of the level the player was leaving
  // rather than the one they were arriving at. Off Mátyás tér that is four
  // hundred and seventy metres: the camera climbed away to a place nothing
  // was happening and then cut back when the next level put the bird down
  // where it actually belonged.
  //
  // The variable existed for the level that used to start at a random one of
  // the others. That level has a fixed place now and the variable outlived
  // its reason by one commit.
  const point = project(spec.start[0], spec.start[1], map.centre);
  const floor = world.collider.heightAt(point.x, point.z);
  const marker = objective(targetName(spec));
  // Pointed at the first mark if the level has any, and at what it is aimed
  // at otherwise. The marks are the route: a level that lays one out and then
  // faces the bird somewhere else is a level arguing with its own directions
  // on the first frame -- and on a level that ends at a line there is nothing
  // else to face, since nothing is being pointed at.
  const first = spec.waypoints?.[0];
  const aim = spec.facing
    ? project(spec.facing[0], spec.facing[1], map.centre)
    : first
      ? project(first.at[0], first.at[1], map.centre)
      : marker
        ? { x: marker.position.x, z: marker.position.z }
        : home;

  // A perched level does not release the bird at all: it stands him where the
  // conversation happens, opposite whoever is waiting there.
  const own = spec.begins === 'perched' ? opposite(spec) : null;
  if (own) return { at: own.at, heading: bearing(own.at, own.facing), perched: true };

  // Neither does one that was walked into from the level before it.
  //
  // Every level after the first begins where the last one ended, and for five
  // of them that ending is a conversation held standing on something: the
  // branch, a roof, the deck of a wagon. Played through, the bird does not
  // move at all -- the level changes under his feet and he takes off. Started
  // cold, from the menu or after flying into a chimney, he used to be dropped
  // into the air at whatever coordinate the level had been given, and the
  // second level's was a hand-picked one twenty metres past the tree and five
  // above it, written to look like leaving a branch without being it.
  //
  // So the mechanism does it instead, for all five: the level begins standing
  // where the conversation that opened it was held. Nothing is special-cased,
  // and nothing has to be kept in step with a landmark that moves.
  //
  // Only where that conversation happens somewhere that stays put. One of
  // the five is held on the deck of a moving goods wagon, and a wagon is not
  // a place: see `meetsSomewhereFixed`.
  const before = handedFrom(spec.name);
  const walked = before && meetsSomewhereFixed(before) ? opposite(before) : null;
  if (walked) return { at: walked.at, heading: bearing(walked.at, aim), perched: true };

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
/** The bird as anything flying around it needs to see it. */
const leaderOf = (of: BirdState): Anchor => ({
  x: of.position.x,
  y: of.position.y,
  z: of.position.z,
  heading: heading(of),
  speed: Math.hypot(of.velocity.x, of.velocity.y, of.velocity.z),
  climb: of.velocity.y,
});


/**
 * Built at the largest flock any level asks for.
 *
 * A bird is a rig in the scene, so they are made once and let out in the
 * number the level wants -- see `Flock.only`.
 */
const FLOCK_MOST = Math.max(...LEVELS.map((spec) => spec.flock ?? 0), PIGEON_MORPHS.length);
const flock = createFlock(PIGEON_MORPHS.length, () => leaderOf(bird), {
  ...defaultFlockOptions,
  count: FLOCK_MOST,
  // The anchor is the bird itself. Where the flock *wheels* is thirty metres
  // in front of him and that is the flock's own business -- handed a
  // pre-shifted anchor it also moved the loft they are let out of, which is
  // behind him precisely so that nobody watches a pigeon appear out of
  // nothing.
  ahead: FLOCK_AHEAD,
});
const flockRigs = flock.members.map((member) => {
  const rig = createBirdRig(PIGEON_MORPHS[member.morph]);
  scene.add(rig.object);
  return rig;
});
/**
 * And one more, in her colours, for the level where the flock is her.
 *
 * A second rig rather than a recoloured one: a rig takes its morph when it is
 * built, so the alternative is rebuilding thirty of them at every level
 * change to make one of them pink. There is only ever one bird flying beside
 * him on that level, so there only has to be one of these.
 */
const herRig = createBirdRig(PINK_MORPH);
scene.add(herRig.object);

/**
 * A crowd of ambient pigeons standing about on one of the described things.
 *
 * Ambient in the sense the module sets out: nothing they do changes the game.
 * They are not the birds a level is finished by walking up to, they do not
 * eat the grain, and no level's condition mentions them. They are there
 * because a place with nothing standing about in it is a diagram of a place.
 */
function crowdOn(landmark: string, count: number, spread = 0) {
  const on = layout.landmarks.find((l) => l.name === landmark);
  if (!on) return null;
  return createAmbient({
    count,
    ground: {
      x: on.x,
      z: on.z,
      yaw: on.yaw ?? 0,
      // Grown by `spread` on every side, so a crowd can stand *around* a
      // thing rather than on it. A slab that a level ends by landing on has
      // to stay landable: twenty pigeons scattered over nine metres square is
      // not a busy square, it is a closed one, and the player would be
      // touching down in the middle of them.
      width: on.width + spread * 2,
      depth: on.depth + spread * 2,
      // A flat thing has no top of its own, so it is the ground's.
      top: on.height > 0 ? on.height : defaultParams.groundHeight,
    },
    morphs: PIGEON_MORPHS.length,
    flight: flightParams,
  });
}

/**
 * Every crowd of ambient pigeons in the world, and where.
 *
 * Four on the concrete at Teleki tér, because of the person throwing grain:
 * somebody feeding pigeons with no pigeons in front of them is somebody
 * throwing food on the ground. Six on Jani Pali tér, because that is a square
 * with twenty people standing about on it and a dog trotting through, and a
 * city square with no pigeons on it is the one thing that would give it away.
 * And twenty on the slab out west, which has twenty people round it too.
 */
const crowds = [
  crowdOn(PARK_PATCH.name, 4),
  crowdOn(JANI_SQUARE.name, 6),
  // Twenty on the slab out west, spread nine metres past its edges so they
  // fill the ground the twenty people are standing on rather than the nine
  // metres of concrete in the middle of it. It is the busiest place in the
  // game and the last thing the hero flies to before the loft.
  crowdOn(WEST_PATCH.name, 20, 9),
].filter(
  (crowd): crowd is NonNullable<typeof crowd> => crowd !== null,
);

/**
 * The crows over Népszínház utca.
 *
 * Four of them, wheeling around a point in the air rather than around the
 * player -- which is the whole reason the flock's anchor stopped being "the
 * leader" and became a thing that may or may not move. They keep to a ball
 * sixty metres across over the route the level flies, so a bird coming
 * through at sixty metres goes through them and one that took the warning and
 * dropped does not.
 *
 * They do not attack yet. What they are is a reason to fly low.
 *
 * Where "here" is, is an assumption: the coordinate did not come with the
 * instruction, so they are put over the line the level ends at, which is the
 * middle of the stretch the warning is about.
 */
const CROWS = 8;
/**
 * How high they hang, in metres.
 *
 * Below the level's own release of sixty rather than above it, which is the
 * other way round from where this started. At seventy-five they were over the
 * top of everything and a pigeon flying the level never came within reach --
 * the sphere is round the crow, so a crow that keeps out of the way is a crow
 * that never engages. Forty-five puts them in the corridor the bird is
 * actually in on its way down, and "fly low" then means going *under* them:
 * below twenty metres nothing looks at you at all.
 */
const CROW_HEIGHT = 45;
/**
 * How near a crow has to get to have caught him, in metres.
 *
 * Bigger than the two birds are: a pigeon's body is a fifth of a metre across
 * and a crow's twice that, so touching in the strict sense is about two
 * thirds of a metre -- and at a closing speed of thirty metres a second the
 * gap between one tick and the next is a quarter of that. A metre and a
 * quarter is a wingspan of feathers rather than a hairline, which is what a
 * collision between two birds actually is, and it cannot be flown through in
 * the time between two looks.
 */
const CROW_TOUCH = 1.25;
const crowsAt = (() => {
  const spec = LEVELS.find((level) => level.name === 'Népszínház');
  const line = spec ? finishingLine(spec) : null;
  if (!spec || !line) return null;
  // Halfway along the route rather than on the line at the end of it. Sitting
  // over the finish they guarded the last hundred metres of a three hundred
  // metre flight and nothing else -- which is a danger you meet once, at the
  // moment the level is ending. Over the middle, with a wider ball, they are
  // between the player and the line for most of the way.
  const from = project(spec.start[0], spec.start[1], map.centre);
  return { x: (from.x + line.x) / 2, z: (from.z + line.z) / 2 };
})();

const crows = crowsAt
  ? createFlock(
      1,
      // Stationary: a place in the sky, not a bird to follow. Speed nought,
      // so the flock's lead-the-target arithmetic contributes nothing and
      // they simply mill about over it.
      () => ({ x: crowsAt.x, y: CROW_HEIGHT, z: crowsAt.z, heading: 0, speed: 0, climb: 0 }),
      {
        ...defaultFlockOptions,
        count: CROWS,
        // The range, which is now the caller's to say: sixty metres, which
        // over a three hundred metre route is most of it. Four birds in a
        // ball that size are a stretch of sky to get through rather than a
        // knot to fly round.
        radius: 60,
        // See below: this is about how they look, not about what they hit.
        // Above the ordinary rooflines, which come to twenty-four, so that
        // the ones milling look like birds over a city rather than birds in
        // it. They do not collide -- see the update -- but a crow drawn at
        // chimney height still reads wrong.
        minAltitude: 34,
        emitInterval: 0.4,
        // Somewhere else fifty metres off, which for a crow is being
        // somewhere else rather than coming back from anywhere.
        spawn: { kind: 'nearby', away: 50 },
        // And the reason they are here. Each of them watches a hundred metres
        // of sky for a pigeon flying higher than twenty, and once it has seen
        // one it goes for the bird itself and keeps going -- re-aimed every
        // tick, so it follows rather than arriving where you were.
        //
        // The twenty is the trigger and the twenty is the safety, and they
        // are two different rules that happen to share a number: above it a
        // chase starts, below it a crow will not follow. So going low does
        // not shake one off -- it keeps station over you and waits -- and
        // that is the shape of the level: fly under them, and stay there.
        hunt: {
          quarry: () => (hasCrashed(bird) ? null : leaderOf(bird)),
          // A hundred rather than fifty. Fifty is a sphere you can cross the
          // level without ever entering, which was the whole trouble: the
          // warning went off, nothing came, and the danger was a rumour.
          within: 100,
          above: 20,
          floor: 20,
          // Faster than the bird it is after -- a pigeon cruises at about
          // nineteen -- so climbing away from one is not a plan. And a turn
          // it can actually make: two and a half radians a second bends its
          // course round in its own length rather than in a street, which is
          // what a bird twisting after another bird looks like and what the
          // aerodynamics flatly refuse to do.
          speed: 23,
          turn: 2.5,
          // And a distance at which it has lost you. Without one, a bird that
          // saw you once follows for the rest of the game.
          loses: 250,
        },
      },
      flightParams,
    )
  : null;

const crowRigs = (crows?.members ?? []).map(() => {
  const rig = createBirdRig(CROW_MORPH);
  rig.object.scale.setScalar(CROW_SCALE);
  scene.add(rig.object);
  return rig;
});

/**
 * How many dogs are on Jani Pali tér.
 *
 * Four. One was scenery -- a square with twenty people standing about on it
 * is a square, and a square with a dog trotting through it is a place -- and
 * four is a park at the end of the afternoon. They never stop, so four of
 * them are four things moving in a square where everything else is standing
 * still, which is most of what makes a place look inhabited rather than
 * modelled.
 */
const DOGS = 4;
/**
 * Where each of them starts, as an offset from the middle of the square.
 *
 * Spread rather than stacked: created at one point they would set off from
 * the same spot on the same tick, and four dogs leaving one place together is
 * a pack rather than four dogs. Each also gets its own random source, seeded
 * off its index, so they wander independently -- sharing `Math.random` would
 * work too, but a dog whose path depends on how many other dogs were built
 * first is a dog that moves when something unrelated changes.
 */
const DOG_STARTS = [
  { x: 0, z: 0 },
  { x: 11, z: -6 },
  { x: -9, z: 7 },
  { x: 6, z: 9 },
];
const square = layout.landmarks.find((landmark) => landmark.name === JANI_SQUARE.name);
const dogs = square
  ? Array.from({ length: DOGS }, (_, i) => {
      const from = DOG_STARTS[i % DOG_STARTS.length]!;
      let seed = (0x9e3779b9 * (i + 1)) >>> 0;
      return createDog({
        home: { x: square.x + from.x, z: square.z + from.z },
        ground: defaultParams.groundHeight,
        random: () => {
          seed = (seed + 0x6d2b79f5) >>> 0;
          let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        },
      });
    })
  : [];
const dogRigs = dogs.map(() => {
  const rig = createDogRig();
  scene.add(rig.object);
  return rig;
});

/**
 * The waypoint that is showing, and the marks it is showing from.
 *
 * One column, moved. There is only ever one on screen, so building and
 * throwing away a mesh at each of them would be work for nothing.
 */
const waymark = createWaymark();
scene.add(waymark.object);
let waymarks: Waymarks = createWaymarks([]);

/**
 * A rig each for the birds riding the freight train, and a state to draw it
 * from. The state is written over every frame rather than simulated: they do
 * not fly, and where they are is entirely a fact about where their wagon is.
 */
/**
 * The trapper's cage, standing where she is.
 *
 * One of them, moved and hidden, because there is only ever one: she is in
 * the same place in every level she appears in, and building a cage per level
 * would be building the same cage eleven times.
 *
 * It exists from the moment she is off the home tree -- the story is that she
 * was taken while he was away, so by the time he can see her at all she is in
 * it. Which means the rule is simply "wherever she is standing", and there is
 * nothing extra to keep in step: move her and the cage goes with her.
 */
const cage = createCage();
scene.add(cage.object);
/**
 * The cage as something to fly into, or null while there is no cage.
 *
 * A single box round the whole thing rather than a box per bar. The bars are
 * two centimetres thick and the gaps ten, which is a shape no sweep against a
 * 22 cm bird can give a sensible answer for -- it would pass through the gaps
 * at some angles and not others, and a wall you can sometimes fly through is
 * worse than either. So it is solid to the collider and see-through to the
 * eye, which is the honest version of what a cage is for here.
 */
let cageBox: ReturnType<typeof turnedBox> | null = null;

/**
 * Whether the birds on the freight train have left it.
 *
 * They are the flock from the moment they agree to come, and a bird cannot be
 * in two places: drawn on the wagons as well, there would be thirty of them
 * standing in the grain and thirty more overhead.
 */
let ridersFlown = false;
/**
 * Whether the trapper has been taken apart with his cage.
 *
 * Kept because the level after the rescue is the level that exists because he
 * is gone, and he is drawn by a crowd that is laid out once: without this,
 * walking on into the ever after puts him back on the roof and undoes the
 * ending in its first frame.
 */
let trapperGone = false;

/**
 * The end of the story, once he is standing on the roof: see `rescue.ts`.
 *
 * Null until then and on every other level, and thrown away whenever a level
 * starts -- including a restart of this one, since the whole point of it is
 * that it happens when he arrives.
 */
let rescue: ReturnType<typeof beginRescue> | null = null;
/**
 * Where the cage is while one is running, so the hero can be turned to it.
 *
 * Kept beside the rescue rather than read off `cageBox` at the point of use,
 * because the box is taken away the moment the bars burst and what he should
 * go on looking at is the place they burst in.
 */
let rescueAt: Vec3 | null = null;

/**
 * When the mark being flown at last changed, on the world's own clock.
 *
 * So that reaching one can be said out loud. A waypoint coming up is an
 * event -- it happens, and then it is simply the thing in front of you -- and
 * an instruction about it has to be given on the event rather than for as
 * long as the mark is there.
 */
let markedAt = -Infinity;
/**
 * A rig each for them, built once and reused.
 *
 * Thirty, which is what the last level asks for. They are hidden until there
 * is a rescue and hidden again the moment any level starts, so they cost a
 * scene object each and nothing else for the twelve levels they are not in.
 */
const helperRigs = Array.from({ length: 30 }, () => {
  const rig = createBirdRig(PIGEON_MORPHS[0]);
  scene.add(rig.object);
  rig.object.visible = false;
  return rig;
});

const riderRigs = riders.map((rider) => {
  const rig = createBirdRig(PIGEON_MORPHS[rider.morph]);
  scene.add(rig.object);
  return { rig, state: createBird(vec(0, 0, 0), 0, 0) };
});

const crowdRigs = crowds.map((crowd) =>
  crowd.birds.map((pigeon) => {
    const rig = createBirdRig(PIGEON_MORPHS[pigeon.morph]);
    scene.add(rig.object);
    return rig;
  }),
);

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
  who: Character;
  state: BirdState;
  rig: ReturnType<typeof createBirdRig>;
  /** The colour its words are printed in: its own, made readable. */
  voice: string;
  /** How red it is being washed this frame, 0 to 1. */
  glowing: number;
  /**
   * Whether the level being flown has them in it.
   *
   * Somebody not in the cast is not anywhere: not drawn, not met, and not
   * given a health bar. It is the same bird either way -- the rig is built
   * once and kept -- so this is a character being off stage rather than a
   * character being destroyed and made again.
   */
  here: boolean;
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
    // A rake is its engine and its cars -- except a tram's, which has no
    // engine, every section of it being powered. Counted as though it had
    // one, every tag after the first tram pointed at the vehicle before the
    // one it meant, and a pigeon riding the third tram on the map was carried
    // by a tram three hundred metres away.
    base += each ? vehicleCount(each.cars, each.stock) : 0;
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
const residents: Resident[] = CHARACTERS.map((who) => {
  const morph = CHARACTER_MORPHS[who.morph % CHARACTER_MORPHS.length]!;
  const rig = createBirdRig(morph);
  scene.add(rig.object);
  return {
    who,
    state: createBird(vec(0, 0, 0), 0, 0),
    rig,
    voice: speechColour(morph.body),
    glowing: 0,
    here: false,
  };
});

/**
 * Put the cast where this level has them, and take everyone else off stage.
 *
 * Called every time a level begins, by whatever route -- chosen from the
 * menu, restarted after a death, or walked into out of the level before -- so
 * where somebody is standing is a fact about the level being flown and not a
 * history of what has happened. That is the whole point of it: Pink is on the
 * home tree in the first two levels and on the loft for the rest, and neither
 * of those is remembered anywhere. Restart the third level after flying into
 * a chimney and the branch is still empty, because that level says so.
 */
function stageCast(spec: Level): void {
  // Her cage, which is a different thing from her.
  //
  // "Wherever she is" was the first version of this rule and it was wrong in
  // the first two levels of the game: she is on the branch at home then, and
  // the cage came with her -- a trap on the nest, before anybody had taken
  // anything. The trapper's roof is the only place she is *in* one, so that
  // is the condition, and the position still comes from her own spot so the
  // two cannot drift apart.
  const hers = cagedIn(spec);
  const caged = hers ? standingSpot(hers) : null;
  if (caged) {
    // Sat on whatever she is standing on rather than centred on her: she
    // stands a body radius above the surface, and a cage floating a radius
    // clear of a roof is a cage nobody built.
    const floor = caged.at.y - defaultParams.bodyRadius;
    cage.show({ x: caged.at.x, y: floor, z: caged.at.z, yaw: caged.facing });
    cageBox = cageSolid({ x: caged.at.x, z: caged.at.z, on: floor, yaw: caged.facing });
  } else {
    cage.show(null);
    cageBox = null;
  }

  for (const member of residents) {
    // She is in the cast of every level from the errand onwards, because that
    // is where the story has put her -- but she is not to be *found* until
    // the level about finding her. A pink pigeon standing on the trapper's
    // roof is the same spoiler the cage is, so she goes with it.
    const hidden = member.who.name === PINK.name && hersHidden(spec);
    const spot = hidden ? undefined : standingOf(spec, member.who.name);
    const stood = spot ? standingSpot(spot) : null;
    member.here = stood !== null;
    member.glowing = 0;
    if (!stood) {
      member.rig.object.visible = false;
      continue;
    }
    member.state = createBird(stood.at, 0, stood.facing);
    standStill(member.state);
    member.state.restingOn = stood.on;
    // Whoever is standing in a level the hero starts *on* is in the same
    // story and the same morning as he is, and is as hungry. The rest are
    // standing about in somebody else's afternoon.
    member.state.health = spec.begins === 'perched' ? spec.health : 1;
  }
}

/**
 * Where a level's resident stands, whatever kind of thing the level is about.
 *
 * The three kinds differ only in what they are standing on and how high that
 * is. `on` is the collider's tag for it, which only a wagon has -- a roof and
 * a slab of concrete are part of the world and belong to nobody, so a bird on
 * one is standing on nothing in particular, exactly as it is on the grass.
 */
function standingSpot(spot: Standing): { at: Vec3; facing: number; on: number | null } | null {
  const person = spot;
  const place = spot.on;

  if (place.kind === 'wagon') {
    const car = carOf(place);
    const wagon = layout.trains[place.train]?.vehicles[car];
    if (!wagon) return null;
    const at = onVehicle(wagon, person.along, person.across);
    return {
      at: vec(at.x, stockTop(wagon.kind) + defaultParams.bodyRadius, at.z),
      // Facing across the wagon, so it reads as standing about rather than
      // waiting to leave. It turns to look at you when you walk up to it.
      facing: wagon.yaw + Math.PI / 2,
      on: carrierOf(place.train, car),
    };
  }

  // Otherwise it is one of the described things, which stands still and whose
  // shape is written down. The marker gives the place -- over the terrace of
  // a block of flats, over the middle of a patch of concrete -- and the
  // description gives the height, because a flat one's marker sits a hair
  // above the marking while what stands there stands on the ground.
  const described = LANDMARKS.find((landmark) => landmark.name === place.name);
  const marker = objective(place.name);
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

/**
 * Whether the flock is flying with him on the level being flown.
 *
 * A property of the level, applied where every other property of a level is.
 * With it off the flock is neither updated nor drawn: it stays frozen
 * wherever it was, which costs nothing and is invisible, and it is let out
 * afresh the next time a level asks for one.
 */
let escorted = false;

/**
 * The things on screen that say where to go, on or off.
 *
 * Three of them, and they are derived rather than declared: a level aims at
 * one thing, and every hint is about that thing -- the arrow over it, the
 * flash it gives when the camera finds it, and the painted line for a level
 * that ends at one. Written down separately they would be a second statement
 * of the target, free to disagree with the first.
 *
 * Turned off when the level is finished as well as when the next one starts,
 * which is the half that was missing. They are directions, and directions to
 * somewhere you have already arrived are clutter: an arrow still hanging over
 * the pigeon you are standing and talking to is the game telling you to go
 * where you are.
 */
function hint(spec: Level, on: boolean): void {
  // A level that ends at a line is aimed at the line, and the line is the
  // thing that shows. No arrow: it would be hanging over a building beyond
  // the stripe, which is somewhere this level does not go -- and an arrow
  // pointing past the finish at a place from another level is the single most
  // confusing thing the screen could say.
  const pointing = spec.finish.kind !== 'crossing';
  for (const marker of world.markers) {
    marker.setActive(on && pointing && marker.name === targetName(spec));
  }
  // The painted lines are not touched here. Every one of them, the finishing
  // line included, is a mark on the route now, and which one is showing is
  // the route's business rather than the level's -- see `paintWayline`.
  if (!on) for (const gate of world.gates) gate.object.visible = false;
}

/**
 * Paint the stripe for the mark being steered at, and only that one.
 *
 * A wayline is the finishing line's rule used partway along a level: a stripe
 * square across the route that any path to the far side has to cross. What it
 * buys over a column is that it cannot be flown past -- the first long flight
 * in the game is nine hundred metres over an empty park, and a twenty-metre
 * column is a thing a first-time player misses without ever knowing it was
 * there.
 *
 * One at a time, like the columns and for the same reason: a route painted
 * out all at once is a map, and reading a map is a different activity from
 * flying.
 */
function paintWayline(): void {
  const here = LEVELS[level]?.name;
  for (const gate of world.gates) {
    gate.object.visible = gate.name === here && gate.mark === waymarks.index;
  }
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
  tipStack.reset();
  outcome.hide();
  chase.snap(bird, cameraParams);
}

/**
 * How far a level may move the bird before the flock has to be sent home, in
 * metres.
 *
 * Two hundred. The stray rule brings a bird back from further than that, but
 * slowly and from wherever it was, and a flock strung out across the district
 * for the first minute of a level is a flock that was not there when it
 * started.
 */
const FLOCK_FOLLOWS = 200;

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

  // What the level does and does not have in it.
  tutorial = spec.teaches ?? true;
  hunted = crowsOn(spec);
  // Back over Népszínház utca, wherever the last level left them.
  //
  // They are one flock for the whole game and only three levels ask for them,
  // so between those levels they are frozen exactly where the last one
  // finished -- which after a level spent chasing the player is anywhere at
  // all. By the loft they had followed him most of a kilometre and were not
  // over the street they are supposed to be guarding at all.
  //
  // Scattered on a ball rather than recalled: a recall lets them out one a
  // second from where each of them last came down, and what is wanted is all
  // eight of them, now, in the place the level was designed around.
  if (hunted && crows && crowsAt) {
    crows.scramble(
      Array.from({ length: CROWS }, () => {
        const round = Math.random() * Math.PI * 2;
        const up = Math.acos(2 * Math.random() - 1);
        const away = 20 + Math.random() * 40;
        return vec(
          crowsAt.x + Math.sin(round) * Math.sin(up) * away,
          Math.max(CROW_HEIGHT - 12, CROW_HEIGHT + Math.cos(up) * 16),
          crowsAt.z + Math.cos(round) * Math.sin(up) * away,
        );
      }),
    );
  }

  // Everything this level puts into the world: who is standing where, what is
  // pointed at, and whether anybody is flying with him.
  stageCast(spec);
  hint(spec, true);
  // Let out only when the escort is starting rather than continuing: two
  // escorted levels in a row are one flight in two pieces, and a flock that
  // vanished and came back at the line would say otherwise.
  //
  // Except where this level starts a long way from where the bird is standing
  // now. She is let out behind him, and "behind him" is a fact about where he
  // is: left flying, she would be wherever the last level ended and would
  // spend the first minute of this one crossing the map to catch up, if the
  // stray rule brought her at all.
  //
  // Asked as a distance rather than flagged on the level, because it is a
  // distance: every level but the last begins where the one before it ended,
  // and the flock is already there.
  const jumped = (() => {
    const to = project(spec.start[0], spec.start[1], map.centre);
    return Math.hypot(to.x - bird.position.x, to.z - bird.position.z) > FLOCK_FOLLOWS;
  })();
  if (spec.escort && (!escorted || jumped)) flock.recall();
  // How many come. Set before the recall takes effect rather than after, so
  // the first bird let out on this level is already one of this level's.
  flock.only(spec.escort ? (spec.flock ?? 0) : 0);
  // And how they wheel, which depends on how many of them there are: see
  // `Level.flockBall`.
  flock.wheel({
    radius: spec.flockBall ?? defaultFlockOptions.radius,
    ahead: spec.flockAhead ?? FLOCK_AHEAD,
  });
  // Back into the air. A level that starts is a level whose flock is flying,
  // including a restart of the one they came down on.
  flock.land(null);
  // And nobody has been rescued yet: the whole point of it is that it happens
  // when he arrives, so a restart of that level has to arrive again.
  rescue = null;
  rescueAt = null;
  for (const rig of helperRigs) rig.object.visible = false;
  // And he is standing there again -- unless he has been taken apart and this
  // is what comes after that.
  //
  // The story is the same story every time it is played, so replaying any of
  // it puts him back on the roof the way replaying it puts the cage back
  // together. What must not put him back is walking on into the level that
  // exists *because* he is gone: a person standing over an empty roof in the
  // ever after is the ending being undone in the first frame of the epilogue.
  //
  // Told by the order of the levels rather than by naming one, so inserting
  // another after the rescue does not quietly bring him back to life.
  const rescued = LEVELS.findIndex((each) => each.settles === true);
  if (rescued < 0 || at <= rescued) {
    trapperGone = false;
    world.hidePersonNear(null);
  } else if (trapperGone) {
    const roof = layout.landmarks.find((mark) => mark.name === LOFT.name);
    if (roof) world.hidePersonNear({ x: roof.x, z: roof.z, within: 40 });
  } else {
    world.hidePersonNear(null);
  }
  // Thirty birds, all at once, on a ball behind him.
  //
  // The loft lets one out a second, which is right for a flock that drifts
  // into an errand and useless here: this level is a hundred and fifty-five
  // metres and about ten seconds long, so trickling them out puts four
  // pigeons in a shot that is *about* the thirty. Behind him because that is
  // where a bird is let out, and they wheel round in front of him within a
  // second or two on their own.
  if (spec.escort && spec.flockAtOnce && where !== 'in place') {
    const start = releaseFor(spec);
    const back = start.heading + Math.PI;
    flock.scramble(
      Array.from({ length: spec.flock ?? 0 }, () => {
        // On a ball rather than in a line: a rank of thirty birds astern
        // reads as a formation, and what is wanted is a flock.
        const round = Math.random() * Math.PI * 2;
        const up = Math.acos(2 * Math.random() - 1);
        const away = 18 + Math.random() * 22;
        return vec(
          start.at.x + Math.sin(back) * away + Math.sin(round) * Math.sin(up) * 12,
          Math.max(6, start.at.y + Math.cos(up) * 12),
          start.at.z - Math.cos(back) * away + Math.cos(round) * Math.sin(up) * 12,
        );
      }),
    );
  }
  // And where they come from, this once.
  //
  // A conversation that hands a level over does it where the player stands,
  // and the yard's conversation is had standing on a moving goods wagon
  // surrounded by thirty birds. So they leave the train: the ordinary rule
  // lets one out at a time from behind the leader, which is right for a
  // flock joining an errand and quite wrong for a flock that is already
  // here and has just said yes.
  //
  // Only on a handover in place -- a death restarts the level at its own
  // coordinate, half a mile from the yard, and thirty birds materialising
  // off a train that is not there is worse than the ordinary spawn. That is
  // what `where` distinguishes and it is the whole of the condition.
  // Back on the train for any level that flies alone, which is every level up
  // to and including the yard: replay one of those and the birds are standing
  // in the grain again, because that is where they are until they are asked.
  if (!spec.escort) ridersFlown = false;
  if (spec.escort && where === 'in place' && riders.length > 0) {
    ridersFlown = true;
    flock.scramble(
      riders.flatMap((rider) => {
        const wagon = layout.trains[FREIGHT]?.vehicles[rider.car];
        if (!wagon) return [];
        const at = onVehicle(wagon, rider.along, rider.across);
        return [vec(at.x, stockTop(wagon.kind) + defaultParams.bodyRadius, at.z)];
      }),
    );
  }
  escorted = spec.escort;
  // The marks, from the first one: they are help with *this* level, so they
  // start again with it -- including after a death, when the player is most
  // likely to want them.
  waymarks = createWaymarks(markedRoute(spec));
  markedAt = clock;
  waymark.show(waymarks.at, waymarks.next);
  paintWayline();

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
  // What this level teaches, from where it starts teaching it. A level taken
  // up in mid-air inherits the distance the last one ran up, so the course
  // counts from here rather than from the take-off two levels ago.
  // The finishing line, if this level has one: square across the way to the
  // target, so far along it. Worked out here, from the release point this
  // level was given rather than from wherever the bird happens to be, so that
  // arriving at the level in mid-air puts the line in the same place as
  // taking off into it.
  handover = endingFor(spec.finish);
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
let handover: Ending | null = null;



/**
 * End the level if whatever it is waiting for has happened.
 *
 * The hand-over is the same one a conversation makes: the next level begins
 * where the bird is, at the speed it was already going. What it changes is
 * where a death puts you -- which is the whole point of it, and the reason
 * this is a level rather than a checkpoint.
 */
function handOver(): void {
  // Where the thing this level named has got to, and whether the line is
  // behind us. Worked out here because they are facts about this world;
  // what to make of them is `finish.ts`'s business.
  const marker = objective(targetName(LEVELS[level] ?? LEVELS[0]!));
  const line = LEVELS[level] ? finishingLine(LEVELS[level]!) : null;
  const at = {
    perched: isPerched(bird),
    toTarget: marker
      ? Math.hypot(bird.position.x - marker.position.x, bird.position.z - marker.position.z)
      : Infinity,
    belly: bird.health,
    overTheLine: line !== null && crossed(line, bird.position.x, bird.position.z),
  };
  if (!handover?.done(at, TICK)) return;
  const opens = handover.opens;

  // Finished, whatever comes next -- and if what comes next is a scene, this
  // is the only thing that takes the arrow down before the camera leaves.
  const here = LEVELS[level];
  if (here) hint(here, false);
  handover = null;

  // A level opening another level takes it up where the bird is, in the air,
  // at the speed it was already going. A level opening a scene hands over to
  // the camera. Both are `follow`'s business, except for that one difference,
  // which is why the level case is written out here.
  if ('scene' in opens) {
    follow(opens);
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
  // A beat where the bird already is: no move, nothing placed, the world
  // stopped and somebody saying something. He is standing on the square he
  // has just landed on, and that is the shot.
  if (scene.endsOn === undefined) {
    holdOn(scene);
    return;
  }

  const closing = LEVELS.find((spec) => spec.name === scene.endsOn);
  if (!closing) return;

  // Where the level it closes on begins, which is a branch eighteen metres up
  // with somebody standing opposite. The same call the game makes to put the
  // player there, so the shot cannot drift from the one they remember: move
  // the tree and the closing shot moves with it.
  const ends = releaseFor(closing);
  const from: Framing = {
    eye: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    // Where the camera is looking, not where the bird is. The boom aims a way
    // past the bird, so framing the bird itself would turn the camera on the
    // first frame of the scene.
    look: chase.aim(),
  };

  // And where the camera has to get to, asked of the camera rather than
  // worked out again here: a stand-in bird is put in the closing shot, the
  // chase camera is snapped onto it, and where it lands is the answer. Two
  // calculations of one shot would be one too many, and the arithmetic of a
  // boom is exactly the sort that goes quietly out of step.
  const stand = createBird(ends.at, ends.perched ? 0 : SPAWN_SPEED, ends.heading);
  if (ends.perched) standStill(stand);
  // Filmed the way that level would be filmed: the close, low shot for a bird
  // put down on a branch, the ordinary chase for one released into the air.
  // A scene that ends over a street is handing the controls back in flight,
  // and framing that like a perch would be a cut on the first frame.
  chase.snap(stand, ends.perched ? { ...cameraParams, ...perchedCamera(false) } : cameraParams);
  const to: Framing = {
    eye: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    // And the same at the far end, which is where the seam was. The eye asked
    // the camera and the aim did not: the scene closed looking at the bird
    // and the chase camera then took over looking a good way past it, so
    // every scene in the game ended on a flick. Two calculations of one shot
    // were one too many, and this was the one that was doing it by hand.
    look: chase.aim(),
  };

  cutscene = {
    scene,
    ends,
    play: createFlyover(from, to, { seconds: scene.seconds, arc: scene.cruise }),
  };

  talk = null;
  talkingTo = null;
}

/** Put the bird in the closing shot, and let the player have it back. */
function endScene(): void {
  if (!cutscene) return;
  const { ends, scene } = cutscene;
  cutscene = null;

  // Nothing to say: the beat is the movement itself, so it runs straight on
  // into whatever it opens and the player never stops flying. What follows
  // places the bird -- a level released into the air puts him at its own
  // start -- so there is nothing to put down here.
  if (scene.says === undefined) {
    follow(scene.opens);
    return;
  }

  // Otherwise it holds. He is simply there: nothing flew him, the camera
  // went, and the point of the shot is where the player now is -- the same
  // spot, the same heading, the same camera as the morning he left, and
  // nobody opposite him.
  const home = createBird(ends.at, ends.perched ? 0 : SPAWN_SPEED, ends.heading);
  home.health = bird.health;
  home.stamina = bird.stamina;
  bird = home;
  if (ends.perched) standStill(bird);
  previousPosition = { ...bird.position };
  previousOrientation = { ...bird.orientation };

  holdOn(scene);
  // Cut rather than swung: the camera is sixty metres up and the closing shot
  // is a metre and a half behind a standing bird, and easing between those
  // two is a long fairground ride. Taken at the end of the frame, once the
  // perched shot has actually been worked out -- snapping here would snap to
  // whatever the camera wanted while it was still flying.
  cutTo = true;
}

/** Stop the world on a line, and wait for it to be read. */
function holdOn(scene: Scene): void {
  waiting = scene;
  talk = alone(...(scene.says ?? []));
  // The readouts, told about the bird that is actually standing there. No
  // ticks run while a beat is held, so the panel would otherwise be showing
  // the airspeed and climb of the last frame flown -- fifty-seven km/h on a
  // pigeon sitting on a branch. Stepping a landed bird touches nothing and
  // reads back zeroes, which is the truth about it.
  telemetry = step(bird, neutralControls(), flightParams, 0);
  outcome.hide();
}

/**
 * A beat the player is being held on, with a line and nothing to do but read.
 *
 * The one moment in the game where the bird is standing somewhere, the world
 * has stopped, and the take-off key means "go on" rather than "fly". Null the
 * rest of the time.
 */
let waiting: Scene | null = null;

/** Take up whatever a finished scene hands over to. */
function follow(opens: Opens): void {
  if ('scene' in opens) {
    const next = sceneNamed(opens.scene);
    if (next) beginScene(next);
    return;
  }
  const at = LEVELS.findIndex((spec) => spec.name === opens.level);
  if (at >= 0) playLevel(at);
}

/** The player has read it: on with the story. */
function goOn(): void {
  if (!waiting) return;
  const scene = waiting;
  waiting = null;
  talk = null;
  follow(scene.opens);
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
},
  // Clicked, which is the way in nobody has to be told about.
  (picked) => playLevel(picked));
const talkPanel = createDialoguePanel(overlay);
const tipPanel = createTipPanel(overlay);
/** And the cage's, on the one level that has something to work at. */
const gauge = createGauge(overlay);
/**
 * What is up, and for how long. See `TipStack`.
 *
 * Kept beside the panel rather than inside it, because it is a decision about
 * the game -- how long a thing is worth saying, and how many at once -- and
 * the panel's job is to draw whatever it is handed.
 */
const tipStack = createTipStack();
/** The last thing said, so a note is sounded when it changes rather than every frame. */
let announced: string | null = null;
/** The bars over the heads of the birds you are looking at. */
const vitals = createVitals(overlay);
/**
 * The same instructions, said out loud.
 *
 * Reading is the one thing a player three seconds from a rooftop cannot spare
 * attention for, and speech arrives without being looked at. V turns it off,
 * for the two of us who will get tired of it first.
 */
/**
 * The voice, off to begin with.
 *
 * The instructions have a picture and a note of their own now -- see
 * `Tip.sort` -- and between those and the crow's two tones there is plenty
 * being said without one reading the words out as well. `V` turns it on for
 * anybody who wants it, and it announces itself when it does.
 */
const voice = createVoice(browserSpeaker(window.speechSynthesis), undefined, false);
const cue = createCue(browserChime());
const alarm = createAlarm(browserTone());
const ambience = createAmbience(browserKit());

/**
 * How often the list of things that could make a noise is gathered, in
 * seconds.
 *
 * A fifth. Nothing here moves far in that, and the alternative is walking a
 * hundred and twenty-five trains and sixty-four platforms a hundred and
 * twenty times a second for a sound that happens once every few seconds.
 */
const LISTEN_EVERY = 1 / 5;
/** How far out anything is worth gathering at all, in metres. */
const EARSHOT = 150;
let heardAt = -1;
let audible: Source[] = [];

/**
 * Everything near the bird that could make a noise, and where it is.
 *
 * Only real things. A bark comes from a dog that is standing there and a bell
 * from a tram that is actually on that street, so the sound is information as
 * well as atmosphere -- see `createAmbience`.
 */
function listen(): Source[] {
  const near_: Source[] = [];
  const from = bird.position;
  const within = (x: number, z: number) =>
    Math.abs(x - from.x) < EARSHOT && Math.abs(z - from.z) < EARSHOT;

  // Dogs: the ones walking about on Jani Pali tér, and the ones on a lead at
  // a tram stop.
  for (const hound of dogs) {
    if (within(hound.pose.x, hound.pose.z)) {
      near_.push({ noise: 'bark', x: hound.pose.x, y: hound.pose.y, z: hound.pose.z });
    }
  }
  for (const stop of layout.platforms ?? []) {
    if (!within(stop.x, stop.z)) continue;
    for (const each of stop.waiting) {
      // On the island, which is a step up from the road it stands in.
      if (each.dog) near_.push({ noise: 'bark', x: each.dog.x, y: stop.height, z: each.dog.z });
    }
  }

  // Pigeons: the crowds on the squares, and the flock when it is out. Not the
  // hero -- a bird does not startle itself.
  for (const crowd of crowds) {
    for (const each of crowd.birds) {
      const at = each.state.position;
      if (within(at.x, at.z)) near_.push({ noise: 'coo', x: at.x, y: at.y, z: at.z });
    }
  }
  if (escorted) {
    for (const member of flock.members) {
      if (member.down > 0) continue;
      const at = member.state.position;
      if (within(at.x, at.z)) near_.push({ noise: 'coo', x: at.x, y: at.y, z: at.z });
    }
  }

  // Crows, on the levels that have them.
  if (hunted) {
    for (const crow of crows?.members ?? []) {
      if (crow.down > 0) continue;
      const at = crow.state.position;
      if (within(at.x, at.z)) near_.push({ noise: 'caw', x: at.x, y: at.y, z: at.z });
    }
  }

  // And the railway. A tram rings its bell and a heavy rake squeals round a
  // curve, so they are two different noises off the same list -- and only
  // from a rake that is near enough to have been laid out this tick, which is
  // the same three hundred metres the collider uses.
  layout.trains.forEach((train, index) => {
    if (!near[index]) return;
    // Standing still makes neither noise: a bell is rung on pulling away and
    // a wheel squeals under load.
    if (train.held > 0 || train.waited > 0) return;
    const head = train.vehicles[0];
    if (!head || !within(head.x, head.z)) return;
    near_.push({
      noise: train.stock === 'tram' ? 'bell' : 'screech',
      x: head.x,
      // A vehicle is placed on the ground and has no height of its own here;
      // roof height is near enough, and it is what the bird flies over.
      y: stockTop(train.stock),
      z: head.z,
    });
  });

  return near_;
}
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
/**
 * Whether there are crows in the sky on this level.
 *
 * They live at one place on the map rather than in a level, so any level
 * whose route passes that place used to have them: the flag defaulted to on,
 * and only the epilogue turned it off, which put crows over twelve of the
 * thirteen levels and let one kill the player on a level that has nothing to
 * do with crows. Three levels ask for them now -- see `Level.crows`.
 */
let hunted = false;

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

/**
 * How long a tram stands at a stop, in seconds.
 *
 * Two, which is short for a tram and right for this. A real one dwells for
 * fifteen or twenty; a pigeon crosses this district in under a minute, and a
 * tram parked for twenty seconds in a game that long is a tram that has
 * broken down. Two is long enough to read as stopping and to land on, and
 * short enough that the street is never still.
 */
const DWELL = 2;
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
/**
 * The attitude the bird was in when its flight ended, or null while it flies.
 *
 * Only the camera reads it: see where it is set.
 */
let dyingAttitude: { x: number; y: number; z: number; w: number } | null = null;

/** And the pose each is drawn in, between one tick and the next. */
const drawnVehicles = layout.trains.map((train) =>
  layOutTrain(train.line, train.along, train.cars, train.stock),
);
/** And which of them were near enough to be worth it, this tick. */
const near = layout.trains.map(() => false);
/**
 * And which of them came back on to the map this tick.
 *
 * Cleared at the top of every tick. A tram taking up a leg is the one
 * movement in the game that is not a movement -- it was nowhere at all a
 * moment ago -- and two things have to know: the frame drawn between two
 * ticks, which would otherwise interpolate the tram across the whole city,
 * and whatever is riding on it, which is carried by the difference between
 * where its vehicle was and where it is.
 *
 * Nothing does ride one, as it happens. A pigeon on the roof of a tram that
 * reaches the end of the line is left standing in the air, and falls, which
 * is the right answer: the tram it was on has gone.
 */
const wrapped = layout.trains.map(() => false);

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

/**
 * How near a stopped tram a platform has to be to be its platform, in metres.
 *
 * Twenty-five. A tram pulls up with its middle on the stop, an island stands
 * a couple of metres to the side and runs up to sixty long, and the next stop
 * along is two hundred metres away -- so this is wide enough to catch both
 * islands of the stop it is at and nothing else.
 */
const PLATFORM_AT = 25;

/**
 * How far in front of its nose a train looks, in metres.
 *
 * Twenty-five: about a tram's own length, so it starts slowing for the one in
 * front while there is still a tram-length of daylight, and it is short
 * enough that a stop two hundred metres up the line is not something to wait
 * behind.
 */
const LOOK_AHEAD = 25;

/**
 * How near the look-ahead point counts as being in the way, in metres.
 *
 * Twelve, which is half a long car plus a little: vehicles are tested by
 * their middles, and a twenty-four metre carriage whose middle is eleven
 * metres away has its end in your face.
 */
const BLOCKING = 12;

/**
 * How long a train will wait before going anyway, in seconds.
 *
 * A backstop, not a rule. Same-direction waiting cannot deadlock -- see
 * `blockedBy` -- but it is a claim about geometry made in a game with a
 * hundred and twenty-five trains in it, and a tram stopped for ever in the
 * middle of Rákóczi út is worse than two trams overlapping for a second.
 */
const WAIT_LIMIT = 20;

/**
 * How clear a piece of line has to be before a tram comes on to it, in metres.
 *
 * Nothing about being put down at the start of a line knows whether anything
 * is standing there, so it has to be asked -- this was the last way two trams
 * ended up inside each other once the look-ahead was fixed: not driven into,
 * materialised into.
 *
 * Twenty, asked at the nose, the middle and the tail. Those are twenty-seven
 * metres apart on a four-car tram, so twenty at each of them overlaps and the
 * whole rake is covered -- which one circle of any size round the middle
 * never is.
 */
const COMING_ON = 20;

/**
 * How many of a route's trams may be away on the neighbouring track at once.
 *
 * One. See `legAfter`: a tram runs out along its own route and comes back on
 * the track that begins where its route ends, which is what a tram does and
 * what stops it teleporting three kilometres across the district in front of
 * anybody who flew out to watch. The cost is that a tram is off its own route
 * half the time, and a route with all its trams away is a tram line with no
 * trams on it -- ten of twenty-seven of them, measured over ten minutes.
 *
 * Lending one at a time costs nothing and settles it: the dip is a single
 * tram, and the route that has already lent one keeps the rest.
 */
const LENT_OUT = 1;

/**
 * How many of each route's trams are away on somebody else's track.
 *
 * Keyed on the line, which is the route: every tram built on it was handed
 * the same `home`, so the line is what they have in common.
 */
const lentFrom = new Map<Rail, number>();

/**
 * And how many it has altogether, which is what it may lend against.
 *
 * A route with one tram lends none. It is the one case the cap above does not
 * cover on its own -- one out of one is still all of them -- and it is not a
 * corner: five of this district's tram routes are short enough to have been
 * given a single tram, and two of them stood empty half the session without
 * this.
 */
const routeTrams = new Map<Rail, number>();
for (const train of layout.trains) {
  routeTrams.set(train.home.line, (routeTrams.get(train.home.line) ?? 0) + 1);
}
const mayLend = (home: Rail): number => Math.min(LENT_OUT, (routeTrams.get(home) ?? 1) - 1);

/**
 * How often the look-ahead is worked out, in seconds.
 *
 * A twentieth. A tram does half a metre in that, and it is the difference
 * between six hundred vehicles being bucketed a hundred and twenty times a
 * second and twenty.
 */
const LOOK_EVERY = 1 / 20;

/** Every vehicle in the world, bucketed by where it is. Rebuilt on the beat. */
const trafficGrid = new Map<string, { train: number; at: Vehicle }[]>();
let trafficAt = -1;
const TRAFFIC_CELL = 40;
const trafficKey = (x: number, z: number) =>
  `${Math.floor(x / TRAFFIC_CELL)},${Math.floor(z / TRAFFIC_CELL)}`;

/** Fill the grid from wherever the rakes have got to. */
function seeTraffic(): void {
  trafficGrid.clear();
  layout.trains.forEach((train, index) => {
    // A tram that is off the map is not in anybody's way. Left in, it would
    // be the thing parked at the end of the line that stops the next one
    // coming on -- which is the jam this was written to end.
    if (train.gone) return;
    for (const at of train.vehicles) {
      const key = trafficKey(at.x, at.z);
      const bucket = trafficGrid.get(key);
      if (bucket) bucket.push({ train: index, at });
      else trafficGrid.set(key, [{ train: index, at }]);
    }
  });
}

/** Whatever is near a point, excluding one train's own vehicles. */
function trafficNear(at: { x: number; z: number }, mine: number): Vehicle[] {
  const found: Vehicle[] = [];
  const gx = Math.floor(at.x / TRAFFIC_CELL);
  const gz = Math.floor(at.z / TRAFFIC_CELL);
  for (let ox = -1; ox <= 1; ox += 1) {
    for (let oz = -1; oz <= 1; oz += 1) {
      for (const each of trafficGrid.get(`${gx + ox},${gz + oz}`) ?? []) {
        if (each.train !== mine) found.push(each.at);
      }
    }
  }
  return found;
}

/**
 * A tram has pulled in, or pulled out.
 *
 * In: everybody on the platform gets on, and the platform is empty. Out: a
 * different few are waiting, because the tram was gone a while and people
 * arrive while it is away. Nothing here models boarding -- nobody walks and
 * nothing opens -- but a platform that empties when a tram calls and fills
 * again when it leaves reads as all of it.
 *
 * The same rule fills it as filled it when the world was built, so the second
 * lot look like the first lot: see `crowdOn`.
 */
function boarding(at: { x: number; z: number }, arriving: boolean): void {
  const platforms = layout.platforms ?? [];
  let changed = false;
  for (const stop of platforms) {
    if (Math.hypot(stop.x - at.x, stop.z - at.z) > PLATFORM_AT) continue;
    stop.waiting = arriving ? [] : fillPlatform(stop, Math.random);
    changed = true;
  }
  if (changed) world.setWaiting(platforms);
}

function moveTrains(dt: number) {
  clock += dt;
  const fields: Collider[] = [world.collider];
  // The cage, while there is one. Built here with the trains rather than into
  // the world's grid, for the same reason they are: the world's boxes are
  // laid into that grid once and never touched, and this one comes and goes
  // with the level.
  if (cageBox) fields.push(createColliderField([cageBox]));
  rememberWhereTrainsWere();
  // Where everything is, once, before anything moves -- so that every train
  // this tick is looking at the same world rather than at one that has been
  // half updated by the trains before it in the list.
  if (clock - trafficAt >= LOOK_EVERY) {
    seeTraffic();
    trafficAt = clock;
  }
  let tagged = 0;
  near.fill(false);
  wrapped.fill(false);

  layout.trains.forEach((train, index) => {
    previousAlong[index] = train.along;
    // Off the map, waiting to come back on. It takes up the next leg of its
    // service the moment there is room for the whole rake at the start of it,
    // and until then it is simply not here -- which is the whole of the fix:
    // the tram that used to stand at the buffers for four minutes is now
    // somewhere between one end of its route and the other, as a tram between
    // journeys is.
    if (train.gone) {
      const away = lentFrom.get(train.home.line) ?? 0;
      const leg = legAfter(train, away, mayLend(train.home.line));
      const consist = consistLength(train.cars, train.stock);
      const on = comeOnAt(consist, lineLength(leg.line.points), train.direction);
      const middle = pointAlong(leg.line.points, on - consist / 2);
      tagged += vehicleCount(train.cars, train.stock);
      if (
        !middle ||
        !roomToComeOn(leg.line.points, on, consist, trafficNear(middle, index), COMING_ON)
      ) {
        train.waited += dt;
        return;
      }
      // Off its own route, or back on it. Counted as it happens rather than
      // as it is decided, so a tram waiting for room is not yet lent.
      if (leg.line !== train.home.line) lentFrom.set(train.home.line, away + 1);
      else if (train.line !== train.home.line) {
        lentFrom.set(train.home.line, Math.max(0, away - 1));
      }
      train.line = leg.line;
      train.calls = leg.calls;
      train.along = on;
      train.held = 0;
      train.calling = null;
      train.waited = 0;
      train.gone = false;
      // Not a movement: it was nowhere a moment ago. Saying so keeps the
      // frame between the ticks from being drawn as a sweep across the city.
      previousAlong[index] = on;
      wrapped[index] = true;
      moveTrain(train.vehicles, train.line, train.along, train.cars, train.stock);
      laidOut[index] = clock;
      return;
    }
    // Where it is. Every train, every tick, whether or not anyone is looking:
    // a train is part of the world rather than a prop, and one that stopped
    // while your back was turned would be in the wrong place when you came
    // back. It is also the cheap half -- a step along a line and a reflection
    // at the ends -- so there is nothing to gain by skipping it.
    const consist = consistLength(train.cars, train.stock);
    const line = lineLength(train.line.points);
    // Where it gets to, stops and all -- see `advance`. A tram calls at its
    // platforms and waits there, which is the difference between a tram and a
    // thing on rails: the whole street stops with it.
    // Anything in the way? Along the track rather than in a straight line
    // out of the nose, which is what makes it work round a curve -- a box
    // thrown straight ahead of a tram on a bend points at the buildings on
    // the outside of it and misses the tram it is following.
    //
    // Only while it is running: a tram standing in a platform has already
    // stopped, and one held at a red light it is itself causing is a knot.
    if (train.held <= 0) {
      const look = noseAhead(train, consist, LOOK_AHEAD);
      const nose = train.vehicles[train.direction > 0 ? 0 : train.vehicles.length - 1];
      // Which way it is actually going. A vehicle's yaw runs along its length
      // towards increasing `along`, so a train running back down the line has
      // its forward the other way round.
      const forward =
        nose === undefined
          ? null
          : {
              x: Math.cos(nose.yaw) * train.direction,
              z: -Math.sin(nose.yaw) * train.direction,
            };
      const stuck =
        look !== undefined &&
        look !== null &&
        nose !== undefined &&
        forward !== null &&
        blockedBy(nose, forward, look, trafficNear(look, index), BLOCKING);
      // Given up on, after a while. See `WAIT_LIMIT`.
      if (stuck && train.waited < WAIT_LIMIT) {
        train.waited += dt;
        previousAlong[index] = train.along;
        moveTrainBoxes(trainBoxSets[index]!, train.vehicles, tagged, 0);
        tagged += vehicleCount(train.cars, train.stock);
        if (near[index]) fields.push(createColliderField(trainBoxSets[index]!));
        return;
      }
      if (!stuck) train.waited = 0;
    }

    const went = advance(train, consist, line, dt, DWELL);
    // Run out of line. It goes -- now, and whether or not there is anywhere
    // for it to come back on.
    //
    // Those used to be one decision, and that was the bug: a tram reaching
    // the end of its route was only picked up if the place it was going to be
    // put down was clear, so a tram with nowhere to go stood at the buffers
    // instead. On this map the ends of the routes are piled on top of one
    // another -- five routes finish at the same corner -- so the place it
    // wanted was very often held by another tram in exactly the same fix.
    // Fifty-six of ninety-nine trains stood for over ten seconds at a
    // stretch; the worst stood for four minutes at the end of the track, in
    // plain sight of anyone who flew out to the edge of the district.
    //
    // Separating them costs nothing. Leaving is always possible.
    if (went.wrapped) {
      train.gone = true;
      train.waited = 0;
      previousAlong[index] = train.along;
      tagged += vehicleCount(train.cars, train.stock);
      return;
    }
    // Pulling in, or pulling out. Both are single ticks, so the work of
    // emptying and refilling a platform happens twice a call rather than
    // every frame -- and between them the platform simply has nobody on it.
    if (went.held > 0 !== train.held > 0) {
      const middle = pointAlong(train.line.points, went.along - consist / 2);
      if (middle) boarding(middle, went.held > 0);
    }
    train.along = went.along;
    train.direction = went.direction;
    train.held = went.held;
    train.calling = went.calling;
    // The tags are handed out for every train in turn whatever happens next,
    // so that skipping one does not renumber the rest -- a resident's idea of
    // which wagon it is standing on is one of these numbers.
    const base = tagged;
    tagged += vehicleCount(train.cars, train.stock);

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
    // The speed it is doing, not the speed it runs at. Every box carries this
    // and it is what makes being touched by one fatal -- so a tram standing
    // in a platform has to say nought, or the safest place in the city to
    // land is the one thing in it that kills you.
    moveTrainBoxes(boxes, train.vehicles, base, train.held > 0 ? 0 : train.speed);
    fields.push(createColliderField(boxes));
  });

  // A tram that wrapped is put back into the "where it was" copy exactly as
  // it now stands, so the difference across this tick comes to nothing and
  // nothing riding it is dragged the length of the route behind it. Done here
  // rather than in the loop because the loop has two places a rake can be
  // laid out in and this is true of both.
  for (const [index, went] of wrapped.entries()) {
    if (!went) continue;
    const base = carrierOf(index, 0);
    layout.trains[index]?.vehicles.forEach((vehicle, v) => {
      const kept = wasAt[base + v];
      if (!kept) return;
      kept.x = vehicle.x;
      kept.z = vehicle.z;
      kept.yaw = vehicle.yaw;
    });
  }

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
/**
 * Whether he is standing on the thing this level is pointed at.
 *
 * Which is a different question from whether the level is finished: the loft
 * is finished by walking up to her, and this is true from the moment his feet
 * touch the roof she is on.
 */
function arrived(): boolean {
  if (!isPerched(bird)) return false;
  const marker = objective(targetName(LEVELS[level]!));
  if (!marker) return false;
  return (
    Math.hypot(bird.position.x - marker.position.x, bird.position.z - marker.position.z) <=
    ARRIVED_WITHIN
  );
}

/**
 * Where to put her dot on the map, or null for not at all.
 *
 * Three cases, in the order they outrank each other. Flying with him she is
 * her own bird in the flock and that is where she is, whatever any level says
 * she is standing on. Otherwise it is a question about the story: the map may
 * only say where she is on the levels that say he knows -- see
 * `Level.hersKnown` -- because between the branch and the loft the whole game
 * is looking for her, and a pink dot on the trapper's roof would hand over
 * five levels' worth of answer.
 *
 * And the loft itself, which is neither. He does not know when it begins and
 * does know by the time it ends, so it turns on at the moment in between:
 * his feet on the roof she is caged on. `arrived` is exactly that moment --
 * it is what puts the crows away too -- and the level goes on for as long as
 * it takes him to walk over to her, which is the part of it she should be on
 * the map for.
 */
function hersDot(hersAt: number | null): { x: number; z: number } | null {
  if (escorted && hersAt !== null) {
    const flying = flock.members[hersAt];
    if (flying && flying.down <= 0) {
      return { x: flying.state.position.x, z: flying.state.position.z };
    }
  }
  const spec = LEVELS[level];
  if (!spec) return null;
  const ends = spec.finish;
  const found =
    hersOnMap(spec) || (ends.kind === 'meeting' && ends.who === PINK.name && arrived());
  if (!found) return null;
  const her = residents.find((resident) => resident.who.name === PINK.name);
  return her?.here ? { x: her.state.position.x, z: her.state.position.z } : null;
}

function reachLevel(): void {
  // Anyone at all, not just the one this level is about: standing with a
  // pigeon is standing with a pigeon, and the camera should say so.
  // Nobody, while she is still behind bars. The last level's conversation is
  // "you saved me", and it cannot be had before she has been: walking up to
  // the cage and being greeted through it would be the ending happening on
  // the wrong side of the thing the whole level is about.
  //
  // Only where there is a cage to open -- everywhere else `cageBox` is null
  // because nothing is caged, and everywhere else this reads as "yes".
  const shut = cageBox !== null && LEVELS[level]?.settles === true;
  talkingTo = shut
    ? null
    : (residents.find((resident) => resident.here && meeting(bird, resident.state)) ?? null);

  const here = LEVELS[level];
  // Meeting them finishes the level and nothing else. What happens next is
  // the player's move, not the game's: they are standing with somebody, and
  // the somebody says hello.
  const said = here ? dialogueOf(here) : undefined;
  if (said && here && talkingTo?.who.name === metBy(here) && !finished) {
    finished = true;
    // Arrived: the directions come down. What is left on screen is the two of
    // them standing on a roof, which is the shot.
    hint(here, false);
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
    const handed = openedName();
    const done = read({ en: 'complete', hu: 'megvan' });
    if (handed) {
      return read({
        en: `${here} ${done} — SPACE to take off for ${handed}`,
        hu: `${here} ${done} — SPACE, és irány ${handed}`,
      });
    }
    const next = LEVELS[level + 1]?.name;
    return next
      ? read({
          en: `${here} ${done} — SPACE to fly on to ${next}`,
          hu: `${here} ${done} — SPACE, és tovább ${next} felé`,
        })
      : `${here} ${done}`;
  }
  // Nothing at all while the game is flying: an audience is not being told
  // which key to press.
  if (cutscene) return null;
  // Held on a beat: the words are the conversation panel's, and the key is
  // the instruction panel's. The banner has nothing to add.
  if (waiting) return null;
  if (started && clock - startedAt <= NOTE_SECONDS) return `${say('nowFlying')} — ${started}`;
  return null;
}


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
  if (handed && 'scene' in handed) {
    // A shot rather than a take-off. The key is spent on starting it -- the
    // wings must not also open, because there is no bird to open them: the
    // camera goes on its own and the hero is put down at the far end.
    follow(handed);
    return true;
  }
  if (handed) {
    playLevel(
      LEVELS.findIndex((spec) => spec.name === handed.level),
      'in place',
    );
    return false;
  }

  if (level + 1 >= LEVELS.length) return false;
  playLevel(level + 1);
  return true;
}

/**
 * What the conversation on screen has handed over to, or null.
 *
 * A name rather than an index, because it may be either sort of thing now: a
 * conversation can hand over to the next level, which is what every one of
 * them did until the one out west, or to a scene -- and the scene then hands
 * over to the level, so what the player gets between the last word and the
 * controls is a shot rather than a cut.
 */
function opened(): Opens | null {
  const name = talk?.opens;
  if (name === undefined) return null;
  if (sceneNamed(name)) return { scene: name };
  return LEVELS.some((spec) => spec.name === name) ? { level: name } : null;
}

/** And what to call it, for the banner that says which key to press. */
function openedName(): string | null {
  const opens = opened();
  if (!opens) return null;
  if ('level' in opens) return opens.level;
  return sceneNamed(opens.scene)?.endsOn ?? null;
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
let voiceNote: { said: 'on' | 'off'; at: number } | null = null;







/** The resident this level is about, if it has one. */
function levelPerson(): Resident | null {
  const here = LEVELS[level];
  const wanted = here ? metBy(here) : undefined;
  const found = wanted ? residents.find((r) => r.who.name === wanted) : undefined;
  return found?.here ? found : null;
}



function frame(nowMs: number) {
  const now = nowMs / 1000;
  const frameTime = Math.min(now - lastTime, MAX_FRAME_TIME);
  lastTime = now;

  smoothedFps += (1 / Math.max(frameTime, 1e-4) - smoothedFps) * 0.1;

  input.update(frameTime);
  if (input.consumeMenu()) menu.toggle(level, mode);
  // And Escape shuts it, which is the key everybody reaches for. It does
  // nothing when the list is not up: there is nothing else on screen that can
  // be dismissed, and a key that quietly did something in flight would be a
  // key nobody could press by accident and get away with.
  if (input.consumeDismiss() && menu.open) menu.close();
  // A digit is a level while the menu is up and a thing to say while a
  // conversation is waiting on one. Offered to the menu first, because the
  // menu is the thing the player has just deliberately opened.
  for (let digit = input.consumeDigit(); digit !== null; digit = input.consumeDigit()) {
    const picked = menu.choose(digit);
    if (picked !== null) playLevel(picked);
    else if (talk && !isOver(talk)) talk = reply(talk, digit);
  }
  // And the arrows, for the levels a digit cannot reach. Taken as a total
  // rather than one at a time, because holding the key repeats it and a list
  // that moved one row per frame would be unusable. They do nothing at all
  // while the menu is shut, where the same keys are the pitch and roll of a
  // bird -- `move` and `confirm` both refuse while it is closed.
  menu.move(input.consumeStep());
  if (input.consumeConfirm()) {
    const picked = menu.confirm();
    if (picked !== null) playLevel(picked);
  }
  // The whole level again, rather than only the bird. Restarting has to put
  // the cast back where this level has them and light the arrow again --
  // otherwise a level restarted after it was finished is a level with no
  // directions in it, and one restarted after somebody moved has them
  // standing wherever the last chapter left them.
  if (input.consumeReset()) playLevel(level);
  // V for the voice. An undiscoverable key for now, which is the right amount
  // of discoverable for a thing whose whole purpose is to be turned off by
  // whoever is tired of it.
  // Tab for the other language. Discoverable, unlike the voice: it is one of
  // the four keys standing in the corner, and it is written in the language it
  // would swap to -- `magyar` while you are reading English -- so it says what
  // it does without needing a word for "language".
  if (input.consumeLanguage()) {
    setLanguage(otherLanguage());
    rememberLanguage(storage() ?? null);
    // Everything built once and written over relabels itself: see
    // `onLanguageChange`. What is left is the two things this file owns --
    // the line over the bird, which is rebuilt every frame anyway, and the
    // voice, which should stop saying an English sentence in the middle.
    voice.hush();
  }
  if (input.consumeVoice()) {
    // Said through the panel rather than shown here and overwritten a line
    // later by whatever the flight has to say: the panel is told what to show
    // once a frame, so anything written straight to it lasts one frame.
    // Which way it went, and when. The words and the picture belong with
    // every other message's, in `MESSAGES`.
    voiceNote = { said: voice.toggle() ? 'on' : 'off', at: clock };
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
  } else if (waiting) {
    // The same key, meaning the same thing it always means: he is leaving.
    // What follows happens to be a camera rather than a wingbeat.
    if (input.consumeLaunch()) goOn();
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
  } else if (!waiting) accumulator += frameTime;

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
    const doing = stanceOf(bird, talkingTo !== null);
    const allowed = asStance(
      { forward: input.walk.forward, turn: input.walk.turn, launch: launchPending },
      doing,
    );
    walkControls.forward = allowed.forward;
    // Round to look at whoever is talking, at walking pace, for as long as
    // the conversation lasts -- so the shot is two birds facing each other
    // rather than one addressing the back of the other's head.
    // Round to look at whoever is talking -- or, on the roof at the end of
    // the story, at the cage. He has just flown across the district for it
    // and the birds are coming down behind him; standing with his back to it
    // is the one thing he would not be doing.
    walkControls.turn = talkingTo
      ? faceTurn(bird, talkingTo.state.position, flightParams, TICK)
      : rescueAt
        ? faceTurn(bird, rescueAt, flightParams, TICK)
        : allowed.turn;
    walkControls.launch = allowed.launch;
    const wasDown = isPerched(bird);
    onFoot = walk(bird, walkControls, flightParams, TICK, solid);
    // Contagious fear. One bird leaving is the only warning the rest of them
    // get, and they go with it -- so a player who takes off in the middle of
    // the crowd scatters the crowd. By the wing rather than by walking off an
    // edge: stepping off a kerb is not an alarm, and the birds on the
    // concrete would not have noticed it.
    if (wasDown && walkControls.launch && !isPerched(bird)) {
      for (const crowd of crowds) crowd.startle(bird.position.x, bird.position.z);
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
    telemetry = step(bird, asFlight(input.controls, doing), flightParams, TICK, solid, wind);
    // On the level that does not tire, the wings are simply kept full. Put
    // back after the step rather than switched off inside the flight model:
    // the beat still costs what it costs, the telemetry still reports it,
    // and the one thing that changes is that the cost is refunded. Nothing
    // else in the game has to know there is such a thing as a tireless
    // level.
    if (LEVELS[level]?.tireless) bird.stamina = 1;
    // The flock comes down with him, on the level that ends the story.
    //
    // Told once, when his own feet touch: thirty birds who came to help do
    // not circle a roof while the thing they came for happens underneath
    // them. Some of them will make a mess of it and that is the shot -- a
    // flock arriving all at once is not thirty clean landings.
    //
    // Only where the level says so, and only downwards: `land(null)` is never
    // called from here, because a bird that has put down should not be sent
    // back up by the player taking off again.
    if (LEVELS[level]?.settles && isPerched(bird) && !rescue && cageBox) {
      // The flock goes away and thirty birds appear behind him, already on
      // their feet. See `rescue.ts` for why this is a cheat and why it is the
      // right one: the last level is a hundred and fifty-five metres long, a
      // flock lets one bird out at a time, and what arrives if you let it is
      // four pigeons.
      flock.only(0);
      const roof = layout.landmarks.find((mark) => mark.name === targetName(LEVELS[level]!));
      rescue = beginRescue({
        // The whole terrace, so they arrive at the far corners and walk in.
        // Falling back to a patch round the hero if the level is not aimed at
        // a described thing, which this one is and always will be -- but a
        // crash here would be a crash at the end of the game.
        terrace: roof
          ? { x: roof.x, z: roof.z, width: roof.width, depth: roof.depth, yaw: roof.yaw ?? 0 }
          : { x: bird.position.x, z: bird.position.z, width: 20, depth: 20, yaw: 0 },
        cage: { x: (cageBox.minX + cageBox.maxX) / 2, z: (cageBox.minZ + cageBox.maxZ) / 2 },
        ground: bird.position.y,
        many: LEVELS[level]?.flock ?? 0,
        morphs: PIGEON_MORPHS.length,
        flight: flightParams,
      });
      rescueAt = vec(
        (cageBox.minX + cageBox.maxX) / 2,
        bird.position.y,
        (cageBox.minZ + cageBox.maxZ) / 2,
      );
    }
    if (rescue) {
      rescue.update(TICK, solid);
      // And then it gives way. The bars are thrown outwards and dropped, and
      // the box round them stops being solid at the same moment -- a cage you
      // can see the pieces of and still cannot fly through would be the one
      // thing worse than no cage at all.
      if (rescue.broken && cageBox) {
        const middle = {
          x: (cageBox.minX + cageBox.maxX) / 2,
          z: (cageBox.minZ + cageBox.maxZ) / 2,
        };
        cageBox = null;
        cage.burst();
        // And him with it. He is drawn by the crowd every other person on the
        // map is drawn by, so this is the only way he can be taken out of it
        // -- and the frame he goes on is the frame the bars start tumbling,
        // which is the only reason the swap is not visible.
        world.hidePersonNear({ x: middle.x, z: middle.z, within: 4 });
        trapperGone = true;
      }
    }
    // And if the flight ended in the air, the bird still has to get down.
    // The model above has nothing more to say about it -- a finished flight
    // is inert to it -- but a corpse hanging at sixty metres is not a death,
    // it is a bug with a story attached. Does nothing to one that is perched
    // or already on the ground, so it is safe here every tick.
    fall(bird, flightParams, TICK, solid);
    // The loft shuts while the player is dead. A fresh pigeon appearing over
    // the wreck is the game carrying on cheerfully around a corpse, which is
    // the one thing that moment should not do.
    flock.update(TICK, solid, wind, doing !== 'dead');
    // And they leave once he is down on the thing the level is aimed at.
    //
    // A crow hunts a bird in the air; the flight it was a danger to is over.
    // What that buys is the arrival at the loft: he comes out of them, lands,
    // and finds her in a cage -- and eight crows still wheeling overhead
    // would be the level going on around the moment it exists for.
    //
    // On the target rather than merely on its feet, so it cannot be used to
    // shake them off: putting down in a street on the way across the district
    // is not arriving anywhere, and the level that is *about* the crows ends
    // at a line with nothing to land on at all.
    // Put away when the talking starts, not when the feet touch down.
    //
    // Arriving used to end it, and it ended it too early: he lands on the
    // trapper's roof with eight crows still over the street he has just
    // crossed, and they vanished on the tick his feet touched. What the
    // arrival is owed is that they stop being a *danger* -- and that is a
    // separate rule, below, about a bird on foot. They can wheel up there
    // until she says something.
    if (hunted && talkingTo) hunted = false;
    // No collider, on purpose, and it is the fix for a visible bug: the
    // crows were flying into buildings and being respawned fifty metres
    // away, which on the minimap is a dot that jumps every few seconds.
    //
    // They mill at forty-five metres over Népszínház utca and a tenth of the
    // buildings under them are fifty -- so they were not clipping the odd
    // roof, they were ploughing into a wall every few seconds. Raising them
    // out of it is not available: forty-five is the corridor the player is
    // released into at sixty and glides down through, and the whole level is
    // "get underneath them".
    //
    // So a crow is a threat rather than a body. It already stops being a
    // flown bird the moment it has seen you -- a hunting one is moved
    // straight at its quarry rather than flown, see `hunt` -- and this is the
    // same admission about the rest of the time. What it costs is a crow
    // passing through a tower now and then; what it buys is eight crows that
    // stay where they are.
    if (hunted) crows?.update(TICK, undefined, wind, doing !== 'dead');
    // And if one of them gets to him, that is the flight. It is checked after
    // they have moved rather than before, so the tick a crow arrives is the
    // tick it counts -- and only against a bird that is still flying, since
    // catching a corpse is not an event.
    // And only against a bird in the air. A crow takes a pigeon on the wing;
    // one standing on a roof three metres from the person who traps them is
    // in a different kind of trouble, and being carried off by a crow at the
    // end of the search would be the story losing to the simulation.
    if (
      hunted &&
      crows &&
      bird.ending === null &&
      !isPerched(bird) &&
      crows.touching(bird.position, CROW_TOUCH)
    ) {
      caught(bird);
    }
    for (const hound of dogs) hound.update(TICK);
    for (const crowd of crowds) crowd.update(TICK, solid, wind);
    if (waymarks.update(bird.position.x, bird.position.z)) {
      markedAt = clock;
      waymark.show(waymarks.at, waymarks.next);
      paintWayline();
    }
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
  if (wasAlive && hasCrashed(bird)) {
    outcome.show(bird.ending!);
    // The attitude it died in, kept for the camera. A body knocked out of the
    // air tumbles, and the boom hangs off the bird's own quaternion -- so
    // followed literally, the shot would roll end-over-end with the corpse
    // all the way to the pavement. What the player wants to watch is the bird
    // turning, which means the camera has to be the thing that does not.
    dyingAttitude = { ...bird.orientation };
  }

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

  const stance = stanceOf(bird, talkingTo !== null);
  // Read off the same controls the flight model was given, so the wings show
  // what the bird was actually told rather than what the keyboard says: a
  // dead bird takes no input, and its wings are not held in any shape.
  const holding = asFlight(input.controls, stance);
  const wings: WingPose =
    stance === 'dead'
      ? 'dead'
      : isPerched(bird)
        ? 'perched'
        : holding.brake
          ? 'braking'
          : holding.tuck
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
  // Somebody talking, or somebody talking to himself. The second is the same
  // panel in the same place: a monologue is a conversation with one speaker,
  // so it is shown as one, in his own colour, with nothing to say back.
  talkPanel.show(
    talkingTo || waiting ? talk : null,
    { them: talkingTo?.voice ?? hero, you: hero },
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
  // The one mark that is up, which on a level ending at a line is the line
  // itself -- see `markedRoute`. Read here rather than at the panel, because
  // two things want it: what the map draws, and which way the level wants
  // him pointed.
  const steering = waymarks.at;
  // Where the level wants him, whether or not it is a thing with a marker
  // over it. A level that ends at a line has no marker on purpose, and it is
  // exactly those the player gets turned round on.
  const aimingAt = aim
    ? { x: aim.position.x, z: aim.position.z }
    : steering
      ? { x: steering.x, z: steering.z }
      : null;
  // Talking the approach down, which is a command rather than a caution: the
  // level has put a target in front of you and you are near it. The two
  // verdicts come off the landing rule itself, so the panel and the ground
  // cannot disagree about what "too fast" means.
  const settling =
    bird.ending === null && toGo <= 150 ? landingReadiness(bird, flightParams) : null;


  // The moment, as every message sees it. One record, built once a frame, and
  // the only thing any of them is allowed to ask about the world -- see
  // `Moment`. What decides whether a thing is on screen lives in
  // `messages.ts` beside the words it decides for, rather than in five
  // mechanisms that each knew a different corner of the game.
  const moment: Moment = {
    level: LEVELS[level]?.name ?? '',
    teaching: tutorial,
    since: clock - startedAt,
    altitude: telemetry.altitude,
    airspeed: telemetry.airspeed,
    climb: telemetry.climbRate,
    stamina: bird.stamina,
    stalled: telemetry.stalled,
    // Two thirds of the way to the stall: enough of an angle that the wing is
    // working hard and more of it would buy nothing.
    noseUp: telemetry.angleOfAttack > flightParams.stallAngle * 0.65,
    flown: run.stats.distance,
    toGo,
    // How far off the way to the target he is pointing. The bearing to it
    // against the way he is facing, folded into 0 to 180 so that "more than a
    // right angle" is the whole of the reading.
    offCourse: aimingAt
      ? Math.abs(headingError(heading(bird), bearing(bird.position, aimingAt))) * (180 / Math.PI)
      : Infinity,
    // How long the mark in front of him has been the mark in front of him.
    // Infinity once they have all been passed, which is what says there is
    // nothing to be told about.
    sinceMark: waymarks.at ? clock - markedAt : Infinity,
    // Only where there is something marked to put down on. A level that ends
    // at a line has nothing to land on, so nothing should be talking anybody
    // down -- and a bird sinking towards a marked roof is doing as it was
    // asked, so it should not be told it is in trouble.
    landing: aim ? toGo : Infinity,
    perched: isPerched(bird),
    // Down on the thing the level was aiming at, rather than down somewhere.
    // The same reach the level itself is finished by, so the panel and the
    // level cannot disagree about whether you have arrived.
    onTarget: isPerched(bird) && toGo <= ARRIVED_WITHIN,
    crashed: hasCrashed(bird),
    blocked: onFoot.blocked,
    // The landing rule's own verdicts rather than thresholds restated here,
    // so what the panel says is what the ground will say a moment later.
    // Nothing is wrong with an arrival that is not happening: out of range of
    // anywhere to land, neither of these is asked.
    tooFast: settling !== null && !settling.speedOk,
    tooHard: settling !== null && !settling.sinkOk,
    hunted:
      hunted &&
      bird.ending === null &&
      (crows?.members ?? []).some((crow) => crow.hunting && crow.down <= 0),
    answering: midSentence(),
    leaving: finished && talkingTo !== null && !midSentence(),
    held: waiting !== null,
    talking: talkingTo !== null,
    watching: cutscene !== null,
    // Named as the panel draws them, and turned into keyboard codes by the
    // one mapping that also draws the caps: see `codesOf`.
    down: (keys) => input.anyDown(codesOf(keys)),
    voice: voiceNote && clock - voiceNote.at < NOTICE ? voiceNote.said : null,
    speaking: languageNow(),
  };

  // An audience is not told which key to press, and a beat that is being held
  // is the story talking -- so the only thing offered over one is the key
  // that leaves it. Everything else judges itself: see `MESSAGES`.
  const saying = tipStack.update(
    moment.watching ? [] : moment.held ? MESSAGES.filter((m) => m.id === 'takeOff') : MESSAGES,
    moment,
    clock,
  );
  // Over the conversation card when there is one. Its height is asked for
  // rather than guessed at: the four-line exchange at the loft is twice the
  // two-line one on the branch, and the instruction has to clear both.
  tipPanel.show(saying, talkPanel.height());
  // The cage, while thirty birds are working at it. Shown from the moment the
  // first of them reaches it rather than from the moment they arrive: before
  // that there is nothing happening to it, and a full bar sitting there is a
  // bar that has not started.
  gauge.show(rescue && rescue.started && !rescue.broken ? PHRASES.cage : null, rescue?.health ?? 1);
  // A note when the newest instruction changes, saying what kind it is: see
  // `Tip.sort`. Compared here rather than inside the panel, because a sound is
  // not drawing -- and the panel is asked what to show sixty times a second.
  const newest = saying[saying.length - 1] ?? null;
  const words = newest ? read(newest.text) : null;
  if (words !== null && words !== announced) cue.sound(newest?.sort ?? 'hint');
  announced = words;
  // Only the critical ones are said aloud. A voice that reads every
  // instruction is a voice that gets turned off, and then it is not there for
  // the one that mattered.
  voice.update(newest?.spoken ? newest : null, clock);
  // And the two-tone warning, driven by the crow rather than by the panel.
  //
  // The panel holds one thing at a time, so a lesson or a landing call can be
  // standing in front of the words `Crows locked on!` -- and the sound is
  // exactly the part that must not wait its turn. It is a warning about
  // something happening now, not a reading of what is on screen.
  if (moment.hunted && !moment.perched) alarm.sound(clock);
  // And the city, which is mostly quiet. Gathered on its own slow beat and
  // offered every frame: what to play and how rarely is the ambience's own
  // business -- see `createAmbience`.
  if (clock - heardAt >= LISTEN_EVERY) {
    audible = listen();
    heardAt = clock;
  }
  ambience.hear(clock, interpolatedState.position, heading(interpolatedState), audible);
  world.updateSmoke(allPuffs, camera.quaternion);
  // The thrown grain, and the grain riding on the freight train. One list,
  // one instanced mesh: the seeds on the wagons are worked out from where the
  // wagons now are, which is why they cannot simply be placed once.
  //
  // Only while the rake is near enough to be laid out exactly -- a distant
  // train keeps whatever pose it was last put in, and grain drawn from a pose
  // that is a second old sits beside the wagon rather than on it. Nothing is
  // lost: at that range a seed is well under a pixel.
  const riding = near[FREIGHT] ? WAGON_GRAIN : [];
  const rake = layout.trains[FREIGHT];
  world.updateSeeds([
    ...(scatter ? scatter.seeds : []),
    ...riding.flatMap((grain) => {
      const wagon = rake?.vehicles[grain.car];
      if (!wagon) return [];
      const at = onVehicle(wagon, grain.along, grain.across);
      return [{ x: at.x, y: stockTop(wagon.kind) + SEED_SIZE / 2, z: at.z }];
    }),
  ]);

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
  //
  // A bird waiting its turn to be let out is not in the air, and should not be
  // standing on the wagon either -- and a level that has not asked for an
  // escort has none, whatever the flock is frozen in the middle of.
  const seen = flock.members.map(
    (member) => escorted && member.down <= 0 && sighted(member.state.position, sight),
  );
  // Her, on the level where the flock is one bird and the bird is her. Always
  // the first of them, because only a flock of one can be somebody.
  const hersAt = LEVELS[level]?.flockIs === PINK.name ? 0 : null;
  // Answered for every rig at once rather than a bird at a time: written
  // inside the loop, the twenty-nine birds that are not her set her rig back
  // to invisible after the one that is had turned it on, and she was never
  // drawn at all. See `escortDrawn`.
  const drawn = escortDrawn(seen, hersAt);
  herRig.object.visible = drawn.her;

  flock.members.forEach((member, i) => {
    const shown = seen[i]!;
    const hers = i === hersAt;
    flockRigs[i]!.object.visible = drawn.flock[i]!;
    if (!shown) return;
    (hers ? herRig : flockRigs[i]!).update(
      member.state,
      // Three poses rather than two, now that a flock can arrive. One that
      // made a mess of the landing is lying on the roof, and drawing it
      // gliding would be a corpse in a flying pose -- which never came up
      // while the only thing a flock did was wheel about, because a bird that
      // hit something was taken away and let out again.
      isPerched(member.state) ? 'perched' : hasCrashed(member.state) ? 'dead' : 'gliding',
      frameTime,
    );
  });

  (crows?.members ?? []).forEach((crow, i) => {
    const rig = crowRigs[i];
    if (!rig) return;
    // Not drawn where the level says there are none: a crow standing still
    // in the sky because nothing is updating it is worse than no crow.
    const shown = hunted && crow.down <= 0 && sighted(crow.state.position, sight);
    rig.object.visible = shown;
    if (shown) rig.update(crow.state, isPerched(crow.state) ? 'perched' : 'gliding', frameTime);
  });

  waymark.update(now);
  // The cage coming apart, if it is.
  cage.update(frameTime);

  // And the thirty who came to do it. Drawn from their own states rather than
  // stepped here: `rescue.update` walks them in the tick loop, the same as
  // everything else that moves.
  rescue?.helpers.forEach((helper, i) => {
    const rig = helperRigs[i];
    if (!rig) return;
    const shown = sighted(helper.state.position, sight);
    rig.object.visible = shown;
    // Wings out while it is still coming down, and feet under it once it is
    // there. The pose is the only thing that says which of the two is
    // happening: they are the same bird in the same place a second apart.
    if (shown) rig.update(helper.state, helper.doing === 'coming' ? 'gliding' : 'perched', frameTime);
  });

  dogs.forEach((hound, i) => {
    const rig = dogRigs[i];
    if (!rig) return;
    const shown = sighted(hound.pose, sight);
    rig.object.visible = shown;
    if (shown) rig.update(hound.pose);
  });

  // The birds on the freight train. Their whole state is where their wagon
  // is, so it is worked out here rather than stepped: no flight model, no
  // walk model, nothing to go wrong at the end of the line.
  riders.forEach((rider, i) => {
    const drawn = riderRigs[i];
    const wagon = layout.trains[FREIGHT]?.vehicles[rider.car];
    if (!drawn || !wagon) return;
    const at = onVehicle(wagon, rider.along, rider.across);
    const shown =
      !ridersFlown &&
      near[FREIGHT] &&
      sighted({ x: at.x, y: stockTop(wagon.kind), z: at.z }, sight);
    drawn.rig.object.visible = shown;
    if (!shown) return;

    drawn.state.position = vec(at.x, stockTop(wagon.kind) + defaultParams.bodyRadius, at.z);
    // Turned in the wagon's frame and then with it, so a bird looking along
    // the train goes on looking along the train round a curve.
    rider.facing += rider.turning * frameTime;
    drawn.state.orientation = quatFromAxisAngle(vec(0, 1, 0), -(wagon.yaw + rider.facing));
    drawn.rig.update(drawn.state, 'perched', frameTime);
  });

  crowds.forEach((crowd, group) => {
    crowd.birds.forEach((pigeon, i) => {
      const rig = crowdRigs[group]?.[i];
      if (!rig) return;
      const shown = sighted(pigeon.state.position, sight);
      rig.object.visible = shown;
      if (!shown) return;
      rig.update(pigeon.state, isPerched(pigeon.state) ? 'perched' : 'gliding', frameTime);
    });
  });

  for (const resident of residents) {
    const shown = resident.here && sighted(resident.state.position, sight);
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
  } else if (dyingAttitude && bird.ending?.settled === false) {
    // Following a body that is tumbling, so the camera is handed the attitude
    // the bird died in rather than the one it is spinning through. Same
    // position, same easing; it just does not roll with the corpse.
    chase.update(
      { ...interpolatedState, orientation: dyingAttitude },
      activeCamera,
      frameTime,
    );
  } else {
    // Riding whatever it is standing on, if it is standing on anything. A
    // perch that moves -- a tram, a wagon -- is not something the camera
    // should be easing against: see `ChaseCamera.update`.
    chase.update(interpolatedState, activeCamera, frameTime, isPerched(bird));
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
    // Whether the wings tire at all, which two things can settle: the level,
    // for the one flight that is about looking rather than flying, and the
    // mode, since the beginner's one charges nothing for flying.
    mode.tires && !LEVELS[level]?.tireless,
  );
  // The same things the world is showing -- what is aimed at and the one mark
  // that is up -- seen from above and turned so forward is up. Read off the
  // same places the world reads them from, so the map cannot disagree with
  // the thing it is a map of.
  //
  // One mark, and it is drawn as whatever it is: a place gets a pip and a
  // line gets a line. The map used to draw the level's finishing line for the
  // whole level as well, which put two blue stripes on the panel at once with
  // nothing to say which was the next step and which was the end of the
  // flight. The finishing line is the last mark on the route now -- see
  // `markedRoute` -- so it comes up when it is the thing to fly at.
  minimap.update({
    at: interpolatedState.position,
    heading: heading(interpolatedState),
    // Whatever finishes the level, which is not always a thing with a marker
    // over it. A level that ends at a line has no target to point at on
    // purpose -- there is nothing to land on, so the arrow in the world is
    // down -- and it is exactly those levels the player is most lost on: the
    // stripe is painted on the ground nine hundred metres away, behind a
    // building. So the map points at the line's own crossing point, which is
    // the spot the level is asking you to fly through.
    // Whatever finishes the level, which is not always a thing with a marker
    // over it. A level that ends at a line has no target to point at on
    // purpose -- there is nothing to land on -- and on those the route's own
    // marks are what the map has to say instead.
    // Whatever finishes the level, which is not always a thing with a marker
    // over it. A level that ends at a line has no marker on purpose -- there
    // is nothing to land on -- and on those it is the line's own crossing
    // point that gets pointed at, so the panel's rim arrow says which way to
    // fly. Without it those levels said nothing at all until the line came
    // inside the panel's three hundred metres, which on Fiumei út is most of
    // the way there.
    target: aim
      ? { x: aim.position.x, z: aim.position.z }
      : steering?.across
        ? { x: steering.x, z: steering.z }
        : null,
    mark: steering && !steering.across ? { x: steering.x, z: steering.z } : null,
    // Whatever rolling stock is near enough to be on the panel. Filtered by
    // the head of each rake rather than by every vehicle: a hundred and
    // twenty-five trains is a hundred and twenty-five distance checks a
    // frame, and six hundred and twenty-five is not.
    stock: layout.trains.flatMap((train) => {
      const head = train.vehicles[0];
      // One that has run out of line is off the map altogether, and its
      // vehicles are still standing wherever it last was. Drawn, it would be
      // a tram parked at the end of the track -- which is exactly the thing
      // the player was seeing and that is no longer there.
      if (!head || train.gone) return [];
      const away = Math.hypot(head.x - interpolatedState.position.x, head.z - interpolatedState.position.z);
      // The whole consist behind the head, in a straight line, which errs
      // towards drawing a rake whose tail is just off the panel.
      if (away > MINIMAP_REACH + consistLength(train.cars, train.stock)) return [];
      return train.vehicles.map((car) => ({
        x: car.x,
        z: car.z,
        yaw: car.yaw,
        length: car.length,
        width: car.width,
        kind: car.kind,
      }));
    }),
    // The flock as it really is, not as it is drawn: `escortDrawn` asks
    // whether the camera can see a bird, and a bird the camera cannot see is
    // exactly the one the map is there for.
    flock: escorted
      ? flock.members.flatMap((member, i) =>
          member.down > 0 || i === hersAt
            ? []
            : [{ x: member.state.position.x, z: member.state.position.z }],
        )
      : [],
    // And her, wherever she is worth marking.
    her: hersDot(hersAt),
    // Only the ones actually in the air on a level that has them. The flock
    // of crows exists all game and is held down on the twelve levels that are
    // not about it, so drawing the members without asking would put eight
    // dots over Népszínház utca on every level in the game.
    crows: hunted
      ? (crows?.members ?? []).flatMap((crow) =>
          crow.down > 0 || crow.state.ending !== null
            ? []
            : [{ x: crow.state.position.x, z: crow.state.position.z }],
        )
      : [],
    now: clock,
    line: steering?.across ?? null,
  });
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
