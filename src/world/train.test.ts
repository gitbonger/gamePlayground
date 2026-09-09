import { describe, expect, it } from 'vitest';
import {
  advance,
  blockedBy,
  noseAhead,
  carriedBy,
  carryPassengers,
  chainageOf,
  recycle,
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
  rakeNear,
  directionFor,
  stockIsHauled,
  stockRuns,
  stockTop,
  moveTrain,
  traceRoute,
  tweenAlong,
  TRAM,
  CARRIAGE,
  COUPLING,
  WAGON,
  type Vehicle,
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

  it('is one box a wagon, up to the deck, and the stakes are not solid', () => {
    // A stake wagon standing empty is a floor at 1.25 m with posts drawn
    // above it. The posts are scenery: a pigeon goes between them the way it
    // goes through a tree, and the deck it lands on is the same deck either
    // way. Boxing all fourteen made a rake of twelve into 182 boxes, rebuilt
    // 120 times a second, for the chance of clipping a post.
    const wagons = boxes.filter((b) => b.maxY === WAGON.deck);
    expect(wagons).toHaveLength(3);
    expect(boxes.map((b) => b.maxY)).not.toContain(WAGON.deck + WAGON.stake);
    // An engine and three wagons: two boxes for the locomotive, one each for
    // the rest.
    expect(boxes).toHaveLength(5);
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

describe('running off the end and coming round again', () => {
  const LINE = 400;
  const CONSIST = 100;
  /** The run over which the whole rake is on the rails: what it wraps over. */
  const BAND = LINE - CONSIST;

  it('runs on without turning round', () => {
    // The difference from a shuttle, and the reason the tramway needed one.
    // A tram's direction is what keeps it on the correct track of a pair, so
    // it is the one thing about a tram that must never change: reversed at
    // the end of the line it comes back down the same rails the wrong way,
    // which is two trams abreast going one way as seen from the street.
    expect(recycle(LINE, CONSIST, 200, 1, 6).along).toBe(206);
    expect(recycle(LINE, CONSIST, 200, -1, 6).along).toBe(194);
    expect(recycle(LINE, CONSIST, 200, 1, 6).wrapped).toBe(false);
  });

  it('comes back on at the beginning when it runs off the end', () => {
    const off = recycle(LINE, CONSIST, LINE - 2, 1, 6);
    expect(off.along).toBeCloseTo(CONSIST + 4, 6);
    expect(off.wrapped).toBe(true);
  });

  it('comes back on at the far end when it is running the other way', () => {
    const off = recycle(LINE, CONSIST, CONSIST + 2, -1, 6);
    expect(off.along).toBeCloseTo(LINE - 4, 6);
    expect(off.wrapped).toBe(true);
  });

  it('says so when it wrapped, because two things upstream cannot tell', () => {
    // A wrap is the one movement in the game that is not a movement. The
    // frame drawn between two ticks interpolates along the line, and across
    // a wrap that sweeps the tram backwards over the whole city; anything
    // standing on it is carried by the difference between where its vehicle
    // was and where it is, which across a wrap flings a pigeon the length of
    // the route. Neither can work it out from the number alone -- a tram at
    // 106 might have run there from 100 or wrapped there from 394.
    expect(recycle(LINE, CONSIST, 300, 1, 6).wrapped).toBe(false);
    expect(recycle(LINE, CONSIST, LINE, 1, 6).wrapped).toBe(true);
  });

  it('lands somewhere on the line however big the step', () => {
    // The debug panel has a speed slider, and a step longer than the route
    // subtracted once is still off the end of it.
    const far = recycle(LINE, CONSIST, 150, 1, BAND * 7 + 30);
    expect(far.along).toBeGreaterThanOrEqual(CONSIST);
    expect(far.along).toBeLessThanOrEqual(LINE);
    expect(far.along).toBeCloseTo(180, 6);
  });

  it('leaves a train alone on a line too short to hold it', () => {
    expect(recycle(80, CONSIST, 90, 1, 6)).toEqual({ along: 90, wrapped: false });
  });

  it('keeps its spacing for ever, which is what makes it a service', () => {
    // Three trams evenly spaced round the ring, run for six circuits. They
    // all go at one speed and each wraps on its own, so the pattern has to
    // come back exactly -- otherwise a headway is only true until the first
    // one reaches the end.
    const start = [0, 1, 2].map((i) => CONSIST + (BAND / 3) * i);
    let at = [...start];
    for (let tick = 0; tick < 6 * BAND; tick += 1)
      at = at.map((along) => recycle(LINE, CONSIST, along, 1, 1).along);

    const round = at.map((along) => along - CONSIST).sort((a, b) => a - b);
    const gaps = round.map((along, i) => (i === 0 ? along + BAND - round[2]! : along - round[i - 1]!));
    for (const gap of gaps) expect(gap).toBeCloseTo(BAND / 3, 6);
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

  it('follows its own branch into a through road, however sharp the join', () => {
    // The shape that was getting trams wrong. A branch merges into a line
    // that runs across it: there is exactly one way on, and it leaves at
    // forty-five degrees because that is how a branch joins a road it is not
    // parallel to. The route used to end here -- and a route that ends is a
    // train that turns round, on the spot, in the middle of a street.
    // Straight east, then away at forty-five degrees: the turn is what
    // matters here, not the bearings, and the first version of this fixture
    // had two ways thirteen degrees apart, which the old gate accepted
    // happily and which therefore proved nothing at all.
    const branch = way([0, 0], [100, 0]);
    const through = way([100, 0], [200, 100]);
    const route = traceRoute(railNetwork([branch, through]), branch);

    expect(route.over).toContain(through);
    expect(lineLength(route.points)).toBeGreaterThan(lineLength(branch.points));
  });

  it('still prefers the straight road when there is a choice of sharp ones', () => {
    // Relaxing what counts as a continuation must not relax what counts as
    // the *best* one: a diverging road that is merely allowed is not thereby
    // preferred, and the through road still wins by being straighter.
    const approach = way([0, 0], [100, 0]);
    const diverging = way([100, 0], [180, 60]);
    const through = way([100, 0], [300, 10]);
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

/**
 * Trams.
 *
 * Not a small train. It has no locomotive, its sections are joined by a
 * concertina rather than by couplings, and it runs on tramway rather than on
 * railway -- three differences, each of which used to be an assumption
 * somewhere that a rake is an engine and some cars behind it.
 */
describe('a tram', () => {
  const TRAMWAY: Rail = { kind: 'tram', width: 6, points: [[0, 0], [600, 0]] };

  it('is all cars and no engine', () => {
    const cars = layOutTrain(TRAMWAY, 300, 4, 'tram');
    expect(cars).toHaveLength(4);
    expect(cars.every((v) => v.kind === 'tram')).toBe(true);
    expect(stockIsHauled('tram')).toBe(false);

    // Where a hauled rake of four is five vehicles, the first a locomotive.
    const hauled = layOutTrain(TRAMWAY, 300, 4, 'carriage');
    expect(hauled).toHaveLength(5);
    expect(hauled[0]!.kind).toBe('engine');
  });

  it('measures itself over its concertinas, not over couplings it has not got', () => {
    // Four cars and three joints, and no locomotive in front of them.
    const measured = consistLength(4, 'tram');
    expect(measured).toBeCloseTo(4 * TRAM.length + 3 * 0.25, 6);

    // Which has to be what it actually occupies, or `shuttle` turns it round
    // in the wrong place and it runs off the end of its line.
    const cars = layOutTrain(TRAMWAY, 300, 4, 'tram');
    const front = Math.max(...cars.map((v) => v.x + v.length / 2));
    const back = Math.min(...cars.map((v) => v.x - v.length / 2));
    expect(front - back).toBeCloseTo(measured, 6);
  });

  it('is lower than a railway coach, which is what you land on', () => {
    // Three and a bit rather than four, and a roof either way.
    expect(stockTop('tram')).toBe(TRAM.roof);
    expect(stockTop('tram')).toBeLessThan(stockTop('carriage'));

    const cars = layOutTrain(TRAMWAY, 300, 4, 'tram');
    const boxes = trainBoxes(cars);
    expect(boxes).toHaveLength(4);
    for (const box of boxes) expect(box.maxY).toBeCloseTo(TRAM.roof, 6);
  });

  it('runs on tramway, and a train does not', () => {
    expect(stockRuns('tram')).toBe('tram');
    expect(stockRuns('carriage')).toBe('rail');
    expect(stockRuns('wagon')).toBe('rail');
  });

  it('stays on its line however long it runs for', () => {
    // The same claim the rakes get, for the stock that measures itself
    // differently from all of them.
    const consist = consistLength(4, 'tram');
    const run = lineLength(TRAMWAY.points);
    let along = consist + 3;
    let direction = -1;
    for (let tick = 0; tick < 4000; tick += 1) {
      const step = shuttle(run, consist, along, direction, 10 / 120);
      along = step.along;
      direction = step.direction;
      expect(layOutTrain(TRAMWAY, along, 4, 'tram'), `${along.toFixed(1)}`).toHaveLength(4);
    }
  });
});

/**
 * Setting off the way you meant to.
 *
 * `direction` is +1 for "up the line as drawn", which is a fact about the
 * order somebody traced a way into OpenStreetMap and not about the world.
 */
describe('choosing which way to set off', () => {
  /** A line running due south as drawn: north at -Z, so south is +Z. */
  const SOUTHWARD: readonly Point2[] = [[0, -300], [0, 300]];
  /** The same line, traced the other way. */
  const NORTHWARD: readonly Point2[] = [[0, 300], [0, -300]];

  it('goes up a line that already points the way asked for', () => {
    expect(directionFor(SOUTHWARD, 300, 180)).toBe(1);
    expect(directionFor(NORTHWARD, 300, 0)).toBe(1);
  });

  it('goes down one that does not', () => {
    expect(directionFor(SOUTHWARD, 300, 0)).toBe(-1);
    expect(directionFor(NORTHWARD, 300, 180)).toBe(-1);
  });

  it('reads a bearing as a compass bearing, clockwise from north', () => {
    const EASTWARD: readonly Point2[] = [[-300, 0], [300, 0]];
    expect(directionFor(EASTWARD, 300, 90)).toBe(1);
    expect(directionFor(EASTWARD, 300, 270)).toBe(-1);
    // And anything within a quarter turn counts, because a real line does not
    // run due anything.
    expect(directionFor(EASTWARD, 300, 135)).toBe(1);
    expect(directionFor(EASTWARD, 300, 225)).toBe(-1);
  });

  it('turns with the line, not with where the line started', () => {
    // A line that comes in heading east and leaves heading south. Which way
    // to set off depends on where along it you are standing.
    const BEND: readonly Point2[] = [[0, 0], [300, 0], [300, 300]];
    expect(directionFor(BEND, 150, 90)).toBe(1);
    expect(directionFor(BEND, 450, 90)).toBe(-1);
    expect(directionFor(BEND, 450, 180)).toBe(1);
  });
});

/**
 * Which trains are worth drawing exactly.
 *
 * A train is where it is whether or not anyone is watching -- that is not
 * negotiable and it is not what this is about. This is the other half: laying
 * a rake out in world coordinates and boxing it for collision is work done
 * for the player, and there is no player near a train four kilometres away.
 */
describe('how near a rake is', () => {
  const LINE: Rail = { kind: 'rail', width: 8, points: [[0, 0], [4000, 0]] };
  /** A rake, laid out, as a real one always is by the time this is asked. */
  const rake = (along: number) => ({
    line: LINE,
    along,
    cars: 6,
    stock: 'carriage' as const,
    vehicles: layOutTrain(LINE, along, 6, 'carriage'),
  });

  it('measures from the back of the rake, not the front', () => {
    // The reach is allowed the whole length of the train behind the coupling,
    // because something level with the last coach is next to a train whatever
    // the front of it is doing.
    const consist = consistLength(6, 'carriage');
    expect(rakeNear(rake(1000), 1000, 0, 100)).toBe(true);
    expect(rakeNear(rake(1000), 1000, consist + 90, 100)).toBe(true);
    expect(rakeNear(rake(1000), 1000, consist + 110, 100)).toBe(false);
  });

  it('gives a longer train a longer reach, because it is longer', () => {
    const consist = consistLength(6, 'carriage');
    const short = {
      line: LINE,
      along: 1000,
      cars: 1,
      stock: 'carriage' as const,
      vehicles: layOutTrain(LINE, 1000, 1, 'carriage'),
    };
    expect(rakeNear(rake(1000), 1000, consist + 10, 20)).toBe(true);
    expect(rakeNear(short, 1000, consist + 10, 20)).toBe(false);
  });

  it('lets go of one that has gone', () => {
    // The case this exists for: the train that leaves the yard and runs three
    // and a half kilometres down the main line.
    expect(rakeNear(rake(300), 300, 0, 300)).toBe(true);
    expect(rakeNear(rake(3600), 300, 0, 300)).toBe(false);
  });

  it('keeps one it cannot place, rather than dropping it', () => {
    // Before it has ever been laid out there is nothing to measure from, and
    // `pointAlong` gives nothing for a chainage off the end of the line. A
    // train that cannot be located is a train to go on drawing: the cost of
    // being wrong that way is a collider nobody needed, and the cost of the
    // other way is a train you can fly through.
    const never = { line: LINE, along: 99999, cars: 6, stock: 'carriage' as const };
    expect(rakeNear(never, 0, 0, 1)).toBe(true);
  });

  it('measures from where the rake is, not from a fresh search of the line', () => {
    // The rake's own position is a second old at worst for a train too far
    // off to draw, which against a reach of three hundred metres is nothing
    // -- and it saves searching the line for every train on the map, every
    // tick.
    const stale = rake(1000);
    // Its vehicles say 1000 while its chainage says it has run on to 2000.
    stale.along = 2000;
    expect(rakeNear(stale, 1000, 0, 50)).toBe(true);
    expect(rakeNear(stale, 2000, 0, 50)).toBe(false);
  });
});

/**
 * A rake is made once and moved ever after.
 *
 * The same locomotive and the same twelve wagons for as long as the game is
 * open: only where they are changes, so they are written over rather than
 * built again.
 */
describe('moving a rake that already exists', () => {
  const LINE: Rail = { kind: 'rail', width: 8, points: [[0, 0], [900, 0]] };

  it('puts the same objects somewhere else', () => {
    const rake = layOutTrain(LINE, 300, 6, 'carriage');
    const before = rake.map((v) => v);

    expect(moveTrain(rake, LINE, 500, 6, 'carriage')).toBe(true);
    // The very same objects, moved -- not a new array of new vehicles.
    rake.forEach((v, i) => expect(v).toBe(before[i]));
    expect(rake[0]!.x).toBeCloseTo(500 - ENGINE.length / 2, 6);
  });

  it('agrees with building a fresh one', () => {
    const moved = layOutTrain(LINE, 300, 6, 'carriage');
    moveTrain(moved, LINE, 640, 6, 'carriage');
    expect(moved).toEqual(layOutTrain(LINE, 640, 6, 'carriage'));
  });

  it('refuses a rake of the wrong length rather than half filling it', () => {
    // The promise `layOutTrain` makes: half a train hanging off the end of a
    // siding is worse than none. A rake handed the wrong number of vehicles
    // would otherwise be laid out as far as it went and left mixed.
    const four = layOutTrain(LINE, 300, 4, 'carriage');
    const before = four.map((v) => ({ ...v }));

    expect(moveTrain(four, LINE, 500, 6, 'carriage')).toBe(false);
    expect(four.map((v) => ({ ...v }))).toEqual(before);
  });

  it('will not run a rake off the end of its line', () => {
    const rake = layOutTrain(LINE, 300, 6, 'carriage');
    expect(moveTrain(rake, LINE, 10, 6, 'carriage')).toBe(false);
  });
});

/**
 * Measuring a line once instead of counting along it every time.
 *
 * A route is discovered when the world is built and never changes, so neither
 * does the distance to any of its points. `pointAlong` used to count from the
 * start on every call, and it is called twice per vehicle per tick.
 */
describe('finding a point on a line', () => {
  /** The obvious way, kept here to check the quick way against. */
  const byWalking = (points: readonly Point2[], distance: number) => {
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
  };

  const shapes: Record<string, Point2[]> = {
    straight: [[0, 0], [400, 0]],
    'a dog-leg': [[0, 0], [100, 0], [100, 100], [250, 100]],
    'many short pieces': Array.from({ length: 40 }, (_, i): Point2 => [i * 9, Math.sin(i / 3) * 20]),
    'with a doubled point': [[0, 0], [50, 0], [50, 0], [150, 0], [150, 60]],
    // A line that ends on a repeat of its last point: asking for the very end
    // of it lands on a segment of no length, which is a division by nothing.
    'ending on a repeat': [[0, 0], [80, 0], [80, 0]],
  };

  it('gives what walking the line gives, wherever you ask', () => {
    for (const [name, points] of Object.entries(shapes)) {
      const run = lineLength(points);
      for (const t of [0, 0.001, 0.25, 0.5, 0.75, 0.999, 1]) {
        const distance = run * t;
        const quick = pointAlong(points, distance);
        const slow = byWalking(points, distance);
        expect(quick, `${name} at ${distance.toFixed(2)}`).not.toBeNull();
        expect(quick!.x, `${name} at ${distance.toFixed(2)}`).toBeCloseTo(slow!.x, 6);
        expect(quick!.z, `${name} at ${distance.toFixed(2)}`).toBeCloseTo(slow!.z, 6);
      }
    }
  });

  it('lands exactly on the line\'s own points', () => {
    const points = shapes['a dog-leg']!;
    let run = 0;
    for (let i = 1; i < points.length; i += 1) {
      run += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
      const at = pointAlong(points, run)!;
      expect(at.x, `point ${i}`).toBeCloseTo(points[i]![0], 9);
      expect(at.z, `point ${i}`).toBeCloseTo(points[i]![1], 9);
    }
  });

  it('gives nothing before the start or past the end', () => {
    const points = shapes['a dog-leg']!;
    expect(pointAlong(points, -1)).toBeNull();
    expect(pointAlong(points, lineLength(points) + 0.001)).toBeNull();
    // And something at either end of it.
    expect(pointAlong(points, 0)).toEqual({ x: 0, z: 0 });
    expect(pointAlong(points, lineLength(points))).not.toBeNull();
  });

  it('measures a line the same however often it is asked', () => {
    // The measurements are kept, so the second answer comes from the first.
    // It has to be the same answer.
    const points = shapes['many short pieces']!;
    const first = lineLength(points);
    for (let i = 0; i < 5; i += 1) expect(lineLength(points)).toBe(first);
    expect(pointAlong(points, 100)).toEqual(pointAlong(points, 100));
  });

  it('measures two lines of the same shape separately', () => {
    // Kept against the points themselves, so a second line that happens to
    // look the same is still its own line.
    const one: Point2[] = [[0, 0], [100, 0]];
    const two: Point2[] = [[0, 0], [300, 0]];
    expect(lineLength(one)).toBeCloseTo(100, 9);
    expect(lineLength(two)).toBeCloseTo(300, 9);
    expect(lineLength(one)).toBeCloseTo(100, 9);
  });

  it('has nothing to say about a line of one point', () => {
    expect(pointAlong([[5, 5]], 0)).toBeNull();
    expect(lineLength([[5, 5]])).toBe(0);
  });
});

/**
 * Riding a train.
 *
 * The regression this exists for: rakes became reusable, so a vehicle is the
 * same object from one tick to the next. Anything comparing "where it was" to
 * "where it is" by holding the vehicles was suddenly comparing each with
 * itself, and everything standing on a train stopped being carried by it. The
 * whole suite passed, because the comparison lived in the main file.
 */
describe('carrying whatever is standing on a train', () => {
  const LINE: Rail = { kind: 'rail', width: 8, points: [[0, 0], [900, 0]] };
  const standing = (x: number, z: number, on: number | null) => ({
    position: { x, y: 2, z },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    restingOn: on,
  });
  /** A copy of where each vehicle is, which is what a caller has to keep. */
  const snapshot = (rake: readonly Vehicle[]) =>
    rake.map((v) => ({ x: v.x, z: v.z, yaw: v.yaw }));

  it('takes a passenger along when its wagon moves', () => {
    const rake = layOutTrain(LINE, 300, 6, 'wagon');
    const rider = standing(rake[3]!.x, rake[3]!.z, 3);

    const was = snapshot(rake);
    moveTrain(rake, LINE, 460, 6, 'wagon');
    carryPassengers([rider], was, rake);

    expect(rake[3]!.x - was[3]!.x).toBeCloseTo(160, 6);
    expect(rider.position.x).toBeCloseTo(rake[3]!.x, 6);
    expect(rider.position.z).toBeCloseTo(rake[3]!.z, 6);
    // Height is left alone: rails are level.
    expect(rider.position.y).toBe(2);
  });

  it('keeps it in its own place on the deck, not just near the wagon', () => {
    const rake = layOutTrain(LINE, 300, 6, 'wagon');
    const corner = onVehicle(rake[2]!, 4, 1.2);
    const rider = standing(corner.x, corner.z, 2);

    const was = snapshot(rake);
    moveTrain(rake, LINE, 500, 6, 'wagon');
    carryPassengers([rider], was, rake);

    const moved = onVehicle(rake[2]!, 4, 1.2);
    expect(rider.position.x).toBeCloseTo(moved.x, 6);
    expect(rider.position.z).toBeCloseTo(moved.z, 6);
  });

  it('leaves alone anything that is not on a train', () => {
    const rake = layOutTrain(LINE, 300, 6, 'wagon');
    const flying = standing(50, 50, null);
    const was = snapshot(rake);
    moveTrain(rake, LINE, 500, 6, 'wagon');
    carryPassengers([flying], was, rake);
    expect(flying.position).toEqual({ x: 50, y: 2, z: 50 });
  });

  it('does nothing at all if handed the vehicles instead of a copy', () => {
    // The bug itself, stated. `moveTrain` writes over the vehicles, so a
    // caller that keeps references and passes them as "where they were" is
    // asking how far each has moved from itself.
    const rake = layOutTrain(LINE, 300, 6, 'wagon');
    const rider = standing(rake[3]!.x, rake[3]!.z, 3);
    const held = rake.map((v) => v);

    moveTrain(rake, LINE, 460, 6, 'wagon');
    carryPassengers([rider], held, rake);

    // The wagon went 160 m and the passenger stayed exactly where it was.
    expect(rider.position.x).toBeCloseTo(rake[3]!.x - 160, 6);
  });
});

describe('calling at stops', () => {
  /** A tram on a 400 m ring, calling at 100 and 250 metres along it. */
  const tram = () => ({
    along: 60,
    direction: 1,
    speed: 10,
    turnaround: 'recycle' as const,
    calls: [100, 250],
    held: 0,
  });
  const CONSIST = 40;
  const RUN = 400;
  const DWELL = 2;
  const TICK = 1 / 120;

  /** Run it for `seconds`, returning where it was at the end of each tick. */
  const drive = (train: ReturnType<typeof tram>, seconds: number) => {
    const track: { at: number; held: number }[] = [];
    let now = { ...train };
    for (let i = 0; i < Math.round(seconds / TICK); i += 1) {
      const went = advance(now, CONSIST, RUN, TICK, DWELL);
      now = { ...now, along: went.along, direction: went.direction, held: went.held };
      track.push({ at: now.along - CONSIST / 2, held: now.held });
    }
    return track;
  };

  it('stops when the middle of it reaches a platform', () => {
    // The middle, not the front: a forty metre tram at a hundred metre island
    // stands in the middle of the island, which is where one does.
    // Six seconds to reach it from a standing sixty metres back, and a
    // couple more to be sure it is standing there rather than passing.
    const track = drive(tram(), 8);
    const stopped = track.filter((tick) => tick.held > 0);
    expect(stopped.length).toBeGreaterThan(0);
    for (const tick of stopped) expect(tick.at).toBeCloseTo(100, 6);
  });

  it('stands there for the dwell and no longer', () => {
    // To within a tick. Two hundred and forty subtractions of a hundred and
    // twentieth from two do not come to exactly nought, and chasing that
    // would be chasing eight milliseconds.
    const track = drive(tram(), 12);
    const held = track.filter((tick) => tick.held > 0).length;
    expect(held * TICK).toBeCloseTo(DWELL, 1);
  });

  it('pulls away again', () => {
    // The whole reason this is a test rather than a look. A rule that counted
    // landing on a call as reaching one would find the same platform on the
    // tick it left, and again, and the tram would never move -- and from the
    // air a tram that has stopped and a tram that has stopped for ever look
    // exactly alike for the first few seconds.
    const track = drive(tram(), 12);
    const last = track[track.length - 1]!;
    expect(last.held).toBe(0);
    // Four seconds of running after the stop, at ten metres a second.
    expect(last.at).toBeGreaterThan(130);
  });

  it('calls at each of them once a lap, in order', () => {
    // Forty seconds is a lap of 400 m at 10 m/s plus the two dwells.
    const track = drive(tram(), 44);
    const stops: number[] = [];
    let was = 0;
    for (const tick of track) {
      if (tick.held > 0 && was === 0) stops.push(Math.round(tick.at));
      was = tick.held;
    }
    expect(stops).toEqual([100, 250]);
  });

  it('leaves a train with nowhere to call alone', () => {
    // Which is every train on heavy rail. A goods rake in a yard has no
    // passengers to set down, and one that paused every so often for no
    // visible reason would read as a bug, because it would be one.
    const goods = { ...tram(), calls: [] as number[] };
    for (const tick of drive(goods, 8)) expect(tick.held).toBe(0);
  });

  it('does not call across the end of the line', () => {
    // A wrap is not a journey: the tram has been picked up and put down at
    // the other end. Anything between where it was and where it now is has
    // not been passed through.
    // A hundredth of a metre from the end, so this tick takes it over.
    const late = { ...tram(), along: RUN - 0.01 };
    const first = advance(late, CONSIST, RUN, TICK, DWELL);
    expect(first.wrapped).toBe(true);
    expect(first.held).toBe(0);
  });
});

describe('seeing what is in the way', () => {
  /** A vehicle pointing along +x, which in the collider's yaw is nought. */
  const car = (x: number, z: number, yaw = 0) => ({ x, z, yaw });
  const east = { x: 1, z: 0 };
  const nose = { x: 0, z: 0 };
  const look = { x: 25, z: 0 };

  it('stops for one in front, going the same way', () => {
    expect(blockedBy(nose, east, look, [car(28, 0)], 12)).toBe(true);
  });

  it('ignores one coming the other way', () => {
    // Two trams meeting head-on are on the two tracks of a pair, which is
    // what a pair of tracks is for: they are metres apart and they pass.
    expect(blockedBy(nose, east, look, [car(28, 0, Math.PI)], 12)).toBe(false);
  });

  it('ignores one it has already passed', () => {
    // Behind the nose and *within reach of the look-ahead point*, which is
    // the case that matters: on a curve the point found along the track can
    // come back round near something this train is level with or has gone by,
    // and stopping for that is stopping for your own tail.
    //
    // So the look-ahead point is put close in, where a vehicle four metres
    // astern is nine metres from it -- inside the twelve. Only the test
    // against the nose can reject this one.
    const near = { x: 5, z: 0 };
    expect(blockedBy(nose, east, near, [car(-4, 0)], 12)).toBe(false);
    // And the same vehicle four metres *ahead* does stop it, so what is being
    // measured is which side of the nose it is on and nothing else.
    expect(blockedBy(nose, east, near, [car(4, 0)], 12)).toBe(true);
  });

  it('cannot have two trains each in front of the other', () => {
    // The bug this replaced, and the reason trams drove through each other.
    // Tested as the property rather than as a case: two rakes that have got
    // into the same piece of track used to find each other at their own
    // look-ahead points, so both stopped, both waited out the give-up timer,
    // and both then carried on through.
    //
    // Asked of the nose along the way it is going, the relation cannot be
    // symmetric: if it is ahead of me, I am behind it.
    // Both look-ahead points put right on top of both trains, which is the
    // worst case the geometry allows: on a bend, or where two routes cross,
    // the point found along one train's track can sit on the other one.
    for (const gap of [0.5, 2, 6, 10]) {
      const mine = { x: 0, z: 0 };
      const theirs = { x: gap, z: 0 };
      const between = { x: gap / 2, z: 0 };
      const iStop = blockedBy(mine, east, between, [car(theirs.x, theirs.z)], 12);
      const theyStop = blockedBy(theirs, east, between, [car(mine.x, mine.z)], 12);
      expect(iStop && theyStop, `${gap} m apart`).toBe(false);
      // And one of them does stop, so the pair is resolved rather than both
      // being waved through.
      expect(iStop || theyStop, `${gap} m apart`).toBe(true);
    }
  });

  it('looks along the track rather than out of the nose', () => {
    // A box thrown straight ahead of a tram on a bend points at the buildings
    // on the outside of the curve and misses the tram it is following. The
    // look-ahead point comes off the line, so a quarter circle still finds it.
    const bend: Rail = {
      kind: 'tram',
      width: 6,
      points: [[0, 0], [40, 0], [70, 30], [70, 70]],
    };
    const ahead = noseAhead({ line: bend, along: 40, direction: 1 }, 20, 25);
    expect(ahead).not.toBeNull();
    // Round the corner: past the bend at (40, 0), so its z has left nought.
    expect(Math.abs(ahead!.z)).toBeGreaterThan(5);
  });
});
