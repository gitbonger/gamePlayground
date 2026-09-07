import { describe, expect, it } from 'vitest';
import { DEFAULT_MODE, MODES, modeNamed, otherMode, paramsFor, windFor } from './modes';
import {
  bankAngle,
  createBird,
  defaultParams,
  landingReadiness,
  neutralControls,
  step,
  type BirdState,
} from './flight';
import { calm, createWind, defaultWindParams } from './wind';
import { vec } from './math3';

const TICK = 1 / 120;
const gale = createWind({ ...defaultWindParams });

/** A bird at cruise, a hundred metres up. */
const cruising = (): BirdState => createBird(vec(0, 100, 0), 14, 0);

/**
 * Roll into a bank, hold it, and say what the turn cost in height.
 *
 * Rolled in and then *centred*, which matters: holding the stick over for
 * three seconds is not a turn, it is a barrel roll -- the first version of
 * this measured a bird going right over on its back and reported the dive
 * afterwards as the cost of turning.
 *
 * The same inputs to both modes, so the only thing that differs between two
 * runs of it is the mode.
 */
function turnFor(mode: keyof typeof MODES, seconds: number, wind = calm) {
  const p = paramsFor(MODES[mode]);
  const bird = cruising();
  const rolling = { ...neutralControls(), roll: 1, flap: true };
  for (let t = 0; t < 600 && Math.abs(bankAngle(bird)) < 0.6; t += 1) {
    step(bird, rolling, p, TICK, undefined, wind);
  }

  const holding = { ...neutralControls(), flap: true };
  const was = bird.position.y;
  const heading = Math.atan2(bird.velocity.x, -bird.velocity.z);
  for (let t = 0; t < seconds / TICK; t += 1) step(bird, holding, p, TICK, undefined, wind);
  return {
    lost: was - bird.position.y,
    bank: Math.abs(bankAngle(bird)),
    turned: Math.abs(Math.atan2(bird.velocity.x, -bird.velocity.z) - heading),
    bird,
  };
}

describe('the two ways of flying it', () => {
  it('changes numbers rather than the model', () => {
    // The point of the whole arrangement: a mode is what the one flight model
    // is *given*, so realistic asks for nothing at all and gets the model as
    // written. A mode that had to change the physics would be a second
    // physics, and the second one is the one nobody tests.
    expect(paramsFor(MODES.realistic)).toEqual(defaultParams);
  });

  it('gives back what a bank tilts out of the vertical, and only that', () => {
    // The lift of a banked wing leans over with the wing, so the part still
    // pointing up is `cos` of the bank, and the turn costs height. Basic
    // works the wing `1/cos` harder to make that back.
    //
    // Worth about a tenth of the height over three seconds at forty-eight
    // degrees, and it is worth writing down why it is not more: most of what
    // a hands-off bank costs is the nose dropping, not the lift tilting.
    // Sweeping the recovery from 0 to 3 moves the loss from 21.4 m to 18.1 --
    // it saturates, because by then the bird is descending at eleven metres a
    // second and its lift is pointed along the dive rather than at the sky.
    // Holding the nose up in a turn would be a different lever, and a bigger
    // one; this one is exactly "the wings do not make less lift".
    const easy = turnFor('basic', 3);
    const real = turnFor('realistic', 3);

    // Both genuinely turning: this is not a mode that refuses to bank.
    expect(easy.bank).toBeGreaterThan(0.5);
    expect(real.bank).toBeGreaterThan(0.5);
    expect(easy.turned).toBeGreaterThan(0.5);

    // And the honest one is the one that sinks further.
    expect(real.lost).toBeGreaterThan(easy.lost * 1.05);
  });

  it('leaves the wing able to stall in either of them', () => {
    // Basic gives back what the bank tilts away, and nothing else. A bird
    // hauled up until the wing lets go still loses it, because that is the
    // model rather than a consequence of turning.
    const p = paramsFor(MODES.basic);
    const bird = createBird(vec(0, 100, 0), 6, 0);
    const controls = { ...neutralControls(), pitch: 1 };
    let stalled = false;
    for (let t = 0; t < 240; t += 1) {
      stalled ||= step(bird, controls, p, TICK).stalled;
    }
    expect(stalled).toBe(true);
  });

  it('flies basic in still air and realistic in whatever there is', () => {
    expect(windFor(MODES.basic, gale)).toBe(calm);
    expect(windFor(MODES.realistic, gale)).toBe(gale);
  });

  it('reads the air it is actually in, so the panel cannot lie', () => {
    // The readout comes off the field the bird was stepped with. Told there
    // is no wind, the corner says calm -- rather than showing a headwind the
    // player is not being pushed by.
    const bird = cruising();
    const still = step(bird, neutralControls(), paramsFor(MODES.basic), TICK, undefined, calm);
    expect(still.wind).toEqual(vec(0, 0, 0));
    expect(Math.abs(still.headwind)).toBe(0);
  });

  it('survives an arrival in basic that is a crash in realistic', () => {
    // "Much higher impact speed", which is two numbers rather than one: the
    // sink and the speed are the same mistake measured on two axes.
    const coming = createBird(vec(0, 0.22, 0), 0, 0);
    coming.velocity = vec(0, -7, 18);

    expect(landingReadiness(coming, paramsFor(MODES.realistic)).ready).toBe(false);
    expect(landingReadiness(coming, paramsFor(MODES.basic)).ready).toBe(true);
  });

  it('still breaks a bird that arrives badly enough in basic', () => {
    // Forgiving is not weightless. There is a speed at which the ground wins
    // in either mode, or the landing rule is not a rule.
    const dropped = createBird(vec(0, 0.22, 0), 0, 0);
    dropped.velocity = vec(0, -30, 0);
    expect(landingReadiness(dropped, paramsFor(MODES.basic)).ready).toBe(false);
  });

  it('opens in the forgiving one', () => {
    expect(DEFAULT_MODE).toBe('basic');
    expect(modeNamed(DEFAULT_MODE)).toBe(MODES.basic);
  });

  it('has exactly two positions to switch between, for now', () => {
    // The switch in the menu is a toggle, so it needs the other one. A third
    // mode is a third entry here and a switch that is no longer a toggle --
    // which this is the reminder about.
    expect(Object.keys(MODES)).toHaveLength(2);
    expect(otherMode(MODES.basic)).toBe(MODES.realistic);
    expect(otherMode(MODES.realistic)).toBe(MODES.basic);
    expect(modeNamed('cinematic')).toBeUndefined();
  });
});
