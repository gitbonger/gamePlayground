/**
 * Every instruction the game can give, and the conditions it gives it under.
 *
 * One list, and one shape. It used to be five mechanisms -- a course of
 * lessons keyed by level, a set of cautions watching the flight, a chain of
 * approach rules, a switch of situational commands, and two things written
 * out by hand in `main.ts` -- and each of them had its own idea of when a
 * thing should appear, how long it stayed, and whether it ever came back.
 * That is five places to look when a message shows up at the wrong moment,
 * and no way to say "this one, but not while she is landing".
 *
 * So a message is a `Tip` and two predicates. `when` says whether it applies
 * to the moment it is handed; `done` says whether it has said what it had to
 * say and should go, even though `when` may still be true. Both are asked
 * every frame, of the same record -- see `Moment` -- so a message can be
 * written by reading one type rather than by finding out which mechanism it
 * would have belonged to.
 *
 * The pair is the point. "Keep flapping" applies when the bird is running out
 * of air; it is *done* the moment the player presses the key, because pressing
 * the key is how somebody says they have understood. "Land near the arrow"
 * applies when there is somewhere marked to land and it is close; it is done
 * once the feet are down. Neither of those is a duration, and both of them
 * used to be one.
 *
 * The plain-English version of this file is `MESSAGES.md`, which is the one
 * to edit when a condition is wrong. A test keeps the two in step.
 */

import type { Words } from '../i18n';
import type { IconName } from './icons';

/**
 * Everything a message may ask about the moment it is being asked in.
 *
 * One record rather than four, and deliberately flat: a message is a line of
 * arithmetic over this, and a nested shape would make half of them navigation.
 * Everything is SI, as the simulation is -- a threshold written in km/h would
 * be a threshold about the readout rather than about the air.
 */
export interface Moment {
  // --- Which flight this is ------------------------------------------------
  /** The level's own name, which is what `on` matches against. */
  level: string;
  /**
   * Whether the game is still explaining itself on this level.
   *
   * Off for ten of the fourteen. It gates the messages that teach a control
   * and nothing else: flying into the ground is not a tutorial topic, and a
   * warning about it that stopped after the fourth level would be a warning
   * that stopped exactly where the flying gets hard.
   */
  teaching: boolean;
  /** Seconds since the level began. */
  since: number;

  // --- The flight ----------------------------------------------------------
  altitude: number;
  airspeed: number;
  /** Metres a second up; negative sinking. */
  climb: number;
  /** What is left in the wings, 0 to 1. */
  stamina: number;
  /** Whether the wing has stopped working, which is not the same as slow. */
  stalled: boolean;
  /**
   * Whether the nose is already up as far as is any use.
   *
   * The difference between the two answers to sinking: a bird with the nose
   * down still has pitch to spend, and a bird with the nose already up has
   * only its wings.
   */
  noseUp: boolean;
  /** Metres flown since the level began. */
  flown: number;

  // --- Where it is going ---------------------------------------------------
  /** Metres to whatever finishes the level: a thing, or a line. */
  toGo: number;
  /**
   * Metres to a *marked place to land*, or Infinity where there is none.
   *
   * Not the same as `toGo`, and the difference is what two of these messages
   * turn on. A level that ends at a line has nothing to land on, so nothing
   * should be talking anybody down; and a bird sinking towards a marked roof
   * is doing the thing it was asked to do, so it should not be told to flap.
   */
  landing: number;

  // --- The bird ------------------------------------------------------------
  perched: boolean;
  crashed: boolean;
  /** Walked into something on foot. */
  blocked: boolean;

  // --- What an arrival would cost right now --------------------------------
  /**
   * Too fast to put down: touching the ground now would kill.
   *
   * The landing rule's own verdict rather than a threshold restated here, so
   * what the panel says is what the ground will say a moment later. It is
   * also what keeps `Pull up!` out of an ordinary landing: a bird coming in
   * properly is inside the rule, and being shouted at for doing it right is
   * how a player learns to ignore the shouting.
   */
  tooFast: boolean;
  /** And coming down too hard to put down, by the same rule. */
  tooHard: boolean;

  // --- What is happening to it ---------------------------------------------
  /** A crow has picked him out and is coming. */
  hunted: boolean;

  // --- The story -----------------------------------------------------------
  /** Somebody is waiting for an answer, with the replies on screen. */
  answering: boolean;
  /** Finished talking, and the next thing is to go. */
  leaving: boolean;
  /** A beat is being held: the world is stopped on a line. */
  held: boolean;
  /** Standing with somebody, whether or not there is anything left to say. */
  talking: boolean;
  /** The camera has the shot and the player is an audience. */
  watching: boolean;

  // --- The player ----------------------------------------------------------
  /**
   * Whether any of these keys is down right now.
   *
   * Named as the panel draws them -- `SPACE`, `↓`, `B` -- rather than as the
   * keyboard sends them, so a message that goes away when its own key is
   * pressed is written with the key that is on its own cap. See `codesOf`.
   */
  down(keys: readonly string[]): boolean;
  /** Which way the voice was just switched, if it was, for the note about it. */
  voice: 'on' | 'off' | null;
  /** The language the game is being played in, for the note offering the other. */
  speaking: 'en' | 'hu';
}

export interface Message {
  /**
   * What it is called, here and in `MESSAGES.md`.
   *
   * A name rather than the words, because the words are in two languages and
   * change; this is what a condition is discussed by.
   */
  id: string;
  keys: readonly string[];
  text: Words;
  icon?: IconName;
  sort?: 'survival' | 'story' | 'hint';
  spoken?: boolean;
  beep?: boolean;
  /** The levels it belongs to. Absent: any of them. */
  on?: readonly string[];
  /**
   * Said once a level rather than whenever it applies.
   *
   * For the ones that teach. A control you have been shown is a control you
   * know, and being shown it again every time you happen to fly straight for
   * a while is nagging. Once a *level*, not once a game: a death restarts the
   * level, and a player who died is exactly the one who wants it again.
   */
  once?: boolean;
  /** Whether it applies to this moment. */
  when(at: Moment): boolean;
  /**
   * Whether it has said what it had to say, and should go now.
   *
   * Asked even while `when` is still true, and that is the whole of its use:
   * an instruction the player has just acted on is an instruction that has
   * worked, and leaving it up says the game did not notice.
   */
  done?(at: Moment): boolean;
}

// --- The numbers the conditions are written in -----------------------------

/** Below this the bird is running out of air to fly on, in m/s -- 20 km/h. */
export const SLOW = 20 / 3.6;
/**
 * Below this, and going down, it is running out of room. In metres.
 *
 * Ten. Twenty was too generous by half: a pigeon flying a park at fifteen
 * metres is a pigeon flying a park, and being told to pull up the whole way
 * left no height at all where the game was quiet. Level at eight is a bird
 * flying low; sinking at eight is a bird about to stop flying.
 */
export const LOW = 10;
/** And below this, out of wing. A fraction of a full tank. */
export const TIRED = 0.3;
/**
 * Above this a crow will follow, in metres.
 *
 * The trigger and the safety are the same number: above it a chase starts,
 * below it a crow will not come. So the instruction is exactly the rule.
 */
export const CROW_CEILING = 20;
/** Inside this, the flight is an approach and is talked through as one. */
export const APPROACH = 150;
/**
 * And inside this, there is somewhere to land and it is worth saying so.
 *
 * Wider than the approach, because this one is not coaching -- it is the
 * sentence that says the arriving has started, and it wants to arrive before
 * the coaching does.
 */
export const IN_SIGHT = 200;
/** How long a note about a setting stays up, in seconds. */
export const NOTICE = 2;

/** The levels with crows low enough that the answer is to get under them. */
const CROW_STREETS = ['Népszínház', 'Blaha'] as const;

/**
 * Whether the bird is in the air under its own power.
 *
 * The clause every message about flying needs, and the one they all lacked:
 * a bird standing on a branch has an airspeed of nought and an altitude of
 * eighteen metres, and the first thing the panel said on the opening screen
 * of the game was `Lose some height` -- to a pigeon standing on the ground it
 * was being told to lose height to, in the middle of a conversation.
 */
const aloft = (at: Moment): boolean => !at.perched && !at.crashed;

/**
 * Whether the bird is sinking towards trouble rather than towards a landing.
 *
 * The shared half of the two warnings about the ground, and the clause that
 * keeps them out of an ordinary arrival: a bird coming down over a marked
 * roof is doing what it was asked to do.
 */
const fallingShort = (at: Moment): boolean =>
  aloft(at) && at.altitude < LOW && at.climb < 0 && at.landing > APPROACH;

/**
 * Whether this is an approach: something to land on, and close to it.
 *
 * Shared by the four that talk one down, so they cannot disagree about when
 * an approach has started -- and so none of them can go off over a level that
 * ends at a line, where there is nothing to land on at all.
 */
const arriving = (at: Moment): boolean =>
  aloft(at) && at.teaching && at.landing <= APPROACH;

export const MESSAGES: readonly Message[] = [
  // --- What the game has arranged ------------------------------------------
  {
    id: 'restart',
    keys: ['R'],
    text: { en: 'to restart', hu: 'az újrakezdéshez' },
    icon: 'takeOff',
    sort: 'story',
    // A crash, not any ending: a landing is an ending too, and the thing to
    // press after a good one is the take-off.
    when: (at) => at.crashed,
  },
  {
    id: 'voiceOn',
    keys: ['V'],
    text: { en: 'Voice on', hu: 'Hang be' },
    icon: 'voiceOn',
    spoken: true,
    when: (at) => at.voice === 'on',
  },
  {
    id: 'voiceOff',
    keys: ['V'],
    text: { en: 'Voice off', hu: 'Hang ki' },
    icon: 'voiceOff',
    when: (at) => at.voice === 'off',
  },
  {
    id: 'answer',
    keys: [],
    text: { en: 'Press a number key to respond!', hu: 'Nyomj egy számot a válaszhoz!' },
    icon: 'talk',
    // The replies are on screen with numbers beside them and nothing else
    // says the numbers are keys. A conversation nobody knows how to answer is
    // a game that has stopped.
    when: (at) => at.answering,
  },
  {
    id: 'takeOff',
    keys: ['SPACE'],
    text: { en: 'Take off!', hu: 'Szállj fel!' },
    icon: 'takeOff',
    spoken: true,
    // Leaving a conversation and leaving a beat are the same act: he has
    // finished talking and he is going.
    when: (at) => at.leaving || at.held,
    done: (at) => at.down(['SPACE']),
  },
  {
    id: 'walkRound',
    keys: ['←', '→'],
    text: { en: 'Turn and walk round it', hu: 'Fordulj és kerüld ki' },
    icon: 'walk',
    // About the thing in the way rather than about walking, so it goes as
    // soon as the way is clear.
    when: (at) => at.perched && at.blocked && !at.talking,
  },
  // The one instruction that is deliberately not in the language the game is
  // being played in, because the one person it is for is the one who cannot
  // read the game as it stands. Two of them rather than one with the words
  // turned over, so that the flag beside it is the flag of the language on
  // offer -- the picture and the sentence have to say the same thing.
  //
  // The first ten seconds of the first level, and then never: it is either
  // noticed at the start or it is not wanted.
  {
    id: 'offerHungarian',
    keys: ['TAB'],
    text: {
      en: 'Magyar nyelvért nyomd meg a TAB-ot',
      hu: 'Magyar nyelvért nyomd meg a TAB-ot',
    },
    icon: 'flagHu',
    sort: 'hint',
    once: true,
    when: (at) => at.speaking === 'en' && at.level === 'Nest' && at.since < 10,
  },
  {
    id: 'offerEnglish',
    keys: ['TAB'],
    text: { en: 'Press TAB for English', hu: 'Press TAB for English' },
    icon: 'flagEn',
    sort: 'hint',
    once: true,
    when: (at) => at.speaking === 'hu' && at.level === 'Nest' && at.since < 10,
  },

  // --- The ground ----------------------------------------------------------
  {
    id: 'flap',
    keys: ['SPACE'],
    text: { en: 'Keep flapping!', hu: 'Csapkodj tovább!' },
    icon: 'flap',
    sort: 'survival',
    spoken: true,
    // Wings first, always: flapping is the only control that makes more of
    // both height and speed. The second clause is the same argument at the
    // other end -- a bird going down with its nose already up cannot pull up,
    // so the sinking case splits by what the wing is already doing.
    //
    // And not while there is somewhere marked to land in front of it. A bird
    // coming down over the roof it was sent to is not in trouble, and this is
    // the one warning that would otherwise fire through every arrival.
    when: (at) =>
      aloft(at) &&
      ((at.airspeed < SLOW && at.landing > APPROACH) || (at.noseUp && fallingShort(at))),
    // Pressing the key is how somebody says they have understood.
    done: (at) => at.down(['SPACE']),
  },
  {
    id: 'pullUp',
    keys: ['↓'],
    text: { en: 'Pull up!', hu: 'Húzd fel!' },
    icon: 'pullUp',
    sort: 'survival',
    spoken: true,
    // Reached only with the nose still down, the clause above having taken
    // the rest -- and only where putting down here would actually kill. A
    // bird settling onto a roof inside the landing rule is landing, and being
    // told to pull out of it is the game arguing with itself.
    when: (at) => fallingShort(at) && (at.tooFast || at.tooHard),
    done: (at) => at.down(['↓']),
  },
  {
    id: 'brakes',
    keys: ['B'],
    text: { en: 'Try the brakes!', hu: 'Próbáld a féket!' },
    icon: 'brake',
    sort: 'survival',
    once: true,
    // A lesson rather than a warning, so it goes with the rest of the
    // teaching: out of wing is a slow problem with a control attached, and
    // the control is the point. Told about the brake at the moment the brake
    // would help, you have been told about the brake.
    when: (at) => at.teaching && at.stamina < TIRED,
    done: (at) => at.down(['B']),
  },

  // --- The crows -----------------------------------------------------------
  {
    id: 'crowsLocked',
    keys: [],
    text: { en: 'Crows locked on!', hu: 'A varjak rád álltak!' },
    icon: 'crow',
    sort: 'survival',
    // Sounded rather than spoken: two tones say *now* in a fifth of the time
    // reading the sentence takes.
    beep: true,
    when: (at) => at.hunted && aloft(at),
  },
  {
    id: 'crowsFlyLow',
    keys: [],
    text: { en: 'Crows! Fly low!', hu: 'Varjak! Repülj alacsonyan!' },
    icon: 'crow',
    sort: 'survival',
    spoken: true,
    on: CROW_STREETS,
    // The instruction is the rule: a crow will not follow below twenty, so
    // the warning is exactly "you are above twenty" and the answer to it is
    // exactly "be below twenty". It comes back every time he climbs, because
    // it is true every time he climbs.
    when: (at) => aloft(at) && at.altitude > CROW_CEILING,
    done: (at) => at.altitude <= CROW_CEILING,
  },

  // --- The arrival ---------------------------------------------------------
  {
    id: 'landNearArrow',
    keys: [],
    text: { en: 'Land near the arrow!', hu: 'Szállj le a nyíl közelében!' },
    icon: 'land',
    sort: 'story',
    once: true,
    // Wherever there is something marked to put down on and it is close. The
    // hard part of this game is arriving, and this is the sentence that says
    // the arriving has started.
    when: (at) => aloft(at) && at.landing <= IN_SIGHT,
    // And it is over the moment the feet are down, whatever else is true.
    done: (at) => at.perched,
  },
  {
    id: 'loseHeight',
    keys: ['↑'],
    text: { en: 'Lose some height', hu: 'Ereszkedj lejjebb' },
    icon: 'descend',
    sort: 'survival',
    spoken: true,
    // A pigeon glides about six to one, so a third of the distance is a steep
    // but flyable slope and more than that has to be lost rather than flown
    // off.
    when: (at) => arriving(at) && at.altitude > at.landing / 3,
    done: (at) => at.altitude <= at.landing / 3,
  },
  {
    id: 'brakeToSlow',
    keys: ['B'],
    text: { en: 'Brake to slow down', hu: 'Fékezz a lassításhoz' },
    icon: 'brake',
    sort: 'survival',
    spoken: true,
    // Once the height is right, which is what keeps this off the screen while
    // `loseHeight` is on it: they are two stages of one approach and the
    // player can only be in one of them.
    when: (at) => arriving(at) && at.altitude <= at.landing / 3 && at.tooFast,
    done: (at) => !at.tooFast,
  },
  {
    id: 'beatToSoften',
    keys: ['SPACE'],
    text: { en: 'Beat to soften it', hu: 'Csapkodj, hogy puhább legyen' },
    icon: 'flap',
    sort: 'survival',
    spoken: true,
    // Down to roof height and still coming down hard. Beating arrests a sink
    // in a way that pulling the nose up at this height does not.
    when: (at) => arriving(at) && at.altitude < 12 && at.tooHard,
    done: (at) => !at.tooHard,
  },
  {
    id: 'flare',
    keys: ['↓'],
    text: { en: 'Pull up!', hu: 'Húzd fel!' },
    icon: 'pullUp',
    sort: 'survival',
    spoken: true,
    // The last thing, and a moment rather than a state. The same three words
    // the warning uses, on purpose: it is the same key doing the same thing
    // to the same bird, and one phrase learned once is worth more than two
    // distinguishing an emergency from a landing the player is equally busy
    // in either way.
    //
    // Only once the speed is right. Flaring fast is how a bird arrives fast.
    when: (at) => arriving(at) && at.altitude < 6 && !at.tooFast,
    done: (at) => at.perched,
  },

  // --- What each level has to say for itself -------------------------------
  {
    id: 'tryRight',
    keys: ['→'],
    text: { en: 'Try right!', hu: 'Próbáld jobbra!' },
    icon: 'turnRight',
    sort: 'hint',
    on: ['Temető'],
    once: true,
    // Eighty metres is five or six seconds, which is long enough to have
    // stopped thinking about staying up. Nothing about this flight demands a
    // turn, which is exactly what makes it the flight to be asked on.
    when: (at) => at.flown >= 80,
    done: (at) => at.down(['→']),
  },
  {
    id: 'tryLeft',
    keys: ['←'],
    text: { en: 'Try left!', hu: 'Próbáld balra!' },
    icon: 'turnLeft',
    sort: 'hint',
    on: ['Temető'],
    once: true,
    when: (at) => at.flown >= 120,
    done: (at) => at.down(['←']),
  },
  {
    id: 'trees',
    keys: [],
    text: {
      en: 'Fly through trees. Avoid buildings and vehicles.',
      hu: 'Repülj a fák között. Kerüld a házakat és a járműveket.',
    },
    icon: 'trees',
    sort: 'hint',
    on: ['Teleki tér'],
    once: true,
    // The one thing about this world that cannot be worked out by looking at
    // it: foliage is not solid and everything else is.
    when: (at) => at.flown >= 30,
  },
  {
    id: 'nearingTeleki',
    keys: [],
    text: { en: 'Approaching Teleki tér', hu: 'Közeledsz a Teleki térhez' },
    icon: 'arriving',
    sort: 'story',
    on: ['Teleki tér'],
    once: true,
    when: (at) => at.flown >= 150,
  },
  {
    id: 'seeds',
    keys: [],
    text: { en: 'Collect some seeds!', hu: 'Szedj össze pár magot!' },
    icon: 'seeds',
    sort: 'story',
    spoken: true,
    on: ['Teleki tér'],
    // The point of the whole errand, said once the feet are down. No key,
    // because there is nothing to press: walking onto grain is what eating
    // grain looks like.
    when: (at) => at.perched,
  },
  {
    id: 'keepFast',
    keys: [],
    text: { en: 'Keep fast!', hu: 'Tartsd a tempót!' },
    icon: 'speed',
    sort: 'survival',
    spoken: true,
    on: ['Blaha'],
    once: true,
    when: (at) => at.flown >= 150,
  },
  {
    id: 'flyHigh',
    keys: [],
    text: { en: 'Fly above 150!', hu: 'Szállj 150 fölé!' },
    icon: 'high',
    sort: 'survival',
    spoken: true,
    on: ['The Loft'],
    once: true,
    when: (at) => at.flown >= 10,
  },
  {
    id: 'descendForSpeed',
    keys: [],
    text: { en: 'Descend to gain speed!', hu: 'Ereszkedj a sebességért!' },
    icon: 'descend',
    sort: 'survival',
    spoken: true,
    on: ['The Loft'],
    once: true,
    when: (at) => at.flown >= 130,
  },
  {
    id: 'outflyCrows',
    keys: [],
    text: { en: 'Outfly the crows!', hu: 'Hagyd le a varjakat!' },
    icon: 'crow',
    sort: 'survival',
    spoken: true,
    on: ['The Loft'],
    once: true,
    when: (at) => at.flown >= 260,
  },
  {
    id: 'keepSpeedUp',
    keys: [],
    text: { en: 'Keep speed above 100!', hu: 'Tartsd 100 felett!' },
    icon: 'speed',
    sort: 'survival',
    spoken: true,
    on: ['The Loft'],
    once: true,
    when: (at) => at.flown >= 400,
  },
  {
    id: 'brakeAtLoft',
    keys: ['B'],
    text: { en: 'to brake!', hu: 'a fékezéshez!' },
    icon: 'brake',
    sort: 'survival',
    spoken: true,
    on: ['The Loft'],
    once: true,
    // This level switches the coaching off along with the rest of the
    // teaching, so it says the one thing the arrival needs itself.
    when: (at) => at.toGo <= 220,
    done: (at) => at.down(['B']),
  },
  {
    id: 'noCrows',
    keys: [],
    text: { en: 'Chill, no crows here', hu: 'Nyugi, itt nincs varjú' },
    icon: 'safe',
    sort: 'hint',
    on: ['Fiumei út'],
    once: true,
    // The other side of the same coin: the two levels before this were flown
    // with crows in the sky, and a player who has just learned to watch for
    // them will go on watching.
    when: (at) => at.flown >= 50,
  },
  {
    id: 'landOnTrain',
    keys: [],
    text: { en: 'You need to land on the train!', hu: 'A vonatra kell leszállnod!' },
    icon: 'train',
    sort: 'survival',
    spoken: true,
    on: ['Keleti'],
    once: true,
    when: (at) => at.flown >= 50,
    done: (at) => at.perched,
  },
  {
    id: 'trainTurns',
    keys: [],
    text: { en: "Careful, it's changing directions!", hu: 'Vigyázz, irányt vált!' },
    icon: 'careful',
    sort: 'survival',
    spoken: true,
    on: ['Keleti'],
    once: true,
    when: (at) => at.flown >= 100,
    done: (at) => at.perched,
  },
  {
    id: 'markedCar',
    keys: [],
    text: { en: 'Only land at the marked car!', hu: 'Csak a megjelölt kocsira szállj!' },
    icon: 'train',
    sort: 'story',
    on: ['Keleti'],
    once: true,
    when: (at) => at.flown >= 150,
    done: (at) => at.perched,
  },
];

/** Every message's name, for the document that describes them. */
export const MESSAGE_IDS: readonly string[] = MESSAGES.map((message) => message.id);
