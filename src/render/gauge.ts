/**
 * A named bar across the top of the screen, for the one thing that is not the
 * bird.
 *
 * The corner readouts are about the pigeon -- what is in its wings, what is in
 * its belly -- and they live down the left where the eye can leave them. This
 * is the other kind: a thing being worked on, in the middle of the shot,
 * where the thing is. The cage at the end of the story is the only one, and
 * it is worth having because the wait is now long enough to be watched: thirty
 * birds having a go at it in turn is a bar coming down in steps, which says
 * "they are getting somewhere" in a way that a timer running silently does
 * not.
 */

import { read, type Words } from '../i18n';

export interface Gauge {
  /** Show it at `full` of one, or pass null to take it away. */
  show(name: Words | null, full?: number): void;
  dispose(): void;
}

export function createGauge(container: HTMLElement): Gauge {
  const root = document.createElement('div');
  root.className = 'gauge';
  root.hidden = true;
  root.innerHTML = `
    <span class="gauge-name"></span>
    <div class="bar"><div class="bar-fill gauge-fill"></div></div>
  `;
  container.appendChild(root);

  const name = root.querySelector<HTMLElement>('.gauge-name')!;
  const fill = root.querySelector<HTMLElement>('.gauge-fill')!;
  /** What is on screen, so an unchanged bar is not written every frame. */
  let showing = '';

  return {
    show(what, full = 1) {
      root.hidden = what === null;
      if (!what) return;
      // Rounded before it is compared, so a bar that moves in steps is
      // written when it steps rather than sixty times a second.
      const wanted = `${read(what)}|${Math.round(full * 200)}`;
      if (wanted === showing) return;
      showing = wanted;
      name.textContent = read(what);
      fill.style.width = `${Math.max(0, Math.min(1, full)) * 100}%`;
      // Nearly gone: the same red the bird's own health goes, so a bar
      // running out means one thing wherever it is on the screen.
      fill.classList.toggle('low', full < 0.25);
    },
    dispose() {
      root.remove();
    },
  };
}
