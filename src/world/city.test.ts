import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { arrowScale, buildRoofs, buildWorld, roofRise, targetFlash } from './city';
import { buildLayoutFromMap, defaultMapWorldOptions } from './from-map';
import { WAGON } from './train';
import type { MapData, Rail, Road } from './streets';

const BLOCK: Road[] = [
  { kind: 'primary', width: 16, points: [[-40, 0], [0, 0], [200, 0], [240, 0]] },
  { kind: 'primary', width: 16, points: [[-40, 200], [0, 200], [200, 200], [240, 200]] },
  { kind: 'residential', width: 8, points: [[0, -40], [0, 0], [0, 200], [0, 240]] },
  { kind: 'residential', width: 8, points: [[200, -40], [200, 0], [200, 200], [200, 240]] },
];

/** Four hundred metres of siding, well clear of the block. */
const SIDING: Rail[] = [{ kind: 'rail', width: 8, points: [[-200, 320], [200, 320]] }];

const map: MapData = {
  name: 'test',
  centre: [0, 0],
  radius: 300,
  attribution: 'test',
  roads: BLOCK,
  rails: SIDING,
  areas: [],
};

describe('roofs', () => {
  it('takes the roof out of the building rather than piling it on top', () => {
    // The ridge is the height the layout says, so the collision box -- which
    // stops there -- still means what it did before there were roofs, and the
    // heights stay in the band the district was measured at.
    const layout = buildLayoutFromMap(map);
    expect(layout.buildings.length).toBeGreaterThan(20);

    for (const building of layout.buildings) {
      const rise = roofRise(building);
      expect(rise, `${building.width} x ${building.depth}`).toBeGreaterThan(0);
      expect(building.height).toBeLessThanOrEqual(defaultMapWorldOptions.maxHeight);
      // And the walls that carry it are still the bulk of the building.
      expect(building.height - rise).toBeGreaterThan(building.height * 0.6);
    }
  });

  it('leaves the landmark flat, so the pigeon has somewhere to land', () => {
    // A pitched roof is nowhere for a bird to stand: the collider would settle
    // it on the ridge line with the tiles falling away underneath.
    const homing = buildLayoutFromMap(map, { ...defaultMapWorldOptions, target: { x: 40, z: 40 } });
    const marked = homing.buildings.filter((b) => b.isTarget);
    expect(marked).toHaveLength(1);

    // Six triangles per roof, three vertices each, and one building without.
    const vertices = buildRoofs(homing.buildings).getAttribute('position').count;
    expect(vertices).toBe((homing.buildings.length - 1) * 6 * 3);
    expect(buildRoofs([marked[0]!]).getAttribute('position').count).toBe(0);
  });

  it('pitches a roof to its own depth, up to a limit', () => {
    // A shallow wing gets a shallow roof; a deep one stops growing rather than
    // turning the building into a spire.
    expect(roofRise({ depth: 8, height: 20 })).toBeCloseTo(2, 6);
    expect(roofRise({ depth: 16, height: 20 })).toBeCloseTo(4, 6);
    expect(roofRise({ depth: 40, height: 20 })).toBeCloseTo(5, 6);
  });

  it('never lets the roof swallow a short building', () => {
    // A deep, low building would otherwise be all roof and no wall.
    expect(roofRise({ depth: 40, height: 6 })).toBeCloseTo(6 * 0.35, 6);
  });
});

describe('marking the target', () => {
  it('flashes once a second, and is dark for most of it', () => {
    const far = 500;
    // One clean pulse per second: nothing at the turn of the second, a peak
    // partway through, and dark again well before the next one.
    expect(targetFlash(0, far)).toBeCloseTo(0, 6);
    expect(targetFlash(0.225, far)).toBeCloseTo(1, 6);
    expect(targetFlash(0.45, far)).toBeCloseTo(0, 6);

    let dark = 0;
    for (let t = 0; t < 1; t += 0.01) if (targetFlash(t, far) < 0.05) dark += 1;
    expect(dark / 100).toBeGreaterThan(0.6);
  });

  it('repeats every second, whenever you look', () => {
    for (const second of [0, 1, 7, 123]) {
      expect(targetFlash(second + 0.225, 500)).toBeCloseTo(1, 6);
      expect(targetFlash(second + 0.8, 500)).toBeCloseTo(0, 6);
    }
  });

  it('swells and fades rather than snapping on', () => {
    // A hard edge at this size reads as a rendering fault rather than a
    // signal, so the pulse has to be continuous at both ends.
    let biggest = 0;
    let last = targetFlash(0, 500);
    for (let t = 0; t < 1; t += 1 / 240) {
      const now = targetFlash(t, 500);
      biggest = Math.max(biggest, Math.abs(now - last));
      last = now;
    }
    expect(biggest).toBeLessThan(0.05);
  });

  it('stops flashing once the bird is close enough to see it', () => {
    for (const t of [0, 0.2, 0.225, 0.4]) {
      expect(targetFlash(t, 100), `${t}s`).toBe(0);
      expect(targetFlash(t, 129), `${t}s`).toBe(0);
    }
  });

  it('fades out across the band rather than switching off', () => {
    // Snapping to nothing at a threshold makes the last flash before it look
    // like the marker breaking.
    const peak = (away: number) => targetFlash(0.225, away);
    expect(peak(130)).toBeCloseTo(0, 6);
    expect(peak(185)).toBeGreaterThan(0.3);
    expect(peak(185)).toBeLessThan(0.7);
    expect(peak(240)).toBeCloseTo(1, 6);
    expect(peak(2000)).toBeCloseTo(1, 6);
  });

  it('keeps the arrow the same apparent size however far off it is', () => {
    // Which is the whole point of it: a marker you lose at 800 m is no marker.
    // Above the floor, the size has to be proportional to the distance, or it
    // shrinks away with everything else.
    const ratio = (d: number) => arrowScale(d) / d;
    for (const distance of [200, 800, 2000]) {
      expect(ratio(distance)).toBeCloseTo(ratio(200), 9);
    }
    expect(arrowScale(1500)).toBeGreaterThan(arrowScale(150));
  });

  it('keeps a floor on it, so it does not vanish underfoot', () => {
    expect(arrowScale(0)).toBeGreaterThan(1);
    expect(arrowScale(1)).toBe(arrowScale(0));
  });
});

describe('levels', () => {
  /**
   * The ground is textured with a grid drawn to a canvas, which Node has no
   * notion of. Everything under test here is geometry and materials, so the
   * canvas only has to exist and absorb the handful of calls made to it.
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
          fillRect() {},
          strokeRect() {},
        }),
      }),
    };
  });
  afterAll(() => {
    (globalThis as { document?: unknown }).document = realDocument;
  });

  const build = () =>
    buildWorld(buildLayoutFromMap(map, {
      ...defaultMapWorldOptions,
      target: { x: 40, z: 40 },
      trains: [{ near: { x: 0, z: 320 }, wagons: 4 }],
    }), {
      landmark: 'Level 2',
      objectives: [{ name: 'Level 1', train: 0, vehicle: 2 }],
    });

  it('names both objectives and builds a marker for each', () => {
    const world = build();
    expect(world.markers.map((m) => m.name).sort()).toEqual(['Level 1', 'Level 2']);
    world.dispose();
  });

  it('puts the level-one marker on the wagon it was told to', () => {
    const layout = buildLayoutFromMap(map, {
      ...defaultMapWorldOptions,
      target: { x: 40, z: 40 },
      trains: [{ near: { x: 0, z: 320 }, wagons: 4 }],
    });
    const world = buildWorld(layout, {
      landmark: 'Level 2',
      objectives: [{ name: 'Level 1', train: 0, vehicle: 2 }],
    });

    const wagon = layout.trains[0]!.vehicles[2]!;
    const marker = world.markers.find((m) => m.name === 'Level 1')!;
    expect(marker.position.x).toBeCloseTo(wagon.x, 6);
    expect(marker.position.z).toBeCloseTo(wagon.z, 6);
    // Hanging at the top of the stakes, not at the deck or on the ground.
    expect(marker.position.y).toBeCloseTo(WAGON.deck + WAGON.stake, 6);
    world.dispose();
  });

  it('marks nothing until a level is made active', () => {
    // Everything is built and sitting there dark, so moving the game on is a
    // matter of switching which one is lit.
    const world = build();
    const arrows = countArrows(world);
    expect(arrows.total).toBe(2);
    expect(arrows.visible).toBe(0);

    world.markers.find((m) => m.name === 'Level 1')!.setActive(true);
    expect(countArrows(world).visible).toBe(1);
    world.dispose();
  });

  it('takes the marked wagon out of the rake, so it can be recoloured alone', () => {
    // One wagon cannot be picked out of a merged mesh, which is why it gets
    // its own -- exactly as the landmark building does.
    const plain = buildWorld(buildLayoutFromMap(map, {
      ...defaultMapWorldOptions,
      trains: [{ near: { x: 0, z: 320 }, wagons: 4 }],
    }));
    const marked = build();

    const trisOf = (world: ReturnType<typeof buildWorld>) => {
      let total = 0;
      world.group.traverse((child: any) => {
        if (child.isMesh && child.material?.vertexColors) {
          total += child.geometry.getAttribute('position').count;
        }
      });
      return total;
    };
    // Same train either way: split into two meshes, not duplicated or dropped.
    expect(trisOf(marked)).toBe(trisOf(plain));
    plain.dispose();
    marked.dispose();
  });
});

/** How many target arrows exist in a world, and how many are showing. */
function countArrows(world: ReturnType<typeof buildWorld>) {
  let total = 0;
  let visible = 0;
  world.group.traverse((child: any) => {
    if (child.isMesh && child.material?.depthTest === false && child.material?.fog === false) {
      total += 1;
      // Head and shaft share a parent group, which is what gets hidden.
      if (child.parent?.visible) visible += 1;
    }
  });
  return { total: total / 2, visible: visible / 2 };
}
