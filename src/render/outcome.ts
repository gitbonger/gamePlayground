/**
 * End-of-flight panel: how the flight finished, and how to start again.
 *
 * Three lines and nothing else. It used to carry the run's statistics as well
 * -- time aloft, distance, top speed, ceiling -- and they were the wrong four
 * numbers at the wrong moment: a screen that appears because you have just
 * hit a building should say what you hit and which key flies again, and hold
 * nothing else for the eye to work through first.
 */

import type { CrashCause, Ending } from '../sim/flight';
import { speedText } from './units';

export interface OutcomePanel {
  show(ending: Ending): void;
  hide(): void;
  dispose(): void;
}

/**
 * Headline and explanation for every way a flight can end.
 *
 * Keyed by the causes themselves rather than by `string`, so a new way to die
 * that nobody wrote a line for is a compile error rather than a blank panel
 * at the worst possible moment. It was `Record<string, ...>` with a `!` on
 * the lookup, which is the same thing as no check at all.
 */
const OUTCOMES: Record<CrashCause | 'landed', { title: string; detail: (e: Ending) => string }> = {
  landed: {
    title: 'Landed',
    detail: (e) => `Touched down at ${speedText(e.speed)} km/h`,
  },
  building: {
    title: 'Game over',
    detail: (e) => `You flew into a building at ${speedText(e.speed)} km/h`,
  },
  'hard-impact': {
    title: 'Game over',
    // "Flare later and harder" is what a pilot would say and no use to
    // anybody else. The control is the down key and the verb is pull up.
    detail: (e) => `You hit the ground at ${speedText(e.sink)} km/h — pull up later and harder`,
  },
  'too-fast': {
    title: 'Game over',
    detail: (e) => `Too fast to land at ${speedText(e.speed)} km/h — bleed off speed first`,
  },
  struck: {
    title: 'Game over',
    detail: () => 'Something ran into you — mind the trains',
  },
  caught: {
    title: 'Game over',
    // The rule, not the reproach. A player who has just been caught by a crow
    // knows they were caught by a crow; what they do not know is that under
    // twenty metres nothing can reach them.
    detail: () => 'A crow caught you — stay under twenty metres',
  },
  'not-level': {
    title: 'Game over',
    detail: (e) => `You landed banked ${((e.bank * 180) / Math.PI).toFixed(0)}° — level the wings`,
  },
};

export function createOutcomePanel(container: HTMLElement): OutcomePanel {
  const root = document.createElement('div');
  root.className = 'outcome';
  root.hidden = true;
  root.innerHTML = `
    <div class="outcome-card">
      <h1 data-field="title"></h1>
      <p class="outcome-detail" data-field="detail"></p>
      <p class="outcome-hint">press <b>R</b> to fly again</p>
    </div>
  `;
  container.appendChild(root);

  const field = (name: string) => root.querySelector<HTMLElement>(`[data-field="${name}"]`)!;

  function show(ending: Ending) {
    const copy = OUTCOMES[ending.cause ?? 'landed'];
    field('title').textContent = copy.title;
    field('detail').textContent = copy.detail(ending);

    root.classList.toggle('landed', ending.kind === 'landed');
    root.hidden = false;
  }

  return {
    show,
    hide() {
      root.hidden = true;
    },
    dispose() {
      root.remove();
    },
  };
}
