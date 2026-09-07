import { describe, expect, it } from 'vitest';
import { createFlyover, type Framing } from './cutscene';

/** The shape of the real one: nine hundred metres east, both ends near the ground. */
const AT_THE_FOOD: Framing = {
  eye: { x: -675, y: 2, z: 541 },
  look: { x: -673, y: 0.4, z: 541 },
};
const AT_THE_NEST: Framing = {
  eye: { x: 238, y: 18.6, z: 552 },
  look: { x: 239, y: 18.2, z: 553 },
};

/** Play it out at sixty frames a second, and say where the camera went. */
function play(seconds = 5, arc = 60) {
  const shot = createFlyover(AT_THE_FOOD, AT_THE_NEST, { seconds, arc });
  const path: { x: number; y: number; z: number }[] = [];
  let frames = 0;
  while (shot.update(1 / 60) && frames < 60 * 60) {
    path.push({ ...shot.framing.eye });
    frames += 1;
  }
  return { shot, path, seconds: frames / 60 };
}

describe('the camera going home by itself', () => {
  it('ends on the closing shot, exactly', () => {
    // The whole job. What the player is left looking at is the opening shot
    // of the first level with nobody in it, and "nearly" would be a camera
    // that has to slide into place once it has got there.
    const { shot } = play();
    expect(shot.framing.eye).toEqual(AT_THE_NEST.eye);
    expect(shot.framing.look).toEqual(AT_THE_NEST.look);
    expect(shot.playing).toBe(false);
  });

  it('starts from where the camera already was, without a jump', () => {
    // It is a move, not a cut: the first frame of it has to be the frame the
    // player was already looking at, or the journey begins by teleporting.
    const shot = createFlyover(AT_THE_FOOD, AT_THE_NEST, { seconds: 5, arc: 60 });
    expect(shot.framing.eye).toEqual(AT_THE_FOOD.eye);

    shot.update(1 / 60);
    const moved = Math.hypot(
      shot.framing.eye.x - AT_THE_FOOD.eye.x,
      shot.framing.eye.y - AT_THE_FOOD.eye.y,
      shot.framing.eye.z - AT_THE_FOOD.eye.z,
    );
    // Eased in, so the first sixtieth of a second is centimetres rather than
    // the three metres a constant speed would cover.
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(1);
  });

  it('turns to face where it is going before it sets off', () => {
    // "The camera turns towards the home tree and quickly flies there", in
    // that order. Moved together, the aim spends the first half of the
    // crossing pointed back at the concrete, and the shot is a camera sixty
    // metres up looking backwards at treetops.
    const shot = createFlyover(AT_THE_FOOD, AT_THE_NEST, { seconds: 5, arc: 60 });
    for (let f = 0; f < 60; f += 1) shot.update(1 / 60);
    expect(shot.progress).toBeCloseTo(0.2, 2);

    const wholeWay = AT_THE_NEST.look.x - AT_THE_FOOD.look.x;
    const aimed = (shot.framing.look.x - AT_THE_FOOD.look.x) / wholeWay;
    const gone = (shot.framing.eye.x - AT_THE_FOOD.eye.x) / (AT_THE_NEST.eye.x - AT_THE_FOOD.eye.x);
    // Looking most of the way home, having travelled almost none of it.
    expect(aimed).toBeGreaterThan(0.8);
    expect(gone).toBeLessThan(0.15);
  });

  it('goes over the city rather than through it', () => {
    // Both ends are near the ground and there is nine hundred metres of
    // Budapest in between. A straight line would be a camera through the
    // eighth district.
    const { path } = play(5, 60);
    const highest = Math.max(...path.map((at) => at.y));
    expect(highest).toBeGreaterThan(50);

    // And the arc is over the middle rather than at one end: halfway along,
    // the camera is near the top of it.
    const middle = path[Math.floor(path.length / 2)]!;
    expect(middle.y).toBeGreaterThan(highest * 0.9);
  });

  it('leaves and arrives gently, rather than at one speed throughout', () => {
    // A camera that starts at full speed reads as a cut followed by a slide.
    // Measured off the path: the middle of the move covers far more ground
    // per frame than either end of it.
    const { path } = play();
    const step = (i: number) =>
      Math.hypot(path[i + 1]!.x - path[i]!.x, path[i + 1]!.z - path[i]!.z);
    const middle = step(Math.floor(path.length / 2));
    expect(step(0)).toBeLessThan(middle / 4);
    expect(step(path.length - 2)).toBeLessThan(middle / 4);
  });

  it('takes the time it was given', () => {
    // Which is the one thing the player actually experiences about it.
    expect(play(5).seconds).toBeGreaterThan(4.9);
    expect(play(5).seconds).toBeLessThan(5.2);
    expect(play(2).seconds).toBeLessThan(2.2);
  });

  it('arrives when it is cut short, rather than stopping where it was', () => {
    // Somebody who skips a journey wants to be at the other end of it. A cut
    // that stopped the camera halfway across the park would leave the player
    // hanging over the eighth district looking at nothing.
    const shot = createFlyover(AT_THE_FOOD, AT_THE_NEST, { seconds: 5, arc: 60 });
    for (let f = 0; f < 60; f += 1) shot.update(1 / 60);
    expect(shot.playing).toBe(true);

    shot.cut();
    expect(shot.playing).toBe(false);
    expect(shot.framing.eye).toEqual(AT_THE_NEST.eye);
    expect(shot.update(1 / 60)).toBe(false);
  });
});
