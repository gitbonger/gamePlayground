/** The level selector: a list you can open, look at, and pick from. */

import { onLanguageChange, say } from '../i18n';

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

/**
 * Where the highlight lands after moving `by` rows.
 *
 * Separated for the same reason `levelChoice` is: it is the only part of
 * arrow navigation with a rule in it, and the rule is worth stating. It
 * wraps, so holding an arrow at the end of the list carries on round rather
 * than stopping dead against it -- with ten levels and a list you have just
 * opened on the tenth, "down" ought to reach the first rather than nothing.
 */
export function highlightAfter(current: number, by: number, levels: number): number {
  if (levels <= 0) return 0;
  return (((current + by) % levels) + levels) % levels;
}

/**
 * Which tab a step lands on: the three games, and it does not wrap.
 *
 * Its own function for the same reason the other two rules are: a tab strip
 * that wrapped would take you from the story to the round with one press of
 * a key that also means "bank left", and the ends of a list of three are
 * where a player expects to stop.
 */
export const tabAfter = (current: number, by: number, tabs: number): number =>
  Math.max(0, Math.min(tabs - 1, current + by));

/** What the menu needs to know about the simulation being flown. */
export interface MenuMode {
  title: string;
  says: string;
}

export interface LevelMenu {
  /** Whether it is on screen. */
  readonly open: boolean;
  /** Show or hide it, marking `at` as the one being played and `mode` as set. */
  toggle(at: number, mode: MenuMode): void;
  close(): void;
  /** Offer a digit. Returns the level it chose, or null. */
  choose(digit: number): number | null;
  /**
   * Move the highlight by `by` rows, wrapping at both ends.
   *
   * The way to reach anything a digit cannot. There are ten levels and nine
   * digits, so the tenth was unreachable from the keyboard altogether -- and
   * the eleventh would have been, and the twelfth.
   */
  move(by: number): void;
  /**
   * Move between the games by `by` tabs. Returns whether it moved.
   *
   * Left and right, which used to switch the flight model. Three games in a
   * strip is a thing the arrows are for; the flight model is one button with
   * two states and is clicked.
   */
  step(by: number): boolean;
  /** Take the highlighted one. Returns the level, or null if none is. */
  confirm(): number | null;
  /**
   * Redraw with a different mode named on the switch.
   *
   * Called after the mode has actually changed rather than instead of
   * changing it: the menu shows what is being flown, it does not decide it.
   */
  showMode(at: number, mode: MenuMode): void;
  dispose(): void;
}

export function createLevelMenu(
  container: HTMLElement,
  /**
   * The levels, each with the name it is called by in its own game --
   * `Story7`, `Sight1`, `Delivery1` -- and which game that is.
   *
   * The tag rather than the row number: the first thirteen rows are the story
   * and their numbers agree anyway, and past that a row number says nothing
   * about what the level is. The game is what the tabs are cut on.
   */
  levels: readonly { name: string; tag?: string; mode?: string }[],
  onSwitchMode?: () => void,
  /**
   * Called when a level is picked with the mouse.
   *
   * A callback rather than a return value, because a click happens whenever
   * the player clicks and not when the game next asks. The keyboard route
   * keeps its return value: a digit is offered and answered in the same
   * breath.
   */
  onPick?: (at: number) => void,
): LevelMenu {
  const root = document.createElement('div');
  root.className = 'menu';
  root.hidden = true;
  container.appendChild(root);

  /**
   * The three games, as tabs.
   *
   * Taken from the levels rather than written down, so a game with no levels
   * in it yet is not a tab that opens onto nothing -- and the order is the
   * order they appear in the list, which is the order they were built.
   */
  const games: string[] = [];
  for (const level of levels) {
    const game = level.mode ?? 'story';
    if (!games.includes(game)) games.push(game);
  }
  const rowsOf = (game: string) =>
    levels
      .map((level, at) => ({ level, at }))
      .filter((row) => (row.level.mode ?? 'story') === game);
  /** Which tab is open. Set to the played level's own game when it opens. */
  let tab = 0;

  let showing = false;
  /**
   * Which row the arrows are on.
   *
   * Set to the level being played each time the menu opens, so the list
   * starts where the player is rather than at the top: the thing they most
   * often want is the one next to the one they are on.
   */
  let highlighted = 0;
  /** What the last draw was given, so a redraw can repeat it. */
  let drawnAt = 0;
  let drawnMode: MenuMode | null = null;
  // Redrawn on a swap, since the list is built once when it opens and the
  // language can change while it is up -- which it very well might, given
  // both keys are on the same keyboard and one of them is being looked for.
  onLanguageChange(() => {
    if (showing && drawnMode) draw(drawnAt, drawnMode);
  });

  /**
   * Built out of nodes rather than out of a string of markup.
   *
   * A level name is ours today and is still going into the page. Setting it
   * as text means there is no arrangement of characters that could be
   * anything but a name, which is a better guarantee than remembering to
   * escape it.
   */
  function draw(at: number, mode: MenuMode) {
    root.replaceChildren();

    const card = document.createElement('div');
    card.className = 'menu-card';

    const title = document.createElement('h2');
    title.textContent = say('menuTitle');
    card.appendChild(title);

    // The tabs. Three of them and the arrows move between them, which is why
    // the flight model is no longer on those keys: see the switch below.
    const strip = document.createElement('div');
    strip.className = 'menu-tabs';
    games.forEach((game, index) => {
      const tabButton = document.createElement('button');
      tabButton.type = 'button';
      tabButton.className = index === tab ? 'menu-tab picked' : 'menu-tab';
      tabButton.textContent = say(`game-${game}` as Parameters<typeof say>[0]);
      tabButton.addEventListener('click', () => {
        tab = index;
        highlighted = rowsOf(games[tab]!)[0]?.at ?? 0;
        draw(drawnAt, drawnMode ?? mode);
      });
      strip.appendChild(tabButton);
    });
    card.appendChild(strip);

    rowsOf(games[tab] ?? 'story').forEach(({ level, at: index }) => {
      const row = document.createElement('button');
      row.type = 'button';
      const marks = ['menu-level'];
      if (index === at) marks.push('playing');
      if (index === highlighted) marks.push('picked');
      row.className = marks.join(' ');
      // Clicked, which is the other way in and the one nobody has to be told
      // about. The same call the keyboard makes.
      row.addEventListener('click', () => {
        showing = false;
        root.hidden = true;
        onPick?.(index);
      });

      const number = document.createElement('b');
      number.textContent = level.tag ?? String(index + 1);
      const name = document.createElement('span');
      name.textContent = level.name;
      row.append(number, name);

      if (index === at) {
        const flag = document.createElement('em');
        flag.textContent = say('menuPlaying');
        row.appendChild(flag);
      }
      card.appendChild(row);
    });

    // The simulation being flown, as a switch rather than a list: there are
    // two of them and one is on, which is a thing a button says better than a
    // menu does. It is a button rather than a key because it is not something
    // you do in flight -- you decide it, once, and go back to flying.
    const flying = document.createElement('button');
    flying.className = 'menu-mode';
    flying.type = 'button';

    const label = document.createElement('b');
    label.textContent = mode.title;
    const says = document.createElement('span');
    says.textContent = mode.says;
    const swap = document.createElement('em');
    swap.textContent = say('menuSwitch');
    flying.append(label, says, swap);
    flying.addEventListener('click', () => onSwitchMode?.());
    card.appendChild(flying);

    const hint = document.createElement('p');
    hint.className = 'menu-hint';
    hint.textContent = say('menuHow');
    card.appendChild(hint);

    root.appendChild(card);
  }

  return {
    get open() {
      return showing;
    },
    toggle(at, mode) {
      showing = !showing;
      // Opened on the level being played, so the arrows start where the
      // player is -- and on that level's own tab, since it is the one the
      // player is in the middle of.
      if (showing) {
        const game = levels[at]?.mode ?? 'story';
        tab = Math.max(0, games.indexOf(game));
        highlighted = at;
        drawnAt = at;
        drawnMode = mode;
        draw(at, mode);
      }
      root.hidden = !showing;
    },
    showMode(at, mode) {
      drawnAt = at;
      drawnMode = mode;
      if (showing) draw(at, mode);
    },
    move(by) {
      if (!showing || by === 0) return;
      // Within the open tab, and wrapping inside it: holding an arrow at the
      // end of a game's levels carries on round rather than stopping dead,
      // and never wanders into another game -- that is what the tabs are for.
      const rows = rowsOf(games[tab] ?? 'story');
      if (rows.length === 0) return;
      const now = Math.max(0, rows.findIndex((row) => row.at === highlighted));
      highlighted = rows[highlightAfter(now, by, rows.length)]!.at;
      if (drawnMode) draw(drawnAt, drawnMode);
    },
    step(by) {
      if (!showing || by === 0) return false;
      const wanted = tabAfter(tab, by, games.length);
      if (wanted === tab) return false;
      tab = wanted;
      // Onto the first level of the game you have just opened: a highlight
      // left behind on a tab you cannot see is a highlight that takes the
      // wrong level when you press Enter.
      highlighted = rowsOf(games[tab]!)[0]?.at ?? highlighted;
      if (drawnMode) draw(drawnAt, drawnMode);
      return true;
    },
    confirm() {
      if (!showing || highlighted < 0 || highlighted >= levels.length) return null;
      showing = false;
      root.hidden = true;
      return highlighted;
    },
    close() {
      showing = false;
      root.hidden = true;
    },
    choose(digit) {
      const rows = rowsOf(games[tab] ?? 'story');
      const at = levelChoice(digit, rows.length, showing);
      if (at === null) return null;
      showing = false;
      root.hidden = true;
      return rows[at]!.at;
    },
    dispose() {
      root.remove();
    },
  };
}
