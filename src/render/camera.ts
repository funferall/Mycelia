import * as THREE from 'three';

export type WorldView = 'forest' | 'underground';

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
    const a = this.goal.azimuth;
    this.goal.target.x += dxWorld * Math.cos(a);
    if (this.view === 'forest') {
      this.goal.target.z -= dxWorld * Math.sin(a) + dyWorld * Math.cos(a);
      this.goal.target.x -= dyWorld * Math.sin(a);
    } else this.goal.target.y += dyWorld;
    this.clampTarget();
  }

  zoomBy(factor: number): void {
    const distance = this.goal.distance * factor;
    if (this.view === 'forest' && distance < 105) { this.setView('underground'); return; }
    if (this.view === 'underground' && distance > Math.max(360, this.overviewDistance * 1.12)) { this.setView('forest'); return; }
    this.goal.distance = THREE.MathUtils.clamp(
      distance,
      this.view === 'forest' ? 105 : this.bounds.minDistance,
      Math.max(this.bounds.maxDistance, this.overviewDistance * 1.2)
    );
  }

  tiltBy(dElevation: number, dAzimuth: number): void {
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
  frameMount(aspect: number, mountW: number, mountH: number, canopyH: number): void {
    if (this.view === 'forest') { this.frameForest(aspect); return; }
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

  focus(x: number, y: number, distance: number): void {
    this.setView('underground');
    this.goal.target.set(x + 8, y, 0);
    this.goal.distance = distance;
    this.goal.elevation = 0.08;
  }

  private clampTarget(): void {
    this.goal.target.x = THREE.MathUtils.clamp(this.goal.target.x, -120, 120);
    this.goal.target.y = THREE.MathUtils.clamp(this.goal.target.y, -70, 90);
    this.goal.target.z = this.view === 'forest' ? THREE.MathUtils.clamp(this.goal.target.z, -85, 5) : 0;
  }

  private overviewDistance = 350;

  get transitioning(): boolean { return Math.abs(this.surfaceBlend - this.surfaceGoal) > 0.015; }

  setView(view: WorldView, instant = false): void {
    if (view !== this.view) {
      this.remembered.set(this.view, { ...this.goal, target: this.goal.target.clone() });
      this.view = view;
      this.surfaceGoal = view === 'forest' ? 1 : 0;
      const saved = this.remembered.get(view);
      if (saved) { this.goal.target.copy(saved.target); this.goal.distance = saved.distance; this.goal.elevation = saved.elevation; this.goal.azimuth = saved.azimuth; }
      else if (view === 'forest') this.frameForest(this.camera.aspect);
      else this.focus(this.goal.target.x, 35, 160);
    }
    if (instant) this.snap();
  }

  frameForest(aspect: number): void {
    this.goal.target.set(aspect > 1.3 ? 20 : 0, 65, -38);
    this.goal.distance = Math.max(285, 185 / Math.max(0.5, aspect));
    this.goal.elevation = 1.02;
    this.goal.azimuth = 0.14;
  }

  focusTree(x: number, z: number): void {
    this.goal.target.set(x, 69, z);
    this.goal.distance = 150;
  }

  private snap(): void {
    this.target.copy(this.goal.target);
    this.distance = this.goal.distance;
    this.elevation = this.goal.elevation;
    this.azimuth = this.goal.azimuth;
    this.surfaceBlend = this.surfaceGoal;
    this.apply();
  }

  /** Exponential smoothing toward the goal state; called once per frame. */
  update(dt: number): void {
    if (this.reducedMotion) { this.snap(); return; }
    // Never smooth with a negative or absurd step: the rig is the one piece of
    // state whose corruption is unrecoverable at runtime.
    const step = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
    const k = 1 - Math.exp(-step * (this.transitioning ? 3.2 : 7.5));
    this.surfaceBlend += (this.surfaceGoal - this.surfaceBlend) * k;
    if (!Number.isFinite(this.distance) || !Number.isFinite(this.target.x)) {
      this.distance = this.goal.distance;
      this.target.copy(this.goal.target);
    }
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
