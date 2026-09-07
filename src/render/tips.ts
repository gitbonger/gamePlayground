/**
 * One instruction at a time, under the bird: the keys, and what they do.
 *
 * The controls used to be a block of a dozen lines in the top left, which is
 * a reference card rather than teaching -- read once, at the moment the
 * player knows least about what any of it means, and then scenery. This is
 * the other way round: one thing, at the moment that thing is the thing to
 * do.
 *
 * A tip is some keys and a few words, and it says nothing the panel it sits
 * under already says. The keycap is a picture of the key, so "press" is a
 * word the text does not have to spend.
 *
 * ## The three kinds, which is the whole design
 *
 * **Cautionary.** A danger that is imminent, said every single time it is:
 * pull up, keep flapping, nose down, slow down. It is not teaching and it
 * does not get used up -- the twentieth time you are about to fly into the
 * ground you want telling as much as the first. They watch the flight, they
 * last exactly as long as the state that caused them, and all but the stall
 * stop once the game has stopped teaching, because a pigeon spends half its
 * life low, slow and tired on purpose. They live in `CAUTIONS` here.
 *
 * **Command.** What to do *now*, in a situation the game has put you in: the
 * take-off at the end of a conversation, the walking keys on a roof, the
 * things to do in the last hundred and fifty metres of an approach. Context
 * rather than danger, and it stays up while the context does. It outranks a
 * caution, because a situation the game has arranged is more definite than a
 * risk it has noticed. These live in `main.ts`, since what they depend on is
 * the state of the game rather than the state of the flight.
 *
 * **One-off.** A thing worth trying once, offered when there is room to try
 * it: turn right, turn left. Given once, and belonging to the level that
 * teaches it -- so a death repeats it and a later level never sees it again.
 * That last part is the whole reason they are keyed by level below rather
 * than being one list the game works through: the flight that teaches
 * turning is the one long empty flight, and being told to try turning while
 * threading a goods yard would be the game talking over itself. They live in
 * `COURSES` here.
 *
 * The order between them is fixed and it is that order: command, caution,
 * lesson. What the game has arranged, then what the flight is in the middle
 * of, then what there is spare attention for.
 */

export interface Tip {
  /** The keys to press, in the order they are shown. */
  keys: readonly string[];
  /** What pressing them does, as an instruction rather than a description. */
  text: string;
  /**
   * Whether this one is worth saying out loud.
   *
   * Most are not. A voice that reads every instruction is a voice you turn
   * off, and then it is not there for the one that mattered -- so it says
   * only what is about to go wrong or what the flight cannot continue
   * without. Everything else is on the screen, where something can be
   * ignored without being silenced.
   *
   * The test, when adding one: what happens if the player does not read it?
   * If they die, or the level cannot be finished, it is spoken. If they miss
   * a nicety or find out a second later, it is not. A danger is not the same
   * thing as a resource running down -- the stall, the sink and the crows are
   * spoken; the stamina warning is not, because a red bar is already saying
   * it and there are seconds in hand.
   */
  spoken?: boolean;
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
  /**
   * Metres flown in this level before it is offered.
   *
   * Distance flown is the measure of the *player*: twenty metres of flying is
   * twenty metres of flying whether it took two seconds or twenty, and
   * somebody still working out which way is up has not covered it yet.
   */
  at?: number;
  /**
   * Or metres still to fly, offered once the target is that near.
   *
   * The other end of the same flight. Some things are about how far you have
   * come and some are about what is coming up, and an instruction about
   * landing is the second sort however long the flight was.
   */
  within?: number;
  /**
   * Or once the bird is on its feet, whatever distance either end says.
   *
   * The third way a lesson comes round, and it is not a distance at all: some
   * things are worth saying at the moment the flying stops. Landing is a
   * place in the level rather than a point along it -- a player who overshot
   * and came back has flown further than one who got it right, and both have
   * just landed.
   */
  landed?: boolean;
}

/** How far this flight has come, and how far it has left. */
export interface Progress {
  flown: number;
  toGo: number;
  /** Whether the bird is on its feet, for the lessons that wait for that. */
  landed?: boolean;
}

/**
 * The lessons, in the order the flight teaches them.
 *
 * One so far. They are given once each per run and forgotten on a death: the
 * player who has just flown into a building is the player who most wants to
 * be told again, and the one who never crashes never sees a repeat.
 */
export const COURSES: Record<string, readonly Lesson[]> = {
  // Turning, one side at a time, and not straight away: eighty metres is five
  // or six seconds of flying, which is long enough to have stopped thinking
  // about staying up. Nothing about this flight demands a turn -- the target
  // is straight ahead down half a kilometre of empty park -- which is exactly
  // what makes it the flight to be asked on. The cost of getting it wrong is
  // a few seconds of going the wrong way over some trees.
  'Temető': [
    { at: 80, keys: ['→'], text: 'Try right!' },
    { at: 120, keys: ['←'], text: 'Try left!' },
  ],
  // The one thing about this world that cannot be worked out by looking at
  // it: foliage is not solid and everything else is. Said thirty metres in,
  // which is where the park thins out and the first roofs come up, and said
  // without a key because it is not a control -- it is the rule the next
  // eight hundred metres are flown under.
  'Teleki tér': [
    { at: 30, keys: [], text: 'Fly through trees. Avoid buildings and vehicles.' },
    // Not an instruction at all: the market he was sent for, named as it
    // comes up. The panel has been telling him how to fly for two levels, so
    // it is worth its saying something that is only the story now and then.
    { at: 150, keys: [], text: 'Approaching Teleki tér' },
    // And the last of them, counted from the other end of the flight: the
    // hard part of this game is arriving, and this is the sentence that says
    // the arriving has started.
    { within: 200, keys: [], text: 'Land near the arrow!' },
    // And the point of the whole errand, said once the feet are down. No key,
    // because there is nothing to press: walking onto grain is what eating
    // grain looks like. Said aloud as well, which most lessons are not --
    // this is the one thing the level cannot be finished without.
    { landed: true, keys: [], text: 'Eat the seeds to restore your health!', spoken: true },
  ],
  // Fifty metres out of the square, which is three or four seconds: long
  // enough to have got the wings working and short enough that the warning
  // arrives before the trouble does.
  //
  // Not a control and not a caution -- the flight is fine, and nothing about
  // the bird's own state says so. It is the one thing on this route that the
  // player could not have worked out by looking, which is exactly what a
  // one-off is for. Said aloud, because it is about staying alive.
  'Népszínház': [{ at: 50, keys: [], text: 'Crows! Fly low!', spoken: true }],
  // Four of them, all spoken, which is more than any other level has and more
  // than the rule here usually allows -- see `spoken`. They are asked for as
  // life-saving, and on this level that is arguable: it is the one flown out
  // of the crows, a crow that touches the bird ends the run, and none of the
  // four is a thing the player could work out by looking.
  //
  // Thirty metres in and then every fifty: that is two or three seconds
  // apart at the speed this level is flown at, which is faster than a lesson
  // can be read. They queue rather than interrupting each other, so the last
  // of them arrives well after the two hundred metres it is written at.
  'Blaha': [
    { at: 30, keys: [], text: 'Keep high!', spoken: true },
    { at: 100, keys: [], text: 'Mind the crows!', spoken: true },
    { at: 150, keys: [], text: 'Speed above 100', spoken: true },
    { at: 200, keys: [], text: 'Keep fast!', spoken: true },
  ],
  // The other side of the same coin, and the reason it is worth saying: the
  // two levels before this one were flown with crows in the sky, and a player
  // who has just learned to watch for them will go on watching. Fifty metres
  // in, once the flight has settled.
  //
  // Not spoken, and that is the rule rather than an oversight -- see `spoken`
  // above. The voice is for what kills you and what the flight cannot go on
  // without; a player who misses this one finds out by not being attacked,
  // which is the same news a moment later.
  'Fiumei út': [{ at: 50, keys: [], text: 'Chill, no crows here' }],
};

/** What a level teaches, which for most levels is nothing. */
export const courseFor = (level: string): readonly Lesson[] => COURSES[level] ?? [];

/**
 * What the flight looks like from outside, for the tips that watch it.
 *
 * SI, like the simulation: metres and metres per second. A threshold written
 * in km/h would be a threshold about the readout rather than about the air.
 */
export interface Flying {
  altitude: number;
  airspeed: number;
  /** Metres a second up, negative when sinking. */
  climb: number;
  /** What is left in the wings, 0 to 1. */
  stamina: number;
  /** Whether the wing has stopped working, which is not the same as slow. */
  stalled: boolean;
  /**
   * Whether the nose is already up as far as is any use.
   *
   * The angle of attack, near enough to the stall that asking for more of it
   * would take the wing past working rather than get anything out of it. It
   * is the difference between the two answers to sinking: a bird with the
   * nose down still has pitch to spend, and a bird with the nose already up
   * has only its wings.
   */
  noseUp: boolean;
}

/** Below this the bird is running out of air to fly on, in m/s -- 20 km/h. */
const SLOW = 20 / 3.6;
/**
 * Below this, and going down, it is running out of room. In metres.
 *
 * Twenty was too generous by half. A pigeon flying a park at fifteen metres
 * is a pigeon flying a park, and being told to pull up the whole way left no
 * height at all where the game was quiet -- worse, pulling up hard enough to
 * clear the warning stalls the wing, which brings the other one on, which
 * drops you back under twenty. Two cautions taking it in turns.
 *
 * So: ten metres, and only while sinking. Level at eight is a bird flying
 * low; sinking at eight is a bird about to stop flying.
 */
const LOW = 10;
/** And below this, out of wing. A fraction of a full tank. */
const TIRED = 0.3;

/**
 * A tip given while something is true, rather than once at a distance.
 *
 * These are the ones that do not go away by being read. A lesson is offered
 * and taken; a warning is the state of the flight, and it is on screen for
 * exactly as long as the flight is in that state.
 */
export interface Caution extends Tip {
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

export const CAUTIONS: readonly Caution[] = [
  // The stall first, because it is the only one that is already happening
  // rather than about to. The nose has to come down before anything else is
  // worth trying, and the key that brings it down is the up arrow, which is
  // the sort of thing worth a picture of a key.
  {
    keys: ['↑'],
    text: 'Nose down!',
    always: true,
    spoken: true,
    when: (flight) => flight.stalled,
  },
  // Then slow, and this is the whole reason there is an order. Low *and*
  // slow looks like a case for pulling up, and pulling up with no speed is
  // how a bird stalls into the ground it was trying to clear. Wings first,
  // always: flapping is the only control that makes more of both.
  //
  // The second half of that clause is the same argument at the other end. A
  // bird going down with its nose already up cannot pull up -- there is no
  // more nose to give, and asking for it takes the wing past working. So the
  // sinking case splits by what the wing is already doing: pitch while there
  // is pitch to spend, wings once there is not.
  {
    keys: ['SPACE'],
    text: 'Keep flapping!',
    spoken: true,
    when: (flight) =>
      flight.airspeed < SLOW || (flight.noseUp && flight.altitude < LOW && flight.climb < 0),
  },
  // The down key, because the nose follows the key rather than the horizon:
  // down on the keyboard is up in the air, which is the one control nobody
  // guesses right. Reached only with the nose still down, the clause above
  // having taken the rest.
  {
    keys: ['↓'],
    text: 'Pull up!',
    spoken: true,
    when: (flight) => flight.altitude < LOW && flight.climb < 0,
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
 * How the approach is going, for the instructions that talk you down.
 *
 * `fast` and `sinking` are the landing rule's own verdicts rather than
 * thresholds restated here: `landingReadiness` in the simulation answers
 * whether the bird could put down cleanly right now, and what the panel says
 * has to be what the ground will say a moment later.
 */
export interface Approaching {
  /** Metres still to fly to the target. */
  toGo: number;
  altitude: number;
  /** Too fast to put down, by the landing rule. */
  fast: boolean;
  /** Coming down too hard to put down, by the same rule. */
  sinking: boolean;
}

/** Inside this, the flight is an approach and is talked through as one. */
const APPROACH = 150;

/**
 * The last hundred and fifty metres, which is the hard part of this game.
 *
 * Commands rather than cautions: the situation is one the level has arranged
 * -- there is a target in front of you and you are close to it -- and the
 * instruction is what to do about it now. They repeat as often as approaches
 * do, because an approach is exactly the thing you go on getting wrong until
 * you have done enough of them.
 *
 * In order, and the order is the order the mistakes matter in: height cannot
 * be got rid of in the last twenty metres, speed can, and the nose comes up
 * last
 * because it is the only one of them that is a moment rather than a state.
 */
export const approachFor = (flight: Approaching): Tip | null => {
  if (flight.toGo > APPROACH) return null;

  // Too high to get down in the room that is left. A pigeon glides about six
  // to one, so a third of the distance is a steep but flyable slope, and more
  // than that has to be lost rather than flown off.
  if (flight.altitude > flight.toGo / 3)
    return { keys: ['↑'], text: 'Lose some height', spoken: true };
  // Too fast to put down, which is what the brake is for: wings spread and a
  // backwards beat.
  if (flight.fast) return { keys: ['B'], text: 'Brake to slow down', spoken: true };
  // Down to roof height and still coming down hard. Beating arrests a sink in
  // a way that pulling the nose up at this height does not.
  if (flight.sinking && flight.altitude < 12)
    return { keys: ['SPACE'], text: 'Beat to soften it', spoken: true };
  // Low, slow and settling: the last thing, and a moment rather than a state.
  //
  // "Flare" is the word for it and the word is no use here: it is aviation
  // vocabulary, this game teaches nobody any, and an instruction whose verb
  // has to be looked up arrives too late. It says "Pull up!" -- the same
  // three words the caution uses, on purpose. It is the same key doing the
  // same thing to the same bird, and one phrase learned once is worth more
  // than two phrases distinguishing an emergency from a landing that the
  // player is equally busy in either way.
  if (flight.altitude < 6) return { keys: ['↓'], text: 'Pull up!', spoken: true };
  return { keys: ['B'], text: 'Brake, then pull up', spoken: true };
};

/**
 * Whichever caution the flight has earned, or null. The first that applies.
 *
 * `teaching` is the tutorial: with it off, only the ones marked `always`
 * survive, which is the difference between a game explaining flying and a
 * game telling you your wing has stopped working.
 */
export const cautionFor = (teaching: boolean, flight: Flying): Tip | null =>
  CAUTIONS.find((caution) => (caution.always || teaching) && caution.when(flight)) ?? null;

/**
 * Whether a lesson has come round, by whichever end of the flight it counts
 * from. `zero` is how far had been flown when the course started.
 */
const dueAt = (lesson: Lesson, progress: Progress, zero: number): boolean =>
  (lesson.at !== undefined && progress.flown - zero >= lesson.at) ||
  (lesson.within !== undefined && progress.toGo <= lesson.within) ||
  (lesson.landed === true && progress.landed === true);

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
   * Take a course, measured from this much distance already flown.
   *
   * A level's lessons are its own, so changing level changes the course --
   * and the zero moves with it, because a level taken up in mid-air inherits
   * the distance the last one ran up. Without that, a lesson at eighty
   * metres would be a lesson already missed.
   */
  teach(lessons: readonly Lesson[], from: number): void;
  /**
   * The lesson to show now, or null. Called every frame with the distance
   * flown so far, the time since the last call, and a way to ask whether a
   * key is down.
   *
   * A lesson the player is already following is a lesson they do not need on
   * screen: pressing one of the keys it shows takes it away at once. Which
   * is also the shortest way to find out that it worked.
   */
  update(
    progress: Progress,
    dt: number,
    down?: (codes: readonly string[]) => boolean,
  ): Tip | null;
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
  course: readonly Lesson[] = [],
  linger = LINGER,
  rest = REST,
): Tutor {
  let lessons = course;
  /** How far had been flown when this course started. */
  let zero = 0;
  const given = new Set<Lesson>();
  const due = (lesson: Lesson, progress: Progress) => dueAt(lesson, progress, zero);
  let showing: Tip | null = null;
  /** Seconds left of showing this one, or of the pause after it. */
  let left = 0;
  let resting = false;

  return {
    update(progress, dt, down) {
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
      const next = lessons.find((lesson) => !given.has(lesson) && due(lesson, progress));
      if (!next) return null;

      given.add(next);
      showing = { keys: next.keys, text: next.text };
      left = linger;
      return showing;
    },
    teach(next, from) {
      lessons = next;
      zero = from;
      given.clear();
      showing = null;
      resting = false;
      left = 0;
    },
    reset() {
      given.clear();
      showing = null;
      resting = false;
      left = 0;
      zero = 0;
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
