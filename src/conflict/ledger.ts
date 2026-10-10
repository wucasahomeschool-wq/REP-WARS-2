import type {GameState} from '../types/GameState';
import type {Resources} from '../types';
import type {ConflictFact,ConflictTotals,ConflictEpisode,ConflictPairLedger,ConflictMaterialDelta} from '../types/ConflictLedger';
import {CONFLICT_TUNING as T} from '../constants/conflict';
import {comparePlanIds} from '../types/AIConcretePlan';
const resources=():Resources=>({gold:0,food:0,wood:0,iron:0,stone:0});
export const conflictResources=['gold','food','wood','iron','stone'] as const;
const totals=():ConflictTotals=>({commitments:0,arrivals:0,battles:0,victories:0,failedAttacks:0,retreats:0,troopsLost:0,siegeLost:0,territoriesGained:0,territoriesLost:0,resourcesLost:resources(),structuresLost:0,fortificationLevelsLost:0,projectsLost:0,poolTroopsLost:0});
export function conflictPairId(a:string,b:string):string {return `conflict-pair:v1:${JSON.stringify([a,b].sort(comparePlanIds))}`;}
export function conflictEventId(domainId:string,kind:ConflictFact['kind'],actor:string,target:string):string {return `conflict-event:v1:${JSON.stringify([domainId,kind,conflictPairId(actor,target)])}`;}
export function hostileFactIdentity(s:GameState,territoryId:string,armyIds:readonly string[],operationId?:string|null,requestId?:string):string {
  if(operationId)return operationId;
  const ids=[...armyIds].sort(comparePlanIds),links=ids.map(id=>{const intent=s.armies.get(id)?.attackIntent;return intent?.targetTerritoryId===territoryId?intent.conflictFactId:undefined;});
  if(links.length&&links.every(id=>id&&id===links[0]))return links[0]!;
  // Direct command identity is an existing replay input, not a new runtime
  // counter. Persist its link on delayed intent so ADVANCE_WORLD cannot change it.
  if(requestId)return `command-attack:${JSON.stringify([requestId,territoryId,ids])}`;
  return `physical-attack:${JSON.stringify([Math.min(s.worldTick,...ids.map(id=>s.armies.get(id)?.attackIntent?.createdAtTick??s.worldTick)),territoryId,ids])}`;
}
function stable(v:unknown):string {if(Array.isArray(v))return `[${v.map(stable).join(',')}]`;if(v&&typeof v==='object')return `{${Object.keys(v).sort(comparePlanIds).filter(k=>(v as Record<string,unknown>)[k]!==undefined).map(k=>JSON.stringify(k)+':'+stable((v as Record<string,unknown>)[k])).join(',')}}`;return JSON.stringify(v);}
function newEpisode(s:GameState,index:number):ConflictEpisode {return {index,startedAtTick:s.worldTick,startedAtMs:s.aiClock.nowMs,endedAtTick:null,endedAtMs:null,closure:null,totals:[totals(),totals()],recent:[],materialSequence:0};}
/** PROVISIONAL IMPLEMENTATION POLICY — PRODUCT CONFIRMATION REQUIRED.
 * Lazy observed episode at first fact. Actual PEACE closes it; actual expiry
 * starts the next. No invented pre-ledger duration/fighting or history reset. */
export function recordConflictFact(s:GameState,domainId:string,f:ConflictFact):boolean {
  if(typeof domainId!=='string'||!domainId||typeof f.actor!=='string'||typeof f.target!=='string'||f.actor===f.target||!s.factions.has(f.actor)||!s.factions.has(f.target))throw new Error('Invalid conflict participants/identity');
  const kinds=['ATTACK_COMMITTED','HOSTILE_ARRIVAL','BATTLE','TERRITORY_TRANSFER','ATTACK_TERMINAL','RETREAT','PEACE_ACTIVATED','WAR_RETURN'];
  if(!kinds.includes(f.kind))throw new Error('Invalid conflict fact');
  if(f.kind==='BATTLE'&&(!f.troopLosses||f.troopLosses.length!==2||!f.siegeLosses||f.siegeLosses.length!==2||!['attacker','defender','draw'].includes(f.outcome??''))||f.kind==='TERRITORY_TRANSFER'&&!f.territoryId)throw new Error('Incomplete conflict consequence');
  for(const n of [...(f.troopLosses??[]),...(f.siegeLosses??[]),f.structuresLost??0,f.fortificationLevelsLost??0,f.projectsLost??0,f.poolTroopsLost??0])if(!Number.isSafeInteger(n)||n<0)throw new Error('Invalid conflict quantity');
  for(const n of Object.values(f.resourcesLost??{}))if(!Number.isFinite(n)||n<0)throw new Error('Invalid conflict resource quantity');
  const pairId=conflictPairId(f.actor,f.target),id=conflictEventId(domainId,f.kind,f.actor,f.target),signature=stable(f);
  const receipt=s.conflictEventReceipts.get(id);
  if(receipt){if(receipt.signature!==signature)throw new Error('Conflict event identity reused');return false;}
  let p=s.conflictLedger.get(pairId);
  if(!p){p={id:pairId,factions:[f.actor,f.target].sort(comparePlanIds) as [string,string],currentEpisode:0,episodes:new Map([[0,newEpisode(s,0)]])};s.conflictLedger.set(pairId,p);}
  let e=p.episodes.get(p.currentEpisode)!;
  if(f.kind==='WAR_RETURN'&&e.closure==='PEACE'){e=newEpisode(s,++p.currentEpisode);p.episodes.set(e.index,e);}
  if(e.closure&&f.kind!=='WAR_RETURN')throw new Error('Conflict fact cannot change closed Peace episode');
  const a=p.factions[0]===f.actor?0:1,b=a===0?1:0;
  const d:ConflictMaterialDelta={atTick:s.worldTick,atMs:s.aiClock.nowMs,sequence:e.materialSequence,troopLosses:[0,0],siegeLosses:[0,0],territoryGains:[0,0],resourcesLost:[resources(),resources()],structuresLost:[0,0],fortificationLevelsLost:[0,0],projectsLost:[0,0],poolTroopsLost:[0,0]};
  if(f.kind==='ATTACK_COMMITTED')e.totals[a].commitments++;
  if(f.kind==='HOSTILE_ARRIVAL')e.totals[a].arrivals++;
  if(f.kind==='RETREAT')e.totals[a].retreats++;
  if(f.kind==='ATTACK_TERMINAL'&&f.outcome!=='completed')e.totals[a].failedAttacks++;
  if(f.kind==='BATTLE'){
    e.totals[a].battles++;e.totals[b].battles++;
    if(f.outcome==='attacker')e.totals[a].victories++;if(f.outcome==='defender')e.totals[b].victories++;
    for(const [side,index]of [[a,0],[b,1]] as const){const lost=f.troopLosses?.[index]??0;e.totals[side].troopsLost+=lost;d.troopLosses[side]=lost;const siege=f.siegeLosses?.[index]??0;e.totals[side].siegeLost+=siege;d.siegeLosses[side]=siege;}
  }
  if(f.kind==='TERRITORY_TRANSFER'){
    e.totals[a].territoriesGained++;e.totals[b].territoriesLost++;d.territoryGains[a]=1;d.territoryGains[b]=-1;
    e.totals[b].structuresLost+=f.structuresLost??0;d.structuresLost[b]=f.structuresLost??0;
    e.totals[b].fortificationLevelsLost+=f.fortificationLevelsLost??0;d.fortificationLevelsLost[b]=f.fortificationLevelsLost??0;
    e.totals[b].projectsLost+=f.projectsLost??0;d.projectsLost[b]=f.projectsLost??0;
    e.totals[b].poolTroopsLost+=f.poolTroopsLost??0;d.poolTroopsLost[b]=f.poolTroopsLost??0;
    for(const r of conflictResources){const lost=f.resourcesLost?.[r]??0;e.totals[b].resourcesLost[r]+=lost;d.resourcesLost[b][r]=lost;}
  }
  const material=d.troopLosses.some(Boolean)||d.siegeLosses.some(Boolean)||d.territoryGains.some(Boolean)||d.structuresLost.some(Boolean)||d.fortificationLevelsLost.some(Boolean)||d.projectsLost.some(Boolean)||d.poolTroopsLost.some(Boolean)||d.resourcesLost.some(r=>Object.values(r).some(Boolean));
  if(material){d.sequence=++e.materialSequence;e.recent.push(d);if(e.recent.length>2*T.recentWindow)e.recent.shift();}
  if(f.kind==='PEACE_ACTIVATED'){e.endedAtTick=s.worldTick;e.endedAtMs=s.aiClock.nowMs;e.closure='PEACE';}
  s.conflictEventReceipts.set(id,{pairId,episode:e.index,signature,atTick:s.worldTick,atMs:s.aiClock.nowMs});return true;
}
/** Decision-local detached support reads exactly one keyed episode and at most
 * two bounded material windows, never receipts, archived episodes or logs. */
export function conflictSummary(s:Pick<GameState,'conflictLedger'|'worldTick'|'aiClock'>,owner:string,opponent:string) {
  const p=s.conflictLedger.get(conflictPairId(owner,opponent));if(!p)return null;
  const e=p.episodes.get(p.currentEpisode)!,index=p.factions[0]===owner?0:1,other=index===0?1:0;
  const window=(ds:ConflictMaterialDelta[])=>({ownTroopsLost:ds.reduce((n,d)=>n+d.troopLosses[index],0),opponentTroopsLost:ds.reduce((n,d)=>n+d.troopLosses[other],0),ownSiegeLost:ds.reduce((n,d)=>n+d.siegeLosses[index],0),opponentSiegeLost:ds.reduce((n,d)=>n+d.siegeLosses[other],0),netTerritories:ds.reduce((n,d)=>n+d.territoryGains[index],0),ownResourcesLost:conflictResources.reduce((r,k)=>({...r,[k]:ds.reduce((n,d)=>n+d.resourcesLost[index][k],0)}),resources()),opponentResourcesLost:conflictResources.reduce((r,k)=>({...r,[k]:ds.reduce((n,d)=>n+d.resourcesLost[other][k],0)}),resources())});
  return {pairId:p.id,episode:e.index,closed:e.closure!==null,observedDurationTicks:(e.endedAtTick??s.worldTick)-e.startedAtTick,observedDurationMs:(e.endedAtMs??s.aiClock.nowMs)-e.startedAtMs,
    own:structuredClone(e.totals[index]),opponent:structuredClone(e.totals[other]),recent:window(e.recent.slice(-T.recentWindow)),previous:window(e.recent.slice(-2*T.recentWindow,-T.recentWindow)),materialFacts:e.materialSequence,windowLimit:T.recentWindow};
}
