/**
 * How tall a building is when the map does not say.
 *
 * Two thirds of Jozsefvaros says nothing about its own height. Of the nine
 * thousand outlines in this slice, 2,946 give `building:levels` and 95 give
 * `height` in metres; the rest are a footprint and nothing else.
 *
 * They used to get a random 16 to 24 metres, which was the range the old
 * generator invented with, and it was wrong in a way that showed: the
 * buildings that *do* say have a median of 13.8 m and a mean of 14.2, and
 * only 29% of them fall inside that band at all. Two thirds of the district
 * stood about forty per cent too tall. It was not a sampling problem either
 * -- the ones that say and the ones that do not have almost the same
 * footprint, 316 m2 against 268 -- so the silent ones are the same sort of
 * building, guessed badly.
 *
 * What they get instead is their nearest neighbour's height, because a
 * Budapest street is built to one cornice line and the house next door is the
 * best evidence there is about a house. Where there is no neighbour near
 * enough, they get a height drawn from the ones that *do* say.
 *
 * The draw is the part that took measuring. Predicting each known building
 * from the others, the single nearest known height is far and away the best
 * guess -- its median error is nought, because more than half the time a
 * terrace shares its neighbour's height exactly. So the obvious rule for
 * everything out of reach of a neighbour is the district's median, which is
 * the guess with the smallest error there is.
 *
 * It is also the guess that ruins the skyline. The buildings that say nothing
 * are not scattered through the ones that do: they come in patches, whole
 * streets the mapper never got to. Hiding known buildings in patches to
 * imitate that, and predicting them back:
 *
 *                                  mean error   on one value   spread
 *     random 16-24 (what this replaced)  7.70 m           2%      2.3
 *     the district median where no
 *       neighbour is in reach            4.63 m          91%      2.1
 *     a draw from the ones that say      6.00 m          28%      6.1
 *     the truth                              --           --      6.7
 *
 * The median is the better guess about any one building and much the worse
 * description of a city: nine buildings in ten at exactly the same height is
 * a plateau, and the district's real spread of heights disappears. The draw
 * is a couple of metres wronger per building and comes out looking like
 * Jozsefvaros, so the draw is what is used.
 *
 * Nothing is jittered, either the neighbour's height or the drawn one. The
 * real ones are not jittered: a terrace shares one cornice line, exactly.
 */

/** A building as this needs it: where it is, and what it says about itself. */
export interface Sited {
  x: number;
  z: number;
  /** Metres, or null where the map gave neither a height nor a storey count. */
  height: number | null;
}

/**
 * How far away a neighbour may be and still be evidence, in metres.
 *
 * A hundred, which is further than "next door" and is what the measurement
 * asks for. Against the district's median a neighbour stops being worth
 * having at about fifty metres; against a *draw*, which is what is actually
 * on the other side of this decision, it is still worth having at two
 * hundred. A hundred is where the gain flattens off, and it reaches three
 * quarters of the buildings that say nothing.
 */
export const REACH = 100;

/**
 * What a Jozsefvaros building is, in metres, when there is nothing else to go
 * on at all.
 *
 * Only used for a map that says nothing anywhere, which the real one is not:
 * with no heights to draw from there is nothing to draw. The number is the
 * median of the ones that do say.
 */
export const TYPICAL = 13.8;

/**
 * The height a level has to clear to be over the roofs, in metres.
 *
 * Twenty-four, which is what the generator's old upper bound happened to be
 * and is now a measured thing rather than an invented one: nine buildings in
 * ten in this district are under it. Not a rule anything here applies -- it
 * is the number the levels are checked against, so that "released above the
 * rooftops" means something.
 */
export const ROOFLINE = 24;

/**
 * Give every building a height: its own where it has one, its nearest
 * neighbour's where there is one in reach, and one drawn from the rest of the
 * district where there is not.
 *
 * `random` is asked once per building that has to be drawn for, so the world
 * it builds is the same world every time it is built from the same seed.
 *
 * Returns one number per building, in the order they came in.
 */
export function fillHeights(buildings: readonly Sited[], random: () => number): number[] {
  const known: number[] = [];
  for (let i = 0; i < buildings.length; i += 1) {
    if (buildings[i]!.height !== null) known.push(i);
  }

  // Everything the district says about itself, to draw from where there is no
  // neighbour to go on. Not averaged, not smoothed: a draw from these is a
  // height some building on this map really is.
  const heights = known.map((i) => buildings[i]!.height!);

  // A grid of the ones that know, at exactly the reach: a neighbour within
  // fifty metres is then never further than one cell away on either axis, so
  // nine cells is the whole search and the ring-walking a nearest-point index
  // usually needs is not needed.
  const grid = new Map<string, number[]>();
  const cell = (x: number, z: number) => `${Math.floor(x / REACH)},${Math.floor(z / REACH)}`;
  for (const i of known) {
    const key = cell(buildings[i]!.x, buildings[i]!.z);
    const bucket = grid.get(key);
    if (bucket) bucket.push(i);
    else grid.set(key, [i]);
  }

  return buildings.map((building) => {
    if (building.height !== null) return building.height;

    const gx = Math.floor(building.x / REACH);
    const gz = Math.floor(building.z / REACH);
    let nearest: number | null = null;
    let closest = REACH * REACH;

    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oz = -1; oz <= 1; oz += 1) {
        for (const i of grid.get(`${gx + ox},${gz + oz}`) ?? []) {
          const other = buildings[i]!;
          const dx = other.x - building.x;
          const dz = other.z - building.z;
          const away = dx * dx + dz * dz;
          if (away <= closest) {
            closest = away;
            nearest = i;
          }
        }
      }
    }

    if (nearest !== null) return buildings[nearest]!.height!;
    if (heights.length === 0) return TYPICAL;
    return heights[Math.min(heights.length - 1, Math.floor(random() * heights.length))]!;
  });
}
