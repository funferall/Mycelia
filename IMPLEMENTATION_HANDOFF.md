# Mycelia — executive summary and implementation handoff

Prepared 17 September 2026. This is a handoff for the next implementing model, not a claim that the game is finished.

## Executive summary

Mycelia should become a contemplative ecological strategy game in which the player cultivates a luminous fungal network beneath a living forest. Its central pleasure should be watching deliberate choices become visible life: a filament reaches a root, a bond begins exchanging nutrients, a tree recovers, and mushrooms eventually release the next generation.

The project has a working TypeScript/Three.js foundation and a deterministic browser simulation. The latest development pass adds a guided opening, clickable root targets, a Rest policy, permanent cord upgrades, a generative soundscape, detailed procedural foliage, atmospheric particles, and mushroom growth visuals. Several economic and input bugs were corrected. These changes are **local and uncommitted**.

The next milestone is a **complete, attractive, repeatably winnable single-player vertical slice**, not more feature breadth. The most important remaining work is to prove the entire growth–bond–rest–fruit loop, fix economic conservation and disconnected-network edge cases, make the player's decisions more legible, and verify performance and visual quality during a mature match. The opening now looks substantially better, but attractive initial scenery is not sufficient proof of impressive gameplay.

The user explicitly wants beautiful, impressive, meditative gameplay and permits Blender assets. Preserve the distinctive living forest cross-section. Favor patient, consequential decisions over combat micromanagement, urgent alerts, or decorative progression systems.

## Instructions for the implementing model

Continue from the current working tree. Inspect the diff before editing and preserve pre-existing work. Start with `npm run build` and `npm test`, then play through the actual interface. Finish and verify the core loop before adding systems. Treat proposed design changes below as recommendations, distinct from implemented behavior. Do not deploy or publish merely because a local build works.

Read these first:

- `mycelium-rts-outline-spec.md`: original game specification.
- `PRODUCT.md`: product constraints and ecological identity.
- `DESIGN.md`: established “Mounted Specimen” visual language.
- `src/sim/network.ts` and `src/sim/sim.ts`: economic and gameplay rules.
- `src/game.ts`, `src/ui/sheet.ts`, `index.html`: current interaction flow.
- This report's verification section before making completion claims.

## Current architecture

| Area | Files | Responsibility |
|---|---|---|
| Simulation | `src/sim/{sim,network,world,content,rng}.ts` | Seeded world, fixed timestep, growth, resources, trees, seasons, fruiting |
| Integration | `src/game.ts`, `src/main.ts` | Frame loop, input, camera, UI and audio synchronization |
| World rendering | `src/render/{stage,soil,forest,hyphae,camera,textures}.ts` | Three.js scene, soil, roots, filament geometry, bloom and view controls |
| New scenery | `src/render/canopy.ts` | Instanced leaves and branches, moss, fern fronds, pollen and light shafts |
| New rewards | `src/render/living.ts` | Founder glow, order acknowledgment, destination marker, mushroom clusters and spores |
| New audio | `src/audio/soundscape.ts` | Gesture-enabled ambient synthesis, bond harmonics and action chimes |
| Interface | `index.html`, `src/styles.css`, `src/ui/sheet.ts` | Field notes, life-cycle guidance, root labels, resources and controls |
| Validation | `tools/test-sim.mjs`, `tools/shoot.mjs` | Headless simulation assertions and browser screenshots |

Stack: Vite, TypeScript, Three.js. Static client application. No server is required for the current game. Simulation code should remain independent of Three.js and the DOM. The world currently measures 136 × 112 cells; the player competes with one saprotroph colony.

## What this pass implemented

### Gameplay and interaction

- The opening waits for **Awaken the spore**, rather than spending the player's starting resources while they read.
- Up to four nearby trees receive clickable root labels. Clicking a distant label issues a growth directive; clicking again within range attempts a bond.
- A four-part guide explains Reach → Bond → Gather → Fruit from the current simulation state.
- **Rest & gather** stops new tip extension while extraction and trade continue. Currently 55% of photosynthetic income can be reserved when the bonded tree received more than 65% of both required resources.
- Paid cords have a persistent `reinforced` flag and increased transport throughput.
- Growth commands reject invalid or impassable positions and retarget tips immediately. A new destination replaces the existing destination.
- Fruit must originate within the upper 12 cm and near a connected node. The existing goal is two blooms, each producing 240 spores.
- Keyboard controls now include Space to pause, R to rest, H to hide notes, F to reframe, and 1–4 for orders. Existing drag, scroll, and shift-drag remain.
- Visibility changes suspend simulation rendering and audio. Pointer cancellation no longer submits an accidental order.

### Economy corrections

- Harvesting no longer clamps a large founding reserve down to a tiny node capacity.
- Starting reserves no longer immediately become a fully funded fruiting surplus.
- Water and nitrogen transport now identify routes to bonded trees, prioritizing those routes rather than filling every exploratory branch first.
- Supplied nodes can recover health.
- Several commands now reject actions after match completion.

### Presentation

- Replaced visible canopy blobs with fine instanced foliage and tapered branches; the old foliage mesh remains allocated but hidden.
- Added moss, ferns, slow leaf motion, pollen and soft canopy light shafts.
- Improved root-tip visibility and the founding spore's presence.
- Added a continuous, procedurally textured sediment layer beneath the soil particles.
- Added actual modeled mushroom clusters, eruption scaling, and released-spore particles.
- Added an optional Web Audio ambient score and event chimes; no external audio service is required.
- Reorganized the right margin around a field journal and smaller resource record. Added a notes-hidden viewing mode and reduced-motion handling for the new decorative animations.

No Blender or generated bitmap assets were produced in this pass.

## Priority 0 — prove and repair the core loop

### 1. Complete the full-match regression

Run `npm test`. The shorter test passed: the founding reserve survived, the first tree was reached and bonded, resting halted extension, a reinforced cord stayed reinforced, and after about 114 simulated seconds the tree had full water/mineral satisfaction, full health, and 190 reproductive energy.

The suite was then extended to grow back toward the surface and complete two blooms through the public order methods. **The extended run failed at `tools/test-sim.mjs:62`, on “a sustainable network can fund its second bloom.”** Growing to the surface, initiating the first fruit and completing that first bloom passed. The second `orderFruit()` returned `ok: false`; the assertion currently omits its returned message, so the cause has not yet been isolated. The full journey is not certified. The run is computationally expensive; a partial success log is not a passing test.

First, include the rejected command's `message` and a compact state snapshot in the assertion output. Inspect topology, resource flow, tree patience, season, living tips, surplus and the original fruit site's connectivity. Do not resolve a failure by giving the test free carbon or assigning the outcome. Test weather-paused fruiting separately from the normal victory path; the second-bloom test may need to wait for an eligible season before issuing the order. Distinguish a test scheduling mistake from an economy or supply defect before changing balance.

Acceptance: multiple fixed seeds can achieve both blooms without assigning resources or bypassing orders; extinction and post-outcome rejection also remain correct.

### 2. Audit conservation and supply connectivity

`spawnTip()` currently creates a new tip with carbon, water and nitrogen values rather than visibly transferring those resources from its parent. This is an existing economic integrity risk: the new resting policy should not be balanced on growth manufacturing resources.

Implement explicit resource transfers or a documented biomass allocation budget at birth. Preserve a legitimate founding reserve. Add a small conservation test around branching, transport and decay: transfers conserve quantities; harvesting introduces accounted income; construction, upkeep and decay consume accounted quantities.

Check `markConnectivity()`, `killNode()`, `harvest()` and tree trade together. In particular, a dead founding node must not keep a severed colony connected, and disconnected bonded nodes must not continue generating trade income. Add a cut-supply test where a tree has a node nearby but no living path to the founder.

### 3. Make fruiting depend on a living investment

`progressFruiting()` currently gates progress on weather, but does not explicitly verify continued supply to the fruit's originating location. Decide and implement the intended rule: a supplied mushroom progresses; a severed or starving mushroom pauses or slowly recedes with clear feedback.

Do not silently keep collecting a full second reserve during an active bloom and then erase it at completion. Decide whether energy is paid at initiation, reserved during growth, or consumed progressively; display the same rule in the UI.

Persist completed bloom locations in simulation state. `LivingView` currently infers mushroom history from a count and the latest fruit position; warming or eventually loading a game can place historical blooms incorrectly. Store actual completed blooms, then render them.

## Priority 1 — make decisions satisfying and readable

### 4. Turn guidance into one coherent gameplay model

Extract a small pure `deriveJourney(sim)` function that returns the current objective, explanation, available actions and blocker. Use it for the journal and action affordances. Avoid multiple expensive and slightly different proximity checks in separate UI/render methods.

Ensure that first-time players can answer: Where am I? What can I do now? Why was this action refused? What changed because of it?

Add intent feedback for an ordered root, a visible connected surface site for fruiting, and clear differences between “near,” “affordable,” “bonded,” and “already finished.” Current “ready” root labels are based on distance, while bonding also needs local carbon and a usable junction. A tree's chosen label target can also differ from the candidate selected by the nearest-tip order method; bind targets to explicit tree/root identifiers.

The independent finishing review also found that `updateMarkers()` takes the nearest four targets without prioritizing unbonded trees. Four bonded trees can therefore occupy every available label slot. Prefer actionable unbonded targets, keep bonded context where useful, and label bonded roots explicitly in text.

Test rest/unrest, paused orders, keyboard focus and outcome recovery through actual buttons. Consider replacing distant grow-then-click-again bonding with an explicit pending bond instruction, but only if it remains clearly communicated and economically honest.

### 5. Add ecological choices with different consequences

Recommended next layer, after the loop is proven: make shallow litter, deep water and tree partnerships support different strategies. The player should choose among a short inexpensive food route, a deeper drought-resistant supply route, or another tree with different demands.

Communicate those differences using the soil and partner status, not a large technology menu. Tune the existing species requirements and seasons before introducing more species or enemies. Resting should trade expansion opportunity for reproduction; it should neither solve everything nor cause unexplained collapse.

Set and validate pacing targets rather than inheriting the original 30–60-minute ambition blindly. For a first vertical slice, a proposed target is a first bond within roughly one minute and a complete satisfying journey within 8–15 minutes, with pause always available. These are proposed targets, not measured current performance.

## Priority 2 — finish the visual and audio experience

### 6. Judge a mature network, not just the opening

Capture and inspect the opening, first bond, expanded colony, drought, first mushroom and final bloom. Check whether individual cords and resource pulses remain readable instead of merging into a bright knot. The renderer already has earlier, uncommitted hyphae fixes; preserve and understand them before changing brightness or blending.

Current evidence: `design/shots/after-opening.png` shows the new canopy and journal. It predates the final sediment backing. A later capture is required. The approved original composition is `design/comps/comp-c.png`; preserve its specimen identity without treating every old pixel as immutable.

Improve the founder-to-forest scale transition, root attachment detail and seasonal transformations. Tree geometry and foliage currently do not fully synchronize with changing maturity; dead trees mostly darken instead of visibly shedding foliage. Replace these approximations with health- and season-driven silhouettes.

### 7. Use Blender selectively

Good candidates are two or three hero mushroom species, a fallen log with bark, distinctive root collars and a few foreground fern forms. Use geometry where silhouette or material detail will materially improve a close-up. Do not replace the simulation's responsive network with a baked decorative asset.

Pipeline: create consistently scaled assets, apply transforms, reduce topology, atlas materials where sensible, export GLB, and load through Three.js `GLTFLoader`. Use instancing for repeated objects. Provide documented attribution for external assets. Establish download and render budgets on actual hardware before choosing texture resolution or adding model compression dependencies.

### 8. Finish the score and accessibility

Test sound enable/disable, tab suspension, restart and audio failures. Balance the ambient levels on headphones and speakers. Give bond formation and mushroom emergence distinct but restrained signatures. The present score is synthesized tones and filtered noise, not a finished musical composition.

Reduced motion currently suppresses some new decorative motion; audit all existing pulses, motes and camera movement. Verify keyboard access and focus restoration when notes are hidden. The canvas remains spatial and primarily pointer-oriented; do not claim full nonvisual accessibility without an equivalent command surface.

## Priority 3 — performance, layout and maintenance

### 9. Profile before optimizing

Measure simulation time, render time, draw calls and memory at opening, 1,000 nodes and the configured ceiling. The current root-label and journey code repeatedly scans all nodes against root tips. Cache simulation-derived reachability on a slower beat or topology change and project cached targets every frame. Reuse scratch objects and avoid rebuilding transient sets/arrays in hot paths where profiling justifies it.

The new forest creates many leaves, while the old hidden canopy allocation remains. Remove redundant render structures after equivalence checks. Add quality settings or adaptive pixel ratio if measured hardware requires them; do not assume software-WebGL screenshot throughput is representative of a gaming GPU.

### 10. Verify viewport layouts and reconcile documentation

Inspect at least 1600×1000, 1366×768 and 390×844. The compact layout was implemented but not visually verified. Look for label collisions, journal overlap, cropped canopy and loss of essential resource feedback; the compact layout currently hides the resource record. Root-label positioning needs collision handling and safe areas.

The desktop reference still shows overlapping depth-ruler/order territory and a tree crown behind the archive stamp. Improve spacing or camera framing rather than adding opaque HUD panels.

`DESIGN.md` still describes an older, more restrictive composition and type scale; the new journal uses a 24px heading and root overlays. Reconcile the durable design record with the chosen final behavior. Update README controls, surplus semantics and verification commands. Remove stale comments, unused fields and obsolete tuning values only after checking their callers.

The independent review flagged stale product evidence too: `PRODUCT.md` still states that no code or screenshots exist. Correct that factual record. Its visual review identified additional material opportunities—fibrous mounting paper, irregular soil relief, deeper leaf litter and worn translucent tape—while confirming that the transect, restrained typography and Reach → Bond interaction should be preserved.

Defer multiplayer, backend saves, a large evolution tree and additional threat systems until this slice is complete. A local save/resume feature would later support the meditative session model, but needs versioned deterministic state, including RNG and bloom history.

## Verification and environment notes

- `npm run typecheck` passed after the new rendering, audio, UI and controls were added.
- `npm run build` passed after the sediment layer and updated resource routing. Nonfatal bundle-size and environment/toolchain warnings remain.
- The initial headless regression passed, including deterministic identical-seed runs and the sustained first-bond scenario. The expanded regression subsequently failed when issuing the second fruit order. **The current `npm test` command therefore fails.** See Priority 0 for the precise failure and next diagnostic step.
- A 1600×1000 screenshot was inspected. A previous continuous-render screenshot timed out under software WebGL. `--freeze` was added to `tools/shoot.mjs` to stop the frame loop before capturing.
- A later capture saved images but its final status query was interrupted by Vite hot reload. Use a built preview server for stable screenshot sessions.
- The in-app browser could not initialize in this session because the tool reported a missing sandbox-policy field. The existing project Playwright harness was used as the fallback; this is not an application error.
- The new test runner uses Node's experimental `stripTypeScriptTypes`; it was run with Node 22.19.0. It writes isolated temporary compiled modules. The installed TypeScript package did not expose the older `transpileModule` interface as expected, so the runner does not depend on it.
- Development was running at `http://127.0.0.1:5174/`; the pre-existing port 5173 was already occupied. A built preview was started at `http://127.0.0.1:4173/`. Check processes rather than assuming these remain running.
- At the beginning of this pass, `src/game.ts`, `src/render/hyphae.ts` and `tools/shoot.mjs` already had local modifications. Do not revert them wholesale.
- Screenshots under `design/shots/` are gitignored. No deployment, external publication or commit was performed.

Useful commands:

```powershell
npm run build
npm test
npm run preview -- --host 127.0.0.1
node tools/shoot.mjs --url http://127.0.0.1:4173 --out design/shots/review.png --canvas-out design/shots/review-canvas.png --at 1500 --freeze
```

## Definition of done for the next milestone

1. A new player can complete a full two-bloom journey through the UI, with no developer-only resource assignment or unexplained waiting.
2. Multiple deterministic seeds pass end-to-end victory tests; loss, disconnection, invalid commands and seasonal fruiting are covered.
3. Growth, supply, reproduction and decay obey explicit resource accounting.
4. The expanded network, living forest and mushrooms are visually compelling at both strategic and close views.
5. Controls, audio, pause, notes visibility and supported viewport layouts have been exercised in a browser.
6. Performance is measured on stated hardware and any limitations are documented.
7. The final README and design record describe the implementation accurately, with screenshots and reproducible test commands.

Deliver the completed vertical slice with concise evidence. Prefer fewer finished mechanics that create an absorbing living system over a larger list of systems that merely exist in code.
