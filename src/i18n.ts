/**
 * Two languages, and a key to swap them.
 *
 * The district is in Budapest and the story is about a Hungarian pigeon, so
 * Hungarian is not a translation of this game -- it is the language the thing
 * is set in. English is the one it happened to be written in first.
 *
 * Two shapes of text, because there are two kinds. What the game *says* --
 * conversations, the words on a sign, the name of a level -- is content, and
 * is written where it belongs, as a pair. What the game *labels* -- altitude,
 * stamina, Game over -- is furniture, and is written here once so that adding
 * a language is one file rather than nine.
 *
 * Place names are not translated in either direction. `Blaha Lujza tér` is
 * what the place is called; an English player standing on it needs the name
 * on the sign, not a translation of it.
 */

export type Lang = 'en' | 'hu';

/**
 * A piece of the game's own writing, in both languages.
 *
 * Not `Text`, which is the name of a DOM node: a file that forgot the import
 * would get that one and typecheck against it, which is exactly the sort of
 * mistake that shows up as a blank label months later.
 */
export interface Words {
  en: string;
  hu: string;
}

/**
 * Every label the game puts on its own furniture.
 *
 * Lower case on purpose where the HUD sets it lower case -- the styling is in
 * the stylesheet and the words here are the words, not a rendering of them.
 */
export const PHRASES = {
  // --- The readouts ---------------------------------------------------------
  airspeed: { en: 'airspeed', hu: 'sebesség' },
  altitude: { en: 'altitude', hu: 'magasság' },
  climb: { en: 'climb', hu: 'emelkedés' },
  wind: { en: 'wind', hu: 'szél' },
  home: { en: 'home', hu: 'haza' },
  health: { en: 'health', hu: 'életerő' },
  stamina: { en: 'stamina', hu: 'erőnlét' },
  calm: { en: 'calm', hu: 'szélcsend' },
  headwind: { en: 'head', hu: 'szembe' },
  tailwind: { en: 'tail', hu: 'hátba' },
  crosswind: { en: 'cross', hu: 'oldalt' },
  windTitle: {
    en: 'Local wind, and how much of it is against you',
    hu: 'A helyi szél, és hogy mennyi fúj szembe',
  },
  homeTitle: {
    en: 'Distance still to fly to the marked target',
    hu: 'Mennyit kell még repülni a megjelölt célig',
  },

  // --- The keys in the corner -----------------------------------------------
  keyLevels: { en: 'levels', hu: 'pályák' },
  keySpeedUp: { en: 'speed up', hu: 'gyorsítás' },
  keyBrake: { en: 'brake', hu: 'fékezés' },
  keyLanguage: { en: 'magyar', hu: 'english' },

  // --- The level menu -------------------------------------------------------
  menuTitle: { en: 'Levels', hu: 'Pályák' },
  menuPlaying: { en: 'playing', hu: 'itt tartasz' },
  menuSwitch: { en: 'switch', hu: 'válts' },
  menuHow: {
    en: 'number or ↑↓ and Enter to fly it, or click. ESC or L to close',
    hu: 'szám vagy ↑↓ és Enter a repüléshez, vagy kattints. ESC vagy L a bezáráshoz',
  },

  // --- Endings --------------------------------------------------------------
  landed: { en: 'Landed', hu: 'Leszálltál' },
  gameOver: { en: 'Game over', hu: 'Vége' },

  // --- Instructions ---------------------------------------------------------
  answerPrompt: {
    en: 'Press a number key to respond!',
    hu: 'Nyomj egy számot a válaszhoz!',
  },
  nowFlying: { en: 'now flying', hu: 'most repülöd' },
} as const satisfies Record<string, Words>;

export type Phrase = keyof typeof PHRASES;

/** Where the choice is kept between visits. */
const REMEMBERED = 'pigeon-sim.language';

/**
 * What to start in, when nobody has chosen.
 *
 * The browser's own list, which is the only thing here that knows anything
 * about the person holding the keyboard -- and it is a list *in order of
 * preference*, which is the whole of the rule. Somebody in Budapest with a
 * British laptop has `en-GB, hu-HU`: they read both and would rather have
 * English, and a rule that took Hungarian because Hungarian appears anywhere
 * on the list would hand them the wrong one. So it is the first tag that is
 * either language that decides, and English when neither is on the list --
 * that being the one more people who read neither will have.
 */
export function preferredLanguage(
  offered: readonly string[] = typeof navigator === 'undefined' ? [] : (navigator.languages ?? []),
): Lang {
  for (const tag of offered) {
    const wanted = tag.toLowerCase();
    if (wanted.startsWith('hu')) return 'hu';
    if (wanted.startsWith('en')) return 'en';
  }
  return 'en';
}

let language: Lang = 'en';
const listeners: (() => void)[] = [];

/** Which language the game is in. */
export const languageNow = (): Lang => language;

/** The other one, which is what the key swaps to. */
export const otherLanguage = (): Lang => (language === 'en' ? 'hu' : 'en');

/**
 * Set the language, and tell whoever asked to be told.
 *
 * Nothing here re-renders anything itself. The HUD, the menu and the corner
 * are built once and written over, so each of them has to relabel itself, and
 * each of them knows how -- this only says when.
 */
export function setLanguage(next: Lang): void {
  if (next === language) return;
  language = next;
  for (const listener of listeners) listener();
}

/** Be told when it changes. */
export function onLanguageChange(listener: () => void): void {
  listeners.push(listener);
}

/**
 * The same words in both languages.
 *
 * Not laziness: a proper noun is a proper noun. `Blaha Lujza tér` is what the
 * place is called and `Keleti` is what the station is called, and a level
 * named after one of them has one name, not two.
 */
export const sameInBoth = (words: string): Words => ({ en: words, hu: words });

/** A label, in the language the game is in. */
export const say = (phrase: Phrase): string => PHRASES[phrase][language];

/** A piece of the game's own writing, in the language the game is in. */
export const read = (words: Words): string => words[language];

/**
 * Start up: whatever was chosen last time, or whatever the browser suggests.
 *
 * Takes the store rather than reaching for `localStorage`, the same way the
 * progress does -- a private window throws on the very first read, and a game
 * that will not start in a private window is a game nobody can be shown.
 */
export function startLanguage(store: Pick<Storage, 'getItem'> | null, offered?: readonly string[]): Lang {
  let kept: string | null = null;
  try {
    kept = store?.getItem(REMEMBERED) ?? null;
  } catch {
    kept = null;
  }
  language = kept === 'hu' || kept === 'en' ? kept : preferredLanguage(offered);
  return language;
}

/** Remember it for next time. Silent if the store will not have it. */
export function rememberLanguage(store: Pick<Storage, 'setItem'> | null): void {
  try {
    store?.setItem(REMEMBERED, language);
  } catch {
    // A private window, or storage turned off. The game still works.
  }
}
