/** Flight instruments, drawn as plain DOM over the canvas. */

import { isPerched, type BirdState, type FlightTelemetry, type LandingReadiness } from '../sim/flight';

export interface Hud {
  /** `landing` is null when the bird is too high for the approach cue to help. */
  update(
    state: BirdState,
    telemetry: FlightTelemetry,
    landing: LandingReadiness | null,
    fps: number,
  ): void;
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
      <div class="readout secondary" title="Height you could reach by trading all your speed for climb"><span class="label">energy</span><span data-field="energy">0</span><span class="unit">m</span></div>
      <div class="readout secondary" title="Local wind, and how much of it is against you"><span class="label">wind</span><span data-field="wind">0</span><span class="unit">m/s</span><span class="aside" data-field="headwind"></span></div>
    </div>
    <div class="hud-stamina">
      <span class="label">stamina</span>
      <div class="bar"><div class="bar-fill" data-field="stamina"></div></div>
    </div>
    <div class="hud-warning" data-field="warning"></div>
    <div class="hud-landing" data-field="landing" hidden>
      <div class="landing-title" data-field="landingTitle">approach</div>
      <div class="landing-checks">
        <span class="check" data-field="checkSink">sink</span>
        <span class="check" data-field="checkSpeed">speed</span>
        <span class="check" data-field="checkBank">wings</span>
      </div>
    </div>
    <div class="hud-fps"><span data-field="fps">0</span> fps</div>
  `;
  container.appendChild(root);

  const field = (name: string) => root.querySelector<HTMLElement>(`[data-field="${name}"]`)!;
  const speedEl = field('speed');
  const altitudeEl = field('altitude');
  const climbEl = field('climb');
  const energyEl = field('energy');
  const windEl = field('wind');
  const headwindEl = field('headwind');
  const staminaEl = field('stamina');
  const warningEl = field('warning');
  const fpsEl = field('fps');
  const landingEl = field('landing');
  const landingTitleEl = field('landingTitle');
  const checkSinkEl = field('checkSink');
  const checkSpeedEl = field('checkSpeed');
  const checkBankEl = field('checkBank');

  function update(
    state: BirdState,
    telemetry: FlightTelemetry,
    landing: LandingReadiness | null,
    fps: number,
  ) {
    speedEl.textContent = (telemetry.airspeed * 3.6).toFixed(0);
    altitudeEl.textContent = telemetry.altitude.toFixed(0);
    climbEl.textContent = telemetry.climbRate.toFixed(1);
    climbEl.classList.toggle('positive', telemetry.climbRate > 0.2);

    // Specific energy: altitude plus the height your airspeed is worth. It is
    // what actually says whether you can clear the roofline ahead.
    energyEl.textContent = telemetry.energy.height.toFixed(0);

    // Airspeed already reflects the wind; this says where it is coming from.
    const strength = Math.hypot(telemetry.wind.x, telemetry.wind.y, telemetry.wind.z);
    windEl.textContent = strength.toFixed(1);
    const head = telemetry.headwind;
    headwindEl.textContent =
      strength < 0.2 ? 'calm' : head > 0.3 ? 'head' : head < -0.3 ? 'tail' : 'cross';
    headwindEl.classList.toggle('adverse', head > 0.3);

    staminaEl.style.width = `${state.stamina * 100}%`;
    staminaEl.classList.toggle('low', state.stamina < 0.25);

    const warning = isPerched(state)
      ? 'perched — press R to fly again'
      : telemetry.stalled && !state.ending
        ? 'STALL — push the nose down'
        : '';
    if (warningEl.textContent !== warning) warningEl.textContent = warning;
    warningEl.classList.toggle('calm', isPerched(state));

    // Approach cue: only useful on the way down, and only while still flying.
    landingEl.hidden = landing === null;
    if (landing) {
      checkSinkEl.classList.toggle('ok', landing.sinkOk);
      checkSpeedEl.classList.toggle('ok', landing.speedOk);
      checkBankEl.classList.toggle('ok', landing.bankOk);
      landingEl.classList.toggle('ready', landing.ready);
      landingTitleEl.textContent = landing.ready ? 'ready to land' : 'approach';
    }

    fpsEl.textContent = fps.toFixed(0);
  }

  return {
    update,
    dispose() {
      root.remove();
    },
  };
}
