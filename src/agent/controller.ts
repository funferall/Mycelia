/**
 * An agent playing one owner in real time.
 *
 * On a wall-clock pace (default every 250 ms, so a ~200 ms System One model
 * decides four to five times a second, fast enough to micro a front), and only
 * while game time is moving, it observes, asks its provider the
 * question set, and acts on the answers when they arrive. One request is in
 * flight at a time and the game never waits: a slow answer is applied when it
 * lands, a failed one falls back to the heuristic so the colony keeps playing.
 * The agent replaces the placeholder bot for its owner and uses exactly the
 * orders a person would.
 */
import type { RegionalMatch } from '../sim/match';
import type { Owner } from '../sim/network';
import { act, DEFAULT_POLICY, heuristicAnswers, questions, type Answer, type Executed, type Policy, type Question } from './decision';
import { observe, type Observation } from './observe';

export type ProviderId = 'local' | 'jev' | 'openai';

/** A request out longer than this (wall clock) is abandoned. */
const WATCHDOG_MS = 5000;
/** Four asks a second: with one request in flight, a ~200 ms model runs at 4 to 5 Hz. */
export const DEFAULT_WALL_MS = 250;

export interface DecisionResult {
  answers: Record<string, Answer>;
  model: string;
  latencyMs: number;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface DecisionProvider {
  readonly id: ProviderId;
  decide(state: unknown, questions: Record<string, Question>): Promise<DecisionResult>;
}

/** Instant, offline and free: the placeholder's heuristic behind the same interface. */
export class LocalProvider implements DecisionProvider {
  readonly id = 'local' as const;
  private obs: Observation | null = null;
  /** The heuristic reads the observation rather than the serialized state. */
  prime(obs: Observation): void { this.obs = obs; }
  async decide(): Promise<DecisionResult> {
    return { answers: this.obs ? heuristicAnswers(this.obs) : {}, model: 'heuristic', latencyMs: 0 };
  }
}

/** A System One provider behind the game's own relay (`/api/decide`); no key in the browser. */
export class RelayProvider implements DecisionProvider {
  readonly id: 'jev' | 'openai';
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  constructor(id: 'jev' | 'openai', endpoint = 'api/decide', timeoutMs = 2500) {
    this.id = id;
    this.endpoint = endpoint;
    this.timeoutMs = timeoutMs;
  }
  async decide(state: unknown, qs: Record<string, Question>): Promise<DecisionResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const started = performance.now();
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: this.id, state, questions: qs }),
        signal: controller.signal,
      });
      const body = await res.json() as { error?: string; answers?: Record<string, Answer>; model?: string; usage?: DecisionResult['usage'] };
      if (!res.ok || !body.answers) throw new Error(body.error ?? `relay answered ${res.status}`);
      return { answers: body.answers, model: body.model ?? this.id, latencyMs: performance.now() - started, usage: body.usage };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Ask the relay which providers it can reach. */
export async function relayProviders(endpoint = 'api/decide'): Promise<Record<'jev' | 'openai', boolean>> {
  try {
    const res = await fetch(endpoint, { method: 'GET' });
    const body = await res.json() as { providers?: Record<'jev' | 'openai', boolean> };
    return body.providers ?? { jev: false, openai: false };
  } catch {
    return { jev: false, openai: false };
  }
}

interface Landed { obs: Observation; result: DecisionResult | null; error?: string }

export interface AgentLogEntry {
  at: number;
  provider: ProviderId;
  model: string;
  latencyMs: number;
  stance?: string;
  actions: Executed[];
  error?: string;
}

export class AgentController {
  readonly owner: Owner;
  readonly log: AgentLogEntry[] = [];
  decisions = 0;
  failures = 0;
  inputTokens = 0;
  private readonly match: RegionalMatch;
  private provider: DecisionProvider;
  private readonly fallback = new LocalProvider();
  private readonly policy: Policy;
  /** Wall-clock milliseconds between asks, or game seconds when `gameSeconds` is set (tests). */
  private readonly pace: { wallMs: number } | { gameSeconds: number };
  private nextAt = 0;
  private lastAskTime = -1;
  private readonly now: () => number;
  private inFlight = false;
  /** Wall-clock start of the request in flight, for the watchdog. */
  private askedAt = 0;
  /** Bumped when the provider changes; answers from an older generation are dropped. */
  private generation = 0;
  private landed: Landed | null = null;

  constructor(match: RegionalMatch, owner: Owner, provider: DecisionProvider, options: { every?: number; wallMs?: number; policy?: Policy; now?: () => number } = {}) {
    this.match = match;
    this.owner = owner;
    this.provider = provider;
    this.pace = options.every !== undefined ? { gameSeconds: options.every } : { wallMs: options.wallMs ?? DEFAULT_WALL_MS };
    this.now = options.now ?? (() => Date.now());
    this.policy = options.policy ?? DEFAULT_POLICY;
    // The agent, not the placeholder, now fights for this owner.
    match.contact.bots.delete(owner);
  }

  get providerId(): ProviderId { return this.provider.id; }

  setProvider(provider: DecisionProvider): void {
    this.provider = provider;
    this.generation++;
    this.inFlight = false;
    this.landed = null;
  }

  /** Stop playing and hand the owner back to the placeholder. */
  release(): void { this.match.contact.bots.add(this.owner); }

  /** Called every frame. Applies a landed decision, and asks for the next one when due. */
  update(): void {
    if (this.landed) {
      const { obs, result, error } = this.landed;
      this.landed = null;
      const actions = result ? act(this.match, obs, result.answers, this.policy) : [];
      this.decisions++;
      if (result?.usage?.input_tokens) this.inputTokens += result.usage.input_tokens;
      this.log.unshift({
        at: this.match.time, provider: error ? 'local' : this.provider.id, model: result?.model ?? '-',
        latencyMs: Math.round(result?.latencyMs ?? 0), stance: result?.answers.stance?.choice, actions, error,
      });
      if (this.log.length > 40) this.log.length = 40;
    }
    // A request that never answers must not silence the agent.
    if (this.inFlight && this.now() - this.askedAt > WATCHDOG_MS) { this.generation++; this.inFlight = false; this.failures++; }
    if (this.inFlight) return;
    if ('gameSeconds' in this.pace) {
      if (this.match.time < this.nextAt) return;
      this.nextAt = this.match.time + this.pace.gameSeconds;
    } else {
      // Nothing to decide while the game is paused.
      if (this.now() < this.nextAt || this.match.time === this.lastAskTime) return;
      this.nextAt = this.now() + this.pace.wallMs;
    }
    this.lastAskTime = this.match.time;
    const obs = observe(this.match, this.owner);
    // Nothing to decide with no colony left.
    if (!obs.state.you || (obs.state.you as { strands: number }).strands === 0) return;
    const qs = questions(obs);
    this.inFlight = true;
    this.askedAt = this.now();
    const generation = this.generation;
    const provider = this.provider;
    const ask = async (): Promise<void> => {
      let landed: Landed;
      try {
        if (provider instanceof LocalProvider) provider.prime(obs);
        landed = { obs, result: await provider.decide(obs.state, qs) };
      } catch (error) {
        this.fallback.prime(obs);
        landed = { obs, result: await this.fallback.decide(), error: error instanceof Error ? error.message : String(error) };
      }
      // A provider switched out, or a request the watchdog gave up on, lands on nothing.
      if (generation !== this.generation) return;
      if (landed.error) this.failures++;
      this.landed = landed;
      this.inFlight = false;
    };
    void ask();
  }
}
