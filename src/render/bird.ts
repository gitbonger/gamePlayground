/**
 * Placeholder pigeon.
 *
 * Deliberately built from primitives: the point of this milestone is the flight
 * model, and a box you can read the orientation of beats a nice model you have
 * to wait for. Swap this whole module for a glTF load later -- everything else
 * only depends on `object` and `update`.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BirdState } from '../sim/flight';

/**
 * The colour model, which is a legibility model rather than a taxonomy.
 *
 * A city of feral pigeons is a city of birds you cannot tell apart, and that
 * is exactly right for a flock and exactly wrong for a cast. So there are two
 * sets. The hero is blue and his mate is pink -- neither colour is in the
 * crowd, so either of them is findable across a rooftop at a glance. The
 * crowd comes in four: grey, black, white and ginger, which are the four
 * feral pigeons anybody can actually name.
 *
 * Eight subtly different greys was the old set. It was more truthful and it
 * read as one grey.
 */
const BODY = 0x7f92c0;
const WING = 0x93a5cf;
/** The two dark bars across a pigeon's wing, which give it shape. */
const WING_BAR = 0x414c75;
const HEAD = 0x8b9dc9;
/** Iridescent neck, somewhere between green and violet depending on the light. */
const NECK = 0x3f9e7c;
const RUMP = 0xeef3f8;
/** The dark band at the end of a pigeon's tail. Real, and it reads from above. */
const TAIL = 0x3a4260;
const BEAK = 0xe8a54b;
const LEG = 0xd4735a;

/**
 * How much of its own colour the bird gives off.
 *
 * Not a light source, a floor: without it the bird falls to near-black in a
 * building's shadow, which is exactly where it is hardest to keep track of and
 * where losing it costs the most.
 */
const GLOW = 0.42;

/**
 * A pigeon's parts, so a whole bird can be recoloured in one go.
 */
export interface PigeonMorph {
  body: number;
  wing: number;
  bar: number;
  head: number;
  neck: number;
  rump: number;
  /** The tail feathers, which are the part seen from behind and above. */
  tail: number;
  beak: number;
  leg: number;
}

/**
 * The hero: a blue bar, which is the wild type and here is properly blue.
 *
 * The one bird the player is always looking at, and the one they are never
 * looking *for* -- so it is the colour nothing else in the world is, and the
 * chase camera has something to hold on to against a grey city.
 */
const DEFAULT_MORPH: PigeonMorph = {
  body: BODY,
  wing: WING,
  bar: WING_BAR,
  head: HEAD,
  neck: NECK,
  rump: RUMP,
  tail: TAIL,
  beak: BEAK,
  leg: LEG,
};

/** The hero's colours, by the name the rest of the game knows them under. */
export const HERO_MORPH = DEFAULT_MORPH;

/**
 * The crowd: four birds you can name, told apart by body first and tail
 * second.
 *
 * The tail is the second signal on purpose. From behind and above -- which is
 * where a flying pigeon is seen from -- the tail is most of what there is, so
 * a white bird with a black tail and a white bird with a ginger one are two
 * birds rather than two of the same bird.
 */
export const PIGEON_MORPHS: readonly PigeonMorph[] = [
  // Grey: the ordinary street pigeon.
  {
    ...DEFAULT_MORPH,
    body: 0x9aa2ad,
    wing: 0xacb4be,
    bar: 0x5e6673,
    head: 0xa4acb7,
    rump: 0xdfe4ea,
    tail: 0x4b525d,
  },
  // Black: the spread, with the sheen that goes with it.
  {
    ...DEFAULT_MORPH,
    body: 0x3f434b,
    wing: 0x4a4f58,
    bar: 0x24272d,
    head: 0x44484f,
    neck: 0x6d4f96,
    rump: 0x585d66,
    tail: 0x24272d,
  },
  // White: the dovecote sort, with a pale bill to match.
  {
    ...DEFAULT_MORPH,
    body: 0xf2f5f8,
    wing: 0xe6ebf1,
    bar: 0xc9d2da,
    head: 0xf6f8fa,
    neck: 0xdbe4ec,
    rump: 0xffffff,
    tail: 0xb9c4ce,
    beak: 0xe9b7a0,
  },
  // Ginger: the red, which is the one that stands out in a grey street.
  {
    ...DEFAULT_MORPH,
    body: 0xb87a45,
    wing: 0xcb9560,
    bar: 0x81512b,
    head: 0xc08350,
    neck: 0x9c6a4e,
    rump: 0xe8d2b4,
    tail: 0x7a4a26,
  },
];

/**
 * The pink pigeon, which is a real bird before it is a signal.
 *
 * Nesoenas mayeri, of Mauritius: rose over the breast and head, with the dark
 * rufous tail that tells it apart at any distance. The real one is subtler
 * than this. This one has to be picked out across a terrace at a glance, by a
 * player who has been told to go and find her and has never seen her before,
 * so she is pushed well past life -- and she is kept out of the crowd's list
 * on purpose. A city with thirty pink pigeons in it has no pink pigeon in it.
 */
export const PINK_MORPH: PigeonMorph = {
  body: 0xef9ab8,
  wing: 0xdb7599,
  bar: 0xa8446e,
  head: 0xf9bcd1,
  neck: 0xc75d8c,
  rump: 0xffd9e6,
  tail: 0x8f3f2a,
  beak: 0xd88ea6,
  leg: 0xc4626b,
};

/**
 * Every morph a named bird may wear: the crowd's four, then the ones that are
 * somebody. Indexed by the levels, so the order of it is written down.
 */
export const CHARACTER_MORPHS: readonly PigeonMorph[] = [...PIGEON_MORPHS, PINK_MORPH];

/**
 * How far the body sits above the feet when standing, in metres.
 *
 * The simulation tracks a point at the bird's centre and stops it at ground
 * level, which would bury half the model. This is the offset from that point
 * to where the body actually belongs -- a rendering concern, not a physical
 * one, so it lives here rather than in the flight model.
 */
const STANDING_HEIGHT = 0.14;

/**
 * How far the feet hang below the point the simulation tracks, in metres.
 *
 * The feet and not the whole model: spread wings in the braking pose droop
 * nearly 30 cm, and a wingtip touching the ground is a bird braking, while a
 * foot under the ground is a bug. Measured off the built model rather than
 * asserted -- there is a test that fails if a leg grows past it.
 */
export const FOOT_DROP = 0.07;

/**
 * How far forward the head is thrust over a stride, in metres, and how much of
 * the stride the thrust itself takes.
 *
 * A pigeon's head really does hold still in the air while the body walks under
 * it, which relative to the body is a backward slide at walking pace over most
 * of the cycle and a quick snap forward at the end of it. Three and a half
 * centimetres is about the excursion on a bird this size.
 */
const HEAD_REACH = 0.035;
const HEAD_THRUST = 0.3;

/** How far each leg swings fore and aft, and how far the free foot lifts. */
const LEG_SWING = 0.026;
const LEG_LIFT = 0.012;

/** What the wings are doing, which is most of what the bird reads as. */
export type WingPose = 'tucked' | 'gliding' | 'braking' | 'perched';

/** The red a marked bird is washed with when it is the one to go and see. */
const MARKED = new THREE.Color(0xd0281c);

/** Scratch constants for laying out the tail: the axis it fans about, and no scale. */
const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

export interface BirdRig {
  object: THREE.Object3D;
  /**
   * Wash the whole bird toward marker red, 0 to 1.
   *
   * The same signal the target buildings use, on a bird instead: once you are
   * on foot the thing you are looking for is a pigeon, and a pigeon is far
   * too small to find by looking. Applied to the emissive rather than the
   * colour, because these are many materials of many colours and multiplying
   * that lot by red gives a muddy brown rather than a red pigeon.
   */
  glow(amount: number): void;
  update(state: BirdState, pose: WingPose, dt: number): void;
  dispose(): void;
}

const mix = (from: number, to: number, t: number): number => from + (to - from) * t;

/**
 * A shape of the bird, its colour, and how much of that colour it gives off.
 *
 * The bird used to be thirty-three meshes of twenty-odd materials, one per
 * lump. Every one of those was a draw call, and with a flock, five residents
 * and the hero on screen that was most of the frame's draw calls -- for an
 * object a couple of hundred pixels across. So the lumps are the same lumps,
 * modelled to the same numbers, but they are fused into one geometry per
 * joint and their colours ride along in the vertices.
 */
interface Piece {
  geometry: THREE.BufferGeometry;
  color: number;
  /** How much of its own colour it gives off. */
  glow: number;
}

/**
 * Put a shape where it belongs in the frame of the joint that carries it.
 *
 * The position goes into the vertices rather than onto a mesh, which is the
 * whole trick: a lump that does not move relative to its joint does not need
 * a transform of its own, and a lump without a transform of its own can be
 * fused with its neighbours.
 */
function at(
  geometry: THREE.BufferGeometry,
  color: number,
  x: number,
  y: number,
  z: number,
  glow = GLOW,
): Piece {
  geometry.translate(x, y, z);
  return { geometry, color, glow };
}

/**
 * Fuse pieces into one geometry, carrying their colours in the vertices.
 *
 * Two attributes rather than one: the colour, which the standard vertex-colour
 * path multiplies into the diffuse, and the glow, which the patched shader
 * multiplies into the emissive. The glow is what a per-lump material used to
 * carry -- a pupil gives off almost nothing, an eye gives off half its own
 * orange -- and losing it would flatten the face.
 */
function fuse(pieces: readonly Piece[]): THREE.BufferGeometry {
  const tint = new THREE.Color();
  for (const piece of pieces) {
    tint.set(piece.color);
    const count = piece.geometry.getAttribute('position').count;
    const colours = new Float32Array(count * 3);
    const glows = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      colours[i * 3] = tint.r;
      colours[i * 3 + 1] = tint.g;
      colours[i * 3 + 2] = tint.b;
      glows[i] = piece.glow;
    }
    piece.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    piece.geometry.setAttribute('glow', new THREE.Float32BufferAttribute(glows, 1));
  }

  const one = mergeGeometries(pieces.map((piece) => piece.geometry));
  // The sources are copied into the merged buffer, so they are finished with
  // the moment it exists.
  for (const piece of pieces) piece.geometry.dispose();
  if (!one) throw new Error('bird parts do not share a set of attributes');
  return one;
}

/**
 * The one material a whole bird is made of.
 *
 * Lambert with vertex colours, plus two lines of patched shader: the emissive
 * comes from the vertex rather than from a uniform, so one material can hold
 * a bird whose parts each light themselves differently, and the marker wash
 * is a single uniform rather than a colour written into twenty materials
 * every frame.
 */
function birdSkin(): { material: THREE.MeshLambertMaterial; wash(amount: number): void } {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const washed = { value: 0 };
  const marked = { value: MARKED.clone() };

  material.onBeforeCompile = (shader) => {
    shader.uniforms['washed'] = washed;
    shader.uniforms['marked'] = marked;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'attribute float glow;\nvarying float vGlow;\nvoid main() {')
      .replace('#include <color_vertex>', '#include <color_vertex>\n\tvGlow = glow;');

    // Set after the vertex colour has been folded into the diffuse rather
    // than from the varying itself: `diffuseColor.rgb` is a vec3 whatever
    // three decides the colour attribute is, and the material carries no
    // colour of its own for it to be multiplied by.
    const colour = '#include <color_fragment>';
    // Stated rather than hoped for: a `replace` that matches nothing is a
    // silent no-op, and the failure it makes -- a bird with no emissive at
    // all -- looks like a lighting decision rather than like a bug.
    if (!shader.fragmentShader.includes(colour)) {
      throw new Error('the lambert shader no longer folds in the vertex colour as expected');
    }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        'uniform float washed;\nuniform vec3 marked;\nvarying float vGlow;\nvoid main() {',
      )
      .replace(
        colour,
        `${colour}\n\ttotalEmissiveRadiance = mix( diffuseColor.rgb * vGlow, marked, washed );`,
      );
  };
  // A patched program is not the stock program, and the cache is keyed by
  // what the renderer knows about rather than by what we did to the source.
  material.customProgramCacheKey = () => 'pigeon';

  return { material, wash: (amount: number) => (washed.value = amount) };
}

export function createBirdRig(morph: PigeonMorph = DEFAULT_MORPH): BirdRig {
  const disposables: { dispose(): void }[] = [];
  const skin = birdSkin();
  disposables.push(skin.material);

  let washed = -1;
  function glow(amount: number) {
    // One uniform, and only when it has changed -- which is almost never.
    if (amount === washed) return;
    washed = amount;
    skin.wash(amount);
  }

  /** A fused joint: one mesh, one material, one draw call. */
  const limb = (pieces: readonly Piece[]) => {
    const geometry = fuse(pieces);
    disposables.push(geometry);
    const mesh = new THREE.Mesh(geometry, skin.material);
    mesh.castShadow = true;
    return mesh;
  };
  const box = (width: number, height: number, depth: number) =>
    new THREE.BoxGeometry(width, height, depth);

  const object = new THREE.Group();

  // --- Body ---------------------------------------------------------------
  // Three tapering blocks rather than one: a pigeon is deepest at the breast
  // and narrows to the tail, and that taper is most of its silhouette. The
  // eyes are on the body rather than on the head, which is a liberty the walk
  // cycle takes and not an oversight: the head slides forward under them.
  object.add(
    limb([
      at(box(0.115, 0.125, 0.14), morph.body, 0, 0, -0.06),
      at(box(0.1, 0.105, 0.13), morph.body, 0, -0.004, 0.06),
      at(box(0.07, 0.075, 0.07), morph.body, 0, -0.005, 0.15),
      // Fuller breast, low and forward, where the flight muscle sits.
      at(box(0.105, 0.085, 0.12), morph.body, 0, -0.035, -0.085),
      // Iridescent throat, between the head and the shoulders. Stays on the
      // body: it is the neck the head slides on, so it does not slide with it.
      at(box(0.09, 0.082, 0.075), morph.neck, 0, 0.03, -0.125, 0.3),
      // Pale rump over the base of the tail: the part the chase camera sees
      // most.
      at(box(0.098, 0.036, 0.1), morph.rump, 0, 0.05, 0.115, 0.5),
      // Orange eyes, which is the detail that makes it look back at you.
      at(box(0.016, 0.016, 0.014), 0xd9772e, -0.036, 0.062, -0.192, 0.55),
      at(box(0.016, 0.016, 0.014), 0xd9772e, 0.036, 0.062, -0.192, 0.55),
      at(box(0.009, 0.009, 0.008), 0x1a1a1e, -0.043, 0.062, -0.194, 0.05),
      at(box(0.009, 0.009, 0.008), 0x1a1a1e, 0.043, 0.062, -0.194, 0.05),
    ]),
  );

  // --- Head ---------------------------------------------------------------
  // A joint of its own, because a walking pigeon's head does not travel with
  // its body: it is thrust forward and then held still in the air while the
  // body catches up. That is the whole of what makes a pigeon walk read as a
  // pigeon walking, and it cannot be done to lumps fused to the body.
  const head = new THREE.Group();
  // Named so a test can find it without going looking for the beak.
  head.name = 'head';
  object.add(head);

  const beak = new THREE.ConeGeometry(0.016, 0.055, 6);
  beak.rotateX(-Math.PI / 2);
  head.add(
    limb([
      at(box(0.078, 0.076, 0.086), morph.head, 0, 0.052, -0.172),
      // Rounder crown, so the head is not a plain cube.
      at(box(0.058, 0.03, 0.066), morph.head, 0, 0.084, -0.174),
      at(beak, morph.beak, 0, 0.045, -0.238),
      // The cere: the pale wattle over a pigeon's bill.
      at(box(0.03, 0.018, 0.02), 0xf0f4f8, 0, 0.058, -0.213),
    ]),
  );

  // --- Tail ---------------------------------------------------------------
  // Five feathers on a shared pivot, so it can fan as well as tilt -- and one
  // instanced mesh rather than five, because a fan is exactly five copies of
  // one feather at five transforms, which is what instancing is for.
  const tail = new THREE.Group();
  tail.position.set(0, 0.012, 0.19);
  const featherGeometry = fuse([at(box(0.028, 0.008, 0.15), morph.tail, 0, 0, 0)]);
  disposables.push(featherGeometry);
  const FEATHERS = 5;
  const feathers = new THREE.InstancedMesh(featherGeometry, skin.material, FEATHERS);
  feathers.castShadow = true;
  tail.add(feathers);
  object.add(tail);

  // --- Wings --------------------------------------------------------------
  // Two sections with a wrist between them. The outer half trails the inner
  // through the beat, which is what a wingbeat actually looks like and what a
  // single rigid plank never will.
  interface Wing {
    shoulder: THREE.Group;
    wrist: THREE.Group;
  }

  const makeWing = (side: 1 | -1): Wing => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.048, 0.032, -0.02);
    shoulder.add(
      limb([
        at(box(0.17, 0.015, 0.175), morph.wing, side * 0.085, 0, 0.005),
        // Two dark bars across a pale wing: real, and they give the wing a
        // shape to read at a distance instead of a flat slab.
        at(box(0.15, 0.008, 0.02), morph.bar, side * 0.085, 0.01, 0.032, 0.2),
        at(box(0.15, 0.008, 0.02), morph.bar, side * 0.085, 0.01, 0.062, 0.2),
      ]),
    );

    const wrist = new THREE.Group();
    wrist.position.set(side * 0.17, 0, 0);
    wrist.add(
      limb([
        // Primaries, swept a little back from the arm.
        at(box(0.17, 0.011, 0.125), morph.wing, side * 0.086, 0, 0.022),
        at(box(0.15, 0.008, 0.02), morph.bar, side * 0.086, 0.008, 0.055, 0.2),
      ]),
    );
    shoulder.add(wrist);

    object.add(shoulder);
    return { shoulder, wrist };
  };

  const wings = { left: makeWing(-1), right: makeWing(1) };

  // --- Legs ---------------------------------------------------------------
  const legs: THREE.Group[] = [];
  for (const side of [-1, 1] as const) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.026, -0.05, 0.012);
    hip.add(
      limb([
        at(box(0.013, 0.075, 0.013), morph.leg, 0, -0.038, 0),
        at(box(0.022, 0.008, 0.042), morph.leg, 0, -0.077, -0.008),
      ]),
    );
    // Named so the test that measures FOOT_DROP can find the feet rather
    // than the whole bird: braking wings hang far lower than any leg, and
    // a wingtip brushing the ground is not the thing being guarded.
    hip.name = 'leg';
    object.add(hip);
    legs.push(hip);
  }
  // Where each hip sits when the bird is standing still, which the walk cycle
  // swings either side of.
  const hipRest = legs.map((hip) => hip.position.z);
  const hipHeight = legs.map((hip) => hip.position.y);

  // Scratch for laying the tail out, kept rather than made every frame.
  const feather = new THREE.Matrix4();
  const splay = new THREE.Vector3();
  const turn = new THREE.Quaternion();

  // Smoothed wing pose on one axis: -1 folded, 0 gliding, +1 braking.
  let pose = 0;
  // Separate axis for standing, which is about the whole body, not the wings.
  let stand = 0;

  function update(state: BirdState, wingPose: WingPose, dt: number) {
    const standing = wingPose === 'perched';
    stand += ((standing ? 1 : 0) - stand) * Math.min(1, dt * 7);

    object.position.set(
      state.position.x,
      state.position.y + STANDING_HEIGHT * stand,
      state.position.z,
    );
    object.quaternion.set(
      state.orientation.x,
      state.orientation.y,
      state.orientation.z,
      state.orientation.w,
    );

    // Flying pose first, on one axis: -1 folded, 0 gliding, +1 braking.
    const target = wingPose === 'tucked' ? -1 : wingPose === 'braking' ? 1 : 0;
    pose += (target - pose) * Math.min(1, dt * 9);

    const fold = Math.max(0, -pose);
    const brake = Math.max(0, pose);
    const spread = 1 - fold;

    const cycle = state.flapPhase * Math.PI * 2;
    const beat = Math.sin(cycle);
    // The hand trails the arm by about an eighth of a beat.
    const trail = Math.sin(cycle - 0.8);

    let flapAngle = beat * spread;
    let wristAngle = (trail - beat) * 0.55 * spread;
    let sweep = brake * 0.9 - fold * 1.3;
    let cup = brake * 0.8 - fold * 0.65 - 0.12 * spread;
    let stretch = 1 + brake * 0.25;
    let tailPitch = -0.15 * spread - brake;
    let tailFan = 1 + brake * 0.9;

    // Then blend the whole thing toward standing, which is not a wing pose at
    // all: everything folds away and comes to rest.
    flapAngle = mix(flapAngle, 0, stand);
    wristAngle = mix(wristAngle, -0.5, stand);
    sweep = mix(sweep, -1.45, stand);
    cup = mix(cup, 0.06, stand);
    stretch = mix(stretch, 0.68, stand);
    tailPitch = mix(tailPitch, 0.34, stand);
    tailFan = mix(tailFan, 0.75, stand);

    for (const [side, wing] of [
      [-1, wings.left],
      [1, wings.right],
    ] as const) {
      wing.shoulder.rotation.z = side * (flapAngle - cup);
      wing.shoulder.rotation.y = -side * sweep;
      wing.shoulder.scale.setScalar(stretch);
      wing.wrist.rotation.z = side * wristAngle;
      // Folded wings bend at the wrist as well as sweeping back.
      wing.wrist.rotation.y = -side * (fold * 0.9 + stand * 0.7);
    }

    tail.rotation.x = tailPitch;
    // The fan, as five transforms of one feather. Each turns about its own
    // middle and slides out from the next, which is what a tail opening
    // actually does -- and what scaling the whole tail sideways would not.
    for (let i = 0; i < FEATHERS; i += 1) {
      const index = i - (FEATHERS - 1) / 2;
      splay.set(index * 0.025 * tailFan, 0, 0.07);
      turn.setFromAxisAngle(UP, -index * 0.09 * tailFan);
      feather.compose(splay, turn, ONE);
      feathers.setMatrixAt(i, feather);
    }
    feathers.instanceMatrix.needsUpdate = true;

    // Legs swing down to stand and tuck back up in flight.
    for (const hip of legs) {
      hip.rotation.x = (1 - stand) * 1.5;
      hip.visible = stand > 0.02;
    }

    // --- On foot ----------------------------------------------------------
    // Driven by the stride, which the walk model advances by ground covered
    // rather than by the clock, so a bird standing still is a bird standing
    // still and one walking backwards paddles backwards.
    const cycle2 = state.stridePhase * Math.PI * 2;
    const swing = Math.sin(cycle2) * stand;
    legs.forEach((hip, index) => {
      const side = index === 0 ? 1 : -1;
      hip.position.z = hipRest[index]! + side * LEG_SWING * swing;
      // The leg swinging forward is the one off the ground.
      hip.position.y = hipHeight[index]! + Math.max(0, side * swing) * LEG_LIFT;
    });

    head.position.z = -HEAD_REACH * headReach(state.stridePhase) * stand;
  }

  /**
   * How far forward of neutral the head is, 0..1, over one stride.
   *
   * Quick thrust, then a long drift back: relative to the body, holding the
   * head still in the air *is* drifting backwards at walking pace.
   */
  function headReach(phase: number): number {
    return phase < HEAD_THRUST
      ? phase / HEAD_THRUST
      : 1 - (phase - HEAD_THRUST) / (1 - HEAD_THRUST);
  }

  return {
    object,
    update,
    glow,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
