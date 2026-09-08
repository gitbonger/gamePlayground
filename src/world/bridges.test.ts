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
