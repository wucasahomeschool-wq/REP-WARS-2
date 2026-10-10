import {applyOpinionEvent} from '../../cognition/opinion';
import {recordConflictFact} from '../../conflict/ledger';
import {COGNITION_TUNING as COGNITION} from '../../constants/cognition';
import {refreshGoals} from '../../cognition/goals';
import type { GameState } from '../../types/GameState';
import type { OfferPeacePlan } from '../../types/AIConcretePlan';
import { comparePlanIds } from '../../types/AIConcretePlan';
import type { PeaceMetrics, PeaceProposal, PeaceProposalStatus } from '../../types/Peace';
import { activeOperations, settleOperation } from '../../engine/operations';
import { startProactiveTimer, timerRemaining, authoritativePresence } from '../../engine/proactiveCognition';
import { finishDecisionInitiation } from '../../engine/decisionOpportunities';
import { accrueDurationProgress, durationRemainingMs } from '../../world/timeToTick';
import type { TemporalPresence } from '../../world/timeToTick';
import { PEACE_TIMING as TIME, PEACE_TUNING } from '../../constants/peace';
import { assessRequiredPeaceResponse } from '../../scoring/peaceAssessment';
import { peacePairId, factionPair, relationshipBetween, activeDiplomacyFaction, hostileLifecyclesBetween } from './relationships';

export function livePeaceProposals(state:GameState):PeaceProposal[] {
  return [...state.peaceProposalThreads.values()].map(id=>state.peaceProposals.get(id)!).sort((a,b)=>comparePlanIds(a.id,b.id));
}
export function hasRequiredPeaceResponse(state:GameState,recipient:string):boolean {
  return recipient!==state.playerFactionId&&livePeaceProposals(state).some(p=>p.status==='pending'&&p.recipient===recipient);
}
export function offerPeaceProblem(state:GameState,plan:OfferPeacePlan,operationId?:string):string|null {
  if(plan.factionId===plan.counterpartyId||!activeDiplomacyFaction(state,plan.factionId)||!activeDiplomacyFaction(state,plan.counterpartyId))return 'Peace requires two active distinct factions';
  if(relationshipBetween(state,plan.factionId,plan.counterpartyId)!=='WAR')return 'Peace pair is not at WAR';
  const thread=state.peaceProposalThreads.get(peacePairId(plan.factionId,plan.counterpartyId));
  if(thread&&state.peaceProposals.get(thread)?.operationId!==operationId)return 'Peace proposal already active for this unordered pair';
  return null;
}
function record(state:GameState,id:string,transition:string,proposer:string,recipient:string,metrics?:PeaceMetrics):void {
  state.eventHistory.push({id:`peace:${id}:${transition}`,turn:state.turn,typeId:'PEACE_LIFECYCLE',kind:'resolve',factionId:proposer,
    message:`Peace ${transition}`,detail:{proposalId:id,proposer,recipient,transition,atMs:state.aiClock.nowMs}});
  if(metrics)metrics.historyRecords++;
}
export function beginPeaceProposal(state:GameState,plan:OfferPeacePlan,operationId:string):PeaceProposal {
  const problem=offerPeaceProblem(state,plan,operationId);if(problem)throw new Error(problem);
  const id=`peace:v1:${JSON.stringify(operationId)}`,pairId=peacePairId(plan.factionId,plan.counterpartyId);
  if(state.peaceProposals.has(id))throw new Error('Peace proposal identity reused');
  const p:PeaceProposal={id,pairId,proposer:plan.factionId,recipient:plan.counterpartyId,operationId,status:'initiating',
    createdAtMs:state.aiClock.nowMs,pendingAtMs:null,resolvedAtMs:null,responseTimer:null};
  state.peaceProposals.set(id,p);state.peaceProposalThreads.set(pairId,id);
  return p;
}
/** One terminal proposal transition. It delegates operation accounting to the
 * existing central reducer, never refunds Attention or clears force claims. */
export function settlePeaceProposal(state:GameState,id:string,status:Exclude<PeaceProposalStatus,'initiating'|'pending'>,metrics?:PeaceMetrics):boolean {
  const p=state.peaceProposals.get(id);if(!p||!['initiating','pending'].includes(p.status))return false;
  if(status==='accepted'&&p.status!=='pending')return false;
  p.status=status;p.resolvedAtMs=state.aiClock.nowMs;p.responseTimer=null;
  if(state.peaceProposalThreads.get(p.pairId)===id)state.peaceProposalThreads.delete(p.pairId);
  if(status==='accepted') {
    state.peaceRelationships.set(p.pairId,{pairId:p.pairId,factions:factionPair(p.proposer,p.recipient),state:'PENDING_HOSTILITIES_CLEARANCE',
      proposalId:id,acceptedAtMs:state.aiClock.nowMs,finalizationTimer:null,activatedAtMs:null,expiresAtMs:null});
    record(state,id,'clearance_entered',p.proposer,p.recipient,metrics);if(metrics)metrics.relationshipTransitions++;
  }
  if(!settleOperation(state,p.operationId,status==='accepted'?'completed':'failed',`Peace proposal ${status}`))throw new Error('Peace proposal lost owning operation');
  record(state,id,status,p.proposer,p.recipient,metrics);
  if(metrics&&['accepted','declined'].includes(status))metrics.responses++;
  return true;
}
export function accruePeaceTimers(state:GameState,atMs:number,presence:TemporalPresence,metrics?:PeaceMetrics):void {
  for(const p of livePeaceProposals(state))if(p.responseTimer){p.responseTimer.progress=accrueDurationProgress(p.responseTimer.progress,atMs,presence);if(metrics)metrics.timerUpdates++;}
  for(const r of [...state.peaceRelationships.values()].sort((a,b)=>comparePlanIds(a.pairId,b.pairId)))if(r.finalizationTimer){r.finalizationTimer.progress=accrueDurationProgress(r.finalizationTimer.progress,atMs,presence);if(metrics)metrics.timerUpdates++;}
}
export function nextPeaceBoundary(state:GameState,horizon:number,presence:TemporalPresence):number {
  let next=horizon;
  const consider=(t:NonNullable<PeaceProposal['responseTimer']>)=>{next=Math.min(next,state.aiClock.nowMs+Math.max(1,durationRemainingMs(t.progress,t.onlineDurationMs,presence)));};
  for(const p of livePeaceProposals(state))if(p.responseTimer)consider(p.responseTimer);
  for(const r of state.peaceRelationships.values()) {
    if(r.finalizationTimer)consider(r.finalizationTimer);
    if(r.expiresAtMs!==null)next=Math.min(next,Math.max(state.aiClock.nowMs+1,r.expiresAtMs));
  }
  return next;
}
/** Completion/arrival calls this after physical consequences. The required
 * lane then runs before ordinary proactive cognition, independently of Attention
 * and spacing. No pair-wide full-AI polling, no recursive counterparty model. */
export function processPeaceBoundary(state:GameState,metrics?:PeaceMetrics):void {
  for(const p of livePeaceProposals(state)) {
    if(!activeDiplomacyFaction(state,p.proposer)||!activeDiplomacyFaction(state,p.recipient)||relationshipBetween(state,p.proposer,p.recipient)!=='WAR') {
      settlePeaceProposal(state,p.id,'invalidated',metrics);continue;
    }
    if(p.status==='initiating') {
      const op=state.operations.get(p.operationId)!;
      if(!op.initiationTimer||timerRemaining(state,op.initiationTimer)>0)continue;
      p.status='pending';p.pendingAtMs=state.aiClock.nowMs;
      const player=p.recipient===state.playerFactionId;
      p.responseTimer=startProactiveTimer(state,p.recipient,`peace-response:${p.id}`,player?TIME.playerResponseOnlineMs:TIME.responseOnlineMinMs,
        player?TIME.playerResponseOnlineMs:TIME.responseOnlineMaxMs,player?TIME.playerResponseOfflineMs/TIME.playerResponseOnlineMs:TIME.responseOfflineDivisor);
      delete op.initiationTimer;
      finishDecisionInitiation(state,op.id,true);
      record(state,p.id,'offered',p.proposer,p.recipient,metrics);
    }
  }
  // Deadline urgency, then creation boundary, then stable semantic identity.
  const pending=livePeaceProposals(state).filter(p=>p.status==='pending').sort((a,b)=>
    timerRemaining(state,a.responseTimer!)-timerRemaining(state,b.responseTimer!)||a.pendingAtMs!-b.pendingAtMs!||comparePlanIds(a.id,b.id));
  for(const p of pending)if(timerRemaining(state,p.responseTimer!)===0) {
    if(p.recipient===state.playerFactionId)settlePeaceProposal(state,p.id,'expired',metrics);
    else {
      const o=state.aiDecisionOpportunities.get(p.recipient);
      if(o?.primary?.phase==='deliberating'){o.primary=null;o.lastBoundaryMs=state.aiClock.nowMs;}
      if(metrics)metrics.requiredDeliberations++;
      const response=assessRequiredPeaceResponse(state,p.recipient,p.proposer);
      settlePeaceProposal(state,p.id,response.outcome==='ACCEPT_PEACE'?'accepted':'declined',metrics);
    }
  }
  for(const [id,r]of [...state.peaceRelationships].sort(([a],[b])=>comparePlanIds(a,b))) {
    if(r.state==='PEACE'||r.factions.some(f=>!activeDiplomacyFaction(state,f))||(r.legacyExpiresTurn!=null&&state.turn>=r.legacyExpiresTurn)) {
      if((r.expiresAtMs!==null&&state.aiClock.nowMs>=r.expiresAtMs)||(r.legacyExpiresTurn!=null&&state.turn>=r.legacyExpiresTurn)
        ||r.factions.some(f=>!activeDiplomacyFaction(state,f))) {
        if(r.state==='PEACE'&&r.factions.every(f=>activeDiplomacyFaction(state,f)))recordConflictFact(state,`peace-expiry:${r.proposalId??id}:${r.expiresAtMs??r.legacyExpiresTurn}`,
          {kind:'WAR_RETURN',actor:r.factions[0],target:r.factions[1]});
        state.peaceRelationships.delete(id);record(state,r.proposalId??id,'ended',...r.factions,metrics);if(metrics)metrics.relationshipTransitions++;
      }
      continue;
    }
    if(metrics)metrics.clearanceChecks++;
    if(hostileLifecyclesBetween(state,...r.factions).length)continue;
    if(!r.finalizationTimer)r.finalizationTimer=startProactiveTimer(state,r.factions[0],`peace-finalization:${id}`,TIME.finalizationOnlineMs,TIME.finalizationOnlineMs,TIME.finalizationOfflineMs/TIME.finalizationOnlineMs);
    if(timerRemaining(state,r.finalizationTimer)>0)continue;
    r.finalizationTimer=null;r.state='PEACE';r.activatedAtMs=state.aiClock.nowMs;r.expiresAtMs=r.legacyExpiresTurn!==undefined?null:state.aiClock.nowMs+PEACE_TUNING.treatyDurationMs;
    recordConflictFact(state,`peace:${r.proposalId??id}:${r.activatedAtMs}`,{kind:'PEACE_ACTIVATED',actor:r.factions[0],target:r.factions[1]});
    for(const observer of r.factions)applyOpinionEvent(state,`peace:${r.proposalId??id}:${r.activatedAtMs}`,observer,r.factions.find(f=>f!==observer)!,'treaty_signed',COGNITION.eventDelta.treaty_signed);
    refreshGoals(state);
    record(state,r.proposalId??id,'activated',...r.factions,metrics);if(metrics)metrics.relationshipTransitions++;
  }
}
export function publicPeaceState(state:GameState,viewer:string|null) {
  return {defaultRelationship:'WAR' as const,proposals:[...state.peaceProposals.values()].filter(p=>p.pendingAtMs!==null&&(p.proposer===viewer||p.recipient===viewer))
    .sort((a,b)=>comparePlanIds(a.id,b.id)).map(p=>({id:p.id,proposer:p.proposer,recipient:p.recipient,status:p.status,
      remainingResponseMs:p.status==='pending'&&p.recipient===state.playerFactionId?timerRemaining(state,p.responseTimer!):null})),
    relationships:[...state.peaceRelationships.values()].sort((a,b)=>comparePlanIds(a.pairId,b.pairId)).map(r=>({factions:[...r.factions],state:r.state,expiresAtMs:r.expiresAtMs}))};
}
