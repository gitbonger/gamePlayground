/** Flight instruments, drawn as plain DOM over the canvas. */

import type { BirdState, FlightTelemetry } from '../sim/flight';

export interface Hud {
  update(state: BirdState, telemetry: FlightTelemetry, fps: number): void;
  dispose(): void;
}

export function createHud(container: HTMLElement): Hud {
  const root = document.createElement('div');
  root.className = 'hud';
  root.innerHTML = `
    <div class="hud-readouts">
      <div class="readout"><span class="label">airspeed</span><span data-field="speed">0</span><span class="unit">km/h</span></div>
      <div class="readout"><span class="label">altitude</span><span data-field="altitude">0</span><span class="unit">m</span></div>
      <div class="readout"><span class="label">climb</span><span data-field="climb">0</span><span class="unit">m/s</span></div>
    </div>
    <div class="hud-stamina">
      <span class="label">stamina</span>
      <div class="bar"><div class="bar-fill" data-field="stamina"></div></div>
    </div>
    <div class="hud-warning" data-field="warning"></div>
    <div class="hud-fps"><span data-field="fps">0</span> fps</div>
  `;
  container.appendChild(root);

  const field = (name: string) => root.querySelector<HTMLElement>(`[data-field="${name}"]`)!;
  const speedEl = field('speed');
  const altitudeEl = field('altitude');
  const climbEl = field('climb');
  const staminaEl = field('stamina');
  const warningEl = field('warning');
  const fpsEl = field('fps');

  function update(state: BirdState, telemetry: FlightTelemetry, fps: number) {
    speedEl.textContent = (telemetry.airspeed * 3.6).toFixed(0);
    altitudeEl.textContent = telemetry.altitude.toFixed(0);
    climbEl.textContent = telemetry.climbRate.toFixed(1);
    climbEl.classList.toggle('positive', telemetry.climbRate > 0.2);

    staminaEl.style.width = `${state.stamina * 100}%`;
    staminaEl.classList.toggle('low', state.stamina < 0.25);

    const warning = telemetry.stalled
      ? 'STALL — push the nose down'
      : state.grounded
        ? 'on the ground — press R to launch'
        : '';
    if (warningEl.textContent !== warning) warningEl.textContent = warning;

    fpsEl.textContent = fps.toFixed(0);
  }

  return {
    update,
    dispose() {
      root.remove();
    },
  };
}
