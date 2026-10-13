import type { ResourceType } from './index';
import type { ConstructionProjectType } from './GameState';

export const PROACTIVE_AI_ACTIONS = ['ATTACK', 'REINFORCE', 'BUILD', 'MOVE', 'OFFER_PEACE', 'TRADE', 'RETREAT', 'WAIT'] as const;
export type ProactiveAIAction = typeof PROACTIVE_AI_ACTIONS[number];
export type ResourceBundle = Readonly<Partial<Record<ResourceType, number>>>;
/** Current faction stocks are explicitly transitional, not invented local stocks. */
export type PlanResourceSource =
  | { readonly kind: 'faction_stock'; readonly factionId: string; readonly resources: ResourceBundle }
  | { readonly kind: 'local_stockpiles'; readonly holdings: readonly { readonly stockpileId: string; readonly territoryId: string; readonly resources: ResourceBundle; readonly manifestId?: string }[] };
interface PlanBase { readonly id: string; readonly factionId: string }
export interface AttackPlan extends PlanBase {
  readonly action: 'ATTACK'; readonly armyId: string; readonly originTerritoryId: string;
  readonly stagingTerritoryId: string; readonly targetTerritoryId: string;
  /** Engagement edge included; at most one movement hop before engagement. */
  readonly route: readonly string[];
}
export interface MovePlan extends PlanBase {
  readonly action: 'MOVE'; readonly armyId: string; readonly originTerritoryId: string;
  readonly destinationTerritoryId: string; readonly route: readonly string[];
}
export interface RetreatPlan extends PlanBase {
  readonly action: 'RETREAT'; readonly armyId: string; readonly originTerritoryId: string;
  readonly fallbackTerritoryId: string; readonly route: readonly string[];
}
export interface BuildPlan extends PlanBase {
  readonly action: 'BUILD'; readonly projectType: ConstructionProjectType;
  readonly territoryId: string; readonly resourceSource: PlanResourceSource;
  /** Exact next level for the existing one-level fortification upgrade. */
  readonly targetFortificationLevel?: number;
}
export interface ReinforcePlan extends PlanBase {
  readonly action: 'REINFORCE'; readonly territoryId: string; readonly sourcePoolId: string;
  readonly quantity: number;
  readonly destination: { readonly kind: 'garrison'; readonly territoryId: string }
    | { readonly kind: 'army'; readonly armyId: string; readonly territoryId: string }
    | { readonly kind: 'new_army'; readonly territoryId: string };
}
export interface OfferPeacePlan extends PlanBase { readonly action: 'OFFER_PEACE'; readonly counterpartyId: string }
export interface TradePlan extends PlanBase {
  readonly action: 'TRADE'; readonly counterpartyId: string;
  readonly offered: ResourceBundle; readonly requested: ResourceBundle;
  readonly proposerSource?: PlanResourceSource;
  readonly delivery?: {readonly proposerTerritoryId:string;readonly recipientTerritoryId:string};
  readonly sourceContextId?:string;
}
export interface WaitPlan extends PlanBase { readonly action: 'WAIT'; readonly opportunityTurn: number; readonly sourceContextId?: string; readonly opportunityId?: string }
export type AIConcretePlan = AttackPlan | ReinforcePlan | BuildPlan | MovePlan | OfferPeacePlan | TradePlan | RetreatPlan | WaitPlan;
export type PlanDraft = AIConcretePlan extends infer P ? P extends AIConcretePlan ? Omit<P, 'id'> : never : never;

/** UTF-16 code-unit ordering, independent of locale, insertion order and runtime identity. */
export function comparePlanIds(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort(comparePlanIds).filter(k => (value as Record<string, unknown>)[k] !== undefined)
      .map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export function concretePlanId(draft: PlanDraft): string { return `plan:v1:${canonical(draft)}`; }
// Only objects frozen recursively by this module are eligible for shape caching.
// No current-state legality or scoring result is cached.
const frozenPlans = new WeakSet<object>();
const planProblems = new WeakMap<object, string | null>();
function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep); Object.freeze(value);
  }
  return value;
}
export function makeConcretePlan(draft: PlanDraft): AIConcretePlan {
  const copy = JSON.parse(JSON.stringify(draft)) as PlanDraft;
  const plan = freezeDeep({ ...copy, id: concretePlanId(copy) } as AIConcretePlan);
  frozenPlans.add(plan); return plan;
}
export function cloneConcretePlan(plan: AIConcretePlan): AIConcretePlan {
  const copy = freezeDeep(JSON.parse(JSON.stringify(plan)) as AIConcretePlan);
  if (copy && typeof copy === 'object') {
    frozenPlans.add(copy);
    if (planProblems.has(plan)) planProblems.set(copy, planProblems.get(plan)!);
  }
  return copy;
}
export function planTargetId(plan: AIConcretePlan): string | null {
  switch (plan.action) {
    case 'ATTACK': return plan.targetTerritoryId;
    case 'MOVE': return plan.destinationTerritoryId;
    case 'RETREAT': return plan.originTerritoryId; // compatibility display/goal semantics
    case 'BUILD': case 'REINFORCE': return plan.territoryId;
    case 'TRADE': case 'OFFER_PEACE': return plan.counterpartyId;
    case 'WAIT': return null;
  }
}

/** Serialization integrity only; current-state feasibility is checked separately. */
export function concretePlanProblem(value: unknown): string | null {
  if (value && typeof value === 'object' && frozenPlans.has(value)) {
    if (!planProblems.has(value)) planProblems.set(value, inspectConcretePlan(value));
    return planProblems.get(value)!;
  }
  return inspectConcretePlan(value);
}
function inspectConcretePlan(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'plan must be an object';
  const p = value as Record<string, unknown>;
  const text = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
  const bundle = (x: unknown): boolean => !!x && typeof x === 'object' && !Array.isArray(x)
    && Object.entries(x).every(([k, n]) => ['gold', 'food', 'iron', 'wood', 'stone'].includes(k)
      && typeof n === 'number' && Number.isFinite(n) && n > 0);
  const source = (x: unknown): boolean => {
    if (!x || typeof x !== 'object') return false;
    const s = x as Record<string, unknown>;
    if (s.kind === 'faction_stock') return s.factionId === p.factionId && bundle(s.resources);
    if (s.kind !== 'local_stockpiles' || !Array.isArray(s.holdings) || !s.holdings.length) return false;
    return s.holdings.every(h => !!h && text(h.stockpileId) && text(h.territoryId) && bundle(h.resources)
      && (h.manifestId === undefined || text(h.manifestId)));
  };
  if (!text(p.id) || !text(p.factionId) || !PROACTIVE_AI_ACTIONS.includes(p.action as ProactiveAIAction)) return 'invalid plan identity/action/faction';
  const fields: Record<ProactiveAIAction, readonly string[]> = {
    ATTACK: ['armyId', 'originTerritoryId', 'stagingTerritoryId', 'targetTerritoryId', 'route'],
    MOVE: ['armyId', 'originTerritoryId', 'destinationTerritoryId', 'route'],
    RETREAT: ['armyId', 'originTerritoryId', 'fallbackTerritoryId', 'route'],
    BUILD: ['territoryId', 'projectType', 'resourceSource', 'targetFortificationLevel'],
    REINFORCE: ['territoryId', 'sourcePoolId', 'quantity', 'destination'],
    OFFER_PEACE: ['counterpartyId'], TRADE: ['counterpartyId', 'offered', 'requested', 'proposerSource', 'delivery', 'sourceContextId'],
    WAIT: ['opportunityTurn','sourceContextId','opportunityId'],
  };
  if (Object.keys(p).some(k => !['id', 'action', 'factionId', ...fields[p.action as ProactiveAIAction]].includes(k))) return 'unexpected concrete plan parameter';
  switch (p.action) {
    case 'ATTACK': case 'MOVE': case 'RETREAT': {
      if (!text(p.armyId) || !text(p.originTerritoryId) || !Array.isArray(p.route) || !p.route.every(text)) return 'invalid exact force/route';
      if (p.action === 'ATTACK') {
        if (!text(p.targetTerritoryId) || !text(p.stagingTerritoryId) || p.route.length < 2 || p.route.length > 3) return 'invalid attack target/staging';
      } else if (!text(p.action === 'MOVE' ? p.destinationTerritoryId : p.fallbackTerritoryId) || p.route.length !== 2) return 'invalid destination/fallback';
      break;
    }
    case 'BUILD':
      if (!text(p.territoryId) || !['CITY', 'FORTIFICATION', 'FARM', 'MINE', 'LUMBER'].includes(p.projectType as string) || !source(p.resourceSource)) return 'invalid build site/type/source';
      if (p.projectType === 'FORTIFICATION' && (!Number.isSafeInteger(p.targetFortificationLevel) || (p.targetFortificationLevel as number) <= 0)) return 'invalid fortification upgrade level';
      if (p.projectType !== 'FORTIFICATION' && p.targetFortificationLevel !== undefined) return 'unexpected fortification level';
      break;
    case 'REINFORCE': {
      const d = p.destination as Record<string, unknown> | undefined;
      if (!text(p.territoryId) || !text(p.sourcePoolId) || !Number.isSafeInteger(p.quantity) || (p.quantity as number) <= 0
        || !d || !['garrison', 'army', 'new_army'].includes(d.kind as string) || d.territoryId !== p.territoryId
        || (d.kind === 'army' && !text(d.armyId))) return 'invalid local pool/quantity/co-located destination';
      break;
    }
    case 'OFFER_PEACE': case 'TRADE':
      if (!text(p.counterpartyId) || p.counterpartyId === p.factionId) return 'invalid counterparty';
      if (p.action === 'TRADE' && (!bundle(p.offered) || !bundle(p.requested) || !Object.keys(p.offered as object).length
        || !Object.keys(p.requested as object).length || (p.proposerSource !== undefined && !source(p.proposerSource)))) return 'invalid exact trade terms/source';
      if(p.action==='TRADE' && (p.delivery!==undefined && (!text((p.delivery as Record<string,unknown>)?.proposerTerritoryId)||!text((p.delivery as Record<string,unknown>)?.recipientTerritoryId)) || p.sourceContextId!==undefined&&!text(p.sourceContextId)))return 'invalid trade endpoint/source context';
      break;
    case 'WAIT': if ((p.sourceContextId!==undefined&&!text(p.sourceContextId))||(p.opportunityId!==undefined&&!text(p.opportunityId))) return 'invalid WAIT source/opportunity'; if (!Number.isSafeInteger(p.opportunityTurn) || (p.opportunityTurn as number) < 0) return 'invalid WAIT opportunity'; break;
  }
  const { id, ...draft } = p;
  try { if (concretePlanId(draft as PlanDraft) !== id) return 'concrete plan identity mismatch'; }
  catch { return 'invalid serialized plan'; }
  return null;
}
