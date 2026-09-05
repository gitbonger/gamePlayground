import { describe, expect, it } from 'vitest';
import {
  chainageOf,
  consistLength,
  ENGINE,
  layOutTrain,
  lineLength,
  onVehicle,
  pointAlong,
  trainBoxes,
  WAGON,
} from './train';
import { worldBounds } from '../sim/collision';
import { createColliderField } from '../sim/collision';
import { createBird, defaultParams, neutralControls, step } from '../sim/flight';
import { vec } from '../sim/math3';
import type { Rail } from './streets';

/** 400 m of straight track running due east. */
const STRAIGHT: Rail = { kind: 'rail', width: 8, points: [[0, 0], [400, 0]] };
/** The same, with a right-angle bend in the middle of it. */
const BEND: Rail = { kind: 'rail', width: 8, points: [[0, 0], [200, 0], [200, 200]] };

/** A compass heading of 90 degrees is east, which is +X. */
const EAST = Math.PI / 2;

describe('measuring along a line', () => {
  it('adds up the segments', () => {
    expect(lineLength(STRAIGHT.points)).toBeCloseTo(400, 9);
    expect(lineLength(BEND.points)).toBeCloseTo(400, 9);
  });

  it('finds the point a given distance along', () => {
    expect(pointAlong(STRAIGHT.points, 150)).toEqual({ x: 150, z: 0 });
    // Past the corner, so the second leg.
    expect(pointAlong(BEND.points, 250)).toEqual({ x: 200, z: 50 });
  });

  it('runs out rather than extrapolating off the end', () => {
    expect(pointAlong(STRAIGHT.points, 401)).toBeNull();
    expect(pointAlong(STRAIGHT.points, -1)).toBeNull();
  });

  it('measures how far along the nearest point to somewhere is', () => {
    expect(chainageOf(STRAIGHT.points, 120, 30)).toBeCloseTo(120, 6);
    // Off the end: the nearest point on the line is its end.
    expect(chainageOf(STRAIGHT.points, 480, 0)).toBeCloseTo(400, 6);
  });
});

describe('laying out a train', () => {
  const vehicles = layOutTrain(STRAIGHT, 300, 5);

  it('puts an engine at the front and wagons behind it', () => {
    expect(vehicles).toHaveLength(6);
    expect(vehicles[0]!.kind).toBe('engine');
    expect(vehicles.slice(1).every((v) => v.kind === 'wagon')).toBe(true);
  });

  it('stands them nose to tail, with slack over the couplings', () => {
    const gaps: number[] = [];
    for (let i = 1; i < vehicles.length; i += 1) {
      const front = vehicles[i - 1]!;
      const back = vehicles[i]!;
      const between = Math.hypot(front.x - back.x, front.z - back.z);
      gaps.push(between - front.length / 2 - back.length / 2);
    }

    // Stated in metres rather than against the constant that produced it,
    // which would make this test agree with anything. Vehicles are coupled,
    // not welded: there is a real gap, and the same one every time.
    expect(gaps).toHaveLength(5);
    for (const gap of gaps) {
      expect(gap).toBeGreaterThan(0.3);
      expect(gap).toBeLessThan(2);
      expect(gap).toBeCloseTo(gaps[0]!, 9);
    }
  });

  it('reaches back from where the leading coupling is', () => {
    expect(vehicles[0]!.x).toBeCloseTo(300 - ENGINE.length / 2, 6);
    const last = vehicles[vehicles.length - 1]!;
    expect(last.x - last.length / 2).toBeCloseTo(300 - consistLength(5), 6);
  });

  it('points them along the line', () => {
    for (const vehicle of vehicles) {
      expect(vehicle.z).toBeCloseTo(0, 6);
      // A vehicle's own X axis runs along the track, the way a building's runs
      // along its street, so a line heading due east is a yaw of zero.
      expect(vehicle.yaw).toBeCloseTo(0, 6);
    }
  });

  it('sits a vehicle on its bogies round a bend, not on its middle', () => {
    // A wagon spanning the corner takes the chord between its bogies, so it
    // lies across the inside of the bend the way real stock does. Tangent at
    // the centre would have it square to one leg and hanging off the other.
    const round = layOutTrain(BEND, 210, 3);
    const spanning = round.find((v) => Math.abs(v.x - 200) < 12 && Math.abs(v.z) < 12);
    expect(spanning, 'a vehicle over the corner').toBeDefined();

    const yaw = Math.abs(spanning!.yaw);
    // Somewhere between running east and running south, and not either.
    expect(yaw).toBeGreaterThan(0.15);
    expect(yaw).toBeLessThan(Math.PI / 2 - 0.15);
  });

  it('gives back nothing rather than a train hanging off the end', () => {
    // Half a consist over the end of a siding looks far worse than none.
    expect(layOutTrain(STRAIGHT, 40, 5)).toEqual([]);
    expect(layOutTrain(STRAIGHT, 300, 200)).toEqual([]);
  });
});

describe('what a train is made of', () => {
  const vehicles = layOutTrain(STRAIGHT, 300, 3);
  const boxes = trainBoxes(vehicles);

  it('leaves the wagon open, with a deck to land on below the stakes', () => {
    // The whole point of a stake wagon standing empty: a floor at 1.25 m with
    // the posts carrying on above it, so what is between them is air.
    const tops = boxes.map((b) => b.maxY);
    expect(tops).toContain(WAGON.deck);
    expect(tops).toContain(WAGON.deck + WAGON.stake);
    expect(WAGON.deck + WAGON.stake).toBeGreaterThan(WAGON.deck);
  });

  it('stands every part on the ground the collider expects', () => {
    for (const box of boxes) expect(box.minY).toBe(0);
  });

  it('keeps the whole train inside the vehicles it was built from', () => {
    for (const box of boxes.map(worldBounds)) {
      const near = vehicles.some(
        (v) =>
          Math.abs((box.minX + box.maxX) / 2 - v.x) < v.length &&
          Math.abs((box.minZ + box.maxZ) / 2 - v.z) < v.length,
      );
      expect(near).toBe(true);
    }
  });

  it('measures a point on a vehicle in its own frame', () => {
    const wagon = vehicles[1]!;
    const nose = onVehicle(wagon, wagon.length / 2, 0);
    expect(Math.hypot(nose.x - wagon.x, nose.z - wagon.z)).toBeCloseTo(wagon.length / 2, 6);
  });
});

describe('landing on a wagon', () => {
  const vehicles = layOutTrain(STRAIGHT, 300, 6);
  const collider = createColliderField(trainBoxes(vehicles));
  const wagon = vehicles[3]!;
  /** Where the bird comes to rest on the deck: the deck, plus its own radius. */
  const REST = WAGON.deck + defaultParams.bodyRadius;

  const flyAt = (speed: number, above: number, from: number) => {
    const bird = createBird(vec(wagon.x - from, WAGON.deck + above, wagon.z), speed, EAST);
    for (let t = 0; t < 20; t += 1 / 120) {
      step(bird, neutralControls(), defaultParams, 1 / 120, collider);
      if (bird.ending) return bird.ending;
    }
    return null;
  };

  it('lets the pigeon put down on the deck', () => {
    const ending = flyAt(7, 1.5, 12);
    expect(ending?.kind).toBe('landed');
    expect(ending!.position.y).toBeCloseTo(REST, 2);
  });

  it('does the same off a slower approach', () => {
    const ending = flyAt(5, 1.0, 8);
    expect(ending?.kind).toBe('landed');
    expect(ending!.position.y).toBeCloseTo(REST, 2);
  });

  it('still holds the pigeon to the same rules it lands anywhere by', () => {
    // A deck is not a soft option: arrive too fast or drop onto it too hard
    // and it ends the way any other roof would.
    expect(flyAt(12, 2, 20)?.cause).toBe('too-fast');
    expect(flyAt(6, 4, 6)?.cause).toBe('hard-impact');
  });

  it('is solid enough to notice on the way past', () => {
    const hit = collider.sweep(vec(wagon.x, 6, wagon.z), vec(wagon.x, 0.1, wagon.z), 0.22);
    expect(hit).not.toBeNull();
    expect(hit!.normal.y).toBeCloseTo(1, 6);
    expect(collider.heightAt(wagon.x, wagon.z)).toBeCloseTo(WAGON.deck, 6);
  });
});
