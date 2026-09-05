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
import { generateCityLayout, type Building, type CityLayout } from './layout';
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

/** One storey of window, in metres: the tile the pattern repeats over. */
const WINDOW_TILE_WIDTH = 3.3;
const WINDOW_TILE_HEIGHT = 3.4;

/**
 * Draw a grid of windows on a building's walls.
 *
 * Derived from world position and the wall's normal rather than from the mesh
 * UVs, which matters because the buildings are one shared box scaled per
 * instance: a UV-based pattern would stretch, giving a 46 m block the same
 * number of windows as a 20 m one, each four times the size. Read off world
 * coordinates instead and every window is the same real size on every
 * building, for free, with nothing stored per instance.
 *
 * Roofs get none, and nor does the ground floor.
 */
function withWindows(material: THREE.MeshLambertMaterial): THREE.MeshLambertMaterial {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `varying vec3 vWallPos;\nvarying vec3 vWallNormal;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vWallPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        vWallNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
      #else
        vWallPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWallNormal = normalize(mat3(modelMatrix) * objectNormal);
      #endif`,
    );

    shader.fragmentShader = `varying vec3 vWallPos;\nvarying vec3 vWallNormal;\n${shader.fragmentShader}`.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      {
        vec3 facing = abs(vWallNormal);
        // Roofs are flat and windowless; walls are whichever way they face.
        if (facing.y < 0.6) {
          vec2 wall = facing.x > facing.z
            ? vec2(vWallPos.z, vWallPos.y)
            : vec2(vWallPos.x, vWallPos.y);
          vec2 grid = wall / vec2(${WINDOW_TILE_WIDTH.toFixed(2)}, ${WINDOW_TILE_HEIGHT.toFixed(2)});
          vec2 cell = fract(grid);

          // Widen the edges with the screen-space derivative, so distant walls
          // fade to an even tint instead of shimmering.
          vec2 soft = fwidth(grid) * 1.2 + 0.004;
          float across = smoothstep(0.22 - soft.x, 0.22 + soft.x, cell.x)
                       - smoothstep(0.74 - soft.x, 0.74 + soft.x, cell.x);
          float up = smoothstep(0.30 - soft.y, 0.30 + soft.y, cell.y)
                   - smoothstep(0.82 - soft.y, 0.82 + soft.y, cell.y);
          float pane = clamp(across * up, 0.0, 1.0);

          // Nothing at street level, where the shopfronts would be.
          pane *= smoothstep(1.6, 3.2, vWallPos.y);

          // A few windows lit, so a wall is not a perfect lattice.
          vec2 which = floor(grid);
          float roll = fract(sin(dot(which, vec2(12.9898, 78.233))) * 43758.5453);
          vec3 glass = mix(vec3(0.13, 0.16, 0.21), vec3(0.85, 0.72, 0.45), step(0.88, roll));

          diffuseColor.rgb = mix(diffuseColor.rgb, glass, pane * 0.8);
        }
      }`,
    );
  };
  // Every patched material compiles the same program, differing only in the
  // colour uniform, so they can share one.
  material.customProgramCacheKey = () => 'building-windows';
  return material;
}
/** The building being homed in on, picked out to be findable from a distance. */
const TARGET_COLOR = 0xc0392b;

/** Rise of a roof per metre of half-depth: about 27 degrees off horizontal. */
const ROOF_PITCH = 0.5;
/** However deep the wing, a roof stops growing here, in metres. */
const ROOF_MAX_RISE = 5;
/** And never takes more than this share of the building's total height. */
const ROOF_MAX_SHARE = 0.35;

/** How tall the roof on a given building is, in metres. */
export function roofRise(building: { depth: number; height: number }): number {
  return Math.min(ROOF_MAX_RISE, (building.depth / 2) * ROOF_PITCH, building.height * ROOF_MAX_SHARE);
}

/** One course of tile, up the slope, and one tile across it, in metres. */
const TILE_COURSE = 0.34;
const TILE_WIDTH = 0.26;

/** The six triangles of a gabled unit prism: ridge along X, base on y = 0. */
function roofPrism(): [number, number, number][][] {
  const a0: [number, number, number] = [-0.5, 0, -0.5];
  const a1: [number, number, number] = [0.5, 0, -0.5];
  const b0: [number, number, number] = [0.5, 0, 0.5];
  const b1: [number, number, number] = [-0.5, 0, 0.5];
  const r0: [number, number, number] = [-0.5, 1, 0];
  const r1: [number, number, number] = [0.5, 1, 0];

  return [
    // The slope facing -Z, then the one facing +Z. Wound so they face out:
    // a back-facing roof is invisible rather than obviously wrong.
    [a0, r1, a1],
    [a0, r0, r1],
    [b0, r0, b1],
    [b0, r1, r0],
    // The gable ends, which are party wall rather than tile.
    [a0, b1, r0],
    [b0, a1, r1],
  ];
}

/**
 * Every roof on the map, as one merged mesh in world coordinates.
 *
 * Merged rather than instanced, which is the opposite of what the walls want,
 * and for a reason worth writing down: an instance carries its shape as a
 * scale, and a normal does not survive a non-uniform one. Scale a unit prism
 * to 17 m wide by 4 m tall and its slope normals are flattened almost level --
 * enough that every roof face tested as a gable end and the whole city came
 * out rendered in grey. Baking the vertices means the normals are simply
 * correct, and 2,249 roofs still cost one draw call.
 */
function buildRoofs(buildings: readonly Building[]): THREE.BufferGeometry {
  const prism = roofPrism();
  const positions = new Float32Array(buildings.length * prism.length * 9);
  const matrix = new THREE.Matrix4();
  const place = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const size = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const vertex = new THREE.Vector3();

  let at = 0;
  for (const building of buildings) {
    const rise = roofRise(building);
    turn.setFromAxisAngle(up, building.yaw ?? 0);
    place.set(building.x, building.height - rise, building.z);
    // Eaves overhang front and back but not along the street: a house shares
    // its side walls with its neighbours, and an overhang there would bury
    // itself in them.
    size.set(building.width, rise, building.depth + 0.7);
    matrix.compose(place, turn, size);

    for (const face of prism) {
      for (const point of face) {
        vertex.set(point[0], point[1], point[2]).applyMatrix4(matrix);
        positions[at++] = vertex.x;
        positions[at++] = vertex.y;
        positions[at++] = vertex.z;
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  // Nothing is shared between faces, so this is flat shading.
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Clay tiles, in courses running along the ridge.
 *
 * Read off world position and the surface normal for the same reason the
 * windows are: one prism is scaled per instance, so anything keyed to the mesh
 * UVs would stretch, and a wide roof would get the same number of enormous
 * tiles as a narrow one. Derived this way a tile is 26 cm across on every roof
 * on the map, whatever its size.
 */
function withTiles(material: THREE.MeshLambertMaterial): THREE.MeshLambertMaterial {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `varying vec3 vRoofPos;\nvarying vec3 vRoofNormal;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
        vRoofPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vRoofNormal = normalize(mat3(modelMatrix) * objectNormal);`,
    );

    shader.fragmentShader = `varying vec3 vRoofPos;\nvarying vec3 vRoofNormal;\n${shader.fragmentShader}`.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      {
        vec3 face = normalize(vRoofNormal);
        if (face.y > 0.25) {
          // Along the ridge, and up the slope. The horizontal part of the
          // normal points straight down the slope, so turning it a quarter
          // turn gives the direction the courses run in.
          vec2 fall = vec2(face.x, face.z);
          float steep = length(fall);
          vec2 along = steep > 1e-3 ? normalize(vec2(-fall.y, fall.x)) : vec2(1.0, 0.0);
          float u = dot(vRoofPos.xz, along) / ${TILE_WIDTH.toFixed(3)};
          // Divided by the normal's rise, so a course is measured along the
          // slope rather than vertically: shallow roofs are not stretched.
          float v = (vRoofPos.y / max(face.y, 0.25)) / ${TILE_COURSE.toFixed(3)};

          float course = floor(v);
          // Every other course offset by half a tile, as they are laid.
          float across = u + fract(course * 0.5) * 1.0;
          float tile = floor(across);

          float roll = fract(sin(dot(vec2(tile, course), vec2(12.9898, 78.233))) * 43758.5453);
          vec3 clay = mix(vec3(0.55, 0.20, 0.11), vec3(0.80, 0.38, 0.20), roll);
          // A few tiles weathered grey, which is what stops a roof reading as
          // one flat colour from the air.
          clay = mix(clay, vec3(0.46, 0.34, 0.28), smoothstep(0.86, 1.0, roll) * 0.7);

          // Widened with the screen-space derivative, so distant roofs settle
          // to an even tint instead of crawling.
          vec2 soft = fwidth(vec2(across, v)) * 1.2 + 0.01;
          float lap = smoothstep(0.0, 0.16 + soft.y, fract(v));
          float joint = smoothstep(0.0, 0.09 + soft.x, fract(across))
                      * smoothstep(0.0, 0.09 + soft.x, 1.0 - fract(across));

          diffuseColor.rgb = clay * (0.70 + 0.30 * lap) * (0.86 + 0.14 * joint);
        } else {
          // The gable ends are the party walls between neighbours: render,
          // not tile.
          diffuseColor.rgb = vec3(0.62, 0.60, 0.56);
        }
      }`,
    );
  };
  material.customProgramCacheKey = () => 'roof-tiles';
  return material;
}

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
    const material = withWindows(new THREE.MeshLambertMaterial({ color: colour }));
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
    const material = withWindows(new THREE.MeshLambertMaterial({ color: TARGET_COLOR }));
    disposables.push(material);
    const walls = landmark.height - roofRise(landmark);
    const mesh = new THREE.Mesh(boxGeometry, material);
    mesh.position.set(landmark.x, walls / 2, landmark.z);
    mesh.rotation.y = landmark.yaw ?? 0;
    mesh.scale.set(landmark.width, walls, landmark.depth);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // --- Roofs ----------------------------------------------------------------
  // The roof takes the top few metres of the building rather than being piled
  // on top of it, so the ridge is still the height the layout says it is and
  // the collision box -- which stops at that height -- keeps its meaning.
  const roofGeometry = buildRoofs(layout.buildings);
  const roofMaterial = withTiles(new THREE.MeshLambertMaterial({ color: 0xffffff }));
  disposables.push(roofGeometry, roofMaterial);

  const roofs = new THREE.Mesh(roofGeometry, roofMaterial);
  roofs.castShadow = true;
  roofs.receiveShadow = true;
  group.add(roofs);

  layout.buildings.forEach((building, i) => {
    if (building.isTarget) return;
    const walls = building.height - roofRise(building);
    rotation.setFromAxisAngle(up, building.yaw ?? 0);
    position.set(building.x, walls / 2, building.z);
    // Buildings on a real map face their street, so the instance carries a
    // turn as well as a size.
    scale.set(building.width, walls, building.depth);
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
