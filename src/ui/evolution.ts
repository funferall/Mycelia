import { ECON, SPECIES } from '../sim/content';
import { holdsAnyBond } from '../sim/network';
import { ADAPTATIONS, POWERS, adaptationState, powerState, learnAdaptation, invokePower } from '../sim/evolution';
import type { Simulation } from '../sim/sim';

/** Authored icon for an adaptation or power, by id (`public/assets/icons`). */
export const techIcon = (id: string): string => `${import.meta.env.BASE_URL}assets/icons/${id}.webp`;

/**
 * One floating card for the tech tree and the powers: the words live here, on
 * hover or keyboard focus, so the tree itself can be pictures and names.
 */
class TechPopover {
  readonly element = document.createElement('div');
  constructor(host: HTMLElement) {
    this.element.className = 'tech-popover';
    this.element.setAttribute('role', 'tooltip');
    this.element.hidden = true;
    host.append(this.element);
  }

  /** Attach to a control; `content` is read fresh each time it opens. */
  bind(target: HTMLElement, content: () => { title: string; body: string; foot: string }): void {
    const id = `tip-${Math.random().toString(36).slice(2, 9)}`;
    const show = () => {
      const { title, body, foot } = content();
      this.element.id = id;
      this.element.innerHTML = `<strong>${title}</strong><span>${body}</span>${foot ? `<em>${foot}</em>` : ''}`;
      this.element.hidden = false;
      target.setAttribute('aria-describedby', id);
      // Beside the control, so the card never covers the next one in the tree:
      // to the right if it fits, else to the left, else below.
      const box = (target.querySelector('.tech-icon, img') ?? target).getBoundingClientRect();
      const card = this.element.getBoundingClientRect();
      const top = Math.min(window.innerHeight - card.height - 12, Math.max(12, box.top + box.height / 2 - card.height / 2));
      let left: number;
      let y = top;
      if (box.right + 14 + card.width < window.innerWidth - 12) left = box.right + 14;
      else if (box.left - 14 - card.width > 12) left = box.left - 14 - card.width;
      else {
        left = Math.min(window.innerWidth - card.width - 12, Math.max(12, box.left + box.width / 2 - card.width / 2));
        y = box.bottom + 10;
      }
      this.element.style.left = `${left}px`;
      this.element.style.top = `${y}px`;
    };
    const hide = () => {
      this.element.hidden = true;
      target.removeAttribute('aria-describedby');
    };
    target.addEventListener('pointerenter', show);
    target.addEventListener('focus', show);
    target.addEventListener('pointerleave', () => { if (document.activeElement !== target) hide(); });
    target.addEventListener('blur', hide);
  }
}

/** The forest owns the viewport; an unfilled ring expresses reserve health, never capacity. */
export class EvolutionUI {
  private sim?: Simulation;
  private dialog = document.createElement('dialog');
  private rings: SVGCircleElement[] = [];
  private sigil: SVGPathElement | null = null;
  private resourceButtons: HTMLButtonElement[] = [];
  private techButtons = new Map<string, HTMLButtonElement>();
  private powerButtons = new Map<string, HTMLButtonElement>();
  private message = document.createElement('p');
  private openButton = document.createElement('button');
  private techStates = new Map<string, string>();
  private powerStates = new Map<string, string>();

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
    this.sigil = panel.querySelector('.root-sigil');
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
    // The regional prompts sit under the note: Follow the frontier, Release spores.
    for (const selector of ['#follow-frontier', '#release-spores']) {
      const prompt = document.querySelector<HTMLElement>(selector);
      if (prompt) panel.append(prompt);
    }
    // Every colony the player has, as a tile to go below; and the toggle that
    // shows them all through the forest floor.
    const colonies = document.createElement('section');
    colonies.className = 'colony-tiles';
    colonies.setAttribute('aria-label', 'Your colonies');
    colonies.innerHTML = `<h2>Colonies</h2><div class="colony-tile-list"></div>
      <button type="button" id="forest-reveal" class="reveal-toggle" aria-pressed="false">See colonies through the floor</button>`;
    panel.append(colonies);
    this.openButton.type = 'button';
    this.openButton.className = 'evolution-open';
    this.openButton.textContent = 'Unfold the tech tree';
    this.openButton.addEventListener('click', () => { this.dialog.showModal(); this.refresh(); });
    panel.append(this.openButton);
    const powers = document.createElement('div');
    powers.className = 'earned-powers';
    powers.setAttribute('aria-label', 'Milestone powers');
    panel.append(powers);
    const panelTips = new TechPopover(document.body);
    for (const power of POWERS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.hidden = true;
      button.className = 'power-chip';
      button.innerHTML = `<img src="${techIcon(power.id)}" alt="" width="40" height="40" loading="lazy" /><span class="power-name">${power.name}</span><span class="power-state"></span>`;
      panelTips.bind(button, () => ({ title: power.name, body: power.effect, foot: this.powerStates.get(power.id) ?? '' }));
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
    this.dialog.innerHTML = `<header><div><p>One lineage. Many ways to grow.</p><h2 id="evolution-title">The living tree</h2></div><button type="button" class="close-evolution" aria-label="Close tech tree">Close ×</button></header>
      <p class="evolution-intro">Hover or focus an adaptation to read it. A glowing one is ready to learn.</p>
      <div class="evolution-branches"></div>`;
    const tips = new TechPopover(this.dialog);
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
        button.dataset.crown = String(tech.id.endsWith('-crown'));
        button.innerHTML = `<span class="tech-icon"><img src="${techIcon(tech.id)}" alt="" loading="lazy" /></span><strong>${tech.name}</strong>`;
        tips.bind(button, () => ({ title: tech.name, body: tech.effect, foot: this.techStates.get(tech.id) === 'Learned' ? 'Learned' : `${this.techStates.get(tech.id) ?? ''}` }));
        button.addEventListener('click', () => {
          if (this.sim?.outcome === 'playing' && this.sim.hasColony) this.message.textContent = learnAdaptation(this.sim.player, tech.id);
          this.refresh();
        });
        column.append(button);
        this.techButtons.set(tech.id, button);
      }
      const power = POWERS.find(p => ADAPTATIONS.some(t => t.branch === branch && t.id === p.tech))!;
      const description = document.createElement('button');
      description.type = 'button';
      description.className = 'branch-power';
      description.setAttribute('aria-label', `Power: ${power.name}`);
      description.innerHTML = `<img src="${techIcon(power.id)}" alt="" loading="lazy" /><span><small>Power</small>${power.name}</span>`;
      tips.bind(description, () => ({ title: power.name, body: power.effect, foot: `${power.need}. Twenty seconds active, two minutes to recover.` }));
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
    // Alarms: the total reserve can look abundant while the colony is dying,
    // because it is spread thin across every strand. What kills a colony is its
    // founding node starving, and what costs it partners is a tree going short.
    const root = sim.hasColony ? net.nodes[net.rootId] : undefined;
    const heart = Boolean(root?.alive && (root.carbon < 0.3 || root.health < 0.95));
    let thirsty = false;
    let hungry = false;
    if (sim.hasColony) for (const tree of sim.world.trees) {
      if (tree.dead || !holdsAnyBond(tree, net.colonyId)) continue;
      if (tree.patience > SPECIES[tree.species].patience * 0.75) continue;
      if (tree.waterReceived <= tree.nutrientReceived) thirsty = true; else hungry = true;
    }
    const alarms = [heart, thirsty, hungry];
    alarms.forEach((on, i) => this.rings[i]!.classList.toggle('is-alarm', on));
    this.sigil?.classList.toggle('is-alarm', heart);
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
      button.setAttribute('aria-label', `${tech.name}. ${state}`);
      this.techStates.set(tech.id, state);
    }
    for (const power of POWERS) {
      const button = this.powerButtons.get(power.id)!;
      button.hidden = net.fruited < 1 || !net.evolution.learned.includes(power.tech);
      const state = !this.sim.hasColony ? 'Found a colony here first.' : this.sim.outcome !== 'playing' ? 'This colony’s journey has ended.' : powerState(net, power.id);
      button.disabled = state !== 'Ready to invoke';
      const short = state === 'Ready to invoke' ? 'Invoke' : state;
      button.setAttribute('aria-label', `${power.name} · ${short}`);
      // Only a live timer shows in the panel; the full reason is in the popover.
      button.querySelector('.power-state')!.textContent = /Active|Recovering/.test(state) ? state.replace(/^\S+ · /, '') : state === 'Ready to invoke' ? 'Invoke' : '';
      button.dataset.state = state === 'Ready to invoke' ? 'ready' : /Active/.test(state) ? 'active' : 'waiting';
      this.powerStates.set(power.id, state);
    }
  }
}
