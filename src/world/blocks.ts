/**
 * City blocks: the polygons the streets enclose.
 *
 * The perimeter block is the unit this neighbourhood is actually built in --
 * one continuous building running right round the block with a courtyard in
 * the middle -- so the block, not the house, has to be what the generator
 * works with. Scattering separate houses along a road can never produce a
 * courtyard, because nothing in it knows the block is a closed shape.
 *
 * Which means finding the faces of a planar graph after all. The fear was that
 * real map data would make that fragile -- ways dangle, bridges cross tunnels
 * without meeting -- and it does, but the failure is graceful in every case:
 * a dangling way is walked down and back, contributing nothing, and a missing
 * junction merges two blocks into one larger one rather than losing either.
 */

import type { Road } from './streets';
import { polygonArea, tidyRing, type Point2 } from './polygon';

export interface Block {
  /** The ring the streets enclose, counter-clockwise, in world metres. */
  ring: Point2[];
  /** Ground area in square metres, always positive. */
  area: number;
}

export interface BlockOptions {
  /** Ignore anything smaller than this, in square metres: map noise. */
  minArea: number;
  /**
   * Ignore anything larger, in square metres.
   *
   * Not a real block but a hole in the network -- the edge of the baked map,
   * or a junction the data never noded -- and walling one is worse than
   * leaving it empty, because the wall would run through open country.
   */
  maxArea: number;
}

export const defaultBlockOptions: BlockOptions = {
  minArea: 500,
  maxArea: 2000000,
};

/**
 * Grid the ends of segments snap to, in metres.
 *
 * Ways that meet in OpenStreetMap share a node exactly, so this only has to
 * absorb the rounding in projecting to metres. Snapping harder would start
 * welding genuinely separate streets together.
 */
const SNAP = 0.05;

export function extractBlocks(
  roads: readonly Road[],
  options: BlockOptions = defaultBlockOptions,
): Block[] {
  const ids = new Map<string, number>();
  const xs: number[] = [];
  const zs: number[] = [];
  const neighbours: number[][] = [];

  const nodeAt = (x: number, z: number): number => {
    const key = `${Math.round(x / SNAP)},${Math.round(z / SNAP)}`;
    const found = ids.get(key);
    if (found !== undefined) return found;
    ids.set(key, xs.length);
    xs.push(x);
    zs.push(z);
    neighbours.push([]);
    return xs.length - 1;
  };

  const seen = new Set<string>();
  for (const road of roads) {
    for (let i = 1; i < road.points.length; i += 1) {
      const a = nodeAt(road.points[i - 1]![0], road.points[i - 1]![1]);
      const b = nodeAt(road.points[i]![0], road.points[i]![1]);
      if (a === b) continue;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      neighbours[a]!.push(b);
      neighbours[b]!.push(a);
    }
  }

  // Each node's neighbours in order around it, which is what makes the walk
  // below a walk around a face rather than a wander through the graph.
  const bearing = (from: number, to: number) => Math.atan2(zs[to]! - zs[from]!, xs[to]! - xs[from]!);
  for (let node = 0; node < neighbours.length; node += 1) {
    neighbours[node]!.sort((a, b) => bearing(node, a) - bearing(node, b));
  }

  const walked = new Set<number>();
  const half = (from: number, to: number) => from * neighbours.length + to;
  const blocks: Block[] = [];

  for (let start = 0; start < neighbours.length; start += 1) {
    for (const first of neighbours[start]!) {
      if (walked.has(half(start, first))) continue;

      // Arrive at a node and leave by the next way round clockwise. Always
      // turning the same way keeps the face on one side the whole way, so the
      // walk closes on the block it set out around.
      const ring: Point2[] = [];
      let from = start;
      let to = first;
      do {
        walked.add(half(from, to));
        ring.push([xs[from]!, zs[from]!]);
        const around = neighbours[to]!;
        const back = around.indexOf(from);
        const next = around[(back + around.length - 1) % around.length]!;
        from = to;
        to = next;
        // A face of a graph this size cannot be longer than its edge count.
        if (ring.length > seen.size + 1) break;
      } while (!(from === start && to === first));

      const tidy = tidyRing(ring);
      if (tidy.length < 3) continue;

      // Counter-clockwise means a block. The one face that comes out the other
      // way round is the outside of the whole network.
      const area = polygonArea(tidy);
      if (area < options.minArea || area > options.maxArea) continue;

      blocks.push({ ring: tidy, area });
    }
  }

  return blocks;
}
