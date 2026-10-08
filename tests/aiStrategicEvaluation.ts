import assert from 'assert';
import type { GameState } from '../src/types/GameState';
import { STRATEGIC_EVALUATORS } from '../src/types/StrategicEvaluation';
import type { PlanComparison, PlanContribution } from '../src/types/StrategicEvaluation';
import { makeConcretePlan, AIConcretePlan } from '../src/types/AIConcretePlan';
import { STRATEGIC_EVALUATION_TUNING as T } from '../src/constants/strategicEvaluation';
import { FactualSupport, sampledActivityTiming, unsampledTimingBounds } from '../src/scoring/factualSupport';
import { StrategicEvaluators } from '../src/scoring/strategicEvaluators';
import { ContextPlanComparator, selectContextComparison, saturatingMagnitude, addPlanContribution } from '../src/scoring/contextPlanComparison';
import { BattleEngine } from '../src/battle/BattleEngine';
import { createActiveInvasion } from '../src/types/GameState';
import { observeSources, sourceConcretePlans } from '../src/engine/strategicPressure';
import { cloneGameState } from '../src/state/cloneGameState';
import { makeOperationTestWorld } from './aiOperationFixtures';
import { hydratePersistedPayload } from '../src/persistence/hydrate';
import { encodePersistable } from '../src/persistence/serialization';
import { SeededRNG } from '../src/utils/SeededRNG';
import { Orchestrator, createDefaultRegistry } from '../src/orchestration';
import { accrueWorldThroughReceipt } from '../src/world/worldAccrual';
import { catchUpWorld } from '../src/world/catchup';
import { getCommandDefinition } from '../src/orchestration/commandIndex';
import { constructionCostEntries, getConstructionProjectDefinition } from '../src/gameplay/construction/definitions';
import { primeSourceDecision } from './aiPressureFixtures';
import { ActionScorer } from '../src/scoring/ActionScorer';
import { DecisionEngine } from '../src/engine/DecisionEngine';
import { buildWarlordStates, toDecisionEngineSnapshot } from '../src/state/gameStateAdapters';
import { checkGameStateInvariants } from '../src/state/gameStateInvariants';
import { startProactiveTimer, accrueProactiveClocks } from '../src/engine/proactiveCognition';
type Api=Pick<Parameters<typeof import('./aiStrategicPressure').registerAiStrategicPressureTests>[0],'test'|'makeSelf'|'makeTerritory'|'cmdReq'>;
export function registerAiStrategicEvaluationTests({test,makeSelf,makeTerritory,cmdReq}:Api):void {
  const world=()=>{
    const s=makeOperationTestWorld(makeSelf,makeTerritory);s.worldLevel=2;
    s.factions.get('me')!.diplomacy.set('enemy',{target:'enemy',state:'at_war',opinion:0,treaties:[],yearsAtPeace:0,yearsAtWar:1});
    return s;
  };
  const evaluator=(s:GameState)=>new StrategicEvaluators(new FactualSupport(s));
  const build=(s:GameState)=>makeConcretePlan({action:'BUILD',factionId:'me',territoryId:'home',projectType:'FARM',resourceSource:{kind:'faction_stock',factionId:'me',resources:Object.fromEntries(constructionCostEntries(getConstructionProjectDefinition('FARM').cost).map(c=>[c.resource,c.amount]))}});
  const allFacts=(s:GameState)=>{
    const e=evaluator(s),p=build(s);assert.ok(p.action==='BUILD');return [e.battleOutlook('a','target'),e.territoryValue('me','target'),e.localDanger('me','home'),e.forcePositionValue('me','a','stage','home'),e.resourceValue('me','food',5,'loss'),e.buildValue(p),e.warValue('me','enemy')];
  };
  const military=(s:GameState)=>{observeSources(s,'me');const c=[...s.aiPressure.values()].find(c=>c.kind==='HOSTILE_OPPORTUNITY')!;assert.ok(c);return c;};
  const compare=(s:GameState)=>{const c=military(s);return new ContextPlanComparator().compare(s,c,sourceConcretePlans(s,c));};
  const goal=()=>({id:'g',type:'destroy_rival' as const,priority:100,targetFaction:'enemy',targetTerritory:'target',targetRegion:null,targetResource:null,progress:0,targetProgress:1,deadlineTurn:null,createdTurn:0});
  const stageThreatTravel=(s:GameState)=>{s.territories.set('rear',makeTerritory({id:'rear',owner:'enemy',neighboring:['target','stage'],garrison:0}));s.territories.get('target')!.neighboring.push('rear');s.territories.get('stage')!.neighboring.push('rear');s.factions.get('enemy')!.territories.push('rear');s.armies.get('threat')!.movement={originTerritoryId:'target',destinationTerritoryId:'rear',startedAtTick:0,durationTicks:17,status:'moving',commitmentId:null};};
  test('Phase F: exact seven factual evaluator identities',()=>assert.deepStrictEqual(STRATEGIC_EVALUATORS,['BATTLE_OUTLOOK','TERRITORY_VALUE','LOCAL_DANGER','FORCE_POSITION_VALUE','RESOURCE_VALUE','BUILD_VALUE','WAR_VALUE']));
  test('Phase F: Goal changes leave all seven factual outputs unchanged',()=>{const s=world(),before=allFacts(s);s.factions.get('me')!.goals=[goal()];assert.deepStrictEqual(allFacts(s),before);});
  test('Phase F: Personality and Ambition changes leave factual outputs unchanged',()=>{const s=world(),before=allFacts(s);s.factions.get('me')!.ambition=1;for(const k of ['aggression','defensiveness','economics','riskTolerance'] as const)s.factions.get('me')!.personality[k]=1;assert.deepStrictEqual(allFacts(s),before);});
  test('Phase F: raw Memory and Opinion never change factual outputs',()=>{const s=world(),before=allFacts(s);s.factions.get('me')!.memory=[{id:'m',type:'action_failed',withFaction:'enemy',territory:'target',turn:0,magnitude:100,details:{}}];s.factions.get('me')!.diplomacy.get('enemy')!.opinion=-100;assert.deepStrictEqual(allFacts(s),before);});
  test('Phase F: Goal has one bounded separate comparison owner',()=>{const s=world(),before=compare(s).comparisons;s.factions.get('me')!.goals=[goal()];const after=compare(s).comparisons;const a=before.find(p=>p.plan.action==='ATTACK')!,b=after.find(p=>p.plan.id===a.plan.id)!;assert.deepStrictEqual(a.assessments,b.assessments);assert.notStrictEqual(a.modifierValue,b.modifierValue);assert.strictEqual(b.contributions.filter(c=>c.owner==='GOAL_MODIFIER').length,1);assert.ok(Math.abs(b.modifierValue)<=T.modifierStackBound);});
  test('Phase F: Ambition alone gives no generic ATTACK push',()=>{const s=world(),a=compare(s);s.factions.get('me')!.ambition=1;assert.deepStrictEqual(compare(s),a);});
  test('Phase F: pressure magnitude never changes evaluator or comparison output',()=>{const s=world(),before=compare(s);for(const c of s.aiPressure.values())c.pressure=99999;assert.deepStrictEqual(compare(s),before);});
  test('Phase F: deterministic Battle outlook excludes territory importance and battle seed',()=>{const s=world(),before=evaluator(s).battleOutlook('a','target');s.worldSeed++;s.territories.get('target')!.baseValue+=10000;s.territories.get('target')!.resourceOutput={gold:9000};assert.deepStrictEqual(evaluator(s).battleOutlook('a','target'),before);});
  test('Phase F: Battle outlook uses authoritative terrain/morale/fort/city facts',()=>{const s=world();const a=evaluator(s).battleOutlook('a','target');s.territories.get('target')!.fortification++;s.armies.get('a')!.morale=20;const b=evaluator(s).battleOutlook('a','target');assert.ok(b.facts.defenderEffectiveStrength>a.facts.defenderEffectiveStrength);assert.ok(b.facts.attackerEffectiveStrength<a.facts.attackerEffectiveStrength);});
  test('Phase F: losing battle branch correctly admits force annihilation',()=>{const s=world(),b=evaluator(s).battleOutlook('a','target');assert.deepStrictEqual(b.facts.lossSeverity.attackerDefeat,[1,1]);assert.strictEqual(b.uncertainty.realizationStructure,'contingent');});
  test('Phase F: Territory value responds to actual output/infrastructure/connectivity',()=>{const s=world(),a=evaluator(s).territoryValue('me','target');s.territories.get('target')!.resourceOutput={food:20};s.territories.get('target')!.fortification++;s.territories.get('target')!.neighboring.push('home');assert.ok(evaluator(s).territoryValue('me','target').facts.utility>a.facts.utility);});
  test('Phase F: Local danger excludes strategic territory importance',()=>{const s=world(),a=evaluator(s).localDanger('me','stage');s.territories.get('stage')!.baseValue=99999;s.territories.get('stage')!.resourceOutput={gold:99999};assert.deepStrictEqual(evaluator(s).localDanger('me','stage'),a);});
  const addThreat=(s:GameState)=>{s.armies.set('threat',{id:'threat',owner:'enemy',location:'target',soldiers:500,knights:0,siegeEngines:0,morale:80,supply:80});s.factions.get('enemy')!.armies.push('threat');};
  test('Phase F: credible hostile force changes local danger and timing',()=>{const s=world(),a=evaluator(s).localDanger('me','stage');addThreat(s);const b=evaluator(s).localDanger('me','stage');assert.ok(b.facts.hostilePower>a.facts.hostilePower);assert.ok(b.facts.earliestThreatTicks!==null);});
  test('Phase F: overlapping intent/operation/route deduplicates hostile force',()=>{const s=world();addThreat(s);s.armies.get('threat')!.attackIntent={targetTerritoryId:'stage',stagingTerritoryId:'target',status:'ready',createdAtTick:0,commitmentId:null,battleSeed:9000};const b=evaluator(s).localDanger('me','stage');assert.deepStrictEqual(b.facts.hostileForceIds,['threat']);assert.strictEqual(b.facts.committedThreats,1);});
  test('Phase F: committed support counts only if arriving before threat',()=>{const s=world();addThreat(s);stageThreatTravel(s);s.armies.get('a')!.movement={originTerritoryId:'home',destinationTerritoryId:'stage',startedAtTick:0,durationTicks:1,status:'moving',commitmentId:null};const a=evaluator(s).localDanger('me','stage');s.armies.get('a')!.movement!.durationTicks=100;const b=evaluator(s).localDanger('me','stage');assert.ok(a.facts.defensePower>b.facts.defensePower);});
  test('Phase F: Force position is marginal and locations differ for same army',()=>{const s=world();addThreat(s);const e=evaluator(s),a=e.forcePositionValue('me','a','home','home'),b=e.forcePositionValue('me','a','stage','home');assert.strictEqual(a.facts.marginalUtility,0);assert.notStrictEqual(b.facts.marginalUtility,0);});
  test('Phase F: redundant force size is not an unconditional position reward',()=>{const s=world();s.factions.get('me')!.diplomacy.clear();const a=evaluator(s).forcePositionValue('me','a','other','home');s.armies.get('a')!.soldiers*=100;assert.deepStrictEqual(evaluator(s).forcePositionValue('me','a','other','home'),a);});
  test('Phase F: Resource marginal value is quantity-sensitive and scarce loss asymmetric',()=>{const s=world();s.factions.get('me')!.resources.food=2;const e=evaluator(s);assert.ok(e.resourceValue('me','food',2,'gain').facts.marginalUtility>e.resourceValue('me','food',1,'gain').facts.marginalUtility);assert.notStrictEqual(e.resourceValue('me','food',2,'loss').facts.marginalUtility,e.resourceValue('me','food',2,'gain').facts.marginalUtility);});
  test('Phase F: abundant stocks reduce marginal resource cost',()=>{const s=world();s.factions.get('me')!.resources.gold=30;const a=evaluator(s).resourceValue('me','gold',20,'loss');s.factions.get('me')!.resources.gold=10000;assert.ok(a.facts.marginalUtility>evaluator(s).resourceValue('me','gold',20,'loss').facts.marginalUtility);});
  test('Phase F: uncollected production is not equivalent to spendable bank',()=>{const s=world(),e=evaluator(s);assert.strictEqual(e.resourceValue('me','gold',20,'gain','home','uncollected').facts.marginalUtility,0);assert.ok(e.resourceValue('me','gold',20,'gain','home','bank').facts.marginalUtility>0);});
  test('Phase F: different owned sites do not invent separate bank stockpiles',()=>{const s=world(),e=evaluator(s);assert.strictEqual(e.resourceValue('me','gold',20,'loss','home').facts.marginalUtility,e.resourceValue('me','gold',20,'loss','stage').facts.marginalUtility);});
  test('Phase F: exact BUILD site/output/cost/duration determine factual value',()=>{const s=world();s.territories.get('home')!.resourceOutput={food:5};const p=build(s);assert.ok(p.action==='BUILD');const a=evaluator(s).buildValue(p);s.territories.get('home')!.resourceOutput={food:10};const b=evaluator(s).buildValue(p);assert.ok(b.facts.additionalBenefit>a.facts.additionalBenefit);assert.strictEqual(a.facts.timing.remainingTicks,getConstructionProjectDefinition('FARM').durationTicks);assert.deepStrictEqual(a.facts.costs.map(c=>[c.resource,c.amount]),constructionCostEntries(getConstructionProjectDefinition('FARM').cost).map(c=>[c.resource,c.amount]));});
  test('Phase F: committed BUILD is baseline and paid costs not subtracted twice',()=>{const s=world();s.territories.get('home')!.resourceOutput={food:5};const p=build(s);assert.ok(p.action==='BUILD');const o=new Orchestrator(s);assert.ok(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:p})).success);const live=o.getState(),b=evaluator(live).buildValue(p);assert.strictEqual(b.facts.additionalBenefit,0);assert.strictEqual(b.facts.alreadyCommitted,true);const support=new FactualSupport(live);assert.strictEqual(support.territories.get('home')!.projectedOutput.food,7.5);assert.strictEqual(support.resourceFacts('me','gold').holdings,live.factions.get('me')!.resources.gold);assert.strictEqual(support.resourceFacts('me','gold').committedCostsAlreadyPaid,30);});
  test('Phase F: committed movement remains baseline instead of vanishing',()=>{const s=world();addThreat(s);stageThreatTravel(s);const before=evaluator(s).forcePositionValue('me','a','stage','home');s.armies.get('b')!.movement={originTerritoryId:'home',destinationTerritoryId:'stage',startedAtTick:0,durationTicks:1,status:'moving',commitmentId:null};const after=evaluator(s).forcePositionValue('me','a','stage','home');assert.ok(after.facts.destination.coverage<before.facts.destination.coverage);});
  test('Phase F: ATTACK contingent baseline never fabricates captured ownership',()=>{const s=world();s.armies.get('a')!.attackIntent={targetTerritoryId:'target',stagingTerritoryId:'stage',createdAtTick:0,status:'ready',commitmentId:null,battleSeed:10};const support=new FactualSupport(s);assert.strictEqual(support.territories.get('target')!.owner,'enemy');assert.ok(support.committed.some(e=>e.id==='attack:a'&&e.classification==='contingent_execution'));});
  test('Phase F: WAR facts change with actual border position; no Memory ledger invented',()=>{const s=world(),a=evaluator(s).warValue('me','enemy');addThreat(s);const b=evaluator(s).warValue('me','enemy');assert.notStrictEqual(a.facts.currentPositionBalance,b.facts.currentPositionBalance);assert.strictEqual(b.facts.economicWarPenalty,0);assert.strictEqual(b.facts.territorialTrajectory,null);assert.strictEqual(b.facts.militaryLossTrajectory,null);});
  test('Phase F: active physical duration uses persisted progress, never rerolls',()=>{const s=world();s.armies.get('a')!.movement={originTerritoryId:'home',destinationTerritoryId:'stage',startedAtTick:0,durationTicks:17,status:'moving',commitmentId:null};s.worldTick=5;const t=new FactualSupport(s).committed.find(e=>e.id==='movement:a')!.timing;assert.strictEqual(t.remainingTicks,12);assert.strictEqual(t.progressTicks,5);assert.deepStrictEqual(t.remainingOnlineMs,[720000,720000]);assert.deepStrictEqual(t.remainingOfflineMs,[7200000,7200000]);});
  test('Phase F: blocked physical timing remains unknown, not zero-time recovery',()=>{const s=world();s.armies.get('a')!.movement={originTerritoryId:'home',destinationTerritoryId:'stage',startedAtTick:0,durationTicks:17,status:'blocked',haltedAtTick:5,commitmentId:null};const t=new FactualSupport(s).committed[0]!.timing;assert.strictEqual(t.remainingTicks,12);assert.strictEqual(t.remainingOnlineMs,null);assert.strictEqual(t.certainty,'blocked');});
  test('Phase F: BUILD cost causal contribution appears exactly once',()=>{const s=world();s.territories.get('home')!.resourceOutput={food:5};s.factions.get('me')!.resources.food=0;observeSources(s,'me');const c=[...s.aiPressure.values()].find(c=>c.domain==='DEVELOPMENT')!;const r=new ContextPlanComparator().compare(s,c,sourceConcretePlans(s,c));const b=r.comparisons.find(p=>p.plan.action==='BUILD')!;assert.strictEqual(b.contributions.filter(x=>x.causalKey==='build:funding').length,1);assert.ok(!b.contributions.some(x=>x.owner==='RESOURCE_VALUE'||x.owner==='LOCAL_DANGER'));assert.strictEqual(new Set(b.contributions.map(x=>x.causalKey)).size,b.contributions.length);});
  test('Phase F: comparator refuses plans from an unrelated source',()=>{const s=world(),c=military(s),plans=sourceConcretePlans(s,c);assert.throws(()=>new ContextPlanComparator().compare(s,c,[...plans,build(s)]));});
  test('Phase F: WAIT comparison is exactly zero with no fabricated reward',()=>{const s=world(),r=compare(s),wait=r.comparisons.find(c=>c.plan.action==='WAIT')!;assert.strictEqual(wait.finalValue,0);assert.deepStrictEqual(wait.assessments,[]);assert.deepStrictEqual(wait.contributions,[]);assert.strictEqual(wait.baseline,'CURRENT_STATE_PLUS_COMMITTED_EFFECTS');});
  const synthetic=(base:PlanComparison,value:number):PlanComparison=>({...base,finalValue:value,factualValue:value,qualifies:value>=T.minimumCommitmentAdvantage});
  test('Phase F: below-margin option cannot defeat WAIT even with RNG',()=>{const s=world(),r=compare(s).comparisons,wait=r.find(c=>c.plan.action==='WAIT')!,a=r.find(c=>c.plan.action!=='WAIT')!;for(let seed=0;seed<20;seed++)assert.strictEqual(selectContextComparison([wait,synthetic(a,T.minimumCommitmentAdvantage/2)],new SeededRNG(seed)).selected.plan.action,'WAIT');});
  test('Phase F: meaningful commitment advantage can select exact plan',()=>{const s=world(),r=compare(s).comparisons,wait=r.find(c=>c.plan.action==='WAIT')!,a=r.find(c=>c.plan.action!=='WAIT')!;assert.strictEqual(selectContextComparison([wait,synthetic(a,T.minimumCommitmentAdvantage+1)],new SeededRNG(1)).selected.plan.id,a.plan.id);});
  test('Phase F: near tie seeded selection deterministic and inferior never wins',()=>{const r=compare(world()).comparisons,wait=r.find(c=>c.plan.action==='WAIT')!,p=r.filter(c=>c.plan.action!=='WAIT');assert.ok(p.length>=3);const fixture=[wait,synthetic(p[0]!,30),synthetic(p[1]!,30-T.nearTieBand/2),synthetic(p[2]!,5)];const chosen=new Set<string>();for(let i=0;i<30;i++){const a=selectContextComparison(fixture,new SeededRNG(i));assert.strictEqual(a.selected.plan.id,selectContextComparison(fixture,new SeededRNG(i)).selected.plan.id);assert.notStrictEqual(a.selected.plan.id,p[2]!.plan.id);chosen.add(a.selected.plan.id);}assert.ok(chosen.size>1);});
  test('Phase F: normalization bounded for enormous factual values',()=>{assert.ok(saturatingMagnitude(Number.MAX_SAFE_INTEGER,T.powerScale)<=1);assert.strictEqual(saturatingMagnitude(0,T.powerScale),0);assert.throws(()=>saturatingMagnitude(Infinity,1));for(const c of compare(world()).comparisons){assert.ok(Math.abs(c.finalValue)<=T.comparisonBound);assert.ok(c.contributions.every(c=>c.normalizedMagnitude<=T.contributionBound));}});
  test('Phase F: save/reload and reversed Maps preserve factual evaluation/comparison',()=>{const s=world();military(s);const loaded=hydratePersistedPayload(encodePersistable(s));assert.deepStrictEqual(allFacts(loaded),allFacts(s));assert.deepStrictEqual(compare(loaded),compare(s));const rev=cloneGameState(s);rev.armies=new Map([...rev.armies].reverse());rev.territories=new Map([...rev.territories].reverse());rev.factions=new Map([...rev.factions].reverse());assert.deepStrictEqual(compare(rev),compare(s));});
  test('Phase F: evaluating/comparing changes no canonical state or RNG',()=>{const s=world();military(s);const before=encodePersistable(s);const next=SeededRNG.prototype.next;SeededRNG.prototype.next=()=>{throw new Error('future RNG peek');};try{allFacts(s);compare(s);}finally{SeededRNG.prototype.next=next;}assert.deepStrictEqual(encodePersistable(s),before);});
  test('Phase F: within-decision memo reuses facts with clear evaluator identity',()=>{const s=world(),e=evaluator(s);const a=e.battleOutlook('a','target'),b=e.battleOutlook('a','target');assert.strictEqual(a,b);assert.strictEqual(e.calls.BATTLE_OUTLOOK,1);assert.strictEqual(e.cacheHits,1);assert.ok(compare(s).cacheHits>0);});
  test('Phase F: canonical production ignores legacy ActionScorer entirely',()=>{const s=world();primeSourceDecision(s,'me');const old=ActionScorer.prototype.scorePlans;ActionScorer.prototype.scorePlans=()=>{throw new Error('legacy production scoring');};try{const o=new Orchestrator(s),r=o.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'}));assert.ok(r.success);assert.ok((r.payload.selectedOperationIds as string[]).length===1);assert.deepStrictEqual(checkGameStateInvariants(o.getState()),[]);}finally{ActionScorer.prototype.scorePlans=old;}});
  test('Phase F: empty or blocked sources never run factual comparison',()=>{const s=world();s.strategicAttention.capacity=0;const old=ContextPlanComparator.prototype.compare;ContextPlanComparator.prototype.compare=()=>{throw new Error('blocked source evaluated');};try{const o=new Orchestrator(s);for(let i=0;i<20;i++)assert.ok(o.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'})).success);assert.strictEqual(o.getState().operations.size,0);}finally{ContextPlanComparator.prototype.compare=old;}});
  test('Phase F: unsampled future durations remain bounds without consuming RNG',()=>{const next=SeededRNG.prototype.next;SeededRNG.prototype.next=()=>{throw new Error('sample during score');};try{assert.deepStrictEqual(unsampledTimingBounds([45000,75000],[4500000,7500000]),{sampled:false,remainingOnlineMs:[45000,75000],remainingOfflineMs:[4500000,7500000],confidence:'bounds_only'});}finally{SeededRNG.prototype.next=next;}});
  test('Phase F: persisted sampled activity timing retains earned work and promotion',()=>{const s=world(),timer=startProactiveTimer(s,'me','test',45000,75000,100);s.aiDecisionOpportunities.get('me')!.spacing=timer;accrueProactiveClocks(s,10000,'OFFLINE');const before=sampledActivityTiming(timer,'OFFLINE'),loaded=hydratePersistedPayload(encodePersistable(s));assert.deepStrictEqual(sampledActivityTiming(loaded.aiDecisionOpportunities.get('me')!.spacing!,'OFFLINE'),before);assert.ok(before.remainingOfflineMs>before.remainingOnlineMs);accrueProactiveClocks(s,10001,'ONLINE');const promoted=sampledActivityTiming(timer,'OFFLINE');assert.strictEqual(promoted.remainingOnlineMs,promoted.remainingOfflineMs);});
  test('Phase F: successful WAIT remains an initiation timer through real production comparison',()=>{const s=world();s.territories.get('target')!.garrison=800;s.territories.get('target')!.fortification=5;s.territories.get('target')!.resourceOutput={food:1};primeSourceDecision(s,'me');const o=new Orchestrator(s);const r=o.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'}));assert.ok(r.success);assert.deepStrictEqual(r.payload.selectedOperationIds,[]);assert.strictEqual(o.getState().aiDecisionOpportunities.get('me')!.primary!.phase,'waiting');assert.strictEqual(o.getState().operations.size,0);assert.strictEqual(o.getState().operationClaims.size,0);});
  test('Phase F: no-source observer never runs evaluators or comparison',()=>{const s=world();s.territories.get('target')!.baseValue=0;s.territories.get('target')!.resourceOutput={};const old=ContextPlanComparator.prototype.compare;ContextPlanComparator.prototype.compare=()=>{throw new Error('no-source suite');};try{const o=new Orchestrator(s);for(let i=0;i<20;i++)assert.ok(o.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'})).success);assert.strictEqual(o.getState().aiPressure.size,0);}finally{ContextPlanComparator.prototype.compare=old;}});
  test('Phase F: acquisition does not value destroyed foreign fortifications as retained infrastructure',()=>{const s=world();s.territories.get('target')!.fortification=5;assert.strictEqual(evaluator(s).territoryValue('me','target').facts.infrastructure,0);assert.strictEqual(evaluator(s).territoryValue('enemy','target').facts.infrastructure,5);});
  test('Phase F: unopposed domain capture has no fabricated battle casualties',()=>{const s=world();s.territories.get('target')!.garrison=0;const outlook=evaluator(s).battleOutlook('a','target');assert.strictEqual(outlook.facts.expectedOutcomeBand,'unopposed');assert.deepStrictEqual(outlook.facts.lossSeverity.attackerVictory,[0,0]);assert.strictEqual(outlook.uncertainty.realizationStructure,'deterministic');});
  test('Phase F: private comparison details never enter public game state',()=>{const s=world();primeSourceDecision(s,'me');const o=new Orchestrator(s);assert.ok(o.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'})).success);const result=o.execute(cmdReq('GET_GAME_STATE','p',{}));const text=JSON.stringify(result.payload);assert.ok(result.success);for(const term of ['planComparisonDiagnostics','evaluatorCalls','GOAL_MODIFIER','BATTLE_OUTLOOK','contributions','aiPressure'])assert.ok(!text.includes(term),term);});
  test('Phase F: live canonical cognition cannot fall back to legacy source-free scoring',()=>{const s=world();primeSourceDecision(s,'me');assert.throws(()=>new DecisionEngine(1).decide(buildWarlordStates(s).get('me')!,toDecisionEngineSnapshot(s),s.turn),/requires source-local/);});
  test('Phase F: hostility does not fabricate a canonical WAR relationship',()=>{const s=world();s.factions.get('me')!.diplomacy.get('enemy')!.state='hostile';assert.strictEqual(evaluator(s).warValue('me','enemy').facts.atWar,false);assert.strictEqual(s.factions.get('me')!.diplomacy.get('enemy')!.state,'hostile');});
  test('Phase F review: repeated outlook cannot change the actual seeded battle',()=>{
    const s=world();addThreat(s);
    const input={turn:s.turn,seed:713,battleId:'review_rng',attackerFactionId:'me',defenderFactionId:'enemy',attackerArmies:[s.armies.get('a')!],defenderArmies:[s.armies.get('threat')!],defenderGarrison:s.territories.get('target')!.garrison,territory:s.territories.get('target')!};
    const control=new BattleEngine().resolve(input),e=evaluator(s);
    for(let i=0;i<30;i++)e.battleOutlook('a','target');
    assert.deepStrictEqual(new BattleEngine().resolve(input),control);
  });
  const readyThreat=(s:GameState)=>{addThreat(s);s.armies.get('threat')!.attackIntent={targetTerritoryId:'stage',stagingTerritoryId:'target',status:'ready',createdAtTick:0,commitmentId:null,battleSeed:9000};};
  test('Phase F review: committed engagement edge is not imaginary march time',()=>{
    const s=world();readyThreat(s);
    const d=evaluator(s).localDanger('me','stage');assert.strictEqual(d.facts.earliestThreatTicks,0);
    s.armies.get('a')!.movement={originTerritoryId:'home',destinationTerritoryId:'stage',startedAtTick:0,durationTicks:1,status:'moving',commitmentId:null};
    assert.ok(!evaluator(s).localDanger('me','stage').facts.friendlySupportIds.includes('a'));
  });
  test('Phase F review: proposed defense cannot arrive before its physical route',()=>{
    const s=world();readyThreat(s);const e=evaluator(s);
    const proposed=e.localDanger('me','stage',undefined,'a');
    assert.ok(proposed.facts.proposedSupportArrivalTicks!>0);assert.ok(!proposed.facts.friendlySupportIds.includes('a'));
    assert.strictEqual(e.forcePositionValue('me','a','stage','home').facts.destination.coverage,0);
  });
  test('Phase F review: proposed defense arriving in time can provide coverage',()=>{
    const s=world();addThreat(s);stageThreatTravel(s);const e=evaluator(s),d=e.localDanger('me','stage',undefined,'a');
    assert.ok(d.facts.friendlySupportIds.includes('a'));assert.ok(e.forcePositionValue('me','a','stage','home').facts.destination.coverage>0);
  });
  test('Phase F review: an exact staged threat uses only remaining persisted travel',()=>{
    const s=world();readyThreat(s);s.territories.set('rear',makeTerritory({id:'rear',owner:'enemy',neighboring:['target','stage'],garrison:0}));s.territories.get('target')!.neighboring.push('rear');s.territories.get('stage')!.neighboring.push('rear');s.factions.get('enemy')!.territories.push('rear');s.armies.get('threat')!.attackIntent!.stagingTerritoryId='rear';s.armies.get('threat')!.movement={originTerritoryId:'target',destinationTerritoryId:'rear',startedAtTick:0,durationTicks:17,status:'moving',commitmentId:null};s.worldTick=5;
    assert.strictEqual(evaluator(s).localDanger('me','stage').facts.earliestThreatTicks,12);
  });
  test('Phase F review: direct proposed support at the place remains immediate',()=>{
    const s=world();readyThreat(s);s.armies.get('a')!.location='stage';const d=evaluator(s).localDanger('me','stage',undefined,'a');
    assert.strictEqual(d.facts.proposedSupportArrivalTicks,0);assert.ok(d.facts.friendlySupportIds.includes('a'));
  });
  test('Phase F review: contribution ledger rejects two owners for one consequence',()=>{
    const c:PlanContribution[]=[];addPlanContribution(c,'funding','BUILD_VALUE','direct_cost',-5,'paid once');
    assert.throws(()=>addPlanContribution(c,'funding','RESOURCE_VALUE','direct_cost',-5,'duplicate'),/Duplicate causal/);assert.strictEqual(c.length,1);
    assert.throws(()=>addPlanContribution(c,'invalid','BUILD_VALUE','direct_cost',NaN,'invalid'),/Invalid causal/);assert.strictEqual(c.length,1);
  });
  test('Phase F review: authorized ID cannot disguise altered exact parameters',()=>{
    const s=world(),c=military(s),plans=sourceConcretePlans(s,c),attack=plans.find(p=>p.action==='ATTACK')!;
    assert.ok(attack.action==='ATTACK');const forged={...attack,armyId:'enemy_force'};
    assert.throws(()=>new ContextPlanComparator().compare(s,c,plans.map(p=>p.id===attack.id?forged:p)),/feasible exact plans/);
  });
  test('Phase F review: commitment margin boundary precedes the near-tie pool',()=>{
    const r=compare(world()).comparisons,w=r.find(c=>c.plan.action==='WAIT')!,p=r.filter(c=>c.plan.action!=='WAIT');
    const rng=new SeededRNG(5);rng.next=()=>{throw new Error('below-margin candidate entered RNG');};
    const exact=synthetic(p[0]!,T.minimumCommitmentAdvantage),below=synthetic(p[1]!,T.minimumCommitmentAdvantage-0.001);
    const choice=selectContextComparison([w,below,exact],rng);assert.strictEqual(choice.selected.plan.id,exact.plan.id);assert.deepStrictEqual(choice.resolution.nearTiePlanIds,[exact.plan.id]);assert.strictEqual(choice.resolution.draw,null);
  });
  test('Phase F review: near-tie boundary and stable ordering are exact',()=>{
    const r=compare(world()).comparisons,w=r.find(c=>c.plan.action==='WAIT')!,p=r.filter(c=>c.plan.action!=='WAIT');
    const candidates=[w,synthetic(p[0]!,20),synthetic(p[1]!,20-T.nearTieBand),synthetic(p[2]!,20-T.nearTieBand-0.001)];
    const choice=selectContextComparison(candidates,new SeededRNG(11));assert.strictEqual(choice.resolution.nearTiePlanIds.length,2);assert.ok(!choice.resolution.nearTiePlanIds.includes(p[2]!.plan.id));
    assert.deepStrictEqual(selectContextComparison([...candidates].reverse(),new SeededRNG(11)),choice);
  });
  test('Phase F review: non-finite comparison cannot fall back into WAIT',()=>{
    const r=compare(world()).comparisons;assert.throws(()=>selectContextComparison(r.map((c,i)=>i===0?{...c,finalValue:NaN}:c),new SeededRNG(1)),/Invalid comparison/);
    assert.strictEqual(saturatingMagnitude(Number.MAX_VALUE,Number.MAX_VALUE),0.5);
  });
  test('Phase F review: larger authored BUILD benefit can justify higher cost',()=>{
    const s=world();s.territories.get('home')!.resourceOutput={food:1,iron:100};s.factions.get('me')!.resources.food=0;s.factions.get('me')!.resources.iron=0;observeSources(s,'me');
    const result=(kind:'FARM'|'MINE')=>{const c=[...s.aiPressure.values()].find(c=>c.subjectId==='home'&&c.projectType===kind)!;assert.ok(c);return new ContextPlanComparator().compare(s,c,sourceConcretePlans(s,c)).comparisons.find(p=>p.plan.action==='BUILD')!;};
    const farm=result('FARM'),mine=result('MINE');const f=farm.assessments[0]!.facts,m=mine.assessments[0]!.facts;
    assert.ok(getConstructionProjectDefinition('MINE').cost.gold>getConstructionProjectDefinition('FARM').cost.gold);
    assert.ok((m.additionalBenefit as number)>(f.additionalBenefit as number));assert.ok(mine.finalValue>farm.finalValue);
    assert.strictEqual(mine.assessments[0]!.uncertainty.realizationStructure,'conditional');assert.strictEqual(mine.assessments[0]!.uncertainty.unresolvedExternalChoice,true);
  });
  test('Phase F review: selected source alone reaches production comparison',()=>{
    const s=world();s.territories.get('home')!.resourceOutput={food:5};s.factions.get('me')!.resources.food=0;primeSourceDecision(s,'me');
    const development=[...s.aiPressure.values()].find(c=>c.domain==='DEVELOPMENT')!;development.pressure=100000;
    const seen:string[][]=[],old=ContextPlanComparator.prototype.compare;
    ContextPlanComparator.prototype.compare=function(...args){seen.push(args[2].map(p=>p.action));assert.strictEqual(args[1].id,development.id);return old.apply(this,args);};
    try{assert.ok(new Orchestrator(s).execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'})).success);}finally{ContextPlanComparator.prototype.compare=old;}
    assert.strictEqual(seen.length,1);assert.ok(seen[0]!.every(a=>a==='BUILD'||a==='WAIT'));
  });
  test('Phase F review: evaluation failure is explicit and cannot invoke legacy scoring',()=>{
    const s=world();primeSourceDecision(s,'me');const before=encodePersistable(s),compare=ContextPlanComparator.prototype.compare,score=ActionScorer.prototype.scorePlans;
    ContextPlanComparator.prototype.compare=()=>{throw new Error('evaluation failure');};ActionScorer.prototype.scorePlans=()=>{throw new Error('unexpected legacy fallback');};
    try{const o=new Orchestrator(s),r=o.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'}));assert.strictEqual(r.success,false);assert.deepStrictEqual(encodePersistable(o.getState()),before);}finally{ContextPlanComparator.prototype.compare=compare;ActionScorer.prototype.scorePlans=score;}
  });
  test('Phase F review: production diagnostics explain threshold and final draw privately',()=>{
    const s=world();primeSourceDecision(s,'me');const source=[...s.aiPressure.values()].find(c=>c.kind==='HOSTILE_OPPORTUNITY')!;
    const decision=new DecisionEngine(37).decideForSource(buildWarlordStates(s).get('me')!,toDecisionEngineSnapshot(s),source,sourceConcretePlans(s,source),s.aiDecisionOpportunities.get('me')!.primary!.opportunityId);
    const d=decision.planComparisonDiagnostics!;assert.ok(d);assert.strictEqual(d.resolution.selectedPlanId,decision.commitment!.plan!.id);assert.strictEqual(d.resolution.minimumCommitmentAdvantage,T.minimumCommitmentAdvantage);assert.ok(d.resolution.qualifiedPlanIds.length>0);
    assert.strictEqual(d.resolution.draw!==null,d.resolution.nearTiePlanIds.length>1);
    const loaded=hydratePersistedPayload(encodePersistable(s));const sourceAgain=loaded.aiPressure.get(source.id)!;
    const replay=new DecisionEngine(37).decideForSource(buildWarlordStates(loaded).get('me')!,toDecisionEngineSnapshot(loaded),sourceAgain,sourceConcretePlans(loaded,sourceAgain),loaded.aiDecisionOpportunities.get('me')!.primary!.opportunityId);
    assert.deepStrictEqual(replay.planComparisonDiagnostics,d);
  });
  test('Phase F review: earned invasion defense supports factual local danger once',()=>{
    const s=world();readyThreat(s);s.playerFactionId='me';const invasion=createActiveInvasion({id:'inv_review',defenderFactionId:'me',attackerFactionId:'enemy',territoryId:'stage',startedAtTick:0,notifiedAtTick:0,responseDeadlineTick:30,attackingArmyIds:['threat'],battleSeed:91});s.activeInvasions.set(invasion.id,invasion);
    const before=evaluator(s).localDanger('me','stage');invasion.defenseMobilization={applicationId:'app',sessionId:'ses',workoutId:'workout',playerId:'player',defensePower:50,attachedAtTick:0,workoutStartedAtTick:0,sourcePhysicalOutput:50};
    const after=evaluator(s).localDanger('me','stage');assert.ok(after.facts.defensePower>before.facts.defensePower);assert.strictEqual(after.facts.friendlySupportIds.filter(id=>id==='defense:inv_review').length,1);assert.deepStrictEqual(after.facts.hostileForceIds,['threat']);
  });
  test('Phase F review: diagnostic uncertainty cannot become hidden future authority',()=>{
    const s=world();s.territories.get('target')!.garrison=0;const before=compare(s),diagnostic=compare(s);
    for(const c of diagnostic.comparisons)for(const a of c.assessments){a.uncertainty.realizationStructure='contingent';a.uncertainty.branches=['corrupted diagnostic'];a.uncertainty.confidence='limited';}
    assert.deepStrictEqual(compare(s),before);
  });
  test('Phase F review: resource property and Goal ordering cannot change judgment',()=>{
    const s=world();s.territories.get('target')!.resourceOutput={food:1.1,gold:9.17,wood:3.41,stone:18.33,iron:0.73};s.factions.get('me')!.goals=[goal(),{...goal(),id:'second',priority:70}];const before=compare(s);
    s.territories.get('target')!.resourceOutput=Object.fromEntries(Object.entries(s.territories.get('target')!.resourceOutput).reverse());s.factions.get('me')!.goals.reverse();assert.deepStrictEqual(compare(s),before);
  });
  test('Phase F review: production catch-up never invokes deprecated scorer',()=>{
    const s=world(),score=ActionScorer.prototype.scorePlans,all=ActionScorer.prototype.scoreAllActions;
    ActionScorer.prototype.scorePlans=ActionScorer.prototype.scoreAllActions=()=>{throw new Error('legacy catch-up scoring');};
    try{
      accrueWorldThroughReceipt(s,0);accrueWorldThroughReceipt(s,100*600000);
      catchUpWorld(s,{req:cmdReq('ADVANCE_WORLD','ai',{elapsedTicks:0}),def:getCommandDefinition('ADVANCE_WORLD')!,registry:createDefaultRegistry(),runtime:{aiWarlordStates:new Map()}},100);
      assert.ok([...s.operations.values()].some(o=>o.action==='ATTACK'));assert.deepStrictEqual(checkGameStateInvariants(s),[]);
    }finally{ActionScorer.prototype.scorePlans=score;ActionScorer.prototype.scoreAllActions=all;}
  });
  test('Phase F review: comparison cannot silently prune legal source alternatives',()=>{
    const s=world(),c=military(s),plans=sourceConcretePlans(s,c);assert.ok(plans.length>2);
    const omit=plans.find(p=>p.action!=='WAIT')!;assert.throws(()=>new ContextPlanComparator().compare(s,c,plans.filter(p=>p.id!==omit.id)),/complete bounded/);
  });
  test('Phase F review: selection refuses a fictional WAIT reward',()=>{
    const comparisons=compare(world()).comparisons;assert.throws(()=>selectContextComparison(comparisons.map(c=>c.plan.action==='WAIT'?{...c,finalValue:1}:c),new SeededRNG(1)),/WAIT baseline/);
  });
  test('Phase F review: uncommitted adjacent attack capability has no fictitious march delay',()=>{
    const s=world();addThreat(s);const d=evaluator(s).localDanger('me','stage',undefined,'a');
    assert.strictEqual(d.facts.earliestThreatTicks,0);assert.ok(!d.facts.friendlySupportIds.includes('a'));
  });
  test('Phase F review: a committed hostile force cannot be freely retargeted in baseline',()=>{
    const s=world();addThreat(s);s.territories.get('target')!.neighboring.push('home');s.territories.get('home')!.neighboring.push('target');
    assert.deepStrictEqual(evaluator(s).localDanger('me','stage').facts.hostileForceIds,['threat']);
    s.armies.get('threat')!.attackIntent={targetTerritoryId:'home',stagingTerritoryId:'target',status:'ready',createdAtTick:0,commitmentId:null,battleSeed:9000};
    assert.deepStrictEqual(evaluator(s).localDanger('me','stage').facts.hostileForceIds,[]);assert.deepStrictEqual(evaluator(s).localDanger('me','home').facts.hostileForceIds,['threat']);
  });
  test('Phase F review: unreachable attack capability is not invented for an undersized force',()=>{
    const s=world();addThreat(s);s.armies.get('threat')!.soldiers=1;assert.deepStrictEqual(evaluator(s).localDanger('me','stage').facts.hostileForceIds,[]);
  });
}
