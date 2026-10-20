import assert from 'assert';
import { createLegacySampleMapGameState } from '../src/state/createGameState';
import { Orchestrator } from '../src/orchestration/orchestrator';
import { createDefaultRegistry } from '../src/orchestration';
import { BattleEngine, BattleInput, BattleResult } from '../src/battle/BattleEngine';
import { GameState } from '../src/types/GameState';
import { snapshotGameState } from '../src/persistence/snapshot';
import { hydratePersistedPayload } from '../src/persistence/hydrate';
import { runStateTransaction } from '../src/orchestration/transaction';
import { executeAttack } from '../src/orchestration/handlers';
import { executeReadyStrategicAttack } from '../src/army/strategicAttack';
import { progressArmyMovements } from '../src/army/movement';
import { resolveInvasionBattle } from '../src/gameplay/invasion/resolve';
import { deriveAuthoritativeBattleSeed } from '../src/orchestration/helpers';
import { InMemoryGameStateStore } from '../src/persistence/inMemoryGameStateStore';
import { InMemoryWorkoutHistoryStore } from '../src/fitness/history/inMemoryStore';
import { ensurePlayerWorld } from '../src/persistence/initializePlayerWorld';
import { PlayerWorldPersistence } from '../src/server/persistencePort';
import { createSessionHost } from '../src/server/session';
import { createCommandHttpServer } from '../src/server/http';
import { request } from 'node:http';
import { COMMAND_INDEX } from '../src/orchestration/commandIndex';
import { FixedWorldTimeAuthority } from '../src/persistence/timeAuthority';

class RecordingBattle extends BattleEngine {
  inputs: BattleInput[] = [];
  results: BattleResult[] = [];
  resolve(input: BattleInput): BattleResult {
    this.inputs.push(structuredClone(input));
    const result = super.resolve(input);
    this.results.push(result);
    return result;
  }
}

function fixture() {
  const state = createLegacySampleMapGameState({ seed: 17, playerFactionId: 'iron_kingdom' });
  state.playerRewards.bankedTroops = 1000;
  return state;
}

function playerAttack(seed: unknown, requestId = 'c3_attack') {
  const battle = new RecordingBattle(), registry = createDefaultRegistry();
  registry.registerBattle(battle);
  const orch = new Orchestrator(fixture(), registry);
  const response = orch.execute({ commandId: 'ATTACK', playerId: 'c3_player', requestId,
    parameters: { territoryId: 'eastern_hills', commitAmount: 301, seed } });
  assert.strictEqual(response.success, true, JSON.stringify(response.errors));
  assert.strictEqual(battle.inputs.length, 1);
  return { orch, battle, response };
}

function harness(state = fixture()) {
  const battle = new RecordingBattle(), registry = createDefaultRegistry();
  registry.registerBattle(battle);
  return { battle, registry, orch: new Orchestrator(state, registry) };
}

function normalState(player: string | null = 'iron_kingdom') {
  const state = fixture();
  state.playerFactionId = player;
  state.levelAnchorTerritoryIds = [];
  state.levelDefeat.status = 'active';
  const army = [...state.armies.values()].find(a => a.owner === 'iron_kingdom')!;
  army.location = 'iron_kingdom_east';
  return state;
}

function normalAttack(seed: number, player: string | null = 'iron_kingdom') {
  const h = harness(normalState(player));
  if (player === 'celestial_theocracy') {
    // This is the shared internal AI attack handler, not a public command
    // impersonating the opposing faction (which correctly fails authorization).
    const tx = runStateTransaction(h.orch.getState(), draft => executeAttack(draft, {
      req: { commandId: 'ATTACK', playerId: 'ai', parameters: { seed } }, registry: h.registry,
      def: COMMAND_INDEX.find(c => c.commandId === 'ATTACK')!, runtime: { aiWarlordStates: new Map() },
    }, 'eastern_hills', 'iron_kingdom'));
    h.orch = new Orchestrator(tx.state, h.registry);
    return { ...h, result: tx.result };
  }
  const result = h.orch.execute({ commandId: 'ATTACK', playerId: 'ai', requestId: 'c3_normal',
    parameters: { factionId: 'iron_kingdom', territoryId: 'eastern_hills', seed } });
  assert.strictEqual(result.success, true, JSON.stringify(result.errors));
  return { ...h, result };
}

function delayed(seed: number) {
  const state = normalState();
  const army = [...state.armies.values()].find(a => a.owner === 'iron_kingdom')!;
  army.location = 'deep_iron_mines';
  const h = harness(state);
  const started = h.orch.execute({ commandId: 'ATTACK', playerId: 'c3', requestId: 'c3_delayed',
    parameters: { territoryId: 'eastern_hills', seed } });
  assert.strictEqual(started.success, true, JSON.stringify(started.errors));
  assert.strictEqual(started.payload.attackOutcome, 'movement_started_for_attack');
  return { ...h, armyId: army.id };
}

function finishDelayed(state: GameState, battle: RecordingBattle, armyId: string, requestSeed: number) {
  const army = state.armies.get(armyId)!;
  const end = army.movement!.startedAtTick + army.movement!.durationTicks;
  state.worldTick = state.accruedTargetWorldTick = end;
  progressArmyMovements(state, end);
  const result = executeReadyStrategicAttack(state, {
    req: { commandId: 'ADVANCE_WORLD', playerId: 'c3', parameters: { seed: requestSeed } },
    registry: { requireBattle: () => battle },
  }, armyId);
  assert.strictEqual(result.commandSuccess, undefined, JSON.stringify(result.errors));
  assert.strictEqual(battle.inputs.length, 1);
  return result;
}

function persistenceHarness() {
  const store = new InMemoryGameStateStore();
  assert.ok(store.save('c3', fixture(), 0).ok);
  const persistence: PlayerWorldPersistence = {
    name: 'memory', history: new InMemoryWorkoutHistoryStore(),
    ensure: playerId => ensurePlayerWorld({ playerId, store }),
    save: (playerId, state, version) => store.save(playerId, state, version),
  };
  return { store, persistence, host: createSessionHost(persistence, { nowMs: () => 1000 }) };
}

export function registerBattleSeedAuthorityTests({ test }: { test: (name: string, fn: () => void | Promise<void>) => void }): void {
  test('C3 client seed variations cannot select battle seeds or outcomes', () => {
    const first = playerAttack(1);
    for (const seed of [2, 7, 42, 123456789, '123', null, { seed: 999 }]) {
      const next = playerAttack(seed);
      assert.strictEqual(next.battle.inputs[0]!.seed, first.battle.inputs[0]!.seed);
      assert.deepStrictEqual(next.battle.results, first.battle.results);
    }
  });

  test('C3 64 authoritative world seeds ignore changed request seeds and request identities', () => {
    const used = new Set<number>();
    for (let worldSeed = 0; worldSeed < 64; worldSeed++) {
      const a = fixture(), b = fixture(); a.worldSeed = b.worldSeed = worldSeed;
      const ah = harness(a), bh = harness(b);
      for (const [h, seed, requestId] of [[ah, 1, 'a'], [bh, 999999, 'b']] as const) {
        const r = h.orch.execute({ commandId: 'ATTACK', playerId: 'c3', requestId,
          parameters: { territoryId: 'eastern_hills', commitAmount: 301, seed, battleSeed: seed, rngSeed: seed, worldSeed: seed } });
        assert.strictEqual(r.success, true, JSON.stringify(r.errors));
      }
      assert.deepStrictEqual(ah.battle.results, bh.battle.results);
      used.add(ah.battle.inputs[0]!.seed);
    }
    assert.strictEqual(used.size, 64, 'The authoritative root still controls deterministic variation');
  });

  test('C3 existing-army player and AI battles use identical seed authority', () => {
    const player = normalAttack(1), ai = normalAttack(999, null);
    assert.deepStrictEqual(player.battle.inputs, ai.battle.inputs);
    assert.deepStrictEqual(player.battle.results, ai.battle.results);
    assert.deepStrictEqual(normalAttack(123).battle.results, player.battle.results);
  });

  test('C3 fresh AI invasions cannot take command seeds and persist the same seed into defense', () => {
    const a = normalAttack(1, 'celestial_theocracy'), b = normalAttack(987654, 'celestial_theocracy');
    const ai = [...a.orch.getState().activeInvasions.values()][0]!;
    const bi = [...b.orch.getState().activeInvasions.values()][0]!;
    assert.ok(ai && bi);
    assert.strictEqual(ai.battleSeed, bi.battleSeed);
    assert.strictEqual(a.battle.inputs.length, 0);
    resolveInvasionBattle(a.orch.getState(), a.battle, ai.id, 'undefended');
    resolveInvasionBattle(b.orch.getState(), b.battle, bi.id, 'undefended');
    assert.strictEqual(a.battle.inputs[0]!.seed, ai.battleSeed);
    assert.deepStrictEqual(a.battle.results, b.battle.results);
  });

  test('C3 delayed attacks ignore client seeds at creation and background completion', () => {
    const a = delayed(1), b = delayed(2);
    const saved = a.orch.getState().armies.get(a.armyId)!.attackIntent!.battleSeed;
    assert.strictEqual(b.orch.getState().armies.get(b.armyId)!.attackIntent!.battleSeed, saved);
    finishDelayed(a.orch.getState(), a.battle, a.armyId, 888);
    finishDelayed(b.orch.getState(), b.battle, b.armyId, 999);
    assert.strictEqual(a.battle.inputs[0]!.seed, saved);
    assert.deepStrictEqual(a.battle.results, b.battle.results);
  });

  test('C3 historical delayed seeds including zero survive reload without reseeding', () => {
    for (const historicalSeed of [0, 123456789]) {
      const a = delayed(1);
      a.orch.getState().armies.get(a.armyId)!.attackIntent!.battleSeed = historicalSeed;
      const state = hydratePersistedPayload(snapshotGameState(a.orch.getState()));
      const b = new RecordingBattle();
      finishDelayed(a.orch.getState(), a.battle, a.armyId, 42);
      finishDelayed(state, b, a.armyId, 99);
      assert.strictEqual(b.inputs[0]!.seed, historicalSeed);
      assert.deepStrictEqual(a.battle.results, b.results);
      assert.deepStrictEqual(snapshotGameState(a.orch.getState()), snapshotGameState(state));
    }
  });

  test('C3 historical invasion seeds and defense mobilization survive reload unchanged', () => {
    const h = normalAttack(77, 'celestial_theocracy');
    const state = h.orch.getState(), invasion = [...state.activeInvasions.values()][0]!;
    invasion.battleSeed = 0;
    invasion.status = 'defense_in_progress';
    invasion.defenseWorkoutStartedAtTick = 0;
    invasion.defenseCompletionDeadlineTick = 60;
    invasion.defenseMobilization = { applicationId: 'c3_def', sessionId: 'c3_workout', workoutId: 'wk_moderate_full_body',
      playerId: 'c3', defensePower: 44, attachedAtTick: 0, workoutStartedAtTick: 0, sourcePhysicalOutput: 44 };
    const loaded = hydratePersistedPayload(snapshotGameState(state)), b = new RecordingBattle();
    resolveInvasionBattle(state, h.battle, invasion.id);
    resolveInvasionBattle(loaded, b, invasion.id);
    assert.strictEqual(b.inputs[0]!.seed, 0);
    assert.ok(b.results[0]!.defenderPhysical);
    assert.deepStrictEqual(h.battle.results, b.results);
    assert.deepStrictEqual(snapshotGameState(state), snapshotGameState(loaded));
  });

  test('C3 failed battle transactions do not consume army identity or change subsequent randomness', () => {
    const state = fixture(), before = snapshotGameState(state), h = harness(state);
    assert.throws(() => runStateTransaction(state, draft => {
      executeAttack(draft, { req: { commandId: 'ATTACK', playerId: 'c3', parameters: {
        territoryId: 'eastern_hills', commitAmount: 301, seed: 987 } }, registry: h.registry,
        def: COMMAND_INDEX.find(c => c.commandId === 'ATTACK')!, runtime: { aiWarlordStates: new Map() } }, 'eastern_hills');
      throw new Error('abort after battle');
    }), /abort after battle/);
    assert.deepStrictEqual(snapshotGameState(state), before);
    const committed = playerAttack(123);
    assert.deepStrictEqual(h.battle.results, committed.battle.results);
    assert.strictEqual(state.nextArmySequence, 0);
  });

  test('C3 changed seed on lost-response retry returns the original persisted result after restart', async () => {
    const { store, persistence, host } = persistenceHarness();
    const opened = await host.openGameplaySession('c3', 'open');
    const req = { commandId: 'ATTACK', playerId: 'c3', requestId: 'same_attack', gameplaySessionId: opened.sessionId,
      commandSequence: 1, renewalSequence: 1, parameters: { territoryId: 'eastern_hills', commitAmount: 301, seed: 1 } };
    const first = await host.execute(req);
    assert.strictEqual(first.success, true, JSON.stringify(first.errors));
    const saved = store.load('c3'); assert.ok(saved.ok); if (!saved.ok) throw new Error('load');
    const retry = await createSessionHost(persistence, { nowMs: () => 1000 }).execute({ ...req, parameters: { ...req.parameters, seed: 999999 } });
    assert.strictEqual(retry.idempotentReplay, true);
    assert.deepStrictEqual(retry.payload, first.payload);
    const after = store.load('c3'); assert.ok(after.ok); if (!after.ok) throw new Error('reload');
    assert.deepStrictEqual(snapshotGameState(after.state), snapshotGameState(saved.state));
  });

  test('C3 CAS selects one outcome and stale retry cannot commit a seed-selected alternative', () => {
    const store = new InMemoryGameStateStore(); assert.ok(store.save('c3', fixture(), 0).ok);
    const a = store.load('c3'), b = store.load('c3'); assert.ok(a.ok && b.ok); if (!a.ok || !b.ok) throw new Error('load');
    const ah = harness(a.state), bh = harness(b.state);
    for (const [h, seed] of [[ah, 1], [bh, 999]] as const) {
      assert.ok(h.orch.execute({ commandId: 'ATTACK', playerId: 'c3', requestId: 'same',
        parameters: { territoryId: 'eastern_hills', commitAmount: 301, seed } }).success);
    }
    assert.deepStrictEqual(ah.battle.results, bh.battle.results);
    assert.ok(store.save('c3', ah.orch.getState(), a.record.stateVersion).ok);
    const stale = store.save('c3', bh.orch.getState(), b.record.stateVersion);
    assert.ok(!stale.ok && stale.code === 'persistence.conflict');
    const loaded = store.load('c3'); assert.ok(loaded.ok); if (!loaded.ok) throw new Error('reload');
    assert.deepStrictEqual(snapshotGameState(loaded.state), snapshotGameState(ah.orch.getState()));
  });

  test('C3 canonical seed identity excludes request metadata and canonicalizes force order', () => {
    const state = fixture();
    assert.strictEqual(deriveAuthoritativeBattleSeed(state, 'a', 'b', 't', ['y', 'x']),
      deriveAuthoritativeBattleSeed(state, 'a', 'b', 't', ['x', 'y']));
    assert.notStrictEqual(deriveAuthoritativeBattleSeed(state, 'a', 'b', 't', ['x']),
      deriveAuthoritativeBattleSeed(state, 'a', 'b', 't', ['y']));
  });

  test('C3 explicit engine seeds remain available only as internal deterministic test inputs', () => {
    const recorded = playerAttack(1).battle.inputs[0]!;
    const engine = new BattleEngine();
    assert.deepStrictEqual(engine.resolve({ ...recorded, seed: 42 }), engine.resolve({ ...recorded, seed: 42 }));
    assert.notDeepStrictEqual(engine.resolve({ ...recorded, seed: 42 }), engine.resolve({ ...recorded, seed: 99 }));
    const attack = COMMAND_INDEX.find(c => c.commandId === 'ATTACK')!;
    assert.ok(!JSON.stringify(attack).includes('seed'));
  });

  test('C3 live ticks and reloaded catch-up complete a delayed battle with the same stored result', () => {
    const a = delayed(1), b = delayed(999);
    const movement = a.orch.getState().armies.get(a.armyId)!.movement!;
    const target = movement.startedAtTick + movement.durationTicks;
    for (let tick = 0; tick < target; tick++) {
      const r = a.orch.execute({ commandId: 'ADVANCE_WORLD', playerId: 'ai', parameters: { elapsedTicks: 1, seed: tick + 55 } });
      assert.strictEqual(r.success, true, JSON.stringify(r.errors));
    }
    const loaded = hydratePersistedPayload(snapshotGameState(b.orch.getState()));
    b.registry.timeAuthority = new FixedWorldTimeAuthority(target);
    const catchup = new Orchestrator(loaded, b.registry);
    const result = catchup.execute({ commandId: 'SYNC_PLAYER_WORLD', playerId: 'c3', parameters: { seed: 888, targetWorldTick: target } });
    assert.strictEqual(result.success, true, JSON.stringify(result.errors));
    const playerBattles = (battle: RecordingBattle) => battle.results.filter(r => r.attacker.factionId === 'iron_kingdom' && r.territoryId === 'eastern_hills');
    assert.strictEqual(playerBattles(a.battle).length, 1);
    assert.deepStrictEqual(playerBattles(a.battle), playerBattles(b.battle));
  });

  test('C3 actual HTTP attack bodies cannot select randomness through seed fields', async () => {
    const results: unknown[] = [];
    for (const seed of [1, 999999]) {
      const { host } = persistenceHarness();
      const opened = await host.openGameplaySession('c3', 'http_open');
      const server = createCommandHttpServer(host);
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      try {
        const address = server.address(); if (!address || typeof address === 'string') throw new Error('port');
        const body = JSON.stringify({ commandId: 'ATTACK', playerId: 'c3', requestId: 'http_attack',
          gameplaySessionId: opened.sessionId, commandSequence: 1, renewalSequence: 1, seed,
          parameters: { territoryId: 'eastern_hills', commitAmount: 301, seed, battleSeed: seed, rngSeed: seed } });
        const response = await new Promise<{ success: boolean; payload: Record<string, unknown>; errors: unknown }>((resolve, reject) => {
          const req = request({ hostname: '127.0.0.1', port: address.port, path: '/commands', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
            let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => { try { resolve(JSON.parse(text)); } catch (e) { reject(e); } });
          });
          req.on('error', reject); req.end(body);
        });
        assert.strictEqual(response.success, true, JSON.stringify(response.errors));
        results.push({ seed: response.payload.battleSeed, result: response.payload.battleResult });
      } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
    }
    assert.deepStrictEqual(results[0], results[1]);
  });
}
