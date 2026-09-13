/**
 * Keleti pályaudvar, the Eastern Railway Station.
 *
 * Laid on the outline OpenStreetMap has for it: 181 metres from the front on
 * Baross tér back to where the tracks come in, and 97 across, between
 * Thököly út and Kerepesi út. What stands on that outline is the building as
 * it is seen from the air:
 *
 * - the train shed down the middle, a long pitched roof of iron and glass,
 *   and open at the far end -- which is where the tracks come in, and where a
 *   pigeon can fly in after them;
 * - an arcaded wing either side of it, lower, in yellow render;
 * - a square pavilion with a pyramid roof on each wing;
 * - and at the front, the thing everybody knows: a stone screen with a great
 *   arched window, a tower either side of it, and a pavilion with a mansard
 *   roof at each corner.
 *
 * The heights are judged off photographs rather than measured, and are the
 * numbers to change if it looks wrong from the air.
 *
 * `along` runs from the front (-) to the tracks (+), which is west to east;
 * `across` from the Thököly út side (-) to the Kerepesi út side (+).
 */

import { mirrored, type Part } from '../world/model';

const STONE = 0xe0d6c1;
const RENDER = 0xd6bd84;
const SLATE = 0x69717a;
const SHED = 0xa6b3ae;
const GLASS = 0x3a4650;

/** The front wall, along. Everything at the front is flush with this. */
const FRONT = -90.5;
/** How high the shed's walls go before its roof starts. */
const EAVES = 22;

export const KELETI_PARTS: readonly Part[] = [
  // --- The shed ------------------------------------------------------------
  // The roof over the platforms. Its underside is at the eaves, and nothing
  // below that is solid down the middle: the shed is somewhere to fly.
  { shape: 'gable', along: 1.5, across: 0, length: 177, width: 46, base: EAVES, height: 14, colour: SHED },
  // Its walls, standing on the wings, where the long row of arched windows is.
  ...mirrored({ shape: 'box', along: 1.5, across: 22.4, length: 177, width: 1.2, base: 12, height: 10, colour: RENDER }),

  // --- The wings -------------------------------------------------------------
  ...mirrored({ shape: 'box', along: 5, across: 34.8, length: 171, width: 24.4, base: 0, height: 12, colour: RENDER }),
  ...mirrored({ shape: 'hip', along: 5, across: 34.8, length: 171, width: 24.4, base: 12, height: 3.5, top: 0.6, colour: SLATE }),
  // The pavilion on each, standing proud of the wing and above it.
  ...mirrored({ shape: 'box', along: -13, across: 35.75, length: 22, width: 25.5, base: 0, height: 20, colour: RENDER }),
  ...mirrored({ shape: 'hip', along: -13, across: 35.75, length: 22, width: 25.5, base: 20, height: 9, top: 0, colour: SLATE }),

  // --- The front -------------------------------------------------------------
  // The block across the front, behind the screen and between the corners.
  { shape: 'box', along: -84, across: 0, length: 11, width: 68, base: 0, height: 16, colour: STONE },
  { shape: 'hip', along: -84, across: 0, length: 11, width: 68, base: 16, height: 3, top: 0.7, colour: SLATE },
  // The screen, with its gable, and the arch in it.
  { shape: 'box', along: FRONT + 3, across: 0, length: 6, width: 50, base: 0, height: 30, colour: STONE },
  { shape: 'gable', along: FRONT + 3, across: 0, length: 6, width: 50, base: 30, height: 10, colour: STONE },
  { shape: 'arch', along: FRONT - 0.2, across: 0, length: 0, width: 30, base: 5, height: 16, facing: -Math.PI / 2, colour: GLASS },
  // A tower either side of it.
  ...mirrored({ shape: 'box', along: FRONT + 4, across: 29, length: 8, width: 8, base: 0, height: 36, colour: STONE }),
  ...mirrored({ shape: 'hip', along: FRONT + 4, across: 29, length: 8, width: 8, base: 36, height: 7, top: 0, colour: SLATE }),
  // And a pavilion at each corner.
  ...mirrored({ shape: 'box', along: FRONT + 10.5, across: 40.5, length: 21, width: 16, base: 0, height: 19, colour: STONE }),
  ...mirrored({ shape: 'hip', along: FRONT + 10.5, across: 40.5, length: 21, width: 16, base: 19, height: 6, top: 0.5, colour: SLATE }),
];
