/**
 * Facts about the build, stamped into the code by Vite's `define`.
 *
 * Declared rather than imported because that is what a `define` is: the
 * bundler replaces the identifier with a literal before TypeScript's output
 * ever exists, so there is no module for it to come from.
 */

/**
 * How many bytes `src/world/data/home.json` is, uncompressed.
 *
 * The loading bar counts the chunks it has read against this. It cannot count
 * them against `content-length`, which is the gzipped size -- see `loadMap` in
 * `main.ts`. Taken from the file itself at build time, so refetching the map
 * cannot leave the two disagreeing.
 */
declare const __MAP_BYTES__: number;
