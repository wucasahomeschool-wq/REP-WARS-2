import type {GameState} from '../types/GameState';
import {conflictPairId} from '../conflict/ledger';
import {CONFLICT_TUNING} from '../constants/conflict';
export function conflictStateProblems(s:GameState):string[] {
  const out:string[]=[];const count=(n:unknown)=>Number.isSafeInteger(n)&&(n as number)>=0;
  const resources=(r:unknown)=>!!r&&typeof r==='object'&&['gold','food','wood','iron','stone'].every(k=>Number.isFinite((r as Record<string,number>)[k])&&(r as Record<string,number>)[k]!>=0);
  if(!(s.conflictLedger instanceof Map)||!(s.conflictEventReceipts instanceof Map))return ['Missing canonical Conflict Ledger'];
  for(const[id,p]of s.conflictLedger){
    if(!p||p.id!==id||!Array.isArray(p.factions)||p.factions.length!==2||p.factions[0]===p.factions[1]||p.factions.some(f=>!s.factions.has(f))||id!==conflictPairId(...p.factions)||p.factions[0]>p.factions[1]||!(p.episodes instanceof Map)||!count(p.currentEpisode)||!p.episodes.has(p.currentEpisode)){out.push(`Invalid conflict pair ${id}`);continue;}
    if(p.episodes.size!==p.currentEpisode+1)out.push(`Conflict episode sequence mismatch ${id}`);
    for(const[i,e]of p.episodes){
      if(!e||e.index!==i||!count(i)||i>p.currentEpisode||!count(e.startedAtTick)||e.startedAtTick>s.worldTick||!count(e.startedAtMs)||e.startedAtMs>s.aiClock.nowMs||!count(e.materialSequence)||!Array.isArray(e.totals)||e.totals.length!==2||!Array.isArray(e.recent)||e.recent.length>2*CONFLICT_TUNING.recentWindow){out.push(`Invalid conflict episode ${id}/${i}`);continue;}
      if(e.closure===null?(e.endedAtTick!==null||e.endedAtMs!==null||i!==p.currentEpisode):(e.closure!=='PEACE'||!count(e.endedAtTick)||e.endedAtTick!<e.startedAtTick||e.endedAtTick!>s.worldTick||!count(e.endedAtMs)||e.endedAtMs!<e.startedAtMs||e.endedAtMs!>s.aiClock.nowMs))out.push(`Invalid conflict boundary ${id}/${i}`);
      for(const t of e.totals)if(!t||!resources(t.resourcesLost)||['commitments','arrivals','battles','victories','failedAttacks','retreats','troopsLost','siegeLost','territoriesGained','territoriesLost','structuresLost','fortificationLevelsLost','projectsLost','poolTroopsLost'].some(k=>!count(t[k as keyof typeof t])))out.push(`Invalid conflict totals ${id}/${i}`);
      let prev=0;for(const d of e.recent){if(!d||!['troopLosses','siegeLosses','structuresLost','fortificationLevelsLost','projectsLost','poolTroopsLost','territoryGains','resourcesLost'].every(k=>Array.isArray(d[k as keyof typeof d])&&(d[k as keyof typeof d] as unknown[]).length===2)){out.push(`Invalid conflict window ${id}/${i}`);continue;}if(!count(d.sequence)||d.sequence<=prev||d.sequence>e.materialSequence||!count(d.atTick)||d.atTick<e.startedAtTick||d.atTick>s.worldTick||!count(d.atMs)||d.atMs<e.startedAtMs||d.atMs>s.aiClock.nowMs||[...d.troopLosses,...d.siegeLosses,...d.structuresLost,...d.fortificationLevelsLost,...d.projectsLost,...d.poolTroopsLost].some(n=>!count(n))||d.resourcesLost.some(r=>!resources(r))||d.territoryGains.some(n=>!Number.isSafeInteger(n)||Math.abs(n)>1)||d.territoryGains[0]+d.territoryGains[1]!==0)out.push(`Invalid conflict window ${id}/${i}`);prev=d.sequence;}
    }
  }
  for(const[id,r]of s.conflictEventReceipts){
    if(!r||!s.conflictLedger.get(r.pairId)?.episodes.has(r.episode)||!count(r.atTick)||r.atTick>s.worldTick||!count(r.atMs)||r.atMs>s.aiClock.nowMs||typeof r.signature!=='string'){out.push(`Invalid conflict receipt ${id}`);continue;}
    try{const key=JSON.parse(id.slice('conflict-event:v1:'.length)),fact=JSON.parse(r.signature);if(!id.startsWith('conflict-event:v1:')||!Array.isArray(key)||key.length!==3||typeof key[0]!=='string'||!key[0]||key[2]!==r.pairId||key[1]!==fact.kind||!['ATTACK_COMMITTED','HOSTILE_ARRIVAL','BATTLE','TERRITORY_TRANSFER','ATTACK_TERMINAL','RETREAT','PEACE_ACTIVATED','WAR_RETURN'].includes(fact.kind)||fact.actor===fact.target||conflictPairId(fact.actor,fact.target)!==r.pairId)out.push(`Conflict receipt identity mismatch ${id}`);}catch{out.push(`Malformed conflict receipt ${id}`);}
  }
  return out;
}
