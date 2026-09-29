// Agent players (AGENT-01): observation, System One questions, confidence-gated
// actions, the real-time controller, and the decision relay's provider mapping.
// Pure Node; providers are faked, so no key and no network are needed.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
const out = mkdtempSync(join(tmpdir(), 'mycelia-agent-'));
for (const dir of ['src/sim', 'src/agent', 'server']) {
  mkdirSync(join(out, dir), { recursive: true });
  for (const file of readdirSync(new URL(`../${dir}/`, import.meta.url)).filter(f => f.endsWith('.ts'))) {
    const code = stripTypeScriptTypes(readFileSync(new URL(`../${dir}/${file}`, import.meta.url), 'utf8'));
    writeFileSync(join(out, dir, file.replace('.ts', '.mjs')), code.replace(/from '(\.{1,2}\/.+?)'/g, "from '$1.mjs'"));
  }
}
const load = (path) => import(pathToFileURL(join(out, path + '.mjs')));
const { RegionalMatch } = await load('src/sim/match');
const { observe } = await load('src/agent/observe');
const { questions, act, heuristicAnswers } = await load('src/agent/decision');
const { AgentController, LocalProvider } = await load('src/agent/controller');
const { validate, decide, normaliseOpenAI, JEV_URL, available } = await load('server/decide');
globalThis.performance ??= { now: () => Date.now() };

/** A real match with a front: spores land in the rival's stand and grow at it. */
function contactMatch() {
  const m = new RegionalMatch('contact-run', undefined, { starts: 'best' });
  const R = m.region.rivalStand;
  for (let i = 0; i < 300; i++) m.step(1 / 60);
  m.found(m.stands[R], m.stands[m.region.foundingStand], { carbon: 120, water: 20, nitrogen: 10 }, 0);
  const body = m.spatialColonies.get(R);
  const rival = m.stands[R].sim.rival;
  const target = rival.nodes[rival.rootId].spatial;
  m.contact.bots.clear();
  for (let t = 0; t < 120 && !m.contact.frontsOf('rival').length; t++) {
    if (t % 5 === 0) body.growAt({ ...target }, 'x', target.y);
    for (let i = 0; i < 60; i++) m.step(1 / 60);
  }
  return { m, R };
}

{
  // A quiet opening: no fronts, so no targets, but growth options and a small text state.
  const m = new RegionalMatch('raven-wood', undefined, { starts: 'best' });
  for (let i = 0; i < 120; i++) m.step(1 / 60);
  const obs = observe(m, 'rival');
  assert.equal(obs.targets.length, 0);
  assert(obs.growth.length >= 2, 'growth options');
  const text = JSON.stringify(obs.state);
  assert(!/NaN|Infinity/.test(text), 'state is plain JSON');
  const qs = questions(obs);
  assert(validate({ provider: 'jev', state: obs.state, questions: qs }).ok, 'questions pass the relay limits');
  assert(!qs.target, 'no target question without targets');
  console.log(`PASS observation of a quiet opening: ${obs.growth.length} growth options, state ${text.length} chars (~${Math.round(text.length / 4)} tokens), ${Object.keys(qs).length} questions`);
}

const { m, R } = contactMatch();
{
  const obs = observe(m, 'rival');
  assert(obs.targets.length >= 2, `targets at the front (${obs.targets.length})`);
  assert(obs.targets.every((t) => /stand \d+/.test(t.label) && Number.isFinite(t.point.x)), 'labelled targets with points');
  const qs = questions(obs);
  assert.equal(qs.target.type, 'choice');
  assert.equal(Object.keys(qs.target.criteria).length, obs.targets.length);
  assert(validate({ provider: 'jev', state: obs.state, questions: qs }).ok);
  const tokens = Math.round(JSON.stringify({ state: obs.state, questions: qs }).length / 4);
  // Jev bills input tokens at $0.042 per million; one decision a second for an hour:
  const perHour = tokens * 3600 * 0.042 / 1e6;
  console.log(`PASS a front gives ${obs.targets.length} labelled targets (e.g. "${obs.targets[0].label}"); request ~${tokens} tokens, ~$${perHour.toFixed(3)} per hour of play at 1 Hz on Jev`);
}
{
  // Heuristic answers act through the real orders.
  const obs = observe(m, 'rival');
  for (const e of m.stands[R].sim.rival.nodes) if (e.alive) { e.carbon = 2.4; e.nitrogen = 2; e.water = 2; }
  const answers = heuristicAnswers(obs);
  const done = act(m, obs, answers);
  const casts = done.filter((d) => d.kind === 'cast');
  assert(casts.length === 1 && casts[0].ok, `the chosen chemical is cast (${JSON.stringify(done)})`);
  assert(m.contact.casts.some((c) => c.owner === 'rival'), 'the cast is on the record');
  console.log(`PASS answers become orders: ${done.map((d) => `${d.kind}: ${d.text}`).join(' | ')}`);
}
{
  // Code stays in control: low confidence and a withdrawing stance withhold casts.
  const obs = observe(m, 'rival');
  const before = m.contact.casts.length;
  const shaky = act(m, obs, { stance: { type: 'choice', choice: 'attack', confidence: 0.9 }, chemical: { type: 'choice', choice: 'lyse', confidence: 0.1 }, target: { type: 'choice', choice: 't0', confidence: 0.9 } });
  assert(shaky.some((d) => d.kind === 'skip' && /confidence/.test(d.text)));
  const pulling = act(m, obs, { stance: { type: 'choice', choice: 'withdraw', confidence: 0.9 }, chemical: { type: 'choice', choice: 'oxalate', confidence: 0.9 }, target: { type: 'choice', choice: 't0', confidence: 0.9 } });
  assert(pulling.some((d) => d.kind === 'skip' && /withdraw/.test(d.text)));
  const bogus = act(m, obs, { chemical: { type: 'choice', choice: 'napalm', confidence: 1 }, target: { type: 'choice', choice: 't99', confidence: 1 } });
  assert.equal(bogus.length, 0, 'out-of-set answers do nothing');
  assert.equal(m.contact.casts.length, before, 'nothing was cast');
  console.log('PASS confidence gating, stance limits and out-of-set answers keep the code in control');
}
{
  // The controller: never blocks the game, applies what lands, falls back on failure.
  let calls = 0;
  let release;
  const slow = { id: 'jev', decide: () => { calls++; return new Promise((resolve) => { release = resolve; }); } };
  const agent = new AgentController(m, 'rival', slow, { every: 0.5 });
  assert(!m.contact.bots.has('rival'), 'the agent replaces the placeholder');
  agent.update();
  assert.equal(calls, 1, 'asked once');
  for (let i = 0; i < 90; i++) { m.step(1 / 60); agent.update(); }
  assert.equal(calls, 1, 'one request in flight at a time, the game kept running');
  const obs = observe(m, 'rival');
  release({ answers: heuristicAnswers(obs), model: 'jev-1.13.0', latencyMs: 110, usage: { input_tokens: 900 } });
  await new Promise((r) => setTimeout(r, 0));
  agent.update();
  assert.equal(agent.decisions, 1);
  assert.equal(agent.inputTokens, 900);
  assert.equal(agent.log[0].model, 'jev-1.13.0');
  const failing = { id: 'openai', decide: async () => { throw new Error('relay answered 503'); } };
  agent.setProvider(failing);
  for (let i = 0; i < 60; i++) { m.step(1 / 60); agent.update(); await new Promise((r) => setTimeout(r, 0)); }
  assert(agent.failures >= 1 && agent.log.some((l) => l.error && l.provider === 'local'), `a failed provider falls back to the heuristic ${JSON.stringify({ f: agent.failures, d: agent.decisions, log: agent.log.slice(0, 3), t: m.time })}`);
  agent.release();
  assert(m.contact.bots.has('rival'), 'released back to the placeholder');
  console.log(`PASS controller: non-blocking, one request in flight, answers applied on landing, ${agent.failures} failure(s) fell back to the heuristic`);
}
{
  // The offline agent plays a whole minute through the same path.
  const agent = new AgentController(m, 'rival', new LocalProvider(), { every: 1 });
  for (let i = 0; i < 60 * 60; i++) { m.step(1 / 60); agent.update(); if (i % 30 === 0) await new Promise((r) => setTimeout(r, 0)); }
  const acts = agent.log.flatMap((l) => l.actions);
  assert(agent.decisions >= 50, `decisions ${agent.decisions}`);
  console.log(`PASS the offline agent played a minute: ${agent.decisions} decisions, ${acts.filter((a) => a.kind === 'cast' && a.ok).length} casts, ${acts.filter((a) => a.kind === 'grow').length} growth orders`);
  agent.release();
}
{
  // The relay: validation, Jev mapping, and failure modes, against a fake fetch.
  assert(!validate({ provider: 'x', state: {}, questions: {} }).ok);
  assert(!validate({ provider: 'jev', state: {}, questions: { a: { type: 'choice', criteria: { only: null } } } }).ok, 'a choice needs two options');
  assert(!validate({ provider: 'jev', state: {}, questions: { a: { type: 'score', criteria: ['one'] } } }).ok, 'a score needs two levels');
  const qs = { stance: { type: 'choice', instructions: 'pick', criteria: { attack: 'a', hold: 'h' } }, losing: { type: 'noul', instructions: 'losing?' } };
  let seen;
  const fakeFetch = async (url, init) => {
    seen = { url, init, body: JSON.parse(init.body) };
    return { ok: true, status: 200, text: async () => '', json: async () => ({ model: 'jev-1.13.0', answers: { stance: { choice: 'attack', probabilities: { attack: 0.8, hold: 0.2 }, confidence: 0.7 }, losing: { noul: 0.2 } }, usage: { input_tokens: 321, output_tokens: 2 } }) };
  };
  let clock = 1000;
  const res = await decide({ provider: 'jev', state: { a: 1 }, questions: qs }, { TYPESAFE_API_KEY: 'k' }, fakeFetch, () => (clock += 55));
  assert.equal(res.status, 200);
  assert.equal(seen.url, JEV_URL);
  assert.equal(seen.init.headers.authorization, 'Bearer k');
  assert.equal(seen.body.model, 'jev-latest');
  assert.deepEqual(seen.body.questions, qs, 'questions pass through in Jev form');
  assert.equal(res.body.answers.stance.choice, 'attack');
  assert.equal(res.body.answers.stance.type, 'choice');
  assert.equal(res.body.answers.losing.noul, 0.2);
  assert.equal(res.body.usage.input_tokens, 321);
  const none = await decide({ provider: 'jev', state: {}, questions: qs }, {}, fakeFetch);
  assert.equal(none.status, 503, 'no key, no call');
  const preview = await decide({ provider: 'openai', state: {}, questions: qs }, { OPENAI_API_KEY: 'k' }, fakeFetch);
  assert.equal(preview.status, 503, 'OpenAI Decisions needs its preview URL');
  assert.deepEqual(available({ TYPESAFE_API_KEY: 'k' }), { jev: true, openai: false });
  const a1 = normaliseOpenAI({ questions: qs }, { decisions: [{ id: 'stance', answer: 'hold', confidence: 0.6 }, { id: 'losing', answer: 'true', confidence: 0.9 }] });
  const a2 = normaliseOpenAI({ questions: qs }, { answers: { stance: { value: 'attack' } } });
  assert.equal(a1.stance.choice, 'hold'); assert.equal(a1.losing.noul, 0.9); assert.equal(a2.stance.choice, 'attack');
  console.log('PASS relay: requests validated, Jev called with key, model and questions as given, answers normalised; unconfigured providers refuse without calling out');
}
