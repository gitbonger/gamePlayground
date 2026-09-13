/**
 * The Loft: a block of flats built round a garden.
 *
 * A square ring, eight storeys of it, with the top storey set back from both
 * edges and a flat roof on that -- which is where the story happens. The
 * middle is a hole all the way down, and at the bottom of the hole is a
 * courtyard garden.
 *
 * The roof is game furniture. The trapper and his cage stand on its
 * south-east corner (see `LOFT.deck`), and that corner is what the levels aim
 * at, what the rescue gathers on, and where she is let out. The rest of the
 * ring is somewhere to land and walk round to it.
 *
 * `along` is west (-) to east (+) and `across` north (-) to south (+), from
 * the middle of the courtyard.
 */

import type { Part } from '../world/model';

const WALL = 0xdcd6c8;
const UPPER = 0xe8e5de;
const ROOF = 0x8c9196;
const PANEL = 0x33425a;
const LAWN = 0x6f9a52;
const LEAVES = 0x4f7d3a;
const TRUNK = 0x5d4630;

/** Half the outside of the ring, and half the courtyard. */
const OUTER = 32;
const INNER = 13;
/** The main walls' height, and the set-back storey's on top of it. */
const MAIN = 27.8;
const STOREY = 3.05;
/** How far the top storey stands back from each edge. */
const SET_BACK = 2.5;
/** The roof slab laid on each top, thin enough to read as a coping. */
const SLAB = 0.15;

/** The middle of an arm, the length of it, and how wide it is. */
const arm = OUTER - (OUTER - INNER) / 2;
const width = OUTER - INNER;
const upperOuter = OUTER - SET_BACK;
const upperInner = INNER + SET_BACK;
const upperArm = upperOuter - (upperOuter - upperInner) / 2;
const upperWidth = upperOuter - upperInner;

/**
 * A square ring as four boxes: the north and south arms the full width, the
 * east and west arms between them -- so no two faces lie in the same place
 * and fight over the pixels.
 */
function ring(
  half: number,
  armMiddle: number,
  armWidth: number,
  base: number,
  height: number,
  colour: number,
): Part[] {
  const across = half * 2 - armWidth * 2;
  return [
    { shape: 'box', along: 0, across: -armMiddle, length: half * 2, width: armWidth, base, height, colour },
    { shape: 'box', along: 0, across: armMiddle, length: half * 2, width: armWidth, base, height, colour },
    { shape: 'box', along: -armMiddle, across: 0, length: armWidth, width: across, base, height, colour },
    { shape: 'box', along: armMiddle, across: 0, length: armWidth, width: across, base, height, colour },
  ];
}

/** A row of solar panels lying on the top roof. */
const panels = (along: number, across: number, length: number, width: number): Part => ({
  shape: 'box',
  along,
  across,
  length,
  width,
  base: MAIN + STOREY + SLAB,
  height: 0.35,
  colour: PANEL,
  solid: false,
});

export const LOFT_PARTS: readonly Part[] = [
  // The eight storeys, and the ledge round the top of them.
  ...ring(OUTER, arm, width, 0, MAIN, WALL),
  ...ring(OUTER - 0.1, arm, width - 0.2, MAIN, SLAB, ROOF),
  // The set-back storey, and the roof on it. Its top is thirty-one metres,
  // which is the height every level that comes here was balanced for.
  ...ring(upperOuter, upperArm, upperWidth, MAIN, STOREY, UPPER),
  ...ring(upperOuter - 0.1, upperArm, upperWidth - 0.2, MAIN + STOREY, SLAB, ROOF),

  // Solar panels in long rows, on the north and west arms and the north half
  // of the east one. Not the south arm, whose east end is where the cage
  // stands. Too low to trip over, and not solid: the roof is for walking on.
  panels(0, -upperArm - 2.5, 38, 3),
  panels(0, -upperArm + 2.5, 38, 3),
  panels(-upperArm - 2.5, 0, 3, 30),
  panels(-upperArm + 2.5, 0, 3, 30),
  panels(upperArm, -8, 3, 20),

  // The garden at the bottom of the hole: a lawn, bushes, and two trees that
  // reach a third of the way up. None of it solid -- it is scenery down a
  // well, and a bird that goes down there has other problems.
  { shape: 'box', along: 0, across: 0, length: INNER * 2, width: INNER * 2, base: 0, height: 0.08, colour: LAWN, solid: false },
  ...[[-7, -6], [6, 7]].flatMap(([along = 0, across = 0]) => [
    { shape: 'box' as const, along, across, length: 0.6, width: 0.6, base: 0, height: 4, colour: TRUNK, solid: false },
    { shape: 'hip' as const, along, across, length: 6, width: 6, base: 3, height: 7, top: 0, colour: LEAVES, solid: false },
  ]),
  ...[[-9, 8], [8, -8], [0, 9.5], [-9.5, -1], [9.5, 1]].map(([along = 0, across = 0]) => ({
    shape: 'hip' as const, along, across, length: 2.6, width: 2.6, base: 0, height: 1.6, top: 0.3, colour: LEAVES, solid: false,
  })),
];

/**
 * The patch of roof the story is told on: the south-east corner of the top
 * storey, where the arms meet. Its middle is where the marker hangs and what
 * the cage, her spot and the trapper are placed from.
 */
export const LOFT_DECK = {
  along: upperArm,
  across: upperArm,
  width: upperWidth,
  depth: upperWidth,
};
