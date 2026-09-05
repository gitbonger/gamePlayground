/** The conversation panel: what has been said, and what you can say next. */

import { isOver, type Exchange } from '../dialogue';

export interface DialoguePanel {
  /** Draw an exchange, or pass null to take the panel away. */
  show(exchange: Exchange | null): void;
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
  function draw(exchange: Exchange) {
    root.replaceChildren();

    const card = document.createElement('div');
    card.className = 'talk-card';

    for (const said of exchange.said) {
      const line = document.createElement('p');
      line.className = said.who === 'them' ? 'talk-them' : 'talk-you';
      line.textContent = said.text;
      card.appendChild(line);
    }

    if (isOver(exchange)) {
      const done = document.createElement('p');
      done.className = 'talk-hint';
      done.textContent = 'press SPACE to fly on';
      card.appendChild(done);
    } else {
      exchange.replies.forEach((reply, index) => {
        const row = document.createElement('div');
        row.className = 'talk-reply';

        const number = document.createElement('b');
        number.textContent = String(index + 1);
        const text = document.createElement('span');
        text.textContent = reply.text;

        row.append(number, text);
        card.appendChild(row);
      });
    }

    root.appendChild(card);
  }

  return {
    show(exchange) {
      root.hidden = exchange === null;
      if (exchange) draw(exchange);
      else root.replaceChildren();
    },
    dispose() {
      root.remove();
    },
  };
}
