/**
 * A bar of health over a bird's head.
 *
 * The one in the corner belongs to whoever the camera is following. This is
 * for the birds you are looking *at*: the hero on his feet, and whoever he
 * has walked up to. Once the belly is a thing the story turns on, how much is
 * left in it has to be visible on the bird rather than only on the panel --
 * a conversation about being hungry reads differently with two nearly-empty
 * bars standing in it.
 *
 * Drawn as plain DOM over the canvas, positioned by projecting the bird's
 * head into the frame. Text and rectangles are what the browser is good at;
 * a bar built out of geometry would be three draw calls and a font problem.
 */

import * as THREE from 'three';

/** A bird worth showing a bar for, and how full it is. */
export interface Vital {
  /** Where its head is, in world coordinates. */
  at: THREE.Vector3;
  /** Nought to one. */
  health: number;
}

export interface Vitals {
  /**
   * Draw a bar over each of these, and take away any that are left over.
   *
   * Called every frame with whoever is on their feet nearby, so the list is
   * short and changes constantly -- which is why the nodes are pooled rather
   * than rebuilt.
   */
  show(birds: readonly Vital[], camera: THREE.Camera, canvas: HTMLElement): void;
  dispose(): void;
}

/** Below this it goes red, the same mark the stamina bar uses. */
const LOW = 0.3;

export function createVitals(container: HTMLElement): Vitals {
  const root = document.createElement('div');
  root.className = 'vitals';
  container.appendChild(root);

  const bars: { box: HTMLElement; fill: HTMLElement }[] = [];
  const place = new THREE.Vector3();

  const barAt = (index: number) => {
    const had = bars[index];
    if (had) return had;
    const box = document.createElement('div');
    box.className = 'vital';
    const fill = document.createElement('div');
    fill.className = 'vital-fill';
    box.appendChild(fill);
    root.appendChild(box);
    const made = { box, fill };
    bars.push(made);
    return made;
  };

  return {
    show(birds, camera, canvas) {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;

      birds.forEach((bird, index) => {
        const bar = barAt(index);
        place.copy(bird.at).project(camera);
        // Behind the camera, or outside the frame with a margin: nothing to
        // draw. `project` puts what is behind you back in front of you with
        // the sign flipped, so the z test is not optional.
        if (place.z > 1 || Math.abs(place.x) > 1.4 || Math.abs(place.y) > 1.4) {
          bar.box.hidden = true;
          return;
        }
        bar.box.hidden = false;
        bar.box.style.left = `${((place.x + 1) / 2) * width}px`;
        bar.box.style.top = `${((1 - place.y) / 2) * height}px`;
        bar.fill.style.width = `${Math.max(0, Math.min(1, bird.health)) * 100}%`;
        bar.fill.classList.toggle('low', bird.health < LOW);
      });

      for (let index = birds.length; index < bars.length; index += 1) {
        bars[index]!.box.hidden = true;
      }
    },
    dispose() {
      root.remove();
    },
  };
}
