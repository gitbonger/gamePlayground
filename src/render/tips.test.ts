import { describe, expect, it } from 'vitest';
import { createTutor, LESSONS, type Lesson } from './tips';

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

  it('teaches staying up before anything else, and teaches it at once', () => {
    // The real course rather than the fixture. Five metres off a branch is
    // where a bird that does not flap finds out, so it is the first thing
    // said and it is said almost immediately.
    const first = LESSONS[0]!;
    expect(first.at).toBeLessThanOrEqual(5);
    expect(first.keys).toEqual(['SPACE']);

    // In order, so the queue hands them out in the order they were written
    // rather than in whatever order the distances happen to fall.
    const order = LESSONS.map((lesson) => lesson.at);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    for (const lesson of LESSONS) {
      // Short enough to read while flying, and useless without its keys.
      expect(lesson.text.length, lesson.text).toBeLessThan(30);
      expect(lesson.keys.length, lesson.text).toBeGreaterThan(0);
    }
  });
});
