import type { Army, ResourceType } from '../types';
import { soldierForce } from '../army/soldierForce';
import {CONFLICT_TUNING as C} from '../constants/conflict';
import {conflictResources} from '../conflict/ledger';
import type { BuildPlan, ReinforcePlan } from '../types/AIConcretePlan';
import type { EvaluatorAssessment, FactualUncertainty, StrategicEvaluator } from '../types/StrategicEvaluation';
import { STRATEGIC_EVALUATORS } from '../types/StrategicEvaluation';
import { computeAttackerPower, computeDefenderPower } from '../battle/CombatPower';
import { BALANCE } from '../constants/balance';
import { STRATEGIC_EVALUATION_TUNING as T } from '../constants/strategicEvaluation';
import { constructionCostEntries, getConstructionProjectDefinition } from '../gameplay/construction/definitions';
import { ECONOMY_CONFIG } from '../gameplay/economy/config';
import { GAMEPLAY_CONFIG } from '../gameplay/config';
import { FactualSupport } from './factualSupport';
import { MIN_ATTACKING_TROOPS } from '../army/strategicAttack';

export const deterministicFacts:FactualUncertainty=Object.freeze({branches:Object.freeze(['specified effect']),realizationStructure:'deterministic',confidence:'high',timingSensitivity:false,unresolvedExternalChoice:false});
export const contingentFacts:FactualUncertainty=Object.freeze({branches:Object.freeze(['attacker victory','defender victory','held/draw']),realizationStructure:'contingent',confidence:'bounded',timingSensitivity:true,unresolvedExternalChoice:false});
// Diagnostic mutation must never change the templates used by later cognition.
const assessment=<F extends Record<string,unknown>>(evaluator:StrategicEvaluator,facts:F,provenance:readonly string[],uncertainty=deterministicFacts):EvaluatorAssessment&{facts:F}=>({evaluator,facts,provenance,uncertainty:{...uncertainty,branches:[...uncertainty.branches]}});
/** Seven factual identities only. Memoization expires with this one decision;
 * evaluator inputs have no cognitive fields or RNG. Supporting assessments are
 * dependencies, not additional scores at the comparator. */
export class StrategicEvaluators {
  readonly calls=Object.fromEntries(STRATEGIC_EVALUATORS.map(k=>[k,0])) as Record<StrategicEvaluator,number>;
  cacheHits=0;
  private readonly cache=new Map<string,unknown>();
  constructor(readonly support:FactualSupport) {}
  private memo<R>(kind:StrategicEvaluator,parameters:readonly unknown[],compute:()=>R):R {
    const key=JSON.stringify([kind,...parameters]);
    if(this.cache.has(key)){this.cacheHits++;return this.cache.get(key) as R;}
    this.calls[kind]++;const result=compute();this.cache.set(key,result);return result;
  }
  battleOutlook(armyId:string,territoryId:string) {
    return this.memo('BATTLE_OUTLOOK',[armyId,territoryId],()=>{
      const a=this.support.armies.get(armyId)!,t=this.support.territories.get(territoryId)!;
      if(!a||!t)throw new Error('BATTLE_OUTLOOK requires a specified current force and place');
      // Match existing domain BattleInput assembly: army.location is the
      // current authoritative combat place, including its current domain rules.
      const defenders=[...this.support.armies.values()].filter(d=>d.id!==armyId&&d.owner===t.owner&&d.location===territoryId);
      defenders.push(...this.support.virtualDefenses.get(territoryId)??[]);
      const attacker=computeAttackerPower([a]),defender=computeDefenderPower(defenders,t.garrison,t);
      const unopposed=defender.rawTroops===0&&t.owner!==this.support.playerFactionId;
      const ratio=attacker.effectivePower/defender.effectivePower;
      const advantage=(attacker.effectivePower-defender.effectivePower)/(attacker.effectivePower+defender.effectivePower);
      return assessment('BATTLE_OUTLOOK',{attackerEffectiveStrength:attacker.effectivePower,defenderEffectiveStrength:defender.effectivePower,relativeAdvantage:advantage,ratio,
        expectedOutcomeBand:unopposed?'unopposed':ratio>=BALANCE.military.criticalThreatRatio?'favorable':ratio<=1/BALANCE.military.criticalThreatRatio?'unfavorable':'contested',
        // BattleEngine owns no-retreat losses: decisive defeat annihilates the
        // losing force. These are branch bounds, not an invented expected rate.
        lossSeverity:{attackerVictory:unopposed?[0,0]:[BALANCE.combat.casualties.winnerMinRate,BALANCE.combat.casualties.winnerMaxRate],attackerDefeat:[1,1],draw:'battle-owned'},
        defenderArmyIds:defenders.map(d=>d.id),garrison:t.garrison,terrain:t.terrain,fortification:t.fortification,cityDefenseFactor:t.cityDefenseFactor,
      },['CombatPower.computeAttackerPower','CombatPower.computeDefenderPower','BattleEngine no-retreat outcomes; no battle roll consumed'],unopposed?deterministicFacts:{
        ...contingentFacts,unresolvedExternalChoice:t.owner===this.support.playerFactionId||!!this.support.committed.find(e=>e.armyId===armyId&&e.timing.certainty==='external')});
    });
  }
  territoryValue(factionId:string,territoryId:string) {
    return this.memo('TERRITORY_VALUE',[factionId,territoryId],()=>{
      const t=this.support.territories.get(territoryId)!;
      // Acquisition destroys existing infrastructure/developments under the
      // current domain ownership reducer. Retention preserves committed builds.
      const retained=t.owner===factionId;
      const postControlOutput=retained?t.projectedOutput:t.resourceOutput;
      const production=Object.entries(postControlOutput).sort(([a],[b])=>a<b?-1:a>b?1:0).reduce((n,[r,q])=>n+this.resourceValue(factionId,r as ResourceType,q??0,'gain',territoryId,'production').facts.marginalUtility,0);
      const friendly=t.neighboring.filter(id=>this.support.territories.get(id)?.owner===factionId);
      const dependencies=friendly.filter(id=>this.support.territories.get(id)!.neighboring.filter(n=>this.support.territories.get(n)?.owner===factionId||n===territoryId).length===1);
      const infrastructure=retained?Number(t.projectedCity)+t.projectedFortification:0;
      const utility=production+infrastructure*T.infrastructureUnits+friendly.length*T.connectivityUnits+dependencies.length*T.dependencyUnits;
      return assessment('TERRITORY_VALUE',{territoryId,production,postControlOutput,infrastructure,retained,friendlyConnectivity:friendly.length,dependentPositions:dependencies,utility},['effectiveResourceOutput','RESOURCE_VALUE (production support)','canonical neighboring/ownership/cities/construction','settleTerritoryOwnershipChange destroys infrastructure on acquisition']);
    });
  }
  localDanger(factionId:string,territoryId:string,excludeArmyId?:string,proposedArmyId?:string,proposedArrivalTicks?:number) {
    return this.memo('LOCAL_DANGER',[factionId,territoryId,excludeArmyId??null,proposedArmyId??null,proposedArrivalTicks??null],()=>{
      const t=this.support.territories.get(territoryId)!;
      const threats=new Map<string,{army:Army;remainingTicks:number;committed:boolean}>();
      for(const a of this.support.armies.values())if(a.owner!==factionId&&a.id!==excludeArmyId) {
        const committedAttack=this.support.committed.find(e=>e.id===`attack:${a.id}`&&e.objectiveValid);
        // Mutual Peace acceptance prohibits fresh hostility, not an existing
        // exact committed attack. Keep actual threats in the factual baseline.
        if(!this.support.hostile(factionId,a.owner)&&!committedAttack)continue;
        if(committedAttack&&committedAttack.territoryId!==territoryId)continue;
        const attack=committedAttack;
        const placement=this.support.placement(a),at=this.support.territories.get(placement);
        const canReach=placement===territoryId||(at?.owner===a.owner&&a.soldiers+a.knights>MIN_ATTACKING_TROOPS&&at.neighboring.includes(territoryId));
        if(attack||canReach) {
          // One entry per physical force, regardless of routes/intent/operation.
          const march=this.support.committed.find(e=>e.id===`movement:${a.id}`);
          if(march?.timing.certainty==='blocked')continue;
          // Actual adjacent engagement has zero march/initiation time, even
          // for a currently uncommitted capable force. Only already-started
          // staging travel grants time for friendly support to arrive.
          threats.set(a.id,{army:a,remainingTicks:march?.timing.remainingTicks??0,committed:!!attack});
        }
      }
      const earliest=threats.size?Math.min(...[...threats.values()].map(x=>x.remainingTicks)):null;
      const defenders=[...this.support.armies.values()].filter(a=>a.owner===factionId&&a.id!==excludeArmyId&&a.id!==proposedArmyId&&(
        (!a.movement&&a.location===territoryId)||
        (a.movement?.status==='moving'&&a.movement.destinationTerritoryId===territoryId&&this.support.committed.find(e=>e.id===`movement:${a.id}`)!.timing.remainingTicks<=(earliest??0))));
      let proposedSupportArrivalTicks:number|null=null;
      if(proposedArmyId) {
        const proposed=this.support.armies.get(proposedArmyId);
        if(!proposed||proposed.owner!==factionId)throw new Error('Invalid proposed defense force');
        const route=this.support.logistics(proposed.location===territoryId?[territoryId]:[proposed.location,territoryId]);
        proposedSupportArrivalTicks=proposedArrivalTicks??route.timing.remainingTicks;
        if(!Number.isFinite(proposedSupportArrivalTicks)||proposedSupportArrivalTicks<0)throw new Error('Invalid proposed defense arrival');
        if(route.reachable&&(earliest===null||proposedSupportArrivalTicks<=earliest))defenders.push(proposed);
      }
      // Already-earned invasion defense is actual domain support, not a
      // predicted future workout or a second copy of a physical hostile force.
      if(t.owner===factionId)defenders.push(...this.support.virtualDefenses.get(territoryId)??[]);
      const realisticGarrison=t.owner===factionId?t.garrison:0;
      const defense=computeDefenderPower(defenders,realisticGarrison,t).effectivePower;
      const hostilePower=[...threats.values()].reduce((n,x)=>n+computeAttackerPower([x.army]).effectivePower,0);
      return assessment('LOCAL_DANGER',{territoryId,hostileForceIds:[...threats.keys()],hostilePower,defensePower:defense,
        shortfall:Math.max(0,hostilePower-defense),dangerRatio:hostilePower/(hostilePower+defense),earliestThreatTicks:earliest,
        committedThreats:[...threats.values()].filter(x=>x.committed).length,friendlySupportIds:defenders.map(a=>a.id),proposedSupportArrivalTicks},
        ['canonical force identity deduplication','CombatPower defenders/attackers','LOGISTICS_ANALYSIS','committed arrivals (only support arriving in time)'],threats.size?contingentFacts:deterministicFacts);
    });
  }
  /** Existing FORCE_POSITION_VALUE identity, not an eighth evaluator.
   * Allocation improves exact local capacity; alternative local use owns the
   * pool opportunity cost once. It does not assume intervening hostile choices. */
  localAllocationValue(plan:ReinforcePlan,targetTerritoryId?:string) {
    return this.memo('FORCE_POSITION_VALUE',[plan.id,targetTerritoryId??null],()=>{
      const t=this.support.territories.get(plan.territoryId)!;
      const pool=this.support.localPools.get(t.id)!;
      const danger=this.localDanger(plan.factionId,t.id).facts;
      const destination=plan.destination.kind==='army'?this.support.armies.get(plan.destination.armyId):undefined;
      const formed=plan.destination.kind==='new_army'?soldierForce(`proposed:${plan.id}`,plan.factionId,t.id,plan.quantity):undefined;
      const virtual=this.support.virtualDefenses.get(t.id)??[];
      const defenders=danger.friendlySupportIds.map(id=>{
        const a=this.support.armies.get(id)??virtual.find(v=>v.id===id);
        if(!a)throw new Error('Local allocation lost factual defender identity');
        return destination?.id===id?{...a,soldiers:a.soldiers+plan.quantity}:a;
      });
      const garrison=t.garrison+(plan.destination.kind==='garrison'?plan.quantity:0);
      if(formed)defenders.push(formed);
      const afterDefense=computeDefenderPower(defenders,garrison,t).effectivePower;
      const defenseGain=Math.min(Math.max(0,afterDefense-danger.defensePower),danger.shortfall);
      let attackGap=0;
      let offensiveGain=0;
      // Preparation is factual support for the already-selected offensive
      // objective, never an internal search for a different hostile target.
      if(destination && targetTerritoryId && this.support.hostile(plan.factionId,this.support.territories.get(targetTerritoryId)?.owner??null)) {
        const outlook=this.battleOutlook(destination.id,targetTerritoryId).facts;
        attackGap=Math.max(0,outlook.defenderEffectiveStrength-outlook.attackerEffectiveStrength);
        const afterAttack=computeAttackerPower([{...destination,soldiers:destination.soldiers+plan.quantity}]).effectivePower;
        offensiveGain=Math.min(Math.max(0,afterAttack-outlook.attackerEffectiveStrength),attackGap);
      }
      if(formed && targetTerritoryId && t.neighboring.includes(targetTerritoryId)
        && this.support.hostile(plan.factionId,this.support.territories.get(targetTerritoryId)?.owner??null)) {
        const target=this.support.territories.get(targetTerritoryId)!;
        const defenders=[...this.support.armies.values()].filter(a=>a.owner===target.owner&&a.location===target.id);
        defenders.push(...this.support.virtualDefenses.get(target.id)??[]);
        // Minimum legal field force is a domain prerequisite, not a new score.
        // Empty territories still require > MIN_ATTACKING_TROOPS to attack.
        const minimum=computeAttackerPower([soldierForce('minimum',plan.factionId,t.id,MIN_ATTACKING_TROOPS+1)]).effectivePower;
        attackGap=Math.max(minimum,computeDefenderPower(defenders,target.garrison,target).effectivePower);
        offensiveGain=Math.min(computeAttackerPower([formed]).effectivePower,attackGap);
      }
      return assessment('FORCE_POSITION_VALUE',{territoryId:t.id,quantity:plan.quantity,availablePool:pool.available,
        additionalUtility:Math.max(defenseGain,offensiveGain),defenseGain,offensiveGain,
        consumedFraction:plan.quantity/Math.max(1,pool.available)},
        ['Exact local pool availability minus canonical quantity claims','LOCAL_DANGER factual shortfall','CombatPower marginal soldiers','BATTLE_OUTLOOK target-bound preparation'],contingentFacts);
    });
  }
  forcePositionValue(factionId:string,armyId:string,territoryId:string,baselineTerritoryId:string) {
    return this.memo('FORCE_POSITION_VALUE',[factionId,armyId,territoryId,baselineTerritoryId],()=>{
      const a=this.support.armies.get(armyId)!;
      const usefulness=(id:string,arrivalTicks:number)=>{
        const t=this.support.territories.get(id)!;
        const local=this.localDanger(factionId,id,armyId).facts;
        const defenseGap=local.shortfall;
        const power=computeDefenderPower([a],0,t).effectivePower;
        const coverage=t.owner===factionId&&(local.earliestThreatTicks===null||arrivalTicks<=local.earliestThreatTicks)?Math.min(power,defenseGap):0;
        const response=t.neighboring.filter(n=>this.support.territories.get(n)?.owner===factionId).reduce((sum,n)=>{
          const danger=this.localDanger(factionId,n,armyId).facts;
          const responseTicks=arrivalTicks+this.support.logistics([id,n]).timing.remainingTicks;
          return sum+(danger.earliestThreatTicks===null||responseTicks<=danger.earliestThreatTicks?Math.min(power,danger.shortfall)/(1+responseTicks):0);
        },0);
        const access=t.neighboring.filter(n=>this.support.hostile(factionId,this.support.territories.get(n)?.owner??null)).reduce((sum,n)=>{
          const outlook=this.battleOutlook(armyId,n).facts;
          return sum+Math.max(0,outlook.relativeAdvantage)*T.powerScale/(1+this.support.logistics([id,n]).timing.remainingTicks);
        },0);
        return {coverage,response,access,arrivalTicks,total:coverage+response+access};
      };
      const arrival=territoryId===baselineTerritoryId?0:this.support.logistics([baselineTerritoryId,territoryId]).timing.remainingTicks;
      const destination=usefulness(territoryId,arrival),baseline=usefulness(baselineTerritoryId,0);
      return assessment('FORCE_POSITION_VALUE',{armyId,territoryId,baselineTerritoryId,destination,baseline,
        marginalUtility:destination.total-baseline.total,additionalUtility:Math.max(0,destination.total-baseline.total),originOpportunityCost:Math.max(0,baseline.total-destination.total)},
        ['LOCAL_DANGER defense gaps (not raw troop reward)','BATTLE_OUTLOOK offensive reach','LOGISTICS_ANALYSIS response timing','already committed friendly arrivals']);
    });
  }
  resourceValue(factionId:string,resource:ResourceType,quantity:number,direction:'gain'|'loss'|'reserve',territoryId?:string,accessibility:'bank'|'production'|'uncollected'='bank') {
    return this.memo('RESOURCE_VALUE',[factionId,resource,quantity,direction,territoryId??null,accessibility],()=>{
      const facts=this.support.resourceFacts(factionId,resource),q=Math.max(0,quantity),threshold=Math.max(1,facts.demand);
      const isSpendable=accessibility==='bank';
      // Piecewise integral: sub-threshold holdings are twice as consequential;
      // excess holdings saturate. No universal resource exchange rates.
      const utility=(stock:number)=>T.scarcityThresholdUtility*Math.min(Math.max(0,stock),threshold)/threshold+Math.log1p(Math.max(0,stock-threshold)/threshold);
      // Accepted inbound goods belong in the no-additional-commitment baseline,
      // but cannot fund a loss/spend until actual physical delivery.
      const gainBaseline=facts.holdings+facts.committedIncoming;
      const marginal=direction==='gain'?utility(gainBaseline+q)-utility(gainBaseline):utility(facts.holdings)-utility(Math.max(0,facts.holdings-q));
      return assessment('RESOURCE_VALUE',{...facts,resource,quantity:q,direction,territoryId:territoryId??null,accessibility,isSpendable,
        marginalUtility:accessibility==='uncollected'?0:Math.max(0,marginal),unfundedQuantity:direction==='gain'?0:Math.max(0,q-facts.holdings)},
        ['canonical faction.resources','existing construction cost bundles and paid projects','Food upkeep (level gated)','faction bank only; no invented local stockpile/manifest','Production benefit is output potential; collection is not assumed committed'],accessibility==='production'?{
          ...deterministicFacts,realizationStructure:'conditional',confidence:'bounded',branches:['output accrues uncollected','collection only through actual domain command'],unresolvedExternalChoice:true,
        }:deterministicFacts);
    });
  }
  buildValue(plan:BuildPlan) {
    return this.memo('BUILD_VALUE',[plan.id],()=>{
      const t=this.support.territories.get(plan.territoryId)!,definition=getConstructionProjectDefinition(plan.projectType);
      const addressed=this.support.builds.some(p=>p.factionId===plan.factionId&&p.territoryId===plan.territoryId&&p.projectType===plan.projectType);
      const productionKeys:readonly ResourceType[]=plan.projectType==='FARM'?['food']:plan.projectType==='MINE'?['iron','stone']:plan.projectType==='LUMBER'?['wood']:[];
      const productionGain=Object.fromEntries(productionKeys.map(r=>[r,Math.max(0,t.resourceOutput[r]??0)*(ECONOMY_CONFIG.developmentOutputMultiplier-1)]));
      const productionBenefit=productionKeys.reduce((n,r)=>n+this.resourceValue(plan.factionId,r,(productionGain[r]??0)*T.productionHorizonCycles,'gain',t.id,'production').facts.marginalUtility,0);
      const danger=this.localDanger(plan.factionId,t.id).facts;
      const units=[...this.support.armies.values()].filter(a=>a.owner===plan.factionId&&this.support.placement(a)===t.id);
      const before=computeDefenderPower(units,t.garrison,t).effectivePower;
      const after=computeDefenderPower(units,t.garrison,{...t,
        fortification:plan.projectType==='FORTIFICATION'?plan.targetFortificationLevel!:t.projectedFortification,
        cityDefenseFactor:plan.projectType==='CITY'&&this.support.cityCombatEnabled?GAMEPLAY_CONFIG.cityCombatDefenseFactor:t.cityDefenseFactor}).effectivePower;
      const defensiveBenefit=Math.min(Math.max(0,after-before),danger.shortfall)/T.powerScale;
      const costs=constructionCostEntries(definition.cost).map(c=>({...c,assessment:this.resourceValue(plan.factionId,c.resource,c.amount,'loss',t.id)}));
      const directCost=costs.reduce((n,c)=>n+c.assessment.facts.marginalUtility,0);
      // City makes its real fortification upgrade capability available; this
      // is an option at a threatened site, not a fabricated troop/resource yield.
      const capabilityBenefit=plan.projectType==='CITY'&&!t.projectedCity?Math.min(1,danger.shortfall/T.powerScale):0;
      return assessment('BUILD_VALUE',{planId:plan.id,projectType:plan.projectType,territoryId:t.id,targetFortificationLevel:plan.targetFortificationLevel??null,
        productionGain,productionBenefit:addressed?0:productionBenefit,defensiveBenefit:addressed?0:defensiveBenefit,capabilityBenefit:addressed?0:capabilityBenefit,
        additionalBenefit:addressed?0:productionBenefit+defensiveBenefit+capabilityBenefit,directCost,costs,alreadyCommitted:addressed,
        exposure:danger.dangerRatio,timing:this.support.timing(definition.durationTicks),siteCapacityUsed:1},
        ['authored construction definitions/effectiveResourceOutput','RESOURCE_VALUE owns cost inside BUILD_VALUE','LOCAL_DANGER owns exposed investment inside BUILD_VALUE','committed construction is baseline'],{
          ...deterministicFacts,confidence:danger.hostilePower||(!addressed&&productionBenefit>0)?'bounded':'high',timingSensitivity:true,
          realizationStructure:danger.hostilePower?'contingent':!addressed&&productionBenefit>0?'conditional':'deterministic',
          branches:danger.hostilePower?['project completes','investment lost to hostile control']:!addressed&&productionBenefit>0?['project produces uncollected output','bank benefit requires actual collection']:deterministicFacts.branches,
          unresolvedExternalChoice:!addressed&&productionBenefit>0,
        });
    });
  }
  warValue(factionId:string,opponentId:string) {
    return this.memo('WAR_VALUE',[factionId,opponentId],()=>{
      const border=[...this.support.territories.values()].filter(t=>(t.owner===factionId||t.owner===opponentId)&&t.neighboring.some(n=>{
        const owner=this.support.territories.get(n)?.owner;return owner===(t.owner===factionId?opponentId:factionId);
      }));
      const power=(fid:string)=>[...this.support.armies.values()].filter(a=>a.owner===fid&&border.some(t=>t.id===this.support.placement(a))).reduce((n,a)=>n+computeAttackerPower([a]).effectivePower,0);
      const own=power(factionId),enemy=power(opponentId);
      const committed=this.support.committed.filter(e=>e.classification==='contingent_execution'&&e.id.startsWith('attack:')&&
        ((e.factionId===factionId&&this.support.territories.get(e.territoryId)?.owner===opponentId)||(e.factionId===opponentId&&this.support.territories.get(e.territoryId)?.owner===factionId)));
      const conflict=this.support.conflictFor(factionId,opponentId);
      const signed=(n:number,scale:number)=>n/(scale+Math.abs(n));
      const economic=(stocks:import('../types').Resources,fid:string)=>conflictResources.reduce((n,r)=>n+(stocks[r]>0?this.resourceValue(fid,r,stocks[r],'loss').facts.marginalUtility:0),0);
      const balance=(ownLoss:number,enemyLoss:number,territories:number,ownResources:import('../types').Resources,enemyResources:import('../types').Resources)=>
        C.casualtyWeight*signed(enemyLoss-ownLoss,C.casualtyScale)+C.territoryWeight*signed(territories,C.territoryScale)+
        C.economicWeight*signed(economic(enemyResources,opponentId)-economic(ownResources,factionId),C.economicScale);
      const cumulative=conflict?balance(conflict.own.troopsLost,conflict.opponent.troopsLost,conflict.own.territoriesGained-conflict.own.territoriesLost,conflict.own.resourcesLost,conflict.opponent.resourcesLost):0;
      const recent=conflict?balance(conflict.recent.ownTroopsLost,conflict.recent.opponentTroopsLost,conflict.recent.netTerritories,conflict.recent.ownResourcesLost,conflict.recent.opponentResourcesLost):0;
      const previous=conflict?balance(conflict.previous.ownTroopsLost,conflict.previous.opponentTroopsLost,conflict.previous.netTerritories,conflict.previous.ownResourcesLost,conflict.previous.opponentResourcesLost):0;
      const historyBalance=conflict?.materialFacts?cumulative*(1-C.recentWeight)+recent*C.recentWeight:0;
      const currentPositionBalance=(own-enemy)/Math.max(1,own+enemy);
      const continuationBalance=conflict?.materialFacts?currentPositionBalance*(1-C.historyWeight)+historyBalance*C.historyWeight:currentPositionBalance;
      return assessment('WAR_VALUE',{opponentId,atWar:this.support.relationshipStates.get(factionId)?.get(opponentId)==='WAR',ownBorderStrength:own,opponentBorderStrength:enemy,
        currentPositionBalance,continuationBalance,historyBalance,committedHostileEffects:committed.map(e=>({id:e.id,territoryId:e.territoryId,objectiveValid:e.objectiveValid})),
        conflict,territorialTrajectory:conflict?{net:conflict.own.territoriesGained-conflict.own.territoriesLost,recent:conflict.recent.netTerritories,previous:conflict.previous.netTerritories}:null,
        militaryLossTrajectory:conflict?{own:conflict.own.troopsLost,opponent:conflict.opponent.troopsLost,recentOwn:conflict.recent.ownTroopsLost,recentOpponent:conflict.recent.opponentTroopsLost}:null,
        recentMaterialBalance:recent,previousMaterialBalance:previous,trajectoryChange:recent-previous,economicWarPenalty:0,
        limitations:['Observed ledger coverage begins at first recorded fact; no invented earlier history.','Trajectory is recorded consequences, not a forecast; commitment does not guarantee capture.','No generic war-specific economic penalty; attributable conquest forfeitures only.','Siege, destroyed structures and pool losses are reported separately without invented exchange prices.']},
        ['canonical relationship and border forces','keyed current Conflict Ledger episode and bounded material windows','RESOURCE_VALUE support owns forfeited-resource utility inside WAR_VALUE','committed hostile work, no victory assumed'],{...contingentFacts,confidence:'limited'});
    });
  }
}
