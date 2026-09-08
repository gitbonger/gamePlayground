/**
 * Which of the escort's rigs are drawn, and which of them is her.
 *
 * A flock is a fixed set of rigs -- thirty of them, built once, let out in
 * whatever number the level asks for -- and one extra in her colours, for the
 * level where the flock is one bird and the bird is somebody. A rig takes its
 * morph when it is built, so the alternative to keeping a second one is
 * rebuilding thirty at every level change to make one of them pink.
 *
 * This is here, as a function over the whole flock, because the obvious way
 * to write it is wrong and was: her rig's visibility was set inside the loop
 * over the birds, so the one bird that is her set it true and the
 * twenty-nine that are not set it false again. She was never drawn. A rule
 * that answers for every rig at once cannot be written that way.
 */
export interface EscortDrawn {
  /** Whether her rig is drawn. */
  her: boolean;
  /** Whether each bird's own rig is drawn. */
  flock: boolean[];
}

/**
 * `shown` says which birds can be seen at all; `hers` is which of them is her,
 * or null on every level where the flock is nobody in particular.
 */
export function escortDrawn(shown: readonly boolean[], hers: number | null): EscortDrawn {
  return {
    her: hers !== null && (shown[hers] ?? false),
    // Never both: her bird is drawn by her rig, so its own must come off, or
    // there is a grey pigeon inside her.
    flock: shown.map((seen, i) => seen && i !== hers),
  };
}
