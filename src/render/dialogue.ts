/** The conversation panel: what has been said, and what you can say next. */

import { isOver, type Exchange } from '../dialogue';

/**
 * Who is speaking, as the colour they are.
 *
 * A conversation between two birds reads better if the words are the birds:
 * the pink one's line is pink and the hero's is his blue, so you know who
 * said what without a name in front of it.
 */
export interface Voices {
  them: string;
  you: string;
}

/**
 * How light a spoken line has to be to read on the panel, as relative
 * luminance.
 *
 * The card is nearly black, so a dark bird's own colour is a line you cannot
 * read -- and one of the four street pigeons is *black*. Rather than give up
 * and paint everyone white, a colour too dark to read is lifted towards white
 * until it is, which keeps the hue and loses only the depth.
 */
const READABLE = 0.42;

/** The luminance of one sRGB channel, linearised. */
const linear = (channel: number): number =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

const luminance = (r: number, g: number, b: number): number =>
  0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

/**
 * A bird's colour, as a colour its words can be printed in.
 *
 * Lifted towards white by however much it takes and no more, so a pale bird
 * is printed exactly as it looks and a dark one is printed as the palest
 * version of itself that can still be read. Hue survives; only the depth of
 * the colour is spent, which is the right thing to spend -- the line has to
 * be readable before it has to be accurate.
 */
export function speechColour(hex: number): string {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;

  // Nothing at all when it already reads, which is most of them: a colour
  // light enough is printed exactly as the bird looks.
  let lift = 0;
  if (luminance(r, g, b) < READABLE) {
    let low = 0;
    let high = 1;
    // Sixteen halvings of the gap, which settles it to a part in 65,000 --
    // far finer than the eight bits it is about to be rounded to.
    for (let i = 0; i < 16; i += 1) {
      const mid = (low + high) / 2;
      const towards = (channel: number) => channel + (1 - channel) * mid;
      if (luminance(towards(r), towards(g), towards(b)) < READABLE) low = mid;
      else high = mid;
    }
    lift = high;
  }

  const byte = (channel: number) =>
    Math.round((channel + (1 - channel) * lift) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

export interface DialoguePanel {
  /**
   * Draw an exchange, or pass null to take the panel away.
   *
   * The hint is what the key at the end of it does, which is not always the
   * same thing: a conversation that hands over a level where you stand ends
   * in a take-off rather than in being carried somewhere.
   */
  show(exchange: Exchange | null, voices?: Voices, hint?: string): void;
  dispose(): void;
}

export function createDialoguePanel(container: HTMLElement): DialoguePanel {
  const root = document.createElement('div');
  root.className = 'talk';
  root.hidden = true;
  container.appendChild(root);

  /**
   * Built out of nodes rather than a string of markup, for the same reason
   * the level menu is: the lines are ours today and are still going into the
   * page, and text set as text cannot be anything else.
   */
  function draw(exchange: Exchange, voices: Voices | undefined, hint: string) {
    root.replaceChildren();

    const card = document.createElement('div');
    card.className = 'talk-card';

    for (const said of exchange.said) {
      const line = document.createElement('p');
      line.className = said.who === 'them' ? 'talk-them' : 'talk-you';
      line.textContent = said.text;
      if (voices) line.style.color = said.who === 'them' ? voices.them : voices.you;
      card.appendChild(line);
    }

    if (isOver(exchange)) {
      const done = document.createElement('p');
      done.className = 'talk-hint';
      done.textContent = hint;
      card.appendChild(done);
    } else {
      exchange.replies.forEach((reply, index) => {
        const row = document.createElement('div');
        row.className = 'talk-reply';

        const number = document.createElement('b');
        number.textContent = String(index + 1);
        const text = document.createElement('span');
        text.textContent = reply.text;
        // What you might say is said in your own colour too: these are the
        // hero's words, waiting to be spoken.
        if (voices) row.style.color = voices.you;

        row.append(number, text);
        card.appendChild(row);
      });
    }

    root.appendChild(card);
  }

  return {
    show(exchange, voices, hint = 'press SPACE to fly on') {
      root.hidden = exchange === null;
      if (exchange) draw(exchange, voices, hint);
      else root.replaceChildren();
    },
    dispose() {
      root.remove();
    },
  };
}
