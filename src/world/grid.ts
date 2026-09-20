/**
 * The overhead grid: lattice towers, and the cable that hangs between them.
 *
 * Two facts from the survey and one from physics. The towers are nodes the
 * map has tagged as towers -- a line's other vertices are only bends in it,
 * five hundred and ninety-seven of them against a hundred and sixty-eight
 * towers -- and the line itself is the path the cable takes. The physics is
 * that a cable hung between two points does not go straight: it dips, by
 * about three parts in a hundred of the span, and everything anybody knows
 * about a power line by sight is in that dip.
 *
 * What comes out is a list of towers to draw and a list of cables to draw and
 * to land on. A pigeon on a wire is the whole reason this is here.
 */

import type { Pylon, Wire } from './layout';

/** How tall a tower is, in metres, by what it carries. */
const TOWER_HEIGHT: { volts: number; tall: number }[] = [
  { volts: 100000, tall: 32 },
  { volts: 20000, tall: 18 },
  { volts: 0, tall: 11 },
];

export const towerHeight = (volts: number): number =>
  TOWER_HEIGHT.find((each) => volts >= each.volts)?.tall ?? 11;

/**
 * Where the cable hangs on a tower: up its height as a fraction, out to the
 * side in metres.
 *
 * A Danube tower, which is what most of the grid here is built of and what
 * the diagram of one always shows: a single beam across the top with an
 * insulator string at each end, a third phase hung on a fork inside the
 * tower window between them, and two peaks above the beam carrying the earth
 * wires that shield the lot from lightning.
 *
 * Five cables, not six. The two outer phases hang *below* the beam by the
 * length of their insulators -- which is why the beam is at 0.72 and they are
 * at 0.65 -- and the earth wires sit right on the peaks, because nothing
 * hangs from a peak.
 */
export const HANGS: { up: number; out: number }[] = [
  { up: 0.65, out: 6 },
  { up: 0.65, out: -6 },
  // The fork's phase, low in the window and on the middle line.
  { up: 0.55, out: 0 },
  // The earth wires, on the tips.
  { up: 1, out: 2.2 },
  { up: 1, out: -2.2 },
];

/** Where the beam and the peaks are, which is what the tower is drawn to. */
export const TOWER = {
  beam: { up: 0.72, out: 6 },
  peak: { up: 1, out: 2.2 },
  /**
   * The waist, and how wide the feet are: both fractions of the height.
   *
   * A hundred and thirty-two kilovolt tower stands about eight metres across
   * at the feet and carries a beam twelve across, so the beam is the widest
   * thing on it -- which is what makes the shape read as a pylon rather than
   * as a pit head.
   */
  waist: { up: 0.45, wide: 0.042 },
  feet: 0.12,
};

/** How far a cable dips at mid-span, as a fraction of the span. */
const SAG = 0.03;

/** How often a cable is sampled along a span, in metres. */
const SAMPLED = 7;

/** How near a line's vertex has to be to a tower to be that tower's. */
const AT_TOWER = 3;

const gap = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);

/**
 * The grid, from the map's lines and towers.
 *
 * `groundAt` is what the ground does under it: a tower stands on the ground
 * it is on, and the cable hangs from the tower rather than from a height
 * above the sea.
 */
export function buildGrid(
  lines: readonly { points: [number, number][]; volts: number }[],
  towers: readonly number[][],
  groundAt: (x: number, z: number) => number = () => 0,
): { pylons: Pylon[]; wires: Wire[] } {
  const pylons: Pylon[] = [];
  const wires: Wire[] = [];
  /** So two lines meeting on one tower do not build it twice. */
  const built = new Set<string>();

  for (const line of lines) {
    const tall = towerHeight(line.volts);
    const points = line.points;
    if (points.length < 2) continue;

    // Which of this line's vertices are towers. The ends always are: a line
    // has to hang from something, and a survey that stops at a boundary
    // leaves its last tower on the other side of it.
    const supports: number[] = [];
    points.forEach((point, at) => {
      const isTower =
        at === 0 ||
        at === points.length - 1 ||
        towers.some((tower) => gap(tower, point) <= AT_TOWER);
      if (isTower) supports.push(at);
    });
    if (supports.length < 2) continue;

    for (const at of supports) {
      const point = points[at]!;
      const key = `${Math.round(point[0])},${Math.round(point[1])}`;
      if (built.has(key)) continue;
      built.add(key);
      // Square to the line, because that is how a tower is built: the beam
      // reaches out either side of the way the cable runs, and a beam built
      // along the cable would hang all three phases off the same point.
      //
      // A quarter turn off the line's own bearing, and the quarter turn is
      // the whole of it: the model is drawn with its beam along its own x.
      const before = points[Math.max(0, at - 1)]!;
      const after = points[Math.min(points.length - 1, at + 1)]!;
      const along = Math.atan2(-(after[1] - before[1]), after[0] - before[0]);
      pylons.push({ x: point[0], z: point[1], yaw: along + Math.PI / 2, height: tall });
    }

    // And the cable, span by span between the towers, following the bends in
    // between and dipping as it goes.
    for (let leg = 0; leg + 1 < supports.length; leg += 1) {
      const from = supports[leg]!;
      const to = supports[leg + 1]!;
      const run = points.slice(from, to + 1);
      let span = 0;
      for (let i = 1; i < run.length; i += 1) span += gap(run[i - 1]!, run[i]!);
      if (span < 1) continue;
      const dip = Math.min(span * SAG, tall * 0.35);

      for (const arm of HANGS) {
        const hang = tall * arm.up;
        const points3: [number, number, number][] = [];
        let walked = 0;
        for (let i = 0; i < run.length; i += 1) {
          if (i > 0) walked += gap(run[i - 1]!, run[i]!);
          // Along the leg, and between the mapped vertices: a straight
          // stretch of a three hundred metre span still has to be sampled
          // or it is a cable made of two straight lines.
          const before = i > 0 ? run[i - 1]! : run[i]!;
          const here = run[i]!;
          const stretch = i > 0 ? gap(before, here) : 0;
          const steps = Math.max(1, Math.round(stretch / SAMPLED));
          for (let step = i > 0 ? 1 : 0; step <= steps; step += 1) {
            const t = steps === 0 ? 0 : step / steps;
            const x = before[0] + (here[0] - before[0]) * t;
            const z = before[1] + (here[1] - before[1]) * t;
            const gone = walked - stretch * (1 - t);
            const through = span === 0 ? 0 : gone / span;
            // A parabola, which is a catenary to anybody looking at it.
            const drop = dip * 4 * through * (1 - through);

            // Out to the side of the line, so the two cables on an arm are
            // where the arm puts them.
            const ahead = i > 0 ? before : run[Math.min(1, run.length - 1)]!;
            const lead = i > 0 ? here : run[0]!;
            const dx = lead[0] - ahead[0];
            const dz = lead[1] - ahead[1];
            const length = Math.hypot(dx, dz) || 1;
            const outX = (-dz / length) * arm.out;
            const outZ = (dx / length) * arm.out;

            points3.push([
              x + outX,
              groundAt(x + outX, z + outZ) + hang - drop,
              z + outZ,
            ]);
          }
        }
        if (points3.length >= 2) wires.push({ points: points3 });
      }
    }
  }

  return { pylons, wires };
}
