/**
 * Bake a real street network into a world file.
 *
 * Queries OpenStreetMap for the roads in a square around a point, projects
 * them into the simulation's local metres, simplifies the polylines and writes
 * a JSON asset. Run once and commit the result: the game never talks to a map
 * server, so it works offline and cannot be broken by someone else's rate limit.
 *
 *   npm run fetch-map -- --centre 47.4979,19.0402 --radius 1200 --name home
 *
 * OpenStreetMap data is ODbL. The baked file is a derived database, so it
 * carries the attribution and has to keep it.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const ATTRIBUTION = '© OpenStreetMap contributors (ODbL)';

/** Road classes worth flying over, and how wide to draw them, in metres. */
const ROAD_WIDTHS: Record<string, number> = {
  motorway: 24,
  trunk: 20,
  primary: 16,
  secondary: 13,
  tertiary: 11,
  unclassified: 8,
  residential: 8,
  living_street: 7,
  pedestrian: 6,
  motorway_link: 10,
  trunk_link: 9,
  primary_link: 9,
  secondary_link: 8,
  tertiary_link: 8,
};

interface Args {
  centre: [number, number];
  radius: number;
  name: string;
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag?.startsWith('--')) flags.set(flag.slice(2), argv[i + 1] ?? '');
  }

  const centre = (flags.get('centre') ?? flags.get('center') ?? '').split(',').map(Number);
  const radius = Number(flags.get('radius') ?? 1200);
  const name = flags.get('name') ?? 'map';

  if (centre.length !== 2 || centre.some((v) => !Number.isFinite(v))) {
    throw new Error('--centre must be "lat,lon", e.g. --centre 47.4979,19.0402');
  }
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('--radius must be metres');
  if (!/^[a-z0-9-]+$/i.test(name)) throw new Error('--name must be a plain identifier');

  return { centre: [centre[0]!, centre[1]!], radius, name };
}

/** Metres per degree at a latitude, on the WGS84 ellipsoid. */
function metresPerDegree(latitude: number): { lat: number; lon: number } {
  const phi = (latitude * Math.PI) / 180;
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi),
    lon: 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi) + 0.118 * Math.cos(5 * phi),
  };
}

/** Perpendicular distance from `p` to the line through `a` and `b`. */
function lineDistance(p: number[], a: number[], b: number[]): number {
  const dx = b[0]! - a[0]!;
  const dz = b[1]! - a[1]!;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 1e-12) return Math.hypot(p[0]! - a[0]!, p[1]! - a[1]!);

  const t = Math.max(0, Math.min(1, ((p[0]! - a[0]!) * dx + (p[1]! - a[1]!) * dz) / lengthSquared));
  return Math.hypot(p[0]! - (a[0]! + t * dx), p[1]! - (a[1]! + t * dz));
}

/** Ramer-Douglas-Peucker. Road detail below a metre or two is invisible here. */
function simplify(points: number[][], epsilon: number): number[][] {
  if (points.length < 3) return points;

  let worst = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const d = lineDistance(points[i]!, points[0]!, points[points.length - 1]!);
    if (d > worst) {
      worst = d;
      index = i;
    }
  }

  if (worst <= epsilon) return [points[0]!, points[points.length - 1]!];
  return [
    ...simplify(points.slice(0, index + 1), epsilon).slice(0, -1),
    ...simplify(points.slice(index), epsilon),
  ];
}

async function main() {
  const { centre, radius, name } = parseArgs(process.argv.slice(2));
  const [lat, lon] = centre;
  const perDegree = metresPerDegree(lat);

  const dLat = radius / perDegree.lat;
  const dLon = radius / perDegree.lon;
  const bbox = [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map((v) => v.toFixed(7)).join(',');

  const wanted = Object.keys(ROAD_WIDTHS).join('|');
  const query = `[out:json][timeout:180];way["highway"~"^(${wanted})$"](${bbox});out geom;`;

  process.stderr.write(`querying OpenStreetMap for ${radius} m around ${lat}, ${lon}\n`);
  const response = await fetch(OVERPASS, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // Overpass rejects anonymous clients, and their usage policy asks that
      // tools identify themselves.
      'User-Agent': 'pigeon-sim map baker (https://github.com/gitbonger/gamePlayground)',
    },
    body: new URLSearchParams({ data: query }),
  });
  if (!response.ok) throw new Error(`Overpass returned ${response.status} ${response.statusText}`);

  const payload = (await response.json()) as {
    elements: { tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }[];
  };

  const roads = [];
  let rawPoints = 0;
  for (const element of payload.elements) {
    const kind = element.tags?.['highway'];
    if (!kind || !element.geometry || element.geometry.length < 2) continue;

    const width = ROAD_WIDTHS[kind];
    if (width === undefined) continue;

    rawPoints += element.geometry.length;
    const projected = element.geometry.map((node) => [
      (node.lon - lon) * perDegree.lon,
      // North is -Z, matching the simulation's forward axis.
      -(node.lat - lat) * perDegree.lat,
    ]);

    const points = simplify(projected, 1.5).map((p) => [
      Math.round(p[0]! * 10) / 10,
      Math.round(p[1]! * 10) / 10,
    ]);
    if (points.length >= 2) roads.push({ kind, width, points });
  }

  const keptPoints = roads.reduce((total, road) => total + road.points.length, 0);
  const out = resolve(process.cwd(), 'src/world/data', `${name}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    `${JSON.stringify(
      {
        name,
        centre,
        radius,
        generated: new Date().toISOString(),
        attribution: ATTRIBUTION,
        roads,
      },
      null,
      0,
    )}\n`,
  );

  const kb = (Buffer.byteLength(JSON.stringify(roads)) / 1024).toFixed(0);
  process.stderr.write(
    `${roads.length} roads, ${keptPoints} points (from ${rawPoints}), ${kb} kB -> ${out}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
