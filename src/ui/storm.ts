import { STORM, type RegionalMatch } from '../sim/match';
import { techIcon } from './evolution';

/** Extend the forest-dusk instrument with a shared forecast and a real map.
 * Wind is always named by its destination. The warning owns attention only
 * while an event is underway; the direction/cost controls stay in a disclosure.
 */
export class StormUI {
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
    this.watch.className = 'storm-watch';
    this.watch.setAttribute('aria-label','Regional storm forecast');
    this.watch.innerHTML = '<span class="storm-arrow" aria-hidden="true">➜</span><div><strong></strong><p></p></div>';
    panel.querySelector('.living-heading')!.after(this.watch);
    this.controls.className = 'forest-disclosure storm-controls';
    this.controls.innerHTML = `<summary><img class="power-summary-icon" src="${techIcon('storm-crown')}" alt="" />Summon storm</summary>
      <p class="storm-intro">One wind for every colony. Raise fruiting bodies before it arrives.</p>
      <label for="storm-bearing">Wind blows toward</label>
      <select id="storm-bearing">
        <option value="0">East →</option><option value="45">Northeast ↗</option>
        <option value="90">North ↑</option><option value="135">Northwest ↖</option>
        <option value="180">West ←</option><option value="225">Southwest ↙</option>
        <option value="270">South ↓</option><option value="315">Southeast ↘</option>
      </select>
      <svg class="storm-map" role="img" aria-label="Downwind colonization forecast"></svg>
      <p class="storm-map-key">Outline: your colony · amber: possible landing · grey: occupied</p>
      <p class="storm-forecast"></p>
      <p class="storm-cost">60s to prepare · 45s of strong wind · 180s recovery.<br>Summoning spends 80 carbon, 12 water and 6 nitrogen.</p>
      <p class="storm-rules">Each fresh bloom can fund up to three daughters. Each costs 46 carbon, 6 water and 3 nitrogen from its parent. Warning blooms wait for arrival; keep their strands alive and supplied. The warm rain permits fruiting through frost. Rivals can use it too. Its rain floods the stream: ground within about eighteen paces of the water goes under, closing to growth; thin surface strands wash away, others drown, and oak drowns where birch stands. Hold high ground or reinforce your cords. The water leaves silt behind.</p>
      <button type="button" class="storm-invoke">Summon storm</button><p class="storm-reason"></p>`;
    panel.querySelector('.earned-powers')!.after(this.controls);
    this.bearing = this.controls.querySelector('select')!;
    this.invoke = this.controls.querySelector('button')!;
    this.map = this.controls.querySelector('svg')!;
    this.reason = this.controls.querySelector('.storm-reason')!;
    this.announcement.className = 'sr-only';
    this.announcement.setAttribute('role','status');
    this.watch.append(this.announcement);
    this.bearing.addEventListener('change', () => { this.direction = Number(this.bearing.value) * Math.PI / 180; this.refresh(); });
    this.invoke.addEventListener('click', () => { const result = match.summonStorm(match.activeStandId,this.direction); this.note(result); this.announcement.textContent = result; this.refresh(); });
    this.controls.addEventListener('toggle', () => this.refresh());
    this.refresh();
  }

  update(dt: number): void { this.clock += dt; if (this.clock >= .2) { this.clock = 0; this.refresh(); } }

  private refresh(): void {
    const { match } = this;
    const { phase } = match.storm;
    const active = phase !== 'idle';
    this.watch.hidden = !active;
    this.watch.dataset.phase = phase;
    this.bearing.disabled = active;
    const direction = active ? match.storm.direction : this.direction;
    const names = ['East','Northeast','North','Northwest','West','Southwest','South','Southeast'];
    const toward = names[Math.round(direction * 4 / Math.PI) % 8];
    const seconds = Math.ceil(match.stormRemaining);
    const label = phase === 'warning' ? `Storm arrives in ${seconds}s` : phase === 'active' ? `Storm · ${seconds}s remaining` : `Wind settling · ${seconds}s recovery`;
    this.watch.querySelector('strong')!.textContent = label;
    const held = match.heldSpores.length;
    const flood = match.flood.level > 0 ? ` · stream ${Math.round(match.flood.level * 100)}% over its banks, ${match.flood.losses.player.washed + match.flood.losses.player.drowned} of your strands drowned` : '';
    this.watch.querySelector('div p')!.textContent = `Toward ${toward} · ${phase === 'warning' ? `${held} fresh releases waiting` : phase === 'active' ? 'Fruit now to ride the wind' : 'Ordinary spore range restored'}${flood}`;
    (this.watch.querySelector('.storm-arrow') as HTMLElement).style.transform = `rotate(${-direction}rad)`;
    if (phase !== this.phase) { this.phase = phase; this.announcement.textContent = active ? `${label}. Wind blows toward ${toward}.` : 'Storm crown is ready to recover its wind.'; }
    const status = match.stormStatus(match.activeStandId);
    this.invoke.disabled = status !== 'Ready to summon';
    this.reason.textContent = status;
    const from = active ? match.storm.initiator! : match.activeStandId;
    const targets = match.sporeTargets(from,direction);
    const key = `${from}:${direction}:${targets.join(',')}:${match.colonizedStands}:${phase}`;
    if (key === this.mapKey) return;
    this.mapKey = key;
    const { cols,rows,stands } = match.region;
    this.map.setAttribute('viewBox',`0 0 ${cols*48} ${rows*48}`);
    this.map.setAttribute('aria-label',`Wind toward ${toward}. ${targets.length} possible downwind tiles; landing needs a living parent and a paid founding kit.`);
    this.map.innerHTML = stands.map(s => `<rect x="${s.sx*48+4}" y="${(rows-1-s.sy)*48+4}" width="40" height="40" rx="3" class="${s.id === from ? 'storm-origin' : match.stands[s.id].sim.hasColony ? 'storm-occupied' : targets.includes(s.id) ? 'storm-target' : 'storm-empty'}"/><text x="${s.sx*48+24}" y="${(rows-1-s.sy)*48+29}" text-anchor="middle">${s.id+1}</text>`).join('');
    this.controls.querySelector('.storm-forecast')!.textContent = targets.length ? `${targets.length} possible landing ${targets.length === 1 ? 'tile' : 'tiles'} toward ${toward}. Up to ${Math.min(STORM.daughtersPerBloom,targets.length)} per supplied bloom.` : `No free downwind tiles toward ${toward} from this colony. ${active ? 'Other colonies may still benefit.' : 'Choose another wind or another established colony.'}`;
  }
}
