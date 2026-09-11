/**
 * How much is going on, as a number from one to five.
 *
 * The music reads this and nothing else. It does not know about crows or
 * flocks or trains -- it knows that things are at a three -- which is what
 * lets the rules below be changed without touching a note, and the music be
 * changed without touching a rule.
 *
 * `MUSIC.md` is the specification: every rung is written out there in words,
 * and a test fails if the two stop naming the same ones. The order below is
 * the order they are tried in, loudest first, and the first that applies is
 * the answer -- so a bird with crows locked on is at five however slowly it
 * is flying.
 */

/** Everything the rungs are decided on, read off the game once a frame. */
export interface Situation {
  /** In the air, rather than standing on something. */
  aloft: boolean;
  /** Metres a second. */
  airspeed: number;
  /** Metres a second up; negative sinking. */
  climb: number;
  /** Metres above the ground. */
  altitude: number;
  /** What is left in the wings, 0 to 1. */
  stamina: number;
  /** 0 to 1; low after being hit or when hungry. */
  health: number;
  /** How many of the flock are in the air with him. */
  flock: number;
  /** Metres to the nearest crow that is up, or null on a level without them. */
  crow: number | null;
  /** A crow has picked him out and is coming. */
  lockedOn: boolean;
  /** Down after being hit, or flown into something: the fall. */
  falling: boolean;
  /** The flock at work on the cage, which is the story's climax. */
  rescuing: boolean;
}

export type Intensity = 1 | 2 | 3 | 4 | 5;

export interface Rung {
  /** Named as `MUSIC.md` names it. */
  id: string;
  level: Intensity;
  applies(now: Situation): boolean;
}

/** Eighty kilometres an hour, which is where flying stops being cruising. */
export const FAST = 80 / 3.6;
/** A dive rather than a descent: faster down than a pigeon glides. */
export const DIVING = -7;
/** A crowd rather than company. */
export const BIG_FLOCK = 10;
/**
 * Near enough that a crow is a problem coming rather than scenery.
 *
 * Two hundred metres, against the hundred at which a crow notices you: this
 * is the stretch where they are in sight and circling and have not yet
 * decided, which is the stretch the music is for.
 */
export const CROWS_NEAR = 200;
/** Close to the rooftops, where a mistake at speed is a wall. */
export const LOW = 25;
/** Nearly spent: the wings are about to stop being an option. */
export const SPENT = 0.2;
/** Hurt enough that one more hit is the last. */
export const HURT = 0.35;

export const RUNGS: readonly Rung[] = [
  // --- Five: something is trying to kill him ------------------------------
  { id: 'lockedOn', level: 5, applies: (s) => s.lockedOn && s.aloft },
  { id: 'falling', level: 5, applies: (s) => s.falling },

  // --- Four: danger in sight -----------------------------------------------
  { id: 'crowsNear', level: 4, applies: (s) => s.aloft && s.crow !== null && s.crow <= CROWS_NEAR },
  { id: 'rescue', level: 4, applies: (s) => s.rescuing },
  { id: 'hurtAndSpent', level: 4, applies: (s) => s.aloft && s.health < HURT && s.stamina < SPENT },

  // --- Three: a lot going on ------------------------------------------------
  { id: 'bigFlock', level: 3, applies: (s) => s.aloft && s.flock > BIG_FLOCK },
  { id: 'fastAndLow', level: 3, applies: (s) => s.aloft && s.airspeed > FAST && s.altitude < LOW },
  { id: 'spent', level: 3, applies: (s) => s.aloft && s.stamina < SPENT },

  // --- Two: some intensity --------------------------------------------------
  { id: 'fast', level: 2, applies: (s) => s.aloft && s.airspeed > FAST },
  { id: 'diving', level: 2, applies: (s) => s.aloft && s.climb < DIVING },

  // --- One: flying around, and everything else ------------------------------
  { id: 'calm', level: 1, applies: () => true },
];

/** The first rung that applies, which is the loudest. */
export function intensityOf(now: Situation): Rung {
  return RUNGS.find((rung) => rung.applies(now)) ?? RUNGS[RUNGS.length - 1]!;
}
