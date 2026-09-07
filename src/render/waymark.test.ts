import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWaymark } from './waymark';

/** The way the arrow is actually pointing, in world terms. */
function pointing(object: THREE.Object3D): { x: number; z: number } {
  object.updateMatrixWorld(true);
  const arrow = object.children[1]!;
  const way = new THREE.Vector3(0, 0, -1).applyQuaternion(arrow.quaternion);
  return { x: way.x, z: way.z };
}

describe('the mark that shows the way', () => {
  it('builds at all', () => {
    // Which is not a joke. This was built by merging a plane with a
    // hand-written triangle, and merging is only defined over geometries with
    // the same attributes -- the plane brought normals and texture
    // coordinates and the triangle did not, so the merge returned nothing and
    // the first thing to ask the nothing for its attributes took the whole
    // game down on load. No test looked at it, because no test built it.
    const mark = createWaymark();
    expect(mark.object.children).toHaveLength(2);
    for (const part of mark.object.children) {
      const geometry = (part as THREE.Mesh).geometry;
      expect(geometry, 'a real geometry').toBeDefined();
      expect(geometry.getAttribute('position').count).toBeGreaterThan(0);
    }
    mark.dispose();
  });

  it('stands where it is put, and goes away when there is nothing to show', () => {
    const mark = createWaymark();
    expect(mark.object.visible).toBe(false);

    mark.show({ x: 120, z: -40 }, null);
    expect(mark.object.visible).toBe(true);
    expect(mark.object.position.x).toBe(120);
    expect(mark.object.position.z).toBe(-40);
    // On the ground: it marks a place, and the place is at ground level
    // whatever height the bird passes it at.
    expect(mark.object.position.y).toBe(0);

    mark.show(null);
    expect(mark.object.visible).toBe(false);
    mark.dispose();
  });

  it('points its arrow at the mark after this one', () => {
    const mark = createWaymark();

    // Due north of it, which in this world is -Z.
    mark.show({ x: 0, z: 0 }, { x: 0, z: -100 });
    expect(pointing(mark.object).z).toBeCloseTo(-1, 6);
    expect(pointing(mark.object).x).toBeCloseTo(0, 6);

    // Due east, which is +X.
    mark.show({ x: 0, z: 0 }, { x: 100, z: 0 });
    expect(pointing(mark.object).x).toBeCloseTo(1, 6);
    expect(pointing(mark.object).z).toBeCloseTo(0, 6);

    mark.dispose();
  });

  it('takes the arrow off the last one', () => {
    // There is nowhere after it, and an arrow pointing somewhere arbitrary is
    // worse than no arrow: the player follows it.
    const mark = createWaymark();
    mark.show({ x: 0, z: 0 }, { x: 50, z: 0 });
    expect(mark.object.children[1]!.visible).toBe(true);

    mark.show({ x: 10, z: 10 }, null);
    expect(mark.object.children[1]!.visible).toBe(false);
    mark.dispose();
  });

  it('turns the column and leaves the arrow still', () => {
    // A pointer that spins points nowhere.
    const mark = createWaymark();
    mark.show({ x: 0, z: 0 }, { x: 0, z: -100 });
    const was = pointing(mark.object);

    mark.update(3.5);
    expect(mark.object.children[0]!.rotation.y).not.toBe(0);
    expect(pointing(mark.object).x).toBeCloseTo(was.x, 6);
    expect(pointing(mark.object).z).toBeCloseTo(was.z, 6);
    mark.dispose();
  });
});
