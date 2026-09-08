/**
 * End-of-flight panel: how the flight finished, and how to start again.
 *
 * Three lines and nothing else. It used to carry the run's statistics as well
 * -- time aloft, distance, top speed, ceiling -- and they were the wrong four
 * numbers at the wrong moment: a screen that appears because you have just
 * hit a building should say what you hit and which key flies again, and hold
 * nothing else for the eye to work through first.
 */

import { onLanguageChange, read, say, type Phrase, type Words } from '../i18n';
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
const OUTCOMES: Record<
  CrashCause | 'landed',
  { title: Phrase; detail: (e: Ending) => Words }
> = {
  landed: {
    title: 'landed',
    detail: (e) => ({
      en: `Touched down at ${speedText(e.speed)} km/h`,
      hu: `Leszálltál ${speedText(e.speed)} km/h-val`,
    }),
  },
  building: {
    title: 'gameOver',
    detail: (e) => ({
      en: `You flew into a building at ${speedText(e.speed)} km/h`,
      hu: `Nekirepültél egy háznak ${speedText(e.speed)} km/h-val`,
    }),
  },
  'hard-impact': {
    title: 'gameOver',
    // "Flare later and harder" is what a pilot would say and no use to
    // anybody else. The control is the down key and the verb is pull up.
    detail: (e) => ({
      en: `You hit the ground at ${speedText(e.sink)} km/h — pull up later and harder`,
      hu: `Becsapódtál ${speedText(e.sink)} km/h-val — húzd fel később és erősebben`,
    }),
  },
  'too-fast': {
    title: 'gameOver',
    detail: (e) => ({
      en: `Too fast to land at ${speedText(e.speed)} km/h — bleed off speed first`,
      hu: `Túl gyors a leszálláshoz: ${speedText(e.speed)} km/h — előbb lassíts`,
    }),
  },
  struck: {
    title: 'gameOver',
    detail: () => ({
      en: 'Something ran into you — mind the trains',
      hu: 'Elütöttek — vigyázz a szerelvényekkel',
    }),
  },
  caught: {
    title: 'gameOver',
    // The rule, not the reproach. A player who has just been caught by a crow
    // knows they were caught by a crow; what they do not know is that under
    // twenty metres nothing can reach them.
    detail: () => ({
      en: 'A crow caught you — stay under twenty metres',
      hu: 'Elkapott egy varjú — maradj húsz méter alatt',
    }),
  },
  'not-level': {
    title: 'gameOver',
    detail: (e) => ({
      en: `You landed banked ${((e.bank * 180) / Math.PI).toFixed(0)}° — level the wings`,
      hu: `${((e.bank * 180) / Math.PI).toFixed(0)}°-os dőléssel értél földet — vidd vízszintbe a szárnyat`,
    }),
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
      <p class="outcome-hint" data-field="again"></p>
    </div>
  `;
  container.appendChild(root);

  const field = (name: string) => root.querySelector<HTMLElement>(`[data-field="${name}"]`)!;

  /**
   * The panel is only ever on screen while the world is stopped, so it is
   * written when it is shown rather than kept in step with the language --
   * except that the language can be swapped while it is up, so the last
   * ending is kept and written again.
   */
  let showing: Ending | null = null;

  function write(ending: Ending) {
    const copy = OUTCOMES[ending.cause ?? 'landed'];
    field('title').textContent = say(copy.title);
    field('detail').textContent = read(copy.detail(ending));
    // The key is a picture of the key; the words round it are words.
    field('again').replaceChildren(
      document.createTextNode(read({ en: 'press ', hu: 'nyomj ' })),
      Object.assign(document.createElement('b'), { textContent: 'R' }),
      document.createTextNode(read({ en: ' to fly again', hu: '-t az újrakezdéshez' })),
    );
  }
  onLanguageChange(() => {
    if (showing) write(showing);
  });

  function show(ending: Ending) {
    showing = ending;
    write(ending);

    root.classList.toggle('landed', ending.kind === 'landed');
    root.hidden = false;
  }

  return {
    show,
    hide() {
      showing = null;
      root.hidden = true;
    },
    dispose() {
      root.remove();
    },
  };
}
