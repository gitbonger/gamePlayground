import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createBirdRig, FOOT_DROP, type WingPose } from './bird';
import { createBird, defaultParams } from '../sim/flight';
import { vec } from '../sim/math3';

const POSES: WingPose[] = ['perched', 'gliding', 'braking', 'tucked'];

/**
 * Where the bottom of the drawn bird's feet ends up, given a resting height
 * and the surface the renderer was told is underneath it.
 */
function lowestPoint(pose: WingPose, restingY: number, surfaceY?: number): number {
  const rig = createBirdRig();
  const bird = createBird(vec(0, restingY, 0), 0, 0);
  bird.velocity = vec(0, 0, 0);
  // Long enough for the standing ease-in to have finished moving.
  for (let i = 0; i < 400; i += 1) rig.update(bird, pose, 1 / 120, surfaceY);
  rig.object.updateMatrixWorld(true);

  const feet = new THREE.Box3();
  rig.object.traverse((part) => {
    if (part.name === 'leg') feet.union(new THREE.Box3().setFromObject(part));
  });
  rig.dispose();
  expect(feet.isEmpty(), 'the model has legs to measure').toBe(false);
  return feet.min.y;
}

describe('how far the model hangs below the point the simulation tracks', () => {
  it('is never further than FOOT_DROP says, in any pose', () => {
    // Measured off the built model rather than restated: lengthen a leg and
    // this is the test that notices.
    const drops = POSES.map((pose) => 10 - lowestPoint(pose, 10));
    for (const [i, drop] of drops.entries()) {
      expect(drop, POSES[i]).toBeLessThanOrEqual(FOOT_DROP);
    }
    // And not so generous that it holds the bird off the ground: within a
    // centimetre of the deepest the feet actually reach.
    expect(FOOT_DROP - Math.max(...drops)).toBeLessThan(0.005);
  });

  it('holds the feet clear of the tracked point once it is standing', () => {
    // Perched, the model is lifted by its own standing height, so the feet
    // come to rest just above the point the simulation stopped -- which is
    // why plain ground never showed the bug that a railway did.
    expect(lowestPoint('perched', 10)).toBeGreaterThan(10);
    expect(lowestPoint('gliding', 10)).toBeLessThan(10);
  });
});

describe('a bird resting on a surface the renderer draws above the plane', () => {
  // A railway ribbon is painted 18 cm over the plane the simulation stops a
  // bird on, which is how a landed pigeon came to be standing inside a track.
  const RAILHEAD = 0.18;
  const rest = defaultParams.groundHeight + defaultParams.bodyRadius;

  it('keeps its feet above the railhead however the landing went', () => {
    for (const pose of POSES) {
      // Clear of it, not level with it: feet exactly on the surface read as
      // feet inside it from a chase camera two metres back.
      expect(lowestPoint(pose, rest, RAILHEAD), pose).toBeGreaterThan(RAILHEAD + 0.01);
    }
  });

  it('was standing inside it before, which is what this fixes', () => {
    // Without being told about the ribbon, a bird that scrapes to a stop puts
    // its feet below the rail it is lying on. This is the reported bug.
    expect(lowestPoint('gliding', rest)).toBeLessThan(RAILHEAD);
  });

  it('is not lifted off plain ground, where there was never a problem', () => {
    for (const pose of POSES) {
      expect(lowestPoint(pose, rest, 0), pose).toBeCloseTo(lowestPoint(pose, rest), 9);
    }
  });

  it('is not lifted off a roof or a wagon deck either', () => {
    // Those are real geometry at their real height, and a ground ribbon is
    // never anywhere near them.
    const deck = 1.25 + defaultParams.bodyRadius;
    for (const pose of POSES) {
      expect(lowestPoint(pose, deck, RAILHEAD), pose).toBeCloseTo(lowestPoint(pose, deck), 9);
    }
  });
});
