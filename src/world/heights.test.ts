import { describe, expect, it } from 'vitest';
import { fillHeights, REACH, TYPICAL, type Sited } from './heights';

/**
 * A fixed stand-in for the world's own random source.
 *
 * Always the first of whatever it is offered, so a test about the draw is a
 * test about the draw and not about a particular seed.
 */
const first = () => 0;

const at = (x: number, z: number, height: number | null = null): Sited => ({ x, z, height });

describe('filling in the heights the map does not give', () => {
  it('leaves a building that says how tall it is alone', () => {
    // Two thirds of the district is guessed; the other third is the evidence,
    // and evidence that gets overwritten is not evidence.
    const filled = fillHeights([at(0, 0, 22.5), at(60, 0, 9.1)], first);
    expect(filled).toEqual([22.5, 9.1]);
  });

  it('gives a silent building its neighbour’s height', () => {
    // The house next door is the best thing there is to go on: a Budapest
    // street is built to one cornice line.
    expect(fillHeights([at(0, 0, 18.6), at(12, 0)], first)[1]).toBe(18.6);
  });

  it('takes the nearest one, not just any one', () => {
    // Which is the whole claim. A rule that took the first it found would
    // score no better than picking a building out of the district at random.
    const filled = fillHeights([at(-40, 0, 30), at(0, 0), at(8, 0, 11)], first);
    expect(filled[1]).toBe(11);
  });

  it('finds the neighbour whichever way it lies', () => {
    // The index is a grid, and a grid searched only forward finds the house
    // along the street and misses the one behind. Every one of the eight ways
    // out of a cell has to be looked down.
    //
    // So each pair is put astride a cell boundary -- the silent one a metre
    // inside, its neighbour a metre beyond -- which is two metres apart and
    // in different cells. The only other evidence is nine hundred metres off
    // and a different height, so a direction that went unsearched answers 9.
    for (const [ox, oz] of [
      [-1, -1], [0, -1], [1, -1],
      [-1, 0], [1, 0],
      [-1, 1], [0, 1], [1, 1],
    ]) {
      const filled = fillHeights([
        at(ox! * (REACH + 1), oz! * (REACH + 1), 27),
        at(ox! * (REACH - 1), oz! * (REACH - 1)),
        at(900, 900, 9),
        at(905, 900, 9),
      ], first);
      expect(filled[1], `neighbour at ${ox}, ${oz}`).toBe(27);
    }
  });

  it('draws from the district when no neighbour is in reach', () => {
    // Past the reach it is not the house next door, it is a house somewhere
    // else, and there is nothing to be learnt from it. What the building gets
    // instead is a height that some building on this map really is.
    const far = REACH + 10;
    const rows = [at(0, 0, 40), at(1, 0, 10), at(2, 0, 31), at(far, far)];
    expect(fillHeights(rows, () => 0)[3]).toBe(40);
    expect(fillHeights(rows, () => 0.5)[3]).toBe(10);
    expect(fillHeights(rows, () => 0.99)[3]).toBe(31);
  });

  it('keeps the district’s spread rather than flattening it to one number', () => {
    // The whole reason it draws instead of taking the median, which would be
    // the better guess about any one building. The ones that say nothing come
    // in patches -- whole streets a mapper never got to -- so a rule that
    // gives every out-of-reach building the same number gives whole streets
    // the same number. Measured on this map, that was nine buildings in ten
    // at one height and the district's spread of 6.7 m collapsing to 2.1.
    const rows: Sited[] = [];
    for (let i = 0; i < 20; i += 1) rows.push(at(i, 0, 6 + i * 2));
    // A row of silent ones, each further from the evidence than the reach.
    for (let i = 0; i < 40; i += 1) rows.push(at(1000 + i * 3, 1000, null));

    let seed = 0.123;
    const filled = fillHeights(rows, () => (seed = (seed * 9301 + 0.49297) % 1));
    const guessed = filled.slice(20);
    expect(new Set(guessed).size).toBeGreaterThan(5);
    // And every one of them is a height something on this map really is.
    const real = new Set(filled.slice(0, 20));
    for (const height of guessed) expect(real.has(height)).toBe(true);
  });

  it('still comes up with a number when nothing on the map says anything', () => {
    // A guess with no evidence behind it is still a building that has to be
    // drawn, and a null here is a NaN in a collision box.
    const filled = fillHeights([at(0, 0), at(500, 500)], first);
    expect(filled).toEqual([TYPICAL, TYPICAL]);
  });

  it('answers for every building, in the order it was asked', () => {
    const rows = [at(0, 0, 12), at(5, 0), at(400, 400), at(405, 400, 31)];
    expect(fillHeights(rows, first)).toEqual([12, 12, 31, 31]);
  });

  it('is not fooled by a neighbour just over a grid line', () => {
    // The index is cut into cells of exactly the reach, so a building sitting
    // a metre inside one cell and its neighbour a metre inside the next are
    // the case a grid gets wrong.
    const line = REACH;
    expect(fillHeights([at(line - 1, line - 1, 27), at(line + 1, line + 1)], first)[1]).toBe(27);
  });
});
