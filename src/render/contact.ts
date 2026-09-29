import * as THREE from 'three';
import type { Cast, Chemical, Front, Lingering } from '../sim/contact';
import type { Vec3 } from '../sim/spatial';

/**
 * Contact war as the soil shows it (C2/C3, first pass): each cast blooms as a
 * tinted stain that swells and fades, leachate and barrages linger as soft
 * clouds and dark rings, and every front is a slow, dark pulse — the zone line
 * where two individuals meet.
 *
 * Positions come from the game through `toScene`, which knows whether a stand
 * transect or a section is on screen; a point that view cannot show is skipped.
 */
const TINT: Record<Chemical, number> = {
  lyse: 0xf0a24a,     // carbon: amber
  leach: 0x86b6c0,    // water: slate blue
  ammonia: 0xc4d98a,  // nitrogen: sage
  oxalate: 0xffe3a0,  // carbon + nitrogen: hot pale acid
  coil: 0xc07ad8,     // all three: violet, the tech colour
  barrage: 0x2a1a10,  // melanin
};
const ENEMY_TINT = 0xd05a4a;
const POOL = 64;
const CAST_SECONDS = 1.1;

function radialTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function ringTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class ContactEffects {
  readonly group = new THREE.Group();
  private readonly glow = radialTexture();
  private readonly ring = ringTexture();
  private readonly sprites: THREE.Sprite[] = [];
  private used = 0;
  private clock = 0;

  constructor() {
    this.group.name = 'contact-effects';
    this.group.renderOrder = 20;
    for (let i = 0; i < POOL; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glow, transparent: true, depthWrite: false, depthTest: false,
        blending: THREE.AdditiveBlending,
      }));
      sprite.visible = false;
      this.group.add(sprite);
      this.sprites.push(sprite);
    }
  }

  private take(position: THREE.Vector3, size: number, color: number, opacity: number, map: THREE.Texture, additive: boolean): void {
    if (this.used >= this.sprites.length) return;
    const sprite = this.sprites[this.used++]!;
    const material = sprite.material as THREE.SpriteMaterial;
    if (material.map !== map) { material.map = map; material.needsUpdate = true; }
    const blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    if (material.blending !== blending) { material.blending = blending; material.needsUpdate = true; }
    material.color.setHex(color);
    material.opacity = opacity;
    sprite.position.copy(position);
    sprite.scale.setScalar(size);
    sprite.visible = true;
  }

  /**
   * Draw what is happening now. `mine` is the owner at the keyboard; the other
   * side's casts are drawn in a warning red so an attack reads at a glance.
   */
  update(
    dt: number,
    now: number,
    state: { casts: readonly Cast[]; lingering: readonly Lingering[]; fronts: readonly Front[]; radius: (chemical: Chemical) => number },
    mine: string,
    toScene: (point: Vec3) => THREE.Vector3 | null,
    visible: boolean
  ): void {
    this.clock += dt;
    this.used = 0;
    this.group.visible = visible;
    if (visible) {
      // Fronts: a slow dark pulse with a thin ember rim, the zone line.
      for (const front of state.fronts) {
        const at = toScene(front.centre);
        if (!at) continue;
        const pulse = 0.5 + 0.5 * Math.sin(this.clock * 3.2 + front.centre.x);
        const size = 5 + Math.min(10, Math.sqrt(front.contacts) * 2);
        this.take(at, size * 1.2, 0x1a0c06, 0.55, this.glow, false);
        this.take(at, size * (1 + 0.08 * pulse), ENEMY_TINT, 0.25 + 0.3 * pulse, this.ring, true);
      }
      for (const zone of state.lingering) {
        const at = toScene(zone.point);
        if (!at) continue;
        const left = Math.max(0, zone.until - now);
        const fade = Math.min(1, left / 1.5);
        if (zone.chemical === 'barrage') {
          this.take(at, zone.radius * 2.4, TINT.barrage, 0.7 * fade, this.ring, false);
        } else {
          const tint = zone.owner === mine ? TINT.leach : ENEMY_TINT;
          const breathe = 1 + 0.06 * Math.sin(this.clock * 5 + at.x);
          this.take(at, zone.radius * 2.6 * breathe, tint, 0.35 * fade, this.glow, true);
        }
      }
      for (let i = state.casts.length - 1; i >= 0; i--) {
        const cast = state.casts[i]!;
        const age = now - cast.at;
        if (age > CAST_SECONDS) break;
        if (age < 0) continue;
        const at = toScene(cast.point);
        if (!at) continue;
        const t = age / CAST_SECONDS;
        const tint = cast.owner === mine ? TINT[cast.chemical] : ENEMY_TINT;
        const radius = state.radius(cast.chemical);
        const heavy = cast.chemical === 'oxalate' || cast.chemical === 'coil' || cast.chemical === 'barrage';
        // A bright core that swells, and a ring that runs out to the reach of the chemical.
        this.take(at, radius * 2 * (0.4 + 0.8 * t), tint, (heavy ? 0.9 : 0.7) * (1 - t), this.glow, true);
        this.take(at, radius * 2.3 * (0.2 + t), tint, 0.8 * (1 - t) * (1 - t), this.ring, true);
      }
    }
    for (let i = this.used; i < this.sprites.length; i++) this.sprites[i]!.visible = false;
  }

  dispose(): void {
    for (const sprite of this.sprites) (sprite.material as THREE.Material).dispose();
    this.glow.dispose();
    this.ring.dispose();
  }
}
