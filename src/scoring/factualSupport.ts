import { availableLocalTroops } from '../gameplay/recruitment/reinforcement';
import { factionsAreHostile, relationshipBetween } from '../gameplay/diplomacy/relationships';
import type { Army, Resources, Territory, ResourceType, RelationshipState } from '../types';
import type { GameState, ConstructionProject, ConstructionProjectType } from '../types/GameState';
import type { TimingSupport } from '../types/StrategicEvaluation';
import { comparePlanIds } from '../types/AIConcretePlan';
import { activeOperations } from '../engine/operations';
import { calculateMovementDuration, movementTicksRemaining } from '../army/movement';
import { combatDefenseMultiplier, defenseWorkoutMultiplier } from '../gameplay/defense/territoryDefense';
import { effectiveResourceOutput } from '../gameplay/economy/effectiveOutput';
import { ECONOMY_CONFIG } from '../gameplay/economy/config';
import { getConstructionProjectDefinition } from '../gameplay/construction/definitions';
import { cityIdFor } from '../gameplay/cities/city';
import { displayedRemainingTicks } from '../gameplay/construction/progress';
import { playerPresenceAt } from '../world/presenceLeases';
import { emptyFixedPointAccrual, FixedPointAccrual, durationRemainingMs } from '../world/timeToTick';
import { millisecondsUntilWholeTicks } from '../world/temporalBoundaries';
import type { ProactiveTimer } from '../types/AIPressure';

/** One shared projection for existing sampled activity timers. It reads earned
 * work/fastest achieved mode; future presence is a bound, never a prediction. */
export function sampledActivityTiming(timer:ProactiveTimer,presence:'ONLINE'|'OFFLINE') {
  return {sampled:true as const,progress:{...timer.progress},presence,
    remainingOnlineMs:durationRemainingMs(timer.progress,timer.onlineDurationMs,'ONLINE'),
    remainingOfflineMs:durationRemainingMs(timer.progress,timer.onlineDurationMs,'OFFLINE'),
    onlineDurationMs:timer.onlineDurationMs,offlineDurationMs:timer.offlineDurationMs};
}
/** Unsampled authoring stays a range. No RNG/timer start in factual support. */
export function unsampledTimingBounds(onlineMs:readonly[number,number],offlineMs:readonly[number,number]) {
  for(const range of [onlineMs,offlineMs])if(range.some(n=>!Number.isSafeInteger(n)||n<0)||range[0]>range[1])throw new Error('Invalid unsampled duration range');
  return {sampled:false as const,remainingOnlineMs:[...onlineMs],remainingOfflineMs:[...offlineMs],confidence:'bounds_only' as const};
}

export interface CommittedEffect {
  id: string; factionId: string;
  classification: 'deterministic_execution'|'contingent_execution';
  armyId?: string; territoryId: string; projectType?: ConstructionProjectType;
  timing: TimingSupport; objectiveValid: boolean;
  localAllocation?: {quantity:number; destination:import('../types/AIConcretePlan').ReinforcePlan['destination']; initiation:ReturnType<typeof sampledActivityTiming>};
}
export interface FactualTerritory extends Omit<Territory,'baseValue'|'population'> {
  output: Resources; projectedOutput: Resources;
  hasCity: boolean; cityDefenseFactor: number;
  projectedCity: boolean; projectedFortification: number;
}
/** Explicit physical-fact whitelist. No Goals, Memory, Opinion, personality,
 * pressure, score, world seed or attack battleSeed can enter an evaluator. */
export class FactualSupport {
  readonly territories = new Map<string,FactualTerritory>();
  readonly armies = new Map<string,Army>();
  readonly localPools = new Map<string,{troops:number;available:number;reserved:number}>();
  readonly stocks = new Map<string,Resources>();
  readonly wars = new Map<string,readonly string[]>();
  readonly relationshipStates=new Map<string,ReadonlyMap<string,import('../types/Peace').AuthoritativeRelationship>>();
  readonly builds: readonly ConstructionProject[];
  readonly committed: readonly CommittedEffect[];
  readonly presence: 'ONLINE'|'OFFLINE';
  readonly foodDemand = new Map<string,number>();
  readonly cityCombatEnabled:boolean;
  readonly playerFactionId:string|null;
  readonly virtualDefenses=new Map<string,Army[]>();
  private readonly worldFraction:FixedPointAccrual;
  private readonly resourceCache=new Map<string,ReturnType<FactualSupport['deriveResourceFacts']>>();
  constructor(state: GameState) {
    this.presence = playerPresenceAt(state.gameplaySessionLeases,state.aiClock.nowMs);
    this.cityCombatEnabled=(state.worldLevel??0)>=2;
    this.playerFactionId=state.playerFactionId;
    const anchor=state.aiClock.worldAnchor;
    this.worldFraction=anchor&&anchor.lastAccrualAtMs===state.aiClock.nowMs?{wholeTicks:0,subTickMicroticks:anchor.subTickMicroticks,accrualDivisionRemainder:anchor.accrualDivisionRemainder}:emptyFixedPointAccrual();
    this.builds = [...state.constructions.values()].filter(p=>p.status==='in_progress').sort((a,b)=>comparePlanIds(a.id,b.id)).map(p=>({...p}));
    for(const [id,f] of [...state.factions].sort(([a],[b])=>comparePlanIds(a,b))) {
      this.stocks.set(id,{...f.resources});
      this.foodDemand.set(id,(state.worldLevel??0)>=2?f.territories.length*ECONOMY_CONFIG.foodPerTerritoryPerCycle:0);
      this.wars.set(id,[...state.factions.keys()].filter(fid=>factionsAreHostile(state,id,fid)).sort(comparePlanIds));
      this.relationshipStates.set(id,new Map([...state.factions.keys()].filter(fid=>fid!==id).sort(comparePlanIds).map(fid=>[fid,relationshipBetween(state,id,fid)])));
    }
    const projectedInfra=new Map(state.territoryInfrastructure);
    const projectsBySite=new Map<string,ConstructionProject>();
    for(const p of this.builds)if(state.territories.get(p.territoryId)?.owner===p.factionId) {
      projectsBySite.set(p.territoryId,p);
      const infra={...(projectedInfra.get(p.territoryId)??{territoryId:p.territoryId,farmCompletedAtTick:null,mineCompletedAtTick:null,lumberCompletedAtTick:null})};
      if(p.projectType==='FARM')infra.farmCompletedAtTick=state.worldTick+p.remainingTicks;
      if(p.projectType==='MINE')infra.mineCompletedAtTick=state.worldTick+p.remainingTicks;
      if(p.projectType==='LUMBER')infra.lumberCompletedAtTick=state.worldTick+p.remainingTicks;
      projectedInfra.set(p.territoryId,infra);
    }
    const projectedEconomy={...state,territoryInfrastructure:projectedInfra};
    for(const [id,t] of [...state.territories].sort(([a],[b])=>comparePlanIds(a,b))) {
      const output = effectiveResourceOutput(state,t),project=projectsBySite.get(id);
      const projectedCity=state.cities.has(cityIdFor(id))||project?.projectType==='CITY';
      const projectedFortification=t.fortification+Number(project?.projectType==='FORTIFICATION');
      this.territories.set(id,{id,owner:t.owner,regionId:t.regionId,terrain:t.terrain,neighboring:[...t.neighboring].sort(comparePlanIds),resourceOutput:{...t.resourceOutput},garrison:t.garrison,fortification:t.fortification,
        output,projectedOutput:effectiveResourceOutput(projectedEconomy,t),hasCity:state.cities.has(cityIdFor(id)),cityDefenseFactor:combatDefenseMultiplier(state,id),projectedCity,projectedFortification});
    }
    for(const [id,a] of [...state.armies].sort(([a],[b])=>comparePlanIds(a,b)))this.armies.set(id,{
      id,owner:a.owner,location:a.location,soldiers:a.soldiers,knights:a.knights,siegeEngines:a.siegeEngines,morale:a.morale,supply:a.supply,
      movement:a.movement?{...a.movement}:null,
      // Intent identity/target only; never copy the future battle seed.
    });
    for(const [id,pool] of state.territoryRecruitment) {const available=availableLocalTroops(state,id);this.localPools.set(id,{troops:pool.troops,available,reserved:pool.troops-available});}
    const operations=activeOperations(state);
    for(const invasion of [...state.activeInvasions.values()].sort((a,b)=>comparePlanIds(a.id,b.id)))if(invasion.defenseMobilization) {
      const power=Math.max(0,Math.round(invasion.defenseMobilization.defensePower*defenseWorkoutMultiplier(state,invasion.territoryId)));
      if(power>0)this.virtualDefenses.set(invasion.territoryId,[{id:`defense:${invasion.id}`,owner:invasion.defenderFactionId,location:invasion.territoryId,soldiers:power,knights:0,siegeEngines:0,morale:80,supply:80}]);
    }
    const effects:CommittedEffect[]=[];
    const represented=new Set<string>();
    for(const a of this.armies.values()) {
      const original=state.armies.get(a.id)!;
      const m=a.movement;
      if(m && (m.status==='moving'||m.status==='blocked')) {
        effects.push({id:`movement:${a.id}`,armyId:a.id,factionId:a.owner,territoryId:m.destinationTerritoryId,
          classification:original.attackIntent?'contingent_execution':'deterministic_execution',
          timing:this.timing(movementTicksRemaining(m,state.worldTick),m.durationTicks,m.status==='blocked'?'blocked':'persisted'),
          objectiveValid:operations.find(o=>o.links.armyId===a.id)?.objective!=='invalid'});
      }
      if(original.attackIntent) {
        effects.push({id:`attack:${a.id}`,armyId:a.id,factionId:a.owner,territoryId:original.attackIntent.targetTerritoryId,
          classification:'contingent_execution',timing:this.timing(m?movementTicksRemaining(m,state.worldTick):0,m?.durationTicks??0,original.attackIntent.holdForInvasionId?'external':'persisted'),objectiveValid:true});
        represented.add(a.id);
      }
    }
    for(const o of operations)if(o.action==='ATTACK'&&o.plan?.action==='ATTACK'&&!represented.has(o.plan.armyId)&&o.phase!=='selected') {
      effects.push({id:`attack:${o.plan.armyId}`,armyId:o.plan.armyId,factionId:o.warlordId,territoryId:o.plan.targetTerritoryId,classification:'contingent_execution',timing:this.timing(0,0,'external'),objectiveValid:o.objective==='valid'});
    }
    for(const p of this.builds)effects.push({id:p.id,factionId:p.factionId,territoryId:p.territoryId,projectType:p.projectType,classification:'deterministic_execution',objectiveValid:true,timing:this.timing(displayedRemainingTicks(p,state.worldTick),p.durationTicks,'persisted')});
    for(const op of operations)if(op.plan?.action==='REINFORCE'&&op.initiationTimer) {
      effects.push({id:op.id,factionId:op.warlordId,territoryId:op.plan.territoryId,classification:'deterministic_execution',objectiveValid:op.objective==='valid',timing:this.timing(0,0,'external'),localAllocation:{quantity:op.plan.quantity,destination:{...op.plan.destination},initiation:sampledActivityTiming(op.initiationTimer,this.presence)}});
    }
    this.committed=effects.sort((a,b)=>comparePlanIds(a.id,b.id));
  }
  timing(remainingTicks:number,totalTicks=remainingTicks,certainty:TimingSupport['certainty']='authored'):TimingSupport {
    const remaining=Math.max(0,remainingTicks);
    const bounds=(mode:'ONLINE'|'OFFLINE'):readonly[number,number]|null=>certainty==='blocked'||certainty==='external'?null:
      [millisecondsUntilWholeTicks(this.worldFraction,remaining,mode),millisecondsUntilWholeTicks(this.worldFraction,remaining,mode)];
    return {unit:'world_ticks',remainingTicks:remaining,progressTicks:Math.max(0,totalTicks-remaining),remainingOnlineMs:bounds('ONLINE'),remainingOfflineMs:bounds('OFFLINE'),presence:this.presence,certainty,realWorldDeadlineMs:null,
      explanation:'Existing movement/construction use persisted world-tick work; rated world clock bounds reuse timeToTick. Blocked/external duration is unknown.'};
  }
  logistics(route:readonly string[]) {
    const legs=route.slice(1).map((id,i)=>{
      const from=this.territories.get(route[i]!),to=this.territories.get(id);
      return {from:route[i]!,to:id,reachable:!!from?.neighboring.includes(id)&&!!to,
        durationTicks:from&&to?calculateMovementDuration({origin:{...from,baseValue:0,population:0},destination:{...to,baseValue:0,population:0}}):null};
    });
    const reachable=legs.every(l=>l.reachable);
    return {route:[...route],legs,reachable,timing:this.timing(legs.reduce((n,l)=>n+(l.durationTicks??0),0)),explanation:'Authoritative adjacent-hop route; engagement edge is not movement. No roads or multi-hop pathfinder currently implemented.'};
  }
  placement(army:Army):string {
    return army.movement?.status==='moving'?army.movement.destinationTerritoryId:army.location;
  }
  hostile(factionId:string,other:string|null):boolean {return other!==null&&(this.wars.get(factionId)??[]).includes(other);}
  /** Authoritative stocks already paid in-progress construction. Never subtract them twice.
   * Uncollected tile production cannot fund a build or Food consume in this economy. */
  resourceFacts(factionId:string,resource:ResourceType) {
    const key=JSON.stringify([factionId,resource]);
    if(!this.resourceCache.has(key))this.resourceCache.set(key,this.deriveResourceFacts(factionId,resource));
    return this.resourceCache.get(key)!;
  }
  private deriveResourceFacts(factionId:string,resource:ResourceType) {
    const holdings=this.stocks.get(factionId)?.[resource]??0;
    const owned=[...this.territories.values()].filter(t=>t.owner===factionId);
    const income=owned.reduce((n,t)=>n+t.projectedOutput[resource],0);
    const buildDemand=Math.max(0,...(['CITY','FORTIFICATION','FARM','MINE','LUMBER'] as const).map(k=>getConstructionProjectDefinition(k).cost[resource]??0));
    const unavoidable=resource==='food'?(this.foodDemand.get(factionId)??0):0;
    const committedCosts=this.builds.filter(p=>p.factionId===factionId).reduce((n,p)=>n+(getConstructionProjectDefinition(p.projectType).cost[resource]??0),0);
    return {holdings,income,demand:Math.max(buildDemand,unavoidable),unavoidable,committedCostsAlreadyPaid:committedCosts,locality:'faction_bank_only' as const};
  }
}
