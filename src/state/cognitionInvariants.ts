import type {GameState} from '../types/GameState';
import {objectiveProblem} from '../cognition/goals';
import {COGNITION_TUNING as T} from '../constants/cognition';
export function cognitionStateProblems(s:GameState):string[]{
  const out:string[]=[];
  if(!(s.opinionEvents instanceof Map))out.push('Missing canonical Opinion event receipts');
  else for(const[id,e]of s.opinionEvents){
    if(!e||e.id!==id||!e.observer||!e.target||e.observer===e.target||!s.factions.has(e.observer)||!s.factions.has(e.target)||typeof e.kind!=='string'||!e.kind||!Number.isFinite(e.delta)||!Number.isSafeInteger(e.atTick)||e.atTick<0||e.atTick>s.worldTick)out.push(`Invalid Opinion receipt ${id}`);
    else try{const key=JSON.parse(id.slice('opinion:v1:'.length));if(!id.startsWith('opinion:v1:')||!Array.isArray(key)||key.length!==3||typeof key[0]!=='string'||!key[0]||key[1]!==e.observer||key[2]!==e.target)out.push(`Opinion receipt identity mismatch ${id}`);}catch{out.push(`Malformed Opinion receipt ${id}`);}
  }
  for(const[fid,f]of s.factions){
    const ids=new Set<string>();
    for(const g of f.goals){
      if(!g.id||ids.has(g.id)||!Number.isFinite(g.priority)||g.priority<0||g.priority>100||!Number.isFinite(g.progress)||!Number.isFinite(g.targetProgress)||g.progress<0||g.targetProgress<=0||g.progress>g.targetProgress)out.push(`Invalid Goal ${fid}/${g.id}`);ids.add(g.id);
      const l=g.lifecycle;if(!l){if(s.schemaVersion>=25)out.push(`Missing canonical Goal lifecycle ${fid}/${g.id}`);continue;}
      if(l.ownerId!==fid||!['ACTIVE','COMPLETED','INVALIDATED'].includes(l.status)||l.visibility!=='PRIVATE'||l.createdAtTick!==null&&(!Number.isSafeInteger(l.createdAtTick)||l.createdAtTick<0||l.createdAtTick>s.worldTick)||
        l.status==='ACTIVE'&&(l.resolvedAtTick!==null||!l.objective)||l.status==='COMPLETED'&&(!l.objective||g.progress!==g.targetProgress)||l.status!=='ACTIVE'&&(!Number.isSafeInteger(l.resolvedAtTick)||l.resolvedAtTick!<0||l.createdAtTick!==null&&l.resolvedAtTick!<l.createdAtTick||l.resolvedAtTick!>s.worldTick)||l.objective&&(!!objectiveProblem(l.objective)||(l.objective.kind==='PEACE'||l.objective.kind==='ELIMINATE_FACTION')&&l.objective.factionId===fid))out.push(`Invalid Goal lifecycle ${fid}/${g.id}`);
    }
    for(const[target,r]of f.diplomacy)if(!r||target===fid||!s.factions.has(target)||target!==r.target||!Number.isFinite(r.opinion)||Math.abs(r.opinion)>T.opinionRange)out.push(`Invalid directed Opinion ${fid}/${target}`);
  }
  return out;
}
