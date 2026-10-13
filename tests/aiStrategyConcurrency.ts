import { primeSourceDecision } from './aiPressureFixtures';
import { observeSources } from '../src/engine/strategicPressure';
import { opportunity, selectWaitInitiation } from '../src/engine/proactiveCognition';
import { makeCommitmentId } from '../src/engine/DecisionEngine';
import assert from 'assert';
import { AICommitment, Territory, WarlordSnapshot } from '../src/types';
import { GameState, GAME_STATE_SCHEMA_VERSION } from '../src/types/GameState';
import { AIConcretePlan, AttackPlan, BuildPlan } from '../src/types/AIConcretePlan';
import { makeOperationTestWorld } from './aiOperationFixtures';
import { generateConcretePlans, assessConcretePlanFeasibility } from '../src/engine/concretePlans';
import { toDecisionEngineSnapshot } from '../src/state/gameStateAdapters';
import { activeOperations, settleOperation, createOperationMap, operationFromSelection } from '../src/engine/operations';
import { attentionCost, occupiedAttention, assessAttention } from '../src/engine/strategicAttention';
import { assessStrategicCompatibility, StrategicCompatibilityRule } from '../src/engine/strategicCompatibility';
import { decisionOpportunityRejection } from '../src/engine/decisionOpportunities';
import { STRATEGIC_ATTENTION_TUNING as tuning } from '../src/constants/strategicAttention';
import { cloneGameState } from '../src/state/cloneGameState';
import { checkGameStateInvariants } from '../src/state/gameStateInvariants';
import { Orchestrator, CommandRequest, createDefaultRegistry } from '../src/orchestration';
import { BattleEngine } from '../src/battle/BattleEngine';
import { hydratePersistedPayload } from '../src/persistence/hydrate';
import { encodePersistable } from '../src/persistence/serialization';
import { progressAllConstructions } from '../src/gameplay/construction/progress';
import { invalidateStaleAttackIntents } from '../src/army/strategicAttack';
import { settleTerritoryOwnershipChange } from '../src/gameplay/economy/ownership';
import { InMemoryGameStateStore } from '../src/persistence/inMemoryGameStateStore';
import { serializePublicGameState } from '../src/orchestration/publicView';
import { isCommandExposed } from '../src/server/allowlist';

interface Api {
  test(name: string, run: () => void): void;
  makeSelf(id: string, overrides?: Partial<WarlordSnapshot>): WarlordSnapshot;
  makeTerritory(overrides: Partial<Territory> & { id: string }): Territory;
  makeCmt(partial: Partial<AICommitment> & Pick<AICommitment, 'warlordId' | 'action'>): AICommitment;
  cmdReq(commandId: string, playerId: string, parameters?: Record<string, unknown>): CommandRequest;
}
export function registerAiStrategyConcurrencyTests({test,makeSelf,makeTerritory,makeCmt,cmdReq}:Api):void {
  const world=(ids=['a','b'])=>{
    const s=makeOperationTestWorld(makeSelf,makeTerritory,ids);
    s.territories.get('home')!.resourceOutput={food:5};s.factions.get('me')!.resources.food=0;
    return s;
  };
  function historicalTerminal(s:GameState):string {
    const f=s.factions.get('me')!,seq=f.nextAiCommitmentSequence++;
    const id=makeCommitmentId(s.worldSeed,'me',s.turn,seq,'WAIT',null);
    const op=operationFromSelection({...makeCmt({warlordId:'me',action:'WAIT'}),id,
      plan:generateConcretePlans(toDecisionEngineSnapshot(s),'me').find(p=>p.action==='WAIT')!},s.worldTick);
    s.operations.set(id,op);settleOperation(s,id,'completed','historical fixture');return id;
  }
  const plans=(s:GameState)=>generateConcretePlans(toDecisionEngineSnapshot(s),'me');
  const move=(s:GameState,id='a')=>plans(s).find(p=>p.action==='MOVE'&&p.armyId===id&&p.destinationTerritoryId==='other')!;
  const attack=(s:GameState,id='b')=>plans(s).find((p):p is AttackPlan=>p.action==='ATTACK'&&p.armyId===id&&p.stagingTerritoryId==='stage')!;
  const build=(s:GameState,site='home')=>plans(s).find((p):p is BuildPlan=>p.action==='BUILD'&&p.territoryId===site&&p.projectType==='FARM')!;
  const wait=(s:GameState)=>plans(s).find(p=>p.action==='WAIT')!;
  function start(o:Orchestrator,plan:AIConcretePlan):string {
    assert.ok(plan);const r=o.execute(cmdReq('START_AI_OPERATION','ai',{plan}));
    assert.strictEqual(r.success,true,JSON.stringify(r.errors));return r.payload.operationId as string;
  }
  const selected=(r:ReturnType<Orchestrator['execute']>)=>r.payload.selectedOperationIds as string[];
  function quiet(s:GameState):GameState {
    const copy=cloneGameState(s);for(const fid of copy.allFactionIds)copy.lastAiDecisionTick.set(fid,copy.worldTick+10000);return copy;
  }
  function advance(o:Orchestrator,ticks:number):void {
    const r=o.execute(cmdReq('ADVANCE_WORLD','ai',{elapsedTicks:ticks}));assert.strictEqual(r.success,true,JSON.stringify(r.errors));
  }
  test('Phase D: initial tunable costs express qualitative classes without physical modifiers',()=>{
    assert.ok(Number.isSafeInteger(tuning.capacity)&&tuning.capacity>0);
    assert.ok(tuning.costs.ATTACK>tuning.costs.MOVE&&tuning.costs.MOVE>tuning.costs.BUILD);
    assert.strictEqual(tuning.costs.RETREAT,tuning.costs.MOVE);assert.strictEqual(tuning.costs.WAIT,0);
    assert.ok(tuning.costs.OFFER_PEACE<tuning.costs.MOVE&&tuning.costs.TRADE<tuning.costs.MOVE);
    assert.ok(tuning.capacity>=tuning.costs.ATTACK+tuning.costs.MOVE);
  });
  test('Phase D review: immutable terminal validation is reused without hiding contextual corruption',()=>{
    const s=world(),id=historicalTerminal(s),o=new Orchestrator(s),valid=o.getState();
    assert.deepStrictEqual(checkGameStateInvariants(valid),[]);
    const planModule=require('../src/types/AIConcretePlan') as typeof import('../src/types/AIConcretePlan');
    const inspect=planModule.concretePlanProblem;let inspected=0;
    planModule.concretePlanProblem=(p:unknown)=>{inspected++;return inspect(p);};
    try { assert.deepStrictEqual(checkGameStateInvariants(cloneGameState(valid)),[]);assert.strictEqual(inspected,0,'unchanged immutable history must not be structurally revalidated'); }
    finally { planModule.concretePlanProblem=inspect; }
    const wrongKey=cloneGameState(valid),op=wrongKey.operations.get(id)!;
    wrongKey.operations.delete(id);wrongKey.operations.set('wrong-key',op);
    assert.ok(checkGameStateInvariants(wrongKey).some(v=>v.code==='operation.id_mismatch'));
    const missingFaction=cloneGameState(valid);missingFaction.factions.delete('me');
    assert.ok(checkGameStateInvariants(missingFaction).some(v=>v.code==='operation.unknown_faction'));
    const resetSequence=cloneGameState(valid);resetSequence.factions.get('me')!.nextAiCommitmentSequence=0;
    assert.ok(checkGameStateInvariants(resetSequence).some(v=>v.code==='faction.invalid_ai_commitment_sequence'));
    const replacement=cloneGameState(valid);replacement.operations.set(id,{...op,attention:{...op.attention,cost:-1}});
    assert.ok(checkGameStateInvariants(replacement).some(v=>v.code==='attention.invalid_owner_cost'));
  });
  test('Phase D review: cached terminal validation cannot hide a backwards world boundary',()=>{
    const s=world();s.worldTick=4;const id=historicalTerminal(s),o=new Orchestrator(s);
    assert.deepStrictEqual(checkGameStateInvariants(o.getState()),[]);
    const backwards=cloneGameState(o.getState());backwards.worldTick=0;
    assert.ok(checkGameStateInvariants(backwards).some(v=>v.code==='operation.invalid_terminal_boundary'));
    assert.strictEqual(backwards.operations.get(id)!.terminal!.atTick,4);
  });
  test('Phase D review: settlement isolates a manually supplied mutable plan before caching history',()=>{
    const s=world();primeSourceDecision(s,'me');const o=new Orchestrator(s),id=selected(o.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'})))[0]!,d=cloneGameState(o.getState());
    const op=d.operations.get(id)!,external=JSON.parse(JSON.stringify(op.plan)) as AIConcretePlan;
    op.plan=external;assert.strictEqual(settleOperation(d,id,'failed','unstarted selection'),true);
    assert.deepStrictEqual(checkGameStateInvariants(d),[]);
    (external as unknown as {factionId:string}).factionId='enemy';
    assert.strictEqual(d.operations.get(id)!.plan!.factionId,'me');
    assert.deepStrictEqual(checkGameStateInvariants(d),[]);
  });
  test('Phase D review: ATTACK plus BUILD and independent construction retain independent settlement',()=>{
    const s=world(),o=new Orchestrator(s),attackId=start(o,attack(s)),first=start(o,build(o.getState(),'home'));
    const secondPlan=build(o.getState(),'other'),second=start(o,secondPlan);
    assert.strictEqual(activeOperations(o.getState(),'me').length,3);
    assert.strictEqual(occupiedAttention(o.getState(),'me'),tuning.costs.ATTACK+2*tuning.costs.BUILD);
    const d=cloneGameState(o.getState());d.constructions.delete(d.operations.get(first)!.links.constructionId!);
    assert.strictEqual(settleOperation(d,first,'failed','review destruction'),true);
    assert.strictEqual(settleOperation(d,first,'failed','duplicate'),false);
    assert.strictEqual(d.operations.get(attackId)!.phase,'physical');assert.strictEqual(d.operations.get(second)!.phase,'physical');
    assert.strictEqual(occupiedAttention(d,'me'),tuning.costs.ATTACK+tuning.costs.BUILD);
    assert.deepStrictEqual(checkGameStateInvariants(d),[]);
  });
  test('Phase D review: public state and HTTP commands do not expose private strategic accounting',()=>{
    const s=world(),o=new Orchestrator(s);start(o,move(s));
    const publicJson=JSON.stringify(serializePublicGameState(o.getState(),'spectator'));
    for(const field of ['strategicAttention','attention','aiDecisionOpportunities','primaryOperationId','factorBreakdown','memory','goals'])
      assert.ok(!publicJson.includes(`"${field}"`),field);
    for(const command of ['AI_DECIDE','START_AI_OPERATION','RESOLVE_COMMITMENT'])assert.strictEqual(isCommandExposed(command),false);
  });
  for(const pair of ['MOVE/MOVE','MOVE/ATTACK','BUILD/MOVE'] as const)test(`Phase D: compatible ${pair} acquires independent claims and Attention`,()=>{
    const s=world(),o=new Orchestrator(s),left=pair==='BUILD/MOVE'?build(s):move(s);
    const right=pair==='MOVE/ATTACK'?attack(s):move(s,'b');const ids=[start(o,left),start(o,right)];
    assert.strictEqual(activeOperations(o.getState(),'me').length,2);
    assert.strictEqual(occupiedAttention(o.getState(),'me'),attentionCost(left)+attentionCost(right));
    for(const id of ids){const op=o.getState().operations.get(id)!;assert.strictEqual(op.attention.factionId,'me');assert.strictEqual(op.attention.releasedAtTick,null);assert.deepStrictEqual(op.plan,id===ids[0]?left:right);}
    assert.deepStrictEqual(checkGameStateInvariants(o.getState()),[]);
  });
  test('Phase D: Attention capacity blocks an otherwise legal unclaimed force',()=>{
    const n=Math.floor(tuning.capacity/tuning.costs.MOVE),ids=Array.from({length:n+1},(_,i)=>`army_${i}`),s=world(ids),all=ids.map(id=>move(s,id)),o=new Orchestrator(s);
    for(const p of all.slice(0,n))start(o,p);
    const before=encodePersistable(o.getState()),candidate=all[n]!;
    const assessment=assessConcretePlanFeasibility(candidate,toDecisionEngineSnapshot(o.getState()));
    assert.deepStrictEqual(assessment.rejections.map(r=>r.kind),['ATTENTION']);
    assert.strictEqual(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:candidate})).success,false);
    assert.deepStrictEqual(encodePersistable(o.getState()),before);assert.ok(!o.getState().operationClaims.has(`force:${ids[n]}`));
    assert.ok(!plans(o.getState()).some(p=>p.id===candidate.id));
  });
  test('Phase D/E: saturated Attention preserves zero WAIT cost but cannot fabricate an actionable source',()=>{
    const s=world(),w=wait(s);s.strategicAttention.capacity=attentionCost(move(s));const o=new Orchestrator(s);start(o,move(s));
    const before={...o.getState().factions.get('me')!.resources},occupied=occupiedAttention(o.getState(),'me');
    assert.strictEqual(assessAttention(o.getState(),w).available,true);
    o.getState().factions.get('me')!.resources.gold=0;
    o.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'}));
    assert.strictEqual(o.getState().operations.size,1);
    assert.strictEqual(opportunity(o.getState(),'me').primary,null);
    assert.strictEqual(occupiedAttention(o.getState(),'me'),occupied);
    assert.strictEqual(o.getState().factions.get('me')!.resources.food,before.food);
  });
  test('Phase D: claim, compatibility and Attention rejection diagnostics stay distinct',()=>{
    const s=world(),m=move(s),a=attack(s),o=new Orchestrator(s);start(o,m);
    assert.ok(assessConcretePlanFeasibility(m,toDecisionEngineSnapshot(o.getState())).rejections.some(r=>r.kind==='CLAIM'));
    const low=cloneGameState(s);low.strategicAttention.capacity=0;
    assert.deepStrictEqual(assessConcretePlanFeasibility(m,toDecisionEngineSnapshot(low)).rejections.map(r=>r.kind),['ATTENTION']);
    // Isolated future-authoritative-relationship rule fixture. It creates no
    // proposal/ceasefire/clearance state and is never enabled in production.
    s.factions.get('me')!.diplomacy.set('enemy',{target:'enemy',state:'allied',opinion:0,treaties:[],yearsAtPeace:0,yearsAtWar:0});
    const rule:StrategicCompatibilityRule={id:'unit_relationship_context',reject(plan,{state}){
      return plan.action==='ATTACK'&&state.factions.get(plan.factionId)!.diplomacy.get(state.territories.get(plan.targetTerritoryId)!.owner!)?.state==='allied'?'future hostile-initiation restriction fixture':null;
    }};
    assert.deepStrictEqual(assessConcretePlanFeasibility(a,toDecisionEngineSnapshot(s),undefined,[rule]).rejections.map(r=>r.kind),['COMPATIBILITY']);
    assert.strictEqual(assessStrategicCompatibility(a,s).compatible,true,'no speculative production relationship policy');
    assert.strictEqual(assessStrategicCompatibility(m,s,[rule]).compatible,true);
  });
  test('Phase D: compatibility rule ordering is stable and inspects relevant live operations',()=>{
    const s=world(),o=new Orchestrator(s);start(o,move(s));const a=attack(s),seen:string[][]=[];
    const rules=['z','a'].map(id=>({id,reject(_plan:AIConcretePlan,ctx:Parameters<StrategicCompatibilityRule['reject']>[1]){seen.push(ctx.activeOperations.map(op=>op.id));return id;}}));
    assert.deepStrictEqual(assessStrategicCompatibility(a,o.getState(),rules),assessStrategicCompatibility(a,o.getState(),[...rules].reverse()));
    assert.ok(seen.every(ids=>ids.length===1));
  });
  test('Phase D: movement completion releases only its Attention exactly once',()=>{
    const s=world(),o=new Orchestrator(s),id=start(o,move(s)),other=start(o,build(s));const d=quiet(o.getState()),runner=new Orchestrator(d);
    advance(runner,d.armies.get('a')!.movement!.durationTicks);const done=cloneGameState(runner.getState());
    assert.strictEqual(done.operations.get(id)!.attention.releasedAtTick,done.worldTick);
    assert.strictEqual(occupiedAttention(done,'me'),done.operations.get(other)!.attention.cost);
    const before=encodePersistable(done);assert.strictEqual(settleOperation(done,id,'completed','replay'),false);assert.deepStrictEqual(encodePersistable(done),before);
  });
  test('Phase D: failure releases Attention once without releasing another owner',()=>{
    const s=world(),o=new Orchestrator(s),id=start(o,move(s)),other=start(o,move(s,'b')),d=cloneGameState(o.getState());
    d.armies.delete('a');d.factions.get('me')!.armies=d.factions.get('me')!.armies.filter(id=>id!=='a');
    assert.strictEqual(settleOperation(d,id,'failed','force destroyed'),true);
    assert.strictEqual(occupiedAttention(d,'me'),d.operations.get(other)!.attention.cost);
    const before=encodePersistable(d);assert.strictEqual(settleOperation(d,id,'failed','duplicate'),false);assert.deepStrictEqual(encodePersistable(d),before);
  });
  test('Phase D: invalid attack retains Attention until existing physical arrival',()=>{
    const s=world(),o=new Orchestrator(s),id=start(o,attack(s)),d=quiet(o.getState()),cost=occupiedAttention(d,'me');
    settleTerritoryOwnershipChange(d,'target','me','enemy');
    d.territories.get('target')!.owner='me';d.factions.get('enemy')!.territories=[];d.factions.get('me')!.territories.push('target');
    invalidateStaleAttackIntents(d);settleOperation(d,id,'failed','objective invalidated');
    assert.strictEqual(d.operations.get(id)!.phase,'recovery');assert.strictEqual(occupiedAttention(d,'me'),cost);
    const runner=new Orchestrator(d);advance(runner,d.armies.get('b')!.movement!.durationTicks);
    assert.strictEqual(runner.getState().operations.get(id)!.terminal!.outcome,'failed');assert.strictEqual(occupiedAttention(runner.getState(),'me'),0);
  });
  test('Phase D: BUILD releases Attention at project completion, not project start',()=>{
    const s=world(),o=new Orchestrator(s),id=start(o,build(s)),d=cloneGameState(o.getState()),project=d.constructions.get(d.operations.get(id)!.links.constructionId!)!;
    assert.strictEqual(occupiedAttention(d,'me'),attentionCost(build(s)));
    d.worldTick=project.startedAtTick+project.remainingTicks;d.accruedTargetWorldTick=d.worldTick;progressAllConstructions(d);
    assert.strictEqual(occupiedAttention(d,'me'),0);assert.strictEqual(d.operations.get(id)!.attention.releasedAtTick,d.worldTick);
  });
  test('Phase D: domain failure after acquisition rolls back Attention, claims, sequence and world',()=>{
    const s=world();s.armies.get('b')!.location='stage';const p=attack(s);
    class FailingBattle extends BattleEngine {override resolve():never{throw new Error('forced failure after acquisition');}}
    const registry=createDefaultRegistry();registry.registerBattle(new FailingBattle());const o=new Orchestrator(s,registry),before=encodePersistable(o.getState());
    assert.strictEqual(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:p})).success,false);
    assert.deepStrictEqual(encodePersistable(o.getState()),before);assert.strictEqual(occupiedAttention(o.getState(),'me'),0);
  });
  test('Phase D: schema 19 over-cap operations all survive with deterministic historical charges',()=>{
    const n=Math.floor(tuning.capacity/tuning.costs.MOVE)+2,ids=Array.from({length:n},(_,i)=>`legacy_${i}`),s=world([...ids,'spare']);
    s.strategicAttention.capacity=n*tuning.costs.MOVE;const all=ids.map(id=>move(s,id)),o=new Orchestrator(s);const operationIds=all.map(p=>start(o,p));
    const old:Record<string,unknown>={...cloneGameState(o.getState()),schemaVersion:19};delete old.strategicAttention;delete old.aiDecisionOpportunities;
    for(const op of (old.operations as GameState['operations']).values())delete (op as unknown as Record<string,unknown>).attention;
    const loaded=hydratePersistedPayload(encodePersistable(old));assert.strictEqual(loaded.schemaVersion,GAME_STATE_SCHEMA_VERSION);
    assert.strictEqual(loaded.operations.size,n);assert.strictEqual(occupiedAttention(loaded,'me'),n*tuning.costs.MOVE);
    for(const id of operationIds){assert.strictEqual(loaded.operations.get(id)!.attention.grandfathered,true);assert.deepStrictEqual(loaded.operations.get(id)!.plan,o.getState().operations.get(id)!.plan);}
    assert.deepStrictEqual(loaded.armies,o.getState().armies);assert.deepStrictEqual(loaded.operationClaims,o.getState().operationClaims);
    const fresh=move(s,'spare');assert.deepStrictEqual(assessConcretePlanFeasibility(fresh,toDecisionEngineSnapshot(loaded)).rejections.map(r=>r.kind),['ATTENTION']);
    assert.deepStrictEqual(checkGameStateInvariants(loaded),[]);
  });
  test('Phase D: save/reload preserves charges, capacity, opportunity and independent cloned state',()=>{
    const s=world(),o=new Orchestrator(s);start(o,move(s));primeSourceDecision(o.getState(),'me');const r=o.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'}));assert.strictEqual(selected(r).length,1);
    const original=o.getState(),loaded=hydratePersistedPayload(encodePersistable(original));assert.deepStrictEqual(encodePersistable(loaded),encodePersistable(original));
    const copied=cloneGameState(loaded);copied.strategicAttention.capacity++;copied.operations.get(activeOperations(copied)[0]!.id)!.attention.cost++;
    copied.aiDecisionOpportunities.get('me')!.lastBoundaryTick=null;
    assert.deepStrictEqual(encodePersistable(loaded),encodePersistable(original));
  });
  test('Phase D/E: empty source cannot recursively fabricate WAIT, including after reload',()=>{
    const s=world([]);s.factions.get('me')!.resources={gold:0,food:0,iron:0,wood:0,stone:0};const o=new Orchestrator(s),resources={...s.factions.get('me')!.resources};
    assert.deepStrictEqual(selected(o.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'}))),[]);
    const runner=new Orchestrator(hydratePersistedPayload(encodePersistable(o.getState())));
    for(let i=0;i<10;i++)assert.deepStrictEqual(selected(runner.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'}))),[]);
    assert.strictEqual(runner.getState().worldTick,0);assert.strictEqual(runner.getState().operations.size,0);assert.strictEqual(occupiedAttention(runner.getState(),'me'),0);
    assert.deepStrictEqual(runner.getState().factions.get('me')!.resources,resources);
  });
  test('Phase D: pending selection occupies the sole primary thread, not faction physical work',()=>{
    const s=world(),o=new Orchestrator(s),held=start(o,move(s));primeSourceDecision(o.getState(),'me');const first=o.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'})),id=selected(first)[0]!;
    assert.strictEqual(decisionOpportunityRejection(o.getState(),'me'),'PRIMARY_BUSY');
    const before=o.getState().operations.size;assert.deepStrictEqual(selected(o.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'}))),[]);assert.strictEqual(o.getState().operations.size,before);
    assert.strictEqual(o.execute(cmdReq('RESOLVE_COMMITMENT','ai',{factionId:'me',operationId:id})).success,true);
    assert.strictEqual(o.getState().aiDecisionOpportunities.get('me')!.primaryOperationId,null);assert.strictEqual(o.getState().operations.get(held)!.phase,'physical');
  });
  test('Phase D: another decision can initiate before an existing long march completes',()=>{
    const s=world(),o=new Orchestrator(s),held=start(o,move(s));const d=cloneGameState(o.getState());d.armies.get('a')!.movement!.durationTicks=20;
    const runner=new Orchestrator(d);advance(runner,12);
    assert.strictEqual(runner.getState().operations.get(held)!.phase,'physical');assert.ok(runner.getState().operations.size>1);
    assert.ok(runner.getState().aiDecisionOpportunities.has('me'));assert.deepStrictEqual(checkGameStateInvariants(runner.getState()),[]);
  });
  test('Phase D: physical completion does not restart proactive reconsideration spacing',()=>{
    const s=world(),o=new Orchestrator(s),id=start(o,move(s)),d=quiet(o.getState()),stamp=d.lastAiDecisionTick.get('me');const runner=new Orchestrator(d);
    advance(runner,d.armies.get('a')!.movement!.durationTicks);assert.strictEqual(runner.getState().operations.get(id)!.phase,'terminal');assert.strictEqual(runner.getState().lastAiDecisionTick.get('me'),stamp);
  });
  test('Phase D: identical seed/opportunity and reversed map order yield identical selection and start',()=>{
    const s=world();primeSourceDecision(s,'me');const reversed=cloneGameState(s);reversed.armies=new Map([...reversed.armies].reverse());reversed.territories=new Map([...reversed.territories].reverse());
    assert.deepStrictEqual(plans(s),plans(reversed));const a=new Orchestrator(s),b=new Orchestrator(hydratePersistedPayload(encodePersistable(reversed)));
    const ar=a.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'})),br=b.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'}));assert.deepStrictEqual(selected(ar),selected(br));
    for(const runner of[a,b])assert.strictEqual(runner.execute(cmdReq('RESOLVE_COMMITMENT','ai',{factionId:'me',operationId:selected(ar)[0]})).success,true);
    assert.deepStrictEqual([...a.getState().operations],[...b.getState().operations]);assert.deepStrictEqual(a.getState().operationClaims,b.getState().operationClaims);assert.strictEqual(occupiedAttention(a.getState(),'me'),occupiedAttention(b.getState(),'me'));
  });
  test('Phase D: active Attention query never scans retained terminal history',()=>{
    const s=world(),o=new Orchestrator(s);const id=start(o,move(s)),d=cloneGameState(o.getState()),live=d.operations.get(id)!;
    const terminal={...live,phase:'terminal' as const,status:'completed' as const,claimIds:[],links:{},terminal:{outcome:'completed' as const,reason:'fixture',atTick:0},attention:{...live.attention,releasedAtTick:0}};
    d.operations=createOperationMap([...Array.from({length:5000},(_,i)=>[`historical_${i}`,{...terminal,id:`historical_${i}`}] as const),[id,live]]);
    Object.defineProperty(d.operations,'values',{value(){throw new Error('terminal history scan');}});
    assert.strictEqual(occupiedAttention(d,'me'),attentionCost(live.plan!));assert.strictEqual(assessAttention(d,wait(s)).available,true);assert.strictEqual(assessStrategicCompatibility(attack(s),d).compatible,true);
  });
  test('Phase D: competing CAS decisions cannot both acquire the same primary opportunity',()=>{
    const store=new InMemoryGameStateStore(),s=world();primeSourceDecision(s,'me');assert.strictEqual(store.save('race',s,0).ok,true);
    const first=store.load('race'),second=store.load('race');assert.ok(first.ok&&second.ok);
    const a=new Orchestrator(first.state),b=new Orchestrator(second.state);
    const ar=a.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'})),br=b.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'}));
    assert.deepStrictEqual(selected(ar),selected(br));assert.strictEqual(store.save('race',a.getState(),first.record.stateVersion).ok,true);
    const rejected=store.save('race',b.getState(),second.record.stateVersion);assert.strictEqual(rejected.ok,false);
    const committed=store.load('race');assert.ok(committed.ok);assert.strictEqual(committed.state.operations.size,1);
    const retry=new Orchestrator(committed.state);assert.deepStrictEqual(selected(retry.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'}))),[]);
    assert.strictEqual(retry.getState().factions.get('me')!.nextAiCommitmentSequence,a.getState().factions.get('me')!.nextAiCommitmentSequence);
  });
  test('Phase D: historical over-cap occupancy blocks new work until enough owned charges release',()=>{
    const s=world(['a','b','c']);s.strategicAttention.capacity=tuning.capacity+tuning.costs.MOVE;
    const all=['a','b'].map(id=>move(s,id)),o=new Orchestrator(s);const ids=all.map(p=>start(o,p));
    const d=cloneGameState(o.getState());d.strategicAttention.capacity=tuning.costs.MOVE;
    for(const id of ids)d.operations.get(id)!.attention.grandfathered=true;
    const spare=move(s,'c');assert.strictEqual(assessAttention(d,spare).available,false);
    for(const id of ids){const armyId=d.operations.get(id)!.links.armyId!;d.armies.delete(armyId);d.factions.get('me')!.armies=d.factions.get('me')!.armies.filter(a=>a!==armyId);settleOperation(d,id,'failed','physical force lost');}
    assert.strictEqual(assessAttention(d,spare).available,true);assert.deepStrictEqual(checkGameStateInvariants(d),[]);
  });
  test('Phase D: blocked travel retains Attention through ticks and reload',()=>{
    const s=world(),o=new Orchestrator(s),id=start(o,move(s)),d=quiet(o.getState()),cost=occupiedAttention(d,'me');
    d.armies.get('a')!.movement!.durationTicks=10;d.territories.get('home')!.neighboring=d.territories.get('home')!.neighboring.filter(t=>t!=='other');d.territories.get('other')!.neighboring=d.territories.get('other')!.neighboring.filter(t=>t!=='home');
    const runner=new Orchestrator(d);advance(runner,2);assert.strictEqual(runner.getState().armies.get('a')!.movement!.status,'blocked');
    const reloaded=new Orchestrator(hydratePersistedPayload(encodePersistable(runner.getState())));advance(reloaded,5);
    assert.strictEqual(occupiedAttention(reloaded.getState(),'me'),cost);assert.strictEqual(reloaded.getState().operations.get(id)!.attention.releasedAtTick,null);
  });
  test('Phase D: immediate ATTACK releases its charge at the exact same terminal boundary',()=>{
    const s=world();s.armies.get('b')!.location='stage';const o=new Orchestrator(s),id=start(o,attack(s)),op=o.getState().operations.get(id)!;
    assert.strictEqual(op.phase,'terminal');assert.strictEqual(op.attention.acquiredAtTick,0);assert.strictEqual(op.attention.releasedAtTick,0);assert.strictEqual(occupiedAttention(o.getState(),'me'),0);
  });
  test('Phase D: coarse/fine progression and reload preserve opportunity and Attention state',()=>{
    const s=world(),a=new Orchestrator(s),b=new Orchestrator(hydratePersistedPayload(encodePersistable(s)));
    advance(a,4);for(let tick=0;tick<4;tick++)advance(b,1);
    // Map insertion order is not semantic world state. Compare complete maps,
    // not the serializer's entry-array representation of insertion order.
    assert.deepStrictEqual(a.getState(),b.getState());
    assert.deepStrictEqual(a.getState().aiDecisionOpportunities,b.getState().aiDecisionOpportunities);
  });
  test('Phase D: invalid selected initiation closes only its primary thread without charging Attention',()=>{
    const s=world();primeSourceDecision(s,'me');const o=new Orchestrator(s),id=selected(o.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'})))[0]!,d=cloneGameState(o.getState());
    const op=d.operations.get(id)!;assert.strictEqual(op.phase,'selected');assert.strictEqual(occupiedAttention(d,'me'),0);
    if(op.plan!.action==='BUILD')d.factions.get('me')!.resources={gold:0,food:0,iron:0,wood:0,stone:0};
    else if('armyId' in op.plan!){const armyId=op.plan!.armyId;d.armies.delete(armyId);d.factions.get('me')!.armies=d.factions.get('me')!.armies.filter(a=>a!==armyId);}
    else throw new Error('Fixture needs a non-WAIT physical selection');
    const runner=new Orchestrator(d),r=runner.execute(cmdReq('RESOLVE_COMMITMENT','ai',{factionId:'me',operationId:id}));
    assert.strictEqual(r.success,false);assert.strictEqual(runner.getState().aiDecisionOpportunities.get('me')!.primaryOperationId,null);
    assert.strictEqual(occupiedAttention(runner.getState(),'me'),0);assert.strictEqual(runner.getState().operationClaims.size,0);
  });
  test('Phase D/E: full ordinary Attention preserves cheap observation without selecting WAIT-only sources',()=>{
    const s=world(),p=move(s);s.strategicAttention.capacity=attentionCost(p);const o=new Orchestrator(s);start(o,p);
    assert.deepStrictEqual(selected(o.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'}))),[]);
    assert.ok(o.getState().aiPressure.size>0);assert.ok([...o.getState().aiPressure.values()].every(s=>s.blocked));
    assert.strictEqual(o.getState().operations.size,1);assert.strictEqual(occupiedAttention(o.getState(),'me'),attentionCost(p));
  });
  test('Phase D/E: migration archives contextless pending selection without inventing source/timing',()=>{
    const s=world();primeSourceDecision(s,'me');const o=new Orchestrator(s),id=selected(o.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'})))[0]!;
    const old:Record<string,unknown>={...cloneGameState(o.getState()),schemaVersion:19};delete old.strategicAttention;delete old.aiDecisionOpportunities;
    for(const op of (old.operations as GameState['operations']).values())delete (op as unknown as Record<string,unknown>).attention;
    const loaded=hydratePersistedPayload(encodePersistable(old));assert.strictEqual(loaded.aiDecisionOpportunities.get('me')!.primaryOperationId,null);assert.strictEqual(loaded.operations.get(id)!.phase,'terminal');assert.strictEqual(occupiedAttention(loaded,'me'),0);assert.strictEqual(loaded.factions.get('me')!.lastActions.length,o.getState().factions.get('me')!.lastActions.length);
  });
  test('Phase D: schema 20 rejects missing accounting instead of remigrating active costs',()=>{
    const s=world(),o=new Orchestrator(s);start(o,move(s));const broken=cloneGameState(o.getState());
    delete (broken as unknown as Record<string,unknown>).strategicAttention;assert.throws(()=>hydratePersistedPayload(encodePersistable(broken)));
  });
  for(const corruption of ['capacity','cost','owner','terminal','primary','boundary'] as const)test(`Phase D: invariants reject corrupt ${corruption} accounting`,()=>{
    const s=world(),o=new Orchestrator(s),id=start(o,move(s)),d=cloneGameState(o.getState()),op=d.operations.get(id)!;
    if(corruption==='capacity')d.strategicAttention.capacity=-1;
    if(corruption==='cost')op.attention.cost=-1;
    if(corruption==='owner')op.attention.factionId='enemy';
    if(corruption==='terminal'){op.phase='terminal';op.status='completed';op.terminal={outcome:'completed',reason:'corrupt',atTick:0};}
    if(corruption==='primary')d.aiDecisionOpportunities.set('enemy',{lastBoundaryTick:0,primaryOperationId:id});
    if(corruption==='boundary')d.aiDecisionOpportunities.set('me',{lastBoundaryTick:1,primaryOperationId:null});
    assert.ok(checkGameStateInvariants(d).some(v=>v.code.startsWith('attention.')||v.code.startsWith('opportunity.')));
  });
}
