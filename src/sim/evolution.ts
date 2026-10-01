import { markConnectivity, type Network } from './network';
import { heldBy } from './segments';

/**
 * Adaptations belong to the player, not to one body: in a regional match every
 * colony shares one learned list (`RegionalMatch.lineage`), so a spore daughter
 * starts with everything learned. Readiness is still judged on the colony
 * doing the learning, and powers keep per-colony timers.
 */
export const ADAPTATIONS = [
  { id: 'storm-crown', branch: 'Fruiting', name: 'Storm crown', parent: 'spore-memory', need: 'Five minutes of colony life, a completed fruiting, Mineral weave and two living bonds.', effect: 'Summon a shared storm. Choose its wind, prepare fruiting bodies, and colonize farther downwind.', ready: (n: Network) => n.evolution.age >= 300 && n.fruited >= 1 && bonds(n) >= 2 && n.evolution.learned.includes('mineral-weave') },
  { id: 'deep-drink', branch: 'Exchange', name: 'Deep drink', parent: '', need: 'Sustain a living root bond.', effect: 'Draw water from occupied soil 20% faster.', ready: (n: Network) => bonds(n) >= 1 },
  { id: 'mineral-weave', branch: 'Exchange', name: 'Mineral weave', parent: 'deep-drink', need: 'Supply two different trees.', effect: 'Gather nitrogen from occupied soil 20% faster.', ready: (n: Network) => bonds(n) >= 2 },
  { id: 'parch-crown', branch: 'Exchange', name: 'Parch crown', parent: 'mineral-weave', need: 'Five minutes of colony life, three living bonds and 60 water banked in connected strands.', effect: 'Call a drought. The rain stops across the region: dry ground cracks, unfed trees wither and shallow strands dry out; trees you keep supplied, and ground by the stream, hold.', ready: (n: Network) => n.evolution.age >= 300 && bonds(n) >= 3 && n.nodes.reduce((v, x) => v + (x.alive && x.connected ? heldBy(n, x, 'water') : 0), 0) >= 60 },
  { id: 'living-sheath', branch: 'Resilience', name: 'Living sheath', parent: '', need: 'Keep a bond and grow fifty connected strands.', effect: 'Fed strands recover health faster.', ready: (n: Network) => bonds(n) >= 1 && living(n) >= 50 },
  { id: 'cord-memory', branch: 'Resilience', name: 'Cord memory', parent: 'living-sheath', need: 'Reinforce three connected strands.', effect: 'Move resources along existing routes 25% faster.', ready: (n: Network) => n.nodes.filter(x => x.alive && x.connected && x.reinforced).length >= 3 },
  { id: 'ember-crown', branch: 'Resilience', name: 'Ember crown', parent: 'cord-memory', need: 'Five minutes of colony life and thirty connected strands deeper than 16 cm.', effect: 'Kindle a wildfire and choose where it runs. Crowns, shallow strands and fruiting bodies burn for every colony, yours too; deep cords survive, and the ash feeds a fruiting flush.', ready: (n: Network) => n.evolution.age >= 300 && n.nodes.filter(x => x.alive && x.connected && x.gy >= 16).length >= 30 },
  { id: 'fruit-memory', branch: 'Fruiting', name: 'Quiet reserve', parent: '', need: 'Keep a bond after three minutes of colony life.', effect: 'Rest banks 65% of healthy trade toward fruiting, leaving less for growth.', ready: (n: Network) => bonds(n) >= 1 && n.evolution.age >= 180 },
  { id: 'spore-memory', branch: 'Fruiting', name: 'Spore memory', parent: 'fruit-memory', need: 'Complete your first fruiting.', effect: 'Supplied fruiting bodies mature 15% faster; the full reserve is still spent.', ready: (n: Network) => n.fruited >= 1 },
] as const;

export const POWERS = [
  { id: 'pulse', tech: 'mineral-weave', name: 'Forest pulse', need: 'First fruiting · two living tree bonds', effect: 'Double transport for twenty seconds. Resources still follow connected strands.', ready: (n: Network) => bonds(n) >= 2 },
  { id: 'mend', tech: 'cord-memory', name: 'Mend the web', need: 'First fruiting · damaged, connected strands', effect: 'For twenty seconds, repair living strands using their own carbon. Severed strands cannot be healed.', ready: (n: Network) => n.nodes.some(x => x.alive && x.connected && x.health < 0.95 && heldBy(n, x, 'carbon') > 0) },
  { id: 'bloom', tech: 'spore-memory', name: 'Second spring', need: 'First fruiting · a new fruiting body underway', effect: 'Double maturation for twenty seconds. Supply, weather and the full fruiting cost still apply.', ready: (n: Network) => n.fruit.active },
] as const;

function bonds(net: Network): number {
  return new Set(net.nodes.filter(n => n.alive && n.connected && n.bondedTree >= 0).map(n => n.bondedTree)).size;
}
function living(net: Network): number { return net.nodes.filter(n => n.alive && n.connected).length; }

export function adaptationState(net: Network, id: string): string {
  const tech = ADAPTATIONS.find(t => t.id === id);
  if (!tech) return 'Unknown adaptation.';
  if (net.evolution.learned.includes(id)) return 'Learned';
  if (net.extinct || !net.nodes[net.rootId]?.alive) return 'A living colony is needed.';
  if (tech.parent && !net.evolution.learned.includes(tech.parent)) return `Learn ${ADAPTATIONS.find(t => t.id === tech.parent)!.name} first.`;
  return tech.ready(net) ? 'Ready to learn' : tech.need;
}

export function learnAdaptation(net: Network, id: string): string {
  markConnectivity(net);
  const state = adaptationState(net, id);
  if (state !== 'Ready to learn') return state;
  net.evolution.learned.push(id);
  return `${ADAPTATIONS.find(t => t.id === id)!.name} learned.`;
}

export function powerState(net: Network, id: string): string {
  const power = POWERS.find(p => p.id === id);
  if (!power) return 'Unknown power.';
  if (net.extinct || !net.nodes[net.rootId]?.alive) return 'A living colony is needed.';
  if (!net.evolution.learned.includes(power.tech)) return `Learn ${ADAPTATIONS.find(t => t.id === power.tech)!.name} first.`;
  if (net.fruited < 1) return 'Complete the first fruiting.';
  if (net.evolution.active[id]! > 0) return `Active · ${Math.ceil(net.evolution.active[id]!)}s`;
  if (net.evolution.cooldown[id]! > 0) return `Recovering · ${Math.ceil(net.evolution.cooldown[id]!)}s`;
  return power.ready(net) ? 'Ready to invoke' : power.need;
}

export function invokePower(net: Network, id: string): string {
  markConnectivity(net);
  const state = powerState(net, id);
  if (state !== 'Ready to invoke') return state;
  net.evolution.active[id] = 20;
  net.evolution.cooldown[id] = 120;
  return `${POWERS.find(p => p.id === id)!.name} awakened.`;
}
