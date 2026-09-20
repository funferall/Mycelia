---
name: Mycelia
description: An ecological real-time strategy game played on a dark herbarium specimen sheet.
colors:
  sheet-ground: "#141110"
  mount-shadow: "#0b0908"
  pinned-paper: "#e8dcc0"
  label-ink: "#cbbfa4"
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

**Scope note — connected surface forest:** Mycelia now has a dimensional
bird's-eye forest in addition to the underground mounted specimen. The forest
uses real z-depth, natural light, atmospheric motion, weather, and seasonal
colour while keeping the same restrained botanical annotations at the edges.
The flat-sheet, earned-light, and near-silhouette rules below remain binding for
the underground view. Where this document describes the entire game as flat,
read that as the underground specimen unless a later surface rule says
otherwise. `PROJECT_STATUS.md` records implementation maturity and remaining
work.

**Creative North Star: "The Mounted Specimen"**

The whole game is one sheet of dark archival mounting paper. A living forest
transect — canopy, litter, soil, clay, stone — is pressed flat onto it and pinned
down under strips of gummed tape. The player's mycelial network glows inside the
mount in warm amber; it is the only light in the world. Everything a game
normally puts on screen is instead printed onto the paper the way a herbarium
label is printed: a ruled depth ruler down the left edge with real soil-horizon
letters, an accession stamp and barcode in a corner, a folded fragment packet
holding spores, and one dense ruled catalogue block in the lower right that
carries every number in the game.

This is the refusal: no HUD panels, no floating chrome, no minimap, no resource
bar, and no glowing outline around anything. Nothing is drawn on top of the
world. The interface is paper and ink living at the edges of the mount, and the
only saturated colour anywhere is bioluminescence — light the simulation
actually produced. If a number needs to be on screen it takes its place in the
ruled block like a field in a catalogue record.

The mood is documentary rather than dramatic. The sheet is old, foxed and quiet,
lit by one raking museum light. The drama comes from watching something alive
and fragile do well or badly inside it.

**Key Characteristics:**

- A warm near-black ground; the network is the only bright thing on it.
- Every interface element is printed onto the sheet — ruled, never floated,
  never boxed.
- Depth is a real spatial axis, measured in centimetres on a printed ruler.
- Amber is the player; sickly pale green is the rival; violet is truffle and
  officialdom, and appears roughly twice per screen.
- Motion belongs to the specimen. The paper never moves.

**The Light Is Earned Rule.** Colour is never applied as decoration. Any warm
pixel on screen must correspond to living network, and any cold pixel to a
rival, a parasite, or an accession mark. A frame with no network in it is
essentially monochrome.

**The Two Violet Rule.** Violet is the rarest colour in the game: the accession
stamp and the truffle nodes, nothing else. More than two violet elements on a
screen means something has gone wrong.

## Colors

### Primary

- **Hyphal Amber** (#ffb347): the player's network — the bright centre of a cord,
  a growing tip, a bonded root junction. The only large-area warm colour.
- **Ember Glow** (#ff8a1e): the outward bloom around amber filaments and the
  colour of motes travelling along a cord. Never flat, always falloff.

### Secondary

- **Saprotroph Pallor** (#c9e6b4): the rival network. Cold, thin and sickly
  against the amber, and deliberately less luminous, so a contested frame reads
  as warmth losing to pallor.

### Tertiary

- **Accession Violet** (#7d6ba0): the rubber-stamp mark and the truffle nodes.
  Under-inked, never crisp, never glowing.

### Neutral

- **Sheet Ground** (#141110): the mounting paper, and the dominant colour of the
  game by area.
- **Mount Shadow** (#0b0908): the deepest soil in the transect, the backing
  behind the specimen, and the vignette at the sheet's edges.
- **Pinned Paper** (#e8dcc0): the gummed tape and the spore packet. In the
  render the tape sits at 14% opacity over a #8d8266 base, so it reads as
  translucent gum rather than as a white card.
- **Label Ink** (#cbbfa4): all printed text. Warm bone, never pure white, and
  never above 80% opacity for body fields.

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

**Display Font:** EB Garamond (with Georgia, serif)
**Body Font:** EB Garamond (with Georgia, serif)
**Label / Data Font:** Courier Prime (with Courier New, monospace)

**Character:** A botanical-publication roman paired with a typewriter face —
the historical pairing of an actual herbarium sheet. The printed monograph gives
the species its dignity; the typewritten label gives the collection its record.
The monospace is never atmospheric, only ever used for data a person would have
typed into a field.

### Hierarchy

- **Outcome** (400, 20px, 0.16em tracking, uppercase, EB Garamond): the result
  of a finished match, and the only thing in the game permitted above the
  specimen line. See the One Announcement Rule below.
- **Specimen Line** (400, 17px, 0.2em tracking, uppercase, EB Garamond): the
  species name heading the catalogue block. The largest type in the game, and
  there is exactly one per screen.
- **Order** (400, 15px, EB Garamond): the four acts in the orders list — Grow,
  Bond, Cord, Fruit. The largest body type, because these are the verbs.
- **Annotation** (400, 12.5px, italic, EB Garamond, 70% opacity): the map's own
  voice — notes, season remarks, event announcements. A curator's aside, never
  a system message.
- **Field Value** (400, 12px, Courier Prime, tabular numerals): the right column
  of the catalogue block, always right-aligned so it scans vertically.
- **Horizon Letter** (400, 11px, 0.2em tracking, Courier Prime, 62% opacity):
  the soil-horizon designations on the depth rail.
- **Field Label** (400, 10px, 0.14em tracking, uppercase, Courier Prime, 62%
  opacity): the left column of the catalogue block — CARBON, WATER, SUBSTRATE.
- **Ruler Numeral** (400, 10px, Courier Prime, 38% opacity): depth marks and the
  horizon letters beside them.
- **Micro** (400, 9px, Courier Prime, 0.14–0.3em tracking, 38% opacity): the
  smallest printed matter — the stamp's division line, the barcode caption, the
  section heading over the orders list, and the spore packet's label.

**The No Display Type Rule.** There is no headline face and no large type. Every
size in the game sits between 9px and 17px. Nothing shouts.

**The One Announcement Rule.** The finished-match outcome is the single
permitted exception, at 20px. It appears once, at the end, and then the sheet is
closed. Nothing else in this world is ever allowed to be louder than the
specimen line.

## Layout

The viewport is the sheet. Three regions, all printed onto the same ground, none
of them boxed:

- **Depth rail** — left, at `left: 26px; top: 206px; bottom: 96px; width: 104px`.
  A ruled scale from 0 to −112cm, a tick every 5cm, a numeral every 10cm, and
  the soil-horizon letter (Oi, Oa, A, B, BC, C) printed where that horizon
  begins. It is generated from the simulation's own strata, so it is a legend
  and a measurement at once and can never disagree with the map.
- **The mount** — the battlefield. A slab of instanced soil grit roughly 2:1,
  pinned along its flanks and corners with gummed tape, with the canopy breaking
  its top edge. The camera frames it so the mount's left edge lands about 12%
  across the viewport, leaving the left margin for the rail and everything right
  of it as bare paper.
- **Catalogue block** — `right: 154px; bottom: 34px; width: 336px`. A ruled grid
  with no border and no fill, sitting directly on the sheet. Its only backing is
  a radial gradient that reads as the paper falling into shadow. The **spore
  fragment packet** sits to its right at `right: 34px; width: 104px` and fills
  as spores are banked.
- **Orders** — bottom left, a ruled list of four acts (Grow, Bond, Cord, Fruit)
  with keyboard equivalents 1–4.

Responsive: below 1180px the rail narrows to 66px and drops its numerals and the
catalogue moves in to 150px. Below 900px the catalogue docks full-width to the
bottom edge and the packet is hidden. The game is desktop-first; small screens
are a graceful degradation, not a target.

The specimen and the stand are framed from the viewport at any size: at a
portrait aspect the stand is framed whole and reads smaller rather than being
cropped at its ends.

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

In the underground view there are no interface shadows or elevation. Every
annotation is printed onto one flat sheet, and depth in the specimen comes from
the soil's own darkness—near-black at bedrock, warmer toward the litter—plus the
falloff in the glow. The interface has no z-axis. The surface forest is the
deliberate exception: its terrain, trunks, crowns, atmosphere, and camera occupy
real depth, while its annotations retain the flat botanical grammar.

Cards, panels, modals, tooltips and popovers do not exist in this world. If
information must appear, it is printed on the sheet or added to the catalogue
block.

## Shapes

Rectilinear and ruled. Every corner in the interface is square — zero border
radius anywhere, including the mount, the tape, the stamp, the packet and the
catalogue block. The recurring geometry is the hairline rule: a one-pixel line
that separates fields, marks a horizon, or paces the depth rail.

The one organic shape in the game is the network, and that is because the
simulation drew it. The only other curve in the interface is the rounded surface
of the spore heap inside the fragment packet, and that is a poured material
rather than a shape — it curves the way a heap of spores actually curves. No
interface element has a radius.

## Components

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

### Order rows

- **Shape:** no box, no radius; a single hairline rule beneath each row.
- **Rest:** field-value type at 62% opacity, with a small Courier key numeral.
- **Active:** the rule and the label take Hyphal Amber. There is no fill.
- **Hover:** the row indents 6px on a 200ms curve. The page never lifts.

### Speed toggles

- **Shape:** a joined ruled strip, each cell separated by a hairline.
- **Active:** inverted — Label Ink fill with Mount Shadow text.

### Catalogue block

- **Shape:** a two-column grid of hairline-ruled fields, no border.
- **Backing:** a radial gradient only, so it holds legibility over the soil.
- **Values:** tabular numerals, right-aligned. Colour carries state: amber for
  carbon, pallor for the rival, violet for genetic potential.

### Depth rail

- **Ticks:** 5cm minor, 10cm major; numerals at 38% opacity.
- **Horizons:** letters set 0.2em apart and offset from the numerals, so the two
  scales never collide.

## Do's and Don'ts

### Do:

- **Do** keep the sheet as the ground for everything. Print on it; never place a
  panel over it.
- **Do** draw the depth rail and its horizon letters from the simulation's real
  strata.
- **Do** right-align every number in the catalogue block so the column scans.
- **Do** let the network be the only bright thing, and let it dim when starved —
  the picture must reflect the network's real state.
- **Do** keep tape, foxing and grain slightly irregular. Perfect symmetry reads
  as a template rather than a specimen.
- **Do** render the network with normal blending, never additive. Thousands of
  overlapping strands blend additively into a white smear, which destroys the
  filament structure the whole art direction depends on. Bloom supplies the glow
  instead, at a threshold above the soil's albedo so nothing else catches it.

### Don't:

- **Don't** add rounded corners, drop shadows, glass panels, blur, or gradients
  as surfaces. None of them exist in an archive.
- **Don't** draw a resource bar, minimap, tooltip, toast, or floating panel.
- **Don't** use pure white or pure black. Every value is warm and slightly off.
- **Don't** animate the paper. Growth, flow, spore drift and light belong to the
  specimen.
- **Don't** use colour as the only channel for team identity. The rival reads as
  a different filament *texture* — thinner, straighter, colder — as well as a
  different hue, so the distinction survives colour-vision deficiency.
- **Don't** let the canopy become a bright mass. It is a near-silhouette
  (#151c0f in spring, dropping to #0c0b08 in winter) against the lit paper.


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
