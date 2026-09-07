/**
 * A camera move the game makes, while the player watches.
 *
 * The story needs him home, and the way home is nine hundred metres of park
 * he has already flown twice. Making the player fly it a third time to be
 * told something is making them do the homework for a plot point.
 *
 * So the camera goes, and he is simply there when it arrives. This started as
 * the other thing -- the bird flown home by the autopilot, the world sped up
 * six times around it -- and that version had to take off from standing, hold
 * a cruise it could climb out at, clear the roofs and not fly into anything,
 * all so that a pigeon nobody was steering could cross a park. A camera has
 * to do none of that. It cannot stall, it cannot hit a chimney, and it does
 * not care whether the world is running: what the player needs to understand
 * is *where they now are*, and a camera that flies there says it.
 *
 * What is left is an eased move between two framings, over an arc so that the
 * crossing is above the city rather than through it. There is no physics in
 * it at all, which is the point -- nothing here can fail in a way that leaves
 * the story somewhere it did not mean to be.
 */

/** A point in the world. Kept plain, so none of this needs a renderer. */
export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Where the camera stands, and what it is pointed at. */
export interface Framing {
  eye: Point3;
  look: Point3;
}

export interface Flyover {
  /** Advance by a frame, and say whether there is any of it left. */
  update(dt: number): boolean;
  /** Where the camera is now. */
  readonly framing: Framing;
  readonly playing: boolean;
  /** How far through it is, 0 to 1. */
  readonly progress: number;
  /**
   * End it now: the player has seen enough.
   *
   * Which means arriving, not stopping. Somebody who skips a journey wants to
   * be at the other end of it, so this leaves the camera on the closing shot
   * rather than halfway across the park.
   */
  cut(): void;
}

export interface Flying {
  /** How long the move takes, in seconds. */
  seconds?: number;
  /**
   * How high it arcs over the middle, in metres above the straight line.
   *
   * Both ends of this move are low -- a bird standing on concrete and a bird
   * standing on a branch -- so the straight line between them runs through
   * everything in the way. Up and over is also simply how it should look: a
   * camera leaving, crossing, and coming down.
   */
  arc?: number;
}

const SECONDS = 5;
const ARC = 60;

/**
 * How much sooner the aim arrives than the camera does.
 *
 * The camera turns towards home and *then* goes, which is both what was asked
 * for and the only version that is watchable. Moved together, the aim spends
 * the first half of the crossing still pointed at the concrete the bird was
 * standing on -- so the shot is a camera sixty metres up looking backwards
 * and down, and nine hundred metres of the eighth district goes past as
 * treetops. Leading by two and a half, the aim is on the tree by the time the
 * camera has covered a tenth of the way, and the rest is a travelling shot of
 * where the player is going.
 *
 * Four, so the turn is done a quarter of the way through -- a second and a
 * quarter of a five second move. At two and a half the turn took nearly half
 * the shot, which is a lot of a short scene spent swinging round.
 */
const LEAD = 4;

/** Eased at both ends, so it leaves and arrives rather than cutting to a speed. */
const smooth = (t: number): number => t * t * (3 - 2 * t);

const between = (a: number, b: number, t: number): number => a + (b - a) * t;

export function createFlyover(from: Framing, to: Framing, options: Flying = {}): Flyover {
  const seconds = options.seconds ?? SECONDS;
  const arc = options.arc ?? ARC;

  const framing: Framing = { eye: { ...from.eye }, look: { ...from.look } };
  let elapsed = 0;
  let playing = seconds > 0;

  /** Put the camera where it has got to, given how far through it is. */
  const place = (progress: number) => {
    const t = smooth(progress);
    framing.eye.x = between(from.eye.x, to.eye.x, t);
    framing.eye.z = between(from.eye.z, to.eye.z, t);
    // Over the top, and nothing at either end, so the arc lifts the crossing
    // without moving either of the two framings it was given.
    //
    // A parabola rather than the half sine this started as, for one reason: a
    // half sine is not exactly zero at its ends in floating point, and
    // `sin(PI)` left the closing shot a fraction of a nanometre above the one
    // the camera is supposed to land on. 4t(1-t) is exactly zero at both ends
    // and exactly one in the middle, so "ends on the closing shot" can be
    // stated as equality rather than as nearly.
    framing.eye.y = between(from.eye.y, to.eye.y, t) + 4 * t * (1 - t) * arc;
    const aim = smooth(Math.min(1, progress * LEAD));
    framing.look.x = between(from.look.x, to.look.x, aim);
    framing.look.y = between(from.look.y, to.look.y, aim);
    framing.look.z = between(from.look.z, to.look.z, aim);
  };

  return {
    framing,
    get playing() {
      return playing;
    },
    get progress() {
      return seconds > 0 ? Math.min(1, elapsed / seconds) : 1;
    },
    cut() {
      place(1);
      elapsed = seconds;
      playing = false;
    },
    update(dt) {
      if (!playing) return false;
      elapsed += dt;
      if (elapsed >= seconds) {
        place(1);
        playing = false;
        return false;
      }
      place(elapsed / seconds);
      return true;
    },
  };
}
