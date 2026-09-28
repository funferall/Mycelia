/**
 * The regional survey layer.
 *
 * A printed ledger of the region's stands, opened over the sheet. It is
 * deliberately not a minimap: there is no grid, no tile HUD and no marker per
 * stand — just one ruled line per stand carrying identity, what has been
 * recorded there, and how the lineage hangs together. Unknowns are printed as
 * unknowns, which is what makes the survey a record rather than a decoration.
 *
 * The panel owns no state: `render()` takes the match's own projection
 * (`buildSurvey`) and redraws only when something it prints has changed, since
 * the game calls it on its own beat.
 */
import type { RegionSurvey, StandStateName, StandSurvey } from '../sim/survey';

const STATE_LABEL: Record<StandStateName, string> = {
  uncolonized: 'uncolonized',
  germinating: 'germinating',
  established: 'established',
  fruiting: 'fruiting',
  closed: 'closed',
};

function must(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`the sheet is missing ${selector}`);
  return element;
}

function span(className: string, text: string): HTMLSpanElement {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}

function fieldsText(stand: StandSurvey): string {
  const parts = [`${stand.water} water ${stand.waterCm} cm`];
  if (stand.surveyed) {
    parts.push(stand.healthBand ? `forest ${stand.healthBand}` : 'forest not recorded');
    parts.push(`${stand.trees - stand.deadTrees} of ${stand.trees} trees standing`);
  } else {
    parts.push('not surveyed beneath');
  }
  if (stand.parent !== null) parts.push(`independent spore network from stand ${stand.parent + 1}`);
  if (stand.growthFrom !== null) parts.push(`strand from stand ${stand.growthFrom + 1}`);
  if (stand.occupied && !stand.lineageAlive) parts.push('parent lineage lost');
  if (stand.occupied && !stand.connected && stand.parent === null) parts.push('separate physical network');
  if (stand.spores > 0) parts.push(`${stand.spores} spores`);
  return parts.join(' · ');
}

export class SurveySheet {
  private readonly root: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly list: HTMLElement;
  private readonly opener: HTMLButtonElement;
  private choose: ((id: number) => void) | null = null;
  private signature = '';

  constructor() {
    this.root = must('#survey');
    this.summary = must('#survey-summary');
    this.list = must('#survey-list');
    this.opener = must('#survey-open') as HTMLButtonElement;
  }

  /** Called with the stand id when a row is chosen. */
  onChoose(handler: (id: number) => void): void {
    this.choose = handler;
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    if (this.open) return;
    this.setOpen(true);
  }

  hide(): void {
    if (!this.open) return;
    this.setOpen(false);
  }

  /** Close without moving focus, for when the world itself has moved on. */
  dismiss(): void {
    if (this.open) this.setOpen(false);
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  private setOpen(open: boolean): void {
    this.root.hidden = !open;
    this.opener.setAttribute('aria-pressed', String(open));
    // The page covers the sheet's reading matter while it is open; CSS does the
    // rest, so nothing here knows which blocks those are.
    document.body.classList.toggle('survey-open', open);
  }

  /**
   * Redraw the ledger when — and only when — something it prints has changed.
   */
  render(survey: RegionSurvey, chosen: number | null): void {
    const signature = JSON.stringify({
      chosen,
      held: survey.held,
      surveyed: survey.surveyed,
      contiguous: survey.contiguous,
      lineage: survey.lineage,
      rows: survey.stands.map((stand) => [
        stand.id,
        stand.state,
        stand.water,
        stand.waterCm,
        stand.healthBand,
        stand.connected,
        stand.lineageAlive,
        stand.networkOrigin,
        stand.fruited,
        stand.spores,
        stand.deadTrees,
        stand.parent,
      ]),
    });
    if (signature === this.signature) return;
    this.signature = signature;
    this.summary.textContent = this.summaryText(survey);
    this.list.replaceChildren(...survey.stands.map((stand) => this.row(stand, chosen)));
  }

  private summaryText(survey: RegionSurvey): string {
    const parts = [`${survey.held} of ${survey.total} stands held`];
    if (survey.lineage.length > 1) {
      parts.push(`lineage ${survey.lineage.map((id) => id + 1).join(' → ')}`);
    }
    const independent = survey.stands.filter((stand) => stand.occupied && stand.parent !== null).length;
    const lost = survey.stands.filter((stand) => stand.occupied && !stand.lineageAlive).length;
    if (independent > 0) parts.push(`${independent} independent spore network${independent === 1 ? '' : 's'}`);
    else if (survey.held > 1) parts.push('one connected network');
    else parts.push('no daughters yet');
    if (lost > 0) parts.push(`${lost} parent lineage${lost === 1 ? '' : 's'} lost`);
    return parts.join(' · ');
  }

  private row(stand: StandSurvey, chosen: number | null): HTMLLIElement {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'survey-row';
    button.dataset.stand = String(stand.id);
    button.setAttribute('aria-pressed', String(stand.id === chosen));
    if (stand.occupied) button.classList.add('is-held');
    if (stand.state === 'fruiting' || stand.state === 'closed') button.classList.add('is-fruiting');
    if (stand.occupied && !stand.lineageAlive) button.classList.add('is-severed');
    button.addEventListener('click', () => this.choose?.(stand.id));
    button.append(
      span('survey-id', String(stand.id + 1)),
      span('survey-community', stand.communityLabel),
      span('survey-state', STATE_LABEL[stand.state]),
      span('survey-fields', fieldsText(stand))
    );
    item.append(button);
    return item;
  }
}
