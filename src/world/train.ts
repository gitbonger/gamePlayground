/**
 * A train standing on the track.
 *
 * Laid out as a distance *along* a line rather than a position on the ground,
 * which is the whole design. A train is where its leading coupling has got to;
 * everything else follows from that, so setting it moving later is a matter of
 * advancing one number per train per tick and asking for the layout again.
 *
 * Each vehicle sits on its bogies, as a real one does -- the body is the chord
 * between two points on the line rather than a tangent at its middle -- which
 * is what keeps a 14 m wagon looking right on a curve instead of hanging off
 * the outside of it.
 */

import { turnedBox, type Box } from '../sim/collision';
import type { Rail } from './streets';

export type Point2 = [number, number];

/** A diesel: one long body with the cab standing above it. */
export const ENGINE = {
  length: 19,
  width: 3.05,
  /** Height of the hood, which runs the length of it. */
  body: 3.2,
  /** And of the cab, which does not. */
  cab: 4.3,
  cabLength: 5.2,
  /** Where the exhaust stack stands, along the hood from the middle. */
  stackAlong: -1.2,
  stackHeight: 0.75,
};

/** Where the smoke comes out, in the engine's own frame. */
export function stackTop(): { along: number; across: number; height: number } {
  return { along: ENGINE.stackAlong, across: 0, height: ENGINE.body + ENGINE.stackHeight };
}

/**
 * A stake wagon, built for lumber and standing empty.
 *
 * The deck is the point of it: a flat 14 m by 2.9 m, open to the sky, low
 * enough to drop onto and wide enough to put down on without threading
 * anything. The stakes are the uprights that would hold a load in, spaced
 * along both sides -- posts rather than boards, so what is between them is
 * air.
 */
export const WAGON = {
  length: 14,
  width: 2.9,
  /** Top of the deck above the ground: what the pigeon actually lands on. */
  deck: 1.25,
  /** How far the stakes stand above the deck. */
  stake: 1.15,
  stakeThickness: 0.16,
  stakesPerSide: 7,
};

/**
 * A passenger coach: closed, with a roof to land on and nothing to land in.
 *
 * The opposite problem to the stake wagon. A wagon's deck is a metre and a
 * quarter up and open to the sky; a carriage roof is four metres up, curved
 * enough to read as a roof and flat enough along the middle to stand on.
 */
export const CARRIAGE = {
  length: 17.5,
  width: 2.95,
  /** Top of the underframe, which the body sits on. */
  floor: 1.1,
  /** Top of the body sides. */
  body: 3.65,
  /** Top of the roof, which is what the pigeon lands on. */
  roof: 4.05,
  /** The band of glass down each side: how high it starts and how tall. */
  windowSill: 2.25,
  windowHeight: 0.95,
};

/**
 * One car of an articulated tram.
 *
 * Not a train that happens to be small. It has no locomotive -- the whole
 * thing is powered and a four-car set is four sections of one vehicle -- it
 * is narrower and much lower than anything on the heavy railway, and the
 * sections are joined by a concertina rather than by couplings, so there is
 * no gap to speak of between one and the next.
 *
 * Low is the part that matters to a pigeon. A carriage roof is four metres
 * up; this is three and a bit, which is a roof you can put down on from a
 * street rather than one you have to come at from above.
 */
export const TRAM = {
  length: 13.4,
  width: 2.4,
  /** Top of the underframe: the floor is low, which is the point of a tram. */
  floor: 0.35,
  /** Top of the body sides. */
  body: 3.05,
  /** Top of the roof, which is what the pigeon lands on. */
  roof: 3.3,
  /** The band of glass down each side: how high it starts and how tall. */
  windowSill: 1.35,
  windowHeight: 1.35,
  /** The pantograph on the middle car, which is what says it is electric. */
  pantographHeight: 0.55,
};

/** Slack over the couplings between one vehicle and the next, in metres. */
export const COUPLING = 0.9;

/** And over the concertina between one tram section and the next. */
export const ARTICULATION = 0.25;

/**
 * What a rake is made of.
 *
 * Named rather than counted, because a train has to be able to say what it is
 * when it is laid out again -- which happens every tick for anything that
 * moves, and once for anything that does not.
 */
export type Stock = 'wagon' | 'carriage' | 'tram';

/** The length and width of one vehicle of a given sort. */
export const stockSize = (stock: Stock): { length: number; width: number } =>
  stock === 'carriage'
    ? { length: CARRIAGE.length, width: CARRIAGE.width }
    : stock === 'tram'
      ? { length: TRAM.length, width: TRAM.width }
      : { length: WAGON.length, width: WAGON.width };

/**
 * Whether a rake of this stock is hauled by a locomotive.
 *
 * A tram is not: every section is powered, so a four-car tram is four cars
 * and not an engine and three. This is the only thing about laying a rake out
 * that depends on what it is made of, so it is the only thing asked.
 */
export const stockIsHauled = (stock: Stock): boolean => stock !== 'tram';

/** The gap between one vehicle of this sort and the next. */
export const stockGap = (stock: Stock): number =>
  stock === 'tram' ? ARTICULATION : COUPLING;

/** Which sort of line this stock runs on. */
export const stockRuns = (stock: Stock): string => (stock === 'tram' ? 'tram' : 'rail');

/** How high the top of a vehicle is: what anything standing on it stands on. */
export const stockTop = (kind: Vehicle['kind']): number =>
  kind === 'carriage'
    ? CARRIAGE.roof
    : kind === 'tram'
      ? TRAM.roof
      : kind === 'wagon'
        ? WAGON.deck
        : ENGINE.cab;

export interface Vehicle {
  kind: 'engine' | 'wagon' | 'carriage' | 'tram';
  /** Centre of the vehicle, in world metres. */
  x: number;
  z: number;
  /** Which way it points, in the collider's yaw convention. */
  yaw: number;
  /** Along the track, and across it. */
  length: number;
  width: number;
}

export interface Train {
  /** The line it runs on. */
  line: Rail;
  /** How far along that line the leading coupling has got, in metres. */
  along: number;
  /** Which way it is going: +1 up the line as drawn, -1 back down it. */
  direction: number;
  /** How fast, in metres per second. Zero for one standing in a platform. */
  speed: number;
  /** What it is made of behind the engine. */
  stock: Stock;
  /**
   * How many of those there are.
   *
   * Written down rather than counted off `vehicles`, because `layOutTrain`
   * returns nothing at all when a rake will not fit and a count taken from
   * that is a count that can go to -1. It did: one failed layout turned a
   * train into a locomotive running on its own, for the rest of the session,
   * because the next tick asked for one fewer car than the last.
   */
  cars: number;
  vehicles: Vehicle[];
}

/**
 * Where a train has got to after running `step` metres, given that the line
 * ends.
 *
 * It reverses rather than stopping, and the whole consist has to stay on the
 * rails, so it turns round at `consist` metres from one end and at the far end
 * itself. Reflected rather than clamped: a train that ran into the buffers
 * should come back out at the speed it went in, not stall against them for a
 * tick. The loop is for a step longer than the line, which is not a thing that
 * happens at yard speeds but is a thing that happens when someone drags the
 * speed slider.
 *
 * The consist is not turned round with it. A locomotive at one end that finds
 * itself at the back is a train being propelled, which is what shunting is.
 */
export function shuttle(
  lineLength: number,
  consist: number,
  along: number,
  direction: number,
  step: number,
): { along: number; direction: number } {
  if (lineLength <= consist) return { along, direction };

  let at = along + direction * step;
  let way = direction;
  for (let guard = 0; guard < 64; guard += 1) {
    if (at > lineLength) {
      at = 2 * lineLength - at;
      way = -way;
    } else if (at < consist) {
      at = 2 * consist - at;
      way = -way;
    } else break;
  }
  return { along: at, direction: way };
}

/**
 * Where to draw a train between two ticks.
 *
 * The simulation steps a train in whole ticks; a frame falls wherever it falls
 * between two of them. Drawn at the last tick's position a train stands still
 * for some frames and jumps two ticks' worth on others, which next to a camera
 * gliding along with an interpolated bird reads as the whole rake shivering.
 *
 * Reversals are safe to cross: the two ends of the step straddle the buffers
 * rather than the reflection, so the drawn train slows into them and back out.
 */
export function tweenAlong(previous: number, current: number, alpha: number): number {
  return previous + (current - previous) * alpha;
}

/** Total length of a polyline, in metres. */
export function lineLength(points: readonly Point2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  }
  return total;
}

/** The point `distance` metres along a polyline, or null if it runs out. */
export function pointAlong(
  points: readonly Point2[],
  distance: number,
): { x: number; z: number } | null {
  if (distance < 0) return null;
  let run = 0;
  for (let i = 1; i < points.length; i += 1) {
    const [x0, z0] = points[i - 1]!;
    const [x1, z1] = points[i]!;
    const step = Math.hypot(x1 - x0, z1 - z0);
    if (step < 1e-9) continue;
    if (run + step >= distance) {
      const t = (distance - run) / step;
      return { x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t };
    }
    run += step;
  }
  return null;
}

/**
 * Which way along a line to set off, to go roughly the way asked for.
 *
 * A route is a polyline and `direction` +1 means "up it as drawn", which is a
 * fact about the order somebody traced the way into OpenStreetMap rather than
 * about the world. So a spec says which way it wants to go, as a compass
 * bearing, and this works out the sign.
 *
 * Bearings are clockwise from north, and north is -Z, which is the convention
 * the whole map is in.
 */
export function directionFor(
  points: readonly Point2[],
  along: number,
  bearing: number,
): number {
  // The tangent where the train is, taken over a metre so a polyline vertex
  // exactly under it cannot make the step zero.
  const ahead = pointAlong(points, Math.min(along + 0.5, lineLength(points)));
  const behind = pointAlong(points, Math.max(along - 0.5, 0));
  if (!ahead || !behind) return 1;

  const up = { x: ahead.x - behind.x, z: ahead.z - behind.z };
  const want = {
    x: Math.sin((bearing * Math.PI) / 180),
    z: -Math.cos((bearing * Math.PI) / 180),
  };
  // Ties go up the line, which is what a spec that asked for nothing gets.
  return up.x * want.x + up.z * want.z >= 0 ? 1 : -1;
}

/** How far along a line the closest point to (x, z) is, in metres. */
export function chainageOf(points: readonly Point2[], x: number, z: number): number {
  let run = 0;
  let best = Infinity;
  let at = 0;
  for (let i = 1; i < points.length; i += 1) {
    const [x0, z0] = points[i - 1]!;
    const [x1, z1] = points[i]!;
    const dx = x1 - x0;
    const dz = z1 - z0;
    const square = dx * dx + dz * dz;
    const step = Math.sqrt(square);
    if (step > 1e-9) {
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / square));
      const away = Math.hypot(x - (x0 + t * dx), z - (z0 + t * dz));
      if (away < best) {
        best = away;
        at = run + t * step;
      }
    }
    run += step;
  }
  return at;
}

/**
 * How straight a join has to be to be taken as the same road, as a cosine.
 *
 * A switch puts three or four track ends on one node and the map says nothing
 * about which of them is the continuation -- it is a shared coordinate and
 * that is all. So the route takes the straightest: at a facing point the
 * through road leaves within a few degrees of the way you came in and the
 * diverging one at a few more, and a line merely crossing at that node leaves
 * at something near a right angle, which this rules out.
 */
const SAME_ROAD = 0.8;

/**
 * A rail end, as a coordinate rounded to the centimetre.
 *
 * Rounded and then written without a fixed number of places, because
 * `toFixed` keeps the sign of a very small negative: a node that comes out at
 * -5e-14 reads as "-0.00" and the one it is joined to at "0.00", and the two
 * ends of one switch stop being the same place.
 */
const nodeAt = (point: Point2): string =>
  `${Math.round(point[0] * 100) / 100},${Math.round(point[1] * 100) / 100}`;

/** The unit vector from `a` to `b`. */
function heading(a: Point2, b: Point2): Point2 {
  const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return span < 1e-9 ? [0, 0] : [(b[0] - a[0]) / span, (b[1] - a[1]) / span];
}

/**
 * One end of one way, where it meets the network.
 *
 * Which end matters: a way joined at its tail is travelled backwards, and
 * knowing that is the difference between following the track and jumping the
 * length of a way sideways.
 */
export interface RailEnd {
  rail: Rail;
  /** Whether it is the head of that way that is here, or the tail. */
  fromHead: boolean;
}

/**
 * Which ways meet where: the map's railway as something connected.
 *
 * The map itself has no notion of this. A `Rail` is a bare polyline, a switch
 * is two or three of them writing down the same coordinate, and nothing says
 * so -- there is no junction in the data, only a coincidence. This is that
 * coincidence made into an index, built once and asked many times.
 *
 * It is a junction index and not a route planner. It answers "what else is
 * here?", which is all that following a line needs; it knows nothing about
 * where anything leads, what is shortest, or what is occupied.
 */
export interface RailNetwork {
  /** Every way end at a point, including any belonging to the way asking. */
  at(point: Point2): readonly RailEnd[];
  /** How many ways are in it, which bounds any walk over it. */
  readonly ways: number;
}

/** Index the ends of every way, so the network can be walked. */
export function railNetwork(rails: readonly Rail[]): RailNetwork {
  const ends = new Map<string, RailEnd[]>();
  let ways = 0;
  for (const rail of rails) {
    if (rail.points.length < 2) continue;
    ways += 1;
    for (const fromHead of [true, false]) {
      const end = (fromHead ? rail.points[0] : rail.points[rail.points.length - 1]) as Point2;
      const at = ends.get(nodeAt(end));
      if (at) at.push({ rail, fromHead });
      else ends.set(nodeAt(end), [{ rail, fromHead }]);
    }
  }
  return { at: (point) => ends.get(nodeAt(point)) ?? [], ways };
}

/** A run of track: the shape of it, and every way it is made of. */
export interface Route {
  points: Point2[];
  /**
   * The ways it runs over, the one it was traced from included.
   *
   * Reported because a route is not only a shape: a line something runs
   * through at speed is a line nothing else may be parked on, and the caller
   * cannot work out which those are without walking the network again.
   */
  over: Rail[];
}

export function traceRoute(network: RailNetwork, from: Rail): Route {
  const points = from.points.map((point) => [...point] as Point2);
  if (points.length < 2) return { points, over: [from] };

  const used = new Set<Rail>([from]);
  /** Grow the route off one end of itself until the track runs out. */
  const follow = (forward: boolean): Point2[] => {
    const run: Point2[] = [];
    // The tip is the far end of whatever has been added so far, and the way
    // the route is going there is the last piece of it laid down.
    let tip = (forward ? points[points.length - 1] : points[0]) as Point2;
    let back = (forward ? points[points.length - 2] : points[1]) as Point2;

    for (let guard = 0; guard < network.ways; guard += 1) {
      const going = heading(back, tip);
      let best: { end: RailEnd; straightness: number } | null = null;

      for (const end of network.at(tip)) {
        // Same sort of line only, so nothing finds its way onto a tramway.
        if (end.rail.kind !== from.kind || used.has(end.rail)) continue;
        const on = end.rail.points as readonly Point2[];
        const leaving = end.fromHead
          ? heading(on[0]!, on[1]!)
          : heading(on[on.length - 1]!, on[on.length - 2]!);
        const straightness = leaving[0] * going[0] + leaving[1] * going[1];
        if (straightness < SAME_ROAD) continue;
        if (!best || straightness > best.straightness) best = { end, straightness };
      }
      if (!best) break;

      used.add(best.end.rail);
      const on = (best.end.rail.points as readonly Point2[]).map((point) => [...point] as Point2);
      // Laid the way the route is travelling, and without repeating the node
      // it was joined at.
      const laid = best.end.fromHead ? on.slice(1) : on.slice(0, -1).reverse();
      run.push(...laid);
      back = laid.length > 1 ? laid[laid.length - 2]! : tip;
      tip = laid[laid.length - 1]!;
    }
    return run;
  };

  const ahead = follow(true);
  const behind = follow(false);
  return { points: [...behind.reverse(), ...points, ...ahead], over: [...used] };
}

/**
 * How long a consist of this many vehicles is, over the couplings.
 *
 * The stock is required rather than defaulted. A carriage is five metres
 * longer than a wagon, so a rake measured as the wrong sort is measured 21 m
 * short over six of them -- and a train turned round 21 m before it should be
 * is a train hanging off the end of its line. That was a real bug, and a
 * default is what let it be written.
 */
export function consistLength(cars: number, stock: Stock): number {
  const gap = stockGap(stock);
  const rake = cars * (gap + stockSize(stock).length);
  // A tram has no locomotive in front of its cars, and no coupling where one
  // would have been -- so it is its cars, less the joint the last of them
  // does not have anything behind it to make.
  return stockIsHauled(stock) ? ENGINE.length + rake : rake - gap;
}

/**
 * Where every vehicle of a train sits, given how far along the line it has got.
 *
 * Returns nothing rather than something wrong when the train will not fit on
 * the line: half a train hanging off the end of a siding is worse than none.
 */
export function layOutTrain(
  line: Rail,
  along: number,
  cars: number,
  stock: Stock = 'wagon',
): Vehicle[] {
  const vehicles: Vehicle[] = Array.from({ length: vehicleCount(cars, stock) }, () => ({
    kind: 'wagon' as Vehicle['kind'],
    x: 0,
    z: 0,
    yaw: 0,
    length: 0,
    width: 0,
  }));
  return moveTrain(vehicles, line, along, cars, stock) ? vehicles : [];
}

/** How many vehicles a rake of this many cars comes to, engine included. */
export const vehicleCount = (cars: number, stock: Stock): number =>
  cars + (stockIsHauled(stock) ? 1 : 0);

/**
 * Put an existing rake where it has got to, without building a new one.
 *
 * A train never changes: the same locomotive and the same twelve wagons, the
 * same shape, for as long as the game is open. Only where they are changes.
 * So the vehicles are made once and written over in place, which is the
 * difference between allocating forty-six objects a tick and none.
 *
 * Returns false and leaves the rake untouched if it will not fit on the line,
 * which is the same promise `layOutTrain` makes: half a train hanging off the
 * end of a siding is worse than none.
 */
export function moveTrain(
  vehicles: Vehicle[],
  line: Rail,
  along: number,
  cars: number,
  stock: Stock = 'wagon',
): boolean {
  if (vehicles.length !== vehicleCount(cars, stock)) return false;

  const gap = stockGap(stock);
  const size = stockSize(stock);
  let front = along;
  let at = 0;

  const place = (kind: Vehicle['kind'], length: number, width: number): boolean => {
    const centre = front - length / 2;
    // The two bogies, a little in from each end.
    const lead = pointAlong(line.points, centre + length * 0.35);
    const trail = pointAlong(line.points, centre - length * 0.35);
    if (!lead || !trail) return false;

    const vehicle = vehicles[at]!;
    at += 1;
    vehicle.kind = kind;
    vehicle.length = length;
    vehicle.width = width;
    vehicle.x = (lead.x + trail.x) / 2;
    vehicle.z = (lead.z + trail.z) / 2;
    vehicle.yaw = Math.atan2(-(lead.z - trail.z), lead.x - trail.x);
    front = centre - length / 2 - gap;
    return true;
  };

  // A hauled rake is a locomotive and then its cars. A tram is neither: every
  // section is powered, so four cars means four cars.
  if (stockIsHauled(stock) && !place('engine', ENGINE.length, ENGINE.width)) return false;
  for (let i = 0; i < cars; i += 1) {
    if (!place(stock, size.length, size.width)) return false;
  }
  return true;
}

/**
 * Whether any part of a rake is within `reach` of a point on the ground.
 *
 * Asked so that a train far from the bird can be spared the work of being
 * laid out in world coordinates and boxed for collision -- which is
 * presentation, and costs something -- while still being advanced along its
 * line, which is where it actually is, and costs nothing.
 *
 * Measured from the leading coupling and allowed the whole length of the
 * consist behind it, in a straight line. On a curved route that reaches
 * further back than the rake really does, which errs towards calling a train
 * near: the cost of being wrong that way is a collider nobody needed.
 */
export function rakeNear(
  train: Pick<Train, 'line' | 'along' | 'cars' | 'stock'>,
  x: number,
  z: number,
  reach: number,
): boolean {
  const head = pointAlong(train.line.points, train.along);
  if (!head) return true;
  const away = Math.hypot(head.x - x, head.z - z) - consistLength(train.cars, train.stock);
  return away <= reach;
}

/** A point on a vehicle, given in metres along it and across it. */
export function onVehicle(
  vehicle: Vehicle,
  along: number,
  across: number,
): { x: number; z: number } {
  const cos = Math.cos(vehicle.yaw);
  const sin = Math.sin(vehicle.yaw);
  // Matching the collider's yaw convention, which is Three.js's rotation.y.
  return {
    x: vehicle.x + along * cos + across * sin,
    z: vehicle.z - along * sin + across * cos,
  };
}

/**
 * The solid parts of a train: one box a vehicle, and two for a locomotive.
 *
 * A wagon is its deck and nothing else. The stakes along its sides are drawn
 * and are not solid -- a pigeon flies between them the way it flies through a
 * tree, and the deck it lands on is the same deck either way. They used to be
 * boxed, all fourteen of them, which made a rake of twelve into 182 boxes
 * rebuilt 120 times a second for the chance of clipping a post.
 *
 * Every box stands on the ground, the collider having no notion of one that
 * floats, which costs nothing here because the space under a wagon is not
 * somewhere to fly.
 */
/** How many collision boxes a rake of this many cars comes to. */
export const boxCount = (cars: number, stock: Stock): number =>
  cars + (stockIsHauled(stock) ? 2 : 0);

/**
 * Put an existing rake's collision boxes where the rake has got to.
 *
 * The counterpart of `moveTrain`, and there for the same reason: the boxes
 * are the same boxes for as long as the game is open, so they are written
 * over rather than built again. A rake of twelve was 182 boxes a tick before
 * the stakes stopped being solid, and even fourteen is 1,680 objects a second
 * that need not exist.
 */
export function moveTrainBoxes(
  boxes: Box[],
  vehicles: readonly Vehicle[],
  /** The tag the first vehicle's boxes carry; the rest follow it in order. */
  base: number,
  /** How fast the rake is running, which is what makes a touch fatal. */
  speed: number,
): boolean {
  let at = 0;
  const put = (
    x: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    yaw: number,
    index: number,
  ) => {
    const box = boxes[at];
    if (!box) return;
    at += 1;
    box.minX = x - width / 2;
    box.maxX = x + width / 2;
    box.minY = 0;
    box.maxY = height;
    box.minZ = z - depth / 2;
    box.maxZ = z + depth / 2;
    box.yaw = yaw;
    box.carrier = base + index;
    box.speed = speed;
  };

  for (const [index, vehicle] of vehicles.entries()) {
    if (vehicle.kind === 'engine') {
      put(vehicle.x, vehicle.z, vehicle.length, ENGINE.body, vehicle.width, vehicle.yaw, index);
      const cab = onVehicle(vehicle, vehicle.length / 2 - ENGINE.cabLength / 2, 0);
      put(cab.x, cab.z, ENGINE.cabLength, ENGINE.cab, vehicle.width, vehicle.yaw, index);
      continue;
    }
    put(
      vehicle.x,
      vehicle.z,
      vehicle.length,
      stockTop(vehicle.kind),
      vehicle.width,
      vehicle.yaw,
      index,
    );
  }
  return at === boxes.length;
}

export function trainBoxes(
  vehicles: readonly Vehicle[],
  carrierOf?: (vehicle: number) => number,
  /**
   * How fast the rake is running, in m/s.
   *
   * Carried on every box so that whatever the bird hits knows it was going
   * somewhere. A standing train is a wall; a running one is a train.
   */
  speed = 0,
): Box[] {
  const boxes: Box[] = [];
  // Every box a vehicle owns carries the same tag, so anything that comes to
  // rest on a solebar, a stake or the deck knows which wagon it is aboard.
  const tag = (box: Box, index: number): Box => ({
    ...box,
    ...(carrierOf ? { carrier: carrierOf(index) } : {}),
    ...(speed ? { speed } : {}),
  });

  for (const [index, vehicle] of vehicles.entries()) {
    if (vehicle.kind === 'engine') {
      boxes.push(
        tag(turnedBox(vehicle.x, vehicle.z, vehicle.length, ENGINE.body, vehicle.width, vehicle.yaw), index),
      );
      const cab = onVehicle(vehicle, vehicle.length / 2 - ENGINE.cabLength / 2, 0);
      boxes.push(
        tag(turnedBox(cab.x, cab.z, ENGINE.cabLength, ENGINE.cab, vehicle.width, vehicle.yaw), index),
      );
      continue;
    }

    if (vehicle.kind === 'carriage' || vehicle.kind === 'tram') {
      // One solid body up to the roof. There is no getting inside it, so
      // there is nothing to model but the outside -- and a tram is the same
      // problem as a carriage, lower.
      boxes.push(
        tag(
          turnedBox(
            vehicle.x,
            vehicle.z,
            vehicle.length,
            stockTop(vehicle.kind),
            vehicle.width,
            vehicle.yaw,
          ),
          index,
        ),
      );
      continue;
    }

    // One box, up to the deck. The stakes are drawn but not solid: fourteen
    // posts a wagon came to 168 boxes on a rake of twelve, rebuilt 120 times
    // a second, and what they bought was the chance of clipping a post. A
    // pigeon already flies through a tree's foliage, and a wagon that is
    // moving kills on contact with the deck alone.
    boxes.push(
      tag(turnedBox(vehicle.x, vehicle.z, vehicle.length, WAGON.deck, vehicle.width, vehicle.yaw), index),
    );
  }

  return boxes;
}

/**
 * Where a point standing on a vehicle ends up once the vehicle has moved.
 *
 * Read into the vehicle's own frame and written back out of the new one, so a
 * passenger keeps its place on the deck rather than its place in the world --
 * which is the whole of what it means to be standing on something that moves.
 * On a curve that turns it as well, which is why this is not simply an offset.
 */
export function carriedBy(
  point: { x: number; y: number; z: number },
  from: Vehicle,
  to: Vehicle,
): { x: number; y: number; z: number } {
  const cos = Math.cos(from.yaw);
  const sin = Math.sin(from.yaw);
  const dx = point.x - from.x;
  const dz = point.z - from.z;
  // The inverse of `onVehicle`: how far along the vehicle it stands, and how
  // far across.
  const along = dx * cos - dz * sin;
  const across = dx * sin + dz * cos;

  // Height is left alone: rails are level, so a vehicle only ever moves and
  // turns in the ground plane.
  const back = onVehicle(to, along, across);
  return { x: back.x, y: point.y, z: back.z };
}

/** How far a vehicle has turned between two layouts, in radians. */
export function turnedBetween(from: Vehicle, to: Vehicle): number {
  const difference = (to.yaw - from.yaw + Math.PI) % (2 * Math.PI);
  return (difference < 0 ? difference + 2 * Math.PI : difference) - Math.PI;
}
