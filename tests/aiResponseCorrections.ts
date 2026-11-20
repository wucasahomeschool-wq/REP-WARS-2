import assert from 'assert';
import { request } from 'node:http';
import { inspect } from 'node:util';
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
import { liveTradeProposals, publicTradeState } from '../src/gameplay/trade/trade';
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
import { createSessionHost, CommandSessionHost, PersistenceFailedError, CommandNotExposedError } from '../src/server/session';
import { BadRequestError } from '../src/server/identity';
import { GameplaySessionReceiptError } from '../src/server/gameplaySessionLifecycle';
import { PlayerWorldPersistence } from '../src/server/persistencePort';
import { createCommandHttpServer as createHttpServer } from '../src/server/http';
const createCommandHttpServer: typeof createHttpServer = (host, options) => createHttpServer(host, { ...options, identity: { mode: 'development' } });

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

  // Real HTTP bodies, including hidden NPC Trade identities; no projector-only tests.
  const privacyHttp=async(build:(error:Record<string,unknown>,ids:{proposal:string;context:string})=>unknown,
    verify:(result:{status:number;raw:string;body:Record<string,unknown>;diagnostics:unknown[]},original:unknown)=>void)=>{
    const s=pendingTrade(),proposal=liveTradeProposals(s)[0]!.id,contextId=[...s.aiResponses.values()][0]!.id;
    assert.strictEqual(publicTradeState(s,'spectator').proposals.length,0);
    const before=encodePersistable(s),error={code:ErrorCode.INVALID_GAME_STATE,message:proposal,
      details:{contextId,proposalId:proposal}},original=build(error,{proposal,context:contextId});
    const response=new Orchestrator(s).execute(cmdReq('GET_GAME_STATE','spectator'));
    response.errors=original && typeof original==='object' && Object.getOwnPropertyDescriptor(original,'code')?.value
      ? [original as (typeof response.errors)[number]] : [];response.payload={probe:original};
    const diagnostics:unknown[]=[],host:CommandSessionHost={persistenceName:'memory',execute:async()=>response,
      openGameplaySession:async()=>{throw new Error('unused');},heartbeatGameplaySession:async()=>{throw new Error('unused');},endGameplaySession:async()=>{throw new Error('unused');}};
    const server=createCommandHttpServer(host,{onInternalError:d=>diagnostics.push(d)});
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address();assert.ok(address&&typeof address!=='string');if(!address||typeof address==='string')throw new Error('No port');
    try {
      const result=await new Promise<{status:number;raw:string;body:Record<string,unknown>}>((resolve,reject)=>{
        const payload=JSON.stringify({commandId:'GET_GAME_STATE',playerId:'spectator'});
        const req=request({hostname:'127.0.0.1',port:address.port,path:'/commands',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},res=>{
          let raw='';res.on('data',chunk=>raw+=chunk);res.on('end',()=>resolve({status:res.statusCode!,raw,body:JSON.parse(raw)}));
        });req.on('error',reject);req.end(payload);
      });
      // Test final wire text, including escaped IDs, rather than only parsed fields.
      for(const id of [proposal,contextId])assert.ok(!result.raw.includes(JSON.stringify(id).slice(1,-1)),`Private identity reached HTTP: ${id}`);
      verify({...result,diagnostics},original);
      assert.deepStrictEqual(encodePersistable(s),before);
      assert.strictEqual(response.payload.probe,original); // Projection cannot mutate its input.
    }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
  };
  const safeInternal=(result:{status:number;body:Record<string,unknown>;diagnostics:unknown[]},original:unknown)=>{
    assert.strictEqual(result.status,200);
    assert.deepStrictEqual((result.body.payload as {probe:unknown}).probe,{code:ErrorCode.INVALID_GAME_STATE,message:'Internal game consistency error. Please retry.'});
    assert.strictEqual(result.diagnostics.length,1);
    assert.strictEqual((result.diagnostics[0] as {errors:unknown[]}).errors[0],original);
  };
  const safeFailure=(result:{status:number;body:Record<string,unknown>;diagnostics:unknown[]})=>{
    assert.strictEqual(result.status,500);assert.deepStrictEqual(result.body,{error:'INTERNAL',message:'Internal server error. Please retry.'});assert.strictEqual(result.diagnostics.length,1);
  };
  test('Phase L privacy: plain internal error preserves safe projection and diagnostics',()=>privacyHttp(e=>e,safeInternal));
  test('Phase L privacy: top-level null-prototype internal error is sanitized',()=>privacyHttp(e=>Object.assign(Object.create(null),e),safeInternal));
  test('Phase L privacy: nested null-prototype internal error is sanitized',()=>privacyHttp(e=>({catchUp:{errors:[Object.assign(Object.create(null),e)]}}),r=>{
    assert.strictEqual(r.status,200);assert.strictEqual(r.diagnostics.length,1);
    assert.strictEqual(JSON.stringify(r.body).includes('contextId'),false);
  }));
  test('Phase L privacy: top-level OrchestrationError instance is sanitized',()=>privacyHttp(e=>new OrchestrationError(ErrorCode.INVALID_GAME_STATE,e.message as string,e.details as Record<string,unknown>),safeInternal));
  test('Phase L privacy: nested OrchestrationError instance is sanitized',()=>privacyHttp(e=>({world:{errors:[new OrchestrationError(ErrorCode.INVALID_GAME_STATE,e.message as string,e.details as Record<string,unknown>)]}}),r=>{
    assert.strictEqual(r.status,200);assert.strictEqual(r.diagnostics.length,1);assert.ok(!r.raw.includes('contextId'));
  }));
  test('Phase L privacy: arrays with mixed representations sanitize every entry',()=>privacyHttp(e=>[e,Object.assign(Object.create(null),e),new OrchestrationError(ErrorCode.INVALID_GAME_STATE,e.message as string,e.details as Record<string,unknown>)],r=>{
    assert.strictEqual(r.status,200);assert.strictEqual((r.diagnostics[0] as {errors:unknown[]}).errors.length,3);
    const entries=(r.body.payload as {probe:{details?:unknown}[]}).probe;assert.strictEqual(entries.length,3);assert.ok(entries.every(e=>e.details===undefined));
  }));
  test('Phase L privacy: public domain errors retain code message and details across representations',()=>privacyHttp(()=>{
    const domain={code:ErrorCode.INVALID_TERRITORY,message:'Territory absent',details:{territoryId:'absent',alternatives:['safe']}};
    class DomainBody {code=domain.code;message=domain.message;details=domain.details;}
    return [domain,Object.assign(Object.create(null),domain),new DomainBody(),new OrchestrationError(domain.code,domain.message,domain.details)];
  },r=>{
    assert.strictEqual(r.status,200);assert.strictEqual(r.diagnostics.length,0);
    const domain={code:ErrorCode.INVALID_TERRITORY,message:'Territory absent',details:{territoryId:'absent',alternatives:['safe']}};
    assert.deepStrictEqual((r.body.payload as {probe:unknown}).probe,[domain,domain,domain,domain]);
  }));
  test('Phase L privacy: own toJSON cannot inject private errors and is not invoked',async()=>{
    let calls=0;await privacyHttp(e=>({safe:true,toJSON(){calls++;return e;}}),safeFailure);assert.strictEqual(calls,0);
  });
  test('Phase L privacy: inherited toJSON cannot inject private errors and is not invoked',async()=>{
    let calls=0;await privacyHttp(e=>{class Container {safe=true;toJSON(){calls++;return e;}}return {nested:new Container()};},safeFailure);assert.strictEqual(calls,0);
  });
  test('Phase L privacy: enumerable getter is rejected without invocation',async()=>{
    let calls=0;await privacyHttp(e=>Object.defineProperty({safe:true},'unexpected',{enumerable:true,get(){calls++;return e;}}),safeFailure);assert.strictEqual(calls,0);
  });
  test('Phase L privacy: cyclic output fails safely without exception text',()=>privacyHttp((_,ids)=>{
    const cycle:Record<string,unknown>={};cycle.self=cycle;cycle.secret=ids.proposal;return cycle;
  },safeFailure));
  test('Phase L privacy: internal code without message cannot leak under alternate fields',()=>privacyHttp((e,ids)=>({code:e.code,unexpected:ids.proposal,more:[ids.context]}),safeInternal));
  test('Phase L privacy: nested unexpected Error does not expose stack or exception text',()=>privacyHttp((_,ids)=>new Error(ids.proposal),r=>{
    assert.strictEqual(r.status,200);assert.strictEqual(r.diagnostics.length,1);assert.ok(!r.raw.includes('stack'));
    assert.deepStrictEqual((r.body.payload as {probe:unknown}).probe,{code:ErrorCode.ENGINE_ERROR,message:'Internal game consistency error. Please retry.'});
  }));
  test('Phase L privacy: safe data and repeated aliases preserve ordinary JSON semantics',()=>privacyHttp(()=>{
    const shared={label:'public',value:7};return {aliases:[shared,shared],missing:undefined,finite:2.5,nonfinite:Infinity,array:[undefined,null,true],nested:Object.assign(Object.create(null),{name:'public'})};
  },r=>{
    assert.strictEqual(r.status,200);assert.strictEqual(r.diagnostics.length,0);
    assert.deepStrictEqual((r.body.payload as {probe:unknown}).probe,{aliases:[{label:'public',value:7},{label:'public',value:7}],finite:2.5,nonfinite:null,array:[null,null,true],nested:{name:'public'}});
  }));
  test('Phase L privacy: serialization hook getter is rejected without invocation',async()=>{
    let calls=0;await privacyHttp(e=>Object.defineProperty({safe:true},'toJSON',{get(){calls++;return ()=>e;}}),safeFailure);assert.strictEqual(calls,0);
  });
  test('Phase L privacy: unserializable BigInt fails safely instead of exposing exception details',()=>privacyHttp(()=>({value:1n}),safeFailure));
  test('Phase L privacy: inherited internal error code cannot conceal private own fields',()=>privacyHttp((e,ids)=>Object.assign(Object.create({code:e.code}),{message:ids.proposal,unexpected:ids.context}),safeInternal));
  test('Phase L privacy: boxed code cannot change classification at serialization',()=>privacyHttp((e,ids)=>({code:new String(e.code),message:ids.proposal,details:{contextId:ids.context}}),safeFailure));
  test('Phase L privacy: function toJSON cannot transform an error code after classification',async()=>{
    let calls=0;await privacyHttp((e,ids)=>({code:Object.assign(()=>undefined,{toJSON(){calls++;return e.code;}}),message:ids.proposal,details:{contextId:ids.context}}),safeFailure);assert.strictEqual(calls,0);
  });

  const runBoundaryHttp=async(path:string,make:(ids:{proposal:string;context:string})=>unknown,
    verify:(r:{status:number;body:Record<string,unknown>;raw:string;diagnostics:unknown[];log:string},original:unknown)=>void,
    options:{returned?:boolean;rawResponse?:boolean;defaultLogger?:boolean;throwReporter?:boolean}={})=>{
    const s=pendingTrade(),proposal=liveTradeProposals(s)[0]!.id,contextId=[...s.aiResponses.values()][0]!.id;
    assert.strictEqual(publicTradeState(s,'spectator').proposals.length,0);
    const before=encodePersistable(s),original=make({proposal,context:contextId}),response=new Orchestrator(s).execute(cmdReq('GET_GAME_STATE','spectator'));
    response.errors=[];response.payload={probe:original};
    const diagnostics:unknown[]=[],host:CommandSessionHost={persistenceName:'memory',execute:async()=>{if(options.rawResponse)return original as Awaited<ReturnType<CommandSessionHost['execute']>>;if(options.returned)return response;throw original;},
      openGameplaySession:async()=>{throw original;},heartbeatGameplaySession:async()=>{throw original;},endGameplaySession:async()=>{throw original;}};
    const log:string[]=[],write=process.stderr.write;
    if(options.defaultLogger)process.stderr.write=((chunk:string|Uint8Array)=>{log.push(typeof chunk==='string'?chunk:Buffer.from(chunk).toString('utf8'));return true;}) as typeof process.stderr.write;
    const server=createCommandHttpServer(host,options.defaultLogger?undefined:{onInternalError:d=>{diagnostics.push(d);if(options.throwReporter)throw new Error(proposal);}});
    try {
      await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');if(!address||typeof address==='string')throw new Error('No port');
      const result=await new Promise<{status:number;raw:string;body:Record<string,unknown>}>((resolve,reject)=>{
        const payload=JSON.stringify({commandId:'GET_GAME_STATE',playerId:'spectator',requestId:'boundary',gameplaySessionId:'session',renewalSequence:1});
        const req=request({hostname:'127.0.0.1',port:address.port,path,method:'POST',headers:{'Content-Type':'application/json'}},res=>{let raw='';res.on('data',chunk=>raw+=chunk);res.on('end',()=>{try{resolve({status:res.statusCode!,raw,body:JSON.parse(raw)});}catch(e){reject(e);}});});req.on('error',reject);req.end(payload);
      });
      for(const id of [proposal,contextId])assert.ok(!result.raw.includes(JSON.stringify(id).slice(1,-1)),'Private ID reached failure response');
      verify({...result,diagnostics,log:log.join('')},original);
      assert.deepStrictEqual(encodePersistable(s),before);assert.strictEqual(response.payload.probe,original);
    }finally{process.stderr.write=write;await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
  };
  // The legacy full runner starts registered async tests concurrently. A shared
  // stderr sink must have one capture owner; focused runners still await cases.
  let diagnosticCapture:Promise<void>=Promise.resolve();
  const boundaryHttp:typeof runBoundaryHttp=async(path,make,verify,options={})=>{
    if(!options.defaultLogger)return runBoundaryHttp(path,make,verify,options);
    const previous=diagnosticCapture;let release!:()=>void;
    diagnosticCapture=new Promise<void>(resolve=>{release=resolve;});
    await previous;
    try{await runBoundaryHttp(path,make,verify,options);}finally{release();}
  };
  const persistenceBody=(r:{status:number;body:Record<string,unknown>;diagnostics:unknown[]},code='persistence.save_failed')=>{
    assert.strictEqual(r.status,500);assert.deepStrictEqual(r.body,{error:'PERSISTENCE_FAILED',message:'Unable to save game state. Please retry.',code});assert.strictEqual(r.diagnostics.length,1);
  };
  for(const path of ['/commands','/session/open']){
    test(`Phase L HTTP boundary: ${path} persistence boxed code never serializes`,async()=>{
      let calls=0;await boundaryHttp(path,ids=>{
        const e=new PersistenceFailedError('persistence.conflict',ids.proposal);
        Object.defineProperty(e,'code',{value:Object.assign(new String('persistence.conflict'),{toJSON(){calls++;return {proposal:ids.proposal,context:ids.context};}})});return e;
      },r=>persistenceBody(r));assert.strictEqual(calls,0);
    });
    test(`Phase L HTTP boundary: ${path} persistence null-prototype code is rejected`,()=>boundaryHttp(path,ids=>{
      const e=new PersistenceFailedError('persistence.conflict',ids.proposal);Object.defineProperty(e,'code',{value:Object.assign(Object.create(null),{proposal:ids.proposal,context:ids.context})});return e;
    },r=>persistenceBody(r)));
    test(`Phase L HTTP boundary: ${path} persistence class code is rejected`,()=>boundaryHttp(path,ids=>{
      class Code {proposal=ids.proposal;context=ids.context;}
      const e=new PersistenceFailedError('persistence.conflict',ids.proposal);Object.defineProperty(e,'code',{value:new Code()});return e;
    },r=>persistenceBody(r)));
    test(`Phase L HTTP boundary: ${path} persistence code getter is never evaluated`,async()=>{
      let calls=0;await boundaryHttp(path,ids=>{const e=new PersistenceFailedError('persistence.conflict',ids.proposal);Object.defineProperty(e,'code',{get(){calls++;return ids.context;}});return e;},r=>persistenceBody(r));assert.strictEqual(calls,0);
    });
    test(`Phase L HTTP boundary: ${path} persistence proxy code causes zero traps`,async()=>{
      let calls=0;await boundaryHttp(path,ids=>{
        const e=new PersistenceFailedError('persistence.conflict',ids.proposal),trap=()=>{calls++;throw new Error(ids.context);};
        Object.defineProperty(e,'code',{value:new Proxy({}, {get:trap,getPrototypeOf:trap,ownKeys:trap,getOwnPropertyDescriptor:trap})});return e;
      },r=>persistenceBody(r));assert.strictEqual(calls,0);
    });
    test(`Phase L HTTP boundary: ${path} legitimate persistence code is preserved`,()=>boundaryHttp(path,ids=>new PersistenceFailedError('persistence.conflict',ids.proposal),r=>persistenceBody(r,'persistence.conflict')));
    test(`Phase L HTTP boundary: ${path} arbitrary string persistence code is not public`,()=>boundaryHttp(path,ids=>new PersistenceFailedError(ids.context,ids.proposal),r=>persistenceBody(r)));
  }
  test('Phase L HTTP boundary: default logger never invokes custom inspection',async()=>{
    let calls=0;await boundaryHttp('/commands',ids=>Object.assign(new OrchestrationError(ErrorCode.ENGINE_ERROR,ids.proposal,{contextId:ids.context}),{[inspect.custom](){calls++;return 'hidden';}}),r=>{
      assert.strictEqual(r.status,200);assert.ok(r.log.includes('Internal game request failure'));assert.ok(r.log.includes('ENGINE_ERROR'));
    },{returned:true,defaultLogger:true});assert.strictEqual(calls,0);
  });
  test('Phase L HTTP boundary: default logger never reads stack message or details getters',async()=>{
    let calls=0;await boundaryHttp('/commands',ids=>{
      const e=new OrchestrationError(ErrorCode.ENGINE_ERROR,'placeholder');
      for(const key of ['stack','message','details'])Object.defineProperty(e,key,{enumerable:true,get(){calls++;return ids.proposal;}});return e;
    },r=>{assert.strictEqual(r.status,200);assert.ok(r.log.includes('ENGINE_ERROR'));assert.ok(r.log.includes('[accessor]'));},{returned:true,defaultLogger:true});assert.strictEqual(calls,0);
  });
  test('Phase L HTTP boundary: default logger never calls toJSON and records useful data',async()=>{
    let calls=0;await boundaryHttp('/commands',ids=>Object.assign(new OrchestrationError(ErrorCode.ENGINE_ERROR,ids.proposal),{toJSON(){calls++;return ids.context;}}),r=>{
      assert.strictEqual(r.status,200);assert.ok(r.log.includes('ENGINE_ERROR'));assert.ok(r.log.includes('[function]'));
    },{returned:true,defaultLogger:true});assert.strictEqual(calls,0);
  });
  test('Phase L HTTP boundary: default diagnostics bound cycles depth fields and string size',()=>boundaryHttp('/commands',()=>{
    const e=new Error('x'.repeat(10000));const detail:Record<string,unknown>={};detail.self=detail;for(let i=0;i<100;i++)detail['key'+i]={a:{b:{c:{value:'public'}}}};Object.assign(e,{details:detail});return e;
  },r=>{assert.strictEqual(r.status,500);assert.ok(r.log.length<20000);assert.ok(r.log.includes('[truncated]')||r.log.includes('[depth limit]')||r.log.includes('[circular]'));},{defaultLogger:true}));
  for(const path of ['/commands','/session/open','/session/heartbeat','/session/end'])test(`Phase L HTTP boundary: thrown proxy at ${path} executes no traps`,async()=>{
    let calls=0;await boundaryHttp(path,ids=>{const trap=()=>{calls++;throw new Error(ids.proposal);};return new Proxy({}, {get:trap,getPrototypeOf:trap,ownKeys:trap,getOwnPropertyDescriptor:trap});},r=>{
      assert.strictEqual(r.status,500);assert.deepStrictEqual(r.body,{error:'INTERNAL',message:'Internal server error. Please retry.'});assert.ok(r.log.includes('[proxy]'));
    },{defaultLogger:true});assert.strictEqual(calls,0);
  });
  test('Phase L HTTP boundary: revoked thrown proxy fails safely',()=>boundaryHttp('/commands',()=>{const p=Proxy.revocable({},{});p.revoke();return p.proxy;},r=>{assert.strictEqual(r.status,500);assert.ok(r.log.includes('[proxy]'));},{defaultLogger:true}));
  test('Phase L HTTP boundary: proxy prototype cannot impersonate a public exception',async()=>{
    let calls=0;await boundaryHttp('/commands',()=>Object.create(new Proxy(BadRequestError.prototype,{getPrototypeOf(){calls++;return null;},get(){calls++;return 'hidden';}})),r=>{assert.strictEqual(r.status,500);});assert.strictEqual(calls,0);
  });
  test('Phase L HTTP boundary: malformed public exception message getter is not evaluated',async()=>{
    let calls=0;await boundaryHttp('/session/open',ids=>{const e=new BadRequestError('placeholder');Object.defineProperty(e,'message',{get(){calls++;return ids.context;}});return e;},r=>{assert.strictEqual(r.status,500);});assert.strictEqual(calls,0);
  });
  test('Phase L HTTP boundary: command rejection derives public context without message getter',async()=>{
    let calls=0;await boundaryHttp('/commands',ids=>{const e=new CommandNotExposedError('GET_GAME_STATE');Object.defineProperty(e,'message',{get(){calls++;return ids.context;}});return e;},r=>{
      assert.strictEqual(r.status,403);assert.strictEqual(r.body.message,'Command is not exposed over HTTP: GET_GAME_STATE');
    });assert.strictEqual(calls,0);
  });
  test('Phase L HTTP boundary: useful expected session validation message remains public',()=>boundaryHttp('/session/open',()=>new BadRequestError('renewalSequence must be a positive safe integer'),r=>{assert.strictEqual(r.status,400);assert.strictEqual(r.body.message,'renewalSequence must be a positive safe integer');}));
  test('Phase L HTTP boundary: stale receipt uses a trusted fixed public message',async()=>{
    let calls=0;await boundaryHttp('/session/heartbeat',ids=>{const e=new GameplaySessionReceiptError();Object.defineProperty(e,'message',{get(){calls++;return ids.context;}});return e;},r=>{assert.strictEqual(r.status,409);assert.strictEqual(r.body.message,'Gameplay session receipt is behind authoritative state');});assert.strictEqual(calls,0);
  });
  test('Phase L HTTP boundary: reporter failure cannot replace the safe public response',()=>boundaryHttp('/commands',ids=>new PersistenceFailedError('persistence.conflict',ids.proposal),r=>persistenceBody(r,'persistence.conflict'),{throwReporter:true}));
  test('Phase L HTTP boundary: unserializable top-level response becomes a safe failure',()=>boundaryHttp('/commands',()=>()=>undefined,r=>{assert.strictEqual(r.status,500);assert.deepStrictEqual(r.body,{error:'INTERNAL',message:'Internal server error. Please retry.'});},{rawResponse:true}));
}
