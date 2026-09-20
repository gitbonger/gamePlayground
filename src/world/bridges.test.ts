import { describe, expect, it } from 'vitest';
import { APRON, CLEARANCE, DECK, deckOf, type Bridge } from './bridges';

/**
 * Kerepesi út over the throat of Keleti station, near enough: eighty-five
 * metres of three-lane primary road on layer one, as two points, which is
 * exactly how the map has it.
 */
const kerepesi: Bridge = { kind: 'primary', width: 16, points: [[0, 0], [85, 0]], layer: 1 };

const spine = (bridge: Bridge) => deckOf(bridge)!.spine;
const highest = (bridge: Bridge) => Math.max(...spine(bridge).map(([, , y]) => y));

describe('a road carried over something', () => {
  it('leaves room underneath for the thing it crosses', () => {
    // The whole reason for the feature. Four running lines pass under
    // Kerepesi út, and a deck that does not clear them is a road painted
    // across a railway with trains sliding through it.
    expect(highest(kerepesi) - DECK).toBeGreaterThanOrEqual(CLEARANCE);
  });

  it('comes down to meet the road at both ends', () => {
    // The map records the span and nothing else, so a deck that is only the
    // span is a slab six metres up with a cliff at each end. Both ends have
    // to arrive at the ground the approach is painted on.
    const deck = spine(kerepesi);
    expect(deck[0]![2]).toBeLessThan(0.1);
    expect(deck[deck.length - 1]![2]).toBeLessThan(0.1);
  });

  it('runs the ramps out past the span rather than up it', () => {
    // Which is what the apron is for. Kept inside the span, the deck would be
    // at its steepest at mid-span -- directly over the tracks, which is the
    // one place it wants to be flat and high.
    const xs = spine(kerepesi).map(([x]) => x);
    expect(Math.min(...xs)).toBeLessThanOrEqual(-APRON.least);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(85 + APRON.least);

    // And the top of the hump is over the span, not over the approach.
    const top = spine(kerepesi).reduce((a, b) => (b[2] > a[2] ? b : a));
    expect(top[0]).toBeGreaterThan(0);
    expect(top[0]).toBeLessThan(85);
  });

  it('climbs at something a road could climb at', () => {
    // The number the apron is bought with. Without one, this span would have
    // to gain seven metres in forty-two, and a one-in-six road reads as a
    // ramp into a car park rather than as a bridge.
    let steepest = 0;
    const deck = spine(kerepesi);
    for (let i = 1; i < deck.length; i += 1) {
      const a = deck[i - 1]!;
      const b = deck[i]!;
      steepest = Math.max(steepest, Math.abs(b[2] - a[2]) / Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    expect(steepest).toBeLessThan(0.16);
  });

  it('is cut finely enough to be a curve rather than a wedge', () => {
    // The deck is drawn as flat pieces and boxed as flat pieces, and the
    // height along it is a curve. Long pieces are a visible fold in the road
    // and a collider that stands proud of what is drawn.
    const deck = spine(kerepesi);
    expect(deck.length).toBeGreaterThan(12);
    for (let i = 1; i < deck.length; i += 1) {
      const a = deck[i - 1]!;
      const b = deck[i]!;
      expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeLessThan(9);
    }
  });

  it('follows the bends the map gave it', () => {
    // A deck straightened between its ends would leave the carriageway it is
    // carrying, and the approaches would meet it at an angle.
    const bent: Bridge = {
      ...kerepesi,
      points: [[0, 0], [40, 30], [85, 0]],
    };
    const middle = spine(bent).reduce((a, b) => (Math.abs(b[0] - 40) < Math.abs(a[0] - 40) ? b : a));
    expect(middle[1]).toBeGreaterThan(20);
  });

  it('puts a bridge over a bridge higher than the one under it', () => {
    // `layer` is the only thing the map says about height, and two decks at
    // the same height where one crosses the other is the flat-ground problem
    // again, one storey up.
    expect(highest({ ...kerepesi, layer: 2 })).toBeGreaterThan(highest(kerepesi) + CLEARANCE * 0.9);
  });

  it('makes nothing of a raised plaza', () => {
    // The map files the deck outside Keleti as a closed way tagged
    // `highway=pedestrian`, `bridge=yes`, `area=yes`. It is a floor, not a
    // road with two ends, and run through here it would come out as a ribbon
    // going nowhere and back.
    expect(deckOf({ ...kerepesi, points: [[0, 0], [20, 0], [20, 20], [0, 0]] })).toBeNull();
  });

  it('makes nothing of a span too short to ramp', () => {
    expect(deckOf({ ...kerepesi, points: [[0, 0]] })).toBeNull();
  });
});

describe('a railway carried over a river', () => {
  /** Seven hundred metres of it, which is what the Danube takes. */
  const crossing = (points: [number, number][] = [[0, 0], [700, 0]]) => ({
    kind: 'rail',
    width: 8,
    points,
    layer: 1,
    rail: true,
  });

  it('keeps the span over the water level', () => {
    const deck = deckOf(crossing())!;
    // The middle four hundred metres of a seven hundred metre crossing is
    // within a few centimetres of flat: the climb belongs on the bank.
    const middle = deck.spine.filter((point) => point[0] > 150 && point[0] < 550);
    const ys = middle.map((point) => point[2]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.3);
  });

  it('stands high enough to clear the shipping', () => {
    const deck = deckOf(crossing())!;
    const high = Math.max(...deck.spine.map((point) => point[2]));
    // Eleven metres over the water, where a road flyover has six over the
    // road: a barge is not a lorry.
    expect(high).toBeGreaterThan(11);
    expect(high).toBeLessThan(13);
  });

  it('climbs at a grade a train could take', () => {
    const deck = deckOf(crossing())!;
    let steepest = 0;
    for (let i = 1; i < deck.spine.length; i += 1) {
      const a = deck.spine[i - 1]!;
      const b = deck.spine[i]!;
      const run = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (run > 0) steepest = Math.max(steepest, Math.abs(b[2] - a[2]) / run);
    }
    // One in fifteen at its steepest, against a road's one in seven. Not a
    // grade any railway would build -- it is three hundred metres of
    // embankment doing the work of a kilometre -- but the shape is the thing
    // that reads: level over the water, climbing only on the bank.
    expect(steepest).toBeLessThan(0.07);
  });

  it('is still a flyover when it is short', () => {
    // A twenty metre rail bridge over a street is not a river crossing, and
    // building it eleven metres up with three hundred metres of embankment
    // either side would bury the streets it lands between.
    const deck = deckOf({ ...crossing([[0, 0], [20, 0]]) })!;
    const high = Math.max(...deck.spine.map((point) => point[2]));
    expect(high).toBeLessThan(8);
  });
});
