import {processPeaceBoundary,settlePeaceProposal,livePeaceProposals} from '../src/gameplay/diplomacy/peace';
import {progressTradeShipments,settleTradeProposal} from '../src/gameplay/trade/trade';
import {mergeEventStepOntoGameState} from '../src/orchestration/applyEvents';
import {toWorldStepInput} from '../src/state/gameStateAdapters';
import {WorldSimulator,ConsequenceApplier} from '../src/events/WorldSimulator';
import assert from 'assert';
import {makeOperationTestWorld,setFixturePeace} from './aiOperationFixtures';
import type {GameState} from '../src/types/GameState';
import {assignGoal,refreshGoals,currentGoal,assessGoalProgress,goalPreference,goalMatchesSource} from '../src/cognition/goals';
import {applyOpinionEvent,opinionPreference} from '../src/cognition/opinion';
import {factionDecisionView} from '../src/cognition/decisionView';
import {COGNITION_TUNING as C} from '../src/constants/cognition';
import {makeConcretePlan,PROACTIVE_AI_ACTIONS} from '../src/types/AIConcretePlan';
import {STRATEGIC_EVALUATORS} from '../src/types/StrategicEvaluation';
import {ContextPlanComparator} from '../src/scoring/contextPlanComparison';
import {StrategicEvaluators} from '../src/scoring/strategicEvaluators';
import {FactualSupport} from '../src/scoring/factualSupport';
import {deriveSources,observeSources,sourceConcretePlans,pressureRate} from '../src/engine/strategicPressure';
import {prepareProactiveDecision,opportunity,accrueProactiveClocks} from '../src/engine/proactiveCognition';
import {cloneGameState} from '../src/state/cloneGameState';
import {encodePersistable} from '../src/persistence/serialization';
import {hydratePersistedPayload} from '../src/persistence/hydrate';
import {checkGameStateInvariants} from '../src/state/gameStateInvariants';
import {cognitionStateProblems} from '../src/state/cognitionInvariants';
import {assessRequiredPeaceResponse,peaceEstimateView,counterpartyResponseEstimate} from '../src/scoring/peaceAssessment';
import {assessRequiredTradeResponse,tradeResponseEstimate} from '../src/scoring/tradeAssessment';
import {tradeNode} from '../src/gameplay/trade/policy';
import {liveTradeProposals,processTradeBoundary} from '../src/gameplay/trade/trade';
import {startConstruction} from '../src/gameplay/construction/consume';
import {progressAllConstructions} from '../src/gameplay/construction/progress';
import {ensureCity} from '../src/gameplay/cities/city';
import {getConstructionProjectDefinition,constructionCostEntries} from '../src/gameplay/construction/definitions';
import {Orchestrator,createDefaultRegistry} from '../src/orchestration';
import {runStateTransaction} from '../src/orchestration/transaction';
import {primeSourceDecision} from './aiPressureFixtures';
import {STRATEGIC_EVALUATION_TUNING as T} from '../src/constants/strategicEvaluation';
import {SeededRNG} from '../src/utils/SeededRNG';
import {beginArmyMovement,progressArmyMovements} from '../src/army/movement';
import {buildWarlordStates} from '../src/state/gameStateAdapters';
import {progressProactiveThrough} from '../src/orchestration/handlers';
import {getCommandDefinition} from '../src/orchestration/commandIndex';
import {InMemoryGameStateStore} from '../src/persistence/inMemoryGameStateStore';
import {beginInvasionAgainstPlayer} from '../src/gameplay/invasion/create';
import {resolveInvasionBattle} from '../src/gameplay/invasion/resolve';
import {BattleEngine} from '../src/battle/BattleEngine';
import {GAMEPLAY_CONFIG} from '../src/gameplay/config';
type Api=Pick<Parameters<typeof import('./aiTrade').registerAiTradeTests>[0],'test'|'makeSelf'|'makeTerritory'|'cmdReq'>;
export function registerAiCognitionTests({test,makeSelf,makeTerritory,cmdReq}:Api):void {
  const world=()=>makeOperationTestWorld(makeSelf,makeTerritory);
  const reload=(s:GameState)=>hydratePersistedPayload(encodePersistable(s));
  const attack=(s=world())=>makeConcretePlan({action:'ATTACK',factionId:'me',armyId:'a',originTerritoryId:'home',stagingTerritoryId:'stage',targetTerritoryId:'target',route:['home','stage','target']});
  const build=()=>makeConcretePlan({action:'BUILD',factionId:'me',territoryId:'home',projectType:'FARM',resourceSource:{kind:'faction_stock',factionId:'me',resources:Object.fromEntries(constructionCostEntries(getConstructionProjectDefinition('FARM').cost).map(c=>[c.resource,c.amount]))}});
  const comparison=(s:GameState)=>{observeSources(s,'me');const source=[...s.aiPressure.values()].find(c=>c.kind==='HOSTILE_OPPORTUNITY')!;assert.ok(source);return new ContextPlanComparator().compare(s,source,sourceConcretePlans(s,source));};
  const facts=(s:GameState)=>{const e=new StrategicEvaluators(new FactualSupport(s));return [e.battleOutlook('a','target'),e.territoryValue('me','target'),e.localDanger('me','home'),e.forcePositionValue('me','a','stage','home'),e.resourceValue('me','food',10,'gain'),e.buildValue(build() as import('../src/types/AIConcretePlan').BuildPlan),e.warValue('me','enemy')];};
  const directed=(s:GameState,owner:string,target:string,n:number)=>{const f=s.factions.get(owner)!;f.diplomacy.set(target,{target,state:'neutral',opinion:n,treaties:[],yearsAtPeace:0,yearsAtWar:0});};
  test('Phase J: explicit control Goal completes only from achieved control',()=>{const s=world(),g=assignGoal(s,'me','control',{kind:'CONTROL_TERRITORY',territoryId:'target'});assert.strictEqual(g.lifecycle!.status,'ACTIVE');s.territories.get('target')!.owner='me';refreshGoals(s);assert.strictEqual(g.lifecycle!.status,'COMPLETED');assert.strictEqual(g.progress,g.targetProgress);const before=encodePersistable(s);refreshGoals(s);assert.deepStrictEqual(encodePersistable(s),before);});
  test('Phase J: disappeared target invalidates without completing/rewarding',()=>{const s=world(),g=assignGoal(s,'me','control',{kind:'CONTROL_TERRITORY',territoryId:'target'});s.territories.delete('target');refreshGoals(s);assert.strictEqual(g.lifecycle!.status,'INVALIDATED');assert.strictEqual(g.progress,0);});
  test('Phase J: completed development requires actual completed authored structure',()=>{const s=world(),g=assignGoal(s,'me','farm',{kind:'DEVELOPMENT',territoryId:'home',projectType:'FARM'});const p=startConstruction(s,{factionId:'me',territoryId:'home',projectType:'FARM'});refreshGoals(s);assert.strictEqual(g.lifecycle!.status,'ACTIVE');s.worldTick=p.durationTicks;progressAllConstructions(s);assert.strictEqual(g.lifecycle!.status,'COMPLETED');});
  test('Phase J: City Goal tests real city identity',()=>{const s=world(),g=assignGoal(s,'me','city',{kind:'DEVELOPMENT',territoryId:'home',projectType:'CITY'});ensureCity(s,'home','me');refreshGoals(s);assert.strictEqual(g.lifecycle!.status,'COMPLETED');});
  test('Phase J: region control progress is real control fraction',()=>{const s=world(),g=assignGoal(s,'me','region',{kind:'CONTROL_REGION',regionId:s.territories.get('target')!.regionId});assert.ok(g.progress>0&&g.progress<1);for(const t of s.territories.values())t.owner='me';refreshGoals(s);assert.strictEqual(g.lifecycle!.status,'COMPLETED');});
  test('Phase J: Peace Goal does not complete on clearance acceptance alone',()=>{const s=world(),g=assignGoal(s,'me','peace',{kind:'PEACE',factionId:'enemy'});setFixturePeace(s,'me','enemy');const r=[...s.peaceRelationships.values()][0]!;r.state='PENDING_HOSTILITIES_CLEARANCE';refreshGoals(s);assert.strictEqual(g.lifecycle!.status,'ACTIVE');r.state='PEACE';refreshGoals(s);assert.strictEqual(g.lifecycle!.status,'COMPLETED');});
  test('Phase J: local force Goal completes at physical arrival, not movement start',()=>{const s=world(),g=assignGoal(s,'me','position',{kind:'FORCE_POSITION',armyId:'a',territoryId:'stage'});beginArmyMovement(s,{armyId:'a',factionId:'me',destinationTerritoryId:'stage'});assert.strictEqual(g.lifecycle!.status,'ACTIVE');s.worldTick=100;progressArmyMovements(s,100);assert.strictEqual(g.lifecycle!.status,'COMPLETED');});
  test('Phase J: reserved bank does not satisfy spendable resource Goal',()=>{const s=world();s.factions.get('me')!.resources.food=20;const g=assignGoal(s,'me','food',{kind:'RESOURCE_HOLDING',resource:'food',quantity:30});assert.strictEqual(g.lifecycle!.status,'ACTIVE');s.factions.get('me')!.resources.food=30;refreshGoals(s);assert.strictEqual(g.lifecycle!.status,'COMPLETED');});
  test('Phase J: missing/deadline targets have explicit invalidation',()=>{const s=world(),g=assignGoal(s,'me','deadline',{kind:'CONTROL_TERRITORY',territoryId:'target'});g.deadlineTurn=0;s.turn=1;refreshGoals(s);assert.strictEqual(g.lifecycle!.status,'INVALIDATED');});
  test('Phase J: Goal identity is stable and duplicate assignment rejected',()=>{const s=world();assignGoal(s,'me','semantic-id',{kind:'CONTROL_TERRITORY',territoryId:'target'});assert.throws(()=>assignGoal(s,'me','semantic-id',{kind:'PEACE',factionId:'enemy'}));assert.deepStrictEqual(reload(s).factions.get('me')!.goals,s.factions.get('me')!.goals);});
  test('Phase J: Goal cannot create candidate or real source',()=>{const s=world();for(const t of s.territories.values()){t.baseValue=0;t.resourceOutput={};}for(const f of s.factions.values())f.resources={gold:0,food:0,wood:0,iron:0,stone:0};const before=deriveSources(s,'me',0);assignGoal(s,'me','control',{kind:'CONTROL_TERRITORY',territoryId:'target'});assert.deepStrictEqual(deriveSources(s,'me',0),before);});
  test('Phase J: Goal amplifies only its actual military source',()=>{const s=world();observeSources(s,'me');const source=[...s.aiPressure.values()].find(c=>c.kind==='HOSTILE_OPPORTUNITY')!;const before=pressureRate(s,source);assignGoal(s,'me','goal',{kind:'CONTROL_TERRITORY',territoryId:'target'});assert.ok(pressureRate(s,source)>before);s.territories.get('target')!.owner='me';assert.strictEqual(goalMatchesSource(s,source),false);});
  test('Phase J: unrelated resource Goal cannot amplify Development',()=>{const s=world();s.territories.get('home')!.resourceOutput={food:5};s.factions.get('me')!.resources.food=0;observeSources(s,'me');const source=[...s.aiPressure.values()].find(c=>c.domain==='DEVELOPMENT')!;assert.ok(source);assignGoal(s,'me','food',{kind:'RESOURCE_HOLDING',resource:'food',quantity:100000});assert.strictEqual(goalMatchesSource(s,source),false);});
  test('Phase J: exact relevant Goal assessment is contingent, not guaranteed capture',()=>{const s=world(),g=assignGoal(s,'me','control',{kind:'CONTROL_TERRITORY',territoryId:'target'}),a=assessGoalProgress(s,'me',g,attack(s));assert.strictEqual(a.direction,'ADVANCE');assert.strictEqual(a.realization,'CONTINGENT');assert.strictEqual(g.lifecycle!.status,'ACTIVE');});
  test('Phase J: unrelated Goal gives zero exact-plan preference',()=>{const s=world();assignGoal(s,'me','farm',{kind:'DEVELOPMENT',territoryId:'home',projectType:'FARM'});assert.strictEqual(goalPreference(s,'me',attack(s),T.modifierBound).value,0);});
  test('Phase J: committed Build cannot get repeated Goal progress preference',()=>{const s=world(),g=assignGoal(s,'me','farm',{kind:'DEVELOPMENT',territoryId:'home',projectType:'FARM'});const o=new Orchestrator(s);assert.ok(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:build()})).success);assert.strictEqual(assessGoalProgress(o.getState(),'me',g,build()).realization,'ALREADY_COMMITTED');assert.strictEqual(goalPreference(o.getState(),'me',build(),T.modifierBound).value,0);});
  test('Phase J: all factual evaluators remain Goal and Opinion neutral',()=>{const s=world(),before=facts(s);assignGoal(s,'me','control',{kind:'CONTROL_TERRITORY',territoryId:'target'});directed(s,'me','enemy',-100);assert.deepStrictEqual(facts(s),before);});
  test('Phase J: completed and invalidated Goals lose all future modifier influence',()=>{const s=world(),g=assignGoal(s,'me','goal',{kind:'CONTROL_TERRITORY',territoryId:'target'});assert.ok(goalPreference(s,'me',attack(s),T.modifierBound).value>0);g.lifecycle!.status='INVALIDATED';g.lifecycle!.resolvedAtTick=0;assert.strictEqual(goalPreference(s,'me',attack(s),T.modifierBound).value,0);g.lifecycle!.status='COMPLETED';assert.strictEqual(goalPreference(s,'me',attack(s),T.modifierBound).value,0);});
  test('Phase J: Goal changed during deliberation is read fresh at completion',()=>{const s=world(),g=assignGoal(s,'me','goal',{kind:'CONTROL_TERRITORY',territoryId:'target'});primeSourceDecision(s,'me');g.lifecycle!.objective={kind:'DEVELOPMENT',territoryId:'home',projectType:'FARM'};const o=new Orchestrator(s);assert.ok(o.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'})).success);const selected=[...o.getState().operations.values()][0];if(selected)assert.notStrictEqual(selected.originatingGoalId,g.id);assert.strictEqual(goalPreference(o.getState(),'me',attack(s),T.modifierBound).value,0);});
  test('Phase J: canonical clone and disposable wrapper deeply isolate Goal predicate',()=>{const s=world();assignGoal(s,'me','goal',{kind:'CONTROL_TERRITORY',territoryId:'target'});const d=cloneGameState(s),w=buildWarlordStates(s).get('me')!;d.factions.get('me')!.goals[0]!.lifecycle!.objective={kind:'PEACE',factionId:'enemy'};w.goals.getAllGoals()[0]!.lifecycle!.status='INVALIDATED';assert.strictEqual(s.factions.get('me')!.goals[0]!.lifecycle!.status,'ACTIVE');assert.strictEqual(s.factions.get('me')!.goals[0]!.lifecycle!.objective!.kind,'CONTROL_TERRITORY');});
  test('Phase J: Opinion is directed and neutral WAR is not dislike',()=>{const s=world();assert.strictEqual(factionDecisionView(s,'me').own.opinions.get('enemy')??0,0);applyOpinionEvent(s,'event','me','enemy','attack_received',-40);assert.strictEqual(s.factions.get('me')!.diplomacy.get('enemy')!.opinion,-40);assert.strictEqual(s.factions.get('enemy')!.diplomacy.get('me')?.opinion??0,0);assert.strictEqual(peaceEstimateView(s,'me','enemy').relationship,'WAR');});
  test('Phase J: bounded Opinion update saturates deterministically',()=>{const s=world();applyOpinionEvent(s,'a','me','enemy','harm',-100000);assert.strictEqual(s.factions.get('me')!.diplomacy.get('enemy')!.opinion,-C.opinionRange);applyOpinionEvent(s,'b','me','enemy','benefit',100000);assert.strictEqual(s.factions.get('me')!.diplomacy.get('enemy')!.opinion,C.opinionRange);assert.throws(()=>applyOpinionEvent(s,'bad','me','enemy','harm',NaN));});
  test('Phase J: Opinion event replay and reload cannot double count',()=>{const s=world();applyOpinionEvent(s,'a','me','enemy','attack_received',-40);const d=reload(s);assert.strictEqual(applyOpinionEvent(d,'a','me','enemy','attack_received',-40),false);assert.strictEqual(d.factions.get('me')!.diplomacy.get('enemy')!.opinion,-40);assert.throws(()=>applyOpinionEvent(d,'a','me','enemy','attack_received',-20));});
  test('Phase J: retained raw Memory does not duplicate current Opinion',()=>{const s=world();directed(s,'me','enemy',-40);const before=comparison(s);s.factions.get('me')!.memory=[{id:'grudge',type:'attack_received',turn:0,withFaction:'enemy',territory:'target',magnitude:10000,details:{}}];assert.deepStrictEqual(comparison(s),before);});
  test('Phase J: Opinion affects exact ATTACK preference but never factual outputs',()=>{const s=world(),before=comparison(s).comparisons;directed(s,'me','enemy',-80);const after=comparison(s).comparisons;const a=before.find(c=>c.plan.action==='ATTACK')!,b=after.find(c=>c.plan.id===a.plan.id)!;assert.deepStrictEqual(a.assessments,b.assessments);assert.ok(b.finalValue>a.finalValue);assert.strictEqual(b.contributions.filter(c=>c.owner==='OPINION_MODIFIER').length,1);});
  test('Phase J: Opinion cannot bypass PEACE or clearance',()=>{for(const status of ['PEACE','PENDING_HOSTILITIES_CLEARANCE'] as const){const s=world();setFixturePeace(s,'me','enemy');[...s.peaceRelationships.values()][0]!.state=status;directed(s,'me','enemy',-100);observeSources(s,'me');assert.ok(![...s.aiPressure.values()].some(c=>c.kind==='HOSTILE_OPPORTUNITY'));}});
  test('Phase J: positive Opinion does not create a treaty',()=>{const s=world();applyOpinionEvent(s,'benefit','me','enemy','benefit',100);assert.strictEqual(peaceEstimateView(s,'me','enemy').relationship,'WAR');assert.strictEqual(s.peaceRelationships.size,0);});
  test('Phase J: Goal and Opinion have distinct single contribution owners',()=>{const s=world();assignGoal(s,'me','control',{kind:'CONTROL_TERRITORY',territoryId:'target'});directed(s,'me','enemy',-80);for(const c of comparison(s).comparisons){assert.strictEqual(new Set(c.contributions.map(x=>x.causalKey)).size,c.contributions.length);assert.ok(Math.abs(c.modifierValue)<=T.modifierStackBound);}});
  test('Phase J: aggressive Personality/Ambition cannot multiply target hatred',()=>{const s=world();directed(s,'me','enemy',-80);const before=comparison(s);s.factions.get('me')!.ambition=1;s.factions.get('me')!.personality.aggression=1;assert.deepStrictEqual(comparison(s),before);});
  test('Phase J: directed Opinion cannot overwrite factual risk assessment',()=>{const s=world();s.territories.get('target')!.garrison=800;s.territories.get('target')!.fortification=5;s.territories.get('target')!.resourceOutput={food:1};const a=comparison(s).comparisons.find(c=>c.plan.action==='ATTACK')!;directed(s,'me','enemy',-100);const b=comparison(s).comparisons.find(c=>c.plan.id===a.plan.id)!;assert.deepStrictEqual(a.assessments,b.assessments);assert.deepStrictEqual(a.contributions.find(c=>c.owner==='RISK_MODIFIER'),b.contributions.find(c=>c.owner==='RISK_MODIFIER'));assert.strictEqual(b.qualifies,false);});
  test('Phase J: pressure magnitude is not copied into either preference owner',()=>{const s=world();assignGoal(s,'me','goal',{kind:'CONTROL_TERRITORY',territoryId:'target'});directed(s,'me','enemy',-50);const before=comparison(s);for(const c of s.aiPressure.values())c.pressure=100000;assert.deepStrictEqual(comparison(s),before);});
  test('Phase J: own Decision View is detached and excludes every private counterparty field',()=>{const s=world();assignGoal(s,'enemy','secret',{kind:'CONTROL_TERRITORY',territoryId:'home'});directed(s,'enemy','me',-100);const v=factionDecisionView(s,'me');assert.deepStrictEqual(Object.keys(v.others.get('enemy')!).sort(),['id','name','relationship']);assert.ok(!JSON.stringify([...v.others]).includes('secret'));v.own.personality.riskTolerance=1;assert.notStrictEqual(s.factions.get('me')!.personality.riskTolerance,1);});
  test('Phase J: proposer estimates never read recipient-private getters',()=>{const s=world(),enemy=s.factions.get('enemy')!;for(const key of ['goals','memory','personality','ambition','diplomacy'] as const)Object.defineProperty(enemy,key,{get(){throw new Error(`private ${key}`);}});assert.doesNotThrow(()=>counterpartyResponseEstimate(peaceEstimateView(s,'me','enemy')));assert.doesNotThrow(()=>tradeResponseEstimate({offered:{wood:2},requested:{food:3}}));assert.doesNotThrow(()=>factionDecisionView(s,'me'));});
  test('Phase J: actual required Peace response uses only recipient own directed stance',()=>{const s=world();const before=assessRequiredPeaceResponse(s,'me','enemy');directed(s,'me','enemy',-100);const after=assessRequiredPeaceResponse(s,'me','enemy');assert.deepStrictEqual(after.war,before.war);assert.ok(after.modifier<before.modifier);directed(s,'enemy','me',100);assert.deepStrictEqual(assessRequiredPeaceResponse(s,'me','enemy'),after);});
  test('Phase J: recipient own Peace Goal affects response outside WAR_VALUE',()=>{const s=world(),a=assessRequiredPeaceResponse(s,'me','enemy');assignGoal(s,'me','peace',{kind:'PEACE',factionId:'enemy'});const b=assessRequiredPeaceResponse(s,'me','enemy');assert.deepStrictEqual(a.war,b.war);assert.ok(b.goal>a.goal);});
  const pendingTrade=(s=world())=>{s.territories.get('safe')!.neighboring=['target'];s.territories.get('target')!.neighboring.push('safe');const p=makeConcretePlan({action:'TRADE',factionId:'me',counterpartyId:'spectator',offered:{wood:10},requested:{food:10},proposerSource:{kind:'faction_stock',factionId:'me',resources:{wood:10}},delivery:{proposerTerritoryId:tradeNode(s,'me')!,recipientTerritoryId:'safe'}});const o=new Orchestrator(s);assert.ok(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:p})).success);const d=cloneGameState(o.getState());accrueProactiveClocks(d,60000,'OFFLINE');processTradeBoundary(d);assert.strictEqual(liveTradeProposals(d)[0]!.status,'pending');return d;};
  test('Phase J: Trade response Opinion changes willingness, not RESOURCE_VALUE',()=>{const s=pendingTrade(),p=liveTradeProposals(s)[0]!,base=new StrategicEvaluators(new FactualSupport(s)).resourceValue('spectator','wood',10,'gain');const a=assessRequiredTradeResponse(s,p);directed(s,'spectator','me',-100);const b=assessRequiredTradeResponse(s,p);assert.ok('modifier' in a&&'modifier' in b&&b.modifier!<a.modifier!);assert.deepStrictEqual(new StrategicEvaluators(new FactualSupport(s)).resourceValue('spectator','wood',10,'gain'),base);});
  test('Phase J: reload while Trade pending preserves exact cognition and response',()=>{const s=pendingTrade();assignGoal(s,'spectator','food',{kind:'RESOURCE_HOLDING',resource:'wood',quantity:10001});directed(s,'spectator','me',35);const d=reload(s);assert.deepStrictEqual(assessRequiredTradeResponse(d,liveTradeProposals(d)[0]!),assessRequiredTradeResponse(s,liveTradeProposals(s)[0]!));assert.deepStrictEqual(d.factions.get('spectator')!.goals,s.factions.get('spectator')!.goals);});
  test('Phase J: schema 24 migration archives ambiguous objectives without fabricating history',()=>{const s=world();s.schemaVersion=24;s.factions.get('me')!.goals=[{id:'legacy',type:'economic_growth',priority:70,targetFaction:null,targetTerritory:null,targetRegion:null,targetResource:null,progress:99,targetProgress:100,deadlineTurn:null,createdTurn:0}];directed(s,'me','enemy',-37);const d=reload(s);assert.strictEqual(d.schemaVersion,25);assert.strictEqual(d.factions.get('me')!.goals[0]!.lifecycle!.status,'INVALIDATED');assert.strictEqual(d.factions.get('me')!.goals[0]!.progress,99);assert.strictEqual(d.factions.get('me')!.diplomacy.get('enemy')!.opinion,-37);assert.strictEqual(d.opinionEvents.size,0);assert.deepStrictEqual(encodePersistable(reload(d)),encodePersistable(d));});
  test('Phase J: schema migration preserves operations/claims/Peace/Trade/recruitment IDs',()=>{const s=pendingTrade();s.schemaVersion=24;const before=encodePersistable({operations:s.operations,claims:s.operationClaims,peace:s.peaceRelationships,trade:s.tradeProposals,shipments:s.tradeShipments,recruit:s.territoryRecruitment,opportunity:s.aiDecisionOpportunities});const d=reload(s);assert.deepStrictEqual(encodePersistable({operations:d.operations,claims:d.operationClaims,peace:d.peaceRelationships,trade:d.tradeProposals,shipments:d.tradeShipments,recruit:d.territoryRecruitment,opportunity:d.aiDecisionOpportunities}),before);});
  test('Phase J: current schema missing receipt authority is corrupt',()=>{const s=world();delete (s as Partial<GameState>).opinionEvents;assert.throws(()=>reload(s));});
  test('Phase J: lifecycle, range and receipt invariants reject corruption',()=>{const s=world();assignGoal(s,'me','control',{kind:'CONTROL_TERRITORY',territoryId:'target'});s.factions.get('me')!.goals[0]!.lifecycle!.ownerId='enemy';directed(s,'me','enemy',101);assert.ok(cognitionStateProblems(s).length>=2);});
  test('Phase J: inactive owner Goals cannot drive thought; primary thread cleans up',()=>{const s=world(),g=assignGoal(s,'me','control',{kind:'CONTROL_TERRITORY',territoryId:'target'});primeSourceDecision(s,'me');s.factions.get('me')!.territories=[];s.factions.get('me')!.armies=[];refreshGoals(s,'me');assert.strictEqual(g.lifecycle!.status,'INVALIDATED');assert.strictEqual(prepareProactiveDecision(s,'me'),null);assert.strictEqual(opportunity(s,'me').primary,null);});
  test('Phase J: ranking and receipts are independent of collection insertion order',()=>{const s=world();assignGoal(s,'me','control',{kind:'CONTROL_TERRITORY',territoryId:'target'});directed(s,'me','enemy',-23);const a=comparison(s),d=reload(s);d.factions=new Map([...d.factions].reverse());d.territories=new Map([...d.territories].reverse());d.armies=new Map([...d.armies].reverse());assert.deepStrictEqual(comparison(d),a);applyOpinionEvent(s,'event','me','enemy','harm',-10);applyOpinionEvent(d,'event','me','enemy','harm',-10);assert.deepStrictEqual(encodePersistable(d.opinionEvents),encodePersistable(s.opinionEvents));});
  test('Phase J: factual/preference paths cannot consume early selection RNG',()=>{const s=world();assignGoal(s,'me','control',{kind:'CONTROL_TERRITORY',territoryId:'target'});const next=SeededRNG.prototype.next;SeededRNG.prototype.next=()=>{throw new Error('early RNG');};try{assert.doesNotThrow(()=>comparison(s));assert.doesNotThrow(()=>assessRequiredPeaceResponse(s,'me','enemy'));}finally{SeededRNG.prototype.next=next;}});
  test('Phase J: cognition mutation rollback leaves preceding canonical state untouched',()=>{const s=world(),before=encodePersistable(s);assert.throws(()=>runStateTransaction(s,d=>{assignGoal(d,'me','goal',{kind:'CONTROL_TERRITORY',territoryId:'target'});applyOpinionEvent(d,'event','me','enemy','harm',-40);throw new Error('CAS equivalent failed draft');}));assert.deepStrictEqual(encodePersistable(s),before);});
  test('Phase J: public DTO cannot expose private Goal/Opinion/receipts',()=>{const s=world();assignGoal(s,'me','secret-goal',{kind:'CONTROL_TERRITORY',territoryId:'target'});applyOpinionEvent(s,'private-event','me','enemy','harm',-40);const r=new Orchestrator(s).execute(cmdReq('GET_GAME_STATE','player',{}));assert.ok(r.success);const text=JSON.stringify(r.payload);for(const secret of ['secret-goal','opinionEvents','private-event','GoalProgressAssessment','OPINION_MODIFIER'])assert.ok(!text.includes(secret));});
  test('Phase J: exact action/evaluator count stays eight/seven',()=>{assert.strictEqual(PROACTIVE_AI_ACTIONS.length,8);assert.strictEqual(STRATEGIC_EVALUATORS.length,7);assert.ok(!PROACTIVE_AI_ACTIONS.includes('PURSUE_GOAL' as never));assert.ok(!STRATEGIC_EVALUATORS.includes('OPINION_VALUE' as never));});
  test('Phase J: pending Peace/reload retains own Goal and directed Opinion exactly',()=>{
    const s=world();assignGoal(s,'me','peace',{kind:'PEACE',factionId:'spectator'});directed(s,'me','spectator',17);
    const plan=makeConcretePlan({action:'OFFER_PEACE',factionId:'me',counterpartyId:'spectator'}),o=new Orchestrator(s);
    assert.ok(o.execute(cmdReq('START_AI_OPERATION','ai',{plan})).success);const d=cloneGameState(o.getState());accrueProactiveClocks(d,30000,'OFFLINE');processPeaceBoundary(d);
    assert.strictEqual(livePeaceProposals(d)[0]!.status,'pending');const e=reload(d);assert.deepStrictEqual(encodePersistable(e),encodePersistable(d));
    assert.strictEqual(e.factions.get('me')!.goals[0]!.lifecycle!.status,'ACTIVE');
  });
  test('Phase J: actual Peace activation updates both directed Opinions exactly once',()=>{
    const s=world();assignGoal(s,'me','peace',{kind:'PEACE',factionId:'spectator'});const o=new Orchestrator(s);
    assert.ok(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:makeConcretePlan({action:'OFFER_PEACE',factionId:'me',counterpartyId:'spectator'})})).success);
    const d=cloneGameState(o.getState());accrueProactiveClocks(d,30000,'OFFLINE');processPeaceBoundary(d);
    assert.ok(settlePeaceProposal(d,livePeaceProposals(d)[0]!.id,'accepted'));processPeaceBoundary(d);
    assert.strictEqual(d.opinionEvents.size,0);accrueProactiveClocks(d,40000,'OFFLINE');processPeaceBoundary(d);
    assert.strictEqual(d.opinionEvents.size,2);assert.strictEqual(d.factions.get('me')!.goals[0]!.lifecycle!.status,'COMPLETED');
    const before=encodePersistable(d);processPeaceBoundary(d);assert.deepStrictEqual(encodePersistable(d),before);
  });
  test('Phase J: Trade delivery, not publication/acceptance, owns beneficial Opinion event',()=>{
    const s=pendingTrade();assert.strictEqual(s.opinionEvents.size,0);assert.ok(settleTradeProposal(s,liveTradeProposals(s)[0]!.id,'accepted'));
    assert.strictEqual(s.opinionEvents.size,0);
    for(let i=0;i<30&&[...s.tradeShipments.values()].some(sh=>sh.phase!=='delivered');i++){
      accrueProactiveClocks(s,s.aiClock.nowMs+100000,'OFFLINE');s.worldTick++;s.accruedTargetWorldTick=s.worldTick;progressTradeShipments(s);
    }
    assert.ok([...s.tradeShipments.values()].every(sh=>sh.phase==='delivered'));assert.strictEqual(s.opinionEvents.size,2);
    const before=encodePersistable(s);progressTradeShipments(s);assert.deepStrictEqual(encodePersistable(s),before);
    assert.deepStrictEqual(reload(s).opinionEvents,s.opinionEvents);
  });
  test('Phase J: real exact attack updates defender stance without self-generated hatred',()=>{
    const s=world(),o=new Orchestrator(s);assert.ok(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:attack(s)})).success);
    const operationId=[...o.getState().operations.keys()][0]!;
    assert.ok(o.execute(cmdReq('ADVANCE_WORLD','ai',{elapsedTicks:20})).success);
    assert.ok([...o.getState().opinionEvents.values()].some(e=>e.observer==='enemy'&&e.target==='me'&&e.kind==='attack_received'));
    assert.ok([...o.getState().opinionEvents.values()].filter(e=>e.kind==='attack_received').some(e=>{
      const eventId=JSON.parse(e.id.slice('opinion:v1:'.length))[0] as string;
      return eventId.startsWith('attack:')&&JSON.parse(eventId.slice('attack:'.length))[0]===operationId;
    }));
    assert.strictEqual(o.getState().factions.get('me')!.diplomacy.get('enemy')?.opinion??0,0);
  });
  test('Phase J: event adapter applies current canonical Opinion once and deep-isolates Goals',()=>{
    const s=world();assignGoal(s,'me','control',{kind:'CONTROL_TERRITORY',territoryId:'target'});directed(s,'me','enemy',0);
    const d=cloneGameState(s);d.factions.get('me')!.diplomacy.get('enemy')!.opinion=5;
    const output={mutatedTerritories:d.territories,mutatedFactions:d.factions,mutatedArmies:d.armies,newActiveEvents:[],newEventHistory:[],summary:[],triggeredEvents:[],perTurnConsequences:[],expiredEvents:[],unresolvedDecisions:[],opinionEffects:[{id:'authored-event',observer:'me',target:'enemy',delta:5}]} as import('../src/events/EventModel').WorldStepOutput;
    mergeEventStepOntoGameState(s,output);assert.strictEqual(s.factions.get('me')!.diplomacy.get('enemy')!.opinion,5);assert.strictEqual(s.opinionEvents.size,1);
    mergeEventStepOntoGameState(s,output);assert.strictEqual(s.opinionEvents.size,1);
  });
  test('Phase J: reload during proactive deliberation yields exact same preference/selection',()=>{
    const s=world();assignGoal(s,'me','control',{kind:'CONTROL_TERRITORY',territoryId:'target'});directed(s,'me','enemy',-17);primeSourceDecision(s,'me');
    const d=reload(s),a=new Orchestrator(s),b=new Orchestrator(d);
    const ra=a.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'})),rb=b.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'}));assert.ok(ra.success&&rb.success);
    assert.deepStrictEqual(encodePersistable(a.getState()),encodePersistable(b.getState()));
  });
  test('Phase J: reload during Trade initiation preserves private cognition and exact reserved terms',()=>{
    const s=world();s.territories.get('safe')!.neighboring=['target'];s.territories.get('target')!.neighboring.push('safe');
    assignGoal(s,'me','food',{kind:'RESOURCE_HOLDING',resource:'food',quantity:10050});directed(s,'me','spectator',20);
    const o=new Orchestrator(s);assert.ok(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:makeConcretePlan({action:'TRADE',factionId:'me',counterpartyId:'spectator',offered:{wood:10},requested:{food:10},proposerSource:{kind:'faction_stock',factionId:'me',resources:{wood:10}},delivery:{proposerTerritoryId:tradeNode(s,'me')!,recipientTerritoryId:'safe'}})})).success);
    const d=cloneGameState(o.getState());accrueProactiveClocks(d,1000,'OFFLINE');const e=reload(d);
    accrueProactiveClocks(d,60000,'OFFLINE');accrueProactiveClocks(e,60000,'OFFLINE');processTradeBoundary(d);processTradeBoundary(e);
    assert.deepStrictEqual(encodePersistable(d),encodePersistable(e));
  });
  test('Phase J: direct legacy negotiation is explicitly unavailable',()=>{
    const s=world(),o=new Orchestrator(s);const r=o.execute(cmdReq('NEGOTIATE','ai',{factionId:'me',targetFactionId:'enemy'}));assert.ok(!r.success);
    assert.strictEqual(getCommandDefinition('NEGOTIATE')!.status,'unsupported');assert.strictEqual(o.getState().opinionEvents.size,0);
  });
  test('Phase J: Opinion does not decay merely because time passes',()=>{
    const s=world();applyOpinionEvent(s,'harm','me','enemy','harm',-37);s.worldTick=100000;s.accruedTargetWorldTick=s.worldTick;
    refreshGoals(s);assert.strictEqual(reload(s).factions.get('me')!.diplomacy.get('enemy')!.opinion,-37);
  });
  test('Phase J: Goal change cannot create same-boundary recursive opportunities',()=>{
    const s=world();primeSourceDecision(s,'me');assignGoal(s,'me','control',{kind:'CONTROL_TERRITORY',territoryId:'target'});const o=new Orchestrator(s);
    assert.ok(o.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'})).success);const n=o.getState().operations.size;
    for(let i=0;i<5;i++)assert.ok(o.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'})).success);assert.strictEqual(o.getState().operations.size,n);
  });

  test('Phase J: stale supplied Goal support cannot override fresh canonical objective',()=>{
    const s=world(),g=assignGoal(s,'me','control',{kind:'CONTROL_TERRITORY',territoryId:'target'}),stale=structuredClone(g);
    g.lifecycle!.objective={kind:'DEVELOPMENT',territoryId:'home',projectType:'FARM'};
    assert.strictEqual(assessGoalProgress(s,'me',stale,attack(s)).direction,'NEUTRAL');
  });
  test('Phase J: actual comparison and own required response cannot inspect opponent private cognition',()=>{
    const s=world(),enemy=s.factions.get('enemy')!;for(const key of ['goals','memory','personality','ambition','diplomacy'] as const)Object.defineProperty(enemy,key,{get(){throw new Error(`foreign private ${key}`);}});
    assert.doesNotThrow(()=>comparison(s));assert.doesNotThrow(()=>assessRequiredPeaceResponse(s,'me','enemy'));
  });
  test('Phase J: unchanged cheap observation does not refresh or rescore Goals',()=>{
    const s=world();for(const t of s.territories.values()){t.baseValue=0;t.resourceOutput={};}for(const f of s.factions.values())f.resources={gold:0,food:0,wood:0,iron:0,stone:0};
    assignGoal(s,'me','control',{kind:'CONTROL_TERRITORY',territoryId:'target'});const original=require('../src/cognition/goals').refreshGoals;
    require('../src/cognition/goals').refreshGoals=()=>{throw new Error('Observer rescored Goals');};
    try{for(let i=0;i<20;i++)assert.strictEqual(prepareProactiveDecision(s,'me'),null);}finally{require('../src/cognition/goals').refreshGoals=original;}
  });

  test('Phase J: legacy Goal creation tick stays unknown rather than fabricated',()=>{
    const s=world();s.schemaVersion=24;s.worldTick=100;s.accruedTargetWorldTick=100;s.turn=5;
    s.factions.get('me')!.goals=[{id:'known-target',type:'destroy_rival',priority:50,targetFaction:'enemy',targetTerritory:null,targetRegion:null,targetResource:null,progress:0,targetProgress:100,deadlineTurn:null,createdTurn:3}];
    const g=reload(s).factions.get('me')!.goals[0]!;assert.strictEqual(g.lifecycle!.status,'ACTIVE');assert.strictEqual(g.lifecycle!.createdAtTick,null);assert.strictEqual(g.createdTurn,3);
  });
  test('Phase J: ambiguous historically finished Goal is archived rather than resurrected',()=>{
    const s=world();s.schemaVersion=24;s.factions.get('me')!.goals=[{id:'historical',type:'destroy_rival',priority:50,targetFaction:'enemy',targetTerritory:null,targetRegion:null,targetResource:null,progress:100,targetProgress:100,deadlineTurn:null,createdTurn:0}];
    const g=reload(s).factions.get('me')!.goals[0]!;assert.strictEqual(g.lifecycle!.status,'INVALIDATED');assert.strictEqual(g.progress,100);
  });
  test('Phase J: fortification Goal recognizes truthful intermediate progress',()=>{
    const s=world();s.territories.get('home')!.fortification=0;const g=assignGoal(s,'me','fortify',{kind:'DEVELOPMENT',territoryId:'home',projectType:'FORTIFICATION',level:2});
    const plan=makeConcretePlan({action:'BUILD',factionId:'me',territoryId:'home',projectType:'FORTIFICATION',targetFortificationLevel:1,resourceSource:{kind:'faction_stock',factionId:'me',resources:{gold:1}}});
    const a=assessGoalProgress(s,'me',g,plan);assert.strictEqual(a.direction,'ADVANCE');assert.ok(a.magnitude>0&&a.magnitude<g.priority/100);
    s.territories.get('home')!.fortification=1;refreshGoals(s);assert.strictEqual(g.lifecycle!.status,'ACTIVE');assert.strictEqual(g.progress,0.5);
  });
  test('Phase J: Trade Goal amplification requires this partner to supply the relevant resource',()=>{
    const s=world();s.worldLevel=2;s.territories.get('home')!.resourceOutput={food:5};s.territories.get('target')!.resourceOutput={food:5};
    s.factions.get('me')!.resources={gold:100,wood:0,food:0,stone:0,iron:0};s.factions.get('enemy')!.resources={gold:0,wood:100,food:0,stone:0,iron:0};
    const source=deriveSources(s,'me',0).find(c=>c.domain==='TRADE_ECONOMIC'&&c.counterpartyId==='enemy')!;assert.ok(source);
    assignGoal(s,'me','food',{kind:'RESOURCE_HOLDING',resource:'food',quantity:20});assert.strictEqual(goalMatchesSource(s,source),false);
    s.factions.get('enemy')!.resources.food=100;assert.strictEqual(goalMatchesSource(s,source),true);
  });

  test('Phase J: pressure observer skips unrelated Goal factual predicates',()=>{
    const s=world(),source=deriveSources(s,'me',0).find(c=>c.kind==='HOSTILE_OPPORTUNITY')!;assert.ok(source);
    assignGoal(s,'me','fortify',{kind:'DEVELOPMENT',territoryId:'home',projectType:'FORTIFICATION',level:GAMEPLAY_CONFIG.maxFortificationLevel});
    Object.defineProperty(s.territories.get('home')!,'fortification',{get(){throw new Error('Unrelated Goal assessment');}});
    assert.strictEqual(goalMatchesSource(s,source),false);
  });
  test('Phase J: legacy unknown creation boundary does not permit negative terminal time',()=>{
    const s=world(),g=assignGoal(s,'me','goal',{kind:'CONTROL_TERRITORY',territoryId:'target'});
    g.lifecycle!.createdAtTick=null;g.lifecycle!.status='INVALIDATED';g.lifecycle!.resolvedAtTick=-1;
    assert.ok(cognitionStateProblems(s).some(p=>p.includes('Invalid Goal lifecycle')));
  });
  const eventOutput=(s:GameState,opinionEffects:import('../src/events/EventModel').AuthoredOpinionEffect[]=[])=>({mutatedTerritories:new Map(),mutatedFactions:cloneGameState(s).factions,
    newActiveEvents:s.activeEvents,newEventHistory:s.eventHistory,triggeredEvents:[],perTurnConsequences:[],expiredEvents:[],unresolvedDecisions:[],summary:[],opinionEffects});
  test('Phase J review: committed contingent attack cannot earn duplicate Goal advancement',()=>{
    const s=world(),g=assignGoal(s,'me','capture',{kind:'CONTROL_TERRITORY',territoryId:'target'}),o=new Orchestrator(s);
    assert.ok(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:attack(s)})).success);
    const d=cloneGameState(o.getState()),selected=attack(s);
    if(selected.action!=='ATTACK')throw new Error('Expected exact ATTACK fixture');
    const {id:priorId,...draft}=selected,other=makeConcretePlan({...draft,armyId:'b'});
    assert.strictEqual(currentGoal(d,'me',g).status,'ACTIVE');
    assert.strictEqual(assessGoalProgress(d,'me',g,other).realization,'ALREADY_COMMITTED');
    assert.strictEqual(goalPreference(d,'me',other,T.modifierBound).value,0);
  });
  test('Phase J review: stale event output cannot overwrite canonical Goal lifecycle',()=>{
    const s=world(),g=assignGoal(s,'me','capture',{kind:'CONTROL_TERRITORY',territoryId:'target'}),output=eventOutput(s);
    g.lifecycle!.status='INVALIDATED';g.lifecycle!.resolvedAtTick=s.worldTick;
    mergeEventStepOntoGameState(s,output);
    assert.strictEqual(s.factions.get('me')!.goals[0]!.lifecycle!.status,'INVALIDATED');
  });
  test('Phase J review: unchanged event snapshot cannot invent an Opinion reversal',()=>{
    const s=world();directed(s,'me','enemy',0);const output=eventOutput(s);
    applyOpinionEvent(s,'actual-attack','me','enemy','attack_received',-40);mergeEventStepOntoGameState(s,output);
    assert.strictEqual(s.factions.get('me')!.diplomacy.get('enemy')!.opinion,-40);assert.strictEqual(s.opinionEvents.size,1);
  });
  test('Phase J review: distinct authored effects at one boundary apply independently and replay once',()=>{
    const s=world();directed(s,'me','enemy',0);
    const a=eventOutput(s,[{id:'authored:first',observer:'me',target:'enemy',delta:5}]);a.mutatedFactions.get('me')!.diplomacy.get('enemy')!.opinion=5;
    const b=eventOutput(s,[{id:'authored:second',observer:'me',target:'enemy',delta:6}]);b.mutatedFactions.get('me')!.diplomacy.get('enemy')!.opinion=6;
    mergeEventStepOntoGameState(s,a);mergeEventStepOntoGameState(s,b);mergeEventStepOntoGameState(s,a);
    assert.strictEqual(s.factions.get('me')!.diplomacy.get('enemy')!.opinion,11);assert.strictEqual(s.opinionEvents.size,2);
  });
  test('Phase J review: malformed authored Opinion target cannot create ghost directed state',()=>{
    const s=world(),applier=new ConsequenceApplier(s.territories,s.factions);
    applier.applyMany([{factionId:'me',territoryId:null,message:'malformed',delta:{relationshipDeltaOpinion:{target:'missing',delta:5}}}]);
    assert.strictEqual(applier.factions.get('me')!.diplomacy.has('missing'),false);
  });
  test('Phase J review: current-schema Goals cannot silently lose canonical lifecycle metadata',()=>{
    const s=world(),g=assignGoal(s,'me','capture',{kind:'CONTROL_TERRITORY',territoryId:'target'});delete g.lifecycle;
    assert.throws(()=>reload(s));
  });
  test('Phase J review: malformed event receipt identity/kind is rejected',()=>{
    const s=world();applyOpinionEvent(s,'event','me','enemy','attack_received',-40);
    const [id,e]=[...s.opinionEvents][0]!;e.kind='';assert.ok(cognitionStateProblems(s).length>0);
    e.kind='attack_received';s.opinionEvents.delete(id);const malformed=`opinion:v1:${JSON.stringify([null,'me','enemy'])}`;s.opinionEvents.set(malformed,{...e,id:malformed});
    assert.ok(cognitionStateProblems(s).length>0);
  });
  test('Phase J review: real CAS conflict cannot leak Goal completion or Opinion receipt',()=>{
    const s=world(),store=new InMemoryGameStateStore(),quantity=s.factions.get('me')!.resources.food+1;
    assignGoal(s,'me','food',{kind:'RESOURCE_HOLDING',resource:'food',quantity});assert.ok(store.save('cas-j',s,0).ok);
    const a=store.load('cas-j'),b=store.load('cas-j');assert.ok(a.ok&&b.ok);if(!a.ok||!b.ok)return;
    const mutate=(d:GameState)=>{d.factions.get('me')!.resources.food++;applyOpinionEvent(d,'cas-event','me','enemy','attack_received',-40);};
    const draft=runStateTransaction(a.state,mutate).state;assert.strictEqual(draft.factions.get('me')!.goals[0]!.lifecycle!.status,'COMPLETED');
    assert.ok(store.save('cas-j',b.state,b.record.stateVersion).ok);assert.strictEqual(store.save('cas-j',draft,a.record.stateVersion).ok,false);
    const current=store.load('cas-j');assert.ok(current.ok);if(!current.ok)return;
    assert.strictEqual(current.state.factions.get('me')!.goals[0]!.lifecycle!.status,'ACTIVE');assert.strictEqual(current.state.opinionEvents.size,0);
    assert.ok(store.save('cas-j',runStateTransaction(current.state,mutate).state,current.record.stateVersion).ok);
    const final=store.load('cas-j');assert.ok(final.ok);if(!final.ok)return;
    assert.strictEqual(final.state.opinionEvents.size,1);assert.strictEqual(applyOpinionEvent(final.state,'cas-event','me','enemy','attack_received',-40),false);
    assert.strictEqual(final.state.factions.get('me')!.goals[0]!.lifecycle!.status,'COMPLETED');assert.strictEqual(final.state.factions.get('me')!.diplomacy.get('enemy')!.opinion,-40);
  });
  test('Phase J review: authored effects flow through WorldSimulator with event-instance identity',()=>{
    const s=world(),registry=require('../src/events/EventDefinitions').EVENT_REGISTRY;
    const original=registry.evt_drought.perTurn;registry.evt_drought.perTurn=()=>[{factionId:'me',message:'authored goodwill',delta:{relationshipDeltaOpinion:{target:'enemy',delta:5}}}];
    s.activeEvents=[{instanceId:'authored-instance',typeId:'evt_drought',category:'environmental',title:'fixture',description:'fixture',causes:[],severity:'minor',status:'active',territoryId:'home',factionId:'me',triggeredTurn:0,durationTurns:10,startedTurn:0,expiresTurn:10,consequences:[],chainDelays:[],choicesPending:[]}];
    try{const output=new WorldSimulator().simulate(toWorldStepInput(s));assert.deepStrictEqual(output.opinionEffects,[{id:'world-event:0:perTurn:authored-instance:0',observer:'me',target:'enemy',delta:5}]);
      mergeEventStepOntoGameState(s,output);assert.strictEqual(s.factions.get('me')!.diplomacy.get('enemy')!.opinion,5);
      const d=reload(s);mergeEventStepOntoGameState(d,output);assert.strictEqual(d.factions.get('me')!.diplomacy.get('enemy')!.opinion,5);assert.strictEqual(d.opinionEvents.size,1);
    }finally{registry.evt_drought.perTurn=original;}
  });
  test('Phase J review: impossible authored development and self-diplomacy objectives are rejected',()=>{
    const s=world();assert.throws(()=>assignGoal(s,'me','impossible',{kind:'DEVELOPMENT',territoryId:'home',projectType:'FORTIFICATION',level:GAMEPLAY_CONFIG.maxFortificationLevel+1}));
    assert.throws(()=>assignGoal(s,'me','self',{kind:'PEACE',factionId:'me'}));
    assert.throws(()=>assignGoal(s,'me','unsupported-upgrade',{kind:'DEVELOPMENT',territoryId:'home',projectType:'FARM',level:2}));
  });
  test('Phase J review: actual invasion and conquest have one hostility and one distinct loss consequence',()=>{
    const s=world();s.playerFactionId='enemy';s.levelAnchorTerritoryIds=[];s.territories.get('target')!.garrison=0;s.armies.get('a')!.location='stage';
    const g=assignGoal(s,'me','capture',{kind:'CONTROL_TERRITORY',territoryId:'target'});
    beginInvasionAgainstPlayer(s,{attackerId:'me',territoryId:'target',armies:[s.armies.get('a')!],bypassPlayerDefenseGates:true});
    assert.strictEqual(g.lifecycle!.status,'ACTIVE');assert.strictEqual(s.opinionEvents.size,1);
    const id=[...s.activeInvasions.keys()][0]!;resolveInvasionBattle(s,new BattleEngine(),id,'undefended');
    assert.strictEqual(s.territories.get('target')!.owner,'me');assert.strictEqual(g.lifecycle!.status,'COMPLETED');
    assert.strictEqual([...s.opinionEvents.values()].filter(e=>e.kind==='attack_received').length,1);
    assert.strictEqual([...s.opinionEvents.values()].filter(e=>e.kind==='territory_lost').length,1);
    assert.strictEqual(s.factions.get('enemy')!.diplomacy.get('me')!.opinion,C.eventDelta.attack_received+C.eventDelta.territory_lost);
    assert.throws(()=>resolveInvasionBattle(s,new BattleEngine(),id,'undefended'));assert.strictEqual(s.opinionEvents.size,2);
  });
  test('Phase J review: asymmetric directed stances clone and reload independently',()=>{
    const s=world();directed(s,'me','enemy',-80);directed(s,'enemy','me',35);const d=reload(cloneGameState(s));
    assert.strictEqual(d.factions.get('me')!.diplomacy.get('enemy')!.opinion,-80);assert.strictEqual(d.factions.get('enemy')!.diplomacy.get('me')!.opinion,35);
    d.factions.get('me')!.diplomacy.get('enemy')!.opinion=0;assert.strictEqual(s.factions.get('me')!.diplomacy.get('enemy')!.opinion,-80);
  });
  test('Phase J review: committed incoming cargo covers future Goal need but never current completion',()=>{
    const s=pendingTrade();assert.ok(settleTradeProposal(s,liveTradeProposals(s)[0]!.id,'accepted'));
    const g=assignGoal(s,'me','food',{kind:'RESOURCE_HOLDING',resource:'food',quantity:s.factions.get('me')!.resources.food+10});
    const p=makeConcretePlan({action:'TRADE',factionId:'me',counterpartyId:'spectator',offered:{wood:1},requested:{food:1}});
    assert.strictEqual(g.lifecycle!.status,'ACTIVE');assert.strictEqual(goalPreference(s,'me',p,T.modifierBound).value,0);
    const incoming=[...s.tradeShipments.values()].find(sh=>sh.recipient==='me')!;incoming.phase='blocked';incoming.blockedAtTick=s.worldTick;incoming.blockedReason='route lost';s.tradeShipments.set(incoming.id,incoming);
    assert.ok(goalPreference(s,'me',p,T.modifierBound).value>0);assert.strictEqual(g.lifecycle!.status,'ACTIVE');
  });
  test('Phase J review: migration never replays delivered cargo or activated Peace into Opinion',()=>{
    const s=pendingTrade();assert.ok(settleTradeProposal(s,liveTradeProposals(s)[0]!.id,'accepted'));
    for(let i=0;i<30&&[...s.tradeShipments.values()].some(sh=>sh.phase!=='delivered');i++){accrueProactiveClocks(s,s.aiClock.nowMs+100000,'OFFLINE');s.worldTick++;s.accruedTargetWorldTick=s.worldTick;progressTradeShipments(s);}
    assert.ok([...s.tradeShipments.values()].every(sh=>sh.phase==='delivered'));setFixturePeace(s,'me','enemy');directed(s,'me','enemy',-17);
    s.schemaVersion=24;s.opinionEvents.clear();const d=reload(s),before=encodePersistable([...d.factions].map(([id,f])=>[id,f.diplomacy]));
    processTradeBoundary(d);processPeaceBoundary(d);
    assert.deepStrictEqual(encodePersistable([...d.factions].map(([id,f])=>[id,f.diplomacy])),before);assert.strictEqual(d.opinionEvents.size,0);
  });
  test('Phase J review: completed Goal is removed from the actual deliberation-completion comparison',()=>{
    const s=world(),g=assignGoal(s,'me','capture',{kind:'CONTROL_TERRITORY',territoryId:'target'});primeSourceDecision(s,'me');
    g.lifecycle!.objective={kind:'CONTROL_TERRITORY',territoryId:'stage'};
    const original=ContextPlanComparator.prototype.compare;let compared=0;
    ContextPlanComparator.prototype.compare=function(...args){const result=original.apply(this,args);compared++;
      assert.ok(result.comparisons.every(c=>!c.goalIds.includes(g.id)&&c.contributions.filter(x=>x.owner==='GOAL_MODIFIER').every(x=>x.normalizedMagnitude===0)));return result;};
    try{const o=new Orchestrator(s);assert.ok(o.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'})).success);assert.strictEqual(compared,1);
      assert.strictEqual(o.getState().factions.get('me')!.goals[0]!.lifecycle!.status,'COMPLETED');
    }finally{ContextPlanComparator.prototype.compare=original;}
  });
  test('Phase J review: retained event output cannot mutate canonical Goal or Opinion references',()=>{
    const s=world();assignGoal(s,'me','control',{kind:'CONTROL_TERRITORY',territoryId:'target'});directed(s,'me','enemy',20);
    s.factions.get('me')!.diplomacy.get('enemy')!.treaties.push({type:'non_aggression',with:'enemy',signedTurn:0,expiresTurn:null,terms:{gold:10}});
    const output=eventOutput(s);mergeEventStepOntoGameState(s,output);
    const expected=encodePersistable({goals:s.factions.get('me')!.goals,diplomacy:s.factions.get('me')!.diplomacy});
    const retained=output.mutatedFactions.get('me')!;
    retained.goals[0]!.lifecycle!.status='COMPLETED';retained.goals[0]!.priority=0;retained.diplomacy.get('enemy')!.opinion=-100;retained.diplomacy.get('enemy')!.treaties[0]!.terms.gold=0;
    assert.deepStrictEqual(encodePersistable({goals:s.factions.get('me')!.goals,diplomacy:s.factions.get('me')!.diplomacy}),expected);
  });
  test('Phase J review: distinct recaptures at one boundary retain separate territory-loss identities',()=>{
    const s=world(),target=s.territories.get('target')!,a=s.armies.get('a')!,b=s.armies.get('b')!;
    const enemy={...a,id:'enemy-recapture',owner:'enemy'};s.armies.set(enemy.id,enemy);s.factions.get('enemy')!.armies.push(enemy.id);target.garrison=0;
    const occupy=require('../src/orchestration/applyBattle').applyUnopposedOccupationToGameState;
    occupy(s,target,'me',[a],s.turn);occupy(s,target,'enemy',[enemy],s.turn);occupy(s,target,'me',[b],s.turn);
    assert.strictEqual([...s.opinionEvents.values()].filter(e=>e.kind==='territory_lost'&&e.observer==='enemy').length,2);
    assert.strictEqual(s.factions.get('enemy')!.diplomacy.get('me')!.opinion,2*C.eventDelta.territory_lost);
  });
}
