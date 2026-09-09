import { describe, expect, it } from 'vitest';
import { createWaymarks, REACHED } from './waypoints';
import { lineThrough } from './levels';

const route = [
  { x: 0, z: 0 },
  { x: 100, z: 0 },
  { x: 100, z: 100 },
];

describe('the marks along a route', () => {
  it('shows the first one and nothing else', () => {
    // One at a time. A route drawn all at once is a map, and reading a map is
    // a different activity from flying.
    const marks = createWaymarks(route);
    expect(marks.at).toEqual(route[0]);
    expect(marks.left).toBe(3);
  });

  it('gives way to the next when the bird gets there', () => {
    const marks = createWaymarks(route);
    expect(marks.update(0, REACHED - 0.1)).toBe(true);
    expect(marks.at).toEqual(route[1]);
    expect(marks.left).toBe(2);
  });

  it('stays put until the bird is near enough', () => {
    const marks = createWaymarks(route);
    expect(marks.update(0, REACHED + 0.1)).toBe(false);
    expect(marks.at).toEqual(route[0]);
  });

  it('takes no notice of how high the bird is', () => {
    // Height is the player's own business on these levels -- one wants them
    // under twenty metres and the next over the roofs -- so a mark that had
    // to be flown through at a particular altitude would be arguing with the
    // level it is helping with.
    //
    // Which is why this takes two numbers and not three: there is no altitude
    // to pass in, and that is the claim.
    const marks = createWaymarks(route);
    marks.update(0, 0);
    expect(marks.at).toEqual(route[1]);
  });

  it('offers the one after, for the arrow to point at', () => {
    // A mark says two things: here, and then that way. A player who only
    // learns the next heading on arriving turns late every time.
    const marks = createWaymarks(route);
    expect(marks.next).toEqual(route[1]);

    marks.update(0, 0);
    expect(marks.at).toEqual(route[1]);
    expect(marks.next).toEqual(route[2]);

    // And nothing after the last one, so the arrow comes off rather than
    // pointing somewhere arbitrary.
    marks.update(100, 0);
    expect(marks.at).toEqual(route[2]);
    expect(marks.next).toBeNull();
  });

  it('catches a bird that flies near a mark rather than through it', () => {
    // The number matters, and this is what it is for: a mark you have to hit
    // exactly is not help, it is a second game. Flown past at cruise with
    // fifteen metres to spare -- which is what aiming at a column from four
    // hundred metres out with a crow behind you gets you -- it counts.
    //
    // Sampled at the tick rate, which is the other half of it: at nineteen
    // metres a second the bird moves sixteen centimetres between looks, so a
    // catch of a few metres is only ever a few metres wide in practice.
    const marks = createWaymarks([{ x: 0, z: 0 }]);
    let caught = false;
    for (let t = 0; t < 60 / 19 / (1 / 120); t += 1) {
      const along = -30 + (t / 120) * 19;
      caught ||= marks.update(along, 15);
    }
    expect(caught).toBe(true);

    // And it is a catch rather than a corridor: well wide of it is a miss,
    // or the marks would count themselves from anywhere on the level.
    const missed = createWaymarks([{ x: 0, z: 0 }]);
    let wrongly = false;
    for (let t = 0; t < 60 / 19 / (1 / 120); t += 1) {
      const along = -30 + (t / 120) * 19;
      wrongly ||= missed.update(along, 35);
    }
    expect(wrongly).toBe(false);
  });

  it('runs out, and then nothing happens', () => {
    // Passing the last one is not an event. They are help, and help that
    // congratulated you would be pretending to be a level.
    const marks = createWaymarks(route);
    marks.update(0, 0);
    marks.update(100, 0);
    expect(marks.update(100, 100)).toBe(true);
    expect(marks.at).toBeNull();
    expect(marks.left).toBe(0);

    // And it stays run out, wherever the bird goes afterwards.
    expect(marks.update(0, 0)).toBe(false);
    expect(marks.at).toBeNull();
  });

  it('skips none of them, however fast the bird is going', () => {
    // A tick at a pigeon's speed is sixteen centimetres, so this needs marks
    // stacked on each other to happen at all -- but a rule that quietly left
    // one behind would strand the player on a mark they had flown through.
    const stacked = createWaymarks([
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 2, z: 0 },
      { x: 60, z: 0 },
    ]);
    expect(stacked.update(1, 0)).toBe(true);
    expect(stacked.at).toEqual({ x: 60, z: 0 });
    expect(stacked.left).toBe(1);
  });

  it('has nothing to show for a level with no marks at all', () => {
    const none = createWaymarks([]);
    expect(none.at).toBeNull();
    expect(none.left).toBe(0);
    expect(none.update(0, 0)).toBe(false);
  });
});

describe('a mark that is a line rather than a place', () => {
  /** The release point every line here is drawn square to. */
  const from = { x: 0, z: 0 };
  /** Two stripes across a route running east, at 100 m and 200 m. */
  const lines = [
    { x: 100, z: 0, across: lineThrough(from, { x: 100, z: 0 }) },
    { x: 200, z: 0, across: lineThrough(from, { x: 200, z: 0 }) },
  ];

  it('is passed by crossing it, however wide of it you are', () => {
    // The whole reason for having one. A column is twenty metres across and
    // a first-time player flies past it without ever knowing it was there;
    // a line runs the width of the map, so any path to the far side crosses
    // it.
    const marks = createWaymarks(lines);
    expect(marks.update(101, 400)).toBe(true);
    expect(marks.at).toEqual(lines[1]);
  });

  it('is not passed by being near it', () => {
    // Which is the difference from a place, stated: standing twenty metres
    // short of a line is standing short of it.
    const marks = createWaymarks(lines);
    expect(marks.update(99, 0)).toBe(false);
    expect(marks.at).toEqual(lines[0]);
  });

  it('is passed at the moment it is reached, not before', () => {
    const marks = createWaymarks(lines);
    expect(marks.update(99.9, 0)).toBe(false);
    expect(marks.update(100.1, 0)).toBe(true);
  });

  it('takes them in order, and all of them at once if it has to', () => {
    // A bird that somehow got past both is not left steering at the first.
    const marks = createWaymarks(lines);
    expect(marks.update(300, 0)).toBe(true);
    expect(marks.at).toBeNull();
    expect(marks.index).toBe(2);
  });

  it('says which one is showing, so the right stripe can be painted', () => {
    const marks = createWaymarks(lines);
    expect(marks.index).toBe(0);
    marks.update(150, 0);
    expect(marks.index).toBe(1);
  });

  it('mixes with places in one route', () => {
    // Both are a coordinate; what differs is the question asked of the bird.
    const mixed = createWaymarks([{ x: 50, z: 0 }, lines[1]!]);
    expect(mixed.update(50, 0)).toBe(true);
    expect(mixed.at).toEqual(lines[1]);
    expect(mixed.update(201, 900)).toBe(true);
    expect(mixed.at).toBeNull();
  });
});
