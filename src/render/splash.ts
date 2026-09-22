/**
 * The screen that stands in front of the game while it loads, and the bar on
 * it.
 *
 * There is a lot to wait for: eleven megabytes of map to fetch, and then a
 * city to build out of it. Both are silent, the canvas is black throughout,
 * and people reported the game as frozen -- which, with nothing on screen
 * saying otherwise, is the only reasonable thing to conclude.
 *
 * Two phases, and they are different kinds of waiting:
 *
 * - **Fetching** is measurable, so the bar measures it. The main thread is
 *   idle while the bytes arrive, so the words and the number can be written
 *   as they come.
 * - **Building** is not. Worse, it is one unbroken lump of synchronous work:
 *   nothing on the page can be repainted from the moment it starts until the
 *   moment it ends, so anything driven from JavaScript would sit still for
 *   exactly as long as the freeze people were complaining about.
 *
 * Which is why the second phase is a CSS animation of `transform` and
 * nothing else. Those are run by the compositor rather than by the main
 * thread, so the bar goes on sweeping while the city is built on top of a
 * completely blocked page. It is the one thing that can still move, and it
 * is the whole reason the splash is worth having.
 */

import { onLanguageChange, say, type Phrase } from '../i18n';

/** How long the splash takes to fade once the first frame is up, in seconds. */
const FADE = 0.45;

export interface Splash {
  /**
   * How much of the download is in, as a fraction.
   *
   * Written as a percentage beside the words, because a number that changes
   * is the plainest possible statement that something is happening.
   */
  fetched(part: number): void;
  /**
   * Move to the phase that cannot be measured, saying what it is.
   *
   * The bar stops being a quantity and becomes a sweep. See the note above
   * for why that sweep is in CSS rather than here.
   */
  working(says: Phrase): void;
  /** Say it went wrong, and stay up: there is nothing behind us to show. */
  failed(detail: string): void;
  /** Fade out and go away. */
  done(): void;
}

export function createSplash(): Splash {
  const root = document.querySelector<HTMLElement>('#splash');
  // Nothing to drive. The dev pages under `dev/` have no splash in their
  // markup and have nothing to wait for either.
  if (!root) return { fetched() {}, working() {}, failed() {}, done() {} };

  const fill = root.querySelector<HTMLElement>('.splash-fill')!;
  const line = root.querySelector<HTMLElement>('.splash-says')!;

  /** What the line says, kept so a language swap can rewrite it. */
  let phrase: Phrase | null = null;
  let percent: number | null = null;

  function write(): void {
    if (phrase === null) return;
    line.textContent = percent === null ? say(phrase) : `${say(phrase)} ${percent}%`;
  }
  // Somebody who loads the game in Hungarian and swaps to English while the
  // map is still coming down should see it swap here too.
  onLanguageChange(write);

  return {
    fetched(part) {
      // Off the sweep and onto the measure. It has to be said rather than
      // assumed: the page starts out sweeping, from the markup, because until
      // this is first called there is nothing to measure -- and a running
      // keyframe animation beats an inline style on the property it animates,
      // so a bar left in that class would go on sweeping however carefully
      // its scale was set underneath.
      root.classList.remove('working');
      const whole = Math.max(0, Math.min(1, part));
      // `scaleX` rather than a width, because a width is laid out by the main
      // thread and a transform is not -- the same reason the sweep is a
      // transform. Rounded to whole percent before it is written, so a
      // thousand chunks are not a thousand repaints of the same number.
      fill.style.transform = `scaleX(${whole})`;
      const shown = Math.round(whole * 100);
      if (shown === percent) return;
      percent = shown;
      phrase = 'loadingMap';
      write();
    },
    working(says) {
      percent = null;
      phrase = says;
      write();
      // The bar gives up saying how much and starts saying *that* something
      // is happening. `scaleX` comes off so the keyframes own the transform.
      fill.style.transform = '';
      root.classList.add('working');
    },
    failed(detail) {
      root.classList.remove('working');
      root.classList.add('failed');
      fill.style.transform = 'scaleX(1)';
      phrase = 'loadingFailed';
      percent = null;
      write();
      line.textContent += ` — ${detail}`;
    },
    done() {
      root.classList.add('gone');
      // Removed rather than merely hidden: it is a full-screen element over
      // the game, and one left in the page is one more thing for a finger to
      // land on by accident.
      setTimeout(() => root.remove(), FADE * 1000);
    },
  };
}
