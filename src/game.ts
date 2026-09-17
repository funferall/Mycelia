import * as THREE from 'three';
import { GRID } from './sim/content';
import { Simulation } from './sim/sim';
import { ForestView } from './render/forest';
import { HyphaeMesh, Motes } from './render/hyphae';
import { SoilMesh } from './render/soil';
import { Stage } from './render/stage';
import { makeGlowTexture } from './render/textures';
import { SheetUI, type OrderId } from './ui/sheet';

const FIXED_STEP = 1 / 60;

const PLAYER_PALETTE = {
  core: new THREE.Color('#ffd9a0'),
  glow: new THREE.Color('#ff9a2e'),
};
const RIVAL_PALETTE = {
  core: new THREE.Color('#eaf7dc'),
  glow: new THREE.Color('#8fbe78'),
};

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

  private speed = 1;
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
    this.rivalMesh = new HyphaeMesh(RIVAL_PALETTE, glow);
    this.stage.scene.add(this.playerMesh.group, this.rivalMesh.group);

    this.playerMotes = new Motes(glow, 900, 1337);
    this.rivalMotes = new Motes(glow, 420, 4242);
    this.stage.scene.add(this.playerMotes.points, this.rivalMotes.points);

    this.forest = new ForestView(this.sim.world);
    this.stage.scene.add(this.forest.group);

    ui.buildRail(this.sim);
    this.frameSheet();
    this.bindInput();
    this.bindSpeed();
    this.ui.onOrder((order) => this.applyOrder(order));
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
    while (this.accumulator >= FIXED_STEP && steps < 12) {
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

    if (this.steward) {
      this.stewardClock -= dt * Math.max(1, this.speed);
      if (this.stewardClock <= 0) {
        this.stewardClock = 4;
        this.stewardTick();
      }
    }

    this.ui.update(this.sim, dt);
    this.ui.showOutcome(this.sim, () => this.restart());
    this.stage.render(dt);
  }

  private bindSpeed(): void {
    for (const button of document.querySelectorAll<HTMLButtonElement>('.speed-row button')) {
      button.addEventListener('click', () => {
        this.speed = Number(button.dataset.speed ?? 1);
        for (const other of document.querySelectorAll('.speed-row button')) {
          other.classList.toggle('is-on', other === button);
        }
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
    canvas.addEventListener('pointercancel', release);

    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.stage.rig.zoomBy(Math.exp(event.deltaY * 0.0011));
      },
      { passive: false }
    );

    window.addEventListener('keydown', (event) => {
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
    const point = this.gridAt(clientX, clientY);
    if (!point) return;
    const order = this.ui.order;
    if (order === 'grow') {
      if (this.sim.orderGrowth(point.gx, point.gy)) {
        this.ui.setNote(
          `Frontier directed to ${Math.round(point.gx)} · −${Math.max(0, Math.round(point.gy))}cm`
        );
      }
      return;
    }
    if (order === 'bond') {
      this.ui.setNote(this.sim.orderBond(point.gx, point.gy).message);
      return;
    }
    if (order === 'cord') {
      this.ui.setNote(this.sim.orderCord(point.gx, point.gy).message);
      return;
    }
    this.ui.setNote(this.sim.orderFruit(point.gx, point.gy).message);
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
