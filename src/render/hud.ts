/** Flight instruments, drawn as plain DOM over the canvas. */

import { isPerched, type BirdState, type FlightTelemetry, type LandingReadiness } from '../sim/flight';
import { rateText, speedText } from './units';
import type { WalkTelemetry } from '../sim/walk';

export interface Hud {
  /** `landing` is null when the bird is too high for the approach cue to help. */
  update(
    state: BirdState,
    telemetry: FlightTelemetry,
    landing: LandingReadiness | null,
    /** Metres still to fly to the target, along the ground. */
    toGo: number,
    fps: number,
    /** What the bird did on its feet this tick, for the on-foot cue. */
    onFoot: WalkTelemetry,
    /** Something that has just been achieved, or null. Outranks everything. */
    note: string | null,
    /** Whether the bird is standing with somebody, and cannot walk off. */
    talking: boolean,
  ): void;
  dispose(): void;
}

export function createHud(container: HTMLElement, credit = ''): Hud {
  const root = document.createElement('div');
  root.className = 'hud';
  root.innerHTML = `
    <div class="hud-column">
      <div class="hud-stamina">
        <span class="label">stamina</span>
        <div class="bar"><div class="bar-fill" data-field="stamina"></div></div>
      </div>
      <div class="hud-readouts">
        <div class="readout"><span class="label">airspeed</span><span data-field="speed">0</span><span class="unit">km/h</span></div>
        <div class="readout"><span class="label">altitude</span><span data-field="altitude">0</span><span class="unit">m</span></div>
        <div class="readout"><span class="label">climb</span><span data-field="climb">0</span><span class="unit">km/h</span></div>
        <div class="readout secondary" title="Local wind, and how much of it is against you"><span class="label">wind</span><span data-field="wind">0</span><span class="unit">km/h</span><span class="aside" data-field="headwind"></span></div>
        <div class="readout" title="Distance still to fly to the marked target"><span class="label">home</span><span data-field="home">0</span><span class="unit">m</span></div>
      </div>
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
    <div class="hud-credit" data-field="credit"></div>
  `;
  container.appendChild(root);

  const field = (name: string) => root.querySelector<HTMLElement>(`[data-field="${name}"]`)!;
  const speedEl = field('speed');
  const altitudeEl = field('altitude');
  const climbEl = field('climb');
  const windEl = field('wind');
  const homeEl = field('home');
  const headwindEl = field('headwind');
  const staminaEl = field('stamina');
  const warningEl = field('warning');
  const fpsEl = field('fps');
  // Map data licences generally require the credit to stay on screen.
  field('credit').textContent = credit;
  const landingEl = field('landing');
  const landingTitleEl = field('landingTitle');
  const checkSinkEl = field('checkSink');
  const checkSpeedEl = field('checkSpeed');
  const checkBankEl = field('checkBank');

  function update(
    state: BirdState,
    telemetry: FlightTelemetry,
    landing: LandingReadiness | null,
    toGo: number,
    fps: number,
    onFoot: WalkTelemetry,
    note: string | null,
    talking: boolean,
  ) {
    speedEl.textContent = speedText(telemetry.airspeed);
    altitudeEl.textContent = telemetry.altitude.toFixed(0);
    climbEl.textContent = rateText(telemetry.climbRate);
    climbEl.classList.toggle('positive', telemetry.climbRate > 0.2);

    // Airspeed already reflects the wind; this says where it is coming from.
    // The thresholds below stay in m/s: they are facts about the air, not
    // about how it is written down.
    const strength = Math.hypot(telemetry.wind.x, telemetry.wind.y, telemetry.wind.z);
    windEl.textContent = speedText(strength);
    const head = telemetry.headwind;
    headwindEl.textContent =
      strength < 0.2 ? 'calm' : head > 0.3 ? 'head' : head < -0.3 ? 'tail' : 'cross';
    headwindEl.classList.toggle('adverse', head > 0.3);

    staminaEl.style.width = `${state.stamina * 100}%`;
    staminaEl.classList.toggle('low', state.stamina < 0.25);

    const warning = note
      ? note
      : // Nothing at all while you are standing with somebody. The panel
        // below is saying who and what, in their own words and colours, and
        // a line over the top of it announcing that a conversation is
        // happening is the game narrating what the player is reading.
        talking
        ? ''
        : isPerched(state)
      ? onFoot.blocked
        ? 'blocked — turn and walk round it'
        : onFoot.travelled > 0
          ? 'walking — mind the edge'
          : 'on foot — WASD or arrows to walk, SPACE to take off'
      : telemetry.stalled && !state.ending
        ? 'STALL — push the nose down'
        : '';
    if (warningEl.textContent !== warning) warningEl.textContent = warning;
    warningEl.classList.toggle('calm', isPerched(state) || note !== null);

    // Approach cue: only useful on the way down, and only while still flying.
    landingEl.hidden = landing === null;
    if (landing) {
      checkSinkEl.classList.toggle('ok', landing.sinkOk);
      checkSpeedEl.classList.toggle('ok', landing.speedOk);
      checkBankEl.classList.toggle('ok', landing.bankOk);
      landingEl.classList.toggle('ready', landing.ready);
      landingTitleEl.textContent = landing.ready ? 'ready to land' : 'approach';
    }

    homeEl.textContent = toGo.toFixed(0);
    homeEl.classList.toggle('positive', toGo < 40);

    fpsEl.textContent = fps.toFixed(0);
  }

  return {
    update,
    dispose() {
      root.remove();
    },
  };
}
