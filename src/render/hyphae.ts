import * as THREE from 'three';
import { GRID } from '../sim/content';
import type { HyphaNode, Network } from '../sim/network';
import { mulberry32 } from '../sim/rng';

/** Grid coordinates -> world position. Row 0 sits at the top of the mount. */
export function nodePosition(node: HyphaNode, out: THREE.Vector3): THREE.Vector3 {
  // Depth through the slab comes from the node id, so a strand keeps its layer
  // as it grows and the network reads as a volume rather than a decal.
  const h = (node.id * 2654435761) >>> 0;
  const z = ((h % 1000) / 1000 - 0.5) * 3.4;
  return out.set(node.wx - GRID.cols / 2, -node.wy + GRID.rows / 2, z);
}

const UP = new THREE.Vector3(0, 1, 0);
/** Frames between passes over the whole network. */
const SWEEP_FRAMES = 12;
/** Passes it takes the rolling refresh to redraw every settled strand once. */
const REFRESH_SWEEPS = 8;
/** Dirty slots closer than this are uploaded as one range. */
const UPLOAD_GAP = 64;
/** The player's selected subcluster. */
const SELECTED = new THREE.Color('#9fe6ff');
const FLOW_COOL = new THREE.Color('#ff9a3c');
const FLOW_HOT = new THREE.Color('#fff2cf');

export interface HyphaePalette {
  core: THREE.Color;
  glow: THREE.Color;
}

export interface HyphaeOptions {
  /**
   * Multiplies every strand radius. The rival colony is drawn thinner than
   * the player so the two networks stay distinguishable by texture as well as
   * by hue -- the design system requires identity to survive colour-vision
   * deficiency, and a hue swap alone would not.
   */
  radiusScale?: number;
  /** Instance capacity before the mesh starts growing itself. */
  capacity?: number;
}

/**
 * One network, drawn as instanced segments.
 *
 * Committed strands never move, so a frame touches only what changes: new
 * strands claim a free instance slot, and growing tips and freshly pulsed
 * strands are rewritten. Every `SWEEP_FRAMES` frames one pass over the whole
 * network finds deaths and new pulses and refreshes a rolling share of the
 * settled strands, so thickening and starving still show. Only the slots
 * written are sent to the GPU, not the whole instance buffer. That keeps a
 * large network cheap enough to animate at 60fps while still letting every
 * filament exist as real geometry rather than a texture.
 */
export class HyphaeMesh {
  readonly group = new THREE.Group();
  mesh: THREE.InstancedMesh;
  readonly tips: THREE.Points;

  private readonly palette: HyphaePalette;
  private readonly radiusScale: number;
  private capacity: number;
  private slotOf: Int32Array;
  private nodeOf: Int32Array;
  private slotCount = 0;
  /** Slots below `slotCount` given back by dead strands, reused before new ones. */
  private freeSlots: number[] = [];
  /** Slots written since the last upload. */
  private dirty: number[] = [];
  /** The network last drawn, and how many of its nodes have been seen. */
  private source: Network | null = null;
  private seen = 0;
  /** Strands rewritten every frame: growing tips and pulsing strands. */
  private active = new Set<number>();
  private sweepClock = 0;
  /** Next slot of the rolling refresh of settled strands. */
  private refreshAt = 0;
  private readonly tipCapacity: number;

  private readonly dummy = new THREE.Object3D();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly mid = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly color = new THREE.Color();
  /** Subcluster whose strands are lit as the player's selection (0: none). */
  private highlight = 0;
  /** Recolour every strand on the next sync, not just the moving ones. */
  private recolor = false;

  /** Light one subcluster's strands and tips as the current selection. */
  setHighlight(group: number): void {
    if (group === this.highlight) return;
    this.highlight = group;
    this.recolor = true;
  }

  /** Strands changed group without moving: recolour everything next sync. */
  refreshColors(): void {
    this.recolor = true;
  }

  constructor(palette: HyphaePalette, glowMap: THREE.Texture, options: HyphaeOptions = {}) {
    this.palette = palette;
    this.radiusScale = options.radiusScale ?? 1;
    const capacity = options.capacity ?? 24000;
    this.capacity = capacity;
    this.slotOf = new Int32Array(1024).fill(-1);
    this.nodeOf = new Int32Array(capacity).fill(-1);

    const geometry = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      // Normal blending, not additive. A mycelial network is thousands of
      // overlapping strands; additively blending them sums to a white smear
      // wherever the network thickens, which destroys exactly the filament
      // structure the art direction depends on. Overdraw paints over instead
      // of accumulating, and bloom supplies the glow.
      blending: THREE.NormalBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 2;
    this.group.add(this.mesh);

    this.tipCapacity = 1400;
    const tipGeometry = new THREE.BufferGeometry();
    tipGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(this.tipCapacity * 3), 3)
    );
    tipGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(this.tipCapacity * 3), 3)
    );
    this.tips = new THREE.Points(
      tipGeometry,
      new THREE.PointsMaterial({
        size: 2.2,
        sizeAttenuation: true,
        map: glowMap,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        vertexColors: true,
        toneMapped: false,
      })
    );
    this.tips.frustumCulled = false;
    this.tips.renderOrder = 3;
    this.group.add(this.tips);
  }

  private ensureNodeCapacity(nodeCount: number): void {
    if (nodeCount <= this.slotOf.length) return;
    let next = this.slotOf.length;
    while (next < nodeCount) next *= 2;
    const grown = new Int32Array(next).fill(-1);
    grown.set(this.slotOf);
    this.slotOf = grown;
  }

  /** InstancedMesh capacity is fixed, so a bigger one replaces it when needed. */
  private growInstances(needed: number): void {
    if (needed <= this.capacity) return;
    let next = this.capacity;
    while (next < needed) next *= 2;

    const old = this.mesh;
    const replacement = new THREE.InstancedMesh(old.geometry, old.material, next);
    replacement.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    replacement.frustumCulled = false;
    replacement.renderOrder = old.renderOrder;
    replacement.count = old.count;

    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    for (let i = 0; i < this.slotCount; i++) {
      old.getMatrixAt(i, m);
      replacement.setMatrixAt(i, m);
      old.getColorAt(i, c);
      replacement.setColorAt(i, c);
    }
    this.markDirty(0);
    this.markDirty(Math.max(0, this.slotCount - 1));

    this.group.remove(old);
    this.group.add(replacement);
    this.mesh = replacement;

    const grown = new Int32Array(next).fill(-1);
    grown.set(this.nodeOf.subarray(0, Math.min(next, this.nodeOf.length)));
    this.nodeOf = grown;
    this.capacity = next;
    old.dispose();
  }

  /** Bring the drawn geometry in line with the simulation's network. */
  reset(): void {
    this.slotOf.fill(-1);
    this.nodeOf.fill(-1);
    this.slotCount = 0;
    this.freeSlots = [];
    this.dirty = [];
    this.source = null;
    this.seen = 0;
    this.active.clear();
    this.sweepClock = 0;
    this.refreshAt = 0;
    this.mesh.count = 0;
    this.tips.geometry.setDrawRange(0, 0);
  }

  sync(net: Network): void {
    if (net !== this.source) {
      this.reset();
      this.source = net;
    }
    const nodes = net.nodes;
    const count = nodes.length;
    this.ensureNodeCapacity(count);

    // New strands since the last frame.
    if (count > this.seen) {
      this.growInstances(this.slotCount + count - this.seen);
      for (let id = this.seen; id < count; id++) {
        const node = nodes[id]!;
        if (node.parent < 0 || !node.alive) continue;
        this.place(nodes, node);
        this.active.add(id);
      }
      this.seen = count;
    }

    // Now and then, the whole network: deaths, new pulses, and a rolling share
    // of settled strands redrawn so thickening and starving show. A selection
    // change recolours everything at once.
    if (this.recolor || ++this.sweepClock >= SWEEP_FRAMES) this.sweep(nodes, this.recolor);
    this.recolor = false;

    // Only gliding tips and freshly pulsed strands change shape between frames.
    for (const id of this.active) {
      const node = nodes[id]!;
      const slot = this.slotOf[id] as number;
      if (!node.alive) {
        if (slot >= 0) this.hideSlot(slot);
        this.active.delete(id);
        continue;
      }
      const parent = nodes[node.parent];
      if (slot >= 0 && parent) this.writeSegment(node, parent, slot);
      if (!node.isTip && node.pulse <= 0.02) this.active.delete(id);
    }

    this.mesh.count = this.slotCount;
    this.upload();
    this.syncTips(nodes);
  }

  /** Give a living strand a slot and draw it. */
  private place(nodes: HyphaNode[], node: HyphaNode): void {
    const slot = this.claimSlot();
    if (slot < 0) return;
    this.slotOf[node.id] = slot;
    this.nodeOf[slot] = node.id;
    const parent = nodes[node.parent];
    if (parent) this.writeSegment(node, parent, slot);
  }

  private sweep(nodes: HyphaNode[], all: boolean): void {
    this.sweepClock = 0;
    for (let id = 0; id < this.seen; id++) {
      const node = nodes[id]!;
      if (node.parent < 0) continue;
      const slot = this.slotOf[id] as number;
      if (!node.alive) {
        if (slot >= 0) this.hideSlot(slot);
        continue;
      }
      // A strand a view had hidden (outside its band) can come back.
      if (slot < 0) {
        this.growInstances(this.slotCount + 1);
        this.place(nodes, node);
        continue;
      }
      if (all) {
        const parent = nodes[node.parent];
        if (parent) this.writeSegment(node, parent, slot);
      } else if (node.isTip || node.pulse > 0.02) {
        this.active.add(id);
      }
    }
    if (all || this.slotCount === 0) return;
    const share = Math.ceil(this.slotCount / REFRESH_SWEEPS);
    if (this.refreshAt >= this.slotCount) this.refreshAt = 0;
    const end = Math.min(this.slotCount, this.refreshAt + share);
    for (let slot = this.refreshAt; slot < end; slot++) {
      const id = this.nodeOf[slot] as number;
      if (id < 0) continue;
      const node = nodes[id]!;
      const parent = nodes[node.parent];
      if (node.alive && parent) this.writeSegment(node, parent, slot);
    }
    this.refreshAt = end;
  }

  /**
   * Send only the slots written since the last upload to the GPU, as a few
   * runs of neighbouring slots rather than one span from the lowest to the
   * highest, which a tip at each end of the buffer would make the whole thing.
   */
  private upload(): void {
    const dirty = this.dirty;
    if (dirty.length === 0) return;
    dirty.sort((a, b) => a - b);
    const matrix = this.mesh.instanceMatrix;
    const color = this.mesh.instanceColor;
    matrix.clearUpdateRanges();
    color?.clearUpdateRanges();
    let from = dirty[0]!;
    let to = from;
    const flush = (): void => {
      matrix.addUpdateRange(from * 16, (to - from + 1) * 16);
      color?.addUpdateRange(from * 3, (to - from + 1) * 3);
    };
    for (let i = 1; i < dirty.length; i++) {
      const slot = dirty[i]!;
      // Close gaps: one larger upload beats many tiny ones.
      if (slot - to <= UPLOAD_GAP) {
        to = Math.max(to, slot);
        continue;
      }
      flush();
      from = to = slot;
    }
    flush();
    matrix.needsUpdate = true;
    if (color) color.needsUpdate = true;
    dirty.length = 0;
  }

  private markDirty(slot: number): void {
    this.dirty.push(slot);
  }

  private claimSlot(): number {
    while (this.freeSlots.length > 0) {
      const slot = this.freeSlots.pop()!;
      if ((this.nodeOf[slot] as number) === -1) return slot;
    }
    if (this.slotCount >= this.capacity) return -1;
    return this.slotCount++;
  }

  private hideSlot(slot: number): void {
    this.dummy.position.set(0, 0, 0);
    this.dummy.quaternion.identity();
    this.dummy.scale.set(0, 0, 0);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(slot, this.dummy.matrix);
    const occupant = this.nodeOf[slot] as number;
    if (occupant >= 0) this.slotOf[occupant] = -1;
    this.nodeOf[slot] = -1;
    this.freeSlots.push(slot);
    this.markDirty(slot);
  }

  private writeSegment(node: HyphaNode, parent: HyphaNode, slot: number): void {
    if (slot >= this.capacity) return;
    this.markDirty(slot);
    nodePosition(node, this.a);
    nodePosition(parent, this.b);
    this.mid.copy(this.a).add(this.b).multiplyScalar(0.5);
    this.dir.copy(this.a).sub(this.b);
    const length = this.dir.length();
    if (length < 0.0002) {
      this.dummy.position.copy(this.mid);
      this.dummy.quaternion.identity();
      this.dummy.scale.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(slot, this.dummy.matrix);
      return;
    }
    this.dir.divideScalar(length);
    this.quat.setFromUnitVectors(UP, this.dir);

    // Radius follows thickness: a freshly committed strand is hair-fine, a cord
    // that has been carrying traffic is a visible pipe.
    // A cord's own strand is the dark core its braid (`cords.ts`) winds around.
    const radius = (0.04 + node.thickness * 0.26) * this.radiusScale * (node.reinforced ? 0.45 : 1);
    this.dummy.position.copy(this.mid);
    this.dummy.quaternion.copy(this.quat);
    this.dummy.scale.set(radius, length * 1.04, radius);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(slot, this.dummy.matrix);

    // Colour is state: a starving strand dims, a loaded cord runs hot, and a
    // pulse flashes along it when something has just happened.
    const health = Math.max(0, Math.min(1, node.health));
    const flow = Math.min(1, Math.abs(node.flow) * 0.5);
    const heat = Math.min(1, node.thickness * 0.75 + flow * 0.5 + node.pulse * 0.4);
    this.color.copy(this.palette.glow).lerp(this.palette.core, heat);
    this.color.multiplyScalar((0.22 + heat * 0.5) * (0.2 + health * 0.8) * (node.reinforced ? 0.5 : 1));
    // The selected subcluster reads cool and bright against the warm colony.
    if (this.highlight && node.group === this.highlight) this.color.lerp(SELECTED, 0.6).multiplyScalar(1.5);
    this.mesh.setColorAt(slot, this.color);
  }

  private syncTips(nodes: HyphaNode[]): void {
    const pos = this.tips.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.tips.geometry.getAttribute('color') as THREE.BufferAttribute;
    let n = 0;
    // Every living tip is in the active set.
    for (const id of this.active) {
      const node = nodes[id]!;
      if (!node.alive || !node.isTip) continue;
      if (n >= this.tipCapacity) break;
      nodePosition(node, this.a);
      pos.setXYZ(n, this.a.x, this.a.y, this.a.z);
      // A tip that cannot afford to advance still glows, but cooler and dimmer.
      const ready = Math.min(1, node.carbon * 0.4);
      this.color.copy(this.palette.glow).lerp(this.palette.core, ready);
      this.color.multiplyScalar(0.3 + ready * 0.5);
      if (this.highlight && node.group === this.highlight) this.color.lerp(SELECTED, 0.7).multiplyScalar(1.6);
      col.setXYZ(n, this.color.r, this.color.g, this.color.b);
      n++;
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.tips.geometry.setDrawRange(0, n);
  }
}

/**
 * Motes: the visible traffic of the economy.
 *
 * Each mote rides one edge of the network, travelling from a strand toward the
 * node it feeds. Motes only appear on edges that actually moved carbon, so the
 * drifting light is a live readout of where resources are going rather than an
 * ambient effect — when the network is starving, the motes stop.
 */
export class Motes {
  readonly points: THREE.Points;
  private readonly capacity: number;
  private readonly nodeOf: Int32Array;
  private readonly t: Float32Array;
  private readonly speed: Float32Array;
  private readonly rng: () => number;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly color = new THREE.Color();

  constructor(glowMap: THREE.Texture, capacity = 900, seed = 1337) {
    this.capacity = capacity;
    this.nodeOf = new Int32Array(capacity).fill(-1);
    this.t = new Float32Array(capacity);
    this.speed = new Float32Array(capacity);
    this.rng = mulberry32(seed);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    this.points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 1.6,
        sizeAttenuation: true,
        map: glowMap,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        vertexColors: true,
        toneMapped: false,
      })
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  reset(): void {
    this.nodeOf.fill(-1);
    this.points.geometry.setDrawRange(0, 0);
  }

  update(net: Network, dt: number): void {
    const nodes = net.nodes;
    const pos = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.points.geometry.getAttribute('color') as THREE.BufferAttribute;
    let drawn = 0;

    for (let i = 0; i < this.capacity; i++) {
      const nodeId = this.nodeOf[i] as number;
      let node: HyphaNode | undefined = nodeId >= 0 ? nodes[nodeId] : undefined;

      // Retire motes whose edge has died or gone quiet, and pick a new one.
      const stale =
        !node ||
        !node.alive ||
        node.parent < 0 ||
        (this.t[i] as number) >= 1 ||
        Math.abs(node.flow) < 0.02;
      if (stale) {
        node = this.pickEdge(net);
        if (!node) {
          this.nodeOf[i] = -1;
          continue;
        }
        this.nodeOf[i] = node.id;
        this.t[i] = this.rng() * 0.3;
        this.speed[i] = 0.4 + this.rng() * 0.85;
      }
      if (!node || node.parent < 0) continue;
      const parent = nodes[node.parent];
      if (!parent || !parent.alive) {
        this.nodeOf[i] = -1;
        continue;
      }

      const t = this.t[i] as number;
      this.t[i] = t + (this.speed[i] as number) * dt;

      nodePosition(node, this.a);
      nodePosition(parent, this.b);
      pos.setXYZ(
        drawn,
        this.b.x + (this.a.x - this.b.x) * t,
        this.b.y + (this.a.y - this.b.y) * t,
        this.b.z + (this.a.z - this.b.z) * t
      );

      const heat = Math.min(1, node.thickness * 0.8 + Math.abs(node.flow) * 0.6);
      this.color.copy(FLOW_COOL).lerp(FLOW_HOT, heat);
      col.setXYZ(drawn, this.color.r, this.color.g, this.color.b);
      drawn++;
    }

    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.points.geometry.setDrawRange(0, drawn);
  }

  private pickEdge(net: Network): HyphaNode | undefined {
    const nodes = net.nodes;
    if (nodes.length === 0) return undefined;
    // Sample rather than scan: this runs for every mote, every frame.
    for (let tries = 0; tries < 12; tries++) {
      const candidate = nodes[Math.floor(this.rng() * nodes.length)];
      if (!candidate) continue;
      if (!candidate.alive || candidate.parent < 0) continue;
      if (Math.abs(candidate.flow) < 0.02) continue;
      return candidate;
    }
    return undefined;
  }
}
