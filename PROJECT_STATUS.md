# Mycelia — authoritative project status and feature log

Last updated: 20 September 2026.

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
wall-clock crossing, the overlay fade, the viewport re-framing, the flowing
water, the test bench and the spatial stages recorded below have since been
committed together; none of it has been deployed.

The regional world model is being built underneath the running game: the region,
the stand generator's site conditions and the regional match are in the tree,
and the surface now draws all nine stands as one continuous forest with each
stand's own trees standing on its own ground. The game now steps RegionalMatch and lets players select and enter any
colonized stand. Local soil, roots, networks, rewards and UI are rebound on entry;
every colony continues running while another stand is viewed. The established
founding world is retained; other stands use regional site conditions.

The spatial migration has begun underneath that: the simulation now owns
regional XYZ coordinates and one shared soil volume (`MAP-14` stages 1-2), and
`?lab=crossing` grows a single colony across a real stand boundary through it
(`MAP-07` stages 3-4, headless). The running match and the renderer are still on
the flat transect; promoting the fixture's coordinator into `RegionalMatch` and
then adding sections and the forest reveal are the next gates.

The forest itself is being filled in (`ASSET-04`): a pure region-wide layout
places background canopy, regeneration and ground cover by community, and the
canopy and regeneration layers are drawn as per-tier instance batches, so the
region reads as woodland with clearings rather than a sparse set of playable
trees. The scenery is presentation only - separate keys, no simulation
identity, no picking - and the understory layers, the ground material and the
density tuning are the next steps in that lane.

The forest carries a regional survey layer (`MAP-11`): `S`, or **Survey the
region**, opens a printed ledger of the nine stands with their community, water,
colony state, broad forest health, founding parent and lineage continuity. It is
a record rather than a map, and it prints unsurveyed ground as unsurveyed.

The region's stream is visible in both views, with slow shader currents,
rounded surface bends, wet banks and instanced brook stones. Below ground the
channel and water table fade through an eight-centimetre capillary fringe.
Hyphae can reach that fringe but cannot extend below the live water table.
The stream bed remains soil, reachable only when groundwater recedes below it.
This supersedes the earlier unconditional under-bed crossing behavior.

An explicit `?lab=water` test bench opens a crossed stand immediately; forest,
region, grown-network and headless-crossing fixtures, a water-depth slider and
fixed-step advance make visual iteration independent of a whole played match.
`test:feature` selects existing feature suites and rebuilds before browser
checks.

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
- Every logical stand square is **one above-ground tile with persistent
  underground state**, and the mycelium must be able to grow across a shared
  boundary into the neighbouring tile's soil. Crossing a stand edge with hyphae,
  cords, water or roots is ordinary growth through a boundary portal, not only a
  spore that founds a separate colony. The region is one contiguous forest over
  one contiguous soil: tile boundaries organise simulation, streaming and
  ownership, and must never fence the network in. `MAP-07`, `MAP-08`, `MAP-11`
  and the local underground model below are all written to this intent, and no
  interface may present the stands as isolated boxes.
- 20 September spatial-view direction: underground sections are selectable
  windows into one spatial network, and the forest can reveal that same
  network from above. Both views must use simulation-owned horizontal position
  and depth; presentation-only offsets cannot stand in for the third axis.
  Browsing underground must preserve the forest location from which the player
  descended. The staged implementation specification below supersedes the
  earlier recommendation to stop at independent 2D transects.
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
| Shared spatial coordinates | `src/sim/spatial.ts` | Regional `x`/`y`, absolute `z` and derived depth; half-open stand ownership; stable node/tree/root-tip references; supercover segment traversal; the invertible Three.js adapter; simulation-owned tree placement (`MAP-14` stage 1) |
| Regional soil volume | `src/sim/soil-volume.ts` | One analytic material field over global coordinates plus a sparse map of changed voxels, a continuous regional groundwater elevation and a distance-to-course stream query (`MAP-14` stage 2) |
| Crossing fixture | `src/sim/crossing.ts` | One colony graph spanning two adjacent stands on a fixed section plane, stepped by the shared economy over the shared soil volume (`MAP-07` stages 3-4) |
| Background placement | `src/render/forest-dressing-layout.ts` | Pure, seedable region-wide placement of non-interactive canopy, regeneration and ground cover: ownership by half-open bounds, clusters and gaps, crown-size spacing, community composition and exclusion masks (`ASSET-04`, `MAP-05`) |
| Background drawing | `src/render/forest-dressing.ts` | Normalised, merged per-asset geometry drawn as `(tier, asset, category)` instance batches, with per-decoration projected-size LOD, shader wind, season tint and no per-frame matrix writes (`ASSET-04`) |
| Integration | `src/game.ts`, `src/main.ts` | Regional fixed-step loop, stand switching, local view rebinding, input, UI/audio synchronization |
| Connected camera | `src/render/camera.ts` | Forest and underground camera goals, remembered player framing, wall-clock view crossings, viewport re-framing, reduced motion; explicit pose capture/restore for the forest context and per-section poses |
| Sections | `src/render/sections.ts`, `src/render/section-view.ts` | Pure `SectionSpec` slabs, clipping with continuation marks, section families and following; the drawn section, its nodes, marks and framed window (`VIEW-06`) |
| Network reveal | `src/render/network-reveal.ts` | Terrain projection of the colony's real XYZ edges with depth-weighted line weight, a slice marker, and screen-space picking with a stacked-strand report (`VIEW-07`) |
| Overlay fade | `src/render/fade.ts` | Dissolves the networks, motes, roots and rewards through a view crossing |
| Surface forest | `src/render/surface.ts` | Seeded 3D tree placement, forest floor, tree picking, wind, leaves, rain, seasonal presentation |
| Water | `src/render/water.ts` | The region's stream as a ribbon on the forest floor, and the active stand's channel and water table below ground |
| Authored models | `src/render/assets.ts`, `src/render/lod.ts`, `public/assets/forest-manifest.json`, `tools/{make-forest-assets.py,check-forest-assets.mjs}` | Manifest-driven glTF intake, per-asset tiers and fallback; projected-size LOD selection with hysteresis; reproducible Blender art and exported-pack QA |
| Tree batches | `src/render/tree-batches.ts` | Region-wide authored wood/foliage instances with stable stand:tree identity, per-instance transforms and colours |
| Local disposal | `src/render/dispose.ts` | Release wholly owned soil/root/reward GPU resources on stand changes |
| Underground world | `src/render/{soil,forest,hyphae,living}.ts` | Soil, roots, networks, flow motes, mushrooms, spores, interaction feedback |
| Shared stage | `src/render/{stage,quality,textures}.ts` | WebGL renderer, lights, fog, paper/specimen transition, bloom, opt-in fast QA preset |
| Audio | `src/audio/soundscape.ts` | Ambient synthesis, bond/fruit/action cues |
| Interface | `index.html`, `src/styles.css`, `src/ui/{sheet,journey}.ts` | Botanical field interface, resources, orders, guidance, view and tree controls |
| Validation | `tools/test-sim.mjs`, `tools/test-region.mjs`, `tools/test-spatial.mjs`, `tools/test-crossing.mjs`, `tools/test-dressing.mjs`, `tools/test-dressing-view.mjs`, `tools/test-sections.mjs`, `tools/test-reveal.mjs`, `tools/test-sections-view.mjs`, `tools/test-lod.mjs`, `tools/test-view.mjs`, `tools/test-journey.mjs`, `tools/shoot.mjs`, `tools/{browser,preview}.mjs` | Headless regressions for one stand, for a region, for the shared coordinates and soil volume, for the two-stand crossing, for background placement and for section clipping and projection, bounded renderer checks for the dressing and for sections and the reveal, LOD bands and hysteresis, browser checks for the connected views, tiers and input, a whole match played through the interface, and screenshot/error capture |

The ordinary match's soil is still a two-dimensional transect. Each simulated
tree has one horizontal `gx` coordinate and stable root IDs.
`treeSurfacePosition()` in `src/render/surface.ts` gives the same tree a seeded
presentation-only depth on the forest floor - a formula the simulation now also
owns as `treeLocalOffset()` in `src/sim/spatial.ts`, which is where the surface
renderer should read it from next. Descending maps the selected crown back to
that tree's real root target. Do not imply that arbitrary surface depth is
simulated terrain.

The spatial path (`MAP-14` stages 1-2) has real coordinates and a shared soil
volume, and the crossing fixture (`MAP-07` stages 3-4) grows one colony across a
real stand boundary through it. That is a two-stand fixture on one section
plane, not the ordinary match: `RegionalMatch` still steps one local
`Simulation` per colonized stand, and the renderer still draws the flat
transect. Promoting the fixture's coordinator and world view into the running
game is the next gate, and it must not be described as done before it is.

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
| VIEW-06 | Partial | Browse persistent underground sections | Landed on the `?lab=crossing` fixture, and now a control the player uses rather than a bench readout. `src/render/sections.ts` is a pure `SectionSpec` model: vertical slabs of finite thickness (4 units, stepping 4 so they tile a stand) in canonical region coordinates, with slab clipping that draws a strand passing through with both ends outside it and reports where it enters and leaves, previous/next within a family, a flip to the other family, stable ids, and section labels. `src/render/section-view.ts` draws the clipped strands, their nodes, the continuation marks and the framed window. The sheet carries its own **Section** panel below ground - **Previous**, **Next**, **Flip**, **Follow**, **Return to forest**, **Surface here** - with `[`, `]`, `X`, `G` and `Escape` as the keyboard path, and a readout naming the stand, community, orientation, position in the family and strand count, saying plainly when a section holds no network rather than inventing strands. Browsing is limited to stands the colony has reached plus their neighbours, the selection follows the open section so Follow always has a visible strand, and `ForestReturnContext` is captured on descent in absolute regional coordinates (pose, selection, reveal state) and restored on return, with each section's pose remembered by `standId + sectionId`. The fixture's strands now drift a little across their growth plane as they arrive, so the body has thickness: neighbouring sections hold different parts of the colony instead of one plane and a band of empty slabs. Remaining: the compare-two-sections mode, section browsing wired into the ordinary match, and a fixture whose body is thicker than the current ~16 units across the plane. |
| VIEW-07 | Partial | Forest network reveal | Landed on the `?lab=crossing` fixture. `src/render/network-reveal.ts` projects the colony's real XYZ edges onto the region's own terrain with a fixed rendering offset, keeps each sample's real depth, weights line colour by depth and connectedness, draws a severed remnant as a double line so it reads without relying on hue, and adds a slice marker showing where the last inspected section cuts the ground. One `LineSegments` buffer for the whole region; distance lowers the samples per edge and never the simulation's node list. Picking is a screen-space search over the projection with a stacked-strand report and explicit depth, never a raycast against whichever line mesh is in front. The **Network** control is a real, keyboard-accessible button in the forest panel with pressed state, and it appears only when a spatial colony exists, so an ordinary match has no dead control. Clicking a projected strand opens the exact section through it. Remaining: transparent-ground true-depth mode (the plan's later switch), bounds on display LOD selection beyond the sample count, and the reveal wired to the ordinary match. |
| VIEW-08 | Planned | Natural forest-floor materials and ground contact | Replace diagonal floor bands and uniform scatter with regional material patches, restrained surface detail, grounded props and canopy/contact shading. Preserve authoritative terrain, stream alignment and cutaway behavior. |

### Authored surface art

| ID | Status | Feature | Evidence and remaining work |
|---|---|---|---|
| ASSET-01 | Partial | Authored model intake | The existing registry loads six replacement botanical models; scaling, ground correction, seasonal/health material tint and procedural fallback are unchanged. Tree and sapling GLBs now contain `anchor_crown`; the loader still ignores it. Manifest LOD and regional wood/foliage batching are implemented. Remaining: browser missing-file/late-load checks, anchor consumption and dead-variant switching. Current art verification is recorded under 19 September below; the 18 September browser results describe the previous art. |
| ASSET-02 | Partial | Botanical asset pack | `tools/make-forest-assets.py` builds 21 original low-poly assets / 39 GLBs: three living species and their dead/hollow variants, three saplings, fern, grass, stump, log, snag, root plate, four reproductive bodies and two rock props. The six original paths replace placeholders immediately, and the runtime registry now also exposes the three saplings, fern, grass, boulder and snag so the dressing can ask for them and warm their tiers. `forest-manifest.json` LOD tiers are consumed for every id the registry knows. Remaining: art-direction acceptance, fruiting-body integration into LivingView/surface outcomes, drawing the placed understory and deadwood layers, and runtime dead variants. This is a stylized botanical first pass, not photoreal scanned art. |
| ASSET-03 | Partial | Asset contract, LOD and validation | Manifest-driven projected-size LOD with 15% hysteresis is retained. Region-wide TreeBatches groups authored parts by asset, tier, geometry and material; instance matrices retain placement, growth and wind, and instance colours retain health and season. Stable stand:tree mappings survive slot/tier changes; crown proxies remain selectable. Focused batch tests cover transforms, colours, buffer growth, tier migration and re-entry. `AssetLibrary.batchParts()` now exposes an asset's shared parts and its authored height and ground offset, so the dressing can normalise and merge them once instead of cloning an object per tree; `nearestLoaded` takes a coarse-first fallback for scenery. Remaining: authored wind clips, dropped-in-file validation, loader failure/late-load QA, crown anchors, dead variants and distance-transition tuning. |
| ASSET-04 | Partial | Dense non-interactive forest dressing | `src/render/forest-dressing-layout.ts` places the region's background vegetation from one pure, seedable layout over regional coordinates: half-open stand ownership so a tree on a shared edge is emitted once, clusters and gaps from low-frequency density fields, crown-size spacing, community composition for seven communities, and exclusion masks for the open channel, its banks and the playable crowns. `src/render/forest-dressing.ts` draws it as `(tier, asset, category)` instance batches over normalised, merged per-asset geometry, with per-decoration projected-size LOD, a shader wind term, season tint on instance colours, and no per-frame matrix writes. Decorations have their own `dressing:stand:index` keys, no simulation identity, and are absent from every pick target list. The fixture bench isolates one community and switches bands on, off, medium and dense. Remaining: only the canopy and regeneration layers are drawn - ferns, grass, rocks and deadwood are placed but not yet rendered; the uniform grass and litter scatter has not been redistributed onto those masks; the default medium band and the background LOD thresholds are first-pass numbers, not hardware-tuned; and no art-direction acceptance has been done. |

### Regional map, terrain, forest stands, and water

| ID | Status | Feature | Evidence and remaining work |
|---|---|---|---|
| MAP-01 | Partial | Multi-stand regional map | All nine stands render continuously and colonized stands can be entered through Survey a stand or a selected crown. Game steps RegionalMatch; the original founding world is retained for opening compatibility. Remaining: shipping region size and complete terrain/soil boundary integration. |
| MAP-02 | Partial | Continuous regional surface | Shared terrain and all nine stands render continuously. The drainage ribbon now has rounded bends, soft banks, slow shader currents and instanced brook stones; it folds and rebases with the landscape. Focused water browser checks exercise actual shader output at fast and normal quality. Remaining: ponds, broader exposed rock placement, and near-camera floor/slab defects. |
| MAP-03 | Partial | Terrain-first generation | Elevation, a regional fall line, a valley, drainage from a priority flood, flow accumulation and aspect are all generated before anything is placed, deterministically from the seed. Remaining: exposed rock, parent material and deadwood are still local, and there is no generator-version field. |
| MAP-04 | Partial | Hydrology and water features | The region owns the stream course, stand channel and wet banks. Surface water has analytic flow and eddies; underground water and soil share an 8 cm capillary gradient above the live table. Hyphae can touch that upper fringe but cannot extend into saturated ground, including paid targets invalidated by a rising table. Existing submerged strands persist but stop extending; soil under the stream bed only becomes passable as the table recedes. `src/sim/soil-volume.ts` now answers the spatial path with a continuous regional groundwater elevation and a distance-to-course channel query sharing the bed and table elevations, so one segment is refused by the same water from either stand. Focused headless and rendered checks are recorded below. Remaining: ponds, vernal pools, springs, seasonal channels, erosion, oxygen stress on existing strands, and the ordinary transect's own mean-column projection, which is still what the running game draws. |
| MAP-05 | Partial | Distinct forest stands | Seven communities are derived from moisture, drainage, slope, relief and disturbance (oak ridge, mixed slope, birch hollow, hemlock ravine, stream corridor, wetland edge, recovering clearing), the community sets the stand species mix, and each stand now draws its own trees from that mix. The background vegetation reads the same seven communities: canopy density, stature, species mix, regeneration, fern, grass, rock and deadwood lean per community, and a stand's own density field makes two stands of one community differ. `tools/test-dressing.mjs` asserts that ravines carry more conifer than ridges, that ridges are rockier than ravines, and that clearings are younger than ridges. Remaining: playable-tree age structure and canopy openness still do not vary by community, the placed understory and deadwood layers are not drawn yet, and the floor props are still seeded per stand. |
| MAP-06 | Partial | Stand suitability and succession | Species placement follows the community a stand's own moisture, drainage and slope produce: a stream corridor grows birch and hemlock, an oak ridge grows oak, a ravine grows hemlock. Remaining: succession through gaps, regeneration and recovery is unchanged from the single-stand prototype. |
| MAP-07 | Partial | Cross-stand fungal network | A colony can found a daughter stand across an explicit adjacency edge, carried by wind, and what crosses the border is only what the parent paid, in carbon, water and mineral, asserted exactly. Stages 3-4 now land as the `?lab=crossing` fixture: one colony graph grows across a real shared edge in two adjacent stands on one section plane in about six seconds of ordinary growth, keeping one root, one node budget and one set of stores; parent links span the seam; a seam crossing changes only the strand's stand bucket; the destination stand's own trees are activated by the simulation rather than by being viewed; growth pays the ordinary entry price with no seam tax; the destination voxel is consumed once per arrival; a remote bonded tree in the far stand pays the same connected body; cutting every seam-spanning strand severs and starves the far side without erasing it; a cord pays its charge; a flooded target is refused; all four edge directions cross; and watching a section changes no simulation state. Remaining: the ordinary match is not yet the spatial coordinator (`RegionalMatch` still steps one local `Simulation` per stand), cords do not cross a seam in play, no section browsing (`VIEW-06`) or forest reveal (`VIEW-07`) exists, and infection, warnings and roots crossing a boundary are untouched. Follow the staged spatial-growth specification in Current priorities. |
| MAP-08 | Partial | Regional exploration and information | Stand survey and crown selection lead into a colonized stand's persistent underground context. Orders, catalogue, rail, roots, rewards and networks use that stand; the forest camera is rebased with the landscape so return preserves context. Uncolonized ground explains why descent is unavailable. Remaining: water-feature selection, incomplete surveys and network sensing. |
| MAP-09 | Partial | Generated-map fairness | Validation refuses a region whose stands cannot be reached from the founding stand, or whose founding stand has no water in reach; the founding stand is chosen for habitable ground near water on the way down. Remaining: no repair pass, no threat-counterplay check, and no check that a loss is recoverable. |
| MAP-10 | Partial | Regional colonization loop | The browser now runs regional spore release and announces daughter stands. A colony's outcome offers exploration when another colony exists. Fixed founding resources: the parent pays actual connected node stores in carbon, water and nitrogen; the daughter keeps these in its nodes rather than losing summary-only reserves on the next tick. Remaining: drawn spore hops, a regional victory objective and balance of unattended daughter colonies. All stands now share a regional seasonal clock, including dormant ground and completed colonies. |
| MAP-11 | Partial | Regional atlas interface | `S` or **Survey the region** opens a printed ledger of all nine stands in the sheet's own field-record language. Each line carries the stand, its community, whether a colony holds it, its water-table band and depth, its broad forest health and standing trees once a colony has held the stand, the stand it was founded from, and whether every colony still connects to the founding stand. Unknowns are printed as unknowns: ground never held reads "not surveyed beneath". Lines are buttons that select the stand, so surveying and choosing are one move. It is deliberately a ledger rather than a minimap — no grid, no tiles, no icons, no per-stand markers. Remaining: an infection field (no infection state exists until `ADV-01`/`ADV-02`), water-feature entries, fog of war finer than held-versus-unheld, and network sensing. |
| MAP-12 | Partial | Simulation streaming and level of detail | Every colonized stand steps at full fidelity every tick, in stand order, and ground with no colony in it is not simulated at all, which is what keeps nine stands affordable. Moving between stands provably changes no number (asserted against an unwatched match). Remaining: coarse cadence for distant colonies, rendering LOD, pooled geometry and bounded particles. |
| MAP-13 | Partial | Generator persistence and replay | The region is a pure function of its seed: two matches from the same seed colonize the same stands with the same spores and end in the same state. Remaining: no save or replay format, no generator-version field, and no RNG-state serialization. |
| MAP-14 | Partial | Shared spatial network and soil coordinates | Stages 1-2 landed. `src/sim/spatial.ts` is the pure coordinate module: regional horizontal `x`/`y`, absolute `z`, derived depth, half-open stand ownership, stable `NodeRef`/`TreeRef`/`RootTipRef`, a supercover segment traversal that cannot skip a shared edge, the invertible Three.js adapter, and simulation-owned tree placement that keeps the seeded location the forest already used; `SPATIAL_VERSION` is defined. `src/sim/soil-volume.ts` is the shared material record: one analytic field over global coordinates, so a stand id cannot change a sample; a sparse map of changed voxels advanced in stable key order on the soil's own cadence; a continuous regional groundwater elevation; a distance-to-course stream query; and segment queries that test every crossed voxel. Remaining: the renderer and the ordinary match still read the flat transect, `src/render/surface.ts` still computes its own placement formula, soil organic/mineral regrowth is not yet shared with the transect worlds, and no save format carries the version. |

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

The implementation currently uses one persistent 2D transect per stand.
The 20 September spatial-growth specification below replaces that target with
simulation-owned XYZ nodes and sampled soil volumes. Transects become views
of persistent state, not separate copies of a colony or its resources.

- Descending on a tree, patch, or water feature opens the corresponding stand's
  persistent underground context; it must not generate a new disposable slice.
- Growth across a boundary is a normal local order: a network that reaches a
  shared edge can continue into the neighbouring transect's own soil, carrying
  cords, water, minerals, roots and later infection with it. Founding a daughter
  colony from a wind-borne spore is an additional route, not the only one.
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
- A dense 3D voxel simulation is not required. Use a sparse spatial network
  and deterministic soil sampling, with persistent state only where material
  has changed. Do not fabricate top-down spread from a 2D network.

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
| PERF-01 | Partial | Measured performance budget | `tools/profile-forest.mjs` measures opening and 180-second steward-grown forest samples, draw calls, triangles and renderer resource counts on stated hardware, backend and preset. Readback forces GPU-process completion; its cost is included. First sample, 19 September, 960×640 normal preset on SwiftShader software rendering with a 13th Gen Intel i7-13700HX and 16 GiB: opening median 723.6 ms / p95 777.3 ms and a mature forest median 752.0 ms / p95 809.1 ms, both 183 draw calls and 322,014 triangles, with authored trees batched into 12 draws over 150 parts. Remaining: hardware-GPU measurements, simulation and network-ceiling budgets, and byte-accurate GPU memory. |
| PERF-02 | Partial | Scalable surface quality | An explicit opt-in fast QA preset (`?qa=fast`, `--qa fast`) halves the drawing-buffer resolution, disables antialiasing and baked tree-shadow decals, and bypasses bloom and postprocessing while preserving the CSS viewport, all nine stands, simulation, selection, camera transitions and input. Normal remains the shipping default. Authored tiers are chosen at runtime from projected size (`ASSET-03`): 0 LOD0 / 57 LOD1 / 18 LOD2 at the region overview and 44 / 31 / 0 at the closest forest framing, identical at normal and fast presets. Living authored wood and foliage are batched region-wide (`ASSET-03`), which took 150 authored parts to 12 draw calls. Remaining: production quality tiers chosen from profiling, foliage and weather tiers, and hardware-GPU frame-time budgets. Production JS is 783.73 kB (209.03 kB gzip), plus the opt-in 1.14 kB test bench with the Vite chunk-size warning. The botanical living trees cost 1,568–1,596 triangles at LOD0, 800–810 at LOD1 and 266–298 at LOD2; triangle counts alone are not a frame-time budget. |
| QA-01 | Partial | Feature testing and direct scene fixtures | `test:feature -- --list` routes water, spatial, crossing, dressing, simulation, region, LOD, batches, assets, views, navigation and journey checks; browser routes build current code first and default to fast quality. `?lab=water`, `forest`, `region`, `growth` and `crossing` opt into synthetic paused fixtures with depth control and fixed-step advance; the forest fixture adds dressing on/off, the three density bands and a community selector. Water, spatial, crossing and dressing each have a headless suite in seconds, and water and dressing have focused renderer checks. Remaining: other broad suites still need feature-level subdivision; future features must add their own bounded checks. |
| SAVE-01 | Deferred | Local save/resume | Requires versioned deterministic simulation state, RNG state, bloom history, and camera/view state. |
| MULTI-01 | Deferred | Multiplayer | Do not begin before the single-player vertical slice and performance work are complete. |

## Current priorities

Work in this order unless the user explicitly changes priority.

Latest additional 20 September request: plan fuller forest tiles using
non-interactive background trees and more realistic ground. The fuller-forest
specification below is an independent implementation lane; it does not replace
the cross-stand spatial-growth plan or require that migration to finish first.
This turn authorizes planning, not implementation. No full suites are requested.

Latest 20 September user priority: plan cross-stand hyphal growth, browsable
underground sections that preserve the forest return location, and a forest
network-reveal button. The specification below is the next implementation
sequence for DeepSeek. This is planning only; no spatial functionality is
claimed implemented. The user's instruction not to run full test suites
remains in force.

20 September user override: serene shader water, groundwater/stream gradients,
a reachable fringe with a saturation barrier, and faster testing. Implementation
and current verification are recorded below.

19 September user override: implement neighboring-stand exploration first, then
forest batching and performance. Navigation is implemented and its focused
browser fixture passed before batching; current combined verification is being
recorded below. Existing projected-size LOD work is preserved.

19 September art-lane override: build the botanical asset pack in the requested
order (trees and variants, understory/deadwood, fungi, rocks). Runtime machinery
remains separate: ASSET-03 instancing next (LOD selection landed on 19
September), then wind hooks, intake failure/late-load validation, crown-anchor
consumption, ecological placement and the remaining PERF-02 production quality
tiers; the opt-in fast QA preset is implemented, but it does not close the
profiling gap. Seasons use procedural tint; underground structure stays
procedural. The new art does not close any of those runtime gaps.

Superseded stopping point requested by the user earlier on 19 September: the asset pack and its
rebuild/QA tooling are ready to commit. Runtime LOD selection reads
`forest-manifest.json`; living-tree batching now builds on it. Crown anchors
and dead variants remain separate future work. Re-run the complete browser view suite
independently of Blender rendering before claiming current-tree interaction
verification; the combined checks for this work are recorded below.

### Fuller forest and natural ground: implementation sequence for DeepSeek

**Desired result.** The regional forest should read as connected woodland with
overlapping canopy groups, understory, leaf litter, occasional deadwood and
clearings. It should not look like a sparse set of playable trees placed on
striped tiles. Some trees remain the game's interactive partners; most added
vegetation is atmosphere. Preserve the quiet botanical style while making
materials, placement and ground contact more convincing. This is runtime
integration and rendering work using existing assets, not a new asset-art task.

**Current causes to address.** `SurfaceForest` currently draws the simulation's
roughly 7-10 trees per stand. Its floor colours use
`sin(x * 0.14 + z * 0.17)`, which produces visible diagonal bands; each stand
then scatters 2,200 grass instances and 1,600 litter pieces uniformly. Authored
prop placement adds only three stumps/logs. Much of the delivered botanical
pack is not exposed by the runtime `AssetId`/registry yet. Increasing the
existing scatter counts alone will increase clutter without making a forest.

#### A. Separate playable trees from background vegetation (`ASSET-04`)

- Keep `World.trees` as the authoritative playable population. Add a separate
  renderer-side `ForestDecoration` record with stable decoration ID, kind,
  species/asset, regional position, size, orientation and wind phase. Do not
  construct fake `Tree` objects or add decorative trees to simulation arrays.
- Decorations have no root tips, bonds, harvestable stores, colony influence,
  selection ring, crown proxy or entry in the tree selector. Exclude their
  geometry explicitly from picking instead of hoping raycast order ignores it.
  Give decoration keys a separate namespace from `standId:treeId`.
- Cosmetic season tint and wind use the same environmental clock/preferences
  as the forest. Static diversity does not require per-tree ecology. Decorative
  foliage may respond gently to regional weather, but do not give it invented
  individual health, deaths or fake gameplay responses.
- The player's actual partners must remain readable among the added trees.
  Reserve space around their trunks/crowns, keep current selection markers
  unobstructed and retain the selector as a reliable fallback. For dense views,
  support a restrained selected-tree silhouette and fade only obstructing
  decorative foliage. Do not outline every tree or turn all scenery into UI.
- Additional greenery must not hide the forest's gameplay feedback: bond,
  stress and death remain visibly attached to the real partner tree, and
  health/biomass readouts still count only simulated trees.

Acceptance: with dressing enabled, the same seed has exactly the same
playable tree/root IDs, initial simulation checksum and selector entries as
with dressing disabled. Clicking background vegetation never issues a tree
order, selects a fake partner or blocks access to a real crown underneath.

#### B. Generate clusters and gaps across tile boundaries (`ASSET-04`, `MAP-05`)

Implement a pure, seedable placement helper, for example
`src/render/forest-dressing-layout.ts`. It accepts regional terrain/community,
stream and playable-tree locations; it does not consume a simulation RNG.

- Use regional coordinates for low-frequency density fields and candidate
  hashes. Generate candidates in spatial cells with stable IDs and deterministic
  priorities. Evaluate neighboring cells across a tile boundary when enforcing
  spacing; use half-open ownership bounds so a tree is emitted once. This
  avoids square planting patterns, seams and stand-load-order dependence.
- Make clustered canopy groups, thinner connecting woodland and deliberate
  gaps. Use a spacing radius based on crown size, not a perfect grid or one
  radius for every age. Vary height/width and yaw modestly; do not scatter
  extreme scale variants or tilt mature trunks like loose props.
- Blend community influence near borders. Starting composition: oak ridges
  have more open patches and dry litter; hemlock ravines have denser shade and
  mossy understory; birch hollows have mixed young growth; stream corridors
  retain an open channel with clustered vegetation on the banks; recovering
  clearings use saplings and grass with fewer mature crowns.
- Reserve exclusion masks for the actual stream, large ground discontinuities,
  playable trunks and important interaction sightlines. Trees and props must
  sit on the region's own `heightAt`; do not float them above valleys or put
  trunks in open water. Occasional crown overhang is allowed; planting a root
  anchor inside a channel is not.
- Start with configurable density bands of roughly 24, 48 and 72 background
  canopy trees per stand, then tune from normal-quality overview and close-up
  captures. These are trial counts, not acceptance criteria. The desired
  density is a convincing canopy silhouette with visible clearings, not a
  blanket hiding every stream and playable tree.
- Add lower layers selectively: young trees at canopy gaps, ferns/shrubs in
  moist shade, grass in brighter openings, fallen branches and litter beneath
  crowns. Rework the existing uniform grass/litter instances into those masks
  instead of retaining them and adding another indiscriminate layer.

Acceptance: deterministic placement for a seed, stable IDs after stand re-entry,
no duplicate edge candidates, no channel/planted-trunk conflicts, and clearly
different forest density/composition in at least three community fixtures.
Cross-border density changes must read as habitat transitions, not tile edges.

#### C. Render the added forest cheaply (`ASSET-03`, `ASSET-04`, `PERF-02`)

- First expose only the already-delivered tree LODs, saplings, fern/grass,
  small rocks and needed deadwood assets in `assets.ts`. Validate manifest
  lookup and ground correction. Missing files keep a bounded procedural
  fallback or omit a minor prop; never trigger thousands of individual
  fallback tree objects while assets load.
- Add dedicated instanced decoration batches sharing geometry/material by
  asset, part and LOD. The current `TreeBatches.sync()` walks each playable
  model's object hierarchy every frame; do not copy that object-heavy path
  for hundreds of static background trees. Store placement in typed buffers;
  update static transforms only when created or moved between LOD groups.
- Use the existing projected-size LOD logic and hysteresis. Most background
  trees should use LOD1/LOD2; LOD0 is earned by close screen size. Frustum-cull
  moderate spatial chunks with correct bounds, avoiding one enormous always-
  visible forest batch and avoiding one draw call per tree.
- Wind belongs in a shared shader with per-instance phase/stiffness, or a
  low-cadence bounded update until that exists. Reduced motion freezes it.
  Do not rebuild instance matrices for all decorative trees every frame.
- Cap foliage overdraw. Prefer opaque authored foliage or cutout material
  where required; avoid stacks of large translucent cards. Use shared canopy
  shadow masks/contact shading rather than hundreds of new shadow lights or
  per-tree dynamic shadow maps.
- Keep normal and `qa=fast` on the same placement and identity set. Fast QA
  must not conceal planting/selection defects by removing all background
  trees. Any later production scenery-density setting is separate and must
  never change simulation state.

Acceptance: decoration draw calls scale with visible asset/LOD groups and
chunks, not tree count; simulation node/tree counts remain unchanged; no
continuous per-tree object allocation; GPU resources stabilize after repeated
stand switching. Record before/after draw calls, triangles and backend at a
fixed seed/camera. Tune density to measured results instead of claiming that
instancing alone guarantees a frame rate.

#### D. Replace striped ground with natural material patches (`VIEW-08`)

Keep authoritative terrain elevation and existing stream geometry. Improve
its surface material first; a new terrain generator is not a prerequisite.

- Remove the sine-band colour recipe. Build region-space material weights
  from slope, relative elevation, stream distance/wetness, canopy coverage,
  community and seeded irregular patch noise at several scales. Adjacent
  tiles must evaluate the same field at a shared world point.
- Use a compact set of ground materials: dark leaf humus, drier leaf litter,
  shaded moss, sparse exposed mineral earth, and gravel/stone near channels
  or steep exposed patches. Wet banks darken and gain a restrained sheen;
  dry soil stays rough. Avoid making the entire forest green lawn.
- Begin with baked regional masks/vertex weights plus one shared material.
  Add reusable albedo/normal/roughness detail only where close-up views need
  it. Use world-space sampling with consistent texture scale and mipmaps;
  noise must not restart at each tile or turn into sparkling pixels at a
  distance. Surface patterns stay fixed when the stand/render origin rebases.
- Distinguish fine material relief from terrain shape. Small normals/bump
  detail can suggest litter, roots and pebbles without changing collision or
  water height. If vertex displacement is later introduced, route it through
  the shared terrain sampler so trunks, props, water and picking still agree.
- Add clustered leaf fragments, partially embedded pebbles, a few roots at
  real trunk bases and fallen branches where they improve silhouette. Place
  low props with sampled support heights/normals so logs do not balance on
  their centres over slopes. Decorative rocks/logs grant no resources or
  stream-crossing ability; avoid suggesting a playable bridge where none
  exists.
- Add restrained canopy/contact darkening at tree bases and beneath foliage,
  including decoration clusters. Prefer a coarse shared mask over per-tree
  transparent shadow decals. Do not bake sunlight in conflicting directions
  into albedo or mistake near-black ground for material realism.
- Revisit the known near-camera ground/backing defect: the ground should not
  disappear while trees float above the slab. Correct the backing extent,
  terrain skirt or transition mask in `stage.ts`/`surface.ts`; do not hide it
  by planting more trees over the seam. Inspect the region edge and the
  forest-to-underground crossing after the change.

No purchased textures, Blender generation or new scanned-asset pipeline is
required for the first pass. Reuse local assets and generated/baked detail.
If those cannot deliver acceptable close-up material, record the exact missing
asset as a gap rather than expanding this task into asset production.

Acceptance: no diagonal stripe repetition at overview; close-up ground reads
as litter/moss/earth rather than flat vertex colours; stream banks remain
aligned and visible; no material seam at shared edges; tree/log/rock bases
contact the ground; orbiting does not expose a floating foreground forest.

#### E. Integration, scoped testing and delivery order

Suggested responsibilities: `forest-dressing-layout.ts` for pure placement;
`forest-dressing.ts` for instanced drawing; `assets.ts`/manifest for existing
asset exposure; a small `ground-material.ts` for terrain materials;
`surface.ts`/`stage.ts` for integration and cutaway behavior. Keep community
tuning centralized instead of scattering density constants through rendering.

Use stable regional coordinates compatible with the planned `MAP-14`
convention, but keep scenery independent of the spatial simulation migration.
Background trees never become extra network roots. `VIEW-07` network reveal
must be able to dim decorative canopy without changing instances' identities;
normal opacity returns when reveal is disabled. During descent, decorative
vegetation follows the surface fade/fold and does not leave invented roots
drawn inside the underground specimen.

Implement as separate reviewable changesets:

1. Pure placement and background-only data model, then an immediate forest
   fixture using a few existing LOD2 assets. Confirm unchanged gameplay state.
2. Clustered instanced canopy with playable-tree picking preserved. This is
   the first visually useful density improvement; do not wait for every prop.
3. Replace ground stripes/material weights and redistribute existing litter
   and understory. Add optional detail maps after the coarse composition works.
4. Ground contact, backing/cutaway fixes, near/far LOD tuning and integration
   with the water and planned network-reveal controls.

Extend the existing `?lab=forest` bench with dressing on/off, reproducible
overview/close camera poses and a small community selector. Add focused
`test:dressing` checks for determinism, masks, seams, ownership and unchanged
playable state, then a bounded forest-dressing browser smoke using the same
fixture. Expose it through `test:feature`. Capture the same camera before/after
so density improvement and selection readability can be judged directly.

Use typecheck and the relevant small headless checks during implementation;
one focused browser pass when the visible change is complete. Do not run full
simulation, region, view or journey suites without a new user request. Report
normal/fast preset, backend and visible decoration count with any measurements.
No tests are needed for this planning-only update. Mark `ASSET-04`/`VIEW-08`
Verified only after the associated behavior and images have been checked;
update `MAP-05`, `ASSET-03` and `PERF-02` only for gaps actually closed.

**DeepSeek starting task: A, the pure placement part of B, and the fixture are
done.** `src/render/forest-dressing-layout.ts` is the pure region-wide layout
(deterministic, half-open ownership, clusters and gaps, community composition,
channel and playable-tree masks), and `src/render/forest-dressing.ts` draws the
canopy and regeneration layers as `(tier, asset, category)` instance batches of
normalised LOD2 geometry, with per-decoration projected-size LOD. `World.trees`
is untouched: scenery has its own keys, no root tips, no bonds, no economy and
no place in any pick target list, and `tools/test-dressing.mjs` asserts that the
simulation's checksum is identical with the layout running. The `?lab=forest`
bench switches dressing on and off, changes band, and isolates one community.
`tools/test-dressing.mjs` and `tools/test-dressing-view.mjs` are exposed as
`test:feature -- dressing`.

Next, in this order:

1. Wire the `ForestDressingInput.stands` filter and the band into a
   normal-quality capture pass and tune the default band and the background LOD
   bands from those images. The measured first pass is recorded below; the
   default is `medium` because it is the first band that reads as woodland at
   the region overview, not because it has been tuned on hardware.
2. Expose the remaining placed kinds - fern, grass, boulder, log, stump, snag -
   and redistribute the existing uniform grass/litter scatter onto the same
   masks instead of adding another indiscriminate layer.
3. Then replace the striped ground material (`VIEW-08`), including the
   near-camera ground/backing defect, and re-inspect the forest-to-underground
   crossing afterwards.

Keep all durable progress and verification in this file.

### Cross-stand spatial growth and connected views: implementation sequence

**Scope and architectural decision.** Implement one sparse spatial fungal
network, partitioned by stand for indexing, with underground sections and the
forest reveal as projections of that same state. Nodes have genuine XYZ
positions. Soil is sampled deterministically and only changed cells retain
mutable state; do not allocate nine dense 136 x 136 x 112 volumes. No new 3D
assets are required. Do not rotate today's flat network onto the forest floor,
randomly scatter its nodes, or duplicate a colony for every displayed slice.

**Player-facing result.** Descend beneath a selected tree or network strand.
Inspect a vertical section, flip to neighboring sections or follow a strand
across a stand boundary, and optionally compare two sections. Every section
shows the continuing simulation. Return to the forest at the original camera
location. A **Network** button in the forest reveals the connected network
beneath the terrain; selecting a visible strand opens the section containing
that strand. Ordinary forest tree selection remains available with reveal off.

#### 1. Establish shared spatial coordinates (`MAP-14`)

Implement small pure helpers in `src/sim/spatial.ts`, with render conversion
in a separate module. Use these conventions consistently:

- Simulation `x`, `y`: horizontal regional coordinates, matching today's
  `Region.heightAt(x, y)`; `z`: absolute elevation, positive upward. Depth is
  derived: `depthCm = (heightAt(x, y) - z) * GRID.cmPerRow`.
- Stand ownership comes from horizontal position alone, using half-open
  bounds. Internal edges belong to exactly one stand; coordinates outside
  the region are invalid. No diagonal jump may skip testing a shared edge.
- Three.js adapter: `(x - originX, FLOOR + z, originY - y)`. Keep any visual
  vertical exaggeration in this adapter, with an inverse for picking. Never
  add random render depth to a simulation coordinate.
- Add stable `ColonyId`, `NodeRef { colonyId, nodeId }`, `TreeRef { standId,
  treeId }` and root-tip references. Local numeric tree/node IDs currently
  collide across stands. View buffers can have slots; those slots are not IDs.
- Move the seeded horizontal placement now inside `treeSurfacePosition()`
  into simulation-owned tree data. Preserve its seeded location where
  possible. Root tips must have real positions under that tree; root depth
  and bonding distances must be computed in 3D, not from the nearest screen
  label or a matching horizontal column.
- Define a generator/spatial version. Keep a narrow adapter for existing 2D
  fixtures while migrating callers; do not silently label old flat saves or
  tests as spatial. There is no released save format to migrate today.

Acceptance: round-trip coordinate conversion; negative/outside coordinates
rejected; all four stand edges resolve consistently; equal absolute elevation
does not change at a stand seam; the same tree/root has matching coordinates
in both projections. This first change need not alter ordinary gameplay.

#### 2. Make soil and water queryable in 3D (`MAP-14`, `MAP-04`)

Introduce `SoilVolume.sample(position, time)` and an explicit mutation path,
backed by regional seeded fields plus a sparse map of changed soil cells.
Reuse current horizon/economy parameters; do not rewrite balance as part of
this migration. Material queries and view sampling must be read-only.

- One canonical voxel key uses global coordinates and a documented resolution
  (initially one game-space unit per axis). Shared-boundary queries address
  the same physical material; stand ID must not change the noise sample.
- Soil organic matter, minerals, harvest depletion and occupancy have one
  persistent record per affected voxel. Opening another section must neither
  create new resource stocks nor copy a depleted cell's resources.
- Keep analytic initial material and a simulation-owned active/dirty-cell
  set. Advance changed cells on the existing soil cadence in stable key order;
  do not iterate the entire volume or let render sampling determine updates.
  If inactive-cell recovery is lazy, calculate it from recorded simulation
  time and environmental history, never the wall clock or time last viewed.
- Expose a continuous regional groundwater elevation, derived from the
  generator's water field, not nine discontinuous stand-average depths.
  Convert it to local depth for the existing 8 cm fringe. Apply season changes
  on the regional clock, including newly reached ground.
- Replace the mean-column stream obstruction for the spatial path with a
  distance-to-course/channel-bed query against the region's actual stream.
  Both views must use the same course and water/bed elevations. Preserve the
  old mean-column representation only in explicitly legacy 2D fixtures.
- Every growth segment checks all crossed material cells (bounded grid
  traversal), not just its endpoint. Otherwise diagonal or long steps can
  tunnel through streams, thin rock, saturated ground or stand corners.

Acceptance: a boundary sample agrees from either stand; viewing/slicing does
not change a state hash; two sections through the same voxel see the same
depletion; groundwater and a stream block the same segment in every view.
Update stream rendering from this shared query when enabling spatial mode,
rather than leaving a different visual waterline above the actual barrier.

#### 3. Deliver one real crossing before broadening scope (`MAP-07`)

Start with a funded near-edge fixture in **two east-west adjacent stands**,
one narrow spatial section and one cross-boundary growth order. Its positions
are already XYZ, but holding horizontal `y` constant in this fixture keeps the
first implementation small. This is a test fixture, not a claim that the full
region has become volumetric.

- A colony owns one node/edge graph for its entire extent. Crossing a stand
  boundary changes the node's spatial index bucket, not its colony, parent,
  ownership or resource inventory. RegionalMatch becomes the coordinator;
  local Simulation instances must stop independently stepping portions of
  the same colony. `MAX_NODES` and tip capacity remain per colony, not multiplied
  by the number of occupied stands.
- Retain parent/children as an acyclic growth tree initially. Parent links
  may span stands and use stable references. Derive the visible seam/portal
  record from a real edge intersection; it is not a second node, reservoir or
  teleporter. Defer anastomosis and graph loops to a later feature.
- Pay the ordinary length-based growth and branching costs exactly once.
  A boundary has no founding kit or extra colony tax. Do not call
  `foundColony()` or `createNetwork()` to continue a strand: those create
  a root and starting tips and would mint a second body.
- Activate the destination stand's local ecology when reached by simulation,
  even if it has never been viewed. Remove the assumption that `hasColony`
  means an independently founded local player graph. Local views enumerate
  regional nodes present in that stand, including disconnected remnants.
- Spore-founded colonies remain separate graphs with their paid founding
  resources. Entering a stand already containing a friendly colony does not
  merge resource stores automatically. Contact and joining can be added later.
- The goal of this stage is a short boundary crossing, not long-distance path
  finding through the entire region. Start with an explicit adjacent target,
  bounded local path planning and the existing growth steering. Return a
  useful refusal when there is no passable route; no teleporting around water.

Refactor existing network operations behind region-aware world/tree lookup
interfaces rather than maintaining a second copy of the economy. Concrete
hotspots: `isPassable`, `chooseTarget`, `extendTips`, `commitTip`, `tryBond`,
`markConnectivity`, `transport`, and `RegionalMatch.step`.

Acceptance: one tip grows across the seam at normal speed, with unchanged
colony identity and an unbroken parent edge. Exactly the construction cost
leaves the total resources. Destination soil is consumed once, and crossing
works without switching the active camera/stand. Preserve this as the small
`?lab=crossing` fixture, not a long warmed match.

#### 4. Carry resources and connectivity across the region (`MAP-07`, `MAP-10`)

Make the crossing a functioning body before adding visual breadth:

- Use a fixed phase order: regional environment; connectivity per colony;
  local harvest/trade; transport over the complete colony tree; respiration,
  growth and decay; fruiting and totals. Advance each node and edge once.
  Sort work by stable colony/node IDs; stand iteration or camera order cannot
  give one side a second transport pass or a new source of carbon.
- Adapt existing inward/outward resource sweeps to the complete tree; keep
  storage limits, supply reserves and throughput limits. Cross-boundary cords
  use the same reinforcement costs and capacities as local cords. A transfer
  always subtracts and adds the same amount in the same resource.
- Connectivity starts at the colony's genuine living founder. A seam is
  never an extra supply root. Severing its only connection disconnects distal
  strands and stops their tree trade/fruiting supply using existing starvation
  rules. Persistent distal tissue is not deleted merely because it is unseen.
- Standing biomass, funded resources and root bonds belong to actual nodes,
  edges and trees. Local readouts are filtered summaries; regional totals
  count every object once. Record growth crossings separately from spore
  arrivals so survey lineage is not confused with physical supply continuity.
- A local two-bloom outcome must not freeze one piece of a spanning network.
  Separate local milestone presentation from colony stepping; regional play
  can continue, with the existing stop/restart choice. Keep the old two-bloom
  endpoint for legacy single-stand fixtures. Do not invent a regional victory
  rule during this work.
- Generalize to north/south and west/east movement with 3D neighborhood costs
  based on actual segment length. Prevent zero-length repeat crossings,
  duplicate boundary nodes and diagonal corner tunnelling.

Acceptance: carbon/water/mineral conservation across a seam; a remote bonded
tree feeds the same connected body; a cut stops remote supply; a cord changes
throughput and pays its cost; flooded targets are rechecked before commit;
unwatched and watched runs produce identical state. Include all four edge
directions and a corner case. These are small headless fixtures.

#### 5. Browse real underground sections (`VIEW-06`, `MAP-08`)

Add `SectionSpec { id, origin, along, normal, halfWidth, extent }`, using a
vertical plane and finite thickness in canonical coordinates. Begin with
east-west and north-south sections; arbitrary orientation is optional later.
Suggested starting thickness is 4 game-space units, configurable in the test
fixture rather than silently widened to include every strand.

- Show one full interactive section first. Controls: **Previous section**,
  **Next section**, **Follow connection**, **Return to forest**. A stand/section
  label names the location and orientation. Navigating a section changes only
  viewing state; an explicit growth order is required to change the frontier.
- Clip edges against the section slab, including segments that intersect it
  while both endpoint nodes are outside. Draw a continuation mark where a
  strand exits; selecting it moves to the section containing that same edge.
  Do not terminate the simulated strand or invent a cross-section junction.
- Choose the opening section through the selected tree/root or strand. A
  completely empty section is valid; say that no network is present rather
  than injecting decorative strands. Initially permit browsing the active
  stand and directly sensed/reached neighbors, not undiscovered regional soil.
- Screen-to-world growth orders land on the active plane. Show the target
  position before submission; label/passability checks use that same point.
  Roots outside the slab must not be selectable via projected labels.
- After single-section browsing works, add optional **Compare sections** with
  the active section plus one read-only pinned section. Use one WebGL canvas
  with viewport/scissor rendering, not separate Game/Simulation instances.
  Match simulation time and depth datum; distinguish the interactive section.
  Limit comparison to two panels initially, with a narrow-screen fallback to
  flipping. Do not instantiate full soil grit for all nine stands at once.

**Camera contract:** capture `ForestReturnContext` on initial descent: camera
target in absolute regional coordinates, distance, azimuth, elevation, framing
mode, selected tree/stand and reveal state. Store underground poses by
`standId + sectionId`, not only by view type. Section changes never overwrite
the forest snapshot. Restore the same world target and orientation on return,
recomputing only the viewport/aspect requirements. Offer a separate **Surface
here** action when the player intentionally wants to emerge over the browsed
stand. Snapshot capture and restore must also work with interrupted crossings,
resize and reduced motion.

Current `CameraRig.rebaseForest()` deletes the underground memory, and Game
repositions the landscape on stand entry. Either keep that render-origin
optimization and transform all saved poses through absolute coordinates, or
keep a stable regional render origin. Do not apply origin shifts twice to a
saved forest target. Add explicit capture/restore APIs instead of reaching into
the camera's private maps from UI code.

Acceptance: descend at tree A, browse B and C, return to the same forest pose
and selection at A. The general Underground action reopens the last browsed
section C; an explicit Descend at tree A instead opens A's root section.
Keep forest selection, inspected section and simulation ownership separate.
Follow a real seam edge in either direction. A click in the pinned comparison
view never issues a growth order. Both panels show the same ongoing tick.

#### 6. Reveal the network from above (`VIEW-07`)

Add one accessible **Network** toggle to the forest controls, off by default,
with pressed state and a keyboard-accessible inspection path. Implement the
cheap version first:

- Draw a surface projection of the **real** XYZ edges at their actual x/y
  locations, sampled onto the terrain with a small rendering offset. This
  is explicitly a projection: depth affects line weight/opacity, and picking
  returns the original NodeRef/edge reference and its real depth.
- Use restrained amber, normal blending and bounded highlights; active flow
  or connectedness is derived from simulation. Differentiate disconnected
  remnants without colour alone. No animated pretend growth and no full-screen
  bloom requirement: this must remain readable in `qa=fast`.
- Clicking a projected strand opens the exact section through it. At stacked
  depths, resolve candidates by screen distance and explicit depth selection,
  not whichever mesh happens to win a raycast. Tree/reveal picking modes must
  be unambiguous, with roots and strands retaining their identities.
- Next add optional **Ground: translucent** while reveal is on: retain the
  network at real elevation, fade terrain and the backing/slab that currently
  occlude it, and dim foliage only as needed. Restore every modified material
  when leaving the mode. Handle shared/batched materials deliberately; do not
  clone a material per tree or disable depth testing throughout the scene.
- Keep projection and true-depth inspection separate modes. Transparent
  ground should show actual depth/parallax; it must not display a flattened
  projection as if it were subterranean geometry. If transparency sorting is
  not stable, ship projection first and retain an explicit remaining gap.

Reuse instanced strand geometry or batched line segments with per-view buffer
slots, updating dirty edges only. A second renderer is unnecessary. Bound
display LOD to screen-space strand size; lowering visual detail must not remove
simulation nodes. A short slice-plane marker can show where the last inspected
section cuts the forest; do not introduce a floating dashboard or checkerboard.

Acceptance: the same selected edge has matching horizontal endpoints in
forest projection, true-depth mode and its underground section; crossing a
stand seam introduces no gap; toggling reveal changes no simulation checksum;
normal forest materials and picking return exactly after toggle-off. Preserve
water flow, reduced motion and existing forest camera navigation.

#### 7. Integration gates, files and small-test workflow

Implement in the numbered order as reviewable changesets. Finish each gate
before moving on; one prompt should not attempt the complete rewrite.
Suggested file responsibilities (names may follow existing conventions):

| Area | Implementation responsibility |
|---|---|
| `src/sim/spatial.ts` | Pure positions, references, ownership and segment traversal |
| `src/sim/world.ts`, new `soil-volume.ts`, `region.ts` | Spatial tree/root data, shared soil/water queries and sparse material state |
| `src/sim/network.ts`, `sim.ts`, `match.ts` | One colony graph across stands, region-aware lookups and one deterministic tick pipeline |
| `src/render/sections.ts`, `hyphae.ts`, `soil.ts`, `forest.ts`, `water.ts` | Section queries/clipping and projection of shared state; no simulation copies |
| `src/render/camera.ts`, `src/game.ts`, `src/ui/` | Saved forest context, section browsing, picking and local readout rebinding |
| new `src/render/network-reveal.ts`, `surface.ts`, `stage.ts` | Surface projection, optional true-depth transparency, reversible material state |
| `src/dev/lab.ts`, `tools/test-feature.mjs` | Immediate crossing/section/reveal fixtures and scoped check entry points |

Add `test:spatial`, `test:crossing` and a focused section/reveal browser smoke
route as those features land. Suggested fixtures: two stands with one funded
tip beside an edge; a three-stand chain with a remote bond; a wet blocked seam;
two depth-separated edges sharing x/y; and a cut remote branch. Seed fixtures
directly through explicit testing APIs, without simulating a mature match or
running every browser suite. Reuse one browser session for focused view checks.

Routine verification: typecheck plus the newly affected headless fixture.
Run the scoped browser smoke only for a completed renderer/input change. No
full simulation, region, view, navigation or journey suite without a new user
request. Existing results remain historical until rerun; do not mark new
spatial behavior Verified on the strength of old 2D tests.

Measure node/edge visits per tick, active voxel count, draw calls and GPU
resources on repeated section changes. CPU work should scale with active
graphs/material, not total region volume; render memory should stabilize with
one active and one optional comparison section. Record backend, preset and
node count when reporting timing. No hardware-FPS promise from SwiftShader.

Initial delivery is complete when a player can grow a supplied strand across
one shared boundary, inspect it from either underground section, cut its
supply, return to the same forest location, and select that exact strand from
the forest Network view. Full four-direction spatial growth, two-section
comparison and true-depth transparency have their own gates above; keep them
Planned/Partial until exercised. Defer graph fusion, arbitrary slice rotation,
full fluid simulation, new root artwork, disease and new regional victory
rules. None is a prerequisite for the first connected playable crossing.

**DeepSeek starting task: done for stages 1-4.** Stage 1 (`src/sim/spatial.ts`)
and its pure-coordinate checks landed first; stage 2's minimal soil-query
interface (`src/sim/soil-volume.ts`) followed, needed by the two-stand fixture;
stages 3-4 landed as the `?lab=crossing` fixture (`src/sim/crossing.ts`) with
`tools/test-crossing.mjs`. The completed water work was preserved: the water
diff is untouched, and the network refactor these stages needed was verified
against `npm test`, `tools/test-region.mjs` and the focused water browser check
before this entry was written. Stage 5 of the sequence - browsing real sections
- and stage 6's cheap half - the forest reveal - have since landed on that same
fixture (`VIEW-06`, `VIEW-07`): sections are clipped, browsable, followable and
restored, and the reveal projects the real strands, answers a click with the
section through it, and is a real forest control. What has *not* landed is
stage 7: the ordinary match is still the flat transect, so promoting the
fixture's coordinator into `RegionalMatch` remains the next gate, together with
the compare-sections mode and the transparent-ground switch that stages 5 and 6
leave open.

### Next asset machinery approach (ASSET-03, PERF-01, PERF-02)

These are implementation notes, not completed work; feature statuses remain
unchanged.

1. **Done 19 September.** `src/render/assets.ts` consumes
   `forest-manifest.json` and `src/render/lod.ts` selects a tier by projected
   tree size, with separate thresholds for entering and leaving a tier so a
   tree on a boundary cannot flicker. Tiers past LOD0 are warmed in the
   background and a swap keeps the placed model's position, rotation and scale.
2. **Implemented for living authored trees.** Batch wood and foliage by species, living/dead variant, LOD and material
   using `InstancedMesh`. Carry health, seasonal tint and wind variation as
   per-instance data so batching preserves each tree's state.
3. **Implemented for living authored trees.** Maintain an explicit instance-index-to-simulation-tree-ID mapping for
   selection, including when instances move between batches. Preserve the
   living model's scale, ground contact and crown anchor across tier/variant
   changes; never feed presentation choices back into the simulation.
4. Measure draw calls and frame time across all nine stands, then tune LOD
   thresholds and quality tiers from those measurements. Lower triangle counts
   alone do not establish a performance improvement.

### Faster testing and render iteration


Current fast entry points (20 September): `npm run test:feature -- water`
exercises hydrology without a renderer; `--browser` adds only the water/bench
checks and builds first, with `--normal` for full-quality verification.
`npm run test:feature -- spatial` runs the shared coordinates and the soil
volume, and `npm run test:feature -- crossing` runs the two-stand crossing
fixture; both are headless and finish in seconds. `npm run test:feature --
--list` exposes all existing feature suites. The views route uses `--smoke`
unless `--full` is supplied. Other existing broad suites remain slow; this
dispatcher does not claim to shorten a full match regression.

For manual checks use `?lab=water`, `?lab=forest`, `?lab=region` or
`?lab=growth`, optionally with `&qa=fast`; `?lab=crossing` opens the headless
spatial crossing fixture, which is stepped and reported in the bench and not
drawn yet. Fixtures use explicit synthetic resources and pause at entry; the
test bench can change groundwater depth or advance ten fixed-step seconds
without rendering intermediate frames. Normal loads do not create the bench or
fund extra colonies.

The browser harness currently forces software WebGL and renders complete frames
during many logic checks. Running Blender renders alongside it also introduces
resource contention. The full interaction suite was excessive for the
asset-only iteration; choose checks according to what changed.

- **Routine edits:** run relevant fast checks such as `npm run test:assets`
  and `npm run typecheck`. When implementing LOD/instancing, add focused tests
  for threshold hysteresis, stable selection mappings and preserved transforms.
  Separate state/transition calculations from drawing so logic tests can
  advance without rendering every frame. `tools/test-lod.mjs` and the browser
  tier checks now cover the LOD half of that; instancing has focused
  instance-to-tree mapping checks in `test:batches`.
- **Keep the slow loop for the end.** The headless checks are the fast iteration
  loop: `npm run test:lod` finishes in seconds and `node tools/test-region.mjs`
  in about a minute, and between them they cover the simulation and its derived
  data. The browser suites are the slow loop — a full `node tools/test-view.mjs`
  run is several minutes under software WebGL even with synthetic timing frames
  — so a new browser check should be written alongside the feature and run when
  the feature is finished, not on every edit. A behaviour that can be asserted
  headlessly belongs in a headless check first; the browser check should only
  cover what needs a real renderer, real input or real layout.
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
   The region renders and controls now descend into colonized stands. Remaining:
   connected water rendering and cross-boundary resource cords.
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
water, persistence and boundary exchange now hold in the simulation; cross-boundary
resource cords and connected water rendering remain; region navigation now works
and the survey layer (`MAP-11`) prints the region as a ledger.

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
- The spatial migration is real but partial, and must not be described as more
  than it is: `MAP-14` stages 1-2 give the simulation coordinates and one shared
  soil volume, and `MAP-07` stages 3-4 grow one colony across a real seam in the
  two-stand `?lab=crossing` fixture. The ordinary match still steps one local
  `Simulation` per colonized stand, still draws the flat transect, and has no
  cross-stand cords. The fixture holds horizontal `y` constant, browses one
  section plane, and generates the destination stand's trees from that stand's
  own transect world while the colony's material comes from the shared volume -
  two soil models still coexist, and unifying them is part of promoting the
  fixture into `RegionalMatch`. Nothing is drawn from the fixture yet.
- The background forest is presentation only, and partial: canopy and
  regeneration are drawn from the authored pack, while ferns, grass, boulders,
  logs, stumps and snags are placed by the same layout but not yet rendered.
  The uniform 2,200 grass and 1,600 litter instances are still the old scatter,
  so the floor has not yet been redistributed onto the new masks. The default
  density band (`medium`, 48 canopy trees per stand nominal) and the background
  LOD thresholds are first-pass numbers measured only on the software backend;
  they are not an art-direction or frame-time acceptance, and the region
  overview's diagonal ground banding is untouched (`VIEW-08`). The scenery is
  hidden rather than folded as the camera descends, because it has no roots to
  carry below; the terrain is already opaque over it at that point.
- Sections and the forest reveal are built on the crossing fixture, not on the
  ordinary match: they read that fixture's colony, and the match's own stand
  views are hidden while a section is open. The fixture's colony is a single
  plane, so a section through it is a thin band of strands rather than a volume,
  and the compare-sections mode and transparent-ground true-depth switch are not
  built. The reveal's cost at regional scale is unmeasured, and its strand
  symbols are a thin, dim line at the region overview: node dots and a shallow
  depth falloff make it visible, but line weight and marker size still need
  tuning, and the samples per edge are the only screen-space LOD it has.
- The match renders nine stands and players can enter colonized underground
  transects. A local view is rebuilt and its owned GPU resources disposed on
  each stand change; this bounds residency but may hitch on entry. There is no
  atlas, cross-stand cord, or distant-stand simulation cadence yet.
- A colony that has fruited twice stops growing, as it always has, so a regional
  match is a founding colony plus whatever its spores founded before it won. A
  regional objective is still an open design question (MAP-10).
- Ground with no colony in it is not simulated at all: its history begins when a
  spore lands. That is deterministic and cheap, but it means an uncolonized
  stand does not drift while the player is away from it.
- The region renders as one forest and every colonized stand can be entered
  underground with its own local views rebound. What is still wrong: the tiles
  nearest the camera lose their floor below the slab while their trees hang over
  the edge, and ponds and exposed rock are not drawn (`MAP-02`, `MAP-04`).
- The underground stream is a projection, not a course. A stand's channel is
  drawn at the mean column the region's stream crosses in that square, so a
  stream entering one corner and leaving the next is a single seam rather than a
  diagonal. Widening it (it scales with the square's flow) hides most of this,
  but a genuinely correct version needs the underground view to know where the
  channel is at each row, which is the same boundary-portal work `MAP-07` needs.
- `tools/test-navigation.mjs` traces a crown back to its own stand and root
  across re-entry and verifies that local views and orders are rebound;
  `tools/test-view.mjs` covers the crown → root landing and tier identity. There
  is still no automated round-trip identity test for the geometry or resource
  state a local view rebuilds.
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
- Forest profiling now has a bounded, reproducible software-WebGL harness.
  These samples are not a hardware GPU budget. Authored parts are batched, but
  per-tree transform/material objects remain for tinting and LOD compatibility;
  procedural fallback foliage remains per tree.
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

### 20 September 2026: sections as a player control, and a body with thickness

Turned the fixture's section browser into the player's own control and gave the
fixture's colony a third dimension, so the feature can be judged rather than
just exercised.

- The sheet carries a **Section** panel below ground, centred under the view
  buttons (the left column belongs to the depth rail and the order list, the
  right to the field journal). It names the open section and offers **Previous**,
  **Next**, **Flip**, **Follow**, **Return to forest** and **Surface here**;
  `[` and `]` move, `X` flips, `G` follows, `Escape` rises, and `N` toggles the
  reveal. It appears only while a spatial colony exists, so an ordinary match
  has none of it, and the camera hint names the keys while below ground.
- `CrossingMatch` now drifts each arriving strand a little across the growth
  plane, capped, deterministic from the node's own id, and refused when the
  drifted ground could not hold a hypha. The fixture's colony therefore spans
  about 16 units across the plane instead of one sheet: neighbouring sections
  hold different parts of the body, and the section readout reports 59, 52 and
  18 strands across three adjacent planes rather than one full plane and two
  empty ones.
- Two fixtures of my own tests were corrected rather than the code, and the
  reason is recorded here: the "no seam tax" check compared the destination cell
  with the parent's cell, which is now a genuinely different cell; and the
  reveal's recorded depth now travels with the strand between its ends instead
  of being re-derived from the ground under each sample, because a strand may
  cross a lane where the ground itself steps.

Current checks executed on this implementation:

- `npm run typecheck` and `npm run build` - pass.
- `npm run test:sections` - 10 checks pass in 1.01s; `npm run test:reveal` - 6
  checks pass in 0.90s; `npm run test:crossing` - 11 checks pass in 5.79s;
  `npm run test:spatial` - 18 checks; `npm run test:dressing` - 8 checks.
- `npm run test:feature -- sections --browser` - both headless suites plus **27**
  browser checks pass at `qa=fast` on SwiftShader in 37.3s with no browser or
  shader-compiler errors. The new ones cover: the sheet's own section panel
  existing and naming the open section while a spatial colony exists; the panel's
  **Next** moving one plane; `[` and `]` moving both ways; **Return to forest**
  leaving the section and putting the panel away; `[` opening a section when
  none is; `Escape` rising out of one; and, from the thickening, that stepping
  one plane shows a different part of the same body.

Not verified here: the same suites were not re-run at normal quality, the
compare-sections mode and the match wiring are still open, and the panel's
portrait layout has not been inspected at a narrow viewport.

### 20 September 2026: browsing real sections and the forest reveal

Landed stage 5 and the cheap half of stage 6 of the spatial sequence on the
`?lab=crossing` fixture: `src/render/sections.ts`, `src/render/section-view.ts`,
`src/render/network-reveal.ts`, the camera's pose capture/restore, the fixture's
`colonyEdges()`/`reachedStandIds()`/`browsableStandIds()`, the bench controls and
three suites. The ordinary match is untouched: it has no spatial colony, so it
gets no Network control and no section mode.

What is implemented:

- **Sections are real slabs.** A `SectionSpec` is a vertical plane of finite
  thickness (4 units) in canonical region coordinates, stepping 4 units so the
  sections tile a stand: every strand lies inside exactly one of them. Clipping
  is a parametric slab clip over the plane's faces, the section's extent and its
  depth range, so a strand that crosses the slab with both endpoints outside it
  is drawn, and the points where it enters and leaves are reported as
  continuation marks. Nothing in the section terminates a strand or invents a
  junction.
- **Browsing is a view, not a simulation change.** Previous, Next, Flip, Follow
  and Return move the camera and the clip; the readout names the stand, the
  community, the orientation, the position in the family and the strand count,
  and an empty section says "no network in this section". Browsing is limited to
  stands the colony has reached plus their orthogonal neighbours.
- **The return context is absolute.** The forest pose is captured on the first
  descent as *regional* coordinates plus distance, azimuth, elevation, framing
  mode, selection, tree and reveal state, and converted back through the current
  rebase when restored, so a stand change cannot shift a saved pose twice. Each
  section also keeps its own pose by `standId + sectionId`, so flipping back
  returns to the same view.
- **The reveal is a projection and says so.** Real XYZ edges are sampled onto
  the region's own terrain with a fixed offset; each sample keeps the strand's
  real depth, which drives line weight, and a severed remnant is additionally
  drawn as a double line so it reads without depending on hue. A slice marker
  shows where the last inspected section cuts the ground. Picking is a
  screen-space search with a stacked-strand report and explicit depth; the
  Network button is a real forest control with pressed state, and clicking a
  projected strand opens the exact section through it.
- **Three unambiguous forest picks.** A crown wins outright, then a projected
  strand while the reveal is on, then the ground and its nearest tree. This is
  what lets a strand be clicked at all, since a projection lies on the terrain.

Current checks executed on this implementation:

- `npm run typecheck` and `npm run build` - pass. Production JS is 824.04 kB
  (221.89 kB gzip) plus the 3.10 kB bench and 16.70 kB crossing chunks.
- `npm run test:sections` - 10 checks pass in 0.80s: two families per stand with
  unique stable ids and the plan's four-unit slab; previous/next clamping within
  a family and flipping to the other one; a strand inside the slab keeping its
  own key, parent and child; a strand crossing the slab with both ends outside
  drawn with two continuation marks; a strand beside, below or beyond the slab
  not drawn; an unreached stand's section simply empty; a seam-spanning strand
  drawn once as one segment naming both stands; a point choosing an existing
  section rather than a new one; browsing limited to reached stands and their
  neighbours; and deterministic clipping.
- `npm run test:reveal` - 6 checks pass in 0.81s: detail falls with distance and
  never removes a strand; horizontal positions and recorded depths are the
  simulation's own while the drawn height is the terrain plus the stated offset;
  a seam crossing stays one continuous line straddling the boundary; depth,
  connectedness and reinforcement drive weight monotonically; a click picks the
  nearest strand, reports stacked alternatives and chooses the shallowest of
  them; and projecting changes no simulation state.
- `npm run test:feature -- sections --browser` - both headless suites plus 20
  browser checks pass at `qa=fast` on SwiftShader in 24.9s with no browser or
  shader-compiler errors. The renderer and input checks cover: a colony spanning
  two stands; a real, unpressed Network control in the forest panel; descent
  opening a section with 62 strands and 9 continuation marks and a readout that
  names stand, community, orientation and position; the section holding a strand
  the projection also knows; next/previous; an adjacent section reporting no
  network; flipping; following a strand into the far stand; returning to the
  forest at the same distance, azimuth and elevation with the same selection;
  the Network toggle drawing 293 projected strands and changing nothing about
  the colony; the slice marker naming the last inspected section; clicking a
  projected strand selecting it at its real 23 cm depth and opening its section
  with matching horizontal endpoints; a crown click still selecting the tree
  while the reveal is on; and turning the reveal off leaving the pick targets
  and tree count exactly as they were.
- Captures inspected (ignored paths, regenerated by the command above):
  `design/shots/sections-open-fast.png`, `sections-from-reveal-fast.png` and
  `reveal-forest-fast.png`. The section frame encloses the strand chain, its
  nodes and the continuation marks legibly.
- `npm run test:crossing` - 11 checks pass (the fixture gained its edge and stand
  accessors); `npm run test:spatial` - 18 checks pass; and
  `npm run test:feature -- dressing --browser` - both dressing suites still pass
  after the forest click order changed.
- `npm run test:feature -- water --browser` - 13 checks pass at `qa=fast` with no
  browser errors (66.0s, three added draw calls for the surface water), which is
  the scoped check for the shared fixture bench and the frame loop this
  changeset touched.
- Two defects were found by the renderer check and fixed rather than papered
  over: the projection wrote **region** coordinates straight into the vertex
  buffer, so the drawn strands sat outside the region's own frame while every
  functional check still passed; and the pick path then converted region to
  scene twice, once inside the reveal and once in its caller. The reveal now
  converts once, when the buffers are written, and its `pick()` takes a
  scene-space projector, so the drawn strand and the picked strand cannot drift
  apart. The capture is what caught the first; the click is what caught the
  second.

Not verified, and the honest state of this changeset: the fixture's colony grows
on a single plane, so a section through it reads as a thin band of strands
rather than a volume - a genuinely volumetric colony is the follow-up; the
compare-two-sections mode and the transparent-ground true-depth switch are not
built; the reveal and the section browser are wired to the fixture, not to the
ordinary match (that is stage 7); no profile was run, so the reveal's cost at
scale is unmeasured beyond its one draw call per view; and the wider suites
(`test:view`, `test:journey`, `test:navigation`, `npm test`, `test:region`) were
not re-run, though nothing in `src/sim/` changed and the crossing suite - which
drives the same fixture code - passes.

### 20 September 2026: background forest dressing (`ASSET-04`, `MAP-05`)

Landed `src/render/forest-dressing-layout.ts`, `src/render/forest-dressing.ts`,
`tools/test-dressing.mjs`, `tools/test-dressing-view.mjs`, the `assets.ts`
registry and `batchParts()` additions, and the `?lab=forest` bench controls.
`World.trees` and every simulation number are untouched.

What is implemented:

- **Pure placement.** Candidates are generated in region cells and owned by
  half-open stand bounds, so a tree on a shared edge is emitted once and the
  same seed always produces the same forest. Two low-frequency fields make
  clusters and gaps, spacing is a function of the two crown sizes being placed
  (deliberately below their sum, so neighbourhood crowns close over each other),
  and every decoration is seated on the region's own `heightAt`.
- **Community composition.** Seven community profiles lean canopy density,
  stature, species mix, regeneration, fern, grass, rock and deadwood; a stand's
  own macro field makes two stands of one community differ. The channel, its
  banks and a crown-sized clearing around every playable trunk are excluded
  before a candidate is placed.
- **One layout, cheap drawing.** `forest-dressing.ts` normalises each model part
  once (unit height, base at the origin, authored colour in vertex colours),
  merges an asset's parts into a wood and a foliage geometry, and batches by
  `(tier, asset, category)` with shared materials. A decoration earns its tier
  from its own projected size with hysteresis, falling back to a *coarser* file
  and waiting rather than borrowing a finer one; the tier pass is gated to
  0.35s or real camera movement, and the batches rebuild when a tier file lands.
  Wind is a shader term phased by the instance translation, and reduced motion
  stops the clock.
- **Not pickable, not simulated.** Decorations carry `dressing:stand:index`
  keys, are never added to a surface's `pickTargets`, and have no root tips,
  bonds or stores.

Current checks executed on this implementation:

- `npm run typecheck` and `npm run build` - pass. Production JS is 802.72 kB
  (215.67 kB gzip) plus the 3.08 kB opt-in bench chunk; the Vite chunk-size
  warning is unchanged.
- `npm run test:dressing` - 8 checks pass in 1.09s: identical output for one
  input and a different region for another seed; the playable list order cannot
  change it; no input array or stand is written; a match stepped with the layout
  running between ticks hashes identically to one without it; every decoration
  is owned by the stand its position falls in and each candidate cell yields at
  most one canopy; every decoration sits exactly on `heightAt`; no decoration is
  in the channel or its bank and none crowds a playable trunk; no two
  decorations are closer than their crowns allow and the densest sampled stand
  still has openings over 8 units wide; a denser band plants more; ravines carry
  more conifer and fewer rocks than ridges and clearings are younger; and one
  community can be isolated with the same ground and the same rules.
- `npm run test:feature -- dressing --browser` - both suites pass: 8 headless
  checks and 13 browser checks in 40.0s at `qa=fast` on SwiftShader, no browser
  or shader-compiler errors. The renderer checks cover: the region opens with
  dressed scenery across all nine stands; background trees open at LOD2; turning
  the scenery off removes no pick target and keeps the playable population;
  clicking four points among the scenery only ever selects a tree the selector
  itself lists; one community can be isolated and the rest of the region stays
  planted; and the fast preset plants exactly the same forest as normal.
- Measured cost at `qa=fast`, SwiftShader, seed `raven-wood`, 1200x800 CSS with a
  600x400 drawing buffer: at the region overview with the default `medium` band
  the dressing draws 568 background trees in **12 draw calls** and **143,548
  triangles** (all LOD2, every declared tier loaded); at the fixture's community
  pose the `sparse` band draws 287 trees in 12 calls and 72,354 triangles and
  the `dense` band draws 852 trees in 12 calls and 215,076 triangles. The
  scenery adds 12 draw calls to the 53-65 the forest already drew at that
  camera, so cost scales with tiers and assets rather than with tree count.
- Captures inspected (ignored paths, regenerated by the command above):
  `design/shots/dressing-region-fast.png` and
  `design/shots/dressing-community-fast.png`. The overview now reads as
  continuous woodland with visible clearings instead of scattered trees, and the
  close-up shows overlapping crowns with hemlocks and saplings mixed in.
- `npm run test:assets` - pass: 21 assets, 39 GLBs, 1,266.7 KiB, with every
  registry id present in the manifest.
- `npm run test:feature -- water --browser` - 13 checks pass at `qa=fast` with no
  browser errors (68.8s). That is the scoped check for the shared fixture bench,
  which now carries the forest panel as well as the water one.

Not verified, and the honest state of this changeset: `test:view`,
`test:journey`, `test-navigation`, `test:sim` and `test:region` were not re-run
(nothing in `src/sim/` changed, and the renderer checks above cover what moved);
the understory and deadwood layers are placed but not drawn; the old uniform
grass and litter scatter is still there; the ground is still the striped
`VIEW-08` recipe; the density band and background LOD thresholds have not been
tuned on hardware, and no profile was run; and the scenery's cut-away on
descent has not been inspected through a full crossing.

### 20 September 2026: one colony across one stand edge (`MAP-07` stages 3-4)

Landed `src/sim/crossing.ts` and `tools/test-crossing.mjs`, and wired the
headless `?lab=crossing` bench entry. This is the two-stand fixture the staged
specification asks for before any section or reveal UI: one colony, one section
plane, one shared edge.

What is implemented:

- **One body.** `CrossingMatch` owns a single `Network` whose growth plane is the
  region's width rather than one stand's transect. Crossing the seam changes a
  strand's stand bucket and nothing else: no `foundColony`, no `createNetwork`,
  no second root, no per-stand node budget. `Network.bounds` carries the colony's
  own horizon, so an order can be sent past a boundary without the stand it
  happens to be standing in clamping it.
- **One economy.** The fixture runs `stepNetwork` unchanged, over a
  `CrossingWorldView` that resolves a growth-plane cell to the region's own
  voxel. The tree-demand rules were extracted from `Simulation.stepTrees` into
  `network.ts` (`bondedJunction`, `drawTreeDemand`, `starveBondedTree`) so the
  flat transect and the spanning colony trade with their partners by one copy of
  the same arithmetic.
- **One pipeline.** Per tick: regional environment and one `SoilVolume.step`;
  then, per colony in stable id order, tree demand and trade, `stepNetwork`
  (connectivity, intake, transport, respiration, growth, decay, fruiting,
  totals), then activation of any stand the colony has just reached. Nothing
  reads a camera, a view slot or a render origin.
- **Seam records are derived, not stored.** `portals()` reads the real graph: a
  pair of parent/child strands in different stands, with the seam coordinate and
  the edge direction. There is no portal object, reservoir or teleporter.

Current checks executed on this implementation:

- `npm run typecheck` and `npm run build` - pass. Production JS is 787.68 kB
  (210.53 kB gzip); the crossing fixture is code-split into its own 15.85 kB
  chunk plus a 1.64 kB bench chunk, so the ordinary bundle carries only the
  coordinates and the world interface.
- `npm run test:crossing` - 11 checks pass in 5.20s. The fixture funds one colony
  beside one shared edge; a tip grows across the seam in 6.03s of ordinary
  stepping, with the same root, the same tip ceiling and an unbroken parent walk
  back to the founder; the destination voxel is priced identically from either
  side of the seam and costs one ordinary entry, not a colony tax; arriving in a
  cell adds a whole hyphal load and nothing else once thickening is accounted
  for; water and mineral are conserved exactly across the seam once stores are
  inside their working caps; a bonded tree in the far stand pays the same
  connected body more than a severed control run; cutting every seam-spanning
  strand leaves the far tissue standing, severed, disconnected and losing
  health; a cord pays its charge and carries more; a flooded target is refused
  before commit; all four edge directions cross from the centre stand and a
  corner step is tested on every square meeting there; and a run that samples
  two sections every tick hashes identically to an unwatched run.
- `npm test` - 10 checks pass with unchanged numbers (`raven-wood` 2 blooms, 480
  spores, 354s, 198 living strands). The tree-trade extraction and the
  `NetworkWorld` refactor did not move the verified journey.
- `node tools/test-region.mjs` - 18 checks pass, unchanged.
- `node tools/test-water.mjs` - 5 checks pass, and
  `npm run test:feature -- water --browser` - 13 checks pass at `qa=fast` with no
  browser errors (69.7s, `added=3` surface water draws), which is the scoped
  check for the async bench entry. The preserved water changeset still behaves.

Not verified, and the honest state of this work: the running game still steps
one local `Simulation` per colonized stand, so a played match has no spanning
colony; the fixture holds horizontal `y` constant and browses one plane; no cord
has been laid across a seam in play; the destination stand's trees are generated
by its own transect world while the colony's material comes from the shared
volume, so two soil models still coexist; and nothing is drawn from the fixture.

### 20 September 2026: the shared soil volume (`MAP-14` stage 2)

Landed `src/sim/soil-volume.ts` and the region-aware world interface the fixture
needs, with stage-2 checks added to `tools/test-spatial.mjs`.

- **One material field.** Strata, organic matter, minerals and hardness are pure
  functions of global coordinates, so a stand id cannot change a sample and a
  shared boundary agrees from either side. Strata come from the same horizon
  profile and depth warp the transect uses.
- **Sparse state.** A voxel earns a record only when the simulation writes to
  it. `sample` and `sampleSection` never materialise anything, so browsing a
  slice cannot move the state hash; `step` advances the changed voxels in
  canonical key order on the soil's own cadence and returns how many it visited.
- **One water surface.** `waterTableDepthCm` and `groundwaterElevationAt` derive
  a continuous regional groundwater elevation from the generator's own water
  field plus the season's offset, and the stream is a distance-to-course query
  with the bed a little below the live table, replacing the mean-column
  obstruction on the spatial path.
- **Whole-segment queries.** `segment` walks every voxel between two points with
  the supercover traversal, so a diagonal or long step cannot tunnel through
  thin stone, saturated ground, the stream or a stand corner.

Current checks executed on this implementation:

- `npm run typecheck` - pass.
- `npm run test:spatial` - 18 checks pass in 0.27s: the 11 stage-1 coordinate
  checks, then the versioned volume with a zero-offset season; a seam sample that
  agrees from either stand and is continuous across it; 400 samples plus two
  sections leaving the hash and the materialised count untouched; two different
  sections reporting the same depletion and occupancy in one shared voxel; the
  real course reading as the channel, a segment refused as `stream` from either
  direction, saturated ground refused as `groundwater` while the fringe above it
  is reachable, and a long diagonal refused at a crossed cell; the seasonal
  offset deepening the whole water surface by one rule; and a step visiting only
  the changed voxels, in order, with an identical twin run.

Not verified: nothing in the running game reads the volume yet, its organic and
mineral regrowth is not yet shared with the transect worlds, and no save format
exists to carry `SOIL_VOLUME_VERSION`.

### 20 September 2026: shared spatial coordinates (`MAP-14` stage 1)

Implemented `src/sim/spatial.ts` and `tools/test-spatial.mjs`. Nothing in the
running game reads the new module yet: this changeset is the coordinate contract
the rest of the staged migration is written against, and it adds no second
economy and no renderer change.

What the contract fixes:

- `x`/`y` are horizontal regional coordinates matching `Region.heightAt`; `z` is
  absolute elevation, positive upward, and depth is always derived as
  `(heightAt(x, y) - z) * GRID.cmPerRow`. A stored depth can therefore never
  drift from the ground it was measured against.
- Stand ownership is half-open: the seam belongs to the eastern or southern
  square, coordinates outside the region are invalid rather than clamped, and
  all four edges of a square report the same coordinate from either side.
- `NodeRef`, `TreeRef` and `RootTipRef` are the stable references. Local numeric
  tree and node ids collide across stands, which is why the region needs these
  before any regional view can address a strand.
- `traverseSegment` is a supercover traversal: a segment that runs through an
  edge or a corner reports every cell meeting there, so a diagonal step cannot
  tunnel past a shared boundary or a thin obstruction.
- `toRender`/`fromRender` are the only place the simulation's axes are
  re-expressed for Three.js, with vertical exaggeration confined to the adapter
  and undone by its inverse.
- `treeLocalOffset` moves the seeded placement the forest already draws out of
  `src/render/surface.ts` and into the simulation, using the same generator and
  the same formula, so every tree keeps the exact place it stood on screen.

Current checks executed on this implementation:

- `npm run typecheck` - pass.
- `npm run test:spatial` - 11 checks pass in 0.16s: the version and voxel
  resolution; half-open ownership including negative, non-finite and
  out-of-region positions; all four edges resolving to one seam from both sides;
  depth/elevation round trips and a seam that does not move the ground; the
  render adapter inverting exactly with and without vertical exaggeration;
  global voxel keys; supercover diagonals and corner crossings; a segment that
  leaves the region; the seam each cross-boundary segment actually crosses; the
  seeded tree placement matching the raw generator; a tree and root tip keeping
  matching coordinates in the forest and section projections with a real 3D
  bonding distance; and reference keys that distinguish two stands' tree 3.

Not verified: nothing renders from these coordinates yet, `src/render/surface.ts`
still computes its own placement, and no save format exists to carry a
`SPATIAL_VERSION`.

### 20 September 2026: fuller-forest planning only

Inspected the current floor colour/scatter implementation, playable-tree
placement, regional tree batching, available asset manifest and QA presets.
Added the fuller-forest implementation sequence and Planned entries
`ASSET-04`/`VIEW-08`. Background vegetation is explicitly presentation-only;
existing `MAP-05`, `ASSET-03` and `PERF-02` gaps remain open until implemented
and checked. This update changes only PROJECT_STATUS.md. No builds, tests,
asset generation or runtime changes were performed.


### 20 September 2026: spatial-growth planning only

Read the current regional coordinator, local network assumptions, tree
placement, camera rebasing and feature register. Added the staged
cross-stand/section/reveal specification and Planned entries `MAP-14`,
`VIEW-06`, `VIEW-07`; `MAP-07` remains Partial with no new implementation claim.
This update changes documentation only. No builds or tests were run.


### 20 September 2026: flowing water, saturation barrier and direct feature testing

Affected: `MAP-02`, `MAP-04`, `PERF-02`, `QA-01`. Water uses an analytic
fragment shader on the existing Three.js basic-material pipeline, retaining
fog, colour conversion and overlay opacity. No water textures, reflection
passes or render targets are added. Surface banks, the flow ribbon and all
brook stones take three draw calls in total; underground water uses two planes
in a crossed stand. The shader clock is independent of simulation speed, stops
when the water is hidden, and follows ambient/reduced-motion settings.

The shared simulation rule exposes an 8 cm capillary fringe. Ground below the
live table refuses new growth, including a paid target reached just as the
water rises. Existing flooded strands persist and can resume after recession;
oxygen-driven damage remains unimplemented. Stream bed soil is no longer
unconditionally passable. The old 19 September under-bed test was updated to
assert soil identity and saturated refusal separately.

Current checks executed on this implementation:

- `npm run typecheck`, `npm run build`, and the build/typecheck route through
  `npm run test:feature -- views` pass. Main JS: **783.73 kB / 209.03 kB gzip**;
  opt-in lab chunk: **1.14 kB / 0.65 kB gzip**. Existing chunk-size,
  Browserslist-age and Tailwind-content warnings remain.
- `npm run test:feature -- water`: **5 focused headless checks**, **0.33 s**
  in the dispatcher run. They exercise smooth fringe values, exact boundary
  access, channel/bed behavior during recession, specific refusal wording,
  funded growth to the fringe and a paid target invalidated before commit.
- `npm test`: **10 checks pass**, including complete public-order journeys on
  `raven-wood` (354 s simulated), `old-growth` (652 s), and `ironwood` (354 s);
  each finishes with two blooms and 480 spores, plus determinism, conservation,
  trade, severing, fruiting supply and outcome guards.
- `node tools/test-region.mjs`: **18 checks pass**, including wet banks,
  stream geometry, groundwater refusal, region determinism and colony funding.
- `node tools/test-water-view.mjs --qa fast`: **13 checks pass**, no browser or
  shader errors, **69.3 s** including additional fixture loads. Covers rendered
  pixel changes in both views, water draw count, actual system reduced-motion
  changes, keyboard depth control, region/growth fixtures, fixed-step advance
  and ordinary entry isolation. CSS viewport **1200x800**, buffer **600x400**,
  SwiftShader software WebGL. The first expanded run exposed an asynchronous
  media-query test race; the harness now waits for the real motion control to
  acknowledge the preference before checking frozen shader time.
- `npm run test:feature -- views`: **9 smoke checks pass**, no browser errors.
  Actual selector, descent and return work at fast quality, **1200x760** CSS /
  **600x380** buffer, SwiftShader.
- Normal-quality water: the initial focused run passed **10 checks**, no
  browser errors, in **46.6 s** at **1200x800** on SwiftShader. The expanded
  final run visibly passed through the region/fixed-step checks and exited
  with code 0; its final summary was lost when the turn was interrupted, so
  no additional timing or check-total claim is made for that run. Surface
  water added exactly **3 draw calls** in both normal and fast captures.
- Visually inspected direct canvas captures in both views at normal quality
  and the full bench screenshot at fast quality. The first underground capture
  exposed a bright rectangular bed; its side and bed masks were softened and
  the result reinspected. Captures are ignored files under `design/shots/`.
- The Impeccable detector reported advisory existing type-ramp differences and
  the new rock colour. The new bench background was changed to an existing
  token; natural-water/rock colours and motion are now documented in DESIGN.

Not run: the complete view, navigation or browser player-journey suites; the
focused water suite, view smoke and full headless match regression are the
scope of this verification. Hardware GPU frame-time profiling is still absent:
three draw calls establishes bounded draw work, not a measured FPS claim.
The in-app browser could not initialize (sandbox metadata error); verification
used the repository's existing Playwright harness instead. Other full feature
suites still need subdivision; the dispatcher exposes them without claiming
all are sub-second.

20 September stopping instruction: the user requested completion to conserve
the five-hour usage allowance and explicitly requested **no full tests**.
No further tests were started after that instruction. No water-test or its
preview-server Node processes remained at the final process check. Changes
are uncommitted and unpushed.

The later user request supersedes the water-polish next step: use the
cross-stand spatial-growth implementation sequence in Current priorities.
Preserve the completed water changes. The no-full-tests instruction remains
in force; hardware timing and subdivision of other suites remain separate
follow-ups.

### 19 September 2026: the stream, above and below

The region's stream is drawn in both views and is a real constraint below
ground. `src/sim/region.ts` gives each stand the stream's own cross-section
(`StandSite.stream`), `src/sim/world.ts` carves it into that stand's transect
(`SoilCell.stream` for the open channel, `SoilCell.streamNear` for the damp
bank), `src/sim/network.ts` refuses hyphae the channel while leaving the ground
under the bed passable, and `src/render/water.ts` draws the ribbon above ground
and the channel and water table below. Growth orders now carry their own words —
`Simulation.growTo` — so the sheet can say the point is the stream rather than
blaming stone, and both the founding spore and the rival's first strand step out
of the water onto the nearest bank instead of starting in it.

Verified on this tree:

- `npm run typecheck` and `npm run build` pass. Production JS is 773.05 kB
  (205.40 kB gzip).
- `node tools/test-region.mjs` — 18 checks pass, including the two new ones.
  The first: the channel exists in the stand the region says the stream crosses,
  is as wide as the region says, is drawn at the stream's own column, stops at
  its bed rather than running to the bottom of the map, refuses hyphae at the
  surface, and leaves the ground under the bed passable. The second: the bank
  holds measurably more water than the same depth far from the channel, an order
  into the water is refused by name, and forty seconds of growth put no strand
  in the channel. Both were run after the simulation changes; the later edits
  were the renderer's report field and the browser checks.

Not verified, and the honest state of this changeset:

- **The browser checks for the water have never been run.** A new section 9 of
  `tools/test-view.mjs` funds a colony in a crossed stand, descends into it, and
  asserts that the drawn channel matches the simulation's own channel count and
  column. It is written, not executed, and no capture of the stream or of the
  underground channel has been inspected — so the ribbon's width, the notch's
  darkness and the water-table shading are visually unjudged.
- `node tools/test-sim.mjs` was not run to completion after this change; it was
  stopped to save time. The standalone prototype stand is built without a
  region, so it has no stream by construction and its journeys should be
  unchanged — an argument, not a result.
- The underground channel is a single mean column per stand rather than a true
  course; see the known limitations for what that means and what would fix it.

### 19 September 2026: regional survey layer (`MAP-11`)

The forest gained its survey. `S`, or **Survey the region**, opens a printed
ledger of the nine stands in the sheet's own field-record language — a record,
not a minimap. `src/sim/survey.ts` projects the match into that record with no
RNG, no mutation and no renderer, so the sheet cannot disagree with the
simulation; `src/ui/survey.ts` prints it.

- Each line carries the stand and its community, whether a colony holds it, its
  water-table band and depth, its broad forest health band and standing-tree
  count once a colony has held it, the stand it was founded from, and whether
  every colony still connects to the founding stand. Ground never held prints
  "not surveyed beneath" rather than a guessed health figure.
- The recorded route and the live connection are separate facts. A colony behind
  a dead link prints as occupied with "lineage severed", while the lineage still
  shows the stands that were actually founded: the walk reads arrival records
  for history and checks every link for aliveness.
- Choosing a line selects that stand through the same `selectStand` path as the
  selector control. The page covers the sheet's reading matter while it is open
  (`body.survey-open`) and leaves the forest controls live, so choosing a stand
  and exploring beneath it is one move. It closes on `Escape`, the close action
  or `S` again.

Verification on this tree:

- `npm run typecheck` and `npm run build` pass. Production JS is 768.26 kB
  (203.82 kB gzip).
- `node tools/test-region.mjs` — 16 checks pass. The three new ones cover: every
  stand is reported and unheld ground carries no underground record; a funded
  daughter appears with its parent, hop, germinating state and lineage; and a
  colony behind a dead link is occupied, disconnected and non-contiguous while
  its recorded route survives.
- `node tools/test-navigation.mjs --qa fast` — 23 checks pass, no browser errors.
  The seven new ones cover: the ledger opens with one line per stand; the summary
  states holds, lineage and continuity; a held stand prints its colony state and
  parent stand; a surveyed stand prints a health band and tree count; unheld
  ground prints as not surveyed beneath; choosing a line selects that stand and
  marks it; and `Escape` closes the page. A portrait check keeps the page on
  screen at 390×844.
- `node tools/test-view.mjs` at the normal preset — 69 checks pass,
  `PROBLEMS: none`. The survey wiring disturbed no crossing, framing, input, tier
  or tier-swap check. That run, and the `test-journey`, `test-region` and
  `test-batches` runs below, were taken before the last two lines of this
  changeset: `SurveySheet` no longer moves focus when the page opens or closes,
  because the auto-focused close action drew a focus box the sheet's language
  does not use. No check in those suites opens or closes the survey, and
  `test-navigation` and `typecheck`/`build` were re-run after the change (23
  checks). The other four suites were not re-run on the final source; nothing
  they exercise opens or closes this page.
- `node tools/test-journey.mjs --accelerated` — 13 checks pass at the normal
  preset; `node tools/test-batches.mjs` — 3 groups pass.
- Captures inspected: `design/shots/regional-survey.png` and
  `design/shots/regional-survey-portrait.png` (ignored paths; the numbers above
  are the durable evidence). The page was re-cut after the first capture, where a
  radial backing left the ledger fighting the field journal for legibility; it
  now uses the flat sheet tone the outcome block already uses.

Not verified: infection and water-feature fields (no such simulation state
exists yet), fog of war finer than held-versus-unheld, network sensing, and the
page during a live crossing or with more than a handful of occupied stands.

### 19 September 2026: regional exploration and forest batching

Regional travel, wood/foliage batching and the funding repair were verified on
the finished tree as a whole. Every command below ran after the last edit in
this changeset; the partial runs recorded while the work was in progress are
superseded by these results.

- `npm run typecheck` and `npm run build` pass. Production JS is 762.97 kB
  (202.21 kB gzip); the nonfatal Browserslist, Tailwind-content and chunk-size
  warnings remain.
- `node tools/test-navigation.mjs --qa fast` — 14 checks pass, no browser
  errors: uncolonized ground refuses descent, the stand selector rebinds the
  simulation and every local view, the catalogue shows the daughter's own
  reserves, orders touch only the active colony, a crown returns to its own
  stand and root, the daughter advances while another stand is viewed, re-entry
  keeps its orders, repeated travel releases the previous local views and soil
  geometry, normal-motion descent crosses on the wall clock, an outer stand pans
  without clamping back to the founding stand, keyboard zoom enters the selected
  stand, batched IDs survive travel and tier swaps, and the stand controls fit
  the portrait viewport. This is an explicitly funded two-colony fixture, not a
  whole match played through the interface.
- `node tools/test-batches.mjs` — 3 groups pass: independent transforms, colours
  and `stand:tree` identities through capacity growth; tier migration and stand
  hiding dropping old slots without losing identity; re-entry restoring hidden
  stands without drawing the original copies.
- `node tools/test-region.mjs` — 13 checks pass, including one shared regional
  season across colonized and dormant stands, funding debited from real node
  stores with an atomic refusal that charges nothing, off-screen growth,
  watched-versus-unwatched determinism over two minutes, and same-seed
  colonization. The older checks mistook summary counters for separate reserves;
  the funding checks now inspect node stores and the next simulation tick.
- `npm test` — 10 checks pass, including a full public-order journey on
  `ironwood` (2 blooms, 480 spores, 354 s, 190 living strands) and the
  determinism guard. `JOURNEY_SEEDS=raven-wood REGIONAL_JOURNEY=1 node
  tools/test-sim.mjs` — 8 checks pass with a regional match behind the same
  journey (raven-wood, 2 blooms, 480 spores, 354 s, 198 living strands).
- `node tools/test-journey.mjs --accelerated` — 13 checks pass at the normal
  preset, driven through the sheet's own controls and ending in a fresh sheet.
- `node tools/test-view.mjs` at the normal preset — 69 checks pass,
  `PROBLEMS: none`. This closes the normal-quality pass the LOD entry below had
  left owed: all 12 tier files load, the overview draws 0 / 57 / 18, a focused
  crown refines the stand to 75 fine trees, a close camera draws 44 / 31 / 0,
  all 75 `stand:tree` keys survive, 56 of 56 tier swaps preserve placement, and
  every crossing, framing, viewport and input check passes at shipping quality.
- `node tools/profile-forest.mjs` at the normal preset (960×640, SwiftShader
  software backend, 13th Gen Intel i7-13700HX, 16 GiB) — opening median 723.6 ms
  and p95 777.3 ms; a 180-second steward-grown forest median 752.0 ms and p95
  809.1 ms; both 183 draw calls and 322,014 triangles. The authored trees are 12
  batched draws over 150 parts carrying 75 stable identities. These are
  software-rasterizer numbers with a GPU readback included, so they bound this
  backend rather than a desktop-GPU budget.

Not verified in this changeset: regional spore release through the real fruiting
UI (the navigation fixture funds its colony directly), connected water and
exposed rock rendering, cross-stand cords, an atlas, distant-stand simulation
cadence, and hardware-GPU performance. The regional victory objective is still
open design.

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

The normal-quality pass this entry originally left owed is recorded in the
regional entry above: `node tools/test-view.mjs` at the normal preset passes 69
checks with these same tier counts, and `node tools/profile-forest.mjs` now
measures the resulting draw calls and frame times on this backend. `ASSET-03`
remains Partial: authored wind clips, a general dropped-in-file validator,
camera transition tuning, crown anchors, dead variants and the loader
failure/late-load paths are still open.

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

### 20 September 2026: sections as a control, and a body with thickness

- Moved the section browser out of the test bench and into the sheet: a
  **Section** panel below ground with Previous, Next, Flip, Follow, Return to
  forest and Surface here, plus `[`, `]`, `X`, `G`, `Escape` and `N` on the
  keyboard. It exists only while a spatial colony does, so an ordinary match
  gains nothing (`VIEW-06`).
- Made the fixture's colony drift a little across its growth plane as strands
  arrive, so the body has thickness: neighbouring sections hold different parts
  of the colony rather than one plane and a row of empty slabs.
- Kept the open section's selected strand inside that section, so Follow always
  has something visible to follow, and carry the reveal's recorded depth along
  the strand instead of re-deriving it from the ground under each sample.

### 20 September 2026: sections and the forest reveal

- Added `src/render/sections.ts`: pure `SectionSpec` vertical slabs in region
  coordinates, slab clipping that keeps a strand passing through with both ends
  outside it and reports its continuation marks, two families per stand, and
  previous/next/follow/flip navigation (`VIEW-06`).
- Added `src/render/section-view.ts` and the fixture's section browser: the
  clipped strands, their nodes, the continuation marks and the framed window,
  with a readout naming stand, community, orientation, position and strand
  count, and an honest "no network in this section" for an empty one.
- Added the forest return context: the pose is captured on descent in absolute
  regional coordinates with the selection and reveal state, each section keeps
  its own remembered pose, and returning restores the same forest view.
- Added `src/render/network-reveal.ts` (`VIEW-07`): the real XYZ edges projected
  onto the region's terrain with depth-weighted line weight, a double line for a
  severed remnant, a slice marker for the last inspected section, and
  screen-space picking that reports stacked strands instead of guessing. The
  Network control is a real, keyboard-accessible forest button that only exists
  while a spatial colony does.
- Made the three forest picks unambiguous - crown, then projected strand, then
  ground - which is what lets a projection lying on the terrain be clicked at
  all, and guarded pointer capture so a stale pointer cannot wedge the input.
- Added `npm run test:sections`, `npm run test:reveal` and
  `test:feature -- sections` with a bounded browser smoke.

### 20 September 2026: background forest dressing

- Added a pure, seedable region-wide layout for the forest's background
  vegetation (`ASSET-04`, `MAP-05`): half-open stand ownership, clusters and
  gaps from a low-frequency density field, crown-size spacing, seven community
  profiles, and exclusion masks for the stream, its banks and the playable
  crowns (`src/render/forest-dressing-layout.ts`).
- Added `src/render/forest-dressing.ts`: normalised per-asset wood and foliage
  geometry drawn as `(tier, asset, category)` instance batches, per-decoration
  projected-size LOD with a coarse-first fallback, a shared wind shader,
  season tint on instance colours, and no per-frame matrix work. The scenery is
  never a pick target and never a simulation tree.
- Exposed the delivered saplings, fern, grass, boulder and snag in the asset
  registry, and added `AssetLibrary.batchParts()` so scenery can share an
  asset's geometry instead of cloning an object per tree.
- Extended the `?lab=forest` bench with dressing on/off, the three density
  bands and a community selector, and added `npm run test:dressing` plus
  `test:feature -- dressing` with a bounded browser smoke.
- Recorded the measured cost (568 background trees in 12 draw calls and 143,548
  triangles at the region overview) and left the density band, the background
  LOD thresholds, the undrawn understory layers and the striped ground as the
  next work.

### 20 September 2026: shared spatial coordinates and one real crossing

- Added the simulation's shared spatial coordinates (`MAP-14` stage 1): regional
  `x`/`y`, absolute `z` with derived depth, half-open stand ownership, stable
  node/tree/root-tip references, a supercover segment traversal and an invertible
  render adapter; the seeded tree placement moved out of the surface renderer
  into simulation-owned data (`src/sim/spatial.ts`, `npm run test:spatial`).
- Added one queryable regional soil volume (`MAP-14` stage 2): an analytic
  material field over global coordinates so a stand id cannot change a sample, a
  sparse map of changed voxels advanced in stable key order, a continuous
  regional groundwater elevation, a distance-to-course stream query and
  whole-segment traversal that cannot tunnel past a crossed cell
  (`src/sim/soil-volume.ts`).
- Grew one colony across a real stand boundary (`MAP-07` stages 3-4) in the
  headless `?lab=crossing` fixture: one graph, one node budget and one set of
  stores on both sides of the seam, portals derived from real parent links,
  conserved cross-seam transport, a remote bonded partner that pays the same
  body, and severance that starves the far side without erasing it
  (`src/sim/crossing.ts`, `npm run test:crossing`).
- Put every network world lookup behind one interface so the flat transect and
  the spanning colony run a single economy, and fixed growth bounds that were
  only one stand wide (`Network.bounds`).
- Section browsing (`VIEW-06`) and forest reveal (`VIEW-07`) were not started.
  The ordinary match still steps one local transect per colony and still draws
  the flat transect; promoting the fixture's coordinator into `RegionalMatch` is
  the next gate.

### 20 September 2026: serene water and focused testing

- Added slow flow shaders, soft groundwater/channel gradients, rounded brook
  bends and instanced stones (`MAP-02`, `MAP-04`).
- Made the live table stop extension while retaining a reachable wet fringe;
  rising water also invalidates paid targets before they commit (`MAP-04`).
- Added an opt-in fixture bench and a feature-suite dispatcher with automatic
  builds for browser checks, plus scoped water regression (`QA-01`).
- Retained partial status for broader hydrology and hardware performance gaps.

### 19 September 2026: regional travel and forest batching

- Added the region's stream to both views (`MAP-02`, `MAP-04`): a wet bank and a
  water ribbon on the forest floor, and beneath it a channel hyphae cannot enter,
  a bank that feeds them, a passable bed underneath and a water table shaded as
  a saturated horizon that follows the season. Growth orders now name the stream
  when they refuse a point.
- Added the regional survey layer (`MAP-11`): `src/sim/survey.ts` projects the
  match into a per-stand record of holds, water, health, parentage and lineage
  continuity, and `src/ui/survey.ts` prints it as a ruled ledger opened with `S`.
  Browser checks cover the ledger, its knowledge rules, selection and portrait
  layout; the product direction now states that every stand tile has its own
  underground transect and that cords must be able to grow across shared edges.
- Connected Game to RegionalMatch while retaining the existing founding opening;
  added stand survey, persistent local view rebinding, isolated orders, crown
  return, colonization notices and continuation into daughter stands.
- Repaired regional funding to transfer real connected carbon, water and mineral
  stores into usable daughter nodes, with atomic affordability and next-tick tests.
- Shared regional seasons now continue across uncolonized and completed stands;
  regional camera bounds follow the full forest when its local origin changes.
- Batched authored wood/foliage across stands and retained stable identities,
  transforms, health, seasonal tint and sway through tier changes. Omit the
  closed underground soil at the fully surfaced endpoint.
- Added focused navigation/batching checks and bounded GPU-readback profiling.
  Synthetic view checks can advance state without drawing every intermediate
  frame; actual visual/input checks still use the requested rendering preset.


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
