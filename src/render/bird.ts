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

export function createBirdRig(): BirdRig {
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

  const object = new THREE.Group();

  // Body: a tapered block roughly 0.33 m long, life size for a feral pigeon.
  const body = new THREE.Mesh(geometry(new THREE.BoxGeometry(0.11, 0.12, 0.3)), material(BODY));
  body.castShadow = true;
  object.add(body);

  const head = new THREE.Mesh(geometry(new THREE.BoxGeometry(0.08, 0.08, 0.09)), material(HEAD));
  head.position.set(0, 0.05, -0.17);
  head.castShadow = true;
  object.add(head);

  // Iridescent throat, between the head and the shoulders.
  const neck = new THREE.Mesh(
    geometry(new THREE.BoxGeometry(0.086, 0.075, 0.07)),
    material(NECK, 0.3),
  );
  neck.position.set(0, 0.035, -0.125);
  object.add(neck);

  // Pale rump over the base of the tail: the part the chase camera sees most.
  const rump = new THREE.Mesh(
    geometry(new THREE.BoxGeometry(0.1, 0.035, 0.1)),
    material(RUMP, 0.5),
  );
  rump.position.set(0, 0.05, 0.115);
  object.add(rump);

  const beak = new THREE.Mesh(geometry(new THREE.ConeGeometry(0.018, 0.06, 6)), material(BEAK));
  beak.rotation.x = -Math.PI / 2;
  beak.position.set(0, 0.04, -0.24);
  object.add(beak);

  const tail = new THREE.Mesh(geometry(new THREE.BoxGeometry(0.13, 0.012, 0.14)), material(WING));
  tail.position.set(0, 0.01, 0.2);
  tail.castShadow = true;
  object.add(tail);

  // Wings pivot at the shoulder, so the mesh is offset inside its pivot group.
  const wingGeometry = geometry(new THREE.BoxGeometry(0.34, 0.014, 0.16));
  const wingMaterial = material(WING);
  const barGeometry = geometry(new THREE.BoxGeometry(0.3, 0.008, 0.018));
  const barMaterial = material(WING_BAR, 0.2);

  const makeWing = (side: 1 | -1) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.05, 0.03, -0.01);
    const mesh = new THREE.Mesh(wingGeometry, wingMaterial);
    mesh.position.set(side * 0.17, 0, 0);
    mesh.castShadow = true;
    pivot.add(mesh);

    // Two dark bars across a pale wing: real, and they give the wing a shape
    // to read at a distance instead of a flat slab.
    for (const z of [0.028, 0.056]) {
      const bar = new THREE.Mesh(barGeometry, barMaterial);
      bar.position.set(side * 0.17, 0.009, z);
      pivot.add(bar);
    }

    object.add(pivot);
    return pivot;
  };

  const leftWing = makeWing(-1);
  const rightWing = makeWing(1);

  // Legs, folded away in flight and put down to stand on.
  const legGeometry = geometry(new THREE.BoxGeometry(0.012, 0.09, 0.012));
  const legMaterial = material(LEG);
  const makeLeg = (side: 1 | -1) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.025, -0.05, 0.01);
    const mesh = new THREE.Mesh(legGeometry, legMaterial);
    mesh.position.set(0, -0.045, 0);
    mesh.castShadow = true;
    pivot.add(mesh);
    object.add(pivot);
    return pivot;
  };
  const leftLeg = makeLeg(-1);
  const rightLeg = makeLeg(1);

  // Smoothed wing pose on one axis: -1 folded, 0 gliding, +1 braking.
  let pose = 0;
  // Separate axis for standing, which is about the whole body, not the wings.
  let stand = 0;

  function update(state: BirdState, wings: WingPose, dt: number) {
    const standing = wings === 'perched';
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

    // Flying pose first, on one axis: -1 folded, 0 gliding, +1 braking. One
    // number keeps the three from fighting each other mid-transition.
    const target = wings === 'tucked' ? -1 : wings === 'braking' ? 1 : 0;
    pose += (target - pose) * Math.min(1, dt * 9);

    const fold = Math.max(0, -pose);
    const brake = Math.max(0, pose);
    const spread = 1 - fold;

    // One wingbeat per flapPhase cycle: down on the first half, up on the second.
    const beat = Math.sin(state.flapPhase * Math.PI * 2);

    // Folded wings sweep back and tuck down against the body; braking wings
    // throw forward and cup upward, presenting themselves to the airflow.
    // A little dihedral while gliding reads as a bird rather than a plank.
    let flapAngle = beat * spread;
    let sweep = brake * 0.9 - fold * 1.3;
    let cup = brake * 0.8 - fold * 0.65 - 0.12 * spread;
    let stretch = 1 + brake * 0.25;
    let tailPitch = -0.15 * spread - brake;
    let tailWidth = 1 + brake * 0.7;

    // Then blend the whole thing toward standing, which is not a wing pose at
    // all: everything folds away and comes to rest.
    flapAngle = mix(flapAngle, 0, stand);
    sweep = mix(sweep, -1.45, stand);
    cup = mix(cup, 0.06, stand);
    stretch = mix(stretch, 0.68, stand);
    tailPitch = mix(tailPitch, 0.34, stand);
    tailWidth = mix(tailWidth, 0.85, stand);

    leftWing.rotation.z = -flapAngle + cup;
    rightWing.rotation.z = flapAngle - cup;
    leftWing.rotation.y = sweep;
    rightWing.rotation.y = -sweep;
    leftWing.scale.setScalar(stretch);
    rightWing.scale.setScalar(stretch);

    tail.rotation.x = tailPitch;
    tail.scale.set(tailWidth, 1, 1 + brake * 0.4);

    // Legs swing down to stand and tuck back up in flight.
    leftLeg.rotation.x = (1 - stand) * 1.5;
    rightLeg.rotation.x = (1 - stand) * 1.5;
    leftLeg.visible = stand > 0.02;
    rightLeg.visible = stand > 0.02;
  }

  return {
    object,
    update,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
