/** The level selector: a list you can open, look at, and pick from. */

/**
 * Which level a digit picks, or null.
 *
 * Separated from the menu itself because it is the only part with a rule in
 * it, and because the rules are worth stating: digits do nothing at all while
 * the menu is closed, or every number typed during a flight would be a level
 * change; and a digit that is not a level does nothing either, because a menu
 * that closes itself when you mistype is worse than one that waits.
 */
export function levelChoice(digit: number, levels: number, open: boolean): number | null {
  if (!open) return null;
  const at = digit - 1;
  return Number.isInteger(at) && at >= 0 && at < levels ? at : null;
}

export interface LevelMenu {
  /** Whether it is on screen. */
  readonly open: boolean;
  /** Show or hide it, marking `at` as the one being played. */
  toggle(at: number): void;
  close(): void;
  /** Offer a digit. Returns the level it chose, or null. */
  choose(digit: number): number | null;
  dispose(): void;
}

export function createLevelMenu(
  container: HTMLElement,
  levels: readonly { name: string }[],
): LevelMenu {
  const root = document.createElement('div');
  root.className = 'menu';
  root.hidden = true;
  container.appendChild(root);

  let showing = false;

  /**
   * Built out of nodes rather than out of a string of markup.
   *
   * A level name is ours today and is still going into the page. Setting it
   * as text means there is no arrangement of characters that could be
   * anything but a name, which is a better guarantee than remembering to
   * escape it.
   */
  function draw(at: number) {
    root.replaceChildren();

    const card = document.createElement('div');
    card.className = 'menu-card';

    const title = document.createElement('h2');
    title.textContent = 'Levels';
    card.appendChild(title);

    levels.forEach((level, index) => {
      const row = document.createElement('div');
      row.className = index === at ? 'menu-level playing' : 'menu-level';

      const number = document.createElement('b');
      number.textContent = String(index + 1);
      const name = document.createElement('span');
      name.textContent = level.name;
      row.append(number, name);

      if (index === at) {
        const flag = document.createElement('em');
        flag.textContent = 'playing';
        row.appendChild(flag);
      }
      card.appendChild(row);
    });

    const hint = document.createElement('p');
    hint.className = 'menu-hint';
    hint.textContent = 'press a number to fly it, L to close';
    card.appendChild(hint);

    root.appendChild(card);
  }

  return {
    get open() {
      return showing;
    },
    toggle(at) {
      showing = !showing;
      if (showing) draw(at);
      root.hidden = !showing;
    },
    close() {
      showing = false;
      root.hidden = true;
    },
    choose(digit) {
      const at = levelChoice(digit, levels.length, showing);
      if (at === null) return null;
      showing = false;
      root.hidden = true;
      return at;
    },
    dispose() {
      root.remove();
    },
  };
}
