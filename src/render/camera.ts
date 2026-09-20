/**
 * Spring-damped chase camera.
 *
 * This contributes more to feeling like a bird than the bird model does. The
 * camera deliberately lags behind acceleration and widens its field of view
 * with airspeed, which is what turns "the numbers went up" into "that was fast".
 */

import * as THREE from 'three';
import type { BirdState } from '../sim/flight';
import type { Vec3 } from '../sim/math3';

export interface CameraParams {
  /** Distance behind the bird, in metres. */
  distance: number;
  /** Height above the bird, in metres. */
  height: number;
  /** How far ahead of the bird the camera aims. */
  lookAhead: number;
  /** Half-life in seconds for the camera to close the gap to its ideal spot. */
  positionHalfLife: number;
  /** Half-life for the aim point, kept slightly tighter than position. */
  targetHalfLife: number;
  /** 0 keeps the horizon level, 1 rolls the camera fully with the bird. */
  rollFollow: number;
  /** Field of view at rest, in degrees. */
  baseFov: number;
  /** Extra degrees of FOV at top speed. */
  fovGain: number;
  /** Airspeed at which fovGain is fully applied, in m/s. */
  fovRefSpeed: number;
  /**
   * How far the shot is tipped down, in radians. Nought is level.
   *
   * Speed is a thing you see on the ground, not in the air: at a hundred
   * metres, level, a pigeon at four hundred kilometres an hour is a pigeon
   * hanging in front of a photograph. Tipped over so the streets are running
   * through the frame, the same flight is frightening. The angle is turned up
   * with airspeed -- see `rushOf` -- rather than with the rocket, because it
   * is about how fast he is going and not about how he got there.
   */
  pitchDown?: number;
}

export const defaultCameraParams: CameraParams = {
  distance: 1.7,
  height: 0.5,
  lookAhead: 9,
  positionHalfLife: 0.075,
  targetHalfLife: 0.05,
  rollFollow: 0.45,
  baseFov: 68,
  fovGain: 26,
  fovRefSpeed: 45,
};

/**
 * How to frame two birds that have met.
 *
 * A different shot from the chase entirely: the subject is not one bird going
 * somewhere, it is two of them standing together, so the camera comes off the
 * boom and stands to one side of them both.
 */
export interface WatchParams {
  /**
   * The least clear air to leave beyond the pair, in metres.
   *
   * The least, because the air is mostly a share of the pair itself: a third
   * again of however far apart they are. A fixed metre and a half is two
   * different shots depending on who is in it -- with two pigeons a metre
   * apart it is most of the frame, and they end up a pair of thumbnails in a
   * landscape, which is what the first delivery's two ends both looked like.
   */
  margin: number;
  /**
   * And the nearest it will ever stand, in metres.
   *
   * What the margin used to do on its own. Two birds can stand on the same
   * spot -- they are a body's width apart on a branch -- and a stand-off
   * worked out from how far apart they are would walk the lens into them.
   */
  nearest: number;
  /** How high above them it stands, in metres. */
  height: number;
  /**
   * How far below the middle of them it aims, in metres.
   *
   * The shot aims between the pair, which puts the middle of them at the
   * middle of the screen -- and the bottom third of the screen is the card
   * the conversation is printed on. Aiming a little low lifts both of them
   * clear of it. Half a metre, which at the stand-off a pair of pigeons gets
   * is about a seventh of the frame.
   */
  lift: number;
  /** Half-life for easing into and out of the shot, in seconds. */
  halfLife: number;
  /** Field of view for the two-shot, in degrees. */
  fov: number;
  /**
   * The ground under a point, where the shot has to stay above it.
   *
   * The two-shot stands off to the side of the pair and a metre above them,
   * which was exactly right while the city was flat. On a hillside the side
   * it picks is uphill as often as not, and a metre above two pigeons on a
   * slope is a foot underneath the slope: the first delivery starts in
   * Krisztinaváros, and the shot of the letter being handed over was a
   * screenful of dark green with a man standing in it.
   *
   * The terrain rather than the buildings. A conversation on a roof is held
   * thirty metres above ground that is not under it, and a camera shoved up
   * to the top of the next block would be looking down at the wrong thing.
   */
  floor?: (x: number, z: number) => number;
  /**
   * The top of whatever solid thing stands at a point, for finding a view.
   *
   * The shot has two sides to choose from and used to take whichever it was
   * already nearer, which is right until the thing on that side is a tree.
   * The first delivery is handed over in the middle of Vérmező, which is a
   * field of twelve-metre conifers, and the whole conversation was played to
   * a screenful of dark green a metre from the lens.
   *
   * So both sides are tried, at the full stand-off and then at two thirds of
   * it, and what is asked of each is whether anything stands above the line
   * from there to the pair. Asked of the collider rather than the terrain --
   * trees, walls, the sides of buildings are what get in the way, and none
   * of them is the ground.
   */
  solid?: (x: number, z: number) => number;
}

/** How much of the pair's own span is left as air around it. */
const AIR = 0.35;

export const defaultWatchParams: WatchParams = {
  margin: 0.55,
  nearest: 2,
  lift: 0.45,
  height: 0.9,
  halfLife: 0.35,
  fov: 50,
};

export interface ChaseCamera {
  /**
   * Follow the bird from the boom.
   *
   * `riding` says the bird is standing on something rather than flying, and
   * what it buys is a stand-off that does not depend on how fast the ground
   * is going. The easing here is what makes flight feel like flight -- the
   * camera lags acceleration on purpose -- but lag against a *perch* is not a
   * feel, it is an error: an eased camera trails a subject moving steadily by
   * about `speed x halfLife / ln 2`, so a pigeon standing on a tram at ten
   * metres a second was framed eleven metres back, and closed to three the
   * moment it took a step, because a walking bird eases six times faster than
   * a standing one. Riding shifts the camera by however far the bird was
   * carried before any easing, which leaves the easing only the gap it is
   * actually for.
   */
  update(state: BirdState, params: CameraParams, dt: number, riding?: boolean): void;
  /**
   * Frame two birds together, easing from wherever the camera is.
   *
   * Shares the boom's own position and aim, so going into the shot and coming
   * back out of it are the same easing that follows the bird -- there is no
   * cut, and nothing to blend between two cameras.
   */
  watch(a: Vec3, b: Vec3, params: WatchParams, dt: number): void;
  /** Jump straight to the ideal pose, with no easing. */
  snap(state: BirdState, params: CameraParams): void;
  /**
   * The point it is looking at, right now.
   *
   * For anything that has to hand the shot back without a jump. The boom does
   * not aim at the bird -- it aims `lookAhead` metres past it, which is what
   * puts the bird low in frame with the ground it is flying at above it -- so
   * a caller that framed the bird itself and then let go would turn the camera
   * on the frame it let go. That was the seam at the end of every scene.
   */
  aim(): Vec3;
}

/**
 * Where a camera should stand to hold two points in frame, and what to aim at.
 *
 * Side on rather than over either shoulder: a two-shot taken from behind one
 * of them is a shot of the back of a pigeon. The stand-off comes from the
 * angle the pair subtends, so they fill the same part of the frame whether
 * they are touching or a wing apart.
 *
 * Of the two sides it could stand on, it takes the one it is already nearer,
 * so walking round somebody does not send the camera swinging through them.
 */
export function twoShot(
  a: Vec3,
  b: Vec3,
  from: Vec3,
  params: WatchParams,
): { position: Vec3; target: Vec3 } {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
  // What it aims at: a little under them, so the pair rides above the card
  // the conversation is printed on. See `WatchParams.lift`.
  const look = { x: mid.x, y: mid.y - params.lift, z: mid.z };

  const alongX = b.x - a.x;
  const alongZ = b.z - a.z;
  const span = Math.hypot(alongX, alongZ, b.y - a.y);

  // Far enough back that the pair plus its air fits the frame, and never
  // nearer than the lens is allowed to be.
  const half = (params.fov / 2) * (Math.PI / 180);
  const air = Math.max(params.margin, span * AIR);
  const back = Math.max(params.nearest, (span / 2 + air) / Math.tan(half));

  // Across the line between them, in the ground plane.
  let outX = -alongZ;
  let outZ = alongX;
  const length = Math.hypot(outX, outZ);
  if (length < 1e-6) {
    // Standing on top of each other: any side will do, so keep the one the
    // camera is on rather than picking north every time.
    outX = from.x - mid.x;
    outZ = from.z - mid.z;
    const away = Math.hypot(outX, outZ);
    if (away < 1e-6) return { position: { x: mid.x, y: mid.y + back, z: mid.z }, target: look };
    outX /= away;
    outZ /= away;
  } else {
    outX /= length;
    outZ /= length;
    // The near side of the two.
    if ((from.x - mid.x) * outX + (from.z - mid.z) * outZ < 0) {
      outX = -outX;
      outZ = -outZ;
    }
  }

  /** Where the camera would stand, on a side and at a share of the stand-off. */
  const stand = (sx: number, sz: number, of: number) => {
    const x = mid.x + sx * back * of;
    const z = mid.z + sz * back * of;
    // Above the pair, and never below the ground it is standing over: see
    // `WatchParams.floor`. The same clearance both ways, so a shot that is
    // pushed up by a hill is still a shot taken from a person's height.
    const above = params.floor ? params.floor(x, z) + params.height : -Infinity;
    return { x, y: Math.max(mid.y + params.height, above), z };
  };

  /**
   * Whether the pair can be seen from there.
   *
   * The line from the lens to the middle of them, sampled: anything standing
   * above it is between the two, and a tree between the camera and the
   * subject is the entire picture. The ends are left out -- the pair's own
   * perch is under them by definition, and the ground the camera stands on
   * has already lifted it.
   */
  const sees = (from: { x: number; y: number; z: number }) => {
    const solid = params.solid;
    if (!solid) return true;
    if (solid(from.x, from.z) > from.y) return false;
    for (let t = 0.15; t < 0.9; t += 0.15) {
      const x = from.x + (mid.x - from.x) * t;
      const z = from.z + (mid.z - from.z) * t;
      if (solid(x, z) > from.y + (mid.y - from.y) * t) return false;
    }
    return true;
  };

  // Where it would rather stand, in the order it would rather stand there:
  // the near side square on, the far side square on, then round from each by
  // a third of a right angle and by two thirds of one, and then the whole
  // list again from two thirds as far. Square on is the shot; the rest are
  // what a camera operator does when there is a tree in the way, which in
  // Vérmező there always is. If none of them is clear the first is kept --
  // there is nowhere better to be, and it is where the easing was heading.
  const turned = (by: number, of: number) => {
    const sin = Math.sin(by);
    const cos = Math.cos(by);
    return stand(outX * cos - outZ * sin, outX * sin + outZ * cos, of);
  };
  const ROUND = [0, Math.PI, 0.6, -0.6, Math.PI + 0.6, Math.PI - 0.6, 1.2, -1.2];
  let position = turned(0, 1);
  for (const of of [1, 2 / 3]) {
    const clear = ROUND.map((by) => turned(by, of)).find(sees);
    if (clear) {
      position = clear;
      break;
    }
  }
  return { position, target: look };
}

/**
 * How fast he is going, as nought to one, for everything that answers to it.
 *
 * Nought below `from`, one above `to`, and eased at both ends so the shot
 * does not start moving the instant the number is crossed. A hundred to three
 * hundred kilometres an hour is where it runs: under a hundred he is flying,
 * over three hundred he is a missile, and the whole of the difference belongs
 * in between.
 */
export const rushOf = (speed: number, from: number, to: number): number => {
  const t = Math.min(1, Math.max(0, (speed - from) / Math.max(to - from, 1e-6)));
  return t * t * (3 - 2 * t);
};

/** Frame-rate independent smoothing factor for a given half-life. */
const smoothing = (halfLife: number, dt: number) =>
  halfLife <= 0 ? 1 : 1 - Math.pow(2, -dt / halfLife);

export function createChaseCamera(camera: THREE.PerspectiveCamera): ChaseCamera {
  const position = new THREE.Vector3();
  const target = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  // Scratch objects, reused every frame to keep the loop allocation-free.
  const birdPos = new THREE.Vector3();
  const birdQuat = new THREE.Quaternion();
  const forward = new THREE.Vector3();
  const birdUp = new THREE.Vector3();
  const desiredPos = new THREE.Vector3();
  const desiredTarget = new THREE.Vector3();
  const desiredUp = new THREE.Vector3();
  const look = new THREE.Vector3();
  const across = new THREE.Vector3();

  let initialised = false;
  /** Where the pair was last frame, so the shot can be carried along with it. */
  const carried = new THREE.Vector3();
  let carrying = false;
  /** And where the bird was, for the same reason on the boom. */
  const rode = new THREE.Vector3();
  let riding = false;

  function computeIdeal(state: BirdState, params: CameraParams) {
    birdPos.set(state.position.x, state.position.y, state.position.z);
    birdQuat.set(
      state.orientation.x,
      state.orientation.y,
      state.orientation.z,
      state.orientation.w,
    );

    forward.set(0, 0, -1).applyQuaternion(birdQuat);
    birdUp.set(0, 1, 0).applyQuaternion(birdQuat);

    // The boom hangs from world up rather than the bird's up, so a barrel roll
    // spins the bird in frame instead of whipping the camera around it.
    desiredPos
      .copy(birdPos)
      .addScaledVector(forward, -params.distance)
      .addScaledVector(up, params.height);

    desiredTarget.copy(birdPos).addScaledVector(forward, params.lookAhead);

    // And tipped down, about the horizontal across the shot, so what is
    // framed is the ground he is crossing rather than the sky he is under.
    const tip = params.pitchDown ?? 0;
    if (tip > 0.001) {
      look.copy(desiredTarget).sub(desiredPos);
      across.copy(look).cross(up);
      if (across.lengthSq() > 1e-9) {
        look.applyAxisAngle(across.normalize(), -tip);
        desiredTarget.copy(desiredPos).add(look);
      }
    }

    // Only part of the bank is carried into the camera roll. Full roll follow
    // is disorienting; none at all makes turns feel weightless.
    desiredUp.copy(up).lerp(birdUp, params.rollFollow).normalize();
  }

  function aim(): Vec3 {
    return { x: target.x, y: target.y, z: target.z };
  }

  function snap(state: BirdState, params: CameraParams) {
    computeIdeal(state, params);
    rode.copy(birdPos);
    riding = false;
    position.copy(desiredPos);
    target.copy(desiredTarget);
    camera.position.copy(position);
    camera.up.copy(desiredUp);
    camera.lookAt(target);
    camera.fov = params.baseFov;
    camera.updateProjectionMatrix();
    initialised = true;
  }

  function update(state: BirdState, params: CameraParams, dt: number, onSomething = false) {
    carrying = false;
    if (!initialised) {
      snap(state, params);
      riding = onSomething;
      return;
    }

    computeIdeal(state, params);

    // Carried along with the perch before any easing -- see `update` on
    // `ChaseCamera`. Only from the second frame of standing on something: the
    // frame the bird lands, the distance it travelled to get there is a
    // distance it flew, and shifting the camera by it would throw the camera
    // the length of the approach.
    if (onSomething && riding) {
      position.add(birdPos).sub(rode);
      target.add(birdPos).sub(rode);
    }
    rode.copy(birdPos);
    riding = onSomething;

    position.lerp(desiredPos, smoothing(params.positionHalfLife, dt));
    target.lerp(desiredTarget, smoothing(params.targetHalfLife, dt));
    camera.up.lerp(desiredUp, smoothing(params.positionHalfLife, dt)).normalize();

    camera.position.copy(position);
    camera.lookAt(target);

    const speed = Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z);
    const rush = Math.min(speed / params.fovRefSpeed, 1);
    const targetFov = params.baseFov + params.fovGain * rush * rush;
    if (Math.abs(camera.fov - targetFov) > 0.01) {
      camera.fov += (targetFov - camera.fov) * smoothing(0.25, dt);
      camera.updateProjectionMatrix();
    }
  }

  function watch(a: Vec3, b: Vec3, params: WatchParams, dt: number) {
    // Whatever the boom was riding is not this shot's business, and a stale
    // shift would be applied against a camera that has since been moved.
    riding = false;
    const ideal = twoShot(a, b, position, params);

    // Carried along with the pair before any easing.
    //
    // Without this the shot lags whatever the two of them are standing on. An
    // eased aim trails a moving subject by about `speed x halfLife / ln 2` --
    // on a wagon at 6 m/s that is three metres, and from a stand-off of four
    // it puts both birds hard against the edge of the frame and keeps them
    // there. Moving the camera by however far the pair moved leaves the
    // easing only the gap it is actually for, so a pair travelling at a
    // steady rate is framed exactly, standing still or doing sixty.
    if (carrying) {
      const shiftX = ideal.target.x - carried.x;
      const shiftY = ideal.target.y - carried.y;
      const shiftZ = ideal.target.z - carried.z;
      position.set(position.x + shiftX, position.y + shiftY, position.z + shiftZ);
      target.set(target.x + shiftX, target.y + shiftY, target.z + shiftZ);
    }
    carried.set(ideal.target.x, ideal.target.y, ideal.target.z);
    carrying = true;

    desiredPos.set(ideal.position.x, ideal.position.y, ideal.position.z);
    desiredTarget.set(ideal.target.x, ideal.target.y, ideal.target.z);

    const ease = smoothing(params.halfLife, dt);
    position.lerp(desiredPos, ease);
    target.lerp(desiredTarget, ease);
    camera.up.lerp(up, ease).normalize();

    camera.position.copy(position);
    camera.lookAt(target);

    if (Math.abs(camera.fov - params.fov) > 0.01) {
      camera.fov += (params.fov - camera.fov) * ease;
      camera.updateProjectionMatrix();
    }
  }

  return { update, watch, snap, aim };
}
