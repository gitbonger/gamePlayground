/**
 * A building described part by part, for the few that have to look like
 * themselves.
 *
 * The city is generated: an outline off the map, pushed up to a height, with
 * windows painted on. That is right for the thousands of blocks nobody will
 * ever name, and wrong for the handful everybody would -- Keleti is not a box
 * of the right size, it is a glass shed between two arcades behind an arch.
 * So those are written down here instead, as parts: a box, a gable roof, a
 * hipped one, an arched window. A few dozen of them is a recognisable
 * building at the distance this game is flown at.
 *
 * Everything is in the landmark's own frame: `along` its length, `across`
 * its width, both from its middle, and heights from the ground. The same list
 * is drawn (`src/render/building.ts`) and made solid (`partBoxes` below), so
 * what you see and what you fly into cannot drift apart.
 */

import { turnedBox, type Box } from '../sim/collision';

export type Shape =
  /** A block. */
  | 'box'
  /** A pitched roof with a ridge, and triangular ends. */
  | 'gable'
  /**
   * A roof sloping in from all four sides: a pyramid when `top` is nought, a
   * mansard with a flat top when it is more.
   */
  | 'hip'
  /**
   * A window with a round head, flat against a wall. Drawn, never solid:
   * it is paint on the wall behind it, which is solid already.
   */
  | 'arch';

export interface Part {
  shape: Shape;
  /** Its middle, along and across the landmark. */
  along: number;
  across: number;
  /** How long it is along the landmark, and how wide across it. */
  length: number;
  width: number;
  /** Where it starts above the ground, and how tall it is from there. */
  base: number;
  height: number;
  colour: number;
  /** For a gable: which way the ridge runs. Along, if not said. */
  ridge?: 'along' | 'across';
  /** For a hip: how much of the footprint the flat top keeps, 0 to 1. */
  top?: number;
  /**
   * For an arch: which way it faces, as a turn from facing along +across.
   * `-Math.PI / 2` is a window looking out of the front, down -along.
   */
  facing?: number;
  /** Whether it can be flown into. Everything but an arch, if not said. */
  solid?: boolean;
}

/**
 * The boxes that make a landmark's parts solid, in the world.
 *
 * A box is itself. A sloping roof is a short staircase of boxes stepping in
 * towards the ridge -- three for a gable, two for a hip -- because the
 * collider only knows boxes, and a single box the size of the roof would put
 * a flat plate at ridge height over the whole building: land "on the roof"
 * and you would be standing in the air above the eaves.
 */
export function partBoxes(
  place: { x: number; z: number; yaw?: number },
  parts: readonly Part[],
): Box[] {
  const yaw = place.yaw ?? 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const boxes: Box[] = [];

  /** One box of the staircase, in the landmark's frame. */
  const add = (
    along: number,
    across: number,
    length: number,
    width: number,
    base: number,
    height: number,
  ) => {
    const box = turnedBox(
      place.x + along * cos + across * sin,
      place.z - along * sin + across * cos,
      length,
      base + height,
      width,
      yaw,
    );
    box.minY = base;
    boxes.push(box);
  };

  for (const part of parts) {
    if (part.solid === false || part.shape === 'arch') continue;
    const { along, across, length, width, base, height } = part;
    if (part.shape === 'box') {
      add(along, across, length, width, base, height);
    } else if (part.shape === 'gable') {
      const steps = 3;
      for (let n = 0; n < steps; n += 1) {
        // Each step is as wide as the roof is halfway up it.
        const keep = 1 - (n + 0.5) / steps;
        const alongRidge = part.ridge !== 'across';
        add(
          along,
          across,
          alongRidge ? length : length * keep,
          alongRidge ? width * keep : width,
          base + (height * n) / steps,
          height / steps,
        );
      }
    } else {
      const top = part.top ?? 0;
      const steps = 2;
      for (let n = 0; n < steps; n += 1) {
        const keep = 1 - (1 - top) * ((n + 0.5) / steps);
        add(along, across, length * keep, width * keep, base + (height * n) / steps, height / steps);
      }
    }
  }
  return boxes;
}

/**
 * The same part on the other side of the landmark's centre line.
 *
 * Most of what is worth describing is symmetrical -- two wings, two towers,
 * two corner pavilions -- and writing each out twice is two chances to get
 * one of them wrong.
 */
export const mirrored = (part: Part): Part[] => [part, { ...part, across: -part.across }];
