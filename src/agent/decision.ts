/**
 * The System One question set for one decision, and what the code does with
 * the answers. Code stays in control: the model picks among closed options,
 * each pick is gated by its confidence, and every action goes through the same
 * validated orders a person uses (`ContactWar.cast`, growth waypoints).
 */
import { CHEMICALS, CHEMICAL_ORDER, type Chemical } from '../sim/contact';
import type { RegionalMatch } from '../sim/match';
import { orderWaypoint, claimSteering, type Network } from '../sim/network';
import type { Observation } from './observe';

/** The provider-neutral question format (TypeSafe Jev's). */
export type Question =
  | { type: 'choice'; instructions?: unknown; criteria: Record<string, string | null> }
  | { type: 'score'; instructions?: unknown; criteria: string[] }
  | { type: 'noul'; instructions?: unknown; criteria?: { true?: string; false?: string } };

export interface Answer {
  type: 'choice' | 'score' | 'noul';
  choice?: string;
  probabilities?: Record<string, number> | number[];
  confidence?: number;
  score?: number;
  noul?: number;
}

export const STANCES = {
  attack: 'Press the front: spend chemicals to kill enemy strands and push in.',
  hold: 'Hold the line: cast only when a strike is cheap and clearly useful.',
  withdraw: 'The front is lost or too costly: stop spending, shield or pull back.',
  expand: 'No fight worth having: put resources into growth instead.',
} as const;
export type Stance = keyof typeof STANCES;

/**
 * With no front open there is nothing to hold or withdraw from. Offered the
 * full set anyway, Jev read a won fight against a larger enemy as losing and
 * withdrew, which stops all growth (live, 1 October).
 */
export const QUIET_STANCES = {
  expand: 'No front is open: put resources into growth.',
  attack: 'No front is open: grow toward the enemy to start a fight.',
} as const;

export function questions(obs: Observation): Record<string, Question> {
  const q: Record<string, Question> = {
    stance: {
      type: 'choice',
      instructions: 'You play this fungal colony. Given the state, which stance should it take for the next second?',
      criteria: obs.fronts > 0 ? { ...STANCES } : { ...QUIET_STANCES },
    },
    chemical: {
      type: 'choice',
      instructions: 'Which chemical, if any, should the colony secrete now? Only chemicals ready this second are offered; one that is not affordable near the front will be refused.',
      // Only what is off cooldown: a sharper choice, and no orders refused for timing.
      criteria: {
        none: 'Secrete nothing this second.',
        ...Object.fromEntries(CHEMICAL_ORDER.filter((c) => obs.ready.includes(c)).map((c) => [c, `${CHEMICALS[c].name} (${CHEMICALS[c].weight}): ${CHEMICALS[c].effect}`])),
      },
    },
    strike: {
      type: 'noul',
      instructions: 'Spending resources on a chemical this second is worth its cost: there is an enemy strand in reach worth killing and the colony can afford it.',
    },
    losing: {
      type: 'noul',
      instructions: 'The colony is losing its fights: it is losing more strands than it kills, or its fronts are shrinking.',
    },
  };
  if (obs.targets.length >= 2) {
    q.target = {
      type: 'choice',
      instructions: 'Where should a chemical be aimed? Prefer strands whose death cuts off many others, and strands the chemical can kill.',
      criteria: Object.fromEntries(obs.targets.map((t) => [t.id, t.label])),
    };
  }
  if (obs.growth.length >= 2) {
    q.growth = {
      type: 'choice',
      instructions: 'Where should the colony grow next?',
      criteria: Object.fromEntries(obs.growth.map((g) => [g.id, g.label])),
    };
  }
  return q;
}

export interface Executed {
  kind: 'cast' | 'grow' | 'skip';
  text: string;
  ok: boolean;
}

export interface Policy {
  /** Picks below this confidence are not acted on. */
  minConfidence: number;
  /**
   * Whether to cast at all is its own yes/no question (`strike`); which
   * chemical is then a spread-out choice among several, so it needs less.
   */
  strikeAt: number;
  chemicalConfidence: number;
}

export const DEFAULT_POLICY: Policy = { minConfidence: 0.35, strikeAt: 0.5, chemicalConfidence: 0.15 };

const confident = (a: Answer | undefined, policy: Policy) => a !== undefined && (a.confidence ?? 1) >= policy.minConfidence;

/** The last growth order sent to each network, so the same one is not re-sent every second. */
const lastGrowth = new WeakMap<Network, { key: string; at: number }>();
const REGROW_SECONDS = 20;

/** Turn answers into orders. Deterministic given the match, observation and answers. */
export function act(match: RegionalMatch, obs: Observation, answers: Record<string, Answer>, policy: Policy = DEFAULT_POLICY): Executed[] {
  const done: Executed[] = [];
  // Only a stance that was offered counts; with no front, holding is expanding.
  const offered: Record<string, string> = obs.fronts > 0 ? STANCES : QUIET_STANCES;
  const picked = answers.stance?.choice;
  const stance: Stance = picked !== undefined && picked in offered ? picked as Stance : obs.fronts > 0 ? 'hold' : 'expand';
  const chemical = answers.chemical?.choice as Chemical | 'none' | undefined;
  const chosen = obs.targets.length === 1 ? obs.targets[0] : obs.targets.find((t) => t.id === answers.target?.choice);
  if (chemical && chemical !== 'none' && CHEMICALS[chemical] && chosen) {
    // Stance keeps the code in charge: a colony pulling back only shields.
    const allowed = stance === 'withdraw' ? chemical === 'barrage' : stance !== 'expand' || CHEMICALS[chemical].weight === 'light';
    if (!allowed) done.push({ kind: 'skip', text: `${CHEMICALS[chemical].name} withheld: stance is ${stance}`, ok: false });
    else if (
      (answers.strike ? (answers.strike.noul ?? 0) < policy.strikeAt || (answers.chemical?.confidence ?? 1) < policy.chemicalConfidence : !confident(answers.chemical, policy)) ||
      (obs.targets.length > 1 && !confident(answers.target, policy))
    ) {
      done.push({ kind: 'skip', text: `${CHEMICALS[chemical].name} withheld: low confidence`, ok: false });
    } else {
      const result = match.contact.cast(obs.owner, chemical, chosen.point);
      done.push({ kind: 'cast', text: result.message, ok: result.ok });
    }
  }
  const growth = obs.growth.find((g) => g.id === answers.growth?.choice);
  if (growth?.order && stance !== 'withdraw' && confident(answers.growth, policy)) {
    const stand = match.stands[growth.order.standId];
    const net = stand?.sim[obs.owner as 'player' | 'rival'];
    const key = `${growth.order.standId}:${growth.order.gx}:${growth.order.gy}`;
    const last = net ? lastGrowth.get(net) : undefined;
    if (last && last.key === key && match.time - last.at < REGROW_SECONDS) {
      // Already sent there recently: re-issuing would only reset the tips' progress.
    } else if (stand && net && !net.extinct) {
      // A colony that has grown into a regional body is ordered through the
      // body, at the regional point the stand's cell stands for.
      const body = (obs.owner === 'rival' ? match.rivalSpatialColonies : match.spatialColonies).get(growth.order.standId);
      let ok = true;
      let text = growth.label;
      if (body && body.colony === net) {
        const point = stand.sim.world.regionalSoil?.pointAt(growth.order.gx, growth.order.gy);
        const result = point ? body.growAt(point, 'x', point.y) : { ok: false, message: 'That cell has no regional place.' };
        ok = result.ok;
        if (!ok) text = `${growth.label}: ${result.message}`;
      } else {
        net.waypoints.length = 0;
        orderWaypoint(net, growth.order.gx, growth.order.gy, stand.sim.world);
      }
      if (ok) {
        lastGrowth.set(net, { key, at: match.time });
        // The order stands against the colony's own strategy until it may be re-sent.
        claimSteering(net, REGROW_SECONDS);
      }
      done.push({ kind: 'grow', text, ok });
    }
  }
  return done;
}

/**
 * The placeholder's heuristic, answering the same questions instantly and
 * offline: the fallback when no provider is configured, and the test double.
 */
export function heuristicAnswers(obs: Observation): Record<string, Answer> {
  const you = obs.state.you as { carbon: number; nitrogen: number; water: number; strands_lost_in_fights: number; strands_killed: number };
  const fronting = obs.targets.length > 0;
  const losing = you.strands_lost_in_fights > you.strands_killed + 5;
  const stance: Stance = !fronting ? 'expand' : losing ? 'hold' : 'attack';
  let chemical: Chemical | 'none' = 'none';
  if (fronting) {
    if (obs.ready.includes('oxalate') && you.nitrogen > 3 && you.carbon > 8) chemical = 'oxalate';
    else if (losing && obs.ready.includes('barrage') && you.water > 4) chemical = 'barrage';
    else if (obs.ready.includes('lyse')) chemical = 'lyse';
  }
  const target = obs.targets.find((t) => /most strands depend/.test(t.label)) ?? obs.targets[0];
  const growth = obs.growth.find((g) => (fronting ? /enemy/.test(g.label) : /dead or burned|living tree/.test(g.label))) ?? obs.growth[0];
  const answers: Record<string, Answer> = {
    stance: { type: 'choice', choice: stance, confidence: 1 },
    chemical: { type: 'choice', choice: chemical, confidence: 1 },
    losing: { type: 'noul', noul: losing ? 0.9 : 0.1 },
    strike: { type: 'noul', noul: chemical === 'none' ? 0.1 : 0.9 },
  };
  if (target) answers.target = { type: 'choice', choice: target.id, confidence: 1 };
  if (growth) answers.growth = { type: 'choice', choice: growth.id, confidence: 1 };
  return answers;
}
