import { describe, expect, it } from 'vitest';
import { onPanel } from './minimap';

/** A panel 100 across, showing 200 m each way. */
const MIDDLE = 50;
const SCALE = MIDDLE / 200;
const here = { x: 0, z: 0 };

describe('turning the ground onto the panel', () => {
  it('puts what is in front of the bird at the top', () => {
    // The whole reason the map turns. North-up would make the player do the
    // rotation in their head at the moment they are also flying.
    //
    // Facing nought is -Z, so a hundred metres ahead is z = -100.
    const ahead = onPanel(here, 0, { x: 0, z: -100 }, MIDDLE, SCALE);
    expect(ahead.x).toBeCloseTo(MIDDLE, 6);
    expect(ahead.y).toBeLessThan(MIDDLE);
  });

  it('puts what is on the bird’s right on the right', () => {
    // The other half, and the one that would go unnoticed: a map mirrored
    // left to right still looks like a map.
    const right = onPanel(here, 0, { x: 100, z: 0 }, MIDDLE, SCALE);
    expect(right.x).toBeGreaterThan(MIDDLE);
    expect(right.y).toBeCloseTo(MIDDLE, 6);
  });

  it('turns with the bird', () => {
    // Flying east, the thing that was on the right is now straight ahead.
    const east = Math.PI / 2;
    const spot = onPanel(here, east, { x: 100, z: 0 }, MIDDLE, SCALE);
    expect(spot.x).toBeCloseTo(MIDDLE, 6);
    expect(spot.y).toBeLessThan(MIDDLE);
  });

  it('keeps the scale honest in both directions', () => {
    // A hundred metres out is a quarter of the panel, whichever way it lies.
    const ahead = onPanel(here, 0, { x: 0, z: -100 }, MIDDLE, SCALE);
    const right = onPanel(here, 0, { x: 100, z: 0 }, MIDDLE, SCALE);
    expect(MIDDLE - ahead.y).toBeCloseTo(right.x - MIDDLE, 6);
    expect(right.x - MIDDLE).toBeCloseTo(100 * SCALE, 6);
  });
});

/**
 * Enough of a canvas to see what was drawn.
 *
 * Every dot on this panel is an `arc` filled in a colour, so recording the
 * arcs with the colour that was standing at the time is the whole of what a
 * test here needs. The rest is stubs that do nothing on purpose.
 */
function fakeCanvas(): { dots: { x: number; y: number; r: number; colour: string }[] } {
  const dots: { x: number; y: number; r: number; colour: string }[] = [];
  let pending: { x: number; y: number; r: number } | null = null;
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineCap: '',
    setTransform() {},
    clearRect() {},
    save() {},
    restore() {},
    clip() {},
    beginPath() {
      pending = null;
    },
    arc(x: number, y: number, r: number) {
      pending = { x, y, r };
    },
    fill() {
      if (pending) dots.push({ ...pending, colour: String(ctx.fillStyle) });
    },
    stroke() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    translate() {},
    rotate() {},
  };
  const canvas = {
    className: '',
    width: 0,
    height: 0,
    getContext: () => ctx,
    remove() {},
  };
  const globals = globalThis as unknown as Record<string, unknown>;
  globals['document'] = { createElement: () => canvas };
  globals['window'] = { devicePixelRatio: 1 };
  return { dots };
}

const CROW_YELLOW = '#ffe14a';

/** A view with nothing in it, for a test to put one thing back. */
const nothing = {
  at: { x: 0, z: 0 },
  heading: 0,
  target: null,
  mark: null,
  crows: [],
  flock: [],
  her: null,
  now: 0,
  line: null,
};

describe('the crows on the panel', () => {
  it('draws one where it is', async () => {
    const { dots } = fakeCanvas();
    const { createMinimap } = await import('./minimap');
    const map = createMinimap({ appendChild() {} } as unknown as HTMLElement, []);
    // `now` on a lit phase: the blink is 3 a second, so the first sixth of a
    // second is on.
    map.update({ ...nothing, crows: [{ x: 0, z: -100 }], now: 0.05 });
    const crows = dots.filter((dot) => dot.colour === CROW_YELLOW);
    expect(crows).toHaveLength(1);
    // A hundred metres ahead is straight up the panel from the middle, and
    // the middle of a 296-pixel panel is 148.
    expect(crows[0]!.x).toBeCloseTo(148, 6);
    expect(crows[0]!.y).toBeLessThan(148);
  });

  it('goes dark for half of every blink', async () => {
    // Which is the point of them: a steady dot is scenery, and the map is
    // full of steady dots already.
    const { dots } = fakeCanvas();
    const { createMinimap } = await import('./minimap');
    const map = createMinimap({ appendChild() {} } as unknown as HTMLElement, []);
    const lit = [];
    for (let i = 0; i < 12; i += 1) {
      dots.length = 0;
      map.update({ ...nothing, crows: [{ x: 0, z: -100 }], now: i / 6 });
      lit.push(dots.some((dot) => dot.colour === CROW_YELLOW));
    }
    expect(lit.filter(Boolean)).toHaveLength(6);
    expect(lit.filter((on) => !on)).toHaveLength(6);
  });

  it('leaves off a crow that is not on the panel', async () => {
    // Held at the rim it would read as somewhere to go, which is what the
    // target arrow means and the opposite of what a crow means.
    const { dots } = fakeCanvas();
    const { createMinimap } = await import('./minimap');
    const map = createMinimap({ appendChild() {} } as unknown as HTMLElement, []);
    map.update({ ...nothing, crows: [{ x: 0, z: -5000 }], now: 0.05 });
    expect(dots.filter((dot) => dot.colour === CROW_YELLOW)).toHaveLength(0);
  });
});

describe('the flock on the panel', () => {
  it('draws the others green and her pink', async () => {
    // Two colours because the levels she is out on are about finding her,
    // and a dozen identical dots is the problem rather than the answer.
    const { dots } = fakeCanvas();
    const { createMinimap } = await import('./minimap');
    const map = createMinimap({ appendChild() {} } as unknown as HTMLElement, []);
    map.update({
      ...nothing,
      flock: [{ x: 0, z: -100 }, { x: 40, z: -20 }],
      her: { x: -30, z: -60 },
    });
    expect(dots.filter((dot) => dot.colour === '#5cd68a')).toHaveLength(2);
    const hers = dots.filter((dot) => dot.colour === '#ef9ab8');
    expect(hers).toHaveLength(1);
    // Bigger than the rest of them, so she is the one the eye lands on.
    const others = dots.filter((dot) => dot.colour === '#5cd68a');
    expect(hers[0]!.r).toBeGreaterThan(others[0]!.r);
  });

  it('does not blink them', async () => {
    // Unlike the crows. Company is not a warning, and a panel where
    // everything flashes says nothing about which of it matters.
    const { dots } = fakeCanvas();
    const { createMinimap } = await import('./minimap');
    const map = createMinimap({ appendChild() {} } as unknown as HTMLElement, []);
    for (let i = 0; i < 6; i += 1) {
      dots.length = 0;
      map.update({ ...nothing, flock: [{ x: 0, z: -100 }], now: i / 6 });
      expect(dots.filter((dot) => dot.colour === '#5cd68a')).toHaveLength(1);
    }
  });

  it('leaves off whoever is past the rim', async () => {
    const { dots } = fakeCanvas();
    const { createMinimap } = await import('./minimap');
    const map = createMinimap({ appendChild() {} } as unknown as HTMLElement, []);
    map.update({ ...nothing, flock: [{ x: 0, z: -5000 }], her: { x: 5000, z: 0 } });
    expect(dots.filter((dot) => dot.colour === '#5cd68a')).toHaveLength(0);
    expect(dots.filter((dot) => dot.colour === '#ef9ab8')).toHaveLength(0);
  });
});
