import { describe, expect, it } from 'vitest';
import type { Road } from './streets';
import { buildCarGraph, CAR_LENGTH, createTraffic } from './cars';

/** A town of eight-metre streets on a square grid, `blocks` a side, `size` metres a block. */
function town(blocks: number, size: number): Road[] {
  const roads: Road[] = [];
  for (let i = 0; i <= blocks; i += 1) {
    // Split into one way per block, as the map is.
    for (let j = 0; j < blocks; j += 1) {
      roads.push({ kind: 'residential', width: 8, points: [[i * size, j * size], [i * size, (j + 1) * size]] });
      roads.push({ kind: 'residential', width: 8, points: [[j * size, i * size], [(j + 1) * size, i * size]] });
    }
  }
  return roads;
}

/** A seeded random, so a failure is the same failure every run. */
const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

describe('the road network', () => {
  it('makes a node of every corner and a junction of every meeting of three or more', () => {
    const graph = buildCarGraph(town(3, 80));
    expect(graph.nodes).toHaveLength(16);
    expect(graph.edges).toHaveLength(24);
    // The four middle corners are crossroads, the eight on the sides are tees,
    // and the four at the corners of the town are bends.
    expect(graph.nodes.filter((node) => node.junction)).toHaveLength(12);
  });

  it('leaves out what nobody drives on', () => {
    const graph = buildCarGraph([{ kind: 'pedestrian', width: 6, points: [[0, 0], [100, 0]] }]);
    expect(graph.edges).toHaveLength(0);
  });
});

describe('the cars', () => {
  it('keep out of each other in a town that is busy, and keep moving', () => {
    const graph = buildCarGraph(town(4, 70));
    const traffic = createTraffic(graph, 30, { x: 140, z: 140 }, seeded(3), 10000, [0, 10000]);
    let overlapping = 0;
    let samples = 0;
    for (let step = 0; step < 60 * 180; step += 1) {
      traffic.update(1 / 60, { x: 140, z: 140 });
      if (step % 30) continue;
      for (const a of traffic.cars) {
        for (const b of traffic.cars) {
          if (a.id >= b.id) continue;
          samples += 1;
          if (Math.hypot(a.x - b.x, a.z - b.z) < CAR_LENGTH * 0.6) overlapping += 1;
        }
      }
    }
    // Some glitches are allowed, and fun; mostly they drive properly. Under
    // one pair in a thousand samples on top of each other.
    expect(overlapping / samples).toBeLessThan(0.001);
    expect(traffic.cars.filter((car) => car.still > 25)).toHaveLength(0);
    expect(traffic.cars.filter((car) => car.speed > 1).length).toBeGreaterThan(10);
  });

  it('drive on the right', () => {
    // One straight road running east, one car on it going east: it is south of
    // the centreline, which is the right-hand side facing east with north at -z.
    const graph = buildCarGraph([{ kind: 'residential', width: 8, points: [[0, 0], [400, 0]] }]);
    const traffic = createTraffic(graph, 1, { x: 200, z: 0 }, seeded(1), 10000, [0, 10000]);
    traffic.update(1 / 60, { x: 200, z: 0 });
    const car = traffic.cars[0]!;
    const east = Math.cos(car.yaw) > 0;
    expect(car.z > 0).toBe(east);
  });
});
