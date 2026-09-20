# Mycelia — brainstorming sheet

This is an exploratory sheet, not a plan. Nothing here is committed work, a
schedule, a backlog or a status record. `PROJECT_STATUS.md` remains the single
authoritative record of implementation status, priorities, remaining gaps and
verification; anything that is actually adopted belongs there rather than here,
and everything below is a proposal that may be wrong, redundant or already
covered.

Items marked **needs art** would require new or edited 3D models. Everything
else is code, simulation, interface or audio work.

The contiguous-soil intent — every above-ground stand tile with its own
persistent underground transect, and a network able to grow across a shared
boundary into the neighbouring stand's soil — is already recorded in
`PROJECT_STATUS.md` and `PRODUCT.md` as product direction, and is assumed
throughout this sheet.

## Growth verbs beyond Grow / Bond / Cord / Fruit

- **Anastomosis.** Fuse two of your own strands into a loop. Costs carbon, buys
  redundancy: a cut has a way around, which is the counterplay a mycoparasite
  would demand.
- **Sclerotium.** Bank a dormant survival body that sits out a drought or a bad
  season and reawakens later. An in-world save point, and a way to survive a
  loss without a menu.
- **Concession.** Deliberately abandon a root tip or a whole branch of the
  colony, reclaiming part of its carbon while severing whatever travels through
  it. Pairs with quarantine as the answer to Armillaria.
- **Foraging policy.** A printed directive line — exploratory versus
  exploitative — changing growth pattern, cost and how quickly the frontier
  finds water. A policy rather than micromanagement, matching the product
  direction that orders are growth directives and policies.
- **Defensive investment.** Localised antibiosis or enzyme defence costing
  carbon per second while active: the ecological answer to infection rather than
  a damage number.
- **Graft into a root graft.** The design notes already give birch root grafts.
  Bonding one tree that shares a graft with another would supply both at once —
  and let infection travel the same way.

## Making trees and soil into characters

- **Age and canopy closure.** Let stands mature into closed canopy, where light
  becomes contested and only gaps let regeneration through. Windthrow of one old
  tree becomes an event: gap, light, deadwood and escaped roots at once.
- **Species as negotiated terms.** Birch: plentiful tips, fair exchange, fragile
  under drought. Oak: slow, deep, generous over decades. Hemlock: cheap water,
  shade-tolerant, shallow and windthrow-prone. Same verbs, different economics
  per stand.
- **Strata that matter.** The record already names clay, sand and gravel. Give
  each horizon its own mineral and drainage truth — nitrogen near the surface,
  mineral deeper, saturation at the water table — so rooting depth becomes a
  strategy rather than a longer line.
- **Tree requests.** A stressed tree should ask, in the sheet: a thinning crown,
  a printed line naming what it lacks and where. Today pressure is mostly
  invisible until it is a number.
- **Flow-through water.** Cords laid along a drainage line move water faster; a
  hollow collects it; a saturated stand is a barrier rather than a resource.
  Hydrology becomes a movement problem, not only a table value.
- **Windthrow as a physical event.** A tree falls, opens the canopy, crosses a
  stream, and becomes a bridge and a decomposer prize simultaneously.

## Adversaries worth talking about

- **Armillaria as a slow black patient threat.** Visible rhizomorphs creeping
  under a stand boundary, a warning mushroom above ground, and a choice between
  quarantine, sacrifice and racing it to the deadwood.
- **Mutualist rivals with a face.** They occupy the same tips you want, and
  overbidding costs carbon you need elsewhere. Losing a tree to a rival should
  look like losing an argument rather than a fight.
- **Mycoparasite that punishes thinness.** It tracks and coils around fine
  hyphae; cords and loops resist. Elegant because the counter is the shape of
  your network.
- **Saprotroph as a race for the dead.** Every death becomes a contested pulse;
  losing the race means the nutrient went to something else.
- **Two adversaries at once, later.** Drought plus Armillaria is a story; three
  at once is noise. Sequence them.

## The region as a place

- **A contiguity victory.** Rather than "fruit N times", the regional goal could
  be reaching the watershed outlet with an unbroken network. The stream becomes
  the road and the map becomes the objective.
- **Weather fronts that travel.** A storm enters from one edge of the region and
  crosses stand by stand, carrying spores on its front and windthrow on its
  flank. Nine weather samples become one sky.
- **Landmarks with opinions.** A nurse log, a lightning-split oak, a spring, a
  cut bank, a beaver dam — each one changes what grows beside it.
- **Survey as discovery.** Stands never held should stay partly blank; water and
  deadwood are learned by being there, and the ledger fills in over a match.
- **Seeded regional shapes.** Beyond 3×3: a valley with one outlet, a ridge with
  a dry north face, a flood plain. Same systems, different geometry.

## Interface, staying inside the herbarium sheet

- **A running field journal.** A margin where the match annotates itself: "first
  bond, 4 min", "storm, 9 min", "a hemlock died at −62 cm". History is what a
  real specimen sheet always carries and the game currently discards.
- **Trend lines, not only instant values.** The catalogue shows a number now; a
  small ruled sparkline would show where it has been. Very much in-language, no
  chrome.
- **Callout labels that behave.** Leader lines, collision avoidance, distance
  fading, and never more than a handful on screen. This is the `UX-02` gap and
  the single biggest legibility win underground.
- **A depth rail that earns its keep.** Name the horizons, mark the water table,
  show the deepest strand, and let the rail measure how far it is to water here.
- **Hovered stands as ghosts.** Hovering a survey line could faintly outline
  that stand's ground in the forest — a whisper of highlight, not a tile HUD.
- **An archive of past accessions.** The stamp and barcode already promise a
  collection; keeping finished matches as sheets you can flip back through gives
  save/load a narrative form and makes the accession number mean something.
- **A printed key block.** A quiet margin listing controls as a field-guide
  legend, instead of transient hint lines.
- **Rest until something changes.** Jump to the next season, storm, bond outcome
  or threat. Fast-forward that preserves the meditative pacing.
- **Species that differ without colour.** `PRODUCT.md` already flags colour-only
  species identity as a risk; distinct silhouette at distance, blade shape and a
  small printed species glyph in every label would fix it properly.

## Records, progression and the shape of a run

- **Genetic potential that buys something.** The field exists; let it purchase
  heritable adaptation — drought tolerance, cord efficiency, faster germination
  — so a daughter colony is a slightly different organism.
- **Named scenarios as archive slips.** Each crisis arrives as its own
  accession: premise, hazard, goal, fixed seed. A natural home for "The Black
  Cords" and "The Withering Hemlocks".
- **Bloom years.** Some autumns offer a bigger fruiting yield at a real cost to
  the forest: one decision a year, with consequences visible next spring.
- **A post-match sheet.** What the stand looks like after you win or lose —
  survivor species, deadwood, what the network left behind — instead of a
  sentence.

## If only three were built

1. **The running field journal plus trend lines.** It makes the whole sheet feel
   like a record, and it is cheap.
2. **Anastomosis and concession.** Two new verbs that give the existing network
   shape real meaning, and together they make mycoparasite, quarantine and
   sacrifice playable.
3. **A travelling weather front over the region.** It ties the stands into one
   sky and gives the wind model a purpose beyond sway.

## What would need new art

Everything above is procedural or interface work except:

- distinct species silhouettes and blade shapes, if form were used to fix the
  colour-only species-identity risk beyond what generated geometry can carry;
- any new landmark prop that is not already in the delivered pack (nurse log,
  cut bank, beaver dam);
- a post-match "sheet" illustration, if the outcome were rendered as a composed
  image rather than a printed text page.

The delivered pack already covers living and dead trees, saplings, understory,
deadwood, reproductive bodies and rocks, so most of the ideas here can be built
without opening Blender.
