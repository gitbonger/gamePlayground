/**
 * The one waypoint that is showing, as something you can see from a mile off.
 *
 * A column of light standing on the spot rather than a ring hanging in the
 * air, and that is the honest shape: the mark is a *place on the ground*, and
 * it counts as passed at any height. A ring would be telling the player to
 * fly through a hoop, which is a rule this does not have and would be a poor
 * one to add -- the level under it wants them beneath twenty metres and the
 * one over it wants them above the roofs.
 *
 * One object, moved. There is only ever one showing, so building and throwing
 * away a mesh at each of them would be work for nothing.
 */

import * as THREE from 'three';

export interface Waymark {
  object: THREE.Object3D;
  /**
   * Stand it at this spot, with its arrow pointed at the one after.
   *
   * `next` of null leaves the arrow off: there is nowhere after the last
   * mark, and an arrow pointing at nothing in particular is worse than none.
   */
  show(at: { x: number; z: number } | null, next?: { x: number; z: number } | null): void;
  /** Turn it, so it reads as a thing rather than a decal. */
  update(seconds: number): void;
  dispose(): void;
}

/**
 * How tall the column stands, in metres.
 *
 * Thirty. It was ninety, which from six hundred metres out is a stripe up the
 * middle of the sky rather than a thing standing on a street -- and the point
 * of a column is that it says *where*, on the ground, not that it fills the
 * view.
 */
const HEIGHT = 30;
/** And how wide, which is a good deal less than it is tall. */
const RADIUS = 2.4;
const COLOUR = 0x54e0ff;

export function createWaymark(): Waymark {
  const geometry = new THREE.CylinderGeometry(RADIUS, RADIUS, HEIGHT, 6, 1, true);
  geometry.translate(0, HEIGHT / 2, 0);
  const material = new THREE.MeshBasicMaterial({
    color: COLOUR,
    transparent: true,
    opacity: 0.28,
    // Both sides, because the player flies through it: a column lit only on
    // the outside vanishes at the moment it matters most.
    side: THREE.DoubleSide,
    // No depth writing, so what is behind it shows through rather than being
    // cut out by a thing that is meant to be a glow.
    depthWrite: false,
    fog: false,
  });

  const column = new THREE.Mesh(geometry, material);
  column.renderOrder = 4;

  // --- The arrow at its foot ------------------------------------------------
  // Lying flat, pointing at the mark after this one, so a waypoint says two
  // things at once: here, and then that way. A player who only learns the
  // next heading on arrival turns late every time.
  const arrow = new THREE.Mesh(arrowShape(), material.clone());
  arrow.renderOrder = 5;
  // A little off the ground: the roads and the painted lines are decals lying
  // on the plane, and a flat thing at exactly nought fights with them.
  arrow.position.y = 0.6;

  const object = new THREE.Group();
  object.add(column, arrow);
  object.visible = false;
  // The whole point of it is to be seen from a long way off, and the column
  // is thin: culled on its own bounds it flickers out at the edge of the
  // frame while the player is turning towards it.
  object.frustumCulled = false;

  return {
    object,
    show(at, next) {
      object.visible = at !== null;
      if (!at) return;
      object.position.set(at.x, 0, at.z);

      arrow.visible = next != null;
      if (next) {
        // Turned to lie along the way to the next one, in the convention
        // everything else on this map is turned in: facing nought is -Z.
        arrow.rotation.y = -Math.atan2(next.x - at.x, -(next.z - at.z));
      }
    },
    update(seconds) {
      // The column turns slowly, which is the cheapest thing that says "this
      // is a marker" rather than "this is part of the city". The arrow does
      // not: it is pointing somewhere, and a pointer that spins points
      // nowhere.
      column.rotation.y = seconds * 0.6;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      arrow.geometry.dispose();
      (arrow.material as THREE.Material).dispose();
    },
  };
}

/**
 * A flat arrow lying on the ground, pointing along -Z.
 *
 * A shaft and a head, because a chevron on its own reads as a tick from
 * directly above and this has to be read from directly above.
 *
 * Built as one buffer of bare positions rather than as two shapes merged.
 * Merging is only defined over geometries with the same attributes, and a
 * plane arrives with normals and texture coordinates while a hand-written
 * triangle does not -- so the merge returned nothing, and the first thing
 * that asked the nothing for its attributes brought the whole game down on
 * load. Nothing here needs a normal or a uv: the material is unlit.
 */
function arrowShape(): THREE.BufferGeometry {
  const shape = new THREE.BufferGeometry();
  // Wound anticlockwise seen from above, which is the side it is looked at
  // from -- though the material draws both, so a mistake here is invisible
  // rather than a missing arrow.
  shape.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        // The shaft, as two triangles: three metres wide, from the tail
        // forward to where the head begins.
        -1.5, 0, 7, 1.5, 0, 7, 1.5, 0, -2, -1.5, 0, 7, 1.5, 0, -2, -1.5, 0, -2,
        // And the head, sticking out in front of it.
        0, 0, -9, -6, 0, -2, 6, 0, -2,
      ],
      3,
    ),
  );
  return shape;
}
