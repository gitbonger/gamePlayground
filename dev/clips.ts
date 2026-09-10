/** Every sound file the game can play, on a page, so they can be heard. */
const FILES = import.meta.glob('../src/render/sounds/*/*.mp3', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

type Credit = { file: string; from: string; lic: string; page: string };
const credits: Credit[] = await fetch('../src/render/sounds/credits.json')
  .then((r) => (r.ok ? r.json() : []))
  .catch(() => []);
const by = new Map(credits.map((c) => [c.file, c]));

const all = document.querySelector('#all')!;
const kinds = new Map<string, [string, string][]>();
for (const path of Object.keys(FILES).sort()) {
  const kind = path.split('/')[4] ?? '?';
  const name = path.split('/')[5] ?? path;
  (kinds.get(kind) ?? kinds.set(kind, []).get(kind)!).push([name, FILES[path]!]);
}

for (const [kind, clips] of kinds) {
  const head = document.createElement('h2');
  head.textContent = `${kind} — ${clips.length}`;
  all.appendChild(head);
  for (const [name, url] of clips) {
    const row = document.createElement('div');
    row.className = 'row';
    const player = document.createElement('audio');
    player.controls = true;
    player.preload = 'none';
    player.src = url;
    const what = document.createElement('div');
    what.className = 'what';
    const credit = by.get(`${kind}/${name}`);
    what.innerHTML = credit
      ? `<b>${name}</b> — ${credit.from} <a href="${credit.page}" target="_blank">[${credit.lic}]</a>`
      : `<b>${name}</b>`;
    row.append(player, what);
    all.appendChild(row);
  }
}
