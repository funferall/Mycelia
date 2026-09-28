/**
 * The player's fruiting bodies, standing on the forest floor above the strand
 * they rose from (`CORE-04`, `ATM-05`).
 *
 * The transect shows an eruption as a cross-section; this is the same event
 * seen from above, in the region's own coordinates, so the two views agree
 * about where the mushroom is. It is drawn where the bloom's own recorded site
 * is: nothing here invents a position, and a body whose site the simulation
 * never bound to regional soil is simply not drawn above ground.
 *
 * Presentation only. A body is an authored model when that file has arrived
 * and nothing at all when it has not, exactly as the scenery behaves, and the
 * simulation never reads anything back from here.
 */
import * as THREE from 'three';
import type { Vec3 } from '../sim/spatial';
import type { AssetLibrary } from './assets';
import { BODY_ASSET, SURFACE_BODY_HEIGHT, stageAt } from './bodies';
import { disposeInstance } from './dispose';

/** One earned body, in the region's own coordinates. */
export interface FruitingSite {
  /** Stable for the life of the site: a stand and the bloom's own index. */
  readonly key: string;
  /** Where the body stands, on the ground. */
  readonly point: Vec3;
  /** 0..1 for a body still rising; 1 for a bloom that has finished. */
  readonly progress: number;
  /** Whether this is a completed bloom or an eruption still under way. */
  readonly bloomed: boolean;
}

interface Body {
  readonly object: THREE.Object3D;
  readonly baseScale: number;
  readonly groundOffset: number;
  readonly bornAt: number;
}

export class FruitingView {
  readonly group = new THREE.Group();
  private readonly bodies = new Map<string, Body>();
  private clock = 0;
  /** What was drawn last, so a rebuild happens only when the scene changes. */
  private signature = '';
  private sites: readonly FruitingSite[] = [];
  private waiting = 0;
  private triangles = 0;

  constructor(
    private readonly assets: AssetLibrary,
    private readonly toScene: (point: Vec3) => THREE.Vector3
  ) {}

  /**
   * Stand a body at every site, and let the ones that are still erupting grow.
   *
   * The site list changes only when a bloom is recorded or an eruption starts,
   * and the art arrives once, so the signature costs nothing on ordinary
   * frames and a rebuild happens only when there is something new to draw.
   */
  update(dt: number, sites: readonly FruitingSite[], visible = true): void {
    this.clock += dt;
    this.sites = sites;
    const signature = Object.values(BODY_ASSET).map((id) => this.assets.has(id) ? 1 : 0).join('') +
      sites.map((site) => `${site.key}:${site.bloomed ? 'bloom' : stageAt(site.progress)}`).join('|');
    if (signature !== this.signature) {
      this.signature = signature;
      this.rebuild();
    }
    for (const site of this.sites) {
      const body = this.bodies.get(site.key);
      if (!body) continue;
      const scene = this.toScene(site.point);
      const grown = Math.min(1, (this.clock - body.bornAt) / 0.6);
      const grow = (site.bloomed ? grown : Math.max(0.02, site.progress)) * grown;
      body.object.position.set(scene.x, scene.y + body.groundOffset * body.baseScale * grow, scene.z);
      body.object.scale.setScalar(body.baseScale * grow);
    }
    // The forest floor folds away during a crossing, so a body above ground is
    // drawn only while the ground it stands on is.
    this.group.visible = visible && this.bodies.size > 0;
  }

  /** What is standing above ground, for the readout and the browser checks. */
  report(): { sites: number; standing: number; waiting: number; triangles: number } {
    return { sites: this.sites.length, standing: this.bodies.size, waiting: this.waiting, triangles: this.triangles };
  }

  dispose(): void {
    for (const body of this.bodies.values()) disposeInstance(body.object);
    this.bodies.clear();
    this.sites = [];
    this.signature = '';
    this.waiting = 0;
    this.triangles = 0;
  }

  // -------------------------------------------------------------------------

  /** One batch of bodies, one object each: there are only ever a few. */
  private rebuild(): void {
    for (const body of this.bodies.values()) disposeInstance(body.object);
    this.bodies.clear();
    this.waiting = 0;
    this.triangles = 0;
    for (const site of this.sites) {
      const stage = site.bloomed ? 'bloom' : stageAt(site.progress);
      const instance = this.assets.instance(BODY_ASSET[stage], SURFACE_BODY_HEIGHT[stage]);
      if (!instance) {
        // A missing file is not an error state: the body is simply not drawn
        // above ground, and the sheet below still shows the eruption.
        this.waiting++;
        continue;
      }
      const object = instance.object;
      const yaw = yawOf(site.key);
      object.rotation.y = yaw;
      this.group.add(object);
      this.bodies.set(site.key, {
        object,
        baseScale: object.scale.x,
        groundOffset: object.position.y / Math.max(1e-6, object.scale.x),
        bornAt: this.clock,
      });
      this.triangles += trianglesOf(object);
    }
  }
}

/** A stable yaw per site, so a clump of bodies is not one repeated heading. */
function yawOf(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193) >>> 0;
  }
  return (hash / 4294967296) * Math.PI * 2;
}

function trianglesOf(object: THREE.Object3D): number {
  let triangles = 0;
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry as THREE.BufferGeometry;
    const count = geometry.index ? geometry.index.count : geometry.attributes.position?.count ?? 0;
    triangles += count / 3;
  });
  return triangles;
}
