import { describe, expect, it } from 'vitest';
import {
  carriedBy,
  chainageOf,
  shuttle,
  turnedBetween,
  consistLength,
  ENGINE,
  layOutTrain,
  lineLength,
  onVehicle,
  pointAlong,
  trainBoxes,
  railNetwork,
  traceRoute,
  tweenAlong,
  CARRIAGE,
  COUPLING,
  WAGON,
} from './train';
import { worldBounds } from '../sim/collision';
import { createColliderField } from '../sim/collision';
import { createBird, defaultParams, neutralControls, step } from '../sim/flight';
import { vec } from '../sim/math3';
import type { MapData, Rail } from './streets';
import type { Point2 } from './train';
import HOME_MAP from './data/home.json';
import { project } from './geo';

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
    expect(last.x - last.length / 2).toBeCloseTo(300 - consistLength(5, 'wagon'), 6);
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

describe('running along the line', () => {
  const LINE = 400;
  const CONSIST = 100;

  it('runs on, and keeps going the way it was going', () => {
    const a = shuttle(LINE, CONSIST, 200, 1, 6);
    expect(a).toEqual({ along: 206, direction: 1 });
    const b = shuttle(LINE, CONSIST, 200, -1, 6);
    expect(b).toEqual({ along: 194, direction: -1 });
  });

  it('turns round at the end of the track rather than running off it', () => {
    const { along, direction } = shuttle(LINE, CONSIST, 397, 1, 6);
    expect(direction).toBe(-1);
    // Reflected, not stopped: it comes back out at the speed it went in.
    expect(along).toBeCloseTo(397, 6);
    expect(along).toBeLessThanOrEqual(LINE);
  });

  it('turns round at the other end too, with the whole train still on', () => {
    // The near end is a consist length in, because the rest of the rake is
    // behind the leading coupling and has to be on the rails as well.
    const { along, direction } = shuttle(LINE, CONSIST, 103, -1, 6);
    expect(direction).toBe(1);
    expect(along).toBeCloseTo(103, 6);
    expect(along).toBeGreaterThanOrEqual(CONSIST);
  });

  it('stays on the rails however long it runs for', () => {
    let along = 250;
    let direction = 1;
    for (let i = 0; i < 5000; i += 1) {
      ({ along, direction } = shuttle(LINE, CONSIST, along, direction, 7.3));
      expect(along).toBeGreaterThanOrEqual(CONSIST - 1e-9);
      expect(along).toBeLessThanOrEqual(LINE + 1e-9);
    }
  });

  it('shuttles rather than drifting to one end', () => {
    // Over a long run it should visit both ends, not settle against one.
    let along = 250;
    let direction = 1;
    let lowest = Infinity;
    let highest = -Infinity;
    for (let i = 0; i < 2000; i += 1) {
      ({ along, direction } = shuttle(LINE, CONSIST, along, direction, 3));
      lowest = Math.min(lowest, along);
      highest = Math.max(highest, along);
    }
    expect(lowest).toBeLessThan(CONSIST + 5);
    expect(highest).toBeGreaterThan(LINE - 5);
  });

  it('copes with a step longer than the line itself', () => {
    // Not a thing that happens at yard speeds, and very much a thing that
    // happens when someone drags a speed slider.
    const { along, direction } = shuttle(LINE, CONSIST, 250, 1, 5000);
    expect(Number.isFinite(along)).toBe(true);
    expect(along).toBeGreaterThanOrEqual(CONSIST);
    expect(along).toBeLessThanOrEqual(LINE);
    expect(Math.abs(direction)).toBe(1);
  });

  it('stands still on a line too short to hold it', () => {
    expect(shuttle(80, CONSIST, 90, 1, 6)).toEqual({ along: 90, direction: 1 });
  });

  it('does not turn the consist round when it turns round', () => {
    // A locomotive that finds itself at the back is a train being propelled,
    // which is what shunting is -- and the alternative is the whole rake
    // flipping end for end in a single tick.
    const line: Rail = { kind: 'rail', width: 8, points: [[0, 0], [400, 0]] };
    const before = layOutTrain(line, 300, 5);
    const after = layOutTrain(line, 300, 5);
    expect(before[0]!.kind).toBe('engine');
    expect(after[0]!.kind).toBe('engine');
    // The engine leads the leading coupling whichever way it happens to run.
    expect(after[0]!.x).toBeGreaterThan(after[1]!.x);
  });
});

describe('riding on a wagon', () => {
  const line: Rail = { kind: 'rail', width: 8, points: [[0, 0], [500, 0]] };

  it('tags every box a vehicle owns, so anything on it knows which', () => {
    const vehicles = layOutTrain(line, 300, 3);
    const boxes = trainBoxes(vehicles, (vehicle) => vehicle);
    const tags = new Set(boxes.map((box) => box.carrier));
    expect(tags.size).toBe(vehicles.length);
    // A deck, a solebar and a stake all belong to the same wagon.
    for (const box of boxes) expect(box.carrier).not.toBeUndefined();
  });

  it('leaves boxes untagged when nobody asked', () => {
    for (const box of trainBoxes(layOutTrain(line, 300, 2))) {
      expect(box.carrier).toBeUndefined();
    }
  });

  it('keeps a passenger in its place on the deck, not its place in the world', () => {
    const before = layOutTrain(line, 300, 3)[2]!;
    const after = layOutTrain(line, 340, 3)[2]!;

    // Standing a little off-centre, so this says more than "it moved".
    const stood = { x: before.x + 3, y: 1.47, z: before.z - 0.8 };
    const rode = carriedBy(stood, before, after);

    expect(rode.x - after.x).toBeCloseTo(3, 6);
    expect(rode.z - after.z).toBeCloseTo(-0.8, 6);
    expect(rode.y).toBe(stood.y);
    // Which on a straight line is the same as having been shifted along it.
    expect(rode.x - stood.x).toBeCloseTo(40, 6);
  });

  it('turns a passenger with the wagon round a bend', () => {
    // Deliberately diagonal. On a line that starts along an axis the wagon's
    // first yaw is zero, and "read into the vehicle's frame" and "rotate the
    // world offset" come to exactly the same arithmetic -- so a test built on
    // one of those cannot tell a correct carry from a plain offset.
    const bend: Rail = { kind: 'rail', width: 8, points: [[0, 0], [200, 200], [200, 400]] };
    const before = layOutTrain(bend, 120, 1)[1]!;
    const after = layOutTrain(bend, 330, 1)[1]!;
    expect(Math.abs(before.yaw)).toBeGreaterThan(0.3);
    expect(Math.abs(turnedBetween(before, after))).toBeGreaterThan(0.5);

    // A passenger on the nose stays on the nose, which a plain offset would
    // not manage: it would leave it hanging off the side.
    const nose = onVehicle(before, before.length / 2 - 1, 0);
    const rode = carriedBy({ x: nose.x, y: 1.47, z: nose.z }, before, after);
    const shouldBe = onVehicle(after, after.length / 2 - 1, 0);
    expect(rode.x).toBeCloseTo(shouldBe.x, 6);
    expect(rode.z).toBeCloseTo(shouldBe.z, 6);
  });

  it('measures the turn the short way round', () => {
    const a = { ...layOutTrain(line, 300, 1)[0]!, yaw: 3.1 };
    const b = { ...a, yaw: -3.1 };
    expect(Math.abs(turnedBetween(a, b))).toBeLessThan(0.2);
  });

  it('tells a bird which wagon it landed on', () => {
    // The end of it: put down on a deck, and the bird knows what it is on.
    const vehicles = layOutTrain(line, 400, 6);
    const collider = createColliderField(trainBoxes(vehicles, (vehicle) => vehicle));
    const wagon = vehicles[3]!;

    const bird = createBird(vec(wagon.x - 12, WAGON.deck + 1.5, wagon.z), 7, Math.PI / 2);
    for (let t = 0; t < 20; t += 1 / 120) {
      step(bird, neutralControls(), defaultParams, 1 / 120, collider);
      if (bird.ending) break;
    }

    expect(bird.ending?.kind).toBe('landed');
    expect(bird.restingOn).toBe(3);
  });

  it('leaves a bird on the ground riding nothing', () => {
    const bird = createBird(vec(0, 3, 0), 5);
    for (let t = 0; t < 20; t += 1 / 120) {
      step(bird, neutralControls(), defaultParams, 1 / 120);
      if (bird.ending) break;
    }
    expect(bird.ending).not.toBeNull();
    expect(bird.restingOn).toBeNull();
  });

  it('carries a landed bird along when the train runs on', () => {
    const vehicles = layOutTrain(line, 400, 6);
    const collider = createColliderField(trainBoxes(vehicles, (vehicle) => vehicle));
    const wagon = vehicles[3]!;

    const bird = createBird(vec(wagon.x - 12, WAGON.deck + 1.5, wagon.z), 7, Math.PI / 2);
    for (let t = 0; t < 20; t += 1 / 120) {
      step(bird, neutralControls(), defaultParams, 1 / 120, collider);
      if (bird.ending) break;
    }
    expect(bird.restingOn).not.toBeNull();

    const onDeck = { x: bird.position.x - wagon.x, z: bird.position.z - wagon.z };
    const moved = layOutTrain(line, 340, 6);
    bird.position = carriedBy(bird.position, vehicles[bird.restingOn!]!, moved[bird.restingOn!]!);

    // Sixty metres down the line, and still standing exactly where it was on
    // the wagon.
    expect(bird.position.x - moved[bird.restingOn!]!.x).toBeCloseTo(onDeck.x, 6);
    expect(bird.position.z - moved[bird.restingOn!]!.z).toBeCloseTo(onDeck.z, 6);
    expect(bird.position.y).toBeCloseTo(WAGON.deck + defaultParams.bodyRadius, 2);
  });
});

describe('drawing a train between two ticks', () => {
  const LINE = 400;
  const CONSIST = 100;
  const TICK = 1 / 120;
  const SPEED = 6;
  // Deliberately not a multiple of the tick, so a frame swallows one tick
  // sometimes and two others -- which is the case the tween exists for.
  const FRAME = 1 / 70;
  /** Short enough that a long run turns round many times. */
  const SHORT = 160;

  /** The main loop, cut down to the one number the renderer reads. */
  function run(frames: number, tween: boolean): number[] {
    let along = 150;
    let previous = along;
    let direction = 1;
    let accumulator = 0;
    const drawn: number[] = [];

    for (let f = 0; f < frames; f += 1) {
      accumulator += FRAME;
      while (accumulator >= TICK) {
        previous = along;
        ({ along, direction } = shuttle(LINE, CONSIST, along, direction, SPEED * TICK));
        accumulator -= TICK;
      }
      drawn.push(tween ? tweenAlong(previous, along, accumulator / TICK) : along);
    }
    return drawn;
  }

  const gaps = (positions: number[]) =>
    positions.slice(1).map((at, i) => at - positions[i]!);

  it('covers the same ground every frame, whenever the frame falls', () => {
    for (const gap of gaps(run(120, true))) {
      expect(gap).toBeCloseTo(SPEED * FRAME, 9);
    }
  });

  it('is the tween doing that, and not the frame rate', () => {
    // Without it the train stands where the last tick left it, so every frame
    // shows a whole number of tick steps and none of them shows the distance
    // the train actually covered. That alternation is the shimmer.
    const quantum = SPEED * TICK;
    const lumpy = gaps(run(120, false));
    const ticksPerFrame = lumpy.map((gap) => gap / quantum);
    for (const ticks of ticksPerFrame) {
      expect(ticks).toBeCloseTo(Math.round(ticks), 6);
    }
    expect(new Set(ticksPerFrame.map(Math.round))).toEqual(new Set([1, 2]));
    // A frame is a tick and five sevenths, so neither of those is the truth.
    expect(Math.min(...lumpy)).toBeLessThan(SPEED * FRAME * 0.75);
    expect(Math.max(...lumpy)).toBeGreaterThan(SPEED * FRAME * 1.1);
  });

  it('never draws the train anywhere the simulation has not put it', () => {
    // Between the last two ticks, not past the newest one. Extrapolation is
    // just as smooth while a train runs straight, and then invents a position
    // beyond the buffers on the tick it turns round.
    let along = 150;
    let previous = along;
    let direction = 1;
    let accumulator = 0;

    for (let f = 0; f < 4000; f += 1) {
      accumulator += FRAME;
      while (accumulator >= TICK) {
        previous = along;
        ({ along, direction } = shuttle(SHORT, CONSIST, along, direction, SPEED * TICK));
        accumulator -= TICK;
      }
      const drawn = tweenAlong(previous, along, accumulator / TICK);
      expect(drawn).toBeGreaterThanOrEqual(Math.min(previous, along) - 1e-9);
      expect(drawn).toBeLessThanOrEqual(Math.max(previous, along) + 1e-9);
      // Which is what keeps a drawn train on its own rails.
      expect(drawn).toBeLessThanOrEqual(SHORT + 1e-9);
      expect(drawn).toBeGreaterThanOrEqual(CONSIST - 1e-9);
    }
  });
});


describe('a passenger train', () => {
  const LINE: Rail = { kind: 'rail', width: 8, points: [[0, 0], [400, 0]] };

  it('is the same engine with coaches behind it', () => {
    const train = layOutTrain(LINE, 300, 6, 'carriage');
    expect(train).toHaveLength(7);
    expect(train[0]!.kind).toBe('engine');
    for (const car of train.slice(1)) expect(car.kind).toBe('carriage');
  });

  it('is longer than the same number of stake wagons', () => {
    // A coach is a coach and a wagon is a wagon, so the two consists cannot
    // be the same length -- which is the sort of thing that goes unnoticed
    // until a train hangs off the end of a siding.
    expect(consistLength(6, 'carriage')).toBeGreaterThan(consistLength(6, 'wagon'));
    expect(consistLength(6, 'carriage')).toBeCloseTo(
      ENGINE.length + 6 * (COUPLING + CARRIAGE.length),
      9,
    );
  });

  it('lays its coaches out to the length it says it is', () => {
    const cars = 6;
    const train = layOutTrain(LINE, 300, cars, 'carriage');
    const front = train[0]!;
    const back = train[train.length - 1]!;
    const nose = front.x + front.length / 2;
    const tail = back.x - back.length / 2;
    expect(nose - tail).toBeCloseTo(consistLength(cars, 'carriage'), 6);
  });

  it('is a closed box you land on the roof of', () => {
    // The opposite of a stake wagon, whose whole point is an open deck. There
    // is no getting inside a coach, so there is nothing to model but the
    // outside and nothing to fall between.
    const train = layOutTrain(LINE, 300, 6, 'carriage');
    const collider = createColliderField(trainBoxes(train));
    const coach = train[3]!;

    expect(collider.heightAt(coach.x, coach.z)).toBeCloseTo(CARRIAGE.roof, 6);

    const hit = collider.sweep(
      vec(coach.x, CARRIAGE.roof + 4, coach.z),
      vec(coach.x, 0.1, coach.z),
      0.22,
    );
    expect(hit).not.toBeNull();
    expect(hit!.normal.y).toBeCloseTo(1, 6);
    expect(hit!.point.y).toBeCloseTo(CARRIAGE.roof + 0.22, 6);
  });

  it('stands still, and so runs nobody over', () => {
    // Speed is what makes a solid fatal to touch. A train in a platform is a
    // wall, which is exactly what it should be.
    const train = layOutTrain(LINE, 300, 6, 'carriage');
    for (const box of trainBoxes(train, undefined, 0)) {
      expect(box.speed ?? 0).toBe(0);
    }
    for (const box of trainBoxes(train, undefined, 6)) {
      expect(box.speed).toBe(6);
    }
  });

  it('goes nowhere when it is standing', () => {
    const { along, direction } = shuttle(400, consistLength(6, 'carriage'), 200, 1, 0);
    expect(along).toBe(200);
    expect(direction).toBe(1);
  });
});

/**
 * Following the track through the switches.
 *
 * A railway in the map is a heap of ways that happen to share end
 * coordinates, and a train handed one of them shuttles up and down a fragment
 * with the rest of the line lying there unused.
 */
/**
 * The map's railway as something connected.
 *
 * The data has no junctions in it. A `Rail` is a bare polyline and a switch is
 * two or three of them writing down the same coordinate, with nothing saying
 * so -- the connection is a coincidence, and this is that coincidence indexed.
 */
describe('the rail network', () => {
  const way = (...points: [number, number][]): Rail => ({ kind: 'rail', width: 8, points });

  it('reports both ends of a way, and says which end each is', () => {
    const only = way([0, 0], [100, 0]);
    const network = railNetwork([only]);

    expect(network.at([0, 0])).toEqual([{ rail: only, fromHead: true }]);
    expect(network.at([100, 0])).toEqual([{ rail: only, fromHead: false }]);
    // Which end matters: a way joined at its tail is travelled backwards, and
    // not knowing that is the difference between following the track and
    // jumping the length of a way sideways.
    expect(network.at([50, 0])).toEqual([]);
  });

  it('puts every way meeting at a switch on the same node', () => {
    const approach = way([0, 0], [100, 0]);
    const through = way([100, 0], [300, 0]);
    const diverging = way([100, 0], [260, 90]);
    const network = railNetwork([approach, through, diverging]);

    expect(network.at([100, 0])).toHaveLength(3);
    expect(network.at([100, 0]).map((end) => end.rail)).toEqual(
      expect.arrayContaining([approach, through, diverging]),
    );
  });

  it('matches ends to the centimetre, on both sides of zero', () => {
    // Rounded rather than written to two places: `toFixed` keeps the sign of
    // a very small negative, so 4 mm reads as "0.00" and -4 mm as "-0.00" and
    // a switch quietly stops being one.
    const above = way([-100, 0.004], [0, 0.004]);
    const below = way([0, -0.004], [100, -0.004]);
    expect(railNetwork([above, below]).at([0, 0])).toHaveLength(2);
  });

  it('counts the ways it holds, which is what bounds a walk over it', () => {
    // A way of one point is not a way: it has no direction and no length, and
    // indexing one end of it as two would make a node that joins to itself.
    const network = railNetwork([way([0, 0], [1, 0]), way([5, 5], [6, 5]), { kind: 'rail', width: 8, points: [[9, 9]] }]);
    expect(network.ways).toBe(2);
  });

  it('holds every sort of line, and leaves the telling apart to the walk', () => {
    // A tramway is in the index -- it is a thing that is there. Whether a
    // train may follow it onto is a decision about the train.
    const rail = way([0, 0], [100, 0]);
    const tram: Rail = { kind: 'tram', width: 6, points: [[100, 0], [300, 0]] };
    expect(railNetwork([rail, tram]).at([100, 0])).toHaveLength(2);
    expect(traceRoute(railNetwork([rail, tram]), rail).over).toEqual([rail]);
  });
});

describe('tracing a route', () => {
  /** A way, given as its points. */
  const way = (...points: [number, number][]): Rail => ({ kind: 'rail', width: 8, points });

  it('joins ways that share an end, in the order they run', () => {
    const first = way([0, 0], [100, 0]);
    const second = way([100, 0], [250, 0]);
    const route = traceRoute(railNetwork([first, second]), first);

    expect(route.points).toEqual([[0, 0], [100, 0], [250, 0]]);
    // The shared node once, not twice: a repeated point is a zero-length
    // segment, and every chainage past it comes out short by nothing at all
    // until something divides by it.
    expect(lineLength(route.points)).toBeCloseTo(250, 9);
    expect(route.over).toEqual([first, second]);
  });

  it('grows from both ends, not just the far one', () => {
    const middle = way([100, 0], [250, 0]);
    const before = way([0, 0], [100, 0]);
    const after = way([250, 0], [400, 0]);
    const route = traceRoute(railNetwork([before, middle, after]), middle);

    expect(route.points[0]).toEqual([0, 0]);
    expect(route.points[route.points.length - 1]).toEqual([400, 0]);
    expect(lineLength(route.points)).toBeCloseTo(400, 9);
  });

  it('takes the straight road through a switch, not the one that diverges', () => {
    // The shape of a facing point: two roads leave the same node, one
    // carrying straight on and one turning off. The map says which is which
    // only by the angle.
    const approach = way([0, 0], [100, 0]);
    const through = way([100, 0], [300, 0]);
    const diverging = way([100, 0], [260, 90]);
    // The diverging road offered first, so taking the first thing on offer
    // is the wrong answer rather than accidentally the right one.
    const route = traceRoute(railNetwork([approach, diverging, through]), approach);

    expect(route.over).toContain(through);
    expect(route.over).not.toContain(diverging);
  });

  it('stops where the track really stops', () => {
    // Nothing leaves the far node in anything like the same direction, so
    // this is the end of the line and the train turns round here.
    const approach = way([0, 0], [100, 0]);
    const crossing = way([100, 0], [100, 200]);
    const route = traceRoute(railNetwork([approach, crossing]), approach);

    expect(route.points).toEqual(approach.points);
    expect(route.over).toEqual([approach]);
  });

  it('will not find its way onto a tramway', () => {
    const approach = way([0, 0], [100, 0]);
    const tram: Rail = { kind: 'tram', width: 6, points: [[100, 0], [300, 0]] };
    expect(traceRoute(railNetwork([approach, tram]), approach).over).toEqual([approach]);
  });

  it('goes round a loop once rather than for ever', () => {
    // A circle of track cut into three, drawn finely enough that every joint
    // reads as straight on. Nothing about the shape can stop the walk, so the
    // only thing that does is each way being used once.
    const ring: [number, number][] = [];
    for (let i = 0; i < 12; i += 1) {
      const turn = (i / 12) * Math.PI * 2;
      ring.push([Math.cos(turn) * 200, Math.sin(turn) * 200]);
    }
    // Closed on the point it started from rather than on another sine of the
    // same angle, so what ends the walk is the rule and not the arithmetic.
    ring.push(ring[0]!);
    const a = way(...ring.slice(0, 5));
    const b = way(...ring.slice(4, 9));
    const c = way(...ring.slice(8, 13));
    const route = traceRoute(railNetwork([a, b, c]), a);

    expect(route.over).toHaveLength(3);
    // Once round and no more: twelve nodes and the one it started from
    // again, and then nothing left to follow. Without each way being used
    // once this is the walk that never ends.
    expect(route.points).toHaveLength(13);
    const first = route.points[0]!;
    const last = route.points[12]!;
    expect(Math.hypot(last[0] - first[0], last[1] - first[1])).toBeLessThan(1e-9);
  });

  it('carries the whole run over into one polyline that a train can run on', () => {
    // The point of the exercise: what comes back is a line, so everything
    // that already knew how to put a train on a line still does.
    const pieces = [
      way([0, 0], [100, 0]),
      way([100, 0], [200, 0]),
      way([200, 0], [300, 0]),
      way([300, 0], [400, 0]),
    ];
    const route = traceRoute(railNetwork(pieces), pieces[1]!);
    const line: Rail = { kind: 'rail', width: 8, points: route.points };

    expect(lineLength(line.points)).toBeCloseTo(400, 9);
    const train = layOutTrain(line, 400, 6, 'carriage');
    expect(train).toHaveLength(7);
    // And standing across a join rather than stopping short of one: the
    // engine is past 300 and the back of the rake is not.
    expect(Math.max(...train.map((v) => v.x))).toBeGreaterThan(300);
    expect(Math.min(...train.map((v) => v.x))).toBeLessThan(300);
  });

  it('joins ends that round to the same place, either side of zero', () => {
    // Ends are matched to the centimetre, so eight millimetres apart is the
    // same node -- and has to stay the same node when the two of them fall
    // either side of zero. Written with `toFixed` it does not: one reads as
    // "-0.00" and the other as "0.00", and a switch quietly stops being one.
    const first = way([-100, 0.004], [0, 0.004]);
    const second = way([0, -0.004], [100, -0.004]);
    expect(traceRoute(railNetwork([first, second]), first).over).toHaveLength(2);
  });

  it('comes out continuous on the real railway, not in jumps', () => {
    // The fixtures above are four ways long and drawn by hand. This is the
    // network the game actually runs on -- two hundred and forty ways, cut
    // where the tagging changes and joined at switches -- and the failure it
    // is here to catch is a way appended back to front, which reads as the
    // train jumping its own length sideways at a join.
    const map = HOME_MAP as unknown as MapData;
    const rails = (map.rails ?? []) as Rail[];
    const yard = project(47.500052, 19.088174, map.centre);

    const near = rails.filter((rail) => {
      if (rail.kind !== 'rail') return false;
      const on = pointAlong(rail.points, chainageOf(rail.points, yard.x, yard.z));
      return !!on && Math.hypot(on.x - yard.x, on.z - yard.z) < 40;
    });
    expect(near.length).toBeGreaterThan(4);

    const network = railNetwork(rails);
    const routes = near.map((rail) => traceRoute(network, rail));
    const longest = routes.reduce((best, route) =>
      lineLength(route.points) > lineLength(best.points) ? route : best,
    );

    // It is worth having: many times the way it was traced from, and out of
    // more than a couple of pieces.
    expect(longest.over.length).toBeGreaterThan(5);
    expect(lineLength(longest.points)).toBeGreaterThan(3000);

    // And continuous. No step in it is longer than the longest step in the
    // ways it is made of, which it would be by a whole way if one of them
    // went in back to front.
    const step = (points: readonly Point2[]) =>
      points.slice(1).reduce(
        (most, point, i) => Math.max(most, Math.hypot(point[0] - points[i]![0], point[1] - points[i]![1])),
        0,
      );
    const widest = Math.max(...longest.over.map((rail) => step(rail.points as Point2[])));
    expect(step(longest.points)).toBeCloseTo(widest, 6);
  });

  it('leaves a way it was given alone', () => {
    const first = way([0, 0], [100, 0]);
    const second = way([100, 0], [250, 0]);
    traceRoute(railNetwork([first, second]), first);
    expect(first.points).toEqual([[0, 0], [100, 0]]);
    expect(second.points).toEqual([[100, 0], [250, 0]]);
  });
});

/**
 * A rake stays a rake.
 *
 * The failure this is here for: three passenger trains ran out of the station
 * as locomotives on their own, having shed their coaches somewhere near the
 * buffers and never got them back.
 */
describe('running a rake up and down its line', () => {
  const LINE: Rail = { kind: 'rail', width: 8, points: [[0, 0], [900, 0]] };

  it('never turns a train round short of its own length', () => {
    // What `shuttle` is for. It reverses at `consist` from one end, so a
    // consist measured as the wrong sort of stock reverses in the wrong place
    // and leaves the back of the train hanging off the rails -- a carriage is
    // five metres longer than a wagon, which over six of them is 21 m.
    for (const stock of ['wagon', 'carriage'] as const) {
      const consist = consistLength(6, stock);
      const run = lineLength(LINE.points);

      let along = consist + 4;
      let direction = -1;
      for (let tick = 0; tick < 4000; tick += 1) {
        const step = shuttle(run, consist, along, direction, 16 / 120);
        along = step.along;
        direction = step.direction;
        expect(along, `${stock} at tick ${tick}`).toBeGreaterThanOrEqual(consist - 1e-9);
        expect(along, `${stock} at tick ${tick}`).toBeLessThanOrEqual(run + 1e-9);
      }
    }
  });

  it('lays out every vehicle wherever the shuttle leaves it', () => {
    // The two halves have to agree: anywhere `shuttle` is willing to put the
    // train, `layOutTrain` has to be able to draw it. Where they disagree the
    // rake comes back empty.
    for (const stock of ['wagon', 'carriage'] as const) {
      const consist = consistLength(6, stock);
      const run = lineLength(LINE.points);

      let along = consist + 4;
      let direction = -1;
      for (let tick = 0; tick < 4000; tick += 1) {
        const step = shuttle(run, consist, along, direction, 16 / 120);
        along = step.along;
        direction = step.direction;
        expect(
          layOutTrain(LINE, along, 6, stock),
          `${stock} at ${along.toFixed(1)}`,
        ).toHaveLength(7);
      }
    }
  });

  it('carries its own car count, so a bad tick is not a permanent one', () => {
    // Counting the cars off the last layout is a ratchet: `layOutTrain`
    // returns nothing when a rake will not fit, so one bad tick asks for
    // -1 cars on the next and every tick after that draws an engine on its
    // own. The count is written down instead, so the same bad tick recovers.
    const derived = layOutTrain(LINE, 10, 6, 'carriage');
    expect(derived).toHaveLength(0);
    expect(derived.length - 1).toBe(-1);

    // The count that is written down does not care what the layout managed.
    const cars = 6;
    expect(layOutTrain(LINE, 400, cars, 'carriage')).toHaveLength(7);
  });
});
