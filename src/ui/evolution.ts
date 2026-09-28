import { ECON } from '../sim/content';
import { ADAPTATIONS, POWERS, adaptationState, powerState, learnAdaptation, invokePower } from '../sim/evolution';
import type { Simulation } from '../sim/sim';

/** The forest owns the viewport; an unfilled ring expresses reserve health, never capacity. */
export class EvolutionUI {
  private sim?: Simulation;
  private dialog = document.createElement('dialog');
  private rings: SVGCircleElement[] = [];
  private resourceButtons: HTMLButtonElement[] = [];
  private techButtons = new Map<string, HTMLButtonElement>();
  private powerButtons = new Map<string, HTMLButtonElement>();
  private message = document.createElement('p');
  private openButton = document.createElement('button');

  constructor() {
    const sheet = document.querySelector('#sheet')!;
    const panel = document.createElement('aside');
    panel.className = 'living-panel';
    panel.setAttribute('aria-label', 'Your mycelium');
    panel.innerHTML = `<header class="living-heading"><h1>Mycelia</h1></header>
      <div class="resource-grove"><svg viewBox="0 0 280 280" aria-hidden="true">
      <circle cx="140" cy="140" r="119" class="reserve-ring carbon-ring" />
      <circle cx="140" cy="140" r="98" class="reserve-ring water-ring" />
      <circle cx="140" cy="140" r="77" class="reserve-ring nitrogen-ring" />
      <path class="root-sigil" d="M140 110V143L126 158L116 162M140 133L151 148L164 154M140 143V165L132 174M140 156L147 172M126 158L126 170" />
      </svg><p class="reserve-caption">A living reserve</p></div>
      <div class="resource-legend" aria-label="Resource reserves"></div>
      <p class="reserve-help">Light shows reserves, not a storage limit.</p>
      <div class="primary-intents" aria-label="Growth choices"></div>`;
    sheet.append(panel);
    panel.querySelector('header')!.append(document.querySelector('#season-name')!);
    this.rings = Array.from(panel.querySelectorAll('circle'));
    for (const [i, name] of ['Carbon', 'Water', 'Nitrogen'].entries()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `resource-readout resource-${i}`;
      button.innerHTML = `<span>${name}</span><span class="reserve-tooltip" role="tooltip"></span>`;
      panel.querySelector('.resource-legend')!.append(button);
      this.resourceButtons.push(button);
    }
    for (const selector of ['[data-order="grow"]', '[data-order="bond"]', '#rest']) {
      const button = document.querySelector<HTMLButtonElement>(selector)!;
      if (selector === '#rest') button.textContent = 'Rest';
      if (selector.includes('bond')) button.querySelector('.order-name')!.textContent = 'Share';
      panel.querySelector('.primary-intents')!.append(button);
    }
    panel.append(document.querySelector('#order-note')!);
    this.openButton.type = 'button';
    this.openButton.className = 'evolution-open';
    this.openButton.textContent = 'Unfold the tech tree';
    this.openButton.addEventListener('click', () => { this.dialog.showModal(); this.refresh(); });
    panel.append(this.openButton);
    const powers = document.createElement('div');
    powers.className = 'earned-powers';
    powers.setAttribute('aria-label', 'Milestone powers');
    panel.append(powers);
    for (const power of POWERS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.hidden = true;
      button.addEventListener('click', () => {
        if (!this.sim || this.sim.outcome !== 'playing' || !this.sim.hasColony) return;
        this.message.textContent = invokePower(this.sim.player, power.id);
        document.querySelector('#order-note')!.textContent = this.message.textContent;
        this.refresh();
      });
      powers.append(button);
      this.powerButtons.set(power.id, button);
    }
    const guide = this.disclosure(panel, 'Field guide', ['.field-journal']);
    guide.open = true;
    this.disclosure(panel, 'Shape the network', ['.orders']);
    this.disclosure(panel, 'Forest & roots', ['.forest-observation']);
    this.disclosure(panel, 'Detailed readings', ['.catalogue']);
    this.disclosure(panel, 'Pace & atmosphere', ['.season']);

    this.dialog.className = 'evolution-dialog';
    this.dialog.setAttribute('aria-labelledby', 'evolution-title');
    this.dialog.innerHTML = `<header><div><p>One body. Many ways to grow.</p><h2 id="evolution-title">The living tree</h2></div><button type="button" class="close-evolution" aria-label="Close tech tree">Close ×</button></header>
      <p class="evolution-intro">Experience opens each adaptation. Learn it when its milestone is met. All three branches can grow together.</p>
      <div class="evolution-branches"></div><p class="power-explanation">After your first fruiting, each completed branch offers a power. Invoke it when the forest needs it: twenty seconds of activity, two minutes between uses.</p>`;
    this.dialog.querySelector('.close-evolution')!.addEventListener('click', () => this.dialog.close());
    // Modal keys never issue orders in the world behind it; Escape retains native behavior.
    this.dialog.addEventListener('keydown', e => e.stopPropagation());
    for (const branch of ['Exchange', 'Resilience', 'Fruiting']) {
      const column = document.createElement('section');
      column.innerHTML = `<h3>${branch}</h3>`;
      for (const tech of ADAPTATIONS.filter(t => t.branch === branch).sort((a,b) => Number(a.id === 'storm-crown') - Number(b.id === 'storm-crown'))) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'adaptation';
        button.innerHTML = `<span class="tech-bud" aria-hidden="true"></span><strong>${tech.name}</strong><span>${tech.effect}</span><em></em>`;
        button.addEventListener('click', () => {
          if (this.sim?.outcome === 'playing' && this.sim.hasColony) this.message.textContent = learnAdaptation(this.sim.player, tech.id);
          this.refresh();
        });
        column.append(button);
        this.techButtons.set(tech.id, button);
      }
      const power = POWERS.find(p => ADAPTATIONS.some(t => t.branch === branch && t.id === p.tech))!;
      const description = document.createElement('p');
      description.className = 'branch-power';
      description.innerHTML = `<strong>${power.name}</strong><span>${power.effect}</span><em>${power.need}</em>`;
      column.append(description);
      this.dialog.querySelector('.evolution-branches')!.append(column);
    }
    this.message.setAttribute('role', 'status');
    this.dialog.append(this.message);
    document.body.append(this.dialog);
  }

  private disclosure(panel: HTMLElement, label: string, selectors: string[]): HTMLDetailsElement {
    const details = document.createElement('details');
    details.className = 'forest-disclosure';
    const summary = document.createElement('summary');
    summary.textContent = label;
    details.append(summary);
    for (const selector of selectors) details.append(document.querySelector(selector)!);
    panel.append(details);
    return details;
  }

  update(sim: Simulation): void {
    this.sim = sim;
    const net = sim.player;
    const nodes = sim.hasColony ? net.nodes.filter(n => n.alive && n.connected) : [];
    const values = ['carbon', 'water', 'nitrogen'].map(key => nodes.reduce((sum, n) => sum + n[key as 'carbon' | 'water' | 'nitrogen'], 0));
    const costs = [ECON.growthPerCm, ECON.waterPerCm, ECON.nitrogenPerCm];
    values.forEach((value, i) => {
      const budget = value / (costs[i]! * Math.max(1, net.tipCount));
      const state = budget < 1 ? 'Scarce' : budget < 5 ? 'Steady' : 'Abundant';
      this.rings[i]!.style.opacity = budget < 1 ? '0.3' : budget < 5 ? '0.6' : '1';
      const label = `${['Carbon', 'Water', 'Nitrogen'][i]}: ${value.toFixed(1)} connected · ${state.toLowerCase()}. Compared with one centimetre of growth per active tip; not a storage capacity.`;
      this.resourceButtons[i]!.setAttribute('aria-label', label);
      this.resourceButtons[i]!.querySelector('.reserve-tooltip')!.textContent = `${value.toFixed(1)} · ${state} · connected reserve`;
    });
    this.refresh();
  }

  private refresh(): void {
    if (!this.sim) return;
    const net = this.sim.player;
    const ready = this.sim.hasColony && this.sim.outcome === 'playing' && ADAPTATIONS.some(t => adaptationState(net, t.id) === 'Ready to learn');
    this.openButton.textContent = ready ? 'Tech tree · an adaptation awaits' : 'Unfold the tech tree';
    for (const tech of ADAPTATIONS) {
      const button = this.techButtons.get(tech.id)!;
      const state = !this.sim.hasColony ? 'Found a colony here first.' : this.sim.outcome !== 'playing' ? 'This colony’s journey has ended.' : adaptationState(net, tech.id);
      button.setAttribute('aria-disabled', String(state !== 'Ready to learn'));
      button.dataset.state = state === 'Learned' ? 'learned' : state === 'Ready to learn' ? 'ready' : 'locked';
      button.querySelector('em')!.textContent = state;
    }
    for (const power of POWERS) {
      const button = this.powerButtons.get(power.id)!;
      button.hidden = net.fruited < 1 || !net.evolution.learned.includes(power.tech);
      const state = !this.sim.hasColony ? 'Found a colony here first.' : this.sim.outcome !== 'playing' ? 'This colony’s journey has ended.' : powerState(net, power.id);
      button.disabled = state !== 'Ready to invoke';
      button.textContent = `${power.name} · ${state === 'Ready to invoke' ? 'Invoke' : state}`;
      button.title = power.effect;
    }
  }
}
