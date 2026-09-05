import { describe, expect, it } from 'vitest';
import { buildLayoutFromMap, defaultMapWorldOptions } from './from-map';
import { indexStreets, type MapData, type Road } from './streets';
import { footprintSamples, type Area } from './areas';
import { distanceToEdges, pointInPolygon } from './polygon';
import { createColliderField, worldBounds } from '../sim/collision';
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

const mapOf = (roads: Road[], areas: Area[] = []): MapData => ({
  name: 'test',
  centre: [0, 0],
  radius: 300,
  attribution: 'test',
  roads,
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

  it('marks exactly one building as the target, the one nearest it', () => {
    const home = { x: 40, z: 40 };
    const homing = buildLayoutFromMap(mapOf(BLOCK), { ...defaultMapWorldOptions, target: home });

    const marked = homing.buildings.filter((b) => b.isTarget);
    expect(marked).toHaveLength(1);
    expect(homing.target).toBe(marked[0]);

    const away = (b: { x: number; z: number }) => Math.hypot(b.x - home.x, b.z - home.z);
    expect(away(homing.target!)).toBeCloseTo(Math.min(...homing.buildings.map(away)), 9);
  });

  it('marks nothing when there is nowhere to home to', () => {
    expect(layout.target).toBeNull();
    expect(layout.buildings.some((b) => b.isTarget)).toBe(false);
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
