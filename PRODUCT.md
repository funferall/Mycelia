# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Desktop-browser strategy players who already know the RTS vocabulary — the
Civilization, Northgard, Creeper World, and Osmos audiences — arriving for a
30–60 minute session rather than a short burst. They are comfortable reading a
resource economy, holding a mental map of contested territory, and playing at
their own pace: the game must pause, and must run at 1×/2×/4×. They are not
looking for an action game and do not want to micromanage units.

## Product Purpose

*Mycelia* is a real-time strategy game about ecological cultivation. You wake as
a fungal intelligence in a single spore under a forest floor and expand a
mycelial network through living soil: grow hyphae, bond with tree roots, trade
carbon for water and minerals, defend against parasites and rival fungi, and
shepherd the forest that feeds you. When the network is rich enough you
**fruit** — erupting mushrooms that release spores to colonize new ground.

Success is a match with a decided outcome (fruiting, symbiosis, or extinction)
reached under continuous environmental pressure, where the player's own growth
decisions visibly shaped a living forest.

## Positioning

The fantasy is *cultivation under pressure*, not conquest. The player's network
is simultaneously army, economy, and body — there are no discrete units to
select and command. Every asset the player builds is food for something else,
and the forest being farmed can die. A neighboring RTS could copy the units and
the resource table, but it cannot truthfully copy a design where the map is a
living agent, the scoreboard is the health of the thing you are farming, and
overexploiting your own economy is the reliable way to lose.

## Operating Context

- The map is a vertical slice of forest with two layers over one battlefield: a
  below-ground soil cross-section carrying ~80% of play, and an above-ground
  canopy view showing tree health, fruiting bodies, weather, fire, and logging.
- Play is continuous real time with pause and 1×/2×/4× speed.
- Orders are *growth directives* and *zone policies*, never unit commands.
- Fog of war is soil opacity: the player senses nutrient gradients and
  vibrations near their own network; rivals are visible only at contact range
  or through enzyme probes.
- The camera zooms continuously from full-map strategic view down to a single
  hyphal strand. This zoom is the signature moment of the product.

## Capabilities and Constraints

Confirmed from the project's design spec (`mycelium-rts-outline-spec.md`):

- **Client-heavy, server-light.** The simulation runs entirely in the browser;
  the server is a lobby/relay only. This is a budget constraint, not a
  preference.
- **Stack:** TypeScript with a WebGL renderer, built by Vite into a static
  bundle, deployed to Cloudflare Pages. Workers KV/D1 for saves, R2 for assets,
  Durable Objects only if multiplayer ships.
- **Simulation:** fixed-timestep and deterministic, decoupled from render, to
  enable replays and future lockstep multiplayer. Target ceiling around 50k
  agents.
- **Cost ceiling:** roughly $5/month.
- **Resources:** carbon (sugar) from tree symbiosis; nitrogen and phosphorus
  from decomposition; water from the water table and rainfall; genetic
  potential from absorbing rival biomass and rare soil pockets. Resources are
  *spatial* — they exist at nodes and must flow through a connected network, so
  a severed colony starves. Storage is deliberately limited: fungi invest,
  they do not hoard.
- **The battlefield is a region, not a stand.** A match is a 3×3 mosaic of
  logical forest stands that share one landscape and one weather: coherent
  terrain, a stream that crosses stand borders, and a different forest
  community on ground that drains and holds water differently. Mycelium spreads
  between stands the way it does in life — by spore, on the wind, with the
  parent paying for the journey — so a lineage can be several colonies in
  several kinds of ground rather than one network in one transect. Ground with
  no colony in it is not simulated until a spore lands there.
- **Scope for v1:** single-player versus AI, one biome, desktop web. Explicitly
  out of scope: mobile, above-ground micro, more than four players,
  user-generated maps.

Open product decisions carried forward, not yet settled:

- Direct control of individual hyphal tips versus policy-and-watch influence.
- How much agency trees exercise on their own.
- Whether a dead network becomes decomposer food for its rivals (spec
  recommends yes).

## Brand Commitments

The working title **Mycelia** is fixed for this build. The spec pins the art
direction as a binding commitment: *"documentary beautiful — like a BBC nature
film you can play."* Specifically:

- Near-black soil with glowing, bioluminescent networks; each species carries a
  distinct colour and growth texture. The player is warm gold/amber; honey
  fungus is sickly pale; truffles are deep violet.
- Nutrient flow is visible as drifting motes of light travelling through cords.
- Above ground is painterly and seasonal: god rays, drifting spores, rain.
- The interface is organic and minimal — growth rings as progress, woodgrain
  panels, no hard chrome.
- Audio is a low ambient drone with cello; network activity reads as soft clicks
  and pulses. Forest sound carries the game's state: woodpeckers mean health,
  silence means something is wrong.

The art direction is **hybrid**. The underground is shader-driven and not
asset-heavy: procedural hyphal growth, particle flows, and lighting do the work,
and that is what makes a web build feasible. The surface accepts authored 3D
models for the few things a player reads by silhouette — trees, deadwood,
fruiting bodies, ground props — with generated geometry still standing in for
anything that has not been modelled yet. The asset contract lives in
`DESIGN.md`; the intake pipeline never makes the game depend on a file being
present.

## Evidence on Hand

The design spec at `mycelium-rts-outline-spec.md` is the single source of
product truth and is unusually complete: high concept, core loop, objectives,
threats, world model, resources, player mechanics, opponents, RTS structure,
art direction, technical architecture, roadmap, and open questions.

The repository now contains a working deterministic browser simulation, an
underground strategy view, a functional 3D surface-forest prototype, UI and
audio systems, headless simulation tests, and a local browser-capture harness.
`PROJECT_STATUS.md` is the authoritative record of what is implemented,
verified, partial, planned, or deferred. There is still no shipped-product
evidence, public player base, review corpus, or press; no player counts, review
scores, external benchmarks, or testimonials may be authored.

## Product Principles

1. **The forest is the scoreboard.** Every mechanic should make the player feel
   the health of the world they are farming, not just their own stockpile.
2. **Every asset is someone else's food.** Death, decay, and loss must feed the
   board rather than simply subtract from the player.
3. **Nothing can be hoarded.** Limited storage and universal decay force
   continuous investment decisions instead of safe accumulation.
4. **The network is the body.** No separate army, no unit selection; growth,
   supply, and defense are the same verb.
5. **Beauty is load-bearing.** The bioluminescent soil view is the product's
   main argument, not decoration, so it is built as simulation output rather
   than as a background image.

## Accessibility & Inclusion

Not yet established. The spec asserts an "APM-friendly for all skill levels"
intent, pause and variable speed as core features, and no color-only channel
requirement has been recorded. Species identity is currently assigned by
colour, which is a known risk for colour-vision deficiency and must be paired
with form, texture, or motion differences before it carries meaning alone.

Regional interaction now exposes colonized stands through the forest survey.
Each keeps a persistent local underground colony, and all occupied stands run
while the player is elsewhere. The established founding map remains compatible
with the original opening; neighboring worlds use regional site conditions.
A local two-bloom outcome can be followed by exploration of daughter stands;
the final regional victory condition remains undecided.
