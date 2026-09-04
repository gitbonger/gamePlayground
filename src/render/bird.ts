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

export interface BirdRig {
  object: THREE.Object3D;
  update(state: BirdState, tucked: boolean, dt: number): void;
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

  // Smoothed wing pose, so folding and spreading are not instant snaps.
  let spread = 1;

  function update(state: BirdState, tucked: boolean, dt: number) {
    object.position.set(state.position.x, state.position.y, state.position.z);
    object.quaternion.set(
      state.orientation.x,
      state.orientation.y,
      state.orientation.z,
      state.orientation.w,
    );

    const targetSpread = tucked ? 0 : 1;
    spread += (targetSpread - spread) * Math.min(1, dt * 9);

    // One wingbeat per flapPhase cycle: down on the first half, up on the second.
    const beat = Math.sin(state.flapPhase * Math.PI * 2);
    const flapAngle = beat * 1.0 * spread;
    // Folded wings sweep back and tuck down against the body.
    const fold = (1 - spread) * 1.3;

    leftWing.rotation.z = -flapAngle - fold * 0.5;
    rightWing.rotation.z = flapAngle + fold * 0.5;
    leftWing.rotation.y = -fold;
    rightWing.rotation.y = fold;

    // A little dihedral while gliding reads as a bird rather than a plank.
    const dihedral = 0.12 * spread;
    leftWing.rotation.z -= dihedral;
    rightWing.rotation.z += dihedral;

    tail.rotation.x = -0.15 * spread;
  }

  return {
    object,
    update,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
