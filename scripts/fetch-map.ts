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
import { orientedBox } from '../src/world/plans';
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
 * alignments are lines that are no longer there to see. Tram platforms do come
 * down, as `stops` -- see the furniture query -- but as things standing beside
 * a railway rather than as railway.
 */
/**
 * How finely a building outline is kept, in metres.
 *
 * Six tenths. The corners are the whole point of keeping the outline at all,
 * so this is a good deal finer than the metre and a half the roads get -- but
 * a building drawn to the centimetre is a quarter of a megabyte of detail
 * nobody flying over it at fifty metres can see.
 */
const PLAN_DETAIL = 0.6;

const RAIL_WIDTHS: Record<string, number> = {
  rail: 8,
  light_rail: 7,
  narrow_gauge: 6,
  tram: 6,
};

/**
 * The brands a Jozsefvaros local steers by, and nothing else.
 *
 * The district has 3,623 named shops in it. Signing them all would be
 * wallpaper: what makes a sign useful is that you recognise it from three
 * hundred metres without reading it, which is a property of a chain and not
 * of a name. Groceries and fuel, because those are the ones on every corner
 * and in everybody's head -- 88 of them here, against 504 branded things of
 * every sort and three and a half thousand named ones.
 */
const SIGNED_SHOPS = 'supermarket|convenience|department_store|mall|doityourself';

/**
 * What sort of place of worship a building is, as one number.
 *
 * Three shapes rather than one: a parish church gets a tower and a spire, a
 * chapel a bellcote, a synagogue a dome. They are what a district is
 * navigated by from the air -- there are 39 of them here and they are the
 * only tall thing on most of these blocks -- and drawing all three the same
 * would be putting a spire on a synagogue.
 */
const WORSHIP = ['church', 'chapel', 'synagogue'] as const;

function worshipKind(tags: Record<string, string>): number | null {
  const building = tags['building'];
  if (tags['religion'] === 'jewish' || building === 'synagogue') return 2;
  if (building === 'chapel') return 1;
  if (building === 'church' || building === 'cathedral' || building === 'temple') return 0;
  // Tagged only as a place of worship, with nothing said about the building.
  // A church until told otherwise: that is what most of them are.
  if (tags['amenity'] === 'place_of_worship') return 0;
  return null;
}


/**
 * A relation's outer members joined end to end into closed rings.
 *
 * A park is usually one closed way and needs none of this. The river is the
 * reason it exists: the Danube is a multipolygon whose outer ring is filed as
 * two dozen open ways -- stretches of each bank, and a line across the water
 * at either end of the section -- and taken one at a time they are not areas
 * at all but the banks drawn as slivers. Joined, they are the river.
 *
 * Anything that will not close is handed back as it came, which is what the
 * old code did with everything.
 */
function assembleRings(members: OverpassGeometry[][]): OverpassGeometry[][] {
  const at = (p: OverpassGeometry) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;
  const closed = (ring: OverpassGeometry[]) => at(ring[0]!) === at(ring[ring.length - 1]!);
  const pool = members.filter((member) => member.length >= 2);
  const rings: OverpassGeometry[][] = [];
  while (pool.length) {
    let ring = pool.shift()!;
    for (let joined = true; joined && !closed(ring); ) {
      joined = false;
      for (let i = 0; i < pool.length; i += 1) {
        const way = pool[i]!;
        const head = at(ring[0]!);
        const tail = at(ring[ring.length - 1]!);
        if (at(way[0]!) === tail) ring = [...ring, ...way.slice(1)];
        else if (at(way[way.length - 1]!) === tail) ring = [...ring, ...way.slice(0, -1).reverse()];
        else if (at(way[way.length - 1]!) === head) ring = [...way.slice(0, -1), ...ring];
        else if (at(way[0]!) === head) ring = [...way.slice(1).reverse(), ...ring];
        else continue;
        pool.splice(i, 1);
        joined = true;
        break;
      }
    }
    rings.push(ring);
  }
  return rings;
}

/** The map's edges in degrees, with a margin so nothing stops short of them. */
interface Box {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * A ring cut down to the box, by Sutherland and Hodgman.
 *
 * The Danube's section polygon runs from Csepel to the Margaret bridge,
 * fourteen kilometres of river for a map three of them tall, and the far end
 * of it is water nobody will ever fly over. Cut to the edges it is the river
 * you can see and nothing else. A ring wholly outside comes back empty.
 */
function clipRing(ring: OverpassGeometry[], box: Box): OverpassGeometry[] {
  const inside = (p: OverpassGeometry, side: keyof Box) =>
    side === 'south' ? p.lat >= box.south
    : side === 'north' ? p.lat <= box.north
    : side === 'west' ? p.lon >= box.west
    : p.lon <= box.east;
  const cross = (a: OverpassGeometry, b: OverpassGeometry, side: keyof Box): OverpassGeometry => {
    const vertical = side === 'south' || side === 'north';
    const edge = box[side];
    const t = vertical ? (edge - a.lat) / (b.lat - a.lat) : (edge - a.lon) / (b.lon - a.lon);
    return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
  };

  let out = ring;
  for (const side of ['south', 'north', 'west', 'east'] as (keyof Box)[]) {
    const kept: OverpassGeometry[] = [];
    for (let i = 0; i < out.length; i += 1) {
      const a = out[i]!;
      const b = out[(i + 1) % out.length]!;
      if (inside(a, side)) {
        kept.push(a);
        if (!inside(b, side)) kept.push(cross(a, b, side));
      } else if (inside(b, side)) {
        kept.push(cross(a, b, side));
      }
    }
    out = kept;
    if (!out.length) return out;
  }
  return out;
}


interface Args {
  centre: [number, number];
  radius: number;
  /** How far the map reaches west and north of the centre, where that is not the radius. */
  west: number;
  north: number;
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
  // The city is not the same in every direction. Budapest's one unmissable
  // thing is the river, and the river is four and a half kilometres west of
  // a map centred on Jozsefvaros -- so the box can be stretched that way
  // without carrying the same distance of suburb on the other three sides.
  const west = Number(flags.get('west') ?? radius);
  const north = Number(flags.get('north') ?? radius);
  const name = flags.get('name') ?? 'map';

  if (centre.length !== 2 || centre.some((v) => !Number.isFinite(v))) {
    throw new Error('--centre must be "lat,lon", e.g. --centre 47.4979,19.0402');
  }
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('--radius must be metres');
  if (!Number.isFinite(west) || west < radius) throw new Error('--west must be metres, and at least the radius');
  if (!Number.isFinite(north) || north < radius) throw new Error('--north must be metres, and at least the radius');
  if (!/^[a-z0-9-]+$/i.test(name)) throw new Error('--name must be a plain identifier');

  return { centre: [centre[0]!, centre[1]!], radius, west, north, name };
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
  /**
   * Where a way or relation sits, from `out center`.
   *
   * A shop is often a node and often the outline of the shop unit, and a
   * church is nearly always an outline. One point either way is all this
   * needs: a sign is stood on whatever building is under it.
   */
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
  geometry?: OverpassGeometry[];
  members?: { role?: string; geometry?: OverpassGeometry[] }[];
}

async function main() {
  const { centre, radius, west, north, name } = parseArgs(process.argv.slice(2));
  const [lat, lon] = centre;
  const perDegree = metresPerDegree(lat);

  const dLat = radius / perDegree.lat;
  const dLon = radius / perDegree.lon;
  const dWest = west / perDegree.lon;
  const dNorth = north / perDegree.lat;
  const box = { south: lat - dLat, west: lon - dWest, north: lat + dNorth, east: lon + dLon };
  // Ground is cut to a little outside the box: the edge of the world is a
  // place nobody flies to, and a river that stopped exactly at it would show
  // a straight bank where the map ends.
  const margin = { lat: 150 / perDegree.lat, lon: 150 / perDegree.lon };
  const edges: Box = {
    south: box.south - margin.lat,
    west: box.west - margin.lon,
    north: box.north + margin.lat,
    east: box.east + margin.lon,
  };
  const bbox = [box.south, box.west, box.north, box.east].map((v) => v.toFixed(7)).join(',');

  const wanted = Object.keys(ROAD_WIDTHS).join('|');
  const areaFilters = Object.keys(AREA_KINDS)
    .flatMap((key) => [`way${alternation(key)}(${bbox});`, `relation${alternation(key)}(${bbox});`])
    .join('');
  const track = Object.keys(RAIL_WIDTHS).join('|');
  process.stderr.write(
    `querying OpenStreetMap for ${radius} m around ${lat}, ${lon}` +
      `${west === radius ? '' : `, ${west} m west`}` +
      `${north === radius ? '' : `, ${north} m north`}\n`,
  );

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
      // A tram stop is two things and both are wanted.
      //
      // The island is the thing you can see: a way along the kerb, which is
      // what gets built. But only two thirds of them are named, and a third
      // of the stops in this district have no island at all -- the tram
      // pulls up and you step off into the road, which is most of Népszínház
      // utca.
      //
      // The node is the stop itself: on the track, one per direction, and
      // named every time. Thirty names against the ways' twenty-one, and it
      // is the node that says a service calls here.
      //
      // Both ride along with the rest of the street furniture rather than in
      // a query of their own: it is a hundred and thirty elements, and a
      // round trip costs more than they do.
      `way["public_transport"="platform"]["tram"="yes"](${bbox});` +
      `node["railway"="tram_stop"](${bbox});` +
      `);out geom;`,
    'crossings, trees and tram platforms',
  );

  // The handful of places worth putting a name on, and the churches. Both are
  // points: a sign is stood on whatever building turns out to be under it and
  // a spire is put on whatever building turns out to be the church, which is
  // work for the world builder rather than for a fetch -- it is the end that
  // knows where the buildings ended up.
  const marked = await overpass(
    `[out:json][timeout:180];(` +
      `nwr["shop"~"^(${SIGNED_SHOPS})$"]["brand"](${bbox});` +
      `nwr["amenity"="fuel"]["brand"](${bbox});` +
      `nwr["amenity"="place_of_worship"](${bbox});` +
      `way["building"~"^(church|chapel|cathedral|synagogue|temple)$"](${bbox});` +
      `);out center tags;`,
    'shop signs and churches',
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
  const bridges = [];
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
      if (tags['tunnel'] || tags['covered'] === 'yes' || tags['location'] === 'underground') {
        continue;
      }
      rawPoints += element.geometry.length;
      const points = toLocal(element.geometry, 1.5);
      if (points.length < 2) continue;

      // A bridge is the opposite case, and it is the one place where flat
      // ground is plainly a lie: Kerepesi ut crosses the throat of Keleti
      // station on a flyover, and painted flat it is a road drawn across four
      // running lines with trains sliding through it. Filed separately, with
      // the storey the map puts it on, so the world can lift it.
      //
      // `area=yes` is not a bridge for this purpose. It is how the map files
      // the raised deck outside Keleti -- a floor, a closed way, a thing with
      // no two ends to ramp between -- and it is better left painted flat.
      // Which way it is driven. Most of the big streets here are one way --
      // a körút is two carriageways with the tram between them, and each is
      // its own way in the map -- and `-1` means the way is drawn against the
      // traffic, so the points are turned round and everything downstream can
      // take "one way" to mean "the way the points run".
      const oneway =
        /^(yes|true|1|-1|reverse)$/.test(tags['oneway'] ?? '') ||
        (tags['oneway'] !== 'no' && /^(roundabout|circular)$/.test(tags['junction'] ?? ''));
      if (oneway && /^(-1|reverse)$/.test(tags['oneway'] ?? '')) points.reverse();

      if (tags['bridge'] && tags['bridge'] !== 'no' && tags['area'] !== 'yes') {
        bridges.push({ kind: highway, width, points, layer: Number(tags['layer'] ?? 1) || 1, ...(oneway ? { oneway } : {}) });
        continue;
      }
      roads.push({ kind: highway, width, points, ...(oneway ? { oneway } : {}) });
      continue;
    }

    const kind = areaKind(tags);
    if (!kind) continue;

    // A closed way is a ring on its own; a relation's outer members are
    // joined into one. Holes are ignored -- there are few of them, and an
    // over-large park only costs a handful of houses that were never there.
    const rings =
      element.type === 'relation'
        ? assembleRings(
            (element.members ?? [])
              .filter((member) => member.role !== 'inner' && member.geometry)
              .map((member) => member.geometry!),
          )
        : element.geometry
          ? [element.geometry]
          : [];

    for (const whole of rings) {
      if (whole.length < 4) continue;
      rawPoints += whole.length;
      const ring = clipRing(whole, edges);
      if (ring.length < 3) continue;
      const points = toLocal(ring, 2.5);
      if (points.length >= 3) areas.push({ kind, points });
    }
  }

  // --- Buildings -----------------------------------------------------------
  /**
   * Every building as the outline the map drew, not as a box covering it.
   *
   * `[height, x0, z0, x1, z1, ...]`, with `height` null where the building
   * does not say how tall it is, and the ring not closed -- the last point
   * does not repeat the first.
   *
   * Bare arrays for the same reason everything else here is: this is a
   * generated file with nine thousand of these in it, and the names would be
   * a quarter of a megabyte of the same two letters.
   *
   * It used to be a box per building, worked out here. A box is what the
   * collider wants and it is still what the collider gets -- but it is
   * derived on the way in now, from this, so that the thing drawn and the
   * thing flown into come from one outline. Baking the box and throwing the
   * outline away meant every L-plan corner house and every block with a
   * courtyard notch was drawn as the rectangle round it, and 1,605 of them
   * stood in the road.
   */
  const plans: (number | null)[][] = [];
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

    const height = storeys(tags);
    for (const ring of rings) {
      if (ring.length < 4) continue;
      rawPoints += ring.length;
      const points = toLocal(ring, PLAN_DETAIL);
      // A ring comes closed, with its last node the same as its first. Kept
      // that way it is a zero-length wall, and every consumer would have to
      // remember to skip it.
      const first = points[0]!;
      const last = points[points.length - 1]!;
      if (points.length > 1 && Math.hypot(first[0]! - last[0]!, first[1]! - last[1]!) < 0.01) {
        points.pop();
      }
      if (points.length < 3) continue;

      // Sheds, bin stores and the odd one-metre sliver of a mis-drawn wall.
      const box = orientedBox(points);
      if (!box || box.width < 2.5 || box.depth < 2.5) continue;

      const flat: (number | null)[] = [height === null ? null : Math.round(height * 10) / 10];
      for (const [x, z] of points) {
        flat.push(Math.round(x! * 10) / 10, Math.round(z! * 10) / 10);
      }
      plans.push(flat);
    }
  }

  // --- Crossings and trees ---------------------------------------------------
  // Both are points, and both are stored as bare pairs for the same reason the
  // buildings are stored as arrays.
  const crossings: number[][] = [];
  const trees: number[][] = [];
  /**
   * Tram platforms, as flat runs of `x, z` the way a building plan is.
   *
   * Kept as drawn rather than reduced to a box here. Six of the fifty are
   * closed rings -- a depot yard, the island under the Erzsébet királyné útja
   * underpass -- and which ones those are is not a fact this end should be
   * making decisions about. The world builder measures them, and it is the
   * end that knows where the track ended up.
   */
  /**
   * The islands, as flat runs of `x, z` the way a building plan is.
   *
   * Kept as drawn rather than reduced to a box here. Six of them are closed
   * rings -- a depot yard, the island under the Erzsébet királyné útja
   * underpass -- and which ones those are is not a fact this end should be
   * making decisions about. The world builder measures them, and it is the
   * end that knows where the track ended up.
   *
   * Unnamed on purpose: two thirds of them carry a name and it is the same
   * name the stop beside them carries. One list of names, on the stops.
   */
  const islands: number[][] = [];
  /** Where a tram calls, as `[x, z]`: on the track, one per direction. */
  const stops: number[][] = [];
  /**
   * What each of those is called, in step with `stops`.
   *
   * A separate list rather than a field, because a stop is a pair of numbers
   * and one string in the middle of it would cost every reader a special
   * case. Never empty in practice -- every tram stop on this map is named,
   * which is the reason these are here and the islands are not.
   */
  const stopNames: string[] = [];
  for (const element of dotted.elements) {
    if (element.type === 'way') {
      if (!element.geometry || element.geometry.length < 2) continue;
      rawPoints += element.geometry.length;
      // Half a metre, which is finer than a road gets: a platform is two and
      // a half metres wide and thinning it at a road's metre and a half would
      // straighten the very corners that say how long it is.
      const points = toLocal(element.geometry, 0.5);
      if (points.length < 2) continue;
      islands.push(points.flatMap(([x, z]) => [x!, z!]));
      continue;
    }
    if (element.lat === undefined || element.lon === undefined) continue;
    const at = [
      Math.round((element.lon - lon) * perDegree.lon * 10) / 10,
      Math.round(-(element.lat - lat) * perDegree.lat * 10) / 10,
    ];
    if (element.tags?.['natural'] === 'tree') trees.push(at);
    else if (element.tags?.['railway'] === 'tram_stop') {
      stops.push(at);
      stopNames.push(element.tags['name'] ?? '');
    } else crossings.push(at);
  }

  // --- Signs and steeples ----------------------------------------------------
  // Brands rather than names, and each written once: eighty-eight signs
  // between nineteen brands is nineteen strings and eighty-eight numbers.
  const brands: string[] = [];
  const signs: number[][] = [];
  const worship: number[][] = [];
  for (const element of marked.elements) {
    const tags = element.tags ?? {};
    const at = element.center ?? element;
    if (at.lat === undefined || at.lon === undefined) continue;
    const x = Math.round((at.lon - lon) * perDegree.lon * 10) / 10;
    const z = Math.round(-(at.lat - lat) * perDegree.lat * 10) / 10;

    const sort = worshipKind(tags);
    if (sort !== null) {
      worship.push([x, z, sort]);
      continue;
    }

    const brand = tags['brand'];
    if (!brand) continue;
    let index = brands.indexOf(brand);
    if (index < 0) index = brands.push(brand) - 1;
    signs.push([x, z, index]);
  }

  const keptPoints = [...roads, ...bridges, ...rails].reduce((total, way) => total + way.points.length, 0);
  const out = resolve(process.cwd(), 'src/world/data', `${name}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    `${JSON.stringify(
      {
        name,
        centre,
        radius,
        ...(west === radius ? {} : { west }),
        ...(north === radius ? {} : { north }),
        generated: new Date().toISOString(),
        attribution: ATTRIBUTION,
        roads,
        bridges,
        rails,
        areas,
        plans,
        crossings,
        trees,
        islands,
        stops,
        stopNames,
        brands,
        signs,
        worship,
      },
      null,
      0,
    )}\n`,
  );

  const kb = (
    Buffer.byteLength(
      JSON.stringify({
        roads, bridges, rails, areas, plans, crossings, trees, islands, stops, stopNames, brands, signs, worship,
      }),
    ) / 1024
  ).toFixed(0);
  process.stderr.write(
    `${roads.length} roads, ${bridges.length} bridges and ${rails.length} railways ` +
      `(${keptPoints} points), ` +
      `${areas.length} green areas, ${plans.length} buildings ` +
      `(${plans.filter((b) => b[0] !== null).length} of them saying how tall, ` +
      `${plans.reduce((n, b) => n + (b.length - 1) / 2, 0)} corners between them), ` +
      `${crossings.length} crossings, ${trees.length} trees, ` +
      `${islands.length} tram islands at ` +
      `${stops.length} stops (${new Set(stopNames.filter(Boolean)).size} named), ` +
      `${signs.length} shop signs of ${brands.length} brands, ${worship.length} churches, ` +
      `${rawPoints} points before thinning, ${kb} kB -> ${out}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
