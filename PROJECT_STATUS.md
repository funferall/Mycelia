# Mycelia — authoritative project status and feature log

Last updated: 18 September 2026.

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
prototype requiring transition, weather, performance, and interaction QA.

As of this update, the forest work and this documentation consolidation are
local working-tree changes and have not been committed or deployed.

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
| Simulation | `src/sim/{sim,network,world,content,rng}.ts` | Seeded world, fixed timestep, resources, network growth, tree trade, seasons, fruiting, outcomes |
| Integration | `src/game.ts`, `src/main.ts` | Frame loop, input, view state, simulation/render/UI/audio synchronization |
| Connected camera | `src/render/camera.ts` | Forest and underground camera goals, remembered framing, zoom/view transitions, reduced motion |
| Surface forest | `src/render/surface.ts` | Seeded 3D tree placement, forest floor, tree picking, wind, leaves, rain, seasonal presentation |
| Underground world | `src/render/{soil,forest,hyphae,living}.ts` | Soil, roots, networks, flow motes, mushrooms, spores, interaction feedback |
| Shared stage | `src/render/{stage,textures}.ts` | WebGL renderer, lights, fog, paper/specimen transition, bloom |
| Audio | `src/audio/soundscape.ts` | Ambient synthesis, bond/fruit/action cues |
| Interface | `index.html`, `src/styles.css`, `src/ui/{sheet,journey}.ts` | Botanical field interface, resources, orders, guidance, view and tree controls |
| Validation | `tools/test-sim.mjs`, `tools/shoot.mjs` | Headless deterministic regression and browser screenshot/error capture |

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
| CORE-07 | Partial | First-player journey through the actual UI | Guidance and controls exist; a complete two-bloom journey has not been browser-automated through visible controls. |

### Forest and underground views

| ID | Status | Feature | Evidence and remaining work |
|---|---|---|---|
| VIEW-01 | Implemented, unverified | Bird's-eye 3D forest | Seeded terrain, varied procedural trees, understory, litter, and an oblique overview render successfully. Verify supported viewport framing and mature/dead stands. |
| VIEW-02 | Implemented, unverified | Surface tree identity and selection | Crowns and selector options use simulation tree IDs; status reflects health, death, and bonds. Add automated crown-selection and tree/root round-trip checks. |
| VIEW-03 | Partial | Seamless forest ↔ underground journey | View buttons, `V`, zoom threshold, remembered camera state, selected-root descent, and reduced-motion snapping exist. Underground groups currently appear at a visibility threshold rather than a true crossfade. Low frame rates can stretch the transition because render delta is clamped. |
| VIEW-04 | Partial | Camera navigation | Forest pan/orbit/zoom, underground pan/tilt/zoom, keyboard pan/zoom, and `F` framing exist. Resize updates aspect but does not reframe the active view. Test rapid reversal and interrupted transitions. |
| VIEW-05 | Implemented, unverified | Safe input separation | Forest clicks select trees; underground clicks issue orders; input is suppressed during transitions. Exercise pointer cancel, drag thresholds, control focus, and rapid view changes in a browser. |

### Regional map, terrain, forest stands, and water

| ID | Status | Feature | Evidence and remaining work |
|---|---|---|---|
| MAP-01 | Planned | Multi-stand regional map | Expand a match from one local stand into a seeded grid/mosaic of logical forest squares. Begin with a tunable 3×3 to 5×5 target for prototyping; choose the shipping size only after simulation and rendering profiles. |
| MAP-02 | Planned | Continuous regional surface | Render logical stands as one continuous landscape with no artificial seams. Stand borders may appear in a botanical survey/atlas overlay for navigation and status, but should not be permanent terrain lines. |
| MAP-03 | Planned | Terrain-first generation | Generate regional elevation, ridges, hollows, slopes, aspect, drainage, exposed rock, soil parent material, disturbance, and deadwood before placing trees. All generation must be deterministic from seed and generator version. |
| MAP-04 | Planned | Hydrology and water features | Derive watersheds, flow paths, streams, ponds, vernal pools, wetlands, springs/seeps, seasonal channels, and local water tables from terrain. Connect surface water to underground moisture, saturation, erosion, drought refuges, and root architecture. |
| MAP-05 | Planned | Distinct forest stands | Generate coherent communities such as oak ridge, mixed hardwood slope, yellow-birch hollow, hemlock ravine, stream corridor, wetland edge, windthrow gap, and recovering clearing. Vary species composition, density, age structure, canopy openness, understory, litter, and deadwood. |
| MAP-06 | Planned | Stand suitability and succession | Species placement must respond to moisture, drainage, aspect, soil, light, and disturbance. Stand composition can change through growth, death, gaps, regeneration, disease, and recovery rather than remaining static scenery. |
| MAP-07 | Planned | Cross-stand fungal network | Permit cords, resources, infections, warnings, and eventually roots to cross stand boundaries through explicit graph connections. A severed inter-stand cord must isolate downstream colonies under the same conservation rules as local networks. |
| MAP-08 | Planned | Regional exploration and information | Let the player survey the region from above, select a stand/tree/water feature, and descend to the correct local underground context. Use soil opacity, incomplete surveys, and network sensing as fog of war rather than a conventional minimap. |
| MAP-09 | Planned | Generated-map fairness | Validate that every seed has a viable founding stand, reachable early partner, water and nutrient options, cross-stand routes, threat counterplay, and at least one recoverable path after loss. Reject or repair impossible seeds deterministically. |
| MAP-10 | Planned | Regional colonization loop | Recommended first design: begin in one stand, fruit spores into adjacent eligible stands according to wind and landing conditions, establish new colony centers, and pursue a regional restoration/fruiting objective. The current two-bloom victory is prototype scope and must be reconsidered before regional play ships. |
| MAP-11 | Planned | Regional atlas interface | Provide a restrained botanical survey layer showing stand identity, explored state, broad health, water, infection, and network continuity. It must use the established field-record language and avoid a generic RTS minimap or tile HUD. |
| MAP-12 | Planned | Simulation streaming and level of detail | Simulate the active stand and nearby interactions at full fidelity; update distant stands deterministically at a coarser cadence without changing outcomes based on camera location or frame rate. Add rendering LOD, pooled geometry, and bounded particles. |
| MAP-13 | Planned | Generator persistence and replay | Save world seed, generator version, stand state, RNG state, network boundary connections, hydrology, and local modifications. Identical seeds and orders must reproduce the same regional world across view changes and reloads. |

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
| ATM-04 | Partial | Four visible seasons | Color and deciduous leaf density blend from simulation season progress; hemlocks retain foliage. Add spring emergence, stronger drought stress, accumulating visual litter, cooler winter lighting, and clearer dormant-versus-dead silhouettes. |
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
| UX-01 | Implemented, unverified | Guided opening and journey model | `deriveJourney()` drives Reach → Bond → Gather → Fruit guidance. Browser-test refusal recovery and complete-match guidance. |
| UX-02 | Partial | Actionable root labels | Explicit root IDs and states exist. Verify collision handling, safe areas, compact viewports, and prioritization during a mature match. |
| UX-03 | Partial | Responsive layouts | Desktop render is inspected; compact styles exist. Verify 1366×768 and 390×844 without losing essential resource or view feedback. |
| AUDIO-01 | Partial | Generative soundscape | Ambient synthesis and restrained event cues exist. Add weather/forest layers and verify toggle, suspension, restart, and audio failures on speakers and headphones. |
| A11Y-01 | Partial | Reduced motion and keyboard access | Direct view snapping, ambient-motion control, focus outlines, keyboard view/pan/zoom/orders, pause, and notes controls exist. Audit focus order/restoration, canvas alternatives, and color-independent state cues. |
| PERF-01 | Planned | Measured performance budget | Measure simulation time, render time, draw calls, GPU/CPU memory, and frame time at opening, mature match, and the configured network ceiling on stated hardware. |
| PERF-02 | Planned | Scalable surface quality | Add foliage, weather, shadow, and pixel-ratio quality tiers only after profiling. Current production JS is about 663 kB and emits Vite's chunk-size warning. |
| SAVE-01 | Deferred | Local save/resume | Requires versioned deterministic simulation state, RNG state, bloom history, and camera/view state. |
| MULTI-01 | Deferred | Multiplayer | Do not begin before the single-player vertical slice and performance work are complete. |

## Current priorities

Work in this order unless the user explicitly changes priority.

### P0 — stabilize and verify the connected views

1. Replace the underground visibility threshold with a deliberate crossfade or
   cutaway progression so roots, networks, and soil do not pop into view.
2. Make transition duration stable in wall-clock time at low frame rates and
   verify reversing the transition at any point.
3. Reframe the active view after resize and verify 1600×1000, 1366×768, and
   390×844 layouts.
4. Add focused browser checks for Forest/Underground controls, `V`, wheel
   descent, selected tree → correct root, return context, safe clicks, and
   reduced motion.
5. Complete one two-bloom journey through visible UI controls rather than only
   simulation methods.

Exit criteria: the same selected tree can be followed down and back repeatedly,
with no unintended order, lost input, abrupt world pop, or broken framing.

### P1 — define the scalable regional world model

1. Write the deterministic data model for a region, logical stands, terrain,
   hydrology, local transects, and cross-stand boundary connections before
   increasing renderer dimensions.
2. Promote the current world into one stand record without breaking the existing
   deterministic tests or single-stand playable path.
3. Prototype a small multi-stand region with continuous elevation and one stream
   crossing at least two boundaries. Descend into two stands and preserve their
   independent underground state.
4. Define full-fidelity and coarse simulation cadences, ensuring camera location
   never affects results.
5. Add seed validation and round-trip tests for terrain boundaries, hydrology,
   stand selection, cross-stand transport, and save/replay inputs.

Exit criteria: at least four connected logical stands render as one continuous
forest, share coherent terrain and water, retain persistent underground state,
and exchange resources through deterministic boundary connections.

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
  stand grid, connected terrain generator, hydrology graph, cross-stand network,
  persistent local-slice selection, or distant-stand simulation yet.
- Surface and underground geometry share state but do not yet have automated
  round-trip identity tests.
- Transition visibility uses `blend < 0.75` for underground groups, causing a
  possible visual pop.
- The resize handler updates renderer/camera aspect but does not re-run framing.
- Surface weather is rain only; there is no general weather state machine.
- Wind has no explicit shared vector or strength and leaves do not settle.
- Surface performance has not been profiled; procedural tree geometry and one
  instanced foliage mesh per tree may become expensive on larger stands.
- Responsive and keyboard affordances exist but are incompletely exercised.
- `DESIGN.md` still needs a full token-level reconciliation after the forest
  visual direction is accepted.
- Browser QA screenshots live under ignored `design/shots/`; record commands and
  results here because those images are not durable repository evidence.

## Verification record

Latest verified on 18 September 2026:

- `npm run build` — **pass**. TypeScript and Vite production build complete.
  Nonfatal warnings: stale Browserslist data, an apparently external/unused
  Tailwind content warning, and a production chunk above 500 kB.
- `npm test` — **pass: 10 checks**. Includes conservation, cut supply,
  disconnection, supplied fruiting, three two-bloom victories, guards, and
  identical-order determinism.
- Built-preview browser capture at 1600×1000 — **pass** for forest and direct
  underground views, with no page or console errors.
- Forest snapshot state: `view=forest`, `surfaceBlend=1`, eight seeded trees on
  `raven-wood`.
- Direct underground snapshot state: `view=underground`, `surfaceBlend=0`, no
  active transition.
- Transition capture — functional, but remained active under software WebGL long
  enough to confirm the low-frame-rate timing risk recorded above.
- Impeccable mechanical detector — advisory findings only: new surface colors
  and several UI sizes are not yet recorded in `DESIGN.md`.

Useful commands:

```powershell
npm run build
npm test
npm run preview -- --host 127.0.0.1
node tools/shoot.mjs --url http://127.0.0.1:4173 --out design/shots/review.png --canvas-out design/shots/review-canvas.png --at 1500 --freeze
node tools/shoot.mjs --url "http://127.0.0.1:4173/?view=underground" --out design/shots/underground.png --at 1500 --freeze
```

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

### 18 September 2026

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
