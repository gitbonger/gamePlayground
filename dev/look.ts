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
const full = buildLayoutFromMap(map, defaultMapWorldOptions);
const world = buildWorld(full);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb6d8);
scene.add(world.group);
scene.add(new THREE.HemisphereLight(0xd7ecff, 0x5a5a4a, 1.1));
const sun = new THREE.DirectionalLight(0xfff2d8, 1.5);
sun.position.set(-300, 400, 200);
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
