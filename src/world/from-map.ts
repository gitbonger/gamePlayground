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
  bakedBuildings,
  bakedPoints,
  indexStreets,
  type MapData,
  type Rail,
  type StreetIndex,
} from './streets';
import { footprintSamples, indexAreas, type AreaIndex } from './areas';
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
  /**
   * Building heights, in metres. A flat band rather than something derived
   * from road importance: this neighbourhood is uniformly about seven floors,
   * and that evenness is what its skyline looks like.
   */
  minHeight: number;
  maxHeight: number;
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
  minHeight: 16,
  maxHeight: 24,
  spacing: 9,
  parkTrees: 19,
  gardenTrees: 60,
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

export function buildLayoutFromMap(
  map: MapData,
  options: MapWorldOptions = defaultMapWorldOptions,
): MapWorld {
  const streets = indexStreets(map.roads);
  // A railway is a line with a width and a corridor to keep clear, which is
  // exactly what the street index already answers questions about. Same index,
  // different question.
  const tracks = indexStreets(map.rails ?? []);
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
  const onTrack = (x: number, z: number, width: number, depth: number, yaw: number) => {
    // Almost nothing on the map is anywhere near a railway, so ask the cheap
    // question first: is there track within reach of this footprint at all?
    const span = Math.hypot(width, depth) / 2;
    if (!tracks.nearest(x, z, span + 8)) return false;
    return footprintSamples(x, z, width, depth, yaw, 3).some(([sx, sz]) => {
      const rail = tracks.nearest(sx, sz, 40);
      return rail !== null && rail.distance < rail.width / 2;
    });
  };

  const rand = mulberry32(options.seed);

  const buildings: Building[] = [];
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
  const fromMap = bakedBuildings(map);
  for (const each of fromMap) {
    const footprint = footprintSamples(each.x, each.z, each.width, each.depth, each.yaw, 4);

    // The story wins. A described thing -- the loft, the home tree, a square
    // with a name -- keeps its ground against a real building exactly as it
    // kept it against an invented one, because a level that names a building
    // cannot have a block of flats standing through it.
    if (footprint.some(([sx, sz]) => reserved(sx, sz))) continue;

    // And nothing across a railway. There is little of this in real data --
    // it is mostly platform canopies and signal boxes -- but the goods yard
    // has to stay a goods yard.
    if (onTrack(each.x, each.z, each.width, each.depth, each.yaw)) continue;

    // A height where the building gives one, and otherwise the range the
    // generator used: about half of them say, and a district where only the
    // ones that say are tall would read as half-finished.
    const height =
      each.height ?? options.minHeight + rand() * (options.maxHeight - options.minHeight);

    buildings.push({ x: each.x, z: each.z, width: each.width, depth: each.depth, height, yaw: each.yaw });
    boxes.push(turnedBox(each.x, each.z, each.width, height, each.depth, each.yaw));
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
        if (onTrack(px, pz, 3, 3, 0)) continue;
        // Not on the water, and not in the middle of a five-a-side pitch.
        const ground = green.at(px, pz);
        if (ground && ground.kind !== 'park' && ground.kind !== 'wood') continue;
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
  const indoors = (x: number, z: number) => {
    const street = streets.nearest(x, z, 400);
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
  // there is no frontage here for them to stand behind.
  const offTheRoad = (x: number, z: number) => {
    const street = streets.nearest(x, z, 400);
    return !street || street.distance > street.width / 2;
  };
  for (const block of bare) {
    // On a grid that fits the plot. These are the blocks that were too small
    // to build on, and a scatter coarser than the block itself simply steps
    // over it: at 9 m, twenty-one of them came out bare a second time.
    const step = Math.max(2, Math.min(options.spacing, Math.sqrt(block.area) / 3));
    plant(block.ring, options.gardenTrees, offTheRoad, step);
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
          vehicles,
        });
      }
    });
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
    roads: map.roads,
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
