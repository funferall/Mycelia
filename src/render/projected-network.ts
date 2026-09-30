/**
 * A colony as one stand's transect sees it.
 *
 * Every stand's underground view is the same flat transect: columns across the
 * stand, rows down into the soil. A colony founded in that stand is drawn and
 * ordered in those columns directly. A colony's regional body that has grown
 * in from another stand keeps its own columns, counted from the stand it was
 * founded in, and spreads north and south of the transect too.
 *
 * This view presents such a body to the transect's drawing and labelling code
 * unchanged: column fields (`gx`, `wx`, `targetGx`, and the columns of its
 * waypoints, blooms and fruiting body) are shifted into this stand's columns,
 * and strands outside this stand's row of the region read as not alive, so a
 * stand never draws a strand that lies in a stand north or south of it. Depth
 * needs no change: a row is centimetres below the local ground everywhere.
 *
 * It is a view, not a copy: reads see the live network, and orders go to the
 * body itself in regional coordinates (see `Game.orderBelow`), never through
 * this object.
 */
import type { HyphaNode, Network } from '../sim/network';

const SHIFTED = new Set<PropertyKey>(['gx', 'wx', 'targetGx']);

export interface StandBand {
  /** Regional y the stand's row of the region spans, [minY, maxY). */
  readonly minY: number;
  readonly maxY: number;
}

/** Whether a strand stands in this row of stands. */
function inBand(node: HyphaNode, band: StandBand | null): boolean {
  if (!band) return true;
  const y = node.spatial?.y ?? node.y;
  return y >= band.minY && y < band.maxY;
}

export class ProjectedNetwork {
  /** The network as the transect reads it. */
  readonly view: Network;
  readonly source: Network;
  readonly shift: number;
  readonly band: StandBand | null;
  private readonly proxies = new WeakMap<HyphaNode, HyphaNode>();
  private readonly nodes: HyphaNode[] = [];

  constructor(source: Network, shift: number, band: StandBand | null) {
    this.source = source;
    this.shift = shift;
    this.band = band;
    const self = this;
    const nodeHandler: ProxyHandler<HyphaNode> = {
      get(target, property, receiver) {
        if (SHIFTED.has(property)) return (target[property as 'gx'] as number) + self.shift;
        if (property === 'alive') return target.alive && inBand(target, self.band);
        return Reflect.get(target, property, receiver);
      },
      set(target, property, value) {
        if (SHIFTED.has(property)) return Reflect.set(target, property, (value as number) - self.shift);
        return Reflect.set(target, property, value);
      },
    };
    const proxyOf = (node: HyphaNode): HyphaNode => {
      let proxy = this.proxies.get(node);
      if (!proxy) {
        proxy = new Proxy(node, nodeHandler);
        this.proxies.set(node, proxy);
      }
      return proxy;
    };
    const shiftColumn = <T extends { gx: number }>(item: T): T => ({ ...item, gx: item.gx + self.shift });
    this.view = new Proxy(source, {
      get(target, property, receiver) {
        switch (property) {
          case 'nodes': {
            const list = self.nodes;
            // A network only ever appends; nodes are never removed from the array.
            for (let i = list.length; i < target.nodes.length; i++) list.push(proxyOf(target.nodes[i]!));
            if (list.length > target.nodes.length) list.length = target.nodes.length;
            return list;
          }
          case 'waypoints': return target.waypoints.map(shiftColumn);
          case 'groups': return target.groups?.map((group) => ({ ...group, waypoints: group.waypoints.map(shiftColumn) }));
          case 'blooms': return target.blooms.map(shiftColumn);
          case 'fruit': return target.fruit.active ? shiftColumn(target.fruit) : target.fruit;
          default: return Reflect.get(target, property, receiver);
        }
      },
    });
  }

  /** The real strand behind a node of the view (same id). */
  real(id: number): HyphaNode | undefined {
    return this.source.nodes[id];
  }
}
