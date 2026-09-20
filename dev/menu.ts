/**
 * The level list, on its own page.
 *
 * The one part of the game's own screen that cannot be looked at while the
 * game is running: it opens on a letter key, and synthetic keys do not reach
 * the game -- so every change to it was being made blind. `?tab=1` opens it
 * on the second game, `?at=7` marks the seventh level as the one being
 * played, which is what decides which tab it opens on.
 */
import { createLevelMenu } from '../src/render/menu';
import { LEVELS, LEVEL_TAGS, modeOf } from '../src/levels';
import { startLanguage } from '../src/i18n';

startLanguage(null, ['en']);

const params = new URLSearchParams(location.search);
const at = Number(params.get('at') ?? 0);

const menu = createLevelMenu(
  document.querySelector('#overlay')!,
  LEVELS.map((spec, index) => ({ name: spec.name, tag: LEVEL_TAGS[index], mode: modeOf(spec) })),
  () => {},
  () => {},
);

menu.toggle(at, { title: 'REALISTIC', says: 'wind, and a wing that can stall' });
// And onto whichever tab was asked for, as the arrows would.
menu.step(Number(params.get('tab') ?? 0));
