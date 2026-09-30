import { AgentController, LocalProvider, RelayProvider, relayProviders, type ProviderId } from '../agent/controller';
import type { RegionalMatch } from '../sim/match';

const LABEL: Record<ProviderId | 'bot', string> = {
  bot: 'Built-in rival',
  local: 'Heuristic agent (offline)',
  jev: 'Jev (TypeSafe System One)',
  openai: 'OpenAI Decisions (preview)',
};

/**
 * Who plays the rival: the built-in controller, the offline heuristic agent, or a
 * System One model through the relay. `?opponent=jev|openai|local` picks at
 * load. The readout shows the latest decision, its latency and its actions.
 */
export class AgentUI {
  private readonly root = document.createElement('details');
  private readonly select: HTMLSelectElement;
  private readonly readout: HTMLElement;
  private agent: AgentController | null = null;
  private shown = -1;
  private readonly match: RegionalMatch;

  constructor(match: RegionalMatch) {
    this.match = match;
    this.root.className = 'forest-disclosure agent-controls';
    this.root.innerHTML = `<summary>Opponent</summary>
      <label for="agent-provider">The rival is played by</label>
      <select id="agent-provider">${(['bot', 'local', 'jev', 'openai'] as const).map((id) => `<option value="${id}">${LABEL[id]}</option>`).join('')}</select>
      <p class="agent-readout" aria-live="polite"></p>`;
    this.select = this.root.querySelector('select')!;
    this.readout = this.root.querySelector('.agent-readout')!;
    const panel = document.querySelector('.living-panel');
    (panel ?? document.body).append(this.root);
    this.select.addEventListener('change', () => this.use(this.select.value as ProviderId | 'bot'));
    void relayProviders().then((providers) => {
      for (const id of ['jev', 'openai'] as const) {
        const option = this.select.querySelector<HTMLOptionElement>(`option[value="${id}"]`)!;
        if (!providers[id]) option.textContent = `${LABEL[id]}: not configured`;
      }
    });
    const wanted = new URLSearchParams(location.search).get('opponent');
    if (wanted === 'local' || wanted === 'jev' || wanted === 'openai') this.use(wanted);
  }

  get controller(): AgentController | null { return this.agent; }

  use(id: ProviderId | 'bot'): void {
    this.select.value = id;
    if (id === 'bot') {
      this.agent?.release();
      this.agent = null;
      this.readout.textContent = 'The rival courts trees, spreads between stands, and contests the regional hold.';
      return;
    }
    const provider = id === 'local' ? new LocalProvider() : new RelayProvider(id);
    if (this.agent) this.agent.setProvider(provider);
    else this.agent = new AgentController(this.match, 'rival', provider);
    this.readout.textContent = `${LABEL[id]} decides up to four times a second.`;
  }

  update(): void {
    const agent = this.agent;
    if (!agent) return;
    agent.update();
    if (agent.decisions === this.shown) return;
    this.shown = agent.decisions;
    const last = agent.log[0];
    if (!last) return;
    const acts = last.actions.filter((a) => a.kind !== 'skip').map((a) => a.text).join(' · ') || 'no action';
    const cost = agent.inputTokens ? ` · ${(agent.inputTokens / 1000).toFixed(1)}k tokens so far` : '';
    this.readout.textContent = last.error
      ? `Provider failed (${last.error}); the heuristic played this second.`
      : `${last.model}, ${last.latencyMs} ms: ${last.stance ?? '?'} — ${acts}. ${agent.decisions} decisions, ${agent.failures} failed${cost}.`;
  }
}
