/**
 * Exhaust smoke, as a plain particle system.
 *
 * No Three.js here. A puff is a position, a velocity and an age, and how it
 * moves is arithmetic: it leaves the stack with the machine's own speed plus a
 * kick upward, is dragged toward whatever the air around it is doing, keeps
 * rising while it is hotter than that air, and spreads and thins as it goes.
 * The renderer's only job is to draw a smudge wherever this says there is one.
 *
 * Puffs live in a fixed ring, because a thing that emits sixty times a second
 * for as long as the game is open should not be allocating.
 */

export interface Puff {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds since it left the stack. Negative means this slot is empty. */
  age: number;
  /** How long it lasts, in seconds. */
  life: number;
  /** Fixed per puff, so each one turns and breaks up differently. */
  seed: number;
}

export interface SmokeOptions {
  /** Puffs a second. */
  rate: number;
  /** How long one lasts, and how much that varies, in seconds. */
  life: number;
  lifeSpread: number;
  /** Speed out of the stack, in m/s, and how much it scatters sideways. */
  exhaust: number;
  spread: number;
  /**
   * Upward acceleration while it is still hot, in m/s^2, and how quickly that
   * fades. Hot exhaust climbs hard and then stops climbing.
   */
  rise: number;
  cooling: number;
  /** How quickly a puff gives up its own motion for the air's, per second. */
  drag: number;
  /** Radius at birth and how fast it grows, in metres and m/s. */
  size: number;
  growth: number;
}

/**
 * Far more smoke than a locomotive has any business making.
 *
 * Measured rather than eyeballed. What makes a plume opaque is its puffs
 * adding up to several times its own area, and there is more than one way to
 * buy that: many small ones or fewer larger ones. It used to be 150 a second
 * at 1.1 m, which came to about fifteen times over and cost a thousand
 * puff-updates a tick per engine. It is now 80 a second at 1.4 m, which comes
 * to about thirteen times over -- the same wall of smoke, drawn with 45%
 * fewer of them.
 *
 * The floor is known: at the rate this started on the overlap was 1.8 times
 * and you could see the yard through it.
 */
export const defaultSmokeOptions: SmokeOptions = {
  rate: 80,
  life: 10,
  lifeSpread: 2.5,
  exhaust: 6,
  spread: 0.9,
  rise: 3.2,
  cooling: 0.55,
  drag: 0.55,
  size: 1.4,
  growth: 1.3,
};

/** Small deterministic PRNG, so a given run always makes the same smoke. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Smoke {
  /** Every slot, live and dead. Read `age >= 0` to tell them apart. */
  readonly puffs: readonly Puff[];
  /** How many are alive. */
  readonly living: number;
  /**
   * Emit from `from`, moving at `carried`, and move everything already out.
   *
   * `air` gives the wind at a point, which is what makes the plume lie down
   * and drift instead of standing straight up over the chimney.
   */
  update(
    dt: number,
    from: { x: number; y: number; z: number },
    carried: { x: number; y: number; z: number },
    air: (x: number, y: number, z: number) => { x: number; y: number; z: number },
  ): void;
}

/** How wide a puff is at a given age, in metres. */
export function puffRadius(puff: Puff, options: SmokeOptions): number {
  return options.size + Math.max(0, puff.age) * options.growth;
}

/**
 * How solid a puff is, 0 to 1.
 *
 * Full almost at once -- exhaust is thick the moment it is out -- then thinning
 * away over the rest of its life. Squared on the way out so it disperses
 * rather than switching off.
 */
export function puffOpacity(puff: Puff): number {
  if (puff.age < 0) return 0;
  const through = Math.min(1, puff.age / puff.life);
  const rising = Math.min(1, puff.age / 0.25);
  const fading = 1 - through;
  return rising * fading * fading;
}

/**
 * How far the stack may move in one update before it counts as having been
 * moved rather than driven, in metres.
 *
 * Generous against the fastest thing that smokes: an engine at 16 m/s covers
 * 16 m in the longest step it will ever be given. A level change moves it
 * kilometres.
 */
const TELEPORT = 120;

export function createSmoke(
  options: SmokeOptions = defaultSmokeOptions,
  seed = 99,
): Smoke {
  const rand = mulberry32(seed);
  // Enough slots for everything that can be alive at once, and a little over.
  const capacity = Math.ceil(options.rate * (options.life + options.lifeSpread)) + 8;

  const puffs: Puff[] = Array.from({ length: capacity }, () => ({
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: -1, life: 1, seed: 0,
  }));

  let next = 0;
  let owed = 0;
  let living = 0;
  /**
   * Where the stack was at the end of the last update.
   *
   * Kept so that the puffs owed for a step can be laid down *along* the way
   * the engine came rather than all at the point it has reached. At a 120 Hz
   * tick the two are five centimetres apart and it makes no difference; at
   * one update a second they are sixteen metres apart, and without this the
   * plume is a string of blobs with gaps between them.
   */
  let came: { x: number; y: number; z: number } | null = null;

  const light = (from: { x: number; y: number; z: number }, carried: { x: number; y: number; z: number }) => {
    const puff = puffs[next]!;
    next = (next + 1) % capacity;

    puff.x = from.x;
    puff.y = from.y;
    puff.z = from.z;
    // Out of the stack with the machine's own motion, plus a kick up and a
    // little scatter, or the plume is a rod rather than a billow.
    puff.vx = carried.x + (rand() - 0.5) * 2 * options.spread;
    puff.vy = carried.y + options.exhaust * (0.75 + rand() * 0.5);
    puff.vz = carried.z + (rand() - 0.5) * 2 * options.spread;
    puff.age = 0;
    puff.life = options.life + (rand() - 0.5) * 2 * options.lifeSpread;
    puff.seed = rand();
  };

  return {
    puffs,
    get living() {
      return living;
    },
    update(dt, from, carried, air) {
      if (dt <= 0) return;

      // A step is a stretch of track, not a point. Anything owed is spread
      // back along it, unless the stack has plainly been picked up and put
      // somewhere else -- a level change moves it kilometres, and a plume
      // smeared across the map is worse than one that starts again.
      const jumped =
        came === null ||
        Math.hypot(from.x - came.x, from.y - came.y, from.z - came.z) > TELEPORT;
      const trail = jumped ? from : came!;

      // Emit at a steady rate, carrying the fraction over rather than losing
      // it: at 55 a second and a 120 Hz tick, less than one is due each time.
      owed += options.rate * dt;
      const due = Math.floor(owed);
      for (let i = 0; i < due; i += 1) {
        owed -= 1;
        // Oldest first, so the one lit furthest back is the one that has been
        // out longest -- which is what the ageing below then assumes.
        const t = due === 1 ? 1 : (i + 1) / due;
        light(
          {
            x: trail.x + (from.x - trail.x) * t,
            y: trail.y + (from.y - trail.y) * t,
            z: trail.z + (from.z - trail.z) * t,
          },
          carried,
        );
      }
      came = { x: from.x, y: from.y, z: from.z };

      living = 0;
      for (const puff of puffs) {
        if (puff.age < 0) continue;

        puff.age += dt;
        if (puff.age >= puff.life) {
          puff.age = -1;
          continue;
        }
        living += 1;

        const wind = air(puff.x, puff.y, puff.z);
        // Toward the air's motion, never past it: a puff cannot be blown
        // faster than the wind carrying it.
        const settle = Math.min(1, options.drag * dt);
        puff.vx += (wind.x - puff.vx) * settle;
        puff.vy += (wind.y - puff.vy) * settle;
        puff.vz += (wind.z - puff.vz) * settle;

        // Buoyancy, dying away as it mixes with the air around it.
        puff.vy += options.rise * Math.exp(-puff.age * options.cooling) * dt;

        puff.x += puff.vx * dt;
        puff.y += puff.vy * dt;
        puff.z += puff.vz * dt;
      }
    },
  };
}
