# Pigeon Sim

A flight simulator where you are a homing pigeon.

You are released 607 m from home, pointed straight at it. Home is the **red
building**. Get there and land on the ground beside it.

```bash
npm install
npm run dev
```

Then open http://localhost:5183.

## Controls

| Key | Action |
| --- | --- |
| `W` / `S` | Pitch down / up |
| `A` / `D` | Roll left / right |
| `Q` / `E` | Yaw left / right |
| `Space` | Flap — costs stamina; climbs hardest when slow |
| `T` | Tuck the wings and dive |
| `B` | Brake — spread the wings, fan the tail, beat backwards |
| `R` | Release again |
| `L` | Levels — then a number to fly one |
| `H` | Hide the tuning panel |

Once you are down, the same keys mean something else:

| Key | Action, on foot |
| --- | --- |
| `W` / `S` or `↑` / `↓` | Walk forward / back |
| `A` / `D` or `←` / `→` | Turn on the spot |
| `Space` | Take off |
| `1` … `9` | Answer, when a pigeon has said something |
| `R` | Release again |

Turning is done by banking, not by yawing. Roll into the turn and the tilted
lift vector pulls you round; the tail keeps the nose following the flight path.

**Buildings and trees are solid.** Hit one above 7.5 m/s of closing speed and
the run is over. Slower than that and you scrape to a stop and slide.

**Roofs count.** Anything level enough to stand on is judged by exactly the
same rules as the ground, so a careful arrival on a rooftop is a landing and
the bird perches up there. A wall is still a wall.

**Touching the ground is the end of the flight, not of the run.** A clean
landing needs all three of: descending no faster than 4 m/s, no faster than
10 m/s through the air, and wings within 20° of level. Meet them and the bird
settles onto its feet, wings folded, facing where it landed — no summary
screen, because the game is not over. Miss any one and it is a crash, which
does end the run and does name what went wrong.

The approach is **brake to slow, beat to settle, flare to touch down**.
Coasting brings you to about 14 m/s; holding `Ctrl` takes that to 5.6 m/s, but
it also leaves you descending at 4.2 m/s — an airbrake is not a parachute, and
that is fractionally more sink than a landing allows. Holding `Space` at the
same time reverses the wingbeat and arrests it, which is the configuration you
actually land from. Then pull the nose up at roughly **five metres**.

Braking without beating will slow you beautifully and then drive you into the
ground; that is correct, and it is the single most useful thing to learn.

Flare too high and you balloon, stall, and drop. Glide straight in without
either tool and you arrive far too fast. Below 45 m the HUD shows the three
checks live, so you can see which one is still red.

## Stack

| Concern | Choice |
| --- | --- |
| Build | Vite |
| Language | TypeScript, strict |
| Rendering | Three.js |
| Live tuning | lil-gui |
| Tests | Vitest |

## Layout

```
scripts/
  fetch-map.ts bakes a real street network from OpenStreetMap
src/
  sim/         flight model, 3D math, collision, wind, autopilot — pure, no
               renderer imports
  render/      scene, bird rig, chase camera, HUD, game-over panel
  world/       streets.ts indexes real roads and areas.ts real parks;
               from-map.ts and layout.ts produce a CityLayout; city.ts turns
               one into meshes
  flock.ts     the pigeons at the loft, and putting them back when they die
  input.ts     keyboard to control axes
  run.ts       per-flight statistics
  debug-gui.ts live tuning panel
  main.ts      fixed-timestep loop, wiring
```

The one rule worth keeping: **`src/sim/` never imports Three.js.** That is what
makes the flight model unit-testable and lets the renderer be replaced without
touching the physics.

## How the flight model works

`src/sim/flight.ts` is a simplified aerodynamic model rather than an arcade
approximation, because the interesting behaviours fall out for free that way —
stalls, spiral dives, trading height for speed, banking into a turn.

Each tick it computes angle of attack and sideslip in the body frame, looks up
lift and drag coefficients, and applies lift perpendicular to the airflow, drag
along it, and a keel force resisting sideways slip. Rotation is rate-commanded
rather than torque-based: control inputs ask for a body rotation rate, damped
toward the target, and scaled by an authority term that falls off with airspeed
so a stalled bird goes limp until it has dived back up to speed.

Two details matter more than they look:

- **`trimAngle`** is the angle of attack the bird settles at with no input. It
  stands in for a tail's incidence. Without it, pitch stability trims the bird
  to zero lift and it simply falls out of the sky.
- **Fixed timestep** (120 Hz, with the renderer interpolating between ticks).
  A variable-dt flight model cannot be tuned, because every constant you pick
  is quietly a function of frame rate.

Default numbers land close to a real feral pigeon: 0.35 kg, 17.6 m/s cruise
(63 km/h), 2.3 m/s sink, a 6.2:1 glide ratio, and a wing loading of
57 N/m² against a rock dove's 55–60.

Everything in `FlightParams` and `CameraParams` is bound to the on-screen panel.
Tuning live is the intended workflow — the committed defaults are a starting
point, not an answer.

## The route

Two points in the world, named in degrees and projected into local metres by
`src/world/geo.ts`, which the map baker and the game share so a coordinate
lands in the same place in both:

| | |
| --- | --- |
| Release | 47.491540, 19.075658 |
| Home | 47.494953, 19.081954 |
| Distance | 607 m, on a bearing of 51° |

The bird is released **pointing exactly at home**, which is what `createBird`'s
heading argument is for.

**Distance is not the challenge, and the route is not sized against a glide.**
Stamina recovers at 0.14/s and drains at 0.07/s, so the bird can beat its wings
two thirds of the time indefinitely, and at that duty cycle it gains about a
metre a second. It can stay up and keep going as long as it likes. 607 m is a
distance you can cover several ways, not a budget you have to make last.

What the route asks for is the *arrival*: slow enough, low enough and level
enough to put down beside the red building, in a street bounded by 16–24 m
buildings. Coasting all the way there is one way to get it wrong — the bird
turns up 44 seconds later doing 12.7 m/s at 11 m, below the rooftops and much
too fast — but that is an observation about one way to fly it, not a limit.

The home point itself sits on open ground 13 m from a residential street, so
the red landmark is the building nearest it, about 32 m away.

Every control is a plain key. Modifiers make poor ones: the operating system
claims combinations built on them, and while one is held the browser often
stops delivering key-up events, so a control bound to a modifier can stick down
with no way to let go of it. Pressing one now releases everything instead.

Whichever generated building lands nearest the home point is marked. It gets
its own mesh rather than a seventh instanced bucket, because it is one building
among a couple of thousand — and because being marked means being recoloured
several times a second.

**It flashes, and it wears an arrow.** The target sits in an ordinary colour
and goes red once a second, on a raised cosine so it swells and fades rather
than snapping — a hard square wave at that size reads as a rendering fault
rather than a signal. Inside 130 m it stops, fading out across a band from
240 m rather than switching off at a threshold, because a marker that vanishes
abruptly looks broken rather than satisfied. Painting it permanently red, which
is what it used to do, made the landmark findable and also made it the one
building in the city that was obviously not a building.

The arrow above it is the part that is always there. It is scaled with its
distance from the camera so it subtends a constant angle — a marker you lose at
800 m is no marker at all, and this one is legible at 1,157 — and it is drawn
in **a pass of its own**, after the world, over a cleared depth buffer.

That last part took two goes. Turning the depth test off and giving it the
highest render order is the obvious answer and it is not enough: transparent
objects are drawn after every opaque one whatever their render order, so the
road and railway ribbons went straight over the top of an arrow that had
already been painted. Sorting cannot fix that, because the two are in different
passes. Putting the arrows in a scene of their own and clearing the depth
buffer before drawing them is an arrangement nothing can get in front of, and
it needs no depth tricks at all — there is simply nothing else in the pass.

Both halves of the marker are arithmetic and tested as such: what the flash
does across a second and across the fade band, and that the arrow's size stays
proportional to range with a floor so it does not vanish underfoot.

**Three of them, getting harder.** *The Park* is a patch of concrete on open
ground at midday: nothing to fly round, nothing that moves, and the whole
approach visible from the start. *The Loft* is twenty-four metres up on a roof
among other roofs in late-afternoon light — still nothing moving, but you have
to pick the right one. *The Yard* is a wagon of a running train under a low
evening sun, which is the first target that will not wait for you.

**Every target is a thing, never a place.** Open ground was the awkward case:
a wagon and a building are objects with a material each to flash and a top to
land on, and a field is a field. Rather than teach the marker about targets
that are not things, a level that wants one lays one — a patch of concrete in
the park. Everything downstream then treats all three kinds the same, and
there is no special case anywhere.

**And the patch is level with the grass**, a flat layer like the roads rather
than a slab sitting on top. A step of even ten centimetres makes the first
level a much harder one: you would have to put down *inside* the marking
rather than near it. Flush, landing on it, landing beside it and walking from
one to the other are all the same surface — which is the difficulty a first
level should have.

**A level is data, in `src/levels.ts`.** The map is settled, so a coordinate
written there means the same place for good — which is what makes a level
something you can describe rather than something you have to build. Each one
carries five things: a name, a point to be released at, an hour to fly it at,
a thing to land on, and somebody standing on it.

The hour is the interesting one. It is an instant rather than a light
direction, and the sun is worked out from the real solar position over the
map's own coordinates at that moment — so choosing an hour is a lighting
decision that cannot be wrong for the place. Changing level moves the sun, the
sky's own disc and glare, and the shadow frustum, all from the one number.

There is no story yet and no mechanism for one. These are landing problems in
increasing order of difficulty, and whatever eventually joins them up can be
another field on the same objects.

**Every level's target is built and sitting there dark.** Which one is lit is
the whole of switching between them, and so is a pigeon standing on each of
them: they are stationary birds on wagons that were going to be drawn anyway,
and a level nobody is playing having somebody waiting on it reads, correctly,
as a city with pigeons in it.

`playLevel` is the single path in. Starting the game, picking one out of the
menu and flying on from the one before are all the same thing happening: light
the target, move the sun, remember the choice, and release from the level's
own point pointed at its own target.

**Levels are separate places, not one long flight.** Finishing one and moving
on are two things. You meet the pigeon waiting at the target and that is the
level done — and then you are standing there with them, which is where the
conversation goes once there is one. The next level begins when you leave, at
its own point and its own hour, with nothing carried over.

Leaving is the take-off key, because flying on *is* what you do, but it is
taken before the flight model can have it: from a finished conversation it is
a transition to somewhere else rather than a launch from where you are. On the
last level there is nowhere to go, so it stays an ordinary take-off.

It is also less to build than a continuous world, and a fresh start each time
is rather more of an occasion than gliding on from wherever you happened to
put down.

### What they say

`src/dialogue.ts` is a tree, because a conversation is one: they say
something, you pick from what you might say back, and what they say next
depends on which you chose. One reply or several; a branch ends when there is
nothing left to say. The script is a placeholder and the same at the end of
every level — written as data, so that replacing it is writing different data,
and carried on the level itself so that giving one its own conversation is
changing one line.

An exchange keeps everything said, not only where it has got to. A
conversation you can see one line of is one you have to remember rather than
read, and the panel shows the whole of it: their line, your answer, their
reply.

Three keys do three things while you are standing there, and each of them
does nothing rather than something wrong:

- **A number** says the thing it is against. A number that is not on offer
  says nothing at all — being asked to choose between two things and pressing
  a third is not an answer, and putting words in the player's mouth would be
  worse.
- **`Space` mid-sentence is swallowed.** It is taken out of the input before
  the flight model can see it, so answering a question by flying off is not
  available either.
- **`Space` once the conversation is done** is what starts the next level.

**Which level you are on is remembered**, in local storage, and anything else
found there is treated as the beginning — a number from a build with more
levels in it, or something typed into the console. There is no version of that
worth throwing over. Storage that does not exist, refuses to be read or refuses
to be written are all ordinary cases rather than faults: the game is perfectly
playable without remembering anything.

**The arrow thins out as you arrive.** It does not shrink below a floor and is
drawn in front of everything, so on short final it was a yellow arrow filling
the screen, between you and the thing it was pointing at. That was survivable
while every target was a roof you came down onto from above; a patch of
concrete on the ground is approached *through* it. It fades to nothing over
the last twenty metres — faded rather than switched off, or the last frame
before it goes reads as the marker breaking, which is the same mistake the
flash used to make at its own threshold.

**`L` opens a level menu** and a number flies one. Digits do nothing while it
is closed, or every number typed during a flight would be a level change, and a
number that is not a level does nothing either, because a menu that closes
itself when you mistype is worse than one that waits.

**A level is finished by meeting somebody.** There is a pigeon standing on the
middle wagon, and walking up to it lights Level 2. That is one rule, not a
special case: `meeting()` in `src/sim/walk.ts` asks three things of any two
birds, and what happens next is the caller's business.

- **Both on their feet.** Flying past at speed is not meeting anyone.
- **Both on the same solid**, by the tag the collider gave whatever they came
  to rest on. This is the one that does the work: a bird on the ballast beside
  a wagon is a metre from a bird on its deck, and they have not met. Passing
  by on the track does not count.
- **Within two metres**, which is close enough that you had to walk up to it.

The distance is the whole distance rather than the ground plan, because two
metres straight up is a real place to be on a wagon with stakes. One case it
cannot tell apart is a low roof from the ground beneath it — neither is
tagged, so both read as "nothing" — and tagging buildings is the fix if
anything ever gets close enough for it to matter.

The resident is an ordinary `BirdState` marked as landed, standing on a named
solid, and nothing else. Everything that already knows what to do with a bird
on its feet then works on it without being told it is not a player: it rides
the wagon it is standing on through the same `carriedBy` pass the flock and
the player use, it is drawn perched by the same rig, and it is met by the same
rule that would let two players meet.

### What is being pointed at

There are two different things a level can be about, and which of them the
marker points at depends on what you are doing:

- **In the air, the target is a place** — the wagon or the building. It flashes
  red and the arrow hangs over it, right up to touchdown. This used to fade out
  inside 130 m, on the reasoning that a building blinking in your face while
  you are trying to put down on it is a distraction. That is backwards: the
  last stretch of an approach is exactly when you want to be certain you are
  lining up on the right roof.
- **On foot, the target is a pigeon.** The place has served its purpose, so it
  goes dark and the *bird* starts flashing instead, with the arrow moved over
  its head. A pigeon standing on a wagon among a dozen stakes is far too small
  to find by looking, and the same red pulse works on a bird as on a building —
  applied to the emissive rather than the colour, because a pigeon is a dozen
  materials of a dozen colours and multiplying that lot by red gives a muddy
  brown rather than a red pigeon.
- **Standing with them, there is nothing left to point at.** Both go dark and
  the arrow is hidden.

The marker is *told* which of those to do rather than working it out. Whether
the thing being pointed at is a building, a pigeon standing on it, or nothing
at all because the two of them are talking, is a question about the game and
not about the mesh.

### Conversation mode

**It is a third mode, not a variety of walking.** Flying and walking were
always distinct enough to need separate models, and standing talking to
somebody is a third — the thing that makes it one is that the player cannot
move at all. You walked up to them on purpose; being able to shuffle a foot
sideways and end the conversation by accident is not the behaviour of somebody
having one.

`stanceOf` says which of the three a bird is in and `asStance` lets the
controls through accordingly. Talking takes the movement away and leaves the
wing: a conversation you cannot walk out of but can *fly* out of is one you
leave deliberately, and it is also the only way out, so there has to be one. A
bird whose flight ended badly is in none of the three; it is not doing
anything.

Meeting somebody changes the shot. The chase camera comes off its boom and
stands to one side of the pair, holding both of them, aiming between them.

Side on rather than over either shoulder, because a two-shot taken from behind
one of them is a shot of the back of a pigeon. The stand-off comes from the
angle the pair subtends — `(span / 2 + margin) / tan(fov / 2)` — so they fill
the same part of the frame whether they are touching or a wing apart, and the
margin is also what stops the camera crowding two birds standing on top of each
other. There is no separate minimum distance; there was one, and it was never
once reached, because the margin alone already holds the camera three metres
off.

Of the two sides it could stand on it takes the one it is already nearer, so
walking round somebody does not send the camera sweeping through them.

It is the same camera, easing with the same smoothing, sharing the same boom
position and aim — so going into the shot and coming out of it need no cut and
nothing to blend between.

**But it has to be carried along with them.** An eased aim trails a moving
subject by about `speed × halfLife / ln 2`. On a wagon doing 6 m/s that is
three metres, and from a stand-off of four it pins both birds against one edge
of the frame and leaves them there — which is what a conversation on a running
train looked like. So the camera is moved by however far the pair moved before
any easing happens, leaving the ease only the gap it is actually for. A pair
travelling at a steady rate is then framed exactly, standing still or doing
sixty. Leaving the shot forgets where they were, or meeting somebody half a
kilometre later would fling the camera the same distance again.

**And they look at you.** Walking up to somebody turns them to face you, at
the same rate a walking pigeon turns on the spot, because it is the same
action: a bird noticing you and coming round to look. The short way round,
which matters more than it sounds — a heading of +3 radians and one of -3 are
a sixth of a radian apart and look like six, and without the wrap a bird asked
to turn a little to the right goes almost all the way round to the left.

Nothing about the marker is specific to buildings: it takes a material to
recolour and a height to hang the arrow over. Marking a wagon needed two
things. It gets its own mesh, pulled out of the merged rake, for the same
reason the landmark building does — one wagon cannot be recoloured inside a
mesh that holds thirteen. And the flash moved from the diffuse colour to the
**emissive**, because a wagon is one mesh of many vertex colours — timber,
rust, iron — and multiplying that lot by red gives a muddy brown rather than a
red wagon. Emissive is added rather than multiplied, so everything goes red
together whatever it started as. Measured off the framebuffer: 0 red pixels
dark, 38,607 lit.

The HUD's distance readout follows whichever level is lit, rather than always
pointing at the loft.

## Flying over a real place

The streets are real. The buildings are not.

`scripts/fetch-map.ts` queries OpenStreetMap for the roads around a point,
projects them into local metres, simplifies the polylines and bakes a JSON
asset. Run it once and commit the result — the game never talks to a map
server, so it works offline and cannot be broken by someone else's rate limit.

```bash
npm run fetch-map -- --centre 47.494593,19.081282 --radius 1200 --name home
```

The shipped world is that square of Budapest: 1,189 roads, 399 railways, 390
green areas, 173 kB. It is centred between the release point and the loft
rather than on either, so the flight stays inside it with room to wander. The
bird spawns over the release point, raised clear of whatever stands there.

The release point sits on the line from the loft *through the train*, 400 m
short of it, so the pigeon is let go facing both at once: the rake of wagons is
dead ahead and home is a kilometre directly beyond it. That distance is chosen
against what the bird can actually do -- from 120 m it glides 515 m and arrives
at 10.9 m/s, which is just over the 10 m/s a landing allows, so reaching the
wagons is a glide and settling on one wants the airbrake.

**It is fetched once and stored.** `home.json` is committed and imported as a
module, so the bundler builds it into the app: there is no request at run time,
nothing to load, and no map provider in the loop while you are flying. Changing
the area means re-running the baker and committing the result.

**Why not real buildings too?** Because OSM's road coverage is essentially
complete worldwide while its building *heights* are patchy — in most cities
you would get footprints with no height and have to invent them anyway. Seen
from the air, what makes a place recognisable is the street pattern.

**Parks are left alone.** The baker also fetches green space and water --
`leisure=park`, `landuse=grass|forest|cemetery`, `natural=wood|water` and
friends -- mapped to four coarse kinds. 243 areas here, 97% of them closed
ways; the handful of multipolygon relations are taken as their outer rings,
which ignores holes and at worst costs a few houses that were never there.

Nothing is built on that ground, and the check samples a grid across the whole
turned footprint rather than its centre or its corners. Corners alone catch a
building reaching *into* a park; they miss one large enough to stand right over
a small park, with all four corners out on the pavement.

This is most of what stops a generated city looking generated: real cities have
holes in them, and the holes are not random.

**The block, not the house, is the unit.** This district is built in perimeter
blocks -- one continuous building running right round the block, six or seven
floors of it, with a courtyard in the middle. Rows of separate houses along a
road cannot produce that however carefully they are placed, because nothing in
a row knows the block is a closed shape. The block has to come first:

1. **Trace the faces of the street network.** Every junction becomes a node,
   every stretch of road an edge; arrive at a node and always leave by the next
   way round clockwise, and the walk closes on the block it set out around.
   Faces that come back wound the other way are the outside of the network.
   The segments give 137 blocks, median around 10,000 m2 -- a 100 m square,
   which is what these blocks measure.
2. **Pull the ring in to the kerb**, each edge by its own street's half-width
   plus a 2 m setback, because a block with a boulevard on one side and three
   side streets is not a square anything -- then again by as much, because the
   true gap is startlingly tight to fly down. A residential street here is 8 m
   of carriageway, which left 12 m between facing walls. Doubled, at 24 m, it
   is a street a pigeon can use.
3. **Lay a wing of building round the inside**, 16 m deep -- a staircase and two
   rooms either side of it -- split into houses of 14-28 m frontage, each with
   its own height from a flat 16-24 m band. Even is not identical: neighbours
   differ by a storey, which is what stops a block reading as one extruded
   shape.
4. **What is left in the middle is the courtyard**, and where the gardens go.
   56 of the 150 blocks have room for one; the rest are built solid, which
   small blocks here really are, and the ones with no room for even a single
   house are planted instead. Nothing is left as bare grass between four roads.

Each frontage is laid out from its own edge and its two neighbours, not by
insetting the block as a ring. That was the first approach and it was too
brittle by half: one corner the offset could not resolve lost the whole block,
and once the streets were widened that came to 42 blocks and 32 hectares of
the map left as nothing at all. A corner that will not resolve should cost a
corner.

This was the part I expected to be too fragile to attempt, and the fear was
misplaced -- not because real map data is clean, but because every way it is
dirty fails gracefully. A dangling way is walked down and back and contributes
nothing. A crossing recorded without a shared node merges two blocks into one
larger one, which is a far better outcome than losing both. Both are tested.

**Shrinking a ring is where the real difficulty was.** Offsetting a polygon
inward is only well defined until its walls meet, and past that it fails
*quietly*. Inset a 100 m square by 80 m and what comes back is a tidy 60 m
square, wound the right way, comfortably inside the original -- and describing
ground the inset has no business claiming. Its area is plausible. Its corners
are all inside. Nothing about the result says it is wrong except that every
edge now runs backwards, which is exactly what "pushed the ring through
itself" means, and is the only check that catches it.

The opposite mistake was just as costly. Treating any reversed edge as failure
rejected every non-convex block on the map -- 55 of 144 at the kerb, and 39 of
the 56 blocks big enough for a courtyard, leaving 17 gardens where there should
have been 69. An edge that vanishes as a ring shrinks is not a failure; it is
what the shape does. Dropping it and re-fitting the rest is the fix.

**Filling every block took three fixes and one measurement.** The complaint was
that the city had holes in it -- polygons ringed by streets with neither houses
nor trees. Counted rather than eyeballed, it was 115 hectares: 83 of them six
genuine superblocks thrown out by a size cap set at 9 hectares, and 32 of them
blocks whose ring inset had collapsed. Lifting the cap, laying frontages per
edge, and planting whatever still would not build brought it to **0.13
hectares** of visible bare ground across the whole map.

The measurement that mattered was the last one. 14 blocks still come out empty,
which sounds like the job is half done -- until you check what is actually
there: they are slivers 4 to 14 m wide between a road and its service road,
and **93% of that ground is under the road surface already**. What is left is
about a tenth of a hectare in scraps of a few dozen square metres. Dropping the
minimum block size to catch even those was tried, measured, and reverted: it
changed the visible total from 0.16 to 0.18 hectares, which is to say it did
nothing.

That work also turned up a sign error worth recording. The frontage lines are
mitred against their neighbours by intersecting two offset lines, and the cross
product in the denominator was formed the wrong way round -- `a x b` where the
derivation gives `b x a`. Negating it mirrors every corner back to the middle
of its own frontage, so each edge built exactly half its length and stopped.
The city looked plausible the whole time. Fixing it took the map from 2,286
buildings to 3,858, and one test block from 17 to 37.

Corners are also why the tests state their claims against the block ring rather
than the nearest street. A house on the boulevard has its *side* to the side
street around the corner, and the nearest road to it is that one -- so "faces
the street it fronts" and "sits at the setback" are both false of it, measured
that way, while being perfectly true of the building.

**Turning them meant the collider had to stop being axis-aligned.** The world
bounds of a 12 m building turned 45 degrees are 40% wider than the building,
which would be felt as invisible walls while threading between them. A `Box`
now carries an optional `yaw`, and the sweep rotates the ray into the box's own
frame, runs *the identical slab test*, and rotates the answer back -- exact
oriented-box collision that reuses the tested path rather than adding a second
one. The uniform grid still indexes world bounds for broad phase. 141 distinct
building orientations here; a grid city would have about two.

**The railway is real too, and nothing is built on it.** OpenStreetMap has
excellent railway coverage and the query simply never asked for it. It does
now: 399 surface ways, 155 of heavy rail and 138 of tram in the original
square, filtered to what can actually be seen -- no tunnels (the metro here is
45 ways of them), no platforms or ventilation shafts, and none of the 64 razed
alignments that are lines on a map and nothing on the ground.

Each way carries a corridor width, which is not the gauge but the ground the
railway occupies, and both buildings and trees are kept off it. The test is
sampled across a footprint rather than measured from its middle, because a
corridor 8 m wide crossing a 26 m frontage at an angle passes nowhere near the
centre of it. A tram is the same machinery with a narrower corridor, and costs
the frontage nothing: it shares the carriageway, which is ground nothing was
built on anyway. Houses still stand half a metre from tram rails, as they do.

That last point was worth measuring rather than assuming. Lifting the block
size cap looked like it would put a housing estate across the Jozsefvaros goods
yard; counted, the closest building to heavy rail is 37 m, because the yard
falls in block *interiors* and became courtyard rather than frontage.

The track is drawn as one ribbon with two extra numbers per vertex -- how far
across the corridor and how far along the line, in metres -- from which the
shader puts a pair of rails at standard gauge, sleepers at their real spacing,
and ballast that thins out at the shoulder. Same trick as the windows and the
tiles, same reason: a fixed real size on any width of corridor.

Which is also how the ribbon was invisible for half an hour. It is wound face
down, exactly as the road ribbons are -- and the road material says so, in a
comment about winding not being worth fighting over, above a `side:
DoubleSide` that I did not copy across. Front-face culling then removed every
railway on the map. Replacing the shader with flat magenta and finding *that*
invisible too is what turned it from a shader problem into a two-word one.

**There is a train on the track, and the pigeon can land on it.** A rake of
twelve empty stake wagons behind a diesel, standing in the yard. It is laid out
as a distance *along* a line rather than a position on the ground, which is the
whole design: a train is where its leading coupling has got to, and everything
else follows from that, so setting it moving later is a matter of advancing one
number per train per tick and asking for the layout again. Several trains cost
nothing more than several numbers.

Each vehicle sits on its bogies, as a real one does -- the body is the chord
between two points on the line rather than a tangent at its middle -- which is
what keeps a 14 m wagon lying along the inside of a curve instead of hanging
off the outside of it. A consist that will not fit on its line produces no
train at all, half a rake over the end of a siding being worse than none.

The wagon is a deck at 1.25 m with stakes carrying on to 2.4, and nothing
between them: an open box a metre deep with a floor. That is what makes it
landable. The collider has no notion of a box that floats, so every part
stands on the ground, which costs nothing because under a wagon is not
somewhere to fly. Landing on the deck is held to exactly the rules that apply
to any other roof -- a gentle approach settles at 1.47 m, the deck plus the
bird's own radius, while arriving at 12 m/s is `too-fast` and dropping onto it
from 4 m up is `hard-impact`. All four of those are tests.

**A bird that lands on something moving goes with it.** A `Box` can carry an
opaque tag, a sweep reports the tag of whatever it hit, and `settle` records it
on the bird as `restingOn`. That is the whole of the concept, and the point of
the tag being a bare number is that the flight model has no idea what a wagon
is: it can say *which* solid it came to rest on and nothing more. Whoever built
the box knows what the number means.

Every box a vehicle owns takes the same tag, so a bird that puts down on the
deck, the solebar or a stake is aboard the same wagon either way. Each tick,
anything with a `restingOn` is read into its vehicle's own frame and written
back out of the new one — its place *on the deck* is what is preserved, not its
place in the world, and on a curve it turns with the wagon too. Landed on the
sixth wagon of a running rake, the pigeon holds its spot on the deck through
356 metres and two reversals.

That last part is why the carry is a frame transform rather than an offset, and
the difference is invisible on a straight line: with the wagon's yaw at zero,
"read into the vehicle's frame" and "shift by how far it moved" are the same
arithmetic. The test for it runs on a line laid diagonally for exactly that
reason — on an axis-aligned one it passes either way.

**The train runs.** It shuttles along its line at 6 m/s and turns round when
the line ends — reflected rather than clamped, so it comes back out at the
speed it went in rather than stalling against the buffers for a tick. The
consist is *not* turned round with it: a locomotive that finds itself at the
back is a train being propelled, which is what shunting is, and the alternative
is a rake flipping end for end in a single frame.

Making it move changed three things that had been baked in.

**Its geometry was in world coordinates**, merged into one mesh. A train that
moves cannot have its position in its vertices, so each vehicle is now built in
its own frame and given a transform — thirteen draw calls for a rake, and
moving one is free. That also removed the special case where a marked wagon had
to be pulled out of a merged mesh: every vehicle is already its own.

**Its collision boxes were in the world's grid**, which is built once and never
touched again. Rebuilding four thousand buildings to move thirteen wagons would
be absurd, so a train carries its own field, rebuilt from scratch every tick,
and `combineColliders` asks each in turn and takes the nearer hit. That costs
**0.015 ms a tick** — 0.19% of real time — which is nothing worth avoiding.

**And the line is now chosen for room rather than proximity.** Nearest was fine
when a train stood still. The nearest siding to this yard is 282 m and a rake
of twelve is 198 m of it, which left the train shuffling back and forth over
eighty metres and reversing every fourteen seconds. Picking the roomiest line
within 40 m of the asked-for point gives it 191 m to run and a reversal every
half minute.

Two consequences worth knowing. The flock roosts on the middle wagon, and the
anchor it is released from is read at the moment of release rather than when it
was built — so keeping one object up to date is all it takes for the birds to
leave from wherever the train has got to. And the Level 1 marker rides the
wagon it is on, or the arrow would hang over the patch of ballast the wagon
left.

**And it had to be drawn between ticks, like everything else that moves.** The
simulation steps a train in whole ticks; a frame lands wherever it lands
between two of them. Drawn at the last tick's position, a train covers five
centimetres at a stroke and then nothing, one jump on some frames and two on
others -- next to a camera gliding along with an interpolated bird, that reads
as the whole rake shivering, which is exactly what it was reported as. So the
renderer keeps where each train stood at the previous tick and asks for the
layout at `tweenAlong(previous, current, alpha)`, off the same `alpha` the bird
uses.

Between the last two ticks, not past the newest one. Extrapolation would be
just as smooth while a train runs straight -- both draw a constant-speed train
at a constant rate, and the smoothness test cannot tell them apart -- and then
it invents a position beyond the buffers on the tick the train turns round.
That is what the second test is for: over four thousand frames on a short line,
the drawn position never leaves the interval the simulation bracketed, which is
what keeps a drawn train on its own rails.

**The locomotive is worth looking at, and it smokes.** Frame, fuel tank slung
between the bogies, buffer beams and buffers, six wheels you can count, a hood
with radiator grilles down both flanks and a band of livery trim, a cab glazed
front, back and both sides under an overhanging roof, a short nose, lamps at
both ends, a radiator fan on the roof and the stack the exhaust comes out of.

The smoke is a particle system in `src/world/smoke.ts`, and there is no
Three.js in it. A puff is a position, a velocity and an age: it leaves the
stack with the engine's own motion plus a kick upward, is dragged toward
whatever the air is doing — so it lies down and drifts on the wind rather than
standing over the chimney — keeps rising while it is hotter than that air, and
spreads and thins as it goes. They live in a fixed ring, because something
emitting a hundred and fifty times a second for as long as the game is open
should not be allocating. The renderer's only job is to draw a smudge wherever
the physics says there is one, as one instanced billboard mesh.

**"A lot of smoke" is measurable, so it was measured.** Add up the area of
every puff and compare it against the area of the plume they make between them.
Below about one there are gaps and you can see the yard through it. The first
attempt came out at **1.8** — a wisp. It now runs at **15**, which is fifteen
hundred puffs over sixty-five metres, for 0.013 ms a tick. That ratio is a
test, and dropping the emission rate back fails it.

**Density is not opacity, and getting the two mixed up produced a speech
bubble.** The first version drew a plume you could not see into at all: a flat
black shape with an outline. Two mistakes, both in the renderer rather than the
physics. The per-puff opacity was worked out and then thrown away — used only
to skip puffs that had nearly died, never applied to what was drawn — so every
puff painted at full strength however old it was, and several hundred of them
stacked into a silhouette. And the material was pure *black*, which multiplied
the per-puff grey away to nothing, so the plume read as a hole in the sky
rather than as soot.

Three has no per-instance opacity, so each puff now carries a float of its own,
multiplied into the alpha in a patched shader. One bubble is about a fifth
opaque at its thickest and dark grey rather than black; it is the hundreds of
them overlapping that make the plume solid, which is what lets you see *into*
it — dense in the middle, thinning at the edges, individual bubbles legible
against each other. The regression test is that the opacity actually reaches
the draw, and it fails the moment that value is dropped again.

Verifying the smoke on screen took four wrong answers first, all of them mine.
Probe cameras placed to look at the plume from a convenient angle reported it
invisible — billboards face the camera the *app* is rendering with, so from any
other direction they are edge-on slivers, and 76 pixels of a 448,000-pixel
frame changed. Photographed from the direction they actually face, the same
plume covers 22,405. Two earlier readings blamed the material and the texture,
and both were wrong for the same reason.

**Windows and roof tiles are drawn in the shader, off world coordinates.**
Both patterns face the same problem: the walls are one shared box scaled per
instance, so anything keyed to the mesh UVs stretches, and a 26 m house would
get the same number of windows as a 14 m one, each twice the size. Reading the
pattern off world position and the surface normal instead makes a window the
same real size on every building on the map, with nothing stored per instance.
The ground floor gets none, where the shopfronts are, and about one pane in
eight is lit.

The roofs are gabled, pitched about 27 degrees, in courses of clay tile 26 cm
across, with the gable ends left as the party walls they are. The roof takes
the top few metres *of* the building rather than being piled on top of it, so
the ridge is still the height the layout says and the collision box, which
stops there, keeps its meaning. The landmark is the exception and stays flat:
it is the one building the pigeon is meant to put down on, and a ridge is
nowhere for a bird to stand -- the collider would settle it on the ridge line
with the tiles falling away underneath.

Windows are never lit. It is six in the evening in June; a lit window at that
hour reads as a mistake rather than as life. What varies between panes is how
much sky each is reflecting.

**Roofs are merged into one mesh; walls stay instanced.** The opposite of each
other, on purpose. An instance carries its shape as a scale, and a normal does
not survive a non-uniform one: scaling a unit prism to 17 m wide by 4 m tall
flattens its slope normals almost level, which is not a subtle error -- every
roof face tested as a gable end and the entire city came out rendered in grey.
A box does not care, because its normals are axis-aligned and stay that way
under any scale. So the buildings keep the six instanced buckets that hold the
whole skyline at a handful of draw calls, and every roof on the map is baked
into one geometry in world coordinates, for one more.

**The sun is where it actually was.** The light had been aimed by eye, which
is fine until you notice that shadows in a game set at a real latitude are
pointing somewhere that time of day never puts them. `src/render/sun.ts` is the
standard NOAA solar position calculation: give it the map's own coordinates and
a date and it returns the sun's altitude and bearing, and both the directional
light and the disc in the sky go exactly there.

The game is set at six in the evening on the longest day of 2025, which puts
the sun 24 degrees up and a little north of due west. Early afternoon was the
first choice and was wrong for a reason worth keeping: at 54 degrees the sun
sits above the top of the frame in level flight, so the pigeon never sees it. A
realistic sun you cannot look at is not worth the arithmetic.

The disc is drawn in the sky shader rather than placed as geometry -- nothing
to fly into, and it stays put however far the bird travels -- and its direction
is measured from the camera rather than from the origin, or it would slide
across the sky as the bird flew out from the middle of the dome. Measured off
the framebuffer, the disc comes out **0.504 degrees** across against the real
sun's 0.53.

Which is also the answer to whether any of this needed optimising: it did not.
Timed by rendering explicitly and waiting for the GPU, a frame costs **0.8 ms**
across 371 draw calls and 217,000 triangles. An earlier reading of 51 fps, and
the worry that went with it, was the browser throttling a hidden tab rather
than anything the renderer was doing -- a frame rate read from a page that is
not on screen measures the page not being on screen.

From 1,189 real streets, 399 railways and 390 green areas: 137 blocks, 4,203
buildings, 49 courtyards and 9,360 trees, built in about 190 ms, with 20,000
collision sweeps in 10 ms.

### Trees

Four sorts — a spruce, a poplar drawn out into a spike, a broadleaf with a
round crown on a stem, and an older, broader, paler one of the same. Told
apart by silhouette first and colour second, because at a hundred metres and
forty knots the outline is all there is. One instanced mesh per sort, so the
whole nine thousand of them are still a handful of draw calls.

**The sort is picked per place, not per tree.** Picked per tree it was visual
noise: every tree different from the one beside it reads as static rather than
as variety, and the uniform cones it replaced looked better. A block planted
with one sort reads as a stand of poplars, and the next block over being
something else is what having sorts is actually for. `plant()` is called once
per ring — a block's garden, a park — so one choice per call is exactly one
sort per place surrounded by roads.

Each shape is modelled one unit tall with its foot at the origin and already
in its own proportions, so the single scale a tree carries — a radius and a
height — places any of them. The proportion is baked into the geometry rather
than carried beside it as a number to multiply in later, because a number to
multiply in later is a number that can be left out; there was a version with
one, and nothing noticed when a mutation dropped it.

OpenStreetMap data is ODbL. The baked file is a derived database, so it carries
the attribution and the HUD keeps it on screen.

## The other pigeons

Ten of them, and they keep the player company rather than living anywhere. A
bird appears ten metres behind the player, picks somewhere at random inside a
fifteen-metre ball on their track to fly to, and picks somewhere else when it
gets there. The effect is a loose escort that keeps breaking up and re-forming,
which is what a flock does and, more to the point, means there is another
pigeon in shot.

**They come out one at a time**, a second apart, so it reads as a flock
gathering rather than as ten birds spawning at once. That was what the code
already claimed to do — there was a comment about staggering the start —
sitting directly above a line that set every bird's timer back to zero. And a
bird that hits something is back in the air on the same tick, which is worth
knowing if you go looking for a dead one: an ending is no longer visible from
outside at all, and a test that counted them by polling for it silently stopped
counting anything.

**This was tried once before and abandoned**, and the reason it works now is
worth writing down. The note that used to be here read: *"Chasing that with a
flock anchored to the player never really worked either."* It did not, because
the flock was flying the autopilot that crosses a city — 14 m/s, banking to 28
degrees, which is a turn of 37 m radius. A bird on those numbers physically
cannot stay inside a fifteen-metre ball. Left on them it wheels out to 137 m
and is only ever brought back by the stray rule, which is a teleport rather
than flying, and at that range it is three pixels of nothing.

So escorting has its own way of flying: 11 m/s and banking to 0.9 rad, which
turns inside about ten metres. Same wings, same flight model, different intent.
Measured over three minutes beside a leader who stays put, the flock sits at a
mean of 28 m and never gets past 70 — against 137 m and hard against the stray
limit before. The floor came down with it, from 38 m to 8: the player can be
standing on the ground now, and a flock that climbs away from a walking pigeon
is not keeping it company.

### Being seen

Getting them near the player turned out not to be the same problem as getting
them *in shot*, and the second one is the one that matters. Measured the way a
player experiences it — how often anything is inside the chase camera's 68
degree cone — a flock that stays close and flies at a sensible speed scores
**zero**. All ten airborne, all behind the lens. Two things fix it, and neither
is obvious from thinking about distances.

**Aim where the leader will be, not where they are.** Aiming at the point
somebody is standing on is pure pursuit, and pure pursuit always arrives behind
them: by the time the bird gets there the leader has moved on. The ball is
centred three seconds down the leader's track. At a standstill that lead is
zero and the ball sits on the leader exactly, which is the case the rule most
obviously means.

**And fly a little faster than them, not the same speed.** Birds are released
ten metres back, and two birds at the same speed stay ten metres apart for
ever — matching exactly can never bring one past. The cruise is the leader's
own speed plus 3 m/s, held between 11 and 30. Only a little in hand: at six the
flock overshoots, sits further out, and starts tripping the stray rule.

Fraction of frames with a pigeon in shot, over three minutes:

| Leader | Aimed at them, own speed | Aimed ahead, plus 3 m/s |
| --- | --- | --- |
| Still | 97% | 97% |
| 5 m/s | 38% | 86% |
| 11 m/s | 0% | 82% |
| 17 m/s — cruise | 0% | 85% |
| 22 m/s — diving | 0% | 31% |

The right-hand column is also the one with almost no recycling: aiming ahead
means a bird arrives where the leader is rather than where they were, so the
stray rule stops having to do the work.

### Three rules that keep it honest

**A target is picked evenly through the ball**, taking the radius as
`radius · ∛random` rather than `radius · random` — the second bunches half of
them inside half the radius, which is an eighth of the volume. The direction
comes from a cosine picked uniformly rather than an angle, because picking the
angle crowds the poles.

**Targets go stale.** A target is chosen against where the leader was at the
time. Without a timeout a bird chases the memory until the stray rule hauls it
back: beside a leader moving at 5 m/s, that is twelve recycles in two minutes
and a mean distance of 63 m, against zero recycles and 32 m with one.

**Nothing is aimed at the ground.** The leader can be on foot, and a target at
the leader's own height is then a target in the dirt.

### Coming down

Getting them to the player's height took fixing something older. The autopilot
had one height control -- `flap while below the waypoint` -- which is a way of
climbing and not a way of descending: above its waypoint a bird merely stopped
beating, and the vertical damping in the pitch trim then fought the sink it
needed. It could go up and it could not really come down.

Nothing had noticed, because until now the flock chose its own heights and
nothing was waiting for it at a particular one. Escorting a pigeon gliding down
from 120 m it sat a mean of **23 m above** and, over two minutes, was never
once below it. A flock that can only climb is a ceiling, not company.

Two fixes, and it takes both:

**A bird that is too high tucks.** The same control the player uses, and what a
bird actually does about height it does not want. There is a metre of slack so
there is still a gliding state between beating and diving rather than the bird
always doing one or the other.

**And the target height leads the leader's sink**, the way the target position
already leads their track. Without it the flock is 8 m high at a gentle glide
and 18 m high at 5 m/s, because the height it was aiming at is where the leader
*was*.

| Leader's sink | Before | Tuck only | Both |
| --- | --- | --- | --- |
| 1 m/s | +23 m | +1.6 m | −1.7 m |
| 3 m/s | — | +7.8 m | +1.4 m |
| 5 m/s | — | +17.6 m | +3.4 m |

The cost is worth naming: a bird that dives is a bird going faster, and a bird
going faster turns wider. Around a leader who stays put the flock's mean
distance went from 28 m to 37, and its worst from 70 to 97. Altitude was the
thing being complained about, and it is worth that.

They fly the same model the player does, on the same collider and in the same
wind, and nothing about them is special-cased: they stall, they get blown off
course, and when they hit a building they die exactly as the player does. They
come in the real feral pigeon colour schemes — blue bar, checker, spread, red,
mealy, pied, white, grizzle — picked deterministically, so it is the same flock
every run.

An earlier version had them wandering the map at large, which was a mistake
worth recording: they were *there*, but the nearest one was typically 274 m
away and three pixels across, and more than half the time none was inside the
camera's cone at all. A version after that had them roosting on the middle
wagon and scattering outward along the track, which solved being visible by
putting them somewhere the player was flying towards.

Moving them to the wagon turned up a latent bug worth keeping in mind: the
release used a fixed altitude and ignored the roost's own height, which nothing
had noticed because the only caller passed the same number. Anchoring them to
the player turned up its sibling — the flock is built at module scope and
releases its first bird immediately, which read the player's bird before it was
declared and threw on load. Neither is the sort of thing a unit test sees,
because a test passes its own leader.

`src/sim/autopilot.ts` flies them, and getting it to work taught four things
the hard way. The first three are the same mistake in different clothes:
commanding an *outcome* directly instead of the thing that produces it. The
fourth is a different one — only building half a controller.

- **Roll is a rate, not an attitude.** Commanding roll straight from heading
  error never stops rolling. The first version flew the whole flock inverted —
  median bank 79°, maximum 180° — and a bird on its back falls at 17 m/s. It
  now picks a bank angle and flies an inner loop to it, damped on the roll rate
  already under way. Median bank went to 1°.
- **Pitch flies the speed; the wings fly the height.** Pitching up to climb at
  ten metres a second just bleeds the speed the wing needs, and the bird sinks
  while pointing at the sky.
- **Rest before exhaustion, not after.** Thrust falls away with stamina, so a
  bird that beats until it is spent does most of its beating at a fraction of
  full power and sinks anyway — then never stops long enough to recover. The
  flap band sits high and narrow, which works out at about two thirds of the
  time on the wing: exactly what draining at 0.07/s and recovering at 0.14/s
  can sustain.
- **Half a controller reads as a working one until something needs the other
  half.** "The wings fly the height" only ever described climbing: above its
  waypoint a bird stopped beating, and the vertical damping in the pitch trim
  then fought the sink. It could go up and it could not really come down.
  Nothing noticed for as long as the flock picked its own heights and nothing
  was waiting for it at one — and then a flock asked to escort a gliding
  pigeon sat 23 m over it and never once dropped below. Tucking is what a bird
  does about height it does not want, and it is the same control the player
  has.

Together the first three took the flock from 333 crashes in five minutes to 18,
and from 70% of the time airborne to 98%. Ten birds cost about 0.013 ms a
tick.

## Wind

Pigeons almost never coast in a straight line. `src/sim/wind.ts` is why this
one doesn't either.

There is **no stored wind map**. The field is a pure function of position and
time, so only the air the bird is actually flying through ever gets computed.
Two layers:

- **A mean that strengthens with height**, on the power law used for
  atmospheric boundary layers. Friction drags the lowest air to a near
  standstill and the `shear` exponent says how quickly it recovers — about 0.3
  over rooftops. At the defaults that is 0 m/s at ground level, 2.0 at 10 m,
  4.0 at 100 m, 5.3 at 250 m.
- **Gusts on top**, as smooth spatial noise that also churns in place, scaled
  by the local mean so the air is rougher where it is faster.

**Faster across the map means rougher air, and nothing in the model tracks
ground speed to achieve it.** Because the gusts vary with *position*, covering
ground quickly means running through them quickly. Measured as the rate the
wind vector changes under the bird:

| Ground speed | Air changes at |
| --- | --- |
| 0 m/s (holding station) | 0.32 m/s per second |
| 11 m/s (cruise) | 0.64 |
| 20 m/s | 1.08 |
| 50 m/s (dive) | 2.60 |

Getting that monotonic took two goes. The first field had every octave drifting
the same way, so at about 30 m/s the bird surfed along with the pattern and the
gusts went eerily still — churn *fell* from 0.67 to 0.06. The octaves now point
every which way with mixed-sign rates, and a test sweeps ground speeds from 2
to 60 m/s to make sure no such blind spot comes back.

Wings work against the air, not the ground, so every aerodynamic force now uses
velocity **relative to the local air**, while gravity and the position update
stay in the world frame. That splits airspeed from ground speed — both are on
the HUD, along with the local wind and whether it is head, tail or cross.

**Every speed on screen is km/h, and one function makes it so.** The simulation
is metric throughout and thinks in metres per second, which is right for the
physics and wrong for a speedometer, so each readout converted for itself --
and the airspeed converted while the ground-impact message beside it did not,
leaving two numbers a second apart on screen disagreeing about what a speed is.
`src/render/units.ts` now owns the conversion and every display goes through
it, vertical rates included: climb and sink in m/s beside an airspeed in km/h
is the aviation convention and a perfectly good one, but a pigeon is not an
instrument-rated aircraft. Thresholds stay in m/s -- `strength < 0.2` for
"calm" is a fact about the air, not about how it is written down. The debug
panel stays in m/s too, because its sliders are the simulation's own
parameters and the tests state them in those units.

One consequence worth knowing: **in wind, drag can add energy to the bird.**
Drag is only guaranteed dissipative in the air's own frame; measured against
the ground, a tailwind gust hands you energy. That is real, and the ledger
still balances to floating point because the work is booked where it happens.

Landing barely notices: the best technique goes from 67% to 61% across the
open-loop grid. Set `mean at 100 m` to 0 in the `wind` folder for dead calm.

The asymmetric beating pigeons use to hold a line against a crosswind is not
modelled.

## Energy

The simulation is Newtonian, so it conserves energy for free — but only if
every force is honest. `src/sim/energy.ts` audits that rather than assuming it.
Each tick, `FlightTelemetry.work` reports the joules every force moved:

| Term | Sign | Meaning |
| --- | --- | --- |
| `flap` | ± | The only source of energy. Negative when braking, because beating backwards against your own motion is a brake, not a motor |
| `lift` | ≈ 0 | Lift acts perpendicular to the airflow, so it must do no work |
| `drag` | ≤ 0 | Dissipation |
| `keel` | ≤ 0 | Sideslip resistance |
| `collision` | — | Kinetic energy absorbed by a surface, plus the potential energy of being pushed clear of one |
| `integration` | ± | Not physics: the fixed-step integrator's own artefact, named rather than hidden in a tolerance |

**The ledger balances exactly, not approximately.** With semi-implicit Euler the
change in kinetic energy is *identically* the work done at the mean velocity:

```
dKE = ½m(|v₁|² − |v₀|²) = F · (v₀ + v₁)/2 · dt
```

Potential energy moves with the end velocity instead, because that is what the
position update uses, and the difference is exactly `m·g·dt·(v₁.y − v₀.y)/2`.
Reporting that as its own term means everything else has to add up to
floating-point rounding — about 4 × 10⁻¹² J on a few hundred joules. Any force
that quietly creates energy shows up immediately, which is the point: that kind
of bug reads as "the flight feel is off" rather than as an obvious error.

Two things the audit caught when it was first switched on:

- **Positional corrections leaked energy.** Clamping to the ground plane, or
  rolling back to a contact point, moves the bird vertically and so changes its
  potential energy. That is work done by the contact and is now booked as such.
- **Lift was creating energy in hard turns** — about 13 J over a 20 second
  manoeuvre, always positive. Lift is perpendicular to the airflow at the
  *start* of a tick, but the velocity rotates during that tick, so holding the
  direction fixed leaves a small component along the flight path. Forces are
  now evaluated at the tick midpoint (predict, then re-evaluate), which cuts
  that by a factor of 26 and flips the residual negative, so it can no longer
  spuriously accelerate the bird. The flight envelope did not move: glide,
  brake, climb curve and landing rates are all unchanged.

The HUD shows **energy height** — altitude plus the height your airspeed is
worth, `h + v²/2g`. Pilots call it specific energy, and it is the number that
actually answers whether you can clear the roofline ahead.

Stamina is still a clock rather than a fuel gauge: it drains per second of
flapping, not per joule delivered. Tying it to `work.flap` would be the honest
next step.

## How coasting works

A pigeon is a powered flier, not a soarer. Stop beating and it should slow down
and give up height quickly — you should not be able to cross the city on one
glide. Two parameters carry that:

- **`trimAngle`** (0.1 rad, 5.7°) is the angle of attack the bird settles at
  with no input, and it sets the speed a coast decays *to*. Lift must balance
  weight, so the trim angle picks the speed and nothing else does: at this
  attitude the lift coefficient is 0.45 and the bird settles at 14 m/s.
- **`dragBase`** (0.05) sets how steeply that coast descends, and with it the
  glide ratio — 6.2:1, which is the right neighbourhood for a bird with a round
  body, a head out front and its feet tucked up under it.

**Both were wrong for a long time, and the way it showed was that flying felt
slow.** At `trimAngle` 0.17 and `dragBase` 0.12 the bird cruised at 41.7 km/h —
slower than a car — where a real pigeon does 60–80. The arithmetic pinned it
exactly: a trim angle of 9.7° gives a lift coefficient of 0.765, which balances
weight at 11.05 m/s, and the measured glide was 11.0. The drag was the worse of
the two, because it put *best glide* at 30 km/h, barely above the stall. That is
backwards for anything that flies: best glide belongs well above minimum speed,
and having it at the bottom meant the bird could not fly fast without falling
out of the sky. Flattening the trim alone did not help — it just traded speed
for sink, because at a sensible cruise lift coefficient the old body only
managed L/D 2.3.

Fixing both moved cruise to 63 km/h and cut the release-to-loft crossing from
101 to 66 seconds. It also moved the flare: a bird arriving at 14 m/s instead of
11 needs longer to bleed it off, so the sweet spot went from two metres up to
between four and seven. Ten tests had encoded the old numbers and were
re-derived from measurement rather than nudged until green — including one that
compared the default body against a "low-drag" one, a comparison that had
quietly collapsed because the default *became* the low-drag one.

The two do different jobs and are worth tuning separately: trim decides *how
slow* a coast ends up, drag decides *how steep* it is.

The trade-off worth knowing about, if you retune: drag costs climb. Tripling
`dragBase` more than halves the climb rate at a given speed, and dropping the
glide speed pushes the bird permanently into the low-speed part of the wingbeat
curve. `flapThrust` and `flapStrokeSpeed` had to move with it, and the landing
sink limit went from 3.5 to 4 m/s so that a steeper coast did not make landing
harder purely as a side effect.

## How the wing works

Three things about lift are worth stating, because the intuitive version of
each is subtly wrong and the model deliberately does not follow it.

**Banking does not shrink the wing, it turns the lift sideways.** Lift acts
perpendicular to the airflow, so rolling the bird rotates the whole lift vector
rather than reducing it. The observable is the one you would expect — a bird
with its wings vertical has nothing holding it up and falls out of the sky, at
about 17 m/s against 1 m/s wings-level — but the *reason* matters, because the
lift did not vanish. It went sideways, and that sideways lift is exactly what
makes the turn. Falling and turning are two views of the same vector, which is
why a projected-horizontal-area model would be wrong: it would take away the
turn along with the height.

| Bank | Sink |
| --- | --- |
| 0° | 1.2 m/s |
| 30° | 3.8 m/s |
| 45° | 6.6 m/s |
| 60° | 10.0 m/s |
| 90° | 16.7 m/s |

**Gravity is unconditional.** It is applied every tick with no special cases:
one tick from rest is exactly `-g·dt`, and in vacuum (`airDensity: 0`) free
fall is exact to nine decimal places. A bird dropped from rest in *real* air
only reaches 7.6 m/s after a second, but that is drag, not missing gravity —
falling belly-first puts the wing at a 36° angle of attack with a drag
coefficient of 0.47, nine times its drag at no angle at all. A pigeon is a
fairly good parachute.

**A braking wing is not a wing, and its drag is not a multiple of a wing's.**
Spreading and cupping adds 40% to the area, but that area is held broadside
with the flow separated behind it, so `brakeLiftFactor` discounts the lift back
down — the net is *no extra lift at all* from 40% more wing.

The drag side is where this was originally wrong, and badly. A braking wing is
a **flat plate**, and a flat plate's drag coefficient is of order one. The
first version multiplied the *streamlined* coefficient by 1.6, which gave about
0.19 — so braking dipped the airspeed a knot or two, settled into a steeper
path, and gravity handed the speed straight back. From a real 11.6 m/s coast it
recovered to 10.7 m/s within five seconds. It was not a brake at all.

`brakeDrag` is therefore an absolute coefficient (1.2) added on top, not a
multiplier. Braking now behaves the way it looks:

| From a 15.3 m/s entry | Coasting | Braking |
| --- | --- | --- |
| Airspeed after 2 s | 13.6 m/s | **5.5 m/s** |
| Airspeed after 12 s | 14.9 m/s | **7.1 m/s** |
| Sink after 12 s | 2.2 m/s | **6.9 m/s** |

Which means braking is a way to stop, not a way to float: it costs you height
at nearly twice the rate of a coast. Arresting that is what the **reversed
beat** is for, and it is why a pigeon beats all the way onto the ledge rather
than gliding the last few metres. The landing ladder reflects it — flare alone
lands 30% of open-loop approaches, brake *and* flare only 9%, and brake with
the reversed beat 64%.

## How the wingbeat works

A wingbeat is not a fixed push. Its direction and strength both depend on how
fast the bird is already moving through the air, and getting this wrong is what
made an early build feel dead near the ground:

- **Beating harder means beating faster.** A wing's force goes with the square
  of how fast it sweeps through the air, and that speed is set by the beat
  rate, so thrust scales with the square of `flapFrequency`. This was missing
  entirely: the time-average of `max(0, sin)` is `1/π` of the peak whatever the
  frequency, so the beat rate only changed how fast the wings waggled. With it,
  the model lands on a real pigeon's takeoff: below 2 beats a second the bird
  cannot hold itself up, and somewhere between 2 and 3 it starts to climb.

  | Beats/s | Average vertical force | From a standstill |
  | --- | --- | --- |
  | 1 | 0.3 × body weight | sinks |
  | 2 | 0.7 × | sinks |
  | 3 | 1.3 × | climbs |
  | 5.5 (default) | 3.2 × | climbs strongly |

  One beat at the default rate is worth about 5.7 m/s of vertical speed from a
  standstill. `flapReferenceRate` is the rate at which `flapThrust` is the peak
  force, and it ships equal to `flapFrequency`, so the default is a no-op.

- **The stroke plane rotates.** At cruise the beat points mostly forward
  (`flapAngle`, 0.45 rad — 90% forward, 43% up) and works by making thrust,
  which the wing turns into lift. Slow down and it swings toward vertical
  (`flapAngleSlow`, 1.35 rad), because a bird bursting off the ground beats
  almost straight down. Holding the cruise angle at every speed leaves the
  average upward force at 16% of body weight, and a slow bird simply cannot
  hold itself up.
- **Slow air is worth more.** `flapSlowBoost` multiplies thrust up to ×13 at a
  standstill, falling off with the *square* of airspeed so cruise is untouched.
  A wing beating against still air does far more than one beating against air
  already rushing past. The effect is stark at the bottom of the envelope: at
  6 m/s, below the 8.6 m/s stall speed, the boost is the difference between
  sinking at 1 m/s and climbing at 2. By 15 m/s it contributes nothing.
- **The stroke plane is bolted to the shoulders.** The force comes out of the
  bird's back and nowhere else — a bird aims its thrust by pointing its *body*,
  which is why a hovering hummingbird stands itself upright. Measured, the beat
  holds a fixed angle to the back in every attitude (16° at rest, 39° at 6 m/s,
  65° at cruise), while its angle to the world swings with the bird:

  | Attitude | Beat direction relative to the world |
  | --- | --- |
  | Level | 16° off straight up |
  | 60° nose-down | 76° off up — very nearly horizontal |
  | 90° bank | exactly horizontal, no vertical component at all |
  | Inverted | 164° off up — driving itself at the ground |

  So a diving bird cannot beat its way up; it has to pull the nose up first,
  and only then does the beat help. An earlier version blended the force toward
  vertical at low speed to make panic-flapping forgiving, which was a fudge and
  is gone. It turned out to cost nothing: climb rates are identical and the
  landing rate went *up*, because pulling up before beating was always the
  correct technique and the blend only rescued people who did not.

The result: panic-flapping *while pulling the nose up* recovers 11–14 m in
three seconds from a 4 m/s sink, at any speed. Without the pitch input it
recovers nothing, which is the point — attitude is how a bird aims its engine.
A committed 45 m/s dive still cannot be flapped away, so the low-speed boost
never becomes a universal airbrake.

## How braking works

A pigeon has no airbrake, so it brakes with three things at once, and all three
are modelled:

- **Spreading.** Wings out and tail fanned: `brakeAreaFactor` × 1.4 area, and
  `brakeDrag` adds a flat-plate coefficient of 1.2 on top of the streamlined
  one. That absolute term is what actually sheds speed — see *How the wing
  works* for why a multiplier could not.
- **The alula.** `brakeStallBonus` adds 0.25 rad to the stall angle. The alula
  is the bird's thumb feather, working as a leading-edge slat; without it a
  steep flare just stalls, and with it the flare stays controllable. This is
  the difference between a brake that is a tool and a brake that is a trap.
- **Reversing the beat.** Flapping while braking beats forward and down instead
  of back and down. The stroke plane goes nearly vertical (`brakeFlapAngle`
  1.45 rad), so most of it holds the bird up while the rest pushes it
  backwards — which is why braking *and* beating settles at 7.5 m/s and 2.7 m/s
  sink, slower and gentler than braking alone.

A flare is a transient that ends in a stall; the brake is a configuration you
can sit in, at the price of height. They are complementary, which is why
landing wants both, plus the beat to pay the height back.

The measured effect: across a grid of open-loop approaches, flaring alone lands
30% of the time, braking *without* the beat only 9% — because spreading the
wings now genuinely drops you — and braking with the reversed beat 64%.

## Landing, and being perched

`isPerched()` and `hasCrashed()` split what used to be one terminal state. A
crash raises the end-of-flight panel and the run is over. A landing does not:
the bird stands there, wings folded and legs down, with the camera settled
close in on it, and the HUD saying so.

Two small things that make it read as standing rather than stopped. The bird's
orientation is levelled on touchdown, keeping its heading, because a bird that
lands settles onto its feet instead of freezing in its flare. And the rendered
body is lifted 0.14 m — the simulation tracks a point at the bird's centre and
stops it at ground level, which would otherwise bury half the model. That
offset is a rendering concern and lives in the rig, not the flight model.

**And it has to clear whatever is painted on the ground.** The flat layers —
parkland at 5 cm, roads at 12, railways at 18 — are lifted off the ground plane
to settle which of them draws over which, because coplanar quads sharing a
material fight whatever their depth. The simulation knows nothing about any of
that: it stops a bird on the plane at zero. On grass that is invisible, and on
a railway it meant a pigeon standing 4 cm inside the rail it had just landed
on, which is exactly how it was reported.

So `World.surfaceAt` answers what is drawn under a point, and the rig lifts the
bird until its feet are 2 cm clear of it. Three things make that safe. It only
ever raises, so a roof, a wagon deck and plain grass are all untouched — each
is already well above. It is measured on the *feet* rather than the model,
because spread wings in the braking pose droop nearly 30 cm and a wingtip
brushing the ballast is a bird braking, not a bug. And it is asked only of a
bird within a metre of the ground and not riding anything, which is what makes
a plain scan of every road and railway on the map cheap enough to do at all.

The 7 cm the feet hang below the tracked point is measured off the built model
in a test rather than written down twice: lengthen a leg and the test fails.
The first version of that constant was 14 cm, taken from two poses instead of
four, and it would have held the bird a clear 7 cm above the rail.

## Walking

A landed pigeon is not stuck where it came down. `src/sim/walk.ts` is a second
mode, live exactly when the flight model is not: `walk()` ignores a bird that
is not on its feet and `step()` ignores one whose flight has ended, so which of
the two does anything is decided by the bird's own state rather than by a flag
kept beside it. Both are called every tick and one of them is always a no-op.

**It is not the flight model with the numbers turned down.** On foot there is
one speed, reached on the first tick and held while the key is held, and gone
the tick it is released. No momentum, no acceleration, no drag — a pigeon
walking is not a pigeon coasting, and modelling it as one would be modelling
something that does not happen. The whole of the motion is a heading and a
fixed 1.2 m/s along it.

What the two modes do share is the world. Walking sweeps the same collider with
the same body radius, so a wall is a wall either way, and a bird that walks
across a wagon picks up the same carrier tag a bird that landed on it does —
which is what makes a walking pigeon ride a moving train without any of it
knowing what a train is.

Three things make it feel like walking rather than sliding:

**It slides along what it walks into** rather than sticking to it. Two sweeps,
not a loop: one is enough to follow a wall, and a second pass would only be for
the inside of a corner, where stopping is the right answer.

**It steps up and down.** The horizontal sweep is done with the bird lifted by
its step height, so a kerb, a rail or a sleeper is something to walk over
rather than a wall, and a probe straight down afterwards puts it back on the
ground. Twelve centimetres up, twenty-five down. That probe needs no check that
the surface is level enough to stand on, which is worth saying because the
first version had one: a vertical sweep is a slab test whose entry axis can
only be an axis the ray moves along, so it comes back with an upward normal or
with nothing.

**And the head bobs.** A pigeon's head is thrust forward and then held still in
the air while the body walks on under it, which relative to the body is a quick
snap forward and a long slow drift back. That is the one thing that makes a
walking pigeon read as a pigeon, so the head is a group of its own that the
body slides beneath, on a sawtooth rather than the sine wave a bob would
otherwise be. The legs swing in antiphase under it and the forward one lifts.
All of it is driven by ground covered rather than by the clock, so a bird
standing still stands still and one walking backwards paddles backwards.

### Taking off

`Space` — the same key that beats the wings in the air — puts a standing bird
back into it. The launch is a velocity handed over outright rather than a force
applied over some ticks, because that is a fair description of what a pigeon
does: it leaves with a wing-clap, standing to flying speed inside a fifth of a
second, and modelling the beat-by-beat of that would be modelling something
nobody can see. Eleven metres a second at 0.4 rad, pitched to match so it
leaves along its own velocity instead of flying sideways through the air for
the first half second.

**It has to be an edge, not a held key.** The way to land is to brake and then
beat down onto the surface — it says so in the hint at the top of the screen —
so a bird that took off whenever the key was down would leave again on the tick
it arrived, every time, and landing would be impossible. The press is latched
and held until a simulation tick has actually seen it, so a frame too short to
run one does not swallow it.

**And a tap must not be a death sentence.** Hold the key and any launch flies
away — 30 to 55 m of climb in ten seconds, whatever the numbers. Let go of it
at once and the bird arcs up and comes back down, and whether that is a landing
or a hard impact is the whole of the tuning:

| Launch | Hands off, peak | Hands off, outcome |
| --- | --- | --- |
| 10 m/s at 0.5 rad | 2.4 m | dead — sink 4.1 against a limit of 4 |
| 12 m/s at 0.4 rad | 3.0 m | lands, sink 3.3 |
| 11 m/s at 0.4 rad | 1.7 m | lands, sink 3.4, speed 9.1 |
| 14 m/s at 0.3 rad | 3.3 m | dead — arrives at 10.2, limit 10 |

The 11 m/s row is the one in the game, chosen for the margin rather than the
height: 80 launches on every compass bearing and at a spread of times through
the gust field, worst sink 3.38 against a limit of 4 and worst arrival 9.14
against 10. It still clears 1.7 m from a standing start and travels 20 m before
setting down, and it climbs away the moment you keep the key held.

### Being run over

A wall you walk into and a train that runs into you are not the same event,
however similar the geometry: one of them chose the moment. So a `Box` can say
how fast it is itself moving, a sweep reports that back, and touching anything
above `struckSpeed` is fatal — flying or on foot, whichever of you was doing
the moving. Nothing in the collider acts on it; the geometry reports a number
and the rules about what it means belong to whatever owns the bird.

Two exceptions, and both are the same one wearing different clothes.

**Landing on top of it is landing.** In flight the roof test comes first, so
putting down on the deck of a running wagon is judged as a landing before any
of this is reached. On foot the ground probe is a separate sweep straight
down, so it is never the thing that kills you either.

**And what you are already riding cannot run you over.** A pigeon aboard a
wagon walks into its own stakes all the time, and those are moving at exactly
the speed it is. The first version of that test read `hit.carrier !==
state.restingOn`, which looks right and is not: a bird on the ground is riding
nothing and an untagged solid belongs to nobody, so `null !== null` was false
and *every* moving object in the world was exempt from ever hurting anybody.
It has to be a bird that is actually aboard something.

A standing bird needs more than a sweep can give. A sweep is a slab test, and
a ray that starts already inside a box has no entry face to report — so it
comes back with nothing, which is exactly the case of a wagon arriving on top
of a pigeon that is not moving. `Collider.touching` answers that instead: the
fastest solid overlapping a sphere right now. Standing still on a railway line
is how you are hit by a train, not how you avoid it.

This also turned up a gap that walking had quietly left. The end-of-flight
panel was raised on `wasFlying && hasCrashed`, and a walking bird is not
flying — so being run over on foot killed you without ever saying so. It is
`wasAlive` now.

### Falling

There is no maximum survivable drop, and that is the design rather than an
omission. Walking off an edge hands the bird straight back to the flight model,
in the air at the pace it stepped off with — because a pigeon that steps off a
ledge is a pigeon flying, and what happens at the bottom is judged by the same
landing rules that judge every other arrival. A drop is only fatal if you do
nothing about it.

Measured, off a roof, with no separate rule anywhere:

| What you do | Survivable from |
| --- | --- |
| Nothing | 0.7 m |
| Brake — spread the wings | 1.0 m |
| Flap and brake from the standstill | 5.6 m |
| Dive to build airspeed, then flare | any building on the map |

The last row is the point of the whole arrangement: a 24 m block is survivable
if you tuck, let the speed build, and flare from about twelve metres up — and
not survivable if you leave the flare until four, because there is no arresting
twenty metres of fall in four. That is an aviation rule rather than a game
rule, and nothing in the code states it; it falls out of the wing.

One consequence worth knowing, and worth arguing about: **the dangerous height
is a low one.** Two to four metres is survivable by neither doing nothing nor
flying, because there is not enough air under you to build the speed a recovery
needs. Walking off a garden wall is more lethal than stepping off a roof. That
is what the physics says, and it may or may not be what a game wants.

## How landing works

`landingReadiness()` in `src/sim/flight.ts` answers one question — could the
bird put down cleanly if it touched the ground right now — and both the
touchdown verdict and the HUD's approach cue are built on it. That is
deliberate: the cue cannot drift out of step with the rule it reports on,
because they are the same function.

Touching the ground always ends the flight. `touchdown()` checks sink, then
speed, then bank, and names the first limit breached as the cause. Ordering
only affects which fault is reported, cheapest mistake to fix first; any one of
them is enough to ruin the landing.

The limits sit in the panel's `landing` folder. Widening them is the fastest way
to practise the rest of the flight without every run ending on the approach.

## How collision works

`src/sim/collision.ts` sweeps the bird's movement segment against axis-aligned
boxes, one per building and tree, grown by the bird's radius. Sweeping rather
than testing the end position matters: in a tucked dive the bird covers most of
a tree in a single tick, and a point test would pass straight through it.

A uniform grid over the XZ plane keeps the broad phase to a handful of
candidates — 20,000 sweeps against the full 1,400-object city run in well under
a second, which the test suite asserts so the grid cannot quietly regress into
a linear scan.

On contact the closing speed along the surface normal decides what happens:
at or above `crashSpeed` the run ends, below it the bird stops at the surface
and slides along it. Set `crashSpeed` high in the panel's `collision` folder to
make the world non-lethal while tuning handling.

Tree collision boxes are 30% narrower than the cones look, so clipping a leafy
edge does not read as hitting a wall.

## Tests

```bash
npm test
```

189 tests across nine files:

- **`src/sim/flight.test.ts`** — the shape of the lift curve, glide ratio and
  sink rate staying in a plausible band, flapping climbing and draining stamina,
  tucked dives outrunning spread ones, banking producing a heading change with
  no yaw input, pitch stability recovering to trim, crashes and survivable
  scrapes, determinism, and that no input sequence produces a NaN.
  Landing gets its own group that flies real approaches open-loop: a well-timed
  flare lands across the whole spread of flare strengths, a straight-in glide is
  rejected as too fast, flaring far too high balloons and then drops, and a
  wing-down touchdown is rejected as not level.
  Braking has its own group too: it sheds speed a glide cannot, the reversed
  beat arrests the descent that spreading causes, the alula bonus
  keeps a fixed angle of attack unstalled that stalls without it, braking
  overrides tucking, and an approach flared too late to save itself lands when
  braked.
  Vertical authority is pinned separately: the low-speed boost turns a sinking
  slow bird into a climbing one and fades to nothing by cruise, the beat buys
  altitude when slow and ground speed at cruise, a sinking bird recovers when
  it pulls up, the beat holds a fixed angle to the bird's back in every
  attitude (and is exactly horizontal at knife-edge), and a committed dive
  still cannot be flapped away.
  Coasting has its own group: a coast settles well below what powered level
  flight holds, bleeds a fast entry back down in under three seconds, reaches
  the same trim from above or below, and is measurably slower and steeper than
  the same bird given a sleek body.
  Wing physics has one too: sink rises monotonically with bank angle and the
  bird still turns hardest where it holds height worst, gravity is exact from
  rest and in vacuum, thrust scales with the square of the beat rate, takeoff
  breaks even between two and three beats a second, and a braking wing makes
  less lift than a spread one despite covering more area.
- **`src/sim/collision.test.ts`** — entry faces and normals, radius expansion,
  nearest-hit ordering, boxes spanning several grid cells, and a fast segment
  that a point test would tunnel through. Several fields at once count
  everything, find what either would have found, take the nearer hit, stand on
  the taller, and are an empty world when given nothing.
- **`src/world/layout.test.ts`** — flies a bird through the *actual* generated
  city and asserts it crashes into the skyline, never ends up inside a solid
  box, passes clean overhead when high enough, and that the broad phase stays
  fast.

- **`src/sim/energy.test.ts`** — audits the energy books on every tick of ten
  scenarios (including inverted, sideways and a deliberately violent entry),
  through crashes and landings, and at four different timesteps. Then it pins
  the rules: lift does under 1% of drag's work, drag and the keel never add
  energy, a collision never leaves the bird with more than it had, and *nothing
  but flapping* can raise total energy for any control input.

- **`src/sim/wind.test.ts`** — the profile is still at ground level and
  strengthens with height, gusts scale with the mean, the air roughens
  monotonically with ground speed, no ground speed between 2 and 60 m/s makes
  it go quiet, a coast drifts off a straight line while a calm one does not,
  airspeed separates from ground speed, calm air reproduces the old flight
  model bit for bit, and the energy books balance even though moving air can do
  work on the bird.

- **`src/flock.test.ts`** — birds come out one every second rather than all at
  once — stated in seconds and birds rather than by dividing by the constant
  that sets it, so the test disagrees with the wrong rate instead of agreeing
  with whatever it is — the ones still waiting are not in the air, and a dead one is back on
  the wing on the tick it died — counted by watching them reappear, since an
  ending no longer survives to be polled for. Heading error takes the short way
  round, the autopilot holds a sane bank instead of rolling over, stays
  airborne when left to itself, flies speed with the nose and height with the
  wings, and rests before it is spent; the flock launches in a spread of
  colours, keeps most of itself in the air over a city, and puts birds back
  after they die.

  On the escort itself: a bird appears the spawn distance behind the leader,
  behind meaning behind whichever way the leader is facing, and sets off the
  same way rather than turning to face them. It follows the leader about rather
  than a spot on the map — a leader crossing the map leaves its flock strung
  out over hundreds of metres, because each was released behind wherever the
  leader was by then. Beside a leader who stays put it holds a mean of under
  40 m and never passes 85, and well short of the stray limit, which is what
  was really bounding this before the flock had its own way of flying. Over a
  leader on the ground it wheels below the default autopilot's floor instead of
  climbing away, and never gets nearer than four metres. Targets are always
  inside the radius, spread evenly over the disc rather than bunched in the
  middle — a quarter of them inside half the radius, which is the quarter of
  the volume that is; and beside a leader it can match, the flock keeps up by
  re-aiming rather than being recycled by the stray rule, which is the one
  thing the attention span is for. Targets track the leader's own height,
  spread above and below it about equally rather than sitting off to one side,
  and are bounded in three dimensions rather than as a disc with a slab of
  height bolted on.

  And on being seen, which is what the rest of it is for: with a leader going
  somewhere, targets are picked ahead of them — every one, by more than the
  ball is wide, sampled as it is chosen rather than later, when it would be
  measuring how stale the target had got. A leader standing still gets no lead
  at all. The flock flies faster than the leader rather than merely matching,
  because two birds at one speed released ten metres apart stay ten metres
  apart. And the whole point, stated the way the player sees it: something is
  inside the chase camera's cone for most of a two-minute cruise — which is
  zero if you aim at the leader instead of ahead of them, and zero again if
  you match their speed instead of bettering it.

  And on height: escorting a leader gliding down, the flock stays within five
  metres of them and a fair share of it is *below* — swept across sink rates,
  because the two faults behind this showed at different ones. A flock that
  cannot descend is already 8 m high at a gentle glide; a target height that
  does not follow the leader down is 18 m high in a real descent, and hidden
  at 1 m/s by a bird that can dive. Either one alone passes a test written at
  a single sink rate.
- **`src/world/city.test.ts`** also covers the trees: every one the layout
  asked for is drawn and no stand is asked to draw more than it reserved —
  an `InstancedMesh` is sized when it is made, so a stand told to draw past
  its allocation draws whatever is in the buffer. They stand on the ground
  rather than half in it, checked twice over, because the shapes being
  modelled foot-at-the-origin and the instances being placed there are two
  claims and the old single cone got both wrong in a way that cancelled out.
  Each place is planted with one sort — stated as "a tree's nearest neighbour
  is almost always its own sort", which is one time in four if the sort is
  picked per tree — while a map with several blocks still uses several sorts,
  and the same wood comes up every run.
- **`src/world/polygon.test.ts`** — the sign of an area says which way a ring
  winds; insetting moves every edge by the distance asked for, takes a distance
  per edge, and cuts a sharp corner off rather than flinging it into the
  distance; and shrinking refuses once the walls have met, with the 100 m
  square inset by 80 m as the worked example of a wrong answer that passes
  every check but the edge directions; and a battery of awkward rings at every
  distance either shrinks or gives up, never throwing and never escaping.
- **`src/world/blocks.test.ts`** — four streets enclose one block and not two,
  the outside of the network is left out by which way it winds rather than by
  its size, a grid of three streets each way gives four blocks, dead ends are
  ignored whether they hang off a block or reach into one, and a crossing the
  map never noded merges two blocks rather than losing them.
- **`src/world/areas.test.ts`** — point-in-polygon follows a concave boundary
  rather than its bounding box; a footprint reaching into a park by one corner
  is caught even when its centre is clear; and the sample grid is never coarser
  than its step and always has a point on the centre, which is the hole a small
  park hides in.
- **`src/world/smoke.test.ts`** — puffs are emitted at the rate asked for
  whatever the tick length, the plume settles at as many as fit in one lifetime
  and never outgrows its ring, it climbs and then stops climbing as it cools,
  lies down and drifts on the wind without ever being blown faster than the
  wind, trails behind something moving, thins away rather than switching off,
  and is thick enough to see nothing through.
- **`src/world/city.test.ts`** also covers the drawing of it: every puff gets
  its own opacity — the bug that made the plume a silhouette — thinning as it
  ages, going paler and larger as it goes, with dead ones left out of the draw
  entirely.
- **`src/world/train.test.ts`** — every box a vehicle owns is tagged with it
  and untagged when nobody asked, a passenger keeps its place on the deck
  rather than in the world and turns with the wagon round a bend, the turn is
  measured the short way round, a bird is told which wagon it landed on and
  told nothing when it lands on the ground, and it is still standing where it
  was after the train has run on. A train runs on and keeps its direction,
  turns round at either end with the whole consist still on the rails, stays
  between them however long it runs, visits both rather than settling against
  one, survives a step longer than the line itself, stands still on a line too
  short to hold it, and does not turn the rake round when it turns round.
  Distances along a line run out at the end
  rather than extrapolating past it; a train reaches back from its leading
  coupling with real slack over the couplings, stated in metres rather than
  against the constant that produced it; a vehicle over a bend takes the chord
  between its bogies; a consist too long for its line produces nothing; the
  wagon deck sits below the stakes so what is between them is air; and the
  pigeon lands on that deck off a gentle approach while a fast one and a steep
  one end the way they would anywhere else. Drawn between ticks, a train covers
  the same ground every frame at a frame rate that does not divide into the
  tick rate — sixty per second over seventy — where the raw tick position moves
  in whole tick steps and never in the distance actually covered; and the drawn
  position always stays inside the interval the last two ticks bracket, which
  is the one thing that separates interpolating from extrapolating and the only
  test that catches it.
- **`src/sim/walk.test.ts`** — a second of walking covers one walking speed of
  ground and the very first tick is already at full speed, which is what "no
  acceleration" means and what a ramp would fail; it stops dead on release,
  walks backwards at the same one speed, turns on the spot without moving, and
  goes where it is pointed rather than where it started pointed. A flying bird
  and a crashed one are both left alone. It stops its own radius short of a
  wall given twelve metres of walking to get through it, and slides along one
  met at an angle — stated against the point it first touches, because a bird
  that merely stopped on contact would already be past a looser bound. It steps
  onto a kerb, is stopped by a table, and steps back down rather than falling
  off. Walking off an edge puts it in the air at the pace it stepped off with,
  and the two metres that follow are fatal unflown and survivable flown. A
  24 m block is survivable by diving and flaring from twelve metres up, not
  survivable by doing nothing, and not survivable by leaving the flare until
  four — which is the fall rule, and is nowhere written down. The stride
  advances with ground covered rather than the clock, stays inside one cycle
  either way round, and holds still while the bird does. Taking off puts the
  bird in the air going forwards and upwards, at a speed the flight model
  itself calls too fast to land at — so certainly one it can fly at — along
  its own velocity rather than sideways through the air, and the way it is
  pointed. It will not launch a bird that is flying or one that has crashed,
  and it lets go of whatever it was standing on. The one that matters: take
  off and do nothing else, on all sixteen compass bearings through the gust
  field, and every one of them lands rather than crashes — while holding the
  key climbs past 20 m.

  And on being run over: walking into something moving is fatal, and so is
  standing still while something moving arrives — the second is the half a
  sweep cannot see. The same solid standing still is not fatal, nor is one
  creeping below the speed limit, nor is the wagon the bird is riding, though
  a different wagon of the same train still is. In the air it kills at a
  closing speed that would only have scraped a wall — judged at the moment of
  contact, because the scraped bird dies too, on the ground a second later,
  having slid all the way down. And it does not stop you landing on top of a
  moving deck, which is the exception the whole thing turns on.

  And on meeting: two birds on their feet, on the same solid, within reach.
  Not from further off than that; not for a bird passing underneath on the
  ground, which is close enough to touch and not the same place at all; not
  for the next wagon along; not while either is flying or one of them is dead.
  The distance is the whole distance and not the ground plan, since two metres
  straight up is somewhere you can stand on a wagon. Two birds on open ground
  do meet, because both standing on nothing is both standing on the same
  ground.

  And on turning to face somebody: a bird comes round to look at them from
  whatever heading it started on, takes the short way round -- tested across
  the back of the compass, where +3 radians and -3 are a sixth of a radian
  apart and look like six, because an angle that does not cross the wrap
  cannot tell the two apart -- turns a tick's worth in a tick rather than
  snapping round, stops once it is looking at them, and does nothing at all to
  a bird in the air.

  And on the three stances: a bird in the air is flying whether or not there
  is anybody about, one on its feet is walking or talking depending, and a
  crashed one is doing none of the three. A walking bird gets every control; a
  talking one gets none of the movement and keeps the wing; a flying or
  crashed one gets nothing on foot at all. End to end through the walk model:
  four seconds of holding forward and turn moves a bird in conversation
  neither a millimetre nor a degree, and one press of the take-off key still
  puts it in the air.
- **`src/render/bird.test.ts`** also covers the walk cycle: the legs swing in
  opposite directions and only the forward one lifts, both return together at
  the top of the stride, and the head reaches furthest forward in the first
  third of it and then only ever comes back. That last one finds the peak
  rather than assuming where it is, which is what tells a thrust from a plain
  symmetric bob. None of it moves on a bird that is not on its feet.
- **`src/render/units.test.ts`** — a metre a second is 3.6 km/h, a car through
  a Budapest street is 50 and a racing pigeon reads at the speed a racing
  pigeon flies, all stated as figures nobody has to look up rather than
  against the constant that produces them. Rounding never moves a number by
  more than half a km/h, climbing stays distinguishable from sinking, and a
  bird in level flight is never told it is descending — `-0.01 m/s` prints as
  `-0` without care, which reads as a fault in the instrument. The last test
  greps the two display modules for a conversion of their own: a guard against
  the original bug coming back, not a proof, since it cannot see a new file
  doing the same thing.
- **`src/render/bird.test.ts`** — the feet never hang further below the tracked
  point than `FOOT_DROP` says, in any of the four poses, and `FOOT_DROP` is
  within 5 mm of the deepest they actually reach, so it cannot quietly grow
  into holding the bird off the ground. Measured off the built model, so
  lengthening a leg fails it. On a surface drawn above the plane the feet end
  up clear of it in every pose — and the same measurement without the surface
  shows them under it, which is the bug as reported. Plain ground, a roof and
  a wagon deck are all left exactly where they were.
- **`src/world/city.test.ts`** — the surface under a resting bird is the
  railhead over a track, stated against the height the ribbon is actually
  drawn at rather than the constant behind it; the plane again once you step
  off; rounded off at a ribbon's ends rather than running on down the line;
  and the rail, not the road, at a level crossing where the same point is on
  both.
- **`src/render/camera.test.ts`** — a two-shot holds both birds inside the
  frame with air to spare, at every separation from touching to a dozen metres
  apart; stated as the angle each subtends from the camera's own aim, which is
  what "in shot" means. Without the margin every one of them sits at precisely
  the edge. It aims between them rather than at either, stands across the line
  between them rather than behind one, takes the side it is already on so
  walking round somebody does not sweep the camera through them, backs off
  further the further apart they are, never crowds two birds in the same place,
  stands a little above them, and produces finite numbers when the pair and the
  camera are all at the same point.

  And on holding the shot: the pair's midpoint stays at the centre of the
  frame at a standstill and at 3, 6 and 12 m/s, and both birds stay well
  inside it. The two of them stand side by side *along* the way they are
  going, which is how pigeons stand on a wagon and, more to the point, is the
  arrangement that puts their travel across the picture rather than into it —
  set up the other way round, a lagging aim shows as the wrong stand-off and
  not as bad framing at all, which is how the first version of this test
  passed while the shot was visibly broken. Re-entering the shot somewhere
  else does not fling the camera the distance between the two conversations.
- **`src/progress.test.ts`** — a fresh player starts at the beginning, one
  coming back comes back to where they were, and everything that can go wrong
  with storage is an ordinary case: no storage at all, storage that throws on
  read, storage that throws on write, and a stored value that is not a level —
  out of range, negative, fractional, empty, a word. Also that the levels
  themselves are well formed: named, named differently from each other,
  starting somewhere over Budapest, and at an hour a `Date` can be made of.
- **`src/dialogue.test.ts`** — a conversation opens on their line with yours
  to choose from, answers what you actually said rather than the same thing
  either way, keeps everything said rather than only the last of it, and is
  over when there is nothing left. A key that is not on offer leaves it
  exactly where it was, and so does a key pressed after it has ended. Every
  step returns a new exchange, so nothing already on screen can change under
  the panel drawing it. It goes deeper than one exchange when a branch does —
  the placeholder is two lines deep and nothing in the traversal should know
  that — and it ends on your word when a reply has no answer. And every
  level's conversation opens with something and ends whichever way you take
  it, because a branch that never runs out is a level you can never leave.
- **`src/render/menu.test.ts`** — which level a number key picks: counting
  from one, nothing at all while the menu is closed, nothing for a number that
  is not a level, and exactly as many working numbers as there are levels. The
  menu's own markup is not tested, because there is no DOM in this suite and
  adding one to check that three names come out as three rows is not worth a
  dependency — it is built out of nodes with `textContent` rather than out of a
  string, so the one thing worth testing about it, that a level name cannot
  become markup, is true by construction instead.
- **`src/render/sun.test.ts`** — the sun is overhead at the equator at noon on
  the equinox, reaches 90 minus the latitude plus the tilt at midsummer noon
  and due south with it, is a full two tilts lower at midwinter, rises in the
  east and sets in the west, and is below the horizon at night.
- **`src/world/city.test.ts`** — both levels are named and get a marker, the
  level-one marker sits on the wagon it was told to at the top of its stakes,
  nothing is marked until a level is made active, and the marked wagon comes
  out of the rake without being duplicated or dropped. The target flashes once a second, is dark for
  most of it, swells and fades rather than snapping, repeats whenever you look,
  goes on doing it however close the bird gets, and stops the moment the bird
  is on its feet — which replaced fading out across a band rather than
  switching off. The arrow does the opposite and thins out as you arrive, at
  full strength beyond thirty metres and gone inside eight, continuously
  enough that no frame of it jumps by more than a twentieth; the arrow keeps a constant apparent size at any range, with a
  floor so it does not vanish underfoot. A roof comes out of the building's height
  rather than being added to it, is pitched to the depth of the wing it covers
  up to a limit, never swallows a building short enough for it to, and is left
  off the landmark so there is somewhere flat to land.
- **`src/world/from-map.test.ts`** — the railway has a group of its own:
  nothing is built or planted on the track, with a control that the line lies
  across ground the generator wanted to build on, one line through the frontage
  and another through the courtyard because either alone leaves half the rule
  untested, and a tramway in the carriageway costing the frontage nothing. The
  ring closes, so leaving the courtyard
  in any of 24 directions meets building before it reaches the street, while
  the courtyard itself stays open to fly in; gardens are in courtyards and
  nowhere else; nothing overhangs a carriageway, drifts off its block, or sits
  deeper than the wing; every building is squared up to an edge of its own
  block; facing frontages are twice the carriageway and its setbacks apart; no
  block is left empty, and one too small for even a single house is planted
  rather than left bare; gardens stay inside their block and out of everyone's
  front room; a block too small for a courtyard is built solid, with no hole to
  fly into; and exactly one building is marked as the target, the one actually
  nearest it. Green space has its own group, including a control that the test
  park covers ground the generator *would* have built on — a park in the middle
  of a courtyard would prove nothing.

Because the city layout is plain data with no Three.js in it, the layout file
tests the real world the player flies through, in Node, with no WebGL.

## Where this goes next

1. **A real pigeon.** `src/render/bird.ts` is primitives behind a two-method
   interface; replace it with a glTF model and a skeletal flap loop.
2. **Air.** Thermals over rooftops and ridge lift off building faces — add a
   wind field sampled at the bird's position and subtract it from velocity
   before the aerodynamics run.
3. **Sound.** Wind noise pitched by airspeed and a wingbeat driven by
   `flapPhase`. This is the cheapest large gain available — and braking, which
   is currently silent, is exactly the kind of thing sound sells.
4. **Landing on branches.** Roofs and the ground work; a tree is still a solid
   box with no perch on top of it.
5. **Taking off again.** A perched bird holds its position and nothing else;
   `isPerched()` is the hook. Launching wants a leg push, and a first wingbeat
   from a standstill already carries 11.6 times body weight, so most of the
   physics is there — what is missing is the transition out of the resting
   state.
6. **A crash you can see.** The bird currently freezes at the impact point.
   Tumbling it, or leaving a puff of feathers, would cost little.
