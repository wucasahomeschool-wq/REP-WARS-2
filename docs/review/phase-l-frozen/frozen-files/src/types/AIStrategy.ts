export interface StrategicAttentionState { capacity: number }
/** Operation-owned accounting; there is no independently mutable occupied total. */
export interface OperationAttention {
  factionId: string;
  cost: number;
  acquiredAtTick: number | null;
  releasedAtTick: number | null;
  /** Historical work is preserved even when it exceeds newly introduced capacity. */
  grandfathered: boolean;
  /** Narrow, operation-owned critical allowance; cost itself is unchanged. */
  emergency?: {contextId:string; revision:number; overflow:number};
}
/** One primary proactive selection/initiation thread, independent of physical work. */
export interface AIDecisionOpportunity {
  lastBoundaryTick: number | null;
  primaryOperationId: string | null;
  /** Optional only for legacy fixture construction; schema-21 hydration supplies these. */
  lastBoundaryMs?: number | null;
  primary?: import('./AIPressure').PrimaryProactiveThread | null;
  spacing?: import('./AIPressure').ProactiveTimer | null;
  nextTimerSequence?: number;
  lastOutcome?: import('./AIPressure').CognitionOutcome | null;
}
