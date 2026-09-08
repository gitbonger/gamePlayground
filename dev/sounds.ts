/** Every ambient noise, on a button, so they can be heard rather than read. */
import { browserKit, createAmbience, type Noise, type Source } from '../src/render/ambience';

const kit = browserKit();
const keys = document.querySelector('#keys')!;
const trace = document.querySelector('#trace')!;

for (const noise of ['bark', 'coo', 'caw', 'bell', 'screech'] as Noise[]) {
  for (const [where, pan] of [['left', -1], ['middle', 0], ['right', 1]] as [string, number][]) {
    const button = document.createElement('button');
    button.textContent = `${noise} ${where}`;
    button.addEventListener('click', () => kit.play(noise, 1, pan));
    keys.appendChild(button);
  }
  keys.appendChild(document.createElement('br'));
}

// And the pacing, run at speed against a full street, so the rate can be read
// off rather than guessed at.
const run = document.createElement('button');
run.textContent = 'two minutes with everything nearby (silent)';
run.addEventListener('click', () => {
  const played: { at: number; noise: Noise }[] = [];
  const ambience = createAmbience({
    play: (noise) => played.push({ at: 0, noise }),
    close: () => {},
  });
  const all: Source[] = [
    { noise: 'bark', x: 8, z: 0 },
    { noise: 'coo', x: 6, z: 0 },
    { noise: 'caw', x: 10, z: 0 },
    { noise: 'bell', x: 20, z: 0 },
    { noise: 'screech', x: 30, z: 0 },
  ];
  for (let frame = 0; frame < 120 * 60; frame += 1) {
    ambience.hear(frame / 60, { x: 0, z: 0 }, 0, all);
  }
  const counts = new Map<Noise, number>();
  for (const each of played) counts.set(each.noise, (counts.get(each.noise) ?? 0) + 1);
  trace.textContent =
    `${played.length} sounds in 120 s -- one every ${(120 / played.length).toFixed(1)} s\n` +
    [...counts].map(([noise, n]) => `  ${noise}: ${n}`).join('\n');
});
keys.appendChild(run);
