/**
 * Procedural stand-in world.
 *
 * Nothing here is meant to be pretty -- it exists so there is something to fly
 * past. Speed is only legible against nearby geometry, so the layout cares more
 * about giving the eye things to sweep by than about looking like a real city.
 *
 * The layout itself lives in `./layout`, as plain data; this module only turns
 * it into meshes.
 */

import * as THREE from 'three';

import { createColliderField, type Aabb, type Collider } from '../sim/collision';
import { defaultWorldOptions, generateCityLayout, type WorldOptions } from './layout';

export { defaultWorldOptions, type WorldOptions } from './layout';

export interface World {
  group: THREE.Group;
  /** Every solid object as an axis-aligned box, in simulation coordinates. */
  boxes: Aabb[];
  /** Broad-phase-accelerated view of `boxes`, ready to sweep against. */
  collider: Collider;
  dispose(): void;
}

const BUILDING_COLORS = [0x8d8477, 0x9c9284, 0x7a7167, 0xa8a091, 0x6f675e, 0xb0a596];

export function buildWorld(options: WorldOptions = defaultWorldOptions): World {
  const layout = generateCityLayout(options);
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];

  // --- Ground -------------------------------------------------------------
  const groundTexture = makeGridTexture();
  const groundGeometry = new THREE.PlaneGeometry(12000, 12000);
  const groundMaterial = new THREE.MeshLambertMaterial({ map: groundTexture, color: 0x6b7d52 });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  disposables.push(groundGeometry, groundMaterial, groundTexture);

  // --- Buildings ----------------------------------------------------------
  // One InstancedMesh per colour keeps the whole skyline at a handful of draw
  // calls, which matters far more than the geometry itself.
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  disposables.push(boxGeometry);

  const perColour = Math.ceil(layout.buildings.length / BUILDING_COLORS.length);
  const buckets: THREE.InstancedMesh[] = BUILDING_COLORS.map((colour) => {
    const material = new THREE.MeshLambertMaterial({ color: colour });
    disposables.push(material);
    const mesh = new THREE.InstancedMesh(boxGeometry, material, perColour);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.count = 0;
    group.add(mesh);
    return mesh;
  });

  const matrix = new THREE.Matrix4();
  layout.buildings.forEach((building, i) => {
    matrix.makeScale(building.width, building.height, building.depth);
    matrix.setPosition(building.x, building.height / 2, building.z);

    const bucket = buckets[i % buckets.length]!;
    bucket.setMatrixAt(bucket.count++, matrix);
  });
  for (const bucket of buckets) bucket.instanceMatrix.needsUpdate = true;

  // --- Trees --------------------------------------------------------------
  // Low, dense clutter near the ground: this is what sells low-altitude speed.
  const treeGeometry = new THREE.ConeGeometry(1, 1, 6);
  const treeMaterial = new THREE.MeshLambertMaterial({ color: 0x3f5f34, flatShading: true });
  disposables.push(treeGeometry, treeMaterial);

  const trees = new THREE.InstancedMesh(treeGeometry, treeMaterial, layout.trees.length);
  trees.castShadow = true;
  layout.trees.forEach((tree, i) => {
    matrix.makeScale(tree.radius, tree.height, tree.radius);
    matrix.setPosition(tree.x, tree.height / 2, tree.z);
    trees.setMatrixAt(i, matrix);
  });
  trees.instanceMatrix.needsUpdate = true;
  group.add(trees);

  return {
    group,
    boxes: layout.boxes,
    collider: createColliderField(layout.boxes),
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

/** A faint grid drawn to a canvas, tiled across the ground for motion cues. */
function makeGridTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.10)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(600, 600);
  texture.anisotropy = 4;
  return texture;
}
