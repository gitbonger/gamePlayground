/**
 * Cars: something on the roads besides the trams.
 *
 * A first version, and a deliberately plain one. The streets become a graph
 * -- a node wherever two ways meet or one ends, an edge for the stretch of
 * road between -- and a car is a position along one edge, in one direction,
 * on the right-hand side of it. At a node it picks a way on at random.
 *
 * Two rules keep them out of each other, which is the whole of the traffic
 * law here:
 *
 * - **Keep your distance.** A car slows for whatever is ahead of it in its
 *   own lane -- on this edge, or at the start of the one it is turning into
 *   -- and stops short of it.
 * - **One at a time through a junction.** A node where three or more ways
 *   meet can be held by one car. A car arriving at a junction somebody else
 *   holds waits at the edge of the crossing road; it takes the junction when
 *   it is free and lets go once it is clear of it on the far side.
 *
 * There are no traffic lights, no priorities and no one-way streets -- the
 * map has no one-way data, so every road is driven both ways. And there is
 * no simulating the whole city: a fixed number of cars is kept near the bird,
 * and one that ends up far away is taken off the road and put back on one
 * nearer him, out past the fog. They are scenery, like the flock, and scenery
 * only has to be right where somebody is looking.
 */

import type { Road } from './streets';

/** How fast each class of road is driven, in m/s. Anything not listed is not driven. */
const DRIVEN: Record<string, number> = {
  living_street: 5,
  residential: 8,
  unclassified: 8,
  tertiary_link: 8,
  tertiary: 10,
  secondary_link: 9,
  secondary: 11,
  primary_link: 10,
  primary: 13,
};

/** Bumper to bumper, in metres: a car's length and the gap left in front of it. */
export const CAR_LENGTH = 4.2;
const GAP = 2.2;
/** How hard a car can brake and pull away, in m/s². Gentle: nobody is racing. */
const BRAKE = 4.5;
const ACCELERATE = 2.2;
/** How far ahead a car starts thinking about the junction coming up, in metres. */
const LOOK = 40;
/** How far into the next road a car must be before it lets go of the junction. */
const CLEAR_OF_JUNCTION = CAR_LENGTH + 4;
/**
 * A car stood still this long is stuck, and is taken off the road and put
 * back on another -- but only out of the player's sight.
 *
 * The rules above are not proof against gridlock: four cars round a block can
 * each be waiting for the next. Letting one through out of turn was tried and
 * was worse, two cars standing in the middle of a crossing each blocking the
 * other. A car taken away where nobody is watching is simply gone.
 */
const STUCK = 25;
/** How near the bird a stuck car is left where it is, in metres. */
const IN_SIGHT = 150;

export interface CarNode {
  x: number;
  z: number;
  /** The edges that meet here. */
  edges: number[];
  /** Three or more roads: somewhere only one car may be at a time. */
  junction: boolean;
  /** How far back from the node a waiting car's middle stands: clear of the crossing road. */
  stopShort: number;
  /**
   * Which crossing it belongs to, or -1 if it is not one. Junctions a short
   * link apart are one crossing: see `JOIN`.
   */
  crossing: number;
}

export interface CarEdge {
  a: number;
  b: number;
  points: [number, number][];
  /** Distance from the first point to each point, so a position can be found fast. */
  along: number[];
  length: number;
  width: number;
  speed: number;
}

export interface CarGraph {
  nodes: CarNode[];
  edges: CarEdge[];
  /** How many crossings there are; `CarNode.crossing` indexes them. */
  crossings: number;
}

/**
 * Two junctions are one crossing when the road between them is too short to
 * get clear of the first before stopping for the second.
 *
 * The map is full of them -- a road meeting a dual carriageway is two
 * junctions a few metres apart -- and two such junctions taken one at a time
 * are two cars, each through one and waiting at the other, each holding what
 * the other needs. A fixed fifteen metres was tried first and left exactly
 * that standing on a seventeen-metre link. Measured by what the rules need
 * instead: the distance a car must go past a junction to let go of it, plus
 * how far back it waits for the next, and a little.
 */
const joins = (edge: CarEdge, nodes: readonly CarNode[]) =>
  edge.length < CLEAR_OF_JUNCTION + Math.max(nodes[edge.a]!.stopShort, nodes[edge.b]!.stopShort) + 3;

const keyOf = (p: readonly [number, number]) => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;

/** The road network as nodes and edges, drivable roads only. */
export function buildCarGraph(roads: readonly Road[]): CarGraph {
  const driven = roads.filter((road) => DRIVEN[road.kind] !== undefined && road.points.length >= 2);

  // A vertex is a node if a way ends there or two ways share it.
  const uses = new Map<string, number>();
  for (const road of driven) {
    for (const key of new Set(road.points.map(keyOf))) uses.set(key, (uses.get(key) ?? 0) + 1);
  }
  const nodes: CarNode[] = [];
  const nodeAt = new Map<string, number>();
  const node = (p: readonly [number, number]) => {
    const key = keyOf(p);
    let at = nodeAt.get(key);
    if (at === undefined) {
      at = nodes.length;
      nodes.push({ x: p[0], z: p[1], edges: [], junction: false, stopShort: 0, crossing: -1 });
      nodeAt.set(key, at);
    }
    return at;
  };

  const edges: CarEdge[] = [];
  for (const road of driven) {
    let from = node(road.points[0]!);
    let run: [number, number][] = [road.points[0]!];
    road.points.forEach((point, i) => {
      if (i === 0) return;
      run.push(point);
      const last = i === road.points.length - 1;
      if (!last && (uses.get(keyOf(point)) ?? 0) < 2) return;
      const to = node(point);
      const along = [0];
      for (let j = 1; j < run.length; j += 1) {
        along.push(along[j - 1]! + Math.hypot(run[j]![0] - run[j - 1]![0], run[j]![1] - run[j - 1]![1]));
      }
      const length = along[along.length - 1]!;
      if (length > 0.5 && from !== to) {
        const id = edges.length;
        edges.push({ a: from, b: to, points: run, along, length, width: road.width, speed: DRIVEN[road.kind]! });
        nodes[from]!.edges.push(id);
        nodes[to]!.edges.push(id);
      }
      from = to;
      run = [point];
    });
  }

  for (const each of nodes) {
    each.junction = each.edges.length >= 3;
    // Back from the middle by half the widest road meeting here, then half a
    // car and a metre: waiting there, the front of it is off the carriageway
    // everybody else is crossing.
    each.stopShort =
      Math.max(0, ...each.edges.map((id) => edges[id]!.width / 2)) + CAR_LENGTH / 2 + 1;
  }

  // Crossings: junctions joined through short links, found by walking them.
  let crossings = 0;
  nodes.forEach((start, index) => {
    if (!start.junction || start.crossing >= 0) return;
    const id = crossings++;
    const queue = [index];
    start.crossing = id;
    while (queue.length) {
      const at = nodes[queue.pop()!]!;
      for (const e of at.edges) {
        const edge = edges[e]!;
        if (!joins(edge, nodes)) continue;
        for (const other of [edge.a, edge.b]) {
          const next = nodes[other]!;
          if (next.junction && next.crossing < 0) {
            next.crossing = id;
            queue.push(other);
          }
        }
      }
    }
  });
  return { nodes, edges, crossings };
}

export interface Car {
  id: number;
  edge: number;
  /** Driving from `a` to `b`, or back. */
  forward: boolean;
  /** Metres from where it entered the edge. */
  s: number;
  speed: number;
  /** The ways on after this edge, as far as it has looked. */
  route: { edge: number; forward: boolean }[];
  /** The edge it came off, for the curve round the corner it has just taken. */
  came: { edge: number; forward: boolean } | null;
  /** The crossing it holds, if it holds one. */
  holding: number | null;
  /** Seconds it has been waiting at the crossing in front of it. */
  waiting: number;
  /** Seconds stood still. */
  still: number;
  colour: number;
  /** Where it is and which way it faces, worked out after each update. */
  x: number;
  z: number;
  /** In the collider's convention: `atan2(-dz, dx)` along the way it faces. */
  yaw: number;
}

export interface Traffic {
  readonly cars: readonly Car[];
  readonly graph: CarGraph;
  /** Move everything on by `dt`, keeping the cars near `around`. */
  update(dt: number, around: { x: number; z: number }): void;
}

/** How far out of the car's lane it sits from the centreline: the right-hand half. */
const laneOffset = (edge: CarEdge) => Math.min(edge.width / 4, 3.2);

/**
 * How far either side of a corner the curve through it starts, in metres.
 *
 * A road outline is straight lines meeting at points, and a car following it
 * exactly swung round at each point in one frame -- and, because its lane is
 * measured off to the side of the way it faces, jumped sideways across the
 * road as it did. Instead each corner is cut with a curve that begins this
 * far before the point and ends this far after it, so a car drives an arc
 * through a junction. Seven metres is a street corner taken at a crawl; a
 * short stretch of road gets less, half of it, so two curves never overlap.
 */
const TURN = 7;

/** A leg of a route, as its centreline points in the order it is driven. */
function driven(edge: CarEdge, forward: boolean): [number, number][] {
  return forward ? edge.points : [...edge.points].reverse();
}

/**
 * Where a car is and which way it faces: `s` metres into `edge`, having come
 * off `before` and going on to `after`.
 *
 * Only the drawing and the collider see this. The traffic rules work in
 * metres along edges and never ask where the curves are -- so the jams are
 * exactly as they were, and only what they look like changes.
 */
function place(
  edge: CarEdge,
  forward: boolean,
  s: number,
  before: { edge: CarEdge; forward: boolean } | null,
  after: { edge: CarEdge; forward: boolean } | null,
): { x: number; z: number; dx: number; dz: number } {
  const points = driven(edge, forward);
  const d = Math.max(0, Math.min(edge.length, s));
  // Which straight it is on, in the order it is driven.
  let i = 0;
  let into = d;
  const lengthOf = (a: [number, number], b: [number, number]) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  while (i < points.length - 2 && into > lengthOf(points[i]!, points[i + 1]!)) {
    into -= lengthOf(points[i]!, points[i + 1]!);
    i += 1;
  }
  const p0 = points[i]!;
  const p1 = points[i + 1]!;
  const span = lengthOf(p0, p1) || 1;
  const dir = { x: (p1[0] - p0[0]) / span, z: (p1[1] - p0[1]) / span };
  const off = laneOffset(edge);

  /** The straight before this one, or after, with the lane it is driven in. */
  const beside = (which: 'before' | 'after') => {
    if (which === 'after') {
      if (i + 2 < points.length) return { from: p1, to: points[i + 2]!, off };
      if (!after) return null;
      const on = driven(after.edge, after.forward);
      return { from: p1, to: on[1]!, off: laneOffset(after.edge) };
    }
    if (i > 0) return { from: points[i - 1]!, to: p0, off };
    if (!before) return null;
    const on = driven(before.edge, before.forward);
    return { from: on[on.length - 2]!, to: p0, off: laneOffset(before.edge) };
  };

  /** A point along the corner at `v`, from `a` through `corner` to `b`, `t` 0..1. */
  const curve = (
    a: { x: number; z: number },
    corner: [number, number],
    b: { x: number; z: number },
    t: number,
    offA: number,
    offB: number,
  ) => {
    const u = 1 - t;
    const x = u * u * a.x + 2 * u * t * corner[0] + t * t * b.x;
    const z = u * u * a.z + 2 * u * t * corner[1] + t * t * b.z;
    let dx = 2 * u * (corner[0] - a.x) + 2 * t * (b.x - corner[0]);
    let dz = 2 * u * (corner[1] - a.z) + 2 * t * (b.z - corner[1]);
    const size = Math.hypot(dx, dz) || 1;
    dx /= size;
    dz /= size;
    const lane = offA + (offB - offA) * t;
    // The right-hand side of the way it is going: facing north, right is east.
    return { x: x - dz * lane, z: z + dx * lane, dx, dz };
  };

  /** Whether a corner is worth curving: not a turn back the way it came. */
  const turnable = (ax: number, az: number, bx: number, bz: number) => ax * bx + az * bz > -0.85;

  // Coming up to the corner at the end of this straight.
  const next = beside('after');
  if (next) {
    const nextSpan = lengthOf(next.from, next.to) || 1;
    const nd = { x: (next.to[0] - next.from[0]) / nextSpan, z: (next.to[1] - next.from[1]) / nextSpan };
    const r = Math.min(TURN, span / 2, nextSpan / 2);
    if (span - into < r && turnable(dir.x, dir.z, nd.x, nd.z)) {
      const a = { x: p1[0] - dir.x * r, z: p1[1] - dir.z * r };
      const b = { x: p1[0] + nd.x * r, z: p1[1] + nd.z * r };
      return curve(a, p1, b, 0.5 * (into - (span - r)) / r, off, next.off);
    }
  }
  // Just round the corner at the start of it.
  const last = beside('before');
  if (last) {
    const lastSpan = lengthOf(last.from, last.to) || 1;
    const ld = { x: (last.to[0] - last.from[0]) / lastSpan, z: (last.to[1] - last.from[1]) / lastSpan };
    const r = Math.min(TURN, span / 2, lastSpan / 2);
    if (into < r && turnable(ld.x, ld.z, dir.x, dir.z)) {
      const a = { x: p0[0] - ld.x * r, z: p0[1] - ld.z * r };
      const b = { x: p0[0] + dir.x * r, z: p0[1] + dir.z * r };
      return curve(a, p0, b, 0.5 + (0.5 * into) / r, last.off, off);
    }
  }

  return {
    x: p0[0] + dir.x * into - dir.z * off,
    z: p0[1] + dir.z * into + dir.x * off,
    dx: dir.x,
    dz: dir.z,
  };
}

const COLOURS = [0xb23a32, 0x2f5d8a, 0xd9d6cf, 0x2b2e33, 0x7a8288, 0x3e6b44, 0xc8a13a, 0x8a4f7d];

export function createTraffic(
  graph: CarGraph,
  count: number,
  around: { x: number; z: number },
  random: () => number = Math.random,
  /** Taken off the road beyond this distance from `around`, and put back nearer. */
  far = 460,
  /**
   * And put back between these distances. Out past where the fog starts, and
   * not so far that they are thin on the ground by the time they are seen:
   * spread over six hundred metres, a hundred and sixty cars was one every
   * four hundred metres of street, and streets looked empty.
   */
  back: readonly [number, number] = [220, 440],
): Traffic {
  const cars: Car[] = [];
  /** Who holds each crossing. */
  const holders: (number | null)[] = new Array(graph.crossings).fill(null);
  const lane = (edge: number, forward: boolean) => `${edge}:${forward ? 1 : 0}`;
  const startOf = (edge: number, forward: boolean) =>
    forward ? graph.edges[edge]!.a : graph.edges[edge]!.b;
  const endOf = (edge: number, forward: boolean) =>
    forward ? graph.edges[edge]!.b : graph.edges[edge]!.a;

  /** A way on from the end of a leg: anything but back, unless back is all there is. */
  const onFrom = (edge: number, forward: boolean) => {
    const at = endOf(edge, forward);
    const options = graph.nodes[at]!.edges.filter((id) => id !== edge);
    if (options.length === 0) return { edge, forward: !forward };
    const next = options[Math.floor(random() * options.length)]!;
    return { edge: next, forward: graph.edges[next]!.a === at };
  };

  /** Plan far enough ahead to see `LOOK` metres past where it is. */
  const plan = (car: Car) => {
    let ahead = graph.edges[car.edge]!.length - car.s;
    let last = { edge: car.edge, forward: car.forward };
    for (const leg of car.route) {
      ahead += graph.edges[leg.edge]!.length;
      last = leg;
    }
    while (ahead < LOOK && car.route.length < 12) {
      last = onFrom(last.edge, last.forward);
      car.route.push(last);
      ahead += graph.edges[last.edge]!.length;
    }
  };

  const release = (car: Car) => {
    if (car.holding !== null && holders[car.holding] === car.id) holders[car.holding] = null;
    car.holding = null;
  };

  const locate = (car: Car) => {
    const leg = (of: { edge: number; forward: boolean } | null | undefined) =>
      of ? { edge: graph.edges[of.edge]!, forward: of.forward } : null;
    const at = place(graph.edges[car.edge]!, car.forward, car.s, leg(car.came), leg(car.route[0]));
    car.x = at.x;
    car.z = at.z;
    car.yaw = Math.atan2(-at.dz, at.dx);
  };

  const lanesNow = () => {
    const lanes = new Map<string, Car[]>();
    for (const car of cars) {
      const key = lane(car.edge, car.forward);
      const list = lanes.get(key);
      if (list) list.push(car);
      else lanes.set(key, [car]);
    }
    for (const list of lanes.values()) list.sort((p, q) => p.s - q.s);
    return lanes;
  };

  /** Put a car somewhere free on a road between `within` metres of `near`. */
  const setDown = (
    car: Car,
    near: { x: number; z: number },
    lanes: Map<string, Car[]>,
    within: readonly [number, number] = back,
  ) => {
    for (let tries = 0; tries < 40; tries += 1) {
      const id = Math.floor(random() * graph.edges.length);
      const edge = graph.edges[id]!;
      const mid = edge.points[Math.floor(edge.points.length / 2)]!;
      const away = Math.hypot(mid[0] - near.x, mid[1] - near.z);
      if (away < within[0] || away > within[1] || edge.length < 30) continue;
      const forward = random() < 0.5;
      const s = 12 + random() * (edge.length - 24);
      const others = lanes.get(lane(id, forward)) ?? [];
      if (others.some((other) => Math.abs(other.s - s) < CAR_LENGTH + GAP * 2)) continue;
      release(car);
      Object.assign(car, { edge: id, forward, s, speed: edge.speed * 0.6, route: [], came: null, waiting: 0, still: 0 });
      locate(car);
      others.push(car);
      others.sort((p, q) => p.s - q.s);
      lanes.set(lane(id, forward), others);
      return;
    }
  };

  for (let i = 0; i < count; i += 1) {
    cars.push({
      id: i, edge: 0, forward: true, s: 0, speed: 0, route: [], came: null, holding: null, waiting: 0,
      still: 0, colour: COLOURS[i % COLOURS.length]!, x: 0, z: 0, yaw: 0,
    });
  }
  {
    // The first lot nearer as well, since nobody is watching yet.
    const lanes = new Map<string, Car[]>();
    for (const car of cars) setDown(car, around, lanes, [20, back[1]]);
  }

  return {
    cars,
    graph,
    update(dt, near) {
      const lanes = lanesNow();

      // What each car can see: how far it may go before the car in front of it,
      // and whether a crossing it does not hold lies in the way.
      const sight = cars.map((car) => {
        plan(car);
        const mine = lanes.get(lane(car.edge, car.forward))!;
        const leader = mine.find((other) => other.s > car.s);
        let gap = leader ? leader.s - car.s - CAR_LENGTH - GAP : Infinity;
        let travelled = graph.edges[car.edge]!.length - car.s;
        let crossing: { id: number; at: number; stop: number } | null = null;
        let node = endOf(car.edge, car.forward);

        for (const leg of car.route) {
          if (travelled > LOOK) break;
          const here = graph.nodes[node]!;
          if (!crossing && here.crossing >= 0 && here.crossing !== car.holding) {
            crossing = { id: here.crossing, at: travelled, stop: travelled - here.stopShort };
          }
          const first = lanes.get(lane(leg.edge, leg.forward))?.find((other) => other !== car);
          if (first && gap === Infinity) gap = travelled + first.s - CAR_LENGTH - GAP;
          travelled += graph.edges[leg.edge]!.length;
          node = endOf(leg.edge, leg.forward);
        }
        // Nobody in front of it before the crossing, and room for all of it
        // beyond: otherwise taking the crossing would be standing in the middle
        // of it.
        const clear = crossing !== null && gap > crossing.at + CAR_LENGTH;
        return { gap, crossing, clear };
      });

      // Each free crossing goes to whoever has waited longest of those who can
      // go through it now.
      const best = new Map<number, number>();
      cars.forEach((car, i) => {
        const seen = sight[i]!;
        if (!seen.crossing || !seen.clear || seen.crossing.stop > 12) return;
        if (holders[seen.crossing.id] !== null) return;
        const current = best.get(seen.crossing.id);
        if (current === undefined || car.waiting > cars[current]!.waiting) best.set(seen.crossing.id, i);
      });
      for (const [crossing, i] of best) {
        const car = cars[i]!;
        release(car);
        holders[crossing] = car.id;
        car.holding = crossing;
        car.waiting = 0;
      }

      cars.forEach((car, i) => {
        const seen = sight[i]!;
        let gap = seen.gap;
        if (seen.crossing && holders[seen.crossing.id] !== car.id) {
          gap = Math.min(gap, seen.crossing.stop);
          if (seen.crossing.stop < 4) car.waiting += dt;
        }

        // As fast as the road allows and no faster than it can stop in.
        const edge = graph.edges[car.edge]!;
        const allowed = gap <= 0 ? 0 : Math.sqrt(2 * BRAKE * gap);
        const target = Math.min(edge.speed, allowed);
        car.speed += Math.max(-BRAKE * 2 * dt, Math.min(ACCELERATE * dt, target - car.speed));
        car.speed = Math.max(0, car.speed);
        car.s += car.speed * dt;
        car.still = car.speed < 0.2 ? car.still + dt : 0;

        while (car.s >= graph.edges[car.edge]!.length) {
          const next = car.route.shift() ?? onFrom(car.edge, car.forward);
          car.s -= graph.edges[car.edge]!.length;
          car.came = { edge: car.edge, forward: car.forward };
          car.edge = next.edge;
          car.forward = next.forward;
        }
        // Clear of the crossing it holds: out of every node of it, and a car's
        // length and more beyond the last.
        if (car.holding !== null) {
          const from = graph.nodes[startOf(car.edge, car.forward)]!;
          const to = graph.nodes[endOf(car.edge, car.forward)]!;
          const inside = to.crossing === car.holding || (from.crossing === car.holding && car.s < CLEAR_OF_JUNCTION);
          if (!inside) release(car);
        }
        locate(car);
      });

      // Too far away, or stuck where nobody can see: off the road, and back on
      // one nearer the bird.
      for (const car of cars) {
        const away = Math.hypot(car.x - near.x, car.z - near.z);
        if (away > far || (car.still > STUCK && away > IN_SIGHT)) setDown(car, near, lanesNow());
      }
    },
  };
}
