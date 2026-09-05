import { describe, expect, it } from 'vitest';
import { neutralWalk, walk, type WalkControls } from './walk';
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
    walked(bird, forward(), 10, wall as never);
    expect(isPerched(bird)).toBe(true);
    // Stopped its own radius short of the wall's near face, having had ten
    // seconds -- twelve metres of walking -- to get through it.
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
    walked(bird, forward(), 10, wall as never);

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
