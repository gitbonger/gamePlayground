import { describe, expect, it } from 'vitest';
import { createAlarm, type Tone } from './alarm';

/** A stand-in for the audio card. */
const heard = () => {
  const played: { tones: readonly number[]; blip: number }[] = [];
  const tone: Tone = {
    play: (tones, blip) => played.push({ tones, blip }),
    close: () => {},
  };
  return { tone, played };
};

describe('the two-tone warning', () => {
  it('sounds when there is something to warn about', () => {
    const { tone, played } = heard();
    createAlarm(tone).sound(0);
    expect(played).toHaveLength(1);
    // Two tones, not one: one tone is a noise and two are a warning.
    expect(played[0]!.tones).toHaveLength(2);
  });

  it('does not become a siren', () => {
    // The thing it is about goes on being true for as long as a crow is
    // following, which is twenty seconds. Sounded every frame that is twelve
    // hundred beeps, and a warning nobody can bear is one that gets muted --
    // and then it is not there for the one that mattered.
    const { tone, played } = heard();
    const alarm = createAlarm(tone, 2.5);
    for (let frame = 0; frame < 20 * 60; frame += 1) alarm.sound(frame / 60);
    expect(played).toHaveLength(8);
  });

  it('goes by the world’s clock rather than the wall’s', () => {
    // Given the clock rather than reading one, so a game held on a beat does
    // not tick the warning along behind the scenes and then let off four of
    // them the moment it starts again.
    const { tone, played } = heard();
    const alarm = createAlarm(tone, 2.5);
    alarm.sound(0);
    alarm.sound(0);
    alarm.sound(0);
    expect(played).toHaveLength(1);
  });
});
