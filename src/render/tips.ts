/**
 * One instruction at a time, in the corner: the keys, and what they do.
 *
 * The controls are currently a block of a dozen lines in the top left, which
 * is a reference card rather than teaching -- it is read once, at the moment
 * the player knows least about what any of it means, and then it sits there.
 * This is the other way round: one thing, at the moment that thing is the
 * thing to do.
 *
 * A tip is some keys and a few words, and it says nothing the panel itself
 * already says. The keycap is a picture of the key, so "press" is a word the
 * text does not have to spend.
 */

export interface Tip {
  /** The keys to press, in the order they are shown. */
  keys: readonly string[];
  /** What pressing them does, as an instruction rather than a description. */
  text: string;
}

export interface TipPanel {
  /** Show a tip, or pass null to take the panel away. */
  show(tip: Tip | null): void;
  dispose(): void;
}

export function createTipPanel(container: HTMLElement): TipPanel {
  const root = document.createElement('div');
  root.className = 'tip';
  root.hidden = true;
  container.appendChild(root);

  /** What is on screen, so an unchanged tip is not rebuilt every frame. */
  let showing: string | null = null;

  return {
    show(tip) {
      const wanted = tip ? `${tip.keys.join('+')} ${tip.text}` : null;
      if (wanted === showing) return;
      showing = wanted;

      root.hidden = tip === null;
      root.replaceChildren();
      if (!tip) return;

      for (const key of tip.keys) {
        const cap = document.createElement('b');
        cap.className = 'tip-key';
        cap.textContent = key;
        root.appendChild(cap);
      }

      const said = document.createElement('span');
      said.className = 'tip-text';
      said.textContent = tip.text;
      root.appendChild(said);
    },
    dispose() {
      root.remove();
    },
  };
}
