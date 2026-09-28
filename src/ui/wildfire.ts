import type { RegionalMatch } from '../sim/match';
import { FIRE } from '../sim/wildfire';

const NAMES = ['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast'];

/**
 * The wildfire's place in the forest-dusk instrument: a disclosure beside the
 * storm with the same compass, a map that says when the front reaches each
 * tile, and a watch that names what the fire is taking from you.
 */
export class FireUI {
  private readonly watch = document.createElement('section');
  private readonly controls = document.createElement('details');
  private readonly bearing: HTMLSelectElement;
  private readonly invoke: HTMLButtonElement;
  private readonly map: SVGSVGElement;
  private readonly reason: HTMLElement;
  private readonly announcement = document.createElement('p');
  private phase = '';
  private mapKey = '';
  private clock = 1;
  private direction = 0;

  constructor(private readonly match: RegionalMatch, private readonly note: (text: string) => void) {
    const panel = document.querySelector('.living-panel')!;
    this.watch.className = 'fire-watch';
    this.watch.setAttribute('aria-label', 'Regional wildfire');
    this.watch.innerHTML = '<span class="fire-arrow" aria-hidden="true">➜</span><div><strong></strong><p></p></div>';
    panel.querySelector('.living-heading')!.after(this.watch);
    this.controls.className = 'forest-disclosure fire-controls';
    this.controls.innerHTML = `<summary>Kindle wildfire</summary>
      <p class="fire-intro">One front across the whole region. Go deep before it arrives.</p>
      <label for="fire-bearing">Fire runs toward</label>
      <select id="fire-bearing">
        <option value="0">East →</option><option value="45">Northeast ↗</option>
        <option value="90">North ↑</option><option value="135">Northwest ↖</option>
        <option value="180">West ←</option><option value="225">Southwest ↙</option>
        <option value="270">South ↓</option><option value="315">Southeast ↘</option>
      </select>
      <svg class="fire-map" role="img" aria-label="Wildfire arrival forecast"></svg>
      <p class="fire-map-key">Seconds after ignition the front reaches each tile · outline: your colonies</p>
      <p class="fire-cost">${FIRE.warning}s to prepare · ${FIRE.burn}s burning · ${FIRE.aftermath}s ash flush · ${FIRE.cooldown}s before another.<br>Kindling spends ${FIRE.cost.carbon} carbon and ${FIRE.cost.nitrogen} nitrogen.</p>
      <p class="fire-rules">Crowns, strands shallower than ${FIRE.lethalCm} cm and fruiting bodies burn, for every colony, yours too. Reinforced cords and your root are singed but live; strands below ${FIRE.singeCm} cm and wet ground are untouched. Burned ground turns to ash and fruits in any weather until it settles.</p>
      <button type="button" class="fire-invoke">Kindle wildfire</button><p class="fire-reason"></p>`;
    (panel.querySelector('.storm-controls') ?? panel.querySelector('.earned-powers'))!.after(this.controls);
    this.bearing = this.controls.querySelector('select')!;
    this.invoke = this.controls.querySelector('button')!;
    this.map = this.controls.querySelector('svg')!;
    this.reason = this.controls.querySelector('.fire-reason')!;
    this.announcement.className = 'sr-only';
    this.announcement.setAttribute('role', 'status');
    this.watch.append(this.announcement);
    this.bearing.addEventListener('change', () => { this.direction = Number(this.bearing.value) * Math.PI / 180; this.refresh(); });
    this.invoke.addEventListener('click', () => {
      const result = match.kindleFire(match.activeStandId, this.direction);
      this.note(result === 'Fire kindled' ? `Fire kindled. It runs toward the ${this.toward(this.direction).toLowerCase()} in ${FIRE.warning} seconds.` : result);
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

  private toward(direction: number): string {
    return NAMES[Math.round(direction * 4 / Math.PI) % 8]!;
  }

  private refresh(): void {
    const { match } = this;
    const fire = match.fire;
    const phase = fire.phase;
    const active = phase !== 'idle';
    this.watch.hidden = !active;
    this.watch.dataset.phase = phase;
    this.bearing.disabled = active;
    const direction = active ? fire.state.direction : this.direction;
    const toward = this.toward(direction);
    const seconds = Math.ceil(fire.remaining);
    const label = phase === 'warning' ? `Fire kindles in ${seconds}s` : phase === 'burning' ? `Fire running · ${seconds}s` : `Ash settling · ${seconds}s`;
    this.watch.querySelector('strong')!.textContent = label;
    const lost = fire.losses.player;
    this.watch.querySelector('div p')!.textContent = phase === 'warning'
      ? `Toward ${toward} · grow deep, reinforce cords, hold wet ground`
      : `Toward ${toward} · your losses: ${lost.strands} strands burned, ${lost.singed} singed, ${lost.bodies} fruiting bodies`;
    (this.watch.querySelector('.fire-arrow') as HTMLElement).style.transform = `rotate(${-direction}rad)`;
    if (phase !== this.phase) {
      this.phase = phase;
      this.announcement.textContent = active ? `${label}. It runs toward the ${toward.toLowerCase()}.` : 'The burned ground has settled.';
    }
    const status = match.fireStatus(match.activeStandId);
    this.invoke.disabled = status !== 'Ready to kindle';
    this.reason.textContent = status;
    const key = `${direction}:${match.colonizedStands}:${phase}`;
    if (key === this.mapKey) return;
    this.mapKey = key;
    const { cols, rows, stands } = match.region;
    const schedule = new Map(fire.schedule(direction).map((s) => [s.stand, s.at]));
    this.map.setAttribute('viewBox', `0 0 ${cols * 48} ${rows * 48}`);
    this.map.setAttribute('aria-label', `Fire toward ${toward}. ${stands.map((s) => `tile ${s.id + 1} at ${Math.round(schedule.get(s.id) ?? 0)} seconds`).join(', ')}.`);
    this.map.innerHTML = stands.map((s) => {
      const at = schedule.get(s.id) ?? 0;
      // Earlier tiles glow hotter; the map is a forecast of the front, not of losses.
      const heat = 1 - at / FIRE.burn;
      const mine = match.stands[s.id]!.sim.hasColony;
      return `<rect x="${s.sx * 48 + 4}" y="${(rows - 1 - s.sy) * 48 + 4}" width="40" height="40" rx="3" class="fire-tile${mine ? ' fire-mine' : ''}" style="--heat:${heat.toFixed(2)}"/>` +
        `<text x="${s.sx * 48 + 24}" y="${(rows - 1 - s.sy) * 48 + 29}" text-anchor="middle">${Math.round(at)}s</text>`;
    }).join('');
  }
}
