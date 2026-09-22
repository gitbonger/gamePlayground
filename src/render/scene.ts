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
  /** What to draw it at. `FULL_QUALITY` unless somebody says otherwise. */
  quality?: Quality;
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

/**
 * What the machine is asked to draw, as the four numbers that decide it.
 *
 * One object rather than four flags, because they are one decision: a phone
 * is not a desktop with the pixel ratio turned down, it is a different budget
 * altogether, and the settings that make it playable want reading together.
 */
export interface Quality {
  /** Device pixels per CSS pixel, at most. See `MAX_PIXEL_RATIO`. */
  pixelRatio: number;
  /** Where the fog closes. The far plane sits just beyond it. */
  reach: number;
  /** The nearest thing drawn, in metres. */
  near: number;
  /** Whether depth is stored logarithmically -- see the note in `createScene`. */
  logarithmicDepth: boolean;
  antialias: boolean;
}

export const FULL_QUALITY: Quality = {
  pixelRatio: MAX_PIXEL_RATIO,
  reach: 4200,
  near: 0.35,
  logarithmicDepth: true,
  antialias: true,
};

/**
 * The same world, drawn for a telephone.
 *
 * Every number here is a thing given up, and the reason for each:
 *
 * - **One device pixel per CSS pixel.** A phone reports 3.0. At 1.5 a modest
 *   handset is shading four times the desktop's fragments on a tenth of the
 *   silicon.
 * - **Two kilometres of fog instead of four.** The far plane comes in with
 *   it, so the far half of the city is not drawn at all. On a screen this
 *   size the horizon was a smear before it was cut.
 * - **No logarithmic depth.** three.js implements it by writing
 *   `gl_FragDepth`, and a fragment shader that writes its own depth cannot be
 *   rejected early -- which is precisely the optimisation the tile-based GPUs
 *   in phones are built around. It is the most expensive setting in the file
 *   on the machines that can least afford it. The price is paid at the near
 *   plane instead: **`near` goes to one metre**, which a 24-bit buffer can
 *   spread over two kilometres without flat things on the ground fighting.
 *   If road markings flicker on a phone, this is the pair to put back.
 * - **No multisampling.** Whole-frame cost for smoother rooflines, which is
 *   the first thing to go when the frame is already late.
 */
export const PHONE_QUALITY: Quality = {
  pixelRatio: 1,
  reach: 2000,
  near: 1,
  logarithmicDepth: false,
  antialias: false,
};

/**
 * The vertical angle of view, and the aspect it is meant for.
 *
 * Seventy degrees is the *vertical* field, which is a fine thing to fix while
 * every screen is roughly a desktop window. A phone in landscape is twice as
 * wide as it is tall, and the same seventy degrees there opens the horizontal
 * field to a hundred and thirteen -- a fisheye. So it is the *horizontal*
 * field that is held constant on anything wider than `WIDE_ASPECT`, and the
 * vertical narrows to keep it: the city looks the same shape on a phone held
 * sideways as it does in a window.
 */
const FIELD_OF_VIEW = 70;
const WIDE_ASPECT = 1.6;

const HORIZON = new THREE.Color(0xbcd3e8);
const ZENITH = new THREE.Color(0x4a86c8);

export function createScene(canvas: HTMLCanvasElement, options: SceneOptions): SceneBundle {
  const quality = options.quality ?? FULL_QUALITY;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: quality.antialias,
    // The view runs from under a metre to twelve kilometres. Spread linearly
    // across a depth buffer that wide, flat things lying on the ground have
    // barely a bit of precision between them and flicker against it. Off on a
    // phone, where it costs more than it is worth -- see `PHONE_QUALITY`.
    logarithmicDepthBuffer: quality.logarithmicDepth,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatio));
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
  scene.fog = new THREE.Fog(HORIZON.clone(), Math.min(350, quality.reach * 0.2), quality.reach);

  // The far plane sits just beyond the fog rather than out at twelve
  // kilometres. Everything past four thousand two hundred metres is solid
  // horizon colour -- that is what the fog is -- so drawing it was drawing
  // the far side of a hundred square kilometres of city in order to paint it
  // the colour of the sky. Behind the fog is the one place nothing is missed.
  const camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW, 1, quality.near, quality.reach * 1.24);

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

  const skyDome = createSkyDome(sunDirection, quality.reach * 1.1);
  scene.add(skyDome);
  const skyMaterial = skyDome.material as THREE.ShaderMaterial;

  function setSun(direction: { x: number; y: number; z: number }) {
    sunDirection.set(direction.x, direction.y, direction.z).normalize();
    sun.position.copy(sunDirection).multiplyScalar(400);
    (skyMaterial.uniforms['sunDirection']!.value as THREE.Vector3).copy(sunDirection);
  }

  function resize() {
    // `visualViewport` rather than `innerWidth`, where there is one: a phone
    // browser's address bar slides in and out over the page, and `innerHeight`
    // reports the height the page would have if it were not there. Drawn to
    // that, the bottom of the world -- which is where the controls are --
    // sits under the bar.
    const view = window.visualViewport;
    const width = Math.round(view?.width ?? window.innerWidth);
    const height = Math.round(view?.height ?? window.innerHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Hold the horizontal field on anything wider than a window. See
    // `WIDE_ASPECT`.
    camera.fov =
      camera.aspect <= WIDE_ASPECT
        ? FIELD_OF_VIEW
        : 2 *
          THREE.MathUtils.radToDeg(
            Math.atan(
              (Math.tan(THREE.MathUtils.degToRad(FIELD_OF_VIEW) / 2) * WIDE_ASPECT) / camera.aspect,
            ),
          );
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);
  // And when the bar slides away, or the phone is turned, neither of which is
  // reliably a `resize` on the window.
  window.visualViewport?.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);

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
 *
 * The dome itself is carried along with the camera, for the same reason and a
 * harder one. It was left at the origin, which was fine while the map was two
 * kilometres across and the bird could never reach the shell; the map now
 * reaches ten kilometres into Buda, and a bird outside a sphere drawn on its
 * inside faces sees the far wall of it -- a pale dome standing over the city,
 * there and gone as he crossed the nine kilometre line.
 */
export function createSkyDome(direction: THREE.Vector3, radius = 4600): THREE.Mesh {
  // Inside the far plane, or the sky is clipped and the world has a hole in
  // it where the sky should be. It follows the camera, so a smaller sphere is
  // no less of a sky -- see the note above.
  const geometry = new THREE.SphereGeometry(radius, 32, 16);
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
  // It surrounds the viewer, so there is never a frame it is not in: culling
  // it by a bounding sphere that moves with the camera is work with one
  // answer, and the wrong answer whenever the two are worked out a frame
  // apart.
  mesh.frustumCulled = false;
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    if (mesh.position.equals(camera.position)) return;
    mesh.position.copy(camera.position);
    mesh.updateMatrixWorld(true);
  };
  return mesh;
}
