import { describe, expect, it } from 'vitest';
import {
  bankAngle,
  createBird,
  defaultParams,
  hasCrashed,
  heading,
  isPerched,
  landingReadiness,
  liftCoefficient,
  neutralControls,
  step,
  type Controls,
  type FlightParams,
} from './flight';
import { clamp, dot, length, normalize, quatFromAxisAngle, rotate, sub, vec } from './math3';
import { aabb, createColliderField, turnedBox } from './collision';

const DT = 1 / 120;

/** Run the model for `seconds` and hand back the final telemetry. */
function fly(
  seconds: number,
  controls: Partial<Controls> = {},
  params: Partial<FlightParams> = {},
  bird = createBird(),
  collider?: Parameters<typeof step>[4],
) {
  const p = { ...defaultParams, ...params };
  const c = { ...neutralControls(), ...controls };
  let telemetry = step(bird, c, p, DT, collider);
  for (let t = DT; t < seconds; t += DT) telemetry = step(bird, c, p, DT, collider);
  return { bird, telemetry };
}

describe('lift coefficient', () => {
  it('is linear below the stall', () => {
    const cl = liftCoefficient(0.1, defaultParams);
    expect(cl).toBeCloseTo(defaultParams.liftSlope * 0.1, 6);
  });

  it('peaks at the stall angle and falls off past it', () => {
    const atStall = liftCoefficient(defaultParams.stallAngle, defaultParams);
    const pastStall = liftCoefficient(defaultParams.stallAngle + 0.3, defaultParams);
    expect(pastStall).toBeLessThan(atStall);
  });

  it('is antisymmetric about zero', () => {
    expect(liftCoefficient(-0.4, defaultParams)).toBeCloseTo(-liftCoefficient(0.4, defaultParams), 6);
  });

  it('stays finite through the whole range', () => {
    for (let a = -Math.PI; a <= Math.PI; a += 0.05) {
      expect(Number.isFinite(liftCoefficient(a, defaultParams))).toBe(true);
    }
  });
});

describe('gliding', () => {
  it('sinks slowly rather than dropping like a stone', () => {
    const { telemetry } = fly(2);
    const freefall = -defaultParams.gravity * 2;
    expect(telemetry.climbRate).toBeGreaterThan(freefall * 0.25);
    expect(telemetry.climbRate).toBeLessThan(0);
  });

  it('reaches a glide ratio in the range a real pigeon manages', () => {
    const bird = createBird(vec(0, 400, 0));
    const start = { ...bird.position };
    const { bird: end } = fly(20, {}, {}, bird);

    const dropped = start.y - end.position.y;
    const travelled = Math.hypot(end.position.x - start.x, end.position.z - start.z);
    const glideRatio = travelled / dropped;

    // A pigeon is a powered flier, not a soarer. Anything much past 6 is
    // sailplane territory and lets you cross the whole city on one glide.
    expect(glideRatio).toBeGreaterThan(3);
    expect(glideRatio).toBeLessThan(6.5);
  });

  it('settles toward a steady airspeed instead of accelerating forever', () => {
    const { telemetry: early } = fly(3, {}, {}, createBird(vec(0, 400, 0)));
    const { telemetry: late } = fly(25, {}, {}, createBird(vec(0, 400, 0)));
    expect(Math.abs(late.airspeed - early.airspeed)).toBeLessThan(8);
  });
});

describe('flapping', () => {
  it('climbs when a rested bird flaps', () => {
    const glide = fly(3, {}, {}, createBird(vec(0, 200, 0)));
    const flapped = fly(3, { flap: true }, {}, createBird(vec(0, 200, 0)));
    expect(flapped.bird.position.y).toBeGreaterThan(glide.bird.position.y);
  });

  it('drains stamina while flapping and recovers while gliding', () => {
    const { bird } = fly(3, { flap: true }, {}, createBird(vec(0, 200, 0)));
    expect(bird.stamina).toBeLessThan(1);

    const before = bird.stamina;
    fly(3, {}, {}, bird);
    expect(bird.stamina).toBeGreaterThan(before);
  });

  it('loses thrust once stamina is gone', () => {
    const tired = createBird(vec(0, 200, 0));
    tired.stamina = 0;
    const rested = createBird(vec(0, 200, 0));

    const a = fly(2, { flap: true }, {}, tired);
    const b = fly(2, { flap: true }, {}, rested);
    expect(a.bird.position.y).toBeLessThan(b.bird.position.y);
  });
});

describe('diving', () => {
  it('builds more speed tucked than spread', () => {
    const nose = quatFromAxisAngle(vec(1, 0, 0), -0.6);

    const spread = createBird(vec(0, 300, 0));
    spread.orientation = nose;
    const tucked = createBird(vec(0, 300, 0));
    tucked.orientation = nose;

    const a = fly(4, {}, {}, spread);
    const b = fly(4, { tuck: true }, {}, tucked);
    expect(b.telemetry.airspeed).toBeGreaterThan(a.telemetry.airspeed);
  });
});

describe('turning', () => {
  it('changes heading when banked, with no yaw input at all', () => {
    const bird = createBird(vec(0, 200, 0));
    // A short input to establish the bank, then hands off the controls.
    fly(0.4, { roll: 1 }, {}, bird);
    expect(bankAngle(bird)).toBeGreaterThan(0.3);

    fly(3, {}, {}, bird);

    // Banked right, so the nose should have swung right of the start heading.
    const forward = rotate(bird.orientation, vec(0, 0, -1));
    expect(forward.x).toBeGreaterThan(0.1);
  });

  it('rolls the opposite way for the opposite input', () => {
    // Short enough that neither bird rolls past vertical and wraps around.
    const right = createBird(vec(0, 200, 0));
    fly(0.3, { roll: 1 }, {}, right);
    const left = createBird(vec(0, 200, 0));
    fly(0.3, { roll: -1 }, {}, left);

    expect(bankAngle(right)).toBeGreaterThan(0);
    expect(bankAngle(left)).toBeLessThan(0);
  });
});

describe('stability', () => {
  it('pulls the nose back toward the trim angle', () => {
    const bird = createBird(vec(0, 300, 0));
    bird.orientation = quatFromAxisAngle(vec(1, 0, 0), 0.5);
    const { telemetry } = fly(5, {}, {}, bird);
    expect(telemetry.angleOfAttack).toBeCloseTo(defaultParams.trimAngle, 1);
  });

  it('never produces NaN, even from an absurd starting state', () => {
    const bird = createBird(vec(0, 500, 0));
    bird.velocity = vec(60, -40, 25);
    bird.angularVelocity = vec(9, -7, 12);
    const { bird: end, telemetry } = fly(10, { pitch: 1, roll: -1, flap: true }, {}, bird);

    expect(Number.isFinite(length(end.position))).toBe(true);
    expect(Number.isFinite(length(end.velocity))).toBe(true);
    expect(Number.isFinite(telemetry.airspeed)).toBe(true);
  });
});

describe('ground', () => {
  it('stops at the ground plane instead of sinking through it', () => {
    const bird = createBird(vec(0, 3, 0), 2);
    const { bird: end } = fly(6, {}, {}, bird);
    expect(end.position.y).toBe(defaultParams.groundHeight);
    expect(end.ending).not.toBeNull();
  });
});

describe('determinism', () => {
  it('produces identical results for identical inputs', () => {
    const a = fly(5, { pitch: 0.3, roll: 0.2, flap: true });
    const b = fly(5, { pitch: 0.3, roll: 0.2, flap: true });
    expect(a.bird.position).toEqual(b.bird.position);
    expect(a.bird.velocity).toEqual(b.bird.velocity);
  });
});

describe('crashing', () => {
  /** A wall across the bird's path, 100 m ahead of the spawn. */
  const wall = () =>
    createColliderField([aabb(-200, 0, -105, 200, 300, -95)]);

  it('ends the flight on hitting a building at speed', () => {
    const bird = createBird(vec(0, 120, 0), 16);
    const { bird: end } = fly(12, {}, {}, bird, wall());

    expect(end.ending).not.toBeNull();
    expect(end.ending!.kind).toBe('crashed');
    expect(end.ending!.cause).toBe('building');
    // Stopped at the wall's near face, not inside or beyond it.
    expect(end.ending!.position.z).toBeCloseTo(-95, 0);
  });

  it('leaves the bird inert once the flight has ended', () => {
    const bird = createBird(vec(0, 120, 0), 16);
    fly(12, {}, {}, bird, wall());
    const crashed = { ...bird.position };

    fly(5, { flap: true, pitch: 1 }, {}, bird, wall());
    expect(bird.position).toEqual(crashed);
    expect(length(bird.velocity)).toBe(0);
  });

  it('flies clean past the same wall when there is no collider', () => {
    const bird = createBird(vec(0, 120, 0), 16);
    const { bird: end } = fly(12, {}, {}, bird);
    expect(end.ending).toBeNull();
    expect(end.position.z).toBeLessThan(-100);
  });

  it('survives a gentle brush below the crash threshold', () => {
    const bird = createBird(vec(0, 120, 0), 2);
    const { bird: end } = fly(3, {}, { gravity: 0 }, bird, wall());
    expect(end.ending).toBeNull();
  });

  it('does not tunnel through a wall during a tucked dive', () => {
    // Started below the wall's 300 m top, so it cannot simply overfly it.
    const bird = createBird(vec(0, 150, 0), 50);
    const { bird: end } = fly(20, { tuck: true }, {}, bird, wall());
    expect(end.ending!.cause).toBe('building');
    expect(end.position.z).toBeGreaterThan(-105);
  });

  it('ends the flight on slamming into the ground', () => {
    const bird = createBird(vec(0, 60, 0), 5);
    bird.orientation = quatFromAxisAngle(vec(1, 0, 0), -1.2);
    const { bird: end } = fly(20, { tuck: true }, {}, bird);

    expect(end.ending!.kind).toBe('crashed');
    expect(end.ending!.cause).toBe('hard-impact');
  });
});

describe('landing', () => {
  /**
   * Fly an approach: glide until `flareAt` metres, then hold `pitch`.
   * This is the manoeuvre a player performs, run open-loop.
   */
  function approach(flareAt: number, pitch: number, extra: Partial<Controls> = {}) {
    const bird = createBird(vec(0, 60, 0), 15);
    const p = defaultParams;
    const controls = { ...neutralControls(), ...extra };
    for (let t = 0; t < 60; t += DT) {
      controls.pitch = bird.position.y < flareAt ? pitch : (extra.pitch ?? 0);
      step(bird, controls, p, DT);
      if (bird.ending) break;
    }
    return bird;
  }

  it('lands cleanly when the flare is timed well', () => {
    const bird = approach(5, 0.7);
    expect(bird.ending).not.toBeNull();
    expect(bird.ending!.kind).toBe('landed');
    expect(bird.ending!.cause).toBeNull();
  });

  it('accepts the whole spread of flare strengths at the sweet spot', () => {
    // The band is four to seven metres up. It used to be two, and moved when
    // the bird stopped gliding at barely above its landing speed: arriving at
    // 14 m/s rather than 11 takes longer to bleed off, so the flare has to
    // start higher. Anywhere in the band, any strength of pull, it lands.
    for (const flareAt of [4, 5, 6, 7]) {
      for (const pitch of [0.3, 0.5, 0.7, 0.9, 1]) {
        expect(approach(flareAt, pitch).ending!.kind, `${flareAt} m at ${pitch}`).toBe('landed');
      }
    }
  });

  it('rejects a straight-in glide as too fast', () => {
    const bird = approach(0, 0);
    expect(bird.ending!.kind).toBe('crashed');
    expect(bird.ending!.cause).toBe('too-fast');
  });

  it('rejects flaring far too high, which balloons and then drops', () => {
    const bird = approach(10, 0.9);
    expect(bird.ending!.kind).toBe('crashed');
    expect(bird.ending!.cause).toBe('hard-impact');
  });

  it('rejects touching down with a wing down', () => {
    const bird = createBird(vec(0, 2, 0), 4);
    bird.orientation = quatFromAxisAngle(vec(0, 0, 1), 0.9);
    bird.velocity = vec(0, -0.5, -4);
    const p = { ...defaultParams, gravity: 2 };
    const controls = neutralControls();
    for (let t = 0; t < 20; t += DT) {
      step(bird, controls, p, DT);
      if (bird.ending) break;
    }
    expect(bird.ending!.kind).toBe('crashed');
    expect(bird.ending!.cause).toBe('not-level');
  });

  it('records the touchdown numbers it judged', () => {
    const bird = approach(5, 0.7);
    const ending = bird.ending!;
    expect(ending.sink).toBeLessThanOrEqual(defaultParams.landingSink);
    expect(ending.speed).toBeLessThanOrEqual(defaultParams.landingSpeed);
    expect(ending.bank).toBeLessThanOrEqual(defaultParams.landingBank);
    expect(ending.position.y).toBe(defaultParams.groundHeight);
  });

  it('leaves the bird stopped where it landed', () => {
    const bird = approach(5, 0.7);
    expect(length(bird.velocity)).toBe(0);
    expect(bird.position.y).toBe(defaultParams.groundHeight);
  });
});

describe('landing readiness', () => {
  it('agrees with the verdict the touchdown actually gives', () => {
    // A bird held just above the ground in a good attitude reads as ready.
    const good = createBird(vec(0, 5, 0), 6);
    good.velocity = vec(0, -1, -6);
    expect(landingReadiness(good, defaultParams).ready).toBe(true);

    const fast = createBird(vec(0, 5, 0), 20);
    fast.velocity = vec(0, -1, -20);
    const readiness = landingReadiness(fast, defaultParams);
    expect(readiness.ready).toBe(false);
    expect(readiness.speedOk).toBe(false);
    expect(readiness.sinkOk).toBe(true);
  });

  it('flags a fast descent', () => {
    const dropping = createBird(vec(0, 5, 0), 3);
    dropping.velocity = vec(0, -9, -3);
    const readiness = landingReadiness(dropping, defaultParams);
    expect(readiness.sinkOk).toBe(false);
    expect(readiness.ready).toBe(false);
  });

  it('flags a banked attitude', () => {
    const banked = createBird(vec(0, 5, 0), 5);
    banked.velocity = vec(0, -1, -5);
    banked.orientation = quatFromAxisAngle(vec(0, 0, 1), 1);
    const readiness = landingReadiness(banked, defaultParams);
    expect(readiness.bankOk).toBe(false);
    expect(readiness.ready).toBe(false);
  });
});

describe('braking', () => {
  /** Hold a configuration from cruise and report where it settles. */
  function settle(controls: Partial<Controls>, seconds = 6) {
    const bird = createBird(vec(0, 5000, 0), 15.3);
    const { telemetry } = fly(seconds, controls, {}, bird);
    return { speed: telemetry.airspeed, sink: -telemetry.climbRate, telemetry, bird };
  }

  it('bleeds a fast entry down far quicker than coasting does', () => {
    /** Time to fall below `target` airspeed from a 22 m/s entry. */
    const timeToSlow = (controls: Partial<Controls>, target: number) => {
      const bird = createBird(vec(0, 5000, 0), 22);
      const c = { ...neutralControls(), ...controls };
      for (let t = 0; t < 20; t += DT) {
        if (step(bird, c, defaultParams, DT).airspeed <= target) return t;
      }
      return Infinity;
    };

    expect(timeToSlow({ brake: true }, 12)).toBeLessThan(timeToSlow({}, 12) * 0.7);
  });

  it('settles into a steeper descent than a coast', () => {
    // Not a slower one: with the braking wing giving up its lift, holding the
    // brake for half a minute ends in a dive, and gravity feeds the speed back.
    // What braking buys is the first few seconds, covered above and below.
    expect(settle({ brake: true }, 25).sink).toBeGreaterThan(settle({}, 25).sink);
  });

  it('settles slower still when the beat is reversed', () => {
    expect(settle({ brake: true, flap: true }).speed).toBeLessThan(settle({ brake: true }).speed);
  });

  it('sinks more gently with the reversed beat than without it', () => {
    // The braking stroke is nearly vertical: most of it holds the bird up.
    expect(settle({ brake: true, flap: true }).sink).toBeLessThan(settle({ brake: true }).sink);
  });

  it('brings the speed down to a landable one, but not the sink', () => {
    // Held braked and nose-up, the bird settles well inside the speed a
    // landing allows and just outside the sink it allows. That is the airbrake
    // doing exactly what it is for and no more: it buys speed with height, so
    // a steady braked descent is a controlled drop, not an approach. Arresting
    // it is the reversed beat's job, which is the next group along.
    const { speed, sink } = settle({ brake: true, pitch: 0.4 });
    expect(speed).toBeLessThan(defaultParams.landingSpeed * 0.7);
    expect(sink).toBeGreaterThan(defaultParams.landingSink);
  });

  it('holds a far higher angle of attack before stalling', () => {
    // Fly at a fixed angle of attack chosen to sit between the clean stall
    // angle and the braked one, so only the alula bonus decides the verdict.
    const alpha = defaultParams.stallAngle + defaultParams.brakeStallBonus / 2;
    const speed = 14;
    const at = (brake: boolean) => {
      const bird = createBird(vec(0, 5000, 0), speed);
      bird.velocity = vec(0, -Math.sin(alpha) * speed, -Math.cos(alpha) * speed);
      const controls = { ...neutralControls(), brake };
      const telemetry = step(bird, controls, defaultParams, DT);
      return telemetry;
    };

    // Telemetry reports the flow at the midpoint of the tick, not at its
    // start, so this lands near the commanded angle rather than exactly on it.
    expect(at(false).angleOfAttack).toBeCloseTo(alpha, 2);
    expect(at(false).stalled).toBe(true);
    expect(at(true).stalled).toBe(false);
    // And the extra margin buys real lift, not just a relabelled verdict.
    expect(at(true).liftCoefficient).toBeGreaterThan(at(false).liftCoefficient);
  });

  it('overrides tucking, since a player holding both wants to slow down', () => {
    const both = settle({ brake: true, tuck: true });
    const braked = settle({ brake: true });
    expect(both.speed).toBeCloseTo(braked.speed, 5);
  });

  it('reverses the direction the wingbeat pushes', () => {
    // Same bird, same beat, opposite configuration: one gains ground speed
    // over a short burst, the other loses it.
    const forward = createBird(vec(0, 5000, 0), 12);
    fly(1.5, { flap: true }, {}, forward);
    const backward = createBird(vec(0, 5000, 0), 12);
    fly(1.5, { brake: true, flap: true }, {}, backward);

    expect(-forward.velocity.z).toBeGreaterThan(-backward.velocity.z);
  });

  /** Fly an approach, optionally braking and beating below 20 m. */
  function approach(
    options: { brake?: boolean; beat?: boolean; flareAt?: number; pitch?: number } = {},
  ) {
    // Six metres, not four: a bird arriving at 14 m/s rather than 11 needs
    // longer to bleed it off, so every flare in the model starts higher now.
    const { brake = false, beat = false, flareAt = 6, pitch = 0.6 } = options;
    const bird = createBird(vec(0, 80, 0), 15.3);
    const controls = { ...neutralControls() };
    for (let t = 0; t < 90; t += DT) {
      const alt = bird.position.y;
      controls.brake = brake && alt < 20;
      controls.flap = beat && alt < 20;
      controls.pitch = alt < flareAt ? pitch : 0;
      step(bird, controls, defaultParams, DT);
      if (bird.ending) break;
    }
    return bird.ending!;
  }

  it('arrives much slower, and steeper for it', () => {
    // The airbrake buys speed with height. It is not a way to float down: with
    // the wing giving up its lift, spreading it means dropping.
    expect(approach({ brake: true }).speed).toBeLessThan(approach({}).speed);
    expect(approach({ brake: true }).sink).toBeGreaterThan(approach({}).sink);
  });

  it('needs the reversed beat to arrest the descent it causes', () => {
    // Spreading alone drops you; back-pedalling is what turns that into a
    // landing. This is why a pigeon beats all the way onto the ledge.
    expect(approach({ brake: true }).cause).toBe('hard-impact');
    expect(approach({ brake: true, beat: true }).kind).toBe('landed');
  });

  it('leaves unbraked flight exactly as it was', () => {
    const withParams = createBird(vec(0, 400, 0), 15);
    fly(10, {}, {}, withParams);
    const zeroed = createBird(vec(0, 400, 0), 15);
    fly(10, {}, { brakeDrag: 99, brakeAreaFactor: 99 }, zeroed);

    expect(withParams.position).toEqual(zeroed.position);
  });
});

describe('vertical authority', () => {
  /** Climb rate after holding a wingbeat from a given starting airspeed. */
  function climbFrom(speed: number, controls: Partial<Controls> = {}, seconds = 2.5) {
    const bird = createBird(vec(0, 3000, 0), speed);
    const { telemetry } = fly(seconds, { flap: true, ...controls }, {}, bird);
    return telemetry.climbRate;
  }

  /** Climb rate while flapping from `speed`, with the boost set to `boost`. */
  function climbWithBoost(speed: number, flapSlowBoost: number) {
    const bird = createBird(vec(0, 3000, 0), speed);
    const { telemetry } = fly(2.5, { flap: true }, { flapSlowBoost }, bird);
    return telemetry.climbRate;
  }

  it('turns a sinking slow bird into a climbing one', () => {
    // Below the 8.6 m/s stall speed the wing has little left to give, so the
    // beat itself has to do the work. Without the boost a bird at 6 m/s cannot
    // climb at all, which is what made flapping feel useless near the ground.
    expect(climbWithBoost(6, 1)).toBeLessThan(0);
    expect(climbWithBoost(6, defaultParams.flapSlowBoost)).toBeGreaterThan(0);
  });

  it('fades to nothing by cruise, so it is not a general buff', () => {
    const cruise = 15;
    expect(
      Math.abs(
        climbWithBoost(cruise, defaultParams.flapSlowBoost) - climbWithBoost(cruise, 1),
      ),
    ).toBeLessThan(0.1);
  });

  it('aims the stroke upward when slow and forward at cruise', () => {
    // Slow: the beat should buy altitude rather than ground speed.
    const slow = createBird(vec(0, 3000, 0), 4);
    fly(1.5, { flap: true }, {}, slow);
    expect(slow.velocity.y).toBeGreaterThan(0);

    // Cruise: the beat should buy ground speed. Compared against the same
    // bird coasting, because at cruise it is above its gliding trim speed and
    // slowing down either way.
    const flapped = createBird(vec(0, 3000, 0), 15);
    fly(1.5, { flap: true }, {}, flapped);
    const coasted = createBird(vec(0, 3000, 0), 15);
    fly(1.5, {}, {}, coasted);

    expect(-flapped.velocity.z).toBeGreaterThan(-coasted.velocity.z);
  });

  it('pulls a slow bird out of a sink instead of mushing into the ground', () => {
    const bird = createBird(vec(0, 40, 0), 6);
    bird.velocity = vec(0, -4, -6);
    const start = bird.position.y;
    fly(3, { flap: true, pitch: 0.5 }, {}, bird);

    expect(bird.position.y).toBeGreaterThan(start);
  });

  it('pushes out of the bird\'s back, whatever the bird is doing', () => {
    // The stroke plane is bolted to the shoulders. A bird aims its thrust by
    // pointing its body, so a nose-down bird beats itself sideways rather than
    // upwards, and has to pull the nose up before the beat can save it.
    const beatDirection = (pitch: number) => {
      const orientation = quatFromAxisAngle(vec(1, 0, 0), pitch);
      const bird = createBird(vec(0, 3000, 0), 6);
      bird.orientation = orientation;
      bird.velocity = rotate(orientation, vec(0, 0, -6));
      bird.flapPhase = 0.25;

      const before = { ...bird.velocity };
      step(bird, { ...neutralControls(), flap: true }, defaultParams, DT);
      const withBeat = sub(bird.velocity, before);

      const coasting = createBird(vec(0, 3000, 0), 6);
      coasting.orientation = orientation;
      coasting.velocity = rotate(orientation, vec(0, 0, -6));
      coasting.flapPhase = 0.25;
      const coastBefore = { ...coasting.velocity };
      step(coasting, neutralControls(), defaultParams, DT);

      return normalize(sub(withBeat, sub(coasting.velocity, coastBefore)));
    };

    // Whatever the attitude, the beat keeps a fixed angle to the bird's back.
    const angleToBack = (pitch: number) => {
      const back = rotate(quatFromAxisAngle(vec(1, 0, 0), pitch), vec(0, 1, 0));
      return Math.acos(clamp(dot(beatDirection(pitch), back), -1, 1));
    };

    expect(angleToBack(0)).toBeCloseTo(angleToBack(-1.05), 2);
    expect(angleToBack(0)).toBeCloseTo(angleToBack(1.05), 2);

    // A bird pointed straight down gets no upward help at all: its back faces
    // sideways, and the stroke's forward tilt puts the rest into the dive.
    expect(beatDirection(-Math.PI / 2).y).toBeLessThan(0);

    // Knife-edge is the cleanest case -- the beat is purely horizontal.
    const banked = quatFromAxisAngle(vec(0, 0, -1), Math.PI / 2);
    const bird = createBird(vec(0, 3000, 0), 6);
    bird.orientation = banked;
    bird.velocity = rotate(banked, vec(0, 0, -6));
    bird.flapPhase = 0.25;
    const before = { ...bird.velocity };
    step(bird, { ...neutralControls(), flap: true }, defaultParams, DT);
    const coast = createBird(vec(0, 3000, 0), 6);
    coast.orientation = banked;
    coast.velocity = rotate(banked, vec(0, 0, -6));
    coast.flapPhase = 0.25;
    const coastBefore = { ...coast.velocity };
    step(coast, neutralControls(), defaultParams, DT);
    const beat = sub(sub(bird.velocity, before), sub(coast.velocity, coastBefore));
    expect(Math.abs(beat.y)).toBeLessThan(length(beat) * 0.02);
  });

  it('cannot simply flap away a committed dive', () => {
    // The low-speed boost must not become a universal airbrake.
    const bird = createBird(vec(0, 3000, 0), 5);
    bird.velocity = vec(0, -45, -3);
    const { telemetry } = fly(1, { flap: true }, {}, bird);
    expect(telemetry.climbRate).toBeLessThan(-8);
  });

  it('leaves cruising flight where it was', () => {
    // The boost falls off with the square of airspeed, so it is a low-speed
    // fix and not a general buff to flapping.
    const boosted = climbFrom(15);
    const bird = createBird(vec(0, 3000, 0), 15);
    const { telemetry } = fly(2.5, { flap: true }, { flapSlowBoost: 1 }, bird);
    expect(Math.abs(boosted - telemetry.climbRate)).toBeLessThan(0.5);
  });
});

describe('coasting', () => {
  /** Airspeed and sink after coasting long enough to settle. */
  function coast(entrySpeed: number, seconds = 25) {
    const bird = createBird(vec(0, 20000, 0), entrySpeed);
    const { telemetry } = fly(seconds, {}, {}, bird);
    return { speed: telemetry.airspeed, sink: -telemetry.climbRate };
  }

  /**
   * Level powered cruise. Needs an altitude hold, because a bird left to flap
   * freely zoom-climbs and *slows down* -- and stamina has to be pinned, since
   * thrust scales with it and would otherwise measure a tiring bird.
   */
  function poweredLevel() {
    const bird = createBird(vec(0, 20000, 0), 15);
    const target = bird.position.y;
    const controls = { ...neutralControls(), flap: true };
    let telemetry;
    for (let t = 0; t < 25; t += DT) {
      bird.stamina = 1;
      controls.pitch = clamp(
        (target - bird.position.y) * 0.06 - bird.velocity.y * 0.25,
        -1,
        1,
      );
      telemetry = step(bird, controls, defaultParams, DT);
    }
    return telemetry!.airspeed;
  }

  it('settles well below the speed flapping can hold in level flight', () => {
    // Stop beating and the bird slows noticeably, rather than coasting on at
    // cruise speed. This is what trimming nose-up buys.
    expect(coast(15).speed).toBeLessThan(poweredLevel() - 3);
  });

  it('bleeds a fast entry back down within a couple of seconds', () => {
    const settled = coast(15).speed;
    const bird = createBird(vec(0, 20000, 0), 25);
    const controls = neutralControls();

    let elapsed = Infinity;
    for (let t = 0; t < 20; t += DT) {
      if (step(bird, controls, defaultParams, DT).airspeed <= settled + 1) {
        elapsed = t;
        break;
      }
    }
    expect(elapsed).toBeLessThan(3);
  });

  it('reaches the same trim whether it enters fast or slow', () => {
    // Given long enough: shedding a 25 m/s entry takes a while now there is
    // less drag to do it with, so 25 seconds is no longer enough to have met.
    expect(coast(25, 60).speed).toBeCloseTo(coast(11, 60).speed, 0);
  });

  it('gives up height at a rate you can feel', () => {
    const { sink } = coast(15);
    expect(sink).toBeGreaterThan(2);
    expect(sink).toBeLessThan(4);
  });

  it('is faster and flatter than flying with a draggy body would be', () => {
    // Stated the other way round from before, because the comparison it used
    // to make has gone: the body it called sleek is now roughly the body the
    // bird has. Against the drag it used to carry, this is the difference.
    const draggy = createBird(vec(0, 20000, 0), 15);
    const { telemetry } = fly(25, {}, { dragBase: 0.12, trimAngle: 0.17 }, draggy);

    const settled = coast(15);
    expect(settled.speed).toBeGreaterThan(telemetry.airspeed + 2);
    expect(settled.sink).toBeLessThan(-telemetry.climbRate);
  });
});

describe('wing physics', () => {
  /** Hold a bank angle and report how fast the bird falls out of the sky. */
  function sinkAtBank(degrees: number) {
    const bird = createBird(vec(0, 5000, 0), 15);
    bird.orientation = quatFromAxisAngle(vec(0, 0, -1), (degrees * Math.PI) / 180);
    const { telemetry } = fly(3, {}, {}, bird);
    return -telemetry.climbRate;
  }

  it('loses its hold on the sky as the wings go vertical', () => {
    // Lift acts perpendicular to the wing, so banking rotates it away from
    // vertical. At ninety degrees none of it opposes gravity any more.
    const sinks = [0, 30, 45, 60, 75, 90].map(sinkAtBank);
    for (let i = 1; i < sinks.length; i++) {
      expect(sinks[i]!, `bank step ${i}`).toBeGreaterThan(sinks[i - 1]!);
    }
    expect(sinkAtBank(0)).toBeLessThan(2);
    expect(sinkAtBank(90)).toBeGreaterThan(10);
  });

  it('still turns hardest where it holds height worst', () => {
    // The lift did not vanish when banked, it went sideways -- which is what
    // makes the turn. Falling and turning are two views of the same vector.
    const bird = createBird(vec(0, 5000, 0), 15);
    bird.orientation = quatFromAxisAngle(vec(0, 0, -1), Math.PI / 2);
    fly(3, {}, {}, bird);

    const forward = rotate(bird.orientation, vec(0, 0, -1));
    expect(Math.abs(forward.x)).toBeGreaterThan(0.3);
  });

  it('stalls rather than climbing when pitched steeply nose-up', () => {
    const bird = createBird(vec(0, 5000, 0), 15);
    bird.orientation = quatFromAxisAngle(vec(1, 0, 0), 1);
    const { telemetry } = fly(2, {}, {}, bird);
    expect(telemetry.stalled).toBe(true);
    expect(telemetry.climbRate).toBeLessThan(0);
  });

  it('applies gravity at every instant, with nothing else acting', () => {
    // From rest there is no airflow at all, so one tick must be exactly g dt.
    const still = createBird(vec(0, 5000, 0), 0);
    still.velocity = vec(0, 0, 0);
    step(still, neutralControls(), defaultParams, DT);
    expect(still.velocity.y).toBeCloseTo(-defaultParams.gravity * DT, 12);

    // And with the air removed, free fall is exact over any span.
    const vacuum = createBird(vec(0, 5000, 0), 0);
    vacuum.velocity = vec(0, 0, 0);
    const ticks = 240;
    const vacuumParams = { ...defaultParams, airDensity: 0 };
    for (let i = 0; i < ticks; i++) step(vacuum, neutralControls(), vacuumParams, DT);
    expect(vacuum.velocity.y).toBeCloseTo(-defaultParams.gravity * ticks * DT, 9);
  });

  it('falls slower than free fall in real air, because a bird is a parachute', () => {
    const bird = createBird(vec(0, 5000, 0), 0);
    bird.velocity = vec(0, 0, 0);
    const { telemetry } = fly(1, {}, {}, bird);
    // Belly-first at a huge angle of attack is mostly drag. Stated as a
    // multiple of the drag at no angle at all, so it says the thing it means
    // -- separation dominates -- rather than a number that has to be re-fitted
    // every time the body is retuned.
    expect(telemetry.climbRate).toBeGreaterThan(-defaultParams.gravity);
    expect(telemetry.dragCoefficient).toBeGreaterThan(defaultParams.dragBase * 5);
  });
});

describe('wingbeat rate', () => {
  /**
   * Vertical speed the beat alone buys, with every speed-dependent term
   * disabled so only the rate law is left.
   */
  function beatImpulse(flapFrequency: number, seconds = 0.5) {
    const params = {
      airDensity: 0,
      flapSlowBoost: 1,
      flapStrokeSpeed: 1e9,
      flapFrequency,
    };
    const bird = createBird(vec(0, 20000, 0), 0);
    bird.velocity = vec(0, 0, 0);
    fly(seconds, { flap: true }, params, bird);
    // Back gravity out to leave just what the wings did.
    return bird.velocity.y + defaultParams.gravity * seconds;
  }

  it('scales thrust with the square of the beat rate', () => {
    // A wing's force goes with the square of how fast it sweeps the air, and
    // that speed is set by the beat rate. Without this, beating harder did
    // nothing: the time-average of max(0, sin) is 1/pi at any frequency.
    expect(beatImpulse(4) / beatImpulse(2)).toBeCloseTo(4, 0);
    expect(beatImpulse(8) / beatImpulse(4)).toBeCloseTo(4, 0);
  });

  it('leaves the default rate exactly where it was', () => {
    // flapReferenceRate is the rate at which flapThrust is the peak force, so
    // the shipped default must be a no-op.
    expect(defaultParams.flapFrequency).toBe(defaultParams.flapReferenceRate);
  });

  /** Height gained flapping up from a standstill, as a pigeon taking off. */
  function takeoff(flapFrequency: number) {
    const bird = createBird(vec(0, 2000, 0), 0);
    bird.velocity = vec(0, 0, 0);
    const start = bird.position.y;
    fly(2, { flap: true, pitch: 0.6 }, { flapFrequency }, bird);
    return bird.position.y - start;
  }

  it('beats gravity somewhere between two and three beats a second', () => {
    // Which is about what a pigeon looks like leaving the ground.
    expect(takeoff(1)).toBeLessThan(0);
    expect(takeoff(2)).toBeLessThan(0);
    expect(takeoff(3)).toBeGreaterThan(0);
    expect(takeoff(5.5)).toBeGreaterThan(takeoff(3));
  });
});

describe('braking wings', () => {
  /** Lift coefficient and the area it acts over, relative to a spread wing. */
  function effectiveLift(controls: Partial<Controls>) {
    const bird = createBird(vec(0, 5000, 0), 12);
    const telemetry = step(bird, { ...neutralControls(), ...controls }, defaultParams, DT);
    const areaFactor = controls.brake ? defaultParams.brakeAreaFactor : 1;
    return telemetry.liftCoefficient * areaFactor;
  }

  it('makes less lift than a spread wing, despite covering more area', () => {
    // Cupped and held broadside, the wing is an airbrake rather than a wing:
    // the extra area all goes into drag.
    expect(effectiveLift({ brake: true })).toBeLessThan(effectiveLift({}));
  });

  it('gives up height faster than a coast', () => {
    const braked = fly(20, { brake: true }, {}, createBird(vec(0, 20000, 0), 15));
    const coasting = fly(20, {}, {}, createBird(vec(0, 20000, 0), 15));
    expect(-braked.telemetry.climbRate).toBeGreaterThan(-coasting.telemetry.climbRate);
  });

  it('holds the speed down instead of handing it back', () => {
    // The bug this replaced: braking dipped a couple of m/s and then climbed
    // straight back to gliding speed, because a mere multiple of a streamlined
    // drag coefficient could not out-pull gravity on a steepening path.
    const braked = createBird(vec(0, 20000, 0), 16);
    const coasting = createBird(vec(0, 20000, 0), 16);
    // Settle both into a real glide first, the way a player arrives.
    fly(10, {}, {}, braked);
    fly(10, {}, {}, coasting);

    const held = fly(8, { brake: true }, {}, braked);
    const free = fly(8, {}, {}, coasting);

    expect(held.telemetry.airspeed).toBeLessThan(free.telemetry.airspeed * 0.75);
  });

  it('costs far more height than coasting does', () => {
    const braked = createBird(vec(0, 20000, 0), 16);
    const coasting = createBird(vec(0, 20000, 0), 16);
    fly(10, {}, {}, braked);
    fly(10, {}, {}, coasting);

    const before = { braked: braked.position.y, coasting: coasting.position.y };
    fly(8, { brake: true }, {}, braked);
    fly(8, {}, {}, coasting);

    expect(before.braked - braked.position.y).toBeGreaterThan(
      (before.coasting - coasting.position.y) * 1.5,
    );
  });

  it('still sheds speed over the seconds an approach actually uses it', () => {
    // Held for half a minute the bird settles into a steep dive and the speed
    // comes back; over the two or three seconds of a real approach it does not.
    const braked = fly(2, { brake: true }, {}, createBird(vec(0, 20000, 0), 15.3));
    const coasting = fly(2, {}, {}, createBird(vec(0, 20000, 0), 15.3));
    expect(braked.telemetry.airspeed).toBeLessThan(coasting.telemetry.airspeed - 1);
  });
});

describe('perching', () => {
  /** Fly an approach that ends however `flareAt` and `pitch` dictate. */
  function land(flareAt: number, pitch: number) {
    const bird = createBird(vec(0, 80, 0), 15.3);
    const controls = { ...neutralControls() };
    for (let t = 0; t < 90; t += DT) {
      const alt = bird.position.y;
      controls.brake = alt < 20;
      controls.flap = alt < 20;
      controls.pitch = alt < flareAt ? pitch : 0;
      step(bird, controls, defaultParams, DT);
      if (bird.ending) break;
    }
    return bird;
  }

  it('treats a clean landing as perched, not as an ending', () => {
    const bird = land(6, 0.6);
    expect(bird.ending!.kind).toBe('landed');
    expect(isPerched(bird)).toBe(true);
    expect(hasCrashed(bird)).toBe(false);
  });

  it('treats a crash as the end of the run', () => {
    const bird = createBird(vec(0, 60, 0), 5);
    bird.orientation = quatFromAxisAngle(vec(1, 0, 0), -1.2);
    fly(20, { tuck: true }, {}, bird);

    expect(hasCrashed(bird)).toBe(true);
    expect(isPerched(bird)).toBe(false);
  });

  it('settles a landed bird onto its feet, keeping where it was pointing', () => {
    const bird = land(6, 0.6);
    const before = heading(bird);

    // Wings level and nose level: a standing bird, not a frozen flare.
    expect(bankAngle(bird)).toBeCloseTo(0, 6);
    const forward = rotate(bird.orientation, vec(0, 0, -1));
    expect(forward.y).toBeCloseTo(0, 6);
    // And still facing the way it landed.
    expect(heading(bird)).toBeCloseTo(before, 6);
  });

  it('leaves a crashed bird in the attitude it hit at', () => {
    const bird = createBird(vec(0, 60, 0), 5);
    const attitude = quatFromAxisAngle(vec(1, 0, 0), -1.2);
    bird.orientation = attitude;
    fly(20, { tuck: true }, {}, bird);

    expect(hasCrashed(bird)).toBe(true);
    const forward = rotate(bird.orientation, vec(0, 0, -1));
    expect(forward.y).toBeLessThan(-0.2);
  });

  it('stays put once perched', () => {
    const bird = land(6, 0.6);
    const resting = { ...bird.position };
    fly(5, { flap: true, pitch: 1 }, {}, bird);
    expect(bird.position).toEqual(resting);
  });
});

describe('rooftops', () => {
  /** A 20 m block with a roof wide enough to aim at. */
  const block = () => createColliderField([turnedBox(0, 0, 60, 20, 60, 0)]);

  /** Fly in from `startY` and flare below 24 m, which is just over the roof. */
  function approachRoof(startY: number, speed: number, pitch: number) {
    const bird = createBird(vec(0, startY, 40), speed);
    const controls = { ...neutralControls() };
    const collider = block();
    for (let t = 0; t < 60; t += DT) {
      controls.pitch = bird.position.y < 24 ? pitch : 0;
      step(bird, controls, defaultParams, DT, collider);
      if (bird.ending) break;
    }
    return bird;
  }

  it('lets a gentle arrival land on a roof', () => {
    // Gentler than it used to need. The bird carries more speed and glides
    // further for it, so the same entry now sails over the far parapet and
    // puts down on the street beyond.
    const bird = approachRoof(26, 9, 0.6);
    expect(bird.ending!.kind).toBe('landed');
    expect(isPerched(bird)).toBe(true);
    // Standing on the roof, not on the ground twenty metres below it.
    expect(bird.position.y).toBeGreaterThan(19);
  });

  it('settles a roof landing onto its feet like any other', () => {
    const bird = approachRoof(26, 9, 0.6);
    // Checked to be a landing first: a crash settles the bird upright too, so
    // without this the rest of it passes whatever happened.
    expect(bird.ending!.kind).toBe('landed');
    expect(bankAngle(bird)).toBeCloseTo(0, 6);
    expect(rotate(bird.orientation, vec(0, 0, -1)).y).toBeCloseTo(0, 6);
  });

  it('judges a roof by the same rules as the ground', () => {
    // Dropped onto it from just above, with no room to turn the fall into
    // flight before it arrives.
    const bird = createBird(vec(0, 26, 0), 1);
    bird.velocity = vec(0, -15, 0);
    const collider = block();
    const controls = neutralControls();
    for (let t = 0; t < 20; t += DT) {
      step(bird, controls, defaultParams, DT, collider);
      if (bird.ending) break;
    }
    expect(bird.ending!.kind).toBe('crashed');
    expect(bird.ending!.cause).toBe('hard-impact');
    expect(bird.position.y).toBeGreaterThan(19);
  });

  /** Level flight into the side of the block, close enough to get there. */
  function flyIntoTheWall() {
    const bird = createBird(vec(0, 10, 60), 16);
    const collider = block();
    const controls = neutralControls();
    for (let t = 0; t < 60; t += DT) {
      step(bird, controls, defaultParams, DT, collider);
      if (bird.ending) break;
    }
    return bird;
  }

  it('still treats a wall as a wall', () => {
    expect(flyIntoTheWall().ending!.cause).toBe('building');
  });

  it('reports how fast it was going when it hit the wall', () => {
    // The arrival has to be read before the velocity is spent on it, or every
    // crash is reported as having happened at a standstill.
    expect(flyIntoTheWall().ending!.speed).toBeGreaterThan(defaultParams.crashSpeed);
  });
});

describe('what the flying is paid for with', () => {
  const TICK = 1 / 120;

  /** Fly level -- beat when sinking, glide when climbing -- for this far. */
  const errand = (metres: number, belly = 1) => {
    const bird = createBird(vec(0, 40, 0), 16, 0);
    bird.health = belly;
    let flown = 0;
    for (let t = 0; t < 120 * 60 * 30 && flown < metres; t += 1) {
      const was = { ...bird.position };
      const flap = bird.velocity.y <= 0 && bird.stamina > 0.05;
      step(bird, { ...neutralControls(), flap }, defaultParams, TICK);
      flown += Math.hypot(bird.position.x - was.x, bird.position.z - was.z);
      if (bird.ending) break;
    }
    return { bird, flown };
  };

  it('empties a full belly over about three kilometres', () => {
    // The figure the whole thing is calibrated to, and it is a measurement
    // rather than a setting: `bellyPerStamina` was chosen by flying this and
    // dividing. If the wing is retuned, this is the test that says the belly
    // no longer means what it says.
    const { bird, flown } = errand(3000);
    expect(flown).toBeGreaterThan(2900);
    expect(bird.health).toBeLessThan(0.12);
    expect(bird.health).toBeGreaterThanOrEqual(0);
  });

  it('costs nothing to sit still with the wings already rested', () => {
    // Recovery is measured from what actually goes back into the wings, not
    // from what was offered. A bird on a branch at full stamina is not
    // digesting anything.
    const bird = createBird(vec(0, 40, 0), 16, 0);
    for (let t = 0; t < 600; t += 1) {
      step(bird, neutralControls(), defaultParams, TICK);
      bird.stamina = 1;
    }
    expect(bird.health).toBe(1);
  });

  it('stops giving the wings back once the belly is empty', () => {
    // Starving is not death: what is left in the wings is still there to be
    // spent. What is gone is the getting of any more.
    const bird = createBird(vec(0, 40, 0), 16, 0);
    bird.health = 0;
    bird.stamina = 0.4;
    for (let t = 0; t < 600; t += 1) step(bird, neutralControls(), defaultParams, TICK);
    expect(bird.stamina).toBeCloseTo(0.4, 6);
    expect(bird.health).toBe(0);
  });

  it('gets less far on a fifth of a belly, which is where the story starts', () => {
    // Two of them are hungry on a branch and the food is nine hundred metres
    // away. That is the level, and this is the arithmetic under it.
    const { bird } = errand(600, 0.2);
    expect(bird.health).toBeLessThan(0.05);
  });
});
