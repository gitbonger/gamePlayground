/**
 * The pigeon's head, big, for a favicon. Development only.
 *
 * The bird is the game's own rig rather than a drawing of one, so the icon in
 * the browser tab is the bird the player flies: same morph, same beak, same
 * eye. Rendered here at a size nothing else needs, screenshotted, and shrunk.
 *
 *   /dev/face.html            the ordinary grey pigeon
 *   /dev/face.html?morph=4    her, the pink one
 */

import * as THREE from 'three';
import { createBirdRig, PIGEON_MORPHS } from '../src/render/bird';
import { createBird } from '../src/sim/flight';
import { vec } from '../src/sim/math3';

const params = new URLSearchParams(location.search);
const n = (key: string, fallback: number) => Number(params.get(key) ?? fallback);

const SIZE = 512;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(SIZE, SIZE);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// Sky behind it, so the icon reads as a bird in the air rather than a cut-out.
scene.background = new THREE.Color(n('sky', 0x7fb0dd));

// The same two lights the game uses, in the same proportion: a bright sky and
// a low sun. A head lit from nowhere is a grey blob.
scene.add(new THREE.HemisphereLight(0xd7ecff, 0x5a5a4a, 1.4));
const sun = new THREE.DirectionalLight(0xfff2d8, 1.9);
sun.position.set(-3, 2.4, 3);
scene.add(sun);

const rig = createBirdRig(PIGEON_MORPHS[n('morph', 0)] ?? PIGEON_MORPHS[0]);
scene.add(rig.object);

// Level, still, and gliding: the pose a pigeon is in when you look at it.
const bird = createBird(vec(0, 0, 0), 0, 0);
bird.velocity = vec(0, 0, -12);
rig.update(bird, 'gliding', 0);
rig.object.updateMatrixWorld(true);

// Framed on the head rather than on the bird: three quarters on, a little
// above, close enough that the beak and the eye are most of the picture.
const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
camera.position.set(n('x', 0.26), n('y', 0.16), n('z', 0.3));
camera.lookAt(n('tx', 0.0), n('ty', 0.075), n('tz', -0.07));
renderer.render(scene, camera);

(window as unknown as { __face: unknown }).__face = { renderer, scene, camera, rig, bird };
