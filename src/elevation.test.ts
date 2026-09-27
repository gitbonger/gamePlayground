import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import homeMap from './world/data/home.json';
import { buildLayoutFromMap, defaultMapWorldOptions } from './world/from-map';
import { buildWorld } from './world/city';
import { FLAT } from './world/ground';
import { createColliderField } from './sim/collision';
import { project } from './world/geo';
import { deckOf } from './world/bridges';
import { LANDMARKS } from './landmarks';
import type { MapData } from './world/streets';

/**
 * Everything is where it looks like it is.
 *
 * The ground used to be a plane at nought, and while it was, a height and a
 * height above the ground were the same number. They are not: Buda stands a
 * hundred metres up, the Keleti yard is three and a half down, and the
 * riverbed is fifteen under the water. Every place that used one for the
 * other put something in the air or buried it -- the cast on the loft roof
 * floating with the cage beside them, the pigeon on the marked wagon, the
 * collision slab of the Danube bridges nine metres under the river.
 *
 * So this is one test for the whole family: what a thing is drawn at, what it
 * is felt at, and where the game puts something that stands on it are three
 * ways of saying one number.
 */
const map = homeMap as unknown as MapData;
const layout = buildLayoutFromMap(map, {
  ...defaultMapWorldOptions,
  landmarks: LANDMARKS.map((landmark) => {
    const at = project(landmark.at[0], landmark.at[1], map.centre);
    const { at: _degrees, ...rest } = landmark;
    return { ...rest, x: at.x, z: at.z };
  }),
});
const ground = layout.ground ?? FLAT;
const collider = createColliderField(layout.boxes);
const on = (x: number, z: number) => ground.heightAt(x, z);

/**
 * Every solid top over a point, rather than the highest one.
 *
 * `heightAt` answers the question a falling bird asks -- what is the first
 * thing under me -- and that is the wrong question here: a bridge has a
 * building on the bank above it and a tower has a tree beside it. What these
 * tests want to know is whether there is a solid surface *where the thing is
 * drawn*, so they ask for all of them and look for the one.
 */
const CELL = 64;
const cell = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
const bucketed = new Map<string, number[]>();
layout.boxes.forEach((box, i) => {
  // Bucketed by the span a turned box actually reaches, which is wider than
  // its own min and max: the same widening the collider does.
  const cx = (box.minX + box.maxX) / 2;
  const cz = (box.minZ + box.maxZ) / 2;
  const halfX = (box.maxX - box.minX) / 2;
  const halfZ = (box.maxZ - box.minZ) / 2;
  const cos = Math.abs(Math.cos(box.yaw ?? 0));
  const sin = Math.abs(Math.sin(box.yaw ?? 0));
  const spanX = halfX * cos + halfZ * sin;
  const spanZ = halfX * sin + halfZ * cos;
  for (let x = Math.floor((cx - spanX) / CELL); x <= Math.floor((cx + spanX) / CELL); x += 1) {
    for (let z = Math.floor((cz - spanZ) / CELL); z <= Math.floor((cz + spanZ) / CELL); z += 1) {
      const key = `${x},${z}`;
      const had = bucketed.get(key);
      if (had) had.push(i);
      else bucketed.set(key, [i]);
    }
  }
});
/**
 * Whether a point is inside a box's footprint.
 *
 * Turned into the box's own frame first: a box carries a yaw, and half the
 * city is at an angle to the grid -- see `turnAbout` in the collider, whose
 * convention this follows.
 */
const covers = (box: (typeof layout.boxes)[number], x: number, z: number) => {
  const cx = (box.minX + box.maxX) / 2;
  const cz = (box.minZ + box.maxZ) / 2;
  const angle = -(box.yaw ?? 0);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = x - cx;
  const dz = z - cz;
  const local = { x: cx + dx * cos + dz * sin, z: cz - dx * sin + dz * cos };
  return box.minX <= local.x && local.x <= box.maxX && box.minZ <= local.z && local.z <= box.maxZ;
};
const topsOver = (x: number, z: number): number[] =>
  (bucketed.get(cell(x, z)) ?? [])
    .map((i) => layout.boxes[i]!)
    .filter((box) => covers(box, x, z))
    .map((box) => box.maxY);
/** Whether something solid tops out within `slack` of `wanted`. */
const solidAt = (x: number, z: number, wanted: number, slack = 0.35) =>
  topsOver(x, z).some((top) => Math.abs(top - wanted) <= slack);

describe('what is drawn is what is felt', () => {
  it('has real ground under it, or this test proves nothing', () => {
    // The whole point is places where the ground is not nought.
    expect(ground).not.toBe(FLAT);
    const deepest = Math.min(...layout.trains.map(() => 0), ...(layout.bridges ?? []).map(() => 0));
    void deepest;
    expect(Math.abs(on(-3761, 1406))).toBeGreaterThan(50);
  });

  it('puts a described building on the ground under it, as one thing', () => {
    // Drawn as one object standing on the height under its middle, so it has
    // to be felt there too: lifted box by box, a building on a slope is a
    // staircase the collider knows about and nobody can see.
    //
    // Asked of the top of the thing, which is the part anybody lands on. A
    // described building has parts at other heights -- a terrace, a shed, a
    // roof over a courtyard -- and they are not what this is about.
    let checked = 0;
    for (const landmark of layout.landmarks) {
      if (landmark.height <= 0 || landmark.canopy) continue;
      const roof = on(landmark.x, landmark.z) + landmark.height;
      const tops = topsOver(landmark.x, landmark.z);
      if (tops.length === 0) continue;
      expect(Math.max(...tops), `${landmark.name}: the top of it`).toBeCloseTo(roof, 1);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(2);
  });

  it('hangs a bridge over the river rather than under it', () => {
    // A deck is at a *level* -- seven metres over the water, whatever the
    // riverbed is doing -- so lifting it onto the ground as well put the
    // Danube crossings nine metres under the Danube.
    let checked = 0;
    for (const bridge of layout.bridges ?? []) {
      const deck = deckOf(bridge);
      if (!deck) continue;
      // The middle of a piece rather than one of its ends: a spine vertex is
      // the seam between two slabs and falls on the boundary of both, where
      // the last bits of the arithmetic decide which one owns it.
      const at = Math.max(1, Math.floor(deck.spine.length / 2));
      const from = deck.spine[at - 1]!;
      const to = deck.spine[at]!;
      const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, Math.max(from[2], to[2])] as const;
      expect(
        solidAt(mid[0], mid[1], mid[2]),
        `${bridge.rail ? 'rail' : 'road'} bridge at ${mid[2].toFixed(1)} m`,
      ).toBe(true);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('stands a tower on its own feet and hangs the wire where it is drawn', () => {
    // Both are worked out with the ground in hand -- a cable hangs from the
    // tower it is strung between -- so neither may be lifted onto it again.
    for (const pylon of (layout.pylons ?? []).slice(0, 20)) {
      const mast = on(pylon.x, pylon.z) + pylon.height;
      expect(solidAt(pylon.x, pylon.z, mast), `tower at ${mast.toFixed(1)} m`).toBe(true);
    }
    for (const wire of (layout.wires ?? []).slice(0, 20)) {
      const point = wire.points[Math.floor(wire.points.length / 2)]!;
      // Within the thickness the cable is given, which is what a bird lands on.
      expect(solidAt(point[0], point[2], point[1], 0.5), 'the cable').toBe(true);
    }
  });
});

/**
 * The ground is textured with a grid drawn to a canvas, which Node has no
 * notion of. Only the heights are under test here, so the canvas has only to
 * exist and absorb the calls -- the same stand-in `city.test.ts` uses.
 */
const realDocument = (globalThis as { document?: unknown }).document;
beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 0,
        font: '',
        textAlign: '',
        textBaseline: '',
        fillRect() {},
        strokeRect() {},
        fillText() {},
        measureText: (text: string) => ({ width: text.length * 8 }),
        createRadialGradient: () => ({ addColorStop() {} }),
      }),
    }),
  };
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDocument;
});

describe('where the game puts somebody standing on a thing', () => {
  /**
   * The marker is the answer, and it is the *only* answer.
   *
   * `standingSpot` reads the top of a landmark off its marker, so a marker
   * drawn at the wrong height is a pigeon standing at the wrong height -- and
   * the cage, and the crowd, and the arrow.
   */
  let world: ReturnType<typeof buildWorld>;
  beforeAll(() => {
    world = buildWorld(layout, { objectives: [] });
  });

  it('marks the top of the thing, in the world', () => {
    for (const landmark of layout.landmarks) {
      const marker = world.markers.find((each) => each.name === landmark.name);
      if (!marker) continue;
      if (landmark.height <= 0) {
        // A flat patch is level with the grass, and what stands on it stands
        // on the ground.
        expect(marker.position.y, landmark.name).toBeCloseTo(on(landmark.x, landmark.z), 1);
        continue;
      }
      // And anything with a height is that far above the ground it is on --
      // which is where its own collision boxes are.
      expect(marker.position.y, landmark.name).toBeCloseTo(
        on(landmark.x, landmark.z) + landmark.height,
        1,
      );
      const felt = collider.heightAt(marker.position.x, marker.position.z);
      if (felt !== -Infinity) expect(felt, `${landmark.name}: felt`).toBeCloseTo(marker.position.y, 1);
    }
  });

  it('draws nothing at nought that stands on a hill', () => {
    // The home tree grew from nought whatever the ground did, which put the
    // nest and the egg in the air over Buda-side ground and under Pest.
    const tree = layout.landmarks.find((each) => each.canopy);
    expect(tree, 'the map has a described tree').toBeDefined();
    const marker = world.markers.find((each) => each.name === tree!.name)!;
    expect(marker.position.y).toBeCloseTo(on(tree!.x, tree!.z) + tree!.height, 1);
  });
});
