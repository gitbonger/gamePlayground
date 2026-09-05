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
import type { Rail, Road } from './streets';
import { ENGINE, WAGON, onVehicle, type Train, type Vehicle } from './train';
import type { Area, AreaKind } from './areas';

export { defaultWorldOptions, type WorldOptions } from './layout';

/**
 * The thing the pigeon is homing on, and how it is pointed out.
 *
 * A building today and a wagon just as easily: all it needs is something to
 * recolour and a height to hang the arrow over, so what is marked is a
 * decision for whoever builds the world rather than a fact about buildings.
 */
export interface TargetMarker {
  /** Where the target stands, in world metres. */
  readonly position: THREE.Vector3;
  /** Flash the target and size the arrow. Once a frame. */
  update(elapsed: number, viewer: THREE.Vector3, bird: THREE.Vector3): void;
}

export interface World {
  group: THREE.Group;
  /** Every solid object, in simulation coordinates. */
  boxes: Box[];
  /** Broad-phase-accelerated view of `boxes`, ready to sweep against. */
  collider: Collider;
  /** The landmark being homed on, if this world has one. */
  marker: TargetMarker | null;
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
 * Roofs get none, and nor does the ground floor. None of them are lit: the
 * light in this world comes from a sun three hours past noon.
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

          // Never lit. It is the middle of a summer afternoon, and a lit
          // window at three o'clock reads as a mistake rather than as life.
          // The variation is in how much sky each pane happens to be
          // reflecting, which is what stops a wall being a perfect lattice.
          vec2 which = floor(grid);
          float roll = fract(sin(dot(which, vec2(12.9898, 78.233))) * 43758.5453);
          vec3 glass = mix(vec3(0.11, 0.14, 0.19), vec3(0.21, 0.26, 0.32), roll);

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
/**
 * What the target turns when it flashes.
 *
 * It used to be painted on permanently, which made the landmark findable and
 * also made it the one building in the city that was obviously not a building.
 * Now it wears an ordinary colour and goes red once a second, and the arrow
 * above it is what makes it findable at any range.
 */
const TARGET_COLOR = 0xd0281c;

/** How long one flash of the target takes, and how much of that is lit. */
const FLASH_PERIOD = 1;
const FLASH_DUTY = 0.45;
/**
 * Where the flashing fades out, in metres.
 *
 * Close up you can see the thing perfectly well, and a building blinking in
 * your face while you are trying to put down on it is a distraction rather
 * than a help. It fades across the band rather than switching off, or the last
 * flash before the threshold reads as the marker breaking.
 */
const FLASH_NEAR = 130;
const FLASH_FAR = 240;

/**
 * How red the target is, at `elapsed` seconds and `away` metres from the bird.
 *
 * A raised cosine over the first part of each second, so it swells and fades
 * rather than snapping on -- a hard square wave at this size reads as a
 * rendering fault. Pure arithmetic, and tested as such.
 */
export function targetFlash(elapsed: number, away: number): number {
  const near = Math.min(1, Math.max(0, (away - FLASH_NEAR) / (FLASH_FAR - FLASH_NEAR)));
  if (near <= 0) return 0;

  const phase = ((elapsed % FLASH_PERIOD) + FLASH_PERIOD) % FLASH_PERIOD;
  if (phase >= FLASH_DUTY) return 0;
  return near * 0.5 * (1 - Math.cos((phase / FLASH_DUTY) * Math.PI * 2));
}

/**
 * How big to draw the arrow so it looks the same size at any range.
 *
 * The whole point of it is that it does not shrink away: a marker you lose at
 * 800 m is no marker at all. Scaling with distance keeps it subtending a
 * constant angle, and the floor keeps it from vanishing into the target's own
 * roof when you are right on top of it.
 */
export function arrowScale(distance: number): number {
  return Math.max(2.2, distance * 0.045);
}

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
 *
 * The landmark is left off. It is the one building the pigeon is meant to put
 * down on, and a pitched roof is not somewhere a bird can stand -- the collider
 * would settle it on the ridge line while the tiles fell away underneath.
 */
export function buildRoofs(buildings: readonly Building[]): THREE.BufferGeometry {
  const tiled = buildings.filter((building) => !building.isTarget);
  const prism = roofPrism();
  const positions = new Float32Array(tiled.length * prism.length * 9);
  const matrix = new THREE.Matrix4();
  const place = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const size = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const vertex = new THREE.Vector3();

  let at = 0;
  for (const building of tiled) {
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
  let marker: TargetMarker | null = null;
  if (landmark) {
    // An ordinary building between flashes, which is what it goes back to.
    const material = withWindows(new THREE.MeshLambertMaterial({ color: BUILDING_COLORS[0] }));
    disposables.push(material);
    // Full height, with no roof taken out of it: the flat top is exactly the
    // top of the collision box, so the bird lands where it looks like it does.
    const mesh = new THREE.Mesh(boxGeometry, material);
    mesh.position.set(landmark.x, landmark.height / 2, landmark.z);
    mesh.rotation.y = landmark.yaw ?? 0;
    mesh.scale.set(landmark.width, landmark.height, landmark.depth);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    marker = createMarker(
      material,
      new THREE.Vector3(landmark.x, landmark.height, landmark.z),
      disposables,
      group,
    );
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

  // --- Railways -------------------------------------------------------------
  // Over the road surface, because a tramway is laid in the carriageway.
  if (layout.rails?.length) {
    const { geometry, material } = buildRails(layout.rails);
    disposables.push(geometry, material);
    const track = new THREE.Mesh(geometry, asDecal(material, RAIL_ORDER));
    track.receiveShadow = true;
    track.renderOrder = RAIL_ORDER;
    group.add(track);
  }

  // --- Trains ---------------------------------------------------------------
  if (layout.trains?.length) {
    const { geometry, material } = buildTrains(layout.trains);
    disposables.push(geometry, material);
    const stock = new THREE.Mesh(geometry, material);
    stock.castShadow = true;
    stock.receiveShadow = true;
    group.add(stock);
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
    marker,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

/**
 * Flash the target, and hang an arrow over it.
 *
 * The arrow is drawn with the depth test off and the fog disabled, which is
 * the difference between a marker and a piece of scenery: it is still there
 * behind a block of flats and it does not dissolve into the haze at a
 * kilometre. That is the whole job -- it has to be findable from anywhere,
 * which is exactly when a normal object is hardest to see.
 */
function createMarker(
  material: THREE.MeshLambertMaterial,
  top: THREE.Vector3,
  disposables: { dispose(): void }[],
  group: THREE.Group,
): TargetMarker {
  const lit = new THREE.Color(TARGET_COLOR);
  const base = material.color.clone();

  const head = new THREE.ConeGeometry(0.5, 1.1, 4);
  head.rotateX(Math.PI);
  head.translate(0, 0.55, 0);
  const shaft = new THREE.CylinderGeometry(0.16, 0.16, 1.1, 4);
  shaft.translate(0, 1.65, 0);

  const arrowMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd21f,
    fog: false,
    depthTest: false,
    depthWrite: false,
  });
  disposables.push(head, shaft, arrowMaterial);

  const arrow = new THREE.Group();
  for (const geometry of [head, shaft]) {
    arrow.add(new THREE.Mesh(geometry, arrowMaterial));
  }
  // After everything else, so nothing paints over it.
  arrow.renderOrder = 999;
  arrow.traverse((child) => {
    child.renderOrder = 999;
  });
  group.add(arrow);

  const position = top.clone();

  return {
    position,
    update(elapsed, viewer, bird) {
      const flash = targetFlash(elapsed, position.distanceTo(bird));
      material.color.copy(base).lerp(lit, flash);

      const size = arrowScale(position.distanceTo(viewer));
      arrow.scale.setScalar(size);
      // Sitting a little clear of the roof, and rocking gently, because a
      // marker that moves is found a good deal faster than one that does not.
      const bob = Math.sin(elapsed * 2.2) * 0.12 + 1;
      arrow.position.set(position.x, position.y + size * 0.55 * bob + 1.5, position.z);
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
const RAIL_LIFT = 0.18;

const AREA_ORDER = 1;
const ROAD_ORDER = 2;
const RAIL_ORDER = 3;

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
/**
 * Every train as one mesh, in world coordinates.
 *
 * Merged for the same reason the roofs are: a vehicle's parts are boxes of
 * a dozen different shapes, and instancing wants one shape many times. There
 * are only ever a few hundred boxes in a rake, so baking them costs nothing
 * and the whole train is one draw call.
 */
function buildTrains(trains: readonly Train[]): {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
} {
  const positions: number[] = [];
  const normals: number[] = [];
  const colours: number[] = [];
  const tint = new THREE.Color();

  /** One box, in the vehicle's own frame: along it, across it, and up. */
  const part = (
    vehicle: Vehicle,
    colour: number,
    along: number,
    across: number,
    base: number,
    length: number,
    width: number,
    height: number,
  ) => {
    const at = onVehicle(vehicle, along, across);
    const box = new THREE.BoxGeometry(length, height, width).toNonIndexed();
    box.rotateY(vehicle.yaw);
    box.translate(at.x, base + height / 2, at.z);

    const point = box.getAttribute('position');
    const normal = box.getAttribute('normal');
    tint.setHex(colour);
    for (let i = 0; i < point.count; i += 1) {
      positions.push(point.getX(i), point.getY(i), point.getZ(i));
      normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
      colours.push(tint.r, tint.g, tint.b);
    }
    box.dispose();
  };

  const IRON = 0x2b2b2d;
  const RUST = 0x5c4a40;

  for (const train of trains) {
    for (const vehicle of train.vehicles) {
      const bogie = vehicle.length * 0.33;

      if (vehicle.kind === 'engine') {
        // Frame and running gear, then the hood, then the cab above it.
        part(vehicle, IRON, 0, 0, 0.55, vehicle.length, vehicle.width, 0.45);
        for (const end of [bogie, -bogie]) {
          part(vehicle, IRON, end, 0, 0.15, 3.4, vehicle.width * 0.82, 0.75);
        }
        part(vehicle, 0x7d2f26, 0, 0, 1.0, vehicle.length - 0.6, vehicle.width, ENGINE.body - 1.0);
        part(
          vehicle,
          0x7d2f26,
          vehicle.length / 2 - ENGINE.cabLength / 2 - 0.3,
          0,
          ENGINE.body,
          ENGINE.cabLength,
          vehicle.width,
          ENGINE.cab - ENGINE.body - 0.16,
        );
        part(
          vehicle,
          0x3f4145,
          vehicle.length / 2 - ENGINE.cabLength / 2 - 0.3,
          0,
          ENGINE.cab - 0.16,
          ENGINE.cabLength + 0.3,
          vehicle.width + 0.2,
          0.16,
        );
        continue;
      }

      // Running gear, solebar, and the deck laid on top of it.
      for (const end of [bogie, -bogie]) {
        part(vehicle, IRON, end, 0, 0.15, 2.6, vehicle.width * 0.78, 0.6);
      }
      part(vehicle, RUST, 0, 0, WAGON.deck - 0.5, vehicle.length, vehicle.width * 0.9, 0.32);
      part(vehicle, 0x6f5c45, 0, 0, WAGON.deck - 0.18, vehicle.length, vehicle.width, 0.18);

      const across = vehicle.width / 2 - WAGON.stakeThickness / 2;
      const spacing = (vehicle.length - WAGON.stakeThickness) / (WAGON.stakesPerSide - 1);
      for (let i = 0; i < WAGON.stakesPerSide; i += 1) {
        const along = -(vehicle.length - WAGON.stakeThickness) / 2 + i * spacing;
        for (const side of [across, -across]) {
          part(
            vehicle,
            0x7c6a51,
            along,
            side,
            WAGON.deck,
            WAGON.stakeThickness,
            WAGON.stakeThickness,
            WAGON.stake,
          );
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));

  return { geometry, material: new THREE.MeshLambertMaterial({ vertexColors: true }) };
}

/** Standard gauge, in metres: the distance between the inside faces of a pair. */
const GAUGE = 1.435;
/** Sleeper spacing, in metres. */
const SLEEPER_PITCH = 0.65;

/**
 * Every railway as one ribbon, with the track drawn on it in the shader.
 *
 * The ribbon carries two extra numbers per vertex: how far across the corridor
 * it is and how far along the line, both in metres. That is all the shader
 * needs to put a pair of rails at standard gauge and sleepers at their real
 * spacing on any width of corridor -- and, as with the windows and the tiles,
 * it means the pattern is a fixed real size rather than something that
 * stretches with the geometry it is drawn on.
 *
 * Trams are the same track laid in the road: rails, no ballast, no sleepers
 * showing, because on a tramway they are buried in the carriageway.
 */
function buildRails(rails: readonly Rail[]): {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
} {
  const positions: number[] = [];
  const edges: number[] = [];

  for (const rail of rails) {
    const tram = rail.kind === 'tram' ? 1 : 0;
    let along = 0;

    for (let i = 1; i < rail.points.length; i += 1) {
      const [x0, z0] = rail.points[i - 1]!;
      const [x1, z1] = rail.points[i]!;
      const dx = x1 - x0;
      const dz = z1 - z0;
      const length = Math.hypot(dx, dz);
      if (length < 1e-3) continue;

      const half = rail.width / 2;
      const nx = (-dz / length) * half;
      const nz = (dx / length) * half;
      const from = along;
      along += length;

      const quad = [
        [x0 + nx, z0 + nz, half, from],
        [x0 - nx, z0 - nz, -half, from],
        [x1 + nx, z1 + nz, half, along],
        [x1 - nx, z1 - nz, -half, along],
      ];
      for (const corner of [0, 1, 2, 1, 3, 2]) {
        const [px, pz, across, run] = quad[corner]!;
        positions.push(px!, RAIL_LIFT, pz!);
        edges.push(across!, run!, tram);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('edge', new THREE.Float32BufferAttribute(edges, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    // Flat ribbons on the ground, wound the same way the roads are, which is
    // to say face down. Same fix, and the same reason: not worth fighting.
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `attribute vec3 edge;\nvarying vec3 vEdge;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n        vEdge = edge;',
    );
    shader.fragmentShader = `varying vec3 vEdge;\n${shader.fragmentShader}`.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      {
        float across = abs(vEdge.x);
        float along = vEdge.y;
        float tram = vEdge.z;

        // Widened with the screen-space derivative, so a line of rail a
        // kilometre off settles to a tint instead of crawling in and out.
        float soft = fwidth(across) * 1.5 + 0.01;

        // Ballast, thinning to bare ground at the edge of the corridor.
        float roll = fract(sin(dot(floor(vec2(along, vEdge.x) * 3.0), vec2(12.9898, 78.233))) * 43758.5453);
        vec3 bed = mix(vec3(0.30, 0.27, 0.24), vec3(0.44, 0.40, 0.35), roll);
        float shoulder = 1.0 - smoothstep(1.9, 2.8 + soft, across);
        vec3 colour = mix(diffuseColor.rgb, bed, shoulder * (1.0 - tram));

        // Sleepers, at their real spacing and only under the ballast.
        float sleeper = (1.0 - smoothstep(0.34, 0.46, fract(along / ${SLEEPER_PITCH.toFixed(3)})))
                      * (1.0 - smoothstep(1.2, 1.35 + soft, across));
        colour = mix(colour, vec3(0.24, 0.19, 0.15), sleeper * 0.8 * (1.0 - tram));

        // And the pair of rails, which a tramway has and the rest of it does not.
        float rail = 1.0 - smoothstep(0.035, 0.055 + soft, abs(across - ${(GAUGE / 2).toFixed(4)}));
        colour = mix(colour, vec3(0.62, 0.63, 0.66), rail);

        diffuseColor.rgb = colour;
        // Beyond the ballast a heavy line is just ground; a tramway is road.
        diffuseColor.a *= max(max(rail, sleeper), mix(shoulder, 0.0, tram));
      }`,
    );
  };
  material.customProgramCacheKey = () => 'railway-track';
  material.transparent = true;
  return { geometry, material };
}

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
