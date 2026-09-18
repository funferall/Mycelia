import * as THREE from 'three';
import { GRID, SPECIES } from './sim/content';
import { nearestNode } from './sim/network';
import { Soundscape } from './audio/soundscape';
import { LivingView } from './render/living';
import { Canopy } from './render/canopy';
import { Simulation } from './sim/sim';
import { ForestView } from './render/forest';
import { HyphaeMesh, Motes } from './render/hyphae';
import { SoilMesh } from './render/soil';
import { Stage } from './render/stage';
import { makeGlowTexture } from './render/textures';
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
  private readonly canopy: Canopy;
  private readonly sound = new Soundscape();
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
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

  constructor(canvas: HTMLCanvasElement, ui: SheetUI, seedText: string) {
    this.canvas = canvas;
    this.ui = ui;
    this.sim = new Simulation(seedText);

    this.stage = new Stage(canvas);
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
    this.stage.scene.add(this.forest.group);
    this.canopy = new Canopy(this.sim.world);
    this.living = new LivingView(this.sim);
    this.stage.scene.add(this.canopy.group, this.living.group);

    ui.buildRail(this.sim);
    this.frameSheet();
    this.bindInput();
    this.bindSpeed();
    this.bindExperience();
    this.ui.onOrder((order) => this.applyOrder(order));
    this.setSpeed(0);
  }

  /** Recompute the default framing for the current viewport. */
  private frameSheet(): void {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.stage.rig.frameMount(aspect, GRID.cols, GRID.rows, 34);
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

  private frame(now: number): void {
    // Clamped at both ends. The upper bound stops a spiral of death after a
    // long stall; the lower bound matters because requestAnimationFrame reports
    // the frame's start time, which can precede a `performance.now()` taken
    // just before it — and a negative timestep makes the camera's smoothing
    // diverge instead of converge.
    const dt = Math.max(0, Math.min(0.1, (now - this.lastFrame) / 1000));
    this.lastFrame = now;

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
    this.canopy.update(dt, this.sim.season.id, this.reducedMotion);
    this.living.update(this.sim, dt, this.reducedMotion);
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
    document.querySelector('#begin')!.addEventListener('click', () => this.awaken());
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
    if (!journey) return;

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
      if (this.pointerMoved < 6) this.applyOrderAt(event.clientX, event.clientY);
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', () => { this.pointerDown = false; });

    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.stage.rig.zoomBy(Math.exp(event.deltaY * 0.0011));
      },
      { passive: false }
    );

    window.addEventListener('keydown', (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLInputElement) return;
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
      this.frameSheet();
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
    this.ui.setActiveOrder(order);
    const hints: Record<OrderId, string> = {
      grow: 'Click the soil to send the growth frontier there.',
      bond: 'Click a root tip to form a mycorrhizal bond.',
      cord: 'Click one of your strands to thicken it into a cord.',
      fruit: 'Click near the surface to raise a fruiting body.',
    };
    this.ui.setNote(hints[order]);
  }

  private restart(): void {
    // A new seed is a new sheet; reload rather than rebuild every buffer.
    const next = Math.random().toString(36).slice(2, 9);
    location.search = `?seed=${next}`;
  }
}
