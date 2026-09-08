/**
 * Roads that go over something, given the height that makes them worth having.
 *
 * A flyover is the one place in this district where the flat ground is
 * plainly a lie: Kerepesi út crosses the throat of Keleti station on a bridge,
 * and drawn on the ground it is a road painted across four running lines with
 * trains sliding through it. What is wanted is not terrain -- there is none
 * here worth having, this is the flat Pest side -- it is the gap under the
 * deck, so a pigeon can go over the bridge or under it and see that they are
 * different.
 *
 * OpenStreetMap says which ways are bridges and which storey they are on, and
 * says nothing at all about how they get up there. The approach is a separate
 * way, tagged as ordinary road, lying flat. So the span on its own is a slab
 * six metres up with a cliff at each end, and the only honest thing to do is
 * to invent the ramps: the deck runs on past each end of the span and comes
 * down to meet the road it joins. That apron lies over the approach, which is
 * what an approach ramp does.
 *
 * Both the mesh and the solid come from here, and that is the point of the
 * module. A deck drawn in one place and boxed in another is a bridge you can
 * see through or stand on thin air next to, and the two would drift apart the
 * first time either was adjusted.
 */

/** A road carried over something, as it comes off the map. */
export interface Bridge {
  /** OpenStreetMap highway class, as for a road. */
  kind: string;
  /** Carriageway width in metres. */
  width: number;
  /** Polyline of the span in local metres, [x, z] with north at -Z. */
  points: [number, number][];
  /**
   * Which storey up, from OpenStreetMap's `layer`.
   *
   * One, everywhere in this district. Kept because it is the only thing the
   * map says about height, and a bridge over a bridge would otherwise be
   * drawn at the same height as the one it crosses.
   */
  layer: number;
}

/**
 * How much room to leave under the deck, per storey, in metres.
 *
 * Six, which is about what a railway actually demands underneath and is
 * comfortably more than a pigeon needs. It is measured to the *underside*
 * rather than the road surface, because the number that matters is the one
 * you can fly through.
 */
export const CLEARANCE = 6;

/** How deep the slab is, from road surface to soffit. */
export const DECK = 0.9;

/**
 * How far the ramp may run past each end of the span, in metres.
 *
 * The span is the only part the map records, so without an apron the ramp
 * would have to fit inside the span itself -- and a hump that reaches full
 * height at mid-span is at its steepest exactly where the thing it crosses
 * passes underneath. Running out past the ends buys the grade back and puts
 * the top of the deck over the tracks, where it belongs.
 *
 * How far is worked out from the grade and the height, and then held between
 * these: twelve, because a ramp shorter than that is a step, and forty,
 * because a fifteen-metre footbridge asking for the grade of a motorway would
 * lay two hundred metres of deck across the streets either side of it to get
 * it.
 */
export const APRON = { least: 12, most: 40 };

/**
 * The steepest the ramp is allowed to climb, as a rise over a run.
 *
 * A real flyover is nearer one in twenty. This is one in eleven, and it is a
 * cheat with its eyes open: the alternative is a ramp two hundred metres long
 * at each end, ploughing across every junction it passes on the way down. At
 * the height this game is flown from, a short hump reads as a bridge and a
 * long one reads as a road.
 */
const GRADE = 0.09;

/**
 * How often to put a point along the deck, in metres.
 *
 * The height is a curve and the deck is flat pieces, so this is how many
 * pieces the curve is cut into. Six metres over a hundred-and-thirty-metre
 * bridge is twenty-odd, which is smooth from the air and is twenty-odd boxes
 * for the collider rather than a thousand.
 */
const STEP = 6;

/**
 * The least the deck ever stands above the ground, in metres.
 *
 * The ramp comes down to meet the road, and the road is a decal painted flat
 * at nought that does not write depth. Two surfaces at exactly the same
 * height is the one thing this renderer cannot settle, and it has been paid
 * for once already, as roads flickering a street at a time. Five centimetres
 * is below noticing and is not nought.
 */
const LEAST = 0.05;

/** The middle line of a deck: where it goes, and how high it is there. */
export interface Deck {
  /** `[x, z, y]` along the middle of the carriageway, y being the surface. */
  spine: [number, number, number][];
  /** Carriageway width in metres. */
  width: number;
}

/** Smooth from 0 to 1 over 0..1, flat at both ends. */
function ease(u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return u * u * (3 - 2 * u);
}

/**
 * Work out where a bridge's deck actually runs, apron and all.
 *
 * Returns null for anything there is no bridge to make of -- a span of one
 * point, or a closed ring, which is how the map files a raised plaza and is
 * not a thing with two ends.
 */
export function deckOf(bridge: Bridge): Deck | null {
  const points = bridge.points;
  if (points.length < 2) return null;

  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1) return null;

  const peak = CLEARANCE * Math.max(1, bridge.layer) + DECK;
  // How long the span itself is, which decides how much ramp it needs: the
  // grade is a rise over a run, part of the run is the span, and the apron is
  // the rest of it.
  let span = 0;
  for (let i = 1; i < points.length; i += 1) {
    span += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  }
  const apron = Math.min(APRON.most, Math.max(APRON.least, peak / GRADE - span / 2));

  // The span, run out at both ends along the direction it was going. Straight
  // continuation rather than anything cleverer: the approach to a flyover is
  // the flyover pointing the other way, and where it is not, a few tens of
  // metres is too short for the difference to show.
  const extended = [
    past(points[1]!, first, apron),
    ...points,
    past(points[points.length - 2]!, last, apron),
  ];

  // Arc length at each point, and the total, so height can be a function of
  // how far along you are rather than of which segment you are in.
  const along: number[] = [0];
  for (let i = 1; i < extended.length; i += 1) {
    const a = extended[i - 1]!;
    const b = extended[i]!;
    along.push(along[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const length = along[along.length - 1]!;
  if (length < 2 * STEP) return null;

  // How much run the ramp gets. Half the bridge at the outside: past that the
  // two ramps would be climbing through each other.
  const rise = Math.min(length / 2, peak / GRADE);
  const height = (s: number) => LEAST + (peak - LEAST) * ease(Math.min(s, length - s) / rise);

  // Cut into even pieces, so the curve is smooth wherever the map happened to
  // put its vertices -- a two-point span is one straight line and would
  // otherwise be one flat slab at whatever height its middle worked out to.
  const pieces = Math.max(2, Math.round(length / STEP));
  const spine: [number, number, number][] = [];
  for (let i = 0; i <= pieces; i += 1) {
    const s = (length * i) / pieces;
    const [x, z] = at(extended, along, s);
    spine.push([x, z, height(s)]);
  }

  return { spine, width: bridge.width };
}

/** The point `s` metres along a polyline whose arc lengths are known. */
function at(
  points: readonly [number, number][],
  along: readonly number[],
  s: number,
): [number, number] {
  let i = 1;
  while (i < along.length - 1 && along[i]! < s) i += 1;
  const a = points[i - 1]!;
  const b = points[i]!;
  const run = along[i]! - along[i - 1]!;
  const t = run < 1e-6 ? 0 : (s - along[i - 1]!) / run;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Carry on `by` metres past `to`, in the direction that got there from `from`. */
function past(from: readonly number[], to: readonly number[], by: number): [number, number] {
  const dx = to[0]! - from[0]!;
  const dz = to[1]! - from[1]!;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return [to[0]!, to[1]!];
  return [to[0]! + (dx / length) * by, to[1]! + (dz / length) * by];
}
