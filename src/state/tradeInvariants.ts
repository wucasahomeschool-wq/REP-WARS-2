import {activeOperations} from '../engine/operations';
import type {GameState} from '../types/GameState';
import {concretePlanProblem} from '../types/AIConcretePlan';
import {bundleEntries,validBundle,tradeResourceClaims,bankSubject,reservedResource} from '../gameplay/trade/resources';
import {TRADE_TIMING,TRADE_RESPONSE_POLICY} from '../constants/trade';
import {durationRemainingMs} from '../world/timeToTick';
import type {ProactiveTimer} from '../types/AIPressure';
export function tradeStateProblems(s:GameState):string[] {
  const problems:string[]=[];
  if(!(s.tradeProposals instanceof Map)||!(s.tradeShipments instanceof Map))return ['Canonical Trade storage missing'];
  for(const op of activeOperations(s))if(op.action==='TRADE'&&op.phase!=='selected'){const p=op.links.tradeProposalId?s.tradeProposals.get(op.links.tradeProposalId):undefined;if(!p||p.operationId!==op.id||!['initiating','pending'].includes(p.status))problems.push(`Orphan live Trade operation ${op.id}`);}
  const validTime=(t:unknown)=>typeof t==='number'&&Number.isSafeInteger(t)&&t>=0&&t<=s.aiClock.nowMs;
  const timer=(t:ProactiveTimer|null)=>{
    if(!t)return false;try {const p=t.progress;
      return Number.isSafeInteger(t.onlineDurationMs)&&t.onlineDurationMs>0&&Number.isSafeInteger(p.offlineDivisor)&&p.offlineDivisor!>0&&t.offlineDurationMs===t.onlineDurationMs*p.offlineDivisor!&&validTime(p.accruedThroughMs)
        &&Number.isSafeInteger(p.rationalRemainder)&&p.rationalRemainder!>=0&&p.rationalRemainder!<p.offlineDivisor!&&Number.isSafeInteger(p.wholeTicks)&&p.wholeTicks>=0&&Number.isSafeInteger(p.subTickMicroticks)&&p.subTickMicroticks>=0&&p.subTickMicroticks<1000000&&Number.isSafeInteger(p.accrualDivisionRemainder)&&p.accrualDivisionRemainder>=0&&p.accrualDivisionRemainder<60000&&['ONLINE','OFFLINE'].includes(p.achievedRate)&&Number.isFinite(durationRemainingMs(p,t.onlineDurationMs,p.achievedRate));
    }catch{return false;}
  };
  for(const [id,p]of s.tradeProposals)try {
    const op=s.operations.get(p.operationId),live=['initiating','pending'].includes(p.status);
    if(id!==p.id||id!==`trade:v1:${JSON.stringify(p.operationId)}`||concretePlanProblem(p.plan)||p.plan.action!=='TRADE'||p.plan.factionId!==p.proposer||p.plan.counterpartyId!==p.recipient||p.proposer===p.recipient||!s.factions.has(p.proposer)||!s.factions.has(p.recipient)||!validBundle(p.plan.offered)||!validBundle(p.plan.requested)||!p.plan.delivery||!p.plan.proposerSource||p.plan.proposerSource.kind!=='faction_stock'||JSON.stringify(bundleEntries(p.plan.proposerSource.resources))!==JSON.stringify(bundleEntries(p.plan.offered))||!op||op.plan?.id!==p.plan.id||op.links.tradeProposalId!==id||!validTime(p.createdAtMs))throw new Error('Identity, exact terms or operation mismatch');
    if(!['initiating','pending','accepted','declined','expired','withdrawn','counteroffered','invalidated'].includes(p.status))throw new Error('Invalid status');
    if(live) {
      if(op.phase!=='physical'||p.resolvedAtMs!==null||p.shipmentIds.length)throw new Error('Live proposal ownership mismatch');
      for(const c of tradeResourceClaims(p.plan,op.id)){const held=s.operationClaims.get(c.id);if(!held||held.id!==c.id||held.operationId!==c.operationId||held.kind!==c.kind||held.subjectId!==c.subjectId||held.scopeFactionId!==c.scopeFactionId||held.resourceType!==c.resourceType||held.quantity!==c.quantity)throw new Error('Exact resource claim mismatch');}
      if(p.status==='initiating') {if(p.pendingAtMs!==null||p.responseTimer||!timer(op.initiationTimer??null)||op.initiationTimer!.onlineDurationMs!==TRADE_TIMING.initiationOnlineMs||op.initiationTimer!.offlineDurationMs!==TRADE_TIMING.initiationOfflineMs)throw new Error('Invalid initiation timer');}
      else {const t=p.responseTimer;if(!validTime(p.pendingAtMs)||p.pendingAtMs!<p.createdAtMs||op.initiationTimer||!timer(t))throw new Error('Invalid response timer');
        if(p.recipient===s.playerFactionId?t!.onlineDurationMs!==TRADE_RESPONSE_POLICY.playerOnlineMs||t!.offlineDurationMs!==TRADE_RESPONSE_POLICY.playerOfflineMs:t!.onlineDurationMs<TRADE_RESPONSE_POLICY.onlineMinMs||t!.onlineDurationMs>TRADE_RESPONSE_POLICY.onlineMaxMs||t!.offlineDurationMs!==t!.onlineDurationMs*TRADE_RESPONSE_POLICY.offlineDivisor)throw new Error('Invalid authored response duration');}
    }else if(op.phase!=='terminal'||p.responseTimer||!validTime(p.resolvedAtMs)||op.claimIds.length||op.attention.releasedAtTick===null)throw new Error('Terminal proposal owns claims/Attention/response');
    if(p.status==='accepted') {if(p.shipmentIds.length!==2||new Set(p.shipmentIds).size!==2)throw new Error('Accepted proposal missing bilateral custody');for(const shId of p.shipmentIds)if(s.tradeShipments.get(shId)?.proposalId!==id)throw new Error('Missing shipment');}
    else if(p.shipmentIds.length)throw new Error('Unaccepted proposal owns cargo');
    if(p.replacesProposalId) {const old=s.tradeProposals.get(p.replacesProposalId);if(!old||old.status!=='counteroffered'||old.proposer!==p.recipient||old.recipient!==p.proposer)throw new Error('Invalid counteroffer ancestry');}
  }catch(e){problems.push(`Trade ${id}: ${(e as Error).message}`);}
  for(const [id,sh]of s.tradeShipments)try {
    const p=s.tradeProposals.get(sh.proposalId),reverse=sh.sender===p?.recipient;
    if(!p||p.status!=='accepted'||!p.shipmentIds.includes(id)||id!==sh.id||id!==`shipment:v1:${JSON.stringify([p.id,reverse?'requested':'offered'])}`||sh.sender!==(reverse?p.recipient:p.proposer)||sh.recipient!==(reverse?p.proposer:p.recipient)||sh.source.kind!=='faction_stock'||sh.source.factionId!==sh.sender||!validBundle(sh.cargo)||JSON.stringify(bundleEntries(sh.cargo))!==JSON.stringify(bundleEntries(reverse?p.plan.requested:p.plan.offered))||!validTime(sh.createdAtMs))throw new Error('Cargo lacks exact accepted manifest');
    const d=p.plan.delivery!;if(sh.originTerritoryId!==(reverse?d.recipientTerritoryId:d.proposerTerritoryId)||sh.destinationTerritoryId!==(reverse?d.proposerTerritoryId:d.recipientTerritoryId)||sh.route[0]!==sh.originTerritoryId||sh.route[sh.route.length-1]!==sh.destinationTerritoryId||new Set(sh.route).size!==sh.route.length||!Number.isSafeInteger(sh.legIndex)||sh.legIndex<0||sh.legIndex>=sh.route.length)throw new Error('Invalid exact route/endpoints');
    if(!['loading','transit','unloading','blocked','delivered'].includes(sh.phase))throw new Error('Invalid cargo phase');
    if(sh.phase==='loading'&&(sh.legIndex!==0||sh.legStartedAtTick!==null||sh.legDurationTicks!==null))throw new Error('Loading cannot follow physical departure');
    if(['unloading','delivered'].includes(sh.phase)&&(sh.legIndex!==sh.route.length-1||sh.legStartedAtTick!==null||sh.legDurationTicks!==null))throw new Error('Unload/delivery requires completed route arrival');
    if(sh.phase==='loading'||sh.phase==='unloading') {
      const online=sh.phase==='loading'?TRADE_TIMING.loadOnlineMs:TRADE_TIMING.unloadOnlineMs,offline=sh.phase==='loading'?TRADE_TIMING.loadOfflineMs:TRADE_TIMING.unloadOfflineMs;
      if(!timer(sh.timer)||sh.timer!.onlineDurationMs!==online||sh.timer!.offlineDurationMs!==offline)throw new Error('Invalid shipment work timer');
    }
    if(sh.phase==='transit'&&(sh.timer||!Number.isSafeInteger(sh.legStartedAtTick)||sh.legStartedAtTick!<0||sh.legStartedAtTick!>s.worldTick||!Number.isSafeInteger(sh.legDurationTicks)||sh.legDurationTicks!<=0||sh.legIndex>=sh.route.length-1))throw new Error('Invalid physical travel');
    if(sh.phase==='delivered'&&(sh.timer||!validTime(sh.deliveredAtMs)||sh.legIndex!==sh.route.length-1))throw new Error('Invalid terminal delivery');
    if(sh.phase!=='delivered'&&sh.deliveredAtMs!==null)throw new Error('Premature delivery marker');
    if(sh.phase==='blocked') {
      if(!sh.blockedReason||!Number.isSafeInteger(sh.blockedAtTick)||sh.blockedAtTick!<0||sh.blockedAtTick!>s.worldTick)throw new Error('Missing preserved-custody halt boundary');
      if(sh.legStartedAtTick!==null) {
        if(sh.timer||!Number.isSafeInteger(sh.legStartedAtTick)||sh.legStartedAtTick<0||sh.legStartedAtTick>sh.blockedAtTick!||!Number.isSafeInteger(sh.legDurationTicks)||sh.legDurationTicks!<=0||sh.legIndex>=sh.route.length-1)throw new Error('Invalid halted transit');
      }else {
        const loading=sh.legIndex===0,unloading=sh.legIndex===sh.route.length-1;
        if(sh.legDurationTicks!==null||(!loading&&!unloading)||!timer(sh.timer)||sh.timer!.onlineDurationMs!==(loading?TRADE_TIMING.loadOnlineMs:TRADE_TIMING.unloadOnlineMs)||sh.timer!.offlineDurationMs!==(loading?TRADE_TIMING.loadOfflineMs:TRADE_TIMING.unloadOfflineMs))throw new Error('Invalid halted load/unload work');
      }
    }else if(sh.blockedReason!==null||sh.blockedAtTick!==null)throw new Error('Unblocked shipment owns a halt marker');
  }catch(e){problems.push(`Shipment ${id}: ${(e as Error).message}`);}
  for(const [fid,f]of s.factions)for(const r of ['gold','food','wood','iron','stone'] as const)if(reservedResource(s,fid,r)>f.resources[r])problems.push(`Over-reserved bank ${fid}:${r}`);
  for(const c of s.operationClaims.values())if(c.kind==='resource') {
    const op=s.operations.get(c.operationId);
    if(!op||op.plan?.action!=='TRADE'||op.phase==='terminal'||c.subjectId!==bankSubject(op.warlordId)||c.scopeFactionId!==op.warlordId||!c.resourceType||!Number.isSafeInteger(c.quantity)||c.quantity!<=0||!tradeResourceClaims(op.plan,op.id).some(x=>x.id===c.id&&x.operationId===c.operationId&&x.kind===c.kind&&x.subjectId===c.subjectId&&x.scopeFactionId===c.scopeFactionId&&x.resourceType===c.resourceType&&x.quantity===c.quantity))problems.push(`Invalid resource quantity claim ${c.id}`);
  }
  return problems;
}
