# Pigeon Sim

A flight simulator where you are a homing pigeon over a real slice of
Budapest's eighth district, built from OpenStreetMap.

Your mate is taken from the nest while you are out fetching food. Thirteen
levels later you come back for her with thirty birds behind you.

## Playing it

**In the air**

| | |
|---|---|
| `W` / `S` | nose down / nose up |
| `A` / `D` | roll left / right |
| `Q` / `E` | yaw left / right |
| `Space` | beat your wings |
| `T` | tuck — fold up and dive |
| `B` | brake — spread the wings and tail |

The arrow keys do the same as `WASD`.

**On foot**

`W` / `S` walk, `A` / `D` turn, `Space` to take off. You walk up to another
pigeon to talk to it, and press `Space` to go on when you are done.

**Anywhere**

`L` opens the level list — a number, or the arrows and `Enter`, or a click.
`Esc` closes it. `R` restarts the level. `V` turns the voice on and off.

## Flying it

It is an aerodynamic model rather than an arcade one, at a fixed 120 Hz with
the frames interpolated between ticks. Lift comes from angle of attack and
falls off past the stall; a turn is a bank, so the lift that was holding you
up is now turning you and you sink unless you pull. Wingbeats cost stamina and
stamina comes back slowly; flying at all costs what is in your belly, which is
why the second level is an errand for food.

The city is not modelled, it is grown: 2,311 roads, 604 railways and 735 green
areas from OpenStreetMap, and every building, tree, courtyard and garden square
worked out from the shape of the blocks between the streets. The trams run
themselves on the real tram network, on the correct side.

## Running it

```bash
npm install
npm run dev      # http://localhost:5183
npm test         # 841 of them
npm run build
```

The map is fetched separately and committed, so a clone needs no network:

```bash
npm run fetch-map -- --centre 47.4979,19.0402 --radius 1200 --name home
```

## Licence and attribution

The code is ISC. The map data in `src/world/data/home.json` is
© OpenStreetMap contributors and is used under the
[Open Database Licence](https://opendatacommons.org/licenses/odbl/); the game
says so on screen, and anything derived from it inherits that licence.
