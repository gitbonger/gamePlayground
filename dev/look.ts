/**
 * A still of the map from wherever you point a camera. Development only.
 *
 * The game cannot be flown by anything but a person -- it wants a keyboard --
 * so until this existed there was no way to *look* at a thing that had just
 * been added to the world short of asking somebody to go and find it. This
 * builds the same world the game builds, points a camera where the query
 * string says, and draws one frame.
 *
 *   /dev/look.html?x=318&y=3.5&z=-30&tx=300&ty=7&tz=-120
 *
 * `t` is the time in seconds for anything that moves on a clock, like the
 * ripples on the water.
 *
 * `x,y,z` is where the camera stands and `tx,ty,tz` what it looks at, both in
 * local metres -- the coordinates everything in `src/world` is in, with north
 * at -Z. The default is Kerepesi ut where it crosses the throat of Keleti,
 * which is the flyover the bridges were built for.
 *
 * Not part of the game and not built into it: Vite builds `index.html` and
 * what it imports, and nothing imports this.
 */
import * as THREE from 'three';
import homeMap from '../src/world/data/home.json';
import { buildLayoutFromMap, defaultMapWorldOptions } from '../src/world/from-map';
import { buildWorld } from '../src/world/city';
import type { MapData } from '../src/world/streets';
import { LANDMARKS } from '../src/landmarks';
import { project } from '../src/world/geo';
import { buildCarGraph, createTraffic } from '../src/world/cars';
import { createCarMeshes } from '../src/render/cars';
import { FLAT } from '../src/world/ground';
import { createSmoke, WINGTIP_TRAIL } from '../src/world/smoke';
import { createAirStreaks } from '../src/render/rush';
import { createSkyDome } from '../src/render/scene';

const map = homeMap as unknown as MapData;
// The same world the game builds, trams and all -- otherwise a count of what
// it costs to draw is a count of a city with no traffic in it.
const yard = { x: -400, z: -180 };
const full = buildLayoutFromMap(map, {
  ...defaultMapWorldOptions,
  // The described buildings too, placed as the game places them, so that one
  // that has just been added can be looked at here.
  landmarks: LANDMARKS.map((landmark) => {
    const at = project(landmark.at[0], landmark.at[1], map.centre);
    const { at: _degrees, ...rest } = landmark;
    return { ...rest, x: at.x, z: at.z };
  }),
  trains: [
    { near: yard, cars: 12 },
    { near: yard, cars: 6, stock: 'carriage', speed: 16, runsOut: true },
    { near: yard, cars: 4, stock: 'carriage', speed: 13, runsOut: true },
    { near: yard, cars: 8, stock: 'carriage', speed: 11, runsOut: true },
  ],
  fill: [
    { stock: 'tram', cars: 4, speed: 10, minRoute: 320, most: 30, headway: 90 },
    { stock: 'carriage', cars: 5, speed: 14, minRoute: 1200, most: 8, headway: 0 },
  ],
});
const world = buildWorld(full, { smoke: 200 });

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbcd3e8);
/**
 * `?sky=1` adds the game's fog and its sky dome.
 *
 * Off by default, because a page for looking at a thing that has just been
 * built should show it plainly. On, because some faults only exist at the
 * distance the fog hides: the ground beyond the map used to hold the height
 * of the last row it knew about, which from the streets was a pale dome
 * standing over the city, and nothing without fog in it would ever show that.
 */
let skyDome: THREE.Mesh | null = null;
if (new URLSearchParams(location.search).get('sky')) {
  scene.fog = new THREE.Fog(new THREE.Color(0xbcd3e8), 350, 4200);
  // The game's own sky, not a plain blue ball: the gradient is the half of it
  // that shows a fault up.
  const dome = createSkyDome(new THREE.Vector3(-0.42, 0.66, 0.62).normalize());
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  scene.add(dome);
  skyDome = dome;
}
scene.add(world.group);
// The game's own lights, copied from `render/scene.ts` rather than invented
// here. They were invented here, brighter, and the page spent its life
// flattering everything shown on it -- the railway ballast was darkened once
// on the strength of a picture this page had washed out.
scene.add(new THREE.HemisphereLight(new THREE.Color(0x4a86c8), 0x6b7355, 1.5));
const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
sun.position.set(-0.42, 0.66, 0.62).normalize().multiplyScalar(400);
scene.add(sun);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
const W = 1200, H = 700;
renderer.setSize(W, H);
document.body.appendChild(renderer.domElement);

// The game's near and far planes, so that what is clipped here is what is
// clipped there.
const camera = new THREE.PerspectiveCamera(55, W / H, 0.35, 5200);
const params = new URLSearchParams(location.search);
const n = (k: string, d: number) => Number(params.get(k) ?? d);
camera.position.set(n('x', 300), n('y', 40), n('z', 60));
camera.lookAt(n('tx', 298), n('ty', 6), n('tz', -72));
// Carried with the camera, as the game carries it: a dome left at the origin
// is one the camera can fly out of.
// `?skyfixed=1` pins it at the origin, which is how it used to be: what that
// looks like from the far side of the map is the whole reason it does not.
if (skyDome && new URLSearchParams(location.search).get('skyfixed')) skyDome.onBeforeRender = () => {};
renderer.render(scene, camera);

// Left where a console can reach it, so the page is also somewhere to ask
// what the world costs to draw: `__look.renderer.info` after a frame is the
// draw calls and triangles, and re-rendering in a loop times it.
// The trains have to be put where the layout says before anything is counted:
// left alone they are all stacked at the origin, and a draw-call count of a
// heap of trams at nought says nothing about a city with trams in it.
world.updateTrains(full.trains ?? []);
// And whoever is waiting at the stops near what is being looked at: they are
// a pool that follows the bird in the game, and here the camera is the bird.
world.showWaitingNear({ x: n('tx', 298), z: n('tz', -72) });
// And the water's clock, from `t` in seconds, so that two stills a moment
// apart show whether it moves.
world.updateWater(n('t', 0));
// The air at speed: `?rush=1` fills it with streaks, as the game does over a
// hundred kilometres an hour. `?speed` is metres a second, which is what sets
// how long they are drawn.
if (n('rush', 0)) {
  const streaks = createAirStreaks();
  scene.add(streaks.object);
  const eye = { x: n('x', 300), y: n('y', 40), z: n('z', 60) };
  const to = { x: n('tx', 298), y: n('ty', 6), z: n('tz', -72) };
  const run = Math.hypot(to.x - eye.x, to.y - eye.y, to.z - eye.z) || 1;
  streaks.update(
    eye,
    { x: (to.x - eye.x) / run, y: (to.y - eye.y) / run, z: (to.z - eye.z) / run },
    n('speed', 80),
    n('rush', 0),
  );
}

// And a rocket trail, if one is asked for: `?rocket=1` burns one along the
// line from the camera to what it is looking at, which is the only way to see
// what X leaves behind without being able to press X.
if (n('rocket', 0)) {
  const trails = [createSmoke(WINGTIP_TRAIL, 3), createSmoke(WINGTIP_TRAIL, 11)];
  // Flown *at* what the camera is looking at, ending on it: a trail laid from
  // the camera outwards starts in its own face and is gone by the time it is
  // in frame.
  const eye = { x: n('x', 300), y: n('y', 40), z: n('z', 60) };
  const to = { x: n('tx', 298), y: n('ty', 6), z: n('tz', -72) };
  const run = Math.hypot(to.x - eye.x, to.y - eye.y, to.z - eye.z) || 1;
  // Twenty-two metres a second, which is a boosted pigeon, for the burn and a
  // little after it.
  const speed = 22;
  const dt = 1 / 120;
  const seconds = 2.6;
  const way = { x: (to.x - eye.x) / run, y: (to.y - eye.y) / run, z: (to.z - eye.z) / run };
  // Flown away from the camera along its own line of sight, starting a few
  // metres out: the trail then lies between the camera and what it is looking
  // at, which is where a chase camera sees it from.
  const START = 8;
  // Two of them, a wingspan apart across the line of flight.
  const across = { x: -way.z, y: 0, z: way.x };
  for (let t = 0; t < seconds; t += dt) {
    const along = START + t * speed;
    trails.forEach((trail, side) => {
      const out = (side === 0 ? -0.38 : 0.38);
      trail.update(
        dt,
        {
          x: eye.x + way.x * along + across.x * out,
          y: eye.y + way.y * along,
          z: eye.z + way.z * along + across.z * out,
        },
        { x: 0, y: 0, z: 0 },
        t < 1.4,
      );
    });
  }
  world.updateSmoke(
    trails.map((trail) => ({ puffs: trail.puffs, smoke: WINGTIP_TRAIL, tint: 0xf2f7ff })),
    camera.quaternion,
  );
}

// And the cars, driven for `drive` seconds round where the camera is looking
// first, so they are spread along the roads rather than where they were put.
{
  const looking = { x: n('tx', 298), z: n('tz', -72) };
  const traffic = createTraffic(buildCarGraph(full.roads ?? []), 300, looking);
  for (let t = 0; t < n('drive', 40); t += 1 / 30) traffic.update(1 / 30, looking);
  const cars = createCarMeshes(300, (x, z) => (full.ground ?? FLAT).heightAt(x, z));
  cars.update(traffic.cars);
  scene.add(cars.object);
}
renderer.render(scene, camera);

(window as unknown as { __look: unknown }).__look = { renderer, scene, camera, world, layout: full };
