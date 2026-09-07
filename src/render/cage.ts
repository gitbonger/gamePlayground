/**
 * The trapper's cage, on the roof of the loft with her inside it.
 *
 * It is the one prop in the game that is a piece of the story rather than a
 * piece of the city, and everything about its shape follows from that: it has
 * to read as a cage from a long way off, it has to be see-through enough that
 * what is inside it is the point, and it must not be possible to mistake it
 * for somewhere to land.
 *
 * ## Why bars rather than a box with a texture on it
 *
 * Because the whole of the beat is seeing her through them. A pigeon arriving
 * at the roof at the end of the eighth level is meant to find his mate and be
 * unable to reach her, and a solid crate would hide the first half of that.
 * So: thin uprights, close enough together that a bird cannot pass between
 * them, drawn as one instanced mesh because fifty-odd identical bars is
 * exactly what instancing is for.
 */

import * as THREE from 'three';

import { turnedBox, type Box } from '../sim/collision';

/**
 * How big it is, in metres.
 *
 * About four times a pigeon, which is the size that reads as "big enough to
 * hold one and small enough for a person to have carried it up here". A
 * pigeon is a third of a metre long and 0.44 across the body, so 1.4 m square
 * is four of them and a bit.
 */
export const CAGE = {
  width: 1.4,
  depth: 1.4,
  // Half what it was. A metre and a half is a cage a person could walk into;
  // this is a cage a person carried up a stairwell with a pigeon in it, which
  // is the story it has to tell.
  height: 0.75,
  /**
   * How far apart the uprights are, centre to centre.
   *
   * Ten centimetres, against a pigeon 44 cm across the body. There is no
   * question of squeezing out and no arithmetic to get wrong: the gap is a
   * fifth of the bird.
   */
  spacing: 0.1,
  /** And how thick they are. Thin, because she has to be visible past them. */
  bar: 0.022,
};

/**
 * The cage as one solid, standing on a surface at `on`.
 *
 * A single box round the whole thing rather than a box per bar. The bars are
 * two centimetres thick and the gaps ten, which is a shape no sweep against a
 * 22 cm bird can give a sensible answer for -- it would pass between them at
 * some angles and not others, and a wall you can sometimes fly through is
 * worse than either.
 *
 * Soft, and that is the part that matters. Being unable to get through it is
 * the whole point of the one on the loft roof; killing the bird that takes
 * off from beside it is not. Measured before it was: every launch from every
 * distance beside the cage ended in a dead pigeon within a tenth of a second,
 * because the rule for flying into something is a closing speed written for
 * buildings and a launch leaves the roof at eleven metres a second.
 */
export function cageSolid(at: { x: number; z: number; on: number; yaw: number }): Box {
  return {
    ...turnedBox(at.x, at.z, CAGE.width, CAGE.height, CAGE.depth, at.yaw),
    // Lifted onto whatever it is standing on: `turnedBox` builds from the
    // ground up, and this one is on a roof.
    minY: at.on,
    maxY: at.on + CAGE.height,
    soft: true,
  };
}

export interface Cage {
  object: THREE.Object3D;
  /** Stand it here, turned this way. Hidden when given nothing. */
  show(at: { x: number; y: number; z: number; yaw: number } | null): void;
  /**
   * Take it apart: every bar thrown outwards and dropped.
   *
   * Called once, and then `update` carries it on. It is not a physical
   * simulation and does not pretend to be -- each bar gets a push away from
   * the middle, a turn, and gravity, which is what a thing coming apart looks
   * like from ten metres away and is about a hundred and fifty lines less
   * than the honest version.
   */
  burst(): void;
  /** Advance whatever is moving. Nothing at all until it has burst. */
  update(dt: number): void;
  dispose(): void;
}

export function createCage(): Cage {
  // One unit box, instanced: every bar is the same box with a different
  // scale and turn, so the whole cage is one draw call.
  const stock = new THREE.BoxGeometry(1, 1, 1);
  const iron = new THREE.MeshLambertMaterial({ color: 0x3a3d42 });

  const bars: { x: number; y: number; z: number; w: number; h: number; d: number }[] = [];

  const halfX = CAGE.width / 2;
  const halfZ = CAGE.depth / 2;

  /** How many gaps fit along a side, and the pitch that divides it evenly. */
  const along = (span: number) => {
    const many = Math.max(2, Math.round(span / CAGE.spacing));
    return { many, pitch: span / many };
  };

  // The uprights, down all four sides. The corners belong to both sides, so
  // each run stops one short of its end and the corner posts are added once.
  const across = along(CAGE.width);
  const deep = along(CAGE.depth);
  for (let i = 1; i < across.many; i += 1) {
    const x = -halfX + i * across.pitch;
    for (const z of [-halfZ, halfZ]) {
      bars.push({ x, y: CAGE.height / 2, z, w: CAGE.bar, h: CAGE.height, d: CAGE.bar });
    }
  }
  for (let i = 1; i < deep.many; i += 1) {
    const z = -halfZ + i * deep.pitch;
    for (const x of [-halfX, halfX]) {
      bars.push({ x, y: CAGE.height / 2, z, w: CAGE.bar, h: CAGE.height, d: CAGE.bar });
    }
  }
  // The four corner posts, a little heavier: a cage is a frame with bars in
  // it rather than a fence bent into a square.
  for (const x of [-halfX, halfX]) {
    for (const z of [-halfZ, halfZ]) {
      bars.push({
        x,
        y: CAGE.height / 2,
        z,
        w: CAGE.bar * 1.9,
        h: CAGE.height,
        d: CAGE.bar * 1.9,
      });
    }
  }

  // Rails round the top and the bottom, and one across the middle -- which is
  // what stops the uprights reading as a picket fence in a ring.
  for (const y of [CAGE.bar, CAGE.height / 2, CAGE.height - CAGE.bar]) {
    for (const z of [-halfZ, halfZ]) {
      bars.push({ x: 0, y, z, w: CAGE.width + CAGE.bar, h: CAGE.bar, d: CAGE.bar });
    }
    for (const x of [-halfX, halfX]) {
      bars.push({ x, y, z: 0, w: CAGE.bar, h: CAGE.bar, d: CAGE.depth + CAGE.bar });
    }
  }

  // And a lid, so it is closed: bars one way only, which is enough to read as
  // a top and cheaper than a grid.
  for (let i = 1; i < across.many; i += 1) {
    bars.push({
      x: -halfX + i * across.pitch,
      y: CAGE.height - CAGE.bar,
      z: 0,
      w: CAGE.bar,
      h: CAGE.bar,
      d: CAGE.depth,
    });
  }

  /**
   * How many of the pieces at the end of the list are him rather than it.
   *
   * The trapper stands beside the cage as an ordinary person, drawn by the
   * same instanced crowd as everybody else on the map -- which is what makes
   * him look like a person and not like a prop. He cannot be taken apart by
   * that mesh, though: it is built once and never touched.
   *
   * So he is taken apart by this one. These pieces sit where he stands, at
   * nothing at all until the cage goes, and on that frame he is hidden and
   * they appear and fly. The swap happens inside a cloud of tumbling bars,
   * which is the only reason it can be got away with -- and it is worth being
   * plain that getting away with it is what this is.
   */
  const HIS_SIDE = { along: 0, across: -CAGE.depth / 2 - 1.0 };
  const debrisFrom = bars.length;
  for (let i = 0; i < 9; i += 1) {
    bars.push({
      x: HIS_SIDE.along + (Math.random() - 0.5) * 0.35,
      y: 0.15 + i * 0.2,
      z: HIS_SIDE.across + (Math.random() - 0.5) * 0.35,
      w: 0.12 + Math.random() * 0.16,
      h: 0.12 + Math.random() * 0.16,
      d: 0.12 + Math.random() * 0.16,
    });
  }

  const mesh = new THREE.InstancedMesh(stock, iron, bars.length);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'cage';
  // The cage is a metre and a half of thin sticks and the thing it is made of
  // is one mesh: culled on its own bounds it is fine, but those bounds are
  // worked out once from the instance matrices, and the instances are placed
  // in the cage's own frame and the whole object is moved. Same trap the
  // seeds fell into.
  mesh.frustumCulled = false;

  const place = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const matrix = new THREE.Matrix4();

  const object = new THREE.Group();
  object.add(mesh);
  object.visible = false;

  /**
   * Where each bar belongs, kept apart from where it currently is.
   *
   * `update` moves the bars, so the shape of the cage has to be written down
   * somewhere that does not move -- otherwise putting it back together
   * restores it to wherever the pieces had got to, which is not a cage.
   */
  const home = bars.map((bar) => ({ x: bar.x, y: bar.y, z: bar.z }));

  /** How each bar is moving, once it has stopped being a cage. */
  const thrown = bars.map(() => ({
    x: 0,
    y: 0,
    z: 0,
    spin: 0,
    turn: new THREE.Vector3(0, 1, 0),
  }));
  let flying = 0;

  /** Put every bar back where the cage has it. */
  const rebuild = () => {
    bars.forEach((bar, i) => {
      bar.x = home[i]!.x;
      bar.y = home[i]!.y;
      bar.z = home[i]!.z;
      place.set(bar.x, bar.y, bar.z);
      // His pieces are nothing at all until he comes apart: there is a
      // person standing there, drawn properly, and two of him would be worse
      // than none.
      if (i >= debrisFrom) scale.setScalar(0);
      else scale.set(bar.w, bar.h, bar.d);
      matrix.compose(place, turn.identity(), scale);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  rebuild();

  return {
    object,
    show(at) {
      object.visible = at !== null;
      // Whole again. A cage that was broken on one level and is shown on
      // another is a cage that was never broken -- the story is the same
      // story every time it is played.
      if (flying > 0) {
        flying = 0;
        rebuild();
      }
      if (!at) return;
      object.visible = true;
      object.position.set(at.x, at.y, at.z);
      object.rotation.y = at.yaw;
    },
    burst() {
      if (flying > 0) return;
      flying = 1e-6;
      bars.forEach((_bar, i) => {
        // Outwards from the middle of the cage, which is what makes it read
        // as pushed apart from inside rather than dropped.
        const from = home[i]!;
        const going = thrown[i]!;
        // His pieces fly off him rather than off the middle of the cage.
        const mid = i >= debrisFrom ? HIS_SIDE : { along: 0, across: 0 };
        const outX = from.x - mid.along;
        const outZ = from.z - mid.across;
        const out = Math.hypot(outX, outZ) || 1;
        going.x = (outX / out) * (2.5 + Math.random() * 2.5);
        going.z = (outZ / out) * (2.5 + Math.random() * 2.5);
        going.y = 1.5 + Math.random() * 2.5;
        going.spin = (Math.random() - 0.5) * 14;
        going.turn
          .set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
          .normalize();
      });
    },
    update(dt) {
      if (flying <= 0) return;
      flying += dt;
      bars.forEach((bar, i) => {
        const going = thrown[i]!;
        going.y -= 9.81 * dt;
        bar.x += going.x * dt;
        bar.y += going.y * dt;
        bar.z += going.z * dt;

        place.set(bar.x, bar.y, bar.z);
        scale.set(bar.w, bar.h, bar.d);
        turn.setFromAxisAngle(going.turn, going.spin * flying);
        matrix.compose(place, turn, scale);
        mesh.setMatrixAt(i, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      // Gone once the pieces are well below the roof they were standing on.
      // There is nothing left to look at by then and nothing to be gained by
      // following them to the pavement.
      if (flying > 4) object.visible = false;
    },
    dispose() {
      stock.dispose();
      iron.dispose();
    },
  };
}
