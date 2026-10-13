import type { AIConcretePlan } from './AIConcretePlan';
import type { ActivityTemporalProgress } from '../world/timeToTick';
import type { WorldAccrualState } from '../world/temporalBoundaries';
export const PRESSURE_DOMAINS = ['MILITARY_INITIATIVE','FORCE_POSITIONING','DEVELOPMENT','DIPLOMACY_PEACE','TRADE_ECONOMIC'] as const;
export type PressureDomain = typeof PRESSURE_DOMAINS[number];
export type SourceKind = 'HOSTILE_OPPORTUNITY' | 'EXPOSED_FORCE' | 'COVERAGE_GAP' | 'PRODUCTIVE_DEVELOPMENT' | 'FRONTIER_DEVELOPMENT' | 'WAR_BURDEN' | 'RESOURCE_EXCHANGE';
/** Semantic references, not copies of world entities or a second reasoning authority. */
export interface AISourceContext {
  id: string; factionId: string; domain: PressureDomain; kind: SourceKind;
  subjectId: string; counterpartyId?: string; projectType?: import('./GameState').ConstructionProjectType;
  pressure: number; pressureRemainder: number; observedAtMs: number;
  materialSignature: string; revision: number;
  cognitionOutcome?: 'NO_ACTIONABLE_PLAN' | null;
  blocked: boolean; unavailableReason?: 'LIFECYCLE_UNAVAILABLE' | 'NO_AUTHORIZED_FORCE_OR_ROUTE' | 'ALREADY_ADDRESSED' | null; blockers: SourceBlocker[];
}
/** Each alternative is a complete AND predicate; alternatives form an OR.
 * The exact plan parameters are predicate references, never cached legality. */
export interface SourceBlocker {
  plan: AIConcretePlan;
  reasons: { kind: 'LEGALITY'|'CLAIM'|'COMPATIBILITY'|'ATTENTION'; reason: string }[];
}
export type CognitionOutcome = 'NO_ACTIONABLE_PLAN' | 'CONTEXT_INVALIDATED';
export interface ProactiveTimer {
  progress: ActivityTemporalProgress;
  onlineDurationMs: number; offlineDurationMs: number;
}
export interface PrimaryProactiveThread {
  contextId: string; contextRevision: number; opportunityId: string;
  phase: 'deliberating' | 'waiting' | 'selected';
  timer: ProactiveTimer | null;
}
export interface AIClock {
  nowMs: number;
  /** UTC anchor when receipt-driven Temporal V2 is available. Null in explicit tick fixtures. */
  worldAnchor: WorldAccrualState | null;
}
export interface AIPressureMetrics {
  observerUpdates: number; sourceCreated: number; materialUpdates: number;
  deliberations: number; blocked: number; rearmed: number;
  noActionablePlan: number; contextInvalidated: number; waitSelections: number;
  waitCompletions: number; operationStarts: number; spacingStarts: number;
}
export function emptyPressureMetrics(): AIPressureMetrics {
  return { observerUpdates:0, sourceCreated:0, materialUpdates:0, deliberations:0,
    blocked:0,rearmed:0,noActionablePlan:0,contextInvalidated:0,waitSelections:0,
    waitCompletions:0,operationStarts:0,spacingStarts:0 };
}
