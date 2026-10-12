import assert from 'assert';
import { ContextPlanComparator } from '../src/scoring/contextPlanComparison';
import { GameState } from '../src/types/GameState';
import { AIConcretePlan, comparePlanIds, makeConcretePlan } from '../src/types/AIConcretePlan';
import { PRESSURE_DOMAINS, emptyPressureMetrics } from '../src/types/AIPressure';
import { deriveSources, observeSources, inspectSourceActionability, sourceConcretePlans, accrueSourcePressure, readySource } from '../src/engine/strategicPressure';
import { opportunity, prepareProactiveDecision, selectWaitInitiation, accrueProactiveClocks, successfulInitiation, startProactiveTimer, timerRemaining } from '../src/engine/proactiveCognition';
import { STRATEGIC_PRESSURE_TUNING as T, PROACTIVE_TEMPORAL_RULES as TIME } from '../src/constants/strategicPressure';
import { occupiedAttention } from '../src/engine/strategicAttention';
import { activeOperations, settleOperation } from '../src/engine/operations';
import { makeOperationTestWorld } from './aiOperationFixtures';
import { primeSourceDecision } from './aiPressureFixtures';
import { Orchestrator, createDefaultRegistry } from '../src/orchestration';
import { DecisionEngine } from '../src/engine/DecisionEngine';
import { ActionScorer } from '../src/scoring/ActionScorer';
import { cloneGameState } from '../src/state/cloneGameState';
import { checkGameStateInvariants } from '../src/state/gameStateInvariants';
import { hydratePersistedPayload } from '../src/persistence/hydrate';
import { encodePersistable } from '../src/persistence/serialization';
import { beginDurationProgress, accrueDurationProgress, durationRemainingMs } from '../src/world/timeToTick';
import { openGameplaySessionLease } from '../src/world/presenceLeases';
import { accrueWorldThroughReceipt } from '../src/world/worldAccrual';
import { catchUpWorld } from '../src/world/catchup';
import { progressProactiveThrough, handleAiDecide } from '../src/orchestration/handlers';
import { getCommandDefinition } from '../src/orchestration/commandIndex';
import { buildWarlordStates } from '../src/state/gameStateAdapters';
import { AICommitment, WarlordSnapshot, Territory } from '../src/types';
import { CommandRequest } from '../src/orchestration/protocol';
interface Api {test(name:string,fn:()=>void):void;makeSelf(id:string,x?:Partial<WarlordSnapshot>):WarlordSnapshot;makeTerritory(x:Partial<Territory>&{id:string}):Territory;cmdReq(id:string,p:string,params?:Record<string,unknown>):CommandRequest;}
export function registerAiStrategicPressureTests({test,makeSelf,makeTerritory,cmdReq}:Api):void {
  const world=()=>{const s=makeOperationTestWorld(makeSelf,makeTerritory);s.factions.get('me')!.diplomacy.set('enemy',{target:'enemy',state:'at_war',opinion:0,treaties:[],yearsAtPeace:0,yearsAtWar:1});return s;};
  const military=(s:GameState)=>{observeSources(s,'me');return [...s.aiPressure.values()].find(c=>c.kind==='HOSTILE_OPPORTUNITY')!;};
  const waitState=()=>{const s=world();const c=military(s);c.pressure=T.ready;prepareProactiveDecision(s,'me');const o=opportunity(s,'me');o.primary!.phase='selected';o.primary!.timer=null;selectWaitInitiation(s,'me');return s;};
  const finishWait=(s:GameState)=>{const t=opportunity(s,'me').primary!.timer!;accrueProactiveClocks(s,s.aiClock.nowMs+timerRemaining(s,t),'OFFLINE');prepareProactiveDecision(s,'me');};
  const context=(s:GameState)=>({req:cmdReq('AI_DECIDE','ai',{warlordId:'me'}),def:getCommandDefinition('AI_DECIDE')!,registry:createDefaultRegistry(),runtime:{aiWarlordStates:buildWarlordStates(s)}});
  test('Phase E: exactly five locked pressure domains',()=>assert.deepStrictEqual(PRESSURE_DOMAINS,['MILITARY_INITIATIVE','FORCE_POSITIONING','DEVELOPMENT','DIPLOMACY_PEACE','TRADE_ECONOMIC']));
  test('Phase E: idle armies and WAR alone are not sources',()=>{const s=world();s.territories.get('target')!.baseValue=0;s.territories.get('target')!.resourceOutput={};assert.strictEqual(deriveSources(s,'me',0).length,0);});
  test('Phase E: Goal and raw Memory cannot manufacture a source',()=>{const s=world();s.territories.get('target')!.baseValue=0;const f=s.factions.get('me')!;f.goals=[{id:'g',type:'destroy_rival',priority:100,targetFaction:'enemy',targetTerritory:'target',targetRegion:null,targetResource:null,progress:0,targetProgress:1,deadlineTurn:null,createdTurn:0}];f.memory=[{id:'m',type:'action_failed',turn:0,magnitude:100,withFaction:'enemy',territory:'target',details:{}}];assert.strictEqual(deriveSources(s,'me',0).length,0);});
  test('Phase E: magnitude changes keep semantic source identity',()=>{const s=world(),c=military(s);s.territories.get('target')!.garrison+=1;observeSources(s,'me');assert.ok(s.aiPressure.has(c.id));});
  test('Phase E: ownership transformation invalidates old source identity',()=>{const s=world(),c=military(s);s.territories.get('target')!.owner='me';observeSources(s,'me');assert.ok(!s.aiPressure.has(c.id));});
  test('Phase E: online/offline pressure is exact 1/50 and saturates',()=>{const a=world(),b=world();military(a);military(b);accrueSourcePressure(a,1000,'ONLINE');accrueSourcePressure(b,50000,'OFFLINE');assert.strictEqual([...a.aiPressure.values()][0]!.pressure,[...b.aiPressure.values()][0]!.pressure);accrueSourcePressure(a,1e9,'ONLINE');assert.strictEqual([...a.aiPressure.values()][0]!.pressure,T.maximum);});
  test('Phase E: fractional pressure is chunk/reload independent',()=>{const a=world(),b=world();military(a);military(b);for(let i=0;i<100;i++)accrueSourcePressure(a,1,'OFFLINE');accrueSourcePressure(b,100,'OFFLINE');assert.deepStrictEqual([...a.aiPressure.values()].map(s=>[s.pressure,s.pressureRemainder]),[...b.aiPressure.values()].map(s=>[s.pressure,s.pressureRemainder]));});
  test('Phase E: source-bound military plans cannot include unrelated empire actions',()=>{const s=world(),c=military(s),p=sourceConcretePlans(s,c);assert.ok(p.some(p=>p.action==='ATTACK'));assert.ok(p.every(p=>p.action==='ATTACK'||p.action==='MOVE'||p.action==='WAIT'));assert.ok(p.filter(p=>p.action==='ATTACK').every(p=>p.targetTerritoryId==='target'));assert.ok(p.filter(p=>p.action==='MOVE').every(p=>p.destinationTerritoryId==='stage'));});
  test('Phase E: meaningful construction sources map only BUILD/WAIT',()=>{const s=world();s.territories.get('home')!.resourceOutput={food:5};s.factions.get('me')!.resources.food=0;observeSources(s,'me');const c=[...s.aiPressure.values()].find(c=>c.domain==='DEVELOPMENT')!;assert.ok(c);assert.deepStrictEqual(sourceConcretePlans(s,c).map(p=>p.action).sort(),['BUILD','WAIT']);});
  test('Phase E: high pressure cannot make WAIT-only source actionable',()=>{const s=world(),c=military(s);s.strategicAttention.capacity=0;c.pressure=T.maximum;observeSources(s,'me');assert.strictEqual(readySource(s,'me'),null);assert.deepStrictEqual(sourceConcretePlans(s,c),[]);assert.ok(c.blockers.some(b=>b.reasons.some(r=>r.kind==='ATTENTION')));assert.strictEqual(prepareProactiveDecision(s,'me'),null);assert.strictEqual(opportunity(s,'me').primary,null);});
  test('Phase E: blocked troop predicates do not rearm on meaningless increments',()=>{const s=world();s.territories.get('target')!.garrison=0;s.armies.get('a')!.soldiers=1;s.armies.get('a')!.knights=0;s.armies.get('b')!.soldiers=1;s.armies.get('b')!.knights=0;s.armies.get('a')!.location='stage';s.armies.get('b')!.location='stage';const c=military(s);assert.ok(c.blocked);s.armies.get('a')!.soldiers++;observeSources(s,'me');assert.ok(c.blocked);s.armies.get('a')!.soldiers=101;observeSources(s,'me');assert.ok(!c.blocked);});
  test('Phase E: multiple prerequisites must jointly permit one full plan',()=>{const s=world(),c=military(s);s.strategicAttention.capacity=0;s.operationClaims.set('force:a',{id:'force:a',operationId:'held',kind:'force',subjectId:'a'});s.operationClaims.set('force:b',{id:'force:b',operationId:'held',kind:'force',subjectId:'b'});observeSources(s,'me');s.strategicAttention.capacity=6;observeSources(s,'me');assert.ok(c.blocked);s.operationClaims.clear();observeSources(s,'me');assert.ok(!c.blocked);});
  test('Phase E: full construction bundle rearm ignores partial resource restoration',()=>{const s=world();s.territories.get('home')!.resourceOutput={food:5};const f=s.factions.get('me')!;f.resources.food=0;f.resources.gold=0;f.resources.wood=0;observeSources(s,'me');const c=[...s.aiPressure.values()].find(c=>c.domain==='DEVELOPMENT')!;assert.ok(c.blocked);f.resources.gold=1;observeSources(s,'me');assert.ok(c.blocked);f.resources.gold=10000;observeSources(s,'me');assert.ok(c.blocked);f.resources.wood=10000;observeSources(s,'me');assert.ok(!c.blocked);});
  test('Phase E: pressure chooses context but never enters plan score',()=>{const s=world();s.territories.get('home')!.resourceOutput={food:5};s.factions.get('me')!.resources.food=0;observeSources(s,'me');for(const c of s.aiPressure.values())c.pressure=T.ready;const sorted=[...s.aiPressure.values()].filter(c=>!c.blocked).sort((a,b)=>comparePlanIds(a.id,b.id));sorted[1]!.pressure++;assert.strictEqual(readySource(s,'me')!.id,sorted[1]!.id);const c=sorted[0]!,before=sourceConcretePlans(s,c).map(p=>p.id);c.pressure=T.maximum;assert.deepStrictEqual(sourceConcretePlans(s,c).map(p=>p.id),before);});
  test('Phase E: unchanged blocked sources never enter full deliberation over many boundaries',()=>{const s=world();s.strategicAttention.capacity=0;const c=military(s);c.pressure=T.maximum;const m=emptyPressureMetrics();for(let i=0;i<1000;i++){accrueProactiveClocks(s,s.aiClock.nowMs+1000,'OFFLINE');prepareProactiveDecision(s,'me',m);}assert.strictEqual(m.deliberations,0);assert.strictEqual(s.operations.size,0);});
  test('Phase E: WAIT is exactly 2/60 seconds without a physical operation or reward',()=>{const s=waitState(),o=opportunity(s,'me');assert.strictEqual(o.primary!.timer!.onlineDurationMs,2000);assert.strictEqual(o.primary!.timer!.offlineDurationMs,60000);const before={...s.factions.get('me')!.resources};assert.strictEqual(occupiedAttention(s,'me'),0);assert.strictEqual(s.operationClaims.size,0);assert.strictEqual(s.operations.size,0);accrueProactiveClocks(s,59999,'OFFLINE');prepareProactiveDecision(s,'me');assert.strictEqual(o.primary!.phase,'waiting');finishWait(s);assert.strictEqual(o.primary,null);assert.ok(o.spacing);assert.deepStrictEqual(s.factions.get('me')!.resources,before);assert.strictEqual(s.worldTick,0);});
  test('Phase E: valid WAIT relieves only its context and starts spacing',()=>{const s=waitState();s.territories.get('home')!.resourceOutput={food:5};s.factions.get('me')!.resources.food=0;observeSources(s,'me');const unrelated=[...s.aiPressure.values()].find(c=>c.domain==='DEVELOPMENT')!;unrelated.pressure=9000;const relevant=s.aiPressure.get(opportunity(s,'me').primary!.contextId)!;const before=relevant.pressure;finishWait(s);assert.ok(relevant.pressure>=before-T.waitRelief);assert.strictEqual(unrelated.pressure,9120);assert.ok(opportunity(s,'me').spacing);});
  test('Phase E: WAIT source disappearance invalidates without relief/spacing',()=>{const s=waitState();s.territories.get('target')!.owner='me';finishWait(s);assert.strictEqual(opportunity(s,'me').lastOutcome,'CONTEXT_INVALIDATED');assert.strictEqual(opportunity(s,'me').spacing,null);});
  test('Phase E: WAIT material transformation invalidates without relief/spacing',()=>{const s=waitState();s.territories.get('target')!.garrison+=100;finishWait(s);assert.strictEqual(opportunity(s,'me').lastOutcome,'CONTEXT_INVALIDATED');assert.strictEqual(opportunity(s,'me').spacing,null);});
  test('Phase E: WAIT losing non-WAIT feasibility installs blockers without spacing',()=>{const s=waitState();s.strategicAttention.capacity=0;finishWait(s);assert.strictEqual(opportunity(s,'me').lastOutcome,'NO_ACTIONABLE_PLAN');assert.strictEqual(opportunity(s,'me').spacing,null);assert.ok([...s.aiPressure.values()][0]!.blocked);});
  test('Phase E: WAIT completion consumes no second selection RNG or scoring',()=>{const s=waitState();const old=ActionScorer.prototype.scorePlans;ActionScorer.prototype.scorePlans=()=>{throw new Error('completion rescored');};try{finishWait(s);assert.ok(opportunity(s,'me').spacing);}finally{ActionScorer.prototype.scorePlans=old;}});
  test('Phase E: WAIT reload retains exact duration, earned work and timer sequence',()=>{const s=waitState();accrueProactiveClocks(s,12345,'OFFLINE');const loaded=hydratePersistedPayload(encodePersistable(s));assert.deepStrictEqual(loaded.aiDecisionOpportunities,s.aiDecisionOpportunities);finishWait(s);finishWait(loaded);assert.deepStrictEqual(loaded.aiDecisionOpportunities,s.aiDecisionOpportunities);});
  test('Phase E: rational duration promotes online and never demotes offline',()=>{let p=beginDurationProgress(0,'OFFLINE',30);p=accrueDurationProgress(p,30000,'OFFLINE');assert.strictEqual(durationRemainingMs(p,2000,'OFFLINE'),30000);p=accrueDurationProgress(p,30000,'ONLINE');assert.strictEqual(durationRemainingMs(p,2000,'OFFLINE'),1000);p=accrueDurationProgress(p,30999,'OFFLINE');assert.strictEqual(p.achievedRate,'ONLINE');assert.strictEqual(durationRemainingMs(p,2000,'OFFLINE'),1);});
  test('Phase E: seeded spacing samples once in locked online/offline ranges',()=>{const s=world();const t=startProactiveTimer(s,'me','spacing',45000,75000,100);assert.ok(t.onlineDurationMs>=45000&&t.onlineDurationMs<=75000);assert.ok(t.offlineDurationMs>=4500000&&t.offlineDurationMs<=7500000);const copy=hydratePersistedPayload(encodePersistable({...s,aiDecisionOpportunities:new Map([['me',{...opportunity(s,'me'),spacing:t}]])}));assert.deepStrictEqual(opportunity(copy,'me').spacing,t);});
  test('Phase E: physical operation completion cannot begin or reroll spacing',()=>{const s=world();primeSourceDecision(s,'me');const o=new Orchestrator(s);const d=o.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'}));const ids=d.payload.selectedOperationIds as string[];assert.strictEqual(ids.length,1);assert.ok(o.execute(cmdReq('RESOLVE_COMMITMENT','ai',{operationId:ids[0],factionId:'me'})).success);const before=opportunity(o.getState(),'me').spacing;const copy=cloneGameState(o.getState());settleOperation(copy,ids[0]!,'failed','test');assert.deepStrictEqual(opportunity(copy,'me').spacing,before);});
  test('Phase E: direct WAIT operation is rejected and cannot bypass source/timer contract',()=>{const s=world();const c=military(s);const w=sourceConcretePlans(s,c).find(p=>p.action==='WAIT')!;const o=new Orchestrator(s);assert.strictEqual(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:w})).success,false);assert.deepStrictEqual(o.getState(),s);});
  test('Phase E: same-boundary retries cannot create a second primary thought',()=>{const s=world(),c=military(s);c.pressure=T.ready;const o=new Orchestrator(s);for(let i=0;i<10;i++)assert.ok(o.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'})).success);assert.strictEqual(opportunity(o.getState(),'me').nextTimerSequence,1);assert.strictEqual(o.getState().operations.size,0);});
  test('Phase E: reversed Map order gives identical sources, candidates and chosen context',()=>{const a=world(),b=cloneGameState(a);b.armies=new Map([...b.armies].reverse());b.territories=new Map([...b.territories].reverse());b.factions=new Map([...b.factions].reverse());observeSources(a,'me');observeSources(b,'me');assert.deepStrictEqual([...a.aiPressure.keys()],[...b.aiPressure.keys()]);assert.deepStrictEqual(sourceConcretePlans(a,military(a)),sourceConcretePlans(b,military(b)));});
  test('Phase E: schema-20 migration preserves physical claims but archives contextless selections',()=>{const s=world();const plans=sourceConcretePlans(s,military(s));const o=new Orchestrator(s);const p=plans.find(p=>p.action==='MOVE')!;assert.ok(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:p})).success);const old=cloneGameState(o.getState());old.schemaVersion=20;const before=encodePersistable(old.armies),claims=encodePersistable(old.operationClaims);const loaded=hydratePersistedPayload(encodePersistable(old));assert.strictEqual(loaded.schemaVersion,27);assert.deepStrictEqual(encodePersistable(loaded.armies),before);assert.deepStrictEqual(encodePersistable(loaded.operationClaims),claims);assert.strictEqual(loaded.aiPressure.size,0);});
  test('Phase E: canonical pressure and primary clocks clone without aliasing',()=>{const s=waitState(),c=cloneGameState(s);c.aiPressure.values().next().value!.pressure++;opportunity(c,'me').primary!.timer!.progress.rationalRemainder=2;assert.notDeepStrictEqual(c.aiPressure,s.aiPressure);assert.strictEqual(opportunity(s,'me').primary!.timer!.progress.rationalRemainder,0);});
  test('Phase E: corruption in source identity or duration clock is rejected',()=>{const s=waitState();[...s.aiPressure.values()][0]!.id='bad';assert.ok(checkGameStateInvariants(s).some(v=>v.code==='pressure.invalid_state'));});
  test('Phase E: eliminated factions do not observe, deliberate or wait',()=>{const s=world();s.factions.get('me')!.territories=[];s.factions.get('me')!.armies=[];assert.strictEqual(prepareProactiveDecision(s,'me'),null);assert.strictEqual(s.aiPressure.size,0);assert.strictEqual(s.operations.size,0);});
  test('Phase E/I: holdings alone without complementary demand do not fabricate Trade sources',()=>{const s=world();s.factions.get('me')!.resources.wood=0;s.factions.get('me')!.resources.gold=20000;observeSources(s,'me');assert.ok(![...s.aiPressure.values()].some(c=>c.domain==='TRADE_ECONOMIC'));});
  test('Phase E: real UTC WAIT completes between world ticks without moving the world',()=>{const s=waitState();accrueWorldThroughReceipt(s,0);const ctx=context(s);progressProactiveThrough(s,ctx,59999);assert.strictEqual(opportunity(s,'me').primary!.phase,'waiting');progressProactiveThrough(s,ctx,60000);assert.ok(opportunity(s,'me').spacing);assert.strictEqual(s.worldTick,0);});
  test('Phase E: online WAIT completes in exactly two seconds under authoritative leases',()=>{
    const s=waitState();s.gameplaySessionLeases=[openGameplaySessionLease({sessionId:'online',receiptMs:0,openedByRequestId:'open'})];
    const ctx=context(s);progressProactiveThrough(s,ctx,1999);assert.strictEqual(opportunity(s,'me').primary!.phase,'waiting');
    progressProactiveThrough(s,ctx,2000);assert.strictEqual(opportunity(s,'me').primary,null);assert.ok(opportunity(s,'me').spacing);
    assert.strictEqual(opportunity(s,'me').spacing!.progress.achievedRate,'ONLINE');assert.strictEqual(s.worldTick,0);
  });
  test('Phase E: WAIT online promotion preserves earned offline work and survives logout/reload',()=>{
    const s=waitState();const ctx=context(s);progressProactiveThrough(s,ctx,30000);
    s.gameplaySessionLeases=[{...openGameplaySessionLease({sessionId:'promotion',receiptMs:30000,openedByRequestId:'open'}),endedAtMs:30001}];
    progressProactiveThrough(s,ctx,30001);const loaded=hydratePersistedPayload(encodePersistable(s));
    progressProactiveThrough(loaded,context(loaded),30999);assert.strictEqual(opportunity(loaded,'me').primary!.phase,'waiting');
    progressProactiveThrough(loaded,context(loaded),31000);assert.ok(opportunity(loaded,'me').spacing);assert.strictEqual(loaded.worldTick,0);
  });
  test('Phase E: rational activity projection preserves work and sub-millisecond carry',()=>{
    const temporal=require('../src/world/temporalBoundaries') as typeof import('../src/world/temporalBoundaries');
    let chunked=beginDurationProgress(0,'OFFLINE',30);for(let i=1;i<=99;i++)chunked=accrueDurationProgress(chunked,i,'OFFLINE');
    const projected=temporal.projectActionProgress(beginDurationProgress(0,'OFFLINE',30),[{startMs:0,endMs:99,presence:'OFFLINE'}]);
    assert.deepStrictEqual(chunked,projected);assert.strictEqual(projected.offlineDivisor,30);
  });
  test('Phase E: receipt-driven catch-up equals fine world boundaries and reload',()=>{
    const initial=world();accrueWorldThroughReceipt(initial,0);
    initial.gameplaySessionLeases=[0,80000,160000,240000].map((at,i)=>openGameplaySessionLease({sessionId:`lease${i}`,receiptMs:at,openedByRequestId:`open${i}`}));
    const coarse=cloneGameState(initial);accrueWorldThroughReceipt(coarse,300000);catchUpWorld(coarse,context(coarse),coarse.accruedTargetWorldTick);
    let fine=cloneGameState(initial);for(let at=60000;at<=300000;at+=60000){accrueWorldThroughReceipt(fine,at);catchUpWorld(fine,context(fine),fine.accruedTargetWorldTick);fine=hydratePersistedPayload(encodePersistable(fine));}
    assert.strictEqual(coarse.worldTick,5);assert.ok(coarse.operations.size>0,'real source must produce an exact physical operation');
    assert.deepStrictEqual(encodePersistable(coarse),encodePersistable(fine));
  });
  test('Phase E: a failed exact initiation grants no relief or reconsideration spacing',()=>{
    const s=world();primeSourceDecision(s,'me');const o=new Orchestrator(s);const d=o.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'}));
    const id=(d.payload.selectedOperationIds as string[])[0]!,op=o.getState().operations.get(id)!;assert.ok(op);
    const draft=cloneGameState(o.getState());if(op.plan!.action==='BUILD')draft.factions.get('me')!.resources.gold=0;
    else if('armyId' in op.plan!){const armyId=op.plan!.armyId;draft.armies.delete(armyId);draft.factions.get('me')!.armies=draft.factions.get('me')!.armies.filter(id=>id!==armyId);}
    const pressure=[...draft.aiPressure].map(([id,c])=>[id,c.pressure]);const retry=new Orchestrator(draft);
    assert.strictEqual(retry.execute(cmdReq('RESOLVE_COMMITMENT','ai',{operationId:id,factionId:'me'})).success,false);
    assert.deepStrictEqual([...retry.getState().aiPressure].map(([id,c])=>[id,c.pressure]),pressure);
    assert.strictEqual(opportunity(retry.getState(),'me').spacing,null);assert.strictEqual(retry.getState().operationClaims.size,0);
  });
  test('Phase E: Goal accelerates an existing source without consulting raw Memory',()=>{
    const a=world(),b=cloneGameState(a),ca=military(a),cb=military(b);
    b.factions.get('me')!.goals=[{id:'goal',type:'destroy_rival',priority:100,targetFaction:'enemy',targetTerritory:null,targetRegion:null,targetResource:null,progress:0,targetProgress:1,deadlineTurn:null,createdTurn:0}];
    accrueSourcePressure(a,1000,'ONLINE');accrueSourcePressure(b,1000,'ONLINE');assert.ok(cb.pressure>ca.pressure);
    const previous=cb.pressure;b.factions.get('me')!.memory=[{id:'history',type:'action_failed',turn:0,magnitude:99999,withFaction:'enemy',territory:'target',details:{}}];
    accrueSourcePressure(b,1000,'ONLINE');assert.strictEqual(cb.pressure-previous,previous);
  });
  test('Phase E: no-action outcome is canonical blocker state, never a ninth action',()=>{
    const s=world();s.strategicAttention.capacity=0;const c=military(s);assert.strictEqual(c.cognitionOutcome,'NO_ACTIONABLE_PLAN');
    assert.ok(c.blockers.length>0);assert.deepStrictEqual(sourceConcretePlans(s,c),[]);assert.strictEqual(s.operations.size,0);
    const loaded=hydratePersistedPayload(encodePersistable(s));assert.deepStrictEqual(loaded.aiPressure,s.aiPressure);
  });
  test('Phase E: inactive faction pressure and unfinished cognition stop without fake WAIT',()=>{
    const s=waitState();s.factions.get('me')!.territories=[];s.factions.get('me')!.armies=[];const before=[...s.aiPressure.values()][0]!.pressure;
    accrueSourcePressure(s,100000,'ONLINE');assert.strictEqual([...s.aiPressure.values()][0]!.pressure,before);
    prepareProactiveDecision(s,'me');assert.strictEqual(s.aiPressure.size,0);assert.strictEqual(opportunity(s,'me').primary,null);
    assert.strictEqual(opportunity(s,'me').spacing,null);assert.strictEqual(s.operations.size,0);
  });
  test('Phase E: trusted server receipts advance sub-tick cognition but client timestamps cannot',()=>{
    const s=waitState();accrueWorldThroughReceipt(s,0);const o=new Orchestrator(s);
    const req=cmdReq('SET_PLAYER_PAUSE','ai',{paused:true});req.playerId=s.playerFactionId!;req.timestamp=999999999;
    assert.ok(o.executeAtAuthoritativeReceipt(req,59999).success);assert.strictEqual(opportunity(o.getState(),'me').primary!.phase,'waiting');
    assert.ok(o.executeAtAuthoritativeReceipt({...req,requestId:'second'},60000).success);assert.ok(opportunity(o.getState(),'me').spacing);
    assert.strictEqual(o.getState().worldTick,0);assert.strictEqual(o.getState().lastAccrualAtMs,60000);
  });
  test('Phase E: operation source binding cannot suppress or relieve another faction source',()=>{
    const s=world();primeSourceDecision(s,'me');const o=new Orchestrator(s);
    assert.ok(o.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'})).success);
    const op=[...o.getState().operations.values()].find(op=>op.sourceContextId)!;assert.ok(op);
    const original=op.sourceContextId!;
    const parts=JSON.parse(original.slice('source:v1:'.length));parts[0]='enemy';
    op.sourceContextId=`source:v1:${JSON.stringify(parts)}`;
    assert.ok(checkGameStateInvariants(o.getState()).some(v=>v.code==='operation.invalid_source_binding'));
    op.sourceContextId=original;assert.ok(!checkGameStateInvariants(o.getState()).some(v=>v.code==='operation.invalid_source_binding'));
    const thread=opportunity(o.getState(),'me').primary!;assert.ok(thread);
    thread.contextId=`source:v1:${JSON.stringify(parts)}`;
    assert.ok(checkGameStateInvariants(o.getState()).some(v=>v.message==='Primary thread owned by another or invalid source'));
  });
  test('Phase E review: pressure magnitude never changes scores inside a chosen context',()=>{
    const a=world();primeSourceDecision(a,'me');const b=cloneGameState(a);
    for(const c of b.aiPressure.values())c.pressure=T.maximum;
    const captured:unknown[]=[];const score=ContextPlanComparator.prototype.compare;
    ContextPlanComparator.prototype.compare=function(...args){const r=score.apply(this,args);captured.push(r);return r;};
    try{handleAiDecide(a,context(a));handleAiDecide(b,context(b));}finally{ContextPlanComparator.prototype.compare=score;}
    assert.strictEqual(captured.length,2);assert.deepStrictEqual(captured[0],captured[1]);
  });
  test('Phase E review: a changed defending force invalidates a stale WAIT without relief',()=>{
    const s=waitState();const c=military(s),before=c.pressure;
    s.armies.set('defender',{id:'defender',owner:'enemy',location:'target',soldiers:200,knights:0,siegeEngines:0,morale:80,supply:80});
    s.factions.get('enemy')!.armies.push('defender');finishWait(s);
    assert.strictEqual(opportunity(s,'me').lastOutcome,'CONTEXT_INVALIDATED');assert.strictEqual(opportunity(s,'me').spacing,null);
    assert.ok(c.pressure>=before);assert.ok(s.aiPressure.has(c.id));
  });
  test('Phase E review: dormant blocked contexts reuse exact predicates while checking fresh facts',()=>{
    const s=world();s.strategicAttention.capacity=0;const c=military(s),old=c.blockers.map(b=>b.plan);
    for(let i=0;i<100;i++){s.factions.get('me')!.resources.gold++;observeSources(s,'me');}
    assert.ok(c.blocked);assert.strictEqual(c.blockers.length,old.length);
    c.blockers.forEach((b,i)=>assert.strictEqual(b.plan,old[i]));
    s.strategicAttention.capacity=T.maximum;observeSources(s,'me');assert.ok(!c.blocked);
  });
  test('Phase E review: same-instant force arrival precedes WAIT revalidation',()=>{
    let s=world();s.armies.set('threat',{id:'threat',owner:'enemy',location:'target',soldiers:200,knights:0,siegeEngines:0,morale:80,supply:80});
    s.factions.get('enemy')!.armies.push('threat');accrueWorldThroughReceipt(s,0);
    const o=new Orchestrator(s);assert.ok(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:makeConcretePlan({action:'MOVE',factionId:'me',armyId:'b',originTerritoryId:'home',destinationTerritoryId:'stage',route:['home','stage']})})).success);
    s=cloneGameState(o.getState());accrueWorldThroughReceipt(s,600000);catchUpWorld(s,context(s),1);
    accrueWorldThroughReceipt(s,1140000);catchUpWorld(s,context(s),1);
    observeSources(s,'me');const c=[...s.aiPressure.values()].find(c=>c.kind==='COVERAGE_GAP'&&c.subjectId==='stage')!;assert.ok(c&&!c.blocked);
    c.pressure=T.ready;prepareProactiveDecision(s,'me');const p=opportunity(s,'me').primary!;assert.strictEqual(p.contextId,c.id);
    p.phase='selected';p.timer=null;selectWaitInitiation(s,'me');assert.strictEqual(timerRemaining(s,p.timer!),60000);
    accrueWorldThroughReceipt(s,1200000);catchUpWorld(s,context(s),2);
    assert.strictEqual(s.armies.get('b')!.location,'stage');assert.strictEqual(opportunity(s,'me').lastOutcome,'CONTEXT_INVALIDATED');
    assert.strictEqual(opportunity(s,'me').spacing,null);assert.ok(!s.aiPressure.has(c.id));
  });
  test('Phase E review: food-cycle source creation is independent of catch-up chunk size',()=>{
    const initial=world();initial.worldLevel=2;initial.territories.get('target')!.baseValue=0;
    initial.territories.get('home')!.resourceOutput={food:5};initial.factions.get('me')!.resources.food=4;
    accrueWorldThroughReceipt(initial,0);const coarse=cloneGameState(initial);
    accrueWorldThroughReceipt(coarse,70*600000);catchUpWorld(coarse,context(coarse),70);
    let fine=cloneGameState(initial);for(let t=1;t<=70;t++){accrueWorldThroughReceipt(fine,t*600000);catchUpWorld(fine,context(fine),t);}
    assert.ok(fine.operations.size>0,'real Food need should cause a BUILD');
    assert.deepStrictEqual(encodePersistable(coarse.aiPressure),encodePersistable(fine.aiPressure));
    assert.deepStrictEqual(encodePersistable(coarse.operations),encodePersistable(fine.operations));
    assert.deepStrictEqual(encodePersistable(coarse.aiDecisionOpportunities),encodePersistable(fine.aiDecisionOpportunities));
  });
  test('Phase E review: a real military source acts while saturated blocked development stays dormant',()=>{
    const s=world();s.worldLevel=2;s.territories.get('home')!.resourceOutput={food:5};
    s.factions.get('me')!.resources.food=0;s.factions.get('me')!.resources.wood=0;
    accrueWorldThroughReceipt(s,0);observeSources(s,'me');
    const build=[...s.aiPressure.values()].find(c=>c.domain==='DEVELOPMENT')!;assert.ok(build.blocked);
    assert.ok(![...s.aiPressure.values()].some(c=>c.domain==='DIPLOMACY_PEACE'));
    const scored:string[][]=[];const score=ContextPlanComparator.prototype.compare;
    ContextPlanComparator.prototype.compare=function(...args){scored.push(args[2].map(p=>p.action));return score.apply(this,args);};
    try{accrueWorldThroughReceipt(s,100*600000);catchUpWorld(s,context(s),100);}finally{ContextPlanComparator.prototype.compare=score;}
    assert.ok(scored.length>0);assert.ok(scored.every(actions=>actions.every(a=>['ATTACK','MOVE','WAIT'].includes(a))));
    assert.ok([...s.operations.values()].some(op=>['ATTACK','MOVE'].includes(op.action)));
    assert.ok(![...s.operations.values()].some(op=>op.action==='BUILD'));
    const blocked=s.aiPressure.get(build.id)!;assert.ok(blocked.blocked);assert.strictEqual(blocked.pressure,T.maximum);
    assert.ok(![...s.aiPressure.values()].some(c=>c.domain==='DIPLOMACY_PEACE'));
  });
  test('Phase E review: new command effects follow an already-earned WAIT boundary',()=>{
    const s=world();s.armies.delete('b');s.factions.get('me')!.armies=['a'];accrueWorldThroughReceipt(s,0);
    const c=military(s);c.pressure=T.ready;prepareProactiveDecision(s,'me');const p=opportunity(s,'me').primary!;
    p.phase='selected';p.timer=null;selectWaitInitiation(s,'me');const o=new Orchestrator(s);
    const request=cmdReq('START_AI_OPERATION','ai',{plan:makeConcretePlan({action:'MOVE',factionId:'me',armyId:'a',originTerritoryId:'home',destinationTerritoryId:'stage',route:['home','stage']})});
    const result=o.executeAtAuthoritativeReceipt(request,60000);assert.ok(result.success,JSON.stringify(result.errors));
    assert.ok(opportunity(o.getState(),'me').spacing,'WAIT must see the force before the new command claims it');
    assert.ok(o.getState().armies.get('a')!.movement);assert.strictEqual(o.getState().worldTick,0);
  });
  test('Phase E review: schema-20 archival preserves simultaneous physical work and consumed IDs',()=>{
    const s=world();const o=new Orchestrator(s);const move=sourceConcretePlans(s,military(s)).find(p=>p.action==='MOVE')!;
    assert.ok(o.execute(cmdReq('START_AI_OPERATION','ai',{plan:move})).success);const active=cloneGameState(o.getState());
    primeSourceDecision(active,'me');const next=new Orchestrator(active);assert.ok(next.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'})).success);
    const old=cloneGameState(next.getState());const selected=[...old.operations.values()].filter(op=>op.phase==='selected');assert.strictEqual(selected.length,1);
    const sequence=old.factions.get('me')!.nextAiCommitmentSequence;const claims=encodePersistable(old.operationClaims),armies=encodePersistable(old.armies);
    old.schemaVersion=20;const loaded=hydratePersistedPayload(encodePersistable(old));
    assert.deepStrictEqual(encodePersistable(loaded.operationClaims),claims);assert.deepStrictEqual(encodePersistable(loaded.armies),armies);
    assert.strictEqual(loaded.factions.get('me')!.nextAiCommitmentSequence,sequence);
    assert.strictEqual(loaded.operations.get(selected[0]!.id)!.phase,'terminal');assert.strictEqual(loaded.aiPressure.size,0);
    assert.strictEqual(opportunity(loaded,'me').primary,null);prepareProactiveDecision(loaded,'me');
    assert.strictEqual(opportunity(loaded,'me').primary,null,'migration must not invent ready pressure');
    assert.deepStrictEqual(checkGameStateInvariants(loaded),[]);
  });
  test('Phase E review: orphan selected threads and malformed blocker entries fail validation',()=>{
    const s=world();primeSourceDecision(s,'me');const o=new Orchestrator(s);assert.ok(o.execute(cmdReq('AI_DECIDE','ai',{warlordId:'me'})).success);
    const broken=cloneGameState(o.getState());opportunity(broken,'me').primaryOperationId=null;
    assert.ok(checkGameStateInvariants(broken).some(v=>v.message==='Selected primary thread lacks its exact source-bound operation'));
    const blocked=world();blocked.strategicAttention.capacity=0;const c=military(blocked);
    (c.blockers as unknown[]).push(null);assert.ok(checkGameStateInvariants(blocked).some(v=>v.message.startsWith('Invalid complete-candidate blocker')));
  });
  test('Phase E review: public game state does not disclose pressure, predicates or cognition timers',()=>{
    const s=waitState();const o=new Orchestrator(s);const result=o.execute(cmdReq('GET_GAME_STATE',s.playerFactionId!));assert.ok(result.success);
    const publicJson=JSON.stringify(result.payload);
    for(const privateKey of ['aiPressure','aiClock','aiDecisionOpportunities','source:v1:','opportunity:v1:','pressureRemainder','materialSignature'])assert.ok(!publicJson.includes(privateKey),privateKey);
  });
  test('Phase E review: seeded duration authoring uses whole-second canonical precision',()=>{
    const s=world();for(let i=0;i<20;i++){
      const t=startProactiveTimer(s,'me','spacing',TIME.spacingOnlineMinMs,TIME.spacingOnlineMaxMs,TIME.spacingOfflineDivisor);
      assert.strictEqual(t.onlineDurationMs%1000,0);assert.strictEqual(t.offlineDurationMs%1000,0);
    }
    const before=opportunity(s,'me').nextTimerSequence;
    assert.throws(()=>startProactiveTimer(s,'me','invalid',6001,10000,50));
    assert.strictEqual(opportunity(s,'me').nextTimerSequence,before);
  });

}
