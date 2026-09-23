/**
 * Gate 1 Phase 1C — banked Troops → ATTACK → Battle Engine → conquest.
 *
 * Uses CommandRequest → Orchestrator → commitBankedTroopsAndAttack →
 * startStrategicAttack → BattleEngine. Does not add a Gate 1 combat formula.
 */
import assert from 'assert';
import {
  ErrorCode,
  Orchestrator,
  checkGameStateInvariants,
  createTelemetryRecorder,
  ensureCity,
} from '../src';
import type { CommandRequest, CommandResponse, GameState } from '../src';
import { MIN_ATTACKING_TROOPS } from '../src/army/strategicAttack';
import {
  VERTICAL_SLICE_AI_1_FACTION_ID,
  VERTICAL_SLICE_AI_2_FACTION_ID,
  VERTICAL_SLICE_PLAYER_FACTION_ID,
  VERTICAL_SLICE_PLAYER_ID,
  VERTICAL_SLICE_TERRITORY_A,
  VERTICAL_SLICE_TERRITORY_B,
  VERTICAL_SLICE_TERRITORY_C,
  VERTICAL_SLICE_TERRITORY_D,
  VERTICAL_SLICE_WORLD_ID,
  createVerticalSliceScenario,
} from './fixtures/gate1VerticalSliceScenario';

export interface Gate1VerticalSliceAttackTestApi {
  test: (name: string, fn: () => void) => void;
}

/**
 * Measured against the authored AI_1 army on t_b (220 soldiers, 20 knights,
 * hills) through the real ATTACK command. Commit must exceed
 * MIN_ATTACKING_TROOPS. These seeds are inputs to BattleEngine, not a
 * special outcome switch.
 *
 * Victory: 2000 soldiers, seed 1 → roll 0.809 < win probability 0.858, captured.
 * Defeat: MIN_ATTACKING_TROOPS + 1 soldiers, seed 1 → roll 0.809 > win probability 0.234.
 */
const VICTORY_COMMIT = 2000;
const VICTORY_SEED = 1;
const DEFEAT_COMMIT = MIN_ATTACKING_TROOPS + 1;
const DEFEAT_SEED = 1;
/** Stays banked. Large enough to fund a later rejected commit above MIN_ATTACKING_TROOPS. */
const RESERVE = 250;

interface BattlePayload {
  winner?: string;
  territoryOutcome?: string;
  seedUsed?: number;
  randomRoll?: number;
  attacker?: { initialTroops?: number; remainingTroops?: number };
  unopposed?: boolean;
}

function cmd(
  commandId: string,
  parameters: Record<string, unknown>,
  requestId: string,
): CommandRequest {
  return {
    commandId,
    playerId: VERTICAL_SLICE_PLAYER_ID,
    requestId,
    parameters,
  };
}

function withBanked(amount: number): { state: GameState; orch: Orchestrator; recorder: ReturnType<typeof createTelemetryRecorder> } {
  const scenario = createVerticalSliceScenario();
  assert.strictEqual(scenario.state.playerRewards.bankedTroops, 0);
  scenario.state.playerRewards.bankedTroops = amount;
  const recorder = createTelemetryRecorder();
  const orch = new Orchestrator(scenario.state, undefined, recorder);
  return { state: scenario.state, orch, recorder };
}

function ownership(state: GameState): Record<string, string | null> {
  return {
    [VERTICAL_SLICE_TERRITORY_A]: state.territories.get(VERTICAL_SLICE_TERRITORY_A)?.owner ?? null,
    [VERTICAL_SLICE_TERRITORY_B]: state.territories.get(VERTICAL_SLICE_TERRITORY_B)?.owner ?? null,
    [VERTICAL_SLICE_TERRITORY_C]: state.territories.get(VERTICAL_SLICE_TERRITORY_C)?.owner ?? null,
    [VERTICAL_SLICE_TERRITORY_D]: state.territories.get(VERTICAL_SLICE_TERRITORY_D)?.owner ?? null,
  };
}

function attack(
  orch: Orchestrator,
  territoryId: string,
  commitAmount: number,
  seed?: number,
): CommandResponse {
  const parameters: Record<string, unknown> = { territoryId, commitAmount };
  if (seed !== undefined) parameters.seed = seed;
  return orch.execute(cmd('ATTACK', parameters, `atk_${territoryId}_${commitAmount}_${seed ?? 'none'}`));
}

function battleOf(res: CommandResponse): BattlePayload {
  const payload = res.payload as { battleResult?: BattlePayload; unopposed?: boolean };
  return { ...payload.battleResult, unopposed: payload.unopposed === true };
}

function playerArmies(state: GameState) {
  return [...state.armies.values()].filter((a) => a.owner === VERTICAL_SLICE_PLAYER_FACTION_ID);
}

function plantConquerableWorks(state: GameState): void {
  const territory = state.territories.get(VERTICAL_SLICE_TERRITORY_B);
  assert.ok(territory);
  territory.fortification = 2;
  ensureCity(state, VERTICAL_SLICE_TERRITORY_B, VERTICAL_SLICE_AI_1_FACTION_ID);
  const infra = state.territoryInfrastructure.get(VERTICAL_SLICE_TERRITORY_B);
  assert.ok(infra);
  infra.farmCompletedAtTick = 1;
  const projectId = 'c_gate1_t_b_mine';
  state.constructions.set(projectId, {
    id: projectId,
    factionId: VERTICAL_SLICE_AI_1_FACTION_ID,
    territoryId: VERTICAL_SLICE_TERRITORY_B,
    projectType: 'MINE',
    startedAtTick: 0,
    lastProgressTick: 0,
    durationTicks: 8,
    remainingTicks: 8,
    status: 'in_progress',
    completedAtTick: null,
  });
}

export function registerGate1VerticalSliceAttackTests(api: Gate1VerticalSliceAttackTestApi): void {
  const { test } = api;

  console.log('Gate 1 Phase 1C — troops → attack → battle → conquest');

  test('production vertical-slice start still has zero banked Troops and no player army', () => {
    const scenario = createVerticalSliceScenario();
    assert.strictEqual(scenario.state.playerRewards.bankedTroops, 0);
    assert.strictEqual(playerArmies(scenario.state).length, 0);
    assert.strictEqual(scenario.state.definitionWorldId, VERTICAL_SLICE_WORLD_ID);
    assert.strictEqual(scenario.state.playerFactionId, VERTICAL_SLICE_PLAYER_FACTION_ID);
  });

  test('legal adjacent enemy attack commits exact Troops and reaches BattleEngine', () => {
    const banked = VICTORY_COMMIT + RESERVE;
    const { orch } = withBanked(banked);
    const before = ownership(orch.getState());
    const res = attack(orch, VERTICAL_SLICE_TERRITORY_B, VICTORY_COMMIT, VICTORY_SEED);
    assert.strictEqual(res.success, true, res.errors[0]?.message);
    assert.strictEqual(res.payload.attackOutcome, 'battle_resolved');
    const battle = battleOf(res);
    assert.strictEqual(battle.unopposed, false);
    assert.strictEqual(typeof battle.seedUsed, 'number');
    assert.strictEqual(typeof battle.randomRoll, 'number');
    assert.strictEqual(battle.attacker?.initialTroops, VICTORY_COMMIT);
    assert.strictEqual(res.payload.committedTroops, VICTORY_COMMIT);
    assert.strictEqual(res.payload.remainingBankedTroops, RESERVE);
    assert.strictEqual(orch.getState().playerRewards.bankedTroops, RESERVE);
    assert.strictEqual(ownership(orch.getState())[VERTICAL_SLICE_TERRITORY_A], before[VERTICAL_SLICE_TERRITORY_A]);
    assert.strictEqual(ownership(orch.getState())[VERTICAL_SLICE_TERRITORY_C], before[VERTICAL_SLICE_TERRITORY_C]);
    assert.strictEqual(ownership(orch.getState())[VERTICAL_SLICE_TERRITORY_D], before[VERTICAL_SLICE_TERRITORY_D]);
    assert.strictEqual(ownership(orch.getState())[VERTICAL_SLICE_TERRITORY_B], VERTICAL_SLICE_PLAYER_FACTION_ID);
    assert.deepStrictEqual(checkGameStateInvariants(orch.getState()), []);
  });

  test('undefended adjacent enemy t_c is occupied through the real attack command', () => {
    const commit = DEFEAT_COMMIT;
    const { orch } = withBanked(commit + RESERVE);
    const legal = attack(orch, VERTICAL_SLICE_TERRITORY_C, commit, DEFEAT_SEED);
    assert.strictEqual(legal.success, true, legal.errors[0]?.message);
    assert.strictEqual(legal.payload.attackOutcome, 'battle_resolved');
    assert.strictEqual(legal.payload.unopposed, true);
    assert.strictEqual(orch.getState().territories.get(VERTICAL_SLICE_TERRITORY_C)?.owner, VERTICAL_SLICE_PLAYER_FACTION_ID);
    assert.strictEqual(orch.getState().territories.get(VERTICAL_SLICE_TERRITORY_B)?.owner, VERTICAL_SLICE_AI_1_FACTION_ID);
    assert.strictEqual(orch.getState().territories.get(VERTICAL_SLICE_TERRITORY_D)?.owner, VERTICAL_SLICE_AI_2_FACTION_ID);
    assert.strictEqual(orch.getState().playerRewards.bankedTroops, RESERVE);
    assert.deepStrictEqual(checkGameStateInvariants(orch.getState()), []);
  });

  test('rejected targets do not spend banked Troops or change ownership', () => {
    const banked = VICTORY_COMMIT + RESERVE;
    const cases: Array<{ id: string; territoryId: string; commit: number; code: string }> = [
      { id: 'non_adjacent', territoryId: VERTICAL_SLICE_TERRITORY_D, commit: VICTORY_COMMIT, code: ErrorCode.INSUFFICIENT_TROOPS },
      { id: 'own', territoryId: VERTICAL_SLICE_TERRITORY_A, commit: VICTORY_COMMIT, code: ErrorCode.INSUFFICIENT_TROOPS },
      { id: 'missing', territoryId: 't_missing', commit: VICTORY_COMMIT, code: ErrorCode.INVALID_TERRITORY },
    ];
    for (const item of cases) {
      const { orch } = withBanked(banked);
      const owners = ownership(orch.getState());
      const res = attack(orch, item.territoryId, item.commit, VICTORY_SEED);
      assert.strictEqual(res.success, false, item.id);
      assert.strictEqual(res.errors[0]?.code, item.code, `${item.id}: ${res.errors[0]?.message}`);
      if (item.id === 'non_adjacent' || item.id === 'own') {
        assert.match(String(res.errors[0]?.message), /staging position/);
      }
      assert.strictEqual(orch.getState().playerRewards.bankedTroops, banked, item.id);
      assert.deepStrictEqual(ownership(orch.getState()), owners, item.id);
      assert.strictEqual(playerArmies(orch.getState()).length, 0, item.id);
    }
  });

  test('over-commitment and non-positive commitments are rejected without mutation', () => {
    const banked = 250;
    const cases: Array<{ id: string; commit: number; code: string }> = [
      { id: 'over', commit: banked + 1, code: ErrorCode.INSUFFICIENT_TROOPS },
      { id: 'floor', commit: MIN_ATTACKING_TROOPS, code: ErrorCode.INSUFFICIENT_TROOPS },
      { id: 'zero', commit: 0, code: ErrorCode.INVALID_PARAMETER },
      { id: 'negative', commit: -5, code: ErrorCode.INVALID_PARAMETER },
      { id: 'fraction', commit: 150.5, code: ErrorCode.INVALID_PARAMETER },
    ];
    for (const item of cases) {
      const { orch } = withBanked(banked);
      const owners = ownership(orch.getState());
      const res = attack(orch, VERTICAL_SLICE_TERRITORY_B, item.commit, VICTORY_SEED);
      assert.strictEqual(res.success, false, item.id);
      assert.strictEqual(res.errors[0]?.code, item.code, `${item.id}: ${res.errors[0]?.message}`);
      assert.strictEqual(orch.getState().playerRewards.bankedTroops, banked, item.id);
      assert.deepStrictEqual(ownership(orch.getState()), owners, item.id);
    }
  });

  test('deterministic victory captures t_b and applies conquest cleanup', () => {
    const banked = VICTORY_COMMIT + RESERVE;
    const scenario = createVerticalSliceScenario();
    scenario.state.playerRewards.bankedTroops = banked;
    plantConquerableWorks(scenario.state);
    const authoredOutput = { ...scenario.state.territories.get(VERTICAL_SLICE_TERRITORY_B)!.resourceOutput };
    const defenderArmyId = [...scenario.state.armies.values()].find((a) => (
      a.owner === VERTICAL_SLICE_AI_1_FACTION_ID && a.location === VERTICAL_SLICE_TERRITORY_B
    ))?.id;
    assert.ok(defenderArmyId);
    const recorder = createTelemetryRecorder();
    const orch = new Orchestrator(scenario.state, undefined, recorder);
    const res = attack(orch, VERTICAL_SLICE_TERRITORY_B, VICTORY_COMMIT, VICTORY_SEED);
    assert.strictEqual(res.success, true, res.errors[0]?.message);
    const battle = battleOf(res);
    assert.strictEqual(battle.winner, 'attacker');
    assert.strictEqual(battle.territoryOutcome, 'captured');
    assert.strictEqual(battle.seedUsed, VICTORY_SEED);
    assert.strictEqual(battle.unopposed, false);

    const state = orch.getState();
    const captured = state.territories.get(VERTICAL_SLICE_TERRITORY_B);
    assert.strictEqual(captured?.owner, VERTICAL_SLICE_PLAYER_FACTION_ID);
    assert.strictEqual(state.territories.get(VERTICAL_SLICE_TERRITORY_A)?.owner, VERTICAL_SLICE_PLAYER_FACTION_ID);
    assert.strictEqual(state.territories.get(VERTICAL_SLICE_TERRITORY_C)?.owner, VERTICAL_SLICE_AI_1_FACTION_ID);
    assert.strictEqual(state.territories.get(VERTICAL_SLICE_TERRITORY_D)?.owner, VERTICAL_SLICE_AI_2_FACTION_ID);
    assert.ok(state.factions.get(VERTICAL_SLICE_PLAYER_FACTION_ID)?.territories.includes(VERTICAL_SLICE_TERRITORY_B));
    assert.ok(!state.factions.get(VERTICAL_SLICE_AI_1_FACTION_ID)?.territories.includes(VERTICAL_SLICE_TERRITORY_B));
    assert.strictEqual(state.playerRewards.bankedTroops, RESERVE);
    assert.strictEqual(state.armies.has(defenderArmyId), false);
    assert.strictEqual(captured?.fortification, 0);
    assert.strictEqual(captured?.garrison, 0);
    assert.strictEqual(state.cities.has(`city_${VERTICAL_SLICE_TERRITORY_B}`), false);
    assert.strictEqual(state.territoryInfrastructure.get(VERTICAL_SLICE_TERRITORY_B)?.farmCompletedAtTick, null);
    assert.strictEqual([...state.constructions.values()].some((p) => p.territoryId === VERTICAL_SLICE_TERRITORY_B), false);
    assert.deepStrictEqual(captured?.resourceOutput, authoredOutput);
    assert.strictEqual(state.definitionWorldId, VERTICAL_SLICE_WORLD_ID);
    assert.strictEqual(state.playerFactionId, VERTICAL_SLICE_PLAYER_FACTION_ID);

    const survivors = playerArmies(state);
    assert.strictEqual(survivors.length, 1);
    assert.strictEqual(survivors[0]!.location, VERTICAL_SLICE_TERRITORY_B);
    assert.ok((battle.attacker?.remainingTroops ?? 0) > 0);
    assert.ok((battle.attacker?.remainingTroops ?? 0) < VICTORY_COMMIT);

    const types = recorder.getEvents().map((e) => e.eventType);
    assert.ok(types.includes('attack.committed'));
    assert.ok(types.includes('battle.resolved'));
    assert.ok(types.includes('territory.conquered'));
    assert.deepStrictEqual(checkGameStateInvariants(state), []);

    const staleBanked = state.playerRewards.bankedTroops;
    const stale = attack(orch, VERTICAL_SLICE_TERRITORY_B, DEFEAT_COMMIT, VICTORY_SEED);
    assert.strictEqual(stale.success, false);
    assert.strictEqual(stale.errors[0]?.code, ErrorCode.INVALID_TARGET);
    assert.strictEqual(orch.getState().playerRewards.bankedTroops, staleBanked);
    assert.strictEqual(orch.getState().territories.get(VERTICAL_SLICE_TERRITORY_B)?.owner, VERTICAL_SLICE_PLAYER_FACTION_ID);
  });

  test('deterministic defeat leaves t_b enemy-owned and keeps uncommitted Troops', () => {
    const banked = DEFEAT_COMMIT + RESERVE;
    const { orch, recorder } = withBanked(banked);
    const defenderArmyId = [...orch.getState().armies.values()].find((a) => (
      a.owner === VERTICAL_SLICE_AI_1_FACTION_ID && a.location === VERTICAL_SLICE_TERRITORY_B
    ))?.id;
    assert.ok(defenderArmyId);
    const res = attack(orch, VERTICAL_SLICE_TERRITORY_B, DEFEAT_COMMIT, DEFEAT_SEED);
    assert.strictEqual(res.success, true, res.errors[0]?.message);
    const battle = battleOf(res);
    assert.strictEqual(battle.winner, 'defender');
    assert.strictEqual(battle.territoryOutcome, 'unchanged');
    assert.strictEqual(battle.unopposed, false);
    assert.strictEqual(battle.attacker?.initialTroops, DEFEAT_COMMIT);
    const state = orch.getState();
    assert.strictEqual(state.territories.get(VERTICAL_SLICE_TERRITORY_B)?.owner, VERTICAL_SLICE_AI_1_FACTION_ID);
    assert.strictEqual(state.playerRewards.bankedTroops, RESERVE);
    assert.strictEqual(playerArmies(state).length, 0);
    assert.strictEqual(state.armies.has(defenderArmyId), true);
    const types = recorder.getEvents().map((e) => e.eventType);
    assert.ok(types.includes('attack.committed'));
    assert.ok(types.includes('battle.resolved'));
    assert.ok(!types.includes('territory.conquered'));
    assert.deepStrictEqual(checkGameStateInvariants(state), []);
  });
}
