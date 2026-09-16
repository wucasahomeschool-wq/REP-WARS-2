import assert from 'assert';
import {
  ANCHOR_PROTECTED_MESSAGE,
  ANCHOR_PROTECTED_REASON,
  ActionScorer,
  BattleEngine,
  DecisionEngine,
  ErrorCode,
  GAME_STATE_SCHEMA_VERSION,
  MemorySystem,
  OrchestrationError,
  Orchestrator,
  PersonalitySystem,
  SeededRNG,
  WarlordState,
  GoalSystem,
  applyImmutableWorldDefinition,
  applyPlayerTerritoryLoss,
  assertAnchorAttackAllowed,
  beginInvasionAgainstPlayer,
  bindLevelAnchors,
  buildWarlordStates,
  checkGameStateInvariants,
  collectCommandTelemetry,
  createGameState,
  createGameStateFromWorld,
  createTelemetryRecorder,
  decodePersistable,
  encodePersistable,
  hydratePersistedPayload,
  importanceFor,
  initializePlayerWorld,
  isPlayerAnchorProtected,
  FIXTURE_TINY_WORLD_ID,
  loadTinyWorldDefinition,
  migrateGameStatePayload,
  playerOwnedAnchorTerritoryIds,
  playerOwnedNonAnchorTerritoryIds,
  processInvasionTimeouts,
  snapshotGameState,
  startStrategicAttack,
  toDecisionEngineSnapshot,
  validateCommitmentTarget,
} from '../src';
import type { CommandRequest, GameState, WorldDefinition } from '../src';
import { applyUnopposedOccupationToGameState, createDefaultRegistry } from '../src/orchestration';

export interface LevelAnchorTestApi {
  test: (name: string, fn: () => void) => void;
}

const PLAYER_ID = 'player_1';
const PLAYER = 'f_player';
const CINDER = 'f_cinder_court';
const ANCHOR = 't_01';
const EXPANSION = 't_02';
const ANCHOR_B = 't_03';
const STAGING = 't_04';

function cmd(commandId: string, parameters: Record<string, unknown> = {}, requestId?: string): CommandRequest {
  return {
    commandId,
    playerId: PLAYER_ID,
    requestId: requestId ?? `${commandId}_${Math.random().toString(36).slice(2, 8)}`,
    parameters,
  };
}

function level1(seed = 17): GameState {
  return createGameState({ seed, playerFactionId: PLAYER, worldId: FIXTURE_TINY_WORLD_ID });
}

function setOwner(state: GameState, territoryId: string, factionId: string): void {
  const tile = state.territories.get(territoryId);
  assert.ok(tile, `missing territory ${territoryId}`);
  const previous = tile.owner;
  if (previous && previous !== factionId) {
    const loser = state.factions.get(previous);
    if (loser) loser.territories = loser.territories.filter((id) => id !== territoryId);
  }
  tile.owner = factionId;
  const winner = state.factions.get(factionId);
  assert.ok(winner, `missing faction ${factionId}`);
  if (!winner.territories.includes(territoryId)) winner.territories.push(territoryId);
}

function factionArmy(state: GameState, factionId: string) {
  const army = [...state.armies.values()].find((a) => a.owner === factionId);
  assert.ok(army, `expected army for ${factionId}`);
  return army;
}

function placeArmy(state: GameState, factionId: string, territoryId: string, soldiers = 8000): void {
  const army = factionArmy(state, factionId);
  army.location = territoryId;
  army.soldiers = soldiers;
  army.knights = 0;
  army.siegeEngines = 0;
  army.movement = null;
  army.attackIntent = null;
}

function weakenPlayerDefense(state: GameState, territoryId: string): void {
  const tile = state.territories.get(territoryId)!;
  tile.garrison = 1;
  for (const army of state.armies.values()) {
    if (army.owner === PLAYER && army.location === territoryId) {
      army.soldiers = 1;
      army.knights = 0;
      army.siegeEngines = 0;
    }
  }
}

function expandPlayer(state: GameState): void {
  setOwner(state, EXPANSION, PLAYER);
}

function cloneTiny(): WorldDefinition {
  const loaded = loadTinyWorldDefinition();
  if (!loaded.ok) throw new Error(loaded.issues.map((issue) => `${issue.code}: ${issue.message}`).join('; '));
  return JSON.parse(JSON.stringify(loaded.definition)) as WorldDefinition;
}

function plantAttackCommitment(state: GameState, targetId: string): void {
  state.commitments.set(CINDER, {
    id: `cmt_${targetId}`,
    warlordId: CINDER,
    action: 'ATTACK',
    targetId,
    targetName: targetId,
    status: 'committed',
    createdTurn: 1,
    originatingGoalId: null,
    reason: ['test attack'],
    priority: 80,
    score: 80,
    confidence: 1,
    personalityBias: 0,
    ambitionInfluence: 0,
    factorBreakdown: [],
    statusReason: null,
  });
}

function resolveAiAttack(orch: Orchestrator, targetId: string, requestId: string) {
  plantAttackCommitment(orch.getState(), targetId);
  return orch.execute(cmd('RESOLVE_COMMITMENT', { factionId: CINDER, seed: 3 }, requestId));
}

function setWar(state: GameState, a: string, b: string): void {
  for (const [left, right] of [[a, b], [b, a]] as const) {
    const faction = state.factions.get(left);
    assert.ok(faction);
    faction.diplomacy.set(right, {
      target: right,
      state: 'at_war',
      opinion: -80,
      treaties: [],
      yearsAtPeace: 0,
      yearsAtWar: 1,
    });
  }
}

function expireOpenInvasions(state: GameState) {
  for (const invasion of state.activeInvasions.values()) {
    state.worldTick = Math.max(state.worldTick, invasion.responseDeadlineTick + 1);
  }
  return processInvasionTimeouts(state, new BattleEngine());
}

function scorerInput(state: GameState, factionId: string) {
  const snapshot = toDecisionEngineSnapshot(state);
  const self = snapshot.factions.get(factionId)!;
  const ctx = WarlordState.buildContext(self, snapshot);
  return {
    ctx,
    turn: 1,
    rng: new SeededRNG(11),
    memory: new MemorySystem(),
    goals: new GoalSystem(self.goals),
  };
}

export function registerLevelAnchorTests(api: LevelAnchorTestApi): void {
  const { test } = api;

  console.log('Level-anchor territories — bind, protect, defeat hook');

  test('Player starts Level 1 with one anchor from authored starting ownership', () => {
    const state = level1();
    assert.strictEqual(state.schemaVersion, GAME_STATE_SCHEMA_VERSION);
    assert.strictEqual(state.worldLevel, 1);
    assert.deepStrictEqual(state.levelAnchorTerritoryIds, [ANCHOR]);
    assert.strictEqual(state.territories.get(ANCHOR)?.owner, PLAYER);
    assert.deepStrictEqual(playerOwnedAnchorTerritoryIds(state), [ANCHOR]);
    assert.deepStrictEqual(playerOwnedNonAnchorTerritoryIds(state), []);
    assert.strictEqual(isPlayerAnchorProtected(state, ANCHOR), false);
    assert.strictEqual(state.levelDefeat.status, 'active');
    assert.deepStrictEqual(checkGameStateInvariants(state), []);
  });

  test('initializePlayerWorld freezes the same starting tiles as anchors', () => {
    const created = initializePlayerWorld({ playerId: PLAYER_ID, seed: 5, worldId: FIXTURE_TINY_WORLD_ID });
    assert.deepStrictEqual(created.state.levelAnchorTerritoryIds, [ANCHOR]);
    assert.strictEqual(created.state.levelDefeat.status, 'active');
  });

  test('ordinary conquest does not become an anchor, and rebind does not rewrite them', () => {
    const state = level1();
    expandPlayer(state);
    assert.deepStrictEqual(state.levelAnchorTerritoryIds, [ANCHOR]);
    assert.deepStrictEqual(playerOwnedNonAnchorTerritoryIds(state), [EXPANSION]);
    const def = loadTinyWorldDefinition();
    assert.ok(def.ok);
    applyImmutableWorldDefinition(state, def.definition);
    bindLevelAnchors(state, def.definition);
    assert.deepStrictEqual(state.levelAnchorTerritoryIds, [ANCHOR]);
  });

  test('anchor + one or more non-anchors: every current-level player anchor is protected', () => {
    const state = level1();
    expandPlayer(state);
    assert.strictEqual(isPlayerAnchorProtected(state, ANCHOR), true);
    assert.strictEqual(isPlayerAnchorProtected(state, EXPANSION), false);
    assert.strictEqual(isPlayerAnchorProtected(state, STAGING), false);
    setOwner(state, ANCHOR_B, PLAYER);
    assert.strictEqual(isPlayerAnchorProtected(state, ANCHOR), true);
    assert.strictEqual(isPlayerAnchorProtected(state, ANCHOR_B), false);
  });

  test('multiple starting anchors stay protected until no non-anchor territories remain', () => {
    const state = level1();
    setOwner(state, ANCHOR_B, PLAYER);
    state.levelAnchorTerritoryIds = [ANCHOR, ANCHOR_B];
    expandPlayer(state);
    assert.strictEqual(isPlayerAnchorProtected(state, ANCHOR), true);
    assert.strictEqual(isPlayerAnchorProtected(state, ANCHOR_B), true);
    assert.strictEqual(isPlayerAnchorProtected(state, EXPANSION), false);
    setOwner(state, EXPANSION, CINDER);
    const events = applyPlayerTerritoryLoss(state, EXPANSION);
    assert.strictEqual(isPlayerAnchorProtected(state, ANCHOR), false);
    assert.strictEqual(isPlayerAnchorProtected(state, ANCHOR_B), false);
    assert.ok(events.some((e) => e.data?.anchorProgression === 'became_attackable'));
  });

  test('AI ATTACK command on a protected anchor is rejected and does not change ownership', () => {
    const state = level1();
    expandPlayer(state);
    placeArmy(state, CINDER, ANCHOR_B);
    const before = state.territories.get(ANCHOR)!.owner;
    const orch = new Orchestrator(state);
    const res = resolveAiAttack(orch, ANCHOR, 'cmd_anchor');
    assert.strictEqual(res.success, false);
    assert.ok(
      res.errors[0]?.code === ErrorCode.ACTION_NOT_ALLOWED
      || res.errors[0]?.code === ErrorCode.INVALID_TARGET,
    );
    assert.strictEqual(res.errors[0]?.details?.reason, ANCHOR_PROTECTED_REASON);
    assert.ok((res.errors[0]?.message ?? '').includes('anchor'));
    assert.strictEqual(orch.getState().territories.get(ANCHOR)!.owner, before);
    assert.strictEqual(orch.getState().activeInvasions.size, 0);
  });

  test('AI can attack a non-anchor while the anchor stays protected', () => {
    const state = level1();
    expandPlayer(state);
    placeArmy(state, CINDER, STAGING);
    const orch = new Orchestrator(state);
    const blocked = resolveAiAttack(orch, ANCHOR, 'still_blocked');
    assert.strictEqual(blocked.success, false);
    const allowed = resolveAiAttack(orch, EXPANSION, 'exp_ok');
    assert.strictEqual(allowed.success, true, allowed.errors[0]?.message);
    assert.strictEqual(allowed.payload.attackOutcome, 'invasion_created');
    assert.strictEqual(orch.getState().territories.get(EXPANSION)!.owner, PLAYER);
    assert.strictEqual(orch.getState().territories.get(ANCHOR)!.owner, PLAYER);
  });

  test('authoritative startStrategicAttack and occupation cannot bypass anchor protection', () => {
    const state = level1();
    expandPlayer(state);
    placeArmy(state, CINDER, ANCHOR_B);
    const host = { req: cmd('ATTACK', { territoryId: ANCHOR, factionId: CINDER }), registry: createDefaultRegistry() };
    try {
      startStrategicAttack(state, host, { territoryId: ANCHOR, factionId: CINDER });
      assert.fail('startStrategicAttack must throw');
    } catch (err) {
      assert.ok(err instanceof OrchestrationError);
      assert.strictEqual(err.code, ErrorCode.ACTION_NOT_ALLOWED);
      assert.strictEqual(err.details?.reason, ANCHOR_PROTECTED_REASON);
    }
    try {
      beginInvasionAgainstPlayer(state, {
        attackerId: CINDER,
        territoryId: ANCHOR,
        armies: [factionArmy(state, CINDER)],
      });
      assert.fail('beginInvasionAgainstPlayer must throw');
    } catch (err) {
      assert.ok(err instanceof OrchestrationError);
      assert.strictEqual(err.details?.reason, ANCHOR_PROTECTED_REASON);
    }
    try {
      applyUnopposedOccupationToGameState(state, state.territories.get(ANCHOR)!, CINDER, [factionArmy(state, CINDER)], 1);
      assert.fail('occupation must throw');
    } catch (err) {
      assert.ok(err instanceof OrchestrationError);
      assert.strictEqual(err.details?.reason, ANCHOR_PROTECTED_REASON);
    }
    assert.strictEqual(state.territories.get(ANCHOR)!.owner, PLAYER);
  });

  test('losing every non-anchor makes the remaining anchors attackable, then last-anchor capture defeats the level', () => {
    const state = level1();
    expandPlayer(state);
    placeArmy(state, CINDER, STAGING);
    weakenPlayerDefense(state, EXPANSION);
    const orch = new Orchestrator(state);
    const opened = resolveAiAttack(orch, EXPANSION, 'exp_open');
    assert.strictEqual(opened.success, true, opened.errors[0]?.message);
    const lostExpansion = expireOpenInvasions(orch.getState());
    assert.strictEqual(orch.getState().territories.get(EXPANSION)!.owner, CINDER);
    assert.ok(lostExpansion.some((r) => r.events.some((e) => e.data?.anchorProgression === 'became_attackable')));
    assert.strictEqual(isPlayerAnchorProtected(orch.getState(), ANCHOR), false);
    assert.strictEqual(orch.getState().levelDefeat.status, 'active');

    orch.getState().attackerCooldowns.delete(CINDER);
    placeArmy(orch.getState(), CINDER, ANCHOR_B);
    weakenPlayerDefense(orch.getState(), ANCHOR);
    const finalAttack = resolveAiAttack(orch, ANCHOR, 'final_anchor');
    assert.strictEqual(finalAttack.success, true, finalAttack.errors[0]?.message);
    const lostAnchor = expireOpenInvasions(orch.getState());
    assert.strictEqual(orch.getState().territories.get(ANCHOR)!.owner, CINDER);
    assert.ok(lostAnchor.some((r) => r.events.some((e) => e.data?.anchorProgression === 'level_defeated')));
    assert.strictEqual(orch.getState().levelDefeat.status, 'defeated');
    assert.strictEqual(orch.getState().levelDefeat.defeatedLevel, 1);
    assert.strictEqual(orch.getState().levelDefeat.defeatedWorldId, 'w_ember_atoll');
    assert.strictEqual(orch.getState().levelDefeat.lastLostAnchorTerritoryId, ANCHOR);
    assert.strictEqual(orch.getState().worldLevel, 1);
    assert.deepStrictEqual(orch.getState().levelAnchorTerritoryIds, [ANCHOR]);
  });

  test('losing every remaining anchor in one sweep still records level defeat and does not wipe the player faction', () => {
    const state = level1();
    setOwner(state, ANCHOR_B, PLAYER);
    state.levelAnchorTerritoryIds = [ANCHOR, ANCHOR_B];
    setOwner(state, ANCHOR, CINDER);
    setOwner(state, ANCHOR_B, CINDER);
    const events = applyPlayerTerritoryLoss(state, ANCHOR);
    assert.strictEqual(state.levelDefeat.status, 'defeated');
    assert.ok(events.some((e) => e.data?.anchorProgression === 'level_defeated'));
    assert.ok(state.factions.has(PLAYER));
    assert.strictEqual(state.playerFactionId, PLAYER);
    const again = applyPlayerTerritoryLoss(state, ANCHOR_B);
    assert.ok(!again.some((e) => e.data?.anchorProgression === 'level_defeated'));
  });

  test('containedWorlds are recorded as the previous-level return hook; demotion is not applied', () => {
    const def = cloneTiny();
    def.containedWorlds = [{
      worldId: 'w_previous_level',
      regionId: 'r_cinder_highlands',
      placement: { origin: { x: 0, y: 0 }, rotationDegrees: 0, scale: 1 },
    }];
    const state = createGameStateFromWorld(def, { seed: 2, playerFactionId: PLAYER });
    assert.deepStrictEqual(state.levelDefeat.previousWorldIds, ['w_previous_level']);
    setOwner(state, ANCHOR, CINDER);
    applyPlayerTerritoryLoss(state, ANCHOR);
    assert.strictEqual(state.levelDefeat.status, 'defeated');
    assert.strictEqual(state.worldLevel, 1);
    assert.strictEqual(state.definitionWorldId, def.worldId);
    assert.deepStrictEqual(state.levelDefeat.previousWorldIds, ['w_previous_level']);
  });

  test('aggressive / opportunistic scoring never treats a protected anchor as a valid ATTACK target', () => {
    const state = level1();
    expandPlayer(state);
    placeArmy(state, CINDER, ANCHOR_B);
    setWar(state, CINDER, PLAYER);
    setWar(state, CINDER, 'f_salt_raiders');
    for (const type of ['aggressive', 'opportunistic'] as const) {
      state.factions.get(CINDER)!.personality = PersonalitySystem.createPreset(type);
      const scored = new ActionScorer().scoreAllActions(scorerInput(state, CINDER));
      assert.ok(
        !scored.some((row) => row.action === 'ATTACK' && row.targetId === ANCHOR),
        `${type} scored a protected anchor`,
      );
      assert.ok(
        scored.some((row) => row.action === 'ATTACK' && row.targetId === 't_05'),
        `${type} should still score other legal attacks`,
      );
    }
    const commitment = {
      id: 'cmt_anchor',
      warlordId: CINDER,
      action: 'ATTACK' as const,
      targetId: ANCHOR,
      targetName: ANCHOR,
      status: 'committed' as const,
      createdTurn: 1,
      originatingGoalId: null,
      reason: ['personality prefers the foothold'],
      priority: 99,
      score: 999,
      confidence: 1,
      personalityBias: 80,
      ambitionInfluence: 0,
      factorBreakdown: [],
      statusReason: null,
    };
    const validity = validateCommitmentTarget(commitment, toDecisionEngineSnapshot(state));
    assert.strictEqual(validity.valid, false);
    assert.ok(validity.reason.includes('anchor'));

    const engine = new DecisionEngine(3);
    const warlords = buildWarlordStates(state);
    const cinder = warlords.get(CINDER)!;
    cinder.snapshot.personality = PersonalitySystem.createPreset('aggressive');
    cinder.activeCommitment = commitment;
    const decision = engine.decide(cinder, toDecisionEngineSnapshot(state), 1);
    assert.notStrictEqual(decision.targetId, ANCHOR);
  });

  test('analytics records protection blocked, anchors becoming attackable, and level defeat', () => {
    assert.strictEqual(importanceFor('anchor.protection_blocked'), 'IMPORTANT');
    assert.strictEqual(importanceFor('anchor.became_attackable'), 'IMPORTANT');
    assert.strictEqual(importanceFor('level.defeated'), 'CRITICAL');

    const blockedState = level1();
    expandPlayer(blockedState);
    placeArmy(blockedState, CINDER, ANCHOR_B);
    const recorder = createTelemetryRecorder();
    const orch = new Orchestrator(blockedState, undefined, recorder);
    const blocked = resolveAiAttack(orch, ANCHOR, 'tel_block');
    assert.strictEqual(blocked.success, false);
    const blockedEvents = recorder.getEvents({ eventType: 'anchor.protection_blocked' });
    assert.strictEqual(blockedEvents.length, 1);
    assert.strictEqual(blockedEvents[0]!.payload.territoryId, ANCHOR);

    const state = level1();
    expandPlayer(state);
    placeArmy(state, CINDER, STAGING);
    weakenPlayerDefense(state, EXPANSION);
    const liveOrch = new Orchestrator(state);
    const opened = resolveAiAttack(liveOrch, EXPANSION, 'tel_exp');
    assert.strictEqual(opened.success, true, opened.errors[0]?.message);
    const expired = expireOpenInvasions(liveOrch.getState());
    const became = collectCommandTelemetry({
      request: cmd('ADVANCE_WORLD', { elapsedTicks: 31 }, 'tel_became'),
      response: {
        success: true,
        commandId: 'ADVANCE_WORLD',
        requestId: 'tel_became',
        playerId: PLAYER_ID,
        stateChanges: [],
        events: expired.flatMap((row) => row.events),
        notifications: [],
        presentation: null,
        resourcesChanged: [],
        territoriesChanged: [],
        armiesChanged: [],
        newlyAvailableActions: [],
        errors: [],
        payload: {},
      },
      state: liveOrch.getState(),
    });
    assert.ok(became.events.some((e) => e.eventType === 'anchor.became_attackable'));

    setOwner(liveOrch.getState(), ANCHOR, CINDER);
    const defeatEvents = applyPlayerTerritoryLoss(liveOrch.getState(), ANCHOR);
    const defeated = collectCommandTelemetry({
      request: cmd('ATTACK', { territoryId: ANCHOR, factionId: CINDER }, 'tel_defeat'),
      response: {
        success: true,
        commandId: 'ATTACK',
        requestId: 'tel_defeat',
        playerId: PLAYER_ID,
        stateChanges: [],
        events: defeatEvents,
        notifications: [],
        presentation: null,
        resourcesChanged: [],
        territoriesChanged: [],
        armiesChanged: [],
        newlyAvailableActions: [],
        errors: [],
        payload: { attackOutcome: 'battle_resolved' },
      },
      state: liveOrch.getState(),
    });
    assert.ok(defeated.events.some((e) => e.eventType === 'level.defeated'));
  });

  test('schema 9 saves hydrate empty anchors from WorldDefinition starting owners', () => {
    const encoded = snapshotGameState(level1());
    const decoded = decodePersistable(encoded) as Record<string, unknown>;
    decoded.schemaVersion = 9;
    delete decoded.levelAnchorTerritoryIds;
    delete decoded.levelDefeat;
    const migrated = migrateGameStatePayload(decoded);
    assert.deepStrictEqual(migrated.levelAnchorTerritoryIds, []);
    const loaded = hydratePersistedPayload(encodePersistable(migrated));
    assert.deepStrictEqual(loaded.levelAnchorTerritoryIds, [ANCHOR]);
    assert.strictEqual(loaded.levelDefeat.status, 'active');
    assert.strictEqual(loaded.schemaVersion, GAME_STATE_SCHEMA_VERSION);
  });

  test('GET_GAME_STATE exposes current-level anchors without inventing a capital', () => {
    const orch = new Orchestrator(level1());
    const res = orch.execute(cmd('GET_GAME_STATE'));
    assert.strictEqual(res.success, true);
    const view = res.payload.gameState as {
      levelAnchorTerritoryIds: string[];
      levelDefeatStatus: string;
    };
    assert.deepStrictEqual(view.levelAnchorTerritoryIds, [ANCHOR]);
    assert.strictEqual(view.levelDefeatStatus, 'active');
  });

  test('assertAnchorAttackAllowed is a no-op when the player only holds the foothold', () => {
    const state = level1();
    assertAnchorAttackAllowed(state, ANCHOR);
    assert.strictEqual(ANCHOR_PROTECTED_MESSAGE.length > 0, true);
  });
}
