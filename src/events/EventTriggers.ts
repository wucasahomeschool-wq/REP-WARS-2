import { FactionId, TerritoryId, Resources, Territory, WarlordSnapshot } from '../types';
import { BALANCE } from '../constants/balance';
import {
  ActiveEvent, WorldHelper, ConditionContext, EventConditionFn,
  TriggerScore, EventSeverity,
} from './EventModel';
import { SeededRNG } from '../utils/SeededRNG';

export class WorldHelperImpl implements WorldHelper {
  private territories: Map<TerritoryId, Territory>;
  private factions: Map<FactionId, WarlordSnapshot>;
  private activeEvents: ActiveEvent[];

  constructor(
    territories: Map<TerritoryId, Territory>,
    factions: Map<FactionId, WarlordSnapshot>,
    activeEvents: ActiveEvent[],
  ) {
    this.territories = territories;
    this.factions = factions;
    this.activeEvents = activeEvents;
  }

  getTerritory(id: TerritoryId): Territory | undefined {
    return this.territories.get(id);
  }

  getFaction(id: FactionId): WarlordSnapshot | undefined {
    return this.factions.get(id);
  }

  hasActiveEventOn(territoryId: TerritoryId, eventTypeId: string): boolean {
    return this.activeEvents.some(
      e => e.status === 'active' && e.territoryId === territoryId && e.typeId === eventTypeId
    );
  }

  getActiveEventsOn(territoryId: TerritoryId): ActiveEvent[] {
    return this.activeEvents.filter(
      e => e.status === 'active' && e.territoryId === territoryId
    );
  }

  getActiveEventsByFaction(factionId: FactionId): ActiveEvent[] {
    return this.activeEvents.filter(
      e => e.status === 'active' && e.factionId === factionId
    );
  }

  hasActiveEventTypeId(typeId: string, scope?: { territoryId?: TerritoryId; factionId?: FactionId }): boolean {
    return this.activeEvents.some(e => {
      if (e.status !== 'active' || e.typeId !== typeId) return false;
      if (scope?.territoryId && e.territoryId !== scope.territoryId) return false;
      if (scope?.factionId && e.factionId !== scope.factionId) return false;
      return true;
    });
  }

  countTerrainNeighbors(territoryId: TerritoryId, terrain: string): number {
    const t = this.territories.get(territoryId);
    if (!t) return 0;
    let count = 0;
    for (const nid of t.neighboring) {
      const n = this.territories.get(nid);
      if (n && n.terrain === terrain) count++;
    }
    return count;
  }

  countHostileBorderNeighbors(territoryId: TerritoryId): number {
    const t = this.territories.get(territoryId);
    if (!t || !t.owner) return 0;
    const myFaction = t.owner;
    let hostile = 0;
    for (const nid of t.neighboring) {
      const n = this.territories.get(nid);
      if (!n) continue;
      if (n.owner && n.owner !== myFaction) {
        const rel = this.factions.get(myFaction)?.diplomacy.get(n.owner);
        if (rel && (rel.state === 'hostile' || rel.state === 'at_war' || rel.opinion <= -30)) {
          hostile++;
        }
      }
    }
    return hostile;
  }

  countControlledTerritories(factionId: FactionId): number {
    let count = 0;
    for (const t of this.territories.values()) {
      if (t.owner === factionId) count++;
    }
    return count;
  }

  getTerritoryFoodProduction(t: Territory): number {
    return t.resourceOutput?.food ?? 0;
  }

  getFactionTotalPopulation(fid: FactionId): number {
    let total = 0;
    for (const t of this.territories.values()) {
      if (t.owner === fid) total += t.population;
    }
    return total;
  }

  getFactionResourceRatio(fid: FactionId, resource: keyof Resources): number {
    const f = this.factions.get(fid);
    if (!f) return 1.0;
    const stock = f.resources[resource] ?? 0;
    const income = f.resourceIncome?.[resource] ?? 0;
    if (income <= 0) return 10.0;
    return stock / Math.max(1, income * 5);
  }

  getTerritoryThemeTag(_territoryId: TerritoryId): string | null {
    return null;
  }
}

export function buildConditionContext(
  turn: number,
  territoryId: TerritoryId | null,
  factionId: FactionId | null,
  territories: Map<TerritoryId, Territory>,
  factions: Map<FactionId, WarlordSnapshot>,
  activeEvents: ActiveEvent[],
  rng: SeededRNG,
): ConditionContext {
  const helper = new WorldHelperImpl(territories, factions, activeEvents);
  return {
    turn,
    territoryId,
    factionId,
    world: { territories, factions, activeEvents },
    helper,
    rng,
  };
}

type TriggerBuilderParams = {
  baseWeight: number;
  eligibility?: (ctx: ConditionContext) => boolean;
  modifiers?: Array<{
    when: (ctx: ConditionContext) => boolean;
    apply: (score: TriggerScore) => TriggerScore;
    reason: (ctx: ConditionContext) => string;
  }>;
  severityByConditions?: Array<{
    when: (ctx: ConditionContext) => boolean;
    severity: EventSeverity;
    reason: (ctx: ConditionContext) => string;
  }>;
};

export function buildTriggerFn(params: TriggerBuilderParams): EventConditionFn {
  return (ctx: ConditionContext): TriggerScore => {
    let score: TriggerScore = {
      eligible: true,
      baseWeight: params.baseWeight,
      reasons: [],
    };

    if (params.eligibility && !params.eligibility(ctx)) {
      score.eligible = false;
      score.reasons.push('Basic eligibility not met');
      return score;
    }

    if (params.modifiers) {
      for (const mod of params.modifiers) {
        if (mod.when(ctx)) {
          score = mod.apply(score);
          score.reasons.push(mod.reason(ctx));
        }
      }
    }

    if (params.severityByConditions) {
      for (const sev of params.severityByConditions) {
        if (sev.when(ctx)) {
          score.severityHint = sev.severity;
          score.reasons.push(sev.reason(ctx));
          break;
        }
      }
    }

    if (score.baseWeight <= 0) score.eligible = false;
    return score;
  };
}

export const COMMON_ELIGIBILITY = {
  ownedTerritory: (ctx: ConditionContext) => {
    if (!ctx.territoryId) return false;
    const t = ctx.helper.getTerritory(ctx.territoryId);
    return !!t && !!t.owner;
  },
  populationThreshold: (minPop: number) => (ctx: ConditionContext) => {
    if (!ctx.territoryId) return false;
    const t = ctx.helper.getTerritory(ctx.territoryId);
    return !!t && t.population >= minPop;
  },
  noActiveDuplicate: (typeId: string) => (ctx: ConditionContext) => {
    if (!ctx.territoryId) return true;
    return !ctx.helper.hasActiveEventOn(ctx.territoryId, typeId);
  },
  terrainIsOneOf: (terrains: string[]) => (ctx: ConditionContext) => {
    if (!ctx.territoryId) return false;
    const t = ctx.helper.getTerritory(ctx.territoryId);
    return !!t && terrains.includes(t.terrain);
  },
  factionHasStabilityBelow: (threshold: number) => (ctx: ConditionContext) => {
    if (!ctx.factionId) return false;
    const f = ctx.helper.getFaction(ctx.factionId);
    return !!f && f.stability < threshold;
  },
  territoryHasActiveEvent: (typeId: string) => (ctx: ConditionContext) => {
    if (!ctx.territoryId) return false;
    return ctx.helper.hasActiveEventOn(ctx.territoryId, typeId);
  },
};

export function computeFactionStabilityModifier(factionStability: number): { weightMult: number; reason: string } {
  const T = BALANCE.events.thresholds;
  if (factionStability <= T.criticalFactionStability) {
    return { weightMult: 3.0, reason: `Critical faction stability (${factionStability})` };
  }
  if (factionStability <= T.lowFactionStability) {
    return { weightMult: 1.8, reason: `Low faction stability (${factionStability})` };
  }
  if (factionStability >= 85) {
    return { weightMult: 0.4, reason: `High faction stability (${factionStability})` };
  }
  return { weightMult: 1.0, reason: '' };
}

export function candidateTerritoriesForEvents(
  territories: Map<TerritoryId, Territory>,
  activeEvents: ActiveEvent[],
): TerritoryId[] {
  const W = BALANCE.events.world;
  const out: TerritoryId[] = [];
  for (const [id, t] of territories.entries()) {
    if (!t.owner) continue;
    if (t.population < W.territoryChoiceMinPopulation) continue;
    const onTerritory = activeEvents.filter(
      e => e.status === 'active' && e.territoryId === id
    ).length;
    if (onTerritory >= BALANCE.events.world.sameTerritoryMaxConcurrentActive) continue;
    out.push(id);
  }
  return out;
}
