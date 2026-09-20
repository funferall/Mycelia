# Mycelia — authoritative project status and feature log

Last updated: 19 September 2026.

This is the **single source of truth for implementation status, current
priorities, verification, and future work**. Read this file before changing the
project. `PRODUCT.md` defines product intent, `DESIGN.md` defines the visual
system, and `mycelium-rts-outline-spec.md` is the original game specification.
Those documents do not replace this implementation record.

Do not create another implementation plan, roadmap, status report, or handoff.
Update this file instead. Historical explanations belong in git history.

## Status vocabulary

Use exactly these labels in the feature register:

- **Verified** — implemented and exercised by an appropriate automated or
  browser check whose evidence is recorded below.
- **Implemented, unverified** — present in code but its complete acceptance
  behavior has not been exercised.
- **Partial** — useful behavior exists, but named requirements remain.
- **Planned** — agreed work with no meaningful implementation yet.
- **Deferred** — deliberately outside the current milestone.
- **Blocked** — progress requires a named external decision or dependency.

Never mark a feature Verified because it compiles, renders once, or has some of
its visual ingredients. Record remaining gaps beside every Partial item.

## Current snapshot

Mycelia is a client-only TypeScript/Three.js ecological RTS with a deterministic
fixed-step simulation. A player grows a fungal network through a soil transect,
bonds with tree roots, trades resources, rests to gather reproductive surplus,
and fruits twice to win. One saprotroph rival grows in the same simulation.

The current working tree also contains the first functional version of the
requested 3D surface forest. The game opens above a seeded forest stand, allows
tree selection and camera exploration, and descends to the existing underground
view. The forest, roots, health, maturity, bonds, weather, and seasons read the
same simulation state. The surface implementation is substantial but remains a
prototype requiring weather, performance, and interaction QA.

The crossing between the two views was stabilized in the same working tree. It
is timed against the wall clock rather than against frames, reverses at any
point, dissolves the contents of the soil instead of switching them off, and
re-derives its viewport-dependent framing when the window changes shape.

The connected forest view and this log were committed as `89ee3cb`. The
wall-clock crossing, the overlay fade, the viewport re-framing, and the browser
check that covers them are local working-tree changes and have not been
committed or deployed.

The regional world model is being built underneath the running game: the region,
the stand generator's site conditions and the regional match are in the tree,
and the surface now draws all nine stands as one continuous forest with each
stand's own trees standing on its own ground. What remains regional is the
*play*: only the founding stand's ground can be entered, and the underground
views still hold one stand.

Surface art now arrives through an intake pipeline rather than only being
generated in code. `src/render/assets.ts` loads authored glTF models, scales each
one to the simulation's own tree, corrects it onto the ground, tints it by season
and health, and falls back to the procedural stand whenever a file is missing.
`tools/make-forest-assets.py` now builds an original botanical low-poly pack
with Blender: living and dead/hollow oak, yellow birch and eastern hemlock,
three tiers per tree and sapling, understory, deadwood, reproductive bodies and
rocks. The six existing runtime paths carry the new art; the additional assets
and LOD tiers are delivered for the machinery lane to integrate, and the three
tree species now select their own tier from projected size on screen. Seasonal
tint and the underground environment remain procedural.

The browser harness now has an opt-in fast visual-QA preset (`?qa=fast` and
`--qa fast`). It keeps the CSS viewport, nine stands, simulation and
interactions intact while reducing only drawing work; ordinary loads remain on
the unchanged normal preset.

## Product direction that must be preserved

- The game has **two connected views**: a dimensional bird's-eye forest and the
  underground soil transect. The forest does not replace the underground game.
- The final battlefield is a **larger seeded region made of multiple logical
  forest-stand squares**, not a single isolated stand. Stand boundaries support
  simulation, streaming, ownership, and navigation, but the rendered landscape
  should read as one continuous forest rather than a visible chessboard.
- Regional generation must produce coherent terrain and hydrology first, then
  derive soil, forest communities, tree ages, deadwood, and threats from those
  conditions. Streams, ponds, wetlands, springs, slopes, ridges, and clearings
  must affect gameplay rather than exist as decorative props.
- The signature movement is **forest → tree → forest floor → roots → mycelium**,
  with a reversible return to the same surface context.
- Underground remains the main strategy space. Above ground communicates tree
  identity, health, bond outcomes, weather, seasons, fruiting, and forest state.
- The mood is documentary, meditative, and alive. Trees move in wind, loose
  leaves drift softly, weather passes through, and the same stand changes over
  seasons.
- Orders are growth directives and policies, not unit micromanagement. The
  forest is the scoreboard, the network is the body, and every resource remains
  spatial and connected.
- The standard game needs ecological opposition in addition to seasonal and
  weather pressure. Its conflicts should arise from root occupation, infection,
  resource trade, network predation, and the choice to defend or sacrifice
  living partners—not conventional ranged combat or unit armies.
- **Honey fungus (`Armillaria`) is the planned marquee antagonist.** It threatens
  the living forest the player depends on, spreads through roots and dark
  rhizomorphs, exploits stressed trees, and gains food when a host dies.
- A separate **Chill mode** should preserve the complete cultivation sandbox
  with no aggressive root pathogen, gentler competition and weather, no tree-loss
  timer, and optional open-ended play after fruiting.
- Tree roots must follow species ecology and site conditions. Species supplies a
  growth tendency; soil depth, drainage, compaction, water table, slope, age,
  health, old root channels, and damage determine the realized architecture.
- Preserve deterministic simulation boundaries: `src/sim/` must not depend on
  Three.js, the DOM, wall-clock render time, or `Math.random`.
- Desktop web and single player are the current target. Multiplayer, additional
  biomes, and above-ground unit control are outside the current milestone.

## Architecture

| Area | Primary files | Current responsibility |
|---|---|---|
| Simulation | `src/sim/{sim,network,world,content,rng}.ts` | One stand: seeded soil, fixed timestep, resources, network growth, tree trade, seasons, fruiting, outcomes |
| Region | `src/sim/region.ts` | The 3×3 stand mosaic: one heightfield, drainage and streams, water table, communities, adjacency, wind, seed validation |
| Regional match | `src/sim/match.ts` | Every stand in a region, stepped in a fixed order, with spores carried between neighbours and colonies founded for what the parent paid |
| Integration | `src/game.ts`, `src/main.ts` | Frame loop, input, view state, simulation/render/UI/audio synchronization |
| Connected camera | `src/render/camera.ts` | Forest and underground camera goals, remembered player framing, wall-clock view crossings, viewport re-framing, reduced motion |
| Overlay fade | `src/render/fade.ts` | Dissolves the networks, motes, roots and rewards through a view crossing |
| Surface forest | `src/render/surface.ts` | Seeded 3D tree placement, forest floor, tree picking, wind, leaves, rain, seasonal presentation |
| Authored models | `src/render/assets.ts`, `src/render/lod.ts`, `public/assets/forest-manifest.json`, `tools/{make-forest-assets.py,check-forest-assets.mjs}` | Manifest-driven glTF intake, per-asset tiers and fallback; projected-size LOD selection with hysteresis; reproducible Blender art and exported-pack QA |
| Underground world | `src/render/{soil,forest,hyphae,living}.ts` | Soil, roots, networks, flow motes, mushrooms, spores, interaction feedback |
| Shared stage | `src/render/{stage,quality,textures}.ts` | WebGL renderer, lights, fog, paper/specimen transition, bloom, opt-in fast QA preset |
| Audio | `src/audio/soundscape.ts` | Ambient synthesis, bond/fruit/action cues |
| Interface | `index.html`, `src/styles.css`, `src/ui/{sheet,journey}.ts` | Botanical field interface, resources, orders, guidance, view and tree controls |
| Validation | `tools/test-sim.mjs`, `tools/test-region.mjs`, `tools/test-lod.mjs`, `tools/test-view.mjs`, `tools/test-journey.mjs`, `tools/shoot.mjs`, `tools/{browser,preview}.mjs` | Headless regressions for one stand, for a region and for LOD bands and hysteresis, browser checks for the connected views, tiers and input, a whole match played through the interface, and screenshot/error capture |

The simulated soil is still a two-dimensional transect. Each simulated tree has
one horizontal `gx` coordinate and stable root IDs. `treeSurfacePosition()` in
`src/render/surface.ts` gives the same tree a seeded presentation-only depth on
the forest floor. Descending maps the selected crown back to that tree's real
root target. Do not imply that arbitrary surface depth is simulated terrain.

The current `136 × 112` world is one local stand-sized transect, not the final
regional map. The planned regional architecture treats it as a local simulation
unit beneath one logical stand. Neighboring stands must share seeded boundary
conditions—elevation, water flow, soil horizons, roots, and network crossings—so
moving between them does not create unrelated miniature maps.

`src/render/canopy.ts` is the superseded canopy renderer. It is no longer
instantiated by `Game`; keep it only until the new surface rendering is accepted
and equivalent useful details have been accounted for, then remove it.

## Feature register

### Core simulation and complete match

| ID | Status | Feature | Evidence and remaining work |
|---|---|---|---|
| CORE-01 | Verified | Deterministic fixed-step simulation | Identical-order determinism passes in `npm test`. |
| CORE-02 | Verified | Resource conservation and founding reserve | Birth, decay, harvest, construction, and reserve assertions pass. |
| CORE-03 | Verified | Living connectivity and tree trade | Cut supply and dead-founder disconnection tests pass. |
| CORE-04 | Verified | Supplied fruiting and stored bloom history | Weather pause, supplied progress, severed loss, and actual bloom locations are covered. |
| CORE-05 | Verified | Repeatable two-bloom victory | `raven-wood`, `old-growth`, and `ironwood` complete through public orders with 480 spores. |
| CORE-06 | Verified | Outcome and command guards | Invalid/deep fruiting, permanent cords, and post-outcome guards pass. |
| CORE-07 | Verified | First-player journey through the actual UI | `npm run test:journey` plays a whole match with clicks on the sheet's own controls: Awaken the spore, a `Reach` root label, the `Bond` label that appears, the soil itself to send the frontier up, Rest & gather, the Fruit order, a marked strand, and the outcome's "Open a new sheet". `raven-wood` finishes with 2 blooms and 480 spores at 354s of match time, and the new sheet opens fresh. |

### Forest and underground views

| ID | Status | Feature | Evidence and remaining work |
|---|---|---|---|
| VIEW-01 | Implemented, unverified | Bird's-eye 3D forest | Every stand in the 3Ã—3 region now draws its own ground and its own trees, laid out as one continuous forest, and each tree wears an authored model when one is loaded and the procedural body when one is not. Understory, litter, seeded props, wind, rain and seasonal colour are present. Verify: mature and dead stands, and the portrait framing of the whole region, still need a look. |
| VIEW-02 | Implemented, unverified | Surface tree identity and selection | Crowns and selector options use simulation tree IDs; status reflects health, death, and bonds. Add automated crown-selection and tree/root round-trip checks. |
| VIEW-03 | Verified | Seamless forest ↔ underground journey | View buttons, `V`, zoom threshold, remembered player framing, selected-root descent, and reduced-motion snapping exist. The crossing is now driven by a wall-clock timeline (`CROSSING_SECONDS`), so a 30fps rise and a 4fps rise both take 1.50s; it reverses at any point with a duration proportional to the distance left, and the soil's contents dissolve from their own opacities instead of being switched off at a blend threshold. `npm run test:view` covers both frame rates, a half-way reversal, a rapid double reversal, endpoint exactness, reduced motion, and crown-to-root round trips. Remaining: the crossing is still one camera rising through one scene rather than a blend of two rendered views. |
| VIEW-04 | Partial | Camera navigation | Forest pan/orbit/zoom, underground pan/tilt/zoom, keyboard pan/zoom, and `F` framing exist. A viewport change now re-derives the active view's default framing, and the forest framing fits the whole stand at any aspect instead of cropping its ends on a portrait window. `npm run test:view` projects the specimen corners and every crown at 1600×1000, 1366×768, and 390×844. Remaining: interrupted transitions during a drag, and the 1180px breakpoint band, have not been exercised. |
| VIEW-05 | Verified | Safe input separation | Forest clicks select trees; underground clicks issue orders; input is suppressed during transitions. `npm run test:view` now covers the cases the row was waiting on: a drag pans instead of ordering while a tap on soil orders, a refused order is refused out loud and changes nothing, a cancelled pointer issues nothing and leaves the canvas still able to pan, a click during a crossing issues nothing, one wheel notch does not cross while six do, a key typed into the tree selector does not reach the sheet, the canvas answers `V`, `1-4`, the arrows and Space, and a burst of five view changes lands in the view asked for last with input still live afterwards. |

### Authored surface art

| ID | Status | Feature | Evidence and remaining work |
|---|---|---|---|
| ASSET-01 | Partial | Authored model intake | The existing registry loads six replacement botanical models; scaling, ground correction, seasonal/health material tint and procedural fallback are unchanged. Tree and sapling GLBs now contain `anchor_crown`; the loader still ignores it. Remaining: browser missing-file/late-load checks, anchor consumption, LOD selection, dead-variant switching and foliage instancing. Current art verification is recorded under 19 September below; the 18 September browser results describe the previous art. |
| ASSET-02 | Partial | Botanical asset pack | `tools/make-forest-assets.py` builds 21 original low-poly assets / 39 GLBs: three living species and their dead/hollow variants, three saplings, fern, grass, stump, log, snag, root plate, four reproductive bodies and two rock props. The six original paths replace placeholders immediately; other files are listed in `forest-manifest.json` for integration. Remaining: art-direction acceptance, fruiting-body integration into LivingView/surface outcomes, community-driven prop placement, new understory/rock/spore usage, and runtime dead variants. This is a stylized botanical first pass, not photoreal scanned art. |
| ASSET-03 | Partial | Asset contract, LOD and validation | `DESIGN.md` specifies separate tier files, 2,000/900/320 tree triangle budgets, 500 for props, Y-up metres, ground contact, named double-sided foliage and crown anchors. All trees, dead variants and saplings carry three tiers. `tools/check-forest-assets.mjs` checks the shipped pack through Three.js for exported counts, bounds, anchors, materials and budgets. `src/render/assets.ts` now reads `forest-manifest.json` for each asset's tier files, loads tier 0 eagerly and warms the rest in the background; `src/render/lod.ts` selects a tier from a tree's projected height as a fraction of the viewport, with a 15% hysteresis margin so a tree on a boundary cannot flicker. A swap replaces geometry only: the placed copy keeps its position, rotation and scale, and a tree keeps its simulation ID and asset across every tier. Remaining: foliage/wood instancing, authored wind clips, a general dropped-in-file validator, and camera-distance transition tuning. Pack QA does not cover loader failure paths. |

### Regional map, terrain, forest stands, and water

| ID | Status | Feature | Evidence and remaining work |
|---|---|---|---|
| MAP-01 | Partial | Multi-stand regional map | A match is now a seeded 3×3 region of logical stands with orthogonal adjacency, chosen at 3×3 for prototyping. Every stand is reachable from the founding stand by construction, and that reachability is validated. Remaining: the region is not rendered or navigable in the game yet, and the shipping size is still open. |
| MAP-02 | Partial | Continuous regional surface | There is one `heightAt` for the whole region, the shared edges of neighbouring stands agree exactly, and the renderer draws every stand floor and its trees as one continuous forest rather than one stand of floor. Remaining: the stream, ponds and exposed rock are not drawn yet, and the tiles nearest the camera still lose their floor below the slab. |
| MAP-03 | Partial | Terrain-first generation | Elevation, a regional fall line, a valley, drainage from a priority flood, flow accumulation and aspect are all generated before anything is placed, deterministically from the seed. Remaining: exposed rock, parent material and deadwood are still local, and there is no generator-version field. |
| MAP-04 | Partial | Hydrology and water features | Watersheds, flow paths and a stream are derived from the terrain; the stream crosses three to six stand borders depending on the seed, and its course is a polyline the renderer could draw. The water table follows relief and flow, and each stand passes its own table depth into the local soil generator. Remaining: ponds, vernal pools, springs, seasonal channels, erosion and saturation barriers. |
| MAP-05 | Partial | Distinct forest stands | Seven communities are derived from moisture, drainage, slope, relief and disturbance (oak ridge, mixed slope, birch hollow, hemlock ravine, stream corridor, wetland edge, recovering clearing), the community sets the stand species mix, and each stand now draws its own trees from that mix. Remaining: density, age structure, canopy openness, understory, litter and deadwood still do not vary by community, and the floor props are seeded per stand rather than chosen by the community. |
| MAP-06 | Partial | Stand suitability and succession | Species placement follows the community a stand's own moisture, drainage and slope produce: a stream corridor grows birch and hemlock, an oak ridge grows oak, a ravine grows hemlock. Remaining: succession through gaps, regeneration and recovery is unchanged from the single-stand prototype. |
| MAP-07 | Partial | Cross-stand fungal network | A colony can found a daughter stand across an explicit adjacency edge, carried by wind, and what crosses the border is only what the parent paid, in carbon, water and mineral, asserted exactly. Remaining: cords, resource transport, infection and warnings across a boundary, and roots crossing one. |
| MAP-08 | Planned | Regional exploration and information | Let the player survey the region from above, select a stand/tree/water feature, and descend to the correct local underground context. Use soil opacity, incomplete surveys, and network sensing as fog of war rather than a conventional minimap. |
| MAP-09 | Partial | Generated-map fairness | Validation refuses a region whose stands cannot be reached from the founding stand, or whose founding stand has no water in reach; the founding stand is chosen for habitable ground near water on the way down. Remaining: no repair pass, no threat-counterplay check, and no check that a loss is recoverable. |
| MAP-10 | Partial | Regional colonization loop | A bloom releases spores that ride the region's own wind: adjacent stands by default, and stands beyond them only in a storm. A spore founds a daughter colony that begins as a germinating spore holding exactly the fund its parent paid. Remaining: the regional objective is still the two-bloom prototype victory, and the hops are not drawn. |
| MAP-11 | Planned | Regional atlas interface | Provide a restrained botanical survey layer showing stand identity, explored state, broad health, water, infection, and network continuity. It must use the established field-record language and avoid a generic RTS minimap or tile HUD. |
| MAP-12 | Partial | Simulation streaming and level of detail | Every colonized stand steps at full fidelity every tick, in stand order, and ground with no colony in it is not simulated at all, which is what keeps nine stands affordable. Moving between stands provably changes no number (asserted against an unwatched match). Remaining: coarse cadence for distant colonies, rendering LOD, pooled geometry and bounded particles. |
| MAP-13 | Partial | Generator persistence and replay | The region is a pure function of its seed: two matches from the same seed colonize the same stands with the same spores and end in the same state. Remaining: no save or replay format, no generator-version field, and no RNG-state serialization. |

#### Regional generation order

Generate the region in dependencies so every visible feature has an ecological
reason:

1. Create a low-frequency regional heightfield with ridges, slopes, hollows, and
   outlets; avoid isolated noise applied independently to each square.
2. Resolve drainage direction, catchments, persistent water bodies, seasonal
   channels, wetlands, and groundwater tendencies across the whole region.
3. Derive soil depth, horizons, rockiness, organic accumulation, drainage, and
   water table from terrain and parent material.
4. Assign potential stand communities using moisture, aspect, soil, elevation,
   light, and disturbance history.
5. Generate tree species, ages, spacing, canopy structure, root graphs,
   understory, litter, deadwood, and regeneration within each stand.
6. Place resources, fungal colonies, infection sources, scenario objectives, and
   the viable player start after the ecological substrate exists.
7. Run deterministic validation and repair passes so no seed begins unwinnable
   or disconnects required routes behind impossible terrain.

Logical squares should organize state without forcing square-looking ecology.
Streams cross boundaries continuously, stands can feather into one another, tree
crowns can overhang adjacent stands, and fungal connections can cross edges.

#### Local underground model

The recommended first architecture is a regional surface grid whose stands each
own a persistent local soil transect derived from the shared regional seed and
boundary conditions. The current grid can become that local unit.

- Descending on a tree, patch, or water feature opens the corresponding stand's
  persistent underground context; it must not generate a new disposable slice.
- Neighboring transects expose deterministic edge portals for cords, moisture,
  roots, infection, and resource transport.
- Terrain elevation determines each stand's soil datum; connected horizons and
  water tables must agree at boundaries.
- Streams and ponds raise nearby water availability and may create saturated,
  oxygen-poor barriers. Fallen logs, root grafts, or reinforced cords can create
  strategic crossings.
- Distant stands may use coarser update intervals, but camera movement cannot
  change simulation results. Re-entering a stand must show everything that
  happened while it was out of view.
- A future arbitrary 3D soil volume is not required for the first regional
  version. Do not fake arbitrary underground depth while still simulating only
  local transects.

#### Stand examples

- **Oak ridge:** deep, well-drained soil pockets separated by rock; stronger
  drought access, sparse water, older high-value hosts, and exposed wind.
- **Yellow-birch hollow:** moist fertile loam, irregular lateral roots, fallen
  logs and regeneration, plentiful early partners, and infection paths through
  grafts and concentrated roots.
- **Hemlock ravine:** cool shade, thick duff, shallow wide roots, persistent
  moisture, difficult light, and vulnerability to drought or windthrow after
  canopy gaps.
- **Stream corridor:** reliable water and mineral transport, seasonal flooding,
  saturated barriers, bank erosion, dense fine roots, and highly contested
  crossings.
- **Wetland edge:** abundant water but low oxygen and restricted rooting depth;
  seasonal expansion and contraction changes access.
- **Windthrow gap:** deadwood and light create a decomposer boom, sapling
  recruitment, exposed surviving trees, and a temporary resource land rush.
- **Recovering clearing:** young dense roots and high light but little established
  carbon, making early colonization priority especially important.

### Living atmosphere

| ID | Status | Feature | Evidence and remaining work |
|---|---|---|---|
| ATM-01 | Partial | Wind-driven stand | Whole-tree anchored sway and faster per-leaf shader motion exist. Add one shared wind vector/strength, coherent gust fronts, and tree-size/species stiffness. |
| ATM-02 | Partial | Detached drifting leaves | Bounded instanced leaves drift and increase in autumn; reduced motion and a Wind toggle suppress them. Add settling/fading at the floor and couple them to the shared wind model. |
| ATM-03 | Partial | Weather | Rain follows authoritative simulation rainfall and is suppressed underground. Add clear/overcast transitions, mist, cloud shadow, restrained wetness, and surface/underground weather audio. Cosmetic weather must never create resources. |
| ATM-04 | Partial | Four visible seasons | Seasonal tint is the chosen art contract; no four-mesh seasonal set. Procedural deciduous trees blend leaf density, while authored trees currently only change color; hemlocks retain foliage. Bare dead/hollow assets are delivered but not switched at runtime. Add authored foliage density, spring emergence, stronger drought stress, litter, winter lighting, and dormant-versus-dead selection. |
| ATM-05 | Partial | Ecological surface truth | Health, maturity, death, bond text, rain, and season are simulation-driven. Confirm all visible outcomes on the same trees across both views and add fruiting bodies to the surface context where appropriate. |

### Ecological opposition, modes, and root architecture

| ID | Status | Feature | Evidence and remaining work |
|---|---|---|---|
| ADV-01 | Planned | Ecological opposition framework | Add deterministic pressure from root occupation, host infection, fungal predation, and resource competition. Every threat must transform the ecology and offer readable counterplay rather than act as generic damage. |
| ADV-02 | Planned | Honey fungus (`Armillaria`) | Marquee pathogen begins in infected deadwood or a stump, scouts with black rhizomorphs, attacks vulnerable roots, progresses toward the root collar, kills weakened hosts, and consumes their remains. Implement detection, infection stages, surface symptoms, mushroom warning, and AI. |
| ADV-03 | Planned | Rival mycorrhizal fungi | Compete for unoccupied fine-root tips using ecologically distinct strategies and first-colonizer priority. Trees may support different partners across their root systems and should allocate more carbon to useful trade relationships. |
| ADV-04 | Planned | Mycoparasitic fungus | Rare direct predator tracks, coils around, and digests exposed fungal hyphae. Fine exploratory growth is vulnerable; reinforced cords and redundant paths resist or route around attack. Use sparingly after `Armillaria` and root competition are proven. |
| ADV-05 | Partial | Saprotroph competitor | One deterministic saprotroph network already exists, but it is not yet a complete ecological opponent. Clarify its role as a decomposer racing for dead matter rather than a substitute for a root pathogen or mutualist rival. |
| ADV-06 | Planned | Defensive counterplay | Add early sensing, tree provisioning, cord reinforcement, defensive enzymes, root quarantine, deliberate branch sacrifice, rerouting, occupation of vulnerable tips, and escape by early fruiting. Each response needs a cost and visible consequence. |
| MODE-01 | Planned | Standard cultivation-under-pressure mode | One concealed `Armillaria` infection center, one or two competing mutualists, a decomposer benefiting from death, and seasonal/weather pressure. Tune around defense, triage, and eventual fruiting rather than total extermination. |
| MODE-02 | Planned | Chill mode | No aggressive root pathogen, slower or non-hostile competitors, gentler extremes, no forced tree-loss clock, and optional continued play after fruiting. Preserve the full growth, trade, season, and forest-feedback systems. |
| SCENARIO-01 | Planned | Ecological crisis scenarios | Author scenario identities such as The Black Cords, The Withering Hemlocks, The Fallen Giant, First Claim, The Hollow Stand, and After Fire. Introduce one pressure system clearly before combining many. |
| ROOT-01 | Planned | Species- and site-driven root generator | Replace generic root lines with structural architectures derived from species, maturity, soil horizons, hardness, drainage, water table, slope, and available channels. Keep the generator seeded and simulation-owned. |
| ROOT-02 | Planned | Northern red oak architecture | Strong early central descent where soil permits, durable spreading structural laterals, and deeper sinkers/fine-root zones. Gameplay: costly deep access, drought resilience, high-value long-term partner. Avoid guaranteeing a taproot where hardpan or saturation prevents one. |
| ROOT-03 | Planned | Yellow birch architecture | Extensive irregular laterals, commonly shallow but able to penetrate deeply on favorable sites; follow old channels and allow root grafts. Gameplay: many accessible tips and flexible routes, with grafts also creating infection corridors. |
| ROOT-04 | Planned | Eastern hemlock architecture | Shallow, wide-spreading roots concentrated in cool moist upper soil and duff. Gameplay: accessible surface partnership and moisture retention, with strong drought, injury, and windthrow vulnerability. |
| ROOT-05 | Planned | Functional root hierarchy | Generate coarse structural roots, secondary connectors, localized fine-root zones, and active bondable tips. Do not render every root with equal weight. Infection, trade, damage, and fungal bonds must travel through the actual root graph. |
| ROOT-06 | Planned | Living root response | Healthy supplied trees extend roots and create new opportunities; drought, disease, damage, compaction, saturation, and death alter growth and connectivity. Root changes must remain deterministic and conserve resources. |

#### Adversary roles and interaction rules

The adversaries should occupy different ecological roles so matches do not
become a collection of differently colored attacking networks:

- **Honey fungus threatens the forest.** Its strategic arc is concealed source →
  rhizomorph scouting → root infection → root-collar progression → declining
  crown → host death → decomposer reward. A healthy, well-supplied tree resists
  longer; neglect and drought create openings.
- **Mycorrhizal rivals threaten opportunity.** They reach the same fine-root
  tips, obtain first-colonizer advantages, and compete through occupation and
  trade quality. They should not need a diplomacy-free extermination rule.
- **Mycoparasites threaten the player's body.** They punish thin, overextended
  hyphae and make cord reinforcement, redundancy, quarantine, and branch
  sacrifice meaningful.
- **Saprotrophs threaten access to death.** They race for fallen wood, dead
  roots, and severed networks, turning every loss into a contested resource
  pulse.

The player's central problem is maintaining a living partnership while several
systems pull it apart:

1. Expand toward resources and fine-root opportunities.
2. Supply trees to earn carbon and keep hosts resilient.
3. Decide whether to race rivals, reinforce the network, or deepen supply.
4. Detect and contain infection before it reaches a root collar or central cord.
5. Quarantine, sacrifice, redirect, or fruit when the whole forest cannot be
   saved.

Death must change the board rather than merely subtract hit points. A tree killed
by `Armillaria` opens light above ground, removes carbon income, adds dead roots
and wood, and creates a decomposer land rush. Saving a host should preserve both
economy and forest structure; sacrificing one may protect the wider stand.

#### Planned ecological scenarios

- **The Black Cords:** locate and contain a spreading honey-fungus infection
  before it reaches the oldest host trees.
- **The Withering Hemlocks:** maintain shallow-rooted, moisture-dependent trees
  through drought while rivals compete for the remaining wet refuges.
- **The Fallen Giant:** a windthrown oak produces a large deadwood pulse and a
  rapid decomposer race while its former partners lose carbon income.
- **First Claim:** several mutualist fungi race to colonize a young stand;
  arrival order and trade quality shape long-term control of root tips.
- **The Hollow Stand:** outwardly healthy trees share an initially hidden root
  disease center, making detection and quarantine more important than expansion.
- **After Fire:** canopy loss removes carbon income, exposes surviving networks,
  and creates a nutrient-rich recovery landscape. Keep this scenario deferred
  until fire and regeneration systems exist.

#### Root generation rules

Root architecture must be generated as a living graph, not as decorative lines:

1. Build a species and maturity-specific structural skeleton.
2. Deflect, flatten, fork, or stop growth in response to soil horizons,
   compaction, rock, bedrock, drainage, and water table.
3. Add lateral and sinker roots toward credible moisture and nutrient zones.
4. Add dense but visually restrained fine-root regions around favorable soil.
5. Expose only active fine-root tips as mycorrhizal bond targets.
6. Modify growth, mortality, grafting, and replacement through age, health,
   damage, disease, and season.

The visual hierarchy should show a small number of substantial structural roots,
secondary connectors, and fine-root brushes or clouds. Selecting a crown must be
able to trace one continuous path through its root graph to an active tip. Root
grafts can transmit resources, warnings, and disease, making them both an
opportunity and a liability.

Ecological references supporting this direction:

- [USDA Forest Service — Armillaria root disease](https://www.fs.usda.gov/sites/nfs/files/legacy-media/r02/2%20pager%20-%20armillaria.pdf): wide host range, spread through root contact and rhizomorphs, and increased danger to stressed trees.
- [Kennedy, Peay, and Bruns — ectomycorrhizal root-tip competition](https://pubmed.ncbi.nlm.nih.gov/19739372/): priority effects and root-tip occupation can determine competitive outcomes.
- [Trichoderma-pathogen interaction study](https://journals.asm.org/doi/10.1128/aem.70.5.3073-3081.2004): hyphal tracking, coiling, and specialized mycoparasitic contact structures.
- [USFS Silvics — northern red oak](https://research.fs.usda.gov/silvics/northern-red-oak): vigorous early taproot development where soil permits and its role in moisture-stress survival.
- [USFS Silvics — yellow birch](https://research.fs.usda.gov/silvics/yellow-birch): extensive lateral roots, site-dependent depth, root-channel following, and root grafting.
- [USFS Silvics — eastern hemlock](https://research.fs.usda.gov/silvics/eastern-hemlock): shallow-rooting vulnerability, moist-site ecology, drought sensitivity, and windthrow risk.

### Interface, audio, accessibility, and delivery

| ID | Status | Feature | Evidence and remaining work |
|---|---|---|---|
| UX-01 | Verified | Guided opening and journey model | `deriveJourney()` drives Reach → Bond → Gather → Fruit guidance. `npm run test-journey` follows that guidance to the end of a match — each step is taken by clicking the label or control the guidance offers — and `npm run test:view` checks that a refused order (paper outside the specimen) is explained rather than silently dropped. |
| UX-02 | Partial | Actionable root labels | Explicit root IDs and states exist. Verify collision handling, safe areas, compact viewports, and prioritization during a mature match. |
| UX-03 | Partial | Responsive layouts | Desktop render is inspected; compact styles exist. `npm run test:view` now asserts at 1600×1000, 1366×768, and 390×844 that the canvas fills the viewport, that the view controls stay on screen, and that all 13 catalogue figures are present and inside the viewport. Remaining: touch input, real phone and tablet hardware, and the 1180px breakpoint band. |
| AUDIO-01 | Partial | Generative soundscape | Ambient synthesis and restrained event cues exist. Add weather/forest layers and verify toggle, suspension, restart, and audio failures on speakers and headphones. |
| A11Y-01 | Partial | Reduced motion and keyboard access | Direct view snapping, ambient-motion control, focus outlines, keyboard view/pan/zoom/orders, pause, and notes controls exist. Audit focus order/restoration, canvas alternatives, and color-independent state cues. |
| PERF-01 | Planned | Measured performance budget | Measure simulation time, render time, draw calls, GPU/CPU memory, and frame time at opening, mature match, and the configured network ceiling on stated hardware. |
| PERF-02 | Partial | Scalable surface quality | An explicit opt-in fast QA preset (`?qa=fast`, `--qa fast`) now halves the drawing-buffer resolution, disables antialiasing and baked tree-shadow decals, and bypasses bloom and postprocessing while preserving the CSS viewport, all nine stands, simulation, selection, camera transitions and input. Normal remains the shipping default. Authored tiers are now chosen at runtime from projected size (`ASSET-03`): the 19 September fast-preset run recorded the region overview at 0 LOD0 / 57 LOD1 / 18 LOD2 of 75 trees and a close camera at 44 / 31 / 0. Remaining: production quality tiers chosen from profiling, foliage and weather tiers, and a measured frame-time and draw-call budget. Production JS remains about 752 kB with the Vite chunk-size warning. The botanical living trees cost 1,568–1,596 triangles at LOD0, 800–810 at LOD1 and 266–298 at LOD2; triangle savings alone are not a measured frame-time or draw-call budget. |
| SAVE-01 | Deferred | Local save/resume | Requires versioned deterministic simulation state, RNG state, bloom history, and camera/view state. |
| MULTI-01 | Deferred | Multiplayer | Do not begin before the single-player vertical slice and performance work are complete. |

## Current priorities

Work in this order unless the user explicitly changes priority.

19 September art-lane override: build the botanical asset pack in the requested
order (trees and variants, understory/deadwood, fungi, rocks). Runtime machinery
remains separate: ASSET-03 instancing next (LOD selection landed on 19
September), then wind hooks, intake failure/late-load validation, crown-anchor
consumption, ecological placement and the remaining PERF-02 production quality
tiers; the opt-in fast QA preset is implemented, but it does not close the
profiling gap. Seasons use procedural tint; underground structure stays
procedural. The new art does not close any of those runtime gaps.

Stopping point requested by the user on 19 September: the asset pack and its
rebuild/QA tooling are ready to commit. Runtime LOD selection now reads
`forest-manifest.json`; resume with foliage and wood instancing (ASSET-03), then
consume crown anchors and dead variants. Re-run the complete browser view suite
independently of Blender rendering before claiming current-tree interaction
verification.

### Next asset machinery approach (ASSET-03, PERF-01, PERF-02)

These are implementation notes, not completed work; feature statuses remain
unchanged.

1. **Done 19 September.** `src/render/assets.ts` consumes
   `forest-manifest.json` and `src/render/lod.ts` selects a tier by projected
   tree size, with separate thresholds for entering and leaving a tier so a
   tree on a boundary cannot flicker. Tiers past LOD0 are warmed in the
   background and a swap keeps the placed model's position, rotation and scale.
2. Batch wood and foliage by species, living/dead variant, LOD and material
   using `InstancedMesh`. Carry health, seasonal tint and wind variation as
   per-instance data so batching preserves each tree's state.
3. Maintain an explicit instance-index-to-simulation-tree-ID mapping for
   selection, including when instances move between batches. Preserve the
   living model's scale, ground contact and crown anchor across tier/variant
   changes; never feed presentation choices back into the simulation.
4. Measure draw calls and frame time across all nine stands, then tune LOD
   thresholds and quality tiers from those measurements. Lower triangle counts
   alone do not establish a performance improvement.

### Faster testing and render iteration

The browser harness currently forces software WebGL and renders complete frames
during many logic checks. Running Blender renders alongside it also introduces
resource contention. The full interaction suite was excessive for the
asset-only iteration; choose checks according to what changed.

- **Routine edits:** run relevant fast checks such as `npm run test:assets`
  and `npm run typecheck`. When implementing LOD/instancing, add focused tests
  for threshold hysteresis, stable selection mappings and preserved transforms.
  Separate state/transition calculations from drawing so logic tests can
  advance without rendering every frame. `tools/test-lod.mjs` and the browser
  tier checks now cover the LOD half of that; instancing still needs its
  instance-to-tree mapping test.
- **Visual smoke checks:** the explicit `?qa=fast` / `--qa fast` preset is
  implemented. It keeps the CSS viewport, scene graph and simulation intact,
  halves the drawing-buffer resolution, disables antialiasing and baked
  tree-shadow decals, and bypasses bloom and postprocessing.
  `node tools/test-view.mjs --qa fast --smoke` checks load, all nine stands,
  tree selection, descent and return; `tools/shoot.mjs --qa fast` captures.
  Every browser tool prints the preset, backend, CSS size and drawing-buffer
  size. Keep full-quality checks for defects the cheaper preset could hide: it
  is not a performance measurement or an adaptive production quality tier.
- **Blender drafts:** use lower resolution and fewer samples; use GPU rendering
  when available and verified. Reserve final-resolution specimen sheets for
  accepted geometry. Configurable draft rendering is still to be implemented.
- **Milestones and relevant runtime changes:** run the full browser regression
  and full-quality captures separately from Blender. Keep software rendering
  for intentional slow-machine coverage; record the backend and quality preset
  with results, and do not treat draft captures as performance measurements.

### P0 — stabilize and verify the connected views

1. **Done in this changeset.** The underground visibility threshold is gone:
   the networks, motes, roots and rewards dissolve from their own opacities
   across the crossing, and are hidden outright only once they are gone.
2. **Done in this changeset.** The crossing runs on a wall-clock timeline, so a
   4fps rise takes the same 1.50s as a 30fps one, and it reverses at any point
   with a duration proportional to the blend left to travel.
3. **Done in this changeset.** A viewport change re-derives the active view's
   default framing, and the stand's framing now fits the whole stand at a
   portrait aspect. `npm run test:view` covers 1600×1000, 1366×768, and
   390×844.
4. **Done in this changeset.** `npm run test:view` now also covers the wheel
   threshold, pointer cancel, drag-versus-tap, refused orders, mid-crossing
   clicks, control focus, keyboard orders, pause, and a burst of view changes.
5. **Done in this changeset.** `npm run test:journey` plays a two-bloom match
   to the outcome and the restart through the sheet's own controls.

Exit criteria: the same selected tree can be followed down and back repeatedly,
with no unintended order, lost input, abrupt world pop, or broken framing.
Each clause of that now has a check behind it: the crown round trip, no order
from a drag or a mid-crossing click, input still live after a burst of view
changes, continuous dissolve with exact endpoints, and the three viewport sizes.
What remains untested is the wider browser matrix — a second engine, a second
GPU, and touch input — which is recorded under `UX-03`.

With P0 complete, P1 — the deterministic regional world model — is the next
work in order.

### P1 — define the scalable regional world model

1. **Done in this changeset.** `src/sim/region.ts` holds the deterministic data
   model: one heightfield, a fall line and valley, drainage from a priority
   flood, flow accumulation, a stream, a water table, per-stand communities,
   orthogonal adjacency, wind with storms, and seed validation.
2. **Done in this changeset.** `createStandWorld` generates one stand's soil
   from its site — the region supplies the water table and the species mix, the
   stand supplies its own noise — and `createWorld` is the same function with
   the prototype's default site, so the single-stand path and its ten
   deterministic checks are unchanged (identical journey results after the
   change).
3. **Half done.** Terrain and water cross stand borders coherently and the
   stream crosses three to six of them; `RegionalMatch` keeps a stand's
   simulation alive while nobody is looking and lets the player re-enter it.
   Remaining: nothing *renders* the region, and no control descends into a
   second stand yet.
4. **Done in this changeset.** Every colonized stand steps at full fidelity
   every tick, in stand order; uncolonized ground is not simulated at all. A
   two-minute match is asserted to be identical whether or not the player moves
   between stands, so the camera cannot reach the results. Coarse cadence for
   distant colonies is deliberately still open.
5. **Partly done.** The region is deterministic and validated, all twelve shared
   borders are asserted equal in height and flow, hydrology and colonization are
   covered end to end, and two matches are compared. Remaining: no save/replay
   format to round-trip.

Exit criteria: at least four connected logical stands render as one continuous
forest, share coherent terrain and water, retain persistent underground state,
and exchange resources through deterministic boundary connections. The terrain,
water, persistence and boundary exchange now hold in the simulation; rendering
the region and navigating it is what remains.

### P2 — establish real roots and ecological opposition

1. Replace generic tree-root polylines with a deterministic root graph and the
   oak, birch, and hemlock architecture rules in `ROOT-01` through `ROOT-06`.
2. Make tree/root selection, bonds, trade, infection, and rendering reference the
   same root graph rather than independently inferred positions.
3. Define the threat-state model shared by competitors: sensed, contacted,
   established, damaging, quarantined, dead, and recycled.
4. Implement one mycorrhizal competitor based on root-tip priority and trade
   quality, retaining the saprotroph as a distinct decomposer role.
5. Implement the minimum `Armillaria` vertical slice: one buried source, black
   rhizomorph growth, staged root infection, tree-health consequences, visible
   warnings in both views, and at least two costly countermeasures.
6. Add Standard and Chill configurations before expanding to mycoparasites or
   multiple crisis types.

Exit criteria: a standard match contains understandable pressure beyond weather,
the player can prevent or contain some losses through ecological decisions, and
Chill mode preserves the same cultivation systems without aggressive infection.

### P3 — finish the living surface

1. Build a shared wind state with direction, strength, variation, and gusts;
   drive trees and loose leaves from it.
2. Add gradual clear, overcast, rain, and mist states using existing rainfall
   and moisture without changing gameplay accounting.
3. Deepen the four seasonal silhouettes and materials, especially autumn litter,
   summer stress, winter dormancy, and dead-tree readability.
4. Blend restrained surface wind/rain/leaf audio into the underground soundscape.
5. Show fruiting outcomes and tree recovery/decline clearly above ground.

Exit criteria: a recording of the same stand across four seasons and multiple
health/weather states is coherent, readable, and agrees with underground state.

### P4 — complete interaction and mature-match visual QA

1. Exercise root markers, journey guidance, rest/unrest, refused actions,
   mushroom growth, outcome/restart, pause, 1×/2×/4×, notes, and sound through
   the actual interface.
2. Inspect opening, first bond, expanded colony, drought, first mushroom, and
   victory. Ensure cords and resource pulses remain readable in dense networks.
3. Resolve label collisions and ensure actionable unbonded trees remain visible.
4. Audit focus, reduced motion, and non-color state distinctions.

### P5 — profile, optimize, and reconcile the visual system

1. Record performance on stated hardware before adding more rendering systems.
2. Remove or repurpose the unused `src/render/canopy.ts` after visual parity is
   confirmed.
3. Reconcile `DESIGN.md` tokens with the surface palette and intentional type
   additions. The current detector reports advisory palette/type drift.
4. Update README controls and implementation descriptions whenever user-facing
   behavior changes.

### Deferred breadth

Mycoparasite expansion beyond the first prototype, multiple simultaneous
pathogens, wildfire, logging, evolution trees, additional biomes, save/load,
backend services, and multiplayer remain deferred. Root-tip competition,
`Armillaria`, a decomposer role, and Standard/Chill modes are now planned parts
of the single-player slice. The regional stand system, terrain, and hydrology are
also planned foundations. Implement them after the connected-view P0 is stable
and before multiplying content. Do not use broader content to avoid finishing
either foundation.

## Known limitations and risks

- The forest is a seeded presentation strip over a 2D soil simulation, not a
  fully simulated 3D terrain volume.
- The current match contains one stand-sized transect. There is no regional
  view, atlas, cross-stand cord, or distant-stand cadence yet. The region exists
  in the simulation — a 3×3 mosaic with continuous terrain, a stream, per-stand
  communities and wind-carried spores — but the game still opens, renders and
  plays on the founding stand alone, and nothing draws the region or lets the
  player descend into a second stand.
- A colony that has fruited twice stops growing, as it always has, so a regional
  match is a founding colony plus whatever its spores founded before it won. A
  regional objective is still an open design question (MAP-10).
- Ground with no colony in it is not simulated at all: its history begins when a
  spore lands. That is deterministic and cheap, but it means an uncolonized
  stand does not drift while the player is away from it.
- The region renders as one forest now: every stand draws its own floor and its
  own trees, crowns in another stand can be selected and named, and the browser
  console is clean. What is still wrong, and is the immediate next work: the
  tiles nearest the camera lose their floor below the slab while their trees
  hang over the edge, the stream and standing water are not drawn, and nothing
  yet lets the player enter a second stand’s underground view (the stand has
  to be rebindable: `SoilMesh`, `ForestView`, `LivingView` and the camera all
  still hold one stand).
- Surface and underground geometry share state but do not yet have automated
  round-trip identity tests beyond the crown → root landing check in
  `tools/test-view.mjs`.
- A crossing is one camera rising through one scene rather than a blend of two
  rendered views. Under software WebGL a single frame can take over a second, so
  the dissolve is quantized to two or three steps even though the crossing still
  completes inside its 1.5s wall-clock budget.
- Only automatic framing is re-derived on a viewport change. Panning, zooming,
  tilting, or following a specific tree deliberately pins that view's camera,
  so a window that changes shape afterwards keeps the player's pose.
- The first rise after load can drop frames by more than a second: the surface
  stand's ground, grass, litter and shadows are compiled and uploaded the first
  time they become visible. Moving that cost to boot has not been measured.
- Surface weather is rain only; there is no general weather state machine.
- Wind has no explicit shared vector or strength and leaves do not settle.
- Surface performance has not been profiled; procedural tree geometry and one
  instanced foliage mesh per tree may become expensive on larger stands.
- The fast QA preset is a visual smoke path, not an adaptive production quality
  tier: it adds no LOD, instancing, foliage/weather tier, automatic selection or
  measured frame-time budget. Its half-resolution, no-bloom image is unsuitable
  for art acceptance or performance claims. The game has never enabled runtime
  shadow maps, so fast mode removes the baked tree-shadow decals and leaves
  `shadowMaps=false` rather than switching off an active shadow-map pass.
- The botanical pack's lower tiers now load and are selected per tree, but the
  dead variants are still files only: runtime browns a living model on death
  instead of selecting the bare/hollow one, and tints authored foliage in winter
  without shedding leaves. The manifest is consumed for tier files and still
  ignored for dead variants and crown anchors, and the new props are not placed
  yet. Authored animation clips are absent; whole-tree procedural sway still
  applies.
- Responsive and keyboard affordances exist but are incompletely exercised.
- `DESIGN.md` still needs a full token-level reconciliation after the forest
  visual direction is accepted.
- Browser QA screenshots live under ignored `design/shots/`; record commands and
  results here because those images are not durable repository evidence.

## Verification record

### 19 September 2026: projected-size LOD selection

Shipped the first runtime half of `ASSET-03`: the game reads the authored
manifest and gives each tree the tier its own size on screen deserves.

- `src/render/assets.ts` reads `forest-manifest.json` for each known asset's
  tier files, loads tier 0 eagerly, warms the remaining tiers in the background,
  and records a failed file once instead of re-fetching it. A tier request that
  is not loaded falls back to the nearest loaded tier, so a tree is never
  undressed.
- `src/render/lod.ts` is a dependency-free selection module: projected height is
  expressed as a fraction of the viewport, LOD0 is earned above `0.14` and LOD1
  above `0.045`, and each boundary carries a 15% hysteresis margin. Because the
  unit is a viewport fraction rather than a pixel count, the fast QA preset's
  half-resolution buffer cannot change which meshes load.
- `src/render/surface.ts` runs one projected-size pass per stand per frame. A
  tier swap copies the displayed model's position, rotation and scale onto the
  replacement before the old one is released, so refining a tree never moves it,
  re-seats it on the ground, or changes its simulation tree ID.

Verification on this tree:

- `npm run typecheck` — pass.
- `npm run test:assets` — pass: 21 assets, 39 GLBs, 1,266.7 KiB, with the
  manifest's tier files, budgets, bounds, anchors and materials checked through
  the same Three.js parser the game uses.
- `node tools/test-lod.mjs` — 9 checks pass: the perspective fraction, degenerate
  sizes and distances, band ordering with a stable middle interval, the game's
  own framing at ~555 (overview) and ~150 (focused crown) world units, both
  boundaries holding a tree steady on either side, no oscillation across a
  0.002-step sweep from every starting tier, monotone refinement through a
  continuous zoom without skipping a tier, a hard cut crossing both boundaries,
  and clamping of non-finite input.
- `npm run build` — pass: 752.49 kB production JS (199.48 kB gzip), the Vite
  chunk-size warning unchanged.
- `node tools/test-view.mjs --qa fast` — 69 checks pass, `PROBLEMS: none`. The
  new tier checks are: all 12 declared tier files loaded with 0 failures; 75 of
  75 trees dressed; the region overview drew 0 LOD0 / 57 LOD1 / 18 LOD2; focusing
  a crown through the sheet's own selector raised the fine tiers from 57 to 75
  with the same 75 trees dressed; the forest's closest framing (distance 105)
  drew 44 / 31 / 0; the 75 `stand:tree` identity keys survived every swap with
  the same asset; all 56 trees that changed tier kept their exact position,
  quaternion and scale (within 1e-9) and world position (within 1e-3); and the
  selected crown kept its identity and refined rather than jumping tiers.
- `node tools/test-view.mjs --smoke --qa fast` — 9 checks pass, 9 stands and 75
  trees present after the intake change.
- `npm test` — 10 checks pass; the simulation is untouched by this work and no
  number in it changed.

Not verified here, and recorded so the next agent does not assume it: the
full-quality browser regression was started at the normal preset and stopped
after fourteen minutes of SwiftShader rendering without finishing, so the tier
counts above are from the fast preset. Tier choice is a viewport fraction and
the calibration is pinned by `tools/test-lod.mjs`, but a normal-preset
`test:view` pass is still owed before the milestone. `ASSET-03` remains Partial:
instancing, authored wind clips, a general dropped-in-file validator, camera
transition tuning and the loader failure/late-load paths are still open, and the
`PERF-01` measurement that would turn these triangle counts into a frame-time
budget has not been taken.

### 19 September 2026: fast visual QA preset

Implemented `src/render/quality.ts` and the `?qa=fast` / `--qa fast` preset in
`tools/{shoot,test-view,test-journey}.mjs`. `tools/test-view.mjs --smoke` is the
compact load/selection/round-trip check; every browser tool now prints the
active preset, backend, CSS viewport, drawing buffer and rendering switches.

- `npm run build` — **pass**. `tsc --noEmit` and Vite produced 748.24 kB JS /
  15.78 kB CSS. Existing nonfatal Browserslist, Tailwind content and
  chunk-size warnings remain.
- `node tools/test-view.mjs --qa fast --smoke` — **pass: 9 checks**, no
  console or page errors. The SwiftShader report was
  `css=1200x760 buffer=600x380 pixelRatio=0.5 antialias=off shadows=off shadowMaps=off bloom=off postprocessing=off stands=9 trees=75`.
  The check asserts that fast mode has antialiasing, ground shadow decals,
  bloom, postprocessing and shadow maps off.
  Selecting through `#forest-tree` produced “Northern red oak · 1 · your stand
  -> Northern red oak · Living · Not yet bonded · your own stand”; descending
  reached the underground view at blend 0 and returning reached the forest at
  blend 1.
- `node tools/test-view.mjs --qa normal --smoke` — **pass: 8 checks**, no
  console or page errors. The same viewport and 9 stands / 75 trees reported
  `buffer=1200x760 pixelRatio=1 antialias=on shadows=decals shadowMaps=off bloom=on postprocessing=on`;
  the check asserts that normal keeps shipping antialiasing, ground shadow
  decals, bloom and postprocessing on while shadow maps remain off.
  selection and the forest/underground round trip behaved identically.
- `node tools/shoot.mjs --qa fast --url "http://127.0.0.1:4173/?seed=raven-wood" --size 960x640 --at 1500 --freeze --canvas-out design/shots/qa-fast-smoke.png`
  — **pass**. The fast drawing buffer was 480×320 in a 960×640 CSS viewport;
  the direct-render canvas capture was written and inspected (forest visible,
  no console or page errors). The capture is ignored and can be regenerated
  with the command.
- Not run in this changeset: the full `npm run test:view`,
  `npm run test:journey`, `npm test`, `node tools/test-region.mjs`, asset QA and
  Blender. The smoke path does not replace those checks. Fast mode was not
  compared with normal as a controlled frame-time benchmark; the numbers above
  are a rendering-setting check, not a performance claim. The outcome restart
  that preserves `qa=fast` is a code-only change and was not exercised here.

### 19 September 2026: botanical asset pack

- Subsequent notes-only update: recorded the proposed LOD/instancing sequence
  and faster testing strategy above. No runtime or asset changes; verification
  is limited to `git diff --check`, with no expensive suites repeated.
- Blender 4.2.1 LTS: `& 'C:/Program Files/Blender Foundation/Blender 4.2/blender.exe' --background --factory-startup --python-exit-code 1 --python tools/make-forest-assets.py -- --render`
  builds 21 assets / 39 separate GLBs, with no downloaded content, textures or
  add-ons. Original living trees, stump, log and mushroom replace the six paths
  already used by the game. Additional files remain integration inputs.
- Re-imported the exported GLBs into Blender and visually inspected all three
  rendered sheets: `design/shots/forest-assets-{trees,props,lods}.png` (ignored,
  regenerated by the command above). Living/dead silhouettes, hollow openings,
  foliage undersides and prop shapes are visible. Lower tiers keep simplified
  trunks and larger foliage blades; LOD2 is intentionally coarse and needs
  distance tuning when runtime switching is implemented. Art acceptance and
  animated LOD transitions remain unverified.
- `npm run test:assets` — **pass** for all 39 exported GLBs (1,266.7 KiB total).
  Uses the installed Three.js GLTFLoader, checking complete embedded GLB data,
  one authored mesh with at most three material primitives, triangle/byte
  counts, finite attributes, index ranges, metre-scale Y-up bounds, ground
  contact, equal LOD heights/anchors, double-sided foliage, and no foliage on
  dead variants. Trees/saplings meet 2,000/900/320 triangle ceilings; all other
  props meet 500. This is shipped-pack QA, not a general glTF conformance test
  or loader failure-path test.
- Independent Blender rebuild with `--output` pointing at a new temporary
  directory — **pass**: SHA-256 matches for all 39 GLBs and the manifest.
- `npm run build` — **pass**, TypeScript and Vite, 746.18 kB JS / 15.78 kB CSS.
  Existing nonfatal Browserslist, Tailwind content and chunk-size warnings remain.
- In-game capture — **pass**, opening nine-stand forest and keyboard zoom, no
  page/console errors. `node tools/shoot.mjs --url 'http://127.0.0.1:4173/?seed=raven-wood' --size 960x640 --canvas-out design/shots/forest-assets-game.png --at 1500 --freeze`;
  the same command with seven `--key '='` options writes
  `forest-assets-detail.png`. Inspected both captures: distinct broadleaf and
  hemlock crowns render in the game's lighting. Existing terrain/slab seams
  remain outside this art change. The in-app browser connection failed before
  navigation (missing sandbox metadata); these captures use the existing
  repository harness.
- Full simulation/journey suites are not repeated for this asset-only change;
  no simulation or runtime TypeScript was modified.
- `npm run test:view` — **interrupted, no result**. The full software-WebGL
  suite was still running without its final summary when the user requested a
  usage-saving stopping point. It was stopped deliberately; do not treat the
  earlier 60-check pass as evidence for this art tree. The separate opening and
  zoom captures above completed cleanly. Re-run this suite on resume.

### 18 September 2026: region trees and authored surface art

Current tree: every stand draws its own trees, and authored glTF models load
through `src/render/assets.ts` with the procedural stand as the fallback.

- `npm run build` - **pass**. TypeScript and Vite complete in 0.67s; production
  JS 746.18 kB (197.41 kB gzipped), CSS 15.78 kB. Nonfatal warnings: stale
  Browserslist data, the external Tailwind content warning, and the chunk above
  500 kB. The glTF loader accounts for roughly 80 kB of the growth.
- `npm test` - **pass: 10 checks** in `tools/test-sim.mjs`: conservation, cut
  supply, disconnection, supplied fruiting, three two-bloom victories, guards,
  and identical-order determinism (`ironwood` 2 blooms, 480 spores, 354s
  simulated, 190 living strands).
- `node tools/test-region.mjs` - **pass: 12 checks**: border agreement in height
  and flow, three seeds of terrain and communities, wind and storms, community
  species mix, validation, one adjacent daughter colony per bloom with exactly
  the fund the parent paid, growth while unwatched, and two matches from one
  seed colonizing identically.
- `npm run test:view` - **pass: 60 checks** against a fresh `dist/`, software
  WebGL. A rise at 30fps takes 1.53s over 46 frames and a rise at 4fps 1.50s
  over 6 frames; following a crown lands 0.00 world units from its own root; the
  specimen and all 8 crowns stay framed at 1600x1000, 1366x768 and 390x844
  (worst corner 0.84, 0.84 and 0.76 of the half-viewport, default distances 313,
  313 and 940); a live crossing spent 0.00-2.82s of its budget in a single
  hitched frame; input separation, refused orders, drag-versus-tap, mid-crossing
  clicks, focus guards, keyboard orders and a burst of view changes all hold. The
  wheel gesture reaches the soil after 13 notches now that the overview frames
  the whole region, recorded as a UX note below.
- Capture evidence (ignored paths, regenerate with `tools/shoot.mjs`): with the
  dev server at `http://127.0.0.1:5174`, a canvas capture at 1280x800 reports all
  9 stands dressed (9, 8, 8, 8, 10, 7, 9, 7, 9 trees carrying a model), three
  seeded floor props per stand, and a clean console.
- `npm run test:journey` - **fail on this machine, for a renderer-speed reason
  rather than a gameplay one**. The check drives a whole match through the
  interface at 4x speed with a 20-minute wall-clock budget. Under software WebGL
  a frame takes one to three seconds and the frame loop clamps its step at 0.1s,
  so 4x speed advances only about 0.2x real time: the budget expired at 227s of
  match time with one bloom standing, where the headless journey in `npm test`
  finishes two blooms and 480 spores at 354s. The two-bloom economy is still
  verified headlessly, but the *interface* journey has not been re-verified
  against the region renderer. Making it runnable again wants a cheaper render
  path for the harness - a quality tier or a smaller canvas for this check -
  rather than a longer deadline.

### Earlier on 18 September 2026: the wall-clock crossing tree

Verified on the working tree that contained the wall-clock crossing:

- `npm run build` — **pass**. TypeScript and Vite production build complete in
  0.43s; production JS 667.28 kB (173.32 kB gzipped). Nonfatal warnings: stale
  Browserslist data, an apparently external/unused Tailwind content warning, and
  a production chunk above 500 kB.
- `npm test` — **pass: 10 checks**. Conservation, cut supply, disconnection,
  supplied fruiting, three two-bloom victories, guards, and identical-order
  determinism. These are the same journey numbers as before the regional work
  (`raven-wood` 354s, `old-growth` 652s, `ironwood` 354s), which is the evidence
  that generating a stand from default site conditions reproduces the old
  single-stand world exactly.
- `node tools/test-region.mjs` — **pass: 12 checks**, seconds on a laptop:
  - All twelve internal borders of the 3×3 region agree exactly in height and in
    flow, and the ground is continuous across them.
  - Three seeds each generate coherent terrain, water and communities: 9
    habitable stands, 3-6 stream borders, 3-4 distinct communities, and a
    founding stand chosen for habitable ground near water.
  - The same seed builds the same region; stand lookup resolves every centre.
  - Wind reaches the adjacent stands it blows toward in ordinary weather, and a
    storm reaches further (29 stormy samples in fifteen minutes of weather, and
    the direction never turns more than 0.05 radians in five seconds).
  - Community decides the species mix; the mixed slope keeps the prototype's
    original 45/35/20.
  - Validation refuses a region whose stands cannot be reached from the founding
    stand.
  - A bloom founds exactly one adjacent stand, and the daughter's reserves are
    exactly the fund its parent paid — no carbon, water or mineral appears.
  - With every neighbour already colonized, a storm carries a spore past them.
  - A colony with nothing to give sends nobody, and is never driven into debt.
  - A colony grows while nobody is looking, and its stand can be entered later.
  - Two minutes of match are byte-identical whether or not the player moves
    between stands, and two matches from one seed colonize the same stands with
    the same spores.
- `npm run test:view` — **pass: 60 checks**, measured on a built preview with
  software WebGL:
  - A rise at 30fps and a rise at 4fps both take 1.50-1.53s of wall clock
    (46 frames of 33ms and 6 frames of 250ms). This is the property the old
    smoothing could not hold: below 10fps the render step was clamped, so the
    crossing stretched.
  - The dissolve is continuous in both directions: 0 frames where the strands
    moved while the picture held still, and the largest opacity step at 30fps is
    0.082 (a threshold would be a step of 1.0).
  - Crossing endpoints are exact: the network is at opacity 1 underground and
    opacity 0 above the floor, whatever frame the crossing landed on.
  - A reversal at blend 0.52 comes back in 23 frames of the 23 expected, a rapid
    double reversal (0.1s and 0.4s in) still lands in the forest, and neither
    jumps the picture.
  - Following a crown descends to that tree's own root (0.00 world units from a
    tip) and rising returns to the forest above it.
  - A live crossing under the software renderer spent 1.32s of its 1.50s budget
    in 2 frames with a worst measured frame of 875ms (runs on this machine have
    shown 0.43-1.32s spent in one or two frames, with worst frames of 428-875ms):
    the wall clock is charged, so a hitch cannot stretch the crossing, only
    coarsen it.
  - Framing at 1600×1000, 1366×768, and 390×844: the specimen's corners stay
    within 0.76-0.84 of the half-viewport and all 8 crowns stay inside the
    frame. The default framing distance is re-derived per aspect (313, 313 and
    940 world units), and the canvas, view controls, and all 13 catalogue
    figures stay on screen at every size.
  - Reduced motion reaches the forest in the frame it was asked for, with no
    crossing reported and the soil's contents left out.
  - Input separation, all through real mouse and keyboard events: a drag pans
    the camera without ordering while a tap on soil orders ("Frontier directed
    to ..."), a refused order on bare paper says the stone cannot be
    crossed and changes nothing, a cancelled pointer issues nothing and the
    canvas still pans afterwards, a click during a crossing issues nothing, one
    wheel notch does not cross while six do, a key typed into the tree selector
    does not reach the sheet, the canvas answers `V`, `1-4`, the arrows and
    Space, and a burst of five view changes lands in the view asked for last
    with input still live.
- `npm run test:journey` — **pass: 13 checks**. A whole match played with clicks
  on the printed controls on `raven-wood`: Awaken the spore, `↗ Reach · oak`,
  `◇ Bond · oak`, a click on the soil 8cm below the surface to send the frontier
  up, Rest & gather, the Fruit order, a `◇ Fruit here` strand twice, the outcome
  ("Fruiting recorded", packet 480), and "Open a new sheet". Two blooms and 480
  spores at 354s of match time; no assignment to simulation state anywhere in
  the check. Under software WebGL at 1200×760 the match takes about eleven
  minutes of wall clock at 4× pace.
- Built-preview captures, no page or console errors:
  `node tools/shoot.mjs --url http://127.0.0.1:4173/?seed=raven-wood --out design/shots/review-forest.png --canvas-out design/shots/review-forest-canvas.png --at 4000 --freeze`,
  the same with `&view=underground`, and the same at `--size 390x844`. The
  portrait capture shows the whole stand inside the sheet instead of cropped at
  both ends.
- Impeccable mechanical detector — not re-run in this changeset; the last
  advisory findings stand (new surface colors and several UI sizes are not yet
  recorded in `DESIGN.md`).

Useful commands:

```powershell
npm run build
npm test
node tools/test-region.mjs
npm run test:view
npm run test:journey
npm run preview -- --host 127.0.0.1
node tools/shoot.mjs --url http://127.0.0.1:4173 --out design/shots/review.png --canvas-out design/shots/review-canvas.png --at 1500 --freeze
node tools/shoot.mjs --url "http://127.0.0.1:4173/?view=underground" --out design/shots/underground.png --at 1500 --freeze
```

`npm run test:view` and `npm run test:journey` start and stop their own preview
servers (ports 4173 and 4174); pass `--url` to point them at a server you
started yourself, `--port` to move one, and `--verbose` to print every
measurement. `test:view` drives the frame loop with a synthetic clock, so its
timing numbers are not hostage to the machine. `test:journey` takes `--seed`
and `--sim-budget`; it plays a real match, so it takes minutes.

Do not assume ports from this record remain free. Use a built preview for stable
captures; Vite hot reload can interrupt dev-server screenshot sessions.

## Definition of done for the current milestone

The connected single-player vertical slice is complete when:

1. A player can explore the forest, select a tree, follow it to the correct
   roots, complete a two-bloom journey through the UI, and return to the same
   tree without state or input errors.
2. View transitions are reversible, visually continuous, reduced-motion safe,
   resize safe, and reliable at supported frame rates and viewport sizes.
3. Multiple deterministic seeds continue to pass victory, loss, disconnection,
   invalid-command, conservation, and seasonal-fruiting checks.
4. Forest wind, weather, seasons, tree health, and fruiting outcomes are
   visibly coherent with the underground simulation.
5. Opening and mature matches meet recorded performance budgets on stated
   hardware, with scalable visual quality where needed.
6. Mouse, keyboard, pause/speed, sound, notes, reduced motion, restart, and
   supported viewport layouts have been exercised in a browser.
7. `README.md`, `PRODUCT.md`, `DESIGN.md`, and this file describe the delivered
   behavior accurately.
8. Standard mode presents at least one readable rival-pressure problem and one
   `Armillaria` infection that the player can detect and counter; Chill mode
   completes the cultivation loop without aggressive infection.
9. Oak, yellow birch, and eastern hemlock have visibly and mechanically distinct
   root graphs shaped by both species and their actual soil conditions.
10. A seeded regional map contains multiple continuous stands with different
    terrain, forest composition, age structure, and water conditions; at least
    one stream or connected water system crosses stand boundaries coherently.
11. Players can survey the region, select multiple stands, descend into each
    persistent underground context, and maintain a conserved fungal connection
    across stand boundaries.
12. Generated seeds pass viability checks and reproduce the same terrain,
    hydrology, stands, threats, and outcomes under identical orders.

## Required update procedure for every future agent

Every implementation task must finish with a `PROJECT_STATUS.md` update in the
same changeset. Before ending work:

1. Read this file and identify the feature IDs affected.
2. Update each affected status and its evidence or remaining gap. Never erase a
   gap merely because adjacent work landed.
3. Update Current priorities if ordering or scope changed.
4. Add or revise Known limitations when a shortcut, approximation, regression,
   or performance risk is introduced or resolved.
5. Run verification appropriate to the change and append the result below with
   the date, exact command or browser scenario, and outcome. Never carry a stale
   “current” test claim forward.
6. Update Architecture when files or responsibilities move.
7. Update README for user-visible controls or setup changes; update PRODUCT.md
   for product truth; update DESIGN.md for durable visual rules or tokens.
8. Keep deferred work explicitly deferred. Do not silently expand scope.
9. Do not create a second plan, handoff, implementation status, TODO ledger, or
   roadmap. Fold durable information into this file and rely on git history for
   superseded narrative.

When handing work to another agent, point them to this file and the affected
feature IDs. A valid handoff is a current feature row, remaining gap, and
verification entry—not a new document.

## Change log

### 19 September 2026

- Implemented projected-size LOD selection (`ASSET-03`): `forest-manifest.json`
  now drives the tier registry, `src/render/lod.ts` chooses a tier from a tree's
  projected fraction of the viewport with 15% hysteresis, and a swap preserves
  the placed model's transform and simulation identity. Added `npm run test:lod`
  and nine browser tier checks, and recorded the preset caveat beside them.
- Added the opt-in `?qa=fast` rendering preset and `--qa fast` support to
  `shoot`, `test-view` and `test-journey`; browser output now names the preset,
  backend and drawing-buffer size. Added `tools/test-view.mjs --smoke` for a
  compact fast load/selection/round-trip check and recorded the normal-quality
  comparison. `PERF-02` is now Partial, with production LOD/instancing and
  measured budgets still open.
- Replaced the six placeholder GLBs with original botanical low-poly art and
  delivered the rest of the requested pack: tree/dead/sapling LODs, understory,
  deadwood, reproductive bodies and rocks (`ASSET-02`, asset side of `ASSET-03`).
- Added the reproducible Blender authoring source, machine-readable manifest
  and `npm run test:assets`. Lower tiers use deliberately simpler branches and
  broader foliage blades; they do not decimate away the crown.
- Specified procedural seasonal tint and procedural underground structure in
  `DESIGN.md`; documented separate tier files and remaining runtime integrations.

### 18 September 2026

- Fixed the region's trees (P1 item 3). The frame loop stepped only the colony's
  own surface, so every other stand's ground was drawn while its trees stayed at
  their unbuilt transform under the slab. Every surface in the region is now
  stepped each frame: all nine stands, 75 trees, are placed, scaled,
  season-coloured and health-tinted, and a neighbour's crown can be selected
  and named through the real selector.
- Added the authored-model intake pipeline (`ASSET-01`, `ASSET-02`).
  `src/render/assets.ts` loads the models named in `ASSETS`, scales each
  instance to the simulation's own tree height, corrects it onto the ground,
  clones materials per instance and splits foliage from wood by material name
  so season and health can tint them. A missing file is a recorded warning and
  the procedural stand keeps drawing, so art can arrive one model at a time;
  `SurfaceForest.adoptAssets()` dresses a stand that was built before the art
  finished loading. `tools/make-placeholder-assets.py` builds six Blender
  placeholders (oak, birch, hemlock, stump, log, fruiting body) into
  `public/assets/`, and every stand lays out three seeded props.
- Made `npm run test:view` survive a software renderer drawing the whole
  region: the crown round trip reads the region's `stand:tree` selector values,
  the framing and action budgets are sized for second-long frames, and the live
  crossing check samples in the click's own task instead of racing a frame that
  can outlast the crossing it is trying to watch.
- Recorded the hybrid art direction. `PRODUCT.md` no longer claims the whole
  game is asset-free, and `DESIGN.md` now states the asset contract: glTF
  binary, metres, Y-up, origin at ground contact, foliage material names and an
  optional `anchor_crown`.

- Began rendering the region (P1 item 3). `SurfaceForest` takes a tile — a stand
  id, its origin in the region and the region's own `heightAt` — so every stand's
  floor is a window onto one continuous surface, and `Game` builds one surface
  per stand, laid out around the colony's stand and framed as a region rather
  than as a single stand. Crowns carry their stand id, the tree selector lists
  the whole region with the player's own stand first, and only the colony's
  ground can be entered: selecting a crown in another stand explains that no
  colony is there yet.
- Known and recorded above: the neighbouring stands' trees are not visible, the
  nearest row's floor is missing below the slab, and entering a second stand
  needs the underground views to be rebindable. The browser suites have not been
  re-run.
- Began P1. `src/sim/region.ts` generates a deterministic 3×3 region: a
  heightfield with a fall line and a valley, drainage from a priority flood,
  flow accumulation, a stream whose course crosses stand borders, a water table
  that follows relief and flow, seven stand communities, orthogonal adjacency,
  wind with storms, a founding stand chosen for habitable ground, and
  validation that refuses a region whose stands cannot be reached.
- `src/sim/world.ts` grew `createStandWorld`: a stand's soil takes its water
  table and species mix from its site, and `createWorld` is that same function
  with the prototype's defaults, so the single-stand world is unchanged.
- `src/sim/match.ts` adds `RegionalMatch`: every stand in a region, stepped in
  stand order, with uncolonized ground simulated not at all and every colonized
  stand kept alive while nobody is looking. A bloom releases spores that ride
  the wind — adjacent stands by default, further only in a storm — and a landed
  spore founds a daughter colony holding exactly the carbon, water and mineral
  its parent paid.
- Added `tools/test-region.mjs`: twelve checks over terrain coherence,
  hydrology, communities, wind, validation, colonization, conservation, stand
  persistence, camera independence and seed determinism.
- Recorded honestly that the region is not yet rendered, navigable or drawn:
  P1 item 3's visible half is the next work.
- Closed P0 items 4 and 5. `tools/test-view.mjs` grew eighteen input checks
  (drag versus tap, refused orders, pointer cancel, mid-crossing clicks, the
  wheel-descent threshold, control focus, keyboard orders and pause, a burst of
  view changes), and `tools/test-journey.mjs` plays a whole two-bloom match
  through the sheet's own controls. `tools/preview.mjs` holds the preview server
  that both browser tools start for themselves.
- Verified VIEW-05 (safe input separation), CORE-07 (first-player journey
  through the actual UI), and UX-01 (guided opening and journey model).
- Stabilized the forest ↔ underground crossing, closing P0 items 1-3. Replaced
  the underground visibility threshold with `src/render/fade.ts`, which
  dissolves the networks, motes, roots and rewards from their own captured
  opacities, writes exact endpoints, and leaves a hidden overlay set out of the
  frame entirely.
- Timed the crossing against the wall clock in `src/render/camera.ts`
  (`CROSSING_SECONDS`, ease in and out, a reversal duration proportional to the
  blend left, a legibility floor, and a maximum wall step per frame). The frame
  loop now passes the real elapsed time separately from the clamped simulation
  step.
- Re-derived the active view's framing on a viewport change, discarded
  remembered poses that were never the player's own, and fixed the forest
  framing so it fits the whole stand at a portrait aspect instead of cropping
  its ends.
- Added `tools/test-view.mjs` (40 browser checks) and the shared
  `tools/browser.mjs`, which `tools/shoot.mjs` now uses.
- Consolidated the former feature plan and implementation handoff into this
  authoritative log and removed both superseded documents.
- Recorded the implemented 3D surface forest, connected camera/view controls,
  wind, drifting leaves, rain, and seasonal presentation at their actual levels
  of completion.
- Replaced obsolete failing-test claims with the current 10-check passing run.
- Recorded the remaining transition, resize, browser-journey, weather, seasonal,
  accessibility, documentation, and performance work.
- Defined ecological opposition around honey fungus, root-tip competitors,
  saprotrophs, and later mycoparasites; added Standard and Chill mode plans.
- Added species- and site-driven root architecture requirements for northern red
  oak, yellow birch, and eastern hemlock, including root-graph gameplay rules and
  scenario concepts.
- Added the planned regional map: a deterministic multi-stand forest mosaic with
  continuous terrain, hydrology, varied communities, persistent underground
  transects, cross-stand networks, regional colonization, streaming, and seed
  validation.
`node tools/test-region.mjs` is headless and takes seconds; `REGION_SEEDS`
chooses the seeds it validates and `--verbose` prints every stand of every
region, which is how its thresholds were tuned.
