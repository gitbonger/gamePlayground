import { describe, expect, it } from 'vitest';
import {
  asFlight,
  asStance,
  MEET_RADIUS,
  meeting,
  neutralWalk,
  stanceOf,
  turnToFace,
  walk,
  type WalkControls,
} from './walk';
import {
  createBird,
  defaultParams,
  heading,
  isPerched,
  neutralControls,
  step,
  type BirdState,
} from './flight';
import { aabb, createColliderField } from './collision';
import { createWind, defaultWindParams } from './wind';
import { vec } from './math3';

const TICK = 1 / 120;
const p = defaultParams;
/** Where a bird's centre sits when it is standing on the ground plane. */
const STANDING = p.groundHeight + p.bodyRadius;

/** A bird already landed and on its feet, facing `bearing`. */
function landed(at = vec(0, STANDING, 0), bearing = 0): BirdState {
  const bird = createBird(at, 0, bearing);
  bird.velocity = vec(0, 0, 0);
  bird.ending = { kind: 'landed', cause: null, speed: 0, sink: 0, bank: 0, position: at };
  return bird;
}

const forward = (n = 1): WalkControls => ({ forward: n, turn: 0, launch: false });

/** Walk for `seconds`, returning the bird. */
function walked(bird: BirdState, controls: WalkControls, seconds: number, collider?: never) {
  const ticks = Math.round(seconds / TICK);
  for (let i = 0; i < ticks; i += 1) walk(bird, controls, p, TICK, collider);
  return bird;
}

describe('walking', () => {
  it('covers its walking speed in a second, and no more', () => {
    // The speed is fixed and reached at once: a second of walking is one
    // walking speed of ground, not a ramp up to it.
    const bird = walked(landed(), forward(), 1);
    expect(bird.position.z).toBeCloseTo(-p.walkSpeed, 2);
    expect(bird.position.x).toBeCloseTo(0, 9);
  });

  it('is at full speed on the very first step', () => {
    // Stated against the first tick alone, which is what "no acceleration"
    // means and what a ramp would fail.
    const bird = landed();
    walk(bird, forward(), p, TICK);
    expect(Math.abs(bird.position.z)).toBeCloseTo(p.walkSpeed * TICK, 9);
  });

  it('stops dead when the key is let go', () => {
    const bird = walked(landed(), forward(), 1);
    const stopped = { ...bird.position };
    walked(bird, neutralWalk(), 1);
    expect(bird.position.x).toBeCloseTo(stopped.x, 9);
    expect(bird.position.z).toBeCloseTo(stopped.z, 9);
  });

  it('walks backwards at the same one speed', () => {
    const bird = walked(landed(), forward(-1), 1);
    expect(bird.position.z).toBeCloseTo(p.walkSpeed, 2);
  });

  it('turns on the spot without moving', () => {
    const bird = landed();
    walked(bird, { forward: 0, turn: 1, launch: false }, 0.5);
    expect(heading(bird)).toBeCloseTo(p.walkTurnRate * 0.5, 1);
    expect(bird.position.x).toBeCloseTo(0, 9);
    expect(bird.position.z).toBeCloseTo(0, 9);
  });

  it('goes where it is pointed, not where it started pointed', () => {
    // Turn a quarter turn, then walk: the ground covered has to be east.
    const bird = landed();
    walked(bird, { forward: 0, turn: 1, launch: false }, Math.PI / 2 / p.walkTurnRate);
    walked(bird, forward(), 1);
    expect(bird.position.x).toBeCloseTo(p.walkSpeed, 1);
    expect(bird.position.z).toBeCloseTo(0, 1);
  });

  it('leaves a flying bird alone', () => {
    const flying = createBird(vec(0, 50, 0), 14, 0);
    const before = { ...flying.position };
    const out = walk(flying, forward(), p, TICK);
    expect(out.grounded).toBe(false);
    expect(out.travelled).toBe(0);
    expect(flying.position).toEqual(before);
  });

  it('leaves a crashed bird where it lies', () => {
    const dead = landed();
    dead.ending = { ...dead.ending!, kind: 'crashed', cause: 'building' };
    const before = { ...dead.position };
    walked(dead, forward(), 1);
    expect(dead.position).toEqual(before);
  });
});

describe('walking into things', () => {
  /** A wall across the bird's path, four metres ahead and two metres tall. */
  const wall = createColliderField([aabb(-10, 0, -4.5, 10, 2, -3.5)]);

  it('stops at a wall instead of walking through it', () => {
    const bird = landed();
    walked(bird, forward(), 12 / p.walkSpeed, wall as never);
    expect(isPerched(bird)).toBe(true);
    // Stopped its own radius short of the wall's near face, having had twelve
    // metres of walking to get through it. Counted in metres rather than in
    // seconds, so that changing how fast a pigeon walks does not change what
    // this is asking.
    expect(bird.position.z).toBeCloseTo(-3.5 + p.bodyRadius, 2);
  });

  it('slides along a wall met at an angle rather than sticking to it', () => {
    // Walking north-west from the origin at 45 degrees, the bird first touches
    // the wall's near face when it is a body radius off it -- and by then it
    // has gone exactly as far west as it has north. That is where a bird that
    // merely stopped on contact would spend the rest of the walk.
    // The near face is the one at z = -3.5, approached from z = 0.
    const touch = -3.5 + p.bodyRadius;
    const bird = landed(vec(0, STANDING, 0), -Math.PI / 4);
    // Twelve metres of it, which is far enough along the wall to be sliding
    // and not so far as to reach the end of a wall eighteen metres wide and
    // walk out past it.
    walked(bird, forward(), 12 / p.walkSpeed, wall as never);

    expect(bird.position.x).toBeLessThan(touch - 3);
    // Still hard against the wall, rather than having drifted away from it.
    expect(bird.position.z).toBeCloseTo(touch, 1);
  });

  it('reports being blocked, and reports not being blocked', () => {
    const clear = walk(landed(), forward(), p, TICK);
    expect(clear.blocked).toBe(false);

    // Close enough that a single tick of walking reaches the wall.
    const bird = landed(vec(0, STANDING, -3.5 + p.bodyRadius + p.walkSpeed * TICK * 0.5));
    const into = walk(bird, forward(), p, TICK, wall as never);
    expect(into.blocked).toBe(true);
  });
});

describe('walking up and down', () => {
  /** A kerb the bird can step onto, and a table it cannot. */
  const kerb = createColliderField([aabb(-10, 0, -20, 10, 0.1, -2)]);
  const table = createColliderField([aabb(-10, 0, -20, 10, 0.9, -2)]);

  it('steps up onto something within its step height', () => {
    const bird = walked(landed(), forward(), 4, kerb as never);
    expect(isPerched(bird)).toBe(true);
    expect(bird.position.y).toBeCloseTo(0.1 + p.bodyRadius, 6);
    expect(bird.position.z).toBeLessThan(-2.5);
  });

  it('is stopped by something taller than its step height', () => {
    const bird = walked(landed(), forward(), 4, table as never);
    expect(bird.position.y).toBeCloseTo(STANDING, 6);
    expect(bird.position.z).toBeGreaterThan(-2);
  });

  it('steps back down off the kerb rather than falling off it', () => {
    const bird = landed(vec(0, 0.1 + p.bodyRadius, -4), Math.PI);
    walked(bird, forward(), 4, kerb as never);
    expect(isPerched(bird)).toBe(true);
    expect(bird.position.y).toBeCloseTo(STANDING, 6);
  });
});

describe('walking off an edge', () => {
  /** A flat roof two metres up, ending at z = 0. */
  const roof = createColliderField([aabb(-10, 0, 0, 10, 2, 20)]);
  // Four metres in from the near edge, facing it.
  const onRoof = () => landed(vec(0, 2 + p.bodyRadius, 4), 0);

  it('puts the bird back in the air rather than off the edge of the world', () => {
    const bird = onRoof();
    walked(bird, forward(), 5, roof as never);
    expect(isPerched(bird)).toBe(false);
    expect(bird.ending).toBeNull();
    expect(bird.restingOn).toBeNull();
  });

  it('steps off at the pace it was walking, not from a standstill', () => {
    const bird = onRoof();
    walked(bird, forward(), 5, roof as never);
    // Heading north, which is -Z, at walking pace and nothing more.
    expect(bird.velocity.z).toBeCloseTo(-p.walkSpeed, 6);
    expect(bird.velocity.y).toBe(0);
  });

  it('is then the flight model’s problem, and it can be flown out of', () => {
    // The point of handing it back rather than judging the drop here: a bird
    // that steps off a roof is a bird flying, and it can save itself.
    const bird = onRoof();
    walked(bird, forward(), 5, roof as never);

    const flapping = { ...neutralControls(), flap: true, brake: true };
    for (let t = 0; t < 6 && bird.ending === null; t += TICK) {
      step(bird, flapping, p, TICK, roof as never);
    }
    expect(bird.ending?.kind).toBe('landed');
  });

  it('and falling two metres unflown is not survivable', () => {
    // The same step, doing nothing about it. There is no separate drop limit:
    // this is the ordinary landing rule, met at the speed gravity gives.
    const bird = onRoof();
    walked(bird, forward(), 5, roof as never);
    for (let t = 0; t < 6 && bird.ending === null; t += TICK) {
      step(bird, neutralControls(), p, TICK, roof as never);
    }
    expect(bird.ending?.kind).toBe('crashed');
    expect(bird.ending?.cause).toBe('hard-impact');
  });
});

describe('flying out of a fall off a building', () => {
  /** A block of flats of a height this city actually has, ending at z = 0. */
  const HEIGHT = 24;
  const block = createColliderField([aabb(-10, 0, 0, 10, HEIGHT, 20)]);
  const onTop = () => landed(vec(0, HEIGHT + p.bodyRadius, 4), 0);

  /** Step off the roof, then fly it. */
  function stepOffAndFly(pilot: (y: number) => ReturnType<typeof neutralControls>) {
    const bird = onTop();
    walked(bird, forward(), 5, block as never);
    expect(bird.ending).toBeNull();
    for (let i = 0; i < 4000 && bird.ending === null; i += 1) {
      step(bird, pilot(bird.position.y), p, TICK, block as never);
    }
    return bird;
  }

  it('is survivable, which is the whole reason falling is flying', () => {
    // Dive to build airspeed, then flare. Twenty-four metres is enough room
    // to do it in, and doing it is the skill the mode asks for.
    const flown = stepOffAndFly((y) =>
      y > 12
        ? { ...neutralControls(), pitch: -0.6, tuck: true }
        : { ...neutralControls(), pitch: 1, brake: true, flap: true },
    );
    expect(flown.ending?.kind).toBe('landed');
  });

  it('is not survivable by doing nothing about it', () => {
    expect(stepOffAndFly(() => neutralControls()).ending?.kind).toBe('crashed');
  });

  it('needs the height to flare from, not just the intent to', () => {
    // The same pilot, leaving the flare until four metres up. There is no
    // arresting twenty metres of fall in four, and that is the real rule
    // rather than a number written down anywhere.
    const late = stepOffAndFly((y) =>
      y > 4
        ? { ...neutralControls(), pitch: -0.6, tuck: true }
        : { ...neutralControls(), pitch: 1, brake: true, flap: true },
    );
    expect(late.ending?.kind).toBe('crashed');
  });
});

describe('being run over', () => {
  /** A wall across the bird's path, four metres ahead, going somewhere. */
  const moving = (speed: number, carrier?: number) =>
    createColliderField([
      { ...aabb(-10, 0, -4.5, 10, 2, -3.5), speed, ...(carrier === undefined ? {} : { carrier }) },
    ]);

  it('kills a bird that walks into something moving', () => {
    const bird = landed();
    walked(bird, forward(), 10, moving(6) as never);
    expect(bird.ending?.kind).toBe('crashed');
    expect(bird.ending?.cause).toBe('struck');
  });

  it('kills a bird standing still that something moving reaches', () => {
    // The other half, and the one a sweep cannot see: a slab test that starts
    // inside a box has no entry face to report. Standing on the rails is how
    // you are hit by a train, not how you avoid it.
    const bird = landed(vec(0, STANDING, -4));
    const out = walk(bird, neutralWalk(), p, TICK, moving(6) as never);
    expect(out.grounded).toBe(false);
    expect(bird.ending?.cause).toBe('struck');
  });

  it('does not kill a bird against the same thing standing still', () => {
    // A wall you walk into and a train that runs into you are not the same
    // event, and the geometry cannot tell them apart. The speed can.
    const bird = landed();
    walked(bird, forward(), 10, moving(0) as never);
    expect(isPerched(bird)).toBe(true);
  });

  it('does not kill a bird by the thing it is standing on', () => {
    // A pigeon riding a wagon walks into its own stakes all the time, and
    // they are moving at exactly the speed it is.
    const bird = landed(vec(0, STANDING, -4));
    bird.restingOn = 7;
    const out = walk(bird, forward(), p, TICK, moving(6, 7) as never);
    expect(bird.ending?.kind).toBe('landed');
    expect(out.grounded).toBe(true);

    // And a different wagon on the same train still does.
    const unlucky = landed(vec(0, STANDING, -4));
    unlucky.restingOn = 2;
    walk(unlucky, forward(), p, TICK, moving(6, 7) as never);
    expect(unlucky.ending?.cause).toBe('struck');
  });

  it('takes a real speed, not any speed at all', () => {
    // A rake being shunted at a centimetre a second is not running anybody
    // over. Stated either side of the limit rather than at it.
    const creeping = landed();
    walked(creeping, forward(), 10, moving(p.struckSpeed * 0.5) as never);
    expect(isPerched(creeping)).toBe(true);

    const running = landed();
    walked(running, forward(), 10, moving(p.struckSpeed * 2) as never);
    expect(running.ending?.cause).toBe('struck');
  });
});

describe('flying into something moving', () => {
  const movingWall = createColliderField([
    { ...aabb(-10, 0, -4.5, 10, 20, -3.5), speed: 6 },
  ]);
  const stillWall = createColliderField([aabb(-10, 0, -4.5, 10, 20, -3.5)]);

  it('is fatal at a speed that would only have scraped a wall', () => {
    // Below `crashSpeed` a bird meets a wall, stops against it and slides
    // down. The flank of a moving train it does not. Judged at the moment of
    // contact rather than at the end, because the scraped bird dies too --
    // on the ground, a second later, having slid all the way down the wall.
    const gentle = () => createBird(vec(0, 10, 0), 3, 0);
    /** Fly at the wall until it is reached, and report the state there. */
    const upTo = (field: typeof stillWall) => {
      const bird = gentle();
      for (let i = 0; i < 240; i += 1) {
        step(bird, neutralControls(), p, TICK, field as never);
        // Contact stops the bird a body radius off the wall's near face, at
        // z = -3.28. Either resolution leaves it within a millimetre of that,
        // and nothing on the approach is anywhere near it.
        if (bird.ending !== null || bird.position.z <= -3.27) break;
      }
      return bird;
    };

    const scraped = upTo(stillWall);
    const hit = upTo(movingWall);

    // Both are at the wall, well off the ground.
    expect(scraped.position.y).toBeGreaterThan(4);
    expect(hit.position.y).toBeGreaterThan(4);
    // One of them is still flying.
    expect(scraped.ending).toBeNull();
    expect(hit.ending?.cause).toBe('struck');
  });

  it('does not stop you landing on top of one', () => {
    // The exception the whole thing turns on: putting down on the deck of a
    // moving wagon is judged as a landing, before any of this is reached.
    const deck = createColliderField([
      { ...aabb(-20, 0, -20, 20, 1.25, 20), speed: 6, carrier: 1 },
    ]);
    const bird = createBird(vec(0, 1.25 + 1.5, 0), 7, 0);
    for (let i = 0; i < 2400 && bird.ending === null; i += 1) {
      step(bird, neutralControls(), p, TICK, deck as never);
    }
    expect(bird.ending?.kind).toBe('landed');
    expect(bird.restingOn).toBe(1);
  });
});

describe('taking off', () => {
  const launch = (): WalkControls => ({ ...neutralWalk(), launch: true });

  it('puts the bird in the air, going forwards and upwards', () => {
    const bird = landed();
    const out = walk(bird, launch(), p, TICK);

    expect(out.grounded).toBe(false);
    expect(isPerched(bird)).toBe(false);
    expect(bird.ending).toBeNull();
    expect(bird.restingOn).toBeNull();
    // Facing north, so forward is -Z, and climbing.
    expect(bird.velocity.z).toBeLessThan(-1);
    expect(bird.velocity.y).toBeGreaterThan(1);
  });

  it('leaves at a speed the wing can fly at, not at a hop', () => {
    // A bird put into the air below its stall speed has been thrown, and it
    // comes straight back down. Stated against what the flight model itself
    // calls too slow to land at, which is a speed it can certainly fly at.
    const bird = landed();
    walk(bird, launch(), p, TICK);
    const speed = Math.hypot(bird.velocity.x, bird.velocity.y, bird.velocity.z);
    expect(speed).toBeCloseTo(p.launchSpeed, 6);
    expect(speed).toBeGreaterThan(p.landingSpeed);
  });

  it('leaves along its own velocity rather than sideways through the air', () => {
    const bird = landed();
    walk(bird, launch(), p, TICK);
    // The climb angle of the velocity, against the attitude it holds.
    const climb = Math.asin(
      bird.velocity.y / Math.hypot(bird.velocity.x, bird.velocity.y, bird.velocity.z),
    );
    expect(climb).toBeCloseTo(p.launchAngle, 6);
  });

  it('goes the way the bird is pointed', () => {
    for (const bearing of [0, 1.1, -2.4]) {
      const bird = landed(vec(0, STANDING, 0), bearing);
      walk(bird, launch(), p, TICK);
      const went = Math.atan2(bird.velocity.x, -bird.velocity.z);
      expect(went).toBeCloseTo(bearing, 6);
    }
  });

  it('does not kill the bird that lets go of the key at once', () => {
    // The thing that had to be got right. Take off and do nothing else: the
    // arc has to come back inside the landing limits rather than outside
    // them, or a tap on the take-off key is a death sentence. Checked in
    // every direction and at a spread of times, because there is wind.
    const air = createWind(defaultWindParams);
    for (let compass = 0; compass < 16; compass += 1) {
      const bird = landed(vec(0, STANDING, 0), (compass / 16) * Math.PI * 2);
      bird.age = compass * 5;
      walk(bird, launch(), p, TICK);
      for (let i = 0; i < 1500 && bird.ending === null; i += 1) {
        step(bird, neutralControls(), p, TICK, undefined, air);
      }
      expect(bird.ending?.kind, `bearing ${compass}/16`).toBe('landed');
    }
  });

  it('and flies away for the one that holds it', () => {
    const bird = landed();
    walk(bird, launch(), p, TICK);
    const beating = { ...neutralControls(), flap: true };
    for (let i = 0; i < 1200 && bird.ending === null; i += 1) {
      step(bird, beating, p, TICK, undefined);
    }
    expect(bird.ending).toBeNull();
    expect(bird.position.y).toBeGreaterThan(20);
  });

  it('will not launch a bird that is not on its feet', () => {
    const flying = createBird(vec(0, 50, 0), 14, 0);
    const before = { ...flying.velocity };
    walk(flying, launch(), p, TICK);
    expect(flying.velocity).toEqual(before);

    const dead = landed();
    dead.ending = { ...dead.ending!, kind: 'crashed', cause: 'building' };
    walk(dead, launch(), p, TICK);
    expect(dead.ending?.kind).toBe('crashed');
  });

  it('clears the ground it was standing on, wherever that was', () => {
    // Off a wagon deck as readily as off the grass: the launch is a velocity,
    // so it does not care what it was standing on.
    const deck = 1.25 + p.bodyRadius;
    const bird = landed(vec(0, deck, 0));
    bird.restingOn = 3;
    walk(bird, launch(), p, TICK);
    expect(bird.restingOn).toBeNull();
    expect(bird.velocity.y).toBeGreaterThan(1);
  });
});

describe('meeting another pigeon', () => {
  /** A bird on its feet at `at`, standing on `on`. */
  const standing = (at: ReturnType<typeof vec>, on: number | null) => {
    const b = landed(at);
    b.restingOn = on;
    return b;
  };

  it('counts when both are on foot, on the same thing, and within reach', () => {
    const a = standing(vec(0, 1.47, 0), 6);
    const b = standing(vec(1.5, 1.47, 0), 6);
    expect(meeting(a, b)).toBe(true);
  });

  it('does not count from further off than arm’s reach', () => {
    const a = standing(vec(0, 1.47, 0), 6);
    const b = standing(vec(MEET_RADIUS + 0.1, 1.47, 0), 6);
    expect(meeting(a, b)).toBe(false);
  });

  it('does not count for a bird passing underneath on the ground', () => {
    // The one the whole rule exists for: a train running under a rooftop, or
    // a pigeon on the ballast beside the wagon you are standing on. Close
    // enough to touch, and not the same place at all.
    const onDeck = standing(vec(0, 1.47, 0), 6);
    const onGround = standing(vec(0, 0.22, 0), null);
    expect(Math.abs(onDeck.position.y - onGround.position.y)).toBeLessThan(MEET_RADIUS);
    expect(meeting(onDeck, onGround)).toBe(false);
  });

  it('does not count for the next wagon along', () => {
    const a = standing(vec(0, 1.47, 0), 6);
    const b = standing(vec(1, 1.47, 0), 7);
    expect(meeting(a, b)).toBe(false);
  });

  it('does not count while either of them is flying', () => {
    const grounded = standing(vec(0, 1.47, 0), 6);
    const flying = standing(vec(1, 1.47, 0), 6);
    flying.ending = null;
    expect(meeting(grounded, flying)).toBe(false);
    expect(meeting(flying, grounded)).toBe(false);

    // And a crashed one is not somebody you have met either.
    const dead = standing(vec(1, 1.47, 0), 6);
    dead.ending = { ...dead.ending!, kind: 'crashed', cause: 'struck' };
    expect(meeting(grounded, dead)).toBe(false);
  });

  it('measures the whole distance, not just the ground plan', () => {
    // Two metres directly above is two metres away, and on a wagon with
    // stakes that is a real place to be.
    const a = standing(vec(0, 1.47, 0), 6);
    const b = standing(vec(0, 1.47 + MEET_RADIUS + 0.1, 0), 6);
    expect(meeting(a, b)).toBe(false);
  });

  it('lets two birds meet on open ground', () => {
    // Both standing on nothing is both standing on the same ground, and the
    // reach is what keeps that honest.
    const a = standing(vec(0, STANDING, 0), null);
    const b = standing(vec(1, STANDING, 0), null);
    expect(meeting(a, b)).toBe(true);
  });
});

describe('the three stances', () => {
  it('names what a bird is doing', () => {
    const flying = createBird(vec(0, 50, 0), 14, 0);
    expect(stanceOf(flying, false)).toBe('flying');
    // Somebody to talk to is no help while you are in the air.
    expect(stanceOf(flying, true)).toBe('flying');

    const down = landed();
    expect(stanceOf(down, false)).toBe('walking');
    expect(stanceOf(down, true)).toBe('talking');
  });

  it('says a crashed bird is dead, whoever it is standing next to', () => {
    // A stance of its own rather than the absence of one. Being dead is a
    // thing the game has to ask about -- the pose, the keys, whether the
    // flock may let another bird out -- and nothing can be asked of a null.
    const dead = landed();
    dead.ending = { ...dead.ending!, kind: 'crashed', cause: 'struck' };
    expect(stanceOf(dead, false)).toBe('dead');
    expect(stanceOf(dead, true)).toBe('dead');
  });

  it('lets a walking bird do everything', () => {
    const held = { forward: 1, turn: -1, launch: true };
    expect(asStance(held, 'walking')).toEqual(held);
  });

  it('takes the movement off somebody in conversation, and leaves the wing', () => {
    // The point of it being a mode. You walked up to them deliberately, and
    // shuffling a foot sideways should not end the conversation by accident.
    // Flying out of it is a thing you do on purpose, so that stays.
    const held = { forward: 1, turn: -1, launch: true };
    expect(asStance(held, 'talking')).toEqual({ forward: 0, turn: 0, launch: true });
    expect(asStance({ ...held, launch: false }, 'talking')).toEqual({
      forward: 0,
      turn: 0,
      launch: false,
    });
  });

  it('gives a flying or dead bird nothing on foot at all', () => {
    const held = { forward: 1, turn: -1, launch: true };
    for (const stance of ['flying', 'dead'] as const) {
      expect(asStance(held, stance), `${stance}`).toEqual({
        forward: 0,
        turn: 0,
        launch: false,
      });
    }
  });

  it('takes the wing off a dead bird, and leaves every other stance its keys', () => {
    // Not about movement: the flight model already ignores a bird whose
    // flight has ended, so a dead one was never going anywhere. It is about
    // the wings, which are drawn from these -- holding the brake over a
    // corpse spread them to brake, and holding tuck folded them away.
    const held = { ...neutralControls(), flap: true, brake: true, tuck: true, pitch: 1 };
    expect(asFlight(held, 'dead')).toEqual(neutralControls());
    for (const stance of ['flying', 'walking', 'talking'] as const) {
      expect(asFlight(held, stance), stance).toBe(held);
    }
  });

  it('does not move a bird that is in conversation', () => {
    // End to end: the filtered controls through the walk model itself.
    const bird = landed();
    const before = { ...bird.position };
    const wanting = { forward: 1, turn: 1, launch: false };
    for (let i = 0; i < 240; i += 1) {
      walk(bird, asStance(wanting, stanceOf(bird, true)), p, TICK);
    }
    expect(bird.position.x).toBeCloseTo(before.x, 9);
    expect(bird.position.z).toBeCloseTo(before.z, 9);
    expect(heading(bird)).toBeCloseTo(0, 9);
    expect(isPerched(bird)).toBe(true);
  });

  it('but can still be flown out of', () => {
    const bird = landed();
    walk(bird, asStance({ forward: 0, turn: 0, launch: true }, stanceOf(bird, true)), p, TICK);
    expect(bird.ending).toBeNull();
    expect(bird.velocity.y).toBeGreaterThan(1);
  });
});

describe('turning to face somebody', () => {
  const facing = (state: ReturnType<typeof landed>) => heading(state);
  /** Turn for `seconds`, toward a point. */
  const turned = (state: ReturnType<typeof landed>, at: ReturnType<typeof vec>, seconds: number) => {
    const ticks = Math.round(seconds / TICK);
    for (let i = 0; i < ticks; i += 1) turnToFace(state, at, p, TICK);
    return state;
  };

  it('comes round to look at them', () => {
    // Standing facing north with somebody due east.
    const bird = landed(vec(0, STANDING, 0), 0);
    turned(bird, vec(10, STANDING, 0), 3);
    expect(facing(bird)).toBeCloseTo(Math.PI / 2, 3);
  });

  it('looks the right way from wherever it started', () => {
    for (const start of [0, 1.2, -2.4, Math.PI]) {
      for (const [x, z, want] of [
        [10, 0, Math.PI / 2],
        [-10, 0, -Math.PI / 2],
        [0, -10, 0],
      ] as const) {
        const bird = landed(vec(0, STANDING, 0), start);
        turned(bird, vec(x, STANDING, z), 4);
        expect(facing(bird), `from ${start} to ${x},${z}`).toBeCloseTo(want, 3);
      }
    }
  });

  it('takes the short way round', () => {
    // Across the back, where a heading of +3 rad and one of -3 are a sixth of
    // a radian apart and look like six. Measured as how long it takes: the
    // short way is a tenth of a second, the long way the better part of
    // three. An angle that does not cross the wrap cannot tell them apart,
    // which is how the first version of this test passed either way.
    const bird = landed(vec(0, STANDING, 0), 3);
    // A point due -3 rad from the origin.
    const at = vec(Math.sin(-3) * 10, STANDING, -Math.cos(-3) * 10);

    turned(bird, at, 0.3);
    expect(facing(bird)).toBeCloseTo(-3, 2);
  });

  it('turns at the pace it walks, rather than snapping round', () => {
    // One tick of turning is one tick's worth, which is what makes it read as
    // a bird noticing you rather than as one being teleported.
    const bird = landed(vec(0, STANDING, 0), 0);
    turnToFace(bird, vec(10, STANDING, 0), p, TICK);
    expect(facing(bird)).toBeCloseTo(p.walkTurnRate * TICK, 6);
  });

  it('stops once it is looking at them', () => {
    const bird = landed(vec(0, STANDING, 0), 0);
    turned(bird, vec(10, STANDING, 0), 3);
    const settled = facing(bird);
    turned(bird, vec(10, STANDING, 0), 3);
    expect(facing(bird)).toBeCloseTo(settled, 9);
  });

  it('leaves a bird that is not on its feet alone', () => {
    const flying = createBird(vec(0, 50, 0), 14, 0);
    const before = { ...flying.orientation };
    turnToFace(flying, vec(10, 50, 0), p, TICK);
    expect(flying.orientation).toEqual(before);
  });
});

describe('the stride animation', () => {
  it('advances with the ground covered, not with the clock', () => {
    const fast = walked(landed(), forward(), 1);
    const half = walked(landed(), forward(0.5), 1);
    expect(fast.stridePhase).not.toBeCloseTo(half.stridePhase, 3);

    // One stride of ground is one full cycle, whatever the tick length.
    const bird = landed();
    walk(bird, forward(), p, p.walkStride / p.walkSpeed);
    expect(bird.stridePhase).toBeCloseTo(0, 6);
  });

  it('stays within one cycle walking either way', () => {
    for (const direction of [1, -1]) {
      const bird = walked(landed(), forward(direction), 3);
      expect(bird.stridePhase).toBeGreaterThanOrEqual(0);
      expect(bird.stridePhase).toBeLessThan(1);
    }
  });

  it('does not move while the bird is standing still', () => {
    const bird = walked(landed(), forward(), 0.5);
    const paused = bird.stridePhase;
    walked(bird, neutralWalk(), 1);
    expect(bird.stridePhase).toBe(paused);
  });
});
