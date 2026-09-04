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

import { metresPerDegree } from '../src/world/geo';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const ATTRIBUTION = '© OpenStreetMap contributors (ODbL)';

/**
 * Green space and water, which nobody builds houses in.
 *
 * Mapped to a coarse kind rather than kept as raw tags: the world generator
 * only needs to know "this ground is spoken for", and the renderer only needs
 * to know what colour it is.
 */
const AREA_KINDS: Record<string, Record<string, 'park' | 'wood' | 'water' | 'pitch'>> = {
  leisure: {
    park: 'park',
    garden: 'park',
    common: 'park',
    dog_park: 'park',
    nature_reserve: 'wood',
    recreation_ground: 'park',
    playground: 'pitch',
    pitch: 'pitch',
  },
  landuse: {
    grass: 'park',
    village_green: 'park',
    recreation_ground: 'park',
    meadow: 'park',
    cemetery: 'park',
    allotments: 'park',
    greenfield: 'park',
    forest: 'wood',
  },
  natural: {
    wood: 'wood',
    scrub: 'wood',
    grassland: 'park',
    water: 'water',
  },
};

/** Overpass filter for one tag key, as an alternation of its values. */
const alternation = (key: string) => `["${key}"~"^(${Object.keys(AREA_KINDS[key]!).join('|')})$"]`;

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
  const areaFilters = Object.keys(AREA_KINDS)
    .flatMap((key) => [`way${alternation(key)}(${bbox});`, `relation${alternation(key)}(${bbox});`])
    .join('');
  const query =
    `[out:json][timeout:180];(way["highway"~"^(${wanted})$"](${bbox});${areaFilters});out geom;`;

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

  interface Geometry {
    lat: number;
    lon: number;
  }
  const payload = (await response.json()) as {
    elements: {
      type: string;
      tags?: Record<string, string>;
      geometry?: Geometry[];
      members?: { role?: string; geometry?: Geometry[] }[];
    }[];
  };

  /** Project and thin a run of nodes. */
  const toLocal = (nodes: Geometry[], epsilon: number) =>
    simplify(
      nodes.map((node) => [
        (node.lon - lon) * perDegree.lon,
        // North is -Z, matching the simulation's forward axis.
        -(node.lat - lat) * perDegree.lat,
      ]),
      epsilon,
    ).map((p) => [Math.round(p[0]! * 10) / 10, Math.round(p[1]! * 10) / 10]);

  /** The coarse kind for an element's tags, if it is green space or water. */
  function areaKind(tags: Record<string, string>): string | null {
    for (const [key, values] of Object.entries(AREA_KINDS)) {
      const value = tags[key];
      if (value && values[value]) return values[value]!;
    }
    return null;
  }

  const roads = [];
  const areas = [];
  let rawPoints = 0;

  for (const element of payload.elements) {
    const tags = element.tags ?? {};
    const highway = tags['highway'];

    if (highway) {
      const width = ROAD_WIDTHS[highway];
      if (width === undefined || !element.geometry || element.geometry.length < 2) continue;
      rawPoints += element.geometry.length;
      const points = toLocal(element.geometry, 1.5);
      if (points.length >= 2) roads.push({ kind: highway, width, points });
      continue;
    }

    const kind = areaKind(tags);
    if (!kind) continue;

    // A closed way is a ring on its own. A relation's outer members are each
    // treated as a ring, which ignores holes -- there are few of them, and an
    // over-large park only costs a handful of houses that were never there.
    const rings =
      element.type === 'relation'
        ? (element.members ?? [])
            .filter((member) => member.role !== 'inner' && member.geometry)
            .map((member) => member.geometry!)
        : element.geometry
          ? [element.geometry]
          : [];

    for (const ring of rings) {
      if (ring.length < 4) continue;
      rawPoints += ring.length;
      const points = toLocal(ring, 2.5);
      if (points.length >= 3) areas.push({ kind, points });
    }
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
        areas,
      },
      null,
      0,
    )}\n`,
  );

  const kb = (Buffer.byteLength(JSON.stringify({ roads, areas })) / 1024).toFixed(0);
  process.stderr.write(
    `${roads.length} roads (${keptPoints} points), ${areas.length} green areas, ` +
      `${rawPoints} points before thinning, ${kb} kB -> ${out}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
