import { defineConfig } from 'vitest/config';

export default defineConfig({
  /**
   * Relative, so the built game runs from wherever it is put.
   *
   * GitHub Pages serves a project's site from a subdirectory named after the
   * repository, so a build with absolute asset paths asks for `/assets/...`
   * and gets a 404 for every file. `'./'` sidesteps the whole question: it
   * works at the root, in a subdirectory, and from a file:// URL, and it
   * needs no build-time knowledge of where the thing will be served from.
   *
   * The map *is* fetched by path at runtime now -- see `main.ts` -- and this
   * is what makes that safe: a `?url` import is written out against this base,
   * so it comes out relative and resolves against whatever page is asking.
   */
  base: './',
  /**
   * MIDI is not on Vite's list of things that are assets, so without this a
   * `?url` import of one is a module Vite tries to parse as JavaScript.
   */
  assetsInclude: ['**/*.mid'],
  server: { port: 5183 },
  build: { target: 'es2022', sourcemap: true },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
