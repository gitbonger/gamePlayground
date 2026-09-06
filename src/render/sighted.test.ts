import { describe, expect, it } from 'vitest';
import { defaultSight, sighted, type Sight } from './sighted';

const north: Sight = { ...defaultSight, eye: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: -1 } };
const at = (x: number, y: number, z: number) => ({ x, y, z });

describe('deciding whether a bird is worth drawing', () => {
  it('draws what is in front of the camera', () => {
    expect(sighted(at(0, 0, -50), north)).toBe(true);
    expect(sighted(at(20, 5, -50), north)).toBe(true);
  });

  it('does not draw what is behind it', () => {
    expect(sighted(at(0, 0, 50), north)).toBe(false);
    expect(sighted(at(20, 0, 50), north)).toBe(false);
  });

  it('opens the cone out past the corners of the frame', () => {
    // The camera is 70 degrees vertically on a wide frame, so its corners are
    // about 55 degrees off the axis. A bird a little outside that is still
    // drawn, because popping into existence at the edge of the screen is
    // worse than a few birds drawn needlessly.
    const off = (degrees: number) => {
      const turn = (degrees * Math.PI) / 180;
      return at(Math.sin(turn) * 50, 0, -Math.cos(turn) * 50);
    };
    expect(sighted(off(55), north)).toBe(true);
    expect(sighted(off(80), north)).toBe(true);
    expect(sighted(off(100), north)).toBe(false);
  });

  it('drops what is too far away to read', () => {
    // A pigeon is 35 cm across; at 250 m that is a pixel and a half.
    expect(sighted(at(0, 0, -(defaultSight.range - 1)), north)).toBe(true);
    expect(sighted(at(0, 0, -(defaultSight.range + 1)), north)).toBe(false);
  });

  it('measures range in three dimensions, not two', () => {
    // Straight down is out of range as surely as straight ahead is.
    const looking = { ...north, forward: { x: 0, y: -1, z: 0 } };
    expect(sighted(at(0, -(defaultSight.range - 1), 0), looking)).toBe(true);
    expect(sighted(at(0, -(defaultSight.range + 1), 0), looking)).toBe(false);
  });

  it('draws something sitting on the camera rather than dividing by nothing', () => {
    expect(sighted(at(0, 0, 0), north)).toBe(true);
  });

  it('turns with the camera', () => {
    const east: Sight = { ...north, forward: { x: 1, y: 0, z: 0 } };
    expect(sighted(at(50, 0, 0), east)).toBe(true);
    expect(sighted(at(-50, 0, 0), east)).toBe(false);
    expect(sighted(at(50, 0, 0), north)).toBe(false);
  });
});
