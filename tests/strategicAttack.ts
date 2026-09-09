import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { BattleEngine } from '../src/battle/BattleEngine';
import {
  isLegalStagingTerritory,
  listLegalStagingTerritoryIds,
  selectDelayedAttackPlan,
  listImmediateAttackingArmies,
  executeReadyStrategicAttack,
  invalidateStaleAttackIntents,
  startStrategicAttack,
} from '../src/army/strategicAttack';
import { calculateMovementDuration, isArmyMoving } from '../src/army/movement';
import { isActiveCommitmentStatus } from '../src/engine/DecisionEngine';
import { ErrorCode } from '../src/orchestration';
import { Orchestrator } from '../src/orchestration/orchestrator';
import { cloneGameState, checkGameStateInvariants, createGameState } from '../src/state';
import { Army, Territory } from '../src/types';
import { GAME_STATE_SCHEMA_VERSION, emptyWorldClock, type GameState } from '../src/types/GameState';
import type { CommandRequest } from '../src/orchestration';
import type { AICommitment, WarlordSnapshot } from '../src/types';
import type { WorldAdvanceResult } from '../src/world';

export interface StrategicAttackTestApi {
  test: (name: string, fn: () => void) => void;
  cmdReq: (commandId: string, playerId: string, parameters?: Record<string, unknown>) => CommandRequest;
  makeCmt: (partial: Partial<AICommitment> & Pick<AICommitment, 'warlordId' | 'action'>) => AICommitment;
  makeTerritory: (overrides: Partial<Territory> & { id: string }) => Territory;
  makeSelf: (id: string, overrides?: Partial<WarlordSnapshot>) => WarlordSnapshot;
}

const ATK = 'atk_faction';
const DEF = 'def_faction';

export function registerStrategicAttackTests(api: StrategicAttackTestApi): void {
  const { test, cmdReq, makeCmt, makeTerritory, makeSelf } = api;

  function army(id: string, location: string, soldiers = 800): Army {
    return {
      id, owner: ATK, location, soldiers, knights: 0, siegeEngines: 0,
      morale: 80, supply: 80, movement: null, attackIntent: null,
    };
  }

  /** rear (owned) – staging (owned) – front (enemy). Army starts at rear. */
  function buildChainState(opts?: { soldiers?: number; frontGarrison?: number; extraStaging?: boolean }): GameState {
    const rear = makeTerritory({ id: 'rear', owner: ATK, neighboring: opts?.extraStaging ? ['staging', 'alt_stage'] : ['staging'] });
    const staging = makeTerritory({ id: 'staging', owner: ATK, neighboring: ['rear', 'front'] });
    const front = makeTerritory({
      id: 'front', owner: DEF, neighboring: opts?.extraStaging ? ['staging', 'alt_stage'] : ['staging'],
      garrison: opts?.frontGarrison ?? 10,
    });
    const territories = new Map([['rear', rear], ['staging', staging], ['front', front]]);
    if (opts?.extraStaging) {
      territories.set('alt_stage', makeTerritory({
        id: 'alt_stage', owner: ATK, neighboring: ['rear', 'front'], terrain: 'mountain',
      }));
    }
    const a = army('atk_army', 'rear', opts?.soldiers ?? 800);
    const atkSnap = makeSelf(ATK, {
      territories: opts?.extraStaging ? ['rear', 'staging', 'alt_stage'] : ['rear', 'staging'],
      armies: ['atk_army'],
    });
    const defSnap = makeSelf(DEF, { territories: ['front'], armies: [] });
    const state: GameState = {
      schemaVersion: GAME_STATE_SCHEMA_VERSION,
      turn: 1,
      ...emptyWorldClock(),
      worldSeed: 42,
      factions: new Map([[ATK, atkSnap], [DEF, defSnap]]),
      allFactionIds: [ATK, DEF],
      playerFactionId: ATK,
      territories,
      mapWorld: null,
      visibility: new Map(),
      armies: new Map([[a.id, a]]),
      commitments: new Map([[ATK, null], [DEF, null]]),
      activeEvents: [],
      eventHistory: [],
    };
    state.lastAiDecisionTick.set(DEF, 10_000);
    return state;
  }

  function buildImmediateState(): GameState {
    const home = makeTerritory({ id: 'home', owner: ATK, neighboring: ['front'], garrison: 20 });
    const front = makeTerritory({ id: 'front', owner: DEF, neighboring: ['home'], garrison: 10 });
    const a = army('atk_army', 'home');
    return {
      schemaVersion: GAME_STATE_SCHEMA_VERSION,
      turn: 1,
      ...emptyWorldClock(),
      worldSeed: 42,
      factions: new Map([
        [ATK, makeSelf(ATK, { territories: ['home'], armies: ['atk_army'] })],
        [DEF, makeSelf(DEF, { territories: ['front'], armies: [] })],
      ]),
      allFactionIds: [ATK, DEF],
      playerFactionId: ATK,
      territories: new Map([['home', home], ['front', front]]),
      mapWorld: null,
      visibility: new Map(),
      armies: new Map([[a.id, a]]),
      commitments: new Map([[ATK, null], [DEF, null]]),
      activeEvents: [],
      eventHistory: [],
    };
  }

  console.log('Strategic attack — immediate, staging hop, invalidation');

  test('immediate adjacent attack still uses BattleEngine', () => {
    const orch = new Orchestrator(buildImmediateState());
    const res = orch.execute(cmdReq('ATTACK', 'p', { territoryId: 'front', factionId: ATK, seed: 42 }));
    assert.strictEqual(res.success, true, res.errors[0]?.message);
    assert.strictEqual(res.payload.attackOutcome, 'battle_resolved');
    assert.ok(res.payload.battleResult);
    assert.ok(res.events.some((e) => e.kind === 'battle'));
    assert.strictEqual(orch.getState().territories.get('front')!.owner, ATK);
  });

  test('player immediate ATTACK returns a battle result without waiting', () => {
    const orch = new Orchestrator(buildImmediateState());
    const tick = orch.getState().worldTick;
    const res = orch.execute(cmdReq('ATTACK', 'p', { territoryId: 'front', factionId: ATK, seed: 42 }));
    assert.strictEqual(res.success, true, res.errors[0]?.message);
    assert.strictEqual(orch.getState().worldTick, tick);
    assert.ok(!res.payload.arrivalPending);
  });

  test('AI immediate ATTACK commitment completes through BattleEngine', () => {
    const state = buildImmediateState();
    state.commitments.set(ATK, makeCmt({ warlordId: ATK, action: 'ATTACK', targetId: 'front' }));
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: ATK, seed: 42 }));
    assert.strictEqual(res.success, true, res.errors[0]?.message);
    assert.strictEqual(res.payload.attackOutcome, 'battle_resolved');
    assert.strictEqual(orch.getState().commitments.get(ATK)!.status, 'completed');
  });

  test('handlers do not reimplement battle math; they call startStrategicAttack / BattleEngine', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'orchestration', 'handlers.ts'), 'utf8');
    assert.ok(src.includes('startStrategicAttack'));
    assert.ok(/case 'ATTACK':[\s\S]*executeAttack/.test(src));
    const attackSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'army', 'strategicAttack.ts'), 'utf8');
    assert.ok(attackSrc.includes('battle.resolve(input)'));
    assert.ok(!/computeWinProbability|computeCasualtyRates/.test(attackSrc));
    assert.ok(!/\bDate\.now\s*\(/.test(attackSrc));
    assert.ok(!/\bMath\.random\s*\(/.test(attackSrc));
  });

  test('one-hop from a valid staging tile starts movement instead of battle', () => {
    const orch = new Orchestrator(buildChainState());
    const tick = orch.getState().worldTick;
    const res = orch.execute(cmdReq('ATTACK', 'p', { territoryId: 'front', factionId: ATK, seed: 42 }));
    assert.strictEqual(res.success, true, res.errors[0]?.message);
    assert.strictEqual(res.payload.attackOutcome, 'movement_started_for_attack');
    assert.strictEqual(res.payload.arrivalPending, true);
    assert.strictEqual(orch.getState().worldTick, tick);
    assert.strictEqual(orch.getState().armies.get('atk_army')!.location, 'rear');
    assert.strictEqual(orch.getState().armies.get('atk_army')!.movement?.destinationTerritoryId, 'staging');
    assert.strictEqual(orch.getState().armies.get('atk_army')!.attackIntent?.targetTerritoryId, 'front');
    assert.strictEqual(orch.getState().territories.get('front')!.owner, DEF);
  });

  test('attack intent survives world ticks and army remains at origin during the march', () => {
    const state = buildChainState();
    const orch = new Orchestrator(state);
    orch.execute(cmdReq('ATTACK', 'p', { territoryId: 'front', factionId: ATK, seed: 42 }));
    const duration = orch.getState().armies.get('atk_army')!.movement!.durationTicks;
    assert.ok(duration >= 2);
    orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: duration - 1 }));
    const a = orch.getState().armies.get('atk_army')!;
    assert.strictEqual(a.location, 'rear');
    assert.strictEqual(a.attackIntent?.status, 'pending_movement');
    assert.ok(isArmyMoving(a));
  });

  test('arrival triggers the same shared attack path and can capture', () => {
    const orch = new Orchestrator(buildChainState());
    orch.execute(cmdReq('ATTACK', 'p', { territoryId: 'front', factionId: ATK, seed: 42 }));
    const duration = orch.getState().armies.get('atk_army')!.movement!.durationTicks;
    const adv = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: duration }));
    assert.strictEqual(adv.success, true, adv.errors[0]?.message);
    assert.ok(adv.events.some((e) => e.kind === 'battle'));
    assert.strictEqual(orch.getState().territories.get('front')!.owner, ATK);
    const live = orch.getState().armies.get('atk_army');
    if (live) {
      assert.ok(!live.attackIntent);
      assert.ok(!isArmyMoving(live));
    }
    assert.deepStrictEqual(checkGameStateInvariants(orch.getState()), []);
  });

  test('failed delayed attack (attacker loss) clears intent and does not leave a plan', () => {
    const orch = new Orchestrator(buildChainState({ soldiers: 101, frontGarrison: 8000 }));
    orch.execute(cmdReq('ATTACK', 'p', { territoryId: 'front', factionId: ATK, seed: 1 }));
    const duration = orch.getState().armies.get('atk_army')!.movement!.durationTicks;
    orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: duration }));
    assert.strictEqual(orch.getState().territories.get('front')!.owner, DEF);
    assert.ok(!orch.getState().armies.has('atk_army'));
    assert.deepStrictEqual(checkGameStateInvariants(orch.getState()), []);
  });

  test('staging selection prefers shorter duration then territory id', () => {
    const state = buildChainState({ extraStaging: true });
    const plains = calculateMovementDuration({
      origin: state.territories.get('rear')!,
      destination: state.territories.get('staging')!,
    });
    const mountain = calculateMovementDuration({
      origin: state.territories.get('rear')!,
      destination: state.territories.get('alt_stage')!,
    });
    assert.ok(mountain > plains);
    const plan = selectDelayedAttackPlan(state, ATK, 'front');
    assert.ok(plan);
    assert.strictEqual(plan!.stagingTerritoryId, 'staging');
    const ids = listLegalStagingTerritoryIds(state, ATK, 'front');
    assert.deepStrictEqual(ids, ['alt_stage', 'staging']);
  });

  test('legal staging must be attacker-owned and must border the target', () => {
    const state = buildChainState();
    assert.strictEqual(isLegalStagingTerritory(state, ATK, 'staging', 'front'), true);
    assert.strictEqual(isLegalStagingTerritory(state, ATK, 'rear', 'front'), false);
    assert.strictEqual(isLegalStagingTerritory(state, ATK, 'front', 'front'), false);
    state.territories.get('staging')!.owner = DEF;
    assert.strictEqual(isLegalStagingTerritory(state, ATK, 'staging', 'front'), false);
    assert.strictEqual(selectDelayedAttackPlan(state, ATK, 'front'), null);
  });

  test('enemy-owned staging is never chosen; unreachable targets fail cleanly', () => {
    const state = buildChainState();
    state.territories.get('staging')!.owner = DEF;
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('ATTACK', 'p', { territoryId: 'front', factionId: ATK }));
    assert.strictEqual(res.success, false);
    assert.ok(res.errors[0]!.code === ErrorCode.INSUFFICIENT_TROOPS || res.errors[0]!.code === ErrorCode.ACTION_NOT_ALLOWED);
    assert.strictEqual(orch.getState().armies.get('atk_army')!.location, 'rear');
    assert.ok(!orch.getState().armies.get('atk_army')!.attackIntent);
  });

  test('deterministic staging tie uses territory id', () => {
    const state = buildChainState({ extraStaging: true });
    state.territories.get('alt_stage')!.terrain = 'plains';
    const a = selectDelayedAttackPlan(state, ATK, 'front');
    const b = selectDelayedAttackPlan(cloneGameState(state), ATK, 'front');
    assert.deepStrictEqual(a, b);
    assert.strictEqual(a!.stagingTerritoryId, 'alt_stage');
  });

  test('AI ATTACK stays executing during staging movement and does not re-decide', () => {
    const state = buildChainState();
    state.playerFactionId = DEF;
    state.commitments.set(ATK, makeCmt({ warlordId: ATK, action: 'ATTACK', targetId: 'front' }));
    const orch = new Orchestrator(state);
    orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: ATK, seed: 42 }));
    assert.strictEqual(orch.getState().commitments.get(ATK)!.status, 'executing');
    const duration = orch.getState().armies.get('atk_army')!.movement!.durationTicks;
    const mid = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: duration - 1 }));
    assert.strictEqual(orch.getState().commitments.get(ATK)!.status, 'executing');
    const wa = mid.payload.worldAdvance as WorldAdvanceResult;
    assert.ok(!wa.aiDecisions.some((d) => d.factionId === ATK));
  });

  test('AI delayed ATTACK completes after arrival battle', () => {
    const state = buildChainState();
    state.playerFactionId = DEF;
    state.commitments.set(ATK, makeCmt({ warlordId: ATK, action: 'ATTACK', targetId: 'front' }));
    const orch = new Orchestrator(state);
    orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: ATK, seed: 42 }));
    const duration = orch.getState().armies.get('atk_army')!.movement!.durationTicks;
    orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: duration }));
    assert.ok(!isActiveCommitmentStatus(orch.getState().commitments.get(ATK)!.status));
    assert.strictEqual(orch.getState().commitments.get(ATK)!.status, 'completed');
    assert.strictEqual(orch.getState().territories.get('front')!.owner, ATK);
  });

  test('player cannot issue MOVE on an army with a pending attack', () => {
    const orch = new Orchestrator(buildChainState());
    orch.execute(cmdReq('ATTACK', 'p', { territoryId: 'front', factionId: ATK, seed: 42 }));
    const res = orch.execute(cmdReq('MOVE', 'p', {
      armyId: 'atk_army', destinationTerritoryId: 'staging', factionId: ATK,
    }));
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.errors[0]!.code, ErrorCode.ACTION_NOT_ALLOWED);
  });

  test('player cannot start a second ATTACK on the same target while one is pending', () => {
    const orch = new Orchestrator(buildChainState());
    orch.execute(cmdReq('ATTACK', 'p', { territoryId: 'front', factionId: ATK, seed: 42 }));
    const res = orch.execute(cmdReq('ATTACK', 'p', { territoryId: 'front', factionId: ATK, seed: 42 }));
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.errors[0]!.code, ErrorCode.ACTION_NOT_ALLOWED);
  });

  test('destroyed marching army fails the linked ATTACK commitment', () => {
    const state = buildChainState();
    state.playerFactionId = DEF;
    state.commitments.set(ATK, makeCmt({ warlordId: ATK, action: 'ATTACK', targetId: 'front' }));
    const orch = new Orchestrator(state);
    orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: ATK, seed: 42 }));
    const live = orch.getState();
    live.armies.delete('atk_army');
    live.factions.get(ATK)!.armies = [];
    orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 1 }));
    assert.strictEqual(orch.getState().commitments.get(ATK)!.status, 'failed');
  });

  test('target becoming the attacker faction fails the pending plan after arrival', () => {
    const orch = new Orchestrator(buildChainState());
    orch.execute(cmdReq('ATTACK', 'p', { territoryId: 'front', factionId: ATK, seed: 42 }));
    const duration = orch.getState().armies.get('atk_army')!.movement!.durationTicks;
    orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: duration - 1 }));
    orch.getState().territories.get('front')!.owner = ATK;
    orch.getState().factions.get(ATK)!.territories.push('front');
    orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 1 }));
    assert.ok(!orch.getState().armies.get('atk_army')!.attackIntent);
    assert.strictEqual(orch.getState().territories.get('front')!.owner, ATK);
    assert.ok(!orch.getState().armies.get('atk_army')!.attackIntent);
  });

  test('interrupted adjacency cancels pending attack intent', () => {
    const orch = new Orchestrator(buildChainState());
    orch.execute(cmdReq('ATTACK', 'p', { territoryId: 'front', factionId: ATK, seed: 42 }));
    const live = orch.getState();
    live.territories.get('rear')!.neighboring = [];
    live.territories.get('staging')!.neighboring = ['front'];
    orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 1 }));
    assert.ok(!orch.getState().armies.get('atk_army')!.attackIntent);
    assert.ok(!isArmyMoving(orch.getState().armies.get('atk_army')!));
    assert.strictEqual(orch.getState().armies.get('atk_army')!.location, 'rear');
  });

  test('arrival does not resolve the same pending attack twice', () => {
    const orch = new Orchestrator(buildChainState());
    orch.execute(cmdReq('ATTACK', 'p', { territoryId: 'front', factionId: ATK, seed: 42 }));
    const duration = orch.getState().armies.get('atk_army')!.movement!.durationTicks;
    const first = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: duration }));
    const battles1 = first.events.filter((e) => e.kind === 'battle').length;
    const second = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 1 }));
    const battles2 = second.events.filter((e) => e.kind === 'battle').length;
    assert.ok(battles1 >= 1);
    assert.strictEqual(battles2, 0);
  });

  test('cloneGameState deep-copies attackIntent', () => {
    const orch = new Orchestrator(buildChainState());
    orch.execute(cmdReq('ATTACK', 'p', { territoryId: 'front', factionId: ATK, seed: 42 }));
    const clone = cloneGameState(orch.getState());
    const src = orch.getState().armies.get('atk_army')!.attackIntent!;
    const dst = clone.armies.get('atk_army')!.attackIntent!;
    assert.deepStrictEqual(dst, src);
    assert.notStrictEqual(dst, src);
    dst.targetTerritoryId = 'mutated';
    assert.strictEqual(orch.getState().armies.get('atk_army')!.attackIntent!.targetTerritoryId, 'front');
  });

  test('invariants catch attackIntent staging equal to target', () => {
    const state = cloneGameState(buildImmediateState());
    state.armies.get('atk_army')!.attackIntent = {
      targetTerritoryId: 'front',
      stagingTerritoryId: 'front',
      createdAtTick: 0,
      status: 'pending_movement',
      commitmentId: null,
      battleSeed: 42,
    };
    const bad = checkGameStateInvariants(state);
    assert.ok(bad.some((v) => v.code === 'army.attack_stages_on_target'));
  });

  test('delayed attack never marches directly into the enemy target', () => {
    const orch = new Orchestrator(buildChainState());
    orch.execute(cmdReq('ATTACK', 'p', { territoryId: 'front', factionId: ATK, seed: 42 }));
    const dest = orch.getState().armies.get('atk_army')!.movement!.destinationTerritoryId;
    assert.notStrictEqual(dest, 'front');
    assert.strictEqual(orch.getState().territories.get(dest)!.owner, ATK);
  });

  test('strategic MOVE/ATTACK remains distinct from battlefield retreat', () => {
    const battleSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'battle', 'BattleEngine.ts'), 'utf8');
    assert.ok(battleSrc.includes('NO-RETREAT RULE'));
    const engine = new BattleEngine();
    const result = engine.resolve({
      turn: 1,
      seed: 1,
      attackerFactionId: 'a',
      attackerFactionName: 'A',
      defenderFactionId: 'b',
      defenderFactionName: 'B',
      attackerArmies: [{ id: 'x', owner: 'a', location: 'h', soldiers: 10, knights: 0, siegeEngines: 0, morale: 40, supply: 40 }],
      defenderArmies: [],
      defenderGarrison: 5000,
      territory: makeTerritory({ id: 'front', owner: 'b', fortification: 5, garrison: 5000, terrain: 'fortress' }),
    });
    const loser = result.winner === 'attacker' ? result.defender : result.attacker;
    assert.strictEqual(loser.remainingTroops, 0);
    assert.ok(!('retreated' in result.attacker));
  });

  test('own territory and missing territory are rejected', () => {
    const orch = new Orchestrator(buildImmediateState());
    const own = orch.execute(cmdReq('ATTACK', 'p', { territoryId: 'home', factionId: ATK }));
    assert.strictEqual(own.success, false);
    assert.strictEqual(own.errors[0]!.code, ErrorCode.INVALID_TARGET);
    const missing = orch.execute(cmdReq('ATTACK', 'p', { territoryId: 'nope', factionId: ATK }));
    assert.strictEqual(missing.success, false);
  });

  test('immediate attacking set uses armies already on legal staging tiles', () => {
    const state = buildImmediateState();
    const immediate = listImmediateAttackingArmies(state, ATK, 'front');
    assert.strictEqual(immediate.length, 1);
    assert.strictEqual(immediate[0]!.id, 'atk_army');
    state.armies.get('atk_army')!.movement = {
      originTerritoryId: 'home',
      destinationTerritoryId: 'front',
      startedAtTick: 0,
      durationTicks: 2,
      status: 'moving',
      commitmentId: null,
    };
    assert.strictEqual(listImmediateAttackingArmies(state, ATK, 'front').length, 0);
  });

  test('same-tick ready attacks process in army-id order', () => {
    const state = buildChainState();
    const z = army('zz_army', 'staging', 800);
    state.armies.set(z.id, z);
    state.factions.get(ATK)!.armies.push(z.id);
    z.attackIntent = {
      targetTerritoryId: 'front',
      stagingTerritoryId: 'staging',
      createdAtTick: 0,
      status: 'pending_movement',
      commitmentId: null,
      battleSeed: 42,
    };
    const a = army('aa_army', 'staging', 800);
    state.armies.set(a.id, a);
    state.factions.get(ATK)!.armies.push(a.id);
    a.attackIntent = {
      targetTerritoryId: 'front',
      stagingTerritoryId: 'staging',
      createdAtTick: 0,
      status: 'pending_movement',
      commitmentId: null,
      battleSeed: 42,
    };
    state.lastAiDecisionTick.set(DEF, 10_000);
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 1 }));
    const wa = res.payload.worldAdvance as WorldAdvanceResult;
    const notes = wa.notifications.filter((n) => n.title.includes('attack') || n.title.includes('Attack'));
    assert.ok(notes.length >= 1);
    assert.ok(res.events.filter((e) => e.kind === 'battle').length <= 1);
  });

  test('CWE coordinates pending attacks via host.executePendingAttack, not BattleEngine', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'world', 'ContinuousWorldEngine.ts'), 'utf8');
    assert.ok(src.includes('executePendingAttack'));
    assert.ok(!/new BattleEngine|battle\.resolve\(/.test(src));
  });

  test('ATTACK does not require an existing war declaration', () => {
    const state = buildImmediateState();
    assert.ok(!state.factions.get(ATK)!.diplomacy.get(DEF) || state.factions.get(ATK)!.diplomacy.get(DEF)!.state !== 'at_war');
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('ATTACK', 'p', { territoryId: 'front', factionId: ATK, seed: 42 }));
    assert.strictEqual(res.success, true, res.errors[0]?.message);
  });

  test('second RESOLVE_COMMITMENT while staging is idempotent', () => {
    const state = buildChainState();
    state.playerFactionId = DEF;
    state.commitments.set(ATK, makeCmt({ warlordId: ATK, action: 'ATTACK', targetId: 'front' }));
    const orch = new Orchestrator(state);
    orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: ATK, seed: 42 }));
    const dest = orch.getState().armies.get('atk_army')!.movement!.destinationTerritoryId;
    const second = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: ATK, seed: 42 }));
    assert.strictEqual(second.success, true, second.errors[0]?.message);
    assert.strictEqual(second.payload.arrivalPending, true);
    assert.strictEqual(orch.getState().commitments.get(ATK)!.status, 'executing');
    assert.strictEqual(orch.getState().armies.get('atk_army')!.movement!.destinationTerritoryId, dest);
  });

  test('target disappearance fails pending attack without a second battle', () => {
    const state = buildChainState();
    const host = {
      req: cmdReq('ATTACK', 'p', { territoryId: 'front', factionId: ATK, seed: 42 }),
      registry: { requireBattle: () => new BattleEngine() },
    };
    startStrategicAttack(state, host, { territoryId: 'front', factionId: ATK });
    state.territories.delete('front');
    state.factions.get(DEF)!.territories = [];
    state.territories.get('staging')!.neighboring = ['rear'];
    const stale = invalidateStaleAttackIntents(state);
    assert.strictEqual(stale.length, 1);
    assert.ok(!state.armies.get('atk_army')!.attackIntent);
    assert.ok(!isArmyMoving(state.armies.get('atk_army')!));
    const ready = executeReadyStrategicAttack(state, host, 'atk_army');
    assert.ok(ready.payload.attackOutcome === 'skipped' || ready.payload.attackOutcome === 'failed');
    assert.deepStrictEqual(checkGameStateInvariants(state), []);
  });

  test('GameState invariants hold after delayed attack start', () => {
    const orch = new Orchestrator(buildChainState());
    orch.execute(cmdReq('ATTACK', 'p', { territoryId: 'front', factionId: ATK, seed: 42 }));
    assert.deepStrictEqual(checkGameStateInvariants(orch.getState()), []);
  });
}
