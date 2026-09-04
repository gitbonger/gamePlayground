import { describe, expect, it } from 'vitest';
import { aabb, createColliderField, sweepBox, type Aabb } from './collision';
import { vec } from './math3';

/** A 10 m cube sitting on the ground at the origin. */
const TOWER: Aabb = aabb(-5, 0, -5, 5, 20, 5);

describe('sweepBox', () => {
  it('reports the entry face of a head-on hit', () => {
    const hit = sweepBox(vec(0, 10, -20), vec(0, 0, 40), 0, TOWER);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeCloseTo(15 / 40, 5);
    expect(hit!.normal).toEqual(vec(0, 0, -1));
    expect(hit!.point.z).toBeCloseTo(-5, 5);
  });

  it('misses when the segment passes to the side', () => {
    expect(sweepBox(vec(20, 10, -20), vec(0, 0, 40), 0, TOWER)).toBeNull();
  });

  it('misses when the segment stops short', () => {
    expect(sweepBox(vec(0, 10, -20), vec(0, 0, 10), 0, TOWER)).toBeNull();
  });

  it('grows the box by the mover radius', () => {
    const grazing = vec(5.5, 10, -20);
    expect(sweepBox(grazing, vec(0, 0, 40), 0, TOWER)).toBeNull();
    expect(sweepBox(grazing, vec(0, 0, 40), 1, TOWER)).not.toBeNull();
  });

  it('catches a landing on the roof and names the up face', () => {
    const hit = sweepBox(vec(0, 30, 0), vec(0, -20, 0), 0, TOWER);
    expect(hit).not.toBeNull();
    expect(hit!.normal).toEqual(vec(0, 1, 0));
    expect(hit!.point.y).toBeCloseTo(20, 5);
  });

  it('does not fire for a segment that starts inside the box', () => {
    expect(sweepBox(vec(0, 10, 0), vec(1, 0, 0), 0, TOWER)).toBeNull();
  });

  it('catches a fast segment that would tunnel through a point test', () => {
    // 200 m of travel in one step, against a 10 m box.
    const hit = sweepBox(vec(0, 10, -100), vec(0, 0, 200), 0, TOWER);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeCloseTo(95 / 200, 5);
  });
});

describe('collider field', () => {
  const boxes = [
    aabb(-5, 0, -5, 5, 20, 5),
    aabb(95, 0, -5, 105, 40, 5),
    aabb(-5, 0, 195, 5, 60, 205),
  ];
  const field = createColliderField(boxes);

  it('finds a hit through the broad phase', () => {
    const hit = field.sweep(vec(100, 10, -40), vec(100, 10, 40), 0.2);
    expect(hit).not.toBeNull();
    expect(hit!.point.z).toBeCloseTo(-5.2, 5);
  });

  it('returns the nearest hit when a sweep crosses several boxes', () => {
    const far = createColliderField([aabb(-5, 0, 10, 5, 20, 20), aabb(-5, 0, 40, 5, 20, 50)]);
    const hit = far.sweep(vec(0, 10, 0), vec(0, 10, 100), 0);
    expect(hit!.point.z).toBeCloseTo(10, 5);
  });

  it('finds nothing in open air', () => {
    expect(field.sweep(vec(-300, 200, -300), vec(-300, 200, 300), 0.2)).toBeNull();
  });

  it('handles boxes spanning several grid cells without duplicate work', () => {
    // 300 m wide, far larger than the 32 m cell size.
    const wide = createColliderField([aabb(-150, 0, -5, 150, 30, 5)]);
    const hit = wide.sweep(vec(0, 10, -50), vec(0, 10, 50), 0);
    expect(hit).not.toBeNull();
    expect(hit!.normal).toEqual(vec(0, 0, -1));
  });

  it('reports the tallest box standing over a point', () => {
    expect(field.heightAt(0, 0)).toBe(20);
    expect(field.heightAt(100, 0)).toBe(40);
    expect(field.heightAt(50, 50)).toBe(-Infinity);
  });

  it('stays correct across repeated queries reusing the seen-stamp buffer', () => {
    for (let i = 0; i < 200; i++) {
      expect(field.sweep(vec(0, 10, -40), vec(0, 10, 40), 0.2)).not.toBeNull();
      expect(field.sweep(vec(0, 300, -40), vec(0, 300, 40), 0.2)).toBeNull();
    }
  });
});
