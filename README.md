# Mycelia

An ecological real-time strategy game played on a dark herbarium specimen sheet.
You wake as a fungal intelligence in a single spore beneath a forest floor, grow
a mycelial network through living soil, form symbioses with tree roots, and
fruit before the forest fails.

The full design brief is in [`mycelium-rts-outline-spec.md`](mycelium-rts-outline-spec.md).
The visual system the build commits to is in [`DESIGN.md`](DESIGN.md), and the
product record is in [`PRODUCT.md`](PRODUCT.md).

## Running it

```bash
npm install
npm run dev        # http://127.0.0.1:5173
```

```bash
npm run typecheck  # tsc --noEmit
npm run build      # static bundle in dist/
npm run preview    # serve the built bundle
```

## Deploying to Cloudflare Pages

The whole game is a static bundle, so Pages hosts it for free at any traffic
level. There is no server, no database and no API: the simulation runs entirely
in the browser.

```bash
npx wrangler login     # once, to authorise the CLI
npm run deploy         # builds, then `wrangler pages deploy`
```

`wrangler.jsonc` names the project `mycelia` and points Pages at `dist/`. The
first `deploy` creates the project; after that the same command publishes a new
version. You can also connect the repository in the Cloudflare dashboard and let
Pages build it — use `npm run build` as the build command and `dist` as the
output directory.

Nothing here needs Workers KV, D1, R2 or Durable Objects yet. Those arrive with
saved games and multiplayer, per the spec's roadmap.

## How it is put together

```
src/sim/      the whole game, headless and deterministic
src/render/   Three.js presentation of simulation state
src/ui/       the printed interface (semantic HTML, not canvas text)
src/game.ts   the loop that joins them
tools/        visual QA harness
design/       the approved composition comps and QA screenshots
```

**The simulation is the source of truth.** Nothing in `src/sim/` imports
Three.js, reads a DOM node, or calls `Math.random`. It advances on a fixed 1/60s
timestep from a seeded PRNG, so a match is reproducible from its seed plus the
orders the player gave — which is what makes replays and lockstep multiplayer
possible later without redesigning anything.

**Rendering reads state; it never owns it.** Soil colour comes from stratum,
moisture, organic content and how much network is packed into each cell. A
strand's brightness comes from its thickness, health and actual resource flow.
Motes only appear on edges that moved carbon this tick, so the drifting light is
a readout of the economy rather than an ambient effect.

**The interface is printed, not drawn.** All text is real HTML in EB Garamond
and Courier Prime. The depth rail is generated from the map's own strata, so it
cannot disagree with the soil it measures.

## Controls

| Input | Action |
|---|---|
| Drag | Pan the sheet |
| Shift-drag | Tilt the camera off the sheet |
| Scroll | Zoom |
| `F` | Reframe the specimen |
| `1`–`4` | Grow / Bond / Cord / Fruit |

Click the sheet to apply the selected order. With **Bond** selected, click a
root tip to form a symbiosis; a bonded tree ships carbon in exchange for water
and minerals, and severs the bond if it goes unsupplied for too long.

## Demo and QA parameters

Append to the URL:

| Parameter | Effect |
|---|---|
| `?seed=old-growth` | Generate a named map instead of the default |
| `?warm=300` | Fast-forward 300 simulated seconds before the first frame |
| `?steward=1` | A stand-in player that bonds every tree it can reach |

Both are deterministic, so a link like
`?seed=raven-wood&warm=300&steward=1` always opens the same grown match.

## Visual QA

```bash
node tools/shoot.mjs \
  --url "http://127.0.0.1:5173/?warm=300&steward=1" \
  --canvas-out design/shots/latest.png \
  --eval "window.mycelia.game.sim.player.tipCount"
```

The harness drives headless Chromium, captures the WebGL drawing buffer
directly (`--canvas-out`; under software rendering the compositor does not
reliably fold the canvas into a full-page screenshot), reports console and page
errors, and can run arbitrary JavaScript against the live game through the
`window.mycelia` handle.

## What is built, and what is not

Working now: procedural soil transects with warped horizons and a water table;
hyphal growth that reads the soil and pays for every centimetre; mycorrhizal
bonding with a real trade obligation a tree can sever; carbon, water, nitrogen
and genetic-potential economies with spatial transport through the network;
cords; a saprotroph rival; seasons with a drought that moves the water table;
tree health, growth and death; fruiting and spore banking; the printed
interface; and the depth rail.

Not yet built: the evolution tree, the other rival species, parasites and
disease, wildfire and logging, biomes beyond the temperate stand, save/load, and
multiplayer. The simulation has no idea any of them are missing — it is a
fixed-timestep world that more systems can be added to.

## Costs

Hosting is free at indie scale. The one recurring cost in this repo is
`design/comps/`, which was produced once with `gpt-image-2` for roughly $0.75.
