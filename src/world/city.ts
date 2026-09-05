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
import { ENGINE, WAGON, type Train, type Vehicle } from './train';
import { defaultSmokeOptions, puffOpacity, puffRadius, type Puff } from './smoke';
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
  /** What this objective is called: "Level 1", and so on. */
  readonly name: string;
  /** Where the target stands, in world metres. Follows it if it moves. */
  readonly position: THREE.Vector3;
  /** The vehicle it is carried by, or null if it stands on the ground. */
  readonly rides: { train: number; vehicle: number } | null;
  /** Whether it is the one being flown to. Only one usually is. */
  setActive(active: boolean): void;
  /**
   * Flash the target and size the arrow. Once a frame, when active.
   *
   * `down` stops the flashing: the bird is on its feet and no longer looking
   * for the place to put them.
   */
  update(elapsed: number, viewer: THREE.Vector3, bird: THREE.Vector3, down: boolean): void;
}

export interface ObjectiveOptions {
  /** How many puffs of smoke the renderer must be ready to draw. */
  smoke?: number;
  /** What to call the marked building, if the layout has one. */
  landmark?: string;
  /**
   * Vehicles to pick out as objectives, by which train and where in the rake.
   *
   * Named here rather than flagged on the layout because which wagon is a
   * level is a decision about the game, not a fact about the train.
   */
  objectives?: { name: string; train: number; vehicle: number }[];
}

export interface World {
  group: THREE.Group;
  /** Every solid object, in simulation coordinates. */
  boxes: Box[];
  /** Broad-phase-accelerated view of `boxes`, ready to sweep against. */
  collider: Collider;
  /** Everything the pigeon can be sent to, in the order it was named. */
  markers: TargetMarker[];
  /**
   * Height of the drawn ground at a point -- the road or railway painted over
   * the plane, or the plane itself. What a bird resting there stands on.
   */
  surfaceAt(x: number, z: number): number;
  /** Move the rolling stock to where the layout says the trains have got to. */
  updateTrains(trains: readonly Train[]): void;
  /**
   * Draw the smoke, facing the camera.
   *
   * Given the puffs rather than owning them: where the smoke *is* is physics,
   * and physics does not belong in the renderer.
   */
  updateSmoke(puffs: readonly Puff[], viewer: THREE.Quaternion): void;
  /**
   * Marker arrows, to be drawn in a pass of their own after the world.
   *
   * Kept out of `group` on purpose. Drawing them last with the depth test off
   * is not enough: transparent objects render after every opaque one whatever
   * their render order, so the road and railway ribbons painted straight over
   * the top of an arrow that had already been drawn. A second pass over a
   * cleared depth buffer is the only arrangement nothing can get in front of.
   */
  overlay: THREE.Group;
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
 * How red the target is, at `elapsed` seconds.
 *
 * A raised cosine over the first part of each second, so it swells and fades
 * rather than snapping on -- a hard square wave at this size reads as a
 * rendering fault. Pure arithmetic, and tested as such.
 *
 * It used to fade out inside 130 m, on the reasoning that a building blinking
 * in your face while you are trying to put down on it is a distraction. It is
 * the opposite: the last stretch of an approach is exactly when you want to
 * be sure you are lining up on the right roof. It runs until the bird is
 * down, and `down` is the only thing that stops it.
 */
export function targetFlash(elapsed: number, down: boolean): number {
  if (down) return 0;

  const phase = ((elapsed % FLASH_PERIOD) + FLASH_PERIOD) % FLASH_PERIOD;
  if (phase >= FLASH_DUTY) return 0;
  return 0.5 * (1 - Math.cos((phase / FLASH_DUTY) * Math.PI * 2));
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

export function buildWorld(
  layout: CityLayout = generateCityLayout(),
  options: ObjectiveOptions = {},
): World {
  const group = new THREE.Group();
  const overlay = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const markers: TargetMarker[] = [];
  const smokeCapacity = options.smoke ?? 0;

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

    markers.push(
      createMarker(
        options.landmark ?? 'target',
        material,
        new THREE.Vector3(landmark.x, landmark.height, landmark.z),
        disposables,
        overlay,
      ),
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
  // A mesh per vehicle, positioned from the layout every frame. A train moves,
  // so its position cannot live in its vertices; and a wagon that is an
  // objective has to be recolourable on its own anyway.
  const rolling: { mesh: THREE.Mesh; train: number; vehicle: number }[] = [];

  const picked = new Map<string, string>();
  for (const objective of options.objectives ?? []) {
    picked.set(`${objective.train}:${objective.vehicle}`, objective.name);
  }

  layout.trains?.forEach((train, t) => {
    train.vehicles.forEach((vehicle, v) => {
      const { geometry, material } = buildVehicle(vehicle);
      disposables.push(geometry, material);

      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      rolling.push({ mesh, train: t, vehicle: v });

      const name = picked.get(`${t}:${v}`);
      if (name) {
        markers.push(
          createMarker(
            name,
            material as THREE.MeshLambertMaterial,
            new THREE.Vector3(vehicle.x, WAGON.deck + WAGON.stake, vehicle.z),
            disposables,
            overlay,
            { train: t, vehicle: v },
          ),
        );
      }
    });
  });

  // --- Smoke ----------------------------------------------------------------
  const plume = buildSmoke(smokeCapacity);
  disposables.push(plume.geometry, plume.material, plume.texture);
  group.add(plume.mesh);

  const puffPlace = new THREE.Vector3();
  const puffScale = new THREE.Vector3();
  const puffMatrix = new THREE.Matrix4();
  const puffTint = new THREE.Color();

  const updateSmoke = (puffs: readonly Puff[], viewer: THREE.Quaternion) => {
    let drawn = 0;
    for (const puff of puffs) {
      const alpha = puffOpacity(puff);
      if (alpha <= 0.004 || drawn >= plume.mesh.count + puffs.length) continue;

      const radius = puffRadius(puff, defaultSmokeOptions) * 2;
      puffPlace.set(puff.x, puff.y, puff.z);
      puffScale.set(radius, radius, radius);
      puffMatrix.compose(puffPlace, viewer, puffScale);
      plume.mesh.setMatrixAt(drawn, puffMatrix);

      // Soot at the stack, thinning to a grey haze as it disperses -- and
      // never black, which reads as a hole in the sky rather than as smoke.
      const through = Math.min(1, puff.age / Math.max(puff.life, 0.001));
      const grey = 0.09 + 0.34 * through;
      puffTint.setRGB(grey, grey, grey * 1.06);
      plume.mesh.setColorAt(drawn, puffTint);

      // Each bubble faint on its own; it is the hundreds of them overlapping
      // that make the plume thick, which is what lets you see into it.
      plume.fade.setX(drawn, alpha * PUFF_ALPHA);
      drawn += 1;
    }

    plume.mesh.count = drawn;
    plume.mesh.instanceMatrix.needsUpdate = true;
    plume.fade.needsUpdate = true;
    if (plume.mesh.instanceColor) plume.mesh.instanceColor.needsUpdate = true;
  };

  /** Move every vehicle to where its train has got to. */
  const updateTrains = (trains: readonly Train[]) => {
    for (const { mesh, train, vehicle } of rolling) {
      const at = trains[train]?.vehicles[vehicle];
      if (!at) continue;
      mesh.position.set(at.x, 0, at.z);
      mesh.rotation.y = at.yaw;
    }
    for (const marker of markers) {
      const carried = marker.rides;
      if (!carried) continue;
      const at = trains[carried.train]?.vehicles[carried.vehicle];
      if (at) marker.position.set(at.x, WAGON.deck + WAGON.stake, at.z);
    }
  };

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
    markers,
    surfaceAt: (x, z) => groundSurfaceAt(x, z, layout.roads, layout.rails),
    overlay,
    updateTrains,
    updateSmoke,
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
  name: string,
  material: THREE.MeshLambertMaterial,
  top: THREE.Vector3,
  disposables: { dispose(): void }[],
  group: THREE.Group,
  rides: { train: number; vehicle: number } | null = null,
): TargetMarker {
  // Flashed on the emissive rather than the diffuse, which is what lets the
  // same marker work on a wagon. A wagon is one mesh of many vertex colours --
  // timber, rust, iron -- and multiplying that lot by red gives a muddy brown,
  // not a red wagon. Emissive is added rather than multiplied, so everything
  // goes red together whatever it started as.
  const lit = new THREE.Color(TARGET_COLOR);

  const head = new THREE.ConeGeometry(0.5, 1.1, 4);
  head.rotateX(Math.PI);
  head.translate(0, 0.55, 0);
  const shaft = new THREE.CylinderGeometry(0.16, 0.16, 1.1, 4);
  shaft.translate(0, 1.65, 0);

  // Drawn in its own pass over a cleared depth buffer, so it needs no tricks
  // to stay in front: there is simply nothing else in the pass with it.
  const arrowMaterial = new THREE.MeshBasicMaterial({ color: 0xffd21f, fog: false });
  disposables.push(head, shaft, arrowMaterial);

  const arrow = new THREE.Group();
  for (const geometry of [head, shaft]) {
    arrow.add(new THREE.Mesh(geometry, arrowMaterial));
  }
  arrow.visible = false;
  group.add(arrow);

  const position = top.clone();
  let active = false;

  return {
    name,
    position,
    rides,
    setActive(on) {
      active = on;
      arrow.visible = on;
      if (!on) material.emissive.setScalar(0);
    },
    update(elapsed, viewer, _bird, down) {
      if (!active) return;

      material.emissive.copy(lit).multiplyScalar(targetFlash(elapsed, down));

      const size = arrowScale(position.distanceTo(viewer));
      arrow.scale.setScalar(size);
      // Sitting a little clear of the target, and rocking gently, because a
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

/**
 * Height of whatever is drawn flat on the ground at a point, in metres.
 *
 * The lifts above are a drawing trick, but they are still the surface a player
 * sees: the railhead is painted 18 cm above the plane the simulation stops a
 * bird on, so a bird resting on the plane under a track is a bird standing
 * inside it. Asked once when something comes to rest rather than every frame,
 * which is why a plain scan of the ribbons is fast enough.
 *
 * Rails beat roads because that is the order they are drawn in: at a level
 * crossing the rail is the surface you would stand on.
 */
export function groundSurfaceAt(
  x: number,
  z: number,
  roads: readonly Road[] = [],
  rails: readonly Rail[] = [],
): number {
  for (const rail of rails) if (onRibbon(x, z, rail.points, rail.width)) return RAIL_LIFT;
  for (const road of roads) if (onRibbon(x, z, road.points, road.width)) return ROAD_LIFT;
  return 0;
}

/** Whether a point lies within `width` of a polyline, measured across it. */
function onRibbon(
  x: number,
  z: number,
  points: readonly (readonly [number, number])[],
  width: number,
): boolean {
  const half = width / 2;
  for (let i = 1; i < points.length; i += 1) {
    const [x0, z0] = points[i - 1]!;
    const [x1, z1] = points[i]!;
    const dx = x1 - x0;
    const dz = z1 - z0;
    const span = dx * dx + dz * dz;
    // Clamped projection onto the segment: past either end, the nearest point
    // is that end, which is what rounds off a ribbon's corners.
    const t = span < 1e-12 ? 0 : Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / span));
    if (Math.hypot(x - (x0 + dx * t), z - (z0 + dz * t)) <= half) return true;
  }
  return false;
}

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
 * One vehicle's parts, in its own frame: along it, across it, and up.
 *
 * Built in local coordinates rather than baked into the world, because a train
 * that moves cannot have its position in its vertices. Each vehicle gets a
 * mesh and a transform, which is thirteen draw calls for a rake and the only
 * arrangement where moving one is free.
 */
function buildVehicle(vehicle: Vehicle): {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
} {
  const positions: number[] = [];
  const normals: number[] = [];
  const colours: number[] = [];
  const tint = new THREE.Color();

  const part = (
    colour: number,
    along: number,
    across: number,
    base: number,
    length: number,
    width: number,
    height: number,
  ) => {
    const box = new THREE.BoxGeometry(length, height, width).toNonIndexed();
    box.translate(along, base + height / 2, across);

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

  /** A cylinder lying across the vehicle: a wheel, or an axle. */
  const wheel = (colour: number, along: number, across: number, base: number, radius: number, width: number) => {
    const disc = new THREE.CylinderGeometry(radius, radius, width, 12).toNonIndexed();
    disc.rotateX(Math.PI / 2);
    disc.translate(along, base + radius, across);
    const point = disc.getAttribute('position');
    const normal = disc.getAttribute('normal');
    tint.setHex(colour);
    for (let i = 0; i < point.count; i += 1) {
      positions.push(point.getX(i), point.getY(i), point.getZ(i));
      normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
      colours.push(tint.r, tint.g, tint.b);
    }
    disc.dispose();
  };

  /** An upright cylinder: the exhaust stack. */
  const pipe = (colour: number, along: number, across: number, base: number, radius: number, height: number) => {
    const tube = new THREE.CylinderGeometry(radius, radius * 1.15, height, 10).toNonIndexed();
    tube.translate(along, base + height / 2, across);
    const point = tube.getAttribute('position');
    const normal = tube.getAttribute('normal');
    tint.setHex(colour);
    for (let i = 0; i < point.count; i += 1) {
      positions.push(point.getX(i), point.getY(i), point.getZ(i));
      normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
      colours.push(tint.r, tint.g, tint.b);
    }
    tube.dispose();
  };

  const IRON = 0x2b2b2d;
  const RUST = 0x5c4a40;
  const bogie = vehicle.length * 0.33;

  if (vehicle.kind === 'engine') {
    const LIVERY = 0x7d2f26;
    const TRIM = 0xd9c37a;
    const GLASS = 0x24313b;
    const half = vehicle.length / 2;
    const side = vehicle.width / 2;

    // Underframe, fuel tank slung between the bogies, and the buffer beams.
    part(IRON, 0, 0, 0.62, vehicle.length, vehicle.width, 0.34);
    part(0x1f1f21, 0, 0, 0.3, 6.4, vehicle.width * 0.72, 0.62);
    for (const end of [half - 0.15, -(half - 0.15)]) {
      part(0x3a3a3c, end, 0, 0.72, 0.3, vehicle.width + 0.16, 0.5);
      // Buffers either side of the coupling.
      for (const at of [0.85, -0.85]) part(0x55565a, end, at, 0.86, 0.34, 0.34, 0.26);
    }

    // Bogies: frames, and wheels you can count.
    for (const end of [bogie, -bogie]) {
      part(IRON, end, 0, 0.42, 3.6, vehicle.width * 0.74, 0.42);
      for (const axle of [-1.15, 0, 1.15]) {
        for (const at of [side * 0.72, -side * 0.72]) {
          wheel(0x1a1a1c, end + axle, at, 0.0, 0.46, 0.22);
        }
      }
    }

    // The long hood, with a walkway either side of it and a running board.
    part(LIVERY, -1.4, 0, 0.96, vehicle.length - 5.6, vehicle.width * 0.84, ENGINE.body - 0.96);
    part(0x4a4b4f, 0, 0, 0.96, vehicle.length - 0.5, vehicle.width, 0.1);
    // Radiator grilles down both flanks.
    for (const at of [side * 0.85, -side * 0.85]) {
      for (const along of [-4.2, -2.8, -1.4]) {
        part(0x3c3d40, along, at, 1.9, 1.05, 0.06, 1.3);
      }
    }
    // A band of livery trim along the flanks, which is what makes it read as
    // a machine somebody painted rather than an extruded block.
    for (const at of [side * 0.86, -side * 0.86]) {
      part(TRIM, -1.4, at, 1.35, vehicle.length - 5.8, 0.05, 0.16);
    }

    // The cab: body, glass all round, and a roof overhanging it.
    const cabAt = half - ENGINE.cabLength / 2 - 0.35;
    part(LIVERY, cabAt, 0, ENGINE.body, ENGINE.cabLength, vehicle.width, ENGINE.cab - ENGINE.body - 0.18);
    const glassBase = ENGINE.body + 0.42;
    const glassHigh = ENGINE.cab - ENGINE.body - 0.18 - 0.62;
    part(GLASS, cabAt + ENGINE.cabLength / 2 - 0.05, 0, glassBase, 0.08, vehicle.width * 0.86, glassHigh);
    part(GLASS, cabAt - ENGINE.cabLength / 2 + 0.05, 0, glassBase, 0.08, vehicle.width * 0.86, glassHigh);
    for (const at of [side - 0.04, -(side - 0.04)]) {
      part(GLASS, cabAt, at, glassBase, ENGINE.cabLength * 0.62, 0.08, glassHigh);
    }
    part(0x3f4145, cabAt, 0, ENGINE.cab - 0.18, ENGINE.cabLength + 0.35, vehicle.width + 0.22, 0.18);

    // The short nose ahead of the cab, and lamps at both ends.
    part(LIVERY, half - 0.9, 0, 0.96, 1.1, vehicle.width * 0.8, 1.5);
    for (const end of [half - 0.35, -(half - 0.35)]) {
      part(0xf2e6b8, end, 0.55, 2.05, 0.12, 0.34, 0.3);
      part(0xf2e6b8, end, -0.55, 2.05, 0.12, 0.34, 0.3);
    }

    // Roof furniture: the radiator fan housing, and the stack the smoke comes
    // out of. Its top is where the plume is lit from -- see ENGINE.stack.
    part(0x46474b, -4.6, 0, ENGINE.body, 2.2, vehicle.width * 0.7, 0.34);
    wheel(0x2f3033, -4.6, 0, ENGINE.body + 0.34, 0.62, 0.12);
    pipe(0x232427, ENGINE.stackAlong, 0, ENGINE.body, 0.3, ENGINE.stackHeight);
  } else {
    // Running gear, solebar, and the deck laid on top of it.
    for (const end of [bogie, -bogie]) {
      part(IRON, end, 0, 0.15, 2.6, vehicle.width * 0.78, 0.6);
    }
    part(RUST, 0, 0, WAGON.deck - 0.5, vehicle.length, vehicle.width * 0.9, 0.32);
    part(0x6f5c45, 0, 0, WAGON.deck - 0.18, vehicle.length, vehicle.width, 0.18);

    const across = vehicle.width / 2 - WAGON.stakeThickness / 2;
    const spacing = (vehicle.length - WAGON.stakeThickness) / (WAGON.stakesPerSide - 1);
    for (let i = 0; i < WAGON.stakesPerSide; i += 1) {
      const along = -(vehicle.length - WAGON.stakeThickness) / 2 + i * spacing;
      for (const side of [across, -across]) {
        part(0x7c6a51, along, side, WAGON.deck, WAGON.stakeThickness, WAGON.stakeThickness, WAGON.stake);
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

/**
 * How solid one bubble is at its thickest.
 *
 * Low on purpose. A plume is not one object, it is several hundred faint ones
 * on top of each other, and that is the difference between smoke you can see
 * into and a silhouette.
 */
const PUFF_ALPHA = 0.2;

/**
 * A soft round smudge, drawn to a canvas.
 *
 * One puff of smoke. Dark in the middle and falling away to nothing at the
 * rim, so that a few hundred of them overlapping read as one billowing mass
 * rather than as a few hundred discs.
 */
function makePuffTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d')!;
  const middle = size / 2;
  const gradient = ctx.createRadialGradient(middle, middle, 0, middle, middle, middle);
  // Soft all the way out. A hard rim makes a disc, and a few hundred discs
  // make a blob with an outline; what is wanted is a bubble whose edge you
  // cannot find.
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
  gradient.addColorStop(0.35, 'rgba(255, 255, 255, 0.55)');
  gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.16)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  return new THREE.CanvasTexture(canvas);
}

/**
 * Every puff of smoke in the world, as one instanced billboard mesh.
 *
 * Drawn after the world and before the marker arrows, without writing depth --
 * smoke does not occlude smoke, it accumulates. It is dark rather than bright,
 * so the usual additive trick would wash it out; ordinary alpha over the top
 * of the city is what makes it read as soot.
 */
function buildSmoke(capacity: number): {
  mesh: THREE.InstancedMesh;
  material: THREE.MeshBasicMaterial;
  texture: THREE.Texture;
  geometry: THREE.PlaneGeometry;
  fade: THREE.InstancedBufferAttribute;
} {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const texture = makePuffTexture();

  // White, so the instance colour is the colour. Black here multiplies the
  // per-puff grey away to nothing, which is how the plume came out as one
  // solid hole in the sky rather than as smoke.
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    fog: true,
    color: 0xffffff,
  });

  // Three has no per-instance opacity, and without one every puff draws at
  // full strength however old it is: they cannot fade, so they pile up into a
  // silhouette. One float an instance, multiplied into the alpha.
  const fade = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  fade.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('puffFade', fade);

  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `attribute float puffFade;\nvarying float vPuffFade;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n        vPuffFade = puffFade;',
    );
    shader.fragmentShader = `varying float vPuffFade;\n${shader.fragmentShader}`.replace(
      '#include <color_fragment>',
      '#include <color_fragment>\n      diffuseColor.a *= vPuffFade;',
    );
  };
  material.customProgramCacheKey = () => 'smoke-puff';

  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  return { mesh, material, texture, geometry, fade };
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
