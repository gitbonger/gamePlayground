/**
 * Which level the player has got to, kept between visits.
 *
 * Storage is handed in rather than reached for, so this is testable without a
 * browser and so a caller with no storage at all -- a private window, a
 * browser that refuses it, a test -- is an ordinary case rather than a crash.
 */

const KEY = 'pigeon-sim.level';

/**
 * The level to start on, as an index.
 *
 * Nothing stored means the beginning, and so does anything stored that is not
 * a level: a number from an older build with more levels in it, or a value
 * somebody typed into the console. There is no version of this worth throwing
 * over, and being put back at the first level is a fair answer to all of it.
 */
export function loadProgress(store: Storage | undefined, levels: number): number {
  if (!store || levels <= 0) return 0;

  let raw: string | null = null;
  try {
    raw = store.getItem(KEY);
  } catch {
    // Storage can be present and still refuse to be read.
    return 0;
  }
  if (raw === null) return 0;

  const at = Number(raw);
  if (!Number.isInteger(at) || at < 0 || at >= levels) return 0;
  return at;
}

/**
 * Remember the level being played. Failing to is not worth interrupting for.
 *
 * The check for storage at all is for saying so rather than for working: the
 * catch below would swallow the same call on `undefined` just as quietly, and
 * a block that means "the disk is full" should not be doing double duty as
 * one that means "there is no disk".
 */
export function saveProgress(store: Storage | undefined, at: number): void {
  if (!store) return;
  try {
    store.setItem(KEY, String(at));
  } catch {
    // Full, or refused. The game is perfectly playable without it.
  }
}
