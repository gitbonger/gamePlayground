import { describe, expect, it } from 'vitest';
import { defaultWorldOptions, generateCityLayout, nestOn, type Landmark } from './layout';
import { createColliderField } from '../sim/collision';
import { createBird, defaultParams, neutralControls, step } from '../sim/flight';
import { vec } from '../sim/math3';

const DT = 1 / 120;
const layout = generateCityLayout();
const collider = createColliderField(layout.boxes);

/** Fly for `seconds` through the real city and report how it ended. */
function fly(start: ReturnType<typeof vec>, speed: number, seconds: number) {
  const bird = createBird(start, speed);
  const controls = neutralControls();
  for (let t = 0; t < seconds; t += DT) {
    step(bird, controls, defaultParams, DT, collider);
    if (bird.ending) break;
  }
  return bird;
}

describe('generated city', () => {
  it('is deterministic for a given seed', () => {
    const again = generateCityLayout();
    expect(again.boxes).toEqual(layout.boxes);
  });

  it('differs between seeds', () => {
    const other = generateCityLayout({ ...defaultWorldOptions, seed: 8 });
    expect(other.boxes).not.toEqual(layout.boxes);
  });

  it('produces a solid box for every building and tree', () => {
    expect(layout.buildings).toHaveLength(defaultWorldOptions.buildingCount);
    expect(layout.trees).toHaveLength(defaultWorldOptions.treeCount);
    expect(layout.boxes).toHaveLength(
      defaultWorldOptions.buildingCount + defaultWorldOptions.treeCount,
    );
  });

  it('keeps every box above the ground and non-degenerate', () => {
    for (const box of layout.boxes) {
      expect(box.minY).toBe(0);
      expect(box.maxY).toBeGreaterThan(0);
      expect(box.maxX).toBeGreaterThan(box.minX);
      expect(box.maxZ).toBeGreaterThan(box.minZ);
    }
  });
});

describe('flying through the city', () => {
  const tallest = Math.max(...layout.boxes.map((b) => b.maxY));

  // Released outside the city with just enough height to reach the dense
  // centre, and low enough there that it cannot get through without hitting a
  // tower. A pigeon glides at about 4:1, so height and distance are coupled.
  const throughTheSkyline = () => fly(vec(0, 200, 900), 16, 120);

  it('crashes a bird glided into the middle of the skyline', () => {
    const bird = throughTheSkyline();
    expect(bird.ending).not.toBeNull();
    expect(bird.ending!.cause).toBe('building');
  });

  it('leaves the bird outside every solid box when it crashes', () => {
    const bird = throughTheSkyline();
    const { x, y, z } = bird.position;
    const inside = layout.boxes.some(
      (b) => x > b.minX && x < b.maxX && y > b.minY && y < b.maxY && z > b.minZ && z < b.maxZ,
    );
    expect(inside).toBe(false);
  });

  it('lets a bird cruising above the skyline through untouched', () => {
    const bird = fly(vec(0, tallest + 250, 900), 16, 25);
    expect(bird.ending).toBeNull();
    expect(bird.position.y).toBeGreaterThan(tallest);
  });

  it('eventually brings a gliding bird down somewhere, one way or another', () => {
    // Long enough that it must either land, hit a tree, or hit a tower.
    const bird = fly(vec(0, 400, 900), 16, 300);
    expect(bird.ending).not.toBeNull();
    expect(Number.isFinite(bird.position.y)).toBe(true);
    expect(bird.position.y).toBeGreaterThanOrEqual(0);
  });
});

describe('collider performance', () => {
  it('answers sweeps against the full city quickly', () => {
    const start = performance.now();
    for (let i = 0; i < 20000; i++) {
      const x = ((i * 37) % 1800) - 900;
      collider.sweep(vec(x, 40, -900), vec(x, 40, -899.5), 0.22);
    }
    const elapsed = performance.now() - start;
    // 20k sweeps is far more than a frame ever needs; this only fails if the
    // broad phase has regressed into a linear scan.
    expect(elapsed).toBeLessThan(1000);
  });
});

describe('the trees it plants', () => {
  it('plants one sort, because it has no blocks to plant by', () => {
    // The map-built layout picks a sort per block. This one has no blocks, so
    // it picks one for the whole wood rather than shuffling four together,
    // which is the noise that having sorts at all was meant to avoid.
    const layout = generateCityLayout({ ...defaultWorldOptions, seed: 5 });
    expect(layout.trees.length).toBeGreaterThan(20);
    expect(new Set(layout.trees.map((tree) => tree.species)).size).toBe(1);
  });

  it('plants the same wood twice from the same seed', () => {
    const once = generateCityLayout({ ...defaultWorldOptions, seed: 7 });
    const again = generateCityLayout({ ...defaultWorldOptions, seed: 7 });
    expect(once.trees.map((t) => t.species)).toEqual(again.trees.map((t) => t.species));
  });

  it('and a different one from a different seed, sooner or later', () => {
    const sorts = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map(
        (seed) => generateCityLayout({ ...defaultWorldOptions, seed }).trees[0]?.species,
      ),
    );
    expect(sorts.size).toBeGreaterThan(1);
  });
});

describe('a nest on a described thing', () => {
  const TREE: Landmark = {
    name: 'The Home Tree',
    x: 100,
    z: -40,
    width: 11,
    depth: 11,
    height: 18,
    canopy: { trunk: 1.5, skirt: 7, spread: 6 },
    nest: { along: -1.6, across: 0.75 },
  };

  it('sits on the flat top, three times the size it is in life', () => {
    const nest = nestOn(TREE)!;
    // On the top rather than at some height of its own: whatever the tree is
    // made, the nest is on it.
    expect(nest.base).toBe(TREE.height);
    // Life size is a 26 cm nest with a 39 mm egg in it, and at life size a
    // bird standing beside the thing the level is about hides it completely.
    // Both are three times over -- and, more to the point, three times the
    // *same* over: an egg that stayed life size in a tripled nest would be a
    // marble in a bath, which is exactly the sort of thing one scale factor
    // for two numbers prevents.
    expect(nest.radius / 0.13).toBeCloseTo(3, 6);
    expect(nest.egg / 0.039).toBeCloseTo(3, 6);
  });

  it('turns with the thing it is on', () => {
    // Described along and across the tree, like everything else that stands
    // on a landmark, so turning the tree carries the nest round with it
    // instead of leaving it hanging over the same patch of the world.
    const spun = nestOn({ ...TREE, yaw: Math.PI / 2 })!;
    const flat = nestOn(TREE)!;
    // A quarter turn takes the offset from -x to +z, in the collider's
    // convention, and leaves the distance from the middle alone.
    expect(spun.x - TREE.x).toBeCloseTo(flat.z - TREE.z, 9);
    expect(spun.z - TREE.z).toBeCloseTo(TREE.x - flat.x, 9);
  });

  it('is only there when it was described', () => {
    const { nest: _nest, ...bare } = TREE;
    expect(nestOn(bare)).toBeNull();
  });
});
