import { describe, expect, it } from 'vitest';
import {
  approachFor,
  CAUTIONS,
  cautionFor,
  codesFor,
  COURSES,
  courseFor,
  createTutor,
  type Lesson,
} from './tips';

const EARLY: Lesson = { at: 20, keys: ['↑'], text: 'up' };
const LATE: Lesson = { at: 100, keys: ['B'], text: 'brake' };
const COURSE = [EARLY, LATE];

describe('handing out the flying lessons', () => {
  it('says nothing until the flight has gone far enough', () => {
    // Distance rather than time, because distance is the only measure of the
    // flight that is also a measure of the player: somebody still working out
    // which way is up has not covered twenty metres.
    const tutor = createTutor(COURSE, 7);
    expect(tutor.update({ flown: 0, toGo: 9999 }, 1 / 60)).toBeNull();
    expect(tutor.update({ flown: 19.9, toGo: 9999 }, 1 / 60)).toBeNull();
    expect(tutor.update({ flown: 20, toGo: 9999 }, 1 / 60)?.text).toBe('up');
  });

  it('gives one at a time, in the order the flight reaches them', () => {
    // Starting a flight already past both thresholds -- which a respawn into
    // the middle of one would -- must not stack two tips into one corner.
    const tutor = createTutor(COURSE, 7, 1.5);
    expect(tutor.update({ flown: 500, toGo: 9999 }, 1 / 60)?.text).toBe('up');
    expect(tutor.update({ flown: 500, toGo: 9999 }, 1)?.text).toBe('up');

    // And the corner empties between them. Two instructions that never share
    // the screen but never leave it either read as one instruction changing
    // its mind.
    expect(tutor.update({ flown: 500, toGo: 9999 }, 7)).toBeNull();
    expect(tutor.update({ flown: 500, toGo: 9999 }, 1)).toBeNull();
    expect(tutor.update({ flown: 500, toGo: 9999 }, 1)?.text).toBe('brake');
  });

  it('takes a lesson away once it has been up long enough', () => {
    const tutor = createTutor([EARLY], 7, 1.5);
    expect(tutor.update({ flown: 20, toGo: 9999 }, 1 / 60)).not.toBeNull();
    expect(tutor.update({ flown: 21, toGo: 9999 }, 6)).not.toBeNull();
    // Seven seconds of showing, then the corner is empty again.
    expect(tutor.update({ flown: 22, toGo: 9999 }, 1)).toBeNull();
  });

  it('never gives the same lesson twice in one flight', () => {
    const tutor = createTutor([EARLY], 7, 1.5);
    expect(tutor.update({ flown: 20, toGo: 9999 }, 1 / 60)).not.toBeNull();
    tutor.update({ flown: 30, toGo: 9999 }, 8);
    tutor.update({ flown: 30, toGo: 9999 }, 2);
    for (const travelled of [40, 200, 900]) {
      expect(tutor.update({ flown: travelled, toGo: 9999 }, 1 / 60), `${travelled} m`).toBeNull();
    }
  });

  it('gives them all again to a flight that starts over', () => {
    // The player who has just flown into a building is the one who most wants
    // to be told again, and the one who never crashes never sees a repeat.
    const tutor = createTutor([EARLY], 7, 1.5);
    expect(tutor.update({ flown: 20, toGo: 9999 }, 1 / 60)).not.toBeNull();
    tutor.update({ flown: 30, toGo: 9999 }, 8);
    tutor.update({ flown: 30, toGo: 9999 }, 2);
    expect(tutor.update({ flown: 40, toGo: 9999 }, 1 / 60)).toBeNull();

    tutor.reset();
    // And not straight away: the new flight has to earn it over again.
    expect(tutor.update({ flown: 0, toGo: 9999 }, 1 / 60)).toBeNull();
    expect(tutor.update({ flown: 20, toGo: 9999 }, 1 / 60)?.text).toBe('up');
  });

  it('goes away when the player uses the key it is about', () => {
    // A lesson somebody is already following is a lesson they do not need on
    // screen -- and pressing the key is the shortest way to find out that it
    // worked.
    const tutor = createTutor([EARLY], 7, 1.5);
    const nothing = () => false;
    expect(tutor.update({ flown: 20, toGo: 9999 }, 1 / 60, nothing)?.text).toBe('up');
    expect(tutor.update({ flown: 21, toGo: 9999 }, 1 / 60, (codes) => codes.includes('ArrowUp'))).toBeNull();
    // And stays away: it has been given, key or no key.
    expect(tutor.update({ flown: 22, toGo: 9999 }, 2, nothing)).toBeNull();
    expect(tutor.update({ flown: 23, toGo: 9999 }, 1 / 60, nothing)).toBeNull();
  });

  it('knows which keys on the keyboard each drawn key stands for', () => {
    // The arrows are drawn as arrows and the same control is also on WASD, so
    // one label answers to two codes -- and a label with no codes at all is a
    // tip that can never be dismissed by doing what it says.
    for (const lesson of Object.values(COURSES).flat()) {
      const codes = codesFor(lesson);
      expect(codes.length, lesson.text).toBeGreaterThanOrEqual(lesson.keys.length);
    }
    // A tip with no keys at all is a thing worth saying that is not a
    // control, and it is dismissed by time rather than by doing it.
    expect(codesFor({ keys: [], text: 'advice' })).toEqual([]);
    expect(codesFor({ keys: ['↑', '↓'], text: '' })).toContain('KeyW');
    expect(codesFor({ keys: ['SPACE'], text: '' })).toEqual(['Space']);
  });

  it('asks for one turn at a time, in the order they are written', () => {
    // The real courses rather than the fixture.
    for (const course of Object.values(COURSES)) {
      // In the order they were written, for the ones counted from the
      // take-off. The ones counted from the arrival are in the same list and
      // come round when the arrival does, which is not a position in a list.
      const order = course.flatMap((lesson) => (lesson.at === undefined ? [] : [lesson.at]));
      expect([...order].sort((a, b) => a - b)).toEqual(order);

      for (const lesson of course) {
        // One trigger or the other, never both and never neither: a lesson
        // with no trigger is never given, and a lesson with two is a lesson
        // whose moment depends on which end of the flight you ask from.
        expect(
          [lesson.at, lesson.within].filter((trigger) => trigger !== undefined),
          lesson.text,
        ).toHaveLength(1);
        // Short enough to take in at a glance, since it is read while flying.
        expect(lesson.text.length, lesson.text).toBeGreaterThan(0);
        expect(lesson.text.length, lesson.text).toBeLessThan(60);
        // And every key it draws has to do something. Drawing none is
        // allowed -- some things are worth saying that are not a control --
        // but a key on screen that answers to nothing is a lie.
        for (const key of lesson.keys) {
          expect(codesFor({ keys: [key], text: '' }).length, key).toBeGreaterThan(0);
        }
      }
    }
  });

  it('belongs to a level, so a later one never sees it again', () => {
    // The rule that makes a one-off a one-off. A death repeats the lesson,
    // because the flight is being flown again; a later level does not,
    // because it is a different flight with different things to think about.
    // Being told to try turning while threading a goods yard would be the
    // game talking over itself.
    const tutor = createTutor(COURSE, 7, 1.5);
    expect(tutor.update({ flown: 20, toGo: 9999 }, 1 / 60)?.text).toBe('up');

    // A level with nothing to teach teaches nothing, however far it is flown.
    tutor.teach(courseFor('The Yard'), 0);
    for (const travelled of [20, 100, 900]) {
      expect(tutor.update({ flown: travelled, toGo: 9999 }, 1 / 60), `${travelled} m`).toBeNull();
    }
    expect(courseFor('The Yard')).toEqual([]);
  });

  it('counts a level taken up in mid-air from where it was taken up', () => {
    // A level handed over by crossing a line inherits the distance the last
    // one ran up -- five hundred metres of it. Counted from zero, every
    // lesson it has would be a lesson already missed.
    const tutor = createTutor([], 7, 1.5);
    tutor.teach(COURSE, 500);
    expect(tutor.update({ flown: 500, toGo: 9999 }, 1 / 60)).toBeNull();
    expect(tutor.update({ flown: 519, toGo: 9999 }, 1 / 60)).toBeNull();
    expect(tutor.update({ flown: 520, toGo: 9999 }, 1 / 60)?.text).toBe('up');
  });
});

describe('the cautions, which watch the flight', () => {
  /** A bird that is fine: high, fast, fresh and flying. */
  const fine = { altitude: 120, airspeed: 16, stamina: 1, stalled: false, climb: 0 };

  it('says nothing to a flight that is going well', () => {
    expect(cautionFor(true, fine)).toBeNull();
  });

  it('calls out slow, low and tired, each on its own', () => {
    expect(cautionFor(true, { ...fine, airspeed: 5 })?.text).toBe('Keep flapping!');
    expect(cautionFor(true, { ...fine, altitude: 9, climb: -1 })?.text).toBe('Pull up!');
    expect(cautionFor(true, { ...fine, stamina: 0.29 })?.text).toBe('Slow down!');
  });

  it('puts the wings before the nose when the bird is low and slow', () => {
    // The one ordering that matters. Low and slow looks like a case for
    // pulling up, and pulling up with no speed is how a bird stalls into the
    // ground it was trying to clear -- so the answer is the wings, which are
    // the only control that makes more of both.
    expect(cautionFor(true, { ...fine, altitude: 5, climb: -1, airspeed: 4 })?.text).toBe(
      'Keep flapping!',
    );
  });

  it('leaves the slow problem until the quick ones are over', () => {
    // Tired is the only one of the three you can put off, so it is the only
    // one that gives way. A bird about to hit the ground has a bigger problem
    // than the one it will have in thirty seconds.
    const spent = { ...fine, altitude: 5, climb: -1, stamina: 0.1 };
    expect(cautionFor(true, spent)?.text).toBe('Pull up!');
  });

  it('leaves height to fly in without being talked to', () => {
    // The gap between the two cautions is where the game is quiet, and it was
    // too narrow to fly in: at twenty metres a pigeon crossing a park was
    // told to pull up the whole way, and pulling up hard enough to stop it
    // stalls the wing, which brings on the other caution, which drops it back
    // under twenty. Two instructions taking it in turns.
    //
    // Flying low is not the problem. Going down is.
    expect(cautionFor(true, { ...fine, altitude: 8, climb: 0 })).toBeNull();
    expect(cautionFor(true, { ...fine, altitude: 8, climb: 1 })).toBeNull();
    expect(cautionFor(true, { ...fine, altitude: 15, climb: -2 })).toBeNull();
    expect(cautionFor(true, { ...fine, altitude: 8, climb: -2 })?.text).toBe('Pull up!');
  });

  it('keeps the stall for everyone and the lessons for the taught', () => {
    // A pigeon spends half its life low, slow and tired on purpose, so those
    // three stop once the game stops teaching. Nobody stalls on purpose.
    const stalled = { ...fine, stalled: true };
    const struggling = { ...fine, altitude: 5, climb: -1, airspeed: 4, stamina: 0.1 };
    expect(cautionFor(false, stalled)?.text).toBe('Nose down!');
    expect(cautionFor(false, struggling)).toBeNull();
    expect(cautionFor(true, struggling)).not.toBeNull();
  });

  it('puts the stall before everything, because it is already happening', () => {
    // The others are about to be a problem. A stall is one: the wing has
    // stopped working, and nothing else is worth trying until it works again.
    expect(cautionFor(true, { ...fine, altitude: 5, airspeed: 4, stamina: 0.1, stalled: true })?.text).toBe(
      'Nose down!',
    );
  });

  it('draws every one of them with a key that does something', () => {
    for (const warning of CAUTIONS) {
      expect(warning.text.length, warning.text).toBeLessThan(30);
      expect(codesFor(warning).length, warning.text).toBeGreaterThan(0);
    }
  });

  it('takes its thresholds in the simulation\'s own units', () => {
    // Twenty km/h is the readout; 5.6 m/s is the air. A threshold written in
    // km/h would be a threshold about the display rather than about flying,
    // and the display is the thing most likely to change.
    expect(cautionFor(true, { ...fine, airspeed: 20 / 3.6 - 0.01 })?.text).toBe('Keep flapping!');
    expect(cautionFor(true, { ...fine, airspeed: 20 / 3.6 + 0.01 })).toBeNull();
  });
});

describe('talking an approach down', () => {
  /** On the way in: a hundred metres to go, low and steady. */
  const near = { toGo: 100, altitude: 20, fast: false, sinking: false };

  it('says nothing until the target is close', () => {
    // Out here it is a flight, not an approach, and the arrow is enough.
    expect(approachFor({ ...near, toGo: 151 })).toBeNull();
    expect(approachFor({ ...near, toGo: 150 })).not.toBeNull();
  });

  it('deals with height first, because height is the one that runs out', () => {
    // A pigeon glides about six to one. Too high at a hundred metres out
    // cannot be fixed at twenty, whereas too fast can -- so height is said
    // first even when both are wrong.
    const high = { ...near, altitude: 60, fast: true };
    expect(approachFor(high)?.text).toBe('Lose some height');
    expect(approachFor({ ...high, altitude: 20 })?.text).toBe('Brake to slow down');
  });

  it('answers a hard sink with the wings, not the nose', () => {
    // At roof height, beating arrests a sink; pulling the nose up trades the
    // speed there is no longer any of.
    expect(approachFor({ ...near, altitude: 10, sinking: true })?.text).toBe('Beat to soften it');
    // Higher up there is room to fly out of it, and the general instruction
    // stands.
    expect(approachFor({ ...near, altitude: 30, toGo: 120, sinking: true })?.text).toBe(
      'Brake, then flare',
    );
  });

  it('ends on the flare, which is the last thing you do', () => {
    expect(approachFor({ ...near, toGo: 20, altitude: 5 })?.text).toBe('Flare to settle');
  });

  it('draws every one of them with a key that does something', () => {
    const shown = [
      approachFor({ ...near, altitude: 60 }),
      approachFor({ ...near, fast: true }),
      approachFor({ ...near, altitude: 10, sinking: true }),
      approachFor({ ...near, toGo: 20, altitude: 5 }),
      approachFor(near),
    ];
    for (const tip of shown) {
      expect(tip).not.toBeNull();
      expect(codesFor(tip!).length, tip!.text).toBeGreaterThan(0);
      expect(tip!.text.length, tip!.text).toBeLessThan(30);
    }
  });
});
