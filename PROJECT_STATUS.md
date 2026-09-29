# Mycelia â€” authoritative project status and feature log

Last updated: 29 September 2026.

This is the **single source of truth for implementation status, current
priorities, verification, and future work**. Read this file before changing the
project. `PRODUCT.md` defines product intent, `DESIGN.md` defines the visual
system, and `mycelium-rts-outline-spec.md` is the original game specification.
Those documents do not replace this implementation record.

Do not create another implementation plan, roadmap, status report, or handoff.
Update this file instead. Historical explanations belong in git history.

## Status vocabulary

Use exactly these labels in the feature register:

- **Verified** â€” implemented and exercised by an appropriate automated or
  browser check whose evidence is recorded below.
- **Implemented, unverified** â€” present in code but its complete acceptance
  behavior has not been exercised.
- **Partial** â€” useful behavior exists, but named requirements remain.
- **Planned** â€” agreed work with no meaningful implementation yet.
- **Deferred** â€” deliberately outside the current milestone.
- **Blocked** â€” progress requires a named external decision or dependency.

Never mark a feature Verified because it compiles, renders once, or has some of
its visual ingredients. Record remaining gaps beside every Partial item.

## Current snapshot

The interface now follows the supplied forest-and-rings reference: a quiet
right-side instrument with complete carbon/water/nitrogen rings, Grow/Share/Rest,
and expandable guidance, controls and readings. Ring brightness compares
connected reserves to base growth costs; it does not imply a global maximum.
Exact quantities are available on hover/focus. A single fungal body can learn
six milestone-earned adaptations across Exchange, Resilience and Fruiting,
then invoke three contextual powers after its first bloom. No playable faction
split was introduced. See `TECH-01`, `TECH-02` and `UX-04` below.

The adaptations and powers now have authored icons (29 September). The tech
dialog is icon tiles with names; each entry's text is in a hover or focus
popover. See `TECH-05`.

**Summon storm** (`TECH-03`, Partial) now works end to end: a player-chosen
wind direction, a shared warning countdown, and a limited storm window in which
prepared fruiting bodies disperse farther downwind and found several paid
daughter colonies, with a swirling vortex, lightning and windfall. It is the
first of three region-scale ecological superpowers (`TECH-06`). **Wildfire**,
the third, now works end to end too: a chosen-direction front that burns
crowns, shallow strands and fruiting bodies for every colony, spares deep cords
and wet ground in ordinary wind, and leaves ash that fruits in any weather.
Summoning a storm into a running fire sends hurricane embers across the region
before the heavy rain quenches it. **Drought** works end to end as well: the
rain stops, land cracks away from the stream, unfed
trees wither while trees your mycelium supplies hold, shallow strands dry out,
and fruiting halts.

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

The opening local transect now reads and writes a slice of the regional soil
volume from its first tick. Its nodes carry regional XYZ and stand ownership
from the founding spore. Promotion with **Grow through a stand edge** leaves
their addresses, physical positions, soil records, resources and parent links
in place. A wind-borne spore pays for and founds a separate spatial graph
on that same soil, with no strand or resource connection to its parent. Each
graph steps once per tick. Underground sections are available in all nine
stands, including empty ones, and a stand selector moves between them; the
forest reveal shows the selected graph. Regional growth orders can target any
passable XYZ from either section orientation; strands test intervening 3D soil.
Simultaneous reveal of multiple graphs, comparison views and player-directed
fusion remain open.

Underground section browsing now follows a continuous corridor through interior
stand boundaries. Previous/Next crosses into the next stand, dragging along a
section follows the cut through its neighbour, and soil and visible strands no
longer end or change brightness at a stand line. Entering a section and rising
back to the forest use the timed crossing, including Surface here. Nearby soil
slices are reused when stepping back; frame geometry is rebuilt only when the
section or its camera window changes. The focused checks below cover the flow;
broader repeated-rebase and hardware performance checks remain open.

The forest now draws background canopy, regeneration, ferns, grass, rocks and
deadwood from the same seeded regional layout (`ASSET-04`). The medium band
has a nominal 80 canopy trees per stand, taller crowns and community-specific
gaps. Scenery has no simulation identity or picking. A continuous regional
habitat field and seasonal ground shader replace the striped floor (`VIEW-08`),
with litter pockets, moss, damp banks, canopy darkening and matching edge
normals. Oak, birch and hemlock use distinct seasonal palettes (`ATM-04`).
Authored winter leaf drop and hardware performance tuning remain unfinished.

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
rocks. The six existing runtime paths carry the new art, the runtime registry
exposes the saplings, fern, grass, snag, boulder and all four reproductive
bodies under their manifest ids, and the three tree species select their own
tier from projected size on screen. Three of the four reproductive bodies now
carry the player's eruption in both views; the truffle-type body is held for the
truffle species rather than miscast as a stage of the player's own loop.
Seasonal tint and the underground environment remain procedural.

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
- The signature movement is **forest â†’ tree â†’ forest floor â†’ roots â†’ mycelium**,
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
  living partnersâ€”not conventional ranged combat or unit armies.
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
| Region | `src/sim/region.ts` | The 3Ã—3 stand mosaic: one heightfield, drainage and streams, water table, communities, adjacency, wind, seed validation |
| Regional match | `src/sim/match.ts` | Fixed-order stand ecology, one shared soil volume, paid spore founding as independent spatial graphs, and physical growth crossings recorded separately |
| Shared spatial coordinates | `src/sim/spatial.ts` | Regional `x`/`y`, absolute `z` and derived depth; half-open stand ownership; stable node/tree/root-tip references; supercover segment traversal; the invertible Three.js adapter; simulation-owned tree placement (`MAP-14` stage 1) |
| Regional soil volume | `src/sim/{soil-volume,shared-soil}.ts` | One analytic material field and sparse changed voxels; local transects are lazy read/write projections of it, including the opening and spore daughters (`MAP-14`) |
| Spatial coordinator and crossing fixture | `src/sim/crossing.ts` | One graph and economy over shared soil, using either a funded fixture or the ordinary match's existing body and persistent trees |
| Background placement | `src/render/forest-dressing-layout.ts` | Pure, seedable region-wide placement of non-interactive canopy, regeneration and ground cover: ownership by half-open bounds, clusters and gaps, crown-size spacing, community composition and exclusion masks (`ASSET-04`, `MAP-05`) |
| Background drawing | `src/render/forest-dressing.ts` | Normalised, merged per-asset geometry drawn as `(tier, asset, category)` instance batches, with per-decoration projected-size LOD, shader wind, season tint and no per-frame matrix writes (`ASSET-04`) |
| Integration | `src/game.ts`, `src/main.ts` | Regional fixed-step loop, promotion control, section orders, forest reveal, stand switching, input and UI/audio synchronization |
| Connected camera | `src/render/camera.ts` | Forest and underground camera goals, remembered player framing, wall-clock view crossings, viewport re-framing, reduced motion; explicit pose capture/restore for the forest context and per-section poses |
| Sections | `src/render/sections.ts`, `src/render/section-view.ts` | Pure `SectionSpec` slabs, clipping with continuation marks, section families and following; the drawn section, its nodes, marks and framed window (`VIEW-06`) |
| Network reveal | `src/render/network-reveal.ts` | Terrain projection of the colony's real XYZ edges with depth-weighted line weight, a slice marker, and screen-space picking with a stacked-strand report (`VIEW-07`) |
| Overlay fade | `src/render/fade.ts` | Dissolves the networks, motes, roots and rewards through a view crossing |
| Surface forest | `src/render/surface.ts` | Seeded 3D tree placement, forest floor, tree picking, wind, leaves, rain, seasonal presentation |
| Water | `src/render/water.ts` | The region's stream as a ribbon on the forest floor, and the active stand's channel and water table below ground |
| Authored models | `src/render/assets.ts`, `src/render/lod.ts`, `public/assets/forest-manifest.json`, `tools/{make-forest-assets.py,check-forest-assets.mjs}` | Manifest-driven glTF intake, per-asset tiers and fallback; projected-size LOD selection with hysteresis; reproducible Blender art and exported-pack QA |
| Fruiting bodies | `src/render/bodies.ts`, `src/render/fruiting.ts` | The three stages an eruption is drawn in and the model each wears, shared by both views; the player's earned bodies standing on the forest floor where the simulation recorded them (`CORE-04`, `ATM-05`) |
| Tree batches | `src/render/tree-batches.ts` | Region-wide authored wood/foliage instances with stable stand:tree identity, per-instance transforms and colours |
| Local disposal | `src/render/dispose.ts` | Release wholly owned soil/root/reward GPU resources on stand changes, and the materials of one authored instance without touching the geometry it borrows from the library |
| Underground world | `src/render/{soil,forest,hyphae,living}.ts` | Soil, roots, networks, flow motes, fruiting bodies, spores, interaction feedback |
| Shared stage | `src/render/{stage,quality,textures}.ts` | WebGL renderer, lights, fog, paper/specimen transition, bloom, opt-in fast QA preset |
| Audio | `src/audio/soundscape.ts` | Ambient synthesis, bond/fruit/action cues |
| Interface | `index.html`, `src/styles.css`, `src/ui/{sheet,journey}.ts` | Botanical field interface, resources, orders, guidance, view and tree controls |
| Validation | `tools/test-sim.mjs`, `tools/test-region.mjs`, `tools/test-spatial.mjs`, `tools/test-crossing.mjs`, `tools/test-regional-spatial-view.mjs`, `tools/test-dressing.mjs`, `tools/test-dressing-view.mjs`, `tools/test-sections.mjs`, `tools/test-reveal.mjs`, `tools/test-sections-view.mjs`, `tools/test-lod.mjs`, `tools/test-view.mjs`, `tools/test-journey.mjs`, `tools/shoot.mjs`, `tools/{browser,preview}.mjs` | Headless regressions for one stand, a region, shared coordinates and soil, fixture and ordinary-match crossings, background placement, section clipping and projection; bounded browser checks for the promoted body's section controls and forest reveal, dressing, LOD, connected views and a whole journey; screenshot/error capture |

The ordinary match still displays a two-dimensional transect. Each simulated
tree has one horizontal `gx` coordinate and stable root IDs.
`treeSurfacePosition()` in `src/render/surface.ts` gives the same tree a seeded
presentation-only depth on the forest floor - a formula the simulation now also
owns as `treeLocalOffset()` in `src/sim/spatial.ts`, which is where the surface
renderer should read it from next. Descending maps the selected crown back to
that tree's real root target. Do not imply that arbitrary surface depth is
simulated terrain.

The crossing coordinator runs one graph per promoted or spore-founded colony.
Local stand worlds now project the same regional soil records for the opening,
the rival, trees and section views. The flat opening stays a local UI projection,
but its nodes already have canonical XYZ; regional promotion keeps their local
columns unchanged and expands their addressable bounds. The funded crossing
fixture remains a narrow corridor for focused checks. Stand-local water-table
readouts remain approximate where the regional groundwater surface varies along
a slice.

The current `136 Ã— 112` world is one local stand-sized transect, not the final
regional map. The planned regional architecture treats it as a local simulation
unit beneath one logical stand. Neighboring stands must share seeded boundary
conditionsâ€”elevation, water flow, soil horizons, roots, and network crossingsâ€”so
moving between them does not create unrelated miniature maps.

`src/render/canopy.ts` is the superseded canopy renderer. It is no longer
instantiated by `Game`; keep it only until the new surface rendering is accepted
and equivalent useful details have been accounted for, then remove it.

## Feature register

### Core simulation and complete match

| ID | Status | Feature | Evidence and remaining work |
|---|---|---|---|
| CORE-01 | Verified | Deterministic fixed-step simulation | Identical-order determinism passes in `npm test`. |
| CORE-02 | Verified | Resource conservation and founding reserve | Birth, decay, harvest, construction, reserve and exact connected-path bond-charge assertions pass. |
| CORE-03 | Verified | Living connectivity and tree trade | Cut supply and dead-founder disconnection tests pass. A reachable free junction may draw the 1.1-carbon bond charge from its connected ancestors, with the founder paying first; an unfunded or severed path cannot bond. |
| CORE-04 | Verified | Supplied fruiting and stored bloom history | Weather pause, supplied progress, severed loss, and actual bloom locations are covered. A bloom also records the ground its own strand physically stands on, which is what lets the same body be found above the forest floor. |
| CORE-05 | Implemented, unverified | Regional victory (replaces the two-bloom win) | A regional match no longer ends at two blooms: `RegionalMatch.regionalPlay` defaults to true and every stand's simulation continues past its bloom goal. A standalone single-stand `Simulation` keeps the two-bloom goal for the headless journey. The match is won by holding `HOLD_TILES` = 5 stands, where a stand is held by strictly more bonded trees than the rival, and keeping at least 5 until the season index advances (`stepVictory`, checked once a second). A broken hold is announced and resets. The instrument's notes line shows `holdStatus()`. A victory overlay offers a new sheet or Keep growing. `test:regional-play` covers: no two-bloom win; win through a season turn; a broken hold with no win; a tied stand not counting. Remaining: a played-browser win, a stand-by-stand hold view in the survey, and a rival domination measure (the rival never bonds trees, so it cannot win yet). See "Major plan: regional spread" under Current priorities. |
| CORE-06 | Verified | Outcome and command guards | Invalid/deep fruiting, permanent cords, and post-outcome guards pass. |
| CORE-07 | Implemented, unverified | First-player journey through the actual UI | An earlier `test:journey` run clicked through the full `raven-wood` match to 2 blooms, 480 spores and a fresh sheet. The current tree has a played-browser check of the lean-strand `oak` opening through its successful bond. Remaining: complete a current whole-match UI rerun through both blooms and restart. |
| CORE-08 | Partial | Subclusters: steer parts of a large colony separately | Requested 28 September. Underground, press and hold on the soil to grow a selection circle (starts at 2 cells, +14 cells/s, max 42); release to split the living strands inside into a subcluster (`GrowthGroup` in `network.ts`). Needs a colony of at least 60 strands and a selection of at least 6; at most 6 subclusters. Subclusters stay one network: while joined to the root they share carbon, water and minerals, and cut-off strands starve as before. Orders (Grow clicks, Rest/Wake) go to the selected subcluster; Esc returns to the colony at large; keys 1-6 select; a bar under Grow/Share/Rest lists strands and tips and merges groups back. One shared tip allowance: a subcluster or the colony with an order and fewer than 2 tips sprouts from its own strand nearest the target, and when the allowance is spent the group with the most tips retires its youngest tip to make room. The selected subcluster's strands and tips are lit pale blue in transect and section views. Grow orders at a stand edge follow the selected subcluster into regional sections; the selection remains attached to the same regional body. An unfunded subcluster does not consume another group's tip allowance. A never-split colony is bit-identical to before. Gaps: Bond, Cord and Fruit orders are not group-specific; no touch equivalent for press-and-hold beyond a held touch; the rival does not use subclusters; balance of the 60-strand threshold and borrowing is untuned. |

### Forest and underground views

| ID | Status | Feature | Evidence and remaining work |
|---|---|---|---|
| VIEW-01 | Implemented, unverified | Bird's-eye 3D forest | Every stand in the 3Ãƒâ€”3 region now draws its own ground and its own trees, laid out as one continuous forest, and each tree wears an authored model when one is loaded and the procedural body when one is not. Understory, litter, seeded props, wind, rain and seasonal colour are present. Verify: mature and dead stands, and the portrait framing of the whole region, still need a look. |
| VIEW-02 | Implemented, unverified | Surface tree identity and selection | Crowns and selector options use simulation tree IDs; status reflects health, death, and bonds. Add automated crown-selection and tree/root round-trip checks. Held trees glow (29 September): a tree the player holds a living bond with (`playerHolds`: a bonded root tip not owned by a rival, the same trees that count toward holding a stand) wears a soft amber halo, seen through its own leaves, and a warm glow at its foot, in the forest view only. Both breathe together (steady under reduced motion), fade in with the rise, and never take clicks. |
| VIEW-03 | Verified | Seamless forest â†” underground journey | View buttons, `V`, zoom threshold, remembered player framing, selected-root descent, and reduced-motion snapping exist. The crossing is now driven by a wall-clock timeline (`CROSSING_SECONDS`), so a 30fps rise and a 4fps rise both take 1.50s; it reverses at any point with a duration proportional to the distance left, and the soil's contents dissolve from their own opacities instead of being switched off at a blend threshold. `npm run test:view` covers both frame rates, a half-way reversal, a rapid double reversal, endpoint exactness, reduced motion, and crown-to-root round trips. Direct section entry, Return to forest and Surface here now use the same timed crossing; the focused section browser check confirms both settled endpoints. Remaining: the crossing is still one camera rising through one scene rather than a blend of two rendered views. |
| VIEW-04 | Partial | Camera navigation | Forest pan/orbit/zoom, underground pan/tilt/zoom, keyboard pan/zoom, section-plane panning across stand boundaries with regional bounds, and `F` framing exist. A viewport change now re-derives the active view's default framing, and the forest framing fits the whole stand at any aspect instead of cropping its ends on a portrait window. `npm run test:view` projects the specimen corners and every crown at 1600Ã—1000, 1366Ã—768, and 390Ã—844. Remaining: interrupted transitions during a drag, and the 1180px breakpoint band, have not been exercised. |
| VIEW-05 | Verified | Safe input separation | Forest clicks select trees; underground clicks issue orders; input is suppressed during transitions. `npm run test:view` now covers the cases the row was waiting on: a drag pans instead of ordering while a tap on soil orders, a refused order is refused out loud and changes nothing, a cancelled pointer issues nothing and leaves the canvas still able to pan, a click during a crossing issues nothing, one wheel notch does not cross while six do, a key typed into the tree selector does not reach the sheet, the canvas answers `V`, `1-4`, the arrows and Space, and a burst of five view changes lands in the view asked for last with input still live afterwards. |
| VIEW-06 | Partial | Browse persistent underground sections | All nine stands have named, selectable underground sections, including uncolonized soil. The section stand selector switches directly between tiles; a spore daughter selects its own graph and controls. Previous and Next follow one physical corridor across interior stands and stop at the region edge; dragging along the plane changes the active section as its centre enters a neighbouring stand. Flip, Follow, Seek a root, Return to forest and Surface here remain. Section entry and both rises use the timed forest crossing. Nearby soil meshes are reused on return. Grow accepts a passable XYZ target from either section orientation, and the crossing test observes strands move laterally toward one. Remaining: compare-two-sections mode, fuller root drawing, and longer repeated-rebase input QA. The mature regional browser suite now clicks Grow in a daughter colony adjacent section and verifies its regional lateral target. |
| VIEW-07 | Partial | Forest network reveal | Requested 29 September: see every colony through the forest floor with a toggle. The side panel's "See colonies through the floor" toggle (`#forest-reveal`, always available once a colony exists) projects every colony the player has at once (`Game.allColonyEdges`): each regional body, the founding colony while it is still in its own transect (from its nodes' recorded XYZ), and any bench fixture outside the match. Keys carry the colony id. While shown, the projection refreshes once a second. Clicking a strand attaches the body that owns it and opens the section through it; a strand of an unpromoted founding colony goes below its stand. Remaining: transparent-ground true-depth mode, per-colony colours, regional-scale LOD and cost tuning. |
| VIEW-08 | Partial | Natural forest-floor materials and ground contact | Sine bands and tile-local color jitter are replaced by regional moss/litter/wetness/canopy weights, continuous edge normals and a shader with distance-filtered grain, seasonal colors and wet roughness. Litter avoids wet channels; low props follow terrain normals with slight embedding. A perimeter skirt closes the sheet edge; the local backing hides at the forest endpoint. Current checks include exact agreement at 824 shared vertices and normal-quality seasonal closeups. Remaining: fine relief maps, multi-point log supports on curved slopes, intermediate crossing/orbit QA on more seeds, and canopy-mask refresh after fixture density changes or tree mortality. |

### Authored surface art

| ID | Status | Feature | Evidence and remaining work |
|---|---|---|---|
| ASSET-01 | Partial | Authored model intake | The existing registry loads six replacement botanical models; scaling, ground correction, seasonal/health material tint and procedural fallback are unchanged. Tree and sapling GLBs now contain `anchor_crown`; the loader still ignores it. Manifest LOD and regional wood/foliage batching are implemented. Remaining: browser missing-file/late-load checks, anchor consumption and dead-variant switching. Current art verification is recorded under 19 September below; the 18 September browser results describe the previous art. |
| ASSET-02 | Partial | Botanical asset pack | Forest v3 (`tools/make-forest-v3-assets.py`, Blender 4.2) adds 24 assets / 42 GLBs: three forms per canopy species (oak broad/tall/old, yellow birch single/twin/leaning with peeling bark, eastern hemlock full/young/windswept), built as overlapping leaf clumps on a branching frame, 1,888â€“2,959 triangles at LOD0 with gentle LODs that keep every clump but use fewer, larger cards; and 15 forest-floor pieces (nurse log with seedlings and shelf fungi, broken log, mossy stump, broken snag, fallen branch, three boulders, bracken, lady fern, blueberry, flowering hobblebush, trillium, autumn and summer leaf litter), 78â€“552 triangles. Budgets were set to fit the art (trees 4,000/2,400/1,200, floor 2,000). The pack now totals 61 assets / 103 GLBs, including eleven wildfire assets generated in Blender 4.2; the two newest are fireweed shoots and goldenrod. `tools/make-forest-assets.py` builds 26 original low-poly assets / 44 GLBs, including the five species specimens generated by `tools/make-mushroom-assets.py`. Porcini (*Boletus edulis*) button, opening and mature forms now carry the player's eruption in both views via the shared `BODY_ASSET` table; the old generic fungi remain available. Golden chanterelle (*Cantharellus cibarius*) and amethyst deceiver (*Laccaria amethystina*) are registered comparison models, not placed species or factions. Original geometry uses real photographic references, recorded in the manifest; no downloaded photography is shipped. The truffle remains deliberately unplaced. Current asset checks pass for all 103 GLBs, with new bodies at 264â€“480 triangles and at most three materials. Remaining: art-direction acceptance, runtime dead variants, any species-specific ecology or selection. These are stylized specimens, not scans; pore microgeometry is omitted. |
| ASSET-03 | Partial | Asset contract, LOD and validation | Manifest-driven projected-size LOD with 15% hysteresis is retained. Region-wide TreeBatches groups authored parts by asset, tier, geometry and material; instance matrices retain placement, growth and wind, and instance colours retain health and season. Stable stand:tree mappings survive slot/tier changes; crown proxies remain selectable. Focused batch tests cover transforms, colours, buffer growth, tier migration and re-entry. `AssetLibrary.batchParts()` now exposes an asset's shared parts and its authored height and ground offset, so the dressing can normalise and merge them once instead of cloning an object per tree; `nearestLoaded` takes a coarse-first fallback for scenery. Scenery requests now clamp to each asset's tier count, allowing single-tier ground props to render instead of waiting for nonexistent LOD2. A registry id must match the manifest id exactly: `KNOWN_IDS` filters the manifest, so a near-miss silently falls back to the registry's own single tier and drops the declared ones. Remaining: authored wind clips, dropped-in-file validation, loader failure/late-load QA, crown anchors, dead variants and distance-transition tuning. |
| ASSET-04 | Partial | Dense non-interactive forest dressing | Seeded regional placement preserves ownership, clusters, clearings, community profiles, stream exclusions and playable crown access. Each canopy cell now picks one of four forms of its species (the three v3 forms and the original model) by its own hash, with a per-form height; ground cover, deadwood and rock pick among the v3 floor pieces at their natural sizes (litter stays a 13 cm carpet). Playable trees pick a v3 form from their own seed (`surface.ts` `treeAsset`). Floor pieces may carry up to five materials because the dressing bakes them into vertex colours; trees keep the three-material limit. Underground, the regional dressing now stays as a backdrop behind the section instead of leaving with the floor. The dressing shaders drop whole trees rooted in front of the cut (the active stand's surface z) and haze the rest toward dusk with depth. The mounting paper ends at the soil line, and the dusk glow is placed 900 units back and rescaled about the camera each frame, so the forest recedes behind the playable trees rather than stopping at the sheet. Remaining: a view from the back-row stand (nothing behind but the region edge), and tuning the transition between 0.3 and 0.99 blend, where the paper is now cut. All six kinds now draw as asset/tier/category batches. Nominal sparse/medium/dense canopy budgets are 24/80/112 per stand; crown stature is increased. Uniform grass is removed and small litter fragments follow habitat masks. Low props align to terrain normals. The current raven-wood medium fixture draws all 1,968 decorations in 17 batches; the 13-check browser smoke confirms selection isolation, band switching and equal normal/fast populations. Remaining: hardware tuning, multi-seed visual acceptance, authored winter leaf drop and exact support for long logs on curved slopes. |

### Regional map, terrain, forest stands, and water

| ID | Status | Feature | Evidence and remaining work |
|---|---|---|---|
| MAP-01 | Partial | Multi-stand regional map | All nine stands render continuously and colonized stands can be entered through Survey a stand or a selected crown. Game steps RegionalMatch; the original founding world is retained for opening compatibility. Remaining: shipping region size and complete terrain/soil boundary integration. |
| MAP-02 | Partial | Continuous regional surface | Shared terrain and all nine stands render continuously. The drainage ribbon now has rounded bends, soft banks, slow shader currents and instanced brook stones; it folds and rebases with the landscape. Focused water browser checks exercise actual shader output at fast and normal quality. Remaining: ponds, broader exposed rock placement, and near-camera floor/slab defects. |
| MAP-03 | Partial | Terrain-first generation | Elevation, a regional fall line, a valley, drainage from a priority flood, flow accumulation and aspect are all generated before anything is placed, deterministically from the seed. Remaining: exposed rock, parent material and deadwood are still local, and there is no generator-version field. |
| MAP-04 | Partial | Hydrology and water features | The region owns the stream course, stand channel and wet banks. Surface water has analytic flow and eddies; underground water and soil share an 8 cm capillary gradient above the live table. Hyphae can touch that upper fringe but cannot extend into saturated ground, including paid targets invalidated by a rising table. Existing submerged strands persist but stop extending; soil under the stream bed only becomes passable as the table recedes. The opening now queries the same continuous groundwater and stream course as spatial growth. Remaining: ponds, vernal pools, springs, seasonal channels, erosion, oxygen stress on existing strands, and a local water-table visual/readout that follows variation along the slice rather than its centre value. |
| MAP-05 | Partial | Distinct forest stands | Seven communities are derived from moisture, drainage, slope, relief and disturbance (oak ridge, mixed slope, birch hollow, hemlock ravine, stream corridor, wetland edge, recovering clearing), the community sets the stand species mix, and each stand now draws its own trees from that mix. The background vegetation reads the same seven communities: canopy density, stature, species mix, regeneration, fern, grass, rock and deadwood lean per community, and a stand's own density field makes two stands of one community differ. `tools/test-dressing.mjs` asserts that ravines carry more conifer than ridges, that ridges are rockier than ravines, and that clearings are younger than ridges. Remaining: playable-tree age structure and canopy openness still do not vary by community, broader community-by-community visual acceptance remains. Understory and deadwood now render from the regional placement, verified in the current dressing smoke. |
| MAP-06 | Partial | Stand suitability and succession | Species placement follows the community a stand's own moisture, drainage and slope produce: a stream corridor grows birch and hemlock, an oak ridge grows oak, a ravine grows hemlock. Remaining: succession through gaps, regeneration and recovery is unchanged from the single-stand prototype. |
| MAP-07 | Partial | Cross-stand fungal network | The fixture covers conserved growth, trade, cords, severance and all four edge directions. Promotion keeps every node address and position, and a running graph can order toward any passable XYZ with 26-neighbour steering; diagonal corner hops are refused. **Seamless edges (regional plan A):** the forest-view "Grow through a stand edge" button is gone. In the flat transect, faint strips of the neighbouring stands' soil (`src/render/edge-soil.ts`, sampled from the shared soil volume) run past both ends, and a grow order placed there promotes the colony and orders it across in that direction. In section mode the section is drawn over a vertex-coloured soil backdrop that runs 180 units into each neighbouring stand, without a visible stand seam; visible strands continue through the same neighbour soil that accepts Grow orders. A mature regional browser check places Grow in the next section of a daughter body, then into its neighbouring stand on that same plane, and verifies both targets. The opening section now prefers the colony's own growth plane. When the frontier first enters another stand, a Follow prompt (`#follow-frontier`) offers to open that stand's section; the view never moves by itself. Return to forest surfaces over the section's stand when no forest picture was saved. The regional-spatial browser check places the edge click but its corner-start natural arrival currently fails before the later assertions. Remaining: greedy steering may stall around large obstructions; the neighbour strips in the flat transect cover only the west and east neighbours; root/infection spread across boundaries; longer free-growth balance and input QA. |
| MAP-08 | Partial | Regional exploration and information | Forest selection and the section stand selector open any of nine persistent underground tiles, even without a colony. **Colony tiles (29 September):** the side panel lists one tile per colonized stand (`colonyStands`: founded here, grown into, or spores landed). A tile goes below that stand, framed on the colony (`goToColony`). A colony with its own regional body is entered like the stand selector does (local views rebound, section selector and caption updated). A stand reached by another body's growth attaches that body. The founding colony in its transect is entered and descended into. The visited tile is marked current. Panning through an adjacent stand updates the section stand selector without moving the camera or changing the attached network. Follow, Surface here, forest pose return and projected-strand selection remain. Remaining: water-feature selection, finer survey knowledge, hold state per tile, and longer repeated-rebase QA. |
| MAP-09 | Partial | Generated-map fairness | Validation refuses a region whose stands cannot be reached from the founding stand, or whose founding stand has no water in reach; the founding stand is chosen for habitable ground near water on the way down. Remaining: no repair pass, no threat-counterplay check, no check that a loss is recoverable, and the player's and rival's start stands are not yet chosen randomly (`MAP-16`). |
| MAP-10 | Partial | Regional colonization loop | A paid spore founds a separate spatial body on the same soil, with its own root, stores, orders, fruiting and stand origin. **Player-timed spores (regional plan B):** a completed bloom holds its spores. The player releases them with Release spores (`#release-spores`, shown while `sporesReady` > 0), or the next gust takes them. A gust is a seeded signal (`gustAt`, `SPORE_GUST` 0.65), about one every 77 s, or any storm-strength wind. The wind still picks the stand (`sporeTargets`). A release the colony cannot pay for keeps its spores and says what is needed; an unaffordable gust is logged once per bloom. Storm paths keep their forced release. Landings are broadcast region-wide and drawn as spore clouds rising, crossing the canopy and settling (`src/render/spore-flight.ts`), with a rising audio cue. The rival's spores follow the same gust rule. `test:spores` covers holding, release on command, release on the first gust exactly once, the unaffordable case and determinism. Remaining: flights run from stand centre to stand centre rather than from the body itself; mature balance; contested contact in one tile; rival crossing of stand edges. |
| MAP-11 | Partial | Regional atlas interface | The nine-stand survey distinguishes spore lineage from physical connection: a living spore daughter is labelled as an independent network, while a continuous strand arrival names its growth source. It records lineage survival separately from supply in the founding graph. Remaining: multi-graph occupancy per tile, infection, water features, finer fog of war, network sensing and browser text QA. |
| MAP-12 | Partial | Simulation streaming and level of detail | Stand ecology, shared soil and each independent spatial graph advance in fixed order, independent of camera selection; empty stands stay dormant until reached. The latest mature browser check advanced 30 seconds of a two-colony match in 5.61 seconds on fast SwiftShader without drawing those ticks; this does not establish a rendered 4Ã— budget. Remaining: coarse distant cadence, pooled geometry, bounded particles, hardware measurements and a multi-graph 4Ã— budget. |
| MAP-13 | Partial | Generator persistence and replay | The region is a pure function of its seed: two matches from the same seed colonize the same stands with the same spores and end in the same state. Remaining: no save or replay format, no generator-version field, and no RNG-state serialization. |
| MAP-14 | Partial | Shared spatial network and soil coordinates | Regional XYZ ownership, stable references, supercover traversal and one sparse SoilVolume remain. The opening, rival, trees and spore daughters use lazy local views into that canonical material. Opening nodes record their physical XYZ and stand from the first tick; promotion expands their founder-relative x bounds without changing any existing node address or position, and moves no soil. Section and reveal read the same regional XYZ. Remaining: the flat opening UI still samples one east-west slice, local water-table summaries approximate a varying regional surface, surface tree placement still has its own formula, and no save format carries SPATIAL_VERSION. |
| MAP-15 | Implemented, unverified | Automatic fusion of the player's colonies | Decided 28 September: two of the player's colonies fuse automatically when their strands touch; there is no manual fusion action. Once a second `stepFusion` looks for a living node of one player body in a 26-neighbour voxel of another. The older colony (founding first, then by spore arrival) absorbs the younger through `CrossingMatch.absorb`. Nodes are appended with shifted ids, and the younger founder is re-parented to the contact node. Resources move node by node and are conserved. Surplus, blooms, fruited, spores and a body in progress join the survivor (a second active body returns its store to surplus). Tree bonds are re-pointed through the trees' stand and id. The younger body is retired, its stand records `fusedInto`, and a fusion is broadcast. Player colonies never fuse with the rival. `test:regional-play` grows a daughter and the founding colony into contact and checks: conservation, every strand joined, bonds pointing at living junctions, a cut link severing again, and determinism. Remaining: the absorbed colony's subclusters rejoin the colony at large rather than keeping their ids; no browser check of a fusion yet. |
| MAP-16 | Implemented, unverified | Randomized player and rival starting stands | Requested 27 September; built 29 September. `createRegion` draws the player's stand from the stands good enough to begin in (habitable, water in reach, within 1.2 of the best start score). It uses a seed stream of its own, so replay stays exact (`MAP-13`) and nothing else in the region moves. The rival begins in its own stand: one with water in reach, at least two orthogonal steps from the player, drawn from the same stream; the fallback is the farthest livable stand. `region.rivalStand` is where `RegionalMatch` enables the rival. Every region still validates (`MAP-09`). A game opened without `?seed=` now draws a random seed and writes it into the address, so every new game is a new forest, with different stands, communities and trees. "Open a new sheet" already did this. `StartRule` `best` (`createRegion(..., 'best')`, `RegionalMatch(..., { starts: 'best' })`, `?start=best`) keeps the earlier single best start with the rival in it, for fixtures built around one seed's geography. The standalone crossing bench defaults to it. `test-region` checks 12 seeds: 8 different starts, rival never adjacent, repeatable, valid. `test-colonies-view` checks a fresh game draws a seed and separate starts. Remaining: balance of a corner start whose wind blows off the map (its spores land nowhere until the wind turns), and a played-browser match from a drawn start. |

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
| ATM-04 | Partial | Four visible seasons | Oak, birch, hemlock and understory now have distinct blended palettes shared by playable and decorative trees; the floor shader blends seasonal litter and moss. All four seasons were inspected at normal quality in this change. Seasonal tint is the chosen art contract; no four-mesh seasonal set. Procedural deciduous trees blend leaf density, while authored trees currently only change color; hemlocks retain foliage. Bare dead/hollow assets are delivered but not switched at runtime. Add authored foliage density, spring emergence, stronger drought stress, seasonal litter accumulation, winter lighting, and dormant-versus-dead selection. |
| ATM-05 | Partial | Ecological surface truth | Health, maturity, death, bond text, rain, and season are simulation-driven, and the player's own fruiting bodies now stand on the forest floor at the site the simulation recorded for them, wearing the same stage art the transect shows. A body whose transect was never bound to regional soil is omitted above ground rather than guessed at. Remaining: confirm every visible outcome on the same trees across both views. |

### Ecological opposition, modes, and root architecture

| ID | Status | Feature | Evidence and remaining work |
|---|---|---|---|
| ADV-01 | Planned | Ecological opposition framework | Add deterministic pressure from root occupation, host infection, fungal predation, and resource competition. Every threat must transform the ecology and offer readable counterplay rather than act as generic damage. |
| ADV-02 | Planned | Honey fungus (`Armillaria`) | Marquee pathogen begins in infected deadwood or a stump, scouts with black rhizomorphs, attacks vulnerable roots, progresses toward the root collar, kills weakened hosts, and consumes their remains. Implement detection, infection stages, surface symptoms, mushroom warning, and AI. |
| ADV-03 | Planned | Rival mycorrhizal fungi | Compete for unoccupied fine-root tips using ecologically distinct strategies and first-colonizer priority. Trees may support different partners across their root systems and should allocate more carbon to useful trade relationships. |
| ADV-04 | Planned | Mycoparasitic fungus | Rare direct predator tracks, coils around, and digests exposed fungal hyphae. Fine exploratory growth is vulnerable; reinforced cords and redundant paths resist or route around attack. Use sparingly after `Armillaria` and root competition are proven. |
| ADV-05 | Partial | Saprotroph competitor | One deterministic saprotroph network already exists, but it is not yet a complete ecological opponent. Clarify its role as a decomposer racing for dead matter rather than a substitute for a root pathogen or mutualist rival. Remaining: it begins inside the player's own opening transect instead of a separate starting stand; it must start in a different tile than the player (`MAP-16`). |
| AGENT-01 | Partial | Agent players (System One) | `src/agent/*`, `server/decide.ts`, `functions/api/decide.ts`, `src/ui/agent.ts`: an agent plays the rival in real time by answering typed questions (Jev format) over a compact observation, with confidence-gated actions through the ordinary orders; a key-holding relay for TypeSafe Jev and OpenAI Decisions; an offline heuristic fallback. Remaining: live Jev run, OpenAI preview schema, order log for replays, agent-versus-agent, fruiting and spores questions. See the agent-players major plan. |
| ADV-07 | Partial | Contact war (direct network fighting) | `src/sim/contact.ts`: fronts where strands of different owners touch, supply-limited passive fighting, overgrowth, severing, elimination, and six mouse-aimed chemicals as deterministic orders (Q W E light, A D C heavy); hotbar, front alert and Z jump in the game; first-pass soil effects. Remaining: C3 art and sound, C4 map pulse and control groups, C6 balance. See the contact-war major plan. |
| ADV-06 | Planned | Defensive counterplay | Add early sensing, tree provisioning, cord reinforcement, defensive enzymes, root quarantine, deliberate branch sacrifice, rerouting, occupation of vulnerable tips, and escape by early fruiting. Each response needs a cost and visible consequence. |
| MODE-01 | Planned | Standard cultivation-under-pressure mode | One concealed `Armillaria` infection center, one or two competing mutualists, a decomposer benefiting from death, and seasonal/weather pressure. Tune around defense, triage, and eventual fruiting rather than total extermination. |
| MODE-02 | Planned | Chill mode | No aggressive root pathogen, slower or non-hostile competitors, gentler extremes, no forced tree-loss clock, and optional continued play after fruiting. Preserve the full growth, trade, season, and forest-feedback systems. |
| SCENARIO-01 | Planned | Ecological crisis scenarios | Author scenario identities such as The Black Cords, The Withering Hemlocks, The Fallen Giant, First Claim, The Hollow Stand, and After Fire. Introduce one pressure system clearly before combining many. |
| ROOT-01 | Partial | Species- and site-driven root generator | `src/render/root-architecture.ts` replaces the generic tip-to-trunk lines with seeded species architectures scaled by maturity. Its proportions come from the Kutschera and Lichtenegger excavation drawings (Wageningen UR "Root System Drawings", coll13), which were studied for form only and are not shipped: contact wurzelforschung.at before any use of the scans. It routes a drawn root to every simulation tip without moving any, and is drawn as tapered ribbons plus fine-root hairlines in `src/render/forest.ts`. Remaining: it is presentation, not simulation-owned; soil horizons, hardness, drainage, water table, slope and channels do not yet shape it. |
| ROOT-02 | Partial | Northern red oak architecture | Drawn: a heart root after *Quercus robur* 1355, with 6â€“8 shallow laterals, a lower oblique layer, a stout tap to 45% of rooting depth, and sinkers fanning to deep tips with fine brushes. Remaining, planned: | Strong early central descent where soil permits, durable spreading structural laterals, and deeper sinkers/fine-root zones. Gameplay: costly deep access, drought resilience, high-value long-term partner. Avoid guaranteeing a taproot where hardpan or saturation prevents one. |
| ROOT-03 | Partial | Yellow birch architecture | Drawn: a plate after *Betula pendula* 1362, with 7â€“10 long sinuous laterals in the top ~5 rows, a flared base, no tap, and short droppers. Remaining, planned: | Extensive irregular laterals, commonly shallow but able to penetrate deeply on favorable sites; follow old channels and allow root grafts. Gameplay: many accessible tips and flexible routes, with grafts also creating infection corridors. |
| ROOT-04 | Partial | Eastern hemlock architecture | Drawn, after its European relatives *Abies alba* 1256 and *Picea abies* 1255: flattened plate laterals, a short tap, and near-vertical sinkers from the laterals. Remaining, planned: | Shallow, wide-spreading roots concentrated in cool moist upper soil and duff. Gameplay: accessible surface partnership and moisture retention, with strong drought, injury, and windthrow vulnerability. |
| ROOT-05 | Partial | Functional root hierarchy | Drawn with unequal weight: structural laterals and taps, secondary branches, sinkers and droppers, fine-root hairlines, and the bondable tips. Remaining: the simulation still sees only tips, so infection, trade and damage do not travel through a root graph. Planned: | Generate coarse structural roots, secondary connectors, localized fine-root zones, and active bondable tips. Do not render every root with equal weight. Infection, trade, damage, and fungal bonds must travel through the actual root graph. |
| ROOT-06 | Planned | Living root response | Healthy supplied trees extend roots and create new opportunities; drought, disease, damage, compaction, saturation, and death alter growth and connectivity. Root changes must remain deterministic and conserve resources. |

#### Adversary roles and interaction rules

The adversaries should occupy different ecological roles so matches do not
become a collection of differently colored attacking networks:

- **Honey fungus threatens the forest.** Its strategic arc is concealed source â†’
  rhizomorph scouting â†’ root infection â†’ root-collar progression â†’ declining
  crown â†’ host death â†’ decomposer reward. A healthy, well-supplied tree resists
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

- [USDA Forest Service â€” Armillaria root disease](https://www.fs.usda.gov/sites/nfs/files/legacy-media/r02/2%20pager%20-%20armillaria.pdf): wide host range, spread through root contact and rhizomorphs, and increased danger to stressed trees.
- [Kennedy, Peay, and Bruns â€” ectomycorrhizal root-tip competition](https://pubmed.ncbi.nlm.nih.gov/19739372/): priority effects and root-tip occupation can determine competitive outcomes.
- [Trichoderma-pathogen interaction study](https://journals.asm.org/doi/10.1128/aem.70.5.3073-3081.2004): hyphal tracking, coiling, and specialized mycoparasitic contact structures.
- [USFS Silvics â€” northern red oak](https://research.fs.usda.gov/silvics/northern-red-oak): vigorous early taproot development where soil permits and its role in moisture-stress survival.
- [USFS Silvics â€” yellow birch](https://research.fs.usda.gov/silvics/yellow-birch): extensive lateral roots, site-dependent depth, root-channel following, and root grafting.
- [USFS Silvics â€” eastern hemlock](https://research.fs.usda.gov/silvics/eastern-hemlock): shallow-rooting vulnerability, moist-site ecology, drought sensitivity, and windthrow risk.

### Interface, audio, accessibility, and delivery

| ID | Status | Feature | Evidence and remaining work |
|---|---|---|---|
| UX-01 | Verified | Guided opening and journey model | Current accelerated built-preview journey passes all 19 gameplay assertions through visible controls: awakening, reaching/bonding the labelled oak, surface growth, rest, both blooms, their authored bodies, victory and restart. `deriveJourney()` keeps its connected-path bond funding rules. Browser process exits nonzero solely for blocked external font requests; no gameplay assertion fails. Natural earning and balance of the new optional adaptations are tracked under TECH-01/02. |
| UX-02 | Partial | Actionable root labels | Explicit root IDs and states exist. The label says Bond only when the selected free junction is in range and its connected path can pay; otherwise it says Reach or needs carbon. Remaining: collision handling, safe areas, compact viewports, and prioritization during a mature match. |
| UX-03 | Partial | Responsive layouts | Current `test:evolution-view` passes 1440x1000, 820x900 and 390x844 layout, disclosure access and stacked tech branches on fast SwiftShader. Screenshots inspected in forest and underground views. Remaining: real touch/hardware checks, the 1180px band, mature-world label occlusion and a full rerun of the migrated `test:view` suite. |
| UX-04 | Partial | Forest-dusk HUD and resource instrument | Complete amber/slate/sage rings express connected reserve strength relative to base growth costs per tip, never maximum capacity. Exact amounts on hover/focus, semantic disclosures for advanced controls, native tech dialog with focus return and isolated shortcuts. `test:evolution-view` passes current browser interactions and screenshots; production build passes. Remaining: normal-quality/hardware visual QA, player usability and mature-match safe areas. |
| TECH-01 | Partial | Adaptation tree owned by the player | Six compatible, free milestone-earned adaptations: water uptake, nitrogen uptake, fed-strand recovery, transport, resting allocation and fruit maturation. `test:evolution` verifies all six effects, prerequisites, distinct partner counting, idempotence, topology and deterministic steps. **Player-owned (regional plan C):** in a regional match every colony's `evolution.learned` is one shared array per side (`RegionalMatch.lineage`), so learning in any colony teaches all of them. A spore daughter is born knowing everything learned. Ages, active powers and cooldowns stay per colony. `test:regional-play` checks the shared list, a daughter's inheritance, no stacking, and a separate rival lineage. Remaining: natural-match balance, deeper branch content (`TECH-04`),. Each adaptation has an authored icon (see `TECH-05`). Genetic currency is unchanged and is not spent on research. |
| TECH-02 | Partial | Contextual late-game powers | First completed bloom plus branch research unlock Forest pulse (double transport), Mend the web (node-carbon-funded repair) and Second spring (double supplied maturation). Each is active for 20 simulation seconds and recovers for 120 seconds from activation. Tests cover first-bloom gating, cooldown, topology, paid healing, fruit reserve spending and frost. Browser learn/invoke/cooldown checks use a clearly synthetic mature fixture. Each power has an authored icon, shown in the side panel with a hover or focus popover. Remaining: natural full-match earning and strategic balance, and power-specific world feedback beyond existing node pulses. |
| TECH-03 | Partial | Summon storm: shared fruiting race and directional colonization | Implemented 28 September: `storm-crown` capstone (Fruiting branch; 300s age, a completed fruiting, Mineral weave, two bonds); region-owned idle/warning/active/recovery lifecycle in `RegionalMatch` (60s warning, 45s storm, 180s recovery; 80C/12W/6N cost), direction locked at announcement; warning blooms are held and released on arrival (dead parents forfeit them); each storm bloom funds up to three paid, independent downwind daughters; the rival banks, fruits and colonizes on the same wind; warm storm rain permits fruiting through frost; "Continue growing" replaces the two-bloom stop. UI: `src/ui/storm.ts` picker with "wind blows toward", map preview, countdown and live-region announcements. Graphics: `src/render/storm.ts` (delegated to Sonnet 5.5, extended by Claude) slate front, cloud bands, a differential-rotation spiral vortex shader over the summoning colony, heavy slanted rain, forked lightning ribbons with a stage-light flash (none under reduced motion), and amber spore trails, at most six draws. Playable trees lean and buffet downwind; background trees bend in the vertex shader (stone and logs stay rigid). Windfall: during the active storm each mature tree has a seeded chance to be thrown down (`STORM.fallRate` 0.0012/s, scaled by maturity and weakness; at most two per stand per storm); it dies, topples downwind in view and draws a strike; every bond it held is torn and the bonded junction loses its stored carbon, water and nitrogen and is left damaged (health 0.35, mendable). A storm summoned into a running wildfire sends embers across all nine stands for 12 s, then its heavy rain quenches open flames at 18 s (`TECH-06`). **Flood (the storm's water half) implemented 28 September**, `src/sim/flood.ts`: the level rises through the active storm (peak after 30 s) and drains over 40 s of recovery. Every stand the stream crosses floods to 18 columns beyond the channel's edge; stands with no stream are high ground. Flooded soil (top 40 cm) is waterlogged and closed to growth (`SoilCell.flooded` in `passableAt`). Thin surface strands under 8 cm wash away; others drown; reinforced/thick cords hold and the root holds on. Trees are waterlogged by species (oak worst, birch barely; `Tree.drowned`). The peak's reach is silted as it drains (organic and nitrogen up). No rolls. Graphics: floor shader floodwater with foam edge and a fading silt stain, a swollen stream ribbon, and debris and foam carried downstream (`src/render/flood.ts`); the storm watch reports the flood and your drowned strands. Underground (`src/render/underground-weather.ts`, one plane per active stand): storm wetting front, percolation fingers and falling droplets; standing floodwater above flooded columns and airless soil with bubbles below. Gaps: nothing visible in the sky during the first half of the warning (distant strikes begin past 55%); flood does not carry spores or daughters downstream; spatial colonies' voxel soil is not flooded (only their stands' transect cells); the flood's floor water uses distance to the drawn course while the simulation uses distance to the transect channel, so edges can disagree slightly; no audio or camera response; balance untuned; hardware-GPU cost unmeasured; browser loop uses a synthetic late-game fixture. |
| TECH-04 | Planned | Deeper tech tree: more branches, tiers and real choices | Requested 27 September: flesh out the six-adaptation tree into a branching path worth planning around. Grow each branch from two adaptations to three or more tiers, add forks and optional picks so two matches can research differently, add cross-branch synergies and branch capstones (the three existing powers become the first capstones; the region-scale ecological superpowers of `TECH-06` are the final ones), and decide whether learning stays free milestone-earned or gains an explicit research currency. Every new node needs a distinct ecological effect, a prerequisite rule, an icon and balance coverage; state must stay deterministic and survive promotion/spore founding exactly as the six current adaptations do. The opponent must be able to research the same tree (`MAP-16`, `ADV-05`). No new adaptation content exists yet; the plan is specified below. |
| TECH-05 | Partial | Organic tech-tree presentation: a real fungal network | Requested 27 September. **Done 29 September:** twelve user-supplied icons, one per adaptation and power (`public/assets/icons/<id>.webp`, 256 px WebP resized from 1024 px transparent PNG masters kept outside the repository, 392 KB in total). The dialog is now icon tiles with names, joined by stems in three branch columns. Crown adaptations are drawn larger. State is shown by the tile: locked is dimmed grey, ready glows amber (still under reduced motion), learned is full colour with a green rim. Each branch ends in a power chip. The effect, requirement and state live in a single popover (`TechPopover` in `src/ui/evolution.ts`) shown on hover or keyboard focus, placed beside the icon; the tile's accessible name carries the state. Side-panel powers are icon chips showing only Invoke or a live timer, with the same popover. The storm, wildfire and drought panel headings carry their crown icons. Remaining: the branching fungal-network drawing (the colony body as root, hyphae to nodes, powers as fruiting bodies) and exact effect numbers in the popover. |
| TECH-06 | Partial | Ecological superpowers: flood/storm, drought and wildfire | Storm is `TECH-03`. All three powers now exist. **Drought implemented 28 September**: `parch-crown` capstone (Exchange, after Mineral weave; 300 s age, three living bonds, 60 water banked). `src/sim/drought.ts`: 70 C + 6 N; 40 s heat warning, 90 s without rain (full severity after 25 s), 60 s recovery with relief rain, 150 s cooldown; no direction and no rolls, water decides. Rainfall falls to 0.03 region-wide (water table drops through the ordinary moisture model) and an explicit 0.25 s-beat drying pass parches topsoil away from the stream; banks stay damp. Unfed trees lose health by dryness, species root depth (hemlock worst, oak best), maturity and a per-tree seed; bonded trees drink from their junction and hold; stream-side roots are safe; dead trees stand bleached (`Tree.parched`). Shallow strands in parched soil lose water and wither unless resupplied; deep, banked and root survive. No fruiting without rain. Storm and drought exclude each other; a fire may be kindled into a drought and burns hotter because it judges soil moisture. Graphics: Voronoi cracked, bleached floor away from water; wilting/sagging/thinning background crowns; bleached leafless dead trees; the stream narrows to 25% width; pale glare and dust haze; `src/render/drought.ts` dust motes and three dust devils (1 draw). UI: `src/ui/drought.ts` refuge map, countdown, fed/lost/withered watch. **Wildfire implemented 28 September** (user-requested as the third). `ember-crown` capstone (Resilience, after Cord memory; 300 s age and 30 connected strands deeper than 16 cm). `src/sim/wildfire.ts`: 90 C + 8 N; 45 s warning, 70 s burn, 120 s aftermath, 150 s cooldown; a wind-driven front crosses toward the chosen direction, faster with tailwinds and slower with headwinds; a storm may be summoned during a fire. Hurricane winds sweep embers across all nine stands over 12 s, dry crowns face up to 97% burn odds and well-watered crowns exactly 50%; sustained rain quenches open flame 18 s after arrival. Ordinary-front exposures are judged once, from the fire's own seed, and stamped with their arrival time; the hurricane ember sweep may re-expose survivors once. In ordinary fire, crowns burn by deterministic odds from soil dryness, tree hydration, species flammability and watered firebreaks (stream banks and soil at 0.62+ are refuges); snags burn unless soaked; torched trees become charred snags or logs, scorched survivors keep bonds, and ash enriches the soil. In ordinary fire, strands under 6 cm burn unless damp, reinforced/thick or the root; in the hurricane ember sweep, damp shallow strands lose that refuge; under 16 cm they are singed (health, half carbon); deeper are untouched. A new shallow tip entering the still-hot band is judged once too, even after the leading edge passed. Fruiting bodies in the path burn with their reserve. The rival burns by the same rules. Topsoil along each transect turns to ash (organic x0.35, nitrogen up); burned stands fruit in any weather through the aftermath. Graphics: floor shader char/ember band/ash/green flush from both simulation fronts, including hurricane embers on wet ground; background trees char, drop leaves in clumps and glow in the band; playable burned trees go black and lose their crowns; `src/render/wildfire.ts` turbulent flames, torched-tree columns, smoke and embers (3 draws); pulsing orange underground light and local heat respecting shallow depth and wet soil; staged ash, pioneer flowers and grass in burned clearings. UI: `src/ui/wildfire.ts` picker with wind-based approximate arrival-time map, countdown and loss watch. Underground (all powers, `src/render/underground-weather.ts`): fire heat glowing through the top 16 cm under the passing front with an ash crust behind it; drought a pale dry front sinking up to 24 cm, sparing stream banks, with cracks opening into it. Gaps (drought): the rival does not respond; spatial colonies dry only through the soil volume's rainfall, not the explicit pass; unstepped stands rewet toward the moisture model's equilibrium, which is drier than their generated start; no sound. Gaps (all): flood implemented as the storm's water half (see `TECH-03`); no per-tree fire roar; the rival does not respond to the warning; spatial-colony stands get no voxel-soil ash; background-tree burn is a presentation hash (~70% ordinary, ~97% hurricane), not the simulation's roll; balance untuned; hardware-GPU cost unmeasured. Remaining: W3 Soak order and risk overlay, W5 more local spot-fire variation/per-tree audio and GPU timing, W6 natural played journey and balance (see the wildfire v2 record below). |
| AUDIO-01 | Partial | Generative soundscape and power themes | `src/audio/soundscape.ts` is a generative score in harmonic-series tuning on A1 (55 Hz): a breathing pad crossfading through five root fields every 36â€“56 s, sparse FM glass bells, formant "breath", a bond-driven heartbeat pulse, a 7 s synthetic hall, wind, thunder after lightning and fire crackle. It is muffled underground and changes with season, bonds, storm, fire and drought. Cues (grow, bond, fruit) are retuned into the score. `src/audio/themes.ts` gives the storm, wildfire and drought their own themes in the same tuning. Each theme's bus follows its power's intensity (about a 10 s fade); the regular score ducks to 30% beneath it; held voices stop once a theme has faded. `sound.preview(id)` plays a theme without the power, for listening. The user listened to the regular score in game and accepted it; the themes have not yet been heard. Remaining: run `test:score-view` and `tools/record-score.mjs`, listen to each theme, a volume control, and verify suspension, restart and audio failures on speakers and headphones. |
| A11Y-01 | Partial | Reduced motion and keyboard access | Direct view snapping, ambient-motion control, focus outlines, keyboard view/pan/zoom/orders, pause, and notes controls exist. Current evolution browser checks verify modal focus return, world-shortcut isolation, native Space on disclosures without awakening/pausing, and resource details on focus. Remaining: complete-game focus order, canvas alternatives, and color-independent world-state cues. |
| PERF-01 | Partial | Measured performance budget | `tools/profile-forest.mjs` measures opening and 180-second steward-grown forest samples, draw calls, triangles and renderer resource counts on stated hardware, backend and preset. Readback forces GPU-process completion; its cost is included. First sample, 19 September, 960Ã—640 normal preset on SwiftShader software rendering with a 13th Gen Intel i7-13700HX and 16 GiB: opening median 723.6 ms / p95 777.3 ms and a mature forest median 752.0 ms / p95 809.1 ms, both 183 draw calls and 322,014 triangles. A current fast SwiftShader browser sample advanced 30 seconds of a two-colony 3D simulation in 5.61 seconds without rendering those ticks. Remaining: hardware-GPU measurements, a real rendered 4Ã— mature-match budget, network-ceiling budgets and byte-accurate GPU memory. |
| PERF-02 | Partial | Scalable surface quality | An explicit opt-in fast QA preset (`?qa=fast`, `--qa fast`) halves the drawing-buffer resolution, disables antialiasing and baked tree-shadow decals, and bypasses bloom and postprocessing while preserving the CSS viewport, all nine stands, simulation, selection, camera transitions and input. Normal remains the shipping default. Authored tiers are chosen at runtime from projected size (`ASSET-03`): 0 LOD0 / 57 LOD1 / 18 LOD2 at the region overview and 44 / 31 / 0 at the closest forest framing, identical at normal and fast presets. Living authored wood and foliage are batched region-wide (`ASSET-03`), which took 150 authored parts to 12 draw calls. Remaining: production quality tiers chosen from profiling, foliage and weather tiers, and hardware-GPU frame-time budgets. Production JS is 783.73 kB (209.03 kB gzip), plus the opt-in 1.14 kB test bench with the Vite chunk-size warning. The botanical living trees cost 1,568â€“1,596 triangles at LOD0, 800â€“810 at LOD1 and 266â€“298 at LOD2; triangle counts alone are not a frame-time budget. |
| PERF-03 | Partial | Optimization pass alongside new tech and UI scope | Requested 27 September: treat performance as required work for the tech-tree growth (`TECH-04/05`), randomized starts (`MAP-16`) and continuing surface scope, not as a later rescue. Do a measured pass before and after each of those lands: capture hardware-GPU frame time (not only SwiftShader), a rendered 4Ã— mature-match budget, draw calls, triangles and renderer resource counts, and close the existing `PERF-01/02` gaps. Keep the tech-tree view out of the per-frame budget while closed, prefer one overlay plus a shared icon atlas over many textures or draw calls, watch UI DOM/CSS cost, and re-check the fast QA preset and production bundle size. `PERF-01/02` evidence describes the pre-change tree; `PERF-03` requires fresh measurements. **28 September:** simulation 2.8x faster at ~4,400 nodes (800 to 282 CPU-ms per simulated second, interleaved A/B), bit-identical results. Changes: shared-soil cell views resolve their voxel once and are replaced by the plain record, integer-cell elevations are memoized, and passability checks its cache first; unmoved nodes skip regional re-projection; the soil volume re-sorts changed cells only when new ones appear; transport precomputes per-node inputs into reusable typed arrays and runs its sweeps on arrays; flood and drought write only real changes. Real-GPU testing now exists: `--gpu`/`MYCELIA_GPU=1` for any browser tool, and `npm run check:gpu` prints the WebGL renderer and real frame rates (it forces the discrete GPU on laptops). RTX 4060 Laptop: 60 fps in both views with 72 or 4,923 strands at 1x; at 4x with 4,923 strands, 21 fps forest and 4.7 fps underground. That 4x case is the remaining bottleneck (CPU per frame multiplied by speed), not the GPU. Players on software WebGL now see a notice explaining how to enable hardware acceleration. The section viewer now retains four nearby soil meshes and skips unchanged frame rebuilds; this allocation reduction has no measured frame-time result yet. |
| QA-01 | Partial | Feature testing and direct scene fixtures | The crossing suite covers address-preserving promotion, free 3D lateral steering, a perpendicular stand-edge arrival, natural seam arrival and an independent paid spore daughter on shared soil. The regional-mature and section-view browser smokes cover section orders, empty and daughter tile access, switching, reveal, forest return, rebinding to the founding colony, an adjacent-section Grow click and a 30-second two-colony pacing sample. The regional-spatial browser smoke currently stops at the corner-start natural seam arrival; see the current verification record. The 11-check core simulation runner now copies the match's current contact dependency and passes on this tree. Remaining: repeated long-match rebase/input paths, contested same-tile contact, other broad-suite subdivision and hardware measurements. |
| SAVE-01 | Deferred | Local save/resume | Requires versioned deterministic simulation state, RNG state, bloom history, and camera/view state. |
| MULTI-01 | Deferred | Multiplayer | Do not begin before the single-player vertical slice and performance work are complete. |

## Current priorities

### Major plan: regional spread (decided 28 September; phases A to E implemented 29 September)

**Progress, 29 September:**

- **Phases A to E are implemented.** See `MAP-07`, `MAP-10`, `TECH-01`,
  `MAP-15` and `CORE-05`, and the verification record.
- **Phase F is partial.** Rival spores follow the same gust rule.
- **The rival cannot yet:**
  - cross stand edges;
  - win the region.
- **Why the rival cannot win:** it is a saprotroph that never bonds trees, so
  "more bonded trees than the rival" leaves it nothing to dominate with. The
  first open question below must be answered before F can finish.
- **Decisions taken while implementing, where the plan left a choice:**
  - **Promotion stays lazy:** a colony gets its regional body only when an
    order crosses an edge or a fusion needs it. Unsplit play is therefore
    unchanged: the 90 s fingerprints stay `raven-wood` `0837080b77c11551` and
    `storm-race` `cd272b4bfd5a5183`.
  - **Gust:** a gust is `gustAt(t) >= 0.65`.
  - **Absorbed subclusters:** a fused colony's subclusters rejoin the colony at
    large.
  - **Hold progress:** it shows in the instrument's notes line.


Self-contained plan for the next large feature. The user will schedule it. It
touches `MAP-07`, `MAP-10`, `MAP-11`, `MAP-15`, `TECH-01`, `CORE-05` and
`ADV-05`. Update those rows as each phase lands.

#### Problem

The user has played many matches and has never seen their mycelium enter a
neighbouring tile, or a spore found a colony elsewhere. Both exist in code,
but a player cannot find them:

- **Crossing.**
  - The only way across is a forest-view button, **Grow through a stand
    edge** (`#forest-cross`, `index.html:65`). It is handled by
    `Game.growAcrossStand()` (`src/game.ts` ~722), which calls
    `RegionalMatch.growAcross()` (`src/sim/match.ts` ~301).
  - That call promotes the local colony into a regional `CrossingMatch`
    (`ensureSpatialColony`) and orders it across one pre-chosen seam
    (`CrossingMatch.orderAcross()`, `src/sim/crossing.ts` ~694).
  - Underground, an unpromoted colony's section edge behaves as a wall.
- **Spores.**
  - `RegionalMatch.stepSpores()` (`match.ts` ~522, every `SPORE_BEAT` = 1 s)
    releases automatically after every completed bloom.
  - `release()` (~540) sends one spore to the first valid downwind stand from
    `sporeTargets()` (~647 â†’ `downwindStands`, `src/sim/region.ts` ~541).
    Adjacent stands are in reach at ordinary wind; `STORM.reach` 4.25 and 3
    daughters per bloom apply in a storm.
  - The parent pays `ECON.colonyFund` (46 carbon, 6 water, 3 nitrogen;
    `src/sim/content.ts`) through `payColonyFund`. If it cannot pay, it
    returns silently.
  - `found()` (~566) creates the daughter: `foundColony` plus its own
    `CrossingMatch`. The only notice is one event line in the target stand.
  - No spore flight is drawn.
- **The match ends before the region matters.**
  - `RegionalMatch.outcome` (~283) returns `fruited` at 2 blooms unless
    `regionalPlay` is set.
  - `Simulation.checkOutcome()` (`src/sim/sim.ts` ~388) stops a colony at
    `fruitGoal` blooms unless `regionalContinuation` is set.
  - `continueGrowing()` (~601) lifts both, but only after a storm.
- **Tech is per colony.**
  - `Network.evolution` (`src/sim/network.ts` ~136: learned, age, active,
    cooldown) lives on each network.
  - `src/sim/evolution.ts` says "a new spore starts anew", so every
    daughter starts with no adaptations.
- **The rival spreads only through the storm path.**
  - `prepareRival` (~685) and `foundRival` (~696) use the same release code.
  - The rival is a saprotroph (`ADV-05`) and never bonds trees.

#### Decisions (user interview, 28 September)

1. **Seamless edges.**
   - An order toward a section edge continues into the neighbouring tile.
     There is no separate crossing action, and the forest-view button is
     removed.
   - The neighbouring soil shows faintly past the seam.
   - When the frontier crosses, a prompt offers to slide the view across.
     The view never moves on its own.
2. **Spores: the player chooses when; the wind chooses where.**
   - A mature fruiting body holds its spores.
   - The player may release at any time; otherwise the next strong gust
     releases them.
   - The destination follows `sporeTargets` / `downwindStands`, as now.
   - The flight and landing are drawn, and an unaffordable release says so.
3. **Daughters are independent colonies that fuse automatically on contact.**
   - When strands of two of the player's colonies physically meet, the
     networks join into one: connectivity, stores and fruiting.
   - This supersedes the manual fusion planned in `MAP-15`.
   - A player colony never fuses with the rival.
4. **Adaptations belong to the player.**
   - What is learned applies to every current and future colony, including
     spore daughters and fused networks.
   - Powers keep a per-colony cooldown unless decided otherwise.
5. **Victory: colonize the region.**
   - Hold 5 of 9 tiles, then keep all of them until the season turns.
   - A tile counts only if the player dominates it: more bonded trees there
     than the rival.
   - Storms, fire and drought can break the hold.
6. **No bloom cap.**
   - Remove the two-bloom win and the stop-after-two-blooms rule.
   - The match ends on the regional win or on extinction.
7. **The rival plays by the same rules.**
   - It crosses edges, releases spores on the wind, and can win by holding
     5 dominated tiles through a season.

#### Phases (in order; each ends green and committed)

**A. Seamless edges (`MAP-07`)**

- **Promotion.**
  - Promote a colony to its regional `CrossingMatch` automatically:
    lazily, the first time an order targets a point at or beyond its
    stand's section edge, or on first tick.
  - Promotion already preserves node addresses, XYZ, soil and resources.
  - Remove `#forest-cross` and `growAcrossStand()` once nothing calls them.
- **Orders.**
  - Underground orders beyond the edge resolve through `CrossingMatch.growAt`
    in the neighbour's regional coordinates.
  - The edge stops being a wall.
  - Diagonal corner hops stay refused (existing rule).
- **Draw.**
  - Draw the neighbouring tile's soil a short distance past the seam
    (faded, not interactive except for orders).
  - Add a subtle seam marker.
- **Following.**
  - When a strand first enters another stand (`onActivate` /
    `growthCrossings`), show a prompt: "Your frontier has entered the
    <community>. Follow â†¦".
  - Accepting calls `enterStand(id)` and opens the matching section.
  - The view never moves by itself.
- **Tests.**
  - Extend `tools/test-crossing.mjs`: an order past the edge grows across
    without a promotion call, conservation holds, and addresses are
    unchanged.
  - Extend or add a browser test: click beyond the edge underground, the
    strand arrives, the prompt appears, and following opens the neighbour.
- **Risks.**
  - Greedy steering stalls around large obstructions (known `MAP-07` gap);
    this may need a simple detour or search.
  - The unsplit-colony fingerprints (`raven-wood` `0837080b77c11551`,
    `storm-race` `cd272b4bfd5a5183`, 90 s at 60 Hz) change if promotion
    happens on first tick. Record the new values deliberately.

**B. Visible, player-timed spores (`MAP-10`)**

- **State.**
  - Replace the automatic `stepSpores` release with a `ready` state on
    completed blooms: a mature body holding spores.
  - Add a **Release spores** action on the body (both views) and in the
    instrument.
- **Gusts.**
  - Define "strong gust" deterministically from `region.windAt(time)`, for
    example strength â‰¥ a threshold, sampled on the fixed step.
  - An unreleased body releases on the first gust.
  - Storm behaviour (`heldSpores`, `STORM.daughtersPerBloom`) is unchanged.
- **Cost feedback.**
  - Check the cost before release.
  - If the parent cannot pay `colonyFund`, keep the spores and say so
    ("needs 46 carbon, 6 water, 3 nitrogen in connected strands"), instead
    of failing silently.
- **Draw.**
  - A spore cloud rises from the body, drifts downwind across the forest
    toward the target stand and settles.
  - The daughter's founding is announced region-wide, and the survey (`S`)
    updates.
  - Add an audio cue in the score.
- **Tests.**
  - Headless: a held body releases on command and on the first gust, never
    twice; an unaffordable release keeps its spores and messages; the
    destinations equal `sporeTargets`; replay is deterministic.
  - Browser: release from a mature body and see the flight, the landing and
    the new colony.

**C. Player-owned tech (`TECH-01`)**

- **Migration.** Move `learned` and the adaptation state from
  `Network.evolution` to a per-player owner on `RegionalMatch` (for example
  `match.lineage.player` / `.rival`).
- **Readers.** Every effect in `src/sim/evolution.ts` and the transport,
  harvest and fruiting code that reads `net.evolution.learned` must read the
  owner's set instead.
- **Colony-scoped state.** Readiness checks such as `bonds(n)` and
  `n.evolution.age` stay per colony or become region-wide; decide per
  adaptation. Power `active` and `cooldown` stay per colony (default).
- **Daughters.** A spore daughter immediately benefits from everything
  learned.
- **Tests.**
  - Update `test-evolution`: a daughter founded after learning has the
    effects.
  - Learning in one colony applies to all.
  - Single-colony fingerprints are unchanged.

**D. Automatic fusion (`MAP-15`, superseded design)**

- **Contact.** Detect contact when a living strand of one player graph is
  26-neighbour adjacent to a living strand of another player graph in the
  shared `SoilVolume`.
- **Merge.**
  - Join them under one network: the older root survives, the other graph's
    root is re-parented to the contact node, and every resource is conserved
    exactly.
  - Keep stable node and tree-bond ownership and lineage history, and record
    a fusion event.
  - Subcluster groups (`CORE-08`) survive, with ids made unique.
- **Rival.** Never fuse with the rival.
- **Tests.** In a crossing-suite fixture with two daughters grown into
  contact:
  - one network results;
  - totals are conserved;
  - bonds are kept;
  - a piece severed after fusion starves as before;
  - replay is deterministic.

**E. Regional victory and no bloom cap (`CORE-05`, `MAP-10`, `MAP-11`)**

- **Remove the cap.**
  - Remove the `fruited >= 2` outcome in `RegionalMatch.outcome` and the
    `fruitGoal` stop in `Simulation.checkOutcome`.
  - `regionalPlay` becomes the default.
  - Extinction stays a loss.
- **Win rule.**
  - Domination per tile: the player holds strictly more bonded trees there
    than the rival.
  - Hold: 5 or more dominated tiles; the season index must advance once
    while the count never drops below 5.
  - The win fires at the season turn.
- **Show progress.**
  - Survey and instrument show "Tiles held: n / 5" and the hold progress
    through the season.
  - A broken hold is announced.
- **Tests.** Headless fixtures cover:
  - 5 tiles reached, then held through a turn: win;
  - one lost mid-season: no win, and the hold resets;
  - a tie with the rival does not count.
  - Update `test-journey` and `test-sim` expectations that assume a
    two-bloom win.

**F. Rival parity (`ADV-05`, `MAP-10`)**

- **Growth.** The rival crosses edges (phase A mechanics), and its
  fruiting and spore release follow phase B rules (timing policy: open
  question).
- **Its win.** A rival victory by the same hold rule needs a domination
  measure the rival can meet; see the open questions.

#### Cross-cutting constraints

- **Determinism.**
  - Every new decision (gusts, contact, domination) is computed on the fixed
    step in stable stand order.
  - Seeded runs stay reproducible (`MAP-13`).
  - Re-record the fingerprints only on purpose.
- **Conservation.** Carbon, water and nitrogen are conserved through
  release, founding and fusion (`CORE-02`).
- **Performance.**
  - More colonies and cross-tile graphs raise simulation cost.
  - Measure with `npm run check:gpu` and `tools/bench-large-network.mjs`.
  - The 4Ã— forest-view drop recorded 28 September is still unexplained.
- **Tests.** Headless modules must avoid TypeScript parameter properties
  (`stripTypeScriptTypes`). New modules must be added to the hard-coded
  module lists in `test-sim`, `test-region`, `test-dressing`, `test-crossing`
  and `test-roots`.
- **This file.** Record current evidence in this file per phase.

#### Open questions (ask the user before the phase that needs them)

- **Rival domination (E, F).** The rival is a saprotroph and never bonds
  trees. How does it dominate a tile? For example: strands or occupied
  soil, dead matter claimed, or trees it has killed. Also, how is "more
  bonded trees than the rival" compared against it?
- **Gust threshold and cost (B).** What wind strength counts as a strong
  gust, and does `colonyFund` stay at 46 carbon, 6 water and 3 nitrogen?
- **Rival release timing (F).** Scripted, or opportunistic like the gust
  rule?
- **Hold display (E).** Instrument, survey, or a new regional banner?
- **Tech without a colony (C).** What happens to player tech if the player
  has no living colony? Extinction ends the match anyway, so this may not
  matter.
- **Powers after tech moves (C).** Are powers still invoked from a chosen
  colony, with a cooldown per colony?

#### Done when

- A new player, without instructions, sees their strands cross into a
  neighbouring tile and follows them there.
- They release spores from a mature body, watch them drift and land, and
  play the daughter.
- They see two of their colonies fuse on contact.
- Every colony uses the tech they learned.
- The game ends by holding 5 dominated tiles through a season turn, or by
  the rival doing so.
- All suites and the regional browser checks pass, with evidence recorded
  here.

Work in this order unless the user explicitly changes priority.

27 September user direction: the next tech/power feature is `TECH-03`,
**Summon storm**, with actual regional dispersal and colonization effects.
Implement it against the existing shared-soil model; it must not wait for
additional playable factions or imply that multiplayer already exists.
The spatial and performance work below remains necessary supporting work.

27 September user direction: the opening must stop always resolving to the
same stand. When a match is generated, choose the player's starting stand at
random from the region's habitable, water-reachable stands, and start the
opponent mycelium in a different starting stand than the player. Derive both
choices from the match seed so `MAP-13` replay stays exact, and keep `MAP-09`'s
reachability and water-in-reach guarantees for whatever stand is drawn.
Recorded as `MAP-16` (Planned); no implementation exists yet.

### Major plan: wildfire v2, fire that reads the network (written 29 September; W1, W2, W4 done; W5 visual subset done)

**Progress, 29 September:**

- **User direction, 29 September: owner-agnostic rules.** The opponent is a
  placeholder. Future opponents will be people or LLM agents, possibly
  playing different starting factions or species groups. Rules are therefore
  owner-agnostic, and species differences sit behind traits.
- **W2, remains and nutrient release (done).**
  - **Where remains live.** They are part of the burned tree:
    `Tree.burned.{nitrogen,organic}` and their starting values.
    `charRemains` gives a store of 0.03 nitrogen and 0.04 organic matter per
    unit of biomass.
  - **Decay.** `stepRemains` in `src/sim/world.ts`, run in `Simulation.step`,
    releases the store into the soil within 3 columns and 12 cm of the trunk,
    over 300 s for a snag and 480 s for a log. A cell that is already full
    takes less, and what it cannot take stays in the remains, so the total is
    conserved. Spent remains become `stump` and render as
    `prop.charred-stump`.
  - **Change from the plan: no direct transfer.** A new network trait,
    `Network.traits.decomposer`, doubles the decay pace where that colony's
    strands reach the remains. The placeholder rival has the trait; the
    player does not. Nothing is handed to a side directly: whoever's strands
    are in that soil takes it up through normal uptake.
  - **Change from the plan: faster, not cheaper.** A cheaper fruiting body
    would have created energy, because the body's store is fixed. Instead,
    fruiting on burned ground matures 1.3x faster (`ASH_FRUIT_SPEED`, through
    `StepContext.fruitSpeed`), at the same cost.
  - **Gap closed:** the ash flush now reaches regional bodies too
    (`CrossingMatch.ashFlush`). They previously got no post-fire flush.
  - **Verification, 29 September (W2 tree, before concurrent fire-render
    work):** `node tools/test-wildfire.mjs` passed 14 checks, including four
    W2 checks: 67 burned trees held 52.4 nitrogen; decay moved 0.90 nitrogen,
    conserved, then left a stump; a decomposer released 0.225 against 0.112
    in a minute; ash fruiting matured in 26.25 s against 34 s. Replay
    fingerprints without fire were unchanged (raven-wood `8e90afcc63ba88f4`,
    storm-race `45160dc3472d0e23`). `test-sim` and `test-region` passed;
    `test-wildfire-view` and `test-underground-view` passed on a build that
    also held uncommitted fire-render edits by another agent. The rest of the
    headless suite was stopped before it finished and has not been run on
    this commit. The snag, the fallen log and the stump were checked by eye on
    the GPU.

- **W1, hydration and new ignition (done).**
  - `Tree.hydration` (`stepHydration` in `src/sim/world.ts`, run in
    `Simulation.stepTrees`) is 0.6 of the bond water delivered plus 0.4 of the
    soil water at rooting depth. It is an exponential moving average with a
    40 s time constant.
  - `Wildfire.treeOdds` combines:
    - intensity: dryness 0.55 to 1.2, fuel from dead wood and topsoil
      organic matter, and the firebreak;
    - hydration;
    - `FLAMMABILITY` (hemlock 1.25, birch 1.1, oak 0.7), with maturity and
      health.
  - Burn chance is `flam * intensity * (1 - hydration)^1.6`, capped at 0.97.
    Refuges stay at 0 in ordinary fire; hurricane embers override them with a 50% tree roll.
  - Outcomes: torched (a snag, or a log felled downwind at high intensity),
    scorched (health loss, bonds kept), or spared.
  - Trees are judged in front order, so a watered belt weakens what follows.
    `burned` records `remains` and `biomass`.
  - The fire watch reports trees torched, scorched and spared per fire.
  - In ordinary fire, hydration 1 means no torching: the open question on a hard floor is
    still open.
- **W4 assets (done).** `tools/make-fire-assets.py` builds eleven assets with
  gentle LODs:
  - charred oak, birch and hemlock (variant `charred`, no foliage);
  - two charred logs, a charred stump and an ember bed;
  - fireweed, its first shoots, goldenrod and an ash bed.
- **Wildfire rendering and recovery (done in this pass).** Flame sheets now
  have turbulent tongues and hot cores; smoke billows, lights from below and
  dissipates without an initial origin puff. Newly torched trees carry short
  flame columns, and smoke dwindles over the first 60 s of aftermath. The
  underground ceiling breathes orange during the active fire; its brighter
  local heat is limited to the top 16 cm and suppressed by wet soil and stream
  banks. Spatial nodes are judged by their canonical XYZ depth, not section
  row; a new shallow tip entering the still-hot flame band burns once even if
  the leading edge has passed. Tree ignition and felling rolls are keyed to
  tree and fire sequence, so extra strands do not alter later crown outcomes.
  The scar footprint remains after the 120 s ash flush. Ash and coals
  appear first, then fireweed shoots, then fireweed and goldenrod flowers, with
  clumps of grass returning slowly until 480 s after the front passes. The
  floor and existing low cover recover gradually; charred logs wear their own
  authored models. The flowers and grass are presentation, not new resource
  producers or simulated populations.
- **In the game.** A playable tree the fire kills now swaps to its species'
  charred snag (`treeAsset` / `dress` in `src/render/surface.ts`); fallen trees
  wear the charred log assets and spent remains become charred stumps.
- **Still to do:**
  - W3: the Soak order, risk overlay and strategic watch;
  - W5: local spot-fire variation beyond the region-wide hurricane ember sweep, per-tree roar, and hardware GPU timing of the new effects;
  - W6: a naturally earned and played Ember crown browser journey and balance
    across sites and watering strategies. The background canopy still uses a
    presentation hash rather than the simulation's individual burn outcome.


A self-contained plan to deepen the existing Ember crown wildfire (`TECH-06`).
It is an upgrade, not a first build: v1 has been playable since
28 September. Update `TECH-06` as each phase lands.

#### What v1 does today

- **Front.** `src/sim/wildfire.ts` runs one straight front across the region
  in the kindler's direction. Timings: 45 s warning, 70 s burn (`FIRE.band`
  24 units), 120 s aftermath, 150 s cooldown. Cost is 90 carbon and 8
  nitrogen. Everything is judged once, from the fire's seed, when the front
  reaches it.
- **Which trees burn.** `burnTree` rolls a crown against the soil moisture at
  the tree's roots only. The chance runs from 25% to 100%. Stream banks and
  soil at 0.62 or wetter are refuges, and snags always burn unless soaked.
- **Tree outcome.** A burned tree becomes `dead` with `burned: { at }`. Its
  bonds end, and ash adds organic matter and nitrogen to its cell.
- **Network.** Strands shallower than 6 cm burn, those shallower than 16 cm
  are singed, and cords and the root survive. Fruiting bodies in the path
  burn.
- **Aftermath.** The topsoil turns to ash, and burned stands may fruit in any
  weather through the aftermath.
- **Graphics.**
  - The floor chars and glows.
  - Background crowns char through a presentation hash of about 70%.
  - A playable burned tree keeps its living model, recoloured black, with its
    foliage collapsed.
  - `src/render/wildfire.ts` draws one flame wall, smoke and embers (3 draws).
- **Gaps this plan closes:**
  1. Whether a tree burns ignores the mycorrhizal network. The player's water
     supply to a tree (`tree.waterReceived`, set in `drawTreeDemand`) plays no
     part, so fire cannot reward caring for partners.
  2. Burned trees leave no remains: no charred snag, no fallen charred log,
     and no slow nutrient release to fight over.
  3. There is one kind of flame. There are no torching trees, ground fires or
     smouldering remains, and fires have no sizes.
  4. The player has no preparation or counterplay during the warning beyond
     growing deep. Fire is a coin flip, not a plan.

#### Design goals

- **Water is fire armour.** A tree the network keeps well watered resists
  fire. A tree nobody feeds is dry kindling. The strongest defence is the
  mycorrhizal bond itself.
- **Fire leaves resources, not just loss.** Charred snags and logs are
  nutrient banks that decay over minutes. Whoever reaches them profits: the
  player's hyphae through uptake, the saprotroph rival by decomposing.
- **The kindler plans and the world answers.** Choosing direction and
  timing, hydrating the trees you want to keep, and letting the fire clear
  rival-held and unsupplied stands should be a real strategy with real risk.
- **Deterministic and conserving.** As now, every outcome is judged once, at
  the front's arrival, from the fire's seed. Nutrients released from remains
  come from the burned tree's recorded biomass, not from nothing.

#### Mechanics

**M1. Tree hydration (new state, simulation-owned).**

- **The state.** `Tree.hydration`, from 0 to 1, is a smoothed measure of how
  well watered the tree is. Update it each tree step as an exponential moving
  average with a time constant of about 40 s, so a last-second watering does
  not fully armour a tree.
- **The blend:** `hydration = 0.6 * bondWater + 0.4 * rootSoil`.
  - `bondWater` is the averaged `tree.waterReceived` from all its bonds. It is
    0 when unbonded, and a severed or starving bond decays it.
  - `rootSoil` is soil water at the tree's rooting depth (not only 6 cm), plus
    `streamNear * 0.5`.
- **Drought feeds it.** Drought lowers `rootSoil`, and a parched tree is
  `hydration` 0 (a drought then a fire is the deadly combination, as now).
- **Readable in both views.** The tree record shows it, and the risk overlay
  (U1) shows it during the warning.

**M2. Fire intensity at the tree.**

- **Formula:** `intensity = baseIntensity * fuel * dryness * wind`.
  - `fuel`: dead trees and snags within 12 units, fallen logs, and litter or
    organic matter in the top 5 soil rows.
  - `dryness`: 1 minus the averaged `rootSoil` of the stand, with a bonus
    under drought.
  - `wind`: aligned with the front direction.
- **Firebreaks.** Intensity falls where the front has just crossed
  well-hydrated trees (the mean hydration of trees crossed in the last 20
  units). This makes a green belt of watered trees a real firebreak
  downstream: fire weakens as it crosses cared-for ground.

**M3. The outcome for each tree**, rolled once, at arrival, from the seed.

- **Species flammability** (bark and crown):
  - hemlock 1.25: thin bark and low branches, it torches.
  - birch 1.1: papery bark.
  - oak 0.7: thick bark.
  - Maturity lowers it a little (thicker bark); low health raises it.
- **Burn chance:** `p = clamp(speciesFlam * intensity * (1 - hydration)^1.6, 0, 0.97)`.
  Refuges (stream banks, soaked soil) stay at 0.
- **Four outcomes:**
  - **Spared** (no mark).
  - **Scorched:** the ground fire passes. The tree loses 0.2 to 0.4 health,
    gains a bark scar (`Tree.scorched`), keeps its bonds and recovers if
    supplied.
  - **Torched:** a crown fire. The tree dies as a charred snag, its bonds end,
    and `Tree.burned = { at, remains: 'snag', biomass }`.
  - **Torched and felled:** at high intensity with low hydration, the snag
    falls within 20 to 60 s as a charred log, oriented downwind
    (`remains: 'log'`).
- **Existing dead trees and snags** always burn unless soaked, and become
  charred logs or ash (as now).

**M4. Charred remains as a resource (new state).**

- **The ledger.** `World.remains` holds each charred snag or log:
  `{ id, gx, kind, biomass, nutrient, decay }`. `biomass` comes from the
  tree's height and maturity. Remains decay over 4 to 8 minutes.
- **Release.** Each second they release organic matter and nitrogen into the
  soil cells around them, down to 12 cm. This is a slow pulse, larger for
  logs, and it is conserved: the total released equals the stored nutrient.
- **The race.** Player hyphae in those cells take the nitrogen up normally.
  The saprotroph rival decomposes remains 2x faster where its strands touch
  them and gets the whole remaining pulse, so the fire creates a race for the
  logs.
- **Fruiting.** Fungal fruiting on ash beds costs about 25% less surplus in
  the aftermath. This is the pyrophilous flush, a real-world morel analogue,
  and it extends the existing any-weather rule.
- **Stands.** Remains count as deadwood for the stand's community look.
  Snags stand until they fall or decay; logs lie until decayed, then leave a
  low charred stump (`remains: 'stump'`) as a marker.

**M5. Network damage (keep v1, tune).**

- **Unchanged:** strands shallower than 6 cm burn, and those shallower than
  16 cm are singed.
- **Now scaled by intensity:** a low-intensity pass singes rather than kills.
- **Firebreak strands:** strands on a watered route (the `supply` flag in
  transport) carry water and resist like damp soil, a small bonus.
- **The kindler:** gets no immunity, as now.

**M6. Spotting (optional, phase W5).**

- At high intensity the front throws embers up to 30 units ahead. These are
  seeded spot fires that may ignite dry fuel early (a dead tree or a dry
  unfed tree). They make the fire less predictable, but only where the
  ground is dry.
- Hydrated trees are immune to spotting.

#### Strategy the player should find

- **Protect.**
  - During the 45 s warning, the new order **Soak** (U2) directs water along
    routes to chosen bonded trees, raising their hydration.
  - Deep cords survive regardless.
  - A well-watered stand stays green, and its trees keep counting toward the
    regional hold (`CORE-05`).
- **Clear.**
  - Aim the front through stands where the rival dominates, or where trees
    are unsupplied.
  - Burned trees end the rival's claims (once the rival has a domination
    measure, `MAP-16` and `ADV-05`), and unfed trees clear into logs.
  - The player then races the rival for the remains.
- **Harvest.**
  - Place strands near expected logs before the fire.
  - Fruit cheaply on ash in the aftermath.
  - Send spores from the flush.
- **Risk.**
  - Unsupplied bonded trees and shallow networks burn.
  - A hold can break (`CORE-05`).
  - Fire in a drought is far worse.
  - The fire is shared with every colony.
- **Rival response (ADV).** The rival AI should retreat shallow strands and
  prioritise nearby logs. This can be minimal at first.

#### Interface

- **U1. Risk overlay during the warning (forest view).**
  - Each playable tree shows a ring at its foot:
    - green: likely spared or scorched;
    - amber: at risk;
    - red: likely torched.
  - The ring comes from the same hydration, intensity and flammability terms,
    evaluated without the random roll.
  - The tree popover shows its hydration percentage and "fed by your network".
  - The picker's arrival map shades the stands by expected loss.
- **U2. The Soak order.**
  - Available during the warning, and costs water. It marks up to 3 bonded
    trees. Transport treats their routes as supply routes with fill to
    capacity, as `supply` does now. Hydration rises over about 40 s, so
    early action matters.
  - Shown in the fire panel as "Soak partners (n/3)". A click on a crown in
    the forest adds or removes it.
- **U3. The loss watch.**
  - Extend the existing watch with: trees torched, scorched and spared;
    remains created; and the nutrients waiting in remains.
  - Remains glow faintly in the forest when the colonies reveal is on.

#### Art and effects (Blender, generous budgets)

- **Charred trees**, one per species, each with 3 LODs, drawn after
  `tools/make-forest-v3-assets.py`:
  - `tree.oak-charred`: a blackened trunk with broken crown stubs and a
    split, glowing seam;
  - `tree.birch-charred`: peeled bark curls burned to black, with pale char
    streaks;
  - `tree.hemlock-charred`: a spike with scorched branch stubs.
  - Manifest variant `charred`, with no foliage. The `check-forest-assets`
    rule for `dead-hollow` extends to `charred`.
- **Remains:** `prop.charred-log-a` and `prop.charred-log-b` (fissured, with
  alligator-skin char), `prop.charred-stump`, and `prop.ember-bed` (glowing
  coals, used during smouldering).
- **Scorched living trees:** no new model. The bark takes a scar tint and the
  lower trunk a char band (a shader on the existing tree materials).
- **Aftermath:** `understory.fireweed` (pink spikes) and `understory.ash-bed`
  (a pale grey patch), which appear on burned ground through the aftermath
  and a season after.
- **Fire effects, in sizes:**
  - **Ground fire:** low flickering flame sheets along litter, for scorch and
    spare outcomes.
  - **Torching tree:** a column of flame up the crown, seconds long, then
    smoke. Size scales with tree height and intensity.
  - **Crown run:** the existing flame wall, modulated by `intensity` so weak
    fronts are patchy.
  - **Smouldering remains:** ember glow and a thin smoke plume on snags and
    logs for 30 to 60 s.
  - **Spot fires:** small points ahead of the front (M6).
  - Pooled instanced sprites, ideally 2 draws for all tree fires and 1 for
    smoulder. Budget checked with `npm run check:gpu`.
- **Surface integration.**
  - A torched tree swaps to its charred asset through `treeAsset`, at the
    moment of the burn.
  - A felled one animates over using the storm's fall code (`fallen`), then
    swaps to a charred log.
  - Background dressing keeps its shader char. It can optionally swap
    decorations to charred variants by the same presentation hash.
- **Audio:** a per-tree torch roar layer in the fire theme, and crackle
  proportional to live burning trees.

#### Phases (each ends green and committed)

- **W1. Hydration and new ignition.**
  - Add `Tree.hydration` and its update, M2 intensity and M3 outcomes.
  - Headless tests:
    - a fed tree with high hydration survives more often;
    - scorched trees keep their bonds;
    - determinism;
    - refuges hold.
  - Re-record the fire fixtures on purpose.
- **W2. Remains and nutrient release.** Add `World.remains`, decay and
  release (with a conservation test), felling to a log, the rival decomposing
  faster, and the ash fruiting discount.
- **W3. Strategy interface.** The U1 overlay, the U2 Soak order with tests
  that it raises hydration, and the U3 watch.
- **W4. Assets.** Charred trees (3 LODs), logs, stump, ember bed, fireweed
  and ash bed, with `test:assets`, and the swap in `surface.ts`.
- **W5. Effects.** Tree fires in sizes, smoulder, intensity-modulated flame
  wall, and optional spotting (M6). Measure with `check:gpu`.
- **W6. Balance and browser.** A played fire from the Ember crown in a
  browser test (`test-wildfire-view` extended): kindle, soak, burn, remains,
  flush. Then tune hydration weights and flammability so a well-fed network
  keeps most of its partners and an unfed stand mostly burns.

#### Constraints

- **Deterministic:** fixed order, and one roll per tree per fire from the
  fire seed. Hydration is state and is updated in step order.
- **Conserving:** released nutrients equal each tree's stored biomass.
- **Coexists with the existing powers:** storm can be summoned during an active fire;
  drought makes fire worse.
- **Tests:** follow the headless-module rules (no TypeScript parameter
  properties, and add new modules to the hard-coded test lists).
- **Budget:** fire effects must stay within `check:gpu` at 60 fps.

#### Open questions (ask before the phase that needs them)

- **Soak (W3):** cost and the partner limit (3?). Is it only during the
  warning, or also during the burn?
- **Fire under your own feet:** should the player's own well-fed trees ever
  burn at full intensity, or is hydration a hard floor?
- **Rival and remains (W2):** should the rival gain from remains strongly
  enough to make fire risky to use near it?
- **Background trees (W4):** should they also leave charred remains, or only
  the playable ones?

### Major plan: contact war, networks that fight (decided 29 September; C1 and C2 first pass done 29 September)

**Progress, 29 September:**
- **C1 done.** `src/sim/contact.ts` implements fronts, passive fighting and
  elimination.
  - Contact means strands within 2 voxels.
  - A contact node spends 0.15 carbon/s and deals 1 health per carbon,
    divided by the target's armour: 1 + 2 Ã— thickness, Ã—1.5 if reinforced,
    Ã—1.5 for a founding node.
  - Overgrowth gives the killer 50% of the victim's carbon.
  - A bounding-box check skips everything that is not near another owner.
    Replays with no contact are unchanged.
- **C2 first pass.**
  - The six chemicals are orders: `ContactWar.cast(owner, chemical,
    point)`.
  - Reach is 7 voxels. Payment comes from connected strands within 9 voxels
    of the source.
  - The keys Q W E A D C cast at the cursor underground; Z jumps to the
    busiest front and frames it.
  - `src/ui/contact.ts` adds the hotbar with costs and cooldown shading, and
    the pulsing front alert.
  - `src/render/contact.ts` draws a first pass of effects: tinted bursts,
    lingering leachate, the barrage ring, and a dark pulse at each front.
  - The placeholder rival (`ContactWar.bots`) lyses every 1.4 s and bursts
    oxalate every 9 s when it can.
- **First real-match reading.** A player colony founded in the rival's stand
  met the rival after about 40 s. Left alone, it lost about 70 strands in
  25 s to the rival's much larger body and its casts. An unattended front is
  meant to lose, but C6 must tune this.
- **Still to do:**
  - C3: zone-line art, dying hyphae turning grey, and the contact score.
  - C4: a stand-map pulse, and control groups for fronts.
  - C6: balance.


**User direction (29 September):**
- When two networks meet, they fight directly: tangling, rerouting and
  chemical warfare, all paid for in resources.
- Aim for StarCraft-like play: fast clicking on the frontier while also
  tabbing away to manage the economy elsewhere.
- A front **can eliminate a colony outright**.
- Different abilities use different chemicals. Each is **one key, easy to
  spam, aimed at the mouse**. Light attacks cost one resource; heavy attacks
  cost a combination.
- LLM agents and people are both fast enough to play in real time, so pace
  stays real-time.
- Factions are undecided. All rules are owner-agnostic: any network fights
  any network of another owner.

**Biology it draws on.** When two individual fungi meet, three things happen:
- interference: hyphae touch and one lyses the other;
- chemical warfare: enzymes, antibiotics, ammonia and oxalic acid;
- a melanised barrage, the zone line seen in spalted wood, where neither side
  wins.

The outcome is either deadlock or replacement.

#### Mechanics

- **Fronts.** Two networks are in contact wherever living nodes of different
  owners lie in neighbouring voxels (regional XYZ, `node.spatial`).
  `src/sim/contact.ts` (`ContactWar`, owned by `RegionalMatch`) finds every
  contact four times a second over `regionNetworks`, in a stable order.
  - Contacts are grouped into fronts by stand and pair of owners.
  - A new front announces itself once.
- **Passive fighting.** Each contact node spends a little of its own carbon
  every second to damage the enemy nodes touching it.
  - Damage is divided by the target's armour. Thick cords and reinforced
    strands are tougher.
  - A node that has run dry does no damage.
  - Supply therefore decides fronts: transport refills the carbon a front
    spends, so a well-fed front wins and a severed one loses.
  - Damage is gathered first and applied together, so the order in which
    networks are processed gives no advantage.
- **Overgrowth.** A node killed in a fight gives half its carbon to the node
  that killed it, which also counts toward `genetic`. The rest returns to the
  soil as dead strands do.
  - The strands beyond a killed node are severed and starve through the
    existing rules.
  - A front that reaches the founding node cuts off the whole colony, which
    starves out. That is elimination.
- **Chemicals: one key each, aimed at the mouse.**
  - Every chemical is secreted from the caster's nearest living connected
    strand within reach of the cursor.
  - It is paid from connected strands near that source, so spamming drains
    the local front until transport catches up. This is the link between
    fighting and the economy.
  - Every cast is a deterministic order `{owner, chemical, point}`, the same
    for a person, an agent or a replay.

| Key | Chemical | Weight | Cost | Effect |
|---|---|---|---|---|
| Q | Lysing enzymes | light | carbon | Burst of damage in a small radius; weak against cords. |
| W | Leachate | light | water | An antibiotic that lingers and spreads in the soil water; damage over time, stronger in wet soil. |
| E | Ammonia | light | nitrogen | Damage, and knocks nitrogen out of enemy strands into the soil. |
| A | Oxalate burst | heavy | carbon and nitrogen | Large, heavy burst that partly ignores cord armour. |
| D | Coil | heavy | carbon, water and nitrogen | Seizes the thickest enemy strand in reach and kills it: a cord cut that severs what lies beyond. Cannot kill a founding node outright. |
| C | Barrage | heavy | carbon and water | Melanised zone line: your strands inside take much less damage for a while, and enemy strands inside slowly lyse. |

- **The placeholder opponent.** Opponents named in `ContactWar.bots` cast the
  same orders on a simple timer, lysing where they touch and bursting when
  they can afford it. This stands in for people and agents; it is not a
  target for AI depth.

#### Phases

- **C1. Fronts, passive fighting and elimination.** In the simulation, with
  headless tests: contact detection, supply-limited damage, overgrowth,
  severing, elimination, and replay fingerprints unchanged without contact.
- **C2. Chemicals as orders.** The six casts, with costs, cooldowns, reach,
  local payment and lingering effects. Keys Q, W, E, A, D and C, aimed at the
  cursor in the underground and section views.
- **C3. Effects and sound.**
  - Contact zones darken into zone lines.
  - Casts bloom as tinted stains in the soil.
  - Dying hyphae fade grey.
  - A dissonant layer joins the score while a front is hot.
- **C4. StarCraft-style controls.**
  - An alert when a front opens; Space or a click jumps to it.
  - Fronts pulse on the stand map.
  - A chemical bar with costs and cooldowns under the cursor.
  - Control groups for fronts.
- **C5. The placeholder opponent casts** (the minimum is in C2).
- **C6. Balance** on the GPU in real play: front duration, cost of spam, and
  how long elimination takes.

**Open questions:**
- Should fights happen only inside a stand, or also across stand edges?
  (Today: anywhere nodes touch.)
- Should chemicals harm trees and roots?
- How much should the contact score counter-weigh the calm soundtrack?

### Major plan: agent players through System One models (decided 29 September; first pass done 29 September)

**User direction (29 September):**
- Opponents will include LLM agents and "System One" decision models
  playing in real time alongside people.
- Start with the fast, cheap kind: TypeSafe **Jev** and OpenAI's
  **Decisions API**.

**What the providers are:**
- **Jev** (https://docs.typesafe.ai/api):
  - `POST https://api.typesafe.ai/v1/systemone` takes `{state, model:
    "jev-latest", questions}`.
  - Questions are typed:
    - `choice` (up to 255 options), which answers `choice`, `probabilities`
      and `confidence`;
    - `score` (2 to 10 levels);
    - `noul` (yes/no), which answers the probability of yes.
  - About 100 ms. Input costs $0.042 per million tokens and output is free.
  - Limits: 1,200 requests per minute and 64k context. Text only.
- **OpenAI Decisions API** (DevDay, 29 September 2026):
  - GPT-6 Luna in a limited preview.
  - You define questions with a finite set of answers and send context as
    text or images; answers come back with confidence in about 150 ms.
  - The request schema and pricing are **not public**.

**Design (System One style, code in control):**
- **The model only picks from closed options.** It never invents
  coordinates or free-form actions. The code proposes and labels the
  candidates; the model chooses among them.
- **Observation** (`src/agent/observe.ts`). A compact JSON state for one
  owner:
  - its own and the enemy's resources;
  - fronts, fight tallies, and chemical costs and cooldowns;
  - up to 8 labelled target strands (nearest, most strands cut off,
    thickest), each reachable from a connected strand of the owner;
  - up to 6 growth options: toward the enemy founding strand, toward dead
    or burned wood, toward a living tree, deeper, or hold.
- **Questions** (`src/agent/decision.ts`), all in one request:
  - `stance` (attack / hold / withdraw / expand);
  - `chemical` (none plus whichever of the six are off cooldown);
  - `target`;
  - `growth`;
  - `strike` (noul);
  - `losing` (noul).
- **Acting** (`act`). Answers become the same validated orders a person
  uses: `ContactWar.cast` and growth waypoints.
  - A pick below confidence 0.35 is not acted on.
  - Whether to cast is its own yes/no question: a cast needs strike â‰¥ 0.5,
    and the spread-out chemical choice then only needs confidence 0.15.
    Live, Jev's chemical confidence sat at 0.2 to 0.45 while strike was
    about 0.85, so gating on the chemical alone withheld sensible casts.
  - Stance limits what is allowed: a withdrawing colony may only barrage.
  - Out-of-set answers do nothing.
  - An identical growth order is not re-sent within 20 s.
- **Controller** (`src/agent/controller.ts`).
  - Asks every 250 ms of wall-clock time, only while game time is moving,
    with one request in flight; the game never waits. A ~200 ms model
    therefore decides about 4 times a second, fast enough to micro a
    front.
  - A landed answer is applied on the next frame.
  - A failure falls back to the offline heuristic.
  - Switching provider discards stale answers.
  - A 5 s wall-clock watchdog drops a request that never returns.
  - The agent replaces the placeholder bot for its owner.
- **Relay** (`server/decide.ts`). API keys never reach the browser.
  - It is served at `/api/decide` by a Cloudflare Pages Function
    (`functions/api/decide.ts`, keys as Pages secrets) and by a Vite
    middleware in dev and preview (keys in the git-ignored `.env.local`).
  - GET reports which providers are configured; POST validates the
    request, calls the provider and normalises the answers.
  - Jev questions pass through unchanged.
  - The OpenAI mapping is isolated in `openaiRequest` and `normaliseOpenAI`
    and is **unverified** until the preview docs are available. It needs
    `OPENAI_DECISIONS_URL` to be enabled at all.
- **In the game.** The Opponent disclosure picks who plays the rival:
  - the placeholder bot;
  - the offline heuristic agent;
  - Jev;
  - OpenAI Decisions.

  `?opponent=local|jev|openai` sets it at load. A readout shows the model,
  latency, stance, actions, failures and tokens used.
- **Cost, measured live.** A decision request with a live front is about
  1,650 to 1,900 input tokens. At about 4 decisions a second on Jev that is
  about $1 per hour of play.

**Still to do:**
- Confirm the OpenAI Decisions schema with preview access.
- Keep a per-owner order log for replays: agent decisions arrive
  asynchronously, so a replay needs recorded orders, not re-queried models.
- Let an agent play the player's side and agent-versus-agent matches, and
  give it fruiting, spores and powers as further questions.
- Offer an image state for OpenAI, once it is confirmed.
- Add a slower "System Two" LLM for strategy that sets the stance and
  targets for the fast layer.

### Tech effects: implemented behavior and remaining work

The tech tree is not a set of cosmetic unlocks. `src/sim/evolution.ts` owns
eligibility and learning; `src/sim/network.ts` applies the six effects:

| Branch | First adaptation | Second adaptation |
|---|---|---|
| Exchange | Deep drink: one connected tree bond unlocks 20% faster soil-water uptake. | Mineral weave: Deep drink plus two distinct connected tree partners unlocks 20% faster soil-nitrogen uptake. |
| Resilience | Living sheath: a bond plus 50 connected living nodes unlocks fed-strand recovery of 0.025 health/second instead of 0.015. | Cord memory: Living sheath plus three connected reinforced nodes unlocks 25% faster resource transport. |
| Fruiting | Quiet reserve: a bond after 180 seconds of colony life directs 65% rather than 55% of well-supplied resting trade into fruiting surplus, leaving less carbon for growth. | Spore memory: Quiet reserve plus a completed bloom unlocks 15% faster supplied fruit maturation, spending the same full reserve. |

Learning is a free explicit action after meeting a prerequisite and milestone;
all branches can coexist. No research currency is currently charged. These
effects are implemented and covered by the previously recorded focused tests.
Still needed for `TECH-01/02`: natural-match earning and balance checks, explicit
regional promotion/daughter-state regression coverage, and distinctive world
feedback for transport/fruiting powers. Each of the six adaptations and each of
the three powers now has its authored icon, shown in the icon-tile tech
dialog (29 September). Deeper branch content and the tree-shaped presentation
are planned under `TECH-04` and `TECH-05`; they are future expansion, not a
missing implementation of the six effects above.

Current powers require their branch's second adaptation and one completed
bloom. They run for 20 simulation seconds with a 120-second cooldown measured
from activation:

- **Forest pulse:** two connected tree partners required; doubles transport
  along existing connected routes. Does not create resources or bridge cuts.
- **Mend the web:** damaged connected strands with carbon required; repairs
  up to 0.08 health/second, paying two carbon per health restored at each node.
  Cannot revive dead nodes or heal detached strands.
- **Second spring:** an active fruiting body required; doubles maturation,
  consuming the committed reserve faster. Supply and weather still constrain it.

### Summon storm: required actual effects (`TECH-03`)

**Accepted gameplay:** invoke a late-game storm, choose where its wind blows,
announce its arrival, and create a shared race to prepare fruiting bodies.
When the storm arrives, prepared spores travel substantially farther downwind
and can establish colonies in more tiles. Opponents can exploit the same storm;
the initiating player controls its direction, not exclusive access to its benefit.

Required implementation:

1. Add a deterministic, region-owned storm lifecycle: idle, warning countdown,
   active storm, recovery. Store initiator, chosen direction, phase timestamps
   and cooldown in simulation state. Lock direction when the storm is announced;
   changing the viewed stand or pausing must not reset or duplicate the event.
   Add a real late-game tech prerequisite and invocation condition. Exact
   prerequisite, cost, warning length, duration and cooldown still need balancing;
   the existing powers' 20/120 timings are not automatically the storm timings.
2. Provide a direction picker with a map preview and explicit **wind blows
   toward** wording. Show the countdown and wind arrow to every participant,
   followed by the remaining storm window. Use the same direction for spore
   movement, landing calculations and atmospheric presentation.
3. Make the countdown a meaningful preparation window. Fruiting bodies completed
   during the warning must retain a fresh storm-bound spore release until arrival;
   bodies completing during the storm can release into it. Preserve ordinary
   off-storm reproduction and never re-release spores already dispersed.
   Define the held release's supply/survival requirements and failure behavior.
4. Replace the current one-successful-daughter-per-bloom early return with a
   storm dispersal budget capable of funding multiple eligible downwind tiles.
   Use direction, distance, map bounds and viable landing ground to determine
   candidates, with deterministic tie-breaking. Each daughter must still be
   paid for from real parent resources and own an independent network. Show
   longer travel and actual new colonies, not merely a larger spore score.
5. Apply the shared event to all eligible colonies and rival reproduction.
   The present game is single-player with one saprotroph rival, not multiplayer;
   opponent fruiting/dispersal and a countdown response need explicit integration
   before claiming a competitive race. Do not add three playable factions.
6. Reconcile the local two-bloom victory/stop behavior with this late-game
   regional event so the summoning body can prepare, release and colonize during
   the storm. Define the interaction with seasonal frost, rain and supply:
   existing fruiting weather gates must not silently nullify the preparation race.
   Check that the current 3x3 region has meaningful destinations; range and
   previews must generalize to larger maps instead of hard-coding nine tiles.
7. Verify countdown boundaries, pause/speed behavior, shared direction across
   stands, downwind versus upwind reach, held-release timing, independent paid
   daughters, multiple landings, occupied/invalid targets, map edges, rival access,
   repeated invocations and deterministic replay. Browser checks must demonstrate
   the complete summon â†’ countdown â†’ fruit â†’ storm â†’ new-tile loop.

**Implemented 28 September (Codex/Astra, finished by Claude).** Items 1-6 are
built as described in the `TECH-03` row: lifecycle and cost in `match.ts`
(`STORM`), held releases, multi-daughter budget with real parent payment,
rival participation, frost override and continuation after the introductory
victory. Direction, landing candidates and the rendered wind share one value.
`sporeTargets()` ranks by direction and range over the region grid, not a fixed
nine-tile list. Remaining for item 7: a browser run from genuine late-game play
rather than a fixture, a speed-control check, and hardware-GPU frame timing.
Presentation still falls short of the superpower spectacle bar below.

Still missing (28 September):

- Nothing shows in the sky for the first half of the warning.

Resolved later on 28 September:

- The storm now has underground effects (wetting front, percolation and
  droplets), and its flood half is built; see the `TECH-03` row.
- Thunder follows each lightning flash, and the storm has its own music; see
  `AUDIO-01`. This has not been listened to or tested in a browser.

Earlier foundations: `region.windAt()` generates
ambient weather; `downwindStands()` filters/ranks wind-aligned targets; current
`RegionalMatch.release()` reaches roughly one tile normally or two in strong
wind, then funds at most one empty destination per bloom. It samples wind at
release processing time and has no player-directed storm or shared countdown.

Verification for this status-only update: inspected `evolution.ts`, the actual
effect sites in `network.ts`, and wind/release code in `region.ts` and `match.ts`.
No implementation changed and no tests were rerun; earlier evidence above is
not new evidence for the planned storm power.

### Ecological superpowers: required effects and spectacle (`TECH-03`, `TECH-06`)

**Accepted direction.** The tech tree should end in three region-scale
ecological superpowers: flood/storm, drought, and a third. Storm is already
specified as `TECH-03`; flood is its water half, drought is the second, and the
third is proposed as wildfire (alternatives: deep freeze, blight pandemic;
confirm with the user before building it). This is recorded design direction
only. No superpower exists beyond the three completed modest powers in
`TECH-02`, and no tests were run for this note.

**Shared requirements for all three.** Each superpower is a late-game action a
player chooses to invoke, and each needs:

- **Real ecological effects, not a tint.** It must change the shared soil,
  water table, weather, trees, rival and colony viability across more than one
  stand for a bounded window. Deterministic and replay-safe under `MAP-13`,
  with the rival able to read and respond to it.
- **Warning and counterplay.** A visible shared countdown and forecast, a
  bounded duration, a cost or cooldown, and at least one expensive but real
  response so an invoked superpower never means unavoidable loss.
- **Superimpressive graphics.** Authored spectacle per event: sky and light
  state, cloud/rain/smoke, water, fire, foliage and ground materials, large
  particle and shader work, camera and audio response. Dramatic, but in the
  game's quiet botanical style rather than cartoonish. Each event should be
  readable from the forest view and from the soil.
- **Superimpressive gameplay.** A distinct strategic identity: it should change
  what the player wants to build, where they expand and when they fruit, not
  just add damage or a buff.
- **Performance.** Budget every effect under `PERF-03`: bounded particles,
  view-based culling and LOD, a single moving front or field rather than
  per-voxel global simulation, a fast QA variant, and hardware-GPU
  measurements. Spectacle cannot be allowed to break the frame-time budget.
- **UI.** Each superpower is a final node / fruiting body in the organic tree
  (`TECH-05`) with its own icon (`TECH-01/02` gap) and a dedicated invoke flow
  that shows direction, target, warning and cooldown.

**1. Flood / storm (`TECH-03`).** Chosen wind direction and a shared warn/race
for long-range spore dispersal are already specified. Flood adds the water
half: a rising water table and overflowing stream that submerge soil, make
saturated ground impassable, erode banks, wash away exposed strands and carry
spores and debris downstream. Counterplay: retreat to high or deep ground,
bank water in advance, and use the flow instead of fighting it.

**2. Drought (`TECH-06`, implemented 28 September; see the `TECH-06` row).** Heat, sun and a falling water table: the stream
shrinks to pools, soil dries and cracks, and foliage wilts or dies. Soil water
becomes scarce, wet refuges are contested, and deep cords, storage and shade
decide who endures. Fruiting bodies and shallow strands are stressed; fire
risk rises. Counterplay: draw and store water before it hits, deepen cords,
and hold the remaining wet ground.

**3. Wildfire (`TECH-06`, implemented 28 September; see the `TECH-06` row).** A fire front with embers, smoke
and scorched ground burns surface canopy, deadwood and exposed fruiting bodies,
releases nutrients as ash, and heats the upper soil while the deeper network
survives - followed by a post-fire fruiting boom. Counterplay: retreat
underground, use wet refuges and previously flooded ground as firebreaks, and
plan to colonize the burned ground first. If wildfire is rejected, deep freeze
or a blight pandemic are the named alternatives and need the same treatment.

### Tech tree depth, organic presentation and performance plan (`TECH-04`, `TECH-05`, `PERF-03`)

**Goal.** Flesh the tech tree out into real branching progression, present it as
a living tree/fungal network rather than three text columns, and treat
performance as required work for that scope rather than a later cleanup.

**1. Flesh out the tree (`TECH-04`).**

1. Fix the shape before writing content: how many tiers per branch, whether
   forks are exclusive or combinable, and what a branch capstone means. Keep
   the six current adaptations as tiers 1-2 of Exchange, Resilience and
   Fruiting, and keep the three powers as the first capstones.
2. Add tier-3 and (later) tier-4 adaptations with distinct ecological effects
   rather than flat percentage bumps: for example an exchange node that widens
   trade range, a resilience node that hardens cords at a cost, a fruiting node
   that changes where spores can land.
3. Add a small number of cross-branch nodes that require two branches, so the
   tree rewards planning across Exchange, Resilience and Fruiting.
4. Decide and implement the learning economy. Learning is free today; if
   research currency or an opportunity cost is added, define it explicitly and
   keep the genetic currency rules intact unless changed on purpose.
5. Implement every new effect in `src/sim/network.ts` with deterministic clocks
   in `stepNetwork`; keep eligibility and prerequisite rules in
   `src/sim/evolution.ts`. State stays on the Network, survives body promotion,
   and is not inherited by fresh spores.
6. Let the opponent research the same tree, since the rival now needs its own
   starting stand (`MAP-16`, `ADV-05`).
7. Verification: extend `tools/test-evolution.mjs` for each new effect,
   prerequisite, fork rule, cost and determinism, and rerun natural-match
   earning/balance coverage before calling any tier finished.

**2. Make it look like a real tree / fungal network (`TECH-05`).**

1. Give every adaptation and power an id, a small icon (picture), a one-line
   effect and its prerequisite edges. The icons are a known gap under
   `TECH-01/02`; draw them once and reuse them here.
2. Lay the dialog out organically: the player's colony body is the root, cord
   strands branch to adaptation nodes, and powers sit at branch tips as fruiting
   bodies. Nodes follow their real prerequisites, so the diagram is also the
   navigation.
3. Show state through form as well as text: locked, ready to learn, learned,
   active and cooling down each get distinct strand growth, shape and glow, and
   must stay readable without depending on colour alone.
4. Keep the interaction contracts: keyboard traversal along the network,
   Enter/Space to learn or invoke, modal focus return, world-shortcut
   isolation, reduced-motion snapping, and the tested viewport sizes
   (1440x1000, 820x900, 390x844).
5. Keep hover/focus detail (exact effect numbers, prerequisites, current state)
   so the organic view stays informative, not decorative.
6. Render deterministically: no per-frame randomness, no continuous animation
   while the dialog is closed, and a static or briefly animated draw that does
   not add to the simulation cost.

**3. Optimize performance as part of this (`PERF-03`).**

Measure with `tools/profile-forest.mjs` before and after the tech and UI work,
not only on software SwiftShader. Close the `PERF-01/02` gaps: hardware-GPU
frame time, a rendered 4x mature-match budget, draw calls, triangles and
renderer resource counts. Budget the tech-tree view explicitly: prefer one
overlay and a single shared icon atlas over many textures or draw calls, and
confirm the fast QA preset and production bundle size after each change. Do not
add per-frame work for a dialog that is only open occasionally.

### Continuing spatial and performance priorities

The opening now records regional XYZ from its first spore, promotion leaves node
addresses and physical locations intact, and spatial orders can steer through
3D soil across any passable stand edge. The next spatial work is multi-network
contact and ownership in a shared tile, followed by the explicit fusion design
in `MAP-15`. The current mature software-browser check advances 30 simulated
seconds in 5.61 seconds without drawing those ticks; rendered 4Ã— pacing and
hardware budgets still need testing and tuning. Keep using focused checks unless
broader regression is warranted by a change.

`MAP-15` is future work: spores remain independent now, and fusion requires a
later explicit player action and conservation/ownership design. Shared soil or
adjacent strands must never merge graphs automatically.

After this scope, the independent forest acceptance/performance pass remains the
next candidate (`ASSET-04`, `VIEW-08`, `PERF-01/02`). Root architecture and
ecological opposition follow the spatial foundation. The detailed sequences
below retain design rationale; their historical planning-only language does
not override current implementation or this priority.

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

**Current implementation:** A-C now draw all six regional decoration kinds.
The first material pass in D is implemented: regional habitat weights, seasonal
shader detail, matching edge normals, masked litter, slope-aligned low props
and a perimeter skirt. Medium density is 80 nominal canopy trees per stand.
The bench still toggles scenery, changes bands and isolates communities;
`test:feature -- dressing` runs focused checks. Earlier measurements below
refer to the previous renderer.

Remaining: hardware/LOD tuning, authored winter leaf drop, exact long-log
supports, optional fine relief maps and broader seed/orbit/intermediate-crossing
visual acceptance. The canopy mask is baked at creation; fixture band changes
and later mortality do not yet rebuild it.

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
section through it, and is a real forest control. On 24 September the ordinary
match adopted the coordinator for one user-directed corridor, and the same
section/reveal controls began reading that match's body. The opening remains a
flat transect until promotion; free XYZ steering, full soil unification,
compare-sections mode and transparent-ground switch remain open.

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
  data. The browser suites are the slow loop â€” a full `node tools/test-view.mjs`
  run is several minutes under software WebGL even with synthetic timing frames
  â€” so a new browser check should be written alongside the feature and run when
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

### P0 â€” stabilize and verify the connected views

1. **Done in this changeset.** The underground visibility threshold is gone:
   the networks, motes, roots and rewards dissolve from their own opacities
   across the crossing, and are hidden outright only once they are gone.
2. **Done in this changeset.** The crossing runs on a wall-clock timeline, so a
   4fps rise takes the same 1.50s as a 30fps one, and it reverses at any point
   with a duration proportional to the blend left to travel.
3. **Done in this changeset.** A viewport change re-derives the active view's
   default framing, and the stand's framing now fits the whole stand at a
   portrait aspect. `npm run test:view` covers 1600Ã—1000, 1366Ã—768, and
   390Ã—844.
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
What remains untested is the wider browser matrix â€” a second engine, a second
GPU, and touch input â€” which is recorded under `UX-03`.

With P0 complete, P1 â€” the deterministic regional world model â€” is the next
work in order.

### P1 â€” define the scalable regional world model

1. **Done in this changeset.** `src/sim/region.ts` holds the deterministic data
   model: one heightfield, a fall line and valley, drainage from a priority
   flood, flow accumulation, a stream, a water table, per-stand communities,
   orthogonal adjacency, wind with storms, and seed validation.
2. **Done in this changeset.** `createStandWorld` generates one stand's soil
   from its site â€” the region supplies the water table and the species mix, the
   stand supplies its own noise â€” and `createWorld` is the same function with
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

### P2 â€” establish real roots and ecological opposition

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

### P3 â€” finish the living surface

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

### P4 â€” complete interaction and mature-match visual QA

1. Exercise root markers, journey guidance, rest/unrest, refused actions,
   mushroom growth, outcome/restart, pause, 1Ã—/2Ã—/4Ã—, notes, and sound through
   the actual interface.
2. Inspect opening, first bond, expanded colony, drought, first mushroom, and
   victory. Ensure cords and resource pulses remain readable in dense networks.
3. Resolve label collisions and ensure actionable unbonded trees remain visible.
4. Audit focus, reduced motion, and non-color state distinctions.

### P5 â€” profile, optimize, and reconcile the visual system

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

- The forest begins over the legacy 2D transect; the promoted player body then
  runs on one spatial corridor, not a freely branching 3D volume.
- The spatial migration is real but partial, and must not be described as more
  than it is: the ordinary match now adopts one existing player body into the
  spatial coordinator on request. The promotion maps its flat strands onto a
  passable corridor; other spore-founded colonies, saprotrophs and tree ecology
  still use local transect soil. Already occupied player cells are imported into
  SoilVolume, but local mineral/organic recovery remains a separate model. A
  naturally bonded `old-growth` opening crosses in the focused headless and
  browser checks; broader seeds and mature-match pacing remain unverified.
- The background forest remains presentation only. All six vegetation/prop
  kinds now render and regional material patches replace the striped floor.
  Density and LOD have only been measured on SwiftShader. Long logs use a
  local slope approximation; canopy darkening is baked at construction.
  Winter recolors authored deciduous foliage rather than dropping it.
  Additional seeds, low-angle orbits and intermediate crossings need visual QA.

- Sections and the forest reveal can read the promoted ordinary-match body.
  They still draw a thin corridor with limited across-plane drift; sections do
  not yet expose arbitrary 3D steering, and local stand views hide while one is
  open. Compare sections and transparent-ground true-depth mode are unfinished.
  Reveal cost at regional scale and overview line weight still need tuning.
- The match renders nine stands and players can enter colonized underground
  transects. A local view is rebuilt and its owned GPU resources disposed on
  each stand change; this bounds residency but may hitch on entry. There is no
  minimap or distant-stand simulation cadence yet; the survey is a ledger.
- Local colonies that fruit twice stop growing; a promoted regional body keeps
  stepping after the two-bloom milestone so a spanning network is not frozen in
  one stand. A regional objective remains an open design question (MAP-10).
- Ground with no colony in it is not simulated at all: its local history begins
  when a spore lands or a strand arrives. That is deterministic and cheap, but it means an uncolonized
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
  `tools/test-view.mjs` covers the crown â†’ root landing and tier identity. There
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
  ignored for dead variants and crown anchors. Authored animation clips are
  absent; whole-tree procedural sway still
  applies.
- Responsive and keyboard affordances exist but are incompletely exercised.
- `DESIGN.md` still needs a full token-level reconciliation after the forest
  visual direction is accepted.
- Browser QA screenshots live under ignored `design/shots/`; record commands and
  results here because those images are not durable repository evidence.

## Verification record

### 29 September 2026: continuous underground sections and forest crossings (`VIEW-03/04/06`, `MAP-07`, `PERF-03`)

- `npm run build` and `node tools/test-sections.mjs` pass on this tree. The
  section suite has 12 checks, including physical next/previous across all four
  interior directions, a true region-edge stop, and an ordinary promoted body
  growing into its adjacent section without a new colony.
- Built-page `node tools/test-sections-view.mjs --qa fast` passes 34 checks on
  ANGLE/SwiftShader at 1200x800 CSS / 600x400 drawing buffer, with no browser
  errors. It covers across-stand stepping and return, stable camera distance,
  along-plane panning into a neighbour, turned-section pan and tilt, soil mesh
  reuse, stable frame geometry, a reversible timed forest descent, Surface here,
  saved forest pose, reveal picking and crown selection.
- Built-page `node tools/test-regional-mature-view.mjs --qa fast` passes on the
  same software renderer. An independent daughter accepts a browser Grow click
  in its adjacent section, records that section's regional lateral coordinate,
  then accepts a Grow click in the neighbouring stand on that same plane and can still return to the founding colony after the timed forest rise.
- `SectionView` reuses up to four recently viewed soil meshes and avoids
  reallocating its frame when a routine network refresh keeps the same section.
  This is a targeted allocation reduction, not a measured frame-time result.
- The broader `test-regional-spatial-view` browser check currently fails its
  natural seam arrival from corner stand 8: the old-growth colony runs out of
  resources before it crosses west. `test-crossing` passes its natural arrival
  headlessly. Corner-start growth balance and repeated rebase/long-match input
  remain open.

### 29 September 2026: subclusters in regional sections (`CORE-08`)

- **Fixed: section orders ignored subclusters.** In a regional section, the
  view a colony is in once it has crossed a stand edge, a grow order always
  went to the whole body. `CrossingMatch.growAt` now takes the selected
  group. The new `CrossingMatch.splitAt` circles strands in XYZ, and the
  selection circle works on the section plane.
- **Fixed: number keys switched the order.** With subclusters present, the
  number keys `1` to `6` select a subcluster only; they no longer also
  switch the order. Before, `2` picked Bond as well, so the next click tried
  to bond instead of steering.
- **Section highlight.** The selected subcluster is drawn in the selection
  blue in the section.
- **Verification:**
  - `node tools/test-subclusters.mjs` passes 7 checks. The new one: a
    regional body's subcluster took a section order alone and closed from
    12.7 to 0.8 in 30 s.
  - `node tools/test-subclusters-view.mjs` passes, including the number-key
    check.
  - `tsc` passes.
- **Not verified in the browser:** circling in a section. The fixture found
  no growing tip on the opened section plane, so that check was dropped for
  now.

### 29 September 2026: selected subcluster control through edge promotion (`CORE-08`)

- A Grow order on an adjacent stand edge now passes the selected subcluster
  through `RegionalMatch.growAcross` and `CrossingMatch.orderAcross`; it leaves
  the colony's own waypoint queue alone. Entering another view of the same
  regional body keeps that subcluster selected. Section clicks are accepted
  only by the body actually displayed, and Rest for the colony at large uses
  that viewed network. The Rest/Wake label now reflects the colony again when
  selection returns from a subcluster.
- Tip borrowing now checks for a funded parent and remaining node capacity
  before retiring another group's tip. An unfunded group's order waits without
  consuming the colony's frontier.
- **Current verification:** `npm run build` passes.
  `node tools/test-subclusters.mjs` passes all 7 checks, including a selected edge
  promotion that leaves colony orders unchanged, independent section growth,
  and no tip retirement for an unfunded group.
  `node tools/test-subclusters-view.mjs` passes with no browser errors: the selected
  group's nearest strand closed from 19.0 to 4.5 cells from its clicked target
  over 12 simulated seconds while the colony was resting. Selecting a second
  subcluster chip gave only it the next Grow order; the first and colony kept
  their own orders. Selection survived opening a section, a real Grow click in
  that section kept the colony's order unchanged, and a forest round trip kept
  the selection. `node tools/test-crossing.mjs` passes 18 checks.
- **Remaining:** natural arrival of a selected subcluster across a stand edge
  has not been played through in the browser. Bond, Cord and Fruit remain
  colony-wide; section-plane circling and long-match subcluster balance still
  need verification.

### 29 September 2026: wind-driven wildfire and hurricane rain (`TECH-03`, `TECH-06`)

- The wildfire front now advances from the region's seeded wind: a tailwind
  speeds it, a headwind slows it, and forecasts use the wind expected at
  ignition. A storm may be summoned during a fire. On hurricane arrival,
  windborne embers sweep every stand in 12 s. Dry living trees face the 0.97
  maximum burn chance; trees with hydration at least 0.7 or on wet refuges get
  exactly one 0.5 burn roll in that sweep. Ordinary firebreaks cannot stop the
  sweep. Thin shallow strands can burn even in wet soil. Rain then quenches
  open flames 18 s after arrival, while the 45 s hurricane continues. Smoke,
  ash flush, char and recovery proceed through the existing aftermath.
- The second front appears in the existing batched flame, smoke and ember
  draws; the floor, background foliage and underground heat read both fronts.
  The storm and fire controls explain the overlap and early quench.
- **Current checks:** `npm run test:wildfire` passes 19 groups. With the same
  seed, a tailwind moved the front to projection 181.5 versus 78.6 in a
  headwind after 20 s, and coarse/fine stepping produced identical tree
  outcomes. The hurricane fixture burned 33 fully watered trees, reached all
  nine stands, and entered aftermath while the storm was still active. An
  early storm also quenched at the same time with the same burn footprint
  under coarse and fine stepping;
  replay matched. `npm run test:storm`, `npm run test:drought`,
  `npm run test:flood`, `npm run test:assets` (61 assets / 103 GLBs),
  `npm run typecheck` and `git diff --check` pass.
  `npm run test:wildfire-view` builds and passes on synthetic late-game
  browser fixtures: 36 watered trees torched, 3 fire draws during the burst,
  flames off and smoke remaining while the storm still ran; no browser or
  shader errors. Screenshots under ignored `design/shots/fire-hurricane*.png`
  were inspected. A natural two-crown played journey and hardware GPU timing
  remain unverified. Wind changes speed but the ordinary front keeps its
  chosen heading; the hurricane adds a region-wide ember sweep rather than
  localized spot ignitions. Background tree loss remains a presentation hash.

### 29 September 2026: agent players, live Jev (`AGENT-01`)

The key is in the git-ignored `.env.local`. These runs are live calls to
`jev-1.13.0` through `server/decide.ts`.

- **Sequential decisions on a real front** (`contact-run`, rival stand 3).
  - First run, 12 decisions: median 174 ms, cold call 400 ms.
    - Stance and target were confident (0.9+), and it always chose the cut
      that severs the most strands.
    - Chemical confidence was only 0.2 to 0.45, so the gate held back half
      the casts.
  - After offering only ready chemicals and adding the `strike` question,
    8 of 8 decisions cast. The rival killed 44 strands and lost 13;
    before, it killed 3 and lost 14.
- **Real time, 20 s from the same state**, rival played by:
  - the placeholder bot: 12 casts, 61 killed, 4 lost;
  - the Jev agent with a 250 ms wall-clock pace: 76 decisions (3.8 Hz),
    0 failures, median latency 181 ms, 126k input tokens (about $0.005),
    35 casts using all six chemicals, 158 killed, 2 lost.
  - The player's front was unattended, so this is the agent against no
    micro at all.
- **Regressions:** `tools/test-agent.mjs` (7 checks) and
  `tools/test-contact.mjs` (11) pass. `tools/test-agent-view.mjs` passes,
  and the preview relay reports `{"jev":true,"openai":false}`.

### 29 September 2026: agent players, first pass (`AGENT-01`)

No live provider was called: no key is configured, and every provider call in
these tests is faked.

- **`node tools/test-agent.mjs`: 7 checks pass.**
  - A quiet opening gives 4 growth options, a state of 1,837 characters
    (about 459 tokens) and 4 questions, all within the relay's limits.
  - A real front gives 3 labelled, reachable targets. The request is about
    1,166 tokens, roughly $0.18 per hour at 1 Hz on Jev.
  - Heuristic answers become orders: an oxalate burst hit 50 strands, plus
    one growth order.
  - Low confidence, a withdrawing stance and out-of-set answers all withhold
    action.
  - The controller does not block, keeps one request in flight, applies an
    answer when it lands, and falls back to the heuristic on failure.
  - The offline agent played a minute: 59 decisions, 4 casts and 3 growth
    orders.
  - The relay validates requests and calls Jev with the key, `jev-latest`
    and the questions unchanged, then normalises the answers. Unconfigured
    providers refuse without calling out.
- **`node tools/test-agent-view.mjs`** (SwiftShader, preview server): passes.
  - `/api/decide` reports `{"jev":false,"openai":false}` and refuses an
    empty question set with 422.
  - `?opponent=local` played 4 decisions, the placeholder bot stood down,
    and the picker marks the unconfigured providers.
- **`npm run build`** (tsc and vite): passes.

### 29 September 2026: contact war, C1 and first-pass C2 (`ADV-07`)

Run on the working tree. It includes uncommitted fire-render edits by another
agent, which touch no contact code.

- **`node tools/test-contact.mjs`: 11 checks pass.**
  - A front opens at touching tips (4 contacts) and is announced once.
  - Networks far apart are left byte-identical.
  - Supply decides a front: in 60 s the starved side lost 2 strands and the
    fed side none.
  - Cords resist: 2 fine strands against 1 cord in 30 s.
  - A coil cut severs 3 strands beyond it.
  - Elimination: 8 oxalate bursts reached the founding node, and nothing
    stays joined.
  - Light chemicals cost one resource and heavy ones several. Reach, the
    0.2 s spam cooldown and atomic refusal all hold.
  - A barrage shields a starved line: 0 strands lost against 2 unshielded.
  - Leachate washes out after 5 s.
  - The placeholder opponent casts the same orders.
  - Duels replay identically.
  - The match owns the war, with no casts before a front.
- **`node tools/test-contact-view.mjs`** (SwiftShader, fast QA; the colony is
  founded synthetically): passes.
  - A front opened after 42 s in stand 3, and the alert and six chips show.
  - Z framed the front underground.
  - Five casts aimed at the cursor (lyse, ammonia, leach, oxalate, barrage)
    hit 62 strands and drew 14 effect sprites.
  - The rival's strands are now drawn in the section, in the rival palette.
  - Screenshots: `design/shots/contact-front.png` and `contact-bar.png`.
- **Replay fingerprints without contact are unchanged:** raven-wood
  `8e90afcc63ba88f4`, storm-race `45160dc3472d0e23`.
- **Headless regressions pass:**
  - `test-sim`: 11 checks.
  - `test-regional-play`: 10 checks.
  - `test-spores`: 6 checks.
  - `test-region`: 19 checks.
  - `test-crossing`: 18 checks.
  - `test-wildfire`: all checks.
- **Not run:**
  - the other browser suites;
  - a check on the real GPU;
  - any balance play.


### 29 September 2026: wildfire visuals, shallow heat and recovery (`TECH-06`, `ASSET-02`)

- `tools/make-fire-assets.py` was rerun with Blender 4.2.1. It now exports
  `understory.fireweed-sprout` (196 triangles) and `understory.goldenrod`
  (306 triangles), in addition to the nine prior fire assets. Both are in
  the runtime registry and manifest. `npm run test:assets` passes: 61 assets,
  103 GLBs, 3,570.5 KiB, including geometry/material/budget checks.
- `npm run test:wildfire` passes 16 grouped checks. The depth fixture now gives
  each spatial node its own XYZ and confirms that a deep node stays safe even
  if a section projects it into a shallow row. Dry shallow strands burn,
  10 cm strands singe, wet/reinforced/root strands survive; the existing
  hydration, firebreak, remains, ash-flush and deterministic checks pass.
  The hot-band check burns a shallow tip grown behind the leading edge. A
  separate check confirms that adding a strand cannot reroll any tree's
  ignition: each tree draws from its own fire-sequence and tree-id seed.
  On this tree the same unfed fire torches 60/75 trees (23 logs), while the
  fully fed case torches none and scorches 14; five torched bonds end and
  three survivors keep theirs.
- `npm run test:dressing` passes nine layout checks. `npm run
  test:wildfire-view` builds and passes on the synthetic late-game fixture:
  warning smoke, 3 fire draws, 16 trees burned at mid-front, 31 living trees
  burned overall, pulsing underground light and overlay, nine ash-flush
  stands, ash/coals, shoots, fireweed/goldenrod (seven fire dressing draws),
  later grass and the 480 s visual clear. No page or shader errors.
- `npm run test:drought` and `npm run test:storm` pass, including a fire in
  drought increasing living-tree losses from 41% to 56%. `npm test` passes
  its 11 checks, including three natural two-bloom journeys. Its copied-module
  list was updated to include the current match's contact dependency before
  that run; the first attempt failed to import that module, not on an
  assertion. `npm run typecheck` and `git diff --check` pass.
- Fast-QA screenshots under ignored `design/shots/fire-*.png` were inspected
  for front, underground heat, pioneer flowers and grass. Flowers form small
  clusters in clearings; the autumn fixture makes ordinary grass look dry, so
  new recovery foliage is tinted fresh green. The fast QA renderer is not a
  hardware visual or frame-time acceptance pass. The 480 s ecology is a game
  time presentation sequence; regrowth is not a new simulated population.
- Remaining for `TECH-06`: W3 strategy controls, W5 spot fires/per-tree audio
  and hardware profiling, W6 natural earned-power journey and multi-site
  balance. Fire scars follow the shared front and wet-bank mask, while
  background canopy losses still use a presentation hash.

### 29 September 2026: wildfire v2 W1, water is fire armour (`TECH-06`)

- Changed files: `src/sim/world.ts` (hydration), `src/sim/sim.ts` (stepped
  with trees), `src/sim/wildfire.ts` (`treeOdds`, `FLAMMABILITY`, ordered
  judging, outcomes, per-fire counters) and `src/ui/wildfire.ts` (watch and
  advice).
- **No change without a fire:** 90 s fingerprints are identical to the
  committed code. The new drawn-start baselines are `raven-wood`
  `8e90afcc63ba88f4` and `storm-race` `45160dc3472d0e23`.
- `test-wildfire`: pass, 10 checks, 4 of them new:
  - hydration after one 40 s time constant: fed 0.46, unfed 0.08;
  - the same fire at hydration 0 and 1: unfed 59/75 torched (22 felled as
    logs downwind); fed 0 torched and 16 scorched but alive;
  - bonds are kept by survivors and released by the torched;
  - burn odds at equal hydration: oak 0.21 < birch 0.33 < hemlock 0.37; a
    watered belt cuts a tree's odds from 0.33 to 0.16.
- **Also pass:**
  - `test-drought`: a fire in a drought now takes 44% to 55% of living trees;
    it was 44% to 73% when watering did not matter.
  - `test-storm`, `test-flood` and `test-sim` (11).
- **Browser, on a fresh build:**
  - `test-wildfire-view`: 36 living trees burned, no errors.
  - `test-underground-view`.
- `npm run typecheck`: pass.

### 29 September 2026: wildfire v2 assets (`TECH-06`, `ASSET-02`)

- **New generator:** `tools/make-fire-assets.py` (Blender 4.2). It imports the
  v3 forest helpers and adds `char_trunk` (alligator checks),
  `broken_limb` (splintered ends), `ember_seam`, `alligator_log`,
  `glowing_end` and `lump`.
- **Assets, triangles by LOD:**

  | Asset | LOD0 / LOD1 / LOD2 |
  |---|---|
  | `tree.oak-charred` | 851 / 478 / 296 |
  | `tree.birch-charred` | 954 / 552 / 313 |
  | `tree.hemlock-charred` | 1,338 / 604 / 424 |
  | `prop.charred-log-a` | 416 |
  | `prop.charred-log-b` | 414 |
  | `prop.charred-stump` | 250 |
  | `prop.ember-bed` | 518 |
  | `understory.fireweed` | 600 |
  | `understory.ash-bed` | 174 |

- **Contract:** opaque, non-emissive materials. The ember orange is a colour;
  glow is left to the renderer.
- **Checker:** `check-forest-assets` now treats `charred` like `dead-hollow`
  (no foliage).
- **Registry:** the ids are added to the `AssetId` union and `ASSETS`.
- **Preview:** Cycles sheets rendered on the RTX 4060 were reviewed and
  iterated once: the first pass had capped limb ends, floating birch strips,
  checkerboard logs and bright ash.
- `npm run test:assets`: pass, 59 assets and 101 GLBs, 3,544.6 KiB.
- `npm run typecheck`: pass.
- **GPU in-game capture** (`raven-wood`, four trees burned by a fixture): the
  trees swap from `tree.oak-tall` / `tree.hemlock-young` to
  `tree.oak-charred` / `tree.hemlock-charred`, standing in place among
  living trees, with no browser errors.

### 29 September 2026: random starts, fresh forests, visible spore clouds, 4x pacing (`MAP-16`, `MAP-10`, `PERF-03`)

- **4x pacing.**
  - Cause: the frame loop ran up to 24 fixed steps a frame with no time budget, and banked the time it could not run. Past the CPU's simulation rate, every frame ran all 24 steps: about 5.9 ms each at 4,946 strands (4,013 of them the rival's), so 2.6 to 4.9 fps.
  - Profile: transport is 59% of a step. None of the regional code added on 29 September appears in it.
  - Fix, `src/game.ts`: `STEP_BUDGET_MS` 11, at most `MAX_CARRY` two steps of carried time, and `effectiveSpeed`. A `#speed-note` appears when the world runs below 85% of the asked speed.
  - Replays are unchanged (fingerprints `0837080b77c11551` / `cd272b4bfd5a5183`).
  - `npm run check:gpu` (RTX 4060) at 4x with 4,923 strands: 60 fps and a p95 frame of 16.7 ms in both views, with the world running at 3.0x (it was 2.6 fps before).
  - A transport rewrite with precomputed parent and child tables gave bit-identical results but no reliable speedup (A/B rounds 161 vs 220, 202 vs 199 and 261 vs 224 ms per simulated second, taken under background load). It was reverted.
- **Spore clouds.**
  - `src/render/spore-flight.ts`: six faint haze puffs per cloud that travel and breathe with it, and 260 spores each twinkling on its own rhythm.
  - `RegionalMatch.sporeReleases` records every release. A release that takes hold nowhere now shows too, drifting a stand's width downwind and thinning away.
  - GPU capture: a warm haze with sparkling spores rising over the canopy.
- **Random starts and fresh forests.** See `MAP-16`.
  - The six suites whose fixtures depend on one seed's old start opt into `StartRule` `best`: `test-region` (older checks), `test-crossing`, `test-flood`, `test-spores`, `test-regional-play` and `test-sections`. Named-seed browser fixtures use `?start=best`.
  - `test-evolution-view` and `test-mushroom-view` now pin `raven-wood`.
- **Headless results:**
  - Pass: `test-region` (19, including the drawn-start check), `test-crossing` (18), `test-flood`, `test-spores` (6), `test-regional-play` (10), `test-sections` (10), `test-sim` (11) and `test-storm`.
  - Passed earlier under drawn starts: `test-dressing`, `test-roots`, `test-spatial`, `test-evolution`, `test-subclusters`, `test-wildfire` and `test-drought`.
- `npm run typecheck`: pass.
- **Browser, on a fresh build:**
  - Pass:
    - `test-colonies-view`: including a fresh game that drew seed `y3u5zp6`, starting the player in stand 5 and the rival in stand 9.
    - `test-regional-spatial-view`
    - `test-regional-mature-view`
    - `test-storm-view`
    - `test-underground-view`
    - `test-subclusters-view`
    - `test-evolution-view`
    - `test-mushroom-view`
    - `test-sections-view` (27 checks)
  - `test-view` finished after the commit and fails only the long-standing refused-order check.

### 29 September 2026: held trees glow in the forest (`VIEW-02`)

- Changed: `src/render/surface.ts`. `playerHolds`; two shared additive sprite materials (a crown halo drawn through its own leaves, and a foot glow); two sprites per tree, shown while the player holds it.
- Browser: `test-sections-view` (27 checks, crown picking unchanged), `test-colonies-view` and `test-regional-mature-view` pass. `npm run typecheck`: pass.
- GPU screenshot (`raven-wood`, three trees bonded by fixture): each carries a soft warm halo and foot glow, and the rest of the stand is unchanged.

### 29 September 2026: colonies through the floor and colony tiles (`VIEW-07`, `MAP-08`)

- Changed files:
  - `src/game.ts`: `allColonyEdges`, `refreshReveal`, `ensureReveal`, `colonyStands`, `goToColony`, `syncColonyTiles`; picking resolves the owning colony.
  - `src/ui/evolution.ts`: the Colonies section and the toggle in the side panel.
  - `src/styles.css`.
  - `index.html`: the old hidden "Network" button is removed.
- New test: `tools/test-colonies-view.mjs` (`npm run test:colonies-view`).
  - Checks: 2 tiles; 563 strands projected, more than the home colony alone has; the daughter tile opens stand 1 below and rebinds the view; the home tile returns to the transect; no errors.
- Also pass:
  - `test-regional-spatial-view`
  - `test-sections-view` (27 checks)
  - `test-regional-mature-view`
  - `test-evolution-view`
- `npm run typecheck`: pass.
- GPU screenshots (`raven-wood`, RTX 4060): both colonies glow through the forest floor, and the daughter tile opens its section with matching caption and selector.

### 29 September 2026: tech tree icons and popovers (`TECH-01`, `TECH-02`, `TECH-05`)

- New files: `public/assets/icons/*.webp`, 12 icons at 256 px, 392 KB in total.
- Changed files:
  - `src/ui/evolution.ts`: `techIcon`, `TechPopover`, icon tiles and power chips.
  - `src/ui/storm.ts`, `wildfire.ts`, `drought.ts`: crown icons in the panel headings.
  - `src/styles.css`.
- `npm run typecheck`: pass.
- Browser:
  - `test-evolution-view`: pass. It covers the nine tech nodes, learning and invoking through the buttons' accessible names, focus return, and the compact layout.
  - `test-storm-view`: pass.
- GPU screenshots (RTX 4060) show learned, ready and locked tiles, and a popover beside the hovered icon in both the dialog and the side panel. No browser errors.

### 29 September 2026: regional spread, plan phases A to E (`MAP-07`, `MAP-10`, `TECH-01`, `MAP-15`, `CORE-05`)

- **A. Seamless edges**
  - New: `src/render/edge-soil.ts`.
  - `SectionView` soil backdrop and seams (`SECTION_SOIL_MARGIN` 48).
  - `RegionalMatch.transectPlane`.
  - Edge-click crossing in `Game.applyOrderAt`.
  - Follow prompt: `#follow-frontier`, `Game.followFrontier`.
  - The opening section prefers the colony's growth plane.
  - Every descent saves the forest pose; Return to forest falls back to surfacing.
  - The `#forest-cross` button is removed.
- **B. Player-timed spores**
  - `SPORE_GUST`, `gustAt`, `gusting`, `sporesReady`, `releaseSpores`.
  - `release()` now returns an outcome; a gust cannot spend spores the colony cannot pay for.
  - Region-wide landing broadcast.
  - `src/render/spore-flight.ts`, `#release-spores`, and a `spores` chime.
- **C. Player-owned tech.** `RegionalMatch.lineage` is one shared learned list per side.
- **D. Automatic fusion.** `CrossingMatch.absorb` and `livingPositions`; `RegionalMatch.stepFusion`, `fusions` and `StandState.fusedInto`.
- **E. Regional victory.**
  - `HOLD_TILES`, `standDominance`, `stepVictory`, `hold`, `victory`, `holdStatus`.
  - `regionalPlay` defaults to true.
  - `SheetUI.showVictory` and `regionLine`.
- **Tests changed on purpose**
  - `test-regional-spatial-view` crosses by clicking the neighbour's soil and checks the Follow prompt.
  - `test-region`, `test-crossing` and `test-regional-mature-view` release spores explicitly.
  - `test-evolution` states that a bare network starts empty.
  - `test-journey` now expects the match to continue past two blooms and a Release spores action; it was not run (20-minute budget, and too slow on software WebGL, as recorded before).
- **New tests**
  - `npm run test:spores`: pass, 6 checks.
  - `npm run test:regional-play`: pass, 10 checks (lineage 3, fusion 3, victory 4).
  - In the fusion fixture, a daughter and the founding colony grown toward each other met after about 140 s of simulated time and fused 703 strands.
- **Headless regressions, all pass on this tree:**
  - `test-sim` (11)
  - `test-region` (18)
  - `test-crossing` (18)
  - `test-storm`
  - `test-wildfire`
  - `test-drought`
  - `test-flood`
  - `test-evolution`
  - `test-fruiting`
  - `test-subclusters`
  - `test-sections` (10)
  - `test-dressing` (9)
  - `test-roots` (6)
  - `test-spatial` (18)
  - `test-batches`
  - `test-lod`
- **Browser suites, run on a fresh build:**
  - Pass:
    - `test-regional-spatial-view`
    - `test-regional-mature-view`
    - `test-underground-view`
    - `test-storm-view`
    - `test-subclusters-view`
    - `test-mushroom-view`
    - `test-evolution-view`
  - `test-view` fails only the long-standing refused-order check.
- **Replays unchanged:** the 90 s fingerprints stay `raven-wood` `0837080b77c11551` and `storm-race` `cd272b4bfd5a5183`.
- **GPU captures** (`raven-wood`, RTX 4060, no browser errors):
  - The flat transect shows both neighbours' soil past its ends.
  - After a crossing, the section shows real soil into the neighbour instead of an empty frame.
  - Release spores appears under the order note, and the spore cloud crosses the canopy.
- `npm run typecheck`: pass.
- **Not done:**
  - Phase F beyond rival spores. The rival cannot cross edges or win; its domination measure is an open question.
  - A played-browser win, and a browser check of a fusion.

### 28 September 2026: species root architecture after the Wurzelatlas drawings (`ROOT-01` to `ROOT-05`)

- References: Wageningen UR "Root System Drawings" (coll13, Kutschera and
  Lichtenegger).
  - Drawings 1355, 1354 and 1351 (oak); 1362, 1361 and 1363 (birch); 1255 and
    1256 (spruce and fir) were downloaded to the session scratchpad for study.
  - None are in the repository. The collection asks that the copyright holders
    (wurzelforschung.at) be contacted before the scans are used or distributed.
- New files: `src/render/root-architecture.ts` and `tools/test-roots.mjs`
  (`npm run test:roots`). `src/render/forest.ts` now draws the architecture.
- `npm run test:roots`: pass, 6 checks over 76 trees:
  - every simulation tip is the exact end of a drawn root;
  - nothing leaves the section;
  - deterministic;
  - a new tip adds one root and moves none, for each species;
  - width-weighted mean depth: oak 15.7 rows (deepest 89), birch 5.3 (45),
    hemlock 4.7 (31);
  - laterals reach more than 8 cells.
- `npm run typecheck`: pass.
- GPU screenshots of `raven-wood` underground, before and after, and after
  growing about 90 s of network: the orange colony and the rival remain
  readable over the roots.
- Simulation untouched: root tips, bonding and replays are unchanged.
- Not rerun after this change: `test-view`, `test-underground-view` and the
  other browser suites.

### 28 September 2026: background forest seen from underground (`ASSET-04`)

- Changed files:
  - `src/render/forest-dressing.ts`: `attachBackdrop`, a `cut` view input and a backdrop visibility rule.
  - `src/render/stage.ts`: the paper ends at the soil line; the far sky glow is re-placed each frame.
  - `src/game.ts`: passes the active surface's z as the cut.
- GPU screenshots of the underground view on `raven-wood`, before and after:
  - Before, only the active stand's 8 trees stood against black.
  - After, the regional forest recedes behind them, with no browser errors.
  - A red-haze probe confirmed the rendering split: all background trees took the haze, and none of the playable trees did.
- `npm run typecheck`: pass. `test-underground-view` and `test-regional-mature-view`: pass.
- `npm run check:gpu` (RTX 4060):
  - At 1x, 60 fps in both views with 72 strands. With 4,923 strands: 58.5 fps forest and 59.8 fps underground, with a p95 frame of 16.8 ms.
  - At 4x: 2.8 fps forest and 2.6 fps underground, against 4.9 fps earlier today. The forest view's drawing did not change, so this looks like the CPU-bound simulation varying on this laptop; the cause is not established.

### 28 September 2026: generative score and power themes (`AUDIO-01`)

- New files:
  - `src/audio/themes.ts`
  - `tools/test-score-view.mjs`: sound starts on a click, is audible without clipping, moves, thunders and falls silent when off.
  - `tools/record-score.mjs`: writes WAV clips of the score and each theme.
- Rewritten: `src/audio/soundscape.ts`. `src/game.ts` now passes bonds, surface blend, season, storm, fire, drought and lightning to the score.
- `npm run typecheck`: pass.
- Listening:
  - The user heard the regular score in the dev server and accepted it.
  - The themes have not been heard.
- Not run: `test-score-view` and `record-score.mjs`. Both runs were stopped at the user's request before they finished. No browser or audio-level evidence exists yet for the score or the themes.

### 28 September 2026: forest v3 trees and forest floor in the game (`ASSET-02`, `ASSET-03`, `ASSET-04`)

- New: `tools/make-forest-v3-assets.py` (9 tree forms Ã— 3 tiers, 15 floor
  pieces), registry ids in `src/render/assets.ts`, form and floor-piece
  selection in `src/render/forest-dressing-layout.ts`, per-seed forms for
  playable trees in `src/render/surface.ts`.
- Checks changed on purpose, for the new art:
  - `check-forest-assets` allows five materials on floor pieces (trees stay at three).
  - `test-dressing` has a height floor of 0.1 m (litter and fallen branches
    are flat) and counts every hemlock form as hemlock.
  - `profile-forest` waits up to 240 s for 86 GLBs on SwiftShader.
- Results:
  - `npm run test:assets`: pass, 50 assets / 86 GLBs, 3,058.6 KiB.
  - `npm run typecheck`: pass.
  - `test-dressing`: pass, 9 checks.
  - `test-batches`: pass.
  - `test-lod`: pass.
  - `test-regional-mature-view`: pass.
  - `test-mushroom-view`: pass.
  - `test-storm-view`: pass.
  - `test-view` fails only the long-standing refused-order check.
- `profile-forest`:
  - On the RTX 4060 (`MYCELIA_GPU=1`): 75 trees loaded, 208 draw calls, 976,528
    triangles, median GPU-synchronised frame 3.7 ms.
  - On SwiftShader: 234 and 164 ms medians (a software backend; not a budget).
- In-game GPU capture on `raven-wood`: 1,976 decorations drawn in 77 draws and
  802,035 triangles, with no browser errors. The user inspected the running
  game and accepted the look.
- `npm run check:gpu` (RTX 4060, D3D11):
  - 60 fps, 16.8 ms p95 in both views at 72 and 4,923 strands at 1x.
  - At 4x with 4,923 strands: 4.9 fps in both views. Earlier today it was
    20.7 fps forest and 4.7 underground.
  - The cause of the forest-view drop at 4x is not established. The GPU frame
    is 3.7 ms, the uncommitted subclusters simulation work is also in this
    tree, and this laptop's wall-clock timings vary up to 2x.
  - Remaining: an A/B comparison of the art against the simulation at 4x.

### 28 September 2026: subclusters (`CORE-08`)

- New: `GrowthGroup` and subcluster functions in `src/sim/network.ts`;
  `Simulation.splitAt`/`mergeGroup` and per-group `growTo`; press-and-hold
  selection, subcluster bar, per-group Rest and highlight in `src/game.ts`
  and `src/render/hyphae.ts`; `tools/test-subclusters.mjs`,
  `tools/test-subclusters-view.mjs`.
- Unsplit colonies are bit-identical to before: the 90 s fingerprints on
  `raven-wood` and `storm-race` are unchanged.
- `node tools/test-subclusters.mjs`: pass, 6 groups:
  - a young colony cannot split;
  - a split subcluster closes on its own target (40.3 to 11.4 cells) while
    the colony keeps its order;
  - one shared allowance; rest holds only the subcluster; merge works;
  - an interior region with no tips sprouts 2 by borrowing from the colony
    (6/6 tips);
  - a colony left without tips sprouts when ordered;
  - replay is deterministic.
- `test-subclusters-view` (built game, real mouse): pass. A held circle grows
  and selects; the bar and highlight appear; a tap steers only the
  subcluster; Rest holds only it; Escape and merge work; no browser errors.
  Screenshots `design/shots/subcluster-{circle,selected}.png` inspected.
- Also passing: `test-sim`, `test-crossing`, `test-region`, `test-dressing`,
  `test-storm`, `test-wildfire`, `test-drought`, `test-flood`,
  `test-evolution`, `test-fruiting`, `test-sections`, `test-reveal`,
  `test:storm-view` and `test:evolution-view`. `test-view` still fails only
  the long-standing refused-order check.

### 28 September 2026: simulation performance and real-GPU testing (`PERF-01`, `PERF-03`)

- Profiled a growing match headless (`--cpu-prof`) and inside the built game
  (Chrome DevTools protocol). Before this change, `harvest` took 46% of
  simulation time, mostly the shared-soil cell proxy. The transport sweeps
  took most of the rest, and terrain noise ran on every cell-position lookup.
- Result: 800 to 282 CPU-ms per simulated second at ~4,400 nodes (best of 5,
  interleaved against the committed code). A 90 s fingerprint of every node,
  tree and soil voxel is bit-identical to the committed code on `raven-wood`
  and `storm-race`.
- One micro-optimization was measured, found slower (270 ms against 139 ms)
  and reverted. Wall-clock timings on this laptop varied up to 2x between
  runs, so only interleaved CPU-time comparisons were used for decisions.
- Software-WebGL frame timings were shown to be dominated by one-time
  SwiftShader shader compilation (seconds per program). No program is created
  in steady frames (0 in 10 frames in each view), so those timings are not a
  hardware budget.
- `npm run check:gpu`: renderer `ANGLE (NVIDIA GeForce RTX 4060 Laptop GPU,
  Direct3D11)`. 60 fps and 16.8 ms p95 in both views at 72 and 4,923
  strands at 1x. At 4x with 4,923 strands: 20.7 fps forest, 4.7 fps
  underground. Without `--force_high_performance_gpu`, Chromium used the
  Intel UHD integrated GPU.
- Software-rendering notice checked in the built game: shown on SwiftShader
  with the automation flag masked, absent on the GPU
  (`design/shots/gpu-notice.png` inspected).
- `npm run typecheck`: pass. Headless and browser suites were not rerun
  after these changes; the fingerprint equality stands in for the simulation
  suites.

### 28 September 2026: flood and underground effects (`TECH-03`, `TECH-06`)

- New: `src/sim/flood.ts`, `src/render/flood.ts`,
  `src/render/underground-weather.ts`, `tools/test-flood.mjs`,
  `tools/test-underground-view.mjs`. Changed: `match.ts` (the storm drives the
  flood and resets its tallies on summon), `world.ts` (`SoilCell.flooded`,
  `passableAt`, `Tree.drowned`), `forest-floor.ts` (floodwater and silt),
  `water.ts` (`setFlood`, course), `ui/storm.ts`, `game.ts`, `package.json`,
  four module lists. `test-storm.mjs` now also freezes the flood in its
  frozen-ecology fixture. On the stream-crossed storm-race home tile, the flood
  otherwise washes out the fixture's bond junctions and blocks re-summoning;
  that is intended gameplay, and `test-flood` covers it.
- Flood cost: `flood.step` took 1.6 s of 19.5 s of simulation over a 155 s
  storm, about 4 ms per 0.25 s beat.
- `npm run typecheck`: pass.
- `node tools/test-flood.mjs`: pass, 5 groups:
  - the flood rises with the storm, reaches its bank, is waterlogged and
    closed to growth, spares high ground, then drains and reopens;
  - strands are washed away or drowned, while deep, cord and high-ground
    strands survive;
  - oak drowns while birch ends at 0.52;
  - silt enriches only the flooded reach;
  - replay is deterministic.
- `npm run test:underground-view`: pass. At the flood peak, debris moves over
  4 stands and 50 transect columns are drawn flooded. It drains clean; the
  player lost 4 drowned strands. Fire and drought are drawn in the soil. No
  browser errors. Synthetic fixture, fast QA.
- Screenshots inspected: `design/shots/{flood-surface,flood-close,underground-flood,underground-fire,underground-drought}.png`.
  - Rain streaks fall through a soaked blue topsoil, with standing water above
    the flooded columns; its edge is stepped per column.
  - Heat glows under the fire front, with an ash crust behind it.
  - A pale dry band shows with cracks sinking into it.
  - Close up, floodwater spreads beside a swollen stream.
  - In the overview, the storm's darkness hides the flood.
  - Tuned after the first capture: the ribbon widened 3.5x folded into spikes
    at bends (now 2x, with the floor drawing the spread); the floor water was
    too dark; the underground drought was nearly invisible and the fire
    modest.
- Also passing: `test-drought`, `test-wildfire`, `test-storm`,
  `test-evolution`, `test-sim`, `test-region`, `test-dressing`,
  `test-crossing`, `test-fruiting`, `test-sections`, `test-reveal`, and
  `test:storm-view`, `test:wildfire-view`, `test:evolution-view` and
  `test:drought-view`. `test-view` still fails the refused-order check below,
  cause not established.

### 28 September 2026: drought (`TECH-06`)

- New: `src/sim/drought.ts`, `src/render/drought.ts`, `src/ui/drought.ts`,
  `tools/test-drought.mjs`, `tools/test-drought-view.mjs`. Changed:
  `match.ts`, `evolution.ts` (`parch-crown`), `network.ts` (`witherNode`),
  `world.ts` (`Tree.parched`), `wildfire.ts` (shared `regionNetworks`),
  `forest-floor.ts` (crack shader), `forest-dressing.ts` (wilt), `surface.ts`,
  `water.ts` (`setDryness`), `stage.ts`, `game.ts`, `styles.css`,
  `package.json`, four module lists and `test-evolution-view` (now 9 techs).
- Tuning by measurement (four seeds). A single thirst rate was knife-edge:
  0.008 killed about 5% of trees and 0.011 killed about 75%, because trees
  declined in lockstep. Species root depth, maturity and a per-tree seed now
  spread the outcome: at 0.013, 29% of trees die, all hemlock and birch, never
  oak. Strand rules leave the shallow rival losing 411-531 strands while a
  deeper colony loses 0-80. The drying pass runs on a 0.25 s beat; the
  per-step version cost 20-40% of simulation time.
- `npm run typecheck`: pass.
- `node tools/test-drought.mjs`: pass, 8 groups:
  - gating and exclusivity with storm and fire; onset severity, rain withheld,
    fruiting halted and phase boundaries;
  - far ground parches to 0.03 while the stream bank stays at 0.50;
  - a fed tree holds at 1.00 while an unfed one falls to 0 and a weak one dies
    standing; stream-side roots are untouched;
  - oak ends at 0.54 health where hemlock reaches 0;
  - shallow strands wither while deep, banked and root strands live;
  - unstepped ground rewets from 0.03 to 0.16;
  - a fire kindled into a drought burns 73% of living trees against 44%;
  - replay is deterministic.
- `npm run test:drought-view`: pass. The drought is called through the real
  button; the heat warning is followed by severity shown at 0.99, the stream
  at 26% width and dust in the air. The fed tree survived (0.94 to 1.00) while
  23 trees died of thirst. The rival lost 460 strands; the deep player colony
  lost none. Recovery clears the cracks. No browser errors. Synthetic
  late-game fixture, fast QA/software render.
- Screenshots inspected: `design/shots/drought-{picker,active,close,underground}.png`.
  The overview shows bleached land with a darker damp stream corridor. The
  close-up shows cracked plates, with the fed tree green among straw-yellow
  wilting crowns. Crack lines were thinned after this capture and not
  re-inspected. Underground, the drying shows only as subtle lightening.
- Also passing: `test-wildfire`, `test-storm`, `test-evolution`, `test-sim`,
  `test-region`, `test-dressing`, `test-crossing`, `test-fruiting`,
  `test-sections`, `test-reveal`, `test:storm-view`, `test:wildfire-view` and
  `test:evolution-view` (9 techs). `test-view` still fails the refused-order
  check, now with the note "The frontier begins to grow again." and resting
  false; cause still not established.

### 28 September 2026: wildfire (`TECH-06`)

- New: `src/sim/wildfire.ts`, `src/render/wildfire.ts`, `src/ui/wildfire.ts`,
  `tools/test-wildfire.mjs`, `tools/test-wildfire-view.mjs`. Changed:
  `match.ts`, `evolution.ts` (`ember-crown`), `network.ts` (`burnNode`),
  `world.ts` (`Tree.burned`), `forest-floor.ts`, `forest-dressing.ts`,
  `surface.ts`, `stage.ts`, `game.ts`, `styles.css` and `package.json`.
- Tuning is from measurement. Soil moisture under trees sits at about
  0.4-0.55 at every depth, so a fixed wet threshold spared about 85% of trees.
  Relative dampness now burns 37-38 of about 76 living trees per fire over three
  seeds. The rival loses 145-286 strands per fire; the player loses 0-18,
  depending on how deep the colony grew.
- Fixed while verifying: an earlier PowerShell edit had turned four
  non-ASCII characters in `match.ts` into mojibake; reversed exactly. Four
  suites needed `wildfire` added to their copied module lists.
  `test-evolution-view` expected 6 techs; it was already stale at 7 with
  Storm crown and is now 8. Fire UI classes were separated from the storm's so
  the two instruments no longer share selectors.
- `npm run typecheck`: pass.
- `node tools/test-wildfire.mjs`: pass, 6 groups:
  - gating, atomic cost, storm exclusion and phase boundaries;
  - the front sweeps in order (first burns at 46.5 < 67.9 < 90.3 s);
  - dry trees burn and wet ones are spared;
  - shallow strands burn, 10 cm strands are singed, and
    deep/cord/wet/root strands survive;
  - fruiting bodies burn with their reserve and the soil turns to ash;
  - the rival burns alike, the ash flush lasts through the aftermath only,
    and replay is deterministic.
- `npm run test:wildfire-view`: pass. The picker and the real Kindle button
  work; warning smoke rises. Mid-burn, 16 trees have burned, with 3 fire draws
  and glow 0.99. The aftermath flush covers 9 stands and burns 36 living trees
  in all. The rival lost 148 strands; the player's colony was singed once.
  No browser errors, so the shaders compiled. Synthetic late-game fixture,
  fast QA/software render.
- Screenshots inspected: `design/shots/fire-{picker,warning,burning,front,aftermath}.png`.
  Overview: glowing fire line, burned half thinned. Close-up: char ground,
  embers, flames on trunks, and green crowns ahead of the front. Fixed after
  earlier captures: fog that hid the forest, a blown-out additive/emissive
  close-up, pixel-noise leaf loss, and a lawn-green regrowth. The warning
  smoke column and the mid-burn smoke plume still read weakly from overhead.
- Also passing: `test-storm`, `test-evolution`, `test-sim`, `test-region`,
  `test-dressing`, `test-crossing`, `test-fruiting`, `test-sections`,
  `test-reveal`, `test:storm-view` and `test:evolution-view`. `test-view`
  still fails on the same refused-order check recorded below, with the same
  unestablished cause.

### 28 September 2026: storm spectacle and windfall (`TECH-03`)

- Added the vortex shader, heavy rain, lightning with stage flash, downwind
  lean for playable and background trees, and windfall (seeded tree falls that
  tear bonds and empty the bonded junction). Files touched: `match.ts`,
  `world.ts` (`Tree.fallen`), `render/storm.ts`, `surface.ts`,
  `forest-dressing.ts`, `stage.ts`, `game.ts`, and the storm tests.
- `npm run typecheck`: pass.
- `node tools/test-storm.mjs`: pass, 7 groups. New: windfall happens only
  while the storm is active, falls downwind, severs the bond, loses the junction
  stores and damages the junction without killing it, and respects the
  per-stand cap. Odds over 24 unforced seeded storms: 98 falls, 5.4% of trees,
  every storm fells at least one. The replay comparison now includes windfalls.
- `npm run test:storm-view`: pass. Up to 4 storm layers draw at once, with 810
  particles and the vortex visible. A windfall topples to 1.42 rad, is struck,
  and loses its bond. The flash reached 0.74 on the stage. Recovery is clean
  with no browser errors. Synthetic late-game fixture, fast QA/software render.
- Screenshots inspected: `design/shots/storm-{active,windfall,lightning}.png`.
  The spiral vortex reads over the region with the forest visible through its
  gaps. The felled tree lies bare, pointing downwind. A forked bolt strikes it
  under a neutral flash. An early periwinkle flash tint and a vertical,
  invisible-from-above bolt were fixed before these captures.
- Suites still passing: `test-evolution`, `test-sim`, `test-region`,
  `test-dressing`, `test-crossing`, `test-fruiting`, `test-sections`,
  `test-reveal`.
- `test-view`: **fail**. The check "a refused order is refused out loud"
  failed: clicking empty space beside the underground specimen showed "The
  frontier rests..." instead of the stone refusal. No storm runs in that path;
  the cause is not established. It was not bisected against the shared tree.
- Not measured: hardware-GPU frame time with 2,600 rain lines plus the vortex.

### 28 September 2026: summon storm (`TECH-03`)

- Codex/Astra built the simulation, UI and integration; Sonnet 5.5 wrote
  `src/render/storm.ts` on delegation. Claude reviewed the view, added the
  missing `tools/test-storm-view.mjs` and fixed a "1 possible landing tiles" plural.
- `npm run typecheck`: pass.
- `node tools/test-storm.mjs`: pass, 5 groups. Covers the prerequisites and
  atomic cost, invalid direction, direction lock, pause, and independence from
  the viewed stand. Also covers the warning boundary, held release, multi-tile
  range, paid independent daughters, no re-release, recovery and reinvocation.
  Dead parents forfeit held spores, the rival fruits through frost and
  colonizes on the same wind, replay is deterministic, and play continues past
  the introductory victory.
- `npm run test:storm-view`: pass. The picker previews 3 target tiles toward
  NE; summoning through the real button locks the direction and shows the
  countdown. A warning bloom is held, and the storm founds 2 independent
  daughters. The storm draws 3 layers and 350 particles (the veil fades after
  the front passes). Recovery returns to idle with nothing drawn and no browser
  errors. The late-game state is a synthetic fixture: the capstone is pushed
  directly, and the render is fast QA/software.
- Screenshots inspected: `design/shots/storm-{picker,warning,active}.png`.
  The active storm shows slate cloud bands and amber downwind spore streaks
  and the map greys the newly colonized tiles. Rain is faint. The first half
  of the warning has no visible sky change; the countdown is text-only.
- `node tools/test-evolution.mjs`, `test-sim.mjs`, `test-region.mjs`: pass.
  Broader journey/crossing/view suites were not rerun.

### 28 September 2026: mycorrhizal mushroom specimens (`ASSET-02/03`, `ATM-05`)

- Inspected photographs of *Boletus edulis*, *Cantharellus cibarius* and
  *Laccaria amethystina*. The standalone Blender source builds five GLBs;
  the full-pack builder includes the same recipe. Full-pack regeneration was
  not rerun in this change. Reference URLs live with each manifest entry.
- Porcini has three related lifecycle silhouettes, a stout pale stem, brown
  cap, pale rim and continuous pore-bearing underside. Chanterelle has a
  waved funnel and descending forked folds; amethyst deceiver has a slender
  violet stem and sparse gills. These are art candidates, not new factions.
- `ATM-05`: surface signatures now include button availability and completed
  bloom state; soil bodies replace their procedural fallback when art arrives.
  Ordinary simulation economy, spore dispersal and storm mechanics are unchanged.
- `npm run test:assets`: passed, 26 assets / 44 GLBs, 1,319.4 KiB total.
  New triangles: porcini 416 per stage, chanterelle 480, amethyst 264.
- `node tools/test-fruiting.mjs`: passed using the actual exported porcini
  meshes: late button arrival, cap opening, completion at unchanged progress,
  site position, instance reuse, visibility and disposal.
- Blender comparison sheet rendered and visually inspected:
  `design/shots/mushroom-specimens.png`. Reference photos are local ignored
  review captures, not distributed asset textures.
- `npm run test:mushroom-view`: build and browser checks passed. All five
  assets load, all three porcini meshes appear in both renderers, and a late
  soil asset replaces its fallback; no runtime errors. Synthetic fixture,
  fast QA/software renderer. `design/shots/porcini-in-game.png` was visually
  inspected. Build retains existing Browserslist, Tailwind-content and chunk
  size warnings; production JS is 888.53 kB (241.22 kB gzip).
- HalfSpace's web demo opened, but no end-to-end HalfSpace mesh export was
  established. Delivered geometry is authored and exported in Blender;
  a HalfSpace-to-game workflow remains unverified.
- Remaining: art-direction acceptance, fine stem reticulation/pore detail if
  close-up scale demands it, species-specific rules/selection, hardware-GPU
  performance and acceptance across lighting/seasons. Broad match/journey
  suites were not rerun for this asset change. Storm remains under `TECH-03/06`.

### 25 September 2026: authored fruiting bodies in the soil and on the floor (current tree)

Gave the modelled reproductive bodies their place in the game (`CORE-04`,
`ASSET-02`, `ATM-05`). One eruption is now drawn from the same art in both
views â€” a primordium in the soil, a cap that opens, and the clump left after
the spores go â€” and the player's own blooms stand on the forest floor at the
address the simulation recorded for them.

- `src/render/bodies.ts` is the shared stage vocabulary: which model each stage
  wears, the progress at which the cap opens, and the height a body stands at
  in each view's own unit (centimetres of soil below ground, metres of forest
  above it).
- `src/render/living.ts` keeps one body per site on the transect, in the stage
  that site's own progress has reached, and falls back to the procedural clump
  until the art arrives, so the sheet never waits on a file. A body being
  rebuilt mid-eruption does not restart its growth.
- `src/sim/network.ts` records the chosen strand's own physical address on the
  fruiting body and, through it, on the bloom. This is placement, not economy:
  no number in the simulation changed. A caller that names its own site (a
  regional order that has already chosen a voxel) still wins.
- `src/render/fruiting.ts` is new: the player's earned bodies standing on the
  region's ground in the region's own coordinates, so the two views agree about
  where a mushroom is. A bloom with no recorded site, or one whose file has not
  arrived, is omitted above ground rather than drawn somewhere plausible.
- `src/render/dispose.ts` gained `disposeInstance()`: an authored instance's
  materials are its own and are released, while its geometry belongs to the
  library and must survive every other copy.

Verification on this tree:

- `npm run typecheck` â€” pass.
- `npm run test:assets` â€” pass: 21 assets, 39 GLBs, 1,266.7 KiB. The registry
  assertions now cover all four reproductive bodies, and all four load through
  the same Three.js parser the game uses.
- `npm test` (`tools/test-sim.mjs`) â€” pass: 11 checks, including the full
  public-order journeys on `raven-wood`, `old-growth` and `ironwood` (2 blooms,
  480 spores each), the cut-supply fruiting checks and the determinism guard.
  This suite takes roughly fifteen minutes of wall clock on this machine; the
  same suite on the pre-change tree took about as long, so the cost is the
  suite's own whole-match stepping rather than this change.
- `node tools/test-journey.mjs --qa fast` â€” pass: **19 checks**, `PROBLEMS:
  none`, on a whole match played through the sheet's controls. Each bloom now
  adds three: the bloom records the ground it stood on
  (`{"x":206.5,"y":68.5,"z":-4.907}`), the soil draws an authored body for it
  (`bodies`/`authored` 1 then 2, none procedural), and a body stands on the
  forest floor above that site (`sites`/`standing` 1 then 2, `waiting: 0`, 450
  triangles each â€” the clustered model's own count).
- `npm run build` â€” pass.
- `node tools/test-view.mjs` at the normal preset â€” pass: **72 checks**,
  `PROBLEMS: none`, including "every tier of the authored pack declared in the
  manifest has loaded" (`loaded: 28, expected: 28, pending: 0, failures: 0`),
  which now covers the reproductive bodies' own files, and the crossing,
  framing, viewport, input and LOD checks unchanged. One earlier attempt on the
  same build failed only `a live crossing spends its wall-clock budget through
  the frame hitches` (4 sampled frames, worst frame 567 ms); the identical
  suite passed on the re-run, and that check is a wall-clock assertion under the
  software rasterizer rather than something this change touches â€” the crossing
  rig is unmodified.
- Built-preview visual QA at 1400Ã—900 on the shipping preset, `?seed=raven-wood`:
  a close transect view of an eruption (a finished clump plus a cap at 62 % of
  its eruption) and a forest-floor profile of the clump beside a fallen log,
  seated on the terrain at the strand's own regional address. These were staged
  states in a warm fixture rather than a played match â€” the journey above is
  the played evidence â€” and are written to the gitignored `design/shots/`.

### 24 September 2026: opening oak bonding on a lean strand (current tree)

- Reproduced the refused bond on seed `oak`: 10 seconds after directing growth
  to the opening oak, its nearest living strand held under the 1.1-carbon bond
  charge while the connected founder held over 140 carbon. The old nearest-node
  rule left the label on `gathering` despite ample carbon in the same body.
- `npm run build` passed after the label and bonding changes; main JS measured
  872.91 kB (236.39 kB gzip). The existing large-chunk warning remains.
- `npm run test:crossing` passed 18 checks in 31.55s with the connected-path
  charge rule, including a remote bonded tree and separate spore daughter.
- `node tools/test-sim.mjs --bond-only` passed the `oak` regression: a lean
  junction with a funded connected founder bonds, exactly 1.1 carbon is spent,
  and a genuinely unfunded route is still labelled and refused as poor.
- Built-page `node tools/test-opening-bond.mjs` passed on the fast SwiftShader
  browser: the visible `Reach Â· oak` label became `Bond Â· oak`, and clicking it
  bonded one oak at 10.3 simulated seconds with no page errors.
- The broader `npm test` and a full `test-journey` run on seed `oak` were
  stopped after the focused bond path passed; neither supplies a current
  whole-match result for this tree. The previous whole-match results below
  remain historical, and later-match balance is still to be rechecked.

### Earlier 24 September 2026 tree: opening XYZ continuity and 3D regional steering

- `npm run build` passed; main JS measured 872.18 kB (236.15 kB gzip).
  The existing large-chunk warning remains. No deployment was made.
- `npm run test:crossing` passed 18 checks in 8.73s. The new checks compare
  every existing node address and XYZ and the soil hash before/after promotion,
  observe an ordered lateral move from a perpendicular section, and drive a
  real western arrival while the selected crossing points north. The portal
  records the west edge. A forced no-corridor case still finds a passable
  opening slice; the fixture's conservation cases still pass.
- Built-page `node tools/test-regional-spatial-view.mjs --qa fast` and
  `node tools/test-regional-mature-view.mjs --qa fast` passed on 1200Ã—800 CSS /
  600Ã—400 drawing buffer ANGLE/SwiftShader with no browser errors. The mature
  check advanced 30 seconds of two-colony simulation in 5.61s without drawing
  those ticks; this is not a rendered 4Ã— frame-time result.
- `node tools/test-journey.mjs --qa fast --accelerated --verbose` passed 13
  played-UI checks through two blooms, 480 spores at 354s simulated, the
  outcome and a fresh restart, with no browser errors. It ran before the final
  no-corridor opening-slice fallback; the build and focused checks above were
  rerun after that fallback.
- `node tools/test-region.mjs` passed 18 checks and `npm test` passed 10 after
  the 3D refactor and before the final corner guard and opening-slice fallback.
  The build, crossing and browser checks above were rerun after those changes.

### Earlier 24 September 2026 tree: shared opening soil and independent spore daughters

- `npm run build` passed on that earlier tree with the existing bundle-size
  warning; the main JS measured 865.71 kB (234.36 kB gzip). No deployment was
  made.
- `npm run test:crossing` passed 15 checks in 6.51s, including a paid spore's
  distinct spatial body on the shared soil and root-bond ownership when two
  graphs occupy one stand.
- `node tools/test-region.mjs` passed 18 checks, including paid funding,
  wind range, camera-independent two-minute stepping, deterministic seeds and
  the survey's separate physical-connection and lineage fields.
- `npm test` passed 10 standalone simulation checks, including three full
  two-bloom journeys, severance, conservation and deterministic orders.
- `node tools/test-sections.mjs` and `node tools/test-reveal.mjs` passed 10
  clipping/navigation checks and 6 projection/picking checks respectively.
- Built-page `node tools/test-regional-mature-view.mjs --qa fast` passed at
  1200Ã—800 CSS / 600Ã—400 drawing buffer on ANGLE/SwiftShader: an empty tile
  opens underground, a paid daughter rebinds section controls, the stand
  selector moves away and back, daughter orders leave the parent alone, and
  returning to the founding stand restores its local controls. Advancing 30
  simulated seconds took 1.69s without rendering those ticks;
  this is not a 4Ã— rendered frame-time result. No page errors occurred.
- Built-page `node tools/test-regional-spatial-view.mjs --qa fast` and
  `node tools/test-sections-view.mjs --qa fast` passed the existing normal-match
  seam/reveal smoke and 27 fixture section/reveal checks, with no browser errors.
- `node tools/test-journey.mjs --qa fast --accelerated --verbose` passed 13
  played-UI checks through two blooms, 480 spores at 354s simulated, outcome
  and fresh restart, with no browser errors. The ordinary opening still works
  after binding it to shared soil.

### 24 September 2026: ordinary-match spatial crossing and connected views

- `npm run typecheck` passed on the edited tree. `npm run build` passed with the
  existing bundle-size warning; the main JS measured 859.23 kB (232.60 kB
  gzip) in this build. No deployment was made.
- `npm run test:crossing` passed 13 focused checks in 5.39s. The new checks
  adopt an existing funded regional network without a second kit, step it once,
  grow a real seam edge into the neighboring stand, keep growth separate from
  spore parentage in the survey, and grow a naturally bonded `old-growth`
  opening across an edge without seeding its resources by hand.
- `node tools/test-regional-spatial-view.mjs --qa fast` passed on the built
  1200Ã—800 page: the normal match adopted its own graph, took a section growth
  click in regional XYZ, crossed a real seam after a natural bond, followed the
  seam into the next stand, returned to the same forest pose, revealed the same
  graph and picked a projected strand back into a section. It also checked
  soil, network and stream visibility on the first returned forest frame. The renderer was
  ANGLE/SwiftShader software Vulkan, 600Ã—400 drawing buffer, with no page errors.
- `node tools/test-sections-view.mjs --qa fast` passed 27 fixture/browser
  checks on the same built tree, including section navigation, forest return,
  reveal picking and crown selection, with no browser errors. Full simulation,
  region, view and journey suites were not rerun; their older records remain
  historical.

### 20 September 2026: fuller forest and continuous seasonal ground

Current-tree evidence for `VIEW-08`, `ASSET-04`, single-tier props (`ASSET-03`),
rendered community ground cover (`MAP-05`) and palettes (`ATM-04`):

- `npm run build`: TypeScript and bundling pass. Existing warnings remain for
  Browserslist data, Tailwind content configuration and bundle size.
- `npm run test:dressing`: 9 checks pass (1.36s), including deterministic floor
  samples, continuity across both stand axes, bounded weights, wet banks,
  original placement exclusions and unchanged simulation input. The band check
  verifies ordered choices instead of pinning superseded art-tuning constants.
- `node tools/test-dressing-view.mjs --qa fast`: 13 checks pass, zero browser or
  shader errors (28.5s). Chromium/ANGLE SwiftShader; 1200x800 CSS, 600x400 buffer.
  All 1,968 medium decorations draw in 17 batches / 443,566 triangles. Sparse:
  602 / 135,202 triangles; dense: 2,468 / 558,956. Both use 17 batches. Actual
  fast draw calls: 62 dressed versus 45 bare. The normal comparison now waits
  for assets to settle; comparing its partially loaded frame was a test race.
- Separate normal-quality SwiftShader inspection at 1000x700 captured the
  region, four seasonal closeups at one fixed pose and the underground endpoint,
  with zero browser/shader errors. At 824 duplicate shared-edge vertices,
  positions, normals and all four habitat weights match exactly (all maximum
  differences zero). Normal medium counts match fast. Captures are under
  `design/shots/`: `forest-overview-normal.png`,
  `forest-{spring,summer,autumn,winter}-close-normal.png`, and
  `forest-underground-normal.png`.

The checked images show overlapping crowns over brown litter/earth and moss
patches without repeating diagonal bands, visible stream banks and a solid
perimeter. Autumn oak is russet, birch gold and hemlock green. Authored winter
leaf drop is **not** implemented. These software-renderer checks do not establish
target-hardware frame times. Intermediate crossings and multi-seed low-angle
ground contact remain unverified.


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
and the channel and water table below. Growth orders now carry their own words â€”
`Simulation.growTo` â€” so the sheet can say the point is the stream rather than
blaming stone, and both the founding spore and the rival's first strand step out
of the water onto the nearest bank instead of starting in it.

Verified on this tree:

- `npm run typecheck` and `npm run build` pass. Production JS is 773.05 kB
  (205.40 kB gzip).
- `node tools/test-region.mjs` â€” 18 checks pass, including the two new ones.
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
  underground channel has been inspected â€” so the ribbon's width, the notch's
  darkness and the water-table shading are visually unjudged.
- `node tools/test-sim.mjs` was not run to completion after this change; it was
  stopped to save time. The standalone prototype stand is built without a
  region, so it has no stream by construction and its journeys should be
  unchanged â€” an argument, not a result.
- The underground channel is a single mean column per stand rather than a true
  course; see the known limitations for what that means and what would fix it.

### 19 September 2026: regional survey layer (`MAP-11`)

The forest gained its survey. `S`, or **Survey the region**, opens a printed
ledger of the nine stands in the sheet's own field-record language â€” a record,
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
- `node tools/test-region.mjs` â€” 16 checks pass. The three new ones cover: every
  stand is reported and unheld ground carries no underground record; a funded
  daughter appears with its parent, hop, germinating state and lineage; and a
  colony behind a dead link is occupied, disconnected and non-contiguous while
  its recorded route survives.
- `node tools/test-navigation.mjs --qa fast` â€” 23 checks pass, no browser errors.
  The seven new ones cover: the ledger opens with one line per stand; the summary
  states holds, lineage and continuity; a held stand prints its colony state and
  parent stand; a surveyed stand prints a health band and tree count; unheld
  ground prints as not surveyed beneath; choosing a line selects that stand and
  marks it; and `Escape` closes the page. A portrait check keeps the page on
  screen at 390Ã—844.
- `node tools/test-view.mjs` at the normal preset â€” 69 checks pass,
  `PROBLEMS: none`. The survey wiring disturbed no crossing, framing, input, tier
  or tier-swap check. That run, and the `test-journey`, `test-region` and
  `test-batches` runs below, were taken before the last two lines of this
  changeset: `SurveySheet` no longer moves focus when the page opens or closes,
  because the auto-focused close action drew a focus box the sheet's language
  does not use. No check in those suites opens or closes the survey, and
  `test-navigation` and `typecheck`/`build` were re-run after the change (23
  checks). The other four suites were not re-run on the final source; nothing
  they exercise opens or closes this page.
- `node tools/test-journey.mjs --accelerated` â€” 13 checks pass at the normal
  preset; `node tools/test-batches.mjs` â€” 3 groups pass.
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
- `node tools/test-navigation.mjs --qa fast` â€” 14 checks pass, no browser
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
- `node tools/test-batches.mjs` â€” 3 groups pass: independent transforms, colours
  and `stand:tree` identities through capacity growth; tier migration and stand
  hiding dropping old slots without losing identity; re-entry restoring hidden
  stands without drawing the original copies.
- `node tools/test-region.mjs` â€” 13 checks pass, including one shared regional
  season across colonized and dormant stands, funding debited from real node
  stores with an atomic refusal that charges nothing, off-screen growth,
  watched-versus-unwatched determinism over two minutes, and same-seed
  colonization. The older checks mistook summary counters for separate reserves;
  the funding checks now inspect node stores and the next simulation tick.
- `npm test` â€” 10 checks pass, including a full public-order journey on
  `ironwood` (2 blooms, 480 spores, 354 s, 190 living strands) and the
  determinism guard. `JOURNEY_SEEDS=raven-wood REGIONAL_JOURNEY=1 node
  tools/test-sim.mjs` â€” 8 checks pass with a regional match behind the same
  journey (raven-wood, 2 blooms, 480 spores, 354 s, 198 living strands).
- `node tools/test-journey.mjs --accelerated` â€” 13 checks pass at the normal
  preset, driven through the sheet's own controls and ending in a fresh sheet.
- `node tools/test-view.mjs` at the normal preset â€” 69 checks pass,
  `PROBLEMS: none`. This closes the normal-quality pass the LOD entry below had
  left owed: all 12 tier files load, the overview draws 0 / 57 / 18, a focused
  crown refines the stand to 75 fine trees, a close camera draws 44 / 31 / 0,
  all 75 `stand:tree` keys survive, 56 of 56 tier swaps preserve placement, and
  every crossing, framing, viewport and input check passes at shipping quality.
- `node tools/profile-forest.mjs` at the normal preset (960Ã—640, SwiftShader
  software backend, 13th Gen Intel i7-13700HX, 16 GiB) â€” opening median 723.6 ms
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

- `npm run typecheck` â€” pass.
- `npm run test:assets` â€” pass: 21 assets, 39 GLBs, 1,266.7 KiB, with the
  manifest's tier files, budgets, bounds, anchors and materials checked through
  the same Three.js parser the game uses.
- `node tools/test-lod.mjs` â€” 9 checks pass: the perspective fraction, degenerate
  sizes and distances, band ordering with a stable middle interval, the game's
  own framing at ~555 (overview) and ~150 (focused crown) world units, both
  boundaries holding a tree steady on either side, no oscillation across a
  0.002-step sweep from every starting tier, monotone refinement through a
  continuous zoom without skipping a tier, a hard cut crossing both boundaries,
  and clamping of non-finite input.
- `npm run build` â€” pass: 752.49 kB production JS (199.48 kB gzip), the Vite
  chunk-size warning unchanged.
- `node tools/test-view.mjs --qa fast` â€” 69 checks pass, `PROBLEMS: none`. The
  new tier checks are: all 12 declared tier files loaded with 0 failures; 75 of
  75 trees dressed; the region overview drew 0 LOD0 / 57 LOD1 / 18 LOD2; focusing
  a crown through the sheet's own selector raised the fine tiers from 57 to 75
  with the same 75 trees dressed; the forest's closest framing (distance 105)
  drew 44 / 31 / 0; the 75 `stand:tree` identity keys survived every swap with
  the same asset; all 56 trees that changed tier kept their exact position,
  quaternion and scale (within 1e-9) and world position (within 1e-3); and the
  selected crown kept its identity and refined rather than jumping tiers.
- `node tools/test-view.mjs --smoke --qa fast` â€” 9 checks pass, 9 stands and 75
  trees present after the intake change.
- `npm test` â€” 10 checks pass; the simulation is untouched by this work and no
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

- `npm run build` â€” **pass**. `tsc --noEmit` and Vite produced 748.24 kB JS /
  15.78 kB CSS. Existing nonfatal Browserslist, Tailwind content and
  chunk-size warnings remain.
- `node tools/test-view.mjs --qa fast --smoke` â€” **pass: 9 checks**, no
  console or page errors. The SwiftShader report was
  `css=1200x760 buffer=600x380 pixelRatio=0.5 antialias=off shadows=off shadowMaps=off bloom=off postprocessing=off stands=9 trees=75`.
  The check asserts that fast mode has antialiasing, ground shadow decals,
  bloom, postprocessing and shadow maps off.
  Selecting through `#forest-tree` produced â€œNorthern red oak Â· 1 Â· your stand
  -> Northern red oak Â· Living Â· Not yet bonded Â· your own standâ€; descending
  reached the underground view at blend 0 and returning reached the forest at
  blend 1.
- `node tools/test-view.mjs --qa normal --smoke` â€” **pass: 8 checks**, no
  console or page errors. The same viewport and 9 stands / 75 trees reported
  `buffer=1200x760 pixelRatio=1 antialias=on shadows=decals shadowMaps=off bloom=on postprocessing=on`;
  the check asserts that normal keeps shipping antialiasing, ground shadow
  decals, bloom and postprocessing on while shadow maps remain off.
  selection and the forest/underground round trip behaved identically.
- `node tools/shoot.mjs --qa fast --url "http://127.0.0.1:4173/?seed=raven-wood" --size 960x640 --at 1500 --freeze --canvas-out design/shots/qa-fast-smoke.png`
  â€” **pass**. The fast drawing buffer was 480Ã—320 in a 960Ã—640 CSS viewport;
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
- `npm run test:assets` â€” **pass** for all 39 exported GLBs (1,266.7 KiB total).
  Uses the installed Three.js GLTFLoader, checking complete embedded GLB data,
  one authored mesh with at most three material primitives, triangle/byte
  counts, finite attributes, index ranges, metre-scale Y-up bounds, ground
  contact, equal LOD heights/anchors, double-sided foliage, and no foliage on
  dead variants. Trees/saplings meet 2,000/900/320 triangle ceilings; all other
  props meet 500. This is shipped-pack QA, not a general glTF conformance test
  or loader failure-path test.
- Independent Blender rebuild with `--output` pointing at a new temporary
  directory â€” **pass**: SHA-256 matches for all 39 GLBs and the manifest.
- `npm run build` â€” **pass**, TypeScript and Vite, 746.18 kB JS / 15.78 kB CSS.
  Existing nonfatal Browserslist, Tailwind content and chunk-size warnings remain.
- In-game capture â€” **pass**, opening nine-stand forest and keyboard zoom, no
  page/console errors. `node tools/shoot.mjs --url 'http://127.0.0.1:4173/?seed=raven-wood' --size 960x640 --canvas-out design/shots/forest-assets-game.png --at 1500 --freeze`;
  the same command with seven `--key '='` options writes
  `forest-assets-detail.png`. Inspected both captures: distinct broadleaf and
  hemlock crowns render in the game's lighting. Existing terrain/slab seams
  remain outside this art change. The in-app browser connection failed before
  navigation (missing sandbox metadata); these captures use the existing
  repository harness.
- Full simulation/journey suites are not repeated for this asset-only change;
  no simulation or runtime TypeScript was modified.
- `npm run test:view` â€” **interrupted, no result**. The full software-WebGL
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

- `npm run build` â€” **pass**. TypeScript and Vite production build complete in
  0.43s; production JS 667.28 kB (173.32 kB gzipped). Nonfatal warnings: stale
  Browserslist data, an apparently external/unused Tailwind content warning, and
  a production chunk above 500 kB.
- `npm test` â€” **pass: 10 checks**. Conservation, cut supply, disconnection,
  supplied fruiting, three two-bloom victories, guards, and identical-order
  determinism. These are the same journey numbers as before the regional work
  (`raven-wood` 354s, `old-growth` 652s, `ironwood` 354s), which is the evidence
  that generating a stand from default site conditions reproduces the old
  single-stand world exactly.
- `node tools/test-region.mjs` â€” **pass: 12 checks**, seconds on a laptop:
  - All twelve internal borders of the 3Ã—3 region agree exactly in height and in
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
    exactly the fund its parent paid â€” no carbon, water or mineral appears.
  - With every neighbour already colonized, a storm carries a spore past them.
  - A colony with nothing to give sends nobody, and is never driven into debt.
  - A colony grows while nobody is looking, and its stand can be entered later.
  - Two minutes of match are byte-identical whether or not the player moves
    between stands, and two matches from one seed colonize the same stands with
    the same spores.
- `npm run test:view` â€” **pass: 60 checks**, measured on a built preview with
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
  - Framing at 1600Ã—1000, 1366Ã—768, and 390Ã—844: the specimen's corners stay
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
- `npm run test:journey` â€” **pass: 13 checks**. A whole match played with clicks
  on the printed controls on `raven-wood`: Awaken the spore, `â†— Reach Â· oak`,
  `â—‡ Bond Â· oak`, a click on the soil 8cm below the surface to send the frontier
  up, Rest & gather, the Fruit order, a `â—‡ Fruit here` strand twice, the outcome
  ("Fruiting recorded", packet 480), and "Open a new sheet". Two blooms and 480
  spores at 354s of match time; no assignment to simulation state anywhere in
  the check. Under software WebGL at 1200Ã—760 the match takes about eleven
  minutes of wall clock at 4Ã— pace.
- Built-preview captures, no page or console errors:
  `node tools/shoot.mjs --url http://127.0.0.1:4173/?seed=raven-wood --out design/shots/review-forest.png --canvas-out design/shots/review-forest-canvas.png --at 4000 --freeze`,
  the same with `&view=underground`, and the same at `--size 390x844`. The
  portrait capture shows the whole stand inside the sheet instead of cropped at
  both ends.
- Impeccable mechanical detector â€” not re-run in this changeset; the last
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
   â€œcurrentâ€ test claim forward.
6. Update Architecture when files or responsibilities move.
7. Update README for user-visible controls or setup changes; update PRODUCT.md
   for product truth; update DESIGN.md for durable visual rules or tokens.
8. Keep deferred work explicitly deferred. Do not silently expand scope.
9. Do not create a second plan, handoff, implementation status, TODO ledger, or
   roadmap. Fold durable information into this file and rely on git history for
   superseded narrative.

When handing work to another agent, point them to this file and the affected
feature IDs. A valid handoff is a current feature row, remaining gap, and
verification entryâ€”not a new document.

**More than one agent shares this working tree.** Stage explicit paths rather
than `git add -A`: a commit that sweeps the whole tree will pick up another
lane's half-written files, and a pushed commit cannot be taken back. Check
`git status` immediately before committing, keep your lane's files and theirs
apart, and re-run your checks once the other lane has settled if you touched
shared files such as `src/game.ts`.

## Change log

### 27 September 2026: tech ability icons recorded as needed

- Recorded the open need for small authored icons (pictures) for the tech tree
  abilities: one per adaptation and one per power. The tech dialog is text-only
  today and no icon art exists. Tracked as a remaining gap on `TECH-01` and
  `TECH-02`; no implementation was started.

### 27 September 2026: randomized starting stand user direction recorded

- Recorded the requested opening change: the player's starting tile should be
  chosen at random per match by the procedural generator, and the opponent
  mycelium must begin in a different starting tile than the player. Added as
  `MAP-16` (Planned), with remaining-gap notes on `MAP-09` and `ADV-05`. The
  current tree still resolves the player's stand to a fixed best score and
  starts the rival inside the player's own opening transect; no implementation
  was started.

### 27 September 2026: tech tree growth, organic UI and performance direction recorded

- Recorded the requested tech-tree work: flesh the six adaptations out into
  deeper branching progression (`TECH-04`) and present the tree as a real
  tree/fungal network with strands, nodes, fruiting-body powers and per-ability
  icons instead of the current text columns (`TECH-05`). Added a concrete
  plan under Current priorities; no implementation was started.
- Recorded performance as required scope for that work (`PERF-03`): measure
  hardware-GPU frame time, a rendered 4x mature match, draw calls, triangles
  and renderer resources before and after, keep the tree view out of the
  per-frame budget, use one overlay plus a shared icon atlas, and re-check the
  fast QA preset and bundle size. `PERF-01/02` evidence remains pre-change.

### 27 September 2026: three ecological superpowers recorded

- Recorded the requested superpower tier for the tech tree: flood/storm,
  drought and a third, added as `TECH-06` (Planned). `TECH-03` (Summon storm)
  is the storm member; flood is its water half. The third is proposed as
  wildfire, with deep freeze and blight pandemic named as alternatives, and
  needs the user's confirmation before implementation.
- Noted that each superpower needs superimpressive, authored graphics and
  gameplay - a real multi-stand ecological transformation with warning,
  counterplay and cost, not a tint or a stat change - and must be budgeted
  under `PERF-03`. Design direction only; no superpower beyond the three
  existing modest powers exists and no tests were run.

### 24 September 2026: unchanged opening addresses and free 3D regional steering

- Gave every node in the opening and spore-founded local transects a persistent
  regional XYZ and stand owner when its soil is bound. Promotion now expands the
  founder-relative growth bounds and adopts the graph without rewriting any
  node coordinate or moving material. A stand without a complete east-west
  crossing corridor can still choose a passable east-west opening slice
  (`MAP-07`, `MAP-14`).
- Let regional tips choose passable neighbours in x, y and depth, pay once per
  voxel, and follow an XYZ order from either vertical-section orientation. The
  actual arrived stand determines its portal side; a diagonal corner hop cannot
  skip the two adjacent stands (`MAP-07`, `VIEW-06`). Regional fruit and cord
  selection use XYZ distance, and existing fruit sites retain their position.
- Kept the funded crossing fixture's narrow corridor for focused conservation
  checks while ordinary and spore-founded match bodies use free 3D growth.

### 24 September 2026: shared opening soil, independent spore graphs, all-stand sections

- Bound each played local transect to a lazy view of the regional SoilVolume from
  the opening tick; a local read leaves untouched soil sparse, while harvesting,
  a rival or tree writes the same voxel that spatial growth later uses
  (`MAP-04`, `MAP-14`). Promotion retains the opening's material state.
- Founded each paid spore as its own spatial graph with a separate root, stores,
  orders and tree-bond owner. Spatial bodies share soil but never share resource
  transport or connectivity automatically (`MAP-07`, `MAP-10`). The survey now
  separates physical connection from living spore lineage (`MAP-11`).
- Added direct stand selection to the underground Section panel and an empty
  soil viewer, so all nine tiles can be inspected; selecting a daughter rebinds
  its own network controls (`VIEW-06`, `MAP-08`). Added a bounded two-colony
  browser pacing check (`QA-01`, `MAP-12`, `PERF-01`).
- Recorded explicit player-directed graph fusion as future work (`MAP-15`).

### 24 September 2026: ordinary-match spatial crossing and connected views

- Promoted an existing player network into the shared soil/crossing coordinator
  on the forest's **Grow through a stand edge** action. The match now advances
  that player body once, keeps stand ecology and spore daughters separate, and
  records physical arrivals without inventing daughter colonies (`MAP-07`,
  `MAP-10`, `MAP-14`).
- Connected the Section browser and forest Network reveal to that ordinary
  match body, including section-space orders, root seeking, seam following,
  forest pose return and projected-strand picking (`VIEW-06`, `VIEW-07`,
  `MAP-08`). The survey names physical arrival separately from spore parentage
  and reads supply from the graph (`MAP-11`).
- Restored camera-appropriate overlay, soil, stream and surface visibility on
  the first frame back from a section, avoiding a one-frame flash above ground
  (`VIEW-06`, `VIEW-07`).
- Added focused headless and built-browser checks for a naturally funded
  ordinary-match crossing, its section interactions and the forest reveal.

### 20 September 2026: fuller canopy, continuous ground and species palettes

- Drew all placed understory/ground kinds, clamped requests to available asset
  tiers, increased canopy density/stature, and replaced uniform grass/litter
  scatter with authored ground cover and masked fragments (`ASSET-02` through
  `ASSET-04`, `MAP-05`).
- Replaced tile bands with regional habitat weights and a seasonal shader,
  matching normals, slope-seated props and a perimeter skirt (`VIEW-08`).
- Shared distinct species palettes between playable and decorative trees
  (`ATM-04`); simulation ownership and picking are unchanged.


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

- Began rendering the region (P1 item 3). `SurfaceForest` takes a tile â€” a stand
  id, its origin in the region and the region's own `heightAt` â€” so every stand's
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
- Began P1. `src/sim/region.ts` generates a deterministic 3Ã—3 region: a
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
  the wind â€” adjacent stands by default, further only in a storm â€” and a landed
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
- Stabilized the forest â†” underground crossing, closing P0 items 1-3. Replaced
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


### 27 September 2026 â€” network evolution and forest-dusk interface

- Kept one playable fungal network. Added `src/sim/evolution.ts`, six
  milestone-earned adaptations and three first-bloom powers, with effects and
  deterministic clocks in `stepNetwork` so local and regional bodies share them.
- Replaced the dominant catalogue presentation with the supplied reference's
  warm, serif, concentric-ring interface. Exact amounts remain available through
  focused/hovered resource names and Detailed readings. Existing Grow/Bond,
  Cord/Fruit, guidance, survey, pacing and atmospheric controls are retained.
- Updated PRODUCT, DESIGN and README to describe the new product/UI behavior.
  Existing unrelated regional, asset and simulation changes were preserved.
- Current checks: production build passes; `node tools/test-evolution.mjs`
  passes seven grouped checks covering every adaptation and power effect,
  eligibility, topology, cooldowns, spending and determinism. Browser check
  `node tools/test-evolution-view.mjs` passes desktop/compact layouts, focused
  quantities, modal focus/shortcut isolation, actual learning and invocation,
  cooldown feedback and expanded readings, without page exceptions. The final built-preview rerun also checks 820px readings, native disclosure Space without changing pace, and retained root-focus control styling.
- Independent impeccable finish review identified and prompted fixes for disclosure Space stealing, hidden readings at 761-900px, and the hidden root-focus control. Focused browser regressions pass for all three.
- Visual evidence: `design/shots/living-ui-desktop.png`,
  `living-ui-underground.png`, `living-ui-compact.png`, `living-tech-tree.png`,
  and `living-tech-tree-compact.png`. Captured with fast SwiftShader, frozen
  between explicit render frames; mature power state is synthetic. Remote
  Google Fonts were unavailable, so the inspected type uses local fallback.
  Initial continuous-render capture timed out; bounded captures succeeded.
- Full `npm test` passes all 11 checks on this simulation tree, including
  conservation, cut supply, dead founder, fruit supply/weather and deterministic
  orders. Natural headless two-bloom journeys pass on raven-wood (354 simulated
  seconds), old-growth (652) and ironwood (354), each releasing 480 spores.
- `node tools/test-view.mjs --qa fast --smoke` passes all nine behavioral
  assertions, including tree selection and the round trip, but exits nonzero
  because the sandbox blocks the external Google Fonts request. No game
  assertion failed. Older view checks now open disclosures and expect numerical
  readings to stay folded; the entire broad view suite has not been rerun.
- The initial accelerated journey on the development server was interrupted
  by hot reload at 103 simulated seconds. The built-preview rerun
  (`node tools/test-journey.mjs --qa fast --accelerated --verbose`) passes all
  19 gameplay assertions: two blooms, 480 spores, victory at 354 simulated
  seconds, authored bodies in both views, and restart. It exits nonzero solely
  for two blocked external Google Fonts requests. This journey exercises the
  ordinary controls without optional research; natural power earning/balance
  remains unverified. Final keyboard/layout fixes are covered separately by the
  passing final-build evolution browser suite. No deployment performed.
