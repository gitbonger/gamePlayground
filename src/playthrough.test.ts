/**
 * Fly every level, with nobody watching.
 *
 * A different question from the rest of the suite. Those check rules -- that a
 * crossing line sits short of its target, that a belly is never taken away --
 * and they check them by reading the level data. This one gets in and flies:
 * it puts a bird at the release point of each level and points the autopilot
 * at whatever ends it, tick by tick through the real flight model, the real
 * collider and the real city.
 *
 * It is here because it is the only thing that answers "can this level be
 * finished at all". A level whose target is beyond its glide, or which starts
 * pointed into a wall, or which has been made unreachable by moving something
 * a hundred metres west, is broken in a way no rule about its data can see --
 * and it is broken for every player, on the first try, before anything else in
 * the game gets a chance to go wrong.
 *
 * The autopilot is not a good pilot. It flies at a point and does not think
 * about height, so where it arrives short that is a fact about the *autopilot*
 * and not necessarily about the level. What is damning is the other direction:
 * a level it cannot get near, or one that kills it on the way, is a level a
 * player is going to have trouble with too.
 */

import { describe, expect, it } from 'vitest';
import homeMap from './world/data/home.json';
import { buildLayoutFromMap, defaultMapWorldOptions } from './world/from-map';
import type { MapData } from './world/streets';
import { project } from './world/geo';
import { LANDMARKS } from './landmarks';
import { LEVELS, targetName, type Level } from './levels';
import { combineColliders, createColliderField } from './sim/collision';
import { defaultAutopilotParams, steer, type AutopilotState } from './sim/autopilot';
import {
  createBird,
  defaultParams,
  hasCrashed,
  neutralControls,
  step,
  type BirdState,
} from './sim/flight';
import { vec } from './sim/math3';

const DT = 1 / 120;
const map = homeMap as unknown as MapData;

/** The world, built once: it is half a second, and there are thirteen levels. */
const world = buildLayoutFromMap(map, {
  ...defaultMapWorldOptions,
  landmarks: LANDMARKS.map((landmark) => {
    const at = project(landmark.at[0], landmark.at[1], map.centre);
    const { at: _degrees, ...rest } = landmark;
    return { ...rest, x: at.x, z: at.z };
  }),
  // The rake of stake wagons, because one level is aimed at a wagon of it and
  // a level aimed at a train that is not there has nowhere to go.
  trains: [{ near: project(47.500052, 19.088174, map.centre), cars: 12 }],
});
const solid = combineColliders(createColliderField(world.boxes));
const at = (p: readonly [number, number]) => project(p[0], p[1], map.centre);

/** Where a level is trying to get you, on the ground. */
function destination(level: Level): { x: number; z: number } | null {
  if (level.finish.kind === 'crossing') return at(level.finish.through);

  // A wagon, which is somewhere else every tick. Where it is standing when the
  // world is built is close enough: this asks whether the yard is reachable,
  // not whether a particular coupling is.
  if (level.target.kind === 'wagon') {
    const rake = world.trains[level.target.train];
    const car = rake?.vehicles[Math.floor(rake.vehicles.length / 2)];
    return car ? { x: car.x, z: car.z } : null;
  }

  const mark = world.landmarks.find((l) => l.name === targetName(level));
  return mark ? { x: mark.x, z: mark.z } : null;
}

interface Flight {
  /** How near it got to where the level wanted it, in metres. */
  nearest: number;
  /** And how far it had to go when it started. */
  began: number;
  seconds: number;
  ending: string;
  bird: BirdState;
}

/**
 * Fly one level at its destination and report how it went.
 *
 * Aimed a little above the ground rather than at it, and braked low down, for
 * the same reason the flock's landing is: an autopilot flown straight at a
 * point on the ground arrives still descending and writes itself off, which
 * says nothing about the level.
 */
function fly(level: Level, seconds = 120): Flight {
  const from = at(level.start);
  const to = destination(level);
  const floor = solid.heightAt(from.x, from.z);
  const bird = createBird(
    vec(from.x, Math.max(level.release, floor + 2), from.z),
    16,
    0,
  );
  const memory: AutopilotState = { beating: true };
  const controls = neutralControls();

  const began = to ? Math.hypot(from.x - to.x, from.z - to.z) : 0;
  let nearest = began;
  let flown = 0;
  if (!to) return { nearest, began, seconds: 0, ending: 'nowhere to go', bird };

  for (; flown < seconds && bird.ending === null; flown += DT) {
    steer(bird, { x: to.x, z: to.z, altitude: 6 }, memory, controls, defaultAutopilotParams);
    // Wings out low down: a bird arriving at cruise is a bird arriving badly,
    // and this is a test of the level rather than of the landing.
    controls.brake = bird.position.y < 14;
    step(bird, controls, defaultParams, DT, solid);
    nearest = Math.min(nearest, Math.hypot(bird.position.x - to.x, bird.position.z - to.z));
  }

  return {
    nearest,
    began,
    seconds: flown,
    ending: bird.ending ? `${bird.ending.kind}/${bird.ending.cause ?? 'clean'}` : 'still flying',
    bird,
  };
}

describe('flying every level', () => {
  /** Flown once each, and then asked about: the flying is the expensive part. */
  const flights = new Map<string, Flight>();
  for (const level of LEVELS) {
    if (level.begins === 'perched') continue;
    flights.set(level.name, fly(level));
  }

  it('releases nobody into a solid', () => {
    // The first tick. A level that starts you inside a wall is broken for
    // every player on every attempt, and it is exactly the sort of thing that
    // moving a building or a release point by a hundred metres does.
    for (const [name, flight] of flights) {
      expect(flight.seconds, `${name} died at once: ${flight.ending}`).toBeGreaterThan(0.5);
    }
  });

  it('gets the bird to what the level is aimed at', () => {
    // The question no rule about the data can answer. The autopilot is not a
    // good pilot -- it flies at a point and does not think about height -- so
    // this is generous: it asks that the flight *arrives*, not that it lands.
    const missed: string[] = [];
    for (const [name, flight] of flights) {
      if (flight.nearest > 45) {
        missed.push(
          `${name}: got within ${flight.nearest.toFixed(0)} m of ${flight.began.toFixed(0)}, ${flight.ending}`,
        );
      }
    }
    expect(missed.join('\n')).toBe('');
  });

  it('does not fly anybody into the city on the way', () => {
    // Hitting a building on the way to the target is a route problem: the
    // level is pointed through something. Landing badly at the end is the
    // autopilot's own fault and is not this test's business.
    const crashed: string[] = [];
    for (const [name, flight] of flights) {
      if (!hasCrashed(flight.bird)) continue;
      if (flight.bird.ending?.cause !== 'building') continue;
      // Near the destination it is an arrival gone wrong, which is allowed.
      if (flight.nearest < 60) continue;
      crashed.push(`${name}: ${flight.ending} ${flight.nearest.toFixed(0)} m out`);
    }
    expect(crashed.join('\n')).toBe('');
  });

  it('stands no waypoint inside a building', () => {
    // A mark is a thirty-metre column and the player is told to fly at it, so
    // one standing in a house is a column growing out of a roof and an arrow
    // pointing into a wall.
    //
    // This could not have been wrong before there were real buildings: the
    // generator kept off the streets, and the marks are laid down the middle
    // of a route. The night the outlines arrived, one of the three on Temető
    // was inside a house, and nothing in the game or the suite noticed.
    const inside: string[] = [];
    for (const level of LEVELS) {
      for (const [i, mark] of (level.waypoints ?? []).entries()) {
        const point = at(mark);
        const hit = world.buildings.find((b) => {
          const turn = -(b.yaw ?? 0);
          const dx = point.x - b.x;
          const dz = point.z - b.z;
          return (
            Math.abs(dx * Math.cos(turn) + dz * Math.sin(turn)) <= b.width / 2 &&
            Math.abs(-dx * Math.sin(turn) + dz * Math.cos(turn)) <= b.depth / 2
          );
        });
        if (hit) inside.push(`${level.name} mark ${i + 1} is inside a building`);
      }
    }
    expect(inside.join('\n')).toBe('');
  });

  it('releases nobody inside a building either', () => {
    // The same hazard at the other end of the flight, and the one that would
    // be worst: a release point inside a wall is a level nobody can start.
    // Two levels are released over a roof -- the loft over a twenty-metre one
    // and Fiumei út over an eleven -- which is fine at a hundred and fifty
    // metres and would not be at twenty.
    const buried: string[] = [];
    for (const level of LEVELS) {
      const point = at(level.start);
      const over = world.buildings.filter((b) => {
        const turn = -(b.yaw ?? 0);
        const dx = point.x - b.x;
        const dz = point.z - b.z;
        return (
          Math.abs(dx * Math.cos(turn) + dz * Math.sin(turn)) <= b.width / 2 &&
          Math.abs(-dx * Math.sin(turn) + dz * Math.cos(turn)) <= b.depth / 2
        );
      });
      const tallest = over.length ? Math.max(...over.map((b) => b.height)) : 0;
      if (tallest >= level.release) {
        buried.push(`${level.name}: released at ${level.release} m inside a ${tallest.toFixed(1)} m building`);
      }
    }
    expect(buried.join('\n')).toBe('');
  });
});