/**
 * The decision relay: one server-side place that holds API keys and turns the
 * game's provider-neutral System One request into a provider's own call.
 *
 * The game never sees a key. It posts `{ provider, state, questions }` to
 * `/api/decide` (a Cloudflare Pages Function in production, a Vite middleware
 * in development) and gets back typed answers in one normalised shape.
 *
 * Providers:
 * - `jev`: TypeSafe Jev, `POST https://api.typesafe.ai/v1/systemone`
 *   (https://docs.typesafe.ai/api). Questions are sent as they are: the game's
 *   question format is Jev's.
 * - `openai`: OpenAI's Decisions API (GPT-6 Luna, limited preview, announced
 *   29 September 2026). Its request schema is not public yet, so the endpoint
 *   is configured (`OPENAI_DECISIONS_URL`) and the mapping below is isolated in
 *   `openaiRequest` / `normaliseOpenAI` to be confirmed against the preview
 *   docs. Until the URL is set, the provider reports itself unavailable.
 */

export type QuestionType = 'choice' | 'score' | 'noul';

export interface ChoiceQuestion { type: 'choice'; instructions?: unknown; criteria: Record<string, string | null> }
export interface ScoreQuestion { type: 'score'; instructions?: unknown; criteria: string[] }
export interface NoulQuestion { type: 'noul'; instructions?: unknown; criteria?: { true?: string; false?: string } }
export type Question = ChoiceQuestion | ScoreQuestion | NoulQuestion;

export interface Answer {
  type: QuestionType;
  choice?: string;
  probabilities?: Record<string, number> | number[];
  confidence?: number;
  score?: number;
  noul?: number;
}

export type Provider = 'jev' | 'openai';

export interface DecideRequest {
  provider: Provider;
  state: unknown;
  questions: Record<string, Question>;
}

export interface DecideResponse {
  provider: Provider;
  model: string;
  answers: Record<string, Answer>;
  usage?: { input_tokens?: number; output_tokens?: number };
  /** Round trip to the provider, measured on the relay. */
  latencyMs: number;
}

export interface DecideEnv {
  TYPESAFE_API_KEY?: string;
  TYPESAFE_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_DECISIONS_URL?: string;
  OPENAI_DECISIONS_MODEL?: string;
}

type Fetch = (input: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
/** Jev accepts at most 255 options for a Choice and 2 to 10 Score levels. */
export const LIMITS = { choiceOptions: 255, scoreLevels: [2, 10] as const, questions: 64, stateChars: 60000 };

/** Validate a request from the game; returns a reason when it is refused. */
export function validate(body: unknown): { ok: true; request: DecideRequest } | { ok: false; reason: string } {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'Body must be a JSON object.' };
  const { provider, state, questions } = body as Partial<DecideRequest>;
  if (provider !== 'jev' && provider !== 'openai') return { ok: false, reason: 'provider must be "jev" or "openai".' };
  if (state === undefined) return { ok: false, reason: 'state is required.' };
  if (JSON.stringify(state).length > LIMITS.stateChars) return { ok: false, reason: 'state is too large.' };
  if (!questions || typeof questions !== 'object') return { ok: false, reason: 'questions must be an object.' };
  const entries = Object.entries(questions);
  if (!entries.length || entries.length > LIMITS.questions) return { ok: false, reason: `Ask between 1 and ${LIMITS.questions} questions.` };
  for (const [id, q] of entries) {
    if (!q || typeof q !== 'object') return { ok: false, reason: `Question ${id} is not an object.` };
    if (q.type === 'choice') {
      const n = Object.keys(q.criteria ?? {}).length;
      if (n < 2 || n > LIMITS.choiceOptions) return { ok: false, reason: `Choice ${id} needs 2 to ${LIMITS.choiceOptions} options.` };
    } else if (q.type === 'score') {
      const n = Array.isArray(q.criteria) ? q.criteria.length : 0;
      if (n < LIMITS.scoreLevels[0] || n > LIMITS.scoreLevels[1]) return { ok: false, reason: `Score ${id} needs 2 to 10 levels.` };
    } else if (q.type !== 'noul') {
      return { ok: false, reason: `Question ${id} has an unknown type.` };
    }
  }
  return { ok: true, request: { provider, state, questions: questions as Record<string, Question> } };
}

/** Which providers this relay can reach, for the game's opponent picker. */
export function available(env: DecideEnv): Record<Provider, boolean> {
  return { jev: Boolean(env.TYPESAFE_API_KEY), openai: Boolean(env.OPENAI_API_KEY && env.OPENAI_DECISIONS_URL) };
}

export async function decide(request: DecideRequest, env: DecideEnv, fetchFn: Fetch, now: () => number = () => Date.now()): Promise<{ status: number; body: DecideResponse | { error: string } }> {
  const started = now();
  if (request.provider === 'jev') {
    if (!env.TYPESAFE_API_KEY) return { status: 503, body: { error: 'Jev is not configured: set TYPESAFE_API_KEY on the server.' } };
    const res = await fetchFn(JEV_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.TYPESAFE_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ state: request.state, model: env.TYPESAFE_MODEL ?? 'jev-latest', questions: request.questions }),
    });
    if (!res.ok) return { status: res.status, body: { error: `Jev answered ${res.status}: ${(await res.text()).slice(0, 300)}` } };
    const data = (await res.json()) as { model?: string; answers?: Record<string, Answer>; usage?: DecideResponse['usage'] };
    const answers: Record<string, Answer> = {};
    for (const [id, q] of Object.entries(request.questions)) {
      const a = data.answers?.[id];
      if (a) answers[id] = { ...a, type: q.type };
    }
    return { status: 200, body: { provider: 'jev', model: data.model ?? 'jev', answers, usage: data.usage, latencyMs: now() - started } };
  }
  if (!env.OPENAI_API_KEY || !env.OPENAI_DECISIONS_URL) {
    return { status: 503, body: { error: 'OpenAI Decisions is not configured: set OPENAI_API_KEY and OPENAI_DECISIONS_URL (limited preview) on the server.' } };
  }
  const res = await fetchFn(env.OPENAI_DECISIONS_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(openaiRequest(request, env)),
  });
  if (!res.ok) return { status: res.status, body: { error: `OpenAI Decisions answered ${res.status}: ${(await res.text()).slice(0, 300)}` } };
  const data = await res.json();
  return { status: 200, body: { provider: 'openai', model: env.OPENAI_DECISIONS_MODEL ?? 'luna', answers: normaliseOpenAI(request, data), latencyMs: now() - started } };
}

/**
 * OpenAI Decisions request. UNVERIFIED: the preview schema is unpublished.
 * Announced shape: "define questions and possible answers, supply context as
 * text or images, get answers with confidence". Every question becomes a set
 * of named answers; a Noul is a yes/no pair and a Score its ordered levels.
 * Adjust here, and only here, once the preview docs are in hand.
 */
export function openaiRequest(request: DecideRequest, env: DecideEnv): unknown {
  const questions = Object.entries(request.questions).map(([id, q]) => ({
    id,
    question: typeof q.instructions === 'string' ? q.instructions : JSON.stringify(q.instructions ?? id),
    answers: q.type === 'choice'
      ? Object.entries(q.criteria).map(([value, description]) => ({ value, description: description ?? value }))
      : q.type === 'score'
        ? q.criteria.map((description, i) => ({ value: String(i), description }))
        : [{ value: 'true', description: q.criteria?.true ?? 'yes' }, { value: 'false', description: q.criteria?.false ?? 'no' }],
  }));
  return {
    model: env.OPENAI_DECISIONS_MODEL ?? 'gpt-6-luna',
    context: [{ type: 'text', text: typeof request.state === 'string' ? request.state : JSON.stringify(request.state) }],
    questions,
  };
}

/**
 * Read an OpenAI Decisions response back into the game's answer shape.
 * Tolerant by design until the preview schema is confirmed: it accepts
 * `decisions` or `answers`, as an array of `{ id, answer|value, confidence,
 * probabilities? }` or a map keyed by question id.
 */
export function normaliseOpenAI(request: DecideRequest, data: unknown): Record<string, Answer> {
  const out: Record<string, Answer> = {};
  const root = (data ?? {}) as Record<string, unknown>;
  const raw = (root.decisions ?? root.answers ?? []) as unknown;
  const byId = new Map<string, Record<string, unknown>>();
  if (Array.isArray(raw)) for (const item of raw) { const r = item as Record<string, unknown>; if (typeof r.id === 'string') byId.set(r.id, r); }
  else if (raw && typeof raw === 'object') for (const [id, item] of Object.entries(raw)) byId.set(id, item as Record<string, unknown>);
  for (const [id, q] of Object.entries(request.questions)) {
    const r = byId.get(id);
    if (!r) continue;
    const value = String(r.answer ?? r.value ?? r.choice ?? '');
    const confidence = typeof r.confidence === 'number' ? r.confidence : undefined;
    const probabilities = (r.probabilities && typeof r.probabilities === 'object') ? r.probabilities as Record<string, number> : undefined;
    if (q.type === 'choice') out[id] = { type: 'choice', choice: value, confidence, probabilities };
    else if (q.type === 'score') out[id] = { type: 'score', score: Number(value), confidence };
    else out[id] = { type: 'noul', noul: probabilities?.true ?? (value === 'true' ? (confidence ?? 1) : 1 - (confidence ?? 1)) };
  }
  return out;
}

/** The HTTP handler both hosts share: GET reports providers, POST decides. */
export async function handle(method: string, body: unknown, env: DecideEnv, fetchFn: Fetch): Promise<{ status: number; body: unknown }> {
  if (method === 'GET') return { status: 200, body: { providers: available(env) } };
  if (method !== 'POST') return { status: 405, body: { error: 'Use POST.' } };
  const checked = validate(body);
  if (!checked.ok) return { status: 422, body: { error: checked.reason } };
  try {
    return await decide(checked.request, env, fetchFn);
  } catch (error) {
    return { status: 502, body: { error: `Provider unreachable: ${error instanceof Error ? error.message : String(error)}` } };
  }
}
