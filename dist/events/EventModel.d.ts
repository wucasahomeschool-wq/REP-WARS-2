import { FactionId, TerritoryId, Resources, Territory, WarlordSnapshot } from '../types';
import { SeededRNG } from '../utils/SeededRNG';
export type EventSeverity = 'minor' | 'moderate' | 'severe' | 'critical';
export declare const SEVERITY_ORDER: Record<EventSeverity, number>;
export type EventCategory = 'environmental' | 'economic' | 'political' | 'military' | 'diplomatic';
export type EventStatus = 'pending' | 'active' | 'resolved' | 'expired';
export type EffectTarget = 'territory' | 'faction' | 'global';
export type HistoryKind = 'trigger' | 'choice' | 'perTurn' | 'expire' | 'resolve' | 'chain';
export interface ConditionContext {
    turn: number;
    territoryId: TerritoryId | null;
    factionId: FactionId | null;
    world: {
        territories: Map<TerritoryId, Territory>;
        factions: Map<FactionId, WarlordSnapshot>;
        activeEvents: ActiveEvent[];
    };
    helper: WorldHelper;
    rng: SeededRNG;
}
export interface WorldHelper {
    getTerritory: (id: TerritoryId) => Territory | undefined;
    getFaction: (id: FactionId) => WarlordSnapshot | undefined;
    hasActiveEventOn: (territoryId: TerritoryId, eventTypeId: string) => boolean;
    getActiveEventsOn: (territoryId: TerritoryId) => ActiveEvent[];
    getActiveEventsByFaction: (factionId: FactionId) => ActiveEvent[];
    hasActiveEventTypeId: (typeId: string, scope?: {
        territoryId?: TerritoryId;
        factionId?: FactionId;
    }) => boolean;
    countTerrainNeighbors: (territoryId: TerritoryId, terrain: string) => number;
    countHostileBorderNeighbors: (territoryId: TerritoryId) => number;
    countControlledTerritories: (factionId: FactionId) => number;
    getTerritoryFoodProduction: (t: Territory) => number;
    getFactionTotalPopulation: (fid: FactionId) => number;
    getFactionResourceRatio: (fid: FactionId, resource: keyof Resources) => number;
    getTerritoryThemeTag: (territoryId: TerritoryId) => string | null;
}
export type TriggerScore = {
    eligible: boolean;
    baseWeight: number;
    reasons: string[];
    severityHint?: EventSeverity;
};
export interface ImperialChoice {
    id: string;
    label: string;
    description: string;
    cost?: Partial<Resources>;
}
export interface ConsequenceDelta {
    territoryId?: TerritoryId | null;
    factionId?: FactionId | null;
    delta: {
        stabilityDelta?: number;
        populationDeltaPct?: number;
        populationDeltaAbs?: number;
        resources?: Partial<Resources>;
        resourceOutputPct?: Partial<Record<keyof Resources, number>>;
        foodProductionPct?: number;
        moraleDeltaArmy?: number;
        moraleDeltaGarrison?: number;
        garrisonDeltaAbs?: number;
        infrastructureDeltaPct?: number;
        relationshipDeltaOpinion?: {
            target: FactionId;
            delta: number;
        };
    };
    message: string;
}
export interface ChainDefinition {
    toEventId: string;
    baseProb: number;
    delayMinTurns: number;
    requireSeverityAtLeast?: EventSeverity;
}
export interface EventDefinition {
    id: string;
    typeId: string;
    category: EventCategory;
    categoryLabel: string;
    titleTemplate: (sev: EventSeverity, loc?: TerritoryId | null, world?: {
        territories: Map<TerritoryId, Territory>;
    }) => string;
    descriptionTemplate: (sev: EventSeverity, ctx: ConditionContext) => string;
    causes: string[];
    target: EffectTarget;
    defaultDuration: {
        min: number;
        max: number;
    };
    severityTable: {
        weight: number;
        severity: EventSeverity;
    }[];
    canChainFrom?: ChainDefinition[];
    choices?: (ctx: ConditionContext, sev: EventSeverity) => ImperialChoice[];
    resolveChoice?: (choiceId: string, ctx: ConditionContext, sev: EventSeverity, active: ActiveEvent) => {
        choiceTakenMessage: string;
        consequences: ConsequenceDelta[];
        suppressChains?: boolean;
        shortenDurationBy?: number;
    };
    onTrigger: (ctx: ConditionContext, sev: EventSeverity) => {
        reasons: string[];
        consequences: ConsequenceDelta[];
    };
    perTurn?: (ctx: ConditionContext, sev: EventSeverity, active: ActiveEvent) => ConsequenceDelta[];
    isInstant?: boolean;
}
export interface ActiveEvent {
    instanceId: string;
    typeId: string;
    category: EventCategory;
    title: string;
    description: string;
    causes: string[];
    severity: EventSeverity;
    status: EventStatus;
    territoryId: TerritoryId | null;
    factionId: FactionId | null;
    triggeredTurn: number;
    durationTurns: number;
    startedTurn: number;
    expiresTurn: number;
    consequences: ConsequenceDelta[];
    chainSuppressed?: boolean;
    chainDelays: {
        toEventId: string;
        delayRemaining: number;
        probability: number;
        severity: EventSeverity;
    }[];
    choicesPending: ImperialChoice[];
    choiceTaken?: {
        id: string;
        turn: number;
        message: string;
        consequences: ConsequenceDelta[];
    };
}
export interface TriggeredEvent {
    definition: EventDefinition;
    severity: EventSeverity;
    territoryId: TerritoryId | null;
    factionId: FactionId | null;
    reasons: string[];
    immediateConsequences: ConsequenceDelta[];
    choices: ImperialChoice[];
    durationTurns: number;
}
export interface HistoryEntry {
    id: string;
    turn: number;
    typeId: string;
    kind: HistoryKind;
    severity?: EventSeverity;
    territoryId?: TerritoryId | null;
    factionId?: FactionId | null;
    title?: string;
    message: string;
    detail?: Record<string, unknown>;
}
export interface WorldStepInput {
    turn: number;
    territories: Map<TerritoryId, Territory>;
    factions: Map<FactionId, WarlordSnapshot>;
    activeEvents: ActiveEvent[];
    eventHistory: HistoryEntry[];
    playerFactionId?: FactionId | null;
    seed: number;
}
export interface WorldStepOutput {
    newActiveEvents: ActiveEvent[];
    newEventHistory: HistoryEntry[];
    triggeredEvents: TriggeredEvent[];
    perTurnConsequences: ConsequenceDelta[];
    expiredEvents: ActiveEvent[];
    unresolvedDecisions: {
        active: ActiveEvent;
        choices: ImperialChoice[];
        territoryId: TerritoryId | null;
        factionId: FactionId | null;
    }[];
    summary: string[];
    mutatedTerritories: Map<TerritoryId, Territory>;
    mutatedFactions: Map<FactionId, WarlordSnapshot>;
}
export type EventConditionFn = (ctx: ConditionContext) => TriggerScore;
export declare function buildDefaultSeverityTable(rng?: SeededRNG): {
    weight: number;
    severity: EventSeverity;
}[];
export declare function pickSeverityFromTable(table: {
    weight: number;
    severity: EventSeverity;
}[], rng: SeededRNG, hint?: EventSeverity): EventSeverity;
export declare function severityScale(sev: EventSeverity): number;
export declare function severityAtLeast(sev: EventSeverity, threshold: EventSeverity): boolean;
