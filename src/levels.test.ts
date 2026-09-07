import { describe, expect, it } from 'vitest';
import {
  bellyOnEntry,
  CHARACTERS,
  crossed,
  crossingLine,
  lineThrough,
  dialogueOf,
  HOMECOMING,
  NOT_AT_MATYAS,
  LEVELS,
  characterNamed,
  metBy,
  opensOf,
  PINK,
  SCENES,
  sceneNamed,
  standingOf,
  targetName,
  waitingIn,
} from './levels';
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
    // Everybody who is ever cast on it, rather than one of them: Pink moves
    // up here for the second half of the story, and a second bird on the
    // terrace is a second chance to be standing in a planter.
    const here = { ...LOFT, x: 0, z: 0 };
    const terrace = terraceOf(here)!;
    const standing = LEVELS.flatMap((level) =>
      level.cast.filter((spot) => spot.on.kind === 'landmark' && spot.on.name === LOFT.name),
    );
    expect(standing.length).toBeGreaterThan(1);

    for (const waiting of standing) {
    const person = pointOn(terrace, waiting.along, waiting.across);

    // On the terrace: measured back in the terrace's own frame, because the
    // terrace is turned too.
    const dx = person.x - terrace.x;
    const dz = person.z - terrace.z;
    const along = dx * Math.cos(terrace.yaw) - dz * Math.sin(terrace.yaw);
    const across = dx * Math.sin(terrace.yaw) + dz * Math.cos(terrace.yaw);
    expect(Math.abs(along), waiting.who).toBeLessThan(terrace.width / 2);
    expect(Math.abs(across), waiting.who).toBeLessThan(terrace.depth / 2);

    // And not inside a bush, with room to walk round it: a pigeon is about a
    // fifth of a metre across.
    for (const bush of plantTerrace(here)) {
      const gap = Math.hypot(person.x - bush.x, person.z - bush.z) - bush.radius;
      expect(gap, `${bush.x.toFixed(1)}, ${bush.z.toFixed(1)}`).toBeGreaterThan(0.5);
    }
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
    expect(waitingIn(leaving)).toBeDefined();
    expect(leaving.begins).toBe('perched');
    expect(leaving.target).toEqual({ kind: 'landmark', name: HOME_TREE.name });

    // He stands where she stands, mirrored through the middle -- so the two
    // of them are twice her offset apart, and that has to be inside a bird's
    // reach or the opening level quietly becomes one you have to walk.
    const middle = { x: 0, z: 0, yaw: HOME_TREE.yaw ?? 0 };
    const her = pointOn(middle, waitingIn(leaving)!.along, waitingIn(leaving)!.across);
    const him = pointOn(middle, -waitingIn(leaving)!.along, -waitingIn(leaving)!.across);
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
    expect(waitingIn(leaving)).toBeDefined();
    const here = { ...HOME_TREE, x: 0, z: 0 };
    const nest = nestOn(here)!;
    const her = pointOn(here, waitingIn(leaving)!.along, waitingIn(leaving)!.across);
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
    expect(waitingIn(leaving)).toBeDefined();
    const here = { ...HOME_TREE, x: 0, z: 0 };
    const crest = HOME_TREE.width / 2;
    const nest = nestOn(here)!;
    const her = pointOn(here, waitingIn(leaving)!.along, waitingIn(leaving)!.across);
    const him = pointOn(here, -waitingIn(leaving)!.along, -waitingIn(leaving)!.across);

    expect(Math.hypot(nest.x, nest.z) + nest.radius).toBeLessThan(crest);
    for (const bird of [her, him]) {
      // Half a pigeon's width off the edge, so it is standing on the crest
      // rather than balanced on the lip of it.
      expect(Math.hypot(bird.x, bird.z) + 0.1).toBeLessThan(crest);
    }
  });

  it('keeps the pink pigeon out of the flock, and lets there be only one', () => {
    // She is somebody, and the flock draws its colours from `PIGEON_MORPHS`.
    // A city with thirty pink pigeons in it has no pink pigeon in it.
    expect(PIGEON_MORPHS).not.toContain(PINK_MORPH);
    expect(CHARACTER_MORPHS).toContain(PINK_MORPH);
    expect(CHARACTER_MORPHS[PINK.morph]).toBe(PINK_MORPH);

    // And one character wears it, however many levels she appears in. She is
    // in most of them now -- that is the point of a cast: the same bird in a
    // different place, rather than a different bird per level.
    const pink = CHARACTERS.filter((who) => who.morph === PINK.morph);
    expect(pink).toEqual([PINK]);
  });

  it('gives everybody in a cast a name the game knows', () => {
    // The cast reaches for a character by name, the way a level reaches for a
    // landmark by name, and the cost of that is a typo being somebody who
    // never appears -- unless somebody looks, which is this.
    for (const level of LEVELS) {
      for (const spot of level.cast) {
        expect(characterNamed(spot.who), `${level.name} casts ${spot.who}`).toBeDefined();
      }
    }
    // And no two characters share a name, or the lookup is a coin toss.
    expect(new Set(CHARACTERS.map((who) => who.name)).size).toBe(CHARACTERS.length);
  });

  it('casts whoever the level is finished by meeting', () => {
    // The two halves have to agree: the finish names who completes it and the
    // cast is what puts them there, so a level finished by meeting somebody
    // it does not stand anywhere is a level that cannot be finished.
    for (const level of LEVELS) {
      const who = metBy(level);
      if (who === undefined) continue;
      expect(standingOf(level, who), `${level.name} meets ${who}`).toBeDefined();
      // And on the thing the level is aimed at, or the arrow points one way
      // and the pigeon is somewhere else.
      expect(waitingIn(level)!.on, level.name).toEqual(level.target);
    }
  });

  it('moves Pink off the tree once the park has been crossed, and leaves her there', () => {
    // The story, told entirely by where she is written down. She is on the
    // branch for the first two levels -- she said she would rather stay --
    // and on the loft from the level after, which is what makes the flight
    // home end on an empty nest without anything having to remember that she
    // left. Restarting the third level puts her on the loft, because that is
    // where that level says she is.
    const where = LEVELS.map((level) => {
      const spot = standingOf(level, PINK.name);
      return spot && spot.on.kind === 'landmark' ? spot.on.name : null;
    });
    expect(where).toEqual([
      HOME_TREE.name,
      HOME_TREE.name,
      ...LEVELS.slice(2).map(() => LOFT.name),
    ]);
    expect(where.length).toBe(LEVELS.length);
  });

  it('never stands two of the cast on top of each other', () => {
    // Two birds on one terrace is a thing now, so it is worth checking they
    // are two birds rather than one: a pigeon is about a fifth of a metre
    // across, and walking up to somebody has to be walking up to *somebody*.
    for (const level of LEVELS) {
      for (const [i, one] of level.cast.entries()) {
        for (const other of level.cast.slice(i + 1)) {
          if (JSON.stringify(one.on) !== JSON.stringify(other.on)) continue;
          const apart = Math.hypot(one.along - other.along, one.across - other.across);
          expect(apart, `${level.name}: ${one.who} and ${other.who}`).toBeGreaterThan(MEET_RADIUS);
        }
      }
    }
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
      const said = dialogueOf(level);
      if (!said) continue;
      for (const opens of handovers(said)) {
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
    expect(waitingIn(leaving)).toBeDefined();
    for (const [index] of dialogueOf(leaving)!.you!.entries()) {
      let talk = begin(dialogueOf(leaving)!);
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

    // Three heights, and they are three kinds of level rather than three
    // numbers somebody picked. Perched levels are not released at all, so
    // theirs is a formality.
    const flown = LEVELS.filter((level) => level.begins !== 'perched');

    // Under the roofline: the two halves of the errand, which is what makes
    // them a flight *through* a park rather than a look down at one.
    const under = flown.filter((level) => level.release < defaultMapWorldOptions.maxHeight * 2);
    expect(under.map((level) => level.name)).toEqual(['Across the park', 'Grabbing food']);

    // Over the roofs but well short of a sky drop: the search, which is a run
    // of short hops round a district. High enough to see the next square,
    // low enough that it is a street rather than a map.
    const district = flown.filter(
      (level) => level.release >= defaultMapWorldOptions.maxHeight * 2 && level.release < 100,
    );
    expect(district.map((level) => level.name)).toEqual([
      'Mátyás tér',
      'Jani Pali tér',
      'Népszínház',
    ]);

    // And the oldest are sky drops at a hundred, with the whole approach laid
    // out beneath you.
    const dropped = flown.filter((level) => !under.includes(level) && !district.includes(level));
    for (const level of dropped) expect(level.release, level.name).toBe(100);
    expect(dropped).toHaveLength(3);

    // And the district ones are all above what is built on it, which is the
    // other half of what "low" means here: under the sky drops, over the
    // roofs. The last of them is over the roofs on purpose -- its danger is
    // above the bird rather than below it.
    for (const level of district) {
      expect(level.release, level.name).toBeGreaterThan(HOME_TREE.height);
    }
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

  it('puts a bird at the end of a level only when the level ends in a meeting', () => {
    // The rule that keeps the three finishes apart: nobody stands at a line,
    // and nobody stands in the grain. Two levels aim at the concrete slab, so
    // a pigeon waiting on the first of them would be standing on the second
    // one's -- and the feeding level would be somebody to talk to instead of
    // a meal to eat.
    for (const level of LEVELS) {
      const meets = level.finish.kind === 'meeting';
      expect(waitingIn(level) !== undefined, level.name).toBe(meets);
      expect(dialogueOf(level) !== undefined, level.name).toBe(meets);
      // And the other way about: the two that finish by themselves say what
      // they open, and the one that ends in a conversation leaves that to the
      // conversation.
      expect(opensOf(level) !== undefined, level.name).toBe(!meets);
    }
  });

  it('hands over to something that exists, whichever kind of thing it is', () => {
    // A level that finishes by itself names what comes next, and what comes
    // next is either another level or a scene the game plays. Two namespaces
    // reached through one field, so the check is that whichever it says, the
    // thing it says is there -- a typo either side is a level that silently
    // never arrives.
    const levels = new Set(LEVELS.map((level) => level.name));
    for (const level of LEVELS) {
      const opens = opensOf(level);
      if (!opens) continue;
      if ('level' in opens) expect(levels, level.name).toContain(opens.level);
      else expect(sceneNamed(opens.scene), `${level.name} opens ${opens.scene}`).toBeDefined();
    }
  });

  it('ends every scene on the opening shot of a level that exists', () => {
    // A scene closes on the place a level begins -- the same call the game
    // makes to put the player there -- so that the shot cannot drift from the
    // one the player remembers. Which only works while the level is real.
    const levels = new Set(LEVELS.map((level) => level.name));
    for (const scene of SCENES) {
      // A beat that happens where the bird is standing goes nowhere and takes
      // no time: no level to close on, and nothing to fly over.
      if (scene.endsOn === undefined) {
        expect(scene.seconds, scene.name).toBe(0);
        // And it must have something to say, or it is a scene that stops the
        // world for no reason and hands straight on.
        expect(scene.says, scene.name).toBeDefined();
        continue;
      }
      expect(levels, scene.name).toContain(scene.endsOn);
      // Long enough to read as going somewhere, short enough to sit through.
      expect(scene.seconds, scene.name).toBeGreaterThan(1);
      expect(scene.seconds, scene.name).toBeLessThan(15);
      // And arcing high enough over the city to clear what is built on it.
      expect(scene.cruise, scene.name).toBeGreaterThan(defaultMapWorldOptions.maxHeight);
    }
  });

  it('runs every scene into something, and lets a chain of them end at a level', () => {
    // A scene hands over the way a level does, so a chapter can be a flight,
    // a beat and another flight -- and none of the three knows it is in a
    // chain. What would be silently broken is a scene opening nothing, or a
    // chain that never reaches a level: the player would be left standing on
    // a branch with the world stopped and no key that does anything.
    for (const scene of SCENES) {
      let opens = scene.opens;
      const seen = new Set<string>([scene.name]);
      for (let step = 0; step < SCENES.length + 1; step += 1) {
        if ('level' in opens) break;
        const next = sceneNamed(opens.scene);
        expect(next, `${scene.name} opens ${opens.scene}`).toBeDefined();
        expect(seen.has(next!.name), `${scene.name} loops`).toBe(false);
        seen.add(next!.name);
        opens = next!.opens;
      }
      expect('level' in opens, `${scene.name} reaches a level`).toBe(true);
      if ('level' in opens) {
        expect(LEVELS.map((l) => l.name), scene.name).toContain(opens.level);
      }
    }
  });

  it('holds only the scenes that have something to say', () => {
    // Saying something is what makes a scene wait for the player, so the two
    // have to be one decision rather than two fields that can disagree. The
    // homecoming has a line and holds; the flight into town has none and runs
    // straight into the level, so what the player sees is one movement.
    const holds = SCENES.filter((scene) => scene.says !== undefined);
    expect(holds.map((scene) => scene.name)).toEqual([HOMECOMING.name, NOT_AT_MATYAS.name]);
    // Both of them name where he is going next, which is what a monologue in
    // a search is for: it is the only thing telling the player why the next
    // level exists.
    for (const scene of holds) {
      const spoken = scene.says!.join(' ');
      const named = LEVELS.some((level) => spoken.includes(level.name));
      expect(named, spoken).toBe(true);
      // And every line of it is a line: a monologue with an empty one in it
      // is a blank row in the panel.
      for (const line of scene.says!) expect(line.length, scene.name).toBeGreaterThan(0);
    }
  });

  it('leaves nobody standing on a level that is finished by finding nobody', () => {
    // The searching levels are the one kind that is *about* an absence. A
    // pigeon standing on the square would not only be wrong for the story --
    // it would be walked up to, and the level would try to be a conversation.
    for (const level of LEVELS) {
      if (level.finish.kind !== 'arrival') continue;
      const there = level.cast.filter(
        (spot) => spot.on.kind === 'landmark' && spot.on.name === targetName(level),
      );
      expect(there, `${level.name} has somebody on it`).toEqual([]);
      // And it has somewhere to hand on to, or the search stops dead.
      expect(level.finish.opens, level.name).toBeDefined();
    }
    // Two of them, and they are the district ones.
    const searching = LEVELS.filter((level) => level.finish.kind === 'arrival');
    expect(searching.map((level) => level.name)).toEqual(['Mátyás tér', 'Jani Pali tér']);
  });

  it('gives the search somewhere big enough to land on', () => {
    // A square is a place you come down *in*, unlike the concrete slabs,
    // which are targets and are meant to be hard. A nine-metre square with a
    // Hungarian name on it would be a slab telling a fib.
    for (const level of LEVELS) {
      if (level.finish.kind !== 'arrival') continue;
      const described = LANDMARKS.find((l) => l.name === targetName(level))!;
      expect(described, level.name).toBeDefined();
      expect(Math.min(described.width, described.depth), described.name).toBeGreaterThan(15);
      // Flat, so arriving on it is arriving on the ground it is painted on.
      expect(described.height, described.name).toBe(0);
    }
  });

  it('flies the escort on the errand and nowhere else', () => {
    // The flock is company for the long crossing of the park -- half a
    // kilometre of nothing but trees -- and it is noise everywhere else: over
    // a district, in among the crows, or standing on a branch in the middle
    // of a conversation. Stated by every level, defaulted by none.
    const escorted = LEVELS.filter((level) => level.escort);
    expect(escorted.map((level) => level.name)).toEqual(['Across the park', 'Grabbing food']);
    for (const level of LEVELS) expect(typeof level.escort, level.name).toBe('boolean');
  });

  it('keeps the escort across a handover that is one flight in two pieces', () => {
    // The errand is flown in two levels and is one flight, so the flock must
    // not blink out at the line. Which is a claim about the pair rather than
    // about either of them: whatever a level that opens another says about
    // the escort, the two have to agree, or the seam shows.
    for (const level of LEVELS) {
      const opens = opensOf(level);
      if (!opens || !('level' in opens)) continue;
      const next = LEVELS.find((l) => l.name === opens.level)!;
      expect(next.escort, `${level.name} hands to ${next.name}`).toBe(level.escort);
    }
  });

  it('lays the marks along the way the level actually goes', () => {
    // They are help, so they have to help: a mark behind the bird, or one
    // past the finish, is a hand held out in the wrong direction. Checked as
    // a route -- each one further from the release point than the last, and
    // all of them short of whatever ends the level.
    const centre = HOME_MAP.centre as [number, number];
    for (const level of LEVELS) {
      const marks = level.waypoints ?? [];
      if (marks.length === 0) continue;

      const from = project(level.start[0], level.start[1], centre);
      const away = marks.map((at) => {
        const point = project(at[0], at[1], centre);
        return Math.hypot(point.x - from.x, point.z - from.z);
      });
      for (let i = 1; i < away.length; i += 1) {
        expect(away[i]!, `${level.name} mark ${i + 1}`).toBeGreaterThan(away[i - 1]!);
      }

      // And short of the end of it, for a level that ends at a line: a mark
      // beyond the stripe is one the player can never reach, because
      // reaching the stripe ends the level.
      if (level.finish.kind !== 'crossing') continue;
      const line = project(level.finish.through[0], level.finish.through[1], centre);
      const finish = Math.hypot(line.x - from.x, line.z - from.z);
      for (const [i, out] of away.entries()) {
        expect(out, `${level.name} mark ${i + 1} is past the line`).toBeLessThan(finish);
      }
    }
  });

  it('starts the bird looking at the first mark, where there is one', () => {
    // Stated here rather than watched for: the spawn faces the route, and a
    // level that lays out marks and then points the bird somewhere else is
    // arguing with its own directions on the first frame.
    const centre = HOME_MAP.centre as [number, number];
    const marked = LEVELS.filter((level) => (level.waypoints ?? []).length > 0);
    expect(marked.length).toBeGreaterThan(0);

    for (const level of marked) {
      const from = project(level.start[0], level.start[1], centre);
      const first = level.waypoints![0]!;
      const at = project(first[0], first[1], centre);
      // Ahead of the release point rather than on top of it: a mark you are
      // already standing in is one that vanishes before it has said anything.
      expect(Math.hypot(at.x - from.x, at.z - from.z), level.name).toBeGreaterThan(20);
    }
  });

  it('feeds the bird on the level that is about food, and nowhere else', () => {
    // The level is the eating: no arrival, no conversation, and a condition
    // met by walking about on the concrete picking things up. It is aimed at
    // the same slab the level before it crosses towards, which is the reason
    // nobody may be standing on it.
    const eating = LEVELS.filter((level) => level.finish.kind === 'fed');
    expect(eating).toHaveLength(1);
    const level = eating[0]!;
    expect(level.name).toBe('Grabbing food');
    expect(level.target.kind).toBe('landmark');
    // Arrived at hungry: a level won by filling the belly has to begin with
    // it unfilled, or it is won on the tick it opens.
    expect(level.health).toBeLessThan(1);
  });

  it('hands the crossing over to a level that exists, short of the target', () => {
    // The same check the conversations get, for the same reason -- and one
    // more: a line further out than the target is a level you finish by
    // landing on something you were meant to fly past.
    const centre = HOME_MAP.centre as [number, number];
    const names = new Set(LEVELS.map((level) => level.name));
    for (const level of LEVELS) {
      const ends = level.finish;
      if (ends.kind !== 'crossing') continue;
      expect('level' in ends.opens, level.name).toBe(true);
      if ('level' in ends.opens) expect(names, level.name).toContain(ends.opens.level);

      // Far enough out to be a flight rather than a formality, and short of
      // the thing the level is pointed at -- a line beyond the target would
      // be a level you finish by overflying what you were aiming for.
      const described = LANDMARKS.find((l) => l.name === level.target.name)!;
      const from = project(level.start[0], level.start[1], centre);
      const to = project(described.at[0], described.at[1], centre);
      const line = project(ends.through[0], ends.through[1], centre);
      const out = Math.hypot(line.x - from.x, line.z - from.z);
      const span = Math.hypot(to.x - from.x, to.z - from.z);
      expect(out, level.name).toBeGreaterThan(50);
      expect(out, level.name).toBeLessThan(span - 50);
    }
  });

  it('aims a crossing level at something the line can be painted from', () => {
    // The stripe on the ground is worked out from the same two points the
    // rule is -- the release point and the thing the level is aimed at -- and
    // a level aimed at a wagon has no second point until the trains have been
    // laid out. A line nobody can see is the thing this paint is here to
    // stop, so the shape that cannot be painted is refused here rather than
    // silently skipped there.
    for (const level of LEVELS) {
      if (level.finish.kind !== 'crossing') continue;
      expect(level.target.kind, level.name).toBe('landmark');
      expect(LANDMARKS.map((l) => l.name), level.name).toContain(level.target.name);
    }
  });

  it('starts the level after a crossing on the line it hands over at', () => {
    // Otherwise the checkpoint is not one: dying after the crossing would put
    // the bird somewhere it has never been, which is worse than starting the
    // flight again.
    //
    // Every crossing rather than the first of them. It used to say `find`,
    // which was true of the one there was and quietly stopped covering
    // anything the moment a second was added -- and a second was added.
    const centre = HOME_MAP.centre as [number, number];
    const crossings = LEVELS.filter((level) => level.finish.kind === 'crossing');
    expect(crossings.length).toBeGreaterThan(1);

    for (const first of crossings) {
      const ends = first.finish;
      if (ends.kind !== 'crossing') continue;
      const opens = ends.opens;
      if (!('level' in opens)) throw new Error(`${first.name} crosses into a scene`);
      const second = LEVELS.find((level) => level.name === opens.level)!;

      const line = lineThrough(
        project(first.start[0], first.start[1], centre),
        project(ends.through[0], ends.through[1], centre),
      );
      const at = project(second.start[0], second.start[1], centre);
      expect(Math.hypot(at.x - line.x, at.z - line.z), first.name).toBeLessThan(20);
    }
  });

  it('gives the belly it takes to fly each level', () => {
    // Every level says how full the bird is on arriving, because the belly is
    // the one thing that carries between them and a level nobody can finish
    // is worse than one nobody can lose.
    for (const level of LEVELS) {
      expect(level.health, level.name).toBeGreaterThan(0);
      expect(level.health, level.name).toBeLessThanOrEqual(1);
    }

    // And enough of it to fly the level: three kilometres is a full belly, so
    // whatever a level asks the bird to cover has to fit in what it starts
    // with. Measured against the flight itself rather than restated.
    const centre = HOME_MAP.centre as [number, number];
    for (const level of LEVELS) {
      if (level.begins === 'perched') continue;
      const described = LANDMARKS.find((l) => l.name === level.target.name);
      if (!described) continue;
      const from = project(level.start[0], level.start[1], centre);
      const to = project(described.at[0], described.at[1], centre);
      // How far this level asks the bird to fly, which for a level that ends
      // at a line is the line and not the target beyond it. It used to be the
      // span *less* the crossing, which is the half of the flight this level
      // does not fly -- so the level with a line across it was checked against
      // its successor's distance, and the longer its own half got the less was
      // asked of it.
      const span = Math.hypot(to.x - from.x, to.z - from.z);
      const toGo =
        level.finish.kind === 'crossing'
          ? (() => {
              const line = project(level.finish.through[0], level.finish.through[1], centre);
              return Math.hypot(line.x - from.x, line.z - from.z);
            })()
          : span;
      // A full belly is three kilometres of level flight.
      expect(level.health * 3000, `${level.name} has ${toGo.toFixed(0)} m to fly`).toBeGreaterThan(
        toGo,
      );
    }
  });

  it('tells the story with the bellies: hungry until the food, full after', () => {
    // The data says what the levels are. Everything up to and including the
    // errand is flown on a fraction of a belly, because that is the errand;
    // everything after it is flown on a full one, because he has eaten.
    const upTo = LEVELS.slice(0, 3).map((level) => level.health);
    const after = LEVELS.slice(3).map((level) => level.health);
    for (const belly of upTo) expect(belly).toBeLessThan(0.5);
    for (const belly of after) expect(belly).toBe(1);
  });

  it('never takes a belly away, and never leaves one too empty to fly', () => {
    // The rule for a level walked into out of the one before. It is a floor
    // rather than a setting: a player who flew the last level well keeps what
    // they earned, and a player who limped in on nothing is given a level
    // they can still fly rather than one they have already lost.
    const errand = LEVELS[2]!;
    expect(bellyOnEntry(errand, 0.9)).toBe(0.9);
    expect(bellyOnEntry(errand, 0.01)).toBe(errand.health);
    expect(bellyOnEntry(errand, errand.health)).toBe(errand.health);
  });

  it('flies every level but the first', () => {
    // The perched opening is a hack -- a story beat told through the
    // level-completion machinery -- and this is the fence round it. One level
    // is allowed to be won by starting it.
    const perched = LEVELS.filter((level) => level.begins === 'perched');
    expect(perched).toEqual([LEVELS[0]]);
  });

  it('turns somebody standing alone beside a flat thing to look at it', () => {
    // The thrower is the reason this matters: somebody throwing grain onto a
    // patch of concrete with their back to it is a person the scene cannot
    // explain. The figure faces -Z at a facing of zero, the same convention
    // the bird uses, so this is arithmetic rather than a look at the model.
    //
    // One person, though, and that qualifier is the claim rather than a way
    // round a failing test: a lone figure beside a thing is beside it *for*
    // something, and a crowd is not. Twenty people in a square all facing the
    // middle is an audience waiting for something to happen in it.
    for (const described of LANDMARKS) {
      if (!described.people || described.height > 0) continue;
      if (described.people.length !== 1) continue;
      const here = { ...described, x: 0, z: 0 };
      for (const standing of peopleOn(here)) {
        // Where they are looking, and where the middle of the slab is from
        // where they stand.
        const look = { x: -Math.sin(standing.facing), z: -Math.cos(standing.facing) };
        const away = Math.hypot(standing.x, standing.z);
        const at = { x: -standing.x / away, z: -standing.z / away };
        // Within a handful of degrees of straight at it.
        const off = Math.acos(look.x * at.x + look.z * at.z);
        expect(off, `${described.name} is looking ${off.toFixed(2)} rad off`).toBeLessThan(0.2);
      }
    }
  });

  it('has the crowd in a square facing every which way', () => {
    // The other half of it, and it is a claim rather than the absence of one:
    // a crowd that is all pointed one way is a queue, and a crowd all facing
    // the middle is an audience. Twenty people standing about should be
    // standing about.
    const square = LANDMARKS.find((l) => l.people && l.people.length > 5);
    expect(square, 'somewhere with a crowd in it').toBeDefined();

    const facings = square!.people!.map((who) => who.facing);
    // Spread over the whole circle rather than clustered: at least one of
    // them in each quarter of it.
    for (const quarter of [0, 1, 2, 3]) {
      const some = facings.some((f) => {
        const turned = ((f % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        return Math.floor(turned / (Math.PI / 2)) === quarter;
      });
      expect(some, `nobody facing quarter ${quarter}`).toBe(true);
    }
  });

  it('stands nobody on ground their landmark has not reserved', () => {
    // A landmark keeps the generator off its own footprint plus its margin,
    // and that is the only ground anybody standing on it is certain not to be
    // inside a wall on. The crowd on the square is what made this worth
    // checking -- it reaches twenty metres out, which is further than any
    // landmark had ever put a person, and further than the eight metres that
    // square first reserved.
    for (const described of LANDMARKS) {
      for (const who of described.people ?? []) {
        const room = described.margin ?? 0;
        expect(Math.abs(who.along), `${described.name} along`).toBeLessThanOrEqual(
          described.width / 2 + room,
        );
        expect(Math.abs(who.across), `${described.name} across`).toBeLessThanOrEqual(
          described.depth / 2 + room,
        );
      }
    }
  });

  it('leaves the middle of a crowded square clear to land on', () => {
    // A person is two metres of solid, and a pigeon has to come down on this.
    // Twenty of them spread evenly over a square is a square you cannot land
    // in, so they stand round the edges and off across the paving.
    const square = LANDMARKS.find((l) => l.people && l.people.length > 5)!;
    for (const who of square.people!) {
      expect(Math.hypot(who.along, who.across), `${who.along}, ${who.across}`).toBeGreaterThan(6);
    }
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
      const stands = waitingIn(level);
      if (!stands) continue;
      const waiting = pointOn(here, stands.along, stands.across);
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
