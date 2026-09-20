import { describe, expect, it } from 'vitest';
import { ARMS, buildGrid, towerHeight } from './grid';
import { buildLayoutFromMap, defaultMapWorldOptions } from './from-map';
import { createColliderField } from '../sim/collision';
import { createBird, defaultParams, neutralControls, step } from '../sim/flight';
import { vec } from '../sim/math3';
import type { MapData } from './streets';

/** A straight line of four towers, three hundred metres apart. */
const LINE: [number, number][] = [
  [0, 0],
  [300, 0],
  [600, 0],
  [900, 0],
];

const mapOf = (
  power: { points: [number, number][]; volts: number }[],
  towers: number[][],
): MapData => ({
  name: 'grid',
  centre: [47.5, 19],
  radius: 1000,
  attribution: '',
  roads: [],
  power,
  towers,
});

describe('the overhead grid', () => {
  it('puts a tower where the survey says, and nowhere else', () => {
    // The middle vertex is a bend rather than a tower, so no pylon stands on
    // it: a line's vertices are where the cable changes direction, and taking
    // all of them would be a pylon at every kink in the route.
    const bend: [number, number][] = [
      [0, 0],
      [150, 40],
      [300, 0],
    ];
    const { pylons } = buildGrid([{ points: bend, volts: 132000 }], [[0, 0], [300, 0]]);
    expect(pylons).toHaveLength(2);
    expect(pylons.map((p) => Math.round(p.x))).toEqual([0, 300]);
  });

  it('hangs the cable from the towers and lets it dip between them', () => {
    const { wires } = buildGrid([{ points: LINE, volts: 132000 }], LINE.map(([x, z]) => [x, z]));
    expect(wires.length).toBe(ARMS.length * 2 * 3);

    const wire = wires[0]!;
    const ends = [wire.points[0]!, wire.points[wire.points.length - 1]!];
    const lowest = Math.min(...wire.points.map((point) => point[1]));
    // Both ends level -- they hang off two towers of the same height -- and
    // the middle lower than either, which is the whole of what a cable does.
    expect(ends[0]![1]).toBeCloseTo(ends[1]![1], 6);
    expect(lowest).toBeLessThan(ends[0]![1] - 1);
    // And it dips by about three per cent of the span, not by ten.
    expect(ends[0]![1] - lowest).toBeGreaterThan(300 * 0.02);
    expect(ends[0]![1] - lowest).toBeLessThan(300 * 0.05);
  });

  it('carries the cable off to the side, one each way along every arm', () => {
    const { wires } = buildGrid([{ points: LINE, volts: 132000 }], LINE.map(([x, z]) => [x, z]));
    const acrossTheLine = wires.map((wire) => wire.points[0]![2]);
    for (const arm of ARMS) {
      expect(acrossTheLine).toContainEqual(arm.out);
      expect(acrossTheLine).toContainEqual(-arm.out);
    }
  });

  it('builds a smaller tower for a smaller line', () => {
    expect(towerHeight(132000)).toBeGreaterThan(towerHeight(11000));
    const { pylons } = buildGrid([{ points: LINE, volts: 11000 }], LINE.map(([x, z]) => [x, z]));
    expect(pylons[0]!.height).toBe(towerHeight(11000));
  });

  it('stands on the ground it is on rather than on the sea', () => {
    const hill = (x: number) => x / 10;
    const { pylons, wires } = buildGrid(
      [{ points: LINE, volts: 132000 }],
      LINE.map(([x, z]) => [x, z]),
      (x) => hill(x),
    );
    void pylons;
    // The cable off the first tower hangs above the ground under it, and the
    // one off the last hangs thirty metres higher, because the ground does.
    const first = wires[0]!.points[0]!;
    const last = wires[wires.length - 1]!.points.at(-1)!;
    expect(first[1]).toBeGreaterThan(hill(first[0]));
    expect(last[1] - first[1]).toBeGreaterThan(80);
  });
});

describe('a bird and a wire', () => {
  const layout = buildLayoutFromMap(
    mapOf([{ points: LINE, volts: 132000 }], LINE.map(([x, z]) => [x, z])),
    defaultMapWorldOptions,
  );
  const collider = createColliderField(layout.boxes);

  it('makes the cable solid enough to find', () => {
    const wire = layout.wires![0]!;
    const middle = wire.points[Math.floor(wire.points.length / 2)]!;
    const top = collider.heightAt(middle[0], middle[2]);
    expect(top).toBeGreaterThan(middle[1] - 0.5);
    expect(top).toBeLessThan(middle[1] + 0.5);
  });

  it('lets a pigeon put down on it', () => {
    const wire = layout.wires![0]!;
    const middle = wire.points[Math.floor(wire.points.length / 2)]!;
    // Coming in along the cable, slow and level, a metre above it: the
    // ordinary landing, at the one place in this world that is a wire.
    const bird = createBird(vec(middle[0] - 6, middle[1] + 1.1, middle[2]), 7, Math.PI / 2);
    const controls = neutralControls();
    for (let t = 0; t < 6; t += 1 / 120) {
      step(bird, controls, defaultParams, 1 / 120, collider);
      if (bird.ending) break;
    }
    expect(bird.ending?.kind).toBe('landed');
    expect(bird.position.y).toBeGreaterThan(middle[1] - 1);
  });

  it('never kills one that arrives on it badly', () => {
    // No electrocution and no broken neck. Straight down onto the cable at
    // the speed that kills against masonry: what a wire does to a pigeon is
    // make a mess of it sitting down, which is what every pigeon that has
    // ever sat on a wire looks like.
    const wire = layout.wires![0]!;
    const middle = wire.points[Math.floor(wire.points.length / 2)]!;
    const bird = createBird(vec(middle[0] - 3, middle[1] + 2, middle[2]), 1, 0);
    bird.velocity = { x: 0, y: -26, z: 0 };
    const controls = neutralControls();
    for (let t = 0; t < 4; t += 1 / 120) {
      step(bird, controls, defaultParams, 1 / 120, collider);
      if (bird.ending) break;
    }
    expect(bird.ending?.kind).toBe('landed');
    expect(bird.ending?.cause).toBeNull();
  });
});
