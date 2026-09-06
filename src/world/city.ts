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
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { createColliderField, type Box, type Collider } from '../sim/collision';
import {
  CAR,
  generateCityLayout,
  nestOn,
  PUMP,
  penthouseOf,
  PERSON_HEIGHT,
  terraceOf,
  type Building,
  type CityLayout,
  type Landmark,
  type Station,
} from './layout';
import type { Rail, Road } from './streets';
import { CARRIAGE, ENGINE, TRAM, WAGON, type Train, type Vehicle } from './train';
import { defaultSmokeOptions, puffOpacity, puffRadius, type Puff } from './smoke';
import { SEED_SIZE } from './seeds';
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
   * Draw the marker this frame: how red to glow, and where to hang the arrow.
   *
   * Told rather than deciding. Whether the thing being pointed at is this
   * building, a pigeon standing on it, or nothing at all because the two of
   * them are talking, is a question about the game and not about the mesh --
   * so it is answered by whoever knows, and this only does as it is asked.
   * `over` of null hides the arrow.
   */
  update(
    elapsed: number,
    viewer: THREE.Vector3,
    flash: number,
    over: THREE.Vector3 | null,
  ): void;
}

export interface ObjectiveOptions {
  /** How many puffs of smoke the renderer must be ready to draw. */
  smoke?: number;
  /**
   * Vehicles to pick out as objectives, by which train and where in the rake.
   *
   * Named here rather than flagged on the layout because which wagon is a
   * level is a decision about the game, not a fact about the train. The
   * described things in the world need no such list: they arrive on the
   * layout already named, having been put there on purpose.
   */
  objectives?: { name: string; train: number; vehicle: number }[];
  /** How many seeds the renderer must be ready to draw. */
  seeds?: number;
  /**
   * Lines painted across the ground, one for each level that ends at one.
   *
   * A level that finishes at a line finishes at an invisible one, and a
   * flight that changes level in mid-air with nothing to see reads as a
   * glitch rather than as an arrival. So the line gets painted: a band of
   * yellow across the route, wide enough to be aimed at and long enough that
   * leaving it to one side is a decision rather than an accident.
   *
   * Named by the level that owns it, because only the level being flown shows
   * its own -- the same arrangement the target markers have.
   */
  gates?: { name: string; x: number; z: number; yaw: number; span: number }[];
}

export interface World {
  group: THREE.Group;
  /** Every solid object, in simulation coordinates. */
  boxes: Box[];
  /** Broad-phase-accelerated view of `boxes`, ready to sweep against. */
  collider: Collider;
  /** Everything the pigeon can be sent to, in the order it was named. */
  markers: TargetMarker[];
  /** The painted lines, by the name of the level each belongs to. */
  gates: { name: string; object: THREE.Object3D }[];
  /** Put the thrown grain where the simulation says it has got to. */
  updateSeeds(seeds: readonly { x: number; y: number; z: number }[]): void;
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

/**
 * Where the arrow starts thinning out and where it is gone, in metres.
 *
 * Because it does not shrink below its floor and is drawn in front of
 * everything: on short final it is a yellow arrow filling the screen, between
 * you and the thing it is pointing at. That was survivable while every target
 * was a roof you came down onto from above. A patch of concrete on the ground
 * is approached through it.
 */
const ARROW_GONE = 8;
const ARROW_FULL = 26;

/**
 * How solid the arrow is at a given range, 0 to 1.
 *
 * Faded rather than switched off, or the last frame before it goes reads as
 * the marker breaking -- the same reason the flash used to fade, and the same
 * mistake if it is not. By the time it has gone you are close enough to see
 * what you are landing on without help.
 */
export function arrowFade(distance: number): number {
  const across = (distance - ARROW_GONE) / (ARROW_FULL - ARROW_GONE);
  return across < 0 ? 0 : across > 1 ? 1 : across;
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
 * Described things are not in this list at all, and that is why they are flat.
 * A landmark's top is exactly the top of its collision box, so the bird lands
 * where it looks like it does; a pitched roof over that would be a roof you
 * fall through.
 */
export function buildRoofs(buildings: readonly Building[]): THREE.BufferGeometry {
  const tiled = buildings;
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
  // Drawn first, and -- like every other flat layer -- it does not write
  // depth. It used to be the one that did, on the grounds that something has
  // to; nothing has to. Everything in the world stands *on* this plane, so
  // there is nothing underneath for it to hide, and a flat layer that writes
  // depth at exactly the height of the flat layers drawn after it is a fight
  // those layers lose about half the pixels of.
  ground.material.depthWrite = false;
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

  /**
   * The described things, each drawn on its own.
   *
   * A landmark is one building among thousands, so it gets its own mesh
   * rather than a seventh instanced bucket holding a single entry -- and it
   * has to be its own mesh anyway, because it is the thing that flashes. It
   * is not in `layout.buildings` at all, which is what keeps it out of the
   * instanced crowd and off the roof pass without anything having to look for
   * it there.
   */
  for (const landmark of layout.landmarks) {
    if (landmark.station) {
      // The forecourt itself, which is the ground the landmark reserves: laid
      // flat and drawn like every other flat thing, under the roads and level
      // with the grass. Without it the hut, the pump and the car stand on a
      // lawn, and three objects on a lawn are three objects rather than a
      // petrol station.
      const yard = new THREE.PlaneGeometry(landmark.width, landmark.depth);
      yard.rotateX(-Math.PI / 2);
      const tarmac = new THREE.MeshLambertMaterial({
        color: FORECOURT,
        side: THREE.DoubleSide,
      });
      disposables.push(yard, tarmac);
      const apron = new THREE.Mesh(yard, asDecal(tarmac));
      apron.position.set(landmark.x, 0, landmark.z);
      apron.rotation.y = landmark.yaw ?? 0;
      apron.receiveShadow = true;
      apron.renderOrder = PATCH_ORDER;
      group.add(apron);

      const geometry = buildStation(landmark.station);
      const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
      disposables.push(geometry, material);

      const site = new THREE.Mesh(geometry, material);
      site.position.set(landmark.x, 0, landmark.z);
      site.rotation.y = landmark.yaw ?? 0;
      site.castShadow = true;
      site.receiveShadow = true;
      group.add(site);

      markers.push(
        createMarker(
          landmark.name,
          material,
          new THREE.Vector3(landmark.x, landmark.height, landmark.z),
          disposables,
          overlay,
        ),
      );
      continue;
    }

    if (landmark.canopy) {
      markers.push(growTree(landmark, group, disposables, overlay));
      continue;
    }

    if (landmark.height > 0) {
      // An ordinary building between flashes, which is what it goes back to.
      // Both tiers share the one material, so both go red together: it is one
      // building with a shape, not two standing next to each other.
      const material = withWindows(new THREE.MeshLambertMaterial({ color: LANDMARK_COLOR }));
      disposables.push(material);

      const terrace = terraceOf(landmark);
      const penthouse = penthouseOf(landmark);

      // Paving where the terrace is, so the open half reads as somewhere to
      // stand rather than as a roof that happens to be lower. It is the box's
      // own top face rather than a slab laid over it -- a slab would be a
      // step, and a step is what the bird's feet would sink into.
      const deck = terrace
        ? new THREE.MeshLambertMaterial({ color: TERRACE_COLOR })
        : null;
      if (deck) disposables.push(deck);
      const faces = deck ? [material, material, deck, material, material, material] : material;

      const block = new THREE.Mesh(boxGeometry, faces);
      block.position.set(landmark.x, landmark.height / 2, landmark.z);
      block.rotation.y = landmark.yaw ?? 0;
      block.scale.set(landmark.width, landmark.height, landmark.depth);
      block.castShadow = true;
      block.receiveShadow = true;
      group.add(block);

      if (penthouse) {
        // Sitting on the terrace rather than starting from the ground, so its
        // outer walls stop where the block's begin instead of sharing the
        // same plane over the same stretch and fighting for the pixels. Its
        // wall over the terrace is a wall like any other, which is where the
        // windows looking out over it come from -- the shader puts them on
        // anything that is not facing up.
        const rise = penthouse.top - landmark.height;
        const upper = new THREE.Mesh(boxGeometry, material);
        upper.position.set(penthouse.x, landmark.height + rise / 2, penthouse.z);
        upper.rotation.y = penthouse.yaw;
        upper.scale.set(penthouse.width, rise, penthouse.depth);
        upper.castShadow = true;
        upper.receiveShadow = true;
        group.add(upper);
      }

      // The arrow hangs over the terrace, not over the highest point. The
      // terrace is what the level asks you to land on; pointing at the roof
      // of the penthouse would be pointing three metres above and half a
      // building along from the place you are going.
      const aim = terrace ?? { x: landmark.x, z: landmark.z, top: landmark.height };
      markers.push(
        createMarker(
          landmark.name,
          deck ? [material, deck] : material,
          new THREE.Vector3(aim.x, aim.top, aim.z),
          disposables,
          overlay,
        ),
      );
      continue;
    }

    // Flat: a patch of concrete, level with the grass rather than laid on
    // top of it. A slab even ten centimetres proud is a step, and a level
    // whose target you have to land *inside* is a much harder level than one
    // whose target you land near and walk onto.
    const slab = new THREE.PlaneGeometry(landmark.width, landmark.depth);
    slab.rotateX(-Math.PI / 2);
    const concrete = new THREE.MeshLambertMaterial({
      color: PATCH_COLOR,
      side: THREE.DoubleSide,
    });
    disposables.push(slab, concrete);

    const mesh = new THREE.Mesh(slab, asDecal(concrete));
    mesh.position.set(landmark.x, 0, landmark.z);
    mesh.rotation.y = landmark.yaw ?? 0;
    mesh.receiveShadow = true;
    mesh.renderOrder = PATCH_ORDER;
    group.add(mesh);

    markers.push(
      createMarker(
        landmark.name,
        concrete,
        new THREE.Vector3(landmark.x, 0, landmark.z),
        disposables,
        overlay,
      ),
    );
  }

  // --- Finishing lines ------------------------------------------------------
  // Painted like the road markings are, and over them: this is the one flat
  // thing in the world that is not part of the city, and a stripe that a
  // tram line could cover would be a stripe you cannot trust.
  const gates: { name: string; object: THREE.Object3D }[] = [];
  for (const gate of options.gates ?? []) {
    const band = new THREE.PlaneGeometry(GATE_THICKNESS, gate.span);
    band.rotateX(-Math.PI / 2);
    const paint = new THREE.MeshLambertMaterial({ color: GATE_COLOR, side: THREE.DoubleSide });
    disposables.push(band, paint);

    const stripe = new THREE.Mesh(band, asDecal(paint));
    stripe.position.set(gate.x, 0, gate.z);
    stripe.rotation.y = gate.yaw;
    stripe.renderOrder = GATE_ORDER;
    // Shown only while the level it belongs to is the one being flown.
    stripe.visible = false;
    group.add(stripe);
    gates.push({ name: gate.name, object: stripe });
  }

  // --- Grain ----------------------------------------------------------------
  // One instanced mesh, sized to the most that can ever be down at once, with
  // the count moved rather than the instances: a seed being eaten is the
  // count going down by one, and there are never more than a handful.
  const grain = new THREE.SphereGeometry(SEED_SIZE / 2, 5, 4);
  const husk = new THREE.MeshLambertMaterial({ color: SEED_COLOR, flatShading: true });
  disposables.push(grain, husk);
  const scattered = new THREE.InstancedMesh(grain, husk, options.seeds ?? 0);
  scattered.name = 'seeds';
  scattered.count = 0;
  scattered.castShadow = true;
  // Never culled, and this is a bug fix rather than a preference. An instanced
  // mesh is culled as one object against a bounding sphere worked out from its
  // instance matrices -- once, the first time anything asks, and never again.
  // The seeds are thrown after that and land nine hundred metres from where
  // that sphere was drawn, so the whole scatter blinked in and out depending
  // on where the camera was pointed. Eight spheres in one draw call are not
  // worth a frustum test anyway.
  scattered.frustumCulled = false;
  if (options.seeds) group.add(scattered);

  const roofGeometry = buildRoofs(layout.buildings);
  const roofMaterial = withTiles(new THREE.MeshLambertMaterial({ color: 0xffffff }));
  disposables.push(roofGeometry, roofMaterial);

  const roofs = new THREE.Mesh(roofGeometry, roofMaterial);
  roofs.castShadow = true;
  roofs.receiveShadow = true;
  group.add(roofs);

  layout.buildings.forEach((building, i) => {
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
  //
  // One instanced mesh per sort, which is a handful of draw calls for the
  // whole nine thousand of them however many sorts there are -- the cost is
  // in the count, and the count has not changed.
  const kinds = treeShapes().map(({ geometry, color }) => {
    const material = new THREE.MeshLambertMaterial({ color, flatShading: true });
    disposables.push(geometry, material);
    return { geometry, material, count: 0 };
  });

  // Counted first, because an InstancedMesh is told its size when it is made
  // and a wrong guess is either wasted memory or missing trees.
  for (const tree of layout.trees) {
    const kind = kinds[tree.species % kinds.length];
    if (kind) kind.count += 1;
  }

  const stands = kinds.map(({ geometry, material, count }) => {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.castShadow = true;
    // Named so the test that counts them can tell a stand of trees from the
    // other instanced things in the world, which is otherwise guesswork.
    mesh.name = 'trees';
    mesh.count = 0;
    group.add(mesh);
    return mesh;
  });

  for (const tree of layout.trees) {
    const stand = stands[tree.species % stands.length]!;
    // Every shape is modelled one unit tall with its foot at the origin and
    // already in its own proportions, so the same scale puts any of them on
    // the ground at the size the layout asked for.
    matrix.makeScale(tree.radius, tree.height, tree.radius);
    matrix.setPosition(tree.x, 0, tree.z);
    stand.setMatrixAt(stand.count++, matrix);
  }
  for (const stand of stands) stand.instanceMatrix.needsUpdate = true;

  // --- Headstones -----------------------------------------------------------
  // One instanced mesh for the lot, like the trees they stand among. A stone
  // is two boxes -- the slab and the kerb it stands on -- fused into one
  // vertex-coloured shape, so the whole cemetery is a single draw call.
  if (layout.graves.length) {
    const stone = graveShape();
    const granite = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    disposables.push(stone, granite);

    const yard = new THREE.InstancedMesh(stone, granite, layout.graves.length);
    yard.castShadow = true;
    yard.receiveShadow = true;
    // Named for the same reason the stands of trees are: so a test counting
    // them can tell them from every other instanced thing in the world.
    yard.name = 'graves';
    group.add(yard);

    layout.graves.forEach((grave, i) => {
      rotation.setFromAxisAngle(up, grave.yaw);
      position.set(grave.x, 0, grave.z);
      // Modelled one metre tall and at the width a stone is, so the height is
      // the only thing scaled. A taller stone is a taller stone, not a
      // bigger one: scaling all three axes would make a four-metre marker two
      // metres wide, which is a wall.
      scale.set(1, grave.height, 1);
      matrix.compose(position, rotation, scale);
      yard.setMatrixAt(i, matrix);
    });
    yard.instanceMatrix.needsUpdate = true;
  }

  // --- Terrace planting -----------------------------------------------------
  // Bushes, which are trees that stand on something. One instanced mesh for
  // the lot, drawn even when there are none, because a landmark with a
  // terrace is a thing the world may or may not have been given.
  if (layout.bushes.length) {
    const shrub = bushShape();
    const bushMaterial = new THREE.MeshLambertMaterial({
      color: shrub.color,
      flatShading: true,
    });
    disposables.push(shrub.geometry, bushMaterial);

    const hedge = new THREE.InstancedMesh(shrub.geometry, bushMaterial, layout.bushes.length);
    hedge.castShadow = true;
    hedge.receiveShadow = true;
    // Named for the same reason the stands of trees are: so a test counting
    // them can tell them from every other instanced thing in the world.
    hedge.name = 'bushes';
    group.add(hedge);

    layout.bushes.forEach((bush, i) => {
      matrix.makeScale(bush.radius, bush.height, bush.radius);
      matrix.setPosition(bush.x, bush.base, bush.z);
      hedge.setMatrixAt(i, matrix);
    });
    hedge.instanceMatrix.needsUpdate = true;
  }

  // --- People ---------------------------------------------------------------
  // Two metres of somebody, which is the only thing in the world with a size
  // you already know. A roof is whatever size you decide it is until there is
  // a person standing on it.
  if (layout.people.length) {
    const figure = personShape();
    const skin = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    disposables.push(figure, skin);

    const crowd = new THREE.InstancedMesh(figure, skin, layout.people.length);
    crowd.castShadow = true;
    crowd.receiveShadow = true;
    // Named so a test can count them apart from every other instanced thing.
    crowd.name = 'people';
    group.add(crowd);

    layout.people.forEach((person, i) => {
      rotation.setFromAxisAngle(up, person.facing);
      position.set(person.x, person.base, person.z);
      scale.setScalar(PERSON_HEIGHT);
      matrix.compose(position, rotation, scale);
      crowd.setMatrixAt(i, matrix);
    });
    crowd.instanceMatrix.needsUpdate = true;
  }

  // --- Parks, woods and water ----------------------------------------------
  // Drawn under the roads, so a path through a park still reads as a path.
  if (layout.areas?.length) {
    for (const { geometry, material } of buildAreas(layout.areas)) {
      disposables.push(geometry, material);
      const patch = new THREE.Mesh(geometry, asDecal(material));
      patch.receiveShadow = true;
      patch.renderOrder = AREA_ORDER;
      group.add(patch);
    }
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
      // Named for the same reason the stands of trees are: so a test counting
      // the rake can tell it from everything else built out of many colours.
      mesh.name = 'vehicle';
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
      const alpha = puffOpacity(puff, defaultSmokeOptions);
      if (alpha <= 0.004 || drawn >= plume.mesh.count + puffs.length) continue;

      const radius = puffRadius(puff, defaultSmokeOptions) * 2;
      puffPlace.set(puff.x, puff.y, puff.z);
      puffScale.set(radius, radius, radius);
      puffMatrix.compose(puffPlace, viewer, puffScale);
      plume.mesh.setMatrixAt(drawn, puffMatrix);

      // Soot at the stack, thinning to a grey haze as it disperses -- and
      // never black, which reads as a hole in the sky rather than as smoke.
      const through = Math.min(1, puff.risen / defaultSmokeOptions.reach);
      const grey = 0.09 + 0.34 * through;
      puffTint.setRGB(grey, grey, grey * 1.06);
      plume.mesh.setColorAt(drawn, puffTint);

      // There are eighteen of these in a plume rather than fifteen hundred,
      // so each one has to carry its own weight: near enough opaque at the
      // stack, and thinning as it climbs.
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
    const track = new THREE.Mesh(geometry, asDecal(material));
    track.receiveShadow = true;
    track.renderOrder = RAIL_ORDER;
    group.add(track);
  }

  // --- Streets ------------------------------------------------------------
  if (layout.roads?.length) {
    const { geometry, material } = buildRoads(layout.roads);
    disposables.push(geometry, material);
    const surface = new THREE.Mesh(geometry, asDecal(material));
    surface.receiveShadow = true;
    surface.renderOrder = ROAD_ORDER;
    group.add(surface);
  }

  return {
    group,
    boxes: layout.boxes,
    collider: createColliderField(layout.boxes),
    markers,
    gates,
    updateSeeds(seeds) {
      scattered.count = Math.min(seeds.length, scattered.instanceMatrix.count);
      for (let i = 0; i < scattered.count; i += 1) {
        const seed = seeds[i]!;
        position.set(seed.x, seed.y, seed.z);
        matrix.compose(position, rotation.identity(), scale.setScalar(1));
        scattered.setMatrixAt(i, matrix);
      }
      scattered.instanceMatrix.needsUpdate = true;
    },
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
  /**
   * What to recolour, which is everything the target is made of.
   *
   * More than one when the target has more than one material -- a block of
   * flats with a paved terrace is walls and paving, and half of it going red
   * would read as a rendering fault rather than as a signal.
   */
  paint: THREE.MeshLambertMaterial | readonly THREE.MeshLambertMaterial[],
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
  const materials = Array.isArray(paint) ? paint : [paint as THREE.MeshLambertMaterial];

  const head = new THREE.ConeGeometry(0.5, 1.1, 4);
  head.rotateX(Math.PI);
  head.translate(0, 0.55, 0);
  const shaft = new THREE.CylinderGeometry(0.16, 0.16, 1.1, 4);
  shaft.translate(0, 1.65, 0);

  // Drawn in its own pass over a cleared depth buffer, so it needs no tricks
  // to stay in front: there is simply nothing else in the pass with it.
  const arrowMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd21f,
    fog: false,
    transparent: true,
  });
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
      if (!on) for (const material of materials) material.emissive.setScalar(0);
    },
    update(elapsed, viewer, flash, over) {
      if (!active) return;

      for (const material of materials) material.emissive.copy(lit).multiplyScalar(flash);

      arrow.visible = over !== null;
      if (!over) return;

      const range = over.distanceTo(viewer);
      arrowMaterial.opacity = arrowFade(range);
      arrow.visible = arrowMaterial.opacity > 0;
      if (!arrow.visible) return;

      const size = arrowScale(range);
      arrow.scale.setScalar(size);
      // Sitting a little clear of what it points at, and rocking gently,
      // because a marker that moves is found a good deal faster than one
      // that does not.
      const bob = Math.sin(elapsed * 2.2) * 0.12 + 1;
      arrow.position.set(over.x, over.y + size * 0.55 * bob + 1.5, over.z);
    },
  };
}

/**
 * One geometry out of several.
 *
 * Everything is flattened to non-indexed first: a cylinder comes indexed and
 * an icosahedron does not, and merging refuses to mix the two. Nothing here is
 * big enough for the indices to have been saving anything.
 */
function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((part) => (part.index ? part.toNonIndexed() : part));
  const one = mergeGeometries(flat);
  // A part that was already flat is its own flattening, so the two lists
  // overlap and disposing both by hand would free it twice.
  for (const part of new Set([...parts, ...flat])) part.dispose();
  return one;
}

/**
 * Merge parts of different colours into one vertex-coloured geometry.
 *
 * Which is what lets a thing made of several colours still be one instanced
 * draw. A material per colour would mean a mesh per colour and a matrix
 * written per colour, all of them describing the same object.
 */
function painted(parts: { geometry: THREE.BufferGeometry; color: number }[]): THREE.BufferGeometry {
  const tint = new THREE.Color();
  for (const part of parts) {
    tint.set(part.color);
    const count = part.geometry.getAttribute('position').count;
    const colours = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      colours[i * 3] = tint.r;
      colours[i * 3 + 1] = tint.g;
      colours[i * 3 + 2] = tint.b;
    }
    part.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  }
  return merged(parts.map((part) => part.geometry));
}

/**
 * A headstone: a slab on a kerb, modelled one metre tall on the origin.
 *
 * Scaled by height alone rather than by height and width, like everything
 * else that stands on this ground: a taller stone is a taller stone, not a
 * differently proportioned one.
 */
function graveShape(): THREE.BufferGeometry {
  const slab = new THREE.BoxGeometry(0.62, 0.86, 0.14);
  slab.translate(0, 0.51, 0);
  // A rounded top, which is most of what says headstone rather than post.
  const crown = new THREE.CylinderGeometry(0.31, 0.31, 0.14, 7, 1, false, 0, Math.PI);
  crown.rotateX(Math.PI / 2);
  crown.rotateY(Math.PI);
  crown.translate(0, 0.94, 0);
  const kerb = new THREE.BoxGeometry(0.78, 0.16, 0.4);
  kerb.translate(0, 0.08, 0.06);

  return painted([
    { geometry: slab, color: GRAVE_STONE },
    { geometry: crown, color: GRAVE_STONE },
    { geometry: kerb, color: GRAVE_KERB },
  ]);
}

/**
 * A person, standing.
 *
 * Modelled one unit tall on the origin like everything else that stands on
 * something, and scaled by their height rather than by a height and a girth:
 * a person is not wider for being taller in any way worth modelling, and
 * proportions given as two numbers are proportions that can be given wrongly.
 *
 * Facing -Z, which is the way the bird faces at a heading of zero, so a
 * rotation about Y means the same thing for both of them.
 */
function personShape(): THREE.BufferGeometry {
  const box = (
    color: number,
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z = 0,
  ) => {
    const part = new THREE.BoxGeometry(width, height, depth);
    part.translate(x, y + height / 2, z);
    return { geometry: part, color };
  };

  // Told apart by tone rather than by hue, because at fifty metres in a low
  // sun the hue is gone: a mid coat over dark trousers, and a head paler than
  // either so the head and shoulders are the shape that survives.
  const COAT = 0x5a6c86;
  const TROUSERS = 0x2e3138;
  const SKIN = 0xd8a882;
  const HAIR = 0x3a2e26;

  // Proportioned off two metres: a 46 cm shoulder, an 85 cm leg, a 22 cm
  // head. It reads as a person at fifty metres, which is the whole job.
  const head = new THREE.IcosahedronGeometry(0.055, 0);
  head.scale(1, 1.1, 0.95);
  head.translate(0, 0.925, 0);

  const cap = new THREE.SphereGeometry(0.057, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.scale(1, 0.7, 0.95);
  cap.translate(0, 0.935, 0);

  return painted([
    box(TROUSERS, 0.07, 0.43, 0.08, -0.046, 0),
    box(TROUSERS, 0.07, 0.43, 0.08, 0.046, 0),
    box(COAT, 0.2, 0.36, 0.12, 0, 0.43),
    // The arms out in front rather than hanging at the sides, which is the
    // one thing that gives the figure a front. Every other part of it is
    // symmetrical about both axes, so until this it could be turned to face
    // anywhere and look identical -- and a person throwing grain who might as
    // well have their back to the birds is a person the scene cannot explain.
    box(COAT, 0.05, 0.33, 0.09, -0.135, 0.45, -0.05),
    box(COAT, 0.05, 0.33, 0.09, 0.135, 0.45, -0.05),
    box(SKIN, 0.05, 0.06, 0.05, 0, 0.79),
    { geometry: head, color: SKIN },
    { geometry: cap, color: HAIR },
  ]);
}

/**
 * A clipped shrub in a planter, for a terrace.
 *
 * Modelled the way the trees are: one unit tall, standing on the origin, and
 * as wide as it wants to be for a radius of one, so the same scale that puts
 * a tree on the ground puts one of these on a roof. Three lobes rather than
 * one sphere -- a single ball reads as a ball, and a row of balls reads as a
 * mistake.
 */
function bushShape(): { geometry: THREE.BufferGeometry; color: number } {
  const lobe = (radius: number, x: number, y: number, z: number) => {
    const part = new THREE.IcosahedronGeometry(radius, 0);
    part.scale(1, 0.8, 1);
    part.translate(x, y, z);
    return part;
  };

  // A planter under it, so it is standing in something rather than growing
  // out of the paving.
  const planter = new THREE.BoxGeometry(1.5, 0.22, 1.5);
  planter.translate(0, 0.11, 0);

  const shrub = merged([
    lobe(0.6, 0, 0.52, 0),
    lobe(0.42, 0.42, 0.42, 0.22),
    lobe(0.38, -0.4, 0.4, -0.26),
    planter,
  ]);
  // Spread until the foliage overhangs its own collision box a little, the
  // same bargain the trees strike: clipping a leafy edge should not read as
  // hitting a wall, and the planter under it stays well inside.
  shrub.scale(1.3, 1, 1.3);

  return { geometry: shrub, color: 0x46703a };
}

/**
 * The sorts of tree, as geometry and colour.
 *
 * Each is built one unit tall standing on the origin, and as wide as that
 * sort wants to be for a radius of one -- a poplar is a spike whatever radius
 * it was given, an old broadleaf is broader than it is tall. The proportion
 * is baked into the geometry rather than carried alongside it as a number to
 * multiply in later, because a number to multiply in later is a number that
 * can be left out.
 *
 * Four is enough for a city to stop looking stamped out. They are told apart
 * by silhouette first and colour second, because at a hundred metres and
 * forty knots the outline is all there is.
 */
function treeShapes(): { geometry: THREE.BufferGeometry; color: number }[] {
  /** Stand a shape on the ground: modelled about the origin, moved up by half. */
  const footed = <T extends THREE.BufferGeometry>(geometry: T, centre = 0.5): T => {
    geometry.translate(0, centre, 0);
    return geometry;
  };

  // A spruce: the narrow dark cone this started as.
  const spruce = footed(new THREE.ConeGeometry(1, 1, 6));

  // A poplar: the same idea drawn out into a spike, which is what a row of
  // them along a road actually looks like.
  const poplar = footed(new THREE.ConeGeometry(1, 1, 5));

  // A broadleaf: a round crown on a bare stem. Two pieces merged into one
  // geometry so it is still a single instanced draw.
  const crown = new THREE.IcosahedronGeometry(0.42, 0);
  crown.scale(1, 0.9, 1);
  crown.translate(0, 0.66, 0);
  const stem = new THREE.CylinderGeometry(0.055, 0.075, 0.45, 5);
  stem.translate(0, 0.225, 0);
  const broadleaf = merged([crown, stem]);

  // An old one of the same: wider, lower, and paler for having been in the
  // sun longer than the rest of them.
  const wideCrown = new THREE.IcosahedronGeometry(0.5, 0);
  wideCrown.scale(1.15, 0.62, 1.15);
  wideCrown.translate(0, 0.6, 0);
  const wideStem = new THREE.CylinderGeometry(0.075, 0.1, 0.42, 5);
  wideStem.translate(0, 0.21, 0);
  const old = merged([wideCrown, wideStem]);

  /** As wide as this sort stands, for a radius of one. */
  const wide = <T extends THREE.BufferGeometry>(geometry: T, spread: number): T => {
    geometry.scale(spread, 1, spread);
    return geometry;
  };

  return [
    { geometry: spruce, color: 0x35512c },
    { geometry: wide(poplar, 0.55), color: 0x4a6b38 },
    { geometry: wide(broadleaf, 1.35), color: 0x4f7a3c },
    { geometry: wide(old, 1.7), color: 0x6b8a48 },
  ];
}

/**
 * Ground markings are decals: flat things lying on other flat things, all of
 * them at ground level, none of them lifted above it.
 *
 * Depth alone cannot separate them -- roads cross each other and overlap at
 * every junction, and coplanar quads fight for the same pixels. Two things
 * settle it and neither is height: none of them writes depth, and they are
 * drawn in a fixed order, so an overlap is settled by which was drawn last.
 * The ground plane they all lie on is one of them and follows the same rule.
 *
 * There used to be a third, a polygon offset per layer, and it was doing
 * nothing at all: the renderer runs a logarithmic depth buffer, so every
 * fragment writes `gl_FragDepth`, and a depth the shader writes replaces the
 * one the rasteriser offset. It went unnoticed while the layers were also
 * lifted -- parkland 5 cm, concrete 7, roads 12, railways 18 -- and turned up
 * the moment they were flattened, as roads flickering a street at a time.
 *
 * The lift was the one mechanism that cost anything. It made the drawn ground
 * a different height from the simulated ground, so a bird standing on a
 * railway stood *in* it, and the fix for that was to ask, every frame and for
 * every bird near the ground, which of the map's several thousand road and
 * railway segments it happened to be over. That question took 0.18 ms to
 * answer. Flat, there is no question.
 */
/** Poured concrete, a bit paler than the roads. */
const PATCH_COLOR = 0x9a9a94;
/** A landmark building, a shade off the crowd it stands in. */
const LANDMARK_COLOR = 0x8d8477;
/** The paving of a roof terrace: pale, and plainly not roof tiles. */
const TERRACE_COLOR = 0xb0aaa0;
/**
 * A petrol station: a hut, a pump and a car, on ground nothing else may use.
 *
 * One mesh of many colours rather than a mesh per part, the way the vehicles
 * and the people are built -- the whole site is a couple of hundred triangles
 * and there is no reason for it to be more than one draw call.
 *
 * Everything is modelled in the forecourt's own frame and turned with it, so
 * the station is described the way a level describes a pigeon on a roof:
 * along it, across it, and facing.
 */
function buildStation(station: Station): THREE.BufferGeometry {
  const parts: { geometry: THREE.BufferGeometry; color: number }[] = [];

  /** A box, in the frame of a thing standing on the forecourt. */
  const box = (
    spot: { along: number; across: number; facing: number },
    colour: number,
    length: number,
    height: number,
    width: number,
    lift: number,
    along = 0,
    across = 0,
  ) => {
    const shape = new THREE.BoxGeometry(length, height, width);
    shape.translate(along, lift + height / 2, across);
    shape.rotateY(spot.facing);
    shape.translate(spot.along, 0, spot.across);
    parts.push({ geometry: shape, color: colour });
  };

  const { hut, pump, car } = station;

  // The office: rendered walls, a flat white fascia band under the eaves, and
  // a shallow canopy over the door. Squat, because the whole thing has to
  // read at a glance from a hundred metres up as "small building, not house".
  box(hut, HUT_WALL, hut.width, hut.height - 0.35, hut.depth, 0);
  box(hut, HUT_TRIM, hut.width + 0.12, 0.35, hut.depth + 0.12, hut.height - 0.35);
  box(hut, GLASS_HUT, hut.width * 0.62, 1.3, 0.08, 0.9, 0, -hut.depth / 2);

  // The pump: an island kerb, the dispenser standing on it, and a dark head
  // where the nozzles and the display are.
  box(pump, FORECOURT, 3.4, 0.12, 1.4, 0);
  box(pump, PUMP_BODY, PUMP.width, PUMP.height - 0.4, PUMP.depth, 0.12);
  box(pump, PUMP_HEAD, PUMP.width * 0.92, 0.4, PUMP.depth * 0.92, PUMP.height - 0.28);

  // The car: a body, a cabin set in from it, and four wheels. A basic car,
  // which at this size is all a car can be -- what has to read is the shape
  // of one, not the make.
  box(car, CAR_BODY, CAR.length, CAR.height - 0.55, CAR.width, 0.28);
  box(car, CAR_GLASS, CAR.length * 0.52, 0.55, CAR.width * 0.86, CAR.height - 0.55 + 0.28, -0.15);
  for (const along of [CAR.length * 0.3, -CAR.length * 0.3]) {
    for (const across of [CAR.width / 2 - 0.06, -(CAR.width / 2 - 0.06)]) {
      box(car, TYRE, 0.62, 0.56, 0.2, 0, along, across);
    }
  }

  return painted(parts);
}

/** A petrol station: rendered hut, its fascia, the pump, and a car. */
const HUT_WALL = 0xd8d3c6;
const HUT_TRIM = 0xf2f4f6;
const GLASS_HUT = 0x2b3a44;
const FORECOURT = 0x9d9a94;
const PUMP_BODY = 0xe4e6e8;
const PUMP_HEAD = 0x2f3338;
const CAR_BODY = 0x9c3b34;
const CAR_GLASS = 0x2b3138;
const TYRE = 0x1b1b1d;

/** Grain: a pale maize yellow, which is what is thrown to pigeons. */
const SEED_COLOR = 0xd9c26a;

/** Weathered granite, and the paler kerb it stands on. */
const GRAVE_STONE = 0x8d8f92;
const GRAVE_KERB = 0xa7a5a0;

/** A described tree: its leaves, the crown seen from above, and its bark. */
const CANOPY_COLOR = 0x4e7538;
const CROWN_TOP_COLOR = 0x6f9450;
const BARK_COLOR = 0x53412f;
/** A nest: dry stems, and the egg in it. */
const NEST_COLOR = 0x8a7248;
const EGG_COLOR = 0xf3ece0;

/**
 * A described tree: a trunk, a crown, and a flat top you can stand on.
 *
 * The flat top is the odd thing about it and it is the point of it. This is
 * the one tree in the city that is a place rather than an obstacle, so the
 * crown is drawn as a mass with its top face at exactly the landmark's
 * height -- which is exactly the top of its collision box, so the bird's feet
 * land on the surface it can see. Lobes hang round the rim to keep it from
 * reading as a green drum, and every one of them is below that face: a lobe
 * standing proud of it would be foliage the bird walks through.
 *
 * Its nest is drawn here too. The nest is what the level is about, but it is
 * built at the size a pigeon builds one, which is nothing from more than
 * about twenty metres off. Finding the tree is the marker's job.
 */
function growTree(
  landmark: Landmark,
  group: THREE.Group,
  disposables: { dispose(): void }[],
  overlay: THREE.Group,
): TargetMarker {
  const canopy = landmark.canopy!;
  // Two radii, and the difference between them is the shape of the tree: the
  // crest is what you can stand on and what the collision box is, and the
  // spread is where the leaves get to.
  const crest = Math.min(landmark.width, landmark.depth) / 2;
  const spread = canopy.spread;
  const clear = Math.max(0, landmark.height - canopy.skirt);

  const leaves = new THREE.MeshLambertMaterial({ color: CANOPY_COLOR, flatShading: true });
  const crownTop = new THREE.MeshLambertMaterial({ color: CROWN_TOP_COLOR });
  const bark = new THREE.MeshLambertMaterial({ color: BARK_COLOR, flatShading: true });
  disposables.push(leaves, crownTop, bark);

  // The trunk runs up into the crown rather than stopping at the underside of
  // it, so there is no seam to see from below.
  const trunkHeight = clear + canopy.skirt * 0.6;
  const trunk = new THREE.CylinderGeometry(canopy.trunk * 0.42, canopy.trunk * 0.6, trunkHeight, 7);
  trunk.translate(0, trunkHeight / 2, 0);
  disposables.push(trunk);
  const stem = new THREE.Mesh(trunk, bark);
  stem.position.set(landmark.x, 0, landmark.z);
  stem.castShadow = true;
  group.add(stem);

  // The crown is widest at the shoulder and draws in to the crest, which is
  // how a broadleaf grown out to the light actually stands -- and it is what
  // makes the flat top read as the top of a tree rather than as a lid on one.
  // The shoulder is where the leaves reach furthest: below it the mass tapers
  // back in towards the trunk.
  const shoulder = landmark.height - canopy.skirt * 0.45;
  const crown = new THREE.CylinderGeometry(crest, spread, landmark.height - shoulder, 11);
  crown.translate(0, (landmark.height + shoulder) / 2, 0);
  disposables.push(crown);
  const cap = new THREE.Mesh(crown, [leaves, crownTop, leaves]);
  cap.position.set(landmark.x, 0, landmark.z);
  cap.castShadow = true;
  cap.receiveShadow = true;
  group.add(cap);

  const under = new THREE.CylinderGeometry(spread, spread * 0.45, shoulder - clear, 11);
  under.translate(0, (shoulder + clear) / 2, 0);
  disposables.push(under);
  const skirt = new THREE.Mesh(under, leaves);
  skirt.position.set(landmark.x, 0, landmark.z);
  skirt.castShadow = true;
  group.add(skirt);

  const lobe = new THREE.IcosahedronGeometry(1, 0);
  disposables.push(lobe);
  const lobes = new THREE.InstancedMesh(lobe, leaves, 7);
  lobes.castShadow = true;
  lobes.name = 'canopy';
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < 7; i += 1) {
    const angle = (i / 7) * Math.PI * 2;
    const size = spread * (0.22 + 0.06 * ((i * 3) % 4));
    // Round the shoulder rather than round the crest: a lobe standing proud
    // of the flat top would be foliage the bird has to walk through.
    matrix.makeScale(size, size * 0.7, size);
    matrix.setPosition(
      landmark.x + Math.cos(angle) * (spread - size * 0.5),
      shoulder,
      landmark.z + Math.sin(angle) * (spread - size * 0.5),
    );
    lobes.setMatrixAt(i, matrix);
  }
  lobes.instanceMatrix.needsUpdate = true;
  group.add(lobes);

  const nest = nestOn(landmark);
  if (nest) {
    // A ring of stems with a hollow in it, not a disc. It was a disc, and the
    // egg was inside the solid: the one thing the level is about, buried in
    // the thing it was supposed to be lying in.
    const nestMaterial = new THREE.MeshLambertMaterial({
      color: NEST_COLOR,
      flatShading: true,
    });
    // Shallow, because a pigeon's nest is a flimsy platform of stems rather
    // than a bowl -- and because a rim deep enough to hold the egg is a rim
    // that hides it. The egg's top sits a little proud of the stems, which is
    // what it does in life.
    const rim = new THREE.TorusGeometry(nest.radius * 0.84, nest.radius * 0.16, 5, 11);
    rim.rotateX(Math.PI / 2);
    rim.translate(0, nest.radius * 0.12, 0);
    const floor = new THREE.CylinderGeometry(nest.radius * 0.85, nest.radius * 0.6, 0.03, 11);
    floor.translate(0, 0.015, 0);
    disposables.push(rim, floor, nestMaterial);

    const sticks = new THREE.Mesh(rim, nestMaterial);
    sticks.position.set(nest.x, nest.base, nest.z);
    sticks.castShadow = true;
    group.add(sticks);
    const lining = new THREE.Mesh(floor, nestMaterial);
    lining.position.set(nest.x, nest.base, nest.z);
    group.add(lining);

    // One egg, lying on its side in the hollow the way an egg lies. Its
    // middle is half its own width above the lining, so it sits *in* the
    // nest -- below the rim, above the floor, and visible over the rim from
    // anywhere a bird could be standing.
    const shell = new THREE.SphereGeometry(nest.egg / 2, 9, 6);
    shell.scale(1, 0.74, 0.74);
    const eggMaterial = new THREE.MeshLambertMaterial({ color: EGG_COLOR });
    disposables.push(shell, eggMaterial);
    const egg = new THREE.Mesh(shell, eggMaterial);
    egg.position.set(nest.x, nest.base + 0.03 + (nest.egg * 0.74) / 2, nest.z);
    egg.rotation.y = 0.6;
    egg.castShadow = true;
    group.add(egg);
  }

  return createMarker(
    landmark.name,
    [leaves, crownTop],
    new THREE.Vector3(landmark.x, landmark.height, landmark.z),
    disposables,
    overlay,
  );
}

const AREA_ORDER = 1;
const PATCH_ORDER = 2;
const ROAD_ORDER = 3;
const RAIL_ORDER = 4;
/** Over all of them: a finishing line is painted on the city, not in it. */
const GATE_ORDER = 5;
/** How deep the band is along the flight, in metres. */
const GATE_THICKNESS = 8;
/** Road-marking yellow, which is what it is. */
const GATE_COLOR = 0xe8c53d;

/**
 * Mark a material as a ground decal: drawn in its order, over whatever was
 * drawn before it, writing no depth of its own.
 *
 * It used to pull the decal towards the camera with a polygon offset as well.
 * That did nothing, and had done nothing for as long as the offset had been
 * there: the renderer runs a **logarithmic depth buffer**, so every fragment
 * writes `gl_FragDepth` itself, and a depth the shader writes replaces the
 * one the rasteriser offset. Cranking the offset a thousandfold changes not a
 * pixel, which is how this was finally established rather than assumed.
 *
 * So the ordering is the whole mechanism, and it only works if *nothing* flat
 * writes depth -- including the ground the rest of them lie on. Which layer
 * goes over which is said once, by the mesh's own `renderOrder`.
 */
function asDecal(material: THREE.Material): THREE.Material {
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
      target.push(positions.getX(i), 0, -positions.getY(i));
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
export function buildVehicle(vehicle: Vehicle): {
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
  const GLASS_TRAM = 0x22303a;
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
  } else if (vehicle.kind === 'carriage') {
    // A passenger coach: closed sides, a band of glass, and a roof.
    const LIVERY = 0x486a86;
    const TRIM = 0xd9c37a;
    const GLASS = 0x1e2b34;
    const half = vehicle.length / 2;
    const side = vehicle.width / 2;

    // Bogies and buffer beams, as the engine has them.
    for (const end of [bogie, -bogie]) {
      part(IRON, end, 0, 0.42, 3.2, vehicle.width * 0.74, 0.42);
      for (const axle of [-0.95, 0.95]) {
        for (const at of [side * 0.72, -side * 0.72]) {
          wheel(0x1a1a1c, end + axle, at, 0.0, 0.44, 0.2);
        }
      }
    }
    for (const end of [half - 0.15, -(half - 0.15)]) {
      part(0x3a3a3c, end, 0, 0.72, 0.3, vehicle.width + 0.16, 0.5);
      for (const at of [0.85, -0.85]) part(0x55565a, end, at, 0.86, 0.34, 0.34, 0.26);
    }

    // Underframe, then the body sitting on it.
    part(IRON, 0, 0, CARRIAGE.floor - 0.34, vehicle.length, vehicle.width, 0.34);
    part(LIVERY, 0, 0, CARRIAGE.floor, vehicle.length, vehicle.width, CARRIAGE.body - CARRIAGE.floor);

    // A band of glass down each side, broken into windows so it reads as a
    // train rather than as a bus. Set slightly proud of the body so the two
    // do not share the same plane and flicker against each other.
    const glass = vehicle.width / 2 + 0.02;
    const bays = 7;
    const pitch = (vehicle.length - 3.4) / bays;
    for (let i = 0; i < bays; i += 1) {
      const along = -(vehicle.length - 3.4) / 2 + pitch * (i + 0.5);
      for (const at of [glass, -glass]) {
        part(GLASS, along, at, CARRIAGE.windowSill, pitch * 0.62, 0.06, CARRIAGE.windowHeight);
      }
    }

    // Doors at the ends of each side, and a line of trim under the windows.
    for (const end of [half - 1.1, -(half - 1.1)]) {
      for (const at of [glass, -glass]) {
        part(0x3c586e, end, at, CARRIAGE.floor, 1.1, 0.05, CARRIAGE.body - CARRIAGE.floor - 0.2);
      }
    }
    for (const at of [glass, -glass]) {
      part(TRIM, 0, at, CARRIAGE.windowSill - 0.22, vehicle.length - 0.6, 0.05, 0.12);
    }

    // A roof a little narrower than the body, so it reads as curved.
    part(0x8e9296, 0, 0, CARRIAGE.body, vehicle.length, vehicle.width * 0.88, CARRIAGE.roof - CARRIAGE.body);
  } else if (vehicle.kind === 'tram') {
    // Budapest yellow, which is the whole point of putting a tram in
    // Budapest: at three metres tall in a street of red roofs it is the one
    // thing on the map you can find by colour alone.
    const LIVERY = 0xe8b62a;
    const half = vehicle.length / 2;
    const side = vehicle.width / 2;

    // Two bogies under a low floor, and no buffers -- a tram has none, and a
    // section that ends in a concertina has nothing to buff against.
    for (const end of [bogie, -bogie]) {
      part(IRON, end, 0, 0.1, 2.2, vehicle.width * 0.7, 0.25);
      for (const at of [side * 0.78, -side * 0.78]) {
        wheel(0x1a1a1c, end, at, 0.0, 0.34, 0.16);
      }
    }

    // Underframe and body. Low: the floor is 35 cm up rather than 110.
    part(IRON, 0, 0, TRAM.floor - 0.16, vehicle.length * 0.96, vehicle.width * 0.92, 0.16);
    part(LIVERY, 0, 0, TRAM.floor, vehicle.length, vehicle.width, TRAM.body - TRAM.floor);

    // A deep band of glass most of the way down each side. A tram is mostly
    // window, which is what tells it apart from a railway coach at distance.
    const glass = vehicle.width / 2 + 0.02;
    const bays = 4;
    const pitch = (vehicle.length - 2.2) / bays;
    for (let i = 0; i < bays; i += 1) {
      const along = -(vehicle.length - 2.2) / 2 + pitch * (i + 0.5);
      for (const at of [glass, -glass]) {
        part(GLASS_TRAM, along, at, TRAM.windowSill, pitch * 0.78, 0.06, TRAM.windowHeight);
      }
    }
    // A door bay at each end of each side, floor to header.
    for (const end of [half - 1.5, -(half - 1.5)]) {
      for (const at of [glass, -glass]) {
        part(0x2f3338, end, at, TRAM.floor + 0.05, 1.25, 0.05, TRAM.body - TRAM.floor - 0.35);
      }
    }
    // The concertina: a dark band across each end, so a four-car set reads as
    // one articulated vehicle rather than four short ones in a row.
    //
    // Standing two centimetres proud of the end and a centimetre under the
    // roofline, for the same reason the glass stands proud of the side: it
    // used to end exactly where the body ends, which is two faces at one
    // depth arguing over every pixel of the front of the tram. Yellow, black,
    // yellow, black, all the way down a moving rake. Nothing is coplanar with
    // anything here now, and the two centimetres go into the twenty-five of
    // articulation gap, where there is nothing to foul.
    for (const end of [half - 0.11, -(half - 0.11)]) {
      part(
        0x2a2c2f,
        end,
        0,
        TRAM.floor,
        0.26,
        vehicle.width * 0.94,
        TRAM.body - TRAM.floor - 0.01,
      );
    }

    // A shallow roof, and the pantograph that says it is electric.
    part(0x9aa0a4, 0, 0, TRAM.body, vehicle.length, vehicle.width * 0.9, TRAM.roof - TRAM.body);
    part(0x3c3f43, 0, 0, TRAM.roof, 2.6, vehicle.width * 0.5, 0.08);
    part(0x53565b, 0.5, 0, TRAM.roof + 0.08, 0.1, 0.1, TRAM.pantographHeight);
    part(0x53565b, -0.5, 0, TRAM.roof + 0.08, 0.1, 0.1, TRAM.pantographHeight * 0.6);
    part(0x6a6e73, 0, 0, TRAM.roof + 0.08 + TRAM.pantographHeight, 1.6, vehicle.width * 0.42, 0.07);
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
        positions.push(px!, 0, pz!);
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
        //
        // Faded into their own average as the pattern gets too fine to draw.
        // A stripe every 65 cm is a stripe every fraction of a pixel at any
        // distance, and a pattern finer than the pixels sampling it does not
        // come out fine -- it comes out as moire, crawling as the camera
        // moves. The mean is what the stripes average to over one period, so
        // what is lost at distance is the pattern and not the tone.
        float period = fwidth(along) / ${SLEEPER_PITCH.toFixed(3)};
        float detail = 1.0 - smoothstep(0.2, 0.5, period);
        float mean = 0.40;
        float stripes = 1.0 - smoothstep(0.34, 0.46, fract(along / ${SLEEPER_PITCH.toFixed(3)}));
        float sleeper = mix(mean, stripes, detail)
                      * (1.0 - smoothstep(1.2, 1.35 + soft, across));
        colour = mix(colour, vec3(0.24, 0.19, 0.15), sleeper * 0.8 * (1.0 - tram));

        // And the pair of rails, which a tramway has and the rest of it does not.
        float rail = 1.0 - smoothstep(0.035, 0.055 + soft, abs(across - ${(GAUGE / 2).toFixed(4)}));
        colour = mix(colour, vec3(0.62, 0.63, 0.66), rail);

        diffuseColor.rgb = colour;
        // Beyond the ballast a heavy line is just ground; a tramway is road,
        // and a tramway is *only* its rails. The sleepers used to reach the
        // alpha here without reaching the colour above, which painted a
        // tramway as a ladder of white rungs in the material's own base
        // colour -- the brightest thing in the district, and every one of
        // them too small to draw.
        diffuseColor.a *= max(rail, mix(max(sleeper, shoulder), 0.0, tram));
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
          positions.push(quad[corner! * 2]!, 0, quad[corner! * 2 + 1]!);
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
 * A plume used to be several hundred faint bubbles on top of each other, at
 * a fifth of solid each. It is twenty-two now, overlapping two or three deep,
 * so each has to be most of the way to solid on its own -- and still short of
 * it, because smoke you can see into is the difference between a plume and a
 * silhouette.
 */
const PUFF_ALPHA = 0.7;

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
