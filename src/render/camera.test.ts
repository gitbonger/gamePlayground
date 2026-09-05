import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createChaseCamera,
  defaultCameraParams,
  defaultWatchParams,
  twoShot,
  type WatchParams,
} from './camera';
import { createBird } from '../sim/flight';
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


describe('holding the two-shot on a pair that is moving', () => {
  const DT = 1 / 60;

  /**
   * Run the shot on two birds a metre apart travelling at `speed`, and report
   * where each lands across the frame, -1 to 1.
   *
   * They stand side by side *along* the way they are going, which is how two
   * pigeons stand on a wagon and, more to the point, is the arrangement that
   * puts their travel across the picture rather than into it. Set up the
   * other way round -- separated across the direction of travel -- a lagging
   * aim shows up as the wrong stand-off and not as bad framing at all, which
   * is how the first version of this test managed to pass while the shot was
   * visibly broken.
   */
  function framed(speed: number, seconds = 6) {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.35, 12000);
    const chase = createChaseCamera(camera);

    let along = 0;
    let a = vec(0, 1.5, 0);
    let b = vec(1, 1.5, 0);
    for (let t = 0; t < seconds; t += DT) {
      along += speed * DT;
      a = vec(along, 1.5, 0);
      b = vec(along + 1, 1.5, 0);
      chase.watch(a, b, defaultWatchParams, DT);
    }

    camera.updateMatrixWorld(true);
    const across = (at: typeof a) =>
      new THREE.Vector3(at.x, at.y, at.z).project(camera).x;
    return { a: across(a), b: across(b), camera, along };
  }

  it('aims at the middle of them, whatever they are riding', () => {
    // A wagon does 6 m/s. An eased aim trails a subject moving that fast by
    // about three metres, which from a stand-off of four puts both birds hard
    // against one edge of the picture and leaves them there -- which is what
    // this looked like on the train.
    for (const speed of [0, 3, 6, 12]) {
      const shot = framed(speed);
      const middle = (shot.a + shot.b) / 2;
      expect(Math.abs(middle), `${speed} m/s`).toBeLessThan(0.06);
    }
  });

  it('keeps both of them well inside the frame while they travel', () => {
    for (const speed of [0, 6, 12]) {
      const shot = framed(speed);
      expect(Math.abs(shot.a), `${speed} m/s, first`).toBeLessThan(0.6);
      expect(Math.abs(shot.b), `${speed} m/s, second`).toBeLessThan(0.6);
    }
  });

  it('does not fling the camera when the shot is re-entered somewhere else', () => {
    // Walk away, fly half a kilometre, land and meet somebody else. The
    // distance the pair moved between the two conversations is not a distance
    // the camera should be carried by, so leaving the shot has to forget it.
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.35, 12000);
    const chase = createChaseCamera(camera);

    const here = [vec(0, 1.5, 0), vec(1, 1.5, 0)] as const;
    for (let t = 0; t < 3; t += DT) chase.watch(here[0], here[1], defaultWatchParams, DT);

    // Away, on the boom, and flown over to the far pair -- so by the time the
    // second conversation starts the camera is already right beside it. That
    // is the arrangement that matters: carrying it by how far the *pair*
    // moved between conversations then throws it the same distance again.
    const flying = createBird(vec(500, 3, 500), 14, 0);
    for (let t = 0; t < 2; t += DT) chase.update(flying, defaultCameraParams, DT);
    expect(Math.hypot(camera.position.x - 500, camera.position.z - 500)).toBeLessThan(10);

    const there = [vec(500, 1.5, 500), vec(501, 1.5, 500)] as const;
    chase.watch(there[0], there[1], defaultWatchParams, DT);

    // Still beside them, rather than five hundred metres past.
    const away = Math.hypot(camera.position.x - 500.5, camera.position.z - 500);
    expect(away).toBeLessThan(20);
  });

  it('settles at the stand-off it asked for, moving or not', () => {
    const ideal = (1 / 2 + defaultWatchParams.margin) / Math.tan(halfFov(defaultWatchParams));
    for (const speed of [0, 6]) {
      const { camera, along } = framed(speed);
      // The pair is at x = along and along + 1, both at z = 0.
      const back = Math.hypot(camera.position.x - (along + 0.5), camera.position.z);
      expect(back, `${speed} m/s`).toBeCloseTo(ideal, 0);
    }
  });
});
