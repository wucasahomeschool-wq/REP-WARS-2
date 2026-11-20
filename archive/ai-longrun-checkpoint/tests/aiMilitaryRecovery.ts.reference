import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { computeAttackerPower } from '../src/battle/CombatPower';
import { createScenario } from '../src/simulation/longrun/scenarios';
import { digest, holdings, runSimulation } from '../src/simulation/longrun/runner';
import { GameState } from '../src/types/GameState';
import { makeConcretePlan, ReinforcePlan } from '../src/types/AIConcretePlan';
import { initializeRecruitment, recruitmentPoolId } from '../src/gameplay/recruitment/recruitment';
import { availableLocalTroops, reinforcementProblem, allocateReinforcement } from '../src/gameplay/recruitment/reinforcement';
import { formationArmyId } from '../src/gameplay/recruitment/formation';
import { fieldRecoveryOpportunity } from '../src/army/fieldRecovery';
import { strategicAccessOpportunity } from '../src/army/strategicAccess';
import { Orchestrator, createDefaultRegistry } from '../src/orchestration';
import { progressProactiveThrough } from '../src/orchestration/handlers';
import { getCommandDefinition } from '../src/orchestration/commandIndex';
import { buildWarlordStates } from '../src/state/gameStateAdapters';
import { cloneGameState } from '../src/state/cloneGameState';
import { checkGameStateInvariants } from '../src/state/gameStateInvariants';
import { snapshotGameState } from '../src/persistence/snapshot';
import { hydratePersistedPayload } from '../src/persistence/hydrate';
import { settleOperation } from '../src/engine/operations';
import { observeSources, sourceConcretePlans } from '../src/engine/strategicPressure';
import { ContextPlanComparator } from '../src/scoring/contextPlanComparison';
import { StrategicEvaluators } from '../src/scoring/strategicEvaluators';
import { FactualSupport } from '../src/scoring/factualSupport';
import { calculateMovementDuration, progressArmyMovements } from '../src/army/movement';
import { executeReadyStrategicAttack } from '../src/army/strategicAttack';
import { consumeEmpireFood } from '../src/gameplay/economy/foodConsumption';
import { persistTerritoryAccrual } from '../src/gameplay/economy/accrual';
import { progressRecruitment } from '../src/gameplay/recruitment/recruitment';
import { InMemoryGameStateStore } from '../src/persistence/inMemoryGameStateStore';
import { createInMemoryPersistence } from '../src/server/persistencePort';
import { createSessionHost } from '../src/server/session';

const tasks:[string,()=>void|Promise<void>][]=[];
const test=(name:string,fn:()=>void|Promise<void>)=>tasks.push([name,fn]);
function world() {
  const s=createScenario({size:'small',seed:11,ticks:60,presence:'online'}).state;
  for(const [id,a] of s.armies)if(a.owner==='f_ai_0')s.armies.delete(id);
  s.factions.get('f_ai_0')!.armies=[];
  initializeRecruitment(s);
  for(const p of s.territoryRecruitment.values())if(p.factionId==='f_ai_0')p.troops=1000;
  return s;
}
function plan(s:GameState,quantity=150,territoryId=s.factions.get('f_ai_0')!.territories[0]):ReinforcePlan {
  return makeConcretePlan({action:'REINFORCE',factionId:'f_ai_0',territoryId,sourcePoolId:recruitmentPoolId(territoryId),quantity,destination:{kind:'new_army',territoryId}}) as ReinforcePlan;
}
function begin(s:GameState,p=plan(s)) {
  const o=new Orchestrator(s),r=o.execute({commandId:'START_AI_OPERATION',playerId:'military-test',parameters:{plan:p},requestId:'formation'});
  assert(r.success,JSON.stringify(r.errors));return cloneGameState(o.getState());
}
function advance(s:GameState,ms=10000) {
  progressProactiveThrough(s,{req:{commandId:'AI_DECIDE',playerId:'military-test',parameters:{warlordId:'f_ai_0'}},def:getCommandDefinition('AI_DECIDE')!,registry:createDefaultRegistry(),runtime:{aiWarlordStates:buildWarlordStates(s)}},ms);
}
function op(s:GameState) {return [...s.operations.values()].find(o=>o.plan?.action==='REINFORCE'&&o.plan.destination.kind==='new_army')!;}

test('last-army loss leaves a concrete recovery source and qualifying exact formation',()=>{
  const s=world();assert.equal(s.factions.get('f_ai_0')!.armies.length,0);const r=fieldRecoveryOpportunity(s,'f_ai_0');assert(r);
  observeSources(s,'f_ai_0');const source=[...s.aiPressure.values()].find(c=>c.kind==='FIELD_FORCE_GAP')!;assert(source);
  const plans=sourceConcretePlans(s,source);assert(plans.some(p=>p.action==='REINFORCE'&&p.destination.kind==='new_army'));
  assert(new ContextPlanComparator().compare(s,source,plans).comparisons.some(c=>c.plan.action==='REINFORCE'&&c.qualifies));
});
test('formation reserves before completion and consumes exactly once locally',()=>{
  const initial=world(),p=plan(initial),total=holdings(initial),pool=initial.territoryRecruitment.get(p.territoryId)!.troops;
  const s=begin(initial,p),id=op(s).id;assert.equal(s.territoryRecruitment.get(p.territoryId)!.troops,pool);
  assert.equal(availableLocalTroops(s,p.territoryId),pool-p.quantity);assert(!s.armies.has(formationArmyId(id)));
  advance(s);const a=s.armies.get(formationArmyId(id))!;assert(a);assert.equal(a.location,p.territoryId);assert.equal(a.owner,p.factionId);
  assert.equal(a.soldiers,p.quantity);assert.equal(a.knights,0);assert.equal(a.siegeEngines,0);
  assert.equal(s.territoryRecruitment.get(p.territoryId)!.troops,pool-p.quantity);
  assert.equal(op(s).links.armyId,a.id);assert.deepEqual(holdings(s),total);assert.equal(checkGameStateInvariants(s).length,0);
});
test('early completion cannot create an army or consume its reserved pool',()=>{
  const s=begin(world()),before=digest(s);assert.equal(settleOperation(s,op(s).id,'completed','early'),false);assert.equal(digest(s),before);
});
test('duplicate completed operation cannot create a second army',()=>{
  const s=begin(world());advance(s);const before=digest(s);assert.equal(settleOperation(s,op(s).id,'completed','retry'),false);advance(s);assert.equal(digest(s),before);
});
test('duplicate domain allocation refuses terminal operation ownership',()=>{
  const s=begin(world());advance(s);const p=op(s).plan!;assert(p.action==='REINFORCE');const before=digest(s);
  assert.throws(()=>allocateReinforcement(s,p,op(s).id));assert.equal(digest(s),before);
});
test('lost-response logical SYNC retry after formation replays its receipt across reload',async()=>{
  const s=begin(world()),id=op(s).id,store=new InMemoryGameStateStore();assert(store.save('formation-player',s,0).ok);
  const persistence=createInMemoryPersistence(store);let now=0;const host=createSessionHost(persistence,{nowMs:()=>now});
  const lease=await host.openGameplaySession('formation-player','open');now=1000;
  const request={commandId:'SYNC_PLAYER_WORLD',playerId:'formation-player',requestId:'sync-formation',gameplaySessionId:lease.sessionId,commandSequence:1,renewalSequence:1};
  const response=await host.execute(request);assert(response.success,JSON.stringify(response.errors));const load=store.load('formation-player');assert(load.ok);assert(load.state.armies.has(formationArmyId(id)));
  const before=digest(load.state),version=load.record.stateVersion;now=2000;const restarted=createSessionHost(persistence,{nowMs:()=>now});
  const replay=await restarted.execute(request);assert(replay.success);const after=store.load('formation-player');assert(after.ok);assert.equal(digest(after.state),before);assert.equal(after.record.stateVersion,version);
});
test('stale formation writer cannot overwrite the already committed army or troop debit',()=>{
  const s=begin(world()),store=new InMemoryGameStateStore();assert(store.save('cas',s,0).ok);
  const a=store.load('cas'),b=store.load('cas');assert(a.ok&&b.ok);advance(b.state);assert(store.save('cas',b.state,b.record.stateVersion).ok);advance(a.state);
  const failure=store.save('cas',a.state,a.record.stateVersion);assert(!failure.ok);assert.equal(failure.code,'persistence.conflict');const loaded=store.load('cas');assert(loaded.ok);assert.equal(digest(loaded.state),digest(b.state));
});
test('insufficient pool fails without changing canonical state',()=>{
  const s=world(),p=plan(s,1001),o=new Orchestrator(s),before=digest(s);
  assert(!o.execute({commandId:'START_AI_OPERATION',playerId:'test',parameters:{plan:p}}).success);assert.equal(digest(o.getState()),before);
});
test('reserved pool and local destination cannot be reused by another operation',()=>{
  const s=begin(world()),p=plan(s,900),o=new Orchestrator(s),before=digest(s);assert.match(reinforcementProblem(s,p)!,/already reserved/);
  assert(!o.execute({commandId:'START_AI_OPERATION',playerId:'test',parameters:{plan:p}}).success);assert.equal(digest(o.getState()),before);
});
test('wrong-owner local formation fails without troop mutation',()=>{
  const s=world(),tid=s.factions.get('f_ai_1')!.territories[0],p=plan(s,100,tid),before=digest(s),o=new Orchestrator(s);
  assert(!o.execute({commandId:'START_AI_OPERATION',playerId:'test',parameters:{plan:p}}).success);assert.equal(digest(o.getState()),before);
});
test('malformed zero and negative quantities remain illegal',()=>{
  for(const n of [0,-1,0.5,Number.MAX_SAFE_INTEGER+1]){const s=world(),o=new Orchestrator(s),before=digest(s);assert(!o.execute({commandId:'START_AI_OPERATION',playerId:'test',parameters:{plan:plan(s,n)}}).success);assert.equal(digest(o.getState()),before);}
});
test('identity collision fails before pool debit and releases failed claims',()=>{
  const s=begin(world()),p=op(s).plan!;assert(p.action==='REINFORCE');const pool=s.territoryRecruitment.get(p.territoryId)!.troops;
  const a={id:formationArmyId(op(s).id),owner:p.factionId,location:p.territoryId,soldiers:1,knights:0,siegeEngines:0,morale:80,supply:80};s.armies.set(a.id,a);s.factions.get(p.factionId)!.armies.push(a.id);
  advance(s);assert.equal(op(s).status,'failed');assert.equal(s.territoryRecruitment.get(p.territoryId)!.troops,pool);assert.equal(s.armies.get(a.id)!.soldiers,1);assert.equal(s.operationClaims.size,0);
});
test('cancellation releases reservations without forming or refunding troops',()=>{
  const initial=world(),s=begin(initial),total=holdings(s);assert(settleOperation(s,op(s).id,'failed','cancel'));assert.deepEqual(holdings(s),total);assert.equal(s.operationClaims.size,0);assert(!s.armies.has(formationArmyId(op(s).id)));
});
test('conquest cancels pending formation without a force for the previous owner',()=>{
  const initial=world(),tid='t_002';initial.territories.get(tid)!.garrison=0;
  const attacker=[...initial.armies.values()].find(a=>a.owner==='f_ai_1')!;attacker.location='t_003';
  const s=begin(initial,plan(initial,101,tid)),id=op(s).id,o=new Orchestrator(s);
  const attack=makeConcretePlan({action:'ATTACK',factionId:attacker.owner,armyId:attacker.id,originTerritoryId:attacker.location,stagingTerritoryId:attacker.location,targetTerritoryId:tid,route:[attacker.location,tid]});
  assert(o.execute({commandId:'START_AI_OPERATION',playerId:'test',parameters:{plan:attack}}).success);const result=o.getState();
  assert.equal(result.territories.get(tid)!.owner,'f_ai_1');assert(!result.armies.has(formationArmyId(id)));assert.equal(result.operations.get(id)!.status,'failed');assert.equal(result.operationClaims.size,0);assert.equal(checkGameStateInvariants(result).length,0);
});
test('reload midway preserves exact identity remaining time and custody',()=>{
  const s=begin(world());advance(s,5000);const loaded=hydratePersistedPayload(snapshotGameState(s));advance(s,10000);advance(loaded,10000);assert.equal(digest(s),digest(loaded));
});
test('fine and coarse reasoning completion have identical canonical results',()=>{
  const s=begin(world()),fine=cloneGameState(s),coarse=cloneGameState(s);for(let t=1000;t<=10000;t+=1000)advance(fine,t);advance(coarse,10000);assert.equal(digest(fine),digest(coarse));
});
test('new force uses normal native transit and stays at origin until arrival',()=>{
  const s=begin(world());advance(s);const a=s.armies.get(formationArmyId(op(s).id))!,from=s.territories.get(a.location)!;
  const to=from.neighboring.find(id=>s.territories.get(id)!.owner===a.owner)!;assert(to);
  const p=makeConcretePlan({action:'MOVE',factionId:a.owner,armyId:a.id,originTerritoryId:from.id,destinationTerritoryId:to,route:[from.id,to]});
  const o=new Orchestrator(s);assert(o.execute({commandId:'START_AI_OPERATION',playerId:'test',parameters:{plan:p}}).success);
  const actual=o.getState().armies.get(a.id)!;assert.equal(actual.location,from.id);assert.equal(actual.movement!.durationTicks,calculateMovementDuration({origin:from,destination:s.territories.get(to)!}));
});
test('compatible movement and local formation coexist without a faction-wide operation gate',()=>{
  const s=world(),p=plan(s),from=s.territories.get(p.territoryId)!,to=from.neighboring.find(id=>s.territories.get(id)!.owner===p.factionId)!;
  const a={id:'separate-force',owner:p.factionId,location:from.id,soldiers:200,knights:0,siegeEngines:0,morale:80,supply:80};s.armies.set(a.id,a);s.factions.get(a.owner)!.armies=[a.id];
  const o=new Orchestrator(s);assert(o.execute({commandId:'START_AI_OPERATION',playerId:'test',parameters:{plan:makeConcretePlan({action:'MOVE',factionId:a.owner,armyId:a.id,originTerritoryId:from.id,destinationTerritoryId:to,route:[from.id,to]})}}).success);
  const started=begin(cloneGameState(o.getState()),p);assert.equal([...started.operations.values()].filter(o=>!o.terminal).length,2);assert(started.operationClaims.has(`force:${a.id}`));assert(started.operationClaims.has(`garrison:${from.id}`));assert.deepEqual(holdings(started),holdings(s));
});
test('subthreshold arrival fails safely without a battle refund or duplicate settlement',()=>{
  const initial=world(),s=begin(initial,plan(initial,101,'t_001'));advance(s);const a=s.armies.get(formationArmyId(op(s).id))!;
  const o=new Orchestrator(s),p=makeConcretePlan({action:'ATTACK',factionId:a.owner,armyId:a.id,originTerritoryId:a.location,stagingTerritoryId:'t_002',targetTerritoryId:'t_003',route:[a.location,'t_002','t_003']});
  assert(o.execute({commandId:'START_AI_OPERATION',playerId:'test',parameters:{plan:p}}).success);const draft=cloneGameState(o.getState()),attack=[...draft.operations.values()].find(o=>o.action==='ATTACK')!;
  draft.armies.get(a.id)!.soldiers=76; // Already-applied defensive casualties in the recorded reproduction.
  const movement=draft.armies.get(a.id)!.movement!;draft.worldTick=movement.startedAtTick+movement.durationTicks;draft.accruedTargetWorldTick=draft.worldTick;progressArmyMovements(draft,draft.worldTick);
  const result=executeReadyStrategicAttack(draft,{req:{commandId:'RESOLVE_COMMITMENT',playerId:'test'},registry:createDefaultRegistry()},a.id);
  assert.equal(result.payload.attackOutcome,'failed');assert.equal(result.errors![0].code,'INSUFFICIENT_TROOPS');assert(!result.payload.battleResult);assert.equal(draft.armies.get(a.id)!.soldiers,76);
  assert(settleOperation(draft,attack.id,'failed','physical force no longer eligible'));assert.equal(draft.operationClaims.size,0);assert.equal(draft.armies.get(a.id)!.attackIntent,null);assert.equal(checkGameStateInvariants(draft).length,0);
  const before=digest(draft);assert.equal(settleOperation(draft,attack.id,'failed','retry'),false);assert.equal(digest(draft),before);
});
test('formation identity is operation-backed and independent of clock and map size',()=>{
  assert.equal(formationArmyId('op:a'),formationArmyId('op:a'));assert.notEqual(formationArmyId('op:a'),formationArmyId('op:b'));assert.notEqual(formationArmyId('op:a'),formationArmyId('op:a\"'));
});
test('reversing insertion order preserves source site target quantities and ranking',()=>{
  const s=world(),r=cloneGameState(s);r.territories=new Map([...r.territories].reverse());r.armies=new Map([...r.armies].reverse());r.territoryRecruitment=new Map([...r.territoryRecruitment].reverse());
  assert.deepEqual(fieldRecoveryOpportunity(s,'f_ai_0'),fieldRecoveryOpportunity(r,'f_ai_0'));observeSources(s,'f_ai_0');observeSources(r,'f_ai_0');const source=[...s.aiPressure.values()].find(c=>c.kind==='FIELD_FORCE_GAP')!,other=r.aiPressure.get(source.id)!;
  assert.deepEqual(sourceConcretePlans(s,source).map(p=>p.id),sourceConcretePlans(r,other).map(p=>p.id));
});
test('existing army removes recovery pressure without revoking legal explicit formation',()=>{
  const s=world();s.armies.set('existing',{id:'existing',owner:'f_ai_0',location:plan(s).territoryId,soldiers:10,knights:0,siegeEngines:0,morale:80,supply:80});s.factions.get('f_ai_0')!.armies=['existing'];
  assert.equal(fieldRecoveryOpportunity(s,'f_ai_0'),null);assert.equal(reinforcementProblem(s,plan(s)),null);
});
test('below-eligibility survivor gains usable offensive capacity when exact allocation crosses the native floor',()=>{
  const s=world(),r=fieldRecoveryOpportunity(s,'f_ai_0')!;
  const a={id:'survivor',owner:'f_ai_0',location:r.territoryId,soldiers:76,knights:0,siegeEngines:0,morale:80,supply:80};s.armies.set(a.id,a);s.factions.get(a.owner)!.armies=[a.id];
  const p=makeConcretePlan({action:'REINFORCE',factionId:a.owner,territoryId:a.location,sourcePoolId:recruitmentPoolId(a.location),quantity:25,destination:{kind:'army',armyId:a.id,territoryId:a.location}}) as ReinforcePlan;
  const assessment=new StrategicEvaluators(new FactualSupport(s)).localAllocationValue(p,r.targetTerritoryId);
  assert.equal(assessment.facts.offensiveGain,computeAttackerPower([{...a,soldiers:101}]).effectivePower);assert.equal(a.soldiers,76);
});
test('allocation ending exactly at the native attack floor does not claim restored eligibility',()=>{
  const s=world(),r=fieldRecoveryOpportunity(s,'f_ai_0')!;
  const a={id:'survivor',owner:'f_ai_0',location:r.territoryId,soldiers:76,knights:0,siegeEngines:0,morale:80,supply:80};s.armies.set(a.id,a);s.factions.get(a.owner)!.armies=[a.id];
  const p=makeConcretePlan({action:'REINFORCE',factionId:a.owner,territoryId:a.location,sourcePoolId:recruitmentPoolId(a.location),quantity:24,destination:{kind:'army',armyId:a.id,territoryId:a.location}}) as ReinforcePlan;
  assert(new StrategicEvaluators(new FactualSupport(s)).localAllocationValue(p,r.targetTerritoryId).facts.offensiveGain<computeAttackerPower([{...a,soldiers:100}]).effectivePower);
});
test('no reachable hostile objective or protected player creates no recovery pressure',()=>{
  const s=world();for(const t of s.territories.values())if(t.owner!=='f_ai_0'){t.baseValue=0;t.resourceOutput={};}assert.equal(fieldRecoveryOpportunity(s,'f_ai_0'),null);
});
test('factual formation value ignores private Goals Opinion and personality',()=>{
  const s=world(),r=fieldRecoveryOpportunity(s,'f_ai_0')!,p=plan(s,r.quantity,r.territoryId),a=new StrategicEvaluators(new FactualSupport(s)).localAllocationValue(p,r.targetTerritoryId);
  s.factions.get('f_ai_0')!.goals=[];s.factions.get('f_ai_0')!.diplomacy.clear();s.factions.get('f_ai_0')!.personality.aggression=0;
  assert.deepEqual(a,new StrategicEvaluators(new FactualSupport(s)).localAllocationValue(p,r.targetTerritoryId));
});
test('banked upkeep cannot consume inaccessible territory Food for either owner type',()=>{
  const s=world();for(const f of s.factions.values())f.resources.food=0;s.worldTick=60;s.accruedTargetWorldTick=60;for(const t of s.territories.values())persistTerritoryAccrual(s,t.id);
  const local=[...s.territoryEconomy].map(([id,r])=>[id,r.uncollected.food]);const result=consumeEmpireFood(s);assert(result.factions.every(f=>f.paid===0));assert.deepEqual([...s.territoryEconomy].map(([id,r])=>[id,r.uncollected.food]),local);
});
test('local recruitment remains Food-funded and cannot borrow abstract bank Food',()=>{
  const s=world();for(const r of s.territoryEconomy.values())r.uncollected.food=0;const before=holdings(s);const result=progressRecruitment(s,1n);assert.equal(result.troopsGenerated,0);assert.deepEqual(holdings(s),before);
});
test('larger-map access and recovery probes are bounded deterministic and read-only',()=>{
  const s=createScenario({size:'large',seed:29,ticks:0,presence:'online'}).state,before=digest(s),started=performance.now();let observations=0;
  for(let repeat=0;repeat<20;repeat++)for(const a of s.armies.values()){strategicAccessOpportunity(s,a.owner,a.id);observations++;}assert.equal(digest(s),before);
  console.log(JSON.stringify({probe:'50-territory-native-access',observations,elapsedMs:performance.now()-started}));
  for(const [id,a]of s.armies)if(a.owner==='f_ai_0')s.armies.delete(id);s.factions.get('f_ai_0')!.armies=[];initializeRecruitment(s);for(const pool of s.territoryRecruitment.values())if(pool.factionId==='f_ai_0')pool.troops=1000;
  const recoveryBefore=digest(s),recoveryStart=performance.now(),first=fieldRecoveryOpportunity(s,'f_ai_0');
  for(let i=0;i<20;i++)assert.deepEqual(fieldRecoveryOpportunity(s,'f_ai_0'),first);assert.equal(digest(s),recoveryBefore);
  console.log(JSON.stringify({probe:'50-territory-native-recovery',observations:21,elapsedMs:performance.now()-recoveryStart}));
});
test('recovered native actions replay identically with fixed seed and different receipt batching',()=>{
  const config={size:'medium' as const,seed:11,ticks:120,presence:'online' as const,reloadEvery:10};
  const fine=runSimulation({...config,stepTicks:1}),coarse=runSimulation({...config,stepTicks:5});assert(fine.summary.completed&&coarse.summary.completed);assert.equal(fine.summary.stateDigest,coarse.summary.stateDigest);
});
test('native recovery simulations conserve all troops Food and other resources',()=>{
  for(const size of ['small','medium','large'] as const){const r=runSimulation({size,seed:11,ticks:60,presence:'online',stepTicks:5,reloadEvery:10});assert(r.summary.completed,JSON.stringify(r.summary.error));assert.deepEqual(r.summary.nestedErrors,[]);assert.equal(r.summary.conservation.troopResidual,0);assert.equal(r.summary.conservation.siegeResidual,0);assert(Object.values(r.summary.conservation.resourceResidual).every(n=>n===0));}
});
async function main(){let passed=0,failed=0;const filter=process.argv.includes('--filter')?new RegExp(process.argv[process.argv.indexOf('--filter')+1]):null;
for(const [name,fn]of tasks.filter(([name])=>!filter||filter.test(name))){try{await fn();passed++;console.log('PASS',name);}catch(e){failed++;console.error('FAIL',name,e);}}
console.log(JSON.stringify({passed,failed,skipped:0}));if(failed)process.exitCode=1;}
void main();
