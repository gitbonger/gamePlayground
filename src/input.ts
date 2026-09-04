/** Keyboard to control-axis mapping, with smoothing so taps are not binary. */

import { clamp, damp } from './sim/math3';
import type { Controls } from './sim/flight';

/** Half-life in seconds for an axis to reach its commanded value. */
const AXIS_HALF_LIFE = 0.06;

const BINDINGS = {
  pitchUp: ['KeyS', 'ArrowDown'],
  pitchDown: ['KeyW', 'ArrowUp'],
  rollLeft: ['KeyA', 'ArrowLeft'],
  rollRight: ['KeyD', 'ArrowRight'],
  yawLeft: ['KeyQ'],
  yawRight: ['KeyE'],
  flap: ['Space'],
  tuck: ['ShiftLeft', 'ShiftRight'],
} as const;

export interface InputSource {
  controls: Controls;
  /** Advance axis smoothing; call once per rendered frame. */
  update(dt: number): void;
  /** True on the frame a reset was requested. */
  consumeReset(): boolean;
  dispose(): void;
}

export function createInput(target: HTMLElement | Window = window): InputSource {
  const held = new Set<string>();
  let resetRequested = false;

  const controls: Controls = { pitch: 0, roll: 0, yaw: 0, flap: false, tuck: false };

  const anyHeld = (codes: readonly string[]) => codes.some((code) => held.has(code));
  const axis = (negative: readonly string[], positive: readonly string[]) =>
    (anyHeld(positive) ? 1 : 0) - (anyHeld(negative) ? 1 : 0);

  const onKeyDown = (event: Event) => {
    const e = event as KeyboardEvent;
    if (e.repeat) return;
    held.add(e.code);
    if (e.code === 'KeyR') resetRequested = true;
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
  }

  function consumeReset() {
    const requested = resetRequested;
    resetRequested = false;
    return requested;
  }

  return {
    controls,
    update,
    consumeReset,
    dispose() {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    },
  };
}
