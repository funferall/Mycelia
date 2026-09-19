# Mycelia

An ecological real-time strategy game played on a dark herbarium specimen sheet.
You wake as a fungal intelligence in a single spore beneath a forest floor, grow
a mycelial network through living soil, form symbioses with tree roots, and
fruit before the forest fails.

The full design brief is in [`mycelium-rts-outline-spec.md`](mycelium-rts-outline-spec.md).
The visual system the build commits to is in [`DESIGN.md`](DESIGN.md), and the
product record is in [`PRODUCT.md`](PRODUCT.md).

The authoritative implementation status, feature register, priorities, known
limitations, and verification record are in [`PROJECT_STATUS.md`](PROJECT_STATUS.md).
Future work must be recorded there rather than in separate plans or handoffs.

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

Nothing here needs Workers KV, D1, R2 or Durable Objects yet. Saved games and
multiplayer remain deferred in `PROJECT_STATUS.md`.

## How it is put together

```
src/sim/      the whole game, headless and deterministic
src/render/   Three.js presentation of simulation state
src/ui/       the printed interface (semantic HTML, not canvas text)
src/game.ts   the loop that joins them
public/       authored 3D models, served beside the bundle
tools/        visual QA harness and the Blender asset builder
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

**Surface art is optional by construction.** `src/render/assets.ts` loads the
glTF models listed in `public/assets/`, scales each one to the simulation's own
tree, corrects it onto the ground, and falls back to generated geometry whenever
a file is missing, so art can arrive one model at a time without the game
depending on it. `tools/make-placeholder-assets.py` rebuilds the current
placeholder set in Blender 4.2, and the conventions a model has to follow are
written down under "Authored 3D assets" in `DESIGN.md`.

## Controls

| Input | Action |
|---|---|
| Drag | Pan the current view |
| Shift-drag | Orbit the forest / tilt the underground specimen |
| Scroll | Zoom; descending close enough enters the underground view |
| `V` | Switch between Forest and Underground |
| Arrow keys | Pan while the canvas is focused |
| `+` / `−` | Zoom while the canvas is focused |
| `F` | Reframe the current view |
| Space | Pause or resume |
| `R` | Rest or resume growth after awakening |
| `H` | Hide or restore field notes |
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

The botanical GLB pack can be rebuilt locally with Blender 4.2 (no external
assets or add-ons). In PowerShell:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 4.2/blender.exe' --background --factory-startup --python-exit-code 1 --python tools/make-forest-assets.py -- --render
npm run test:assets
```

This writes the assets and manifest to `public/assets/`, plus tree, LOD and prop
preview sheets to ignored `design/shots/`. `--output <directory>` builds an
isolated copy. The six existing game paths use the new art; additional props,
dead variants and lower LODs await runtime integration. The asset contract is
in `DESIGN.md` and remaining integration work is in `PROJECT_STATUS.md`.

```bash
npm test            # headless simulation regression
node tools/test-region.mjs  # the regional world: terrain, water, spores
npm run test:view   # browser checks for the forest <-> underground crossing
npm run test:journey # plays a whole match through the printed controls
node tools/shoot.mjs \
  --url "http://127.0.0.1:5173/?warm=300&steward=1" \
  --canvas-out design/shots/latest.png \
  --eval "window.mycelia.game.sim.player.tipCount"
```

`npm run test:view` runs the game from the build in `dist/` (run `npm run build`
first; `tools/shoot.mjs` can use either a preview or a dev server). It starts a
preview server of its own and checks the crossing between the two views: that it
takes the same wall-clock time at 30fps and at 4fps, that it dissolves the
soil's contents in both directions and reverses at any point, that following a
crown lands on that tree's own root, and that the specimen and the stand stay
framed at 1600×1000, 1366×768 and 390×844. It also exercises input: a drag
pans instead of ordering, a tap orders, a refused order says so, and the
keyboard belongs to the canvas rather than to whatever control has focus.

`npm run test:journey` plays a whole match — reach, bond, gather, two blooms and
the restart — with clicks on the controls the sheet prints, and nothing else. It
runs at 4× pace and takes several minutes; `--seed` picks the map.

The harness drives headless Chromium, captures the WebGL drawing buffer
directly (`--canvas-out`; under software rendering the compositor does not
reliably fold the canvas into a full-page screenshot), reports console and page
errors, and can run arbitrary JavaScript against the live game through the
`window.mycelia` handle.

## What is built, and what is not

Working now: a seeded 3D bird's-eye forest with selectable trees and a connected
descent into the underground view; procedural wind, loose leaves, rainfall and
seasonal foliage; procedural soil transects with warped horizons and a water table;
hyphal growth that reads the soil and pays for every centimetre; mycorrhizal
bonding with a real trade obligation a tree can sever; carbon, water, nitrogen
and genetic-potential economies with spatial transport through the network;
cords; a saprotroph rival; seasons with a drought that moves the water table;
tree health, growth and death; fruiting and spore banking; the printed
interface; and the depth rail. The surface view is functional but still needs
weather, accessibility and performance work; `PROJECT_STATUS.md` records what is
verified and what is not.

Not yet built: the evolution tree, the other rival species, parasites and
disease, wildfire and logging, biomes beyond the temperate stand, save/load, and
multiplayer. The simulation has no idea any of them are missing — it is a
fixed-timestep world that more systems can be added to.

## Costs

Hosting is free at indie scale. The one recurring cost in this repo is
`design/comps/`, which was produced once with `gpt-image-2` for roughly $0.75.
`node tools/test-region.mjs` checks the region the simulation is built on:
shared stand borders that agree exactly, water that crosses them, communities
that follow the ground, and spores that found neighbouring stands for what the
parent paid. It is headless and takes seconds.
