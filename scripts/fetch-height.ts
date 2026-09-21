/**
 * The shape of the ground, fetched once and baked into the map file.
 *
 * Budapest is two cities and only one of them is flat. Pest, where every
 * level is, moves by three or four metres across the whole district; the Buda
 * side across the river climbs a hundred and thirty, and until now it was
 * painted on the same tabletop as everything else.
 *
 * The source is the public terrarium tiles -- SRTM and friends, packed into
 * PNGs where a pixel's colour *is* its height: `(R * 256 + G + B / 256) -
 * 32768` metres. No key, no account, and one zoom level covers the map in a
 * handful of tiles.
 *
 * What is written is a grid, not the tiles: heights every `step` metres over
 * the map's box, in local metres, **measured from the map centre** so that
 * Pest stays at nought and nothing that was written for a flat world has to
 * be told a new number. It rides in the map file beside the roads, and this
 * script only touches that one key -- so it can be rerun after the city is
 * fetched, or the city refetched without it.
 *
 *   npx tsx scripts/fetch-height.ts --name home [--step 25]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

import { metresPerDegree } from '../src/world/geo';

/** The zoom the tiles are read at: about thirteen metres a pixel here. */
const ZOOM = 13;
const TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

/**
 * A PNG, as its pixels.
 *
 * Only what the tiles are: eight bits a channel, RGB or RGBA, not interlaced.
 * Every other sort throws rather than coming back wrong, and pulling in a
 * library to decode four kinds of image where one is needed is not a trade
 * this project makes.
 */
function decodePng(data: Buffer): { width: number; height: number; pixels: Buffer; channels: number } {
  if (data.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let at = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const parts: Buffer[] = [];
  while (at < data.length) {
    const length = data.readUInt32BE(at);
    const kind = data.toString('ascii', at + 4, at + 8);
    const body = data.subarray(at + 8, at + 8 + length);
    if (kind === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body.readUInt8(8);
      const colour = body.readUInt8(9);
      if (depth !== 8 || (colour !== 2 && colour !== 6) || body.readUInt8(12) !== 0) {
        throw new Error(`unexpected PNG: depth ${depth}, colour ${colour}`);
      }
      channels = colour === 2 ? 3 : 4;
    } else if (kind === 'IDAT') parts.push(body);
    else if (kind === 'IEND') break;
    at += 12 + length;
  }

  // Un-filter. Each row says how it was written: as it is, as a difference
  // from the pixel to its left, from the one above, from the average of the
  // two, or from Paeth's pick of the three.
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const from = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[from + x]!;
      const left = x >= channels ? pixels[y * stride + x - channels]! : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x]! : 0;
      const upLeft = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels]! : 0;
      let add = 0;
      if (filter === 1) add = left;
      else if (filter === 2) add = up;
      else if (filter === 3) add = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const dl = Math.abs(p - left);
        const du = Math.abs(p - up);
        const dul = Math.abs(p - upLeft);
        add = dl <= du && dl <= dul ? left : du <= dul ? up : upLeft;
      } else if (filter !== 0) throw new Error(`unknown PNG row filter ${filter}`);
      pixels[y * stride + x] = (value + add) & 0xff;
    }
  }
  return { width, height, pixels, channels };
}

const tileOf = (lat: number, lon: number, zoom: number) => {
  const n = 2 ** zoom;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  return { x, y };
};

async function main() {
  const flags = new Map<string, string>();
  const argv = process.argv.slice(2);
  argv.forEach((flag, i) => {
    if (flag.startsWith('--')) flags.set(flag.slice(2), argv[i + 1] ?? '');
  });
  const name = flags.get('name') ?? 'home';
  const step = Number(flags.get('step') ?? 25);
  const file = resolve(process.cwd(), 'src/world/data', `${name}.json`);
  const map = JSON.parse(readFileSync(file, 'utf8')) as {
    centre: [number, number];
    radius: number;
    west?: number;
    north?: number;
    south?: number;
    ground?: unknown;
  };
  const [lat, lon] = map.centre;
  const perDegree = metresPerDegree(lat);
  const west = map.west ?? map.radius;
  const north = map.north ?? map.radius;
  const south = map.south ?? map.radius;

  // The same box the city was fetched for, in local metres: north is -Z.
  const box = { west: -west, east: map.radius, north: -north, south };
  const cols = Math.ceil((box.east - box.west) / step) + 1;
  const rows = Math.ceil((box.south - box.north) / step) + 1;
  process.stderr.write(`sampling ${cols} x ${rows} heights, ${step} m apart, at zoom ${ZOOM}\n`);

  const tiles = new Map<string, { width: number; height: number; pixels: Buffer; channels: number }>();
  const tileAt = async (tx: number, ty: number) => {
    const key = `${tx}/${ty}`;
    const had = tiles.get(key);
    if (had) return had;
    const url = `${TILES}/${ZOOM}/${tx}/${ty}.png`;
    const answer = await fetch(url);
    if (!answer.ok) throw new Error(`${url}: ${answer.status}`);
    const tile = decodePng(Buffer.from(await answer.arrayBuffer()));
    tiles.set(key, tile);
    return tile;
  };

  /** The height at one place, from the pixel it falls in. */
  const heightAt = async (x: number, z: number) => {
    const at = tileOf(lat - (z * 1) / perDegree.lat, lon + x / perDegree.lon, ZOOM);
    const tile = await tileAt(Math.floor(at.x), Math.floor(at.y));
    const px = Math.min(tile.width - 1, Math.floor((at.x % 1) * tile.width));
    const py = Math.min(tile.height - 1, Math.floor((at.y % 1) * tile.height));
    const from = (py * tile.width + px) * tile.channels;
    const r = tile.pixels[from]!;
    const g = tile.pixels[from + 1]!;
    const b = tile.pixels[from + 2]!;
    return r * 256 + g + b / 256 - 32768;
  };

  const datum = await heightAt(0, 0);
  const heights: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const metres = await heightAt(box.west + col * step, box.north + row * step);
      heights.push(Math.round((metres - datum) * 10) / 10);
    }
  }

  // Not Math.min(...heights): a hundred and fifty thousand arguments is more
  // than a call frame holds.
  let low = Infinity;
  let high = -Infinity;
  for (const height of heights) {
    if (height < low) low = height;
    if (height > high) high = height;
  }
  process.stderr.write(
    `${tiles.size} tiles, ${heights.length} heights, ` +
      `${low.toFixed(0)} m to ${high.toFixed(0)} m about the centre (${datum.toFixed(0)} m above the sea)\n`,
  );

  // Written back into the map file, and nothing else in it touched: the city
  // takes ten minutes to fetch and this takes ten seconds.
  const text = readFileSync(file, 'utf8');
  const ground = {
    step,
    west: box.west,
    north: box.north,
    cols,
    rows,
    datum: Math.round(datum * 10) / 10,
    heights,
  };
  const updated = JSON.parse(text) as Record<string, unknown>;
  updated['ground'] = ground;
  writeFileSync(file, `${JSON.stringify(updated)}\n`);
  process.stderr.write(`-> ${file}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error}\n`);
  process.exit(1);
});
