/** Keyboard to control-axis mapping, with smoothing so taps are not binary. */

import { clamp, damp } from './sim/math3';
import type { Controls } from './sim/flight';
import type { WalkControls } from './sim/walk';

/** Half-life in seconds for an axis to reach its commanded value. */
const AXIS_HALF_LIFE = 0.06;

/**
 * Controls are plain keys only, never modifiers.
 *
 * Modifiers make poor controls: the operating system claims combinations
 * involving them, and while one is held the browser often stops delivering
 * key-up events at all, so a control bound to one can stick down with no way
 * to release it.
 */
const BINDINGS = {
  pitchUp: ['KeyS', 'ArrowDown'],
  pitchDown: ['KeyW', 'ArrowUp'],
  rollLeft: ['KeyA', 'ArrowLeft'],
  rollRight: ['KeyD', 'ArrowRight'],
  yawLeft: ['KeyQ'],
  yawRight: ['KeyE'],
  flap: ['Space'],
  tuck: ['KeyT'],
  brake: ['KeyB'],
} as const;

/**
 * The same keys again, meaning what they mean on foot.
 *
 * Deliberately the same physical keys: walking and flying are different modes
 * and only one of them is ever live, so there is nothing to collide. W is the
 * nose down in the air and forward on the ground, which is what both of those
 * keys already feel like they should do.
 */
const WALK_BINDINGS = {
  back: ['KeyS', 'ArrowDown'],
  forward: ['KeyW', 'ArrowUp'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
} as const;

/** Keys the operating system builds shortcuts out of, which we stay clear of. */
const SYSTEM_MODIFIERS = new Set([
  'MetaLeft',
  'MetaRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
]);

export interface InputSource {
  controls: Controls;
  /**
   * The same keyboard, read as walking.
   *
   * Not smoothed, unlike the flight axes: a pigeon on its feet has one speed
   * and reaches it at once, so an eased axis would be describing something
   * that does not happen.
   */
  walk: WalkControls;
  /** Advance axis smoothing; call once per rendered frame. */
  update(dt: number): void;
  /** True on the frame a reset was requested. */
  consumeReset(): boolean;
  /**
   * True once per press of the take-off key, not once per frame it is held.
   *
   * It has to be an edge. The key is the same one that beats the wings, and
   * the way to land is to brake and then beat down onto the surface -- so a
   * bird that took off whenever the key was down would leave again on the
   * tick it arrived, every time, and landing would be impossible.
   */
  consumeLaunch(): boolean;
  /** True on the press that opens or closes the level menu. */
  consumeMenu(): boolean;
  /**
   * A number key pressed since the last call, or null.
   *
   * Taken one at a time rather than as a set, because a digit is a choice and
   * two of them are two choices, not one.
   */
  consumeDigit(): number | null;
  dispose(): void;
}

export function createInput(target: HTMLElement | Window = window): InputSource {
  const held = new Set<string>();
  let resetRequested = false;

  const controls: Controls = {
    pitch: 0,
    roll: 0,
    yaw: 0,
    flap: false,
    tuck: false,
    brake: false,
  };

  // `launch` is not set here: it is an edge, and the caller takes it with
  // `consumeLaunch` so that a frame in which no simulation tick ran does not
  // swallow the press.
  const walk: WalkControls = { forward: 0, turn: 0, launch: false };
  let launchRequested = false;
  let menuRequested = false;
  const digits: number[] = [];

  const anyHeld = (codes: readonly string[]) => codes.some((code) => held.has(code));
  const axis = (negative: readonly string[], positive: readonly string[]) =>
    (anyHeld(positive) ? 1 : 0) - (anyHeld(negative) ? 1 : 0);

  const onKeyDown = (event: Event) => {
    const e = event as KeyboardEvent;
    if (e.repeat) return;

    // A modifier going down means the next keystroke belongs to the operating
    // system, not to us -- and the key-ups that follow may never arrive. Let
    // go of everything rather than risk a control stuck on.
    if (SYSTEM_MODIFIERS.has(e.code) || e.metaKey || e.ctrlKey || e.altKey) {
      held.clear();
      return;
    }

    held.add(e.code);
    if (e.code === 'KeyR') resetRequested = true;
    if (anyHeld(BINDINGS.flap)) launchRequested = true;
    if (e.code === 'KeyL') menuRequested = true;
    // Digit1..Digit9 on the top row, and the same on the numeric pad.
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (digit) digits.push(Number(digit[1]));
    // Space and the arrows scroll the page otherwise, which fights the controls.
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  };

  const onKeyUp = (event: Event) => held.delete((event as KeyboardEvent).code);
  // Alt-tabbing away while holding a key would otherwise leave it stuck down.
  const onBlur = () => held.clear();

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  function update(dt: number) {
    const pitchTarget = axis(BINDINGS.pitchDown, BINDINGS.pitchUp);
    const rollTarget = axis(BINDINGS.rollLeft, BINDINGS.rollRight);
    const yawTarget = axis(BINDINGS.yawLeft, BINDINGS.yawRight);

    controls.pitch = clamp(damp(controls.pitch, pitchTarget, AXIS_HALF_LIFE, dt), -1, 1);
    controls.roll = clamp(damp(controls.roll, rollTarget, AXIS_HALF_LIFE, dt), -1, 1);
    controls.yaw = clamp(damp(controls.yaw, yawTarget, AXIS_HALF_LIFE, dt), -1, 1);
    controls.flap = anyHeld(BINDINGS.flap);
    controls.tuck = anyHeld(BINDINGS.tuck);
    controls.brake = anyHeld(BINDINGS.brake);

    walk.forward = axis(WALK_BINDINGS.back, WALK_BINDINGS.forward);
    walk.turn = axis(WALK_BINDINGS.left, WALK_BINDINGS.right);
  }

  function consumeReset() {
    const requested = resetRequested;
    resetRequested = false;
    return requested;
  }

  function consumeLaunch() {
    const requested = launchRequested;
    launchRequested = false;
    return requested;
  }

  function consumeMenu() {
    const requested = menuRequested;
    menuRequested = false;
    return requested;
  }

  function consumeDigit() {
    return digits.shift() ?? null;
  }

  return {
    controls,
    walk,
    update,
    consumeReset,
    consumeLaunch,
    consumeMenu,
    consumeDigit,
    dispose() {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    },
  };
}
