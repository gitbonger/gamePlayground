import { describe, expect, it } from 'vitest';
import { LEVELS, targetName } from './levels';
import { HOME_TREE, LANDMARKS, LOFT } from './landmarks';
import { nestOn, penthouseOf, plantTerrace, pointOn, terraceOf } from './world/layout';
import { CHARACTER_MORPHS, HERO_MORPH, PIGEON_MORPHS, PINK_MORPH } from './render/bird';
import { MEET_RADIUS } from './sim/walk';
import { project } from './world/geo';
import HOME_MAP from './world/data/home.json';
import { indexStreets, type Road } from './world/streets';
import { footprintSamples } from './world/areas';
import { defaultMapWorldOptions } from './world/from-map';

describe('what the levels aim at', () => {
  it('names a described thing that exists', () => {
    // The whole reason a level says "The Loft" rather than a coordinate is
    // that the name is checkable. Here is the check.
    const described = new Set(LANDMARKS.map((landmark) => landmark.name));
    for (const level of LEVELS) {
      if (level.target.kind !== 'landmark') continue;
      expect(described, level.name).toContain(level.target.name);
    }
  });

  it('calls the marker after the thing, not after the level', () => {
    // They differ, and the difference is load-bearing: the marker is looked
    // up by the target's name, and two levels on one building would collide
    // if it went by the level's.
    for (const level of LEVELS) {
      expect(targetName(level), level.name).toBe(level.target.name);
    }
  });

  it('gives every described thing a name of its own', () => {
    const names = LANDMARKS.map((landmark) => landmark.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('stands the loft clear of the roofline it is meant to be picked out of', () => {
    // A landmark you cannot find from the air is not one. The houses come out
    // between 16 and 24 metres, so the loft has to beat the tallest of them by
    // enough to read as different rather than as merely on the end of the
    // distribution.
    expect(LOFT.height).toBeGreaterThan(defaultMapWorldOptions.maxHeight + 5);
  });

  it('stands the loft\'s pigeon on the terrace, clear of the planting', () => {
    // The level is won by walking up to it, so where it stands has to be
    // somewhere a bird can be. It is placed relative to the marker, which
    // hangs over the middle of the terrace, and along the building's own axes
    // rather than the world's -- so this holds however the loft is turned.
    const level = LEVELS.find((l) => l.target.name === LOFT.name)!;
    const here = { ...LOFT, x: 0, z: 0 };
    const terrace = terraceOf(here)!;
    const person = pointOn(terrace, level.person.along, level.person.across);

    // On the terrace: measured back in the terrace's own frame, because the
    // terrace is turned too.
    const dx = person.x - terrace.x;
    const dz = person.z - terrace.z;
    const along = dx * Math.cos(terrace.yaw) - dz * Math.sin(terrace.yaw);
    const across = dx * Math.sin(terrace.yaw) + dz * Math.cos(terrace.yaw);
    expect(Math.abs(along)).toBeLessThan(terrace.width / 2);
    expect(Math.abs(across)).toBeLessThan(terrace.depth / 2);

    // And not inside a bush, with room to walk round it: a pigeon is about a
    // fifth of a metre across.
    for (const bush of plantTerrace(here)) {
      const gap = Math.hypot(person.x - bush.x, person.z - bush.z) - bush.radius;
      expect(gap, `${bush.x.toFixed(1)}, ${bush.z.toFixed(1)}`).toBeGreaterThan(0.5);
    }
  });

  it('turns the loft to face the way the pigeon comes in', () => {
    // The terrace is the target. Behind the penthouse it would be hidden on
    // every approach until the last second.
    const level = LEVELS.find((l) => l.target.name === LOFT.name)!;
    const centre = HOME_MAP.centre as [number, number];
    const loft = project(LOFT.at[0], LOFT.at[1], centre);
    const start = project(level.start[0], level.start[1], centre);

    const terrace = terraceOf({ ...LOFT, ...loft })!;
    const penthouse = penthouseOf({ ...LOFT, ...loft })!;
    const away = (at: { x: number; z: number }) => Math.hypot(at.x - start.x, at.z - start.z);
    expect(away(terrace)).toBeLessThan(away(penthouse));
  });

  it('stands every described thing clear of the streets', () => {
    // The one that actually bites. A described thing is put down at a written
    // coordinate and the generator gives way to it -- so nothing checks it
    // against the map, and a building made three times bigger around a point
    // thirteen metres from the kerb ends up standing across two roads with
    // the carriageway disappearing under it.
    const centre = HOME_MAP.centre as [number, number];
    const streets = indexStreets(HOME_MAP.roads as Road[]);

    for (const landmark of LANDMARKS) {
      const at = project(landmark.at[0], landmark.at[1], centre);
      // What has to be clear of the street is what stands on the ground. For
      // a building that is the whole footprint; for a tree it is the trunk,
      // because a crown reaching out over a pavement is what a street tree
      // does. The other half of that bargain -- that it reaches over high
      // enough to be reached under -- is the test below.
      const standing = landmark.canopy
        ? { width: landmark.canopy.trunk, depth: landmark.canopy.trunk }
        : { width: landmark.width, depth: landmark.depth };
      const corners = footprintSamples(
        at.x,
        at.z,
        standing.width,
        standing.depth,
        landmark.yaw ?? 0,
        4,
      );
      // A building has to stand off the pavement as well as off the road. A
      // patch of concrete only has to stay out of the carriageway -- it is
      // paving, and paving beside a road is a pavement. It would not even
      // show if it overlapped, being drawn under the roads, which is exactly
      // why it is worth stating rather than leaving to be noticed.
      const room = landmark.height > 0 && !landmark.canopy ? 2 : 0;
      for (const [x, z] of corners) {
        const road = streets.nearest(x, z, 120);
        if (!road) continue;
        expect(road.distance, `${landmark.name} at ${x.toFixed(0)}, ${z.toFixed(0)}`)
          .toBeGreaterThan(road.width / 2 + room);
      }
    }
  });

  it('hangs a crown high enough to walk a lorry under', () => {
    // The concession the test above makes: a tree may overhang a street. This
    // is what it is conceded against. Four metres is the legal height of a
    // lorry here, and the underside of the crown has to clear it wherever the
    // crown reaches past the trunk -- otherwise "overhanging the pavement"
    // means a tree growing through the top deck of a bus.
    const LORRY = 4;
    for (const landmark of LANDMARKS) {
      if (!landmark.canopy) continue;
      const underside = landmark.height - landmark.canopy.skirt;
      expect(underside, landmark.name).toBeGreaterThan(LORRY);
    }
  });

  it('starts the game standing on the home tree, within reach of the pink one', () => {
    // The level is a conversation, not a flight: it is complete on the tick it
    // opens because the hero is put down in the middle of the platform and she
    // is standing a stride away. If she drifts further off than a bird can
    // reach, the opening level silently becomes one you have to walk.
    const leaving = LEVELS[0]!;
    expect(leaving.begins).toBe('perched');
    expect(leaving.target).toEqual({ kind: 'landmark', name: HOME_TREE.name });

    // The hero stands where the arrow points, which is the middle of the top.
    const middle = { x: 0, z: 0, yaw: HOME_TREE.yaw ?? 0 };
    const her = pointOn(middle, leaving.person.along, leaving.person.across);
    expect(Math.hypot(her.x, her.z)).toBeLessThan(MEET_RADIUS);
  });

  it('stands the pink one beside her nest rather than in it', () => {
    // Both are described in the tree's own frame, and they have to agree: she
    // is at the nest, which is what the picture is, but not standing on the
    // egg, which is what the picture would be if the two coordinates were
    // written independently and left to drift.
    const leaving = LEVELS[0]!;
    const here = { ...HOME_TREE, x: 0, z: 0 };
    const nest = nestOn(here)!;
    const her = pointOn(here, leaving.person.along, leaving.person.across);
    const apart = Math.hypot(her.x - nest.x, her.z - nest.z);
    expect(apart).toBeGreaterThan(nest.radius);
    expect(apart).toBeLessThan(1);

    // And all of it on the platform, with room to stand -- the nest measured
    // to its rim rather than to its middle, since the rim is the part that
    // would be hanging over the edge.
    expect(Math.abs(nest.x) + nest.radius).toBeLessThan(HOME_TREE.width / 2);
    expect(Math.abs(nest.z) + nest.radius).toBeLessThan(HOME_TREE.depth / 2);
    expect(Math.abs(her.x)).toBeLessThan(HOME_TREE.width / 2 - 0.5);
    expect(Math.abs(her.z)).toBeLessThan(HOME_TREE.depth / 2 - 0.5);
  });

  it('gives the tree a crest much smaller than the tree', () => {
    // Two numbers, and the difference between them is the whole shape: the
    // width is the flat crest you can stand on, `spread` is where the leaves
    // get to. A crown that stopped at the crest would be a green table; a
    // crest as wide as the crown would let a bird stand on the outermost
    // leaf. The crown reaches at least half again past the crest.
    // Both as radii from the trunk, which is the only way to compare them
    // without getting a factor of two wrong.
    const canopy = HOME_TREE.canopy!;
    const crest = HOME_TREE.width / 2;
    expect(canopy.spread).toBeGreaterThan(crest * 1.5);
    // And the crest still holds a nest, a bird, and the bird that lands on
    // it: two metres of reach between the two of them, with the nest beside.
    expect(HOME_TREE.width / 2).toBeGreaterThan(MEET_RADIUS);
  });

  it('keeps the pink pigeon out of the flock, and off every level but hers', () => {
    // She is somebody, and the flock draws its colours from `PIGEON_MORPHS`.
    // A city with thirty pink pigeons in it has no pink pigeon in it -- and a
    // second one standing on a roof three levels later is the same mistake
    // made once instead of thirty times.
    expect(PIGEON_MORPHS).not.toContain(PINK_MORPH);
    expect(CHARACTER_MORPHS).toContain(PINK_MORPH);

    const pink = LEVELS.filter(
      (level) => CHARACTER_MORPHS[level.person.morph % CHARACTER_MORPHS.length] === PINK_MORPH,
    );
    expect(pink).toEqual([LEVELS[0]]);
  });

  it('dresses the crowd in four colours anybody could name', () => {
    // Eight subtly different greys read as one grey, which is right for a
    // flock and wrong for the birds a level asks you to walk up to. Told
    // apart by body first and tail second -- the tail being most of what
    // there is to see of a pigeon from behind and above.
    expect(PIGEON_MORPHS).toHaveLength(4);
    const bodies = new Set(PIGEON_MORPHS.map((morph) => morph.body));
    expect(bodies.size).toBe(PIGEON_MORPHS.length);
    for (const morph of PIGEON_MORPHS) {
      expect(morph.tail, morph.body.toString(16)).not.toBe(morph.wing);
    }

    // And the hero is none of them, so the bird the camera follows is the one
    // colour the city never wears.
    expect(PIGEON_MORPHS).not.toContain(HERO_MORPH);
  });

  it('flies every level but the first', () => {
    // The perched opening is a hack -- a story beat told through the
    // level-completion machinery -- and this is the fence round it. One level
    // is allowed to be won by starting it.
    const perched = LEVELS.filter((level) => level.begins === 'perched');
    expect(perched).toEqual([LEVELS[0]]);
  });

  it('leaves room around each described thing, so it stands apart', () => {
    // Nothing is built or planted inside the margin. Without one a landmark
    // ends up in a terrace, which is exactly what it must not be.
    for (const landmark of LANDMARKS) {
      expect(landmark.margin ?? 0, landmark.name).toBeGreaterThan(0);
    }
  });
});
