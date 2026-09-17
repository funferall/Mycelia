import { ECON, GRID, STRATA, type StratumId } from '../sim/content';
import type { Simulation } from '../sim/sim';
import { horizonBands } from '../render/soil';

export type OrderId = 'grow' | 'bond' | 'cord' | 'fruit';

const RECORD_FIELDS = [
  'Season',
  'Elapsed',
  'Substrate',
  'Carbon',
  'Water',
  'Nitrogen',
  'Genetic p.',
  'Surplus',
  'Network',
  'Growing tips',
  'Trees bonded',
  'Rival colony',
] as const;

type FieldName = (typeof RECORD_FIELDS)[number];

/**
 * The printed interface.
 *
 * Everything a game normally puts in a HUD lives here instead, as fields in a
 * herbarium catalogue record. The depth rail is generated from the map's own
 * strata, so the ruler can never disagree with the soil it measures.
 */
export class SheetUI {
  private readonly cells = new Map<FieldName, HTMLElement>();
  private readonly rail: HTMLElement;
  private readonly notes: HTMLElement;
  private readonly seasonName: HTMLElement;
  private readonly seasonMeter: HTMLElement;
  private readonly packetFill: HTMLElement;
  private readonly packetCount: HTMLElement;
  private readonly orderNote: HTMLElement;
  private readonly outcome: HTMLElement;
  private readonly outcomeTitle: HTMLElement;
  private readonly outcomeBody: HTMLElement;

  private orderHandler: ((order: OrderId) => void) | null = null;
  private activeOrder: OrderId = 'grow';
  private refreshClock = 0;
  private lastSeason = '';

  constructor() {
    this.rail = must('#rail-scale');
    this.notes = must('#notes');
    this.seasonName = must('#season-name');
    this.seasonMeter = must('#season-meter');
    this.packetFill = must('#packet-fill');
    this.packetCount = must('#packet-count');
    this.orderNote = must('#order-note');
    this.outcome = must('#outcome');
    this.outcomeTitle = must('#outcome-title');
    this.outcomeBody = must('#outcome-body');

    const record = must('#record');
    for (const field of RECORD_FIELDS) {
      const dt = document.createElement('dt');
      dt.textContent = field;
      const dd = document.createElement('dd');
      dd.textContent = '—';
      record.append(dt, dd);
      this.cells.set(field, dd);
    }

    // Accession number and barcode are stable per session, not per match.
    const accession = `F.${48219 + Math.floor(Math.random() * 900)}`;
    must('#accession').textContent = accession;
    must('#barcode-caption').textContent = `MYC ${accession.slice(2)}`;

    for (const button of document.querySelectorAll<HTMLButtonElement>('.order')) {
      button.addEventListener('click', () => {
        const order = button.dataset.order as OrderId | undefined;
        if (order) this.orderHandler?.(order);
      });
    }

    document.addEventListener('keydown', (event) => {
      const map: Record<string, OrderId> = { '1': 'grow', '2': 'bond', '3': 'cord', '4': 'fruit' };
      const order = map[event.key];
      if (order) this.orderHandler?.(order);
    });
  }

  onOrder(handler: (order: OrderId) => void): void {
    this.orderHandler = handler;
  }

  setActiveOrder(order: OrderId): void {
    this.activeOrder = order;
    for (const button of document.querySelectorAll<HTMLButtonElement>('.order')) {
      button.classList.toggle('is-on', button.dataset.order === order);
    }
  }

  get order(): OrderId {
    return this.activeOrder;
  }

  /** A one-line reply printed under the orders list. */
  setNote(text: string): void {
    this.orderNote.textContent = text;
  }

  /** Build the depth rail once, from the generated map. */
  buildRail(sim: Simulation): void {
    const maxDepth = GRID.rows * GRID.cmPerRow;
    this.rail.textContent = '';

    const title = document.createElement('div');
    title.className = 'rail-title';
    title.textContent = 'Depth · cm';
    this.rail.append(title);

    for (let cm = 0; cm <= maxDepth; cm += 5) {
      const tick = document.createElement('div');
      tick.className = cm % 10 === 0 ? 'rail-tick is-major' : 'rail-tick';
      tick.style.top = `${(cm / maxDepth) * 100}%`;
      this.rail.append(tick);

      if (cm % 10 === 0) {
        const numeral = document.createElement('div');
        numeral.className = 'rail-numeral';
        numeral.style.top = `${(cm / maxDepth) * 100}%`;
        numeral.textContent = cm === 0 ? '0' : String(-cm);
        this.rail.append(numeral);
      }
    }

    // Horizon letters, printed where each stratum begins. These come from the
    // map's own column, so the rail is a legend as well as a measurement.
    for (const band of horizonBands(sim.world)) {
      const label = document.createElement('div');
      label.className = 'rail-horizon';
      label.style.top = `${(band.fromCm / maxDepth) * 100}%`;
      label.style.marginTop = '3px';
      label.textContent = band.horizon;
      label.title = band.label;
      this.rail.append(label);
    }
  }

  update(sim: Simulation, dt: number): void {
    this.refreshClock += dt;
    if (this.refreshClock < 0.16) return;
    this.refreshClock = 0;

    const player = sim.player;
    const rival = sim.rival;
    const season = sim.season;

    if (season.id !== this.lastSeason) {
      this.lastSeason = season.id;
      sim.log(`${season.label}.`);
    }
    this.seasonName.textContent = season.label;
    this.seasonMeter.style.transform = `scaleX(${(sim.seasonClock / season.seconds).toFixed(3)})`;

    const bonded = sim.world.trees.reduce(
      (n, tree) => n + (tree.rootTips.some((tip) => tip.bondedTo !== null) ? 1 : 0),
      0
    );
    const living = sim.world.trees.filter((tree) => !tree.dead).length;

    this.set('Season', season.label);
    this.set('Elapsed', formatClock(sim.time));
    this.set('Substrate', dominantStrata(sim));
    this.set('Carbon', player.carbon.toFixed(0), 'is-amber');
    this.set('Water', player.water.toFixed(0));
    this.set('Nitrogen', player.nitrogen.toFixed(0));
    this.set('Genetic p.', player.genetic.toFixed(0), 'is-violet');
    this.set('Surplus', `${player.surplus.toFixed(0)} / ${ECON.fruitThreshold}`);
    this.set('Network', `${player.lengthCm.toFixed(0)} cm`);
    this.set('Growing tips', String(player.tipCount));
    this.set('Trees bonded', `${bonded} / ${living}`);
    this.set(
      'Rival colony',
      rival.extinct ? 'gone' : rival.lengthCm > player.lengthCm * 1.05 ? 'gaining' : 'held',
      rival.extinct ? undefined : 'is-pallor'
    );

    const spores = player.spores;
    this.packetCount.textContent = String(spores);
    this.packetFill.style.transform = `scaleY(${Math.min(1, spores / (ECON.sporesPerFruit * 2)).toFixed(3)})`;

    const latest = sim.events[sim.events.length - 1];
    if (latest) {
      this.notes.textContent = `${latest.text}  ·  Spores away ${player.fruited}/${sim.fruitGoal}.`;
    }
  }

  showOutcome(sim: Simulation, onRestart: () => void): void {
    if (sim.outcome === 'playing' || !this.outcome.hidden) return;
    this.outcomeTitle.textContent =
      sim.outcome === 'fruited' ? 'Fruiting recorded' : 'Accession closed';
    this.outcomeBody.textContent =
      sim.outcome === 'fruited'
        ? `The network fruited ${sim.player.fruited} times in ${formatClock(sim.time)}, carrying ${sim.player.spores} spores off the sheet. The forest stands at ${sim.world.forestBiomass.toFixed(1)} living biomass.`
        : `The last living hypha died at ${formatClock(sim.time)}. What was left of the network has become decomposable matter.`;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Open a new sheet';
    button.addEventListener('click', onRestart);
    this.outcome.append(button);
    this.outcome.hidden = false;
  }

  private set(field: FieldName, value: string, className?: string): void {
    const cell = this.cells.get(field);
    if (!cell || cell.dataset.value === value) return;
    cell.dataset.value = value;
    cell.textContent = value;
    cell.className = className ?? '';
  }
}

function must(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`SheetUI: missing ${selector}`);
  return element;
}

function formatClock(seconds: number): string {
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function dominantStrata(sim: Simulation): string {
  const counts = new Map<StratumId, number>();
  for (const cell of sim.world.cells) {
    counts.set(cell.stratum, (counts.get(cell.stratum) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
  return ranked.map(([id]) => STRATA[id].label.toLowerCase()).join(', ');
}
