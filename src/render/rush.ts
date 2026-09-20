/**
 * The air, made visible: short white streaks flying past at speed.
 *
 * Speed is not a number, it is something going past. A hundred metres up
 * there is nothing near enough to go past -- the city crawls because it is
 * four hundred metres away, and no camera angle changes that, which is what
 * tipping the shot down turned out not to fix. The answer is to put something
 * *near*. These are a few hundred motes of air a handful of metres from the
 * lens, and at four hundred kilometres an hour they cross the frame in a
 * tenth of a second, which is exactly the sensation that was missing.
 *
 * They are not weather and they are not real: nothing else in the game can
 * see them, they are drawn nowhere but in front of this camera, and below a
 * hundred kilometres an hour there are none at all. A pigeon flying at
 * pigeon speed through a sky full of streaks would be a pigeon in a snowstorm.
 */

import * as THREE from 'three';

export interface AirStreaks {
  readonly object: THREE.Object3D;
  /**
   * Move them, given where the camera is and what the bird is doing.
   *
   * `rush` is nought to one -- see `rushOf` -- and decides both how many are
   * drawn and how solid they are, so they arrive and leave with the speed
   * rather than switching on.
   */
  update(
    at: { x: number; y: number; z: number },
    heading: { x: number; y: number; z: number },
    speed: number,
    rush: number,
  ): void;
  dispose(): void;
}

/** How many there are at most, and the air they fill, in metres. */
const MOST = 320;
const AHEAD = 46;
const BEHIND = 6;
const ACROSS = 16;

/**
 * How long one is, in seconds of flight.
 *
 * A streak is the air a mote of it covers while the shutter is open, so its
 * length is a time rather than a distance: 0.055 s is two metres at a hundred
 * kilometres an hour and four and a half at three hundred, and a streak that
 * grows as he speeds up is the whole of the effect.
 */
const EXPOSURE = 0.055;

/**
 * Where a mote goes when it is done with.
 *
 * Somewhere in the disc ahead of the camera, at a distance drawn so they are
 * spread evenly through the air rather than piled at the near end -- the cube
 * root, because a slab of air twice as far away holds more of them.
 */
export function placeAhead(
  at: { x: number; y: number; z: number },
  heading: { x: number; y: number; z: number },
  random: () => number,
): { x: number; y: number; z: number } {
  // Any two directions across the heading. The first is the heading turned
  // flat, which is square to it for anything but straight up.
  let sideX = -heading.z;
  let sideZ = heading.x;
  const flat = Math.hypot(sideX, sideZ);
  if (flat < 1e-4) {
    sideX = 1;
    sideZ = 0;
  } else {
    sideX /= flat;
    sideZ /= flat;
  }
  const upX = heading.y * sideZ - heading.z * 0;
  const upY = heading.z * sideX - heading.x * sideZ;
  const upZ = heading.x * 0 - heading.y * sideX;
  const upLength = Math.hypot(upX, upY, upZ) || 1;

  const angle = random() * Math.PI * 2;
  const out = ACROSS * Math.sqrt(random());
  const along = -BEHIND + (AHEAD + BEHIND) * Math.cbrt(random());
  const across = Math.cos(angle) * out;
  const over = Math.sin(angle) * out;
  return {
    x: at.x + heading.x * along + sideX * across + (upX / upLength) * over,
    y: at.y + heading.y * along + (upY / upLength) * over,
    z: at.z + heading.z * along + sideZ * across + (upZ / upLength) * over,
  };
}

/** Whether a mote has been left behind, or is too far out to be worth drawing. */
export function spent(
  mote: { x: number; y: number; z: number },
  at: { x: number; y: number; z: number },
  heading: { x: number; y: number; z: number },
): boolean {
  const dx = mote.x - at.x;
  const dy = mote.y - at.y;
  const dz = mote.z - at.z;
  const along = dx * heading.x + dy * heading.y + dz * heading.z;
  if (along < -BEHIND || along > AHEAD + 4) return true;
  // How far off the line of flight, by Pythagoras on the part along it.
  const square = dx * dx + dy * dy + dz * dz - along * along;
  return square > (ACROSS + 2) * (ACROSS + 2);
}

export function createAirStreaks(random: () => number = Math.random): AirStreaks {
  // A stick a metre long down +Z, stretched per instance to the length the
  // speed earns it. Three-sided: nothing about a streak needs a fourth face,
  // and at three hundred and twenty of them that is a thousand triangles
  // saved for nothing given up.
  const shape = new THREE.CylinderGeometry(0.035, 0.035, 1, 3, 1, true);
  shape.rotateX(Math.PI / 2);
  const paint = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    // It is air. Nothing is lit by it and nothing hides behind it.
    fog: false,
  });
  const mesh = new THREE.InstancedMesh(shape, paint, MOST);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.renderOrder = 8;

  const motes = Array.from({ length: MOST }, () => ({ x: 0, y: 0, z: 0 }));
  let seeded = false;

  const matrix = new THREE.Matrix4();
  const place = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const size = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const ahead = new THREE.Vector3(0, 0, 1);

  return {
    object: mesh,
    update(at, heading, speed, rush) {
      if (rush <= 0.02) {
        mesh.count = 0;
        paint.opacity = 0;
        seeded = false;
        return;
      }
      // Filled in wherever the bird happens to be when it first goes fast
      // enough, rather than trailing in from wherever it was before.
      if (!seeded) {
        for (const mote of motes) Object.assign(mote, placeAhead(at, heading, random));
        seeded = true;
      }

      forward.set(heading.x, heading.y, heading.z).normalize();
      turn.setFromUnitVectors(ahead, forward);
      const long = Math.max(0.6, speed * EXPOSURE);
      size.set(1, 1, long);

      // Drawn thickest at the top of the range and never solid: what sells
      // this is how fast they cross the frame, and a windscreen of white
      // sticks is a windscreen.
      paint.opacity = 0.16 + 0.24 * rush;

      const showing = Math.round(MOST * rush);
      for (let i = 0; i < showing; i += 1) {
        const mote = motes[i]!;
        if (spent(mote, at, forward)) Object.assign(mote, placeAhead(at, forward, random));
        place.set(mote.x, mote.y, mote.z);
        matrix.compose(place, turn, size);
        mesh.setMatrixAt(i, matrix);
      }
      mesh.count = showing;
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      shape.dispose();
      paint.dispose();
    },
  };
}
