/** Flight instruments, drawn as plain DOM over the canvas. */

/** How little is left in the wings before the bar says so. */
const TIRED_STAMINA = 0.3;

import type { BirdState, FlightTelemetry } from '../sim/flight';
import { rateText, speedText } from './units';

export interface Hud {
  update(
    state: BirdState,
    telemetry: FlightTelemetry,
    /** Metres still to fly to the target, along the ground. */
    toGo: number,
    fps: number,
    /** What the story has to say, or null. */
    note: string | null,
    /** Where the bird is, in degrees. */
    where: { latitude: number; longitude: number },
    /**
     * Whether the wings tire on this level.
     *
     * False on the one level that does not tire, where the bar is held at
     * full and pulsed. It has to *say* something rather than merely sit at
     * a hundred percent: a full green bar is what the first ten seconds of
     * every level looks like, so a bar that is full because the rule is
     * different is indistinguishable from a bar that is full because
     * nothing has happened yet.
     */
    tiring?: boolean,
  ): void;
  dispose(): void;
}

export function createHud(container: HTMLElement, credit = ''): Hud {
  const root = document.createElement('div');
  root.className = 'hud';
  root.innerHTML = `
    <div class="hud-column">
      <div class="hud-stamina">
        <span class="label">health</span>
        <div class="bar"><div class="bar-fill health" data-field="health"></div></div>
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
    <div class="hud-where" data-field="where"></div>
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
  const healthEl = field('health');
  const warningEl = field('warning');
  const fpsEl = field('fps');
  const whereEl = field('where');
  // Map data licences generally require the credit to stay on screen.
  field('credit').textContent = credit;

  function update(
    state: BirdState,
    telemetry: FlightTelemetry,
    toGo: number,
    fps: number,
    note: string | null,
    where: { latitude: number; longitude: number },
    tiring = true,
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

    staminaEl.style.width = `${tiring ? state.stamina * 100 : 100}%`;
    // Red at the same mark the "slow down" instruction appears at, so the
    // words and the picture say the same thing at the same moment.
    staminaEl.classList.toggle('low', tiring && state.stamina < TIRED_STAMINA);
    // And pulsing where the wings do not tire, which is the bar saying so
    // rather than merely happening to be full.
    staminaEl.classList.toggle('tireless', !tiring);

    // What is left in the belly. It only ever falls, and only by flying: this
    // is the bar that says the errand has a cost.
    healthEl.style.width = `${state.health * 100}%`;
    healthEl.classList.toggle('low', state.health < TIRED_STAMINA);

    // The line over the bird is the story's, and only the story's: what level
    // is being flown, and that it has been finished. Everything that was
    // sharing it -- stall, the on-foot hints, an announcement that a
    // conversation was happening -- has gone to the instruction panel under
    // the bird, where the keys are.
    const said = note ?? '';
    if (warningEl.textContent !== said) warningEl.textContent = said;
    warningEl.classList.toggle('calm', true);

    homeEl.textContent = toGo.toFixed(0);
    homeEl.classList.toggle('positive', toGo < 40);

    // Where the bird is, in the coordinates everything else in this game is
    // written in. A development readout: it is here so that something seen
    // from the air can be reported as a pair of numbers rather than as "over
    // some trees near a junction", and it costs two lines of arithmetic.
    whereEl.textContent = `${where.latitude.toFixed(6)}, ${where.longitude.toFixed(6)}`;

    fpsEl.textContent = fps.toFixed(0);
  }

  return {
    update,
    dispose() {
      root.remove();
    },
  };
}
