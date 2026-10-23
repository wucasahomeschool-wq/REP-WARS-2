import assert from 'node:assert/strict';
import { createSessionHost, CommandSessionHost, PersistenceFailedError } from '../src/server/session';
import { createInMemoryPersistence, PlayerWorldPersistence } from '../src/server/persistencePort';
import { InMemoryGameStateStore } from '../src/persistence/inMemoryGameStateStore';
import { snapshotGameState } from '../src/persistence/snapshot';
import { serializePublicGameState } from '../src/orchestration/publicView';
import { ErrorCode } from '../src/orchestration/errors';
import { scenario, finish } from './workoutStartRewards';
import { getAuthoredWorkoutCatalog, installAuthoredWorkoutCatalog } from '../src/fitness/authoring/registry';
import { RoutingHistoryStore } from '../src/persistence/supabase/commandHistoryBuffer';

type Report = (name: string, fn: () => Promise<void>) => Promise<void>;
const read = (host: CommandSessionHost, playerId: string) => host.execute({ commandId: 'GET_GAME_STATE', playerId });
const pause = (host: CommandSessionHost, playerId: string, paused: boolean) => host.execute({
  commandId: 'SET_PLAYER_PAUSE', playerId, parameters: { paused },
});
function fixture(maxCachedPlayers: number | undefined = 1) {
  let now = 1000;
  const store = new InMemoryGameStateStore(), base = createInMemoryPersistence(store), loads = new Map<string, number>();
  const persistence: PlayerWorldPersistence = { ...base, ensure(id) {
    loads.set(id, (loads.get(id) ?? 0) + 1); return base.ensure(id);
  } };
  const options = { nowMs: () => now, maxCachedPlayers };
  const host = createSessionHost(persistence, options);
  function load(id: string) { const r = store.load(id); assert.ok(r.ok); return r; }
  return { store, base, persistence, host, loads, load, setTime: (ms: number) => { now = ms; } };
}

export async function runSessionCacheTests(report: Report): Promise<void> {
  await report('cache: capacity evicts idle worlds and reloads without writes', async () => {
    const s = fixture(1);
    await read(s.host, 'a'); const before = snapshotGameState(s.load('a').state);
    await read(s.host, 'b'); const writes = s.store.saveCount.value;
    await read(s.host, 'a');
    assert.equal(s.loads.get('a'), 2);
    assert.equal(s.store.saveCount.value, writes);
    assert.deepEqual(snapshotGameState(s.load('a').state), before);
  });
  await report('cache: recent reads retain a hot world and evict the least recently used', async () => {
    const s = fixture(2);
    for (const id of ['a', 'b', 'a', 'c', 'a', 'b']) await read(s.host, id);
    assert.equal(s.loads.get('a'), 1); assert.equal(s.loads.get('b'), 2); assert.equal(s.loads.get('c'), 1);
  });
  await report('cache: zero capacity disables idle retention', async () => {
    const s = fixture(0);
    await read(s.host, 'a'); await read(s.host, 'a');
    assert.equal(s.loads.get('a'), 2);
  });
  await report('cache: default retention is bounded at 128 idle player worlds', async () => {
    const s = fixture(), host = createSessionHost(s.persistence, { nowMs: () => 1000 });
    for (let i = 0; i < 129; i++) await read(host, `player-${i}`);
    await read(host, 'player-1'); assert.equal(s.loads.get('player-1'), 1);
    await read(host, 'player-128'); assert.equal(s.loads.get('player-128'), 1);
    await read(host, 'player-0'); assert.equal(s.loads.get('player-0'), 2);
  });
  await report('cache: invalid capacity is rejected before loading persistence', async () => {
    for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, '2']) {
      // Malformed deployment configuration must fail at runtime too.
      const maxCachedPlayers = value as unknown as number;
      const s = fixture(); const options = { nowMs: () => 1000, maxCachedPlayers };
      assert.throws(() => createSessionHost(s.persistence, options), /maxCachedPlayers/);
      assert.equal(s.loads.size, 0);
    }
  });
  await report('cache: queued work stays on one player chain despite capacity pressure', async () => {
    const s = fixture(0);
    const results = await Promise.all([pause(s.host, 'a', true), read(s.host, 'b'), pause(s.host, 'a', false), read(s.host, 'a')]);
    assert.ok(results.every(r => r.success)); assert.equal(s.loads.get('a'), 1);
    assert.equal(s.load('a').state.playerEmpirePause.paused, false);
    await read(s.host, 'a'); assert.equal(s.loads.get('a'), 2);
  });
  await report('cache: eviction preserves lost-response receipts and rejects stale commands', async () => {
    const s = fixture(1), opened = await s.host.openGameplaySession('a', 'open');
    const req = { commandId: 'SET_PLAYER_PAUSE', playerId: 'a', requestId: 'pause', gameplaySessionId: opened.sessionId,
      commandSequence: 1, renewalSequence: 1, parameters: { paused: true } };
    assert.ok((await s.host.execute(req)).success);
    const before = snapshotGameState(s.load('a').state);
    await read(s.host, 'b');
    const replay = await s.host.execute({ ...req, parameters: { paused: false } });
    assert.equal(replay.idempotentReplay, true); assert.equal(replay.payload.paused, true);
    assert.deepEqual(snapshotGameState(s.load('a').state), before);
    assert.ok((await s.host.execute({ ...req, requestId: 'unpause', commandSequence: 2, renewalSequence: 2, parameters: { paused: false } })).success);
    await read(s.host, 'b');
    const stale = await s.host.execute(req); assert.equal(stale.errors[0]?.code, ErrorCode.COMMAND_STALE);
    assert.equal(s.load('a').state.playerEmpirePause.paused, false);
  });
  await report('cache: open heartbeat and end receipts survive eviction', async () => {
    const s = fixture(0), opened = await s.host.openGameplaySession('a', 'open');
    assert.equal((await s.host.openGameplaySession('a', 'open')).sessionId, opened.sessionId);
    await s.host.heartbeatGameplaySession('a', 'heartbeat', opened.sessionId, 1);
    assert.equal((await s.host.heartbeatGameplaySession('a', 'heartbeat', opened.sessionId, 1)).outcome, 'idempotent_replay');
    await s.host.endGameplaySession('a', 'end', opened.sessionId);
    const before = snapshotGameState(s.load('a').state);
    await s.host.endGameplaySession('a', 'end', opened.sessionId);
    assert.deepEqual(snapshotGameState(s.load('a').state), before);
  });
  await report('cache: a thrown save cannot expose its uncommitted draft to queued reads', async () => {
    const s = fixture(); let fail = true;
    const persistence: PlayerWorldPersistence = { ...s.persistence, save(...args) {
      if (fail) { fail = false; throw new Error('injected transport failure'); }
      return s.base.save(...args);
    } };
    const host = createSessionHost(persistence, { nowMs: () => 1000 });
    await read(host, 'a'); const before = s.load('a').state;
    const rejected = assert.rejects(pause(host, 'a', true), /transport failure/);
    const queued = read(host, 'a'); await rejected;
    assert.deepEqual((await queued).payload.gameState, serializePublicGameState(before, before.playerFactionId));
    assert.deepEqual(snapshotGameState(s.load('a').state), snapshotGameState(before));
    assert.ok((await pause(host, 'a', true)).success); assert.equal(s.load('a').state.playerEmpirePause.paused, true);
  });
  await report('cache: eviction keeps CAS authoritative against another host', async () => {
    const s = fixture(1), other = createSessionHost(s.persistence, { nowMs: () => 1000 });
    await read(s.host, 'a'); await read(other, 'a');
    assert.ok((await pause(other, 'a', true)).success);
    await assert.rejects(pause(s.host, 'a', false), (e: unknown) => e instanceof PersistenceFailedError && e.code === 'persistence.conflict');
    assert.equal(s.load('a').state.playerEmpirePause.paused, true);
    await read(s.host, 'b'); assert.ok((await pause(s.host, 'a', false)).success);
    assert.equal(s.load('a').state.playerEmpirePause.paused, false);
  });
  await report('cache: failed authoritative reload cannot revive a dirty draft or poison later recovery', async () => {
    const s = fixture(); let unavailable = false;
    const persistence: PlayerWorldPersistence = { ...s.persistence,
      ensure(id) { if (unavailable) throw new Error('load unavailable'); return s.persistence.ensure(id); },
      save() { unavailable = true; throw new Error('write unavailable'); },
    };
    const host = createSessionHost(persistence, { nowMs: () => 1000 });
    await read(host, 'a'); const before = s.load('a').state;
    const write = assert.rejects(pause(host, 'a', true), /write unavailable/);
    const queued = assert.rejects(read(host, 'a'), /load unavailable/);
    await Promise.all([write, queued]);
    unavailable = false;
    const recovered = await read(host, 'a');
    assert.deepEqual(recovered.payload.gameState, serializePublicGameState(before, before.playerFactionId));
    assert.deepEqual(snapshotGameState(s.load('a').state), snapshotGameState(before));
  });
  await report('cache: eviction has no effect on deterministic simulation or earned time', async () => {
    const a = fixture(0), b = fixture(4);
    for (const s of [a, b]) {
      const host = s.host;
      await read(host, 'a'); await pause(host, 'a', true); await read(host, 'b');
      s.setTime(601000);
      await pause(host, 'a', false); assert.ok((await host.execute({ commandId: 'SYNC_PLAYER_WORLD', playerId: 'a' })).success);
      assert.equal(s.load('a').state.worldTick, 1);
    }
    assert.deepEqual(snapshotGameState(a.load('a').state), snapshotGameState(b.load('a').state));
  });
  await report('cache: committed reward survives a lost response and eviction without paying twice', async () => {
    const prior = getAuthoredWorkoutCatalog();
    try {
      const s = scenario(), playerId = 'r1-d-player'; let lost = false;
      const history = new RoutingHistoryStore(s.history);
      const persistence: PlayerWorldPersistence = { ...s.persistence, history, commitWorld(id, state, version, entries) {
        const saved = s.persistence.save(id, state, version);
        if (saved.ok) for (const entry of entries) s.history.upsert(entry);
        if (saved.ok && entries.some(entry => entry.completionRewardEntitlement) && !lost) { lost = true; throw new Error('lost committed reply'); }
        return saved;
      } };
      const options = { nowMs: () => 1000, maxCachedPlayers: 0 }, host = createSessionHost(persistence, options);
      const opened = await host.openGameplaySession(playerId, 'open');
      assert.ok((await host.execute({ commandId: 'START_WORKOUT', playerId, requestId: 'start',
        gameplaySessionId: opened.sessionId, commandSequence: 1, renewalSequence: 1,
        parameters: { purpose: 'NORMAL_TROOPS', size: 'STANDARD' } })).success);
      const lock = s.load().state.playerFitness.activeSession!.completionRewardEntitlement;
      await finish(host, s);
      assert.deepEqual(s.load().state.playerFitness.activeSession!.completionRewardEntitlement, lock);
      const finalize = { commandId: 'FINALIZE_WORKOUT', playerId, requestId: 'finalize', gameplaySessionId: opened.sessionId,
        commandSequence: 2, renewalSequence: 2 };
      await assert.rejects(host.execute(finalize), /lost committed reply/);
      const before = snapshotGameState(s.load().state);
      assert.equal(s.load().state.playerRewards.bankedTroops, 125);
      const retry = await host.execute(finalize); assert.ok(retry.success); assert.equal(retry.idempotentReplay, true);
      assert.equal(s.load().state.playerRewards.bankedTroops, 125); assert.equal(s.load().state.playerRewards.appliedRewards.length, 1);
      assert.deepEqual(snapshotGameState(s.load().state), before);
      assert.deepEqual(s.history.get(playerId, s.load().state.playerFitness.activeSession!.sessionId)!.completionRewardEntitlement, lock);
    } finally { installAuthoredWorkoutCatalog(prior); }
  });
}
