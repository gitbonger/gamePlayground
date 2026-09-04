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

import { createColliderField, type Box, type Collider } from '../sim/collision';
import { generateCityLayout, type CityLayout } from './layout';
import type { Road } from './streets';
import type { Area, AreaKind } from './areas';

export { defaultWorldOptions, type WorldOptions } from './layout';

export interface World {
  group: THREE.Group;
  /** Every solid object, in simulation coordinates. */
  boxes: Box[];
  /** Broad-phase-accelerated view of `boxes`, ready to sweep against. */
  collider: Collider;
  dispose(): void;
}

const BUILDING_COLORS = [0x8d8477, 0x9c9284, 0x7a7167, 0xa8a091, 0x6f675e, 0xb0a596];
/** The building being homed in on, picked out to be findable from a distance. */
const TARGET_COLOR = 0xc0392b;

export function buildWorld(layout: CityLayout = generateCityLayout()): World {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];

  // --- Ground -------------------------------------------------------------
  const groundTexture = makeGridTexture();
  const groundGeometry = new THREE.PlaneGeometry(12000, 12000);
  const groundMaterial = new THREE.MeshLambertMaterial({ map: groundTexture, color: 0x6b7d52 });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  // Drawn first, and the only one of the three flat layers that writes depth.
  ground.renderOrder = 0;
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
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  // The landmark is one building among thousands, so it gets its own mesh
  // rather than a seventh instanced bucket holding a single entry.
  const landmark = layout.buildings.find((building) => building.isTarget);
  if (landmark) {
    const material = new THREE.MeshLambertMaterial({ color: TARGET_COLOR });
    disposables.push(material);
    const mesh = new THREE.Mesh(boxGeometry, material);
    mesh.position.set(landmark.x, landmark.height / 2, landmark.z);
    mesh.rotation.y = landmark.yaw ?? 0;
    mesh.scale.set(landmark.width, landmark.height, landmark.depth);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  layout.buildings.forEach((building, i) => {
    if (building.isTarget) return;
    position.set(building.x, building.height / 2, building.z);
    // Buildings on a real map face their street, so the instance carries a
    // turn as well as a size.
    rotation.setFromAxisAngle(up, building.yaw ?? 0);
    scale.set(building.width, building.height, building.depth);
    matrix.compose(position, rotation, scale);

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

  // --- Parks, woods and water ----------------------------------------------
  // Drawn under the roads, so a path through a park still reads as a path.
  if (layout.areas?.length) {
    for (const { geometry, material } of buildAreas(layout.areas)) {
      disposables.push(geometry, material);
      const patch = new THREE.Mesh(geometry, asDecal(material, AREA_ORDER));
      patch.receiveShadow = true;
      patch.renderOrder = AREA_ORDER;
      group.add(patch);
    }
  }

  // --- Streets ------------------------------------------------------------
  if (layout.roads?.length) {
    const { geometry, material } = buildRoads(layout.roads);
    disposables.push(geometry, material);
    const surface = new THREE.Mesh(geometry, asDecal(material, ROAD_ORDER));
    surface.receiveShadow = true;
    surface.renderOrder = ROAD_ORDER;
    group.add(surface);
  }

  return {
    group,
    boxes: layout.boxes,
    collider: createColliderField(layout.boxes),
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

/**
 * Ground markings are decals: flat things lying on other flat things.
 *
 * Depth alone cannot separate them reliably -- roads cross each other and
 * overlap at every junction, and coplanar quads with the same material fight
 * whatever their height. So they are lifted a little, pulled towards the
 * camera by a polygon offset, and drawn in a fixed order without writing
 * depth, which leaves overlaps to be settled by draw order rather than by
 * fractions of a millimetre.
 */
const AREA_LIFT = 0.05;
const ROAD_LIFT = 0.12;

const AREA_ORDER = 1;
const ROAD_ORDER = 2;

/** Pull a ground decal towards the camera, out of the surface it lies on. */
function asDecal(material: THREE.Material, order: number): THREE.Material {
  material.polygonOffset = true;
  material.polygonOffsetFactor = -4 - order;
  material.polygonOffsetUnits = -4 - order;
  material.depthWrite = false;
  return material;
}

const AREA_COLORS: Record<AreaKind, number> = {
  park: 0x5f8f43,
  wood: 0x3d6130,
  pitch: 0x77854a,
  water: 0x3d6a8f,
};

/**
 * Green space as flat patches, one merged mesh per kind.
 *
 * ShapeGeometry triangulates each ring; the shapes are built with the map's Z
 * negated so that rotating the plane down onto the ground puts them back the
 * right way round.
 */
function buildAreas(
  areas: readonly Area[],
): { geometry: THREE.BufferGeometry; material: THREE.Material }[] {
  const byKind = new Map<AreaKind, number[]>();

  for (const area of areas) {
    if (area.points.length < 3) continue;

    const shape = new THREE.Shape(area.points.map(([x, z]) => new THREE.Vector2(x, -z)));
    const flat = new THREE.ShapeGeometry(shape);
    const positions = flat.toNonIndexed().getAttribute('position');

    const target = byKind.get(area.kind) ?? [];
    for (let i = 0; i < positions.count; i += 1) {
      target.push(positions.getX(i), AREA_LIFT, -positions.getY(i));
    }
    byKind.set(area.kind, target);
    flat.dispose();
  }

  return [...byKind].map(([kind, positions]) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    return {
      geometry,
      material: new THREE.MeshLambertMaterial({
        color: AREA_COLORS[kind],
        // Rings can wind either way; a ground patch should show regardless.
        side: THREE.DoubleSide,
      }),
    };
  });
}

/**
 * Every street as a flat ribbon, merged into one mesh.
 *
 * Quads per segment rather than a proper mitred polyline: at the width of a
 * road seen from the air the joints do not read, and one buffer of a few
 * thousand triangles costs a single draw call.
 */
function buildRoads(roads: readonly Road[]): {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
} {
  const positions: number[] = [];
  const colours: number[] = [];

  const minor = new THREE.Color(0x4a4a4c);
  const major = new THREE.Color(0x5c5b5a);
  const shade = new THREE.Color();

  for (const road of roads) {
    // Wider roads read as more important, which is also how they are drawn.
    shade.copy(minor).lerp(major, Math.min(1, (road.width - 6) / 16));

    for (let i = 1; i < road.points.length; i += 1) {
      const [x0, z0] = road.points[i - 1]!;
      const [x1, z1] = road.points[i]!;
      const dx = x1 - x0;
      const dz = z1 - z0;
      const length = Math.hypot(dx, dz);
      if (length < 1e-3) continue;

      // Sideways offset, half a carriageway each way.
      const nx = (-dz / length) * (road.width / 2);
      const nz = (dx / length) * (road.width / 2);

      const quad = [
        x0 + nx, z0 + nz,
        x0 - nx, z0 - nz,
        x1 + nx, z1 + nz,
        x1 - nx, z1 - nz,
      ];
      for (const [a, b, c] of [
        [0, 1, 2],
        [1, 3, 2],
      ]) {
        for (const corner of [a, b, c]) {
          positions.push(quad[corner! * 2]!, ROAD_LIFT, quad[corner! * 2 + 1]!);
          colours.push(shade.r, shade.g, shade.b);
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    // Flat ribbons on the ground; winding is not worth fighting over.
    side: THREE.DoubleSide,
  });

  return { geometry, material };
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
