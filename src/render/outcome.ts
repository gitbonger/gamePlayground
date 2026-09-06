/**
 * End-of-flight panel: how the flight finished, and how to start again.
 *
 * Three lines and nothing else. It used to carry the run's statistics as well
 * -- time aloft, distance, top speed, ceiling -- and they were the wrong four
 * numbers at the wrong moment: a screen that appears because you have just
 * hit a building should say what you hit and which key flies again, and hold
 * nothing else for the eye to work through first.
 */

import type { Ending } from '../sim/flight';
import { speedText } from './units';

export interface OutcomePanel {
  show(ending: Ending): void;
  hide(): void;
  dispose(): void;
}

/** Headline and explanation for every way a flight can end. */
const OUTCOMES: Record<string, { title: string; detail: (e: Ending) => string }> = {
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
    detail: (e) => `You hit the ground at ${speedText(e.sink)} km/h — flare later and harder`,
  },
  'too-fast': {
    title: 'Game over',
    detail: (e) => `Too fast to land at ${speedText(e.speed)} km/h — bleed off speed first`,
  },
  struck: {
    title: 'Game over',
    detail: () => 'Something ran into you — mind the trains',
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
    const copy = OUTCOMES[ending.cause ?? 'landed']!;
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
