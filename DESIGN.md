---
name: Mycelia
description: A living forest with a quiet ring-based interface and branching adaptations.
colors:
  sheet-ground: "#171209"
  mount-shadow: "#0d0a05"
  pinned-paper: "#f1e2c5"
  label-ink: "#d0bea0"
  hyphal-amber: "#ffb347"
  ember-glow: "#ff8a1e"
  saprotroph-pallor: "#c9e6b4"
  accession-violet: "#7d6ba0"
typography:
  outcome:
    fontFamily: "EB Garamond, Georgia, serif"
    fontSize: "20px"
    fontWeight: 400
    letterSpacing: "0.16em"
  specimen-line:
    fontFamily: "EB Garamond, Georgia, serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "0.2em"
  order:
    fontFamily: "EB Garamond, Georgia, serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.4
  annotation:
    fontFamily: "EB Garamond, Georgia, serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.5
  field-value:
    fontFamily: "Courier Prime, Courier New, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  horizon-letter:
    fontFamily: "Courier Prime, Courier New, monospace"
    fontSize: "11px"
    fontWeight: 400
    letterSpacing: "0.2em"
  field-label:
    fontFamily: "Courier Prime, Courier New, monospace"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.14em"
  ruler-numeral:
    fontFamily: "Courier Prime, Courier New, monospace"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.4
  micro:
    fontFamily: "Courier Prime, Courier New, monospace"
    fontSize: "9px"
    fontWeight: 400
    letterSpacing: "0.14em"
rounded:
  none: "0"
  # The one permitted curve: the poured surface of the spore heap.
  heap: "14px"
spacing:
  unit: "8px"
components:
  order-row:
    backgroundColor: "transparent"
    textColor: "#cbbfa4"
    rounded: "{rounded.none}"
    padding: "7px 2px"
  order-row-active:
    textColor: "{colors.hyphal-amber}"
  speed-toggle:
    backgroundColor: "transparent"
    textColor: "{colors.label-ink}"
    rounded: "{rounded.none}"
    padding: "5px 10px"
  speed-toggle-active:
    backgroundColor: "{colors.label-ink}"
    textColor: "{colors.mount-shadow}"
---

# Design System: Mycelia

## Overview

**Creative direction: Forest dusk.** The supplied forest-and-concentric-rings
reference replaces the archival catalogue interface. The live forest and its
underground network fill the viewport. A dark brown, softly receding right-hand
panel holds the colony name, season, three complete resource rings, and Grow,
Share, Rest. The rings use amber carbon, slate water and sage nitrogen.

Ring brightness expresses connected reserves relative to one centimetre of
growth per active tip: scarce below one such growth budget, steady below five,
abundant above that. Rings never fill toward an invented global capacity.
Hover or keyboard focus reveals the amount and qualitative state. These are
reserves, not income rates or a promise that every strand is supplied.

The tech tree is an intentionally focused native dialog: three compatible
branches, two adaptations each, with visible connecting stems, prerequisites,
effects and learned/available states. Each branch culminates in a late-game
power. Powers appear beside ordinary orders only once earned. Their conditions,
activity and recovery remain explicit. The dialog contains keyboard focus;
world shortcuts do not fire while it is open.

Detailed readings, network shaping, forest exploration and pacing live in
native disclosures. Guidance opens initially; the numerical catalogue, barcode,
packet and ruler no longer dominate the screen. The live renderer is retained;
the reference is UI direction, not a replacement screenshot of the battlefield.

## Colors

The HUD uses brown-black #171209, edge ground #100c06 and warm ivory #f1e2c5.
Body ink is #d0bea0, secondary ink #b4a387. Amber #e49a38 marks the active
order and earned powers. Resource rings use carbon #de8b2c, water #78969a,
nitrogen #9cab7d; their labels and hover/focus descriptions explain every state.

World lighting remains simulation-owned: player filaments use warm amber and
ember falloff; rival filaments use saprotroph pallor #c9e6b4 and distinct texture.
Truffles may retain violet. HUD resource colours do not change species identity.

Soil material colours are a separate, darker register, read as albedo and then
lit: litter #4a3620, humus #3a2814, loam #2f2317, clay #332a23, sand #3c3220,
stone #37332c, bedrock #22201b. Each is multiplied by moisture, organic content
and depth falloff, and never allowed below 60% of its base value — a true black
rectangle reads as a hole in the sheet rather than as deep soil.

Water is the one cool, near-glossy material in the sheet, and it is drawn as a
material rather than as a symbol. Above ground the stream is a darker wet bank
(#2b2a1f) under a low-roughness ribbon (#2c4148) that catches the raking light
along the generator's own course. Below ground the same water is a cross-section:
the open channel reads as water (#2f5560) beneath the water line and as a
shadowed notch (#12181a) above it, the ground below the table takes a saturated
cast (#25373d), and the table itself is one low-opacity rule (#3d5a66) across the
specimen. Water never glows, never uses amber or pallor, and never appears as a
flat blue fill.

## Typography

EB Garamond with Georgia fallback is the interface face. The colony title is
32px; primary actions 23px; disclosure labels 16px; explanatory text 14–17px.
The tech-tree title is 38px and adaptation names 21px. Courier Prime remains
only for tabular measurements in expanded readings. Main text uses warm ivory
#f1e2c5, body #d0bea0, secondary #b4a387 on brown-black #171209 / #100c06.
Resource colours are #de8b2c carbon, #78969a water, #9cab7d nitrogen. Names and
focusable text accompany all colour states.

## Layout

At desktop widths the edge panel is 370px wide and scrolls independently.
The view switch is centred over the remaining world. Rings are at most 280px
wide, reduced to 200px on short desktop windows. Grow, Share and Rest form one
horizontal row; Cord and Fruit remain available under Shape the network.
Below 760px the panel occupies the bottom 52% of the viewport, the ring emblem
shrinks to 120px, and the tech-tree branches stack vertically. Controls keep
visible focus outlines; details can be opened without a pointer.

## Motion

Motion belongs to the specimen, and the one piece of motion the interface owns
is the crossing between the two views.

- **The crossing is timed by the clock.** A full forest ↔ underground crossing
  takes a second and a half of wall-clock time at any frame rate. A machine
  drawing a quarter of the frames sees the same rise in the same second and a
  half, drawn more coarsely; it never stretches because the renderer is slow.
- **It eases, and it can turn around.** The crossing eases in and out, and
  changing views part way through reverses the picture in the time the
  remaining part would have taken — never less than about a third of a second,
  so a double tap reads as a correction rather than a flicker.
- **Nothing in the soil is switched off.** The networks, motes, roots and
  living rewards dissolve from their own brightness as the forest floor closes
  over them, and return the same way. A display underground is at full
  strength; a display that has gone is not drawn at all.
- **Framing follows the viewport until the player takes the camera.** A window
  that changes shape re-derives the default framing of the active view.
  Panning, zooming, tilting, or following a particular tree pins that view, and
  a later resize leaves the player's own pose alone.
- **Reduced motion snaps.** Under `prefers-reduced-motion: reduce` the new view
  appears in the frame it was asked for, with no crossing at all.

## Elevation & Depth

World depth comes from real forest geometry and the soil's darkness. The HUD
recedes into a brown-black edge gradient. The research dialog uses a dark
backdrop to protect focus. Resource tooltips are small opaque reading surfaces.
No ornamental glass or neon outlines. The reference's circles are intentional:
complete rings and tiny research buds are the interface's recurring geometry.

## Authored 3D assets

The visual system is hybrid by construction. The underground stays procedural:
hyphae, cords, flow motes and soil strata are shaders and generated geometry,
and no authored mesh should replace them. The surface accepts authored models
for the things a player knows by silhouette — trees, deadwood, fruiting bodies,
ground props — and `src/render/assets.ts` is the only door they come through.
Anything without a file keeps being drawn the way it is drawn now, so art can
arrive one model at a time. The botanical low-poly pack is built by
`tools/make-forest-assets.py`; `public/assets/forest-manifest.json` lists each
asset, tier, triangle budget, byte size and crown anchor. The older
`tools/make-placeholder-assets.py` remains a prototype generator and overwrites
the six original paths if run.

Seasons use **procedural foliage tint**, with density controlled by the renderer
when supported, rather than four separately authored seasonal meshes. Living
and dead/hollow trees are distinct models. Underground soil, roots, hyphae,
cords and flow stay procedural; small authored reproductive bodies may sit
within that environment without replacing it.

### The fruiting body in both views

An eruption is one event seen twice, wearing the same three models, so a player
who descends through the ground is looking at the mushroom they just watched
break the litter:

| Stage | Model | What it is |
|---|---|---|
| Primordium, the first 42 % of an eruption | `fungi/porcini-button.glb` | the brown button on a stout pale stem |
| Opening cap | `fungi/porcini-opening.glb` | the convex cap expanding above the litter |
| Finished bloom | `fungi/porcini-mature.glb` | the broad mature cap with a pale pore-bearing underside |

These original, texture-free models draw on real *Boletus edulis* (porcini),
an ectomycorrhizal bolete. They establish the player's visual identity without
adding a faction or species-specific simulation rules. The underside is a
continuous sponge surface rather than gills; fine pores are omitted at this
scale. `tools/make-mushroom-assets.py` builds all three stages plus comparison
specimens of *Cantharellus cibarius* (wavy funnel, descending forked folds) and
*Laccaria amethystina* (slender violet stem, widely spaced gills). The two
comparison species are registered but not placed in ordinary play. Source-photo
URLs are recorded per specimen in `forest-manifest.json`; photographs are not
shipped as textures. Each specimen stays under 500 triangles and three materials.

The two views draw the same stage at their own scale: about 6 cm on the soil
transect, and about a metre on the forest floor, which is a small thing beside
an 8–10 m tree rather than a landmark. Above ground a body is placed only where
the simulation recorded a site, and it is left out rather than guessed at when
a transect was never bound to regional soil.

`fungi/underground-fruiting-body.glb` — a truffle-type subterranean body — is
deliberately unplaced. In this game's language the truffle is a separate
organism (deep violet, `Accession Violet`), not a stage of the player's amber
loop, so it waits for that species rather than being miscast.

### The contract a model must meet

- **glTF 2.0 binary** (`.glb`), exported Y-up. Blender's default export is
  already correct.
- **Metres.** A model is scaled to the simulation's own tree height when it is
  placed, so absolute size is a starting point rather than a promise.
  Proportion is what carries over.
- **Origin at ground contact** — the base of the trunk, or the underside of a
  prop. The game puts the model on terrain by that point and adds the ground
  height to it.
- **Foliage materials carry `leaf`, `needle` or `foliage` in their name.** Those
  take the season's colour. Every other material keeps the artist's colour and
  only browns as the tree's health falls.
- **An empty named `anchor_crown`** marks the point the game selects, frames the
  camera on and hangs airborne effects from. Without one, the game falls back to
  a fraction of the model's own height.
- **No baked lighting.** The stage supplies light, and the same model has to
  read at noon, in rain and in winter.
- **One mesh object per asset**, with at most three material primitives. Tree
  and sapling budgets are 2,000 / 900 / 320 **exported triangles** at LOD0 / 1 / 2;
  other props stay below 500. The botanical pack uses faceted wood and folded,
  opaque, double-sided foliage blades. No alpha textures or baked lighting are
  needed; runtime batches wood and foliage by asset, tier, geometry and material.
- **Separate GLBs for LODs.** `trees/oak.glb` is LOD0, with `oak-lod1.glb` and
  `oak-lod2.glb` beside it; `oak-dead.glb` and its tiers form the dead/hollow
  variant. The same naming applies to birch, hemlock and saplings. A GLB contains
  exactly one tier, so the existing loader cannot accidentally draw all three.
  Tiers retain the same ground plane, height and `anchor_crown`. When switching
  living/dead variants, preserve the living model's scale rather than scaling
  the dead tree's remaining branches up to the former leafy height.

The manifest is art metadata, not a scene graph: the loader reads it for an
asset's tiers and the renderer selects a tier from a tree's projected size on
screen. Living authored wood and foliage share regional instance batches.
Stable stand:tree identities survive batch changes; each tree retains its own
transform, seasonal tint, health and sway. Dead-variant switching, anchor
consumption and authored wind clips still require runtime support; see `PROJECT_STATUS.md` for
their status.

### What the game adds to a model

Per-instance scale, position from the simulation, sway from the shared gust,
seasonal colour on foliage, health browning, the ground-contact correction, and
the same fog and bloom pass as everything else in the scene. A model that
arrives after the stand was built is swapped in; a model that never arrives
changes nothing about how the game plays.

## Interface components

- Primary actions are unboxed serif labels with an amber underline for the
  selected order. Share issues the existing bond order; Rest toggles growth.
- Each tech branch uses a thin vertical stem with buds for the two adaptations.
  Learned, ready and locked states always have text in addition to colour.
- Detailed readings retain the complete semantic definition list.
- Native disclosure summaries, buttons and dialog controls support keyboard
  interaction. Reduced motion removes ring transitions.
- Keep actual network topology and resource flow authoritative. Preserve the
  renderer's normal blending; bloom supplies light without whitening strands.
- Use the supplied reference's restrained warm palette, not extra chrome.

## Water in the living specimen

Water uses muted teal depth, sage shallows and restrained pale reflections.
The forest brook follows the drainage course with rounded bends, soft wet
banks, occasional low stones and slow currents and eddies. It stays below the
hyphae's brightness and does not acquire an emissive outline.

Below ground, an eight-centimetre capillary fringe dissolves into darker
saturated soil. The channel uses the same depth transition and softens into
its bed; the gradient belongs to the specimen, not to interface surfaces.
The lower edge of the reachable fringe is the simulation's live water table.
Seasonal depth changes remain legible with motion disabled. Water motion follows
the existing ambient-motion control and system reduced-motion preference.
