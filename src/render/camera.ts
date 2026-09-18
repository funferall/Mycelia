import * as THREE from 'three';

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
    this.goal.target.x += dxWorld;
    this.goal.target.y += dyWorld;
    this.clampTarget();
  }

  zoomBy(factor: number): void {
    this.goal.distance = THREE.MathUtils.clamp(
      this.goal.distance * factor,
      this.bounds.minDistance,
      this.bounds.maxDistance
    );
  }

  tiltBy(dElevation: number, dAzimuth: number): void {
    this.goal.elevation = THREE.MathUtils.clamp(
      this.goal.elevation + dElevation,
      0,
      this.bounds.maxElevation
    );
    this.goal.azimuth = THREE.MathUtils.clamp(
      this.goal.azimuth + dAzimuth,
      -this.bounds.maxAzimuth,
      this.bounds.maxAzimuth
    );
  }

  /**
   * Frame the mount so the specimen sits in the middle of the paper with the
   * left margin left free for the depth rail and the right for the catalogue
   * block — rather than the soil running off both edges of the screen.
   */
  frameMount(aspect: number, mountW: number, mountH: number, canopyH: number): void {
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

    // Place the mount so its left edge lands 12% across the viewport: the left
    // margin carries the depth rail, and everything right of the mount is bare
    // paper for the catalogue block and the spore packet.
    const viewWidth = 2 * halfTan * distance * aspect;
    this.goal.target.x = viewWidth * 0.38 - mountW / 2;
    // Centre the frame on the mount plus its canopy, so the trees break the top
    // edge of the specimen rather than being cropped out of the picture.
    this.goal.target.y = canopyH / 2;
    this.goal.elevation = 0.11;
    this.goal.azimuth = 0;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  focus(x: number, y: number, distance: number): void {
    this.goal.target.set(x + 8, y, 0);
    this.goal.distance = distance;
    this.goal.elevation = 0.08;
  }

  private clampTarget(): void {
    this.goal.target.x = THREE.MathUtils.clamp(this.goal.target.x, -120, 120);
    this.goal.target.y = THREE.MathUtils.clamp(this.goal.target.y, -70, 90);
  }

  /** Exponential smoothing toward the goal state; called once per frame. */
  update(dt: number): void {
    // Never smooth with a negative or absurd step: the rig is the one piece of
    // state whose corruption is unrecoverable at runtime.
    const step = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
    const k = 1 - Math.exp(-step * 7.5);
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
