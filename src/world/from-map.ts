/**
 * Build a world from a real street network.
 *
 * The streets are real; the buildings are not. What makes this neighbourhood
 * recognisable from the air is not which building is which, but that it is
 * built in *perimeter blocks*: one continuous building running right round the
 * block, six or seven floors of it, with a courtyard in the middle. Rows of
 * separate houses along a road cannot produce that, however carefully they are
 * placed, because nothing in a row knows the block is a closed shape.
 *
 * So the block comes first. The streets are traced into the polygons they
 * enclose, each polygon is pulled in to the kerb, and a wing of building is
 * laid around the inside of it. The courtyard is whatever is left in the
 * middle, which is also where the gardens go.
 */

import { aabb, turnedBox, type Box } from '../sim/collision';
import {
  bakedPlans,
  bakedPoints,
  indexStreets,
  type MapData,
  type Rail,
  type StreetIndex,
} from './streets';
import { footprintSamples, indexAreas, type AreaIndex } from './areas';
import { crowdOn } from './waiting';
import { DECK, deckOf } from './bridges';
import { fitBoxes, orientedBox, solidsOf } from './plans';
import { fillHeights } from './heights';
import { extractBlocks, type Block } from './blocks';
import {
  distanceToEdges,
  pointInPolygon,
  polygonCentroid,
  type Point2,
} from './polygon';
import {
  CAR,
  penthouseOf,
  peopleOn,
  plantTerrace,
  pointOn,
  PUMP,
  PERSON_HEIGHT,
  PERSON_WIDTH,
  SPECIES,
  STREET_TREE,
  type Footprint,
  type Sign,
  type Platform,
  SHELTER,
  shortStop,
  type TramStop,
  type Steeple,
  type Building,
  type Bush,
  type Grave,
  type CityLayout,
  type Crossing,
  type Landmark,
  type Person,
  type Tree,
} from './layout';
import {
  chainageOf,
  consistLength,
  layOutTrain,
  directionFor,
  lineLength,
  pointAlong,
  railNetwork,
  stockRuns,
  stockTurnaround,
  traceRoute,
  type Train,
  type Stock,
} from './train';
import { departures, keepRight } from './service';
import type { Point } from './geo';

export interface MapWorldOptions {
  /** Clear space kept between the carriageway and the wall, in metres. */
  setback: number;
  /**
   * How much room to leave between facing frontages, as a multiple of the
   * carriageway and its two setbacks.
   *
   * 1 puts the walls right on the setback, which is what the street measures
   * on the map and is startlingly tight to fly down -- a residential road here
   * is 8 m of carriageway, so the gap between facades was 12 m and the wings
   * nearly touched it. 2 leaves a street a pigeon can get down.
   */
  streetRoom: number;
  /**
   * How deep the wing of a perimeter block is, from street wall to courtyard.
   *
   * It used to be the one number that decided how much of a block was built
   * on, back when the buildings were invented. They come off the map now and
   * are whatever depth they are; what this still decides is whether the middle
   * of a block is a courtyard worth planting or a yard too small to bother
   * with, and how far from a kerb is far enough to be *behind* the buildings
   * rather than in the street.
   *
   * Around 16 m is a staircase and two rooms either side of it, which is what
   * these blocks actually are.
   */
  wingDepth: number;
  /**
   * A courtyard smaller across than this is not worth leaving, and the block
   * is built solid instead. Small blocks in this district really are solid.
   */
  minCourtyard: number;
  /**
   * Ignore faces outside this range of ground area, in square metres.
   *
   * Below the minimum they are not blocks but the triangles left at skew
   * junctions: around 90% of each one is under the carriageway, and dropping
   * the threshold to pick up the rest was measured and changed nothing, since
   * what is left of one is a few dozen square metres.
   */
  minBlockArea: number;
  maxBlockArea: number;
  /** Grid the trees are scattered on, in metres. */
  spacing: number;
  /**
   * How thickly to plant, in trees per hectare.
   *
   * A density rather than a chance per candidate, because a chance per
   * candidate quietly means something different every time the scattering grid
   * changes: tightening `spacing` alone would otherwise turn a park into a
   * thicket without anyone touching the planting.
   */
  parkTrees: number;
  /** The same, for courtyards. Thicker: these are gardens, and small. */
  gardenTrees: number;
  /**
   * Whether to plant any of them.
   *
   * On. It was turned off once, to see what the district looked like with
   * only the trees somebody had actually recorded standing in a street: 763
   * of them against 12,656. The answer is that OpenStreetMap maps street
   * trees well and park trees hardly at all, so "only what is on the map"
   * comes out as lines of trees along a few roads and a cemetery of bare
   * grass -- and the cemetery is a level.
   *
   * Kept as a switch because the question was worth being able to ask again,
   * and because the answer is a decision rather than a fact.
   *
   * It does not stop the walk over the ground, only the tree at the end of
   * it. The same walk lays the gravestones in the cemetery, and turning the
   * trees off must not empty the burial ground.
   */
  inventsTrees: boolean;
  seed: number;
  /**
   * Described things to place before anything is generated around them.
   *
   * Put down first and reserved, so a house is never built through the loft
   * and a tree is never planted on the concrete. That order is the whole
   * point: generation gives way to description rather than the other way
   * round, which is what lets a level name a thing and rely on it being
   * there and being that shape.
   */
  landmarks?: Landmark[];
  /**
   * A point inside the green area that is a cemetery, if one of them is.
   *
   * Named by a point rather than by a name, because the map has no idea: the
   * areas come off OpenStreetMap as park, wood, water or pitch, and which of
   * the parks is a cemetery is a decision about this story. The home tree
   * stands in it, so the home tree's own coordinate is what identifies it,
   * and there is nothing to keep in step.
   */
  cemetery?: { x: number; z: number };
  /** Trains to run on the track, each asked for by name of a place. */
  trains?: TrainSpec[];
  /**
   * And trains put on whatever line is left, to fill the network.
   *
   * The distinction is what a train is *for*. The rake of stake wagons in the
   * yard is a level: something names it, lands on it, and finds somebody
   * standing on it. Everything else is scenery -- a city with a hundred and
   * thirty kilometres of tramway and three trams on it reads as a model of a
   * city rather than a city.
   *
   * Scenery is asked for by the yard-full rather than one at a time, and goes
   * wherever there is room, which is why it is a different sort of request.
   */
  fill?: FillSpec[];
  /** How far from where a train was asked for a line may be, in metres. */
  trainReach: number;
}

export const defaultMapWorldOptions: MapWorldOptions = {
  setback: 2,
  streetRoom: 2,
  wingDepth: 16,
  minCourtyard: 14,
  minBlockArea: 500,
  maxBlockArea: 2000000,
  spacing: 9,
  parkTrees: 19,
  gardenTrees: 60,
  inventsTrees: true,
  trainReach: 40,
  seed: 11,
};

/** Small deterministic PRNG, so the same map always builds the same city. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TrainSpec {
  /** Somewhere near the line it should run on; the nearest one is chosen. */
  near: Point;
  /** How many vehicles behind the engine. */
  cars: number;
  /** What those are: open stake wagons by default. */
  stock?: Stock;
  /**
   * How fast it runs, in metres per second. Yard speed by default.
   *
   * Zero for one standing in a platform, which is not a special case
   * anywhere: it shuttles nowhere, and nothing it touches was moving.
   */
  speed?: number;
  /**
   * Whether it runs out of the yard, on through the switches at the end of
   * the way it starts on, to wherever the track really stops.
   *
   * Off by default, which is what a shunter does: up and down one siding. A
   * train that leaves has to be told to, because following the network is a
   * different question from picking a siding -- the line worth taking is then
   * the one whose *route* is longest, not the one whose own way is.
   */
  runsOut?: boolean;
  /**
   * Which way to set off, as a compass bearing in degrees.
   *
   * Omitted, it goes up its line as drawn, which is a fact about how somebody
   * traced the way rather than about the world -- fine for a shuttle that
   * will be back, and no use at all for saying "south".
   */
  setOff?: number;
}

/**
 * A quantity of trains to spread over whatever line is unclaimed.
 *
 * No `near`: the point is that nobody cares where these are, only that the
 * network does not look abandoned.
 */
export interface FillSpec {
  /** What they are made of, which also says which sort of line they take. */
  stock: Stock;
  cars: number;
  /** How fast, in metres per second. */
  speed: number;
  /** Only take a route at least this long, in metres. */
  minRoute: number;
  /** How many routes to put a service on at most. */
  most: number;
  /**
   * Seconds between one tram and the next on the same route.
   *
   * What turns a route with a tram on it into a line with a service on it.
   * Before this there was one tram to a route however long the route was, so
   * a player standing on a street watched one go by and then waited for it to
   * run to the end of the line and all the way back -- on the longest route
   * on this map, eight and a half kilometres, that is a wait of a
   * quarter of an hour.
   *
   * Required, with no default, because it is what decides how many trams
   * exist: at ten metres a second over the hundred and eighteen kilometres of
   * route on this map, ninety seconds is a hundred and sixteen trams and two
   * minutes is eighty-three. A default would be that number chosen by
   * whoever forgot to pass it.
   */
  headway: number;
}

export interface MapWorld extends CityLayout {
  streets: StreetIndex;
  green: AreaIndex;
  /** The railways, carried through for the renderer to draw. */
  rails: Rail[];
  /** Trains standing on them, each knowing how far along its line it is. */
  trains: Train[];
  /** The blocks the streets enclose, for anything that wants the shape of one. */
  blocks: Block[];
  /** Those of them with an open middle, rather than being built solid. */
  gardens: Block[];
  /** And those with no room to build on at all, which are planted instead. */
  bare: Block[];
}

/**
 * How far a shop may be from a building and still be put on it, in metres.
 *
 * Twenty-five. Measured on this map, 85 of the 88 branded groceries and
 * filling stations stand inside a building the world draws; of the other
 * three, one is beside one and two are forecourt kiosks with nothing to stand
 * a sign on, which get none.
 */
const SIGN_REACH = 25;

/**
 * How far to look for the street a sign faces, in metres.
 *
 * Sixty: further than any frontage, and near enough that the street found is
 * the one the shop is actually on.
 */
const SIGN_STREET = 60;

/**
 * How wide a hoarding is: a share of the roof it stands on, held between two
 * ends.
 *
 * Not a fixed size, because these roofs run from 10 x 8 m to 167 x 118 -- one
 * sized for the smallest is a smudge on the largest, and one sized for the
 * largest overhangs the smallest by fifty metres. Eight metres is about as
 * narrow as a name can be and still be read at three hundred, and past
 * twenty-six a bigger one stops helping.
 */
const SIGN_WIDTH = { share: 0.6, least: 8, most: 26 };

/**
 * How a steeple is sized from the building under it.
 *
 * A rule rather than a table, so a cathedral and a wayside chapel are not the
 * same height -- and a rule rather than a random, so the same building always
 * grows the same steeple and two churches of a size share one shape.
 *
 * The tower is a share of the building's *short* side, because a nave is long
 * and thin and a tower is square. The heights are multiples of the building's
 * own, which is how a real one relates to its nave: about half as much again
 * for the masonry, and a spire about as tall as the tower is.
 */
const STEEPLE = {
  church: { across: 0.4, least: 4, most: 10, tower: 1.5, rise: 8, spire: 1.6 },
  // A chapel gets a bellcote and not a tower: a thin thing on the ridge. Ten
  // of the sixty-seven here are chapels, and a chapel with a parish church's
  // spire on it is a chapel nobody would recognise.
  chapel: { across: 0.22, least: 1.6, most: 3.2, tower: 1.05, rise: 1.5, spire: 2.2 },
  // A dome on a drum, and the drum is broad: a synagogue's dome sits over the
  // middle of the hall rather than at one end of it.
  synagogue: { across: 0.55, least: 5, most: 14, tower: 1.15, rise: 2, spire: 0.9 },
} as const;

/**
 * How near two steeples may stand, in metres.
 *
 * Thirty-five, and it is a fix rather than a taste. A church usually carries
 * both a `building=church` way and an `amenity=place_of_worship` node inside
 * it -- one church, two points -- and the outline is big and bent, so the
 * building fitter has already cut it into wings. The two points then land on
 * two different wings of the same church and it grows two spires. Measured on
 * this map: eight churches had a pair.
 *
 * Deduping on the *building* is what does not work, and deduping on distance
 * does: no two churches in this district stand within thirty-five metres of
 * each other, and both halves of one church always do.
 */
const STEEPLE_APART = 35;

/**
 * The tallest a steeple may come out, in metres.
 *
 * The height is a multiple of the building's own, and for a church the map's
 * height is often already the tower rather than the nave -- so the rule
 * compounded and produced a seventy-three metre parish church. Fifty-five is
 * about what the big ones here are.
 */
const STEEPLE_TALLEST = 55;

/**
 * A tram platform, in metres.
 *
 * `wide` is a fact about trams rather than about the map: half the platforms
 * come down as a two-node line with no width at all. Two and a half metres is
 * a Budapest island -- room to stand two deep and let a pram past.
 *
 * `clear` is what keeps the two apart. A tram body is 2.4 m, so 1.2 m from
 * the centreline is the side of the car; 1.6 m leaves a hand's width and is
 * about where a real platform edge stands. Measured on this map, four of the
 * sixty-six sit inside that -- the Baross depot yard and the island under the
 * Erzsébet királyné útja underpass, both drawn as areas that take the track
 * in -- so the near edge is *held* at this rather than trusted to it, and
 * anything that cannot be pushed clear without leaving its own line behind is
 * dropped.
 *
 * `rise` is the kerb: a step up, not a stage.
 *
 * `sheltered` is how long a platform has to be before one is drawn on it. The
 * short ones are single-ended stops in a side street with a pole and nothing
 * else.
 */
/**
 * The stop sign: a blue board, standing on the roof of the shelter.
 *
 * Reuses the shop hoardings -- same geometry, same atlas, same lettering --
 * with its own colours, because a tram stop has no chain to be recognised by
 * and the name is the whole of what it says.
 *
 * On the shelter rather than on a post of its own. A post is what a real one
 * stands on and it was the wrong answer here: from the air it is a stick, and
 * a stick holding a board over a two-and-a-half metre island reads as a
 * billboard in the road. On the roof it is part of the one thing on the
 * island that is already a shape, and it is three metres higher up.
 *
 * A platform with no shelter gets no board. There are three of those, all of
 * them under twenty-five metres long, and a stop that short has a flag on a
 * pole in real life -- which is not something to see from the air either.
 *
 * `wide` is a little under the shelter's own length, so the board sits on it
 * rather than overhanging.
 */
const STOP_SIGN = {
  wide: 4.2,
  paint: { ground: '#0b4ea2', ink: '#ffffff' },
};

const PLATFORM = {
  wide: 2.5,
  clear: 1.6,
  rise: 0.25,
  sheltered: 30,
  perShelter: 45,
  shove: 4,
  /** How many people are waiting on one: a few, never none, never a crowd. */
  waiting: { least: 1, most: 5 },
};

/**
 * How far from a running line a platform still belongs to it, in metres.
 *
 * Twelve. Wide enough to take in the far track of a pair -- an island stands
 * between the two directions and serves both, so a tram on either stops at
 * it -- and narrow enough that a platform on the next street along is not
 * something to pull up for.
 */
const PLATFORM_SERVED = 12;

/** What the map's numbers mean, in the order `worshipKind` writes them. */
const WORSHIP_KINDS = ['church', 'chapel', 'synagogue'] as const;

export function buildLayoutFromMap(
  map: MapData,
  options: MapWorldOptions = defaultMapWorldOptions,
): MapWorld {
  const streets = indexStreets(map.roads);
  // The widest carriageway on the map, which is how far a street query has to
  // reach before the answer stops being able to change. Taken from the data
  // rather than written down, so a map with a motorway on it still works.
  const widestRoad = map.roads.reduce((widest, road) => Math.max(widest, road.width), 0);
  // A railway is a line with a width and a corridor to keep clear, which is
  // exactly what the street index already answers questions about. Same index,
  // different question.
  //
  // Two of them, because a building and a tree are not asking the same
  // question. A tram is laid in the carriageway and owns no ground of its
  // own: the street it runs down is already clear of buildings, so a tram has
  // nothing left to keep clear -- and counting one as a railway deleted every
  // real building whose outline a tram alignment happened to clip. Measured:
  // 48 buildings, fifteen hectares of floor plate, among them one 150 x 146 m
  // and one 224 x 78. The Lidl on Nagyvárad tér was one of them, which is how
  // it was found -- a shop that had lost its shop.
  //
  // A tree is the other way round. It is planted in a block or a park rather
  // than on a street, so nothing else keeps it out of a tramway, and dropping
  // trams from the question put 155 of them in the four-foot. What keeps a
  // building off is the road; what keeps a tree off is this.
  const tracks = indexStreets((map.rails ?? []).filter((rail) => rail.kind !== 'tram'));
  const anyTrack = indexStreets(map.rails ?? []);
  const green = indexAreas(map.areas ?? []);
  /** How many of a cemetery's plantings are a stone rather than a tree. */
  const GRAVE_SHARE = 1 / 3;
  // The one green area that is a cemetery, found once by the point that says
  // so. Identity rather than geometry from here on: a tree is in the
  // cemetery when the ground under it is *that* area.
  const burial = options.cemetery ? green.at(options.cemetery.x, options.cemetery.z) : null;
  const graves: Grave[] = [];

  /**
   * Does anything here sit on the railway?
   *
   * Sampled across the footprint rather than measured from the middle: a
   * corridor 8 m wide crossing a 26 m frontage at an angle passes nowhere near
   * the centre of it. The step is finer than the corridor is wide, so a track
   * cannot thread between two samples.
   */
  const laidOn = (
    index: StreetIndex,
    x: number,
    z: number,
    width: number,
    depth: number,
    yaw: number,
  ) => {
    // Almost nothing on the map is anywhere near a railway, so ask the cheap
    // question first: is there track within reach of this footprint at all?
    const span = Math.hypot(width, depth) / 2;
    if (!index.nearest(x, z, span + 8)) return false;
    return footprintSamples(x, z, width, depth, yaw, 3).some(([sx, sz]) => {
      const rail = index.nearest(sx, sz, 40);
      return rail !== null && rail.distance < rail.width / 2;
    });
  };

  /** Is this building standing on a running line? Heavy rail only. */
  const onTrack = (x: number, z: number, width: number, depth: number, yaw: number) =>
    laidOn(tracks, x, z, width, depth, yaw);

  /** Is this tree standing in the four-foot? Any rails, a tramway included. */
  const inTheFourFoot = (x: number, z: number) => laidOn(anyTrack, x, z, 3, 3, 0);

  const rand = mulberry32(options.seed);

  const buildings: Building[] = [];
  const plans: Footprint[] = [];
  const trees: Tree[] = [];
  const boxes: Box[] = [];

  // --- Landmarks ------------------------------------------------------------
  // First, before anything is worked out from the map, because everything
  // that follows has to give way to them rather than the other way round.
  const landmarks: Landmark[] = (options.landmarks ?? []).map((landmark) => ({ ...landmark }));
  const bushes: Bush[] = [];
  const people: Person[] = [];
  for (const landmark of landmarks) {
    // Whoever is standing on it, or beside it. Before the height test rather
    // than after it: a patch of concrete is a described thing with nothing to
    // fly into, and somebody standing next to one is still somebody.
    for (const person of peopleOn(landmark)) {
      people.push(person);
      // Solid, and for the same reason a tree is: two metres of somebody is
      // something to fly round, not something to fly through.
      boxes.push(
        aabb(
          person.x - PERSON_WIDTH / 2,
          person.base,
          person.z - PERSON_WIDTH / 2,
          person.x + PERSON_WIDTH / 2,
          person.base + PERSON_HEIGHT,
          person.z + PERSON_WIDTH / 2,
        ),
      );
    }

    // A petrol station is reserved ground with things standing on it rather
    // than one solid thing filling it: the forecourt is somewhere to fly
    // through, and the hut, the pump and the car are what you cannot.
    if (landmark.station) {
      const { hut, pump, car } = landmark.station;
      const turn = landmark.yaw ?? 0;
      const shed = pointOn(landmark, hut.along, hut.across);
      boxes.push(turnedBox(shed.x, shed.z, hut.width, hut.height, hut.depth, turn + hut.facing));

      const island = pointOn(landmark, pump.along, pump.across);
      boxes.push(
        turnedBox(island.x, island.z, PUMP.width, PUMP.height, PUMP.depth, turn + pump.facing),
      );

      const parked = pointOn(landmark, car.along, car.across);
      boxes.push(
        turnedBox(parked.x, parked.z, CAR.length, CAR.height, CAR.width, turn + car.facing),
      );
      continue;
    }

    if (landmark.height <= 0) continue;

    // Deliberately not pushed into `buildings`. A described thing is not one
    // of the generated crowd: it is not drawn with them, it gets no pitched
    // roof, and the ground it takes is kept clear by `reserved` below, which
    // is a wider rule than overlapping a footprint. Leaving it out is what
    // stops the renderer having to find it again by matching coordinates.
    if (landmark.canopy) {
      // A tree is solid where a tree is: the crown, and the trunk holding it
      // up. Not one box from the ground, which is what a building gets --
      // that would wall off the whole space under the canopy, and the space
      // under a canopy is somewhere you can fly.
      const { trunk, skirt } = landmark.canopy;
      const crown = turnedBox(
        landmark.x,
        landmark.z,
        landmark.width,
        landmark.height,
        landmark.depth,
        landmark.yaw ?? 0,
      );
      crown.minY = Math.max(0, landmark.height - skirt);
      boxes.push(crown);
      boxes.push(
        turnedBox(landmark.x, landmark.z, trunk, crown.minY, trunk, landmark.yaw ?? 0),
      );
    } else {
      boxes.push(
        turnedBox(
          landmark.x,
          landmark.z,
          landmark.width,
          landmark.height,
          landmark.depth,
          landmark.yaw ?? 0,
        ),
      );
    }

    // The penthouse is boxed from the ground rather than from the terrace it
    // stands on. The union is the same solid either way, and a box that
    // starts where every other box starts needs no new idea of a box.
    const penthouse = penthouseOf(landmark);
    if (penthouse) {
      boxes.push(
        turnedBox(
          penthouse.x,
          penthouse.z,
          penthouse.width,
          penthouse.top,
          penthouse.depth,
          penthouse.yaw,
        ),
      );
    }

    for (const bush of plantTerrace(landmark)) {
      bushes.push(bush);
      // Solid, like a tree. A bush you can fly through is scenery, and the
      // rows are laid to leave the middle of the terrace open precisely so
      // that being solid costs the landing nothing.
      boxes.push(
        aabb(
          bush.x - bush.radius,
          bush.base,
          bush.z - bush.radius,
          bush.x + bush.radius,
          bush.base + bush.height,
          bush.z + bush.radius,
        ),
      );
    }
  }

  /**
   * Whether a point is on ground a landmark has taken, plus its margin.
   *
   * Tested in the landmark's own frame, so a turned one is the rectangle it
   * is rather than the larger square its world bounds describe -- the same
   * treatment `built` gives a house.
   */
  function reserved(x: number, z: number, clearance = 0): boolean {
    return landmarks.some((landmark) => {
      const turn = -(landmark.yaw ?? 0);
      const dx = x - landmark.x;
      const dz = z - landmark.z;
      const along = dx * Math.cos(turn) + dz * Math.sin(turn);
      const across = -dx * Math.sin(turn) + dz * Math.cos(turn);
      const room = (landmark.margin ?? 0) + clearance;
      return (
        Math.abs(along) <= landmark.width / 2 + room &&
        Math.abs(across) <= landmark.depth / 2 + room
      );
    });
  }
  const gardens: Block[] = [];
  const bare: Block[] = [];

  /**
   * The real buildings, where the map has any.
   *
   * The generator's whole job was to invent a city that looked like one, and
   * it did it well: frontages along the block edges, mitred at the corners,
   * with a courtyard behind. What it could not do is be *this* city. Every
   * house it placed was a plausible house in a plausible place, and the whole
   * came out as a European district that could have been anywhere.
   *
   * With the outlines baked into the map there is nothing left to invent. The
   * shape a building arrives in is the shape the game already used --
   * `{x, z, width, depth, yaw}` -- so nothing downstream knows the difference:
   * the same collision boxes, the same instanced mesh, the same roofs.
   */

  // The outlines the map drew, which are what gets built and what gets drawn.
  //
  // One outline is one building. The boxes below it are the collider's
  // business -- a courtyard block is fitted as a wing along each side rather
  // than as one slab over the hole -- but the decisions are taken per
  // building, because half a church kept and half deleted is not a thing.
  const fromMap = bakedPlans(map.plans);
  const sited = fromMap.map((plan) => {
    const box = orientedBox(plan.ring);
    return { plan, box };
  });

  // Worked out over the whole set before any of it is filtered, because a
  // building the story or a railway takes out is still evidence about the
  // height of the ones left standing.
  //
  // On a stream of its own rather than on `rand`. Filling the heights asks
  // for a number once per building that has to be guessed at, and taking
  // those off the world's own stream would mean every tree, bush and parked
  // car in the district moved the next time a mapper recorded a storey count
  // somewhere in Jozsefvaros.
  const heights = fillHeights(
    sited.map(({ plan, box }) => ({ x: box?.x ?? 0, z: box?.z ?? 0, height: plan.height })),
    mulberry32(options.seed + 1),
  );

  for (const [index, { plan, box }] of sited.entries()) {
    if (!box) continue;
    const footprint = footprintSamples(box.x, box.z, box.width, box.depth, box.yaw, 4);

    // The story wins. A described thing -- the loft, the home tree, a square
    // with a name -- keeps its ground against a real building exactly as it
    // kept it against an invented one, because a level that names a building
    // cannot have a block of flats standing through it.
    if (footprint.some(([sx, sz]) => reserved(sx, sz))) continue;

    // And nothing across a railway. There is little of this in real data --
    // it is mostly platform canopies and signal boxes -- but the goods yard
    // has to stay a goods yard.
    if (onTrack(box.x, box.z, box.width, box.depth, box.yaw)) continue;

    // Its own height where the map gave one, and its nearest neighbour's
    // where it did not -- see `heights.ts` for why that is better than the
    // 16-to-24 the generator used to invent, which stood two thirds of the
    // district about forty per cent too tall.
    const height = heights[index]!;

    // Drawn as the ring the map drew.
    plans.push({ ring: plan.ring, height });

    // Flown into as the shape it is: a slab for every wall of the outline and
    // enough behind them to stand on. See `solidsOf` -- this is the one thing
    // that has to agree with what is drawn, because disagreeing with it is
    // being killed by a building that is not there.
    for (const solid of solidsOf(plan.ring)) {
      boxes.push(turnedBox(solid.x, solid.z, solid.width, height, solid.depth, solid.yaw));
    }

    // And kept as boxes as well, which is a different question: not "what can
    // I hit" but "where is a building, roughly" -- which is what a shop sign
    // is stood on and what a steeple is grown from. A rough box is the right
    // answer to that and quite the wrong one to the other.
    for (const wing of fitBoxes(plan.ring)) {
      buildings.push({
        x: wing.x,
        z: wing.z,
        width: wing.width,
        depth: wing.depth,
        height,
        yaw: wing.yaw,
      });
    }
  }

  // --- Shop signs -----------------------------------------------------------
  // Stood on the roof of whatever building the shop turns out to be in. The
  // fetch cannot do this: it has outlines, and what a sign needs is the box
  // the outline was reduced to and whether that box survived the story and
  // the railway.
  const signs: Sign[] = [];
  const CELL = 60;
  let standingOn: (x: number, z: number) => number | null = () => null;
  {
    const grid = new Map<string, number[]>();
    const cell = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
    buildings.forEach((building, index) => {
      const key = cell(building.x, building.z);
      const bucket = grid.get(key);
      if (bucket) bucket.push(index);
      else grid.set(key, [index]);
    });

    /** The building a point stands in, or the nearest one close enough. */
    const under = (x: number, z: number) => {
      const gx = Math.floor(x / CELL);
      const gz = Math.floor(z / CELL);
      let nearest: number | null = null;
      let closest = SIGN_REACH * SIGN_REACH;
      for (let ox = -1; ox <= 1; ox += 1) {
        for (let oz = -1; oz <= 1; oz += 1) {
          for (const index of grid.get(`${gx + ox},${gz + oz}`) ?? []) {
            const each = buildings[index]!;
            // Turned into the building's own frame, because a building on a
            // diagonal street is a turned box and a shop is often at one end
            // of it rather than in the middle.
            const turn = -(each.yaw ?? 0);
            const dx = x - each.x;
            const dz = z - each.z;
            const along = dx * Math.cos(turn) + dz * Math.sin(turn);
            const across = -dx * Math.sin(turn) + dz * Math.cos(turn);
            // Inside its own box wins outright, however far its middle is.
            if (Math.abs(along) <= each.width / 2 && Math.abs(across) <= each.depth / 2) {
              return index;
            }
            const away = (each.x - x) ** 2 + (each.z - z) ** 2;
            if (away < closest) {
              closest = away;
              nearest = index;
            }
          }
        }
      }
      return nearest;
    };
    standingOn = under;

    // One to a roof. Two shops in the same block of flats is common -- a
    // grocer and a filling station share a building on this map -- and two
    // hoardings on one roof reads as a mistake rather than as two shops.
    const taken = new Set<number>();
    const named = map.brands ?? [];
    for (const row of map.signs ?? []) {
      const [x, z, which] = row;
      if (x === undefined || z === undefined || which === undefined) continue;
      const brand = named[which];
      if (brand === undefined) continue;
      const index = under(x, z);
      if (index === null || taken.has(index)) continue;
      taken.add(index);
      const host = buildings[index]!;

      // Facing the street, which is what a sign is for. Where there is no
      // street near enough to face -- a shop deep inside a yard -- it looks
      // out over the building's own short side, which is the way a frontage
      // faces when there is nothing to tell it otherwise.
      const street = streets.nearest(host.x, host.z, SIGN_STREET);
      const yaw = street
        ? -Math.atan2(street.nearX - host.x, -(street.nearZ - host.z))
        : (host.yaw ?? 0) + Math.PI / 2;

      signs.push({
        brand,
        x: host.x,
        z: host.z,
        base: host.height,
        // Across the roof it stands on, and never wider than the roof: a
        // hoarding overhanging the building it is bolted to is a hoarding
        // hanging in the air.
        width: Math.min(
          SIGN_WIDTH.most,
          Math.max(SIGN_WIDTH.least, Math.max(host.width, host.depth) * SIGN_WIDTH.share),
          Math.max(host.width, host.depth),
        ),
        yaw,
      });
    }
  }

  // --- Steeples ---------------------------------------------------------------
  // On whatever building the map's place of worship turns out to be in, by
  // the same rule the signs use -- and one to a building, because a church
  // often carries both a `building=church` way and an `amenity` node inside
  // it, which is two points and one church.
  const steeples: Steeple[] = [];
  {
    const taken = new Set<number>();
    for (const row of map.worship ?? []) {
      const [x, z, which] = row;
      if (x === undefined || z === undefined) continue;
      const kind = WORSHIP_KINDS[which ?? 0] ?? 'church';
      const index = standingOn(x, z);
      if (index === null || taken.has(index)) continue;
      const host = buildings[index]!;
      // Not next to one that is already up -- see `STEEPLE_APART`.
      if (
        steeples.some(
          (up) => Math.hypot(up.x - host.x, up.z - host.z) < STEEPLE_APART,
        )
      ) {
        continue;
      }
      taken.add(index);

      const shape = STEEPLE[kind];
      // Rounded to a quarter of a metre here rather than on the way out, so
      // that everything worked out from it -- where the tower stands as well
      // as how wide it is -- agrees with the number that is finally written
      // down. Rounded afterwards, the tower could overhang the end of its own
      // nave by up to an eighth of a metre.
      //
      // The rounding is what lets two churches on much the same building come
      // out identical and share one shape; see `city.ts`, which caches on it.
      const across =
        Math.round(
          Math.min(shape.most, Math.max(shape.least, Math.min(host.width, host.depth) * shape.across)) * 4,
        ) / 4;

      // The building's long axis, in world metres. Local +X is its `width`,
      // and this map turns a local direction by (cos, -sin).
      const turn = host.yaw ?? 0;
      const long =
        host.width >= host.depth
          ? { x: Math.cos(turn), z: -Math.sin(turn) }
          : { x: Math.sin(turn), z: Math.cos(turn) };

      // Which way the street is, which decides both which end of the nave the
      // tower stands on and which way it looks. A church with its tower in
      // the back yard is a church you cannot see from the road.
      const street = streets.nearest(host.x, host.z, SIGN_STREET);
      const out = street
        ? { x: street.nearX - host.x, z: street.nearZ - host.z }
        : { x: long.x, z: long.z };

      // A tower stands at one end of the nave; a dome sits over the middle of
      // the hall. That difference is most of what tells the two silhouettes
      // apart from the air.
      const along =
        kind === 'synagogue' ? 0 : Math.max(0, Math.max(host.width, host.depth) / 2 - across / 2);
      const towards = long.x * out.x + long.z * out.z >= 0 ? 1 : -1;

      steeples.push({
        kind,
        x: host.x + long.x * along * towards,
        z: host.z + long.z * along * towards,
        yaw: -Math.atan2(out.x, -out.z),
        // Rounded to a quarter of a metre, so that two churches on much the
        // same building come out identical and share one shape between them
        // -- `city.ts` caches on exactly these three numbers.
        width: across,
        height:
          Math.round(
            Math.min(host.height * shape.tower + shape.rise, STEEPLE_TALLEST - across * shape.spire) *
              4,
          ) / 4,
        spire: Math.round(across * shape.spire * 4) / 4,
      });

      // Solid, in two parts. A tower is the tallest thing on most of these
      // blocks and a bird has to be able to hit it and stand on it -- a
      // fifty-five metre spire you fly through is worse than no spire.
      //
      // Two boxes rather than one because a spire tapers: boxed square to its
      // full height, a church would stop a bird ten metres out from a cross
      // three hundred millimetres thick. The masonry gets its own width and
      // the spire half of it, which is about the middle of a cone.
      const raised = steeples[steeples.length - 1]!;
      boxes.push(turnedBox(raised.x, raised.z, raised.width, raised.height, raised.width, raised.yaw));
      if (raised.spire > 0.5) {
        const cap = turnedBox(
          raised.x,
          raised.z,
          raised.width / 2,
          raised.height + raised.spire,
          raised.width / 2,
          raised.yaw,
        );
        cap.minY = raised.height;
        boxes.push(cap);
      }
    }
  }

  /**
   * Whether any building stands inside a block.
   *
   * Only needed where the map supplied them: the generator knows what it built
   * in a block because it counts what it pushed, and these were all placed
   * before any block was looked at.
   *
   * Asked of the buildings rather than of the ground, which is the whole
   * point. Sampling the ground says "nothing here" for the middle of every
   * courtyard block in the district -- the middle of one is a courtyard --
   * and the block would be planted as though it were an empty plot. The first
   * version of this did exactly that and put fourteen thousand trees on the
   * map, most of them inside people's houses.
   *
   * Gridded by the block's own bounds, so each block looks at the few dozen
   * buildings near it rather than at all thirteen thousand.
   */
  const blockIsBuilt = (() => {
    if (fromMap.length === 0) return () => false;
    const cell = 60;
    const grid = new Map<number, number[]>();
    const key = (cx: number, cz: number) => cx * 100003 + cz;
    buildings.forEach((building, i) => {
      const cx = Math.floor(building.x / cell);
      const cz = Math.floor(building.z / cell);
      const bucket = grid.get(key(cx, cz));
      if (bucket) bucket.push(i);
      else grid.set(key(cx, cz), [i]);
    });

    return (ring: readonly [number, number][]) => {
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const point of ring) {
        minX = Math.min(minX, point[0]!);
        maxX = Math.max(maxX, point[0]!);
        minZ = Math.min(minZ, point[1]!);
        maxZ = Math.max(maxZ, point[1]!);
      }
      for (let cx = Math.floor(minX / cell); cx <= Math.floor(maxX / cell); cx += 1) {
        for (let cz = Math.floor(minZ / cell); cz <= Math.floor(maxZ / cell); cz += 1) {
          for (const i of grid.get(key(cx, cz)) ?? []) {
            const building = buildings[i]!;
            if (pointInPolygon(building.x, building.z, ring)) return true;
          }
        }
      }
      return false;
    };
  })();

  /**
   * The painted crossings, given a bearing by the road they are on.
   *
   * The map says where they are and nothing else. Which way to paint them and
   * how wide are facts about the carriageway underneath, so they are asked of
   * the street index -- once, here, rather than every frame.
   *
   * A crossing whose road cannot be found is dropped rather than guessed at:
   * a zebra painted across nothing, at a bearing nobody chose, is worse than
   * a junction with no zebra on it.
   */
  const crossings: Crossing[] = [];
  for (const [x, z] of bakedPoints(map.crossings)) {
    const road = streets.nearest(x, z, 22);
    if (!road) continue;
    crossings.push({
      x,
      z,
      // Square across the carriageway, which is what a zebra is: the road runs
      // one way and the bars go the other.
      yaw: Math.atan2(-road.dirZ, road.dirX),
      width: road.width,
    });
  }

  /**
   * Tram platforms, squared up and pushed clear of the track.
   *
   * The map gives a line and nothing else: where the kerb runs, and for six
   * of the sixty-six a closed ring round a depot or an underpass. So the line
   * is asked for two things only -- where it is and which way it runs -- and
   * the rest is a fact about trams. See `PLATFORM`.
   *
   * Pushed rather than trusted. A platform drawn over its own track is a
   * platform a tram drives through, and no amount of care in the survey makes
   * that not happen; measuring the track and shoving the slab off it makes it
   * not happen whatever the survey says.
   */
  /**
   * Where the shelters stand on a platform of this length.
   *
   * One in the middle of a short island, and one every so often along a long
   * one: a hundred and twenty metres of platform with a single hut at the
   * midpoint is a platform nobody could shelter on. Spread evenly and kept
   * off the ends, so the last one does not hang over the ramp.
   */
  const shelteredAt = (along: number): number[] => {
    if (along < PLATFORM.sheltered) return [];
    const many = Math.max(1, Math.floor(along / PLATFORM.perShelter));
    if (many === 1) return [0];
    const span = along - SHELTER.long * 2;
    return Array.from({ length: many }, (_, i) => ((i + 0.5) / many - 0.5) * span);
  };

  /**
   * Where the trams call. Straight off the map: these are points on the track
   * and there is nothing to work out about them.
   */
  const stops: TramStop[] = (map.stops ?? []).flatMap(([x, z], index) =>
    x === undefined || z === undefined
      ? []
      : [{ x, z, name: map.stopNames?.[index] ?? '' }],
  );

  /**
   * The stop an island belongs to, or null.
   *
   * `reach` is allowed the island's own half-length, which is the whole of
   * why this is a function and not a constant: a stop is a point on the track
   * and an island is up to a hundred and twenty metres of kerb beside it, so
   * the node can be sixty metres from the island's middle and still be the
   * stop that island is for. Measured from the middle against a flat twelve
   * metres, ten islands in twelve went unnamed.
   */
  const stopNear = (x: number, z: number, reach: number): TramStop | null => {
    let best: { stop: TramStop; away: number } | null = null;
    for (const stop of stops) {
      const away = Math.hypot(stop.x - x, stop.z - z);
      if (away <= reach && (!best || away < best.away)) best = { stop, away };
    }
    return best?.stop ?? null;
  };

  const platforms: Platform[] = [];
  (map.islands ?? []).forEach((row) => {
    const ring: [number, number][] = [];
    for (let i = 0; i + 1 < row.length; i += 2) ring.push([row[i]!, row[i + 1]!]);
    if (ring.length < 2) return;

    // Where it is and which way it runs. Three points or more get the box,
    // whose long side is the platform however bent the line is; two points
    // are the line itself.
    const box = ring.length >= 3 ? orientedBox(ring) : null;
    const along = box
      ? Math.max(box.width, box.depth)
      : Math.hypot(ring[1]![0] - ring[0]![0], ring[1]![1] - ring[0]![1]);
    const yaw =
      box && box.width >= box.depth
        ? box.yaw
        : box
          ? box.yaw + Math.PI / 2
          : Math.atan2(-(ring[1]![1] - ring[0]![1]), ring[1]![0] - ring[0]![0]);
    let x = box ? box.x : (ring[0]![0] + ring[1]![0]) / 2;
    let z = box ? box.z : (ring[0]![1] + ring[1]![1]) / 2;
    if (along < 8) return;

    // Off the track -- the whole slab, not its middle.
    //
    // Measuring the centre is not enough twice over. A platform beside a
    // curve has its middle clear and its ends swung in, and an island sits
    // *between* the two directions, so shoving it off the nearer track walks
    // it into the further one. What has to be true is that no corner of the
    // slab is within a car's half-width of any centreline, and the only way
    // to know that is to ask along its whole length.
    //
    // So: the smallest sideways shift that clears everything, or nothing at
    // all. Tried in quarter metres out to a few, both ways, nearest first --
    // a platform that has to be carried further than that is not a platform
    // this rule understands, it is a yard drawn as one.
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    /** How near this slab comes to a running line, sitting `off` to one side. */
    const nearestRail = (off: number) => {
      let least = Infinity;
      // Both long edges, along the length. Five stations plus the ends is
      // enough for a platform against a street corner's radius.
      const steps = Math.max(4, Math.ceil(along / 8));
      for (let i = 0; i <= steps; i += 1) {
        const run = (i / steps - 0.5) * along;
        for (const side of [-PLATFORM.wide / 2, PLATFORM.wide / 2]) {
          const across = side + off;
          const at = anyTrack.nearest(x + run * cos + across * sin, z - run * sin + across * cos, 30);
          if (at) least = Math.min(least, at.distance);
        }
      }
      return least;
    };
    let offset: number | null = null;
    for (let step = 0; step * 0.25 <= PLATFORM.shove; step += 1) {
      const tries = step === 0 ? [0] : [step * 0.25, -step * 0.25];
      const fits = tries.find((off) => nearestRail(off) >= PLATFORM.clear);
      if (fits !== undefined) {
        offset = fits;
        break;
      }
    }
    if (offset === null) return;
    x += offset * sin;
    z += offset * cos;

    // The shelters are solid, which is what makes them worth having: the
    // island itself is a step, and a step is ground -- but a hut with a flat
    // roof two and a half metres up, in the middle of a street, is somewhere
    // to land. The slab is not given a box: at a quarter of a metre it is a
    // kerb, and a kerb the collider knows about is a wall to fly into at
    // ankle height.
    for (const at of shelteredAt(along)) {
      boxes.push(
        turnedBox(
          x + at * cos,
          z - at * sin,
          SHELTER.long,
          PLATFORM.rise + SHELTER.tall + SHELTER.roof,
          SHELTER.deep,
          yaw,
        ),
      );
    }

    const named = stopNear(x, z, PLATFORM_SERVED + along / 2)?.name ?? '';
    const island = {
      // Whatever stop it stands at. An island is a kerb; the name is on the
      // track beside it.
      name: named,
      x,
      z,
      width: along,
      depth: PLATFORM.wide,
      yaw,
      height: PLATFORM.rise,
      // One in the middle of a short island, and one every so often along a
      // long one -- a hundred and twenty metres of platform with a single hut
      // at the midpoint is a platform nobody could shelter on.
      shelters: shelteredAt(along),
    };
    // Filled by the same rule that refills it after every tram: see `crowdOn`.
    platforms.push({ ...island, waiting: crowdOn(island, rand) });

    // And the board, on the first shelter. Named stops only, and only where
    // there is a shelter to stand it on -- see `STOP_SIGN`.
    const roof = shelteredAt(along)[0];
    if (named && roof !== undefined) {
      signs.push({
        // Three words and nothing in brackets. The board and the map say the
        // same thing because they trim it the same way.
        brand: shortStop(named),
        x: x + roof * cos,
        z: z - roof * sin,
        base: PLATFORM.rise + SHELTER.tall + SHELTER.roof,
        width: STOP_SIGN.wide,
        // Square across the island, so it faces the traffic rather than
        // edge-on to it -- which is how it is read from a tram and from the
        // air alike.
        yaw: yaw + Math.PI / 2,
        paint: STOP_SIGN.paint,
      });
    }
  });

  const blocks = extractBlocks(map.roads, {
    minArea: options.minBlockArea,
    maxArea: options.maxBlockArea,
  });

  for (const block of blocks) {
    const ring = block.ring;
    const sides = ring.length;

    // The ring runs along the centrelines, so pulling it in by half the
    // carriageway plus the setback puts it exactly on the kerb -- and each
    // edge by its own street's width, because a block bounded by a boulevard
    // and three side streets is not a square anything.
    const kerbs = ring.map((point, i) => {
      const next = ring[(i + 1) % sides]!;
      const street = streets.nearest((point[0] + next[0]) / 2, (point[1] + next[1]) / 2, 60);
      return ((street ? street.width / 2 : 6) + options.setback) * options.streetRoom;
    });
    const widest = Math.max(...kerbs);

    const centre = polygonCentroid(ring);
    const reach = distanceToEdges(centre[0], centre[1], ring) - widest;

    // Room for a courtyard behind the buildings round the edge, or not. It no
    // longer decides how deep to build -- the buildings are real and are
    // whatever depth they are -- but it still decides whether the middle of
    // this block is a courtyard worth planting or a yard too small to bother
    // with.
    const roomy = reach > options.wingDepth + options.minCourtyard / 2;

    // A block with nothing on it is not left as bare grass between four
    // roads. In a real city that plot is a garden square, a yard or a stand of
    // trees -- something, rather than nothing.
    const empty = !blockIsBuilt(ring);
    if (empty) bare.push(block);
    else if (roomy) gardens.push(block);
  }

  /**
   * Is there a house standing on this spot?
   *
   * Gridded, because it is asked once per candidate tree against every
   * building on the map. The footprint test is done in the building's own
   * frame, so a turned house is tested as the rectangle it is rather than as
   * the larger square its world bounds describe.
   */
  const built = (() => {
    const cell = 48;
    const grid = new Map<number, number[]>();
    const key = (cx: number, cz: number) => cx * 100003 + cz;
    buildings.forEach((building, i) => {
      const span = Math.hypot(building.width, building.depth) / 2;
      for (let cx = Math.floor((building.x - span) / cell); cx <= Math.floor((building.x + span) / cell); cx += 1) {
        for (let cz = Math.floor((building.z - span) / cell); cz <= Math.floor((building.z + span) / cell); cz += 1) {
          const bucket = grid.get(key(cx, cz));
          if (bucket) bucket.push(i);
          else grid.set(key(cx, cz), [i]);
        }
      }
    });

    return (x: number, z: number) => {
      const bucket = grid.get(key(Math.floor(x / cell), Math.floor(z / cell)));
      if (!bucket) return false;
      return bucket.some((i) => {
        const building = buildings[i]!;
        const turn = -(building.yaw ?? 0);
        const dx = x - building.x;
        const dz = z - building.z;
        const along = dx * Math.cos(turn) + dz * Math.sin(turn);
        const back = -dx * Math.sin(turn) + dz * Math.cos(turn);
        return Math.abs(along) < building.width / 2 && Math.abs(back) < building.depth / 2;
      });
    };
  })();

  /**
   * Whether a point is off the carriageway.
   *
   * A short reach on purpose: this only asks whether the point is *on* a
   * road, so nothing further off than half the widest road on the map can
   * change the answer, and the index walks nine cells rather than four
   * hundred. See `frontage` for what that distinction cost when it was got
   * wrong.
   */
  const offTheRoad = (x: number, z: number) => {
    const street = streets.nearest(x, z, widestRoad / 2 + 1);
    return !street || street.distance > street.width / 2;
  };

  /**
   * Whether a tree may stand here at all.
   *
   * The two things nothing grows out of: a carriageway, and open water. Both
   * are asked of every tree in the world rather than of some of them --
   * a park is mapped to its own boundary and the road through it is inside
   * that boundary, and the trees somebody recorded standing in a street are
   * recorded to the nearest few metres of a kerb that was not surveyed.
   */
  const plantable = (x: number, z: number) => offTheRoad(x, z) && !green.covers(x, z, 'water');

  /**
   * Scatter trees on a grid, wherever the grid falls inside `ring` and
   * wherever `clear` will have them.
   */
  function plant(
    ring: Point2[],
    perHectare: number,
    clear?: (x: number, z: number) => boolean,
    step = options.spacing,
  ) {
    const chance = Math.min(1, (perHectare / 10000) * step * step);
    /**
     * One sort of tree for the whole of this ring.
     *
     * Chosen per place rather than per tree. Four sorts shuffled together
     * across a courtyard is visual noise -- every tree different from the one
     * beside it reads as static rather than as variety. A block planted with
     * one sort reads as a stand of poplars, and the next block over being
     * something else is what the variety is actually for.
     */
    const species = Math.floor(rand() * SPECIES);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of ring) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    for (let x = minX; x <= maxX; x += step) {
      for (let z = minZ; z <= maxZ; z += step) {
        const px = x + (rand() - 0.5) * step * 0.85;
        const pz = z + (rand() - 0.5) * step * 0.85;
        if (rand() >= chance) continue;
        if (!pointInPolygon(px, pz, ring)) continue;
        if (clear && !clear(px, pz)) continue;
        // Never in the middle of somebody's front room. Being far enough from
        // the street is right for the shape of a block, but says nothing about
        // a wing fronting some other street that cuts through it.
        if (built(px, pz)) continue;
        // And off the described furniture: a wood grown over a landing patch
        // is a landing patch you cannot see or use.
        if (reserved(px, pz)) continue;
        // And not in the four-foot. A yard planted as woodland is worse than
        // a yard left as track, which is what it looks like from the air.
        if (inTheFourFoot(px, pz)) continue;
        // Not on the water, and not in the middle of a five-a-side pitch.
        const ground = green.at(px, pz);
        if (ground && ground.kind !== 'park' && ground.kind !== 'wood') continue;
        // And not in the road. Parks and woods are planted from their own
        // rings with nothing else asked of them, and a park boundary takes in
        // whatever road runs through the park.
        if (!plantable(px, pz)) continue;
        // In the cemetery, one planting in three is a headstone instead. Not
        // a stone *and* a tree: a cemetery reads as a cemetery because the
        // stones stand in the gaps between the trees, which is what taking
        // the tree's place gives you for nothing.
        if (burial && ground === burial && rand() < GRAVE_SHARE) {
          graves.push({
            x: px,
            z: pz,
            // Turned every which way. Real ones face east in rows, and rows
            // are a thing this generator has no way of laying: scattered
            // stones at scattered angles read as a graveyard from the air,
            // and a grid of them would read as a car park.
            yaw: rand() * Math.PI * 2,
            // Two to four metres, which is three times the stone anybody is
            // actually buried under. At life size they are a metre of grey in
            // grass seen from twenty metres up by something moving at sixty:
            // present in the data and absent from the game. Tall rather than
            // broad, so what grows is the part that reads against the sky --
            // three times wider as well would be a row of sheds.
            height: 2.1 + rand() * 1.8,
          });
          continue;
        }
        // The stones are laid whatever happens; the trees are the part that
        // is switched off -- see `inventsTrees`.
        if (!options.inventsTrees) continue;
        trees.push({
          x: px,
          z: pz,
          radius: 2.5 + rand() * 2,
          height: 6 + rand() * 9,
          species,
        });
      }
    }
  }

  // --- Street trees ---------------------------------------------------------
  // The ones somebody actually recorded standing in a street, as against the
  // ones the generator plants in parks. They get a sort of their own -- see
  // `STREET_TREE` -- so that what the map knows can be told from what was made
  // up, at a glance, from the air.
  //
  // Sized rather than random: a street tree is a street tree, and a row of
  // them down a road wants to read as a row. The small variation is so they
  // are not a stamp repeated.
  for (const [x, z] of bakedPoints(map.trees)) {
    // Not through a wall. A tree recorded on a pavement and a building
    // recorded to the kerb can overlap by a metre in the data, and a plane
    // tree growing out of a first-floor window is funnier than it is good.
    if (built(x, z)) continue;
    // And not on ground a described thing has taken, for the same reason a
    // building may not stand there.
    if (reserved(x, z)) continue;
    // And not in the carriageway or in the water. These come off the map
    // rather than out of the generator, so they have had none of the tests
    // the invented ones have had: a tree recorded at the middle of a square
    // that was later drawn as a road surface stands in the road.
    if (!plantable(x, z)) continue;

    trees.push({
      x,
      z,
      radius: 2.6 + rand() * 0.9,
      height: 9 + rand() * 4,
      species: STREET_TREE,
    });
  }

  // The gardens, in the middle of every block with room for one.
  //
  // Found by distance from the street rather than by insetting the block a
  // second time: a courtyard is exactly the ground that no wing of building
  // reaches, and asking how far the nearest carriageway is answers that
  // directly, for any shape of block, without a polygon to go wrong.
  //
  // Asked no further than the answer can depend on, which used to be four
  // hundred metres and is the whole of the world build's cost: this runs for
  // every candidate tree position on every block, a street query walks a grid
  // cell at a time, and four hundred metres is four hundred and forty-one
  // cells to look in against nine. Both answers are the same. The test is
  // whether the nearest street is further off than a frontage, so a street
  // beyond that distance and no street at all mean the same thing, and
  // finding *which* far-off street it was is work whose result is thrown
  // away. Measured, `nearest` was two thirds of the time it took to build the
  // world.
  const frontage = (widestRoad / 2 + options.setback) * options.streetRoom + options.wingDepth;
  const indoors = (x: number, z: number) => {
    const street = streets.nearest(x, z, frontage + 1);
    if (!street) return true;
    const kerb = (street.width / 2 + options.setback) * options.streetRoom;
    return street.distance > kerb + options.wingDepth;
  };
  for (const block of gardens) {
    // A courtyard is planted like a garden; the inside of a block the size of
    // a district is not a courtyard, whatever the geometry calls it, and
    // planting one at garden density buries a railway yard under nine thousand
    // trees. Anything above a couple of hectares gets park density instead.
    const dense = block.area <= 20000;
    plant(block.ring, dense ? options.gardenTrees : options.parkTrees, indoors);
  }

  // And the ones nothing would fit on, planted right up to the kerb, since
  // there is no frontage here for them to stand behind. Off the carriageway
  // is all that is asked of them, and `plant` asks that of everything.
  for (const block of bare) {
    // On a grid that fits the plot. These are the blocks that were too small
    // to build on, and a scatter coarser than the block itself simply steps
    // over it: at 9 m, twenty-one of them came out bare a second time.
    const step = Math.max(2, Math.min(options.spacing, Math.sqrt(block.area) / 3));
    plant(block.ring, options.gardenTrees, undefined, step);
  }

  // Parks and woods, which are their own rings and owe nothing to the blocks.
  for (const area of map.areas ?? []) {
    if (area.kind !== 'park' && area.kind !== 'wood') continue;
    plant(area.points as Point2[], options.parkTrees);
  }

  // Trains, on whichever line near the asked-for point gives the longest run.
  //
  // Nearest used to be enough, when a train stood still. A train that moves
  // wants room: the nearest siding to this yard is 282 m, and a rake of twelve
  // is 198 m of that, leaving it shuffling back and forth over eighty. Among
  // the lines close enough to be the one meant, the roomiest is the one to
  // stand it on.
  /**
   * Where along a line its stops are, for a rake of this length.
   *
   * The line is walked once and every platform offered each segment, which is
   * a few thousand comparisons at world build and nothing at all after that.
   *
   * Only those actually beside the line. A stop is a point on *a* track and
   * a street has two, so `PLATFORM_SERVED` is wide enough to take in the
   * other one -- and narrow enough that a stop on the next street along is
   * not something to pull up for.
   *
   * Calls too near an end are dropped rather than clamped. A tram pulling up
   * with half of itself off the line is worse than one running past a stop.
   */
  const callsAlong = (line: Rail, consist: number): number[] => {
    if (!stops.length) return [];
    const run = lineLength(line.points);
    const found: number[] = [];
    for (const stop of stops) {
      let travelled = 0;
      let best: { away: number; at: number } | null = null;
      for (let i = 1; i < line.points.length; i += 1) {
        const a = line.points[i - 1]!;
        const b = line.points[i]!;
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const span = Math.hypot(dx, dz);
        if (span > 0) {
          const t = Math.max(
            0,
            Math.min(1, ((stop.x - a[0]) * dx + (stop.z - a[1]) * dz) / (span * span)),
          );
          const away = Math.hypot(stop.x - (a[0] + dx * t), stop.z - (a[1] + dz * t));
          if (!best || away < best.away) best = { away, at: travelled + span * t };
        }
        travelled += span;
      }
      if (!best || best.away > PLATFORM_SERVED) continue;
      if (best.at < consist / 2 + 1 || best.at > run - consist / 2 - 1) continue;
      found.push(Math.round(best.at * 100) / 100);
    }
    return [...new Set(found)].sort((a, b) => a - b);
  };

  const trains: Train[] = [];
  /**
   * Lines already occupied.
   *
   * Two trains asked for the same yard would otherwise both take the roomiest
   * siding and stand in each other. A yard has parallel tracks, so the second
   * one takes the next-roomiest, which is what putting two trains in a yard
   * looks like.
   */
  const taken = new Set<Rail>();
  // Which ways meet where, indexed once. Several trains each weighing up a
  // dozen roads is fifty walks of the network, and the junctions are a fact
  // about the map rather than about any one of them.
  const network = railNetwork(map.rails ?? []);

  /**
   * Which way each *track* runs, worked out once for each sort of line.
   *
   * The track and not the route, which is the whole of it. A traced route
   * follows the straightest continuation, and at a junction the straightest
   * continuation is often the other track of the pair -- so a route weaves,
   * and there is no one direction that is right for the whole of it. A way in
   * the map is one physical track and stays one, so it is the thing that can
   * be given a side of the road; routes are then traced along those
   * directions rather than across them.
   *
   * Worked out on demand and kept, because it is the most expensive thing in
   * building the world that is not building the buildings: 37 ms over the two
   * hundred and thirty tram ways on this map, against 451 for the whole of it.
   */
  const handedness = new Map<string, Map<Rail, number>>();
  const oneWayFor = (kind: string): Map<Rail, number> => {
    const known = handedness.get(kind);
    if (known) return known;
    const ways = (map.rails ?? []).filter((rail) => rail.kind === kind);
    const hands = keepRight(ways.map((way) => way.points));
    const made = new Map<Rail, number>(
      ways.map((way, index) => [way, hands[index]?.direction ?? 1]),
    );
    handedness.set(kind, made);
    return made;
  };

  for (const spec of options.trains ?? []) {
    const stock = spec.stock ?? 'wagon';
    const length = consistLength(spec.cars, stock);
    // A named tram is a tram: it keeps right like the rest of them, and
    // `setOff` has nothing left to say about it. It was saying the wrong
    // thing -- the one placed beside the fourth level's patch of concrete ran
    // three thousand one hundred and forty-six metres alongside another tram
    // going the same way, and six metres opposed.
    //
    // Nothing is lost by that. The pair asked for at the double-track spot
    // were given opposite bearings by hand to make them pass each other, and
    // opposite is what the track gives them anyway, now on the correct sides.
    const oneWay = stockTurnaround(stock) === 'recycle' ? oneWayFor(stockRuns(stock)) : undefined;

    let line: Rail | null = null;
    let over: readonly Rail[] = [];
    let best = -Infinity;
    for (const rail of map.rails ?? []) {
      // A tram runs on tramway and a train runs on railway. Nothing said so
      // before, and nothing had to: every train asked for was asked for over
      // a goods yard, where the roomiest line nearby happened to be heavy
      // rail every time.
      if (rail.kind !== stockRuns(stock)) continue;
      if (taken.has(rail)) continue;
      const at = chainageOf(rail.points, spec.near.x, spec.near.z);
      const on = pointAlong(rail.points, at);
      if (!on) continue;
      const away = Math.hypot(on.x - spec.near.x, on.z - spec.near.z);
      if (away > options.trainReach) continue;

      // One that leaves is judged on where the whole route gets to, not on
      // how long its own way happens to be: the way out of this yard is cut
      // into pieces and the piece that starts the longest run is a short one.
      const route = spec.runsOut ? traceRoute(network, rail, undefined, oneWay) : null;
      const laid = route ? route.over : [rail];
      if (laid.some((part) => taken.has(part))) continue;

      const run = lineLength(route ? route.points : rail.points) - length;
      if (run > best) {
        best = run;
        line = route ? { kind: rail.kind, width: rail.width, points: route.points } : rail;
        over = laid;
      }
    }
    if (!line || best < 0) continue;

    // Centred on where it was asked for, then shifted along until the whole
    // train is on the line: half a consist hanging off the end of a siding
    // looks far worse than one standing a little further up it.
    const run = lineLength(line.points);
    const wanted = chainageOf(line.points, spec.near.x, spec.near.z) + length / 2;
    const along = Math.min(Math.max(wanted, length), run);

    const vehicles = layOutTrain(line, along, spec.cars, stock);
    if (!vehicles.length) continue;
    // Deliberately not added to `boxes`: a train moves, and the world's boxes
    // are built into a grid once and never touched again. It carries its own.
    // Every way the route runs over, not just the one it was seeded from:
    // otherwise the next train stands itself in a platform this one comes
    // through at fifty kilometres an hour.
    for (const part of over) taken.add(part);
    const direction = oneWay
      ? // A traced route already runs the way it is travelled, so up it. One
        // that was not traced is a single way, taken as the side of the road
        // says.
        (spec.runsOut ? 1 : (oneWay.get(line) ?? 1))
      : spec.setOff === undefined
        ? 1
        : directionFor(line.points, along, spec.setOff);
    trains.push({
      line,
      along,
      direction,
      speed: spec.speed ?? 6,
      stock,
      cars: spec.cars,
      turnaround: stockTurnaround(stock),
      calls: stock === 'tram' ? callsAlong(line, consistLength(spec.cars, stock)) : [],
      held: 0,
      waited: 0,
      vehicles,
    });
  }

  // --- Filling the network --------------------------------------------------
  // Whatever is left after the levels have had their pick. One train to a
  // route, so no two can ever be found running the same rails, and each put
  // somewhere different along its own route -- placed at the same fraction
  // they would all sit at the same end of their lines and the network would
  // read as a depot rather than as a service.
  for (const want of options.fill ?? []) {
    const runs = stockRuns(want.stock);
    const length = consistLength(want.cars, want.stock);

    const oneWay = oneWayFor(runs);

    const routes: { line: Rail; over: Rail[]; run: number }[] = [];
    for (const rail of map.rails ?? []) {
      if (rail.kind !== runs || taken.has(rail)) continue;
      // Traced through what is already spoken for, not around it.
      //
      // `taken` says which rails a route has already been *seeded* from, so
      // that twenty trams are not twenty copies of one line. It used to say
      // where a route may not *go* as well, and those are different
      // questions: a route traced around a claimed way stops at it, and a
      // route that stops is a tram that turns round. On this map that put
      // four reversals within a hundred and fifty metres of the petrol
      // station, at junctions where the way ahead leaves at one to nine
      // degrees -- straight on, in the middle of a street, blocked by nothing
      // but our own ledger.
      //
      // So routes overlap now, and trams share track, which is what trams do.
      // They pass through each other where they meet; nothing here models a
      // collision, and a tram reversing in a street looks far worse than two
      // of them occupying it.
      const route = traceRoute(network, rail, undefined, oneWay);
      const run = lineLength(route.points);
      if (run < Math.max(want.minRoute, length * 2)) continue;
      // Claimed as they are found, so a route is only offered once.
      for (const part of route.over) taken.add(part);
      routes.push({ line: { kind: rail.kind, width: rail.width, points: route.points }, over: route.over, run });
    }

    // Longest first, so a small allowance goes on the lines worth seeing.
    routes.sort((a, b) => b.run - a.run);
    routes.slice(want.most).forEach((spare) => {
      for (const part of spare.over) taken.delete(part);
    });

    routes.slice(0, want.most).forEach((route, index) => {
      // Several to a route, spaced evenly round it -- but only for stock
      // that recycles. A shuttling train cannot share a route with another:
      // it reverses at the end and works back down the line it came up, so
      // the second one it met would be head-on. Those get one apiece, put at
      // a different fraction of each route so eight of them are not eight
      // trains standing at eight buffer stops.
      //
      // Trams hold their spacing for ever, which is what makes this a
      // service rather than a queue: they all run at one speed, and the one
      // that wraps rejoins the ring exactly where the ring has its opening.
      const spread = 0.618033988749895;
      const stops =
        stockTurnaround(want.stock) === 'recycle'
          ? departures(route.run, length, want.speed * want.headway)
          : [length + (route.run - length) * ((index * spread) % 1)];

      for (const along of stops) {
        const vehicles = layOutTrain(route.line, along, want.cars, want.stock);
        if (!vehicles.length) continue;
        trains.push({
          line: route.line,
          along,
          // Always up the route, because the route was traced in the
          // direction it is travelled: the side of the road was settled on
          // the track, one level down, and by the time there is a line here
          // there is nothing left to decide.
          direction: 1,
          speed: want.speed,
          stock: want.stock,
          cars: want.cars,
          turnaround: stockTurnaround(want.stock),
          // Worked out per route rather than per tram, since every tram on a
          // route calls at the same places -- but the routes are traced in
          // this loop, so this is where it can be asked.
          calls: want.stock === 'tram' ? callsAlong(route.line, length) : [],
          held: 0,
          waited: 0,
          vehicles,
        });
      }
    });
  }

  // --- Bridges --------------------------------------------------------------
  // A deck piece at a time, boxed exactly where it is drawn. Solid so the
  // bird cannot go through it and can stand on it, and raised so it can go
  // under it -- which is the only reason any of this is here.
  //
  // The slab and nothing above it. A parapet is drawn along each edge, and
  // boxing those too would put a wall down both sides of the carriageway: a
  // bird coming in to land would settle on top of the parapet, a metre above
  // the road, or be stopped short of the deck altogether. Flying through a
  // handrail is the smaller lie.
  const bridges = map.bridges ?? [];
  for (const bridge of bridges) {
    const deck = deckOf(bridge);
    if (!deck) continue;
    for (let i = 1; i < deck.spine.length; i += 1) {
      const [ax, az, ay] = deck.spine[i - 1]!;
      const [bx, bz, by] = deck.spine[i]!;
      const length = Math.hypot(bx - ax, bz - az);
      if (length < 1e-3) continue;
      const top = Math.max(ay, by);
      boxes.push({
        minX: (ax + bx) / 2 - length / 2,
        maxX: (ax + bx) / 2 + length / 2,
        minZ: (az + bz) / 2 - deck.width / 2,
        maxZ: (az + bz) / 2 + deck.width / 2,
        // The piece is boxed to its higher end, so a run of them is a
        // staircase rather than a set of steps with gaps between the treads.
        minY: Math.min(ay, by) - DECK,
        maxY: top,
        // Local X along the deck, which is the convention the rest of the map
        // is turned in: facing nought is -Z, so a way running along +X is a
        // quarter turn from it.
        yaw: -Math.atan2(bz - az, bx - ax),
      });
    }
  }

  return {
    buildings,
    trees,
    graves,
    landmarks,
    bushes,
    people,
    boxes,
    crossings,
    platforms,
    stops,
    plans,
    signs,
    steeples,
    roads: map.roads,
    bridges,
    rails: map.rails ?? [],
    trains,
    areas: map.areas ?? [],
    streets,
    green,
    blocks,
    gardens,
    bare,
  };
}
