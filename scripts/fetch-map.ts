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

/**
 * Track the world has to know about, and how wide a corridor to keep for it.
 *
 * The width is not the gauge -- it is the ground the railway occupies and
 * nothing may be built on. A tram shares the carriageway, so its corridor sits
 * inside a street that is already clear; heavy rail gets its own ground, and
 * the clearance either side of a running line is what stops houses being
 * generated across it.
 *
 * Everything else OpenStreetMap files under `railway` is left out: platforms
 * and ventilation shafts are not track, and `razed`, `abandoned` and `disused`
 * alignments are lines that are no longer there to see.
 */
const RAIL_WIDTHS: Record<string, number> = {
  rail: 8,
  light_rail: 7,
  narrow_gauge: 6,
  tram: 6,
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

/**
 * The smallest turned rectangle that covers a footprint.
 *
 * A building in the game is `{ x, z, width, depth, yaw }` -- a box on the
 * ground with a turn -- and a building in OpenStreetMap is a ring of ten or
 * twenty points. Rather than teach the game about polygons, the ring is
 * reduced to the box that best covers it, here, once, at bake time.
 *
 * That is a real loss and it is the right one. What it keeps is the thing
 * worth having: where the building actually is, which way it actually faces,
 * and how big it actually is. What it loses is the notch in the corner, and
 * nobody flying over a city at fifty metres has ever seen a notch. A block of
 * these is still a ring of buildings round a courtyard, because the real ones
 * are a ring of buildings round a courtyard.
 *
 * Rotating calipers, in the cheap form: the best rectangle shares an edge with
 * the hull, so every edge is tried and the smallest area wins. The rings here
 * are a dozen points, so trying all of them is nothing.
 */
function orientedBox(
  ring: number[][],
): { x: number; z: number; width: number; depth: number; yaw: number } | null {
  if (ring.length < 3) return null;

  let best: { area: number; yaw: number; cx: number; cz: number; w: number; d: number } | null =
    null;

  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const dx = b[0]! - a[0]!;
    const dz = b[1]! - a[1]!;
    if (Math.hypot(dx, dz) < 1e-6) continue;

    // The turn that puts this edge along the box's own X axis. The game's
    // convention -- Three.js's rotation.y, which `footprintSamples` and the
    // collider both follow -- takes a local (dx, dz) to
    // (x + dx*cos + dz*sin, z - dx*sin + dz*cos), so going the other way is
    // this.
    const yaw = Math.atan2(-dz, dx);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of ring) {
      const lx = p[0]! * cos - p[1]! * sin;
      const lz = p[0]! * sin + p[1]! * cos;
      if (lx < minX) minX = lx;
      if (lx > maxX) maxX = lx;
      if (lz < minZ) minZ = lz;
      if (lz > maxZ) maxZ = lz;
    }

    const w = maxX - minX;
    const d = maxZ - minZ;
    const area = w * d;
    if (!best || area < best.area) {
      // Back out of the box's frame into the world.
      const lx = (minX + maxX) / 2;
      const lz = (minZ + maxZ) / 2;
      best = { area, yaw, w, d, cx: lx * cos + lz * sin, cz: -lx * sin + lz * cos };
    }
  }

  if (!best) return null;
  return { x: best.cx, z: best.cz, width: best.w, depth: best.d, yaw: best.yaw };
}

/** Twice the signed area of a ring: positive or negative says which way round. */
function shoelace(ring: number[][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    sum += a[0]! * b[1]! - b[0]! * a[1]!;
  }
  return sum;
}

/** Whether a point is inside a ring, by the crossing count. */
function inside(x: number, z: number, ring: number[][]): boolean {
  let within = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (
      a[1]! > z !== b[1]! > z &&
      x < ((b[0]! - a[0]!) * (z - a[1]!)) / (b[1]! - a[1]!) + a[0]!
    ) {
      within = !within;
    }
  }
  return within;
}

/** How deep a wing of a courtyard block is, in metres. */
const WING = 12;

/**
 * A footprint as one box, or as a ring of wings when one box will not do.
 *
 * The box is the right answer for the great majority: a building is a
 * rectangle, near enough, and reducing it to one is what keeps this map to a
 * size a browser will download. It is the wrong answer for two shapes, and
 * this district is full of both -- the L, and the closed courtyard block whose
 * outline goes all the way round a hole.
 *
 * Reduced to one box, a courtyard block becomes a solid slab the size of the
 * whole block. Measured over this map, taking the box every time put fifty
 * percent of the ground under a building, which is roughly twice what a dense
 * European district actually is, and it filled in every courtyard in
 * Józsefváros -- which is the one thing about the place worth having.
 *
 * So the fit is checked. Where the box covers much more than the outline
 * encloses, the shape is a ring or an L, and what is emitted instead is a wing
 * along each side of it: exactly what the generator invents for a block, only
 * now standing where the real building stands.
 */
function fitBoxes(
  ring: number[][],
): { x: number; z: number; width: number; depth: number; yaw: number }[] {
  const box = orientedBox(ring);
  if (!box) return [];

  const enclosed = Math.abs(shoelace(ring)) / 2;
  // A rectangle scores 1. Anything up to about a half again is a building with
  // a bay or a chamfered corner, and the box is still the honest answer.
  if (enclosed > 0 && box.width * box.depth <= enclosed * 1.55) return [box];

  // Otherwise, wings. Which side of each edge is *into* the shape is asked
  // rather than worked out from the winding: a step inward from the middle of
  // the edge either lands inside the outline or it does not, and that is a
  // question with an answer.
  const wings: { x: number; z: number; width: number; depth: number; yaw: number }[] = [];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const run = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
    if (run < 7) continue;

    const ux = (b[0]! - a[0]!) / run;
    const uz = (b[1]! - a[1]!) / run;
    const midX = (a[0]! + b[0]!) / 2;
    const midZ = (a[1]! + b[1]!) / 2;

    let nx = -uz;
    let nz = ux;
    if (!inside(midX + nx * 0.5, midZ + nz * 0.5, ring)) {
      nx = -nx;
      nz = -nz;
    }
    // Still not inside either way: a sliver too thin to have an inside.
    if (!inside(midX + nx * 0.5, midZ + nz * 0.5, ring)) continue;

    wings.push({
      x: midX + nx * (WING / 2),
      z: midZ + nz * (WING / 2),
      width: run,
      depth: WING,
      yaw: Math.atan2(-uz, ux),
    });
  }

  // A shape that produced no usable wing is better as its box than as nothing.
  return wings.length > 0 ? wings : [box];
}

/**
 * How tall a building is, from whatever it says about itself.
 *
 * `height` in metres if it has one, otherwise storeys times a floor. Three and
 * a tenth is a Budapest floor: tall ground floors, tall rooms, and the number
 * that makes a five-storey block come out at the sixteen metres they actually
 * are. Nothing is invented -- a building that says nothing gets nothing, and
 * the game decides.
 */
function storeys(tags: Record<string, string>): number | null {
  const metres = Number.parseFloat(tags['height'] ?? '');
  if (Number.isFinite(metres) && metres > 1 && metres < 200) return metres;

  const levels = Number.parseFloat(tags['building:levels'] ?? '');
  if (Number.isFinite(levels) && levels >= 1 && levels < 60) {
    // Plus a roof, which the level count never includes.
    return levels * 3.1 + 1.4;
  }
  return null;
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

/**
 * Ask Overpass, and keep asking.
 *
 * The public instance answers when it feels like it: a big query gets a 504
 * as often as not, and the answer is to wait and ask again rather than to ask
 * for less. Falls back to a mirror, which is usually less busy.
 */
async function overpass(query: string, what: string): Promise<{ elements: OverpassElement[] }> {
  const endpoints = [OVERPASS, 'https://overpass.kumi.systems/api/interpreter'];
  let last = '';
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const endpoint = endpoints[(attempt - 1) % endpoints.length]!;
    process.stderr.write(`  ${what}: attempt ${attempt} (${new URL(endpoint).host})\n`);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // Overpass rejects anonymous clients, and their usage policy asks
          // that tools identify themselves.
          'User-Agent': 'pigeon-sim map baker (https://github.com/gitbonger/gamePlayground)',
        },
        body: new URLSearchParams({ data: query }),
      });
      if (response.ok) return (await response.json()) as { elements: OverpassElement[] };
      last = `${response.status} ${response.statusText}`;
    } catch (error) {
      last = String(error);
    }
    // Backing off rather than hammering: their usage policy asks for it, and a
    // server that just said "busy" means it.
    await new Promise((wake) => setTimeout(wake, attempt * 8000));
  }
  throw new Error(`Overpass would not answer for ${what}: ${last}`);
}

interface OverpassGeometry {
  lat: number;
  lon: number;
}

interface OverpassElement {
  type: string;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: OverpassGeometry[];
  members?: { role?: string; geometry?: OverpassGeometry[] }[];
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
  const track = Object.keys(RAIL_WIDTHS).join('|');
  process.stderr.write(`querying OpenStreetMap for ${radius} m around ${lat}, ${lon}\n`);

  // Three queries rather than one. The ways that make the ground are one
  // shape of question, seven and a half thousand building outlines are
  // another, and a few thousand nodes are a third -- and asking for all of it
  // at once means a single timeout loses the lot. Split, each can be retried
  // on its own.
  const payload = await overpass(
    `[out:json][timeout:180];(way["highway"~"^(${wanted})$"](${bbox});` +
      `way["railway"~"^(${track})$"](${bbox});${areaFilters});out geom;`,
    'roads, rails and green space',
  );

  const built = await overpass(
    `[out:json][timeout:240];(way["building"](${bbox});relation["building"](${bbox}););out geom;`,
    'buildings',
  );

  // Marked crossings only. Two thirds of the crossings here are painted --
  // zebra, or a signalled crossing, which is painted too -- and the rest are
  // a dropped kerb with nothing on the road to draw.
  const dotted = await overpass(
    `[out:json][timeout:180];(` +
      `node["highway"="crossing"]["crossing"~"^(marked|zebra|traffic_signals)$"](${bbox});` +
      `node["natural"="tree"](${bbox});` +
      `);out geom;`,
    'crossings and trees',
  );

  type Geometry = OverpassGeometry;

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
  const rails = [];
  const areas = [];
  let rawPoints = 0;

  for (const element of payload.elements) {
    const tags = element.tags ?? {};
    const highway = tags['highway'];
    const railway = tags['railway'];

    if (railway && RAIL_WIDTHS[railway] !== undefined) {
      // Underground, or no longer there: nothing to see from the air. The
      // metro here is 45 ways of tunnel, and there are 64 razed alignments.
      const buried = tags['tunnel'] || tags['location'] === 'underground';
      const gone = tags['razed'] || tags['abandoned'] || tags['disused'];
      if (buried || gone || !element.geometry || element.geometry.length < 2) continue;
      rawPoints += element.geometry.length;
      const points = toLocal(element.geometry, 1.5);
      if (points.length >= 2) {
        rails.push({ kind: railway, width: RAIL_WIDTHS[railway]!, points });
      }
      continue;
    }

    if (highway) {
      const width = ROAD_WIDTHS[highway];
      if (width === undefined || !element.geometry || element.geometry.length < 2) continue;
      // Underground, so there is no road here to see. The railway branch has
      // always dropped these and the road branch never did: eleven stretches
      // of this district were being painted on the surface where the street is
      // in fact under it, along with everything that follows from a street
      // being there -- a kerb nothing may be built on, and crossings laid
      // across a carriageway that is ten metres down.
      //
      // A bridge is the opposite case and is kept: it is a road, it is there,
      // and it is visible from the air. What is wrong with a bridge here is
      // only its height, and the ground in this game is flat.
      if (tags['tunnel'] || tags['covered'] === 'yes' || tags['location'] === 'underground') {
        continue;
      }
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

  // --- Buildings -----------------------------------------------------------
  // Every outline reduced to the turned box that covers it -- see
  // `orientedBox` for what that keeps and what it throws away.
  //
  // Written as bare arrays rather than named fields. There are seven and a
  // half thousand of them, and `{"x":-123.4,"z":56.7,...}` against
  // `[-123.4,56.7,...]` is three hundred kilobytes of the same numbers. The
  // order is written down where the type is.
  const buildings: (number | null)[][] = [];
  for (const element of built.elements) {
    const tags = element.tags ?? {};
    // Not a building: a wall, a fence, a bridge deck tagged as one.
    if (tags['building'] === 'no') continue;
    // Underground car parks and the like: nothing to see from the air.
    if (tags['location'] === 'underground') continue;

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
      // Barely thinned: the box is worked out from the ring, and thinning it
      // first would be throwing away the corners that decide the answer.
      const points = toLocal(ring, 0.4);
      const height = storeys(tags);
      for (const box of fitBoxes(points)) {
        // Sheds, bin stores and the odd one-metre sliver of a mis-drawn wall.
        if (box.width < 2.5 || box.depth < 2.5) continue;
        buildings.push([
          Math.round(box.x * 10) / 10,
          Math.round(box.z * 10) / 10,
          Math.round(box.width * 10) / 10,
          Math.round(box.depth * 10) / 10,
          Math.round(box.yaw * 1000) / 1000,
          height === null ? null : Math.round(height * 10) / 10,
        ]);
      }
    }
  }

  // --- Crossings and trees ---------------------------------------------------
  // Both are points, and both are stored as bare pairs for the same reason the
  // buildings are stored as arrays.
  const crossings: number[][] = [];
  const trees: number[][] = [];
  for (const element of dotted.elements) {
    if (element.lat === undefined || element.lon === undefined) continue;
    const at = [
      Math.round((element.lon - lon) * perDegree.lon * 10) / 10,
      Math.round(-(element.lat - lat) * perDegree.lat * 10) / 10,
    ];
    if (element.tags?.['natural'] === 'tree') trees.push(at);
    else crossings.push(at);
  }

  const keptPoints = [...roads, ...rails].reduce((total, way) => total + way.points.length, 0);
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
        rails,
        areas,
        buildings,
        crossings,
        trees,
      },
      null,
      0,
    )}\n`,
  );

  const kb = (
    Buffer.byteLength(JSON.stringify({ roads, rails, areas, buildings, crossings, trees })) / 1024
  ).toFixed(0);
  process.stderr.write(
    `${roads.length} roads and ${rails.length} railways (${keptPoints} points), ` +
      `${areas.length} green areas, ${buildings.length} buildings ` +
      `(${buildings.filter((b) => b[5] !== null).length} of them saying how tall), ` +
      `${crossings.length} crossings, ${trees.length} trees, ` +
      `${rawPoints} points before thinning, ${kb} kB -> ${out}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
