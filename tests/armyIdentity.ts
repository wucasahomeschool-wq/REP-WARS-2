import assert from 'assert';
import { createLegacySampleMapGameState } from '../src/state/createGameState';
import { Orchestrator } from '../src/orchestration/orchestrator';
import { GameState, GAME_STATE_SCHEMA_VERSION } from '../src/types/GameState';
import { WARLORD_SPECS } from '../src/simulation/SampleMap';
import { checkGameStateInvariants } from '../src/state/gameStateInvariants';
import { snapshotGameState } from '../src/persistence/snapshot';
import { hydratePersistedPayload } from '../src/persistence/hydrate';
import { encodePersistable } from '../src/persistence/serialization';
import { allocateArmyId } from '../src/army/identity';
import { runStateTransaction } from '../src/orchestration/transaction';
import { InMemoryGameStateStore } from '../src/persistence/inMemoryGameStateStore';
import { InMemoryWorkoutHistoryStore } from '../src/fitness/history/inMemoryStore';
import { ensurePlayerWorld } from '../src/persistence/initializePlayerWorld';
import { createSessionHost } from '../src/server/session';
import { PlayerWorldPersistence } from '../src/server/persistencePort';
import { createGameState } from '../src/state/createGameState';
import { buildNextWorldState } from '../src/gameplay/worldTransition';
import { setFixturePeace } from './aiOperationFixtures';

function fixture(): GameState {
  const state = createLegacySampleMapGameState({
    seed: 31, playerFactionId: 'iron_kingdom',
    mapSpecs: ['home', 'target1', 'target2', 'target3', 'enemyhome'].map(id => ({
      id, name: id, terrain: 'plains' as const,
      neighbors: id === 'home' ? ['target1', 'target2', 'target3', 'enemyhome'] : ['home'],
      population: 100, baseValue: 1, resourceOutput: {}, fortification: 0, garrison: 0,
      isCapital: false, owner: id === 'home' ? 'iron_kingdom' : 'celestial_theocracy',
    })),
    warlordSpecs: ['iron_kingdom', 'celestial_theocracy'].map(id => ({
      ...WARLORD_SPECS.find(f => f.id === id)!,
      startingTerritories: id === 'iron_kingdom' ? ['home'] : ['enemyhome', 'target1', 'target2', 'target3'],
      startingArmy: { soldiers: 1, knights: 0, siege: 0 },
      relationships: [],
    })),
  });
  state.playerRewards.bankedTroops = 1000;
  assert.deepStrictEqual(checkGameStateInvariants(state), []);
  return state;
}

function attack(orch: Orchestrator, target: string, requestId = `attack_${target}`): string {
  const result = orch.execute({ commandId: 'ATTACK', playerId: 'c2_player', requestId,
    parameters: { territoryId: target, commitAmount: 101, seed: 7 } });
  assert.strictEqual(result.success, true, JSON.stringify(result.errors));
  assert.deepStrictEqual(checkGameStateInvariants(orch.getState()), []);
  return String(result.payload.committedArmyId);
}

function removeArmy(state: GameState, id: string): void {
  const army = state.armies.get(id)!;
  state.factions.get(army.owner)!.armies = state.factions.get(army.owner)!.armies.filter(a => a !== id);
  state.armies.delete(id);
}

export function registerArmyIdentityTests({ test }: { test: (name: string, fn: () => void | Promise<void>) => void }): void {
  test('C2 same-tick deletion of another army cannot collide with a live banked army', () => {
    const orch = new Orchestrator(fixture());
    const old = orch.getState().factions.get('iron_kingdom')!.armies[0]!;
    const first = attack(orch, 'target1');
    removeArmy(orch.getState(), old);
    const second = attack(orch, 'target2');
    assert.notStrictEqual(first, second);
    assert.ok(orch.getState().armies.has(first));
    assert.strictEqual(orch.getState().worldTick, 0);
  });

  test('C2 deleted banked army identity cannot be reused at the same tick and count', () => {
    const orch = new Orchestrator(fixture());
    const count = orch.getState().armies.size;
    const first = attack(orch, 'target1');
    const receipts = new Map(orch.getState().conflictEventReceipts);
    removeArmy(orch.getState(), first);
    assert.strictEqual(orch.getState().armies.size, count);
    const second = attack(orch, 'target2');
    assert.notStrictEqual(first, second);
    // Prior causal facts are retained, not erased to permit a new identity.
    for (const [id, value] of receipts) assert.deepStrictEqual(orch.getState().conflictEventReceipts.get(id), value);
    assert.ok(JSON.stringify([...receipts]).includes(first));
  });

  test('C2 multiple same-tick creations preserve bank, physical troops, resources and claims', () => {
    const orch = new Orchestrator(fixture());
    const initial = orch.getState();
    const resources = structuredClone([...initial.factions.values()].map(f => f.resources));
    const claims = encodePersistable(initial.operationClaims);
    const total = initial.playerRewards.bankedTroops + [...initial.armies.values()].reduce((s, a) => s + a.soldiers, 0);
    const ids = ['target1', 'target2', 'target3'].map(t => attack(orch, t));
    const state = orch.getState();
    assert.strictEqual(new Set(ids).size, 3);
    assert.strictEqual(new Set([...state.armies.values()].map(a => a.id)).size, state.armies.size);
    assert.strictEqual(state.playerRewards.bankedTroops, 697);
    assert.strictEqual(state.playerRewards.bankedTroops + [...state.armies.values()].reduce((s, a) => s + a.soldiers, 0), total);
    assert.deepStrictEqual([...state.factions.values()].map(f => f.resources), resources);
    assert.deepStrictEqual(encodePersistable(state.operationClaims), claims);
    assert.strictEqual(state.nextArmySequence, 3);
    assert.strictEqual(state.worldTick, 0);
  });

  test('C2 identical canonical inputs and commands replay identical identities and state', () => {
    const a = new Orchestrator(fixture()), b = new Orchestrator(fixture());
    const first = attack(a, 'target1');
    assert.strictEqual(attack(b, 'target1'), first);
    removeArmy(a.getState(), first);
    removeArmy(b.getState(), first);
    assert.strictEqual(attack(a, 'target2'), attack(b, 'target2'));
    assert.deepStrictEqual(snapshotGameState(a.getState()), snapshotGameState(b.getState()));
  });

  test('C2 insertion order, tick, amount and wall clock do not allocate identities', () => {
    const a = fixture(), b = fixture();
    b.armies = new Map([...b.armies].reverse());
    b.worldTick = b.accruedTargetWorldTick = 300;
    b.playerRewards.bankedTroops = 900;
    b.lastProcessedAtMs = 123456;
    const ai = allocateArmyId(a), bi = allocateArmyId(b);
    assert.strictEqual(ai, bi);
    assert.strictEqual(a.nextArmySequence, b.nextArmySequence);
  });

  test('C2 save/reload after removal retains the high-water mark and retired references', () => {
    const orch = new Orchestrator(fixture());
    const first = attack(orch, 'target1');
    removeArmy(orch.getState(), first);
    const saved = snapshotGameState(orch.getState());
    const loaded = hydratePersistedPayload(saved);
    assert.deepStrictEqual(snapshotGameState(loaded), saved);
    const next = new Orchestrator(loaded);
    assert.notStrictEqual(attack(next, 'target2'), first);
    assert.strictEqual(next.getState().nextArmySequence, 2);
    assert.ok([...next.getState().conflictEventReceipts.keys()].some(id => id.includes(first)));
  });

  test('C2 schema 27 migration preserves legacy armies and initializes only identity metadata', () => {
    const old = fixture();
    const original = old.factions.get('iron_kingdom')!.armies[0]!;
    const army = old.armies.get(original)!;
    const legacyId = 'banked_iron_kingdom_0_101_2';
    old.armies.delete(original);
    army.id = legacyId;
    old.armies.set(legacyId, army);
    old.factions.get(army.owner)!.armies = [legacyId];
    old.schemaVersion = 27;
    delete (old as Partial<GameState>).nextArmySequence;
    const physical = encodePersistable({ armies: old.armies, rewards: old.playerRewards, claims: old.operationClaims,
      operations: old.operations, responses: old.aiResponses, ledger: old.conflictEventReceipts });
    const loaded = hydratePersistedPayload(encodePersistable(old));
    assert.strictEqual(loaded.schemaVersion, GAME_STATE_SCHEMA_VERSION);
    assert.strictEqual(loaded.nextArmySequence, 0);
    assert.deepStrictEqual(encodePersistable({ armies: loaded.armies, rewards: loaded.playerRewards, claims: loaded.operationClaims,
      operations: loaded.operations, responses: loaded.aiResponses, ledger: loaded.conflictEventReceipts }), physical);
    assert.deepStrictEqual(snapshotGameState(hydratePersistedPayload(snapshotGameState(loaded))), snapshotGameState(loaded));
    const orch = new Orchestrator(loaded);
    assert.notStrictEqual(attack(orch, 'target1'), legacyId);
    assert.ok(orch.getState().armies.has(legacyId));
  });

  test('C2 legacy import floors reserved identities without lowering a supplied high-water mark', () => {
    const old = fixture();
    const id = old.factions.get('iron_kingdom')!.armies[0]!;
    const army = old.armies.get(id)!;
    old.armies.delete(id);
    army.id = 'army:v1:9';
    old.armies.set(army.id, army);
    old.factions.get(army.owner)!.armies = [army.id];
    old.schemaVersion = 27;
    delete (old as Partial<GameState>).nextArmySequence;
    const floored = hydratePersistedPayload(encodePersistable(old));
    assert.strictEqual(floored.nextArmySequence, 10);
    old.nextArmySequence = 37;
    assert.strictEqual(hydratePersistedPayload(encodePersistable(old)).nextArmySequence, 37);
  });

  test('C2 current-schema missing, invalid and regressed counters fail closed on hydration', () => {
    const orch = new Orchestrator(fixture());
    attack(orch, 'target1');
    for (const sequence of [undefined, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 0]) {
      const damaged = hydratePersistedPayload(snapshotGameState(orch.getState()));
      damaged.nextArmySequence = sequence as number;
      assert.throws(() => hydratePersistedPayload(encodePersistable(damaged)), /identity sequence/);
    }
  });

  test('C2 exhausted and occupied identity allocations fail without overwriting or debiting troops', () => {
    const state = fixture();
    state.nextArmySequence = Number.MAX_SAFE_INTEGER;
    const before = snapshotGameState(state);
    assert.throws(() => allocateArmyId(state), /exhausted/);
    assert.deepStrictEqual(snapshotGameState(state), before);
    const orch = new Orchestrator(fixture());
    const first = attack(orch, 'target1');
    orch.getState().nextArmySequence = 0;
    const army = structuredClone(orch.getState().armies.get(first));
    const bank = orch.getState().playerRewards.bankedTroops;
    assert.throws(() => allocateArmyId(orch.getState()), /conflicts/);
    assert.deepStrictEqual(orch.getState().armies.get(first), army);
    assert.strictEqual(orch.getState().playerRewards.bankedTroops, bank);
  });

  test('C2 failure after allocation rolls back identity, troops, bank and causal receipts', () => {
    const state = fixture();
    setFixturePeace(state, 'iron_kingdom', 'celestial_theocracy');
    const before = snapshotGameState(state);
    assert.throws(() => runStateTransaction(state, draft => {
      allocateArmyId(draft);
      draft.playerRewards.bankedTroops--;
      throw new Error('abort after allocation');
    }), /abort after allocation/);
    assert.deepStrictEqual(snapshotGameState(state), before);
    const orch = new Orchestrator(state);
    // Spawn is legal, but hostility validation rejects after force allocation.
    const failed = orch.execute({ commandId: 'ATTACK', playerId: 'c2_player', parameters: { territoryId: 'target1', commitAmount: 101 } });
    assert.strictEqual(failed.success, false);
    assert.ok(failed.errors.some(e => e.message.includes('Peace')));
    assert.deepStrictEqual(snapshotGameState(orch.getState()), before);
    orch.getState().peaceRelationships.clear();
    assert.strictEqual(attack(orch, 'target1'), allocateArmyId(fixture()));
  });

  test('C2 CAS conflict serializes competing allocations and retry creates only the next army', () => {
    const store = new InMemoryGameStateStore();
    assert.ok(store.save('c2_cas', fixture(), 0).ok);
    const a = store.load('c2_cas'), b = store.load('c2_cas');
    assert.ok(a.ok && b.ok);
    if (!a.ok || !b.ok) throw new Error('load');
    const ao = new Orchestrator(a.state), bo = new Orchestrator(b.state);
    const first = attack(ao, 'target1');
    assert.strictEqual(attack(bo, 'target2'), first, 'Concurrent drafts share the next identity until CAS selects one');
    assert.ok(store.save('c2_cas', ao.getState(), a.record.stateVersion).ok);
    const stale = store.save('c2_cas', bo.getState(), b.record.stateVersion);
    assert.ok(!stale.ok && stale.code === 'persistence.conflict');
    const reloaded = store.load('c2_cas');
    assert.ok(reloaded.ok);
    if (!reloaded.ok) throw new Error('reload');
    const retry = new Orchestrator(reloaded.state);
    const second = attack(retry, 'target2');
    assert.notStrictEqual(second, first);
    assert.ok(store.save('c2_cas', retry.getState(), reloaded.record.stateVersion).ok);
    assert.strictEqual(retry.getState().nextArmySequence, 2);
    assert.strictEqual(retry.getState().playerRewards.bankedTroops, 798);
  });

  test('C2 lost-response retry after server restart returns the persisted army without allocating again', async () => {
    const store = new InMemoryGameStateStore();
    assert.ok(store.save('c2_retry', fixture(), 0).ok);
    const persistence: PlayerWorldPersistence = {
      name: 'memory', history: new InMemoryWorkoutHistoryStore(),
      ensure: playerId => ensurePlayerWorld({ playerId, store }),
      save: (playerId, state, version) => store.save(playerId, state, version),
    };
    const host = createSessionHost(persistence, { nowMs: () => 1000 });
    const opened = await host.openGameplaySession('c2_retry', 'open');
    const request = { commandId: 'ATTACK', playerId: 'c2_retry', gameplaySessionId: opened.sessionId,
      commandSequence: 1, renewalSequence: 1, requestId: 'attack_lost', parameters: { territoryId: 'target1', commitAmount: 101, seed: 7 } };
    const lost = await host.execute(request);
    assert.strictEqual(lost.success, true, JSON.stringify(lost.errors));
    const before = store.load('c2_retry');
    assert.ok(before.ok);
    if (!before.ok) throw new Error('load');
    const restart = createSessionHost(persistence, { nowMs: () => 1000 });
    const retry = await restart.execute(request);
    assert.strictEqual(retry.idempotentReplay, true);
    assert.strictEqual(retry.payload.committedArmyId, lost.payload.committedArmyId);
    const after = store.load('c2_retry');
    assert.ok(after.ok);
    if (!after.ok) throw new Error('reload');
    assert.deepStrictEqual(snapshotGameState(after.state), snapshotGameState(before.state));
    assert.strictEqual(after.state.nextArmySequence, 1);
    assert.strictEqual(after.state.playerRewards.bankedTroops, 899);
  });

  test('C2 campaign transition preserves the identity high-water mark', () => {
    const state = createGameState({ seed: 1 });
    state.nextArmySequence = 29;
    for (const t of state.territories.values()) t.owner = state.playerFactionId;
    const built = buildNextWorldState(state);
    assert.ok(built.next);
    assert.strictEqual(built.next.nextArmySequence, 29);
    assert.strictEqual(allocateArmyId(built.next), 'army:v1:29');
    assert.strictEqual(state.nextArmySequence, 29);
  });

  test('C2 last safe sequence allocates once and exhaustion cannot wrap to a retired identity', () => {
    const state = fixture();
    state.nextArmySequence = Number.MAX_SAFE_INTEGER - 1;
    assert.strictEqual(allocateArmyId(state), `army:v1:${Number.MAX_SAFE_INTEGER - 1}`);
    assert.strictEqual(state.nextArmySequence, Number.MAX_SAFE_INTEGER);
    const before = snapshotGameState(state);
    assert.throws(() => allocateArmyId(state), /exhausted/);
    assert.deepStrictEqual(snapshotGameState(state), before);
  });

  test('C2 two actual same-tick battle losses retain distinct army and battle identities', () => {
    const state = fixture();
    state.territories.get('target1')!.garrison = 5000;
    const orch = new Orchestrator(state);
    const count = state.armies.size;
    const first = attack(orch, 'target1', 'lost_attack_1');
    assert.strictEqual(orch.getState().armies.has(first), false);
    assert.strictEqual(orch.getState().armies.size, count);
    const second = attack(orch, 'target1', 'lost_attack_2');
    assert.notStrictEqual(first, second);
    assert.strictEqual(orch.getState().armies.has(second), false);
    assert.strictEqual(orch.getState().armies.size, count);
    const battles = [...orch.getState().conflictEventReceipts.values()].map(r => JSON.parse(r.signature))
      .filter(r => r.kind === 'BATTLE');
    assert.strictEqual(battles.length, 2);
    assert.deepStrictEqual(battles.map(r => r.troopLosses[0]), [101, 101]);
    assert.strictEqual(orch.getState().playerRewards.bankedTroops, 798);
    assert.strictEqual(orch.getState().nextArmySequence, 2);
  });

  test('C2 a migrated schema-27 command receipt still replays its unchanged legacy army ID', async () => {
    const store = new InMemoryGameStateStore();
    assert.ok(store.save('c2_legacy_retry', fixture(), 0).ok);
    const persistence: PlayerWorldPersistence = {
      name: 'memory', history: new InMemoryWorkoutHistoryStore(),
      ensure: playerId => ensurePlayerWorld({ playerId, store }),
      save: (playerId, state, version) => store.save(playerId, state, version),
    };
    const host = createSessionHost(persistence, { nowMs: () => 1000 });
    const opened = await host.openGameplaySession('c2_legacy_retry', 'open');
    const request = { commandId: 'ATTACK', playerId: 'c2_legacy_retry', gameplaySessionId: opened.sessionId,
      commandSequence: 1, renewalSequence: 1, requestId: 'legacy_attack', parameters: { territoryId: 'target1', commitAmount: 101, seed: 7 } };
    const first = await host.execute(request);
    assert.strictEqual(first.success, true, JSON.stringify(first.errors));
    const saved = store.load('c2_legacy_retry');
    assert.ok(saved.ok);
    if (!saved.ok) throw new Error('load');
    // Model the schema-27 representation of this actual command, including
    // its real persisted receipt and causal references, using the old ID form.
    const legacyId = 'banked_iron_kingdom_0_101_2';
    saved.state.schemaVersion = 27;
    delete (saved.state as Partial<GameState>).nextArmySequence;
    const legacyPayload = JSON.parse(JSON.stringify(encodePersistable(saved.state))
      .split(String(first.payload.committedArmyId)).join(legacyId));
    const migrated = hydratePersistedPayload(legacyPayload);
    assert.ok(store.save('c2_legacy_retry', migrated, saved.record.stateVersion).ok);
    const restart = createSessionHost(persistence, { nowMs: () => 1000 });
    const replay = await restart.execute(request);
    assert.strictEqual(replay.idempotentReplay, true);
    assert.strictEqual(replay.payload.committedArmyId, legacyId);
    const after = store.load('c2_legacy_retry');
    assert.ok(after.ok);
    if (!after.ok) throw new Error('reload');
    assert.ok(after.state.armies.has(legacyId));
    assert.strictEqual(after.state.nextArmySequence, 0);
    assert.strictEqual(after.state.playerRewards.bankedTroops, 899);
    const next = await restart.execute({ ...request, requestId: 'next_attack', commandSequence: 2, renewalSequence: 2,
      parameters: { territoryId: 'target2', commitAmount: 101, seed: 7 } });
    assert.strictEqual(next.success, true, JSON.stringify(next.errors));
    assert.notStrictEqual(next.payload.committedArmyId, legacyId);
  });
}
