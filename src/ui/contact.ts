import { CHEMICALS, CHEMICAL_ORDER, type Chemical, type ContactWar } from '../sim/contact';
import type { Owner } from '../sim/network';

const RESOURCE_CLASS = { carbon: 'is-carbon', water: 'is-water', nitrogen: 'is-nitrogen' } as const;

/**
 * The frontier hotbar: one key per chemical, aimed at the cursor. Light
 * chemicals cost one resource, heavy ones a combination; each chip shows its
 * key, its cost and its cooldown. Above it, the front alert names where you are
 * fighting and how it is going; Z jumps there.
 */
export class ContactBar {
  private readonly root = document.createElement('section');
  private readonly alert = document.createElement('button');
  private readonly chips = new Map<Chemical, { el: HTMLElement; shade: HTMLElement }>();
  private alertKey = '';

  constructor(private readonly onJump: () => void) {
    this.root.className = 'contact-bar';
    this.root.setAttribute('aria-label', 'Chemicals');
    this.alert.type = 'button';
    this.alert.className = 'contact-alert';
    this.alert.hidden = true;
    this.alert.addEventListener('click', () => this.onJump());
    const row = document.createElement('div');
    row.className = 'contact-chips';
    for (const id of CHEMICAL_ORDER) {
      const spec = CHEMICALS[id];
      const el = document.createElement('div');
      el.className = `contact-chip is-${spec.weight}`;
      el.dataset.chemical = id;
      const cost = (['carbon', 'water', 'nitrogen'] as const)
        .filter((r) => spec.cost[r] > 0)
        .map((r) => `<span class="contact-cost ${RESOURCE_CLASS[r]}" title="${r}">${spec.cost[r]}</span>`)
        .join('');
      el.innerHTML = `<kbd>${spec.key.toUpperCase()}</kbd><span class="contact-name">${spec.name}</span><span class="contact-costs">${cost}</span><span class="contact-shade"></span>`;
      el.title = `${spec.name} (${spec.weight}): ${spec.effect}`;
      row.append(el);
      this.chips.set(id, { el, shade: el.querySelector('.contact-shade')! });
    }
    this.root.append(this.alert, row);
    document.body.append(this.root);
  }

  /** The chemical a key casts, if any. */
  static chemicalFor(key: string): Chemical | null {
    const k = key.toLowerCase();
    return CHEMICAL_ORDER.find((id) => CHEMICALS[id].key === k) ?? null;
  }

  update(war: ContactWar, owner: Owner, visible: boolean): void {
    this.root.hidden = !visible;
    if (!visible) return;
    for (const id of CHEMICAL_ORDER) {
      const chip = this.chips.get(id)!;
      const wait = war.cooldown(owner, id);
      const fraction = Math.min(1, wait / Math.max(0.01, CHEMICALS[id].cooldown));
      chip.shade.style.transform = `scaleY(${fraction})`;
      chip.el.classList.toggle('is-cooling', wait > 0);
    }
    const fronts = war.frontsOf(owner);
    const key = fronts.map((f) => `${f.standId}:${f.contacts}`).join(',') + `|${war.lost[owner] ?? 0}|${war.killed[owner] ?? 0}`;
    if (key === this.alertKey) return;
    this.alertKey = key;
    this.alert.hidden = fronts.length === 0;
    if (!fronts.length) return;
    const hottest = [...fronts].sort((a, b) => b.contacts - a.contacts)[0]!;
    const where = hottest.standId >= 0 ? `stand ${hottest.standId + 1}` : 'the soil';
    const more = fronts.length > 1 ? ` · ${fronts.length} fronts` : '';
    this.alert.innerHTML = `<strong>Front</strong> ${where} · ${hottest.contacts} in contact${more} · lost ${war.lost[owner] ?? 0} · lysed ${war.killed[owner] ?? 0} <kbd>Z</kbd>`;
  }

  /** Brief feedback on the chip for a cast that went out, or was refused. */
  flash(chemical: Chemical, ok: boolean): void {
    const chip = this.chips.get(chemical);
    if (!chip) return;
    const cls = ok ? 'is-cast' : 'is-refused';
    chip.el.classList.remove('is-cast', 'is-refused');
    void chip.el.offsetWidth;
    chip.el.classList.add(cls);
  }
}
