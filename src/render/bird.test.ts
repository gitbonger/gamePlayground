import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createBirdRig, FOOT_DROP, PINK_MORPH, type WingPose } from './bird';
import { createBird, defaultParams } from '../sim/flight';
import { vec } from '../sim/math3';

const POSES: WingPose[] = ['perched', 'gliding', 'braking', 'tucked'];

/** The named parts of the model, posed at a given point in the stride. */
function posed(pose: WingPose, stridePhase: number) {
  const rig = createBirdRig();
  const bird = createBird(vec(0, 10, 0), 0, 0);
  bird.velocity = vec(0, 0, 0);
  bird.stridePhase = stridePhase;
  // Long enough for the standing ease-in to have finished moving.
  for (let i = 0; i < 400; i += 1) rig.update(bird, pose, 1 / 120);
  rig.object.updateMatrixWorld(true);

  const legs: THREE.Object3D[] = [];
  let head: THREE.Object3D | undefined;
  rig.object.traverse((part) => {
    if (part.name === 'leg') legs.push(part);
    // The joints the walk cycle drives are named, because that is the only
    // thing about the model's insides anything outside it relies on.
    if (part.name === 'head') head = part;
  });
  expect(head, 'the model has a head joint to measure').toBeDefined();
  rig.dispose();
  return { legs, head: head! };
}

/** Where the bottom of the drawn bird's feet ends up, at a resting height. */
function lowestPoint(pose: WingPose, restingY: number): number {
  const rig = createBirdRig();
  const bird = createBird(vec(0, restingY, 0), 0, 0);
  bird.velocity = vec(0, 0, 0);
  // Long enough for the standing ease-in to have finished moving.
  for (let i = 0; i < 400; i += 1) rig.update(bird, pose, 1 / 120);
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

  it('reaches the feet down to the surface the tracked point rests over', () => {
    // Standing, the point the simulation tracks is the centre of the bird's
    // collision sphere, which rests a body radius above whatever it is
    // standing on. So the feet have to hang below that point -- nearly the
    // whole radius, or the bird hovers -- and never past it, or it sinks.
    const drop = 10 - lowestPoint('perched', 10);
    expect(drop).toBeGreaterThan(defaultParams.bodyRadius - 0.02);
    expect(drop).toBeLessThan(defaultParams.bodyRadius);

    // Flying, nothing is lifted or dropped and the legs are tucked away, so
    // the model hangs by much less.
    expect(10 - lowestPoint('gliding', 10)).toBeLessThan(drop / 2);
  });
});

describe('a bird resting on the ground', () => {
  it('stands on it rather than in it', () => {
    // The reported bug was a pigeon sunk to its middle in a railway track.
    // It was sunk because the track was painted 18 cm above the plane the
    // simulation stops a bird on, and the fix was to tell the renderer how
    // high the drawn ground was -- which meant asking, every frame, which of
    // the map's thousands of segments the bird was over.
    //
    // Nothing is drawn above the plane any more. So what keeps the feet
    // visible is only this: the bird is tracked by its middle, and the model
    // hangs less far below that than the middle stands above the ground.
    const rest = defaultParams.groundHeight + defaultParams.bodyRadius;
    for (const pose of POSES) {
      expect(lowestPoint(pose, rest), pose).toBeGreaterThan(defaultParams.groundHeight);
    }
    expect(defaultParams.bodyRadius).toBeGreaterThan(FOOT_DROP);
  });
});

describe('the walk cycle', () => {
  it('swings the two legs in opposite directions', () => {
    // A quarter of the way through a stride, one leg is forward and the other
    // back. A bird moving both together is hopping, not walking.
    const { legs } = posed('perched', 0.25);
    expect(legs).toHaveLength(2);
    const [left, right] = legs as [THREE.Object3D, THREE.Object3D];
    expect(Math.sign(left.position.z)).toBe(-Math.sign(right.position.z));
    expect(Math.abs(left.position.z)).toBeGreaterThan(0.01);
  });

  it('lifts whichever foot is swinging forward, and only that one', () => {
    const { legs } = posed('perched', 0.25);
    const heights = legs.map((leg) => leg.position.y);
    expect(heights[0]).not.toBeCloseTo(heights[1]!, 4);
  });

  it('returns both legs to the same place at the top of the stride', () => {
    const { legs } = posed('perched', 0);
    expect(legs[0]!.position.z).toBeCloseTo(legs[1]!.position.z, 9);
    expect(legs[0]!.position.y).toBeCloseTo(legs[1]!.position.y, 9);
  });

  it('thrusts the head forward quickly and lets it drift back slowly', () => {
    // The pigeon bob: the head is snapped forward over the first third of the
    // stride and then held still in the air, which relative to the body is a
    // long slow slide backwards. Sampled as reach forward of neutral.
    const samples = Array.from({ length: 100 }, (_, i) => -posed('perched', i / 100).head.position.z);
    const peak = Math.max(...samples);
    const at = samples.indexOf(peak) / 100;

    // Far enough forward to see at all.
    expect(peak).toBeGreaterThan(0.02);
    // And reached in the first third of the stride, rather than halfway
    // through it -- which is what separates a thrust from a plain bob, and
    // what a symmetric curve peaking at 0.5 would fail.
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThanOrEqual(1 / 3);

    // After the peak it only ever comes back, never surges again.
    for (let i = samples.indexOf(peak) + 1; i < samples.length; i += 1) {
      expect(samples[i]!, `sample ${i}`).toBeLessThanOrEqual(samples[i - 1]! + 1e-9);
    }
    // And it is back where it started by the end of the stride.
    expect(samples[99]!).toBeLessThan(peak * 0.1);
  });

  it('holds the head and legs still on a bird that is not on its feet', () => {
    // Mid-stride, but flying: the walk cycle must not drive a bird in the air.
    const flying = posed('gliding', 0.25);
    expect(flying.head.position.z).toBeCloseTo(0, 9);
    expect(flying.legs[0]!.position.z).toBeCloseTo(flying.legs[1]!.position.z, 9);
  });
});

describe('what the bird is built out of', () => {
  /** Every mesh in the model, which is every draw call it costs. */
  const meshes = (rig = createBirdRig()) => {
    const found: THREE.Mesh[] = [];
    rig.object.traverse((part) => {
      if (part instanceof THREE.Mesh) found.push(part);
    });
    return found;
  };

  it('is one mesh per joint, and nothing more', () => {
    // The model is thirty-three lumps. Drawn as thirty-three meshes -- which
    // is how it started -- a flock, five residents and the hero cost more
    // draw calls than the entire city. Fused, a bird costs one per joint: the
    // body, the head, the tail, two shoulders, two wrists and two hips.
    const parts = meshes();
    expect(parts).toHaveLength(9);
    // And one material for the lot, so a bird is one lot of shader state
    // rather than twenty.
    expect(new Set(parts.map((part) => part.material)).size).toBe(1);
  });

  it('carries each lump\'s colour in its vertices', () => {
    // The colours used to be materials, one per lump, which is what made a
    // bird twenty materials. Now they ride in the geometry -- so this is the
    // check that a morph still reaches the model at all.
    const colourOf = (rig: ReturnType<typeof createBirdRig>) => {
      const body = meshes(rig)[0]!;
      const colours = body.geometry.getAttribute('color');
      return [colours.getX(0), colours.getY(0), colours.getZ(0)];
    };

    const feral = colourOf(createBirdRig());
    const pink = colourOf(createBirdRig(PINK_MORPH));
    expect(pink).not.toEqual(feral);
    // The pink one is pinker, which is the whole of what a morph is for.
    expect(pink[0]! - pink[2]!).toBeGreaterThan(feral[0]! - feral[2]!);
  });

  it('washes the whole bird red from one uniform, in the shader three ships', () => {
    // The marker wash used to be a colour written into twenty materials every
    // frame. It is one uniform now, which means it depends on a patch to the
    // stock lambert shader -- so the patch is applied here to the real source
    // three ships, and a release that renames the chunk fails this rather
    // than shipping a bird that cannot be found.
    const rig = createBirdRig();
    const material = meshes(rig)[0]!.material as THREE.MeshLambertMaterial;
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: THREE.ShaderLib['lambert']!.vertexShader,
      fragmentShader: THREE.ShaderLib['lambert']!.fragmentShader,
    };
    material.onBeforeCompile(shader as never, null as never);

    // The glow rides from the vertex to the fragment, and the emissive is set
    // after the vertex colour has been folded in rather than before it.
    expect(shader.vertexShader).toContain('vGlow = glow;');
    const folded = shader.fragmentShader.indexOf('#include <color_fragment>');
    expect(folded).toBeGreaterThan(-1);
    expect(shader.fragmentShader.indexOf('totalEmissiveRadiance = mix(')).toBeGreaterThan(folded);

    // And the wash is that uniform, moving when the rig is told to glow.
    expect(shader.uniforms['washed']!.value).toBe(0);
    rig.glow(0.75);
    expect(shader.uniforms['washed']!.value).toBe(0.75);
    rig.dispose();
  });

  it('keeps each lump lighting itself differently', () => {
    // A pupil gives off almost nothing and an eye gives off half its own
    // orange. That used to be a number on each material; it is a vertex
    // attribute now, and a single value for the whole bird would flatten the
    // face without changing its shape -- which is exactly the sort of loss
    // that goes unnoticed.
    const glow = meshes()[0]!.geometry.getAttribute('glow');
    const values = new Set<number>();
    for (let i = 0; i < glow.count; i += 1) values.add(Math.round(glow.getX(i) * 100));
    expect(values.size).toBeGreaterThan(3);
    expect(Math.min(...values)).toBeLessThan(10);
    expect(Math.max(...values)).toBeGreaterThan(50);
  });
});
