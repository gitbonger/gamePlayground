/**
 * A picture for every instruction.
 *
 * The corner used to be a key and some words, and words are the slowest thing
 * on the screen to read while flying. A picture is read at a glance and in any
 * language, which matters more now that there are two of them: `Varjak!
 * Repülj alacsonyan!` is four syllables longer than `Crows! Fly low!` and
 * arrives at the same speed the crow does.
 *
 * Drawn rather than fetched: twenty-four of these as files would be
 * twenty-four requests, and they are line art on a 24-unit grid, which is
 * cheaper written down than downloaded. `currentColor` throughout, so the
 * panel's own colour reaches them and a warning icon goes amber with the
 * warning.
 *
 * Named by what they mean rather than by what they show. `descend` is the
 * instruction; whether it is drawn as an arrow or a bird is a decision this
 * file gets to change without anything else knowing.
 */

/** One stroke or shape of an icon. */
interface Mark {
  d: string;
  /** Filled rather than stroked. For beaks, eyes, seeds and arrowheads. */
  fill?: boolean;
  /** Thinner than the rest, for detail that would otherwise clot. */
  thin?: boolean;
  /**
   * An SVG transform, for reusing one shape at another angle.
   *
   * A bird pitched down and a bird pitched up are the same bird, and drawing
   * the same fifteen curves twice at two angles is how a set of icons drifts
   * out of step with itself.
   */
  turn?: string;
}

/** The ground, shared by everything that happens near it. */
const GROUND = 'M3 20h18';

/**
 * A gliding bird, side on, wings out. The shape the game is about.
 *
 * Written once and reused turned and shrunk, so that the bird pitching down
 * and the bird pitching up are recognisably the same creature -- which is the
 * whole reason the panel has pictures rather than symbols.
 */
const bird = (turn?: string): Mark[] =>
  [
    { d: 'M3 10q4-4 7.5-.5' },
    { d: 'M10.5 9.5q4-4 8-.5' },
    { d: 'M6.5 12.4q2.6 3.2 6 3.2t5.6-2.6' },
    { d: 'M17.6 11.6l3 .6-2.8 1.4z', fill: true },
  ].map((mark) => (turn ? { ...mark, turn } : mark));


export const ICONS = {
  /**
   * Bank right, and bank left.
   *
   * Two things say which way, because one was not enough: the bird is tipped
   * over the way it is going -- a bank is what a turn *is* -- and the arrow
   * sweeps that way underneath it. Drawn with only the arrow, the two were
   * the same icon with a detail different, at thirty pixels, while flying.
   */
  turnRight: [
    ...bird('rotate(24 12 12) translate(0 -3) scale(.86) translate(2 2)'),
    { d: 'M4.5 19.5q7 2.6 13-3.4' },
    { d: 'M15.4 13.2l3.4 2.2-2.4 3.2z', fill: true },
  ],
  /** Bank left. See `turnRight`. */
  turnLeft: [
    ...bird('rotate(-24 12 12) translate(0 -3) scale(.86) translate(2 2)'),
    { d: 'M19.5 19.5q-7 2.6-13-3.4' },
    { d: 'M8.6 13.2l-3.4 2.2 2.4 3.2z', fill: true },
  ],
  /** Trees to fly between, and the gap that is the way through. */
  trees: [
    { d: 'M6 18l-3.2-.2L6 12l-2.4-.2L6.4 5.5 9.6 11.8 7.2 12l3.2 5.8z' },
    { d: 'M18 18l3.2-.2L18 12l2.4-.2L17.6 5.5 14.4 11.8l2.4.2L13.6 17.8z' },
    { d: GROUND, thin: true },
  ],
  /** Somewhere ahead, and you are nearly at it. */
  arriving: [
    { d: 'M12 3.5c-3 0-5.4 2.3-5.4 5.2 0 3.8 5.4 9.3 5.4 9.3s5.4-5.5 5.4-9.3c0-2.9-2.4-5.2-5.4-5.2z' },
    { d: 'M12 6.6a2.2 2.2 0 100 4.4 2.2 2.2 0 000-4.4z', fill: true },
    { d: 'M7 21h10', thin: true },
  ],
  /** Put down here: the bird on a glide path down onto the ground. */
  land: [
    ...bird('translate(-2 -4) scale(.72) translate(3 1)'),
    { d: 'M4.5 5.5q8 8 15 12', thin: true },
    { d: 'M15.6 16.4l4.6 2.4-3.6 2.4z', fill: true },
    { d: GROUND },
  ],
  /** Grain on the ground, which is the whole errand. */
  seeds: [
    { d: 'M7 15.4a1.5 1.5 0 100 3 1.5 1.5 0 000-3z', fill: true },
    { d: 'M12 13.4a1.5 1.5 0 100 3 1.5 1.5 0 000-3z', fill: true },
    { d: 'M17 15.9a1.5 1.5 0 100 3 1.5 1.5 0 000-3z', fill: true },
    { d: 'M12.4 10.6a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4z', fill: true },
    { d: 'M9.6 11.4a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4z', fill: true },
    { d: 'M15.4 11.9a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4z', fill: true },
    { d: 'M4.6 17.2a1.1 1.1 0 100 2.2 1.1 1.1 0 000-2.2z', fill: true },
    { d: 'M19.6 16.9a1.1 1.1 0 100 2.2 1.1 1.1 0 000-2.2z', fill: true },
    { d: GROUND, thin: true },
  ],
  /** A crow, and the difference is the wings: up, spread, coming at you. */
  crow: [
    { d: 'M12 15.4l-8.6-6.6q1.4 5 3.6 6.6-3-.6-4.6-2.4Q3.6 18 8 19.4z' },
    { d: 'M12 15.4l8.6-6.6q-1.4 5-3.6 6.6 3-.6 4.6-2.4Q20.4 18 16 19.4z' },
    { d: 'M12 6.8a2.4 2.4 0 100 4.8 2.4 2.4 0 000-4.8z', fill: true },
    { d: 'M14.2 8.4l3.4-1-2.8 2.4z', fill: true },
  ],
  /** Stay up there. */
  high: [
    { d: 'M12 20V6', thin: true },
    { d: 'M8 9.6L12 4.4l4 5.2z', fill: true },
    { d: 'M5 20h14' },
  ],
  /** Faster: a dial, wound round. */
  speed: [
    { d: 'M3.4 17.6a9.6 9.6 0 1117.2 0' },
    { d: 'M12 16.4l4.6-6.4-6 4.6z', fill: true },
    { d: 'M12 17.9a1.5 1.5 0 100-3 1.5 1.5 0 000 3z' },
    { d: 'M5.4 11.4l1.2 1M12 8.2v1.4M18.6 11.4l-1.2 1', thin: true },
  ],
  /** Nothing hunting here. */
  safe: [
    { d: 'M12 3.4l7.2 2.6v6.4c0 4-3.1 6.7-7.2 8.2-4.1-1.5-7.2-4.2-7.2-8.2V6z' },
    { d: 'M8.6 12.2l2.6 2.6 4.4-5', thin: true },
  ],
  /** The thing to be on, or not on. */
  train: [
    { d: 'M5 6.5h14v9H5z' },
    { d: 'M7.2 8.6h3.4v3.4H7.2zM13.4 8.6h3.4v3.4h-3.4z', thin: true },
    { d: 'M8 15.5a1.9 1.9 0 100 3.8 1.9 1.9 0 000-3.8z' },
    { d: 'M16 15.5a1.9 1.9 0 100 3.8 1.9 1.9 0 000-3.8z' },
    { d: 'M3 17.4h2M19 17.4h2', thin: true },
  ],
  /** Something is about to happen that you would not have guessed. */
  careful: [
    { d: 'M12 3.8L21.6 20H2.4z' },
    { d: 'M12 9.4v5', thin: true },
    { d: 'M12 16.4a1.1 1.1 0 100 2.2 1.1 1.1 0 000-2.2z', fill: true },
  ],
  /** The nose has to come down before anything else is worth trying. */
  noseDown: [
    ...bird('rotate(34 12 12) translate(-1 -2) scale(.9) translate(1 1)'),
    { d: 'M19 12.6v5' },
    { d: 'M16.4 16.2l2.6 4 2.6-4z', fill: true },
  ],
  /**
   * Wings, and the fact that they are moving.
   *
   * The same bird, with two arcs over the wingtips. Drawn as two pairs of
   * wings at once -- the way a comic shows movement -- it came out a
   * butterfly: a symmetrical four-winged thing is a moth, whatever it was
   * meant to be.
   */
  flap: [
    ...bird('translate(0 3)'),
    { d: 'M6 8.6q1.6-3.4 4.6-3.8', thin: true },
    { d: 'M13.6 8.2q1.8-3.2 4.8-3.2', thin: true },
  ],
  /** Nose up, now, before the ground arrives. */
  pullUp: [
    ...bird('rotate(-30 12 12) translate(-1 4) scale(.9) translate(1 1)'),
    { d: 'M19 11.4v5' },
    { d: 'M16.4 7.8l2.6-4 2.6 4z', fill: true },
    { d: GROUND, thin: true },
  ],
  /** Out of puff: the bar the HUD shows, nearly empty. */
  tired: [
    { d: 'M3.4 9.4h14.2v5.2H3.4z' },
    { d: 'M4.8 10.8h3v2.4h-3z', fill: true },
    { d: 'M19 11.2h1.8v1.6H19z', fill: true },
    { d: 'M8.4 6.6q1.4-1.6 3-.2M12.8 6.6q1.4-1.6 3-.2', thin: true },
  ],
  /** Too high for the room that is left. */
  descend: [
    { d: 'M4 4.6h16', thin: true },
    { d: 'M12 7v9.4', thin: true },
    { d: 'M8 14.4L12 19.6l4-5.2z', fill: true },
  ],
  /** Wings out, backwards. The one control that takes speed away. */
  brake: [
    { d: 'M8 7h2.6v10H8zM13.4 7H16v10h-2.6z' },
    { d: 'M5.4 12H2.6M21.4 12h-2.8', thin: true },
    { d: 'M4.2 9.8L1.4 12l2.8 2.2z', fill: true },
    { d: 'M19.8 9.8L22.6 12l-2.8 2.2z', fill: true },
  ],
  /** Off the ground and away. The same picture as `land`, going the other way. */
  takeOff: [
    ...bird('translate(6 -6) scale(.72) translate(3 1)'),
    { d: 'M3.5 18.5q7-8 14-12.5', thin: true },
    { d: 'M14.4 3.6l4.8-1.4-1.2 4.8z', fill: true },
    { d: GROUND },
  ],
  /** Somebody is waiting for an answer. */
  talk: [
    { d: 'M3.6 5.6h16.8v10.2H10l-4.6 3.6v-3.6H3.6z' },
    { d: 'M8 10.6a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4z', fill: true },
    { d: 'M12 10.6a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4z', fill: true },
    { d: 'M16 10.6a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4z', fill: true },
  ],
  /** On foot, and something is in the way. */
  walk: [
    { d: 'M9.4 4.6a1.9 1.9 0 100 3.8 1.9 1.9 0 000-3.8z' },
    { d: 'M9.4 9l-2.6 4.4 1 5.6M9.4 9l3 3.2.6 6.2' },
    { d: 'M6.8 11.4L3.6 12.8', thin: true },
    { d: 'M17.4 5.4h3.2v13h-3.2z' },
  ],
  /** The voice, on. */
  voiceOn: [
    { d: 'M4 9.6h3.6L12 5.6v12.8L7.6 14.4H4z' },
    { d: 'M15.2 9q1.8 3 0 6', thin: true },
    { d: 'M18 6.8q3 5.2 0 10.4', thin: true },
  ],
  /** And off. */
  voiceOff: [
    { d: 'M4 9.6h3.6L12 5.6v12.8L7.6 14.4H4z' },
    { d: 'M15.4 9.4l5.2 5.2M20.6 9.4l-5.2 5.2', thin: true },
  ],
} satisfies Record<string, readonly Mark[]>;

export type IconName = keyof typeof ICONS;

const SVG = 'http://www.w3.org/2000/svg';

/**
 * One icon, as an element ready to put in the page.
 *
 * Built out of nodes rather than a string of markup, for the same reason the
 * level list is: nothing here has to be parsed, so there is no arrangement of
 * characters that could be anything but a picture.
 */
export function drawIcon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'tip-icon');
  // Decoration: the words beside it say the same thing, and a screen reader
  // reading "picture of a crow, Crows! Fly low!" is saying it twice.
  svg.setAttribute('aria-hidden', 'true');
  for (const mark of ICONS[name] as readonly Mark[]) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', mark.d);
    if (mark.fill) {
      path.setAttribute('fill', 'currentColor');
      path.setAttribute('stroke', 'none');
    } else if (mark.thin) {
      path.setAttribute('stroke-width', '1.1');
    }
    if (mark.turn) path.setAttribute('transform', mark.turn);
    svg.appendChild(path);
  }
  return svg;
}
