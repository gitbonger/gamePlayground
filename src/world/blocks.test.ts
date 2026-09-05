import { describe, expect, it } from 'vitest';
import { extractBlocks, defaultBlockOptions } from './blocks';
import { polygonArea } from './polygon';
import type { Road } from './streets';

const road = (points: [number, number][], width = 10): Road => ({ kind: 'residential', width, points });

/**
 * Four streets round one block, overshooting the corners.
 *
 * The junctions are listed as points on both streets, because that is how
 * OpenStreetMap records a crossing: ways that meet share the node.
 */
const oneBlock: Road[] = [
  road([[-40, 0], [0, 0], [200, 0], [240, 0]]),
  road([[-40, 200], [0, 200], [200, 200], [240, 200]]),
  road([[0, -40], [0, 0], [0, 200], [0, 240]]),
  road([[200, -40], [200, 0], [200, 200], [200, 240]]),
];

describe('finding the blocks between streets', () => {
  it('finds the one square four streets enclose', () => {
    const blocks = extractBlocks(oneBlock);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.area).toBeCloseTo(200 * 200, 6);
  });

  it('winds them counter-clockwise, so the inside is to the left', () => {
    // Which is what lets a wall know which way to face without being told.
    for (const block of extractBlocks(oneBlock)) {
      expect(polygonArea(block.ring)).toBeGreaterThan(0);
    }
  });

  it('leaves out the outside of the network', () => {
    // The traversal produces the unbounded face alongside the real ones, drawn
    // the other way round. Four streets enclose one block, not two.
    // Asked for anything with an area at all, the outer face is still left
    // out: it is excluded by which way it winds, not by how big it is.
    expect(extractBlocks(oneBlock, { minArea: 1, maxArea: 1e9 })).toHaveLength(1);
  });

  it('splits a grid into every square it makes', () => {
    // Three streets each way: four blocks, not one big one.
    const lines: Road[] = [];
    for (const at of [0, 100, 200]) {
      lines.push(road([[-20, at], [0, at], [100, at], [200, at], [220, at]]));
      lines.push(road([[at, -20], [at, 0], [at, 100], [at, 200], [at, 220]]));
    }
    const blocks = extractBlocks(lines);
    expect(blocks).toHaveLength(4);
    for (const block of blocks) expect(block.area).toBeCloseTo(100 * 100, 6);
  });

  it('ignores a dead end rather than counting it as a block', () => {
    const withStub = [...oneBlock, road([[100, 200], [100, 260]])];
    const blocks = extractBlocks(withStub);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.area).toBeCloseTo(200 * 200, 6);
  });

  it('takes a dead end reaching into a block in its stride', () => {
    // Walked down and back, contributing no area. The block still closes
    // around it, which is what a mews or a courtyard entrance really is.
    const withMews = [...oneBlock, road([[100, 0], [100, 60]])];
    const blocks = extractBlocks(withMews);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.area).toBeCloseTo(200 * 200, 6);
  });

  it('drops faces too small or too large to be a block', () => {
    expect(extractBlocks(oneBlock, { ...defaultBlockOptions, minArea: 50000 })).toHaveLength(0);
    expect(extractBlocks(oneBlock, { ...defaultBlockOptions, maxArea: 10000 })).toHaveLength(0);
  });

  it('merges two blocks when the map never noded the street between them', () => {
    // Worth stating plainly, because it is the failure mode of working from
    // real data: a crossing recorded without a shared node does not divide
    // anything. One block too large is a far better outcome than none.
    const unnoded: Road[] = [
      ...oneBlock,
      road([[100, -40], [100, 240]]),
    ];
    const blocks = extractBlocks(unnoded);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.area).toBeCloseTo(200 * 200, 6);
  });
});
