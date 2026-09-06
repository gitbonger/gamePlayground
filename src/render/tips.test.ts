import { describe, expect, it } from 'vitest';
import { codesFor, createTutor, LESSONS, warningFor, WARNINGS, type Lesson } from './tips';

const EARLY: Lesson = { at: 20, keys: ['↑'], text: 'up' };
const LATE: Lesson = { at: 100, keys: ['B'], text: 'brake' };
const COURSE = [EARLY, LATE];

describe('handing out the flying lessons', () => {
  it('says nothing until the flight has gone far enough', () => {
    // Distance rather than time, because distance is the only measure of the
    // flight that is also a measure of the player: somebody still working out
    // which way is up has not covered twenty metres.
    const tutor = createTutor(COURSE, 7);
    expect(tutor.update(0, 1 / 60)).toBeNull();
    expect(tutor.update(19.9, 1 / 60)).toBeNull();
    expect(tutor.update(20, 1 / 60)?.text).toBe('up');
  });

  it('gives one at a time, in the order the flight reaches them', () => {
    // Starting a flight already past both thresholds -- which a respawn into
    // the middle of one would -- must not stack two tips into one corner.
    const tutor = createTutor(COURSE, 7, 1.5);
    expect(tutor.update(500, 1 / 60)?.text).toBe('up');
    expect(tutor.update(500, 1)?.text).toBe('up');

    // And the corner empties between them. Two instructions that never share
    // the screen but never leave it either read as one instruction changing
    // its mind.
    expect(tutor.update(500, 7)).toBeNull();
    expect(tutor.update(500, 1)).toBeNull();
    expect(tutor.update(500, 1)?.text).toBe('brake');
  });

  it('takes a lesson away once it has been up long enough', () => {
    const tutor = createTutor([EARLY], 7, 1.5);
    expect(tutor.update(20, 1 / 60)).not.toBeNull();
    expect(tutor.update(21, 6)).not.toBeNull();
    // Seven seconds of showing, then the corner is empty again.
    expect(tutor.update(22, 1)).toBeNull();
  });

  it('never gives the same lesson twice in one flight', () => {
    const tutor = createTutor([EARLY], 7, 1.5);
    expect(tutor.update(20, 1 / 60)).not.toBeNull();
    tutor.update(30, 8);
    tutor.update(30, 2);
    for (const travelled of [40, 200, 900]) {
      expect(tutor.update(travelled, 1 / 60), `${travelled} m`).toBeNull();
    }
  });

  it('gives them all again to a flight that starts over', () => {
    // The player who has just flown into a building is the one who most wants
    // to be told again, and the one who never crashes never sees a repeat.
    const tutor = createTutor([EARLY], 7, 1.5);
    expect(tutor.update(20, 1 / 60)).not.toBeNull();
    tutor.update(30, 8);
    tutor.update(30, 2);
    expect(tutor.update(40, 1 / 60)).toBeNull();

    tutor.reset();
    // And not straight away: the new flight has to earn it over again.
    expect(tutor.update(0, 1 / 60)).toBeNull();
    expect(tutor.update(20, 1 / 60)?.text).toBe('up');
  });

  it('goes away when the player uses the key it is about', () => {
    // A lesson somebody is already following is a lesson they do not need on
    // screen -- and pressing the key is the shortest way to find out that it
    // worked.
    const tutor = createTutor([EARLY], 7, 1.5);
    const nothing = () => false;
    expect(tutor.update(20, 1 / 60, nothing)?.text).toBe('up');
    expect(tutor.update(21, 1 / 60, (codes) => codes.includes('ArrowUp'))).toBeNull();
    // And stays away: it has been given, key or no key.
    expect(tutor.update(22, 2, nothing)).toBeNull();
    expect(tutor.update(23, 1 / 60, nothing)).toBeNull();
  });

  it('knows which keys on the keyboard each drawn key stands for', () => {
    // The arrows are drawn as arrows and the same control is also on WASD, so
    // one label answers to two codes -- and a label with no codes at all is a
    // tip that can never be dismissed by doing what it says.
    for (const lesson of LESSONS) {
      const codes = codesFor(lesson);
      expect(codes.length, lesson.text).toBeGreaterThanOrEqual(lesson.keys.length);
    }
    expect(codesFor({ keys: ['↑', '↓'], text: '' })).toContain('KeyW');
    expect(codesFor({ keys: ['SPACE'], text: '' })).toEqual(['Space']);
  });

  it('asks for one turn at a time, in the order they are written', () => {
    // The real course rather than the fixture. Nothing about the flight
    // demands a turn -- the target is straight ahead -- which is why it is a
    // good moment to be asked to try one.
    const order = LESSONS.map((lesson) => lesson.at);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    for (const lesson of LESSONS) {
      // Short enough to read while flying, and useless without its keys.
      expect(lesson.text.length, lesson.text).toBeLessThan(30);
      expect(lesson.keys.length, lesson.text).toBeGreaterThan(0);
      expect(codesFor(lesson).length, lesson.text).toBeGreaterThan(0);
    }
  });
});

describe('the instructions that watch the flight', () => {
  /** A bird that is fine: high, fast, fresh and flying. */
  const fine = { altitude: 120, airspeed: 16, stamina: 1, stalled: false };

  it('says nothing to a flight that is going well', () => {
    expect(warningFor(true, fine)).toBeNull();
  });

  it('calls out slow, low and tired, each on its own', () => {
    expect(warningFor(true, { ...fine, airspeed: 5 })?.text).toBe('Keep flapping!');
    expect(warningFor(true, { ...fine, altitude: 19 })?.text).toBe('Pull up!');
    expect(warningFor(true, { ...fine, stamina: 0.29 })?.text).toBe('Slow down!');
  });

  it('puts the wings before the nose when the bird is low and slow', () => {
    // The one ordering that matters. Low and slow looks like a case for
    // pulling up, and pulling up with no speed is how a bird stalls into the
    // ground it was trying to clear -- so the answer is the wings, which are
    // the only control that makes more of both.
    expect(warningFor(true, { ...fine, altitude: 5, airspeed: 4 })?.text).toBe('Keep flapping!');
  });

  it('leaves the slow problem until the quick ones are over', () => {
    // Tired is the only one of the three you can put off, so it is the only
    // one that gives way. A bird about to hit the ground has a bigger problem
    // than the one it will have in thirty seconds.
    const spent = { ...fine, altitude: 5, stamina: 0.1 };
    expect(warningFor(true, spent)?.text).toBe('Pull up!');
  });

  it('keeps the stall for everyone and the lessons for the taught', () => {
    // A pigeon spends half its life low, slow and tired on purpose, so those
    // three stop once the game stops teaching. Nobody stalls on purpose.
    const stalled = { ...fine, stalled: true };
    const struggling = { ...fine, altitude: 5, airspeed: 4, stamina: 0.1 };
    expect(warningFor(false, stalled)?.text).toBe('Nose down!');
    expect(warningFor(false, struggling)).toBeNull();
    expect(warningFor(true, struggling)).not.toBeNull();
  });

  it('puts the stall before everything, because it is already happening', () => {
    // The others are about to be a problem. A stall is one: the wing has
    // stopped working, and nothing else is worth trying until it works again.
    expect(warningFor(true, { altitude: 5, airspeed: 4, stamina: 0.1, stalled: true })?.text).toBe(
      'Nose down!',
    );
  });

  it('draws every one of them with a key that does something', () => {
    for (const warning of WARNINGS) {
      expect(warning.text.length, warning.text).toBeLessThan(30);
      expect(codesFor(warning).length, warning.text).toBeGreaterThan(0);
    }
  });

  it('takes its thresholds in the simulation\'s own units', () => {
    // Twenty km/h is the readout; 5.6 m/s is the air. A threshold written in
    // km/h would be a threshold about the display rather than about flying,
    // and the display is the thing most likely to change.
    expect(warningFor(true, { ...fine, airspeed: 20 / 3.6 - 0.01 })?.text).toBe('Keep flapping!');
    expect(warningFor(true, { ...fine, airspeed: 20 / 3.6 + 0.01 })).toBeNull();
  });
});
