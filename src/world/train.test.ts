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
  tweenAlong,
  CARRIAGE,
  COUPLING,
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
