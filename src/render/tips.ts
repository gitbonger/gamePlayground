/**
 * One instruction at a time, in the corner: the keys, and what they do.
 *
 * The controls are currently a block of a dozen lines in the top left, which
 * is a reference card rather than teaching -- it is read once, at the moment
 * the player knows least about what any of it means, and then it sits there.
 * This is the other way round: one thing, at the moment that thing is the
 * thing to do.
 *
 * A tip is some keys and a few words, and it says nothing the panel itself
 * already says. The keycap is a picture of the key, so "press" is a word the
 * text does not have to spend.
 */

export interface Tip {
  /** The keys to press, in the order they are shown. */
  keys: readonly string[];
  /** What pressing them does, as an instruction rather than a description. */
  text: string;
}

/**
 * A tip, and how far you have to have flown to be given it.
 *
 * Distance rather than time, because distance is the only measure of the
 * flight that is also a measure of the player: twenty metres of flying is
 * twenty metres of flying whether it took four seconds or forty, and somebody
 * still working out which way is up has not covered it yet.
 */
export interface Lesson extends Tip {
  /** Metres flown in this run before it is offered. */
  at: number;
}

/**
 * The lessons, in the order the flight teaches them.
 *
 * One so far. They are given once each per run and forgotten on a death: the
 * player who has just flown into a building is the player who most wants to
 * be told again, and the one who never crashes never sees a repeat.
 */
export const LESSONS: readonly Lesson[] = [
  // Five metres: he is off the branch and sinking, which is the moment the
  // answer matters and the moment nobody reads a reference card.
  { at: 5, keys: ['SPACE'], text: 'Keep flapping' },
  // Then where to point. It is the one control with no natural gesture -- the
  // key says up and the nose goes up, which is the opposite of a joystick.
  { at: 20, keys: ['↑', '↓'], text: 'Aim up or down' },
];

/** How long a lesson stays on screen once it has been given, in seconds. */
const LINGER = 7;
/**
 * How long the corner stays empty between two lessons, in seconds.
 *
 * Without it, a flight that passes two thresholds close together swaps one
 * tip for the next in a single frame, and two instructions that never share
 * the screen but never leave it either read as one changing instruction.
 */
const REST = 1.5;

export interface Tutor {
  /**
   * The lesson to show now, or null. Called every frame with the distance
   * flown so far and the time since the last call.
   */
  update(travelled: number, dt: number): Tip | null;
  /** Forget what has been given, for a flight that is starting again. */
  reset(): void;
}

/**
 * Hands out the lessons, one at a time and once each.
 *
 * Knows nothing about the clock or the DOM: it is told how far and how long,
 * which is what makes "each tip is shown once, and again after a death"
 * something that can be stated as a test rather than watched for.
 */
export function createTutor(
  lessons: readonly Lesson[] = LESSONS,
  linger = LINGER,
  rest = REST,
): Tutor {
  const given = new Set<Lesson>();
  let showing: Tip | null = null;
  /** Seconds left of showing this one, or of the pause after it. */
  let left = 0;
  let resting = false;

  return {
    update(travelled, dt) {
      if (showing || resting) {
        left -= dt;
        if (left > 0) return showing;
        // A lesson that has had its turn is followed by the pause, and the
        // pause by nothing, so the next one starts from an empty corner.
        if (showing) {
          showing = null;
          resting = true;
          left = rest;
          return null;
        }
        resting = false;
      }

      // The first one not yet given that the flight has reached. One at a
      // time: passing two thresholds in one frame gives the earlier lesson
      // now and the later one when this has had its turn.
      const next = lessons.find((lesson) => lesson.at <= travelled && !given.has(lesson));
      if (!next) return null;

      given.add(next);
      showing = { keys: next.keys, text: next.text };
      left = linger;
      return showing;
    },
    reset() {
      given.clear();
      showing = null;
      left = 0;
    },
  };
}

export interface TipPanel {
  /** Show a tip, or pass null to take the panel away. */
  show(tip: Tip | null): void;
  dispose(): void;
}

export function createTipPanel(container: HTMLElement): TipPanel {
  const root = document.createElement('div');
  root.className = 'tip';
  root.hidden = true;
  container.appendChild(root);

  /** What is on screen, so an unchanged tip is not rebuilt every frame. */
  let showing: string | null = null;

  return {
    show(tip) {
      const wanted = tip ? `${tip.keys.join('+')} ${tip.text}` : null;
      if (wanted === showing) return;
      showing = wanted;

      root.hidden = tip === null;
      root.replaceChildren();
      if (!tip) return;

      for (const key of tip.keys) {
        const cap = document.createElement('b');
        cap.className = 'tip-key';
        cap.textContent = key;
        root.appendChild(cap);
      }

      const said = document.createElement('span');
      said.className = 'tip-text';
      said.textContent = tip.text;
      root.appendChild(said);
    },
    dispose() {
      root.remove();
    },
  };
}
