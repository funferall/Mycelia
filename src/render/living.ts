import * as THREE from 'three';
import { GRID } from '../sim/content';
import type { Simulation } from '../sim/sim';
import { mulberry32 } from '../sim/rng';
import { makeGlowTexture } from './textures';

/** The tangible rewards: a breathing founder, deliberate growth marks, mushrooms and spores. */
export class LivingView {
  readonly group = new THREE.Group();
  private readonly founder: THREE.Sprite;
  private readonly target: THREE.LineLoop;
  private readonly pulse: THREE.LineLoop;
  private readonly mushrooms: THREE.Group[] = [];
  private readonly spores: THREE.Points;
  private readonly sporeData = new Float32Array(180 * 3);
  private time = 0;
  private pulseAge = 10;
  private fruits = 0;

  constructor(sim: Simulation) {
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
    // Every mushroom stands where its own bloom actually happened, so a warm-up
    // or a future saved match shows the same sheet the player earned.
    const blooms = sim.player.blooms;
    const active = sim.player.fruit.active ? sim.player.fruit : null;
    const wanted = blooms.length + (active ? 1 : 0);
    while (this.mushrooms.length < wanted) {
      const mushroom = makeMushrooms(this.mushrooms.length);
      this.mushrooms.push(mushroom);
      this.group.add(mushroom);
    }
    this.mushrooms.forEach((mushroom, i) => {
      const bloom = blooms[i];
      const gx = bloom ? bloom.gx : active ? active.gx : 0;
      const progress = bloom ? 1 : active ? active.progress : 0;
      mushroom.position.set(gx - GRID.cols / 2, GRID.rows / 2 + 0.2, 2);
      mushroom.scale.setScalar(0.04 + progress * 0.96);
    });
    this.spores.visible = blooms.length > 0;
    if (blooms.length > this.fruits) {
      this.fruits = blooms.length;
      const latest = blooms[blooms.length - 1];
      if (latest) this.acknowledge(latest.gx, latest.gy);
    }
    for (let i = 0; i < 180; i++) {
      const origin = this.mushrooms[i % Math.max(1, this.mushrooms.length)];
      const phase = (this.time * 0.65 + i * 0.47) % 24;
      this.sporeData[i * 3] = (origin?.position.x ?? 0) + Math.sin(i * 42 + phase * 0.2) * phase * 0.55;
      this.sporeData[i * 3 + 1] = GRID.rows / 2 + 5 + phase;
      this.sporeData[i * 3 + 2] = 3 + Math.sin(i * 13) * 3;
    }
    this.spores.geometry.attributes.position.needsUpdate = true;
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
