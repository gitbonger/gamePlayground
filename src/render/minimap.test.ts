import { describe, expect, it } from 'vitest';
import { heldOnPanel, namedStops, onPanel } from './minimap';
import { shortStop } from '../world/layout';

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
  stock: [],
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

describe('naming the tram stops', () => {
  const island = (name: string, x: number, z: number) => ({
    name,
    x,
    z,
    width: 50,
    depth: 2.5,
    yaw: 0,
    height: 0.25,
    shelters: [],
  });

  it('says a stop once, however many islands it has', () => {
    // Sixty-six platforms between twenty-one names on the real map: an island
    // each side of the street, often two to a side. Written once per island
    // the panel says `Blaha Lujza tér` in a pile of overlapping text.
    const merged = namedStops([
      island('Blaha Lujza tér M', 0, 0),
      island('Blaha Lujza tér M', 14, 0),
      island('Blaha Lujza tér M', 0, 20),
    ]);
    expect(merged).toHaveLength(1);
    // At the middle of them, which for a pair either side of a street is the
    // middle of the street.
    expect(merged[0]!.x).toBeGreaterThan(0);
    expect(merged[0]!.x).toBeLessThan(14);
  });

  it('keeps two stops apart even when they share a name', () => {
    // The risk of merging by name at all. Nothing in this district is like
    // this, and the rule should still not fuse a kilometre.
    expect(namedStops([island('Mester utca', 0, 0), island('Mester utca', 900, 0)])).toHaveLength(2);
  });

  it('leaves the unnamed ones off entirely', () => {
    // A third of the islands are a kerb somebody drew without naming, and a
    // dot with no name against it is a dot that means nothing.
    expect(namedStops([island('', 0, 0), island('Golgota tér', 40, 0)])).toEqual([
      { x: 40, z: 0, name: 'Golgota tér' },
    ]);
  });

  it('prints the part of a name that says which stop it is', () => {
    // The head. Hungarian stop names qualify themselves in brackets -- which
    // arm of the junction -- and the map is already saying which arm by
    // where the dot is.
    expect(shortStop('Blaha Lujza tér M (Népszínház utca)')).toBe('Blaha Lujza tér');
    // And a crossroads by both its streets, which needs no special case: the
    // slash is the third word, and the trailing punctuation goes with it.
    expect(shortStop('Wesselényi utca / Erzsébet körút')).toBe('Wesselényi utca');
    expect(shortStop('Teleki László tér')).toBe('Teleki László tér');
  });
});

describe('holding a mark on the panel when it is off it', () => {
  // The panel is 296 across, so its middle is 148 and its rim is that less
  // the room the arrow needs.
  const MIDDLE = 148;
  const SIZE = 3;

  it('leaves something on the panel where it is', () => {
    const spot = { x: MIDDLE + 20, y: MIDDLE - 40 };
    expect(heldOnPanel(spot, MIDDLE, SIZE)).toEqual({ at: spot, turn: null });
  });

  it('holds something off the panel on the rim', () => {
    // Where the waypoint on the sixth level goes the moment you turn away
    // from it. It used to be drawn at its real place, which is outside the
    // circle -- so the map simply went quiet on a level whose whole route is
    // marks, at the exact moment somebody had lost their way.
    const held = heldOnPanel({ x: MIDDLE + 900, y: MIDDLE }, MIDDLE, SIZE);
    expect(held.turn, 'drawn as an arrow, not a dot').not.toBeNull();
    const out = Math.hypot(held.at.x - MIDDLE, held.at.y - MIDDLE);
    expect(out, 'on the rim').toBeCloseTo(MIDDLE - SIZE - 4, 6);
  });

  it('points the arrow out at the thing', () => {
    // The arrow is drawn nose-up, so the turn is the angle from up. Due east
    // of the bird is a quarter turn clockwise.
    const east = heldOnPanel({ x: MIDDLE + 900, y: MIDDLE }, MIDDLE, SIZE);
    expect(east.turn!).toBeCloseTo(Math.PI / 2, 6);
    // And straight ahead -- up the panel -- is no turn at all.
    const ahead = heldOnPanel({ x: MIDDLE, y: MIDDLE - 900 }, MIDDLE, SIZE);
    expect(ahead.turn!).toBeCloseTo(0, 6);
  });

  it('keeps it on the way to the thing, not merely somewhere on the rim', () => {
    // Held along the line from the bird to it, so the arrow is *where* you
    // would look as well as pointing the way you would go.
    const held = heldOnPanel({ x: MIDDLE + 600, y: MIDDLE - 600 }, MIDDLE, SIZE);
    expect(held.at.x - MIDDLE).toBeCloseTo(-(held.at.y - MIDDLE), 6);
    expect(held.at.x).toBeGreaterThan(MIDDLE);
  });

  it('gives the bigger thing more room, so the rim tells them apart too', () => {
    // The mark and the target share a colour on purpose -- they are the same
    // instruction -- so size is the whole of what separates them, and it has
    // to survive being held at the edge.
    const far = { x: MIDDLE + 900, y: MIDDLE };
    const mark = heldOnPanel(far, MIDDLE, 3);
    const target = heldOnPanel(far, MIDDLE, 4.5);
    expect(Math.hypot(target.at.x - MIDDLE, target.at.y - MIDDLE)).toBeLessThan(
      Math.hypot(mark.at.x - MIDDLE, mark.at.y - MIDDLE),
    );
  });

  it('does not fall over when the thing is under the bird', () => {
    // Nought away, and normalising a zero-length vector is not a direction.
    const on = { x: MIDDLE, y: MIDDLE };
    expect(heldOnPanel(on, MIDDLE, SIZE)).toEqual({ at: on, turn: null });
  });
});
