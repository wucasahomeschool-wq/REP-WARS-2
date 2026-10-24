import assert from 'node:assert/strict';
import { createSessionHost, SessionHostOptions, PersistenceFailedError } from '../src/server/session';
import { createInMemoryPersistence, PlayerWorldPersistence } from '../src/server/persistencePort';
import { InMemoryGameStateStore } from '../src/persistence/inMemoryGameStateStore';
import { snapshotGameState } from '../src/persistence/snapshot';
import { accrueWorldThroughReceipt } from '../src/world/worldAccrual';
import { createLegacySampleMapGameState } from '../src/state/createGameState';
import { ensureCity } from '../src/gameplay/cities/city';
import { checkGameStateInvariants } from '../src/state/gameStateInvariants';
import { createActiveInvasion } from '../src/types/GameState';
import { startConstruction } from '../src/gameplay/construction/consume';
import { beginWorkoutSession, abandonWorkoutSession } from '../src/fitness/session';
import { RoutingHistoryStore } from '../src/persistence/supabase/commandHistoryBuffer';
import { createCommandHttpServer } from '../src/server/http';
import { openGameplaySessionLease } from '../src/world/presenceLeases';

type Report = (name: string, fn: () => Promise<void>) => Promise<void>;
type Options = SessionHostOptions;
function fixture(ticks = 150, maxCatchUpChunks = 1, wrap?: (p: PlayerWorldPersistence) => PlayerWorldPersistence, seed?: number, mixedPresence = false) {
  const store = new InMemoryGameStateStore(), base = createInMemoryPersistence(store);
  const initial = base.ensure('player');
  if (seed !== undefined) {
    initial.state = createLegacySampleMapGameState({ seed });
    for (const territory of initial.state.territories.values()) if (territory.owner) ensureCity(initial.state, territory.id, territory.owner);
  }
  accrueWorldThroughReceipt(initial.state, 1000);
  if (mixedPresence) initial.state.gameplaySessionLeases = [
    openGameplaySessionLease({ sessionId: 'history-online-a', receiptMs: 1000, leaseDurationMs: 600000 }),
    openGameplaySessionLease({ sessionId: 'history-online-b', receiptMs: 38001000, leaseDurationMs: 300000 }),
  ];
  let now = 1000 + ticks * 600000; // Real milliseconds at the existing 0.1x offline rate.
  accrueWorldThroughReceipt(initial.state, now);
  assert.ok(base.save('player', initial.state, initial.record.stateVersion).ok);
  const persistence = wrap ? wrap(base) : base;
  const options: Options = { nowMs: () => now, maxCatchUpChunks };
  const host = createSessionHost(persistence, options);
  const load = () => { const r = store.load('player'); assert.ok(r.ok); return r; };
  const sync = () => host.execute({ commandId: 'SYNC_PLAYER_WORLD', playerId: 'player' });
  return { host, persistence, base, store, options, load, sync, setNow: (ms: number) => { now = ms; } };
}

export async function runBoundedCatchupTests(report: Report): Promise<void> {
  await report('bounded catch-up: one request processes one chunk and retains all earned backlog', async () => {
    const s = fixture(), response = await s.sync();
    assert.equal(response.success, true);
    assert.equal(s.load().state.worldTick, 64);
    assert.equal(s.load().state.accruedTargetWorldTick, 150);
    assert.equal(response.payload.remainingTicks, 86); assert.equal(response.payload.complete, false);
    const reloaded = createSessionHost(s.persistence, s.options);
    await reloaded.execute({ commandId: 'SYNC_PLAYER_WORLD', playerId: 'player' });
    assert.equal(s.load().state.worldTick, 128);
    const completed = await reloaded.execute({ commandId: 'SYNC_PLAYER_WORLD', playerId: 'player' });
    assert.equal(s.load().state.worldTick, 150); assert.equal(completed.payload.complete, true);
  });
  await report('bounded catch-up: gameplay is deferred without consuming its logical receipt', async () => {
    const s = fixture(), lease = await s.host.openGameplaySession('player', 'open');
    const command = { commandId: 'SET_PLAYER_PAUSE', playerId: 'player', requestId: 'pause', parameters: { paused: true },
      gameplaySessionId: lease.sessionId, commandSequence: 1, renewalSequence: 1 };
    for (const tick of [64, 128]) {
      const response = await s.host.execute(command);
      assert.equal(response.success, false); assert.equal(response.errors[0]?.code, 'WORLD_CATCHUP_PENDING');
      const state = s.load().state;
      assert.equal(state.worldTick, tick); assert.equal(state.playerEmpirePause.paused, false);
      assert.equal(state.gameplaySessionLeases[0].lastCommandReceipt, null);
    }
    assert.ok((await s.host.execute(command)).success);
    const committed = snapshotGameState(s.load().state);
    assert.equal(s.load().state.worldTick, 150); assert.equal(s.load().state.playerEmpirePause.paused, true);
    assert.equal((await s.host.execute(command)).idempotentReplay, true);
    assert.deepEqual(snapshotGameState(s.load().state), committed);
  });
  await report('bounded catch-up: processing cadence and reload preserve the complete canonical outcome', async () => {
    const sliced = fixture(), whole = fixture(150, 100);
    for (let i = 0; i < 3; i++) {
      const host = createSessionHost(sliced.persistence, sliced.options);
      assert.ok((await host.execute({ commandId: 'SYNC_PLAYER_WORLD', playerId: 'player' })).success);
    }
    assert.ok((await whole.sync()).success);
    assert.deepEqual(snapshotGameState(sliced.load().state), snapshotGameState(whole.load().state));
  });
  await report('bounded catch-up: failed persistence keeps backlog and retries the same deterministic slice', async () => {
    let fail = true;
    const s = fixture(150, 1, port => ({ ...port, save(...args) {
      if (fail) { fail = false; throw new Error('injected slice write failure'); } return port.save(...args);
    } }));
    const before = snapshotGameState(s.load().state);
    await assert.rejects(s.sync(), /slice write failure/);
    assert.deepEqual(snapshotGameState(s.load().state), before);
    assert.ok((await s.sync()).success); assert.equal(s.load().state.worldTick, 64);
  });
  await report('bounded catch-up: clients cannot override the trusted chunk budget or earn extra ticks', async () => {
    const s = fixture();
    const result = await s.host.execute({ commandId: 'SYNC_PLAYER_WORLD', playerId: 'player',
      parameters: { maxCatchUpChunks: 999999, now: Number.MAX_SAFE_INTEGER }, clientContext: { maxCatchUpChunks: 999999 } });
    assert.ok(result.success); assert.equal(s.load().state.worldTick, 64); assert.equal(s.load().state.accruedTargetWorldTick, 150);
  });
  await report('bounded catch-up: invalid budgets fail at host construction', async () => {
    for (const value of [0, -1, 0.5, NaN, Infinity, null, '4']) {
      const options: Options = { maxCatchUpChunks: value as unknown as number };
      assert.throws(() => createSessionHost(createInMemoryPersistence(), options), /maxCatchUpChunks/);
    }
  });
  for (const seed of [11, 29]) await report(`bounded catch-up: active AI, operations and RNG match across budgets and reload, seed ${seed}`, async () => {
    for (const mixedPresence of [false, true]) {
      const whole = fixture(193, 100, undefined, seed, mixedPresence);
      const target = whole.load().state.accruedTargetWorldTick;
      assert.ok((await whole.sync()).success);
      const expected = snapshotGameState(whole.load().state);
      for (const budget of [1, 2]) {
        const sliced = fixture(193, budget, undefined, seed, mixedPresence);
        for (let request = 0; request < 5 && sliced.load().state.worldTick < target; request++) {
          const host = createSessionHost(sliced.persistence, sliced.options);
          const result = await host.execute({ commandId: 'SYNC_PLAYER_WORLD', playerId: 'player' });
          assert.ok(result.success, JSON.stringify(result.errors));
          assert.deepEqual(checkGameStateInvariants(sliced.load().state), []);
        }
        assert.deepEqual(snapshotGameState(sliced.load().state), expected);
      }
    }
  });
  await report('bounded catch-up: a sequenced partial sync replays its receipt and continues with a new sequence', async () => {
    const s = fixture(), lease = await s.host.openGameplaySession('player', 'open');
    const command = { commandId: 'SYNC_PLAYER_WORLD', playerId: 'player', requestId: 'sync-1',
      gameplaySessionId: lease.sessionId, commandSequence: 1, renewalSequence: 1 };
    const first = await s.host.execute(command); assert.ok(first.success); assert.equal(first.payload.complete, false);
    const before = snapshotGameState(s.load().state);
    const host = createSessionHost(s.persistence, s.options), replay = await host.execute(command);
    assert.equal(replay.idempotentReplay, true); assert.deepEqual(replay.payload, first.payload);
    assert.deepEqual(snapshotGameState(s.load().state), before);
    await host.execute({ ...command, requestId: 'sync-2', commandSequence: 2, renewalSequence: 2 });
    assert.equal(s.load().state.worldTick, 128);
    assert.equal((await host.execute(command)).errors[0]?.code, 'COMMAND_STALE');
  });
  await report('bounded catch-up: new earned time extends the backlog without replacing or dropping it', async () => {
    const s = fixture(); await s.sync();
    s.setNow(1000 + 151 * 600000 + 300000);
    await s.sync();
    const partial = s.load().state;
    assert.equal(partial.worldTick, 128); assert.equal(partial.accruedTargetWorldTick, 151);
    assert.equal(partial.subTickMicroticks, 500000);
    await s.sync(); assert.equal(s.load().state.worldTick, 151); assert.equal(s.load().state.subTickMicroticks, 500000);
  });
  await report('bounded catch-up: stale host cannot commit another version of a processed slice', async () => {
    const s = fixture(), other = createSessionHost(s.persistence, s.options);
    await s.host.execute({ commandId: 'GET_GAME_STATE', playerId: 'player' });
    await other.execute({ commandId: 'SYNC_PLAYER_WORLD', playerId: 'player' });
    const before = snapshotGameState(s.load().state);
    await assert.rejects(s.sync(), (e: unknown) => e instanceof PersistenceFailedError && e.code === 'persistence.conflict');
    assert.deepEqual(snapshotGameState(s.load().state), before);
    await s.sync(); assert.equal(s.load().state.worldTick, 128);
  });
  await report('bounded catch-up: lost partial-commit response resumes persisted progress without executing the deferred command twice', async () => {
    let lose = true;
    const s = fixture(150, 1, port => ({ ...port, save(...args) {
      const result = port.save(...args);
      if (result.ok && args[1].worldTick === 64 && lose) { lose = false; throw new Error('lost slice response'); }
      return result;
    } }));
    const lease = await s.host.openGameplaySession('player', 'open');
    const command = { commandId: 'SET_PLAYER_PAUSE', playerId: 'player', requestId: 'pause', parameters: { paused: true },
      gameplaySessionId: lease.sessionId, commandSequence: 1, renewalSequence: 1 };
    await assert.rejects(s.host.execute(command), /lost slice response/);
    assert.equal(s.load().state.worldTick, 64); assert.equal(s.load().state.playerEmpirePause.paused, false);
    assert.equal((await s.host.execute(command)).errors[0]?.code, 'WORLD_CATCHUP_PENDING');
    assert.equal(s.load().state.worldTick, 128);
    assert.ok((await s.host.execute(command)).success);
    assert.equal((await s.host.execute(command)).idempotentReplay, true);
  });
  await report('bounded catch-up: default host budget stops at four chunks', async () => {
    const s = fixture(300), host = createSessionHost(s.persistence, { nowMs: s.options.nowMs });
    const response = await host.execute({ commandId: 'SYNC_PLAYER_WORLD', playerId: 'player' });
    assert.ok(response.success); assert.equal(response.payload.chunks, 4);
    assert.equal(s.load().state.worldTick, 256); assert.equal(s.load().state.accruedTargetWorldTick, 300);
  });
  await report('bounded catch-up: smaller authorized targets leave earned backlog visible and excessive targets fail safely', async () => {
    const s = fixture();
    const response = await s.host.execute({ commandId: 'SYNC_PLAYER_WORLD', playerId: 'player', parameters: { targetWorldTick: 10 } });
    assert.ok(response.success); assert.equal(response.payload.complete, true); assert.equal(response.payload.backlogTicks, 140);
    const before = snapshotGameState(s.load().state);
    const invalid = await s.host.execute({ commandId: 'SYNC_PLAYER_WORLD', playerId: 'player', parameters: { targetWorldTick: 151 } });
    assert.equal(invalid.errors[0]?.code, 'TIME_UNAUTHORIZED'); assert.deepEqual(snapshotGameState(s.load().state), before);
  });
  await report('bounded catch-up: invasion expiry and construction settle in the same order across slices', async () => {
    const worlds = [fixture(150, 1, undefined, 11), fixture(150, 100, undefined, 11)];
    for (const s of worlds) {
      const loaded = s.load(), state = loaded.state;
      state.playerFactionId = 'iron_kingdom'; state.playerFitness.lastWorkoutCompletedAtTick = 0;
      state.activeInvasions.set('inv_slice', createActiveInvasion({ id: 'inv_slice', defenderFactionId: 'iron_kingdom',
        attackerFactionId: 'celestial_theocracy', territoryId: 'iron_kingdom_east', startedAtTick: 0, notifiedAtTick: 0, responseDeadlineTick: 30 }));
      startConstruction(state, { factionId: 'iron_kingdom', territoryId: 'iron_kingdom_east', projectType: 'FARM', projectId: 'con_slice' });
      assert.ok(s.base.save('player', state, loaded.record.stateVersion).ok);
    }
    await worlds[0].sync(); assert.equal(worlds[0].load().state.worldTick, 31);
    assert.equal(worlds[0].load().state.activeInvasions.has('inv_slice'), false);
    while (worlds[0].load().state.worldTick < 150) assert.ok((await worlds[0].sync()).success);
    assert.ok((await worlds[1].sync()).success);
    assert.deepEqual(snapshotGameState(worlds[0].load().state), snapshotGameState(worlds[1].load().state));
  });
  await report('bounded catch-up: terminal history and the partial world use one atomic commit and roll back together', async () => {
    let fail = true, staged = 0;
    const s = fixture(150, 1, port => ({ ...port, history: new RoutingHistoryStore(port.history), commitWorld(id, state, version, entries) {
      staged = entries.length;
      if (fail) return { ok: false, code: 'persistence.save_failed', message: 'injected atomic slice failure', persisted: false };
      const result = port.save(id, state, version);
      if (result.ok) for (const entry of entries) port.history.upsert(entry);
      return result;
    } }));
    const session = beginWorkoutSession({ playerId: 'player', sessionId: 'abandoned-before-catchup', purpose: 'NORMAL_TROOPS',
      intendedDifficulty: 'MODERATE', now: 1000, workout: { id: 'tiny-legacy-fixture', name: 'Tiny legacy fixture', description: 'Test only',
        intendedDifficulty: 'MODERATE', metadata: {}, exercises: [
          { exerciseId: 'ex_push_ups', order: 0, prescription: { kind: 'repetitions', repetitions: 10 }, role: 'UPPER_BODY', skippable: false },
        ] } });
    assert.ok(session.ok); const abandoned = abandonWorkoutSession(session.value, 2000, 'PLAYER'); assert.ok(abandoned.ok);
    const loaded = s.load(); loaded.state.playerFitness.activeSession = abandoned.value;
    assert.ok(s.base.save('player', loaded.state, loaded.record.stateVersion).ok);
    const before = snapshotGameState(s.load().state);
    await assert.rejects(s.sync(), /atomic slice failure/);
    assert.ok(staged > 0); assert.deepEqual(snapshotGameState(s.load().state), before); assert.deepEqual(s.base.history.clonePlayer('player'), []);
    fail = false; await s.sync(); assert.equal(s.load().state.worldTick, 64);
    assert.equal(s.base.history.get('player', abandoned.value.sessionId)?.completionState, 'ABANDONED');
    assert.equal(s.load().state.playerRewards.bankedTroops, 0);
  });
  await report('bounded catch-up: HTTP exposes durable progress and safe command deferral through the actual route', async () => {
    const s = fixture(), server = createCommandHttpServer(s.host, { identity: { mode: 'authenticated', authenticate: () => 'player' } });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    try {
      const post = async (commandId: string, parameters = {}) => {
        const response = await fetch(`http://127.0.0.1:${address.port}/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commandId, parameters }) });
        assert.equal(response.status, 200); return await response.json() as { success: boolean; errors: {code: string}[]; payload: Record<string, unknown> };
      };
      const deferred = await post('SET_PLAYER_PAUSE', { paused: true });
      assert.equal(deferred.success, false); assert.equal(deferred.errors[0].code, 'WORLD_CATCHUP_PENDING');
      assert.equal(deferred.payload.commandExecuted, false); assert.equal(deferred.payload.retryable, true);
      const sync = await post('SYNC_PLAYER_WORLD'); assert.equal(sync.payload.remainingTicks, 22); assert.equal(sync.payload.backlogTicks, 22);
      assert.ok((await post('SET_PLAYER_PAUSE', { paused: true })).success); assert.equal(s.load().state.worldTick, 150);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
}
