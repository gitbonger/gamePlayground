import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  arrowFade,
  arrowScale,
  buildRoofs,
  buildWorld,
  groundSurfaceAt,
  roofRise,
  targetFlash,
} from './city';
import { buildLayoutFromMap, defaultMapWorldOptions } from './from-map';
import { consistLength, layOutTrain, lineLength, shuttle, WAGON } from './train';
import type { Puff } from './smoke';
import * as THREE from 'three';
import type { MapData, Rail, Road } from './streets';

const BLOCK: Road[] = [
  { kind: 'primary', width: 16, points: [[-40, 0], [0, 0], [200, 0], [240, 0]] },
  { kind: 'primary', width: 16, points: [[-40, 200], [0, 200], [200, 200], [240, 200]] },
  { kind: 'residential', width: 8, points: [[0, -40], [0, 0], [0, 200], [0, 240]] },
  { kind: 'residential', width: 8, points: [[200, -40], [200, 0], [200, 200], [200, 240]] },
];

/** Four hundred metres of siding, well clear of the block. */
const SIDING: Rail[] = [{ kind: 'rail', width: 8, points: [[-200, 320], [200, 320]] }];

/** A described building, standing in the middle of the block. */
const TOWER = { name: 'Level 2', x: 40, z: 40, width: 16, depth: 12, height: 31 };

const map: MapData = {
  name: 'test',
  centre: [0, 0],
  radius: 300,
  attribution: 'test',
  roads: BLOCK,
  rails: SIDING,
  areas: [],
};

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
        createRadialGradient: () => ({ addColorStop() {} }),
      }),
    }),
  };
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDocument;
});

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

  it('leaves a named building flat, so the pigeon has somewhere to land', () => {
    // A pitched roof is nowhere for a bird to stand: the collider would settle
    // it on the ridge line with the tiles falling away underneath.
    const homing = buildLayoutFromMap(map, { ...defaultMapWorldOptions, landmarks: [TOWER] });
    const at = homing.buildings.findIndex((b) => b.height === TOWER.height);
    expect(at).toBeGreaterThanOrEqual(0);

    // Six triangles per roof, three vertices each, and one building left bare.
    const all = buildRoofs(homing.buildings).getAttribute('position').count;
    expect(all).toBe(homing.buildings.length * 6 * 3);
    const bare = buildRoofs(homing.buildings, new Set([at])).getAttribute('position').count;
    expect(bare).toBe(all - 6 * 3);
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
    // One clean pulse per second: nothing at the turn of the second, a peak
    // partway through, and dark again well before the next one.
    expect(targetFlash(0, false)).toBeCloseTo(0, 6);
    expect(targetFlash(0.225, false)).toBeCloseTo(1, 6);
    expect(targetFlash(0.45, false)).toBeCloseTo(0, 6);

    let dark = 0;
    for (let t = 0; t < 1; t += 0.01) if (targetFlash(t, false) < 0.05) dark += 1;
    expect(dark / 100).toBeGreaterThan(0.6);
  });

  it('repeats every second, whenever you look', () => {
    for (const second of [0, 1, 7, 123]) {
      expect(targetFlash(second + 0.225, false)).toBeCloseTo(1, 6);
      expect(targetFlash(second + 0.8, false)).toBeCloseTo(0, 6);
    }
  });

  it('swells and fades rather than snapping on', () => {
    // A hard edge at this size reads as a rendering fault rather than a
    // signal, so the pulse has to be continuous at both ends.
    let biggest = 0;
    let last = targetFlash(0, false);
    for (let t = 0; t < 1; t += 1 / 240) {
      const now = targetFlash(t, false);
      biggest = Math.max(biggest, Math.abs(now - last));
      last = now;
    }
    expect(biggest).toBeLessThan(0.05);
  });

  it('goes on flashing right up to the moment of touchdown', () => {
    // It used to stop inside 130 m, which is the part of an approach where
    // you most want to be sure you are lining up on the right roof. Distance
    // is not a reason to stop any more, and being down is the only one.
    for (const t of [0, 0.225, 0.4, 60.225]) {
      expect(targetFlash(t, false), `${t}s`).toBe(targetFlash(t % 1, false));
    }
    expect(targetFlash(0.225, false)).toBeCloseTo(1, 6);
  });

  it('and stops the moment the bird is on its feet', () => {
    for (const t of [0, 0.2, 0.225, 0.4, 0.9]) {
      expect(targetFlash(t, true), `${t}s`).toBe(0);
    }
  });

  it('thins the arrow out as you arrive, rather than filling the screen', () => {
    // It does not shrink below a floor and is drawn in front of everything,
    // so on short final it is a yellow arrow between you and the thing it is
    // pointing at. Fine while every target was a roof you came down onto;
    // a patch of concrete on the ground is approached through it.
    expect(arrowFade(400)).toBe(1);
    expect(arrowFade(30)).toBe(1);
    expect(arrowFade(4)).toBe(0);
    expect(arrowFade(0)).toBe(0);

    // Faded rather than switched off, or the last frame before it goes reads
    // as the marker breaking.
    let last = arrowFade(0);
    let jump = 0;
    for (let away = 0; away < 60; away += 0.25) {
      const now = arrowFade(away);
      jump = Math.max(jump, Math.abs(now - last));
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
    expect(jump).toBeLessThan(0.05);
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

  const build = () =>
    buildWorld(buildLayoutFromMap(map, {
      ...defaultMapWorldOptions,
      landmarks: [TOWER],
      trains: [{ near: { x: 0, z: 320 }, cars: 4 }],
    }), {
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
      landmarks: [TOWER],
      trains: [{ near: { x: 0, z: 320 }, cars: 4 }],
    });
    const world = buildWorld(layout, {
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

  it('keeps the arrows out of the world, in a pass of their own', () => {
    // Drawing them last with the depth test off is not enough: transparent
    // objects render after every opaque one whatever their render order, so
    // the road and railway ribbons painted straight over the top.
    const world = build();
    expect(countArrows(world).total).toBe(2);

    let inTheWorld = 0;
    world.group.traverse((child: { type?: string }) => {
      if (child.type === 'Mesh' && (child as { material?: { fog?: boolean } }).material?.fog === false) {
        inTheWorld += 1;
      }
    });
    expect(inTheWorld).toBe(0);
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
      trains: [{ near: { x: 0, z: 320 }, cars: 4 }],
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

/**
 * How many target arrows exist in a world, and how many are showing.
 *
 * Counted in the overlay, which is where they live: they are drawn in a pass
 * of their own so that nothing in the world can be in front of them.
 */
function countArrows(world: ReturnType<typeof buildWorld>) {
  let total = 0;
  let visible = 0;
  world.overlay.traverse((child: any) => {
    if (child.isMesh) {
      total += 1;
      // Head and shaft share a parent group, which is what gets hidden.
      if (child.parent?.visible) visible += 1;
    }
  });
  return { total: total / 2, visible: visible / 2 };
}

describe('a train that moves', () => {
  const make = () => {
    const layout = buildLayoutFromMap(map, {
      ...defaultMapWorldOptions,
      landmarks: [TOWER],
      trains: [{ near: { x: 0, z: 320 }, cars: 4 }],
    });
    const world = buildWorld(layout, {
      objectives: [{ name: 'Level 1', train: 0, vehicle: 2 }],
    });
    return { layout, world };
  };

  /** Run a train on down its line, the way the frame loop does. */
  const runOn = (layout: ReturnType<typeof make>['layout'], metres: number) => {
    const train = layout.trains[0]!;
    const wagons = train.vehicles.length - 1;
    const moved = shuttle(
      lineLength(train.line.points),
      consistLength(wagons),
      train.along,
      train.direction,
      metres,
    );
    train.along = moved.along;
    train.direction = moved.direction;
    train.vehicles = layOutTrain(train.line, train.along, wagons);
  };

  it('carries the rolling stock along with it, and nothing else', () => {
    // Tracked per mesh rather than as a sorted list of positions: the roads
    // and the railway are vertex-coloured too, and sit perfectly still.
    const { layout, world } = make();
    const where = () => {
      const at = new Map<string, number>();
      world.group.traverse((child: { isMesh?: boolean; uuid?: string; position?: { x: number } }) => {
        if (child.isMesh) at.set(child.uuid!, child.position!.x);
      });
      return at;
    };

    world.updateTrains(layout.trains);
    const before = where();
    runOn(layout, 40);
    world.updateTrains(layout.trains);
    const after = where();

    const moved = [...after].filter(([id, x]) => Math.abs(x - before.get(id)!) > 1e-6);
    // Every vehicle in the rake, and not one thing more.
    expect(moved).toHaveLength(layout.trains[0]!.vehicles.length);
    for (const [id, x] of moved) {
      expect(x - before.get(id)!).toBeCloseTo(40, 6);
    }
  });

  it('carries the marker with the wagon it is on', () => {
    // Otherwise the arrow hangs over the patch of ballast the wagon left.
    const { layout, world } = make();
    world.updateTrains(layout.trains);
    const marker = world.markers.find((m) => m.name === 'Level 1')!;
    const started = marker.position.clone();

    runOn(layout, 40);
    world.updateTrains(layout.trains);

    const wagon = layout.trains[0]!.vehicles[2]!;
    expect(marker.position.x).toBeCloseTo(wagon.x, 6);
    expect(marker.position.z).toBeCloseTo(wagon.z, 6);
    expect(marker.position.distanceTo(started)).toBeCloseTo(40, 6);
  });

  it('leaves the marker on the building where it stands', () => {
    const { layout, world } = make();
    const marker = world.markers.find((m) => m.name === 'Level 2')!;
    const started = marker.position.clone();
    runOn(layout, 40);
    world.updateTrains(layout.trains);
    expect(marker.position.equals(started)).toBe(true);
  });
});

describe('drawing the smoke', () => {
  const build = () =>
    buildWorld(
      buildLayoutFromMap(map, { ...defaultMapWorldOptions, landmarks: [TOWER] }),
      { smoke: 64 },
    );

  /** Puffs of a given age, all at the same spot. */
  const aged = (ages: number[]): Puff[] =>
    ages.map((age) => ({ x: 0, y: 20, z: 0, vx: 0, vy: 0, vz: 0, age, life: 10, seed: 0.5 }));

  const smokeMesh = (world: ReturnType<typeof buildWorld>) => {
    let found: any = null;
    world.group.traverse((child: any) => {
      if (child.isInstancedMesh && child.material?.map && child.material?.transparent) found = child;
    });
    return found;
  };

  it('gives every puff its own opacity, which is what makes it smoke', () => {
    // The bug this is here for: the opacity was worked out and then thrown
    // away, so every puff drew at full strength however old it was. Hundreds
    // of them piled up into one solid silhouette -- a hole in the sky rather
    // than a plume.
    const world = build();
    const mesh = smokeMesh(world);
    const quiet = new THREE.Quaternion();

    world.updateSmoke(aged([0.5, 3, 6, 9]), quiet);

    const fade = mesh.geometry.getAttribute('puffFade');
    const values = [0, 1, 2, 3].map((i) => fade.getX(i));
    expect(values.every((v) => v > 0 && v < 1)).toBe(true);
    // Thinning as it ages, every step of the way.
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]!, `puff ${i}`).toBeLessThan(values[i - 1]!);
    }
    world.dispose();
  });

  it('draws them paler and larger as they go', () => {
    const world = build();
    const mesh = smokeMesh(world);
    world.updateSmoke(aged([0.5, 8]), new THREE.Quaternion());

    const colour = mesh.instanceColor;
    // Soot at the stack, a grey haze by the end.
    expect(colour.getX(1)).toBeGreaterThan(colour.getX(0));

    const young = new THREE.Matrix4();
    const old = new THREE.Matrix4();
    mesh.getMatrixAt(0, young);
    mesh.getMatrixAt(1, old);
    const size = (m: THREE.Matrix4) => new THREE.Vector3().setFromMatrixScale(m).x;
    expect(size(old)).toBeGreaterThan(size(young) * 2);
    world.dispose();
  });

  it('leaves the dead ones out of the draw entirely', () => {
    const world = build();
    const mesh = smokeMesh(world);
    world.updateSmoke(aged([1, 2, 3]).concat(aged([-1, -1])), new THREE.Quaternion());
    expect(mesh.count).toBe(3);
    world.dispose();
  });
});

describe('the trees', () => {
  /**
   * A grid of blocks rather than the single one at the top of this file.
   *
   * With one block there is one place to plant and so one sort of tree, and a
   * world with one sort in it cannot tell whether the sorts are being kept
   * apart properly -- everything routes to the same stand either way.
   *
   * Split at the junctions: a block is found by walking half-edges, so a road
   * that crosses another without a vertex there crosses nothing.
   */
  const gridded: MapData = {
    ...map,
    radius: 900,
    roads: [
      { kind: 'primary', width: 16, points: [[-40, 0], [0, 0], [200, 0], [400, 0], [440, 0]] },
      { kind: 'primary', width: 16, points: [[-40, 200], [0, 200], [200, 200], [400, 200], [440, 200]] },
      { kind: 'residential', width: 8, points: [[0, -40], [0, 0], [0, 200], [0, 240]] },
      { kind: 'residential', width: 8, points: [[200, -40], [200, 0], [200, 200], [200, 240]] },
      { kind: 'residential', width: 8, points: [[400, -40], [400, 0], [400, 200], [400, 240]] },
    ],
    rails: [],
  };

  let world: ReturnType<typeof buildWorld>;
  beforeAll(() => {
    world = buildWorld(buildLayoutFromMap(gridded, defaultMapWorldOptions), {});
  });

  /** Every instanced stand of trees in the world. */
  const stands = (group: THREE.Object3D) => {
    const found: THREE.InstancedMesh[] = [];
    group.traverse((object) => {
      if (object instanceof THREE.InstancedMesh && object.name === 'trees') found.push(object);
    });
    return found;
  };

  it('draws every tree the layout asked for, and no more', () => {
    // One stand per sort means one chance per sort to lose the count. An
    // InstancedMesh is told its size when it is made, so a wrong guess is
    // either wasted memory or missing trees, silently.
    const layout = buildLayoutFromMap(gridded, defaultMapWorldOptions);
    const planted = stands(world.group);
    const drawn = planted.reduce((total, mesh) => total + mesh.count, 0);

    expect(layout.trees.length).toBeGreaterThan(10);
    expect(drawn).toBe(layout.trees.length);

    // And none of them asked for more room than it reserved. An
    // InstancedMesh is sized when it is made, so a stand told to draw more
    // than it was built for draws whatever happens to be in the buffer.
    for (const stand of planted) {
      expect(stand.count).toBeLessThanOrEqual(stand.instanceMatrix.count);
    }
  });

  it('plants each place with one sort, rather than shuffling them together', () => {
    // The point of having sorts. Four of them mixed through one courtyard is
    // static rather than variety: every tree different from the one beside it
    // is noise. A block planted with one sort reads as a stand of poplars,
    // and the next block over being something else is what it is for.
    //
    // Stated as: a tree's nearest neighbour is almost always its own sort.
    // Picked per tree instead, it would be about one time in four.
    const trees = buildLayoutFromMap(gridded, defaultMapWorldOptions).trees;
    expect(trees.length).toBeGreaterThan(10);

    let same = 0;
    for (const tree of trees) {
      let nearest: (typeof trees)[number] | null = null;
      let closest = Infinity;
      for (const other of trees) {
        if (other === tree) continue;
        const away = Math.hypot(other.x - tree.x, other.z - tree.z);
        if (away < closest) {
          closest = away;
          nearest = other;
        }
      }
      if (nearest && nearest.species === tree.species) same += 1;
    }
    expect(same / trees.length).toBeGreaterThan(0.85);
  });

  it('still uses more than one sort across a map with more than one block', () => {
    // One per place, but not one everywhere: a city of nothing but spruce is
    // the uniform trees this replaced.
    const trees = buildLayoutFromMap(gridded, defaultMapWorldOptions).trees;
    expect(trees.length).toBeGreaterThan(20);
    expect(new Set(trees.map((tree) => tree.species)).size).toBeGreaterThan(1);
  });

  it('plants the same wood every run', () => {
    // The seed covers the sort as well as the size and the place, so a tree
    // does not change species between visits.
    const once = buildLayoutFromMap(gridded, defaultMapWorldOptions);
    const again = buildLayoutFromMap(gridded, defaultMapWorldOptions);
    expect(once.trees.map((t) => t.species)).toEqual(again.trees.map((t) => t.species));
  });

  it('stands them on the ground rather than half in it', () => {
    // Two halves of the same claim, and both are needed: the shapes are
    // modelled with their feet at the origin, *and* they are placed there.
    // The old single cone was modelled about its middle and placed half its
    // height up, so checking only one of the two proves nothing.
    const at = new THREE.Matrix4();
    for (const mesh of stands(world.group)) {
      const position = mesh.geometry.getAttribute('position');
      let lowest = Infinity;
      for (let i = 0; i < position.count; i += 1) lowest = Math.min(lowest, position.getY(i));
      expect(lowest).toBeGreaterThanOrEqual(-1e-6);
      expect(lowest).toBeLessThan(0.001);

      for (let i = 0; i < Math.min(mesh.count, 20); i += 1) {
        mesh.getMatrixAt(i, at);
        expect(at.elements[13], `instance ${i}`).toBeCloseTo(0, 9);
      }
    }
  });
});

describe('the surface a resting bird stands on', () => {
  // Built inside the suite, because the ground texture needs the canvas stub
  // that `beforeAll` puts up.
  let world: ReturnType<typeof buildWorld>;
  beforeAll(() => {
    world = buildWorld(buildLayoutFromMap(map, defaultMapWorldOptions), {});
  });

  it('is the railhead over a track, not the plane under it', () => {
    // Stated against the geometry that actually gets drawn: whatever height
    // the ribbon is painted at, that is what a bird there is standing on.
    const drawn = highestFlatSurface(world.group);
    expect(world.surfaceAt(0, 320)).toBeCloseTo(drawn, 6);
    expect(world.surfaceAt(0, 320)).toBeGreaterThan(0);
  });

  it('is the plane again once you step off the track', () => {
    // The siding is 8 m wide, so four metres either side of the centreline.
    expect(world.surfaceAt(0, 320 + 3.5)).toBeGreaterThan(0);
    expect(world.surfaceAt(0, 320 + 40)).toBe(0);
    expect(world.surfaceAt(-600, 320)).toBe(0);
  });

  it('rounds off the ends of a ribbon rather than running on for ever', () => {
    // The siding stops at x = 200. Just past the railhead is still track,
    // because a corridor has a width; well past it is not.
    expect(world.surfaceAt(203, 320)).toBeGreaterThan(0);
    expect(world.surfaceAt(260, 320)).toBe(0);
  });

  it('puts a road below a railway where they actually cross', () => {
    // A level crossing: the same point is on both, and the rail is drawn over
    // the road, so the rail is what you would be standing on.
    const road: Road[] = [{ kind: 'residential', width: 10, points: [[0, -50], [0, 50]] }];
    const rail: Rail[] = [{ kind: 'rail', width: 8, points: [[-50, 0], [50, 0]] }];

    const onRoadOnly = groundSurfaceAt(0, 40, road, rail);
    const onRailOnly = groundSurfaceAt(40, 0, road, rail);
    const onBoth = groundSurfaceAt(0, 0, road, rail);

    expect(onRoadOnly).toBeGreaterThan(0);
    expect(onRailOnly).toBeGreaterThan(onRoadOnly);
    expect(onBoth).toBe(onRailOnly);
  });
});

/** The highest vertex of anything drawn flat over the ground plane. */
function highestFlatSurface(group: THREE.Object3D): number {
  let top = 0;
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const position = object.geometry.getAttribute('position');
    // Flat layers only: a ribbon is one height all over, a building is not.
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i < position.count; i += 1) {
      low = Math.min(low, position.getY(i));
      high = Math.max(high, position.getY(i));
    }
    if (high - low < 1e-6 && high > top) top = high;
  });
  return top;
}
