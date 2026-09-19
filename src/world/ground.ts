/**
 * How high the ground is, at a place.
 *
 * The map carries a grid of heights -- see `scripts/fetch-height.ts` -- in
 * local metres, measured from the map centre. Pest is flat and sits within a
 * few metres of nought, which is where everything written for a flat world
 * expects it; the Buda side rises a hundred and more.
 *
 * A first, simple pass. The ground is read here and things are *stood* on it:
 * a house, a car, a tram, the painted streets. Nothing is tilted to it, and
 * the flat layers are still settled by draw order rather than by depth, so a
 * road across a slope is a straight line through it. That is the taste, not
 * the dish.
 */

import type { MapData } from './streets';

export interface Ground {
  /** Metres above the map centre's ground, at a place in local metres. */
  heightAt(x: number, z: number): number;
  /** The lowest and highest it gets, for anything that wants to know. */
  readonly low: number;
  readonly high: number;
}

/** A ground that is flat at nought: what a map with no heights in it gets. */
export const FLAT: Ground = { heightAt: () => 0, low: 0, high: 0 };

export function groundFromMap(map: Pick<MapData, 'ground'>): Ground {
  const grid = map.ground;
  if (!grid || grid.heights.length !== grid.cols * grid.rows) return FLAT;
  const { step, west, north, cols, rows, heights } = grid;

  // Between the samples, the flat average of the four corners weighted by how
  // near each is: a slope rather than a staircase. Off the edge of the grid,
  // the edge itself -- the map ends there and so does the city.
  const heightAt = (x: number, z: number) => {
    const u = Math.min(cols - 1, Math.max(0, (x - west) / step));
    const v = Math.min(rows - 1, Math.max(0, (z - north) / step));
    const col = Math.min(cols - 2, Math.floor(u));
    const row = Math.min(rows - 2, Math.floor(v));
    const fx = Math.min(1, Math.max(0, u - col));
    const fz = Math.min(1, Math.max(0, v - row));
    const at = (c: number, r: number) => heights[r * cols + c] ?? 0;
    const top = at(col, row) * (1 - fx) + at(col + 1, row) * fx;
    const bottom = at(col, row + 1) * (1 - fx) + at(col + 1, row + 1) * fx;
    return top * (1 - fz) + bottom * fz;
  };

  let low = Infinity;
  let high = -Infinity;
  for (const height of heights) {
    if (height < low) low = height;
    if (height > high) high = height;
  }
  return { heightAt, low, high };
}
