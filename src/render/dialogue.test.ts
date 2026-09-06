import { describe, expect, it } from 'vitest';
import { speechColour } from './dialogue';
import { HERO_MORPH, PIGEON_MORPHS, PINK_MORPH } from './bird';

/** The relative luminance of a `#rrggbb` string, the way the panel sees it. */
function luminance(colour: string): number {
  const channel = (at: number) => parseInt(colour.slice(at, at + 2), 16) / 255;
  const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(channel(1)) + 0.7152 * linear(channel(3)) + 0.0722 * linear(channel(5));
}

describe('printing a line in the colour of whoever says it', () => {
  it('leaves a colour alone when it is already light enough to read', () => {
    // The pink one is the whole reason the words are coloured at all, and she
    // is printed exactly as she looks.
    expect(speechColour(PINK_MORPH.body)).toBe('#ef9ab8');
  });

  it('lifts every bird in the game to something readable on the panel', () => {
    // Including the black one, whose own colour on a near-black card is a
    // line you cannot read. The card is dark by design, so the colours give
    // way rather than the card.
    for (const morph of [HERO_MORPH, PINK_MORPH, ...PIGEON_MORPHS]) {
      const printed = speechColour(morph.body);
      expect(luminance(printed), printed).toBeGreaterThan(0.41);
    }
  });

  it('spends the depth of a colour and keeps its hue', () => {
    // Lifted towards white rather than replaced by it: the black pigeon
    // speaks in grey, the ginger one in a pale ginger that is still warmer in
    // the red than in the blue, and neither turns into the other.
    const ginger = speechColour(0xb87a45);
    const red = parseInt(ginger.slice(1, 3), 16);
    const blue = parseInt(ginger.slice(5, 7), 16);
    expect(red - blue).toBeGreaterThan(40);

    // And no more than it takes: a lifted colour stops at readable rather
    // than going on to white.
    expect(luminance(ginger)).toBeLessThan(0.6);
  });
});
