import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildModel } from './building';
import type { Part } from '../world/model';

const roof: Part = {
  shape: 'gable', along: 0, across: 0, length: 20, width: 10, base: 5, height: 4, colour: 0x888888,
};

/** Every face's outward direction, and where its middle is. */
function faces(geometry: THREE.BufferGeometry) {
  const at = geometry.getAttribute('position');
  const out: { normal: THREE.Vector3; middle: THREE.Vector3 }[] = [];
  for (let i = 0; i < at.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(at, i);
    const b = new THREE.Vector3().fromBufferAttribute(at, i + 1);
    const c = new THREE.Vector3().fromBufferAttribute(at, i + 2);
    const normal = new THREE.Vector3().subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
    out.push({ normal, middle: a.add(b).add(c).divideScalar(3) });
  }
  return out;
}

describe('drawing a described building', () => {
  it('turns every face of a hand-built roof outwards', () => {
    // Outwards is away from the roof's own middle. A face wound the wrong way
    // is culled from outside, and a roof slope that disappears when you look
    // at it is the bug this is here for.
    const middle = new THREE.Vector3(0, 5 + 4 / 3, 0);
    for (const ridge of ['along', 'across'] as const) {
      for (const { normal, middle: at } of faces(buildModel([{ ...roof, ridge }]))) {
        expect(normal.dot(at.clone().sub(middle)), `${ridge} ${at.toArray()}`).toBeGreaterThan(0);
      }
    }
  });

  it('puts a part where it says, at the height it says', () => {
    const block = buildModel([{ ...roof, shape: 'box', along: 30, across: -8, base: 2 }]);
    block.computeBoundingBox();
    const box = block.boundingBox!;
    expect(box.min.x).toBeCloseTo(20, 5);
    expect(box.max.z).toBeCloseTo(-3, 5);
    expect(box.min.y).toBeCloseTo(2, 5);
    expect(box.max.y).toBeCloseTo(6, 5);
  });
});
