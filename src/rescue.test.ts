import { describe, expect, it } from 'vitest';
import { beginRescue, BREAKS_AFTER } from './rescue';
import { defaultParams } from './sim/flight';
import { isPerched } from './sim/flight';

const DT = 1 / 120;

/** Thirty of them behind a bird facing north, with the cage in front. */
const staged = (many = 30) =>
  beginRescue({
    terrace: { x: 0, z: -6, width: 40, depth: 20, yaw: 0 },
    cage: { x: 0, z: -6 },
    ground: defaultParams.groundHeight + defaultParams.bodyRadius,
    many,
    morphs: 4,
    flight: defaultParams,
    random: (() => {
      let seed = 7;
      return () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
    })(),
  });

const run = (rescue: ReturnType<typeof beginRescue>, seconds: number) => {
  for (let t = 0; t < seconds; t += DT) rescue.update(DT);
};

describe('the thirty who came to help', () => {
  it('arrives on its feet rather than landing', () => {
    // The cheat, and the reason for it: the last level is a hundred and
    // fifty-five metres long and a flock lets one bird out at a time, so by
    // the time the hero is on the roof there are four of them in the sky.
    // What arrives is not a flock. These are simply there.
    const rescue = staged();
    expect(rescue.helpers).toHaveLength(30);
    for (const helper of rescue.helpers) {
      expect(isPerched(helper.state), 'standing').toBe(true);
    }
  });

  it('appears all over the roof rather than round the cage', () => {
    // They have to be seen to *come*. Thirty birds already standing round the
    // cage is thirty birds who were always there, and the walk up to it is
    // the piece of the story this whole cheat exists to buy.
    const rescue = staged();
    for (const helper of rescue.helpers) {
      const gap = Math.hypot(helper.state.position.x - 0, helper.state.position.z - -6);
      expect(gap, 'not on top of it').toBeGreaterThan(4.5);
    }

    // And spread over the terrace rather than in one corner of it: the
    // furthest of them is most of the way to the far end.
    const out = rescue.helpers.map((helper) => Math.abs(helper.state.position.x - 0));
    expect(Math.max(...out), 'the far corners').toBeGreaterThan(14);
  });

  it('walks them to the cage', () => {
    // The beat: thirty birds converging on one thing.
    const rescue = staged();
    const before = rescue.helpers.map((helper) =>
      Math.hypot(helper.state.position.x - 0, helper.state.position.z - -6),
    );
    run(rescue, BREAKS_AFTER);
    const after = rescue.helpers.map((helper) =>
      Math.hypot(helper.state.position.x - 0, helper.state.position.z - -6),
    );

    const closer = after.filter((gap, i) => gap < before[i]! - 0.5).length;
    expect(closer, 'most of them set off for it').toBeGreaterThan(20);
  });

  it('stops them at it rather than pushing into it', () => {
    // A bird that kept walking would shuffle against the bars, which reads as
    // being stuck rather than as being there.
    const rescue = staged();
    run(rescue, 30);
    for (const helper of rescue.helpers) {
      const gap = Math.hypot(helper.state.position.x - 0, helper.state.position.z - -6);
      expect(gap, 'not inside the cage').toBeGreaterThan(0.4);
    }
  });

  it('breaks the cage after five seconds, and not before', () => {
    // Long enough for the nearest of them to have reached it and the furthest
    // to still be coming, which is what makes it read as thirty birds doing
    // something rather than as a timer running out.
    const rescue = staged();
    run(rescue, BREAKS_AFTER - 0.5);
    expect(rescue.broken, 'still standing').toBe(false);
    run(rescue, 1);
    expect(rescue.broken, 'and then not').toBe(true);
  });

  it('faces them at the thing they came for', () => {
    // Thirty birds standing round a cage looking at the sky is thirty birds
    // that do not know why they are there.
    const rescue = staged();
    run(rescue, BREAKS_AFTER);
    const looking = rescue.helpers.filter((helper) => {
      const want = Math.atan2(0 - helper.state.position.x, -(-6 - helper.state.position.z));
      const facing = Math.atan2(
        2 * (helper.state.orientation.w * helper.state.orientation.y),
        1 - 2 * helper.state.orientation.y * helper.state.orientation.y,
      );
      let off = Math.abs(((want + facing + Math.PI) % (Math.PI * 2)) - Math.PI);
      if (off > Math.PI) off = Math.PI * 2 - off;
      return off < 0.9;
    }).length;
    expect(looking, 'most of them are looking at it').toBeGreaterThan(15);
  });
});
