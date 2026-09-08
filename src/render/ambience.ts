/**
 * The city making its own noises.
 *
 * Only ever about something that is actually there. A bark comes from a dog
 * standing on a platform forty metres away, a bell from a tram that is
 * pulling out, a caw from a crow that is over you -- so the sound is
 * information as well as atmosphere, and a player who hears a dog and then
 * flies over a dog has learnt that this game's noises mean something.
 *
 * Synthesised rather than sampled, like the warning. Five short sounds are a
 * page of oscillator envelopes here and half a megabyte of downloads
 * otherwise, and nothing about them wants the fidelity: they are heard at
 * fifty metres, through wind, under a warning.
 *
 * The pacing is the whole design. A city with a sound in it every second is a
 * city nobody can fly over for ten minutes, so: one at a time, never within
 * `TOGETHER` of the last, each kind on its own long cooldown, and even then
 * only sometimes. What that buys is a district that is mostly quiet and
 * occasionally says something -- which is what a district sounds like.
 */

export type Noise = 'bark' | 'coo' | 'caw' | 'bell' | 'screech';

/** Something that can make a noise, and where it is. */
export interface Source {
  noise: Noise;
  x: number;
  z: number;
}

/**
 * What each noise is worth hearing from, how often, and how likely.
 *
 * `reach` is in metres and is a claim about the sound rather than about the
 * thing: a tram bell carries across a square and a pigeon does not. `apart`
 * is the fewest seconds between two of the same kind, and `chance` is how
 * often an opportunity is taken -- which is what keeps a flight down a street
 * full of dogs from being a kennel.
 */
const NOISES: Record<Noise, { reach: number; apart: number; chance: number }> = {
  bark: { reach: 70, apart: 6, chance: 0.5 },
  coo: { reach: 35, apart: 9, chance: 0.35 },
  caw: { reach: 90, apart: 5, chance: 0.6 },
  bell: { reach: 110, apart: 14, chance: 0.5 },
  screech: { reach: 140, apart: 18, chance: 0.45 },
};

/**
 * The fewest seconds between any two sounds at all, whatever kind.
 *
 * Four, and it is the number that actually decides how loud this is. The
 * cooldowns above stop one dog barking twice and the chances thin things out
 * where only one or two kinds are about -- but standing somewhere with a dog,
 * a pigeon, a crow, a tram and a train all in earshot, some kind is nearly
 * always off its cooldown, and then the only thing between the player and a
 * farmyard is this.
 *
 * Measured with all five next to him, which is as loud as the game ever gets:
 * one sound every four seconds. Over a park, with nothing but pigeons, it is
 * one every twenty-six.
 */
const TOGETHER = 4;

/**
 * Which kind gets first refusal when two are ready at once.
 *
 * Only a tie-break. They are offered longest-unheard first, and this settles
 * the case where nothing has been heard yet -- so the first sound of a level
 * with crows in it is a crow.
 *
 * A fixed order on its own does not work, and the numbers say why: tried
 * caw-first every time, two minutes on a street with all five in earshot came
 * out twelve caws and three coos, because the caw's cooldown is shorter than
 * the gap between sounds and it therefore won nearly every opportunity.
 */
const ORDER: readonly Noise[] = ['caw', 'screech', 'bell', 'bark', 'coo'];

export interface Ambience {
  /**
   * Offer whatever is nearby, and perhaps play one of them.
   *
   * `at` and `heading` are the listener -- the bird, not the camera, because
   * the bird is what the player is -- and `sources` is everything that could
   * make a noise, in world metres. Called every frame; it decides for itself
   * how rarely to do anything.
   */
  hear(
    now: number,
    at: { x: number; z: number },
    heading: number,
    sources: readonly Source[],
  ): void;
  dispose(): void;
}

/** Whatever actually makes the noise, so a test does not need an audio card. */
export interface Kit {
  /** `level` is 0 to 1 and `pan` is -1 hard left to 1 hard right. */
  play(noise: Noise, level: number, pan: number): void;
  close(): void;
}

export function createAmbience(kit: Kit, random: () => number = Math.random): Ambience {
  const last = new Map<Noise, number>();
  let lastAny = -Infinity;

  return {
    hear(now, at, heading, sources) {
      if (now - lastAny < TOGETHER) return;

      // Longest unheard first, so that a street with everything on it works
      // its way round rather than repeating whatever is at the top of a list.
      const turn = [...ORDER].sort((a, b) => {
        const waited = (noise: Noise) => now - (last.get(noise) ?? -Infinity);
        const gap = waited(b) - waited(a);
        return gap !== 0 && Number.isFinite(gap) ? gap : ORDER.indexOf(a) - ORDER.indexOf(b);
      });

      for (const noise of turn) {
        const rule = NOISES[noise];
        if (now - (last.get(noise) ?? -Infinity) < rule.apart) continue;

        // The nearest one of this kind, which is the one that would be heard.
        let nearest: { away: number; source: Source } | null = null;
        for (const source of sources) {
          if (source.noise !== noise) continue;
          const away = Math.hypot(source.x - at.x, source.z - at.z);
          if (away <= rule.reach && (!nearest || away < nearest.away)) nearest = { away, source };
        }
        if (!nearest) continue;
        // Rolled after the search rather than before, so a kind with nothing
        // near it does not spend its chance on nothing and go quiet.
        if (random() >= rule.chance) continue;

        // Falls off with the square of the distance, near enough: what that
        // gets right is that the far half of the reach is nearly silent,
        // which is why the reaches can be as generous as they are.
        const close = 1 - nearest.away / rule.reach;
        const level = Math.max(0.05, close * close);
        // Which side it is on. Facing nought is -Z, so the bird's right hand
        // is +X turned by its heading -- the same convention the minimap
        // turns the world with.
        const dx = nearest.source.x - at.x;
        const dz = nearest.source.z - at.z;
        const side = dx * Math.cos(heading) + dz * Math.sin(heading);
        const pan = nearest.away < 1 ? 0 : Math.max(-1, Math.min(1, side / nearest.away));

        kit.play(noise, level, pan);
        last.set(noise, now);
        lastAny = now;
        return;
      }
    },
    dispose() {
      kit.close();
    },
  };
}

/**
 * The browser's own, built on the first noise rather than at startup.
 *
 * Same reason as the warning: a context made before anybody has touched the
 * keyboard is a suspended one, and browsers count that against the page.
 */
export function browserKit(volume = 0.5): Kit {
  let ctx: AudioContext | null = null;
  let hiss: AudioBuffer | null = null;

  /** A second of white noise, made once. The raw material for three of these. */
  const noiseBuffer = (audio: AudioContext) => {
    if (hiss) return hiss;
    const made = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
    const data = made.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    hiss = made;
    return made;
  };

  return {
    play(noise, level, pan) {
      ctx ??= new AudioContext();
      void ctx.resume();
      const audio = ctx;
      const now = audio.currentTime;

      // Everything goes out through one pan and one gain, so a sound is
      // placed and levelled in one place rather than in five.
      const place = audio.createStereoPanner();
      place.pan.value = pan * 0.8;
      const out = audio.createGain();
      out.gain.value = level * volume;
      out.connect(place).connect(audio.destination);

      /** A tone with an envelope: attack, hold, and a decay to nothing. */
      const tone = (
        type: OscillatorType,
        from: number,
        to: number,
        at: number,
        length: number,
        loud = 1,
      ) => {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(from, now + at);
        if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, now + at + length);
        gain.gain.setValueAtTime(0, now + at);
        gain.gain.linearRampToValueAtTime(loud, now + at + Math.min(0.02, length / 4));
        gain.gain.exponentialRampToValueAtTime(0.0001, now + at + length);
        osc.connect(gain).connect(out);
        osc.start(now + at);
        osc.stop(now + at + length + 0.02);
      };

      /** A burst of filtered noise: wheels, and the rasp in a bark or a caw. */
      const rasp = (
        at: number,
        length: number,
        from: number,
        to: number,
        q: number,
        loud = 1,
      ) => {
        const source = audio.createBufferSource();
        source.buffer = noiseBuffer(audio);
        source.loop = true;
        const band = audio.createBiquadFilter();
        band.type = 'bandpass';
        band.Q.value = q;
        band.frequency.setValueAtTime(from, now + at);
        if (to !== from) band.frequency.exponentialRampToValueAtTime(to, now + at + length);
        const gain = audio.createGain();
        gain.gain.setValueAtTime(0, now + at);
        gain.gain.linearRampToValueAtTime(loud, now + at + Math.min(0.03, length / 4));
        gain.gain.exponentialRampToValueAtTime(0.0001, now + at + length);
        source.connect(band).connect(gain).connect(out);
        source.start(now + at);
        source.stop(now + at + length + 0.02);
      };

      switch (noise) {
        case 'bark':
          // Two of them, because one bark is a cough. A low body and a rasp
          // over it, both falling: the fall is what makes it a bark rather
          // than a beep.
          for (const at of [0, 0.22]) {
            tone('sawtooth', 320, 150, at, 0.13, 0.5);
            rasp(at, 0.11, 1400, 700, 1.2, 0.35);
          }
          break;
        case 'coo':
          // Two notes, the second longer and bent: coo-cooo. Soft, and low
          // enough to sit under everything else.
          tone('sine', 460, 430, 0, 0.16, 0.32);
          tone('sine', 470, 380, 0.22, 0.34, 0.32);
          break;
        case 'caw':
          // Harsh and falling, with the rasp louder than the tone. Nothing
          // else in this set is meant to be unpleasant.
          tone('sawtooth', 780, 380, 0, 0.24, 0.34);
          rasp(0, 0.26, 2200, 900, 0.9, 0.42);
          break;
        case 'bell':
          // A struck bell: a bright partial over a fundamental, both ringing
          // down. Sine, because a bell is nearly one.
          tone('sine', 1568, 1568, 0, 1.1, 0.3);
          tone('sine', 2349, 2349, 0, 0.55, 0.16);
          tone('sine', 3136, 3136, 0, 0.25, 0.08);
          break;
        case 'screech':
          // Steel on steel round a curve: a narrow band of noise wandering
          // up, which is the whole character of it.
          rasp(0, 0.9, 1800, 3000, 14, 0.3);
          rasp(0.1, 0.7, 2600, 2100, 18, 0.22);
          break;
      }
    },
    close() {
      void ctx?.close();
      ctx = null;
      hiss = null;
    },
  };
}
