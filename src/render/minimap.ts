/**
 * A small map in the corner, turned so that forward is up.
 *
 * The problem it solves is one level in particular: taking off from the goods
 * train on `Coming on strong`, the loft is most of a kilometre away and there
 * is nothing on the screen that says which way. The marker over it is a
 * needle in a city, the waymarks are for two levels that have them, and the
 * only other cue is the compass heading -- which is a number, and a number is
 * not a direction until you already know where you are going.
 *
 * Turned rather than north-up, because the question is "which way do I go
 * from here" and not "where am I on a chart". North-up makes the player do
 * the rotation in their head at the exact moment they are also flying.
 *
 * What it draws is what the level is about: the streets for context, the
 * thing being aimed at, and the line that finishes the level. Not buildings --
 * at this scale a district of them is a grey rectangle, and the streets
 * between them are the shape you actually recognise.
 */

import type { Road } from '../world/streets';

/** How far the map reaches from the bird, in metres. */
const REACH = 320;

/** How big the panel is, in CSS pixels. */
const SIZE = 148;

/**
 * The grid the streets are bucketed into, in metres.
 *
 * A hundred, so the panel's own reach is a three-by-three of cells at worst
 * and the draw looks at a few dozen segments rather than the seven and a half
 * thousand on the map. This runs every frame.
 */
const CELL = 100;

export interface MinimapView {
  /** Where the bird is, in local metres. */
  at: { x: number; z: number };
  /** Which way it faces, in radians, in the convention the rest of this map uses. */
  heading: number;
  /**
   * What to point at: whatever finishes this level, or null for a level that
   * finishes nowhere.
   *
   * Not always the thing with a marker over it. A level that ends at a line
   * has no marker on purpose -- there is nothing to land on -- and those are
   * the levels a player is most lost on, so for those it is a point on the
   * line itself.
   */
  target: { x: number; z: number } | null;
  /** The waymark showing now, or null. */
  mark: { x: number; z: number } | null;
  /**
   * The line that finishes the level, or null.
   *
   * A point on it and the direction *towards* the target, which is square to
   * the line itself -- the same shape the rule and the painted stripe use, so
   * the three cannot disagree about where the line is.
   */
  line: { x: number; z: number; ux: number; uz: number } | null;
}

export interface Minimap {
  update(view: MinimapView): void;
  dispose(): void;
}


/**
 * Where a place on the ground lands on the panel.
 *
 * Pulled out and exported because it is the one piece of this with a rule in
 * it, and it is a rule that is easy to get subtly wrong and impossible to
 * check by eye: a map turned the other way round looks like a map.
 *
 * Forward is up. `middle` is the middle of the panel in pixels and `scale`
 * how many pixels a metre is worth.
 */
export function onPanel(
  at: { x: number; z: number },
  heading: number,
  place: { x: number; z: number },
  middle: number,
  scale: number,
): { x: number; y: number } {
  const dx = place.x - at.x;
  const dz = place.z - at.z;
  return {
    // How far to the bird's right, and how far ahead of it. Facing nought is
    // -Z, so ahead is `-dz` and the right hand is `+dx`.
    x: middle + (dx * Math.cos(heading) + dz * Math.sin(heading)) * scale,
    y: middle - (dx * Math.sin(heading) - dz * Math.cos(heading)) * scale,
  };
}

export function createMinimap(container: HTMLElement, roads: readonly Road[]): Minimap {
  const canvas = document.createElement('canvas');
  canvas.className = 'hud-minimap';
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = SIZE * dpr;
  canvas.height = SIZE * dpr;
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d')!;
  const middle = SIZE / 2;
  const scale = middle / REACH;

  // Every street segment, bucketed by where it is, once.
  const grid = new Map<string, number[][]>();
  const key = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  for (const road of roads) {
    for (let i = 1; i < road.points.length; i += 1) {
      const a = road.points[i - 1]!;
      const b = road.points[i]!;
      const segment = [a[0], a[1], b[0], b[1], road.width];
      // Filed under both ends, so a segment longer than a cell is still found
      // from either side of it. Longer than two cells is possible and rare,
      // and the worst it costs is a street that appears a little late.
      for (const at of [key(a[0], a[1]), key(b[0], b[1])]) {
        const bucket = grid.get(at);
        if (bucket) bucket.push(segment);
        else grid.set(at, [segment]);
      }
    }
  }

  return {
    update(view) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, SIZE, SIZE);

      // Turned so forward is up: ahead of the bird goes to the top of the
      // panel and its right hand to the right of it.
      const to = (x: number, z: number) =>
        onPanel(view.at, view.heading, { x, z }, middle, scale);

      // The ground, and a round window onto it.
      ctx.save();
      ctx.beginPath();
      ctx.arc(middle, middle, middle - 1, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(18, 22, 26, 0.62)';
      ctx.fill();
      ctx.clip();

      // Streets. Wider roads drawn wider, which is most of what makes a
      // district recognisable from above.
      const gx = Math.floor(view.at.x / CELL);
      const gz = Math.floor(view.at.z / CELL);
      const span = Math.ceil(REACH / CELL);
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(190, 200, 214, 0.5)';
      for (let ox = -span; ox <= span; ox += 1) {
        for (let oz = -span; oz <= span; oz += 1) {
          for (const [ax, az, bx, bz, width] of grid.get(`${gx + ox},${gz + oz}`) ?? []) {
            const a = to(ax!, az!);
            const b = to(bx!, bz!);
            ctx.lineWidth = width! > 12 ? 2.2 : width! > 8 ? 1.5 : 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // The finishing line, in the yellow it is painted on the ground.
      if (view.line) {
        // The line runs square to the way towards the target, so its own
        // direction is that turned a quarter.
        const on = to(view.line.x, view.line.z);
        const along = to(
          view.line.x - view.line.uz * REACH * 2,
          view.line.z + view.line.ux * REACH * 2,
        );
        const back = to(
          view.line.x + view.line.uz * REACH * 2,
          view.line.z - view.line.ux * REACH * 2,
        );
        ctx.strokeStyle = 'rgba(233, 196, 58, 0.95)';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(back.x, back.y);
        ctx.lineTo(along.x, along.y);
        ctx.stroke();
        void on;
      }
      ctx.restore();

      // The rim, drawn after the clip so the streets do not paint over it.
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(middle, middle, middle - 1, 0, Math.PI * 2);
      ctx.stroke();

      // The waymark showing now, if there is one: help, in the colour the
      // column on the ground is.
      if (view.mark) pip(ctx, to(view.mark.x, view.mark.z), middle, '#54e0ff', 3);

      // And what the level is aimed at, which is the point of the whole
      // thing. Held at the rim when it is off the map, pointing at it: a
      // target you cannot see is exactly the case this exists for.
      if (view.target) {
        const spot = to(view.target.x, view.target.z);
        const dx = spot.x - middle;
        const dy = spot.y - middle;
        const away = Math.hypot(dx, dy);
        const edge = middle - 9;
        if (away <= edge) {
          pip(ctx, spot, middle, '#e0533f', 4.5);
        } else {
          const at = { x: middle + (dx / away) * edge, y: middle + (dy / away) * edge };
          ctx.save();
          ctx.translate(at.x, at.y);
          ctx.rotate(Math.atan2(dy, dx) + Math.PI / 2);
          ctx.fillStyle = '#e0533f';
          ctx.beginPath();
          ctx.moveTo(0, -7);
          ctx.lineTo(5, 5);
          ctx.lineTo(-5, 5);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }

      // The bird, at the middle, pointing up because the map is turned rather
      // than the bird.
      ctx.fillStyle = '#f4f7fb';
      ctx.beginPath();
      ctx.moveTo(middle, middle - 6);
      ctx.lineTo(middle + 4.5, middle + 5);
      ctx.lineTo(middle, middle + 2.5);
      ctx.lineTo(middle - 4.5, middle + 5);
      ctx.closePath();
      ctx.fill();
    },
    dispose() {
      canvas.remove();
    },
  };
}

/** A dot, with a dark ring so it reads against a street. */
function pip(
  ctx: CanvasRenderingContext2D,
  at: { x: number; y: number },
  middle: number,
  colour: string,
  radius: number,
): void {
  void middle;
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = 'rgba(12, 16, 20, 0.7)';
  ctx.stroke();
}
