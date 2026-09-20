import { it } from 'vitest';
import map from './data/home.json';
import { buildLayoutFromMap, defaultMapWorldOptions } from './from-map';
import { buildWorld } from './city';
import type { MapData } from './streets';

(globalThis as { document?: unknown }).document = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      fillStyle: '', strokeStyle: '', lineWidth: 0, font: '', textAlign: '', textBaseline: '',
      fillRect() {}, strokeRect() {}, fillText() {},
      measureText: (text: string) => ({ width: text.length * 8 }),
      createRadialGradient: () => ({ addColorStop() {} }),
    }),
  }),
};

const gc = (globalThis as unknown as { gc?: () => void }).gc;
const live = () => { gc?.(); gc?.(); return Math.round(process.memoryUsage().heapUsed / 1e6); };
const now = () => Math.round(process.memoryUsage().heapUsed / 1e6);
const say = (line: string) => process.stderr.write(`${line}\n`);

it('measures what building the world costs', () => {
  const before = live();
  const layout = buildLayoutFromMap(map as unknown as MapData, defaultMapWorldOptions);
  say(`layout:  live ${live() - before} MB`);
  const middle = now();
  const world = buildWorld(layout, { smoke: 200 });
  say(`world:   ${now() - middle} MB of rubbish, ${now()} MB in hand`);
  layout.plans = undefined;
  layout.boxes.length = 0;
  say(`freed:   live ${live() - before} MB`);
  void world;
}, 600000);
