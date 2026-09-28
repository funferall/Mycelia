import * as THREE from 'three';
import { GRID } from '../sim/content';
import type { Simulation } from '../sim/sim';
import { mulberry32 } from '../sim/rng';
import type { AssetLibrary } from './assets';
import { BODY_ASSET, SOIL_BODY_HEIGHT, stageAt, type BodyStage } from './bodies';
import { disposeInstance } from './dispose';
import { makeGlowTexture } from './textures';

/** One body standing on the sheet: an authored model, or its own stand-in. */
interface Body {
  readonly stage: BodyStage;
  readonly object: THREE.Object3D;
  /** Scale that makes this body stand at its stage's own height. */
  readonly baseScale: number;
  /** Ground-contact correction at that scale. */
  readonly groundOffset: number;
  /** When this body appeared, on a clock that runs even in reduced motion. */
  readonly bornAt: number;
  /** True while this body is the procedural stand-in for art that has not arrived. */
  readonly procedural: boolean;
}

/** The tangible rewards: a breathing founder, deliberate growth marks, mushrooms and spores. */
export class LivingView {
  readonly group = new THREE.Group();
  private readonly founder: THREE.Sprite;
  private readonly target: THREE.LineLoop;
  private readonly pulse: THREE.LineLoop;
  private readonly bodies: Body[] = [];
  private readonly spores: THREE.Points;
  private readonly sporeData = new Float32Array(180 * 3);
  private time = 0;
  /** A clock that keeps running when motion is reduced, for arriving bodies. */
  private bodyClock = 0;
  private pulseAge = 10;
  private fruits = 0;

  constructor(sim: Simulation, private readonly assets?: AssetLibrary) {
    const glow = makeGlowTexture();
    this.founder = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: '#ffc16c', blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, opacity: 0.85 }));
    const root = sim.player.nodes[0];
    this.founder.position.set(root.wx - GRID.cols / 2, GRID.rows / 2 - root.wy, 3);
    this.group.add(this.founder);
    const circle = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 64 }, (_, i) => new THREE.Vector3(Math.cos(i / 64 * Math.PI * 2), Math.sin(i / 64 * Math.PI * 2), 0)));
    this.target = new THREE.LineLoop(circle, new THREE.LineBasicMaterial({ color: '#dfb875', transparent: true, opacity: 0.65, depthTest: false }));
    const pulseMaterial = new THREE.LineBasicMaterial({ color: '#ffce8b', transparent: true, opacity: 0, depthTest: false });
    // This material's opacity is written every frame below, so the overlay fade
    // must not stamp a captured base over it; `update` carries the fade instead.
    pulseMaterial.userData.animatedOpacity = true;
    this.pulse = new THREE.LineLoop(circle, pulseMaterial);
    this.group.add(this.target, this.pulse);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.sporeData, 3));
    this.spores = new THREE.Points(geometry, new THREE.PointsMaterial({ map: glow, color: '#ffe1a0', size: 1.1, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.spores.frustumCulled = false;
    this.group.add(this.spores);
  }

  acknowledge(gx: number, gy: number): void {
    this.pulse.position.set(gx - GRID.cols / 2, GRID.rows / 2 - gy, 4);
    this.pulseAge = 0;
  }

  /**
   * `fade` is how much of the soil's contents is on screen: 1 underground, 0
   * once the camera is above the forest floor. It is applied to the one
   * material here that animates its own opacity; the rest are faded by
   * `OverlayFade` along with the networks and the roots.
   */
  update(sim: Simulation, dt: number, reduced: boolean, fade = 1): void {
    this.time += reduced ? 0 : dt;
    this.bodyClock += dt;
    this.pulseAge += dt;
    this.founder.scale.setScalar(3.5 + Math.sin(this.time * 1.3) * 0.45);
    const waypoint = sim.player.waypoints[0];
    this.target.visible = !!waypoint;
    if (waypoint) {
      this.target.position.set(waypoint.gx - GRID.cols / 2, GRID.rows / 2 - waypoint.gy, 4);
      this.target.scale.setScalar(1.4 + Math.sin(this.time * 1.5) * 0.2);
    }
    this.pulse.scale.setScalar(1 + this.pulseAge * 4);
    (this.pulse.material as THREE.LineBasicMaterial).opacity = Math.max(0, 0.75 - this.pulseAge * 0.4) * fade;
    // Every body stands where its own eruption actually happened, so a warm-up
    // or a future saved match shows the same sheet the player earned.
    const blooms = sim.player.blooms;
    const active = sim.player.fruit.active ? sim.player.fruit : null;
    const wanted: { stage: BodyStage; gx: number; gy: number; grow: number }[] = [];
    for (const bloom of blooms) {
      wanted.push({ stage: 'bloom', gx: bloom.gx, gy: bloom.gy, grow: 1 });
    }
    if (active) {
      wanted.push({ stage: stageAt(active.progress), gx: active.gx, gy: active.gy, grow: Math.max(0.02, active.progress) });
    }
    this.syncBodies(wanted);
    for (const [index, body] of this.bodies.entries()) {
      const site = wanted[index];
      if (!site) continue;
      // A bloom stands where its own eruption left it, so it arrives over half
      // a second rather than popping into place. A body still erupting is
      // already animated by its progress, and must not restart on the frame its
      // cap replaces its primordium.
      const arrived = site.stage === 'bloom' ? Math.min(1, (this.bodyClock - body.bornAt) / 0.45) : 1;
      const grow = site.grow * arrived;
      const lift = body.groundOffset * body.baseScale * grow;
      body.object.position.set(site.gx - GRID.cols / 2, GRID.rows / 2 + 0.2 + lift, 2);
      body.object.scale.setScalar(body.baseScale * grow);
    }
    this.spores.visible = blooms.length > 0;
    if (blooms.length > this.fruits) {
      this.fruits = blooms.length;
      const latest = blooms[blooms.length - 1];
      if (latest) this.acknowledge(latest.gx, latest.gy);
    }
    for (let i = 0; i < 180; i++) {
      const origin = this.bodies[i % Math.max(1, this.bodies.length)];
      const phase = (this.time * 0.65 + i * 0.47) % 24;
      this.sporeData[i * 3] = (origin?.object.position.x ?? 0) + Math.sin(i * 42 + phase * 0.2) * phase * 0.55;
      this.sporeData[i * 3 + 1] = GRID.rows / 2 + 5 + phase;
      this.sporeData[i * 3 + 2] = 3 + Math.sin(i * 13) * 3;
    }
    this.spores.geometry.attributes.position.needsUpdate = true;
  }

  /**
   * Keep one body per site, in the stage the site is in.
   *
   * A body is rebuilt only when its stage changes or when the authored model
   * for that stage has arrived since it was built, so the sheet swaps its
   * stand-in for the real art without ever waiting for it.
   */
  private syncBodies(wanted: readonly { stage: BodyStage }[]): void {
    while (this.bodies.length > wanted.length) {
      const body = this.bodies.pop();
      if (body) disposeInstance(body.object);
    }
    wanted.forEach((site, index) => {
      const current = this.bodies[index];
      if (current && current.stage === site.stage) {
        // Keep it, unless it is a stand-in for art that has now arrived.
        const art = this.assets?.has(BODY_ASSET[site.stage]) ?? false;
        if (!current.procedural || !art) return;
      }
      if (current) disposeInstance(current.object);
      const body = this.buildBody(site.stage, index);
      this.bodies[index] = body;
      this.group.add(body.object);
    });
  }

  /**
   * What the sheet is standing: every body on it, and how many of those are the
   * authored model rather than a stand-in for art that has not arrived.
   */
  report(): { bodies: number; authored: number; spores: boolean } {
    let authored = 0;
    for (const body of this.bodies) if (!body.procedural) authored++;
    return { bodies: this.bodies.length, authored, spores: this.spores.visible };
  }

  /** One body at its stage's own height: the authored model, else its stand-in. */
  private buildBody(stage: BodyStage, index: number): Body {
    const height = SOIL_BODY_HEIGHT[stage];
    const instance = this.assets?.instance(BODY_ASSET[stage], height);
    if (instance) {
      // Transparent from the start, like the caps below: the view crossing
      // dissolves the soil's contents and must not recompile a shader to do it.
      instance.object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          material.transparent = true;
        }
      });
      return {
        stage,
        object: instance.object,
        baseScale: instance.object.scale.x,
        groundOffset: instance.object.position.y / Math.max(1e-6, instance.object.scale.x),
        bornAt: this.bodyClock,
        procedural: false,
      };
    }
    const stand = makeMushrooms(index);
    const bounds = new THREE.Box3().setFromObject(stand);
    const authored = Math.max(0.001, bounds.max.y - bounds.min.y);
    return {
      stage,
      object: stand,
      baseScale: height / authored,
      groundOffset: -bounds.min.y,
      bornAt: this.bodyClock,
      procedural: true,
    };
  }
}

function makeMushrooms(seed: number): THREE.Group {
  const group = new THREE.Group();
  const rng = mulberry32(seed + 987);
  const profile = [new THREE.Vector2(0, 1.2), new THREE.Vector2(0.5, 1.18), new THREE.Vector2(1.3, 0.85), new THREE.Vector2(1.9, 0.25), new THREE.Vector2(2, 0), new THREE.Vector2(1.5, 0.05), new THREE.Vector2(0, 0.2)];
  const capGeometry = new THREE.LatheGeometry(profile, 40);
  // Transparent from the start so the view crossing can dissolve the caps
  // without recompiling their shaders mid-transition.
  const capMaterial = new THREE.MeshStandardMaterial({ color: '#db994a', roughness: 0.55, emissive: '#945018', emissiveIntensity: 0.2, side: THREE.DoubleSide, transparent: true });
  for (let i = 0; i < 5; i++) {
    const single = new THREE.Group();
    const height = 2 + rng() * 3;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.24, height, 10), new THREE.MeshStandardMaterial({ color: '#ead8a9', roughness: 0.8, transparent: true }));
    stem.position.y = height / 2;
    const cap = new THREE.Mesh(capGeometry, capMaterial);
    cap.position.y = height;
    cap.scale.setScalar(0.55 + rng() * 0.5);
    single.add(stem, cap);
    single.position.x = (i - 2) * 1.4;
    single.rotation.z = (rng() - 0.5) * 0.25;
    group.add(single);
  }
  return group;
}
