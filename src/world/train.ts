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

/** Slack over the couplings between one vehicle and the next, in metres. */
export const COUPLING = 0.9;

export interface Vehicle {
  kind: 'engine' | 'wagon';
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
  /** How fast, in metres per second. */
  speed: number;
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

/** How long a consist of this many wagons is, over the couplings. */
export function consistLength(wagons: number): number {
  return ENGINE.length + wagons * (COUPLING + WAGON.length);
}

/**
 * Where every vehicle of a train sits, given how far along the line it has got.
 *
 * Returns nothing rather than something wrong when the train will not fit on
 * the line: half a train hanging off the end of a siding is worse than none.
 */
export function layOutTrain(line: Rail, along: number, wagons: number): Vehicle[] {
  const vehicles: Vehicle[] = [];
  let front = along;

  const place = (kind: Vehicle['kind'], length: number, width: number): boolean => {
    const centre = front - length / 2;
    // The two bogies, a little in from each end.
    const lead = pointAlong(line.points, centre + length * 0.35);
    const trail = pointAlong(line.points, centre - length * 0.35);
    if (!lead || !trail) return false;

    vehicles.push({
      kind,
      length,
      width,
      x: (lead.x + trail.x) / 2,
      z: (lead.z + trail.z) / 2,
      yaw: Math.atan2(-(lead.z - trail.z), lead.x - trail.x),
    });
    front = centre - length / 2 - COUPLING;
    return true;
  };

  if (!place('engine', ENGINE.length, ENGINE.width)) return [];
  for (let i = 0; i < wagons; i += 1) {
    if (!place('wagon', WAGON.length, WAGON.width)) return [];
  }
  return vehicles;
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
 * The solid parts of a train.
 *
 * A wagon is its deck and its stakes and nothing else: the deck stops at
 * 1.25 m while the stakes carry on to 2.4, so what is between them is an open
 * box a metre deep with a floor to land on. Every box stands on the ground,
 * the collider having no notion of one that floats, which costs nothing here
 * because the space under a wagon is not somewhere to fly.
 */
export function trainBoxes(
  vehicles: readonly Vehicle[],
  carrierOf?: (vehicle: number) => number,
): Box[] {
  const boxes: Box[] = [];
  // Every box a vehicle owns carries the same tag, so anything that comes to
  // rest on a solebar, a stake or the deck knows which wagon it is aboard.
  const tag = (box: Box, index: number): Box =>
    carrierOf ? { ...box, carrier: carrierOf(index) } : box;

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

    boxes.push(
      tag(turnedBox(vehicle.x, vehicle.z, vehicle.length, WAGON.deck, vehicle.width, vehicle.yaw), index),
    );

    const across = vehicle.width / 2 - WAGON.stakeThickness / 2;
    const spacing = (vehicle.length - WAGON.stakeThickness) / (WAGON.stakesPerSide - 1);
    for (let i = 0; i < WAGON.stakesPerSide; i += 1) {
      const along = -(vehicle.length - WAGON.stakeThickness) / 2 + i * spacing;
      for (const side of [across, -across]) {
        const post = onVehicle(vehicle, along, side);
        boxes.push(
          tag(
            turnedBox(
              post.x,
              post.z,
              WAGON.stakeThickness,
              WAGON.deck + WAGON.stake,
              WAGON.stakeThickness,
              vehicle.yaw,
            ),
            index,
          ),
        );
      }
    }
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
