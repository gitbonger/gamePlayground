/**
 * City layout as plain data.
 *
 * Kept separate from the meshes so the exact world the player flies through can
 * be generated and collision-tested in Node, without a WebGL context.
 */

import { aabb, type Box } from '../sim/collision';
import type { Rail, Road } from './streets';
import type { Bridge } from './bridges';
import type { Train } from './train';
import type { Area } from './areas';

/** Small deterministic PRNG, so the same seed always builds the same city. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface WorldOptions {
  seed: number;
  /** Half-width of the built-up area in metres. */
  extent: number;
  buildingCount: number;
  treeCount: number;
}

export const defaultWorldOptions: WorldOptions = {
  seed: 7,
  extent: 900,
  buildingCount: 900,
  treeCount: 500,
};

export interface Building {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  /** Rotation about the vertical axis, radians. Zero for the procedural city. */
  yaw?: number;
}

/**
 * A taller part over one end of a landmark, leaving the rest as a terrace.
 *
 * This is the whole of what makes a block of flats a place rather than a box:
 * the flat top is at two levels, the lower one is open, and the upper one
 * looks out over it. Both halves are the same building and flash together --
 * it is one thing with a shape, not two things standing next to each other.
 */
export interface Penthouse {
  /**
   * How much of the length it takes, as a fraction, measured from the far
   * end. A half is a half.
   */
  cover: number;
  /** How much higher than the terrace it stands, in metres. */
  rise: number;
}

/**
 * Bushes standing in rows on a terrace.
 *
 * Rows run the length of the terrace and are spaced symmetrically about its
 * centre line, outermost first, which leaves the middle of it clear. That is
 * not decoration of the arithmetic: the middle is where the arrow points,
 * where a bird comes down and where the pigeon waiting for it stands, so it
 * is the one part of a terrace that must stay walkable.
 */
export interface Planting {
  /** How many rows. */
  rows: number;
  /** How many bushes in each. */
  perRow: number;
  /** How wide each one is. */
  radius: number;
}

/**
 * What makes a landmark a tree instead of a building.
 *
 * The height is still the height of the flat top, so the platform, the
 * marker and anything standing up there all work out the same way they do on
 * a roof. This only says what is underneath it.
 */
export interface Canopy {
  /** How thick the trunk is, in metres. */
  trunk: number;
  /** How far below the platform the crown reaches. */
  skirt: number;
  /**
   * How far the foliage reaches from the trunk, in metres.
   *
   * Wider than the platform, which is the point of having both numbers: the
   * landmark's own width is the flat crest you can stand on, and the crown
   * bulges out past it below. A tree whose canopy stopped where its walkable
   * top did would be a green table, and one whose whole canopy was walkable
   * would let a bird stand on the outermost leaf.
   */
  spread: number;
}

/**
 * What makes a landmark a petrol station.
 *
 * Three things on a forecourt, which is the least that reads as one from the
 * air: a hut, a pump, and a car at the pump. The landmark's own width and
 * depth are the forecourt -- the ground it takes and keeps clear of houses
 * and trees -- and none of that ground is solid. What is solid is the three
 * things standing on it.
 *
 * Each is placed along and across the forecourt and turned to face, in the
 * same words as everything else that stands on a landmark.
 */
export interface Station {
  /** The hut: the office, and the only building on the site. */
  hut: Standing & { width: number; depth: number; height: number };
  /** The pump island. */
  pump: Standing;
  /** A car, filling up. */
  car: Standing;
}

/**
 * A petrol pump and a car, at the sizes they are built.
 *
 * Here rather than in the renderer because both the drawing and the collision
 * boxes need them, and a pump that is one size to look at and another to fly
 * into is the kind of disagreement nobody finds by reading.
 */
export const PUMP = { width: 0.9, depth: 0.6, height: 1.9 };
export const CAR = { length: 4, width: 1.75, height: 1.45 };

/**
 * A described thing, placed before the city is generated around it.
 *
 * Everything else in the world is worked out from the map: where the streets
 * run, so where the blocks are, so where the houses and the trees go. A
 * landmark is the other way round -- it is written down, put in place first,
 * and the generation avoids it. That is what makes it something a level can
 * name and rely on: the loft is a particular building at a particular
 * coordinate rather than whichever house happened to come out nearest.
 *
 * A patch of concrete is the same idea lying flat. Zero height means nothing
 * to fly into and nothing to land on that is not the ground, but it is still
 * reserved ground and still something a level can point at.
 */
export interface Landmark {
  /** What levels call it. */
  name: string;
  /** Where it stands, in local metres. */
  x: number;
  z: number;
  /** Its footprint: along it and across it. */
  width: number;
  depth: number;
  /**
   * How high its flat top is. Zero for something lying on the ground.
   *
   * With a penthouse this is the *terrace* -- the lower of the two levels,
   * and the one that is walked on. What stands above it is described by the
   * penthouse rather than by this.
   */
  height: number;
  /** Which way it faces, in the collider's yaw convention. */
  yaw?: number;
  /** A taller part over one end, if it has one. */
  penthouse?: Penthouse;
  /**
   * Drawn as a tree rather than a building, if it has one.
   *
   * The flat top is still a flat top -- something to land on and walk about
   * on -- but everything below it is a trunk and a crown. A tree this size is
   * a described thing for the same reason the loft is: a level names it, so
   * it has to be a particular tree in a particular place rather than
   * whichever one the generator happened to put nearby.
   */
  canopy?: Canopy;
  /** A nest on top, in metres along and across the flat top. */
  nest?: { along: number; across: number };
  /**
   * Drawn as a petrol station rather than a building, if it has one.
   *
   * The landmark is then the forecourt: reserved ground with three solid
   * things standing on it, rather than one solid thing filling it.
   */
  station?: Station;
  /** What is planted on the terrace, if anything. */
  planting?: Planting;
  /** Anybody standing on the terrace. */
  people?: readonly Standing[];
  /**
   * Clear ground kept around it, in metres.
   *
   * So that a landmark is a landmark rather than something wedged between
   * two houses -- and, for a flat one, so that the approach to it is not
   * through a wood.
   */
  margin?: number;
}

/**
 * Somewhere on a landmark for somebody to stand, in its own frame.
 *
 * Along and across the tier they are on, so that turning the building takes
 * them with it, and so that a description reads as a place on a terrace
 * rather than as a coordinate that happens to land on one.
 */
export interface Standing {
  along: number;
  across: number;
  /** Which way they look, measured from the way the building faces. */
  facing: number;
}

/**
 * A person, standing somewhere.
 *
 * Scenery with a scale to it: two metres of something recognisable is what
 * tells you how big a roof is and how fast you are going over it, which is a
 * job nothing else in the world does -- a block of flats is whatever size you
 * decide it is until there is somebody standing on it.
 */
export interface Person {
  x: number;
  z: number;
  /** The height of the surface they stand on. */
  base: number;
  /** Which way they face, in the collider's yaw convention. */
  facing: number;
}

/**
 * A painted pedestrian crossing, laid across a carriageway.
 *
 * A place and a bearing, worked out once when the world is built: the map
 * gives the place, and the road under it gives the bearing and how wide to
 * paint. Bars are drawn from these rather than stored, because a zebra is
 * six identical bars and storing six of everything would be storing the same
 * arithmetic four thousand times.
 */
export interface Crossing {
  x: number;
  z: number;
  /** Which way the road runs, in the collider's yaw convention. */
  yaw: number;
  /** The carriageway to paint across, in metres. */
  width: number;
}

/** How tall a person is, in metres. */
export const PERSON_HEIGHT = 2;

/** How wide across their collision box is, in metres. */
export const PERSON_WIDTH = 0.6;

/**
 * A shrub standing on something, rather than a tree standing in the ground.
 *
 * The base is the only real difference and it is the whole point: a tree can
 * be drawn wherever the terrain is, a bush is on a terrace thirty metres up
 * and has to be told so.
 */
/**
 * One flat-topped rectangular tier of a landmark.
 *
 * A landmark with a penthouse is two of these -- the terrace and the part
 * standing over it -- and everything that has to point at one of them (the
 * marker, the collider, the planting) asks for it here rather than working it
 * out again with its own arithmetic and its own idea of which end is which.
 *
 * Not called a level. A level is a thing the game has three of.
 */
export interface Tier {
  x: number;
  z: number;
  width: number;
  depth: number;
  /** How high its flat top is. */
  top: number;
  /** Which way it faces, in the collider's yaw convention. */
  yaw: number;
}

/**
 * A point in a turned thing's own frame, put back into the world.
 *
 * `along` runs with its width and `across` with its depth. The convention is
 * the collider's, which is Three.js's rotation.y -- the same one
 * `footprintSamples` uses, and the inverse of the one `reserved` tests with.
 *
 * Everything that puts something on a landmark goes through here: the tiers,
 * the planting, and whoever is standing on it. Turn the building and they all
 * turn with it, because none of them works out its own place in the world.
 */
export function pointOn(
  place: { x: number; z: number; yaw?: number },
  along: number,
  across: number,
): { x: number; z: number } {
  const cos = Math.cos(place.yaw ?? 0);
  const sin = Math.sin(place.yaw ?? 0);
  return {
    x: place.x + along * cos + across * sin,
    z: place.z - along * sin + across * cos,
  };
}

/**
 * The open part of a landmark's flat top: everything the penthouse leaves.
 *
 * Null when there is no penthouse, because then the flat top is all one thing
 * and calling any of it a terrace would be inventing a distinction the
 * description does not make.
 */
export function terraceOf(landmark: Landmark): Tier | null {
  const penthouse = landmark.penthouse;
  if (!penthouse || landmark.height <= 0) return null;

  const width = landmark.width * (1 - penthouse.cover);
  if (width <= 0) return null;
  // The penthouse takes the far end, so the terrace is what is left at the
  // near one, and its middle is half the taken length back from the middle of
  // the building.
  const centre = pointOn(landmark, -(landmark.width * penthouse.cover) / 2, 0);
  return {
    ...centre,
    width,
    depth: landmark.depth,
    top: landmark.height,
    yaw: landmark.yaw ?? 0,
  };
}

/** The taller part, standing over the far end. */
export function penthouseOf(landmark: Landmark): Tier | null {
  const penthouse = landmark.penthouse;
  if (!penthouse || landmark.height <= 0) return null;

  const width = landmark.width * penthouse.cover;
  if (width <= 0) return null;
  const centre = pointOn(landmark, (landmark.width * (1 - penthouse.cover)) / 2, 0);
  return {
    ...centre,
    width,
    depth: landmark.depth,
    top: landmark.height + penthouse.rise,
    yaw: landmark.yaw ?? 0,
  };
}

/** How much taller than wide a bush is drawn, and boxed. */
const BUSH_RISE = 1.25;

/**
 * How far out the outermost row sits, as a fraction of the terrace's depth.
 *
 * Rows go near the edges, which is where planters are put on a real terrace
 * and, more usefully, is what keeps the middle open. A third and a bit out
 * leaves a clear strip down the centre wider than the planted margins either
 * side of it.
 */
const ROW_SPREAD = 0.35;

/** How far a bush is kept back from the ends of its row. */
const ROW_INSET = 0.8;

/**
 * The bushes on a landmark's terrace, in rows.
 *
 * Rows run the length of the terrace, spaced symmetrically about its centre
 * line. With two of them the middle is left open, which is where the arrow
 * points and where the pigeon waiting there stands -- planting that closed it
 * would be planting the landing off.
 */
export function plantTerrace(landmark: Landmark): Bush[] {
  const planting = landmark.planting;
  const terrace = terraceOf(landmark);
  if (!planting || !terrace || planting.rows < 1 || planting.perRow < 1) return [];

  const bushes: Bush[] = [];
  const height = planting.radius * BUSH_RISE;
  const span = terrace.width - 2 * (ROW_INSET + planting.radius);
  // Where the terrace's own middle is, in the landmark's frame: the rows are
  // laid there and turned with everything else.
  const back = -(landmark.width - terrace.width) / 2;

  for (let row = 0; row < planting.rows; row += 1) {
    // -1 .. 1 across the rows, and 0 when there is only one of them.
    const side = planting.rows === 1 ? 0 : (row / (planting.rows - 1)) * 2 - 1;
    const across = side * ROW_SPREAD * terrace.depth;

    for (let i = 0; i < planting.perRow; i += 1) {
      const step = planting.perRow === 1 ? 0.5 : i / (planting.perRow - 1);
      const along = back + (step - 0.5) * span;
      const at = pointOn(landmark, along, across);
      bushes.push({ ...at, base: terrace.top, radius: planting.radius, height });
    }
  }
  return bushes;
}

/**
 * A nest on a landmark's flat top, in world coordinates.
 *
 * A saucer of sticks with one egg in it. Small enough to walk round and not
 * solid: it is the thing the level is about, so bumping into it would be the
 * game arguing with the player at the one moment it should be getting out of
 * the way.
 */
export interface Nest {
  x: number;
  z: number;
  /** How high the sticks stand, which is the top of whatever it is on. */
  base: number;
  /** Across the rim, in metres. */
  radius: number;
  /** How big the egg in it is, along its long axis. */
  egg: number;
}

/**
 * How much bigger than life the nest and its egg are built.
 *
 * Life size is a handspan across with a 39 mm egg in it, which is the truth
 * and is also invisible: it is the thing this level is *about*, and at life
 * size a bird standing beside it hides it completely. So both are three times
 * over -- the nest and the egg together, so the picture stays a nest with an
 * egg in it rather than a nest with a marble in it.
 */
const LIFE_SIZE = 3;
/** A feral pigeon's nest is a flimsy platform of stems, and its egg 39 by 29 mm. */
const NEST_RADIUS = 0.13 * LIFE_SIZE;
const EGG_LENGTH = 0.039 * LIFE_SIZE;

/**
 * The nest on a landmark, if it has one.
 *
 * Placed along and across the thing it is on, like everything else that
 * stands on a landmark, so that turning the landmark turns the nest with it.
 */
export function nestOn(landmark: Landmark): Nest | null {
  const spot = landmark.nest;
  if (!spot || landmark.height <= 0) return null;

  const at = pointOn(landmark, spot.along, spot.across);
  return { x: at.x, z: at.z, base: landmark.height, radius: NEST_RADIUS, egg: EGG_LENGTH };
}

/**
 * The tier somebody standing on a landmark stands on.
 *
 * The terrace when there is one, because the point of a terrace is that it is
 * the open half of the top. Otherwise the thing's own flat top -- which for
 * something lying flat is the ground it is laid into. That is what lets a
 * patch of concrete have somebody standing by it without a patch of concrete
 * having to grow a penthouse first.
 */
export function topOf(landmark: Landmark): Tier {
  return (
    terraceOf(landmark) ?? {
      x: landmark.x,
      z: landmark.z,
      width: landmark.width,
      depth: landmark.depth,
      top: landmark.height,
      yaw: landmark.yaw ?? 0,
    }
  );
}

/**
 * Whoever is standing on a landmark's terrace.
 *
 * On the terrace and not on the roof of the penthouse, because the terrace is
 * the half of the building that is outdoors. Nobody stands anywhere else yet;
 * when they do, they go in the same list, and the renderer and the collider
 * will not know the difference.
 */
export function peopleOn(landmark: Landmark): Person[] {
  if (!landmark.people) return [];

  // Placed on the tier rather than on the landmark, and free to be off the
  // edge of it: somebody *beside* a patch of concrete is as much a part of
  // the description as somebody on a roof terrace, and both are written the
  // same way -- so many metres along it and across it.
  const tier = topOf(landmark);
  return landmark.people.map((spot) => ({
    ...pointOn(tier, spot.along, spot.across),
    base: tier.top,
    facing: tier.yaw + spot.facing,
  }));
}

export interface Bush {
  x: number;
  z: number;
  /** The height of the surface it stands on. */
  base: number;
  radius: number;
  height: number;
}

export interface Tree {
  x: number;
  z: number;
  radius: number;
  height: number;
  /**
   * Which sort of tree it is, as an index into the renderer's list.
   *
   * A fact about the tree rather than about how it is drawn, so it is decided
   * here with everything else about it, and stays the same run to run because
   * it comes off the same seeded stream as its size and its place.
   */
  species: number;
}

/**
 * How many sorts there are.
 *
 * Named here because the layout picks one and the renderer draws it, and the
 * two have to agree about how many there are to pick from. The renderer keeps
 * the shapes; this is only the count.
 */
export const SPECIES = 4;

/**
 * The one the generator never plants: the tree that came off the map.
 *
 * A street tree is a *record* -- somebody stood in Józsefváros and wrote down
 * that there is a tree here -- and everything else in the world's greenery is
 * invented. Giving it a sort of its own means the difference is visible from
 * the air, which is the point: you can see at a glance what the map knows and
 * what the generator made up.
 *
 * Numbered past the end of the generated range on purpose. `rand() * SPECIES`
 * cannot reach it, so nothing invented can be mistaken for a real one.
 */
export const STREET_TREE = SPECIES;

/**
 * A headstone, standing where a tree would otherwise have grown.
 *
 * The park the home tree stands in is a cemetery, and a cemetery from the air
 * is not a different green -- it is the same trees with stones under them.
 * They are scenery: no bird has ever been stopped by one, and neither is a
 * pigeon here.
 */
export interface Grave {
  x: number;
  z: number;
  /** Which way the stone faces, radians. */
  yaw: number;
  /** How tall it stands, in metres. */
  height: number;
}


/**
 * A shop's name, on the roof of the building it is in.
 *
 * On the roof rather than on the wall, and that is measured rather than
 * chosen. The levels release the bird between eighteen and a hundred and
 * fifty metres up, median sixty, over roofs whose median is fourteen -- so on
 * ten of the thirteen you are above the roofline, and a sign flat on a wall
 * is edge-on and only on the one wall facing you.
 *
 * Nor is it painted flat on the roof, which fails the other way. Flying at
 * sixty metres, the line to a sign four hundred metres off is seven degrees
 * below horizontal, and thirteen at two hundred; flat lettering is invisible
 * at those angles and legible only from directly overhead, by which point you
 * have arrived and no longer need it. Navigation happens at distance.
 *
 * So: a hoarding standing on the roof, raked back off vertical, facing the
 * street. Which is what Budapest actually puts on its roofs.
 */
export interface Sign {
  /** What it says. */
  brand: string;
  /** Where it stands, in local metres. */
  x: number;
  z: number;
  /** The height of the roof it stands on, in metres. */
  base: number;
  /** How wide the panel is. Its height follows from the lettering. */
  width: number;
  /** Which way it faces: the yaw whose forward is out towards the street. */
  yaw: number;
  /**
   * What colour it is painted, where the name is not a brand anybody knows.
   *
   * A shop sign takes its colours from the chain -- that is what makes it
   * recognisable at three hundred metres without reading it. A tram stop has
   * no chain: every one in the city is the same blue board, and what tells
   * them apart is the name on it.
   */
  paint?: { ground: string; ink: string };
}


/**
 * The tall thing on a church, which is what a district is navigated by.
 *
 * The buildings already come off the map with real outlines, so a church is
 * already the right shape on the ground -- what it is missing is the one part
 * of it you can see from three streets away. There are 67 places of worship
 * in this slice and on most of their blocks they are the only thing taller
 * than a tenement.
 *
 * Three sorts, because drawing all of them the same would be putting a spire
 * on a synagogue: a parish church gets a tower and a spire, a chapel a
 * bellcote, a synagogue a dome.
 *
 * Sized from the building it stands on rather than from a number, so a
 * cathedral is not the same height as a wayside chapel -- but sized by a rule,
 * so two churches on the same size of building come out identical and share
 * one shape between them.
 */
export interface Steeple {
  kind: 'church' | 'chapel' | 'synagogue';
  /** Where the tower or dome stands, in local metres. */
  x: number;
  z: number;
  /** Which way the tower faces: out towards the street, as a sign does. */
  yaw: number;
  /** How thick the tower or drum is, across. */
  width: number;
  /** The masonry, from the ground to where the spire or dome starts. */
  height: number;
  /** And the spire or dome on top of that. */
  spire: number;
}


/**
 * A building as it is drawn: the outline the map gave, and how tall it is.
 *
 * Distinct from the boxes in `buildings`, which are the same buildings as the
 * collider wants them -- one outline can be several boxes, and a box is a
 * rectangle where this is whatever shape the building really is. Distinct too
 * from `BuildingPlan` off the map, whose height may be null; by the time one
 * of these exists the height has been settled, invented if need be.
 */
export interface Footprint {
  /** The footprint, open: the last point does not repeat the first. */
  ring: readonly (readonly number[])[];
  /** Metres to the ridge, as `Building.height` means it. */
  height: number;
}

/**
 * A tram platform: the island people stand on, beside the running line.
 *
 * A box rather than the way the map drew it. Half of them come down as a
 * two-node line with no width at all -- the map is saying where the kerb runs
 * and leaving the rest to whoever needs it -- and the six that are closed
 * rings are a depot yard and an underpass, whose real outline is not a
 * platform shape. So the line decides where it is and how long, and how wide
 * is a fact about trams.
 */
export interface Platform {
  /**
   * The stop this island belongs to, or '' where none is near enough.
   *
   * Taken from the stop on the track rather than from the island's own tag:
   * only two thirds of the islands are named and all of the stops are.
   */
  name: string;
  x: number;
  z: number;
  /** Along the track. */
  width: number;
  /** Across it. */
  depth: number;
  yaw: number;
  /** Kerb height above the carriageway. */
  height: number;
  /**
   * Where the shelters stand, as distances along the platform from its middle.
   *
   * Decided here rather than by the renderer, because a shelter is a thing you
   * can perch on: worked out at draw time it would be drawn in one place and
   * solid in another, or solid nowhere. Empty for a short stop, which in this
   * district is a pole and a flag and nothing to stand under.
   */
  shelters: readonly number[];
  /**
   * Who is standing on it, and any dogs with them.
   *
   * Not folded into `CityLayout.people` with everybody else, because these
   * come and go: a tram calls, they get on, and a different few are there
   * when the next one comes. See `crowdOn`.
   *
   * Not readonly: this one is written over while the game runs, which is the
   * whole point of it being here rather than in the crowd.
   */
  waiting: Waiting[];
}

/** One person waiting on a platform, and the dog with them. See `crowdOn`. */
export interface Waiting {
  person: Person;
  dog: { x: number; z: number; facing: number } | null;
}

/**
 * Where a tram calls: a point on the track, and what it is called.
 *
 * Distinct from `Platform`, and the difference matters. A platform is a thing
 * in the world that gets built; a stop is a fact about the service. A third
 * of the stops in this district have no platform -- the tram pulls up in the
 * street and you step off the kerb -- and those are stops all the same, with
 * names, and a map that only knew about platforms had nothing to say about
 * them.
 */
export interface TramStop {
  x: number;
  z: number;
  name: string;
}

/**
 * A tram shelter, in metres.
 *
 * `long` is three or four people out of the rain, `deep` a little narrower
 * than the island so it does not overhang its own kerb, and `tall` a shade
 * over head height. The roof oversails on all four sides, which is the whole
 * silhouette of one from above -- a flat pale rectangle floating on a dark
 * box -- and from a pigeon's altitude the roof is the only part of it that is
 * ever seen.
 */
export const SHELTER = { long: 4.6, deep: 1.9, tall: 2.4, roof: 0.16, eaves: 0.35 } as const;

export interface CityLayout {
  buildings: Building[];
  trees: Tree[];
  /** Headstones, where the ground that grows the trees is a cemetery. */
  graves: Grave[];
  /** Described things, placed before the rest and avoided by it. */
  landmarks: Landmark[];
  /** Bushes on the terraces of those, if any of them has one. */
  bushes: Bush[];
  /** People standing about on them. */
  people: Person[];
  /** Painted pedestrian crossings, where the map recorded any. */
  crossings?: Crossing[];
  /** The buildings as the map drew them, which is what gets drawn. */
  plans?: Footprint[];
  /** Shop signs standing on the roofs they belong to. */
  signs?: Sign[];
  /** Towers, spires and domes on the buildings the map calls churches. */
  steeples?: Steeple[];
  /** Tram islands, where the map recorded any. */
  platforms?: Platform[];
  /** Where the trams call, named. Two to a stop, one per direction. */
  stops?: TramStop[];
  /** Posts holding up the stop signs, so the boards are not floating. */
  signPosts?: { x: number; z: number; top: number }[];
  /** Solid volumes for every object above, in simulation coordinates. */
  boxes: Box[];
  /** Streets to draw, when the world was built from a real map. */
  roads?: Road[];
  /** Roads carried over something, drawn raised rather than painted flat. */
  bridges?: Bridge[];
  /** Surface railway to draw: heavy rail and tram. */
  rails?: Rail[];
  /** Trains standing on it. */
  trains?: Train[];
  /** Parks, woods and water to draw. */
  areas?: Area[];
}

/** How much tighter a tree's collision box is than its visible cone. */
const TRUNK_FRACTION = 0.7;

export function generateCityLayout(options: WorldOptions = defaultWorldOptions): CityLayout {
  const rand = mulberry32(options.seed);
  // One sort for the whole of it. This layout has no blocks to plant by, and
  // scattering four sorts through one wood is the noise that having sorts at
  // all was meant to avoid.
  const species = Math.floor(rand() * SPECIES);
  const buildings: Building[] = [];
  const trees: Tree[] = [];
  const boxes: Box[] = [];

  for (let i = 0; i < options.buildingCount; i++) {
    const x = (rand() * 2 - 1) * options.extent;
    const z = (rand() * 2 - 1) * options.extent;

    // Taller towers cluster toward the middle, so the skyline has a centre.
    const distance = Math.hypot(x, z) / options.extent;
    const centreBias = Math.max(0, 1 - distance);
    const height = 8 + rand() * 22 + centreBias * centreBias * (30 + rand() * 90);
    const width = 8 + rand() * 16;
    const depth = 8 + rand() * 16;

    buildings.push({ x, z, width, depth, height });
    boxes.push(aabb(x - width / 2, 0, z - depth / 2, x + width / 2, height, z + depth / 2));
  }

  for (let i = 0; i < options.treeCount; i++) {
    const x = (rand() * 2 - 1) * options.extent * 1.9;
    const z = (rand() * 2 - 1) * options.extent * 1.9;
    const height = 6 + rand() * 9;
    const radius = 2.5 + rand() * 2;

    trees.push({ x, z, radius, height, species });

    // Boxed tighter than the cone's base, so clipping a leafy edge does not
    // read as hitting a wall.
    const trunk = radius * TRUNK_FRACTION;
    boxes.push(aabb(x - trunk, 0, z - trunk, x + trunk, height, z + trunk));
  }

  // No landmarks: this layout describes nothing, it only generates. And so
  // nothing to plant a terrace on either.
  return { buildings, trees, graves: [], landmarks: [], bushes: [], people: [], boxes };
}
