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

import { shortStop, type TramStop } from '../world/layout';
import type { Road } from '../world/streets';

/**
 * How far the map reaches from the bird, in metres, and how big the panel is
 * in pixels.
 *
 * The two together are the zoom: a pixel is worth `REACH / (SIZE / 2)` of
 * ground, which is a little over two metres.
 *
 * The panel went from 148 to 296 with the reach doubled alongside it, which
 * showed four times the ground at the same zoom. This is the panel kept and
 * the reach halved back: the same window, twice as close in. What that buys
 * is the street you are actually over rather than the district you are
 * somewhere in -- and nothing is lost at the far end, because anything past
 * the rim is already an arrow pointing at it.
 */
export const REACH = 320;
const SIZE = 296;

/**
 * The grid the streets are bucketed into, in metres.
 *
 * A hundred, so the panel's own reach is a three-by-three of cells at worst
 * and the draw looks at a few dozen segments rather than the seven and a half
 * thousand on the map. This runs every frame.
 */
const CELL = 100;

/**
 * How near two islands of the same name are the same stop, in metres.
 *
 * A stop is an island each side of the street and often two to a side, all
 * carrying the one name -- and a stop has one of these points per direction
 * on top of that. Written once per point, the panel says `Blaha Lujza tér` in
 * a pile of overlapping text.
 *
 * A hundred and eighty, because a junction stop puts its islands on different
 * arms of the crossroads and the widest such pair here -- Magdolna utca --
 * is a hundred and seventy-seven metres. Merged, the name sits at the middle
 * of them, which is the junction, which is where somebody would point.
 *
 * Only ever within one name, so no distance merges two different stops. What
 * a bigger number risks is two genuinely different places that happen to
 * share a name, and this district has none.
 */
const STOP_TOGETHER = 180;

/**
 * How many stop names the panel will show at once.
 *
 * Four. The panel is 320 m across and this district has a tram stop every
 * two hundred metres, so unlimited is six or seven names over a map the size
 * of a beer mat. The nearest few are the ones that answer "where am I".
 */
const STOPS_SHOWN = 4;

/** How many times a second a crow blinks on the panel. */
const CROW_BLINK = 3;

/**
 * What each sort of vehicle is drawn in.
 *
 * The tram in its own yellow, which is what one looks like from the air here.
 * A carriage pale, a goods wagon the brown of the rake in the yard, and the
 * engine a dark red -- kept clear of the target's own orange-red, since the
 * one thing on this panel that must never be mistaken for anything is the
 * thing you are flying to.
 */
const STOCK: Record<'engine' | 'wagon' | 'carriage' | 'tram', string> = {
  tram: '#f2c53d',
  carriage: '#cfd6df',
  wagon: '#9a7b52',
  engine: '#a8382c',
};

/**
 * What anything meaning "go here" is drawn in.
 *
 * One colour for all of it -- the target, the line that finishes the level,
 * and the waymark -- and it is the waymark's own blue, which is what the
 * column in the world already is. The target used to be red and the line
 * yellow, and yellow is what a tram is: forty of them are on this panel.
 *
 * The target and the waymark share it on purpose. They are the same
 * instruction. What tells them apart is size and shape: the target is bigger
 * and becomes an arrow at the rim, because it is the one you must not lose.
 */
const HEADING_INK = '#54e0ff';

/** The stop names: small, and in the pale grey-yellow a tram is. */
const STOP_TEXT = 9;
const STOP_INK = '#d8d2b4';

/**
 * How much of a name will ever be measured when it has to be cut to fit.
 *
 * A backstop rather than the rule -- what decides is how much room there is
 * beside the dot, which depends on where in the round panel it falls. This
 * only stops a hypothetical hundred-character name being measured a character
 * at a time.
 */
const STOP_CHARS = 32;

/** The fewest characters worth printing: below this it is not a name. */
const STOP_LEAST = 7;

/**
 * The flock, and her.
 *
 * Green because it is the one colour left that means nothing else here --
 * amber warns, red is what you are aimed at, cyan is help -- and green is
 * what every other map in the world paints a friend. Hers is her own body
 * colour, so the dot and the bird are recognisably the same creature.
 */
const FLOCK_GREEN = '#5cd68a';
const HER_PINK = '#ef9ab8';

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
   * Whatever is hunting, in local metres.
   *
   * Drawn only where they are: a crow is not a destination and an arrow held
   * at the rim would read as somewhere to go. What the map is for here is
   * "are they between me and where I am going", which is a question about a
   * place rather than a direction.
   */
  crows: readonly { x: number; z: number }[];
  /**
   * The flock in the air, in local metres, her excepted.
   *
   * Steady rather than blinking: they are company, not a threat, and a panel
   * where everything flashes says nothing about which of it matters.
   */
  flock: readonly { x: number; z: number }[];
  /**
   * Her, when she is out flying, in local metres.
   *
   * Her own dot in her own colour, because on the levels she is out on,
   * finding her is the level. She is one bird among a dozen in the air and
   * the map is the only place the difference is legible at a glance.
   */
  her: { x: number; z: number } | null;
  /**
   * The rolling stock near enough to draw, in local metres.
   *
   * Told apart by what they are, because on this map that is the whole of
   * what a train is worth showing: a tram is a thing you can land on that
   * stops every two hundred metres, a passenger train is a thing that leaves,
   * a goods rake is a thing that stands in a yard with grain on it, and the
   * engine is which end of one is the front.
   */
  stock: readonly {
    x: number;
    z: number;
    yaw: number;
    length: number;
    width: number;
    kind: 'engine' | 'wagon' | 'carriage' | 'tram';
  }[];
  /**
   * The world's own clock, in seconds, for anything that has to blink.
   *
   * Passed in rather than read off the wall here, so what the panel shows is
   * a function of the game rather than of how long the tab has been open.
   */
  now: number;
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

/**
 * The stops, one point apiece.
 *
 * Exported because the merging is the only part of this with a rule in it and
 * the rule is easy to get wrong quietly: too tight and the panel says a name
 * four times, too loose and two stops down the same street become one.
 */
export function namedStops(
  calling: readonly TramStop[],
): { x: number; z: number; name: string }[] {
  const merged: { x: number; z: number; name: string; count: number }[] = [];
  for (const stop of calling) {
    if (!stop.name) continue;
    // Merged on the name as *shown*, not as recorded. Two points a hundred
    // metres apart called `Blaha Lujza tér M` and `Blaha Lujza tér M
    // (Népszínház utca)` are one label twice over once the bracket is gone,
    // and printing the same words at two dots is the duplication this is here
    // to stop.
    const name = shortStop(stop.name);
    const near = merged.find(
      (had) => had.name === name && Math.hypot(had.x - stop.x, had.z - stop.z) <= STOP_TOGETHER,
    );
    if (near) {
      // The middle of however many islands carry the name, which for a pair
      // either side of a street is the middle of the street -- which is where
      // somebody would point when they said the name.
      near.x += (stop.x - near.x) / (near.count + 1);
      near.z += (stop.z - near.z) / (near.count + 1);
      near.count += 1;
    } else merged.push({ x: stop.x, z: stop.z, name, count: 1 });
  }
  return merged.map(({ x, z, name }) => ({ x, z, name }));
}

export function createMinimap(
  container: HTMLElement,
  roads: readonly Road[],
  calling: readonly TramStop[] = [],
): Minimap {
  const canvas = document.createElement('canvas');
  canvas.className = 'hud-minimap';
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = SIZE * dpr;
  canvas.height = SIZE * dpr;
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d')!;
  const middle = SIZE / 2;
  const scale = middle / REACH;
  const stops = namedStops(calling);

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

      // The trains, as the boxes they are.
      //
      // Drawn over the streets and under everything that matters, which is
      // where they belong: a tram on the map is context -- something on that
      // street, going that way -- rather than somewhere to go. Told apart by
      // colour, and the engine by being drawn a shade wider as well, since a
      // colour alone is four pixels at this scale.
      for (const car of view.stock) {
        const on = to(car.x, car.z);
        if (Math.hypot(on.x - middle, on.y - middle) > middle + 8) continue;
        ctx.save();
        ctx.translate(on.x, on.y);
        // Turned by the car's own bearing *and* by the panel's.
        //
        // A vehicle's `yaw` is the collider's, which takes a box's local +x to
        // world `(cos yaw, -sin yaw)` -- not the bird's convention, where
        // facing nought is -Z. Put through `onPanel`, that long axis comes out
        // at `(cos(yaw + heading), -sin(yaw + heading))`, and the canvas turns
        // its own +x towards +y, so the angle wanted is the negative of the
        // sum. Got wrong either way it draws a rake as a scatter of tilted
        // dashes rather than as a train, which is exactly how it looked.
        ctx.rotate(-(car.yaw + view.heading));
        ctx.fillStyle = STOCK[car.kind];
        const long = Math.max(3, car.length * scale);
        const across = Math.max(1.6, car.width * scale * (car.kind === 'engine' ? 1.9 : 1.35));
        ctx.fillRect(-long / 2, -across / 2, long, across);
        ctx.restore();
      }

      // The finishing line, in the blue it is painted on the ground.
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
        ctx.strokeStyle = HEADING_INK;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(back.x, back.y);
        ctx.lineTo(along.x, along.y);
        ctx.stroke();
        void on;
      }
      ctx.restore();

      // The tram stops, named.
      //
      // The one thing on this panel that is a place rather than a thing: a
      // player who knows this district knows where Blaha is, and a name on
      // the map is worth more to them than any amount of street geometry.
      // Under everything that moves, and in the tram's own yellow-grey, so it
      // reads as printing on the map rather than as something happening.
      const nearest = stops
        .map((stop) => ({ stop, spot: to(stop.x, stop.z) }))
        .filter(({ spot }) => Math.hypot(spot.x - middle, spot.y - middle) < middle - 26)
        .sort(
          (a, b) =>
            Math.hypot(a.spot.x - middle, a.spot.y - middle) -
            Math.hypot(b.spot.x - middle, b.spot.y - middle),
        )
        .slice(0, STOPS_SHOWN);
      ctx.font = `500 ${STOP_TEXT}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textBaseline = 'middle';
      const printed: { x: number; y: number; width: number }[] = [];
      /**
       * How far it is from the middle of the panel to the rim, at this height.
       *
       * The panel is round, so how much room a name has beside its dot is not
       * a fact about the panel -- it is a fact about how far up the panel the
       * dot is. A name that fits the square and not the circle is a name with
       * half of it clipped off, which is worse than no name.
       */
      const rimAt = (y: number) => {
        const room = middle - 4;
        const up = Math.abs(y - middle);
        return up >= room ? 0 : Math.sqrt(room * room - up * up);
      };
      /** The most of `text` that will fit in `room` pixels, or ''. */
      const fitted = (text: string, room: number) => {
        if (ctx.measureText(text).width <= room) return text;
        for (let keep = Math.min(text.length, STOP_CHARS); keep >= STOP_LEAST; keep -= 1) {
          const cut = `${text.slice(0, keep)}…`;
          if (ctx.measureText(cut).width <= room) return cut;
        }
        return '';
      };
      for (const { stop, spot } of nearest) {
        ctx.fillStyle = STOP_INK;
        ctx.fillRect(spot.x - 2, spot.y - 2, 4, 4);

        // Whichever side of the dot has more room, and as much of the name as
        // that room holds.
        const rim = rimAt(spot.y);
        const roomRight = middle + rim - (spot.x + 5);
        const roomLeft = spot.x - 5 - (middle - rim);
        const right = roomRight >= roomLeft;
        const label = fitted(stop.name, Math.max(roomRight, roomLeft));
        if (!label) continue;
        const width = ctx.measureText(label).width;
        ctx.textAlign = right ? 'left' : 'right';
        const at = right ? spot.x + 5 : spot.x - 5;
        const left = right ? at : at - width;
        // Not on top of a name already there. Two different stops can stand
        // sixty-seven metres apart in this district, which is thirty pixels,
        // and two names in the same thirty pixels is one unreadable name. The
        // dot is still drawn: something is there, and it is nearer than the
        // one whose name is printed.
        const clashes = printed.some(
          (had) =>
            Math.abs(had.y - spot.y) < STOP_TEXT + 3 &&
            left < had.x + had.width + 3 &&
            had.x < left + width + 3,
        );
        if (clashes) continue;
        // A dark backing, so a name over a street is still a name.
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = '#0d1116';
        ctx.fillRect(left - 2, spot.y - STOP_TEXT / 2 - 2, width + 4, STOP_TEXT + 4);
        ctx.globalAlpha = 1;
        ctx.fillStyle = STOP_INK;
        ctx.fillText(label, at, spot.y);
        printed.push({ x: left, y: spot.y, width });
      }
      ctx.textAlign = 'left';

      // The rim, drawn after the clip so the streets do not paint over it.
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(middle, middle, middle - 1, 0, Math.PI * 2);
      ctx.stroke();

      // The flock, and her among them. Under the crows in the drawing order
      // because a crow overlapping a flockmate is the more urgent of the two
      // to be able to see.
      for (const bird of view.flock) {
        const spot = to(bird.x, bird.z);
        if (Math.hypot(spot.x - middle, spot.y - middle) > middle - 4) continue;
        pip(ctx, spot, middle, FLOCK_GREEN, 2.6);
      }
      if (view.her) {
        const spot = to(view.her.x, view.her.z);
        // Bigger than the rest of them, which is the same trick her morph
        // plays: she has to be picked out of the flock at a glance.
        if (Math.hypot(spot.x - middle, spot.y - middle) <= middle - 4) {
          pip(ctx, spot, middle, HER_PINK, 4);
        }
      }

      // The crows, flashing, because a steady dot is scenery and these are
      // the one thing on the map that can kill you. Yellow like the line, and
      // told apart from it by blinking and by being a dot rather than a
      // stripe -- amber is what the rest of this game warns in.
      if (Math.floor(view.now * CROW_BLINK) % 2 === 0) {
        for (const crow of view.crows) {
          const spot = to(crow.x, crow.z);
          // Only where they are. Off the panel they are not drawn at all: see
          // `MinimapView.crows`.
          if (Math.hypot(spot.x - middle, spot.y - middle) > middle - 4) continue;
          pip(ctx, spot, middle, '#ffe14a', 3.4);
        }
      }

      // The waymark showing now, if there is one: help, in the colour the
      // column on the ground is.
      if (view.mark) pip(ctx, to(view.mark.x, view.mark.z), middle, HEADING_INK, 3);

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
          pip(ctx, spot, middle, HEADING_INK, 4.5);
        } else {
          const at = { x: middle + (dx / away) * edge, y: middle + (dy / away) * edge };
          ctx.save();
          ctx.translate(at.x, at.y);
          ctx.rotate(Math.atan2(dy, dx) + Math.PI / 2);
          ctx.fillStyle = HEADING_INK;
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
