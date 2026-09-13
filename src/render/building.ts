/**
 * Drawing a described building: its parts as one coloured geometry.
 *
 * The parts are `src/world/model.ts`'s, in the landmark's own frame; the
 * caller turns and places the result like any other landmark. Everything is
 * merged into one buffer with the colours baked in, so a station of forty
 * parts is one draw call, the same as a house.
 */

import * as THREE from 'three';
import type { Part } from '../world/model';
import { painted, type Piece } from './painted';

/**
 * A triangle soup as a geometry, with a flat normal per face.
 *
 * `uv` is there only because every geometry being merged has to carry the
 * same attributes as the others, and boxes carry one.
 */
function soup(corners: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((corners.length / 3) * 2).fill(0), 2));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A pitched roof: two slopes, two triangular ends and an underside.
 *
 * The underside matters more than it looks. The shed at Keleti is open at one
 * end, and a pigeon that flies in looks up at it -- without a face there, it
 * would be looking up through the roof at the sky.
 */
function gable(part: Part): THREE.BufferGeometry {
  // Built with the ridge along x, then turned if it runs the other way.
  const alongRidge = part.ridge !== 'across';
  const run = alongRidge ? part.length : part.width;
  const span = alongRidge ? part.width : part.length;
  const x0 = -run / 2;
  const x1 = run / 2;
  const z0 = -span / 2;
  const z1 = span / 2;
  const y0 = 0;
  const y1 = part.height;
  const geometry = soup([
    // The slope on the -z side, and the one on the +z side.
    x0, y0, z0, x0, y1, 0, x1, y1, 0,
    x0, y0, z0, x1, y1, 0, x1, y0, z0,
    x0, y0, z1, x1, y1, 0, x0, y1, 0,
    x0, y0, z1, x1, y0, z1, x1, y1, 0,
    // The two ends.
    x0, y0, z0, x0, y0, z1, x0, y1, 0,
    x1, y0, z0, x1, y1, 0, x1, y0, z1,
    // Underneath.
    x0, y0, z0, x1, y0, z0, x1, y0, z1,
    x0, y0, z0, x1, y0, z1, x0, y0, z1,
  ]);
  if (!alongRidge) geometry.rotateY(Math.PI / 2);
  return geometry;
}

/** A roof sloping in from all four sides, to a point or to a flat top. */
function hip(part: Part): THREE.BufferGeometry {
  // A four-sided cylinder turned a quarter so its sides face the axes, with a
  // bottom radius that makes it exactly a unit square, then stretched.
  const unit = Math.SQRT1_2;
  const geometry = new THREE.CylinderGeometry(unit * (part.top ?? 0), unit, part.height, 4, 1);
  geometry.rotateY(Math.PI / 4);
  geometry.scale(part.length, 1, part.width);
  geometry.translate(0, part.height / 2, 0);
  return geometry;
}

/**
 * An arched window: an upright panel with a half-circle head.
 *
 * `height` is the upright part; the head adds half the width on top of it.
 * Built facing +z and turned to `facing`.
 */
function arch(part: Part): THREE.BufferGeometry[] {
  const panel = new THREE.PlaneGeometry(part.width, part.height);
  panel.translate(0, part.height / 2, 0);
  const head = new THREE.CircleGeometry(part.width / 2, 18, 0, Math.PI);
  head.translate(0, part.height, 0);
  for (const piece of [panel, head]) piece.rotateY(part.facing ?? 0);
  return [panel, head];
}

export function buildModel(parts: readonly Part[]): THREE.BufferGeometry {
  const pieces: Piece[] = [];
  for (const part of parts) {
    const shapes =
      part.shape === 'box'
        ? [new THREE.BoxGeometry(part.length, part.height, part.width).translate(0, part.height / 2, 0)]
        : part.shape === 'gable'
          ? [gable(part)]
          : part.shape === 'hip'
            ? [hip(part)]
            : arch(part);
    for (const shape of shapes) {
      shape.translate(part.along, part.base, part.across);
      pieces.push({ geometry: shape, color: part.colour });
    }
  }
  return painted(pieces);
}
