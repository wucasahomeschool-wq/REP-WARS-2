import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {beginWorkoutSession, getCurrentExercise} from '../src/fitness/session';
import {initializePlayerWorld} from '../src/persistence/initializePlayerWorld';
import {InMemoryGameStateStore} from '../src/persistence/inMemoryGameStateStore';
import {createInMemoryPersistence, PlayerWorldPersistence} from '../src/server/persistencePort';
import {createSessionHost, PersistenceFailedError} from '../src/server/session';
import {createCommandHttpServer} from '../src/server/http';
import {snapshotGameState} from '../src/persistence/snapshot';
import {checkGameStateInvariants} from '../src/state/gameStateInvariants';
import {CommandRequest, CommandResponse} from '../src/orchestration/protocol';
import {GameState} from '../src/types/GameState';
import {makeConcretePlan} from '../src/types/AIConcretePlan';
import {beginArmyMovement} from '../src/army/movement';
import {fixtureCommitments} from './aiOperationFixtures';
import {applyPlayerTerritoryLoss} from '../src/gameplay/anchors';
import {serializeLevel1TutorialView} from '../src/gameplay/tutorial/level1';

const PLAYER = 'phase2-player';
const HOME = 't_02', FIRST = 't_01', FINAL = 't_03';
/** Explicit migration-compatible fixture: an already-active legacy catalog
 * workout. No reward or tutorial flag is seeded. Phase 4 owns fresh production
 * catalog activation; these tests do not invent a world ratio or catalog. */
function legacySession(state: GameState, id: string) {
  const created = beginWorkoutSession({playerId: PLAYER, purpose: 'NORMAL_TROOPS',
    workoutId: 'wk_hard_full_body_basics', intendedDifficulty: 'HARD', sessionId: id, now: 0});
  assert(created.ok); state.playerFitness.activeSession = created.value;
}
function fixture(seed = 11) {
  const state = initializePlayerWorld({playerId: PLAYER, seed}).state;
  legacySession(state, 'phase2-first-legacy');
  const store = new InMemoryGameStateStore(); assert(store.save(PLAYER, state, 0).ok);
  const persistence = createInMemoryPersistence(store);
  let host = createSessionHost(persistence, {nowMs: () => 0}), next = 0;
  const load = () => {const r = store.load(PLAYER); assert(r.ok); return r;};
  const request = (commandId: string, parameters: Record<string, unknown> = {}): CommandRequest => ({
    commandId, parameters, playerId: PLAYER, requestId: `p2-${++next}`, worldAttempt: load().state.worldAttempt,
  });
  const execute = (req: CommandRequest) => host.execute(req);
  const send = (commandId: string, parameters: Record<string, unknown> = {}) => execute(request(commandId, parameters));
  const reload = () => {host = createSessionHost(persistence, {nowMs: () => 0});};
  return {store, persistence, load, request, execute, send, reload, get host() {return host;}};
}
type Fixture = ReturnType<typeof fixture>;
type Send = (commandId: string, parameters?: Record<string, unknown>) => Promise<CommandResponse>;
function success(r: CommandResponse) {assert.equal(r.success, true, JSON.stringify(r.errors)); return r;}
async function finish(f: Fixture, send: Send = f.send, feedback = false) {
  while (f.load().state.playerFitness.activeSession?.state === 'ACTIVE') {
    const step = getCurrentExercise(f.load().state.playerFitness.activeSession!)!;
    success(await send('RECORD_EXERCISE', {order: step.order, ...(step.prescription.kind === 'repetitions'
      ? {repetitions: step.prescription.repetitions} : {durationSeconds: step.prescription.durationSeconds})}));
  }
  if (feedback) success(await send('SUBMIT_WORKOUT_FEEDBACK', {value: 'ABOUT_RIGHT'}));
  return success(await send('FINALIZE_WORKOUT'));
}
/** Earn through the real legacy pipeline, then deploy only the excess so the
 * audit's exact remaining bank of 500 is reached without creating/removing troops. */
async function ready(f: Fixture, send: Send = f.send) {
  await finish(f, send);
  const earned = f.load().state.playerRewards.bankedTroops;
  assert(earned >= 500, `legacy fixture earned ${earned}`);
  if (earned > 500) success(await send('DEPLOY_TROOPS', {territoryId: HOME, quantity: earned - 500}));
  assert.equal(f.load().state.playerRewards.bankedTroops, 500);
  assert.equal(f.load().state.level1Tutorial!.beat, 'FIRST_ATTACK_AVAILABLE');
  return earned;
}
function troops(s: GameState) {
  return s.playerRewards.bankedTroops + [...s.armies.values()].filter(a => a.owner === s.playerFactionId)
    .reduce((n,a) => n+a.soldiers+a.knights+a.siegeEngines, 0)
    + [...s.territories.values()].filter(t => t.owner === s.playerFactionId).reduce((n,t) => n+t.garrison, 0);
}
function invariant(f: Fixture) {assert.deepEqual(checkGameStateInvariants(f.load().state), []);}

// Explicit physical-state fixtures for unavailable-force and defeat cases only.
// They neither grant troops nor change tutorial progression flags.
function editFixture(f: Fixture, edit: (state: GameState) => void) {
  const loaded = f.load(); edit(loaded.state);
  assert.deepEqual(checkGameStateInvariants(loaded.state), []);
  assert(f.store.save(PLAYER, loaded.state, loaded.record.stateVersion).ok); f.reload();
}
function reserve(state: GameState, armyId: string) {
  beginArmyMovement(state, {factionId:'f_player',armyId,destinationTerritoryId:FIRST});
  fixtureCommitments(state).set('f_player', {
    id: 'phase2-reserved-operation', warlordId: 'f_player', action: 'MOVE', targetId: FIRST,
    targetName: null, status: 'executing', createdTurn: state.turn, originatingGoalId: null,
    reason: [], priority: 1, score: 1, confidence: 1, personalityBias: 0, ambitionInfluence: 0,
    factorBreakdown: [], statusReason: null,
    plan: makeConcretePlan({action:'MOVE', factionId:'f_player', armyId,
      originTerritoryId:HOME, destinationTerritoryId:FIRST, route:[HOME,FIRST]}),
  });
  state.armies.get(armyId)!.movement!.commitmentId='phase2-reserved-operation';
}
async function defense(f: Fixture, send: Send = f.send) {
  const id = f.load().state.level1Tutorial!.scriptedInvasionId!;
  success(await send('START_WORKOUT', {purpose: 'DEFENSE', invasionId: id}));
  await finish(f, send, true);
  assert.equal(f.load().state.level1Tutorial!.beat, 'FINAL_WORKOUT_PENDING');
}
async function finalWorkout(f: Fixture, send: Send = f.send) {
  // Second legacy-active-session fixture: fresh normal catalog activation is Phase 4.
  editFixture(f, s => legacySession(s, 'phase2-final-legacy'));
  await finish(f, send, true);
  assert.equal(f.load().state.level1Tutorial!.beat, 'FINAL_ATTACK_AVAILABLE');
}
async function withHttp(f: Fixture, run: (send: Send, execute: (r:CommandRequest)=>Promise<CommandResponse>)=>Promise<void>) {
  const server = createCommandHttpServer({...f.host, execute: r => f.execute(r)}, {
    identity: {mode: 'authenticated', authenticate: () => PLAYER},
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); assert(address && typeof address === 'object');
    const execute = (body: CommandRequest) => new Promise<CommandResponse>((resolve, reject) => {
      const req = httpRequest({host:'127.0.0.1', port:address.port, path:'/commands', method:'POST', agent:false,
        headers:{'content-type':'application/json', connection:'close'}}, res => {
        let data=''; res.setEncoding('utf8'); res.on('data', chunk=>data+=chunk);
        res.on('end', ()=>{try {resolve(JSON.parse(data));}catch(e){reject(e);}});
      });
      req.on('error',reject); req.end(JSON.stringify(body));
    });
    await run((id, params={})=>execute(f.request(id,params)), execute);
  } finally {await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
}

export async function runTutorialDeployedForceTests(report: (name:string, fn:()=>void|Promise<void>)=>Promise<void>) {
  await report('Phase 2: full bank500 deployment can use the selected existing force for the first conquest', async () => {
    const f = fixture(); await ready(f); const before = troops(f.load().state);
    const deploy = success(await f.send('DEPLOY_TROOPS', {territoryId: HOME, quantity: 500}));
    assert.equal(f.load().state.playerRewards.bankedTroops, 0); assert.equal(troops(f.load().state), before);
    const attack = await f.send('ATTACK', {territoryId: FIRST, onlyArmyId: deploy.payload.armyId});
    if (!attack.success) console.log('PRE_FIX_REPRODUCTION', JSON.stringify({bank: f.load().state.playerRewards.bankedTroops,
      selectedArmy: deploy.payload.armyId, tutorial: serializeLevel1TutorialView(f.load().state), errors: attack.errors}));
    success(attack); assert.equal(f.load().state.territories.get(FIRST)!.owner, 'f_player');
    assert.equal(f.load().state.level1Tutorial!.beat, 'DEFENSE_PENDING');
    assert.equal(f.load().state.activeInvasions.size, 1); invariant(f);
  });
  await report('Phase 2: original bank attack works without prior deployment', async () => {
    const f=fixture(); await finish(f); const before=troops(f.load().state), bank=f.load().state.playerRewards.bankedTroops;
    success(await f.send('ATTACK',{territoryId:FIRST,commitAmount:120}));
    assert.equal(f.load().state.playerRewards.bankedTroops,bank-120);
    assert.equal(troops(f.load().state),before); assert.equal(f.load().state.level1Tutorial!.beat,'DEFENSE_PENDING'); invariant(f);
  });
  for(const bankAttack of [false,true]) await report(`Phase 2: partial deployment preserves ${bankAttack?'bank':'selected deployed'} attack`,async()=>{
    const f=fixture();await ready(f);const d=success(await f.send('DEPLOY_TROOPS',{territoryId:HOME,quantity:200}));
    const before=troops(f.load().state);
    success(await f.send('ATTACK',{territoryId:FIRST,...(bankAttack?{commitAmount:120}:{onlyArmyId:d.payload.armyId})}));
    assert.equal(f.load().state.playerRewards.bankedTroops,bankAttack?180:300);assert.equal(troops(f.load().state),before);invariant(f);
  });
  await report('Phase 2: explicit selected force leaves other eligible armies untouched',async()=>{
    const f=fixture();await ready(f);const d=success(await f.send('DEPLOY_TROOPS',{territoryId:HOME,quantity:500}));
    const others=[...f.load().state.armies.values()].filter(a=>a.owner==='f_player'&&a.id!==d.payload.armyId);
    assert(others.length>=2);assert.equal(serializeLevel1TutorialView(f.load().state).nextActionAllowed,true);
    success(await f.send('ATTACK',{territoryId:FIRST,onlyArmyId:d.payload.armyId}));
    for(const a of others)assert.deepEqual(f.load().state.armies.get(a.id),a);
    assert.equal(f.load().state.armies.get(String(d.payload.armyId))!.location,FIRST);invariant(f);
  });
  for(const kind of ['missing','enemy','too-small','moving','reserved','wrong-origin'] as const) {
    await report(`Phase 2: ${kind} selected force is rejected without military effects`,async()=>{
      const f=fixture();await ready(f);
      const d=success(await f.send('DEPLOY_TROOPS',{territoryId:HOME,quantity:kind==='too-small'?100:500}));
      let id=String(d.payload.armyId);
      if(kind==='missing')id='missing';
      if(kind==='enemy')id='army_1';
      if(kind==='moving')editFixture(f,s=>{beginArmyMovement(s,{factionId:'f_player',armyId:id,destinationTerritoryId:FIRST});});
      if(kind==='reserved')editFixture(f,s=>reserve(s,id));
      if(kind==='wrong-origin')editFixture(f,s=>{s.armies.get(id)!.location=FINAL;});
      const before=f.load().state, total=troops(before);
      const r=await f.send('ATTACK',{territoryId:FIRST,onlyArmyId:id,...(kind==='wrong-origin'?{stagingTerritoryId:FINAL}:{})});assert.equal(r.success,false);
      assert.notEqual(r.errors[0]?.code,'MISSING_PARAMETER');
      assert.equal(troops(f.load().state),total);assert.deepEqual(f.load().state.armies,before.armies);
      assert.deepEqual(f.load().state.operationClaims,before.operationClaims);
      assert.equal(f.load().state.level1Tutorial!.beat,'FIRST_ATTACK_AVAILABLE');assert.equal(f.load().state.activeInvasions.size,0);invariant(f);
    });
  }
  await report('Phase 2: genuinely absent attacking force reports military insufficiency',async()=>{
    const f=fixture();await ready(f);success(await f.send('DEPLOY_TROOPS',{territoryId:HOME,quantity:500}));
    // Explicit post-loss fixture, not a free troop grant or tutorial flag edit.
    editFixture(f,s=>{for(const a of s.armies.values())if(a.owner==='f_player')s.armies.delete(a.id);s.factions.get('f_player')!.armies=[];});
    assert.equal(serializeLevel1TutorialView(f.load().state).nextActionAllowed,false);
    const r=await f.send('ATTACK',{territoryId:FIRST});assert.equal(r.errors[0]?.code,'INSUFFICIENT_TROOPS');
    assert.equal(troops(f.load().state),0);invariant(f);
  });
  await report('Phase 2: a claimed sibling does not hide a legal force in the public availability view',async()=>{
    const f=fixture();await ready(f);const d=success(await f.send('DEPLOY_TROOPS',{territoryId:HOME,quantity:500}));
    editFixture(f,s=>reserve(s,String(d.payload.armyId)));
    const state=f.load().state,before=snapshotGameState(state);
    assert.equal(serializeLevel1TutorialView(state).nextActionAllowed,true);
    assert.deepEqual(snapshotGameState(state),before);
    success(await f.send('ATTACK',{territoryId:FIRST,onlyArmyId:'army_0'}));invariant(f);
  });
  await report('Phase 2: delayed attack initiation is not conquest and reload preserves its arrival milestone',async()=>{
    const f=fixture();await ready(f);const d=success(await f.send('DEPLOY_TROOPS',{territoryId:HOME,quantity:500}));
    const id=String(d.payload.armyId);
    // Explicit deployed-location fixture exercising the existing one-hop staging path.
    // Foreign-territory passage policy is unchanged (roadmap Phase 6).
    editFixture(f,s=>{s.armies.get(id)!.location=FINAL;});
    const before=troops(f.load().state);
    success(await f.send('ATTACK',{territoryId:FIRST,onlyArmyId:id,stagingTerritoryId:HOME}));
    assert.equal(f.load().state.level1Tutorial!.beat,'FIRST_ATTACK_AVAILABLE');
    assert.equal(f.load().state.activeInvasions.size,0);assert.equal(troops(f.load().state),before);
    const army=f.load().state.armies.get(id)!;assert.equal(army.movement!.status,'moving');
    const persisted=snapshotGameState(f.load().state);f.reload();success(await f.send('GET_GAME_STATE'));
    assert.deepEqual(snapshotGameState(f.load().state),persisted);
    const tick=army.movement!.startedAtTick+army.movement!.durationTicks;
    // No active lease: ten real minutes earn one simulation minute.
    const catchup=createSessionHost(f.persistence,{nowMs:()=>tick*600000});
    success(await catchup.execute(f.request('SYNC_PLAYER_WORLD')));
    assert.equal(f.load().state.territories.get(FIRST)!.owner,'f_player');
    assert.equal(f.load().state.level1Tutorial!.beat,'DEFENSE_PENDING');invariant(f);
  });
  await report('Phase 2: early stage and wrong first target retain tutorial restrictions',async()=>{
    const f=fixture();assert.equal((await f.send('ATTACK',{territoryId:FIRST,onlyArmyId:'army_0'})).errors[0]?.code,'ACTION_NOT_ALLOWED');
    await ready(f);assert.equal((await f.send('ATTACK',{territoryId:FINAL,onlyArmyId:'army_0'})).errors[0]?.code,'INVALID_TARGET');
    assert.equal((await f.send('START_WORKOUT',{purpose:'NORMAL_TROOPS'})).errors[0]?.code,'ACTION_NOT_ALLOWED');
    assert.equal(f.load().state.activeInvasions.size,0);assert.equal(f.load().state.level1Tutorial!.beat,'FIRST_ATTACK_AVAILABLE');invariant(f);
  });
  await report('Phase 2: save reload after full deployment and during scripted invasion preserves lifecycle',async()=>{
    const f=fixture();await ready(f);const d=success(await f.send('DEPLOY_TROOPS',{territoryId:HOME,quantity:500}));f.reload();
    success(await f.send('ATTACK',{territoryId:FIRST,onlyArmyId:d.payload.armyId}));
    const invasion=f.load().state.level1Tutorial!.scriptedInvasionId, before=snapshotGameState(f.load().state);f.reload();
    success(await f.send('GET_GAME_STATE'));assert.deepEqual(snapshotGameState(f.load().state),before);
    await defense(f);assert.equal(f.load().state.level1Tutorial!.scriptedInvasionId,invasion);invariant(f);
  });
  for(const command of ['DEPLOY_TROOPS','ATTACK'] as const) {
    await report(`Phase 2: ${command} retry after reload has one effect and rejects changed intent`,async()=>{
      const f=fixture();await ready(f);
      const req=f.request(command,command==='ATTACK'?{territoryId:FIRST,onlyArmyId:'army_0'}:{territoryId:HOME,quantity:500});
      const original=success(await f.execute(req)),before=snapshotGameState(f.load().state),saves=f.store.saveCount.value;f.reload();
      const replay=success(await f.execute(req));assert(replay.idempotentReplay);assert.deepEqual(replay.payload,JSON.parse(JSON.stringify(original.payload)));
      assert.equal(f.store.saveCount.value,saves);assert.deepEqual(snapshotGameState(f.load().state),before);
      const conflict=await f.execute({...req,parameters:{...req.parameters,...(command==='ATTACK'?{onlyArmyId:'army_1'}:{quantity:1})}});
      assert.equal(conflict.errors[0]?.code,'COMMAND_IDENTITY_CONFLICT');assert.deepEqual(snapshotGameState(f.load().state),before);invariant(f);
    });
    await report(`Phase 2: independent stale ${command} workers commit exactly once`,async()=>{
      const f=fixture();await ready(f);const workers=[createSessionHost(f.persistence,{nowMs:()=>0}),createSessionHost(f.persistence,{nowMs:()=>0})];
      await Promise.all(workers.map(h=>h.execute({commandId:'GET_GAME_STATE',playerId:PLAYER})));
      const req=f.request(command,command==='ATTACK'?{territoryId:FIRST,onlyArmyId:'army_0'}:{territoryId:HOME,quantity:500});
      const saves=f.store.saveCount.value,results=await Promise.all(workers.map(h=>h.execute(req)));
      results.forEach(success);assert.equal(results.filter(r=>r.idempotentReplay).length,1);assert.equal(f.store.saveCount.value,saves+1);invariant(f);
    });
    for(const after of [false,true])await report(`Phase 2: ${command} ${after?'lost acknowledgement':'failed commit'} retries without duplicate effects`,async()=>{
      const f=fixture();await ready(f);let fail=true;
      const port:PlayerWorldPersistence={...f.persistence,save(...args){
        if(fail&&!after){fail=false;throw new Error('phase2 before commit');}
        const r=f.persistence.save(...args);if(fail&&r.ok){fail=false;throw new Error('phase2 lost acknowledgement');}return r;
      }};
      const host=createSessionHost(port,{nowMs:()=>0});
      const req=f.request(command,command==='ATTACK'?{territoryId:FIRST,onlyArmyId:'army_0'}:{territoryId:HOME,quantity:500});
      const before=snapshotGameState(f.load().state),saves=f.store.saveCount.value;
      try {const r=await host.execute(req);assert(after&&r.idempotentReplay);}catch(e){assert.match(String(e),/phase2/);}
      if(!after)assert.deepEqual(snapshotGameState(f.load().state),before);
      f.reload();success(await f.execute(req));const committed=snapshotGameState(f.load().state);
      assert((await f.execute(req)).idempotentReplay);assert.deepEqual(snapshotGameState(f.load().state),committed);
      assert.equal(f.store.saveCount.value,saves+1);invariant(f);
    });
  }
  await report('Phase 2: stale different attack source cannot overwrite winning conquest',async()=>{
    const f=fixture();await ready(f);const stale=createSessionHost(f.persistence,{nowMs:()=>0});
    success(await stale.execute({commandId:'GET_GAME_STATE',playerId:PLAYER}));
    success(await f.send('ATTACK',{territoryId:FIRST,onlyArmyId:'army_0'}));const before=snapshotGameState(f.load().state);
    await assert.rejects(stale.execute(f.request('ATTACK',{territoryId:FIRST,commitAmount:120})),e=>e instanceof PersistenceFailedError&&e.code==='persistence.conflict');
    assert.deepEqual(snapshotGameState(f.load().state),before);invariant(f);
  });
  await report('Phase 2: world restart preserves old outcomes and fences delayed tutorial commands',async()=>{
    const f=fixture();await ready(f);const deploy=f.request('DEPLOY_TROOPS',{territoryId:HOME,quantity:500});success(await f.execute(deploy));
    const attack=f.request('ATTACK',{territoryId:FIRST,onlyArmyId:'army_0'});success(await f.execute(attack));
    await defense(f);
    // Authoritative defeat input fixture; use existing territory-loss reducer.
    editFixture(f,s=>{const faction=s.factions.get('f_player')!,owned=[...faction.territories];
      for(const id of owned)s.territories.get(id)!.owner=null;faction.territories=[];applyPlayerTerritoryLoss(s,HOME);});
    const restart=f.request('RESTART_WORLD');success(await f.execute(restart));assert.equal(f.load().state.worldAttempt,1);
    const before=snapshotGameState(f.load().state);for(const req of [deploy,attack,restart])assert((await f.execute(req)).idempotentReplay);
    assert.equal((await f.execute({...attack,requestId:'late-old-attempt'})).errors[0]?.code,'COMMAND_ATTEMPT_STALE');
    assert.deepEqual(snapshotGameState(f.load().state),before);invariant(f);
  });
  await report('Phase 2: authenticated HTTP full-deployment journey completes ordered tutorial and survives replay',async()=>{
    const f=fixture();await withHttp(f,async(send,execute)=>{
      await ready(f,send);const deploy=f.request('DEPLOY_TROOPS',{territoryId:HOME,quantity:500});
      const d=success(await execute(deploy));assert((await execute(deploy)).idempotentReplay);f.reload();
      const attack=f.request('ATTACK',{territoryId:FIRST,onlyArmyId:d.payload.armyId});success(await execute(attack));
      assert.equal(f.load().state.level1Tutorial!.beat,'DEFENSE_PENDING');const raid=f.load().state.level1Tutorial!.scriptedInvasionId;
      assert((await execute(attack)).idempotentReplay);assert.equal(f.load().state.activeInvasions.size,1);
      assert.equal((await send('ATTACK',{territoryId:FINAL,onlyArmyId:d.payload.armyId})).errors[0]?.code,'ACTION_NOT_ALLOWED');
      f.reload();await defense(f,send);await finalWorkout(f,send);
      const finalBank=f.load().state.playerRewards.bankedTroops;
      const finalArmy=success(await send('DEPLOY_TROOPS',{territoryId:HOME,quantity:finalBank}));
      const final=f.request('ATTACK',{territoryId:FINAL,onlyArmyId:finalArmy.payload.armyId});success(await execute(final));
      assert.equal(f.load().state.level1Tutorial!.beat,'COMPLETE');assert.equal(f.load().state.level1Tutorial!.scriptedInvasionId,raid);
      assert([...f.load().state.territories.values()].every(t=>t.owner==='f_player'));
      const before=snapshotGameState(f.load().state);f.reload();assert((await execute(final)).idempotentReplay);
      success(await send('GET_GAME_STATE'));assert.deepEqual(snapshotGameState(f.load().state),before);invariant(f);
    });
  });
  await report('Phase 2: identical authoritative seeds reproduce full battle and tutorial outcomes',async()=>{
    for(const seed of [3,11,29]) {
      const run=async()=>{const f=fixture(seed);await ready(f);success(await f.send('ATTACK',{territoryId:FIRST,onlyArmyId:'army_0'}));
        await defense(f);await finalWorkout(f);success(await f.send('ATTACK',{territoryId:FINAL,commitAmount:f.load().state.playerRewards.bankedTroops}));invariant(f);
        return snapshotGameState(f.load().state);};
      assert.deepEqual(await run(),await run());
    }
  });

}
if (require.main === module) runTutorialDeployedForceTests(async(name,fn) => {await fn();console.log('PASS '+name);})
  .catch(error => {console.error(error);process.exitCode=1;});
