import assert from 'assert';
import { request } from 'node:http';
import type { GameState } from '../src/types/GameState';
import type { AIResponseContext } from '../src/types/AIResponse';
import { MUTATING_HANDLERS, type HandlerContext } from '../src/orchestration/handlers';
import type { PlanDraft } from '../src/types/AIConcretePlan';
import { makeConcretePlan } from '../src/types/AIConcretePlan';
import { acquirePrimaryResponse, releasePrimaryResponse, transferPrimaryResponse, closeResponseContext } from '../src/engine/responseRecords';
import { processNonProactiveBoundary, reactivePlans, registerRequiredResponse } from '../src/engine/nonProactiveCognition';
import { accrueProactiveClocks, startProactiveTimer, timerRemaining, opportunity } from '../src/engine/proactiveCognition';
import { occupiedAttention } from '../src/engine/strategicAttention';
import { settleOperation } from '../src/engine/operations';
import { initializeRecruitment, recruitmentPoolId } from '../src/gameplay/recruitment/recruitment';
import { liveTradeProposals } from '../src/gameplay/trade/trade';
import { cloneGameState } from '../src/state/cloneGameState';
import { responseStateProblems } from '../src/state/responseInvariants';
import { checkGameStateInvariants } from '../src/state/gameStateInvariants';
import { encodePersistable } from '../src/persistence/serialization';
import { InMemoryGameStateStore } from '../src/persistence/inMemoryGameStateStore';
import { InMemoryWorkoutHistoryStore } from '../src/fitness/history/inMemoryStore';
import { Orchestrator } from '../src/orchestration';
import { runStateTransaction } from '../src/orchestration/transaction';
import { startResponseIntervention } from '../src/orchestration/handlers';
import { ErrorCode, OrchestrationError } from '../src/orchestration/errors';
import { mergeEventStepOntoGameState } from '../src/orchestration/applyEvents';
import { ConsequenceApplier } from '../src/events/WorldSimulator';
import { accrueWorldThroughReceipt } from '../src/world/worldAccrual';
import { openGameplaySessionLease, renewGameplaySessionLeaseAtSequence, endGameplaySessionLease } from '../src/world/presenceLeases';
import { createSessionHost, CommandSessionHost } from '../src/server/session';
import { PlayerWorldPersistence } from '../src/server/persistencePort';
import { createCommandHttpServer } from '../src/server/http';

type Api=Pick<Parameters<typeof import('./aiTrade').registerAiTradeTests>[0],'test'|'makeSelf'|'makeTerritory'|'cmdReq'>;
interface Fixtures {
  world:()=>GameState; reload:(s:GameState)=>GameState; online:(s:GameState,end?:number)=>void;
  context:(s:GameState)=>HandlerContext; advance:(s:GameState,at:number)=>unknown; observe:(s:GameState)=>void;
  threat:(s?:GameState,remaining?:number)=>GameState; emergency:(s:GameState)=>AIResponseContext;
  begin:(s:GameState,p:PlanDraft)=>GameState; move:(s:GameState,armyId?:string)=>GameState;
  pendingTrade:(s?:GameState,fid?:string)=>GameState;
  startCriticalMove:(s:GameState)=>{id:string};
}
export function registerAiResponseCorrectionTests(api:Api,f:Fixtures):void {
  const {test,cmdReq}=api;
  const {world,reload,online,context,advance,observe,threat,emergency,begin,move,pendingTrade,startCriticalMove}=f;
  const owned=(s:GameState)=>s.aiResponses.get(s.aiResponseScheduler.primaryByFaction.get('me')??'')!;
  const coherent=(s:GameState)=>{
    assert.deepStrictEqual(responseStateProblems(s),[]);
    const thinking=[...s.aiResponses.values()].filter(c=>c.factionId==='me'&&c.status==='thinking');
    assert.strictEqual(thinking.length,s.aiResponseScheduler.primaryByFaction.has('me')?1:0);
  };
  const twoEmergencies=()=>{
    const s=threat(world(),3),a=s.armies.get('raider')!;
    for(const faction of s.factions.values())faction.knownTerritories=[...s.territories.keys()];
    s.armies.set('second',{...a,id:'second',location:'target',movement:null,attackIntent:{...a.attackIntent!,status:'ready',onlyArmyId:'second'}});
    s.factions.get('enemy')!.armies.push('second');initializeRecruitment(s);observe(s);online(s);processNonProactiveBoundary(s);
    assert.strictEqual(owned(s).subject.id,'second');assert.deepStrictEqual(checkGameStateInvariants(s),[]);return s;
  };
  const requiredOwner=()=>{
    const s=threat(pendingTrade(),3);initializeRecruitment(s);online(s);
    liveTradeProposals(s)[0]!.responseTimer=startProactiveTimer(s,'me','r2-required-window',8000,8000,10);
    processNonProactiveBoundary(s);
    accrueProactiveClocks(s,s.aiClock.nowMs+emergency(s).timer!.onlineDurationMs,'ONLINE');processNonProactiveBoundary(s);
    assert.strictEqual(owned(s).lane,'REQUIRED_RESPONSE');coherent(s);return s;
  };
  const eventStep=(s:GameState,delta:{garrisonDeltaAbs?:number})=>{
    const applier=new ConsequenceApplier(s.territories,s.factions,s.armies);
    applier.applyDelta({territoryId:'stage',factionId:'me',delta,message:'Authored garrison event'});
    return {mutatedTerritories:applier.territories,mutatedFactions:applier.factions,mutatedArmies:applier.armies,
      perTurnConsequences:[],expiredEvents:[],unresolvedDecisions:[],newActiveEvents:s.activeEvents,newEventHistory:s.eventHistory,triggeredEvents:[],summary:[]};
  };
  test('Phase L R2: exact non-owner escalation preserves another emergency owner',()=>{
    const s=twoEmergencies(),owner=owned(s),id=owner.id;accrueProactiveClocks(s,500,'ONLINE');const progress=encodePersistable(owner.timer);
    s.worldTick=2;observe(s);assert.strictEqual(owned(s).id,id);assert.strictEqual(owner.status,'thinking');assert.deepStrictEqual(encodePersistable(owner.timer),progress);
    processNonProactiveBoundary(s);coherent(s);assert.strictEqual(owned(s).id,id);assert.strictEqual(emergency(s).severity,'CRITICAL');
  });
  test('Phase L R2: escalation while a required response owns cognition transfers coherently',()=>{
    const s=requiredOwner(),id=owned(s).id,p=liveTradeProposals(s)[0]!,timer=encodePersistable(p.responseTimer);
    s.worldTick=2;observe(s);assert.strictEqual(owned(s).id,id);coherent(s);
    processNonProactiveBoundary(s);coherent(s);assert.strictEqual(owned(s).lane,'REACTIVE_EMERGENCY');assert.strictEqual(s.aiResponses.get(id)!.status,'queued');
    assert.deepStrictEqual(encodePersistable(p.responseTimer),timer);
  });
  test('Phase L R2: a non-owner release cannot clear another context identity',()=>{
    const s=twoEmergencies(),id=owned(s).id;assert.strictEqual(releasePrimaryResponse(s,emergency(s)),false);assert.strictEqual(owned(s).id,id);coherent(s);
  });
  test('Phase L R2: acquisition rejects unrelated owner without mutation',()=>{
    const s=twoEmergencies(),before=encodePersistable(s);assert.throws(()=>acquirePrimaryResponse(s,emergency(s)),/already owned/);assert.deepStrictEqual(encodePersistable(s),before);
  });
  test('Phase L R2: acquisition rejects an inconsistent unrelated owner',()=>{
    const s=twoEmergencies();s.aiResponseScheduler.primaryByFaction.set('me','missing');const before=encodePersistable(s);
    assert.throws(()=>acquirePrimaryResponse(s,emergency(s)),/Inconsistent primary/);assert.deepStrictEqual(encodePersistable(s),before);
  });
  test('Phase L R2: invalid transfer leaves the current owner and earned timer untouched',()=>{
    const s=twoEmergencies(),next=emergency(s);next.status='invalidated';next.outcome='CONTEXT_INVALIDATED';s.aiResponses.set(next.id,next);const before=encodePersistable(s);
    assert.throws(()=>transferPrimaryResponse(s,next),/Invalid primary/);assert.deepStrictEqual(encodePersistable(s),before);coherent(s);
  });
  test('Phase L R2: canonical identity rather than wrapper object owns acquisition',()=>{
    const s=twoEmergencies(),c=emergency(s),snapshot=structuredClone(c);transferPrimaryResponse(s,snapshot);
    assert.strictEqual(owned(s),c);assert.strictEqual(snapshot.status,'queued');coherent(s);
  });
  test('Phase L R2: resumable preemption retains earned progress and sample',()=>{
    const s=twoEmergencies(),previous=owned(s);accrueProactiveClocks(s,500,'ONLINE');const timer=encodePersistable(previous.timer),sequence=opportunity(s,'me').nextTimerSequence;
    transferPrimaryResponse(s,emergency(s));coherent(s);assert.strictEqual(previous.status,'queued');assert.deepStrictEqual(encodePersistable(previous.timer),timer);
    accrueProactiveClocks(s,1500,'ONLINE');transferPrimaryResponse(s,previous);coherent(s);
    assert.strictEqual(timerRemaining(s,previous.timer!),previous.timer!.onlineDurationMs-500);assert.strictEqual(opportunity(s,'me').nextTimerSequence,sequence);
  });
  for(const lane of ['emergency','required'] as const)test(`Phase L R2: non-owner cancellation preserves ${lane} owner and timer`,()=>{
    const s=lane==='emergency'?twoEmergencies():requiredOwner(),owner=owned(s),before=encodePersistable(owner);
    closeResponseContext(s,emergency(s),'CONTEXT_INVALIDATED');assert.strictEqual(owned(s).id,owner.id);assert.deepStrictEqual(encodePersistable(owner),before);coherent(s);
  });
  test('Phase L R2: non-owner material revision preserves owner reasoning',()=>{
    const s=twoEmergencies(),owner=owned(s),before=encodePersistable(owner),c=emergency(s);s.armies.get('raider')!.soldiers+=100;observe(s);
    assert.strictEqual(c.revision,1);assert.strictEqual(c.timer,null);assert.deepStrictEqual(encodePersistable(owned(s)),before);coherent(s);
  });
  test('Phase L R2: owner material revision discards stale reasoning before reacquisition',()=>{
    const s=twoEmergencies(),c=owned(s),sequence=opportunity(s,'me').nextTimerSequence??0;
    c.selectedPlan=reactivePlans(s,c)[0]!;s.armies.get('second')!.soldiers+=100;observe(s);
    assert.strictEqual(c.status,'queued');assert.strictEqual(c.timer,null);assert.strictEqual(c.selectedPlan,null);assert.strictEqual(s.aiResponseScheduler.primaryByFaction.size,0);coherent(s);
    processNonProactiveBoundary(s);assert.strictEqual(owned(s).id,c.id);assert.strictEqual(opportunity(s,'me').nextTimerSequence,sequence+1);coherent(s);
  });
  test('Phase L R2: owning urgency escalation resets stale reasoning and reacquires once',()=>{
    const s=threat(world(),3);initializeRecruitment(s);online(s);processNonProactiveBoundary(s);const c=owned(s);accrueProactiveClocks(s,500,'ONLINE');c.selectedPlan=reactivePlans(s,c)[0]!;
    s.worldTick=2;observe(s);assert.strictEqual(c.status,'queued');assert.strictEqual(c.timer,null);assert.strictEqual(c.selectedPlan,null);coherent(s);
    processNonProactiveBoundary(s);assert.strictEqual(owned(s).id,c.id);assert.strictEqual(c.timer!.progress.accruedThroughMs,500);assert.strictEqual(timerRemaining(s,c.timer!),c.timer!.onlineDurationMs);coherent(s);
  });
  test('Phase L R2: deadline-ready required takeover restores exact emergency progress',()=>{
    const s=threat(pendingTrade());online(s);processNonProactiveBoundary(s);const c=owned(s),timer=encodePersistable(c.timer),seq=opportunity(s,'me').nextTimerSequence;
    const p=liveTradeProposals(s)[0]!;p.responseTimer=startProactiveTimer(s,'me','r2-immediate-required',1000,1000,10);
    accrueProactiveClocks(s,s.aiClock.nowMs+1000,'ONLINE');const remaining=timerRemaining(s,c.timer!);processNonProactiveBoundary(s);
    assert.strictEqual(owned(s).id,c.id);assert.strictEqual(timerRemaining(s,c.timer!),remaining);assert.strictEqual(c.timer!.onlineDurationMs,(timer as {onlineDurationMs:number}).onlineDurationMs);assert.strictEqual(opportunity(s,'me').nextTimerSequence,(seq??0)+1);coherent(s);
    assert.notStrictEqual(p.status,'pending');
  });
  test('Phase L R2: replacing a non-owning hostile commitment cannot cancel another owner',()=>{
    const s=twoEmergencies(),id=owned(s).id,old=emergency(s);s.armies.get('raider')!.attackIntent!.conflictFactId='replacement';observe(s);
    assert.strictEqual(old.status,'invalidated');assert.strictEqual(owned(s).id,id);coherent(s);
  });
  test('Phase L R2: replacing the owning hostile commitment leaves one deterministic owner',()=>{
    const s=twoEmergencies(),old=owned(s);s.armies.get('second')!.attackIntent!.conflictFactId='replacement';observe(s);coherent(s);
    assert.strictEqual(old.status,'invalidated');processNonProactiveBoundary(s);assert.notStrictEqual(owned(s).id,old.id);assert.strictEqual(owned(s).subject.id,'second');coherent(s);
  });
  test('Phase L R2: same-instant ordering is independent of insertion order',()=>{
    const s=twoEmergencies(),d=reload(s);d.armies=new Map([...d.armies].reverse());d.aiResponses=new Map([...d.aiResponses].reverse());
    for(const x of [s,d]){x.worldTick=2;observe(x);processNonProactiveBoundary(x);coherent(x);}
    assert.strictEqual(owned(s).id,owned(d).id);assert.deepStrictEqual(encodePersistable([...s.aiResponses].sort()),encodePersistable([...d.aiResponses].sort()));
  });
  test('Phase L R2: blocked recovery revision cannot disturb emergency ownership',()=>{
    const s=threat(move(world())),op=[...s.operations.values()][0]!,a=s.armies.get('a')!;a.movement!.status='blocked';a.movement!.haltedAtTick=s.worldTick;a.movement!.interruptionReason='route blocked';settleOperation(s,op.id,'failed','route blocked');observe(s);online(s);processNonProactiveBoundary(s);
    const owner=owned(s),before=encodePersistable(owner);a.movement!.interruptionReason='destination missing';observe(s);processNonProactiveBoundary(s);
    assert.deepStrictEqual(encodePersistable(owned(s)),before);coherent(s);assert.deepStrictEqual(checkGameStateInvariants(s),[]);assert.ok([...s.aiResponses.values()].some(c=>c.lane==='OPERATION_RECOVERY'&&c.status==='blocked'));
  });
  test('Phase L R2: thinking without exact primary ownership cannot execute',()=>{
    const s=twoEmergencies(),c=emergency(s),p=reactivePlans(s,c)[0]!;c.status='thinking';c.selectedPlan=p;const before=encodePersistable(s);
    assert.throws(()=>startResponseIntervention(s,context(s),p,c),/changed before initiation/);assert.deepStrictEqual(encodePersistable(s),before);
  });
  test('Phase L R2: reload and coarse/fine response boundary sequences agree',()=>{
    const s=twoEmergencies(),d=reload(s);advance(s,500);advance(d,250);advance(d,500);
    assert.deepStrictEqual(encodePersistable(d),encodePersistable(s));const r=reload(d);
    for(const x of [s,r]){x.worldTick=2;observe(x);processNonProactiveBoundary(x);coherent(x);}
    assert.deepStrictEqual(encodePersistable(r),encodePersistable(s));
  });
  test('Phase L R2: ordinary zero-cost REINFORCE succeeds at legal emergency occupancy eight',()=>{
    let s=world();for(const id of ['c','d']){s.armies.set(id,{...s.armies.get('a')!,id});s.factions.get('me')!.armies.push(id);}
    for(const id of ['a','b','c'])s=move(s,id);threat(s);startCriticalMove(s);
    assert.strictEqual(s.strategicAttention.capacity,6);assert.strictEqual(occupiedAttention(s,'me'),8);s.territoryRecruitment.get('home')!.troops=100;
    const d=begin(s,{action:'REINFORCE',factionId:'me',territoryId:'home',sourcePoolId:recruitmentPoolId('home'),quantity:50,destination:{kind:'garrison',territoryId:'home'}});
    const op=[...d.operations.values()].find(o=>o.plan?.action==='REINFORCE')!;assert.ok(op);assert.strictEqual(op.attention.cost,0);assert.strictEqual(op.attention.acquiredAtTick,null);assert.strictEqual(op.attention.emergency,undefined);assert.strictEqual(op.responseContextId,undefined);assert.strictEqual(occupiedAttention(d,'me'),8);assert.deepStrictEqual(checkGameStateInvariants(d),[]);
  });
  test('Phase L R2: authoritative event garrison loss wakes a previously healthy hostile approach',()=>{
    const s=world();s.territories.get('stage')!.garrison=3000;threat(s);assert.strictEqual(s.aiResponses.size,0);assert.strictEqual(s.aiResponseScheduler.dirty,false);
    const {state:d}=runStateTransaction(s,d=>mergeEventStepOntoGameState(d,eventStep(d,{garrisonDeltaAbs:-3000})));
    assert.strictEqual(d.territories.get('stage')!.garrison,0);assert.strictEqual(emergency(d).subject.id,'raider');assert.strictEqual(s.aiResponses.size,0);
    online(d);processNonProactiveBoundary(d);assert.strictEqual(owned(d).lane,'REACTIVE_EMERGENCY');coherent(d);
  });
  test('Phase L R2: empty event output does not wake quiet response observation',()=>{
    const s=world();s.aiResponseScheduler.dirty=false;mergeEventStepOntoGameState(s,eventStep(s,{}));assert.strictEqual(s.aiResponseScheduler.dirty,false);
  });
  test('Phase L R2: equivalent event objects with reordered properties do not wake observation',()=>{
    const s=threat();s.aiResponseScheduler.dirty=false;const output=eventStep(s,{}),a=output.mutatedArmies!.get('raider')!;
    a.attackIntent=Object.fromEntries(Object.entries(a.attackIntent!).reverse()) as typeof a.attackIntent;
    mergeEventStepOntoGameState(s,output);assert.strictEqual(s.aiResponseScheduler.dirty,false);
  });
  for(const kind of ['open','heartbeat','end'] as const)test(`Phase L R2: response-only idempotent session ${kind} saves and reloads canonically`,async()=>{
    const s=move(world()),op=[...s.operations.values()][0]!,a=s.armies.get('a')!;a.movement!.status='blocked';a.movement!.haltedAtTick=0;a.movement!.interruptionReason='route missing';settleOperation(s,op.id,'failed','route missing');
    s.armies.delete('b');s.factions.get('me')!.armies=['a'];
    for(const faction of s.factions.values()){faction.resources={gold:0,food:0,wood:0,stone:0,iron:0};faction.goals=[];opportunity(s,faction.id);}
    accrueWorldThroughReceipt(s,1000);s.gameplaySessionLeases=[openGameplaySessionLease({sessionId:'r2-session',receiptMs:1000,openedByRequestId:'r2-open'})];
    if(kind==='heartbeat')s.gameplaySessionLeases=[renewGameplaySessionLeaseAtSequence(s.gameplaySessionLeases[0]!,1000,'r2-heartbeat',1).lease];
    if(kind==='end')s.gameplaySessionLeases=[endGameplaySessionLease(s.gameplaySessionLeases[0]!,1000).lease];
    const store=new InMemoryGameStateStore();assert.ok(store.save('r2',s,0).ok);let saves=0;
    const persistence:PlayerWorldPersistence={name:'memory',history:new InMemoryWorkoutHistoryStore(),ensure:id=>{const result=store.load(id);if(!result.ok)throw new Error(result.message);return {state:result.state,record:result.record,created:false};},save:(id,state,version)=>{saves++;return store.save(id,state,version);}};
    const host=createSessionHost(persistence,{nowMs:()=>1000});const receipt=()=>kind==='open'?host.openGameplaySession('r2','r2-open'):kind==='heartbeat'?host.heartbeatGameplaySession('r2','r2-heartbeat','r2-session',1):host.endGameplaySession('r2','r2-end','r2-session');
    const result=await receipt();assert.strictEqual(result.outcome,'idempotent_replay');assert.strictEqual(saves,1);
    const loaded=store.load('r2');assert.ok(loaded.ok);if(!loaded.ok)return;
    assert.strictEqual(loaded.state.lastAccrualAtMs,1000);assert.strictEqual(loaded.state.aiResponses.size,1);assert.strictEqual([...loaded.state.aiResponses.values()][0]!.lane,'OPERATION_RECOVERY');
    assert.deepStrictEqual(encodePersistable(reload(loaded.state).aiResponses),encodePersistable(loaded.state.aiResponses));
    await receipt();assert.strictEqual(saves,1);
  });
  test('Phase L R2: initial clock attachment preserves remaining response thought without reroll',()=>{
    const s=twoEmergencies(),c=owned(s);accrueProactiveClocks(s,500,'ONLINE');const remaining=timerRemaining(s,c.timer!),sequence=opportunity(s,'me').nextTimerSequence;
    const before=encodePersistable(c.timer);accrueWorldThroughReceipt(s,10000);assert.strictEqual(timerRemaining(s,c.timer!),remaining);
    assert.strictEqual(c.createdAtMs,9500);assert.strictEqual(c.timer!.progress.accruedThroughMs,10000);assert.strictEqual(s.aiResponseScheduler.lastBoundaryByFaction.get('me'),9500);
    accrueProactiveClocks(s,10000,'ONLINE');assert.strictEqual(timerRemaining(s,c.timer!),remaining);assert.strictEqual(opportunity(s,'me').nextTimerSequence,sequence);
    assert.strictEqual(c.timer!.onlineDurationMs,(before as {onlineDurationMs:number}).onlineDurationMs);assert.deepStrictEqual(checkGameStateInvariants(s),[]);
  });
  test('Phase L R2: queued preempted timers translate with the clock and earn no hidden work',()=>{
    const s=twoEmergencies(),old=owned(s);accrueProactiveClocks(s,500,'ONLINE');transferPrimaryResponse(s,emergency(s));
    const remaining=timerRemaining(s,old.timer!);accrueWorldThroughReceipt(s,10000);const d=reload(s);transferPrimaryResponse(d,d.aiResponses.get(old.id)!);
    accrueProactiveClocks(d,10000,'ONLINE');assert.strictEqual(timerRemaining(d,d.aiResponses.get(old.id)!.timer!),remaining);coherent(d);
  });
  test('Phase L R2: required proposal clock translation retains semantic revision',()=>{
    const s=pendingTrade(),p=liveTradeProposals(s)[0]!,c=[...s.aiResponses.values()][0]!,revision=c.revision,remaining=timerRemaining(s,p.responseTimer!);
    accrueWorldThroughReceipt(s,100000);registerRequiredResponse(s,'trade',p.id);assert.strictEqual(c.revision,revision);assert.strictEqual(timerRemaining(s,p.responseTimer!),remaining);
    assert.deepStrictEqual(encodePersistable(reload(s)),encodePersistable(s));
  });
  test('Phase L R2: attaching before or after reload yields identical future thought progress',()=>{
    const s=twoEmergencies();accrueProactiveClocks(s,500,'ONLINE');const d=reload(s);
    for(const x of [s,d]){accrueWorldThroughReceipt(x,10000);accrueProactiveClocks(x,10250,'ONLINE');}
    assert.deepStrictEqual(encodePersistable(d),encodePersistable(s));
  });
  test('Phase L R2: invariant failure after nested exact start rolls back all canonical side effects',()=>{
    const s=threat();s.strategicAttention.capacity=0;online(s);processNonProactiveBoundary(s);const before=encodePersistable(s);
    assert.throws(()=>runStateTransaction(s,d=>{
      const c=owned(d),p=reactivePlans(d,c).find(p=>p.action==='MOVE')!;c.selectedPlan=p;
      startResponseIntervention(d,context(d),p,c);assert.ok(d.operationClaims.size);assert.ok([...d.operations.values()][0]!.attention.emergency);
      d.aiResponseScheduler.primaryByFaction.set('me','deliberate-private-invariant-failure');
    }),(e:unknown)=>e instanceof OrchestrationError&&e.code===ErrorCode.INVALID_GAME_STATE);
    assert.deepStrictEqual(encodePersistable(s),before);assert.strictEqual(s.operationClaims.size,0);assert.strictEqual(s.operations.size,0);assert.strictEqual(occupiedAttention(s,'me'),0);
  });
  test('Phase L R2: outer command invariant rejection publishes no nested operation effects',()=>{
    const s=threat();s.strategicAttention.capacity=0;online(s);processNonProactiveBoundary(s);const before=encodePersistable(s),original=MUTATING_HANDLERS.COLLECT_RESOURCES;
    MUTATING_HANDLERS.COLLECT_RESOURCES=(d,ctx)=>{
      const c=owned(d),p=reactivePlans(d,c).find(p=>p.action==='MOVE')!;c.selectedPlan=p;
      let inner:Parameters<NonNullable<Parameters<typeof startResponseIntervention>[4]>>[0]|undefined;
      startResponseIntervention(d,ctx,p,c,r=>inner=r);assert.ok(inner);assert.ok(d.operationClaims.size);assert.ok([...d.operations.values()][0]!.attention.emergency);
      d.aiResponseScheduler.primaryByFaction.set('me','private-nested-invariant');
      return {...inner,events:[...inner.events,{kind:'world',id:'private-nested-event',title:'Internal',summary:'Uncommitted'}],notifications:[{severity:'info',title:'Internal',body:'Uncommitted'}]};
    };
    try {
      const o=new Orchestrator(s),result=o.execute(cmdReq('COLLECT_RESOURCES','r2',{territoryId:'safe'}));
      assert.strictEqual(result.success,false);assert.strictEqual(result.errors[0]!.code,ErrorCode.INVALID_GAME_STATE);
      assert.deepStrictEqual(result.events,[]);assert.deepStrictEqual(result.notifications,[]);assert.deepStrictEqual(result.stateChanges,[]);assert.deepStrictEqual(result.payload,{});
      assert.deepStrictEqual(encodePersistable(o.getState()),before);
    }finally{MUTATING_HANDLERS.COLLECT_RESOURCES=original;}
  });
  test('Phase L R2: HTTP invariant failure keeps private identifiers only in server diagnostics',async()=>{
    const s=pendingTrade(),proposal=liveTradeProposals(s)[0]!,privateContext=[...s.aiResponses.values()][0]!.id;
    s.aiResponses.get(privateContext)!.status='thinking';s.aiResponseScheduler.primaryByFaction.set('me',`private-orphan:${proposal.id}`); // Deliberately unowned thought.
    const orchestrator=new Orchestrator(s),before=encodePersistable(s);
    const host:CommandSessionHost={persistenceName:'memory',execute:async req=>{
      const result=orchestrator.execute(req);
      // The world/catch-up DTO also carries nested engine error bodies.
      if(result.errors.some(e=>e.code===ErrorCode.INVALID_GAME_STATE))result.payload.worldAdvance={errors:result.errors};
      return result;
    },openGameplaySession:async()=>{throw new Error(`private ${proposal.id}`);},heartbeatGameplaySession:async()=>{throw new Error('unused');},endGameplaySession:async()=>{throw new Error('unused');}};
    const diagnostics:unknown[]=[];const server=createCommandHttpServer(host,{onInternalError:d=>diagnostics.push(d)});
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');if(!address||typeof address==='string')return;
    const post=(path:string,body:unknown)=>new Promise<Record<string,unknown>>((resolve,reject)=>{
      const payload=JSON.stringify(body),req=request({hostname:'127.0.0.1',port:address.port,path,method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve(JSON.parse(text)));});req.on('error',reject);req.end(payload);
    });
    try {
      const result=await post('/commands',{commandId:'COLLECT_RESOURCES',playerId:'r2',parameters:{territoryId:'safe'}}),json=JSON.stringify(result);
      assert.strictEqual(result.success,false);assert.ok(json.includes('INVALID_GAME_STATE'));assert.ok(!json.includes('response:v1:'));assert.ok(!json.includes(JSON.stringify(proposal.id).slice(1,-1)));
      const publicErrors=result.errors as {message:string;details?:unknown}[];assert.strictEqual(publicErrors[0]!.details,undefined);
      const nested=result.payload as {worldAdvance:{errors:{details?:unknown}[]}};assert.strictEqual(nested.worldAdvance.errors[0]!.details,undefined);
      assert.ok(JSON.stringify(diagnostics).includes('response:v1:'));assert.deepStrictEqual(result.events,[]);assert.deepStrictEqual(result.notifications,[]);assert.deepStrictEqual(encodePersistable(orchestrator.getState()),before);
      const domain=await post('/commands',{commandId:'COLLECT_RESOURCES',playerId:'r2',parameters:{territoryId:'absent'}});
      assert.ok(JSON.stringify(domain).includes('INVALID_TERRITORY'));assert.ok(JSON.stringify(domain).includes('absent'));
      const thrown=await post('/session/open',{playerId:'r2',requestId:'open'});assert.strictEqual(thrown.error,'INTERNAL');assert.ok(!JSON.stringify(thrown).includes(proposal.id));
    }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
  });
}
