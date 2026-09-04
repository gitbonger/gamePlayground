import { describe, expect, it } from 'vitest';
import { buildLayoutFromMap, defaultMapWorldOptions } from './from-map';
import { indexStreets, type MapData, type Road } from './streets';
import { createColliderField, worldBounds } from '../sim/collision';
import { createBird, defaultParams, neutralControls, step } from '../sim/flight';
import { vec } from '../sim/math3';

/** A crossroads: one road north-south, one east-west, meeting at the origin. */
const CROSSROADS: Road[] = [
  { kind: 'primary', width: 16, points: [[0, -300], [0, 300]] },
  { kind: 'residential', width: 8, points: [[-300, 0], [300, 0]] },
];

const mapOf = (roads: Road[]): MapData => ({
  name: 'test',
  centre: [0, 0],
  radius: 300,
  attribution: 'test',
  roads,
});

describe('street index', () => {
  const streets = indexStreets(CROSSROADS);

  it('splits polylines into segments and bounds them', () => {
    expect(streets.segmentCount).toBe(2);
    expect(streets.bounds.minX).toBe(-300);
    expect(streets.bounds.maxZ).toBe(300);
  });

  it('finds the nearest road and which way it runs', () => {
    // Just east of the north-south road.
    const near = streets.nearest(9, -100, 60)!;
    expect(near.distance).toBeCloseTo(9, 6);
    expect(near.kind).toBe('primary');
    expect(Math.abs(near.dirZ)).toBeCloseTo(1, 6);

    // Just north of the east-west one.
    const other = streets.nearest(120, -5, 60)!;
    expect(other.distance).toBeCloseTo(5, 6);
    expect(other.kind).toBe('residential');
    expect(Math.abs(other.dirX)).toBeCloseTo(1, 6);
  });

  it('measures to the ends of a road, not past them', () => {
    // Beyond the north end of the north-south road, the nearest point is its
    // endpoint rather than an infinite line.
    expect(streets.nearest(0, -340, 100)!.distance).toBeCloseTo(40, 6);
  });

  it('gives up beyond the limit rather than searching the whole map', () => {
    expect(streets.nearest(2000, 2000, 50)).toBeNull();
  });
});

describe('building a world on real streets', () => {
  const layout = buildLayoutFromMap(mapOf(CROSSROADS));

  it('puts buildings along the streets', () => {
    expect(layout.buildings.length).toBeGreaterThan(20);
    expect(layout.boxes).toHaveLength(layout.buildings.length);
  });

  it('never lets a building overhang the carriageway it fronts', () => {
    // Measured to the near wall, not the centre: a deep building set back only
    // by its centre still sticks out into the road.
    for (const building of layout.buildings) {
      const street = layout.streets.nearest(building.x, building.z, 200)!;
      const nearWall = street.distance - building.depth / 2;
      expect(nearWall).toBeGreaterThanOrEqual(street.width / 2);
    }
  });

  it('keeps the middle of a block clear', () => {
    // Everything sits within the frontage band, so blocks have open interiors
    // rather than being filled solid.
    for (const building of layout.buildings) {
      const street = layout.streets.nearest(building.x, building.z, 500)!;
      const behindTheKerb =
        street.distance - (street.width / 2 + defaultMapWorldOptions.setback + building.depth / 2);
      expect(behindTheKerb).toBeLessThanOrEqual(defaultMapWorldOptions.frontage + 1e-9);
    }
  });

  it('turns each building to face the street it fronts', () => {
    for (const building of layout.buildings.slice(0, 200)) {
      const street = layout.streets.nearest(building.x, building.z, 200)!;
      const facing = Math.atan2(-street.dirZ, street.dirX);
      // Equal up to which way along the street it points.
      const difference = Math.abs(((building.yaw! - facing) % Math.PI) + Math.PI) % Math.PI;
      expect(Math.min(difference, Math.PI - difference)).toBeLessThan(1e-6);
    }
  });

  it('builds taller on the more important road', () => {
    const near = (kind: string) =>
      layout.buildings.filter(
        (b) => layout.streets.nearest(b.x, b.z, 200)!.kind === kind,
      );
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

    expect(mean(near('primary').map((b) => b.height))).toBeGreaterThan(
      mean(near('residential').map((b) => b.height)),
    );
  });

  it('is deterministic for a given map and seed', () => {
    const again = buildLayoutFromMap(mapOf(CROSSROADS));
    expect(again.buildings).toEqual(layout.buildings);
  });

  it('carries the streets through for the renderer to draw', () => {
    expect(layout.roads).toEqual(CROSSROADS);
  });

  it('produces solids the collider can take', () => {
    const collider = createColliderField(layout.boxes);
    expect(collider.boxCount).toBe(layout.boxes.length);
    for (const box of layout.boxes.map(worldBounds)) {
      expect(box.minY).toBe(0);
      expect(box.maxY).toBeGreaterThan(0);
    }
  });

  it('leaves the street itself flyable from end to end', () => {
    const collider = createColliderField(layout.boxes);
    for (let z = -290; z < 290; z += 10) {
      expect(collider.sweep(vec(0, 6, z), vec(0, 6, z + 10), 0.22), `z ${z}`).toBeNull();
    }
  });

  it('walls the street in on both sides', () => {
    // Not every metre of frontage is built on -- the block has gaps, as a real
    // one does -- but crossing the street should nearly always meet something.
    const collider = createColliderField(layout.boxes);
    let hits = 0;
    let tries = 0;
    for (let z = -280; z <= 280; z += 10) {
      tries += 1;
      if (collider.sweep(vec(-60, 6, z), vec(60, 6, z), 0.22)) hits += 1;
    }
    expect(hits / tries).toBeGreaterThan(0.7);
  });

  it('lets a bird crash into the city it generated', () => {
    const collider = createColliderField(layout.boxes);
    const bird = createBird(vec(-40, 12, 200), 16);
    const controls = neutralControls();
    for (let t = 0; t < 60; t += 1 / 120) {
      step(bird, controls, defaultParams, 1 / 120, collider);
      if (bird.ending) break;
    }
    expect(bird.ending).not.toBeNull();
  });
});
