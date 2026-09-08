/**
 * A border collie, built the way everything else in this world is built.
 *
 * Boxes, flat-shaded, in four colours -- and the four are the whole of what
 * makes it a collie rather than a dog: black over the back and the top of the
 * head, white under the chin and down the chest, white feet, and a white tip
 * on the tail. That marking is the most recognisable thing about the breed at
 * a distance, and a distance is where this will mostly be seen.
 *
 * Three times a pigeon, which is about right for both animals: fifty-five
 * centimetres at the shoulder against a pigeon's twenty at the head, and
 * seventy long against a quarter of a metre. Standing next to one it is a
 * dog and the pigeon is a bird, which is the only scale check that matters.
 *
 * The legs are the only moving part. They are four groups swung about their
 * hips from one number -- how far the dog has walked -- so the gait comes out
 * of the ground covered rather than out of the clock, exactly as the pigeon's
 * stride does: a dog standing still has its feet still, and one being shoved
 * along paddles.
 */

import * as THREE from 'three';
import { painted, type Piece } from './painted';

/** Where a dog is and how far through its stride, for the rig to draw. */
export interface DogPose {
  x: number;
  y: number;
  z: number;
  /** Which way it faces, in radians clockwise from north, like the bird. */
  facing: number;
  /** How far through the gait, 0 to 1, advanced by ground covered. */
  stridePhase: number;
}

export interface DogRig {
  object: THREE.Object3D;
  update(pose: DogPose): void;
  dispose(): void;
}

/** Shoulder height, in metres: a collie, and three pigeons. */
export const DOG_HEIGHT = 0.55;

const COAT = 0x2f3034;
const WHITE = 0xeceae4;
const NOSE = 0x171719;
const TONGUE = 0x9c5c62;

/**
 * How far a leg swings fore and aft, in radians.
 *
 * Two thirds of a radian is a long walking stride and well short of a run.
 * The gait is a walk: this animal is standing about on a square, not working
 * sheep.
 */
const SWING = 0.62;
/** How far the paw comes up on the forward half of its swing, in metres. */
const LIFT = 0.055;

/**
 * One dog, standing still, as a single geometry.
 *
 * The rig above is four hinged legs and a body, which is what a dog that
 * walks needs and is far too much for the ones on the tram platforms: there
 * are eighty of those, they never move, and eighty rigs is five hundred draw
 * calls for scenery. Merged flat, they are one instanced mesh.
 *
 * Built out of the same boxes in the same places, with the legs standing
 * where the rig rests them, so the two are the same animal.
 */
export function standingDogGeometry(): THREE.BufferGeometry {
  const box = (
    color: number,
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
  ): Piece => {
    const part = new THREE.BoxGeometry(width, height, depth);
    part.translate(x, y, z);
    return { geometry: part, color };
  };

  const BACK = DOG_HEIGHT - 0.11;
  const drop = DOG_HEIGHT - 0.09 - 0.11;
  const pieces: Piece[] = [
    box(COAT, 0.2, 0.23, 0.34, 0, BACK, 0.08),
    box(COAT, 0.22, 0.26, 0.2, 0, BACK - 0.01, -0.14),
    box(WHITE, 0.17, 0.1, 0.22, 0, BACK - 0.14, -0.13),
    box(COAT, 0.15, 0.17, 0.16, 0, BACK + 0.11, -0.26),
    box(WHITE, 0.1, 0.09, 0.14, 0, BACK + 0.04, -0.28),
    box(COAT, 0.13, 0.13, 0.16, 0, BACK + 0.2, -0.37),
    box(WHITE, 0.045, 0.13, 0.15, 0, BACK + 0.21, -0.38),
    box(WHITE, 0.075, 0.075, 0.13, 0, BACK + 0.16, -0.49),
    box(NOSE, 0.05, 0.045, 0.03, 0, BACK + 0.175, -0.56),
    box(TONGUE, 0.035, 0.02, 0.06, 0, BACK + 0.132, -0.51),
    box(COAT, 0.045, 0.075, 0.035, -0.055, BACK + 0.29, -0.33),
    box(COAT, 0.045, 0.075, 0.035, 0.055, BACK + 0.29, -0.33),
    box(COAT, 0.045, 0.03, 0.05, -0.055, BACK + 0.33, -0.35),
    box(COAT, 0.045, 0.03, 0.05, 0.055, BACK + 0.33, -0.35),
    box(COAT, 0.06, 0.07, 0.2, 0, BACK - 0.06, 0.31),
    box(WHITE, 0.05, 0.055, 0.09, 0, BACK - 0.12, 0.43),
  ];
  for (const [side, along] of [
    [-0.085, -0.16],
    [0.085, 0.2],
    [0.085, -0.16],
    [-0.085, 0.2],
  ] as [number, number][]) {
    const hip = BACK - 0.09;
    pieces.push(
      box(COAT, 0.062, drop * 0.55, 0.075, side, hip - drop * 0.28, along),
      box(WHITE, 0.05, drop * 0.5, 0.055, side, hip - drop * 0.75, along),
      box(WHITE, 0.06, 0.045, 0.095, side, hip - drop - 0.02, along - 0.01),
    );
  }
  return painted(pieces);
}

export function createDogRig(): DogRig {
  const disposables: { dispose(): void }[] = [];
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  disposables.push(material);

  const box = (
    color: number,
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
  ): Piece => {
    const part = new THREE.BoxGeometry(width, height, depth);
    part.translate(x, y, z);
    return { geometry: part, color };
  };

  const solid = (pieces: readonly Piece[]) => {
    const geometry = painted(pieces);
    disposables.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    return mesh;
  };

  const object = new THREE.Group();

  // --- Body, neck and head --------------------------------------------------
  // Facing -Z, like the bird and the person, so one convention turns them all.
  const BACK = DOG_HEIGHT - 0.11;
  object.add(
    solid([
      // The barrel, deeper at the chest than at the loin, which is most of
      // what makes a dog shape rather than a box on legs.
      box(COAT, 0.2, 0.23, 0.34, 0, BACK, 0.08),
      box(COAT, 0.22, 0.26, 0.2, 0, BACK - 0.01, -0.14),
      // White under it: the chest and the belly, seen from in front and from
      // below, which between them is most of the time.
      box(WHITE, 0.17, 0.1, 0.22, 0, BACK - 0.14, -0.13),
      // The neck, rising forward out of the shoulders.
      box(COAT, 0.15, 0.17, 0.16, 0, BACK + 0.11, -0.26),
      box(WHITE, 0.1, 0.09, 0.14, 0, BACK + 0.04, -0.28),
      // The head: a skull, a muzzle in front of it, and a black nose.
      box(COAT, 0.13, 0.13, 0.16, 0, BACK + 0.2, -0.37),
      box(WHITE, 0.045, 0.13, 0.15, 0, BACK + 0.21, -0.38),
      box(WHITE, 0.075, 0.075, 0.13, 0, BACK + 0.16, -0.49),
      box(NOSE, 0.05, 0.045, 0.03, 0, BACK + 0.175, -0.56),
      box(TONGUE, 0.035, 0.02, 0.06, 0, BACK + 0.132, -0.51),
      // Ears: half up, half tipped over, which is the collie's own.
      box(COAT, 0.045, 0.075, 0.035, -0.055, BACK + 0.29, -0.33),
      box(COAT, 0.045, 0.075, 0.035, 0.055, BACK + 0.29, -0.33),
      box(COAT, 0.045, 0.03, 0.05, -0.055, BACK + 0.33, -0.35),
      box(COAT, 0.045, 0.03, 0.05, 0.055, BACK + 0.33, -0.35),
      // The tail, carried low and finished in white.
      box(COAT, 0.06, 0.07, 0.2, 0, BACK - 0.06, 0.31),
      box(WHITE, 0.05, 0.055, 0.09, 0, BACK - 0.12, 0.43),
    ]),
  );

  // --- Legs -----------------------------------------------------------------
  // Four groups, hung from the hips and swung from one number. The order is
  // the one the gait needs: front left, rear right, front right, rear left --
  // diagonal pairs, so alternate entries move together.
  const hips: THREE.Group[] = [];
  const rest: number[] = [];
  const places: [number, number][] = [
    [-0.085, -0.16],
    [0.085, 0.2],
    [0.085, -0.16],
    [-0.085, 0.2],
  ];

  for (const [side, along] of places) {
    const hip = new THREE.Group();
    hip.position.set(side, BACK - 0.09, along);
    const drop = DOG_HEIGHT - 0.09 - 0.11;
    hip.add(
      solid([
        // Upper leg in the coat's colour, lower leg and paw in white: a
        // collie is white-footed, and it is the part a walk cycle draws the
        // eye to.
        box(COAT, 0.062, drop * 0.55, 0.075, 0, -drop * 0.28, 0),
        box(WHITE, 0.05, drop * 0.5, 0.055, 0, -drop * 0.75, 0),
        box(WHITE, 0.06, 0.045, 0.095, 0, -drop - 0.02, -0.01),
      ]),
    );
    object.add(hip);
    hips.push(hip);
    rest.push(hip.position.y);
  }

  return {
    object,
    update(pose) {
      object.position.set(pose.x, pose.y, pose.z);
      object.rotation.set(0, -pose.facing, 0);

      const cycle = pose.stridePhase * Math.PI * 2;
      hips.forEach((hip, index) => {
        // Diagonal pairs, half a cycle apart: front left with rear right,
        // front right with rear left. It is the gait every four-legged animal
        // walks in, and getting it wrong -- both fronts together -- reads
        // instantly as a pantomime horse.
        const swing = Math.sin(cycle + (index < 2 ? 0 : Math.PI));
        hip.rotation.x = swing * SWING;
        // Up on the way forward and down on the way back, so the paw is only
        // off the ground while it is being carried.
        hip.position.y = rest[index]! + Math.max(0, swing) * LIFT;
      });
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
