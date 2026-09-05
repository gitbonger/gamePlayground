import { describe, expect, it } from 'vitest';
import { defaultWatchParams, twoShot, type WatchParams } from './camera';
import { vec } from '../sim/math3';

const p: WatchParams = defaultWatchParams;

/** Half the angle the camera can see across, in radians. */
const halfFov = (params: WatchParams) => (params.fov / 2) * (Math.PI / 180);

/** Angle from the camera's aim to a point, in radians. */
function offAxis(from: ReturnType<typeof vec>, aim: ReturnType<typeof vec>, at: ReturnType<typeof vec>) {
  const ax = aim.x - from.x;
  const ay = aim.y - from.y;
  const az = aim.z - from.z;
  const bx = at.x - from.x;
  const by = at.y - from.y;
  const bz = at.z - from.z;
  const dot = ax * bx + ay * by + az * bz;
  const lengths = Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz);
  return Math.acos(Math.min(1, Math.max(-1, dot / lengths)));
}

describe('framing two birds together', () => {
  it('holds both of them in shot, with air to spare', () => {
    // The whole job. Stated as the angle each subtends from the camera's own
    // aim, which is what "in shot" means, rather than as a distance -- and
    // with room left over, because framing a pair exactly to the edges of the
    // picture is what the margin exists to avoid. Without it every one of
    // these sits at precisely the edge.
    for (const apart of [0.2, 1, 2, 5, 12]) {
      const a = vec(0, 1.5, 0);
      const b = vec(apart, 1.5, 0);
      const shot = twoShot(a, b, vec(0, 1.5, -10), p);

      for (const [who, at] of [['first', a], ['second', b]] as const) {
        const off = offAxis(shot.position, shot.target, at);
        expect(off / halfFov(p), `${who}, ${apart} m apart`).toBeLessThan(0.9);
      }
    }
  });

  it('aims between them rather than at either one', () => {
    const shot = twoShot(vec(0, 1.5, 0), vec(2, 1.5, 0), vec(0, 1.5, -10), p);
    expect(shot.target.x).toBeCloseTo(1, 9);
    expect(shot.target.z).toBeCloseTo(0, 9);
    expect(shot.target.y).toBeCloseTo(1.5, 9);
  });

  it('stands to one side of them, not behind either', () => {
    // A two-shot taken over one bird's shoulder is a shot of the back of a
    // pigeon. Across the line between them means the camera is about as far
    // from one as from the other.
    const a = vec(0, 1.5, 0);
    const b = vec(2, 1.5, 0);
    const shot = twoShot(a, b, vec(1, 1.5, -10), p);

    const toA = Math.hypot(shot.position.x - a.x, shot.position.z - a.z);
    const toB = Math.hypot(shot.position.x - b.x, shot.position.z - b.z);
    expect(Math.abs(toA - toB)).toBeLessThan(0.01);
  });

  it('takes the side it is already on', () => {
    // Walking round somebody must not send the camera sweeping through them.
    const a = vec(0, 1.5, 0);
    const b = vec(2, 1.5, 0);

    const north = twoShot(a, b, vec(1, 1.5, -10), p);
    const south = twoShot(a, b, vec(1, 1.5, 10), p);

    expect(north.position.z).toBeLessThan(0);
    expect(south.position.z).toBeGreaterThan(0);
  });

  it('backs off further the further apart they are', () => {
    const from = vec(0, 1.5, -10);
    const near = twoShot(vec(0, 1.5, 0), vec(0.5, 1.5, 0), from, p);
    const far = twoShot(vec(0, 1.5, 0), vec(8, 1.5, 0), from, p);

    const back = (shot: typeof near, mid: number) =>
      Math.hypot(shot.position.x - mid, shot.position.z);
    expect(back(far, 4)).toBeGreaterThan(back(near, 0.25) * 2);
  });

  it('never crowds them, however close together they get', () => {
    // Two birds in the same place still need the camera some way off. The
    // margin is what provides that -- there is no separate minimum -- so the
    // floor is the stand-off the margin alone buys, about three metres.
    const floor = p.margin / Math.tan(halfFov(p));
    expect(floor).toBeGreaterThan(2.5);

    const from = vec(0, 1.5, -10);
    for (const apart of [0, 0.01, 0.2]) {
      const shot = twoShot(vec(0, 1.5, 0), vec(apart, 1.5, 0), from, p);
      const back = Math.hypot(shot.position.x - apart / 2, shot.position.z);
      expect(back, `${apart} m apart`).toBeGreaterThanOrEqual(floor - 1e-9);
    }
  });

  it('stands a little above them', () => {
    const shot = twoShot(vec(0, 1.5, 0), vec(2, 1.5, 0), vec(1, 1.5, -10), p);
    expect(shot.position.y).toBeCloseTo(1.5 + p.height, 9);
  });

  it('does not fall over when they are in exactly the same place', () => {
    // Which is not a place two pigeons can be, but is a place the arithmetic
    // can be asked about while one of them is being moved onto the other.
    const same = vec(3, 1.5, 4);
    const shot = twoShot(same, same, vec(3, 1.5, -6), p);

    for (const value of [shot.position.x, shot.position.y, shot.position.z]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(shot.target).toEqual(same);
    // And on the side the camera was already on.
    expect(shot.position.z).toBeLessThan(same.z);
  });

  it('does not fall over when the camera is on top of them either', () => {
    const same = vec(0, 1.5, 0);
    const shot = twoShot(same, same, same, p);
    for (const value of [shot.position.x, shot.position.y, shot.position.z]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});
