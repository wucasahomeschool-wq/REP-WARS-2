import assert from 'assert';
import { seedLegacyWorkoutSession } from './legacyWorkoutFixture';
import { BattleEngine, BattleInput, BattleResult } from '../src/battle/BattleEngine';
import { createGameStateFromWorld } from '../src/worldDefinition/instantiate';
import { loadProductionLevel2Definition, requireWorldDefinition } from '../src/worldDefinition/catalog';
import { createActiveInvasion } from '../src/types/GameState';
import { resolveInvasionBattle } from '../src/gameplay/invasion/resolve';
import { applyBattleResultToGameState } from '../src/orchestration/applyBattle';
import { checkGameStateInvariants } from '../src/state/gameStateInvariants';
import { snapshotGameState } from '../src/persistence/snapshot';
import { hydratePersistedPayload } from '../src/persistence/hydrate';
import { Orchestrator } from '../src/orchestration/orchestrator';
import { createGameState } from '../src/state';
import { runStateTransaction } from '../src/orchestration/transaction';

class RecordingBattle extends BattleEngine {
  input!: BattleInput;
  resolve(input: BattleInput): BattleResult {
    this.input = structuredClone(input);
    return super.resolve(input);
  }
}

function fixture() {
  const state = createGameStateFromWorld(requireWorldDefinition(loadProductionLevel2Definition()), { seed: 1 });
  const defender = [...state.armies.values()].find(a => a.owner === 'f_player')!;
  const attacker = [...state.armies.values()].find(a => a.owner === 'f_ai_01')!;
  Object.assign(defender, { location: 't_02', soldiers: 101, knights: 0, siegeEngines: 0 });
  Object.assign(attacker, { soldiers: 8, knights: 0, siegeEngines: 0 });
  const invasion = createActiveInvasion({
    id: 'invasion_c1', defenderFactionId: 'f_player', attackerFactionId: attacker.owner,
    territoryId: 't_02', startedAtTick: 0, notifiedAtTick: 0, responseDeadlineTick: 30,
    attackingArmyIds: [attacker.id], battleSeed: 1, status: 'defense_in_progress',
  });
  invasion.defenseWorkoutStartedAtTick = 0;
  invasion.defenseCompletionDeadlineTick = 60;
  invasion.defenseMobilization = {
    applicationId: 'defense_c1', sessionId: 'workout_c1', workoutId: 'wk_moderate_full_body',
    playerId: 'player_c1', defensePower: 44, attachedAtTick: 0,
    workoutStartedAtTick: 0, sourcePhysicalOutput: 44,
  };
  state.activeInvasions.set(invasion.id, invasion);
  return { state, defender, attacker, invasion };
}

function removeArmy(f: ReturnType<typeof fixture>, army: typeof f.defender): void {
  f.state.armies.delete(army.id);
  const owner = f.state.factions.get(army.owner)!;
  owner.armies = owner.armies.filter(id => id !== army.id);
}

function resolve(f: ReturnType<typeof fixture>) {
  const engine = new RecordingBattle();
  const outcome = resolveInvasionBattle(f.state, engine, f.invasion.id);
  return { outcome, engine, battle: outcome.payload.battle as BattleResult };
}

function assertPhysicalAccounting(f: ReturnType<typeof fixture>, battle: BattleResult): void {
  const physical = battle.defenderPhysical!;
  assert.ok(physical, 'Temporary combat participants require physical settlement');
  const armies = [...f.state.armies.values()].filter(a => a.owner === 'f_player' && a.location === 't_02');
  for (const key of ['soldiers', 'knights', 'siegeEngines'] as const) {
    const remaining = armies.reduce((n, a) => n + a[key], 0);
    assert.strictEqual(remaining, physical.remaining[key]);
    assert.strictEqual(physical.initial[key], remaining + physical.casualties[key]);
    assert.ok(remaining <= physical.initial[key]);
  }
  const garrison = f.state.territories.get('t_02')!.garrison;
  assert.strictEqual(garrison, physical.remaining.garrison);
  assert.strictEqual(physical.initial.garrison, garrison + (physical.casualties.garrison ?? 0));
  const fact = [...f.state.conflictEventReceipts.values()].map(r => JSON.parse(r.signature))
    .find(r => r.kind === 'BATTLE');
  assert.ok(fact, 'Battle fact must be recorded');
  assert.deepStrictEqual(fact.troopLosses, [battle.attacker.casualties.total, physical.casualties.total]);
  assert.strictEqual(f.state.activeInvasions.size, 0);
  assert.deepStrictEqual(checkGameStateInvariants(f.state), []);
}

export function registerDefenseTroopAccountingTests(api: { test: (name: string, fn: () => void) => void }): void {
  api.test('C1 defense workout cannot materialize temporary power as permanent soldiers', () => {
    const { state, defender, invasion } = fixture();
    const before = defender.soldiers;
    const bank = state.playerRewards.bankedTroops;
    const result = resolveInvasionBattle(state, new BattleEngine(), invasion.id);
    const battle = result.payload.battle as BattleResult;
    assert.strictEqual(battle.winner, 'defender');
    assert.ok(defender.soldiers <= before, `Real soldiers grew from ${before} to ${defender.soldiers}`);
    assert.strictEqual(state.playerRewards.bankedTroops, bank);
    assert.strictEqual(state.activeInvasions.size, 0);
  });

  api.test('C1 mixed physical defenders retain native per-category casualty rounding', () => {
    const f = fixture();
    f.defender.knights = f.defender.soldiers;
    f.defender.siegeEngines = 9;
    f.state.territories.get('t_02')!.garrison = 103;
    const fitness = structuredClone(f.state.playerFitness);
    const resources = structuredClone([...f.state.factions.values()].map(x => x.resources));
    const rewards = structuredClone(f.state.playerRewards);
    const { battle, engine } = resolve(f);
    assert.strictEqual(battle.winner, 'defender');
    assertPhysicalAccounting(f, battle);
    // Equal real soldier/knight quantities must incur exactly equal losses at
    // the engine's one rate. Virtual soldiers cannot alter soldier allocation.
    assert.strictEqual(battle.defenderPhysical!.casualties.soldiers, battle.defender.casualties.knights);
    const { defenderPhysical: _physical, ...combat } = battle;
    const { temporaryDefenderSoldiers: _temporary, ...unmarked } = engine.input;
    assert.deepStrictEqual(combat, new BattleEngine().resolve(unmarked), 'Combat probability, RNG, casualties and narrative must stay exact');
    assert.deepStrictEqual(f.state.playerFitness, fitness);
    assert.deepStrictEqual(f.state.playerRewards, rewards);
    assert.deepStrictEqual([...f.state.factions.values()].map(x => x.resources), resources);
  });

  api.test('C1 failed defense annihilates real defenders without retaining temporary units', () => {
    const f = fixture();
    f.attacker.soldiers = 5000;
    f.defender.knights = 7;
    f.defender.siegeEngines = 2;
    const { battle } = resolve(f);
    assert.strictEqual(battle.winner, 'attacker');
    assertPhysicalAccounting(f, battle);
    assert.strictEqual(f.state.armies.has(f.defender.id), false);
    assert.strictEqual(f.state.playerRewards.bankedTroops, 0);
  });

  api.test('C1 temporary-only defense cannot create a field army or garrison', () => {
    const f = fixture();
    removeArmy(f, f.defender);
    const { battle } = resolve(f);
    assert.strictEqual(battle.winner, 'defender');
    assertPhysicalAccounting(f, battle);
    assert.strictEqual(f.state.factions.get('f_player')!.armies.length, 0);
    assert.strictEqual(battle.defenderPhysical!.casualties.total, 0);
  });

  api.test('C1 garrison-only defense conserves the real garrison without spawning armies', () => {
    const f = fixture();
    removeArmy(f, f.defender);
    f.state.territories.get('t_02')!.garrison = 101;
    const { battle } = resolve(f);
    assert.strictEqual(battle.winner, 'defender');
    assertPhysicalAccounting(f, battle);
    assert.strictEqual(f.state.factions.get('f_player')!.armies.length, 0);
  });

  api.test('C1 multiple real armies conserve each unit category in aggregate', () => {
    const f = fixture();
    const second = { ...f.defender, id: 'second_c1', soldiers: 37, knights: 11, siegeEngines: 3 };
    f.state.armies.set(second.id, second);
    f.state.factions.get('f_player')!.armies.push(second.id);
    const { battle } = resolve(f);
    assertPhysicalAccounting(f, battle);
  });

  for (const reason of ['undefended', 'defense_timeout', 'defense_abandoned'] as const) {
    api.test(`C1 ${reason} ignores attached temporary power and settles native physical combat`, () => {
      const f = fixture(), without = fixture();
      without.invasion.defenseMobilization = null;
      const engine = new RecordingBattle();
      const outcome = resolveInvasionBattle(f.state, engine, f.invasion.id, reason);
      const baseline = resolveInvasionBattle(without.state, new BattleEngine(), without.invasion.id, reason);
      assert.strictEqual(engine.input.temporaryDefenderSoldiers, 0);
      assert.strictEqual((outcome.payload.battle as BattleResult).defenderPhysical, undefined);
      assert.deepStrictEqual(outcome, baseline);
      assert.deepStrictEqual(snapshotGameState(f.state), snapshotGameState(without.state));
    });
  }

  api.test('C1 interrupted invasion with no attacker never materializes attached power', () => {
    const f = fixture();
    removeArmy(f, f.attacker);
    const result = resolveInvasionBattle(f.state, new BattleEngine(), f.invasion.id);
    assert.strictEqual(result.payload.battle, undefined);
    assert.strictEqual(f.defender.soldiers, 101);
    assert.strictEqual(f.state.activeInvasions.size, 0);
  });

  api.test('C1 ownership invalidation discards temporary power without battle', () => {
    const f = fixture();
    f.state.territories.get('t_02')!.owner = 'f_ai_02';
    f.state.factions.get('f_player')!.territories = f.state.factions.get('f_player')!.territories.filter(id => id !== 't_02');
    f.state.factions.get('f_ai_02')!.territories.push('t_02');
    const result = resolveInvasionBattle(f.state, new BattleEngine(), f.invasion.id);
    assert.strictEqual(result.payload.invasionOutcome, 'objective_invalid');
    assert.strictEqual(f.defender.soldiers, 101);
    assert.strictEqual(f.state.activeInvasions.size, 0);
    assert.deepStrictEqual(checkGameStateInvariants(f.state), []);
  });

  api.test('C1 persisted invasion and completed settlement replay exactly without double settlement', () => {
    const a = fixture(), b = fixture();
    b.state = hydratePersistedPayload(snapshotGameState(b.state));
    b.defender = b.state.armies.get(b.defender.id)!;
    b.attacker = b.state.armies.get(b.attacker.id)!;
    b.invasion = b.state.activeInvasions.get(b.invasion.id)!;
    const first = resolve(a), reloaded = resolve(b);
    assert.deepStrictEqual(first.outcome, reloaded.outcome);
    assert.deepStrictEqual(snapshotGameState(a.state), snapshotGameState(b.state));
    const state = hydratePersistedPayload(snapshotGameState(a.state));
    const before = snapshotGameState(state);
    const replay = applyBattleResultToGameState(state, first.battle, [a.attacker], [a.defender], state.turn, a.invasion.id);
    assert.deepStrictEqual(replay, { stateChanges: [], territoryChanges: [], armyChanges: [], events: [] });
    assert.throws(() => resolveInvasionBattle(state, new BattleEngine(), a.invasion.id), /No active invasion/);
    assert.deepStrictEqual(snapshotGameState(state), before);
    const changed = structuredClone(first.battle);
    changed.defenderPhysical!.remaining.soldiers--;
    assert.throws(() => applyBattleResultToGameState(state, changed, [a.attacker], [a.defender], state.turn, a.invasion.id), /different consequences/);
  });

  api.test('C1 seeded matrix conserves physical units and preserves every combat outcome', () => {
    for (let seed = 1; seed <= 128; seed++) {
      const f = fixture();
      f.invasion.battleSeed = seed;
      f.attacker.soldiers = seed % 2 ? 8 : 1000;
      f.defender.soldiers = f.defender.knights = seed;
      f.state.territories.get('t_02')!.garrison = seed % 17;
      f.invasion.defenseMobilization!.defensePower = seed % 53 + 1;
      const { battle, engine } = resolve(f);
      assertPhysicalAccounting(f, battle);
      assert.strictEqual(battle.defenderPhysical!.casualties.soldiers, battle.defender.casualties.knights);
      const { defenderPhysical: _physical, ...combat } = battle;
      const { temporaryDefenderSoldiers: _temporary, ...input } = engine.input;
      assert.deepStrictEqual(combat, new BattleEngine().resolve(input));
    }
  });

  api.test('C1 settlement rejects unmarked virtual defenders before any canonical mutation', () => {
    const f = fixture();
    const combined = new BattleEngine().resolve({
      turn: 0, seed: 1, attackerFactionId: f.attacker.owner, defenderFactionId: f.defender.owner,
      attackerArmies: [f.attacker], defenderArmies: [f.defender, { soldiers: 44, knights: 0, morale: 80 }],
      territory: f.state.territories.get('t_02')!,
    });
    const before = snapshotGameState(f.state);
    assert.throws(() => applyBattleResultToGameState(f.state, combined, [f.attacker], [f.defender], 0), /physical defender settlement/);
    assert.deepStrictEqual(snapshotGameState(f.state), before);
  });

  api.test('C1 invariant rejection after nested invasion settlement discards physical and temporary consequences', () => {
    const f = fixture(), before = snapshotGameState(f.state);
    assert.throws(() => runStateTransaction(f.state, draft => {
      resolveInvasionBattle(draft, new BattleEngine(), f.invasion.id);
      draft.playerRewards.bankedTroops = -1;
    }));
    assert.deepStrictEqual(snapshotGameState(f.state), before);
  });

  api.test('C1 complete workout pipeline excludes temporary survivors after reconnect and retry', () => {
    let orch = new Orchestrator(createGameState({ seed: 1 }));
    let time = 1000, sequence = 0;
    const command = (commandId: string, parameters: Record<string, unknown> = {}) => {
      const result = orch.execute({ commandId, playerId: 'player_c1', requestId: `c1_${++sequence}`, parameters });
      assert.strictEqual(result.success, true, JSON.stringify(result.errors));
      return result;
    };
    const workout = (purpose: string) => {
      const invasionId = [...orch.getState().activeInvasions.keys()][0];
      if (purpose === 'NORMAL_TROOPS') {
        // C1 covers defense accounting after a pre-R1-D normal workout, not new reward locking.
        seedLegacyWorkoutSession(orch, { commandId: 'START_WORKOUT', playerId: 'player_c1',
          parameters: { purpose, sessionId: `c1_workout_${sequence}`, now: time } });
      } else command('START_WORKOUT', { purpose, invasionId, sessionId: `c1_workout_${sequence}`, now: time });
      while (orch.getState().playerFitness.activeSession!.state === 'ACTIVE') {
        const session = orch.getState().playerFitness.activeSession!;
        const step = session.prescribedWorkout.exercises[session.currentExerciseIndex!]!;
        time += 30_000;
        if (step.isRest) command('SKIP_REST', { order: step.order, now: time });
        else command('RECORD_EXERCISE', { order: step.order, now: time,
          ...(step.prescription.kind === 'repetitions' ? { repetitions: step.prescription.repetitions } : { durationSeconds: step.prescription.durationSeconds }) });
      }
      command('SUBMIT_WORKOUT_FEEDBACK', { value: 'ABOUT_RIGHT', now: ++time });
      // Reconnection with a completed but not-yet-applied defense workout.
      orch = new Orchestrator(hydratePersistedPayload(snapshotGameState(orch.getState())));
      return command('FINALIZE_WORKOUT', { now: ++time });
    };
    workout('NORMAL_TROOPS');
    command('ATTACK', { territoryId: 't_01', commitAmount: 101 });
    const total = () => [...orch.getState().armies.values()].filter(a => a.owner === 'f_player').reduce((n, a) => n + a.soldiers + a.knights, 0);
    const before = total(), bank = orch.getState().playerRewards.bankedTroops;
    workout('DEFENSE');
    assert.ok(total() <= before);
    assert.strictEqual(orch.getState().playerRewards.bankedTroops, bank);
    assert.ok(orch.getState().playerFitness.estimate);
    const snapshot = snapshotGameState(orch.getState());
    assert.strictEqual(orch.execute({ commandId: 'FINALIZE_WORKOUT', playerId: 'player_c1', parameters: { now: time } }).success, false);
    assert.deepStrictEqual(snapshotGameState(orch.getState()), snapshot);
    assert.deepStrictEqual(checkGameStateInvariants(orch.getState()), []);
  });
}
