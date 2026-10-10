import {bundleEntries} from '../gameplay/trade/resources';
import {TRADE_TUNING} from '../constants/trade';
import {tradeRoute} from '../gameplay/trade/policy';
import {tradeResponseEstimate} from './tradeAssessment';
import { RECRUITMENT_TUNING } from '../constants/recruitment';
import { PEACE_TUNING } from '../constants/peace';
import { counterpartyResponseEstimate, peaceEstimateView } from './peaceAssessment';
import type { GameState } from '../types/GameState';
import type { AISourceContext } from '../types/AIPressure';
import type { ScoredConcretePlan } from '../types';
import { AIConcretePlan, comparePlanIds, concretePlanProblem, planTargetId } from '../types/AIConcretePlan';
import { PlanComparison, PlanContribution, ComparisonCategory, EvaluatorAssessment } from '../types/StrategicEvaluation';
import { STRATEGIC_EVALUATION_TUNING as T } from '../constants/strategicEvaluation';
import { FactualSupport } from './factualSupport';
import { StrategicEvaluators } from './strategicEvaluators';
import { sourceConcretePlans } from '../engine/strategicPressure';
import { attentionCost } from '../engine/strategicAttention';
import {goalPreference} from '../cognition/goals';
import {factionDecisionView} from '../cognition/decisionView';
import {opinionPreference} from '../cognition/opinion';
import { SeededRNG } from '../utils/SeededRNG';

export function saturatingMagnitude(value:number,scale:number):number {
  if(!Number.isFinite(value)||!Number.isFinite(scale)||scale<=0)throw new Error('Invalid comparison fact/normalization');
  return value===0?0:1/(1+scale/Math.abs(value));
}
const categories=():Record<ComparisonCategory,number>=>({source_resolution:0,additional_benefit:0,direct_cost:0,opportunity_cost:0,commitment_burden:0,timeliness:0,realization:0,modifier:0,stabilizer:0});
/** One owner for each semantic consequence within a plan. Fail explicitly on
 * duplicate ownership or non-finite facts rather than silently corrupt scores. */
export function addPlanContribution(contributions:PlanContribution[],causalKey:string,owner:PlanContribution['owner'],category:ComparisonCategory,value:number,explanation:string,confidence:PlanContribution['confidence']='high'):void {
  if(contributions.some(c=>c.causalKey===causalKey))throw new Error(`Duplicate causal contribution ${causalKey}`);
  if(!Number.isFinite(value))throw new Error(`Invalid causal contribution ${causalKey}`);
  contributions.push({causalKey,owner,category,normalizedMagnitude:Math.min(T.contributionBound,Math.abs(value)),direction:value<0?'cost':'benefit',confidence,explanation});
}
/** Pure, source-local comparison. It never calls observer, selects another
 * target or writes scores to canonical state. Legality remains independently
 * owned by the Phase B/C/D feasibility pipeline. */
export class ContextPlanComparator {
  compare(state:GameState,source:AISourceContext,plans:readonly AIConcretePlan[]) {
    const canonical=state.aiPressure.get(source.id);
    if(!canonical||canonical.factionId!==source.factionId||canonical.revision!==source.revision)throw new Error('Stale or unknown comparison source');
    // Complete source-scope authorization, not heuristic target reselection.
    const authorized=new Set(sourceConcretePlans(state,canonical).map(p=>p.id));
    if(plans.length!==authorized.size)throw new Error('Comparison requires the complete bounded source candidate set');
    if(!plans.some(p=>p.action!=='WAIT')||!plans.some(p=>p.action==='WAIT')||plans.some(p=>concretePlanProblem(p)||!authorized.has(p.id)||p.factionId!==canonical.factionId))throw new Error('Comparison requires feasible exact plans and WAIT from one actionable source');
    if(new Set(plans.map(p=>p.id)).size!==plans.length)throw new Error('Duplicate comparison plan');
    const support=new FactualSupport(state),evaluators=new StrategicEvaluators(support);
    const view=factionDecisionView(state,source.factionId);
    const comparisons=[...plans].sort((a,b)=>comparePlanIds(a.id,b.id)).map(p=>this.comparePlan(state,canonical,p,evaluators,view));
    return {comparisons,evaluatorCalls:{...evaluators.calls},cacheHits:evaluators.cacheHits};
  }
  private comparePlan(state:GameState,source:AISourceContext,plan:AIConcretePlan,evaluators:StrategicEvaluators,view:ReturnType<typeof factionDecisionView>):PlanComparison {
    const contributions:PlanContribution[]=[],assessments:EvaluatorAssessment[]=[];
    const add=(causalKey:string,owner:PlanContribution['owner'],category:ComparisonCategory,value:number,explanation:string,confidence:PlanContribution['confidence']='high')=>{
      addPlanContribution(contributions,causalKey,owner,category,value,explanation,confidence);
    };
    const signed=(x:number,scale:number,weight:number)=>Math.sign(x)*saturatingMagnitude(x,scale)*weight;
    let downside=0;let goalIds:string[]=[];
    if(plan.action==='ATTACK') {
      const battle=evaluators.battleOutlook(plan.armyId,plan.targetTerritoryId);
      const territory=evaluators.territoryValue(plan.factionId,plan.targetTerritoryId);
      assessments.push(battle,territory);
      add('engagement:advantage','BATTLE_OUTLOOK','source_resolution',battle.facts.relativeAdvantage*T.battleWeight,'Specified force combat advantage, not territory worth','bounded');
      add('control:target','TERRITORY_VALUE','additional_benefit',saturatingMagnitude(territory.facts.utility,T.territoryScale)*T.territoryWeight,'Value of contingent additional control; capture is not baseline','bounded');
      downside=battle.uncertainty.realizationStructure==='deterministic'?0:(1-battle.facts.relativeAdvantage)/2;
      add('battle:contingency','BATTLE_OUTLOOK','realization',-downside*T.uncertaintyWeight,'Loss/held branches; no invented probability','bounded');
      const origin=evaluators.forcePositionValue(plan.factionId,plan.armyId,plan.stagingTerritoryId,plan.originTerritoryId);
      assessments.push(origin);
      add('origin:coverage','FORCE_POSITION_VALUE','opportunity_cost',-saturatingMagnitude(origin.facts.originOpportunityCost,T.powerScale)*T.positionWeight,'Real coverage lost by staging');
      // Only march-to-staging is physical travel. Never assign movement time
      // to the engagement edge or peek at future invasion response duration.
      const march=plan.originTerritoryId===plan.stagingTerritoryId?0:evaluators.support.logistics(plan.route.slice(0,-1)).timing.remainingTicks;
      add('initiation:time','TIMING_SUPPORT','timeliness',-saturatingMagnitude(march,T.timingScaleTicks)*T.timingWeight,'Authored staging travel only; engagement resolution is contingent');
    } else if(plan.action==='MOVE'||plan.action==='RETREAT') {
      const dest=plan.action==='MOVE'?plan.destinationTerritoryId:plan.fallbackTerritoryId;
      const position=evaluators.forcePositionValue(plan.factionId,plan.armyId,dest,plan.originTerritoryId);
      const time=evaluators.support.logistics(plan.route).timing;
      const before=evaluators.localDanger(plan.factionId,plan.originTerritoryId),after=evaluators.localDanger(plan.factionId,dest,undefined,plan.armyId,time.remainingTicks);
      assessments.push(position,before,after);
      add('position:marginal_gain','FORCE_POSITION_VALUE','source_resolution',saturatingMagnitude(position.facts.additionalUtility,T.powerScale)*T.positionWeight,'Marginal defense/access/response gain; committed friendly work remains');
      add('position:origin_loss','FORCE_POSITION_VALUE','opportunity_cost',-saturatingMagnitude(position.facts.originOpportunityCost,T.powerScale)*T.positionWeight,'Origin opportunity loss (not charged again as destination gain)');
      add('force:exposure_change','LOCAL_DANGER','additional_benefit',signed(before.facts.dangerRatio-after.facts.dangerRatio,1,T.dangerWeight),'Changed exposure of this force; territory importance excluded','bounded');
      add('initiation:time','TIMING_SUPPORT','timeliness',-saturatingMagnitude(time.remainingTicks,T.timingScaleTicks)*T.timingWeight,'Authoritative exact route travel bounds');
      downside=after.facts.dangerRatio;
    } else if(plan.action==='REINFORCE') {
      const allocation=evaluators.localAllocationValue(plan,source.kind==='HOSTILE_OPPORTUNITY'?source.subjectId:undefined);assessments.push(allocation);
      add('allocation:local_effect','FORCE_POSITION_VALUE','source_resolution',saturatingMagnitude(allocation.facts.additionalUtility,T.powerScale)*T.positionWeight,'Marginal exact local defensive/offensive capacity; no new troops','bounded');
      add('allocation:pool_flexibility','FORCE_POSITION_VALUE','opportunity_cost',-allocation.facts.consumedFraction*RECRUITMENT_TUNING.reserveFlexibilityWeight,'Exact consumed local reserve fraction; one owner for foregone local use');
      downside=0; // Uncertain hostile timing is not a fabricated loss probability.
    } else if(plan.action==='OFFER_PEACE') {
      const war=evaluators.warValue(plan.factionId,plan.counterpartyId);assessments.push(war);
      const estimate=counterpartyResponseEstimate(peaceEstimateView(state,plan.factionId,plan.counterpartyId));
      add('war:continuation_avoided','WAR_VALUE','source_resolution',-war.facts.continuationBalance*PEACE_TUNING.warPositionWeight,'Opponent-specific factual position and material trajectory; no exhaustion resource','limited');
      add('proposal:external_choice','WAR_VALUE','realization',-T.uncertaintyWeight,estimate.limitations.join(' '),'limited');
      downside=Math.max(0,war.facts.continuationBalance);
     } else if(plan.action==='TRADE') {
      let gain=0,loss=0;
      for(const [r,n]of bundleEntries(plan.requested)){const a=evaluators.resourceValue(plan.factionId,r,n,'gain');assessments.push(a);gain+=a.facts.marginalUtility;}
      for(const [r,n]of bundleEntries(plan.offered)){const a=evaluators.resourceValue(plan.factionId,r,n,'loss');assessments.push(a);loss+=a.facts.marginalUtility;}
      add('trade:requested_gain','RESOURCE_VALUE','source_resolution',saturatingMagnitude(gain,T.resourceScale)*TRADE_TUNING.resourceWeight,'Exact requested marginal resource gain');
      add('trade:offered_loss','RESOURCE_VALUE','direct_cost',-saturatingMagnitude(loss,T.resourceScale)*TRADE_TUNING.resourceWeight,'Exact offered marginal resource loss, sole owner');
      const estimate=tradeResponseEstimate({offered:plan.offered,requested:plan.requested});
      add('trade:external_choice','RESOURCE_VALUE','realization',-T.uncertaintyWeight,estimate.limitations.join(' '),'limited');
      const d=plan.delivery!,route=tradeRoute(state,d.recipientTerritoryId,d.proposerTerritoryId);
      add('trade:receipt_timing','TIMING_SUPPORT','timeliness',route?-saturatingMagnitude(evaluators.support.logistics(route).timing.remainingTicks,T.timingScaleTicks)*T.timingWeight:-T.timingWeight,'Exact receiving-route authoritative duration; no extra logistics bonus','bounded');
      downside=route?0:1;
    } else if(plan.action==='BUILD') {
      const build=evaluators.buildValue(plan);assessments.push(build);
      add('build:additional_effect','BUILD_VALUE','source_resolution',saturatingMagnitude(build.facts.additionalBenefit,1)*T.buildBenefitWeight,'Exact authored additional output/defense/capability over committed build baseline',build.uncertainty.confidence);
      add('build:funding','BUILD_VALUE','direct_cost',-saturatingMagnitude(build.facts.directCost,T.resourceScale)*T.buildCostWeight,'RESOURCE_VALUE consumed inside BUILD_VALUE, never independently re-added');
      add('build:exposed_investment','BUILD_VALUE','realization',-build.facts.exposure*T.uncertaintyWeight,'LOCAL_DANGER consumed inside BUILD_VALUE, not added twice','bounded');
      add('initiation:time','TIMING_SUPPORT','timeliness',-saturatingMagnitude(build.facts.timing.remainingTicks,T.timingScaleTicks)*T.timingWeight,'Authored construction duration; existing sampled work not rerolled');
      downside=build.facts.exposure;
    } else if(plan.action!=='WAIT')throw new Error('Unexpected action outside current comparator contract');
    if(plan.action!=='WAIT') {
      add('capacity:attention','ATTENTION_BURDEN','commitment_burden',-saturatingMagnitude(attentionCost(plan),Math.max(1,state.strategicAttention.capacity))*T.attentionWeight,'Additional management occupancy only, not physical cost');
      const faction=state.factions.get(plan.factionId)!;
      const goal=goalPreference(state,plan.factionId,plan,T.modifierBound);goalIds=goal.goalIds;
      add('preference:goal','GOAL_MODIFIER','modifier',goal.value,JSON.stringify(goal.assessments));
      if(plan.action==='ATTACK'||plan.action==='OFFER_PEACE'||plan.action==='TRADE'){
        const other=plan.action==='ATTACK'?state.territories.get(plan.targetTerritoryId)?.owner:plan.counterpartyId;
        const opinion=other?view.own.opinions.get(other)??0:0;
        add('preference:opinion','OPINION_MODIFIER','modifier',opinionPreference(opinion,plan.action),`Own directed Opinion of ${other}: ${opinion}`);
      }
      add('preference:risk','RISK_MODIFIER','modifier',-Math.max(0,Math.min(1,1-faction.personality.riskTolerance))*downside*T.modifierBound,'Current risk tolerance interprets downside; factual outlook unchanged','bounded');
      // Ambition, generic action personality, raw Memory and old
      // action-level repetition have no truthful exact-plan migration here.
      // Slots remain separate; lifecycle/model redesign is deferred.
    }
    const sums=categories();
    const modifierSum=contributions.filter(c=>c.category==='modifier').reduce((n,c)=>n+(c.direction==='cost'?-1:1)*c.normalizedMagnitude,0);
    if(Math.abs(modifierSum)>T.modifierStackBound)for(const c of contributions)if(c.category==='modifier') {
      c.normalizedMagnitude*=T.modifierStackBound/Math.abs(modifierSum);
      c.explanation+=' (bounded modifier-stack scaling)';
    }
    for(const c of contributions)sums[c.category]+=(c.direction==='cost'?-1:1)*c.normalizedMagnitude;
    const factualValue=sums.source_resolution+sums.additional_benefit+sums.direct_cost+sums.opportunity_cost+sums.commitment_burden+sums.timeliness+sums.realization;
    const modifierValue=Math.max(-T.modifierStackBound,Math.min(T.modifierStackBound,sums.modifier));
    const finalValue=Math.max(-T.comparisonBound,Math.min(T.comparisonBound,factualValue+modifierValue+sums.stabilizer));
    return {sourceContextId:source.id,plan,assessments,contributions,categories:sums,factualValue,modifierValue,stabilizerValue:sums.stabilizer,
      finalValue,qualifies:plan.action==='WAIT'||factualValue>0&&finalValue>=T.minimumCommitmentAdvantage,baseline:'CURRENT_STATE_PLUS_COMMITTED_EFFECTS',goalIds};
  }
}
/** RNG only sees already-qualified bounded near ties. An inferior/sub-threshold
 * candidate cannot be rescued. WAIT is exactly zero, not a patience reward. */
export function selectContextComparison(comparisons:readonly PlanComparison[],rng:SeededRNG) {
  if(new Set(comparisons.map(c=>c.sourceContextId)).size!==1)throw new Error('Cannot compare unrelated source contexts');
  if(comparisons.some(c=>!Number.isFinite(c.finalValue))||new Set(comparisons.map(c=>c.plan.id)).size!==comparisons.length)throw new Error('Invalid comparison scores or duplicate plans');
  const wait=comparisons.find(c=>c.plan.action==='WAIT');
  if(!wait)throw new Error('Missing WAIT baseline');
  if(wait.finalValue!==0||comparisons.filter(c=>c.plan.action==='WAIT').length!==1)throw new Error('Invalid no-additional-commitment WAIT baseline');
  const sorted=[...comparisons].sort((a,b)=>b.finalValue-a.finalValue||comparePlanIds(a.plan.id,b.plan.id));
  const qualified=sorted.filter(c=>c.plan.action!=='WAIT'&&c.qualifies&&c.finalValue>=wait.finalValue+T.minimumCommitmentAdvantage);
  const near=qualified.filter(c=>c.finalValue>=qualified[0]!.finalValue-T.nearTieBand);
  const draw=near.length>1?rng.next():null;
  const selected=near.length===0?wait:near.length===1?near[0]!:near[Math.floor(draw!*near.length)]!;
  const resolution={waitValue:wait.finalValue,minimumCommitmentAdvantage:T.minimumCommitmentAdvantage,nearTieBand:T.nearTieBand,
    qualifiedPlanIds:qualified.map(c=>c.plan.id),nearTiePlanIds:near.map(c=>c.plan.id),draw,selectedPlanId:selected.plan.id};
  return {selected,alternatives:sorted.filter(c=>c.plan.id!==selected.plan.id),confidence:near.length>1?1/near.length:1,resolution};
}
export function comparisonScoredPlan(c:PlanComparison):ScoredConcretePlan {
  return {plan:c.plan,action:c.plan.action,targetId:planTargetId(c.plan),targetName:planTargetId(c.plan),score:c.finalValue,baseScore:c.factualValue,
    factorBreakdown:c.contributions.map(x=>({factor:`${x.owner}:${x.causalKey}`,weight:1,contribution:(x.direction==='cost'?-1:1)*x.normalizedMagnitude})),
    reasoning:c.contributions.map(x=>`${x.owner}: ${x.explanation}`)};
}
