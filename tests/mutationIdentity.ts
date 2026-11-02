import {scenario as rewardScenario, open as openRewardScenario, finish as finishRewardScenario} from './workoutStartRewards';
import {getAuthoredWorkoutCatalog, installAuthoredWorkoutCatalog} from '../src/fitness/authoring/registry';
import {gameplaySnapshot} from './mutationTestRequests';
import type {CommandRequest} from '../src/orchestration/protocol';
import type {GameState} from '../src/types/GameState';
import type {PlayerWorldPersistence} from '../src/server/persistencePort';
import {COMMAND_INDEX} from '../src/orchestration/commandIndex';
import {isCommandExposed} from '../src/server/allowlist';
import {snapshotGameState} from '../src/persistence/snapshot';
import {hydratePersistedPayload} from '../src/persistence/hydrate';
import {encodePersistable} from '../src/persistence/serialization';
import {cloneGameState} from '../src/state/cloneGameState';
import {applyPlayerTerritoryLoss} from '../src/gameplay/anchors';
import {accrueWorldThroughReceipt} from '../src/world/worldAccrual';
import assert from 'node:assert/strict';
import {createSessionHost, PersistenceFailedError} from '../src/server/session';
import {createCommandHttpServer} from '../src/server/http';
import {createInMemoryPersistence} from '../src/server/persistencePort';
import {InMemoryGameStateStore} from '../src/persistence/inMemoryGameStateStore';
import {createGameState} from '../src/state/createGameState';

export async function runMutationIdentityTests(report:(name:string,fn:()=>void|Promise<void>)=>Promise<void>) {
  await report('mutation identity: HTTP duplicate without session sequencing spends exactly once',async()=>{
    const store=new InMemoryGameStateStore(),state=createGameState();state.playerRewards.bankedTroops=100;
    assert(store.save('identity-player',state,0).ok);
    const server=createCommandHttpServer(createSessionHost(createInMemoryPersistence(store),{nowMs:()=>0}),{
      identity:{mode:'authenticated',authenticate:()=> 'identity-player'},
    });
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {
      const addr=server.address();assert(addr&&typeof addr==='object');
      const body={commandId:'DEPLOY_TROOPS',requestId:'deploy-1',worldAttempt:0,parameters:{territoryId:state.levelAnchorTerritoryIds[0],quantity:10}};
      const send=async()=>{const result=await fetch(`http://127.0.0.1:${addr.port}/commands`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return await result.json() as any;};
      const first=await send(),second=await send();assert.equal(first.success,true);
      const loaded=store.load('identity-player');assert(loaded.ok);
      assert.equal(loaded.state.playerRewards.bankedTroops,90);
      assert.equal(second.idempotentReplay,true);assert.equal(first.payload.armyId,second.payload.armyId);
    } finally {await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
  });  const fixture = (playerId = 'identity-player', bank = 100) => {
    const store = new InMemoryGameStateStore(), state = createGameState();
    state.playerRewards.bankedTroops = bank;
    assert(store.save(playerId, state, 0).ok);
    const persistence = createInMemoryPersistence(store);
    const host = createSessionHost(persistence, {nowMs: () => 0});
    const load = () => {const r = store.load(playerId); assert(r.ok); return r;};
    const deploy = (requestId = 'deploy', quantity = 10): CommandRequest => ({
      commandId: 'DEPLOY_TROOPS', playerId, requestId, worldAttempt: 0,
      parameters: {territoryId: state.levelAnchorTerritoryIds[0], quantity},
    });
    return {store, state, persistence, host, load, deploy, playerId};
  };
  const unchanged = (f: ReturnType<typeof fixture>) => snapshotGameState(f.load().state);
  await report('mutation identity: changed quantity destination and command type conflict without writes', async () => {
    const f=fixture(), command=f.deploy(); assert((await f.host.execute(command)).success);
    const before=unchanged(f), saves=f.store.saveCount.value;
    for(const request of [f.deploy('deploy',20), {...command, parameters:{...command.parameters,territoryId:'elsewhere'}},
      {...command,commandId:'SET_PLAYER_PAUSE',parameters:{paused:true}}]) {
      const r=await f.host.execute(request); assert.equal(r.errors[0]?.code,'COMMAND_IDENTITY_CONFLICT');
      assert.deepEqual(unchanged(f),before);
    }
    assert.equal(f.store.saveCount.value,saves);
  });
  await report('mutation identity: reordered keys and transport timestamps replay but distinct IDs remain independent', async () => {
    const f=fixture(), first=await f.host.execute(f.deploy());assert(first.success);
    const before=unchanged(f);
    const retry=await f.host.execute({...f.deploy(),timestamp:999,clientContext:{device:'other'},
      parameters:{quantity:10,now:999,territoryId:f.state.levelAnchorTerritoryIds[0]}});
    assert(retry.idempotentReplay);assert.deepEqual(unchanged(f),before);
    const second=await f.host.execute(f.deploy('second'));assert(second.success);assert.notEqual(first.payload.armyId,second.payload.armyId);
    assert.equal(f.load().state.playerRewards.bankedTroops,80);
  });
  await report('mutation identity: every public mutation rejects missing or malformed identity before loading a world', async () => {
    const f=fixture(); let loads=0;
    const host=createSessionHost({...f.persistence,ensure(id){loads++;return f.persistence.ensure(id);}});
    for(const def of COMMAND_INDEX.filter(d=>d.changesState&&isCommandExposed(d.commandId))) {
      for(const requestId of [undefined,'',' bad','bad/id','x'.repeat(129)]) {
        const r=await host.execute({...f.deploy(),commandId:def.commandId,requestId});
        assert.equal(r.errors[0]?.code,'COMMAND_IDENTITY_INVALID',def.commandId);
      }
    }
    for(const attempt of [undefined,-1,0.5,Number.MAX_SAFE_INTEGER+1,'0']) {
      assert.equal((await host.execute({...f.deploy(),worldAttempt:attempt as number})).errors[0]?.code,'COMMAND_IDENTITY_INVALID');
    }
    assert.equal(loads,0);assert.equal(f.load().state.playerRewards.bankedTroops,100);
  });
  await report('mutation identity: old receipt survives later commands reload and changed session transport', async () => {
    const f=fixture(); const opened=await f.host.openGameplaySession(f.playerId,'open',0);
    const command={...f.deploy(),gameplaySessionId:opened.sessionId,renewalSequence:1,commandSequence:1};
    assert((await f.host.execute(command)).success);assert((await f.host.execute(f.deploy('later'))).success);
    const before=unchanged(f), host=createSessionHost(f.persistence,{nowMs:()=>900000});
    assert((await host.execute(f.deploy())).idempotentReplay);
    assert.deepEqual(unchanged(f),before);assert.equal(f.load().state.playerRewards.bankedTroops,80);
  });
  await report('mutation identity: independent stale workers resolve the winning duplicate through shared CAS', async () => {
    const f=fixture(), workerA=createSessionHost(f.persistence,{nowMs:()=>0}),workerB=createSessionHost(f.persistence,{nowMs:()=>0});
    await Promise.all([workerA,workerB].map(h=>h.execute({commandId:'GET_GAME_STATE',playerId:f.playerId})));
    const saves=f.store.saveCount.value;
    const results=await Promise.all([workerA.execute(f.deploy()),workerB.execute(f.deploy())]);
    assert(results.every(r=>r.success));assert.equal(results.filter(r=>r.idempotentReplay).length,1);
    assert.equal(f.store.saveCount.value,saves+1);assert.equal(f.load().state.playerRewards.bankedTroops,90);
    assert.equal(results[0].payload.armyId,results[1].payload.armyId);
  });
  await report('mutation identity: stale competing different intent conflicts and different ID remains stale without hidden merge', async () => {
    for(const sameId of [true,false]) {
      const f=fixture(), b=createSessionHost(f.persistence,{nowMs:()=>0});
      await b.execute({commandId:'GET_GAME_STATE',playerId:f.playerId});assert((await f.host.execute(f.deploy())).success);
      const before=unchanged(f), request=f.deploy(sameId?'deploy':'other',20);
      if(sameId) assert.equal((await b.execute(request)).errors[0]?.code,'COMMAND_IDENTITY_CONFLICT');
      else await assert.rejects(b.execute(request),(e:unknown)=>e instanceof PersistenceFailedError&&e.code==='persistence.conflict');
      assert.deepEqual(unchanged(f),before);
    }
  });
  await report('mutation identity: definitive insufficient-bank rejection stays rejected after resources change', async () => {
    const f=fixture('identity-player',0);const rejected=await f.host.execute(f.deploy());assert.equal(rejected.success,false);
    assert.equal(rejected.mutationOutcome,'rejected');
    const r=f.load();r.state.playerRewards.bankedTroops=100;assert(f.store.save(f.playerId,r.state,r.record.stateVersion).ok);
    const host=createSessionHost(f.persistence,{nowMs:()=>0}),before=unchanged(f);
    const replay=await host.execute(f.deploy());assert.equal(replay.success,false);assert(replay.idempotentReplay);
    assert.deepEqual(replay.errors,JSON.parse(JSON.stringify(rejected.errors)));assert.deepEqual(unchanged(f),before);
    assert((await host.execute(f.deploy('new-intention'))).success);assert.equal(f.load().state.playerRewards.bankedTroops,90);
  });
  await report('mutation identity: player namespaces and authorization prevent receipt disclosure', async () => {
    const f=fixture('alice');const bob=createGameState();bob.playerRewards.bankedTroops=50;assert(f.store.save('bob',bob,0).ok);
    assert((await f.host.execute(f.deploy())).success);
    const r=await f.host.execute({...f.deploy(),playerId:'bob'});assert(r.success);assert.equal(r.idempotentReplay,undefined);
    const b=f.store.load('bob');assert(b.ok);assert.equal(b.state.playerRewards.bankedTroops,40);
    const before=unchanged(f);
    const bad=await f.host.execute({...f.deploy(),parameters:{...f.deploy().parameters,factionId:'foreign-faction'}});
    assert.equal(bad.errors[0]?.code,'ACTION_NOT_ALLOWED');assert.equal(bad.idempotentReplay,undefined);assert.deepEqual(unchanged(f),before);
    const foreign=await f.host.openGameplaySession('bob','bob-open',0);
    assert.equal((await f.host.execute({...f.deploy(),gameplaySessionId:foreign.sessionId})).errors[0]?.code,'GAMEPLAY_SESSION_INVALID');
  });
  await report('mutation identity: lost acknowledgement and process restart preserve receipt and exactly one deduction', async () => {
    const f=fixture();let lose=true;
    const port:PlayerWorldPersistence={...f.persistence,save(...args){const r=f.persistence.save(...args);if(r.ok&&lose){lose=false;throw new Error('lost commit acknowledgement');}return r;}};
    const worker=createSessionHost(port,{nowMs:()=>0});
    // Either an immediate authoritative replay or a retryable uncertain error is safe.
    try {const r=await worker.execute(f.deploy());assert(r.idempotentReplay);}catch(e){assert.match(String(e),/lost commit acknowledgement/);}
    const before=unchanged(f),restart=createSessionHost(f.persistence,{nowMs:()=>123456});
    assert((await restart.execute(f.deploy())).idempotentReplay);assert.deepEqual(unchanged(f),before);
    assert.equal(f.load().state.playerRewards.bankedTroops,90);
  });
  await report('mutation identity: failed commit creates no receipt and retry commits once', async () => {
    const f=fixture();let fail=true;
    const host=createSessionHost({...f.persistence,save(...args){if(fail){fail=false;throw new Error('before commit');}return f.persistence.save(...args);}},{nowMs:()=>0});
    const before=unchanged(f);await assert.rejects(host.execute(f.deploy()),/before commit/);assert.deepEqual(unchanged(f),before);
    assert((await host.execute(f.deploy())).success);assert((await host.execute(f.deploy())).idempotentReplay);assert.equal(f.load().state.playerRewards.bankedTroops,90);
  });
  await report('mutation identity: restart advances attempt fence and retains old outcomes without re-execution', async () => {
    const f=fixture();assert((await f.host.execute(f.deploy())).success);
    const lost=f.load(), faction=lost.state.factions.get(lost.state.playerFactionId!)!;
    const owned=[...faction.territories];for(const id of owned)lost.state.territories.get(id)!.owner=null;
    faction.territories=[];applyPlayerTerritoryLoss(lost.state,owned[0]);
    assert.equal(lost.state.levelDefeat.status,'defeated');assert(f.store.save(f.playerId,lost.state,lost.record.stateVersion).ok);
    const host=createSessionHost(f.persistence,{nowMs:()=>0}),restart={commandId:'RESTART_WORLD',playerId:f.playerId,requestId:'restart',worldAttempt:0};
    assert((await host.execute(restart)).success);assert.equal(f.load().state.worldAttempt,1);
    const before=unchanged(f);assert((await host.execute(restart)).idempotentReplay);assert((await host.execute(f.deploy())).idempotentReplay);
    assert.equal((await host.execute(f.deploy('delayed-old'))).errors[0]?.code,'COMMAND_ATTEMPT_STALE');
    assert.equal((await host.execute({...f.deploy(),worldAttempt:1})).errors[0]?.code,'COMMAND_IDENTITY_CONFLICT');assert.deepEqual(unchanged(f),before);
  });
  await report('mutation identity: pending catch-up binds intent and preserves sequence until handler commits', async () => {
    const f=fixture();const s=f.load();accrueWorldThroughReceipt(s.state,0);accrueWorldThroughReceipt(s.state,150*600000);
    assert(f.store.save(f.playerId,s.state,s.record.stateVersion).ok);
    const host=createSessionHost(f.persistence,{nowMs:()=>150*600000,maxCatchUpChunks:1});
    const req={...f.deploy(),commandId:'SET_PLAYER_PAUSE',parameters:{paused:true}};
    const first=await host.execute(req);assert.equal(first.errors[0]?.code,'WORLD_CATCHUP_PENDING');
    const before=unchanged(f);assert.equal((await host.execute({...req,parameters:{paused:false}})).errors[0]?.code,'COMMAND_IDENTITY_CONFLICT');assert.deepEqual(unchanged(f),before);
    assert.equal((await host.execute(req)).errors[0]?.code,'WORLD_CATCHUP_PENDING');assert((await host.execute(req)).success);
    const done=unchanged(f);assert((await host.execute(req)).idempotentReplay);assert.deepEqual(unchanged(f),done);
  });
  await report('mutation identity: session open heartbeat and end replay without time accrual and share command namespace', async () => {
    const f=fixture();let now=0;const host=createSessionHost(f.persistence,{nowMs:()=>now});
    const open=await host.openGameplaySession(f.playerId,'open',0);let before=unchanged(f);now=1000;
    assert.equal((await host.openGameplaySession(f.playerId,'open',0)).outcome,'idempotent_replay');assert.deepEqual(unchanged(f),before);
    await host.heartbeatGameplaySession(f.playerId,'beat',open.sessionId,1,0);before=unchanged(f);now=2000;
    assert.equal((await host.heartbeatGameplaySession(f.playerId,'beat',open.sessionId,1,0)).outcome,'idempotent_replay');assert.deepEqual(unchanged(f),before);
    assert.equal((await host.heartbeatGameplaySession(f.playerId,'beat',open.sessionId,2,0)).error,'COMMAND_IDENTITY_CONFLICT');assert.deepEqual(unchanged(f),before);
    await host.endGameplaySession(f.playerId,'end',open.sessionId,0);before=unchanged(f);now=3000;
    assert.equal((await host.endGameplaySession(f.playerId,'end',open.sessionId,0)).outcome,'idempotent_replay');assert.deepEqual(unchanged(f),before);
    assert.equal((await host.execute(f.deploy('open'))).errors[0]?.code,'COMMAND_IDENTITY_CONFLICT');
    assert.equal((await host.openGameplaySession(f.playerId,'old-attempt',1)).error,'COMMAND_ATTEMPT_STALE');assert.deepEqual(unchanged(f),before);
  });
  await report('mutation identity: current receipt hydration rejects malformed authority and legacy migration does not invent intent', async () => {
    const f=fixture();const lease=await f.host.openGameplaySession(f.playerId,'open',0);
    assert((await f.host.execute({...f.deploy(),gameplaySessionId:lease.sessionId,commandSequence:1,renewalSequence:1})).success);
    const state=f.load().state,copy=cloneGameState(state);copy.commandReceipts.get('deploy')!.payload.armyId='changed';
    assert.notEqual(state.commandReceipts.get('deploy')!.payload.armyId,'changed');
    assert.deepEqual(snapshotGameState(hydratePersistedPayload(snapshotGameState(state))),snapshotGameState(state));
    for(const mutate of [(s:GameState)=>{s.worldAttempt=-1;},(s:GameState)=>{s.commandReceipts.get('deploy')!.intentHash='bad';},
      (s:GameState)=>{s.commandReceipts.get('deploy')!.worldAttempt=2;}]){
      const bad=cloneGameState(state);mutate(bad);assert.throws(()=>hydratePersistedPayload(encodePersistable(bad)));
    }
    const legacy=cloneGameState(state);legacy.schemaVersion=31;delete (legacy as Partial<GameState>).worldAttempt;delete (legacy as Partial<GameState>).commandReceipts;
    const migrated=hydratePersistedPayload(encodePersistable(legacy));assert.equal(migrated.worldAttempt,0);assert.equal(migrated.commandReceipts.size,2);
    assert.equal(migrated.commandReceipts.get('deploy')!.intentHash,null);assert.deepEqual(migrated.armies,state.armies);assert.deepEqual(migrated.playerRewards,state.playerRewards);
    const loaded=f.load();assert(f.store.save(f.playerId,migrated,loaded.record.stateVersion).ok);
    const host=createSessionHost(f.persistence,{nowMs:()=>0});assert.equal((await host.execute(f.deploy())).errors[0]?.code,'COMMAND_IDENTITY_CONFLICT');
  });
  await report('mutation identity: public movement and construction replay without creating a second physical operation', async () => {
    for(const kind of ['MOVE','START_CONSTRUCTION'] as const) {
      const f=fixture(),r=f.load(),state=r.state,faction=state.factions.get(state.playerFactionId!)!;
      state.level1Tutorial=null;faction.resources.gold+=500;faction.resources.wood+=500;
      const home=state.territories.get(state.levelAnchorTerritoryIds[0])!;
      const destination=state.territories.get(home.neighboring[0])!;
      if(destination.owner!==faction.id){if(destination.owner){const other=state.factions.get(destination.owner)!;other.territories=other.territories.filter(id=>id!==destination.id);}
        destination.owner=faction.id;faction.territories.push(destination.id);}
      assert(f.store.save(f.playerId,state,r.record.stateVersion).ok);
      const deployment=await f.host.execute(f.deploy());assert(deployment.success);
      const request:CommandRequest={playerId:f.playerId,worldAttempt:0,requestId:'physical',commandId:kind,
        parameters:kind==='MOVE'?{armyId:deployment.payload.armyId,destinationTerritoryId:destination.id}:{territoryId:home.id,projectType:'FARM'}};
      const result=await f.host.execute(request);assert(result.success,JSON.stringify(result.errors));
      const before=unchanged(f),reloaded=createSessionHost(f.persistence,{nowMs:()=>1000});
      const replay=await reloaded.execute(request);assert(replay.idempotentReplay);assert.deepEqual(replay.payload,JSON.parse(JSON.stringify(result.payload)));
      assert.deepEqual(unchanged(f),before);
      if(kind==='MOVE')assert(f.load().state.armies.get(deployment.payload.armyId as string)!.movement);
      else assert.equal(f.load().state.constructions.size,1);
    }
  });
  await report('mutation identity: failed transition does not consume attempt; committed transition fences old commands', async () => {
    const f=fixture(),request={commandId:'TRANSITION_TO_NEXT_WORLD',playerId:f.playerId,requestId:'transition-denied',worldAttempt:0};
    const denied=await f.host.execute(request);assert.equal(denied.success,false);assert.equal(f.load().state.worldAttempt,0);
    const r=f.load();for(const territory of r.state.territories.values())territory.owner=r.state.playerFactionId;
    for(const faction of r.state.factions.values())faction.territories=[...r.state.territories.values()].filter(t=>t.owner===faction.id).map(t=>t.id);
    assert(f.store.save(f.playerId,r.state,r.record.stateVersion).ok);
    const host=createSessionHost(f.persistence,{nowMs:()=>0});assert.equal((await host.execute(request)).success,false);
    const fresh={...request,requestId:'transition-approved'},response=await host.execute(fresh);assert(response.success,JSON.stringify(response.errors));
    assert.equal(f.load().state.worldAttempt,1);assert.equal(f.load().state.worldLevel,2);
    const before=unchanged(f);assert((await host.execute(fresh)).idempotentReplay);
    assert.equal((await host.execute(f.deploy('delayed'))).errors[0]?.code,'COMMAND_ATTEMPT_STALE');assert.deepEqual(unchanged(f),before);
  });
  await report('mutation identity: HTTP session routes require attempt and retain exact lifecycle results', async () => {
    const f=fixture();let now=0;const server=createCommandHttpServer(createSessionHost(f.persistence,{nowMs:()=>now}),{
      identity:{mode:'authenticated',authenticate:()=>f.playerId},onInternalError:()=>{},
    });
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {
      const addr=server.address();assert(addr&&typeof addr==='object');
      const post=async(path:string,body:unknown)=>{const r=await fetch(`http://127.0.0.1:${addr.port}${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json() as any};};
      const before=unchanged(f);assert.equal((await post('/session/open',{requestId:'open'})).status,400);assert.deepEqual(unchanged(f),before);
      const opened=await post('/session/open',{requestId:'wire-open',worldAttempt:0});assert.equal(opened.body.worldAttempt,0);
      for(const [path,body]of [
        ['/session/open',{requestId:'wire-open',worldAttempt:0}],
        ['/session/heartbeat',{requestId:'wire-heartbeat',worldAttempt:0,gameplaySessionId:opened.body.sessionId,renewalSequence:1}],
        ['/session/end',{requestId:'wire-end',worldAttempt:0,gameplaySessionId:opened.body.sessionId}],
      ] as const){await post(path,body);const committed=unchanged(f);now+=1000;const replay=await post(path,body);
        assert.equal(replay.body.outcome,'idempotent_replay');assert.deepEqual(unchanged(f),committed);}
    }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
  });
  await report('mutation identity: independent workout settlement workers commit one bank ledger and history result', async () => {
    const old=getAuthoredWorkoutCatalog();
    try {
      const s=rewardScenario();assert((await s.host.execute(await openRewardScenario(s))).success);await finishRewardScenario(s.host,s);
      const playerId='r1-d-player',workers=[createSessionHost(s.persistence,{nowMs:()=>1000}),createSessionHost(s.persistence,{nowMs:()=>2000})];
      for(const host of workers)await host.execute({commandId:'GET_GAME_STATE',playerId});
      const request={commandId:'FINALIZE_WORKOUT',playerId,requestId:'settle-once',worldAttempt:0};
      const before=s.store.saveCount.value,results=await Promise.all(workers.map(host=>host.execute(request)));
      assert(results.every(r=>r.success));assert.equal(results.filter(r=>r.idempotentReplay).length,1);assert.equal(s.store.saveCount.value,before+1);
      const state=s.load().state;assert.equal(state.playerRewards.bankedTroops,125);assert.equal(state.playerRewards.appliedRewards.length,1);
      const history=s.history.clonePlayer(playerId);assert.equal(history.length,1);
      assert.equal(history[0].sessionId,state.playerFitness.activeSession!.sessionId);
      assert.deepEqual(JSON.parse(JSON.stringify(results[0].payload)),results[1].payload);
      assert((await createSessionHost(s.persistence).execute(request)).idempotentReplay);assert.deepEqual(s.history.clonePlayer(playerId),history);
    }finally{installAuthoredWorkoutCatalog(old);}
  });
  await report('mutation identity: memory atomic history failure rolls back world receipt and partial history before retry', async () => {
    const old=getAuthoredWorkoutCatalog();
    try {
      const s=rewardScenario();assert((await s.host.execute(await openRewardScenario(s))).success);await finishRewardScenario(s.host,s);
      const before=snapshotGameState(s.load().state),history=s.history.clonePlayer('r1-d-player'),upsert=s.history.upsert.bind(s.history);
      let fail=true;s.history.upsert=entry=>{upsert(entry);if(fail){fail=false;throw new Error('history write failed');}};
      const request={commandId:'FINALIZE_WORKOUT',playerId:'r1-d-player',requestId:'retry-settle',worldAttempt:0};
      await assert.rejects(s.host.execute(request),/history write failed/);assert.deepEqual(snapshotGameState(s.load().state),before);
      assert.deepEqual(s.history.clonePlayer('r1-d-player'),history);
      assert((await s.host.execute(request)).success);const paid=snapshotGameState(s.load().state);
      assert((await s.host.execute(request)).idempotentReplay);assert.deepEqual(snapshotGameState(s.load().state),paid);
    }finally{installAuthoredWorkoutCatalog(old);}
  });
  await report('mutation identity: rejected workout mutation through buffered history persists final rejection safely', async () => {
    const old=getAuthoredWorkoutCatalog();
    try {
      const s=rewardScenario();assert((await s.host.execute(await openRewardScenario(s))).success);
      const before=gameplaySnapshot(s.load().state),history=s.history.clonePlayer('r1-d-player');
      const request={commandId:'RECORD_EXERCISE',playerId:'r1-d-player',requestId:'bad-step',worldAttempt:0,parameters:{order:9999,repetitions:1}};
      const rejected=await s.host.execute(request);assert.equal(rejected.success,false);assert.equal(rejected.mutationOutcome,'rejected');
      assert.deepEqual(gameplaySnapshot(s.load().state),before);assert.deepEqual(s.history.clonePlayer('r1-d-player'),history);
      assert((await s.host.execute(request)).idempotentReplay);
    }finally{installAuthoredWorkoutCatalog(old);}
  });

  await report('mutation identity: session lifecycle retries resolve failed writes and lost acknowledgements without duplicate presence', async () => {
    for (const route of ['open', 'heartbeat', 'end'] as const) for (const failure of ['before', 'after'] as const) {
      const f = fixture();
      const initial = route === 'open' ? null : await f.host.openGameplaySession(f.playerId, 'initial-open', 0);
      const before = unchanged(f);
      let injected = false;
      const port: PlayerWorldPersistence = {...f.persistence, save(...args) {
        if (!injected && failure === 'before') {
          injected = true;
          return {ok: false, persisted: false, code: 'persistence.conflict', message: 'Injected stale version'};
        }
        const saved = f.persistence.save(...args);
        if (!injected && saved.ok) { injected = true; throw new Error('Lost lifecycle acknowledgement'); }
        return saved;
      }};
      const call = (host: ReturnType<typeof createSessionHost>) => route === 'open'
        ? host.openGameplaySession(f.playerId, 'lifecycle-request', 0)
        : route === 'heartbeat'
          ? host.heartbeatGameplaySession(f.playerId, 'lifecycle-request', initial!.sessionId, 1, 0)
          : host.endGameplaySession(f.playerId, 'lifecycle-request', initial!.sessionId, 0);
      const worker = createSessionHost(port, {nowMs: () => 1000});
      if (failure === 'after') {
        await assert.rejects(call(worker), /Lost lifecycle acknowledgement/);
        assert.notDeepEqual(unchanged(f), before);
      } else {
        // The existing lifecycle CAS loop retries with the captured receipt time.
        const committed = await call(worker);
        assert.equal(committed.receiptMs, 1000);
      }
      const committed = unchanged(f), saves = f.store.saveCount.value;
      const replay = await call(createSessionHost(f.persistence, {nowMs: () => 60000}));
      assert.equal(replay.outcome, 'idempotent_replay');
      assert.equal(replay.receiptMs, 1000);
      assert.deepEqual(unchanged(f), committed);
      assert.equal(f.store.saveCount.value, saves);
      assert.equal(f.load().state.gameplaySessionLeases.length, 1);
    }
  });

  await report('mutation identity: production refuses an adapter without atomic world-history commit', async () => {
    const f=fixture(),before=process.env.NODE_ENV;process.env.NODE_ENV='production';
    try { assert.throws(()=>createSessionHost({...f.persistence,name:'supabase',commitWorld:undefined}),/atomic world and history/); }
    finally { if(before===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=before; }
  });

}
if(require.main===module)runMutationIdentityTests(async(name,fn)=>{await fn();console.log('PASS '+name);}).catch(e=>{console.error(e);process.exitCode=1;});
