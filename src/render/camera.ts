import * as THREE from 'three';

export type WorldView = 'forest' | 'underground';

/**
 * Wall-clock seconds a full crossing between the two views takes.
 *
 * A crossing is a presentation event, so it is timed against the clock rather
 * than against frames: the rise takes the same second and a half on a machine
 * running at twelve frames per second as on one running at a hundred and
 * twenty. Smoothing alone could not promise that, because its per-frame step is
 * clamped and a slow frame therefore stretched the crossing.
 */
const CROSSING_SECONDS = 1.5;

/** Even a reversal late in a crossing keeps a legible beat instead of snapping. */
const CROSSING_FLOOR_SECONDS = 0.35;

/** A single frame is never allowed to account for more than this much of a crossing. */
const CROSSING_MAX_STEP_SECONDS = 2;

/**
 * Camera rig for the sheet.
 *
 * The default view is almost flat — you are looking at a sheet of paper lying
 * on a table, photographed from a low angle. Tilting lifts you off that plane so
 * the soil column opens into real depth and the hyphae separate into layers.
 * The tilt is the game's only "3D" affordance, and it is deliberately small:
 * this is a specimen, not a diorama.
 */

export interface CameraBounds {
  minDistance: number;
  maxDistance: number;
  /** Radians. */
  maxElevation: number;
  /** Radians. */
  maxAzimuth: number;
}

export class CameraRig {
  view: WorldView = 'underground';
  surfaceBlend = 0;
  reducedMotion = false;
  private surfaceGoal = 0;
  private readonly remembered = new Map<WorldView, { target: THREE.Vector3; distance: number; elevation: number; azimuth: number }>();
  /** The live pose at the moment a crossing began; see `beginCrossing`. */
  private readonly crossingFrom = {
    target: new THREE.Vector3(0, 10, 0),
    distance: 260,
    elevation: 0.11,
    azimuth: 0,
  };
  private crossingFromBlend = 0;
  private crossingElapsed = 0;
  private crossingDuration = 0;
  private crossing = false;
  /**
   * Whether each view's framing still follows the viewport. Clear it the moment
   * the player aims the camera themselves: a resize must re-derive the default
   * framing, never pull someone back from where they were looking.
   */
  private readonly autoByView: Record<WorldView, boolean> = { forest: true, underground: true };
  /** The last mount and stand being framed, so a resize can frame them again. */
  private mountFraming: { mountW: number; mountH: number; canopyH: number; standDepth: number; standWidth: number } | null = null;
  private reframePending = false;
  readonly camera: THREE.PerspectiveCamera;
  readonly target = new THREE.Vector3(0, 10, 0);
  distance = 260;
  azimuth = 0;
  elevation = 0.11;

  private readonly goal = {
    target: new THREE.Vector3(0, 10, 0),
    distance: 260,
    azimuth: 0,
    elevation: 0.11,
  };

  readonly bounds: CameraBounds = {
    minDistance: 46,
    maxDistance: 420,
    maxElevation: 0.5,
    maxAzimuth: 0.26,
  };

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(30, aspect, 1, 3000);
    this.apply();
  }

  /** Pan by a screen-space delta, in world units at the current distance. */
  pan(dxWorld: number, dyWorld: number): void {
    this.autoByView[this.view] = false;
    const a = this.goal.azimuth;
    this.goal.target.x += dxWorld * Math.cos(a);
    if (this.view === 'forest') {
      this.goal.target.z -= dxWorld * Math.sin(a) + dyWorld * Math.cos(a);
      this.goal.target.x -= dyWorld * Math.sin(a);
    } else this.goal.target.y += dyWorld;
    this.clampTarget();
  }

  zoomBy(factor: number): void {
    this.autoByView[this.view] = false;
    const distance = this.goal.distance * factor;
    if (this.view === 'forest' && distance < 105) { this.setView('underground'); return; }
    if (this.view === 'underground' && distance > Math.max(360, this.overviewDistance * 1.12)) { this.setView('forest'); return; }
    // The ceiling belongs to the view being zoomed: a stand framed for a narrow
    // window sits much further back than a mount on the same screen.
    const ceiling = this.view === 'forest'
      ? Math.max(this.bounds.maxDistance, this.forestOverview * 1.15)
      : Math.max(this.bounds.maxDistance, this.overviewDistance * 1.2);
    this.goal.distance = THREE.MathUtils.clamp(
      distance,
      this.view === 'forest' ? 105 : this.bounds.minDistance,
      ceiling
    );
  }

  tiltBy(dElevation: number, dAzimuth: number): void {
    this.autoByView[this.view] = false;
    this.goal.elevation = THREE.MathUtils.clamp(
      this.goal.elevation + dElevation,
      this.view === 'forest' ? 0.6 : 0,
      this.view === 'forest' ? 1.35 : this.bounds.maxElevation
    );
    this.goal.azimuth = THREE.MathUtils.clamp(
      this.goal.azimuth + dAzimuth,
      this.view === 'forest' ? -0.85 : -this.bounds.maxAzimuth,
      this.view === 'forest' ? 0.85 : this.bounds.maxAzimuth
    );
  }

  /**
   * Frame the mount so the specimen sits in the middle of the paper with the
   * left margin left free for the depth rail and the right for the catalogue
   * block — rather than the soil running off both edges of the screen.
   */
  frameMount(aspect: number, mountW: number, mountH: number, canopyH: number, standDepth = 76, standWidth = mountW): void {
    // Remembered so a viewport change can frame the same mount again.
    this.mountFraming = { mountW, mountH, canopyH, standDepth, standWidth };
    if (this.view === 'forest') { this.frameForest(aspect); return; }
    this.autoByView.underground = true;
    const fov = (this.camera.fov * Math.PI) / 180;
    const halfTan = Math.tan(fov / 2);
    // Vertical: the mount, the canopy above it, and a little paper below.
    const wantedHeight = mountH + canopyH + 22;
    // Horizontal: the mount plus room either side for the printed margins.
    const wantedWidth = mountW + 116;
    const distance = Math.max(
      wantedHeight / 2 / halfTan,
      wantedWidth / 2 / (halfTan * Math.max(0.5, aspect))
    );
    this.goal.distance = distance;
    this.overviewDistance = distance;

    // Place the mount so its left edge lands 12% across the viewport: the left
    // margin carries the depth rail, and everything right of the mount is bare
    // paper for the catalogue block and the spore packet.
    const viewWidth = 2 * halfTan * distance * aspect;
    this.goal.target.x = viewWidth * 0.38 - mountW / 2;
    // Centre the frame on the mount plus its canopy, so the trees break the top
    // edge of the specimen rather than being cropped out of the picture.
    this.goal.target.y = canopyH / 2;
    this.goal.target.z = 0;
    this.goal.elevation = 0.11;
    this.goal.azimuth = 0;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** True while the active view's framing is still derived from the viewport. */
  get autoFraming(): boolean {
    return this.autoByView[this.view];
  }

  /** Where the framing is heading; the live pose eases toward it. */
  get goalDistance(): number {
    return this.goal.distance;
  }

  /**
   * Re-derive the active view's framing after the viewport changed shape.
   *
   * The default framing is a function of the aspect ratio, so a window that
   * changes shape leaves it stale. This applies to the default framing only:
   * panning, zooming, tilting or following a specific tree all clear
   * `autoFraming`, and those cameras are the player's.
   */
  reframe(): void {
    if (!this.autoFraming) return;
    // Mid-crossing the pose is an interpolation toward the goal, so moving the
    // goal underneath it would jump the picture. Land first, then re-frame.
    if (this.crossing) {
      this.reframePending = true;
      return;
    }
    this.applyFraming();
  }

  private applyFraming(): void {
    if (this.view === 'forest') this.frameForest(this.camera.aspect);
    else if (this.mountFraming) {
      const { mountW, mountH, canopyH, standDepth, standWidth } = this.mountFraming;
      this.frameMount(this.camera.aspect, mountW, mountH, canopyH, standDepth, standWidth);
    } else this.focus(this.goal.target.x, 35, 160);
  }

  focus(x: number, y: number, distance: number): void {
    // Switch first: the flag belongs to the view that ends up framed.
    this.setView('underground');
    this.autoByView[this.view] = false;
    this.goal.target.set(x + 8, y, 0);
    this.goal.distance = distance;
    this.goal.elevation = 0.08;
  }

  private clampTarget(): void {
    if (this.view === 'forest') {
      const halfWidth = (this.mountFraming?.standWidth ?? 136) / 2 + 52;
      const halfDepth = (this.mountFraming?.standDepth ?? 76) / 2 + 30;
      this.goal.target.x = THREE.MathUtils.clamp(this.goal.target.x, this.forestCentre.x - halfWidth, this.forestCentre.x + halfWidth);
      this.goal.target.z = THREE.MathUtils.clamp(this.goal.target.z, this.forestCentre.z - halfDepth, this.forestCentre.z + halfDepth);
      return;
    }
    this.goal.target.x = THREE.MathUtils.clamp(this.goal.target.x, -120, 120);
    this.goal.target.y = THREE.MathUtils.clamp(this.goal.target.y, -70, 90);
    this.goal.target.z = 0;
  }

  private overviewDistance = 350;
  /** The distance the whole stand is framed at; see `frameForest`. */
  private forestOverview = 285;
  /**
   * Where the forest should be centred, in the frame the stands are laid out
   * in. One stand centres on itself; a region centres on the region, or the
   * rows nearest the camera fall out of the picture.
   */
  forestCentre: { x: number; z: number } = { x: 0, z: -38 };

  /** Move the regional coordinate origin without moving the forest on screen. */
  rebaseForest(dx: number, dz: number): void {
    const shift = new THREE.Vector3(dx, 0, dz);
    this.forestCentre.x += dx;
    this.forestCentre.z += dz;
    this.remembered.get('forest')?.target.add(shift);
    if (this.view === 'forest') {
      this.target.add(shift);
      this.goal.target.add(shift);
      this.crossingFrom.target.add(shift);
      this.apply();
    }
    // Underground poses belong to the previous stand.
    this.remembered.delete('underground');
    this.autoByView.underground = true;
  }

  /** True for as long as the rig is crossing between the two views. */
  get transitioning(): boolean { return this.crossing; }

  /** Seconds of wall clock the current crossing has taken, and its budget. */
  get crossingProgress(): { elapsed: number; duration: number } {
    return { elapsed: this.crossingElapsed, duration: this.crossingDuration };
  }

  setView(view: WorldView, instant = false): void {
    if (view !== this.view) {
      this.remembered.set(this.view, { ...this.goal, target: this.goal.target.clone() });
      this.view = view;
      this.surfaceGoal = view === 'forest' ? 1 : 0;
      // A remembered pose is the player's own camera; a view still framing
      // itself from the viewport has nothing worth remembering, and re-deriving
      // it here is what keeps a view entered after a resize from arriving
      // framed for the window that used to be there.
      const saved = this.remembered.get(view);
      if (saved && !this.autoByView[view]) { this.goal.target.copy(saved.target); this.goal.distance = saved.distance; this.goal.elevation = saved.elevation; this.goal.azimuth = saved.azimuth; }
      else if (view === 'forest') this.frameForest(this.camera.aspect);
      else if (this.mountFraming) {
        const { mountW, mountH, canopyH, standDepth, standWidth } = this.mountFraming;
        this.frameMount(this.camera.aspect, mountW, mountH, canopyH, standDepth, standWidth);
      } else this.focus(this.goal.target.x, 35, 160);
      // Turn-around is a crossing too: reversing mid-rise starts a new
      // crossing from wherever the picture actually is.
      this.beginCrossing();
    }
    if (instant) this.snap();
  }

  frameForest(aspect: number): void {
    this.autoByView.forest = true;
    const halfTan = Math.tan(((this.camera.fov * Math.PI) / 180) / 2);
    const stand = this.mountFraming;
    // The stand is as wide as the mount and a little over half as deep, and a
    // narrow viewport has to fit it across the frame. Fitting only the height
    // crops the ends of the stand on a portrait window.
    const halfWidth = (stand ? stand.standWidth : 136) / 2 + 34;
    const depth = stand ? stand.standDepth : 76;
    const narrow = Math.max(0.35, aspect);
    this.goal.distance = Math.max(
      285,
      185 / narrow,
      halfWidth / (halfTan * narrow),
      (depth * 0.6) / halfTan
    );
    this.goal.target.set(this.forestCentre.x + (aspect > 1.3 ? 20 : 0), 65, this.forestCentre.z);
    this.goal.elevation = 1.02;
    this.goal.azimuth = 0.14;
    this.forestOverview = this.goal.distance;
  }

  focusTree(x: number, z: number): void {
    this.setView('forest');
    this.autoByView[this.view] = false;
    this.goal.target.set(x, 69, z);
    this.goal.distance = 150;
  }

  private snap(): void {
    this.target.copy(this.goal.target);
    this.distance = this.goal.distance;
    this.elevation = this.goal.elevation;
    this.azimuth = this.goal.azimuth;
    this.surfaceBlend = this.surfaceGoal;
    this.crossing = false;
    this.crossingElapsed = 0;
    this.crossingDuration = 0;
    this.apply();
  }

  /**
   * Capture where the picture is right now as the start of a new crossing.
   *
   * Duration follows how much blend is left to travel rather than a fixed
   * number of seconds, which is what makes a reversal at half way take half as
   * long and keeps the apparent speed of the sheet constant.
   */
  private beginCrossing(): void {
    this.crossingFrom.target.copy(this.target);
    this.crossingFrom.distance = this.distance;
    this.crossingFrom.elevation = this.elevation;
    this.crossingFrom.azimuth = this.azimuth;
    this.crossingFromBlend = this.surfaceBlend;
    const travel = Math.abs(this.surfaceGoal - this.surfaceBlend);
    this.crossingDuration = Math.max(CROSSING_FLOOR_SECONDS, CROSSING_SECONDS * travel);
    this.crossingElapsed = 0;
    this.crossing = true;
  }

  /**
   * Advance a crossing against the wall clock.
   *
   * `wallDt` is the real time since the previous frame, deliberately not the
   * clamped step the simulation runs on: a machine too slow to keep up still
   * finishes the rise in one and a half seconds.
   */
  private advanceCrossing(wallDt: number): void {
    const wall = Number.isFinite(wallDt) ? Math.max(0, Math.min(CROSSING_MAX_STEP_SECONDS, wallDt)) : 0;
    this.crossingElapsed += wall;
    const t = this.crossingDuration > 0 ? Math.min(1, this.crossingElapsed / this.crossingDuration) : 1;
    // Ease in and out, so the sheet settles into the new view rather than
    // arriving at speed.
    const e = t * t * (3 - 2 * t);
    this.surfaceBlend = this.crossingFromBlend + (this.surfaceGoal - this.crossingFromBlend) * e;
    this.target.lerpVectors(this.crossingFrom.target, this.goal.target, e);
    this.distance = this.crossingFrom.distance + (this.goal.distance - this.crossingFrom.distance) * e;
    this.elevation = this.crossingFrom.elevation + (this.goal.elevation - this.crossingFrom.elevation) * e;
    this.azimuth = this.crossingFrom.azimuth + (this.goal.azimuth - this.crossingFrom.azimuth) * e;
    if (t < 1) { this.apply(); return; }
    this.snap();
    if (this.reframePending) {
      this.reframePending = false;
      this.applyFraming();
    }
  }

  /**
   * Advance the rig one frame.
   *
   * A crossing runs on `wallDt`; ordinary camera smoothing runs on `dt`, the
   * clamped step that keeps a long stall from making the rig diverge.
   */
  update(dt: number, wallDt: number = dt): void {
    if (this.reducedMotion) {
      this.snap();
      // A reduced-motion rig never crosses, so a reframe deferred by a crossing
      // would otherwise wait for one that will not happen.
      if (this.reframePending) {
        this.reframePending = false;
        this.applyFraming();
      }
      return;
    }
    if (this.crossing) { this.advanceCrossing(wallDt); return; }
    // Never smooth with a negative or absurd step: the rig is the one piece of
    // state whose corruption is unrecoverable at runtime.
    const step = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
    const k = 1 - Math.exp(-step * 7.5);
    if (!Number.isFinite(this.distance) || !Number.isFinite(this.target.x)) {
      this.distance = this.goal.distance;
      this.target.copy(this.goal.target);
    }
    this.surfaceBlend += (this.surfaceGoal - this.surfaceBlend) * k;
    this.target.lerp(this.goal.target, k);
    this.distance += (this.goal.distance - this.distance) * k;
    this.azimuth += (this.goal.azimuth - this.azimuth) * k;
    this.elevation += (this.goal.elevation - this.elevation) * k;
    this.apply();
  }

  private apply(): void {
    const cosE = Math.cos(this.elevation);
    const x = Math.sin(this.azimuth) * cosE * this.distance;
    const y = Math.sin(this.elevation) * this.distance;
    const z = Math.cos(this.azimuth) * cosE * this.distance;
    this.camera.position.set(this.target.x + x, this.target.y + y, this.target.z + z);
    this.camera.lookAt(this.target);
  }
}
