import { activeOperations } from '../engine/operations';
import type { GameState } from '../types/GameState';
import type { ProactiveTimer } from '../types/AIPressure';
import { peacePairId, factionPair } from '../gameplay/diplomacy/relationships';
import { PEACE_TIMING as T } from '../constants/peace';
import { durationRemainingMs } from '../world/timeToTick';

/** Linkage/timing integrity only; never a parallel diplomacy authority. */
export function peaceStateProblems(state:GameState):string[] {
  const errors:string[]=[];
  if(!(state.peaceProposals instanceof Map)||!(state.peaceProposalThreads instanceof Map)||!(state.peaceRelationships instanceof Map))return ['Canonical Peace storage missing'];
  const int=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
  const time=(n:unknown)=>int(n)&&(n as number)<=state.aiClock.nowMs;
  function timer(t:ProactiveTimer|null):boolean {
    try {
      if(!t)return false;const p=t.progress;
      if(!int(t.onlineDurationMs)||t.onlineDurationMs<=0||!int(p.offlineDivisor)||p.offlineDivisor!<1
        ||t.offlineDurationMs!==t.onlineDurationMs*p.offlineDivisor!
        ||!time(p.accruedThroughMs)||!int(p.rationalRemainder)||p.rationalRemainder!>=p.offlineDivisor!
        ||!int(p.wholeTicks)||!int(p.subTickMicroticks)||p.subTickMicroticks>=1_000_000
        ||!int(p.accrualDivisionRemainder)||p.accrualDivisionRemainder>=60_000
        ||!['ONLINE','OFFLINE'].includes(p.achievedRate))return false;
      durationRemainingMs(p,t.onlineDurationMs,p.achievedRate);return true;
    }catch{return false;}
  }
  for(const op of activeOperations(state))if(op.action==='OFFER_PEACE'&&op.phase!=='selected') {
    const p=op.links.peaceProposalId?state.peaceProposals.get(op.links.peaceProposalId):undefined;
    if(!p||p.operationId!==op.id||!['initiating','pending'].includes(p.status))errors.push(`Orphan live Peace operation ${op.id}`);
  }
  for(const [id,p]of state.peaceProposals)try {
    const op=state.operations.get(p.operationId);
    if(id!==p.id||id!==`peace:v1:${JSON.stringify(p.operationId)}`||p.pairId!==peacePairId(p.proposer,p.recipient)
      ||p.proposer===p.recipient||!state.factions.has(p.proposer)||!state.factions.has(p.recipient)
      ||!op||op.plan?.action!=='OFFER_PEACE'||op.warlordId!==p.proposer||op.plan.counterpartyId!==p.recipient||op.links.peaceProposalId!==id
      ||!time(p.createdAtMs))throw new Error('Identity, owning operation or participants disagree');
    const live=p.status==='initiating'||p.status==='pending';
    if(live) {
      if(op.phase!=='physical'||state.peaceProposalThreads.get(p.pairId)!==id||state.peaceRelationships.has(p.pairId)||p.resolvedAtMs!==null||op.claimIds.length)throw new Error('Live proposal linkage disagrees');
      if(p.status==='initiating') {
        if(p.pendingAtMs!==null||p.responseTimer!==null||!timer(op.initiationTimer??null)
          ||op.initiationTimer!.onlineDurationMs!==T.initiationOnlineMs||op.initiationTimer!.offlineDurationMs!==T.initiationOfflineMs)throw new Error('Invalid initiation');
      }else {
        if(!time(p.pendingAtMs)||p.pendingAtMs!<p.createdAtMs||op.initiationTimer||!timer(p.responseTimer))throw new Error('Invalid pending response');
        const t=p.responseTimer!,player=p.recipient===state.playerFactionId;
        if(player?t.onlineDurationMs!==T.playerResponseOnlineMs||t.offlineDurationMs!==T.playerResponseOfflineMs:
          t.onlineDurationMs<T.responseOnlineMinMs||t.onlineDurationMs>T.responseOnlineMaxMs||t.onlineDurationMs%1000!==0||t.offlineDurationMs!==t.onlineDurationMs*T.responseOfflineDivisor)throw new Error('Response timing range disagrees');
      }
    }else if(!['accepted','declined','expired','withdrawn','invalidated'].includes(p.status)||op.phase!=='terminal'
      ||!time(p.resolvedAtMs)||p.resolvedAtMs!<p.createdAtMs||p.responseTimer!==null
      ||(p.status==='accepted'&&op.status!=='completed')||(p.status!=='accepted'&&op.status==='completed'))throw new Error('Terminal proposal disagrees');
  }catch(e){errors.push(`Proposal ${id}: ${e instanceof Error?e.message:'invalid record'}`);}
  for(const [pair,id]of state.peaceProposalThreads) {
    const p=state.peaceProposals.get(id);
    if(!p||p.pairId!==pair||!['initiating','pending'].includes(p.status))errors.push(`Orphan live pair ${pair}`);
  }
  for(const [id,r]of state.peaceRelationships)try {
    if(id!==r.pairId||id!==peacePairId(...r.factions)||JSON.stringify(r.factions)!==JSON.stringify(factionPair(...r.factions))
      ||r.factions[0]===r.factions[1]||r.factions.some(f=>!state.factions.has(f))||!time(r.acceptedAtMs)
      ||!['PEACE','PENDING_HOSTILITIES_CLEARANCE'].includes(r.state)||state.peaceProposalThreads.has(id))throw new Error('Invalid relationship identity/state');
    if(r.proposalId!==null) {
      const p=state.peaceProposals.get(r.proposalId);
      if(!p||p.status!=='accepted'||p.pairId!==id)throw new Error('Acceptance linkage missing');
    }else if(r.legacyExpiresTurn===undefined)throw new Error('Non-WAR exception has no explicit treaty/acceptance');
    if(r.legacyExpiresTurn!==undefined&&r.legacyExpiresTurn!==null&&!int(r.legacyExpiresTurn))throw new Error('Invalid historical treaty expiry');
    if(r.state==='PEACE') {
      if(!time(r.activatedAtMs)||r.finalizationTimer!==null||(r.expiresAtMs!==null&&(!int(r.expiresAtMs)||r.expiresAtMs<=r.activatedAtMs!)))throw new Error('Invalid active treaty timing');
    }else if(r.activatedAtMs!==null||r.expiresAtMs!==null||(r.finalizationTimer!==null&&(!timer(r.finalizationTimer)
      ||r.finalizationTimer.onlineDurationMs!==T.finalizationOnlineMs||r.finalizationTimer.offlineDurationMs!==T.finalizationOfflineMs)))throw new Error('Invalid clearance timing');
  }catch(e){errors.push(`Relationship ${id}: ${e instanceof Error?e.message:'invalid record'}`);}
  return errors;
}
