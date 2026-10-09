import { activeOperations } from '../engine/operations';
import type { GameState } from '../types/GameState';
import { WORLD_TICK_DURATION_MS } from './realtimeClock';
import { BALANCE } from '../constants/balance';
import { derivePresenceSegments } from './presenceLeases';
import { projectWorldAccrual, worldTickBoundaryInstant } from './temporalBoundaries';

/** Reuse rated world-boundary algebra. Explicit tick fixtures have no UTC
 * receipt, so their deterministic offline clock is the inverse world rate.
 * Production never accepts client presence or a client timestamp here. */
export function nextAiWorldBoundary(state:GameState):number|null {
  const anchor=state.aiClock.worldAnchor;
  if(anchor && state.lastAccrualAtMs!==null) {
    if(state.worldTick+1<=anchor.accruedTargetWorldTick) return null; // old backlog: physical truth first
    return worldTickBoundaryInstant(anchor,state.worldTick+1,
      derivePresenceSegments(state.gameplaySessionLeases,anchor.lastAccrualAtMs,state.lastAccrualAtMs));
  }
  return state.aiClock.nowMs+WORLD_TICK_DURATION_MS*BALANCE.temporal.ratePpmDenominator/BALANCE.temporal.offlineRatePpm;
}
export function commitAiWorldBoundary(state:GameState,instant:number):void {
  const anchor=state.aiClock.worldAnchor;
  if(anchor && instant>=anchor.lastAccrualAtMs) state.aiClock.worldAnchor=projectWorldAccrual(anchor,
    derivePresenceSegments(state.gameplaySessionLeases,anchor.lastAccrualAtMs,instant));
}
/** Initial clock attachment does not fabricate pre-migration cognition. */
export function anchorAiReceiptClock(state:GameState):void {
  if(state.aiClock.worldAnchor || state.lastAccrualAtMs===null)return;
  const at=state.lastAccrualAtMs;
  // Imported explicit-tick fixtures may already own timers. Translate their
  // watermarks into UTC without earning work, rerolling, or changing identity.
  const offset=at-state.aiClock.nowMs;
  for(const source of state.aiPressure.values())source.observedAtMs+=offset;
  for(const o of state.aiDecisionOpportunities.values()) {
    if(o.lastBoundaryMs!=null)o.lastBoundaryMs+=offset;
    if(o.primary?.timer)o.primary.timer.progress.accruedThroughMs+=offset;
    if(o.spacing)o.spacing.progress.accruedThroughMs+=offset;
  }
  for(const op of activeOperations(state))if(op.initiationTimer)op.initiationTimer.progress.accruedThroughMs+=offset;
  state.aiClock.nowMs=at;
  state.aiClock.worldAnchor={accruedTargetWorldTick:state.accruedTargetWorldTick,subTickMicroticks:state.subTickMicroticks,
    accrualDivisionRemainder:state.accrualDivisionRemainder,lastAccrualAtMs:at};
}
