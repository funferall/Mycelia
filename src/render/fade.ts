import * as THREE from 'three';

/**
 * Dissolves the displays that live inside the soil.
 *
 * Two networks, their traffic, the forest's roots and the living rewards are
 * all drawn *through* the specimen, so none of them belongs on screen once the
 * camera has risen above the forest floor. Switching them off at a blend
 * threshold made them leave in a single frame; this fades each material from
 * its own opacity instead, so the soil closes over them on the way up and they
 * return on the way down.
 *
 * A material's base opacity is captured the first time the fade touches it, so
 * a deliberately dim material — a root line at 0.8, a founder at 0.85 — fades
 * from its own value rather than being forced to full strength.
 */
export class OverlayFade {
  private readonly base = new WeakMap<THREE.Material, number>();
  private shown = 1;
  /**
   * Which settled state the materials are currently in: 1 at full strength, 0
   * faded out, -1 part way. Endpoints are written once, on the frame they are
   * entered, so a crossing that lands on its last frame in one coarse step
   * still leaves the overlays exactly right rather than part way faded.
   */
  private settled = -1;

  constructor(private readonly roots: THREE.Object3D[]) {}

  /** How much of the overlay is showing: 1 underground, 0 above the floor. */
  get opacity(): number {
    return this.shown;
  }

  /** `fade` is 1 underground, 0 once the camera is above the forest floor. */
  apply(fade: number): void {
    const value = Number.isFinite(fade) ? Math.max(0, Math.min(1, fade)) : 1;
    this.shown = value;

    // Hidden outright when it is gone, so a surface frame draws none of the
    // soil's contents at all.
    const visible = value > 0.004;
    for (const root of this.roots) root.visible = visible;

    if (visible && value >= 1) {
      if (this.settled !== 1) {
        this.write(1);
        this.settled = 1;
      }
      return;
    }
    if (!visible) {
      if (this.settled !== 0) {
        this.write(0);
        this.settled = 0;
      }
      return;
    }
    this.write(value);
    this.settled = -1;
  }

  /** Stamp every material in the overlay set with one fade value. */
  private write(fade: number): void {
    for (const root of this.roots) {
      root.traverse((object) => {
        const material = (object as { material?: THREE.Material | THREE.Material[] }).material;
        if (!material) return;
        if (Array.isArray(material)) for (const one of material) this.dim(one, fade);
        else this.dim(material, fade);
      });
    }
  }

  private dim(material: THREE.Material, fade: number): void {
    // A view that animates its own opacity writes it again every frame, and
    // stamping a captured base over that would freeze the animation. Those
    // materials carry the fade themselves and are skipped here.
    if (material.userData.animatedOpacity === true) return;
    let base = this.base.get(material);
    if (base === undefined) {
      base = material.opacity;
      this.base.set(material, base);
      // Every overlay material is transparent by construction. This is a guard
      // for a future addition rather than the mechanism.
      if (!material.transparent) {
        material.transparent = true;
        material.needsUpdate = true;
      }
    }
    material.opacity = base * fade;
  }
}
