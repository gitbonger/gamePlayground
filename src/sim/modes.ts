/**
 * How hard the game is being about physics.
 *
 * The flight model is one model: there is no second simulation here, and no
 * branch anywhere in `step` that asks which mode is running. A mode is a set
 * of *numbers* the one model is given, plus which air it is flown in, and
 * that is deliberate -- two code paths through a flight model is two flight
 * models, and the second one is always the one nobody tests.
 *
 * So everything a mode decides lives in this file, in `Mode`, and reaches the
 * simulation through `paramsFor` and `windFor`. Adding a third mode is
 * writing a third entry in `MODES`; it is not editing the physics.
 *
 * Where the line falls, and why:
 *
 *  - **Realistic** is the model as it was written. Air moves and the bird is
 *    in it. A banked wing tilts its lift out of the vertical, so a turn costs
 *    height unless it is paid for. An arrival is judged on what legs can
 *    actually absorb.
 *  - **Basic** is the same model with three of its consequences taken off the
 *    player. The air is still, a turn holds its height, and an arrival has to
 *    be a good deal worse before it counts as a crash. Nothing is faked and
 *    nothing is special-cased: the wing still stalls, the wind still exists
 *    for everything else, and the ground is still hard.
 */

import { calm, type WindField } from './wind';
import { defaultParams, type FlightParams } from './flight';

export type ModeName = 'basic' | 'realistic';

/** Every decision a mode makes, and there is nowhere else one may be made. */
export interface Mode {
  name: ModeName;
  /** What it is called on screen. */
  title: string;
  /** One line saying what it does, for the menu. */
  says: string;
  /**
   * Whether the air moves.
   *
   * False does not mean the wind is ignored -- it means the bird is flown in
   * still air, which is a thing the model already understands. The readouts
   * then say calm, because they are reading the air the bird is actually in.
   */
  windy: boolean;
  /**
   * How much of the lift a bank tilts away from the vertical is given back,
   * 0 to 1.
   *
   * A banked wing carves a turn precisely *because* its lift is no longer
   * straight up, so this cannot be "turning does not tilt the lift" without
   * also being "turning does not turn". What it gives back is the size: at 1
   * the wing works `1/cos` harder through the turn, so the upward part of the
   * lift is what it was flying level and the sideways part still does the
   * turning. The bird holds its height through a bank without being asked to
   * pay for it.
   */
  bankLiftRecovery: number;
  /**
   * How much harder an arrival may be than the realistic rule allows.
   *
   * One number for both the sink and the speed, because they are the same
   * mistake measured on two axes and a mode that forgave one but not the
   * other would be a mode that still killed you for arriving fast.
   */
  landingAllowance: number;
}

export const MODES: Record<ModeName, Mode> = {
  basic: {
    name: 'basic',
    title: 'Basic',
    says: 'still air, free turns, forgiving landings',
    windy: false,
    bankLiftRecovery: 1,
    // Ten metres a second of sink and twenty-five of speed, against four and
    // ten. A bird can arrive at a run rather than having to be placed.
    landingAllowance: 2.5,
  },
  realistic: {
    name: 'realistic',
    title: 'Realistic',
    says: 'wind, turns that cost height, landings that have to be flown',
    windy: true,
    bankLiftRecovery: 0,
    landingAllowance: 1,
  },
};

/** The mode the game opens in, for anybody who has not said otherwise. */
export const DEFAULT_MODE: ModeName = 'basic';

export const modeNamed = (name: string): Mode | undefined =>
  name === 'basic' || name === 'realistic' ? MODES[name] : undefined;

/** The other one, for a switch that has two positions. */
export const otherMode = (mode: Mode): Mode =>
  mode.name === 'basic' ? MODES.realistic : MODES.basic;

/**
 * The flight parameters a mode flies with.
 *
 * The whole of what a mode does to the model, in one expression. Everything
 * it does not name is the model as written -- so a mode cannot quietly change
 * the mass of a pigeon, and reading this tells you exactly what "basic" costs
 * you in truthfulness.
 */
export function paramsFor(mode: Mode, base: FlightParams = defaultParams): FlightParams {
  return {
    ...base,
    bankLiftRecovery: mode.bankLiftRecovery,
    landingSink: base.landingSink * mode.landingAllowance,
    landingSpeed: base.landingSpeed * mode.landingAllowance,
  };
}

/** The air a mode is flown in: the real field, or none of it. */
export const windFor = (mode: Mode, field: WindField): WindField => (mode.windy ? field : calm);
