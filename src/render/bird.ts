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

const BODY = 0x6c7482;
const WING = 0x59616e;
const HEAD = 0x7d8593;
const BEAK = 0xd7a24b;

/** What the wings are doing, which is most of what the bird reads as. */
export type WingPose = 'tucked' | 'gliding' | 'braking';

export interface BirdRig {
  object: THREE.Object3D;
  update(state: BirdState, pose: WingPose, dt: number): void;
  dispose(): void;
}

export function createBirdRig(): BirdRig {
  const disposables: { dispose(): void }[] = [];
  const material = (color: number) => {
    const m = new THREE.MeshLambertMaterial({ color, flatShading: true });
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

  const makeWing = (side: 1 | -1) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.05, 0.03, -0.01);
    const mesh = new THREE.Mesh(wingGeometry, wingMaterial);
    mesh.position.set(side * 0.17, 0, 0);
    mesh.castShadow = true;
    pivot.add(mesh);
    object.add(pivot);
    return pivot;
  };

  const leftWing = makeWing(-1);
  const rightWing = makeWing(1);

  // Smoothed wing pose on one axis: -1 folded, 0 gliding, +1 braking. One
  // number keeps the three poses from fighting each other mid-transition.
  let pose = 0;

  function update(state: BirdState, wings: WingPose, dt: number) {
    object.position.set(state.position.x, state.position.y, state.position.z);
    object.quaternion.set(
      state.orientation.x,
      state.orientation.y,
      state.orientation.z,
      state.orientation.w,
    );

    const target = wings === 'tucked' ? -1 : wings === 'braking' ? 1 : 0;
    pose += (target - pose) * Math.min(1, dt * 9);

    const fold = Math.max(0, -pose);
    const brake = Math.max(0, pose);
    const spread = 1 - fold;

    // One wingbeat per flapPhase cycle: down on the first half, up on the second.
    const beat = Math.sin(state.flapPhase * Math.PI * 2);
    const flapAngle = beat * spread;

    // Folded wings sweep back and tuck down against the body; braking wings
    // throw forward and cup upward, presenting themselves to the airflow.
    const sweep = brake * 0.9 - fold * 1.3;
    const cup = brake * 0.8 - fold * 0.65;

    leftWing.rotation.z = -flapAngle + cup;
    rightWing.rotation.z = flapAngle - cup;
    leftWing.rotation.y = sweep;
    rightWing.rotation.y = -sweep;

    // A little dihedral while gliding reads as a bird rather than a plank.
    const dihedral = 0.12 * spread;
    leftWing.rotation.z -= dihedral;
    rightWing.rotation.z += dihedral;

    // Spread wings reach further out when braking.
    const stretch = 1 + brake * 0.25;
    leftWing.scale.setScalar(stretch);
    rightWing.scale.setScalar(stretch);

    // The tail fans wide and drops as an airbrake of its own.
    tail.rotation.x = -0.15 * spread - brake * 1;
    tail.scale.set(1 + brake * 0.7, 1, 1 + brake * 0.4);
  }

  return {
    object,
    update,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
