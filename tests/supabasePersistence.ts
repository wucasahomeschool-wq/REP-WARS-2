import assert from 'assert';
import { commitAuthoritativePlayerWorld, createGameState, PersistenceError, WORKOUT_HISTORY_FORMAT } from '../src';
import type { WorkoutHistoryEntry } from '../src/fitness/history/types';
import { MemoryPlayerWorldTable, SupabaseGameStateStore } from '../src/persistence/supabase/adapter';
import { MemoryWorkoutHistoryTable, SupabaseWorkoutHistoryStore } from '../src/persistence/supabase/historyAdapter';
import { SupabasePlayerWorldTable } from '../src/persistence/supabase/playerWorldTable';
import { SupabaseWorkoutHistoryTable } from '../src/persistence/supabase/historyTable';

export interface SupabasePersistenceTestApi {
  test: (name: string, fn: () => void) => void;
}

const PLAYER = 'repwars_adapter_unit';

function historyEntry(playerId: string, sessionId: string): WorkoutHistoryEntry {
  return {
    formatVersion: WORKOUT_HISTORY_FORMAT,
    playerId,
    sessionId,
    workoutId: 'wk_1',
    purpose: 'NORMAL_TROOPS',
    intendedDifficulty: 'MODERATE',
    completionState: 'COMPLETED',
    eligibleForFitnessEvaluation: true,
    createdAt: 1,
    startedAt: 1,
    completedAt: 5,
    abandonedAt: null,
    abandonmentReason: null,
    completedAtWorldTick: 2,
    feedback: null,
    integrityFlags: [],
    pauseCount: 0,
    prescribedWorkout: { workoutId: 'wk_1', intendedDifficulty: 'MODERATE', exercises: [] },
    performances: [],
    summary: null,
    exerciseIds: ['ex_neck_rolls'],
    evidence: null,
    physicalOutput: 44,
    physicalResult: null,
    rewardKind: 'TROOPS',
    rewardApplicationId: 'reward_1',
    gameplayContext: null,
    sessionState: 'COMPLETED',
  };
}

export function registerSupabasePersistenceTests(api: SupabasePersistenceTestApi): void {
  const { test } = api;
  console.log('Supabase persistence adapter');

  test('missing player is not found and a corrupt payload is rejected', () => {
    const table = new MemoryPlayerWorldTable();
    const store = new SupabaseGameStateStore(table);
    const missing = store.load('nobody');
    assert.strictEqual(missing.ok, false);
    if (!missing.ok) assert.strictEqual(missing.code, 'persistence.not_found');
    table.insert({
      player_id: PLAYER,
      world_id: 'local',
      format_version: 'game-state-persistence.v1',
      schema_version: 12,
      world_tick: 0,
      state_version: 1,
      payload: { broken: true },
    });
    const unsupported = store.load(PLAYER);
    assert.strictEqual(unsupported.ok, false);
    if (!unsupported.ok) assert.strictEqual(unsupported.code, 'persistence.unsupported_schema');

    table.updateIfVersion(PLAYER, 1, {
      player_id: PLAYER,
      world_id: 'local',
      format_version: 'game-state-persistence.v1',
      schema_version: 12,
      world_tick: 0,
      state_version: 1,
      payload: null,
    });
    const corrupt = store.load(PLAYER);
    assert.strictEqual(corrupt.ok, false);
    if (!corrupt.ok) assert.strictEqual(corrupt.code, 'persistence.corrupt');

    table.updateIfVersion(PLAYER, 1, {
      player_id: PLAYER,
      world_id: 'local',
      format_version: 'game-state-persistence.v1',
      schema_version: 12,
      world_tick: 0,
      state_version: 1,
      payload: { schemaVersion: 12.5 },
    });
    const fractional = store.load(PLAYER);
    assert.strictEqual(fractional.ok, false);
    if (!fractional.ok) assert.strictEqual(fractional.code, 'persistence.corrupt');
  });

  test('save, reload on a fresh store, and keep maps, schema, and the authored world', () => {
    const table = new MemoryPlayerWorldTable();
    const writer = new SupabaseGameStateStore(table);
    const original = createGameState();
    const territoryCount = original.territories.size;
    const saved = writer.save(PLAYER, original, 0);
    assert.strictEqual(saved.ok, true);
    if (!saved.ok) return;
    assert.strictEqual(saved.record.stateVersion, 1);
    assert.ok(saved.record.payload && typeof saved.record.payload === 'object');

    const reader = new SupabaseGameStateStore(table);
    const loaded = reader.load(PLAYER);
    assert.strictEqual(loaded.ok, true);
    if (!loaded.ok) return;
    assert.ok(loaded.state.territories instanceof Map);
    assert.ok(loaded.state.armies instanceof Map);
    assert.strictEqual(loaded.state.territories.size, territoryCount);
    assert.strictEqual(loaded.state.schemaVersion, original.schemaVersion);
    assert.strictEqual(loaded.state.definitionWorldId, original.definitionWorldId);
    assert.strictEqual(loaded.state.playerFactionId, original.playerFactionId);
    assert.strictEqual(loaded.record.stateVersion, 1);
  });

  test('hydration migrates an older stored schema version', () => {
    const table = new MemoryPlayerWorldTable();
    const store = new SupabaseGameStateStore(table);
    const saved = store.save(PLAYER, createGameState(), 0);
    assert.strictEqual(saved.ok, true);
    const row = table.find(PLAYER);
    assert.ok(row);
    const payload = row!.payload as Record<string, unknown>;
    payload.schemaVersion = 11;
    const replaced = table.updateIfVersion(PLAYER, 1, { ...row!, schema_version: 11, payload });
    assert.strictEqual(replaced, true);
    const loaded = new SupabaseGameStateStore(table).load(PLAYER);
    assert.strictEqual(loaded.ok, true);
    if (loaded.ok) assert.strictEqual(loaded.state.schemaVersion, 13);
  });

  test('compare-and-swap increments the version and a stale write leaves the row unchanged', () => {
    const table = new MemoryPlayerWorldTable();
    const store = new SupabaseGameStateStore(table);
    const state = createGameState();
    assert.strictEqual(store.save(PLAYER, state, 0).ok, true);
    state.worldTick = 4;
    const stale = store.save(PLAYER, state, 0);
    assert.strictEqual(stale.ok, false);
    if (!stale.ok) assert.strictEqual(stale.code, 'persistence.conflict');
    const unchanged = store.load(PLAYER);
    assert.strictEqual(unchanged.ok, true);
    if (unchanged.ok) {
      assert.strictEqual(unchanged.state.worldTick, 0);
      assert.strictEqual(unchanged.record.stateVersion, 1);
    }
    const next = store.save(PLAYER, state, 1);
    assert.strictEqual(next.ok, true);
    if (next.ok) assert.strictEqual(next.record.stateVersion, 2);
    const updated = new SupabaseGameStateStore(table).load(PLAYER);
    assert.strictEqual(updated.ok, true);
    if (updated.ok) assert.strictEqual(updated.state.worldTick, 4);
  });

  test('an invalid snapshot is rejected before a row is written', () => {
    const table = new MemoryPlayerWorldTable();
    const store = new SupabaseGameStateStore(table);
    const state = createGameState();
    state.worldTick = -1;
    const saved = store.save(PLAYER, state, 0);
    assert.strictEqual(saved.ok, false);
    if (!saved.ok) assert.strictEqual(saved.code, 'persistence.invalid_state');
    assert.strictEqual(table.find(PLAYER), null);
  });

  test('workout history keeps session identity and the full payload', () => {
    const table = new MemoryWorkoutHistoryTable();
    const writer = new SupabaseWorkoutHistoryStore(table);
    const entry = historyEntry(PLAYER, 'sess_1');
    writer.upsert(entry);
    assert.strictEqual(writer.get(PLAYER, 'missing'), null);
    const reader = new SupabaseWorkoutHistoryStore(table);
    const loaded = reader.get(PLAYER, 'sess_1');
    assert.ok(loaded);
    assert.strictEqual(loaded!.sessionId, 'sess_1');
    assert.strictEqual(loaded!.physicalOutput, 44);
    assert.strictEqual(loaded!.rewardApplicationId, 'reward_1');
    assert.deepStrictEqual(loaded!.exerciseIds, ['ex_neck_rolls']);
    assert.strictEqual(reader.recentCompleted(PLAYER).length, 1);
  });

  test('a failed history write rolls the world save back', () => {
    const worlds = new MemoryPlayerWorldTable();
    const gameStore = new SupabaseGameStateStore(worlds);
    const history = new SupabaseWorkoutHistoryStore(new MemoryWorkoutHistoryTable());
    const originalUpsert = history.upsert.bind(history);
    history.upsert = () => {
      throw new PersistenceError('persistence.save_failed', 'history unavailable');
    };
    const failed = commitAuthoritativePlayerWorld({
      gameStore,
      historyStore: history,
      playerId: PLAYER,
      expectedVersion: 0,
      state: createGameState(),
      historyEntries: [historyEntry(PLAYER, 'sess_roll')],
    });
    assert.strictEqual(failed.ok, false);
    assert.strictEqual(failed.persisted, false);
    assert.strictEqual(gameStore.load(PLAYER).ok, false);
    history.upsert = originalUpsert;
    const saved = commitAuthoritativePlayerWorld({
      gameStore,
      historyStore: history,
      playerId: PLAYER,
      expectedVersion: 0,
      state: createGameState(),
      historyEntries: [historyEntry(PLAYER, 'sess_ok')],
    });
    assert.strictEqual(saved.ok, true);
    if (saved.ok) assert.strictEqual(saved.record.stateVersion, 1);
    assert.strictEqual(history.get(PLAYER, 'sess_ok')?.rewardKind, 'TROOPS');
  });

  test('live Supabase save and reload when credentials are configured', () => {
    exerciseLiveSupabaseRoundTrip();
  });
}

export function exerciseLiveSupabaseRoundTrip(): void {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('  · live Supabase round trip skipped; credentials are not set');
    return;
  }
  const playerId = `repwars_adapter_live_${Date.now()}`;
  const worlds = new SupabasePlayerWorldTable();
  const historyTable = new SupabaseWorkoutHistoryTable();
  const gameStore = new SupabaseGameStateStore(worlds);
  const history = new SupabaseWorkoutHistoryStore(historyTable);
  try {
    const state = createGameState();
    const saved = commitAuthoritativePlayerWorld({
      gameStore,
      historyStore: history,
      playerId,
      expectedVersion: 0,
      state,
      historyEntries: [historyEntry(playerId, 'sess_live')],
    });
    assert.strictEqual(saved.ok, true, saved.ok ? '' : saved.message);
    const reloaded = new SupabaseGameStateStore(worlds).load(playerId);
    assert.strictEqual(reloaded.ok, true);
    if (reloaded.ok) {
      assert.strictEqual(reloaded.state.territories.size, state.territories.size);
      assert.strictEqual(reloaded.record.stateVersion, 1);
      assert.ok(reloaded.state.territories instanceof Map);
    }
    const entry = new SupabaseWorkoutHistoryStore(historyTable).get(playerId, 'sess_live');
    assert.strictEqual(entry?.physicalOutput, 44);
    state.worldTick = 9;
    const stale = gameStore.save(playerId, state, 0);
    assert.strictEqual(stale.ok, false);
    if (!stale.ok) assert.strictEqual(stale.code, 'persistence.conflict');
    const still = gameStore.load(playerId);
    assert.strictEqual(still.ok, true);
    if (still.ok) assert.strictEqual(still.state.worldTick, 0);
  } finally {
    historyTable.deletePlayer(playerId);
    worlds.deletePlayer(playerId);
  }
}

if (process.argv.includes('--live-supabase')) {
  exerciseLiveSupabaseRoundTrip();
}
