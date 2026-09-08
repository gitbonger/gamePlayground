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

const map = homeMap as unknown as MapData;
// The same world the game builds, trams and all -- otherwise a count of what
// it costs to draw is a count of a city with no traffic in it.
const yard = { x: -400, z: -180 };
const full = buildLayoutFromMap(map, {
  ...defaultMapWorldOptions,
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
const world = buildWorld(full);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbcd3e8);
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

const camera = new THREE.PerspectiveCamera(55, W / H, 0.5, 6000);
const params = new URLSearchParams(location.search);
const n = (k: string, d: number) => Number(params.get(k) ?? d);
camera.position.set(n('x', 300), n('y', 40), n('z', 60));
camera.lookAt(n('tx', 298), n('ty', 6), n('tz', -72));
renderer.render(scene, camera);

// Left where a console can reach it, so the page is also somewhere to ask
// what the world costs to draw: `__look.renderer.info` after a frame is the
// draw calls and triangles, and re-rendering in a loop times it.
// The trains have to be put where the layout says before anything is counted:
// left alone they are all stacked at the origin, and a draw-call count of a
// heap of trams at nought says nothing about a city with trams in it.
world.updateTrains(full.trains ?? []);
renderer.render(scene, camera);

(window as unknown as { __look: unknown }).__look = { renderer, scene, camera, world, layout: full };
