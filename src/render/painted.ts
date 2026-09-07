/**
 * Several coloured shapes fused into one geometry, drawn in one call.
 *
 * Every solid thing in this world is built the same way: a handful of boxes
 * in the shape of a pigeon, a person or a dog, each a flat colour, merged
 * into a single buffer with the colour baked into the vertices. One geometry,
 * one material, one draw call -- and the parts keep their own colours without
 * any of them needing a material of its own.
 *
 * It lived in the city builder first, for the people and the gravestones. A
 * second copy for the dog was the point at which it became a thing rather
 * than a coincidence.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** A shape and the colour it is painted. */
export interface Piece {
  geometry: THREE.BufferGeometry;
  color: number;
}

/**
 * Merge parts into one geometry, disposing them.
 *
 * De-indexed first, because merging is only defined over geometries of the
 * same kind and a box arrives indexed while a merge comes back flat -- mixing
 * the two silently drops parts.
 */
export function merged(parts: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((part) => (part.index ? part.toNonIndexed() : part));
  const one = mergeGeometries(flat);
  // A part that was already flat is its own flattening, so the two lists
  // overlap and disposing both by hand would free it twice.
  for (const part of new Set([...parts, ...flat])) part.dispose();
  return one;
}

/**
 * Paint each piece its own colour and merge them.
 *
 * The parts are consumed: their buffers end up in the returned geometry and
 * the originals are disposed, so a caller building a body out of twenty boxes
 * is left with one thing to dispose rather than twenty-one.
 */
export function painted(parts: readonly Piece[]): THREE.BufferGeometry {
  const tint = new THREE.Color();
  for (const part of parts) {
    tint.set(part.color);
    const count = part.geometry.getAttribute('position').count;
    const colours = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      colours[i * 3] = tint.r;
      colours[i * 3 + 1] = tint.g;
      colours[i * 3 + 2] = tint.b;
    }
    part.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  }
  return merged(parts.map((part) => part.geometry));
}
