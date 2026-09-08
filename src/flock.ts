/**
 * The other pigeons.
 *
 * They fly the same model the player does, on the same collider and in the
 * same wind, steered by `sim/autopilot`. Nothing about them is special-cased:
 * they stall, they get blown off course, and when they fly into a building
 * they die exactly as the player does and are released again.
 *
 * They keep the player company rather than living anywhere. A bird appears
 * behind the player, picks somewhere near them to fly to, and picks somewhere
 * else near them when it gets there. The effect is a loose escort that keeps
 * breaking up and re-forming, which is what a flock does and, more to the
 * point, means there is always another pigeon in shot.
 */

import {
  createBird,
  defaultParams,
  step,
  type BirdState,
  type Ending,
  type Controls,
  type FlightParams,
} from './sim/flight';
import { neutralControls } from './sim/flight';
import {
  defaultAutopilotParams,
  distanceTo,
  steer,
  type AutopilotParams,
  type AutopilotState,
  type Waypoint,
} from './sim/autopilot';
import type { Collider } from './sim/collision';
import type { WindField } from './sim/wind';
import { neutralWalk, standStill, walk, type WalkControls } from './sim/walk';
import { startWander, steerWander, type Wander } from './sim/wander';
import {
  add,
  clamp,
  cross,
  dot,
  length,
  normalize,
  quatFromAxisAngle,
  quatMultiply,
  scale,
  vec,
  type Quat,
  type Vec3,
} from './sim/math3';

/**
 * Where a bird appears: the first time, and after it has died.
 *
 * Four ways, and they are four different things a flock can be. The escort
 * comes in behind the player because it is following them; a flock over a
 * square is put back where it fell because that is where it lives; something
 * that dies for good is a thing you can lose.
 */
export type Spawn =
  /** At a fixed place and height, however many times it takes. */
  | { kind: 'at'; x: number; y: number; z: number }
  /**
   * Behind whatever it is flying around, going the same way.
   *
   * Facing the same way rather than at it, because a bird released nose-on
   * spends its first seconds turning round in front of the camera.
   */
  | { kind: 'behind'; away: number }
  /** Nowhere. Once it is down it stays down, and the flock thins out. */
  | { kind: 'gone' }
  /**
   * A random bearing, exactly this far from where it died.
   *
   * In plan rather than through the air, and at the height it died at or the
   * floor, whichever is higher -- so "exactly fifty metres" stays exactly
   * fifty metres instead of becoming whatever is left after the ground has
   * been argued with. The first time, when nothing has died yet, it is
   * measured from the thing the flock is flying around.
   */
  | { kind: 'nearby'; away: number };

/**
 * Something the flock may go for, and the rules about when.
 *
 * A crow that dives at a pigeon is not flying a different way -- it is the
 * same autopilot with a different waypoint, which is the whole reason this
 * fits in twenty lines rather than in a second flight model.
 */
export interface Hunt {
  quarry: () => Anchor | null;
  /** How near it has to come before a bird notices, in metres. */
  within: number;
  /**
   * And how high it has to be for a chase to start, in metres.
   *
   * The trigger only. Once a bird is after something it stays after it, so
   * diving does not call off an attack that has already begun -- it decides
   * whether the next one starts.
   */
  above: number;
  /**
   * The lowest a hunter will follow it, in metres.
   *
   * Where the safety is. It aims at the quarry itself, but never at a point
   * below this -- so a pigeon on the deck has a crow keeping station over it
   * rather than a crow arriving. Going low does not shake it off; it stops it
   * reaching you.
   */
  floor: number;
  /**
   * How fast it goes once it is after something, in m/s.
   *
   * This is where the flight model is put aside. A hunting bird is moved
   * straight at its quarry at this speed rather than flown -- see `dive`.
   */
  speed: number;
  /**
   * And how sharply it can bend its course, in radians a second.
   *
   * The whole of what makes a chase a chase. Flown properly, a bird at
   * fourteen metres a second banked as far as it dares turns inside about
   * sixteen metres, so a pigeon that jinks is a pigeon it sails past and has
   * to come round for -- which is what it did, repeatedly, looking exactly as
   * stupid as it sounds.
   */
  turn: number;
  /**
   * How far away the quarry has to get before it is lost, in metres.
   *
   * Otherwise a bird that has once seen something follows it for the rest of
   * the game and across every level, which is not tenacity, it is a bug with
   * a story attached.
   */
  loses: number;
}

export interface FlockOptions {
  count: number;
  /** Where a bird comes from, the first time and every time after. */
  spawn: Spawn;
  /**
   * Radius of the ball around the leader that targets are picked inside, in
   * metres.
   *
   * A ball and not a disc: height is part of the same radius, so a target is
   * as likely to be above or below the leader as beside them, and the flock
   * shares the player's airspace rather than a slab of it.
   */
  radius: number;
  /**
   * The lowest a target is ever put, in metres.
   *
   * Because the leader can be standing on the ground, or flying low over it.
   * Aiming at the leader's own height then means aiming at the dirt, and the
   * flock would spend its time ploughing into it rather than wheeling about
   * overhead.
   */
  minAltitude: number;
  /**
   * How far in front of the anchor the flock wheels, in metres.
   *
   * Targets only. Centred on the leader, half a flock is behind him at all
   * times -- and the camera is behind him too, so half of it was in the boom
   * or out of frame.
   *
   * It moves where they *go*, not where they come from. A bird is let out
   * behind the leader precisely so that nobody watches one appear out of
   * nothing, and measuring that from a point thirty metres ahead would put
   * the loft thirty metres nearer the camera and undo it -- which is what
   * happened when this was done by handing the flock an anchor that was
   * already shifted. The anchor is the leader; this is a fact about the ball
   * of targets, and it lives here where only the targets can see it.
   */
  ahead: number;
  /**
   * How near a target counts as reaching it, in metres.
   *
   * The autopilot's own arrival radius is 45 m, which is wider than the whole
   * area targets are picked in: every bird would count as arrived before it
   * had set off, and re-aim every tick. Escorting somebody is close work and
   * needs its own number.
   */
  arrivalRadius: number;
  /**
   * Seconds before a bird picks somewhere else regardless.
   *
   * Two reasons, and the second is the important one. A pigeon at 14 m/s
   * cannot turn inside about 34 m, so a target 20 m away is one it may simply
   * never hit, and without a timeout it would chase that point for ever. And
   * a target is chosen against where the leader was at the time: a leader
   * doing 19 m/s is 76 m away four seconds later, so the target has to go
   * stale or the flock is escorting a memory.
   */
  attentionSpan: number;
  /**
   * How far a bird may get from the leader before it is brought back, in
   * metres.
   *
   * A pigeon at cruise does about 19 m/s and the flock does about 14, so a
   * player who simply flies away cannot be caught. Rather than leave a trail
   * of stragglers strung out behind for the rest of the run, a bird that has
   * lost touch is released again -- which happens far enough back to be off
   * the end of the camera.
   */
  strayDistance: number;
  /**
   * Seconds a dead bird stays down before another is released.
   *
   * Zero puts it straight back in the air on the tick it died.
   */
  respawnDelay: number;
  /**
   * Seconds between birds when the flock is first let out.
   *
   * They used to appear all at once, which reads as a spawn rather than a
   * loft waking up. Staggering them was what the code claimed to do and did
   * not: it set every bird's timer to zero immediately afterwards.
   */
  emitInterval: number;
  seed: number;
  /** How they fly. Their own, because escorting is not crossing a city. */
  autopilot: AutopilotParams;
  /** What they go for, if they go for anything. */
  hunt?: Hunt;
}

/**
 * How a bird flies when it is escorting somebody rather than crossing a city.
 *
 * The default autopilot cruises at 14 m/s and banks to 28 degrees, which is a
 * turn of 37 m radius -- it physically cannot stay inside a 20 m circle, and
 * left on those numbers the flock wheels out to 137 m and is only ever pulled
 * back by the stray rule. Slower and steeper turns inside ten metres, which is
 * both what the feature needs and what a pigeon milling about actually does.
 *
 * The floor comes down with it. At the default 38 m a flock over a pigeon
 * walking on the ground would spend the whole time climbing away from it.
 */
export const escortAutopilot: AutopilotParams = {
  ...defaultAutopilotParams,
  cruiseSpeed: 11,
  maxBank: 0.9,
  floor: 8,
  recover: 20,
  minSpeed: 8,
};

/**
 * The band the flock's own cruise is held in, in m/s.
 *
 * Because birds flying with you fly at your speed, and a flock that does not
 * is a flock you never see. Fixed at 11 they are all airborne and all behind
 * the camera: at a leader doing 11 m/s or more, *none* of them is inside the
 * view cone, which is the whole complaint. The floor is there so that a
 * stationary or walking leader still has them wheeling about rather than
 * stalling out of the sky, and the ceiling so a dive does not drag the flock
 * along with it.
 */
const CRUISE_FLOOR = 11;
/**
 * How high above the ground a landing bird spreads its wings, in metres.
 *
 * Eight. It has to be high enough that the brake has time to take the speed
 * off -- the approach comes in at the flock's cruise and the landing limit is
 * ten metres a second -- and low enough that the bird is committed rather than
 * hanging about above the spot.
 */
const LANDING_FLARE = 8;

/**
 * And how fast they fly the approach, in metres a second.
 *
 * Slower than the flock's ordinary cruise, which tracks the leader's and is
 * far too quick to arrive at: the flock is not keeping up with anybody any
 * more, it is landing.
 */
const LANDING_CRUISE = 11;

/**
 * And how low before it beats to break the sink, in metres.
 *
 * The legs will take ten metres a second forward and only four downward, so
 * the sink is what kills a landing and the sink is what this is for.
 */
const LANDING_BEAT = 3;

/**
 * How far below the surface counts as having missed it, in metres.
 *
 * Two. A bird that touches down on the roof is within a body of its height; a
 * bird that went over the parapet is a storey or more below it, and there is
 * nothing in between to be ambiguous about.
 */
const MISSED_BY = 2;

const CRUISE_CEILING = 30;

/**
 * How much faster than the leader they fly, in m/s.
 *
 * Matching exactly is not enough: they are released ten metres back, and two
 * birds at the same speed stay ten metres apart for ever. A little in hand is
 * what lets one close the gap and come past. Only a little -- at six the flock
 * overshoots, sits further out, and starts tripping the stray rule.
 */
const CRUISE_SURPLUS = 3;

/**
 * How far ahead of the leader targets are centred, in seconds.
 *
 * Aiming at the point somebody is standing on is pure pursuit, and pure
 * pursuit always arrives behind them. With the flock aimed where the player
 * *is*, not one bird was ever inside the camera's cone at cruise -- all ten
 * airborne, all behind the lens, which is exactly what "I can't see many of
 * our fellow birds" looks like from the inside.
 *
 * At a standstill this is zero and the ball sits on the leader exactly.
 */
const LOOKAHEAD = 3;

/**
 * How far ahead of the bird the flock is centred, in metres, by default.
 *
 * Thirty. The ball of targets used to be centred on the player, which puts
 * half the flock behind the camera at all times -- and the camera is behind
 * the bird, so "behind the bird" is "in the boom, or out of frame". A flock
 * you cannot see is a flock that costs what it costs and buys nothing.
 *
 * Moved forward rather than made bigger: a wider ball would put them further
 * away in every direction including the two that were already working. Ahead
 * is also where a bird flying with a flock actually looks.
 */
export const FLOCK_AHEAD = 30;

/**
 * Here rather than in `defaultFlockOptions`, whose `ahead` is nought.
 *
 * That default belongs to the flock, which knows nothing about cameras; this
 * is the game's answer, and a level may have its own -- see `Level.flockAhead`.
 * It lives in this file so that the levels can be checked against it.
 */
export const defaultFlockOptions: FlockOptions = {
  count: 10,
  spawn: { kind: 'behind', away: 10 },
  radius: 15,
  minAltitude: 10,
  // Nought here, because the default flock is the one the tests use and a
  // rule about where the camera is has no business in it. The game sets it.
  ahead: 0,
  arrivalRadius: 8,
  attentionSpan: 4,
  strayDistance: 140,
  respawnDelay: 0,
  emitInterval: 1,
  seed: 1234,
  autopilot: escortAutopilot,
};

/**
 * The thing they are flying around, as it is right now.
 *
 * Read through a function rather than held as an object, because what a flock
 * circles may be replaced outright -- the player's bird is, whenever the run
 * restarts, and anything holding the old one keeps escorting a pigeon nobody
 * can see any more.
 *
 * It need not move. A stationary anchor is one whose speed is nought, and the
 * arithmetic falls out: the flock aims at a ball centred on it and stays
 * there, which is what a few crows over a rooftop do. It was written for the
 * player and read as "the leader" throughout; it is the same shape, asked a
 * more general question.
 */
export interface Anchor {
  x: number;
  y: number;
  z: number;
  /** Heading in radians clockwise from north. */
  heading: number;
  /** How fast it is going, in m/s. The flock flies at the same pace. */
  speed: number;
  /** How fast it is climbing, in m/s; negative descending. */
  climb: number;
}

export interface FlockMember {
  state: BirdState;
  /** Whether it is going for something rather than wheeling about. */
  hunting: boolean;
  /** Which colour scheme to draw it in, as an index into PIGEON_MORPHS. */
  morph: number;
  /** Seconds until it is released again; zero while it is flying. */
  down: number;
  /** Where it is making for at the moment. */
  aiming: Waypoint;
}

export interface Flock {
  readonly members: readonly FlockMember[];
  /**
   * How many of them are in service, out of the ones that were built.
   *
   * The flock is made once, at the largest size any level asks for, because
   * a bird is a rig in the scene and building and throwing those away at
   * every level change is work for nothing. What changes per level is how
   * many of them are let out: the rest are held down and never released, and
   * `down > 0` is already how the rest of the game says "not in the air".
   *
   * Set it and the ones over the number go away at their own pace -- one
   * already flying is not deleted mid-air, it simply is not let out again
   * once it comes down. `recall` is what puts them all away at once, and a
   * level change does that anyway.
   */
  only(many: number): void;
  /**
   * Put every bird that is coming into the air at once, at these places.
   *
   * The other way a flock can start, and it is a story beat rather than a
   * spawn rule: thirty pigeons standing on a goods train agree to help, and
   * what that has to look like is thirty pigeons leaving a goods train. The
   * ordinary rule lets one out at a time from behind the leader, which is
   * right for a flock joining an errand and quite wrong for a flock that is
   * already here.
   *
   * One-off, and it does not change the spawn: a bird that goes down after
   * this comes back the way every other bird comes back. So a player who
   * dies gets the usual flock rather than a second departure from a train
   * that is now a mile away.
   *
   * Fewer places than birds is fine -- they are dealt round.
   */
  scramble(from: readonly Vec3[]): void;
  /**
   * Bring them down around a point on the ground, and leave them there.
   *
   * The other end of `scramble`, and the other thing a flock has to be able
   * to do once it is a character in the story rather than scenery: thirty
   * birds who came to help have to arrive.
   *
   * `on` is the height of the thing they are landing on, and it is what
   * decides who dies. The flight model judges a touchdown by speed, sink and
   * bank, and thirty birds dropping onto one roof at once fail it more or
   * less every time -- measured, all ten of a test flock wrote themselves off
   * on the sink alone, coming in at five metres a second against a limit of
   * four. That is not "a few of them make a mess of it", it is a flock
   * falling out of the sky, and it is the wrong question anyway: these are
   * not birds learning to fly, they are birds who came to help.
   *
   * So the landing is lenient about *how* and strict about *where*. Come down
   * anywhere near the height of the surface and you have arrived, however
   * untidily. Come down well below it -- over the parapet, into the street --
   * and you did not make the roof, which is the one way to be killed here and
   * the one the player can see the reason for.
   *
   * A bird that is down stays down. Landed, it walks about; missed, it is
   * left where it fell. The respawning that keeps a flock topped up is
   * exactly wrong here: the point of the shot is that these are the birds off
   * the train, and one blinking back into the air would say they were
   * interchangeable.
   *
   * Pass null to call it off and go back to wheeling.
   */
  land(around: { x: number; z: number; on: number } | null): void;
  /**
   * Fly them for a tick.
   *
   * `letting` is whether any more may be let out. False stops the loft: the
   * ones already in the air carry on, and one that goes down stays down. It
   * is for the moment the player is dead, when a fresh pigeon appearing over
   * the wreck is the game carrying on cheerfully around a corpse -- which is
   * the one thing that moment should not do.
   */
  update(
    dt: number,
    collider: Collider | undefined,
    wind: WindField,
    letting?: boolean,
  ): void;
  /**
   * Put every bird away, to come out again one at a time.
   *
   * For a flock that has been off duty. Left alone while nobody was updating
   * it, it is frozen wherever it was two levels ago, and letting it simply
   * resume would either strand it out of sight or -- once the stray rule
   * noticed -- hand back all ten at once, in a lump, behind the player. This
   * is the same staggered start they get when the game begins.
   */
  recall(): void;
  /**
   * Resize the ball of targets, and move it along the leader's heading.
   *
   * A level's business, not the flock's. Thirty birds want a ball big enough
   * to hold thirty birds and far enough forward that half of them are not in
   * the boom; one bird wants neither -- given the flock's own ball she wheels
   * a whole cricket pitch away from him, which is a bird that happens to be
   * going the same way rather than the bird who came with him.
   *
   * Both in metres: `radius` is the ball the targets are picked inside and
   * `ahead` is how far along the leader's own heading its middle sits, which
   * is negative to put it behind him.
   */
  wheel(ball: { radius: number; ahead: number }): void;
  /**
   * Whether any bird in the air is this close to a point.
   *
   * Asked by whoever owns the consequences rather than answered here: a flock
   * knows where its birds are and has no business deciding what happens to
   * something they touch.
   */
  touching(at: { x: number; y: number; z: number }, within: number): boolean;
}

/**
 * Turn one direction towards another, by at most `most` radians.
 *
 * A rotation about the axis between them, which is the part that has to be
 * done properly. The obvious version -- slide a fraction of the way from one
 * to the other and normalise -- is a chord rather than an arc, and it has a
 * hole in it exactly where a hunt needs it most: for a bird pointed *directly
 * away* from its quarry the two directions are opposite, the chord between
 * them runs down the axis itself, and normalising puts it back where it
 * started. It flies away in a straight line for ever, at full speed, never
 * turning. That is what "they just fly by me" looked like from the outside.
 *
 * So: rotate. Where there is no axis to rotate about, because the bird is
 * pointed dead astern of where it wants to be, it turns flat -- a bird comes
 * round in yaw, not by looping over its own back.
 */
function bend(heading: Vec3, want: Vec3, most: number): Vec3 {
  const off = Math.acos(clamp(dot(heading, want), -1, 1));
  if (off <= most || off < 1e-6) return want;

  const between = cross(heading, want);
  let axis = length(between) > 1e-6 ? normalize(between) : vec(0, 0, 0);
  if (length(axis) < 0.5) {
    // Dead astern. Any axis across the heading will bring it round; pick the
    // one that keeps the turn level, falling back to something arbitrary for
    // a bird going straight up or straight down.
    const flat = cross(heading, vec(0, 1, 0));
    axis = length(flat) > 1e-6 ? normalize(flat) : vec(1, 0, 0);
  }

  // Rodrigues, with the term in (k.v) kept because the fallback axis above is
  // square to the heading but the general one need not be trusted to be.
  const c = Math.cos(most);
  const s = Math.sin(most);
  return normalize(
    add(
      add(scale(heading, c), scale(cross(axis, heading), s)),
      scale(axis, dot(axis, heading) * (1 - c)),
    ),
  );
}

/**
 * Move a hunting bird straight at what it is after.
 *
 * The cheat, and it is worth being plain about what is being cheated. This
 * does not fly: it ignores the wind, it ignores the collider, it holds one
 * speed whatever the attitude, and nothing it does costs it stamina. It is a
 * thing being moved along a line that bends.
 *
 * The reason is that the honest version does not work. A crow flying the real
 * model banks to turn, and a bank is a circle: at fourteen metres a second
 * and the steepest angle it dares, that circle is sixteen metres across. A
 * pigeon is smaller than that and moving, so the crow arrives where the
 * pigeon was, sails past, and comes round -- over and over, looking like an
 * idiot rather than like a predator. Every trick that would fix it inside the
 * flight model (more speed, more bank, a lead on the target) makes the circle
 * *bigger*, because radius goes with the square of speed.
 *
 * So the hunt gets its own motion and the honest model keeps the rest of the
 * game. The bird still looks right -- it is pointed along its own course, and
 * its wings beat -- and the player still has the one defence that matters,
 * which is height: this is only ever aimed at the floor or above it.
 */
function dive(state: BirdState, at: Waypoint, hunt: Hunt, p: FlightParams, dt: number): void {
  const to = vec(at.x - state.position.x, at.altitude - state.position.y, at.z - state.position.z);
  const span = length(to);
  const want = span > 1e-6 ? scale(to, 1 / span) : vec(0, 0, -1);

  const going = length(state.velocity);
  const heading = going > 1e-6 ? scale(state.velocity, 1 / going) : want;

  // Bend the course towards it, by no more than it can turn in a tick. The
  // cap is what keeps it a bird rather than a homing missile: it still has to
  // come round, it just comes round in its own length instead of a street.
  const course = bend(heading, want, hunt.turn * dt);

  state.velocity = scale(course, hunt.speed);
  state.position = add(state.position, scale(state.velocity, dt));
  state.orientation = lookAlong(course);
  // Beating, because it is working. The rig draws the wings from this and a
  // bird crossing the sky with its wings frozen reads as a paper aeroplane.
  state.flapPhase = (state.flapPhase + p.flapFrequency * dt) % 1;
  state.age += dt;
}

/**
 * The attitude of something flying along `course`, nose first and wings level.
 *
 * Yaw then pitch, in the order and the signs the rest of the game uses: the
 * model faces -Z at a heading of nought, and a positive pitch is nose up.
 */
function lookAlong(course: Vec3): Quat {
  const yaw = Math.atan2(course.x, -course.z);
  const pitch = Math.asin(clamp(course.y, -1, 1));
  return quatMultiply(
    quatFromAxisAngle(vec(0, 1, 0), -yaw),
    quatFromAxisAngle(vec(1, 0, 0), pitch),
  );
}

/** Small deterministic PRNG, so a flock is the same flock every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createFlock(
  morphCount: number,
  around: () => Anchor = () => ({ x: 0, y: 60, z: 0, heading: 0, speed: 0, climb: 0 }),
  options: FlockOptions = defaultFlockOptions,
  flight: FlightParams = defaultParams,
): Flock {
  const rand = mulberry32(options.seed);

  interface Pilot {
    member: FlockMember;
    /** Its place in the flock, which is what `only` counts against. */
    index: number;
    controls: Controls;
    memory: AutopilotState;
    /** Seconds spent on the current target. */
    chasing: number;
    /** Where it last went down, for the spawn that measures from there. */
    fell: Vec3 | null;
  }

  /**
   * The point the flock wheels around: the anchor, moved forward.
   *
   * Along the way the leader is *pointing* rather than the way it is going: a
   * bird in a sideslip or a flare is still looking where its nose is, and a
   * ball of targets that swung out sideways because of a gust would take the
   * flock with it.
   */
  const wheelAbout = (at: Anchor): Anchor =>
    ball.ahead === 0
      ? at
      : {
          ...at,
          x: at.x + Math.sin(at.heading) * ball.ahead,
          z: at.z - Math.cos(at.heading) * ball.ahead,
        };

  /** Somewhere near the leader to make for, chosen fresh each time. */
  const target = (at: Anchor): Waypoint => {
    // Centred on where the leader will be, not where they are. Aiming at a
    // point somebody is standing on is pure pursuit, and pure pursuit always
    // arrives behind them: by the time the bird gets there the leader has
    // moved on, so the flock spends the whole run trailing out of shot. This
    // is the one thing that puts a pigeon in front of the camera.
    const lead = at.speed * LOOKAHEAD;
    at = {
      ...at,
      x: at.x + Math.sin(at.heading) * lead,
      y: at.y + at.climb * LOOKAHEAD,
      z: at.z - Math.cos(at.heading) * lead,
    };
    // Cube-rooted so the points fill the ball evenly rather than bunching at
    // the middle of it: taking the radius straight from the random number puts
    // half of them inside half the radius, which is an eighth of the volume.
    const away = ball.radius * Math.cbrt(rand());

    // And a direction spread evenly over the sphere. Picking a polar angle
    // straight from a random number crowds the poles, because the rings of
    // latitude near them are short; picking its cosine instead does not.
    const up = rand() * 2 - 1;
    const ring = Math.sqrt(1 - up * up);
    const around = rand() * Math.PI * 2;

    return {
      x: at.x + Math.cos(around) * ring * away,
      z: at.z + Math.sin(around) * ring * away,
      // Height comes from the same ball, so the flock is at the leader's own
      // altitude give or take -- floored, because the ground is down there.
      altitude: Math.max(options.minAltitude, at.y + up * away),
    };
  };

  /** Where this bird comes back, and which way it is pointed when it does. */
  const appears = (pilot: Pilot, at: Anchor): { where: Vec3; facing: number } | null => {
    const spawn = options.spawn;
    if (spawn.kind === 'gone') return null;

    if (spawn.kind === 'at') {
      return {
        where: vec(spawn.x, Math.max(spawn.y, options.minAltitude), spawn.z),
        facing: rand() * Math.PI * 2,
      };
    }

    if (spawn.kind === 'behind') {
      const behind = at.heading + Math.PI;
      return {
        where: vec(
          at.x + Math.sin(behind) * spawn.away,
          Math.max(at.y, options.minAltitude),
          at.z - Math.cos(behind) * spawn.away,
        ),
        facing: at.heading,
      };
    }

    // Somewhere else near where it went down -- or near the anchor, the first
    // time, when nothing has gone down yet.
    const from = pilot.fell ?? { x: at.x, y: at.y, z: at.z };
    const around = rand() * Math.PI * 2;
    return {
      where: vec(
        from.x + Math.sin(around) * spawn.away,
        Math.max(from.y, options.minAltitude),
        from.z - Math.cos(around) * spawn.away,
      ),
      // Facing back towards where it came from, which for something knocked
      // out of the sky is the direction it has business in.
      facing: around + Math.PI,
    };
  };

  /** Put a bird in the air and give it somewhere to go. */
  const release = (pilot: Pilot) => {
    const at = around();
    const from = appears(pilot, at);
    if (!from) {
      // Gone for good: left where it fell, and not counted as waiting for
      // anything either.
      pilot.member.down = 0;
      return;
    }

    pilot.member.state = createBird(from.where, 12 + rand() * 4, from.facing);
    pilot.member.down = 0;
    pilot.memory.beating = true;
    // Placed from the anchor -- behind the leader, out of shot -- and aimed
    // at the ball, which is in front of him. The two are different points and
    // that is the whole of it.
    aim(pilot, wheelAbout(at));
  };

  /** Pick somewhere new and start the clock on it. */
  const aim = (pilot: Pilot, at: Anchor) => {
    pilot.member.aiming = target(at);
    pilot.chasing = 0;
  };

  const pilots: Pilot[] = [];
  /** How many are in service. All of them, until a caller says otherwise. */
  let wanted = options.count;
  // The ball of targets, which a level may resize -- see `wheel`.
  let ball = { radius: options.radius, ahead: options.ahead };
  for (let i = 0; i < options.count; i += 1) {
    const pilot: Pilot = {
      member: {
        state: createBird(),
        hunting: false,
        morph: Math.floor(rand() * morphCount),
        down: 0,
        aiming: { x: 0, z: 0, altitude: options.minAltitude },
      },
      controls: neutralControls(),
      index: i,
      memory: { beating: true },
      chasing: 0,
      fell: null,
    };
    // Released so it has a real position to sit at, then held back: one comes
    // out every `emitInterval` seconds rather than all of them at once.
    release(pilot);
    pilot.member.down = i * options.emitInterval;
    pilots.push(pilot);
  }

  // Rebuilt each tick because the cruise speed tracks the leader's. One
  // object, reused, rather than one per bird per tick.
  const flying: AutopilotParams = { ...options.autopilot };

  function update(
    dt: number,
    collider: Collider | undefined,
    wind: WindField,
    letting = true,
  ) {
    const at = around();
    flying.cruiseSpeed = landing
      ? LANDING_CRUISE
      : Math.min(CRUISE_CEILING, Math.max(CRUISE_FLOOR, at.speed + CRUISE_SURPLUS));

    for (const pilot of pilots) {
      const { member } = pilot;

      // Over this level's allowance: held down and never let out. Checked
      // before the clock rather than after, so a bird that is over the number
      // does not quietly count its way to being released.
      if (pilot.index >= wanted) {
        member.down = Math.max(member.down, options.emitInterval);
        continue;
      }

      // --- Coming down ------------------------------------------------------
      // Handled before everything else, because everything else assumes a
      // bird that is flying and looking for somewhere to be. A bird that has
      // arrived is not doing either.
      if (landing) {
        // Already down, one way or the other. Landed, it walks about;
        // crashed, it lies there. Neither is brought back: these are the
        // birds off the train, and one blinking into the air again would say
        // they were interchangeable.
        if (member.state.ending) {
          if (member.state.ending.kind !== 'landed') continue;
          let about = wanders.get(pilot);
          if (!about) {
            about = startWander(
              { x: member.state.position.x, z: member.state.position.z },
              rand,
            );
            wanders.set(pilot, about);
            walking.set(pilot, neutralWalk());
          }
          const feet = walking.get(pilot)!;
          const wants = steerWander(member.state, about, dt, rand);
          feet.forward = wants.forward;
          feet.turn = wants.turn;
          feet.launch = false;
          walk(member.state, feet, flight, dt, collider);
          member.state.health = 1;
          continue;
        }

        // Still up. Aimed at its own patch of ground near the place given,
        // picked once and kept: re-rolled every few seconds it would circle
        // the spot for ever instead of arriving at it.
        if (member.aiming.altitude > LANDING_BEAT) {
          const away = 4 + rand() * 14;
          const round = rand() * Math.PI * 2;
          member.aiming = {
            x: landing.x + Math.cos(round) * away,
            z: landing.z + Math.sin(round) * away,
            // A little above the ground rather than on it. Aimed at nought
            // the autopilot flies a straight line into the dirt and arrives
            // still descending; aimed just over it, the last metre is the
            // bird settling rather than the bird arriving.
            altitude: LANDING_BEAT / 2,
          };
          pilot.chasing = 0;
        }
        steer(member.state, member.aiming, pilot.memory, pilot.controls, flying);
        // Braked on the way in, below the height a bird starts thinking about
        // its feet. Without it they arrive at cruise -- fourteen metres a
        // second against a landing limit of ten -- and every one of them
        // writes itself off, which is not "a few of them make a mess of it",
        // it is a flock falling out of the sky.
        //
        // Wings and tail spread, which is what the brake is: a real pigeon
        // does the same thing on the same part of the approach.
        if (member.state.position.y < LANDING_FLARE) {
          pilot.controls.brake = true;
          pilot.controls.tuck = false;
          // And beating, in the last few metres. Measured: braking alone
          // brought them in at six or seven metres a second, which is well
          // inside the ten the legs will take -- and sinking at five, which
          // is not inside the four they will. Every one of them wrote itself
          // off on the sink alone.
          //
          // Beating is what arrests a sink; pulling the nose up at this
          // height is what the game's own approach instruction says not to
          // do, and for the same reason.
          if (member.state.position.y < LANDING_BEAT) pilot.controls.flap = true;
        }
        step(member.state, pilot.controls, flight, dt, collider, wind);
        member.state.health = 1;
        // Just arrived, and the flight model has called it a crash. If it is
        // on the roof it was aiming at, it is not: see `land`. `standStill`
        // is the same call the game makes for a bird that is simply *there*.
        //
        // Read through a fresh binding because `step` is what sets it, and
        // the compiler cannot see inside a call: the branch above has already
        // narrowed this to null, so asking again would be asking `never`.
        const arrived = member.state.ending as Ending | null;
        if (
          arrived?.kind === 'crashed' &&
          Math.abs(member.state.position.y - landing.on) <= MISSED_BY
        ) {
          standStill(member.state);
        }
        continue;
      }

      // Waiting: either not let out yet, or down after hitting something.
      // Both are the same thing to everyone else -- a bird that is not in the
      // air -- so they are the same thing here.
      if (member.down > 0) {
        // Shut: the clock does not run either. Held at nought instead, the
        // wait would read as *out* to everything that asks -- `down <= 0` is
        // how the rest of the game knows a bird is in the air -- and a bird
        // that is out but has never been released is drawn sitting at the
        // spawn point, motionless, in the middle of the shot.
        if (!letting) continue;
        member.down -= dt;
        if (member.down > 0) continue;
        release(pilot);
      }

      // Left behind for good: brought back rather than strung out for ever.
      const adrift = Math.hypot(
        member.state.position.x - at.x,
        member.state.position.z - at.z,
      );
      if (adrift > options.strayDistance && !member.hunting) {
        // Brought back is being let out again, so it waits with the rest --
        // but not while it is after something. A bird chasing a thing across
        // the district has not wandered off, and snatching it home mid-chase
        // is the one moment the seams would show.
        if (letting) release(pilot);
        continue;
      }

      // --- Going for something ---------------------------------------------
      // Checked before the wheeling, because a bird that has seen something
      // stops wheeling. The rules are the hunt's: near enough, and high
      // enough to be worth leaving the sky for.
      const hunt = options.hunt;
      if (hunt) {
        const quarry = hunt.quarry();
        const away = quarry
          ? Math.hypot(
              member.state.position.x - quarry.x,
              member.state.position.y - quarry.y,
              member.state.position.z - quarry.z,
            )
          : Infinity;

        if (member.hunting && (!quarry || away > hunt.loses)) {
          // Lost it: too far off, or gone altogether.
          member.hunting = false;
          aim(pilot, wheelAbout(at));
        } else if (!member.hunting && quarry && quarry.y > hunt.above && away <= hunt.within) {
          // Seen. Once it is after something it stays after it: diving does
          // not call off an attack that has begun, it decides whether the
          // next one starts.
          member.hunting = true;
          pilot.chasing = 0;
        }

        // Aimed here rather than in either branch above, so that being after
        // something and being pointed at it are the same instant. Split
        // between the two, a bird spent the tick it noticed you still flying
        // at wherever it had been wandering.
        if (member.hunting && quarry) {
          // At the bird itself, re-worked every tick, so the point it is
          // flying at moves with what it is chasing rather than being where
          // that was a moment ago.
          //
          // Except downwards. It will not aim below its floor, which is the
          // whole of the safety in this: a pigeon on the deck has a crow
          // keeping station over it rather than a crow arriving.
          member.aiming = {
            x: quarry.x,
            z: quarry.z,
            altitude: Math.max(quarry.y, hunt.floor),
          };
          pilot.chasing = 0;
        }
      }

      // Arrived, or given up on it: somewhere else near the leader, who has
      // moved on since. Not while it is going for something -- that has its
      // own aim and its own reason to stop.
      pilot.chasing += dt;
      if (
        !member.hunting &&
        (distanceTo(member.state, member.aiming) < options.arrivalRadius ||
          pilot.chasing > options.attentionSpan)
      ) {
        aim(pilot, wheelAbout(at));
      }

      // A bird that is after something is moved rather than flown. Everything
      // else in this game obeys the aerodynamics; this one thing does not,
      // deliberately, because a hunting bird that obeyed them could not hunt.
      if (member.hunting && hunt) {
        dive(member.state, member.aiming, hunt, flight, dt);
        member.state.health = 1;
        continue;
      }

      steer(member.state, member.aiming, pilot.memory, pilot.controls, flying);
      step(member.state, pilot.controls, flight, dt, collider, wind);
      // The flock does not eat. The belly is the hero's problem: it is the
      // reason to go and find grain, and there is no grain in a level for
      // these ones to find. A scenery bird with an empty belly stops
      // recovering, stops holding height, and comes down in the middle of
      // somebody's level -- which is the flock failing at the one thing it
      // is for. They are a visual effect, and a visual effect does not
      // starve.
      member.state.health = 1;

      if (member.state.ending) {
        pilot.fell = { ...member.state.position };
        member.down = options.respawnDelay;
        // Nothing to wait for: back in the air on the spot, unless the loft
        // is shut, in which case it lies where it fell.
        if (member.down <= 0 && letting) release(pilot);
      }
    }
  }

  function recall() {
    // Back in the air, if they were ever asked down. `land` is a one-way door
    // on purpose -- a bird that has put down must not be sent back up by the
    // player taking off again -- but a recall is the other kind of moment
    // entirely: the flock is being started over. Left set, the landing
    // outlived the level that asked for it, and the one bird let out on the
    // level after spent the ever after trying to touch down on a roof a
    // kilometre behind her.
    land(null);
    pilots.forEach((pilot, i) => {
      // Anything above nought reads as "not in the air" to everything else,
      // which is what puts them away; the timer is what spaces them out.
      pilot.member.down = i * options.emitInterval + 1e-3;
    });
  }

  function touching(at: { x: number; y: number; z: number }, within: number) {
    return pilots.some(({ member }) => {
      // A bird that is waiting its turn or lying dead is not touching
      // anything: it is not in the air, whatever its last position says.
      if (member.down > 0 || member.state.ending !== null) return false;
      return (
        Math.hypot(
          member.state.position.x - at.x,
          member.state.position.y - at.y,
          member.state.position.z - at.z,
        ) <= within
      );
    });
  }

  /** Where they are coming down, or null while they are flying. */
  let landing: { x: number; z: number; on: number } | null = null;
  /** Each one's own patch of ground, once it is down. */
  const wanders = new Map<Pilot, Wander>();
  const walking = new Map<Pilot, WalkControls>();

  const land = (around: { x: number; z: number; on: number } | null) => {
    landing = around;
    if (around) return;
    wanders.clear();
    walking.clear();
  };

  const scramble = (from: readonly Vec3[]) => {
    if (from.length === 0) return;
    const at = around();
    pilots.forEach((pilot, i) => {
      if (i >= wanted) return;
      const where = from[i % from.length]!;
      // Facing the way the leader is: they are leaving with him, and thirty
      // birds coming off a train in thirty directions is a startle rather
      // than a departure.
      pilot.member.state = createBird(where, 12 + rand() * 4, at.heading);
      pilot.member.down = 0;
      pilot.member.hunting = false;
      pilot.memory.beating = true;
      aim(pilot, wheelAbout(at));
    });
  };

  const only = (many: number) => {
    wanted = Math.max(0, Math.min(pilots.length, Math.floor(many)));
  };

  const wheel = (to: { radius: number; ahead: number }) => {
    ball = { radius: Math.max(0, to.radius), ahead: to.ahead };
  };

  return {
    members: pilots.map((pilot) => pilot.member),
    update,
    recall,
    touching,
    only,
    wheel,
    scramble,
    land,
  };
}
