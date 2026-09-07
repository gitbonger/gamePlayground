import { describe, expect, it } from 'vitest';
import { CAGE, cageSolid, createCage } from './cage';
import { createColliderField } from '../sim/collision';
import { createBird, defaultParams, neutralControls, step } from '../sim/flight';
import { vec } from '../sim/math3';

const DT = 1 / 120;

describe('the cage as something solid', () => {
  const ROOF = 31;
  const solid = () => cageSolid({ x: 0, z: 0, on: ROOF, yaw: 0 });

  it('stands on what it is put on rather than on the ground', () => {
    // It is on a roof thirty-one metres up. Built from the ground it would be
    // a thirty-one metre column of cage reaching down to the street.
    const box = solid();
    expect(box.minY).toBe(ROOF);
    expect(box.maxY).toBeCloseTo(ROOF + CAGE.height, 6);
  });

  it('is one box rather than one per bar', () => {
    // Two-centimetre bars with ten-centimetre gaps is a shape no sweep
    // against a 22 cm bird can answer sensibly: it would pass between them at
    // some angles and not others, and a wall you can sometimes fly through is
    // worse than either.
    const box = solid();
    expect(box.maxX - box.minX).toBeCloseTo(CAGE.width, 6);
    expect(box.maxZ - box.minZ).toBeCloseTo(CAGE.depth, 6);
  });

  it('stops a bird without killing it, however fast it arrives', () => {
    // The bug this is here for. A pigeon takes off from beside it at the end
    // of the eighth level, and a launch leaves the roof at eleven metres a
    // second -- measured against the old rule, every launch from every
    // distance ended in a dead pigeon within a tenth of a second, because the
    // rule for flying into something is a closing speed written for
    // buildings and this is a birdcage.
    const field = createColliderField([solid()]);
    const bird = createBird(vec(0, ROOF + 0.4, 6), 18, 0);
    bird.velocity = vec(0, 0, -18);
    for (let t = 0; t < 1 && bird.ending === null; t += DT) {
      step(bird, neutralControls(), defaultParams, DT, field);
    }
    expect(bird.ending?.cause, 'not killed by the bars').not.toBe('building');
    // And it is still solid: the bird did not go through it.
    expect(bird.position.z, 'stopped at the near face').toBeGreaterThan(-CAGE.depth / 2);
  });
});

describe('the cage as something to look at', () => {
  it('builds, hides and stands where it is put', () => {
    const cage = createCage();
    expect(cage.object.visible, 'nothing to show yet').toBe(false);
    cage.show({ x: 12, y: 31, z: -4, yaw: 0 });
    expect(cage.object.visible).toBe(true);
    expect(cage.object.position.y).toBe(31);
    cage.show(null);
    expect(cage.object.visible).toBe(false);
    cage.dispose();
  });

  it('puts itself back together when it is shown again', () => {
    // The story is the same story every time it is played, so a cage broken
    // on one run of the level is whole on the next.
    const cage = createCage();
    cage.show({ x: 0, y: 0, z: 0, yaw: 0 });
    cage.burst();
    for (let t = 0; t < 5; t += DT) cage.update(DT);
    expect(cage.object.visible, 'the pieces are gone').toBe(false);

    cage.show({ x: 0, y: 0, z: 0, yaw: 0 });
    expect(cage.object.visible, 'and it is a cage again').toBe(true);
    cage.dispose();
  });
});
