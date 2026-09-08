import { describe, expect, it } from 'vitest';
import { buildLayoutFromMap, defaultMapWorldOptions } from './from-map';
import {
  CAR,
  nestOn,
  penthouseOf,
  pointOn,
  PUMP,
  SPECIES,
  STREET_TREE,
  terraceOf,
  type Landmark,
} from './layout';
import { indexStreets, type MapData, type Rail, type Road } from './streets';
import { CLEARANCE, type Bridge } from './bridges';
import { footprintSamples, type Area } from './areas';
import { pointInPolygon } from './polygon';
import {
  consistLength,
  layOutTrain,
  lineLength,
  pointAlong,
  recycle,
  shuttle,
  trainBoxes,
  WAGON,
} from './train';
import homeMap from './data/home.json';
import { combineColliders, createColliderField, worldBounds } from '../sim/collision';
import { createBird, defaultParams, neutralControls, step } from '../sim/flight';
import { vec } from '../sim/math3';

/**
 * Four streets round one 200 m block, overshooting the corners.
 *
 * Junctions appear as points on both streets, because that is how a crossing
 * is recorded in the data this is built from: ways that meet share the node.
 */
const BLOCK: Road[] = [
  { kind: 'primary', width: 16, points: [[-40, 0], [0, 0], [200, 0], [240, 0]] },
  { kind: 'primary', width: 16, points: [[-40, 200], [0, 200], [200, 200], [240, 200]] },
  { kind: 'residential', width: 8, points: [[0, -40], [0, 0], [0, 200], [0, 240]] },
  { kind: 'residential', width: 8, points: [[200, -40], [200, 0], [200, 200], [200, 240]] },
];

/**
 * A blanket of small buildings over the test block.
 *
 * Several rules in this file are about ground a building may *not* stand on --
 * a landmark's, a park's, a railway's -- and the only way to show such a rule
 * bites is to show that something would otherwise have been there.
 *
 * That used to come free: the generator filled every block it was given, so
 * "build it without the park and count the houses in the park" was a fair
 * question. There is no generator now, so the buildings come from the map like
 * everything else, and this is a map's worth of them laid on a grid.
 */
const PAVED: number[][] = (() => {
  const rows: number[][] = [];
  for (let x = 12; x <= 188; x += 13) {
    for (let z = 12; z <= 188; z += 13) rows.push([x, z, 9, 7, 0, 14]);
  }
  return rows;
})();

const mapOf = (roads: Road[], areas: Area[] = [], rails: Rail[] = []): MapData => ({
  name: 'test',
  centre: [0, 0],
  radius: 300,
  attribution: 'test',
  roads,
  rails,
  areas,
});

/** The same, with the block built on, for the rules about where one may not be. */
const builtOn = (roads: Road[], areas: Area[] = [], rails: Rail[] = []): MapData => ({
  ...mapOf(roads, areas, rails),
  buildings: PAVED,
});

/**
 * A park over the north-east corner of the block, deliberately covering ground
 * the generator would otherwise build on: a park in the middle of a courtyard
 * would prove nothing, because nothing goes there anyway.
 */
const PARK: Area = {
  kind: 'park',
  points: [
    [120, 0],
    [200, 0],
    [200, 80],
    [120, 80],
  ],
};

describe('street index', () => {
  const streets = indexStreets(BLOCK);

  it('finds the nearest road and which way it runs', () => {
    const near = streets.nearest(9, 100, 60)!;
    expect(near.distance).toBeCloseTo(9, 6);
    expect(near.kind).toBe('residential');
    expect(Math.abs(near.dirZ)).toBeCloseTo(1, 6);

    const other = streets.nearest(100, 5, 60)!;
    expect(other.distance).toBeCloseTo(5, 6);
    expect(other.kind).toBe('primary');
    expect(Math.abs(other.dirX)).toBeCloseTo(1, 6);
  });

  it('measures to the ends of a road, not past them', () => {
    expect(streets.nearest(0, -80, 100)!.distance).toBeCloseTo(40, 6);
  });

  it('gives up beyond the limit rather than searching the whole map', () => {
    expect(streets.nearest(2000, 2000, 50)).toBeNull();
  });
});

describe('what fills a block once the buildings are placed', () => {
  const layout = buildLayoutFromMap(builtOn(BLOCK));
  const collider = createColliderField(layout.boxes);

  it('puts the gardens inside the block, clear of the houses', () => {
    expect(layout.trees.length).toBeGreaterThan(10);
    const ring = layout.blocks[0]!.ring;

    for (const tree of layout.trees) {
      expect(pointInPolygon(tree.x, tree.z, ring), `${tree.x},${tree.z}`).toBe(true);

      // Not standing in anybody's front room. Checked in each building's own
      // frame, so a turned house is the rectangle it is rather than the larger
      // square its world bounds describe.
      for (const b of layout.buildings) {
        const turn = -(b.yaw ?? 0);
        const dx = tree.x - b.x;
        const dz = tree.z - b.z;
        const along = dx * Math.cos(turn) + dz * Math.sin(turn);
        const back = -dx * Math.sin(turn) + dz * Math.cos(turn);
        const inside = Math.abs(along) < b.width / 2 && Math.abs(back) < b.depth / 2;
        expect(inside, `tree ${tree.x},${tree.z} in house ${b.x},${b.z}`).toBe(false);
      }
    }
  });

  it('leaves no block of the city empty', () => {
    // Every polygon the streets enclose is either built on or planted. Bare
    // grass between four roads is the one thing a city block is never.
    for (const block of layout.blocks) {
      const built = layout.buildings.some((b) => pointInPolygon(b.x, b.z, block.ring));
      const planted = layout.trees.some((t) => pointInPolygon(t.x, t.z, block.ring));
      expect(built || planted, `${block.area} m2`).toBe(true);
    }
  });

  it('plants a block too small to build on rather than leaving it bare', () => {
    // 26 m across, with 12 m of street room on every side: there is no room
    // here for a house, and in a real city this plot is a garden square.
    const pocket: Road[] = [
      { kind: 'residential', width: 8, points: [[-20, 0], [0, 0], [26, 0], [46, 0]] },
      { kind: 'residential', width: 8, points: [[-20, 26], [0, 26], [26, 26], [46, 26]] },
      { kind: 'residential', width: 8, points: [[0, -20], [0, 0], [0, 26], [0, 46]] },
      { kind: 'residential', width: 8, points: [[26, -20], [26, 0], [26, 26], [26, 46]] },
    ];
    const square = buildLayoutFromMap(mapOf(pocket));
    expect(square.blocks).toHaveLength(1);
    expect(square.buildings).toHaveLength(0);
    expect(square.bare).toHaveLength(1);
    expect(square.trees.length).toBeGreaterThan(0);
  });

  it('never lets a building overhang the carriageway it fronts', () => {
    // Measured to the near wall, not the centre: a deep building set back only
    // by its centre still sticks out into the road.
    for (const building of layout.buildings) {
      const street = layout.streets.nearest(building.x, building.z, 300)!;
      expect(street.distance - building.depth / 2).toBeGreaterThanOrEqual(street.width / 2);
    }
  });

  it('stands every building on the block it belongs to', () => {
    const ring = layout.blocks[0]!.ring;
    for (const building of layout.buildings) {
      expect(pointInPolygon(building.x, building.z, ring), `${building.x},${building.z}`).toBe(true);
    }
  });



  it('turns each building to face the street it fronts', () => {
    // Squared up to the block's own edges, which is the same thing as facing
    // the street and survives the corners, where the nearest street is the one
    // the building presents its side to.
    const ring = layout.blocks[0]!.ring;
    const edges = ring.map((point, i) => {
      const next = ring[(i + 1) % ring.length]!;
      return Math.atan2(-(next[1] - point[1]), next[0] - point[0]);
    });

    for (const building of layout.buildings) {
      const offBy = edges.map((facing) => {
        // Equal up to which way along the street it points.
        const difference = Math.abs(((building.yaw! - facing) % Math.PI) + Math.PI) % Math.PI;
        return Math.min(difference, Math.PI - difference);
      });
      expect(Math.min(...offBy), `${building.x},${building.z}`).toBeLessThan(1e-6);
    }
  });




  it('is deterministic for a given map and seed', () => {
    // Still worth asking with the buildings coming off the map: the heights of
    // the ones that do not state theirs are drawn from a seeded stream, and so
    // is everything planted round them.
    expect(buildLayoutFromMap(builtOn(BLOCK)).buildings).toEqual(layout.buildings);
    expect(buildLayoutFromMap(builtOn(BLOCK)).trees).toEqual(layout.trees);
  });

  it('carries the streets through for the renderer to draw', () => {
    expect(layout.roads).toEqual(BLOCK);
  });

  it('produces solids the collider can take', () => {
    expect(collider.boxCount).toBe(layout.boxes.length);
    for (const box of layout.boxes.map(worldBounds)) {
      expect(box.minY).toBe(0);
      expect(box.maxY).toBeGreaterThan(0);
    }
  });

  it('leaves the street itself flyable from end to end', () => {
    for (let z = -30; z < 230; z += 10) {
      expect(collider.sweep(vec(0, 6, z), vec(0, 6, z + 10), 0.22), `z ${z}`).toBeNull();
    }
  });

  it('lets a bird crash into the city it generated', () => {
    const bird = createBird(vec(100, 12, -60), 16);
    const controls = neutralControls();
    for (let t = 0; t < 60; t += 1 / 120) {
      step(bird, controls, defaultParams, 1 / 120, collider);
      if (bird.ending) break;
    }
    expect(bird.ending).not.toBeNull();
  });

});

/**
 * The described things: the ones written down rather than worked out.
 *
 * They go in before anything is generated, and the generation gives way to
 * them. That order is the whole point -- it is what lets a level say "The
 * Loft" and mean a particular building of a particular shape, instead of
 * whichever house happened to come out nearest to a coordinate.
 */
describe('filling the network with trams', () => {
  /** A trunk in two pieces, with a branch merging into it at forty-five degrees. */
  const tram = (points: [number, number][]): Rail => ({ kind: 'tram', width: 6, points });
  const TRUNK_A = tram([[0, 0], [300, 0]]);
  const TRUNK_B = tram([[300, 0], [600, 0]]);
  const BRANCH = tram([[100, 200], [300, 0]]);

  const filled = () =>
    buildLayoutFromMap(mapOf(BLOCK, [], [TRUNK_A, TRUNK_B, BRANCH]), {
      ...defaultMapWorldOptions,
      // A headway longer than any of these routes, so each comes out with
      // one tram on it: these two tests are about which routes are found,
      // and how many trams go on each is the business of another.
      fill: [{ stock: 'tram', cars: 2, speed: 10, minRoute: 320, most: 4, headway: 600 }],
    }).trains ?? [];

  it('runs a second tram through the line the first one is on', () => {
    // The bug this is here for. `taken` says which rails a route has already
    // been *seeded* from, so that twenty trams are not twenty copies of one
    // line. It used to say where a route may not *go* as well, and those are
    // different questions: the branch, traced around the claimed trunk, was
    // 283 m of its own and nothing else -- under the minimum, so no tram at
    // all, and where a route does survive being cut short like that, the tram
    // turns round in the middle of a street at a junction where the way ahead
    // is dead straight.
    const trains = filled();
    expect(trains.length).toBe(2);

    // Both of them on a run longer than any single way: the first down the
    // trunk, the second up the branch and *through* the trunk the first is
    // already on.
    for (const train of trains) {
      expect(lineLength(train.line.points), `${train.line.points.length} points`).toBeGreaterThan(
        500,
      );
    }
  });

  it('still seeds each tram from a different piece of track', () => {
    // Routes may overlap; the trams that run them must not all be the same
    // tram. Four allowed, three ways to seed from, two of which trace out the
    // same trunk -- so what stops a third is that its ways are spoken for.
    const trains = filled();
    const starts = trains.map((train) => train.line.points[0]!.join(','));
    expect(new Set(starts).size).toBe(starts.length);
  });
});

describe('a park that is a cemetery', () => {
  /**
   * A park over the whole block, so there are enough plantings in it for one
   * in three to be a number rather than an anecdote.
   */
  const GRAVEYARD: Area = {
    kind: 'park',
    points: [
      [10, 10],
      [190, 10],
      [190, 190],
      [10, 190],
    ],
  };
  /** The middle of it, which is what names it as a burial ground. */
  const inside = { x: 100, z: 100 };
  const withGraves = (cemetery?: { x: number; z: number }) =>
    buildLayoutFromMap(mapOf(BLOCK, [GRAVEYARD]), {
      ...defaultMapWorldOptions,
      ...(cemetery ? { cemetery } : {}),
    });

  it('plants nothing but trees when no ground has been named', () => {
    // The map has no idea: its areas are park, wood, water and pitch, and
    // which of the parks is a cemetery is a decision about the story.
    const plain = withGraves();
    expect(plain.graves).toEqual([]);
    expect(plain.trees.length).toBeGreaterThan(0);
  });

  it('puts a stone in the place of one planting in three, and only there', () => {
    const yard = withGraves(inside);
    expect(yard.graves.length).toBeGreaterThan(10);

    // Every one of them inside the named ground, and none anywhere else --
    // the rest of the map is planted exactly as it was.
    for (const grave of yard.graves) {
      expect(pointInPolygon(grave.x, grave.z, GRAVEYARD.points), `${grave.x}, ${grave.z}`).toBe(true);
    }

    // And a third of what grows there is a stone. Measured inside the one
    // layout rather than against a layout without the cemetery: taking a
    // stone instead of a tree draws a different number of random numbers, so
    // the two worlds diverge from the first stone onwards and their counts
    // are not comparable. What is comparable is the share.
    const standing = yard.trees.filter((tree) =>
      pointInPolygon(tree.x, tree.z, GRAVEYARD.points),
    ).length;
    const share = yard.graves.length / (yard.graves.length + standing);
    expect(share).toBeGreaterThan(0.25);
    expect(share).toBeLessThan(0.42);

    // And *in the place of* a tree, not beside one. A cemetery reads as a
    // cemetery because the stones stand in the gaps between the trees, which
    // is what taking the tree's place gives for nothing -- and a stone with a
    // trunk growing out of it would be the sort of thing a share alone would
    // never notice.
    //
    // Measured against how close two *trees* get rather than against a metre.
    // A metre was the right number for the planting density this test was
    // written at, and density is not what the rule is about: a stone that
    // takes a tree's place is no nearer its neighbours than that tree would
    // have been. Pinning it to a distance meant the test failed the day the
    // plantings got closer together, which was a fact about the fixture and
    // not about the stones.
    const planted = yard.trees.filter((tree) =>
      pointInPolygon(tree.x, tree.z, GRAVEYARD.points),
    );
    let closestPair = Infinity;
    for (let i = 0; i < planted.length; i += 1) {
      for (let j = i + 1; j < planted.length; j += 1) {
        const gap = Math.hypot(planted[i]!.x - planted[j]!.x, planted[i]!.z - planted[j]!.z);
        if (gap < closestPair) closestPair = gap;
      }
    }
    expect(closestPair, 'there are trees to compare against').toBeLessThan(Infinity);

    for (const grave of yard.graves) {
      const nearest = Math.min(
        ...planted.map((tree) => Math.hypot(tree.x - grave.x, tree.z - grave.z)),
      );
      expect(nearest, `${grave.x.toFixed(0)}, ${grave.z.toFixed(0)}`).toBeGreaterThanOrEqual(
        closestPair,
      );
    }
  });

  it('leaves them scattered rather than lined up', () => {
    // Real ones face east in rows, and rows are a thing this generator has no
    // way of laying. Scattered stones at scattered angles read as a graveyard
    // from the air; a grid of them would read as a car park.
    const yard = withGraves(inside);
    const yaws = yard.graves.map((grave) => grave.yaw);
    expect(new Set(yaws.map((yaw) => Math.round(yaw * 10))).size).toBeGreaterThan(10);
    for (const grave of yard.graves) {
      // Three times the stone anybody is actually buried under, for the same
      // reason the nest is three times a nest: a metre of grey in grass is
      // not there at all from twenty metres up.
      expect(grave.height, 'a stone stands two to four metres').toBeGreaterThan(2);
      expect(grave.height).toBeLessThan(4);
    }
  });

  it('is scenery, like the trees it stands among', () => {
    // No bird has ever been stopped by a headstone, and neither is a pigeon
    // here: the stones add nothing to the collision boxes.
    const yard = withGraves(inside);
    expect(yard.graves.length).toBeGreaterThan(0);
    expect(withGraves().boxes.length).toBe(yard.boxes.length);
  });
});

describe('describing a thing into the world', () => {
  const TOWER: Landmark = {
    name: 'The Loft',
    x: 40,
    z: 40,
    width: 30,
    depth: 14,
    height: 31,
    margin: 9,
    penthouse: { cover: 0.5, rise: 3.2 },
    planting: { rows: 2, perRow: 6, radius: 0.7 },
    people: [{ along: -3, across: 5, facing: Math.PI }],
  };
  // In the park, which is where a patch of concrete belongs and, more to the
  // point here, where the trees are.
  const SLAB: Landmark = {
    name: 'The Concrete',
    x: 160,
    z: 40,
    width: 9,
    depth: 9,
    height: 0,
    margin: 7,
  };

  // A tree of the same kind: written down, put in place first, and giving the
  // level something particular to name. Its top is a floor.
  const TREE: Landmark = {
    name: 'The Home Tree',
    x: 40,
    z: 40,
    width: 12,
    depth: 12,
    height: 20,
    margin: 8,
    canopy: { trunk: 1.5, skirt: 7, spread: 6 },
    nest: { along: -1.6, across: 0.75 },
  };

  // A petrol station: the one described thing that is not one solid shape but
  // a piece of reserved ground with three things standing on it.
  const STATION: Landmark = {
    name: 'The Petrol Station',
    x: 100,
    z: 22,
    width: 18,
    depth: 13,
    height: 3.1,
    margin: 6,
    station: {
      hut: { along: -5.6, across: -3.4, facing: 0, width: 6, depth: 4.2, height: 3.1 },
      pump: { along: 2.2, across: 0.4, facing: 0 },
      car: { along: 2.6, across: 3.1, facing: 0 },
    },
  };

  const withLandmark = (landmark: Landmark) =>
    buildLayoutFromMap(mapOf(BLOCK), { ...defaultMapWorldOptions, landmarks: [landmark] });

  /**
   * Whether a point falls on the ground a landmark has taken.
   *
   * Worked out here from the description alone rather than borrowed from the
   * generator, so that the two agreeing means something.
   */
  const taken = (landmark: Landmark, x: number, z: number) => {
    const turn = -(landmark.yaw ?? 0);
    const along = (x - landmark.x) * Math.cos(turn) + (z - landmark.z) * Math.sin(turn);
    const across = -(x - landmark.x) * Math.sin(turn) + (z - landmark.z) * Math.cos(turn);
    return (
      Math.abs(along) <= landmark.width / 2 + (landmark.margin ?? 0) &&
      Math.abs(across) <= landmark.depth / 2 + (landmark.margin ?? 0)
    );
  };

  it('stands exactly where it was described, at its own size', () => {
    const described = withLandmark(TOWER);
    expect(described.landmarks).toEqual([TOWER]);

    // Solid where it says it is: a bird flying through the middle of it, at a
    // height only the building reaches, hits something.
    const field = createColliderField(described.boxes);
    expect(
      field.sweep(vec(TOWER.x - 40, TOWER.height - 2, TOWER.z), vec(TOWER.x + 40, TOWER.height - 2, TOWER.z), 0.22),
    ).not.toBeNull();
    // And nothing of it hangs over the ground beyond its own footprint.
    const clear = TOWER.x + TOWER.width / 2 + 1;
    expect(field.heightAt(clear, TOWER.z)).toBeLessThan(TOWER.height);
  });

  it('leaves the terrace open and stands the penthouse over the rest', () => {
    // The shape is the point of the building: half of it one storey higher,
    // the other half a flat top you can put down on.
    const terrace = terraceOf(TOWER)!;
    const penthouse = penthouseOf(TOWER)!;
    expect(terrace.width).toBeCloseTo(15, 9);
    expect(penthouse.width).toBeCloseTo(15, 9);
    // Halves of the same building, so they meet and do not overlap.
    expect(terrace.x + terrace.width / 2).toBeCloseTo(penthouse.x - penthouse.width / 2, 9);
    expect(penthouse.top - terrace.top).toBeCloseTo(3.2, 9);

    const field = createColliderField(withLandmark(TOWER).boxes);
    // A metre above the terrace is air over the terrace and wall over the
    // penthouse, which is the whole difference between the two halves.
    expect(field.heightAt(terrace.x, terrace.z)).toBeCloseTo(TOWER.height, 6);
    expect(field.heightAt(penthouse.x, penthouse.z)).toBeCloseTo(penthouse.top, 6);
  });

  it('holds a tree up on its trunk, leaving the air under the crown open', () => {
    // A tree is not a block of flats with leaves on. It is solid where a tree
    // is solid -- the crown, and the trunk holding it up -- and the space
    // between the two is somewhere to fly, which is half of what makes flying
    // through a park worth doing.
    const field = createColliderField(withLandmark(TREE).boxes);
    const under = (TREE.height - TREE.canopy!.skirt) / 2;

    // Out from the trunk and below the crown: clean through.
    expect(
      field.sweep(
        vec(TREE.x - 60, under, TREE.z + 4),
        vec(TREE.x + 60, under, TREE.z + 4),
        0.22,
      ),
    ).toBeNull();
    // Straight at the trunk, at the same height: stopped.
    expect(
      field.sweep(vec(TREE.x - 60, under, TREE.z), vec(TREE.x + 60, under, TREE.z), 0.22),
    ).not.toBeNull();
    // And the crown is a floor at the height it was described at, all the way
    // out to its edge, which is what "the top is a walkable platform" means.
    expect(field.heightAt(TREE.x, TREE.z)).toBeCloseTo(TREE.height, 6);
    expect(field.heightAt(TREE.x + TREE.width / 2 - 0.5, TREE.z)).toBeCloseTo(TREE.height, 6);
    // Nothing of it beyond its own footprint.
    expect(field.heightAt(TREE.x + TREE.width / 2 + 1, TREE.z)).toBeLessThan(TREE.height);
  });

  it('leaves the nest to be walked over rather than into', () => {
    // The nest is what the level is about and it is deliberately not solid: a
    // bird that bumped into it would be the game arguing with the player at
    // the one moment it should be getting out of the way.
    const nest = nestOn(TREE)!;
    const field = createColliderField(withLandmark(TREE).boxes);
    expect(nest.base).toBe(TREE.height);
    expect(field.heightAt(nest.x, nest.z)).toBeCloseTo(TREE.height, 6);
  });

  it('turns the terrace with the building', () => {
    // The halves are worked out in the landmark's own frame, so a turned one
    // has its terrace on the turned end rather than to the west of it.
    const turned: Landmark = { ...TOWER, yaw: Math.PI / 2 };
    const flat = terraceOf(TOWER)!;
    const spun = terraceOf(turned)!;
    // A quarter turn takes the offset from -x to +z, in the collider's
    // convention, and leaves the distance from the middle alone.
    expect(spun.x).toBeCloseTo(TOWER.x, 9);
    expect(spun.z).toBeCloseTo(TOWER.z + (TOWER.x - flat.x), 9);
    expect(spun.top).toBe(flat.top);
  });

  it('has no house built through it, nor inside its margin', () => {
    const plain = buildLayoutFromMap(builtOn(BLOCK), defaultMapWorldOptions);
    const onIt = (buildings: readonly { x: number; z: number; width: number; depth: number; yaw?: number }[]) =>
      buildings.filter((b) =>
        footprintSamples(b.x, b.z, b.width, b.depth, b.yaw ?? 0).some(([x, z]) =>
          taken(TOWER, x, z),
        ),
      );

    // The ground it takes is ground a building would otherwise stand on, or
    // this proves nothing.
    expect(onIt(plain.buildings).length).toBeGreaterThan(0);

    const described = withLandmark(TOWER);
    const others = described.buildings.filter((b) => b.height !== TOWER.height);
    expect(onIt(others)).toEqual([]);
  });

  it('has no tree planted on it, nor inside its margin', () => {
    const plain = buildLayoutFromMap(mapOf(BLOCK, [PARK]), defaultMapWorldOptions);
    const onIt = (trees: readonly { x: number; z: number }[]) =>
      trees.filter((t) => taken(SLAB, t.x, t.z));

    expect(onIt(plain.trees).length).toBeGreaterThan(0);
    expect(onIt(buildLayoutFromMap(mapOf(BLOCK, [PARK]), {
      ...defaultMapWorldOptions,
      landmarks: [SLAB],
    }).trees)).toEqual([]);
  });

  it('gives a flat one no walls, so it can be walked onto from outside', () => {
    // A slab of concrete is a marking, not a thing: a bird flying at head
    // height across it must pass straight through where it is.
    const flat = withLandmark(SLAB);
    expect(flat.buildings.some((b) => b.x === SLAB.x && b.z === SLAB.z)).toBe(false);

    const across = (layout: ReturnType<typeof withLandmark>) =>
      createColliderField(layout.boxes).sweep(
        vec(SLAB.x - 6, 1, SLAB.z),
        vec(SLAB.x + 6, 1, SLAB.z),
        0.22,
      );
    expect(across(flat)).toBeNull();

    // The same description given a height is a wall, so the sweep above is an
    // observation about the slab rather than one about that stretch of park.
    expect(across(withLandmark({ ...SLAB, height: 20 }))).not.toBeNull();
  });

  it('plants the terrace in rows, and leaves the middle of it open', () => {
    const terrace = terraceOf(TOWER)!;
    const bushes = withLandmark(TOWER).bushes;
    expect(bushes).toHaveLength(2 * 6);

    for (const bush of bushes) {
      // Standing on the terrace, not on the ground and not on the penthouse.
      expect(bush.base).toBe(TOWER.height);
      // And on the terrace rather than off the edge of it.
      expect(Math.abs(bush.x - terrace.x)).toBeLessThanOrEqual(terrace.width / 2 - bush.radius);
      expect(Math.abs(bush.z - terrace.z)).toBeLessThanOrEqual(terrace.depth / 2 - bush.radius);
    }

    // Two rows, one either side, and a clear strip between them: the middle
    // is where the arrow points and where the bird comes down.
    const sides = new Set(bushes.map((bush) => Math.sign(bush.z - terrace.z)));
    expect(sides).toEqual(new Set([-1, 1]));
    const clear = Math.min(...bushes.map((b) => Math.abs(b.z - terrace.z) - b.radius));
    expect(clear).toBeGreaterThan(3);
  });

  it('makes the bushes solid, like everything else growing out of the world', () => {
    const terrace = terraceOf(TOWER)!;
    const field = createColliderField(withLandmark(TOWER).boxes);
    const bush = withLandmark(TOWER).bushes[0]!;

    // Standing on one is standing higher than standing beside it.
    expect(field.heightAt(bush.x, bush.z)).toBeCloseTo(bush.base + bush.height, 6);
    // But the strip down the middle is the terrace and nothing else.
    expect(field.heightAt(terrace.x, terrace.z)).toBeCloseTo(TOWER.height, 6);
  });

  it('stands people on the terrace, turned with the building', () => {
    const spot = TOWER.people![0]!;

    /** Where somebody is, measured back in the terrace's own frame. */
    const placed = (landmark: Landmark) => {
      const terrace = terraceOf(landmark)!;
      const person = withLandmark(landmark).people[0]!;
      const dx = person.x - terrace.x;
      const dz = person.z - terrace.z;
      return {
        along: dx * Math.cos(terrace.yaw) - dz * Math.sin(terrace.yaw),
        across: dx * Math.sin(terrace.yaw) + dz * Math.cos(terrace.yaw),
        base: person.base,
        facing: person.facing - terrace.yaw,
      };
    };

    // Where the description says, on the terrace and not on the ground.
    expect(placed(TOWER).along).toBeCloseTo(spot.along, 6);
    expect(placed(TOWER).across).toBeCloseTo(spot.across, 6);
    expect(placed(TOWER).base).toBe(TOWER.height);

    // And the same place on the building however the building is turned,
    // which is the whole reason it is said in the building's own frame.
    for (const yaw of [Math.PI / 2, Math.PI, -1.1]) {
      const turned = placed({ ...TOWER, yaw });
      expect(turned.along, `${yaw}`).toBeCloseTo(spot.along, 6);
      expect(turned.across, `${yaw}`).toBeCloseTo(spot.across, 6);
      expect(turned.facing, `${yaw}`).toBeCloseTo(spot.facing, 6);
      // Somewhere else in the world, though: this is a real turn.
      expect(withLandmark({ ...TOWER, yaw }).people[0]!.x).not.toBeCloseTo(
        withLandmark(TOWER).people[0]!.x,
        1,
      );
    }
  });

  it('makes a person solid, and two metres of them', () => {
    // Something to fly round rather than through, and the only thing in the
    // world whose size you already know.
    const layout = withLandmark(TOWER);
    const person = layout.people[0]!;
    const field = createColliderField(layout.boxes);
    expect(field.heightAt(person.x, person.z)).toBeCloseTo(TOWER.height + 2, 6);
  });

  it('stands somebody on a landmark that has no terrace at all', () => {
    // A terrace is where somebody stands when a landmark has one. It is not
    // what makes standing possible, which is what this used to assert -- and
    // it was a limitation being written down as an intention. A plain-roofed
    // block puts them on the roof.
    const { penthouse: _, ...plain } = TOWER;
    const [person] = withLandmark(plain).people;
    expect(person).toBeDefined();
    expect(person!.base).toBe(TOWER.height);
  });

  it('stands somebody beside a landmark that lies flat', () => {
    // Which is the case the old rule made impossible: a patch of concrete has
    // no terrace, no roof and nothing to fly into, and somebody standing next
    // to one is still somebody. Placed along and across it like anyone else,
    // and free to be past its edge -- beside is a place too.
    const beside: Landmark = { ...SLAB, people: [{ along: -6, across: 0, facing: 0 }] };
    const [person] = withLandmark(beside).people;
    expect(person).toBeDefined();
    // On the ground, six metres along from the middle, which is a metre and a
    // half clear of a nine-metre slab.
    expect(person!.base).toBe(0);
    expect(person!.x).toBeCloseTo(SLAB.x - 6, 9);
    expect(person!.z).toBeCloseTo(SLAB.z, 9);

    // And solid: two metres of somebody is something to fly round.
    const field = createColliderField(withLandmark(beside).boxes);
    expect(field.heightAt(person!.x, person!.z)).toBeCloseTo(2, 6);
  });

  it('plants nothing where there is no terrace to plant', () => {
    // A landmark with no penthouse has a roof, not a terrace, and a bed of
    // bushes on the thing you are meant to land on would be a trap.
    const { penthouse: _, ...plain } = TOWER;
    expect(withLandmark(plain).bushes).toEqual([]);
    expect(terraceOf(plain)).toBeNull();
  });

  it('reserves a forecourt without making it solid', () => {
    // The two halves of what a petrol station is. It keeps its ground like
    // every other described thing -- no house built through it, no tree
    // planted on it -- but the ground itself is somewhere to fly: what you
    // cannot fly through is the hut, the pump and the car standing on it.
    const built = withLandmark(STATION);
    const field = createColliderField(built.boxes);
    const spot = (along: number, across: number) => pointOn(STATION, along, across);
    const { hut, pump, car } = STATION.station!;

    const shed = spot(hut.along, hut.across);
    expect(field.heightAt(shed.x, shed.z)).toBeCloseTo(hut.height, 6);
    const island = spot(pump.along, pump.across);
    expect(field.heightAt(island.x, island.z)).toBeCloseTo(PUMP.height, 6);
    const parked = spot(car.along, car.across);
    expect(field.heightAt(parked.x, parked.z)).toBeCloseTo(CAR.height, 6);

    // And the open forecourt, which a bird can fly the length of at head
    // height. The lane is inside the site on purpose: what is being asserted
    // is that the reserved ground is empty, not that the district is.
    const open = spot(-7, 5);
    expect(field.heightAt(open.x, open.z)).toBe(-Infinity);
    const from = spot(-8.5, 5.5);
    const to = spot(8.5, 5.5);
    expect(field.sweep(vec(from.x, 1.2, from.z), vec(to.x, 1.2, to.z), 0.22)).toBeNull();

    // Reserved all the same: the generator builds here without it.
    const bare = buildLayoutFromMap(mapOf(BLOCK, [PARK]), defaultMapWorldOptions);
    const inside = (things: readonly { x: number; z: number }[]) =>
      things.filter((thing) => taken(STATION, thing.x, thing.z));
    expect(inside([...bare.buildings, ...bare.trees]).length).toBeGreaterThan(0);
    const kept = buildLayoutFromMap(mapOf(BLOCK, [PARK]), {
      ...defaultMapWorldOptions,
      landmarks: [STATION],
    });
    expect(inside([...kept.buildings, ...kept.trees])).toEqual([]);
  });

  it('describes nothing when no landmarks are given', () => {
    expect(buildLayoutFromMap(mapOf(BLOCK), defaultMapWorldOptions).landmarks).toEqual([]);
  });
});

describe('leaving the railway alone', () => {
  /**
   * Two lines: one down the frontage on the south side of the block, and one
   * straight across the courtyard.
   *
   * Both are needed. A line in the building band never meets a tree, so on its
   * own it leaves the planting rule untested; one through the middle never
   * meets a house.
   */
  const THROUGH: Rail[] = [
    { kind: 'rail', width: 8, points: [[0, 30], [200, 30]] },
    { kind: 'rail', width: 8, points: [[0, 100], [200, 100]] },
  ];
  /** And a tramway in the carriageway, where a tramway belongs. */
  const TRAM: Rail[] = [{ kind: 'tram', width: 6, points: [[0, 0], [200, 0]] }];

  const layout = buildLayoutFromMap(mapOf(BLOCK, [], THROUGH));
  const track = indexStreets(THROUGH);

  const onTheTrack = (b: { x: number; z: number; width: number; depth: number; yaw?: number }) =>
    footprintSamples(b.x, b.z, b.width, b.depth, b.yaw ?? 0, 2).some(([x, z]) => {
      const rail = track.nearest(x, z, 60);
      return rail !== null && rail.distance < rail.width / 2;
    });

  it('builds nothing whose footprint reaches onto the track', () => {
    for (const building of layout.buildings) {
      expect(onTheTrack(building), `${building.x},${building.z}`).toBe(false);
    }
  });

  it('would have built there without it', () => {
    // Otherwise the test above proves nothing: the line has to be lying across
    // ground a building actually stands on.
    const without = buildLayoutFromMap(builtOn(BLOCK));
    expect(without.buildings.filter(onTheTrack).length).toBeGreaterThan(0);
    expect(layout.buildings.length).toBeLessThan(without.buildings.length);
  });

  it('plants nothing in the four-foot either', () => {
    for (const tree of layout.trees) {
      const rail = track.nearest(tree.x, tree.z, 60);
      expect(rail === null || rail.distance >= rail.width / 2, `${tree.x},${tree.z}`).toBe(true);
    }
  });

  it('leaves the street alone when the line is a tramway in it', () => {
    // A tram shares the carriageway, so its corridor is inside a street
    // nothing is built on anyway. It must cost the frontage nothing.
    const trammed = buildLayoutFromMap(mapOf(BLOCK, [], TRAM));
    const plain = buildLayoutFromMap(mapOf(BLOCK));
    expect(trammed.buildings).toEqual(plain.buildings);
  });

  it('carries the railways through for the renderer to draw', () => {
    expect(layout.rails).toEqual(THROUGH);
    expect(buildLayoutFromMap(mapOf(BLOCK)).rails).toEqual([]);
  });
});

describe('standing a train on the track', () => {
  const LINE: Rail[] = [{ kind: 'rail', width: 8, points: [[-300, 120], [300, 120]] }];
  const layout = buildLayoutFromMap(mapOf(BLOCK, [], LINE), {
    ...defaultMapWorldOptions,
    trains: [{ near: { x: 40, z: 118 }, cars: 4 }],
  });

  it('puts it on the line nearest where it was asked for', () => {
    expect(layout.trains).toHaveLength(1);
    const train = layout.trains[0]!;
    expect(train.line).toBe(LINE[0]);
    expect(train.vehicles).toHaveLength(5);
    for (const vehicle of train.vehicles) expect(vehicle.z).toBeCloseTo(120, 6);
  });

  it('stands the whole train on the line, not half off the end', () => {
    const train = layout.trains[0]!;
    const along = lineLength(train.line.points);
    expect(train.along).toBeLessThanOrEqual(along + 1e-9);
    expect(train.along - consistLength(4, 'wagon')).toBeGreaterThanOrEqual(-1e-9);
  });

  it('keeps its solids out of the world, and carries them itself', () => {
    // The city is built into a grid once and never touched again. A train is
    // somewhere else every tick, so it cannot be in there -- it brings its own
    // field, and the two are asked in turn.
    const wagon = layout.trains[0]!.vehicles[2]!;
    const city = createColliderField(layout.boxes);
    expect(city.heightAt(wagon.x, wagon.z)).toBe(-Infinity);

    const rolling = createColliderField(trainBoxes(layout.trains[0]!.vehicles));
    expect(rolling.heightAt(wagon.x, wagon.z)).toBeCloseTo(WAGON.deck, 6);

    // And together they are one solid world, which is what the sim is handed.
    const both = combineColliders(city, rolling);
    expect(both.heightAt(wagon.x, wagon.z)).toBeCloseTo(WAGON.deck, 6);
    expect(both.boxCount).toBe(city.boxCount + rolling.boxCount);
  });

  it('stands none when there is no railway to stand one on', () => {
    const bare = buildLayoutFromMap(mapOf(BLOCK), {
      ...defaultMapWorldOptions,
      trains: [{ near: { x: 40, z: 118 }, cars: 4 }],
    });
    expect(bare.trains).toEqual([]);
  });
});

describe('leaving green space alone', () => {
  const layout = buildLayoutFromMap(mapOf(BLOCK, [PARK]));

  it('builds nothing whose footprint reaches into a park', () => {
    for (const building of layout.buildings) {
      const footprint = footprintSamples(
        building.x,
        building.z,
        building.width,
        building.depth,
        building.yaw ?? 0,
      );
      expect(layout.green.anyInside(footprint), `${building.x},${building.z}`).toBe(false);
    }
  });

  it('would have built there without the park', () => {
    // Otherwise the test above proves nothing: the ground has to be somewhere
    // a building actually stands.
    const without = buildLayoutFromMap(builtOn(BLOCK));
    const inPark = without.buildings.filter((b) => layout.green.at(b.x, b.z));
    expect(inPark.length).toBeGreaterThan(0);
    expect(layout.buildings.length).toBeLessThan(without.buildings.length);
  });

  it('carries the areas through for the renderer to draw', () => {
    expect(layout.areas).toEqual([PARK]);
  });

  it('copes with a map that has no green space at all', () => {
    const bare = buildLayoutFromMap(builtOn(BLOCK));
    expect(bare.green.count).toBe(0);
    expect(bare.buildings.length).toBeGreaterThan(20);
  });
});


describe('a tram service on the real map', () => {
  /**
   * The whole map, because this is a claim about the map and not about a
   * shape invented to make the claim come true. Built once: it is the most
   * expensive thing any test in this file does.
   */
  const city = buildLayoutFromMap(homeMap as unknown as MapData, {
    ...defaultMapWorldOptions,
    trains: [],
    fill: [{ stock: 'tram', cars: 4, speed: 10, minRoute: 320, most: 30, headway: 90 }],
  });
  const trams = city.trains.filter((train) => train.stock === 'tram');
  const routes = [...new Set(trams.map((tram) => tram.line))];

  /**
   * How far each pair of routes runs abreast, and whether it runs the same
   * way while it does.
   *
   * Every two metres, which is as fine as `keepRight` itself has to look and
   * for the same reason: the tracks of a pair are three metres apart and a
   * look on one has to land beside a look on the other rather than up the
   * line from it, or the two are not abeam and nothing is counted at all.
   *
   * Measured from the lower-numbered route of each pair only, so a stretch of
   * street is counted once rather than once from each side.
   */
  const abreast = (() => {
    const STEP = 2;
    const BAND = 9;
    interface Look {
      route: number;
      x: number;
      z: number;
      dx: number;
      dz: number;
    }
    const looks: Look[] = [];
    routes.forEach((line, route) => {
      const run = lineLength(line.points);
      for (let along = 0; along <= run; along += STEP) {
        const here = pointAlong(line.points, along);
        const ahead = pointAlong(line.points, Math.min(along + 1, run));
        if (!here || !ahead) continue;
        const dx = ahead.x - here.x;
        const dz = ahead.z - here.z;
        const span = Math.hypot(dx, dz);
        if (span < 1e-6) continue;
        looks.push({ route, x: here.x, z: here.z, dx: dx / span, dz: dz / span });
      }
    });

    const cells = new Map<string, Look[]>();
    const key = (x: number, z: number) => `${Math.floor(x / BAND)},${Math.floor(z / BAND)}`;
    for (const look of looks) {
      const cell = cells.get(key(look.x, look.z));
      if (cell) cell.push(look);
      else cells.set(key(look.x, look.z), [look]);
    }

    const together = new Map<string, { same: number; opposed: number }>();
    for (const look of looks) {
      let best: { gap: number; along: number; other: number } | null = null;
      for (let cx = -BAND; cx <= BAND; cx += BAND)
        for (let cz = -BAND; cz <= BAND; cz += BAND)
          for (const other of cells.get(key(look.x + cx, look.z + cz)) ?? []) {
            if (other.route <= look.route) continue;
            const ax = other.x - look.x;
            const az = other.z - look.z;
            const gap = Math.hypot(ax, az);
            // Nearer than two metres is the same rails under another route's
            // name, which is allowed and is not a pair of tracks.
            if (gap < 2 || gap > BAND) continue;
            const along = look.dx * other.dx + look.dz * other.dz;
            if (Math.abs(along) < 0.9) continue;
            // Beside it and not in front of it: two ways of one line meeting
            // end to end are parallel and near, and are not a pair either.
            if (Math.abs((ax * look.dx + az * look.dz) / gap) > 0.35) continue;
            if (best && best.gap <= gap) continue;
            best = { gap, along, other: other.route };
          }
      if (!best) continue;
      const at = `${look.route}:${best.other}`;
      const run = together.get(at) ?? { same: 0, opposed: 0 };
      if (best.along > 0) run.same += STEP;
      else run.opposed += STEP;
      together.set(at, run);
    }
    return [...together.values()];
  })();

  it('never runs two trams the same way down one street', () => {
    // The bug, as it looks from the cockpit: two trams abreast on the two
    // tracks of a street, both going the same way.
    //
    // The direction used to come from a route's index in a list, which is
    // not related to the geometry at all -- measured over this map, sixty-
    // nine of the hundred and thirty-nine parallel pairs came out agreeing,
    // and the two longest routes ran together the same way for four
    // kilometres nine hundred.
    //
    // What is left is junctions. Where two tracks converge to cross or to
    // merge they are briefly beside each other pointing the same way, which
    // is not two tracks of a street and is nothing anyone can see from a
    // pigeon. A street is hundreds of metres; the bar is a hundred and
    // fifty, and the longest that survives is a hundred.
    const worst = Math.max(...abreast.map((run) => run.same));
    expect(worst, 'metres of one street run the same way').toBeLessThan(150);
  });

  it('finds the pairs of tracks at all, so the test above can fail', () => {
    // Without this, a rule that paired nothing with anything would sail
    // through the one above: no pairs, no disagreements, no failures. This
    // is the same measurement asked the other way round.
    const paired = abreast.reduce((run, pair) => run + pair.opposed, 0);
    expect(paired, 'metres of double track running opposite ways').toBeGreaterThan(5000);
  });

  it('runs a service on the long routes rather than one tram each', () => {
    // A player standing in a street watched one tram go by and then waited
    // for it to reach the end of the line and come all the way back: on the
    // longest route here, eight and a half kilometres, a quarter of an hour.
    const perRoute = new Map<unknown, number>();
    for (const tram of trams) perRoute.set(tram.line, (perRoute.get(tram.line) ?? 0) + 1);

    expect(Math.max(...perRoute.values()), 'the longest route carries several').toBeGreaterThan(5);
    expect(trams.length).toBeGreaterThan(perRoute.size * 2);
  });

  it('sends every tram off to come round again, and never to reverse', () => {
    // A tram that shuttles is wrong twice over: it spends half its life on
    // the wrong side of a double track, and it gets there by reversing in
    // the middle of a street.
    expect(trams.every((tram) => tram.turnaround === 'recycle')).toBe(true);
  });
});

describe('filling a railway rather than a tramway', () => {
  const SIDINGS: Rail[] = [
    { kind: 'rail', width: 8, points: [[-900, 112], [900, 112]] },
    { kind: 'rail', width: 8, points: [[-900, 120], [900, 120]] },
  ];

  it('leaves the heavy railway shunting up and down, one train to a line', () => {
    // Not everything on rails is a service. A yard train reverses at the
    // buffers and works back, which is what shunting is and what the
    // locomotive on one end is for -- and it is why a second train may not
    // be put on the same line behind it, however long the line: the two
    // would meet head-on the first time either turned round.
    const world = buildLayoutFromMap(mapOf(BLOCK, [], SIDINGS), {
      ...defaultMapWorldOptions,
      fill: [{ stock: 'carriage', cars: 3, speed: 14, minRoute: 1200, most: 8, headway: 30 }],
    });

    expect(world.trains).toHaveLength(2);
    expect(world.trains.every((train) => train.turnaround === 'shuttle')).toBe(true);
    // A headway of thirty seconds at fourteen metres a second would be a
    // train every 420 m on an 1800 m line, if this listened to it. It must
    // not.
    expect(new Set(world.trains.map((train) => train.line)).size).toBe(2);
  });
});

describe('two trains in one yard', () => {
  /** Three parallel sidings, as a yard has. */
  const SIDINGS: Rail[] = [
    { kind: 'rail', width: 8, points: [[-300, 112], [300, 112]] },
    { kind: 'rail', width: 8, points: [[-300, 120], [300, 120]] },
    { kind: 'rail', width: 8, points: [[-300, 128], [300, 128]] },
  ];
  const YARD = mapOf(BLOCK, [], SIDINGS);

  it('puts them on different tracks rather than inside each other', () => {
    // Both asked for the same place. A yard has parallel sidings, so the
    // second takes the next-roomiest of them; without that they both take
    // the roomiest and stand in the same rails.
    const world = buildLayoutFromMap(YARD, {
      ...defaultMapWorldOptions,
      trains: [
        { near: { x: 40, z: 118 }, cars: 4 },
        { near: { x: 40, z: 118 }, cars: 3, stock: 'carriage', speed: 0 },
      ],
    });

    expect(world.trains).toHaveLength(2);
    expect(world.trains[0]!.line).not.toBe(world.trains[1]!.line);
  });

  it('gives each the stock it asked for, and the speed', () => {
    const world = buildLayoutFromMap(YARD, {
      ...defaultMapWorldOptions,
      trains: [
        { near: { x: 40, z: 118 }, cars: 4 },
        { near: { x: 40, z: 118 }, cars: 3, stock: 'carriage', speed: 0 },
      ],
    });

    const [freight, passenger] = world.trains as [(typeof world.trains)[0], (typeof world.trains)[0]];
    expect(freight.stock).toBe('wagon');
    expect(freight.speed).toBeGreaterThan(0);
    expect(freight.vehicles.slice(1).every((v) => v.kind === 'wagon')).toBe(true);

    expect(passenger.stock).toBe('carriage');
    expect(passenger.speed).toBe(0);
    expect(passenger.vehicles[0]!.kind).toBe('engine');
    expect(passenger.vehicles.slice(1).every((v) => v.kind === 'carriage')).toBe(true);
  });

  /**
   * A yard whose short platform road carries on out of the station.
   *
   * Two roads: a long siding that goes nowhere, and a short platform whose
   * end is the start of a main line cut, as the map cuts them, into pieces.
   * A train that only knows about the way it stands on takes the siding and
   * shuffles; one that follows the switches takes the platform and leaves.
   */
  const STATION: Rail[] = [
    { kind: 'rail', width: 8, points: [[-300, 112], [300, 112]] },
    { kind: 'rail', width: 8, points: [[-100, 120], [60, 120]] },
    { kind: 'rail', width: 8, points: [[60, 120], [700, 120]] },
    { kind: 'rail', width: 8, points: [[700, 120], [1500, 120]] },
  ];

  it('runs one out of the station, on past the end of its own road', () => {
    const out = buildLayoutFromMap(mapOf(BLOCK, [], STATION), {
      ...defaultMapWorldOptions,
      trains: [{ near: { x: 40, z: 118 }, cars: 3, stock: 'carriage', runsOut: true }],
    });
    const shunter = buildLayoutFromMap(mapOf(BLOCK, [], STATION), {
      ...defaultMapWorldOptions,
      trains: [{ near: { x: 40, z: 118 }, cars: 3, stock: 'carriage' }],
    });

    // The one that stays takes the longest *way* it can reach. The one that
    // leaves takes whichever way starts the longest *run*, and ends up with
    // the whole main line instead of a piece of it.
    expect(lineLength(shunter.trains[0]!.line.points)).toBeCloseTo(640, 6);
    expect(lineLength(out.trains[0]!.line.points)).toBeCloseTo(1600, 6);
  });

  it('keeps everything else off the road it runs over', () => {
    // A standing train parked on a piece of the main line would be a train
    // this one comes through at speed. The pieces are not the road it was
    // seeded from, so nothing but the route knows they are spoken for.
    const world = buildLayoutFromMap(mapOf(BLOCK, [], STATION), {
      ...defaultMapWorldOptions,
      trains: [
        { near: { x: 40, z: 118 }, cars: 3, stock: 'carriage', runsOut: true },
        { near: { x: 40, z: 118 }, cars: 3, stock: 'carriage', speed: 0 },
        { near: { x: 40, z: 118 }, cars: 3, stock: 'carriage', speed: 0 },
      ],
    });

    // Four roads, but the route runs over three of them: the one place left
    // to stand is the siding, and only one of the two standing trains gets
    // it. Without the pieces being spoken for, the second train would take
    // the 640 m one the express comes through at speed.
    expect(world.trains).toHaveLength(2);
    expect(lineLength(world.trains[1]!.line.points)).toBeCloseTo(600, 6);
  });

  it('gives several roaming trains a road each, and no road twice', () => {
    // All of them out on the network at once. What keeps them apart is that
    // a route marks every way it runs over: the next train is choosing from
    // what is left, so two trains cannot end up running the same rails in
    // opposite directions.
    const world = buildLayoutFromMap(mapOf(BLOCK, [], STATION), {
      ...defaultMapWorldOptions,
      trains: [
        { near: { x: 40, z: 118 }, cars: 3, stock: 'carriage', speed: 15, runsOut: true },
        { near: { x: 40, z: 118 }, cars: 3, stock: 'carriage', speed: 11, runsOut: true },
      ],
    });

    expect(world.trains).toHaveLength(2);
    for (const train of world.trains) {
      expect(train.speed).toBeGreaterThan(0);
      expect(lineLength(train.line.points)).toBeGreaterThan(consistLength(3, 'carriage'));
    }

    // The main line to the first, the siding to the second, and the two of
    // them nowhere near each other: no point of one is within a track's
    // width of any point of the other.
    const [out, other] = world.trains as [(typeof world.trains)[0], (typeof world.trains)[0]];
    expect(lineLength(out.line.points)).toBeCloseTo(1600, 6);
    expect(lineLength(other.line.points)).toBeCloseTo(600, 6);
    for (const here of other.line.points) {
      for (const there of out.line.points) {
        expect(Math.hypot(here[0] - there[0], here[1] - there[1])).toBeGreaterThan(4);
      }
    }
  });

  it('will not route a train through one already standing on the line', () => {
    // The platform, two pieces of main line beyond it, and a siding off on
    // its own. A train standing in the middle piece is not on the way the
    // roamer starts from -- it is on the third way along the route -- so
    // nothing but the route knows it is in the road.
    const SHARED: Rail[] = [
      { kind: 'rail', width: 8, points: [[-300, 120], [60, 120]] },
      { kind: 'rail', width: 8, points: [[60, 120], [700, 120]] },
      { kind: 'rail', width: 8, points: [[700, 120], [1500, 120]] },
      { kind: 'rail', width: 8, points: [[-300, 104], [200, 104]] },
    ];
    const world = buildLayoutFromMap(mapOf(BLOCK, [], SHARED), {
      ...defaultMapWorldOptions,
      trains: [
        { near: { x: 40, z: 118 }, cars: 3, stock: 'carriage', speed: 0 },
        { near: { x: 40, z: 118 }, cars: 3, stock: 'carriage', speed: 12, runsOut: true },
      ],
    });

    expect(world.trains).toHaveLength(2);
    // The one standing takes the roomiest way it can reach, which is a piece
    // of the main line.
    expect(lineLength(world.trains[0]!.line.points)).toBeCloseTo(640, 6);
    // So the roamer takes the siding and its 500 m rather than the platform
    // and the 1,800 m run that goes straight through the other train.
    expect(lineLength(world.trains[1]!.line.points)).toBeCloseTo(500, 6);
  });

  it('puts a tram on the tramway and a train on the railway', () => {
    // Nothing said so before, and nothing had to: every train asked for was
    // asked for over a goods yard where the roomiest line nearby happened to
    // be heavy rail every time. A tram asked for at the same point must not
    // take the siding, and a train must not take the tramway.
    const MIXED: Rail[] = [
      { kind: 'rail', width: 8, points: [[-300, 112], [300, 112]] },
      { kind: 'tram', width: 6, points: [[-200, 124], [200, 124]] },
    ];
    const world = buildLayoutFromMap(mapOf(BLOCK, [], MIXED), {
      ...defaultMapWorldOptions,
      trains: [
        { near: { x: 40, z: 118 }, cars: 4, stock: 'tram', speed: 10 },
        { near: { x: 40, z: 118 }, cars: 3, stock: 'carriage', speed: 0 },
      ],
    });

    expect(world.trains).toHaveLength(2);
    expect(world.trains[0]!.line.kind).toBe('tram');
    expect(world.trains[1]!.line.kind).toBe('rail');
    // Four cars and no locomotive.
    expect(world.trains[0]!.vehicles).toHaveLength(4);
    expect(world.trains[0]!.vehicles.every((v) => v.kind === 'tram')).toBe(true);
  });

  it('leaves a tram out when there is only railway to run on', () => {
    // Better than putting it on the railway. A tram on a main line is a
    // stranger thing to see than an empty tramway.
    const world = buildLayoutFromMap(mapOf(BLOCK, [], [
      { kind: 'rail', width: 8, points: [[-300, 112], [300, 112]] },
    ]), {
      ...defaultMapWorldOptions,
      trains: [{ near: { x: 40, z: 118 }, cars: 4, stock: 'tram', speed: 10 }],
    });
    expect(world.trains).toEqual([]);
  });

  it('sets off the way it was asked to, whichever way the line was drawn', () => {
    // Two railways over the same ground, traced in opposite orders. A train
    // asked to head south has to go south on both.
    //
    // A railway rather than a tramway, which it used to be. A bearing is for
    // stock that shuttles: it says which way to set off up and down a line,
    // and setting off is the only choice such a train has. A tram does not
    // get to choose -- the side of the road decides, from the track, and a
    // hand-written bearing there was a way of being wrong that looked like
    // being deliberate.
    for (const points of [
      [[0, -300], [0, 300]] as [number, number][],
      [[0, 300], [0, -300]] as [number, number][],
    ]) {
      const world = buildLayoutFromMap(mapOf(BLOCK, [], [{ kind: 'rail', width: 8, points }]), {
        ...defaultMapWorldOptions,
        trains: [{ near: { x: 0, z: 0 }, cars: 4, stock: 'carriage', speed: 10, setOff: 180 }],
      });
      const tram = world.trains[0]!;
      expect(tram).toBeDefined();

      // A step of its own length, and see which way the front of it moved.
      const before = tram.vehicles[0]!.z;
      const run = shuttle(
        lineLength(tram.line.points),
        consistLength(tram.cars, tram.stock),
        tram.along,
        tram.direction,
        20,
      );
      const after = layOutTrain(tram.line, run.along, tram.cars, tram.stock)[0]!.z;
      // South is +Z, north being -Z everywhere on this map.
      expect(after - before, `drawn ${JSON.stringify(points)}`).toBeGreaterThan(0);
    }
  });

  it('works a pair of tracks as a pair, one tram each and opposed', () => {
    // A double-track tramway. Its two roads are tried both ways round --
    // traced in the same order and in opposite orders -- because the order
    // somebody traced them into OpenStreetMap is the thing that must not be
    // what decides which way a tram goes.
    //
    // Both trams are asked for at the same point and *not* told which way to
    // go. They used to be, by hand, and that is what this is really about:
    // the bearings made the pair pass each other, so the test went green,
    // while saying nothing about whether either was on the correct side. The
    // track says it now, and the trams take what it says.
    const east: [number, number][] = [[-300, 120], [300, 120]];
    const tracings: Record<string, Rail[]> = {
      'drawn the same way': [
        { kind: 'tram', width: 6, points: east },
        { kind: 'tram', width: 6, points: east.map(([x, z]) => [x, z + 4]) },
      ],
      'drawn against each other': [
        { kind: 'tram', width: 6, points: east },
        { kind: 'tram', width: 6, points: [...east].reverse().map(([x, z]) => [x, z + 4]) },
      ],
    };

    for (const [how, rails] of Object.entries(tracings)) {
      const world = buildLayoutFromMap(mapOf(BLOCK, [], rails), {
        ...defaultMapWorldOptions,
        trains: [
          { near: { x: 0, z: 122 }, cars: 4, stock: 'tram', speed: 10 },
          { near: { x: 0, z: 122 }, cars: 4, stock: 'tram', speed: 10 },
        ],
      });

      expect(world.trains, how).toHaveLength(2);
      // One road each, and the roads are a pair rather than the same one
      // twice.
      const [first, second] = world.trains as [(typeof world.trains)[0], (typeof world.trains)[0]];
      expect(Math.abs(first.vehicles[0]!.z - second.vehicles[0]!.z), how).toBeCloseTo(4, 6);

      /** How far east the front of a tram moves over a step. */
      const travel = (tram: (typeof world.trains)[0]) => {
        const along = recycle(
          lineLength(tram.line.points),
          consistLength(tram.cars, tram.stock),
          tram.along,
          tram.direction,
          20,
        ).along;
        const after = layOutTrain(tram.line, along, tram.cars, tram.stock)[0]!;
        return after.x - tram.vehicles[0]!.x;
      };

      // Opposed, whichever way the map was drawn.
      expect(travel(first) * travel(second), how).toBeLessThan(0);

      // And on the correct sides of each other, which the bearings never
      // said. Hungary drives on the right, so the eastbound one is the
      // southerly of the pair: +Z is south, north being -Z.
      const eastbound = travel(first) > 0 ? first : second;
      const westbound = eastbound === first ? second : first;
      expect(eastbound.vehicles[0]!.z, how).toBeGreaterThan(westbound.vehicles[0]!.z);
    }
  });

  it('asks for only as many as there are tracks', () => {
    // A third train with nowhere to go is left out rather than stacked on
    // top of one of the others.
    const world = buildLayoutFromMap(YARD, {
      ...defaultMapWorldOptions,
      trains: [
        { near: { x: 40, z: 118 }, cars: 3 },
        { near: { x: 40, z: 118 }, cars: 3 },
        { near: { x: 40, z: 118 }, cars: 3 },
        { near: { x: 40, z: 118 }, cars: 3 },
        { near: { x: 40, z: 118 }, cars: 3 },
        { near: { x: 40, z: 118 }, cars: 3 },
      ],
    });
    const lines = new Set(world.trains.map((train) => train.line));
    expect(lines.size).toBe(world.trains.length);
  });
});

describe('buildings the map already knows about', () => {
  /** Two real outlines, as the baker writes them: [x, z, w, d, yaw, height]. */
  const OUTLINES = [
    [60, 60, 20, 12, 0, 18.6],
    [140, 60, 24, 14, 0.4, null],
  ];

  const withBuildings = (options: Partial<typeof defaultMapWorldOptions> = {}) =>
    buildLayoutFromMap({ ...mapOf(BLOCK), buildings: OUTLINES } as MapData, {
      ...defaultMapWorldOptions,
      ...options,
    });

  it('puts them where the map says, and stops inventing any', () => {
    // The generator's whole job was to invent a city that looked like one, and
    // it did that well -- frontages along the block edges, mitred at the
    // corners. What it could not do is be *this* city: every house it placed
    // was a plausible house in a plausible place, and the whole came out as a
    // European district that could have been anywhere.
    const world = withBuildings();
    expect(world.buildings).toHaveLength(OUTLINES.length);

    const first = world.buildings.find((b) => Math.abs(b.x - 60) < 0.001)!;
    expect(first, 'the outline arrived').toBeDefined();
    expect(first.z).toBe(60);
    expect(first.width).toBe(20);
    expect(first.depth).toBe(12);

    // And it is solid: a building the player can fly through is scenery.
    expect(world.boxes.length).toBeGreaterThanOrEqual(OUTLINES.length);
  });

  it('takes the height the building states, and its neighbour’s where it does not', () => {
    // A third of them say. The other two thirds used to get a made-up 16 to
    // 24 metres, which stood them about forty per cent taller than the ones
    // that do say; they take the nearest known height now. `heights.ts` has
    // the measurements; this is only that the world is wired to it.
    const world = withBuildings();
    const stated = world.buildings.find((b) => Math.abs(b.x - 60) < 0.001)!;
    expect(stated.height, 'as the map says').toBeCloseTo(18.6, 6);

    const silent = world.buildings.find((b) => Math.abs(b.x - 140) < 0.001)!;
    expect(silent.height, 'from the one eighty metres away').toBeCloseTo(18.6, 6);
  });

  it('lets a described thing keep its ground against a real one', () => {
    // The story wins. A level that names a building cannot have a block of
    // flats standing through it, and that was already true of the invented
    // ones -- it has to stay true now the buildings are real, because the map
    // has never heard of the loft.
    const world = withBuildings({
      landmarks: [
        { name: 'The Loft', x: 60, z: 60, width: 30, depth: 20, height: 24, margin: 8 },
      ],
    });

    expect(
      world.buildings.some((b) => Math.abs(b.x - 60) < 0.001),
      'the one standing on the loft is gone',
    ).toBe(false);
    expect(
      world.buildings.some((b) => Math.abs(b.x - 140) < 0.001),
      'and the one that is not, is not',
    ).toBe(true);
  });

});

describe('painted crossings', () => {
  /** A road running due east, with a crossing on it and one out in a field. */
  const EAST: Road[] = [
    { kind: 'secondary', width: 13, points: [[-200, 0], [200, 0]] },
  ];

  const withCrossings = (points: number[][]) =>
    buildLayoutFromMap({ ...mapOf(EAST), crossings: points } as MapData, defaultMapWorldOptions);

  it('lays them square across the carriageway', () => {
    // Which is what a zebra is: the stripes run the depth of the crossing,
    // the way the traffic goes, and repeat across the road so you step over
    // them rather than along them. Getting the two axes the wrong way round
    // paints a ladder lying down the middle of the street, and it is not the
    // sort of mistake a number will tell you about.
    const world = withCrossings([[0, 0]]);
    expect(world.crossings).toHaveLength(1);

    const crossing = world.crossings![0]!;
    // Local +X in world is (cos yaw, -sin yaw) -- the collider's convention --
    // and it has to run along the road, which here is due east.
    expect(Math.cos(crossing.yaw)).toBeCloseTo(1, 3);
    expect(-Math.sin(crossing.yaw)).toBeCloseTo(0, 3);
  });

  it('takes the width to paint from the road, not from a guess', () => {
    const world = withCrossings([[40, 0]]);
    expect(world.crossings![0]!.width).toBe(13);
  });

  it('drops one that is not on a road at all', () => {
    // A zebra painted across nothing, at a bearing nobody chose, is worse
    // than a junction with no zebra on it.
    const world = withCrossings([[0, 0], [0, 900]]);
    expect(world.crossings).toHaveLength(1);
  });

  it('has none where the map recorded none', () => {
    expect(buildLayoutFromMap(mapOf(EAST), defaultMapWorldOptions).crossings).toEqual([]);
  });
});

describe('trees that came off the map', () => {
  const EAST: Road[] = [{ kind: 'secondary', width: 13, points: [[-300, 0], [300, 0]] }];

  const planted = (points: number[][], options = {}) =>
    buildLayoutFromMap({ ...mapOf(EAST), trees: points } as MapData, {
      ...defaultMapWorldOptions,
      ...options,
    });

  it('gives them a sort the generator can never plant', () => {
    // The point of the whole thing: a street tree is a *record* -- somebody
    // stood in Józsefváros and wrote down that there is a tree here -- and
    // every other piece of greenery in the world is invented. A sort of its
    // own means the difference is visible from the air.
    const world = planted([[0, 30]]);
    const mine = world.trees.filter((tree) => tree.species === STREET_TREE);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.x).toBe(0);
    expect(mine[0]!.z).toBe(30);

    // And nothing invented can be mistaken for one: the generated range stops
    // short of it, so `rand() * SPECIES` cannot reach it.
    expect(STREET_TREE).toBeGreaterThanOrEqual(SPECIES);
    const invented = world.trees.filter((tree) => tree.species !== STREET_TREE);
    for (const tree of invented) expect(tree.species).toBeLessThan(SPECIES);
  });

  it('does not grow one through a wall', () => {
    // A tree recorded on a pavement and a building recorded to the kerb can
    // overlap by a metre in the data, and a plane tree coming out of a
    // first-floor window is funnier than it is good.
    const world = buildLayoutFromMap(
      {
        ...mapOf(EAST),
        buildings: [[80, 40, 30, 20, 0, 15]],
        trees: [[80, 40], [200, 40]],
      } as MapData,
      defaultMapWorldOptions,
    );
    const mine = world.trees.filter((tree) => tree.species === STREET_TREE);
    expect(mine, 'the one in the building is gone').toHaveLength(1);
    expect(mine[0]!.x).toBe(200);
  });

  it('keeps off ground a described thing has taken', () => {
    // Same rule as a building: a level that names a place cannot have a tree
    // standing in the middle of it.
    const world = planted([[0, 30], [200, 30]], {
      landmarks: [
        { name: 'The Slab', x: 0, z: 30, width: 9, depth: 9, height: 0, margin: 10 },
      ],
    });
    const mine = world.trees.filter((tree) => tree.species === STREET_TREE);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.x).toBe(200);
  });

  it('plants none where the map recorded none', () => {
    const world = buildLayoutFromMap(mapOf(EAST), defaultMapWorldOptions);
    expect(world.trees.some((tree) => tree.species === STREET_TREE)).toBe(false);
  });
});

/**
 * A flyover clear of everything else in this file, so a sweep under it can
 * only ever have met the bridge.
 *
 * Eighty-five metres of three-lane primary road, which is Kerepesi ut over
 * the throat of Keleti station to within a metre or two -- the case the whole
 * feature exists for.
 */
const FLYOVER: Bridge = { kind: 'primary', width: 16, points: [[-42, 500], [43, 500]], layer: 1 };

const carrying = (bridge: Bridge): MapData => ({ ...mapOf(BLOCK), bridges: [bridge] });

describe('a road carried over something', () => {
  it('leaves a gap along the ground to fly through', () => {
    // The point of the whole thing. A bridge drawn flat is a road painted
    // across four running lines, and a bridge that is solid all the way down
    // is a wall across them instead -- neither is a thing you can go under.
    const world = buildLayoutFromMap(carrying(FLYOVER));
    const under = createColliderField(world.boxes);
    expect(under.sweep(vec(-30, 2, 500), vec(30, 2, 500), 0.25)).toBeNull();
  });

  it('stops a bird that flies up into the underside of it', () => {
    // The other half of the same claim: the gap is a gap because there is
    // something over it.
    const world = buildLayoutFromMap(carrying(FLYOVER));
    const hit = createColliderField(world.boxes).sweep(vec(0.5, 2, 500), vec(0.5, 14, 500), 0.25);
    expect(hit).not.toBeNull();
    expect(hit!.point.y).toBeGreaterThan(CLEARANCE * 0.8);
  });

  it('can be landed on, at the height the road surface is drawn at', () => {
    // A deck is a roof as far as a pigeon is concerned, and one it cannot
    // settle on is a bridge you fall through.
    const world = buildLayoutFromMap(carrying(FLYOVER));
    const down = createColliderField(world.boxes).sweep(vec(0.5, 20, 500), vec(0.5, 3, 500), 0.25);
    expect(down).not.toBeNull();
    expect(down!.point.y).toBeGreaterThan(CLEARANCE);
    expect(down!.normal.y).toBeGreaterThan(0.9);
  });

  it('hands the deck on to be drawn, rather than only boxing it', () => {
    // Boxed and not drawn is an invisible wall in the sky; the two come from
    // one place so that they cannot part company.
    expect(buildLayoutFromMap(carrying(FLYOVER)).bridges).toEqual([FLYOVER]);
    expect(buildLayoutFromMap(mapOf(BLOCK)).bridges).toEqual([]);
  });

  it('leaves the ground under it clear for whatever it crosses', () => {
    // Nothing of the bridge reaches the floor between its ends: a solid
    // standing on the ground under a flyover is a pier, and a pier across a
    // railway is worse than no bridge at all.
    const world = buildLayoutFromMap(carrying(FLYOVER));
    const along = createColliderField(world.boxes);
    // Started well outside the deck's own width, on purpose: a sweep that
    // begins inside a box has no face to enter by and comes back with
    // nothing, so a test run from under the bridge would pass however solid
    // the bridge was.
    for (let x = -25; x <= 25; x += 5) {
      expect(along.sweep(vec(x, 0.4, 484), vec(x, 0.4, 516), 0.25)).toBeNull();
    }
  });
});

describe('the bridges in the baked map', () => {
  const map = homeMap as unknown as MapData;
  const bridges = map.bridges ?? [];

  it('carries the flyover the feature was built for', () => {
    // Kerepesi ut over the throat of Keleti, as two ways -- one carriageway
    // each -- with four running lines underneath. If the fetch ever stops
    // filing bridges, this is the thing that quietly goes back to being a
    // road painted across a railway.
    const spanning = bridges.filter((bridge) => {
      const [x0, z0] = bridge.points[0]!;
      const [x1, z1] = bridge.points[bridge.points.length - 1]!;
      const span = Math.hypot(x1 - x0, z1 - z0);
      const mx = (x0 + x1) / 2;
      const mz = (z0 + z1) / 2;
      return (map.rails ?? []).some((rail) =>
        rail.points.some(([rx, rz]) => Math.hypot(rx - mx, rz - mz) < span / 2),
      );
    });
    expect(spanning.length).toBeGreaterThanOrEqual(2);
  });

  it('does not also paint them flat', () => {
    // The two lists are cut from the same query, and a bridge left in both
    // would be drawn twice: once raised, and once as tarmac across whatever
    // it is supposed to be going over.
    const ends = new Set(
      (map.roads ?? []).map((road) => JSON.stringify([road.points[0], road.points[road.points.length - 1]])),
    );
    for (const bridge of bridges) {
      const both = JSON.stringify([bridge.points[0], bridge.points[bridge.points.length - 1]]);
      expect(ends.has(both)).toBe(false);
    }
  });
});

describe('shop signs', () => {
  /**
   * A building on the block's north side, and a shop inside it.
   *
   * The street the block is drawn round runs along z = 0, so the sign has a
   * street to face and a wrong way to face it.
   */
  const SHOP_BUILDING = [100, 30, 40, 20, 0, 15];
  const signed = (
    signs: number[][],
    brands: string[] = ['Tesco'],
    buildings: number[][] = [SHOP_BUILDING],
  ): MapData => ({ ...mapOf(BLOCK), buildings, brands, signs });

  it('stands the sign on the roof of the shop’s own building', () => {
    // Not on the ground and not in the air. The levels release the bird
    // between 18 and 150 m up over roofs whose median is 14, so a sign at
    // street level is a sign under the player on ten levels of thirteen.
    const world = buildLayoutFromMap(signed([[105, 32, 0]]));
    expect(world.signs).toHaveLength(1);
    const sign = world.signs![0]!;
    expect(sign.brand).toBe('Tesco');
    expect(sign.base).toBe(15);
    expect(sign.x).toBeCloseTo(100, 6);
    expect(sign.z).toBeCloseTo(30, 6);
  });

  it('faces the street the shop is on', () => {
    // A hoarding facing the back of the block says nothing to anybody. The
    // street here is at z = 0 and the building at z = 30, so it has to look
    // north -- which on this map is -Z, and the yaw whose forward is -Z is
    // nought.
    const sign = buildLayoutFromMap(signed([[105, 32, 0]])).signs![0]!;
    const forward = { x: -Math.sin(sign.yaw), z: -Math.cos(sign.yaw) };
    expect(forward.z).toBeLessThan(-0.9);
    expect(Math.abs(forward.x)).toBeLessThan(0.2);
  });

  it('puts one on a roof, however many shops are under it', () => {
    // Two in one block of flats is ordinary -- a grocer and a filling station
    // share a building on the real map -- and two hoardings on one roof reads
    // as a mistake rather than as two shops.
    const world = buildLayoutFromMap(
      signed([[95, 28, 0], [108, 34, 1]], ['Tesco', 'Spar']),
    );
    expect(world.signs).toHaveLength(1);
  });

  it('gives none to a shop with nothing near enough to stand one on', () => {
    // A forecourt kiosk in the middle of a filling station has no building.
    // Two of the eighty-eight on the real map are like this, and a name
    // hanging over open ground would be worse than no name.
    //
    // Forty metres out, which is the distance that tests the rule: the index
    // is a grid of sixty-metre cells, so a shop half a kilometre from
    // anything is rejected by the grid whatever the reach is set to, and a
    // test placed out there passes with the reach removed.
    expect(buildLayoutFromMap(signed([[100, 70, 0]])).signs).toEqual([]);
    // And just inside it, the same shop does get one -- or the rule above
    // would be satisfied by never signing anything.
    expect(buildLayoutFromMap(signed([[100, 52, 0]])).signs).toHaveLength(1);
  });

  it('never hangs the board off the end of the roof', () => {
    // A hoarding wider than the building it is bolted to is a hoarding in
    // mid-air. These roofs run from 10 x 8 m to 167 x 118 on the real map, so
    // the width has to come from the roof rather than be a number.
    // Six metres across, which is narrower than the narrowest board the
    // width rule would otherwise settle on -- that is the case the clamp is
    // for, and a wider building does not test it at all.
    const small = [100, 30, 6, 5, 0, 15];
    const sign = buildLayoutFromMap(signed([[100, 30, 0]], ['Tesco'], [small])).signs![0]!;
    expect(sign.width).toBeLessThanOrEqual(6);
    expect(sign.width).toBeGreaterThan(0);
  });

  it('does not sign a building the story or a railway took away', () => {
    // The buildings are filtered after they arrive -- a described landmark
    // and a goods yard both clear the ground they stand on -- and a sign left
    // behind would be a name floating over an empty plot.
    const world = buildLayoutFromMap(signed([[105, 32, 0]]), {
      ...defaultMapWorldOptions,
      landmarks: [
        { name: 'The Loft', x: 100, z: 30, width: 60, depth: 40, height: 20, yaw: 0 },
      ],
    });
    expect(world.buildings.some((b) => Math.abs(b.x - 100) < 1)).toBe(false);
    expect(world.signs).toEqual([]);
  });
});
