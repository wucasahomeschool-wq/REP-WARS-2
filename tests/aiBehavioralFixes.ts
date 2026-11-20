import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createScenario } from '../src/simulation/longrun/scenarios';
import { digest, holdings, runSimulation } from '../src/simulation/longrun/runner';
import { hydratePersistedPayload } from '../src/persistence/hydrate';
import { snapshotGameState } from '../src/persistence/snapshot';
import { getDefaultWorldCatalog } from '../src/worldDefinition/catalog';
import { observeSources, deriveSources, sourceConcretePlans } from '../src/engine/strategicPressure';
import { strategicAccessOpportunity, ownedTravel } from '../src/army/strategicAccess';
import { ContextPlanComparator } from '../src/scoring/contextPlanComparison';
import { StrategicEvaluators } from '../src/scoring/strategicEvaluators';
import { FactualSupport } from '../src/scoring/factualSupport';
import { Orchestrator } from '../src/orchestration/orchestrator';
import { GameState } from '../src/types/GameState';
import { checkGameStateInvariants } from '../src/state/gameStateInvariants';
import { makeConcretePlan, TradePlan } from '../src/types/AIConcretePlan';
import { cloneGameState } from '../src/state/cloneGameState';
import { recruitmentPoolId } from '../src/gameplay/recruitment/recruitment';
import { reinforcementProblem, allocateReinforcement } from '../src/gameplay/recruitment/reinforcement';
import { consumeEmpireFood } from '../src/gameplay/economy/foodConsumption';
import { collectTerritoryYield } from '../src/gameplay/economy/collect';
import { persistTerritoryAccrual } from '../src/gameplay/economy/accrual';
import { openGameplaySessionLease } from '../src/world/presenceLeases';
import { accrueWorldThroughReceipt } from '../src/world/worldAccrual';
import { tradeDemand } from '../src/gameplay/trade/candidates';
import { unchangedTradeDecline } from '../src/gameplay/trade/declinedContext';
import { assessConcretePlanFeasibility } from '../src/engine/concretePlans';
import { toDecisionEngineSnapshot } from '../src/state/gameStateAdapters';
import { assignGoal } from '../src/cognition/goals';
import { calculateMovementDuration } from '../src/army/movement';
import { opportunity, selectWaitInitiation, accrueProactiveClocks, prepareProactiveDecision } from '../src/engine/proactiveCognition';
import { settleTradeProposal } from '../src/gameplay/trade/trade';

const tasks: [string, () => void][] = [], test = (name: string, fn: () => void) => tasks.push([name, fn]);
function archivedSmall(): GameState {
  const dir='tests/fixtures/ai-behavioral/';
  getDefaultWorldCatalog().register(JSON.parse(readFileSync(dir+'idle-small-world.json','utf8')).definition);
  return hydratePersistedPayload(JSON.parse(gunzipSync(readFileSync(dir+'idle-small-state.json.gz')).toString()));
}
function access(state:GameState) { observeSources(state,'f_ai_1'); const source=[...state.aiPressure.values()].find(s=>s.factionId==='f_ai_1'&&s.kind==='STRATEGIC_ACCESS'); assert(source); return source; }
test('archived idle army gets a credible source and a qualifying exact adjacent MOVE',()=>{
  const state=archivedSmall(),source=access(state),plans=sourceConcretePlans(state,source);
  assert.equal(plans.filter(p=>p.action!=='WAIT').length,1);
  const move=plans.find(p=>p.action==='MOVE')!;assert.equal(move.action,'MOVE');assert.equal(move.originTerritoryId,'t_009');
  assert.equal(move.route.length,2);assert(state.territories.get(move.originTerritoryId)!.neighboring.includes(move.destinationTerritoryId));
  assert.equal(state.territories.get(move.destinationTerritoryId)!.owner,move.factionId);
  const comparisons=new ContextPlanComparator().compare(state,source,plans).comparisons;
  assert(comparisons.find(p=>p.plan.id===move.id)!.qualifies);
});
test('frontier dispatch preserves native movement timing and ownership until arrival',()=>{
  const state=archivedSmall(),source=access(state),plan=sourceConcretePlans(state,source).find(p=>p.action==='MOVE')!;
  const before=holdings(state),o=new Orchestrator(state),response=o.execute({commandId:'START_AI_OPERATION',playerId:'behavior',parameters:{plan},requestId:'exact-move'});
  assert(response.success,JSON.stringify(response));const army=o.getState().armies.get(plan.armyId)!;
  assert.equal(army.location,plan.originTerritoryId);assert.equal(army.movement?.destinationTerritoryId,plan.destinationTerritoryId);
  assert.equal(army.movement?.durationTicks,calculateMovementDuration({origin:state.territories.get(plan.originTerritoryId)!,destination:state.territories.get(plan.destinationTerritoryId)!}));
  assert.equal(o.getState().territories.get(plan.destinationTerritoryId)!.owner,plan.factionId);
  assert.deepEqual(holdings(o.getState()),before);assert.equal(checkGameStateInvariants(o.getState()).length,0);
});
test('arbitrary idleness with no hostile opportunity does not create positioning pressure',()=>{
  const s=archivedSmall();for(const t of s.territories.values())if(t.owner==='f_ai_0')t.resourceOutput={};
  for(const t of s.territories.values())t.baseValue=0;
  assert.equal(strategicAccessOpportunity(s,'f_ai_1','army_1'),null);
});
test('Peace and protected player targets do not become strategic access opportunities',()=>{
  const s=archivedSmall();for(const [id,t]of s.territories)if(t.owner==='f_ai_0')t.owner=s.playerFactionId;
  assert.equal(strategicAccessOpportunity(s,'f_ai_1','army_1'),null);
  const plain=archivedSmall();plain.peaceRelationships.set('pair:v1:["f_ai_0","f_ai_1"]',{id:'pair:v1:["f_ai_0","f_ai_1"]',factions:['f_ai_0','f_ai_1'],state:'PEACE'} as any);
  assert.equal(strategicAccessOpportunity(plain,'f_ai_1','army_1'),null);
});
test('claimed or already-moving armies are not dispatched again',()=>{
  const s=archivedSmall();s.operationClaims.set('force:army_1',{id:'force:army_1',kind:'force',subjectId:'army_1',operationId:'fixture'});
  assert.equal(strategicAccessOpportunity(s,'f_ai_1','army_1'),null);s.operationClaims.clear();
  const a=s.armies.get('army_1')!;a.movement={originTerritoryId:a.location,destinationTerritoryId:'t_008',durationTicks:2,startedAtTick:s.worldTick,status:'moving',commitmentId:null};
  assert.equal(strategicAccessOpportunity(s,'f_ai_1','army_1'),null);
});
test('dispatch cannot strip an origin threatened by a stronger adjacent hostile force',()=>{
  const s=archivedSmall();const a={...s.armies.get('army_1')!,id:'threat',owner:'f_ai_0',location:'t_004',soldiers:5000};s.armies.set(a.id,a);s.territories.get('t_004')!.owner=a.owner;
  assert.equal(strategicAccessOpportunity(s,'f_ai_1','army_1'),null);
});
test('weighted owned route search respects terrain timing and stable insertion-order ties',()=>{
  const nodes=new Map([['o',{id:'o',owner:'me',neighboring:['b','a']}],['a',{id:'a',owner:'me',neighboring:['o','x']}],['b',{id:'b',owner:'me',neighboring:['x','o']}],['x',{id:'x',owner:'me',neighboring:['b','a']}]]);
  const duration=(_:unknown,to:{id:string})=>to.id==='a'?10:1;
  const first=ownedTravel(nodes,'me','o',duration),second=ownedTravel(new Map([...nodes].reverse()),'me','o',duration);
  assert.equal(first.distance.get('x'),2);assert.equal(first.parent.get('x'),'b');assert.equal(digest(first),digest(second));
});
test('new access source and sampled cognition survive schema-27 persistence unchanged',()=>{
  const state=archivedSmall();access(state);const payload=snapshotGameState(state),loaded=hydratePersistedPayload(payload);
  assert.equal(loaded.schemaVersion,27);assert.equal(digest(state),digest(loaded));assert.equal(checkGameStateInvariants(loaded).length,0);
});
test('strategic access search is read-only and consumes no canonical RNG state',()=>{
  const state=archivedSmall(),before=digest(state);assert(strategicAccessOpportunity(state,'f_ai_1','army_1'));assert.equal(digest(state),before);
});
test('strategic positioning facts are Goal-neutral and add no evaluator identity',()=>{
  const s=archivedSmall(),a=strategicAccessOpportunity(s,'f_ai_1','army_1')!;
  const fact=()=>new StrategicEvaluators(new FactualSupport(s)).forcePositionValue('f_ai_1','army_1',a.nextTerritoryId,'t_009',a.targetTerritoryId);
  const before=fact();assignGoal(s,'f_ai_1','irrelevant-resource',{kind:'RESOURCE_HOLDING',resource:'food',quantity:9999});
  assert.equal(digest(before),digest(fact()));assert.equal(before.evaluator,'FORCE_POSITION_VALUE');
});
test('approved local army creation requires exact operation ownership before consuming troops',()=>{
  const s=archivedSmall(),pool=[...s.territoryRecruitment.values()].find(p=>p.factionId==='f_ai_0'&&p.troops>100)!;
  const plan=makeConcretePlan({action:'REINFORCE',factionId:pool.factionId,territoryId:pool.territoryId,sourcePoolId:recruitmentPoolId(pool.territoryId),quantity:100,destination:{kind:'new_army',territoryId:pool.territoryId}});
  assert(plan.action==='REINFORCE');
  const before=digest(s);assert.equal(reinforcementProblem(s,plan),null);assert.throws(()=>allocateReinforcement(s,plan,'fixture'),/allocation ownership missing/);assert.equal(digest(s),before);
});
test('bank-only upkeep does not secretly consume local Food',()=>{
  const s=createScenario({size:'small',seed:11,ticks:60,presence:'online'}).state;
  const f=s.factions.get('f_ai_1')!;f.resources.food=0;s.worldTick=60;s.accruedTargetWorldTick=60;
  for(const t of s.territories.values())persistTerritoryAccrual(s,t.id);
  const local=[...s.territoryEconomy.values()].reduce((n,r)=>n+r.uncollected.food,0);
  const outcome=consumeEmpireFood(s);assert(outcome.factions.find(r=>r.factionId===f.id)!.failedCycles>0);
  assert.equal(f.resources.food,0);assert.equal([...s.territoryEconomy.values()].reduce((n,r)=>n+r.uncollected.food,0),local);
});
test('existing explicit collection transfers conserved owned stock; no autonomous rule is added',()=>{
  const s=createScenario({size:'small',seed:11,ticks:60,presence:'online'}).state;s.worldTick=60;s.accruedTargetWorldTick=60;
  for(const t of s.territories.values())persistTerritoryAccrual(s,t.id);
  const before=holdings(s),site=s.factions.get('f_ai_1')!.territories[0];
  const result=collectTerritoryYield(s,{factionId:'f_ai_1',territoryId:site,playerId:'fixture',consumeGoldenYield:false});
  assert(result.transferredResources.food>0);assert.deepEqual(holdings(s),before);assert.equal(s.territoryEconomy.get(site)!.uncollected.food,0);
});

const origin=1_700_000_000_000;
function tradeFixture(decline=true) {
  const s=createScenario({size:'small',seed:11,ticks:30,presence:'online'}).state;
  Object.assign(s.factions.get('f_ai_0')!.resources,{stone:0,wood:650});
  Object.assign(s.factions.get('f_ai_1')!.resources,{gold:0,stone:1000});
  if(decline)s.factions.get('f_ai_1')!.resources.gold=tradeDemand(s,'f_ai_1').gold-1;
  s.factions.get('f_ai_1')!.diplomacy.get('f_ai_0')!.opinion=decline?-100:0;
  s.gameplaySessionLeases=[openGameplaySessionLease({sessionId:'behavior-trade',receiptMs:origin})];accrueWorldThroughReceipt(s,origin);
  observeSources(s,'f_ai_0');const source=[...s.aiPressure.values()].find(c=>c.factionId==='f_ai_0'&&c.counterpartyId==='f_ai_1'&&c.kind==='RESOURCE_EXCHANGE')!;assert(source);
  const plan=sourceConcretePlans(s,source).find(p=>p.action==='TRADE') as TradePlan;assert(plan);
  const initialHoldings=holdings(s);
  const o=new Orchestrator(s),start=o.executeAtAuthoritativeReceipt({commandId:'START_AI_OPERATION',playerId:'behavior',requestId:'trade-start',parameters:{plan}},origin);assert(start.success,JSON.stringify(start));
  const completed=o.executeAtAuthoritativeReceipt({commandId:'SYNC_PLAYER_WORLD',playerId:'behavior',requestId:'trade-response'},origin+15_000);assert(completed.success,JSON.stringify(completed));
  return {state:o.getState(),plan,sourceId:source.id,initialHoldings};
}
let declined:ReturnType<typeof tradeFixture>;
test('real required response decline suppresses only its unchanged exact proactive candidate',()=>{
  declined=tradeFixture();const {state,plan,sourceId}=declined;
  assert.equal([...state.tradeProposals.values()][0].status,'declined');observeSources(state,'f_ai_0');
  const source=state.aiPressure.get(sourceId)!;assert(source.blockers.some(b=>b.plan.id===plan.id&&b.reasons.some(r=>r.kind==='CONTEXT')));
  assert(!sourceConcretePlans(state,source).some(p=>p.id===plan.id));assert.equal(state.tradeShipments.size,0);
  assert.equal(checkGameStateInvariants(state).length,0);
});
test('source blocker is contextual: explicit exact offers remain physically legal',()=>{
  assert(assessConcretePlanFeasibility(declined.plan,toDecisionEngineSnapshot(declined.state)).feasible);
});
test('time, Pressure and unrelated local troops do not reopen the same decline',()=>{
  const s=cloneGameState(declined.state),source=s.aiPressure.get(declined.sourceId)!;s.aiClock.nowMs+=1000;source.pressure+=100;
  [...s.territoryRecruitment.values()][0].troops++;
  observeSources(s,'f_ai_0');assert(unchangedTradeDecline(s,declined.plan,s.aiPressure.get(source.id)!.blockers));
});
test('recipient-private Opinion and Goals cannot influence proposer decline rearming',()=>{
  const s=cloneGameState(declined.state),source=s.aiPressure.get(declined.sourceId)!;
  s.factions.get('f_ai_1')!.diplomacy.get('f_ai_0')!.opinion=100;
  assignGoal(s,'f_ai_1','private-food',{kind:'RESOURCE_HOLDING',resource:'food',quantity:10000});
  observeSources(s,'f_ai_0');assert(unchangedTradeDecline(s,declined.plan,s.aiPressure.get(source.id)!.blockers));
});
test('unrelated own Goals do not reopen a declined exchange',()=>{
  const s=cloneGameState(declined.state);assignGoal(s,'f_ai_0','unrelated-build',{kind:'DEVELOPMENT',territoryId:'t_000',projectType:'FARM'});
  observeSources(s,'f_ai_0');assert(unchangedTradeDecline(s,declined.plan,s.aiPressure.get(declined.sourceId)!.blockers));
});
test('a causally relevant own resource Goal reopens comparison',()=>{
  const s=cloneGameState(declined.state);assignGoal(s,'f_ai_0','want-stone',{kind:'RESOURCE_HOLDING',resource:'stone',quantity:10000});
  observeSources(s,'f_ai_0');assert(sourceConcretePlans(s,s.aiPressure.get(declined.sourceId)!).some(p=>p.id===declined.plan.id));
});
test('relevant publicly observable stock change reopens the exact offer without cooldown tuning',()=>{
  const s=cloneGameState(declined.state);s.factions.get('f_ai_1')!.resources.stone++;
  observeSources(s,'f_ai_0');assert(sourceConcretePlans(s,s.aiPressure.get(declined.sourceId)!).some(p=>p.id===declined.plan.id));
});
test('own directed Opinion change reopens current comparison',()=>{
  const s=cloneGameState(declined.state);s.factions.get('f_ai_0')!.diplomacy.get('f_ai_1')!.opinion++;
  observeSources(s,'f_ai_0');assert(sourceConcretePlans(s,s.aiPressure.get(declined.sourceId)!).some(p=>p.id===declined.plan.id));
});
test('different terms are not suppressed by an old decline',()=>{
  const changed=makeConcretePlan({...declined.plan,offered:{gold:(declined.plan.offered.gold??0)+1}}) as TradePlan;
  assert.equal(unchangedTradeDecline(declined.state,changed,declined.state.aiPressure.get(declined.sourceId)!.blockers),null);
});
test('a feasible alternative exchange with the same counterparty remains available',()=>{
  const s=cloneGameState(declined.state);s.factions.get('f_ai_0')!.resources.wood=0;s.factions.get('f_ai_1')!.resources.wood=1000;
  observeSources(s,'f_ai_0');const plans=sourceConcretePlans(s,s.aiPressure.get(declined.sourceId)!);
  assert(plans.some(p=>p.action==='TRADE'&&(p.requested.wood??0)>0));
  assert(!plans.some(p=>p.id===declined.plan.id));
});
test('blocking one counterparty does not install a faction/pair/global Trade cap',()=>{
  const s=cloneGameState(declined.state);s.factions.get('f_ai_2')!.resources.gold=0;observeSources(s,'f_ai_0');
  const other=[...s.aiPressure.values()].find(p=>p.kind==='RESOURCE_EXCHANGE'&&p.factionId==='f_ai_0'&&p.counterpartyId==='f_ai_2');assert(other);
  assert(sourceConcretePlans(s,other).some(p=>p.action==='TRADE'));
  assert(!sourceConcretePlans(s,s.aiPressure.get(declined.sourceId)!).some(p=>p.id===declined.plan.id));
});
test('contextual reply fingerprints and candidates are insertion-order independent',()=>{
  const s=cloneGameState(declined.state);s.factions=new Map([...s.factions].reverse());s.territories=new Map([...s.territories].reverse());
  observeSources(s,'f_ai_0');assert.equal(digest(s.aiPressure.get(declined.sourceId)!.blockers),digest(declined.state.aiPressure.get(declined.sourceId)!.blockers));
});
test('ordinary WAIT retains its original completion relief and spacing without a decline',()=>{
  const s=createScenario({size:'small',seed:11,ticks:60,presence:'offline'}).state;
  s.factions.get('f_ai_0')!.resources.stone=0;s.factions.get('f_ai_0')!.resources.wood=650;
  s.factions.get('f_ai_1')!.resources.gold=tradeDemand(s,'f_ai_1').gold-1;s.factions.get('f_ai_1')!.resources.stone=1000;
  observeSources(s,'f_ai_0');const source=[...s.aiPressure.values()].find(p=>p.kind==='RESOURCE_EXCHANGE'&&p.factionId==='f_ai_0'&&p.counterpartyId==='f_ai_1')!;assert(source);
  const o=opportunity(s,'f_ai_0');o.primary={contextId:source.id,contextRevision:source.revision,opportunityId:'opportunity:v1:["f_ai_0",0]',phase:'selected',timer:null};
  source.pressure=10000;selectWaitInitiation(s,'f_ai_0');accrueProactiveClocks(s,60000,'OFFLINE');prepareProactiveDecision(s,'f_ai_0');
  assert(o.spacing);assert.equal(o.primary,null);assert.equal(o.lastOutcome,null);
  assert(source.pressure<10000);assert(!source.blockers.some(b=>b.reasons.some(r=>r.kind==='CONTEXT')));
});
test('decline context persists and retains suppression after save/reload',()=>{
  const loaded=hydratePersistedPayload(snapshotGameState(declined.state));observeSources(loaded,'f_ai_0');
  assert(!sourceConcretePlans(loaded,loaded.aiPressure.get(declined.sourceId)!).some(p=>p.id===declined.plan.id));
  assert.equal(checkGameStateInvariants(loaded).length,0);
});
test('replayed decline settlement cannot duplicate feedback or mutate custody',()=>{
  const s=cloneGameState(declined.state),p=[...s.tradeProposals.values()][0],before=digest(s);
  assert.equal(settleTradeProposal(s,p.id,'declined'),false);assert.equal(digest(s),before);
});
test('accepted Trade still creates two physical cargos and conserves exact goods',()=>{
  const accepted=tradeFixture(false);assert.equal([...accepted.state.tradeProposals.values()][0].status,'accepted');
  assert.equal(accepted.state.tradeShipments.size,2);assert([...accepted.state.tradeShipments.values()].every(s=>s.phase!=='delivered'));
  assert(![...accepted.state.aiPressure.values()].some(s=>s.blockers.some(b=>b.reasons.some(r=>r.kind==='CONTEXT'))));
  assert.deepEqual(holdings(accepted.state),accepted.initialHoldings);
});
test('source signatures without response blockers retain existing schema-27 representation',()=>{
  const s=createScenario({size:'small',seed:11,ticks:60,presence:'online'}).state;observeSources(s,'f_ai_0');
  assert([...s.aiPressure.values()].filter(c=>c.factionId==='f_ai_0').every(c=>JSON.parse(c.materialSignature).length===2));
});
test('all three sizes still execute native operations with exact conservation',()=>{
  for(const size of ['small','medium','large'] as const) {
    const result=runSimulation({size,seed:11,ticks:60,presence:'online',stepTicks:5,reloadEvery:10});assert(result.summary.completed,JSON.stringify(result.summary.error));assert.deepEqual(result.summary.nestedErrors,[]);
    assert.equal(result.summary.conservation.troopResidual,0);assert.equal(result.summary.conservation.siegeResidual,0);assert(Object.values(result.summary.conservation.resourceResidual).every(n=>n===0));
  }
});
let passed=0,failed=0;
const filter=process.argv.includes('--filter')?new RegExp(process.argv[process.argv.indexOf('--filter')+1]):null;
for(const[name,fn]of tasks.filter(([name])=>!filter||filter.test(name))){try{fn();passed++;console.log('PASS',name);}catch(e){failed++;console.error('FAIL',name,e);}}
console.log(JSON.stringify({passed,failed,skipped:0}));if(failed)process.exitCode=1;
