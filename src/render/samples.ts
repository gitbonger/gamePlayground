/**
 * The recorded noises: an actual dog, an actual hooded crow.
 *
 * `browserKit` next door synthesises its five sounds out of oscillators, and
 * for a long time that was the right trade -- a page of envelopes against
 * half a megabyte of downloads, for sounds heard at fifty metres through
 * wind. What it cannot do is *vary*. A synthesised bark is the same bark
 * every time, and a dog that barks identically twice stops being a dog after
 * the second one. Recordings are worth their weight for that alone: four
 * barks in a folder, picked at random and pitched a little apart, and the
 * street has more than one animal in it.
 *
 * The synth stays, as the floor. Nothing here is waited for: until a file is
 * fetched and decoded the noise comes out of the oscillators, so a slow
 * connection is a game that starts out synthetic and quietly turns real,
 * rather than a game that is silent for six seconds.
 */

import { audio, audioIfOpen, closeAudio } from './audio';
import type { Kit, Noise } from './ambience';

/**
 * Every sound file in the folders beside this one, by path.
 *
 * A glob rather than a list of imports, because the folder *is* the manifest:
 * drop another bark into `sounds/bark/` and it is a bark the game can make,
 * with nothing to edit here. Vite resolves these at build time, which keeps
 * the promise `vite.config.ts` makes -- no path is made up at runtime, and a
 * missing file is a build error rather than a 404 nobody hears.
 */
const FILES = import.meta.glob('./sounds/*/*.mp3', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** The folder name is the noise: `./sounds/bark/rome.mp3` is a bark. */
function sortIntoFolders(files: Record<string, string>): Map<string, string[]> {
  const folders = new Map<string, string[]>();
  for (const path of Object.keys(files).sort()) {
    const folder = path.split('/')[2];
    const url = files[path];
    if (folder === undefined || url === undefined) continue;
    const already = folders.get(folder);
    if (already) already.push(url);
    else folders.set(folder, [url]);
  }
  return folders;
}

/**
 * A trim per kind, because the recordings do not agree about loudness.
 *
 * They are normalised on the way in, which makes a coo and a tram bell the
 * same size on a meter and nothing like the same size in a street. These
 * are the differences a meter cannot see: a bell is a signal and a coo is
 * somebody muttering two courtyards away.
 */
const TRIM: Record<Noise, number> = {
  bark: 0.9,
  coo: 0.55,
  caw: 0.8,
  bell: 1,
  screech: 0.7,
};

/**
 * How far the pitch is allowed to wander, either way.
 *
 * Six per cent is about a semitone. Enough that the same file twice is two
 * animals; little enough that a crow does not turn into a seagull. It also
 * changes the length, which is the part that actually sells it -- two barks
 * of exactly equal duration read as one sound played twice however the pitch
 * is bent.
 */
const WANDER = 0.06;

export function sampledKit(fallback: Kit, volume = 0.5): Kit {
  const folders = sortIntoFolders(FILES);
  /** Decoded and ready. Empty until the fetches land. */
  const ready = new Map<string, AudioBuffer[]>();
  /** The last one played of each kind, so the next one is a different one. */
  const before = new Map<string, number>();
  let loading = false;

  /** Fetch and decode the lot, once, after the first gesture has made a context. */
  const load = (audio: AudioContext) => {
    if (loading) return;
    loading = true;
    for (const [noise, urls] of folders) {
      for (const url of urls) {
        void fetch(url)
          .then((r) => r.arrayBuffer())
          .then((bytes) => audio.decodeAudioData(bytes))
          .then((buffer) => {
            const have = ready.get(noise);
            if (have) have.push(buffer);
            else ready.set(noise, [buffer]);
          })
          // A file that will not decode is one sound the game does without.
          // The synth covers it, and a missing bark is not worth a console
          // full of red on a machine that is otherwise fine.
          .catch(() => {});
      }
    }
  };

  return {
    play(noise, level, pan) {
      const ctx = audio();
      load(ctx);

      const clips = ready.get(noise);
      if (!clips || clips.length === 0) {
        fallback.play(noise, level, pan);
        return;
      }

      // Anything but the one just heard. With one file in the folder that is
      // the same file, which is the synth's problem again -- but it is the
      // floor, not the plan.
      let which = Math.floor(Math.random() * clips.length);
      if (clips.length > 1 && which === before.get(noise)) {
        which = (which + 1 + Math.floor(Math.random() * (clips.length - 1))) % clips.length;
      }
      before.set(noise, which);
      const clip = clips[which];
      if (!clip) return;

      const source = ctx.createBufferSource();
      source.buffer = clip;
      source.playbackRate.value = 1 + (Math.random() * 2 - 1) * WANDER;

      const place = ctx.createStereoPanner();
      place.pan.value = pan * 0.8;
      const out = ctx.createGain();
      out.gain.value = level * volume * (TRIM[noise] ?? 1);

      source.connect(out).connect(place).connect(ctx.destination);
      source.start();
    },
    close() {
      closeAudio();
      ready.clear();
      loading = false;
      fallback.close();
    },
  };
}

/**
 * The city underneath, which is the one sound that is always there.
 *
 * Everything else in here is an event: a dog barks, a bell rings, and between
 * them the district is silent, which no district is. What a city actually
 * sounds like from above is a floor of traffic -- a mile of it at once, too
 * far off to be any particular car -- and the useful thing about that floor
 * is that it *changes with height*. At a hundred and fifty metres it is a
 * hiss. At ten it is a road. A pigeon coming down hears the city come up to
 * meet it, and that is worth more as orientation than any instruction on the
 * panel.
 */
export interface Bed {
  /**
   * How high the bird is, in metres, and whether the city is there at all.
   *
   * Called every frame. The ramping is in here rather than in the caller
   * because a gain that jumps is a click, and a click over a loop is the one
   * artefact everybody hears.
   */
  hear(altitude: number, on: boolean): void;
  close(): void;
}

/** Where it is a road rather than a hiss, in metres. */
const DOWN_IN_IT = 8;
/**
 * The height at which the city is half as loud.
 *
 * Thirty-five, and the shape is `1 / (1 + h / 35)` rather than anything with
 * a square in it -- for the same reason the point sounds fall off linearly.
 * Squared, the whole band the game is actually flown in, twenty to a hundred
 * and fifty, came out as one indistinguishable quiet.
 */
const HALF_AT = 35;

export function cityBed(volume = 0.3): Bed {
  const urls = sortIntoFolders(FILES).get('street') ?? [];
  let gain: GainNode | null = null;
  let started = false;
  let want = 0;

  return {
    hear(altitude, on) {
      want = on ? volume / (1 + Math.max(0, altitude - DOWN_IN_IT) / HALF_AT) : 0;

      // Nothing is opened until there is something to play: with no bed file
      // in the folder, or before the first noise of the game, this is a no-op
      // that costs a comparison.
      if (urls.length === 0) return;
      // Only ever rides a context something else has already opened, which is
      // how it avoids being the thing that asks for audio before the player
      // has touched a key.
      const ctx = audioIfOpen();
      if (!ctx) return;

      if (!started) {
        started = true;
        gain = ctx.createGain();
        gain.gain.value = 0;
        gain.connect(ctx.destination);
        // Which street, decided once a session. Two recordings of the same
        // Sunday afternoon, and hearing the other one on the next flight is
        // most of what stops forty seconds of traffic becoming furniture.
        const street = urls[Math.floor(Math.random() * urls.length)] ?? urls[0]!;
        void fetch(street)
          .then((r) => r.arrayBuffer())
          .then((bytes) => ctx.decodeAudioData(bytes))
          .then((buffer) => {
            if (!gain) return;
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.loop = true;
            // In at a random point, so that starting the game twice is not
            // the same thirty seconds of traffic twice.
            source.connect(gain);
            source.start(0, Math.random() * buffer.duration);
          })
          .catch(() => {});
      }

      // Half a second to get anywhere, which is slow enough to be a descent
      // and fast enough to follow a dive.
      gain?.gain.setTargetAtTime(want, ctx.currentTime, 0.5);
    },
    close() {
      gain?.disconnect();
      gain = null;
      started = false;
    },
  };
}
