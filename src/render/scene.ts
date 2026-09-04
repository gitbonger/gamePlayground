/** Renderer, lighting and sky. */

import * as THREE from 'three';

export interface SceneBundle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  resize(): void;
}

const HORIZON = new THREE.Color(0xbcd3e8);
const ZENITH = new THREE.Color(0x4a86c8);

export function createScene(canvas: HTMLCanvasElement): SceneBundle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  // PCFSoft is deprecated as of three r185 and silently falls back to PCF, so
  // ask for what we actually get rather than logging a warning every load.
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = HORIZON.clone();
  // Fog does double duty: it hides the world's edge and gives distance a feel.
  scene.fog = new THREE.Fog(HORIZON.clone(), 350, 4200);

  const camera = new THREE.PerspectiveCamera(70, 1, 0.35, 12000);

  scene.add(new THREE.HemisphereLight(ZENITH.clone(), 0x6b7355, 1.5));

  const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
  sun.position.set(-160, 240, 120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // The shadow camera follows the bird, so it only needs to cover what is
  // close enough to read as a shadow.
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 900;
  sun.shadow.camera.left = -220;
  sun.shadow.camera.right = 220;
  sun.shadow.camera.top = 220;
  sun.shadow.camera.bottom = -220;
  sun.shadow.bias = -0.0008;
  scene.add(sun);
  scene.add(sun.target);

  scene.add(createSkyDome());

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  return { renderer, scene, camera, sun, resize };
}

/** Inverted sphere with a vertical gradient, drawn behind everything else. */
function createSkyDome(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(9000, 32, 16);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      horizon: { value: HORIZON.clone() },
      zenith: { value: ZENITH.clone() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 horizon;
      uniform vec3 zenith;
      varying vec3 vWorld;
      void main() {
        float h = clamp(normalize(vWorld).y, 0.0, 1.0);
        gl_FragColor = vec4(mix(horizon, zenith, pow(h, 0.6)), 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -1;
  return mesh;
}
