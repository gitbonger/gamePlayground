/**
 * The controls for a machine with no keyboard: one thumb stick and a few
 * buttons, drawn over the game.
 *
 * The buttons do not call into the game. They dispatch the key event the
 * button stands for, and the game goes on reading its keyboard exactly as it
 * did -- which is the whole trick, and worth stating because it looks like
 * laziness and is not. Every instruction in `MESSAGES.md` is written in keys:
 * a message *names* a key, and it goes away *when that key is pressed*. A
 * touch layer that called `launch()` directly would fly the bird and leave
 * "Take off!" sitting on the screen for ever, and the same for the brakes,
 * the rocket and every tip that waits on `anyDown`. A tap that is a Space
 * press is a Space press to all of them.
 *
 * The stick is the exception, and it has to be: pitch and roll are analog,
 * a key is not, and a bird flown in eight directions cannot be landed on a
 * roof. That one goes through `Pointing`, which the flight axes read
 * directly.
 */

import { audio } from './render/audio';
import { onLanguageChange, say, type Phrase } from './i18n';
import type { Pointing } from './input';

/**
 * How far from its centre the thumb has to travel for full deflection, in
 * CSS pixels.
 *
 * Small enough to reach without moving the hand off the phone, large enough
 * that the middle third of the throw is usable -- which is where a landing
 * is flown. Sixty is about a thumb's comfortable arc on a held phone.
 */
const REACH = 60;

/** What the phone's buttons stand for, in the keyboard the game already has. */
const BUTTONS = [
  { code: 'Space', says: 'padFlap', className: 'pad-flap' },
  { code: 'KeyB', says: 'padBrake', className: 'pad-brake' },
  { code: 'KeyT', says: 'padTuck', className: 'pad-tuck' },
] as const satisfies readonly { code: string; says: Phrase; className: string }[];

/**
 * The two that are not flying: the level list, and the rocket.
 *
 * Small and in the corner, because they are pressed between flights and by
 * somebody who is looking at them, not by a thumb that is busy.
 */
const CHIPS = [
  { code: 'KeyL', says: '≡', className: 'pad-levels' },
  { code: 'KeyX', says: 'X', className: 'pad-rocket' },
] as const;

/**
 * Whether this is a machine to draw the pad on.
 *
 * A coarse pointer and no hover is the pair that means a finger: either alone
 * catches things it should not -- a touchscreen laptop has a fine pointer as
 * well as a coarse one, and reports both.
 */
export function onPhone(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(pointer: coarse)').matches &&
    window.matchMedia('(hover: none)').matches
  );
}

export interface TouchPad {
  /**
   * Take the flying controls off the screen, or put them back.
   *
   * For whatever covers the game and wants the finger instead: the level list
   * is a full-screen card, and a thumb landing on it would otherwise be
   * caught by the stick zone underneath and roll the bird while he read it.
   *
   * Not *everything* goes. The button that opened the list stays, above it,
   * because it is also the button that shuts it again -- taken away with the
   * rest, the only way out of the list was to start a level, which is a
   * corner to be painted into rather than a menu.
   */
  holster(away: boolean): void;
  dispose(): void;
}

export function createTouchControls(container: HTMLElement, pointing: Pointing): TouchPad {
  const root = document.createElement('div');
  root.className = 'pad';

  // Where the thumb goes: the left half, all of it. Not a drawn ring in a
  // fixed place -- the stick is wherever the thumb lands, because a player
  // looking at a bird two hundred metres up is not also looking at his own
  // hand.
  const zone = document.createElement('div');
  zone.className = 'pad-zone';
  const ring = document.createElement('div');
  ring.className = 'pad-ring';
  const knob = document.createElement('div');
  knob.className = 'pad-knob';
  ring.appendChild(knob);
  zone.appendChild(ring);
  root.appendChild(zone);

  const buttons = document.createElement('div');
  buttons.className = 'pad-buttons';
  for (const { code, says, className } of BUTTONS) {
    const button = document.createElement('div');
    button.className = `pad-button ${className}`;
    button.dataset['says'] = says;
    hold(button, code);
    buttons.appendChild(button);
  }
  root.appendChild(buttons);

  const chips = document.createElement('div');
  chips.className = 'pad-chips';
  for (const { code, says, className } of CHIPS) {
    const chip = document.createElement('div');
    chip.className = `pad-chip ${className}`;
    chip.textContent = says;
    hold(chip, code);
    chips.appendChild(chip);
  }
  /**
   * And the language, which is the one key in the corner that had no way in
   * at all here.
   *
   * Its own element rather than another entry in `CHIPS`, because it is the
   * only one whose face changes: it is written in the language it would swap
   * *to*, so it says what it does without needing a word for "language". The
   * other two are a glyph and a letter and will be those in any language.
   */
  const language = document.createElement('div');
  language.className = 'pad-chip pad-language';
  language.dataset['says'] = 'padLanguage';
  hold(language, 'Tab');
  chips.appendChild(language);

  root.appendChild(chips);

  /**
   * What to do about a phone held upright.
   *
   * Not a thing the game can be played in: seventy degrees of vertical view
   * on a screen twice as tall as it is wide leaves about thirty degrees of
   * horizontal, and a pigeon turns by rolling into what he cannot see. So the
   * game is stopped rather than squeezed -- the card covers it, the pad goes
   * under the card, and the world carries on behind both. The orientation is
   * a CSS question and it is answered in CSS; this is only the words.
   */
  const rotate = document.createElement('div');
  rotate.className = 'rotate';
  const rotateCard = document.createElement('div');
  rotateCard.className = 'rotate-card';
  rotateCard.dataset['says'] = 'turnPhone';
  rotate.appendChild(rotateCard);
  root.appendChild(rotate);

  /** The pad's own words, in whichever language the game is in. */
  function relabel(): void {
    for (const el of root.querySelectorAll<HTMLElement>('[data-says]')) {
      el.textContent = say(el.dataset['says'] as Phrase);
    }
  }
  relabel();
  onLanguageChange(relabel);

  container.appendChild(root);

  /**
   * The two things that can only be asked for out of a gesture, asked for on
   * the first one there is.
   *
   * **The sound.** A phone will not let a page make a noise except out of a
   * gesture, and it counts the attempt against the page when it tries. The
   * game opens its context on the first sound it wants to make, which on a
   * keyboard is after a key and on a phone was never -- there were no
   * gestures at all. This is the gesture.
   *
   * **The whole screen.** Android hands it over and the browser's toolbars
   * go with it, which on a landscape phone is a tenth of the sky. iPhone
   * Safari refuses -- it has no fullscreen for a page at all -- and the way
   * to lose the toolbar there is to add the game to the home screen, which
   * the manifest and the `apple-mobile-web-app-capable` tag in `index.html`
   * are for. Both calls are allowed to fail and nothing is told if they do.
   */
  let begun = false;

  function begin(): void {
    if (begun) return;
    begun = true;
    void audio();
    void document.documentElement
      .requestFullscreen?.()
      // The lock only holds inside fullscreen, so it is asked for after it
      // rather than beside it.
      .then(() => screen.orientation?.lock?.('landscape'))
      .catch(() => {
        // Refused, which is most phones. The rotate card covers the case.
      });
  }

  function press(code: string): void {
    begin();
    window.dispatchEvent(new KeyboardEvent('keydown', { code }));
  }

  const release = (code: string) => window.dispatchEvent(new KeyboardEvent('keyup', { code }));

  /**
   * Wire one element to one key, down and up.
   *
   * The up is hung on cancel and on the capture being lost as well as on the
   * lift, because the ways a touch can end without lifting are the ways a
   * control gets stuck on: a notification pulled down over the game, a
   * second finger, a thumb that slides off the button while the wing is
   * beating.
   */
  function hold(element: HTMLElement, code: string): void {
    element.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      element.classList.add('down');
      press(code);
      // After the press, and allowed to fail. Capture is what makes the
      // release arrive when the thumb has slid off the button by the time it
      // lifts -- useful, but not worth a key that never went down: a browser
      // that will not give it refuses by throwing.
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        // Nothing to do about it. `pointerup` still arrives on the element
        // whenever the thumb is still on it, which is the common case.
      }
    });
    const off = () => {
      if (!element.classList.contains('down')) return;
      element.classList.remove('down');
      release(code);
    };
    element.addEventListener('pointerup', off);
    element.addEventListener('pointercancel', off);
    element.addEventListener('lostpointercapture', off);
  }

  /** Which touch is the stick, so a second finger on a button is not it. */
  let thumb: number | null = null;
  let originX = 0;
  let originY = 0;

  function moveTo(clientX: number, clientY: number): void {
    let dx = clientX - originX;
    let dy = clientY - originY;
    const away = Math.hypot(dx, dy);
    // Past the rim, the centre follows rather than the stick saturating. A
    // thumb that started low and has run out of travel can carry on asking
    // for more by moving, instead of having to lift and land again.
    if (away > REACH) {
      originX += dx * (1 - REACH / away);
      originY += dy * (1 - REACH / away);
      dx *= REACH / away;
      dy *= REACH / away;
    }
    pointing.x = dx / REACH;
    pointing.y = dy / REACH;
    ring.style.transform = `translate(${originX}px, ${originY}px)`;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  zone.addEventListener('pointerdown', (event) => {
    if (thumb !== null) return;
    event.preventDefault();
    thumb = event.pointerId;
    // The stick does want it -- a thumb that leaves the left half mid-turn is
    // still flying -- but not at the price of a stick that never engages.
    try {
      zone.setPointerCapture(event.pointerId);
    } catch {
      // See `hold`.
    }
    originX = event.clientX;
    originY = event.clientY;
    pointing.held = true;
    ring.classList.add('down');
    begin();
    moveTo(event.clientX, event.clientY);
  });

  zone.addEventListener('pointermove', (event) => {
    if (event.pointerId !== thumb) return;
    moveTo(event.clientX, event.clientY);
  });

  const drop = (event: PointerEvent) => {
    if (event.pointerId !== thumb) return;
    thumb = null;
    pointing.held = false;
    pointing.x = 0;
    pointing.y = 0;
    ring.classList.remove('down');
    knob.style.transform = '';
  };
  zone.addEventListener('pointerup', drop);
  zone.addEventListener('pointercancel', drop);
  zone.addEventListener('lostpointercapture', drop);

  return {
    holster(away: boolean) {
      if (root.classList.contains('away') === away) return;
      root.classList.toggle('away', away);
      // A stick that goes away under a held thumb is a stick nobody let go
      // of: the pointer events stop arriving and the bird keeps the bank it
      // had when the list opened.
      if (away) {
        thumb = null;
        pointing.held = false;
        pointing.x = 0;
        pointing.y = 0;
        ring.classList.remove('down');
      }
    },
    dispose() {
      root.remove();
    },
  };
}
