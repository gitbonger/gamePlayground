/**
 * The described things in the world, as opposed to the generated ones.
 *
 * Everything else is worked out from the map: where the streets run, so where
 * the blocks are, so where the houses and the trees go. These are the other
 * way round. They are written down here, put in place before any of that, and
 * the generation gives way to them -- no house is built through one and no
 * tree is planted on one.
 *
 * That order is what makes them nameable. A level can say "The Loft" and rely
 * on it being a particular building of a particular shape at a particular
 * coordinate, rather than whichever house happened to come out nearest to a
 * point.
 */
import type { Landmark, Standing } from './world/layout';

/**
 * A described thing, in degrees, before it is projected into local metres.
 *
 * The same thing the layout calls a `Landmark`, said in the coordinates a
 * place is written down in. Declared as that type with the position swapped
 * so the two cannot drift apart: adding a field there is adding it here.
 */
export interface LandmarkSpec extends Omit<Landmark, 'x' | 'z'> {
  /** Where it stands, in degrees. */
  at: [number, number];
}

/**
 * A large block of flats, standing in its own ground.
 *
 * Ninety metres by forty-two and thirty-one to the terrace, which makes it
 * about three times the plan of the buildings around it without being taller
 * than it already was -- a slab you can pick out of a roofline from a
 * kilometre by its footprint rather than by its height.
 *
 * Half of it is one storey higher: a penthouse, whose windows look out over
 * the flat half, which is a terrace planted with bushes in two long rows. The
 * terrace is what the level asks you to land on -- not the top of the
 * penthouse -- and the turn puts it on the near side, so the half you are
 * aiming at is the half you meet first instead of being hidden behind the
 * taller one on every approach.
 *
 * The coordinate is not quite the one the terrace was first pinned at. That
 * point is thirteen metres from the kerb, which was room enough for a thirty
 * metre building and is not room for a ninety metre one; this is the same
 * block, moved far enough in that the walls stand clear of the streets rather
 * than across them.
 */
export const LOFT: LandmarkSpec = {
  name: 'The Loft',
  at: [47.495294, 19.081901],
  width: 90,
  depth: 42,
  // The terrace. The penthouse stands three and a bit above this.
  height: 31,
  // Turned to face the way the pigeon comes in, which is now from the west:
  // the level before it ends at a line out on the open ground, and a
  // checkpoint puts the next level's start on that line. Left facing east the
  // penthouse stood between the approach and the terrace, so the thing you
  // are aiming at was hidden until the last second.
  yaw: 0,
  margin: 9,
  penthouse: { cover: 0.5, rise: 3.2 },
  // Longer rows for a longer terrace: the spacing within a row is what makes
  // it read as a hedge rather than as a line of separate shrubs.
  planting: { rows: 2, perRow: 16, radius: 0.7 },
  // Somebody at the parapet, looking out over the city. Beyond the near row
  // of bushes rather than between them, so they are out of the strip the
  // bird comes down on, and turned to face off the edge.
  people: [{ along: -6, across: 17.5, facing: Math.PI }],
};

/**
 * A patch of concrete in the park, level with the grass.
 *
 * Flat, so landing on it, landing beside it and walking from one to the other
 * are all the same surface -- a level whose target you have to put down
 * *inside* is a much harder level than one you land near and walk onto. The
 * margin keeps the trees off it, and off the approach to it.
 */
/**
 * The first thing the hero is asked to land on: a slab of concrete in a park
 * most of a kilometre from the home tree.
 *
 * Nine hundred and fourteen metres, which is a flight rather than a hop and
 * is meant to be. Landing is the hard part of this game, and a level that
 * puts the hard part twenty seconds after the first take-off asks the player
 * to learn the two things at once. From twenty-three metres a pigeon glides
 * about a hundred and forty, so the rest of it is flown -- and by the time
 * the slab is in reach there has been a while to get the feel of the wings.
 *
 * Well inside the park at the far end of it: thirty-two metres from the
 * nearest kerb, so nothing about the approach is about avoiding anything.
 */
export const PARK_PATCH: LandmarkSpec = {
  name: 'The Concrete',
  at: [47.494099, 19.084403],
  width: 9,
  depth: 9,
  height: 0,
  margin: 7,
  // Somebody standing by it, on the far side from the way he comes in: in
  // view for the whole approach and not in the way of it, turned to face
  // across the slab so that a bird coming down onto it comes down in front
  // of them. Two metres of person is also the only thing in the world with
  // a size you already know, which is what makes a nine-metre slab read as
  // nine metres rather than as whatever size the eye decides.
  people: [{ along: -6, across: 0, facing: -Math.PI / 2 }],
};

/**
 * A second patch of concrete, on open ground across the city to the west.
 *
 * The same thing as the one in the park and laid the same way -- flush with
 * the ground, so landing on it, landing beside it and walking from one to the
 * other are all the same surface. What is different is where it is: twenty
 * metres of clear ground between a secondary road and a tramway, so the
 * approach is down a gap between buildings rather than across a field.
 */
export const WEST_PATCH: LandmarkSpec = {
  name: 'The Slab',
  at: [47.496589, 19.070153],
  width: 9,
  depth: 9,
  height: 0,
  margin: 7,
};

/**
 * A crowd standing about on a square, scattered but not on top of each other.
 *
 * Generated rather than written out, because twenty hand-placed pairs of
 * coordinates are twenty chances to put somebody in a wall and no way to tell
 * which -- and because what is wanted is not any particular arrangement, it
 * is *an* arrangement with nobody in the middle of the landing.
 *
 * Seeded, so it is the same crowd every run: a square where the people have
 * moved since you last flew over it is a square that is lying about being a
 * place.
 *
 * The hole in the middle is the point of the two radii. A pigeon has to come
 * down on this thing, and twenty two-metre solids spread evenly over it is a
 * square you cannot land on -- so they stand in a ring round the edges and
 * off across the paving, and the middle is left to the bird.
 *
 * The outer radius is not free either: a person outside the ground the
 * landmark has reserved is a person the generator is entitled to build a
 * house through.
 */
function crowdAround(count: number, seed: number, inner: number, outer: number): Standing[] {
  // The same small generator the flock uses, for the same reason.
  let a = seed >>> 0;
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return Array.from({ length: count }, () => {
    const around = random() * Math.PI * 2;
    // Square-rooted between the two radii, so they fill the ring evenly
    // rather than bunching against its inner edge.
    const away = Math.sqrt(inner * inner + random() * (outer * outer - inner * inner));
    return {
      along: Math.cos(around) * away,
      across: Math.sin(around) * away,
      // Facing anywhere. A crowd all pointed the same way is a queue, and a
      // crowd all facing the middle is an audience waiting for something.
      facing: random() * Math.PI * 2,
    };
  });
}

/**
 * Two squares in the eighth district, which are places to look rather than
 * places to land on.
 *
 * The hero is going round the neighbourhood asking after his mate, and what
 * he needs from each of them is only that it is somewhere he can arrive: open
 * ground, big enough to come down on without threading a gap, and named --
 * because a level names it and a monologue says its name out loud.
 *
 * Wider than the concrete patches on purpose. Those are targets and are meant
 * to be difficult; a square is a place you land *in*, and one nine metres
 * across would be a slab with a Hungarian name on it.
 */
export const MATYAS_SQUARE: LandmarkSpec = {
  name: 'Mátyás tér',
  at: [47.491961, 19.079619],
  width: 30,
  depth: 20,
  height: 0,
  margin: 8,
};

/**
 * The second one, four hundred and fifty metres north-west of the first.
 *
 * Further out than the search wanted it and that is the point of taking the
 * position from the map rather than from the story: it is three hundred short
 * of the loft, so going round the squares walks the hero towards the thing he
 * has not thought of yet without anybody having arranged it.
 */
export const JANI_SQUARE: LandmarkSpec = {
  name: 'Jani Pali tér',
  at: [47.495871, 19.077971],
  width: 26,
  depth: 18,
  height: 0,
  // Fourteen metres of clear ground round it, which is a good deal more than
  // the other landmarks ask for and is what makes it a square: nothing is
  // built within fourteen metres of the paving. It also has to be at least
  // this much, because the crowd stands out to twenty and reserved ground is
  // the only ground a person is certain not to be standing inside a wall on.
  margin: 14,
  // A square with people in it, which is what makes it a square rather than a
  // rectangle of paving with a name. Twenty of them, scattered.
  people: crowdAround(20, 1867, 8, 20),
};

/**
 * The home tree: where the hero and his mate nest, and where the story starts.
 *
 * A plane in a small park, grown far past anything else in it, with a crown
 * broad and flat enough on top to be a floor. Eleven metres across and
 * eighteen up -- so it clears the four-storey terraces around it, and so the
 * platform is a place rather than a perch: room for two pigeons, a nest, and
 * a walk between them.
 *
 * It is described rather than generated because a level names it. The margin
 * keeps the park's own trees off it, which is what makes it read as the one
 * big tree rather than as the tallest of a stand.
 */
export const HOME_TREE: LandmarkSpec = {
  name: 'The Home Tree',
  at: [47.493997, 19.096538],
  // The width is the *platform*, not the tree: two and three-quarter metres of
  // flat crest, which holds the nest, the two of them, and no more than that.
  // A treetop should feel like a perch rather than a roof. The crown itself
  // still reaches eleven metres across -- `spread` says so -- and hangs out
  // past the crest four times over, all the way round.
  width: 2.75,
  depth: 2.75,
  height: 18,
  margin: 10,
  canopy: { trunk: 1.5, skirt: 7, spread: 5.5 },
  // Off to one side of the middle, with its rim well inside the edge: on a
  // crest this size the nest, the pink one standing by it and whoever has
  // just landed are one group whether you arrange them or not, and what
  // actually needs arranging is that none of the three hangs over the drop.
  nest: { along: -0.85, across: 0.3 },
};

/**
 * A petrol station: a hut, a pump and a car on a forecourt, set back from the
 * road in the block beside the concrete, near the end of the long flight in.
 *
 * Small, and worth having for exactly that reason. Everything else described
 * in this file is something a level is *about*; this is the first thing that
 * is only there, and a city where the only landmarks are the ones you are
 * being sent to is a city that reads as a set of targets. It also keeps its
 * own ground: like every described thing, no house is built and no tree
 * planted inside its forecourt.
 */
export const PETROL_STATION: LandmarkSpec = {
  name: 'The Petrol Station',
  at: [47.493674, 19.085555],
  // The forecourt, which is the ground it takes rather than anything solid.
  width: 18,
  depth: 13,
  // The hut's own height, so the marker hangs at the top of the tallest thing
  // on the site rather than in the air over an empty rectangle.
  height: 3.1,
  margin: 6,
  station: {
    // The office along the back edge, turned to face out over the forecourt.
    hut: { along: -5.6, across: -3.4, facing: 0, width: 6, depth: 4.2, height: 3.1 },
    // The pump island in the middle, where a car can get at it from either
    // side, and a car at it -- pulled up alongside rather than parked on it.
    pump: { along: 2.2, across: 0.4, facing: 0 },
    car: { along: 2.6, across: 3.1, facing: 0 },
  },
};

export const LANDMARKS: readonly LandmarkSpec[] = [
  HOME_TREE,
  LOFT,
  PARK_PATCH,
  WEST_PATCH,
  PETROL_STATION,
  MATYAS_SQUARE,
  JANI_SQUARE,
];
