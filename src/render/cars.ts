/**
 * The cars, drawn: a coloured body and a dark cabin on top of it.
 *
 * As plain as a car gets and still reads as one from above: what has to come
 * across at fifty metres is the shape and the colour, not the make. Two
 * instanced meshes for all of them -- bodies, each its own colour, and the
 * cabins -- so a street full of traffic is two draw calls.
 */

import * as THREE from 'three';
import { CAR_LENGTH, type Car } from '../world/cars';

const WIDTH = 1.8;
const BODY_HEIGHT = 0.75;
const RIDE = 0.3;
const CABIN = { length: 2.2, width: 1.6, height: 0.62, back: -0.25 };
const GLASS = 0x2a323b;

export interface CarMeshes {
  readonly object: THREE.Object3D;
  update(cars: readonly Car[]): void;
  dispose(): void;
}

export function createCarMeshes(most: number): CarMeshes {
  const group = new THREE.Group();

  const bodyShape = new THREE.BoxGeometry(CAR_LENGTH, BODY_HEIGHT, WIDTH);
  bodyShape.translate(0, RIDE + BODY_HEIGHT / 2, 0);
  const bodyPaint = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  const bodies = new THREE.InstancedMesh(bodyShape, bodyPaint, most);

  const cabinShape = new THREE.BoxGeometry(CABIN.length, CABIN.height, CABIN.width);
  cabinShape.translate(CABIN.back, RIDE + BODY_HEIGHT + CABIN.height / 2, 0);
  const cabinPaint = new THREE.MeshLambertMaterial({ color: GLASS, flatShading: true });
  const cabins = new THREE.InstancedMesh(cabinShape, cabinPaint, most);

  for (const mesh of [bodies, cabins]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Moved every frame across the whole map, so the bounds the renderer
    // culls by would be out of date the moment they were worked out.
    mesh.frustumCulled = false;
    mesh.count = 0;
    group.add(mesh);
  }

  const matrix = new THREE.Matrix4();
  const turn = new THREE.Quaternion();
  const at = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  const tint = new THREE.Color();

  return {
    object: group,
    update(cars) {
      const shown = Math.min(cars.length, most);
      for (let i = 0; i < shown; i += 1) {
        const car = cars[i]!;
        // Built along x, and turned the way the collider turns boxes.
        turn.setFromAxisAngle(up, car.yaw);
        matrix.compose(at.set(car.x, 0, car.z), turn, one);
        bodies.setMatrixAt(i, matrix);
        cabins.setMatrixAt(i, matrix);
        bodies.setColorAt(i, tint.set(car.colour));
      }
      bodies.count = shown;
      cabins.count = shown;
      bodies.instanceMatrix.needsUpdate = true;
      cabins.instanceMatrix.needsUpdate = true;
      if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    },
    dispose() {
      for (const each of [bodyShape, cabinShape, bodyPaint, cabinPaint]) each.dispose();
      bodies.dispose();
      cabins.dispose();
    },
  };
}
