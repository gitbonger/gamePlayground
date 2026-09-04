/**
 * Procedural stand-in world.
 *
 * Nothing here is meant to be pretty -- it exists so there is something to fly
 * past. Speed is only legible against nearby geometry, so the layout cares more
 * about giving the eye things to sweep by than about looking like a real city.
 */

import * as THREE from 'three';

/** Small deterministic PRNG, so the same seed always builds the same city. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface WorldOptions {
  seed: number;
  /** Half-width of the built-up area in metres. */
  extent: number;
  buildingCount: number;
  treeCount: number;
}

export const defaultWorldOptions: WorldOptions = {
  seed: 7,
  extent: 900,
  buildingCount: 900,
  treeCount: 500,
};

export interface World {
  group: THREE.Group;
  /** Axis-aligned boxes for every solid object, for collision later. */
  colliders: THREE.Box3[];
  dispose(): void;
}

const BUILDING_COLORS = [0x8d8477, 0x9c9284, 0x7a7167, 0xa8a091, 0x6f675e, 0xb0a596];

export function buildWorld(options: WorldOptions = defaultWorldOptions): World {
  const rand = mulberry32(options.seed);
  const group = new THREE.Group();
  const colliders: THREE.Box3[] = [];
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

  const perColour = Math.ceil(options.buildingCount / BUILDING_COLORS.length);
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
  for (let i = 0; i < options.buildingCount; i++) {
    const x = (rand() * 2 - 1) * options.extent;
    const z = (rand() * 2 - 1) * options.extent;

    // Taller towers cluster toward the middle, so the skyline has a centre.
    const distance = Math.hypot(x, z) / options.extent;
    const centreBias = Math.max(0, 1 - distance);
    const height = 8 + rand() * 22 + centreBias * centreBias * (30 + rand() * 90);
    const width = 8 + rand() * 16;
    const depth = 8 + rand() * 16;

    matrix.makeScale(width, height, depth);
    matrix.setPosition(x, height / 2, z);

    const bucket = buckets[i % buckets.length]!;
    bucket.setMatrixAt(bucket.count++, matrix);

    colliders.push(
      new THREE.Box3(
        new THREE.Vector3(x - width / 2, 0, z - depth / 2),
        new THREE.Vector3(x + width / 2, height, z + depth / 2),
      ),
    );
  }
  for (const bucket of buckets) bucket.instanceMatrix.needsUpdate = true;

  // --- Trees --------------------------------------------------------------
  // Low, dense clutter near the ground: this is what sells low-altitude speed.
  const treeGeometry = new THREE.ConeGeometry(1, 1, 6);
  const treeMaterial = new THREE.MeshLambertMaterial({ color: 0x3f5f34, flatShading: true });
  disposables.push(treeGeometry, treeMaterial);

  const trees = new THREE.InstancedMesh(treeGeometry, treeMaterial, options.treeCount);
  trees.castShadow = true;
  for (let i = 0; i < options.treeCount; i++) {
    const x = (rand() * 2 - 1) * options.extent * 1.9;
    const z = (rand() * 2 - 1) * options.extent * 1.9;
    const height = 6 + rand() * 9;
    const radius = 2.5 + rand() * 2;
    matrix.makeScale(radius, height, radius);
    matrix.setPosition(x, height / 2, z);
    trees.setMatrixAt(i, matrix);
  }
  trees.instanceMatrix.needsUpdate = true;
  group.add(trees);

  return {
    group,
    colliders,
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
