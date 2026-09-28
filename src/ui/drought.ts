import type { RegionalMatch } from '../sim/match';
import { DROUGHT } from '../sim/drought';
import { GRID } from '../sim/content';

/**
 * The drought's place in the forest-dusk instrument. It has no compass: the
 * map shows where water will hold (the share of each tile's ground on a stream
 * bank), and the watch counts the trees you are keeping alive.
 */
export class DroughtUI {
  private readonly watch = document.createElement('section');
  private readonly controls = document.createElement('details');
  private readonly invoke: HTMLButtonElement;
  private readonly map: SVGSVGElement;
  private readonly reason: HTMLElement;
  private readonly announcement = document.createElement('p');
  private phase = '';
  private mapKey = '';
  private clock = 1;

  constructor(private readonly match: RegionalMatch, private readonly note: (text: string) => void) {
    const panel = document.querySelector('.living-panel')!;
    this.watch.className = 'drought-watch';
    this.watch.setAttribute('aria-label', 'Regional drought');
    this.watch.innerHTML = '<span class="drought-sun" aria-hidden="true">☀</span><div><strong></strong><p></p></div>';
    panel.querySelector('.living-heading')!.after(this.watch);
    this.controls.className = 'forest-disclosure drought-controls';
    this.controls.innerHTML = `<summary>Call drought</summary>
      <p class="drought-intro">The rain stops everywhere. Water decides who lasts.</p>
      <svg class="drought-map" role="img" aria-label="Where water will hold"></svg>
      <p class="drought-map-key">Share of each tile's ground on a stream bank, where soil stays damp · outline: your colonies</p>
      <p class="drought-cost">${DROUGHT.warning}s of rising heat · ${DROUGHT.active}s without rain · ${DROUGHT.recovery}s until it breaks · ${DROUGHT.cooldown}s before another.<br>Calling it spends ${DROUGHT.cost.carbon} carbon and ${DROUGHT.cost.nitrogen} nitrogen.</p>
      <p class="drought-rules">Ground away from water bakes and cracks. Trees wither unless their roots reach the stream or a mycelium keeps them supplied; shallow-rooted hemlock and birch fail first, deep oak last. Strands in parched topsoil shallower than ${DROUGHT.shallowCm} cm dry out and wither unless your network moves water to them. Nothing fruits without rain. A fire kindled into a drought burns hotter.</p>
      <button type="button" class="drought-invoke">Call drought</button><p class="drought-reason"></p>`;
    (panel.querySelector('.fire-controls') ?? panel.querySelector('.storm-controls') ?? panel.querySelector('.earned-powers'))!.after(this.controls);
    this.invoke = this.controls.querySelector('button')!;
    this.map = this.controls.querySelector('svg')!;
    this.reason = this.controls.querySelector('.drought-reason')!;
    this.announcement.className = 'sr-only';
    this.announcement.setAttribute('role', 'status');
    this.watch.append(this.announcement);
    this.invoke.addEventListener('click', () => {
      const result = match.callDrought(match.activeStandId);
      this.note(result === 'Drought called' ? `Drought called. The rain stops in ${DROUGHT.warning} seconds.` : result);
      this.announcement.textContent = result;
      this.refresh();
    });
    this.controls.addEventListener('toggle', () => this.refresh());
    this.refresh();
  }

  update(dt: number): void {
    this.clock += dt;
    if (this.clock >= 0.2) { this.clock = 0; this.refresh(); }
  }

  private refresh(): void {
    const { match } = this;
    const drought = match.drought;
    const phase = drought.phase;
    const active = phase !== 'idle';
    this.watch.hidden = !active;
    this.watch.dataset.phase = phase;
    const seconds = Math.ceil(drought.remaining);
    const label = phase === 'warning' ? `Rain stops in ${seconds}s` : phase === 'active' ? `Drought · ${seconds}s` : `Rain returning · ${seconds}s`;
    this.watch.querySelector('strong')!.textContent = label;
    const lost = drought.losses.player;
    this.watch.querySelector('div p')!.textContent = phase === 'warning'
      ? 'Bank water, reach deep or to the stream, and keep your trees supplied'
      : `Feeding ${drought.fedTrees.size} trees · ${drought.parchedTrees.length} trees lost across the region · ${lost.strands} of your strands withered`;
    if (phase !== this.phase) {
      this.phase = phase;
      this.announcement.textContent = active ? `${label}.` : 'The drought has broken.';
    }
    const status = match.droughtStatus(match.activeStandId);
    this.invoke.disabled = status !== 'Ready to call';
    this.reason.textContent = status;
    const key = `${match.colonizedStands}:${phase}`;
    if (key === this.mapKey) return;
    this.mapKey = key;
    const { cols, rows, stands } = match.region;
    this.map.setAttribute('viewBox', `0 0 ${cols * 48} ${rows * 48}`);
    const refuge = stands.map((site) => {
      const cells = match.stands[site.id]!.sim.world.cells;
      let banked = 0;
      for (let gx = 0; gx < GRID.cols; gx++) if ((cells[8 * GRID.cols + gx]?.streamNear ?? 0) >= DROUGHT.bank) banked++;
      return banked / GRID.cols;
    });
    this.map.setAttribute('aria-label', `Where water will hold: ${stands.map((s, i) => `tile ${s.id + 1} ${Math.round(refuge[i]! * 100)}%`).join(', ')}.`);
    this.map.innerHTML = stands.map((s, i) => {
      const wet = refuge[i]!;
      const mine = match.stands[s.id]!.sim.hasColony;
      return `<rect x="${s.sx * 48 + 4}" y="${(rows - 1 - s.sy) * 48 + 4}" width="40" height="40" rx="3" class="drought-tile${mine ? ' drought-mine' : ''}" style="--wet:${Math.min(1, wet * 3).toFixed(2)}"/>` +
        `<text x="${s.sx * 48 + 24}" y="${(rows - 1 - s.sy) * 48 + 29}" text-anchor="middle">${Math.round(wet * 100)}%</text>`;
    }).join('');
  }
}
