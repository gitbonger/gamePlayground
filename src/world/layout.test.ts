import { describe, expect, it } from 'vitest';
import { defaultWorldOptions, generateCityLayout } from './layout';
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
