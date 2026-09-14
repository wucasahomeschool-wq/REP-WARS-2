import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { BattleEngine } from '../src/battle/BattleEngine';
import { BALANCE } from '../src/constants/balance';
import { calculateMovementDuration, isArmyMoving, movementTicksRemaining } from '../src/army/movement';
import { isActiveCommitmentStatus } from '../src/engine/DecisionEngine';
import { ErrorCode } from '../src/orchestration';
import { Orchestrator } from '../src/orchestration/orchestrator';
import { cloneGameState, checkGameStateInvariants, createGameState, createLegacySampleMapGameState } from '../src/state';
import { Army, Territory } from '../src/types';
import { GAME_STATE_SCHEMA_VERSION, emptyWorldClock, emptyRewardApplicationState, type GameState } from '../src/types/GameState';
import { authoredWorldFields } from './worldTestHelpers';
import type { CommandRequest } from '../src/orchestration';
import type { AICommitment } from '../src/types';
import type { WorldAdvanceResult } from '../src/world';
import type { WarlordSnapshot } from '../src/types';

export interface ArmyMovementTestApi {
  test: (name: string, fn: () => void) => void;
  cmdReq: (commandId: string, playerId: string, parameters?: Record<string, unknown>) => CommandRequest;
  makeCmt: (partial: Partial<AICommitment> & Pick<AICommitment, 'warlordId' | 'action'>) => AICommitment;
  makeTerritory: (overrides: Partial<Territory> & { id: string }) => Territory;
  makeSelf: (id: string, overrides?: Partial<WarlordSnapshot>) => WarlordSnapshot;
}

const MARCH_FID = 'march_faction';

export function registerArmyMovementTests(api: ArmyMovementTestApi): void {
  const { test, cmdReq, makeCmt, makeTerritory, makeSelf } = api;

  function buildPlayerMarchState(): GameState {
    const home = makeTerritory({ id: 'home', owner: MARCH_FID, neighboring: ['near'], terrain: 'plains', garrison: 40 });
    const near = makeTerritory({ id: 'near', owner: null, neighboring: ['home', 'far'], terrain: 'plains', garrison: 5 });
    const far = makeTerritory({ id: 'far', owner: null, neighboring: ['near'], terrain: 'plains', garrison: 5 });
    const army: Army = {
      id: 'march_army', owner: MARCH_FID, location: 'home',
      soldiers: 400, knights: 0, siegeEngines: 0, morale: 75, supply: 80, movement: null,
    };
    const snap = makeSelf(MARCH_FID, { territories: ['home'], armies: ['march_army'] });
    return {
      schemaVersion: GAME_STATE_SCHEMA_VERSION,
      turn: 1,
      ...emptyWorldClock(),
      ...emptyRewardApplicationState(),
      worldSeed: 42,
      factions: new Map([[MARCH_FID, snap]]),
      allFactionIds: [MARCH_FID],
      playerFactionId: MARCH_FID,
      territories: new Map([['home', home], ['near', near], ['far', far]]),
      ...authoredWorldFields(new Map([['home', home], ['near', near], ['far', far]])),
      armies: new Map([[army.id, army]]),
      commitments: new Map([[MARCH_FID, null]]),
      activeEvents: [],
      eventHistory: [],
    };
  }

  function marchDuration(state: GameState, fromId: string, toId: string): number {
    return calculateMovementDuration({
      origin: state.territories.get(fromId)!,
      destination: state.territories.get(toId)!,
    });
  }

  console.log('Army logistics — location, MOVE command, world-tick travel');

  test('army location is explicit on canonical GameState', () => {
    const state = createLegacySampleMapGameState({ seed: 42, playerFactionId: 'merchant_republic' });
    assert.ok(state.armies.size > 0);
    for (const a of state.armies.values()) {
      assert.ok(state.territories.has(a.location), `army ${a.id} location ${a.location}`);
      assert.ok(state.factions.has(a.owner));
      assert.ok(a.movement === null || a.movement === undefined || a.movement.status === 'moving');
    }
    assert.deepStrictEqual(checkGameStateInvariants(state), []);
  });

  test('valid adjacent MOVE starts immediately without waiting for arrival', () => {
    const orch = new Orchestrator(buildPlayerMarchState());
    const tickBefore = orch.getState().worldTick;
    const res = orch.execute(cmdReq('MOVE', 'p', {
      armyId: 'march_army', destinationTerritoryId: 'near', factionId: MARCH_FID,
    }));
    assert.strictEqual(res.success, true, res.errors[0]?.message);
    assert.strictEqual(res.payload.arrivalPending, true);
    assert.strictEqual(orch.getState().worldTick, tickBefore, 'MOVE must not advance world time');
    assert.strictEqual(orch.getState().armies.get('march_army')!.location, 'home');
    assert.strictEqual(orch.getState().armies.get('march_army')!.movement?.status, 'moving');
    assert.strictEqual(orch.getState().armies.get('march_army')!.movement?.destinationTerritoryId, 'near');
    assert.deepStrictEqual(checkGameStateInvariants(orch.getState()), []);
  });

  test('non-adjacent MOVE is rejected', () => {
    const state = buildPlayerMarchState();
    const before = cloneGameState(state);
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('MOVE', 'p', {
      armyId: 'march_army', destinationTerritoryId: 'far', factionId: MARCH_FID,
    }));
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.errors[0]!.code, ErrorCode.NOT_ADJACENT);
    assert.deepStrictEqual(orch.getState(), before);
  });

  test('MOVE by the wrong faction is rejected', () => {
    const state = buildPlayerMarchState();
    const other = makeSelf('other_faction', { territories: [], armies: [] });
    state.factions.set('other_faction', other);
    state.allFactionIds.push('other_faction');
    state.commitments.set('other_faction', null);
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('MOVE', 'p', {
      armyId: 'march_army', destinationTerritoryId: 'near', factionId: 'other_faction',
    }));
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.errors[0]!.code, ErrorCode.ACTION_NOT_ALLOWED);
    assert.strictEqual(orch.getState().armies.get('march_army')!.location, 'home');
  });

  test('MOVE of a nonexistent army is rejected', () => {
    const orch = new Orchestrator(buildPlayerMarchState());
    const res = orch.execute(cmdReq('MOVE', 'p', {
      armyId: 'no_such_army', destinationTerritoryId: 'near', factionId: MARCH_FID,
    }));
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.errors[0]!.code, ErrorCode.INVALID_ARMY);
  });

  test('already-moving army is rejected', () => {
    const orch = new Orchestrator(buildPlayerMarchState());
    const first = orch.execute(cmdReq('MOVE', 'p', {
      armyId: 'march_army', destinationTerritoryId: 'near', factionId: MARCH_FID,
    }));
    assert.strictEqual(first.success, true, first.errors[0]?.message);
    const res = orch.execute(cmdReq('MOVE', 'p', {
      armyId: 'march_army', destinationTerritoryId: 'near', factionId: MARCH_FID,
    }));
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.errors[0]!.code, ErrorCode.ACTION_NOT_ALLOWED);
    assert.ok(/already moving/i.test(res.errors[0]!.message));
  });

  test('movement duration is deterministic and matches BALANCE', () => {
    const plains = makeTerritory({ id: 'a', terrain: 'plains', neighboring: ['b'] });
    const mountain = makeTerritory({ id: 'b', terrain: 'mountain', neighboring: ['a'] });
    const d1 = calculateMovementDuration({ origin: plains, destination: mountain });
    const d2 = calculateMovementDuration({ origin: plains, destination: mountain });
    const expected = Math.max(
      BALANCE.movement.minTicks,
      BALANCE.movement.adjacentBaseTicks + BALANCE.movement.destinationTerrainTicks.mountain,
    );
    assert.strictEqual(d1, d2);
    assert.strictEqual(d1, expected);
    const plainsHop = calculateMovementDuration({ origin: mountain, destination: plains });
    assert.strictEqual(
      plainsHop,
      Math.max(BALANCE.movement.minTicks, BALANCE.movement.adjacentBaseTicks + BALANCE.movement.destinationTerrainTicks.plains),
    );
    assert.ok(d1 > plainsHop, 'mountain destination costs extra ticks');
  });

  test('movement progresses one tick at a time and army remains at origin until arrival', () => {
    const state = buildPlayerMarchState();
    const duration = marchDuration(state, 'home', 'near');
    assert.ok(duration >= 2, 'fixture duration must span more than one tick');
    const orch = new Orchestrator(state);
    orch.execute(cmdReq('MOVE', 'p', {
      armyId: 'march_army', destinationTerritoryId: 'near', factionId: MARCH_FID,
    }));
    const started = orch.getState().armies.get('march_army')!.movement!;
    for (let i = 0; i < duration - 1; i++) {
      const step = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 1 }));
      assert.strictEqual(step.success, true, step.errors[0]?.message);
      const army = orch.getState().armies.get('march_army')!;
      assert.strictEqual(army.location, 'home');
      assert.strictEqual(army.movement?.status, 'moving');
      assert.ok(movementTicksRemaining(army.movement!, orch.getState().worldTick) > 0);
    }
    assert.strictEqual(movementTicksRemaining(started, orch.getState().worldTick), 1);
    const last = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 1 }));
    assert.strictEqual(last.success, true, last.errors[0]?.message);
    const arrived = orch.getState().armies.get('march_army')!;
    assert.strictEqual(arrived.location, 'near');
    assert.ok(!isArmyMoving(arrived));
    const wa = last.payload.worldAdvance as WorldAdvanceResult;
    assert.ok(wa.movementResults.some((r) => r.armyId === 'march_army' && r.status === 'arrived'));
    assert.deepStrictEqual(checkGameStateInvariants(orch.getState()), []);
  });

  test('territory ownership is unchanged when an army marches away', () => {
    const orch = new Orchestrator(buildPlayerMarchState());
    const ownerBefore = orch.getState().territories.get('home')!.owner;
    const destOwnerBefore = orch.getState().territories.get('near')!.owner;
    orch.execute(cmdReq('MOVE', 'p', {
      armyId: 'march_army', destinationTerritoryId: 'near', factionId: MARCH_FID,
    }));
    const duration = orch.getState().armies.get('march_army')!.movement!.durationTicks;
    orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: duration }));
    assert.strictEqual(orch.getState().territories.get('home')!.owner, ownerBefore);
    assert.strictEqual(orch.getState().territories.get('near')!.owner, destOwnerBefore);
    assert.strictEqual(orch.getState().armies.get('march_army')!.location, 'near');
  });

  test('invalid destination fails cleanly without starting movement', () => {
    const orch = new Orchestrator(buildPlayerMarchState());
    const missing = orch.execute(cmdReq('MOVE', 'p', {
      armyId: 'march_army', destinationTerritoryId: 'no_tile', factionId: MARCH_FID,
    }));
    assert.strictEqual(missing.success, false);
    assert.strictEqual(missing.errors[0]!.code, ErrorCode.INVALID_TERRITORY);
    const same = orch.execute(cmdReq('MOVE', 'p', {
      armyId: 'march_army', destinationTerritoryId: 'home', factionId: MARCH_FID,
    }));
    assert.strictEqual(same.success, false);
    assert.strictEqual(same.errors[0]!.code, ErrorCode.ACTION_NOT_ALLOWED);
    assert.ok(!isArmyMoving(orch.getState().armies.get('march_army')!));
  });

  test('destination becoming invalid interrupts movement and does not complete twice', () => {
    const orch = new Orchestrator(buildPlayerMarchState());
    orch.execute(cmdReq('MOVE', 'p', {
      armyId: 'march_army', destinationTerritoryId: 'near', factionId: MARCH_FID,
    }));
    const live = orch.getState();
    live.territories.get('home')!.neighboring = [];
    live.territories.get('near')!.neighboring = ['far'];
    const res = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 1 }));
    assert.strictEqual(res.success, true, res.errors[0]?.message);
    const wa = res.payload.worldAdvance as WorldAdvanceResult;
    assert.ok(wa.movementResults.some((r) => r.armyId === 'march_army' && r.status === 'interrupted'));
    assert.strictEqual(orch.getState().armies.get('march_army')!.location, 'home');
    assert.ok(!isArmyMoving(orch.getState().armies.get('march_army')!));
    const again = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 1 }));
    const wa2 = again.payload.worldAdvance as WorldAdvanceResult;
    assert.ok(!wa2.movementResults.some((r) => r.armyId === 'march_army'));
  });

  test('destroyed army cannot continue moving; linked commitment does not stay active', () => {
    const state = buildPlayerMarchState();
    state.commitments.set(MARCH_FID, makeCmt({ warlordId: MARCH_FID, action: 'MOVE', targetId: 'near' }));
    const orch = new Orchestrator(state);
    const resolved = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: MARCH_FID }));
    assert.strictEqual(resolved.success, true, resolved.errors[0]?.message);
    assert.strictEqual(orch.getState().commitments.get(MARCH_FID)!.status, 'executing');
    const live = orch.getState();
    live.armies.delete('march_army');
    live.factions.get(MARCH_FID)!.armies = [];
    const res = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 1 }));
    assert.strictEqual(res.success, true, res.errors[0]?.message);
    assert.strictEqual(orch.getState().commitments.get(MARCH_FID)!.status, 'failed');
    assert.ok(!isActiveCommitmentStatus(orch.getState().commitments.get(MARCH_FID)!.status));
  });

  test('multiple armies progress independently', () => {
    const home = makeTerritory({ id: 'home', owner: MARCH_FID, neighboring: ['dest_a', 'dest_b'], terrain: 'plains' });
    const destA = makeTerritory({ id: 'dest_a', owner: null, neighboring: ['home'], terrain: 'plains' });
    const destB = makeTerritory({ id: 'dest_b', owner: null, neighboring: ['home'], terrain: 'mountain' });
    const armyA: Army = {
      id: 'army_a', owner: MARCH_FID, location: 'home',
      soldiers: 200, knights: 0, siegeEngines: 0, morale: 70, supply: 70, movement: null,
    };
    const armyZ: Army = {
      id: 'army_z', owner: MARCH_FID, location: 'home',
      soldiers: 200, knights: 0, siegeEngines: 0, morale: 70, supply: 70, movement: null,
    };
    const snap = makeSelf(MARCH_FID, { territories: ['home'], armies: ['army_a', 'army_z'] });
    const state: GameState = {
      schemaVersion: GAME_STATE_SCHEMA_VERSION,
      turn: 1,
      ...emptyWorldClock(),
      ...emptyRewardApplicationState(),
      worldSeed: 7,
      factions: new Map([[MARCH_FID, snap]]),
      allFactionIds: [MARCH_FID],
      playerFactionId: MARCH_FID,
      territories: new Map([['home', home], ['dest_a', destA], ['dest_b', destB]]),
      ...authoredWorldFields(new Map([['home', home], ['dest_a', destA], ['dest_b', destB]])),
      armies: new Map([[armyA.id, armyA], [armyZ.id, armyZ]]),
      commitments: new Map([[MARCH_FID, null]]),
      activeEvents: [],
      eventHistory: [],
    };
    const orch = new Orchestrator(state);
    orch.execute(cmdReq('MOVE', 'p', { armyId: 'army_z', destinationTerritoryId: 'dest_b', factionId: MARCH_FID }));
    orch.execute(cmdReq('MOVE', 'p', { armyId: 'army_a', destinationTerritoryId: 'dest_a', factionId: MARCH_FID }));
    const dA = orch.getState().armies.get('army_a')!.movement!.durationTicks;
    const dZ = orch.getState().armies.get('army_z')!.movement!.durationTicks;
    assert.ok(dZ > dA, 'mountain hop is slower');
    orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: dA }));
    assert.strictEqual(orch.getState().armies.get('army_a')!.location, 'dest_a');
    assert.strictEqual(orch.getState().armies.get('army_z')!.location, 'home');
    orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: dZ - dA }));
    assert.strictEqual(orch.getState().armies.get('army_z')!.location, 'dest_b');
  });

  test('identical commands produce equivalent movement (deterministic processing order)', () => {
    const startA = new Orchestrator(buildPlayerMarchState());
    const startB = new Orchestrator(buildPlayerMarchState());
    startA.execute(cmdReq('MOVE', 'p', { armyId: 'march_army', destinationTerritoryId: 'near', factionId: MARCH_FID }));
    startB.execute(cmdReq('MOVE', 'p', { armyId: 'march_army', destinationTerritoryId: 'near', factionId: MARCH_FID }));
    startA.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 2 }));
    startB.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 2 }));
    assert.deepStrictEqual(startA.getState().armies, startB.getState().armies);
    assert.deepStrictEqual(startA.getState().worldTick, startB.getState().worldTick);
  });

  test('ADVANCE_WORLD records arrived armies in deterministic army-id order', () => {
    const home = makeTerritory({ id: 'home', owner: MARCH_FID, neighboring: ['east', 'west'], terrain: 'plains' });
    const east = makeTerritory({ id: 'east', owner: null, neighboring: ['home'], terrain: 'plains' });
    const west = makeTerritory({ id: 'west', owner: null, neighboring: ['home'], terrain: 'plains' });
    const late: Army = {
      id: 'zz_army', owner: MARCH_FID, location: 'home',
      soldiers: 150, knights: 0, siegeEngines: 0, morale: 70, supply: 70, movement: null,
    };
    const early: Army = {
      id: 'aa_army', owner: MARCH_FID, location: 'home',
      soldiers: 150, knights: 0, siegeEngines: 0, morale: 70, supply: 70, movement: null,
    };
    const snap = makeSelf(MARCH_FID, { territories: ['home'], armies: ['zz_army', 'aa_army'] });
    const state: GameState = {
      schemaVersion: GAME_STATE_SCHEMA_VERSION,
      turn: 1,
      ...emptyWorldClock(),
      ...emptyRewardApplicationState(),
      worldSeed: 3,
      factions: new Map([[MARCH_FID, snap]]),
      allFactionIds: [MARCH_FID],
      playerFactionId: MARCH_FID,
      territories: new Map([['home', home], ['east', east], ['west', west]]),
      ...authoredWorldFields(new Map([['home', home], ['east', east], ['west', west]])),
      armies: new Map([[late.id, late], [early.id, early]]),
      commitments: new Map([[MARCH_FID, null]]),
      activeEvents: [],
      eventHistory: [],
    };
    const orch = new Orchestrator(state);
    orch.execute(cmdReq('MOVE', 'p', { armyId: 'zz_army', destinationTerritoryId: 'west', factionId: MARCH_FID }));
    orch.execute(cmdReq('MOVE', 'p', { armyId: 'aa_army', destinationTerritoryId: 'east', factionId: MARCH_FID }));
    const duration = orch.getState().armies.get('aa_army')!.movement!.durationTicks;
    const res = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: duration }));
    const arrived = (res.payload.worldAdvance as WorldAdvanceResult).movementResults.filter((r) => r.status === 'arrived');
    assert.deepStrictEqual(arrived.map((r) => r.armyId), ['aa_army', 'zz_army']);
  });

  test('AI MOVE commitment stays executing while moving and AI does not re-decide', () => {
    const state = createLegacySampleMapGameState({ seed: 42, playerFactionId: 'merchant_republic' });
    const fid = 'ashen_horde';
    const armyId = state.factions.get(fid)!.armies[0]!;
    const loc = state.armies.get(armyId)!.location;
    const dest = state.territories.get(loc)!.neighboring[0]!;
    state.commitments.set(fid, makeCmt({ warlordId: fid, action: 'MOVE', targetId: dest }));
    const orch = new Orchestrator(state);
    orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: fid }));
    assert.strictEqual(orch.getState().commitments.get(fid)!.status, 'executing');
    const duration = orch.getState().armies.get(armyId)!.movement!.durationTicks;
    const mid = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: duration - 1 }));
    assert.strictEqual(mid.success, true, mid.errors[0]?.message);
    assert.strictEqual(orch.getState().commitments.get(fid)!.status, 'executing');
    assert.strictEqual(orch.getState().armies.get(armyId)!.location, loc);
    const wa = mid.payload.worldAdvance as WorldAdvanceResult;
    assert.ok(!wa.aiDecisions.some((d) => d.factionId === fid));
    orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 1 }));
    assert.strictEqual(orch.getState().armies.get(armyId)!.location, dest);
    assert.strictEqual(orch.getState().commitments.get(fid)!.status, 'completed');
  });

  test('an army cannot ATTACK until it has arrived', () => {
    const atk = 'atk_faction';
    const def = 'def_faction';
    const home = makeTerritory({ id: 'home', owner: atk, neighboring: ['front', 'side'], garrison: 20 });
    const front = makeTerritory({ id: 'front', owner: def, neighboring: ['home', 'side'], garrison: 10 });
    const side = makeTerritory({ id: 'side', owner: atk, neighboring: ['home', 'front'], garrison: 10 });
    const army: Army = {
      id: 'atk_army', owner: atk, location: 'home',
      soldiers: 800, knights: 0, siegeEngines: 0, morale: 80, supply: 80, movement: null,
    };
    const atkSnap = makeSelf(atk, { territories: ['home', 'side'], armies: ['atk_army'] });
    const defSnap = makeSelf(def, { territories: ['front'], armies: [] });
    const state: GameState = {
      schemaVersion: GAME_STATE_SCHEMA_VERSION,
      turn: 1,
      ...emptyWorldClock(),
      ...emptyRewardApplicationState(),
      worldSeed: 42,
      factions: new Map([[atk, atkSnap], [def, defSnap]]),
      allFactionIds: [atk, def],
      playerFactionId: atk,
      territories: new Map([['home', home], ['front', front], ['side', side]]),
      ...authoredWorldFields(new Map([['home', home], ['front', front], ['side', side]])),
      armies: new Map([[army.id, army]]),
      commitments: new Map([[atk, null], [def, null]]),
      activeEvents: [],
      eventHistory: [],
    };
    state.lastAiDecisionTick.set(def, 10_000);
    const orch = new Orchestrator(state);
    const moving = orch.execute(cmdReq('MOVE', 'p', {
      armyId: 'atk_army', destinationTerritoryId: 'side', factionId: atk,
    }));
    assert.strictEqual(moving.success, true, moving.errors[0]?.message);
    const blocked = orch.execute(cmdReq('ATTACK', 'p', { territoryId: 'front', factionId: atk, seed: 42 }));
    assert.strictEqual(blocked.success, false);
    assert.strictEqual(blocked.errors[0]!.code, ErrorCode.ACTION_NOT_ALLOWED);
    assert.ok(/arrived/i.test(blocked.errors[0]!.message));
    const duration = orch.getState().armies.get('atk_army')!.movement!.durationTicks;
    orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: duration }));
    assert.strictEqual(orch.getState().armies.get('atk_army')!.location, 'side');
    const after = orch.execute(cmdReq('ATTACK', 'p', { territoryId: 'front', factionId: atk, seed: 42 }));
    assert.strictEqual(after.success, true, after.errors[0]?.message);
  });

  test('strategic MOVE is distinct from battlefield retreat; losers still cannot retreat', () => {
    const moveSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'army', 'movement.ts'), 'utf8');
    const battleSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'battle', 'BattleEngine.ts'), 'utf8');
    assert.ok(!moveSrc.includes('BattleEngine'));
    assert.ok(battleSrc.includes('NO-RETREAT RULE'));
    assert.ok(!battleSrc.includes('beginArmyMovement'));
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
    const orch = new Orchestrator(buildPlayerMarchState());
    const march = orch.execute(cmdReq('MOVE', 'p', {
      armyId: 'march_army', destinationTerritoryId: 'near', factionId: MARCH_FID,
    }));
    assert.strictEqual(march.success, true, march.errors[0]?.message);
    assert.ok(!('retreated' in march.payload));
  });

  test('GameState invariants remain valid across movement start and arrival', () => {
    const orch = new Orchestrator(buildPlayerMarchState());
    orch.execute(cmdReq('MOVE', 'p', {
      armyId: 'march_army', destinationTerritoryId: 'near', factionId: MARCH_FID,
    }));
    assert.deepStrictEqual(checkGameStateInvariants(orch.getState()), []);
    const duration = orch.getState().armies.get('march_army')!.movement!.durationTicks;
    orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: duration }));
    assert.deepStrictEqual(checkGameStateInvariants(orch.getState()), []);
    const movingClone = cloneGameState(buildPlayerMarchState());
    movingClone.armies.get('march_army')!.movement = {
      originTerritoryId: 'home',
      destinationTerritoryId: 'near',
      startedAtTick: 0,
      durationTicks: 2,
      status: 'moving',
      commitmentId: null,
    };
    movingClone.armies.get('march_army')!.location = 'near';
    const bad = checkGameStateInvariants(movingClone);
    assert.ok(bad.some((v) => v.code === 'army.moving_location_mismatch'));
  });

  test('MOVE command does not block on arrival', () => {
    const orch = new Orchestrator(buildPlayerMarchState());
    const tick = orch.getState().worldTick;
    const res = orch.execute(cmdReq('MOVE', 'p', {
      armyId: 'march_army', destinationTerritoryId: 'near', factionId: MARCH_FID,
    }));
    assert.strictEqual(res.success, true, res.errors[0]?.message);
    assert.strictEqual(orch.getState().worldTick, tick);
    assert.notStrictEqual(orch.getState().armies.get('march_army')!.location, 'near');
  });

  test('movement status is moving in GameState and arrived only on the tick result', () => {
    const orch = new Orchestrator(buildPlayerMarchState());
    orch.execute(cmdReq('MOVE', 'p', {
      armyId: 'march_army', destinationTerritoryId: 'near', factionId: MARCH_FID,
    }));
    assert.strictEqual(orch.getState().armies.get('march_army')!.movement?.status, 'moving');
    const duration = orch.getState().armies.get('march_army')!.movement!.durationTicks;
    const res = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: duration }));
    assert.strictEqual(orch.getState().armies.get('march_army')!.movement, null);
    const arrived = (res.payload.worldAdvance as WorldAdvanceResult).movementResults.find((r) => r.armyId === 'march_army');
    assert.strictEqual(arrived?.status, 'arrived');
  });

  test('player MOVE and AI MOVE share beginArmyMovement', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'orchestration', 'handlers.ts'), 'utf8');
    assert.ok(/export function handleMove[\s\S]*beginArmyMovement/.test(src));
    assert.ok(src.includes('return handleMove(state, ctx)'));
    const moveOp = fs.readFileSync(path.join(__dirname, '..', 'src', 'army', 'movement.ts'), 'utf8');
    assert.ok(moveOp.includes('export function beginArmyMovement'));
    assert.ok(!/\bDate\.now\s*\(/.test(moveOp));
    assert.ok(!/\bMath\.random\s*\(/.test(moveOp));
  });

  test('second RESOLVE_COMMITMENT while moving is idempotent', () => {
    const state = buildPlayerMarchState();
    state.commitments.set(MARCH_FID, makeCmt({ warlordId: MARCH_FID, action: 'MOVE', targetId: 'near' }));
    const orch = new Orchestrator(state);
    const first = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: MARCH_FID }));
    assert.strictEqual(first.success, true, first.errors[0]?.message);
    const dest = orch.getState().armies.get('march_army')!.movement!.destinationTerritoryId;
    const second = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: MARCH_FID }));
    assert.strictEqual(second.success, true, second.errors[0]?.message);
    assert.strictEqual(second.payload.arrivalPending, true);
    assert.strictEqual(orch.getState().commitments.get(MARCH_FID)!.status, 'executing');
    assert.strictEqual(orch.getState().armies.get('march_army')!.location, 'home');
    assert.strictEqual(orch.getState().armies.get('march_army')!.movement?.destinationTerritoryId, dest);
  });

  test('arrival is not applied twice after the army is already idle', () => {
    const orch = new Orchestrator(buildPlayerMarchState());
    orch.execute(cmdReq('MOVE', 'p', {
      armyId: 'march_army', destinationTerritoryId: 'near', factionId: MARCH_FID,
    }));
    const duration = orch.getState().armies.get('march_army')!.movement!.durationTicks;
    orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: duration }));
    assert.strictEqual(orch.getState().armies.get('march_army')!.location, 'near');
    const extra = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 1 }));
    const wa = extra.payload.worldAdvance as WorldAdvanceResult;
    assert.ok(!wa.movementResults.some((r) => r.armyId === 'march_army'));
    assert.strictEqual(orch.getState().armies.get('march_army')!.location, 'near');
  });
}
