export interface StrategicAttentionState { capacity: number }
/** Operation-owned accounting; there is no independently mutable occupied total. */
export interface OperationAttention {
  factionId: string;
  cost: number;
  acquiredAtTick: number | null;
  releasedAtTick: number | null;
  /** Historical work is preserved even when it exceeds newly introduced capacity. */
  grandfathered: boolean;
}
/** One primary proactive selection/initiation thread, independent of physical work. */
export interface AIDecisionOpportunity {
  lastBoundaryTick: number | null;
  primaryOperationId: string | null;
}
