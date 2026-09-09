import { read, type Words } from '../i18n';
import type { Message, Moment } from './messages';
import { drawIcon, type IconName } from './icons';

/**
 * The panel under the bird: the keys, and what they do.
 *
 * The controls used to be a block of a dozen lines in the top left, which is
 * a reference card rather than teaching -- read once, at the moment the
 * player knows least about what any of it means, and then scenery. This is
 * the other way round: the thing to do, at the moment it is the thing to do.
 *
 * A tip is some keys and a few words, and it says nothing the panel it sits
 * under already says. The keycap is a picture of the key, so "press" is a
 * word the text does not have to spend.
 *
 * What is in this file is the *showing*: the shape of a tip, how long the
 * screen holds one, how many it holds at once, and how they are drawn. What
 * decides whether a particular thing is worth saying lives in `messages.ts`,
 * next to the words it decides for. Those were the same file once and they
 * should not be: one of them is about the corner of a screen and the other
 * is about flying a pigeon.
 */

export interface Tip {
  /** The keys to press, in the order they are shown. */
  keys: readonly string[];
  /** What pressing them does, as an instruction rather than a description. */
  text: Words;
  /**
   * The picture that goes with it, on the left of the words.
   *
   * Optional in the type and given everywhere in practice. A tip without one
   * simply has no picture, which is better than a wrong picture -- and it
   * means adding an instruction never breaks the build over artwork.
   */
  icon?: IconName;
  /**
   * What kind of thing this is, which decides its colour and its sound.
   *
   * The panel says one thing at a time and the player is flying: what they
   * get before they have read a word is a colour and a note, and those have
   * to be worth something. So `survival` is the ones that end the flight if
   * ignored, `story` is the game talking, and `hint` is everything else --
   * and a player who learns one sound learns the only one that matters.
   *
   * Left out, it is a hint. That is the right default: an instruction nobody
   * has thought about is not an emergency.
   */
  sort?: 'survival' | 'story' | 'hint';
  /**
   * Sounded rather than spoken.
   *
   * For the one thing that is actively hunting you. Reading `A varjak rád
   * álltak!` out loud takes most of a second and has to finish before the
   * next thing can be said; two tones take a fifth of that and say the same
   * thing, which is *now*. See `createAlarm`.
   */
  beep?: boolean;
  /**
   * Whether this one is worth saying out loud.
   *
   * Most are not. A voice that reads every instruction is a voice you turn
   * off, and then it is not there for the one that mattered -- so it says
   * only what is about to go wrong or what the flight cannot continue
   * without. Everything else is on the screen, where something can be
   * ignored without being silenced.
   *
   * The test, when adding one: what happens if the player does not read it?
   * If they die, or the level cannot be finished, it is spoken. If they miss
   * a nicety or find out a second later, it is not. A danger is not the same
   * thing as a resource running down -- the stall, the sink and the crows are
   * spoken; the stamina warning is not, because a red bar is already saying
   * it and there are seconds in hand.
   */
  spoken?: boolean;
}

/**
 * Which keys on the keyboard each shown key stands for.
 *
 * An instruction goes away when the player uses it, which means the drawing
 * of a key has to be connected to the key -- and the arrows are drawn as
 * arrows while the same control is also on WASD, so one label answers to two
 * codes. Kept here, beside the labels, because the label is the only reason
 * this mapping exists.
 */
const CODES: Record<string, readonly string[]> = {
  SPACE: ['Space'],
  '↑': ['ArrowUp', 'KeyW'],
  '↓': ['ArrowDown', 'KeyS'],
  '←': ['ArrowLeft', 'KeyA'],
  '→': ['ArrowRight', 'KeyD'],
  B: ['KeyB'],
  R: ['KeyR'],
  V: ['KeyV'],
  TAB: ['Tab'],
};

/** The `KeyboardEvent.code`s that count as doing what a tip says. */
/**
 * The keyboard codes a shown key stands for.
 *
 * The label is what the panel draws and the codes are what the keyboard
 * sends, and a message that dismisses itself when the player presses its key
 * has to mean the key on its own cap. So both go through here: the caption
 * and the dismissal cannot drift apart because there is only one mapping.
 */
export const codesOf = (keys: readonly string[]): readonly string[] =>
  keys.flatMap((key) => CODES[key] ?? []);

/** The same, for a whole tip. */
export const codesFor = (tip: Tip): readonly string[] => codesOf(tip.keys);

/**
 * How long an instruction stays up once it has arrived, in seconds.
 *
 * Five. It used to be seven, which was the right number for a corner that
 * showed one thing at a time: an instruction that was replaced the moment the
 * next one arrived had to earn its place by staying. Three was the first try
 * once they stacked, and it is not long enough to read two sentences of
 * Hungarian while flying a pigeon.
 */
export const HELD = 5;

/**
 * How many may be up at once.
 *
 * Three. Not a screenful, which is what a stack with no limit becomes the
 * first time the bird is low, slow, tired and being chased -- four warnings
 * and a lesson, and the player reads none of them. The fourth pushes the
 * oldest off the top, so what is on screen is always the most recent three
 * things the game had to say.
 */
export const STACKED = 3;

/**
 * The instructions that are up, oldest first.
 *
 * The corner used to show exactly one thing, chosen by a chain of `??` --
 * which meant that everything below the winner was not late, it was *never
 * said*. A crow closing while the wings ran out said "crows"; the stamina was
 * simply never mentioned.
 *
 * It is handed every message the game has and the moment to judge them
 * against, and it does the judging: a message is offered while `when` holds
 * and `done` does not. That is here rather than in the caller because the
 * rules that decide what is on screen -- how long a thing stays, how many may
 * be up, whether one is finished and whether it has already been said -- are
 * one rule between them, and splitting them across two files is how they came
 * to disagree.
 *
 * A message is kept for `held` seconds, and for as long after that as it is
 * still being offered. That second half is what keeps a warning honest: one
 * about the ground is true until the ground stops being a problem, and one
 * that timed out while it was still true would blink off and on. `done` cuts
 * across both -- an instruction the player has just acted on goes at once,
 * however long it has been up.
 */
export interface TipStack {
  /**
   * Judge every message against this moment, and get back what to show.
   *
   * The list is in the order they should stack if two of them come true in
   * the same frame: the earlier of them is the older of the two.
   */
  update(messages: readonly Message[], at: Moment, now: number): readonly Tip[];
  /** Clear it, for a flight that is starting again. */
  reset(): void;
}

export function createTipStack(held = HELD, most = STACKED): TipStack {
  interface Up {
    message: Message;
    /** When it arrived, and when it was last still true. */
    arrived: number;
    offered: number;
  }
  let up: Up[] = [];
  /** What has already been said on this level, for the ones said once. */
  const given = new Set<string>();

  return {
    update(messages, at, now) {
      for (const message of messages) {
        if (message.on && !message.on.includes(at.level)) continue;
        const already = up.find((each) => each.message.id === message.id);
        // Finished: gone at once, whatever else is true and however long it
        // has been up. This is the half that lets an instruction answer the
        // player -- press the key it names and it goes.
        if (message.done?.(at)) {
          if (already) up = up.filter((each) => each !== already);
          continue;
        }
        if (!message.when(at)) continue;
        if (already) {
          // The same thing, still true. It keeps the place it has had rather
          // than jumping to the bottom of the stack every frame.
          //
          // Except where it is said once. Those are events rather than states
          // -- "you have flown a hundred and fifty metres" goes on being true
          // for the rest of the level -- so refreshing them would pin them to
          // the screen for good. Every distance-triggered lesson in the game
          // did exactly that: given, and then never taken away.
          if (!message.once) already.offered = now;
          continue;
        }
        // Said once a level, and it has been said.
        if (message.once && given.has(message.id)) continue;
        if (message.once) given.add(message.id);
        up.push({ message, arrived: now, offered: now });
      }
      // Gone once it has had its time, unless it is still true. How long that
      // is is the message's own where it says so: a line naming the place you
      // are arriving at wants longer on screen than a key to press.
      up = up.filter(
        (each) => now - each.arrived < (each.message.holds ?? held) || each.offered >= now,
      );
      // And never more than a screenful: the oldest goes first, which is the
      // one the player has had the longest to read.
      if (up.length > most) up = up.slice(up.length - most);
      return up.map((each) => each.message);
    },
    reset() {
      up = [];
      given.clear();
    },
  };
}

export interface TipPanel {
  /**
   * Show a tip, or pass null to take the panel away.
   *
   * `clearOf` is how many pixels of something else are stacked at the bottom
   * of the screen -- the conversation card, in practice -- and the panel
   * lifts itself over them. Passed in rather than looked up, because a panel
   * that goes hunting through the page for another panel is two panels that
   * cannot be moved independently.
   */
  show(tips: readonly Tip[], clearOf?: number): void;
  dispose(): void;
}

export function createTipPanel(container: HTMLElement): TipPanel {
  const root = document.createElement('div');
  root.className = 'tip';
  root.hidden = true;
  container.appendChild(root);

  /** What is on screen, so an unchanged stack is not rebuilt every frame. */
  let showing: string | null = null;

  /** One instruction, as a row of the stack. */
  function draw(tip: Tip): HTMLElement {
    // The colour says what kind of thing this is before a word of it has been
    // read: see `Tip.sort`. On the row rather than on the stack, now that
    // there is more than one row and they need not be the same kind.
    const row = document.createElement('div');
    row.className = `tip-row tip-${tip.sort ?? 'hint'}`;

    // The picture first, on the left, because it is the part that is read
    // without reading -- and it is the same picture in both languages.
    if (tip.icon) row.appendChild(drawIcon(tip.icon));

    for (const key of tip.keys) {
      const cap = document.createElement('b');
      cap.className = 'tip-key';
      cap.textContent = key;
      row.appendChild(cap);
    }

    const said = document.createElement('span');
    said.className = 'tip-text';
    said.textContent = read(tip.text);
    row.appendChild(said);
    return row;
  }

  return {
    show(tips, clearOf = 0) {
      // Lifted over whatever is standing at the bottom. Nought puts it back
      // where the stylesheet asks for it, which is under the bird.
      root.style.marginBottom = clearOf > 0 ? `${clearOf + 18}px` : '';
      // The words rather than the tips, so the same instructions in a language
      // that has just been swapped count as a different thing to show.
      const wanted = tips
        .map((tip) => `${tip.icon ?? ''} ${tip.keys.join('+')} ${read(tip.text)}`)
        .join('\n');
      if (wanted === showing) return;
      showing = wanted;

      root.hidden = tips.length === 0;
      root.replaceChildren(...tips.map(draw));
    },
    dispose() {
      root.remove();
    },
  };
}
