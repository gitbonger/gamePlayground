/** End-of-flight panel: how the flight finished, and how it went. */

import type { Ending } from '../sim/flight';
import type { RunStats } from '../run';
import { speedText } from './units';

export interface OutcomePanel {
  show(ending: Ending, stats: RunStats): void;
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
      <dl class="outcome-stats">
        <div><dt>time aloft</dt><dd data-field="duration"></dd></div>
        <div><dt>distance</dt><dd data-field="distance"></dd></div>
        <div><dt>top speed</dt><dd data-field="topSpeed"></dd></div>
        <div><dt>ceiling</dt><dd data-field="ceiling"></dd></div>
      </dl>
      <p class="outcome-hint">press <b>R</b> to fly again</p>
    </div>
  `;
  container.appendChild(root);

  const field = (name: string) => root.querySelector<HTMLElement>(`[data-field="${name}"]`)!;

  function show(ending: Ending, stats: RunStats) {
    const copy = OUTCOMES[ending.cause ?? 'landed']!;
    field('title').textContent = copy.title;
    field('detail').textContent = copy.detail(ending);
    field('duration').textContent = formatDuration(stats.duration);
    field('distance').textContent =
      stats.distance >= 1000
        ? `${(stats.distance / 1000).toFixed(2)} km`
        : `${stats.distance.toFixed(0)} m`;
    field('topSpeed').textContent = `${speedText(stats.topSpeed)} km/h`;
    field('ceiling').textContent = `${stats.ceiling.toFixed(0)} m`;

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

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return minutes > 0 ? `${minutes}m ${rest.toFixed(0)}s` : `${rest.toFixed(1)}s`;
}
