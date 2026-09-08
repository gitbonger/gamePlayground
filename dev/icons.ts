/** Every icon on one page, at the size they are drawn and larger. */
import { drawIcon, ICONS, type IconName } from '../src/render/icons';

import { CAUTIONS, COURSES, createTipPanel } from '../src/render/tips';
import { startLanguage } from '../src/i18n';

startLanguage(null, ['en']);

const sheet = document.querySelector('#sheet')!;
for (const name of Object.keys(ICONS) as IconName[]) {
  const cell = document.createElement('div');
  cell.className = 'cell';
  cell.appendChild(drawIcon(name));
  const label = document.createElement('small');
  label.textContent = name;
  cell.append(label);
  sheet.appendChild(cell);
}

/**
 * And the panel itself, with real instructions in it.
 *
 * The sheet above says whether a picture is any good on its own; this says
 * whether it is any good beside the words, at the size the player sees, on
 * the panel it actually sits on -- which is a different question and the one
 * that matters.
 */
const strip = document.createElement('div');
strip.style.cssText = 'position:relative;padding:8px 0 40px;display:flex;flex-direction:column;gap:12px;align-items:center';
document.body.appendChild(strip);

const shown = [
  ...Object.values(COURSES).flat(),
  ...CAUTIONS,
];
for (const tip of shown) {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:relative;height:56px;width:100%';
  strip.appendChild(holder);
  const panel = createTipPanel(holder);
  panel.show(tip);
  // Out of the fixed corner and into the row, so they can be seen at once.
  const el = holder.querySelector('.tip') as HTMLElement;
  el.style.position = 'absolute';
  el.style.bottom = '6px';
}
