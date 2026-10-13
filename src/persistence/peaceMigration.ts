import type { GameState } from '../types/GameState';
import { peacePairId, factionPair, hostileLifecyclesBetween } from '../gameplay/diplomacy/relationships';
import { activeOperations } from '../engine/operations';

/** Legacy sentiment remains historical/non-authoritative. Only an explicitly
 * signed, currently unexpired non-aggression treaty proves a Peace exception.
 * No treaty is fabricated from friendly/allied/neutral or positive Opinion. */
export function migratePeaceState(state:GameState):void {
  state.peaceRelationships=new Map();state.peaceProposals=new Map();state.peaceProposalThreads=new Map();
  for(const [fid,f]of [...state.factions].sort(([a],[b])=>a<b?-1:a>b?1:0))for(const [other,r]of [...f.diplomacy].sort(([a],[b])=>a<b?-1:a>b?1:0)) {
    if(fid===other||!state.factions.has(other))continue;
    const treaties=r.treaties.filter(t=>t&&typeof t==='object'&&t.type==='non_aggression'&&t.with===other&&Number.isSafeInteger(t.signedTurn)&&t.signedTurn>=0&&t.signedTurn<=state.turn
      &&(t.expiresTurn===null||Number.isSafeInteger(t.expiresTurn)&&t.expiresTurn>state.turn))
      .sort((a,b)=>(a.expiresTurn??Number.MAX_SAFE_INTEGER)-(b.expiresTurn??Number.MAX_SAFE_INTEGER)||a.signedTurn-b.signedTurn);
    const treaty=treaties[0];if(!treaty)continue;
    const id=peacePairId(fid,other),prior=state.peaceRelationships.get(id);
    if(prior&&(prior.legacyExpiresTurn??Number.MAX_SAFE_INTEGER)<=(treaty.expiresTurn??Number.MAX_SAFE_INTEGER))continue;
    state.peaceRelationships.set(id,{pairId:id,factions:factionPair(fid,other),state:'PEACE',proposalId:null,acceptedAtMs:state.aiClock.nowMs,
      activatedAtMs:state.aiClock.nowMs,expiresAtMs:null,legacyExpiresTurn:treaty.expiresTurn,finalizationTimer:null});
  }
  for(const op of activeOperations(state))if(op.plan?.action==='ATTACK') {
    const invasion=op.links.invasionId?state.activeInvasions.get(op.links.invasionId):undefined;
    const owner=invasion?.defenderFactionId??state.territories.get(op.plan.targetTerritoryId)?.owner;
    if(owner&&owner!==op.warlordId&&!op.hostileCounterpartyId)op.hostileCounterpartyId=owner;
  }
  for(const army of state.armies.values())if(army.attackIntent&&!army.attackIntent.targetFactionId) {
    const invasion=army.attackIntent.holdForInvasionId?state.activeInvasions.get(army.attackIntent.holdForInvasionId):undefined;
    const op=army.attackIntent.commitmentId?state.operations.get(army.attackIntent.commitmentId):undefined;
    const owner=invasion?.defenderFactionId??op?.hostileCounterpartyId??state.territories.get(army.attackIntent.targetTerritoryId)?.owner;
    if(owner&&owner!==army.owner)army.attackIntent.targetFactionId=owner;
  }
  for(const army of state.armies.values())if(army.movement&&!army.movement.hostileCounterpartyId) {
    const op=army.movement.commitmentId?state.operations.get(army.movement.commitmentId):undefined;
    const owner=army.attackIntent?.targetFactionId??op?.hostileCounterpartyId;
    if(owner&&owner!==army.owner)army.movement.hostileCounterpartyId=owner;
  }
  // A real treaty must never delete or cancel historical physical hostilities.
  // Import it as clearance until that existing work reaches its terminal state.
  for(const r of state.peaceRelationships.values())if(hostileLifecyclesBetween(state,...r.factions).length) {
    r.state='PENDING_HOSTILITIES_CLEARANCE';r.activatedAtMs=null;
  }
}
