/** Game-over panel, shown when the bird crashes. */

import type { Crash } from '../sim/flight';
import type { RunStats } from '../run';

export interface GameOverPanel {
  show(crash: Crash, stats: RunStats): void;
  hide(): void;
  dispose(): void;
}

const CAUSE: Record<Crash['kind'], string> = {
  building: 'You flew into a building',
  ground: 'You hit the ground',
};

export function createGameOverPanel(container: HTMLElement): GameOverPanel {
  const root = document.createElement('div');
  root.className = 'gameover';
  root.hidden = true;
  root.innerHTML = `
    <div class="gameover-card">
      <h1>Game over</h1>
      <p class="gameover-cause" data-field="cause"></p>
      <dl class="gameover-stats">
        <div><dt>time aloft</dt><dd data-field="duration"></dd></div>
        <div><dt>distance</dt><dd data-field="distance"></dd></div>
        <div><dt>top speed</dt><dd data-field="topSpeed"></dd></div>
        <div><dt>ceiling</dt><dd data-field="ceiling"></dd></div>
      </dl>
      <p class="gameover-hint">press <b>R</b> to fly again</p>
    </div>
  `;
  container.appendChild(root);

  const field = (name: string) => root.querySelector<HTMLElement>(`[data-field="${name}"]`)!;

  function show(crash: Crash, stats: RunStats) {
    field('cause').textContent = `${CAUSE[crash.kind]} at ${(crash.speed * 3.6).toFixed(0)} km/h`;
    field('duration').textContent = formatDuration(stats.duration);
    field('distance').textContent =
      stats.distance >= 1000
        ? `${(stats.distance / 1000).toFixed(2)} km`
        : `${stats.distance.toFixed(0)} m`;
    field('topSpeed').textContent = `${(stats.topSpeed * 3.6).toFixed(0)} km/h`;
    field('ceiling').textContent = `${stats.ceiling.toFixed(0)} m`;
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
