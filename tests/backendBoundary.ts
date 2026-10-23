import { Orchestrator } from '../src/orchestration';
import { createGameState } from '../src/state';
import { makeConcretePlan } from '../src/types/AIConcretePlan';
import { initializeRecruitment, recruitmentPoolId } from '../src/gameplay/recruitment/recruitment';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createCommandHttpServer, CommandHttpOptions } from '../src/server/http';
import { createSessionHost } from '../src/server/session';
import { createInMemoryPersistence } from '../src/server/persistencePort';
import { InMemoryGameStateStore } from '../src/persistence/inMemoryGameStateStore';
import { getAuthoredWorkoutCatalog, installAuthoredWorkoutCatalog } from '../src/fitness/authoring/registry';
import { scenario, open } from './workoutStartRewards';
import { CommandResponse } from '../src/orchestration/protocol';
import { getCurrentExercise } from '../src/fitness/session';
import { snapshotGameState } from '../src/persistence/snapshot';
import { WorkoutRewardView } from '../src/rewards/workoutRewardView';
import { GameState } from '../src/types/GameState';
import { checkGameStateInvariants } from '../src/state/gameStateInvariants';
import { tradeNode } from '../src/gameplay/trade/policy';
import { reservedResource } from '../src/gameplay/trade/resources';
import { createProductionHttpServer } from '../src/server/production';

type Report = (name: string, test: () => Promise<void>) => Promise<void>;
type Host = ReturnType<typeof createSessionHost>;
async function serve(host: Host, options: CommandHttpOptions, run: (post: (path: string, body?: unknown, token?: string) => Promise<{ status: number; body: Record<string, unknown>; raw: string }>) => Promise<void>) {
  const server = createCommandHttpServer(host, options);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const post = (path: string, body?: unknown, token?: string) => new Promise<{ status: number; body: Record<string, unknown>; raw: string }>((resolve, reject) => {
    const text = JSON.stringify(body);
    const req = request({ hostname: '127.0.0.1', port: address.port, path, method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: token } : {}) } }, res => {
      const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => { const raw = Buffer.concat(chunks).toString('utf8'); resolve({ status: res.statusCode!, body: JSON.parse(raw), raw }); });
    }); req.on('error', reject); req.end(text);
  });
  try { await run(post); } finally { await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())); }
}
const authenticated: CommandHttpOptions = { identity: { mode: 'authenticated', authenticate: req => req.headers.authorization === 'test-alice' ? 'alice' : req.headers.authorization === 'test-bob' ? 'bob' : null } };

export async function runBackendBoundaryTests(report: Report): Promise<void> {
  await report('boundary: production composition fails closed without persistence configuration',async()=>{
    const prior={url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY};
    delete process.env.SUPABASE_URL;delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try{assert.throws(()=>createProductionHttpServer({authenticate:()=>null,readiness:()=>true}),/Supabase persistence requires/);}
    finally{if(prior.url===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=prior.url;
      if(prior.key===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=prior.key;}
  });
  await report('boundary: production HTTP cannot silently use a memory world store',async()=>{
    const prior=process.env.NODE_ENV;process.env.NODE_ENV='production';
    try{assert.throws(()=>createCommandHttpServer(createSessionHost(createInMemoryPersistence()),authenticated),/ephemeral/);}
    finally{if(prior===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=prior;}
  });
  for (const kind of ['PEACE','TRADE'] as const) await report(`integration: public ${kind} uses exact owned proposals, timers, withdrawal and receipts`, async()=>{
    const oldCatalog=getAuthoredWorkoutCatalog(),s=scenario();let now=1000;
    const host=createSessionHost(s.persistence,{nowMs:()=>now});
    try {await serve(host,{identity:{mode:'authenticated',authenticate:()=> 'r1-d-player'}},async post=>{
      const opened=await post('/session/open',{requestId:'diplomacy-open'}),lease=opened.body.sessionId;
      const fid=s.state.playerFactionId!,other=s.state.allFactionIds.find(f=>f!==fid)!;
      const plan=kind==='PEACE'?makeConcretePlan({action:'OFFER_PEACE',factionId:fid,counterpartyId:other})
        :makeConcretePlan({action:'TRADE',factionId:fid,counterpartyId:other,offered:{gold:1},requested:{food:1},
          proposerSource:{kind:'faction_stock',factionId:fid,resources:{gold:1}},
          delivery:{proposerTerritoryId:tradeNode(s.state,fid)!,recipientTerritoryId:tradeNode(s.state,other)!}});
      const request={commandId:kind==='PEACE'?'OFFER_PEACE':'TRADE',requestId:'offer',parameters:{plan},gameplaySessionId:lease,commandSequence:1,renewalSequence:1};
      const result=await post('/commands',request);assert.equal(result.body.success,true,JSON.stringify(result.body));
      const saved=snapshotGameState(s.load().state);
      const replay=await post('/commands',request);assert.equal(replay.body.idempotentReplay,true);assert.deepEqual(snapshotGameState(s.load().state),saved);
      if(kind==='TRADE')assert.equal(reservedResource(s.load().state,fid,'gold'),1);
      now+=kind==='PEACE'?1000:2000;
      const sync=await post('/commands',{commandId:'SYNC_PLAYER_WORLD'});assert.equal(sync.body.success,true,JSON.stringify(sync.body));
      const proposals=kind==='PEACE'?s.load().state.peaceProposals:s.load().state.tradeProposals;
      const proposal=[...proposals.values()].find(p=>p.proposer===fid)!;assert.equal(proposal.status,'pending');
      const before=snapshotGameState(s.load().state);
      const unauthorized=await post('/commands',{commandId:`RESPOND_${kind}`,parameters:{proposalId:proposal.id,response:`ACCEPT_${kind}`}});
      assert.equal(unauthorized.body.success,false);assert.deepEqual(snapshotGameState(s.load().state),before);
      const withdrawal={commandId:`WITHDRAW_${kind}`,requestId:'withdraw',parameters:{proposalId:proposal.id},gameplaySessionId:lease,commandSequence:2,renewalSequence:2};
      const cancelled=await post('/commands',withdrawal);assert.equal(cancelled.body.success,true,JSON.stringify(cancelled.body));
      assert.equal((kind==='PEACE'?s.load().state.peaceProposals:s.load().state.tradeProposals).get(proposal.id)!.status,'withdrawn');
      const after=snapshotGameState(s.load().state);await post('/commands',withdrawal);assert.deepEqual(snapshotGameState(s.load().state),after);
      if(kind==='TRADE')assert.equal(reservedResource(s.load().state,fid,'gold'),0);
      assert.deepEqual(checkGameStateInvariants(s.load().state),[]);
    });}finally{installAuthoredWorkoutCatalog(oldCatalog);}
  });
  await report('integration: authenticated workout, banked attack, restart, replay and offline accrual conserve state', async () => {
    const oldCatalog = getAuthoredWorkoutCatalog(), s = scenario(); let now = 1000;
    let host = createSessionHost(s.persistence, { nowMs: () => now });
    const options: CommandHttpOptions = { identity: { mode: 'authenticated', authenticate: () => 'r1-d-player' } };
    const troops = (state: GameState) => state.playerRewards.bankedTroops
      + [...state.territories.values()].reduce((n,t) => n+t.garrison,0)
      + [...state.armies.values()].reduce((n,a) => n+a.soldiers+a.knights,0);
    let lease = '', workout = '', attack: Record<string, unknown> = {}, attackPayload: unknown;
    try {
      await serve(host, options, async post => {
        const opened = await post('/session/open', { requestId: 'integration-open' });
        assert.equal(opened.status, 200); lease = opened.body.sessionId as string;
        const command = async (commandId: string, parameters: Record<string,unknown> = {}, sequence?: number) => {
          const result = await post('/commands', { commandId, parameters, requestId: `integration-${commandId}`,
            ...(sequence === undefined ? {} : { gameplaySessionId: lease, commandSequence: sequence, renewalSequence: sequence }) });
          assert.equal(result.body.success, true, JSON.stringify(result.body)); return result.body;
        };
        await command('GET_GAME_STATE');
        const definition = await command('GET_WORLD_DEFINITION');
        assert.equal((definition.payload as {persistedContentFingerprint:string}).persistedContentFingerprint, s.load().state.definitionContentFingerprint);
        await command('GET_WORKOUT_SELECTION',{purpose:'NORMAL_TROOPS',size:'LONG'});
        await command('START_WORKOUT', {purpose:'NORMAL_TROOPS',size:'LONG'}, 1);
        workout = s.load().state.playerFitness.activeSession!.sessionId;
        while (s.load().state.playerFitness.activeSession!.state === 'ACTIVE') {
          const step = getCurrentExercise(s.load().state.playerFitness.activeSession!)!;
          await command('RECORD_EXERCISE', {order:step.order,...(step.prescription.kind==='repetitions'
            ? {repetitions:step.prescription.repetitions} : {durationSeconds:step.prescription.durationSeconds})});
        }
        const final = await command('FINALIZE_WORKOUT', {}, 2);
        const effect = (final.payload as {workoutReward:WorkoutRewardView}).workoutReward.settlement!.amountOrEffect;
        assert.equal(effect.kind,'TROOPS'); if(effect.kind!=='TROOPS') throw new Error('Wrong effect'); assert.equal(effect.amount,181);
        const beforeRetry = snapshotGameState(s.load().state);
        await command('FINALIZE_WORKOUT', {}, 2);
        assert.deepEqual(snapshotGameState(s.load().state), beforeRetry);
        const beforeAttack = s.load().state, initialTotal = troops(beforeAttack);
        const invalid = await post('/commands', {commandId:'ATTACK',parameters:{territoryId:'t_03',commitAmount:181},
          gameplaySessionId:lease,commandSequence:3,renewalSequence:3});
        assert.equal(invalid.body.success, false);
        assert.deepEqual(snapshotGameState(s.load().state), snapshotGameState(beforeAttack));
        attack = {commandId:'ATTACK',requestId:'integration-attack',gameplaySessionId:lease,commandSequence:3,renewalSequence:3,
          parameters:{territoryId:'t_07',commitAmount:181,seed:99999}};
        const result = await post('/commands', attack); assert.equal(result.body.success,true,JSON.stringify(result.body));
        const payload = result.body.payload as {battleResult:{attacker:{casualties:{total:number}};defender:{casualties:{total:number}}};committedArmyId:string};
        attackPayload = payload; assert.ok(payload.battleResult);
        const after = s.load().state;
        assert.equal(after.playerRewards.bankedTroops,0);
        assert.equal(troops(after),initialTotal-payload.battleResult.attacker.casualties.total-payload.battleResult.defender.casualties.total);
        assert.deepEqual(checkGameStateInvariants(after),[]);
      });
      const committed = snapshotGameState(s.load().state);
      host = createSessionHost(s.persistence, {nowMs:()=>now});
      await serve(host,options,async post=>{
        const retry = await post('/commands', {...attack,parameters:{territoryId:'t_07',commitAmount:181,seed:1}});
        assert.equal(retry.body.success,true);assert.equal(retry.body.idempotentReplay,true);assert.deepEqual(retry.body.payload,attackPayload);
        assert.deepEqual(snapshotGameState(s.load().state),committed);
        const history = await post('/commands',{commandId:'GET_WORKOUT_REWARD',parameters:{sessionId:workout}});
        const reward = (history.body.payload as {workoutReward:WorkoutRewardView}).workoutReward;
        assert.equal(reward.status,'SETTLED');assert.equal(reward.settlement!.amountOrEffect.kind,'TROOPS');
        const effect=reward.settlement!.amountOrEffect; if(effect.kind!=='TROOPS') throw new Error('Wrong effect'); assert.equal(effect.amount,181);assert.equal(reward.currentBankedTroops,0);
        await post('/session/end',{requestId:'disconnect',gameplaySessionId:lease});
        const tick = s.load().state.worldTick;
        now += 600_000; // Exactly one offline simulation minute, not ten online ticks.
        const sync = await post('/commands',{commandId:'SYNC_PLAYER_WORLD'});assert.equal(sync.body.success,true,JSON.stringify(sync.body));
        assert.equal(s.load().state.worldTick,tick+1);
        assert.equal(s.load().state.accruedTargetWorldTick,s.load().state.worldTick);
        assert.deepEqual(checkGameStateInvariants(s.load().state),[]);
      });
    } finally { installAuthoredWorkoutCatalog(oldCatalog); }
  });
  for (const path of ['/commands', '/session/open', '/session/heartbeat', '/session/end']) {
    await report(`boundary: no provider fails closed at ${path} before creating state`, async () => {
      const store = new InMemoryGameStateStore();
      await serve(createSessionHost(createInMemoryPersistence(store)), {}, async post => {
        const result = await post(path, { commandId: 'GET_GAME_STATE', playerId: 'victim', requestId: 'r' });
        assert.equal(result.status, 503); assert.equal(store.load('victim').ok, false);
      });
    });
    await report(`boundary: authenticated body identity cannot select a victim at ${path}`, async () => {
      const store = new InMemoryGameStateStore();
      await serve(createSessionHost(createInMemoryPersistence(store)), authenticated, async post => {
        const result = await post(path, { commandId: 'SET_PLAYER_PAUSE', parameters: { paused: true }, playerId: 'bob', requestId: 'r' }, 'test-alice');
        assert.equal(result.status, 403); assert.equal(store.load('bob').ok, false); assert.equal(store.load('alice').ok, false);
      });
    });
  }
  await report('boundary: credentials required, body identity optional, no guest fallback', async () => {
    const store = new InMemoryGameStateStore();
    await serve(createSessionHost(createInMemoryPersistence(store)), authenticated, async post => {
      assert.equal((await post('/commands', { commandId: 'GET_GAME_STATE', playerId: 'alice' })).status, 401);
      const result = await post('/commands', { commandId: 'GET_GAME_STATE' }, 'test-alice');
      assert.equal(result.status, 200); assert.equal(result.body.playerId, 'alice'); assert.ok(store.load('alice').ok);
    });
  });
  await report('boundary: trusted provider failure exposes no exception or credentials', async () => {
    await serve(createSessionHost(createInMemoryPersistence()), { identity: { mode: 'authenticated', authenticate: () => { throw new Error('private-token-and-stack'); } } }, async post => {
      const result = await post('/commands', { commandId: 'GET_GAME_STATE' }, 'token');
      assert.equal(result.status, 503); assert.ok(!result.raw.includes('private-token-and-stack'));
    });
  });
  await report('boundary: development identity forbidden in production', async () => {
    const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
    try { assert.throws(() => createCommandHttpServer(createSessionHost(createInMemoryPersistence()), { identity: { mode: 'development' } }), /forbidden/); }
    finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
  });
  await report('boundary: readiness requires identity and a successful trusted dependency probe', async () => {
    const ready={...authenticated,readiness:()=>true};
    for (const options of [{}, { identity: { mode: 'development' as const } }, authenticated,ready,
      {...authenticated,readiness:()=>false},{...authenticated,readiness:()=>{throw new Error('private-connection-detail');}}]) await serve(createSessionHost(createInMemoryPersistence()), options, async post => {
      assert.equal((await post('/health')).status, 200);
      const result=await post('/ready');assert.equal(result.status, options === ready ? 200 : 503);
      assert.ok(!result.raw.includes('private-connection-detail'));
    });
  });
  await report('boundary: foreign gameplay session cannot renew or end another empire', async () => {
    const store = new InMemoryGameStateStore();
    await serve(createSessionHost(createInMemoryPersistence(store), { nowMs: () => 1000 }), authenticated, async post => {
      const opened = await post('/session/open', { requestId: 'bob-open' }, 'test-bob'); assert.equal(opened.status, 200);
      const before = store.load('bob'); assert.ok(before.ok);
      for (const path of ['/session/heartbeat', '/session/end']) {
        const result = await post(path, { requestId: 'alice-r', gameplaySessionId: opened.body.sessionId, renewalSequence: 1 }, 'test-alice');
        assert.equal(result.status, 200);
        assert.equal(result.body.outcome, 'unknown_session');
        assert.equal(result.body.receiptMs, null);
      }
      const after = store.load('bob'); assert.ok(after.ok); assert.deepEqual(after.record, before.record);
    });
  });
  await report('boundary: public catalog advertises only exposed implemented commands', async () => {
    await serve(createSessionHost(createInMemoryPersistence()), authenticated, async post => {
      const result = await post('/commands', { commandId: 'GET_COMMAND_INDEX' }, 'test-alice');
      const payload = result.body.payload as { commands: { commandId: string; status: string }[] };
      assert.ok(payload.commands.length > 0); assert.ok(payload.commands.every(c => c.status === 'implemented'));
      for (const id of ['DECLARE_WAR','NEGOTIATE','REINFORCE','ADVANCE_WORLD','AI_DECIDE','RESOLVE_COMMITMENT']) {
        assert.ok(!payload.commands.some(c => c.commandId === id));
        assert.equal((await post('/commands', { commandId: id }, 'test-alice')).status, 403);
      }
    });
  });
  await report('boundary: nested exact plan cannot commandeer an AI faction', async () => {
    const state = createGameState(); initializeRecruitment(state);
    const fid = state.allFactionIds.find(f => f !== state.playerFactionId)!;
    const territoryId = state.factions.get(fid)!.territories[0]!;
    state.territoryRecruitment.get(territoryId)!.troops = 10;
    const plan = makeConcretePlan({ action: 'REINFORCE', factionId: fid, territoryId, sourcePoolId: recruitmentPoolId(territoryId), quantity: 1, destination: { kind: 'garrison', territoryId } });
    const orch = new Orchestrator(state), before = snapshotGameState(state);
    const result = orch.execute({ commandId: 'REINFORCE', playerId: 'alice', parameters: { plan } });
    assert.equal(result.success, false); assert.equal(result.errors[0]!.code, 'ACTION_NOT_ALLOWED');
    assert.deepEqual(snapshotGameState(orch.getState()), before);
  });
  await report('boundary: player command cannot claim a server operation association', async () => {
    const state = createGameState(), orch = new Orchestrator(state), before = snapshotGameState(state);
    const armyId = state.factions.get(state.playerFactionId!)!.armies[0]!;
    for (const parameters of [{ commitmentId: 'internal-operation' }, { operationId: 'internal-operation' }]) {
      const result = orch.execute({ commandId: 'MOVE', playerId: 'alice', parameters: { armyId, destinationTerritoryId: 't_02', ...parameters } });
      assert.equal(result.success, false); assert.equal(result.errors[0]!.code, 'ACTION_NOT_ALLOWED');
      assert.deepEqual(snapshotGameState(orch.getState()), before);
    }
  });
  await report('boundary: server timestamps ignore forged client clocks throughout locked reward flow', async () => {
    const oldCatalog = getAuthoredWorkoutCatalog(), s = scenario(); let now = 1000;
    s.host = createSessionHost(s.persistence, { nowMs: () => now });
    const options: CommandHttpOptions = { identity: { mode: 'authenticated', authenticate: () => 'r1-d-player' } };
    try { await serve(s.host, options, async post => {
      const started = await post('/commands', { ...await open(s), timestamp: 999999999999999, parameters: { purpose: 'NORMAL_TROOPS', size: 'SHORT', now: 999999999999999 } });
      assert.equal(started.body.success, true); assert.equal(s.load().state.playerFitness.activeSession!.startedAt, 1000);
      const lock = s.load().state.playerFitness.activeSession!.completionRewardEntitlement;
      while (s.load().state.playerFitness.activeSession!.state === 'ACTIVE') {
        const step = getCurrentExercise(s.load().state.playerFitness.activeSession!)!; now += 1000;
        const result = await post('/commands', { commandId: 'RECORD_EXERCISE', parameters: { order: step.order, now: -1e12,
          ...(step.prescription.kind === 'repetitions' ? { repetitions: step.prescription.repetitions } : { durationSeconds: step.prescription.durationSeconds }) } });
        assert.equal(result.body.success, true); assert.equal(s.load().state.playerFitness.activeSession!.performances[step.order]!.completedAt, now);
      }
      assert.deepEqual(s.load().state.playerFitness.activeSession!.completionRewardEntitlement, lock);
      const finalCommand = { commandId: 'FINALIZE_WORKOUT', requestId: 'finish', gameplaySessionId: s.load().state.gameplaySessionLeases[0]!.sessionId, commandSequence: 2, renewalSequence: 2, parameters: { now: 1e15, reward: 1e9 } };
      const paid = await post('/commands', finalCommand);
      assert.equal(paid.body.success, true);
      const reward = (paid.body.payload as { workoutReward: WorkoutRewardView }).workoutReward;
      assert.equal(reward.status, 'SETTLED'); assert.equal(reward.currentBankedTroops, lock!.soldiers);
      const before = snapshotGameState(s.load().state);
      const retry = await post('/commands', { ...finalCommand, parameters: { ...finalCommand.parameters, now: -1e15 } });
      assert.equal(retry.body.success, true); assert.deepEqual(snapshotGameState(s.load().state), before);
      assert.equal(s.load().state.worldTick, 0);
    }); } finally { installAuthoredWorkoutCatalog(oldCatalog); }
  });
  await report('boundary: forged caller time does not change canonical command identity or retry', async () => {
    const oldCatalog = getAuthoredWorkoutCatalog(), s = scenario();
    try {
      const start = await open(s), first = await s.host.execute(start);
      const before = snapshotGameState(s.load().state);
      const retry = await s.host.execute({ ...start, parameters: { ...start.parameters, now: 1e15 }, timestamp: -1e15 });
      assert.ok(first.success && retry.success && retry.idempotentReplay);
      assert.deepEqual(snapshotGameState(s.load().state), before);
      assert.deepEqual((retry as CommandResponse).payload, JSON.parse(JSON.stringify(first.payload)));
    } finally { installAuthoredWorkoutCatalog(oldCatalog); }
  });
}
