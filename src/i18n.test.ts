import { describe, expect, it } from 'vitest';
import {
  PHRASES,
  languageNow,
  onLanguageChange,
  otherLanguage,
  preferredLanguage,
  read,
  rememberLanguage,
  sameInBoth,
  say,
  setLanguage,
  startLanguage,
} from './i18n';

describe('choosing a language for somebody who has not', () => {
  it('takes the browser at its word about which it prefers', () => {
    // The list is in order of preference, and that order is the whole rule.
    // Somebody in Budapest with a British laptop has `en-GB, hu-HU`: they
    // read both and would rather have English.
    expect(preferredLanguage(['en-GB', 'hu-HU'])).toBe('en');
    expect(preferredLanguage(['hu-HU', 'en-GB'])).toBe('hu');
  });

  it('reads the tag rather than matching it whole', () => {
    expect(preferredLanguage(['hu'])).toBe('hu');
    expect(preferredLanguage(['HU-hu'])).toBe('hu');
  });

  it('skips past languages it does not have', () => {
    // Somebody with German first and Hungarian second gets Hungarian: German
    // is not on offer, so it is not what they are choosing between.
    expect(preferredLanguage(['de-DE', 'hu-HU', 'en'])).toBe('hu');
  });

  it('falls back to English when neither is on the list', () => {
    // The one more people who read neither will have.
    expect(preferredLanguage(['de-DE', 'fr'])).toBe('en');
    expect(preferredLanguage([])).toBe('en');
  });
});

describe('remembering the choice', () => {
  const store = (kept: string | null) => ({
    getItem: () => kept,
    setItem: () => {},
  });

  it('uses what was chosen last time, over what the browser suggests', () => {
    // Pressing the key is a decision. The browser's list is a guess about
    // somebody who has not made one yet.
    expect(startLanguage(store('hu'), ['en-GB'])).toBe('hu');
    expect(startLanguage(store('en'), ['hu-HU'])).toBe('en');
  });

  it('ignores a stored value that is not a language', () => {
    expect(startLanguage(store('klingon'), ['hu'])).toBe('hu');
    expect(startLanguage(store(null), ['hu'])).toBe('hu');
  });

  it('starts in a private window rather than not starting', () => {
    // `localStorage` throws on the very first read where site data is turned
    // off, and a game that will not start there is a game nobody can be shown.
    const hostile = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
    };
    expect(startLanguage(hostile, ['hu'])).toBe('hu');
    expect(() => rememberLanguage(hostile)).not.toThrow();
    expect(() => rememberLanguage(null)).not.toThrow();
  });
});

describe('swapping', () => {
  it('tells whoever asked to be told', () => {
    // The HUD, the menu and the ending panel are each built once and written
    // over, so each has to relabel itself. Nothing here re-renders anything.
    startLanguage(null, ['en']);
    let told = 0;
    onLanguageChange(() => {
      told += 1;
    });
    setLanguage('hu');
    expect(told).toBe(1);
    expect(languageNow()).toBe('hu');

    // And says nothing when nothing changed, so a key pressed twice does not
    // rebuild the world twice.
    setLanguage('hu');
    expect(told).toBe(1);
  });

  it('offers the one it is not in, which is what the key says', () => {
    startLanguage(null, ['en']);
    expect(otherLanguage()).toBe('hu');
    setLanguage('hu');
    expect(otherLanguage()).toBe('en');
  });
});

describe('the words themselves', () => {
  it('says every label in both', () => {
    // A label with an empty half is a blank corner of the HUD, and it would
    // be found by playing the game in Hungarian rather than by anything here.
    for (const [name, words] of Object.entries(PHRASES)) {
      expect(words.en.length, name).toBeGreaterThan(0);
      expect(words.hu.length, name).toBeGreaterThan(0);
    }
  });

  it('has actually translated all of them', () => {
    // Nothing in the furniture is the same word in both languages, so a pair
    // that matches is one somebody pasted and did not finish. A proper noun
    // would be the exception -- and proper nouns are not labels, they are
    // content, and they use `sameInBoth` where they belong.
    for (const [name, words] of Object.entries(PHRASES)) {
      expect(words.en, name).not.toBe(words.hu);
    }
  });

  it('reads a label in whichever language is on', () => {
    startLanguage(null, ['en']);
    expect(say('altitude')).toBe('altitude');
    setLanguage('hu');
    expect(say('altitude')).toBe('magasság');
  });

  it('reads a piece of writing the same way', () => {
    const line = { en: 'She is not here.', hu: 'Nincs itt.' };
    startLanguage(null, ['en']);
    expect(read(line)).toBe('She is not here.');
    setLanguage('hu');
    expect(read(line)).toBe('Nincs itt.');
  });

  it('leaves a name alone in both', () => {
    // `Blaha Lujza tér` is what the place is called. An English player
    // standing on it needs the name on the sign, not a translation of it.
    setLanguage('en');
    expect(read(sameInBoth('Blaha'))).toBe('Blaha');
    setLanguage('hu');
    expect(read(sameInBoth('Blaha'))).toBe('Blaha');
  });
});
