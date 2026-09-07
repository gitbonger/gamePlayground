/**
 * Which way a tramway runs, and how many trams are on it.
 *
 * Two questions the map cannot answer on its own. A `Rail` is a bare
 * polyline, and the order its points are written in is a fact about the
 * person who traced it into OpenStreetMap rather than about the direction
 * traffic goes: one track of a pair is as likely to be drawn north-to-south
 * as south-to-north. Something has to decide, and until this it was the
 * index in a list -- every other route, alternating -- which is not related
 * to the geometry at all. Measured over the real map, sixty-nine of the
 * hundred and thirty-nine pairs of parallel routes came out running the same
 * way. A coin toss, and the player sees it as two trams abreast on separate
 * tracks going the same direction down the same street.
 *
 * So it is decided from the ground instead: Hungary drives on the right, so
 * the other track of a pair is on your *left*, and a route is run in whatever
 * direction puts it there.
 */

import { lineLength, pointAlong, type Point2 } from './train';

/**
 * How often to look along a track, in metres.
 *
 * It is a vote over the whole length rather than a measurement at one point,
 * because only part of a line need be paired: it can be double track down a
 * boulevard, single through a square, and double again after it.
 *
 * Two metres, which is finer than it looks like it needs to be and has to be.
 * A look is compared against the looks taken along the other tracks, so the
 * nearest one to it is up to half a step away *along* the line -- and the
 * tracks of a pair are only three metres apart across it. At a step of
 * fifteen that puts the nearest look on the neighbouring track seven and a
 * half metres up the line and three across, which is not abeam by any
 * measure, and ABREAST threw it out: the two longest tracks on this map,
 * two and two and a half kilometres of plain double track, recorded not one
 * vote between them. At two metres the worst case is a metre up the line
 * against three across, which is abeam.
 */
const SAMPLE = 2;

/**
 * Nearer than this is the same rails, not the next track along.
 *
 * Routes are allowed to overlap -- they share track, which is what trams do
 * -- so a route's nearest neighbour is very often *itself under another
 * name*, at nought metres. On the real map that is the largest group by far:
 * 6847 samples within a metre, against 3225 in the two-to-six band where the
 * genuine pairs are. Counting the overlaps would be asking which side of a
 * line the line is on.
 */
const LEAST = 2;

/**
 * And further than this is a different street, not the other track.
 *
 * Nine, from the same measurement: the pairs run out at about six metres and
 * what is beyond nine is another line altogether, whose handedness is its own
 * business.
 */
const MOST = 9;

/** How nearly parallel two bits of track have to be to be a pair. */
const PARALLEL = 0.9;

/**
 * And how nearly *abreast*, as the cosine of the angle off the beam.
 *
 * The condition that was missing, and it was worth more than all the others
 * together. Parallel and a few metres apart is also true of two ways of the
 * same line meeting end to end: near the node they share, a sample on one is
 * within a few metres of a sample on the other and the two run in exactly the
 * same direction, because they are the same line. Counted as a pair, every
 * junction on the network voted -- for the line's own continuation, always on
 * whichever side the node happened to fall.
 *
 * A track alongside is off the beam. A track ahead is up the bow. So the
 * offset to the neighbour has to be square to the way we are pointing: this
 * allows about twenty degrees either side of abeam.
 */
const ABREAST = 0.35;

export interface Handed {
  /** +1 to run the route up as drawn, -1 to run it down. */
  direction: number;
  /**
   * Whether a neighbouring track actually decided it.
   *
   * False for a single-track line, which has no wrong side to be on -- it
   * gets the direction it was drawn in, and the flag is here so that a caller
   * (or a test) can tell "decided" from "nothing to decide".
   */
  paired: boolean;
}

interface Look {
  route: number;
  x: number;
  z: number;
  /** The way the route points here, as drawn. */
  dx: number;
  dz: number;
}

/**
 * Pick a direction for each route, so that traffic keeps right.
 *
 * Each route is decided by where its neighbours *are*, never by which way
 * they were decided to run. That is what keeps this from being circular:
 * there is no order to do them in, no pass to repeat, and two tracks of a
 * pair cannot both choose the same way, because each sees the other on the
 * opposite side of itself.
 */
export function keepRight(routes: readonly (readonly Point2[])[]): Handed[] {
  const looks: Look[] = [];
  routes.forEach((points, route) => {
    if (points.length < 2) return;
    const run = lineLength(points);
    for (let along = 0; along <= run; along += SAMPLE) {
      const here = pointAlong(points, along);
      const ahead = pointAlong(points, Math.min(along + 1, run));
      if (!here || !ahead) continue;
      const dx = ahead.x - here.x;
      const dz = ahead.z - here.z;
      const span = Math.hypot(dx, dz);
      if (span < 1e-6) continue;
      looks.push({ route, x: here.x, z: here.z, dx: dx / span, dz: dz / span });
    }
  });

  // Bucketed by the furthest distance that counts, so a look only has to be
  // compared with the nine cells around it rather than with all eight
  // thousand of them.
  const cells = new Map<string, Look[]>();
  const key = (x: number, z: number) => `${Math.floor(x / MOST)},${Math.floor(z / MOST)}`;
  for (const look of looks) {
    const cell = cells.get(key(look.x, look.z));
    if (cell) cell.push(look);
    else cells.set(key(look.x, look.z), [look]);
  }

  const votes = routes.map(() => ({ left: 0, right: 0 }));
  for (const look of looks) {
    const vote = votes[look.route]!;
    // The nearest one abreast, and only that one. A track's partner is the
    // track next to it; the one beyond that belongs to another pair, and on
    // a boulevard carrying two lines -- four tracks in a row -- letting the
    // far pair vote is letting a stranger decide which side of the road you
    // drive on. It can outvote the partner, and it did.
    let nearest: { gap: number; side: number } | null = null;
    for (let cx = -MOST; cx <= MOST; cx += MOST) {
      for (let cz = -MOST; cz <= MOST; cz += MOST) {
        for (const other of cells.get(key(look.x + cx, look.z + cz)) ?? []) {
          if (other.route === look.route) continue;
          const ax = other.x - look.x;
          const az = other.z - look.z;
          const gap = Math.hypot(ax, az);
          if (gap < LEAST || gap > MOST) continue;
          // Parallel either way round. Which way the neighbour runs is not
          // asked, only where it lies -- see above.
          if (Math.abs(look.dx * other.dx + look.dz * other.dz) < PARALLEL) continue;
          // Beside it, not in front of it -- see ABREAST.
          if (Math.abs((ax * look.dx + az * look.dz) / gap) > ABREAST) continue;
          if (nearest && nearest.gap <= gap) continue;

          // Left of the way this route is drawn. North is -Z and east is +X,
          // so the left of a heading (dx, dz) is (dz, -dx): facing north,
          // (0,-1), that is (-1, 0), which is west.
          nearest = { gap, side: ax * look.dz - az * look.dx };
        }
      }
    }
    if (!nearest) continue;
    if (nearest.side > 0) vote.left += 1;
    else vote.right += 1;
  }

  return votes.map(({ left, right }) => ({
    // Drawn direction already keeps the neighbour on the left, or it does
    // not and the route is run the other way. A tie is nothing to go on and
    // takes the line as drawn, which is also what an unpaired line gets.
    direction: left >= right ? 1 : -1,
    paired: left + right > 0,
  }));
}

/**
 * Where along a route to put the trams, so they come at a steady interval.
 *
 * Evenly spaced *around* the route rather than along it, which is the whole
 * reason a recycling tram works as a service: they all run at one speed and
 * one wraps from the far end to the near one, so an even ring stays an even
 * ring for ever. Spaced along it instead -- so many metres apart from the
 * start, with whatever is left over at the end -- the gap across the wrap
 * would be the odd one out, and a player standing at the right place would
 * wait twice as long once every circuit.
 *
 * The first is at `consist`, which is as far up the line as a rake can stand
 * with all of it on the rails.
 */
export function departures(run: number, consist: number, spacing: number): number[] {
  const band = run - consist;
  if (band <= 0 || spacing <= 0) return [];
  // At least one: a route too short for the interval still gets a tram, or a
  // branch line reads as abandoned rather than as quiet.
  const many = Math.max(1, Math.round(band / spacing));
  return Array.from({ length: many }, (_, i) => consist + (band / many) * i);
}
