import {applyOpinionEvent} from '../../cognition/opinion';
import {COGNITION_TUNING as COGNITION} from '../../constants/cognition';
import {refreshGoals} from '../../cognition/goals';
import type {GameState} from '../../types/GameState';
import type {TradePlan, ResourceBundle} from '../../types/AIConcretePlan';
import {concretePlanProblem,comparePlanIds} from '../../types/AIConcretePlan';
import type {TradeMetrics,TradeProposal,TradeProposalStatus,TradeShipment} from '../../types/Trade';
import {TRADE_TIMING as TIME,TRADE_RESPONSE_POLICY as RESPONSE} from '../../constants/trade';
import {activeDiplomacyFaction} from '../diplomacy/relationships';
import {bundleEntries,availableResource,validBundle,tradeResourceClaims} from './resources';
import {tradeEndpointProblem,tradeAcceptanceRoutes,tradeShipmentNodeProblem} from './policy';
import {liveTradeRecords} from './records';
import {settleOperation} from '../../engine/operations';
import {startProactiveTimer,timerRemaining} from '../../engine/proactiveCognition';
import {finishDecisionInitiation} from '../../engine/decisionOpportunities';
import {accrueDurationProgress,durationRemainingMs,TemporalPresence} from '../../world/timeToTick';
import {calculateMovementDuration} from '../../army/movement';
import {assessRequiredTradeResponse} from '../../scoring/tradeAssessment';
export const proposalLive=(p:TradeProposal)=>p.status==='initiating'||p.status==='pending';
export const shipmentLive=(s:TradeShipment)=>s.phase!=='delivered';
export const liveTradeProposals=(s:GameState)=>liveTradeRecords(s.tradeProposals,proposalLive);
export const liveTradeShipments=(s:GameState)=>liveTradeRecords(s.tradeShipments,shipmentLive);
export function hasRequiredTradeResponse(s:GameState,fid:string):boolean {return fid!==s.playerFactionId&&liveTradeProposals(s).some(p=>p.status==='pending'&&p.recipient===fid);}
function record(s:GameState,id:string,event:string,proposer:string,recipient:string,m?:TradeMetrics):void {
  s.eventHistory.push({id:`trade:${id}:${event}`,turn:s.turn,typeId:'TRADE_LIFECYCLE',kind:'resolve',factionId:proposer,message:`Trade ${event}`,detail:{id,proposer,recipient,transition:event,atMs:s.aiClock.nowMs}});if(m)m.historyRecords++;
}
export function tradePlanProblem(s:GameState,p:TradePlan,operationId?:string,ignoreClaims=false):string|null {
  const shape=concretePlanProblem(p);if(shape)return shape;
  if(!activeDiplomacyFaction(s,p.factionId)||!activeDiplomacyFaction(s,p.counterpartyId))return 'Trade requires two active distinct factions';
  if(!validBundle(p.offered)||!validBundle(p.requested))return 'Trade requires exact positive integer resource quantities';
  if(!p.proposerSource||p.proposerSource.kind!=='faction_stock'||p.proposerSource.factionId!==p.factionId
    ||JSON.stringify(bundleEntries(p.proposerSource.resources))!==JSON.stringify(bundleEntries(p.offered)))return 'Exact supported proposer bank source must match offered manifest';
  const endpointProblem=tradeEndpointProblem(s,p);if(endpointProblem)return endpointProblem;
  for(const [r,n]of bundleEntries(p.offered))if(!Number.isSafeInteger(s.factions.get(p.factionId)!.resources[r])||(ignoreClaims?s.factions.get(p.factionId)!.resources[r]:availableResource(s,p.factionId,r,operationId))<n)return 'Exact offered resources unavailable';
  return null; // Recipient sufficiency and route are deliberately ACCEPT prerequisites.
}
export function beginTradeProposal(s:GameState,plan:TradePlan,operationId:string):TradeProposal {
  const problem=tradePlanProblem(s,plan,operationId);if(problem)throw new Error(problem);
  const id=`trade:v1:${JSON.stringify(operationId)}`;if(s.tradeProposals.has(id))throw new Error('Trade identity reused');
  const p:TradeProposal={id,operationId,proposer:plan.factionId,recipient:plan.counterpartyId,plan,status:'initiating',createdAtMs:s.aiClock.nowMs,pendingAtMs:null,resolvedAtMs:null,responseTimer:null,shipmentIds:[]};
  s.tradeProposals.set(id,p);return p;
}
/** Exact recipient manifest selection: current production has one canonical
 * bank per faction. No alternate unauthorized local store or strategic RNG. */
export function recipientManifest(s:GameState,p:TradeProposal):{kind:'faction_stock';factionId:string;resources:ResourceBundle}|null {
  if(bundleEntries(p.plan.requested).some(([r,n])=>availableResource(s,p.recipient,r)<n))return null;
  return {kind:'faction_stock',factionId:p.recipient,resources:{...p.plan.requested}};
}
export function acceptanceProblem(s:GameState,p:TradeProposal):string|null {
  if(p.status!=='pending')return 'Trade is not awaiting response';
  const problem=tradePlanProblem(s,p.plan,p.operationId);if(problem)return problem;
  if(tradeResourceClaims(p.plan,p.operationId).some(c=>{const held=s.operationClaims.get(c.id);return !held||held.id!==c.id||held.operationId!==c.operationId||held.kind!==c.kind||held.subjectId!==c.subjectId||held.scopeFactionId!==c.scopeFactionId||held.quantity!==c.quantity||held.resourceType!==c.resourceType;}))return 'Exact proposer resource reservation lost';
  if(!recipientManifest(s,p))return 'Recipient cannot fulfill exact requested terms';
  if(!tradeAcceptanceRoutes(s,p.plan))return 'No bilateral delivery route at ACCEPT (provisional policy)';
  return null;
}
function shipment(s:GameState,p:TradeProposal,reverse:boolean,route:string[]):TradeShipment {
  const d=p.plan.delivery!,sender=reverse?p.recipient:p.proposer,recipient=reverse?p.proposer:p.recipient;
  const origin=reverse?d.recipientTerritoryId:d.proposerTerritoryId,destination=reverse?d.proposerTerritoryId:d.recipientTerritoryId;
  return {id:`shipment:v1:${JSON.stringify([p.id,reverse?'requested':'offered'])}`,proposalId:p.id,sender,recipient,cargo:{...(reverse?p.plan.requested:p.plan.offered)},source:{kind:'faction_stock',factionId:sender},originTerritoryId:origin,destinationTerritoryId:destination,
    route:[...route],legIndex:0,phase:'loading',timer:startProactiveTimer(s,sender,`trade-load:${p.id}:${reverse}`,TIME.loadOnlineMs,TIME.loadOnlineMs,TIME.loadOfflineMs/TIME.loadOnlineMs),legStartedAtTick:null,legDurationTicks:null,blockedReason:null,blockedAtTick:null,createdAtMs:s.aiClock.nowMs,deliveredAtMs:null};
}
/** All ACCEPT prerequisites checked before any mutation. Called only on the
 * Orchestrator draft (commands additionally use a nested transaction). Both cargo
 * manifests enter custody together; terminal operation reducer releases claims
 * and Attention. No recipient-side reservation ever exists while pending. */
export function settleTradeProposal(s:GameState,id:string,status:Exclude<TradeProposalStatus,'initiating'|'pending'>,m?:TradeMetrics):boolean {
  const p=s.tradeProposals.get(id);if(!p||!proposalLive(p))return false;
  if(status==='accepted') {
    const problem=acceptanceProblem(s,p);if(problem)throw new Error(problem);
    const routes=tradeAcceptanceRoutes(s,p.plan)!;
    const outgoing=shipment(s,p,false,routes.offered),incoming=shipment(s,p,true,routes.requested);
    for(const sh of [outgoing,incoming])for(const [r,n]of bundleEntries(sh.cargo))s.factions.get(sh.sender)!.resources[r]-=n;
    s.tradeShipments.set(outgoing.id,outgoing);s.tradeShipments.set(incoming.id,incoming);p.shipmentIds=[outgoing.id,incoming.id];
    if(m){m.shipments+=2;m.accepts++;}
    record(s,outgoing.id,'shipment_created',p.proposer,p.recipient,m);record(s,incoming.id,'shipment_created',p.proposer,p.recipient,m);
  }
  p.status=status;p.resolvedAtMs=s.aiClock.nowMs;p.responseTimer=null;
  const released=tradeResourceClaims(p.plan,p.operationId).length;
  if(!settleOperation(s,p.operationId,status==='accepted'?'completed':'failed',`Trade proposal ${status}`))throw new Error('Trade proposal lost owning operation');
  s.tradeProposals.set(id,p);if(m){m.reservationsReleased+=released;if(status==='declined')m.declines++;if(status==='counteroffered')m.counteroffers++;}
  record(s,id,status,p.proposer,p.recipient,m);return true;
}
export function accrueTradeTimers(s:GameState,at:number,presence:TemporalPresence,m?:TradeMetrics):void {
  for(const item of [...liveTradeProposals(s),...liveTradeShipments(s)]) {
    if('phase'in item&&item.phase==='blocked')continue;
    const timer='responseTimer'in item?item.responseTimer:item.timer;
    if(timer){timer.progress=accrueDurationProgress(timer.progress,at,presence);if(m)m.timerUpdates++;}
  }
}
export function nextTradeBoundary(s:GameState,horizon:number,presence:TemporalPresence):number {
  let next=horizon;for(const item of [...liveTradeProposals(s),...liveTradeShipments(s)]){if('phase'in item&&item.phase==='blocked')continue;const timer='responseTimer'in item?item.responseTimer:item.timer;
    if(timer)next=Math.min(next,s.aiClock.nowMs+Math.max(1,durationRemainingMs(timer.progress,timer.onlineDurationMs,presence)));}
  return next;
}
function block(s:GameState,sh:TradeShipment,reason:string):void {sh.phase='blocked';sh.blockedReason=reason;sh.blockedAtTick=s.worldTick;/* Retain cargo, elapsed leg and exact route. No recovery doctrine invented. */}
function beginLeg(s:GameState,sh:TradeShipment):void {
  const from=s.territories.get(sh.route[sh.legIndex]!),to=s.territories.get(sh.route[sh.legIndex+1]!);
  if(!from||!to||!from.neighboring.includes(to.id)){block(s,sh,'Route unavailable; physical custody preserved');return;}
  sh.phase='transit';sh.timer=null;sh.legStartedAtTick=s.worldTick;sh.legDurationTicks=calculateMovementDuration({origin:from,destination:to});
}
export function progressTradeShipments(s:GameState,m?:TradeMetrics):void {
  for(const sh of liveTradeShipments(s)) {
    if(sh.phase==='blocked')continue;
    const nodeProblem=tradeShipmentNodeProblem(s,sh);if(nodeProblem){block(s,sh,nodeProblem);continue;}
    if(sh.phase==='loading') {
      if(timerRemaining(s,sh.timer!)>0)continue;beginLeg(s,sh);
    } else if(sh.phase==='transit') {
      const from=s.territories.get(sh.route[sh.legIndex]!),to=s.territories.get(sh.route[sh.legIndex+1]!);
      if(!from||!to||!from.neighboring.includes(to.id)){block(s,sh,'Route interrupted; elapsed travel preserved');continue;}
      if(s.worldTick<sh.legStartedAtTick!+sh.legDurationTicks!)continue;
      sh.legIndex++;sh.legStartedAtTick=null;sh.legDurationTicks=null;
      if(sh.legIndex<sh.route.length-1){beginLeg(s,sh);continue;}
      sh.phase='unloading';sh.timer=startProactiveTimer(s,sh.recipient,`trade-unload:${sh.id}`,TIME.unloadOnlineMs,TIME.unloadOnlineMs,TIME.unloadOfflineMs/TIME.unloadOnlineMs);
    } else if(sh.phase==='unloading') {
      if(timerRemaining(s,sh.timer!)>0)continue;
      if(bundleEntries(sh.cargo).some(([r,n])=>!Number.isSafeInteger(s.factions.get(sh.recipient)!.resources[r]+n))){block(s,sh,'Receiving bank cannot represent exact quantity; cargo preserved');continue;}
      for(const [r,n]of bundleEntries(sh.cargo))s.factions.get(sh.recipient)!.resources[r]+=n;
      sh.phase='delivered';sh.deliveredAtMs=s.aiClock.nowMs;sh.timer=null;s.tradeShipments.set(sh.id,sh);
      applyOpinionEvent(s,sh.id,sh.recipient,sh.sender,'trade_completed',COGNITION.eventDelta.trade_completed);
      refreshGoals(s,sh.recipient);
      record(s,sh.id,'delivered',sh.sender,sh.recipient,m);if(m)m.deliveries++;
    }
  }
}
/** Domain delivery occurs before required responses, which precede proactive
 * cognition. Only live indexes are examined; no full history scan/pair polling. */
export function processTradeBoundary(s:GameState,m?:TradeMetrics):void {
  progressTradeShipments(s,m);
  for(const p of liveTradeProposals(s)) {
    const problem=tradePlanProblem(s,p.plan,p.operationId);
    if(problem){settleTradeProposal(s,p.id,'invalidated',m);continue;}
    if(p.status!=='initiating')continue;
    const op=s.operations.get(p.operationId)!;
    if(!op.initiationTimer||timerRemaining(s,op.initiationTimer)>0)continue;
    p.status='pending';p.pendingAtMs=s.aiClock.nowMs;delete op.initiationTimer;finishDecisionInitiation(s,op.id,true);
    const player=p.recipient===s.playerFactionId;
    p.responseTimer=startProactiveTimer(s,p.recipient,`trade-response:${p.id}`,player?RESPONSE.playerOnlineMs:RESPONSE.onlineMinMs,player?RESPONSE.playerOnlineMs:RESPONSE.onlineMaxMs,player?RESPONSE.playerOfflineMs/RESPONSE.playerOnlineMs:RESPONSE.offlineDivisor);
    record(s,p.id,'offered',p.proposer,p.recipient,m);
  }
  const pending=liveTradeProposals(s).filter(p=>p.status==='pending').sort((a,b)=>timerRemaining(s,a.responseTimer!)-timerRemaining(s,b.responseTimer!)||a.pendingAtMs!-b.pendingAtMs!||comparePlanIds(a.id,b.id));
  for(const p of pending)if(timerRemaining(s,p.responseTimer!)===0) {
    if(p.recipient===s.playerFactionId){settleTradeProposal(s,p.id,'expired',m);continue;}
    const o=s.aiDecisionOpportunities.get(p.recipient);if(o?.primary?.phase==='deliberating'){o.primary=null;o.lastBoundaryMs=s.aiClock.nowMs;}
    if(m)m.requiredResponses++;
    const response=assessRequiredTradeResponse(s,p);
    settleTradeProposal(s,p.id,response.outcome==='ACCEPT_TRADE'?'accepted':'declined',m);
  }
}
export function publicTradeState(s:GameState,viewer:string|null) {
  return {proposals:[...s.tradeProposals.values()].filter(p=>p.pendingAtMs!==null&&(p.proposer===viewer||p.recipient===viewer)).sort((a,b)=>comparePlanIds(a.id,b.id)).map(p=>({id:p.id,proposer:p.proposer,recipient:p.recipient,offered:{...p.plan.offered},requested:{...p.plan.requested},status:p.status,remainingResponseMs:p.status==='pending'&&p.recipient===s.playerFactionId?timerRemaining(s,p.responseTimer!):null})),
    shipments:[...s.tradeShipments.values()].filter(sh=>sh.sender===viewer||sh.recipient===viewer).sort((a,b)=>comparePlanIds(a.id,b.id)).map(sh=>({id:sh.id,proposalId:sh.proposalId,sender:sh.sender,recipient:sh.recipient,cargo:{...sh.cargo},originTerritoryId:sh.originTerritoryId,destinationTerritoryId:sh.destinationTerritoryId,status:sh.phase}))};
}
