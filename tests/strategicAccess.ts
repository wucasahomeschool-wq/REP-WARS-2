import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {join} from 'node:path';
import {hydratePersistedPayload} from '../src/persistence/hydrate';
import {snapshotGameState} from '../src/persistence/snapshot';
import {getDefaultWorldCatalog} from '../src/worldDefinition/catalog';
import {observeSources, sourceConcretePlans} from '../src/engine/strategicPressure';
import {strategicAccessOpportunity, ownedTravel, ownedPath} from '../src/army/strategicAccess';
import {ContextPlanComparator} from '../src/scoring/contextPlanComparison';
import {StrategicEvaluators} from '../src/scoring/strategicEvaluators';
import {FactualSupport} from '../src/scoring/factualSupport';
import {Orchestrator} from '../src/orchestration/orchestrator';
import {GameState} from '../src/types/GameState';
import {checkGameStateInvariants} from '../src/state/gameStateInvariants';
import {assignGoal} from '../src/cognition/goals';
import {calculateMovementDuration} from '../src/army/movement';

const digest=(v:unknown)=>JSON.stringify(v,(_key,value)=>value instanceof Map?[...value].sort(([a],[b])=>String(a).localeCompare(String(b))):value);
// These counters cover a dispatch with no elapsed world time, not production/upkeep accounting.
const holdings=(s:GameState)=>digest({armies:[...s.armies].map(([id,a])=>[id,a.owner,a.soldiers,a.knights,a.siegeEngines]),
  factions:[...s.factions].map(([id,f])=>[id,f.resources]),recruitment:s.territoryRecruitment,economy:s.territoryEconomy,
  garrisons:[...s.territories].map(([id,t])=>[id,t.garrison])});
function archivedSmall(): GameState {
  const dir=join(__dirname,'fixtures/strategic-access/');
  getDefaultWorldCatalog().register(JSON.parse(readFileSync(dir+'idle-small-world.json','utf8')).definition);
  return hydratePersistedPayload(JSON.parse(gunzipSync(readFileSync(dir+'idle-small-state.json.gz')).toString()));
}
function access(state:GameState) { observeSources(state,'f_ai_1'); const source=[...state.aiPressure.values()].find(s=>s.factionId==='f_ai_1'&&s.kind==='STRATEGIC_ACCESS'); assert(source); return source; }

export function registerStrategicAccessTests({test}:{test:(name:string,fn:()=>void)=>void}) {
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
  const plain=archivedSmall();plain.peaceRelationships.set('pair:v1:["f_ai_0","f_ai_1"]',{pairId:'pair:v1:["f_ai_0","f_ai_1"]',factions:['f_ai_0','f_ai_1'],state:'PEACE',proposalId:null,acceptedAtMs:plain.aiClock.nowMs,finalizationTimer:null,activatedAtMs:plain.aiClock.nowMs,expiresAtMs:null});
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
test('new access source and sampled cognition survive schema-30 persistence unchanged',()=>{
  const state=archivedSmall();access(state);const payload=snapshotGameState(state),loaded=hydratePersistedPayload(payload);
  assert.equal(loaded.schemaVersion,31);assert.equal(digest(state),digest(loaded));assert.equal(checkGameStateInvariants(loaded).length,0);
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
test('owned-route search scales by edges and preserves canonical inputs',()=>{
  const nodes=new Map(Array.from({length:1000},(_,i)=>[String(i),{id:String(i),owner:'me',neighboring:[i-1,i+1].filter(n=>n>=0&&n<1000).map(String)}]));
  const before=digest(nodes);let visits=0;
  const search=ownedTravel(nodes,'me','0',()=>{visits++;return 1;});
  assert.equal(search.distance.get('999'),999);assert.equal(ownedPath(search,'0','999')!.length,1000);
  assert.equal(visits,1998);assert.equal(digest(nodes),before);
});
test('in-flight strategic MOVE survives reload with deterministic dispatch identity',()=>{
  const start=()=>{const s=archivedSmall(),source=access(s),plan=sourceConcretePlans(s,source).find(p=>p.action==='MOVE')!;
    const o=new Orchestrator(s),r=o.execute({commandId:'START_AI_OPERATION',playerId:'behavior',parameters:{plan},requestId:'same-dispatch'});
    assert(r.success,JSON.stringify(r));return o.getState();};
  const a=start(),b=start();assert.deepEqual(snapshotGameState(a),snapshotGameState(b));
  const loaded=hydratePersistedPayload(snapshotGameState(a));assert.deepEqual(snapshotGameState(loaded),snapshotGameState(a));
  assert.equal(strategicAccessOpportunity(loaded,'f_ai_1','army_1'),null);assert.deepEqual(checkGameStateInvariants(loaded),[]);
});
}
