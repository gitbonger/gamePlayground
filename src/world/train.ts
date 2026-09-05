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
};

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
  /** The line it stands on, so it can be moved along it later. */
  line: Rail;
  /** How far along that line the leading coupling has got, in metres. */
  along: number;
  vehicles: Vehicle[];
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
export function trainBoxes(vehicles: readonly Vehicle[]): Box[] {
  const boxes: Box[] = [];

  for (const vehicle of vehicles) {
    if (vehicle.kind === 'engine') {
      boxes.push(
        turnedBox(vehicle.x, vehicle.z, vehicle.length, ENGINE.body, vehicle.width, vehicle.yaw),
      );
      const cab = onVehicle(vehicle, vehicle.length / 2 - ENGINE.cabLength / 2, 0);
      boxes.push(
        turnedBox(cab.x, cab.z, ENGINE.cabLength, ENGINE.cab, vehicle.width, vehicle.yaw),
      );
      continue;
    }

    boxes.push(
      turnedBox(vehicle.x, vehicle.z, vehicle.length, WAGON.deck, vehicle.width, vehicle.yaw),
    );

    const across = vehicle.width / 2 - WAGON.stakeThickness / 2;
    const spacing = (vehicle.length - WAGON.stakeThickness) / (WAGON.stakesPerSide - 1);
    for (let i = 0; i < WAGON.stakesPerSide; i += 1) {
      const along = -(vehicle.length - WAGON.stakeThickness) / 2 + i * spacing;
      for (const side of [across, -across]) {
        const post = onVehicle(vehicle, along, side);
        boxes.push(
          turnedBox(
            post.x,
            post.z,
            WAGON.stakeThickness,
            WAGON.deck + WAGON.stake,
            WAGON.stakeThickness,
            vehicle.yaw,
          ),
        );
      }
    }
  }

  return boxes;
}
