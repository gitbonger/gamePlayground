/** Renderer, lighting and sky. */

import * as THREE from 'three';

export interface SceneBundle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  /** Unit vector pointing at the sun, for anything that has to agree with it. */
  sunDirection: THREE.Vector3;
  /**
   * Move the sun.
   *
   * Every level is flown at its own hour, so this is not set once. Three
   * things have to agree about where it is -- the light, the disc in the sky
   * and the glare around it -- and they agree by all being told here.
   */
  setSun(direction: { x: number; y: number; z: number }): void;
  /**
   * How many device pixels a CSS pixel is drawn at.
   *
   * Exposed so the difference can be looked at rather than argued about: it
   * is the one setting whose cost is the same on every machine and whose
   * effect shows only on a display good enough to resolve it. Clamped to
   * what the display actually has, since asking for more than that is paying
   * for pixels nobody can see.
   */
  setPixelRatio(ratio: number): void;
  resize(): void;
}

export interface SceneOptions {
  /**
   * Which way the sun is, as a vector in world axes.
   *
   * Passed in rather than chosen here, because the answer depends on where on
   * Earth the map is and what the time is there -- see `./sun`.
   */
  sun: { x: number; y: number; z: number };
}

/**
 * How many device pixels the world is drawn at per CSS pixel, at most.
 *
 * The one number that costs the same on every machine and is felt only on the
 * slow ones. A 1512 by 982 window on a retina display asks for a 3024 by 1964
 * buffer at 2.0 -- 5.9 megapixels, every frame, every one of them shaded. At
 * 1.5 it is 2268 by 1473, which is **3.3 megapixels: 44% fewer**.
 *
 * 1.5 rather than 1.0 because the difference between 2.0 and 1.5 is a slight
 * softening of edges and the difference between 1.5 and 1.0 is visible
 * stair-stepping on every roofline. And this is a world of long straight
 * edges seen against a plain sky, which is the worst case for that.
 *
 * A display that is not retina reports 1.0 and is unaffected: this only ever
 * takes something away from the machines that had the most to give.
 */
const MAX_PIXEL_RATIO = 1.5;

const HORIZON = new THREE.Color(0xbcd3e8);
const ZENITH = new THREE.Color(0x4a86c8);

export function createScene(canvas: HTMLCanvasElement, options: SceneOptions): SceneBundle {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    // The view runs from under a metre to twelve kilometres. Spread linearly
    // across a depth buffer that wide, flat things lying on the ground have
    // barely a bit of precision between them and flicker against it.
    logarithmicDepthBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  /**
   * Shadows are off.
   *
   * A shadow map is a second pass over the whole world: everything that casts
   * is drawn again from the sun's point of view, which roughly doubles the
   * draw calls. Submitting them was 3.5 ms of a 4.6 ms frame, and the city
   * they were mostly being drawn for is a few merged and instanced meshes
   * whose shadows read as a grey wash at altitude.
   *
   * Every mesh keeps its `castShadow` and `receiveShadow` flags. They do
   * nothing while the shadow map is off, and turning this back on is the only
   * change needed to have them again.
   */
  renderer.shadowMap.enabled = false;
  // PCFSoft is deprecated as of three r185 and silently falls back to PCF, so
  // ask for what we actually get rather than logging a warning every load.
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = HORIZON.clone();
  // Fog does double duty: it hides the world's edge and gives distance a feel.
  scene.fog = new THREE.Fog(HORIZON.clone(), 350, 4200);

  const camera = new THREE.PerspectiveCamera(70, 1, 0.35, 12000);

  scene.add(new THREE.HemisphereLight(ZENITH.clone(), 0x6b7355, 1.5));

  const sunDirection = new THREE.Vector3(options.sun.x, options.sun.y, options.sun.z).normalize();

  const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
  sun.position.copy(sunDirection).multiplyScalar(400);
  // Left described, and inert while the shadow map above is off.
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

  const skyDome = createSkyDome(sunDirection);
  scene.add(skyDome);
  const skyMaterial = skyDome.material as THREE.ShaderMaterial;

  function setSun(direction: { x: number; y: number; z: number }) {
    sunDirection.set(direction.x, direction.y, direction.z).normalize();
    sun.position.copy(sunDirection).multiplyScalar(400);
    (skyMaterial.uniforms['sunDirection']!.value as THREE.Vector3).copy(sunDirection);
  }

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  function setPixelRatio(ratio: number) {
    renderer.setPixelRatio(Math.min(Math.max(ratio, 0.5), window.devicePixelRatio));
    resize();
  }

  return { renderer, scene, camera, sun, sunDirection, setSun, setPixelRatio, resize };
}

/**
 * Inverted sphere with a vertical gradient and the sun on it, drawn behind
 * everything else.
 *
 * The sun belongs to the sky rather than to the world because that is what it
 * is: no geometry to place, nothing to fly into, and it stays where it is
 * however far the bird travels. Its direction is measured from the camera and
 * not from the origin, or the disc would slide across the sky as the bird flew
 * out from the middle of the dome.
 */
function createSkyDome(direction: THREE.Vector3): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(9000, 32, 16);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      horizon: { value: HORIZON.clone() },
      zenith: { value: ZENITH.clone() },
      sunDirection: { value: direction.clone() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vLook;
      void main() {
        vLook = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 horizon;
      uniform vec3 zenith;
      uniform vec3 sunDirection;
      varying vec3 vLook;
      void main() {
        vec3 look = normalize(vLook);
        vec3 sky = mix(horizon, zenith, pow(clamp(look.y, 0.0, 1.0), 0.6));

        // How far this bit of sky is from the sun. As a chord rather than the
        // angle: at half a degree, acos of a dot product has run out of float.
        float away = length(look - sunDirection);

        // The disc is half a degree across, which is all the sun ever is. The
        // glare around it is what the eye actually reads as brightness.
        float glare = exp(-away * 34.0) * 0.55 + exp(-away * 5.0) * 0.13;
        float disc = 1.0 - smoothstep(0.0044, 0.0050, away);

        sky = mix(sky, vec3(1.0, 0.96, 0.88), clamp(glare, 0.0, 1.0));
        sky = mix(sky, vec3(1.0, 0.99, 0.94), disc);
        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -1;
  return mesh;
}
