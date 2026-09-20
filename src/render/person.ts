/**
 * A person who says something, drawn the way the crowd is drawn.
 *
 * The round begins with somebody handing a pigeon a letter, and everybody who
 * has ever spoken in this game has been a pigeon. What a speaker needs is
 * three things -- something to draw, somewhere to stand, and a way to be lit
 * up when they are the one to walk to -- and a bird rig happens to provide
 * all three. So this provides the same three, out of the figure the crowd is
 * already made of, and the game does not have to know which sort it is
 * talking to.
 *
 * It ignores the pose it is handed. A person has one: standing.
 */

import * as THREE from 'three';

import { heading, type BirdState } from '../sim/flight';
import { personShape } from '../world/city';
import { PERSON_HEIGHT } from '../world/layout';

export interface PersonRig {
  readonly object: THREE.Object3D;
  update(state: BirdState, pose: unknown, dt: number): void;
  glow(amount: number): void;
  dispose(): void;
}

/** How far the feet are below the point the game holds a speaker at. */
const FOOT = 0.22;

export function createPersonRig(): PersonRig {
  const geometry = personShape();
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const object = new THREE.Mesh(geometry, material);
  object.castShadow = true;
  object.receiveShadow = true;
  object.scale.setScalar(PERSON_HEIGHT);

  let washed = -1;

  return {
    object,
    update(state) {
      // Standing on the ground the speaker's own place is measured from: the
      // game holds everybody who talks at a pigeon's resting height, which
      // for a person is their shoes.
      object.position.set(state.position.x, state.position.y - FOOT, state.position.z);
      object.rotation.y = -heading(state);
    },
    glow(amount) {
      if (amount === washed) return;
      washed = amount;
      // The same red wash the birds take when they are the thing to walk to.
      material.emissive.setRGB(amount * 0.55, 0, 0);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
