import * as THREE from 'three';
import { GRID, SPECIES } from './sim/content';
import { nearestNode } from './sim/network';
import { Soundscape } from './audio/soundscape';
import { LivingView } from './render/living';
import { TILE_SIZE, SurfaceForest } from './render/surface';
import { COMMUNITY_LABEL, communityThresholds, createRegion, type Region } from './sim/region';
import { createStandWorld } from './sim/world';
import type { WorldView } from './render/camera';
import { Simulation } from './sim/sim';
import { OverlayFade } from './render/fade';
import { AssetLibrary } from './render/assets';
import { ForestView } from './render/forest';
import { HyphaeMesh, Motes } from './render/hyphae';
import { SoilMesh } from './render/soil';
import { Stage } from './render/stage';
import { makeGlowTexture } from './render/textures';
import type { QualityPreset } from './render/quality';
import { deriveJourney, type Journey, type RootTarget } from './ui/journey';
import { SheetUI, type OrderId } from './ui/sheet';

const FIXED_STEP = 1 / 60;

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
  private readonly soil: SoilMesh;
  private readonly playerMesh: HyphaeMesh;
  private readonly rivalMesh: HyphaeMesh;
  private readonly playerMotes: Motes;
  private readonly rivalMotes: Motes;
  private readonly forest: ForestView;
  private readonly ui: SheetUI;
  private readonly living: LivingView;
  /**
   * One surface per stand, so the region is drawn as one landscape. Only the
   * stand the player's colony stands in can be entered; the rest are ground the
   * forest shows and the simulation is not yet running.
   */
  private readonly surfaces: SurfaceForest[] = [];
  private readonly region: Region;
  /** Authored models, if any have been built yet; the game runs without them. */
  private readonly assets = new AssetLibrary();
  /** Stand the selected crown stands in, or null while nothing is chosen. */
  private selectedStandId: number | null = null;
  /** Everything drawn inside the soil, faded as one body during a crossing. */
  private readonly overlays: OverlayFade;
  private readonly sound = new Soundscape();
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private ambientMotion = !this.reducedMotion;
  private lastView = '';
  private awakened = false;
  private markerClock = 0;
  private journeyClock = 0;
  private journey: Journey | null = null;
  private lastBonds = 0;
  private lastFruits = 0;
  private readonly markerButtons = new Map<string, HTMLButtonElement>();
  /** What each label does when clicked, rebound on every marker update. */
  private readonly markerActions = new Map<string, () => void>();

  private speed = 0;
  private accumulator = 0;
  private lastFrame = 0;
  private raf = 0;
  private seasonId = '';
  private steward = false;
  private stewardClock = 0;

  private pointerDown = false;
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
    this.sim = new Simulation(seedText);

    this.stage = new Stage(canvas, quality);
    const glow = makeGlowTexture(64);

    this.soil = new SoilMesh(this.sim.world);
    this.stage.scene.add(this.soil.group);

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
    this.region = createRegion(seedText);
    this.buildRegionStand();
    // Art is opportunistic: the stand above is already drawn procedurally, and
    // whatever loads is handed over as it arrives.
    void this.assets.load().then(() => this.adoptAssets());
    this.living = new LivingView(this.sim);
    this.stage.scene.add(this.living.group);
    this.overlays = new OverlayFade([
      this.playerMesh.group,
      this.rivalMesh.group,
      this.playerMotes.points,
      this.rivalMotes.points,
      this.forest.group,
      this.living.group,
    ]);

    ui.buildRail(this.sim);
    this.frameSheet();
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
    for (const site of this.region.stands) {
      const world =
        site.id === founding.id
          ? this.sim.world
          : createStandWorld(site.seed, {
              waterTableCm: site.waterTableCm,
              mix: communityThresholds(site.community),
            });
      const surface = new SurfaceForest(world, {
        id: site.id,
        originX: site.sx * TILE_SIZE,
        originY: site.sy * TILE_SIZE,
        heightAt: (x, y) => this.region.heightAt(x, y),
      }, this.assets);
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
   * Give every stand the art that has loaded, and say out loud what is missing.
   *
   * A missing model is a warning rather than an error: the procedural stand is
   * the fallback, and the browser checks must keep passing while art is made.
   */
  private adoptAssets(): void {
    for (const surface of this.surfaces) surface?.adoptAssets();
    for (const note of this.assets.failures) console.warn(`mycelia: ${note}`);
  }

  /** The stand the player can enter: the one their colony stands in. */
  private get surface(): SurfaceForest {
    return this.surfaces[this.region.foundingStand] as SurfaceForest;
  }

  private get enterableStand(): number {
    return this.region.foundingStand;
  }

  /** Recompute the default framing for the current viewport. */
  private frameSheet(): void {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    // The forest is framed as the whole region now, not one stand: the mosaic
    // spans three tiles each way.
    const span = this.region.cols * TILE_SIZE;
    // Centred on the region rather than on the colony's own tile, so the rows
    // nearest the camera stay in the picture.
    const founding = this.region.stands[this.region.foundingStand];
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
      this.sim.step(FIXED_STEP);
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
    selectedStandId: number | null;
    selectedTreeId: number | null;
    simSeconds: number;
  } {
    const surfaces = this.surfaces.filter((surface): surface is SurfaceForest => Boolean(surface));
    return {
      ...this.stage.qualityReport(),
      stands: surfaces.length,
      trees: surfaces.reduce((total, surface) => total + surface.trees.length, 0),
      selectedStandId: this.selectedStandId,
      selectedTreeId: this.surfaces[this.region.foundingStand]?.selectedId ?? null,
      simSeconds: Math.round(this.sim.time),
    };
  }

  private frame(now: number): void {
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
    while (this.accumulator >= FIXED_STEP && steps < 24) {
      this.sim.step(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
      steps++;
    }

    this.soil.update(dt);
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
    // The soil's contents dissolve through the middle of a crossing rather than
    // switching off at a threshold, so the terrain closes over the network on
    // the way up and they return as it opens on the way down.
    const overlay = 1 - THREE.MathUtils.smoothstep(blend, 0.3, 0.9);
    // Every stand in the region is a window onto the same forest, so every
    // surface is stepped: without this a neighbouring tile draws its floor but
    // its trees stay at their unplaced origin, buried under the slab.
    for (const surface of this.surfaces) {
      if (!surface) continue;
      surface.update(dt, blend, this.sim.season.id, this.sim.seasonClock / this.sim.season.seconds, !this.ambientMotion);
    }
    this.living.update(this.sim, dt, this.reducedMotion, overlay);
    const bonds = this.sim.world.trees.filter(tree => tree.rootTips.some(tip => tip.bondedTo !== null)).length;
    if (bonds > this.lastBonds) this.sound.chime('bond');
    if (this.sim.player.fruited > this.lastFruits) this.sound.chime('fruit');
    this.lastBonds = bonds;
    this.lastFruits = this.sim.player.fruited;
    this.sound.update(bonds);

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
      this.journey = deriveJourney(this.sim);
    }
    this.ui.update(this.sim, dt, this.journey);
    this.ui.showOutcome(this.sim, () => this.restart());
    // Last word on the overlays: the views above write their own opacities, so
    // the fade is applied after them and nothing is left half lit.
    this.overlays.apply(overlay);
    this.stage.render(dt);
    this.markerClock += dt;
    if (this.markerClock > 0.1) {
      this.markerClock = 0;
      this.updateMarkers(this.journey);
    }
  }

  private awaken(): void {
    if (this.awakened) return;
    this.awakened = true;
    document.querySelector<HTMLElement>('#begin')!.hidden = true;
    document.querySelector<HTMLElement>('#journey')!.hidden = false;
    this.setSpeed(1);
    this.ui.setNote('Click a root label to reach toward it. Click again when close to bond.');
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
    document.querySelector('#begin')!.addEventListener('click', () => { this.descend(); this.awaken(); });
    document.querySelector('#rest')!.addEventListener('click', () => {
      if (this.sim.outcome !== 'playing') return;
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
        const where = standId === this.enterableStand ? 'your stand' : COMMUNITY_LABEL[site.community];
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
    this.stage.rig.setView(view);
    this.syncViewUI();
  }

  private descend(): void {
    // Only the stand holding the colony can be entered: the others are ground
    // the region is keeping for a spore that has not landed yet.
    if (this.selectedStandId !== null && this.selectedStandId !== this.enterableStand) {
      this.ui.setNote('That stand has no colony in it yet. Fruit spores into it from ground you hold.');
      return;
    }
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
    surface.selectedId = id;
    document.querySelector<HTMLSelectElement>('#forest-tree')!.value = `${standId}:${id}`;
    // The camera frames the region from the founding stand's own origin, so a
    // neighbouring stand's tree has to be moved into that frame to be looked at.
    const position = surface.surfacePosition(id);
    if (position) this.stage.rig.focusTree(position.x + surface.group.position.x, position.z + surface.group.position.z);
    this.updateTreeNote();
  }

  private updateTreeNote(): void {
    const standId = this.selectedStandId;
    const site = standId === null ? null : this.region.stands[standId];
    const tree = standId === null ? null : this.surfaces[standId]?.trees.find((tree) => tree.tree.id === this.surfaces[standId]?.selectedId)?.tree;
    const where = site
      ? standId === this.enterableStand
        ? 'your own stand'
        : `${COMMUNITY_LABEL[site.community]} · no colony here yet`
      : '';
    const status = !tree
      ? 'Choose a crown to follow its roots.'
      : `${SPECIES[tree.species].common} · ${tree.dead ? 'Deadwood' : tree.health < 0.5 ? 'Struggling' : 'Living'} · ${
          standId === this.enterableStand
            ? tree.rootTips.some((tip) => tip.bondedTo !== null)
              ? 'Bonded to your network'
              : 'Not yet bonded'
            : 'beyond your colony'
        } · ${where}`;
    document.querySelector('#tree-status')!.textContent = status;
  }

  private syncViewUI(): void {
    const rig = this.stage.rig;
    const transition = rig.transitioning;
    const state = `${rig.view}:${transition}`;
    if (this.lastView === state) return;
    this.lastView = state;
    document.body.dataset.view = rig.view;
    document.body.classList.toggle('view-transition', transition);
    for (const view of ['forest', 'underground']) document.querySelector(`#view-${view}`)!.setAttribute('aria-pressed', String(rig.view === view));
    document.querySelector('#view-status')!.textContent = transition ? (rig.view === 'forest' ? 'Rising through the canopy…' : 'Following the roots…') : (rig.view === 'forest' ? 'Above the forest floor' : 'Within the living soil');
    document.querySelector('.camera-hint')!.textContent = rig.view === 'forest'
      ? 'Drag to wander · Shift-drag to orbit · Scroll to descend · V to switch views'
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
          ? `\u25c7 Bond \u00b7 ${name} \u00b7 gathering`
          : `\u25c7 Bond \u00b7 ${name}`,
      aria: distant
        ? `Grow toward ${spec.common}, about ${Math.round(target.distance)} centimetres away`
        : target.state === 'poor'
          ? `The strand nearest ${spec.common} has too little carbon to bond yet`
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
      canvas.setPointerCapture(event.pointerId);
    });

    canvas.addEventListener('pointermove', (event) => {
      if (!this.pointerDown) return;
      const dx = event.clientX - this.lastX;
      const dy = event.clientY - this.lastY;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      this.pointerMoved += Math.abs(dx) + Math.abs(dy);

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
      // A drag is a camera move; a tap is an order.
      if (this.pointerMoved < 6 && !this.stage.rig.transitioning) {
        if (this.stage.rig.view === 'forest') this.pickTree(event.clientX, event.clientY);
        else this.applyOrderAt(event.clientX, event.clientY);
      }
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', () => { this.pointerDown = false; });

    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.canvas.clientHeight : 1);
        const before = this.stage.rig.view;
        this.stage.rig.zoomBy(Math.exp(THREE.MathUtils.clamp(delta, -160, 160) * 0.0011));
        if (before === 'forest' && this.stage.rig.view === 'underground') this.descend();
      },
      { passive: false }
    );

    window.addEventListener('keydown', (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key.toLowerCase() === 'v') { event.preventDefault(); if (this.stage.rig.view === 'forest') this.descend(); else this.setView('forest'); }
      if (event.target === canvas && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        this.stage.rig.pan(event.key === 'ArrowLeft' ? -6 : event.key === 'ArrowRight' ? 6 : 0, event.key === 'ArrowUp' ? 6 : event.key === 'ArrowDown' ? -6 : 0);
      }
      if (event.key === '+' || event.key === '=') this.stage.rig.zoomBy(0.85);
      if (event.key === '-') this.stage.rig.zoomBy(1.15);
      if (event.code === 'Space' && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        this.awaken();
        this.setSpeed(this.speed === 0 ? 1 : 0);
      }
      if (event.key.toLowerCase() === 'r' && this.awakened) document.querySelector<HTMLButtonElement>('#rest')!.click();
      if (event.key.toLowerCase() === 'h') document.querySelector<HTMLButtonElement>('#immersive')!.click();
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

  private applyOrderAt(clientX: number, clientY: number): void {
    if (this.stage.rig.view !== 'underground' || this.stage.rig.transitioning) return;
    if (!this.awakened || this.sim.outcome !== 'playing') return;
    const point = this.gridAt(clientX, clientY);
    if (!point) return;
    const order = this.ui.order;
    if (order === 'grow') {
      if (this.sim.orderGrowth(point.gx, point.gy)) {
        this.living.acknowledge(point.gx, point.gy);
        this.sound.chime('grow');
        this.ui.setNote(
          `Frontier directed to ${Math.round(point.gx)} · −${Math.max(0, Math.round(point.gy))}cm`
        );
      } else this.ui.setNote('Choose open soil inside the specimen. Stone cannot be crossed.');
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

  private applyOrder(order: OrderId): void {
    if (this.stage.rig.view === 'forest') this.descend();
    this.ui.setActiveOrder(order);
    const hints: Record<OrderId, string> = {
      grow: 'Click the soil to send the growth frontier there.',
      bond: 'Click a root tip to form a mycorrhizal bond.',
      cord: 'Click one of your strands to thicken it into a cord.',
      fruit: 'Click near the surface to raise a fruiting body.',
    };
    this.ui.setNote(hints[order]);
  }

  private pickTree(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set((clientX - rect.left) / rect.width * 2 - 1, 1 - (clientY - rect.top) / rect.height * 2);
    this.raycaster.setFromCamera(this.pointer, this.stage.rig.camera);
    const intersections = this.raycaster.intersectObjects(this.surfaces.flatMap((surface) => surface.pickTargets), false);
    const treeHit = intersections.find(hit => hit.object.userData.treeId !== undefined);
    if (treeHit) {
      this.selectTree(treeHit.object.userData.standId as number, treeHit.object.userData.treeId as number);
      return;
    }
    else if (intersections[0]) {
      const point = intersections[0].point;
      // Find the stand whose ground the click landed on, then its nearest tree.
      const standId = intersections[0].object.userData.standId as number | undefined;
      const surface = standId === undefined ? this.surface : this.surfaces[standId];
      const tree = surface?.nearestTree(point.x, point.z);
      if (tree && surface) this.selectTree(surface.standId, tree.id);
    }
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
