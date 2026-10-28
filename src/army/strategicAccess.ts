import type { Army, Territory } from '../types';
import type { GameState } from '../types/GameState';
import { comparePlanIds } from '../types/AIConcretePlan';
import { computeAttackerPower, computeDefenderPower } from '../battle/CombatPower';
import { withTerritoryCombatView } from '../gameplay/defense/territoryDefense';
import { canAiAttackPlayer } from '../gameplay/invasion/eligibility';
import { isPlayerAnchorProtected } from '../gameplay/anchors';
import { factionsAreHostile } from '../gameplay/diplomacy/relationships';
import { MIN_ATTACKING_TROOPS, armyHasActiveStrategicOperation } from './strategicAttack';
import { calculateMovementDuration } from './movement';

type TravelNode = Pick<Territory, 'id'|'owner'|'neighboring'>;
/** Disposable weighted search over owned land. Paths/ties are stable and no
 * routes or outcomes are retained as authority. O((V+E) log V) search,
 * O(V+E) temporary storage (including stale priority-queue entries). */
export function ownedTravel<N extends TravelNode>(nodes: ReadonlyMap<string,N>, owner: string, origin: string, duration: (from:N,to:N)=>number) {
  const distance = new Map<string,number>(), parent = new Map<string,string>();
  const queue: {id:string;cost:number}[] = [];
  const less = (a:typeof queue[number],b:typeof queue[number]) => a.cost < b.cost || a.cost === b.cost && comparePlanIds(a.id,b.id) < 0;
  const push = (item:typeof queue[number]) => { queue.push(item); let i=queue.length-1; while(i>0) {const p=(i-1)>>1;if(!less(queue[i],queue[p]))break;[queue[i],queue[p]]=[queue[p],queue[i]];i=p;} };
  const pop = () => {const first=queue[0],last=queue.pop()!;if(queue.length){queue[0]=last;let i=0;for(;;){let c=i*2+1;if(c>=queue.length)break;if(c+1<queue.length&&less(queue[c+1],queue[c]))c++;if(!less(queue[c],queue[i]))break;[queue[c],queue[i]]=[queue[i],queue[c]];i=c;}}return first;};
  if(nodes.get(origin)?.owner!==owner)return {distance,parent};
  distance.set(origin,0);push({id:origin,cost:0});
  while(queue.length) {
    const item=pop();if(distance.get(item.id)!==item.cost)continue;
    const from=nodes.get(item.id)!;
    for(const id of [...from.neighboring].sort(comparePlanIds)) {
      const to=nodes.get(id);if(!to||to.owner!==owner)continue;
      const cost=item.cost+duration(from,to),old=distance.get(id);
      if(old===undefined||cost<old){distance.set(id,cost);parent.set(id,item.id);push({id,cost});}
    }
  }
  return {distance,parent};
}
export function ownedPath(search:ReturnType<typeof ownedTravel>,origin:string,to:string):string[]|null {
  if(!search.distance.has(to))return null;
  const path=[to];while(path[path.length-1]!==origin){const previous=search.parent.get(path[path.length-1]);if(!previous)return null;path.push(previous);}return path.reverse();
}
export function legalStrategicAccessTarget(state:GameState,owner:string,target:Territory):boolean {
  return factionsAreHostile(state,owner,target.owner) && (target.baseValue>0||Object.values(target.resourceOutput).some(q=>q!>0))
    && (target.owner!==state.playerFactionId||canAiAttackPlayer(state,owner)&&!isPlayerAnchorProtected(state,target.id));
}
/** One credible access problem, not idleness pressure. Never dispatch a claimed,
 * engaged, undersized, foreign-sited force or strip an exposed origin. */
export function strategicAccessOpportunity(state:GameState,owner:string,armyId:string) {
  const army=state.armies.get(armyId),origin=army&&state.territories.get(army.location);
  if(!army||army.owner!==owner||!origin||origin.owner!==owner||army.soldiers+army.knights<=MIN_ATTACKING_TROOPS
    ||armyHasActiveStrategicOperation(army)||state.operationClaims.has(`force:${armyId}`)
    ||[...state.activeInvasions.values()].some(i=>i.attackingArmyIds.includes(armyId)))return null;
  const allArmies=[...state.armies.values()].sort((a,b)=>comparePlanIds(a.id,b.id));
  const bySite=new Map<string,Army[]>();for(const a of allArmies){const local=bySite.get(a.location)??[];local.push(a);bySite.set(a.location,local);}
  const stationary=(a:Army)=>!armyHasActiveStrategicOperation(a);
  const left=(bySite.get(origin.id)??[]).filter(a=>a.owner===owner&&a.id!==armyId&&stationary(a));
  const defense=computeDefenderPower(left,origin.garrison,withTerritoryCombatView(state,origin)).effectivePower;
  for(const id of origin.neighboring) {
    const t=state.territories.get(id);if(!t||!factionsAreHostile(state,owner,t.owner))continue;
    const enemies=(bySite.get(id)??[]).filter(a=>a.owner===t.owner&&a.soldiers+a.knights>MIN_ATTACKING_TROOPS);
    if(enemies.length&&computeAttackerPower(enemies).effectivePower>defense)return null;
  }
  const power=computeAttackerPower([army]).effectivePower;
  const travel=ownedTravel(state.territories,owner,origin.id,(from,to)=>calculateMovementDuration({origin:from,destination:to}));
  const engagedTargets=new Set([...state.activeInvasions.values()].map(i=>i.territoryId));
  const choices:{target:string;frontier:string;cost:number}[]=[];
  for(const [id,cost]of travel.distance)for(const next of [...state.territories.get(id)!.neighboring].sort(comparePlanIds)) {
    const t=state.territories.get(next);if(!t||engagedTargets.has(next)||!legalStrategicAccessTarget(state,owner,t))continue;
    const defenders=(bySite.get(next)??[]).filter(a=>a.owner===t.owner);
    if(power>computeDefenderPower(defenders,t.garrison,withTerritoryCombatView(state,t)).effectivePower)choices.push({target:next,frontier:id,cost});
  }
  choices.sort((a,b)=>a.cost-b.cost||comparePlanIds(a.target,b.target)||comparePlanIds(a.frontier,b.frontier));
  const chosen=choices[0];if(!chosen)return null;
  const route=ownedPath(travel,origin.id,chosen.frontier)!;
  // Local/immediate staging is already owned by MILITARY_INITIATIVE.
  if(route.length<=2)return null;
  return {armyId,targetTerritoryId:chosen.target,counterpartyId:state.territories.get(chosen.target)!.owner!,frontierTerritoryId:chosen.frontier,
    nextTerritoryId:route[1],ownedRoute:route,travelTicks:chosen.cost};
}
