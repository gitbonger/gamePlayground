import { describe, expect, it } from 'vitest';
import { createAmbience, type Kit, type Noise, type Source } from './ambience';

const listening = () => {
  const played: { noise: Noise; level: number; pan: number }[] = [];
  const kit: Kit = { play: (noise, level, pan) => played.push({ noise, level, pan }), close: () => {} };
  return { kit, played };
};

const here = { x: 0, y: 0, z: 0 };
/** Always takes the chance, so a test is about the rule and not about a seed. */
const always = () => 0;

describe('the city making its own noises', () => {
  it('says nothing when there is nothing there', () => {
    // Which is the whole claim: these are about real things. A bark with no
    // dog is atmosphere, and atmosphere that lies is worse than silence.
    const { kit, played } = listening();
    createAmbience(kit, always).hear(0, here, 0, []);
    expect(played).toEqual([]);
  });

  it('says nothing about something too far off to hear', () => {
    const { kit, played } = listening();
    createAmbience(kit, always).hear(0, here, 0, [{ noise: 'coo', x: 400, y: 0, z: 0 }]);
    expect(played).toEqual([]);
  });

  it('does not fill the air', () => {
    // Five kinds with five independent timers will line up sooner or later,
    // and when they do a quiet district becomes a farmyard. Offered every
    // frame for two minutes with one of everything standing next to him.
    const { kit, played } = listening();
    // A seeded draw rather than `always`: the chances are half the pacing,
    // and a test that always takes them is a test of the other half.
    let seed = 0.371;
    const ambience = createAmbience(kit, () => (seed = (seed * 9301.317 + 0.49297) % 1));
    const all: Source[] = [
      { noise: 'bark', x: 8, y: 0, z: 0 },
      { noise: 'coo', x: 6, y: 0, z: 0 },
      { noise: 'caw', x: 10, y: 0, z: 0 },
      { noise: 'bell', x: 20, y: 0, z: 0 },
      { noise: 'screech', x: 30, y: 0, z: 0 },
    ];
    for (let frame = 0; frame < 120 * 60; frame += 1) ambience.hear(frame / 60, here, 0, all);
    // Two minutes at one every two and a half seconds is forty-eight at the
    // very most; the cooldowns and the chances hold it well under that.
    // Measured here: about one every five seconds, with everything in the
    // game standing next to him, which is as loud as this ever gets.
    expect(played.length).toBeLessThan(32);
    expect(played.length).toBeGreaterThan(8);
    // And never two in the same breath.
    expect(new Set(played.map((each) => each.noise)).size).toBeGreaterThan(3);
  });

  it('puts a sound on the side it came from', () => {
    // Facing nought is -Z, so something at +X is on the bird's right hand --
    // the same convention the minimap turns the world with.
    const { kit, played } = listening();
    createAmbience(kit, always).hear(0, here, 0, [{ noise: 'bark', x: 20, y: 0, z: 0 }]);
    expect(played[0]!.pan).toBeCloseTo(1, 3);

    const other = listening();
    createAmbience(other.kit, always).hear(0, here, 0, [{ noise: 'bark', x: -20, y: 0, z: 0 }]);
    expect(other.played[0]!.pan).toBeCloseTo(-1, 3);
  });

  it('turns the sound with the bird', () => {
    // Flying east, the dog that was on the right is now straight ahead, and
    // straight ahead is neither side.
    const { kit, played } = listening();
    createAmbience(kit, always).hear(0, here, Math.PI / 2, [{ noise: 'bark', x: 20, y: 0, z: 0 }]);
    expect(played[0]!.pan).toBeCloseTo(0, 3);
  });

  it('is quieter further away', () => {
    const close = listening();
    createAmbience(close.kit, always).hear(0, here, 0, [{ noise: 'bark', x: 5, y: 0, z: 0 }]);
    const far = listening();
    createAmbience(far.kit, always).hear(0, here, 0, [{ noise: 'bark', x: 60, y: 0, z: 0 }]);
    expect(close.played[0]!.level).toBeGreaterThan(far.played[0]!.level);
  });

  it('takes the nearest of a kind, which is the one that would be heard', () => {
    const { kit, played } = listening();
    createAmbience(kit, always).hear(0, here, 0, [
      { noise: 'bark', x: 60, y: 0, z: 0 },
      { noise: 'bark', x: -6, y: 0, z: 0 },
    ]);
    expect(played[0]!.pan).toBeLessThan(0);
  });

  it('does not spend a kind’s chance on nothing', () => {
    // The roll comes after the search. Rolled before it, a level with no
    // crows in it would burn the caw's chance every few seconds and the
    // bark would never get a look in.
    let rolls = 0;
    const { kit } = listening();
    const ambience = createAmbience(kit, () => {
      rolls += 1;
      return 0;
    });
    ambience.hear(0, here, 0, []);
    expect(rolls).toBe(0);
  });
});

describe('how far away counts', () => {
  it('counts the height', () => {
    // The bug this replaced: measured flat, a dog on the pavement was beside
    // you the whole time you were a hundred metres over its head -- and this
    // game is flown at between twenty and a hundred and fifty, so nearly
    // every sound came from something that was not close at all.
    const { kit, played } = listening();
    createAmbience(kit, always).hear(0, { x: 0, y: 200, z: 0 }, 0, [
      { noise: 'bark', x: 0, y: 0, z: 0 },
    ]);
    expect(played).toEqual([]);
  });

  it('gets louder as the bird comes down', () => {
    // Which is both true and the best free bit of feedback in the game: a
    // pigeon a hundred metres up hears the city faintly and one at ten metres
    // is in it.
    const heights = [80, 40, 10].map((y) => {
      const { kit, played } = listening();
      createAmbience(kit, always).hear(0, { x: 0, y, z: 0 }, 0, [
        { noise: 'bark', x: 0, y: 0, z: 0 },
      ]);
      return played[0]!.level;
    });
    expect(heights[0]!).toBeLessThan(heights[1]!);
    expect(heights[1]!).toBeLessThan(heights[2]!);
  });

  it('puts something directly below in the middle', () => {
    // It is in front of neither ear, and dividing by the slant distance would
    // have put it there anyway -- but only by accident.
    const { kit, played } = listening();
    createAmbience(kit, always).hear(0, { x: 0, y: 50, z: 0 }, 0, [
      { noise: 'bark', x: 0, y: 0, z: 0 },
    ]);
    expect(played[0]!.pan).toBe(0);
  });
});
