import type { GameState } from '../types/GameState';
import { cloneOperation, sortedOperations } from '../engine/operations';
/** Schema 20 -> 21: preserve every physical operation, claim and ID high-water
 * mark. Historical unstarted selections (including fake WAIT operations) have
 * no persisted source/timer identity: archive, never fabricate a context or
 * replay feedback. Physical travel/construction/invasion is not cancelled. */
export function migratePressureState(state:GameState):void {
  state.aiPressure=new Map();
  state.aiClock={nowMs:state.lastAccrualAtMs??0,worldAnchor:state.lastAccrualAtMs===null?null:{
    accruedTargetWorldTick:state.accruedTargetWorldTick,subTickMicroticks:state.subTickMicroticks,
    accrualDivisionRemainder:state.accrualDivisionRemainder,lastAccrualAtMs:state.lastAccrualAtMs}};
  for(const op of sortedOperations(state)) {
    if(op.phase==='selected'||(op.action==='WAIT'&&op.phase!=='terminal')) {
      if(op.claimIds.length || op.attention.cost) throw new Error('Legacy unstarted cognition unexpectedly owns physical claims or Attention');
      state.operations.set(op.id,cloneOperation({...op,phase:'terminal',status:'interrupted',legacy:true,
        statusReason:'source/timing identity unavailable at schema-21 migration',
        terminal:{outcome:'interrupted',reason:'unstarted legacy cognition archived without fabricated context',atTick:state.worldTick}}));
    }
  }
  for(const [fid,o] of state.aiDecisionOpportunities) state.aiDecisionOpportunities.set(fid,{
    lastBoundaryTick:o.lastBoundaryTick,primaryOperationId:null,lastBoundaryMs:null,
    primary:null,spacing:null,nextTimerSequence:0,lastOutcome:null});
}
