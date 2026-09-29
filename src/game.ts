import * as THREE from 'three';
import { ECON, GRID, SPECIES } from './sim/content';
import { groupResting, groupSummary, nearestNode, setGroupResting, type Network } from './sim/network';
import { Soundscape } from './audio/soundscape';
import { LivingView } from './render/living';
import { FruitingView, type FruitingSite } from './render/fruiting';
import { TILE_SIZE, SurfaceForest } from './render/surface';
import { COMMUNITY_LABEL, type Region } from './sim/region';
import { RegionalMatch } from './sim/match';
import { CrossingMatch, type CrossingDirection } from './sim/crossing';
import { elevationAtDepthCm, standFrameOf, standIdAt, type Vec3 } from './sim/spatial';
import { disposeView } from './render/dispose';
import { TreeBatches, type BatchedTree } from './render/tree-batches';
import { ForestDressing } from './render/forest-dressing';
import { forestFloorField } from './render/forest-floor-field';
import { layoutForestDressing, playableTrunkPositions, type DressingBand } from './render/forest-dressing-layout';
import { NetworkReveal, REVEAL_PICK_RADIUS, type RevealEdge } from './render/network-reveal';
import { SECTION_SOIL_MARGIN, SectionView } from './render/section-view';
import { EDGE_SOIL_COLUMNS, buildEdgeSoil } from './render/edge-soil';
import { SporeFlights } from './render/spore-flight';
import {
  browsableSections,
  clipEdges,
  flipSection,
  sectionAnchor,
  sectionContains,
  sectionForPoint,
  sectionLabel,
  sectionOrder,
  stepSection,
  type SectionSpec,
} from './render/sections';
import type { WorldView } from './render/camera';
import { Simulation } from './sim/sim';
import { OverlayFade } from './render/fade';
import { AssetLibrary } from './render/assets';
import { ForestView } from './render/forest';
import { HyphaeMesh, Motes } from './render/hyphae';
import { SoilMesh } from './render/soil';
import { GroundwaterView, StreamView } from './render/water';
import { Stage } from './render/stage';
import type { CameraPose } from './render/camera';
import { makeGlowTexture } from './render/textures';
import type { QualityPreset } from './render/quality';
import { deriveJourney, type Journey, type RootTarget } from './ui/journey';
import { SheetUI, formatClock, type OrderId } from './ui/sheet';
import { SurveySheet } from './ui/survey';
import { StormUI } from './ui/storm';
import { StormView } from './render/storm';
import { FireView } from './render/wildfire';
import { FireUI } from './ui/wildfire';
import { ContactBar } from './ui/contact';
import { AgentUI } from './ui/agent';
import { ContactEffects } from './render/contact';
import { CHEMICALS, type Chemical } from './sim/contact';
import { regionNetworks } from './sim/wildfire';
import { FLOOR_DROUGHT, FLOOR_FIRE, FLOOR_FLOOD } from './render/forest-floor';
import { DroughtView } from './render/drought';
import { DroughtUI } from './ui/drought';
import { UndergroundWeather } from './render/underground-weather';
import { FloodView } from './render/flood';
import { FLOOD } from './sim/flood';
import { DRESSING_FIRE_MAP } from './render/forest-dressing';
import { FIRE } from './sim/wildfire';
import { buildSurvey } from './sim/survey';

const FIXED_STEP = 1 / 60;
/**
 * Most wall-clock time one frame may spend stepping the simulation, in
 * milliseconds. When the requested speed needs more (a large network at 4x),
 * the rest of the frame's time is dropped rather than banked: the world runs
 * slower than asked instead of the frame rate collapsing, and the speed control
 * says how fast it is really going. The simulation is still fixed-step and
 * deterministic; only how much of it happens per frame changes.
 */
const STEP_BUDGET_MS = 11;
/** At most this much unstepped time is carried into the next frame. */
const MAX_CARRY = FIXED_STEP * 2;

/**
 * The player's network is the only bright thing on the sheet, so its core is
 * the hottest colour in the game and its glow is the outward amber bloom.
 */
const PLAYER_PALETTE = {
  core: new THREE.Color('#ffc76a'),
  glow: new THREE.Color('#c9690f'),
};
/**
 * The rival saprotroph is deliberately *less* luminous than the player, so a
 * contested frame reads as warmth losing to pallor. Its brightest strand (the
 * core) still sits below the player's core, and the bulk of the network is the
 * dim, cold glow colour.
 */
const RIVAL_PALETTE = {
  core: new THREE.Color('#9dc47f'),
  glow: new THREE.Color('#3f5a32'),
};

/** One on-sheet button: what it says, where it sits and what it does. */
interface MarkerSpec {
  key: string;
  gx: number;
  gy: number;
  className: string;
  text: string;
  aria: string;
  disabled: boolean;
  onClick: () => void;
}

/**
 * Wires the simulation to the sheet.
 *
 * The simulation runs at a fixed 60Hz timestep regardless of frame rate, so a
 * match plays identically on any machine; only rendering is variable. The speed
 * control multiplies how many fixed steps are consumed per frame.
 */
export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly stage: Stage;
  private sim: Simulation;
  private soil: SoilMesh;
  private readonly playerMesh: HyphaeMesh;
  private readonly rivalMesh: HyphaeMesh;
  private readonly playerMotes: Motes;
  private readonly rivalMotes: Motes;
  private forest: ForestView;
  private readonly ui: SheetUI;
  /** The regional survey layer: a printed ledger of the region's stands. */
  private readonly survey = new SurveySheet();
  private living: LivingView;
  /** The region's stream above ground, one ribbon in the founding frame. */
  private readonly stream: StreamView;
  /** The active stand's channel and water table, below ground. */
  private groundwater: GroundwaterView;
  /**
   * One surface per persistent stand. Colonized stands can be entered, while
   * uncolonized ground remains a survey until a paid spore arrives.
   */
  private readonly surfaces: SurfaceForest[] = [];
  private readonly region: Region;
  private readonly seedText: string;
  readonly match: RegionalMatch;
  private reportedColonies = 1;
  private readonly acknowledgedOutcomes = new Set<number>();
  /** Authored models, if any have been built yet; the game runs without them. */
  private readonly assets = new AssetLibrary();
  private readonly treeBatches: TreeBatches;
  /** Stand the selected crown stands in, or null while nothing is chosen. */
  private selectedStandId: number | null = null;
  /** Everything drawn inside the soil, faded as one body during a crossing. */
  private overlays: OverlayFade;
  private readonly sound = new Soundscape();
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private ambientMotion = !this.reducedMotion;
  private lastView = '';
  private awakened = false;
  private markerClock = 0;
  private revealClock = 0;
  /** Set once the regional result has been shown, so it is shown once. */
  private victoryShown = false;
  /** Stand crossings already offered to the player as a Follow prompt. */
  private crossingsSeen = 0;
  /** The stand the Follow prompt would take the player into, if one is offered. */
  private followStand: number | null = null;
  private journeyClock = 0;
  private journey: Journey | null = null;
  private lastBonds = 0;
  private lastFruits = 0;
  private readonly markerButtons = new Map<string, HTMLButtonElement>();
  /** What each label does when clicked, rebound on every marker update. */
  private readonly markerActions = new Map<string, () => void>();

  private speed = 0;
  private accumulator = 0;
  /** Simulated and asked-for seconds over the last moments, for the speed readout. */
  private paceSimulated = 0;
  private paceAsked = 0;
  /** The speed the world is actually running at, smoothed; equals `speed` when it keeps up. */
  effectiveSpeed = 1;
  private lastFrame = 0;
  private raf = 0;
  private seasonId = '';
  private steward = false;
  private stewardClock = 0;

  private pointerDown = false;

  /** The headless spatial fixture, when `?lab=crossing` asked for it. */
  private labCrossing: LabCrossingMatch | null = null;

  /** Background vegetation. Presentation only: never a tree, never pickable. */
  private dressing: ForestDressing;
  private dressingBand: DressingBand = 'medium';
  private dressingDirty = false;
  /**
   * The player's own fruiting bodies above ground. The sheet inside the soil
   * shows an eruption in section; this is the same body standing on the floor
   * of the region, where the simulation recorded it.
   */
  private readonly fruiting: FruitingView;
  /** Released spores crossing the canopy toward the stands they found. */
  private readonly sporeFlights: SporeFlights;
  /** Colonization records already drawn as flights. */
  private colonizationSeen = 0;
  private readonly stormUI: StormUI;
  private readonly stormView: StormView;
  private readonly fireView: FireView;
  private readonly fireUI: FireUI;
  /** Contact war: the chemical hotbar, the soil effects, and where the cursor rests. */
  private readonly contactBar: ContactBar;
  private readonly contactFx = new ContactEffects();
  /** Who plays the rival: the placeholder, or an agent through a System One provider. */
  private readonly agentUI: AgentUI;
  private readonly hover = { x: -1, y: -1 };
  private standPlane: { standId: number; alongIsX: boolean; offset: number; fixed: number } | null = null;
  private readonly droughtView: DroughtView;
  private readonly droughtUI: DroughtUI;
  /** Presentation-eased drought severity, so cracks open and close smoothly. */
  private droughtShown = 0;
  /**
   * The subcluster the player's orders go to (0: the colony at large), and
   * the press-and-hold circle that selects one. See `GrowthGroup`.
   */
  private selectedGroup = 0;
  private lasso: { startedAt: number; clientX: number; clientY: number; gx: number; gy: number; point?: { x: number; y: number; z: number }; radius: number; active: boolean } | null = null;
  private lassoRing: THREE.Mesh | null = null;
  private clusterBar: HTMLElement | null = null;
  private clusterKey = '';
  /** The active stand's soil-side weather overlay; rebuilt with its groundwater view. */
  private undergroundWeather: UndergroundWeather | null = null;
  private readonly floodView: FloodView;
  /** Render-only: the silt stain left after a flood, fading over a minute. */
  private floodSilt = 0;
  /** Render-only: char and green return remain visible after the fire clears. */
  private scorchFade = 0;
  /** Windfalls already struck by presentation lightning. */
  private windfallsSeen = 0;

  /**
   * The spatial body from the running match or the crossing bench. Sections and
   * the forest reveal both read its one graph.
   */
  private spatial: SpatialFixture | null = null;
  private emptySectionViewer: SpatialFixture | null = null;
  private reveal: NetworkReveal | null = null;
  private sectionView: SectionView | null = null;
  private spatialRefreshClock = 0;
  private revealEnabled = false;
  private selectedEdgeKey: string | null = null;
  private lastStrandPick: RevealPickInfo | null = null;
  /** Whether the match's own underground views are hidden for a section. */
  private sectionHidLocalViews = false;
  /** The section being inspected, and the stand it belongs to. */
  private section: { spec: SectionSpec; sections: SectionSpec[] } | null = null;
  /** Where the player stood in the forest when they first went below. */
  private forestContext: ForestContext | null = null;
  /** Remembered poses per section, so flipping back returns to the same view. */
  private readonly sectionPoses = new Map<string, CameraPose>();
  /** Region coordinates of the render frame's own corner, and its shifts. */
  private readonly sceneOrigin: { x: number; y: number };
  private readonly sceneShift = { x: 0, z: 0 };

  /** The section panel's readout, and its own visibility. */
  private syncSectionUI(): void {
    const panel = document.querySelector<HTMLElement>('#section-browser');
    if (!panel) return;
    const show = this.section !== null || this.match.spatialColonies.has(this.match.activeStandId);
    document.body.classList.toggle('spatial-colony', show);
    panel.hidden = !show;
    const status = document.querySelector('#section-status');
    if (status) {
      status.textContent = this.section
        ? this.sectionReadout()
        : 'No section open. Previous and Next open one through the colony.';
    }
  }

  private pointerMoved = 0;
  private lastX = 0;
  private lastY = 0;
  private shiftDown = false;

  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private readonly hit = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, ui: SheetUI, seedText: string, quality: QualityPreset) {
    this.canvas = canvas;
    this.ui = ui;
    this.seedText = seedText;
    this.sim = new Simulation(seedText);
    // `?start=best` keeps the earlier single best start, for fixtures only.
    const starts = new URLSearchParams(location.search).get('start') === 'best' ? 'best' : 'drawn';
    this.match = new RegionalMatch(seedText, this.sim, { starts });
    this.region = this.match.region;
    const home = this.region.stands[this.region.foundingStand];
    this.sceneOrigin = { x: (home?.sx ?? 0) * TILE_SIZE, y: (home?.sy ?? 0) * TILE_SIZE };

    this.stage = new Stage(canvas, quality);
    const glow = makeGlowTexture(64);

    this.soil = new SoilMesh(this.sim.world);
    this.stage.scene.add(this.soil.group);
    this.attachEdgeSoil();

    this.playerMesh = new HyphaeMesh(PLAYER_PALETTE, glow);
    // Thinner filaments for the rival, so the two networks differ in texture.
    this.rivalMesh = new HyphaeMesh(RIVAL_PALETTE, glow, { radiusScale: 0.62 });
    this.stage.scene.add(this.playerMesh.group, this.rivalMesh.group);

    this.playerMotes = new Motes(glow, 900, 1337);
    this.rivalMotes = new Motes(glow, 420, 4242);
    this.stage.scene.add(this.playerMotes.points, this.rivalMotes.points);

    this.forest = new ForestView(this.sim.world);
    this.forest.showRootsOnly();
    this.stage.scene.add(this.forest.group);
    this.buildRegionStand();
    this.stream = new StreamView(this.region, this.match.activeStandId);
    this.stage.scene.add(this.stream.group);
    this.treeBatches = new TreeBatches(this.surfaces.reduce((sum, surface) => sum + surface.trees.length, 0));
    this.stage.scene.add(this.treeBatches.group);
    // Background vegetation: one region-wide layout, drawn per stand so a stand
    // can be inspected, folded and culled on its own.
    this.dressing = this.buildDressing();
    this.stage.scene.add(this.dressing.group);
    // The earned reward above ground, standing in the region's own coordinates
    // so it moves with the ground when the player enters another stand.
    this.fruiting = new FruitingView(this.assets, (point) => this.regionToScenePoint(point));
    this.stage.scene.add(this.fruiting.group);
    this.sporeFlights = new SporeFlights(glow, (point) => this.regionToScenePoint(point));
    this.stage.scene.add(this.sporeFlights.group);
    this.colonizationSeen = this.match.sporeReleases.length;
    this.stormUI = new StormUI(this.match, text => { this.ui.setNote(text); if (text === 'Storm announced') this.ui.resetStand(); });
    const stormWidth = this.region.cols * TILE_SIZE, stormDepth = this.region.rows * TILE_SIZE;
    this.stormView = new StormView(stormWidth,stormDepth,this.stage.quality.id === 'fast');
    this.stormView.group.position.copy(this.regionToScenePoint({x:stormWidth/2,y:stormDepth/2,z:this.region.heightAt(stormWidth/2,stormDepth/2)}));
    this.stage.scene.add(this.stormView.group);
    this.fireUI = new FireUI(this.match, text => this.ui.setNote(text));
    this.contactBar = new ContactBar(() => this.jumpToFront());
    this.agentUI = new AgentUI(this.match);
    this.stage.scene.add(this.contactFx.group);
    this.fireView = new FireView(stormWidth, stormDepth,
      (x, y) => this.regionToScenePoint({ x, y, z: this.region.heightAt(x, y) }),
      this.stage.quality.id === 'fast');
    this.stage.scene.add(this.fireView.group);
    this.droughtUI = new DroughtUI(this.match, text => this.ui.setNote(text));
    this.droughtView = new DroughtView(stormWidth, stormDepth,
      (x, y) => this.regionToScenePoint({ x, y, z: this.region.heightAt(x, y) }),
      this.stage.quality.id === 'fast');
    this.stage.scene.add(this.droughtView.group);
    this.floodView = new FloodView(this.stream.course,
      (x, y) => this.regionToScenePoint({ x, y, z: this.region.heightAt(x, y) }),
      this.stage.quality.id === 'fast');
    this.stage.scene.add(this.floodView.group);
    // A tier file that arrives changes which geometry the scenery can wear, so
    // the next frame rebuilds it rather than waiting for a camera move.
    this.assets.onLoad = () => {
      this.dressingDirty = true;
    };
    // Art is opportunistic: the stand above is already drawn procedurally, and
    // whatever loads is handed over as it arrives.
    void this.assets.load().then(() => this.adoptAssets());
    this.living = new LivingView(this.sim, this.assets);
    this.stage.scene.add(this.living.group);
    this.groundwater = this.buildGroundwater();
    this.stage.scene.add(this.groundwater.group);
    this.overlays = new OverlayFade([
      this.playerMesh.group,
      this.rivalMesh.group,
      this.playerMotes.points,
      this.rivalMotes.points,
      this.forest.group,
      this.living.group,
      this.groundwater.group,
    ]);

    ui.buildRail(this.sim);
    this.frameSheet();
    this.warnIfSoftwareRendering();
    this.stage.rig.reducedMotion = this.reducedMotion;
    if (new URLSearchParams(location.search).get('view') !== 'underground') this.stage.rig.setView('forest', true);
    this.syncViewUI();
    this.bindInput();
    this.bindSpeed();
    this.bindExperience();
    this.bindViews();
    this.ui.onOrder((order) => this.applyOrder(order));
    this.setSpeed(0);
  }

  /**
   * Build the region: one surface per stand, laid out around the stand the
   * player's colony stands in, so the whole 3x3 mosaic is drawn as one
   * continuous forest.
   *
   * The founding stand's trees are the simulation's own. Every other stand's
   * ground comes from the same generators the region would hand a colony
   * arriving there, so what the player can see is what such a colony would
   * find.
   */
  private buildRegionStand(): void {
    const founding = this.region.stands[this.region.foundingStand];
    if (!founding) return;
    const playable = playableTrunkPositions(this.region.stands, id => this.match.stands[id].sim.world.trees);
    const scenery = layoutForestDressing({ region: this.region, playable, course: this.region.streamPath, band: this.dressingBand });
    const floorField = forestFloorField(this.region, this.region.streamPath, [
      ...playable, ...scenery.filter(item => item.kind === 'canopy' || item.kind === 'young'),
    ]);
    for (const site of this.region.stands) {
      const world = this.match.stands[site.id].sim.world;
      const surface = new SurfaceForest(world, {
        id: site.id,
        originX: site.sx * TILE_SIZE,
        originY: site.sy * TILE_SIZE,
        edges: [
          ...(site.sy === 0 ? ['north' as const] : []),
          ...(site.sy === this.region.rows - 1 ? ['south' as const] : []),
          ...(site.sx === 0 ? ['west' as const] : []),
          ...(site.sx === this.region.cols - 1 ? ['east' as const] : []),
        ],
        heightAt: (x, y) => this.region.heightAt(x, y),
      }, this.assets, floorField);
      surface.setQuality(this.stage.quality);
      surface.group.position.set((site.sx - founding.sx) * TILE_SIZE, 0, -(site.sy - founding.sy) * TILE_SIZE);
      this.surfaces[site.id] = surface;
      this.stage.scene.add(surface.group);
    }
  }

  /** The region's surfaces, in stand order. Used by the browser checks. */
  get regionSurfaces(): SurfaceForest[] {
    return this.surfaces;
  }

  /**
   * A player whose browser has fallen back to software WebGL (hardware
   * acceleration off, a blocklisted driver, a remote desktop) is told so and
   * how to fix it: the game is built for a GPU and is slow without one.
   * Automated browsers use software rendering on purpose and are not told.
   */
  private warnIfSoftwareRendering(): void {
    const { software, backend } = this.stage.qualityReport();
    if (!software || navigator.webdriver) return;
    const notice = document.createElement('aside');
    notice.className = 'gpu-notice';
    notice.setAttribute('role', 'status');
    notice.innerHTML = `<p><strong>Mycelia is running without your graphics card.</strong>
      Your browser is drawing in software (${backend.replace(/[<>&]/g, '')}), so the forest will be slow.
      Turn on <em>Use graphics acceleration when available</em> in your browser's settings and restart it.
      On a laptop with two GPUs, you can also set your browser to "High performance" in Windows graphics settings.</p>
      <button type="button">Dismiss</button>`;
    notice.querySelector('button')!.addEventListener('click', () => notice.remove());
    document.body.append(notice);
  }

  /** The active stand's channel and water table, rebuilt like the local views. */
  private buildGroundwater(): GroundwaterView {
    const view = new GroundwaterView(this.sim.world, this.match.active.site.stream);
    // The powers as the soil sees them ride with the stand's own water views,
    // so they are rebuilt, faded and disposed with it.
    const site = this.match.active.site;
    this.undergroundWeather = new UndergroundWeather(this.sim.world, {
      x: site.sx * TILE_SIZE, y: site.sy * TILE_SIZE + TILE_SIZE / 2,
    });
    view.group.add(this.undergroundWeather.mesh);
    return view;
  }

  /** Storm, flood, fire and drought in the active stand's soil. */
  private updateUndergroundWeather(dt: number): void {
    const storm = this.match.storm;
    const site = this.match.active.site;
    const rain = storm.phase === 'active' ? 1 : storm.phase === 'recovery' ? this.match.stormIntensity : 0;
    const soaking = storm.phase === 'active' ? this.match.time - storm.activeAt : storm.phase === 'recovery' ? 40 : 0;
    this.undergroundWeather?.update(dt, {
      rain,
      wetFront: Math.min(45, 4 + soaking * 1.1),
      flood: this.match.flood.level,
      floodDepth: (gx) => this.match.flood.depthAt(site, gx),
      flash: this.stormView.flash,
    }, this.ambientMotion);
  }

  /**
   * Give every stand the art that has loaded, and say out loud what is missing.
   *
   * A missing model is a warning rather than an error: the procedural stand is
   * the fallback, and the browser checks must keep passing while art is made.
   */
  private adoptAssets(): void {
    for (const surface of this.surfaces) surface?.adoptAssets();
    // Scenery is laid out from the same library: a decoration whose art has just
    // arrived joins its stand's batches, and one whose art is missing is
    // simply not drawn rather than replaced by a fallback.
    this.dressing.build(this.dressingBand);
    for (const note of this.assets.failures) console.warn(`mycelia: ${note}`);
  }

  /** The stand the player can enter: the one their colony stands in. */
  private get surface(): SurfaceForest {
    return this.surfaces[this.match.activeStandId] as SurfaceForest;
  }

  private get enterableStand(): number {
    return this.match.activeStandId;
  }

  /** Recompute the default framing for the current viewport. */
  private frameSheet(): void {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    // The forest is framed as the whole region now, not one stand: the mosaic
    // spans three tiles each way.
    const span = this.region.cols * TILE_SIZE;
    // Centred on the region rather than on the colony's own tile, so the rows
    // nearest the camera stay in the picture.
    const founding = this.region.stands[this.match.activeStandId];
    this.stage.rig.forestCentre = {
      x: ((this.region.cols - 1) / 2 - (founding?.sx ?? 0)) * TILE_SIZE,
      // A tile's own depth runs from its near edge back to z = -TILE_SIZE, so
      // the region's centre sits half a tile behind the middle row.
      z: ((founding?.sy ?? 0) - this.region.rows / 2) * TILE_SIZE,
    };
    this.stage.rig.frameMount(aspect, GRID.cols, GRID.rows, 34, span, span);
  }

  /**
   * Fast-forward the simulation without rendering it.
   *
   * Used by `?warm=<seconds>` for screenshots and demo links, and by the visual
   * QA harness — software WebGL runs far below 60fps, so a screenshot taken
   * after N seconds of wall clock would otherwise show a network barely out of
   * its spore. Deterministic, so a warmed match is the same match.
   */
  warmUp(seconds: number): void {
    this.awaken();
    const steps = Math.max(0, Math.min(60 * 60 * 8, Math.round(seconds * 60)));
    for (let i = 0; i < steps; i++) {
      this.match.step(FIXED_STEP);
      // Let the stand-in player act while we fast-forward, otherwise a warmed
      // match is only ever a network that never bonded a tree.
      if (this.steward && i % 240 === 0) this.stewardTick();
    }
    this.accumulator = 0;
  }

  /**
   * A stand-in player, for verification and demo links (`?steward=1`).
   *
   * It does the one thing a real player must do to have an economy at all:
   * bond the network to every tree it can reach. Without this the simulation
   * starves in exactly the way the design intends, which makes it hard to
   * photograph the game working.
   */
  enableSteward(): void {
    this.steward = true;
  }

  /**
   * Lay out and build the region's background vegetation.
   *
   * The playable population is the simulation's own trees: their regional
   * positions come from `treeLocalOffset`, so the scenery keeps clear of exactly
   * the trunks the player can select, and a decoration can never be mistaken
   * for one of them - it has no simulation identity at all.
   */
  private buildDressing(): ForestDressing {
    const founding = this.region.stands[this.region.foundingStand];
    const playable = playableTrunkPositions(
      this.region.stands.map((site) => ({ id: site.id, sx: site.sx, sy: site.sy })),
      (standId) => this.match.stands[standId].sim.world.trees.map((tree) => ({
        id: tree.id,
        gx: tree.gx,
        seed: tree.seed,
        height: tree.height,
      }))
    );
    return new ForestDressing(this.assets, {
      region: this.region,
      course: this.region.streamPath,
      playable,
      // The scenery is placed in the same rebased frame the stands are built
      // in, and is shifted with them when the player enters another stand.
      sceneOrigin: {
        x: (founding?.sx ?? 0) * TILE_SIZE,
        y: (founding?.sy ?? 0) * TILE_SIZE,
      },
      band: this.dressingBand,
    });
  }

  /**
   * Every fruiting body the player has earned, in the region's own coordinates.
   *
   * A body is placed only where the simulation recorded a site. A transect
   * that was never bound to regional soil has no address to stand a mushroom
   * on; the sheet below ground still shows that eruption, and nothing above it
   * is invented.
   */
  private fruitingSites(): FruitingSite[] {
    const sites: FruitingSite[] = [];
    for (const stand of this.match.stands) {
      const player = stand.sim.player;
      player.blooms.forEach((bloom, index) => {
        if (!bloom.spatial) return;
        sites.push({
          key: `${stand.site.id}:bloom:${index}`,
          point: this.groundAt(bloom.spatial),
          progress: 1,
          bloomed: true,
        });
      });
      const fruit = player.fruit;
      if (fruit.active && fruit.spatial) {
        sites.push({
          key: `${stand.site.id}:rising`,
          point: this.groundAt(fruit.spatial),
          progress: fruit.progress,
          bloomed: false,
        });
      }
    }
    return sites;
  }

  /** A recorded site lifted onto the ground above it, where the body stands. */
  private groundAt(point: Vec3): Vec3 {
    return { x: point.x, y: point.y, z: this.region.heightAt(point.x, point.y) };
  }

  /**
   * Explicit opt-in test fixtures; ordinary matches never call this.
   *
   * The crossing fixture shares the coordinator used by ordinary play.
   */
  async prepareLab(scene: string): Promise<void> {
    this.setSpeed(0);
    if (scene === 'water' || scene === 'region') {
      const home = this.match.activeStandId;
      const targets = scene === 'region' ? this.match.stands :
        this.match.stands.filter(stand => stand.site.stream && stand.site.id !== home).slice(0, 1);
      for (const stand of targets) {
        if (!stand.sim.hasColony) stand.sim.foundColony(ECON.colonyFund);
      }
      if (scene === 'water' && targets[0]) this.enterStand(targets[0].site.id);
      this.refreshStandOptions();
    }
    if (scene === 'growth') {
      this.enableSteward();
      this.warmUp(30);
      this.setSpeed(0);
    }
    if (scene === 'crossing') {
      const crossing = new CrossingMatch({ seedText: this.seedText });
      crossing.orderAcross();
      let ticks = 0;
      while (crossing.portals().length === 0 && ticks < 12 * 30) {
        crossing.step(1 / 30);
        ticks++;
      }
      // Grow it on for a while: a colony that has only just touched the far
      // stand has almost nothing to browse, and sections want a body.
      for (let i = 0; i < 45 * 30; i++) crossing.step(1 / 30);
      this.labCrossing = crossing;
      this.attachSpatialFixture(crossing);
    }
    const view = scene === 'forest' || scene === 'region' || scene === 'crossing' ? 'forest' : 'underground';
    this.stage.rig.setView(view, true);
    this.syncViewUI();
    this.ui.setNote(
      scene === 'crossing'
        ? 'Test specimen: a funded colony crosses a real seam; sections and Network inspect its body.'
        : 'Test specimen: fixture resources; simulation paused.'
    );
  }

  /** The lab advances fixed steps without spending time drawing each step. */
  advanceLab(seconds: number): void {
    if (this.labCrossing) {
      const ticks = Math.max(1, Math.round(seconds * 30));
      for (let i = 0; i < ticks; i++) this.labCrossing.step(1 / 30);
      this.refreshSpatialViews();
      return;
    }
    this.warmUp(seconds);
    this.setSpeed(0);
  }

  /** The crossing fixture's own record, for the bench panel. */
  crossingReport(): string[] | null {
    return this.labCrossing ? this.labCrossing.report() : null;
  }

  setLabWaterDepth(cm: number): void {
    if (!Number.isFinite(cm)) return;
    this.sim.world.waterTableCm = Math.max(10, Math.min(GRID.rows, cm));
    this.groundwater.update(0);
    this.soil.refreshColors();
  }

  // -------------------------------------------------------------------------
  // Shared spatial views: sections and the forest reveal (VIEW-06, VIEW-07)
  // -------------------------------------------------------------------------

  /**
   * Region coordinates to the frame the stands are laid out in.
   *
   * Deliberately without the accumulated rebase shift: the reveal and the
   * section are grouped and moved exactly like the surfaces are, so the shift
   * lives in one place, the group's own position.
   */
  private regionToScene(x: number, y: number): { x: number; z: number } {
    return { x: x - this.sceneOrigin.x - TILE_SIZE / 2, z: -(y - this.sceneOrigin.y) };
  }

  private regionToScenePoint(point: { x: number; y: number; z: number }): THREE.Vector3 {
    const scene = this.regionToScene(point.x, point.y);
    return new THREE.Vector3(scene.x, GRID.rows / 2 + point.z, scene.z);
  }

  /** A live camera target back to absolute regional coordinates. */
  private sceneToRegion(sceneX: number, sceneZ: number): { x: number; y: number } {
    return {
      x: sceneX + this.sceneOrigin.x + TILE_SIZE / 2 - this.sceneShift.x,
      y: this.sceneOrigin.y - sceneZ + this.sceneShift.z,
    };
  }

  /**
   * Attach a spatial colony from the running match or the crossing bench.
   * Both views read this graph's own XYZ edges.
   */
  attachSpatialFixture(fixture: SpatialFixture): void {
    this.spatial = fixture;
    this.ensureReveal();
    if (!this.sectionView) {
      this.sectionView = new SectionView(
        (point) => this.regionToScenePoint(point),
        (x, y) => this.region.heightAt(x, y)
      );
      this.sectionView.setSoilSource({
        sample: (x, y, z) => {
          const sample = this.match.soil.sample(x, y, z);
          if (sample.standId === null) return null;
          const m = sample.material;
          return {
            stratum: m.stratum, water: m.water, organic: m.organic, nitrogen: m.nitrogen,
            occupancy: m.occupancy, stream: m.stream, saturation: sample.saturation,
          };
        },
        standAt: (x, y) => standIdAt(this.region, x, y),
      });
      this.stage.scene.add(this.sectionView.group);
    }
    this.refreshSpatialViews();
    this.syncSectionUI();
    const button = document.querySelector<HTMLButtonElement>('#forest-reveal');
    if (button) button.setAttribute('aria-pressed', String(this.revealEnabled));
    const standSelect = document.querySelector<HTMLSelectElement>('#section-stand');
    if (standSelect) {
      if (standSelect.options.length !== this.match.stands.length) {
        standSelect.replaceChildren(...this.match.stands.map((stand) => {
          const option = document.createElement('option');
          option.value = String(stand.site.id);
          option.textContent = `Stand ${stand.site.id + 1} · ${COMMUNITY_LABEL[stand.site.community]}`;
          return option;
        }));
      }
      standSelect.value = String(this.section?.spec.standId ?? this.selectedStandId ?? this.match.activeStandId);
    }
  }

  /**
   * When the player's frontier first enters another stand, offer to follow it
   * there. The offer stays until taken or until a later crossing replaces it.
   */
  private offerFollow(): void {
    const crossings = this.match.growthCrossings;
    if (crossings.length === this.crossingsSeen) return;
    const latest = crossings[crossings.length - 1];
    this.crossingsSeen = crossings.length;
    const button = document.querySelector<HTMLButtonElement>('#follow-frontier');
    if (!latest || !button) return;
    const site = this.region.stands[latest.to];
    if (!site) return;
    this.followStand = latest.to;
    button.textContent = `Your frontier has entered the ${COMMUNITY_LABEL[site.community].toLowerCase()} (stand ${latest.to + 1}). Follow`;
    button.hidden = false;
    this.sound.chime('bond');
  }

  /**
   * Draw every newly released cloud of spores crossing the canopy: to the
   * stand it founded, or, when it took hold nowhere, a stand's width downwind
   * before it thins away.
   */
  private launchSporeFlights(): void {
    const records = this.match.sporeReleases;
    if (records.length === this.colonizationSeen) return;
    for (let i = this.colonizationSeen; i < records.length; i++) {
      const record = records[i]!;
      const from = this.region.stands[record.from];
      if (!from) continue;
      const to = record.to === null ? null : this.region.stands[record.to];
      const endX = to ? to.centreX : from.centreX + Math.cos(record.direction) * TILE_SIZE;
      const endY = to ? to.centreY : from.centreY + Math.sin(record.direction) * TILE_SIZE;
      this.sporeFlights.launch(
        { x: from.centreX, y: from.centreY, z: this.region.heightAt(from.centreX, from.centreY) },
        { x: endX, y: endY, z: this.region.heightAt(endX, endY) },
        record.owner === 'rival' ? 'rival' : 'player'
      );
      if (record.owner !== 'rival') this.sound.chime('spores');
    }
    this.colonizationSeen = records.length;
  }

  /** Show the Release spores action while a mature body in this stand holds them. */
  private syncSporeButton(): void {
    const button = document.querySelector<HTMLButtonElement>('#release-spores');
    if (!button) return;
    const ready = this.match.sporesReady(this.match.activeStandId);
    button.hidden = ready === 0;
    if (ready === 0) return;
    const gust = this.match.gusting();
    button.classList.toggle('gusting', gust);
    const label = ready === 1 ? 'Release spores' : `Release spores (${ready} bodies ready)`;
    const hint = gust ? 'a gust is rising' : 'or the next gust will';
    if (button.dataset.label !== `${label}|${hint}`) {
      button.dataset.label = `${label}|${hint}`;
      button.innerHTML = `${label}<small>${hint}</small>`;
    }
  }

  /** The player's release order for the stand in view. */
  releaseSpores(): { ok: boolean; message: string } {
    const result = this.match.releaseSpores(this.match.activeStandId);
    this.syncSporeButton();
    return result;
  }

  /** Take the Follow offer: open the section in the stand the frontier reached. */
  followFrontier(): { ok: boolean; message: string } {
    const button = document.querySelector<HTMLButtonElement>('#follow-frontier');
    const target = this.followStand;
    if (button) button.hidden = true;
    this.followStand = null;
    if (target === null) return { ok: false, message: 'Nothing to follow.' };
    const body = this.match.spatialForStand(target) ?? this.match.spatial;
    if (!body) return { ok: false, message: 'The frontier is no longer there.' };
    if (body !== this.spatial) {
      this.match.spatial = body;
      this.attachSpatialFixture(body);
    }
    if (this.stage.rig.view !== 'underground') this.setView('underground');
    const result = this.openSection(target);
    if (result.ok) this.syncViewUI();
    return result;
  }

  /**
   * Faint strips of the neighbouring stands' soil past both ends of the flat
   * transect, sampled from the shared regional soil. A child of the soil group,
   * so it shows, hides and disposes with the transect it borders.
   */
  private attachEdgeSoil(): void {
    const standId = this.match.activeStandId;
    const plane = this.match.transectPlane(standId);
    const site = this.region.stands[standId];
    if (!plane || !site) return;
    const strips = buildEdgeSoil({
      west: site.sx > 0,
      east: site.sx < this.region.cols - 1,
      sample: (column, depthCm) => {
        const x = plane.originX + column + 0.5;
        const y = plane.fixedY;
        if (standIdAt(this.region, x, y) === null) return null;
        const sample = this.match.soil.sample(x, y, elevationAtDepthCm(this.region, x, y, depthCm));
        const m = sample.material;
        return {
          stratum: m.stratum, water: m.water, organic: m.organic, nitrogen: m.nitrogen,
          occupancy: m.occupancy, stream: m.stream, saturation: sample.saturation,
        };
      },
    });
    this.soil.group.add(strips);
  }

  /**
   * Direct the running colony through a stand edge and open its real sections.
   * Reached by a grow order placed in the neighbour's soil past the transect's
   * end; the edge is a seam, not a separate action.
   */
  growAcrossStand(direction?: CrossingDirection): { ok: boolean; message: string } {
    const selected = this.selectedStandId ?? this.match.activeStandId;
    if (!this.match.stands[selected]?.sim.hasColony) {
      return { ok: false, message: 'Choose a stand that holds your colony before directing a crossing.' };
    }
    const reachedBody = this.match.spatialForStand(selected);
    const independent = this.match.spatialColonies.has(selected) || this.match.stands[selected].arrivals.length > 0;
    if (selected !== this.match.activeStandId && independent) this.enterStand(selected);
    let result: { ok: boolean; message: string };
    try {
      if (reachedBody && !independent) {
        this.match.spatial = reachedBody;
        result = reachedBody.orderAcross();
      } else {
        result = this.match.growAcross(direction);
      }
    } catch (error) {
      return { ok: false, message: `No passable stand edge was found: ${String(error)}` };
    }
    if (!result.ok || !this.match.spatial) return result;
    this.attachSpatialFixture(this.match.spatial);
    const opened = this.openSection(selected);
    if (opened.ok) this.syncViewUI();
    return { ok: true, message: `${result.message} ${opened.message}` };
  }

  /** Re-read the colony: new growth, a cut strand, a stand just reached. */
  refreshSpatialViews(): void {
    this.refreshReveal();
    if (!this.spatial) return;
    this.refreshSectionClip();
  }

  private ensureReveal(): NetworkReveal {
    if (!this.reveal) {
      this.reveal = new NetworkReveal(this.region, (point) => this.regionToScenePoint(point));
      this.reveal.group.position.set(this.sceneShift.x, 0, this.sceneShift.z);
      this.stage.scene.add(this.reveal.group);
    }
    return this.reveal;
  }

  /** Project every colony of the player's through the forest floor. */
  private refreshReveal(): void {
    if (!this.reveal) return;
    const camera = this.stage.rig.camera;
    camera.updateMatrixWorld();
    this.reveal.setEdges(this.allColonyEdges(), camera.position.distanceTo(this.stage.rig.target));
  }

  /**
   * The strands of every colony the player has: each regional body, and the
   * founding colony while it still grows in its own transect (its nodes carry
   * their regional XYZ from the first tick). A bench fixture that is not part
   * of the match is included as well. Keys carry the colony id, so no two
   * colonies' strands can be confused.
   */
  private allColonyEdges(): RevealEdge[] {
    const edges: RevealEdge[] = [];
    const bodies = new Set<SpatialFixture>();
    for (const stand of this.match.stands) {
      if (!stand.sim.hasColony || stand.fusedInto !== undefined) continue;
      const body = this.match.spatialColonies.get(stand.site.id);
      if (body) {
        bodies.add(body);
        edges.push(...(body.colonyEdges() as RevealEdge[]));
        continue;
      }
      if (this.match.spatialForStand(stand.site.id)) continue; // reached by another body's growth
      const net = stand.sim.player;
      if (net.extinct) continue;
      for (const node of net.nodes) {
        const parent = node.parent >= 0 ? net.nodes[node.parent] : undefined;
        if (!parent || !node.spatial || !parent.spatial) continue;
        edges.push({
          key: `${net.colonyId ?? `local-${stand.site.id}`}:${parent.id}-${node.id}`,
          parent: parent.id,
          child: node.id,
          from: parent.spatial,
          to: node.spatial,
          thickness: node.thickness,
          reinforced: node.reinforced,
          connected: node.alive && parent.alive && node.connected && parent.connected,
          standId: node.standId < 0 ? stand.site.id : node.standId,
          parentStandId: parent.standId < 0 ? stand.site.id : parent.standId,
        });
      }
    }
    if (this.spatial && this.spatial !== this.emptySectionViewer && !bodies.has(this.spatial)) {
      edges.push(...(this.spatial.colonyEdges() as RevealEdge[]));
    }
    return edges;
  }

  /** Stands where the player has a colony: founded, grown into, or reached by spores. */
  colonyStands(): Array<{ standId: number; how: 'home' | 'grown' | 'spores' }> {
    const out: Array<{ standId: number; how: 'home' | 'grown' | 'spores' }> = [];
    for (const stand of this.match.stands) {
      if (!stand.sim.hasColony) continue;
      const id = stand.site.id;
      const how = id === this.region.foundingStand ? 'home' : stand.arrivals.length > 0 ? 'spores' : 'grown';
      out.push({ standId: id, how });
    }
    return out;
  }

  /**
   * Go below a colonized stand: attach the body that carries it and descend
   * into its soil, framed on the colony.
   */
  goToColony(standId: number): { ok: boolean; message: string } {
    const stand = this.match.stands[standId];
    if (!stand?.sim.hasColony) return { ok: false, message: 'No colony of yours grows there.' };
    this.awaken();
    // A colony with its own body is its own stand: rebind the local views to
    // it (as the section stand selector does), so the rings, orders and
    // captions all speak of the colony being visited.
    if (this.match.spatialColonies.has(standId) && standId !== this.match.activeStandId) {
      if (this.stage.rig.view === 'forest') this.captureForestContext();
      if (this.stage.rig.view !== 'forest') this.stage.rig.setView('forest', true);
      this.enterStand(standId);
    }
    const body = this.match.spatialColonies.get(standId) ?? this.match.spatialForStand(standId);
    if (body && body !== this.spatial) {
      this.match.spatial = body;
      this.attachSpatialFixture(body);
    }
    this.selectedStandId = standId;
    for (const surface of this.surfaces) if (surface) surface.selectedId = null;
    if (body) {
      if (this.stage.rig.view === 'forest' && !this.forestContext) this.captureForestContext();
      const opened = this.openSection(standId);
      if (opened.ok && this.stage.rig.view !== 'underground') this.setView('underground');
      const select = document.querySelector<HTMLSelectElement>('#section-stand');
      if (select) select.value = String(standId);
      this.syncViewUI();
      return opened;
    }
    // A colony still in its own transect: rise if needed, enter it, go below.
    this.section = null;
    this.sectionView?.setSection(null);
    if (this.stage.rig.view !== 'forest') this.stage.rig.setView('forest', true);
    this.descend();
    const site = this.region.stands[standId];
    return { ok: true, message: `Below stand ${standId + 1} · ${site ? COMMUNITY_LABEL[site.community] : ''}.` };
  }

  /** Keep the colony tiles in the side panel matched to the colonies that exist. */
  private syncColonyTiles(): void {
    const list = document.querySelector<HTMLElement>('.colony-tile-list');
    if (!list) return;
    const colonies = this.colonyStands();
    const current = this.section?.spec.standId ?? this.match.activeStandId;
    const signature = colonies.map((c) => `${c.standId}${c.how}`).join(',') + `|${current}|${this.stage.rig.view}`;
    if (list.dataset.signature === signature) return;
    list.dataset.signature = signature;
    const where = { home: 'founded here', grown: 'grown into', spores: 'spores landed' } as const;
    list.replaceChildren(...colonies.map(({ standId, how }) => {
      const site = this.region.stands[standId]!;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'colony-tile';
      button.dataset.stand = String(standId);
      button.dataset.how = how;
      if (standId === current && this.stage.rig.view === 'underground') button.setAttribute('aria-current', 'true');
      button.setAttribute('aria-label', `Go below stand ${standId + 1}, ${COMMUNITY_LABEL[site.community]} (${where[how]})`);
      button.innerHTML = `<span class="colony-tile-number">${standId + 1}</span><span class="colony-tile-name">${COMMUNITY_LABEL[site.community]}</span><small>${where[how]}</small>`;
      button.addEventListener('click', () => this.ui.setNote(this.goToColony(standId).message));
      return button;
    }));
  }

  private refreshSectionClip(): void {
    if (!this.spatial || !this.sectionView || !this.section) return;
    const clip = clipEdges(this.spatial.region, this.section.spec, this.spatial.colonyEdges() as RevealEdge[]);
    const enemy = clipEdges(this.spatial.region, this.section.spec, this.enemyEdges());
    this.sectionView.setSection(this.section.spec);
    this.sectionView.sync(clip, enemy, this.spatial.groupNodeIds?.(this.selectedGroup));
    this.reveal?.setSlice(this.section.spec);
  }

  /** The colonies toggle: every colony projected through the floor, off by default. */
  setReveal(enabled: boolean): void {
    this.revealEnabled = enabled && this.colonyStands().length > 0;
    if (this.revealEnabled) {
      this.ensureReveal();
      this.refreshReveal();
    }
    this.reveal?.setVisible(this.revealEnabled);
    const button = document.querySelector<HTMLButtonElement>('#forest-reveal');
    if (button) button.setAttribute('aria-pressed', String(this.revealEnabled));
  }

  toggleReveal(): boolean {
    this.setReveal(!this.revealEnabled);
    return this.revealEnabled;
  }

  get revealOn(): boolean {
    return this.revealEnabled;
  }

  /** Descend into the first section available to this spatial body. */
  openFirstSection(): { ok: boolean; message: string } {
    if (!this.spatial) return { ok: false, message: 'No spatial colony in this match.' };
    const stand = this.spatial.reachedStandIds()[0] ?? this.spatial.originStandId;
    return this.openSection(stand);
  }

  /** The opening section for a stand: through a strand there, else its middle. */
  private openingSection(standId: number, sections: readonly SectionSpec[]): SectionSpec | null {
    if (!this.spatial) return null;
    const forStand = sections.filter((spec) => spec.standId === standId);
    if (forStand.length === 0) return null;
    const edges = this.spatial.colonyEdges();
    const inStand = edges.filter((edge) => edge.standId === standId || edge.parentStandId === standId);
    if (inStand.length > 0) {
      // The plane the colony's own strands sit in, so the opening section is
      // not an empty one when there is something to show.
      // A strand counts in every slab that holds it, so an east-west colony is
      // not credited to whichever north-south slab happens to be listed first.
      // Ties go to the colony's own growth direction.
      const counts = new Map<string, number>();
      for (const edge of inStand) {
        for (const spec of forStand) {
          if (sectionContains(this.spatial.region, spec, edge.to)) counts.set(spec.id, (counts.get(spec.id) ?? 0) + 1);
        }
      }
      const growth = this.spatial.plane?.along;
      let best: SectionSpec | null = null;
      let bestScore = 0;
      for (const spec of forStand) {
        const count = counts.get(spec.id) ?? 0;
        const score = count + (count > 0 && spec.plane.along === growth ? 0.5 : 0);
        if (score > bestScore) {
          bestScore = score;
          best = spec;
        }
      }
      if (best) return best;
    }
    return forStand[Math.floor(forStand.length / 2)] ?? null;
  }

  /**
   * Open a section: the one asked for, else the one through the last strand
   * picked, else an opening plane in that stand.
   */
  openSection(standId?: number, sectionId?: string): { ok: boolean; message: string } {
    if (!this.spatial) return { ok: false, message: 'No spatial colony in this match.' };
    const browsable = this.match.spatialColonies.size > 0
      ? this.match.stands.map((stand) => stand.site.id)
      : this.spatial.browsableStandIds();
    const targetStand = standId ?? this.spatial.reachedStandIds()[0] ?? this.spatial.originStandId;
    if (!browsable.includes(targetStand)) {
      return { ok: false, message: `Stand ${targetStand + 1} has not been reached or sensed.` };
    }
    const sections = browsableSections(this.spatial.region, browsable);
    const forStand = sections.filter((spec) => spec.standId === targetStand);
    if (forStand.length === 0) return { ok: false, message: 'That stand has no sections.' };
    let spec: SectionSpec | null = sectionId
      ? forStand.find((candidate) => candidate.id === sectionId) ?? null
      : null;
    if (!spec && this.lastStrandPick) {
      const edge = this.spatial.colonyEdges().find((candidate) => candidate.key === this.lastStrandPick?.key);
      if (edge) spec = sectionForPoint(this.spatial.region, forStand, edge.to);
    }
    if (!spec) spec = this.openingSection(targetStand, sections);
    if (!spec) return { ok: false, message: 'No section there.' };

    // Remember where the player stood below before moving, so flipping back
    // returns to the same view of the same section.
    if (this.section) this.sectionPoses.set(this.section.spec.id, this.stage.rig.capturePose());
    // Descending is a real descent: keep the forest picture for the way back.
    if (this.stage.rig.view === 'forest') this.captureForestContext();
    this.section = { spec, sections };
    this.sectionView?.setSection(spec);
    this.refreshSectionClip();
    this.snapToSection(spec);
    this.selectVisibleEdge(spec);
    this.updateSectionStatus();
    return { ok: true, message: this.sectionReadout() };
  }

  /**
   * Keep the selected strand one the open section can actually show.
   *
   * The selection is what Follow follows and what the readout names, so a
   * strand that is not in this slab would make both point at nothing visible.
   */
  private selectVisibleEdge(spec: SectionSpec): void {
    if (!this.spatial) return;
    const edges = this.spatial.colonyEdges();
    const clip = clipEdges(this.spatial.region, spec, edges as RevealEdge[]);
    if (this.selectedEdgeKey && clip.visible.some((edge) => edge.key === this.selectedEdgeKey)) return;
    this.selectedEdgeKey = clip.visible[0]?.key ?? edges[0]?.key ?? null;
  }

  /** Where the forest was left, in absolute coordinates plus its selection. */
  private captureForestContext(): void {
    const pose = this.stage.rig.capturePose();
    const region = this.sceneToRegion(pose.sceneX, pose.sceneZ);
    this.forestContext = {
      regionX: region.x,
      regionY: region.y,
      targetY: pose.sceneY,
      distance: pose.distance,
      azimuth: pose.azimuth,
      elevation: pose.elevation,
      autoFraming: pose.autoFraming,
      standId: this.selectedStandId,
      treeId: this.selectedStandId === null ? null : this.surfaces[this.selectedStandId]?.selectedId ?? null,
      reveal: this.revealEnabled,
    };
  }

  /** Put the section's camera on its plane, square on to it. */
  private snapToSection(spec: SectionSpec): void {
    const stored = this.sectionPoses.get(spec.id);
    if (stored) {
      this.stage.rig.restoreSectionPose(stored);
      return;
    }
    if (!this.spatial) return;
    const anchor = sectionAnchor(this.spatial.region, spec);
    // Frame what this section actually holds. A stand is 136 units wide and the
    // colony may occupy a third of that; fitting the stand would leave the
    // network a speck, so the clipped strands decide the framing and the stand
    // is only the fallback for an empty section.
    const clip = clipEdges(this.spatial.region, spec, this.spatial.colonyEdges() as RevealEdge[]);
    const alongOf = (point: { x: number; y: number; z: number }): number =>
      spec.plane.along === 'x' ? point.x : point.y;
    let alongMin = spec.alongFrom;
    let alongMax = spec.alongTo;
    let depth = spec.depthToCm / GRID.cmPerRow;
    let depthFromCm = spec.depthFromCm;
    let depthToCm = spec.depthToCm;
    let middle = anchor;
    if (clip.visible.length > 0) {
      const alongs = clip.visible.flatMap((edge) => [alongOf(edge.from), alongOf(edge.to)]);
      const depths = clip.visible.flatMap((edge) => [edge.depthFromCm, edge.depthToCm]);
      // A minimum window keeps a thin band of strands from filling the screen
      // edge to edge with a single line.
      const alongSpan = Math.max(48, Math.max(...alongs) - Math.min(...alongs) + 16);
      const depthSpan = Math.max(26, Math.max(...depths) - Math.min(...depths) + 12);
      const alongMid0 = (Math.max(...alongs) + Math.min(...alongs)) / 2;
      alongMin = alongMid0 - alongSpan / 2;
      alongMax = alongMid0 + alongSpan / 2;
      const depthMid = (Math.max(...depths) + Math.min(...depths)) / 2;
      depthFromCm = Math.max(spec.depthFromCm, depthMid - depthSpan / 2);
      depthToCm = Math.min(spec.depthToCm, depthMid + depthSpan / 2);
      depth = (depthToCm - depthFromCm) / GRID.cmPerRow;
      const midDepth = (Math.max(...depths) + Math.min(...depths)) / 2;
      const point = spec.plane.along === 'x'
        ? { x: alongMid0, y: spec.plane.fixed }
        : { x: spec.plane.fixed, y: alongMid0 };
      middle = {
        x: point.x,
        y: point.y,
        z: this.region.heightAt(point.x, point.y) - midDepth / GRID.cmPerRow,
      };
    }
    this.sectionView?.setWindow({ alongFrom: alongMin, alongTo: alongMax, depthFromCm, depthToCm });
    const target = this.regionToScenePoint(middle);
    const extent = Math.max(6, alongMax - alongMin);
    const halfTan = Math.tan((this.stage.rig.camera.fov * Math.PI) / 180 / 2);
    const aspect = Math.max(0.5, this.stage.rig.camera.aspect);
    const distance = THREE.MathUtils.clamp(
      Math.max(extent / (2 * halfTan * aspect), depth / (2 * halfTan)) * 1.35,
      // Close enough to read a thin band of strands, far enough out that the
      // camera never ends up inside the strands it is looking at.
      90,
      420
    );
    this.stage.rig.restoreSectionPose({
      sceneX: target.x,
      sceneY: target.y,
      sceneZ: target.z,
      distance,
      // Square on to the plane: an east-west section is looked at from the
      // north, a north-south one from the west.
      azimuth: spec.plane.along === 'x' ? Math.PI : -Math.PI / 2,
      elevation: 0.12,
      autoFraming: false,
    });
  }

  /** Previous / next section, within the family the player is looking at. */
  stepSection(delta: number): { ok: boolean; message: string } {
    if (!this.spatial || !this.section) return { ok: false, message: 'No section is open.' };
    const next = stepSection(this.section.sections, this.section.spec, delta);
    if (next.id === this.section.spec.id) {
      return { ok: false, message: delta > 0 ? 'This is the last section.' : 'This is the first section.' };
    }
    this.sectionPoses.set(this.section.spec.id, this.stage.rig.capturePose());
    this.section = { spec: next, sections: this.section.sections };
    this.sectionPoses.delete(next.id);
    this.sectionView?.setSection(next);
    this.refreshSectionClip();
    this.snapToSection(next);
    this.selectVisibleEdge(next);
    this.updateSectionStatus();
    return { ok: true, message: this.sectionReadout() };
  }

  /** Flip to the other family, keeping the same place in the stand. */
  flipSectionAxis(): { ok: boolean; message: string } {
    if (!this.spatial || !this.section) return { ok: false, message: 'No section is open.' };
    const next = flipSection(this.spatial.region, this.section.sections, this.section.spec);
    if (next.id === this.section.spec.id) return { ok: false, message: 'No section to flip to.' };
    this.sectionPoses.set(this.section.spec.id, this.stage.rig.capturePose());
    this.section = { spec: next, sections: this.section.sections };
    this.sectionPoses.delete(next.id);
    this.sectionView?.setSection(next);
    this.refreshSectionClip();
    this.snapToSection(next);
    this.selectVisibleEdge(next);
    this.updateSectionStatus();
    return { ok: true, message: this.sectionReadout() };
  }

  /**
   * Follow the selected strand into the section that holds its far end.
   *
   * Works in either direction: a strand that crosses the seam can be followed
   * from the parent's stand into the child's, or back again.
   */
  followConnection(): { ok: boolean; message: string } {
    if (!this.spatial || !this.section) return { ok: false, message: 'No section is open.' };
    const edges = this.spatial.colonyEdges();
    const edge = edges.find((candidate) => candidate.key === this.selectedEdgeKey) ?? edges[0];
    if (!edge) return { ok: false, message: 'The colony has no strands yet.' };
    const fromStand = this.section.spec.standId;
    const targetStand = edge.standId === fromStand ? edge.parentStandId : edge.standId;
    this.selectedEdgeKey = edge.key;
    const spec = this.sectionHolding(edge as RevealEdge, targetStand);
    const result = this.openSection(targetStand, spec?.id);
    if (!result.ok) return result;
    return { ok: true, message: `Following the strand into stand ${targetStand + 1}. ${this.sectionReadout()}` };
  }

  /** Ask the nearest real partner in the open stand for a bond, or grow to it. */
  seekSectionRoot(): { ok: boolean; message: string } {
    const spatial = this.match.spatial;
    if (!spatial || !this.section) return { ok: false, message: 'Open a section of the regional colony first.' };
    const candidate = spatial.nearestUnbondedTip(this.section.spec.standId);
    if (!candidate) return { ok: false, message: 'No unbonded root in this reached stand.' };
    const result = candidate.distanceCm <= 3.5 * GRID.cmPerRow
      ? spatial.bond(candidate.treeRef, candidate.tipId)
      : spatial.orderTowardTip(candidate.treeRef, candidate.tipId);
    if (result.ok) this.refreshSpatialViews();
    return result;
  }

  /** All nine soil slices can be inspected before a colony reaches them. */
  private ensureSectionViewer(): void {
    if (!this.emptySectionViewer) {
      const match = this.match;
      this.emptySectionViewer = {
        region: this.region,
        originStandId: this.region.foundingStand,
        get time() { return match.time; },
        colonyEdges: () => [],
        reachedStandIds: () => [],
        browsableStandIds: () => match.stands.map((stand) => stand.site.id),
        standFrame: (id) => standFrameOf(this.region, id),
        orderAcross: () => ({ ok: false, message: 'No colony is growing from this stand.' }),
        step: () => {},
        report: () => ['Uncolonized regional soil'],
        hash: () => 'uncolonized-sections',
      };
    }
    this.attachSpatialFixture(this.emptySectionViewer);
  }

  /** The section of a stand that holds one end of a strand. */
  private sectionHolding(edge: RevealEdge, standId: number): SectionSpec | null {
    if (!this.spatial) return null;
    const point = edge.standId === standId ? edge.to : edge.from;
    const sections = this.section?.sections ?? browsableSections(this.spatial.region, this.spatial.browsableStandIds());
    const forStand = sections.filter((spec) => spec.standId === standId);
    return sectionForPoint(this.spatial.region, forStand, point);
  }

  /** Back to the forest, exactly where and on what the player left it. */
  returnToForest(): { ok: boolean; message: string } {
    // A section reached by growing across from the transect has no remembered
    // forest picture of its own: surface over the stand being browsed instead.
    if (!this.forestContext) {
      if (this.section) return this.surfaceHere();
      this.sectionView?.setSection(null);
      return { ok: false, message: 'Nothing to return to.' };
    }
    if (this.section) this.sectionPoses.set(this.section.spec.id, this.stage.rig.capturePose());
    const context = this.forestContext;
    const scene = this.regionToScene(context.regionX, context.regionY);
    this.stage.rig.restoreForestPose({
      sceneX: scene.x + this.sceneShift.x,
      sceneY: context.targetY,
      sceneZ: scene.z + this.sceneShift.z,
      distance: context.distance,
      azimuth: context.azimuth,
      elevation: context.elevation,
      autoFraming: context.autoFraming,
    });
    // Selection and reveal state come back with the picture.
    this.selectedStandId = context.standId;
    for (const surface of this.surfaces) surface.selectedId = surface.standId === context.standId ? context.treeId : null;
    this.setReveal(context.reveal);
    this.updateTreeNote();
    this.syncSectionUI();
    this.syncViewUI();
    return { ok: true, message: `Back above stand ${(context.standId ?? this.match.activeStandId) + 1}.` };
  }

  /** Emerge over the stand being browsed, keeping its section remembered. */
  surfaceHere(): { ok: boolean; message: string } {
    if (!this.spatial || !this.section) return { ok: false, message: 'No section is open.' };
    const standId = this.section.spec.standId;
    const surface = this.surfaces[standId];
    if (surface) {
      this.selectedStandId = standId;
      this.stage.rig.snapForest(
        surface.group.position.x,
        surface.group.position.z - TILE_SIZE / 2,
        Math.max(160, this.stage.rig.goalDistance)
      );
    }
    this.sectionView?.setSection(null);
    this.syncSectionUI();
    return { ok: true, message: `Above stand ${standId + 1}. Its section stays remembered.` };
  }

  private updateSectionStatus(): void {
    if (!this.spatial || !this.section) return;
    const status = document.querySelector('#view-status');
    if (status) status.textContent = this.sectionReadout();
    this.syncSectionUI();
  }

  /**
   * What a section replaces: the match's own underground views, the region's
   * surfaces and its water. They belong to the stand above, not to the plane
   * being inspected, so they leave while a section is open.
   */
  private sectionHiddenGroups(): THREE.Object3D[] {
    return [
      this.forest.group,
      this.living.group,
      this.groundwater.group,
      this.playerMesh.group,
      this.rivalMesh.group,
      this.playerMotes.points,
      this.rivalMotes.points,
      this.stream.group,
      this.soil.group,
      this.fruiting.group,
      ...this.surfaces.filter(Boolean).map((surface) => surface.group),
    ];
  }

  /** One line naming the section and what is in it. */
  sectionReadout(): string {
    if (!this.spatial || !this.section) return 'No section';
    const label = sectionLabel(this.spatial.region, this.section.spec, COMMUNITY_LABEL);
    const order = sectionOrder(this.section.sections, this.section.spec);
    const clip = clipEdges(this.spatial.region, this.section.spec, this.spatial.colonyEdges() as RevealEdge[]);
    const empty = clip.visible.length === 0 ? ' \u00b7 no network in this section' : '';
    return `${label} \u00b7 ${order.index + 1} of ${order.count} \u00b7 ${clip.visible.length} strands${empty}`;
  }

  /** What the reveal is drawing, and what a click last landed on. */
  revealReport(): {
    enabled: boolean;
    strands: number;
    draws: number;
    slice: string | null;
    pick: RevealPickInfo | null;
  } {
    const report = this.reveal?.report() ?? { strands: 0, draws: 0, slice: null };
    return {
      enabled: this.revealEnabled,
      strands: report.strands,
      draws: report.draws,
      slice: report.slice,
      pick: this.lastStrandPick,
    };
  }

  sectionReport(): {
    open: boolean;
    id: string | null;
    strands: number;
    marks: number;
    label: string;
    edge: string | null;
  } {
    const report = this.sectionView?.report() ?? { section: null, strands: 0, marks: 0, visible: false };
    return {
      open: this.section !== null,
      id: report.section,
      strands: report.strands,
      marks: report.marks,
      label: this.sectionReadout(),
      edge: this.selectedEdgeKey,
    };
  }

  /**
   * One strand's coordinates in both views, for the checks that prove the
   * projection and the section are the same edge.
   */
  strandCheck(key: string): {
    projected: [{ x: number; y: number; z: number }, { x: number; y: number; z: number }] | null;
    section: { from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number } } | null;
    depthCm: number | null;
    standId: number | null;
    parentStandId: number | null;
  } {
    const empty = { projected: null, section: null, depthCm: null, standId: null, parentStandId: null };
    if (!this.spatial) return empty;
    const edge = this.spatial.colonyEdges().find((candidate) => candidate.key === key);
    if (!edge) return empty;
    const strand = this.reveal?.strandFor(key) ?? null;
    const clip = this.section
      ? clipEdges(this.spatial.region, this.section.spec, [edge as RevealEdge]).visible[0] ?? null
      : null;
    return {
      projected: strand
        ? [
            strand.points[0] as { x: number; y: number; z: number },
            strand.points[strand.points.length - 1] as { x: number; y: number; z: number },
          ]
        : null,
      section: clip ? { from: clip.from, to: clip.to } : null,
      depthCm: strand ? strand.depthsCm[Math.floor(strand.depthsCm.length / 2)] ?? null : null,
      standId: edge.standId,
      parentStandId: edge.parentStandId,
    };
  }

  /**
   * A click in the forest among the projected strands.
   *
   * Picking is a screen-space search over the projection, never a raycast
   * against whichever line mesh happens to be in front, and a stack of strands
   * under one click is reported rather than guessed at.
   */
  private pickStrandAt(clientX: number, clientY: number): boolean {
    if (!this.reveal || !this.revealEnabled) return false;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = {
      x: ((clientX - rect.left) / rect.width) * 2 - 1,
      y: 1 - ((clientY - rect.top) / rect.height) * 2,
    };
    const camera = this.stage.rig.camera;
    camera.updateMatrixWorld();
    // The reveal converts its own region-space samples to scene space, so this
    // projector takes scene points: converting twice would put every strand
    // somewhere it is not drawn.
    const project = (scenePoint: { x: number; y: number; z: number }) => {
      const projected = new THREE.Vector3(scenePoint.x, scenePoint.y, scenePoint.z).project(camera);
      if (projected.z > 1) return null;
      return { x: projected.x, y: projected.y };
    };
    const pick = this.reveal.pick(project, ndc, REVEAL_PICK_RADIUS);
    if (!pick) {
      this.lastStrandPick = null;
      return false;
    }
    this.lastStrandPick = {
      key: pick.key,
      child: pick.child,
      parent: pick.parent,
      depthCm: pick.depthCm,
      alternatives: pick.alternatives,
      connected: pick.connected,
    };
    this.selectedEdgeKey = pick.key;
    // The strand may belong to any of the player's colonies: attach its body.
    let owner: SpatialFixture | null = this.spatial?.colonyEdges().some((candidate) => candidate.key === pick.key) ? this.spatial : null;
    if (!owner) {
      for (const body of this.match.spatialColonies.values()) {
        if (body.colonyEdges().some((candidate) => candidate.key === pick.key)) {
          owner = body;
          this.match.spatial = body;
          this.attachSpatialFixture(body);
          break;
        }
      }
    }
    if (!owner) {
      // A founding colony still in its own transect: go below its stand.
      const strand = this.reveal.strandFor(pick.key);
      if (strand) this.goToColony(strand.standId);
      return true;
    }
    this.selectedEdgeKey = pick.key;
    // Clicking a projected strand opens the exact section through it.
    const edge = owner.colonyEdges().find((candidate) => candidate.key === pick.key);
    if (edge) {
      const spec = this.sectionHolding(edge as RevealEdge, edge.standId);
      this.openSection(edge.standId, spec?.id);
    }
    return true;
  }

  /**
   * Forest bench: dress the region, leave it bare, or change its density band.
   *
   * Purely presentational. Nothing here touches the simulation, and turning the
   * scenery off does not change which trees exist, which are selectable or what
   * the selector lists.
   */
  setLabDressing(enabled: boolean): void {
    this.dressing.setVisible(enabled);
  }

  setLabDressingBand(band: DressingBand): void {
    this.dressingBand = band;
    this.dressing.build(band);
  }

  /**
   * Forest bench: isolate one community's stand, or the whole region.
   *
   * The fixture exists so a single community can be judged on its own without
   * hiding the fact that it came out of one region-wide layout.
   */
  focusLabCommunity(community: string | null): { ok: boolean; standId: number | null; message: string } {
    if (community === null || community === '') {
      this.dressing.setFocus(null);
      return { ok: true, standId: null, message: 'Whole region' };
    }
    const stand = this.region.stands.find((site) => site.community === community);
    if (!stand) return { ok: false, standId: null, message: `No ${community} stand in this seed` };
    this.dressing.setFocus(stand.id);
    const surface = this.surfaces[stand.id];
    // Frame that stand's own ground, in the region's rebased frame. The fixture
    // snaps rather than gliding so the same command always gives the same pose.
    if (surface) {
      this.selectedStandId = stand.id;
      for (const other of this.surfaces) other.selectedId = null;
      this.stage.rig.snapForest(surface.group.position.x, surface.group.position.z - TILE_SIZE / 2, 210);
    }
    return {
      ok: true,
      standId: stand.id,
      message: `${COMMUNITY_LABEL[stand.community]} Â· stand ${stand.id + 1}`,
    };
  }

  /** Communities this seed actually contains, for the bench's selector. */
  labCommunities(): Array<{ id: string; label: string; standId: number }> {
    const seen = new Map<string, number>();
    for (const site of this.region.stands) if (!seen.has(site.community)) seen.set(site.community, site.id);
    return [...seen].map(([id, standId]) => ({
      id,
      label: COMMUNITY_LABEL[id as keyof typeof COMMUNITY_LABEL],
      standId,
    }));
  }

  private stewardTick(): void {
    for (const tree of this.sim.world.trees) {
      if (tree.dead) continue;
      for (const tip of tree.rootTips) {
        if (tip.bondedTo !== null) continue;
        if (this.sim.orderBond(tip.gx, tip.gy).ok) return;
      }
    }
  }

  start(): void {
    this.lastFrame = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Halt the render loop. Used when the tab is hidden, so we stop simulating. */
  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /**
   * A read-only snapshot of what the camera and the soil's overlays are doing.
   *
   * The browser checks in `tools/` use this to verify that a crossing takes the
   * same wall-clock time whatever the frame rate, that nothing pops in or out
   * mid-crossing, and that a viewport change re-frames the active view. It
   * reports the very state the frame loop acts on rather than a parallel copy.
   */
  viewReport(): {
    view: WorldView;
    crossing: boolean;
    blend: number;
    overlay: number;
    strandOpacity: number;
    distance: number;
    goalDistance: number;
    crossingElapsed: number;
    crossingDuration: number;
    aspect: number;
    autoFraming: boolean;
    mount: { halfWidth: number; halfHeight: number };
    target: { x: number; y: number; z: number };
  } {
    return {
      view: this.stage.rig.view,
      crossing: this.stage.rig.transitioning,
      blend: this.stage.rig.surfaceBlend,
      overlay: this.overlays.opacity,
      // The player's strands are the readout for the fade: their material is
      // opaque at rest, so its opacity is exactly how much of the network is
      // still on screen.
      strandOpacity: (this.playerMesh.mesh.material as THREE.Material).opacity,
      distance: this.stage.rig.distance,
      goalDistance: this.stage.rig.goalDistance,
      crossingElapsed: this.stage.rig.crossingProgress.elapsed,
      crossingDuration: this.stage.rig.crossingProgress.duration,
      aspect: this.stage.rig.camera.aspect,
      autoFraming: this.stage.rig.autoFraming,
      mount: { halfWidth: GRID.cols / 2, halfHeight: GRID.rows / 2 },
      target: { x: this.stage.rig.target.x, y: this.stage.rig.target.y, z: this.stage.rig.target.z },
    };
  }

  /**
   * The harness-facing rendering report: preset, backend, drawing-buffer size
   * and the region the renderer is currently presenting.
   */
  renderReport(): {
    preset: string;
    backend: string;
    software: boolean;
    pixelRatio: number;
    viewport: { width: number; height: number };
    canvasCss: { width: number; height: number };
    drawingBuffer: { width: number; height: number };
    antialias: boolean;
    shadowMaps: boolean;
    groundShadows: boolean;
    postprocessing: boolean;
    bloom: boolean;
    stands: number;
    trees: number;
    /** Authored tiers in use across the region, finest first. */
    lodTiers: number[];
    /** Trees wearing an authored model, and the tier files that have loaded. */
    lodDressed: number;
    assets: { ready: boolean; loaded: number; expected: number; pending: number; failures: number };
    /** The regional survey layer's own state, for the browser checks. */
    survey: { open: boolean; held: number; contiguous: boolean; selected: number | null };
    /** Water: the drawn stream above ground and the channel below it. */
    water: { ribbon: number; stands: number[]; channel: number; tableCm: number; width: number; centre: number };
    selectedStandId: number | null;
    selectedTreeId: number | null;
    simSeconds: number;
    batching: ReturnType<TreeBatches['report']>;
      dressing: ReturnType<ForestDressing['report']>;
    /** The player's own fruiting bodies above ground. */
    fruiting: ReturnType<FruitingView['report']>;
    storm: ReturnType<StormView['report']>;
    fire: ReturnType<FireView['report']>;
    drought: ReturnType<DroughtView['report']> & { severity: number };
    flood: ReturnType<FloodView['report']> & { level: number; underground: ReturnType<UndergroundWeather['report']> | null };
    /** What the soil transect is standing, and how much of it is authored. */
    living: ReturnType<LivingView['report']>;
  } {
    const surfaces = this.surfaces.filter((surface): surface is SurfaceForest => Boolean(surface));
    const lodTiers = [0, 0, 0];
    for (const surface of surfaces) {
      surface.lodTiers().forEach((count, tier) => {
        lodTiers[tier] = (lodTiers[tier] ?? 0) + count;
      });
    }
    const survey = buildSurvey(this.match);
    return {
      ...this.stage.qualityReport(),
      stands: surfaces.length,
      trees: surfaces.reduce((total, surface) => total + surface.trees.length, 0),
      lodTiers,
      lodDressed: lodTiers.reduce((total, count) => total + count, 0),
      assets: {
        ready: this.assets.ready,
        loaded: this.assets.size,
        expected: this.assets.expected,
        pending: this.assets.loading,
        failures: this.assets.failures.length,
      },
      survey: {
        open: this.survey.open,
        held: survey.held,
        contiguous: survey.contiguous,
        selected: this.selectedStandId,
      },
      water: {
        ...this.stream.report(),
        ...this.groundwater.report(),
      },
      selectedStandId: this.selectedStandId,
      selectedTreeId: this.selectedStandId === null ? null : this.surfaces[this.selectedStandId]?.selectedId ?? null,
      simSeconds: Math.round(this.sim.time),
      batching: this.treeBatches.report(),
      dressing: this.dressing.report(),
      fruiting: this.fruiting.report(),
      storm: this.stormView.report(),
      fire: this.fireView.report(),
      drought: { ...this.droughtView.report(), severity: this.droughtShown },
      flood: { ...this.floodView.report(), level: this.match.flood.level, underground: this.undergroundWeather?.report() ?? null },
      living: this.living.report(),
    };
  }

  private frame(now: number, draw = true): void {
    // Two clocks, deliberately. `elapsed` is the real time since the previous
    // frame and drives presentation that must take the same wall-clock time on
    // any machine, such as the crossing between the two views. `dt` is clamped
    // at both ends: the upper bound stops a spiral of death after a long stall;
    // the lower bound matters because requestAnimationFrame reports the frame's
    // start time, which can precede a `performance.now()` taken just before it,
    // and a negative timestep makes the camera's smoothing diverge instead of
    // converge.
    const elapsed = Math.max(0, (now - this.lastFrame) / 1000);
    const dt = Math.min(0.1, elapsed);
    this.lastFrame = now;
    this.stage.rig.update(dt, elapsed);
    this.syncViewUI();

    this.accumulator += dt * this.speed;
    let steps = 0;
    const stepStart = performance.now();
    while (this.accumulator >= FIXED_STEP && steps < 24) {
      this.match.step(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
      steps++;
      // Always one step, then only as many as the frame can afford.
      if (performance.now() - stepStart > STEP_BUDGET_MS) break;
    }
    // Time the CPU could not afford is let go, not banked: banking it would
    // make every later frame run the whole step cap and never recover.
    if (this.accumulator > MAX_CARRY) this.accumulator = MAX_CARRY;
    this.trackPace(dt, steps);
    if (this.spatial && steps > 0) {
      this.spatialRefreshClock += steps * FIXED_STEP;
      if (this.spatialRefreshClock >= 0.25) {
        this.spatialRefreshClock = 0;
        this.refreshSpatialViews();
      }
    }

    this.soil.update(dt);
    this.groundwater.update(elapsed, this.ambientMotion);
    this.updateUndergroundWeather(dt);
    this.playerMesh.sync(this.sim.player);
    this.rivalMesh.sync(this.sim.rival);
    const visualSpeed = Math.max(0.15, this.speed);
    this.playerMotes.update(this.sim.player, dt * visualSpeed);
    this.rivalMotes.update(this.sim.rival, dt * visualSpeed);

    const season = this.sim.season.id;
    if (season !== this.seasonId) {
      this.seasonId = season;
      this.forest.setSeason(season);
    }
    this.forest.update(dt);
    const blend = this.stage.rig.surfaceBlend;
    const storm = this.match.storm;
    if (storm.phase !== 'idle' && storm.initiator !== null) {
      // The vortex turns over the colony that summoned it.
      const site = this.region.stands[storm.initiator];
      const eye = this.regionToScenePoint({ x: site.centreX, y: site.centreY, z: 0 }).sub(this.stormView.group.position);
      this.stormView.setEye(eye.x, eye.z);
    }
    this.strikeWindfalls();
    this.stormView.update(dt, {phase:storm.phase,direction:storm.direction,remaining:this.match.stormRemaining,intensity:this.match.stormIntensity}, !this.ambientMotion, blend);
    this.stage.stormIntensity = this.match.stormIntensity;
    this.stage.lightning = this.stormView.flash;
    this.updateFire(dt, blend);
    this.updateDrought(dt, blend);
    this.updateFlood(dt, blend);
    // Trees lean the storm's way through warning and storm, easing out in recovery.
    const stormLean = storm.phase === 'idle' ? 0 : this.match.stormIntensity;
    const surfaceWind = storm.phase === 'idle'
      ? this.match.wind
      : { direction: storm.direction, strength: this.match.wind.strength, storm: stormLean };
    // The stream lies on the forest floor, so it folds with it during a rise.
    this.stream.update(blend, elapsed, this.ambientMotion);
    // The cutaway has completely closed at the surface endpoint. Its 34k soil
    // particles cannot contribute to the forest image and need no draw call.
    this.soil.group.visible = blend < 1;
    // The soil's contents dissolve through the middle of a crossing rather than
    // switching off at a threshold, so the terrain closes over the network on
    // the way up and they return as it opens on the way down.
    const overlay = 1 - THREE.MathUtils.smoothstep(blend, 0.3, 0.9);
    // Every stand in the region is a window onto the same forest, so every
    // surface is stepped: without this a neighbouring tile draws its floor but
    // its trees stay at their unplaced origin, buried under the slab.
    for (const surface of this.surfaces) {
      if (!surface) continue;
      const standSim = this.match.stands[surface.standId].sim;
      surface.group.visible = blend > 0.01 || surface.standId === this.match.activeStandId;
      surface.update(dt, blend, standSim.season.id, standSim.seasonClock / standSim.season.seconds, !this.ambientMotion, surfaceWind);
      // Which authored tier each tree wears follows its size on screen, so the
      // region can draw nine stands without every one of them paying LOD0.
      surface.updateLod(this.stage.rig.camera);
    }
    this.treeBatches.sync(this.authoredTrees());
    // Background vegetation follows the same fold, season and clock as the
    // trees around it. Its tier is chosen per stand with hysteresis, so it
    // refines when the camera arrives instead of being rebuilt every frame.
    if (this.dressingDirty) {
      this.dressingDirty = false;
      this.dressing.build(this.dressingBand);
    }
    this.dressing.update(dt, {
      blend,
      season: this.sim.season.id,
      progress: this.sim.seasonClock / this.sim.season.seconds,
      reduced: !this.ambientMotion,
      storm: storm.phase === 'idle' ? undefined : { direction: storm.direction, strength: stormLean },
      // Underground, the forest behind the active stand's section stays as backdrop.
      cut: this.surfaces[this.match.activeStandId]?.group.position.z,
    });
    this.dressing.refine(this.stage.rig.camera, dt);
    // The reward above ground: bodies stand only where the simulation recorded
    // a site, and they fold with the floor they stand on.
    this.fruiting.update(dt, this.fruitingSites(), blend > 0.3);
    // The reveal and the section follow the same fold and clock, and are drawn
    // in the region's own coordinates so a rebase moves them with the ground.
    if (this.reveal) {
      const camera = this.stage.rig.camera;
      camera.updateMatrixWorld();
      this.reveal.update(camera.position.distanceTo(this.stage.rig.target), blend, !this.ambientMotion);
    }
    if (this.spatial) this.sectionView?.update(blend, !this.ambientMotion, elapsed);
    // The projection follows growth while it is shown, once a second.
    this.revealClock += dt;
    if (this.revealEnabled && this.revealClock >= 1) {
      this.revealClock = 0;
      this.refreshReveal();
    }
    this.living.update(this.sim, dt, this.reducedMotion, overlay);
    const bonds = this.sim.world.trees.filter(tree => tree.rootTips.some(tip => tip.bondedTo !== null)).length;
    if (bonds > this.lastBonds) this.sound.chime('bond');
    if (this.sim.player.fruited > this.lastFruits) this.sound.chime('fruit');
    this.lastBonds = bonds;
    this.lastFruits = this.sim.player.fruited;
    this.sound.update({
      bonds,
      surface: blend,
      season,
      storm: storm.phase === 'idle' ? 0 : this.match.stormIntensity,
      fire: this.match.fire.phase === 'burning' ? this.match.fire.intensity : 0,
      drought: this.droughtShown,
      lightning: this.stormView.flash,
    });

    if (this.steward) {
      this.stewardClock -= dt * Math.max(1, this.speed);
      if (this.stewardClock <= 0) {
        this.stewardClock = 4;
        this.stewardTick();
      }
    }

    // Reachability only changes as the network grows or a bond is made, so it
    // is derived on a slow beat and re-used by the journal and every label.
    this.journeyClock += dt;
    if (!this.journey || this.journeyClock >= 0.25) {
      this.journeyClock = 0;
      const activeSpatial = this.section && this.match.spatialColonies.get(this.match.activeStandId);
      this.journey = activeSpatial
        ? {
            step: 2,
            title: 'One body beneath the forest.',
            copy: 'Browse sections, direct growth through the soil, and return to the forest to reveal the same strands.',
            blocker: null,
            enoughSurplus: activeSpatial.colony.surplus >= ECON.fruitThreshold,
            roots: [],
            sites: [],
            bondedTrees: activeSpatial.world.trees.filter(tree => tree.rootTips.some(tip => tip.bondedTo !== null)).length,
            livingTrees: activeSpatial.world.trees.filter(tree => !tree.dead).length,
          }
        : deriveJourney(this.sim);
    }
    this.ui.update(this.sim, dt, this.journey);
    this.updateLasso();
    this.syncClusterControls();
    this.stormUI.update(dt);
    this.fireUI.update(dt);
    this.updateContact(dt);
    this.droughtUI.update(dt);
    // An outcome takes the sheet; the survey is a page of it, not a rival.
    if (this.sim.outcome !== 'playing') this.survey.dismiss();
    if (!this.acknowledgedOutcomes.has(this.match.activeStandId)) {
      this.ui.showOutcome(this.sim, () => this.restart(), this.sim.outcome === 'fruited' || this.match.colonizedStands > 1 ? () => {
        this.acknowledgedOutcomes.add(this.match.activeStandId);
        this.match.continueGrowing();
        this.setView('forest');
      } : undefined);
    }
    // The regional hold is the match: say where it stands, and end it once decided.
    this.ui.regionLine = this.match.holdStatus();
    if (this.match.victory !== 'playing' && !this.victoryShown) {
      this.victoryShown = true;
      const won = this.match.victory === 'won';
      const held = this.match.hold[won ? 'player' : 'rival'].tiles;
      this.ui.showVictory(
        won,
        won
          ? `Your mycelium held ${held} stands through the turn of the season, after ${formatClock(this.match.time)}. ${this.match.colonization.filter((c) => c.owner !== 'rival').length} spore journeys and ${this.match.fusions.length} fusions made one living network of the forest.`
          : `The rival held ${held} stands through the turn of the season. Your colonies can still grow.`,
        () => this.restart(),
        () => this.setView('forest')
      );
    }
    if (this.reportedColonies !== this.match.colonizedStands) {
      this.reportedColonies = this.match.colonizedStands;
      const arrival = this.match.colonization.at(-1);
      this.refreshStandOptions();
      if (arrival) this.ui.setNote(`A spore has taken hold in stand ${arrival.to + 1}. Rise to the forest and choose it under Survey a stand.`);
    }
    // Last word on the overlays: the views above write their own opacities, so
    // the fade is applied after them and nothing is left half lit.
    this.overlays.apply(overlay);
    if (!this.sim.rivalEnabled) { this.rivalMesh.group.visible = false; this.rivalMotes.points.visible = false; }
    // And the last word on what a section replaces. The match's own stand views
    // and the region's surfaces belong to the ground above, not to the plane
    // being inspected, so they leave while a section is open. This runs after
    // every view's own update, which is the only way it sticks.
    const sectionMode = this.section !== null && this.stage.rig.view === 'underground';
    if (sectionMode) {
      for (const group of this.sectionHiddenGroups()) group.visible = false;
      this.sectionHidLocalViews = true;
    } else if (this.sectionHidLocalViews) {
      this.sectionHidLocalViews = false;
      for (const group of this.sectionHiddenGroups()) group.visible = true;
      // Restore the visibility calculated above for this camera pose. The
      // forest endpoint hides the soil and underground overlays; making every
      // group visible here would flash them for the first frame back above.
      this.overlays.apply(overlay);
      this.soil.group.visible = blend < 1;
      this.stream.group.visible = blend > 0.01;
      for (const surface of this.surfaces) {
        if (surface) surface.group.visible = blend > 0.01 || surface.standId === this.match.activeStandId;
      }
    }
    if (draw) this.stage.render(dt);
    this.markerClock += dt;
    this.offerFollow();
    this.syncColonyTiles();
    this.launchSporeFlights();
    this.sporeFlights.update(dt, this.stage.rig.surfaceBlend > 0.3);
    if (this.markerClock > 0.1) {
      this.syncSporeButton();
      this.markerClock = 0;
      this.updateMarkers(this.journey);
      // The survey is a record of the whole region, so it is refreshed on the
      // same slow beat and only while its sheet is actually open.
      if (this.survey.open) this.refreshSurvey();
    }
  }

  /** Redraw the regional survey from the match's own projection. */
  private refreshSurvey(): void {
    this.survey.render(buildSurvey(this.match), this.selectedStandId ?? this.match.activeStandId);
  }

  private awaken(): void {
    if (this.awakened) return;
    this.awakened = true;
    document.querySelector<HTMLElement>('#begin')!.hidden = true;
    document.querySelector<HTMLElement>('#journey')!.hidden = false;
    this.setSpeed(1);
    this.ui.setNote('Click a root label to reach toward it. Click again when close to bond.');
  }

  private *authoredTrees(): Iterable<BatchedTree> {
    for (const surface of this.surfaces) for (const entry of surface.trees) {
      if (entry.model) yield { key: `${surface.standId}:${entry.tree.id}`, model: entry.model, visible: surface.group.visible };
    }
  }

  /** Smooth the achieved speed and say so when the world cannot keep up. */
  private trackPace(dt: number, steps: number): void {
    if (this.speed <= 0 || dt <= 0) {
      this.effectiveSpeed = this.speed;
      this.paceSimulated = 0;
      this.paceAsked = 0;
      return;
    }
    this.paceSimulated += steps * FIXED_STEP;
    this.paceAsked += dt;
    if (this.paceAsked < 0.5) return;
    const achieved = this.paceSimulated / this.paceAsked;
    this.effectiveSpeed += (achieved - this.effectiveSpeed) * 0.5;
    this.paceSimulated = 0;
    this.paceAsked = 0;
    const note = document.querySelector<HTMLElement>('#speed-note');
    if (!note) return;
    const behind = this.effectiveSpeed < this.speed * 0.85;
    note.hidden = !behind;
    if (behind) note.textContent = `running at ${this.effectiveSpeed.toFixed(1)}\u00d7 \u2014 the network is too large for ${this.speed}\u00d7 here`;
  }

  private setSpeed(speed: number): void {
    this.speed = speed;
    for (const button of document.querySelectorAll<HTMLButtonElement>('.speed-row button')) {
      const on = Number(button.dataset.speed) === speed;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-pressed', String(on));
    }
  }

  private bindExperience(): void {
    document.querySelector('#begin')!.addEventListener('click', () => { if (this.prepareLocalAction()) this.awaken(); });
    document.querySelector('#rest')!.addEventListener('click', () => {
      if (!this.prepareLocalAction()) return;
      if (this.sim.outcome !== 'playing') return;
      const group = this.liveGroup();
      if (group) {
        // Rest and wake apply to the selected subcluster alone.
        const resting = !groupResting(this.groupNet(), group);
        setGroupResting(this.groupNet(), group, resting);
        this.ui.setNote(resting ? `Subcluster ${group} rests. The rest of the colony keeps its orders.` : `Subcluster ${group} begins to grow again.`);
        this.syncClusterControls(true);
        return;
      }
      this.sim.player.resting = !this.sim.player.resting;
      this.ui.setNote(this.sim.player.resting ? 'The frontier rests. Your trees keep trading.' : 'The frontier begins to grow again.');
    });
    document.querySelector('#sound')!.addEventListener('click', async () => {
      const button = document.querySelector<HTMLButtonElement>('#sound')!;
      try {
        const enabled = await this.sound.toggle();
        button.textContent = enabled ? 'Sound on' : 'Sound off';
        button.setAttribute('aria-pressed', String(enabled));
      } catch { this.ui.setNote('Sound could not start in this browser. You can continue in silence.'); }
    });
    const toggleNotes = () => {
      const hidden = document.body.classList.toggle('immersed');
      document.querySelector<HTMLElement>('#restore-notes')!.hidden = !hidden;
      document.querySelector('#immersive')!.setAttribute('aria-pressed', String(hidden));
    };
    document.querySelector('#immersive')!.addEventListener('click', toggleNotes);
    document.querySelector('#restore-notes')!.addEventListener('click', toggleNotes);
    document.querySelector('#focus-root')!.addEventListener('click', () => {
      if (!this.prepareLocalAction()) return;
      const journey = deriveJourney(this.sim);
      const target = journey.roots.find(entry => entry.state !== 'bonded');
      if (!target) { this.ui.setNote('Every tree is bonded. Rest, then fruit near the surface.'); return; }
      this.stage.rig.focus(target.gx - GRID.cols / 2, GRID.rows / 2 - target.gy, 120);
      this.living.acknowledge(target.gx, target.gy);
      this.ui.setNote(
        target.state === 'distant'
          ? 'A root worth reaching. Click its label to send the frontier there.'
          : 'A root is within reach. Click its label to bond.'
      );
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.stop(); this.sound.suspend(); }
      else { this.start(); this.sound.resume(); }
    });
  }

  private bindViews(): void {
    document.querySelector('#view-forest')!.addEventListener('click', () => this.setView('forest'));
    document.querySelector('#view-underground')!.addEventListener('click', () => this.descend());
    document.querySelector('#descend-tree')!.addEventListener('click', () => this.descend());
    document.querySelector('#survey-open')!.addEventListener('click', () => {
      this.survey.toggle();
      if (this.survey.open) this.refreshSurvey();
    });
    document.querySelector('#survey-close')!.addEventListener('click', () => this.survey.hide());
    document.querySelector('#forest-reveal')?.addEventListener('click', () => {
      const on = this.toggleReveal();
      this.ui.setNote(on
        ? 'Your colonies show through the forest floor. Click a strand to go below it.'
        : 'Colonies hidden. The forest is unchanged underneath.');
    });
    // The section browser's own controls. They exist for the player, not only
    // for the bench: Previous and Next open a section on their first press.
    const sectionAction = (selector: string, run: () => { ok: boolean; message: string }) => {
      document.querySelector(selector)?.addEventListener('click', () => {
        const result = run();
        this.ui.setNote(result.message);
        this.syncSectionUI();
      });
    };
    sectionAction('#section-prev', () => (this.section ? this.stepSection(-1) : this.openFirstSection()));
    sectionAction('#section-next', () => (this.section ? this.stepSection(1) : this.openFirstSection()));
    sectionAction('#section-flip', () => (this.section ? this.flipSectionAxis() : this.openFirstSection()));
    sectionAction('#section-follow', () => (this.section ? this.followConnection() : this.openFirstSection()));
    sectionAction('#section-root', () => this.seekSectionRoot());
    sectionAction('#section-return', () => this.returnToForest());
    sectionAction('#follow-frontier', () => this.followFrontier());
    sectionAction('#release-spores', () => this.releaseSpores());
    sectionAction('#section-surface', () => this.surfaceHere());
    document.querySelector<HTMLSelectElement>('#section-stand')?.addEventListener('change', (event) => {
      const id = Number((event.target as HTMLSelectElement).value);
      if (this.match.spatialColonies.has(id) && id !== this.match.activeStandId) {
        this.returnToForest();
        this.enterStand(id);
      }
      const result = this.openSection(id);
      this.ui.setNote(result.message);
    });
    this.survey.onChoose((id) => {
      this.selectStand(id);
      this.refreshStandOptions();
    });
    document.querySelector('#forest-stand')!.addEventListener('change', event => {
      this.selectStand(Number((event.target as HTMLSelectElement).value));
    });
    this.refreshStandOptions();
    document.querySelector('#forest-tree')!.addEventListener('change', event => {
      const [standId, treeId] = (event.target as HTMLSelectElement).value.split(':').map(Number);
      if (standId !== undefined && treeId !== undefined) this.selectTree(standId, treeId);
    });
    const select = document.querySelector<HTMLSelectElement>('#forest-tree')!;
    // The player's own stand comes first, because that is the ground they can
    // walk into; the rest of the region is listed under its community.
    const standsInOrder = [
      this.enterableStand,
      ...this.region.stands.map((site) => site.id).filter((id) => id !== this.enterableStand),
    ];
    for (const standId of standsInOrder) {
      const site = this.region.stands[standId];
      const surface = this.surfaces[standId];
      if (!site || !surface) continue;
      for (const entry of surface.trees) {
        const option = document.createElement('option');
        option.value = `${standId}:${entry.tree.id}`;
        // The colony's own stand is described as what it is. The rest of the
        // region is described by the community the region generated for it.
        const where = `stand ${standId + 1} \u00b7 ${COMMUNITY_LABEL[site.community]}`;
        option.textContent = `${SPECIES[entry.tree.species].common} · ${entry.tree.id + 1} · ${where}`;
        select.append(option);
      }
    }
    const motion = document.querySelector<HTMLButtonElement>('#ambient-motion')!;
    const updateMotion = () => { motion.textContent = this.ambientMotion ? 'Wind on' : 'Wind still'; motion.setAttribute('aria-pressed', String(this.ambientMotion)); };
    updateMotion();
    motion.addEventListener('click', () => { this.ambientMotion = !this.ambientMotion; updateMotion(); });
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', event => {
      this.stage.rig.reducedMotion = event.matches;
      this.ambientMotion = !event.matches;
      updateMotion();
    });
  }

  private setView(view: WorldView): void {
    if (view === 'forest' && this.section && this.forestContext) {
      this.returnToForest();
      return;
    }
    this.stage.rig.setView(view);
    this.syncViewUI();
  }

  private descend(): void {
    // Every descent remembers the forest it left, so Return to forest has a
    // picture to come back to however the player later moves below.
    if (this.stage.rig.view === 'forest' && !this.stage.rig.transitioning) this.captureForestContext();
    // With a spatial colony attached, descending is a descent into its real
    // sections rather than into the match's own stand transect: the general
    // action reopens the last section, and any other section can be chosen by
    // name or by clicking a projected strand.
    const targetStand = this.selectedStandId ?? this.match.activeStandId;
    const target = this.match.stands[targetStand];
    const localUnpromoted = target?.sim.hasColony && !this.match.spatialColonies.has(targetStand) &&
      (targetStand === this.region.foundingStand || target.arrivals.length > 0);
    if (localUnpromoted) {
      this.section = null;
      this.sectionView?.setSection(null);
      this.syncSectionUI();
    }
    if (!this.spatial && !this.match.stands[targetStand]?.sim.hasColony) this.ensureSectionViewer();
    const owned = this.match.spatialColonies.get(targetStand);
    if (owned && targetStand !== this.match.activeStandId && this.stage.rig.view === 'forest') {
      this.enterStand(targetStand);
    }
    if (owned && owned !== this.spatial) {
      this.match.spatial = owned;
      this.attachSpatialFixture(owned);
    }
    if (this.spatial && !localUnpromoted) {
      const reopen = this.section
        ? this.openSection(targetStand, this.section.spec.standId === targetStand ? this.section.spec.id : undefined)
        : this.openSection(targetStand);
      if (reopen.ok) {
        this.syncViewUI();
        return;
      }
      this.ui.setNote(reopen.message);
      return;
    }
    if (this.selectedStandId !== null && this.selectedStandId !== this.enterableStand) {
      if (!this.match.stands[this.selectedStandId]?.sim.hasColony) {
        this.setView('forest');
        this.ui.setNote('No colony here yet. Fruit in an occupied stand to send spores on the wind.');
        return;
      }
      // A wheel crossing is requested by the rig before it reaches this method.
      // Return to its surface endpoint before rebinding a different soil slice.
      if (this.stage.rig.view !== 'forest') this.stage.rig.setView('forest', true);
      if (this.stage.rig.transitioning) {
        this.ui.setNote('Let the forest come into view, then explore beneath this stand.');
        return;
      }
      this.enterStand(this.selectedStandId);
    }
    if (localUnpromoted) this.syncSectionUI();
    const id = this.surface.selectedId;
    if (id === null) this.setView('underground');
    else {
      const target = deriveJourney(this.sim).roots.find(root => root.treeId === id);
      const tree = this.sim.world.trees.find(tree => tree.id === id);
      const root = target ?? tree?.rootTips[0];
      if (root) this.stage.rig.focus(root.gx - GRID.cols / 2, GRID.rows / 2 - root.gy, 150);
      else this.setView('underground');
      this.syncViewUI();
    }
  }

  private selectTree(standId: number, id: number): void {
    const surface = this.surfaces[standId];
    const entry = surface?.trees.find((tree) => tree.tree.id === id);
    if (!surface || !entry) return;
    this.selectedStandId = standId;
    for (const other of this.surfaces) other.selectedId = null;
    surface.selectedId = id;
    document.querySelector<HTMLSelectElement>('#forest-stand')!.value = String(standId);
    document.querySelector<HTMLSelectElement>('#forest-tree')!.value = `${standId}:${id}`;
    // The camera frames the region from the founding stand's own origin, so a
    // neighbouring stand's tree has to be moved into that frame to be looked at.
    const position = surface.surfacePosition(id);
    if (position) this.stage.rig.focusTree(position.x + surface.group.position.x, position.z + surface.group.position.z);
    this.updateTreeNote();
  }

  private selectStand(id: number): void {
    const surface = this.surfaces[id];
    if (!surface) return;
    this.selectedStandId = id;
    const spatial = this.match.spatialForStand(id);
    if (spatial && spatial !== this.spatial) {
      this.match.spatial = spatial;
      this.attachSpatialFixture(spatial);
    }
    for (const other of this.surfaces) other.selectedId = null;
    document.querySelector<HTMLSelectElement>('#forest-tree')!.value = '';
    this.stage.rig.focusTree(surface.group.position.x, surface.group.position.z - TILE_SIZE / 2);
    this.updateTreeNote();
  }

  private refreshStandOptions(): void {
    const select = document.querySelector<HTMLSelectElement>('#forest-stand')!;
    select.replaceChildren(...this.match.stands.map(stand => {
      const option = document.createElement('option');
      option.value = String(stand.site.id);
      option.textContent = `${stand.site.id + 1} · ${COMMUNITY_LABEL[stand.site.community]} · ${stand.sim.hasColony ? 'colony' : 'uncolonized'}`;
      return option;
    }));
    select.value = String(this.selectedStandId ?? this.match.activeStandId);
    this.updateTreeNote();
  }

  /**
   * Draw the wildfire from the simulation's own front. The ground and scenery
   * shaders use the same projection the simulation judged with, so char lies
   * exactly where things burned.
   */
  private updateFire(dt: number, blend: number): void {
    const fire = this.match.fire;
    const phase = fire.phase;
    const onGround = phase === 'burning' || phase === 'aftermath';
    const direction = fire.state.direction;
    FLOOR_FIRE.dir.value.set(Math.cos(direction), Math.sin(direction));
    const hurricane = fire.hurricaneFront;
    FLOOR_FIRE.spotDir.value.set(Math.cos(hurricane?.direction ?? direction), Math.sin(hurricane?.direction ?? direction));
    FLOOR_FIRE.spotFront.value = hurricane?.front ?? -1e6;
    FLOOR_FIRE.spotScorch.value = hurricane ? 1 : 0;
    FLOOR_FIRE.band.value = FIRE.band;
    FLOOR_FIRE.time.value += this.ambientMotion ? dt : 0;
    const recoveryAge = this.match.time - fire.state.endsAt;
    const recovering = fire.state.sequence > 0 && recoveryAge >= 0 && recoveryAge < 480;
    if (onGround) {
      FLOOR_FIRE.front.value = fire.frontAt(this.match.time);
      this.scorchFade = 1;
    } else if (recovering) {
      FLOOR_FIRE.front.value = fire.state.end;
      this.scorchFade = 1 - THREE.MathUtils.smoothstep(recoveryAge, 80, 480);
    } else if (phase === 'idle') {
      this.scorchFade = 0;
    } else {
      this.scorchFade = 0;
    }
    FLOOR_FIRE.scorch.value = this.scorchFade;
    FLOOR_FIRE.active.value = phase === 'burning' ? 1 : phase === 'warning' ? fire.intensity * 0.3 : 0;
    FLOOR_FIRE.regrowth.value = recovering ? THREE.MathUtils.smoothstep(recoveryAge, 20, 420) : 0;
    const recoveryStage = recovering ? recoveryAge < 60 ? 2 : recoveryAge < 110 ? 3 : recoveryAge < 240 ? 4 : 5 : 0;
    this.dressing.setFireRecovery(recoveryStage, fire.scarredStands, fire.state.sequence);
    // The scenery's instances sit in the dressing group; find its regional origin.
    const origin = this.sceneToRegion(this.dressing.group.position.x, this.dressing.group.position.z);
    DRESSING_FIRE_MAP.value.set(origin.x, origin.y);
    const torches = fire.burnedTrees.filter(record => {
      const age = this.match.time - record.at;
      return age >= 0 && age < 12;
    }).slice(-24).map(record => {
      const surface = this.surfaces[record.stand];
      const tree = this.match.stands[record.stand]?.sim.world.trees.find(candidate => candidate.id === record.tree);
      const point = surface?.surfacePosition(record.tree);
      if (!tree || !point || !surface) return null;
      surface.group.updateWorldMatrix(true, false);
      surface.group.localToWorld(point);
      return { x: point.x, y: point.y, z: point.z, height: tree.height * (0.7 + tree.maturity * 0.5), age: this.match.time - record.at };
    }).filter((torch): torch is NonNullable<typeof torch> => torch !== null);
    this.fireView.update(dt, {
      phase, direction, front: fire.frontAt(this.match.time), start: fire.state.start,
      band: FIRE.band, intensity: fire.intensity, spot: hurricane, torches,
    }, !this.ambientMotion, blend);
    // A slow, irregular orange breath reaches the underground view too.
    const pulse = this.ambientMotion ? 0.78 + 0.15 * Math.sin(FLOOR_FIRE.time.value * 3.1)
      + 0.07 * Math.sin(FLOOR_FIRE.time.value * 5.3 + 1.7) : 0.85;
    this.stage.fireGlow = this.fireView.glow * pulse;
  }

  /**
   * Draw the drought from the simulation's severity: cracked, bleached ground
   * and wilting scenery through shared uniforms, a shrunken stream, dust, glare.
   * Trees it kills and strands it withers are simulation state already drawn
   * by the surface and the soil view (which re-colours as soil dries).
   */
  private updateDrought(dt: number, blend: number): void {
    const drought = this.match.drought;
    const target = drought.phase === 'idle' ? 0 : drought.intensity;
    this.droughtShown += (target - this.droughtShown) * Math.min(1, dt * 0.6);
    FLOOR_DROUGHT.severity.value = this.droughtShown;
    this.stream.setDryness(this.droughtShown);
    this.droughtView.update(dt, { intensity: this.droughtShown, wind: this.match.wind }, !this.ambientMotion, blend);
    this.stage.droughtHeat = this.droughtShown;
  }

  /**
   * Draw the storm's flood from the simulation's level: water spreading from
   * the course across the floor, a swollen stream, debris carried downstream,
   * and a silt stain that fades once the water has gone.
   */
  private updateFlood(dt: number, blend: number): void {
    const level = this.match.flood.level;
    // Course distance covers the channel's own half-width plus the flood's reach.
    const reach = 3 + FLOOD.reach * level;
    if (level > 0.9) this.floodSilt = 1;
    else if (level <= 0) this.floodSilt = Math.max(0, this.floodSilt - dt / 60);
    FLOOR_FLOOD.level.value = level;
    FLOOR_FLOOD.reach.value = reach;
    FLOOR_FLOOD.silt.value = level > 0 ? 0 : this.floodSilt;
    FLOOR_FLOOD.siltReach.value = 3 + FLOOD.reach;
    FLOOR_FLOOD.time.value += this.ambientMotion ? dt : 0;
    this.stream.setFlood(level);
    this.floodView.update(dt, level, reach, !this.ambientMotion, blend);
  }

  /**
   * Each tree the storm throws down draws the next strike onto its crown.
   * Presentation only: which trees fall is decided in `RegionalMatch`.
   */
  private strikeWindfalls(): void {
    const falls = this.match.windfalls;
    for (; this.windfallsSeen < falls.length; this.windfallsSeen++) {
      const fall = falls[this.windfallsSeen];
      const crown = this.surfaces.find(surface => surface?.standId === fall.stand)?.crownPosition(fall.tree);
      if (crown) this.stormView.strike(this.stormView.group.worldToLocal(crown));
      if (fall.severed.length && fall.stand === this.match.activeStandId) {
        this.ui.setNote('The storm threw down a bonded tree. Its junction is torn and everything stored there is lost.');
      }
    }
  }

  /** Rebuild only local presentation; the stand's simulation is never replaced. */
  private enterStand(id: number): void {
    const old = this.region.stands[this.match.activeStandId];
    const next = this.region.stands[id];
    if (!next || !this.match.stands[id].sim.hasColony || id === old.id) return;
    // The player is going below; the survey is an above-ground record.
    this.survey.dismiss();
    this.overlays.apply(1);
    for (const group of [this.soil.group, this.forest.group, this.living.group, this.groundwater.group]) disposeView(group);
    this.match.selectStand(id);
    this.sim = this.match.sim;
    const dx = (old.sx - next.sx) * TILE_SIZE;
    const dz = (next.sy - old.sy) * TILE_SIZE;
    for (const surface of this.surfaces) surface.group.position.add(new THREE.Vector3(dx, 0, dz));
    // The stream belongs to the region, not to the stand, so it is shifted with
    // the landscape rather than rebuilt.
    this.stream.group.position.add(new THREE.Vector3(dx, 0, dz));
    // The scenery belongs to the region too: shifting beats rebuilding, and the
    // decorations keep their identities across a stand change.
    this.dressing.group.position.add(new THREE.Vector3(dx, 0, dz));
    // The earned bodies above ground are region scenery too: shifting them
    // keeps a mushroom standing on the ground it fruited from.
    this.fruiting.group.position.add(new THREE.Vector3(dx, 0, dz));
    this.stormView.group.position.add(new THREE.Vector3(dx, 0, dz));
    this.sporeFlights.group.position.add(new THREE.Vector3(dx, 0, dz));
    // The reveal and the section follow the same landscape: they are drawn in
    // region coordinates, so one shift keeps them where the ground is.
    this.sceneShift.x += dx;
    this.sceneShift.z += dz;
    this.reveal?.group.position.add(new THREE.Vector3(dx, 0, dz));
    this.sectionView?.group.position.add(new THREE.Vector3(dx, 0, dz));
    this.stage.rig.rebaseForest(dx, dz);
    this.soil = new SoilMesh(this.sim.world);
    this.attachEdgeSoil();
    this.forest = new ForestView(this.sim.world);
    this.forest.showRootsOnly();
    this.living = new LivingView(this.sim, this.assets);
    this.groundwater = this.buildGroundwater();
    this.stage.scene.add(this.soil.group, this.forest.group, this.living.group, this.groundwater.group);
    this.playerMesh.reset();
    // Subclusters belong to one stand's colony; a new view starts with the whole colony.
    this.selectGroup(0);
    this.rivalMesh.reset();
    this.playerMotes.reset();
    this.rivalMotes.reset();
    this.overlays = new OverlayFade([this.playerMesh.group, this.rivalMesh.group, this.playerMotes.points, this.rivalMotes.points, this.forest.group, this.living.group, this.groundwater.group]);
    this.overlays.apply(0);
    this.seasonId = '';
    this.journey = null;
    this.markerActions.clear();
    for (const button of this.markerButtons.values()) button.hidden = true;
    this.lastBonds = this.sim.world.trees.filter(tree => tree.rootTips.some(tip => tip.bondedTo !== null)).length;
    this.lastFruits = this.sim.player.fruited;
    this.ui.resetStand();
    this.ui.buildRail(this.sim);
    this.ui.update(this.sim, 1, deriveJourney(this.sim));
    this.lastView = '';
  }

  private updateTreeNote(): void {
    const standId = this.selectedStandId ?? this.match.activeStandId;
    const stand = this.match.stands[standId];
    const surface = this.surfaces[standId];
    const tree = surface?.trees.find(entry => entry.tree.id === surface.selectedId)?.tree;
    const occupied = stand.sim.hasColony;
    document.querySelector('#stand-status')!.textContent =
      `Stand ${standId + 1} · ${occupied ? 'Colony established' : 'No colony yet; spores arrive after fruiting'} · ${this.match.colonizedStands} of ${this.match.stands.length} occupied`;
    document.querySelector<HTMLButtonElement>('#descend-tree')!.disabled = false;
    document.querySelector('#tree-status')!.textContent = tree
      ? `${SPECIES[tree.species].common} · ${tree.dead ? 'Deadwood' : tree.health < 0.5 ? 'Struggling' : 'Living'} · ${occupied ? tree.rootTips.some(tip => tip.bondedTo !== null) ? 'Bonded to your network' : 'Not yet bonded' : 'Beyond your colony'}`
      : 'Choose a crown, or explore beneath this stand.';
  }

  private syncViewUI(): void {
    const rig = this.stage.rig;
    const transition = rig.transitioning;
    const state = `${rig.view}:${transition}:${this.match.activeStandId}`;
    if (this.lastView === state) return;
    this.lastView = state;
    document.body.dataset.view = rig.view;
    document.body.classList.toggle('view-transition', transition);
    for (const view of ['forest', 'underground']) document.querySelector(`#view-${view}`)!.setAttribute('aria-pressed', String(rig.view === view));
    document.querySelector('#view-status')!.textContent = transition ? (rig.view === 'forest' ? 'Rising through the canopy…' : 'Following the roots…') : (rig.view === 'forest' ? 'Above the forest floor' : `Within stand ${this.match.activeStandId + 1} \u00b7 ${COMMUNITY_LABEL[this.match.active.site.community]}`);
    document.querySelector('.camera-hint')!.textContent = rig.view === 'forest'
      ? 'Drag to wander · Shift-drag to orbit · Scroll to descend · V to switch views'
      : this.section
        ? 'Drag to wander · [ ] to move through sections · X to turn the section · G to follow a strand · Esc to rise'
        : 'Drag to wander · Scroll to look closer · F to reframe · V to rise';
    for (const button of this.markerButtons.values()) button.hidden = true;
  }

  /** The species' short name, for a label that has to stay short. */
  private shortName(treeId: number): string {
    return SPECIES[this.sim.world.trees[treeId].species].common
      .replace('Northern red ', '')
      .replace('Yellow ', '')
      .replace('Eastern ', '');
  }

  /**
   * One label per actionable root, plus the surface strands a fruiting body
   * could rise from while the Fruit order is selected.
   *
   * Every label is bound to an explicit tree and root tip, so the strand that
   * bonds is the one the player was looking at rather than whichever strand
   * happened to be nearest when they clicked.
   */
  private updateMarkers(journey: Journey | null): void {
    for (const button of this.markerButtons.values()) button.hidden = true;
    if (!journey || this.stage.rig.view === 'forest' || this.stage.rig.transitioning) { this.updateTreeNote(); return; }

    const markers: MarkerSpec[] = [];
    for (const target of journey.roots.slice(0, 4)) markers.push(this.rootMarker(target));
    // Surface sites only matter while the player is choosing where to fruit.
    if (this.ui.order === 'fruit' && !this.sim.player.fruit.active) {
      for (const site of journey.sites) {
        markers.push({
          key: `site-${site.nodeId}`,
          gx: site.gx,
          gy: site.gy,
          className: 'root-marker is-site',
          text: `\u25c7 Fruit here \u00b7 -${site.gy}cm`,
          aria: `Raise a fruiting body ${site.gy} centimetres below the surface`,
          disabled: !journey.enoughSurplus,
          onClick: () => {
            const result = this.sim.orderFruit(site.gx, site.gy);
            this.ui.setNote(result.message);
            if (result.ok) this.living.acknowledge(site.gx, site.gy);
          },
        });
      }
    }

    for (const marker of markers) {
      let button = this.markerButtons.get(marker.key);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        // The label's behaviour is rebound every time it is drawn, so a click
        // always acts on the current state of the match.
        button.addEventListener('click', () => {
          this.awaken();
          this.markerActions.get(marker.key)?.();
        });
        document.querySelector('#root-markers')!.append(button);
        this.markerButtons.set(marker.key, button);
      }
      this.markerActions.set(marker.key, marker.onClick);
      const position = new THREE.Vector3(marker.gx - GRID.cols / 2 + 0.5, GRID.rows / 2 - marker.gy - 0.5, 3).project(this.stage.rig.camera);
      const x = (position.x + 1) * this.canvas.clientWidth / 2;
      const y = (1 - position.y) * this.canvas.clientHeight / 2;
      button.hidden = position.z > 1 || x < 80 || x > this.canvas.clientWidth - (this.canvas.clientWidth > 900 ? 350 : 30) || y < 115 || y > this.canvas.clientHeight - 160;
      button.style.left = `${x}px`;
      button.style.top = `${y}px`;
      button.className = marker.className;
      button.disabled = marker.disabled || this.sim.outcome !== 'playing';
      button.textContent = marker.text;
      button.setAttribute('aria-label', marker.aria);
    }
    // The depth ruler follows the very same camera projection as the soil.
    const top = new THREE.Vector3(-GRID.cols / 2, GRID.rows / 2, 0).project(this.stage.rig.camera);
    const bottom = new THREE.Vector3(-GRID.cols / 2, -GRID.rows / 2, 0).project(this.stage.rig.camera);
    const rail = document.querySelector<HTMLElement>('.rail')!;
    rail.style.top = `${(1 - top.y) * this.canvas.clientHeight / 2}px`;
    rail.style.height = `${(top.y - bottom.y) * this.canvas.clientHeight / 2}px`;
    rail.style.bottom = 'auto';
  }

  /** A root label, phrased so its state is legible without a legend. */
  private rootMarker(target: RootTarget): MarkerSpec {
    const name = this.shortName(target.treeId);
    const spec = SPECIES[target.tree.species];
    if (target.state === 'bonded') {
      const satisfied = target.tree.waterReceived > 0.65 && target.tree.nutrientReceived > 0.65;
      return {
        key: `root-${target.treeId}`,
        gx: target.gx,
        gy: target.gy,
        className: 'root-marker is-bonded',
        text: `\u2194 Bonded \u00b7 ${name}${satisfied ? '' : ' \u00b7 thirsty'}`,
        aria: `Bonded to ${spec.common}${satisfied ? '' : ', and it is not being supplied'}`,
        disabled: true,
        onClick: () => {},
      };
    }
    const distant = target.state === 'distant';
    return {
      key: `root-${target.treeId}`,
      gx: target.gx,
      gy: target.gy,
      className: `root-marker is-${target.state}`,
      text: distant
        ? `\u2197 Reach \u00b7 ${name}`
        : target.state === 'poor'
          ? `\u25c7 ${name} \u00b7 needs carbon`
          : `\u25c7 Bond \u00b7 ${name}`,
      aria: distant
        ? `Grow toward ${spec.common}, about ${Math.round(target.distance)} centimetres away`
        : target.state === 'poor'
          ? `The connected network near ${spec.common} has too little carbon to bond yet`
          : `Bond with ${spec.common}`,
      disabled: false,
      onClick: () => {
        if (distant) {
          if (!this.sim.orderGrowth(target.gx, target.gy)) {
            this.ui.setNote('That root cannot be reached from here. Try a strand of your own.');
            return;
          }
          this.living.acknowledge(target.gx, target.gy);
          this.sound.chime('grow');
          this.ui.setNote(
            `Growing toward ${spec.common}. The label will say Bond once a strand arrives with carbon to spare.`
          );
          return;
        }
        const result = this.sim.orderBondTip(target.treeId, target.tipId);
        this.ui.setNote(result.message);
        if (result.ok) this.living.acknowledge(target.gx, target.gy);
      },
    };
  }

  private bindSpeed(): void {
    for (const button of document.querySelectorAll<HTMLButtonElement>('.speed-row button')) {
      button.addEventListener('click', () => {
        if (Number(button.dataset.speed) > 0) this.awaken();
        this.setSpeed(Number(button.dataset.speed ?? 1));
      });
    }
  }

  private bindInput(): void {
    const canvas = this.canvas;

    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !event.isPrimary) return;
      this.pointerDown = true;
      this.pointerMoved = 0;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      this.shiftDown = event.shiftKey;
      // Underground, holding still on the soil grows a selection circle.
      this.lasso = null;
      if (this.canSelectRegion() && !event.shiftKey) {
        if (this.section) {
          // In a regional section the circle is drawn on the section plane, in XYZ.
          const point = this.sectionPointAt(event.clientX, event.clientY);
          if (point) this.lasso = { startedAt: performance.now(), clientX: event.clientX, clientY: event.clientY, gx: 0, gy: 0, point, radius: 0, active: false };
        } else {
          const point = this.gridAt(event.clientX, event.clientY);
          if (point) this.lasso = { startedAt: performance.now(), clientX: event.clientX, clientY: event.clientY, gx: point.gx, gy: point.gy, radius: 0, active: false };
        }
      }
      // A capture that cannot be taken is not a reason to lose the press: the
      // drag ends at pointerup either way, and a synthetic or stale pointer id
      // would otherwise throw out of the handler and leave the press stuck.
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        /* capture unavailable for this pointer */
      }
    });

    // Chemicals are aimed wherever the cursor rests, pressed or not.
    canvas.addEventListener('pointermove', (event) => { this.hover.x = event.clientX; this.hover.y = event.clientY; });
    canvas.addEventListener('pointermove', (event) => {
      if (!this.pointerDown) return;
      const dx = event.clientX - this.lastX;
      const dy = event.clientY - this.lastY;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      // A growing selection circle holds the view still.
      if (this.lasso?.active) return;
      this.pointerMoved += Math.abs(dx) + Math.abs(dy);
      // Moving before the circle starts makes this a drag, not a selection.
      if (this.pointerMoved >= 6) this.lasso = null;

      if (this.shiftDown) {
        // Shift-drag lifts the camera off the sheet, opening the soil's depth.
        this.stage.rig.tiltBy(-dy * 0.0035, dx * 0.0035);
        return;
      }
      // Convert pixels to world units at the camera's focal plane so the sheet
      // tracks the cursor exactly, whatever the zoom.
      const worldPerPixel = this.worldPerPixel();
      this.stage.rig.pan(-dx * worldPerPixel, dy * worldPerPixel);
    });

    const release = (event: PointerEvent) => {
      if (!this.pointerDown) return;
      this.pointerDown = false;
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch {
        /* capture already released */
      }
      // A held press that grew a circle selects; it never also places an order.
      const lasso = this.lasso;
      this.lasso = null;
      if (lasso?.active) {
        this.finishLasso(lasso);
        return;
      }
      this.hideLassoRing();
      // A drag is a camera move; a tap is an order.
      if (this.pointerMoved < 6 && !this.stage.rig.transitioning) {
        if (this.stage.rig.view === 'forest') {
          // Three unambiguous modes, in order: a crown the player can see wins
          // outright; then, while the reveal is on, a projected strand; then
          // the ground, where the nearest tree is selected as before. A strand
          // lies on the terrain, so without this order the floor would always
          // win and the reveal could never be clicked.
          if (!this.pickCrown(event.clientX, event.clientY) &&
              !(this.revealEnabled && this.pickStrandAt(event.clientX, event.clientY))) {
            this.pickGround(event.clientX, event.clientY);
          }
        }
        else this.applyOrderAt(event.clientX, event.clientY);
      }
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', () => { this.pointerDown = false; this.lasso = null; this.hideLassoRing(); });

    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.canvas.clientHeight : 1);
        this.zoom(Math.exp(THREE.MathUtils.clamp(delta, -160, 160) * 0.0011));
      },
      { passive: false }
    );

    window.addEventListener('keydown', (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
      // Contact war: one key per chemical, aimed at the cursor; Z jumps to the front.
      const chemical = ContactBar.chemicalFor(event.key);
      if (chemical && !event.shiftKey && this.stage.rig.view === 'underground') { event.preventDefault(); this.castAtCursor(chemical); return; }
      if (event.key.toLowerCase() === 'z' && !event.shiftKey) { event.preventDefault(); this.jumpToFront(); return; }
      if (event.key.toLowerCase() === 'v') { event.preventDefault(); if (this.stage.rig.view === 'forest') this.descend(); else this.setView('forest'); }
      if (event.target === canvas && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        this.stage.rig.pan(event.key === 'ArrowLeft' ? -6 : event.key === 'ArrowRight' ? 6 : 0, event.key === 'ArrowUp' ? 6 : event.key === 'ArrowDown' ? -6 : 0);
      }
      if (event.key === '+' || event.key === '=') this.zoom(0.85);
      if (event.key === '-') this.zoom(1.15);
      if (event.code === 'Space' && !(event.target instanceof HTMLButtonElement) && !(event.target instanceof HTMLElement && event.target.closest('summary'))) {
        event.preventDefault();
        this.awaken();
        this.setSpeed(this.speed === 0 ? 1 : 0);
      }
      if (event.key.toLowerCase() === 'r' && this.awakened) document.querySelector<HTMLButtonElement>('#rest')!.click();
      if (event.key.toLowerCase() === 'h') document.querySelector<HTMLButtonElement>('#immersive')!.click();
      if (event.key.toLowerCase() === 's') { event.preventDefault(); this.survey.toggle(); if (this.survey.open) this.refreshSurvey(); }
      if (event.key === 'Escape' && this.survey.open) this.survey.hide();
      // Escape returns orders to the whole colony; 1-6 pick a subcluster.
      else if (event.key === 'Escape' && this.selectedGroup) this.selectGroup(0);
      if (/^[1-6]$/.test(event.key) && this.groupNet().groups?.some((g) => g.id === Number(event.key))) this.selectGroup(Number(event.key));
      // Section keys do not steal input from an independent local colony below.
      if (this.spatial) {
        if (this.section || this.stage.rig.view === 'forest') {
          if (event.key === '[') { event.preventDefault(); (this.section ? this.stepSection(-1) : this.openFirstSection()); }
          if (event.key === ']') { event.preventDefault(); (this.section ? this.stepSection(1) : this.openFirstSection()); }
          if (event.key.toLowerCase() === 'x') { event.preventDefault(); (this.section ? this.flipSectionAxis() : this.openFirstSection()); }
          if (event.key.toLowerCase() === 'g') { event.preventDefault(); (this.section ? this.followConnection() : this.openFirstSection()); }
        }
        if (event.key.toLowerCase() === 'n') { event.preventDefault(); this.toggleReveal(); }
        if (event.key === 'Escape' && !this.survey.open && this.section) {
          event.preventDefault();
          this.returnToForest();
        }
      }
      if (event.key === 'Shift') this.shiftDown = true;
      if (event.key === 'f') this.frameSheet();
    });
    window.addEventListener('keyup', (event) => {
      if (event.key === 'Shift') this.shiftDown = false;
    });
    window.addEventListener('resize', () => {
      this.stage.resize();
      // The default framing is a function of the aspect ratio, so a window that
      // changes shape has to be framed again. The rig ignores this when the
      // player has aimed the camera themselves.
      this.stage.rig.reframe();
    });
  }

  private zoom(factor: number): void {
    const before = this.stage.rig.view;
    this.stage.rig.zoomBy(factor);
    if (before === 'forest' && this.stage.rig.view === 'underground') this.descend();
  }

  private worldPerPixel(): number {
    const height = this.canvas.clientHeight || window.innerHeight;
    const fov = (this.stage.rig.camera.fov * Math.PI) / 180;
    const worldHeight = 2 * Math.tan(fov / 2) * this.stage.rig.distance;
    return worldHeight / height;
  }

  /** Screen point -> soil grid coordinates, or null if the ray misses. */
  private gridAt(clientX: number, clientY: number): { gx: number; gy: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.pointer, this.stage.rig.camera);
    if (!this.raycaster.ray.intersectPlane(this.plane, this.hit)) return null;
    return { gx: this.hit.x + GRID.cols / 2, gy: GRID.rows / 2 - this.hit.y };
  }

  /** Every other owner's strands as section edges, so a front can be seen and aimed at. */
  private enemyEdges(): RevealEdge[] {
    const edges: RevealEdge[] = [];
    for (const { net } of regionNetworks(this.match)) {
      if (net.owner === 'player') continue;
      for (const node of net.nodes) {
        if (!node.alive || !node.spatial || node.parent < 0) continue;
        const parent = net.nodes[node.parent];
        if (!parent?.alive || !parent.spatial) continue;
        edges.push({
          key: `${net.colonyId ?? net.owner}:${node.id}`, parent: parent.id, child: node.id,
          from: parent.spatial, to: node.spatial, thickness: node.thickness, reinforced: node.reinforced,
          connected: node.connected, standId: node.standId, parentStandId: parent.standId,
        });
      }
    }
    return edges;
  }

  /** The regional point under the cursor in the underground view, section or stand. */
  private contactPointAt(clientX: number, clientY: number): { x: number; y: number; z: number } | null {
    if (this.stage.rig.view !== 'underground' || this.stage.rig.transitioning) return null;
    if (this.section) return this.sectionPointAt(clientX, clientY);
    const cell = this.gridAt(clientX, clientY);
    if (!cell) return null;
    return this.sim.world.regionalSoil?.pointAt(cell.gx - 0.5, cell.gy - 0.5) ?? null;
  }

  private castAtCursor(chemical: Chemical): void {
    this.awaken();
    const point = this.contactPointAt(this.hover.x, this.hover.y);
    const result = point
      ? this.match.contact.cast('player', chemical, point)
      : { ok: false, message: `Aim ${CHEMICALS[chemical].name.toLowerCase()} at the soil.` };
    this.contactBar.flash(chemical, result.ok);
    this.ui.setNote(result.message);
  }

  /** Go to the busiest front the player is fighting on. */
  private jumpToFront(): void {
    const fronts = this.match.contact.frontsOf('player');
    if (!fronts.length) { this.ui.setNote('No front: nothing of yours touches another network.'); return; }
    const front = [...fronts].sort((a, b) => b.contacts - a.contacts)[0]!;
    const stand = front.standId >= 0 ? this.match.stands[front.standId] : null;
    const target = stand?.sim.hasColony ? front.standId : this.match.spatial?.originStandId;
    if (target === undefined) { this.ui.setNote(`The front is in stand ${front.standId + 1}.`); return; }
    if (target !== this.match.activeStandId || this.stage.rig.view !== 'underground') this.goToColony(target);
    // Frame the front itself on the stand's transect.
    const at = this.section ? null : this.contactToScene(front.centre);
    if (at) this.stage.rig.focus(at.x, at.y, 70);
    this.ui.setNote(`Front in stand ${front.standId + 1}: ${front.contacts} strands in contact. Aim with the cursor: Q W E, heavy A D C.`);
  }

  /**
   * A regional point in the scene, as the current underground view draws it:
   * on the open section's plane, or on the active stand's transect. Points the
   * view cannot show (off the plane, another stand) are null.
   */
  private contactToScene(point: { x: number; y: number; z: number }): THREE.Vector3 | null {
    if (this.section) {
      const plane = this.section.spec.plane;
      const off = plane.along === 'x' ? point.y - plane.fixed : point.x - plane.fixed;
      if (Math.abs(off) > this.section.spec.halfWidth + 2) return null;
      const at = this.regionToScenePoint(point);
      at.x += this.sceneShift.x;
      at.z += this.sceneShift.z;
      return at;
    }
    const soil = this.sim.world.regionalSoil;
    if (!soil) return null;
    if (this.standPlane?.standId !== soil.standId) {
      const a = soil.pointAt(0, 0);
      const b = soil.pointAt(1, 0);
      if (!a || !b) return null;
      const alongIsX = Math.abs(b.x - a.x) > Math.abs(b.y - a.y);
      this.standPlane = { standId: soil.standId, alongIsX, offset: (alongIsX ? a.x : a.y) - 0.5, fixed: alongIsX ? a.y : a.x };
    }
    const plane = this.standPlane;
    if (Math.abs((plane.alongIsX ? point.y : point.x) - plane.fixed) > 4) return null;
    const wx = (plane.alongIsX ? point.x : point.y) - plane.offset;
    const wy = (this.region.heightAt(point.x, point.y) - point.z);
    if (wx < -2 || wx > GRID.cols + 2) return null;
    return new THREE.Vector3(wx - GRID.cols / 2, GRID.rows / 2 - wy, 0.6);
  }

  private updateContact(dt: number): void {
    this.agentUI.update();
    const war = this.match.contact;
    const underground = this.stage.rig.view === 'underground' && !this.stage.rig.transitioning;
    this.contactBar.update(war, 'player', underground || war.frontsOf('player').length > 0);
    this.contactFx.update(dt, this.match.time, {
      casts: war.casts, lingering: war.lingering, fronts: war.fronts,
      radius: (chemical) => CHEMICALS[chemical].radius,
    }, 'player', (point) => this.contactToScene(point), underground);
  }

  /** A click in a section resolves to the same regional XYZ point it displays. */
  private sectionPointAt(clientX: number, clientY: number): { x: number; y: number; z: number } | null {
    const spec = this.section?.spec;
    if (!spec) return null;
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, 1 - ((clientY - rect.top) / rect.height) * 2);
    this.raycaster.setFromCamera(this.pointer, this.stage.rig.camera);
    const scene = spec.plane.along === 'x'
      ? this.regionToScene(0, spec.plane.fixed)
      : this.regionToScene(spec.plane.fixed, 0);
    const plane = spec.plane.along === 'x'
      ? new THREE.Plane(new THREE.Vector3(0, 0, 1), -(scene.z + this.sceneShift.z))
      : new THREE.Plane(new THREE.Vector3(1, 0, 0), -(scene.x + this.sceneShift.x));
    if (!this.raycaster.ray.intersectPlane(plane, this.hit)) return null;
    const regional = this.sceneToRegion(this.hit.x, this.hit.z);
    const along = spec.plane.along === 'x' ? regional.x : regional.y;
    const z = this.hit.y - GRID.rows / 2;
    const depthCm = (this.region.heightAt(regional.x, regional.y) - z) * GRID.cmPerRow;
    // The drawn soil runs past both ends into the next stand, and a grow order
    // there is a real order: the section edge is a seam, not a wall.
    if (along < spec.alongFrom - SECTION_SOIL_MARGIN || along >= spec.alongTo + SECTION_SOIL_MARGIN) return null;
    if (depthCm < spec.depthFromCm || depthCm >= spec.depthToCm) return null;
    if (standIdAt(this.region, regional.x, regional.y) === null) return null;
    return { x: regional.x, y: regional.y, z };
  }

  private applyOrderAt(clientX: number, clientY: number): void {
    if (this.stage.rig.view !== 'underground' || this.stage.rig.transitioning) return;
    if (!this.awakened) return;
    if (this.section) {
      const point = this.sectionPointAt(clientX, clientY);
      if (!point) return;
      const spatial = this.match.spatial;
      if (!spatial) {
        this.ui.setNote('No colony is here yet. A spore can found an independent network.');
        return;
      }
      const order = this.ui.order;
      let result: { ok: boolean; message: string };
      if (order === 'grow') {
        result = spatial.growAt(point, this.section.spec.plane.along, this.section.spec.plane.fixed, this.liveGroup());
      } else if (order === 'bond') {
        result = this.seekSectionRoot();
      } else if (!spatial.regionalCoordinates && this.section.spec.plane.along !== spatial.plane.along) {
        result = { ok: false, message: 'Flip back to the colony’s growth corridor to place that order.' };
      } else if (order === 'cord') {
        result = spatial.cordAt(point);
      } else {
        result = spatial.fruitAt(point);
      }
      this.ui.setNote(result.message);
      if (result.ok) this.refreshSpatialViews();
      return;
    }
    if (this.sim.outcome !== 'playing') return;
    const point = this.gridAt(clientX, clientY);
    if (!point) return;
    const order = this.ui.order;
    if (order === 'grow' && (point.gx < 0 || point.gx >= GRID.cols)) {
      const direction = point.gx < 0 ? 'west' : 'east';
      const site = this.region.stands[this.match.activeStandId];
      const neighbour = site && (direction === 'west' ? site.sx > 0 : site.sx < this.region.cols - 1);
      const within = point.gx >= -EDGE_SOIL_COLUMNS && point.gx < GRID.cols + EDGE_SOIL_COLUMNS;
      if (!neighbour || !within || point.gy < 0 || point.gy >= GRID.rows) return;
      const result = this.growAcrossStand(direction);
      if (result.ok) this.sound.chime('grow');
      this.ui.setNote(result.message);
      return;
    }
    if (order === 'grow') {
      const result = this.sim.growTo(point.gx, point.gy, this.liveGroup());
      if (result.ok) {
        this.living.acknowledge(point.gx, point.gy);
        this.sound.chime('grow');
      }
      this.ui.setNote(result.message);
      return;
    }
    if (order === 'bond') {
      const result = this.sim.orderBond(point.gx, point.gy);
      this.ui.setNote(result.message);
      if (result.ok) this.living.acknowledge(point.gx, point.gy);
      return;
    }
    if (order === 'cord') {
      const result = this.sim.orderCord(point.gx, point.gy);
      this.ui.setNote(result.message);
      if (result.ok) this.living.acknowledge(point.gx, point.gy);
      return;
    }
    const node = nearestNode(this.sim.player, point.gx, point.gy, 4);
    const result = this.sim.orderFruit(node?.gx ?? point.gx, node?.gy ?? point.gy);
    this.ui.setNote(result.message);
    if (result.ok) this.living.acknowledge(point.gx, point.gy);
  }

  // -------------------------------------------------------------------------
  // Subclusters: press and hold underground to circle part of the colony, then
  // steer it on its own. The simulation side is `GrowthGroup` in network.ts.
  // -------------------------------------------------------------------------

  /** Region selection works on the local transect, and in a regional section of a colony body. */
  private canSelectRegion(): boolean {
    if (this.stage.rig.view !== 'underground' || this.stage.rig.transitioning || !this.awakened) return false;
    if (this.section) return Boolean(this.spatial);
    return this.sim.outcome === 'playing' && this.sim.hasColony;
  }

  /**
   * The network subclusters belong to: the regional body when a section of it
   * is open, else the stand's own colony. Both views read and order the same
   * groups when they are the same network.
   */
  private groupNet(): Network {
    return (this.section && this.spatial?.colony) || this.sim.player;
  }

  /** The selected subcluster if it still exists, else the colony at large. */
  private liveGroup(): number {
    if (this.selectedGroup && !this.groupNet().groups?.some((g) => g.id === this.selectedGroup)) this.selectGroup(0);
    return this.selectedGroup;
  }

  private selectGroup(id: number): void {
    this.selectedGroup = id;
    this.playerMesh.setHighlight(id);
    this.syncClusterControls(true);
    if (this.section) this.refreshSectionClip();
    if (id) this.ui.setNote(`Subcluster ${id} selected: click the soil with Grow to steer it alone. Esc: whole colony.`);
  }

  /** Grow the circle while the press is held still; draw it in the soil's frame. */
  private updateLasso(): void {
    const lasso = this.lasso;
    if (!lasso || !this.pointerDown) { if (!lasso) this.hideLassoRing(); return; }
    const held = performance.now() - lasso.startedAt;
    if (!lasso.active) {
      if (held < 280 || this.pointerMoved >= 6) return;
      lasso.active = true;
    }
    // Starts small and widens steadily: a short hold picks a tuft, a long one a limb.
    lasso.radius = Math.min(42, 2 + (held - 280) / 1000 * 14);
    if (!this.lassoRing) {
      this.lassoRing = new THREE.Mesh(
        new THREE.RingGeometry(0.93, 1, 72),
        new THREE.MeshBasicMaterial({ color: '#9fe6ff', transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, toneMapped: false }),
      );
      this.lassoRing.renderOrder = 20;
      this.stage.scene.add(this.lassoRing);
    }
    this.lassoRing.visible = true;
    if (lasso.point && this.section) {
      // On the section plane: face the viewer across it.
      const at = this.regionToScenePoint(lasso.point);
      this.lassoRing.position.set(at.x + this.sceneShift.x, at.y, at.z + this.sceneShift.z);
      this.lassoRing.rotation.set(0, this.section.spec.plane.along === 'x' ? 0 : Math.PI / 2, 0);
    } else {
      this.lassoRing.position.set(lasso.gx - GRID.cols / 2, GRID.rows / 2 - lasso.gy, 3.5);
      this.lassoRing.rotation.set(0, 0, 0);
    }
    this.lassoRing.scale.setScalar(lasso.radius);
  }

  private hideLassoRing(): void {
    if (this.lassoRing) this.lassoRing.visible = false;
  }

  private finishLasso(lasso: NonNullable<Game['lasso']>): void {
    this.hideLassoRing();
    const result = lasso.point && this.section && this.spatial?.splitAt
      ? this.spatial.splitAt(lasso.point, lasso.radius)
      : this.sim.splitAt(lasso.gx, lasso.gy, lasso.radius);
    this.ui.setNote(result.message);
    if (!result.ok || !result.id) return;
    this.playerMesh.refreshColors();
    this.selectGroup(result.id);
    this.sound.chime('grow');
  }

  /**
   * The subcluster bar under the growth choices: the colony and each
   * subcluster with its strands and tips; select, or merge back. Also keeps the
   * Rest button honest about whichever group is selected.
   */
  private syncClusterControls(force = false): void {
    const net = this.groupNet();
    const summary = groupSummary(net);
    const key = `${this.selectedGroup}|${summary.map((g) => `${g.id}:${g.strands}:${g.tips}:${g.resting}`).join(',')}`;
    const rest = document.querySelector<HTMLButtonElement>('#rest');
    if (rest && this.selectedGroup) {
      const resting = groupResting(net, this.selectedGroup);
      rest.setAttribute('aria-pressed', String(resting));
      rest.textContent = resting ? 'Wake' : 'Rest';
    }
    if (!force && key === this.clusterKey) return;
    this.clusterKey = key;
    if (!this.clusterBar) {
      const bar = document.createElement('div');
      bar.className = 'cluster-bar';
      bar.setAttribute('role', 'group');
      bar.setAttribute('aria-label', 'Subclusters');
      const anchor = document.querySelector('.primary-intents') ?? document.querySelector('#rest');
      if (!anchor) return;
      anchor.after(bar);
      this.clusterBar = bar;
    }
    const bar = this.clusterBar;
    bar.hidden = summary.length <= 1;
    bar.innerHTML = summary.map((g) => {
      const label = g.id ? `Subcluster ${g.id}` : 'Colony';
      const state = g.resting ? ' · resting' : '';
      const merge = g.id ? `<button type="button" class="cluster-merge" data-merge="${g.id}" aria-label="Merge subcluster ${g.id} back into the colony">×</button>` : '';
      return `<span class="cluster-chip${g.id === this.selectedGroup ? ' is-selected' : ''}">` +
        `<button type="button" class="cluster-select" data-group="${g.id}" aria-pressed="${g.id === this.selectedGroup}">` +
        `${label} <small>${g.strands} strands · ${g.tips} tips${state}</small></button>${merge}</span>`;
    }).join('') + '<p class="cluster-hint">Hold on the soil to circle a subcluster. Esc: whole colony.</p>';
    for (const button of bar.querySelectorAll<HTMLButtonElement>('.cluster-select')) {
      button.addEventListener('click', () => this.selectGroup(Number(button.dataset.group)));
    }
    for (const button of bar.querySelectorAll<HTMLButtonElement>('.cluster-merge')) {
      button.addEventListener('click', () => {
        const id = Number(button.dataset.merge);
        if (this.section && this.spatial?.mergeGroup) this.spatial.mergeGroup(id); else this.sim.mergeGroup(id);
        this.playerMesh.refreshColors();
        if (this.selectedGroup === id) this.selectGroup(0); else this.syncClusterControls(true);
        this.ui.setNote(`Subcluster ${id} rejoins the colony and follows its orders.`);
      });
    }
  }

  private applyOrder(order: OrderId): void {
    if (!this.prepareLocalAction()) return;
    this.ui.setActiveOrder(order);
    const hints: Record<OrderId, string> = {
      grow: 'Click the soil to send the growth frontier there.',
      bond: 'Click a root tip to form a mycorrhizal bond.',
      cord: 'Click one of your strands to thicken it into a cord.',
      fruit: 'Click near the surface to raise a fruiting body.',
    };
    this.ui.setNote(hints[order]);
  }

  private prepareLocalAction(): boolean {
    if (this.stage.rig.view === 'forest') this.descend();
    return this.stage.rig.view === 'underground';
  }

  private aimAt(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set((clientX - rect.left) / rect.width * 2 - 1, 1 - (clientY - rect.top) / rect.height * 2);
    this.raycaster.setFromCamera(this.pointer, this.stage.rig.camera);
  }

  /** A click on a visible crown selects that tree and nothing else. */
  private pickCrown(clientX: number, clientY: number): boolean {
    this.aimAt(clientX, clientY);
    const crownProxies = this.surfaces
      .flatMap((surface) => surface.pickTargets)
      .filter((mesh) => mesh.userData.treeId !== undefined);
    const hit = this.raycaster.intersectObjects(crownProxies, false)[0];
    if (!hit) return false;
    this.selectTree(hit.object.userData.standId as number, hit.object.userData.treeId as number);
    return true;
  }

  /** A click on the ground falls back to the nearest tree of that stand. */
  private pickGround(clientX: number, clientY: number): boolean {
    this.aimAt(clientX, clientY);
    const intersections = this.raycaster.intersectObjects(this.surfaces.flatMap((surface) => surface.pickTargets), false);
    const treeHit = intersections.find(hit => hit.object.userData.treeId !== undefined);
    if (treeHit) {
      this.selectTree(treeHit.object.userData.standId as number, treeHit.object.userData.treeId as number);
      return true;
    }
    else if (intersections[0]) {
      const point = intersections[0].point;
      // Find the stand whose ground the click landed on, then its nearest tree.
      const standId = intersections[0].object.userData.standId as number | undefined;
      const surface = standId === undefined ? this.surface : this.surfaces[standId];
      const tree = surface?.nearestTree(point.x - surface.group.position.x, point.z - surface.group.position.z);
      if (tree && surface) {
        this.selectTree(surface.standId, tree.id);
        return true;
      }
    }
    return false;
  }

  private restart(): void {
    // A new seed is a new sheet; reload rather than rebuild every buffer.
    const next = Math.random().toString(36).slice(2, 9);
    // Keep the opt-in harness preset across a restart; ordinary matches have no
    // QA parameter and keep their existing URL shape.
    const qa = new URLSearchParams(location.search).get('qa') === 'fast' ? '&qa=fast' : '';
    location.search = `?seed=${next}${qa}`;
  }
}

/**
 * The crossing bench's fixture, as the game is allowed to see it.
 *
 * The bench uses the same coordinator as ordinary play but advances it on its
 * own fixed-step controls.
 */
interface LabCrossingMatch {
  step(dt: number): void;
  portals(): unknown[];
  orderAcross(): { ok: boolean; message: string };
  report(): string[];
  readonly time: number;
}

/**
 * The contract the forest views need from either spatial coordinator.
 */
interface SpatialFixture {
  readonly region: Region;
  readonly originStandId: number;
  /** The plane the colony was founded to grow along; optional for bench fixtures. */
  readonly plane?: { readonly along: 'x' | 'y'; readonly fixed: number };
  readonly time: number;
  colonyEdges(): Array<{
    key: string;
    parent: number;
    child: number;
    from: { x: number; y: number; z: number };
    to: { x: number; y: number; z: number };
    thickness: number;
    reinforced: boolean;
    connected: boolean;
    standId: number;
    parentStandId: number;
  }>;
  reachedStandIds(): number[];
  browsableStandIds(): number[];
  /** The body's network and its subclusters (a regional colony; bench fixtures may lack them). */
  readonly colony?: Network;
  splitAt?(point: { x: number; y: number; z: number }, radius: number): { ok: boolean; message: string; id?: number };
  mergeGroup?(id: number): boolean;
  groupNodeIds?(group: number): Set<number>;
  standFrame(standId: number): { originX: number; originY: number; size: number } | null;
  orderAcross(): { ok: boolean; message: string };
  step(dt: number): void;
  report(): string[];
  hash(): string;
}

/** Where the player left the forest, in absolute regional coordinates. */
interface ForestContext {
  regionX: number;
  regionY: number;
  targetY: number;
  distance: number;
  azimuth: number;
  elevation: number;
  autoFraming: boolean;
  standId: number | null;
  treeId: number | null;
  reveal: boolean;
}

/** What a click on a projected strand selected. */
interface RevealPickInfo {
  key: string;
  child: number;
  parent: number;
  depthCm: number;
  alternatives: number;
  connected: boolean;
}
