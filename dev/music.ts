/** Every piece, on a button, with a meter so it is obvious it is playing. */
import { readSong } from '../src/render/midi';
import { createMusic, pieces } from '../src/render/music';

let meter: AnalyserNode | null = null;
// The music plays into a meter which plays into the speakers, so the numbers
// on the page are the actual output rather than a guess about it.
const music = createMusic(0.32, (ctx) => {
  meter ??= ctx.createAnalyser();
  meter.fftSize = 2048;
  meter.connect(ctx.destination);
  return meter;
});
const keys = document.querySelector('#keys')!;
const trace = document.querySelector('#trace')!;
const bar = document.querySelector('#meter div') as HTMLElement;

const buttons = new Map<string | null, HTMLButtonElement>();
for (const name of [...pieces(), null]) {
  const button = document.createElement('button');
  button.textContent = name ?? 'stop';
  button.addEventListener('click', () => {
    music.play(name);
    for (const [what, each] of buttons) each.classList.toggle('on', what === name);
  });
  buttons.set(name, button);
  keys.appendChild(button);
}

// What the parser made of each file, which is the half of this that can be
// checked without ears.
void Promise.all(
  pieces().map(async (name) => {
    const url = new URL(`../src/render/music/${name}.mid`, import.meta.url);
    const song = readSong(await fetch(url).then((r) => r.arrayBuffer()));
    const channels = [...new Set(song.notes.map((n) => n.channel))].sort();
    return `${name.padEnd(10)} ${String(song.notes.length).padStart(4)} notes  ` +
      `${song.length.toFixed(1)}s  ${song.bpm.toFixed(0)} bpm  ` +
      `channels ${channels.join(',')}`;
  }),
).then((lines) => {
  trace.textContent = lines.join('\n');
});

// So that "it is playing" is something you can see as well as hear -- and
// something a machine with no ears can read off the page.
let peak = 0;
setInterval(() => {
  if (!meter) return;
  const data = new Float32Array(meter.fftSize);
  meter.getFloatTimeDomainData(data);
  let loudest = 0;
  for (const sample of data) loudest = Math.max(loudest, Math.abs(sample));
  peak = Math.max(loudest, peak * 0.85);
  bar.style.width = `${Math.min(100, peak * 140)}%`;
  bar.dataset.peak = peak.toFixed(3);
}, 100);
