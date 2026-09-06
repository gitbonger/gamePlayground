import { describe, expect, it } from 'vitest';
import { buildLayoutFromMap, defaultMapWorldOptions } from './from-map';
import { nestOn, penthouseOf, terraceOf, type Landmark } from './layout';
import { indexStreets, type MapData, type Rail, type Road } from './streets';
import { footprintSamples, type Area } from './areas';
import { distanceToEdges, pointInPolygon } from './polygon';
import { consistLength, layOutTrain, lineLength, shuttle, trainBoxes, WAGON } from './train';
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

const mapOf = (roads: Road[], areas: Area[] = [], rails: Rail[] = []): MapData => ({
  name: 'test',
  centre: [0, 0],
  radius: 300,
  attribution: 'test',
  roads,
  rails,
  areas,
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

describe('building a perimeter block', () => {
  const layout = buildLayoutFromMap(mapOf(BLOCK));
  const collider = createColliderField(layout.boxes);
  const MIDDLE = vec(100, 6, 100);

  it('builds all the way round the block it found', () => {
    expect(layout.blocks).toHaveLength(1);
    expect(layout.buildings.length).toBeGreaterThan(20);
    expect(layout.boxes).toHaveLength(layout.buildings.length);
  });

  it('closes the ring, so the courtyard is walled in on every side', () => {
    // The whole point of a perimeter block, and the thing a row of separate
    // houses can never do: leave the middle in any direction at all and you
    // meet building before you reach the street.
    for (let i = 0; i < 24; i += 1) {
      const bearing = (i / 24) * Math.PI * 2;
      const out = vec(100 + Math.sin(bearing) * 200, 6, 100 + Math.cos(bearing) * 200);
      expect(collider.sweep(MIDDLE, out, 0.22), `bearing ${Math.round((bearing * 180) / Math.PI)}`).not.toBeNull();
    }
  });

  it('leaves the courtyard itself open', () => {
    // Walled in, not filled in. There is somewhere in there to fly.
    expect(layout.gardens).toHaveLength(1);

    for (let i = 0; i < 24; i += 1) {
      const bearing = (i / 24) * Math.PI * 2;
      const out = vec(100 + Math.sin(bearing) * 60, 6, 100 + Math.cos(bearing) * 60);
      expect(collider.sweep(MIDDLE, out, 0.22), `bearing ${i}`).toBeNull();
    }
  });

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

  it('stands every near wall on a kerb, none adrift in the middle', () => {
    // Stated against the block ring rather than the nearest street, because at
    // a corner the nearest street is the one the building has its side to. The
    // ring runs along the centrelines, so the near wall of every building sits
    // exactly the kerb inset back from it -- at most the widest street on the
    // block, and no deeper. This is what "adjacent to a road" means once the
    // buildings are laid round the block rather than scattered along it.
    const ring = layout.blocks[0]!.ring;
    const widest =
      (16 / 2 + defaultMapWorldOptions.setback) * defaultMapWorldOptions.streetRoom;
    for (const building of layout.buildings) {
      expect(
        distanceToEdges(building.x, building.z, ring) - building.depth / 2,
        `${building.x},${building.z}`,
      ).toBeLessThanOrEqual(widest + 1e-6);
    }
  });

  it('leaves twice the carriageway and its setbacks between facing frontages', () => {
    // Flying down an 8 m street between two walls 12 m apart is not flying, it
    // is threading. Doubled, the gap is something a pigeon can use.
    const facing = layout.buildings.map((building) => {
      const street = layout.streets.nearest(building.x, building.z, 300)!;
      return {
        gap: 2 * (street.distance - building.depth / 2),
        plain: street.width + 2 * defaultMapWorldOptions.setback,
      };
    });

    for (const { gap, plain } of facing) {
      expect(gap).toBeGreaterThanOrEqual(plain * defaultMapWorldOptions.streetRoom - 1e-6);
    }

    // And a narrow one gets exactly the doubling, not merely more than it.
    const side = facing.filter((f) => f.plain === 8 + 2 * defaultMapWorldOptions.setback);
    expect(side.length).toBeGreaterThan(0);
    expect(Math.min(...side.map((f) => f.gap))).toBeCloseTo(24, 6);
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

  it('gives every house a frontage of the size asked for', () => {
    for (const building of layout.buildings) {
      expect(building.width).toBeLessThanOrEqual(defaultMapWorldOptions.maxFrontage + 1e-9);
      expect(building.depth).toBeCloseTo(defaultMapWorldOptions.wingDepth, 9);
    }
  });

  it('builds to an even height, with a stepped roofline', () => {
    // This neighbourhood is uniformly about seven floors, so heights come from
    // a flat band rather than from how important the road is.
    for (const building of layout.buildings) {
      expect(building.height).toBeGreaterThanOrEqual(defaultMapWorldOptions.minHeight);
      expect(building.height).toBeLessThanOrEqual(defaultMapWorldOptions.maxHeight);
    }

    // Even is not the same as identical. Neighbours differ by a storey or two,
    // which is what stops a block reading as one extruded shape.
    const heights = new Set(layout.buildings.map((b) => Math.round(b.height)));
    expect(heights.size).toBeGreaterThan(3);
  });

  it('fills a block with no room for a courtyard solid instead', () => {
    // Small blocks in this district really are solid, and a 40 m one has no
    // room for two wings and a garden between them.
    const small: Road[] = [
      { kind: 'residential', width: 8, points: [[-20, 0], [0, 0], [40, 0], [60, 0]] },
      { kind: 'residential', width: 8, points: [[-20, 40], [0, 40], [40, 40], [60, 40]] },
      { kind: 'residential', width: 8, points: [[0, -20], [0, 0], [0, 40], [0, 60]] },
      { kind: 'residential', width: 8, points: [[40, -20], [40, 0], [40, 40], [40, 60]] },
    ];
    const dense = buildLayoutFromMap(mapOf(small));
    expect(dense.blocks).toHaveLength(1);
    expect(dense.gardens).toHaveLength(0);
    expect(dense.buildings.length).toBeGreaterThan(0);

    // Solid all the way through: no hole to fly into.
    const wall = createColliderField(dense.boxes);
    expect(wall.sweep(vec(20, 6, -30), vec(20, 6, 70), 0.22)).not.toBeNull();
  });

  it('is deterministic for a given map and seed', () => {
    expect(buildLayoutFromMap(mapOf(BLOCK)).buildings).toEqual(layout.buildings);
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
    canopy: { trunk: 1.5, skirt: 7 },
    nest: { along: -1.6, across: 0.75 },
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
    const plain = buildLayoutFromMap(mapOf(BLOCK), defaultMapWorldOptions);
    const onIt = (buildings: readonly { x: number; z: number; width: number; depth: number; yaw?: number }[]) =>
      buildings.filter((b) =>
        footprintSamples(b.x, b.z, b.width, b.depth, b.yaw ?? 0).some(([x, z]) =>
          taken(TOWER, x, z),
        ),
      );

    // The ground it takes is ground the generator would otherwise have built
    // on, or this proves nothing.
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

  it('stands nobody where there is no terrace', () => {
    const { penthouse: _, ...plain } = TOWER;
    expect(withLandmark(plain).people).toEqual([]);
  });

  it('plants nothing where there is no terrace to plant', () => {
    // A landmark with no penthouse has a roof, not a terrace, and a bed of
    // bushes on the thing you are meant to land on would be a trap.
    const { penthouse: _, ...plain } = TOWER;
    expect(withLandmark(plain).bushes).toEqual([]);
    expect(terraceOf(plain)).toBeNull();
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
    // ground the generator actually wanted to build on.
    const without = buildLayoutFromMap(mapOf(BLOCK));
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
    // the generator actually wanted to build.
    const without = buildLayoutFromMap(mapOf(BLOCK));
    const inPark = without.buildings.filter((b) => layout.green.at(b.x, b.z));
    expect(inPark.length).toBeGreaterThan(0);
    expect(layout.buildings.length).toBeLessThan(without.buildings.length);
  });

  it('carries the areas through for the renderer to draw', () => {
    expect(layout.areas).toEqual([PARK]);
  });

  it('copes with a map that has no green space at all', () => {
    const bare = buildLayoutFromMap(mapOf(BLOCK));
    expect(bare.green.count).toBe(0);
    expect(bare.buildings.length).toBeGreaterThan(20);
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
    // Two tramways over the same ground, traced in opposite orders. A tram
    // asked to head south has to go south on both.
    for (const points of [
      [[0, -300], [0, 300]] as [number, number][],
      [[0, 300], [0, -300]] as [number, number][],
    ]) {
      const world = buildLayoutFromMap(mapOf(BLOCK, [], [{ kind: 'tram', width: 6, points }]), {
        ...defaultMapWorldOptions,
        trains: [{ near: { x: 0, z: 0 }, cars: 4, stock: 'tram', speed: 10, setOff: 180 }],
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
    // what decides which way a tram goes. Both trams are asked for at the
    // same point and told which way to go; each takes a road, and they run
    // against each other either way the map happens to be drawn.
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
          { near: { x: 0, z: 122 }, cars: 4, stock: 'tram', speed: 10, setOff: 90 },
          { near: { x: 0, z: 122 }, cars: 4, stock: 'tram', speed: 10, setOff: 270 },
        ],
      });

      expect(world.trains, how).toHaveLength(2);
      // One road each, and the roads are a pair rather than the same one
      // twice.
      const [up, down] = world.trains as [(typeof world.trains)[0], (typeof world.trains)[0]];
      expect(Math.abs(up.vehicles[0]!.z - down.vehicles[0]!.z), how).toBeCloseTo(4, 6);

      /** How far east the front of a tram moves over a step. */
      const travel = (tram: (typeof world.trains)[0]) => {
        const run = shuttle(
          lineLength(tram.line.points),
          consistLength(tram.cars, tram.stock),
          tram.along,
          tram.direction,
          20,
        );
        const after = layOutTrain(tram.line, run.along, tram.cars, tram.stock)[0]!;
        return after.x - tram.vehicles[0]!.x;
      };
      expect(travel(up), how).toBeGreaterThan(0);
      expect(travel(down), how).toBeLessThan(0);
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
