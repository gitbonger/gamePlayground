/**
 * The levels, as data.
 *
 * The map is settled, so a coordinate written here means the same place for
 * good. That is what makes a level something you can describe rather than
 * something you have to build: a point to be released at, an hour to fly it
 * at, a thing to land on and somebody standing on it.
 *
 * No story yet. These are landing problems in increasing order of difficulty,
 * each ending in the same placeholder conversation, and whatever eventually
 * joins them up can be different data in the same shape.
 */

import { CAUGHT, HEADING_OUT, SAVED, THE_ASK, THE_TRAPPER, type Turn } from './dialogue';
import {
  HOME_TREE,
  JANI_SQUARE,
  LOFT,
  MATYAS_SQUARE,
  PARK_PATCH,
  WEST_PATCH,
} from './landmarks';

/**
 * What a level asks you to land on. Always a thing, never a place.
 *
 * Open ground was the awkward case: a wagon and a building are objects with a
 * material each to flash and a top to land on, and a field is a field. Rather
 * than teach the marker about targets that are not things, a level that wants
 * one lays one -- a patch of concrete in the park. Everything downstream then
 * treats all three the same.
 */
export type LevelTarget =
  /**
   * A vehicle of one of the rakes. By index rather than by coordinate,
   * because it will not be where you left it.
   */
  | { kind: 'wagon'; name: string; train: number; car: number | 'middle' }
  /**
   * One of the described things in the world, by name.
   *
   * Referenced rather than described here, so that two levels aiming at the
   * same building are aiming at the same building. The name comes off the
   * landmark itself rather than being written out again, which is a typo
   * that cannot be made.
   */
  | { kind: 'landmark'; name: string };

/** What the marker over a level's target is called. */
export const targetName = (level: Level): string => level.target.name;

/** Who is waiting there. */
export interface LevelPerson {
  /**
   * Which colour scheme to wear, as an index into `CHARACTER_MORPHS`.
   *
   * The crowd's four come first and the ones who are somebody after, so an
   * index past the crowd is a deliberate choice of a particular bird -- which
   * is why the pink one being on exactly one level is a test rather than a
   * convention.
   */
  morph: number;
  /**
   * Where on the target they stand: metres along it and across it.
   *
   * A little off the middle, so that arriving is not the same thing as
   * meeting them and there is a walk in between.
   */
  along: number;
  across: number;
}

/**
 * Somebody the story keeps track of, wherever they happen to be standing.
 *
 * A character is not a level's property. Pink stands on the home tree for the
 * first two levels and on the loft's terrace for the rest, and she is the
 * same bird throughout -- which is the whole reason this exists. Where each
 * of them is *during* a level is the level's `cast`, so a level that is
 * started, lost and started again puts everybody back where that level says
 * they are. There is no state anywhere saying who has moved.
 */
export interface Character {
  /** What the story calls them. */
  name: string;
  /** Which of the renderer's `CHARACTER_MORPHS` they wear. */
  morph: number;
}

/**
 * Everybody the story has, in one list.
 *
 * Four strangers and Pink. The strangers are named after what they look like
 * because that is all there is to them yet: a pigeon standing on the thing a
 * level is about, who says hello.
 */
export const PINK: Character = { name: 'Pink', morph: 4 };
export const CHARACTERS: readonly Character[] = [
  { name: 'Grey', morph: 0 },
  { name: 'Black', morph: 1 },
  { name: 'White', morph: 2 },
  { name: 'Ginger', morph: 3 },
  PINK,
];

export const characterNamed = (name: string): Character | undefined =>
  CHARACTERS.find((who) => who.name === name);

/**
 * Where somebody is standing while a level is being flown.
 *
 * `on` is the same kind of thing a level can be aimed at -- a described
 * landmark or a wagon -- so a character can stand on a roof, on a slab of
 * concrete or on a goods wagon, and the machinery that works out where that
 * is does not care which.
 */
export interface Standing {
  /** Which character, by name. */
  who: string;
  on: LevelTarget;
  /**
   * Where on it, along it and across it, in its own frame.
   *
   * Along and across the thing rather than along and across the world, so
   * turning the building turns whoever is standing on it.
   */
  along: number;
  across: number;
}

/**
 * What finishes a level: the one thing a level cannot be without.
 *
 * There are three ways, and they used to be three optional fields that were
 * understood not to appear together -- which is a shape that says "any of
 * these, or none, or all three" when what is meant is "exactly one of these".
 * A level with a person *and* a crossing was a sentence the types were happy
 * to let anybody write.
 *
 * Two of the three hand the next level over where you stand, so they carry
 * the name of it; the third ends in a conversation, and what happens after a
 * conversation is the conversation's business.
 */
/**
 * What a level that finishes by itself hands over to.
 *
 * Two things it can be, and they are not the same kind of thing at all: the
 * next level, which the player flies, or a scene, which the game flies while
 * the player watches. It was a bare level name until there was a scene to
 * name, and a bare name would have meant two namespaces sharing one string.
 */
export type Opens = { level: string } | { scene: string };

/**
 * A stretch the game plays rather than the player.
 *
 * The one so far is the flight home from Teleki tér: nine hundred metres of
 * park he has already flown twice, ending on the branch he left in the first
 * level -- the same spot, the same heading, the same shot -- with nobody
 * standing opposite him.
 *
 * It is described here with the levels because it is the story between two of
 * them, and because everything it needs is already written down: where it
 * ends is a level, and a level knows where it starts.
 */
export interface Scene {
  name: string;
  /**
   * The level whose opening shot this closes on, if the camera goes anywhere.
   *
   * Stated as a level rather than as a place, so the shot cannot drift from
   * the one the player remembers: move the home tree and both move together.
   *
   * Left out for a beat that happens where the bird already is -- a line said
   * standing on the square he has just landed on. Then there is no move and
   * nothing is placed: the world simply stops and somebody says something.
   */
  endsOn?: string;
  /** How long the camera takes to get there, in seconds. */
  seconds: number;
  /** How high it arcs over the city on the way, in metres. */
  cruise: number;
  /**
   * Whether the shot goes up rather than across.
   *
   * Almost none of them do. A scene is normally a flight between two birds
   * standing on things -- both ends near the ground, the city in between --
   * and the only thing holding the camera over the roofs is `cruise`, which
   * is why an arc is otherwise required.
   *
   * A climb has no such problem and cannot satisfy that rule: an arc on a
   * move which is nearly vertical is a camera wandering off to one side and
   * coming back. Said here rather than worked out, because what decides it is
   * how far the shot travels *horizontally*, and a scene knows where it ends
   * but not where it begins -- that is wherever the thing before it left the
   * bird.
   */
  climbs?: boolean;
  /**
   * What he says over the closing shot, if anything: a monologue.
   *
   * Lines rather than a line, because a monologue is a conversation with one
   * speaker -- it is shown in the same panel, in his own colour, as though he
   * were talking to somebody, which is what he is doing except that nobody is
   * there. That is also the whole of the beat: a man alone on a branch saying
   * where he is going next.
   *
   * Saying something is what makes a scene *hold*: lines the player has not
   * read yet are worth waiting for, so a scene with them puts the bird down
   * in the closing shot and waits for the take-off key, and a scene without
   * any runs straight on into whatever it opens. That is one field doing the
   * work of two, and it is the right one -- there is no such thing as a beat
   * with nothing to say.
   */
  says?: readonly string[];
  /**
   * What follows it: the next scene, or the level it hands over to.
   *
   * The same `Opens` a level's finish uses, so a chapter can be told as a
   * flight, a beat and another flight without any of the three knowing it is
   * in a chain.
   */
  opens: Opens;
}

/**
 * Home, to an empty branch.
 *
 * Five seconds for nine hundred metres, which is nothing like flying and is
 * not meant to be: the camera is not the bird, it is the thing that tells the
 * player where they now are. Sixty metres over the top, because both ends of
 * the move are near the ground -- a bird standing on concrete and a bird
 * standing on a branch -- and the straight line between them runs through
 * most of the eighth district.
 */
export const HOMECOMING: Scene = {
  name: 'flying home',
  endsOn: 'Nest',
  seconds: 5,
  cruise: 60,
  // Said to nobody, on the branch, over an empty nest. It is the first time
  // the hero says anything without somebody to say it to, and it is what
  // turns the empty nest into an errand -- he is not going for help, he is
  // going to look, and the looking is what the next few levels are.
  says: ['OMG! Where did she go?', 'Maybe she is on Mátyás tér.'],
  opens: { scene: 'flying to Mátyás tér' },
};

/**
 * Off to the eighth district to look.
 *
 * Nothing to say, so it does not hold: the take-off that ends the beat at the
 * nest runs straight into this, and this runs straight into the level. What
 * the player sees is one movement -- he leaves the tree, the city goes past,
 * and he is over Népszínház utca with the controls back.
 */
export const TO_MATYAS: Scene = {
  name: 'flying to Mátyás tér',
  endsOn: 'Mátyás tér',
  seconds: 4,
  cruise: 60,
  opens: { level: 'Mátyás tér' },
};

/**
 * The first square, and she is not on it.
 *
 * A beat with nowhere to go: no `endsOn`, so the camera stays where it is and
 * the hero says it standing on the square he has just come down on. The
 * search is going to be a run of these, and the shape of one is: fly there,
 * land, find nothing, name the next place.
 */
export const NOT_AT_MATYAS: Scene = {
  name: 'nobody at Mátyás tér',
  seconds: 0,
  cruise: 0,
  says: ['She is not here.', 'Maybe on Jani Pali tér.'],
  // Into the climb rather than into the level. It used to go straight on --
  // "the next one starts over the square he is standing on, so a camera
  // taking him there would be a camera going nowhere" -- which was true about
  // the ground and wrong about the air: it starts sixty metres over that
  // square, and the player was cut from standing on the paving to hanging
  // above it. There is somewhere to go, and the somewhere is up.
  opens: { scene: 'up off Mátyás tér' },
};

/**
 * Off the square he has just searched, to the height the next one is flown
 * from.
 *
 * A climb, like the one out of Blaha: sixty metres straight up over the same
 * paving, so it has no arc -- an arc on a nearly vertical move is a camera
 * wandering off to one side and coming back. Nothing said over it, so it does
 * not hold; the take-off that ends the beat runs into this and this runs into
 * the level, and what the player sees is one movement.
 */
export const UP_OFF_MATYAS: Scene = {
  name: 'up off Mátyás tér',
  endsOn: 'Jani Pali tér',
  seconds: 2.5,
  cruise: 0,
  climbs: true,
  opens: { level: 'Jani Pali tér' },
};

/**
 * Straight up off the slab, to the height the last leg is flown from.
 *
 * The only scene in the game that goes nowhere. Every other one carries the
 * bird across the city and the camera arcs over the roofs to say so; this one
 * ends sixty-one metres from where it starts and a hundred and fifty metres
 * above it, so what it is is a climb. `cruise: 0` gives it no arc at all --
 * an arc on a move that is almost vertical is a camera wandering off to one
 * side and coming back.
 *
 * It belongs to Blaha rather than to the loft, which is why it is here and
 * not a taller release: the beat is *he has just been told where to go*, and
 * the shot is him getting the height to go there. Three seconds, because the
 * climb is the punctuation and not the scene.
 *
 * Nothing said over it, so it does not hold -- the words were the
 * conversation's, and this runs straight on into the level.
 */
export const UP_TO_THE_ROOFS: Scene = {
  name: 'up to the roofs',
  endsOn: 'The Loft',
  seconds: 3,
  cruise: 0,
  climbs: true,
  opens: { level: 'The Loft' },
};

export const SCENES: readonly Scene[] = [
  HOMECOMING,
  TO_MATYAS,
  NOT_AT_MATYAS,
  UP_OFF_MATYAS,
  UP_TO_THE_ROOFS,
];

export const sceneNamed = (name: string): Scene | undefined =>
  SCENES.find((scene) => scene.name === name);

export type Finish =
  /**
   * Walk up to one of the cast and talk to them.
   *
   * Named rather than described: who it is comes from the level's `cast`,
   * which is also what puts them there. A level cannot be finished by meeting
   * somebody who is not in it.
   */
  | { kind: 'meeting'; who: string; dialogue: Turn }
  /**
   * Cross a line drawn square across the route, through a named point.
   *
   * Stated as the coordinate the stripe passes through rather than as a
   * distance along the way to something else. The distance came first, and it
   * was the wrong way round twice over: it made the line depend on a
   * *target*, so a level whose whole business is a line still had to name a
   * building somewhere beyond it and point an arrow at it -- and it said
   * where the line was in a unit nobody can look at on a map.
   *
   * The stripe runs square across the way in from the release point, which is
   * the same thing as tangent to the circle drawn round it: any path from the
   * release point to the far side crosses the line, however it wanders.
   */
  | { kind: 'crossing'; through: [number, number]; opens: Opens }
  /**
   * Get there and land, and find nothing.
   *
   * The searching kind. The hero is going round the district looking for his
   * mate, and what finishes one of those levels is not meeting anybody -- it
   * is arriving somewhere and her not being there. So there is nobody in the
   * cast to walk up to and no conversation to have: the level is over when
   * the feet are down on the place it named, and what it hands to is the beat
   * where he says so.
   */
  | { kind: 'arrival'; opens: Opens }
  /**
   * Eat until the belly is full.
   *
   * The one that is not about arriving anywhere: the level is the eating.
   * There is nobody standing on the concrete to talk to, because a pigeon
   * that has flown nine hundred metres for food has come for the food.
   */
  | { kind: 'fed'; opens: Opens }
  /**
   * It does not end.
   *
   * The only one of these that is not a condition, and the only level that
   * is not trying to get you anywhere: it is the map with the story finished
   * and nothing left to do on it. There is no target to reach, nobody to
   * walk up to, no line to cross and nothing it opens onto, because there is
   * nothing after it.
   */
  | { kind: 'free' };

/** Whose name finishes the level, if it ends by meeting somebody. */
export const metBy = (level: Level): string | undefined =>
  level.finish.kind === 'meeting' ? level.finish.who : undefined;

/** Where somebody is standing during a level, if they are in it at all. */
export const standingOf = (level: Level, who: string): Standing | undefined =>
  level.cast.find((spot) => spot.who === who);

/** Where the one who finishes the level is standing. */
export const waitingIn = (level: Level): Standing | undefined => {
  const who = metBy(level);
  return who === undefined ? undefined : standingOf(level, who);
};

/** What they say, likewise. */
export const dialogueOf = (level: Level): Turn | undefined =>
  level.finish.kind === 'meeting' ? level.finish.dialogue : undefined;

/** What this one hands over to without being asked, if it does. */
/**
 * Where she is caged on this level, or nothing if she is not.
 *
 * A rule about the story rather than about drawing, which is why it is here:
 * the cage and the bird in it are different things, and the first version of
 * this put a cage wherever she was standing. That is a trap on the nest for
 * the first two levels of the game -- she is on the branch at home then, and
 * nobody has taken anything yet.
 *
 * The trapper's roof is the only place she is in one. She is put there from
 * the level after the errand, which is the story: taken while he was away.
 */
export const cagedIn = (level: Level): Standing | undefined => {
  const hers = standingOf(level, PINK.name);
  if (!hers || hers.on.kind !== 'landmark' || hers.on.name !== LOFT.name) return undefined;
  return hers;
};

export const opensOf = (level: Level): Opens | undefined =>
  // Asked of the shape rather than of the kind. It used to name the one kind
  // that has no `opens`, which is a list that has to be kept in step with the
  // union by somebody remembering to -- and stopped being right the moment a
  // second kind had nothing to open onto.
  'opens' in level.finish ? level.finish.opens : undefined;

export interface Level {
  /** What it is called, on the marker and in the menu. */
  name: string;
  /** Where the pigeon is released, in degrees. */
  start: [number, number];
  /**
   * How high it is released, in metres above the ground.
   *
   * Stated by every level and defaulted by none, because there is no height
   * that is right twice: a hundred metres is a sky drop with the whole
   * approach laid out beneath you, and twenty-three is leaving a tree. Which
   * of those a level is, is the level's own business, and a default would let
   * one be written without anybody deciding.
   *
   * The ground is flat, so this is both a height and an altitude. The one
   * thing that overrides it is something solid underneath -- a release point
   * over a roof is raised clear of the roof, since being released inside a
   * building is not a difficulty, it is a bug.
   */
  release: number;
  /**
   * How full the belly is on arriving, 0 to 1.
   *
   * Stated by every level for the same reason the release height is: there is
   * no figure that is right twice. What makes this one different is that the
   * belly, unlike a position, *carries* -- a level walked into out of the one
   * before it starts with whatever the last one left.
   *
   * So it is a floor rather than a setting. Put here by the menu or by a
   * death, it is exactly this; arrived at from the level before, it is this
   * or what you brought, whichever is more. That takes nothing away from a
   * player who flew the last one well, and it makes sure a player who limped
   * in on nothing is given a level they can still fly rather than one they
   * have already lost.
   */
  health: number;
  /**
   * The moment it is flown at, as an ISO instant.
   *
   * Which is to say where the sun is: the light is worked out from the real
   * solar position at this time over the map's own coordinates, so an hour is
   * a lighting decision that cannot be wrong for the place.
   *
   * It belongs to `start` and travels with it. Both say what happens when you
   * are *put* at this level -- from the menu, on a respawn, or by flying on
   * from the level before -- and a level taken up where you stand, handed over
   * by a conversation, applies neither. You carry on from the branch you were
   * on, at the hour you were standing there.
   */
  when: string;
  target: LevelTarget;
  /**
   * Marks along the way, shown one at a time, as help and nothing else.
   *
   * Optional, unlike the release height and the escort -- and the difference
   * is worth stating, because both of those are required on purpose. Those
   * are decisions about what a level *is*, and a default would let one be
   * made by nobody. These are a hand held out to a player who cannot see
   * where to go: a level without them is a level that does not need them,
   * which is a perfectly ordinary thing for a level to be, and writing
   * `waypoints: []` on eight of them would be nine lines of nothing.
   *
   * Nothing in the story knows about them. Passing the last one does not do
   * anything at all.
   */
  waypoints?: readonly [number, number][];
  /**
   * Whether the flock flies with him on this one.
   *
   * Stated by every level and defaulted by none, for the same reason the
   * release height is: it is a decision about what the level is, and a
   * default would let one be written without anybody making it. Ten pigeons
   * wheeling about is company on a long crossing of a park and it is noise
   * over a district, in among the crows, or on a branch in a conversation.
   */
  escort: boolean;
  /**
   * Whether the wings tire on this level at all.
   *
   * Off everywhere but one. Stamina is the cost of flapping and the reason a
   * long leg has to be glided rather than beaten out, so taking it away takes
   * away most of what makes flying a decision -- it is not a kindness handed
   * out wherever a level is hard.
   *
   * The loft is the exception because of what it is: the highest release in
   * the game, with the whole district the last four levels crossed laid out
   * underneath it. What the player should be doing up there is looking, and a
   * bar that empties while they look is a bar telling them to stop looking.
   */
  tireless?: boolean;
  /**
   * How many of the flock come along, when it comes along at all.
   *
   * Only read where `escort` is on. Ten is what an errand across a park
   * wants: company, and few enough to see the bird you are flying. The rescue
   * wants thirty, and that is the point of it -- the story has just spent
   * five levels alone, and what arrives is the difference between a pigeon
   * and a great many pigeons.
   *
   * The birds are built once at the largest number any level asks for, since
   * each is a rig in the scene; this decides how many are let out.
   */
  flock?: number;
  /**
   * Whether the flock comes down when he does.
   *
   * One level, and it is the last one. Everywhere else the flock is company
   * and company keeps flying: it wheels overhead while he lands, which is
   * right for an errand he is running and wrong for the end of a rescue.
   * Thirty birds who came to help do not circle the roof while the thing
   * they came for happens underneath them.
   */
  settles?: boolean;
  /**
   * Whether the release point is picked at random from the other levels.
   *
   * One level, and it is the one after the story: the map with nothing left
   * to do on it, so where you start is nowhere in particular. `start` is
   * still a real coordinate and still has to be a sensible one -- everything
   * that checks a release point checks this one -- it is simply not the only
   * one it can be.
   *
   * Drawn from the other levels rather than from anywhere on the map, which
   * is what makes it safe: every one of those has already been checked for
   * being over a roof, within reach of its target and clear of the buildings.
   * A coordinate rolled at random over a city is a coordinate inside a wall
   * about half the time.
   */
  startsAnywhere?: boolean;
  /**
   * Whether the game is still teaching on this level.
   *
   * On for the first four and off for the rest. What it gates is the
   * instructions that watch the *flight* rather than its distance -- pull up,
   * keep flapping, slow down -- which are right for somebody learning and
   * wrong for somebody who has learned: a pigeon spends half its life low,
   * slow or tired on purpose.
   *
   * The reason it stops where it does is not that the player is ready. It is
   * that from the fifth level on, the levels have things of their own to say
   * -- "Crows! Fly low!", "Keep high!", "You need to land on the train!" --
   * and those are the ones that matter. A caution and a level's own
   * instruction cannot both be on screen, and the caution outranks nothing:
   * being told to pull up in the second a crow warning was due is the game
   * talking over the only line that could have saved the flight.
   */
  teaches?: boolean;
  /**
   * Whether there are crows in the sky.
   *
   * They live at one place on the map rather than in a level, so a level that
   * starts anywhere can start next to them -- and being killed by a crow on
   * the level that exists because the story is over would be the game not
   * having noticed it ended.
   */
  crows?: boolean;
  /**
   * Who the escort is, when it is one particular bird.
   *
   * Normally nobody: a flock is a flock, drawn in whatever colours it drew.
   * Named, the flock is that character -- which only makes sense for a flock
   * of one, and there is only one of those.
   */
  flockIs?: string;
  /**
   * Whether the flock is all in the air from the first frame.
   *
   * The loft lets one bird out a second, which is right for a flock that
   * drifts into an errand across a park and useless on a level that is over
   * in ten seconds and is *about* the flock: trickled out, four of the thirty
   * are up by the time it matters.
   */
  flockAtOnce?: boolean;
  /**
   * Who is standing where, for as long as this level is being flown.
   *
   * Applied every time the level begins -- picked from the menu, restarted
   * after a death, or walked into from the level before -- so this is the
   * whole truth about where the cast is, and there is no history to get out
   * of step with it. Moving somebody between two chapters of the story is
   * writing them into a different place in the later one.
   */
  cast: readonly Standing[];
  /**
   * How this one is finished: met, crossed, or eaten.
   *
   * Exactly one of the three, which is the point of its being a union rather
   * than three optional fields -- a level with a person and a crossing was a
   * sentence the old shape was happy to let anybody write.
   */
  finish: Finish;
  begins?: 'flight' | 'perched';
}

/**
 * The hour every level is flown at, as an instant.
 *
 * Six in the evening in Budapest on the first of July, which is 16:00 UTC --
 * the field is an instant and the city is two hours ahead of it in summer.
 * One hour for all five: the levels run into each other now, one handing over
 * to the next where the last one ended, and a story that crosses a whole
 * afternoon between one wingbeat and the next is a story with a cut in it.
 *
 * It is written once rather than five times because it is one decision. When
 * a level wants its own light again, it says so by not using this.
 */
const EVENING = '2026-07-01T16:00:00Z';

/**
 * Where a level's finishing line lies, as a point on it and the way across.
 *
 * Square to the flight, so it is a line rather than a ring: any path from the
 * near side to the far side crosses it, and a bird that wanders half a
 * kilometre off course still gets there.
 */
export interface Line {
  x: number;
  z: number;
  /** Unit vector from the release point towards the target. */
  ux: number;
  uz: number;
}

/**
 * The belly to start a level with, given what was carried into it.
 *
 * The whole rule in one line, and it is a maximum rather than an assignment
 * on purpose: never less than the level can be flown on, never less than what
 * was earned.
 */
export const bellyOnEntry = (level: Level, carried: number): number =>
  Math.max(carried, level.health);

/**
 * The line through a point, square across the way in to it.
 *
 * Which is the same thing as the line through that point tangent to the
 * circle drawn round the release point -- a tangent is perpendicular to the
 * radius, and the radius is the way in. Saying it either way describes the
 * same stripe, and the second way is what makes it the *right* stripe: any
 * path from the release point to the far side of it crosses it, whatever
 * detour it takes.
 */
export function lineThrough(from: { x: number; z: number }, at: { x: number; z: number }): Line {
  const dx = at.x - from.x;
  const dz = at.z - from.z;
  const span = Math.hypot(dx, dz) || 1;
  return { x: at.x, z: at.z, ux: dx / span, uz: dz / span };
}

/** The line `at` metres along the way from `from` to `to`. */
export function crossingLine(
  from: { x: number; z: number },
  to: { x: number; z: number },
  at: number,
): Line {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const span = Math.hypot(dx, dz) || 1;
  const ux = dx / span;
  const uz = dz / span;
  return { x: from.x + ux * at, z: from.z + uz * at, ux, uz };
}

/** Whether a point is on the far side of the line. */
export const crossed = (line: Line, x: number, z: number): boolean =>
  (x - line.x) * line.ux + (z - line.z) * line.uz >= 0;

export const LEVELS: readonly Level[] = [
  {
    // The story's first beat rather than a flight: the hero on the home tree
    // with his mate and their egg, leaving. It is won on the instant it opens
    // -- he is already standing next to her -- so what the player does here
    // is read, answer, and take off.
    name: 'Nest',
    // The tree itself. Unused for a perched start, which stands him on the
    // platform, but written down because a level without a place is not one.
    start: [47.493997, 19.096538],
    // Never used: a perched level puts him on the crest rather than in the
    // air over it. Stated anyway, at the height of the thing he is standing
    // on, so that taking `begins: 'perched'` away would leave a level that
    // still makes sense rather than one with a hole in it.
    release: HOME_TREE.height,
    // Hungry, which is the reason for everything that follows. The two of
    // them have been on this branch all night.
    health: 0.2,
    when: EVENING,
    escort: false,
    target: { kind: 'landmark', name: HOME_TREE.name },
    // The pink one, and the only bird in the game wearing her colours. She
    // stands beside the nest rather than on it.
    cast: [{ who: PINK.name, on: { kind: 'landmark', name: HOME_TREE.name }, along: -0.4, across: 0.08 }],
    finish: { kind: 'meeting', who: PINK.name, dialogue: HEADING_OUT },
    begins: 'perched',
  },
  {
    // The errand, and the first flight of the game: most of a kilometre from
    // the branch he leaves to a slab of concrete in a park, with somebody
    // standing beside it. Nothing to fly round and nothing that moves, and
    // long on purpose -- landing is the hard part of this game, and a first
    // level that reaches the hard part twenty seconds in asks the player to
    // learn flying and landing at the same time. Nine hundred metres of
    // flapping first, and the slab is still there when he arrives.
    name: 'Temető',
    // Twenty metres the far side of the home tree, so that the tree is the
    // first thing in front of him: he is released facing his target, the
    // target is most of a kilometre west, and the tree stands between. Being
    // put here from the menu or after a death is being put back at the top of
    // the same flight, looking at the same thing he looked at on leaving it.
    start: [47.494019, 19.096828],
    // Five metres over the crest he has just left, which is the whole
    // difference between this level and every other one: he is not dropped
    // into it from the sky, he is leaving a tree. It also means the flight
    // cannot be glided -- from twenty-three metres a pigeon covers about a
    // hundred and forty of the nine hundred.
    release: HOME_TREE.height + 5,
    // The same morning and nothing eaten yet. A fifth of a belly is about six
    // hundred metres and this half is six of them, which is a level that can
    // be flown only by a bird that never climbs; a quarter gives it the
    // hundred and fifty metres of slack that flapping over the park costs.
    // Still hungry, which is the half of it the story needs.
    health: 0.25,
    when: EVENING,
    // Company for the long crossing of the park, which is the level that
    // most needs it: half a kilometre of nothing but trees.
    escort: true,
    flock: 10,
    // The same slab the next level is about: the arrow points at the food for
    // the whole way there, because that is what he is doing. This half is
    // over when he is halfway, and nobody is standing on the line.
    target: { kind: 'landmark', name: PARK_PATCH.name },
    // Still on the branch, exactly where the conversation left her: she said
    // she would rather stay, and she is staying. He can look back and see it.
    cast: [{ who: PINK.name, on: { kind: 'landmark', name: HOME_TREE.name }, along: -0.4, across: 0.08 }],
    // Three marks down the park, the same as the marks over the district
    // later on. This is the first long flight in the game and it ends at a
    // stripe on the ground six hundred metres away that you cannot see until
    // you are nearly on it -- so what the player has to steer by is a line of
    // columns, one at a time.
    //
    // At a hundred and ninety, three hundred and sixty and five hundred and
    // twenty metres out, which is short of the line by eighty: a mark past
    // the stripe is one nobody can ever reach, because reaching the stripe
    // ends the level.
    waypoints: [
      [47.494035, 19.094306],
      // Fifteen metres further on than the even spacing wanted, because the
      // even spacing put it inside a house. These were laid down the middle of
      // the route the night before the real buildings arrived, when there was
      // nothing on the ground to be inside of.
      [47.494051, 19.091851],
      [47.494063, 19.089927],
    ],
    // Six hundred metres along, which is where the second half of the errand
    // begins -- the same point, said once. It used to be said twice, as a
    // distance here and as a coordinate there, and a test kept them in step.
    finish: {
      kind: 'crossing',
      through: [47.49407, 19.088865],
      opens: { level: 'Teleki tér' },
    },
  },
  {
    // The second half of the same errand, and the reason it is a level of its
    // own: nine hundred metres is a long way to fly again because you misread
    // the last twenty. Crossing the line hands this over in the air -- so it
    // costs nothing while the flight is going well, and when it is not, this
    // is where the flight starts again.
    name: 'Teleki tér',
    // On the line, which is where he was when this became his level.
    start: [47.49407, 19.088865],
    // Forty metres: about what a bird has under it after six hundred metres
    // of flapping, and well clear of the park's own trees.
    release: 40,
    // Arrived on what is left, which by rights is almost nothing. A quarter
    // is what makes the last four hundred metres flyable when this level is
    // picked out of the menu -- and a floor, so flying the first half well
    // still counts for something.
    health: 0.25,
    when: EVENING,
    // And on through the second half of the errand, since it is one flight
    // in two pieces and a flock that vanished at the line would say so.
    escort: true,
    flock: 10,
    target: { kind: 'landmark', name: PARK_PATCH.name },
    // And this is where she goes. The park is behind him, he is a kilometre
    // west with his back to the tree, and by the time he turns round she is
    // on the loft. Nothing moves her: the level simply says she is there, so
    // starting this level -- first time, or after flying into a chimney --
    // has her there, and the branch is empty in every shot of it.
    cast: [{ who: PINK.name, on: { kind: 'landmark', name: LOFT.name }, along: 2.6, across: 0 }],
    // Nobody is waiting on the concrete. A pigeon that has flown nine hundred
    // metres for food has come for the food, so the level is the eating: over
    // when the belly is full.
    //
    // And what it hands over to is not a level. He has what he was sent for,
    // so the next thing that happens is going home -- which the game flies,
    // because nine hundred metres of park he has already crossed twice is not
    // a level, it is the journey between two of them.
    finish: { kind: 'fed', opens: { scene: HOMECOMING.name } },
  },
  {
    // Into the eighth district to look for her. He is put down over
    // Népszínház utca, which is where the camera has just brought him, and
    // Mátyás tér is five hundred metres south-west: the first place he thinks
    // of, and the first place she is not.
    name: 'Mátyás tér',
    start: [47.493404, 19.085858],
    // Eighty metres for five hundred of ground, which is 1:6.2 -- a pigeon's
    // own best glide, so he arrives with nothing in hand and has to have
    // worked for it. Low enough to be a flight through the district rather
    // than a look down at it.
    release: 80,
    // He has just eaten a whole belly and flown home on it.
    health: 1,
    when: EVENING,
    escort: false,
    target: { kind: 'landmark', name: MATYAS_SQUARE.name },
    // Nobody on the square. That is the point of it: the level is finished by
    // getting there and finding it empty, and what he says about that is the
    // beat it hands over to.
    cast: [{ who: PINK.name, on: { kind: 'landmark', name: LOFT.name }, along: 2.6, across: 0 }],
    finish: { kind: 'arrival', opens: { scene: 'nobody at Mátyás tér' } },
  },
  {
    // The second square, four hundred and fifty metres north-west of the
    // first: he takes off from one and flies to the other, which is the
    // shape the searching has -- a run of hops round a district, each one
    // beginning where the last one gave up.
    name: 'Jani Pali tér',
    // Past the point the game explains itself -- see `teaches`.
    teaches: false,
    // Straight up off Mátyás tér, which is where the last level left him
    // standing. There is no camera flight into this one because there is
    // nowhere to fly: he has said what he is going to do and the level is him
    // doing it, from the square he said it on.
    start: [47.491961, 19.079619],
    release: 60,
    health: 1,
    when: EVENING,
    escort: false,
    target: { kind: 'landmark', name: JANI_SQUARE.name },
    cast: [{ who: PINK.name, on: { kind: 'landmark', name: LOFT.name }, along: 2.6, across: 0 }],
    // And this one hands straight over to the flight back east, with nothing
    // said yet. What he works out here -- or who he bumps into -- is the next
    // thing to be written, and it goes in as another beat.
    finish: { kind: 'arrival', opens: { level: 'Népszínház' } },
  },
  {
    // West, out over the open ground beyond the district, and the first level
    // with something in the air to worry about rather than something on the
    // ground to arrive at. He leaves the square he has just searched, and the
    // crows are between him and the line.
    name: 'Népszínház',
    // Past the point the game explains itself -- see `teaches`.
    teaches: false,
    // Straight up off Jani Pali tér: the square the last level ended on.
    start: [47.495871, 19.077971],
    // Sixty metres, which is well over the roofline -- the houses come to
    // twenty-four and the loft to thirty-one -- because the point of this
    // one is that height is the danger. Crows are above you.
    release: 60,
    health: 1,
    when: EVENING,
    // Nobody. The sky over this one has crows in it, and a flock of ten
    // pigeons milling about would bury them.
    escort: false,
    // West, which is where the line is: the slab out on the open ground
    // beyond the district. The target no longer draws the line -- the
    // coordinate does that -- so what it is for here is the direction of
    // travel and the distance still to go.
    target: { kind: 'landmark', name: WEST_PATCH.name },
    cast: [{ who: PINK.name, on: { kind: 'landmark', name: LOFT.name }, along: 2.6, across: 0 }],
    // Three marks down the way west, which is a route through a district
    // with nothing else in it to steer by: the squares are behind him and
    // the line ahead is a stripe you cannot see until you are near it.
    waypoints: [
      [47.494767, 19.07711],
      [47.495094, 19.075731],
      [47.495327, 19.074701],
    ],
    // Three hundred and twenty metres west of the square he takes off from,
    // and the stripe runs square across the way in to it.
    finish: {
      kind: 'crossing',
      through: [47.495543, 19.073687],
      opens: { level: 'Blaha' },
    },
  },
  {
    // Straight on west, out of the crows and over the open ground: the level
    // before this one ends by flying through a line, and this one picks the
    // bird up on it.
    name: 'Blaha',
    // Past the point the game explains itself -- see `teaches`.
    teaches: false,
    // On that line, which is the whole point of a checkpoint -- dying just
    // after the crossing puts the bird back where it crossed rather than
    // somewhere it has never been. It used to start two hundred and fifty
    // metres south of here, which was fine while nothing handed over to it.
    // The flight is the same length either way: 291 m to the patch from
    // here against the 286 m it was, so the approach is the same shot from a
    // slightly different bearing.
    start: [47.495543, 19.073687],
    // Twenty. Under the roofline rather than over it, which makes this the
    // first level since the food that is flown down in the streets -- and it
    // is flown, not glided: two hundred and ninety-one metres out from twenty
    // metres up is a glide of 14.6:1 against a pigeon's best of 6.2:1, so the
    // wings have to do the rest of it. That is the point of coming out of the
    // crows at low level and staying there.
    release: 20,
    health: 1,
    when: EVENING,
    escort: false,
    target: { kind: 'landmark', name: WEST_PATCH.name },
    cast: [
      { who: 'Ginger', on: { kind: 'landmark', name: WEST_PATCH.name }, along: 2.4, across: 0 },
      { who: PINK.name, on: { kind: 'landmark', name: LOFT.name }, along: 2.6, across: 0 },
    ],
    finish: { kind: 'meeting', who: 'Ginger', dialogue: THE_TRAPPER },
  },
  {
    // Twenty-four metres up, on a roof among other roofs. Still nothing
    // moving, but now you have to pick the right one and stop on it.
    name: 'The Loft',
    // Past the point the game explains itself -- see `teaches`.
    teaches: false,
    // Out past the slab the level before finishes on: a hundred metres further
    // west than it was, so the roofs of the district are the whole of the
    // view rather than something off to one side.
    //
    // It costs the glide. A thousand and fifty-seven metres from the loft at
    // a hundred and fifty up is 7.0:1 against a pigeon's measured best of
    // about 5.6, where it was 6.4 -- so where the last stretch used to be
    // nearly reachable on the wings folded, it now has to be flown.
    start: [47.496632, 19.068013],
    // A hundred and fifty, which is the highest release in the game by half
    // as much again. Nine hundred and fifty-eight metres out from that is a
    // glide of 6.4:1 against a pigeon's measured best of about 5.6:1 -- so
    // it is nearly reachable gliding and not quite, which is the same margin
    // this level had at a hundred metres and six hundred and twenty out.
    //
    // The height is the point of it rather than a way of paying for the
    // distance: from up here the whole district the last four levels were
    // flown through is laid out at once, which is a thing worth being given
    // once and is not worth being given twice.
    release: 150,
    // After the errand, and the errand was food. These three are flown on a
    // full belly because the story says he has eaten.
    health: 1,
    when: EVENING,
    escort: false,
    // The one level the wings do not tire on -- see `tireless`.
    tireless: true,
    target: { kind: 'landmark', name: LOFT.name },
    // Her, in the cage, and nobody else. There used to be somebody who lives
    // here standing beside her, which made the arrival a hello from a
    // stranger with his mate three metres away behind bars -- the wrong bird
    // to be walked up to at the moment the search ends.
    cast: [{ who: PINK.name, on: { kind: 'landmark', name: LOFT.name }, along: 2.6, across: 0 }],
    finish: { kind: 'meeting', who: PINK.name, dialogue: CAUGHT },
  },
  {
    // Out along Fiumei út, over the roofs, looking for the big house.
    //
    // The start is a hundred and twenty-four metres from the loft, which is
    // to say directly over the district the level before came down in: he has
    // been told there is a trapper on the top of a big house, and this is him
    // going up to find out which one.
    name: 'Fiumei út',
    // Past the point the game explains itself -- see `teaches`.
    teaches: false,
    start: [47.494320, 19.081098],
    // A hundred and fifty, the same as the level before it. Two drops in a
    // row from the same height is the pair of them reading as one search from
    // altitude rather than as two errands.
    release: 150,
    health: 1,
    when: EVENING,
    escort: false,
    // The yard, which is where this is going: the line is at bearing 16 and
    // the yard at 38, so what the arrow points at and where the flight ends
    // are the same way for once. A wagon rather than a landmark, because
    // nothing described lies anywhere near that bearing -- everything on the
    // map is west or south of here, and aiming at one of those would be an
    // arrow pointing over the player's shoulder.
    target: { kind: 'wagon', name: 'The middle wagon', train: 0, car: 'middle' },
    // Nobody at the end of it -- a level finished by flying through a line
    // has nobody standing there, which is the rule that keeps the three
    // finishes apart. She is on the loft terrace, as she is in every level
    // since the park: not somebody to meet, somebody who is there.
    cast: [{ who: PINK.name, on: { kind: 'landmark', name: LOFT.name }, along: 2.6, across: 0 }],
    finish: {
      kind: 'crossing',
      through: [47.499529, 19.083243],
      opens: { level: 'Keleti' },
    },
  },
  {
    // A wagon of a running train, which is the first target that will not
    // wait for you.
    name: 'Keleti',
    // Past the point the game explains itself -- see `teaches`.
    teaches: false,
    // On the line Fiumei út hands over at, which is the checkpoint rule every
    // crossing in the game obeys: dying just after the line puts the bird
    // back where it crossed rather than somewhere it has never been.
    start: [47.499529, 19.083243],
    // Ninety. Lower than the two drops before it, which is the shape of the
    // ending: the searching from altitude is over and this one is an approach
    // to a particular wagon of a particular train.
    release: 90,
    health: 1,
    when: EVENING,
    escort: false,
    target: { kind: 'wagon', name: 'The middle wagon', train: 0, car: 'middle' },
    cast: [
      { who: 'White', on: { kind: 'wagon', name: 'The middle wagon', train: 0, car: 'middle' }, along: 2.5, across: 0 },
      { who: PINK.name, on: { kind: 'landmark', name: LOFT.name }, along: 2.6, across: 0 },
    ],
    finish: { kind: 'meeting', who: 'White', dialogue: THE_ASK },
  },
  {
    // The turn, and the first level in the game flown with a crowd behind
    // him. Everything since the empty nest has been one pigeon looking; the
    // last thing that happened was a rake full of them agreeing to come.
    //
    // It is the long half of the way back and it ends at a line rather than
    // at anything: crossing it is the flock committing, and what is on the
    // far side is the loft.
    name: 'Coming on strong',
    // Past the point the game explains itself -- see `teaches`.
    teaches: false,
    start: [47.500249, 19.088921],
    release: 100,
    health: 1,
    when: EVENING,
    escort: true,
    // Thirty. Ten is company on an errand; this is the flock as the point of
    // the level rather than as scenery around the edge of it.
    flock: 30,
    // The loft, a hundred and fifty metres beyond the line and on almost the
    // same bearing -- 224 against the line's 227 -- so what the arrow points
    // at and where the flight is going are the same way. It is not this
    // level's objective; it is this level's direction, which is what a
    // target is for on a level that ends at a line.
    target: { kind: 'landmark', name: LOFT.name },
    // Nobody: a level finished by flying through a line has nobody standing
    // at the end of it. She is on the terrace, as she has been since the
    // park.
    cast: [{ who: PINK.name, on: { kind: 'landmark', name: LOFT.name }, along: 2.6, across: 0 }],
    finish: {
      kind: 'crossing',
      through: [47.496495, 19.082937],
      opens: { level: 'The rescue' },
    },
  },
  {
    // The end of it: the roof the eighth level landed on, flown again with
    // thirty birds and the trapper on it.
    name: 'The rescue',
    // Past the point the game explains itself -- see `teaches`.
    teaches: false,
    // They came to help, so they arrive -- see `settles`.
    settles: true,
    // And they are all there from the first frame: this one is about them.
    flockAtOnce: true,
    // On the line the level before hands over at, which is the checkpoint
    // rule every crossing in the game obeys.
    start: [47.496495, 19.082937],
    // Sixty. The loft is a hundred and fifty-five metres away and thirty-one
    // metres tall, so this is twenty-nine metres of height to lose over a
    // hundred and fifty-five of ground -- 5.3:1 against a best glide of about
    // 5.6:1, which is an approach rather than a drop. The height was not
    // given with the coordinate; this is the number the geometry asks for.
    release: 60,
    health: 1,
    when: EVENING,
    escort: true,
    flock: 30,
    target: { kind: 'landmark', name: LOFT.name },
    // Her, and nobody else. The whole flight is for her, so the bird waiting
    // at the end of it is the one in the cage -- there is no third party to
    // be met on the roof and finding somebody else there would be the level
    // handing the ending to a stranger.
    cast: [{ who: PINK.name, on: { kind: 'landmark', name: LOFT.name }, along: 2.6, across: 0 }],
    finish: { kind: 'meeting', who: PINK.name, dialogue: SAVED },
  },
  {
    // After it. The story is over, the map is still there, and this is the
    // level that is the map: no target, no line, nobody to find, nothing to
    // open onto and no way to finish it.
    name: 'Everafter',
    // Somewhere. The coordinate written here is one of the real ones so that
    // everything which checks a release point has something to check, and at
    // play it is swapped for another level's -- see `startsAnywhere`.
    start: [47.494019, 19.096828],
    startsAnywhere: true,
    // High enough to see where you have been, and to get anywhere from.
    release: 120,
    health: 1,
    when: EVENING,
    // She comes. One bird, and it is her: everything before this was him
    // alone or him with strangers.
    escort: true,
    flock: 1,
    flockIs: PINK.name,
    // Nothing is being taught any more, and nothing is hunting.
    teaches: false,
    crows: false,
    // The loft, for the arrow -- somewhere to go for a player who wants
    // somewhere to go, and nothing at all happens on arriving.
    target: { kind: 'landmark', name: LOFT.name },
    // Nobody standing anywhere: she is flying, and everyone else has been
    // met.
    cast: [],
    finish: { kind: 'free' },
  },
];
