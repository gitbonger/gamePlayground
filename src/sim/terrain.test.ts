import { describe, expect, it } from 'vitest';
import homeMap from '../world/data/home.json';
import { buildLayoutFromMap, defaultMapWorldOptions } from '../world/from-map';
import { FLAT } from '../world/ground';
import type { MapData } from '../world/streets';
import {
  createBird,
  defaultParams,
  groundUnder,
  neutralControls,
  step,
  type FlightParams,
} from './flight';
import { vec } from './math3';

/**
 * The real map, because the question is about real ground: Pest is flat and
 * near nought, the Buda hills are a hundred metres up, and the Danube is
 * between them.
 */
const layout = buildLayoutFromMap(homeMap as unknown as MapData, defaultMapWorldOptions);
const ground = layout.ground ?? FLAT;
const params: FlightParams = {
  ...defaultParams,
  groundAt: (x, z) => ground.heightAt(x, z),
  waterAt: (x, z) => layout.water?.(x, z) ?? false,
};

/** Gellért Hill, which is the highest thing anybody flies over here. */
const HILL = { x: -3761, z: 1406 };
/** The middle of the Danube, off the Buda bank. */
const RIVER = { x: -3900, z: 0 };
/** Józsefváros, which is as flat as this city gets. */
const PEST = { x: -200, z: -300 };

const flyInto = (at: { x: number; z: number }, from: number, sink = -3) => {
  // Straight down onto the spot, so what is tested is the ground under it
  // rather than wherever a glide happens to end up.
  const bird = createBird(vec(at.x, from, at.z), 1, 0);
  bird.velocity = { x: 0, y: sink, z: 0 };
  const controls = neutralControls();
  for (let t = 0; t < 40; t += 1 / 120) {
    step(bird, controls, params, 1 / 120, undefined);
    if (bird.ending) break;
  }
  return bird;
};

describe('the ground the bird actually lands on', () => {
  it('knows the hill is a hundred metres up and Pest is not', () => {
    expect(groundUnder(params, HILL.x, HILL.z)).toBeGreaterThan(90);
    expect(Math.abs(groundUnder(params, PEST.x, PEST.z))).toBeLessThan(6);
    // And with no map at all it is the old flat plane, which is what every
    // test that does not care about terrain is still flying over.
    expect(groundUnder(defaultParams, HILL.x, HILL.z)).toBe(0);
  });

  it('puts a bird down on the hill rather than inside it', () => {
    const bird = flyInto(HILL, 140);
    expect(bird.ending).not.toBeNull();
    // On the hill: a hundred metres up, not at nought.
    expect(bird.position.y).toBeGreaterThan(90);
    // Standing on the ground under where it ended up, a body's radius clear
    // of it -- which is where the collider leaves a bird that lands on a roof.
    expect(bird.position.y).toBeCloseTo(
      groundUnder(params, bird.position.x, bird.position.z) + params.bodyRadius,
      2,
    );
  });

  it('measures height above what is underneath, not above the sea', () => {
    const bird = createBird(vec(HILL.x, groundUnder(params, HILL.x, HILL.z) + 30, HILL.z), 12, 0);
    const telemetry = step(bird, neutralControls(), params, 1 / 120, undefined);
    // Thirty metres up over a hill a hundred metres high, not a hundred and
    // thirty: every instruction in the game is written about this number.
    expect(telemetry.altitude).toBeGreaterThan(28);
    expect(telemetry.altitude).toBeLessThan(32);
  });
});

describe('coming down on water', () => {
  it('is the end of the flight, however gently it is done', () => {
    // The gentlest arrival the model allows: slow, level, barely sinking.
    const bird = createBird(vec(RIVER.x, groundUnder(params, RIVER.x, RIVER.z) + 2, RIVER.z), 6, 0);
    bird.velocity = { x: 0, y: -0.4, z: -6 };
    const controls = neutralControls();
    for (let t = 0; t < 20; t += 1 / 120) {
      step(bird, controls, params, 1 / 120, undefined);
      if (bird.ending) break;
    }
    expect(bird.ending?.kind).toBe('crashed');
    expect(bird.ending?.cause).toBe('drowned');
  });

  it('is not what happens on the bank', () => {
    // The same arrival a few hundred metres away, on the grass: a landing.
    const bird = createBird(vec(PEST.x, groundUnder(params, PEST.x, PEST.z) + 2, PEST.z), 6, 0);
    bird.velocity = { x: 0, y: -0.4, z: -6 };
    const controls = neutralControls();
    for (let t = 0; t < 20; t += 1 / 120) {
      step(bird, controls, params, 1 / 120, undefined);
      if (bird.ending) break;
    }
    expect(bird.ending?.kind).toBe('landed');
  });

  it('says so, rather than blaming the landing', () => {
    // A bird that drops onto the river at speed drowned; it did not come down
    // hard. The panel reads the cause out, and "you came down too hard on the
    // Danube" is advice about the wrong thing.
    const bird = flyInto(RIVER, groundUnder(params, RIVER.x, RIVER.z) + 60, -12);
    expect(bird.ending?.cause).toBe('drowned');
  });
});
