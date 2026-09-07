import { describe, expect, it } from 'vitest';
import { departures, keepRight } from './service';
import type { Point2 } from './train';

/**
 * The way a route is actually run: the way it was drawn, times the direction
 * chosen for it.
 *
 * North is -Z and east is +X, so a heading of (0, -1) is north.
 */
function running(points: readonly Point2[], direction: number): { x: number; z: number } {
  const a = points[0]!;
  const b = points[1]!;
  const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return { x: ((b[0] - a[0]) / span) * direction, z: ((b[1] - a[1]) / span) * direction };
}

/** A pair of tracks three metres apart, both drawn from north to south. */
const WEST: Point2[] = [
  [0, 100],
  [0, -100],
];
const EAST: Point2[] = [
  [3, 100],
  [3, -100],
];

describe('which way a tramway runs', () => {
  it('runs each track so the other one is on its left', () => {
    // Hungary drives on the right, so oncoming traffic is to the left. On a
    // pair of tracks running north and south, that puts the northbound one
    // on the east -- exactly as a car going north sits in the right-hand
    // lane, which is the eastern one.
    const [west, east] = keepRight([WEST, EAST]) as [
      ReturnType<typeof keepRight>[0],
      ReturnType<typeof keepRight>[0],
    ];

    expect(running(WEST, west.direction).z).toBeCloseTo(1, 6); // south
    expect(running(EAST, east.direction).z).toBeCloseTo(-1, 6); // north
    expect(west.paired && east.paired).toBe(true);
  });

  it('gives the same answer whichever way the map drew them', () => {
    // The whole reason this exists. The order a way's points are written in
    // is a fact about whoever traced it into OpenStreetMap, and the thing it
    // replaced -- every other route, alternating -- was reading that order as
    // though it meant something. Measured over the real map, sixty-nine of a
    // hundred and thirty-nine parallel pairs came out running the same way.
    const drawnBackwards: Point2[] = [...EAST].reverse();
    const [west, east] = keepRight([WEST, drawnBackwards]) as [
      ReturnType<typeof keepRight>[0],
      ReturnType<typeof keepRight>[0],
    ];

    // Same two physical directions as above, from the opposite drawing.
    expect(running(WEST, west.direction).z).toBeCloseTo(1, 6);
    expect(running(drawnBackwards, east.direction).z).toBeCloseTo(-1, 6);
  });

  it('never sends a pair of tracks the same way, whichever way round it is asked', () => {
    // The bug as the player meets it: two trams abreast on separate tracks
    // going the same direction down one street. Both orderings, because a
    // rule that depended on which was considered first would be the old one
    // wearing a different hat.
    for (const order of [
      [WEST, EAST],
      [EAST, WEST],
    ]) {
      const hands = keepRight(order);
      const a = running(order[0]!, hands[0]!.direction);
      const b = running(order[1]!, hands[1]!.direction);
      expect(a.x * b.x + a.z * b.z, 'nose to nose, not abreast').toBeLessThan(0);
    }
  });

  it('takes no notice of a route running over the same rails', () => {
    // Routes are allowed to overlap -- trams share track, which is what trams
    // do -- so a route's nearest parallel neighbour is very often itself
    // under another name, at nought metres away. On the real map that is the
    // biggest group of all: 6847 samples within a metre against 3225 in the
    // band where the genuine pairs are. Counted, it would be asking which
    // side of a line the line is on.
    const same: Point2[] = WEST.map((point) => [...point] as Point2);
    const [first, second] = keepRight([WEST, same]) as [
      ReturnType<typeof keepRight>[0],
      ReturnType<typeof keepRight>[0],
    ];
    expect(first.paired).toBe(false);
    expect(second.paired).toBe(false);
  });

  it('takes no notice of a line in the next street', () => {
    const far: Point2[] = [
      [40, 100],
      [40, -100],
    ];
    expect(keepRight([WEST, far])[0]!.paired).toBe(false);
  });

  it('takes no notice of a line crossing it', () => {
    // It has to be the other track of this line, not another line passing
    // through. A crossing one is beside it for a few metres at the junction
    // and says nothing about which side of anything to run on.
    const across: Point2[] = [
      [-100, 3],
      [100, 3],
    ];
    expect(keepRight([WEST, across])[0]!.paired).toBe(false);
  });

  it('takes no notice of the next stretch of its own line', () => {
    // The condition that was worth more than all the others together, and
    // the one that is easy to leave out. A line in the map is not one way,
    // it is a chain of them joined end to end -- and where two of them meet,
    // a point on the first is a few metres from a point on the second and
    // the two run in exactly the same direction, because they are the same
    // line. That is "parallel" and "nearby" and it is not a pair of tracks.
    //
    // Left in, every junction on the network voted, for the line's own
    // continuation, on whichever side the node happened to fall. So a
    // neighbour has to be abeam: off to the side, not up the bow.
    const carriesOn: Point2[] = [
      [0, -100],
      [0, -300],
    ];
    expect(keepRight([WEST, carriesOn])[0]!.paired).toBe(false);

    // And where a line carries on round a slight bend -- which is where the
    // two are near each other *and* parallel, rather than merely joined.
    const bends: Point2[] = [
      [0, -100],
      [-4, -300],
    ];
    expect(keepRight([WEST, bends])[0]!.paired).toBe(false);
  });

  it('looks often enough to see a track three metres away', () => {
    // Which sounds like nothing to claim and is the whole of a bug. A look
    // is matched against the looks taken along the other tracks, so the
    // nearest one is up to half a step away *along* the line, while the
    // tracks of a pair are three metres apart *across* it. Step too coarsely
    // and every candidate is up the bow rather than abeam, the rule above
    // throws it out, and a pair of plain double track records not one vote.
    //
    // Two and a half kilometres of it, on the real map, which is the two
    // longest tram tracks in the city seeing nothing of each other.
    const long: Point2[] = [
      [0, 1200],
      [0, -1200],
    ];
    const beside: Point2[] = [
      [3, 1200],
      [3, -1200],
    ];
    const [west, east] = keepRight([long, beside]) as [
      ReturnType<typeof keepRight>[0],
      ReturnType<typeof keepRight>[0],
    ];
    expect(west.paired && east.paired, 'they saw each other').toBe(true);
    expect(running(long, west.direction).z).toBeCloseTo(1, 6);
    expect(running(beside, east.direction).z).toBeCloseTo(-1, 6);
  });

  it('is decided by the track alongside, not by the one beyond it', () => {
    // A boulevard carrying two lines is four tracks in a row. The second
    // one's partner is the first, three metres off; the third and fourth are
    // another line's business, and letting them vote is letting a stranger
    // decide which side of the road you drive on.
    const lane = (x: number): Point2[] => [
      [x, 200],
      [x, -200],
    ];
    const hands = keepRight([lane(0), lane(3), lane(9), lane(12)]);
    // Two pairs, each nose to nose: (0, 3) and (9, 12).
    expect(hands[0]!.direction).not.toBe(hands[1]!.direction);
    expect(hands[2]!.direction).not.toBe(hands[3]!.direction);
  });

  it('leaves a single track the way it was drawn, and says there was nothing to go on', () => {
    // A line with no partner has no wrong side to be on. The flag is the
    // point: "decided" and "nothing to decide" are different answers, and a
    // caller that could not tell them apart would have no way of knowing
    // whether any of this had worked.
    const [only] = keepRight([WEST]) as [ReturnType<typeof keepRight>[0]];
    expect(only.paired).toBe(false);
    expect(only.direction).toBe(1);
  });

  it('decides on the length of the pairing, not on one stretch of it', () => {
    // A traced route is many ways end to end and only part of it need be
    // paired: double down a boulevard, single across a square, double again
    // after. So it is a vote over the whole length. Here the partner runs
    // beside the west track for its first thirty metres on the wrong side and
    // for the remaining hundred and seventy on the right one, and the long
    // stretch wins.
    const mostly: Point2[] = [
      [-3, 100],
      [-3, 70],
      [3, 69],
      [3, -100],
    ];
    const [west] = keepRight([WEST, mostly]) as [ReturnType<typeof keepRight>[0]];
    expect(running(WEST, west.direction).z).toBeCloseTo(1, 6);
  });
});

describe('how many trams on a route, and where', () => {
  it('spaces them evenly round the route, so the wrap keeps the interval', () => {
    // Round, not along. A recycling tram leaves the far end and rejoins at
    // the near one, so the route is a ring: spaced along it instead -- so
    // many metres apart from the start with the remainder left at the end --
    // the gap across the wrap would be the odd one out, and a player standing
    // in the wrong place would wait twice as long once every circuit.
    // A route the interval does *not* divide, which is the only kind that
    // tells the two rules apart: over a band of exactly three intervals they
    // agree, and a test written on one of those passes either way. Here the
    // band is a thousand and the interval three hundred, so spacing them
    // along leaves four hundred across the wrap against three hundred
    // everywhere else -- a player at the wrong place waiting a third longer,
    // once every circuit.
    const at = departures(1100, 100, 300);
    expect(at).toHaveLength(3);

    const band = 1100 - 100;
    const gaps = at.map((along, i) => {
      const next = at[i + 1];
      return next === undefined ? band - (along - at[0]!) : next - along;
    });
    for (const gap of gaps) expect(gap).toBeCloseTo(band / at.length, 6);
  });

  it('starts far enough up the line for the whole rake to be on it', () => {
    // `layOutTrain` refuses a rake that will not fit, and a refused rake is
    // a tram that is not there at all.
    expect(departures(1100, 100, 300)[0]).toBe(100);
  });

  it('still puts one on a route too short for the interval', () => {
    // A branch with a tram every ten minutes is quiet. A branch with no tram
    // at all is closed, and the map does not say which lines are closed.
    expect(departures(400, 100, 5000)).toHaveLength(1);
  });

  it('puts none at all on a route too short for the rake', () => {
    expect(departures(80, 100, 300)).toEqual([]);
  });
});
