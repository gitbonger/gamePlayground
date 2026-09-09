import { read, type Words } from '../i18n';
import { drawIcon, type IconName } from './icons';

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
  text: Words;
  /**
   * The picture that goes with it, on the left of the words.
   *
   * Optional in the type and given everywhere in practice. A tip without one
   * simply has no picture, which is better than a wrong picture -- and it
   * means adding an instruction never breaks the build over artwork.
   */
  icon?: IconName;
  /**
   * What kind of thing this is, which decides its colour and its sound.
   *
   * The panel says one thing at a time and the player is flying: what they
   * get before they have read a word is a colour and a note, and those have
   * to be worth something. So `survival` is the ones that end the flight if
   * ignored, `story` is the game talking, and `hint` is everything else --
   * and a player who learns one sound learns the only one that matters.
   *
   * Left out, it is a hint. That is the right default: an instruction nobody
   * has thought about is not an emergency.
   */
  sort?: 'survival' | 'story' | 'hint';
  /**
   * Sounded rather than spoken.
   *
   * For the one thing that is actively hunting you. Reading `A varjak rád
   * álltak!` out loud takes most of a second and has to finish before the
   * next thing can be said; two tones take a fifth of that and say the same
   * thing, which is *now*. See `createAlarm`.
   */
  beep?: boolean;
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
    { at: 80, keys: ['→'], text: { en: 'Try right!', hu: 'Próbáld jobbra!' }, icon: 'turnRight', sort: 'hint' },
    { at: 120, keys: ['←'], text: { en: 'Try left!', hu: 'Próbáld balra!' }, icon: 'turnLeft', sort: 'hint' },
  ],
  // The one thing about this world that cannot be worked out by looking at
  // it: foliage is not solid and everything else is. Said thirty metres in,
  // which is where the park thins out and the first roofs come up, and said
  // without a key because it is not a control -- it is the rule the next
  // eight hundred metres are flown under.
  'Teleki tér': [
    { at: 30, keys: [], text: { en: 'Fly through trees. Avoid buildings and vehicles.', hu: 'Repülj a fák között. Kerüld a házakat és a járműveket.' }, icon: 'trees', sort: 'hint' },
    // Not an instruction at all: the market he was sent for, named as it
    // comes up. The panel has been telling him how to fly for two levels, so
    // it is worth its saying something that is only the story now and then.
    { at: 150, keys: [], text: { en: 'Approaching Teleki tér', hu: 'Közeledsz a Teleki térhez' }, icon: 'arriving', sort: 'story' },
    // And the last of them, counted from the other end of the flight: the
    // hard part of this game is arriving, and this is the sentence that says
    // the arriving has started.
    { within: 200, keys: [], text: { en: 'Land near the arrow!', hu: 'Szállj le a nyíl közelében!' }, icon: 'land', sort: 'story' },
    // And the point of the whole errand, said once the feet are down. No key,
    // because there is nothing to press: walking onto grain is what eating
    // grain looks like. Said aloud as well, which most lessons are not --
    // this is the one thing the level cannot be finished without.
    //
    // "Collect some seeds!" rather than "eat the seeds to restore your
    // health": the second is what it does and the first is what to do, and
    // the panel is for what to do. What it costs is the *why*, which the
    // player gets anyway from the bar in the corner going up as they walk.
    { landed: true, keys: [], text: { en: 'Collect some seeds!', hu: 'Szedj össze pár magot!' }, icon: 'seeds', sort: 'story', spoken: true },
  ],
  // Fifty metres out of the square, which is three or four seconds: long
  // enough to have got the wings working and short enough that the warning
  // arrives before the trouble does.
  //
  // Not a control and not a caution -- the flight is fine, and nothing about
  // the bird's own state says so. It is the one thing on this route that the
  // player could not have worked out by looking, which is exactly what a
  // one-off is for. Said aloud, because it is about staying alive.
  'Népszínház': [{ at: 50, keys: [], text: { en: 'Crows! Fly low!', hu: 'Varjak! Repülj alacsonyan!' }, icon: 'crow', sort: 'survival', spoken: true }],
  // Three of them, all spoken, which is more than any other level has and more
  // than the rule here usually allows -- see `spoken`. They are asked for as
  // life-saving, and on this level that is arguable: it is the one flown out
  // of the crows, a crow that touches the bird ends the run, and none of the
  // three is a thing the player could work out by looking.
  //
  // Thirty metres in and then every fifty: that is two or three seconds
  // apart at the speed this level is flown at, which is faster than a lesson
  // can be read. They queue rather than interrupting each other, so the last
  // of them arrives well after the two hundred metres it is written at.
  'Blaha': [
    { at: 30, keys: [], text: { en: 'Keep high!', hu: 'Maradj magasan!' }, icon: 'high', sort: 'survival', spoken: true },
    { at: 100, keys: [], text: { en: 'Mind the crows!', hu: 'Vigyázz a varjakkal!' }, icon: 'crow', sort: 'survival', spoken: true },
    { at: 150, keys: [], text: { en: 'Keep fast!', hu: 'Tartsd a tempót!' }, icon: 'speed', sort: 'survival', spoken: true },
  ],
  /**
   * The long one, and the only level that is taught as a technique.
   *
   * A thousand and fifty-seven metres from a hundred and fifty up is seven to
   * one against a pigeon's measured best of about five and a half, so it
   * cannot be glided -- and the crows are five hundred and ninety-eight
   * metres out, which is most of the way there. What gets a pigeon past them
   * is not flapping harder: it is height traded for speed, which is the one
   * thing this game's flight model rewards and the one thing nothing has said
   * out loud yet.
   *
   * So the four of them are a sentence: get up, trade it, use it, keep it.
   * Spaced to be finished before the crows, which is what the numbers are
   * doing -- and they queue, so the last of them arrives later than the four
   * hundred metres it is written at. That is the intended reading: `keep
   * speed above 100` should land about when the crows do.
   *
   * All spoken. This is the level the whole search has been going towards and
   * the one where a player who misses an instruction flies it again.
   */
  'The Loft': [
    { at: 10, keys: [], text: { en: 'Fly above 150!', hu: 'Szállj 150 fölé!' }, icon: 'high', sort: 'survival', spoken: true },
    {
      at: 130,
      keys: [],
      text: { en: 'Descend to gain speed!', hu: 'Ereszkedj a sebességért!' },
      icon: 'descend',
      sort: 'survival',
      spoken: true,
    },
    {
      at: 260,
      keys: [],
      text: { en: 'Outfly the crows!', hu: 'Hagyd le a varjakat!' },
      icon: 'crow',
      sort: 'survival',
      spoken: true,
    },
    {
      at: 400,
      keys: [],
      text: { en: 'Keep speed above 100!', hu: 'Tartsd 100 felett!' },
      icon: 'speed',
      sort: 'survival',
      spoken: true,
    },
    // And the arrival. Every other level gets this from the approach coaching
    // -- see `approachFor` -- which this one has switched off along with the
    // rest of the tutor, so it says it itself. The key does the saying: the
    // panel draws a cap with `B` on it and the words carry on from there,
    // which is how the rest of them read too.
    {
      within: 220,
      keys: ['B'],
      text: { en: 'to brake!', hu: 'a fékezéshez!' },
      icon: 'brake',
      sort: 'survival',
      spoken: true,
    },
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
  'Fiumei út': [{ at: 50, keys: [], text: { en: 'Chill, no crows here', hu: 'Nyugi, itt nincs varjú' }, icon: 'safe', sort: 'hint' }],
  // The last level, and the only target in the game that will not wait for
  // you. Three things, and none of them is a control: they are the rules of
  // the one landing that is different from every other landing.
  'Keleti': [
    // Spoken: there is no version of this level that is finished on the
    // ground beside the train.
    { at: 50, keys: [], text: { en: 'You need to land on the train!', hu: 'A vonatra kell leszállnod!' }, icon: 'train', sort: 'survival', spoken: true },
    // And spoken, because it is the one that can kill. A rake running at
    // eleven metres a second that reaches the end of its line comes back the
    // other way, and being caught by something already moving is fatal --
    // it is its own crash cause.
    {
      at: 100,
      keys: [],
      text: { en: "Careful, it's changing directions!", hu: 'Vigyázz, irányt vált!' },
      icon: 'careful',
      sort: 'survival',
      spoken: true,
    },
    // Not spoken, and the difference is the rule: put down on the wrong
    // wagon and you are standing on a moving train with the right one a few
    // metres away, which costs a walk. Missing this one is not fatal and
    // does not end the level, so it stays on the screen where something can
    // be ignored without the voice being spent on it.
    { at: 150, keys: [], text: { en: 'Only land at the marked car!', hu: 'Csak a megjelölt kocsira szállj!' }, icon: 'train', sort: 'story' },
  ],
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
   * Said once and then not again.
   *
   * For the one of these that is really a lesson rather than a warning: out
   * of wing is a slow problem with a control attached to it, and the control
   * is the point. Told about the brake at the moment the brake would help,
   * you have been told about the brake -- and hearing it again every time the
   * bar dips is nagging rather than teaching.
   *
   * Once per level, not once per game. A death restarts the level, and a
   * player who died is exactly the player who wants it again.
   */
  once?: boolean;
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
  // The stall used to come first here, on the grounds that it is the only one
  // already happening rather than about to. It is gone: `Nose down!` fired
  // whenever the wing was past its angle, which on a pigeon being flown
  // properly is most of a hard turn, and a warning that goes off while you are
  // doing the right thing teaches you to ignore warnings.
  //
  // The recovery is unchanged -- see `recover` in the flight model. What has
  // gone is the caption on it.
  //
  // Slow first, then, and there is still a reason for the order. Low *and*
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
    text: { en: 'Keep flapping!', hu: 'Csapkodj tovább!' }, icon: 'flap', sort: 'survival',
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
    text: { en: 'Pull up!', hu: 'Húzd fel!' }, icon: 'pullUp', sort: 'survival',
    spoken: true,
    when: (flight) => flight.altitude < LOW && flight.climb < 0,
  },
  // Last, because it is the only one you can put off -- and the only one that
  // is a lesson rather than a warning.
  //
  // Out of wing is a slow problem: the flapping has been paid for, and the
  // way to stop paying is to stop hurrying. There is a key for that and a
  // player who has never needed it has never pressed it, so the words name
  // it. It used to say `Slow down!`, which is the symptom, and the symptom
  // was already being said by the bar in the corner going red at the same
  // mark.
  //
  // Said once. See `once`.
  {
    keys: ['B'],
    text: { en: 'Try the brakes!', hu: 'Próbáld a féket!' }, icon: 'brake', sort: 'survival',
    once: true,
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
export const approachFor = (teaching: boolean, flight: Approaching): Tip | null => {
  // Nothing where the game has stopped explaining itself. This is the tutor
  // by another name -- four instructions about which key to press and when --
  // so a level that says it teaches nothing should not be handing them out at
  // the one moment the player is busiest. `teaches` used to mean two
  // different things depending on which panel was asking.
  if (!teaching) return null;
  if (flight.toGo > APPROACH) return null;

  // Too high to get down in the room that is left. A pigeon glides about six
  // to one, so a third of the distance is a steep but flyable slope, and more
  // than that has to be lost rather than flown off.
  if (flight.altitude > flight.toGo / 3)
    return { keys: ['↑'], text: { en: 'Lose some height', hu: 'Ereszkedj lejjebb' }, icon: 'descend', sort: 'survival', spoken: true };
  // Too fast to put down, which is what the brake is for: wings spread and a
  // backwards beat.
  if (flight.fast) return { keys: ['B'], text: { en: 'Brake to slow down', hu: 'Fékezz a lassításhoz' }, icon: 'brake', sort: 'survival', spoken: true };
  // Down to roof height and still coming down hard. Beating arrests a sink in
  // a way that pulling the nose up at this height does not.
  if (flight.sinking && flight.altitude < 12)
    return { keys: ['SPACE'], text: { en: 'Beat to soften it', hu: 'Csapkodj, hogy puhább legyen' }, icon: 'flap', sort: 'survival', spoken: true };
  // Low, slow and settling: the last thing, and a moment rather than a state.
  //
  // "Flare" is the word for it and the word is no use here: it is aviation
  // vocabulary, this game teaches nobody any, and an instruction whose verb
  // has to be looked up arrives too late. It says "Pull up!" -- the same
  // three words the caution uses, on purpose. It is the same key doing the
  // same thing to the same bird, and one phrase learned once is worth more
  // than two phrases distinguishing an emergency from a landing that the
  // player is equally busy in either way.
  if (flight.altitude < 6) return { keys: ['↓'], text: { en: 'Pull up!', hu: 'Húzd fel!' }, icon: 'pullUp', sort: 'survival', spoken: true };
  return { keys: ['B'], text: { en: 'Brake, then pull up', hu: 'Fékezz, aztán húzd fel' }, icon: 'brake', sort: 'survival', spoken: true };
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

export interface Warner {
  /** Whichever caution the flight has earned, or null. */
  warn(teaching: boolean, flight: Flying): Tip | null;
  /** Forget what has been said. A level starting is a fresh start. */
  reset(): void;
}

/**
 * `cautionFor`, with a memory for the ones that are only said once.
 *
 * The rule itself stays a pure function -- which is what a test wants of it --
 * and the remembering lives here, the same way the lessons keep theirs in
 * `createTutor` rather than in the list they come from.
 */
export function createWarner(): Warner {
  const said = new Set<Caution>();
  return {
    warn(teaching, flight) {
      const found = CAUTIONS.find(
        (caution) =>
          (caution.always || teaching) &&
          !(caution.once && said.has(caution)) &&
          caution.when(flight),
      );
      if (!found) return null;
      if (found.once) said.add(found);
      return found;
    },
    reset() {
      said.clear();
    },
  };
}

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
      // The lesson itself, not a copy of two of its fields.
      //
      // It used to be rebuilt as `{ keys, text }`, which dropped `spoken` --
      // so every lesson in the game that asked to be said aloud was silent,
      // including `Crows! Fly low!`, which is the one on the whole route that
      // the player could not have worked out by looking. The extra fields a
      // `Lesson` carries over a `Tip` are what triggered it, and nothing
      // downstream reads them.
      showing = next;
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

/**
 * How long an instruction stays up once it has arrived, in seconds.
 *
 * Three. It used to be seven, which was the right number for a corner that
 * showed one thing at a time: an instruction that was replaced the moment the
 * next one arrived had to earn its place by staying. Now that they stack, a
 * long life is what fills the screen, and three is about as long as a thing
 * has to be up to be read while flying.
 */
export const HELD = 3;

/**
 * How many may be up at once.
 *
 * Three. Not a screenful, which is what a stack with no limit becomes the
 * first time the bird is low, slow, tired and being chased -- four warnings
 * and a lesson, and the player reads none of them. The fourth pushes the
 * oldest off the top, so what is on screen is always the most recent three
 * things the game had to say.
 */
export const STACKED = 3;

/**
 * The instructions that are up, oldest first.
 *
 * The corner used to show exactly one thing, chosen by a chain of `??` --
 * which meant that everything below the winner was not late, it was *never
 * said*. A crow closing while the wings ran out said "crows"; the stamina was
 * simply never mentioned. Stacking is the fix, and it changes what has to be
 * decided: not which one instruction wins, but how long each of them stays
 * and how many may be up together.
 *
 * An instruction is kept for `held` seconds, and for as long after that as it
 * is still being offered. That second half is what keeps a caution honest: a
 * warning about the ground is true until the ground stops being a problem,
 * and one that timed out while it was still true would blink off and on.
 */
export interface TipStack {
  /**
   * Offer everything that applies now, and get back what to show.
   *
   * Order matters on the way in and only on the way in: the first time two
   * arrive in the same frame, the earlier of them is the older of the two.
   * Nulls are allowed and ignored, so a caller can hand over a list of maybes
   * without filtering it first.
   */
  update(offered: readonly (Tip | null)[], now: number): readonly Tip[];
  /** Clear it, for a flight that is starting again. */
  reset(): void;
}

/**
 * What makes two instructions the same instruction.
 *
 * The words in English rather than in the language being played, so that
 * pressing TAB mid-flight does not turn one instruction into two -- and the
 * icon and keys as well, because `Fly low!` beside a crow and `Fly low!`
 * beside a rooftop would be two different things to do.
 */
const sameTip = (tip: Tip): string => `${tip.icon ?? ''}|${tip.keys.join('+')}|${tip.text.en}`;

export function createTipStack(held = HELD, most = STACKED): TipStack {
  interface Up {
    tip: Tip;
    at: string;
    /** When it arrived, and when it was last still true. */
    arrived: number;
    offered: number;
  }
  let up: Up[] = [];

  return {
    update(offered, now) {
      for (const tip of offered) {
        if (!tip) continue;
        const at = sameTip(tip);
        const already = up.find((each) => each.at === at);
        if (already) {
          // The same thing, still true. It keeps the place it has had rather
          // than jumping to the bottom of the stack every frame.
          already.offered = now;
          already.tip = tip;
          continue;
        }
        up.push({ tip, at, arrived: now, offered: now });
      }
      // Gone once it has had its time, unless it is still true.
      up = up.filter((each) => now - each.arrived < held || each.offered >= now);
      // And never more than a screenful: the oldest goes first, which is the
      // one the player has had the longest to read.
      if (up.length > most) up = up.slice(up.length - most);
      return up.map((each) => each.tip);
    },
    reset() {
      up = [];
    },
  };
}

export interface TipPanel {
  /**
   * Show a tip, or pass null to take the panel away.
   *
   * `clearOf` is how many pixels of something else are stacked at the bottom
   * of the screen -- the conversation card, in practice -- and the panel
   * lifts itself over them. Passed in rather than looked up, because a panel
   * that goes hunting through the page for another panel is two panels that
   * cannot be moved independently.
   */
  show(tips: readonly Tip[], clearOf?: number): void;
  dispose(): void;
}

export function createTipPanel(container: HTMLElement): TipPanel {
  const root = document.createElement('div');
  root.className = 'tip';
  root.hidden = true;
  container.appendChild(root);

  /** What is on screen, so an unchanged stack is not rebuilt every frame. */
  let showing: string | null = null;

  /** One instruction, as a row of the stack. */
  function draw(tip: Tip): HTMLElement {
    // The colour says what kind of thing this is before a word of it has been
    // read: see `Tip.sort`. On the row rather than on the stack, now that
    // there is more than one row and they need not be the same kind.
    const row = document.createElement('div');
    row.className = `tip-row tip-${tip.sort ?? 'hint'}`;

    // The picture first, on the left, because it is the part that is read
    // without reading -- and it is the same picture in both languages.
    if (tip.icon) row.appendChild(drawIcon(tip.icon));

    for (const key of tip.keys) {
      const cap = document.createElement('b');
      cap.className = 'tip-key';
      cap.textContent = key;
      row.appendChild(cap);
    }

    const said = document.createElement('span');
    said.className = 'tip-text';
    said.textContent = read(tip.text);
    row.appendChild(said);
    return row;
  }

  return {
    show(tips, clearOf = 0) {
      // Lifted over whatever is standing at the bottom. Nought puts it back
      // where the stylesheet asks for it, which is under the bird.
      root.style.marginBottom = clearOf > 0 ? `${clearOf + 18}px` : '';
      // The words rather than the tips, so the same instructions in a language
      // that has just been swapped count as a different thing to show.
      const wanted = tips
        .map((tip) => `${tip.icon ?? ''} ${tip.keys.join('+')} ${read(tip.text)}`)
        .join('\n');
      if (wanted === showing) return;
      showing = wanted;

      root.hidden = tips.length === 0;
      root.replaceChildren(...tips.map(draw));
    },
    dispose() {
      root.remove();
    },
  };
}
