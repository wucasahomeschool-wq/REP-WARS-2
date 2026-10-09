import { primeSourceDecision } from './aiPressureFixtures';
import { makeOperationTestWorld } from './aiOperationFixtures';
import assert from 'assert';
import { Army, AICommitment, Territory, WarlordSnapshot } from '../src/types';
import { GameState, GAME_STATE_SCHEMA_VERSION } from '../src/types/GameState';
import { AIConcretePlan, AttackPlan, BuildPlan, cloneConcretePlan, concretePlanProblem, makeConcretePlan, planTargetId } from '../src/types/AIConcretePlan';
import { createLegacySampleMapGameState } from '../src/state/createGameState';
import { authoredWorldFields } from './worldTestHelpers';
import { generateConcretePlans } from '../src/engine/concretePlans';
import { toDecisionEngineSnapshot, buildWarlordStates } from '../src/state/gameStateAdapters';
import { makeCommitmentId } from '../src/engine/DecisionEngine';
import { activeOperations, operationFromSelection, settleOperation, acquireOperationClaims, createOperationMap } from '../src/engine/operations';
import { cloneGameState } from '../src/state/cloneGameState';
import { checkGameStateInvariants } from '../src/state/gameStateInvariants';
import { OrchestrationError, ErrorCode } from '../src/orchestration/errors';
import { createDefaultRegistry } from '../src/orchestration';
import { Orchestrator, CommandRequest } from '../src/orchestration';
import { hydratePersistedPayload } from '../src/persistence/hydrate';
import { encodePersistable } from '../src/persistence/serialization';
import { progressAllConstructions } from '../src/gameplay/construction/progress';
import { settleTerritoryOwnershipChange } from '../src/gameplay/economy/ownership';
import { invalidateStaleAttackIntents, executeReadyStrategicAttack } from '../src/army/strategicAttack';
import { resolveInvasionBattle } from '../src/gameplay/invasion/resolve';
import { createTelemetryRecorder } from '../src/analytics/recorder';
import { beginInvasionAgainstPlayer } from '../src/gameplay/invasion/create';
import { BattleEngine } from '../src/battle/BattleEngine';
import { progressArmyMovements, beginArmyMovement, movementTicksRemaining } from '../src/army/movement';

interface Api {
  test(name: string, run: () => void): void;
  makeSelf(id: string, overrides?: Partial<WarlordSnapshot>): WarlordSnapshot;
  makeTerritory(overrides: Partial<Territory> & { id: string }): Territory;
  makeCmt(partial: Partial<AICommitment> & Pick<AICommitment, 'warlordId' | 'action'>): AICommitment;
  cmdReq(commandId: string, playerId: string, parameters?: Record<string, unknown>): CommandRequest;
}
export function registerAiOperationTests({ test, makeSelf, makeTerritory, makeCmt, cmdReq }: Api): void {
  function world(): GameState {
    return makeOperationTestWorld(makeSelf, makeTerritory);
  }
  const plans = (s:GameState)=>generateConcretePlans(toDecisionEngineSnapshot(s),'me');
  const move = (s:GameState,id:string,dest='other')=>plans(s).find(p=>p.action==='MOVE'&&p.armyId===id&&p.destinationTerritoryId===dest)!;
  const attack = (s:GameState,id='b')=>plans(s).find((p):p is AttackPlan=>p.action==='ATTACK'&&p.armyId===id&&p.stagingTerritoryId==='stage')!;
  const build = (s:GameState,site='home')=>plans(s).find((p):p is BuildPlan=>p.action==='BUILD'&&p.territoryId===site&&p.projectType==='FARM')!;
  function start(o:Orchestrator,p:AIConcretePlan):string {
    assert.ok(p); const r=o.execute(cmdReq('START_AI_OPERATION','ai',{plan:p}));
    assert.strictEqual(r.success,true,JSON.stringify(r.errors)); return r.payload.operationId as string;
  }
  function advance(o:Orchestrator,ticks:number):void {
    const r=o.execute(cmdReq('ADVANCE_WORLD','ai',{elapsedTicks:ticks})); assert.strictEqual(r.success,true,JSON.stringify(r.errors));
    assert.deepStrictEqual(checkGameStateInvariants(o.getState()),[]);
  }
  function legacy(s:GameState, c:AICommitment|null):GameState {
    const old:Record<string,unknown>={...cloneGameState(s),schemaVersion:18,commitments:new Map([['me',c]])};
    delete old.operations; delete old.operationClaims;
    return hydratePersistedPayload(encodePersistable(old));
  }

  test('Phase C: MOVE Army A and staged ATTACK Army B coexist without overwriting either operation',()=>{
    const s=world(), m=move(s,'a'), a=attack(s); const o=new Orchestrator(s);
    const mid=start(o,m), aid=start(o,a), live=o.getState();
    assert.strictEqual(activeOperations(live,'me').length,2);
    assert.strictEqual(live.armies.get('a')!.movement!.commitmentId,mid);
    assert.strictEqual(live.armies.get('b')!.attackIntent!.commitmentId,aid);
    assert.deepStrictEqual(live.operations.get(aid)!.plan,a);
    assert.strictEqual(live.operationClaims.get('force:a')!.operationId,mid);
    assert.strictEqual(live.operationClaims.get('force:b')!.operationId,aid);
    assert.deepStrictEqual(checkGameStateInvariants(live),[]);
    assert.ok(!('commitments' in live));
  });
  test('Phase C: two independent marches complete at the same physical boundary',()=>{
    const s=world(),o=new Orchestrator(s); const a=start(o,move(s,'a')), b=start(o,move(s,'b'));
    const duration=o.getState().armies.get('a')!.movement!.durationTicks; advance(o,duration);
    for(const id of[a,b]) assert.strictEqual(o.getState().operations.get(id)!.terminal!.outcome,'completed');
    for(const id of[a,b]) assert.deepStrictEqual(o.getState().operations.get(id)!.claimIds,[]);
    for(const id of['a','b']) assert.ok(!o.getState().operationClaims.has(`force:${id}`));
    for(const id of['a','b']) assert.strictEqual(o.getState().armies.get(id)!.location,'other');
  });
  test('Phase C: construction and a march coexist; BUILD completes only with its actual project',()=>{
    const s=world(),o=new Orchestrator(s);const bid=start(o,build(s)),mid=start(o,move(s,'a'));
    const op=o.getState().operations.get(bid)!; const project=o.getState().constructions.get(op.links.constructionId!)!;
    assert.strictEqual(project.aiOperationId,bid); assert.strictEqual(op.phase,'physical');
    advance(o,o.getState().armies.get('a')!.movement!.durationTicks);
    assert.strictEqual(o.getState().operations.get(mid)!.phase,'terminal');
    assert.strictEqual(o.getState().operations.get(bid)!.phase,'physical');
    const d=cloneGameState(o.getState());d.worldTick=project.startedAtTick+project.remainingTicks;d.accruedTargetWorldTick=d.worldTick;
    progressAllConstructions(d);assert.strictEqual(d.operations.get(bid)!.terminal!.outcome,'completed');
    assert.ok(!d.operationClaims.has('construction_site:home'));assert.deepStrictEqual(checkGameStateInvariants(d),[]);
  });
  test('Phase C: early terminal requests cannot free an active construction site',()=>{
    const s=world(),o=new Orchestrator(s),id=start(o,build(s)),d=cloneGameState(o.getState());
    assert.strictEqual(settleOperation(d,id,'failed','reasoning invalidation'),false);
    assert.strictEqual(d.operations.get(id)!.phase,'physical');
    assert.strictEqual(d.operationClaims.get('construction_site:home')!.operationId,id);
  });
  for(const action of['MOVE','ATTACK','RETREAT'] as const) test(`Phase C: claimed force cannot start incompatible ${action}`,()=>{
    const s=world();const original=move(s,'a');
    const p=action==='MOVE'?original:action==='ATTACK'?attack(s,'a'):makeConcretePlan({action:'RETREAT',factionId:'me',armyId:'a',originTerritoryId:'home',fallbackTerritoryId:'other',route:['home','other']});
    const o=new Orchestrator(s);start(o,original);const before=encodePersistable(o.getState());
    assert.strictEqual(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:p})).success,false);
    assert.deepStrictEqual(encodePersistable(o.getState()),before);
  });
  test('Phase C: occupied build site rejects atomically; another site remains usable',()=>{
    const s=world(),p=build(s),o=new Orchestrator(s);start(o,p);const before=encodePersistable(o.getState());
    assert.strictEqual(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:p})).success,false);
    assert.deepStrictEqual(encodePersistable(o.getState()),before);start(o,build(o.getState(),'other'));
    assert.strictEqual(activeOperations(o.getState(),'me').length,2);
  });
  test('Phase C: multi-claim acquisition never leaves a partial force claim on target conflict',()=>{
    const s=world(),a=attack(s,'a'),b=attack(s,'b'),o=new Orchestrator(s);start(o,a);
    const before=encodePersistable(o.getState());assert.strictEqual(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:b})).success,false);
    assert.deepStrictEqual(encodePersistable(o.getState()),before);assert.ok(!o.getState().operationClaims.has('force:b'));
    // Exercise the all-or-none claim reducer as well as command prevalidation.
    const d=cloneGameState(o.getState()),candidate=operationFromSelection({...makeCmt({warlordId:'me',action:'ATTACK',targetId:'target'}),id:'second',plan:b},0);
    const claims=encodePersistable(d.operationClaims);assert.throws(()=>acquireOperationClaims(d,candidate));
    assert.deepStrictEqual(encodePersistable(d.operationClaims),claims);assert.deepStrictEqual(candidate.claimIds,[]);
  });
  test('Phase C/ D: ordinary cognition preserves concurrent work and coalesces its primary initiation',()=>{
    const s=world(),o=new Orchestrator(s);const held=[start(o,move(s,'a')),start(o,attack(s))];const n=o.getState().operations.size;
    o.getState().territories.get('home')!.resourceOutput={food:5};o.getState().factions.get('me')!.resources.food=0;primeSourceDecision(o.getState(),'me');const decision=o.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'}));assert.strictEqual(decision.success,true);
    assert.strictEqual((decision.payload.selectedOperationIds as string[]).length,1);assert.strictEqual(o.getState().operations.size,n+1);
    assert.strictEqual(buildWarlordStates(o.getState()).get('me')!.activeCommitment,null);
    assert.strictEqual((o.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'})).payload.selectedOperationIds as string[]).length,0);
    for(const id of held)assert.strictEqual(o.getState().operations.get(id)!.phase,'physical');
    assert.strictEqual(o.execute(cmdReq('RESOLVE_COMMITMENT','ai',{factionId:'me'})).success,false,'ambiguous faction-wide resolution must not choose an operation');
  });
  test('Phase C: invalid ATTACK preserves eight ticks of remaining travel and its force claim',()=>{
    const s=world(),initial=new Orchestrator(s),id=start(initial,attack(s));
    // Persisted physical durations remain authoritative even when they came
    // from a longer historical march; no timing/balance constant is changed.
    const physical=cloneGameState(initial.getState());physical.armies.get('b')!.movement!.durationTicks=10;
    const o=new Orchestrator(physical);advance(o,2);const d=cloneGameState(o.getState());
    settleTerritoryOwnershipChange(d,'target','me','enemy');
    const t=d.territories.get('target')!;t.owner='me';d.factions.get('enemy')!.territories=[];d.factions.get('me')!.territories.push('target');
    const march={...d.armies.get('b')!.movement!};invalidateStaleAttackIntents(d);
    assert.deepStrictEqual(d.armies.get('b')!.movement,march);assert.strictEqual(movementTicksRemaining(march,d.worldTick),8);
    assert.strictEqual(d.operations.get(id)!.phase,'recovery');assert.strictEqual(d.operations.get(id)!.objective,'invalid');
    assert.strictEqual(d.armies.get('b')!.location,'home');assert.ok(d.operationClaims.has('force:b'));assert.ok(!d.operationClaims.has('engagement_target:["me","target"]'));
    for(const fid of d.allFactionIds) d.lastAiDecisionTick.set(fid,d.worldTick+10000);
    const restarted=new Orchestrator(hydratePersistedPayload(encodePersistable(d)));advance(restarted,7);
    assert.strictEqual(restarted.getState().armies.get('b')!.location,'home');assert.ok(restarted.getState().operationClaims.has('force:b'));
    advance(restarted,1);assert.strictEqual(restarted.getState().armies.get('b')!.location,'stage');
    assert.strictEqual(restarted.getState().operations.get(id)!.terminal!.outcome,'failed');assert.ok(!restarted.getState().operationClaims.has('force:b'));
  });
  test('Phase C: settlement is idempotent, feedback once, and cannot release another operation claim',()=>{
    const s=world(),o=new Orchestrator(s),a=start(o,move(s,'a')),b=start(o,move(s,'b'));
    const d=cloneGameState(o.getState());assert.strictEqual(settleOperation(d,a,'failed','invalid objective'),false);
    assert.strictEqual(d.factions.get('me')!.memory.length,0); // Not terminal while in transit.
    d.armies.get('a')!.movement=null;assert.strictEqual(settleOperation(d,a,'failed','physical boundary'),true);
    assert.strictEqual(d.factions.get('me')!.memory.length,1);const before=encodePersistable(d);
    assert.strictEqual(settleOperation(d,a,'completed','replayed event'),false);assert.deepStrictEqual(encodePersistable(d),before);
    assert.strictEqual(d.operationClaims.get('force:b')!.operationId,b);
  });
  test('Phase C: destroyed construction settles its linked operation exactly once',()=>{
    const s=world(),o=new Orchestrator(s),id=start(o,build(s)),d=cloneGameState(o.getState());
    settleTerritoryOwnershipChange(d,'home','enemy','me');assert.strictEqual(d.operations.get(id)!.terminal!.outcome,'failed');
    const before=encodePersistable(d);settleTerritoryOwnershipChange(d,'home','enemy','me');assert.deepStrictEqual(encodePersistable(d),before);
    assert.ok(!d.operationClaims.has('construction_site:home'));
  });
  test('Phase C: concurrent save/reload retains exact plans, IDs, links, claims and isolation',()=>{
    const s=world(),o=new Orchestrator(s);start(o,move(s,'a'));start(o,attack(s));start(o,build(o.getState()));
    const current=o.getState(),loaded=hydratePersistedPayload(encodePersistable(current)),cloned=cloneGameState(current);
    assert.deepStrictEqual(loaded.operations,current.operations);assert.deepStrictEqual(loaded.operationClaims,current.operationClaims);
    const first=[...cloned.operations.values()][0]!;first.links.armyId='changed';first.claimIds.push('changed');
    assert.notDeepStrictEqual(cloned.operations,current.operations);assert.deepStrictEqual(encodePersistable(current),encodePersistable(loaded));
    assert.strictEqual(loaded.schemaVersion,GAME_STATE_SCHEMA_VERSION);assert.ok(Object.isFrozen([...loaded.operations.values()][0]!.plan));
  });
  test('Phase C: same-boundary progression is identical after reload and reversed Map insertion',()=>{
    const s=world(),o=new Orchestrator(s);start(o,move(s,'a'));start(o,move(s,'b'));start(o,build(o.getState()));
    const d=hydratePersistedPayload(encodePersistable(o.getState()));d.operations=new Map([...d.operations].reverse());d.operationClaims=new Map([...d.operationClaims].reverse());d.armies=new Map([...d.armies].reverse());
    const restored=new Orchestrator(d);advance(o,20);advance(restored,20);
    const normalize=(s:GameState)=>({armies:[...s.armies].sort(),operations:[...s.operations].sort(),claims:[...s.operationClaims].sort(),factions:[...s.factions].sort(),constructions:[...s.constructions].sort()});
    assert.deepStrictEqual(normalize(restored.getState()),normalize(o.getState()));
  });
  test('Phase C: migrated schema 18 without commitments introduces no fake operation',()=>{
    const d=legacy(world(),null);assert.strictEqual(d.operations.size,0);assert.strictEqual(d.operationClaims.size,0);assert.ok(!('commitments'in d));
  });
  for(const action of['MOVE','RETREAT','ATTACK','BUILD'] as const)test(`Phase C: schema 18 exact ${action} reconciles with existing physical truth`,()=>{
    const s=world();
    if(action==='RETREAT') {s.territories.get('home')!.owner='enemy';s.factions.get('me')!.territories=s.factions.get('me')!.territories.filter(x=>x!=='home');s.factions.get('enemy')!.territories.push('home');}
    const o=new Orchestrator(s),p=action==='MOVE'?move(s,'a'):action==='RETREAT'?makeConcretePlan({action:'RETREAT',factionId:'me',armyId:'a',originTerritoryId:'home',fallbackTerritoryId:'other',route:['home','other']}):action==='ATTACK'?attack(s):build(s),id=start(o,p);
    const current=o.getState(),record={...current.operations.get(id)!};
    const d=legacy(current,record);assert.strictEqual(d.operations.get(id)!.phase,'physical');
    assert.deepStrictEqual(d.operations.get(id)!.plan,p);assert.deepStrictEqual(d.operationClaims,current.operationClaims);
    assert.strictEqual(d.factions.get('me')!.nextAiCommitmentSequence,current.factions.get('me')!.nextAiCommitmentSequence);
    assert.deepStrictEqual(checkGameStateInvariants(d),[]);
  });
  test('Phase C: incomplete legacy reasoning is archived without inventing a plan or deleting travel',()=>{
    const s=world(),o=new Orchestrator(s),id=start(o,move(s,'a')),current=o.getState(),record={...current.operations.get(id)!};delete record.plan;
    const d=legacy(current,record);assert.strictEqual(d.operations.get(id)!.phase,'terminal');assert.strictEqual(d.operations.get(id)!.plan,undefined);
    assert.deepStrictEqual({...d.armies.get('a')!.movement!,commitmentId:id},current.armies.get('a')!.movement);
    assert.strictEqual(d.armies.get('a')!.movement!.commitmentId,null);assert.strictEqual(d.operationClaims.size,0);
  });
  test('Phase C: old completed BUILD with unique live project becomes a linked physical operation',()=>{
    const s=world(),o=new Orchestrator(s),id=start(o,build(s)),current=o.getState(),record={...current.operations.get(id)!,status:'completed' as const};
    const d=legacy(current,record);assert.strictEqual(d.operations.get(id)!.phase,'physical');assert.strictEqual(d.operations.get(id)!.status,'executing');
    assert.strictEqual(d.constructions.get(d.operations.get(id)!.links.constructionId!)!.aiOperationId,id);
  });
  test('Phase C: migration does not bind a saved exact plan to a different physical destination',()=>{
    const s=world(),o=new Orchestrator(s),id=start(o,move(s,'a')),current=cloneGameState(o.getState());
    current.armies.get('a')!.movement!.destinationTerritoryId='stage';const d=legacy(current,{...current.operations.get(id)!});
    assert.strictEqual(d.operations.get(id)!.phase,'terminal');assert.strictEqual(d.armies.get('a')!.movement!.destinationTerritoryId,'stage');
    assert.strictEqual(d.armies.get('a')!.movement!.commitmentId,null);
  });
  test('Phase C: one matching legacy attack link cannot conceal a mismatched physical march',()=>{
    const s=world(),o=new Orchestrator(s),id=start(o,attack(s)),current=cloneGameState(o.getState());
    const army=current.armies.get('b')!;
    army.location='other';army.movement!.originTerritoryId='other';
    const physical={...army.movement!};const d=legacy(current,{...current.operations.get(id)!});
    assert.strictEqual(d.operations.get(id)!.phase,'terminal');assert.strictEqual(d.operationClaims.size,0);
    assert.deepStrictEqual({...d.armies.get('b')!.movement!,commitmentId:id},physical);
    assert.strictEqual(d.armies.get('b')!.attackIntent!.commitmentId,null);
    assert.deepStrictEqual(checkGameStateInvariants(d),[]);
  });
  test('Phase C: invariant rejects orphan claims, low sequence and divergent domain plan linkage',()=>{
    const s=world(),o=new Orchestrator(s),id=start(o,move(s,'a'));
    const d=cloneGameState(o.getState());d.operationClaims.get('force:a')!.operationId='unknown';assert.ok(checkGameStateInvariants(d).some(v=>v.code==='claim.orphan'));
    const bad=cloneGameState(o.getState());bad.factions.get('me')!.nextAiCommitmentSequence=0;assert.ok(checkGameStateInvariants(bad).some(v=>v.code==='faction.invalid_ai_commitment_sequence'));
    const route=cloneGameState(o.getState());route.armies.get('a')!.movement!.destinationTerritoryId='stage';assert.ok(checkGameStateInvariants(route).some(v=>v.code==='operation.movement_plan_mismatch'));
    assert.strictEqual(o.getState().operations.get(id)!.plan!.action,'MOVE');
  });
  test('Phase C: a faction-local attack claim does not reserve enemy territory against another faction',()=>{
    const s=world();s.playerFactionId=null;s.levelAnchorTerritoryIds=[];
    s.territories.get('safe')!.neighboring=['target'];s.territories.get('target')!.neighboring.push('safe');
    s.armies.set('c',{...s.armies.get('a')!,id:'c',owner:'spectator',location:'safe'});s.factions.get('spectator')!.armies=['c'];
    const other=generateConcretePlans(toDecisionEngineSnapshot(s),'spectator').find(p=>p.action==='ATTACK'&&p.armyId==='c')!;
    const o=new Orchestrator(s);start(o,attack(s));const id=start(o,other);assert.strictEqual(o.getState().operations.get(id)!.plan!.factionId,'spectator');
  });
  test('Phase C: direct commands cannot impersonate a selected WAIT operation to execute an attack',()=>{
    const s=world();s.armies.get('b')!.location='stage';const wait=plans(s).find(p=>p.action==='WAIT')!;
    s.operations.set('waiting',operationFromSelection({...makeCmt({warlordId:'me',action:'WAIT'}),id:'waiting',plan:wait},0));
    const o=new Orchestrator(s),before=encodePersistable(o.getState());
    assert.strictEqual(o.execute(cmdReq('ATTACK','ai',{factionId:'me',territoryId:'target',commitmentId:'waiting',onlyArmyId:'b',stagingTerritoryId:'stage'})).success,false);
    assert.deepStrictEqual(encodePersistable(o.getState()),before);
  });
  test('Phase C: operation identity remains unique across colliding faction hashes',()=>{
    assert.notStrictEqual(makeCommitmentId(37,'Aa',0,0,'WAIT',null),makeCommitmentId(37,'BB',0,0,'WAIT',null));
    assert.strictEqual(makeCommitmentId(37,'Aa',0,0,'WAIT',null),makeCommitmentId(37,'Aa',0,0,'WAIT',null));
  });
  test('Phase C: domain start failure rolls back operation, all claims and persisted sequence',()=>{
    const s=world();s.armies.get('b')!.location='stage';const p=attack(s);
    class FailingBattle extends BattleEngine { override resolve(_input: Parameters<BattleEngine['resolve']>[0]): ReturnType<BattleEngine['resolve']> { throw new OrchestrationError(ErrorCode.ENGINE_ERROR,'injected domain failure'); } }
    const registry=createDefaultRegistry();registry.registerBattle(new FailingBattle());const o=new Orchestrator(s,registry);
    const before=encodePersistable(o.getState());const result=o.execute(cmdReq('START_AI_OPERATION','ai',{plan:p}));
    assert.strictEqual(result.success,false);assert.deepStrictEqual(encodePersistable(o.getState()),before);
  });
  test('Phase C: an anchor-protected exact start retains domain error metadata and acquires no claims',()=>{
    const s=world(),plan=attack(s);
    s.playerFactionId='enemy';s.levelAnchorTerritoryIds=['target'];
    s.territories.get('safe')!.owner='enemy';s.factions.get('enemy')!.territories.push('safe');
    s.factions.get('spectator')!.territories=[];
    const o=new Orchestrator(s),before=encodePersistable(o.getState());
    const result=o.execute(cmdReq('START_AI_OPERATION','ai',{plan}));
    assert.strictEqual(result.success,false);assert.strictEqual(result.errors[0]!.details?.reason,'anchor_protected');
    assert.ok(result.errors[0]!.message.includes('anchor'));
    assert.deepStrictEqual(encodePersistable(o.getState()),before);
  });
  test('Phase C: terminal clones cannot leak nested mutation into preceding canonical state',()=>{
    const s=world(),o=new Orchestrator(s),id=start(o,move(s,'a'));advance(o,2);
    const before=encodePersistable(o.getState()),copy=cloneGameState(o.getState()),terminal=copy.operations.get(id)!;
    assert.ok(Object.isFrozen(terminal));assert.throws(()=>terminal.links.armyId='changed');assert.throws(()=>terminal.reason.push('changed'));
    assert.deepStrictEqual(encodePersistable(o.getState()),before);
    const loaded=hydratePersistedPayload(before);assert.ok(Object.isFrozen(loaded.operations.get(id)!));
  });
  test('Phase C: migration preserves prior BUILD feedback and does not repeat it on physical completion',()=>{
    const s=world();s.factions.get('me')!.goals=[{id:'goal',type:'economic_growth',priority:50,targetFaction:null,targetTerritory:null,targetRegion:null,targetResource:'food',progress:4,targetProgress:100,deadlineTurn:null,createdTurn:0}];
    const o=new Orchestrator(s),id=start(o,build(s)),current=o.getState();
    const record={...current.operations.get(id)!,status:'completed' as const,originatingGoalId:'goal'};
    const d=legacy(current,record);d.worldTick=20;d.accruedTargetWorldTick=20;progressAllConstructions(d);
    assert.strictEqual(d.operations.get(id)!.terminal!.outcome,'completed');assert.strictEqual(d.factions.get('me')!.goals[0]!.progress,4);
  });
  test('Phase C: extinct invader releases only its force and waits for existing invasion resolution',()=>{
    const s=world();s.playerFactionId='enemy';s.levelAnchorTerritoryIds=['target'];s.armies.get('b')!.location='stage';
    const o=new Orchestrator(s),id=start(o,attack(s)),d=cloneGameState(o.getState()),invId=d.operations.get(id)!.links.invasionId!;
    d.armies.delete('b');d.factions.get('me')!.armies=['a'];settleOperation(d,id,'failed','force destroyed');
    assert.strictEqual(d.operations.get(id)!.phase,'recovery');assert.ok(!d.operationClaims.has('force:b'));
    assert.strictEqual(d.operationClaims.get('engagement_target:["me","target"]')!.operationId,id);assert.deepStrictEqual(checkGameStateInvariants(d),[]);
    resolveInvasionBattle(d,new BattleEngine(),invId,'undefended');assert.strictEqual(d.operations.get(id)!.terminal!.outcome,'failed');
    assert.strictEqual(d.operationClaims.size,0);assert.deepStrictEqual(checkGameStateInvariants(d),[]);
  });
  test('Phase C: malformed physical plans and missing maps produce invariant violations',()=>{
    const s=world(),o=new Orchestrator(s),id=start(o,move(s,'a'));const d=cloneGameState(o.getState());
    d.operations.get(id)!.plan='invalid' as never;assert.ok(checkGameStateInvariants(d).some(v=>v.code==='commitment.invalid_plan'));
    const bad={...s,operationClaims:undefined} as unknown as GameState;
    assert.ok(checkGameStateInvariants(bad).some(v=>v.code==='operation.missing_storage'));
  });
  test('Phase C: schema 18 faction-local ID collisions migrate deterministically without overwriting a faction',()=>{
    const s=world(),me=plans(s).find(p=>p.action==='WAIT')!,enemy=generateConcretePlans(toDecisionEngineSnapshot(s),'enemy').find(p=>p.action==='WAIT')!;
    const records=new Map(['me','enemy'].map(fid=>[fid,{...makeCmt({warlordId:fid,action:'WAIT'}),id:'legacy_collision',plan:fid==='me'?me:enemy}]));
    const old={...s,schemaVersion:18,commitments:records} as Record<string,unknown>;delete old.operations;delete old.operationClaims;
    const d=hydratePersistedPayload(encodePersistable(old));assert.strictEqual(d.operations.size,2);
    assert.deepStrictEqual([...d.operations.values()].map(o=>o.warlordId).sort(),['enemy','me']);
    assert.ok([...d.operations.values()].every(o=>o.legacyCommitmentId==='legacy_collision'));
    assert.deepStrictEqual(hydratePersistedPayload(encodePersistable(old)).operations,d.operations);
  });
  test('Phase C: current-schema missing claim storage is corruption rather than silent reservation loss',()=>{
    const s=world(),o=new Orchestrator(s);start(o,move(s,'a'));const bad={...o.getState()} as Record<string,unknown>;delete bad.operationClaims;
    assert.throws(()=>hydratePersistedPayload(encodePersistable(bad)),/requires canonical/);
  });
  for(const winner of['attacker','defender','draw'] as const)test(`Phase C: invasion ${winner} result settles attacker truth without outcome inversion`,()=>{
    const s=world();s.playerFactionId='enemy';s.levelAnchorTerritoryIds=['target'];s.armies.get('b')!.location='stage';
    const o=new Orchestrator(s),id=start(o,attack(s)),d=cloneGameState(o.getState()),op=d.operations.get(id)!;
    assert.ok(op.links.invasionId);assert.strictEqual(settleOperation(d,id,'failed','early request'),false);
    class ResultBattle extends BattleEngine {
      override resolve(input: Parameters<BattleEngine['resolve']>[0]) {const result=super.resolve(input);return {...result,winner};}
    }
    resolveInvasionBattle(d,new ResultBattle(),op.links.invasionId!,'undefended');
    assert.strictEqual(d.operations.get(id)!.terminal!.outcome,winner==='attacker'?'completed':'failed');
    assert.strictEqual(d.operationClaims.size,0);assert.deepStrictEqual(checkGameStateInvariants(d),[]);
    const before=encodePersistable(d);assert.strictEqual(settleOperation(d,id,'completed','replayed invasion'),false);assert.deepStrictEqual(encodePersistable(d),before);
  });
  for (const action of ['MOVE','RETREAT','ATTACK'] as const) test(`Phase C review: ${action} topology loss halts without teleport/free and survives reload`, () => {
    const s=world();
    if(action==='RETREAT') {s.territories.get('home')!.owner='enemy';s.factions.get('me')!.territories=s.factions.get('me')!.territories.filter(x=>x!=='home');s.factions.get('enemy')!.territories.push('home');}
    const p=action==='MOVE'?move(s,'a'):action==='ATTACK'?attack(s,'a'):makeConcretePlan({action:'RETREAT',factionId:'me',armyId:'a',originTerritoryId:'home',fallbackTerritoryId:'other',route:['home','other']}),o=new Orchestrator(s),id=start(o,p);
    const d=cloneGameState(o.getState()),army=d.armies.get('a')!;army.movement!.durationTicks=10;
    d.worldTick=2;d.accruedTargetWorldTick=2;
    const route={...army.movement!}; const dest=route.destinationTerritoryId;
    d.territories.get('home')!.neighboring=d.territories.get('home')!.neighboring.filter(x=>x!==dest);
    d.territories.get(dest)!.neighboring=d.territories.get(dest)!.neighboring.filter(x=>x!=='home');
    const halted=new Orchestrator(d);advance(halted,1);
    const blocked=halted.getState().armies.get('a')!.movement!;
    assert.strictEqual(blocked.status,'blocked');assert.strictEqual(blocked.startedAtTick,route.startedAtTick);
    assert.strictEqual(blocked.durationTicks,10);assert.strictEqual(blocked.haltedAtTick,3);
    assert.strictEqual(halted.getState().operations.get(id)!.phase,'recovery');
    assert.strictEqual(halted.getState().operationClaims.get('force:a')!.operationId,id);
    const reloaded=new Orchestrator(hydratePersistedPayload(encodePersistable(halted.getState())));advance(reloaded,20);
    assert.deepStrictEqual(reloaded.getState().armies.get('a')!.movement,blocked);
    assert.strictEqual(movementTicksRemaining(blocked,23),7);
    assert.strictEqual(reloaded.getState().operations.get(id)!.terminal,null);
    assert.strictEqual(reloaded.getState().armies.get('a')!.location,'home','recorded origin is not a returned/stationary force');
    assert.strictEqual(reloaded.execute(cmdReq('MOVE','ai',{factionId:'me',armyId:'a',destinationTerritoryId:'stage'})).success,false);
  });
  test('Phase C review: missing physical destination retains route/timing and force ownership',()=>{
    const s=world(),o=new Orchestrator(s),id=start(o,move(s,'a')),d=cloneGameState(o.getState());
    d.worldTick=1;d.accruedTargetWorldTick=1;
    d.territories.delete('other');d.factions.get('me')!.territories=d.factions.get('me')!.territories.filter(x=>x!=='other');
    for(const t of d.territories.values())t.neighboring=t.neighboring.filter(x=>x!=='other');
    Object.assign(d,authoredWorldFields(d.territories));
    const [event]=progressArmyMovements(d,1);assert.strictEqual(event!.status,'interrupted');
    settleOperation(d,id,'interrupted',event!.reason!);
    assert.strictEqual(d.armies.get('a')!.movement!.destinationTerritoryId,'other');
    assert.strictEqual(d.operations.get(id)!.terminal,null);assert.strictEqual(d.operationClaims.get('force:a')!.operationId,id);
    assert.deepStrictEqual(checkGameStateInvariants(d),[]);
    assert.deepStrictEqual(hydratePersistedPayload(encodePersistable(d)).armies,d.armies);
  });
  test('Phase C review: premature ready-attack polling preserves a still-traveling force',()=>{
    const s=world(),o=new Orchestrator(s);start(o,attack(s));const d=cloneGameState(o.getState()),before=encodePersistable(d);
    const result=executeReadyStrategicAttack(d,{req:cmdReq('ATTACK','ai'),registry:createDefaultRegistry()},'b');
    assert.strictEqual(result.payload.skipped,true);assert.deepStrictEqual(encodePersistable(d),before);
  });
  test('Phase C review: system invasion cannot take a moving force outside AI claims',()=>{
    const s=world();s.playerFactionId='enemy';s.levelAnchorTerritoryIds=['target'];
    beginArmyMovement(s,{armyId:'b',destinationTerritoryId:'stage',factionId:'me'});
    const before=encodePersistable(s);
    assert.throws(()=>beginInvasionAgainstPlayer(s,{attackerId:'me',territoryId:'target',armies:[s.armies.get('b')!]}),/unavailable/);
    assert.deepStrictEqual(encodePersistable(s),before);
  });
  test('Phase C review: direct commands/retries cannot overwrite a claimed exact force or destination',()=>{
    const s=world(),o=new Orchestrator(s),id=start(o,move(s,'a')),before=encodePersistable(o.getState());
    for(const req of [cmdReq('MOVE','ai',{factionId:'me',armyId:'a',destinationTerritoryId:'stage'}),cmdReq('MOVE','ai',{factionId:'me',armyId:'a',destinationTerritoryId:'stage',commitmentId:id}),cmdReq('ATTACK','ai',{factionId:'me',territoryId:'target',onlyArmyId:'a'})]) {
      assert.strictEqual(o.execute(req).success,false);assert.deepStrictEqual(encodePersistable(o.getState()),before);
    }
    const reloaded=new Orchestrator(hydratePersistedPayload(before));
    assert.strictEqual(reloaded.execute(cmdReq('START_AI_OPERATION','ai',{plan:move(s,'a')})).success,false);
    assert.deepStrictEqual(encodePersistable(reloaded.getState()),before);
  });
  test('Phase C review: open invasion ownership change preserves force until domain settlement',()=>{
    const s=world();s.playerFactionId='enemy';s.levelAnchorTerritoryIds=['target'];s.armies.get('b')!.location='stage';
    const o=new Orchestrator(s),id=start(o,attack(s)),d=cloneGameState(o.getState()),inv=d.operations.get(id)!.links.invasionId!;
    d.territories.get('target')!.owner='me';d.factions.get('me')!.territories.push('target');d.factions.get('enemy')!.territories=[];
    invalidateStaleAttackIntents(d);
    assert.ok(d.armies.get('b')!.attackIntent!.holdForInvasionId);assert.strictEqual(d.operationClaims.get('force:b')!.operationId,id);
    // The intermediate ownership mutation is settled at the next world boundary.
    d.lastAiDecisionTick.set('me',10000);
    const restarted=new Orchestrator(d);advance(restarted,1);
    assert.strictEqual(restarted.getState().operations.get(id)!.terminal!.outcome,'failed');
    assert.ok([...restarted.getState().operationClaims.values()].every(c=>c.operationId!==id));
    resolveInvasionBattle(d,new BattleEngine(),inv,'undefended');
    assert.strictEqual(d.operations.get(id)!.terminal!.outcome,'failed');assert.strictEqual(d.operationClaims.size,0);
    assert.deepStrictEqual(checkGameStateInvariants(d),[]);
  });
  test('Phase C review: active invasion migration links exact domain identity and survives reload',()=>{
    const s=world();s.playerFactionId='enemy';s.levelAnchorTerritoryIds=['target'];s.armies.get('b')!.location='stage';
    const o=new Orchestrator(s),id=start(o,attack(s)),current=o.getState(),d=legacy(current,{...current.operations.get(id)!});
    assert.deepStrictEqual(d.operations.get(id)!.links,current.operations.get(id)!.links);
    assert.deepStrictEqual(d.operationClaims,current.operationClaims);
    assert.deepStrictEqual(hydratePersistedPayload(encodePersistable(d)).operations,d.operations);
  });
  test('Phase C review: legacy reasoning cannot own another army sharing its old ID',()=>{
    const s=world(),o=new Orchestrator(s),id=start(o,move(s,'a')),d=cloneGameState(o.getState());
    d.armies.get('b')!.movement={...d.armies.get('a')!.movement!};
    const migrated=legacy(d,{...d.operations.get(id)!});
    assert.strictEqual(migrated.armies.get('a')!.movement!.commitmentId,id);
    assert.strictEqual(migrated.armies.get('b')!.movement!.commitmentId,null);
    assert.strictEqual(migrated.armies.get('b')!.movement!.durationTicks,d.armies.get('b')!.movement!.durationTicks);
    assert.deepStrictEqual(checkGameStateInvariants(migrated),[]);
  });
  test('Phase C review: ambiguous pending legacy record does not fabricate a new start beside real travel',()=>{
    const s=world(),o=new Orchestrator(s),id=start(o,move(s,'a')),d=cloneGameState(o.getState());
    d.armies.get('a')!.movement!.destinationTerritoryId='stage';
    const migrated=legacy(d,{...d.operations.get(id)!,status:'committed'});
    assert.strictEqual(migrated.operations.get(id)!.phase,'terminal');
    assert.strictEqual(migrated.armies.get('a')!.movement!.destinationTerritoryId,'stage');
    assert.strictEqual(migrated.armies.get('a')!.movement!.commitmentId,null);
  });
  test('Phase C review: terminal IDs preserve sequence floors through migration/reload',()=>{
    const s=world(),p=plans(s).find(p=>p.action==='WAIT')!,id=makeCommitmentId(37,'me',0,9999,'WAIT',null);
    s.factions.get('me')!.nextAiCommitmentSequence=10000;
    const record={...makeCmt({warlordId:'me',action:'WAIT'}),id,plan:p,status:'completed' as const};
    const d=legacy(s,record),reloaded=hydratePersistedPayload(encodePersistable(d));
    assert.strictEqual(reloaded.factions.get('me')!.nextAiCommitmentSequence,10000);
    const o=new Orchestrator(reloaded),newId=start(o,move(reloaded,'a'));assert.notStrictEqual(newId,id);
    assert.strictEqual(o.getState().factions.get('me')!.nextAiCommitmentSequence,10001);
    const corrupt=cloneGameState(d);corrupt.factions.get('me')!.nextAiCommitmentSequence=9999;
    assert.throws(()=>hydratePersistedPayload(encodePersistable(corrupt)),/reuse/);
  });
  test('Phase C review: live queries do not scan retained terminal history; index rebuild/delete/clear remain equivalent',()=>{
    const s=world(),p=plans(s).find(p=>p.action==='WAIT')!,map=createOperationMap();
    for(let i=0;i<5000;i++) {
      const op=operationFromSelection({...makeCmt({warlordId:'me',action:'WAIT'}),id:`history-${i}`,plan:p},0);
      op.phase='terminal';op.status='completed';op.terminal={outcome:'completed',reason:'history',atTick:0};map.set(op.id,op);
    }
    const live=operationFromSelection({...makeCmt({warlordId:'me',action:'WAIT'}),id:'live',plan:p},0);map.set(live.id,live);s.operations=map;
    Object.defineProperty(map,'values',{value:()=>{throw new Error('active query scanned history');}});
    assert.deepStrictEqual(activeOperations(s).map(o=>o.id),['live']);
    const cloned=cloneGameState(s);assert.deepStrictEqual(activeOperations(cloned).map(o=>o.id),['live']);
    assert.strictEqual(cloned.operations.size,5001);
    cloned.operations.delete('live');assert.deepStrictEqual(activeOperations(cloned),[]);
    cloned.operations.clear();assert.strictEqual(cloned.operations.size,0);
  });
  test('Phase C review: immutable plan shape caching never caches mutable or shallow-frozen input',()=>{
    const s=world(),p=move(s,'a'),mutable=JSON.parse(JSON.stringify(p));
    assert.strictEqual(concretePlanProblem(p),null);assert.strictEqual(concretePlanProblem(p),null);
    for (const malformed of [null,false,0,'']) assert.strictEqual(concretePlanProblem(cloneConcretePlan(malformed as never)), 'plan must be an object');
    assert.strictEqual(concretePlanProblem(mutable),null);mutable.route[1]='different';
    assert.strictEqual(concretePlanProblem(mutable),'concrete plan identity mismatch');
    const shallow=Object.freeze(JSON.parse(JSON.stringify(p)));assert.strictEqual(concretePlanProblem(shallow),null);
    shallow.route[1]='different';assert.strictEqual(concretePlanProblem(shallow),'concrete plan identity mismatch');
  });

  test('Phase C/D: coalesced cognition analytics retain all operation IDs without reporting duplicate selection',()=>{
    const s=world(),recorder=createTelemetryRecorder(),o=new Orchestrator(s,undefined,recorder);
    const ids=[start(o,move(s,'a')),start(o,attack(s))].sort();
    assert.ok(recorder.getEvents({eventType:'ai.commitment_resolved'}).every(e=>e.payload.success===undefined), 'physical starts are not terminal failures');
    o.getState().territories.get('home')!.resourceOutput={food:5};o.getState().factions.get('me')!.resources.food=0;primeSourceDecision(o.getState(),'me');const selected=o.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'}));
    ids.push((selected.payload.selectedOperationIds as string[])[0]!);ids.sort();
    const response=o.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'}));
    assert.strictEqual(response.success,true);assert.deepStrictEqual(response.payload.selectedOperationIds,[]);
    assert.strictEqual(recorder.getEvents({eventType:'ai.decision_selected'}).length,1);
    const cycle=recorder.getEvents({eventType:'ai.decision_cycle'}).slice(-1)[0]!;
    assert.deepStrictEqual(cycle.payload.operationIds,ids);
  });

  for(const winner of ['attacker','defender','draw'] as const)test(`Phase C review: immediate ${winner} battle result settles exact attacker once`,()=>{
    const s=world();s.armies.get('b')!.location='stage';
    class ResultBattle extends BattleEngine {
      override resolve(input: Parameters<BattleEngine['resolve']>[0]) {return {...super.resolve(input),winner};}
    }
    const registry=createDefaultRegistry();registry.registerBattle(new ResultBattle());const o=new Orchestrator(s,registry),id=start(o,attack(s));
    assert.strictEqual(o.getState().operations.get(id)!.terminal!.outcome,winner==='attacker'?'completed':'failed');
    assert.ok([...o.getState().operationClaims.values()].every(c=>c.operationId!==id));
    const d=cloneGameState(o.getState()),before=encodePersistable(d);assert.strictEqual(settleOperation(d,id,'completed','duplicate battle'),false);
    assert.deepStrictEqual(encodePersistable(d),before);
  });
  test('Phase C review: unavailable final actions cannot masquerade as physical operations',()=>{
    const s=world(),plan=makeConcretePlan({action:'TRADE',factionId:'me',counterpartyId:'enemy',offered:{gold:2},requested:{food:1}});
    const op=operationFromSelection({...makeCmt({warlordId:'me',action:'TRADE',targetId:'enemy'}),id:'unavailable',plan},0);
    op.phase='physical';op.status='executing';s.operations.set(op.id,op);
    assert.ok(checkGameStateInvariants(s).some(v=>v.code==='operation.unavailable_physical_action'));
  });

  test('Phase C review: ambiguous legacy invasion settlement never clears another operation march',()=>{
    const s=world();s.playerFactionId='enemy';s.levelAnchorTerritoryIds=['target'];s.armies.get('b')!.location='stage';
    const o=new Orchestrator(s),id=start(o,attack(s)),d=cloneGameState(o.getState()),inv=d.operations.get(id)!.links.invasionId!;
    const record={...d.operations.get(id)!};delete record.plan;
    const army=d.armies.get('b')!;army.location='home';army.attackIntent!.status='pending_movement';army.movement={originTerritoryId:'home',destinationTerritoryId:'stage',startedAtTick:0,durationTicks:10,status:'moving',commitmentId:id};
    // Ambiguous old AI reasoning is archived, but domain travel remains real.
    const migrated=legacy(d,record),march={...migrated.armies.get('b')!.movement!};
    assert.strictEqual(migrated.operations.get(id)!.phase,'terminal');
    resolveInvasionBattle(migrated,new BattleEngine(),inv,'undefended');
    assert.deepStrictEqual(migrated.armies.get('b')!.movement,march);
    assert.strictEqual(migrated.armies.get('b')!.location,'home');
    assert.deepStrictEqual(checkGameStateInvariants(migrated),[]);
  });
  test('Phase C review: BUILD physical completion emits one exact terminal operation record',()=>{
    const s=world(),o=new Orchestrator(s),id=start(o,build(s)),d=cloneGameState(o.getState());
    const project=d.constructions.get(d.operations.get(id)!.links.constructionId!)!;
    d.worldTick=project.startedAtTick+project.remainingTicks-1;d.accruedTargetWorldTick=d.worldTick;
    for(const fid of d.allFactionIds)d.lastAiDecisionTick.set(fid,d.worldTick);
    const resumed=new Orchestrator(d),result=resumed.execute(cmdReq('ADVANCE_WORLD','ai',{elapsedTicks:1}));
    assert.strictEqual(result.success,true,JSON.stringify(result.errors));
    const records=(result.payload.worldAdvance as import('../src/world/ContinuousWorldEngine').WorldAdvanceResult).commitmentResolutions.filter(r=>r.commitmentId===id);
    assert.strictEqual(records.length,1);assert.strictEqual(records[0]!.success,true);
    assert.strictEqual(resumed.getState().operations.get(id)!.terminal!.outcome,'completed');
    const second=resumed.execute(cmdReq('ADVANCE_WORLD','ai',{elapsedTicks:1}));
    assert.ok(!(second.payload.worldAdvance as import('../src/world/ContinuousWorldEngine').WorldAdvanceResult).commitmentResolutions.some(r=>r.commitmentId===id));
  });

}
