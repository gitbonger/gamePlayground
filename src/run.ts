/** Per-flight statistics, for the game-over screen. */

import { length, sub, type Vec3 } from './sim/math3';
import type { BirdState } from './sim/flight';

export interface RunStats {
  /** Seconds since the bird was launched. */
  duration: number;
  /** Total distance travelled, in metres. */
  distance: number;
  /** Fastest airspeed reached, in m/s. */
  topSpeed: number;
  /** Greatest altitude reached, in metres. */
  ceiling: number;
}

export interface RunTracker {
  readonly stats: RunStats;
  update(state: BirdState, dt: number): void;
  reset(state: BirdState): void;
}

export function createRunTracker(state: BirdState): RunTracker {
  const stats: RunStats = { duration: 0, distance: 0, topSpeed: 0, ceiling: 0 };
  let previous: Vec3 = { ...state.position };

  return {
    stats,
    update(current, dt) {
      stats.duration += dt;
      stats.distance += length(sub(current.position, previous));
      stats.topSpeed = Math.max(stats.topSpeed, length(current.velocity));
      stats.ceiling = Math.max(stats.ceiling, current.position.y);
      previous = { ...current.position };
    },
    reset(current) {
      stats.duration = 0;
      stats.distance = 0;
      stats.topSpeed = 0;
      stats.ceiling = current.position.y;
      previous = { ...current.position };
    },
  };
}
