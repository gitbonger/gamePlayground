import { defineConfig } from 'vite';
import base from './vite.config';

/**
 * A second dev server, for playing on rather than working on.
 *
 * The problem it solves: the working server pushes every edit into whatever
 * page is open. That is the right behaviour while a change is being looked
 * at, and the wrong one entirely when somebody is a kilometre into a flight
 * and a stray save reloads the world out from under them.
 *
 * So this one has hot reloading off. It serves the same files from the same
 * checkout -- there is no second copy of anything -- but once a page has
 * loaded, nothing here interrupts it. Whatever was on disk at the moment of
 * loading is what that flight is flying, for as long as the flight lasts, and
 * a refresh is how you ask for the newer one.
 *
 * The file watcher stays on, and that is the part that was got wrong first
 * time: switched off along with the reloads, the server went on serving
 * whatever it had transformed when it started, and a refresh brought back the
 * same stale page. It is the *client* that must not be told about changes,
 * not the server that must not notice them.
 *
 * `strictPort` on purpose: a server that quietly moves to the next free port
 * when this one is taken is a second server nobody meant to start, and the
 * whole point is knowing which one you are on.
 */
export default defineConfig({
  ...base,
  server: {
    port: 5199,
    strictPort: true,
    // No socket to the page, so nothing can push an update into it or ask it
    // to reload. The server still watches the files and still throws away
    // what it has transformed when one changes -- which is what makes the
    // next refresh serve the new code rather than the old.
    hmr: false,
  },
});
