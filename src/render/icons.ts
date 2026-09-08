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

/**
 * The colours these are drawn in.
 *
 * A small palette, and the same one throughout, so that the set reads as one
 * set: what a colour *means* is the point of having any. Amber warns, red is
 * the ground and the things that hurt, green is safe, and the sky and the
 * bird keep their own.
 *
 * Held against the panel's dark ground rather than against the sky, because
 * that is where they are: the tip card is nearly black at 86% opacity.
 */
const INK = {
  bird: '#dfe6ef',
  wing: '#9fb0c6',
  beak: '#e8a24b',
  crow: '#20242b',
  crowEdge: '#4a5261',
  warn: '#e8a24b',
  danger: '#e0533f',
  safe: '#7fe0a8',
  sky: '#54e0ff',
  ground: '#7d8a6a',
  metal: '#b9bcb8',
  dark: '#333a44',
  seed: '#d8c37a',
  tram: '#f2c53d',
} as const;

/** One stroke or shape of an icon. */
interface Mark {
  d: string;
  /** Filled rather than stroked. For beaks, eyes, seeds and arrowheads. */
  fill?: boolean;
  /** Thinner than the rest, for detail that would otherwise clot. */
  thin?: boolean;
  /** Thicker, for the one line the icon is about. */
  bold?: boolean;
  /** What colour, from `INK`. Left out, it takes the panel's own. */
  ink?: keyof typeof INK;
  /** Filled in this colour and outlined in `ink`, for anything with a body. */
  wash?: keyof typeof INK;
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
const GROUND: Mark = { d: 'M2.5 20.5h19', ink: 'ground', bold: true };

/**
 * A gliding bird, side on, wings out. The shape the game is about.
 *
 * Written once and reused turned and shrunk, so that the bird pitching down
 * and the bird pitching up are recognisably the same creature -- which is the
 * whole reason the panel has pictures rather than symbols.
 *
 * The body is washed rather than outlined: at thirty pixels a filled shape
 * survives and a two-curve outline of the same shape does not, and these are
 * read in the corner of the eye while flying.
 */
const bird = (turn?: string): Mark[] =>
  (
    [
      // The far wing, behind the body and a shade darker, which is the whole
      // of what makes it three-dimensional.
      { d: 'M10.6 10.4q-3.6-3.6-7.4-1.4 2.6 3.4 6.4 4z', wash: 'wing', ink: 'wing', thin: true },
      // The body and tail.
      { d: 'M6.6 11.8q2.4 3.6 6.6 3.6 3.4 0 5.4-2.6l2.6.4-2.6 1.6q-2.6 2.6-6.4 2.4-4.4-.2-6.6-4z', wash: 'bird', ink: 'bird', thin: true },
      // The near wing, raised.
      { d: 'M11 10.6q3-4.2 7.6-1.6-2.6 3.8-6.6 4.2z', wash: 'bird', ink: 'bird', thin: true },
      // The head, and the beak that says which end is the front.
      { d: 'M17.4 12a1.5 1.5 0 100-3 1.5 1.5 0 000 3z', wash: 'bird', ink: 'bird', thin: true },
      { d: 'M18.7 10.1l2.6.5-2.4 1.1z', fill: true, ink: 'beak' },
      { d: 'M17.9 10.1a.35.35 0 100 .7.35.35 0 000-.7z', fill: true, ink: 'crow' },
    ] as Mark[]
  ).map((mark) => (turn ? { ...mark, turn } : mark));

export const ICONS = {
  /**
   * Bank right, and bank left.
   *
   * Two things say which way, because one was not enough: the bird is tipped
   * over the way it is going -- a bank is what a turn *is* -- and the arrow
   * sweeps that way underneath it.
   */
  turnRight: [
    ...bird('rotate(24 12 12) translate(0 -3) scale(.86) translate(2 2)'),
    { d: 'M4.5 19.6q7 2.6 13-3.6', ink: 'sky', bold: true },
    { d: 'M15.2 12.9l4 2.4-2.6 3.6z', fill: true, ink: 'sky' },
  ],
  /** Bank left. See `turnRight`. */
  turnLeft: [
    ...bird('rotate(-24 12 12) translate(0 -3) scale(.86) translate(2 2)'),
    { d: 'M19.5 19.6q-7 2.6-13-3.6', ink: 'sky', bold: true },
    { d: 'M8.8 12.9l-4 2.4 2.6 3.6z', fill: true, ink: 'sky' },
  ],
  /** Trees to fly between, and the gap that is the way through. */
  trees: [
    { d: 'M6 17.6l-3.4-.2L6 11.4l-2.6-.2L6.4 4.6l3.4 6.6-2.6.2 3.4 6.2z', wash: 'safe', ink: 'safe', thin: true },
    { d: 'M18 17.6l3.4-.2L18 11.4l2.6-.2-3-6.6-3.4 6.6 2.6.2-3.4 6.2z', wash: 'safe', ink: 'safe', thin: true },
    { d: 'M5.4 17.6h1.2v2.6H5.4zM17.4 17.6h1.2v2.6h-1.2z', fill: true, ink: 'beak' },
    GROUND,
  ],
  /** Somewhere ahead, and you are nearly at it. */
  arriving: [
    { d: 'M12 3c-3.2 0-5.8 2.5-5.8 5.6 0 4 5.8 9.8 5.8 9.8s5.8-5.8 5.8-9.8C17.8 5.5 15.2 3 12 3z', wash: 'danger', ink: 'danger', thin: true },
    { d: 'M12 6.4a2.3 2.3 0 100 4.6 2.3 2.3 0 000-4.6z', fill: true, ink: 'crow' },
    { d: 'M7 21.2h10', ink: 'ground', bold: true },
  ],
  /** Put down here: the bird on a glide path down onto the ground. */
  land: [
    ...bird('translate(-2 -5) scale(.7) translate(3 1)'),
    { d: 'M4 5.5q8 8.4 15 12.4', ink: 'sky', thin: true },
    { d: 'M15.2 15.9l4.8 2.6-3.8 2.5z', fill: true, ink: 'sky' },
    GROUND,
  ],
  /** Grain on the ground, which is the whole errand. */
  seeds: [
    { d: 'M7 15.2a1.6 1.6 0 100 3.2 1.6 1.6 0 000-3.2z', fill: true, ink: 'seed' },
    { d: 'M12 13a1.6 1.6 0 100 3.2 1.6 1.6 0 000-3.2z', fill: true, ink: 'seed' },
    { d: 'M17 15.7a1.6 1.6 0 100 3.2 1.6 1.6 0 000-3.2z', fill: true, ink: 'seed' },
    { d: 'M9.6 11.2a1.3 1.3 0 100 2.6 1.3 1.3 0 000-2.6z', fill: true, ink: 'seed' },
    { d: 'M15.4 11.7a1.3 1.3 0 100 2.6 1.3 1.3 0 000-2.6z', fill: true, ink: 'seed' },
    { d: 'M4.4 17a1.1 1.1 0 100 2.2 1.1 1.1 0 000-2.2z', fill: true, ink: 'seed' },
    { d: 'M19.6 16.7a1.1 1.1 0 100 2.2 1.1 1.1 0 000-2.2z', fill: true, ink: 'seed' },
    GROUND,
  ],
  /** A crow, and the difference is the wings: up, spread, coming at you. */
  crow: [
    { d: 'M12 15.4l-8.8-6.8q1.4 5.2 3.7 6.8-3-.6-4.7-2.4Q3.5 18.2 8 19.6z', wash: 'crow', ink: 'crowEdge' },
    { d: 'M12 15.4l8.8-6.8q-1.4 5.2-3.7 6.8 3-.6 4.7-2.4Q20.5 18.2 16 19.6z', wash: 'crow', ink: 'crowEdge' },
    { d: 'M12 6.2a2.8 2.8 0 100 5.6 2.8 2.8 0 000-5.6z', wash: 'crow', ink: 'crowEdge' },
    { d: 'M14 8l3.8-1-3.1 2.6z', fill: true, ink: 'warn' },
    { d: 'M12.9 7.9a.5.5 0 100 1 .5.5 0 000-1z', fill: true, ink: 'danger' },
  ],
  /** Stay up there. */
  high: [
    { d: 'M12 20.2V6.4', ink: 'sky', bold: true },
    { d: 'M7.8 9.4L12 3.8l4.2 5.6z', fill: true, ink: 'sky' },
    GROUND,
  ],
  /** Faster: a dial, wound round. */
  speed: [
    { d: 'M3.2 17.8a9.8 9.8 0 1117.6 0', ink: 'metal', bold: true },
    { d: 'M4.9 11.2l1.4 1.1M12 7.8v1.6M19.1 11.2l-1.4 1.1', ink: 'metal', thin: true },
    { d: 'M16.4 8.2a7.6 7.6 0 014.2 6.4', ink: 'danger', bold: true },
    { d: 'M12 16.4l4.8-6.6-6.2 4.8z', fill: true, ink: 'danger' },
    { d: 'M12 18.1a1.7 1.7 0 100-3.4 1.7 1.7 0 000 3.4z', wash: 'dark', ink: 'metal', thin: true },
  ],
  /** Nothing hunting here. */
  safe: [
    { d: 'M12 3.2l7.4 2.6v6.6c0 4.1-3.2 6.9-7.4 8.4-4.2-1.5-7.4-4.3-7.4-8.4V5.8z', wash: 'dark', ink: 'safe', thin: true },
    { d: 'M8.4 12.2l2.7 2.7 4.5-5.2', ink: 'safe', bold: true },
  ],
  /** The thing to be on, or not on. */
  train: [
    { d: 'M4.6 6h14.8v9.4H4.6z', wash: 'tram', ink: 'dark', thin: true },
    { d: 'M6.8 8.2h3.6v3.6H6.8zM13.6 8.2h3.6v3.6h-3.6z', fill: true, ink: 'dark' },
    { d: 'M4.6 13.4h14.8v2H4.6z', fill: true, ink: 'dark' },
    { d: 'M7.8 15.4a2 2 0 100 4 2 2 0 000-4z', wash: 'dark', ink: 'metal', thin: true },
    { d: 'M16.2 15.4a2 2 0 100 4 2 2 0 000-4z', wash: 'dark', ink: 'metal', thin: true },
    { d: 'M2.4 17.6h2.2M19.4 17.6h2.2', ink: 'metal', thin: true },
  ],
  /** Something is about to happen that you would not have guessed. */
  careful: [
    { d: 'M12 3.4L21.8 20.2H2.2z', wash: 'warn', ink: 'warn', thin: true },
    { d: 'M12 9v5.2', ink: 'crow', bold: true },
    { d: 'M12 16.2a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4z', fill: true, ink: 'crow' },
  ],
  /** The nose has to come down before anything else is worth trying. */
  noseDown: [
    ...bird('rotate(34 12 12) translate(-1 -2) scale(.9) translate(1 1)'),
    { d: 'M19.2 7.4v9', ink: 'danger', bold: true },
    { d: 'M16.4 15.8l2.8 4.6 2.8-4.6z', fill: true, ink: 'danger' },
  ],
  /**
   * Wings, and the fact that they are moving.
   *
   * The same bird, with arcs over the wingtips. Drawn as two pairs of wings
   * at once -- the way a comic shows movement -- it came out a butterfly: a
   * symmetrical four-winged thing is a moth, whatever it was meant to be.
   */
  flap: [
    ...bird('translate(0 3)'),
    { d: 'M5.6 8.4q1.8-3.6 5-4', ink: 'sky', thin: true },
    { d: 'M13.4 8q2-3.4 5.2-3.4', ink: 'sky', thin: true },
    { d: 'M3.6 10.6q1-3.4 3.6-5', ink: 'sky', thin: true },
  ],
  /** Nose up, now, before the ground arrives. */
  pullUp: [
    ...bird('rotate(-30 12 12) translate(-1 4) scale(.9) translate(1 1)'),
    { d: 'M19.2 7v9.6', ink: 'safe', bold: true },
    { d: 'M16.4 7.6l2.8-4.6 2.8 4.6z', fill: true, ink: 'safe' },
    GROUND,
  ],
  /** Out of puff: the bar the HUD shows, nearly empty. */
  tired: [
    { d: 'M3.2 9.2h14.6v5.6H3.2z', wash: 'dark', ink: 'metal', thin: true },
    { d: 'M4.6 10.6h2.8v2.8H4.6z', fill: true, ink: 'danger' },
    { d: 'M19 11h1.9v2H19z', fill: true, ink: 'metal' },
    { d: 'M8.2 6.4q1.5-1.8 3.2-.2M12.8 6.4q1.5-1.8 3.2-.2', ink: 'warn', thin: true },
  ],
  /** Too high for the room that is left. */
  descend: [
    { d: 'M3.6 4.4h16.8', ink: 'metal', thin: true },
    { d: 'M12 6.6v9.6', ink: 'sky', bold: true },
    { d: 'M7.8 14.6L12 20.2l4.2-5.6z', fill: true, ink: 'sky' },
  ],
  /** Wings out, backwards. The one control that takes speed away. */
  brake: [
    { d: 'M8 6.6h2.8v10.8H8zM13.2 6.6H16v10.8h-2.8z', wash: 'danger', ink: 'danger', thin: true },
    { d: 'M5.6 12H2.4M21.6 12h-3.2', ink: 'metal', thin: true },
    { d: 'M4.4 9.6L1.2 12l3.2 2.4z', fill: true, ink: 'metal' },
    { d: 'M19.6 9.6L22.8 12l-3.2 2.4z', fill: true, ink: 'metal' },
  ],
  /** Off the ground and away. The same picture as `land`, going the other way. */
  takeOff: [
    ...bird('translate(6 -6) scale(.7) translate(3 1)'),
    { d: 'M3.4 18.6q7-8.4 14-13', ink: 'sky', thin: true },
    { d: 'M14 3.2l5-1.4-1.2 5z', fill: true, ink: 'sky' },
    GROUND,
  ],
  /** Somebody is waiting for an answer. */
  talk: [
    { d: 'M3.4 5.4h17.2v10.4H10l-4.8 3.8v-3.8H3.4z', wash: 'dark', ink: 'bird', thin: true },
    { d: 'M8 10.4a1.3 1.3 0 100 2.6 1.3 1.3 0 000-2.6z', fill: true, ink: 'safe' },
    { d: 'M12 10.4a1.3 1.3 0 100 2.6 1.3 1.3 0 000-2.6z', fill: true, ink: 'safe' },
    { d: 'M16 10.4a1.3 1.3 0 100 2.6 1.3 1.3 0 000-2.6z', fill: true, ink: 'safe' },
  ],
  /** On foot, and something is in the way. */
  walk: [
    { d: 'M9.2 4.2a2 2 0 100 4 2 2 0 000-4z', wash: 'bird', ink: 'bird', thin: true },
    { d: 'M9.2 8.8l-2.8 4.6 1 5.8M9.2 8.8l3.2 3.4.6 6.4', ink: 'bird', bold: true },
    { d: 'M6.4 11.2L3.4 12.6', ink: 'bird', thin: true },
    { d: 'M17.2 5h3.6v14h-3.6z', wash: 'danger', ink: 'danger', thin: true },
    GROUND,
  ],
  /** The voice, on. */
  voiceOn: [
    { d: 'M3.6 9.4h3.8L12 5.2v13.6l-4.6-4.2H3.6z', wash: 'bird', ink: 'bird', thin: true },
    { d: 'M15 8.8q2 3.2 0 6.4', ink: 'safe', thin: true },
    { d: 'M18 6.4q3.2 5.6 0 11.2', ink: 'safe', thin: true },
  ],
  /** And off. */
  voiceOff: [
    { d: 'M3.6 9.4h3.8L12 5.2v13.6l-4.6-4.2H3.6z', wash: 'wing', ink: 'wing', thin: true },
    { d: 'M15.2 9.2l5.4 5.4M20.6 9.2l-5.4 5.4', ink: 'danger', bold: true },
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
    const line = mark.ink ? INK[mark.ink] : 'currentColor';
    if (mark.fill) {
      path.setAttribute('fill', line);
      path.setAttribute('stroke', 'none');
    } else {
      if (mark.wash) path.setAttribute('fill', INK[mark.wash]);
      if (mark.ink) path.setAttribute('stroke', line);
      if (mark.thin) path.setAttribute('stroke-width', '1.1');
      if (mark.bold) path.setAttribute('stroke-width', '2.1');
    }
    if (mark.turn) path.setAttribute('transform', mark.turn);
    svg.appendChild(path);
  }
  return svg;
}
