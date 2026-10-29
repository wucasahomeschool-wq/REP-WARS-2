import assert from 'node:assert/strict';
import {createGameState,checkGameStateInvariants} from '../src/state';
import {loadProductionLevel2Definition} from '../src/worldDefinition';
import {Orchestrator,createDefaultRegistry} from '../src/orchestration';
import {getCommandDefinition} from '../src/orchestration/commandIndex';
import {progressProactiveThrough} from '../src/orchestration/handlers';
import {GameState} from '../src/types/GameState';
import {makeConcretePlan,ReinforcePlan} from '../src/types/AIConcretePlan';
import {initializeRecruitment,recruitmentPoolId} from '../src/gameplay/recruitment/recruitment';
import {availableLocalTroops} from '../src/gameplay/recruitment/reinforcement';
import {snapshotGameState} from '../src/persistence/snapshot';
import {hydratePersistedPayload} from '../src/persistence/hydrate';
import {settleOperation} from '../src/engine/operations';
import {buildWarlordStates} from '../src/state/gameStateAdapters';
import {observeSources,sourceConcretePlans} from '../src/engine/strategicPressure';
import {FactualSupport} from '../src/scoring/factualSupport';
import {StrategicEvaluators} from '../src/scoring/strategicEvaluators';
import {InMemoryGameStateStore} from '../src/persistence/inMemoryGameStateStore';
import {prepareProactiveDecision,accrueProactiveClocks} from '../src/engine/proactiveCognition';
import {STRATEGIC_PRESSURE_TUNING} from '../src/constants/strategicPressure';

function fixture() {
  const loaded=loadProductionLevel2Definition();assert.ok(loaded.ok);
  const state=createGameState({world:loaded.definition,seed:37});
  const fid='f_ai_01',site='t_01';
  for(const id of state.factions.get(fid)!.armies)state.armies.delete(id);
  state.factions.get(fid)!.armies=[];initializeRecruitment(state);
  state.territoryRecruitment.get(site)!.troops=250; // Existing local soldiers in this recovery fixture.
  const plan=makeConcretePlan({action:'REINFORCE',factionId:fid,territoryId:site,sourcePoolId:recruitmentPoolId(site),quantity:150,destination:{kind:'new_army',territoryId:site}}) as ReinforcePlan;
  return {state,fid,site,plan};
}
function begin(s:ReturnType<typeof fixture>) {
  const o=new Orchestrator(s.state),r=o.execute({commandId:'START_AI_OPERATION',playerId:'internal',parameters:{plan:s.plan}});
  assert.ok(r.success,JSON.stringify(r.errors));return o.getState();
}
function advance(state:GameState,atMs:number) {
  progressProactiveThrough(state,{req:{commandId:'AI_DECIDE',playerId:'internal',parameters:{}},def:getCommandDefinition('AI_DECIDE')!,registry:createDefaultRegistry(),runtime:{aiWarlordStates:buildWarlordStates(state)}},atMs);
}
export function registerLocalFormationTests({test}:{test:(name:string,fn:()=>void)=>void}) {
  test('formation: actual AI chooses recovery through unchanged comparator and executes its exact plan',()=>{
    const s=fixture();s.state.factions.get(s.fid)!.bankedTroops=s.state.territoryRecruitment.get(s.site)!.troops;s.state.territoryRecruitment.get(s.site)!.troops=0;observeSources(s.state,s.fid);
    const source=[...s.state.aiPressure.values()].find(p=>p.factionId===s.fid&&p.kind==='HOSTILE_OPPORTUNITY'&&sourceConcretePlans(s.state,p).some(q=>q.action==='REINFORCE'&&q.destination.kind==='new_army'))!;
    assert.ok(source);source.pressure=STRATEGIC_PRESSURE_TUNING.ready;prepareProactiveDecision(s.state,s.fid);
    const timer=s.state.aiDecisionOpportunities.get(s.fid)!.primary!.timer!;accrueProactiveClocks(s.state,s.state.aiClock.nowMs+timer.offlineDurationMs,'OFFLINE');
    const o=new Orchestrator(s.state),decision=o.execute({commandId:'AI_DECIDE',playerId:'internal',parameters:{warlordId:s.fid}});
    assert.ok(decision.success,JSON.stringify(decision.errors));
    const operation=[...o.getState().operations.values()].find(op=>op.warlordId===s.fid&&op.plan?.action==='REINFORCE'&&op.plan.destination.kind==='new_army');
    assert.ok(operation,JSON.stringify(decision.payload));
    const started=o.execute({commandId:'RESOLVE_COMMITMENT',playerId:'internal',parameters:{factionId:s.fid,operationId:operation.id}});assert.ok(started.success,JSON.stringify(started.errors));
    const state=o.getState();advance(state,state.aiClock.nowMs+10000);assert.equal(state.factions.get(s.fid)!.armies.length,1);assert.deepEqual(checkGameStateInvariants(state),[]);
  });
  test('formation: CAS admits one settlement and stale writer cannot duplicate the allocated force',()=>{
    const s=fixture(),store=new InMemoryGameStateStore();assert.ok(store.save('fixture',begin(s),0).ok);
    const a=store.load('fixture'),b=store.load('fixture');assert.ok(a.ok&&b.ok);
    advance(a.state,10000);advance(b.state,10000);assert.deepEqual(snapshotGameState(a.state),snapshotGameState(b.state));
    assert.ok(store.save('fixture',a.state,a.record.stateVersion).ok);
    const lost=store.save('fixture',b.state,b.record.stateVersion);assert.equal(lost.ok,false);
    const reload=store.load('fixture');assert.ok(reload.ok);assert.equal(reload.state.factions.get(s.fid)!.armies.length,1);assert.equal(reload.state.territoryRecruitment.get(s.site)!.troops,100);
  });
  test('formation: deleted force cannot reuse its durable ID after reload',()=>{
    const s=fixture(),state=begin(s);advance(state,10000);const old=state.factions.get(s.fid)!.armies[0]!;
    state.armies.delete(old);state.factions.get(s.fid)!.armies=[];
    const reloaded=hydratePersistedPayload(snapshotGameState(state));
    const {id:oldPlanId,...draft}=s.plan;const plan=makeConcretePlan({...draft,quantity:100}) as ReinforcePlan;
    const next=begin({...s,state:reloaded,plan});advance(next,20000);
    const id=next.factions.get(s.fid)!.armies[0]!;assert.notEqual(id,old);assert.equal(next.armies.get(id)!.soldiers,100);assert.equal(next.territoryRecruitment.get(s.site)!.troops,0);
  });
  test('formation: last force recovers locally, reserves exactly, settles once and preserves totals',()=>{
    const s=fixture(),state=begin(s);assert.equal(availableLocalTroops(state,s.site),100);assert.equal(state.factions.get(s.fid)!.armies.length,0);
    advance(state,9999);assert.equal(state.factions.get(s.fid)!.armies.length,0);
    advance(state,10000);const id=state.factions.get(s.fid)!.armies[0]!,army=state.armies.get(id)!;
    assert.equal(army.location,s.site);assert.equal(army.soldiers,150);assert.equal(state.territoryRecruitment.get(s.site)!.troops,100);
    assert.equal(state.operationClaims.size,0);assert.equal(state.operations.values().next().value!.links.armyId,id);
    const after=snapshotGameState(state);assert.equal(settleOperation(state,[...state.operations.keys()][0]!,'completed','retry'),false);
    advance(state,10000);assert.deepEqual(snapshotGameState(state),after);assert.deepEqual(checkGameStateInvariants(state),[]);
  });
  test('formation: insufficient, wrong-owner and exhausted identity failures roll back fully',()=>{
    for(const mutation of [(s:ReturnType<typeof fixture>)=>{s.state.territoryRecruitment.get(s.site)!.troops=149;},
      (s:ReturnType<typeof fixture>)=>{const {id,...draft}=s.plan;s.plan=makeConcretePlan({...draft,factionId:'f_ai_02'}) as ReinforcePlan;},
      (s:ReturnType<typeof fixture>)=>{s.state.nextArmySequence=Number.MAX_SAFE_INTEGER;}]) {
      const s=fixture();mutation(s);const o=new Orchestrator(s.state),before=snapshotGameState(o.getState());
      const r=o.execute({commandId:'START_AI_OPERATION',playerId:'internal',parameters:{plan:s.plan}});assert.equal(r.success,false);assert.deepEqual(snapshotGameState(o.getState()),before);
    }
  });
  test('formation: in-flight allocation cannot double-use local troops',()=>{
    const s=fixture(),state=begin(s),o=new Orchestrator(state),before=snapshotGameState(state);
    const r=o.execute({commandId:'START_AI_OPERATION',playerId:'internal',parameters:{plan:s.plan}});assert.equal(r.success,false);assert.deepEqual(snapshotGameState(o.getState()),before);
  });
  test('formation: partial timer reload and deterministic replay retain exact identity and state',()=>{
    const a=begin(fixture());advance(a,4567);const b=hydratePersistedPayload(snapshotGameState(a));advance(a,10000);advance(b,10000);
    assert.deepEqual(snapshotGameState(a),snapshotGameState(b));
    const c=begin(fixture());advance(c,10000);assert.deepEqual(snapshotGameState(c),snapshotGameState(a));
  });
  test('formation: interrupted initiation releases claims without allocating or consuming identity',()=>{
    const s=fixture(),state=begin(s),sequence=state.nextArmySequence;
    assert.equal(settleOperation(state,[...state.operations.keys()][0]!,'interrupted','fixture interruption'),true);
    advance(state,10000);assert.equal(state.territoryRecruitment.get(s.site)!.troops,250);assert.equal(state.nextArmySequence,sequence);assert.equal(state.operationClaims.size,0);assert.equal(state.factions.get(s.fid)!.armies.length,0);
  });
  test('formation: new force travels through ordinary MOVE and cannot teleport',()=>{
    const s=fixture(),state=begin(s);advance(state,10000);const id=state.factions.get(s.fid)!.armies[0]!,o=new Orchestrator(state);
    const plan=makeConcretePlan({action:'MOVE',factionId:s.fid,armyId:id,originTerritoryId:s.site,destinationTerritoryId:'t_04',route:[s.site,'t_04']});
    const r=o.execute({commandId:'START_AI_OPERATION',playerId:'internal',parameters:{plan}});assert.ok(r.success,JSON.stringify(r.errors));
    const moving=o.getState().armies.get(id)!;assert.equal(moving.location,s.site);assert.equal(moving.movement?.status,'moving');assert.equal(moving.soldiers,150);assert.deepEqual(checkGameStateInvariants(o.getState()),[]);
  });
  test('formation: source discovers recovery after last-army loss with positive factual utility',()=>{
    const s=fixture();s.state.factions.get(s.fid)!.bankedTroops=s.state.territoryRecruitment.get(s.site)!.troops;s.state.territoryRecruitment.get(s.site)!.troops=0;observeSources(s.state,s.fid);
    const plans=[...s.state.aiPressure.values()].filter(source=>source.factionId===s.fid).flatMap(source=>sourceConcretePlans(s.state,source));
    const plan=plans.find((p):p is ReinforcePlan=>p.action==='REINFORCE'&&p.destination.kind==='new_army');assert.ok(plan);
    const source=[...s.state.aiPressure.values()].find(source=>source.factionId===s.fid&&sourceConcretePlans(s.state,source).some(p=>p.id===plan.id))!;
    assert.ok(new StrategicEvaluators(new FactualSupport(s.state)).localAllocationValue(plan,source.subjectId).facts.additionalUtility>0);
  });
}
