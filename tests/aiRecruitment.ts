import { accrueProactiveClocks } from '../src/engine/proactiveCognition';
import { getEventByTypeId } from '../src/events/EventDefinitions';
import { ConsequenceApplier } from '../src/events/WorldSimulator';
import type { ConditionContext, ActiveEvent } from '../src/events/EventModel';
import { InMemoryGameStateStore } from '../src/persistence/inMemoryGameStateStore';
import { catchUpWorld } from '../src/world/catchup';
import { StrategicEvaluators } from '../src/scoring/strategicEvaluators';
import { serializePublicGameState, serializeVisibleWorld } from '../src/orchestration/publicView';
import { persistTerritoryFoodAccrual, persistTerritoryAccrual, peekCollectibleResources } from '../src/gameplay/economy/accrual';
import { collectTerritoryYield } from '../src/gameplay/economy/collect';
import { primeSourceDecision } from './aiPressureFixtures';
import { createActiveInvasion } from '../src/types/GameState';
import assert from 'assert';
import { makeOperationTestWorld } from './aiOperationFixtures';
import { GameState } from '../src/types/GameState';
import { RECRUITMENT_TUNING as T } from '../src/constants/recruitment';
import { initializeRecruitment, progressRecruitment, recruitmentPoolId, RECRUITMENT_WORK_PER_TICK as W, progressRecruitmentThroughReceipt } from '../src/gameplay/recruitment/recruitment';
import { availableLocalTroops, reinforcementQuantities } from '../src/gameplay/recruitment/reinforcement';
import { makeConcretePlan, ReinforcePlan } from '../src/types/AIConcretePlan';
import { cloneGameState } from '../src/state/cloneGameState';
import { encodePersistable } from '../src/persistence/serialization';
import { hydratePersistedPayload } from '../src/persistence/hydrate';
import { checkGameStateInvariants } from '../src/state/gameStateInvariants';
import { Orchestrator, createDefaultRegistry } from '../src/orchestration';
import { progressProactiveThrough } from '../src/orchestration/handlers';
import { getCommandDefinition } from '../src/orchestration/commandIndex';
import { buildWarlordStates, toDecisionEngineSnapshot } from '../src/state/gameStateAdapters';
import { accrueWorldThroughReceipt } from '../src/world/worldAccrual';
import { settleOperation, requiredClaims, acquireOperationClaims, operationFromSelection } from '../src/engine/operations';
import { observeSources, sourceConcretePlans } from '../src/engine/strategicPressure';
import { emptyPressureMetrics } from '../src/types/AIPressure';
import { occupiedAttention } from '../src/engine/strategicAttention';
import { assessConcretePlanFeasibility } from '../src/engine/concretePlans';
import { STRATEGIC_EVALUATORS } from '../src/types/StrategicEvaluation';
import { FactualSupport } from '../src/scoring/factualSupport';
import { ContextPlanComparator } from '../src/scoring/contextPlanComparison';
import { settleTerritoryOwnershipChange } from '../src/gameplay/economy/ownership';
import { emptyResources } from '../src/gameplay/economy/config';
import { cityIdFor } from '../src/gameplay/cities/city';
import { runStateTransaction } from '../src/orchestration/transaction';
type Api=Pick<Parameters<typeof import('./aiStrategicEvaluation').registerAiStrategicEvaluationTests>[0],'test'|'makeSelf'|'makeTerritory'|'cmdReq'>;
export function registerAiRecruitmentTests({test,makeSelf,makeTerritory,cmdReq}:Api):void {
  const world=()=>{const s=makeOperationTestWorld(makeSelf,makeTerritory);initializeRecruitment(s);for(const t of s.territories.values())s.territoryEconomy.set(t.id,{territoryId:t.id,lastAccrualTick:0,uncollected:emptyResources()});return s;};
  const fund=(s:GameState,id='home',food=1000)=>{s.territoryEconomy.get(id)!.uncollected.food=food;};
  const pool=(s:GameState,id='home')=>s.territoryRecruitment.get(id)!;
  const plan=(s:GameState,quantity=50,armyId?:string):ReinforcePlan=>makeConcretePlan({action:'REINFORCE',factionId:'me',territoryId:'home',sourcePoolId:recruitmentPoolId('home'),quantity,destination:armyId?{kind:'army',armyId,territoryId:'home'}:{kind:'garrison',territoryId:'home'}}) as ReinforcePlan;
  const context=(s:GameState)=>({req:cmdReq('AI_DECIDE','ai',{warlordId:'me'}),def:getCommandDefinition('AI_DECIDE')!,registry:createDefaultRegistry(),runtime:{aiWarlordStates:buildWarlordStates(s)}});
  const begin=(s:GameState,p=plan(s))=>{const o=new Orchestrator(s),r=o.execute(cmdReq('START_AI_OPERATION','ai',{plan:p}));assert.ok(r.success,JSON.stringify(r.errors));return cloneGameState(o.getState());};
  const advance=(s:GameState,ms:number)=>progressProactiveThrough(s,context(s),ms);
  const online=(s:GameState,end=100000)=>{s.gameplaySessionLeases=[{sessionId:'online',openedAtMs:0,expiresAtMs:end,endedAtMs:null,lastReceiptAtMs:0,lastRenewalRequestId:null} as GameState['gameplaySessionLeases'][number]];};
  test('Phase G: automatic Food-funded troops require no AI decision or operation',()=>{const s=world();fund(s);const bank={...s.factions.get('me')!.resources};const r=progressRecruitment(s,W*10n);assert.strictEqual(pool(s).troops,10*T.troopsPerSimulationTick);assert.strictEqual(r.foodConsumed,pool(s).troops*T.foodPerTroop);assert.strictEqual(s.operations.size,0);assert.deepStrictEqual(s.factions.get('me')!.resources,bank);});
  test('Phase G: zero local Food gives zero troops despite abundant faction Food',()=>{const s=world();progressRecruitment(s,W*1000n);assert.strictEqual(pool(s).troops,0);assert.strictEqual(pool(s).fractionalWork,'0');});
  test('Phase G: Food limits generation exactly and cannot fund starving backlog',()=>{const s=world();fund(s,'home',3*T.foodPerTroop);progressRecruitment(s,W*100n);assert.strictEqual(pool(s).troops,3);assert.strictEqual(s.territoryEconomy.get('home')!.uncollected.food,0);fund(s,'home',1*T.foodPerTroop);progressRecruitment(s,W*101n);assert.strictEqual(pool(s).troops,4);});
  test('Phase G: fractional work persists through serialization and split intervals',()=>{const s=world();fund(s);progressRecruitment(s,W/3n);assert.ok(BigInt(pool(s).fractionalWork)>0n);s.lastAccrualAtMs=0;s.subTickMicroticks=333333;s.accrualDivisionRemainder=20000;const a=cloneGameState(s),b=hydratePersistedPayload(encodePersistable(s));progressRecruitment(a,W);progressRecruitment(b,W*2n/3n);progressRecruitment(b,W);assert.deepStrictEqual(a.territoryRecruitment,b.territoryRecruitment);assert.strictEqual(pool(a).troops,T.troopsPerSimulationTick);});
  test('Phase G: fine versus coarse stocked fractional recruitment is exactly equivalent',()=>{const a=world();fund(a);const b=cloneGameState(a);for(let i=1;i<=99;i++)progressRecruitment(a,W*BigInt(i)/10n);progressRecruitment(b,W*99n/10n);assert.deepStrictEqual(a.territoryRecruitment,b.territoryRecruitment);assert.deepStrictEqual(a.territoryEconomy,b.territoryEconomy);});
  test('Phase G: sub-microtick division remainder is retained exactly',()=>{const s=world();fund(s);progressRecruitment(s,1n);assert.strictEqual(pool(s).fractionalWork,String(T.troopsPerSimulationTick));progressRecruitment(s,W);assert.strictEqual(pool(s).troops,T.troopsPerSimulationTick);});
  test('Phase G: completed City hook uses provisional centralized multiplier only',()=>{const s=world();fund(s);s.cities.set(cityIdFor('home'),{id:cityIdFor('home'),territoryId:'home',factionId:'me',buildings:[{type:'CITY',level:1,completedAtTick:0}]});progressRecruitment(s,W);assert.strictEqual(pool(s).troops,T.troopsPerSimulationTick*T.completedCityRateMultiplier);});
  test('Phase G: in-progress City does not grant completed recruitment effect',()=>{const s=world();fund(s);s.constructions.set('pending',{id:'pending',factionId:'me',territoryId:'home',projectType:'CITY',startedAtTick:0,lastProgressTick:0,durationTicks:10,remainingTicks:10,status:'in_progress',completedAtTick:null});progressRecruitment(s,W);assert.strictEqual(pool(s).troops,T.troopsPerSimulationTick);});
  test('Phase G: starvation in one territory cannot consume another territory Food',()=>{const s=world();fund(s,'stage');progressRecruitment(s,W*10n);assert.strictEqual(pool(s).troops,0);assert.strictEqual(pool(s,'stage').troops,10*T.troopsPerSimulationTick);});
  test('Phase G: player banked workout troops and progression remain untouched',()=>{const s=world();fund(s,'safe');s.playerRewards.bankedTroops=777;const before=encodePersistable({rewards:s.playerRewards,fitness:s.playerFitness});progressRecruitment(s,W*100n);assert.ok(!s.territoryRecruitment.has('safe'));assert.deepStrictEqual(encodePersistable({rewards:s.playerRewards,fitness:s.playerFitness}),before);});
  test('Phase G: exact garrison allocation conserves pool plus deployed troops',()=>{const s=world();pool(s).troops=100;const before=s.territories.get('home')!.garrison;const d=begin(s);assert.strictEqual(pool(d).troops,100);assert.strictEqual(availableLocalTroops(d,'home'),50);advance(d,9999);assert.strictEqual(d.territories.get('home')!.garrison,before);advance(d,10000);assert.strictEqual(pool(d).troops,50);assert.strictEqual(d.territories.get('home')!.garrison,before+50);assert.strictEqual(d.operationClaims.size,0);});
  test('Phase G: exact stationary army allocation cannot select another army',()=>{const s=world();pool(s).troops=100;const before=s.armies.get('b')!.soldiers;const d=begin(s,plan(s,60,'b'));advance(d,10000);assert.strictEqual(d.armies.get('b')!.soldiers,before+60);assert.strictEqual(d.armies.get('a')!.soldiers,s.armies.get('a')!.soldiers);assert.strictEqual(pool(d).troops,40);});
  test('Phase G: REINFORCE empty pool cannot purchase troops from rich bank',()=>{const s=world(),o=new Orchestrator(s),before=encodePersistable(s);assert.ok(!o.execute(cmdReq('REINFORCE','ai',{plan:plan(s)})).success);assert.deepStrictEqual(encodePersistable(o.getState()),before);});
  test('Phase G: wrong pool identity is rejected',()=>{const s=world();pool(s).troops=100;const p=makeConcretePlan({...plan(s),id:undefined,sourcePoolId:'other'} as never);assert.ok(!new Orchestrator(s).execute(cmdReq('START_AI_OPERATION','ai',{plan:p})).success);});
  test('Phase G: remote army is not a legal local reinforcement destination',()=>{const s=world();pool(s).troops=100;s.armies.get('b')!.location='stage';assert.ok(!assessConcretePlanFeasibility(plan(s,50,'b'),toDecisionEngineSnapshot(s)).feasible);});
  test('Phase G: remote garrison plan rejected structurally',()=>{const s=world();pool(s).troops=100;const p=makeConcretePlan({action:'REINFORCE',factionId:'me',territoryId:'home',sourcePoolId:recruitmentPoolId('home'),quantity:50,destination:{kind:'garrison',territoryId:'stage'}});assert.ok(!new Orchestrator(s).execute(cmdReq('START_AI_OPERATION','ai',{plan:p})).success);});
  test('Phase G: force claim blocks MOVE during timed army allocation atomically',()=>{const s=world();pool(s).troops=100;const d=begin(s,plan(s,60,'b')),o=new Orchestrator(d),before=encodePersistable(o.getState());const p=makeConcretePlan({action:'MOVE',factionId:'me',armyId:'b',originTerritoryId:'home',destinationTerritoryId:'stage',route:['home','stage']});assert.ok(!o.execute(cmdReq('START_AI_OPERATION','ai',{plan:p})).success);assert.deepStrictEqual(encodePersistable(o.getState()),before);});
  test('Phase G: moving force cannot receive ordinary reinforcement',()=>{const s=world();pool(s).troops=100;const o=new Orchestrator(s);assert.ok(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:makeConcretePlan({action:'MOVE',factionId:'me',armyId:'b',originTerritoryId:'home',destinationTerritoryId:'stage',route:['home','stage']})})).success);assert.ok(!o.execute(cmdReq('START_AI_OPERATION','ai',{plan:plan(s,50,'b')})).success);});
  test('Phase G: engaged attack force cannot receive reinforcement',()=>{const s=world();pool(s).troops=100;s.armies.get('a')!.attackIntent={targetTerritoryId:'target',stagingTerritoryId:'stage',status:'ready'} as never;assert.ok(!assessConcretePlanFeasibility(plan(s,50,'a'),toDecisionEngineSnapshot(s)).feasible);});
  test('Phase G: existing model does not fabricate a new army from the pool',()=>{const s=world();pool(s).troops=100;const p=makeConcretePlan({action:'REINFORCE',factionId:'me',territoryId:'home',sourcePoolId:recruitmentPoolId('home'),quantity:50,destination:{kind:'new_army',territoryId:'home'}});assert.ok(!assessConcretePlanFeasibility(p,toDecisionEngineSnapshot(s)).feasible);});
  test('Phase G: quantity claims prevent double spending without locking entire pool',()=>{const s=world();pool(s).troops=100;const d=begin(s,plan(s,60,'a'));const q=plan(d,50,'b'),r=assessConcretePlanFeasibility(q,toDecisionEngineSnapshot(d));assert.ok(r.rejections.some(r=>r.kind==='CLAIM'));assert.ok(!r.rejections.some(r=>r.kind==='LEGALITY'));assert.strictEqual(availableLocalTroops(d,'home'),40);assert.ok(assessConcretePlanFeasibility(plan(d,40,'b'),toDecisionEngineSnapshot(d)).feasible);});
  test('Phase G: second primary initiation cannot race despite free local quantity',()=>{const s=world();pool(s).troops=100;const d=begin(s,plan(s,40,'a')),o=new Orchestrator(d),before=encodePersistable(d);assert.ok(!o.execute(cmdReq('START_AI_OPERATION','ai',{plan:plan(d,40,'b')})).success);assert.deepStrictEqual(encodePersistable(o.getState()),before);});
  test('Phase G: online initiation is exactly one second with no immediate allocation',()=>{const s=world();pool(s).troops=100;online(s);const d=begin(s);const op=[...d.operations.values()][0]!;assert.strictEqual(op.initiationTimer!.onlineDurationMs,1000);assert.strictEqual(op.initiationTimer!.offlineDurationMs,10000);advance(d,999);assert.strictEqual(pool(d).troops,100);advance(d,1000);assert.strictEqual(pool(d).troops,50);});
  test('Phase G: mid-initiation reload preserves ID, quantity, claims and remaining progress',()=>{const s=world();pool(s).troops=100;const a=begin(s);advance(a,4567);const b=hydratePersistedPayload(encodePersistable(a));advance(a,10000);advance(b,10000);assert.deepStrictEqual(encodePersistable(a),encodePersistable(b));});
  test('Phase G: online timing does not demote after disconnect',()=>{const s=world();pool(s).troops=100;online(s,500);const d=begin(s);advance(d,500);advance(d,1000);assert.strictEqual(pool(d).troops,50);});
  test('Phase G: offline timing promotes without erasing previously earned work',()=>{const s=world();pool(s).troops=100;const d=begin(s);advance(d,5000);d.gameplaySessionLeases=[{sessionId:'promote',openedAtMs:5000,expiresAtMs:20000,endedAtMs:null,lastReceiptAtMs:5000,lastRenewalRequestId:null} as GameState['gameplaySessionLeases'][number]];advance(d,5499);assert.strictEqual(pool(d).troops,100);advance(d,5500);assert.strictEqual(pool(d).troops,50);});
  test('Phase G: destination loss cancels without losing reserved troops or giving relief',()=>{const s=world();pool(s).troops=100;const d=begin(s,plan(s,50,'b'));d.armies.delete('b');d.factions.get('me')!.armies=['a'];advance(d,1000);assert.strictEqual(pool(d).troops,100);assert.strictEqual(d.operationClaims.size,0);assert.ok([...d.operations.values()][0]!.terminal);assert.strictEqual(d.aiDecisionOpportunities.get('me')!.spacing,null);});
  test('Phase G: provisional conquest policy destroys local pool without redistributing it',()=>{const s=world();pool(s).troops=100;const d=begin(s);settleTerritoryOwnershipChange(d,'home','enemy','me');assert.ok(!d.territoryRecruitment.has('home'));assert.strictEqual(d.operationClaims.size,0);assert.strictEqual([...d.operations.values()][0]!.terminal!.outcome,'failed');assert.ok(!d.aiDecisionOpportunities.get('me')!.spacing);});
  test('Phase G: duplicate terminal handling cannot allocate or refund twice',()=>{const s=world();pool(s).troops=100;const d=begin(s);advance(d,10000);const before=encodePersistable(d),id=[...d.operations.keys()][0]!;assert.strictEqual(settleOperation(d,id,'completed','replay'),false);advance(d,10000);assert.deepStrictEqual(encodePersistable(d),before);});
  test('Phase G: zero Attention allocation remains claim- and primary-gated',()=>{const s=world();pool(s).troops=100;s.strategicAttention.capacity=0;const d=begin(s);assert.strictEqual(occupiedAttention(d,'me'),0);assert.ok(d.aiDecisionOpportunities.get('me')!.primaryOperationId);assert.ok(d.operationClaims.size>0);});
  test('Phase G: local pool alone does not create activity pressure',()=>{const s=world();pool(s).troops=999;observeSources(s,'me');assert.ok(![...s.aiPressure.values()].some(s=>s.kind==='COVERAGE_GAP'));});
  const threatened=()=>{const s=world();s.territories.get('home')!.neighboring.push('target');s.territories.get('target')!.neighboring.push('home');s.factions.get('me')!.diplomacy.set('enemy',{target:'enemy',state:'at_war',opinion:0,treaties:[],yearsAtPeace:0,yearsAtWar:1});s.armies.clear();s.factions.get('me')!.armies=[];s.armies.set('hostile',{id:'hostile',owner:'enemy',location:'target',soldiers:600,knights:0,siegeEngines:0,morale:80,supply:80});s.factions.get('enemy')!.armies=['hostile'];return s;};
  test('Phase G review: factual City and fortification defense end an otherwise raw-count coverage gap',()=>{
    for(const defense of ['city','fortification'] as const){
      const s=threatened();s.worldLevel=2;pool(s).troops=9999;s.territories.get('home')!.garrison=560;
      if(defense==='city')s.cities.set(cityIdFor('home'),{id:cityIdFor('home'),territoryId:'home',factionId:'me',buildings:[]});
      else s.territories.get('home')!.fortification=3;
      assert.strictEqual(new StrategicEvaluators(new FactualSupport(s)).localDanger('me','home').facts.shortfall,0);
      observeSources(s,'me');assert.ok(![...s.aiPressure.values()].some(c=>c.kind==='COVERAGE_GAP'&&c.subjectId==='home'));
    }
  });
  test('Phase G review: allocation benefit is marginal to actual mixed-morale local defenders',()=>{
    for(const destination of ['garrison','army'] as const){
      const s=threatened();pool(s).troops=1000;
      for(const [id,morale]of [['low',20],['high',90]]as const)s.armies.set(id,{id,owner:'me',location:'home',soldiers:30,knights:0,siegeEngines:0,morale,supply:80});
      s.factions.get('me')!.armies=['low','high'];
      const p=plan(s,50,destination==='army'?'high':undefined),e=new StrategicEvaluators(new FactualSupport(s)),before=e.localDanger('me','home').facts;
      const changed=cloneGameState(s);
      if(destination==='garrison')changed.territories.get('home')!.garrison+=p.quantity;
      else changed.armies.get('high')!.soldiers+=p.quantity;
      const after=new StrategicEvaluators(new FactualSupport(changed)).localDanger('me','home').facts;
      assert.strictEqual(e.localAllocationValue(p).facts.defenseGain,Math.min(before.shortfall,after.defensePower-before.defensePower));
    }
  });
  test('Phase G: local coverage need creates truthful blocked pool-threshold source',()=>{const s=threatened();observeSources(s,'me');const source=[...s.aiPressure.values()].find(s=>s.kind==='COVERAGE_GAP')!;assert.ok(source);assert.ok(source.blocked);assert.ok(source.blockers.some(b=>b.plan.action==='REINFORCE'));});
  test('Phase G: +1 pool increments cannot rearm before meaningful batch threshold',()=>{const s=threatened(),m=emptyPressureMetrics();observeSources(s,'me',m);const c=[...s.aiPressure.values()].find(s=>s.kind==='COVERAGE_GAP')!,revision=c.revision;for(let i=1;i<T.meaningfulBatch;i++){pool(s).troops=i;observeSources(s,'me',m);assert.ok(c.blocked);assert.strictEqual(c.revision,revision);}assert.strictEqual(m.rearmed,0);pool(s).troops=T.meaningfulBatch;observeSources(s,'me',m);assert.ok(!c.blocked);assert.strictEqual(m.rearmed,1);});
  test('Phase G: bounded batch enumeration never enumerates one through pool size',()=>{assert.ok(reinforcementQuantities(100000).length<=3);assert.deepStrictEqual(reinforcementQuantities(10),[10]);assert.deepStrictEqual(reinforcementQuantities(0),[]);});
  test('Phase G: source-scoped reinforcement candidates retain exact local quantities',()=>{const s=threatened();pool(s).troops=1000;observeSources(s,'me');const c=[...s.aiPressure.values()].find(s=>s.kind==='COVERAGE_GAP')!;const plans=sourceConcretePlans(s,c);assert.ok(plans.some(p=>p.action==='REINFORCE'));assert.ok(plans.every(p=>p.action==='REINFORCE'||p.action==='WAIT'));const copy=hydratePersistedPayload(encodePersistable(s));assert.deepStrictEqual(sourceConcretePlans(copy,copy.aiPressure.get(c.id)!).map(p=>p.id),plans.map(p=>p.id));});
  test('Phase G: seven factual evaluators score allocation without a reinforcement evaluator',()=>{const s=threatened();pool(s).troops=1000;observeSources(s,'me');const c=[...s.aiPressure.values()].find(s=>s.kind==='COVERAGE_GAP')!,plans=sourceConcretePlans(s,c),comparison=new ContextPlanComparator().compare(s,c,plans);assert.strictEqual(STRATEGIC_EVALUATORS.length,7);assert.ok(comparison.comparisons.some(c=>c.plan.action==='REINFORCE'&&c.finalValue>0));for(const row of comparison.comparisons)assert.strictEqual(new Set(row.contributions.map(c=>c.causalKey)).size,row.contributions.length);});
  test('Phase G: committed reserved troops are unavailable and not prematurely deployed in baseline',()=>{const s=world();pool(s).troops=100;const d=begin(s,plan(s,60,'b')),support=new FactualSupport(d);assert.deepStrictEqual(support.localPools.get('home'),{troops:100,available:40,reserved:60});assert.strictEqual(support.armies.get('b')!.soldiers,s.armies.get('b')!.soldiers);assert.ok(support.committed.some(e=>e.id===[...d.operations.keys()][0]));});
  test('Phase G: schema-21 migration adds no historical troops/fractions and preserves canonical AI state',()=>{const s=world();s.schemaVersion=21;delete (s as unknown as {territoryRecruitment?:unknown}).territoryRecruitment;s.worldTick=100;s.accruedTargetWorldTick=100;const before=encodePersistable({operations:s.operations,claims:s.operationClaims,attention:s.strategicAttention,pressure:s.aiPressure,opportunities:s.aiDecisionOpportunities});const loaded=hydratePersistedPayload(encodePersistable(s));assert.strictEqual(loaded.schemaVersion,22);for(const p of loaded.territoryRecruitment.values()){assert.strictEqual(p.troops,0);assert.strictEqual(p.fractionalWork,'0');assert.strictEqual(p.accruedThroughWork,(W*100n).toString());}assert.deepStrictEqual(encodePersistable({operations:loaded.operations,claims:loaded.operationClaims,attention:loaded.strategicAttention,pressure:loaded.aiPressure,opportunities:loaded.aiDecisionOpportunities}),before);});
  test('Phase G: clone isolates pools, fractional work and initiation progress',()=>{const s=world();pool(s).troops=100;const d=begin(s),b=cloneGameState(d);pool(b).troops=20;[...b.operations.values()][0]!.initiationTimer!.progress.wholeTicks=999;assert.strictEqual(pool(d).troops,100);assert.notStrictEqual([...d.operations.values()][0]!.initiationTimer!.progress.wholeTicks,999);});
  test('Phase G: corrupted over-reservation and fractional progress fail canonical invariants',()=>{const s=world();pool(s).troops=100;const d=begin(s);pool(d).troops=1;assert.ok(checkGameStateInvariants(d).some(v=>v.code==='recruitment.invalid_quantity'));pool(d).troops=100;pool(d).fractionalWork=W.toString();assert.ok(checkGameStateInvariants(d).some(v=>v.code==='recruitment.invalid_work'));});
  test('Phase G: failed canonical transaction cannot leak pool, claim or timer mutations',()=>{const s=world();fund(s);const before=encodePersistable(s);assert.throws(()=>runStateTransaction(s,d=>{progressRecruitment(d,W);throw new Error('abort');}));assert.deepStrictEqual(encodePersistable(s),before);});
  test('Phase G: receipt sub-tick recruitment uses exact earned simulation work',()=>{const s=world();fund(s);online(s);accrueWorldThroughReceipt(s,0);accrueWorldThroughReceipt(s,30000);progressRecruitmentThroughReceipt(s,30000);assert.ok(BigInt(pool(s).fractionalWork)>0n);assert.strictEqual(pool(s).troops,0);accrueWorldThroughReceipt(s,60000);progressRecruitmentThroughReceipt(s,60000);assert.strictEqual(pool(s).troops,T.troopsPerSimulationTick);});
  test('Phase G: production funds future local recruitment without COLLECT or bank transfer',()=>{const s=world();s.territories.get('home')!.resourceOutput.food=60;const bank=s.factions.get('me')!.resources.food;const o=new Orchestrator(s);assert.ok(o.execute(cmdReq('ADVANCE_WORLD','ai',{elapsedTicks:10})).success);assert.strictEqual(pool(o.getState()).troops,9*T.troopsPerSimulationTick);assert.strictEqual(o.getState().factions.get('me')!.resources.food,bank);});
  test('Phase G: coarse/fine world progression and reload preserve recruitment with production',()=>{const s=world();s.territories.get('home')!.resourceOutput.food=60;const a=new Orchestrator(s),b=new Orchestrator(cloneGameState(s));assert.ok(a.execute(cmdReq('ADVANCE_WORLD','ai',{elapsedTicks:12})).success);for(let i=0;i<6;i++)assert.ok(b.execute(cmdReq('ADVANCE_WORLD','ai',{elapsedTicks:1})).success);const c=new Orchestrator(hydratePersistedPayload(encodePersistable(b.getState())));for(let i=0;i<6;i++)assert.ok(c.execute(cmdReq('ADVANCE_WORLD','ai',{elapsedTicks:1})).success);assert.deepStrictEqual(a.getState().territoryRecruitment,c.getState().territoryRecruitment);assert.deepStrictEqual(a.getState().territoryEconomy,c.getState().territoryEconomy);});
  test('Phase G: early central success cannot fake allocation or release its reservation',()=>{const s=world();pool(s).troops=100;const d=begin(s),id=[...d.operations.keys()][0]!,before=encodePersistable(d);assert.strictEqual(settleOperation(d,id,'completed','too early'),false);assert.deepStrictEqual(encodePersistable(d),before);});
  test('Phase G: authoritative destination mutation cancels reservation before transaction validation',()=>{const s=world();pool(s).troops=100;const d=begin(s,plan(s,50,'b'));const result=runStateTransaction(d,next=>{next.armies.get('b')!.location='stage';});assert.strictEqual(result.state.operationClaims.size,0);assert.strictEqual(pool(result.state).troops,100);assert.strictEqual([...result.state.operations.values()][0]!.terminal!.outcome,'failed');assert.strictEqual(pool(d).troops,100);assert.ok(d.operationClaims.size>0);});
  test('Phase G: new invasion cancels unfinished local allocation without rejecting the domain event',()=>{const s=world();pool(s).troops=100;const d=begin(s);const result=runStateTransaction(d,next=>{next.activeInvasions.set('incoming',createActiveInvasion({id:'incoming',defenderFactionId:'me',attackerFactionId:'enemy',territoryId:'home',startedAtTick:0,notifiedAtTick:0,responseDeadlineTick:100}));});assert.ok(result.state.activeInvasions.has('incoming'));assert.strictEqual(pool(result.state).troops,100);assert.strictEqual(result.state.operationClaims.size,0);});
  test('Phase G: completed City boundary has identical coarse/fine recruitment and no early bonus',()=>{const s=world();fund(s);s.constructions.set('city',{id:'city',factionId:'me',territoryId:'home',projectType:'CITY',startedAtTick:0,lastProgressTick:0,durationTicks:3,remainingTicks:3,status:'in_progress',completedAtTick:null});const a=new Orchestrator(s),b=new Orchestrator(cloneGameState(s));assert.ok(a.execute(cmdReq('ADVANCE_WORLD','ai',{elapsedTicks:6})).success);for(let i=0;i<6;i++)assert.ok(b.execute(cmdReq('ADVANCE_WORLD','ai',{elapsedTicks:1})).success);assert.strictEqual(pool(a.getState()).troops,3*T.troopsPerSimulationTick+3*T.troopsPerSimulationTick*T.completedCityRateMultiplier);assert.deepStrictEqual(a.getState().territoryRecruitment,b.getState().territoryRecruitment);});
  test('Phase G: migration skips already-earned historical backlog and fractional work',()=>{const s=world();s.schemaVersion=21;s.accruedTargetWorldTick=10;s.subTickMicroticks=500000;s.lastAccrualAtMs=0;delete (s as unknown as {territoryRecruitment?:unknown}).territoryRecruitment;const d=hydratePersistedPayload(encodePersistable(s));fund(d);assert.strictEqual(pool(d).accruedThroughWork,(W*21n/2n).toString());progressRecruitment(d,W*10n);assert.strictEqual(pool(d).troops,0);progressRecruitment(d,W*23n/2n);assert.strictEqual(pool(d).troops,T.troopsPerSimulationTick);});
  test('Phase G: unearned future receipt cannot generate troops',()=>{const s=world();fund(s);online(s);accrueWorldThroughReceipt(s,0);progressRecruitmentThroughReceipt(s,60000);assert.strictEqual(pool(s).troops,0);assert.strictEqual(pool(s).fractionalWork,'0');});
  test('Phase G: negative or altered quantity reservation fails invariants',()=>{const s=world();pool(s).troops=100;const d=begin(s);const c=[...d.operationClaims.values()].find(c=>c.kind==='local_troops')!;c.quantity=49;assert.ok(checkGameStateInvariants(d).some(v=>v.code==='claim.quantity_mismatch'));c.quantity=-1;assert.ok(checkGameStateInvariants(d).some(v=>v.code==='claim.invalid_quantity'));});
  test('Phase G: failed multi-claim acquisition leaves no partial pool reservation',()=>{const s=world();pool(s).troops=100;const d=begin(s,plan(s,50,'b')),before=encodePersistable(d);const selected=operationFromSelection({...([...d.operations.values()][0]!),id:'test-other',plan:plan(d,30,'b')},0);assert.throws(()=>acquireOperationClaims(d,selected));assert.deepStrictEqual(encodePersistable(d),before);});
  test('Phase G: source-bound production cognition relieves pressure only after exact timed allocation',()=>{const s=threatened();pool(s).troops=300;s.factions.get('me')!.resources={gold:0,food:0,wood:0,stone:0,iron:0};primeSourceDecision(s,'me');const o=new Orchestrator(s);assert.ok(o.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'})).success);const selected=[...o.getState().operations.values()][0]!;assert.strictEqual(selected.action,'REINFORCE');const pressure=o.getState().aiPressure.get(selected.sourceContextId!)!.pressure;assert.ok(o.execute(cmdReq('RESOLVE_COMMITMENT','ai',{factionId:'me',operationId:selected.id})).success);const d=cloneGameState(o.getState());assert.strictEqual(d.aiPressure.get(selected.sourceContextId!)!.pressure,pressure);assert.ok(!d.aiDecisionOpportunities.get('me')!.spacing);const beforeGarrison=d.territories.get('home')!.garrison,chosen=selected.plan as ReinforcePlan;advance(d,d.aiClock.nowMs+9999);assert.strictEqual(d.territories.get('home')!.garrison,beforeGarrison);advance(d,d.aiClock.nowMs+1);assert.strictEqual(d.territories.get('home')!.garrison,beforeGarrison+chosen.quantity);assert.ok(d.aiDecisionOpportunities.get('me')!.spacing);assert.ok(d.aiPressure.get(selected.sourceContextId!)!.pressure<pressure);assert.strictEqual(d.operations.get(selected.id)!.terminal!.outcome,'completed');});
  test('Phase G: REINFORCE quantities and relevance do not depend on Map insertion order',()=>{const s=threatened();pool(s).troops=1000;observeSources(s,'me');const a=[...s.aiPressure.values()].find(s=>s.kind==='COVERAGE_GAP')!,plans=sourceConcretePlans(s,a).map(p=>p.id);const d=cloneGameState(s);d.territories=new Map([...d.territories].reverse());d.armies=new Map([...d.armies].reverse());d.territoryRecruitment=new Map([...d.territoryRecruitment].reverse());observeSources(d,'me');assert.deepStrictEqual(sourceConcretePlans(d,d.aiPressure.get(a.id)!).map(p=>p.id),plans);});

  test('Phase G: empty physical pool is LEGALITY rejection, not a fabricated claim conflict',()=>{const s=world(),r=assessConcretePlanFeasibility(plan(s),toDecisionEngineSnapshot(s));assert.ok(r.rejections.some(r=>r.kind==='LEGALITY'));assert.ok(!r.rejections.some(r=>r.kind==='CLAIM'));});
  test('Phase G: one-hop staged military source can prepare its exact army locally',()=>{const s=world();s.armies.get('a')!.soldiers=99;s.armies.get('a')!.knights=0;s.armies.get('b')!.soldiers=99;s.armies.get('b')!.knights=0;pool(s).troops=300;s.factions.get('me')!.diplomacy.set('enemy',{target:'enemy',state:'at_war',opinion:0,treaties:[],yearsAtPeace:0,yearsAtWar:1});s.territories.get('target')!.garrison=200;observeSources(s,'me');const c=[...s.aiPressure.values()].find(s=>s.kind==='HOSTILE_OPPORTUNITY')!,plans=sourceConcretePlans(s,c);assert.ok(plans.some(p=>p.action==='REINFORCE'&&p.destination.kind==='army'&&p.destination.armyId==='a'&&p.territoryId==='home'));assert.ok(plans.every(p=>p.action!=='REINFORCE'||p.destination.kind==='army'));});

  test('Phase G: local Food materialization leaves other resource accrual lazy and cannot double credit Food',()=>{const s=world();s.territories.get('home')!.resourceOutput={food:60,wood:60};s.worldTick=10;persistTerritoryFoodAccrual(s,'home');assert.strictEqual(s.territoryEconomy.get('home')!.lastAccrualTick,0);assert.strictEqual(s.territoryEconomy.get('home')!.uncollected.wood,0);assert.strictEqual(s.territoryEconomy.get('home')!.uncollected.food,10);assert.deepStrictEqual(peekCollectibleResources(s,'home'),{gold:0,food:10,wood:10,iron:0,stone:0});persistTerritoryAccrual(s,'home');assert.strictEqual(s.territoryEconomy.get('home')!.uncollected.food,10);assert.strictEqual(s.territoryEconomy.get('home')!.uncollected.wood,10);});
  test('Phase G: collection cannot collect Food already consumed by recruitment or replay prior production',()=>{const s=world();s.territories.get('home')!.resourceOutput.food=60;s.worldTick=10;persistTerritoryFoodAccrual(s,'home');progressRecruitment(s,W*10n);assert.strictEqual(pool(s).troops,10);const before=s.factions.get('me')!.resources.food;collectTerritoryYield(s,{factionId:'me',territoryId:'home',playerId:'ai',consumeGoldenYield:false});assert.strictEqual(s.factions.get('me')!.resources.food,before);s.worldTick=11;persistTerritoryFoodAccrual(s,'home');assert.strictEqual(s.territoryEconomy.get('home')!.uncollected.food,1);});

  test('Phase G: equal earned simulation work recruits equally across mixed authoritative presence',()=>{const a=world();fund(a);online(a,30000);accrueWorldThroughReceipt(a,0);accrueWorldThroughReceipt(a,15000);progressRecruitmentThroughReceipt(a,15000);const b=hydratePersistedPayload(encodePersistable(a));accrueWorldThroughReceipt(a,330000);progressRecruitmentThroughReceipt(a,330000);accrueWorldThroughReceipt(b,30000);progressRecruitmentThroughReceipt(b,30000);accrueWorldThroughReceipt(b,150000);progressRecruitmentThroughReceipt(b,150000);accrueWorldThroughReceipt(b,330000);progressRecruitmentThroughReceipt(b,330000);assert.deepStrictEqual(a.territoryRecruitment,b.territoryRecruitment);const c=world();fund(c);progressRecruitment(c,W);assert.strictEqual(pool(a).troops,pool(c).troops);assert.strictEqual(pool(a).fractionalWork,pool(c).fractionalWork);});
  test('Phase G: local pool and initiation internals do not leak into public/Unity state',()=>{const s=world();pool(s).troops=100;const d=begin(s);const publicText=JSON.stringify([serializePublicGameState(d,'spectator'),serializeVisibleWorld(d,'spectator')]);assert.ok(!/territoryRecruitment|fractionalWork|initiationTimer|local_troops|local-pool:v1/.test(publicText));});

  test('Phase G: offensive allocation analysis uses the exact source target even across staging',()=>{const s=world();pool(s).troops=300;s.armies.get('a')!.soldiers=99;s.armies.get('a')!.knights=0;s.territories.get('target')!.garrison=500;s.factions.get('me')!.diplomacy.set('enemy',{target:'enemy',state:'at_war',opinion:0,treaties:[],yearsAtPeace:0,yearsAtWar:1});const p=plan(s,50,'a');const before=new StrategicEvaluators(new FactualSupport(s)).localAllocationValue(p,'target').facts;assert.ok(before.offensiveGain>0);s.territories.set('unrelated',{...s.territories.get('target')!,id:'unrelated',garrison:9999,neighboring:['home']});s.territories.get('home')!.neighboring.push('unrelated');const e=new StrategicEvaluators(new FactualSupport(s));assert.strictEqual(e.localAllocationValue(p,'target').facts.offensiveGain,before.offensiveGain);assert.strictEqual(e.localAllocationValue(p).facts.offensiveGain,0);});

  test('Phase G: real world coarse/fine progression preserves timed allocation and troop conservation',()=>{const s=world();pool(s).troops=100;fund(s);const pending=begin(s,plan(s,50,'b'));const a=new Orchestrator(pending),b=new Orchestrator(hydratePersistedPayload(encodePersistable(pending)));assert.ok(a.execute(cmdReq('ADVANCE_WORLD','ai',{elapsedTicks:2})).success);for(let i=0;i<2;i++)assert.ok(b.execute(cmdReq('ADVANCE_WORLD','ai',{elapsedTicks:1})).success);const select=(d:GameState)=>encodePersistable({pools:d.territoryRecruitment,food:d.territoryEconomy,armies:d.armies,operations:d.operations,claims:d.operationClaims});assert.deepStrictEqual(select(a.getState()),select(b.getState()));assert.strictEqual(a.getState().armies.get('b')!.soldiers,s.armies.get('b')!.soldiers+50);assert.strictEqual(a.getState().operationClaims.size,0);});

  test('Phase G review: invasion force membership blocks allocation without a retained attack intent',()=>{
    const s=world();pool(s).troops=100;
    s.activeInvasions.set('legacy-engagement',createActiveInvasion({id:'legacy-engagement',attackerFactionId:'me',defenderFactionId:'enemy',territoryId:'target',attackingArmyIds:['b'],startedAtTick:0,notifiedAtTick:0,responseDeadlineTick:100}));
    assert.ok(!assessConcretePlanFeasibility(plan(s,50,'b'),toDecisionEngineSnapshot(s)).feasible);
  });
  test('Phase G review: numeric recruitment work cannot masquerade as persisted exact strings',()=>{
    const s=world();Object.assign(pool(s),{fractionalWork:0,accruedThroughWork:0});
    assert.ok(checkGameStateInvariants(s).some(v=>v.code==='recruitment.invalid_work'));
    assert.throws(()=>hydratePersistedPayload(encodePersistable(s)));
  });
  test('Phase G review: persisted recruitment watermark cannot exceed earned work',()=>{
    const s=world();pool(s).accruedThroughWork=(W+1n).toString();
    assert.ok(checkGameStateInvariants(s).some(v=>v.code==='recruitment.invalid_work'));
    assert.throws(()=>hydratePersistedPayload(encodePersistable(s)));
  });
  test('Phase G review: rebellion casualty consequences cannot create AI troops',()=>{
    const s=world(),def=getEventByTypeId('rebellion')!;
    const ctx={territoryId:'home',helper:{getTerritory:(id:string)=>s.territories.get(id)}} as unknown as ConditionContext;
    const applier=new ConsequenceApplier(s.territories,s.factions,s.armies),before=s.territories.get('home')!.garrison;
    for(const c of def.onTrigger!(ctx,'minor').consequences)applier.applyDelta(c);
    assert.ok(applier.territories.get('home')!.garrison<before);
    const choice=def.resolveChoice!('crush',ctx,'minor',{territoryId:'home'} as ActiveEvent);
    assert.ok(choice.consequences.some(c=>(c.delta.garrisonDeltaAbs??0)<0));
  });

  test('Phase G review: competing CAS starts and duplicate completion conserve exact local troops',()=>{
    const s=world();pool(s).troops=100;
    const store=new InMemoryGameStateStore();assert.ok(store.save('review-cas',s,0).ok);
    const first=store.load('review-cas'),second=store.load('review-cas');assert.ok(first.ok&&second.ok);if(!first.ok||!second.ok)return;
    const a=begin(first.state,plan(first.state,60,'a')),b=begin(second.state,plan(second.state,60,'b'));
    assert.ok(store.save('review-cas',a,first.record.stateVersion).ok);
    const rejected=store.save('review-cas',b,second.record.stateVersion);assert.ok(!rejected.ok&&rejected.code==='persistence.conflict');
    const fresh=store.load('review-cas');assert.ok(fresh.ok);if(!fresh.ok)return;
    const orch=new Orchestrator(fresh.state),before=encodePersistable(orch.getState());
    assert.ok(!orch.execute(cmdReq('START_AI_OPERATION','ai',{plan:plan(fresh.state,60,'b')})).success);
    assert.deepStrictEqual(encodePersistable(orch.getState()),before);
    advance(fresh.state,10000);assert.ok(store.save('review-cas',fresh.state,fresh.record.stateVersion).ok);
    assert.ok(!store.save('review-cas',b,second.record.stateVersion).ok);
    const done=store.load('review-cas');assert.ok(done.ok);if(!done.ok)return;
    const id=[...done.state.operations.keys()][0]!;assert.strictEqual(settleOperation(done.state,id,'completed','retry'),false);
    assert.strictEqual(pool(done.state).troops,40);assert.strictEqual(done.state.armies.get('a')!.soldiers,s.armies.get('a')!.soldiers+60);
    assert.strictEqual(done.state.armies.get('b')!.soldiers,s.armies.get('b')!.soldiers);assert.strictEqual(done.state.operationClaims.size,0);
  });
  test('Phase G review: troop threshold cannot rearm while destination claim remains blocked',()=>{
    const s=threatened();pool(s).troops=100;const d=begin(s),m=emptyPressureMetrics();
    observeSources(d,'me',m);const c=[...d.aiPressure.values()].find(c=>c.kind==='COVERAGE_GAP')!;assert.ok(c.blocked);
    for(let i=0;i<50;i++){pool(d).troops++;observeSources(d,'me',m);assert.ok(c.blocked);}
    assert.strictEqual(m.rearmed,0);
    accrueProactiveClocks(d,10000,'OFFLINE');assert.ok(settleOperation(d,[...d.operations.keys()][0]!,'completed','ready'));observeSources(d,'me',m);assert.ok(!d.aiPressure.get(c.id)!.blocked);assert.strictEqual(m.rearmed,1);
  });
  test('Phase G review: fractional Food production telescopes across materialization and collection',()=>{
    const s=world();s.territories.get('home')!.resourceOutput={food:1,wood:1};
    for(let i=1;i<=59;i++){s.worldTick=i;persistTerritoryFoodAccrual(s,'home');}
    assert.strictEqual(s.territoryEconomy.get('home')!.uncollected.food,0);
    s.worldTick=60;persistTerritoryFoodAccrual(s,'home');assert.strictEqual(s.territoryEconomy.get('home')!.uncollected.food,1);
    progressRecruitment(s,W*60n);const bank={...s.factions.get('me')!.resources};
    collectTerritoryYield(s,{factionId:'me',territoryId:'home',playerId:'ai',consumeGoldenYield:false});
    assert.strictEqual(s.factions.get('me')!.resources.food,bank.food);assert.strictEqual(s.factions.get('me')!.resources.wood,bank.wood+1);
    s.worldTick=120;persistTerritoryFoodAccrual(s,'home');assert.strictEqual(s.territoryEconomy.get('home')!.uncollected.food,1);
  });
  const receiptCatchUp=(s:GameState,ms:number)=>{accrueWorldThroughReceipt(s,ms);catchUpWorld(s,context(s),s.accruedTargetWorldTick);};
  const physicalRecruitmentState=(s:GameState)=>encodePersistable({pools:s.territoryRecruitment,economy:s.territoryEconomy,armies:s.armies,territories:s.territories,cities:s.cities,operations:s.operations,claims:s.operationClaims,pressure:s.aiPressure,opportunities:s.aiDecisionOpportunities,clock:s.aiClock});
  test('Phase G review: live receipts and coarse catch-up preserve starvation then Food availability',()=>{
    const s=world();online(s,1000000);s.territories.get('home')!.resourceOutput.food=60;accrueWorldThroughReceipt(s,0);
    const a=cloneGameState(s),b=cloneGameState(s);receiptCatchUp(a,240000);
    for(let at=15000;at<=240000;at+=15000)receiptCatchUp(b,at);
    assert.deepStrictEqual(physicalRecruitmentState(a),physicalRecruitmentState(b));assert.strictEqual(pool(a).troops,3);
  });
  test('Phase G review: live/coarse City completion cannot retroactively modify recruitment',()=>{
    const s=world();online(s,1000000);fund(s);s.constructions.set('city',{id:'city',factionId:'me',territoryId:'home',projectType:'CITY',startedAtTick:0,lastProgressTick:0,durationTicks:2,remainingTicks:2,status:'in_progress',completedAtTick:null});accrueWorldThroughReceipt(s,0);
    const a=cloneGameState(s),b=cloneGameState(s);receiptCatchUp(a,240000);
    for(let at=15000;at<=240000;at+=15000)receiptCatchUp(b,at);
    assert.deepStrictEqual(physicalRecruitmentState(a),physicalRecruitmentState(b));assert.strictEqual(pool(a).troops,2+2*T.completedCityRateMultiplier);
  });
  test('Phase G review: automatic threshold crossing gives identical coarse/fine reinforcement operations',()=>{
    const s=threatened();s.worldLevel=2;s.factions.get('me')!.resources=emptyResources();s.territories.get('home')!.resourceOutput.food=60;
    const a=cloneGameState(s),b=new Orchestrator(cloneGameState(s));
    catchUpWorld(a,{...context(a),req:cmdReq('ADVANCE_WORLD','ai',{elapsedTicks:0}),def:getCommandDefinition('ADVANCE_WORLD')!},1024);
    for(let i=0;i<1024;i++)assert.ok(b.execute(cmdReq('ADVANCE_WORLD','ai',{elapsedTicks:1})).success);
    assert.deepStrictEqual(physicalRecruitmentState(a),physicalRecruitmentState(b.getState()));
    assert.ok([...a.operations.values()].some(op=>op.action==='REINFORCE'&&op.terminal?.outcome==='completed'));
  });
  test('Phase G review: conquest at allocation completion boundary cannot award troops to conqueror',()=>{
    const s=world();pool(s).troops=100;const d=begin(s),id=[...d.operations.keys()][0]!;
    accrueProactiveClocks(d,10000,'OFFLINE');
    settleTerritoryOwnershipChange(d,'home','enemy','me');d.territories.get('home')!.owner='enemy';d.factions.get('me')!.territories=d.factions.get('me')!.territories.filter(id=>id!=='home');d.factions.get('enemy')!.territories.push('home');
    assert.strictEqual(settleOperation(d,id,'completed','late completion'),false);assert.strictEqual(d.territories.get('home')!.garrison,0);assert.ok(!d.territoryRecruitment.has('home'));assert.strictEqual(d.operationClaims.size,0);
    progressRecruitment(d);assert.strictEqual(pool(d).factionId,'enemy');assert.strictEqual(pool(d).troops,0);assert.deepStrictEqual(checkGameStateInvariants(d),[]);
  });
  test('Phase G review: destroyed City and conquered pool restart only at current earned boundary',()=>{
    const s=world();fund(s);s.cities.set(cityIdFor('home'),{id:cityIdFor('home'),territoryId:'home',factionId:'me',buildings:[]});
    const o=new Orchestrator(s);assert.ok(o.execute(cmdReq('ADVANCE_WORLD','ai',{elapsedTicks:2})).success);const d=cloneGameState(o.getState());
    settleTerritoryOwnershipChange(d,'home','enemy','me');d.territories.get('home')!.owner='enemy';d.factions.get('me')!.territories=d.factions.get('me')!.territories.filter(id=>id!=='home');d.factions.get('enemy')!.territories.push('home');
    fund(d);const a=new Orchestrator(d),b=new Orchestrator(hydratePersistedPayload(encodePersistable(d)));
    assert.ok(a.execute(cmdReq('ADVANCE_WORLD','ai',{elapsedTicks:2})).success);for(let i=0;i<2;i++)assert.ok(b.execute(cmdReq('ADVANCE_WORLD','ai',{elapsedTicks:1})).success);
    assert.deepStrictEqual(physicalRecruitmentState(a.getState()),physicalRecruitmentState(b.getState()));assert.strictEqual(pool(a.getState()).troops,2*T.troopsPerSimulationTick);assert.ok(!a.getState().cities.has(cityIdFor('home')));
  });
  test('Phase G review: malformed and neutral pools fail structural validation without throwing',()=>{
    const s=world();s.territoryRecruitment.set('home',null as never);assert.ok(checkGameStateInvariants(s).some(v=>v.code==='recruitment.invalid_shape'));
    const d=world();d.territories.get('home')!.owner=null;Object.assign(pool(d),{factionId:null});assert.ok(checkGameStateInvariants(d).some(v=>v.code==='recruitment.invalid_owner'));
  });
  test('Phase G review: an army moving toward the source territory is not co-located allocation capacity',()=>{
    const s=world();pool(s,'stage').troops=100;const o=new Orchestrator(s);assert.ok(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:makeConcretePlan({action:'MOVE',factionId:'me',armyId:'b',originTerritoryId:'home',destinationTerritoryId:'stage',route:['home','stage']})})).success);
    const p=makeConcretePlan({action:'REINFORCE',factionId:'me',territoryId:'stage',sourcePoolId:recruitmentPoolId('stage'),quantity:50,destination:{kind:'army',armyId:'b',territoryId:'stage'}});
    assert.ok(!o.execute(cmdReq('REINFORCE','ai',{plan:p})).success);assert.strictEqual(pool(o.getState(),'stage').troops,100);
  });

}
