import { describe, expect, it } from 'vitest';
import { crossed, crossingLine, LEVELS, targetName } from './levels';
import { HOME_TREE, LANDMARKS, LOFT } from './landmarks';
import { nestOn, penthouseOf, peopleOn, plantTerrace, pointOn, terraceOf } from './world/layout';
import { CHARACTER_MORPHS, HERO_MORPH, PIGEON_MORPHS, PINK_MORPH } from './render/bird';
import { MEET_RADIUS } from './sim/walk';
import { begin, isOver, reply, type Turn } from './dialogue';
import { project } from './world/geo';
import HOME_MAP from './world/data/home.json';
import { indexStreets, type Road } from './world/streets';
import { footprintSamples, type Area } from './world/areas';
import { pointInPolygon } from './world/polygon';
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
    const person = pointOn(terrace, level.person!.along, level.person!.across);

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

  it('hangs a crown high enough to run a tram under', () => {
    // The concession the test above makes: a tree may overhang a street. This
    // is what it is conceded against, and the height comes off whatever
    // actually passes beneath. A lorry is four metres, which was the figure
    // here until the home tree was moved to a spot seven metres from a
    // tramway -- and a tram carries an overhead line six metres up. The
    // underside of the crown has to clear the tallest of them wherever the
    // crown reaches past the trunk, or "overhanging the street" means a tree
    // growing through the pantograph of the 28.
    const OVERHEAD_LINE = 6;
    for (const landmark of LANDMARKS) {
      if (!landmark.canopy) continue;
      const underside = landmark.height - landmark.canopy.skirt;
      expect(underside, landmark.name).toBeGreaterThan(OVERHEAD_LINE);
    }
  });

  it('starts the game standing on the home tree, within reach of the pink one', () => {
    // The level is a conversation, not a flight: it is complete on the tick it
    // opens because the hero is put down in the middle of the platform and she
    // is standing a stride away. If she drifts further off than a bird can
    // reach, the opening level silently becomes one you have to walk.
    const leaving = LEVELS[0]!;
    expect(leaving.person).toBeDefined();
    expect(leaving.begins).toBe('perched');
    expect(leaving.target).toEqual({ kind: 'landmark', name: HOME_TREE.name });

    // He stands where she stands, mirrored through the middle -- so the two
    // of them are twice her offset apart, and that has to be inside a bird's
    // reach or the opening level quietly becomes one you have to walk.
    const middle = { x: 0, z: 0, yaw: HOME_TREE.yaw ?? 0 };
    const her = pointOn(middle, leaving.person!.along, leaving.person!.across);
    const him = pointOn(middle, -leaving.person!.along, -leaving.person!.across);
    expect(Math.hypot(her.x - him.x, her.z - him.z)).toBeLessThan(MEET_RADIUS);
    // And far enough apart to be two birds rather than one: a pigeon is about
    // a fifth of a metre across.
    expect(Math.hypot(her.x - him.x, her.z - him.z)).toBeGreaterThan(0.4);
  });

  it('stands the pink one beside her nest rather than in it', () => {
    // Both are described in the tree's own frame, and they have to agree: she
    // is at the nest, which is what the picture is, but not standing on the
    // egg, which is what the picture would be if the two coordinates were
    // written independently and left to drift.
    const leaving = LEVELS[0]!;
    expect(leaving.person).toBeDefined();
    const here = { ...HOME_TREE, x: 0, z: 0 };
    const nest = nestOn(here)!;
    const her = pointOn(here, leaving.person!.along, leaving.person!.across);
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
    // Small enough to be a perch rather than a roof: the crown is four times
    // it across.
    expect(canopy.spread / crest).toBeGreaterThan(3.5);
  });

  it('keeps everything standing on the crest clear of the drop', () => {
    // The crest is not much wider than what stands on it, which is the point
    // of it -- and which is why this has to be arithmetic rather than a look
    // at a screenshot. Both birds and the whole rim of the nest, measured
    // from the middle, inside the edge.
    const leaving = LEVELS[0]!;
    expect(leaving.person).toBeDefined();
    const here = { ...HOME_TREE, x: 0, z: 0 };
    const crest = HOME_TREE.width / 2;
    const nest = nestOn(here)!;
    const her = pointOn(here, leaving.person!.along, leaving.person!.across);
    const him = pointOn(here, -leaving.person!.along, -leaving.person!.across);

    expect(Math.hypot(nest.x, nest.z) + nest.radius).toBeLessThan(crest);
    for (const bird of [her, him]) {
      // Half a pigeon's width off the edge, so it is standing on the crest
      // rather than balanced on the lip of it.
      expect(Math.hypot(bird.x, bird.z) + 0.1).toBeLessThan(crest);
    }
  });

  it('keeps the pink pigeon out of the flock, and off every level but hers', () => {
    // She is somebody, and the flock draws its colours from `PIGEON_MORPHS`.
    // A city with thirty pink pigeons in it has no pink pigeon in it -- and a
    // second one standing on a roof three levels later is the same mistake
    // made once instead of thirty times.
    expect(PIGEON_MORPHS).not.toContain(PINK_MORPH);
    expect(CHARACTER_MORPHS).toContain(PINK_MORPH);

    const pink = LEVELS.filter(
      (level) =>
        level.person &&
        CHARACTER_MORPHS[level.person.morph % CHARACTER_MORPHS.length] === PINK_MORPH,
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

  it('names a level that exists wherever a conversation hands one over', () => {
    // The name is the whole check. A conversation reaches for a level by
    // name, the way a level reaches for a landmark by name, and the cost of
    // that is that a typo is a level that silently never arrives -- unless
    // somebody looks, which is this.
    const names = new Set(LEVELS.map((level) => level.name));
    for (const level of LEVELS) {
      if (!level.dialogue) continue;
      for (const opens of handovers(level.dialogue)) {
        expect(names, `${level.name} opens ${opens}`).toContain(opens);
      }
    }
  });

  it('lets no branch of the opening conversation strand you on the tree', () => {
    // The first level is won by starting it and left by talking, so the
    // conversation is the only way out of it. A branch that handed over
    // nothing would leave the player standing on a branch eighteen metres up
    // with a finished conversation and no level to fly.
    const leaving = LEVELS[0]!;
    expect(leaving.person).toBeDefined();
    for (const [index] of leaving.dialogue!.you!.entries()) {
      let talk = begin(leaving.dialogue!);
      for (let step = 0; step < 20 && !isOver(talk); step += 1) {
        talk = reply(talk, step === 0 ? index + 1 : 1);
      }
      expect(talk.opens, `reply ${index + 1}`).toBe(LEVELS[1]!.name);
    }
  });

  it('lets him off the tree rather than dropping him over it', () => {
    // The errand starts five metres above the crest he has just been standing
    // on, and takes that height from the tree rather than restating it: move
    // the tree and the release moves with it.
    const errand = LEVELS[1]!;
    expect(errand.release).toBe(HOME_TREE.height + 5);

    // Both halves of it are flown under the roofline, which is what makes it
    // a flight through a park rather than a look down at one -- and the older
    // levels are all sky drops at a hundred metres, with the whole approach
    // laid out beneath you. Two kinds of level, and the errand is the first
    // of its kind.
    // Perched levels are not released at all, so their height is not a kind
    // of level, it is a formality.
    const errandHalves = LEVELS.filter(
      (level) => level.begins !== 'perched' && level.release < 100,
    );
    expect(errandHalves.map((level) => level.name)).toEqual(['Across the park', 'Grabbing food']);
    for (const level of errandHalves) {
      expect(level.release, level.name).toBeLessThan(defaultMapWorldOptions.maxHeight * 2);
    }
    for (const level of LEVELS.slice(3)) expect(level.release, level.name).toBe(100);
  });

  it('releases nobody into a roof', () => {
    // A level released below the roofline has to be released over ground
    // nothing is built on, and the generator builds nowhere green. The bird is
    // raised clear of anything solid underneath it as a backstop, but a level
    // that needs the backstop every time is a level released inside a
    // building, which is not a difficulty -- it is a bug that reads as one.
    const centre = HOME_MAP.centre as [number, number];
    const green = (HOME_MAP.areas ?? []) as Area[];

    for (const level of LEVELS) {
      if (level.begins === 'perched') continue;
      if (level.release > defaultMapWorldOptions.maxHeight) continue;

      const at = project(level.start[0], level.start[1], centre);
      const over = green.some((area) => pointInPolygon(at.x, at.z, area.points));
      expect(over, `${level.name} at ${level.release} m`).toBe(true);
    }
  });

  it('draws the finishing line square across the way to the target', () => {
    // A line rather than a ring, and this is what the difference buys: a bird
    // half a kilometre off course still crosses it, because the line has no
    // ends. A radius round the halfway point would have to be flown through.
    const line = crossingLine({ x: 0, z: 0 }, { x: 1000, z: 0 }, 500);
    expect(line.x).toBeCloseTo(500, 9);
    expect(line.z).toBeCloseTo(0, 9);

    // Short of it, past it, and a long way off to the side of it.
    expect(crossed(line, 499, 0)).toBe(false);
    expect(crossed(line, 501, 0)).toBe(true);
    expect(crossed(line, 501, 4000)).toBe(true);
    expect(crossed(line, 499, -4000)).toBe(false);
  });

  it('measures the line along the flight, whichever way the flight runs', () => {
    // The line is square to the *route*, not to the world, so a level flown
    // north-east has a north-east line. Written out because it is exactly the
    // sort of thing that works by accident on an east-west flight.
    const line = crossingLine({ x: 100, z: 100 }, { x: 400, z: 500 }, 250);
    // Two hundred and fifty metres along a 3-4-5 triangle: 150 across, 200 up.
    expect(line.x).toBeCloseTo(250, 6);
    expect(line.z).toBeCloseTo(300, 6);
    expect(crossed(line, 250, 300)).toBe(true);
    // A step back down the route is short of it; the same step sideways is not.
    expect(crossed(line, 250 - 0.6, 300 - 0.8)).toBe(false);
    expect(crossed(line, 250 - 0.8, 300 + 0.6)).toBe(true);
  });

  it('ends the errand at a line and the rest at somebody', () => {
    // The two ways a level can end, and the one rule that keeps them apart:
    // nobody stands at a line. Two levels aim at the concrete slab, and if
    // the first of them had a pigeon waiting it would be standing on the
    // second one's.
    for (const level of LEVELS) {
      const ends = level.crossing ? 'line' : 'person';
      if (ends === 'line') {
        expect(level.person, level.name).toBeUndefined();
        expect(level.dialogue, level.name).toBeUndefined();
      } else {
        expect(level.person, level.name).toBeDefined();
        expect(level.dialogue, level.name).toBeDefined();
      }
    }
  });

  it('hands the crossing over to a level that exists, short of the target', () => {
    // The same check the conversations get, for the same reason -- and one
    // more: a line further out than the target is a level you finish by
    // landing on something you were meant to fly past.
    const centre = HOME_MAP.centre as [number, number];
    const names = new Set(LEVELS.map((level) => level.name));
    for (const level of LEVELS) {
      if (!level.crossing) continue;
      expect(names, level.name).toContain(level.crossing.opens);

      const described = LANDMARKS.find((l) => l.name === level.target.name)!;
      const from = project(level.start[0], level.start[1], centre);
      const to = project(described.at[0], described.at[1], centre);
      const span = Math.hypot(to.x - from.x, to.z - from.z);
      expect(level.crossing.at, level.name).toBeGreaterThan(50);
      expect(level.crossing.at, level.name).toBeLessThan(span - 50);
    }
  });

  it('starts the second half of the errand on the line it hands over at', () => {
    // Otherwise the checkpoint is not one: dying after the crossing would put
    // the bird somewhere it has never been, which is worse than starting the
    // flight again.
    const centre = HOME_MAP.centre as [number, number];
    const first = LEVELS.find((level) => level.crossing)!;
    const second = LEVELS.find((level) => level.name === first.crossing!.opens)!;
    const described = LANDMARKS.find((l) => l.name === first.target.name)!;

    const line = crossingLine(
      project(first.start[0], first.start[1], centre),
      project(described.at[0], described.at[1], centre),
      first.crossing!.at,
    );
    const at = project(second.start[0], second.start[1], centre);
    expect(Math.hypot(at.x - line.x, at.z - line.z)).toBeLessThan(20);
  });

  it('flies every level but the first', () => {
    // The perched opening is a hack -- a story beat told through the
    // level-completion machinery -- and this is the fence round it. One level
    // is allowed to be won by starting it.
    const perched = LEVELS.filter((level) => level.begins === 'perched');
    expect(perched).toEqual([LEVELS[0]]);
  });

  it('stands nobody in the way of the landing they are standing there for', () => {
    // A person is two metres of solid, and the landmarks they stand on are
    // the things levels ask you to land on. On a roof terrace that is fine --
    // a terrace is bigger than the bit of it you come down on. On something
    // lying flat it is not: a person on the slab is an obstacle on the target
    // itself, and the pigeon you have to walk up to is on there too.
    for (const level of LEVELS) {
      if (level.target.kind !== 'landmark') continue;
      const described = LANDMARKS.find((l) => l.name === level.target.name);
      if (!described?.people) continue;

      const here = { ...described, x: 0, z: 0 };
      if (!level.person) continue;
      const waiting = pointOn(here, level.person.along, level.person.across);
      for (const standing of peopleOn(here)) {
        // Off a flat target altogether: beside it, not on it.
        if (described.height === 0) {
          const off =
            Math.abs(standing.x) > described.width / 2 ||
            Math.abs(standing.z) > described.depth / 2;
          expect(off, `${described.name} at ${standing.x}, ${standing.z}`).toBe(true);
        }
        // And never within reach of the bird you have to walk up to, whatever
        // it is standing on: a metre, which is two of their widths and half a
        // pigeon's reach.
        const gap = Math.hypot(standing.x - waiting.x, standing.z - waiting.z);
        expect(gap, described.name).toBeGreaterThan(1);
      }
    }
  });

  it('leaves room around each described thing, so it stands apart', () => {
    // Nothing is built or planted inside the margin. Without one a landmark
    // ends up in a terrace, which is exactly what it must not be.
    for (const landmark of LANDMARKS) {
      expect(landmark.margin ?? 0, landmark.name).toBeGreaterThan(0);
    }
  });
});

/** Every level a conversation hands over, down every branch of it. */
function handovers(turn: Turn): string[] {
  const found: string[] = [];
  if (turn.opens !== undefined) found.push(turn.opens);
  for (const said of turn.you ?? []) {
    if (said.opens !== undefined) found.push(said.opens);
    if (said.then) found.push(...handovers(said.then));
  }
  return found;
}
