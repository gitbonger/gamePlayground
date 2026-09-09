import { describe, expect, it } from 'vitest';
// The specification, as text. Vite hands a file over whole with `?raw`, which
// is how a test can read prose without the project growing a node dependency.
import spec from '../../MESSAGES.md?raw';
import { MESSAGES, APPROACH, CROW_CEILING, LOW, SLOW, TIRED, type Moment } from './messages';
import { codesOf } from './tips';
import { LEVELS } from '../levels';

/** A quiet moment: flying along, nothing wrong, nothing nearby. */
const flying = (over: Partial<Moment> = {}): Moment => ({
  level: 'Temető',
  teaching: true,
  since: 30,
  altitude: 40,
  airspeed: 14,
  climb: 0,
  stamina: 1,
  stalled: false,
  noseUp: false,
  flown: 0,
  toGo: 500,
  landing: Infinity,
  perched: false,
  crashed: false,
  blocked: false,
  tooFast: false,
  tooHard: false,
  hunted: false,
  answering: false,
  leaving: false,
  held: false,
  talking: false,
  watching: false,
  down: () => false,
  voice: null,
  speaking: 'en',
  ...over,
});

const message = (id: string) => {
  const found = MESSAGES.find((each) => each.id === id);
  expect(found, id).toBeDefined();
  return found!;
};

/** Whether a message would be shown at this moment, level and all. */
const shows = (id: string, at: Moment): boolean => {
  const m = message(id);
  if (m.on && !m.on.includes(at.level)) return false;
  return m.when(at) && !m.done?.(at);
};

describe('every message is one the rest of the game can work with', () => {
  it('has a name of its own', () => {
    // The name is what a condition is discussed by, here and in MESSAGES.md.
    const ids = MESSAGES.map((each) => each.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('says something in both languages', () => {
    // A line somebody forgot to translate is a blank instruction in the
    // middle of a flight, and it would be found by playing the game in
    // Hungarian rather than by anything here.
    for (const each of MESSAGES) {
      expect(each.text.en.length, each.id).toBeGreaterThan(0);
      expect(each.text.hu.length, each.id).toBeGreaterThan(0);
    }
  });

  it('names levels that exist', () => {
    // A message pinned to a level that has been renamed is a message that
    // never shows, and nothing else would ever say so.
    const names = new Set(LEVELS.map((level) => level.name));
    for (const each of MESSAGES) {
      for (const level of each.on ?? []) expect(names.has(level), `${each.id}: ${level}`).toBe(true);
    }
  });

  it('draws keycaps the keyboard actually sends', () => {
    // The label is what is drawn and the codes are what arrive; a cap that
    // maps to nothing is a key the player cannot press.
    for (const each of MESSAGES) {
      if (each.keys.length === 0) continue;
      expect(codesOf(each.keys).length, each.id).toBeGreaterThan(0);
    }
  });

  it('is written down in MESSAGES.md, and nothing else is', () => {
    // The document is the specification and this file is the implementation.
    // They drift the moment one of them is edited alone, and the drift is
    // invisible: a condition described in prose that no longer matches the
    // code reads exactly like one that does.
    const written = [...spec.matchAll(/`([a-zA-Z]+)`/g)].map((hit) => hit[1]);
    for (const each of MESSAGES) expect(written, each.id).toContain(each.id);
  });
});

describe('what shows when', () => {
  it('does not talk anybody down where there is nowhere to land', () => {
    // A level that ends at a line has nothing to put down on, so the whole
    // approach is somebody else's flight.
    const crossing = flying({ toGo: 40, altitude: 60, tooFast: true, landing: Infinity });
    for (const id of ['landNearArrow', 'loseHeight', 'brakeToSlow', 'beatToSoften', 'flare']) {
      expect(shows(id, crossing), id).toBe(false);
    }
  });

  it('says to land near the arrow once there is an arrow to land near', () => {
    expect(shows('landNearArrow', flying({ landing: 300 }))).toBe(false);
    expect(shows('landNearArrow', flying({ landing: 180 }))).toBe(true);
  });

  it('stops saying it the moment the feet are down', () => {
    // The example this was written for. It is not a duration: it is over
    // when the thing it asked for has happened.
    expect(shows('landNearArrow', flying({ landing: 10, perched: true }))).toBe(false);
  });

  it('tells a bird running out of air to flap', () => {
    expect(shows('flap', flying({ airspeed: SLOW - 1 }))).toBe(true);
  });

  it('does not tell it to flap while it is landing on the thing it was sent to', () => {
    // The other half of the example. Slow over a marked roof is an arrival,
    // and a warning that fires through every landing is a warning nobody
    // reads. This one used to fire through every landing.
    expect(shows('flap', flying({ airspeed: SLOW - 1, landing: 40 }))).toBe(false);
  });

  it('stops telling it to flap once the key is down', () => {
    // Pressing the key is how somebody says they have understood.
    const pressing = flying({ airspeed: SLOW - 1, down: (keys) => keys.includes('SPACE') });
    expect(shows('flap', pressing)).toBe(false);
  });

  it('shouts pull up only where the ground would actually kill', () => {
    const sinking = { altitude: LOW - 2, climb: -3 };
    // Settling gently: this is a landing, not an emergency.
    expect(shows('pullUp', flying({ ...sinking, tooFast: false, tooHard: false }))).toBe(false);
    // Arriving at a speed the legs will not take.
    expect(shows('pullUp', flying({ ...sinking, tooFast: true }))).toBe(true);
    // Or coming down harder than they will take, which kills just as well.
    expect(shows('pullUp', flying({ ...sinking, tooHard: true }))).toBe(true);
  });

  it('warns about the ground on every level, not only the ones that teach', () => {
    // Flying into the ground is not a tutorial topic. Ten of the fourteen
    // levels are marked as teaching nothing, and they used to be silent.
    const late = flying({ level: 'Keleti', teaching: false, airspeed: SLOW - 1 });
    expect(shows('flap', late)).toBe(true);
  });

  it('keeps the brake lesson to the levels that teach', () => {
    const tired = { stamina: TIRED - 0.05 };
    expect(shows('brakes', flying({ ...tired, teaching: true }))).toBe(true);
    expect(shows('brakes', flying({ ...tired, teaching: false }))).toBe(false);
  });
});

describe('the crows', () => {
  it('says to fly low on the two levels where low is the answer', () => {
    // Above the ceiling a chase starts; below it a crow will not come. So the
    // warning is exactly "you are above it" and the answer is exactly "be
    // below it".
    for (const level of ['Népszínház', 'Blaha']) {
      expect(shows('crowsFlyLow', flying({ level, altitude: CROW_CEILING + 5 })), level).toBe(true);
      expect(shows('crowsFlyLow', flying({ level, altitude: CROW_CEILING - 5 })), level).toBe(false);
    }
  });

  it('says nothing of the sort on the level that is flown over the top of them', () => {
    // The Loft has crows too and the answer there is the opposite one: get
    // above a hundred and fifty and outrun them.
    expect(shows('crowsFlyLow', flying({ level: 'The Loft', altitude: 200 }))).toBe(false);
  });

  it('comes back every time he climbs, because it is true every time', () => {
    // Not a one-off. This is a rule about where he is, and he can break it
    // again a hundred metres later.
    const up = flying({ level: 'Blaha', altitude: CROW_CEILING + 5 });
    expect(message('crowsFlyLow').once).toBeUndefined();
    expect(shows('crowsFlyLow', up)).toBe(true);
  });
});

describe('the approach, now that they stack', () => {
  const arriving = (over: Partial<Moment>) =>
    flying({ landing: 100, toGo: 100, altitude: 20, ...over });

  it('asks for one thing at a time on an ordinary approach', () => {
    // They are allowed to stack. What keeps them from stacking is that each
    // has a clause holding it out of the others' way -- the height comes
    // first, then the speed, then the flare.
    const high = arriving({ altitude: 60, tooFast: true });
    expect(shows('loseHeight', high)).toBe(true);
    expect(shows('brakeToSlow', high)).toBe(false);

    const settled = arriving({ altitude: 20, tooFast: true });
    expect(shows('loseHeight', settled)).toBe(false);
    expect(shows('brakeToSlow', settled)).toBe(true);
  });

  it('does not ask for a flare while the bird is still too fast', () => {
    expect(shows('flare', arriving({ altitude: 4, tooFast: true }))).toBe(false);
    expect(shows('flare', arriving({ altitude: 4, tooFast: false }))).toBe(true);
  });

  it('says nothing at all beyond the approach', () => {
    for (const id of ['loseHeight', 'brakeToSlow', 'beatToSoften', 'flare']) {
      expect(shows(id, arriving({ landing: APPROACH + 10, altitude: 4, tooFast: true })), id).toBe(
        false,
      );
    }
  });
});

describe('a bird that is not flying is not given flying advice', () => {
  // The opening screen of the game said `Lose some height` to a pigeon
  // standing on a branch, in the middle of a conversation: the level is aimed
  // at the tree he is standing on, so it was nought metres away and he was
  // eighteen metres above it. Every message about flying needs the same
  // clause and none of them had it.
  const standing = flying({ level: 'Nest', perched: true, altitude: 18, airspeed: 0, landing: 0 });

  it('says nothing about the flight while the feet are down', () => {
    for (const id of [
      'flap',
      'pullUp',
      'loseHeight',
      'brakeToSlow',
      'beatToSoften',
      'flare',
      'landNearArrow',
      'crowsFlyLow',
      'crowsLocked',
    ]) {
      expect(shows(id, standing), id).toBe(false);
    }
  });

  it('says nothing about the flight to a bird that has crashed', () => {
    const wreck = flying({ crashed: true, altitude: 2, airspeed: 0, climb: -8 });
    for (const id of ['flap', 'pullUp', 'flare']) expect(shows(id, wreck), id).toBe(false);
    // The one thing there is to say is which key starts again.
    expect(shows('restart', wreck)).toBe(true);
  });
});
