import type {GameState} from '../types/GameState';
import {activeGoals} from './goals';
import {comparePlanIds} from '../types/AIConcretePlan';
import {relationshipBetween} from '../gameplay/diplomacy/relationships';
/** Authorized subset, derived per deliberation, never persisted/second world.
 * Own private cognition is detached. Other factions expose identity and public
 * relationship only: no implicit public Personality/Goal/Opinion contract. */
export function factionDecisionView(s:GameState,owner:string){
  const own=s.factions.get(owner);if(!own)throw new Error('Unknown deciding faction');
  const clone=<T>(x:T):T=>JSON.parse(JSON.stringify(x));
  return {
    factionId:owner,
    own:{goals:activeGoals(s,owner).map(clone),opinions:new Map([...own.diplomacy].sort(([a],[b])=>comparePlanIds(a,b)).map(([id,r])=>[id,r.opinion])),
      personality:{...own.personality},ambition:own.ambition},
    others:new Map([...s.factions.values()].filter(f=>f.id!==owner&&own.knownFactions.includes(f.id)).sort((a,b)=>comparePlanIds(a.id,b.id)).map(f=>[f.id,{id:f.id,name:f.name,relationship:relationshipBetween(s,owner,f.id)}])),
  };
}
