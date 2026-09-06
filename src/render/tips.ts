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
 * Which keys on the keyboard each shown key stands for.
 *
 * An instruction goes away when the player uses it, which means the drawing
 * of a key has to be connected to the key -- and the arrows are drawn as
 * arrows while the same control is also on WASD, so one label answers to two
 * codes. Kept here, beside the labels, because the label is the only reason
 * this mapping exists.
 */
const CODES: Record<string, readonly string[]> = {
  SPACE: ['Space'],
  '↑': ['ArrowUp', 'KeyW'],
  '↓': ['ArrowDown', 'KeyS'],
  '←': ['ArrowLeft', 'KeyA'],
  '→': ['ArrowRight', 'KeyD'],
  B: ['KeyB'],
};

/** The `KeyboardEvent.code`s that count as doing what a tip says. */
export const codesFor = (tip: Tip): readonly string[] =>
  tip.keys.flatMap((key) => CODES[key] ?? []);

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
  // Turning, one side at a time, and not straight away: eighty metres is
  // five or six seconds of flying, which is long enough to have stopped
  // thinking about staying up. Nothing about the flight demands a turn -- the
  // target is straight ahead -- which is exactly why it is a good moment to
  // be asked to try one: the cost of getting it wrong is a few seconds of
  // going the wrong way over an empty park.
  { at: 80, keys: ['→'], text: 'Try right!' },
  { at: 120, keys: ['←'], text: 'Try left!' },
];

/**
 * What the flight looks like from outside, for the tips that watch it.
 *
 * SI, like the simulation: metres and metres per second. A threshold written
 * in km/h would be a threshold about the readout rather than about the air.
 */
export interface Flying {
  altitude: number;
  airspeed: number;
  /** What is left in the wings, 0 to 1. */
  stamina: number;
  /** Whether the wing has stopped working, which is not the same as slow. */
  stalled: boolean;
}

/** Below this the bird is running out of air to fly on, in m/s -- 20 km/h. */
const SLOW = 20 / 3.6;
/** And below this it is running out of room, in metres. */
const LOW = 20;
/** And below this, out of wing. A fraction of a full tank. */
const TIRED = 0.3;

/**
 * A tip given while something is true, rather than once at a distance.
 *
 * These are the ones that do not go away by being read. A lesson is offered
 * and taken; a warning is the state of the flight, and it is on screen for
 * exactly as long as the flight is in that state.
 */
export interface Warning extends Tip {
  when(flight: Flying): boolean;
  /**
   * Shown to everyone, taught or not.
   *
   * A lesson is for somebody learning; a stall is for whoever is in one. A
   * pigeon spends half its life low, slow and tired on purpose, so those
   * three stop once the game has stopped teaching -- but nobody stalls on
   * purpose, and the wing has genuinely stopped working.
   */
  always?: boolean;
}

export const WARNINGS: readonly Warning[] = [
  // The stall first, because it is the only one that is already happening
  // rather than about to. The nose has to come down before anything else is
  // worth trying, and the key that brings it down is the up arrow, which is
  // the sort of thing worth a picture of a key.
  {
    keys: ['↑'],
    text: 'Nose down!',
    always: true,
    when: (flight) => flight.stalled,
  },
  // Then slow, and this is the whole reason there is an order. Low *and*
  // slow looks like a case for pulling up, and pulling up with no speed is
  // how a bird stalls into the ground it was trying to clear. Wings first,
  // always: flapping is the only control that makes more of both.
  {
    keys: ['SPACE'],
    text: 'Keep flapping!',
    when: (flight) => flight.airspeed < SLOW,
  },
  // The down key, because the nose follows the key rather than the horizon:
  // down on the keyboard is up in the air, which is the one control nobody
  // guesses right.
  {
    keys: ['↓'],
    text: 'Pull up!',
    when: (flight) => flight.altitude < LOW,
  },
  // Last, because it is the only one you can put off. Out of wing is a slow
  // problem: it means the flapping has been paid for and the way to stop
  // paying is to stop hurrying. The bar in the corner goes red at the same
  // mark, so the words and the picture say it together.
  {
    keys: ['B'],
    text: 'Slow down!',
    when: (flight) => flight.stamina < TIRED,
  },
];

/**
 * Whichever warning the flight is in, or null. The first that applies.
 *
 * `teaching` is the tutorial: with it off, only the ones marked `always`
 * survive, which is the difference between a game explaining flying and a
 * game telling you your wing has stopped working.
 */
export const warningFor = (teaching: boolean, flight: Flying): Tip | null =>
  WARNINGS.find((warning) => (warning.always || teaching) && warning.when(flight)) ?? null;

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
   * flown so far, the time since the last call, and a way to ask whether a
   * key is down.
   *
   * A lesson the player is already following is a lesson they do not need on
   * screen: pressing one of the keys it shows takes it away at once. Which
   * is also the shortest way to find out that it worked.
   */
  update(travelled: number, dt: number, down?: (codes: readonly string[]) => boolean): Tip | null;
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
    update(travelled, dt, down) {
      if (showing && down?.(codesFor(showing))) {
        // Used, so it has said what it had to say. The pause still runs, so
        // the next lesson does not arrive on the same keystroke.
        showing = null;
        resting = true;
        left = rest;
        return null;
      }

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
