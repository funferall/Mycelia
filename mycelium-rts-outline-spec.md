# MYCELIA — Game Outline Spec

> **Document role:** This is the original product and game-design specification,
> not a current implementation plan. Use `PROJECT_STATUS.md` for authoritative
> feature status, priorities, limitations, verification, and next work.

> **Working titles:** *Mycelia* / *The Wood Wide Web* / *Fruiting Season*
> **Genre:** Real-time strategy (RTS) with ecological simulation
> **Reference points:** Civilization (growth & escalation), Creeper World (fluid network expansion), Northgard (territory + seasons), Osmos (organic aesthetics)
> **Target platform:** Web browser (desktop first), hosted on Cloudflare
> **Session length:** 30–60 minutes per match

---

## 1. High Concept

You are a fungal intelligence awakening in a single spore beneath a forest floor. Expand your mycelial network through living soil, form symbioses with tree roots, trade nutrients, defend against parasites and rival fungi, and shepherd the forest itself — because the forest is your farm, your ally, and your scoreboard. When your network is rich enough, you **fruit**: erupting mushrooms release spores that carry your lineage to new lands.

**The fantasy:** not conquest, but *cultivation under pressure*. You win by making things grow — while everything around you competes, decays, and dies.

**The stakes:** an ecological sim where the forest is a living system. Overexploit your trees and they weaken; ignore a parasite and it hollows out your host; let a rival fungus reach the old oak first and you've lost its carbon forever.

---

## 2. Core Gameplay Loop

```
EXPAND hyphae through soil (costs nutrients)
   → CONNECT to tree root nodes (mycorrhizal symbiosis)
      → TRADE: trees give carbon (sugar), you give water/minerals
         → FOREST GROWS: healthy trees spawn new roots, new territory
            → ACCUMULATE surplus nutrients
               → FRUIT: spend surplus to produce fruiting bodies
                  → SPREAD: spores colonize new map regions (victory progress)
```

Every loop is contested: rival networks, parasites, and environmental events pressure each stage.

---

## 3. Objectives & Obstacles

### 3.1 Objectives

**Immediate (every minute of play)**
- Grow hyphae toward nutrient sources before rivals reach them.
- Reach tree root tips and establish mycorrhizal bonds — the first bond is the "found your first city" moment.
- Keep every connected colony supplied: water and minerals flow out to trees, carbon flows back.
- Repair or reroute around severed strands — a cut-off colony starves in real time.

**Mid-game (the strategic layer)**
- Build a diversified tree portfolio: multiple species, multiple regions, so no single event can collapse carbon income.
- Convert surplus into investments — cords, defenses, evolution unlocks — because fungi can't hoard; idle carbon is wasted carbon.
- Secure soil territory: control the litter layer (decomposition income), the water table (drought insurance), and corridors between regions.
- Climb one evolution branch to define a playstyle: farmer (symbiosis), plague (pathogen), or engineer (architecture).

**Win conditions (selected per match / biome)**
- **Dominion** — fruit successfully X times and get spores colonizing Y% of the map.
- **Symbiosis** — keep N elder trees alive to the end (the eco-pacifist run; hardest, most beautiful).
- **Extinction** — digest every rival network.

**Meta (across matches)**
- Spores carry genetic upgrades into the next map — each fruiting literally seeds the next campaign.

### 3.2 Obstacles

**Rival fungi (the opponents)**
- **Honey fungus** — kills trees to eat them; its black rhizomorphs chew through cords. It doesn't play the symbiosis game at all, which makes it terrifying for farmer builds.
- **Saprotrophs** — passive but explosive; every die-off (the player's included) triggers their feeding frenzy. They punish losses.
- **Truffles** — invisible, entrenched, nutrient-rich; occupying needed space and nearly impossible to evict.
- **Mycorrhizal rivals** — the player's mirror: they court the same root tips. Pure race-and-deny competition.

**Parasites & disease (the pressure valve)**
- Root rot and nematodes spread along roots *and* the player's own network — highways are also infection vectors.
- Mycovirus waves specifically punish over-dense networks, so turtling is a losing strategy.

**The environment (the real boss)**
- **Seasons** force rhythm: spring boom, summer drought (water crisis), autumn feast, winter planning.
- **Drought** drops the water table — colonies in sandy soil die first.
- **Wildfire** wipes the canopy — tree income gone in minutes — then reshuffles the whole board (post-fire soil is a land rush).
- **Logging** — late-game catastrophe in some biomes: trees removed, soil compacted, decades of cultivation gone.

**The player's own biology (the subtle ones)**
- Trade obligations: bonded trees *demand* water and minerals; fail them and they sever the bond — the economy can strike.
- Universal decay: anything unconnected dies back, and dead matter feeds enemies.
- Limited storage: surplus must be spent or lost, forcing constant action rather than safe accumulation.

**The stakes engine, in one sentence:** everything the player builds is food for something else, and the forest they're farming can die.

---

## 4. The World

### 4.1 The Map — A Vertical Slice of Forest

- **Two-layer view, one battlefield:**
  - **Below ground (primary view, ~80% of play):** a cross-section of soil — dark, layered, beautiful. Hyphal networks glow against loam, clay, stone, and water tables.
  - **Above ground (contextual view):** the forest canopy and trunks. Shows tree health, fruiting bodies, weather, fire, logging. Toggle or split-view.
- **Soil is terrain:** different soil strata have different properties —
  - *Topsoil/leaf litter:* rich in decomposable matter, crowded with competitors.
  - *Loam:* easy growth, moderate nutrients.
  - *Clay:* slow hyphal expansion, holds water.
  - *Sand:* fast expansion, drains water, poor nutrients.
  - *Bedrock:* impassable except via specialized hyphae.
  - *Water table:* critical resource zone; drought lowers it.
- **Map generation:** procedural, seed-based. Each map is a biome (temperate, boreal, tropical, post-fire, clear-cut recovering, ancient old-growth) with distinct tree species, soil profiles, and event decks.

### 4.2 Trees — The Other Half of the Game

Trees are **autonomous agents**, not passive resource nodes:

- Each tree has health, age, species, and a root system occupying soil volume.
- **Mycorrhizal symbiosis:** connect hyphae to a root tip → form a bond. The tree feeds you **carbon** (photosynthate); you must supply **water and minerals** in return. Neglect the trade and the tree severs the bond.
- **Species matter:** oaks are carbon-rich but demanding; birches grow fast and are forgiving; pines tolerate poor soil; ancient elders are nutrient goldmines but targeted by everything.
- **Trees communicate:** bonded trees share your network's defense signals — warn a tree of root rot and it mounts chemical defenses.
- **Forest growth:** healthy, well-supplied trees seed new saplings nearby → new root nodes → new expansion targets. You are literally growing your own economy.

---

## 5. Resources

| Resource | Source | Uses |
|---|---|---|
| **Carbon (sugar)** | Tree symbiosis | Hyphal growth, fruiting, most construction |
| **Nitrogen & Phosphorus** | Decomposing litter, dead matter, mineral weathering | Enzymes, reproduction, tree trade obligations |
| **Water** | Water table, rainfall, soil moisture | Keeps network alive; trade currency with trees |
| **Genetic Potential** | Absorbing rival/parasite biomass, rare soil pockets | Evolution tree unlocks (the "tech" currency) |

**Design pillars for the economy:**
- Resources are **spatial** — they exist at nodes and must flow through your connected network. A severed colony starves.
- **Storage is limited** — fungi don't hoard; they *invest*. Excess carbon must become growth, defense, or fruiting. (This drives constant decision-making, Civ-style.)
- **Decay is universal** — unconnected hyphae die back; dead matter becomes someone else's food.

---

## 6. Player Mechanics

### 6.1 Network Building (the "units")

There are no discrete units — **your network is your army, economy, and body at once.**

- **Hyphal tips:** direct growth by placing waypoints; tips grow in real time, consuming carbon per unit length. Tips sense nutrient gradients (visible as subtle glow) — players read the soil.
- **Hyphal cords (rhizomorphs):** thicken existing strands into fast-transport highways. Expensive, vital for long-distance supply.
- **Cordons & walls:** defensive structures — melanized barriers that slow parasites.
- **Decomposer blooms:** deploy onto dead matter (fallen logs, carcasses, dead roots) for a nutrient burst.
- **Enzyme fields:** area-of-effect zones that pre-digest soil or poison rivals.
- **Fruiting bodies:** the mega-project. A fruiting site consumes a huge nutrient surplus over time, then erupts above ground.

### 6.2 Evolution Tree (the "tech tree")

Spend Genetic Potential across three branches:

- **Pathogenic** — offensive enzymes, cordon penetration, parasitic tendrils (turn a rival's tree bond against them).
- **Symbiotic** — better trade rates, multi-tree bonding, defense signaling, drought resistance shared with trees.
- **Architectural** — faster cords, deeper growth, spore range, fruiting efficiency, stone-dissolving hyphae.

Mutually exclusive choices per match force distinct playstyles: *the farmer, the plague, the engineer.*

### 6.3 Fruiting & Victory

- **Fruiting** requires: a nutrient surplus threshold + a safe above-ground moment (not during drought/fire) + time.
- A successful fruiting releases a **spore cloud** — wind direction matters. Spores that land in uncolonized regions become **new colonies** (in-match expansion) or count toward **victory**.
- **Victory conditions (match):**
  - *Dominion:* fruit X times / colonize Y% of the map.
  - *Symbiosis:* keep N elder trees alive to match end (eco-pacifist victory).
  - *Extinction:* eliminate all rival networks.
- **Loss condition:** your last living hypha dies.

---

## 7. Opponents & Threats

### 7.1 Rival Fungi (the "civilizations")

AI-controlled (or player-controlled) networks with personalities:

- **Honey Fungus (Armillaria)** — aggressive parasite; kills trees to eat them. Spreads via black rhizomorphs. A blight on the forest — but it clears old trees, making room.
- **Saprotroph colonies** — passive but voracious; compete for dead matter; explode in growth after any die-off (including yours).
- **Truffle networks** — defensive, invisible, rich; hard to find, harder to dig out.
- **Mycorrhizal rivals** — your direct mirror: they court the same trees. Diplomacy-free competition for root tips.

### 7.2 Parasites & Pathogens (the "barbarians")

- **Root rot, rusts, nematodes** — spreading infections that hit trees and hyphae.
- **Mycovirus events** — debuff waves that punish over-dense networks (anti-turtling mechanic).

### 7.3 Environmental Events (the "world is alive")

- **Seasons:** spring flush (nutrient boom), summer drought (water crisis), autumn litterfall (decomposer feast), winter dormancy (slow growth, plan time).
- **Drought, frost, flood** — regional hazards.
- **Wildfire** — catastrophic above ground; resets canopy but creates post-fire opportunity (charcoal-loving fungi bloom).
- **Logging / human encroachment** — late-game event in some biomes: trees removed, soil compacted. High stakes, high drama.

---

## 8. Real-Time Structure (RTS specifics)

- **Continuous time** with pause + 1×/2×/4× speed (single-player).
- **No micromanagement of units** — orders are *growth directives* and *zone policies* (e.g., "prioritize water transport to this sector"). APM-friendly for all skill levels.
- **Fog of war = soil opacity:** you sense nutrient gradients and vibrations near your network; rival hyphae are only visible at contact range or via enzyme probes.
- **Camera:** smooth zoom from full-map strategic view down to individual hyphal strands (this zoom is the "wow" moment — see Art Direction).
- **Match pacing targets:** opening (0–5 min) first tree bond; mid (5–25 min) territorial/ecological struggle; late (25+ min) fruiting race under maximum environmental pressure.

---

## 9. Art Direction & Audio

**Goal: "documentary beautiful" — like a BBC nature film you can play.**

- **Below ground:** near-black soil with glowing, bioluminescent networks — each species a distinct color and growth texture (yours: warm gold/amber filaments; honey fungus: sickly pale cords; truffles: deep violet). Nutrient flows visible as drifting motes of light through cords.
- **Above ground:** painterly, seasonal forest. God rays, drifting spores, rain. Fruiting bodies erupt in a slow, gorgeous bloom.
- **Zoom transition:** seamless scale from map to hypha — particle density and shader detail ramp continuously.
- **UI:** organic, minimal — growth rings as progress indicators, woodgrain panels, no hard chrome.
- **Audio:** low ambient drone + cello; network activity as soft clicks and pulses (sonified nutrient flow); events announced by forest sound (woodpeckers = healthy forest; silence = something's wrong).

**Technical note:** the art direction is *shader-driven*, not asset-heavy — procedural hyphal growth, particle flows, and lighting do the work. This is what makes a web build feasible.

---

## 10. Technical Architecture (Cloudflare, ~$5/mo budget)

### 10.1 Constraints & Fit

Your $5 Workers Paid plan is a good fit **if the game is client-heavy and server-light**. Cloudflare gives you:

| Component | Cloudflare service | Cost note |
|---|---|---|
| Static game client (JS/WASM/WebGL) | **Cloudflare Pages** | Free, unlimited static bandwidth |
| Game logic | **Client-side** (TypeScript + Canvas/WebGL) | Free — runs in the player's browser |
| Save games / profiles | **Workers KV** or **D1** | Free tier covers light use |
| Multiplayer (later phase) | **Durable Objects + WebSockets** | Available on the $5 plan, usage-billed — keep rooms small (2–4 players) |
| Asset CDN (audio, textures) | **R2** | Pennies at this scale |

**Key architectural decision:** the simulation runs **entirely in the browser** (deterministic sim, grid/voronoi soil model, ~50k agents max). The server is only a lobby/relay. This keeps you comfortably inside $5/mo.

### 10.2 Recommended Stack

- **Engine:** TypeScript + **PixiJS** (2D WebGL, ideal for glowing 2D networks) or **Three.js** if you want true 3D soil cross-sections. Avoid Unity/Godot exports for web-first iteration speed.
- **Sim core:** fixed-timestep deterministic simulation decoupled from render (standard RTS pattern; enables replays and future lockstep multiplayer).
- **Build:** Vite → static bundle → Pages. Wrangler CLI for Workers/KV.
- **Phase 1 is single-player vs AI** — zero server cost, shippable, and the game stands alone.

### 10.3 Cost Reality Check

- Pages hosting + KV + light D1: **effectively $0–5/mo** at indie scale.
- Durable Objects multiplayer is the only real cost risk — cap room count, hibernate idle objects, and you'll stay near the base plan.

---

## 11. Scope & Roadmap

### Phase 0 — Prototype (4–6 weeks)
- One biome, one tree species, one rival (saprotroph).
- Hyphal growth, tree bonding, carbon/water economy, one fruiting victory.
- **Goal:** prove the core loop is fun and the glow-soil aesthetic lands.

### Phase 1 — Vertical Slice (2–3 months)
- Seasons, 3 tree species, honey fungus AI, evolution tree (one branch), full art pass on one biome.
- Cloudflare Pages deploy, save/load via KV.

### Phase 2 — Full Game (ongoing)
- 4+ biomes, full evolution tree, event deck, 3 victory conditions, campaign of linked maps (spores carry upgrades between matches — the meta-loop).
- 1v1 multiplayer via Durable Objects (optional, budget-permitting).

### Explicitly out of scope (v1)
- Mobile, above-ground micro, more than 4 players, user-generated maps.

---

## 12. Open Design Questions

1. **Direct control vs. influence:** do players steer individual hyphal tips (more RTS) or set policies and watch growth (more god-game)? Prototype should test both.
2. **Tree agency depth:** how much do trees act on their own? (Full autonomy is more ecological and more beautiful; partial control is more strategic.)
3. **Multiplayer timing:** lockstep vs. server-authoritative — decide before Phase 2, not during.
4. **Failure drama:** when a network dies, does it become decomposer food for everyone else? (Recommend yes — death feeds the forest.)
5. **Monetization (if any):** recommend premium one-time purchase or free with cosmetic spore-trail skins; hosting costs are low enough that ads/IAP aren't needed.
