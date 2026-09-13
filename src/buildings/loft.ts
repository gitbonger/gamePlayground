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
 * A corner house, on Kun utca and Alföldi utca, and turned to stand square
 * to both. `along` runs down Alföldi utca, roughly west (-) to east (+), and
 * `across` down Kun utca, roughly north (-) to south (+), both from the middle
 * of the courtyard. The corner on the two streets is the south-west one; the
 * cage is on the opposite side of the south arm, at the south-east.
 */

import type { Part } from '../world/model';

const WALL = 0xdcd6c8;
const UPPER = 0xe8e5de;
const ROOF = 0x8c9196;
const PANEL = 0x33425a;
const LAWN = 0x6f9a52;
const LEAVES = 0x4f7d3a;
const TRUNK = 0x5d4630;

/**
 * Half the outside of the ring, along Alföldi utca and along Kun utca, and
 * half the courtyard. The outside is OpenStreetMap's outline for the block.
 */
const ALONG = 35.85;
const ACROSS = 32.5;
const INNER = 13;
/** The main walls' height, and the set-back storey's on top of it. */
const MAIN = 27.8;
const STOREY = 3.05;
/** How far the top storey stands back from each edge. */
const SET_BACK = 2.5;
/** The roof slab laid on each top, thin enough to read as a coping. */
const SLAB = 0.15;

/** The top storey's outside and inside. */
const UPPER_ALONG = ALONG - SET_BACK;
const UPPER_ACROSS = ACROSS - SET_BACK;
const UPPER_INNER = INNER + SET_BACK;
/** The middle of the top storey's arms: the east one along, the south one across. */
const EAST_ARM = (UPPER_ALONG + UPPER_INNER) / 2;
const SOUTH_ARM = (UPPER_ACROSS + UPPER_INNER) / 2;

/**
 * A rectangular ring as four boxes: the north and south arms the full
 * length, the east and west arms between them -- so no two faces lie in the
 * same place and fight over the pixels.
 */
function ring(
  along: number,
  across: number,
  inner: number,
  base: number,
  height: number,
  colour: number,
): Part[] {
  const northSouth = across - inner;
  const eastWest = along - inner;
  const middle = (outer: number) => (outer + inner) / 2;
  return [
    { shape: 'box', along: 0, across: -middle(across), length: along * 2, width: northSouth, base, height, colour },
    { shape: 'box', along: 0, across: middle(across), length: along * 2, width: northSouth, base, height, colour },
    { shape: 'box', along: -middle(along), across: 0, length: eastWest, width: inner * 2, base, height, colour },
    { shape: 'box', along: middle(along), across: 0, length: eastWest, width: inner * 2, base, height, colour },
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
  ...ring(ALONG, ACROSS, INNER, 0, MAIN, WALL),
  ...ring(ALONG - 0.1, ACROSS - 0.1, INNER + 0.1, MAIN, SLAB, ROOF),
  // The set-back storey, and the roof on it. Its top is thirty-one metres,
  // which is the height every level that comes here was balanced for.
  ...ring(UPPER_ALONG, UPPER_ACROSS, UPPER_INNER, MAIN, STOREY, UPPER),
  ...ring(UPPER_ALONG - 0.1, UPPER_ACROSS - 0.1, UPPER_INNER + 0.1, MAIN + STOREY, SLAB, ROOF),

  // Solar panels in long rows, on the north and west arms and the north half
  // of the east one. Not the south arm, whose east end is where the cage
  // stands. Too low to trip over, and not solid: the roof is for walking on.
  panels(0, -SOUTH_ARM - 2.5, 40, 3),
  panels(0, -SOUTH_ARM + 2.5, 40, 3),
  panels(-EAST_ARM - 2.5, 0, 3, 30),
  panels(-EAST_ARM + 2.5, 0, 3, 30),
  panels(EAST_ARM, -8, 3, 20),

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
  along: EAST_ARM,
  across: SOUTH_ARM,
  width: UPPER_ALONG - UPPER_INNER,
  depth: UPPER_ACROSS - UPPER_INNER,
};
