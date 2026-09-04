/**
 * Placeholder pigeon.
 *
 * Deliberately built from primitives: the point of this milestone is the flight
 * model, and a box you can read the orientation of beats a nice model you have
 * to wait for. Swap this whole module for a glTF load later -- everything else
 * only depends on `object` and `update`.
 */

import * as THREE from 'three';
import type { BirdState } from '../sim/flight';

/**
 * A feral pigeon is pale blue-grey, which is lucky, because a dark one is
 * invisible against a grey city seen from above. The white rump is real too,
 * and it is the single most useful marking here: the chase camera watches the
 * bird from behind, so the rump is the part you are looking at most of the
 * time.
 */
const BODY = 0x9fadbe;
const WING = 0xb3bfcc;
/** The two dark bars across a feral pigeon's wing, which give it shape. */
const WING_BAR = 0x5b6675;
const HEAD = 0xaebaca;
/** Iridescent neck, somewhere between green and violet depending on the light. */
const NECK = 0x3f9e7c;
const RUMP = 0xeef3f8;
const BEAK = 0xe8a54b;
const LEG = 0xd4735a;

/**
 * How much of its own colour the bird gives off.
 *
 * Not a light source, a floor: without it the bird falls to near-black in a
 * building's shadow, which is exactly where it is hardest to keep track of and
 * where losing it costs the most.
 */
const GLOW = 0.42;

/**
 * A pigeon's parts, so a whole bird can be recoloured in one go.
 */
export interface PigeonMorph {
  body: number;
  wing: number;
  bar: number;
  head: number;
  neck: number;
  rump: number;
  beak: number;
  leg: number;
}

const DEFAULT_MORPH: PigeonMorph = {
  body: BODY,
  wing: WING,
  bar: WING_BAR,
  head: HEAD,
  neck: NECK,
  rump: RUMP,
  beak: BEAK,
  leg: LEG,
};

/**
 * Feral pigeons come in a small, well-known set of colour schemes, and these
 * are those rather than an arbitrary palette: blue-bar is the wild type, then
 * the checker, spread (near-black), red and mealy variants, plus the pieds and
 * whites that come of a few centuries of escaped domestic stock.
 */
export const PIGEON_MORPHS: readonly PigeonMorph[] = [
  // Blue bar, the wild type.
  DEFAULT_MORPH,
  // Dark checker.
  { ...DEFAULT_MORPH, body: 0x77808f, wing: 0x8b95a3, bar: 0x3c4450, head: 0x848e9d },
  // Spread, near-black with a strong sheen.
  {
    ...DEFAULT_MORPH,
    body: 0x555d6b,
    wing: 0x616a78,
    bar: 0x2f3540,
    head: 0x5b6472,
    neck: 0x6d4f96,
    rump: 0x6f7886,
  },
  // Red, the rufous morph.
  {
    ...DEFAULT_MORPH,
    body: 0xb08a6e,
    wing: 0xc4a184,
    bar: 0x7d5b45,
    head: 0xbb9678,
    neck: 0x9c6a4e,
    rump: 0xe8d8c6,
  },
  // Mealy: pale body, darker wings.
  { ...DEFAULT_MORPH, body: 0xc3c8ce, wing: 0xa9b2bd, bar: 0x6b7482, head: 0xccd1d7 },
  // Pied, white with grey markings.
  {
    ...DEFAULT_MORPH,
    body: 0xe6ebf0,
    wing: 0xd3dae2,
    bar: 0x8b95a3,
    head: 0xeef2f6,
    neck: 0x4fa88a,
    rump: 0xffffff,
  },
  // White, the dovecote sort.
  {
    ...DEFAULT_MORPH,
    body: 0xf2f5f8,
    wing: 0xe8edf2,
    bar: 0xc9d2da,
    head: 0xf6f8fa,
    neck: 0xd8e2ea,
    rump: 0xffffff,
    beak: 0xe9b7a0,
  },
  // Grizzle, grey flecked with white.
  { ...DEFAULT_MORPH, body: 0xaeb6c1, wing: 0xc6cdd6, bar: 0x717b89, rump: 0xf4f8fb },
];

/**
 * How far the body sits above the feet when standing, in metres.
 *
 * The simulation tracks a point at the bird's centre and stops it at ground
 * level, which would bury half the model. This is the offset from that point
 * to where the body actually belongs -- a rendering concern, not a physical
 * one, so it lives here rather than in the flight model.
 */
const STANDING_HEIGHT = 0.14;

/** What the wings are doing, which is most of what the bird reads as. */
export type WingPose = 'tucked' | 'gliding' | 'braking' | 'perched';

export interface BirdRig {
  object: THREE.Object3D;
  update(state: BirdState, pose: WingPose, dt: number): void;
  dispose(): void;
}

const mix = (from: number, to: number, t: number): number => from + (to - from) * t;

export function createBirdRig(morph: PigeonMorph = DEFAULT_MORPH): BirdRig {
  const disposables: { dispose(): void }[] = [];
  const material = (color: number, glow = GLOW) => {
    const m = new THREE.MeshLambertMaterial({
      color,
      flatShading: true,
      // Lifts the bird off the background and stops shadow swallowing it.
      emissive: new THREE.Color(color).multiplyScalar(glow),
    });
    disposables.push(m);
    return m;
  };
  const geometry = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };
  const part = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    return mesh;
  };

  const object = new THREE.Group();

  const bodyMaterial = material(morph.body);
  const wingMaterial = material(morph.wing);
  const barMaterial = material(morph.bar, 0.2);
  const headMaterial = material(morph.head);

  // --- Body ---------------------------------------------------------------
  // Three tapering blocks rather than one: a pigeon is deepest at the breast
  // and narrows to the tail, and that taper is most of its silhouette.
  object.add(part(geometry(new THREE.BoxGeometry(0.115, 0.125, 0.14)), bodyMaterial, 0, 0, -0.06));
  object.add(part(geometry(new THREE.BoxGeometry(0.1, 0.105, 0.13)), bodyMaterial, 0, -0.004, 0.06));
  object.add(part(geometry(new THREE.BoxGeometry(0.07, 0.075, 0.07)), bodyMaterial, 0, -0.005, 0.15));

  // Fuller breast, low and forward, where the flight muscle sits.
  object.add(part(geometry(new THREE.BoxGeometry(0.105, 0.085, 0.12)), bodyMaterial, 0, -0.035, -0.085));

  // --- Head ---------------------------------------------------------------
  object.add(part(geometry(new THREE.BoxGeometry(0.078, 0.076, 0.086)), headMaterial, 0, 0.052, -0.172));
  // Rounder crown, so the head is not a plain cube.
  object.add(part(geometry(new THREE.BoxGeometry(0.058, 0.03, 0.066)), headMaterial, 0, 0.084, -0.174));

  // Iridescent throat, between the head and the shoulders.
  object.add(
    part(geometry(new THREE.BoxGeometry(0.09, 0.082, 0.075)), material(morph.neck, 0.3), 0, 0.03, -0.125),
  );

  const beakMaterial = material(morph.beak);
  const beak = new THREE.Mesh(geometry(new THREE.ConeGeometry(0.016, 0.055, 6)), beakMaterial);
  beak.rotation.x = -Math.PI / 2;
  beak.position.set(0, 0.045, -0.238);
  object.add(beak);
  // The cere: the pale wattle over a pigeon's bill.
  object.add(part(geometry(new THREE.BoxGeometry(0.03, 0.018, 0.02)), material(0xf0f4f8), 0, 0.058, -0.213));

  // Orange eyes, which is the detail that makes it look back at you.
  const eyeGeometry = geometry(new THREE.BoxGeometry(0.016, 0.016, 0.014));
  const eyeMaterial = material(0xd9772e, 0.55);
  const pupilGeometry = geometry(new THREE.BoxGeometry(0.009, 0.009, 0.008));
  const pupilMaterial = material(0x1a1a1e, 0.05);
  for (const side of [-1, 1] as const) {
    object.add(part(eyeGeometry, eyeMaterial, side * 0.036, 0.062, -0.192));
    object.add(part(pupilGeometry, pupilMaterial, side * 0.043, 0.062, -0.194));
  }

  // Pale rump over the base of the tail: the part the chase camera sees most.
  object.add(part(geometry(new THREE.BoxGeometry(0.098, 0.036, 0.1)), material(morph.rump, 0.5), 0, 0.05, 0.115));

  // --- Tail ---------------------------------------------------------------
  // Separate feathers on a shared pivot, so it can fan as well as tilt.
  const tail = new THREE.Group();
  tail.position.set(0, 0.012, 0.19);
  const featherGeometry = geometry(new THREE.BoxGeometry(0.028, 0.008, 0.15));
  const feathers: THREE.Mesh[] = [];
  for (let i = -2; i <= 2; i += 1) {
    const feather = new THREE.Mesh(featherGeometry, wingMaterial);
    feather.position.set(i * 0.025, 0, 0.07);
    feather.castShadow = true;
    feather.userData['fan'] = i;
    tail.add(feather);
    feathers.push(feather);
  }
  object.add(tail);

  // --- Wings --------------------------------------------------------------
  // Two sections with a wrist between them. The outer half trails the inner
  // through the beat, which is what a wingbeat actually looks like and what a
  // single rigid plank never will.
  const innerGeometry = geometry(new THREE.BoxGeometry(0.17, 0.015, 0.175));
  const outerGeometry = geometry(new THREE.BoxGeometry(0.17, 0.011, 0.125));
  const barGeometry = geometry(new THREE.BoxGeometry(0.15, 0.008, 0.02));

  interface Wing {
    shoulder: THREE.Group;
    wrist: THREE.Group;
  }

  const makeWing = (side: 1 | -1): Wing => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.048, 0.032, -0.02);

    shoulder.add(part(innerGeometry, wingMaterial, side * 0.085, 0, 0.005));
    // Two dark bars across a pale wing: real, and they give the wing a shape
    // to read at a distance instead of a flat slab.
    for (const z of [0.032, 0.062]) {
      shoulder.add(part(barGeometry, barMaterial, side * 0.085, 0.01, z));
    }

    const wrist = new THREE.Group();
    wrist.position.set(side * 0.17, 0, 0);
    // Primaries, swept a little back from the arm.
    wrist.add(part(outerGeometry, wingMaterial, side * 0.086, 0, 0.022));
    wrist.add(part(barGeometry, barMaterial, side * 0.086, 0.008, 0.055));
    shoulder.add(wrist);

    object.add(shoulder);
    return { shoulder, wrist };
  };

  const wings = { left: makeWing(-1), right: makeWing(1) };

  // --- Legs ---------------------------------------------------------------
  const legGeometry = geometry(new THREE.BoxGeometry(0.013, 0.075, 0.013));
  const footGeometry = geometry(new THREE.BoxGeometry(0.022, 0.008, 0.042));
  const legMaterial = material(morph.leg);
  const legs: THREE.Group[] = [];
  for (const side of [-1, 1] as const) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.026, -0.05, 0.012);
    hip.add(part(legGeometry, legMaterial, 0, -0.038, 0));
    hip.add(part(footGeometry, legMaterial, 0, -0.077, -0.008));
    object.add(hip);
    legs.push(hip);
  }

  // Smoothed wing pose on one axis: -1 folded, 0 gliding, +1 braking.
  let pose = 0;
  // Separate axis for standing, which is about the whole body, not the wings.
  let stand = 0;

  function update(state: BirdState, wingPose: WingPose, dt: number) {
    const standing = wingPose === 'perched';
    stand += ((standing ? 1 : 0) - stand) * Math.min(1, dt * 7);

    object.position.set(
      state.position.x,
      state.position.y + STANDING_HEIGHT * stand,
      state.position.z,
    );
    object.quaternion.set(
      state.orientation.x,
      state.orientation.y,
      state.orientation.z,
      state.orientation.w,
    );

    // Flying pose first, on one axis: -1 folded, 0 gliding, +1 braking.
    const target = wingPose === 'tucked' ? -1 : wingPose === 'braking' ? 1 : 0;
    pose += (target - pose) * Math.min(1, dt * 9);

    const fold = Math.max(0, -pose);
    const brake = Math.max(0, pose);
    const spread = 1 - fold;

    const cycle = state.flapPhase * Math.PI * 2;
    const beat = Math.sin(cycle);
    // The hand trails the arm by about an eighth of a beat.
    const trail = Math.sin(cycle - 0.8);

    let flapAngle = beat * spread;
    let wristAngle = (trail - beat) * 0.55 * spread;
    let sweep = brake * 0.9 - fold * 1.3;
    let cup = brake * 0.8 - fold * 0.65 - 0.12 * spread;
    let stretch = 1 + brake * 0.25;
    let tailPitch = -0.15 * spread - brake;
    let tailFan = 1 + brake * 0.9;

    // Then blend the whole thing toward standing, which is not a wing pose at
    // all: everything folds away and comes to rest.
    flapAngle = mix(flapAngle, 0, stand);
    wristAngle = mix(wristAngle, -0.5, stand);
    sweep = mix(sweep, -1.45, stand);
    cup = mix(cup, 0.06, stand);
    stretch = mix(stretch, 0.68, stand);
    tailPitch = mix(tailPitch, 0.34, stand);
    tailFan = mix(tailFan, 0.75, stand);

    for (const [side, wing] of [
      [-1, wings.left],
      [1, wings.right],
    ] as const) {
      wing.shoulder.rotation.z = side * (flapAngle - cup);
      wing.shoulder.rotation.y = -side * sweep;
      wing.shoulder.scale.setScalar(stretch);
      wing.wrist.rotation.z = side * wristAngle;
      // Folded wings bend at the wrist as well as sweeping back.
      wing.wrist.rotation.y = -side * (fold * 0.9 + stand * 0.7);
    }

    tail.rotation.x = tailPitch;
    for (const feather of feathers) {
      const index = feather.userData['fan'] as number;
      feather.rotation.y = -index * 0.09 * tailFan;
      feather.position.x = index * 0.025 * tailFan;
    }

    // Legs swing down to stand and tuck back up in flight.
    for (const hip of legs) {
      hip.rotation.x = (1 - stand) * 1.5;
      hip.visible = stand > 0.02;
    }
  }

  return {
    object,
    update,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
